// Rook partner SDK: <corvo-assistant session-url="/your/session/route"></corvo-assistant>
//
// Shows the Rook assistant inside your page, signed in as your customer. Your backend route
// (session-url) must answer POST with { code }, where the code comes from Rook's
// POST /api/partner/v1/sessions. The code is single use and lasts 60 seconds; this element asks
// for a new one whenever the frame needs it. The partner key never reaches the browser.
//
// Attributes: session-url (required), theme (light | dark | auto, default auto), locale (en, de,
// pt-BR, zh-CN, es, fr, ja; default: the visitor's language), accent (your main colour as #rrggbb;
// default: Rook's own), origin (default: where this file came
// from). Events (on the element): corvo-ready, corvo-expired, corvo-checkout { url } (the customer
// tapped "Buy more": cancel it with preventDefault() to handle it yourself, otherwise the address
// opens in a new tab of the top window), corvo-navigate { path } (open that place in your product,
// such as a recording screen), corvo-unread { count } (badge your own menu).
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

  class CorvoAssistant extends HTMLElement {
    static get observedAttributes() {
      return ["theme", "locale", "accent"];
    }

    connectedCallback() {
      if (this.frame) return;
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
      this.frame?.remove();
      this.frame = null;
    }

    attributeChangedCallback() {
      this.send({
        type: "corvo:config",
        theme: this.getAttribute("theme") || "auto",
        locale: this.getAttribute("locale") || undefined,
        accent: this.getAttribute("accent") || undefined,
      });
    }

    get origin() {
      return (this.getAttribute("origin") || scriptOrigin || "").replace(/\/+$/, "");
    }

    /** A fresh one-use code from the partner's own backend, or null. */
    async code() {
      const url = this.getAttribute("session-url");
      if (!url) return null;
      try {
        const response = await fetch(url, { method: "POST", credentials: "same-origin" });
        if (!response.ok) return null;
        const body = await response.json();
        return typeof body.code === "string" ? body.code : null;
      } catch {
        return null;
      }
    }

    async load() {
      const code = await this.code();
      if (!code || !this.frame) return this.dispatchEvent(new CustomEvent("corvo-expired"));
      const params = new URLSearchParams({ code, theme: this.getAttribute("theme") || "auto" });
      const locale = this.getAttribute("locale") || navigator.language;
      if (locale) params.set("locale", locale);
      const accent = this.getAttribute("accent");
      if (accent) params.set("accent", accent);
      this.frame.src = `${this.origin}/embed#${params}`;
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
      if (type === "corvo:ready") this.dispatchEvent(new CustomEvent("corvo-ready"));
      if (type === "corvo:refresh") {
        void this.code().then((code) => {
          if (code) this.send({ type: "corvo:code", code });
          else this.dispatchEvent(new CustomEvent("corvo-expired"));
        });
      }
      const data = event.data || {};
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
        this.dispatchEvent(
          new CustomEvent("corvo-unread", {
            detail: { count: Math.max(0, Math.floor(data.count)) },
          }),
        );
      }
      if (type === "corvo:expired") {
        this.dispatchEvent(new CustomEvent("corvo-expired"));
        void this.load();
      }
    }
  }

  customElements.define("corvo-assistant", CorvoAssistant);
})();
