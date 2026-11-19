# Plans pricing screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single choice card with three plans, a currency that follows the language, an AI add-on and a monthly or yearly switch, matching rook.team.

**Architecture:** One shared component in `packages/ui-web` renders the plans: prices from `plan-pricing.ts`, sizes from the plan entitlements that `rpc.usage.plan()` already returns (`plans`, with computers, computer size, storage, included and max seats). The paywall feeds it and calls `billing.planCheckout`. Mobile opens the same checkout with native controls.

**Tech Stack:** React, shadcn/ui on Base UI (vendored via `pnpm exec shadcn add` from the official registry only), Lingui, Tailwind with `@corvo/ui-tokens`, Playwright for web, Expo UI for mobile.

**Spec:** `docs/superpowers/specs/2026-11-19-plans-and-pricing-design.md`. The approved mockup lives with the maintainer. Depends on Task 1 (done) and Task 4 of `2026-11-19-plans-billing-backend.md`; until Task 4 lands, tests use a stubbed `billing.planCheckout`.

## Global Constraints

- No hardcoded product hex and no `[var(--…)]` arbitrary values: colors are semantic tokens from `@corvo/ui-tokens`.
- Reuse `planName`, `formatStorage` and `computerSizeName` from `apps/web/src/lib/plan-view.ts`, shadcn components, and the existing mascot before writing chrome by hand.
- The screen holds no price or size literal.
- Copy is minimal: the reassurance line appears once. A PR that adds copy quotes it and says why it is needed.
- Mobile uses native iOS controls (Expo UI, native sheets and pickers) where they exist.
- Respect `prefers-reduced-motion`; every control has an accessible name.
- Web e2e screenshot test for the screen; do not run the desktop Playwright suite locally.

## Review Focus

- `pt-BR` shows reais and every other language dollars; the currency switch changes every price at once.
- AI switched off: no AI line in the price and the card says the person uses their own AI.
- Switching yearly on and off keeps the chosen plan and AI amount.
- Phone width: one column, no horizontal scroll, the price never pushes "/month" onto its own line.
- A member who is not the owner sees the plans with the subscribe buttons disabled and a short reason.

---

### Task 1: The plan cards component

**Files:**
- Create: `packages/ui-web/src/plan-cards.tsx`, `packages/ui-web/src/plan-cards.test.tsx`
- Modify: `packages/ui-web/src/index.ts`

**Interfaces:**
- Consumes: `planPriceCents`, `extraPersonCents`, `aiAddOnPriceCents`, `AI_USE_CENTS`, `currencyForLocale` from `@corvo/contracts`; `PlanEntitlements` without `extraSeatPriceId` (the `plans` array of `PlanUsage`).
- Produces: `PlanCards(props: { plans: Omit<PlanEntitlements, "extraSeatPriceId">[]; locale: string; canManage: boolean; pending: boolean; labels: PlanCardLabels; onSubscribe: (choice: { plan: PlanId; interval: BillingInterval; currency: BillingCurrency; aiUseCents: AiUseCents | null }) => void }): JSX.Element`. `PlanCardLabels` carries the translated strings so the package stays free of Lingui.

- [ ] **Step 1: Write failing tests**: `pt-BR` Team card shows `R$ 235,90`; `en` shows `$39`; yearly shows the year price divided by 12; AI off removes the AI part of the price; choosing Team, yearly, in `pt-BR` calls `onSubscribe` with `{ plan: "team", interval: "year", currency: "brl", aiUseCents: 1000 }`; `canManage: false` disables the buttons.
- [ ] **Step 2: Run** `pnpm vitest run packages/ui-web/src/plan-cards.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with shadcn `Switch`, `Select` and `ToggleGroup`; Team is the recommended card (dark panel and badge); the flat rook mascot, one per included person up to five; layout from the mockup.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-web): plan cards`.

### Task 2: Paywall uses the plan cards

**Files:**
- Modify: `apps/web/src/pages/Paywall.tsx`, `apps/web/src/components/ModelCredits.tsx`, the Lingui catalogs in `apps/web/src/locales/*`
- Test: `apps/web/e2e/billing-paywall.spec.ts`

**Interfaces:**
- Produces: `PlanChoice(props: { status: BillingStatus; dismissible?: boolean })`, shown by `PaywallPage` when `rpc.usage.plan()` returns plans; otherwise today's `CreditChoice` stays (self-hosted and legacy).

- [ ] **Step 1: Write failing e2e test**: the paywall shows three plans; choosing Team with AI on calls `billing.planCheckout` with plan `team`; a screenshot is attached for the PR.
- [ ] **Step 2: Run** `pnpm --filter @corvo/web test:e2e billing-paywall`. Expected: FAIL.
- [ ] **Step 3: Implement** `PlanChoice` keeping the sign-out and error handling `CreditChoice` has; fill every locale, `pt-BR` first.
- [ ] **Step 4: Run** the same command and the web unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): choose a plan in the paywall`.

### Task 3: Mobile parity

**Files:**
- Create: `apps/mobile/app/plans.tsx`, `apps/mobile/app/plans.test.tsx`
- Modify: the mobile billing entry that opens the web checkout today

- [ ] **Step 1: Write failing test**: the screen lists the three plans and, on choosing one, opens the returned checkout URL in the system browser.
- [ ] **Step 2: Run** `pnpm vitest run apps/mobile/app/plans.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with a native picker for the plan and a native switch for AI through Expo UI; currency from the device language.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): choose a plan`.
