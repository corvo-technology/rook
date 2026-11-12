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
that everyone in the space can read it, and keeps it with `save_shared_memory` (naming the file)
only after a yes. It does not ask about the same file again, or after a no, and it does not offer a
casual file. The offer is an instruction to the model, so it can be missed or made too often; what
is never missed is that nothing is kept before the yes, because keeping is a separate call that
comes after the answer. It is made whether or not the wiki already has pages, and not in a
messaging channel or in a background run, where nobody can answer.

The same can be done from the Wiki screen: choose a file with the paperclip, or drop it on the
screen. Both ways go to one background job, so the screen and the agent get the same result.

### How a file is read

The file's text is read inside the server, with no computer and no hosted service: a PDF page by
page, a text file as it is. Tokens, keys and email addresses are masked first. The text is cut into
parts of about 12 000 characters (a PDF part is a run of whole pages), at most 30 parts, so a very
long file is read as far as that and the change says so. Each part goes to the curator's model
(the member's `fast` model, or the main one) with the wiki's index, the pages that may be related,
and the pages the earlier parts of the same file already planned, so a later part adds to a page
instead of creating it twice. The model is told to cite the source on every fact it keeps, as
`(Source: policy.pdf, p. 3)` or `(Source: notes.txt, part 2)`, so the citation lives in the page.
A part whose answer is not usable is asked again once.

What comes out is one change, with the file as its source, under the rules of every other change:
new pages are written at once and edits to existing pages wait for approval unless the space lets
them in. The source keeps the file's masked text (encrypted), readable only by the person who added
the file. Started from a conversation, the change shows there as the usual card; started from the
Wiki screen, it appears in the list of what waits.

- **Progress.** A file being read is listed on the Wiki screen with its name and a spinner. A
  file that could not be read stays listed, with the reason, until it is dismissed or a day
  passes. A read that stops moving for 30 minutes is no longer listed.
- **Limits.** A file is at most 10 MB. Only PDF and text files are read (plain text, Markdown,
  CSV, JSON). A Word document or a spreadsheet in its own format is refused with a message that
  says to save it as a PDF or a text file; a PDF with no text layer, as a scan is, is refused
  because there is nothing to read.
- **Failures.** No model ready, a file that cannot be opened, a model that does not answer with
  something usable, and a file with nothing new in it each end as a failed import with a reason.
  Nothing is half written: pages are written only once every part has been read.

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

Not done yet: a way to ask the curator to try a conflicting change again.

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
