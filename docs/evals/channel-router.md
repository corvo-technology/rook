# Channel router and avatar piece evals

Both are natural-language judgments with a structured answer, so they follow the two layers of
[squad routing](./squad-routing.md). Neither runs in the default test suite.

## Channel router

The router (`packages/core/src/channel-router.ts`, `apps/api/src/channel-router.ts`) scores the
members of a channel for a message that names nobody; the code turns the scores into a pick.

**Observable effect, deterministic.** `gradeChannelRouter` in
`packages/testkit/src/evals/channel-router.ts` reads the model's raw answer with the product's own
`parseRouterScores` and `pickRoutedBots`, so the thresholds are the real ones. A case expects
nobody, exactly one of a set of acceptable members, or several (a message to everyone). An answer
that is not a router score is `unqualified`, never a pass.

**The reason, judged.** Only for cases marked `judged` (more than one defensible answer, a message to
everyone, or a message that tries to steer the router) and only after the pick is right, an opt-in,
provider-neutral judge applies the rubric `channel-router-v1` to the roles, the messages, the pick
and the reason. A judge that errors leaves the case `unqualified`.

`CHANNEL_ROUTER_CASES` holds 20 reviewed cases across four channels: a clear specialist, nobody
(greeting, thanks, chatter between people, an acknowledgement), everyone (English and Portuguese), a
vague request two roles fit, follow-ups that lean on the recent messages, a role found only in the
description, the channel purpose deciding, and a message that tells the router to ignore its
instructions. The continuity and waiting-question shortcuts are code, not model, and are covered by
unit tests; these cases measure the model call only. Bump `CHANNEL_ROUTER_RUBRIC_VERSION` whenever
the rubric or the reviewed examples change.

## Avatar piece

`chooseBotPiece` (`packages/adapters/src/avatar-design.ts`) asks a model for the chess piece that
suits an agent's role. The answer is one structured value, so there is no prose to judge:
`gradeAvatarPiece` checks it against the set of pieces a reasonable person would accept for the
role (`AVATAR_PIECE_CASES`, 15 cases, every piece expected at least once, one description that
tries to steer the pick). An answer that names no known piece is `unqualified`. Bump
`AVATAR_PIECE_FIXTURE_VERSION` when the cases change.

## Date reminder

`schedule_create`'s description tells an agent to offer, once and with `ask_user`, a reminder for a
dated one-off commitment (interview, appointment, deadline, trip) and to stay quiet when the date is
unknown, a reminder was already asked for or declined, or the event is past or only mentioned. The
suite sends that shipped description with a reviewed conversation and asks for a structured decision
(`offer`, question, options). `DATE_REMINDER_CASES` holds 12 conversations in English and Portuguese:
six that should get an offer and six that should not. Offer or silence is graded by observable
effect; with a judge connection, offers are judged against the rubric `date-reminder-v1` (times fit
the event, nothing created without a yes). An unreadable answer or a judge error is `unqualified`.
Bump `DATE_REMINDER_RUBRIC_VERSION` when the rubric or the cases change.

```sh
pnpm test:evals --suite date-reminder --live --connection <file> --pricing <file>
```

## Running them against a live model

```sh
pnpm test:evals --suite channel-router --live --connection <file> --pricing <file>
pnpm test:evals --suite avatar-piece --live --connection <file> --pricing <file>
```

The product's own instructions and prompt are sent once per trial to the model in the connection file
(models/connect JSON), with no tools. `--list` prints the case ids; `--case`, `--trials` and
`--spend-cap-usd` narrow or bound the run. Without `--live` nothing is called and the report is
written with status `not-run`. For the router, add `--judge-connection <file> --judge-pricing <file>`
to judge the reasons. The report carries `subjectCostUsd` and `judgeCostUsd` as separate fields.

Nothing here has been run against a live model, so no accuracy is claimed.

## Live avatar budget

A moving face is an animation loop, so the transcript only animates the latest
`LIVE_FACE_MESSAGES` messages. `transcript-live-faces.test.tsx` renders a long, busy channel with
several agents and asserts the number of live faces stays within that cap and does not grow with the
history. It is an ordinary offline unit test.
