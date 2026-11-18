# Airtel Money Checkout and Sale Lifecycle Plan

## Objective

Replace the storefront's demo checkout with a verified Airtel Money payment lifecycle that:

- recalculates and reserves the real bakery cart server-side;
- initiates Airtel Money collection for an exact UGX amount;
- reconciles callbacks and provider status checks;
- creates exactly one paid bakery sale and one `Mobile Money` payment record after confirmed success;
- dispatches finished-stock lots once;
- creates and makes downloadable an existing-system-style receipt;
- sends a Resend receipt email when possible;
- exposes only accurate pending, successful, failed, cancelled, expired, and unknown states.

No provider credentials or live payments are configured by this plan. Airtel sandbox/production credentials, callback verification details, Uganda fields, settlement approval, and merchant activation remain operator/onboarding prerequisites.

## Existing integration points

- [bakery-site checkout](/C:/Users/hawa/bakery-site/app/storefront.tsx) is presently demo-only and saves browser-local demonstration order data.
- [bakery-server storefront routes](/C:/Users/hawa/bakery-server/routes/storefront.js) expose public catalog, settings, messages, and newsletter endpoints.
- [bakery-server sales controller](/C:/Users/hawa/bakery-server/controllers/salesController.js) already validates catalog lines, computes totals, creates paid-now guest sales, dispatches stock, and records payment receipts atomically.
- [bakery-server sale model](/C:/Users/hawa/bakery-server/models/sale.js) already stores the sale, full party snapshot, line snapshot, receipt number, paid amount, and idempotency key.
- [bakery-server sale payment model](/C:/Users/hawa/bakery-server/models/salePayment.js) already supports `Mobile Money`, transaction ID, payment receipt number, and idempotency.
- [bakery-server receipt controller](/C:/Users/hawa/bakery-server/controllers/receiptManagementController.js) already serializes sale and credit-payment receipts for ERP display.
- Existing [bakery-server email templates](/C:/Users/hawa/bakery-server/lib/emailTemplates.js) and Resend infrastructure can provide the receipt email foundation.

## Phase 1: Airtel onboarding and provider contract

1. Create and verify the Airtel Africa developer account.
2. Create a dedicated application for the bakery.
3. Add Airtel Money merchant collection for Uganda and UGX.
4. Configure:
   - sandbox HTTPS callback URL;
   - public backend IP allow-list if required;
   - merchant/client credentials;
   - merchant PIN/signing key or digital-signature data if required;
   - production callback URL;
   - settlement/merchant account.
5. Confirm the exact Uganda sandbox specification before coding provider calls:
   - OAuth endpoint and token lifetime;
   - collection initiation endpoint and headers;
   - status endpoint and response states;
   - expected MSISDN format;
   - callback body and authentication/signature rules;
   - transaction expiry and test-number behavior;
   - refund/dispute behavior.
6. Do not infer credentials or write production payload assumptions from third-party snippets.

## Phase 2: Backend domain and route structure

1. Add public routes:
   - `POST /api/storefront/checkout/airtel/initiate`
   - `GET /api/storefront/checkout/airtel/:attemptId/status`
   - `POST /api/webhooks/airtel/money`
   - `GET /api/storefront/checkout/airtel/:attemptId/receipt.pdf`
2. Add an `AirtelPaymentAttempt` model with:
   - internal attempt ID and checkout idempotency key;
   - cart and variant snapshot;
   - server-calculated subtotal, delivery fee, and total;
   - customer and fulfillment details;
   - normalized payer MSISDN and masked audit copy;
   - Airtel merchant reference and transaction ID;
   - callback/status payload metadata;
   - state and append-only lifecycle events;
   - linked sale/payment/order IDs;
   - stock reservation status;
   - callback, reconciliation, expiry, receipt, and email timestamps.
3. Add unique indexes for:
   - checkout idempotency key;
   - Airtel transaction/reference ID;
   - sale idempotency key;
   - sale payment idempotency key.
4. Add a server-only Airtel adapter for OAuth, collection, status lookup, callback verification, retries, HTTP timeout, and response redaction.
5. Put Airtel secrets only in backend environment variables. Never expose them to `NEXT_PUBLIC_*`, browser code, ERP code, logs, or git.

## Phase 3: Cart, totals, and stock reservation

1. Storefront sends variant IDs and quantities plus fulfillment/customer data. It sends no authoritative price or total.
2. Backend reloads active variants and catalog prices.
3. Reject missing/inactive variants, invalid quantities, invalid preferred dates, unsupported fulfillment, and unsupported delivery areas.
4. Recalculate UGX subtotal and delivery fee server-side.
5. Generate the cart hash and compare it on idempotent retries.
6. Reserve finished-stock lots before Airtel collection is initiated.
7. Keep a pending reservation for a bounded approval window.
8. Release the reservation on failure/cancellation/expiry or missed reconciliation timeout.
9. Consume it into the existing sale dispatch flow only after Airtel success.

## Phase 4: Airtel payment lifecycle

1. Create a pending payment attempt and server-calculated checkout snapshot.
2. Obtain the Airtel OAuth bearer token.
3. Initiate collection using the normalized payer MSISDN.
4. Store the Airtel transaction/reference ID and set state to `pending` or `processing`.
5. Return only the attempt ID and waiting state to the storefront.
6. The storefront polls the backend status endpoint on a bounded interval.
7. Airtel callback:
   - verify authentication/signature or registered source;
   - validate transaction reference and provider event ID;
   - persist an append-only lifecycle event;
   - acknowledge quickly;
   - pass through the same reconciliation function used by polling.
