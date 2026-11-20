import { describe, it, expect, vi } from 'vitest';
import { createDecipheriv, createHash } from 'crypto';
import { Sipay, QnbPay, verifySipay3DCallback } from '../../../../src/providers/sipay';
import { openSipayHashKey, sealSipayHashKey } from '../../../../src/providers/sipay/utils';
import { PaymentStatus } from '../../../../src/types';

const SECRET = 'payfyio-test-secret';
const BASE = { apiKey: '', secretKey: '', appId: 'app-1', appSecret: SECRET, merchantKey: 'mk-1' };

function make(extra: Record<string, unknown> = {}) {
  const p = new Sipay({ ...BASE, baseUrl: 'https://provisioning.sipay.com.tr', ...extra } as any);
  const post = vi.spyOn((p as any).client, 'post');
  return { p, post };
}

/** Route mocked POSTs by path; the token endpoint always succeeds unless overridden. */
function route(post: any, handlers: Record<string, (body: any, cfg: any) => any>) {
  post.mockImplementation(async (url: string, body: any, cfg: any) => {
    const h = handlers[url] ?? (url.endsWith('/token') ? () => ({ status_code: 100, data: { token: 'tok' } }) : undefined);
    if (!h) throw new Error(`unexpected ${url}`);
    const out = await h(body, cfg);
    return out && out.__res ? out.__res : { status: 200, data: out };
  });
}

const networkError = () => Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true });

function callback(fields: { status?: string; total?: string; invoice?: string; order?: string } = {}, extra: Record<string, unknown> = {}) {
  const { status = '1', total = '25.50', invoice = 'INV-42', order = 'VP123' } = fields;
  return {
    sipay_status: status,
    invoice_id: invoice,
    order_id: order,
    status_code: status === '1' ? '100' : '41',
    error_code: status === '1' ? '100' : '51',
    error: status === '1' ? 'OK' : 'Limit yetersiz',
    amount: total,
    hash_key: sealSipayHashKey([status, total, invoice, order, 'TRY'], SECRET),
    ...extra,
  } as Record<string, unknown>;
}

const paymentRequest = {
  price: '25.50',
  paidPrice: '25.50',
  currency: 'TRY',
  basketId: 'B1',
  conversationId: 'INV-42',
  callbackUrl: 'https://merchant.test/cb',
  paymentCard: { cardHolderName: 'Ada L', cardNumber: '4508 0345 0803 4509', expireMonth: '1', expireYear: '30', cvc: '000' },
  buyer: { id: 'u1', name: 'Ada', surname: 'L', email: 'a@x.test', identityNumber: '1', registrationAddress: 'a', city: 'Ist', country: 'TR', ip: '1.2.3.4', gsmNumber: '5' },
  shippingAddress: { contactName: 'A', city: 'Ist', country: 'TR', address: 'addr' },
  billingAddress: { contactName: 'A', city: 'Ist', country: 'TR', address: 'addr' },
  basketItems: [{ id: 'i', name: 'Item', category1: 'c', itemType: 'VIRTUAL', price: '25.50' }],
} as any;

describe('Sipay config', () => {
  it('names the missing field', () => {
    expect(() => new Sipay({ ...BASE, appId: '', baseUrl: 'x' } as any)).toThrow(/appId/);
    expect(() => new Sipay({ ...BASE, appSecret: '', baseUrl: 'x' } as any)).toThrow(/appSecret/);
    expect(() => new Sipay({ ...BASE, merchantKey: '', baseUrl: 'x' } as any)).toThrow(/merchantKey/);
    expect(() => new Sipay({ ...BASE } as any)).toThrow(/baseUrl/);
    expect(() => new Sipay({ ...BASE, baseUrl: 'x', brand: 'acme' } as any)).toThrow(/brand/);
  });

  it('QnbPay pins the brand', () => {
    const q = new QnbPay({ ...BASE, baseUrl: 'https://test.qnbpay.com.tr' } as any);
    expect(q).toBeInstanceOf(Sipay);
    expect((q as any).brand).toBe('qnbpay');
    expect(() => new QnbPay({ ...BASE, appId: '' } as any)).toThrow(/QNBpay appId/);
  });
});

