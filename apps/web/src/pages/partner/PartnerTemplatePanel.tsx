import type { PartnerConsolePartner } from "@corvo/contracts";
import { PartnerTemplate } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { PartnerTemplateEditor } from "../PartnerTemplateEditor";
import { Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

/** Reads a template file, leaving a connector address empty when the file only had a placeholder. */
export function parseTemplateFile(text: string): PartnerTemplate | null {
  // The address of the partner's server is filled in here, so a placeholder stands for none.
  const placeholder = "https://placeholder.invalid";
  try {
    const parsed = PartnerTemplate.safeParse(
      JSON.parse(text.split("{{MCP_PUBLIC_URL}}").join(placeholder)),
    );
    if (!parsed.success) return null;
    const { connector } = parsed.data;
    return connector
      ? {
          ...parsed.data,
          connector: {
            ...connector,
            endpoint: connector.endpoint.includes("placeholder.invalid") ? "" : connector.endpoint,
          },
        }
      : parsed.data;
  } catch {
    return null;
  }
}

/** What every new customer gets: its agents, connector and Chief name, to read, import and edit. */
export function PartnerTemplatePanel({ partner }: { partner: PartnerConsolePartner }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  /** A template read from a file, shown in the editor to be checked and saved. */
  const [imported, setImported] = useState<PartnerTemplate | null>(null);
  const [fileError, setFileError] = useState(false);
  const key = ["partner-console", partner.id, "template"];
  const template = useQuery({
    queryKey: key,
    queryFn: () => rpc.partnerConsole.template({ partnerId: partner.id }),
  });
  if (template.isPending) return <PartnerLoading />;
  if (template.isError) return <PartnerError error={template.error} onRetry={template.refetch} />;
  const current = template.data.template;

  function close() {
    setEditing(false);
    setImported(null);
  }

  if (editing) {
    return (
      <div data-testid="partner-template">
        <PartnerTemplateEditor
          template={imported ?? current}
          onCancel={close}
          onSave={(next) =>
            action.run(async () => {
              const saved = await rpc.partnerConsole.setTemplate({
                partnerId: partner.id,
                template: next,
              });
              queryClient.setQueryData(key, saved);
              void queryClient.invalidateQueries({ queryKey: ["partner-console", "partners"] });
              close();
            })
          }
        />
        {action.error ? <PartnerError error={action.error} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="partner-template">
      <Panel
        title={
          current?.agents.length ? current.agents.map((agent) => agent.name).join(", ") : t`Agents`
        }
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
              {t`Import`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t`Edit`}
            </Button>
          </div>
        }
      >
        <p className="text-[14px] text-muted-foreground">
          {[current?.chiefName, current?.connector?.name].filter(Boolean).join(" · ") || "—"}
        </p>
      </Panel>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label={t`Import`}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const parsed = parseTemplateFile(await file.text());
          setFileError(parsed === null);
          if (parsed) {
            setImported(parsed);
            setEditing(true);
          }
        }}
      />
      {fileError ? (
        <p role="alert" className="text-sm text-destructive">
          {t`That file is not a valid template`}
        </p>
      ) : null}
    </div>
  );
}
