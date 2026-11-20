import type { PlatformPartnerLead, PlatformWaitlistEntry } from "@corvo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Spinner,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageTitle } from "../../components/PageHeader";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { NewPartnerDialog } from "./NewPartnerDialog";

type Entry = PlatformWaitlistEntry;
type Lead = PlatformPartnerLead;

function useDecisionLabels() {
  const { t } = useLingui();
  return { pending: t`Pending`, approved: t`Approved`, declined: t`Declined` } as const;
}

/** Pending first, then what was decided. */
const byStatus = <T extends { status: string }>(rows: T[]) =>
  [...rows].sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending"));

export function WaitlistSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const labels = useDecisionLabels();
  const list = useQuery(queries.platform.waitlist.list.queryOptions());
  const decide = useMutation({
    ...queries.platform.waitlist.decide.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: queries.platform.waitlist.key() }),
  });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale || "en", { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6" data-testid="platform-waitlist">
      <PageTitle>{t`Waitlist`}</PageTitle>
      {list.error || decide.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(list.error ?? decide.error, t`Could not load`)}
        </p>
      ) : null}
      {!list.data ? (
        list.error ? null : (
          <Spinner />
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {byStatus<Entry>(list.data).map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{entry.company}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {[entry.email, entry.task, entry.locale, date(entry.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {entry.status === "pending" ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: entry.id, decision: "approved" })}
                  >
                    {t`Approve`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: entry.id, decision: "declined" })}
                  >
                    {t`Decline`}
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{labels[entry.status]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PartnerLeadsSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const labels = useDecisionLabels();
  const list = useQuery(queries.platform.partnerLeads.list.queryOptions());
  const [approving, setApproving] = useState<Lead | null>(null);
  const [declining, setDeclining] = useState<Lead | null>(null);
  const [reason, setReason] = useState("");
  const decline = useMutation({
    ...queries.platform.partnerLeads.decline.mutationOptions(),
    onSuccess: async () => {
      setDeclining(null);
      setReason("");
      await client.invalidateQueries({ queryKey: queries.platform.partnerLeads.key() });
    },
  });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale || "en", { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6" data-testid="platform-leads">
      <PageTitle>{t`Partner applications`}</PageTitle>
      {list.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(list.error, t`Could not load`)}
        </p>
      ) : null}
      {!list.data ? (
        list.error ? null : (
          <Spinner />
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {byStatus<Lead>(list.data).map((lead) => (
            <li key={lead.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {lead.company}{" "}
                  <span className="font-normal text-muted-foreground">{lead.name}</span>
                </div>
                <div className="break-words text-sm text-muted-foreground">
                  {[lead.email, lead.whatsapp, lead.website].filter(Boolean).join(" · ")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {[lead.partnerType, lead.country, lead.customers, date(lead.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {lead.message ? <p className="mt-1 text-sm">{lead.message}</p> : null}
              </div>
              {lead.status === "pending" ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setApproving(lead)}>
                    {t`Approve`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(lead)}>
                    {t`Decline`}
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{labels[lead.status]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {approving ? <NewPartnerDialog lead={approving} onClose={() => setApproving(null)} /> : null}
      <AlertDialog open={declining !== null} onOpenChange={(open) => !open && setDeclining(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`Decline application`}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            aria-label={t`Reason (optional)`}
            placeholder={t`Reason (optional)`}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction
              disabled={decline.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (declining) {
                  decline.mutate({ id: declining.id, ...(reason.trim() ? { reason } : {}) });
                }
              }}
            >
              {t`Decline`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
