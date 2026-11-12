import type { SettingsScope } from "@corvo/contracts";
import {
  readVoiceAudio,
  readVoiceError,
  requestDeadline,
  VOICE_RESPONSE_TIMEOUT_MS,
  withAbort,
} from "@corvo/core";
import { conversationLanguage } from "./dictation.js";
import { rpc, selectedSpaceId, withSpaceHeaders } from "./rpc.js";
import { errorText, voiceAccountErrorText } from "./user-error.js";
import { announceLocalDownload, announceLocalFallback } from "./voice-notices.js";

export type SpeechStatus = "idle" | "preparing" | "speaking";

export interface SpeechSnapshot {
  status: SpeechStatus;
  botId?: string;
  messageId?: string;
  caption?: string;
  error?: string;
}

interface SpeakOptions {
  spaceId?: string | null;
  /** Which copy of the voice settings to use; omitted means whichever applies in the space. */
  scope?: SettingsScope;
  voiceId?: string;
  /** Names a provider outright; only the sample of a voice on this computer does. */
  provider?: string;
  /** The language the reply is in; the conversation's own when omitted. */
  language?: string;
  botId?: string;
  messageId?: string;
}

/** How often a reply asks again, and for how long, while the voice of this computer downloads. */
const PREPARING_POLL_MS = 2000;
const PREPARING_MAX_POLLS = 450;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const IDLE: SpeechSnapshot = { status: "idle" };

export class Speaker {
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<(s: SpeechSnapshot) => void>();
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settlePlayback: ((finished: boolean) => void) | null = null;
  private request: AbortController | null = null;

  subscribe(fn: (s: SpeechSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): SpeechSnapshot {
    return this.snapshot;
  }

  private set(next: SpeechSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  isSpeaking(messageId?: string): boolean {
    if (this.snapshot.status === "idle") return false;
    return messageId ? this.snapshot.messageId === messageId : true;
  }

  stop() {
    this.token += 1;
    this.request?.abort();
    this.request = null;
    if (this.settlePlayback) this.settlePlayback(false);
    else this.teardownAudio();
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  private teardownAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** Resolves with this request's failure text; stopping or superseding it resolves with none. */
  async speak(text: string, opts: SpeakOptions = {}): Promise<string | undefined> {
    this.stop();
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    const spaceId = opts.spaceId ?? selectedSpaceId();

    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    let utterances: string[];
    try {
      utterances = await withAbort(
        this.prepare(text, opts, controller.signal, spaceId),
        controller.signal,
      );
    } catch (error) {
      const failure = live() ? errorText(error) : undefined;
      if (failure) this.set({ ...IDLE, error: failure });
      if (this.request === controller) this.request = null;
      return failure;
    }
    if (!live()) return;
    if (!utterances.length) {
      this.set(IDLE);
      if (this.request === controller) this.request = null;
      return;
    }

    type Rendered = { blob: Blob; error?: never } | { blob?: never; error: unknown };
    const render = (utterance: string): Promise<Rendered> =>
      this.render(utterance, opts, controller.signal, spaceId).then(
        (blob) => ({ blob }),
        (error: unknown) => ({ error }),
      );
    let next: Promise<Rendered> | null = render(utterances[0] ?? "");
    for (let i = 0; i < utterances.length; i += 1) {
      const current = next;
      next = i + 1 < utterances.length ? render(utterances[i + 1] ?? "") : null;
      if (!current) break;
      const rendered = await current;
      if ("error" in rendered) {
        const failure = live() ? errorText(rendered.error) : undefined;
        if (failure) this.set({ ...IDLE, error: failure });
        if (this.request === controller) this.request = null;
        return failure;
      }
      if (!live()) return;
      this.set({
        status: "speaking",
        botId: opts.botId,
        messageId: opts.messageId,
        caption: utterances[i],
      });
      const finished = await this.play(rendered.blob, live);
      if (!finished || !live()) {
        if (live()) this.set(IDLE);
        if (this.request === controller) this.request = null;
        return;
      }
    }
    if (live()) this.set(IDLE);
    if (this.request === controller) this.request = null;
  }

  private async prepare(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<string[]> {
    for (let poll = 0; poll < PREPARING_MAX_POLLS; poll += 1) {
      const body = await rpc.voice.prepare(
        {
          text,
          voiceId: opts.voiceId,
          botId: opts.botId,
          scope: opts.scope,
          provider: opts.provider,
          language: opts.language ?? conversationLanguage(),
        },
        { signal, context: { spaceId } },
      );
      if (!body.ready) {
        throw new Error("Add a voice provider key and pick a voice in Voice settings.");
      }
      // The voice of this computer is being fetched: this reply waits for it, the next ones do not.
      if (!body.preparing) return body.utterances ?? [];
      announceLocalDownload("speak", body.preparing.sizeBytes);
      await wait(PREPARING_POLL_MS, signal);
      if (signal.aborted) return [];
    }
    throw new Error("The voice is taking too long to download.");
  }

  private async render(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<Blob> {
    const deadline = requestDeadline(VOICE_RESPONSE_TIMEOUT_MS, "Voice request timed out.", signal);
    try {
      const res = await withAbort(
        fetch("/api/voice/speak", {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({
            text,
            voiceId: opts.voiceId,
            botId: opts.botId,
            scope: opts.scope,
            provider: opts.provider,
            language: opts.language ?? conversationLanguage(),
          }),
          signal: deadline.signal,
        }),
        deadline.signal,
      );
      if (!res.ok) {
        const body = await readVoiceError(res, deadline.signal);
        throw new Error(voiceAccountErrorText(body) ?? body.error ?? "");
      }
      if (res.headers.get("x-voice-fallback") === "local") announceLocalFallback();
      const bytes = await readVoiceAudio(res, deadline.signal);
      return new Blob([new Uint8Array(bytes)], {
        type: res.headers.get("content-type") ?? "audio/mpeg",
      });
    } finally {
      deadline.dispose();
    }
  }

  private play(blob: Blob, live: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      this.objectUrl = url;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        resolve(ok);
      };
      this.settlePlayback = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.play().catch(() => done(false));
    });
  }
}

export const speaker = new Speaker();
