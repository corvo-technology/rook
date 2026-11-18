type Item = { title: string; body: string };

export type PartnersCopy = {
  /** Path of the page in this language, with no trailing slash. */
  path: string;
  /** The footer link. */
  link: string;
  meta: { title: string; description: string };
  hero: { title: string; lead: string; cta: string; docs: string };
  modes: { heading: string; items: [Item & { who: string }, Item & { who: string }] };
  earn: {
    heading: string;
    lead: string;
    exampleLabel: string;
    price: string;
    commission: string;
    markup: string;
    total: string;
    note: string;
  };
  included: { heading: string; items: Item[] };
  proof: { heading: string; body: string };
  how: { heading: string; steps: Item[] };
  faq: { heading: string; items: Array<{ question: string; answer: string }> };
  form: {
    heading: string;
    name: string;
    email: string;
    company: string;
    website: string;
    type: string;
    types: { embedded: string; white_label: string; unsure: string };
    country: string;
    customers: string;
    customerRanges: [string, string, string, string];
    message: string;
    consent: string;
    submit: string;
    successTitle: string;
    success: string;
    error: string;
    requiredError: string;
    emailError: string;
    consentError: string;
  };
};
