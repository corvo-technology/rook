# Plans billing backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner subscribe to Personal, Team or Company in reais or dollars, monthly or yearly, with extra people and an optional AI add-on billed correctly and the credit ledger staying in dollars.

**Architecture:** Sizes and limits already live in `packages/contracts/src/plans.ts` (`DEFAULT_PLANS`, `PLAN_PRICES`, `PLAN_LIMITS`, `extraSeatPriceId`) and extra seats are already billed by `setExtraSeats` from `syncSeats` in `apps/api/src/billing.ts`. Prices live in `packages/contracts/src/plan-pricing.ts` (Task 1, done). This plan adds Stripe prices found by lookup key per currency and interval, a plan checkout, currency-aware webhooks, and credit grants from price metadata.

**Tech Stack:** TypeScript, zod, Prisma (additive migrations), Stripe REST through `packages/adapters/src/stripe-billing.ts`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-plans-and-pricing-design.md`. The screen plan `2026-11-19-plans-pricing-screen.md` consumes Task 1 and Task 4.

## Global Constraints

- Prices come only from `plan-pricing.ts`; sizes, seats and storage only from `plans.ts` entitlements.
- Only `brl` and `usd`. Currency follows the app locale (`pt-BR` is `brl`) and is fixed at first payment.
- The ledger is in dollars. Refunds reduce the balance by the table amount, never a converted value.
- Every migration is additive; the previous release's code must keep working for a few seconds after it applies.
- Self-hosted deployments (no `PLAN_PRICES`) keep working with no plans and no limits.
- Tests are deterministic and offline. No secrets, real keys or account identifiers in code, docs, commits or PRs.
- Existing subscribers keep their current price until they choose a new plan.

## Review Focus

- A webhook delivered twice, or an invoice before its checkout: credits granted once, balance never negative.
- A reais subscription refunded after a partial credit spend: balance reduced by the table dollars, floored at zero.
- A Team subscriber in reais, yearly, invites an eleventh person: the extra seat line uses the `brl` yearly price, not a dollar monthly one.
- A subscriber whose price id is in `PLAN_PRICES` but has no lookup key (set up by hand before this change) keeps resolving to its plan.
- A subscriber on the old own-key or credits funding opens billing: nothing changes.

---

### Task 1: Plan pricing (done in the catalog PR)

`packages/contracts/src/plan-pricing.ts` exports `BillingCurrency`, `BillingInterval`, `AI_USE_CENTS`, `AiUseCents`, `planPriceCents(plan, currency, interval)`, `extraPersonCents(currency, interval)`, `aiAddOnPriceCents(currency, useCents, interval)`, `currencyForLocale(locale)`.

### Task 2: Stripe prices by lookup key, and currency-aware webhooks

**Files:**
- Modify: `packages/adapters/src/stripe-billing.ts` (the literal `"usd"` checks in charge, checkout session and invoice parsing), `packages/adapter-kit/src/interfaces.ts`, `packages/adapters/src/billing-emulator.ts`
- Test: `packages/adapters/src/stripe-billing.test.ts`, `packages/adapters/src/billing-conformance.test.ts`

**Interfaces:**
- Produces on `BillingProvider`:
  - `ensurePlanPrices(): Promise<Record<string, string>>`: creates every missing catalog price once and returns lookup key to price id. Keys: `plan_<plan>_<currency>_<interval>`, `extra_person_<currency>_<interval>`, `ai_<useCents>_<currency>_<interval>`. AI prices carry metadata `credit_use_cents`.
  - `priceIdForLookupKey(key: string): Promise<string | null>`
  - `createPlanCheckout(input: { customerId: string; plan: PlanId; currency: BillingCurrency; interval: BillingInterval; extraPeople: number; aiUseCents: AiUseCents | null; successUrl: string; cancelUrl: string }): Promise<{ url: string }>`

- [ ] **Step 1: Write failing tests**: a `brl` invoice is accepted for a `brl` subscription and refused for a `usd` one; `createPlanCheckout` sends the plan line, an extra-person line with `quantity: extraPeople` only when above 0, and an AI line only when `aiUseCents` is set; `ensurePlanPrices` run twice creates prices only the first time.
- [ ] **Step 2: Run** `pnpm vitest run packages/adapters/src/stripe-billing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: compare each webhook object's currency with the subscription's own currency; prices from `plan-pricing.ts`.
- [ ] **Step 4: Run** the adapter and conformance suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapters): plan prices in reais and dollars by lookup key`.

### Task 3: Ledger grants dollars from price metadata

**Files:**
- Modify: credit purchase parsing in `packages/adapters/src/stripe-billing.ts`, `packages/db/src/model-credits.ts`
- Test: `packages/adapters/src/stripe-credits.test.ts`, `packages/db/src/model-credits.test.ts`

**Interfaces:**
- Produces: `BillingCreditPurchase.useCents: number`, read from `credit_use_cents`; purchases without it keep today's amount-based behavior.

- [ ] **Step 1: Write failing tests**: a paid `brl` invoice with an AI line of `credit_use_cents=1000` grants 1000 cents; the same event twice grants once; invoice before checkout grants once; refunding that charge reduces the balance by 1000, floored at zero.
- [ ] **Step 2: Run** `pnpm vitest run packages/adapters/src/stripe-credits.test.ts packages/db/src/model-credits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the ledger's existing idempotency on the Stripe object id.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(billing): grant credit from price metadata, not the charged amount`.

