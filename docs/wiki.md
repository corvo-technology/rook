# Wiki

A space's wiki is what its team knows (what an agent knows about one person is [Memory](./memory.md)), written as short pages that link to each other with
`[[Title]]`. Agents look in it before asking you something the team already knows, and cite the
pages they used. A cheap model reads settled conversations and keeps what lasts, and you approve,
refuse or undo what it keeps. You can also read, write, fix and restore pages yourself, on the web
and in the desktop app, and read, approve and refuse on a phone.

## Where pages live

Pages are memory documents with the scope `wiki`, so they are stored, encrypted and versioned like
the rest of memory (see [content encryption](./content-encryption.md)). A page's title is its
file name without `.md`, as in Obsidian: `[[Clients/Alpha.md]]`, `[[Alpha]]` and `[[Alpha|them]]`
all point to the page **Alpha**. Titles are unique in a space, compared without case or accents,
so `Café` and `cafe` are one title; writing a page under a second spelling is refused.

A page is Markdown with optional front matter (`type: Person`). Its kind, shown in the list, is
its `type`, else its folder, else `Other`. Every save keeps the text it replaces as a revision, and
restoring one writes it as a new revision.

A save that names a revision the page has moved on from is refused, so a newer edit is never
overwritten by a stale one.

## Who can read and write

Every member of the space reads and writes the wiki, and any member can approve or refuse what the
curator proposes. Pages belong to the space, not to the person who wrote them. A person's chats
with one agent stay theirs: the curator reads them only when a message is kept on purpose.

## What agents can do

Agents have three read-only tools:

| Tool | What it does |
| --- | --- |
| `wiki_index` | Lists the pages by kind, each with its first sentence. |
| `wiki_search` | Finds pages by words (the start of a word is enough, accents do not matter) and returns the matching passages. |
| `wiki_read` | Opens one page whole, with the pages it links to and the pages that cite it. |

`wiki_search` and `wiki_read` are always offered; `wiki_index` is found through `find_tool`. A run
is also told, in its prompt, how to use the wiki and given an index of up to 8 KB. Page text is
written by people and agents, so it reaches a run as data, never as instructions, and a run that
reads it is treated like one that read any other outside text. Runs that answer a messaging
channel get no wiki tools and no index.