8. Status reconciliation:
   - pending/processing keeps the attempt waiting;
   - successful passes exact-amount/currency/reference checks;
   - failed/cancelled closes and releases reservation;
   - expired closes and releases reservation;
   - unknown remains pending for scheduled reconciliation.
9. Scheduled reconciliation retries provider status for delayed callbacks and outages.
10. A browser redirect or page refresh is never proof of payment.

## Phase 5: Exactly-once sale creation

On the first confirmed success, inside one MongoDB transaction:

1. Lock/reload the attempt and verify it is not already finalized.
2. Verify Airtel confirms the exact server-calculated total, currency UGX, and merchant/reference match.
3. Create or replay the existing guest customer/sale snapshot.
4. Create a paid-now `Sale`:
   - server-calculated bakery line snapshots;
   - `paymentTerms: "Paid now"`;
   - `paidAmount: sale total`;
   - full customer and company snapshots;
   - existing sequential receipt number.
5. Create a `SalePayment`:
   - `method: "Mobile Money"`;
   - confirmed Airtel amount;
   - Airtel transaction ID in `txnID`;
   - checkout/attempt idempotency key.
6. Dispatch finished-stock lots through the existing sale stock-dispatch function.
7. Link the sale and payment to the Airtel attempt.
8. Mark the attempt `successful`.
9. Add audit events for success, sale, payment, stock, and receipt creation.
10. Return the sale, receipt, and a short-lived public receipt token/download URL.

Duplicate callbacks, polling retries, and browser retries must return the original successful result without changing stock or creating duplicate records.

## Phase 6: Receipt output

1. Build one server-side receipt renderer from the committed sale/payment records.
2. Include:
   - bakery/merchant identity and logo;
   - sequential sale receipt number;
   - payment date and Airtel transaction ID;
   - customer name, phone, email, and fulfillment details;
   - product line, quantity, unit price, and line total;
   - subtotal, delivery fee if used, and paid UGX total;
   - `Mobile Money` and paid status;
   - balance of zero.
3. Provide a PDF endpoint tied to a random, short-lived receipt token or authenticated checkout session.
4. Add a `Download receipt` action to the real success page.
5. Send the PDF or secure receipt link through Resend after the sale transaction commits.
6. Store receipt-email delivery state and make email retry asynchronous.
7. Email failure must not reverse or alter a successful Airtel sale.

## Phase 7: Storefront UX

1. Remove demo payment copy, demo order number generation, browser-local order storage, and simulated delays.
2. Replace card/demo choices initially with Airtel Money.
3. Normalize Uganda phone input and explain that approval will appear on the customer's Airtel phone.
4. Add waiting, prompt, success, failure, cancellation, expiry, and unknown states.
5. Disable repeated submission and preserve one checkout idempotency key across retries.
6. Restore pending/finished state from the backend after refresh.
7. Show a backend-backed confirmation only after sale and receipt creation complete.
8. Add explicit retry/reconciliation actions for unknown pending payments.
9. Never tell the customer payment failed solely because the browser timed out.

## Phase 8: ERP and receipt visibility

1. Airtel-paid sales appear automatically in existing Sales and Receipts areas.
2. Sale payment method appears as `Mobile Money`.
3. Airtel transaction ID is searchable in payment/receipt records.
4. Add an authorized payment-attempt diagnostics view containing:
   - provider reference and masked MSISDN;
   - state history;
   - callback count;
   - reconciliation source;
   - linked sale/payment/receipt;
   - retryable/expired status.
5. Staff may reconcile an unknown payment, but may not manually mark Airtel as paid.
6. Preserve existing audit events and add Airtel lifecycle events.

## Phase 9: Security, resilience, and reconciliation

1. Verify callback authenticity before storing or processing.
2. Use rate limits, strict input schemas, low body-size limits, and public checkout throttling.
3. Deduplicate callback/provider event IDs and transaction IDs.
4. Mask payer MSISDN and redact secrets, authorization headers, and full provider payloads from logs.
5. Use HTTP timeout, circuit breaker, and bounded retries.
6. Add configurable pending timeout and reconciliation interval.
7. Add provider callback and status mismatch monitoring.
8. Add operator alerts for successful Airtel payment with failed sale creation, callback/sale mismatches, and orphaned stock reservations.
9. Add replay, mismatch, and interrupted-transaction tests.

## Phase 10: Test plan

1. Server calculates cart, delivery fee, and UGX totals.
2. Phone normalization rejects invalid and unsupported values.
3. Idempotent checkout retries return or replay one attempt.
4. Stock reservation succeeds/fails safely.
5. OAuth, collection initiation, callback, and status failures are handled.
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
16. Public endpoints cannot create sales without successful Airtel reconciliation.

## Go-live requirements

- Airtel Uganda sandbox merchant and test number confirmed.
- Exact Airtel endpoint contract documented.
- Public HTTPS callback reachable and authenticated.
- Airtel IP allow-list approved if applicable.
- Production merchant, settlement account, and fees confirmed.
- Callback signature/allow-list verification approved.
- Resend production domain and receipt sender configured.
- Receipt PDF endpoint verified.
- Monitoring, reconciliation, and operator runbook ready.
- Refund and dispute process agreed.
- No live payment testing until Airtel explicitly enables production credentials.
