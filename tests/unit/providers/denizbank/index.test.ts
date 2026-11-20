import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import { createHash } from 'crypto';
import { Denizbank, verifyDenizbank3DCallback } from '../../../../src/providers/denizbank';
import { denizbankFormHash, parseDenizbankResponse } from '../../../../src/providers/denizbank/utils';
import { PaymentStatus } from '../../../../src/types';

const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://test.inter-vpos.com.tr',
  shopCode: 'SHOP77',
  userCode: 'apiuser',
  userPass: 'API-SECRET-PW',
  merchantPass: 'DNZKEY',
};

// HASH computed independently: python base64(sha1('ORD-42SHOP77250.009491MD-TOKEN-1' + 'DNZKEY'))
const CALLBACK = {
  OrderId: 'ORD-42',
  ShopCode: 'SHOP77',
  PurchAmount: '250.00',
  Currency: '949',
  '3DStatus': '1',
  MD: 'MD-TOKEN-1',
  PayerTxnId: 'XID=',
  Eci: '05',
  PayerAuthenticationCode: 'CAVV=',
  InstallmentCount: '',
  HASHPARAMS: 'OrderId:ShopCode:PurchAmount:Currency:3DStatus:MD:',
  HASHPARAMSVAL: 'ORD-42SHOP77250.009491MD-TOKEN-1',
  HASH: 'SN7JrOV/xySZ++DXyON60bplk2E=',
};

const answer = (f: Record<string, string>) =>
  Object.entries(f)
    .map(([k, v]) => `${k}=${v}`)
    .join(';;') + ';;';
const APPROVED = answer({ ProcReturnCode: '00', OrderId: 'ORD-42', AuthCode: '123456', TransId: 'T-1', ErrorMessage: '' });
const DECLINED = answer({ ProcReturnCode: '51', ErrorMessage: 'Yetersiz bakiye' });

const card = { cardHolderName: 'A B', cardNumber: '5528 7900 0000 0008', expireMonth: '1', expireYear: '2030', cvc: '123' };
const payReq = { price: '250', paidPrice: '250.00', currency: 'TRY', conversationId: 'ORD-42', paymentCard: card } as any;

function setup(reply?: () => Promise<unknown>) {
  const p = new Denizbank(cfg);
  const post = vi.spyOn((p as any).client, 'post');
  if (reply) post.mockImplementation(reply as any);
  return { p, post };
}
const ok = (body: string) => () => Promise.resolve({ data: body });
const noResponse = () => Promise.reject(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));
const body = (post: any, call = 0) => new URLSearchParams(post.mock.calls[call][1]);

describe('Denizbank config', () => {
  it.each(['shopCode', 'userCode', 'userPass', 'merchantPass', 'baseUrl'])('requires %s', (k) => {
    expect(() => new Denizbank({ ...cfg, [k]: '' })).toThrow(new RegExp(k));
  });
});

describe('Denizbank utils', () => {
  it('form hash matches an independently computed vector', () => {
    expect(
      denizbankFormHash({
        shopCode: 'SHOP77',
        orderId: 'ORD-42',
        amount: '250.00',
        okUrl: 'https://shop.test/cb?a=1&b=2',
        failUrl: 'https://shop.test/cb?a=1&b=2',
        txnType: 'Auth',
        installment: '3',
        rnd: 'r4nd0m',
        merchantPass: 'DNZKEY',
      }),
    ).toBe('CaDubps+Ti81v+l2LroO/VFOMyM=');
  });

  it('parses Key=Value;; answers and rejects anything else', () => {
    expect(parseDenizbankResponse('ProcReturnCode=96;;ErrorMessage=Hata;;;TRXDATE=01.01.0001 00:00:00;;')).toMatchObject({
      ProcReturnCode: '96',
      ErrorMessage: 'Hata',
      TRXDATE: '01.01.0001 00:00:00',
    });
    expect(() => parseDenizbankResponse('<html/>')).toThrow(/unexpected/);
  });
});

