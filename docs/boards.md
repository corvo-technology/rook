# Tasks

A space's task board (shown as Tasks in the app) is where people and agents keep track of what is being done. Each card is a
ticket with an owner, a column, comments and named data. It is on in the desktop app. On a hosted
or self-hosted deployment it is behind `TICKET_BOARD_ENABLED`.

## Columns

There are six columns, always the same: To do, In progress, In review, Blocked, Done, Won't do.
Their keys (`todo doing review blocked done closed`) never change. A board can show its own name
for a column, such as "In contact" for In progress: open the settings button in the Tasks header,
type a name, and clear it to go back to the built-in one. Only the names a person changed are
stored; a column without one keeps the built-in name in the language of the app. The board listing
an agent reads carries the changed names, so it speaks the way the board does.

## Cards

A ticket has a title, a description, a priority, one owner (an agent in the space), a column,
comments and fields. A field is a name and a text, such as `Contact: ana@example.com`. A ticket
holds at most 20 fields; a name is at most 60 characters and a value at most 500. Setting a
field by a name that exists replaces it, without regard to case, and an empty value removes it.
Fields are stored like the rest of the ticket, not encrypted separately.

People and agents move cards. Giving a ticket to an agent wakes it with the work to do. A card in
In progress shows a mark and the agent's latest step while its owner is working on it.

## Tickets that move with the run

A run woken for a ticket carries that ticket (`runs.ticketId`), and the backend moves the ticket
with the run, as the agent, so the existing move signal and notices apply:

- The run starts and the ticket is in To do: it moves to In progress.
- The run ends and the ticket is still in In progress: it moves to In review.
- The run fails, or a run guard or limit stops it, and the ticket is still in In progress: it
  moves to Blocked, and the run's error is left as a comment by the agent.

Each rule moves a ticket only out of the one column it names, so nothing moves backwards, a done
or won't-do ticket is never touched, a ticket a person or the agent moved on its own stays where
it is, and a retry finds the ticket already moved. A run a person cancels moves nothing.

While the run lasts, the board signal also carries the agent's latest step on the ticket (its
latest tool, or progress line), and a signal with no step when the run ends. A step alone changes
nothing in the list, so clients do not read it again. The signal is transient, so a card opened
mid-run shows its step from the next one.

## Tickets that keep moving

A ticket does not wait for someone to remember it. The backend sweeps the board every half minute
(the job reconciler, one leader at a time) and acts on what has no run:

- An agent works one ticket at a time. Assigning or creating a ticket wakes its owner only when
  the owner has no other ticket running; otherwise the sweep starts the owner's next To do ticket
  (urgent first, then oldest) as soon as the owner is free. A ticket that waits on blockers
  starts when they are done.
- A ticket in In progress with no run and no change for 30 minutes gets a follow-up run from its
  checkpoint comment. After the follow-up budget it moves to Blocked with a comment that says why.
  A ticket whose owner is waiting on a person is not stalled.
- A delivery in In review with no review run for 10 minutes is sent to its reviewer: the agent
  that created the ticket, or the Chief when the owner made the ticket for itself. The reviewer
  sets it to Done or sends it back with what is missing. After the review rounds the person is
  asked. A ticket a person created is reviewed by that person.
- A comment from anyone but the owner on a To do, In progress or Blocked ticket wakes the owner
  (and takes a Blocked ticket back to In progress), so a follow-up goes through the ticket.
  A chat request from another agent shows the owner its open tickets, so the work lands on the
  ticket and not only in chat.

One ticket is one deliverable. The items inside it (leads, companies, rows) go in its description
or checklist. `ticket_create` returns the open ticket when an agent files the same title again for
the same owner, and refuses once ten tickets that agent created for one owner are still in To do.

## What agents can do

`board_tickets`, `ticket_get`, `ticket_create`, `ticket_update` and `ticket_comment`. `ticket_update`
takes `fields` to set named data. Ticket text, comments and field values are data, not
instructions.

When an agent moves a ticket to In review or Done it is asked to say so in its chat and to send the
Chief a line with `message_bot`. The Chief itself, or a space with no Chief, is not asked.

## Notices

When an agent moves a card to In review or Done, the app shows a system notice with the agent, the
ticket and the column, if the window is hidden or not focused. A person's own move does not notify,
and nothing is shown while the app is in front, where the board and the Team screen already
update live. Clicking the notice opens Tasks.

The Team screen lists, under each agent, the tickets it has in progress, in review or blocked.
Each opens on the board.

## Security

A board belongs to one space and every read and write is scoped to it. The board signal carries
the ticket reference and title of a move to every member's connection in that space, the same people
who can already read the board.
