import type { ChessPieceId } from "@corvo/contracts";
import { composeBotAvatarValue } from "@corvo/contracts";
import type { ReactNode } from "react";
import { BotAvatar, DEFAULT_BOT_AVATAR_COLOR } from "./bot-avatar.js";
import { cn } from "./lib/utils.js";

export type EmptyStateProps = {
  /** One short line. */
  title: ReactNode;
  /** Which chess piece stands in the middle. Default `pawn`: a beginning. */
  piece?: ChessPieceId;
  /** At most one button, shown only when there is something to do. */
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

/** Nothing here yet: a chess piece and a single line, instead of an illustration and a paragraph. */
export function EmptyState({
  title,
  piece = "pawn",
  action,
  className,
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col items-center gap-4 py-16 text-center text-body1 text-muted-foreground",
        className,
      )}
    >
      <BotAvatar color={composeBotAvatarValue(DEFAULT_BOT_AVATAR_COLOR, piece)} size={56} />
      <p>{title}</p>
      {action}
    </div>
  );
}
