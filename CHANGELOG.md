# Changelog

## 0.4.0

### Minor Changes

- **Package renamed: `payfyio` → `@fyio/payfyio`.** All future releases ship under
  the new scoped name. The API, types, classes, and behaviour are **100%
  identical** — only the install name changes.

  **Migration:**

  ```bash
  npm uninstall payfyio
  npm install @fyio/payfyio
  ```

  ```diff
  - import { Payfyio } from 'payfyio';
  + import { Payfyio } from '@fyio/payfyio';
  ```

  The unscoped [`payfyio`](https://www.npmjs.com/package/payfyio) package on npm is
  now deprecated (`npm deprecate payfyio "Renamed to @fyio/payfyio"`). Existing
  installs continue to work but receive a deprecation notice on `npm install`. No
  further versions will be published under the old name.

  Brand mentions ("Payfyio is…", `[payfyio]` log prefixes, `payfyio.com` URLs)
  are unchanged — only the npm install name moved.

## 0.3.0

### Minor Changes

- Add Coinbase Commerce provider for crypto checkout (BTC, ETH, USDC, …).
  - `payment.coinbase.initThreeDSPayment(...)` creates a Commerce charge
    and returns redirect HTML pointing at the buyer's hosted_url.
  - `payment.coinbase.getPayment(chargeCode)` polls the charge timeline
    and maps Coinbase's status to payfyio's `PaymentStatus`.
  - `payment.coinbase.cancel(...)` cancels an unpaid charge.
  - `payment.coinbase.verifyWebhookSignature(rawBody, signatureHeader)`
    validates `X-CC-Webhook-Signature` (HMAC-SHA256, constant-time
    compare) so server-side webhook handlers can authenticate Coinbase
    callbacks before mutating order state.
  - Helpers exported at the package root:
    `verifyCoinbaseWebhookSignature`, `mapCoinbaseStatus`.

  Direct card (`createPayment`) and programmatic refund are intentionally
  unsupported — Commerce is a hosted crypto flow and refunds are issued
  from the Coinbase dashboard.

  Config:

  ```ts
  import { Payfyio, ProviderType } from 'payfyio';
  const payment = new Payfyio({
    providers: {
      [ProviderType.COINBASE]: {
        enabled: true,
        config: {
          apiKey: process.env.COINBASE_COMMERCE_API_KEY!,
          webhookSecret: process.env.COINBASE_COMMERCE_WEBHOOK_SECRET!,
        },
      },
    },
  });
  ```

- 50c916a: Add a security-event hook so integrators can observe abuse/probing on their own
  infrastructure.
  - New `onSecurityEvent` callback and `securityNotifiers` array on `PayfyioConfig`.
  - New event types: `callback_verification_failed` (critical), `provider_http_error`,
    `config_invalid`, `retry_suppressed`, `custom`.
  - Built-in handlers `consoleNotifier()` and `webhookNotifier()` plus a `throttle()`
    helper that de-dupes identical events (default 5-minute window) to prevent
    notification floods. The webhook handler lets you fan out to your own
    email/Slack endpoint — payfyio adds no new dependencies and never sends data
    itself.
  - PayTR now emits `callback_verification_failed` on a bad callback signature and
    `provider_http_error` on failed provider calls; `Payfyio.emitSecurityEvent()`
    lets you raise custom signals.

  Events never contain card data, CVV, expiry, or secret keys. Fully backward
  compatible — no behaviour changes when no handlers are configured.

## 0.2.1

### Patch Changes

- Docs: English versions of CONTRIBUTING, BETA_RELEASE, RELEASE_WORKFLOW
  and the tests README. No runtime/API changes.

## 0.2.0

### Minor Changes

- Security hardening for payment callbacks and HTTP signing.
  - **Parampos:** fixed a 3DS callback forgery — the verification hash was
    computed with a GUID taken from the callback itself, so signatures were
    trivially forgeable. The server-side configured GUID is now used.
  - **PayTR:** callback verification and all request tokens (get-token,
    refund, BIN detail) now use `merchant_key` as the HMAC-SHA256 key per
    PayTR's spec (previously the salt was used as the key, which does not
    match real PayTR). **Breaking:** the PayTR provider now requires
    `apiKey` (your `merchant_key`).
  - **Garanti, İş Bankası, Ziraat, Yapı Kredi:** `completeThreeDSPayment`
    previously returned success based on `mdStatus` alone with no response
    hash/MAC verification, so a forged callback could mark an unpaid order
    paid. **Breaking:** these now fail closed (return failure) until proper
    per-bank response verification is implemented.
  - Callback hash comparisons are now constant-time (`timingSafeEqual`).
  - Automatic retries are restricted to idempotent HTTP methods so a
    charge/refund POST is never silently re-sent on a timeout
    (double-charge guard).
  - PayTR errors no longer return the raw axios error object (which carries
    the Authorization header) to callers.

  Stripe, PayPal and Iyzico were reviewed and are unaffected — they confirm
  3DS by re-querying the provider server-side rather than trusting the
  callback.

This file is managed by [changesets](https://github.com/changesets/changesets).

## 0.1.0 — Initial public release

The first public release of payfyio. One unified contract for every provider.
Early release (`0.x`): as the API matures toward v1.0, minor versions may include changes.

### Providers (10)

- **5 gateways** — Iyzico, PayTR, Parampos, Stripe, PayPal
- **5 Turkish bank Virtual POS** — Akbank, Garanti BBVA, İş Bankası, Yapı Kredi, Ziraat Bankası

### Core API

- A single `Payfyio` class — `defaultProvider` + a `providers` map
- Runtime provider switching: `payment.use("provider")`
- Provider-specific typed getters (`payment.iyzico`, `payment.akbank`, …)
- `getEnabledProviders()` and `isProviderEnabled()` helpers
- Automatic URL selection via `mode: 'sandbox' | 'production'` (`baseUrl` not required)

### Payment surface

- `createPayment` — direct card charge (2D)
- `initThreeDSPayment` / `completeThreeDSPayment` — 3D Secure flow
- `initCheckoutForm` — hosted checkout / iframe
- `refund` (full/partial), `cancel`, `getPayment`
- Provider extras: `binCheck`, `installmentInfo`, subscriptions (Iyzico)

### Transport & tooling

- `PayfyioHandler` — ready-made REST handler for Next.js / Express
- `PayfyioClient` + `createPayfyioClient` — typed browser client
- Unified error shape and typed error classes across all providers
  (`PayfyioError`, `ProviderNotEnabledError`, `PaymentFailedError`, `ValidationError`, `ConfigurationError`)
- Optional `PayfyioLogger` and `RetryConfig`
- HMAC-SHA256 / SHA-512 signature verification
- 100% TypeScript, a single runtime dependency (`axios`), MIT license

---

## Pre-1.0 (archived)

Before its public `0.1.0` release, this library went through internal development cycles with
different class names and adapter layouts (the old `payfyio/adapters/*` layout, a different
provider scope, etc.). These are for historical context only and do not apply to `0.x`; new
code should not target them.
