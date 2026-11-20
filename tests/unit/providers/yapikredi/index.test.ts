import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YapiKredi } from '../../../../src/providers/yapikredi';
import {
  buildPosnetMac,
  buildPosnetResponseMac,
  formatYapiKrediAmount,
  formatExpDateYYMM,
  getYapiKrediCurrency,
  toPosnetOrderNo,
  parsePosnetResponse,
} from '../../../../src/providers/yapikredi/utils';
import { PaymentStatus } from '../../../../src/types';

const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://setmpos.ykb.com',
  merchantId: 'M1',
  terminalId: 'T1',
  posnetId: 'P1',
  encKey: 'ENCKEY',
} as any;

const XID = '0000000000000ORDER3D';
const macInput = { xid: XID, amount: '12050', currency: 'TL', merchantId: 'M1', terminalId: 'T1', encKey: 'ENCKEY' };
const order = { orderId: 'ORDER3D', amount: '120.50', currency: 'TRY' };
const callback = { BankPacket: 'BANKPKT', MerchantPacket: 'MERCHPKT', Sign: 'SIGN', CCPrefix: '450634' };

const xml = (top: Record<string, string>, blocks: Record<string, Record<string, string>> = {}) =>
  '<?xml version="1.0" encoding="ISO-8859-9"?><posnetResponse>' +
  Object.entries(top).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
  Object.entries(blocks)
    .map(([b, f]) => `<${b}>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</${b}>`)
    .join('') +
  '</posnetResponse>';

const resolveXml = (over: Record<string, string> = {}) =>
  xml(
    { approved: '1' },
    {
      oosResolveMerchantDataResponse: {
        xid: XID,
        amount: '12050',
        currency: 'TL',
        installment: '00',
        mdStatus: '1',
        mac: buildPosnetResponseMac(over.mdStatus ?? '1', macInput),
        ...over,
      },
    },
  );

const networkError = () => Object.assign(new Error('timeout of 60000ms exceeded'), { isAxiosError: true });
const sentXml = (post: any, call = 0) => decodeURIComponent(String(post.mock.calls[call][1]).replace(/^xmldata=/, ''));
const tag = (x: string, name: string) => x.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

const card = { cardHolderName: 'Ali Veli', cardNumber: '4506 3490 4351 1467', expireMonth: '1', expireYear: '2030', cvc: '000' };

describe('YapiKredi utils', () => {
  it("matches the bank's MAC sample from the Posnet 3D guide", () => {
    expect(
      buildPosnetMac({
        xid: 'YKB_TST_190620093100_024',
        amount: '175',
        currency: 'TL',
        merchantId: '6706598320',
        terminalId: '67005551',
        encKey: '10,10,10,10,10,10,10,10',
      }),
    ).toBe('J/7/Xprj7F/KDf98luVfIGyUPRQzUCqGwpmvz3KT7oQ=');
  });

  it('response MAC prepends mdStatus (independently computed vector)', () => {
    expect(buildPosnetResponseMac('1', macInput)).toBe('t30k0ACE0ok+6COTwDBIXuqIb5d3GGV+H9k7emXLGDk=');
  });

  it('formats amount, currency, expiry; rejects unknown currency', () => {
    expect(formatYapiKrediAmount('99.99')).toBe('9999');
    expect(formatExpDateYYMM('1', '2030')).toBe('3001');
    expect(getYapiKrediCurrency('usd')).toBe('US');
    expect(() => getYapiKrediCurrency('JPY')).toThrow(/not supported/);
  });

  it('order number: pads a fitting conversationId, generates one otherwise', () => {
    expect(toPosnetOrderNo('ORDER3D')).toBe(XID);
    const gen = toPosnetOrderNo('order-with-dashes-and-too-long-1234');
    expect(gen).toMatch(/^[0-9A-F]{20}$/);
    expect(toPosnetOrderNo()).toMatch(/^[0-9A-F]{20}$/);
  });

  it('parses utf-16 agreement answers with NULs', () => {
    const body = xml({ approved: '1' }).split('').join('\u0000');
    expect(parsePosnetResponse(body).fields.approved).toBe('1');
  });
});

