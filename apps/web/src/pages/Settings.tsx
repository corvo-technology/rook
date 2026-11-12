import type { SettingsLayoutSection } from "@corvo/ui-web";
import { SettingsLayout } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { settingsPath, useSettingsNavigation } from "../lib/settings-route";

type PageSection = SettingsLayoutSection & { content: ReactNode };

/**
 * Settings as a page, one route per section (`/settings/:section`). To move a section out of the
 * overlay, add it to `sections` below and render it in `content`; the nav, deep links, Esc and the
 * way back come from `SettingsLayout`.
 */
export function SettingsPage() {
  const { t } = useLingui();
  const { section } = useParams();
  const navigation = useSettingsNavigation();
  const sections: PageSection[] = [
    {
      id: "approvals",
      label: t`Approvals`,
      icon: ShieldCheck,
      content: <ApprovalRulesSettings scope="account" />,
    },
  ];
  const active = sections.find((candidate) => candidate.id === section);
  const first = sections[0];
  if (!active) return first ? <Navigate to={settingsPath(first.id)} replace /> : null;
  return (
    <SettingsLayout
      title={t`Settings`}
      onBack={navigation.back}
      sections={sections}
      activeId={active.id}
      onSelect={navigation.select}
    >
      {active.content}
    </SettingsLayout>
  );
}
