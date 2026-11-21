import type { PresenceStatus } from "@corvo/contracts";
import { avatarInk, parseAvatar } from "@corvo/contracts";
import { personInitials } from "@corvo/core";
import { useState } from "react";

export { personInitials };

/** The token a presence dot wears: online is success, away is warning, offline has no dot. */
export function presenceDotClass(status: PresenceStatus | undefined): string | null {
  if (status === "online") return "bg-success";
  if (status === "away") return "bg-warning";
  return null;
}

/**
 * A person's picture, or their initials on a chosen color (a quiet gray until they choose one).
 * Always a circle of initials, never a character: agents are the ones that wear those.
 */
export function PersonAvatar({
  name,
  image,
  size = 24,
  presence,
  ringClassName = "ring-background",
}: {
  name: string;
  image?: string | null;
  size?: number;
  /** Shown as a dot at the corner; offline and unknown show none. */
  presence?: PresenceStatus;
  /** The ring that separates the dot from what is behind it. */
  ringClassName?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const dot = presenceDotClass(presence);
  const avatar = parseAvatar(image);
  const src = avatar.kind === "image" ? avatar.src : null;
  const color = avatar.kind === "color" ? avatar.color : null;
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        style={{
          fontSize: Math.round(size * 0.4),
          ...(color ? { backgroundColor: color, color: avatarInk(color) } : {}),
        }}
        className="grid size-full place-items-center overflow-hidden rounded-full border border-border bg-muted font-semibold text-foreground"
      >
        {src && failed !== src ? (
          <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} />
        ) : (
          personInitials(name)
        )}
      </span>
      {dot ? (
        <span
          data-presence={presence}
          className={`absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ${ringClassName} ${dot}`}
        />
      ) : null}
    </span>
  );
}
