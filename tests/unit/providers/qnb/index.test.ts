import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import { Qnb, verifyQnb3DCallback } from '../../../../src/providers/qnb';
import { qnbFormHash, parseQnbXml, buildQnbXml, mapQnbInquiry } from '../../../../src/providers/qnb/utils';
import { PaymentStatus } from '../../../../src/types';

const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://vpostest.qnb.com.tr',
  merchantId: 'MID100',
  userCode: 'QUSER',
  userPass: 'API-SECRET-PW',
  merchantPass: 'QPASS',
};

// ResponseHash values computed independently with python hashlib:
// base64(sha1(MerchantID + MerchantPass + OrderId + AuthCode + ProcReturnCode + 3DStatus + ResponseRnd + UserCode))
const MODEL_CB = {
  OrderId: 'QORD-7',
  MerchantID: 'MID100',
  SecureType: '3DModel',
  '3DStatus': '1',
  RequestGuid: 'GUID-1',
  PurchAmount: '99.90',
  Currency: '949',
  ProcReturnCode: 'V033',
  AuthCode: '',
  ResponseRnd: 'RR-1',
  ResponseHash: 'a+7RvRiFpRz5nUdTzFdxYswnwrw=',
};
const PAY_CB = {
  OrderId: 'QORD-7',
  MerchantID: 'MID100',
  SecureType: '3DPay',
  '3DStatus': '1',
  PurchAmount: '99.90',
  Currency: '949',
  ProcReturnCode: '00',
  AuthCode: 'A1B2C3',
  ResponseRnd: 'RR-2',
  ResponseHash: 'fTLMmsil6+EBhuxUpSjnvtn52hM=',
};

const xml = (f: Record<string, string>) =>
  '<?xml version="1.0" encoding="utf-8"?><PayforResponse>' +
  Object.entries(f)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('') +
  '</PayforResponse>';
const APPROVED = xml({ OrderId: 'QORD-7', ProcReturnCode: '00', ErrMsg: 'Onaylandı', AuthCode: 'A1B2C3', HostRefNum: 'HR-1' });
const DECLINED = xml({ ProcReturnCode: '05', ErrMsg: 'Red' });
const inquiry = (f: Record<string, string> = {}) =>
  xml({ OrderId: 'QORD-7', ProcReturnCode: '00', TxnResult: 'Success', TxnStatus: 'Y', IsVoided: 'false', IsRefunded: 'false', PurchAmount: '99.90', ...f });

const card = { cardHolderName: 'A B', cardNumber: '4155650100416111', expireMonth: '01', expireYear: '2030', cvc: '715' };
const payReq = { price: '99.9', paidPrice: '99.90', currency: 'TRY', conversationId: 'QORD-7', paymentCard: card } as any;

function setup(reply?: () => Promise<unknown>, extra: Record<string, unknown> = {}) {
  const p = new Qnb({ ...cfg, ...extra } as any);
  const post = vi.spyOn((p as any).client, 'post');
  if (reply) post.mockImplementation(reply as any);
  return { p, post };
}
const ok = (b: string) => () => Promise.resolve({ data: b });
const noResponse = () => Promise.reject(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));
const sent = (post: any, call = 0) => parseQnbXml(String(post.mock.calls[call][1]).replace('PayforRequest', 'PayforResponse'));

describe('QNB config', () => {
  it.each(['merchantId', 'userCode', 'userPass', 'merchantPass', 'baseUrl'])('requires %s', (k) => {
    expect(() => new Qnb({ ...cfg, [k]: '' })).toThrow(new RegExp(k));
  });
  it('rejects an unknown secureType', () => {
    expect(() => new Qnb({ ...cfg, secureType: '3DHost' } as any)).toThrow(/secureType/);
  });
});

