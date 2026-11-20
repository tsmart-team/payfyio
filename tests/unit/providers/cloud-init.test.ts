import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cloud's hosted checkout sends a stub buyer (no phone, placeholder email and
// addresses). Each provider it offers must get past its own validation with that
// payload — either rendering the 3D form locally or reaching the bank.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const client = { post, get: post, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  return { ...actual, default: { ...actual.default, create: () => client, isAxiosError: actual.isAxiosError } };
});

import { Est } from '../../../src/providers/est';
import { YapiKredi } from '../../../src/providers/yapikredi';
import { Albaraka } from '../../../src/providers/albaraka';
import { VakifBank } from '../../../src/providers/vakifbank';
import { Denizbank } from '../../../src/providers/denizbank';
import { Qnb } from '../../../src/providers/qnb';
import { Sipay } from '../../../src/providers/sipay';

const base = { apiKey: '', secretKey: '' };
const providers: [string, () => any][] = [
  ['est', () => new Est({ ...base, baseUrl: 'https://entegrasyon.asseco-see.com.tr', clientId: 'c', username: 'u', password: 'p', storeKey: 's' } as any)],
  ['yapikredi', () => new YapiKredi({ ...base, baseUrl: 'https://setmpos.ykb.com', merchantId: 'm', terminalId: 't', posnetId: 'p', encKey: '10,10,10,10,10,10,10,10' } as any)],
  ['albaraka', () => new Albaraka({ ...base, baseUrl: 'https://epostest.albarakaturk.com.tr', merchantId: 'm', terminalId: 't', posnetId: 'p', encKey: '10,10,10,10,10,10,10,10' } as any)],
  ['vakifbank', () => new VakifBank({ ...base, baseUrl: 'https://onlineodemetest.vakifbank.com.tr:4443', merchantId: '000000000111111', password: 'p', terminalNo: 'VP000001' } as any)],
  ['denizbank', () => new Denizbank({ ...base, baseUrl: 'https://test.inter-vpos.com.tr', shopCode: 's', userCode: 'u', userPass: 'p', merchantPass: 'm' } as any)],
  ['qnb', () => new Qnb({ ...base, baseUrl: 'https://vpostest.qnb.com.tr', merchantId: 'm', userCode: 'u', userPass: 'p', merchantPass: 'k' } as any)],
  ['sipay', () => new Sipay({ ...base, baseUrl: 'https://provisioning.sipay.com.tr', appId: 'a', appSecret: 's', merchantKey: 'k' } as any)],
];

/** Mirrors apps/api/src/public/public-payments.controller.ts `pay()`. */
const cloudRequest = {
  price: '100.5',
  paidPrice: '100.5',
  currency: 'TRY',
  basketId: 'order_123',
  conversationId: 'order_123',
  callbackUrl: 'https://api.example.com/api/public/projects/p/payments/x/complete?ref=order_123',
  paymentCard: { cardHolderName: 'Ali Veli', cardNumber: '4355084355084358', expireMonth: '12', expireYear: '2030', cvc: '000' },
  buyer: {
    id: 'order_123', name: 'Ali', surname: 'Veli', email: 'unknown@example.com', identityNumber: '00000000000',
    registrationAddress: 'unknown', city: 'unknown', country: 'TR', ip: '85.34.78.112', gsmNumber: '',
  },
  shippingAddress: { contactName: 'Ali Veli', city: 'unknown', country: 'TR', address: 'unknown' },
  billingAddress: { contactName: 'Ali Veli', city: 'unknown', country: 'TR', address: 'unknown' },
  basketItems: [{ id: 'order_123', name: 'order_123', category1: 'general', itemType: 'VIRTUAL', price: '100.5' }],
};

describe('cloud hosted-checkout payload reaches every cloud-offered provider', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockRejectedValue(Object.assign(new Error('stub'), { isAxiosError: true, response: { status: 500, data: 'stub' } }));
  });

  it.each(providers)('%s: no local validation failure', async (_id, make) => {
    const res = await make().initThreeDSPayment(cloudRequest);
    const reachedBank = post.mock.calls.length > 0;
    expect(res.status === 'pending' || reachedBank, JSON.stringify(res)).toBe(true);
    expect(res.errorCode).not.toBe('VALIDATION_ERROR');
  });
});
