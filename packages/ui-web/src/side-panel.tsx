import { ChevronLeft, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./components/ui/button.js";
import { cn } from "./lib/utils.js";

export type SidePanelProps = {
  /** Renders nothing while false. Drive it from the URL (`?panel=`) when it stands for an object. */
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Accessible name of the close control, already translated. */
  closeLabel: string;
  /** Pinned under the scrolling body: the primary action. */
  footer?: ReactNode;
  /** 560px instead of 420px, for a viewer. */
  wide?: boolean;
  className?: string;
  "data-testid"?: string;
  children: ReactNode;
};

/** Enter closes nothing and Esc inside an open menu belongs to the menu, so the panel leaves those alone. */
function menuIsOpen() {
  return document.querySelector('[role="listbox"], [role="menu"]') !== null;
}

/**
 * A right-hand layer for create and edit flows and for viewers. It is not a modal: no scrim, no
 * focus trap, the page behind stays visible and interactive. Esc closes it from inside the panel
 * (or with nothing focused) and focus returns to what opened it. Opening another panel replaces
 * this one because only one `?panel=` value exists. Below `sm` it fills the screen and the close
 * control becomes a back arrow. Slides in with the shared motion tokens; reduced motion shows it
 * at once.
 */
export function SidePanel({
  open,
  onClose,
  title,
  closeLabel,
  footer,
  wide,
  className,
  "data-testid": testId = "side-panel-layer",
  children,
}: SidePanelProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The first field asks for focus with data-autofocus; otherwise the panel itself takes it.
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? node)?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      const inside = target instanceof Node && node?.contains(target);
      if (!inside && target !== document.body) return;
      if (menuIsOpen()) return;
      event.preventDefault();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-testid={testId}
      data-slot="side-panel"
      className={cn(
        "animate-panel-in fixed inset-y-0 end-0 z-40 flex w-full flex-col bg-popover text-popover-foreground shadow-overlay outline-none sm:inset-y-2 sm:end-2 sm:w-[420px] sm:max-w-[calc(100vw-1rem)] sm:rounded-2xl",
        wide && "sm:w-[560px]",
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-5 pt-5 pb-3 sm:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ms-2 sm:hidden"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <ChevronLeft className="rtl:rotate-180" />
        </Button>
        <h2 id={titleId} className="min-w-0 flex-1 text-heading2 font-normal">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-me-2 hidden sm:inline-flex"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="rk-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6">
        {children}
      </div>
      {footer ? (
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3 sm:px-6">
          {footer}
        </footer>
      ) : null}
    </aside>,
    document.body,
  );
}
