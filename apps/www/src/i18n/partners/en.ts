import type { PartnersCopy } from "./types";

const en: PartnersCopy = {
  path: "/partners",
  link: "Partners",
  meta: {
    title: "Partners · Rook",
    description:
      "Offer AI agents under your own brand: inside your product or as a white label. A recurring commission per customer, plus your own markup.",
  },
  hero: {
    title: "Offer AI agents under your own brand",
    lead: "Bring Rook into your product or sell it as your own platform. You earn on every customer, every month.",
    cta: "Become a partner",
    docs: "Technical docs",
  },
  modes: {
    heading: "Two ways to partner",
    items: [
      {
        who: "SaaS products",
        title: "Embedded in your product",
        body: "For clinic, barbershop or salon systems. The agents live inside your product and connect to your data through MCP.",
      },
      {
        who: "Agencies and resellers",
        title: "White label",
        body: "For agencies and resellers. Rook runs under your brand, on your domain, at your prices.",
      },
    ],
  },
  earn: {
    heading: "How you earn",
    lead: "A recurring commission on each customer's subscription, plus your own markup on top. The markup is entirely yours.",
    exampleLabel: "Illustrative example",
    price: "Customer pays",
    commission: "Commission",
    markup: "Your markup",
    total: "You earn",
    note: "Percentages are configurable per partner, and this example uses 20%. Figures are illustrative only, not contract terms.",
  },
  included: {
    heading: "What comes ready",
    items: [
      { title: "Agent templates per vertical", body: "Templates for clinics, barbershops, salons and more, with the daily routines already in place." },
      { title: "Embed SDK", body: "Rook inside your product, with your login and your look." },
      { title: "Partner API", body: "Create customers, set limits and follow usage from code." },
      { title: "Consultation recording", body: "For clinics: the agent transcribes the visit and drafts the record." },
      { title: "Credit per customer", body: "Control how much each customer can spend, and top up when needed." },
      { title: "Webhooks", body: "Get told when credit runs out or something important happens." },
      { title: "Isolated data", body: "Each customer in its own space, apart from the others." },
      { title: "LGPD", body: "Personal data handling built for Brazilian law from the start." },
    ],
  },
  proof: {
    heading: "Already running in real products",
    body: "A family of vertical products for clinics, barbershops and salons uses Rook embedded. The agents answer, schedule and record, connected to each customer's data.",
  },
  how: {
    heading: "How it works",
    steps: [
      { title: "Talk to us", body: "Tell us about your product and customers. We reply within a few days." },
      { title: "Set up your template", body: "Together we pick the agents, limits and prices." },
      { title: "Integrate", body: "Embed with the SDK or launch your white label." },
      { title: "Sell", body: "Your customers subscribe and you get paid every month." },
    ],
  },
  faq: {
    heading: "Questions",
    items: [
      { question: "Do I need to code?", answer: "To embed in your product, yes: the SDK and API are for your technical team. White label needs no code." },
      { question: "Who supports my customers?", answer: "You stay on the front line and we stand behind you. We agree on this in the first conversation." },
      { question: "Is my customers' data kept apart?", answer: "Yes. Each customer has an isolated space, and the agents reach only what you connect." },
      { question: "What does it cost to start?", answer: "We talk through the model that fits your business. The form creates no commitment." },
      { question: "Can I use my own domain and brand?", answer: "Yes. In white label, Rook appears under your brand, on your domain, at your prices." },
    ],
  },
  form: {
    heading: "Become a partner",
    name: "Name",
    email: "Work email",
    company: "Company",
    website: "Website",
    type: "How you want to partner",
    types: { embedded: "Embedded in my product", white_label: "White label", unsure: "Not sure yet" },
    country: "Country",
    customers: "How many customers you have",
    customerRanges: ["Up to 50", "50 to 200", "200 to 1,000", "Over 1,000"],
    message: "Message",
    consent: "I agree to be contacted about the partner program and to the processing of my data for that.",
    submit: "Send",
    successTitle: "We got your message.",
    success: "We sent an email to {email}. We'll write back soon.",
    error: "We couldn't send this right now. Try again in a moment.",
    requiredError: "Fill in this field.",
    emailError: "Enter a valid email.",
    consentError: "We need your consent to continue.",
  },
};

export default en;
