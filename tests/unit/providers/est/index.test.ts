import { describe, it, expect, vi } from 'vitest';
import { Est, verifyEst3DCallback } from '../../../../src/providers/est';
import {
  buildEstHashV3,
  compareParamNames,
  parseCC5Response,
} from '../../../../src/providers/est/utils';
import { PaymentStatus } from '../../../../src/types';

const BS = String.fromCharCode(92); // backslash

const cfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://entegrasyon.asseco-see.com.tr',
  clientId: '700655000200',
  username: 'apiuser',
  password: 'apipass',
  storeKey: 'PAYFYIOKEY01',
} as any;

const threeDSRequest = {
  price: '249.90',
  paidPrice: '249.90',
  currency: 'TRY',
  conversationId: 'PFY-0001',
  callbackUrl: 'https://shop.test/cb',
  installment: 3,
  paymentCard: { cardNumber: '4508 0345 0803 4509', expireMonth: '1', expireYear: '2029', cvc: '000', cardHolderName: 'Ayşe Yılmaz' },
  buyer: { email: 'a@b.c', ip: '1.1.1.1' },
  basketId: 'b',
} as any;

/** Sign a callback the way the bank does. */
const signed = (fields: Record<string, string>, key = cfg.storeKey) => ({
  ...fields,
  HASH: buildEstHashV3(fields, key),
});

const cb3d = signed({
  clientid: '700655000200',
  oid: 'PFY-0001',
  amount: '249.90',
  currency: '949',
  taksit: '3',
  storetype: '3d',
  mdStatus: '1',
  md: 'MD-TOKEN',
  xid: 'XID=',
  eci: '05',
  cavv: 'CAVV=',
  mdErrorMsg: 'Authenticated',
  rnd: 'r1',
  hashAlgorithm: 'ver3',
  encoding: 'ISO-8859-9',
});

const cb3dPay = signed({
  clientid: '700655000200',
  oid: 'PFY-0002',
  amount: '10.00',
  currency: '949',
  taksit: '',
  storetype: '3d_pay',
  mdStatus: '1',
  Response: 'Approved',
  ProcReturnCode: '00',
  TransId: 'T-9',
  rnd: 'r2',
  hashAlgorithm: 'ver3',
});

const xml = (fields: Record<string, string>, extra?: Record<string, string>) =>
  '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response>' +
  Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
  (extra ? `<Extra>${Object.entries(extra).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Extra>` : '') +
  '</CC5Response>';

const APPROVED = xml({ OrderId: 'PFY-0001', Response: 'Approved', ProcReturnCode: '00', TransId: 'T-1', ErrMsg: '' });
const DECLINED = xml({ OrderId: 'PFY-0001', Response: 'Declined', ProcReturnCode: '05', ErrMsg: 'Do not honour' });
const statusXml = (extra: Record<string, string>) =>
  xml({ OrderId: 'PFY-0002', Response: 'Approved', ProcReturnCode: '00', ErrMsg: 'Record(s) found' }, extra);
const CAPTURED = statusXml({ TRANS_STAT: 'S', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '1000' });

const networkError = Object.assign(new Error('timeout of 30000ms exceeded'), {
  isAxiosError: true,
  config: { data: '<Password>apipass</Password>' },
});

function mockPost(p: Est, ...responses: (string | Error)[]) {
  const post = vi.spyOn((p as any).client, 'post');
  for (const r of responses) {
    if (r instanceof Error) post.mockRejectedValueOnce(r);
    else post.mockResolvedValueOnce({ data: r });
  }
  return post;
}

const sentXml = (post: ReturnType<typeof vi.spyOn>, call = 0) => String(post.mock.calls[call][1]);

describe('Est — config', () => {
  it('rejects missing required fields and unknown storeType', () => {
    for (const f of ['clientId', 'username', 'password', 'storeKey']) {
      expect(() => new Est({ ...cfg, [f]: '' })).toThrow(new RegExp(f));
    }
    expect(() => new Est({ ...cfg, storeType: '3d_full' })).toThrow(/storeType/);
  });
});

