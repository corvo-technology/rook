import type { APIRoute } from "astro";
import { getPages, SITE, textResponse } from "../lib/pages";

const GROUPS: Record<string, string> = {
  intro: "Introduction",
  start: "Getting started",
  agents: "Agents",
  partners: "Partners",
  security: "Security and privacy",
};

export const GET: APIRoute = async ({ request }) => {
  const groupOf = (slug: string) => slug.replace(/^en\//, "").split("/")[0] ?? "";
  const rank = (slug: string) => Object.keys(GROUPS).indexOf(groupOf(slug));
  const pages = (await getPages()).sort(
    (a, b) =>
      rank(a.slug) - rank(b.slug) || a.entry.data.sidebar.order - b.entry.data.sidebar.order,
  );
  const lines = [
    "# Rook documentation",
    "",
    "> Rook is a team of AI agents for companies: channels, routines, computers, approvals, memory and a wiki. These docs cover using Rook and integrating it as a partner (embedded or white label). Portuguese (pt-BR) is the default language; English lives under /en/.",
    "",
    `Every page is also served as Markdown by appending .md to its path. The full text is at ${SITE}/llms-full.txt.`,
  ];
  for (const lang of ["pt-BR", "en"] as const) {
    lines.push("", `## ${lang === "en" ? "English" : "Português (pt-BR)"}`);
    let group = "";
    for (const page of pages.filter((p) => p.lang === lang)) {
      const key = groupOf(page.slug);
      if (key !== group) {
        group = key;
        lines.push("", `### ${GROUPS[key] ?? key}`, "");
      }
      lines.push(
        `- [${page.entry.data.title}](${page.markdownUrl}): ${page.entry.data.description ?? ""}`,
      );
    }
  }
  return textResponse(`${lines.join("\n")}\n`, "text/plain", request.method);
};
