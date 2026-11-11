import { getLaunchCopy } from "./i18n/launch";
import {
  CONTACT_EMAIL,
  DOWNLOAD_URL,
  GITHUB_URL,
  INSTALL_COMMAND,
  INSTALL_COMMAND_WINDOWS,
  SECURITY_EMAIL,
  SITE_URL,
} from "./site";

export const AGENT_DISCOVERY_LINKS =
  '</llms.txt>; rel="describedby"; type="text/plain", </.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/ai-catalog+json"';

const home = getLaunchCopy("en");

export const HOME_MARKDOWN = `# Rook

${home.hero.line1} ${home.hero.line2}

${home.hero.lead.join(" ")}

## ${home.agent.heading} ${home.agent.accent}

${home.agent.copy}

${home.agent.traits.map((trait) => `- **${trait.title}:** ${trait.body}`).join("\n")}

## ${home.team.heading} ${home.team.accent}

${home.team.copy}

## ${home.store.heading} ${home.store.accent}

${home.store.copy}

## ${home.works.heading} ${home.works.accent}

${home.works.cards.map((card) => `- **${card.title}** ${card.body}`).join("\n")}

## ${home.open.heading} ${home.open.accent}

${home.open.copy}

${home.open.points.map((point) => `- **${point.title}:** ${point.body}`).join("\n")}

- [Source code on GitHub (${home.open.license})](${GITHUB_URL})

## ${home.install.heading}

${home.install.copy}

- [${home.install.download}](${DOWNLOAD_URL})
- ${home.install.macLinux}: \`${INSTALL_COMMAND}\`
- ${home.install.windows}: \`${INSTALL_COMMAND_WINDOWS}\`

## FAQ

${home.faq.items.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n")}

## ${home.cta.heading}

${home.cta.copy}

## Site index

- [Agent instructions](${SITE_URL}/llms.txt)
- [About](${SITE_URL}/about/)
- [Support](${SITE_URL}/support/)
- [Privacy](${SITE_URL}/privacy/)
- [Terms](${SITE_URL}/terms/)
- [Sitemap](${SITE_URL}/sitemap-index.xml)
`;

export const ABOUT_MARKDOWN = `# About Rook

Rook gives a business a team of AI bots. Each bot has one job, keeps its own conversation and memory, works in the background, and asks for approval before the actions you choose.

For questions, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).
`;

export const SUPPORT_MARKDOWN = `# Rook support

For help with your account, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). Include the email address on the account, what you expected to happen, and any error message you saw. Never send passwords, API keys, access tokens, or other secrets.

Report vulnerabilities only to [${SECURITY_EMAIL}](mailto:${SECURITY_EMAIL}).
`;

export const PRIVACY_MARKDOWN = `# Rook privacy

Our privacy policy is being finalized and will be published before launch. For privacy questions or requests, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).
`;

export const TERMS_MARKDOWN = `# Rook terms

Our terms are being finalized and will be published before launch. For questions, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).
`;

export const AGENT_INSTRUCTIONS = `# Rook

> AI bots that do the work, and ask before they act.

Rook gives a business a team of AI bots. Each bot has one job, remembers its work, runs in the background, and waits for approval before the actions the owner chooses.

Do not send passwords, tokens, or private customer data to the public website.

## Canonical resources

- [Website](${SITE_URL}/)
- [Website Markdown](${SITE_URL}/index.md)
- [About](${SITE_URL}/about/)
- [Support](${SITE_URL}/support/)
- [Privacy](${SITE_URL}/privacy/)
- [Terms](${SITE_URL}/terms/)
- [Sitemap](${SITE_URL}/sitemap-index.xml)
`;

export const NOT_FOUND_MARKDOWN = `# Page not found

The requested Rook page does not exist.

- [Home](${SITE_URL}/)
- [Agent instructions](${SITE_URL}/llms.txt)
- [Site map](${SITE_URL}/sitemap-index.xml)
`;

const MARKDOWN_DOCUMENTS = new Map<string, string>([
  ["/", HOME_MARKDOWN],
  ["/about", ABOUT_MARKDOWN],
  ["/privacy", PRIVACY_MARKDOWN],
  ["/support", SUPPORT_MARKDOWN],
  ["/terms", TERMS_MARKDOWN],
]);

type MediaPreference = {
  quality: number;
  specificity: number;
};

export type Representation = "html" | "markdown" | "not-acceptable";

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

function preferenceFor(accept: string, desiredType: string): MediaPreference {
  const [desiredMajor, desiredMinor] = desiredType.split("/");
  let best: MediaPreference = { quality: 0, specificity: -1 };

  for (const rawRange of accept.split(",")) {
    const [rawType = "", ...rawParameters] = rawRange
      .trim()
      .toLowerCase()
      .split(";");
    const [major, minor] = rawType.trim().split("/");
    if (!major || !minor) continue;

    const specificity =
      major === desiredMajor && minor === desiredMinor
        ? 2
        : major === desiredMajor && minor === "*"
          ? 1
          : major === "*" && minor === "*"
            ? 0
            : -1;
    if (specificity < 0) continue;

    const qualityParameter = rawParameters.find((parameter) =>
      parameter.trim().startsWith("q="),
    );
    const parsedQuality = qualityParameter
      ? Number.parseFloat(qualityParameter.trim().slice(2))
      : 1;
    const quality =
      Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
        ? parsedQuality
        : 0;

    if (
      specificity > best.specificity ||
      (specificity === best.specificity && quality > best.quality)
    ) {
      best = { quality, specificity };
    }
  }

  return best;
}

export function negotiateRepresentation(
  acceptHeader: string | null,
): Representation {
  if (!acceptHeader?.trim()) return "html";

  const markdown = preferenceFor(acceptHeader, "text/markdown");
  const html = preferenceFor(acceptHeader, "text/html");

  if (markdown.quality <= 0 && html.quality <= 0) return "not-acceptable";
  if (markdown.quality > html.quality) return "markdown";
  if (
    markdown.quality === html.quality &&
    markdown.specificity > html.specificity
  )
    return "markdown";
  return "html";
}

export function getMarkdownDocument(pathname: string): string | undefined {
  return MARKDOWN_DOCUMENTS.get(normalizePathname(pathname));
}

export function getMarkdownAlternate(pathname: string): string | undefined {
  const normalizedPathname = normalizePathname(pathname);
  if (!MARKDOWN_DOCUMENTS.has(normalizedPathname)) return undefined;
  return normalizedPathname === "/" ? "/index.md" : `${normalizedPathname}.md`;
}

export function markdownResponse(
  body: string,
  method = "GET",
  status = 200,
): Response {
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Language": "en",
      "Content-Type": "text/markdown; charset=utf-8",
      Link: AGENT_DISCOVERY_LINKS,
      Vary: "Accept, Accept-Encoding",
      ...(status === 404 ? { "X-Robots-Tag": "noindex" } : {}),
    },
  });
}