describe('QNB utils', () => {
  it('form hash matches an independently computed vector', () => {
    expect(
      qnbFormHash({
        orderId: 'QORD-7',
        amount: '99.90',
        okUrl: 'https://shop.test/q',
        failUrl: 'https://shop.test/q',
        txnType: 'Auth',
        installment: '0',
        rnd: 'rnd20charsxxxxxxxxxx',
        merchantPass: 'QPASS',
      }),
    ).toBe('5z2EcWLCE62hWXdNL0MTt/f7Xik=');
  });
  it('builds escaped XML and parses PayforResponse', () => {
    expect(buildQnbXml({ OrderId: 'A&B' })).toBe('<?xml version="1.0" encoding="utf-8"?><PayforRequest><OrderId>A&amp;B</OrderId></PayforRequest>');
    expect(parseQnbXml(xml({ ErrMsg: 'Onayland&#305;', HostRefNum: '\r\n ' }))).toEqual({ ErrMsg: 'Onaylandı', HostRefNum: '' });
    expect(() => parseQnbXml('<html/>')).toThrow(/unexpected/);
  });
  it('maps OrderInquiry states', () => {
    expect(mapQnbInquiry({ TxnStatus: 'Y', TxnResult: 'Success' })).toBe(PaymentStatus.SUCCESS);
    expect(mapQnbInquiry({ TxnStatus: 'Y', TxnResult: 'Success', IsRefunded: 'true' })).toBe(PaymentStatus.CANCELLED);
    expect(mapQnbInquiry({ TxnStatus: 'V' })).toBe(PaymentStatus.CANCELLED);
    expect(mapQnbInquiry({ TxnResult: 'Failed' })).toBe(PaymentStatus.FAILURE);
    expect(mapQnbInquiry({})).toBe(PaymentStatus.PENDING);
  });
});

describe('verifyQnb3DCallback', () => {
  it('accepts both reference callbacks', () => {
    expect(verifyQnb3DCallback(MODEL_CB, 'MID100', 'QPASS', 'QUSER')).toBe(true);
    expect(verifyQnb3DCallback(PAY_CB, 'MID100', 'QPASS', 'QUSER')).toBe(true);
  });
  it.each(['OrderId', 'AuthCode', 'ProcReturnCode', '3DStatus', 'ResponseRnd'])('rejects a changed %s', (f) => {
    expect(verifyQnb3DCallback({ ...PAY_CB, [f]: 'X' }, 'MID100', 'QPASS', 'QUSER')).toBe(false);
  });
  it('uses configured credentials, never callback values', () => {
    expect(verifyQnb3DCallback(PAY_CB, 'MID100', 'wrong', 'QUSER')).toBe(false);
    expect(verifyQnb3DCallback(PAY_CB, 'MID100', 'QPASS', 'OTHER')).toBe(false);
    expect(verifyQnb3DCallback({ ...PAY_CB, ResponseHash: undefined }, 'MID100', 'QPASS', 'QUSER')).toBe(false);
    expect(verifyQnb3DCallback({ ...PAY_CB, ProcReturnCode: ['00'] }, 'MID100', 'QPASS', 'QUSER')).toBe(false);
  });
});

describe('QNB createPayment', () => {
  it('sends XML Auth NonSecure', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect(await p.createPayment(payReq)).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'QORD-7' });
    expect(post.mock.calls[0][0]).toBe('/Gateway/XmlGate.aspx');
    expect(sent(post)).toMatchObject({
      MbrId: '5',
      MerchantId: 'MID100',
      UserCode: 'QUSER',
      UserPass: 'API-SECRET-PW',
      TxnType: 'Auth',
      SecureType: 'NonSecure',
      PurchAmount: '99.90',
      Currency: '949',
      InstallmentCount: '0',
      Expiry: '0130',
    });
  });
  it('rejects order ids PayFor cannot take before calling the bank', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect((await p.createPayment({ ...payReq, conversationId: 'SİPARİŞ' })).status).toBe(PaymentStatus.FAILURE);
    expect(post).not.toHaveBeenCalled();
  });
  it('decline → failure; no response → PENDING/NETWORK_ERROR', async () => {
    expect(await setup(ok(DECLINED)).p.createPayment(payReq)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    const res = await setup(noResponse).p.createPayment(payReq);
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    expect(JSON.stringify(res)).not.toContain('API-SECRET-PW');
  });
});

