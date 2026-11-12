// Fictional workspace for the README screenshots. Everything here is made up.
const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

export const SPACE_ID = "space-acme";
const COLORS = {
  mint: "#54c398",
  blue: "#75aef5",
  violet: "#b797ef",
  pink: "#e788b6",
  red: "#f48877",
  orange: "#e59651",
  lime: "#9bc43a",
};

const bot = (id, name, title, color, preview, extra = {}) => ({
  id,
  spaceId: SPACE_ID,
  name,
  title,
  description: title,
  instructions: "",
  color: COLORS[color],
  notifyOnFinish: true,
  pinned: false,
  sectionId: null,
  archivedAt: null,
  unread: false,
  parentBotId: null,
  memoryScope: null,
  threadId: `thread-${id}`,
  preview,
  status: "idle",
  runErrorId: null,
  computerMode: "private",
  updatedAt: iso(20),
  createdAt: iso(60 * 24 * 14),
  voiceId: null,
  autoSpeak: false,
  modelProvider: "anthropic",
  modelId: "claude-sonnet-5-5",
  thinkingLevel: null,
  teamChatAmbientEnabled: false,
  teamChatRules: "",
  fleetManagement: false,
  squadRouting: false,
  disabledBuiltinTools: [],
  webhookConfigured: false,
  spawnKey: null,
  ...extra,
});

export const BOTS = [
  bot("chief", "Chief", "Team lead", "mint", "Created 5 routines for the squads. Approve…", {
    spawnKey: "onboarding:first",
    squadRouting: true,
    fleetManagement: true,
  }),
  bot(
    "davi",
    "Davi",
    "Email agent",
    "pink",
    "2 need you today: the lease renewal and a customer about to leave.",
  ),
  bot("bento", "Bento", "Payments watcher", "blue", "Waiting for your yes on a refund.", {
    status: "waiting",
  }),
  bot(
    "cora",
    "Cora",
    "Project planner",
    "violet",
    "First delivery: card payments only, one currency.",
  ),
  bot("elza", "Elza", "Inventory manager", "red", "3 items run out in under 10 days."),
  bot("fabio", "Fabio", "Bug triage", "orange", "14 new errors, 3 causes."),
  bot("gaia", "Gaia", "Support agent", "lime", "Replied to 6 tickets."),
];

const member = (b) => ({ botId: b.id, name: b.name, color: b.color });
const byId = Object.fromEntries(BOTS.map((b) => [b.id, b]));

const group = (id, name, purpose, ids, preview, unread = false) => ({
  id,
  spaceId: SPACE_ID,
  name,
  purpose,
  pinned: false,
  sectionId: null,
  archivedAt: null,
  members: ids.map((i) => member(byId[i])),
  threadId: `thread-${id}`,
  preview,
  unread,
  updatedAt: iso(5),
  createdAt: iso(60 * 24 * 10),
});

export const GROUPS = [
  group(
    "support",
    "support",
    "Customers, billing questions and what to fix next",
    ["davi", "bento", "gaia"],
    "Waiting for your yes on a refund.",
    true,
  ),
  group(
    "releases",
    "releases",
    "Errors after each release and what to build next",
    ["fabio", "cora"],
    "Opened 3 issues in Linear.",
  ),
  group(
    "finance",
    "finance",
    "Invoices, payments and the monthly close",
    ["bento", "elza"],
    "3 unpaid invoices this week.",
  ),
];

const step = (label, count = 1) => ({ label, count });
const text = (t) => ({ kind: "text", text: t });

let seq = 0;
const msg = (threadId, role, blocks, minutesAgo, botId, runId) => ({
  id: `${threadId}-m${seq}`,
  threadId,
  seq: seq++,
  role,
  blocks,
  ...(botId ? { botId } : {}),
  ...(runId ? { runId } : {}),
  createdAt: iso(minutesAgo),
});

function supportThread() {
  seq = 0;
  const t = "thread-support";
  return [
    msg(t, "user", [text("A customer says she was charged twice. Can someone check?")], 9),
    msg(
      t,
      "bot",
      [
        {
          kind: "steps",
          steps: [step("Read inbox"), step("Found thread with Marta"), step("Asked Bento")],
          durationMs: 6000,
        },
        text(
          "Marta wrote on Monday: two charges of $48.00 on the same day. I have her customer ID.",
        ),
        text("@Bento, can you look at her invoices?"),
      ],
      8,
      "davi",
    ),
    msg(
      t,
      "bot",
      [
        {
          kind: "steps",
          steps: [
            step("Stripe · list_invoices"),
            step("Compared 2 invoices"),
            step("Asked for approval"),
          ],
          durationMs: 5000,
        },
        text(
          "Two invoices for the same plan on the same day. The second one is a duplicate, so I would refund it. I need your yes.",
        ),
        {
          kind: "ask",
          text: "Bento wants to use create_refund in Stripe",
          detail: "Refund the duplicate invoice ($48.00).",
          detailFormat: "text",
          approvalEffectId: "effect-refund",
          status: "pending",
          actions: [
            { id: "allow", label: "Approve" },
            { id: "deny", label: "Deny" },
          ],
        },
      ],
      7,
      "bento",
      "run-refund",
    ),
  ];
}

