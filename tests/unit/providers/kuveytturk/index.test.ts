import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { KuveytTurk } from '../../../../src/providers/kuveytturk';
import {
  signKuveytTurk,
  kuveytTurkHashPassword,
  formatKuveytTurkAmount,
  splitKuveytTurkPhone,
  readKuveytTurkFormFields,
} from '../../../../src/providers/kuveytturk/utils';
import { PaymentStatus } from '../../../../src/types';

const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services',
  merchantId: '12345',
  customerId: '67890',
  username: 'apiuser',
  password: 'secret123',
};

const request = {
  conversationId: 'ORDER3D',
  price: '1.20',
  paidPrice: '1.20',
  currency: 'TRY',
  basketId: 'B1',
  callbackUrl: 'https://shop.test/kt/callback',
  paymentCard: { cardHolderName: 'Ali Veli', cardNumber: '5188 9619 3919 2544', expireMonth: '6', expireYear: '2029', cvc: '929' },
  buyer: {
    id: 'U1', name: 'Ali', surname: 'Veli', email: 'ali@example.com', identityNumber: '11111111111',
    registrationAddress: 'x', city: 'Istanbul', country: 'Turkey', ip: '85.34.78.112', gsmNumber: '+90 535 000 00 00',
  },
  shippingAddress: { contactName: 'Ali', city: 'Istanbul', country: 'Turkey', address: 'x' },
  billingAddress: { contactName: 'Ali', city: 'Istanbul', country: 'Turkey', address: 'x' },
  basketItems: [],
} as any;

const callback = {
  Success: 'True',
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  MD: 'md+/=',
  OrderId: '334210503',
  MerchantOrderId: 'ORDER3D',
};

const tx = (over: Record<string, unknown> = {}) => ({
  OrderId: 334210503,
  MerchantOrderId: 'ORDER3D',
  TransactionStatus: 'Başarılı (1)',
  FirstAmount: 120,
  CancelAmount: 0,
  DrawbackAmount: 0,
  ...over,
});
const ok = (over: Record<string, unknown> = {}) => ({ data: { Success: true, ResponseCode: 'Successfull', BusinessKey: 'BK1', ...over } });
const txList = (...rows: Record<string, unknown>[]) => ok({ Result: { Transactions: rows } });
const noAnswer = () => Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true });

describe('Kuveyt Türk utils', () => {
  // Cross-checked against the reference implementation's vectors (whose
  // signatures were accepted by the KT Pay Gate test host) — not bank-doc vectors.
  it('hashes the password as base64(SHA1(utf8))', () => {
    expect(kuveytTurkHashPassword('secret123')).toBe('8rFPaOuZX6yzocNSh7d41b14VRE=');
    expect(kuveytTurkHashPassword('şifreĞü')).toBe('9S86Z+hsqFqyJIMxH5M5Ad8Yw4c=');
  });

  it('signs Payment / Provision / SaleReversal / GetTransactions', () => {
    const s = (...f: string[]) => signKuveytTurk(['12345', ...f, 'apiuser'], 'secret123');
    expect(s('ORDER-1001', '10265', 'https://shop.test/ok', 'https://shop.test/fail')).toBe(
      'i9V7jBEhV7XYid0Qf7X9ApZXb6klrUlF+cy88TrBG9rsBuxaKmKqw1wGVohS4BHqEBuWCc1G8C7nR0ZsuT7pkQ==',
    );
    expect(s('ORDER-1001', '10265')).toBe(
      '2v6YPkkDQwcqtbDi/HX0NhqLhLrTzAQSSBohxubY2uhggHBhL21jNbyjJs+ze+59cwR+d8qCn+gdF2BTfcyJlg==',
    );
    expect(s('ORDER-1001', '0')).toBe(
      '34HOIOjh36XJo/pRPiIGFMa8MC6F1AANxus3SC3F6G5icEibuwkcOvN2sBzQ2FFjGRu64KvrR1AqaL6N5jhjBg==',
    );
    expect(s('ORDER-1001')).toBe(
      '96DoN27bamxnJhs+EKsss7Y4hRzQ2M2tpUM+udeTHHV32ZCk6cvPtYnPrH5uO7SkwlQQUl8rNFnfAjOzXUxVkg==',
    );
  });

  it('formats amount, phone and form fields', () => {
    expect(formatKuveytTurkAmount('102.65')).toBe('10265');
    expect(formatKuveytTurkAmount('1')).toBe('100');
    expect(splitKuveytTurkPhone('05350000000')).toEqual({ cc: '90', subscriber: '5350000000' });
    expect(() => splitKuveytTurkPhone('+44 20 7946 0000')).toThrow(/Turkish/);
    expect(readKuveytTurkFormFields('<input type="hidden" name="ResponseMessage" value="A &amp; B &#305;" />')).toEqual({
      ResponseMessage: 'A & B ı',
    });
  });
});

