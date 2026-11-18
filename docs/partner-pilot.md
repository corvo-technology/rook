# Partner pilot

A SaaS partner (here `acme-saas`) embeds Rook agents for its own customers. The partner's backend
calls a small API; each customer gets an isolated organization with one owner, a connector to the
partner's system, and starter agents. Nothing here needs a hosted vendor.

## Operator: the Partnership page

Set `PARTNER_ADMIN_EMAILS` (comma separated) on the API. Those people see **Settings > Partnership**:
they become a partner by entering a company name, copy the key (shown once), replace it with
**New key**, and pause or resume each customer. Nobody else sees the page, and its calls answer
not found for them. Each customer row shows what it has used this month and what it has left;
when a customer's credit runs out, its runs say "This month's credit is used up."

## Operator: apply a template

Two ways, the same result:

- Settings > Partnership > **Import** reads a template `.json` file into the editor. Check the agents,
  type the connector address (the `{{MCP_PUBLIC_URL}}` placeholder is left empty on purpose and
  **Save** stays off until it is filled), and save.
- `partner apply-template <slug> <file.json> --mcp-url <https://...>` stores it for any partner, made
  in the app or on the command line. It validates the file first and stores nothing on any error,
  and running it again with the same file changes nothing.

A template applies to customers made from then on. A customer's agents are made once per `key` and
never overwritten, so existing customers keep what they have.

## Operator: tell the partner when credit runs low

A partner can have a `webhookUrl`: Rook calls it when one of its customers has used 80% of the
month's credit it was given, and again when it is used up. Set it, or remove it with `off`:

```
pnpm --filter @corvo/api partner webhook acme-saas https://hooks.example.com/rook
pnpm --filter @corvo/api partner webhook-secret acme-saas    # show the signing secret again
pnpm --filter @corvo/api partner webhook-rotate acme-saas    # replace it; the old one stops matching
pnpm --filter @corvo/api partner webhook acme-saas off
```

The address must be `https` and public. Each notice is a `POST` with a JSON body, sent once per
customer, kind and month:

```
{ "id": "...", "type": "tenant.allowance_low" | "tenant.allowance_exhausted",
  "createdAt": "2026-11-20T12:00:00.000Z", "externalTenantId": "shop-1", "period": "2026-11",
  "grantedCents": 1500, "usedCents": 1260, "remainingCents": 240 }
```

Headers: `X-Rook-Event`, `X-Rook-Delivery` (the `id`, for de-duplicating), `X-Rook-Timestamp` (seconds)
and `X-Rook-Signature: sha256=<hex>`, the HMAC-SHA256, keyed by the signing secret, of
`<timestamp>.<raw body>`. Reject a call whose signature does not match or whose timestamp is more
than a few minutes old. Answer any `2xx` once handled. Anything else, or no answer within ten
seconds, is retried by the job queue with backoff (up to 8 attempts), and a notice still not delivered
is queued again for up to three days. The body never carries a key, a token or customer content, and
the signing secret is derived from the deployment's `ENCRYPTION_KEY`, not stored.

## Operator: create and rotate a key from the command line

Run on the server with the runtime `DATABASE_URL` (and the deployment's `ENCRYPTION_KEY`, which
the webhook commands need):

```
pnpm --filter @corvo/api partner create acme-saas "Acme SaaS" --wallet-owner owner@example.com
                                                                # prints the key once
pnpm --filter @corvo/api partner rotate acme-saas               # old key stops working
pnpm --filter @corvo/api partner disable acme-saas              # key refused; its customers' links stop
pnpm --filter @corvo/api partner enable acme-saas
pnpm --filter @corvo/api partner apply-template acme-saas template.json --mcp-url https://mcp.example.com/mcp
pnpm --filter @corvo/api partner webhook acme-saas https://hooks.example.com/rook   # prints the signing secret
```

Only a hash of the key is stored. Give the key to the partner over a private channel.

