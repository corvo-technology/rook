import type { MessageBlock, ThreadMessage, ThreadSnapshot } from "@corvo/contracts";
import type { CallExchange } from "@corvo/core";
import {
  CALL_FAREWELL_TIMEOUT_MS,
  callClientNonce,
  createCallSendTracker,
  createInterimBargeIn,
  createSpeechChunker,
  isCallBargeIn,
  isFarewell,
  isSecretAskBlock,
  newClientId,
  runThreadSubscription,
  speechFromBlocks,
  spokenDecision,
  spokenMemory,
  toUtterances,
} from "@corvo/core";
import { t } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import { pickUp } from "./call-pickup.js";
import { dictation } from "./dictation.js";
import { reportClientError } from "./monitoring";
import { rpc } from "./rpc.js";
import { isThreadSnapshotEvent, reduceThreadSnapshot } from "./thread-events.js";
import type { SpeechStream } from "./tts.js";
import { speaker } from "./tts.js";
import { errorText } from "./user-error";

/** `ringing` until the call picks up; the rest describe the conversation. */
type CallPhase = "ringing" | "listening" | "thinking" | "speaking";

export interface CallState {
  botId: string;
  botName: string;
  botColor: string;
  /** When the call picked up; null while it is still ringing. */
  connectedAt: number | null;
  phase: CallPhase;
  muted: boolean;
  /** The call window is tucked away; the call keeps running. */
  minimized: boolean;
  transcriptOpen: boolean;
  caption: string;
  heard: string;
  /** The last reply could not be spoken; it is shown as text and the call keeps listening. */
  voiceFailed: boolean;
  exchanges: CallExchange[];
}

const RUN_ACTIVE = ["running", "queued", "leased"];
/**
 * Quiet gap between the last audio frame and opening the microphone.
 * ponytail: one fixed delay for every room and output device; make it adaptive only
 * if a measured tail actually outruns it.
 */
export const ECHO_GUARD_MS = 600;
let state: CallState | null = null;
/** Shared by every message this call sends, so the thread can group one call's exchange. */
let callId = "";
/** Cancels the ringing of a call that is hung up before it picks up. */
let pickup: AbortController | null = null;
/** The bot's opening is playing: nothing else is spoken and the mic waits for it. */
let openingPending = false;
/** Requests for this call that must persist before its server-side hang-up. */
const callSends = createCallSendTracker();
let transcribe: boolean | undefined;
let thread: ThreadSnapshot | null = null;
let feed: {
  controller: AbortController;
  load: () => Promise<ThreadSnapshot | null>;
} | null = null;
/** Every bot message already spoken this call: a streaming message updates many times. */
const spokenMessageIds = new Set<string>();
let unsubSpeech: (() => void) | null = null;
let unsubDictation: (() => void) | null = null;
let hangUpAfterReply = false;
/** The bot hung up itself: its farewell is the last thing this call speaks. */
let botEndedCall = false;
let hangUpTimer: ReturnType<typeof setTimeout> | null = null;
/** Pending echo guard: the microphone stays shut until it fires. */
let guardTimer: ReturnType<typeof setTimeout> | null = null;
/** Whether dictation is running, so playback can leave it open instead of restarting it. */
let micOpen = false;
/** The caller cut the reply off: there is no tail left to wait out before listening. */
let bargedIn = false;
/** A turn is in flight: its reply must be spoken even if the mic reopened meanwhile. */
let awaitingReply = false;
/**
 * The reply of a run that is spoken while it is still being written. It belongs to the run,
 * not to a message: the live message and the durable one that replaces it are one reply.
 */
interface LiveReply {
  runId: string;
  messageId: string;
  chunker: ReturnType<typeof createSpeechChunker>;
  stream: SpeechStream | null;
  /** The visible reply as of the last update. */
  written: string;
  /** Something of this reply was spoken, so the whole of it is never spoken again. */
  spoke: boolean;
  /** The caller cut this reply off; only what is written after that point may be spoken. */
  abandoned: boolean;
  /** Where this reply sits in the transcript. */
  exchangeAt: number | null;
}
let liveReply: LiveReply | null = null;
/** When the caller's turn was sent, for the time to the first audio. */
let turnSentAt: number | undefined;
/** Counting down an interim phrase heard over the reply, before it counts as cutting in. */
const interim = createInterimBargeIn(() => {
  if (state?.phase !== "speaking") return;
  // Never resume the cut-off message, and keep the idle it emits from reopening the mic.
  bargedIn = true;
  speaker.stop();
  abandonLiveReply();
  set({ phase: "listening", caption: "" });
});
const watchers = new Set<() => void>();

