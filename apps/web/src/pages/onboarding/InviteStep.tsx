import { parseInviteAddresses } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { Textarea } from "@corvo/ui-web/components/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** Optional: invite the team by pasting their email addresses. Skipping leaves the space as it is. */
export function InviteStep({ onDone }: { onDone: () => void }) {
  const { t } = useLingui();
  const [addresses, setAddresses] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseInviteAddresses(addresses);
  const ready = parsed.addresses.length > 0 && parsed.rejected.length === 0;

  async function send() {
    if (pending || !ready) return;
    setPending(true);
    setError(null);
    try {
      await rpc.spaces.invitations.create({
        addresses: parsed.addresses.join("\n"),
        role: "member",
        roleIds: [],
      });
      onDone();
    } catch (err) {
      setError(errorText(err, t`Could not send invitations`));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h1 className="text-[32px] font-medium text-foreground">
        <Trans>Invite your team</Trans>
      </h1>
      <Textarea
        aria-label={t`Email addresses`}
        placeholder={t`Email addresses`}
        rows={4}
        className="mt-6"
        value={addresses}
        disabled={pending}
        onChange={(event) => setAddresses(event.target.value)}
      />
      {parsed.rejected.length > 0 ? (
        <p className="mt-2 text-xs text-destructive">{parsed.rejected.join(", ")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-2">
        <Button type="submit" disabled={pending || !ready}>
          <Trans>Invite</Trans>
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
          <Trans>Skip</Trans>
        </Button>
      </div>
    </form>
  );
}
