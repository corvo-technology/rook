import { useState } from "react";

/** A person's picture, or their initial: the one place a person, unlike an agent, wears no colour. */
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
  const initial = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted font-medium text-foreground"
    >
      {image && failed !== image ? (
        <img
          src={image}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(image)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
