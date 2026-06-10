import { describe, it, expect } from 'vitest';
import { Garanti } from '../../../../src/providers/garanti';
import { Isbank } from '../../../../src/providers/isbank';
import { YapiKredi } from '../../../../src/providers/yapikredi';
import { Ziraat } from '../../../../src/providers/ziraat';
import {
  buildSecurityData,
  buildHashData,
  build3DHashData,
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

  it('builds deterministic security and hash data', () => {
    const sd = buildSecurityData('pwd', '30691298');
    expect(sd).toMatch(/^[A-F0-9]{40}$/);
    const hd = buildHashData({
      orderId: 'o',
      terminalId: '30691298',
      cardNumber: '4111',
      amount: '100',
      securityData: sd,
    });
    expect(hd).toMatch(/^[A-F0-9]{40}$/);
  });

  it('init 3DS without secure3DStoreKey returns failure', async () => {
    const p = new Garanti({ ...garantiCfg, secure3DStoreKey: undefined });
    const res = await p.initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('failure');
    expect(res.errorMessage).toMatch(/secure3DStoreKey/);
  });

  it('init 3DS returns redirect HTML form', async () => {
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
    expect(res.threeDSHtmlContent).toContain('secure3dhash');
  });

  it('uses 3DHashData helper for known input', () => {
    const out = build3DHashData({
      terminalId: 't',
      orderId: 'o',
      amount: '100',
      successUrl: 'https://s',
      failUrl: 'https://f',
      txnType: 'sales',
      installment: '',
      storeKey: 'sk',
      securityData: 'sd',
    });
    expect(out).toMatch(/^[A-F0-9]{40}$/);
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