Agents never write a page on their own. `save_shared_memory` still exists, but it now asks the
wiki to keep a page: a new page is written at once, and text for an existing page is added to it
(never put in its place, since the agent's copy may be old) and waits for approval unless the space
lets edits in.

## Documents

When a person attaches a PDF or a text file that holds knowledge the team will want again (a
contract, a policy, a manual, a specification), the agent offers to keep it in the wiki after it has
answered: it asks with a choice card, says that the wiki is where the team keeps what it knows and
that everyone in the space can read it, and saves it with `save_shared_memory` only after a yes. It
does not ask about the same file again, or after a no, and it does not offer a casual file. The
offer is an instruction to the model, so it can be missed or made too often; what is never missed
is that nothing is saved before the yes, because saving is a separate call that comes after the
answer. It is made whether or not the wiki already has pages, and not in a messaging channel or in
a background run, where nobody can answer.

Saving goes through the same rules as any other save: a new page is written at once and text for an
existing page waits for approval. A document is not yet read into the wiki part by part with its
source and page numbers kept; that is the curator reading documents, which comes next.

## The curator

After a conversation has been quiet for 20 seconds, a background job reads what was said since the
last time (at most the 14 newest messages, and only when there is something to read) and asks the
member's `fast` model, or the main model when none is set, for strict JSON changes: `create`,
`append` or `replace`. The model is told to keep decisions, lasting facts and results of work, and
not what an agent did, small talk, open questions or work in progress; a change the model does not
call lasting is dropped, and so is a `replace` whose old text is not on the page.

- **What it reads.** A channel belongs to one person, and what is learned from it is readable by
  the whole space, so channels are read by default only in a space with a single member; in a
  space with other people a channel is read only when its own switch is on. A chat with one agent
  is read only when you keep a message ("Keep in the wiki" in a message's menu) or switch capture
  on for it. A conversation held by outsiders over a messaging channel is never read. An owner of
  the space can turn the curator off. Each conversation's settings (web, desktop and mobile) have
  a switch, "Learn from this conversation", that shows what the curator does now and that only the
  conversation's owner can change; it is hidden while the curator is off for the space. Turning it
  stores an explicit on or off, so a later change of the default never flips a person's choice.
- **What it keeps.** The stretch it read is stored as a source, as it was said (encrypted), and
  every change points to it. Tokens, keys and email addresses are masked before the model sees the
  text and before it is stored. Only the person whose conversation it was can read the quoted
  source; everyone else sees the pages and the reason.
- **Approval.** A new page is written at once. A change to an existing page waits for approval by
  default (the setting "Approve edits" turns that off; only an owner of the space changes the
  settings). The conversation shows a card with what was kept and a way to approve, refuse or undo
  it, and the Wiki screen lists what waits. While a change waits, the card shows the text it would
  write (the old words and the new), so nobody approves blind. The reason and the title the model
  gave are shown only to the person whose conversation it was, like the quoted source. With two
  or more changes waiting, "Approve all" on the Wiki screen applies them oldest first; one whose
  page moved is marked conflicting, the rest still apply, and one another answer has already taken
  is left to that answer.
- **One answer at a time.** A change is claimed before its pages are written, so two answers (two
  members, the phone and the screen, an approval and a refusal) cannot both write pages. Refusing
  a change takes back the pages it had already written, unless someone edited them since.
- **Undo.** Undoing restores each page to what it said before the change, but only if nobody has
  edited the page since; otherwise nothing is changed and the change is marked as conflicting.
  A change made against a page that moved on before it could be approved is also marked
  conflicting, and nothing is overwritten.
- **When it cannot run.** With no model ready, nothing is read and nothing is lost: the cursor
  stays where it was. A model answer that is not usable is tried again up to three times. A
  stretch with too little text is not read yet and is read together with what follows. What the
  model costs is recorded as its own kind of usage.

- **Try again.** A change that ended in conflict without writing anything has "Try again" on its
  card. The curator's model is given the change, the pages as they are now and the source, writes the
  change again against them, and the change goes back to waiting for approval. When nothing of it
  still applies, or the model has nothing to say, the change stays as it was. A change that already
  wrote pages is put right by undoing it, not by trying again.

## The weekly review

The curator reads conversations; the review reads the pages themselves. About once a week per space,
while the wiki is in use (the review is queued after a read, and does nothing until a week has passed
since the last one), a background job gives the `fast` model (or the main model) the newest 40
pages, each cut to its first 2 000 characters, and asks for contradictions between pages, facts that
went stale and duplicates. Anyone in the space can ask for one now with "Review now" in the Wiki
settings.

- **Findings.** At most 5 per review. Each is a title, a sentence or two naming the pages, and the
  change that would fix it, shown under "Needs care" on the Wiki screen. A finding with no usable fix
  is dropped. It only edits pages (`replace` or `append`); it never creates one.
- **Approval.** A finding is an ordinary change: it waits for approval whatever the "Approve edits"
  setting says, and is approved or refused like any other (refusing is how it is dismissed).
  "Approve all" never includes findings. Everyone in the space sees a finding's title and reason,
  since they are about pages everyone reads. A finding that waits, or that someone refused, is not
  reported again.
- **When it cannot run.** With no model ready nothing is read and the week is not used up. A wiki
  with fewer than two pages has nothing to compare. A model answer that is not usable is tried again
  up to three times. What the model costs is recorded as wiki usage, like the curator's.

## Shared memory

A space's earlier shared memory (the documents every agent of a person reads) is copied into the
wiki as pages the first time the wiki is opened, once per person. The originals stay where they
are and keep being sent to agents for now; new saves go to the wiki. A title the wiki already has is not replaced, and a
page you delete afterwards stays deleted.

## Limits

- Up to 2 000 pages are read at once for the index, links and citations. A page past that is still
  found and opened by its title, but is not listed or counted. The index a run is given is built
  again only when the wiki has changed.
- A page's history shows its newest 100 revisions.
- A page holds up to 200 000 characters.
- Search matches whole words and word beginnings, ignoring case and accents. It does not search
  the middle of a word.
