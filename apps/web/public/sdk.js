// Rook partner SDK: <corvo-assistant session-url="/your/session/route"></corvo-assistant>
//
// Shows the Rook assistant inside your page, signed in as your customer. Your backend route
// (session-url) must answer POST with { code }, where the code comes from Rook's
// POST /api/partner/v1/sessions. The code is single use and lasts 60 seconds; this element asks
// for a new one whenever the frame needs it. The partner key never reaches the browser.
//
// Two modes. Inline (default): the element is the chat, sized by you. Launcher (mode="launcher"):
// mount the element once in your app shell; it draws a floating button, a quick-ask popover and a
// docked side panel (a bottom sheet on a phone) in a shadow root, in your accent, radius and font.
//
// Attributes: session-url (required), mode (inline | launcher, default inline), theme (light |
// dark | auto, default auto), locale (en, de, pt-BR, zh-CN, es, fr, ja; default: the visitor's
// language), accent (your main colour as #rrggbb; default: Rook's own), origin (default: where
// this file came from). Launcher only: dock (overlay | push, default overlay), radius (a CSS
// length such as 12px), font-family (default: inherited from your page), name (the panel title,
// default none), context (JSON, see setContext), shortcut (off to turn the Cmd/Ctrl+J key off).
//
// Methods: setContext({ page, title, entities: [{ type, id, label }], suggestions? }),
// registerActions([{ name, description, params, confirm }]), resolveAction(id, result),
// setSuggestions([text]), open(), close(), toggle().
//
// Events (on the element): corvo-ready, corvo-expired, corvo-checkout { url } (the customer
// tapped "Buy more": cancel it with preventDefault() to handle it yourself, otherwise the address
// opens in a new tab of the top window), corvo-navigate { path } (open that place in your product,
// such as a recording screen), corvo-unread { count } (badge your own menu); launcher mode adds
// corvo-open, corvo-close, corvo-unavailable { reason } (the assistant cannot be offered; the
// launcher hides itself) and corvo-action { name, params, id } (the customer confirmed an action
// you registered: do it, then call resolveAction(id, result)).
(() => {
  if (customElements.get("corvo-assistant")) return;
  const scriptOrigin = (() => {
    try {
      return new URL(document.currentScript.src).origin;
    } catch {
      return null;
    }
  })();

  const isHttps = (value) => {
    try {
      return typeof value === "string" && new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  };
  const isPath = (value) => typeof value === "string" && /^\/(?!\/)[^\s\\]*$/.test(value);

  // ---- What the page tells the assistant -------------------------------------------------------
  const limit = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
  const ACTION_NAME = /^[a-z][a-z0-9_.-]{0,39}$/;
  const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;
  const PARAM_TYPES = ["string", "number", "integer", "boolean"];

  /** Keeps only what the assistant may be told: short strings, a few entities. */
  function cleanContext(value) {
    if (!value || typeof value !== "object") return null;
    const entities = (Array.isArray(value.entities) ? value.entities : [])
      .slice(0, 5)
      .flatMap((entity) => {
        const type = entity && /^[a-z][a-z0-9_-]{0,31}$/i.test(entity.type) ? entity.type : "";
        const id = limit(entity && String(entity.id ?? ""), 64);
        const label = limit(entity && entity.label, 120);
        return type && id && label ? [{ type, id, label }] : [];
      });
    const page = limit(value.page, 200);
    const title = limit(value.title, 120);
    const suggestions = (Array.isArray(value.suggestions) ? value.suggestions : [])
      .map((text) => limit(text, 80))
      .filter(Boolean)
      .slice(0, 4);
    if (!page && !title && !entities.length && !suggestions.length) return null;
    return { page, title, entities, suggestions };
  }

  /** The slice of JSON Schema an action's params may use: one flat object of scalars. */
  function cleanAction(value) {
    if (!value || typeof value !== "object" || !ACTION_NAME.test(value.name)) return null;
    const schema = value.params && typeof value.params === "object" ? value.params : {};
    const properties = {};
    for (const [key, rule] of Object.entries(schema.properties || {}).slice(0, 12)) {
      if (!PARAM_NAME.test(key) || !rule || !PARAM_TYPES.includes(rule.type)) continue;
      properties[key] = { type: rule.type };
      if (typeof rule.description === "string")
        properties[key].description = limit(rule.description, 120);
      if (Array.isArray(rule.enum)) {
        properties[key].enum = rule.enum
          .filter((item) => typeof item === "string" || typeof item === "number")
          .slice(0, 20);
      }
      for (const bound of ["maxLength", "minimum", "maximum"]) {
        if (Number.isFinite(rule[bound])) properties[key][bound] = rule[bound];
      }
    }
    const required = (Array.isArray(schema.required) ? schema.required : []).filter(
      (key) => key in properties,
    );
    return {
      name: value.name,
      description: limit(value.description, 200),
      params: { type: "object", properties, required },
      // Whatever is passed, the customer always confirms first.
      confirm: true,
    };
  }

  /** Checks params against a cleaned action. Same rules as the server's. */
  function checkParams(action, params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) return false;
    const { properties, required } = action.params;
    for (const key of Object.keys(params)) if (!(key in properties)) return false;
    for (const key of required) if (params[key] === undefined) return false;
    for (const [key, rule] of Object.entries(properties)) {
      const item = params[key];
      if (item === undefined) continue;
      if (rule.type === "string") {
        if (typeof item !== "string" || item.length > (rule.maxLength ?? 500)) return false;
      } else if (rule.type === "boolean") {
        if (typeof item !== "boolean") return false;
      } else {
        if (typeof item !== "number" || !Number.isFinite(item)) return false;
        if (rule.type === "integer" && !Number.isInteger(item)) return false;
        if (rule.minimum !== undefined && item < rule.minimum) return false;
        if (rule.maximum !== undefined && item > rule.maximum) return false;
      }
      if (rule.enum && !rule.enum.includes(item)) return false;
    }
    return true;
  }

  // ---- Launcher chrome -------------------------------------------------------------------------
  const COPY = {
    en: ["Ask or request", "Open full conversation", "Close", "Expand", "Collapse", "Assistant"],
    "pt-BR": [
      "Pergunte ou peça",
      "Abrir conversa completa",
      "Fechar",
      "Expandir",
      "Recolher",
      "Assistente",
    ],
    es: [
      "Pregunta o pide",
      "Abrir conversación completa",
      "Cerrar",
      "Ampliar",
      "Reducir",
      "Asistente",
    ],
    fr: [
      "Demandez ou posez une question",
      "Ouvrir la conversation complète",
      "Fermer",
      "Agrandir",
      "Réduire",
      "Assistant",
    ],
    de: [
      "Frage oder bitte",
      "Vollständiges Gespräch öffnen",
      "Schließen",
      "Vergrößern",
      "Verkleinern",
      "Assistent",
    ],
    ja: ["質問や依頼を入力", "会話全体を開く", "閉じる", "拡大", "縮小", "アシスタント"],
    "zh-CN": ["提问或提出请求", "打开完整对话", "关闭", "展开", "收起", "助手"],
  };
  const copyFor = (locale) => {
    const tag = String(locale || "").toLowerCase();
    if (tag.startsWith("pt")) return COPY["pt-BR"];
    if (tag.startsWith("zh")) return COPY["zh-CN"];
    return COPY[tag.slice(0, 2)] || COPY.en;
  };

  const STYLE = `
:host{all:initial;font-family:inherit}
*{box-sizing:border-box}
.root{--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--soft:#f3f4f6;--accent:#111827;--on-accent:#fff;
  --radius:12px;--shadow:0 12px 32px -8px rgba(17,24,39,.28);
  font-family:inherit;font-size:14px;color:var(--fg);line-height:1.4}
.root[data-theme=dark]{--bg:#17181c;--fg:#f3f4f6;--muted:#9ca3af;--line:#2b2d33;--soft:#22242a;--shadow:0 12px 32px -8px rgba(0,0,0,.6)}
@media (prefers-color-scheme:dark){.root[data-theme=auto]{--bg:#17181c;--fg:#f3f4f6;--muted:#9ca3af;--line:#2b2d33;--soft:#22242a;--shadow:0 12px 32px -8px rgba(0,0,0,.6)}}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fab{position:fixed;inset-block-end:20px;inset-inline-end:20px;z-index:2147483000;width:52px;height:52px;border-radius:999px;border:0;
  background:var(--accent);color:var(--on-accent);box-shadow:var(--shadow);display:grid;place-items:center;transition:transform .15s}
.fab:hover{transform:scale(1.05)}
.fab svg{width:22px;height:22px}
.badge{position:absolute;inset-block-start:-4px;inset-inline-end:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;
  background:#dc2626;color:#fff;font-size:11px;font-weight:600;display:grid;place-items:center;border:2px solid var(--bg)}
.pop{position:fixed;inset-block-end:84px;inset-inline-end:20px;z-index:2147483000;width:400px;max-width:calc(100vw - 32px);
  background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--radius) + 4px);box-shadow:var(--shadow);padding:14px;
  display:flex;flex-direction:column;gap:10px}
.chip{align-self:flex-start;max-width:100%;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop input{width:100%;border:1px solid var(--line);border-radius:var(--radius);padding:11px 12px;background:var(--bg)}
.suggest{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.suggest button{width:100%;text-align:start;border:0;background:none;padding:8px 10px;border-radius:calc(var(--radius) - 4px);color:var(--fg)}
.suggest button:hover{background:var(--soft)}
.full{align-self:flex-start;border:0;background:none;padding:2px 0;color:var(--muted);font-size:13px;text-decoration:underline}
.panel{position:fixed;inset-block:0;inset-inline-end:0;z-index:2147483000;width:440px;max-width:100vw;background:var(--bg);
  border-inline-start:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-direction:column;transition:transform .2s ease,visibility .2s}
.panel[data-open=false]{visibility:hidden;transform:translateX(100%);pointer-events:none}
.panel[data-open=false]:dir(rtl){transform:translateX(-100%)}
.panel[data-expanded=true]{width:100vw}
.head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-block-end:1px solid var(--line)}
.title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon{border:0;background:none;padding:6px;border-radius:calc(var(--radius) - 4px);color:var(--muted);display:grid;place-items:center}
.icon:hover{background:var(--soft);color:var(--fg)}
.icon svg{width:16px;height:16px}
.body{position:relative;flex:1;min-height:0}
.body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;opacity:0;transition:opacity .15s}
.body[data-ready=true] iframe{opacity:1}
.skeleton{position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:12px;pointer-events:none}
.body[data-ready=true] .skeleton{display:none}
.bar{border-radius:var(--radius);background:var(--soft);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.bar{animation:none}.panel,.fab{transition:none}}
@media (max-width:639px){
  .pop{inset-inline:16px;width:auto;max-width:none}
  .panel{inset-block:auto 0;inset-inline:0;width:100%;height:85dvh;border-radius:calc(var(--radius) + 6px) calc(var(--radius) + 6px) 0 0;border-inline-start:0}
  .panel[data-expanded=true]{height:100dvh;border-radius:0}
  .panel[data-open=false]{transform:translateY(100%)}
}
[hidden]{display:none!important}`;

  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    expand:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    collapse:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 10l7-7M3 21l7-7M14 10h6M14 10V4M10 14H4M10 14v6"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  /** Black or white, whichever reads on the accent. */
  function onAccent(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.6 ? "#111827" : "#ffffff";
  }

  const preconnected = new Set();
  const NARROW = "(max-width: 639px)";

  class CorvoAssistant extends HTMLElement {
    static get observedAttributes() {
      return ["theme", "locale", "accent", "context", "dock", "radius", "font-family", "name"];
    }

    get launcher() {
      return this.getAttribute("mode") === "launcher";
    }

    connectedCallback() {
      if (this.frame || this.root) return;
      this.actions = new Map();
      this.pendingActions = new Set();
      if (this.launcher) return this.mountLauncher();
      if (!this.style.display) this.style.display = "block";
      this.frame = document.createElement("iframe");
      this.frame.title = "Rook";
      this.frame.allow = "clipboard-write";
      this.frame.style.cssText =
        "border:0;width:100%;height:100%;display:block;background:transparent";
      this.appendChild(this.frame);
      this.onMessage = (event) => this.handle(event);
      window.addEventListener("message", this.onMessage);
      void this.load();
    }

    disconnectedCallback() {
      window.removeEventListener("message", this.onMessage);
      if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
      this.unpush();
      this.frame?.remove();
      this.frame = null;
      this.root = null;
      this.shadowRoot?.replaceChildren();
    }

    attributeChangedCallback(name, _old, value) {
      if (name === "context") return this.setContext(this.parseContextAttribute(value));
      if (
        this.root &&
        ["dock", "radius", "font-family", "name", "accent", "theme", "locale"].includes(name)
      ) {
        this.paint();
      }
      if (["theme", "locale", "accent"].includes(name)) {
        this.send({
          type: "corvo:config",
          theme: this.getAttribute("theme") || "auto",
          locale: this.getAttribute("locale") || undefined,
          accent: this.getAttribute("accent") || undefined,
        });
      }
    }

    get origin() {
      return (this.getAttribute("origin") || scriptOrigin || "").replace(/\/+$/, "");
    }

    // ---- Page context and actions (both modes) ------------------------------------------------

    parseContextAttribute(value) {
      try {
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    }

    /** Tells the assistant where the customer is. Call it again whenever the page changes. */
    setContext(context) {
      this.pageContext = cleanContext(context);
      this.sendContext();
      this.paintPopover();
    }

    sendContext() {
      const context = this.pageContext;
      this.send({
        type: "corvo:context",
        context: context
          ? {
              page: context.page || undefined,
              title: context.title || undefined,
              entities: context.entities,
            }
          : null,
      });
    }

    /** Tells the assistant what your page can do for the customer, once they confirm it. */
    registerActions(actions) {
      this.actions = new Map();
      for (const item of Array.isArray(actions) ? actions.slice(0, 12) : []) {
        const action = cleanAction(item);
        if (action) this.actions.set(action.name, action);
      }
      this.sendActions();
      this.paintPopover();
    }

    sendActions() {
      this.send({ type: "corvo:actions", actions: [...this.actions.values()] });
    }

    /** Answers an action the customer confirmed: `{ ok?, message? }`, or a message string. */
    resolveAction(id, result) {
      if (!this.pendingActions.delete(id)) return;
      const object = result && typeof result === "object" ? result : { message: result };
      const failed = object.ok === false || object.error !== undefined;
      this.send({
        type: "corvo:action-result",
        id,
        ok: !failed,
        result: limit(String(object.message ?? object.error ?? ""), 300) || undefined,
      });
    }

    /** The lines the quick-ask popover offers; without them, the page's suggestions or actions. */
    setSuggestions(list) {
      this.suggestions = (Array.isArray(list) ? list : [])
        .map((text) => limit(text, 80))
        .filter(Boolean)
        .slice(0, 4);
      this.paintPopover();
    }

    suggestionList() {
      if (this.suggestions?.length) return this.suggestions;
      if (this.pageContext?.suggestions.length) return this.pageContext.suggestions;
      return [...this.actions.values()]
        .map((action) => action.description)
        .filter(Boolean)
        .slice(0, 3);
    }

    // ---- Session ------------------------------------------------------------------------------

    /** A fresh one-use code from the partner's own backend: { code } or { error: reason }. */
    async code() {
      const url = this.getAttribute("session-url");
      if (!url) return { error: "no_session_url" };
      try {
        const response = await fetch(url, { method: "POST", credentials: "same-origin" });
        if (!response.ok) {
          return {
            error: response.status === 401 || response.status === 403 ? "forbidden" : "unavailable",
          };
        }
        const body = await response.json();
        return typeof body.code === "string" && body.code
          ? { code: body.code }
          : { error: "no_code" };
      } catch {
        return { error: "network" };
      }
    }

    async load() {
      this.loading = true;
      const { code, error } = await this.code();
      this.loading = false;
      if (!code || !this.frame) return this.failed(error);
      const params = new URLSearchParams({ code, theme: this.getAttribute("theme") || "auto" });
      const locale = this.getAttribute("locale") || navigator.language;
      if (locale) params.set("locale", locale);
      const accent = this.getAttribute("accent");
      if (accent) params.set("accent", accent);
      if (this.launcher) params.set("mode", "compact");
      this.prepared = true;
      this.frame.src = `${this.origin}/embed#${params}`;
    }

    /** The launcher goes away rather than offer something that cannot open. */
    failed(reason) {
      if (this.launcher && !this.ready) {
        this.unavailable = true;
        this.close();
        if (this.root) this.root.hidden = true;
        this.dispatchEvent(
          new CustomEvent("corvo-unavailable", { detail: { reason: reason || "unavailable" } }),
        );
        return;
      }
      this.dispatchEvent(new CustomEvent("corvo-expired"));
    }

    /** Warms the session so opening shows the chat at once. Safe to call any number of times. */
    prepare() {
      if (!this.launcher || this.prepared || this.loading || this.unavailable) return;
      void this.load();
    }

    send(message) {
      if (this.frame?.contentWindow && this.origin) {
        this.frame.contentWindow.postMessage(message, this.origin);
      }
    }

    handle(event) {
      if (
        !this.frame ||
        event.source !== this.frame.contentWindow ||
        event.origin !== this.origin
      ) {
        return;
      }
      const type = event.data && event.data.type;
      const data = event.data || {};
      if (type === "corvo:ready") {
        this.ready = true;
        if (this.body) this.body.dataset.ready = "true";
        this.sendContext();
        this.sendActions();
        if (this.queuedAsk) {
          this.send({ type: "corvo:ask", text: this.queuedAsk });
          this.queuedAsk = null;
        }
        this.dispatchEvent(new CustomEvent("corvo-ready"));
      }
      if (type === "corvo:refresh") {
        void this.code().then(({ code, error }) => {
          if (code) this.send({ type: "corvo:code", code });
          else this.failed(error);
        });
      }
      if (type === "corvo:checkout" && isHttps(data.url)) {
        const proceed = this.dispatchEvent(
          new CustomEvent("corvo-checkout", { detail: { url: data.url }, cancelable: true }),
        );
        if (proceed) window.open(data.url, "_blank", "noopener,noreferrer");
      }
      if (type === "corvo:navigate" && isPath(data.path)) {
        this.dispatchEvent(new CustomEvent("corvo-navigate", { detail: { path: data.path } }));
      }
      if (type === "corvo:unread" && Number.isFinite(data.count)) {
        const count = Math.max(0, Math.floor(data.count));
        this.unread = count;
        this.paintBadge();
        this.dispatchEvent(new CustomEvent("corvo-unread", { detail: { count } }));
      }
      if (type === "corvo:action") this.handleAction(data);
      if (type === "corvo:escape" && this.state !== "closed") this.close();
      if (type === "corvo:expired") {
        if (this.launcher && !this.ready) return this.failed("expired");
        this.dispatchEvent(new CustomEvent("corvo-expired"));
        void this.load();
      }
    }

    /** The customer confirmed an action in the card: check it, then hand it to the page. */
    handleAction(data) {
      const id = typeof data.id === "string" ? data.id.slice(0, 64) : "";
      if (!id) return;
      const action = this.actions.get(data.name);
      const reply = (message) =>
        this.send({ type: "corvo:action-result", id, ok: false, result: message });
      if (!action) return reply("unknown action");
      if (!checkParams(action, data.params)) return reply("invalid params");
      this.pendingActions.add(id);
      this.dispatchEvent(
        new CustomEvent("corvo-action", { detail: { name: action.name, params: data.params, id } }),
      );
    }

    // ---- Launcher -----------------------------------------------------------------------------

    mountLauncher() {
      this.state = "closed";
      this.expanded = false;
      this.unread = 0;
      this.suggestions = [];
      this.ready = false;
      this.prepared = false;
      this.loading = false;
      const origin = this.origin;
      if (origin && !preconnected.has(origin)) {
        preconnected.add(origin);
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        document.head.append(link);
      }
      const shadow = this.shadowRoot || this.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>${STYLE}</style>
<div class="root">
  <button class="fab" type="button" aria-haspopup="dialog" aria-expanded="false">${ICONS.chat}<span class="badge" hidden></span></button>
  <section class="pop" role="dialog" aria-modal="false" hidden>
    <div class="chip" hidden></div>
    <form><input type="text" autocomplete="off" maxlength="2000"></form>
    <ul class="suggest"></ul>
    <button class="full" type="button"></button>
  </section>
  <aside class="panel" role="dialog" aria-modal="false" data-open="false" data-expanded="false">
    <div class="head"><span class="title"></span>
      <button class="icon expand" type="button">${ICONS.expand}</button>
      <button class="icon close" type="button">${ICONS.close}</button></div>
    <div class="body"><div class="skeleton" aria-hidden="true">
      <div class="bar" style="height:36px;width:60%;align-self:flex-end"></div>
      <div class="bar" style="height:64px;width:85%"></div>
      <div class="bar" style="height:36px;width:45%"></div>
      <div class="bar" style="height:44px;margin-top:auto"></div></div></div>
  </aside>
</div>`;
      this.root = shadow.querySelector(".root");
      this.fab = shadow.querySelector(".fab");
      this.pop = shadow.querySelector(".pop");
      this.panel = shadow.querySelector(".panel");
      this.body = shadow.querySelector(".body");
      this.input = shadow.querySelector("input");
      this.frame = document.createElement("iframe");
      this.frame.allow = "clipboard-write";
      this.body.prepend(this.frame);
      this.paint();

      this.fab.addEventListener("click", () => this.toggle());
      for (const eventName of ["pointerenter", "focus", "touchstart"]) {
        this.fab.addEventListener(eventName, () => this.prepare(), { passive: true });
      }
      shadow.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = "";
        this.ask(text);
      });
      shadow.querySelector(".full").addEventListener("click", () => this.showPanel());
      shadow.querySelector(".expand").addEventListener("click", () => {
        this.expanded = !this.expanded;
        this.paint();
        this.applyPush();
      });
      shadow.querySelector(".close").addEventListener("click", () => this.close());
      this.onMessage = (event) => this.handle(event);
      window.addEventListener("message", this.onMessage);
      this.onKey = (event) => this.handleKey(event);
      document.addEventListener("keydown", this.onKey, true);
      const initial = this.parseContextAttribute(this.getAttribute("context"));
      if (initial) this.pageContext = cleanContext(initial);
      this.paintPopover();
      // Warm the session when the browser has nothing better to do.
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      idle(() => this.prepare());
    }

    /** Applies the partner's look: accent, radius, font, theme, language, dock. */
    paint() {
      if (!this.root) return;
      const style = this.root.style;
      const accent = /^#[0-9a-f]{6}$/i.test(this.getAttribute("accent") || "")
        ? this.getAttribute("accent")
        : null;
      if (accent) {
        style.setProperty("--accent", accent);
        style.setProperty("--on-accent", onAccent(accent));
      } else {
        style.removeProperty("--accent");
        style.removeProperty("--on-accent");
      }
      const radius = this.getAttribute("radius");
      if (radius && /^\d+(\.\d+)?(px|rem|em)$/.test(radius)) style.setProperty("--radius", radius);
      else style.removeProperty("--radius");
      const font = this.getAttribute("font-family");
      if (font && /^[\w\s,"'-]+$/.test(font)) style.fontFamily = font;
      else style.fontFamily = "";
      const theme = this.getAttribute("theme");
      this.root.dataset.theme = theme === "light" || theme === "dark" ? theme : "auto";
      this.root.dataset.dock = this.getAttribute("dock") === "push" ? "push" : "overlay";
      const copy = copyFor(this.getAttribute("locale") || navigator.language);
      const name = this.getAttribute("name") || "";
      this.input.placeholder = copy[0];
      this.input.setAttribute("aria-label", copy[0]);
      this.shadowRoot.querySelector(".full").textContent = copy[1];
      this.shadowRoot.querySelector(".title").textContent = name;
      this.frame.title = name || copy[5];
      this.fab.setAttribute("aria-label", name || copy[5]);
      this.pop.setAttribute("aria-label", name || copy[5]);
      this.panel.setAttribute("aria-label", name || copy[5]);
      const close = this.shadowRoot.querySelector(".close");
      close.setAttribute("aria-label", copy[2]);
      const expand = this.shadowRoot.querySelector(".expand");
      expand.setAttribute("aria-label", this.expanded ? copy[4] : copy[3]);
      expand.innerHTML = this.expanded ? ICONS.collapse : ICONS.expand;
      this.panel.dataset.expanded = String(this.expanded);
    }

    paintBadge() {
      const badge = this.shadowRoot?.querySelector(".badge");
      if (!badge) return;
      badge.hidden = !this.unread || this.state === "panel";
      badge.textContent = this.unread > 99 ? "99+" : String(this.unread);
    }

    paintPopover() {
      if (!this.pop) return;
      const label = this.pageContext?.entities[0]?.label || this.pageContext?.title || "";
      const chip = this.pop.querySelector(".chip");
      chip.hidden = !label;
      chip.textContent = label;
      const list = this.pop.querySelector(".suggest");
      list.replaceChildren(
        ...this.suggestionList().map((text) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = text;
          button.addEventListener("click", () => this.ask(text));
          item.append(button);
          return item;
        }),
      );
    }

    /** Sends what the customer typed in the popover to the chat and shows the chat. */
    ask(text) {
      this.showPanel();
      if (this.ready) this.send({ type: "corvo:ask", text });
      else this.queuedAsk = text;
    }

    handleKey(event) {
      if (!this.launcher || this.unavailable) return;
      if (
        this.getAttribute("shortcut") !== "off" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "j"
      ) {
        event.preventDefault();
        this.toggle();
        return;
      }
      if (event.key === "Escape" && this.state !== "closed") {
        event.stopPropagation();
        this.close();
      }
    }

    get isOpen() {
      return this.state !== "closed" && Boolean(this.state);
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    /** Opens the last surface used: the quick-ask popover the first time. */
    open() {
      if (!this.launcher || this.unavailable || this.isOpen) return;
      this.prepare();
      if (this.lastSurface === "panel") this.showPanel();
      else this.showPopover();
    }

    transition(next) {
      const was = this.state;
      this.state = next;
      this.pop.hidden = next !== "popover";
      this.panel.dataset.open = String(next === "panel");
      this.panel.toggleAttribute("inert", next !== "panel");
      this.fab.hidden = next === "panel";
      this.fab.setAttribute("aria-expanded", String(next !== "closed"));
      if (next !== "closed") this.lastSurface = next;
      this.paintBadge();
      this.applyPush();
      if (was === "closed" && next !== "closed") {
        this.opener = document.activeElement;
        this.dispatchEvent(new CustomEvent("corvo-open"));
      }
      if (was !== "closed" && next === "closed") this.dispatchEvent(new CustomEvent("corvo-close"));
    }

    showPopover() {
      this.transition("popover");
      this.paintPopover();
      this.input.focus();
    }

    showPanel() {
      this.prepare();
      this.transition("panel");
      this.frame.focus();
    }

    close() {
      if (!this.root || this.state === "closed") return;
      this.expanded = false;
      this.paint();
      this.transition("closed");
      // Give focus back to where the customer was, or to the button.
      const target =
        this.opener && this.opener.isConnected && this.opener !== document.body
          ? this.opener
          : this.fab;
      (target.focus ? target : this.fab).focus();
      this.opener = null;
    }

    /** With dock="push" the panel makes room instead of covering the page (not on a phone). */
    applyPush() {
      const push =
        this.state === "panel" &&
        !this.expanded &&
        this.root.dataset.dock === "push" &&
        !window.matchMedia(NARROW).matches;
      if (!push) return this.unpush();
      if (this.pushed === undefined) this.pushed = document.body.style.marginInlineEnd;
      document.body.style.transition = "margin-inline-end .2s ease";
      document.body.style.marginInlineEnd = "440px";
    }

    unpush() {
      if (this.pushed === undefined) return;
      document.body.style.marginInlineEnd = this.pushed;
      this.pushed = undefined;
    }
  }

  customElements.define("corvo-assistant", CorvoAssistant);
})();
