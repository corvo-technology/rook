import type { ModelEmulatorResponse } from "../model-emulator.js";
import type { Check, HarnessTask, Outcome } from "./run-harness.js";
import { FIXTURE_CONNECTOR_TOOLS, HarnessWorld } from "./run-harness-world.js";

type Reply = ModelEmulatorResponse;
const say = (text: string): Reply => ({ type: "text", text });
const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
  assistantText?: string,
): Reply => ({
  type: "tool",
  id,
  name,
  arguments: args,
  ...(assistantText ? { assistantText } : {}),
});
const parallel = (
  ...calls: Array<[id: string, name: string, args: Record<string, unknown>]>
): Reply => ({
  type: "tools",
  calls: calls.map(([id, name, args]) => ({ id, name, arguments: args })),
});

/**
 * A model that has nothing to report writes nothing. A run that may end silent accepts that
 * empty turn after tool work, with no automated continuation prompt.
 */
const stayQuiet: Reply[] = [say("")];

const check = (id: string, pass: boolean): Check => ({ id, pass });
const called = (o: Outcome, name: string) => o.calls.filter((c) => c.name === name);
const mentions = (text: string, ...needles: string[]) =>
  needles.every((n) => text.toLowerCase().includes(n.toLowerCase()));
const silent = (o: Outcome) => o.text.trim() === "" && o.postedLines.length === 0;
const noWrites = (o: Outcome) =>
  o.world.sent.length === 0 &&
  o.world.drafts.length === 0 &&
  o.world.createdEvents.length === 0 &&
  o.world.handoffs.length === 0;
const finished = (o: Outcome) => check("run-finished", o.ended === "done");

function world(setup: (w: HarnessWorld) => void = () => {}) {
  return () => {
    const w = new HarnessWorld();
    setup(w);
    return w;
  };
}

const longHistory = Array.from({ length: 24 }, (_, i) => ({
  id: `h${i}`,
  role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
  content:
    i === 3
      ? "Two options for the plan: the monthly plan at 29 and the annual plan at 290, which saves two months."
      : i % 2 === 0
        ? `Question ${i / 2}: what is the status of the onboarding checklist item number ${i}?`
        : `Item ${i - 1} on the onboarding checklist is done, and the next review is next week.`,
}));

const suppliers = Array.from({ length: 12 }, (_, i) => `sup-${String(i + 1).padStart(2, "0")}`);
const supplierUrl = (id: string) => `https://example.com/suppliers/${id}`;
const pageOf = (kb: number) =>
  `Acme Widget 3 handbook. ${"The widget connects to the hub, syncs every hour and keeps a local copy of its settings. ".repeat(Math.ceil((kb * 1024) / 95))}`;

/**
 * The scripted tasks. Each stands for a real product moment, scripted as the model turns a good
 * agent would take, so the offline run measures the harness around the model: which tools are sent
 * on every call, what the history and tool results cost, and what the run leaves behind.
 */