describe('Sipay hash_key', () => {
  // Fixed IV/salt so the vector is reproducible; decrypted below with a plain
  // Node implementation of Sipay's published algorithm.
  const VECTOR = 'fedcba9876543210:0f1e:58ubzATlgTdURLngwxSSkSlATUzpZsJjJVldCCYVvT0=';

  it('matches the pinned vector', () => {
    expect(sealSipayHashKey(['1', '25.50', 'INV-42', 'VP123', 'TRY'], SECRET, 'fedcba9876543210', '0f1e')).toBe(VECTOR);
  });

  it('is readable by an independent implementation of the algorithm', () => {
    const [iv, salt, body] = VECTOR.replace(/__/g, '/').split(':');
    const sha1 = createHash('sha1').update(SECRET).digest('hex');
    const key = createHash('sha256').update(sha1 + salt).digest('hex').slice(0, 32);
    const d = createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
    expect(d.update(body, 'base64', 'utf8') + d.final('utf8')).toBe('1|25.50|INV-42|VP123|TRY');
  });

  it('round-trips, tolerates URL-encoding and "+"→" ", rejects a wrong secret without throwing', () => {
    const h = sealSipayHashKey(['a', 'b'], SECRET);
    expect(openSipayHashKey(h, SECRET)).toEqual(['a', 'b']);
    expect(openSipayHashKey(encodeURIComponent(h), SECRET)).toEqual(['a', 'b']);
    expect(openSipayHashKey(h.replace(/\+/g, ' '), SECRET)).toEqual(['a', 'b']);
    expect(openSipayHashKey(h, 'other-secret')).toBeUndefined();
    expect(openSipayHashKey('garbage', SECRET)).toBeUndefined();
    expect(openSipayHashKey('0123456789abcdef:aa:!!!', SECRET)).toBeUndefined();
    expect(openSipayHashKey(undefined, SECRET)).toBeUndefined();
  });
});

describe('verifySipay3DCallback', () => {
  it('accepts authentic callbacks, including declined ones', () => {
    expect(verifySipay3DCallback(callback(), SECRET)).toBe(true);
    expect(verifySipay3DCallback(callback({ status: '0' }), SECRET)).toBe(true);
  });

  it('rejects wrong secret, missing hash, and ids that differ from the signed ones', () => {
    expect(verifySipay3DCallback(callback(), 'wrong')).toBe(false);
    expect(verifySipay3DCallback({ ...callback(), hash_key: undefined }, SECRET)).toBe(false);
    expect(verifySipay3DCallback({ ...callback(), invoice_id: 'INV-OTHER' }, SECRET)).toBe(false);
    expect(verifySipay3DCallback({ ...callback(), invoice_id: undefined }, SECRET)).toBe(false);
    expect(verifySipay3DCallback({ ...callback(), order_id: 'VP999' }, SECRET)).toBe(false);
  });
});

