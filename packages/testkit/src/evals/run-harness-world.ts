import type { ConnectorTool } from "@corvo/adapter-kit";

type Args = Record<string, unknown>;

export type Email = { id: string; from: string; subject: string; snippet: string; unread: boolean };
export type CalendarEvent = { id: string; summary: string; start: string; end: string };

/**
 * A deterministic stand-in for everything a run touches: files, memory, the wiki, the web, mail,
 * the calendar, other agents and the approval gate. Tools answer from fixtures and record their
 * effects here, so a grader can read what actually changed instead of what the model said.
 */
export class HarnessWorld {
  files = new Map<string, string>();
  memory: string[] = [];
  userFacts: string[] = [];
  wiki = new Map<string, string>();
  web = new Map<string, string>();
  searches = new Map<string, Array<{ title: string; url: string; snippet: string }>>();
  emails: Email[] = [];
  calendar: CalendarEvent[] = [];
  releases: string[] = [];
  databaseRows: Array<Record<string, unknown>> = [];
  /** Effects that happened. */
  drafts: Args[] = [];
  sent: Args[] = [];
  createdEvents: Args[] = [];
  handoffs: Args[] = [];
  schedules: Args[] = [];
  /** Sends that stopped at the approval gate. */
  pendingApprovals: Array<{ tool: string; args: Args }> = [];
  /** Tools that fail the first time they are called, to exercise recovery. */
  failFirst = new Set<string>();
  /** Every call in order, including failed ones. */
  log: Array<{ tool: string; args: Args; ok: boolean }> = [];
  private seen = new Set<string>();

  async execute(name: string, args: Args): Promise<unknown> {
    const key = `${name}:${JSON.stringify(args)}`;
    if (this.failFirst.has(name) && !this.seen.has(key)) {
      this.seen.add(key);
      this.log.push({ tool: name, args, ok: false });
      return { error: "Request failed with status 404." };
    }
    this.seen.add(key);
    const result = this.handle(name, args);
    this.log.push({ tool: name, args, ok: result !== "paused" && !isError(result) });
    return result;
  }

  private handle(name: string, args: Args): unknown {
    switch (name) {
      case "web_search":
        return { results: this.searches.get(String(args.query).toLowerCase()) ?? [] };
      case "web_fetch": {
        const page = this.web.get(String(args.url));
        return page === undefined ? { error: "Request failed with status 404." } : { text: page };
      }
      case "list_files":
        return {
          files: [...this.files.keys()].filter((f) => f.startsWith(String(args.path ?? ""))),
        };
      case "read_file": {
        const content = this.files.get(String(args.path));
        return content === undefined ? { error: "No such file." } : { content };
      }
      case "write_file":
        this.files.set(String(args.path), String(args.content ?? ""));
        return { ok: true, path: args.path };
      case "recall_memory": {
        const words = String(args.query).toLowerCase().split(/\W+/).filter(Boolean);
        return {
          memories: this.memory.filter((m) => words.some((w) => m.toLowerCase().includes(w))),
        };
      }
      case "save_memory":
      case "remember":
        this.memory.push(String(args.content));
        return { ok: true };
      case "remember_about_user":
        this.userFacts.push(String(args.fact));
        return { ok: true };
      case "wiki_search": {
        const words = String(args.query).toLowerCase().split(/\W+/).filter(Boolean);
        return {
          pages: [...this.wiki.keys()].filter((t) =>
            words.some((w) => t.toLowerCase().includes(w)),
          ),
        };
      }
      case "wiki_read": {
        const page = this.wiki.get(String(args.title));
        return page === undefined ? { error: "No such page." } : { title: args.title, text: page };
      }
      case "message_user":
      case "say_now":
        return { ok: true };
      case "describe_database":
        return { tables: [{ name: "orders", columns: ["id", "status", "total_cents"] }] };
      case "query_database":
        return { rows: this.databaseRows };
      case "schedule_create":
        this.schedules.push(args);
        return { ok: true, id: `sched-${this.schedules.length}` };
      case "handoff_to_bot":
        this.handoffs.push(args);
        return { ok: true, note: "The receiving agent was started." };
      case "GITHUB_LIST_RELEASES":
        return { releases: this.releases.map((tag) => ({ tag })) };
      case "GMAIL_FETCH_EMAILS":
        return { messages: this.emails.filter((m) => m.unread) };
      case "GMAIL_CREATE_EMAIL_DRAFT":
        this.drafts.push(args);
        return { ok: true, draftId: `draft-${this.drafts.length}` };
      case "GMAIL_SEND_EMAIL":
        this.pendingApprovals.push({ tool: name, args });
        return "paused";
      case "GOOGLECALENDAR_EVENTS_LIST":
        return { items: this.calendar };
      case "GOOGLECALENDAR_CREATE_EVENT":
        this.createdEvents.push(args);
        return { ok: true };
      default:
        return { error: `Unknown tool ${name}` };
    }
  }
}

const isError = (value: unknown) =>
  typeof value === "object" && value !== null && "error" in (value as object);

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });

/** Connector tool definitions shaped like the ones a connected app contributes to a run. */
export const FIXTURE_CONNECTOR_TOOLS: Record<string, ConnectorTool> = {
  GITHUB_LIST_RELEASES: {
    name: "GITHUB_LIST_RELEASES",
    description: "List the releases of a GitHub repository, newest first.",
    inputSchema: obj(
      {
        owner: str("Repository owner"),
        repo: str("Repository name"),
        per_page: { type: "integer" },
      },
      ["owner", "repo"],
    ),
    readOnly: true,
  },
  GMAIL_FETCH_EMAILS: {
    name: "GMAIL_FETCH_EMAILS",
    description: "Fetch emails from the connected inbox using a Gmail search query.",
    inputSchema: obj(
      { query: str("Gmail search query, for example is:unread"), max_results: { type: "integer" } },
      [],
    ),
    readOnly: true,
  },
  GMAIL_CREATE_EMAIL_DRAFT: {
    name: "GMAIL_CREATE_EMAIL_DRAFT",
    description: "Create a draft email without sending it.",
    inputSchema: obj({ recipient_email: str(), subject: str(), body: str(), thread_id: str() }, [
      "recipient_email",
      "subject",
      "body",
    ]),
    readOnly: false,
  },
  GMAIL_SEND_EMAIL: {
    name: "GMAIL_SEND_EMAIL",
    description: "Send an email from the connected account. This reaches other people.",
    inputSchema: obj({ recipient_email: str(), subject: str(), body: str() }, [
      "recipient_email",
      "subject",
      "body",
    ]),
    readOnly: false,
  },
  GOOGLECALENDAR_EVENTS_LIST: {
    name: "GOOGLECALENDAR_EVENTS_LIST",
    description: "List calendar events between two ISO timestamps.",
    inputSchema: obj({ time_min: str(), time_max: str() }, ["time_min", "time_max"]),
    readOnly: true,
  },
  GOOGLECALENDAR_CREATE_EVENT: {
    name: "GOOGLECALENDAR_CREATE_EVENT",
    description: "Create a calendar event and invite attendees.",
    inputSchema: obj(
      {
        summary: str(),
        start_datetime: str(),
        end_datetime: str(),
        attendees: { type: "array", items: { type: "string" } },
      },
      ["summary", "start_datetime", "end_datetime"],
    ),
    readOnly: false,
  },
};
