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

/** A reply spoken while it is still being written: utterances are queued as they are completed. */
export interface SpeechStream {
  /** Queues the next utterance; it is spoken once the ones before it are. */
  push(text: string): void;
  /** Nothing more is coming; the speaker goes idle after the last utterance. */
  end(): void;
  /** Drops what is queued and in flight, and stops playback. */
  cancel(): void;
  /** Stopped, cancelled, replaced or failed: nothing more will be spoken. */
  readonly closed: boolean;
  /** Resolves with the failure text, if speaking failed. */
  readonly done: Promise<string | undefined>;
}

interface StreamOptions extends SpeakOptions {
  /** When the caller's turn was sent, to log how long the first audio took. */
  turnStartedAt?: number;
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

/** A tenth of a second of silence, played from the tap that starts a call to unlock the speaker. */
function silence(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function debugSentence(stage: string, text: string, extra: Record<string, unknown> = {}) {
  console.debug("[voice] sentence", { stage, text: text.slice(0, 40), ...extra });
}

export class Speaker {
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<(s: SpeechSnapshot) => void>();
  private token = 0;
  /**
   * One element plays every clip. Safari lets an element play only after it was started by a tap,
   * and a clip that arrives from the network seconds later is no longer inside that tap, so a
   * fresh element per clip stays silent. This one is unlocked when the call starts and reused.
   */
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

  private element(): HTMLAudioElement {
    this.audio ??= new Audio();
    return this.audio;
  }

  /** Call from a tap: lets this speaker play later clips without another tap (Safari). */
  unlock(): void {
    if (typeof Audio === "undefined") return;
    try {
      const audio = this.element();
      if (this.settlePlayback) return;
      const quiet = silence();
      audio.src = quiet;
      audio.play().then(
        () => {
          if (!this.settlePlayback && audio.src === quiet) audio.pause();
        },
        () => undefined,
      );
    } catch {
      // No audio element here; speaking reports it.
    }
  }

  private teardownAudio() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** A call is starting: the engine loads its voice now so the first sentence is not slowed by it. */
  warm(botId?: string): void {
    this.unlock();
    void rpc.voice
      .warm(
        { botId, language: conversationLanguage() },
        { context: { spaceId: selectedSpaceId() } },
      )
      .catch(() => undefined);
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
    let spoken = 0;
    let firstFailure: unknown;
    for (let i = 0; i < utterances.length; i += 1) {
      const current = next;
      next = i + 1 < utterances.length ? render(utterances[i + 1] ?? "") : null;
      if (!current) break;
      const rendered = await current;
      if (!live()) return;
      if ("error" in rendered) {
        firstFailure ??= rendered.error;
        continue;
      }
      this.set({
        status: "speaking",
        botId: opts.botId,
        messageId: opts.messageId,
        caption: utterances[i],
      });
      const finished = await this.play(rendered.blob, live);
      if (!live()) {
        if (this.request === controller) this.request = null;
        return;
      }
      if (finished) spoken += 1;
      else firstFailure ??= new Error("The browser could not play the voice.");
    }
    if (spoken === 0 && firstFailure !== undefined) {
      const failure = errorText(firstFailure);
      this.set({ ...IDLE, error: failure });
      if (this.request === controller) this.request = null;
      return failure;
    }
    if (live()) this.set(IDLE);
    if (this.request === controller) this.request = null;
  }

  /**
   * Speaks utterances as the caller supplies them. Each one is rendered as soon as it is
   * queued, the next one while the current plays, and no more than that, so cancelling
   * leaves at most one request to abandon. A hung-up or interrupted stream aborts them all.
   */
  speakStream(opts: StreamOptions = {}): SpeechStream {
    this.stop();
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    const spaceId = opts.spaceId ?? selectedSpaceId();
    type Rendered = { blob: Blob; error?: never } | { blob?: never; error: unknown };
    const queue: Array<{ text: string; rendered?: Promise<Rendered> }> = [];
    let ended = false;
    let wake: (() => void) | null = null;
    let gate: Promise<{ error?: unknown }> | null = null;
    let firstPushAt: number | null = null;
    const poke = () => {
      const resume = wake;
      wake = null;
      resume?.();
    };
    controller.signal.addEventListener("abort", poke, { once: true });
    const render = (text: string): Promise<Rendered> =>
      this.render(text, opts, controller.signal, spaceId).then(
        (blob) => ({ blob }),
        (error: unknown) => ({ error }),
      );
    const kick = () => {
      for (const item of queue.slice(0, 2)) item.rendered ??= render(item.text);
    };
    let over = false;
    const release = (): undefined => {
      over = true;
      if (this.request === controller) this.request = null;
    };
    const fail = (error: unknown) => {
      const failure = live() ? errorText(error) : undefined;
      if (failure) this.set({ ...IDLE, error: failure });
      controller.abort();
      release();
      return failure;
    };

    const run = async (): Promise<string | undefined> => {
      this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
      let first = true;
      let spoken = 0;
      let firstFailure: unknown;
      for (;;) {
        if (!live()) return release();
        kick();
        const item = queue[0];
        if (!item?.rendered) {
          if (ended) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const rendered = await item.rendered;
        if (!live()) return release();
        if (gate) {
          // Readiness (a voice to speak with, a local voice still downloading) is checked
          // next to the first render rather than before it.
          const ready = await gate;
          gate = null;
          if (!live()) return release();
          if (ready.error) return fail(ready.error);
        }
        if ("error" in rendered) {
          // One sentence the provider could not speak is skipped, not the rest of the reply.
          firstFailure ??= rendered.error;
          queue.shift();
          continue;
        }
        this.set({
          status: "speaking",
          botId: opts.botId,
          messageId: opts.messageId,
          caption: item.text,
        });
        if (first) {
          first = false;
          const now = performance.now();
          console.debug("[voice] time to first audio", {
            sinceTurnMs:
              opts.turnStartedAt === undefined ? undefined : Math.round(now - opts.turnStartedAt),
            sinceFirstTextMs: firstPushAt === null ? undefined : Math.round(now - firstPushAt),
          });
        }
        const finished = await this.play(rendered.blob, live);
        queue.shift();
        if (!live()) return release();
        if (finished) {
          spoken += 1;
          debugSentence("played", item.text);
        } else {
          firstFailure ??= new Error("The browser could not play the voice.");
          debugSentence("failed", item.text, { stage: "play" });
        }
      }
      // Only a reply of which nothing could be spoken says so.
      if (spoken === 0 && firstFailure !== undefined) return fail(firstFailure);
      if (live()) this.set(IDLE);
      release();
    };
    const done = run();

    return {
      push: (text) => {
        const utterance = text.trim();
        if (!utterance || over || ended || !live()) return;
        firstPushAt ??= performance.now();
        queue.push({ text: utterance });
        gate ??= this.prepare(utterance, opts, controller.signal, spaceId).then(
          () => ({}),
          (error: unknown) => ({ error }),
        );
        kick();
        poke();
      },
      end: () => {
        ended = true;
        poke();
      },
      cancel: () => {
        if (live()) this.stop();
      },
      get closed() {
        return over || !live();
      },
      done,
    };
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
    const sentAt = performance.now();
    debugSentence("sent", text);
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
      debugSentence("received", text, {
        bytes: bytes.byteLength,
        ms: Math.round(performance.now() - sentAt),
      });
      return new Blob([new Uint8Array(bytes)], {
        type: res.headers.get("content-type") ?? "audio/mpeg",
      });
    } catch (error) {
      debugSentence("failed", text, {
        ms: Math.round(performance.now() - sentAt),
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      deadline.dispose();
    }
  }

  private play(blob: Blob, live: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = this.element();
      this.objectUrl = url;
      let settled = false;
      const done = (ok: boolean, reason?: unknown) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        if (!ok && live()) {
          console.debug("[voice] playback failed", {
            reason: reason instanceof Error ? `${reason.name}: ${reason.message}` : reason,
          });
        }
        resolve(ok);
      };
      this.settlePlayback = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false, "media error");
      audio.src = url;
      audio.play().catch((error: unknown) => done(false, error));
    });
  }
}

export const speaker = new Speaker();