export const HARNESS_TASKS: HarnessTask[] = [
  {
    id: "quick-question",
    covers: "A one-line factual question answered straight away",
    trigger: "user",
    tier: "fast",
    prompt: "What is 15% of 240?",
    world: world(),
    script: [{ steps: [say("15% of 240 is 36.")] }],
    grade: (o) => [
      finished(o),
      check("no-tools", o.calls.length === 0),
      check("answer", mentions(o.text, "36")),
    ],
  },
  {
    id: "greeting",
    covers: "Small talk that needs no tools",
    trigger: "user",
    tier: "fast",
    prompt: "Oi, bom dia!",
    world: world(),
    script: [{ steps: [say("Bom dia! Em que posso ajudar hoje?")] }],
    grade: (o) => [
      finished(o),
      check("no-tools", o.calls.length === 0),
      check("short-reply", o.text.length > 0 && o.text.length <= 200),
    ],
    prose: {
      id: "greets-back",
      criterion: "Greets the user back in Portuguese and offers help without inventing a task.",
    },
  },
  {
    id: "ticket-continuation-after-wait",
    covers:
      "A ticket continuation whose second model call comes 20 minutes after the first, past the short cache",
    trigger: "tickets",
    tier: "main",
    prompt: "Continue the ticket: check the release page and report the version.",
    cacheReturn: "later",
    waitBeforeCallMs: 20 * 60_000,
    world: world((w) => {
      w.searches.set("acme widget 3 launch date", [
        {
          title: "Acme Widget 3 launch",
          url: "https://example.com/widget-3",
          snippet: "Launch details",
        },
      ]);
    }),
    script: [
      {
        steps: [
          call("t1", "web_search", { query: "Acme Widget 3 launch date" }),
          say("The release page lists Acme Widget 3."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("searched", called(o, "web_search").length === 1),
      check("reported", mentions(o.text, "widget")),
    ],
  },
  {
    id: "web-lookup",
    covers: "A web lookup: search, open the page, answer from it",
    trigger: "user",
    tier: "main",
    prompt: "When does the Acme Widget 3 launch?",
    world: world((w) => {
      w.searches.set("acme widget 3 launch date", [
        {
          title: "Acme Widget 3 launch",
          url: "https://example.com/widget-3",
          snippet: "Launch details",
        },
      ]);
      w.web.set(
        "https://example.com/widget-3",
        "Acme Widget 3 launches on 12 March 2027 in all regions.",
      );
    }),
    script: [
      {
        steps: [
          call("w1", "web_search", { query: "Acme Widget 3 launch date" }),
          call("w2", "web_fetch", { url: "https://example.com/widget-3" }),
          say("The Acme Widget 3 launches on 12 March 2027."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "searched-then-opened",
        called(o, "web_search").length === 1 && called(o, "web_fetch").length === 1,
      ),
      check("answer", mentions(o.text, "2027")),
    ],
    prose: {
      id: "states-date",
      criterion: "States the launch date the fetched page gives, 12 March 2027.",
    },
  },
  {
    id: "multi-step-report",
    covers: "A task needing four tools: list, read twice, write",
    trigger: "user",
    tier: "main",
    prompt:
      "Add up the Q1 and Q2 sales in the reports folder and save the total in reports/summary.md.",
    world: world((w) => {
      w.files.set("reports/q1.csv", "region,total\nnorth,1000\nsouth,800\n");
      w.files.set("reports/q2.csv", "region,total\nnorth,1500\nsouth,1000\n");
    }),
    script: [
      {
        steps: [
          call("m1", "list_files", { path: "reports" }),
          parallel(
            ["m2", "read_file", { path: "reports/q1.csv" }],
            ["m3", "read_file", { path: "reports/q2.csv" }],
          ),
          call("m4", "write_file", {
            path: "reports/summary.md",
            content: "Total sales Q1+Q2: 4300\n",
          }),
          say("Saved the total, 4300, in reports/summary.md."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("three-distinct-tools", new Set(o.calls.map((c) => c.name)).size >= 3),
      check("summary-written", o.world.files.get("reports/summary.md")?.includes("4300") === true),
    ],
  },
  {
    id: "long-batch-checkpoint",
    covers: "Collect twelve items in batches of four with a checkpoint after each",
    trigger: "user",
    tier: "main",
    prompt:
      "Collect the profile page of all 12 suppliers (sup-01 to sup-12), saving a checkpoint after every batch of 4 and the final list in batch/suppliers.txt.",
    world: world((w) => {
      for (const id of suppliers)
        w.web.set(
          supplierUrl(id),
          `Supplier ${id}: active, net 30 terms, contact desk ${id}@example.com.`,
        );
    }),
    script: [
      {
        steps: [
          ...[0, 1, 2].flatMap((batch) => {
            const ids = suppliers.slice(batch * 4, batch * 4 + 4);
            return [
              parallel(
                ...ids.map((id): [string, string, Record<string, unknown>] => [
                  `b-${id}`,
                  "web_fetch",
                  { url: supplierUrl(id) },
                ]),
              ),
              call(`c${batch}`, "write_file", {
                path: "batch/checkpoint.json",
                content: JSON.stringify({ done: suppliers.slice(0, batch * 4 + 4) }),
              }),
            ];
          }),
          call("final", "write_file", {
            path: "batch/suppliers.txt",
            content: suppliers.join("\n"),
          }),
          say("Collected all 12 suppliers in 3 batches and saved the list."),
        ],
      },
    ],
    grade: (o) => {
      const checkpoints = o.calls.filter(
        (c) => c.name === "write_file" && c.args.path === "batch/checkpoint.json",
      );
      const fetched = new Set(called(o, "web_fetch").map((c) => c.args.url));
      return [
        finished(o),
        check("twelve-fetched", fetched.size === 12),
        check("three-checkpoints", checkpoints.length === 3),
        check(
          "checkpoint-complete",
          (JSON.parse(o.world.files.get("batch/checkpoint.json") ?? "{}").done ?? []).length === 12,
        ),
        check(
          "list-saved",
          (o.world.files.get("batch/suppliers.txt") ?? "").split("\n").length === 12,
        ),
      ];
    },
  },
  {
    id: "routine-tick-silent",
    covers: "A scheduled check with nothing new must end without a word",
    trigger: "routine",
    tier: "fast",
    allowSilentEmpty: true,
    prompt:
      "Check releases of example/widget on GitHub. I was told about v2.1.0 and everything older. Tell me only about a newer release; if there is none, stay silent.",
    connectors: [FIXTURE_CONNECTOR_TOOLS.GITHUB_LIST_RELEASES!],
    world: world((w) => {
      w.releases = ["v2.1.0", "v2.0.0"];
    }),
    script: [
      {
        steps: [
          call("r1", "GITHUB_LIST_RELEASES", { owner: "example", repo: "widget" }),
          ...stayQuiet,
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("checked-the-source", called(o, "GITHUB_LIST_RELEASES").length === 1),
      check("silent", silent(o)),
      check("no-effects", noWrites(o) && o.world.memory.length === 0),
    ],
  },
  {
    id: "routine-tick-change",
    covers: "A scheduled check that finds a real change reports it and remembers it",
    trigger: "routine",
    tier: "fast",
    allowSilentEmpty: true,
    prompt:
      "Check releases of example/widget on GitHub. I was told about v2.1.0 and everything older. Tell me only about a newer release and remember which ones you reported.",
    connectors: [FIXTURE_CONNECTOR_TOOLS.GITHUB_LIST_RELEASES!],
    world: world((w) => {
      w.releases = ["v2.2.0", "v2.1.0", "v2.0.0"];
    }),
    script: [
      {
        steps: [
          call("r1", "GITHUB_LIST_RELEASES", { owner: "example", repo: "widget" }),
          call("r2", "save_memory", { content: "Reported release v2.2.0 to the user." }),
          say("New release v2.2.0 of example/widget is out."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("reported-version", mentions(o.text, "v2.2.0")),
      check(
        "remembered",
        o.world.memory.some((m) => m.includes("v2.2.0")),
      ),
      check("did-not-repeat-old", !mentions(o.text, "v2.1.0")),
    ],
    prose: {
      id: "reports-release",
      criterion:
        "Tells the user a new release, v2.2.0, is available, without repeating older ones.",
    },
  },
  {
    id: "handoff-to-agent",
    covers: "Pass the next stage to another agent through a deferred tool",
    trigger: "user",
    tier: "main",
    prompt: "The copy is final. Hand the banner design to the Designer agent.",
    world: world(),
    script: [
      {
        steps: [
          call("h1", "find_tool", { query: "hand off to another agent" }),
          call("h2", "use_tool", {
            name: "handoff_to_bot",
            arguments: {
              bot_id: "bot-designer",
              message: "The copy is final. Design the banner from it.",
              reason: "The next stage is visual design.",
            },
          }),
          say("Handed the banner design to the Designer."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "found-then-used",
        called(o, "find_tool").length === 1 && called(o, "handoff_to_bot").length === 1,
      ),
      check("via-use-tool", called(o, "handoff_to_bot")[0]?.viaUseTool === true),
      check("right-target", o.world.handoffs[0]?.bot_id === "bot-designer"),
    ],
  },
  {
    id: "approval-gated-send",
    covers: "An outward action stops at the approval gate and does not happen",
    trigger: "user",
    tier: "main",
    prompt: "Email ana@example.com that the invoice is paid.",
    connectors: [FIXTURE_CONNECTOR_TOOLS.GMAIL_SEND_EMAIL!],
    world: world(),
    script: [
      {
        steps: [
          call("a1", "GMAIL_SEND_EMAIL", {
            recipient_email: "ana@example.com",
            subject: "Invoice paid",
            body: "The invoice is paid. Thank you.",
          }),
        ],
      },
    ],
    grade: (o) => [
      check("paused-for-approval", o.ended === "paused"),
      check("one-pending-send", o.world.pendingApprovals.length === 1),
      check("nothing-sent", o.world.sent.length === 0),
      check("one-model-call", o.modelCalls === 1),
    ],
  },
  {
    id: "email-triage",
    covers: "Triage the unread inbox, draft replies to the urgent ones and send nothing",
    trigger: "user",
    tier: "main",
    prompt: "Triage my unread email. Draft a reply to anything urgent, but do not send anything.",
    connectors: [
      FIXTURE_CONNECTOR_TOOLS.GMAIL_FETCH_EMAILS!,
      FIXTURE_CONNECTOR_TOOLS.GMAIL_CREATE_EMAIL_DRAFT!,
    ],
    world: world((w) => {
      w.emails = [
        {
          id: "e1",
          from: "boss@example.com",
          subject: "URGENT: contract by 5pm",
          snippet: "Please send the signed contract today.",
          unread: true,
        },
        {
          id: "e2",
          from: "billing@example.com",
          subject: "Payment failed, urgent",
          snippet: "Your card was declined; fix it today.",
          unread: true,
        },
        {
          id: "e3",
          from: "news@example.com",
          subject: "Weekly digest",
          snippet: "Ten links you may like.",
          unread: true,
        },
        {
          id: "e4",
          from: "shop@example.com",
          subject: "Your receipt",
          snippet: "Thanks for your order.",
          unread: true,
        },
        {
          id: "e5",
          from: "team@example.com",
          subject: "Lunch on Friday?",
          snippet: "Anyone up for lunch?",
          unread: true,
        },
      ];
    }),
    script: [
      {
        steps: [
          call("t1", "GMAIL_FETCH_EMAILS", { query: "is:unread", max_results: 10 }),
          parallel(
            [
              "t2",
              "GMAIL_CREATE_EMAIL_DRAFT",
              {
                recipient_email: "boss@example.com",
                subject: "Re: URGENT: contract by 5pm",
                body: "Sending the signed contract before 5pm.",
              },
            ],
            [
              "t3",
              "GMAIL_CREATE_EMAIL_DRAFT",
              {
                recipient_email: "billing@example.com",
                subject: "Re: Payment failed, urgent",
                body: "I will update the card today.",
              },
            ],
          ),
          say(
            "5 unread. Two are urgent, from the boss and billing; I drafted replies to both. The other three can wait.",
          ),
        ],
      },
    ],
    grade: (o) => {
      const to = o.world.drafts.map((d) => d.recipient_email).sort();
      return [
        finished(o),
        check("drafted-the-urgent-two", to.join() === "billing@example.com,boss@example.com"),
        check("sent-nothing", o.world.sent.length === 0 && o.world.pendingApprovals.length === 0),
        check("summary-counts", mentions(o.text, "5 unread")),
      ];
    },
  },
  {
    id: "calendar-conflict",
    covers: "Notice a conflict and ask instead of double-booking",
    trigger: "user",
    tier: "main",
    prompt: "Book a call with Ana on 2027-03-11 at 15:00 for an hour.",
    connectors: [
      FIXTURE_CONNECTOR_TOOLS.GOOGLECALENDAR_EVENTS_LIST!,
      FIXTURE_CONNECTOR_TOOLS.GOOGLECALENDAR_CREATE_EVENT!,
    ],
    world: world((w) => {
      w.calendar = [
        {
          id: "c1",
          summary: "Team sync",
          start: "2027-03-11T15:00:00",
          end: "2027-03-11T16:00:00",
        },
      ];
    }),
    script: [
      {
        steps: [
          call("k1", "GOOGLECALENDAR_EVENTS_LIST", {
            time_min: "2027-03-11T00:00:00",
            time_max: "2027-03-11T23:59:59",
          }),
          call("k2", "ask_user", {
            question: "15:00 on 11 March clashes with Team sync. Which slot?",
            options: ["16:00 the same day", "15:00 on 12 March", "Keep 15:00 anyway"],
          }),
        ],
      },
    ],
    grade: (o) => [
      check("checked-calendar", called(o, "GOOGLECALENDAR_EVENTS_LIST").length === 1),
      check("did-not-book", o.world.createdEvents.length === 0),
      check("asked-once-with-options", o.asks.length === 1 && o.asks[0]!.options.length >= 2),
    ],
  },
  {
    id: "memory-recall",
    covers: "Answer from what the agent remembers about the user",
    trigger: "user",
    tier: "fast",
    prompt: "Which airline do I prefer?",
    world: world((w) => {
      w.memory = ["Preferred airline: Aeroazul, window seat.", "Dentist on Tuesdays."];
    }),
    script: [
      {
        steps: [
          call("q1", "recall_memory", { query: "preferred airline" }),
          say("You prefer Aeroazul, with a window seat."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("recalled", called(o, "recall_memory").length === 1),
      check("answer", mentions(o.text, "Aeroazul")),
    ],
  },
  {
    id: "wiki-lookup",
    covers: "Find and read a wiki page, then answer from it",
    trigger: "user",
    tier: "main",
    prompt: "What is our refund policy?",
    world: world((w) => {
      w.wiki.set(
        "Refund policy",
        "Refunds are available within 14 days of purchase for unused licenses.",
      );
      w.wiki.set("Holiday calendar", "Offices close on the last Friday of December.");
    }),
    script: [
      {
        steps: [
          call("i1", "wiki_search", { query: "refund policy" }),
          call("i2", "wiki_read", { title: "Refund policy" }),
          say("Refunds are available within 14 days of purchase for unused licenses."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "searched-then-read",
        called(o, "wiki_search").length === 1 && called(o, "wiki_read").length === 1,
      ),
      check("answer", mentions(o.text, "14 days")),
    ],
  },
  {
    id: "ambiguous-request",
    covers: "An ambiguous request gets one question and no action",
    trigger: "user",
    tier: "fast",
    prompt: "Send it to him.",
    history: [
      { id: "a1", role: "user", content: "I finished the budget and the logo draft today." },
      {
        id: "a2",
        role: "assistant",
        content: "Nice. Carlos asked about the budget and Rafael about the logo.",
      },
    ],
    connectors: [FIXTURE_CONNECTOR_TOOLS.GMAIL_SEND_EMAIL!],
    world: world(),
    script: [
      { steps: [say("Which one, and to whom: the budget to Carlos or the logo to Rafael?")] },
    ],
    grade: (o) => [
      finished(o),
      check("no-tools", o.calls.length === 0),
      check("one-question", (o.text.match(/\?/g) ?? []).length === 1),
      check("nothing-sent", o.world.sent.length === 0 && o.world.pendingApprovals.length === 0),
    ],
    prose: {
      id: "one-specific-question",
      criterion:
        "Asks exactly one specific question to resolve what to send and to whom, and does not act.",
    },
  },
  {
    id: "needs-stronger-model",
    covers: "A hard planning task is moved up a tier and finished there",
    trigger: "user",
    tier: "main",
    prompt:
      "Plan a zero-downtime migration of the orders table that three services read and write, with the ordered steps and the rollback for each.",
    world: world(),
    script: [
      {
        tier: "main",
        steps: [
          call("s1", "request_stronger_model", {
            reason:
              "Ordering a zero-downtime migration across three services needs careful multi-step reasoning.",
          }),
        ],
      },
      {
        tier: "strong",
        steps: [
          say(
            "1. Add the new columns as nullable; rollback: drop them.\n2. Deploy services that write both old and new columns; rollback: redeploy the previous build.\n3. Backfill existing rows in batches; rollback: stop the job.\n4. Switch reads to the new columns one service at a time; rollback: switch back.\n5. Stop writing the old columns; rollback: re-enable dual writes.\n6. Drop the old columns in a later deploy; no rollback after this point.",
          ),
        ],
      },
    ],
    grade: (o) => [
      check("moved-up-once", o.legTiers.join() === "main,strong"),
      check("asked-for-stronger-model", called(o, "request_stronger_model").length === 1),
      check("ordered-plan", (o.text.match(/^\d+\./gm) ?? []).length >= 4),
    ],
  },
  {
    id: "long-history-followup",
    covers: "A short follow-up on a long thread, where cached history should be reused",
    trigger: "user",
    tier: "fast",
    prompt: "And what was the second option again?",
    history: longHistory,
    world: world(),
    script: [{ steps: [say("The second option was the annual plan at 290.")] }],
    grade: (o) => [
      finished(o),
      check("no-tools", o.calls.length === 0),
      check("answer", mentions(o.text, "annual")),
    ],
  },
  {
    id: "large-tool-result",
    covers: "A web page far larger than the question needs",
    trigger: "user",
    tier: "main",
    prompt: "Open https://example.com/handbook and tell me how often the widget syncs.",
    world: world((w) => {
      w.web.set("https://example.com/handbook", pageOf(30));
    }),
    script: [
      {
        steps: [
          call("l1", "web_fetch", { url: "https://example.com/handbook" }),
          say("The widget syncs every hour."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("fetched-once", called(o, "web_fetch").length === 1),
      check("answer", mentions(o.text, "every hour")),
    ],
  },
  {
    id: "remember-preference",
    covers: "Save a standing preference about the user",
    trigger: "user",
    tier: "fast",
    prompt: "From now on, answer me in short bullet points.",
    world: world(),
    script: [
      {
        steps: [
          call("p1", "remember_about_user", { fact: "Prefers short bullet-point answers." }),
          say("Got it, short bullets from now on."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "saved-fact",
        o.world.userFacts.length === 1 && mentions(o.world.userFacts[0]!, "bullet"),
      ),
    ],
  },
  {
    id: "schedule-routine",
    covers: "Turn a standing request into a schedule",
    trigger: "user",
    tier: "main",
    prompt: "Every weekday at 8am, summarize my new email.",
    world: world(),
    script: [
      {
        steps: [
          call("d0", "find_tool", { query: "schedule a recurring task" }),
          call("d1", "use_tool", {
            name: "schedule_create",
            arguments: {
              name: "Weekday email summary",
              prompt: "Summarize my new email.",
              cron: "0 8 * * 1-5",
              timezone: "America/Sao_Paulo",
            },
          }),
          say("Scheduled: weekdays at 8:00."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check("one-schedule", o.world.schedules.length === 1),
      check("weekday-cron", o.world.schedules[0]?.cron === "0 8 * * 1-5"),
    ],
  },
  {
    id: "tool-error-recovery",
    covers: "A tool fails once; the agent recovers with another route",
    trigger: "user",
    tier: "main",
    prompt: "What does the Acme Widget 3 pricing page say about the free plan?",
    world: world((w) => {
      w.failFirst.add("web_fetch");
      w.searches.set("acme widget 3 pricing free plan", [
        { title: "Pricing", url: "https://example.com/pricing", snippet: "Plans" },
      ]);
      w.web.set(
        "https://example.com/pricing",
        "The free plan includes one hub and 100 events a day.",
      );
    }),
    script: [
      {
        steps: [
          call("x1", "web_fetch", { url: "https://example.com/pricing" }),
          call("x2", "web_search", { query: "Acme Widget 3 pricing free plan" }),
          call("x3", "web_fetch", { url: "https://example.com/pricing" }),
          say("The free plan includes one hub and 100 events a day."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "failed-once-then-worked",
        o.world.log
          .filter((l) => l.tool === "web_fetch")
          .map((l) => l.ok)
          .join() === "false,true",
      ),
      check("within-four-calls", o.calls.length <= 4),
      check("answer", mentions(o.text, "100 events")),
    ],
  },
  {
    id: "database-question",
    covers: "Inspect a granted database and answer with one query",
    trigger: "user",
    tier: "main",
    prompt: "How many paid orders do we have?",
    selection: { databasesGranted: true },
    world: world((w) => {
      w.databaseRows = [{ paid_orders: 42 }];
    }),
    script: [
      {
        steps: [
          call("y0", "find_tool", { query: "query a database" }),
          call("y1", "use_tool", { name: "describe_database", arguments: {} }),
          call("y2", "use_tool", {
            name: "query_database",
            arguments: {
              sql: "select count(*) as paid_orders from orders where status = 'paid'",
            },
          }),
          say("There are 42 paid orders."),
        ],
      },
    ],
    grade: (o) => [
      finished(o),
      check(
        "read-only-query",
        called(o, "query_database").length === 1 &&
          called(o, "query_database").every((c) => /^\s*select/i.test(String(c.args.sql))),
      ),
      check("answer", mentions(o.text, "42")),
    ],
  },
];