`--wallet-owner` names the account (by its email) whose credit pays for the partner's customers, the
one filled in Billing. Without it a partner made on the command line has no credit to pass on, and
every `allowanceCents` is answered `402`. Several partners can name the same account, which is how one
company runs one partner per product on one balance.

## One partner per product

A company with several products makes one partner for each (for Greenflow: `greenbarber`,
`divellas` and `prontu`). Each has its own key, template, Chief name and colour, and customers never
share across partners. The partner's backend picks the key by the customer's product. All of them
can draw on one credit account with `--wallet-owner`, and the limits and customers shown under
Settings > Partnership are those of the partner that account owns in the app.

## The three calls

All calls send `Authorization: Bearer <partner key>` and JSON. Every refusal for a missing or wrong
key is the same `401`; a customer that does not exist and one that belongs to another partner both
answer `404`.

1. Create or update a customer (safe to repeat):

   ```
   PUT https://corvo.example.com/api/partner/v1/tenants/{externalTenantId}
   { "name": "Shop One",
     "connector": { "slug": "acme-system", "name": "Acme system",
                    "endpoint": "https://mcp.acme.example/v1", "token": "<per-customer token>" },
     "agents": [{ "key": "manager", "name": "Manager", "instructions": "...", "usesConnector": true }],
     "allowanceCents": 1500, "period": "2026-11", "state": "enabled" }
   → { "tenantId": "...", "created": true }
   ```

   `"locale"` (optional, for example `"pt-BR"`) is the customer's language: it names the customer's
   Chief, the agent in front of the partner's agents. Portuguese reads Portuguese; no `locale`, or
   any other language, reads English. It only matters when the customer is first made.

   Each agent may also carry `"starters": ["Show today's bookings", ...]` (up to four short
   messages), shown as buttons while its chat is empty; a tap sends it.

   The template (Settings > Partnership > **Edit**, or `apply-template`) also holds:

   - `chiefName`: what a new customer's Chief is called, for example `"Assistente GreenBarber"`.
     Without it the Chief has its localized default. It is set when the customer is first made;
     existing customers keep the name they have.
   - `accent`: the partner's main colour as `#rrggbb`. The embedded assistant and the page a
     redirect opens use it whenever the page that embeds Rook passes no `accent` of its own.
   - `models`: `"fixed"` (the default, the customer cannot change the model) or `"choose"`.
   - `hide`: areas left out of the bar: `routines`, `workflows`, `usage`, `artifacts`, `store`.

   A template is plain JSON, so these fields need no migration. Ready-made templates for Greenflow
   are in `apps/api/src/partner-templates/` (`greenbarber.json`, `divellas.json`, `prontu.json`). They
   name the Greenflow MCP address as `{{MCP_PUBLIC_URL}}`, which is filled in when they are applied.

   Agents are made once per `key` and never overwritten, so what the customer edits stays. Define
   the agents and the connector once under Settings > Partnership (**Agents > Edit**) and the call
   can be just `{ "name": "Shop One", "connectorToken": "<token>", "allowanceCents": 1500 }`; what
   the call names itself wins over the template. The same page lists areas to **Hide from
   customers** (routines, workflows, usage, artifacts, store); agents always stay. Hiding only
   removes the entry from the bar. Customers use the deployment's model and cannot change it
   (the picker is hidden and the server refuses a change) unless the template ticks **Customers
   can choose the model**. The template's connector has no token, so each
   call sends `connectorToken` for its customer. The
   connector token and address follow the latest call. `allowanceCents` is the customer's credit for
   the month (default: the current one); raising it adds the difference, lowering it takes nothing back.

   The partner pays for it. A partner made in the app (Settings > Partnership) passes credit on
   from its owner's own credit account, the one filled in Billing. A pass-on the account cannot cover
   answers `402 {"error": "wallet_insufficient"}`; one over a limit the partner set (per customer or
   in total per month, on the same page) answers `409 {"error": "allowance_limit"}`. The customer
   and its agents are still set up, and the body carries `tenantId`, so the partner adds credit or
   raises the limit and repeats the call. What a customer leaves unused when its month ends goes
   back to the owner's account. A partner made on the command line has no owner account, so it has no
   credit to pass on and every `allowanceCents` is answered `402`; make the partner under Settings >
   Partnership instead, and buy credit in Billing.