describe('Kuveyt Türk provider', () => {
  let kt: KuveytTurk;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kt = new KuveytTurk(cfg);
    post = vi.fn();
    (kt as any).client.post = post;
  });

  it('requires every credential', () => {
    for (const key of ['merchantId', 'customerId', 'username', 'password']) {
      expect(() => new KuveytTurk({ ...cfg, [key]: '' })).toThrow(new RegExp(key));
    }
  });

  it('createPayment is a FAILURE without contacting the bank', async () => {
    const res = await kt.createPayment(request);
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'NOT_SUPPORTED' });
    expect(post).not.toHaveBeenCalled();
  });

  describe('initThreeDSPayment', () => {
    it('sends a signed Payment and returns the bank page', async () => {
      post.mockResolvedValue({ data: '<html><form><input name="PaReq" value="x"></form></html>' });
      const res = await kt.initThreeDSPayment(request);
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'ORDER3D', conversationId: 'ORDER3D' });
      expect(res.threeDSHtmlContent).toContain('PaReq');

      const [path, body] = post.mock.calls[0];
      expect(path).toBe('/KTPay/Payment');
      expect(body).toMatchObject({
        merchantOrderId: 'ORDER3D',
        amount: '120',
        currency: '0949',
        installmentCount: 1,
        paymentType: 1,
        customer: { cc: '90', subscriber: '5350000000', ipAddress: '85.34.78.112' },
        card: { cardNumber: '5188961939192544', expireMonth: '06', expireYear: '29', securityCode: '929' },
      });
      expect(body.hashData).toBe(
        signKuveytTurk(['12345', 'ORDER3D', '120', request.callbackUrl, request.callbackUrl, 'apiuser'], 'secret123'),
      );
    });

    it('maps the Success=False auto-post to FAILURE', async () => {
      post.mockResolvedValue({
        data: '<form><input type="hidden" name="Success" value="False" /><input type="hidden" name="ResponseCode" value="HashDataError" /></form>',
      });
      const res = await kt.initThreeDSPayment(request);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'HashDataError' });
      expect(res.paymentId).toBeUndefined();
    });

    it('never returns a 4xx page or JSON error envelope as the 3D page', async () => {
      post.mockResolvedValueOnce({ status: 400, data: '{"Success":false,"ResponseCode":"RequestValidationError"}' });
      expect(await kt.initThreeDSPayment(request)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'RequestValidationError' });
      post.mockResolvedValueOnce({ status: 404, data: '<html>Not Found</html>' });
      const res = await kt.initThreeDSPayment(request);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'HTTP_404' });
      expect(res.threeDSHtmlContent).toBeUndefined();
    });

    it('rejects "&" in the callback URL and unsupported currencies locally', async () => {
      expect((await kt.initThreeDSPayment({ ...request, callbackUrl: 'https://s.test/cb?a=1&b=2' })).status).toBe(
        PaymentStatus.FAILURE,
      );
      expect((await kt.initThreeDSPayment({ ...request, currency: 'GBP' })).status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('completeThreeDSPayment', () => {
    it('confirms at the bank, then provisions the bank-recorded amount', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok());
      const res = await kt.completeThreeDSPayment({ ...callback, orderId: 'ORDER3D', amount: '1.20' });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER3D' });

      expect(post.mock.calls[0][0]).toBe('/KTPay/GetTransactions');
      const [path, body] = post.mock.calls[1];
      expect(path).toBe('/KTPay/Provision');
      expect(body).toMatchObject({ merchantOrderId: 'ORDER3D', orderId: '334210503', amount: '120', md: 'md+/=' });
      expect(body.hashData).toBe(signKuveytTurk(['12345', 'ORDER3D', '120', 'apiuser'], 'secret123'));
    });

    it('fails without contacting the bank when Success is not True', async () => {
      const res = await kt.completeThreeDSPayment({ ...callback, Success: 'False', ResponseCode: 'MD_FAIL' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'MD_FAIL' });
      expect(res.paymentId).toBeUndefined();
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a callback for a different stored order (orderId vs MerchantOrderId)', async () => {
      const res = await kt.completeThreeDSPayment({ ...callback, orderId: 'OTHER' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'ORDER_MISMATCH' });
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a forged bank OrderId that the bank does not know', async () => {
      post.mockResolvedValueOnce(txList(tx({ OrderId: 999 })));
      const res = await kt.completeThreeDSPayment(callback);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_CALLBACK' });
      expect(res.paymentId).toBeUndefined();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('ignores rows for another merchant order', async () => {
      post.mockResolvedValueOnce(txList(tx({ MerchantOrderId: 'SOMEONE-ELSE' })));
      expect((await kt.completeThreeDSPayment(callback)).errorCode).toBe('INVALID_CALLBACK');
    });

    it('rejects when the bank-recorded amount differs from the stored amount', async () => {
      post.mockResolvedValueOnce(txList(tx({ FirstAmount: 100 })));
      const res = await kt.completeThreeDSPayment({ ...callback, amount: '1.20' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'AMOUNT_MISMATCH' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('maps a declined Provision to FAILURE without ids', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok({ Success: false, ResponseCode: '51' }));
      const res = await kt.completeThreeDSPayment(callback);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });
      expect(res.paymentId).toBeUndefined();
    });

    it('returns PENDING/NETWORK_ERROR when Provision gets no answer', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockRejectedValueOnce(noAnswer());
      const res = await kt.completeThreeDSPayment(callback);
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'ORDER3D' });
    });

    it('PENDING survives the real axios stack (interceptors + transport error)', async () => {
      const real = new KuveytTurk({ ...cfg, logger: { debug() {}, info() {}, warn() {}, error() {} } as any });
      let call = 0;
      (real as any).client.defaults.adapter = async (config: any) => {
        if (call++ === 0) return { data: txList(tx()).data, status: 200, statusText: 'OK', headers: {}, config };
        throw new AxiosError('socket hang up', 'ECONNRESET', config);
      };
      expect(await real.completeThreeDSPayment(callback)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    });

    it('is a plain FAILURE when the lookup (before any charge) gets no answer', async () => {
      post.mockRejectedValueOnce(noAnswer());
      const res = await kt.completeThreeDSPayment(callback);
      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(res.paymentId).toBeUndefined();
    });
  });

  describe('refund / cancel', () => {
    it('refunds the full amount as Drawback (amount signed as 0)', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok({ BusinessKey: 'R1' }));
      const res = await kt.refund({ paymentId: 'ORDER3D', price: '1.20', currency: 'TRY', ip: '1.1.1.1' });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'R1' });
      const body = post.mock.calls[1][1];
      expect(body).toMatchObject({ saleReversalType: 'Drawback', amount: '120', orderId: '334210503' });
      expect(body.hashData).toBe(signKuveytTurk(['12345', 'ORDER3D', '0', 'apiuser'], 'secret123'));
    });

    it('refunds less as PartialDrawback (amount signed)', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok());
      await kt.refund({ paymentId: 'ORDER3D', price: '0.50', currency: 'TRY', ip: '1.1.1.1' });
      const body = post.mock.calls[1][1];
      expect(body).toMatchObject({ saleReversalType: 'PartialDrawback', amount: '50' });
      expect(body.hashData).toBe(signKuveytTurk(['12345', 'ORDER3D', '50', 'apiuser'], 'secret123'));
    });

    it('fails a refund for an unknown order without a reversal call', async () => {
      post.mockResolvedValueOnce(txList());
      const res = await kt.refund({ paymentId: 'NOPE', price: '1.20', currency: 'TRY', ip: '1.1.1.1' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'ORDER_NOT_FOUND' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('refund with no answer from SaleReversal is PENDING/NETWORK_ERROR', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockRejectedValueOnce(noAnswer());
      const res = await kt.refund({ paymentId: 'ORDER3D', price: '1.20', currency: 'TRY', ip: '1.1.1.1' });
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    });

    it('cancels the whole sale', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok({ BusinessKey: 'C1' }));
      const res = await kt.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, voidId: 'C1' });
      expect(post.mock.calls[1][1]).toMatchObject({ saleReversalType: 'Cancel', amount: '120' });
    });

    it('maps a declined cancel to FAILURE', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockResolvedValueOnce(ok({ Success: false, ResponseCode: 'InvalidTransaction' }));
      expect(await kt.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' })).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: 'InvalidTransaction',
      });
    });

    it('cancel with no answer from SaleReversal is PENDING/NETWORK_ERROR', async () => {
      post.mockResolvedValueOnce(txList(tx())).mockRejectedValueOnce(noAnswer());
      expect((await kt.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' })).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('getPayment', () => {
    it.each([
      [tx(), PaymentStatus.SUCCESS],
      [tx({ CancelAmount: 120 }), PaymentStatus.CANCELLED],
      [tx({ TransactionStatus: 'Başarısız (2)', ResponseCode: '51' }), PaymentStatus.FAILURE],
    ])('maps %o', async (row, status) => {
      post.mockResolvedValueOnce(txList(row));
      expect((await kt.getPayment('ORDER3D')).status).toBe(status);
    });

    it('is PENDING when the bank has no row, FAILURE when the call errors', async () => {
      post.mockResolvedValueOnce(txList());
      expect((await kt.getPayment('ORDER3D')).status).toBe(PaymentStatus.PENDING);
      post.mockResolvedValueOnce(ok({ Success: false, ResponseCode: 'HashDataError' }));
      expect(await kt.getPayment('ORDER3D')).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'HashDataError' });
    });
  });
});