describe('QNB initThreeDSPayment', () => {
  it.each(['3DModel', '3DPay'])('builds a %s form, escaped, without secrets', async (secureType) => {
    const { p } = setup(undefined, { secureType });
    const url = 'https://shop.test/q?a=1&b=2';
    const res = await p.initThreeDSPayment({ ...payReq, callbackUrl: url, installment: 3 });
    const html = res.threeDSHtmlContent!;
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'QORD-7' });
    expect(html).toContain('action="https://vpostest.qnb.com.tr/Gateway/Default.aspx"');
    expect(html).toContain(`name="SecureType" value="${secureType}"`);
    expect(html).toContain('name="OkUrl" value="https://shop.test/q?a=1&amp;b=2"');
    expect(html).not.toContain('API-SECRET-PW');
    expect(html).not.toContain('QPASS');
    const rnd = html.match(/name="Rnd" value="([^"]+)"/)![1];
    expect(html).toContain(
      `name="Hash" value="${qnbFormHash({ orderId: 'QORD-7', amount: '99.90', okUrl: url, failUrl: url, txnType: 'Auth', installment: '3', rnd, merchantPass: 'QPASS' })}"`,
    );
  });
});

describe('QNB completeThreeDSPayment — 3D Model', () => {
  const replies = (...bodies: string[]) => {
    let i = 0;
    return () => Promise.resolve({ data: bodies[i++] });
  };

  it('verifies, charges with 3DModelPayment, then confirms the amount with OrderInquiry', async () => {
    const { p, post } = setup(replies(APPROVED, inquiry()));
    const res = await p.completeThreeDSPayment({ ...MODEL_CB, orderId: 'QORD-7', amount: '99.90' });
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'QORD-7' });
    expect(sent(post, 0)).toMatchObject({ RequestGuid: 'GUID-1', OrderId: 'QORD-7', SecureType: '3DModelPayment' });
    expect(sent(post, 1)).toMatchObject({ OrgOrderId: 'QORD-7', TxnType: 'OrderInquiry' });
  });
  it('without an order amount the bank 00 alone decides (no inquiry)', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect((await p.completeThreeDSPayment(MODEL_CB)).status).toBe(PaymentStatus.SUCCESS);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('a guid from another authentication is caught by the inquiry', async () => {
    // RequestGuid is unsigned: the bank charged some other (cheaper) authentication
    const cheaper = await setup(replies(APPROVED, inquiry({ PurchAmount: '1.00' }))).p.completeThreeDSPayment({ ...MODEL_CB, PurchAmount: undefined, amount: '99.90' });
    expect(cheaper).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'CHARGED_AMOUNT_MISMATCH' });
    const noSale = await setup(replies(APPROVED, inquiry({ TxnResult: 'Failed', TxnStatus: 'N' }))).p.completeThreeDSPayment({ ...MODEL_CB, amount: '99.90' });
    expect(noSale).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'NOT_CONFIRMED' });
    const otherOrder = await setup(ok(xml({ OrderId: 'OTHER', ProcReturnCode: '00' }))).p.completeThreeDSPayment(MODEL_CB);
    expect(otherOrder).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'ORDER_MISMATCH' });
  });
  it('confirmation inquiry without a response → PENDING with ids', async () => {
    let i = 0;
    const { p } = setup(() => (i++ === 0 ? Promise.resolve({ data: APPROVED }) : noResponse()));
    expect(await p.completeThreeDSPayment({ ...MODEL_CB, amount: '99.90' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'QORD-7' });
  });
  it('forged / wrong key → INVALID_HASH, no ids, no bank call', async () => {
    const { p, post } = setup(ok(APPROVED));
    const forged = await p.completeThreeDSPayment({ ...MODEL_CB, ResponseHash: 'AAAA' });
    expect(forged).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH' });
    expect(forged.paymentId).toBeUndefined();
    expect((await setup(ok(APPROVED), { merchantPass: 'x' }).p.completeThreeDSPayment(MODEL_CB)).errorCode).toBe('INVALID_HASH');
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects a mismatching order record before the bank', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect((await p.completeThreeDSPayment({ ...MODEL_CB, orderId: 'OTHER' })).errorCode).toBe('ORDER_MISMATCH');
    expect((await p.completeThreeDSPayment({ ...MODEL_CB, amount: '10.00' })).errorCode).toBe('AMOUNT_MISMATCH');
    expect(post).not.toHaveBeenCalled();
  });
  it('bank decline → failure; no response → PENDING with ids', async () => {
    expect(await setup(ok(DECLINED)).p.completeThreeDSPayment(MODEL_CB)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(await setup(noResponse).p.completeThreeDSPayment(MODEL_CB)).toMatchObject({
      status: PaymentStatus.PENDING,
      errorCode: 'NETWORK_ERROR',
      paymentId: 'QORD-7',
    });
  });
});

