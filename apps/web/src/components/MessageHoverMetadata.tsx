import type { ReactNode } from "react";

/**
 * The actions of a message: a small toolbar over the row's top corner on pointers that hover, shown
 * while the row is pointed at or holds focus (so the keyboard reaches it), and in flow below the
 * message on touch.
 */
export function MessageHoverMetadata({
  pinned = false,
  children,
}: {
  pinned?: boolean;
  children: ReactNode;
}) {
  const fine = "[@media(hover:hover)_and_(pointer:fine)]";
  const reveal = pinned
    ? "pointer-events-auto opacity-100"
    : `pointer-events-auto opacity-100 ${fine}:pointer-events-none ${fine}:opacity-0 ${fine}:group-hover/message:pointer-events-auto ${fine}:group-hover/message:opacity-100 ${fine}:focus-within:pointer-events-auto ${fine}:focus-within:opacity-100`;

  return (
    <div
      data-testid="message-hover-rail"
      className={`z-10 flex items-center transition-opacity ${reveal} ${fine}:absolute ${fine}:end-2 ${fine}:-top-3 ${fine}:rounded-md ${fine}:border ${fine}:border-border ${fine}:bg-popover ${fine}:p-0.5 ${fine}:shadow-raised [@media(hover:none)]:mt-1 [@media(hover:none)]:w-full [@media(hover:none)]:justify-start`}
    >
      {children}
    </div>
  );
}