describe('Sipay completeThreeDSPayment', () => {
  const paid = (post: any, extra: Record<string, unknown> = {}) =>
    route(post, { '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Completed', transaction_amount: 25.5, ...extra }) });

  it('succeeds only from the signed status', async () => {
    const { p, post } = make();
    paid(post);
    const ok = await p.completeThreeDSPayment(callback() as any);
    expect(ok.status).toBe(PaymentStatus.SUCCESS);
    expect(ok.paymentId).toBe('INV-42');

    // Tampered echo fields do not flip a signed decline.
    const declined = await p.completeThreeDSPayment(callback({ status: '0' }, { sipay_status: '1', status_code: '100', payment_status: '1' }) as any);
    expect(declined.status).toBe(PaymentStatus.FAILURE);
    expect(declined.paymentId).toBe('INV-42');
  });

  it('fails closed and carries no ids for a forged callback', async () => {
    const { p } = make();
    const forged = { ...callback(), hash_key: sealSipayHashKey(['1', '25.50', 'INV-42', 'VP123', 'TRY'], 'attacker') };
    const r = await p.completeThreeDSPayment(forged as any);
    expect(r).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH' });
    expect(r.paymentId).toBeUndefined();
    expect(r.conversationId).toBeUndefined();
  });

  it('a signed success the bank does not report as paid is not a success (unauthenticated CBC)', async () => {
    const { p, post } = make();
    paid(post, { transaction_status: 'Failed' });
    expect(await p.completeThreeDSPayment(callback() as any)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'NOT_CONFIRMED' });
    paid(post, { transaction_amount: 1 });
    expect(await p.completeThreeDSPayment({ ...callback(), amount: '25.50' } as any)).toMatchObject({ errorCode: 'NOT_CONFIRMED' });
  });

  it('a payment still settling at Sipay stays PENDING, not failed', async () => {
    const { p, post } = make();
    paid(post, { transaction_status: 'Pending' });
    expect(await p.completeThreeDSPayment(callback() as any)).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'INV-42' });
  });

  it('no answer from the status check is PENDING with the invoice id', async () => {
    const { p, post } = make();
    route(post, { '/ccpayment/api/checkstatus': () => { throw networkError(); } });
    expect(await p.completeThreeDSPayment(callback() as any)).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'INV-42' });
  });

  it('binds the order id and amount from the merchant record', async () => {
    const { p, post } = make();
    paid(post);
    expect((await p.completeThreeDSPayment({ ...callback(), orderId: 'INV-42', amount: '25.5' } as any)).status).toBe(PaymentStatus.SUCCESS);
    expect((await p.completeThreeDSPayment({ ...callback(), orderId: 'INV-43' } as any)).errorCode).toBe('ORDER_MISMATCH');
    const cheap = await p.completeThreeDSPayment({ ...callback({ total: '1.00' }), amount: '25.50' } as any);
    expect(cheap).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'AMOUNT_MISMATCH' });
    // A signed decline keeps the bank's code even when the amount differs.
    const declined = await p.completeThreeDSPayment({ ...callback({ status: '0', total: '1.00' }), amount: '25.50' } as any);
    expect(declined).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });
  });
});

describe('Sipay payments', () => {
  it('createPayment sends a decryptable request hash and maps approval', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, {
      '/ccpayment/api/paySmart2D': (body) => {
        sent = body;
        return { status_code: 100, data: { payment_status: 1, invoice_id: 'INV-42' } };
      },
    });
    const r = await p.createPayment(paymentRequest);
    expect(r).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'INV-42' });
    expect(openSipayHashKey(sent.hash_key, SECRET)).toEqual(['25.50', '1', 'TRY', 'mk-1', 'INV-42']);
    expect(sent).toMatchObject({ transaction_type: 'Auth', cc_no: '4508034508034509', expiry_month: '01', expiry_year: '2030' });
    expect(post.mock.calls[1][2].headers.Authorization).toBe('Bearer tok');
  });

  it('capture:false sends a pre-authorization', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, { '/ccpayment/api/paySmart2D': (b) => ((sent = b), { status_code: 100, data: { payment_status: 1 } }) });
    await p.createPayment({ ...paymentRequest, capture: false });
    expect(sent.transaction_type).toBe('PreAuth');
  });

  it('reuses the cached token and renews it once on 101 unauthenticated', async () => {
    const { p, post } = make();
    let tokens = 0;
    let calls = 0;
    route(post, {
      '/ccpayment/api/token': () => ({ status_code: 100, data: { token: `tok${++tokens}` } }),
      '/ccpayment/api/checkstatus': () =>
        ++calls === 2 ? { status_code: 101, status_description: 'Unauthenticated.' } : { status_code: 100, transaction_status: 'Completed' },
    });
    await p.getPayment('A');
    expect(tokens).toBe(1);
    const r = await p.getPayment('B');
    expect(r.status).toBe(PaymentStatus.SUCCESS);
    expect(tokens).toBe(2);
  });

  it('decline → FAILURE with the bank code; no response → PENDING/NETWORK_ERROR', async () => {
    const { p, post } = make();
    route(post, {
      '/ccpayment/api/paySmart2D': () => ({ status_code: 41, data: { payment_status: 0, original_bank_error_code: '51', original_bank_error_description: 'Limit yetersiz' } }),
    });
    expect(await p.createPayment(paymentRequest)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });

    route(post, { '/ccpayment/api/paySmart2D': () => { throw networkError(); } });
    const lost = await p.createPayment(paymentRequest);
    expect(lost).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'INV-42' });
    expect(lost.rawResponse).toBeUndefined();
  });

  it('token failure is a FAILURE (nothing was sent)', async () => {
    const { p, post } = make();
    route(post, { '/ccpayment/api/token': () => { throw networkError(); } });
    expect(await p.createPayment(paymentRequest)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'TOKEN_ERROR' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('initThreeDSPayment returns the 3D page, or FAILURE for an error form', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, { '/ccpayment/api/paySmart3D': (b) => ((sent = b), '<form action="https://acs"><input type="hidden" name="invoice_id" value="INV-42"></form>') });
    const ok = await p.initThreeDSPayment(paymentRequest);
    expect(ok).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'INV-42' });
    expect(ok.threeDSHtmlContent).toContain('https://acs');
    expect(sent).toMatchObject({ return_url: 'https://merchant.test/cb', cancel_url: 'https://merchant.test/cb' });

    route(post, {
      '/ccpayment/api/paySmart3D': () =>
        '<form><input type="hidden" name="sipay_status" value="0"><input type="hidden" name="status_code" value="68"><input type="hidden" name="status_description" value="Invalid hash key"></form>',
    });
    expect(await p.initThreeDSPayment(paymentRequest)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '68' });

    route(post, { '/ccpayment/api/paySmart3D': () => '' });
    expect((await p.initThreeDSPayment(paymentRequest)).status).toBe(PaymentStatus.FAILURE);
  });
});

