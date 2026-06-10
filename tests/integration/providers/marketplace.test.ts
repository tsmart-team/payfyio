import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Iyzico } from '../../../src/providers/iyzico';
import { Stripe } from '../../../src/providers/stripe';

/**
 * Integration tests for the marketplace / escrow surface (capture, void,
 * payout, submerchant, split). Unlike the unit tests (which mock `sendRequest`
 * / a fresh client per case), these spy on the provider's REAL axios client and
 * assert the on-the-wire request format — endpoint, body, and (for iyzico) that
 * the request went through the real IYZWSv2 signing path.
 *
 * Transport is mocked; this does NOT hit live sandboxes. Endpoint paths and
 * field names still require a real-credential E2E pass before production.
 */

function captureClient(provider: any) {
  const requests: Array<{ url: string; data: any; headers: any }> = [];
  vi.spyOn(provider.client, 'post').mockImplementation(async (...args: unknown[]) => {
    const [url, data, config] = args as [string, any, any];
    requests.push({
      url,
      data: typeof data === 'string' && data.startsWith('{') ? JSON.parse(data) : data,
      headers: config?.headers ?? {},
    });
    return { data: { status: 'success', id: 'x', object: 'payment_intent', amount: 10000, currency: 'try' }, status: 200 };
  });
  return requests;
}

describe('Marketplace integration — iyzico', () => {
  let iyzico: Iyzico;
  beforeEach(() => {
    iyzico = new Iyzico({
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      locale: 'tr',
    });
  });

  it('capturePayment posts to /payment/postauth with a signed IYZWSv2 header', async () => {
    const reqs = captureClient(iyzico as any);
    await iyzico.capturePayment({ paymentId: 'p_1', amountMinor: 4000, currency: 'TRY' });
    expect(reqs[0].url).toBe('/payment/postauth');
    expect(reqs[0].data.paymentId).toBe('p_1');
    expect(reqs[0].data.paidPrice).toBe('40.00');
    expect(String(reqs[0].headers.Authorization || '')).toMatch(/^IYZWSv2 /);
  });

  it('voidAuthorization posts to /payment/cancel', async () => {
    const reqs = captureClient(iyzico as any);
    await iyzico.voidAuthorization({ paymentId: 'p_2', ip: '1.2.3.4' });
    expect(reqs[0].url).toBe('/payment/cancel');
    expect(reqs[0].data.paymentId).toBe('p_2');
  });

  it('createSubmerchant posts to /onboarding/submerchant with mapped fields', async () => {
    const reqs = captureClient(iyzico as any);
    await iyzico.createSubmerchant({
      type: 'PRIVATE_COMPANY',
      name: 'Carrier Ltd',
      email: 'c@x.com',
      externalId: 'carrier-1',
      iban: 'TR000000000000000000000000',
    });
    expect(reqs[0].url).toBe('/onboarding/submerchant');
    expect(reqs[0].data.subMerchantExternalId).toBe('carrier-1');
    expect(reqs[0].data.subMerchantType).toBe('PRIVATE_COMPANY');
    expect(reqs[0].data.iban).toBe('TR000000000000000000000000');
  });

  it('split is carried per basket item as subMerchantKey/subMerchantPrice', async () => {
    const reqs = captureClient(iyzico as any);
    await iyzico.createPayment({
      price: '100.00', paidPrice: '100.00', currency: 'TRY', basketId: 'B1',
      paymentCard: { cardHolderName: 'X', cardNumber: '5528790000000008', expireMonth: '12', expireYear: '2030', cvc: '123' },
      buyer: { id: 'B', name: 'J', surname: 'D', gsmNumber: '+90', email: 'j@x.com', identityNumber: '1', registrationAddress: 'a', ip: '1.2.3.4', city: 'Ist', country: 'TR' },
      shippingAddress: { contactName: 'J', city: 'Ist', country: 'TR', address: 'a' },
      billingAddress: { contactName: 'J', city: 'Ist', country: 'TR', address: 'a' },
      basketItems: [{ id: 'I1', name: 'i', category1: 'c', itemType: 'PHYSICAL', price: '100.00' }],
      split: [{ submerchantId: 'smk_1', amountMinor: 9000 }],
    } as any);
    expect(reqs[0].url).toBe('/payment/auth');
    expect(reqs[0].data.basketItems[0].subMerchantKey).toBe('smk_1');
    expect(reqs[0].data.basketItems[0].subMerchantPrice).toBe('90.00');
  });
});

describe('Marketplace integration — Stripe', () => {
  let stripe: Stripe;
  beforeEach(() => {
    stripe = new Stripe({ apiKey: 'pk', secretKey: 'sk_test', baseUrl: 'https://api.stripe.com' } as any);
  });

  it('payout posts a form-encoded transfer to /v1/transfers', async () => {
    const reqs: Array<{ url: string; data: any }> = [];
    vi.spyOn((stripe as any).client, 'post').mockImplementation(async (...args: unknown[]) => {
      const [url, data] = args as [string, string];
      reqs.push({ url, data });
      return { data: { id: 'tr_1', object: 'transfer', amount: 5000, currency: 'try', destination: 'acct_1' }, status: 200 };
    });
    await stripe.payout({ to: { accountId: 'acct_1' }, amountMinor: 5000, currency: 'TRY', reference: 'R1' });
    expect(reqs[0].url).toBe('/v1/transfers');
    expect(reqs[0].data).toContain('amount=5000');
    expect(reqs[0].data).toContain('destination=acct_1');
  });

  it('split adds transfer_data + application_fee_amount to the intent', async () => {
    const reqs: Array<{ url: string; data: any }> = [];
    vi.spyOn((stripe as any).client, 'post').mockImplementation(async (...args: unknown[]) => {
      const [url, data] = args as [string, string];
      reqs.push({ url, data });
      return { data: { id: 'pi_1', object: 'payment_intent', status: 'succeeded', amount: 10000, currency: 'try' }, status: 200 };
    });
    await stripe.createPayment({
      price: '100.00', currency: 'TRY', basketId: 'B1',
      paymentCard: { cardNumber: '4242424242424242', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'x@y.com' },
      split: [{ submerchantId: 'acct_dest', amountMinor: 9000 }],
      platformCommissionMinor: 1000,
    } as any);
    expect(reqs[0].url).toBe('/v1/payment_intents');
    expect(reqs[0].data).toContain('transfer_data%5Bdestination%5D=acct_dest');
    expect(reqs[0].data).toContain('application_fee_amount=1000');
  });
});
