import { describe, expect, it } from "vitest";
import { countryCode, currencyOf, PARTNER_SLUG, slugFromName } from "./platform-onboarding";

describe("platform onboarding helpers", () => {
  it("makes a slug a partner can be created with", () => {
    expect(slugFromName("Prontu Saúde")).toBe("prontu-saude");
    expect(PARTNER_SLUG.test(slugFromName("Green Barber"))).toBe(true);
    expect(PARTNER_SLUG.test(slugFromName("A"))).toBe(false);
  });

  it("reads a country a person typed, and leaves the doubtful blank", () => {
    expect(countryCode("Brasil")).toBe("BR");
    expect(countryCode("pt")).toBe("PT");
    expect(countryCode("Portugal")).toBe("");
    expect(countryCode(null)).toBe("");
  });

  it("bills Brazil in reais and everywhere else in dollars", () => {
    expect(currencyOf("br")).toBe("BRL");
    expect(currencyOf("PT")).toBe("USD");
  });
});