describe('Sipay refund / cancel / getPayment', () => {
  it('refund success, decline and lost response', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, { '/ccpayment/api/refund': (b) => ((sent = b), { status_code: 100, ref_no: 'R1' }) });
    const req = { paymentId: 'INV-42', price: '10', currency: 'TRY', ip: '1.2.3.4' };
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'R1' });
    expect(openSipayHashKey(sent.hash_key, SECRET)).toEqual(['10.00', 'INV-42', 'mk-1']);

    route(post, { '/ccpayment/api/refund': () => ({ status_code: 49, status_description: 'Refund failed' }) });
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '49' });

    route(post, { '/ccpayment/api/refund': () => { throw networkError(); } });
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('cancel refunds what is left of a completed sale', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Partial Refund', transaction_amount: 10, total_refunded_amount: 3 }),
      '/ccpayment/api/refund': (b) => ((sent = b), { status_code: 100 }),
    });
    expect((await p.cancel({ paymentId: 'INV-42', ip: '1' })).status).toBe(PaymentStatus.SUCCESS);
    expect(sent.amount).toBe('7.00');
  });

  it('cancel/void: lost response on the money call → PENDING/NETWORK_ERROR', async () => {
    const { p, post } = make();
    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Completed', transaction_amount: 10 }),
      '/ccpayment/api/refund': () => { throw networkError(); },
    });
    expect(await p.cancel({ paymentId: 'INV-42', ip: '1' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });

    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Pre-Authorization', transaction_amount: 10 }),
      '/ccpayment/api/confirmPayment': () => { throw networkError(); },
    });
    expect(await p.voidAuthorization({ paymentId: 'INV-42' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('cancel rejects a refunded payment; a failed status lookup is FAILURE not PENDING', async () => {
    const { p, post } = make();
    route(post, { '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Refunded', transaction_amount: 10, total_refunded_amount: 10 }) });
    expect(await p.cancel({ paymentId: 'INV-42', ip: '1' })).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'NOT_CANCELLABLE' });

    route(post, { '/ccpayment/api/checkstatus': () => { throw networkError(); } });
    expect((await p.cancel({ paymentId: 'INV-42', ip: '1' })).status).toBe(PaymentStatus.FAILURE);
  });

  it('getPayment maps checkstatus', async () => {
    const { p, post } = make();
    route(post, { '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Completed' }) });
    expect(await p.getPayment('INV-42')).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'INV-42' });
    route(post, { '/ccpayment/api/checkstatus': () => ({ status_code: 32, transaction_status: 'Failed', status_description: 'Geçersiz fatura kimliği' }) });
    expect(await p.getPayment('X')).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '32' });
  });
});

