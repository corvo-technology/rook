import { avatarInk, parseAvatar } from "@corvo/contracts";
import { useState } from "react";

/**
 * A space's mark: its picture, or its initial on a chosen color (ink until one is chosen). A
 * rounded square where a person is a circle, so the two never read as the same thing.
 */
export function SpaceAvatar({
  name,
  logo,
  size = 34,
  className = "bg-primary text-primary-foreground",
}: {
  name: string;
  logo?: string | null;
  size?: number;
  /** The look before a color is chosen. */
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const avatar = parseAvatar(logo);
  const src = avatar.kind === "image" ? avatar.src : null;
  const color = avatar.kind === "color" ? avatar.color : null;
  return (
    <span
      aria-hidden="true"
      data-testid="space-avatar"
      className={`grid shrink-0 place-items-center overflow-hidden font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.42),
        ...(color ? { backgroundColor: color, color: avatarInk(color) } : {}),
      }}
    >
      {src && failed !== src ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        (Array.from(name.trim())[0]?.toUpperCase() ?? "?")
      )}
    </span>
  );
}
