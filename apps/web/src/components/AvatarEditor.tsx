import { AVATAR_COLORS, AVATAR_IMAGE_MAX_LENGTH, parseAvatar } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { smallImageDataUrl } from "../lib/small-image";

const PHOTO_EDGE = 256;

/**
 * Picks what a person or a space wears: a photo, or a color behind the initial. The server
 * re-encodes a photo and keeps it small, so the client only shrinks it before sending.
 */
export function AvatarEditor({
  value,
  preview,
  onSave,
}: {
  /** The stored avatar: a color, a picture or nothing. */
  value: string | null | undefined;
  /** Draws the avatar for a value, so the preview is the thing that will be shown. */
  preview: (value: string | null | undefined) => ReactNode;
  onSave: (avatar: string | null) => Promise<void>;
}) {
  const { t } = useLingui();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = parseAvatar(value);

  async function save(avatar: string | null) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSave(avatar);
    } catch {
      setError(t`Could not save`);
    } finally {
      setPending(false);
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    const url = await smallImageDataUrl(file, PHOTO_EDGE, AVATAR_IMAGE_MAX_LENGTH, "image/jpeg");
    if (!url) {
      setError(t`Could not use that image`);
      return;
    }
    await save(url);
  }

  return (
    <div className="flex flex-col items-end gap-2" data-testid="avatar-editor">
      <div className="flex items-center gap-2">
        {preview(value)}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          <Trans>Photo</Trans>
        </Button>
        {current.kind === "none" ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => save(null)}
          >
            <Trans>Remove</Trans>
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="avatar-photo-input"
          onChange={(event) => {
            void pickPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <fieldset
        aria-label={t`Color`}
        className="m-0 flex min-w-0 flex-wrap justify-end gap-2 border-0 p-0"
      >
        {AVATAR_COLORS.map((color, index) => {
          const selected =
            current.kind === "color" && current.color.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              aria-label={`${t`Color`} ${index + 1}`}
              aria-pressed={selected}
              disabled={pending}
              onClick={() => save(color)}
              style={{ backgroundColor: color }}
              className={`size-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
              }`}
            />
          );
        })}
      </fieldset>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