describe('Sipay pre-auth capture / void', () => {
  it('captures part of a pre-auth with a signed confirm', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, { '/ccpayment/api/confirmPayment': (b) => ((sent = b), { status_code: 100 }) });
    const r = await p.capturePayment({ paymentId: 'INV-42', amountMinor: 800, currency: 'TRY' });
    expect(r).toMatchObject({ status: PaymentStatus.SUCCESS, capturedAmountMinor: 800, currency: 'TRY' });
    expect(sent).toMatchObject({ status: 1, total: 8 });
    expect(openSipayHashKey(sent.hash_key, SECRET)).toEqual(['mk-1', 'INV-42', '1']);
  });

  it('captures the full authorized amount when no amount is given; lost response → PENDING', async () => {
    const { p, post } = make();
    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Pre-Authorization', transaction_amount: 25.5 }),
      '/ccpayment/api/confirmPayment': () => ({ status_code: 100 }),
    });
    expect(await p.capturePayment({ paymentId: 'INV-42' })).toMatchObject({ capturedAmountMinor: 2550 });

    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Pre-Authorization', transaction_amount: 25.5 }),
      '/ccpayment/api/confirmPayment': () => { throw networkError(); },
    });
    expect(await p.capturePayment({ paymentId: 'INV-42' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('voids only an open pre-auth', async () => {
    const { p, post } = make();
    let sent: any;
    route(post, {
      '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Pre-Authorization', transaction_amount: 10 }),
      '/ccpayment/api/confirmPayment': (b) => ((sent = b), { status_code: 100 }),
    });
    expect((await p.voidAuthorization({ paymentId: 'INV-42' })).status).toBe(PaymentStatus.SUCCESS);
    expect(sent.status).toBe(2);

    route(post, { '/ccpayment/api/checkstatus': () => ({ status_code: 100, transaction_status: 'Completed', transaction_amount: 10 }) });
    expect(await p.voidAuthorization({ paymentId: 'INV-42' })).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'NOT_VOIDABLE' });
  });
});

describe('Sipay getpos', () => {
  const POS = {
    status_code: 100,
    data: [
      { installments_number: 3, card_type: 'CREDIT CARD', card_program: 'MAXIMUM', card_scheme: 'mastercard', is_commercial: 'false', amount_to_be_paid: '103.00', card_bank: 'Isbank', bank_code: '64' },
      { installments_number: 1, card_type: 'CREDIT CARD', card_program: 'MAXIMUM', card_scheme: 'mastercard', is_commercial: 'false', amount_to_be_paid: '100.00', card_bank: 'Isbank', bank_code: '64' },
    ],
  };

  it('normalizes binCheck and installmentInfo', async () => {
    const { p, post } = make();
    route(post, { '/ccpayment/api/getpos': () => POS });
    expect(await p.binCheck('540667')).toMatchObject({ cardAssociation: 'MASTERCARD', cardFamily: 'MAXIMUM', bankCode: 64, commercial: false });
    const info = await p.installmentInfo({ binNumber: '540667', price: '100' });
    expect(info.status).toBe(PaymentStatus.SUCCESS);
    expect(info.installmentDetails![0].installmentPrices).toEqual([
      { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
      { installmentNumber: 3, totalPrice: 103, installmentPrice: 34.33 },
    ]);
  });

  it('rejects a malformed BIN', async () => {
    const { p } = make();
    await expect(p.binCheck('12')).rejects.toThrow(/binNumber/);
    expect((await p.installmentInfo({ binNumber: '12', price: '1' })).status).toBe(PaymentStatus.FAILURE);
  });
});