function releasesThread() {
  seq = 0;
  const t = "thread-releases";
  return [
    msg(t, "user", [text("What broke after yesterday's release?")], 12),
    msg(
      t,
      "bot",
      [
        {
          kind: "steps",
          steps: [
            step("Sentry · new errors"),
            step("Grouped 14 events into 3 issues"),
            step("Linear · created 3 issues"),
          ],
          durationMs: 7000,
        },
        text(
          "14 new errors, 3 causes. The checkout timeout is the one reaching customers: 9 of the 14.",
        ),
        text(
          "I opened all 3 in Linear with steps to reproduce. @Cora, can you plan the timeout fix?",
        ),
      ],
      11,
      "fabio",
    ),
    msg(
      t,
      "bot",
      [
        {
          kind: "steps",
          steps: [step("Linear · checkout timeout"), step("Drafted first delivery")],
          durationMs: 4000,
        },
        text(
          "First delivery: raise the timeout from 2 s to 10 s, with one retry. It depends on the payments client and one setting.",
        ),
        text("Next step: a test for the retry, then a review."),
      ],
      10,
      "cora",
    ),
  ];
}

function fabioThread() {
  seq = 0;
  const t = "thread-fabio";
  return [
    msg(t, "user", [text("Run the tests and push the checkout timeout fix.")], 6),
    msg(
      t,
      "bot",
      [
        {
          kind: "steps",
          steps: [step("Ran npm test"), step("Pushed fix/checkout-timeout")],
          durationMs: 38000,
        },
        text("All 52 tests pass. I pushed fix/checkout-timeout and linked it to the Linear issue."),
      ],
      5,
      "fabio",
    ),
  ];
}

export const THREADS = {
  "g:support": supportThread(),
  "g:releases": releasesThread(),
  "b:fabio": fabioThread(),
};

export const RUNS = {
  "g:support": {
    id: "run-refund",
    userId: "user-1",
    botId: "bento",
    threadId: "thread-support",
    taskId: "task-1",
    status: "waiting_input",
    trigger: "user",
    routineId: null,
    modelProvider: "anthropic",
    modelId: "claude-sonnet-5-5",
    error: null,
    startedAt: new Date(now - 7 * 60_000).toISOString(),
    completedAt: null,
    createdAt: new Date(now - 7 * 60_000).toISOString(),
  },
};

const routine = (id, botId, name, prompt, crons, nextMin, lastMin) => ({
  id,
  botId,
  name,
  prompt,
  crons,
  timezone: "America/New_York",
  active: true,
  notify: true,
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: null,
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  watch: null,
  watchState: null,
  lastRunAt: lastMin ? iso(lastMin) : null,
  nextRunAt: iso(-nextMin),
  createdAt: iso(60 * 24 * 9),
  editable: true,
});

export const ROUTINES = [
  routine(
    "r-day",
    "chief",
    "Day summary",
    "Summarize what is due and what is late.",
    ["30 7 * * *"],
    360,
    1080,
  ),
  routine(
    "r-pay",
    "bento",
    "Unpaid invoices",
    "List unpaid invoices and remind the customers.",
    ["0 9 * * 1"],
    60 * 30,
    60 * 24 * 6,
  ),
  routine(
    "r-week",
    "cora",
    "Weekly plan",
    "Plan next week from the open issues.",
    ["0 16 * * 5"],
    60 * 100,
    60 * 24 * 3,
  ),
  routine(
    "r-stock",
    "elza",
    "Stock check",
    "Compare stock with this month's sales.",
    ["0 8 * * *"],
    400,
    1000,
  ),
];

export function calendar() {
  const day = (offset, hour, min = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };
  const occ = (r, bot, offset, hour, min, state) => ({
    routineId: r.id,
    name: r.name,
    botId: bot.id,
    botName: bot.name,
    at: day(offset, hour, min),
    state,
    runId: state === "upcoming" ? null : `run-${r.id}-${offset}`,
  });
  const list = [];
  for (const [i, r] of ROUTINES.entries()) {
    const b = byId[r.botId];
    const h = [7, 9, 16, 8][i];
    const m = [30, 0, 0, 0][i];
    for (let o = -1; o <= 5; o++) {
      if (i === 1 && o % 7 !== 1 && o !== 1) continue;
      if (i === 2 && o !== 4) continue;
      list.push(occ(r, b, o, h, m, o < 0 ? "done" : "upcoming"));
    }
  }
  return { occurrences: list, truncated: false };
}

export function usageOverview() {
  const ids = [
    ["davi", 0.38],
    ["bento", 0.27],
    ["cora", 0.17],
    ["fabio", 0.11],
    ["elza", 0.07],
  ];
  const total = 4_820_000;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 864e5);
    const wave = 0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)) + (i % 7 === 0 ? -0.25 : 0);
    const tokens = Math.round((total / 30) * wave);
    days.push({
      date: d.toISOString().slice(0, 10),
      tokens,
      agents: Object.fromEntries(ids.map(([id, share]) => [id, Math.round(tokens * share)])),
    });
  }
  return {
    period: "month",
    from: days[0].date,
    to: days[29].date,
    tokens: days.reduce((n, d) => n + d.tokens, 0),
    previousTokens: 3_050_000,
    replies: 1284,
    costUsd: 38.42,
    agents: ids.map(([id, share]) => {
      const b = byId[id];
      return {
        id,
        name: b.name,
        color: b.color,
        tokens: Math.round(total * share),
        replies: Math.round(1284 * share),
        costUsd: Math.round(38.42 * share * 100) / 100,
        models: [
          { provider: "anthropic", model: "claude-sonnet-5-5", tokens: Math.round(total * share) },
        ],
      };
    }),
    days,
  };
}

export const SUBSCRIPTIONS = [
  {
    provider: "anthropic",
    readAt: iso(2),
    windows: [
      { key: "5h", usedPercent: 34, resetsAt: new Date(now + 2 * 3600e3).toISOString() },
      { key: "7d", usedPercent: 58, resetsAt: new Date(now + 3 * 864e5).toISOString() },
    ],
  },
];