describe('verifyDenizbank3DCallback', () => {
  it('accepts the signed callback', () => {
    expect(verifyDenizbank3DCallback(CALLBACK, 'DNZKEY')).toBe(true);
  });
  it('rejects a wrong key, a tampered field, a missing HASH', () => {
    expect(verifyDenizbank3DCallback(CALLBACK, 'other')).toBe(false);
    expect(verifyDenizbank3DCallback({ ...CALLBACK, '3DStatus': '0', HASHPARAMSVAL: undefined }, 'DNZKEY')).toBe(false);
    expect(verifyDenizbank3DCallback({ ...CALLBACK, HASH: undefined }, 'DNZKEY')).toBe(false);
  });
  it('rebuilds the value itself instead of trusting HASHPARAMSVAL', () => {
    expect(verifyDenizbank3DCallback({ ...CALLBACK, OrderId: 'ORD-43' }, 'DNZKEY')).toBe(false);
  });
  it('requires the signed list to cover OrderId, 3DStatus and MD', () => {
    expect(verifyDenizbank3DCallback({ ...CALLBACK, HASHPARAMS: 'OrderId:ShopCode:PurchAmount:Currency:3DStatus' }, 'DNZKEY')).toBe(false);
  });
  it('rejects an empty OrderId even when the list names it', () => {
    // joined value without OrderId, signed independently with the same key
    const value = 'SHOP77250.009491MD-TOKEN-1';
    const cb = { ...CALLBACK, OrderId: '', HASHPARAMSVAL: value, HASH: createHash('sha1').update(value + 'DNZKEY').digest('base64') };
    expect(verifyDenizbank3DCallback(cb, 'DNZKEY')).toBe(false);
  });
  it('rejects non-string values (duplicated form fields)', () => {
    expect(verifyDenizbank3DCallback({ ...CALLBACK, MD: ['MD-TOKEN-1', 'x'] }, 'DNZKEY')).toBe(false);
  });
});

describe('Denizbank createPayment', () => {
  it('sends a NonSecure Auth and maps 00 to success', async () => {
    const { p, post } = setup(ok(APPROVED));
    const res = await p.createPayment({ ...payReq, installment: 3 });
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORD-42' });
    const b = body(post);
    expect(post.mock.calls[0][0]).toBe('/mpi/Default.aspx');
    expect(Object.fromEntries(b)).toMatchObject({
      ShopCode: 'SHOP77',
      UserCode: 'apiuser',
      UserPass: 'API-SECRET-PW',
      TxnType: 'Auth',
      SecureType: 'NonSecure',
      PurchAmount: '250.00',
      Currency: '949',
      InstallmentCount: '3',
      CardType: 'mastercard',
      Pan: '5528790000000008',
      Expiry: '0130',
    });
  });
  it('maps a decline to failure with the bank code', async () => {
    const { p } = setup(ok(DECLINED));
    expect(await p.createPayment(payReq)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51', errorMessage: 'Yetersiz bakiye' });
  });
  it('no response → PENDING / NETWORK_ERROR (outcome unknown)', async () => {
    const { p } = setup(noResponse);
    const res = await p.createPayment(payReq);
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'ORD-42' });
    expect(JSON.stringify(res)).not.toContain('API-SECRET-PW');
  });
  it('HTTP error → FAILURE with only the response body', async () => {
    const { p } = setup(() =>
      Promise.reject(new AxiosError('500', 'ERR_BAD_RESPONSE', { headers: { x: 'API-SECRET-PW' } } as any, null, { status: 500, data: 'boom' } as any)),
    );
    const res = await p.createPayment(payReq);
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, rawResponse: 'boom' });
    expect(JSON.stringify(res)).not.toContain('API-SECRET-PW');
  });
});

describe('Denizbank initThreeDSPayment', () => {
  it('builds a signed, escaped form without the API password or store key', async () => {
    const { p } = setup();
    const url = 'https://shop.test/cb?a=1&b="x"';
    const res = await p.initThreeDSPayment({ ...payReq, callbackUrl: url });
    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(res.paymentId).toBe('ORD-42');
    const html = res.threeDSHtmlContent!;
    expect(html).toContain('action="https://test.inter-vpos.com.tr/mpi/Default.aspx"');
    expect(html).toContain('name="OkUrl" value="https://shop.test/cb?a=1&amp;b=&quot;x&quot;"');
    expect(html).toContain('name="SecureType" value="3DModel"');
    expect(html).not.toContain('API-SECRET-PW');
    expect(html).not.toContain('DNZKEY');
    // the hash is over the raw URL, not the escaped one
    const rnd = html.match(/name="Rnd" value="([^"]+)"/)![1];
    const hash = html.match(/name="Hash" value="([^"]+)"/)![1];
    expect(hash).toBe(
      denizbankFormHash({ shopCode: 'SHOP77', orderId: 'ORD-42', amount: '250.00', okUrl: url, failUrl: url, txnType: 'Auth', installment: '', rnd, merchantPass: 'DNZKEY' }),
    );
  });
  it('fails without a callbackUrl', async () => {
    const { p } = setup();
    expect((await p.initThreeDSPayment({ ...payReq, callbackUrl: '' })).status).toBe(PaymentStatus.FAILURE);
  });
});

