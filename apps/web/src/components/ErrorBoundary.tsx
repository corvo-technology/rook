import { Button, SidePanel } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentType, ReactNode } from "react";
import { Component } from "react";
import { lazyComponent } from "../lib/preload-recovery";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

/** Keeps a render failure (or a lazy chunk that failed to load) inside its subtree. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Inline fallback for a lazily loaded section inside an otherwise working panel. */
export function SectionLoadFailed() {
  return (
    <div className="px-2.5 pb-2 text-[13px] text-destructive">
      <Trans>Could not load</Trans>
    </div>
  );
}

/** The failure renders in place of the overlay, as a panel with the one way out. */
function OverlayLoadFailed({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  return (
    <SidePanel
      open
      onClose={onClose}
      title={<Trans>Could not load</Trans>}
      closeLabel={t`Close`}
      footer={
        <Button onClick={() => window.location.reload()}>
          <Trans>Refresh</Trans>
        </Button>
      }
    >
      {null}
    </SidePanel>
  );
}

/**
 * Lazy-loads an overlay. If its chunk fails to load (network blip, missing
 * chunk) or it throws while rendering, the shell and the composer draft stay
 * up. Browsers keep a failed module import for the page's lifetime, so loading
 * the chunk again takes a page refresh.
 */
export function lazyOverlay<Props extends { onClose: () => void }>(
  load: () => Promise<ComponentType<Props>>,
) {
  const Overlay = lazyComponent(load);
  return function LazyOverlay(props: Props) {
    return (
      <ErrorBoundary fallback={<OverlayLoadFailed onClose={props.onClose} />}>
        <Overlay {...props} />
      </ErrorBoundary>
    );
  };
}
