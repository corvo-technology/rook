// Creates the plan prices in Stripe once and prints the PLAN_PRICES value for the API.
// Usage: STRIPE_SECRET_KEY=<key> pnpm exec tsx scripts/stripe-ensure-prices.ts
// Run it with a test-mode key first, then a live one. Safe to run again.

import { ensurePlanPriceSetup } from "../packages/adapters/src/plan-price-setup.ts";
import { StripeBillingProvider } from "../packages/adapters/src/stripe-billing.ts";

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey) throw new Error("Set STRIPE_SECRET_KEY");

// Only prices are touched, so no webhook secret is needed.
const provider = new StripeBillingProvider({ secretKey, webhookSecret: "unused" });
const { ids, planPrices } = await ensurePlanPriceSetup(provider);
console.error(`${Object.keys(ids).length} catalog prices exist.`);
console.log(`PLAN_PRICES='${JSON.stringify(planPrices)}'`);
