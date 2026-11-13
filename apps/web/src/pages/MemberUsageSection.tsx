import type { MemberUsage } from "@corvo/contracts";
import { Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { formatTokens } from "../lib/context-meter";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

function limitText(limit: number | null) {
  return limit ? String(limit) : "";
}

function MemberRow({ member, onSaved }: { member: MemberUsage; onSaved: () => void }) {
  const { t, i18n } = useLingui();
  const rpc = useSpaceRpc();
  const saved = limitText(member.monthlyTokenLimit);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const { name } = member;
  const tokens = formatTokens(member.monthTokens, i18n.locale);

  async function save() {
    const digits = text.replace(/\D/g, "");
    const next = digits ? Number(digits) : null;
    setText(limitText(next));
    if (next === (member.monthlyTokenLimit || null)) return;
    setError(null);
    try {
      await rpc.usage.setMemberLimit({ userId: member.userId, monthlyTokenLimit: next });
      onSaved();
    } catch (err) {
      setText(saved);
      setError(errorText(err));
    }
  }

  return (
    <SettingsRow
      label={name}
      control={
        <>
          <span className="text-[13px] tabular-nums text-muted-foreground">{t`${tokens} tokens`}</span>
          <Input
            className="h-9 w-32 text-right tabular-nums"
            inputMode="numeric"
            value={text}
            placeholder={t`No limit`}
            aria-label={t`Monthly token limit for ${name}`}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </>
      }
    >
      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SettingsRow>
  );
}

/** What each member used this month, with their limit on the lent models; for owners only. */
export function MemberUsageSection() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const workspace = useQuery(queries.models.workspaceModel.queryOptions());
  const members = useQuery({
    ...queries.usage.members.queryOptions(),
    enabled: workspace.data?.isOwner === true,
  });
  if (!members.data || members.data.length < 2) return null;
  const rows = members.data;
  return (
    <div className="mt-4" data-testid="member-usage">
      <SettingsGroup title={t`Members`}>
        {rows.map((member) => (
          <MemberRow
            key={`${member.userId}:${member.monthlyTokenLimit ?? ""}`}
            member={member}
            onSaved={() =>
              void queryClient.invalidateQueries({ queryKey: queries.usage.members.queryKey() })
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
