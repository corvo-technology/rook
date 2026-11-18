const TENANT = "demo-shop";

type Env = Record<string, string | undefined>;

/** The address as an origin: no trailing slash, and not the partner API path that follows it. */
const origin = (value: string) => value.replace(/\/+$/, "").replace(/\/api\/partner\/v1$/, "");

const isLocal = (value: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
};

const page = (webUrl: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo partner</title>
<style>
  body { margin: 0; font: 15px system-ui; background: #f4f4f5; color: #111; }
  header { display: flex; gap: 12px; align-items: center; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e4e4e7; }
  header b { margin-right: auto; }
  main { display: grid; grid-template-columns: 240px 1fr; height: calc(100vh - 53px); }
  nav { padding: 20px; color: #52525b; }
  corvo-assistant { height: 100%; border-left: 1px solid #e4e4e7; }
</style>
</head>
<body>
<header>
  <b>Demo partner</b>
  <label>Theme <select id="theme"><option>auto</option><option>light</option><option>dark</option></select></label>
  <label>Language <select id="locale"><option value="">visitor</option><option>en</option><option>pt-BR</option><option>es</option><option>fr</option><option>de</option><option>ja</option><option>zh-CN</option></select></label>
</header>
<main>
  <nav>This is the partner's own page. The assistant is on the right.</nav>
  <corvo-assistant session-url="/corvo/session" theme="auto"></corvo-assistant>
</main>
<script src="${webUrl}/sdk.js"></script>
<script>
  const el = document.querySelector("corvo-assistant");
  document.getElementById("theme").onchange = (e) => el.setAttribute("theme", e.target.value);
  document.getElementById("locale").onchange = (e) =>
    e.target.value ? el.setAttribute("locale", e.target.value) : el.removeAttribute("locale");
</script>
</body>
</html>`;

/**
 * A stand-in for a partner's website and backend, for trying the embed by hand. The page loads the
 * SDK from Rook; its one route turns the partner key into a one-use code, so the key stays here.
 */
export function createEmbedDemo(
  env: Env,
  fetchFn: typeof fetch = fetch,
): (request: Request) => Promise<Response> {
  const api = env.PARTNER_API_URL ? origin(env.PARTNER_API_URL) : undefined;
  const key = env.PARTNER_API_KEY;
  if (!api) throw new Error("Set PARTNER_API_URL to the Rook API address.");
  if (!key) throw new Error("Set PARTNER_API_KEY to the key from Settings > Partnership.");
  const web = env.CORVO_WEB_URL ?? env.ROOK_WEB_URL;
  // The API and the web app share an address only on one machine; a deployed API serves no SDK.
  if (!web && !isLocal(api)) {
    throw new Error("Set CORVO_WEB_URL to the Rook web app address, where sdk.js is served.");
  }
  const webUrl = origin(web ?? api);
  // With the template on, the call names no agents, so what the partner's template defines is used.
  const useTemplate = env.PARTNER_DEMO_TEMPLATE === "1";
  const locale = env.PARTNER_DEMO_LOCALE;
  const connectorToken = env.PARTNER_DEMO_CONNECTOR_TOKEN;
  let customerReady = false;

  const call = async (method: string, path: string, body: unknown) => {
    const response = await fetchFn(`${api}/api/partner/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path} was refused (${response.status}).`);
    return (await response.json()) as Record<string, unknown>;
  };

  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/") {
      return new Response(page(webUrl), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (request.method === "POST" && pathname === "/corvo/session") {
      try {
        if (!customerReady) {
          await call("PUT", `/tenants/${TENANT}`, {
            name: "Demo Shop",
            ...(locale ? { locale } : {}),
            ...(connectorToken ? { connectorToken } : {}),
            ...(useTemplate
              ? {}
              : {
                  agents: [
                    {
                      key: "assistant",
                      name: "Assistant",
                      instructions: "You help the owner of a small shop. Keep answers short.",
                      usesConnector: false,
                    },
                  ],
                }),
            allowanceCents: 500,
          });
          customerReady = true;
        }
        const session = await call("POST", "/sessions", {
          externalTenantId: TENANT,
          externalUserId: "demo-user",
        });
        // Only the code goes to the browser: never the key, never the redirect address.
        return Response.json({ code: session.code });
      } catch {
        return new Response("Could not reach Rook", { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  };
}
