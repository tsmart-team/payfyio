import { describe, it, expect } from 'vitest';
import { Garanti } from '../../src/providers/garanti';

/**
 * Garanti BBVA GVP sandbox e2e.
 *
 * Runs against the bank's real test host. Credentials and card below are the
 * public ones printed in Garanti's own integration docs
 * (dev.garantibbva.com.tr) — override via env for a merchant-specific terminal.
 *
 *   GARANTI_E2E=1 npx vitest run tests/e2e/garanti.e2e.test.ts
 */
const RUN = process.env.GARANTI_E2E === '1';

const garanti = new Garanti({
  apiKey: '',
  secretKey: '',
  baseUrl: process.env.GARANTI_BASE_URL || 'https://sanalposprovtest.garantibbva.com.tr',
  merchantId: process.env.GARANTI_MERCHANT_ID || '7000679',
  terminalId: process.env.GARANTI_TERMINAL_ID || '30691297',
  provisionUser: process.env.GARANTI_PROVISION_USER || 'PROVAUT',
  provisionPassword: process.env.GARANTI_PROVISION_PASSWORD || '123qweASD/',
  storeKey: process.env.GARANTI_STORE_KEY || '12345678',
} as any);

const card = {
  cardHolderName: 'PAYFYIO TEST',
  cardNumber: process.env.GARANTI_TEST_CARD || '4282209004348015',
  expireMonth: '08',
  expireYear: '2027',
  cvc: '123',
};

const order = (prefix: string) => `${prefix}${Date.now()}`;

function salesRequest(orderId: string, price: string) {
  return {
    price,
    paidPrice: price,
    currency: 'TRY',
    basketId: orderId,
    conversationId: orderId,
    paymentCard: card,
    buyer: { id: 'B1', name: 'Test', surname: 'User', email: 'eticaret@garanti.com.tr', ip: '127.0.0.1' },
    shippingAddress: {},
    billingAddress: {},
    basketItems: [],
  } as any;
}

describe.skipIf(!RUN)('Garanti sandbox', () => {
  it('authorizes a non-3D sale', async () => {
    const orderId = order('PFY');
    const sale = await garanti.createPayment(salesRequest(orderId, '1.00'));
    console.log('sales →', sale.status, sale.errorCode, sale.errorMessage);
    expect(sale.rawResponse).toContain('<GVPSResponse>');
    expect(sale.status).toBe('success');

    const inq = await garanti.getPayment(orderId);
    console.log('inq   →', inq.status, inq.errorCode);
    expect(inq.status).toBe('success');
    expect(inq.rawResponse).toContain('<Status>APPROVED</Status>');
  }, 60_000);

  // The shared test terminal from the docs declines every void/refund at the
  // host (Source=HOST, ReasonCode 05, "RPC-05 condition was raised") — a bad
  // HashData answers Source=GVPS / 92 instead, so the request is authenticated,
  // the terminal just won't reverse. Assert the request is accepted; assert the
  // approval only on a merchant's own test terminal.
  it('gets an authenticated (not hash-rejected) answer for void', async () => {
    const orderId = order('PFYVOID');
    await garanti.createPayment(salesRequest(orderId, '1.00'));
    const voided = await garanti.cancel({ paymentId: orderId, ip: '127.0.0.1' });
    console.log('void  →', voided.status, voided.errorCode, voided.errorMessage);
    expect(voided.rawResponse).toContain('<Source>HOST</Source>');
    expect(voided.errorCode).not.toBe('92');
  }, 60_000);

  it('rejects a bad card with a bank error rather than throwing', async () => {
    const sale = await garanti.createPayment({
      ...salesRequest(order('PFYBAD'), '1.00'),
      paymentCard: { ...card, cardNumber: '4111111111111111' },
    });
    console.log('bad card →', sale.status, sale.errorCode, sale.errorMessage);
    expect(sale.status).toBe('failure');
  }, 60_000);

  it('completes a full 3D_PAY round trip against the bank', async () => {
    const orderId = order('PFY3D');
    const init = await garanti.initThreeDSPayment({
      ...salesRequest(orderId, '1.00'),
      callbackUrl: 'https://example.com/garanti/callback',
    });
    expect(init.status).toBe('pending');

    // Post the generated form the way the browser would. On the test terminal
    // the 3D engine authenticates and provisions straight away, answering with
    // the auto-submit form it would deliver to `successurl`. A bad request hash
    // instead yields an error page with mdstatus=0.
    const html = init.threeDSHtmlContent!;
    const res = await fetch(html.match(/action="([^"]+)"/)![1], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parseInputs(html)).toString(),
    });
    expect(res.status).toBe(200);
    const callback = parseInputs(await res.text());
    console.log('3D callback →', {
      mdstatus: callback.mdstatus,
      procreturncode: callback.procreturncode,
      response: callback.response,
    });
    expect(callback.hash).toBeTruthy();

    // The real thing: the bank's own hash must validate and the payment confirm.
    const done = await garanti.completeThreeDSPayment(callback);
    console.log('complete →', done.status, done.errorCode, done.errorMessage);
    expect(done.status).toBe('success');
    expect(done.paymentId).toBe(orderId);

    // …and the same callback with one byte changed must not.
    const forged = await garanti.completeThreeDSPayment({ ...callback, mdstatus: '1', procreturncode: '00', authcode: '000000' });
    expect(forged.status).toBe('failure');
  }, 60_000);
});

describe.skipIf(!RUN)('Garanti recurring', () => {
  it('sets up a 12-month series the bank accepts', async () => {
    const orderId = order('PFYREC');
    const init = await garanti.initRecurringPayment({
      ...salesRequest(orderId, '1.00'),
      callbackUrl: 'https://example.com/garanti/callback',
      recurring: { totalPayments: 12, frequency: 'monthly', interval: 1 },
    } as never);
    expect(init.status).toBe('pending');

    const html = init.threeDSHtmlContent!;
    const res = await fetch(html.match(/action="([^"]+)"/)![1], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parseInputs(html)).toString(),
    });
    const callback = parseInputs(await res.text());
    console.log('recurring callback →', {
      mdstatus: callback.mdstatus,
      procreturncode: callback.procreturncode,
    });

    // First instalment goes through 3DS exactly like a one-off; the bank
    // schedules the remaining 11 itself.
    const done = await garanti.completeThreeDSPayment(callback);
    console.log('recurring complete →', done.status, done.errorCode, done.errorMessage);
    expect(done.status).toBe('success');

    // The order must now be queryable — this is the only channel the bank
    // gives us for the later instalments (no per-charge callback exists).
    const inq = await garanti.getPayment(orderId);
    console.log('recurring inq →', inq.status, inq.errorCode);
    expect(inq.rawResponse).toContain('<GVPSResponse>');
  }, 60_000);
});

/** Pull `name`/`value` out of the hidden inputs of an auto-submit form. */
function parseInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<input[^>]*>/gi) ?? []) {
    const name = tag.match(/name="([^"]*)"/i)?.[1];
    if (!name) continue;
    out[name] = (tag.match(/value="([^"]*)"/i)?.[1] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }
  return out;
}
