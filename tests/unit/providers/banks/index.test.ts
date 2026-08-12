import { describe, it, expect } from 'vitest';
import { Garanti } from '../../../../src/providers/garanti';
import { Isbank } from '../../../../src/providers/isbank';
import { YapiKredi } from '../../../../src/providers/yapikredi';
import { Ziraat } from '../../../../src/providers/ziraat';
import { createHash } from 'crypto';
import {
  buildSecurityData,
  buildHashData,
  build3DHashData,
  verifyGaranti3DHash,
  formatGarantiAmount,
} from '../../../../src/providers/garanti/utils';
import {
  buildNestPayV3Hash,
  formatIsbankAmount,
} from '../../../../src/providers/isbank/utils';
import {
  buildPosnet3DHash,
  formatYapiKrediAmount,
  formatExpDateYYMM,
} from '../../../../src/providers/yapikredi/utils';

const garantiCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://sanalposprovtest.garantibbva.com.tr',
  merchantId: 'M1',
  terminalId: '30691298',
  provisionUser: 'PROVAUT',
  provisionPassword: 'p',
  storeKey: 'sk',
  secure3DStoreKey: 's3d',
} as any;

/** Sign a fake Garanti 3D callback the way the bank would. */
function signGarantiCallback(fields: Record<string, string>, storeKey: string) {
  const names = Object.keys(fields);
  const hashparamsval = names.map((n) => fields[n]).join('');
  return {
    ...fields,
    hashparams: `${names.join(':')}:`,
    hashparamsval,
    hash: createHash('sha512').update(hashparamsval + storeKey, 'utf8').digest('hex').toUpperCase(),
  };
}

const approvedCallback = {
  clientid: '30691298',
  oid: 'ORDER-1',
  authcode: '123456',
  procreturncode: '00',
  response: 'Approved',
  mdstatus: '1',
  cavv: 'CAVV',
  eci: '02',
  md: 'MD',
  rnd: 'RND',
};

const isbankCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://entegrasyon.asseco-see.com.tr',
  clientId: 'cid',
  username: 'u',
  password: 'p',
  storeKey: 'sk',
} as any;

const ykbCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://setmpos.ykb.com',
  merchantId: 'mid',
  terminalId: 'tid',
  posnetId: 'pid',
  encKey: 'enc',
} as any;

const ziraatCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://preprod.ziraatpay.com.tr',
  clientId: 'cid',
  username: 'u',
  password: 'p',
  storeKey: 'sk',
} as any;

