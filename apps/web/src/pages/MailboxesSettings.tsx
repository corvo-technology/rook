import type { MailboxDto } from "@corvo/contracts";
import { fetchFresh } from "@corvo/core/query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
  Input,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { parseMailServer } from "../lib/mail-server";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const MAIL_SERVER_PATTERN = "[A-Za-z0-9.\\-]+(:[0-9]{1,5})?";

/** Email accounts an agent can read and send from. Sending still asks the owner. */
export function MailboxesSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const mailboxesOptions = queries.mailboxes.list.queryOptions();
  const botsOptions = queries.bots.list.queryOptions();
  const mailboxesQuery = useQuery(mailboxesOptions);
  const botsQuery = useQuery(botsOptions);
  const bots = (botsQuery.data ?? []).filter((bot) => !bot.archivedAt);
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState("");
  const [smtp, setSmtp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => fetchFresh(queryClient, mailboxesOptions);

  async function connect() {
    const imapServer = parseMailServer(imap, 993);
    const smtpServer = parseMailServer(smtp, 465);
    if (!imapServer || !smtpServer) return;
    setSaving(true);
    setError(null);
    try {
      await rpc.mailboxes.create({
        address: address.trim(),
        username: username.trim() || address.trim(),
        password,
        imap: imapServer,
        smtp: smtpServer,
      });
      setAddress("");
      setUsername("");
      setPassword("");
      setImap("");
      setSmtp("");
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(mailbox: MailboxDto, botId: string) {
    const botIds = mailbox.botIds.includes(botId)
      ? mailbox.botIds.filter((id) => id !== botId)
      : [...mailbox.botIds, botId];
    try {
      await rpc.mailboxes.setAgents({ id: mailbox.id, botIds });
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  async function remove(id: string) {
    try {
      await rpc.mailboxes.remove({ id });
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  const shownError = error ?? (mailboxesQuery.isError ? t`Could not load mailboxes` : null);

  return (
    <div className="space-y-4">
      {(mailboxesQuery.data ?? []).map((mailbox) => (
        <Card key={mailbox.id}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="truncate">{mailbox.address}</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void remove(mailbox.id)}
            >
              <Trans>Remove</Trans>
            </Button>
          </CardHeader>
          {bots.length > 0 ? (
            <CardContent>
              <Field>
                <FieldTitle>
                  <Trans>Agents:</Trans>
                </FieldTitle>
                <div className="flex flex-wrap gap-1.5">
                  {bots.map((bot) => {
                    const selected = mailbox.botIds.includes(bot.id);
                    return (
                      <Button
                        key={bot.id}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="xs"
                        aria-pressed={selected}
                        onClick={() => void toggle(mailbox, bot.id)}
                      >
                        {selected ? <Check aria-hidden="true" /> : null}
                        {bot.name}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </CardContent>
          ) : null}
        </Card>
      ))}
      <Card>
        <CardContent>
          <form
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
              {shownError ? <FieldError>{shownError}</FieldError> : null}
            </FieldGroup>
            <Button type="submit" className="mt-5 w-full" disabled={saving}>
              {saving ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
