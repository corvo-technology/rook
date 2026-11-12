# Memory

What your agents know about **you**: short facts and preferences that every one of your agents reads
before it answers. It is private to you in each space and is not the space's [wiki](./wiki.md), which is
what the team knows. An agent's own working notes (the `remember` tool) stay with that agent.

## What it holds

One line each: "Prefers answers in Portuguese", "Runs a bakery in Lisbon". A fact is at most 200
characters. Every saved fact goes into the prompt of each of your agents, the most recently confirmed first, up to 4 KB; older
ones are left out of the prompt and an agent finds them with `recall_about_user`. Facts reach the model as
data, never as instructions. A messaging channel run, where outsiders talk to the agent, gets none.

## How facts get in

1. **You teach it.** On the Memory screen (Settings, Memory) type a fact and press Enter. It is saved at once.
2. **An agent proposes it.** During a conversation an agent may call `remember_about_user` for something you
   said about yourself. What happens depends on the agent's **Facts about you** setting (agent settings):
   - **Ask first** (the default): a card in the conversation, "New memory", with Save and Discard. Nothing is
     stored as known before Save.
   - **Save on its own**: the fact is saved and the card shows Undo.
   - **Only read**: the agent uses what is known and cannot add to it; it is not even offered the tool.
3. **The memory model suggests it** (off by default; the switch "Suggest from what I say" on the Memory
   screen). After a conversation has been quiet for 30 seconds, the fast model reads only what **you** said
   (at most the 14 newest messages, tokens and keys masked first, never what an agent said or assumed) and
   judges it against a versioned rubric (`USER_MEMORY_RUBRIC` in `packages/core/src/user-memory.ts`):
   said by you about yourself, lasting, standing rather than for this task, not a secret. Suggestions always
   wait for Save. Agents that only read learn nothing new. The model's cost is recorded as its own usage
   kind, `memory`. With no model ready nothing is read and nothing is lost.

## The Memory screen

- **New**: suggestions waiting for Save or Discard.
- **Still true?**: facts you have not seen for 180 days. They stay in the prompt until you choose Keep or
  Forget.
- The list: edit a fact in place, or forget it.
- **Forgotten**: a forgotten or discarded fact leaves the prompt and is kept only as a one-way digest of its
  normalized text (and the text, so you can see it here), so no agent and no model suggests it again. You can
  teach it again yourself, or **Delete for good**, which removes even the record.

On a phone the card in the conversation has Save, Discard and Undo, and the Memory list (Settings, You) is
read-only apart from saving or discarding what waits. Teaching, editing, forgetting, the per-agent setting
and the learning switch are on the web and desktop apps for now.

## Storage

The `user_memories` table, one row per fact: `text` is [encrypted](./content-encryption.md); `state` is
`pending`, `saved` or `forgotten`; the fingerprint is a SHA-256 of the normalized text keyed by space and
person. Row-level security limits a row to its space and its person, and every procedure names the caller,
so nobody else, owners included, can read it. Notes saved earlier with `remember`, and any older
person-level memory documents, keep being sent to agents as before.