### Task 4: Plan checkout and plan in status

**Files:**
- Create: additive Prisma migration adding nullable `currency` and `interval` to the billing account in `packages/db`.
- Modify: `apps/api/src/billing.ts`, `packages/db/src/billing.ts`, `packages/contracts/src/domain.ts` (`BillingStatusSchema`), `packages/contracts/src/rpc.ts` (billing route), `packages/contracts/src/plans.ts` (`resolveEntitlements` also maps price ids found by lookup key)
- Test: `apps/api/src/billing.test.ts`, `packages/db/src/billing.postgres.test.ts`, `packages/contracts/src/plans.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `BillingService.planCheckout(actor: Actor, input: { plan: PlanId; interval: BillingInterval; currency: BillingCurrency; aiUseCents: AiUseCents | null }): Promise<{ url: string }>` and RPC `billing.planCheckout` with the same input; `BillingStatus` gains optional `plan`, `currency`, `interval`.

- [ ] **Step 1: Write failing tests**: only the owner can call it (FORBIDDEN otherwise); a second currency after a first payment is rejected; two simultaneous calls open one checkout (the existing per-organization advisory lock); `extraPeople` is members plus pending invites minus `seatsIncluded`, never below 0; a plan price created by lookup key resolves to its plan in `resolveEntitlements` even when `PLAN_PRICES` does not list it.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src/billing.test.ts packages/contracts/src/plans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** beside `purchaseCredits`, reusing its serialize path and `organizationSeats`.
- [ ] **Step 4: Run** the API, contracts and Postgres billing suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): open a plan checkout in the chosen currency`.

### Task 5: Extra seats follow the subscription's currency and interval

**Files:**
- Modify: `syncSeats` and `extraSeatPrice` in `apps/api/src/billing.ts`, `apps/api/src/plan-usage.ts`
- Test: `apps/api/src/billing.test.ts`, `apps/api/src/plan-usage.postgres.test.ts`

**Interfaces:**
- Consumes: Task 2 `priceIdForLookupKey`, Task 4 stored `currency` and `interval`.

- [ ] **Step 1: Write failing tests**: a `brl` yearly Team subscription with 11 seats sets the extra line to `extra_person_brl_year`, quantity 1; with `extraSeatPriceId` set in `PLAN_LIMITS` and no stored currency, the old price is used; `planUsage().seats.extraPrice` shows the subscription's currency.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src/billing.test.ts -t seat`. Expected: FAIL.
- [ ] **Step 3: Implement**: price id from the lookup key when the account has a currency and interval, else `extraSeatPriceId`. The seat cap (`PLAN_SEAT_LIMIT`) is unchanged.
- [ ] **Step 4: Run** the same command and the plan-usage suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(billing): bill extra people in the subscription's currency`.

### Task 6: Going live safely

**Files:**
- Create: `scripts/stripe-ensure-prices.ts`, `docs/billing-go-live.md`
- Test: `scripts/stripe-ensure-prices.test.ts` (against the emulator)

- [ ] **Step 1: Write failing test**: running it twice against the emulator creates every price the first time and none the second, and prints the `PLAN_PRICES` JSON mapping the plan price ids to their plans.
- [ ] **Step 2: Run** `pnpm vitest run scripts/stripe-ensure-prices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the script on `ensurePlanPrices`, and a short checklist: run in test mode first, then live; set `PLAN_PRICES` on the API service; create the live webhook endpoint with the same events; keep test and live keys apart. Placeholders only.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(billing): script that creates the plan prices idempotently`.
