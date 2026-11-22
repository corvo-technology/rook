import { Button, EmptyState, InlineConfirm } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { useSidePanel } from "../lib/side-panel";
import { errorText } from "../lib/user-error";
import { AddSkillPanel } from "./AddSkillPanel";

export const ADD_SKILL_PANEL = "add-skill";

/** The skills the space added, with a way to add and remove them; every agent can use all of them. */
export function SkillsSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const sidePanel = useSidePanel();
  const list = useQuery(queries.agentSkills.list.queryOptions());
  const [error, setError] = useState<string | null>(null);
  const skills = (list.data ?? []).filter((skill) => skill.source !== "builtin");

  const refresh = () => client.invalidateQueries({ queryKey: queries.agentSkills.key() });

  async function remove(skillId: string) {
    setError(null);
    try {
      await rpc.agentSkills.remove({ skillId });
      await refresh();
    } catch (reason) {
      setError(errorText(reason, t`Could not delete skill`));
    }
  }

  const add = (
    <Button size="sm" onClick={() => sidePanel.open(ADD_SKILL_PANEL)}>
      <Trans>Add skill</Trans>
    </Button>
  );

  return (
    <div className="space-y-4" data-testid="skills-settings">
      {skills.length === 0 && list.isSuccess ? (
        <EmptyState title={t`No skills yet`} action={add} />
      ) : (
        <>
          <div className="flex justify-end">{add}</div>
          <SettingsGroup>
            {skills.map((skill) => (
              <SettingsRow
                key={skill.id}
                label={
                  <>
                    <p className="break-words font-medium" dir="auto">
                      {skill.name}
                    </p>
                    <p className="text-[13px] text-muted-foreground" dir="auto">
                      {skill.description}
                    </p>
                  </>
                }
                control={
                  skill.readOnly ? null : (
                    <InlineConfirm
                      variant="ghost"
                      size="sm"
                      confirmLabel={t`Confirm delete?`}
                      aria-label={t`Remove ${skill.name}`}
                      onConfirm={() => void remove(skill.id)}
                    >
                      <Trans>Remove</Trans>
                    </InlineConfirm>
                  )
                }
              />
            ))}
          </SettingsGroup>
        </>
      )}
      {error ? (
        <p role="alert" className="text-[13.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {sidePanel.isOpen(ADD_SKILL_PANEL) ? (
        <AddSkillPanel
          onClose={sidePanel.close}
          onAdded={() => {
            sidePanel.close();
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
