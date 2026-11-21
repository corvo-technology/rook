# WhatsApp for partners (embedded and white label)

Status: design notes, not built. This describes how partners' customers talk to their agents over
WhatsApp without ever seeing Rook, so the work can be planned later.

## Decisions so far

1. **Rook is a Meta Tech Provider.** Partners connect their WhatsApp Business Account (WABA) to Rook
   through Meta's Embedded Signup, from the partner console.
2. **Always coexistence.** Every number joins the Cloud API through Meta's coexistence onboarding,
   so the business keeps using the WhatsApp Business app on the same number while Rook reads and
   answers through the Cloud API. Nobody has to give up the app or move to a new number.
3. **One number per partner** for the assistant. All of a partner's customers talk to that one
   number; Rook tells them apart by the phone each person linked.
4. **Customer numbers later.** Each partner customer may also connect its own number (to have its
   own customers served by an agent). How that works is open; see the end of this page.

## What each side owns

| Piece | Owner | What the end customer sees |
| --- | --- | --- |
| Assistant number and WABA | Partner | The partner's verified business name and photo |
| Assistant name used in replies | Partner (set in the console) | e.g. "Norte" |
| Agents, routing, approvals | Rook | Nothing |
| Links in messages | Partner domain (white label) or partner product (embedded) | The partner's address |
| Conversation charges | Meta bills the partner's WABA | Nothing |

No reply, template, link or error ever names Rook. The same model serves embedded partners
(a clinic EHR, a salon system) and white-label partners.

## Flow

### 1. The partner connects its number (once)

- Partner console, new **WhatsApp** section: "Connect WhatsApp" opens Meta's Embedded Signup with
  coexistence. Meta shows the Tech Provider app here; that is fine, the partner knows it uses Rook.
  The partner's customers never see this screen.
- After signup Rook stores the WABA id, phone number id and the system user token (encrypted, like
  other connection secrets), subscribes the app to the WABA webhooks, and shows: number, display
  name, verification state, messaging tier, quality rating.
- The partner sets the assistant name used in replies and which domain links open.
- Message templates (proactive notices) are created and tracked per partner WABA: approval state is
  shown in the console. Templates are needed outside the 24-hour customer service window.

### 2. A person links their phone (once)

- Inside the partner's product (embedded) or the white-label app: **Settings › Your WhatsApp**.
  The person types the phone; Rook sends a one-time code **from the partner's number**; the person
  types it back.
- The link binds phone → member → customer (organization) → role and scope (the same role model
  the embedded sessions use). A phone may be linked to several customers.
- Unlinking: from the same screen, from the partner console, or automatically when the member is
  removed or the customer leaves the partner.

### 3. Everyday use

- Inbound message on the partner number → Rook resolves the partner by phone number id, then the
  person by the sender's phone.
  - Unknown sender: one reply with a link to link the phone in the partner's app; nothing else is
    processed.
  - Several customers: "Which company?" on the first message, then the last one used is remembered
    with an easy way to switch.
- The message (text, voice note, photo, PDF, location) becomes a turn for that customer's lead agent,
  with the person's role and scope applied.
- Writes into the partner system go through the partner connector (MCP) and keep the normal
  approval rules. On WhatsApp the confirmation is an interactive message with reply buttons.
- Example: a photo of a receipt at the supermarket → the lead agent reads amount, store, date and items
  → "Record R$ 87,40 at Mercado Bom Preço under Supplies?" [Record] [Change category] → on Record,
  the expense is created in the partner's finance module with the receipt attached, and the reply
  links to it on the partner's domain.

### 4. Proactive messages

- Notices (approval needed, customer no-show, weekly summary) go out from the partner number using
  that partner's approved templates. Inside the 24-hour window a free-form reply is used instead.
- Respect each person's notification preferences and quiet hours.

## Coexistence notes to verify before building

These come from Meta's coexistence behaviour and must be checked against the current Meta
documentation when the work starts:

- Messages sent from the WhatsApp Business app and from the Cloud API both appear in the app;
  Rook must not answer a chat a human is already answering (a short hand-off window after a human
  reply).
- History import on onboarding is limited; Rook should not reply to imported history.
- Some app features (for example groups, broadcast lists, view-once media) are not available
  through the API; the agent ignores those threads.
- Throughput and pricing follow the WABA's tier and Meta's per-message pricing; the partner sees
  usage and quality in the console.

## Security and privacy

- Phone numbers are personal data: stored once, masked in lists, deleted with the member.
- Linking codes are short-lived, single-use and rate limited per phone and per partner.
- Webhooks are verified with the app secret; tokens stay in the secret store and never reach a
  browser.
- Message content is the customer's data: partners see counts and states, never content (the same
  rule as the partner console).
- Inbound text and media are untrusted input to the agent.

## Open: a number per customer

Some customers will want their own number so the agent serves their clients (a barbershop's
clients booking by WhatsApp). Options to evaluate:

1. **Customer-owned WABA through Embedded Signup with coexistence**, launched from the white-label
   app. Open point: Meta's signup window shows the Tech Provider app's name, which may expose the
   platform to the end customer; check what the app name and business name can be.
2. **Partner-managed WABA with several numbers**, one per customer, under the partner's business.
   Simpler for the customer, but the partner carries verification, quality and billing for all.
3. **Linked device (QR)**, which exists today for Rook workspaces. No Meta screens, but unofficial
   and at risk of bans; acceptable only as a stopgap.

Questions to answer before choosing: who pays Meta for customer numbers, who handles business
verification, how the console shows quality per number, and how a customer moves its number if it
leaves the partner.

## Pieces to build (when this is picked up)

- Partner console: WhatsApp section (Embedded Signup with coexistence, status, assistant name,
  templates, linked people).
- Multi-WABA routing in the Cloud API webhook (partner by phone number id, person by sender).
- Phone linking with one-time codes, in the embedded app and the white-label app.
- Media handling (voice, images, PDF) into runs; interactive reply buttons for approvals.
- Per-partner template management and proactive sends.
- Partner connector tools needed by the examples (for instance "create expense with attachment" in
  the Greenflow MCP).
