import { mascotHex } from "@corvo/core";
import { BotAvatar } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import type { FormEvent, ReactNode } from "react";

/** The team beside the form: three rooks sitting on the panel's lower edge, the middle one in front. */
const TEAM = [
  { color: mascotHex("pink"), id: "davi", size: 150, className: "bottom-[-0.5rem] left-[6%]" },
  { color: mascotHex("mint"), id: "ana", size: 210, className: "bottom-[-1rem] left-[34%] z-10" },
  { color: mascotHex("blue"), id: "bento", size: 140, className: "right-[6%] bottom-[-0.5rem]" },
] as const;

/**
 * The page around every sign-in screen: the form on the left, and on wide screens what the
 * product does beside it, so someone who has never heard of it sees more than a field to fill.
 */
export function AuthFrame({
  title,
  onSubmit,
  children,
}: {
  title: ReactNode;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-full bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="flex min-h-full flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div
          data-testid="auth-brand"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <BotAvatar color={mascotHex("mint")} identity="ana" size={28} />
          Rook
        </div>
        <form onSubmit={onSubmit} className="my-auto flex w-full max-w-[400px] flex-col py-12">
          <h1
            aria-live="polite"
            className="mb-8 text-[32px] leading-[1.1] font-medium tracking-tight text-balance"
          >
            {title}
          </h1>
          {children}
        </form>
      </div>
      <aside
        data-testid="auth-team"
        className="relative hidden overflow-hidden border-s border-border bg-card p-14 lg:flex"
      >
        <p className="max-w-[22rem] text-[28px] leading-[1.15] font-medium tracking-tight text-balance">
          <Trans>Bots that handle your inbox and invoices, and ask before they act</Trans>
        </p>
        {TEAM.map(({ color, id, size, className }) => (
          <span
            key={id}
            aria-hidden="true"
            className={`absolute motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-700 ${className}`}
          >
            <BotAvatar color={color} identity={id} size={size} />
          </span>
        ))}
      </aside>
    </div>
  );
}
