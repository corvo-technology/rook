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
