# payfyio

> Unified, type-safe payment gateway for Node.js & TypeScript.

One API for the payment providers your customers actually use — global gateways (Stripe, PayPal) and Turkish rails (Iyzico, PayTR, Parampos) plus five Turkish bank Virtual POS integrations (Akbank, Garanti, İş Bankası, Yapı Kredi, Ziraat). Switch providers without rewriting code.

[![npm](https://img.shields.io/npm/v/payfyio)](https://www.npmjs.com/package/payfyio)
[![license](https://img.shields.io/npm/l/payfyio)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/badge/source-github-181717?logo=github)](https://github.com/tsmart-team/payfyio)

---

## Install

```bash
npm install payfyio

# or: pnpm add payfyio / yarn add payfyio / bun add payfyio

```

## Quick start

```typescript
import { Payfyio } from 'payfyio';

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

> `2D` = direct (non-secure) card charge via `createPayment`. PayTR and PayPal only
> support the secure/approval flow (`initThreeDSPayment`). `BIN check` and `Installments`
> are provider extras (`binCheck` / `installmentInfo`).

## HTTP handler

Drop-in REST endpoints — works with Next.js, Express, or any Node framework.

```typescript
// app/api/pay/[...path]/route.ts (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';
import { Payfyio } from 'payfyio';

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
