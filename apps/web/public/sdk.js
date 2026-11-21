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
// length such as 12px), font-family (default: inherited from your page), context (JSON, see
// setContext), shortcut (off to turn the Cmd/Ctrl+J key off), consultations (turns on the in-panel
// "Record consultation" bar, see setConsultation). Both modes: name (what your product calls the
// assistant: the panel title and the frame's own label; default "Assistant"), icon (an https image
// for it; default none, the Rook mark is never shown), user-name (what the signed-in person is
// called, for the greeting and their messages; default none).
//
// Headless AI in your own screens, from this same file: Rook.configure({ sessionUrl, origin,
// getToken }), Rook.ask({ preset | task, schema, context, onText }) and Rook.recorder({ ... })
// (see the "AI in your own screens" docs). When a <corvo-assistant> is on the page, they sign in
// through it (its session-url, origin and one shared token); without one, with a session of their
// own from the sessionUrl you configure. sdk-assist.js remains as an alias that loads this file.
//
// Methods: setContext({ page, title, entities: [{ type, id, label, path? }], suggestions? }),
// registerActions([{ name, description, params, confirm }]), resolveAction(id, result),
// setSuggestions([text | { label, path }]), setConsultation({ clientId, appointmentId, clientName,
// professionalName, preset | schema }), resolveConsultation({ path, label }), open(), close(),
// toggle().
//
// Events (on the element): corvo-ready, corvo-expired, corvo-checkout { url } (the customer
// tapped "Buy more": cancel it with preventDefault() to handle it yourself, otherwise the address
// opens in a new tab of the top window), corvo-navigate { path } (open that place in your product,
// such as a recording screen), corvo-unread { count } (badge your own menu); launcher mode adds
// corvo-open, corvo-close, corvo-unavailable { reason } (the assistant cannot be offered; the
// launcher hides itself) and corvo-action { name, params, id } (the customer confirmed an action
// you registered: do it, then call resolveAction(id, result)) and corvo-consultation
// { consultationId, clientId, appointmentId, note, transcript } (the draft of a recorded
// consultation is ready: save it in your record, then call resolveConsultation({ path }) so the
// panel can link to it).
(() => {
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

  // ---- Headless assist: Rook.ask and Rook.recorder --------------------------------------------
  function installAssist() {
    window.Rook = window.Rook || {};
    const Rook = window.Rook;
    // A stub left by the sdk-assist.js alias, which waits for this file, does not count.
    if (Rook.ask && !Rook.ask.stub) return;
    const settings = { sessionUrl: null, origin: null, getToken: null, lang: null };
    let cached = null;

    /** `sessionUrl`, `origin` (where Rook runs; default: where this file came from), `getToken`, `lang`. */
    Rook.configure = (options = {}) => {
      Object.assign(settings, options);
      cached = null;
    };

    // What each failure says to the person using your product, by `error.code`. The administrator
    // is told about configuration problems; the person is never asked to fix them.
    const UNAVAILABLE = {
      en: "The assistant is unavailable right now. We told the administrator.",
      "pt-BR": "O assistente est\u00e1 indispon\u00edvel agora. Avisamos o administrador.",
      es: "El asistente no est\u00e1 disponible ahora. Avisamos al administrador.",
    };
    const ERRORS = {
      en: {
        permission_denied:
          "Microphone permission was denied. Open the site settings in your browser (the icon next to the address), allow the microphone and try again.",
        permission_blocked:
          "Your browser blocks the microphone on this site. Open the site settings (the icon next to the address), allow the microphone and reload the page.",
        no_microphone: "No microphone found. Connect one and try again.",
        microphone_busy: "Another app is using the microphone. Close it and try again.",
        insecure_context: "The microphone only works on secure (HTTPS) pages.",
        unsupported_browser:
          "This browser can't record audio. Use a recent Chrome, Edge, Firefox or Safari.",
        consent_missing: "Record the patient's consent before recording.",
        network_error: "Can't reach the server. Check the connection and try again.",
        upload_failed: "Couldn't upload the audio. Check the connection and try again.",
        unauthorized: "The session expired. Reload the page and try again.",
        session_failed: "Couldn't open the session. Reload the page and try again.",
        no_session: "Couldn't open the session. Reload the page and try again.",
        forbidden: "This access can't record consultations.",
        not_found: "This recording was not found. Start a new one.",
        too_long: "The consultation passed the maximum recording length.",
        too_large: "The audio is too large to upload.",
        invalid_request: "Couldn't start the recording. Reload the page and try again.",
        unsupported_audio: "This audio format is not supported.",
        too_many_requests: "Too many attempts. Wait a moment and try again.",
        server_error: "The service is having trouble. Try again in a moment.",
        no_audio: "No audio was recorded.",
        no_speech: "No speech could be heard in the recording.",
        transcription_failed: "Couldn't transcribe the audio. Try again.",
        processing_failed: "Couldn't generate the draft. Try again.",
        timeout: "Processing took too long. Try again.",
        recorder_failed: "The recording was interrupted. Try again.",
        failed: "Couldn't record. Try again.",
      },
      "pt-BR": {
        permission_denied:
          "A permiss\u00e3o do microfone foi negada. Abra as configura\u00e7\u00f5es do site no navegador (o \u00edcone ao lado do endere\u00e7o), permita o microfone e tente de novo.",
        permission_blocked:
          "O navegador bloqueou o microfone neste site. Abra as configura\u00e7\u00f5es do site (o \u00edcone ao lado do endere\u00e7o), permita o microfone e recarregue a p\u00e1gina.",
        no_microphone: "Nenhum microfone encontrado. Conecte um e tente de novo.",
        microphone_busy: "Outro aplicativo est\u00e1 usando o microfone. Feche-o e tente de novo.",
        insecure_context: "O microfone s\u00f3 funciona em p\u00e1ginas seguras (HTTPS).",
        unsupported_browser:
          "Este navegador n\u00e3o consegue gravar \u00e1udio. Use uma vers\u00e3o recente do Chrome, Edge, Firefox ou Safari.",
        consent_missing: "Registre o consentimento do paciente antes de gravar.",
        network_error: "Sem conex\u00e3o com o servidor. Verifique a internet e tente de novo.",
        upload_failed:
          "N\u00e3o foi poss\u00edvel enviar o \u00e1udio. Verifique a internet e tente de novo.",
        unauthorized: "A sess\u00e3o expirou. Recarregue a p\u00e1gina e tente de novo.",
        session_failed:
          "N\u00e3o foi poss\u00edvel abrir a sess\u00e3o. Recarregue a p\u00e1gina e tente de novo.",
        no_session:
          "N\u00e3o foi poss\u00edvel abrir a sess\u00e3o. Recarregue a p\u00e1gina e tente de novo.",
        forbidden: "Este acesso n\u00e3o permite gravar consultas.",
        not_found: "Esta grava\u00e7\u00e3o n\u00e3o foi encontrada. Comece uma nova.",
        too_long: "A consulta passou do tempo m\u00e1ximo de grava\u00e7\u00e3o.",
        too_large: "O \u00e1udio ficou grande demais para enviar.",
        invalid_request:
          "N\u00e3o foi poss\u00edvel iniciar a grava\u00e7\u00e3o. Recarregue a p\u00e1gina e tente de novo.",
        unsupported_audio: "Este formato de \u00e1udio n\u00e3o \u00e9 aceito.",
        too_many_requests: "Muitas tentativas. Espere um instante e tente de novo.",
        server_error: "O servi\u00e7o est\u00e1 inst\u00e1vel. Tente de novo em instantes.",
        no_audio: "Nenhum \u00e1udio foi gravado.",
        no_speech: "N\u00e3o foi poss\u00edvel ouvir fala na grava\u00e7\u00e3o.",
        transcription_failed: "N\u00e3o foi poss\u00edvel transcrever o \u00e1udio. Tente de novo.",
        processing_failed: "N\u00e3o foi poss\u00edvel gerar o rascunho. Tente de novo.",
        timeout: "O processamento demorou demais. Tente de novo.",
        recorder_failed: "A grava\u00e7\u00e3o foi interrompida. Tente de novo.",
        failed: "N\u00e3o foi poss\u00edvel gravar. Tente de novo.",
      },
      es: {
        permission_denied:
          "Se neg\u00f3 el permiso del micr\u00f3fono. Abre la configuraci\u00f3n del sitio en el navegador (el icono junto a la direcci\u00f3n), permite el micr\u00f3fono e int\u00e9ntalo de nuevo.",
        permission_blocked:
          "El navegador bloquea el micr\u00f3fono en este sitio. Abre la configuraci\u00f3n del sitio (el icono junto a la direcci\u00f3n), permite el micr\u00f3fono y recarga la p\u00e1gina.",
        no_microphone:
          "No se encontr\u00f3 ning\u00fan micr\u00f3fono. Conecta uno e int\u00e9ntalo de nuevo.",
        failed: "No se pudo grabar. Int\u00e9ntalo de nuevo.",
      },
    };
    // Codes where the cause is the account's setup, not the person's: they see one neutral line.
    const UNAVAILABLE_CODES = [
      "transcription_unavailable",
      "credit_exhausted",
      "allowance_exhausted",
      "no_model",
      "model_unpriced",
      "model_credits_empty",
      "access_inactive",
    ];
    const langTable = (table, lang) => {
      const tag = String(lang || "").toLowerCase();
      if (tag.startsWith("pt")) return table["pt-BR"];
      return table[tag.slice(0, 2)] || table.en;
    };
    /** The sentence for a failure code in a language (default: the browser's). */
    const errorMessage = (code, lang) => {
      const language = lang || settings.lang || navigator.language;
      if (UNAVAILABLE_CODES.includes(code)) return langTable(UNAVAILABLE, language);
      return (
        langTable(ERRORS, language)[code] || ERRORS.en[code] || langTable(ERRORS, language).failed
      );
    };

    class RookError extends Error {
      constructor(code, status, lang) {
        super(errorMessage(code, lang));
        this.name = "RookError";
        this.code = code;
        this.status = status;
      }
    }
    Rook.RookError = RookError;
    Rook.errorMessage = errorMessage;

    const origin = () => {
      const element = document.querySelector("corvo-assistant");
      return (settings.origin || element?.getAttribute("origin") || scriptOrigin || "").replace(
        /\/+$/,
        "",
      );
    };

    /** A bearer token for the customer's session, from your backend's code. */
    async function token(force = false) {
      if (settings.getToken) return settings.getToken(force);
      // A <corvo-assistant> on the page shares its session with these calls.
      const element = document.querySelector("corvo-assistant");
      if (element && typeof element.getToken === "function") return element.getToken(force);
      if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
      const url =
        settings.sessionUrl ||
        document.querySelector("corvo-assistant")?.getAttribute("session-url");
      if (!url) throw new RookError("no_session", 0);
      const response = await fetch(url, { method: "POST", credentials: "same-origin" }).catch(
        () => {
          throw new RookError("network_error", 0);
        },
      );
      const { code } = response.ok ? await response.json().catch(() => ({})) : {};
      if (typeof code !== "string") throw new RookError("session_failed", response.status);
      const exchange = await fetch(`${origin()}/api/partner/embed/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => {
        throw new RookError("network_error", 0);
      });
      const body = exchange.ok ? await exchange.json() : {};
      if (typeof body.token !== "string") throw new RookError("session_failed", exchange.status);
      cached = {
        token: body.token,
        expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : Date.now() + 10 * 60_000,
      };
      return cached.token;
    }

    /** One authenticated call; a refused token is renewed once. */
    async function call(path, init = {}) {
      for (const force of [false, true]) {
        const bearer = await token(force);
        const response = await fetch(`${origin()}${path}`, {
          ...init,
          headers: { ...(init.headers || {}), authorization: `Bearer ${bearer}` },
        }).catch(() => {
          throw new RookError("network_error", 0);
        });
        if (response.status !== 401 || force) return response;
      }
      throw new RookError("unauthorized", 401);
    }

    const BY_STATUS = {
      400: "invalid_request",
      401: "unauthorized",
      402: "allowance_exhausted",
      403: "forbidden",
      404: "not_found",
      413: "too_large",
      415: "unsupported_audio",
      429: "too_many_requests",
    };
    /** A refused call as an error: the server's own code, else one for its status. */
    async function failure(response) {
      const body = await response.json().catch(() => ({}));
      const given = typeof body.error === "string" && /^[a-z][a-z0-9_]*$/.test(body.error);
      const code = given
        ? body.error
        : BY_STATUS[response.status] || (response.status >= 500 ? "server_error" : "failed");
      return new RookError(code, response.status);
    }

    /** Reads server-sent events from a response, one { event, data } at a time. */
    async function* events(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end = buffer.indexOf("\n\n");
        while (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          yield { event, data: data ? JSON.parse(data) : {} };
          end = buffer.indexOf("\n\n");
        }
      }
    }

    /**
     * Asks for one task and resolves with the validated result.
     * `{ preset }` names a task of your template, or give `{ task, schema, instructions }` yourself;
     * `context` is your page's data (treated as data, never as instructions). `onText` receives the
     * answer's text as it is written; `schema` is a JSON Schema whose root is an object, and without
     * one the result is `{ text }`. Rejects with a RookError whose `code` is one of: unknown_preset,
     * invalid_schema, invalid_output, allowance_exhausted, model_failed, no_model, access_inactive.
     */
    Rook.ask = async (options = {}) => {
      const { onText, ...input } = options;
      const stream = typeof onText === "function";
      const response = await call("/api/partner/embed/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, ...(stream ? { stream: true } : {}) }),
      });
      if (!response.ok) throw await failure(response);
      if (!stream) return response.json();
      let text = "";
      for await (const { event, data } of events(response)) {
        if (event === "retry") text = "";
        if (event === "delta" && typeof data.text === "string") {
          text += data.text;
          onText(data.text, text);
        }
        if (event === "result") return data;
        if (event === "error") throw new RookError(data.error || "failed", 0);
      }
      throw new RookError("failed", 0);
    };

    /**
     * Carries out the actions of a drafted consultation that the professional approved, through
     * your connector. `edits` maps an action id to the fields they corrected, such as
     * `{ a1: { startsAt: "2026-12-08T14:00:00-03:00" } }`. Resolves `{ actions }`, each with a
     * `status` of applied, failed (with `error`) or skipped. Nothing runs without this call, and
     * asking again for an applied action does not repeat it.
     */
    Rook.applyConsultationActions = async (consultationId, actionIds, edits) => {
      const response = await call(
        `/api/partner/embed/consultations/${encodeURIComponent(consultationId)}/actions/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionIds, ...(edits ? { edits } : {}) }),
        },
      );
      if (!response.ok) throw await failure(response);
      return response.json();
    };

    const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * A recorder for the visit, inside your own form. States, in `onState`: idle, requesting,
     * recording, paused, uploading, processing, done, error. `onTranscript({ text, final, source })`
     * carries a live caption from the browser (when it can) and, at the end, the transcript Rook
     * wrote (`source: "server"`, with `turns`). `onResult(result, { transcript, consultationId })`
     * receives the fields of your schema, plus `actions` (what the visit agreed to do next, each
     * `proposed`); `meta.actions` has the same list. When there are actions the recording is kept
     * for `applyConsultationActions` even without `keep`, until you call `discard()` or retention
     * ends it. Pass `consent` as `{ method: "verbal" | "written" }` or a function that asks the
     * patient and returns that (or false to stop). `onError(error)` gets a
     * RookError: `error.code` says what to do (permission_denied, permission_blocked,
     * no_microphone, microphone_busy, unsupported_browser, consent_missing, network_error,
     * upload_failed, unauthorized, too_long, too_large, transcription_unavailable, ...) and
     * `error.message` is a sentence for the person, in `lang`.
     */
    Rook.recorder = (options = {}) => {
      const {
        clientId,
        appointmentId,
        professionalName,
        clientName,
        preset,
        task,
        schema,
        instructions,
        consent,
        onState,
        onTranscript,
        onResult,
        onError,
        onPermission,
        keep = false,
        chunkMs = 10_000,
        pollMs = 2000,
        pollLimit = 300,
        retryMs = 500,
        lang,
      } = options;
      const mediaDevices = options.mediaDevices || navigator.mediaDevices;
      const Recorder = options.MediaRecorder || window.MediaRecorder;
      const Speech =
        options.SpeechRecognition || window.SpeechRecognition || window.webkitSpeechRecognition;

      let state = "idle";
      let stream = null;
      let media = null;
      let speech = null;
      let consultationId = null;
      let seq = 0;
      let uploads = Promise.resolve();
      let failed = null;
      let finished = null;
      const set = (next) => {
        state = next;
        onState?.(next);
      };
      const fail = (error) => {
        // Said in the recorder's language, with the code the page can act on.
        if (error instanceof RookError && lang) error.message = errorMessage(error.code, lang);
        failed = failed || error;
        cleanup();
        set("error");
        onError?.(error);
      };
      const cleanup = () => {
        try {
          speech?.stop();
        } catch {}
        speech = null;
        for (const track of stream?.getTracks?.() || []) track.stop();
        stream = null;
      };

      const upload = (blob, number) => {
        uploads = uploads.then(async () => {
          if (failed) return;
          for (let attempt = 0; ; attempt++) {
            try {
              const response = await call(
                `/api/partner/embed/consultations/${consultationId}/chunks/${number}`,
                {
                  method: "PUT",
                  headers: { "content-type": blob.type || "audio/webm" },
                  body: blob,
                },
              );
              if (response.ok) return;
              const error = await failure(response);
              // A refusal that will not change is final; anything else is tried again.
              if (response.status < 500 && response.status !== 429) throw error;
              if (attempt >= 2) throw error;
            } catch (error) {
              if (
                error instanceof RookError &&
                error.status &&
                error.status < 500 &&
                error.status !== 429
              ) {
                return fail(error);
              }
              if (attempt >= 2) return fail(new RookError("upload_failed", 0, lang));
            }
            await wait(retryMs * (attempt + 1));
          }
        });
      };

      const startCaptions = () => {
        if (!Speech || !onTranscript) return;
        try {
          speech = new Speech();
          speech.continuous = true;
          speech.interimResults = true;
          speech.lang = lang || navigator.language || "pt-BR";
          speech.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const part = event.results[i];
              onTranscript({ text: part[0].transcript, final: part.isFinal, source: "browser" });
            }
          };
          speech.onerror = () => {};
          speech.start();
        } catch {
          speech = null;
        }
      };

      // The codes the server reports for a failed consultation; any other is a failed draft.
      const KNOWN_PROCESSING = [
        "no_audio",
        "no_speech",
        "transcription_failed",
        "transcription_unavailable",
        "credit_exhausted",
      ];
      const processingCode = (code) =>
        KNOWN_PROCESSING.includes(code) ? code : "processing_failed";

      /** Why the microphone was refused, as a code the page and the person can act on. */
      const microphoneCode = async (error) => {
        const name = error && error.name;
        if (
          name === "NotFoundError" ||
          name === "DevicesNotFoundError" ||
          name === "OverconstrainedError"
        )
          return "no_microphone";
        if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
          return "microphone_busy";
        if (name === "SecurityError") return "permission_blocked";
        // Blocked in the site settings (no prompt can appear) versus dismissed this time; a
        // refusal with no known name is read the same way.
        try {
          const status = await navigator.permissions?.query({ name: "microphone" });
          if (status?.state === "denied") return "permission_blocked";
        } catch {}
        return "permission_denied";
      };

      const poll = async () => {
        for (let i = 0; i < pollLimit; i++) {
          const response = await call(`/api/partner/embed/consultations/${consultationId}`);
          if (!response.ok) throw await failure(response);
          const status = await response.json();
          if (status.state === "drafted") return status;
          if (status.state === "failed") throw new RookError(processingCode(status.error?.code), 0);
          await wait(pollMs);
        }
        throw new RookError("timeout", 0);
      };

      const mimeTypeOrNull = () => {
        if (typeof Recorder !== "function") return null;
        if (typeof Recorder.isTypeSupported !== "function") return "";
        return PREFERRED_TYPES.find((type) => Recorder.isTypeSupported(type)) || null;
      };

      const api = {
        get state() {
          return state;
        },
        get consultationId() {
          return consultationId;
        },

        async start() {
          if (state !== "idle" && state !== "done" && state !== "error") return;
          failed = null;
          seq = 0;
          uploads = Promise.resolve();
          set("requesting");
          try {
            if (consent === undefined || consent === null)
              throw new RookError("consent_missing", 0, lang);
            const given = typeof consent === "function" ? await consent() : consent;
            // The person answered no (or closed the question): nothing to report.
            if (given === false || given === null || given === undefined) {
              set("idle");
              return;
            }
            if (!given.method) throw new RookError("consent_missing", 0, lang);
            if (window.isSecureContext === false) throw new RookError("insecure_context", 0, lang);
            if (!mediaDevices?.getUserMedia || mimeTypeOrNull() === null)
              throw new RookError("unsupported_browser", 0, lang);
            onPermission?.("requesting");
            try {
              stream = await mediaDevices.getUserMedia({ audio: true });
            } catch (error) {
              const code = await microphoneCode(error);
              if (code === "permission_denied" || code === "permission_blocked")
                onPermission?.("denied");
              throw new RookError(code, 0, lang);
            }
            onPermission?.("granted");
            const output = {
              ...(preset ? { preset } : {}),
              ...(task ? { task } : {}),
              ...(schema ? { schema } : {}),
              ...(instructions ? { instructions } : {}),
            };
            const created = await call("/api/partner/embed/consultations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                template: "structured",
                context: {
                  clientId,
                  ...(appointmentId ? { appointmentId } : {}),
                  ...(professionalName ? { professionalName } : {}),
                  ...(clientName ? { clientName } : {}),
                  output,
                },
                consent: {
                  obtained: true,
                  at: given.at || new Date().toISOString(),
                  method: given.method,
                },
              }),
            });
            if (!created.ok) throw await failure(created);
            consultationId = (await created.json()).consultationId;
            const mimeType = mimeTypeOrNull();
            try {
              media = new Recorder(stream, mimeType ? { mimeType } : undefined);
            } catch {
              throw new RookError("unsupported_browser", 0, lang);
            }
            media.ondataavailable = (event) => {
              if (event.data && event.data.size > 0) upload(event.data, seq++);
            };
            media.onerror = () => fail(new RookError("recorder_failed", 0, lang));
            media.start(chunkMs);
            startCaptions();
            set("recording");
          } catch (error) {
            fail(error instanceof RookError ? error : new RookError("failed", 0, lang));
          }
        },

        pause() {
          if (state !== "recording") return;
          media.pause();
          try {
            speech?.stop();
          } catch {}
          set("paused");
        },

        resume() {
          if (state !== "paused") return;
          media.resume();
          startCaptions();
          set("recording");
        },

        /** Stops, uploads what is left and resolves when the result has been handed to `onResult`. */
        stop() {
          if (state !== "recording" && state !== "paused") return finished || Promise.resolve();
          set("uploading");
          finished = (async () => {
            try {
              await new Promise((resolve) => {
                media.onstop = resolve;
                media.stop();
              });
              cleanup();
              await uploads;
              if (failed) return;
              const finish = await call(
                `/api/partner/embed/consultations/${consultationId}/finish`,
                {
                  method: "POST",
                },
              );
              if (!finish.ok) throw await failure(finish);
              set("processing");
              const status = await poll();
              const transcript = status.transcript || [];
              onTranscript?.({
                text: transcript.map((turn) => turn.text).join(" "),
                final: true,
                source: "server",
                turns: transcript,
              });
              const actions = Array.isArray(status.actions) ? status.actions : null;
              onResult?.(actions ? { ...(status.note || {}), actions } : status.note || {}, {
                transcript,
                consultationId,
                ...(actions ? { actions } : {}),
              });
              set("done");
              // Applying actions needs the consultation, so one with actions is not deleted here.
              if (!keep && !(actions && actions.length > 0)) await api.discard();
            } catch (error) {
              if (!failed)
                fail(error instanceof RookError ? error : new RookError("failed", 0, lang));
            }
          })();
          return finished;
        },

        /** Stops without a result and deletes what was recorded. */
        async cancel() {
          try {
            if (media && (state === "recording" || state === "paused")) media.stop();
          } catch {}
          failed = failed || new RookError("cancelled", 0);
          cleanup();
          await uploads.catch(() => {});
          await api.discard();
          set("idle");
        },

        /** Applies approved actions of this recording; see `Rook.applyConsultationActions`. */
        applyConsultationActions(actionIds, edits) {
          const id = consultationId;
          if (!id) return Promise.reject(new RookError("no_consultation", 0));
          return Rook.applyConsultationActions(id, actionIds, edits);
        },

        /** Deletes the recording, transcript and result held by Rook. */
        async discard() {
          if (!consultationId) return;
          const id = consultationId;
          consultationId = null;
          await call(`/api/partner/embed/consultations/${id}`, { method: "DELETE" }).catch(
            () => {},
          );
        },
      };
      return api;
    };
  }
  installAssist();

  // ---- What the page tells the assistant -------------------------------------------------------
  const limit = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
  const ACTION_NAME = /^[a-z][a-z0-9_.-]{0,39}$/;
  const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;
  const PARAM_TYPES = ["string", "number", "integer", "boolean"];

  /**
   * A suggestion is a line to ask the assistant (a string, or `{ label }`), or a place in your
   * product (`{ label, path }`): that one opens the place itself and never reaches the model.
   */
  function cleanSuggestion(item) {
    const label = limit(typeof item === "string" ? item : item && item.label, 80).trim();
    if (!label) return null;
    return item && typeof item === "object" && isPath(item.path)
      ? { label, path: item.path }
      : { label };
  }
  const cleanSuggestions = (list) =>
    (Array.isArray(list) ? list : []).map(cleanSuggestion).filter(Boolean).slice(0, 4);
  const OPEN_COPY = {
    en: "Open %s",
    "pt-BR": "Abrir %s",
    es: "Abrir %s",
    fr: "Ouvrir %s",
    de: "%s \u00f6ffnen",
    ja: "%s\u3092\u958b\u304f",
    "zh-CN": "\u6253\u5f00%s",
  };
  const strip = (path) => String(path).split(/[?#]/)[0].replace(/\/+$/, "") || "/";

  /** Keeps only what the assistant may be told: short strings, a few entities. */
  function cleanContext(value) {
    if (!value || typeof value !== "object") return null;
    const entities = (Array.isArray(value.entities) ? value.entities : [])
      .slice(0, 5)
      .flatMap((entity) => {
        const type = entity && /^[a-z][a-z0-9_-]{0,31}$/i.test(entity.type) ? entity.type : "";
        const id = limit(entity && String(entity.id ?? ""), 64);
        const label = limit(entity && entity.label, 120);
        // `path` is where your product shows it; it stays in the page and is never sent.
        return type && id && label
          ? [{ type, id, label, ...(isPath(entity.path) ? { path: entity.path } : {}) }]
          : [];
      });
    const page = limit(value.page, 200);
    const title = limit(value.title, 120);
    const suggestions = cleanSuggestions(value.suggestions);
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
  // The recording bar's words: [record, consent question, verbal, written, cancel, pause, resume,
  // stop, generating, ready, open draft, failed, microphone blocked, try again, recording].
  const REC_COPY = {
    en: [
      "Record consultation",
      "Did the patient agree to be recorded?",
      "Yes, verbally",
      "Yes, in writing",
      "Cancel",
      "Pause",
      "Resume",
      "Stop",
      "Generating draft\u2026",
      "Draft ready",
      "Open draft",
      "Couldn't record. Try again.",
      "Allow the microphone to record.",
      "Try again",
      "Recording",
    ],
    "pt-BR": [
      "Gravar consulta",
      "O paciente autorizou a gravação?",
      "Sim, verbalmente",
      "Sim, por escrito",
      "Cancelar",
      "Pausar",
      "Retomar",
      "Parar",
      "Gerando rascunho\u2026",
      "Rascunho pronto",
      "Abrir rascunho",
      "Não foi possível gravar. Tente de novo.",
      "Permita o microfone para gravar.",
      "Tentar de novo",
      "Gravando",
    ],
    es: [
      "Grabar consulta",
      "¿El paciente autorizó la grabación?",
      "Sí, verbalmente",
      "Sí, por escrito",
      "Cancelar",
      "Pausar",
      "Reanudar",
      "Detener",
      "Generando borrador\u2026",
      "Borrador listo",
      "Abrir borrador",
      "No se pudo grabar. Inténtalo de nuevo.",
      "Permite el micrófono para grabar.",
      "Reintentar",
      "Grabando",
    ],
    fr: [
      "Enregistrer la consultation",
      "Le patient a-t-il accepté l'enregistrement ?",
      "Oui, oralement",
      "Oui, par écrit",
      "Annuler",
      "Pause",
      "Reprendre",
      "Arrêter",
      "Génération du brouillon\u2026",
      "Brouillon prêt",
      "Ouvrir le brouillon",
      "Enregistrement impossible. Réessayez.",
      "Autorisez le micro pour enregistrer.",
      "Réessayer",
      "Enregistrement",
    ],
    de: [
      "Konsultation aufnehmen",
      "Hat der Patient der Aufnahme zugestimmt?",
      "Ja, mündlich",
      "Ja, schriftlich",
      "Abbrechen",
      "Pause",
      "Fortsetzen",
      "Stopp",
      "Entwurf wird erstellt\u2026",
      "Entwurf fertig",
      "Entwurf öffnen",
      "Aufnahme nicht möglich. Versuche es erneut.",
      "Erlaube das Mikrofon für die Aufnahme.",
      "Erneut versuchen",
      "Aufnahme läuft",
    ],
    ja: [
      "診察を録音",
      "患者は録音に同意しましたか？",
      "はい（口頭）",
      "はい（書面）",
      "キャンセル",
      "一時停止",
      "再開",
      "停止",
      "下書きを作成中\u2026",
      "下書きができました",
      "下書きを開く",
      "録音できませんでした。もう一度お試しください。",
      "録音するにはマイクを許可してください。",
      "再試行",
      "録音中",
    ],
    "zh-CN": [
      "录制问诊",
      "患者是否同意录音？",
      "是，口头同意",
      "是，书面同意",
      "取消",
      "暂停",
      "继续",
      "停止",
      "正在生成草稿\u2026",
      "草稿已就绪",
      "打开草稿",
      "无法录音，请重试。",
      "请允许使用麦克风以录音。",
      "重试",
      "录音中",
    ],
  };
  const recCopyFor = (locale) => {
    const tag = String(locale || "").toLowerCase();
    if (tag.startsWith("pt")) return REC_COPY["pt-BR"];
    if (tag.startsWith("zh")) return REC_COPY["zh-CN"];
    return REC_COPY[tag.slice(0, 2)] || REC_COPY.en;
  };
  const copyKey = (locale) => {
    const tag = String(locale || "").toLowerCase();
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("zh")) return "zh-CN";
    return OPEN_COPY[tag.slice(0, 2)] ? tag.slice(0, 2) : "en";
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
.rec{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-block-end:1px solid var(--line);background:var(--soft)}
.rec .grow{flex:1;min-width:0}
.rec .ask{flex-basis:100%;font-weight:600}
.rec .note{color:var(--muted);font-size:13px}
.rec .time{font-variant-numeric:tabular-nums;font-weight:600}
.rec .dot{width:8px;height:8px;border-radius:999px;background:#dc2626;animation:pulse 1.4s ease-in-out infinite}
.rec[data-phase=paused] .dot{animation:none;background:var(--muted)}
.btn{border:1px solid var(--line);background:var(--bg);border-radius:var(--radius);padding:7px 12px;font-weight:500}
.btn:hover{background:var(--soft)}
.btn.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.btn.primary:hover{opacity:.92}
.fab[data-rec=true]{box-shadow:0 0 0 3px #dc2626,var(--shadow)}
.body{position:relative;flex:1;min-height:0}
.body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;opacity:0;transition:opacity .15s}
.body[data-ready=true] iframe{opacity:1}
.skeleton{position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:12px;pointer-events:none}
.body[data-ready=true] .skeleton{display:none}
.bar{border-radius:var(--radius);background:var(--soft);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.bar,.rec .dot{animation:none}.panel,.fab{transition:none}}
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
      return [
        "theme",
        "locale",
        "accent",
        "context",
        "dock",
        "radius",
        "font-family",
        "name",
        "icon",
        "user-name",
        "consultations",
      ];
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
      this.frame.title =
        this.getAttribute("name") || copyFor(this.getAttribute("locale") || navigator.language)[5];
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
      clearInterval(this.recTimer);
      void this.recorder?.cancel?.();
      this.frame?.remove();
      this.frame = null;
      this.root = null;
      this.shadowRoot?.replaceChildren();
    }

    attributeChangedCallback(name, _old, value) {
      if (name === "context") return this.setContext(this.parseContextAttribute(value));
      if (
        this.root &&
        [
          "dock",
          "radius",
          "font-family",
          "name",
          "accent",
          "theme",
          "locale",
          "consultations",
        ].includes(name)
      ) {
        this.paint();
      }
      if (["theme", "locale", "accent", "name", "icon", "user-name"].includes(name)) {
        this.send({
          type: "corvo:config",
          theme: this.getAttribute("theme") || "auto",
          locale: this.getAttribute("locale") || undefined,
          accent: this.getAttribute("accent") || undefined,
          ...this.brand(),
        });
      }
    }

    /** What your product calls the assistant and the signed-in person; Rook's own name never shows. */
    brand() {
      return {
        assistant: this.getAttribute("name") || undefined,
        icon: isHttps(this.getAttribute("icon")) ? this.getAttribute("icon") : undefined,
        user: this.getAttribute("user-name") || undefined,
      };
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
      this.paintRecorder();
    }

    sendContext() {
      const context = this.pageContext;
      this.send({
        type: "corvo:context",
        context: context
          ? {
              page: context.page || undefined,
              title: context.title || undefined,
              entities: context.entities.map(({ type, id, label }) => ({ type, id, label })),
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
      this.suggestions = cleanSuggestions(list);
      this.paintPopover();
    }

    /** Whether a place is the screen the person is already on. */
    isHere(path) {
      const here = [this.pageContext?.page, location.pathname].filter(isPath).map(strip);
      return here.includes(strip(path));
    }

    /**
     * What the popover offers: your suggestions, else a shortcut to each entity of the page that
     * has a place of its own, else your actions. Never the screen the person is already on.
     */
    suggestionList() {
      const explicit = this.suggestions?.length ? this.suggestions : this.pageContext?.suggestions;
      let list = explicit || [];
      if (!list.length) {
        const open = OPEN_COPY[copyKey(this.getAttribute("locale") || navigator.language)];
        list = (this.pageContext?.entities || [])
          .filter((entity) => entity.path)
          .map((entity) => ({ label: open.replace("%s", entity.label), path: entity.path }));
      }
      if (!list.length) {
        list = [...this.actions.values()]
          .map((action) => action.description)
          .filter(Boolean)
          .slice(0, 3)
          .map((label) => ({ label }));
      }
      return list.filter((item) => !item.path || !this.isHere(item.path));
    }

    // ---- Consultation recorder (launcher panel) ------------------------------------------------

    /**
     * Who is being seen: `{ clientId, appointmentId, clientName, professionalName, preset | task |
     * schema, instructions, lang }`. Without it, the page context's `client` (or `patient`) and
     * `appointment` entities are used. The bar shows only with the `consultations` attribute and a
     * client; pass null to clear it.
     */
    setConsultation(options) {
      this.consultationOptions = options && typeof options === "object" ? options : null;
      this.paintRecorder();
    }

    /** Where the draft lives in your record: `{ path, label? }`, shown as "Open draft". */
    resolveConsultation(link) {
      // The page usually answers the event while the draft is still being handed over.
      if (!this.rec || !["processing", "done"].includes(this.rec.phase)) return;
      this.rec.path = link && isPath(link.path) ? link.path : null;
      this.paintRecorder();
    }

    consultationTarget() {
      if (!this.hasAttribute("consultations")) return null;
      const given = this.consultationOptions || {};
      const entity = (types) =>
        this.pageContext?.entities.find((item) => types.includes(item.type.toLowerCase()));
      const client = entity(["client", "patient"]);
      const appointment = entity(["appointment"]);
      const clientId = limit(String(given.clientId ?? client?.id ?? ""), 64);
      if (!clientId) return null;
      return {
        clientId,
        appointmentId: limit(String(given.appointmentId ?? appointment?.id ?? ""), 64) || undefined,
        clientName: limit(given.clientName ?? client?.label, 120) || undefined,
        professionalName: limit(given.professionalName, 120) || undefined,
        preset: given.preset,
        task: given.task,
        schema: given.schema,
        instructions: given.instructions,
        lang: given.lang,
      };
    }

    /** The first step: the professional says whether the patient agreed, and how. */
    startConsultation() {
      if (!this.consultationTarget() || !["idle", "done", "error"].includes(this.rec.phase)) return;
      this.rec = { phase: "consent", seconds: 0, path: null, error: null };
      this.paintRecorder();
    }

    /** Nothing is recorded, and the microphone is not asked for, until this is called. */
    async confirmConsent(method) {
      const target = this.consultationTarget();
      if (this.rec.phase !== "consent" || !target) return;
      if (method !== "verbal" && method !== "written") return;
      this.rec = { phase: "starting", seconds: 0, path: null, error: null };
      this.paintRecorder();
      const phases = {
        recording: "recording",
        paused: "paused",
        uploading: "processing",
        processing: "processing",
        done: "done",
        idle: "idle",
        error: "error",
      };
      this.recorder = window.Rook.recorder({
        ...target,
        consent: { method, at: new Date().toISOString() },
        lang: target.lang || this.getAttribute("locale") || undefined,
        onState: (state) => {
          const phase = phases[state];
          if (!phase) return;
          this.rec.phase = phase;
          clearInterval(this.recTimer);
          if (phase === "recording") {
            this.recTimer = setInterval(() => {
              this.rec.seconds += 1;
              this.paintRecorder();
            }, 1000);
          }
          this.paintRecorder();
        },
        onResult: (result, meta) => {
          const { actions, ...note } = result;
          this.dispatchEvent(
            new CustomEvent("corvo-consultation", {
              detail: {
                consultationId: meta.consultationId,
                clientId: target.clientId,
                appointmentId: target.appointmentId,
                note,
                transcript: meta.transcript,
                ...(actions ? { actions } : {}),
              },
            }),
          );
        },
        onError: (error) => {
          this.rec.error = error ? { code: error.code, message: error.message } : null;
          // The page can log it or show its own words; the panel shows the sentence below.
          this.dispatchEvent(
            new CustomEvent("corvo-consultation-error", {
              detail: {
                code: error && error.code,
                message: error && error.message,
                status: error && error.status,
                consultationId: this.recorder?.consultationId ?? null,
              },
            }),
          );
          this.paintRecorder();
        },
      });
      await this.recorder.start();
    }

    cancelConsent() {
      if (this.rec.phase !== "consent") return;
      this.rec = { phase: "idle", seconds: 0, path: null, error: null };
      this.paintRecorder();
    }

    paintRecorder() {
      if (!this.root) return;
      const bar = this.shadowRoot.querySelector(".rec");
      const target = this.consultationTarget();
      const busy = !["idle", "consent", "done", "error"].includes(this.rec.phase);
      // A recording in progress keeps its bar even when the page moves on to another screen.
      bar.hidden = !target && !busy;
      this.fab.dataset.rec = String(this.rec.phase === "recording" || this.rec.phase === "paused");
      if (bar.hidden) return;
      const copy = recCopyFor(this.getAttribute("locale") || navigator.language);
      const { phase } = this.rec;
      bar.dataset.phase = phase;
      const button = (label, onClick, primary) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = primary ? "btn primary" : "btn";
        item.textContent = label;
        item.addEventListener("click", onClick);
        return item;
      };
      const text = (value, className) => {
        const item = document.createElement("span");
        item.className = className;
        item.textContent = value;
        return item;
      };
      const clock = () => {
        const total = this.rec.seconds;
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
      };
      const nodes = [];
      if (phase === "idle" || phase === "starting") {
        const label = target?.clientName;
        nodes.push(button(copy[0], () => this.startConsultation(), true));
        if (label) nodes.push(text(label, "note grow"));
        nodes[0].disabled = phase === "starting";
      } else if (phase === "consent") {
        nodes.push(
          text(copy[1], "ask"),
          button(copy[2], () => void this.confirmConsent("verbal"), true),
          button(copy[3], () => void this.confirmConsent("written")),
          button(copy[4], () => this.cancelConsent()),
        );
      } else if (phase === "recording" || phase === "paused") {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.setAttribute("aria-hidden", "true");
        nodes.push(
          dot,
          text(clock(), "time"),
          text(copy[14], "note grow"),
          button(phase === "paused" ? copy[6] : copy[5], () =>
            phase === "paused" ? this.recorder.resume() : this.recorder.pause(),
          ),
          button(copy[7], () => void this.recorder.stop(), true),
        );
      } else if (phase === "processing") {
        const status = text(copy[8], "note grow");
        status.setAttribute("role", "status");
        nodes.push(status);
      } else if (phase === "done") {
        const status = text(copy[9], "grow");
        status.setAttribute("role", "status");
        nodes.push(status);
        if (this.rec.path) {
          nodes.push(
            button(
              copy[10],
              () =>
                this.dispatchEvent(
                  new CustomEvent("corvo-navigate", { detail: { path: this.rec.path } }),
                ),
              true,
            ),
          );
        }
        if (target) nodes.push(button(copy[0], () => this.startConsultation()));
      } else if (phase === "error") {
        const status = text(this.rec.error?.message || copy[11], "grow");
        status.dataset.code = this.rec.error?.code || "failed";
        status.setAttribute("role", "alert");
        nodes.push(
          status,
          button(copy[13], () => this.startConsultation(), true),
        );
      }
      bar.replaceChildren(...nodes);
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
      const { assistant, icon, user } = this.brand();
      if (assistant) params.set("assistant", assistant);
      if (icon) params.set("icon", icon);
      if (user) params.set("user", user);
      this.prepared = true;
      // Posting before the embed has loaded only lands on the host's own blank frame.
      this.frameLoaded = false;
      this.frame.addEventListener("load", () => (this.frameLoaded = true), { once: true });
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

    /**
     * A bearer token for headless calls (Rook.ask, Rook.recorder), made from this element's own
     * session route and origin and kept here, so the page signs in once however many calls it
     * makes. The frame keeps its own token and never shares it.
     */
    getToken(force = false) {
      if (!force && this.sharedToken && this.sharedToken.expiresAt - Date.now() > 60_000) {
        return Promise.resolve(this.sharedToken.token);
      }
      this.sharedTokenRequest ||= (async () => {
        const RookError = window.Rook.RookError;
        const { code, error } = await this.code();
        if (!code)
          throw new RookError(error === "no_session_url" ? "no_session" : "session_failed", 0);
        const exchange = await fetch(`${this.origin}/api/partner/embed/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = exchange.ok ? await exchange.json() : {};
        if (typeof body.token !== "string") throw new RookError("session_failed", exchange.status);
        this.sharedToken = {
          token: body.token,
          expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : Date.now() + 10 * 60_000,
        };
        return body.token;
      })().finally(() => {
        this.sharedTokenRequest = null;
      });
      return this.sharedTokenRequest;
    }

    /** Warms the session so opening shows the chat at once. Safe to call any number of times. */
    prepare() {
      if (!this.launcher || this.prepared || this.loading || this.unavailable) return;
      void this.load();
    }

    send(message) {
      if (this.frame?.contentWindow && this.origin && (this.frameLoaded || this.ready)) {
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
      this.frameLoaded = true;
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
      this.rec = { phase: "idle", seconds: 0, path: null, error: null };
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
    <div class="rec" hidden></div>
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
      this.paintRecorder();
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
      this.shadowRoot.querySelector(".title").textContent = name || copy[5];
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
      if (this.rec) this.paintRecorder();
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
        ...this.suggestionList().map((suggestion) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = suggestion.label;
          // A place opens in your product; only a question goes to the assistant.
          button.addEventListener("click", () =>
            suggestion.path
              ? this.dispatchEvent(
                  new CustomEvent("corvo-navigate", { detail: { path: suggestion.path } }),
                )
              : this.ask(suggestion.label),
          );
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

  if (!customElements.get("corvo-assistant"))
    customElements.define("corvo-assistant", CorvoAssistant);
})();