describe('Est — hash ver3', () => {
  it('matches an independently computed vector (Python hashlib)', () => {
    const form = {
      clientid: '700655000200', storetype: '3d', TranType: 'Auth', amount: '249.90', currency: '949',
      oid: 'PFY-0001', okUrl: 'https://shop.test/cb', failUrl: 'https://shop.test/cb', taksit: '3',
      rnd: 'a1b2c3d4', lang: 'tr', hashAlgorithm: 'ver3', refreshTime: '0', pan: '4508034508034509',
      Ecom_Payment_Card_ExpDate_Month: '01', Ecom_Payment_Card_ExpDate_Year: '29', cv2: '000',
    };
    const expected = '7cZF83Xy/uzS11cHVId5yrf6lB8nynCbZNIovX7yA18fa7JJu0edlmCslG011V/3jTivQqOLgFpkUk8GfW/B3w==';
    expect(buildEstHashV3(form, 'PAYFYIOKEY01')).toBe(expected);
    // field order and excluded fields don't matter
    const shuffled = Object.fromEntries(Object.entries(form).reverse());
    expect(buildEstHashV3({ ...shuffled, hash: 'x', Encoding: 'UTF-8', countdown: '3' }, 'PAYFYIOKEY01')).toBe(expected);
  });

  it('escapes backslash and pipe in values and the store key', () => {
    expect(buildEstHashV3({ note: 'a|b', path: `c${BS}d` }, `s|k${BS}`)).toBe(
      'esxqbohTgtX/JbzgJEeQ1khKGXfe3yHO6AZ5uxDPpXMgVtfouu8N4pHKx0tpgE9RLkWQuQ4EUs7XijvuM6cYfA==',
    );
  });

  it('sorts parameter names case-insensitively, digit runs by value', () => {
    expect(['oid', 'Email', 'amount', 'f10', 'f9', 'TranType'].sort(compareParamNames)).toEqual([
      'amount', 'Email', 'f9', 'f10', 'oid', 'TranType',
    ]);
    // character by character: '.' (0x2E) sorts before digits
    expect(['a1', 'a.b', 'EXTRA.TRXDATE', 'extra.cardbrand'].sort(compareParamNames)).toEqual([
      'a.b', 'a1', 'extra.cardbrand', 'EXTRA.TRXDATE',
    ]);
  });
});

describe('Est — verifyEst3DCallback', () => {
  it('accepts a bank-signed callback', () => {
    expect(verifyEst3DCallback(cb3d, cfg.storeKey)).toBe(true);
  });
  it('rejects tampered, added, wrong-key, missing-hash and non-string payloads', () => {
    expect(verifyEst3DCallback({ ...cb3dPay, amount: '0.01' }, cfg.storeKey)).toBe(false);
    expect(verifyEst3DCallback({ ...cb3dPay, orderId: 'X' }, cfg.storeKey)).toBe(false);
    expect(verifyEst3DCallback(cb3dPay, 'other')).toBe(false);
    expect(verifyEst3DCallback({ ...cb3dPay, HASH: '' }, cfg.storeKey)).toBe(false);
    expect(verifyEst3DCallback({ ...cb3dPay, mdStatus: ['1'] as any }, cfg.storeKey)).toBe(false);
    expect(verifyEst3DCallback(null as any, cfg.storeKey)).toBe(false);
  });
});

describe('Est — initThreeDSPayment', () => {
  const formFields = (html: string) =>
    Object.fromEntries([...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));

  it('posts a signed ver3 form to /fim/est3Dgate', async () => {
    const res = await new Est(cfg).initThreeDSPayment(threeDSRequest);
    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(res.paymentId).toBe('PFY-0001');
    expect(res.threeDSHtmlContent).toContain('action="https://entegrasyon.asseco-see.com.tr/fim/est3Dgate"');
    const f = formFields(res.threeDSHtmlContent!);
    expect(f).toMatchObject({
      clientid: cfg.clientId, storetype: '3d', amount: '249.90', currency: '949', oid: 'PFY-0001',
      taksit: '3', pan: '4508034508034509', Ecom_Payment_Card_ExpDate_Month: '01',
      Ecom_Payment_Card_ExpDate_Year: '29', hashAlgorithm: 'ver3',
    });
    expect(f.cardHolderName).toBeUndefined();
    const { hash, ...rest } = f;
    expect(hash).toBe(buildEstHashV3(rest, cfg.storeKey));
  });

  it('sends no card fields for hosted store types', async () => {
    for (const storeType of ['3d_pay_hosting', '3d_host']) {
      const res = await new Est({ ...cfg, storeType }).initThreeDSPayment({ ...threeDSRequest, paymentCard: undefined });
      const f = formFields(res.threeDSHtmlContent!);
      expect(f.storetype).toBe(storeType);
      expect(f.pan).toBeUndefined();
      expect(f.cv2).toBeUndefined();
    }
  });

  it('HTML-escapes form values', async () => {
    const res = await new Est(cfg).initThreeDSPayment({ ...threeDSRequest, callbackUrl: 'https://x/cb?a=1&b="2"<' });
    expect(res.threeDSHtmlContent).toContain('value="https://x/cb?a=1&amp;b=&quot;2&quot;&lt;"');
  });

  it('fails instead of defaulting an unsupported currency to TRY', async () => {
    const res = await new Est(cfg).initThreeDSPayment({ ...threeDSRequest, currency: 'JPY' });
    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(res.errorMessage).toMatch(/JPY/);
  });
});

