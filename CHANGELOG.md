# Changelog

## 0.13.3 — Çekim sonrası tutar uyuşmazlığı

### Patch Changes

- **Çekim sonrası tutar uyuşmazlığı ayrı kod taşır.**
  - **VakıfBank, QNB:** bankanın kendi cevabı siparişten farklı bir tutar çektiğini gösteriyorsa sonuç artık
    `errorCode: 'CHARGED_AMOUNT_MISMATCH'` taşır (para çekildi — iade/iptal edin); çekim öncesi kontrol
    `AMOUNT_MISMATCH` olarak kalır.
  - **Sipay / QNBpay:** `checkstatus` hâlâ sonuçlanmamış diyorsa sonuç başarısız değil `pending` (`NOT_SETTLED`) döner.

## 0.13.2 — İş Bankası production host

### Patch Changes

- **İş Bankası production host'u `https://sanalpos.isbank.com.tr` olarak düzeltildi** (EST `/fim/api` ve
  `/fim/est3Dgate` burada; eski `spos.isbank.com.tr` varsayılanı EST uçlarını sunmuyor). Sandbox değişmedi.

## 0.13.1 — Güvenlik düzeltmeleri

### Patch Changes

- **Yeni sağlayıcılar için güvenlik düzeltmeleri.**
  - **Sipay / QNBpay:** 3D callback artık `checkstatus` ile (ödenmiş, aynı tutar) teyit edilmeden SUCCESS sayılmaz.
    Şifreli `hash_key` MAC taşımadığı için tek başına değiştirilerek bir ret başarıya çevrilebiliyordu.
  - **VakıfBank, Denizbank:** `completeThreeDSPayment`'a verilen `installment`, callback'teki imzasız taksit
    sayısının önüne geçer.

## 0.13.0 — Sipay ve QNBpay

### Minor Changes

- **Sipay ve QNBpay eklendi.**
  - `ProviderType.SIPAY` → `payment.sipay`, `ProviderType.QNBPAY` → `payment.qnbpay` (QNBpay Sipay platformunda
    çalışır; `QnbPay` sınıfı `Sipay`'i genişletir ve `brand`'i sabitler).
  - Non-3D (`paySmart2D`) ve 3D Secure (`paySmart3D`). 3D callback'in şifreli `hash_key`'i açılır; durum, toplam ve
    fatura no sabit-zamanlı kontrol edilmeden hiçbir alan okunmaz.
  - Tam/kısmi `refund`, `cancel` (açık ön-otorizasyonu bırakır ya da kalanı iade eder), `getPayment` (`checkstatus`).
  - **Ön-otorizasyon:** `capture: false` tutarı bloke eder; `capturePayment` (tam/kısmi) ile çekilir,
    `voidAuthorization` ile bırakılır.
  - `binCheck` ve `installmentInfo` (`getpos`).
  - Bearer token önbelleklenir, `401`'de yenilenir.
  - Export: `Sipay`, `QnbPay`, `verifySipay3DCallback`, `SipayConfig`, `SipayBrand`, `Sipay3DCallbackData`.

  > Birim testleriyle doğrulandı; henüz sandbox'ta koşulmadı.

## 0.12.0 — Denizbank ve QNB

### Minor Changes

- **Denizbank ve QNB eklendi.**
  - **Denizbank** (`ProviderType.DENIZBANK`, `payment.denizbank`): InterVPos — non-3D satış, 3D Secure (3D Model),
    iade, iptal. Callback `HASHPARAMS`/`HASH` ile doğrulanır; imzalı dize ayraçsız birleştiği için çekim
    **her zaman** kayıttan gelen tutarla yapılır (tutar yoksa `AMOUNT_REQUIRED`, hiçbir şey çekilmez).
  - **QNB** (`ProviderType.QNB`, `payment.qnb`; eski adıyla QNB Finansbank PayFor): non-3D satış, 3D Secure
    (`'3DModel'` varsayılan / `'3DPay'`), iade, iptal, sorgu. `ResponseHash` doğrulanır, ardından sipariş
    `OrderInquiry` ile aynı tutar için teyit edilir.
  - Export: `Denizbank`, `verifyDenizbank3DCallback`, `DenizbankConfig`, `Qnb`, `verifyQnb3DCallback`, `QnbConfig`,
    `QnbSecureType`.
  - QNB'de aynı gün iade yok (`V014`), `cancel` kullanın. Denizbank'ta durum sorgusu yok, `getPayment` hata fırlatır.

  > Birim testleriyle doğrulandı; iki banka da henüz sandbox'ta koşulmadı.

