import { EmptyState } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import type { PartnerSection } from "../../lib/partner-console";
import { PARTNER_SECTIONS, partnerPath, sectionsFor, usePartners } from "../../lib/partner-console";
import { PartnerBrand } from "./PartnerBrand";
import { PartnerCredits } from "./PartnerCredits";
import { PartnerCustomers } from "./PartnerCustomers";
import { PartnerDomain } from "./PartnerDomain";
import { PartnerIntegration } from "./PartnerIntegration";
import { PartnerInvoices } from "./PartnerInvoices";
import { PartnerOverview } from "./PartnerOverview";
import { PartnerPricing } from "./PartnerPricing";
import { PartnerRevenue } from "./PartnerRevenue";
import { PartnerTemplatePanel } from "./PartnerTemplatePanel";
import { PartnerError, PartnerLoading } from "./partner-ui";

export function usePartnerSectionTitle() {
  const { t } = useLingui();
  return (section: PartnerSection) => {
    switch (section) {
      case "overview":
        return t`Overview`;
      case "customers":
        return t`Customers`;
      case "template":
        return t`Agent model`;
      case "credits":
        return t`Credits`;
      case "invoices":
        return t`Invoices`;
      case "pricing":
        return t`Pricing`;
      case "revenue":
        return t`Revenue`;
      case "brand":
        return t`Brand`;
      case "domain":
        return t`Domain`;
      case "integration":
        return t`Integration`;
    }
  };
}

/** The partner area of the app: one screen of the selected partner, chosen by the address. */
export function PartnerConsolePage() {
  const { t } = useLingui();
  const title = usePartnerSectionTitle();
  const { partnerId, section } = useParams();
  const partners = usePartners();

  if (partners.isPending)
    return (
      <Frame>
        <PartnerLoading />
      </Frame>
    );
  if (partners.isError)
    return (
      <Frame>
        <PartnerError error={partners.error} onRetry={partners.refetch} />
      </Frame>
    );
  const partner = partners.data.find((item) => item.id === partnerId) ?? partners.data[0];
  if (!partner)
    return (
      <Frame>
        <EmptyState title={t`No partnerships`} />
      </Frame>
    );
  const allowed = sectionsFor(partner.mode);
  const active = PARTNER_SECTIONS.find((item) => item === section);
  if (partner.id !== partnerId || !active || !allowed.includes(active))
    return <Navigate to={partnerPath(partner.id, "overview")} replace />;

  return (
    <Frame title={title(active)}>
      {active === "overview" ? <PartnerOverview partner={partner} /> : null}
      {active === "customers" ? <PartnerCustomers partner={partner} /> : null}
      {active === "template" ? <PartnerTemplatePanel partner={partner} /> : null}
      {active === "credits" ? <PartnerCredits partner={partner} /> : null}
      {active === "invoices" ? <PartnerInvoices partner={partner} /> : null}
      {active === "pricing" ? <PartnerPricing partner={partner} /> : null}
      {active === "revenue" ? <PartnerRevenue partner={partner} /> : null}
      {active === "brand" ? <PartnerBrand partner={partner} /> : null}
      {active === "domain" ? <PartnerDomain partner={partner} /> : null}
      {active === "integration" ? <PartnerIntegration partner={partner} /> : null}
    </Frame>
  );
}

function Frame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      data-testid="partner-console"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"
    >
      {title ? (
        <h1 className="mx-auto w-full max-w-5xl px-6 pt-6 pb-4 text-xl font-light tracking-tight">
          {title}
        </h1>
      ) : null}
      <div className="mx-auto w-full max-w-5xl px-6 pb-8 pt-2 first:pt-6">{children}</div>
    </div>
  );
}
