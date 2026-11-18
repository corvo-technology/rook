import type { APIRoute } from "astro";
import { getPages, markdownOf, textResponse } from "../lib/pages";

export const GET: APIRoute = async ({ request }) => {
  const pages = await getPages();
  return textResponse(pages.map(markdownOf).join("\n---\n\n"), "text/plain", request.method);
};
