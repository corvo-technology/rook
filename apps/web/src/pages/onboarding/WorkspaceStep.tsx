import { SPACE_LOGO_MAX_LENGTH, SPACE_NAME_MAX_LENGTH } from "@corvo/contracts";
import { Input, NativeSelect, NativeSelectOption } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { timezoneOptions } from "../../lib/local-timezone";
import { rpc } from "../../lib/rpc";
import { smallImageDataUrl } from "../../lib/small-image";
import { errorText } from "../../lib/user-error";
import { ContinueButton } from "./OnboardingLayout";

/** The workspace's name, an optional logo and the timezone it keeps time in. */
export function WorkspaceStep({
  spaceId,
  initialName,
  initialLogo = null,
  timezone,
  onChange,
  onDone,
}: {
  spaceId: string;
  initialName: string;
  initialLogo?: string | null;
  /** The saved timezone, else the one the browser reports. */
  timezone: string;
  /** Tells the preview as the person types. */
  onChange?: (draft: { name: string; logo: string | null }) => void;
  onDone: (result: { name: string; logo: string | null }) => void;
}) {
  const { t } = useLingui();
  const headingId = useId();
  const zoneId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  // A new space is created named in English; show the person its name in their own language.
  const [name, setName] = useState(initialName === "Personal" ? t`Personal` : initialName);
  const [logo, setLogo] = useState<string | null>(initialLogo);
  const [zone, setZone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  function draft(next: { name?: string; logo?: string | null }) {
    onChange?.({ name: next.name ?? name, logo: next.logo === undefined ? logo : next.logo });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    const url = await smallImageDataUrl(file, 96, SPACE_LOGO_MAX_LENGTH);
    if (!url) {
      setError(t`Could not use that image`);
      return;
    }
    setError(null);
    setLogo(url);
    draft({ logo: url });
  }

  async function submit() {
    if (started.current) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > SPACE_NAME_MAX_LENGTH) {
      setError(t`Enter a name up to ${SPACE_NAME_MAX_LENGTH} characters.`);
      return;
    }
    started.current = true;
    setPending(true);
    setError(null);
    try {
      let saved = trimmed;
      if (trimmed !== initialName || logo !== initialLogo) {
        saved = (
          await rpc.spaces.rename({
            spaceId,
            name: trimmed,
            ...(logo !== initialLogo ? { logo } : {}),
          })
        ).name;
      }
      if (zone !== timezone) await rpc.preferences.update({ timezone: zone });
      onDone({ name: saved, logo });
    } catch (err) {
      started.current = false;
      setPending(false);
      setError(errorText(err, t`Could not save the name`));
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1 id={headingId} className="text-[32px] font-medium text-foreground">
        {t`Name your workspace`}
      </h1>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          aria-label={t`Logo`}
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted text-sm font-semibold text-muted-foreground outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {logo ? (
            <img src={logo} alt="" className="size-full object-cover" />
          ) : (
            (name.trim()[0]?.toUpperCase() ?? "+")
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="workspace-logo-input"
          onChange={(event) => {
            void pickLogo(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Input
          aria-labelledby={headingId}
          autoFocus
          maxLength={SPACE_NAME_MAX_LENGTH}
          value={name}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
            draft({ name: event.target.value });
          }}
        />
      </div>
      <label
        htmlFor={zoneId}
        className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground"
      >
        {t`Timezone`}
        <NativeSelect
          id={zoneId}
          size="sm"
          className="max-w-56"
          value={zone}
          disabled={pending}
          onChange={(event) => setZone(event.target.value)}
        >
          {timezoneOptions(zone).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ContinueButton className="mt-8 w-full" disabled={pending}>
        {t`Continue`}
      </ContinueButton>
    </form>
  );
}
