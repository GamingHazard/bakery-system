# Combined Airtel Money and MTN MoMo Checkout Plan

## Objective

Replace the storefront demo checkout with one provider-neutral mobile-money payment lifecycle supporting both Airtel Money and MTN MoMo:

- recalculates and reserves the real bakery cart server-side;
- initiates Airtel Money or MTN MoMo collection for an exact UGX amount;
- reconciles callbacks and provider status checks;
- creates exactly one paid bakery sale and one `Mobile Money` payment record after confirmed success;
- dispatches finished-stock lots once;
- creates and makes downloadable an existing-system-style receipt;
- sends a Resend receipt email when possible;
- exposes only accurate pending, successful, failed, cancelled, expired, and unknown states.

No provider credentials or live payments are configured by this plan. Airtel and MTN sandbox/production credentials, callback verification details, Uganda fields, settlement approval, and merchant activation remain operator/onboarding prerequisites.

## Existing integration points

- [bakery-site checkout](/C:/Users/hawa/bakery-site/app/storefront.tsx) is presently demo-only and saves browser-local demonstration order data.
- [bakery-server storefront routes](/C:/Users/hawa/bakery-server/routes/storefront.js) expose public catalog, settings, messages, and newsletter endpoints.
- [bakery-server sales controller](/C:/Users/hawa/bakery-server/controllers/salesController.js) already validates catalog lines, computes totals, creates paid-now guest sales, dispatches stock, and records payment receipts atomically.
- [bakery-server sale model](/C:/Users/hawa/bakery-server/models/sale.js) already stores the sale, full party snapshot, line snapshot, receipt number, paid amount, and idempotency key.
- [bakery-server sale payment model](/C:/Users/hawa/bakery-server/models/salePayment.js) already supports `Mobile Money`, transaction ID, payment receipt number, and idempotency.
- [bakery-server receipt controller](/C:/Users/hawa/bakery-server/controllers/receiptManagementController.js) already serializes sale and credit-payment receipts for ERP display.
- Existing [bakery-server email templates](/C:/Users/hawa/bakery-server/lib/emailTemplates.js) and Resend infrastructure can provide the receipt email foundation.

## Phase 1: Provider onboarding and contract verification

1. Create and verify separate Airtel Africa and MTN MoMo merchant/developer accounts.
2. Create a separate Airtel application and MTN Collection subscription for the bakery.
3. Add Uganda merchant collection and UGX to both accounts.
4. For Airtel, confirm sandbox/production hosts, OAuth or token mechanism, collection/status endpoints, callback verification, merchant ID, digital signing, and IP allow-list.
5. For MTN, confirm:
   - Collection subscription key;
   - API user and API key provisioning;
   - OAuth bearer endpoint;
   - Request-to-Pay endpoint;
   - status endpoint;
   - exact `X-Target-Environment` value;
   - exact Uganda production host;
   - UUID `X-Reference-Id`;
   - callback host and callback authentication;
   - transaction expiry and terminal states.
6. Configure:
   - sandbox HTTPS callback URL;
   - public backend IP allow-list if required;
   - separate merchant/client credentials;
   - separate merchant PIN/signing key or digital-signature data if required;
   - production callback URL;
   - settlement/merchant account.
7. Do not infer credentials or write payload assumptions from third-party SDK snippets. The official provider account specification is authoritative.

## Phase 2: Backend domain and route structure

1. Add public routes:
   - `POST /api/storefront/checkout/mobile-money/initiate`
   - `GET /api/storefront/checkout/mobile-money/:attemptId/status`
   - `POST /api/webhooks/mobile-money/airtel`
   - `POST /api/webhooks/mobile-money/mtn`
   - `GET /api/storefront/checkout/mobile-money/:attemptId/receipt.pdf`
2. Add a provider-neutral `MobileMoneyPaymentAttempt` model with:
   - internal attempt ID and checkout idempotency key;
   - cart and variant snapshot;
   - server-calculated subtotal, delivery fee, and total;
   - customer and fulfillment details;
   - normalized payer MSISDN and masked audit copy;
   - provider: `airtel` or `mtn`;
   - provider merchant reference and transaction ID;
   - callback/status payload metadata;
   - state and append-only lifecycle events;
   - linked sale/payment/order IDs;
   - stock reservation status;
   - callback, reconciliation, expiry, receipt, and email timestamps.
3. Add unique indexes for:
   - checkout idempotency key;
   - provider transaction/reference ID;
   - sale idempotency key;
   - sale payment idempotency key.
4. Add server-only provider adapters behind a common interface:
   - `initiateCollection`;
   - `getTransactionStatus`;
   - `verifyCallback`;
   - `normalizePhone`;
   - `providerCapabilities`.
