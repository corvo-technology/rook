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
    scarcity: "First partner cohort, limited spots · whoever joins first gets priority",
    title: "Offer AI agents under your own brand",
    lead: "Bring Rook into your product or sell it as your own platform. You earn on every customer, every month.",
    cta: "Become a partner",
    docs: "Technical docs",
  },
  pain: {
    heading: "My clients already ask how to use AI day to day. What do I offer them?",
    paragraphs: [
      "**The demand is here.** Your clients hear about AI every week and expect you to have an answer.",
      "**Building from scratch is costly.** Models, servers, security and support take months before the first sale.",
      "**With Rook, you sell what already works.** Ready agents under your brand, and revenue that repeats every month.",
    ],
  },
  how: {
    heading: "How it works",
    steps: [
      { title: "Join the program", body: "Tell us about your business in the form. We reply within a few days." },
      { title: "Set up your agent template", body: "Together we pick the agents, limits and prices." },
      { title: "Sell", body: "Show the demo to your clients and close the subscription." },
      { title: "Deploy and follow up", body: "You adapt the agents to each client's business and watch usage." },
      { title: "Get paid every month", body: "Your commission and markup arrive with every active subscription." },
    ],
  },
  earn: {
    heading: "Three ways to earn",
    lead: "Combine what fits your business. Values are set in the partner agreement.",
    cards: [
      { title: "Implementation", body: "A project fee you charge to set up the agents in the client's business." },
      { title: "Ongoing management", body: "A monthly retainer you charge to follow up, tune and grow the agents." },
      { title: "Recurring commission", body: "A share of each customer's Rook subscription, plus your optional markup on top." },
    ],
    exampleLabel: "Illustrative example",
    price: "Customer pays",
    commission: "Commission",
    markup: "Your markup",
    total: "You earn",
    note: "An example to illustrate. Percentages and values are set in the partner agreement; the example uses 20%.",
  },
  split: {
    you: {
      title: "You look after the clients.",
      items: ["The relationship with each client", "The sale", "Adapting the agents to their business"],
    },
    us: {
      title: "We handle the rest.",
      items: ["Infrastructure", "AI models", "Agent computers", "Security", "Updates", "Billing tools", "Support for you"],
    },
  },
  benefits: {
    heading: "What you get",
    items: [
      { title: "Ready agents per vertical.", body: "Templates for clinics, barbershops, salons and more." },
      { title: "A demo environment.", body: "Show Rook working before you sell." },
      { title: "SDK and API.", body: "Embed in your product and automate customers from code." },
      { title: "Credit per customer.", body: "Set how much each one can spend." },
      { title: "Priority support.", body: "A direct line to our team." },
      { title: "Your own customer portfolio.", body: "The clients are yours, under your brand." },
    ],
  },
  features: {
    heading: "The product inside",
    items: [
      { title: "Agents and people in one space", body: "Conversations, tasks and approvals in one place." },
      { title: "Automatic model routing", body: "Each task goes to the right model, with no choosing." },
      { title: "Access levels and cost control", body: "Who can do what, and how much they can spend." },
      { title: "A computer per agent", body: "Its own browser, terminal and files for each agent." },
      { title: "Routines and webhooks", body: "Agents that work on their own and notify your systems." },
      { title: "Connections and MCP", body: "Link the agent to the client's data and tools." },
      { title: "Consultation recording for clinics", body: "The agent transcribes and leaves the record as a draft." },
      { title: "Made for Brazil", body: "In Portuguese, in reais and compliant with LGPD." },
    ],
  },
  who: {
    heading: "Who it's for",
    items: [
      "Marketing agencies",
      "AI and technology consultancies",
      "Software houses and SaaS",
      "Process consultancies",
      "Accounting firms and BPO",
      "Integrators",
    ],
  },
  cohort: {
    heading: "Join the founding cohort",
    perks: [
      { title: "Implementation priority", body: "Your setup goes to the front of the line." },
      { title: "Founding conditions", body: "Better conditions for whoever arrives first." },
      { title: "A voice in the roadmap", body: "What you need shapes what we build." },
    ],
    cta: "Apply now",
  },
  faq: {
    heading: "Questions",
    items: [
      { question: "Do you send us clients?", answer: "We don't guarantee referrals. You bring your clients, and we give you the tools to sell and deploy." },
      { question: "What does it cost to be a partner?", answer: "We talk through the model that fits your business. The form creates no commitment." },
      { question: "Can I use my own brand?", answer: "Yes. You choose between embedding Rook in your product or launching a white label, under your brand, on your domain, at your prices." },
      { question: "How do I get paid?", answer: "Every month, on your customers' active subscriptions. Payment details are in the partner agreement." },
      { question: "Who keeps the customers?", answer: "You do. The relationship, the sale and the contract with the customer are yours." },
      { question: "Do I need to code?", answer: "To embed in your product, yes: the SDK and API are for your technical team. White label needs no code." },
      { question: "Is my customers' data kept apart?", answer: "Yes. Each customer has an isolated space, and the agents reach only what you connect." },
      { question: "Who supports my customers?", answer: "You stay on the front line and we stand behind you. We agree on this in the first conversation." },
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