describe('Denizbank completeThreeDSPayment', () => {
  const withRecord = { ...CALLBACK, amount: '250.00', orderId: 'ORD-42' };

  it('verifies, then charges Auth with the 3D data and the merchant amount', async () => {
    const { p, post } = setup(ok(APPROVED));
    const res = await p.completeThreeDSPayment(withRecord);
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORD-42', conversationId: 'ORD-42' });
    expect(Object.fromEntries(body(post))).toMatchObject({
      TxnType: 'Auth',
      OrderId: 'ORD-42',
      PurchAmount: '250.00',
      Currency: '949',
      MD: 'MD-TOKEN-1',
      PayerTxnId: 'XID=',
      Eci: '05',
      PayerAuthenticationCode: 'CAVV=',
    });
  });

  it("the merchant's installment count wins over the callback's", async () => {
    const { p, post } = setup(ok(APPROVED));
    await p.completeThreeDSPayment({ ...withRecord, installment: 1 } as any);
    expect(body(post).get('InstallmentCount')).toBe('');
  });

  it('forged callback → INVALID_HASH, no ids, no bank call', async () => {
    const { p, post } = setup(ok(APPROVED));
    const res = await p.completeThreeDSPayment({ ...withRecord, HASH: 'AAAA' });
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH' });
    expect(res.paymentId).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('wrong store key → INVALID_HASH', async () => {
    const p = new Denizbank({ ...cfg, merchantPass: 'other' });
    expect((await p.completeThreeDSPayment(withRecord)).errorCode).toBe('INVALID_HASH');
  });

  it('requires the merchant amount (callback echo is not trusted)', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect((await p.completeThreeDSPayment(CALLBACK)).errorCode).toBe('AMOUNT_REQUIRED');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a callback amount that differs from the order', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect((await p.completeThreeDSPayment({ ...withRecord, amount: '300.00' })).errorCode).toBe('AMOUNT_MISMATCH');
    expect((await p.completeThreeDSPayment({ ...withRecord, currency: 'USD' })).errorCode).toBe('CURRENCY_MISMATCH');
    expect((await p.completeThreeDSPayment({ ...withRecord, orderId: 'ORD-99' })).errorCode).toBe('ORDER_MISMATCH');
    expect(post).not.toHaveBeenCalled();
  });

  it('failed 3D authentication → failure without a charge', async () => {
    // 3DStatus 0 re-signed: python base64(sha1('ORD-42SHOP77250.009490MD-TOKEN-1DNZKEY'))
    const { p, post } = setup(ok(APPROVED));
    const res = await p.completeThreeDSPayment({
      ...withRecord,
      '3DStatus': '0',
      HASHPARAMSVAL: undefined,
      HASH: createHash('sha1').update('ORD-42SHOP77250.009490MD-TOKEN-1DNZKEY').digest('base64'),
    });
    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(post).not.toHaveBeenCalled();
  });

  it('bank decline → failure; no response → PENDING with ids', async () => {
    expect((await setup(ok(DECLINED)).p.completeThreeDSPayment(withRecord))).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });
    expect(await setup(noResponse).p.completeThreeDSPayment(withRecord)).toMatchObject({
      status: PaymentStatus.PENDING,
      errorCode: 'NETWORK_ERROR',
      paymentId: 'ORD-42',
    });
  });
});

describe('Denizbank refund / cancel / getPayment', () => {
  it('refund sends Refund with orgOrderId and amount', async () => {
    const { p, post } = setup(ok(APPROVED));
    const res = await p.refund({ paymentId: 'ORD-42', price: '50', currency: 'TRY', ip: '1.1.1.1' });
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'T-1' });
    expect(Object.fromEntries(body(post))).toMatchObject({ TxnType: 'Refund', orgOrderId: 'ORD-42', PurchAmount: '50.00', Currency: '949' });
  });
  it('refund decline / no response', async () => {
    expect(await setup(ok(DECLINED)).p.refund({ paymentId: 'X', price: '1', currency: 'TRY', ip: '' })).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });
    expect(await setup(noResponse).p.refund({ paymentId: 'X', price: '1', currency: 'TRY', ip: '' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });
  it('cancel sends Void', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect(await p.cancel({ paymentId: 'ORD-42', ip: '' })).toMatchObject({ status: PaymentStatus.SUCCESS, transactionId: 'T-1' });
    expect(Object.fromEntries(body(post))).toMatchObject({ TxnType: 'Void', orgOrderId: 'ORD-42' });
    expect(await setup(ok(DECLINED)).p.cancel({ paymentId: 'X', ip: '' })).toMatchObject({ status: PaymentStatus.FAILURE });
    expect(await setup(noResponse).p.cancel({ paymentId: 'X', ip: '' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });
  it('getPayment is not supported', async () => {
    await expect(setup().p.getPayment('ORD-42')).rejects.toThrow(/not supported/);
  });
});
