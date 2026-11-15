import type { NavLink } from "@corvo/contracts";
import { AppMarkStack, Button, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Download, Link2, LogOut, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { useSidebarUpdate } from "./DesktopUpdates";
import { IconTooltip } from "./IconTooltip";

type Props = {
  mini?: boolean;
  name: string;
  initials: string | null;
  image?: string | null;
  logos?: Array<{ name: string; logo?: string | null }>;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIntegrations: () => void;
  links?: NavLink[];
  onLink?: (link: NavLink) => void;
  onSettings: () => void;
  onLogOut: () => void;
  signingOut: boolean;
  logOutError: string | null;
  /** On the person's own computer there is no account to show or to leave. */
  localEdition?: boolean;
  /** A partner leaves the Store out for its customers. */
  hideStore?: boolean;
  /** The bell that opens the inbox. */
  inbox?: ReactNode;
  /** Subscription usage, beside the bell; nothing when no subscription has reported. */
  usage?: ReactNode;
};

// Marks are 24px wide, overlap by 2px, and need 2px for the outer ring.
export function sidebarMarkCount(availableWidth: number) {
  return Math.max(0, Math.min(3, Math.floor((availableWidth - 26) / 22) + 1));
}

export function SidebarFooter({
  mini = false,
  name,
  initials,
  image,
  logos = [],
  email,
  open,
  onOpenChange,
  onIntegrations,
  links = [],
  onLink,
  onSettings,
  onLogOut,
  signingOut,
  logOutError,
  localEdition = false,
  hideStore = false,
  inbox,
  usage,
}: Props) {
  const { t } = useLingui();
  const update = useSidebarUpdate();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [markCount, setMarkCount] = useState(3);
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const label = labelRef.current;
    if (!pill || !label || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const style = getComputedStyle(pill);
      const available =
        pill.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight) -
        label.scrollWidth -
        Number.parseFloat(style.columnGap);
      setMarkCount(sidebarMarkCount(available));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pill);
    observer.observe(label);
    measure();
    return () => observer.disconnect();
  }, [mini]);
  const avatar =
    image && failedImage !== image ? (
      <img
        src={image}
        alt=""
        className="size-full object-cover"
        onError={() => setFailedImage(image)}
      />
    ) : initials ? (
      initials
    ) : (
      <UserRound size={16} aria-hidden="true" />
    );
  return (
    <div
      data-testid="sidebar-footer"
      className={`flex shrink-0 border-t border-sidebar-border ${mini ? "flex-col items-center gap-2 px-1 py-2" : "flex-col gap-2 px-2.5 py-2"}`}
    >
      {!mini && !hideStore ? (
        <Button
          variant="outline"
          ref={pillRef}
          onClick={onIntegrations}
          className="h-8 min-w-0 justify-between bg-sidebar-accent text-nav hover:border-foreground/30 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
        >
          <span ref={labelRef} className="min-w-0 truncate">
            <Trans>Store</Trans>
          </span>
          <AppMarkStack marks={logos.slice(0, markCount)} ringClassName="ring-sidebar-accent" />
        </Button>
      ) : null}
      <div className={`flex items-center gap-1 ${mini ? "flex-col" : ""}`}>
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger
            data-testid="user-menu-trigger"
            aria-label={t`Account menu for ${name}`}
            className={`flex min-w-0 items-center gap-2 rounded-md text-start outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${mini ? "p-0.5" : "h-9 flex-1 px-1.5"}`}
          >
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-sidebar-accent text-meta font-medium text-foreground">
              {avatar}
            </span>
            {mini ? null : (
              <span className="min-w-0 flex-1 truncate text-nav font-medium text-sidebar-foreground">
                {name}
              </span>
            )}
          </PopoverTrigger>
          {open ? (
            <PopoverContent
              side="top"
              sideOffset={8}
              align="start"
              className="max-h-(--available-height) w-[295px] max-w-[calc(100vw-69px)] gap-0 overflow-y-auto p-1 *:shrink-0 data-closed:animate-none"
            >
              <div
                data-testid="account-menu-header"
                className="mb-1 min-w-0 border-b border-border px-2.5 py-2.5"
              >
                <p className="truncate text-sm font-medium">{name}</p>
                {!localEdition && email && email !== name ? (
                  <p className="truncate text-xs text-muted-foreground">{email}</p>
                ) : null}
              </div>
              {links.map((link) => (
                <Button
                  key={link.id}
                  variant="ghost"
                  className="h-9 w-full justify-start gap-2.5 font-normal"
                  onClick={() => onLink?.(link)}
                >
                  <Link2 className="text-muted-foreground" strokeWidth={1.75} />
                  {link.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                aria-label={t`Settings`}
                onClick={onSettings}
              >
                <Settings className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Settings</Trans>
              </Button>
              {localEdition ? null : (
                <>
                  <div className="my-1 border-t border-border" />
                  <Button
                    variant="ghost"
                    className="h-9 w-full justify-start gap-2.5 font-normal"
                    disabled={signingOut}
                    onClick={onLogOut}
                  >
                    <LogOut className="text-muted-foreground" strokeWidth={1.75} />
                    <Trans>Log out</Trans>
                  </Button>
                  {logOutError ? (
                    <p role="alert" className="px-2.5 pt-1 pb-2 text-[13px] text-destructive">
                      {logOutError}
                    </p>
                  ) : null}
                </>
              )}
            </PopoverContent>
          ) : null}
        </Popover>
        {mini ? null : usage}
        {mini ? null : inbox}
        {update.available ? (
          <IconTooltip label={t`Install update`}>
            <Button
              size="icon-lg"
              className="rounded-full"
              aria-label={t`Install update`}
              disabled={update.busy}
              onClick={update.install}
            >
              <Download aria-hidden="true" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>
    </div>
  );
}
