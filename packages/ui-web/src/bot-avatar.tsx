import type { BotAvatarCharacterId } from "@corvo/contracts";
import { botAvatarCharacter } from "@corvo/contracts";
import type { BotColorDef } from "@corvo/core";
import {
  ACTIVE_RUN_STATUSES,
  BOT_AVATAR_COLORS,
  BOT_COLOR_LIST,
  customMascotBody,
  DEFAULT_BOT_AVATAR_COLOR,
  MASCOT_LOOKS,
  mascotForColorDef,
  mascotMood,
  resolvePersonaColorDef,
  rookRingDots,
} from "@corvo/core";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";
import { botCharacter } from "./bot-characters.js";
import type { Gaze } from "./character-avatar.js";
import { CharacterAvatar } from "./character-avatar.js";
import { MascotFace } from "./mascot-face.js";
import { useMascotGaze } from "./use-mascot-gaze.js";

/** How long the mascot smiles after the work it was doing finished. */
const HAPPY_MS = 1_600;

/** A small steady number from a name, so each mascot blinks on its own beat and never in step. */
function blinkBeat(identity: string): { every: string; delay: string } {
  let hash = 0;
  for (let i = 0; i < identity.length; i += 1) hash = (hash * 31 + identity.charCodeAt(i)) >>> 0;
  return {
    every: `${(4.2 + (hash % 30) / 10).toFixed(1)}s`,
    delay: `-${((hash >> 5) % 47) / 10}s`,
  };
}

