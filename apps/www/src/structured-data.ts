import { CONTACT_EMAIL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

export type HomeFaqItem = {
  question: string;
  answer: string;
};

export type HomeStructuredDataInput = {
  pageUrl: string;
  title: string;
  description: string;
  inLanguage: string;
  faq?: readonly HomeFaqItem[];
};

export function homeStructuredData(input: HomeStructuredDataInput) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/brand/icone-512.png`,
        email: CONTACT_EMAIL,
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: CONTACT_EMAIL,
          url: `${SITE_URL}/support/`,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: input.inLanguage,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "WebPage",
        "@id": `${input.pageUrl}#webpage`,
        url: input.pageUrl,
        name: input.title,
        description: input.description,
        inLanguage: input.inLanguage,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#software` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI agent platform",
        operatingSystem: "macOS",
        isAccessibleForFree: true,
        provider: { "@id": `${SITE_URL}/#organization` },
        inLanguage: input.inLanguage,
      },
      ...(input.faq && input.faq.length > 0
        ? [
            {
              "@type": "FAQPage",
              "@id": `${input.pageUrl}#faq`,
              url: input.pageUrl,
              mainEntity: input.faq.map((item) => ({
                "@type": "Question",
                name: item.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: item.answer,
                },
              })),
            },
          ]
        : []),
    ],
  };
}
