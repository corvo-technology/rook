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

export type PreviewConversation = {
  id: string;
  /** A channel (with a hash and members) or a direct message. */
  kind: "channel" | "dm";
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
    open: string;
    faq: string;
    download: string;
    github: string;
  };
  faq: { heading: string; items: Array<{ question: string; answer: string }> };
  footer: {
    navLabel: string;
    languagesLabel: string;
    product: string;
    features: string;
    open: string;
    install: string;
    faq: string;
    company: string;
    about: string;
    support: string;
    privacy: string;
    terms: string;
  };
  /** The headline reads `line1`, the rook mascot, then `line2`; `lead` is the two lines under it. */
  hero: {
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
    /** The link to the full catalog. */
    all: string;
    categories: Record<StoreCategory, string>;
  };
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
    approvalTitle: string;
    approvalBody: string;
    approvalCall: string;
    approve: string;
    deny: string;
    approved: string;
    denied: string;
    agents: LaunchAgent[];
    conversations: PreviewConversation[];
    approvedReply: string[];
    deniedReply: string[];
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
  open: {
    heading: string;
    accent: string;
    copy: string;
    github: string;
    points: Array<{ title: string; body: string }>;
    license: string;
  };
  install: {
    heading: string;
    copy: string;
    download: string;
    alsoFor: string;
    macLinux: string;
    windows: string;
    copyLabel: string;
    copiedLabel: string;
    note: string;
  };
  cta: { heading: string; copy: string; download: string };
};