describe('Garanti provider', () => {
  it('rejects missing required fields', () => {
    expect(() => new Garanti({ ...garantiCfg, merchantId: '' })).toThrow(/merchantId/);
    expect(() => new Garanti({ ...garantiCfg, terminalId: '' })).toThrow(/terminalId/);
    expect(() => new Garanti({ ...garantiCfg, provisionUser: '' })).toThrow(/provisionUser/);
    expect(() => new Garanti({ ...garantiCfg, provisionPassword: '' })).toThrow(/provisionPassword/);
    expect(() => new Garanti({ ...garantiCfg, storeKey: '' })).toThrow(/storeKey/);
  });

  it('formats amount to integer kuruş', () => {
    expect(formatGarantiAmount('100')).toBe('10000');
    expect(formatGarantiAmount('1.5')).toBe('150');
  });

  // Golden vector straight out of the bank's own integration doc
  // (dev.garantibbva.com.tr, "Peşin satış 3D'siz" sample request). If the hash
  // chain drifts, every /VPServlet call starts failing auth — this catches it
  // without touching the network.
  it('reproduces the bank documentation hash vector', () => {
    const sd = buildSecurityData('123qweASD/', '30691297');
    expect(sd).toBe('BAF0BF326B0261A4288A7273F18674FF35E9826F');
    expect(
      buildHashData({
        orderId: 'fa18e7e829694365818ff7672292d608',
        terminalId: '30691297',
        cardNumber: '5406697543211173',
        amount: '10000',
        currencyCode: '949',
        securityData: sd,
      }),
    ).toBe(
      'D7779FDADE4FD3124B66B12F6F7BA34CFBE2FBBED6F06D7D667A52A2B499FE01438AFCAC753F566AFAF7EAAFA10053061F712B7F111F76E964D18BBAE18A6ACA',
    );
  });

  it('3D request hash is SHA-512 hex', () => {
    const out = build3DHashData({
      terminalId: 't',
      orderId: 'o',
      amount: '100',
      currencyCode: '949',
      successUrl: 'https://s',
      failUrl: 'https://f',
      txnType: 'sales',
      installment: '',
      storeKey: 'sk',
      securityData: 'sd',
    });
    expect(out).toMatch(/^[A-F0-9]{128}$/);
  });

  it('init 3DS returns a v512 3D_PAY redirect form in TEST mode', async () => {
    const p = new Garanti(garantiCfg);
    const res = await p.initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('<form');
    expect(res.threeDSHtmlContent).toContain('name="apiversion" value="512"');
    expect(res.threeDSHtmlContent).toContain('name="secure3dsecuritylevel" value="3D_PAY"');
    expect(res.threeDSHtmlContent).toContain('name="mode" value="TEST"');
    expect(res.threeDSHtmlContent).toContain('name="txnamount" value="1000"');
    expect(res.threeDSHtmlContent).toContain('secure3dhash');
  });

  it('confirms a correctly signed 3D callback', async () => {
    const p = new Garanti(garantiCfg);
    const res = await p.completeThreeDSPayment(signGarantiCallback(approvedCallback, 's3d'));
    expect(res.status).toBe('success');
    expect(res.paymentId).toBe('ORDER-1');
  });

  // SECURITY: these are the forged-callback cases. Each must stay a failure.
  it('rejects a tampered or unsigned 3D callback', async () => {
    const p = new Garanti(garantiCfg);
    const signed = signGarantiCallback(approvedCallback, 's3d');

    // no signature at all
    expect((await p.completeThreeDSPayment(approvedCallback)).status).toBe('failure');
    // signed with the wrong store key
    expect(
      (await p.completeThreeDSPayment(signGarantiCallback(approvedCallback, 'wrong'))).status,
    ).toBe('failure');
    // values swapped after signing
    expect(
      (await p.completeThreeDSPayment({ ...signed, mdstatus: '0', procreturncode: '99' })).status,
    ).toBe('failure');
    // valid signature, but over a field set that excludes the decision fields
    expect(
      (await p.completeThreeDSPayment({
        ...signGarantiCallback({ oid: 'ORDER-1', response: 'Approved' }, 's3d'),
        mdstatus: '1',
        procreturncode: '00',
      })).status,
    ).toBe('failure');
  });

  it('rejects a signed callback that the bank itself declined', async () => {
    const p = new Garanti(garantiCfg);
    const declined = await p.completeThreeDSPayment(
      signGarantiCallback({ ...approvedCallback, mdstatus: '0', response: 'Error' }, 's3d'),
    );
    expect(declined.status).toBe('failure');
    expect(declined.errorMessage).toMatch(/mdStatus=0/);

    const unauthorized = await p.completeThreeDSPayment(
      signGarantiCallback({ ...approvedCallback, procreturncode: '05', response: 'Declined' }, 's3d'),
    );
    expect(unauthorized.status).toBe('failure');
    expect(unauthorized.errorMessage).toMatch(/procReturnCode=05/);
  });

  it('verifyGaranti3DHash is exported for callback verification outside the provider', () => {
    expect(verifyGaranti3DHash(signGarantiCallback(approvedCallback, 'sk'), 'sk')).toBe(true);
    expect(verifyGaranti3DHash(signGarantiCallback(approvedCallback, 'sk'), 'other')).toBe(false);
  });
});

