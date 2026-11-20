import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Albaraka, verifyAlbaraka3DCallback } from '../../../../src/providers/albaraka';
import { buildAlbarakaMac } from '../../../../src/providers/albaraka/utils';
import { PaymentStatus } from '../../../../src/types';

// Store values and the MAC vectors below are the public PosNet V1 test
// vectors (mews/pos test suite); each was re-derived with Python hashlib.
const KEY = '10,10,10,10,10,10,10,10';
const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://epostest.albarakaturk.com.tr',
  merchantId: '6700950031',
  terminalId: '67540050',
  posnetId: '1010272261352072',
  encKey: KEY,
} as any;

const signedCallback = {
  ECI: '02',
  CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
  MdStatus: '1',
  MdErrorMessage: 'Authenticated',
  MD: '0161010028947569644,0161010028947569644',
  SecureTransactionId: '1010028947569644',
  Mac: 'r21kMm4nMqvJakjq47Jl+3fk2xrFPrDoTJFQGxkgkfk=',
  MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
  OrderId: '123',
};
const order = { orderId: 'ORDER3D', amount: '120.50', currency: 'TRY' };
const ORDER_NO = '0000000000000ORDER3D';

const ok = (fields: Record<string, unknown> = {}) => ({
  ServiceResponseData: { ResponseCode: '00', ResponseDescription: 'APPROVED' },
  ReferenceCode: 'REF1',
  AuthCode: '123456',
  ...fields,
});
const declined = (code = '0148') => ({
  ServiceResponseData: { ResponseCode: code, ResponseDescription: 'UNAUTHORIZED REQUEST' },
  ReferenceCode: null,
});
const networkError = () => Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true });
const card = { cardHolderName: 'Ali Veli', cardNumber: '5400619360964581', expireMonth: '01', expireYear: '2020', cvc: '056' };

describe('Albaraka MAC + callback verification', () => {
  it('card MAC matches the reference vector', () => {
    expect(buildAlbarakaMac(['6700950031', '67540050', '5400619360964581', '056', '2001', 175], KEY)).toBe(
      'xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=',
    );
  });

  it('reference MAC (Return/Reverse, OrderId null) matches the reference vector', () => {
    expect(buildAlbarakaMac(['6700950031', '67540050', '021459486690000191', null], KEY)).toBe(
      'qhLo/2Ro+vT81i0SMV/VHifDV9VzQQgK+7d8hlId9YM=',
    );
  });

  it('accepts a genuine callback', () => {
    expect(verifyAlbaraka3DCallback(signedCallback, KEY)).toBe(true);
  });

  it('rejects a tampered field, a wrong key, a missing Mac', () => {
    expect(verifyAlbaraka3DCallback({ ...signedCallback, ECI: '' }, KEY)).toBe(false);
    expect(verifyAlbaraka3DCallback({ ...signedCallback, MdStatus: '2' }, KEY)).toBe(false);
    expect(verifyAlbaraka3DCallback(signedCallback, 'WRONG')).toBe(false);
    const { Mac: _m, ...noMac } = signedCallback;
    expect(verifyAlbaraka3DCallback(noMac, KEY)).toBe(false);
  });

  it('rejects a MacParams that leaves MdStatus unsigned, even with a correct Mac', () => {
    const params = 'ECI:CAVV:SecureTransactionId';
    const mac = buildAlbarakaMac([signedCallback.ECI, signedCallback.CAVV, signedCallback.SecureTransactionId], KEY);
    expect(verifyAlbaraka3DCallback({ ...signedCallback, MacParams: params, Mac: mac }, KEY)).toBe(false);
  });
});