describe('Est — completeThreeDSPayment (3d)', () => {
  it('verifies, then charges with XML Auth using md; bank approval decides', async () => {
    const p = new Est(cfg);
    const post = mockPost(p, APPROVED);
    const res = await p.completeThreeDSPayment(cb3d);
    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(res.paymentId).toBe('PFY-0001');
    const body = sentXml(post);
    expect(post.mock.calls[0][0]).toBe('/fim/api');
    for (const tag of ['<Type>Auth</Type>', '<Number>MD-TOKEN</Number>', '<Total>249.90</Total>', '<Currency>949</Currency>', '<Taksit>3</Taksit>', '<PayerAuthenticationCode>CAVV=</PayerAuthenticationCode>']) {
      expect(body).toContain(tag);
    }
  });

  it('rejects a forged or tampered callback without calling the bank', async () => {
    const p = new Est(cfg);
    const post = mockPost(p);
    for (const bad of [{ ...cb3d, amount: '1.00' }, { mdStatus: '1', oid: 'PFY-0001', ProcReturnCode: '00' }, signed({ ...cb3d, HASH: undefined } as any, 'wrong')]) {
      const res = await p.completeThreeDSPayment(bad);
      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(res.errorCode).toBe('INVALID_HASH');
      expect(res.paymentId).toBeUndefined();
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a signed callback from another store', async () => {
    const p = new Est(cfg);
    const post = mockPost(p);
    const { HASH: _h, ...fields } = cb3d;
    const res = await p.completeThreeDSPayment(signed({ ...fields, clientid: '999' }));
    expect(res.errorCode).toBe('INVALID_HASH');
    expect(post).not.toHaveBeenCalled();
  });

  it('only charges accepted mdStatus values (default 1)', async () => {
    const { HASH: _h, ...fields } = cb3d;
    const half = signed({ ...fields, mdStatus: '2' });
    const p = new Est(cfg);
    const post = mockPost(p);
    const res = await p.completeThreeDSPayment(half);
    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect(res.errorCode).toBe('MD_STATUS_2');
    expect(post).not.toHaveBeenCalled();

    const lenient = new Est({ ...cfg, acceptedMdStatuses: ['1', '2'] });
    mockPost(lenient, APPROVED);
    expect((await lenient.completeThreeDSPayment(half)).status).toBe(PaymentStatus.SUCCESS);
  });

  it('bank decline → failure carrying the verified order id', async () => {
    const p = new Est(cfg);
    mockPost(p, DECLINED);
    const res = await p.completeThreeDSPayment(cb3d);
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05', errorMessage: 'Do not honour', paymentId: 'PFY-0001' });
  });

  it('no answer to the Auth → PENDING/NETWORK_ERROR with the order id', async () => {
    const p = new Est(cfg);
    mockPost(p, networkError);
    const res = await p.completeThreeDSPayment(cb3d);
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'PFY-0001' });
    expect(JSON.stringify(res)).not.toContain('apipass');
  });
});

describe('Est — completeThreeDSPayment (3d_pay)', () => {
  const p3 = () => new Est({ ...cfg, storeType: '3d_pay' });

  it('confirms an approved callback with ORDERSTATUS', async () => {
    const p = p3();
    const post = mockPost(p, CAPTURED);
    const res = await p.completeThreeDSPayment(cb3dPay);
    expect(res).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'PFY-0002' });
    expect(sentXml(post)).toContain('<Extra><ORDERSTATUS>SOR</ORDERSTATUS></Extra>');
    expect(sentXml(post)).toContain('<OrderId>PFY-0002</OrderId>');
  });

  it('rejects when the bank does not show a captured sale', async () => {
    for (const answer of [statusXml({ TRANS_STAT: 'D', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '0' }), xml({ ProcReturnCode: '99', Response: 'Error', ErrMsg: 'No record' })]) {
      const p = p3();
      mockPost(p, answer);
      const res = await p.completeThreeDSPayment(cb3dPay);
      expect(res.status).toBe(PaymentStatus.FAILURE);
      expect(res.errorCode).toBe('INVALID_HASH');
      expect(res.paymentId).toBe('PFY-0002');
    }
  });

  it('declined callback → failure, no bank call', async () => {
    const { HASH: _h, ...fields } = cb3dPay;
    const p = p3();
    const post = mockPost(p);
    const res = await p.completeThreeDSPayment(signed({ ...fields, Response: 'Declined', ProcReturnCode: '51', ErrMsg: 'Insufficient funds' }));
    expect(res).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51', paymentId: 'PFY-0002' });
    expect(post).not.toHaveBeenCalled();
  });

  it('no answer to the confirmation → PENDING (the bank already charged)', async () => {
    const p = p3();
    mockPost(p, networkError);
    const res = await p.completeThreeDSPayment(cb3dPay);
    expect(res).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'PFY-0002' });
  });
});

