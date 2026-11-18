/** A URL-safe slug from a product's name: "Prontu Saúde" becomes "prontu-saude". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const BRAZIL = /^(br|brasil|brazil)$/i;

/** The two-letter code a lead's free-text country most likely means; blank when unsure. */
export function countryCode(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (BRAZIL.test(value)) return "BR";
  return /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : "";
}

/** Brazil is billed in reais and everywhere else in dollars. */
export const currencyOf = (country: string): "BRL" | "USD" =>
  country.trim().toUpperCase() === "BR" ? "BRL" : "USD";

export const PARTNER_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
