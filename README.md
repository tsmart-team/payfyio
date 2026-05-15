# payfyio

> Unified, type-safe payment gateway for Node.js & TypeScript.

One API for the payment providers your customers actually use — Iyzico, PayTR, Stripe, and PayPal. Switch providers without rewriting code.

[![npm](https://img.shields.io/npm/v/payfyio)](https://www.npmjs.com/package/payfyio)
[![license](https://img.shields.io/npm/l/payfyio)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/badge/source-github-181717?logo=github)](https://github.com/tsmart-team/payfyio)

---

## Install

\`\`\`bash
npm install payfyio

# or: pnpm add payfyio / yarn add payfyio / bun add payfyio

\`\`\`

## Quick start

\`\`\`typescript
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
\`\`\`

## Supported providers

| Provider | 2D  | 3D Secure | Refund | Cancel | BIN check | Installments |
| -------- | :-: | :-------: | :----: | :----: | :-------: | :----------: |
| Iyzico   |  ✓  |     ✓     |   ✓    |   ✓    |     ✓     |      ✓       |
| PayTR    |  —  |     ✓     |   ✓    |   —    |     ✓     |      ✓       |
| Stripe   |  ✓  |  ✓ (SCA)  |   ✓    |   ✓    |     —     |      —       |
| PayPal   |  ✓  |     —     |   ✓    |   ✓    |     —     |      —       |

## HTTP handler

Drop-in REST endpoints — works with Next.js, Express, or any Node framework.

\`\`\`typescript
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
\`\`\`

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

\`\`\`typescript
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
providers: { /_ ... _/ },
});
\`\`\`

## Documentation

Full docs, provider-specific guides, and API reference:

**[https://payfyio.com](https://payfyio.com)**

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
