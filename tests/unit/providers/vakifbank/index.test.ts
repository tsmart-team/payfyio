import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { VakifBank } from '../../../../src/providers/vakifbank';
import {
  deriveVakifBankMpiUrl,
  vakifBankExpiry,
  vakifBankBrand,
  buildVposBody,
  readVakifBankXml,
  buildAutoPostForm,
} from '../../../../src/providers/vakifbank/utils';
import { PaymentStatus } from '../../../../src/types';

const TEST_BASE = 'https://onlineodemetest.vakifbank.com.tr:4443';
const cfg = { apiKey: '', secretKey: '', baseUrl: TEST_BASE, merchantId: '000100000013506', password: 'p@ss', terminalNo: 'VP000579' };

const request = {
  conversationId: 'ORDER3D',
  price: '1.2',
  paidPrice: '1.2',
  currency: 'TRY',
  basketId: 'B1',
  callbackUrl: 'https://shop.test/vb/callback?x=1&y=2',
  installment: 3,
  paymentCard: { cardHolderName: 'Ali Veli', cardNumber: '4938 4600 1960 1234', expireMonth: '3', expireYear: '2030', cvc: '123' },
  buyer: { id: 'U1', name: 'Ali', surname: 'Veli', email: 'a@b.c', identityNumber: '1', registrationAddress: 'x', city: 'x', country: 'x', ip: '85.34.78.112', gsmNumber: '' },
  shippingAddress: { contactName: 'x', city: 'x', country: 'x', address: 'x' },
  billingAddress: { contactName: 'x', city: 'x', country: 'x', address: 'x' },
  basketItems: [],
} as any;

const vposXml = (f: Record<string, string>) =>
  `<?xml version="1.0" encoding="utf-8"?><VposResponse>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</VposResponse>`;
const APPROVED = vposXml({ ResultCode: '0000', ResultDetail: 'İŞLEM BAŞARILI', TransactionId: 'T1', CurrencyAmount: '1.20' });
const DECLINED = vposXml({ ResultCode: '0051', ResultDetail: 'YETERSIZ BAKIYE' });
const ENROLLED =
  '<?xml version="1.0" encoding="utf-8"?><IPaySecure><Message ID="m1"><VERes><Status>Y</Status><PaReq>PAREQ</PaReq>' +
  '<ACSUrl>https://acs.bank.test/pareq?a=1&amp;b="2"</ACSUrl><TermUrl>https://3dsecuretest.vakifbank.com.tr/MPIAPI/MPI_PARes.aspx</TermUrl>' +
  '<MD>MDVALUE</MD></VERes></Message><VerifyEnrollmentRequestId>ORDER3D</VerifyEnrollmentRequestId><MessageErrorCode>200</MessageErrorCode></IPaySecure>';
const callback = {
  MerchantId: cfg.merchantId,
  VerifyEnrollmentRequestId: 'ORDER3D',
  Status: 'Y',
  PurchAmount: '120',
  Eci: '02',
  Cavv: 'CAVV=',
  InstallmentCount: '3',
  SessionInfo: '85.34.78.112',
};
const noAnswer = () => Object.assign(new Error('socket hang up'), { isAxiosError: true });

/** Decoded VposRequest XML of a call. */
const xmlOf = (body: string) => decodeURIComponent(body.replace(/^prmstr=/, ''));

