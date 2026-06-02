# @fyio/payfyio

> Unified, type-safe payment gateway for Node.js & TypeScript.

One API for the payment providers your customers actually use — global gateways (Stripe, PayPal), SaaS / digital-product checkout (Polar.sh, Lemon Squeezy), crypto checkout (Coinbase Commerce — BTC, ETH, USDC, …), Turkish rails (Iyzico, PayTR, Parampos) and five Turkish bank Virtual POS integrations (Akbank, Garanti, İş Bankası, Yapı Kredi, Ziraat). Switch providers without rewriting code.

[![npm](https://img.shields.io/npm/v/@fyio/payfyio)](https://www.npmjs.com/package/@fyio/payfyio)
[![license](https://img.shields.io/npm/l/@fyio/payfyio)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/badge/source-github-181717?logo=github)](https://github.com/tsmart-team/payfyio)

> 📦 **Renamed in v0.4.0.** The unscoped [`payfyio`](https://www.npmjs.com/package/payfyio) package is **deprecated** — please migrate to `@fyio/payfyio`. All API/code is identical; only the install name changed.

---

## Install

```bash
npm install @fyio/payfyio

# or: pnpm add @fyio/payfyio / yarn add @fyio/payfyio / bun add @fyio/payfyio

```

## Quick start

```typescript
import { Payfyio } from '@fyio/payfyio';

const payment = new Payfyio({
mode: 'sandbox',
providers: {
iyzico: {
enabled: true,
config: {
apiKey: process.env.IYZICO_API_KEY!,
secretKey: process.env.IYZICO_SECRET_KEY!,
},
},
},
});

// 3D Secure init
const result = await payment.use('iyzico').initThreeDSPayment({
price: '100.00',
paidPrice: '100.00',
currency: 'TRY',
callbackUrl: 'https://yoursite.com/callback',
buyer: {
id: 'BY-1',
name: 'John',
surname: 'Doe',
email: 'john@example.com',
identityNumber: '74300864791',
registrationAddress: 'Maslak, Istanbul',
ip: '85.34.78.112',
city: 'Istanbul',
country: 'Turkey',
},
basketItems: [
{ id: 'BI-1', name: 'Item', category1: 'General', price: '100.00', itemType: 'PHYSICAL' },
],
});

// Refund
const refund = await payment.use('iyzico').refund({
paymentId: '12345',
price: '50.00',
currency: 'TRY',
ip: '1.2.3.4',
});
```

## Supported providers

| Provider     |   2D    |   3D Secure   | Refund | Cancel | BIN check | Installments |
| ------------ | :-----: | :-----------: | :----: | :----: | :-------: | :----------: |
| Iyzico       |    ✓    |       ✓       |   ✓    |   ✓    |     ✓     |      ✓       |
| PayTR        |    —    |       ✓       |   ✓    |   —    |     ✓     |      ✓       |
| Parampos     |    ✓    |       ✓       |   ✓    |   ✓    |     —     |      —       |
| Stripe       |    ✓    |    ✓ (SCA)    |   ✓    |   ✓    |     —     |      —       |
| PayPal       |    —    | ✓ (approval)  |   ✓    |   ✓    |     —     |      —       |
| Akbank       |    ✓    |       ✓       |   ✓    |   ✓    |     ✓     |      ✓       |
| Garanti BBVA |    ✓    |       ✓       |   ✓    |   ✓    |     —     |      —       |
| İş Bankası   |    ✓    |       ✓       |   ✓    |   ✓    |     —     |      —       |
| Yapı Kredi   |    ✓    |       ✓       |   ✓    |   ✓    |     —     |      —       |
| Ziraat       |    ✓    |       ✓       |   ✓    |   ✓    |     —     |      —       |
| Coinbase     |    —    | ✓ (hosted)    |   —    |   ✓    |     —     |      —       |
| Polar.sh     |    —    | ✓ (hosted)    |   ✓    |   ✓    |     —     |      —       |
| Lemon Squeezy|    —    | ✓ (hosted)    |   ✓    |   —    |     —     |      —       |

> `2D` = direct (non-secure) card charge via `createPayment`. PayTR, PayPal,
> Coinbase, Polar and Lemon Squeezy only support the secure/approval/hosted
> flow (`initThreeDSPayment`). Coinbase is crypto checkout via Coinbase
> Commerce's hosted page (refunds from its dashboard). Polar.sh and Lemon
> Squeezy are SaaS / digital-product checkouts — Polar exposes programmatic
> refunds and lets you cancel unpaid checkouts; Lemon Squeezy supports
> refunds but does not expose a cancel-checkout endpoint (unpaid checkouts
> simply expire).
> `BIN check` and `Installments` are provider extras
> (`binCheck` / `installmentInfo`).

## PayPal

PayPal needs no SDK and no PayPal-specific code on your side — payfyio talks to
PayPal's REST API over HTTPS using only your credentials. Get a **Client ID**
and **Secret** from the
[PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) →
**Apps & Credentials** → **Create App** (pick Sandbox for testing, Live for
production), then pass them like any other provider:

```typescript
const payment = new Payfyio({
mode: 'sandbox', // 'production' for live
providers: {
paypal: {
enabled: true,
config: {
apiKey: process.env.PAYPAL_CLIENT_ID!, // Client ID
secretKey: process.env.PAYPAL_CLIENT_SECRET!, // Secret
},
},
},
});
```

Unlike card providers, PayPal approves the payment on its own hosted page, so
the flow is **redirect → approve → capture** (three calls, no card data ever
touches your server):

```typescript
// 1. Create the order. Returns HTML that redirects the buyer to PayPal,
//    plus the order id (paymentId) — persist it against your order.
const init = await payment.use('paypal').initThreeDSPayment({
price: '10.00',
paidPrice: '10.00',
currency: 'USD',
callbackUrl: 'https://yoursite.com/paypal/return', // PayPal sends the buyer back here
basketId: 'order-123',
conversationId: 'order-123',
buyer: { id: 'order-123', name: 'Jane', surname: 'Doe', email: 'jane@example.com', ip: '1.2.3.4', city: 'San Jose', country: 'US', identityNumber: '00000000000', registrationAddress: 'N/A' },
basketItems: [{ id: 'i1', name: 'Item', category1: 'General', price: '10.00', itemType: 'VIRTUAL' }],
});
// Send the buyer to PayPal — serve init.threeDSHtmlContent, or pull the URL out of it.

// 2. The buyer approves on PayPal and is redirected back to callbackUrl with
//    ?token=<orderId> (same value as init.paymentId).

// 3. Capture the money. Pass the order id as `token`.
const result = await payment.use('paypal').completeThreeDSPayment({ token: init.paymentId });
// result.status === 'success' → captured; the transaction now appears in both
// the buyer's and your business PayPal accounts.
```

> A `pending`/`CREATED` order that is never approved+captured produces **no
> transaction** — it just expires. `refund()` and `cancel()` work as usual
> after a capture.

## HTTP handler

Drop-in REST endpoints — works with Next.js, Express, or any Node framework.

```typescript
// app/api/pay/[...path]/route.ts (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';
import { Payfyio } from '@fyio/payfyio';

const payment = new Payfyio({
mode: 'sandbox',
providers: {
iyzico: {
enabled: true,
config: {
apiKey: process.env.IYZICO_API_KEY!,
secretKey: process.env.IYZICO_SECRET_KEY!,
},
},
},
});

async function handler(req: NextRequest) {
const res = await payment.handler.handle({
method: req.method,
url: req.url,
headers: Object.fromEntries(req.headers.entries()),
body: await req.json().catch(() => undefined),
});
return NextResponse.json(res.body, { status: res.status });
}

export const GET = handler;
export const POST = handler;
```

Exposes:

- `POST /api/pay/:provider/payment`
- `POST /api/pay/:provider/payment/init-3ds`
- `POST /api/pay/:provider/callback`
- `POST /api/pay/:provider/refund`
- `POST /api/pay/:provider/cancel`
- `POST /api/pay/:provider/bin-check`
- `POST /api/pay/:provider/installment`
- `GET  /api/pay/health`

## Logging & retry

```typescript
const payment = new Payfyio({
mode: 'sandbox',
logger: {
debug: (msg, meta) => console.debug(msg, meta),
info: (msg, meta) => console.info(msg, meta),
error: (msg, err, meta) => console.error(msg, err, meta),
},
retry: {
attempts: 3,
delay: 1000,
statusCodes: [429, 503],
},
providers: { /* ... */ },
});
```

## Security events

payfyio surfaces security-relevant signals — a 3DS callback that fails
signature verification (a likely forgery attempt), repeated provider HTTP
errors, a misconfiguration — through a hook that runs on **your** server.
payfyio never sends this data anywhere itself; you decide whether to log it,
alert on it, or forward it.

```typescript
import { Payfyio, consoleNotifier, webhookNotifier } from '@fyio/payfyio';

const payment = new Payfyio({
  providers: { /* ... */ },

  // Raw hook — called for every event. Best-effort: throwing here can never
  // break a payment.
  onSecurityEvent: (event) => {
    if (event.severity === 'critical') {
      // e.g. someone is POSTing forged "paid" callbacks
      myAlerting.page(event);
    }
  },

  // Ready-made handlers. Each de-dupes identical events (default 5-min window)
  // so a burst can't spam you.
  securityNotifiers: [
    consoleNotifier({ minSeverity: 'warn' }),
    webhookNotifier({
      url: 'https://ops.example.com/payfyio-alerts',
      minSeverity: 'critical',
      headers: { Authorization: 'Bearer <token>' },
    }),
  ],
});
```

Send the alert email from your own webhook endpoint (SMTP, Resend, Slack — your
choice). payfyio stays dependency-light and never holds your mail credentials.

**Event types:** `callback_verification_failed` (critical), `provider_http_error`,
`config_invalid`, `retry_suppressed`, `custom`.

**Never contains** card numbers, CVV, expiry, or secret keys — and you should
keep it that way if you emit your own events via `payment.emitSecurityEvent(...)`.

## Documentation

Full docs, provider-specific guides, and API reference:

**[https://payfyio.com](https://payfyio.com)**

## Security & network

payfyio is an HTTP client for payment gateways, so security scanners will
correctly flag it for **network access**, **outbound URLs**, and
**environment-variable access**. That behaviour is the whole point of the
library — here is exactly what it does:

- **Outbound calls only to providers you enable.** Each provider talks to its
  own official endpoint (e.g. `api.stripe.com`, `api.iyzipay.com`,
  `*.garantibbva.com.tr`). The full list is in the source under
  `src/providers/*`. Nothing is sent anywhere else.
- **Sandbox vs. production** is chosen by `mode` — sandbox hits the providers'
  test hosts, production hits the live hosts.
- **Credentials** (API keys, store keys) are supplied by you via the
  constructor config and are only ever sent to the matching provider over
  HTTPS. payfyio does not read them from disk and does not phone home.
- **HTTP client:** [`axios`](https://www.npmjs.com/package/axios) is the only
  runtime dependency. Any "unmaintained sub-dependency" / "uses eval" scanner
  notes you see come from axios's transitive tree, not from payfyio's code.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
