// Rook headless assist: AI inside your own screens, with no Rook UI on the page.
//
//   Rook.configure({ sessionUrl: "/your/session/route" });  // optional; see below
//   const { result } = await Rook.ask({ preset: "evolution", context: { notes } });
//   const rec = Rook.recorder({ preset: "anamnesis", clientId, consent, onResult });
//   await rec.start(); ... await rec.stop();
//
// Both calls sign in as your customer with a session of their own: `sessionUrl` is your backend
// route that answers POST with { code } from Rook's POST /api/partner/v1/sessions (the same route
// <corvo-assistant session-url> uses, which is read from the page when you do not configure one).
// The partner key never reaches the browser. Nothing is written to your system: the results are
// handed to your callbacks so your own form can show them for the professional to review.
(() => {
  window.Rook = window.Rook || {};
  const Rook = window.Rook;
  if (Rook.ask) return;
  const scriptOrigin = (() => {
    try {
      return new URL(document.currentScript.src).origin;
    } catch {
      return null;
    }
  })();

  const settings = { sessionUrl: null, origin: null, getToken: null };
  let cached = null;

  /** `sessionUrl`, `origin` (where Rook runs; default: where this file came from), `getToken`. */
  Rook.configure = (options = {}) => {
    Object.assign(settings, options);
    cached = null;
  };

  class RookError extends Error {
    constructor(code, status) {
      super(code);
      this.name = "RookError";
      this.code = code;
      this.status = status;
    }
  }
  Rook.RookError = RookError;

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
    if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const url =
      settings.sessionUrl || document.querySelector("corvo-assistant")?.getAttribute("session-url");
    if (!url) throw new RookError("no_session", 0);
    const response = await fetch(url, { method: "POST", credentials: "same-origin" });
    const { code } = response.ok ? await response.json() : {};
    if (typeof code !== "string") throw new RookError("session_failed", response.status);
    const exchange = await fetch(`${origin()}/api/partner/embed/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
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
      });
      if (response.status !== 401 || force) return response;
    }
    throw new RookError("unauthorized", 401);
  }

  async function failure(response) {
    const body = await response.json().catch(() => ({}));
    return new RookError(typeof body.error === "string" ? body.error : "failed", response.status);
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

  const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * A recorder for the visit, inside your own form. States, in `onState`: idle, requesting,
   * recording, paused, uploading, processing, done, error. `onTranscript({ text, final, source })`
   * carries a live caption from the browser (when it can) and, at the end, the transcript Rook
   * wrote (`source: "server"`, with `turns`). `onResult(result, { transcript, consultationId })`
   * receives the fields of your schema. Pass `consent` as `{ method: "verbal" | "written" }` or a
   * function that asks the patient and returns that (or false to stop).
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
            if (attempt >= 2) return fail(new RookError("upload_failed", 0));
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

    const poll = async () => {
      for (let i = 0; i < pollLimit; i++) {
        const response = await call(`/api/partner/embed/consultations/${consultationId}`);
        if (!response.ok) throw await failure(response);
        const status = await response.json();
        if (status.state === "drafted") return status;
        if (status.state === "failed") throw new RookError(status.error?.code || "failed", 0);
        await wait(pollMs);
      }
      throw new RookError("timeout", 0);
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
          const given = typeof consent === "function" ? await consent() : consent;
          if (!given?.method) {
            set("idle");
            return;
          }
          onPermission?.("requesting");
          try {
            stream = await mediaDevices.getUserMedia({ audio: true });
          } catch {
            onPermission?.("denied");
            throw new RookError("permission_denied", 0);
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
          const mimeType = PREFERRED_TYPES.find((type) => Recorder.isTypeSupported?.(type));
          media = new Recorder(stream, mimeType ? { mimeType } : undefined);
          media.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) upload(event.data, seq++);
          };
          media.onerror = () => fail(new RookError("recorder_failed", 0));
          media.start(chunkMs);
          startCaptions();
          set("recording");
        } catch (error) {
          fail(error instanceof RookError ? error : new RookError("failed", 0));
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
            const finish = await call(`/api/partner/embed/consultations/${consultationId}/finish`, {
              method: "POST",
            });
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
            onResult?.(status.note || {}, { transcript, consultationId });
            set("done");
            if (!keep) await api.discard();
          } catch (error) {
            if (!failed) fail(error instanceof RookError ? error : new RookError("failed", 0));
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

      /** Deletes the recording, transcript and result held by Rook. */
      async discard() {
        if (!consultationId) return;
        const id = consultationId;
        consultationId = null;
        await call(`/api/partner/embed/consultations/${id}`, { method: "DELETE" }).catch(() => {});
      },
    };
    return api;
  };
})();