export type { BotColorDef };
export { BOT_AVATAR_COLORS, BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

/**
 * A bot's saved look: a color (its mascot, or a character in that color) or an uploaded picture.
 * A `::shape_N` suffix from older bots is ignored.
 */
export function parseBotAvatar(
  rawColor: string,
  _identity?: string,
): {
  color: string;
  isImage: boolean;
  imageUrl?: string;
  characterId?: BotAvatarCharacterId;
} {
  if (!rawColor) return { color: "#F97316", isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  if (rawColor.startsWith("data:image/")) {
    return { color: "#F97316", isImage: true, imageUrl: rawColor };
  }
  const color = rawColor.split("::")[0] || "#F97316";
  const characterId = botAvatarCharacter(rawColor);
  return characterId ? { color, isImage: false, characterId } : { color, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultBotAvatarValue(rawColor: string): string {
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

/**
 * The shade a bot's rook is drawn in, for tinting what belongs to it (its calendar events, its
 * row). Nothing for a bot that shows a picture.
 */
export function botAccent(rawColor: string, identity = ""): string | undefined {
  const parsed = parseBotAvatar(rawColor, identity);
  if (parsed.isImage) return undefined;
  return (
    customMascotBody(parsed.color) ??
    MASCOT_LOOKS[
      mascotForColorDef(resolvePersonaColorDef(identity || parsed.color || "agent", parsed.color))
    ].color
  );
}

export interface BotAvatarProps {
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
  /**
   * Whether a character moves. Larger ones always do; a small one is a still picture unless its
   * place (a message in the conversation) asks for it.
   */
  live?: boolean;
  /** Where the avatar looks while it is live, -1..1 per axis (x right, y down). */
  lookAt?: Gaze;
}

const RING_DOTS = rookRingDots();

/**
 * The ring around a bot that is working: eight dots in its color (the working token for a photo)
 * that light up one after another, the same ring the small rook glyph thinks in.
 */
function WorkingRing({ size, color }: { size: number; color?: string }) {
  const reach = Math.max(4, Math.round(size * 0.16));
  return (
    <svg
      className={cn(
        "corvo-bot-avatar-ring corvo-bot-avatar-ring-working absolute z-10 pointer-events-none",
        color ? undefined : "fill-status-working",
      )}
      style={{ inset: -reach, width: size + reach * 2, height: size + reach * 2 }}
      viewBox="0 0 100 100"
      fill={color}
      aria-hidden="true"
    >
      {RING_DOTS.map((dot, index) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="4"
          style={{ animationDelay: `${index * 0.125}s` }}
        />
      ))}
    </svg>
  );
}

/** The small brand dot on a bot that is waiting for the person. */
function NeedsYouDot({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      data-needs-you
      className={cn(
        "corvo-rook-needs-you absolute -end-0.5 -top-0.5 z-10 rounded-full bg-brand ring-2 ring-background",
        size >= 28 ? "size-2.5" : "size-2",
      )}
    />
  );
}

export const BotAvatar = memo(function BotAvatar({
  color,
  size = 36,
  status,
  identity = "",
  className,
  live,
  lookAt,
}: BotAvatarProps) {
  const isWorking = ACTIVE_RUN_STATUSES.some((s) => s === status);
  const avatarRef = useRef<HTMLDivElement>(null);
  // Smiles for a moment when work ends well; the timer is kept apart so a later status change
  // cannot leave the smile stuck.
  const [happy, setHappy] = useState(false);
  const wasWorking = useRef(false);
  const happyTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wasWorking.current && !isWorking && status !== "failed") {
      setHappy(true);
      window.clearTimeout(happyTimer.current);
      happyTimer.current = window.setTimeout(() => setHappy(false), HAPPY_MS);
    }
    wasWorking.current = isWorking;
  }, [isWorking, status]);
  useEffect(() => () => window.clearTimeout(happyTimer.current), []);
  const mood = mascotMood(status, happy);
  useMascotGaze(avatarRef, size >= 24 && (mood === "idle" || mood === "alert"));
  const parsed = useMemo(() => parseBotAvatar(color, identity), [color, identity]);
  const mascot = useMemo(
    () =>
      mascotForColorDef(resolvePersonaColorDef(identity || parsed.color || "agent", parsed.color)),
    [identity, parsed.color],
  );
  const character = parsed.characterId ? botCharacter(parsed.characterId) : undefined;
  const eyeColor = useMemo(
    () => resolvePersonaColorDef(identity || parsed.color || "agent", parsed.color).eyeColor,
    [identity, parsed.color],
  );
  // A color of one's own gives the rook that body; a swatch keeps the shade it was drawn in.
  const body = useMemo(() => customMascotBody(parsed.color), [parsed.color]);

  if (parsed.isImage && parsed.imageUrl) {
    return (
      <div
        className={cn("corvo-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        style={{ width: size, height: size }}
      >
        <div className="corvo-bot-avatar-picture relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
          <img src={parsed.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
        {isWorking ? <WorkingRing size={size} /> : null}
        {mood === "alert" ? <NeedsYouDot size={size} /> : null}
      </div>
    );
  }

  if (character) {
    return (
      <div
        className={cn("corvo-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        data-character={character.id}
        style={{ width: size, height: size }}
      >
        <CharacterAvatar
          character={character}
          color={parsed.color}
          eyeColor={eyeColor}
          mood={mood}
          size={size}
          live={live}
          lookAt={lookAt}
        />
        {isWorking ? <WorkingRing size={size} color={parsed.color} /> : null}
        {mood === "alert" ? <NeedsYouDot size={size} /> : null}
      </div>
    );
  }

  return (
    <div
      ref={avatarRef}
      className={cn("corvo-mascot-avatar relative shrink-0 select-none", className)}
      data-working={isWorking}
      data-mascot={mascot}
      style={{ width: size, height: size }}
    >
      <span className="corvo-mascot-avatar-image relative block h-full w-full">
        <MascotFace mascot={mascot} mood={mood} blink={blinkBeat(identity || mascot)} body={body} />
      </span>
      {isWorking ? <WorkingRing size={size} color={body ?? MASCOT_LOOKS[mascot].color} /> : null}
      {mood === "alert" ? <NeedsYouDot size={size} /> : null}
    </div>
  );
});