describe('VakıfBank utils', () => {
  it('derives the MPI host from the VPOS host', () => {
    expect(deriveVakifBankMpiUrl(TEST_BASE)).toBe('https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx');
    expect(deriveVakifBankMpiUrl('https://onlineodeme.vakifbank.com.tr:4443')).toBe(
      'https://3dsecure.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx',
    );
    expect(deriveVakifBankMpiUrl('http://localhost:9000/x')).toBe('http://localhost:9000/MPIAPI/MPI_Enrollment.aspx');
  });

  it('formats expiry and brand', () => {
    expect(vakifBankExpiry('3', '2030', 'YYMM')).toBe('3003');
    expect(vakifBankExpiry('12', '30', 'YYYYMM')).toBe('203012');
    expect(() => vakifBankExpiry('13', '2030', 'YYMM')).toThrow(/expiry/);
    expect(vakifBankBrand('4938460019601234')).toBe('100');
    expect(vakifBankBrand('5400000000000000')).toBe('200');
    expect(vakifBankBrand('9792000000000000')).toBe('300');
    expect(vakifBankBrand('375000000000000')).toBe('400');
  });

  it('escapes XML, drops empty fields, parses and unescapes answers', () => {
    expect(xmlOf(buildVposBody({ A: 'x<&>', B: undefined, C: '' }))).toBe(
      '<?xml version="1.0" encoding="utf-8"?><VposRequest><A>x&lt;&amp;&gt;</A></VposRequest>',
    );
    expect(readVakifBankXml(ENROLLED, 'IPaySecure').ACSUrl).toBe('https://acs.bank.test/pareq?a=1&b="2"');
    expect(() => readVakifBankXml('<html>502</html>', 'VposResponse')).toThrow(/VposResponse/);
  });

  it('escapes the ACS action and values in the auto-post form', () => {
    const html = buildAutoPostForm('https://acs.test/?a=1&b="x"', { MD: '"><script>' });
    expect(html).toContain('action="https://acs.test/?a=1&amp;b=&quot;x&quot;"');
    expect(html).not.toContain('"><script>');
  });
});

