# Plans and pricing: server by size, AI as an add-on, reais and dollars

## Intent

Today the choice screen offers one card with a switch: an own-model plan at US$ 10 a month, or model
credits from US$ 10 to US$ 500. It says nothing about people or space, and it charges in dollars only.

The new screen sells the **place where agents work**, in three sizes, and sells **AI separately** so a
person can use their own Claude or ChatGPT plan, or add models at cost. Prices show in the person's
currency, reais or dollars, chosen from the app language.

## Goals

- Three plans by size: Personal (one person), Team (up to 10), Company (up to 25), each with a monthly
  and a yearly price (two months free yearly).
- Extra people on Team (up to 15) and Company (up to 50), billed per person.
- AI is an add-on inside each plan. Off: the person uses the AI they already pay for (Claude, ChatGPT or
  an API key). On: a monthly amount of model credits at cost.
- Reais and dollars. The currency follows the app language and the person can change it.
- The screen reads like rook.team: same tokens, the flat mascot, pills, hairline rows, one dark plan.

## Non-goals

- A free tier, a trial, or per-agent or per-day limits.
- Live exchange rates. Reais are a fixed table.
- Other currencies. Only BRL and USD.
- Changing how a person's credit is spent. It still runs through the existing credit lots.

## Anti-goals

- A price that shows one number and charges another.
- A person charged in reais whose balance is wrong because of rounding or a repeated webhook.
- A plan change that silently drops people or files.
- Copy that explains the screen (see the repeated-reassurance rule in AGENTS.md).

## Decisions (the maintainer's)

| Plan | People | Extra people | Server, US$ | Server, R$ |
| --- | --- | --- | --- | --- |
| Personal | 1 | none | 15 | 89,90 |
| Team | up to 10 | up to 15, US$ 3 or R$ 19 each | 39 | 235,90 |
| Company | up to 25 | up to 50, US$ 3 or R$ 19 each | 89 | 537,90 |

- Yearly price is the monthly price times 10, shown per month.
- Reais are US$ at 6,05, rounded down to a price ending in ,90. The table is one source of truth in
  `@corvo/contracts`; there is no live conversion.
- Sizes, computers, storage and seat limits are the plan entitlements already in `packages/contracts/src/plans.ts`
  (`DEFAULT_PLANS`, editable per deployment with `PLAN_LIMITS`). This change only adds prices.
- AI amounts: US$ 10, 20, 50, 100 of use. The person pays the amount plus fees: US$ 12, 24, 60, 120 and
  R$ 71,90, 144,90, 362,90, 725,90. The picker shows the price; one line under it says how much goes to
  models.
- The AI add-on starts on, at US$ 10 of use, and can be switched off.
- Team is the recommended plan.

## Approaches

1. **Plans as Stripe products with seat quantity (chosen).** Three plan prices per currency and interval,
   one add-on price per AI amount, and one per-person price. The seat count is the Stripe quantity.
   Reuses the existing checkout, webhook and credit ledger; the largest change is accepting BRL.
2. **One flat plan plus metered usage.** Fewer products, but it hides the price and fights the
   "pay for the place, not the AI" idea. Rejected.
3. **Plans in our database, Stripe only as a payment pipe.** Full control, but we would rebuild
   proration, renewals and refunds. Rejected.

## How it works

1. **Plan pricing** in `@corvo/contracts` (`plan-pricing.ts`): the price table per currency and interval for
   plans, extra people and AI. Sizes stay in `plans.ts`. The screen, the API and the Stripe adapter read it.
2. **Currency** is a property of the organization's subscription, set at checkout from the app locale
   (`pt-BR` is BRL, the others USD) and changeable only before the first payment.
3. **Stripe adapter** stops assuming `usd`: it creates prices in the chosen currency, and every webhook
   check (checkout, invoice, charge, refund) compares against the subscription's currency instead of a
   constant.
4. **Credit ledger stays in dollars.** A reais payment buys the dollar amount in the table (R$ 71,90 buys
   US$ 10 of use). Refunds reduce the balance by the same table amount, not by a converted value.
5. **Seats.** Extra seats are already billed on their own line by `syncSeats` and capped with
   `PLAN_SEAT_LIMIT`. The extra-seat price now follows the subscription's currency and interval.
6. **Existing subscribers** keep their current plan and price until they choose a new one. The migration
   adds tables and columns only; nothing is dropped in the same deploy.
7. **The screen** replaces the current choice card. On web and desktop it is the shared UI package; on
   mobile it opens the same checkout. Copy lives in the message catalogs for the seven app languages.

## Constraints

- The Stripe adapter and ledger change is security and money sensitive: deterministic offline tests for
  every currency and interval, and for repeated and out-of-order webhooks.
- Production runs the old and new API side by side for a few seconds, so every migration keeps working
  with the previous release.
- No hosted vendor beyond Stripe, which already sits behind the billing adapter.

## Phases

1. Pricing in contracts.
2. Stripe prices and webhooks for BRL and yearly.
3. Seats and extra people, and the cap prompt.
4. AI add-on picker wired to the credit lots, including the off state.
5. Mobile and desktop parity, and the migration of existing subscribers.

## Left to the builder

Names of tables and columns, the exact Stripe product layout, the copy in the six other languages, and
the mockup's dark-mode details. The approved mockup is the visual reference.

## Open

- Whether the recommended plan's border and badge stay as in the mockup once rendered in the app theme.
- Whether files should rise once the hosting capacity for 100 and 200 GB is confirmed.
