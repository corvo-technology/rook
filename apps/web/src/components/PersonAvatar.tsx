import { useState } from "react";

/** Up to two letters: the first of the first and last word, or the first two of a single name. */
export function personInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = words[0];
  if (!first) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letters = last
    ? `${[...first][0] ?? ""}${[...last][0] ?? ""}`
    : [...first].slice(0, 2).join("");
  return letters.toUpperCase();
}

/** A person's picture, or their initials: the one place a person, unlike an agent, wears no colour. */
export function PersonAvatar({
  name,
  image,
  size = 24,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted font-semibold text-foreground"
    >
      {image && failed !== image ? (
        <img
          src={image}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(image)}
        />
      ) : (
        personInitials(name)
      )}
    </span>
  );
}