5. Add separate Airtel and MTN adapters for OAuth/token, collection, status lookup, callback verification, retries, HTTP timeout, and response redaction.
6. Put provider secrets only in backend environment variables. Never expose them to `NEXT_PUBLIC_*`, browser code, ERP code, logs, or git.

## Phase 3: Cart, totals, and stock reservation

1. Storefront sends variant IDs and quantities plus fulfillment/customer data. It sends no authoritative price or total.
2. Backend reloads active variants and catalog prices.
3. Reject missing/inactive variants, invalid quantities, invalid preferred dates, unsupported fulfillment, and unsupported delivery areas.
4. Recalculate UGX subtotal and delivery fee server-side.
5. Generate the cart hash and compare it on idempotent retries.
6. Reserve finished-stock lots before collection initiation.
7. Keep a pending reservation for a bounded approval window.
8. Release the reservation on failure, cancellation, expiry, or missed reconciliation timeout.
9. Consume it into the existing sale dispatch flow only after provider success.

## Phase 4: Shared payment lifecycle

1. Create a pending payment attempt and server-calculated checkout snapshot.
2. Storefront sends `provider: "airtel" | "mtn"` and the payer phone.
3. Obtain the selected provider token/API credentials.
4. Initiate collection using provider-specific normalized phone handling.
   - Airtel uses the exact Airtel Uganda MSISDN/country payload.
   - MTN uses `256...`, `PartyIDType: MSISDN`, a UUID `X-Reference-Id`, UGX, and `X-Target-Environment`.
5. Store the selected provider's transaction/reference ID and set state to `pending` or `processing`.
6. Return only the attempt ID and waiting state to the storefront.
7. The storefront polls the backend status endpoint on a bounded interval.
8. Provider callback:
   - verify authentication/signature or registered source;
   - validate transaction reference and provider event ID;
   - persist an append-only lifecycle event;
   - acknowledge quickly;
   - pass through the same reconciliation function used by polling.
9. Status reconciliation:
   - pending/processing keeps the attempt waiting;
   - successful passes exact-amount/currency/reference checks;
   - failed/cancelled closes and releases reservation;
   - expired closes and releases reservation;
   - unknown remains pending for scheduled reconciliation.
10. Scheduled reconciliation retries provider status for delayed callbacks and outages.
11. A browser redirect or page refresh is never proof of payment.

## Phase 5: Exactly-once sale creation

On the first confirmed success, inside one MongoDB transaction:

1. Lock/reload the attempt and verify it is not already finalized.
2. Verify the selected provider confirms the exact server-calculated total, currency UGX, payer, and merchant/reference match.
3. Create or replay the existing guest customer/sale snapshot.
4. Create a paid-now `Sale`:
   - server-calculated bakery line snapshots;
   - `paymentTerms: "Paid now"`;
   - `paidAmount: sale total`;
   - full customer and company snapshots;
   - existing sequential receipt number.
5. Create a `SalePayment`:
   - `method: "Mobile Money"`;
   - confirmed provider amount;
   - Airtel or MTN transaction ID in `txnID`;
   - provider identifier in an internal note or provider metadata;
   - checkout/attempt idempotency key.
6. Dispatch finished-stock lots through the existing sale stock-dispatch function.
7. Link the sale and payment to the mobile-money attempt.
8. Mark the attempt `successful`.
9. Add audit events for success, sale, payment, stock, and receipt creation.
10. Return the sale, receipt, and a short-lived public receipt token/download URL.

Duplicate callbacks, polling retries, and browser retries must return the original successful result without changing stock or creating duplicate records.

## Phase 6: Receipt output

1. Build one server-side receipt renderer from the committed sale/payment records.
2. Include:
   - bakery/merchant identity and logo;
   - sequential sale receipt number;
   - payment date and provider transaction ID;
   - customer name, phone, email, and fulfillment details;
   - product line, quantity, unit price, and line total;
   - subtotal, delivery fee if used, and paid UGX total;
   - `Mobile Money` and paid status;
   - balance of zero.
3. Provide a PDF endpoint tied to a random, short-lived receipt token or authenticated checkout session.
4. Add a `Download receipt` action to the real success page.
5. Send the PDF or secure receipt link through Resend after the sale transaction commits.
6. Store receipt-email delivery state and make email retry asynchronous.
7. Email failure must not reverse or alter a successful mobile-money sale.

## Phase 7: Storefront UX