2. Pause or resume: `POST /api/partner/v1/tenants/{externalTenantId}/suspend` and `/resume`
   (or `state` on the `PUT`). A paused customer's runs fail at once with "This account is paused."
   and no link opens. Pausing also signs the customer out everywhere, so a frame that is already
   open stops at once. A customer's session also ends eight hours after it began, however
   it is renewed, so the page asks for a new code at least that often.

3. Let a person in: `POST /api/partner/v1/sessions`
   `{ "externalTenantId": "...", "externalUserId": "...", "email": "optional" }`
   → `{ "url": "https://app.example.com/api/partner/enter?code=...", "expiresAt": "..." }`.
   Redirect the browser to `url` within 60 seconds. The link works once, then signs the person in
   as the customer's owner.

## Greenflow

Greenflow runs three partners on one Rook deployment (`greenbarber`, `divellas`, `prontu`) and its
backend picks the key by the customer's product. Its environment:

```
ROOK_API_URL=https://api.rook.team
ROOK_WEB_URL=https://app.rook.team
ROOK_PARTNER_KEY_GREENBARBER=<key of greenbarber>
ROOK_PARTNER_KEY_DIVELLAS=<key of divellas>
ROOK_PARTNER_KEY_PRONTU=<key of prontu>
```

The session route calls `PUT {ROOK_API_URL}/api/partner/v1/tenants/{tenantId}` with
`{ name, locale: "pt-BR", connectorToken, allowanceCents, period, state }` and no agents (they come
from the template), then `POST .../sessions`, and returns only `{ code }`. The page loads
`{ROOK_WEB_URL}/sdk.js`. Setup, once, on the Rook server:

```
pnpm --filter @corvo/api partner create greenbarber "GreenBarber" --wallet-owner <owner email>
pnpm --filter @corvo/api partner create divellas "Divellas" --wallet-owner <owner email>
pnpm --filter @corvo/api partner create prontu "Prontu" --wallet-owner <owner email>
pnpm --filter @corvo/api partner apply-template greenbarber apps/api/src/partner-templates/greenbarber.json --mcp-url <MCP_PUBLIC_URL>
pnpm --filter @corvo/api partner apply-template divellas apps/api/src/partner-templates/divellas.json --mcp-url <MCP_PUBLIC_URL>
pnpm --filter @corvo/api partner apply-template prontu apps/api/src/partner-templates/prontu.json --mcp-url <MCP_PUBLIC_URL>
```

Each `create` prints that partner's key once. The owner's account needs credit in Billing first.

## What the partner's backend implements

- A button (or menu item) that calls the sessions endpoint server-side and redirects to the URL.
- One route that provisions a customer when it signs up (the `PUT` above).
- A connector token per customer, and an MCP server at the connector address that accepts it and
  only returns that customer's data.

## Embed the assistant in your own page

Instead of redirecting, put the assistant in a frame on your page, signed in as the customer.

1. A route on your backend (for example `POST /corvo/session`) that calls Rook's
   `POST /api/partner/v1/sessions` for the logged-in customer and returns `{ "code": "<code>" }`
   from the answer. Return only the code: never the key, never the redirect address.
2. On your page:

   ```html
   <script src="https://app.corvo.example.com/sdk.js"></script>
   <corvo-assistant session-url="/corvo/session" theme="auto" style="height: 600px"></corvo-assistant>
   ```

   `theme` is `light`, `dark` or `auto`; `locale` is `en`, `de`, `pt-BR`, `zh-CN`, `es`, `fr` or
   `ja` (default: the visitor's language). `accent` is your main colour as `#rrggbb` (for example
   `accent="#e11d48"`): buttons and the current state use it, and the text on it turns light or dark
   to stay readable; leave it out to use the partner template's `accent`, or Rook's own green when
   the template has none. Change any attribute and the frame
   follows without reloading. The element asks your route for a new code whenever the frame needs one, and fires
   `corvo-ready` and `corvo-expired` events.