## 0.11.0 — Kuveyt Türk ve VakıfBank

### Minor Changes

- **Kuveyt Türk ve VakıfBank eklendi.**
  - **Kuveyt Türk** (`ProviderType.KUVEYTTURK`, `payment.kuveytturk`): KT Pay Gate 3D Secure — `Provision`
    ancak `GetTransactions` bankada aynı sipariş ve tutarı gösterdikten sonra çalışır; aynı gün iptal,
    tam/kısmi iade, durum sorgusu. KT Pay Gate yalnız 3D olduğundan `createPayment` `NOT_SUPPORTED` döner.
  - **VakıfBank** (`ProviderType.VAKIFBANK`, `payment.vakifbank`): VPOS 7/24 — non-3D satış, MPI enrollment ile
    3D Secure, iade, iptal. 3D satış yalnız MPI işlem no'sunu taşır; kart ve tutar sunucunun yaptığı
    enrollment'tan gelir. MPI host'u `baseUrl`'den türetilir (`mpiUrl` ile override).
  - İki bankanın 3D callback'i imzasız: `completeThreeDSPayment({ ...callback, orderId, amount })` —
    değerler kendi kayıtlarınızdan.
  - VakıfBank `getPayment` bilerek hata fırlatır (bankanın araması iptal/iadeyi göremiyor).
  - Export: `KuveytTurk`, `KuveytTurkConfig`, `KuveytTurkCallback`, `VakifBank`, `VakifBankConfig`, `VakifBankCallback`.

  > Birim testleriyle doğrulandı; iki bankanın 3D akışı henüz sandbox'ta koşulmadı.

## 0.10.0 — Posnet: Yapı Kredi (gerçek 3D) ve Albaraka

### Minor Changes