1. Remove demo payment copy, demo order number generation, browser-local order storage, and simulated delays.
2. Replace demo card choices with a payment selector offering Airtel Money and MTN MoMo.
3. Show provider-specific phone hints and validation without exposing provider secrets.
4. Normalize Uganda phone input and explain that approval will appear on the customer's selected mobile-money phone.
5. Add waiting, prompt, success, failure, cancellation, expiry, and unknown states.
6. Disable repeated submission and preserve one checkout idempotency key across retries.
7. Restore pending/finished state from the backend after refresh.
8. Show a backend-backed confirmation only after sale and receipt creation complete.
9. Add explicit retry/reconciliation actions for unknown pending payments.
10. Never tell the customer payment failed solely because the browser timed out.

## Phase 8: ERP and receipt visibility

1. Airtel- and MTN-paid sales appear automatically in existing Sales and Receipts areas.
2. Sale payment method appears as `Mobile Money`.
3. Provider transaction ID is searchable in payment/receipt records.
4. Add an authorized payment-attempt diagnostics view containing:
   - provider name, reference, and masked MSISDN;
   - state history;
   - callback count;
   - reconciliation source;
   - linked sale/payment/receipt;
   - retryable/expired status.
5. Staff may reconcile an unknown payment, but may not manually mark either provider as paid.
6. Preserve existing audit events and add provider lifecycle events.

## Phase 9: Security, resilience, and reconciliation

1. Verify callback authenticity before storing or processing.
2. Use rate limits, strict input schemas, low body-size limits, and public checkout throttling.
3. Deduplicate callback/provider event IDs and transaction IDs.
4. Mask payer MSISDN and redact secrets, authorization headers, and full provider payloads from logs.
5. Use HTTP timeout, circuit breaker, and bounded retries.
6. Add configurable pending timeout and reconciliation interval.
7. Add provider callback and status mismatch monitoring.
8. Add operator alerts for successful provider payment with failed sale creation, callback/sale mismatches, and orphaned stock reservations.
9. Add replay, mismatch, and interrupted-transaction tests.

## Phase 10: Test plan

1. Server calculates cart, delivery fee, and UGX totals.
2. Phone normalization rejects invalid and unsupported values.
3. Idempotent checkout retries return or replay one attempt.
4. Stock reservation succeeds/fails safely.
5. OAuth/token, collection initiation, callback, and status failures are handled for both providers.
6. Callback signatures/sources are accepted/rejected correctly.
7. Callback replay cannot create duplicate sales or stock dispatch.
8. Poll replay cannot create duplicate sales or stock dispatch.
9. Amount/currency/merchant/reference mismatch cannot mark success.
10. Exactly one sale/payment/receipt is created after final confirmation.
11. PDF is tied to a confirmed sale and denies access to wrong/expired tokens.
12. Resend receipt success, failure, and retry behave independently from payment success.
13. Pending timeout releases stock.
14. Scheduled reconciliation recovers a missed callback.
15. Browser refresh and deep-linking restore backend payment state.
16. Public endpoints cannot create sales without successful Airtel or MTN reconciliation.

## MTN Collection API implementation notes

1. Create or receive the MTN API user and API key in sandbox and production separately.
2. Obtain a bearer token with the Collection subscription key and Basic credentials.
3. Cache bearer tokens by provider environment and renew before expiry.
4. Generate a UUID `X-Reference-Id` once per attempt.
5. Send Request-to-Pay with amount, UGX, checkout external ID, payer MSISDN, payer message, and payee note.
6. Send `X-Callback-Url` and `X-Target-Environment` as required by the approved MTN contract.
7. Treat HTTP `202` as request acceptance, not payment success.
8. Poll MTN status and require a provider `SUCCESSFUL` state plus exact amount/currency/reference verification.
9. Handle `PENDING`, `FAILED`, and `TIMEOUT` explicitly.
10. Use callback reconciliation only as an accelerator and never as the sole proof of payment.

## Airtel implementation notes

1. Confirm Airtel's exact Uganda collection/status/callback payload in the sandbox account.
2. Store Airtel credentials separately from MTN credentials.
3. Use Airtel's approved country, currency, MSISDN, merchant, OAuth, and callback conventions.
4. Verify Airtel callback authenticity and status independently before sale finalization.
5. Keep Airtel and MTN transaction references unique across the provider-neutral attempt model.

## Go-live requirements

- Airtel and MTN Uganda sandbox merchants/test numbers confirmed.
- Exact Airtel and MTN endpoint contracts documented.
- Public HTTPS callbacks reachable and authenticated.
- Airtel and MTN callback verification approved.
- Airtel IP allow-list approved if applicable.
- MTN production target environment and host confirmed.
- MTN API user/API key provisioning complete.
- Airtel/MTN production merchant, settlement accounts, fees, and limits confirmed.
- Resend production domain and receipt sender configured.
- Receipt PDF endpoint verified.
- Monitoring, reconciliation, and operator runbook ready.
- Refund and dispute process agreed.
- No live payment testing until both providers explicitly enable production credentials.