describe('YapiKredi provider', () => {
  let p: YapiKredi;
  let post: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    p = new YapiKredi(cfg);
    post = vi.spyOn((p as any).client, 'post') as any;
  });

  it('rejects missing required fields', () => {
    expect(() => new YapiKredi({ ...cfg, merchantId: '' })).toThrow(/merchantId/);
    expect(() => new YapiKredi({ ...cfg, terminalId: '' })).toThrow(/terminalId/);
    expect(() => new YapiKredi({ ...cfg, posnetId: '' })).toThrow(/posnetId/);
    expect(() => new YapiKredi({ ...cfg, encKey: '' })).toThrow(/encKey/);
  });

  describe('createPayment', () => {
    const req = { price: '1.20', paidPrice: '1.20', currency: 'TRY', conversationId: 'ORDER1', paymentCard: card } as any;

    it('sends an XML sale and returns the hostlogkey', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '1', hostlogkey: '021450428990000191', authCode: '1' }) });
      const res = await p.createPayment(req);
      expect(post.mock.calls[0][0]).toBe('/PosnetWebService/XML');
      const sent = sentXml(post);
      expect(tag(sent, 'mid')).toBe('M1');
      expect(tag(sent, 'amount')).toBe('120');
      expect(tag(sent, 'currencyCode')).toBe('TL');
      expect(tag(sent, 'orderID')).toBe('000000000000000000ORDER1');
      expect(tag(sent, 'ccno')).toBe('4506349043511467');
      expect(tag(sent, 'expDate')).toBe('3001');
      expect(sent).not.toContain('ENCKEY');
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: '021450428990000191', conversationId: '00000000000000ORDER1' });
    });

    it('declined → FAILURE with bank code', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0127', respText: 'ORDERID DAHA ONCE KULLANILMIS' }) });
      const res = await p.createPayment(req);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0127' });
      expect(res.paymentId).toBeUndefined();
    });

    it('no response → PENDING / NETWORK_ERROR', async () => {
      post.mockRejectedValueOnce(networkError());
      const res = await p.createPayment(req);
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    });
  });

  describe('initThreeDSPayment', () => {
    const req = { price: '120.50', paidPrice: '120.50', currency: 'TRY', conversationId: 'ORDER3D', callbackUrl: 'https://x/cb', paymentCard: card } as any;

    it('posts oosRequestData and builds the OOS form with the bank data', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '1' }, { oosRequestDataResponse: { data1: 'D1', data2: 'D2&quot;&lt;x&gt;', sign: 'S1' } }) });
      const res = await p.initThreeDSPayment(req);
      const sent = sentXml(post);
      expect(tag(sent, 'XID')).toBe(XID);
      expect(tag(sent, 'posnetid')).toBe('P1');
      expect(tag(sent, 'amount')).toBe('12050');
      expect(res.status).toBe(PaymentStatus.PENDING);
      expect(res.paymentId).toBe(XID);
      expect(res.threeDSHtmlContent).toContain('action="https://setmpos.ykb.com/3DSWebService/YKBPaymentService"');
      expect(res.threeDSHtmlContent).toContain('name="posnetData" value="D1"');
      expect(res.threeDSHtmlContent).toContain('value="D2&quot;&lt;x&gt;"');
      expect(res.threeDSHtmlContent).toContain('name="digest" value="S1"');
      expect(res.threeDSHtmlContent).not.toContain('4506');
    });

    it('bank refusal → FAILURE', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0148', respText: 'INVALID MID TID' }) });
      const res = await p.initThreeDSPayment(req);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0148' });
    });
  });

  describe('completeThreeDSPayment', () => {
    it('resolves, verifies the bank MAC over the merchant order, then charges', async () => {
      post
        .mockResolvedValueOnce({ data: resolveXml() })
        .mockResolvedValueOnce({
          data: xml({ approved: '1', hostlogkey: 'HLK1', mac: buildPosnetResponseMac('HLK1', macInput) }),
        });
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      const resolve = sentXml(post, 0);
      expect(tag(resolve, 'bankData')).toBe('BANKPKT');
      expect(tag(resolve, 'mac')).toBe(buildPosnetMac(macInput));
      const charge = sentXml(post, 1);
      expect(charge).toContain('<oosTranData>');
      expect(tag(charge, 'wpAmount')).toBe('0');
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'HLK1', conversationId: XID });
    });

    it('missing record values → FAILURE without calling the bank', async () => {
      const res = await p.completeThreeDSPayment({ ...callback });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'VALIDATION_ERROR' });
      expect(post).not.toHaveBeenCalled();
    });

    it('missing packets → FAILURE', async () => {
      const res = await p.completeThreeDSPayment({ ...order });
      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });

    it('a callback for a different amount fails the MAC and never charges', async () => {
      post.mockResolvedValueOnce({ data: resolveXml() });
      const res = await p.completeThreeDSPayment({ ...callback, ...order, amount: '1.00' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'INVALID_HASH' });
      expect(res.paymentId).toBeUndefined();
      expect(res.conversationId).toBeUndefined();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('a resolve answer with a missing or tampered MAC fails', async () => {
      post.mockResolvedValueOnce({ data: resolveXml({ mac: '' }) });
      expect((await p.completeThreeDSPayment({ ...callback, ...order })).errorCode).toBe('INVALID_HASH');
      post.mockResolvedValueOnce({ data: resolveXml({ mdStatus: '1', mac: buildPosnetResponseMac('9', macInput) }) });
      expect((await p.completeThreeDSPayment({ ...callback, ...order })).errorCode).toBe('INVALID_HASH');
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('wrong encKey → MAC mismatch', async () => {
      const other = new YapiKredi({ ...cfg, encKey: 'OTHER' });
      const otherPost = vi.spyOn((other as any).client, 'post').mockResolvedValueOnce({ data: resolveXml() } as any);
      const res = await other.completeThreeDSPayment({ ...callback, ...order });
      expect(res.errorCode).toBe('INVALID_HASH');
      expect(otherPost).toHaveBeenCalledTimes(1);
    });

    it('half-secure mdStatus is refused by default (MAC-valid)', async () => {
      post.mockResolvedValueOnce({ data: resolveXml({ mdStatus: '2' }) });
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'MD_STATUS_2' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('declined charge → FAILURE', async () => {
      post
        .mockResolvedValueOnce({ data: resolveXml() })
        .mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0051', respText: 'YETERSIZ BAKIYE' }) });
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0051' });
    });

    it('no answer to the charge → PENDING / NETWORK_ERROR', async () => {
      post.mockResolvedValueOnce({ data: resolveXml() }).mockRejectedValueOnce(networkError());
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', conversationId: XID });
    });

    it('charge answer with a wrong MAC → PENDING', async () => {
      post
        .mockResolvedValueOnce({ data: resolveXml() })
        .mockResolvedValueOnce({ data: xml({ approved: '1', hostlogkey: 'HLK1', mac: 'forged' }) });
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'INVALID_HASH' });
    });

    it('no answer to the resolve → FAILURE (nothing charged yet)', async () => {
      post.mockRejectedValueOnce(networkError());
      const res = await p.completeThreeDSPayment({ ...callback, ...order });
      expect(res.status).toBe(PaymentStatus.FAILURE);
    });
  });

  describe('refund / cancel', () => {
    it('refund sends return with hostLogKey', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '1', hostlogkey: 'HLK2' }) });
      const res = await p.refund({ paymentId: 'HLK1', price: '50.00', currency: 'TRY', ip: '1.1.1.1' });
      const sent = sentXml(post);
      expect(sent).toContain('<return>');
      expect(tag(sent, 'hostLogKey')).toBe('HLK1');
      expect(tag(sent, 'amount')).toBe('5000');
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'HLK2' });
    });

    it('refund declined → FAILURE; no response → PENDING', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0123' }) });
      expect((await p.refund({ paymentId: 'HLK1', price: '1', currency: 'TRY', ip: '' })).status).toBe(PaymentStatus.FAILURE);
      post.mockRejectedValueOnce(networkError());
      expect(await p.refund({ paymentId: 'HLK1', price: '1', currency: 'TRY', ip: '' })).toMatchObject({
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
      });
    });

    it('cancel sends reverse of the sale', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '1' }) });
      const res = await p.cancel({ paymentId: 'HLK1', ip: '1.1.1.1' });
      const sent = sentXml(post);
      expect(sent).toContain('<reverse>');
      expect(tag(sent, 'transaction')).toBe('sale');
      expect(res.status).toBe(PaymentStatus.SUCCESS);
    });

    it('cancel declined → FAILURE; no response → PENDING', async () => {
      post.mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0001' }) });
      expect((await p.cancel({ paymentId: 'HLK1', ip: '' })).status).toBe(PaymentStatus.FAILURE);
      post.mockRejectedValueOnce(networkError());
      expect((await p.cancel({ paymentId: 'HLK1', ip: '' })).errorCode).toBe('NETWORK_ERROR');
    });
  });

  describe('getPayment', () => {
    const agreement = (txs: Array<Record<string, string>>) =>
      '<?xml version="1.0" encoding="utf-16"?><posnetResponse><approved>1</approved><transactions>' +
      txs.map((t) => `<transaction>${Object.entries(t).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</transaction>`).join('') +
      '</transactions></posnetResponse>';

    it('falls through to the 3D order id and maps a sale to SUCCESS', async () => {
      post
        .mockResolvedValueOnce({ data: xml({ approved: '0', respCode: '0148' }) })
        .mockResolvedValueOnce({ data: agreement([{ state: 'Sale', txnStatus: '1', hostLogKey: 'HLK1' }]) });
      const res = await p.getPayment('ORDER3D');
      expect(tag(sentXml(post, 0), 'orderID')).toBe(XID.padStart(24, '0'));
      expect(tag(sentXml(post, 1), 'orderID')).toBe(`TDSC${XID}`);
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'HLK1', conversationId: XID });
    });

    it('a successful reverse makes it CANCELLED', async () => {
      post.mockResolvedValueOnce({
        data: agreement([
          { state: 'Sale', txnStatus: '1', hostLogKey: 'HLK1' },
          { state: 'Sale_Reverse', txnStatus: '1', hostLogKey: 'HLK2' },
        ]),
      });
      expect((await p.getPayment('ORDER3D')).status).toBe(PaymentStatus.CANCELLED);
    });

    it('not found anywhere → FAILURE', async () => {
      post.mockResolvedValue({ data: xml({ approved: '0', respCode: '0148', respText: 'NOT FOUND' }) });
      const res = await p.getPayment('ORDER3D');
      expect(post).toHaveBeenCalledTimes(3);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0148' });
    });
  });
});
