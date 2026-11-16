import type { Bot, ConnectionKind } from "@corvo/contracts";
import { BotAvatar, OptionSelect } from "@corvo/ui-web";
import type { AccessLevelChoice, ShownLevel } from "./connection-model";
import { levelChoices, levelLabel } from "./connection-model";

/** A level picker: no access, read, or read and write. A per-tool list of an older version reads Custom. */
export function LevelSelect({
  kind,
  value,
  label,
  disabled,
  onChange,
}: {
  kind: ConnectionKind;
  value: ShownLevel;
  label: string;
  disabled?: boolean;
  onChange: (level: AccessLevelChoice) => void;
}) {
  const options = levelChoices(kind).map((level) => ({ value: level, label: levelLabel(level) }));
  const shown: ShownLevel[] = value === "custom" ? ["custom"] : [];
  return (
    <OptionSelect<ShownLevel>
      size="sm"
      className="w-40"
      aria-label={label}
      disabled={disabled}
      value={value}
      options={[
        ...shown.map((level) => ({ value: level, label: levelLabel(level), disabled: true })),
        ...options,
      ]}
      onValueChange={(next) => {
        if (next !== "custom") onChange(next);
      }}
    />
  );
}

/** An agent as the access lists show it: its face, name and role. */
export function AgentLabel({ bot }: { bot: Bot }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <BotAvatar color={bot.color} identity={bot.id} size={28} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-foreground">{bot.name}</span>
        {bot.title ? (
          <span className="block truncate text-[12px] text-muted-foreground">{bot.title}</span>
        ) : null}
      </span>
    </span>
  );
}
