import type { PartnerConsolePartner } from "@corvo/contracts";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "./rpc";

export const PARTNER_SECTIONS = [
  "overview",
  "customers",
  "template",
  "credits",
  "invoices",
  "pricing",
  "revenue",
  "brand",
  "domain",
  "integration",
] as const;
export type PartnerSection = (typeof PARTNER_SECTIONS)[number];

/** The screens of a partner: embedded ones are paid for credits, the others earn on prices. */
export function sectionsFor(mode: PartnerConsolePartner["mode"]): PartnerSection[] {
  return mode === "embedded"
    ? ["overview", "customers", "template", "credits", "invoices", "integration"]
    : ["overview", "customers", "template", "pricing", "revenue", "brand", "domain", "integration"];
}

export function partnerPath(partnerId: string, section: PartnerSection): string {
  return `/app/partner/${encodeURIComponent(partnerId)}/${section}`;
}

/** Who the organization runs a console for. Closed (an error) to a member without the permission. */
export function usePartners() {
  return useQuery({
    queryKey: ["partner-console", "partners"],
    queryFn: () => rpc.partnerConsole.partners(),
    retry: false,
    staleTime: 60_000,
  });
}

/** Minor units in the partner's currency. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale || "en", { style: "currency", currency }).format(minor / 100);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale || "en").format(value);
}

/** "2026-11" as a month name. */
export function monthLabel(period: string, locale: string, style: "short" | "long" = "short") {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale || "en", { month: style, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousPeriod(period: string, back = 1): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const at = new Date(Date.UTC(year, month - 1 - back, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A fresh key for one intent: a retry of the same request reuses it, a new request makes another. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export type Markup = { kind: "fixed" | "percent"; value: number };

/** What the markup adds to a base price, rounded as the server does. */
export function markupMinor(baseMinor: number, markup: Markup): number {
  if (markup.value <= 0) return 0;
  return markup.kind === "fixed" ? markup.value : Math.round((baseMinor * markup.value) / 10_000);
}

export function finalMinor(baseMinor: number, markup: Markup): number {
  return baseMinor + markupMinor(baseMinor, markup);
}

/** A typed number ("12,50" or "12.5") times 100: minor units, or basis points for a percent. */
export function parseMinor(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
}

/** Minor units or basis points as the text an input starts with. */
export function minorText(minor: number): string {
  return minor === 0 ? "" : String(minor / 100);
}
