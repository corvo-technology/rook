import { Skeleton } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import type { PricingForm } from "../../lib/platform-pricing";
import { configFromForm, formFromConfig, sameConfig } from "../../lib/platform-pricing";
import { useSpaceQueries } from "../../lib/query";
import { usePartnerAdmin } from "../shell/sidebar-team";
import { PartnerLeadsSection, WaitlistSection } from "./IntakeSections";
import { InvoicesSection } from "./InvoicesSection";
import { LimitsSection } from "./LimitsSection";
import { PartnersSection } from "./PartnersSection";
import { PricingSection } from "./PricingSection";
import { SimulatorSection } from "./SimulatorSection";

export const PLATFORM_SECTIONS = [
  "pricing",
  "simulator",
  "partners",
  "applications",
  "waitlist",
  "invoices",
  "limits",
] as const;
type Section = (typeof PLATFORM_SECTIONS)[number];

/** The platform operators' area: pricing, partners, invoices and limits. Everyone else is sent home. */
export function PlatformPage() {
  const { t } = useLingui();
  const admin = usePartnerAdmin();
  const { section } = useParams();
  const queries = useSpaceQueries();
  const pricing = useQuery({
    ...queries.platform.partnerPricing.get.queryOptions(),
    enabled: admin === true,
  });
  const live = pricing.data;
  const [edited, setEdited] = useState<PricingForm | null>(null);
  const form = useMemo(() => edited ?? formFromConfig(live?.config ?? null), [edited, live]);
  const config = useMemo(() => configFromForm(form), [form]);
  const changed = edited !== null && !sameConfig(config, live?.config ?? null);

  if (admin === false) return <Navigate to="/app/home" replace />;
  if (admin === undefined) return null;
  if (!section) return <Navigate to="/app/platform/pricing" replace />;
  if (!PLATFORM_SECTIONS.includes(section as Section)) {
    return <Navigate to="/app/platform/pricing" replace />;
  }

  const labels: Record<Section, string> = {
    waitlist: t`Waitlist`,
    applications: t`Partner applications`,
    pricing: t`Prices and margins`,
    simulator: t`Simulator`,
    partners: t`Partners`,
    invoices: t`Invoices`,
    limits: t`Limits by organization`,
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground md:flex-row">
      <nav
        aria-label={t`Platform`}
        className="flex shrink-0 gap-1 overflow-x-auto px-4 py-3 md:w-56 md:flex-col md:px-3 md:py-6"
      >
        <span className="hidden px-2 pb-2 text-meta uppercase tracking-wide text-muted-foreground md:block">
          {t`Platform`}
        </span>
        {PLATFORM_SECTIONS.map((id) => (
          <NavLink
            key={id}
            to={`/app/platform/${id}`}
            className="whitespace-nowrap rounded-md px-2 py-1.5 text-nav text-foreground/80 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {labels[id]}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-10 pt-3 md:px-8 md:pt-6">
        <div className="mx-auto w-full max-w-5xl">
          {section === "pricing" ? (
            pricing.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <PricingSection
                live={live}
                form={form}
                onForm={setEdited}
                config={config}
                changed={changed}
              />
            )
          ) : section === "simulator" ? (
            <SimulatorSection
              live={pricing.isPending ? undefined : (live?.config ?? null)}
              draft={changed ? config : null}
            />
          ) : section === "waitlist" ? (
            <WaitlistSection />
          ) : section === "applications" ? (
            <PartnerLeadsSection />
          ) : section === "partners" ? (
            <PartnersSection />
          ) : section === "invoices" ? (
            <InvoicesSection />
          ) : (
            <LimitsSection />
          )}
        </div>
      </div>
    </div>
  );
}
