import type { PartnerHiddenArea, PartnerTemplate } from "@corvo/contracts";
import { PARTNER_HIDEABLE_AREAS, PartnerTemplate as PartnerTemplateSchema } from "@corvo/contracts";
import { Button, Checkbox, Input, Textarea } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

type Draft = {
  /** Fixed once an agent exists, so saving again never makes a second copy of it. */
  key: string;
  name: string;
  instructions: string;
  usesConnector: boolean;
  /** One starter per line while it is edited. */
  starters: string;
};

/** The parts of a template that are edited as data: shortcuts, presets, routines and roles. */
const ADVANCED_KEYS = ["quickActions", "assist", "routines", "roles"] as const;
const AdvancedSchema = PartnerTemplateSchema.pick({
  quickActions: true,
  assist: true,
  routines: true,
  roles: true,
});

function advancedText(template: PartnerTemplate | null): string {
  const picked = Object.fromEntries(
    ADVANCED_KEYS.filter((key) => template?.[key] !== undefined).map((key) => [
      key,
      template?.[key],
    ]),
  );
  return Object.keys(picked).length > 0 ? JSON.stringify(picked, null, 2) : "";
}

/** The advanced part read back, `{}` when empty, or null when it is not valid. */
function readAdvanced(text: string) {
  if (text.trim() === "") return {};
  try {
    const parsed = AdvancedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** A key no other agent of the template uses, from the agent's name. */
function newKey(name: string, taken: ReadonlySet<string>): string {
  const base = slug(name) || "agent";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  return key;
}

export function PartnerTemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: PartnerTemplate | null;
  onSave: (template: PartnerTemplate | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [connectorName, setConnectorName] = useState(template?.connector?.name ?? "");
  const [endpoint, setEndpoint] = useState(template?.connector?.endpoint ?? "");
  const [agents, setAgents] = useState<Draft[]>(
    template?.agents.map((agent) => ({
      key: agent.key,
      name: agent.name,
      instructions: agent.instructions,
      usesConnector: agent.usesConnector ?? false,
      starters: (agent.starters ?? []).join("\n"),
    })) ?? [],
  );
  const [hidden, setHidden] = useState<PartnerHiddenArea[]>(template?.hide ?? []);
  const [choose, setChoose] = useState(template?.models === "choose");
  const [chiefName, setChiefName] = useState(template?.chiefName ?? "");
  const [accent, setAccent] = useState(template?.accent ?? "");
  const [advanced, setAdvanced] = useState(advancedText(template));
  const [showAdvanced, setShowAdvanced] = useState(advanced !== "");
  const [busy, setBusy] = useState(false);
  const areaLabels: Record<PartnerHiddenArea, string> = {
    routines: t`Routines`,
    workflows: t`Workflows`,
    usage: t`Usage`,
    artifacts: t`Artifacts`,
    store: t`Store`,
  };

  const change = (index: number, patch: Partial<Draft>) =>
    setAgents((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const hasConnector = connectorName.trim() !== "" && endpoint.trim() !== "";
  // A half-filled connector, or an address still holding a placeholder, would be saved as none.
  const connectorReady =
    (connectorName.trim() === "") === (endpoint.trim() === "") && !endpoint.includes("{{");
  const accentReady = accent.trim() === "" || /^#[0-9a-f]{6}$/i.test(accent.trim());
  const advancedParsed = readAdvanced(advanced);
  const valid =
    agents.every((agent) => agent.name.trim() !== "") &&
    connectorReady &&
    accentReady &&
    advancedParsed !== null;

  async function save() {
    if (busy || !valid || advancedParsed === null) return;
    setBusy(true);
    try {
      const taken = new Set<string>();
      const named = agents.map((agent) => {
        const key = agent.key || newKey(agent.name, taken);
        taken.add(key);
        const starters = agent.starters
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 4);
        return {
          key,
          name: agent.name.trim(),
          instructions: agent.instructions,
          usesConnector: hasConnector && agent.usesConnector,
          ...(starters.length > 0 ? { starters } : {}),
        };
      });
      await onSave(
        named.length === 0 &&
          !hasConnector &&
          hidden.length === 0 &&
          !choose &&
          !chiefName.trim() &&
          !accent.trim() &&
          Object.keys(advancedParsed).length === 0
          ? null
          : {
              ...(hasConnector
                ? {
                    connector: {
                      slug: slug(connectorName) || "connector",
                      name: connectorName.trim(),
                      endpoint: endpoint.trim(),
                    },
                  }
                : {}),
              agents: named,
              ...(hidden.length > 0 ? { hide: hidden } : {}),
              ...(choose ? { models: "choose" as const } : {}),
              ...(chiefName.trim() ? { chiefName: chiefName.trim() } : {}),
              ...advancedParsed,
              ...(accent.trim() ? { accent: accent.trim().toLowerCase() } : {}),
            },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex gap-2">
        <Input
          value={chiefName}
          onChange={(event) => setChiefName(event.target.value)}
          aria-label={t`Chief name`}
          placeholder={t`Chief name`}
          maxLength={80}
        />
        <Input
          value={accent}
          onChange={(event) => setAccent(event.target.value)}
          aria-label={t`Brand colour`}
          placeholder="#rrggbb"
          maxLength={7}
          aria-invalid={!accentReady}
        />
      </div>
      <div className="flex gap-2">
        <Input
          value={connectorName}
          onChange={(event) => setConnectorName(event.target.value)}
          aria-label={t`Connector name`}
          placeholder={t`Connector name`}
          maxLength={80}
        />
        <Input
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          aria-label={t`Connector address`}
          placeholder="https://"
          inputMode="url"
        />
      </div>
      {agents.map((agent, index) => (
        <div
          key={agent.key || `new-${index}`}
          className="space-y-2 rounded-lg border border-border p-3"
        >
          <div className="flex items-center gap-2">
            <Input
              value={agent.name}
              onChange={(event) => change(index, { name: event.target.value })}
              aria-label={t`Name`}
              placeholder={t`Name`}
              maxLength={80}
            />
            {hasConnector ? (
              <div className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
                <Checkbox
                  aria-label={t`Uses the connector`}
                  checked={agent.usesConnector}
                  onCheckedChange={(checked) => change(index, { usesConnector: checked === true })}
                />
                <Trans>Uses the connector</Trans>
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAgents((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trans>Remove</Trans>
            </Button>
          </div>
          <Textarea
            value={agent.instructions}
            onChange={(event) => change(index, { instructions: event.target.value })}
            aria-label={t`Instructions`}
            placeholder={t`Instructions`}
            maxLength={20000}
          />
          <Textarea
            value={agent.starters}
            onChange={(event) => change(index, { starters: event.target.value })}
            aria-label={t`First messages, one per line`}
            placeholder={t`First messages, one per line`}
            rows={2}
            maxLength={500}
          />
        </div>
      ))}
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        <legend className="sr-only">
          <Trans>Hide from customers</Trans>
        </legend>
        <span aria-hidden>
          <Trans>Hide from customers</Trans>
        </span>
        {PARTNER_HIDEABLE_AREAS.map((area) => (
          <div key={area} className="flex items-center gap-2">
            <Checkbox
              aria-label={areaLabels[area]}
              checked={hidden.includes(area)}
              onCheckedChange={(checked) =>
                setHidden((rows) =>
                  checked === true ? [...rows, area] : rows.filter((row) => row !== area),
                )
              }
            />
            {areaLabels[area]}
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Checkbox
          aria-label={t`Customers can choose the model`}
          checked={choose}
          onCheckedChange={(checked) => setChoose(checked === true)}
        />
        <Trans>Customers can choose the model</Trans>
      </div>
      {showAdvanced ? (
        <Textarea
          value={advanced}
          onChange={(event) => setAdvanced(event.target.value)}
          aria-label={t`Shortcuts, presets, routines and roles (JSON)`}
          placeholder={t`Shortcuts, presets, routines and roles (JSON)`}
          aria-invalid={advancedParsed === null}
          className="font-mono text-[12px]"
          rows={8}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={agents.length >= 10}
            onClick={() =>
              setAgents((rows) => [
                ...rows,
                { key: "", name: "", instructions: "", usesConnector: false, starters: "" },
              ])
            }
          >
            <Trans>Add agent</Trans>
          </Button>
          {showAdvanced ? null : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdvanced(true)}>
              <Trans>Advanced</Trans>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" size="sm" disabled={busy || !valid} onClick={() => void save()}>
            <Trans>Save</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