- **Yapı Kredi Posnet gerçek 3D doğrulamayla açıldı; Albaraka Türk eklendi.**
  - **Yapı Kredi** Posnet XML + OOS akışıyla yeniden yazıldı: non-3D satış, 3D Secure
    (`oosRequestData` → banka formu → `oosResolveMerchantData` → `oosTranData`), iade, iptal, sorgu.
    Bankanın MAC'i işyerinin **kendi** sipariş no/tutarı üzerinden hesaplanıp sabit-zamanlı karşılaştırılır;
    `mdStatus` ancak bundan sonra okunur. **Fail-closed davranışı kalktı.**
  - 3D callback'te açık sipariş no yok: `completeThreeDSPayment({ ...callback, orderId, amount, currency })`
    — değerler kendi kayıtlarınızdan.
  - **Albaraka Türk** (`ProviderType.ALBARAKA`, `payment.albaraka`): Posnet JSON API — non-3D satış, 3D Secure,
    iade, iptal, sorgu. Callback `Mac`'i `MdStatus` okunmadan doğrulanır; satış kayıttaki tutarla gönderilir.
  - Export: `Albaraka`, `verifyAlbaraka3DCallback`, `AlbarakaConfig`, `YapiKrediConfig`, `YapiKrediCallbackData`.
  - Yapı Kredi production host'u `https://posnet.yapikredi.com.tr` olarak düzeltildi.
  - `refund`/`cancel` bankanın referansını alır (tamamlanan ödemenin `paymentId`'si).

  > Birim testleri ve bankanın 3D kılavuzundaki MAC vektörüyle doğrulandı; sandbox turu henüz yapılmadı.

## 0.9.0 — EST bankaları (İşbank, Ziraat, Halkbank, TEB, Şekerbank)

### Minor Changes

- **EST (Asseco NestPay) — İş Bankası ve Ziraat gerçek 3D doğrulamayla açıldı; Halkbank, TEB, Şekerbank eklendi.**

  Yeni genel `Est` sağlayıcısı EST platformundaki bankaları tek sınıfta toplar:
  - `createPayment` (XML API `Auth`), `initThreeDSPayment` (`/fim/est3Dgate`, hash ver3 imzalı form),
    `completeThreeDSPayment`, `refund` (`Credit`), `cancel` (`Void`), `getPayment` (`ORDERSTATUS`).
  - `storeType`: `'3d'` (varsayılan), `'3d_pay'`, `'3d_pay_hosting'`, `'3d_host'`. Hosted tiplerde kart
    bankanın sayfasında toplanır, sunucudan geçmez.
  - Callback önce hash ver3 ile sabit-zamanlı doğrulanır, ardından sonuç **bankaya teyit ettirilir**:
    `3d`/`3d_host` XML `Auth` ile çeker, `3d_pay`/`3d_pay_hosting` `ORDERSTATUS` ile kontrol edilir.
  - `acceptedMdStatuses` (varsayılan `['1']`) yarı-güvenli 3D sonuçlarını açıkça seçmeyi sağlar.
  - Yeni sağlayıcı türleri: `ProviderType.HALKBANK`, `TEB`, `SEKERBANK` → `payment.halkbank`, `payment.teb`,
    `payment.sekerbank`.
  - `Isbank` ve `Ziraat` artık `Est`'in alt sınıfları; config alanları aynı. **Fail-closed davranışı
    kalktı** — doğru imzalı ve bankanın onayladığı ödemeler artık SUCCESS döner.
  - Export: `Est`, `EstConfig`, `EstStoreType`, `verifyEst3DCallback(payload, storeKey)`.
  - Ziraat sandbox adresi EST test host'una (`entegrasyon.asseco-see.com.tr`) taşındı.
  - Desteklenmeyen para birimi artık hata verir (eskiden sessizce TRY'ye düşüyordu).
  - Logger'a artık axios hata nesnesi verilmez (istek gövdesi kart verisi ve banka şifreleri taşıyordu).

  > Birim testleri ve bağımsız hesaplanmış hash vektörleriyle doğrulandı; henüz bir EST sandbox'ında uçtan
  > uca koşulmadı. Canlıya almadan önce sandbox'ta bir tur deneyin.

## 0.8.2 — Garanti production host

### Patch Changes

- **Garanti: production host'u düzeltildi.**

  `mode: 'production'` iken istekler `https://sanalposprov.garantibbva.com.tr`
  adresine gidiyordu; bankanın dokümanındaki doğru adres
  **`https://sanalposprov.garanti.com.tr`** — production host'ta "bbva" yok.
  Canlı kimlik bilgileriyle yapılan her istek yanlış adrese gittiği için
  başarısız oluyordu. Sandbox host'u değişmedi.

## 0.8.1 — Garanti Ortak Ödeme

### Patch Changes

- **Garanti: kart alanları verilmezse forma konmaz — banka kendi Ortak Ödeme
  sayfasında toplar.**

  `paymentCard.cardNumber` boşsa `cardnumber` / `cardexpiredate*` / `cardcvv2` /
  `cardholdername` alanları 3D formuna hiç eklenmez. GVP bu durumda kendi "Ortak
  Ödeme" sayfasını açıp kartı müşteriden kendisi alır — yani entegre eden tarafın
  sunucusundan ham kart numarası geçmez, PCI kapsamı hosted checkout ile aynı
  kalır (SAQ A).

  ```typescript
  // Kart bankada toplanır:
  await payment.garanti.initThreeDSPayment({ ...request, paymentCard: {} });
  ```

  Boş string göndermek aynı şey değildir — banka onu geçersiz kart sayar; alanlar
  tamamen atlanmalıdır. Sandbox'ta doğrulandı: alanlar çıkarıldığında banka
  "Garanti Bankası Ortak Ödeme Sayfası" döndürüyor.

  Kart gönderen mevcut çağrılar etkilenmez.

## 0.8.0 — Garanti tekrarlı ödeme

### Minor Changes

- **Garanti BBVA: tekrarlı ödeme (Sabit Tutarlı Tekrarlı Satış).**

  Yeni opsiyonel yetenek `initRecurringPayment(request)` — ilk taksit 3D Secure ile
  doğrulanır, kalanlarını **banka** kendi takvimine göre otomatik provizyona
  gönderir. Kart saklamaya veya kendi zamanlayıcına gerek yoktur.

  ```typescript
  await payment.garanti.initRecurringPayment({
    ...threeDSRequest,
    recurring: { totalPayments: 12, frequency: 'monthly', interval: 1 },
  });
  ```

  - Yeni tipler: `RecurringPlan`, `RecurringPaymentRequest`.
  - `PaymentProvider.initRecurringPayment` varsayılan olarak **hata fırlatır**;
    yalnızca Garanti override eder. Bilerek `ThreeDSPaymentRequest` üstünde
    opsiyonel bir alan değil ayrı bir metot: sessizce yok sayılan bir plan,
    abonelik kurulduğu sanılırken tek çekim yapmak demek olurdu.
  - `Payfyio.initRecurringPayment` facade delegasyonu eklendi.

  Bankanın imzaladığı alan listesi sabit olduğu için plan alanları
  (`recurringtype`, `totalpaymentnum`, `frequencytype`, `frequencyinterval`,
  `startdate`) `secure3dhash`'e girmez; unit test tekrarlı ve tekrarsız formun
  hash'inin aynı kaldığını doğrular.

  Garanti sandbox'ında uçtan uca doğrulandı (`tests/e2e/garanti.e2e.test.ts`,
  `GARANTI_E2E=1`): 12 aylık seri kuruldu, ilk taksit `mdstatus=1` /
  `procreturncode=00` ile onaylandı, sipariş `orderinq` ile sorgulanabilir.

  **Stripe aboneliğinden farkları** — ürün tarafında bilinmeli: seri **sonludur**
  (`totalPayments` zorunlu, süresiz yenileme yok), tutar seri kurulurken sabitlenir
  (plan içi tutar değişimi/proration yok) ve sonraki çekimler için banka callback
  göndermez — durum `getPayment(orderId)` ile sorgulanmalıdır.

## 0.7.0 — Garanti BBVA 3D Secure

### Minor Changes

- **Garanti BBVA (GVP): real 3D Secure, verified against the bank's sandbox.**

  `Garanti.completeThreeDSPayment` used to fail closed — it returned FAILURE for
  every callback because no response-hash verification existed. It now verifies
  the bank's hash and confirms real payments.
  - **API version 512.** The request signatures were the old v0.01 SHA-1 shapes and
    did not authenticate against GVP. Both are now the documented SHA-512 forms:
    `HashData = SHA512(OrderID + TerminalID + CardNumber + Amount + CurrencyCode +
SHA1(password + terminalId.padStart(9,'0')))` for `/VPServlet`, and
    `secure3dhash = SHA512(TerminalID + OrderID + Amount + CurrencyCode +
SuccessURL + ErrorURL + Type + InstallmentCnt + StoreKey + hashedPassword)`
    for the 3D engine. Asserted against the golden vector in the bank's own docs.
  - **Callback verification.** `completeThreeDSPayment` recomputes
    `SHA512(hashparams values + storeKey)`, compares constant-time, and requires
    the bank's signed field list to cover `mdstatus` + `procreturncode` — so a
    forged callback cannot sign a harmless subset and slip past. The hash is
    checked _before_ any status field is read.
  - **New export `verifyGaranti3DHash(callbackData, storeKey)`** for verifying the
    callback outside the provider (webhook routers, edge functions).
  - **3DS runs at `3D_PAY`** — the bank authenticates and provisions in one leg, so
    there is no second call. The charged amount is bound at init inside
    `secure3dhash`; the callback's unsigned `txnamount` echo is never trusted.
  - **`Mode` now follows `mode`.** Requests were hardcoded `Mode=PROD`, which GVP
    rejects on the test host; sandbox requests are tagged `Mode=TEST`.
  - **Refund/void run as `PROVRFN`** with a new optional `refundPassword` config
    (defaults to `provisionPassword`).
  - **`secure3DStoreKey` is now optional** and defaults to `storeKey` — GVP issues
    one key, and requiring a second one made 3DS unusable out of the box.

  Verified end-to-end against `sanalposprovtest.garantibbva.com.tr`
  (`tests/e2e/garanti.e2e.test.ts`, run with `GARANTI_E2E=1`): non-3D sale, order
  inquiry, and a full 3D_PAY round trip. Void/refund authenticate correctly but are
  declined at the host by the shared public test terminal (`RPC-05`) — verify
  reversals on your own terminal.

  İş Bankası, Ziraat and Yapı Kredi remain fail-closed until their own response-hash
  verification is implemented.

## 0.6.0 — Marketplace / escrow library surface

Adds the building blocks for custody-less escrow, payouts, and marketplace
splits. **Everything is additive** — existing callers and the 11 untouched
providers are unaffected (same optional-field / optional-base-method pattern as
`binCheck`/`installmentInfo`).

> ⚠️ **License & custody.** The payout (`payout`) and marketplace-split
> (`submerchants`, `PaymentRequest.split`) features move money to a third party.
> Enabling real money-out requires payment-institution licensing and a
> custody/sponsor-bank arrangement (in Türkiye: a TCMB Ödeme Kuruluşu license or
> a licensed partner). This release ships the **library surface only** — it does
> not, by itself, make you a licensed PSP. See `docs/PAZARYERI-ESCROW-YOL-HARITASI.md`
> and `docs/PSP-DONUSUM-YOL-HARITASI.md`.

> ⚠️ **Sandbox verification.** Provider endpoint paths and request fields for
> the money-movement features (capture/void, payout, submerchant, split) and the
> iyzico webhook are covered by unit tests with a **mocked transport** — they are
> **not yet verified against live sandboxes**. Run an integration pass with real
> sandbox credentials before relying on these in production.

### Minor Changes

- **Pre-auth / Capture / Void** (delayed capture) — `PaymentRequest.capture:
false` authorizes without capturing; complete later with
  `payment.capturePayment({ paymentId, amountMinor? })` (partial supported) or
  release with `payment.voidAuthorization({ paymentId })`.
  - iyzico: `/payment/preauth` + `/payment/3dsecure/initialize/preauth`,
    capture via `/payment/postauth`, void via `/payment/cancel`.
  - Stripe: `capture_method: manual`, intent `/capture` (+`amount_to_capture`),
    void via intent `/cancel`.
  - Other providers throw `Capture/Void not supported by this provider`.

- **Minor-unit money helpers** — `toMinor` / `fromMinor` / `formatMinor` /
  `minorUnitDigits`, exported at the package root. Correct for zero-decimal
  (JPY/KRW) and three-decimal (KWD/BHD) currencies. `stripe/utils`
  (`toStripeAmount`/`fromStripeAmount`) now delegate to these.

- **Idempotency keys** — `idempotencyKey?` on every mutating request
  (`createPayment`, `initThreeDSPayment`, `refund`, `cancel`, `capturePayment`,
  `voidAuthorization`, `payout`). Stripe maps it to the native
  `Idempotency-Key` header; iyzico maps it to `conversationId` (its dedup key)
  when one isn't already set; other providers ignore it silently.

- **Payout / Transfer** — `payment.payout({ to, amountMinor, currency,
reference })` sends money out to a third party (`PayoutDestination` =
  `{ iban }` | `{ accountId }`). Stripe transfers to a connected account; a bare
  IBAN returns a clear error (needs Connect onboarding). Per-call provider
  override via `request.provider`.

- **Submerchant CRUD + marketplace split** — `payment.submerchants.create /
update / retrieve(...)`; `PaymentRequest.split[]` +
  `platformCommissionMinor`. iyzico: `/onboarding/submerchant` + per-basket-item
  `subMerchantKey`/`subMerchantPrice`. Stripe: Connect `/v1/accounts` + intent
  `transfer_data[destination]` / `application_fee_amount` (single-destination).

- **Unified webhooks** — `verifyWebhook(provider, rawBody, headers, secret)`
  returns a normalized `PayfyioEvent` discriminated union
  (`payment.succeeded|failed|pending|cancelled`, `refund.completed`,
  `subscription.renewed|canceled`, `payout.paid|failed`, `dispute.opened`,
  `unknown`). Throws `WebhookSignatureError` on an invalid signature. Wraps the
  existing Coinbase / Polar / Lemon Squeezy verifiers and adds native
  Stripe-Signature (`t=,v1=`) HMAC verification. (iyzico webhook normalization
  lands in a follow-up.)

## 0.5.0

### Minor Changes

- Add **Polar.sh** provider — hosted checkout for digital products and
  subscriptions, popular with developers and indie SaaS.
  - `payment.polar.initThreeDSPayment(...)` creates a Polar checkout and
    returns redirect HTML pointing at the buyer's hosted URL.
  - `payment.polar.getPayment(checkoutId)` re-polls the checkout status.
  - `payment.polar.refund(...)` issues a refund against an order id.
  - `payment.polar.cancel(...)` cancels an open (unpaid) checkout.
  - `payment.polar.verifyWebhookSignature(rawBody, headers)` validates the
    Standard-Webhooks `webhook-signature` / `webhook-id` / `webhook-timestamp`
    headers (HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, base64,
    constant-time compare, supports multiple `v1,…` tokens during key
    rotation).
  - Helpers exported at the package root: `verifyPolarWebhookSignature`,
    `mapPolarCheckoutStatus`.

  Direct card (`createPayment`) is intentionally unsupported — Polar is a
  hosted-only flow.

  Config:

  ```ts
  import { Payfyio, ProviderType } from '@fyio/payfyio';
  const payment = new Payfyio({
    providers: {
      [ProviderType.POLAR]: {
        enabled: true,
        config: {
          apiKey: process.env.POLAR_ACCESS_TOKEN!,
          productId: process.env.POLAR_PRODUCT_ID!,
          webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
        },
      },
    },
  });
  ```

- Add **Lemon Squeezy** provider — hosted checkout with merchant-of-record
  tax handling (Lemon Squeezy collects and remits VAT/sales tax for you).
  - `payment.lemonsqueezy.initThreeDSPayment(...)` creates a JSON:API
    checkout under your store + variant and returns redirect HTML.
  - `payment.lemonsqueezy.getPayment(orderId)` looks up the order status.
  - `payment.lemonsqueezy.refund(...)` issues a refund against an order id
    (uses POST /v1/orders/{id}/refund).
  - `payment.lemonsqueezy.verifyWebhookSignature(rawBody, signatureHeader)`
    validates the `X-Signature` header (HMAC-SHA256 hex, constant-time
    compare).
  - Helpers exported at the package root:
    `verifyLemonSqueezyWebhookSignature`, `mapLemonSqueezyOrderStatus`.

  Direct card (`createPayment`) and cancel are intentionally unsupported —
  unpaid Lemon Squeezy checkouts simply expire; refund paid orders instead.

  Config:

  ```ts
  import { Payfyio, ProviderType } from '@fyio/payfyio';
  const payment = new Payfyio({
    providers: {
      [ProviderType.LEMONSQUEEZY]: {
        enabled: true,
        config: {
          apiKey: process.env.LEMONSQUEEZY_API_KEY!,
          storeId: process.env.LEMONSQUEEZY_STORE_ID!,
          variantId: process.env.LEMONSQUEEZY_VARIANT_ID!,
          webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
        },
      },
    },
  });
  ```

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
