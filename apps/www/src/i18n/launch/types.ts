import type { MascotHue } from "../../mascot";

/** An agent as the page shows it: the name is the same in every language, the job is not. */
export type LaunchAgent = { name: string; role: string; hue: MascotHue };

export type PreviewStep = { verb: string; detail: string; took: string };

export type PreviewMessage =
  | { kind: "you"; text: string }
  | {
      kind: "agent";
      agent: string;
      time: string;
      steps?: { count: string; items: PreviewStep[] };
      text: string[];
      approval?: boolean;
    };

/** The action a conversation waits on, and how the agent answers each way. */
export type PreviewApproval = { body: string; call: string; approved: string[]; denied: string[] };

export type PreviewConversation = {
  id: string;
  /** A channel (with a hash and members) or a direct message. */
  kind: "channel" | "dm";
  /** The area this channel shows under on the page's tab row. */
  tab?: string;
  /** The bold line under the chat: who did what, and how long it took. */
  closing?: string;
  /** The muted line after it: how long it took before. */
  saved?: string;
  /** The systems the conversation used. */
  systems?: string[];
  approval?: PreviewApproval;
  name: string;
  purpose?: string;
  members: string[];
  messages: PreviewMessage[];
};

export type StoreCategory =
  | "marketing"
  | "operations"
  | "finance"
  | "knowledge"
  | "development"
  | "design"
  | "support"
  | "sales"
  | "people";

export type LaunchCopy = {
  meta: {
    title: string;
    description: string;
    ogImageAlt: string;
    ogTagline: string;
    availableLanguage: string;
    skipToContent: string;
  };
  nav: {
    home: string;
    primary: string;
    menu: string;
    demo: string;
    features: string;
    runs: string;
    faq: string;
    partners: string;
    waitlist: string;
  };
  /** `partnersLink` is the link under the question about reselling. */
  faq: { heading: string; partnersLink: string; items: Array<{ question: string; answer: string }> };
  footer: {
    navLabel: string;
    languagesLabel: string;
    resources: string;
    download: string;
    partners: string;
    docs: string;
    useCases: string;
    about: string;
    support: string;
    terms: string;
    privacy: string;
    legalLabel: string;
    socialLabel: string;
    tagline: string;
    /** Reads before the company name: "Rook is a product of". */
    producedBy: string;
    themeDark: string;
    themeLight: string;
  };
  /** The headline reads `line1`, the rook mascot, then `line2`; `lead` is the two lines under it. */
  hero: {
    pill: string;
    join: string;
    line1: string;
    line2: string;
    lead: [string, string];
    note: string;
  };
  /** What an agent is, in the product's own terms. */
  agent: {
    heading: string;
    accent: string;
    copy: string;
    /** What a rook's state is called: working, needs you, asleep, done. */
    states: { working: string; asking: string; sleeping: string; done: string };
    traits: Array<{ title: string; body: string }>;
  };
  /** Agents in a channel, working together. */
  team: { heading: string; accent: string; copy: string };
  /** The ready-made agents in the Store; names and jobs come from the product's own catalog. */
  store: {
    heading: string;
    accent: string;
    copy: string;
    categories: Record<StoreCategory, string>;
    /** Not in the product's catalog yet, so the page names its agents itself. */
    health: { label: string; agents: [string, string, string] };
  };
  /** The one label of the band of live avatars; the band has no visible text. */
  agentGrid: { label: string };
  preview: {
    window: string;
    rail: { agents: string; routines: string; workflows: string; more: string; store: string };
    workspace: string;
    chief: string;
    chiefTitle: string;
    chiefLine: string;
    channels: string;
    directMessages: string;
    agentsCount: string;
    composer: string;
    composerHint: string;
    stepsLabel: string;
    working: string;
    waiting: string;
    approve: string;
    deny: string;
    approved: string;
    denied: string;
    agents: LaunchAgent[];
    conversations: PreviewConversation[];
  };
  works: {
    heading: string;
    accent: string;
    /** In order: routines, computer, models, usage, apps, reach. */
    cards: Array<{ title: string; body: string }>;
    routines: Array<{ when: string; what: string }>;
    computer: { title: string; lines: string[] };
    models: { primary: string; window5h: string; weekly: string; resets: string; local: string };
    usage: { title: string; agents: Array<{ name: string; hue: MascotHue; share: number }> };
    reach: string[];
  };
  /** What a company controls; the points read like the section that follows. */
  business: { heading: string; points: Array<{ title: string; body: string }> };
  /** Where it runs: our cloud, your server, your computer. */
  runs: {
    heading: string;
    accent: string;
    copy: string;
    points: Array<{ title: string; body: string }>;
  };
  /** The closed beta: a card with a form. `{email}` and `{company}` fill the success text. */
  waitlist: {
    badge: string;
    title: string;
    copy: string;
    email: string;
    company: string;
    task: string;
    emailError: string;
    companyError: string;
    successTitle: string;
    success: string;
    error: string;
  };
  install: {
    heading: string;
    local: { title: string; copy: string };
    download: string;
    alsoFor: string;
    macLinux: string;
    windows: string;
    formats: { label: string; mac: string; macIntel: string; linux: string; windows: string; arm64: string };
    copyLabel: string;
    copiedLabel: string;
    note: string;
    migrate: string;
  };
  /** `bubbles` are the two things the rook says from the bottom edge of the page, in order. */
  cta: { heading: string; copy: string; download: string; waitlist: string; bubbles: [string, string] };
};
