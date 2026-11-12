import type {
  LocalListenLanguage,
  LocalSpeechModel,
  SettingsScope,
  VoiceCredential,
} from "@corvo/contracts";
import { LOCAL_LISTEN_LANGUAGES, LOCAL_VOICE_PROVIDER_ID } from "@corvo/contracts";
import {
  Button,
  Field,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Spinner,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";
import { speaker } from "../lib/tts";
import { errorText } from "../lib/user-error";

type Language = LocalListenLanguage;
const POLL_MS = 1000;

function toLanguage(value: string | undefined): Language {
  return LOCAL_LISTEN_LANGUAGES.find((language) => language === value) ?? "auto";
}

/** Language names are shown in their own language, so each reads the same everywhere. */
const LANGUAGE_NAMES: Record<Exclude<Language, "auto">, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  zh: "中文",
};

/**
 * "This computer": the models the owner downloads to this machine, to listen and to speak. A
 * model or a voice is chosen with Use, and then turns speech into text and replies into speech.
 * Nothing here asks for a key.
 */
export function LocalSpeechSection({
  scope,
  credential,
  disabled,
  onChanged,
}: {
  scope: SettingsScope;
  credential: VoiceCredential | undefined;
  disabled: boolean;
  /** Called after a change the rest of the screen should show, such as the choice being cleared. */
  onChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const languageId = useId();
  const [models, setModels] = useState<LocalSpeechModel[] | null>(null);
  const [language, setLanguage] = useState<Language>(toLanguage(credential?.language));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await rpcRef.current.voice.localModels();
      if (alive.current) setModels(next);
    } catch (err) {
      if (alive.current) setError(errorText(err, t`Could not update the speech model`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A download runs in the background; keep looking until nothing is still downloading.
  useEffect(() => {
    if (!models?.some((model) => model.state === "downloading")) return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [models, load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, t`Could not update the speech model`));
    } finally {
      if (alive.current) setBusy(false);
    }
    await load();
  }

  const connect = (model: string, chosen: Language) =>
    rpcRef.current.voice
      .connect({ scope, provider: LOCAL_VOICE_PROVIDER_ID, sttModel: model, language: chosen })
      .then(onChanged);

  // A voice is chosen on the connection, which a first choice creates.
  const chooseVoice = (id: string) =>
    (credential
      ? rpcRef.current.voice.setVoice({ scope, provider: LOCAL_VOICE_PROVIDER_ID, voiceId: id })
      : rpcRef.current.voice.connect({
          scope,
          provider: LOCAL_VOICE_PROVIDER_ID,
          voiceId: id,
          language,
        })
    ).then(onChanged);

  // The sample plays through the same speaker as replies, so Play and the conversation sound alike.
  const play = (voice: LocalSpeechModel) =>
    run(async () => {
      await speaker.speak(voice.sample ?? voice.label, {
        provider: LOCAL_VOICE_PROVIDER_ID,
        voiceId: voice.id,
        language: voice.languages[0],
      });
      if (speaker.state.error) throw new Error(speaker.state.error);
    });

  const locked = disabled || busy;

  function row(model: LocalSpeechModel, inUse: boolean, use: () => Promise<unknown>) {
    return (
      <li
        key={model.id}
        data-testid={`local-model-${model.id}`}
        className="flex items-center gap-3 px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{model.label}</div>
          <div className="text-sm text-muted-foreground">
            {Math.round(model.sizeBytes / 1_000_000)} MB
          </div>
          {model.state === "downloading" ? (
            <progress
              className="mt-2 h-1.5 w-full"
              value={model.bytesDone}
              max={model.sizeBytes}
              aria-label={t`Download progress`}
            />
          ) : null}
          {model.state === "failed" && model.error ? (
            <div className="text-sm text-destructive">{model.error}</div>
          ) : null}
        </div>
        {model.state === "downloading" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void run(() => rpcRef.current.voice.cancelLocalModelDownload({ id: model.id }))
            }
          >
            <Trans>Cancel</Trans>
          </Button>
        ) : null}
        {model.state === "absent" || model.state === "failed" ? (
          <Button
            type="button"
            size="sm"
            disabled={locked}
            onClick={() =>
              void run(() => rpcRef.current.voice.downloadLocalModel({ id: model.id }))
            }
          >
            <Trans>Download</Trans>
          </Button>
        ) : null}
        {model.state === "ready" ? (
          <>
            {model.kind === "speak" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => void play(model)}
              >
                <Trans>Play</Trans>
              </Button>
            ) : null}
            {inUse ? (
              <span className="text-sm text-muted-foreground">
                <Trans>In use</Trans>
              </span>
            ) : (
              <Button type="button" size="sm" disabled={locked} onClick={() => void run(use)}>
                <Trans>Use</Trans>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  await rpcRef.current.voice.removeLocalModel({ id: model.id });
                  await onChanged();
                })
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </>
        ) : null}
      </li>
    );
  }

  const listening = models?.filter((model) => model.kind === "listen") ?? [];
  const voices = models?.filter((model) => model.kind === "speak") ?? [];

  return (
    <div data-testid="local-speech">
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
      <Field>
        <FieldLabel htmlFor={languageId}>
          <Trans>Language</Trans>
        </FieldLabel>
        <NativeSelect
          id={languageId}
          className="w-full"
          value={language}
          disabled={locked}
          onChange={(event) => {
            const next = toLanguage(event.target.value);
            setLanguage(next);
            if (credential?.sttModel) void run(() => connect(credential.sttModel, next));
          }}
        >
          <NativeSelectOption value="auto">{t`Automatic`}</NativeSelectOption>
          {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
            <NativeSelectOption key={code} value={code}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {models === null ? (
        <Spinner className="mt-6" />
      ) : (
        <>
          <h3 className="mt-6 mb-2 text-sm font-medium text-foreground">
            <Trans>Listening</Trans>
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {listening.map((model) =>
              row(model, credential?.sttModel === model.id, () => connect(model.id, language)),
            )}
          </ul>
          <h3 className="mt-6 mb-2 text-sm font-medium text-foreground">
            <Trans>Voices</Trans>
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {voices.map((model) =>
              row(model, credential?.voiceId === model.id, () => chooseVoice(model.id)),
            )}
          </ul>
        </>
      )}
    </div>
  );
}
