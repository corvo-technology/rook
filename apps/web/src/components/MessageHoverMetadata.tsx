import type { ReactNode } from "react";

/**
 * The actions of a message: a small toolbar over the row's top corner on pointers that hover, shown
 * while the row is pointed at or holds focus (so the keyboard reaches it), and in flow below the
 * message on touch once the message is tapped.
 */
export function MessageHoverMetadata({
  pinned = false,
  children,
}: {
  pinned?: boolean;
  children: ReactNode;
}) {
  // Written out in full: Tailwind finds classes by scanning for them, not by running this code.
  const reveal = pinned
    ? "pointer-events-auto opacity-100"
    : "pointer-events-auto opacity-100 [@media(hover:none)]:hidden [@media(hover:none)]:group-data-[actions=open]/message:flex [@media(hover:hover)_and_(pointer:fine)]:pointer-events-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-within:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100";

  return (
    <div
      data-testid="message-hover-rail"
      className={`z-10 flex items-center transition-opacity ${reveal} [@media(hover:hover)_and_(pointer:fine)]:absolute [@media(hover:hover)_and_(pointer:fine)]:-top-3 [@media(hover:hover)_and_(pointer:fine)]:end-2 [@media(hover:hover)_and_(pointer:fine)]:rounded-md [@media(hover:hover)_and_(pointer:fine)]:border [@media(hover:hover)_and_(pointer:fine)]:border-border [@media(hover:hover)_and_(pointer:fine)]:bg-popover [@media(hover:hover)_and_(pointer:fine)]:p-0.5 [@media(hover:hover)_and_(pointer:fine)]:shadow-raised [@media(hover:none)]:mt-1 [@media(hover:none)]:w-full [@media(hover:none)]:justify-start`}
    >
      {children}
    </div>
  );
}
