import type { AvatarLook } from "@corvo/core";
import type { AvatarDefinition } from "open-bot-avatar";
import type { MountedAvatar } from "open-bot-avatar/dom";
import { mountAvatar } from "open-bot-avatar/dom";
import { useEffect, useRef } from "react";

/**
 * From this size on a character is alive by default: it moves, blinks, looks at the pointer and
 * turns to it. A smaller one is a still picture unless its place says it is live (a message in
 * the conversation), so a long roster does not run dozens of scenes.
 */
export const LIVELY_FROM = 56;

/** Where a character looks, -1..1 per axis, x to the right and y down. */
export type Gaze = { x: number; y: number };

/**
 * A character of Open Bot Avatar in an agent's color, drawn by the project's own renderer into
 * the box it is given. It is mounted once, and a change of color, state or mood only redraws what changed.
The engine shows each state itself (and holds still under reduced motion), so nothing is drawn around it.
 */
export function CharacterAvatar({
  definition,
  color,
  eyeColor,
  look,
  size,
  live = size >= LIVELY_FROM,
  lookAt,
}: {
  definition: AvatarDefinition;
  color: string;
  eyeColor: string;
  look: Pick<AvatarLook, "state" | "mood">;
  size: number;
  live?: boolean;
  lookAt?: Gaze;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const mounted = useRef<MountedAvatar | null>(null);
  const latest = useRef({
    color,
    eyeColor,
    state: look.state,
    mood: look.mood,
    lookAt: lookAt ?? null,
  });
  latest.current = { color, eyeColor, state: look.state, mood: look.mood, lookAt: lookAt ?? null };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const avatar = mountAvatar(element, {
      definition,
      ...latest.current,
      still: !live,
      followPointer: live,
      // The agent's name is shown beside it.
      label: "",
    });
    mounted.current = avatar;
    return () => {
      avatar.destroy();
      mounted.current = null;
    };
  }, [definition, live]);

  useEffect(() => {
    mounted.current?.update({ color, eyeColor, state: look.state, mood: look.mood });
  }, [color, eyeColor, look.state, look.mood]);

  const lookX = lookAt?.x;
  const lookY = lookAt?.y;
  useEffect(() => {
    mounted.current?.update({
      lookAt: lookX === undefined || lookY === undefined ? null : { x: lookX, y: lookY },
    });
  }, [lookX, lookY]);

  return (
    <span
      ref={host}
      aria-hidden="true"
      className="corvo-character block"
      style={{ width: size, height: size }}
    />
  );
}
