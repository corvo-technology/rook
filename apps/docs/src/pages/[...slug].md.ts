import type { APIRoute, GetStaticPaths } from "astro";
import { getPages, markdownOf, textResponse } from "../lib/pages";

export const getStaticPaths = (async () => {
  const pages = await getPages();
  return pages.map((page) => ({ params: { slug: page.slug }, props: { page } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, request }) =>
  textResponse(markdownOf(props.page), "text/markdown", request.method);
