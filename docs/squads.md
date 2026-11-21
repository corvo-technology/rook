# Squads

A squad is a group chat with a short purpose. Rook reads the purposes and sends a request to the
squad that fits, so you can hand work to the team once instead of naming a group or a bot.

## Set a purpose

Open a group's settings and fill **Purpose**: one line, up to 300 characters, for example "Analyzes
competitors, reviews design and writes landing page copy". Clear the field to remove it. A purpose is
data Rook reads, not an instruction it follows; it is escaped and labelled untrusted like names.

## Let Rook create squads

Ask Rook for a team and it can create the group from bots you already have, adding Store agents
first when you say yes (the Store's agents bring their skills, which are shared by all your bots). It
writes a one-line purpose for the group. Every group it creates or changes shows an approval card that
lists the name, the members and the purpose, and nothing happens until you approve.

## Let Rook route work

A bot with **Route work to squads** on can hand a request to any of your groups in the same space, even
one it is not a member of. The switch is in the bot's **Advanced** settings. It is off for every bot,
and on for Rook an account is given. An existing Rook needs it turned on once.

Routing needs all of these at the same time:

- The bot's switch is on, read again on every call, so turning it off takes effect immediately.
- You started the run. Runs started by a webhook, a channel message or another bot cannot route.
- The group belongs to you in the same space, and is not archived.
- No helper is making the call, and no channel or webhook message has reached the run.

Approval modes and Allow/Block lists apply to everything the squad does afterwards, exactly as before.

When two squads fit about equally Rook asks you which one instead of guessing. Each handoff
carries a short reason, shown beside it in the group thread.

## The squad screen

Open a group chat and use **Squad** in the header. Each bot has a lane with its state, the last tools
it used and the work handed to it. A bar on top shows the bot that routed the work and why. The screen
follows live runs by polling the group thread every few seconds while a bot works.

Opening a lane opens that bot's own chat. The screen has web and desktop support; on mobile you can edit
a purpose and turn the switch on, and the lanes view is a follow-up.
