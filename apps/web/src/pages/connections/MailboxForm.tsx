import type { MailboxDto } from "@corvo/contracts";
import { Button, Field, FieldError, FieldGroup, FieldLabel, Input } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { parseMailServer } from "../../lib/mail-server";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

const MAIL_SERVER_PATTERN = "[A-Za-z0-9.\\-]+(:[0-9]{1,5})?";

/** An email account an agent can read and send from. The login is checked before it is saved. */
export function MailboxForm({
  onSaved,
  onCancel,
}: {
  onSaved: (mailbox: MailboxDto) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState("");
  const [smtp, setSmtp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const imapServer = parseMailServer(imap, 993);
    const smtpServer = parseMailServer(smtp, 465);
    if (!imapServer || !smtpServer) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await rpc.mailboxes.create({
          address: address.trim(),
          username: username.trim() || address.trim(),
          password,
          imap: imapServer,
          smtp: smtpServer,
        }),
      );
    } catch (failure) {
      setError(errorText(failure, t`Could not save`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      data-testid="mailbox-form"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="mailbox-address">
            <Trans>Email</Trans>
          </FieldLabel>
          <Input
            id="mailbox-address"
            type="email"
            autoComplete="off"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mailbox-username">
            <Trans>Username</Trans>
          </FieldLabel>
          <Input
            id="mailbox-username"
            autoComplete="off"
            value={username}
            placeholder={address}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mailbox-password">
            <Trans>Password</Trans>
          </FieldLabel>
          <Input
            id="mailbox-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mailbox-imap">
            <Trans>IMAP server</Trans>
          </FieldLabel>
          <Input
            id="mailbox-imap"
            autoComplete="off"
            required
            pattern={MAIL_SERVER_PATTERN}
            placeholder="imap.example.com"
            value={imap}
            onChange={(event) => setImap(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mailbox-smtp">
            <Trans>SMTP server</Trans>
          </FieldLabel>
          <Input
            id="mailbox-smtp"
            autoComplete="off"
            required
            pattern={MAIL_SERVER_PATTERN}
            placeholder="smtp.example.com"
            value={smtp}
            onChange={(event) => setSmtp(event.target.value)}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <div className="mt-5 flex gap-2">
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </form>
  );
}
