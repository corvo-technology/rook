import { mascotHex } from "@corvo/core";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { PersonAvatar } from "../../components/PersonAvatar";

export type PreviewAgent = { key: string; name: string; color: string };

/**
 * A miniature of the workspace sidebar that fills in as the person answers: the workspace's name
 * and logo, the channels and agents the team will start with, and the person at the bottom.
 */
export function OnboardingPreview({
  workspaceName,
  logo,
  chiefName,
  agents,
  channels,
  personName,
  personImage,
}: {
  workspaceName: string;
  logo: string | null;
  chiefName: string;
  agents: readonly PreviewAgent[];
  channels: readonly string[];
  personName: string;
  personImage: string | null;
}) {
  const { t } = useLingui();
  const heading =
    "px-2 pt-3 pb-1 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
    <div
      data-testid="workspace-preview"
      className="flex h-[26rem] w-full max-w-64 flex-col rounded-2xl border border-border bg-card p-3 shadow-lg shadow-black/10"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-xs font-semibold">
          {logo ? (
            <img src={logo} alt="" className="size-full object-cover" />
          ) : (
            (workspaceName.trim()[0]?.toUpperCase() ?? "")
          )}
        </span>
        <span data-testid="preview-name" className="truncate text-sm font-medium">
          {workspaceName}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {channels.length > 0 ? (
          <>
            <p className={heading}>{t`Channels`}</p>
            <ul className="flex flex-col">
              {channels.map((channel) => (
                <li key={channel} className="truncate px-2 py-1 text-sm text-muted-foreground">
                  # {channel}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className={heading}>{t`Agents`}</p>
        <ul className="flex flex-col">
          <li className="flex items-center gap-2 px-2 py-1 text-sm">
            <BotAvatar color={mascotHex("mint")} identity="corvo" size={20} />
            <span className="truncate">{chiefName}</span>
          </li>
          {agents.map((agent) => (
            <li key={agent.key} className="flex items-center gap-2 px-2 py-1 text-sm">
              <BotAvatar color={agent.color} identity={agent.key} size={20} />
              <span className="truncate">{agent.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-1 pt-2">
        <PersonAvatar name={personName || "?"} image={personImage} size={24} />
        <span className="truncate text-sm">{personName}</span>
      </div>
    </div>
  );
}
