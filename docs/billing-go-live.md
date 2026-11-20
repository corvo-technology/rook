# Billing go-live

Plans are off wherever `PLAN_PRICES` is unset: nobody is limited and checkout for plans has no
effect on limits. Turn them on in this order. Use placeholders below; real keys and ids live only in
the deployment's secret store.

1. Create the prices in **test mode** first.

   ```sh
   STRIPE_SECRET_KEY=<test secret key> pnpm exec tsx scripts/stripe-ensure-prices.ts
   ```

   It creates every missing plan, extra person and AI price (reais and dollars, monthly and yearly)
   by lookup key and prints `PLAN_PRICES='{"<price id>":"<plan>", ...}'`. Running it again creates
   nothing and prints the same value.
2. Set `PLAN_PRICES` on the API service to that value. Plans, limits and seat billing start applying
   the next time an organization's subscription syncs.
3. Create the webhook endpoint for the same environment, with the same events as the existing one
   (`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.*`, `customer.deleted`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`), and set its signing secret
   as `STRIPE_WEBHOOK_SECRET`.
4. Buy a plan in test mode in reais and in dollars, with and without the AI add-on and an extra
   person, and check the credit grant, then refund it and check the balance goes back down.
5. Repeat steps 1 to 3 with the **live** keys. Test and live keys, prices, webhook endpoints and
   `PLAN_PRICES` values never mix: each environment has its own.

Notes

- A customer's currency is fixed by Stripe at their first payment; the API refuses another one.
- Subscriptions set up before this change keep their price and resolve to their plan through
  `PLAN_PRICES`; leave their price ids in the mapping if they should keep a plan.
- A yearly AI add-on grants the whole year of model use when it is paid.
