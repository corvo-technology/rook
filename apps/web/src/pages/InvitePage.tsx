import { Button } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AuthFrame } from "../components/AuthFrame";
import { selectSpace } from "../lib/rpc";
import { inkClass, submitClass } from "./Auth";

type Preview = { spaceName: string; inviterName: string };

/**
 * Where a link from an invitation email or a workspace invite link lands. The server answers every
 * refusal alike, so a dead link and a forged one read the same.
 */
export function InvitePage({ kind, token }: { kind: "invite" | "join"; token: string }) {
  const [preview, setPreview] = useState<Preview | "gone" | null>(null);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (kind !== "invite") return;
    let active = true;
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then(
        async (response): Promise<Preview | "gone"> =>
          response.ok ? ((await response.json()) as Preview) : "gone",
      )
      .catch((): "gone" => "gone")
      .then((next) => {
        if (active) setPreview(next);
      });
    return () => {
      active = false;
    };
  }, [kind, token]);

  async function submit() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const path =
        kind === "invite"
          ? `/api/v1/invitations/${encodeURIComponent(token)}/accept`
          : `/api/v1/join/${encodeURIComponent(token)}`;
      const response = await fetch(path, { method: "POST", credentials: "include" });
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
  return (
    <AuthFrame
      title={
        gone ? (
          <Trans>This link no longer works</Trans>
        ) : asked ? (
          <Trans>Request sent</Trans>
        ) : kind === "invite" ? (
          preview ? (
            <Trans>
              {preview.inviterName} invited you to {preview.spaceName}
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
      {gone || asked || (kind === "invite" && !preview) ? null : (
        <Button type="submit" className={`${submitClass} ${inkClass}`} disabled={pending}>
          {kind === "invite" ? <Trans>Join</Trans> : <Trans>Ask to join</Trans>}
        </Button>
      )}
    </AuthFrame>
  );
}
