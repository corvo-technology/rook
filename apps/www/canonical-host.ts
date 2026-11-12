export const SITE_ORIGIN = "https://rook.team";

// www, the previous domain and the address before it all lead to the apex. Links and
// bookmarks to any of them keep working, so none of these hosts is ever dropped.
const REDIRECTED_HOSTS = new Set([
  "www.rook.team",
  "rookup.run",
  "www.rookup.run",
  "bots.corvo.tech",
  "www.bots.corvo.tech",
]);

/** Where a request for a retired host goes (same path and query), or null on the canonical host. */
export function canonicalRedirect(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (!REDIRECTED_HOSTS.has(url.hostname.toLowerCase())) return null;
  return new URL(`${url.pathname}${url.search}`, SITE_ORIGIN).toString();
}