The frame keeps its session token in memory only (a frame cannot keep a cookie on another site),
so the page never sees it. Any site may frame the page, but a frame without a valid one-use code
shows nothing.

## Try it without a partner

With the API running and the key of a partner made under Settings > Partnership that has credit in Billing (a partner made with `partner create` has none, so its allowance is refused):

```
PARTNER_API_URL=http://127.0.0.1:3100 PARTNER_API_KEY=<key> pnpm --filter @corvo/api partner:demo
```

For the embed, `pnpm --filter @corvo/api partner:embed-demo` serves a pretend partner page on
`http://localhost:4310` with theme and language selectors. It needs `PARTNER_API_URL`,
`PARTNER_API_KEY` and, unless the API is on localhost, `CORVO_WEB_URL`: the web app is where
`sdk.js` is served, and a deployed API serves none. Against a deployment:

```
PARTNER_API_URL=https://api.rook.team CORVO_WEB_URL=https://app.rook.team \
PARTNER_API_KEY=<the partner's key> PARTNER_DEMO_TEMPLATE=1 PARTNER_DEMO_LOCALE=pt-BR \
PARTNER_DEMO_CONNECTOR_TOKEN=<a connector token for the demo customer> \
pnpm --filter @corvo/api partner:embed-demo
```

`PARTNER_DEMO_TEMPLATE=1` sends no agents of its own, so the demo customer gets the partner's
template (its agents, Chief name and colour); without a `PARTNER_DEMO_CONNECTOR_TOKEN` the template's
connector is left out. `PARTNER_API_URL` may also be written with the `/api/partner/v1` path. The
demo customer is real in whatever deployment it points at (`demo-shop`, 5 dollars of credit), so use
a test partner, and pause the customer when done.

The first command creates a demo customer with two agents and prints the link. Open it: you land signed in, with
the agents present and no onboarding or billing screen.

## Consultation recording

A partner whose customers keep records (a clinic, a salon) can send Rook the audio of a visit and
get back a **draft** note in the customer's own record. Rook never signs: the professional reviews,
edits and signs in the partner's product. The call set is scoped to one customer and uses the same
partner key, the same `401` for a wrong key and the same `404` for a customer or consultation that
is missing or belongs to another partner (a paused customer answers `404` too).

Requirements on the partner side:

- The customer's connector must offer the record tools `mcp_records_get_by_client` (`{ clientId }` to
  `{ recordId, existingDraft }`; called with `{ clientId, appointmentId }`, `existingDraft` is the
  unsigned AI draft already made for that appointment, as `{ entryId, revision }` or null),
  `mcp_records_entries_update_draft` (`{ recordId,
  entryId, expectedRevision, content }`) and `mcp_records_entries_create_draft` (`{ recordId,
  entryTypeCode, content, occurredAt, appointmentId?, source: "ai_scribe", consultationId }` to
  `{ entryId }`). Writes carry an `idempotencyKey` (the consultation id), and the record system adds
  the `aiDraft` badge. When `existingDraft` is set, or creating answers `MCP_RECORDS_DRAFT_EXISTS`, Rook
  updates that draft with `expectedRevision` instead of creating a second. Rook calls them as the customer's **Escriba** agent
  (the template agent with the key `escriba`; any agent that holds the connector when there is none),
  so the connector's own authorization applies. Drafts only: Rook has no tool to sign.
- The patient's consent is the partner's to obtain before it creates the consultation, and is
  stored with it.

