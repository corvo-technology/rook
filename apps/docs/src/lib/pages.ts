import { type CollectionEntry, getCollection } from "astro:content";

export const SITE = "https://docs.rook.team";

export type DocPage = {
  entry: CollectionEntry<"docs">;
  /** Path with no leading or trailing slash: `intro`, `en/partners/api`. */
  slug: string;
  lang: "pt-BR" | "en";
  url: string;
  markdownUrl: string;
};

/** Every page that has a plain Markdown body (MDX pages are left to the index files). */
export async function getPages(): Promise<DocPage[]> {
  const entries = await getCollection("docs");
  return entries
    .filter(
      (entry) => !entry.filePath?.endsWith(".mdx") && entry.id !== "index" && entry.id !== "en",
    )
    .map((entry) => {
      const slug = entry.id;
      const lang = slug === "en" || slug.startsWith("en/") ? "en" : "pt-BR";
      return {
        entry,
        slug,
        lang,
        url: `${SITE}/${slug}/`,
        markdownUrl: `${SITE}/${slug}.md`,
      } satisfies DocPage;
    })
    .sort(
      (a, b) =>
        a.entry.data.sidebar.order - b.entry.data.sidebar.order || a.slug.localeCompare(b.slug),
    );
}

export const markdownOf = ({ entry, url }: DocPage) =>
  `# ${entry.data.title}\n\n> ${entry.data.description ?? ""}\n\nSource: ${url}\n\n${entry.body?.trim() ?? ""}\n`;

export const textResponse = (body: string, type = "text/plain", method = "GET") =>
  new Response(method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