export function subscribe(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

export function getSnapshot(): CallState | null {
  return state;
}

export function useCallSession(): CallState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function emit() {
  for (const watcher of [...watchers]) watcher();
}

function set(patch: Partial<CallState>) {
  if (!state) return;
  state = { ...state, ...patch };
  emit();
}

export function startCall(call: {
  botId: string;
  botName: string;
  botColor?: string;
  transcribe?: boolean;
  /** The bot called and the user picked up: no ringing, and the bot speaks first. */
  answered?: { callId: string; opening: string };
}): void {
  endCall();
  callId = call.answered?.callId ?? newClientId();
  transcribe = call.transcribe;
  spokenMemory.clear();
  interim.clear();
  micOpen = false;
  bargedIn = false;
  awaitingReply = false;
  liveReply = null;
  state = {
    botId: call.botId,
    botName: call.botName,
    botColor: call.botColor ?? "",
    connectedAt: null,
    phase: "ringing",
    muted: false,
    minimized: false,
    transcriptOpen: false,
    caption: "",
    heard: "",
    voiceFailed: false,
    exchanges: [],
  };
  unsubSpeech = speaker.subscribe((speech) => {
    if (!state || state.phase === "ringing") return;
    if (openingPending && speech.status === "idle") openingPending = false;
    if (speech.status === "speaking") {
      bargedIn = false;
      set({ phase: "speaking", caption: speech.caption ?? "", voiceFailed: false });
      // The mic stays open through playback so the caller can talk over the reply.
      void openMic();
    } else if (speech.status === "idle" && state.phase !== "listening" && !bargedIn) {
      set({ caption: "" });
      guardThenListen();
    }
    // Speech failed: the reply stays readable as text and the mic opens again as usual.
    if (speech.error) {
      const reply = [...state.exchanges].reverse().find((exchange) => exchange.role === "bot");
      set({ caption: reply?.text ?? speech.error, voiceFailed: true });
    }
  });
  unsubDictation = dictation.subscribe((heard) => {
    if (!state) return;
    if (heard.status === "listening") {
      set({ heard: pendingSecretAsk(thread) ? "" : heard.transcript });
      watchInterim(heard.transcript);
    } else interim.clear();
    if (heard.error) {
      if (heard.status === "idle") micOpen = false;
      set({ caption: heard.error });
    }
  });
  watchThread(call.botId);
  emit();
  speaker.warm(call.botId);
  const ringing = new AbortController();
  pickup = ringing;
  const ringingCallId = callId;
  const opening = call.answered?.opening.trim() ?? "";
  void pickUp(ringing.signal, { ring: !call.answered }).then(() => {
    if (ringing.signal.aborted || !state || callId !== ringingCallId) return;
    pickup = null;
    if (!opening) {
      set({ phase: "listening", connectedAt: Date.now() });
      void listen();
      return;
    }
    // The bot opens the call; its speech ending hands the turn to the user.
    set({
      phase: "thinking",
      connectedAt: Date.now(),
      exchanges: [{ role: "bot", text: opening }],
    });
    spokenMemory.remember(opening);
    openingPending = true;
    void speaker.speak(opening, { botId: call.botId }).catch(() => {
      if (callId !== ringingCallId) return;
      openingPending = false;
      void listen();
    });
  });
}

export function endCall(): void {
  // A caller hang-up closes the call server-side, which files the marker and the wrap-up
  // run. The bot's own end_call already did that, so only tell the server when it did not.
  if (state && !botEndedCall) {
    const { botId, connectedAt } = state;
    const closingCallId = callId;
    const durationSeconds =
      connectedAt === null ? undefined : Math.max(0, Math.round((Date.now() - connectedAt) / 1000));
    const closeServerCall = () =>
      rpc.threads.endCall({
        botId,
        callId: closingCallId,
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
      });
    callSends.closeAfterSends(closingCallId, closeServerCall);
  }
  pickup?.abort();
  pickup = null;
  openingPending = false;
  feed?.controller.abort();
  feed = null;
  hangUpAfterReply = false;
  botEndedCall = false;
  if (hangUpTimer) clearTimeout(hangUpTimer);
  hangUpTimer = null;
  if (guardTimer) clearTimeout(guardTimer);
  guardTimer = null;
  interim.clear();
  micOpen = false;
  bargedIn = false;
  awaitingReply = false;
  liveReply = null;
  unsubSpeech?.();
  unsubDictation?.();
  unsubSpeech = null;
  unsubDictation = null;
  dictation.stop("cancel");
  speaker.stop();
  thread = null;
  spokenMessageIds.clear();
  spokenMemory.clear();
  if (!state) return;
  state = null;
  emit();
}

export function toggleMute(): void {
  if (!state) return;
  const muted = !state.muted;
  set({ muted });
  if (muted) {
    dictation.stop("cancel");
    micOpen = false;
    set({ heard: "" });
    return;
  }
  if (state.phase === "listening") void listen();
  else if (state.phase === "speaking") void openMic();
}

export function toggleTranscript(): void {
  if (!state) return;
  set({ transcriptOpen: !state.transcriptOpen });
}

export function setCallMinimized(minimized: boolean): void {
  if (!state) return;
  set({ minimized });
}

/** Live feed for the bot on the call, independent of whichever thread is on screen. */
function watchThread(botId: string) {
  const controller = new AbortController();
  const feedCallId = callId;
  let requestEpoch = 0;
  let acceptedEpoch = 0;
  const isCurrent = () =>
    feed?.controller === controller &&
    !controller.signal.aborted &&
    callId === feedCallId &&
    state?.botId === botId;
  const load = async () => {
    if (!isCurrent()) return null;
    const request = ++requestEpoch;
    const next = await rpc.threads.get({ botId }, { signal: controller.signal });
    if (!isCurrent()) return null;
    if (request < acceptedEpoch) return thread;
    if (thread?.threadId === next.threadId && thread.cursor > next.cursor) return thread;
    acceptedEpoch = request;
    return commit(next);
  };
  feed = { controller, load };
  void runThreadSubscription({
    signal: controller.signal,
    loadInitial: load,
    loadHead: () => rpc.threads.head({ botId }, { signal: controller.signal }),
    refresh: load,
    currentSnapshot: () => thread,
    subscribe: (cursor, signal) => rpc.threads.subscribe({ botId, cursor }, { signal }),
    applyEvent: (event) => {
      if (isThreadSnapshotEvent(event)) commit(reduceThreadSnapshot(thread, event));
    },
    onEvent: (event) => {
      // The bot hung up: speak the farewell it wrote and stop there — the rest of its
      // work lands in the thread as chat, which the caller is no longer listening to.
      if (event.type !== "thread.call.ended" || event.payload.callId !== callId) return;
      if (botEndedCall) return;
      hangUpAfterReply = true;
      botEndedCall = true;
      if (hangUpTimer) clearTimeout(hangUpTimer);
      hangUpTimer = setTimeout(endCall, CALL_FAREWELL_TIMEOUT_MS);
      speakFarewell(event.payload);
    },
  });
}

/** The bot's own goodbye: the last thing this call says before the speaker goes idle. */
function speakFarewell(payload: Record<string, unknown>) {
  if (!state) return;
  const farewell = typeof payload.farewell === "string" ? payload.farewell.trim() : "";
  const messageId = typeof payload.messageId === "string" ? payload.messageId : undefined;
  if (messageId) spokenMessageIds.add(messageId);
  // Nothing to say: hang up instead of waiting out the fallback.
  if (!farewell) {
    endCall();
    return;
  }
  awaitingReply = false;
  set({ exchanges: [...state.exchanges, { role: "bot", text: farewell }], heard: "" });
  spokenMemory.remember(farewell);
  void speaker.speak(farewell, { botId: state.botId, messageId });
}

function commit(next: ThreadSnapshot | null) {
  if (!next) return null;
  thread = next;
  reactToThread();
  return next;
}

/** The tail of playback reaches the microphone after the audio element ends. */
function guardThenListen() {
  // Dictation ran right through playback: there is no shut mic to hold closed.
  if (micOpen) {
    void listen();
    return;
  }
  if (guardTimer) clearTimeout(guardTimer);
  guardTimer = setTimeout(() => {
    guardTimer = null;
    void listen();
  }, ECHO_GUARD_MS);
}

async function listen() {
  if (!state) return;
  // The caller said goodbye: every path back to listening hangs up instead.
  if (hangUpAfterReply) {
    endCall();
    return;
  }
  // A reply still playing owns the audio session; its idle event calls back here.
  if (speaker.isSpeaking()) return;
  // A guard is already counting down the quiet gap; it calls back here when it ends.
  if (guardTimer) return;
  set({ phase: "listening", heard: "" });
  speaker.stop();
  if (state.muted || pendingSecretAsk(thread)) {
    dictation.stop("cancel");
    micOpen = false;
    return;
  }
  await openMic();
}

/** Starts dictation unless it is already running, muted, or waiting on a typed secret. */
async function openMic() {
  if (!state || micOpen || state.muted || pendingSecretAsk(thread)) return;
  micOpen = true;
  try {
    await dictation.listen({
      mode: "endpoint",
      transcribe,
      onFinal: (text) => void handleTranscript(text),
    });
  } catch (error) {
    micOpen = false;
    reportClientError(error, "voice.microphone");
    set({ caption: errorText(error, t`Microphone failed`) });
  }
}

async function handleTranscript(text: string) {
  if (!state) return;
  // Dictation stopped itself to deliver this final.
  micOpen = false;
  if (!text.trim()) {
    void listen();
    return;
  }
  if (state.phase === "speaking") {
    if (!isCallBargeIn(text)) {
      set({ heard: "" });
      void openMic();
      return;
    }
    // The caller talked over the reply: cut the audio, and never resume that message.
    bargedIn = true;
    speaker.stop();
    abandonLiveReply();
    set({ phase: "thinking", caption: "" });
  }
  dictation.stop("submit");
  // The microphone caught the reply, not the caller: drop it and keep listening.
  if (spokenMemory.isEcho(text)) {
    set({ heard: "" });
    void listen();
    return;
  }
  if (pendingSecretAsk(thread)) {
    set({ heard: "", caption: t`Hang up, then enter the code on screen.` });
    return;
  }
  const { botId, exchanges } = state;
  const askId = latestAskId(thread);
  const askMessage = thread?.messages.find((message) => message.id === askId);
  // Captured now: a call started while this is in flight must not re-attach the new feed
  // or commit this turn onto it. The same bot can be called again, so the bot id is not enough.
  const callFeed = feed;
  const turnCallId = callId;
  const closing = isFarewell(text);
  // Whatever the bot was still writing for the last turn was not for this one.
  abandonLiveReply();
  awaitingReply = true;
  turnSentAt = performance.now();
  set({ heard: text, phase: "thinking", exchanges: [...exchanges, { role: "user", text }] });
  if (closing) {
    hangUpAfterReply = true;
    // A second goodbye replaces this timer. Clear the previous one or it can
    // end the next call after this one has already hung up.
    if (hangUpTimer) clearTimeout(hangUpTimer);
    hangUpTimer = setTimeout(endCall, CALL_FAREWELL_TIMEOUT_MS);
  }
  let releasePendingSend: () => void = () => undefined;
  try {
    const clientNonce = callClientNonce(turnCallId);
    const sendRequest = askMessage
      ? rpc.threads.answer({
          botId,
          runId: askMessage.runId ?? "",
          messageId: askMessage.id,
          answer: spokenDecision(text) ?? text,
          clientNonce,
        })
      : runActive(thread)
        ? rpc.threads.followUp({ botId, text, clientNonce })
        : rpc.threads.send({ botId, clientNonce, text });
    releasePendingSend = callSends.track(turnCallId, sendRequest);
    await sendRequest;
  } catch (error) {
    if (!state || state.botId !== botId || callId !== turnCallId) return;
    awaitingReply = false;
    set({ caption: errorText(error, t`Could not send that`) });
    void listen();
    return;
  } finally {
    releasePendingSend();
  }
  if (!state || state.botId !== botId || callId !== turnCallId) return;
  try {
    await callFeed?.load();
  } catch (error) {
    if (!state || state.botId !== botId || callId !== turnCallId) return;
    awaitingReply = false;
    set({ caption: errorText(error, t`Could not send that`) });
    void listen();
  }
}

/**
 * Interim results are the only signal that arrives while the caller is still talking.
 * A qualifying phrase that stands for INTERIM_BARGE_IN_MS stops the audio at once; the
 * dictation session keeps running, so its silence window finishes the utterance and
 * handleTranscript sends it as the next turn.
 */
function watchInterim(text: string) {
  if (state?.phase !== "speaking") return;
  interim.hear(text);
}

/**
 * Speak whatever the call's bot said last. A call never speaks tool activity: the
 * card's phase indicator is the only feedback, so nothing talks over the caller.
 */
function reactToThread() {
  // Nothing is spoken before the call picks up, or over the bot's opening.
  if (!state || state.phase === "ringing" || openingPending) return;
  // The bot already said goodbye: neither its marker nor the work it files after it is spoken.
  if (botEndedCall) return;
  if (pendingSecretAsk(thread)) {
    dictation.stop("cancel");
    micOpen = false;
    set({ heard: "" });
  }
  const { botId } = state;
  const messages = thread?.messages ?? [];
  const lastBot = [...messages].reverse().find((message) => message.role === "bot");
  // A reply that was spoken while it was written settles even if the mic reopened meanwhile.
  if (lastBot && liveReply && replyFinished(lastBot) && finishLiveReply(lastBot)) return;
  // A turn sent back to listening mid-flight must not drop the reply it is waiting for.
  if (state.phase === "listening" && !awaitingReply) return;
  if (lastBot && !spokenMessageIds.has(lastBot.id) && writingReply(lastBot)) {
    speakWhileWriting(lastBot);
    return;
  }
  if (lastBot && !spokenMessageIds.has(lastBot.id) && replyFinished(lastBot)) {
    const text = speechFromBlocks(lastBot.blocks);
    const ask = lastBot.blocks.find((block) => block.kind === "ask" && block.status !== "answered");
    const secretAsk = ask && isSecretAskBlock(ask);
    if (text) {
      // Never spoken again, interrupted or not.
      spokenMessageIds.add(lastBot.id);
      awaitingReply = false;
      set({ exchanges: [...state.exchanges, { role: "bot", text }], heard: "" });
      spokenMemory.remember(text);
      void speaker.speak(
        secretAsk
          ? `${text}. ${t`Hang up first, then enter the code on screen.`}`
          : ask
            ? `${text}. ${t`Say yes or no, or answer in a sentence.`}`
            : text,
        { botId, messageId: lastBot.id },
      );
      return;
    }
    if (!runActive(thread)) {
      spokenMessageIds.add(lastBot.id);
      awaitingReply = false;
      void listen();
    }
  }
}

/** A reply its run is still writing: the bot's own message of the run that is active now. */
function writingReply(message: ThreadMessage) {
  const run = thread?.run;
  return Boolean(
    run && message.runId === run.id && RUN_ACTIVE.includes(run.status) && message.role === "bot",
  );
}

/** What the person reads of a reply: its text, never the status line of a tool at work. */
function visibleReply(blocks: readonly MessageBlock[]): string {
  return blocks
    .filter((block) => block.kind === "text" || (block.kind === "progress" && !block.activity))
    .map((block) => (block.kind === "text" || block.kind === "progress" ? block.text : ""))
    .join(" ");
}

/** The parts of a finished reply that are read after its text: a question, a card, a result. */
function afterTheText(blocks: readonly MessageBlock[]): string[] {
  const rest = speechFromBlocks(
    blocks.filter(
      (block) => block.kind !== "text" && block.kind !== "progress" && block.kind !== "steps",
    ),
  );
  const ask = blocks.find((block) => block.kind === "ask" && block.status !== "answered");
  const prompt = ask
    ? isSecretAskBlock(ask)
      ? t`Hang up first, then enter the code on screen.`
      : t`Say yes or no, or answer in a sentence.`
    : "";
  return [...toUtterances(rest), ...(prompt ? [prompt] : [])];
}

function setReplyExchange(live: LiveReply, text: string) {
  if (!state || !text) return;
  const exchanges = [...state.exchanges];
  if (live.exchangeAt === null) {
    live.exchangeAt = exchanges.length;
    exchanges.push({ role: "bot", text });
  } else if (exchanges[live.exchangeAt]) {
    exchanges[live.exchangeAt] = { role: "bot", text };
  }
  set({ exchanges, heard: "" });
}

function sayChunks(live: LiveReply, chunks: string[], botId: string, messageId: string) {
  if (chunks.length === 0) return;
  if (!live.stream || live.stream.closed) {
    live.stream = speaker.speakStream({ botId, messageId, turnStartedAt: turnSentAt });
    live.abandoned = false;
  }
  awaitingReply = false;
  live.spoke = true;
  for (const chunk of chunks) {
    spokenMemory.remember(chunk);
    live.stream.push(chunk);
  }
}

/**
 * Speaks the reply from its first sentence, while the model is still writing the rest.
 * Only sentences certain to be complete are sent; the stream keeps them in order.
 */
function speakWhileWriting(message: ThreadMessage) {
  if (!state || !message.runId) return;
  const { botId } = state;
  let live = liveReply;
  if (live && live.runId !== message.runId) {
    // Another run took over: what was queued plays out, nothing more is added.
    live.stream?.end();
    live = null;
  }
  if (!live) {
    live = {
      runId: message.runId,
      messageId: message.id,
      chunker: createSpeechChunker(),
      stream: null,
      written: "",
      spoke: false,
      abandoned: false,
      exchangeAt: null,
    };
  } else if (live.messageId !== message.id) {
    // A durable message of the run in the middle of it starts its own text.
    if (!live.messageId.startsWith("progress:")) live.chunker = createSpeechChunker();
    live.messageId = message.id;
  }
  liveReply = live;
  live.written = visibleReply(message.blocks);
  const open = Boolean(live.stream && !live.stream.closed);
  if (!open && !awaitingReply) return;
  const chunks = live.chunker.push(live.written);
  sayChunks(live, chunks, botId, message.id);
  if (chunks.length > 0) setReplyExchange(live, live.written);
}

/** The caller cut in: cancel what is queued and speak nothing of what was already written. */
function abandonLiveReply() {
  const live = liveReply;
  if (!live) return;
  live.stream?.cancel();
  live.stream = null;
  live.chunker.skipTo(live.written);
  live.abandoned = true;
}

/**
 * The run ended. Speaks what is left of its reply after what was already spoken and lets
 * the speaker go idle. Returns false when nothing of it was spoken early, so the whole reply
 * is spoken the usual way.
 */
function finishLiveReply(message: ThreadMessage): boolean {
  const live = liveReply;
  if (!state || !live || live.runId !== message.runId) return false;
  if (!live.spoke && !live.abandoned) {
    liveReply = null;
    return false;
  }
  liveReply = null;
  spokenMessageIds.add(message.id);
  const run = thread?.run;
  // A run that failed or was replaced leaves a reply that is not whole: it is not finished aloud.
  const completed = run?.id === live.runId && run.status === "completed";
  const written = visibleReply(message.blocks);
  const tail = completed ? [...live.chunker.flush(written), ...afterTheText(message.blocks)] : [];
  const open = Boolean(live.stream && !live.stream.closed);
  if (open || (awaitingReply && tail.length > 0)) {
    sayChunks(live, tail, state.botId, message.id);
    live.stream?.end();
    if (tail.length > 0) setReplyExchange(live, speechFromBlocks(message.blocks));
  } else if (awaitingReply && !runActive(thread)) {
    awaitingReply = false;
    void listen();
  }
  return true;
}

/**
 * A reply is only whole once its own run stopped. Speaking a message the run is
 * still streaming clips it, and later updates of the same id never get a turn.
 */
function replyFinished(message: ThreadMessage) {
  const run = thread?.run;
  if (!run) return true;
  if (message.runId && message.runId !== run.id) return true;
  return !RUN_ACTIVE.includes(run.status);
}

function runActive(snapshot: ThreadSnapshot | null) {
  return Boolean(snapshot?.run && RUN_ACTIVE.includes(snapshot.run.status));
}

function pendingSecretAsk(snapshot: ThreadSnapshot | null) {
  const askId = latestAskId(snapshot);
  const askMessage = snapshot?.messages.find((message) => message.id === askId);
  return Boolean(
    askMessage?.blocks.some(
      (block) => block.kind === "ask" && isSecretAskBlock(block) && block.status !== "answered",
    ),
  );
}

function latestAskId(snapshot: ThreadSnapshot | null): string | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      return message.id;
    }
  }
  return null;
}