describe('Albaraka provider', () => {
  let p: Albaraka;
  let post: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    p = new Albaraka(cfg);
    post = vi.spyOn((p as any).client, 'post') as any;
  });

  it('rejects missing required fields', () => {
    expect(() => new Albaraka({ ...cfg, merchantId: '' })).toThrow(/merchantId/);
    expect(() => new Albaraka({ ...cfg, terminalId: '' })).toThrow(/terminalId/);
    expect(() => new Albaraka({ ...cfg, posnetId: '' })).toThrow(/posnetId/);
    expect(() => new Albaraka({ ...cfg, encKey: '' })).toThrow(/encKey/);
  });

  describe('createPayment', () => {
    const req = { price: '1.75', paidPrice: '1.75', currency: 'TRY', conversationId: 'ORDER1', paymentCard: card } as any;

    it('sends a JSON Sale with the card MAC and returns the ReferenceCode', async () => {
      post.mockResolvedValueOnce({ data: ok() });
      const res = await p.createPayment(req);
      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Sale');
      expect(body).toMatchObject({
        MerchantNo: '6700950031',
        Amount: 175,
        CurrencyCode: 'TL',
        OrderId: '00000000000000ORDER1',
        InstallmentCount: 0,
        InstallmentType: 'N',
        MAC: 'xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=',
      });
      expect(JSON.stringify(body)).not.toContain(KEY);
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'REF1', conversationId: '00000000000000ORDER1' });
    });

    it('declined → FAILURE; no response → PENDING', async () => {
      post.mockResolvedValueOnce({ data: declined() });
      expect(await p.createPayment(req)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0148' });
      post.mockRejectedValueOnce(networkError());
      expect(await p.createPayment(req)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    });
  });

  it('initThreeDSPayment builds a signed, escaped form without calling the API', async () => {
    const res = await p.initThreeDSPayment({
      price: '1.75',
      paidPrice: '1.75',
      currency: 'TRY',
      conversationId: 'ORDER3D',
      callbackUrl: 'https://x/cb?a=1&b="2"',
      paymentCard: card,
    } as any);
    expect(post).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, paymentId: ORDER_NO });
    const html = res.threeDSHtmlContent!;
    expect(html).toContain('action="https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx"');
    expect(html).toContain('name="Mac" value="xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew="');
    expect(html).toContain('name="OrderId" value="0000000000000ORDER3D"');
    expect(html).toContain('value="https://x/cb?a=1&amp;b=&quot;2&quot;"');
  });

  describe('completeThreeDSPayment', () => {
    it('verifies the callback, then charges the record amount with the 3D data', async () => {
      post.mockResolvedValueOnce({ data: ok() });
      const res = await p.completeThreeDSPayment({ ...signedCallback, ...order });
      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Sale');
      expect(body).toMatchObject({
        Amount: 12050,
        OrderId: ORDER_NO,
        IsTDSecureMerchant: 'Y',
        ThreeDSecureData: { SecureTransactionId: '1010028947569644', CavvData: signedCallback.CAVV, Eci: '02', MdStatus: 1 },
        MAC: buildAlbarakaMac(['6700950031', '67540050', '1010028947569644', signedCallback.CAVV, '02', '1'], KEY),
      });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'REF1', conversationId: ORDER_NO });
    });

    it('tampered callback → FAILURE before MdStatus is read, no ids, no charge', async () => {
      const res = await p.completeThreeDSPayment({ ...signedCallback, CAVV: 'forged', ...order });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH' });
      expect(res.paymentId).toBeUndefined();
      expect(res.conversationId).toBeUndefined();
      expect(post).not.toHaveBeenCalled();
    });

    it('a duplicate key in another case cannot override a signed MdStatus', async () => {
      // Signed callback says mdstatus=0 (first key wins in the verifier); an extra MdStatus=1 is appended.
      const mac = buildAlbarakaMac(['02', signedCallback.CAVV, '0', signedCallback.SecureTransactionId], KEY);
      const forged = {
        ECI: '02',
        CAVV: signedCallback.CAVV,
        mdstatus: '0',
        SecureTransactionId: signedCallback.SecureTransactionId,
        MacParams: 'ECI:CAVV:MdStatus:SecureTransactionId',
        Mac: mac,
        MdStatus: '1',
      };
      expect(verifyAlbaraka3DCallback(forged, KEY)).toBe(true);
      const res = await p.completeThreeDSPayment({ ...forged, ...order });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'MD_STATUS_0' });
      expect(post).not.toHaveBeenCalled();
    });

    it('wrong encKey → FAILURE', async () => {
      const other = new Albaraka({ ...cfg, encKey: 'OTHER' });
      expect((await other.completeThreeDSPayment({ ...signedCallback, ...order })).errorCode).toBe('INVALID_HASH');
    });

    it('missing record values → FAILURE without charging', async () => {
      const res = await p.completeThreeDSPayment({ ...signedCallback });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'VALIDATION_ERROR' });
      expect(post).not.toHaveBeenCalled();
    });

    it('declined charge → FAILURE; no response → PENDING with the order number', async () => {
      post.mockResolvedValueOnce({ data: declined('0051') });
      expect(await p.completeThreeDSPayment({ ...signedCallback, ...order })).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: '0051',
      });
      post.mockRejectedValueOnce(networkError());
      expect(await p.completeThreeDSPayment({ ...signedCallback, ...order })).toMatchObject({
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        conversationId: ORDER_NO,
      });
    });
  });

  describe('refund / cancel', () => {
    it('refund sends Return with the ReferenceCode MAC', async () => {
      post.mockResolvedValueOnce({ data: ok({ ReferenceCode: 'REF2' }) });
      const res = await p.refund({ paymentId: '021459486690000191', price: '50.00', currency: 'TRY', ip: '' });
      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Return');
      expect(body).toMatchObject({
        ReferenceCode: '021459486690000191',
        OrderId: null,
        Amount: 5000,
        MAC: 'qhLo/2Ro+vT81i0SMV/VHifDV9VzQQgK+7d8hlId9YM=',
      });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'REF2' });
    });

    it('refund declined → FAILURE; no response → PENDING', async () => {
      post.mockResolvedValueOnce({ data: declined() });
      expect((await p.refund({ paymentId: 'R', price: '1', currency: 'TRY', ip: '' })).status).toBe(PaymentStatus.FAILURE);
      post.mockRejectedValueOnce(networkError());
      expect((await p.refund({ paymentId: 'R', price: '1', currency: 'TRY', ip: '' })).errorCode).toBe('NETWORK_ERROR');
    });

    it('cancel sends Reverse', async () => {
      post.mockResolvedValueOnce({ data: ok() });
      const res = await p.cancel({ paymentId: '021459486690000191', ip: '' });
      expect(post.mock.calls[0][0]).toBe('/ALBMerchantService/MerchantJSONAPI.svc/Reverse');
      expect(post.mock.calls[0][1]).toMatchObject({ TransactionType: 'Sale', MAC: 'qhLo/2Ro+vT81i0SMV/VHifDV9VzQQgK+7d8hlId9YM=' });
      expect(res.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancel declined → FAILURE; no response → PENDING', async () => {
      post.mockResolvedValueOnce({ data: declined() });
      expect((await p.cancel({ paymentId: 'R', ip: '' })).status).toBe(PaymentStatus.FAILURE);
      post.mockRejectedValueOnce(networkError());
      expect((await p.cancel({ paymentId: 'R', ip: '' })).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('getPayment', () => {
    it('queries the 3D order id first and maps a successful sale', async () => {
      post.mockResolvedValueOnce({
        data: ok({ TransactionData: [{ State: 'Sale', TxnStatus: '1', ReferenceCode: 'REF1' }] }),
      });
      const res = await p.getPayment('ORDER3D');
      expect(post.mock.calls[0][1]).toMatchObject({ OrderId: `TDS_${ORDER_NO}` });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'REF1', conversationId: ORDER_NO });
    });

    it('unrecognised TransactionData shape → PENDING', async () => {
      post.mockResolvedValueOnce({ data: ok({ TransactionData: { Something: 'else' } }) });
      expect((await p.getPayment('ORDER3D')).status).toBe(PaymentStatus.PENDING);
    });

    it('not found under either id → FAILURE', async () => {
      post.mockResolvedValue({ data: declined('E219') });
      const res = await p.getPayment('ORDER3D');
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toMatchObject({ OrderId: ORDER_NO.padStart(24, '0') });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'E219' });
    });
  });
});