describe('QNB completeThreeDSPayment — 3D Pay', () => {
  const pay = (reply: () => Promise<unknown>) => setup(reply, { secureType: '3DPay' });

  it('confirms the signed approval with OrderInquiry', async () => {
    const { p, post } = pay(ok(inquiry()));
    const res = await p.completeThreeDSPayment({ ...PAY_CB, amount: '99.90' });
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'QORD-7' });
    expect(sent(post)).toMatchObject({ OrgOrderId: 'QORD-7', TxnType: 'OrderInquiry', SecureType: 'Inquiry' });
  });
  it('fails when the bank does not show the sale', async () => {
    expect((await pay(ok(inquiry({ TxnStatus: 'V' }))).p.completeThreeDSPayment(PAY_CB)).errorCode).toBe('NOT_CONFIRMED');
    expect((await pay(ok(DECLINED)).p.completeThreeDSPayment(PAY_CB)).errorCode).toBe('NOT_CONFIRMED');
  });
  it('fails when the bank charged a different amount than the order', async () => {
    const res = await pay(ok(inquiry({ PurchAmount: '1.00' }))).p.completeThreeDSPayment({ ...PAY_CB, PurchAmount: undefined, amount: '99.90' });
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'CHARGED_AMOUNT_MISMATCH' });
  });
  it('a signed decline is not charged-checked', async () => {
    // ProcReturnCode 05, re-signed independently: base64(sha1('MID100QPASSQORD-7051RR-3QUSER'))
    const declinedCb = { ...PAY_CB, AuthCode: '', ProcReturnCode: '05', ResponseRnd: 'RR-3' };
    const { createHash } = await import('crypto');
    declinedCb.ResponseHash = createHash('sha1').update('MID100QPASSQORD-7051RR-3QUSER').digest('base64');
    const { p, post } = pay(ok(inquiry()));
    expect(await p.completeThreeDSPayment(declinedCb)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(post).not.toHaveBeenCalled();
  });
  it('inquiry without a response → PENDING with ids', async () => {
    expect(await pay(noResponse).p.completeThreeDSPayment(PAY_CB)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'QORD-7' });
  });
});

describe('QNB refund / cancel / getPayment', () => {
  const refundReq = { paymentId: 'QORD-7', price: '10', currency: 'TRY', ip: '' };
  it('refund', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect(await p.refund(refundReq)).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'HR-1' });
    expect(sent(post)).toMatchObject({ TxnType: 'Refund', OrgOrderId: 'QORD-7', PurchAmount: '10.00', Currency: '949' });
    expect(await setup(ok(DECLINED)).p.refund(refundReq)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(await setup(noResponse).p.refund(refundReq)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });
  it('cancel', async () => {
    const { p, post } = setup(ok(APPROVED));
    expect(await p.cancel({ paymentId: 'QORD-7', ip: '' })).toMatchObject({ status: PaymentStatus.SUCCESS, transactionId: 'HR-1' });
    expect(sent(post)).toMatchObject({ TxnType: 'Void', OrgOrderId: 'QORD-7' });
    expect(await setup(ok(DECLINED)).p.cancel({ paymentId: 'X', ip: '' })).toMatchObject({ status: PaymentStatus.FAILURE });
    expect(await setup(noResponse).p.cancel({ paymentId: 'X', ip: '' })).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });
  it('getPayment', async () => {
    expect(await setup(ok(inquiry())).p.getPayment('QORD-7')).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'QORD-7' });
    expect(await setup(ok(inquiry({ IsVoided: 'true' }))).p.getPayment('QORD-7')).toMatchObject({ status: PaymentStatus.CANCELLED });
    expect(await setup(ok(DECLINED)).p.getPayment('QORD-7')).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(await setup(noResponse).p.getPayment('QORD-7')).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });
});
