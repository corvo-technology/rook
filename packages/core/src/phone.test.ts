import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  callingCode,
  exampleNumber,
  formatNational,
  isCountryCode,
  isValidE164,
  isValidNational,
  toE164,
} from "./phone.js";

describe("phone", () => {
  it("knows every country by ISO code", () => {
    expect(isCountryCode("BR")).toBe(true);
    expect(isCountryCode("br")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(COUNTRY_CODES.length).toBeGreaterThan(220);
    expect(callingCode("BR")).toBe("55");
  });

  it("formats Brazilian numbers while typing", () => {
    expect(formatNational("BR", "1")).toBe("(1");
    expect(formatNational("BR", "119")).toBe("(11) 9");
    expect(formatNational("BR", "1191234")).toBe("(11) 9123-4");
    expect(formatNational("BR", "11912345678")).toBe("(11) 91234-5678");
    expect(formatNational("BR", "1112345678")).toBe("(11) 1234-5678");
    expect(formatNational("BR", "119123456789999")).toBe("(11) 91234-5678");
    expect(formatNational("BR", "(11) 91234-5678")).toBe("(11) 91234-5678");
  });

  it("formats other countries", () => {
    expect(formatNational("US", "2025550123")).toBe("(202) 555-0123");
    expect(formatNational("PT", "912345678")).toBe("912 345 678");
    expect(formatNational("GB", "07911123456")).toBe("7911 123456");
    expect(formatNational("KE", "712345678")).toBe("712 345 678");
  });

  it("gives each country a valid example number", () => {
    expect(exampleNumber("BR")).toBe("(11) 91234-5678");
    for (const country of COUNTRY_CODES)
      expect(isValidNational(country, exampleNumber(country))).toBe(true);
  });

  it("validates per country", () => {
    expect(isValidNational("BR", "(11) 91234-5678")).toBe(true);
    expect(isValidNational("BR", "(11) 9123-456")).toBe(false);
    expect(isValidNational("US", "202555012")).toBe(false);
    expect(isValidNational("KE", "12345")).toBe(false);
    expect(isValidNational("KE", "712345678")).toBe(true);
  });

  it("builds E.164", () => {
    expect(toE164("BR", "(11) 91234-5678")).toBe("+5511912345678");
    expect(toE164("GB", "07911 123456")).toBe("+447911123456");
    expect(toE164("BR", "123")).toBeUndefined();
  });

  it("checks E.164 against the country", () => {
    expect(isValidE164("+5511912345678", "BR")).toBe(true);
    expect(isValidE164("+5511912345678", "PT")).toBe(false);
    expect(isValidE164("+5511912345678")).toBe(true);
    expect(isValidE164("5511912345678")).toBe(false);
    expect(isValidE164("+55 11 91234-5678")).toBe(false);
    expect(isValidE164("+0123456789")).toBe(false);
  });
});