describe('Isbank provider', () => {
  it('rejects missing required fields', () => {
    expect(() => new Isbank({ ...isbankCfg, clientId: '' })).toThrow(/clientId/);
    expect(() => new Isbank({ ...isbankCfg, username: '' })).toThrow(/username/);
    expect(() => new Isbank({ ...isbankCfg, password: '' })).toThrow(/password/);
    expect(() => new Isbank({ ...isbankCfg, storeKey: '' })).toThrow(/storeKey/);
  });

  it('formats amount to two decimals', () => {
    expect(formatIsbankAmount('10')).toBe('10.00');
    expect(formatIsbankAmount('10.5')).toBe('10.50');
  });

  it('NestPay v3 hash is deterministic and base64', () => {
    const h = buildNestPayV3Hash(['a', 'b', 'c'], 'k');
    expect(h).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('init 3DS returns redirect form HTML', async () => {
    const p = new Isbank(isbankCfg);
    const res = await p.initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('<form');
    expect(res.threeDSHtmlContent).toContain('hashAlgorithm');
  });
});

describe('YapiKredi provider', () => {
  it('rejects missing required fields', () => {
    expect(() => new YapiKredi({ ...ykbCfg, merchantId: '' })).toThrow(/merchantId/);
    expect(() => new YapiKredi({ ...ykbCfg, terminalId: '' })).toThrow(/terminalId/);
    expect(() => new YapiKredi({ ...ykbCfg, posnetId: '' })).toThrow(/posnetId/);
    expect(() => new YapiKredi({ ...ykbCfg, encKey: '' })).toThrow(/encKey/);
  });

  it('formats expiry as YYMM', () => {
    expect(formatExpDateYYMM('1', '2030')).toBe('3001');
    expect(formatExpDateYYMM('12', '25')).toBe('2512');
  });

  it('formats amount to integer kuruş', () => {
    expect(formatYapiKrediAmount('1')).toBe('100');
    expect(formatYapiKrediAmount('99.99')).toBe('9999');
  });

  it('Posnet 3D hash returns base64', () => {
    const h = buildPosnet3DHash({
      merchantId: 'm',
      terminalId: 't',
      amount: '100',
      currency: 'TL',
      orderId: 'o',
      xid: 'x',
      okUrl: 'https://o',
      failUrl: 'https://f',
      encKey: 'k',
    });
    expect(h).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('init 3DS returns redirect form HTML', async () => {
    const p = new YapiKredi(ykbCfg);
    const res = await p.initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('<form');
    expect(res.threeDSHtmlContent).toContain('digest');
  });
});

describe('Ziraat provider', () => {
  it('rejects missing required fields', () => {
    expect(() => new Ziraat({ ...ziraatCfg, clientId: '' })).toThrow(/clientId/);
    expect(() => new Ziraat({ ...ziraatCfg, username: '' })).toThrow(/username/);
    expect(() => new Ziraat({ ...ziraatCfg, password: '' })).toThrow(/password/);
    expect(() => new Ziraat({ ...ziraatCfg, storeKey: '' })).toThrow(/storeKey/);
  });

  it('init 3DS returns NestPay v3 form', async () => {
    const p = new Ziraat(ziraatCfg);
    const res = await p.initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('<form');
    expect(res.threeDSHtmlContent).toContain('hashAlgorithm');
  });

  it('completeThreeDSPayment fails when mdStatus rejected', async () => {
    const p = new Ziraat(ziraatCfg);
    const res = await p.completeThreeDSPayment({ mdStatus: '0', oid: 'o1' });
    expect(res.status).toBe('failure');
    expect(res.errorMessage).toMatch(/mdStatus=0/);
  });

  // SECURITY: even with mdStatus=1, the provider must NOT report success
  // until the NestPay response-HASH is verified. Until that is implemented
  // it fails closed so a forged callback can't mark an unpaid order as paid.
  it('completeThreeDSPayment fails closed when callback hash is unverified', async () => {
    const p = new Ziraat(ziraatCfg);
    const res = await p.completeThreeDSPayment({ mdStatus: '1', oid: 'o1', ProcReturnCode: '00' });
    expect(res.status).toBe('failure');
    expect(res.errorMessage).toMatch(/hash verification is not implemented/i);
  });
});
