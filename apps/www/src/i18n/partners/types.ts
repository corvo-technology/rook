type Item = { title: string; body: string };
type Side = { title: string; items: string[] };

export type PartnersCopy = {
  /** Path of the page in this language, with no trailing slash. */
  path: string;
  /** The link to this page in the nav and the footer. */
  link: string;
  meta: { title: string; description: string };
  /** The page's own bar: where each link goes and the button. */
  nav: { how: string; earn: string; platform: string; faq: string; cta: string };
  hero: { pill: string; title: string; lead: string; cta: string; scarcity: string };
  /** The partner's console, with made-up data. */
  preview: {
    caption: string;
    company: string;
    console: string;
    menu: [string, string, string, string, string, string];
    greeting: string;
    month: string;
    add: string;
    metrics: [string, string, string, string];
    chart: string;
    queue: string;
    items: Array<{ text: string; action: string }>;
  };
  pain: { heading: string; paragraphs: [string, string] };
  how: { heading: string; steps: [Item, Item, Item, Item, Item] };
  earn: { heading: string; /** Tag on the card that is not available yet. */ soon: string; cards: [Item, Item, Item] };
  billing: { heading: string; lead: string; items: [Item, Item, Item, Item] };
  central: { heading: string; lead: string; items: [Item, Item, Item, Item, Item, Item] };
  benefits: { heading: string; items: Item[] };
  split: { heading: string; lead: string; you: Side; us: Side };
  platform: { heading: string; lead: string; items: Item[] };
  who: { heading: string; items: string[] };
  cohort: { heading: string; lead: string; perks: string[] };
  faq: { heading: string; items: Array<{ question: string; answer: string }> };
  cta: { heading: string; button: string };
  form: {
    title: string;
    hint: string;
    /** `{n}` and `{total}` fill in the step. */
    progress: string;
    next: string;
    back: string;
    name: string;
    email: string;
    whatsapp: string;
    company: string;
    website: string;
    type: string;
    types: { embedded: string; white_label: string; unsure: string };
    customers: string;
    customerRanges: [string, string, string, string];
    country: string;
    message: string;
    consent: string;
    submit: string;
    successTitle: string;
    success: string;
    error: string;
    requiredError: string;
    emailError: string;
    phoneError: string;
    consentError: string;
    /** Examples shown in the empty fields. */
    placeholders: { name: string; email: string; company: string; website: string; message: string };
  };
};