describe('VakıfBank provider', () => {
  let vb: VakifBank;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vb = new VakifBank(cfg);
    post = vi.fn();
    (vb as any).client.post = post;
  });

  it('requires every credential and a baseUrl', () => {
    for (const key of ['merchantId', 'password', 'terminalNo', 'baseUrl']) {
      expect(() => new VakifBank({ ...cfg, [key]: '' })).toThrow(new RegExp(key));
    }
  });

  it('getPayment throws (not supported) instead of returning a misleading status', async () => {
    await expect(vb.getPayment('ORDER3D')).rejects.toThrow(/not supported/);
  });

  describe('createPayment', () => {
    it('sends a VPOS Sale and maps 0000 to SUCCESS', async () => {
      post.mockResolvedValue({ data: APPROVED });
      const res = await vb.createPayment({ ...request, installment: undefined });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER3D' });
      const [path, body] = post.mock.calls[0];
      expect(path).toBe('/VposService/v3/Vposreq.aspx');
      const xml = xmlOf(body);
      for (const part of [
        '<MerchantId>000100000013506</MerchantId>',
        '<Password>p@ss</Password>',
        '<TerminalNo>VP000579</TerminalNo>',
        '<TransactionType>Sale</TransactionType>',
        '<CurrencyAmount>1.20</CurrencyAmount>',
        '<CurrencyCode>949</CurrencyCode>',
        '<Pan>4938460019601234</Pan>',
        '<Expiry>203003</Expiry>',
      ]) {
        expect(xml).toContain(part);
      }
      expect(xml).not.toContain('NumberOfInstallments');
    });

    it('maps a decline to FAILURE', async () => {
      post.mockResolvedValue({ data: DECLINED });
      expect(await vb.createPayment(request)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0051' });
    });

    it('no answer → PENDING/NETWORK_ERROR; unreadable answer → FAILURE', async () => {
      post.mockRejectedValueOnce(noAnswer());
      expect(await vb.createPayment(request)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'ORDER3D' });
      post.mockResolvedValueOnce({ data: '<html>maintenance</html>' });
      expect((await vb.createPayment(request)).status).toBe(PaymentStatus.FAILURE);
    });

    it('rejects order ids VakıfBank cannot take, before any call', async () => {
      expect((await vb.createPayment({ ...request, conversationId: 'bad id!' })).status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('initThreeDSPayment', () => {
    it('enrolls at the derived test MPI and auto-posts to the ACS', async () => {
      post.mockResolvedValue({ data: ENROLLED });
      const res = await vb.initThreeDSPayment(request);
      expect(res).toMatchObject({ status: PaymentStatus.PENDING, paymentId: 'ORDER3D' });
      expect(res.threeDSHtmlContent).toContain('action="https://acs.bank.test/pareq?a=1&amp;b=&quot;2&quot;"');
      expect(res.threeDSHtmlContent).toContain('name="MD" value="MDVALUE"');

      const [url, body] = post.mock.calls[0];
      expect(url).toBe('https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx');
      const form = new URLSearchParams(body);
      expect(Object.fromEntries(form)).toMatchObject({
        VerifyEnrollmentRequestId: 'ORDER3D',
        PurchaseAmount: '1.20',
        Currency: '949',
        ExpiryDate: '3003',
        BrandName: '100',
        InstallmentCount: '3',
        SessionInfo: '85.34.78.112',
        SuccessUrl: request.callbackUrl,
      });
    });

    it('uses the production MPI for a production baseUrl, and mpiUrl when set', async () => {
      post.mockResolvedValue({ data: ENROLLED });
      const prod = new VakifBank({ ...cfg, baseUrl: 'https://onlineodeme.vakifbank.com.tr:4443' });
      (prod as any).client.post = post;
      await prod.initThreeDSPayment(request);
      expect(post.mock.calls[0][0]).toBe('https://3dsecure.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx');

      const custom = new VakifBank({ ...cfg, mpiUrl: 'https://mpi.proxy.test/enroll' });
      (custom as any).client.post = post;
      await custom.initThreeDSPayment(request);
      expect(post.mock.calls[1][0]).toBe('https://mpi.proxy.test/enroll');
    });

    it('fails for a card that is not enrolled', async () => {
      post.mockResolvedValue({ data: '<IPaySecure><VERes><Status>N</Status></VERes></IPaySecure>' });
      const res = await vb.initThreeDSPayment(request);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'VERES_N' });
      expect(res.paymentId).toBeUndefined();
    });
  });

  describe('completeThreeDSPayment', () => {
    it('charges via MpiTransactionId — no card or amount from the callback', async () => {
      post.mockResolvedValue({ data: APPROVED });
      const res = await vb.completeThreeDSPayment({ ...callback, orderId: 'ORDER3D', amount: '1.20' });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'ORDER3D' });
      const xml = xmlOf(post.mock.calls[0][1]);
      expect(xml).toContain('<MpiTransactionId>ORDER3D</MpiTransactionId>');
      expect(xml).toContain('<ECI>02</ECI>');
      expect(xml).toContain('<CAVV>CAVV=</CAVV>');
      expect(xml).toContain('<NumberOfInstallments>3</NumberOfInstallments>');
      expect(xml).toContain('<ClientIp>85.34.78.112</ClientIp>');
      expect(xml).not.toMatch(/<Pan>|<CurrencyAmount>|<Expiry>/);
    });

    it("the merchant's installment count overrides the callback's unsigned one", async () => {
      post.mockResolvedValue({ data: APPROVED });
      await vb.completeThreeDSPayment({ ...callback, InstallmentCount: '12', orderId: 'ORDER3D', amount: '1.20', installment: 1 } as any);
      expect(xmlOf(post.mock.calls[0][1])).not.toContain('<NumberOfInstallments>');
    });

    it('does not charge a non-Y status, another merchant, or another stored order', async () => {
      for (const [cb, code] of [
        [{ ...callback, Status: 'N' }, 'MPI_STATUS_N'],
        [{ ...callback, MerchantId: '999' }, 'INVALID_CALLBACK'],
        [{ ...callback, VerifyEnrollmentRequestId: undefined }, 'INVALID_CALLBACK'],
        [{ ...callback, orderId: 'OTHER' }, 'ORDER_MISMATCH'],
      ] as const) {
        const res = await vb.completeThreeDSPayment(cb as any);
        expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: code });
        expect(res.paymentId).toBeUndefined();
      }
      expect(post).not.toHaveBeenCalled();
    });

    it('maps a VPOS decline to FAILURE without ids', async () => {
      post.mockResolvedValue({ data: DECLINED });
      const res = await vb.completeThreeDSPayment(callback);
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '0051' });
      expect(res.paymentId).toBeUndefined();
    });

    it('flags a charged amount that differs from the stored amount', async () => {
      post.mockResolvedValue({ data: APPROVED });
      const res = await vb.completeThreeDSPayment({ ...callback, amount: '100.00' });
      expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: 'CHARGED_AMOUNT_MISMATCH', paymentId: 'ORDER3D' });
    });

    it('a bad stored amount fails before the charge', async () => {
      const res = await vb.completeThreeDSPayment({ ...callback, amount: 'abc' });
      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });

    it('PENDING survives the real axios stack (interceptors + transport error)', async () => {
      const real = new VakifBank({ ...cfg, logger: { debug() {}, info() {}, warn() {}, error() {} } as any });
      (real as any).client.defaults.adapter = async (config: any) => {
        throw new AxiosError('socket hang up', 'ECONNRESET', config);
      };
      expect(await real.completeThreeDSPayment(callback)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
    });

    it('no answer from VPOS → PENDING/NETWORK_ERROR', async () => {
      post.mockRejectedValue(noAnswer());
      expect(await vb.completeThreeDSPayment(callback)).toMatchObject({
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
        paymentId: 'ORDER3D',
      });
    });
  });

  describe('refund / cancel', () => {
    it('refunds by ReferenceTransactionId with an amount', async () => {
      post.mockResolvedValue({ data: APPROVED });
      const res = await vb.refund({ paymentId: 'ORDER3D', price: '0.5', currency: 'TRY', ip: '1.1.1.1' });
      expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'T1' });
      const xml = xmlOf(post.mock.calls[0][1]);
      expect(xml).toContain('<TransactionType>Refund</TransactionType>');
      expect(xml).toContain('<ReferenceTransactionId>ORDER3D</ReferenceTransactionId>');
      expect(xml).toContain('<CurrencyAmount>0.50</CurrencyAmount>');
    });

    it('cancels by ReferenceTransactionId', async () => {
      post.mockResolvedValue({ data: APPROVED });
      expect(await vb.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' })).toMatchObject({ status: PaymentStatus.SUCCESS, voidId: 'T1' });
      expect(xmlOf(post.mock.calls[0][1])).toContain('<TransactionType>Cancel</TransactionType>');
    });

    it('maps declines to FAILURE and no answer to PENDING/NETWORK_ERROR', async () => {
      post.mockResolvedValueOnce({ data: DECLINED });
      expect(await vb.refund({ paymentId: 'O', price: '1', currency: 'TRY', ip: '1.1.1.1' })).toMatchObject({
        status: PaymentStatus.FAILURE,
        errorCode: '0051',
      });
      post.mockResolvedValueOnce({ data: DECLINED });
      expect((await vb.cancel({ paymentId: 'O', ip: '1.1.1.1' })).status).toBe(PaymentStatus.FAILURE);
      post.mockRejectedValueOnce(noAnswer());
      expect(await vb.refund({ paymentId: 'O', price: '1', currency: 'TRY', ip: '1.1.1.1' })).toMatchObject({
        status: PaymentStatus.PENDING,
        errorCode: 'NETWORK_ERROR',
      });
      post.mockRejectedValueOnce(noAnswer());
      expect((await vb.cancel({ paymentId: 'O', ip: '1.1.1.1' })).status).toBe(PaymentStatus.PENDING);
    });
  });
});
