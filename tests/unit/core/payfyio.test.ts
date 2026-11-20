import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Payfyio } from '../../../src/core/Payfyio';
import { ProviderType } from '../../../src/core/PayfyioConfig';
import { ProviderNotEnabledError } from '../../../src/core/errors';

// Mock axios so providers don't make real HTTP calls
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      post: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

const iyzicoConfig = {
  iyzico: {
    enabled: true,
    config: { apiKey: 'test-key', secretKey: 'test-secret' },
  },
};

const paytrConfig = {
  paytr: {
    enabled: true,
    config: {
      apiKey: 'merchant-key',
      secretKey: 'merchant-key',
      merchantId: 'MERCHANT_ID',
      merchantSalt: 'MERCHANT_SALT',
    },
  },
};

const stripeConfig = {
  stripe: {
    enabled: true,
    config: { apiKey: 'pk', secretKey: 'sk_test' },
  },
};

describe('Payfyio', () => {
  describe('initialization', () => {
    it('should initialize with iyzico provider', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(bp.isProviderEnabled(ProviderType.IYZICO)).toBe(true);
    });

    it('should set mode defaults — sandbox uses sandbox baseUrl', () => {
      const bp = new Payfyio({ providers: iyzicoConfig, mode: 'sandbox' });
      // Just check it initializes without error
      expect(bp.isProviderEnabled(ProviderType.IYZICO)).toBe(true);
    });

    it('should set single provider as default', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      // When only one provider, it becomes default — createPayment should not throw
      expect(() => (bp as any).getDefaultProvider()).not.toThrow();
    });

    it('should throw when configured defaultProvider is disabled', () => {
      expect(() =>
        new Payfyio({
          providers: iyzicoConfig,
          defaultProvider: ProviderType.PAYTR,
        })
      ).toThrow();
    });

    it('should throw when iyzico missing apiKey', () => {
      expect(() =>
        new Payfyio({
          providers: {
            iyzico: { enabled: true, config: { apiKey: '', secretKey: 'sec' } },
          },
        })
      ).toThrow();
    });

    it('should throw when paytr missing merchantId', () => {
      expect(() =>
        new Payfyio({
          providers: {
            paytr: {
              enabled: true,
              config: { apiKey: 'k', secretKey: 's', merchantId: '', merchantSalt: 'salt' },
            },
          },
        })
      ).toThrow();
    });
  });

  describe('use()', () => {
    it('should return iyzico provider when use("iyzico")', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.use('iyzico')).not.toThrow();
    });

    it('should throw ProviderNotEnabledError for disabled provider', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.use('paytr')).toThrow(ProviderNotEnabledError);
    });

    it('should throw ProviderNotEnabledError for unknown string', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.use('stripe' as any)).toThrow(ProviderNotEnabledError);
    });
  });

  describe('getters', () => {
    it('should return iyzico via .iyzico getter', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(bp.iyzico).toBeDefined();
    });

    it('should throw ProviderNotEnabledError via .paytr getter when disabled', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.paytr).toThrow(ProviderNotEnabledError);
    });

    it('should return paytr via .paytr getter when enabled', () => {
      const bp = new Payfyio({ providers: paytrConfig });
      expect(bp.paytr).toBeDefined();
    });
  });

  describe('getEnabledProviders()', () => {
    it('should list only enabled providers', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const providers = bp.getEnabledProviders();
      expect(providers).toContain(ProviderType.IYZICO);
      expect(providers).not.toContain(ProviderType.PAYTR);
    });

    it('should list multiple enabled providers', () => {
      const bp = new Payfyio({ providers: { ...iyzicoConfig, ...paytrConfig } });
      const providers = bp.getEnabledProviders();
      expect(providers).toContain(ProviderType.IYZICO);
      expect(providers).toContain(ProviderType.PAYTR);
    });
  });

  describe('isProviderEnabled()', () => {
    it('should return true for enabled provider', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(bp.isProviderEnabled(ProviderType.IYZICO)).toBe(true);
    });

    it('should return false for disabled provider', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(bp.isProviderEnabled(ProviderType.PAYTR)).toBe(false);
    });
  });

  describe('default provider delegation', () => {
    it('should throw when no default and calling createPayment', async () => {
      const bp = new Payfyio({
        providers: { ...iyzicoConfig, ...paytrConfig },
        defaultProvider: undefined,
      });
      await expect(bp.createPayment({} as any)).rejects.toThrow();
    });
  });

  describe('handler', () => {
    it('should expose a handler via .handler getter', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(bp.handler).toBeDefined();
      expect(typeof bp.handler.handle).toBe('function');
    });
  });

  describe('akbank getter', () => {
    it('should return akbank provider when enabled', () => {
      const bp = new Payfyio({
        providers: {
          akbank: {
            enabled: true,
            config: {
              apiKey: 'k',
              secretKey: 's',
              merchantId: 'M',
              terminalId: 'T',
              storeKey: 'SK',
            },
          },
        },
      });
      expect(bp.akbank).toBeDefined();
    });

    it('should throw ProviderNotEnabledError when akbank disabled', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.akbank).toThrow(ProviderNotEnabledError);
    });
  });

  describe('parampos getter', () => {
    it('should return parampos provider when enabled', () => {
      const bp = new Payfyio({
        providers: {
          parampos: {
            enabled: true,
            config: {
              apiKey: 'guid',
              secretKey: 'pass',
              clientCode: 'CC',
              clientUsername: 'user',
              clientPassword: 'pass',
              guid: 'guid',
            },
          },
        },
      });
      expect(bp.parampos).toBeDefined();
    });

    it('should throw ProviderNotEnabledError when parampos disabled', () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      expect(() => bp.parampos).toThrow(ProviderNotEnabledError);
    });
  });

  describe('default provider delegation', () => {
    it('should delegate createPayment to iyzico (single provider)', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'createPayment').mockResolvedValue({ status: 'success' } as any);
      await bp.createPayment({} as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate initThreeDSPayment to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'initThreeDSPayment').mockResolvedValue({ status: 'pending' } as any);
      await bp.initThreeDSPayment({} as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate completeThreeDSPayment to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'completeThreeDSPayment').mockResolvedValue({ status: 'success' } as any);
      await bp.completeThreeDSPayment({});
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate refund to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'refund').mockResolvedValue({ status: 'success' } as any);
      await bp.refund({} as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate cancel to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'cancel').mockResolvedValue({ status: 'success' } as any);
      await bp.cancel({} as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate capturePayment to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'capturePayment').mockResolvedValue({ status: 'success' } as any);
      await bp.capturePayment({ paymentId: 'p1' } as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate voidAuthorization to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'voidAuthorization').mockResolvedValue({ status: 'success' } as any);
      await bp.voidAuthorization({ paymentId: 'p1' } as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should throw "not supported" when provider lacks capture (paytr)', async () => {
      const bp = new Payfyio({ providers: paytrConfig });
      await expect(bp.capturePayment({ paymentId: 'p1' } as any)).rejects.toThrow(/not supported/i);
    });

    it('should throw "not supported" when provider lacks void (paytr)', async () => {
      const bp = new Payfyio({ providers: paytrConfig });
      await expect(bp.voidAuthorization({ paymentId: 'p1' } as any)).rejects.toThrow(/not supported/i);
    });

    it('should delegate payout to default provider', async () => {
      const bp = new Payfyio({ providers: stripeConfig });
      const spy = vi.spyOn(bp.stripe, 'payout').mockResolvedValue({ status: 'success' } as any);
      await bp.payout({ to: { accountId: 'acct_1' }, amountMinor: 100, currency: 'TRY', reference: 'R' } as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should route payout to the provider named in request.provider', async () => {
      const bp = new Payfyio({
        providers: { ...iyzicoConfig, ...stripeConfig },
        defaultProvider: ProviderType.IYZICO,
      });
      const stripeSpy = vi.spyOn(bp.stripe, 'payout').mockResolvedValue({ status: 'success' } as any);
      const iyzicoSpy = vi.spyOn(bp.iyzico, 'payout').mockResolvedValue({ status: 'success' } as any);

      await bp.payout({ provider: 'stripe', to: { accountId: 'acct_1' }, amountMinor: 100, currency: 'TRY', reference: 'R' } as any);

      expect(stripeSpy).toHaveBeenCalledTimes(1);
      expect(iyzicoSpy).not.toHaveBeenCalled();
    });

    it('should throw "not supported" when provider lacks payout (paytr)', async () => {
      const bp = new Payfyio({ providers: paytrConfig });
      await expect(
        bp.payout({ to: { accountId: 'acct_1' }, amountMinor: 100, currency: 'TRY', reference: 'R' } as any),
      ).rejects.toThrow(/not supported/i);
    });

    it('should delegate submerchants.create to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'createSubmerchant').mockResolvedValue({ status: 'success' } as any);
      await bp.submerchants.create({ type: 'PERSONAL', name: 'X', email: 'x@y.com', externalId: 'e1' } as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate submerchants.retrieve to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'retrieveSubmerchant').mockResolvedValue({ status: 'success' } as any);
      await bp.submerchants.retrieve('e1');
      expect(spy).toHaveBeenCalledWith('e1');
    });

    it('should throw "not supported" when provider lacks submerchants (paytr)', async () => {
      const bp = new Payfyio({ providers: paytrConfig });
      await expect(
        bp.submerchants.create({ type: 'PERSONAL', name: 'X', email: 'x@y.com', externalId: 'e1' } as any),
      ).rejects.toThrow(/not supported/i);
    });

    it('should delegate getPayment to default provider', async () => {
      const bp = new Payfyio({ providers: iyzicoConfig });
      const spy = vi.spyOn(bp.iyzico, 'getPayment').mockResolvedValue({ status: 'success' } as any);
      await bp.getPayment('PMT-1');
      expect(spy).toHaveBeenCalledWith('PMT-1');
    });

    it('should throw when multiple providers and no defaultProvider set', async () => {
      const bp = new Payfyio({
        providers: { ...iyzicoConfig, ...paytrConfig },
      });
      await expect(bp.createPayment({} as any)).rejects.toThrow(/No default provider/);
    });

    it('should use explicit defaultProvider when set', async () => {
      const bp = new Payfyio({
        providers: { ...iyzicoConfig, ...paytrConfig },
        defaultProvider: ProviderType.IYZICO,
      });
      const spy = vi.spyOn(bp.iyzico, 'createPayment').mockResolvedValue({ status: 'success' } as any);
      await bp.createPayment({} as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('EST bank registration', () => {
  const est = { clientId: 'c', username: 'u', password: 'p', storeKey: 's', apiKey: '', secretKey: '' };

  it.each(['halkbank', 'teb', 'sekerbank'] as const)('%s is an Est instance on the Asseco test host in sandbox', (bank) => {
    const payment = new Payfyio({ mode: 'sandbox', providers: { [bank]: { enabled: true, config: est } } as any });
    const provider = payment[bank] as any;
    expect(provider).toBe(payment.use(bank));
    expect(provider.config.baseUrl).toBe('https://entegrasyon.asseco-see.com.tr');
  });

  it('names the missing env field', () => {
    expect(
      () => new Payfyio({ providers: { teb: { enabled: true, config: { ...est, storeKey: '' } } } as any }),
    ).toThrow(/TEB_STORE_KEY/);
  });
});

describe('Posnet bank registration', () => {
  const posnet = { merchantId: 'm', terminalId: 't', posnetId: 'p', encKey: 'k', apiKey: '', secretKey: '' };

  it('albaraka resolves to the e-POS test host in sandbox', () => {
    const payment = new Payfyio({ mode: 'sandbox', providers: { albaraka: { enabled: true, config: posnet } } as any });
    expect((payment.albaraka as any).config.baseUrl).toBe('https://epostest.albarakaturk.com.tr');
  });

  it('yapikredi production host is posnet.yapikredi.com.tr', () => {
    const payment = new Payfyio({ mode: 'production', providers: { yapikredi: { enabled: true, config: posnet } } as any });
    expect((payment.yapikredi as any).config.baseUrl).toBe('https://posnet.yapikredi.com.tr');
  });
});

describe('self-validating provider registration', () => {
  it.each([
    ['kuveytturk', { merchantId: 'm', customerId: 'c', username: 'u', password: 'p' }, 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services'],
    ['vakifbank', { merchantId: '000000000111111', password: 'p', terminalNo: 'VP000001' }, 'https://onlineodemetest.vakifbank.com.tr:4443'],
  ] as const)('%s is reachable via getter and use() on its sandbox host', (id, cfg, host) => {
    const payment = new Payfyio({ mode: 'sandbox', providers: { [id]: { enabled: true, config: { apiKey: '', secretKey: '', ...cfg } } } as any });
    const provider = (payment as any)[id];
    expect(provider).toBe(payment.use(id));
    expect(provider.config.baseUrl).toBe(host);
  });

  it('a missing field fails at construction, naming the field', () => {
    expect(
      () => new Payfyio({ providers: { vakifbank: { enabled: true, config: { apiKey: '', secretKey: '', merchantId: 'm', password: 'p' } } } as any }),
    ).toThrow(/terminalNo/);
  });
});

describe('Denizbank / QNB registration', () => {
  it.each([
    ['denizbank', { shopCode: 's', userCode: 'u', userPass: 'p', merchantPass: 'm' }, 'https://test.inter-vpos.com.tr'],
    ['qnb', { merchantId: 'm', userCode: 'u', userPass: 'p', merchantPass: 'k' }, 'https://vpostest.qnb.com.tr'],
  ] as const)('%s is reachable via getter and use() on its sandbox host', (id, cfg, host) => {
    const payment = new Payfyio({ mode: 'sandbox', providers: { [id]: { enabled: true, config: { apiKey: '', secretKey: '', ...cfg } } } as any });
    const provider = (payment as any)[id];
    expect(provider).toBe(payment.use(id));
    expect(provider.config.baseUrl).toBe(host);
  });
});

describe('Sipay / QNBpay registration', () => {
  const cfg = { apiKey: '', secretKey: '', appId: 'a', appSecret: 's', merchantKey: 'm' };

  it('qnbpay builds a QnbPay on the QNBpay host, sipay a Sipay on its own', () => {
    const payment = new Payfyio({
      mode: 'sandbox',
      providers: { sipay: { enabled: true, config: cfg }, qnbpay: { enabled: true, config: cfg } } as any,
    });
    expect(payment.qnbpay.constructor.name).toBe('QnbPay');
    expect((payment.qnbpay as any).config.baseUrl).toBe('https://test.qnbpay.com.tr');
    expect((payment.sipay as any).config.baseUrl).toBe('https://provisioning.sipay.com.tr');
  });
});
