import { NativeSelect, NativeSelectOption } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Bot,
  CircleDollarSign,
  FileText,
  KeyRound,
  LayoutDashboard,
  Tag,
  Users,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import type { PartnerSection } from "../../lib/partner-console";
import { partnerPath, sectionsFor, usePartners } from "../../lib/partner-console";
import { usePartnerSectionTitle } from "../partner/PartnerConsolePage";

const ICONS: Record<PartnerSection, LucideIcon> = {
  overview: LayoutDashboard,
  customers: Users,
  template: Bot,
  credits: Banknote,
  invoices: FileText,
  pricing: Tag,
  revenue: CircleDollarSign,
  integration: KeyRound,
};

/**
 * The partner area, for members who manage a partner: the request that lists the partners is
 * refused to anyone else, so nothing shows for them. A product switcher appears when the
 * organization runs more than one.
 */
export function SidebarPartnership({ onOpen }: { onOpen: (to: string) => void }) {
  const { t } = useLingui();
  const title = usePartnerSectionTitle();
  const { pathname } = useLocation();
  const partners = usePartners().data;
  if (!partners || partners.length === 0) return null;
  const [, , , currentId = "", currentSection = ""] = pathname.split("/");
  const inArea = pathname.startsWith("/app/partner");
  const partner = partners.find((item) => item.id === decodeURIComponent(currentId)) ?? partners[0];
  if (!partner) return null;
  return (
    <nav
      aria-label={t`Partnership`}
      data-testid="sidebar-partnership"
      className="flex flex-col gap-px px-2.5 pb-2"
    >
      <h2 className="px-2 pt-3 pb-0.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t`Partnership`}
      </h2>
      {partners.length > 1 ? (
        <NativeSelect
          size="sm"
          value={partner.id}
          aria-label={t`Product`}
          onChange={(event) => onOpen(partnerPath(event.target.value, "overview"))}
          className="mb-1"
        >
          {partners.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {item.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
      {sectionsFor(partner.mode).map((section) => {
        const Icon = ICONS[section];
        const current = inArea && currentSection === section;
        return (
          <button
            key={section}
            type="button"
            data-testid={`sidebar-partner-${section}`}
            aria-current={current ? "page" : undefined}
            onClick={() => onOpen(partnerPath(partner.id, section))}
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-start text-nav text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-foreground"
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{title(section)}</span>
          </button>
        );
      })}
    </nav>
  );
}
