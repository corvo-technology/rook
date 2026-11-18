import type { WorkArea } from "@corvo/contracts";
import { WORK_AREAS } from "@corvo/contracts";
import { Button, Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { PersonAvatar } from "../../components/PersonAvatar";
import { authClient } from "../../lib/auth";
import { rpc } from "../../lib/rpc";
import { smallImageDataUrl } from "../../lib/small-image";
import { errorText } from "../../lib/user-error";
import { useWorkAreaLabels } from "./labels";
import { ContinueButton } from "./OnboardingLayout";

const PHOTO_EDGE = 128;
const PHOTO_MAX_LENGTH = 40_000;

/** The person: a photo (initials until there is one), their name and what they look after. */
export function YouStep({
  initialName,
  initialImage,
  initialAreas,
  onChange,
  onDone,
}: {
  initialName: string;
  initialImage: string | null;
  initialAreas: readonly WorkArea[];
  onChange?: (draft: { name: string; image: string | null; areas: WorkArea[] }) => void;
  onDone: (result: { name: string; image: string | null; areas: WorkArea[] }) => void;
}) {
  const { t } = useLingui();
  const labels = useWorkAreaLabels();
  const nameId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [image, setImage] = useState<string | null>(initialImage);
  const [areas, setAreas] = useState<WorkArea[]>([...initialAreas]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  function draft(next: { name?: string; image?: string | null; areas?: WorkArea[] }) {
    onChange?.({
      name: next.name ?? name,
      image: next.image === undefined ? image : next.image,
      areas: next.areas ?? areas,
    });
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    const url = await smallImageDataUrl(file, PHOTO_EDGE, PHOTO_MAX_LENGTH, "image/jpeg");
    if (!url) {
      setError(t`Could not use that image`);
      return;
    }
    setError(null);
    setImage(url);
    draft({ image: url });
  }

  async function submit() {
    if (started.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t`Enter your name`);
      return;
    }
    started.current = true;
    setPending(true);
    setError(null);
    try {
      if (trimmed !== initialName || image !== initialImage) {
        const result = await authClient.updateUser({
          ...(trimmed !== initialName ? { name: trimmed } : {}),
          ...(image !== initialImage ? { image } : {}),
        });
        if (result.error) throw new Error(result.error.message);
      }
      await rpc.onboarding.saveAreas({ areas });
      onDone({ name: trimmed, image, areas });
    } catch (err) {
      started.current = false;
      setPending(false);
      setError(errorText(err, t`Could not save`));
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-[32px] font-medium text-foreground">{t`About you`}</h1>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          aria-label={t`Photo`}
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PersonAvatar name={name || "?"} image={image} size={40} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="person-photo-input"
          onChange={(event) => {
            void pickPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Input
          id={nameId}
          aria-label={t`Name`}
          autoFocus
          value={name}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
            draft({ name: event.target.value });
          }}
        />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{t`What do you look after?`}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {WORK_AREAS.map((area) => (
          <Button
            key={area}
            type="button"
            size="sm"
            variant={areas.includes(area) ? "secondary" : "outline"}
            aria-pressed={areas.includes(area)}
            disabled={pending}
            onClick={() => {
              const next = areas.includes(area)
                ? areas.filter((item) => item !== area)
                : [...areas, area];
              setAreas(next);
              draft({ areas: next });
            }}
          >
            {labels[area]}
          </Button>
        ))}
      </div>
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