describe('Est — XML API operations', () => {
  it('createPayment: XML Auth with credentials; approve/decline/no answer', async () => {
    const p = new Est(cfg);
    const post = mockPost(p, APPROVED, DECLINED, networkError);
    const ok = await p.createPayment(threeDSRequest);
    expect(ok).toMatchObject({ status: PaymentStatus.SUCCESS, paymentId: 'PFY-0001' });
    const body = sentXml(post);
    for (const tag of ['<Name>apiuser</Name>', '<Password>apipass</Password>', '<ClientId>700655000200</ClientId>', '<Expires>01/29</Expires>', '<Number>4508034508034509</Number>']) {
      expect(body).toContain(tag);
    }
    // non-ASCII is sent as character references
    expect(body).toContain('Ay&#351;e Y&#305;lmaz');
    expect((await p.createPayment(threeDSRequest)).status).toBe(PaymentStatus.FAILURE);
    expect(await p.createPayment(threeDSRequest)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('refund: XML Credit', async () => {
    const p = new Est(cfg);
    const post = mockPost(p, APPROVED, DECLINED, networkError);
    const req = { paymentId: 'PFY-0001', price: '50', currency: 'TRY', ip: '1.1.1.1' } as any;
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.SUCCESS, refundId: 'T-1' });
    expect(sentXml(post)).toContain('<Type>Credit</Type>');
    expect(sentXml(post)).toContain('<Total>50.00</Total>');
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(await p.refund(req)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('cancel: XML Void', async () => {
    const p = new Est(cfg);
    const post = mockPost(p, APPROVED, DECLINED, networkError);
    const req = { paymentId: 'PFY-0001', ip: '1.1.1.1' } as any;
    expect(await p.cancel(req)).toMatchObject({ status: PaymentStatus.SUCCESS, voidId: 'PFY-0001' });
    expect(sentXml(post)).toContain('<Type>Void</Type>');
    expect(await p.cancel(req)).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '05' });
    expect(await p.cancel(req)).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR' });
  });

  it('getPayment maps ORDERSTATUS', async () => {
    const p = new Est(cfg);
    mockPost(
      p,
      CAPTURED,
      statusXml({ TRANS_STAT: 'V', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '1000' }),
      statusXml({ TRANS_STAT: 'C', CHARGE_TYPE_CD: 'C', CAPTURE_AMT: '1000' }),
      statusXml({ TRANS_STAT: 'D', CHARGE_TYPE_CD: 'S', PROC_RET_CD: '51' }),
      statusXml({ TRANS_STAT: 'A', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '0' }),
      xml({ ProcReturnCode: '99', Response: 'Error', ErrMsg: 'No record' }),
    );
    expect((await p.getPayment('PFY-0002')).status).toBe(PaymentStatus.SUCCESS);
    expect((await p.getPayment('PFY-0002')).status).toBe(PaymentStatus.CANCELLED);
    expect((await p.getPayment('PFY-0002')).status).toBe(PaymentStatus.CANCELLED);
    expect(await p.getPayment('PFY-0002')).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '51' });
    expect((await p.getPayment('PFY-0002')).status).toBe(PaymentStatus.PENDING);
    expect(await p.getPayment('PFY-0002')).toMatchObject({ status: PaymentStatus.FAILURE, errorCode: '99' });
  });

  it('getPayment without an answer → PENDING/NETWORK_ERROR', async () => {
    const p = new Est(cfg);
    mockPost(p, networkError);
    expect(await p.getPayment('PFY-0002')).toMatchObject({ status: PaymentStatus.PENDING, errorCode: 'NETWORK_ERROR', paymentId: 'PFY-0002' });
  });

  it('a non-CC5 body is a failure', async () => {
    const p = new Est(cfg);
    mockPost(p, '<html>502</html>');
    expect((await p.cancel({ paymentId: 'x' } as any)).status).toBe(PaymentStatus.FAILURE);
  });

  it('parses Extra separately from top-level fields', () => {
    const r = parseCC5Response(xml({ ProcReturnCode: '00', ErrMsg: 'a &amp; b' }, { TRANS_STAT: 'S' }));
    expect(r.fields).toEqual({ ProcReturnCode: '00', ErrMsg: 'a & b' });
    expect(r.extra).toEqual({ TRANS_STAT: 'S' });
  });
});