```
POST /api/partner/v1/tenants/{externalTenantId}/consultations
{ "externalUserId": "doctor-1", "template": "prontu_evolution",
  "context": { "clientId": "c-123", "appointmentId": "a-9",
               "professionalName": "Dr. Lima", "clientName": "Maria" },
  "consent": { "obtained": true, "at": "2026-12-01T10:00:00Z", "method": "verbal" },
  "retentionDays": 30 }
→ { "consultationId": "..." }

PUT  .../consultations/{id}/chunks/{seq}     raw audio, Content-Type audio/webm or audio/ogg
→ { "ok": true }
POST .../consultations/{id}/finish
→ { "state": "processing" }
POST .../consultations/{id}/reprocess      a failed consultation again, from its stored chunks
→ { "state": "processing" }  (the current state when it is not failed)
GET  .../consultations/{id}
→ { "state": "drafted", "transcript": [{ "speaker": "professional", "startMs": 0, "text": "..." }],
    "note": { ... }, "draftEntryId": "..." }
DELETE .../consultations/{id}                deletes the audio and transcript now
```

- `template`: `prontu_evolution` (files an entry of type `evolution` with `{ schemaVersion: 1,
  title, notes, chiefComplaint, history, exam, assessment, plan, prescriptions: [string], followUp,
  appointmentId, aiDraft }`) or `salon_service_record` (type `service_record`, `{ schemaVersion: 1,
  title, servicesDone, productsUsed, clientPreferences, nextVisit, notes, appointmentId, aiDraft }`).
  Every field is text except `prescriptions`; what was not said is an empty string. `notes` always
  holds the whole note as readable text (a summary, then each structured field as a titled section),
  so an editor that keeps only `notes` loses nothing.
- `consent.obtained` must be `true`; `method` is `verbal` or `written`; `text` is optional.
- Upload a chunk about every 10 seconds, numbered from 0, in order or not. A chunk is at most 2 MB,
  a consultation at most 540 chunks (90 minutes) and 96 MB; past that the answer is `413` with
  `too_long` or `too_large`. Repeating a `seq` is safe and changes nothing. Record opus at about
  32 kbit/s (`audioBitsPerSecond: 32000`) so 20 minutes stay near 5 MB. Chunk uploads are not
  counted against the partner's per-minute request limit.
- States: `recording` (chunks accepted), `processing` (after `finish`), `drafted` (the note is in the
  record; `draftEntryId` names it) and `failed` with `error.code`: `no_audio`, `no_speech`,
  `transcription_failed`, `model_failed`, `connector_failed`, `record_not_found`,
  `credit_exhausted` or `internal`. Poll `GET` every few seconds. `finish` twice answers the
  current state, and `finish` on a `failed` consultation processes it again from the stored chunks. Creating or finishing when the customer's credit is used up answers
  `402 {"error": "allowance_exhausted"}`; add credit as for any customer.
- Rook concatenates the chunks, transcribes them in Portuguese through the customer's configured
  speech provider (long recordings are cut at container boundaries into 8 MB segments transcribed
  in parallel and stitched in order), labels who speaks (`professional`, `patient` or `unknown`)
  with a short model pass on the fast tier, has the Escriba fill the template on the strong tier
  with an explicit, versioned prompt, and files the draft. Speaker times are estimates.
  Transcription and model use are charged to the customer's allowance like any other use.
- Privacy: audio chunks and the transcript and note are stored only in sealed object storage, never
  in database rows, and sent only to the configured speech and model providers and to the
  customer's connector. They are never used for training and never written to logs or security
  events. Creating, reading (a `GET` that returns the transcript) and deleting are audited without
  content. Audio and transcript are deleted `retentionDays` after the visit finished (default 30;
  set a partner default with `partner retention <slug> <days|default>`; `1` to `365`), or, for a recording with no chunk for 2 hours, after that; or at once on
  `DELETE`; afterwards the consultation answers `404` and only a bare record remains (names and
  consent wording removed).

## What the pilot deliberately does not do

- One Rook seat (the owner) per customer; the partner's own users share it.
- No per-user permissions, shared agents or versioned agent updates: a template applies to customers
  made after it, and an agent is made once and then belongs to the customer.
- Only the Settings > Partnership page of the partner an account owns is in the app; further partners
  of the same company are managed from the command line.
- Speech summaries and team-chat judging are not paused with the account.
- Credit rows are scoped to an organization for sessions acting for a space; server code with no
  space (webhooks, the worker) can still read them, as it spans organizations.
