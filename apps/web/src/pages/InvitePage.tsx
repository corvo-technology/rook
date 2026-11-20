import { Button, Spinner } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AuthFrame } from "../components/AuthFrame";
import { useBrand } from "../lib/brand";
import { selectSpace } from "../lib/rpc";
import { inkClass, submitClass } from "./Auth";

type Preview =
  | {
      state: "pending";
      spaceName: string;
      inviterName: string;
      email: string;
      role: "owner" | "admin" | "member";
      roleNames: string[];
      hasAccount: boolean;
    }
  | { state: "accepted" }
  | { state: "expired"; inviterName: string };

/**
 * Where a link from an invitation email or a workspace invite link lands. The server answers every
 * refusal alike, so a dead link and a forged one read the same.
 */
export function InvitePage({ kind, token }: { kind: "invite" | "join"; token: string }) {
  const brand = useBrand();
  const [preview, setPreview] = useState<Preview | "gone" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const { t } = useLingui();
  // The invitation email's link carries a proof of the mailbox; a copied link does not.
  const mail = new URLSearchParams(window.location.search).get("mail");

  useEffect(() => {
    if (kind !== "invite") return;
    let active = true;
    setPreview(null);
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then(async (response): Promise<Preview | "gone" | "error"> => {
        if (response.ok) return (await response.json()) as Preview;
        return response.status >= 500 ? "error" : "gone";
      })
      .catch((): "error" => "error")
      .then((next) => {
        if (active) setPreview(next);
      });
    return () => {
      active = false;
    };
  }, [kind, token, attempt]);

  async function submit() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const path =
        kind === "invite"
          ? `/api/v1/invitations/${encodeURIComponent(token)}/accept${mail ? `?mail=${encodeURIComponent(mail)}` : ""}`
          : `/api/v1/join/${encodeURIComponent(token)}`;
      const response = await fetch(path, { method: "POST", credentials: "include" });
      if (response.status === 403) {
        setUnverified(true);
        return;
      }
      if (!response.ok) throw new Error("refused");
      const body = (await response.json()) as { spaceId?: string; status?: string };
      if (kind === "invite" && body.spaceId) {
        selectSpace(body.spaceId);
        window.location.assign("/app");
      } else if (body.status === "member") {
        window.location.assign("/app");
      } else {
        setAsked(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const gone = preview === "gone" || failed;
  const loadFailed = preview === "error";
  const pendingPreview =
    preview && preview !== "gone" && preview !== "error" && preview.state === "pending"
      ? preview
      : null;
  const dead =
    preview && preview !== "gone" && preview !== "error" && preview.state !== "pending"
      ? preview
      : null;
  const roleLabel = pendingPreview
    ? pendingPreview.roleNames.length > 0
      ? pendingPreview.roleNames.join(", ")
      : pendingPreview.role === "owner"
        ? t`Owner`
        : pendingPreview.role === "admin"
          ? t`Admin`
          : t`Member`
    : "";
  return (
    <AuthFrame
      title={
        loadFailed ? (
          <Trans>Could not load</Trans>
        ) : gone ? (
          <Trans>This link no longer works</Trans>
        ) : asked ? (
          <Trans>Request sent</Trans>
        ) : kind === "invite" ? (
          dead ? (
            dead.state === "accepted" ? (
              <Trans>This invitation was already accepted</Trans>
            ) : (
              <Trans>This invitation expired</Trans>
            )
          ) : pendingPreview ? (
            <Trans>
              {pendingPreview.inviterName} invited you to {pendingPreview.spaceName}
            </Trans>
          ) : null
        ) : (
          <Trans>Ask to join</Trans>
        )
      }
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {loadFailed ? (
        <Button
          type="button"
          className={`${submitClass} ${inkClass}`}
          onClick={() => setAttempt((count) => count + 1)}
        >
          <Trans>Try again</Trans>
        </Button>
      ) : kind === "invite" && !preview ? (
        <Spinner className="mx-auto" />
      ) : dead?.state === "accepted" ? (
        <a href="/app" className="text-[14px] font-medium underline">
          {brand ? <Trans>Open {brand.name}</Trans> : <Trans>Open Rook</Trans>}
        </a>
      ) : dead?.state === "expired" ? (
        <p className="text-[14px] text-muted-foreground">
          <Trans>Ask {dead.inviterName} for a new one</Trans>
        </p>
      ) : gone || asked ? null : (
        <>
          {pendingPreview ? (
            <p className="mb-6 text-[14px] text-muted-foreground">
              {pendingPreview.email} · {roleLabel}
            </p>
          ) : null}
          {unverified ? (
            <p role="alert" className="mb-4 text-[14px] text-destructive">
              <Trans>Confirm your email first, then open this link again</Trans>
            </p>
          ) : null}
          <Button type="submit" className={`${submitClass} ${inkClass}`} disabled={pending}>
            {kind === "invite" ? <Trans>Join</Trans> : <Trans>Ask to join</Trans>}
          </Button>
        </>
      )}
    </AuthFrame>
  );
}
