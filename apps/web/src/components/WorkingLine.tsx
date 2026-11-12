import type { GroupAvatarMember } from "@corvo/ui-web";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";

/** How many faces the line shows; more agents are counted in its words. */
const WORKING_FACES = 3;

/** Who is working, in the words the line shows: names for one or two, a count beyond. */
export function workingLineText(
  names: readonly string[],
  say: {
    one: (name: string) => string;
    two: (first: string, second: string) => string;
    many: (count: number) => string;
  },
): string {
  const [first, second] = names;
  if (first && names.length === 1) return say.one(first);
  if (first && second && names.length === 2) return say.two(first, second);
  return say.many(names.length);
}

/**
 * One quiet line above a conversation's composer: the agents working in it, each with its small
 * scanning rook. It is gone when they finish, and the rook rings stand still under reduced motion.
 */
export function WorkingLine({ bots }: { bots: readonly GroupAvatarMember[] }) {
  const { t } = useLingui();
  if (bots.length === 0) return null;
  const text = workingLineText(
    bots.map((bot) => bot.name ?? t`Agent`),
    {
      one: (name) => t`${name} is working…`,
      two: (a, b) => t`${a} and ${b} are working…`,
      many: (count) => t`${count} agents are working…`,
    },
  );
  return (
    <div
      role="status"
      data-testid="working-line"
      className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground"
    >
      <span className="flex shrink-0 items-center" aria-hidden="true">
        {bots.slice(0, WORKING_FACES).map((bot, index) => (
          <BotAvatar
            key={bot.botId ?? index}
            color={bot.color}
            identity={bot.botId ?? bot.name}
            size={18}
            status={bot.status}
            className={index === 0 ? undefined : "-ms-1"}
          />
        ))}
      </span>
      <span dir="auto" className="min-w-0 truncate">
        {text}
      </span>
    </div>
  );
}
