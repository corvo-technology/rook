/**
 * Countries and phone numbers for forms that take a country and a WhatsApp number. One table of
 * calling codes and per-country layouts feeds the formatting as you type, the validation before
 * submit, and the E.164 check on the server.
 */

/** Calling code (no plus) to the ISO 3166-1 alpha-2 countries that use it. */
const CALLING_CODES: Record<string, string> = {
  "1": "US CA AG AI AS BB BM BS DM DO GD GU JM KN KY LC MP MS PR SX TC TT VC VG VI",
  "7": "RU KZ",
  "20": "EG",
  "27": "ZA",
  "30": "GR",
  "31": "NL",
  "32": "BE",
  "33": "FR",
  "34": "ES",
  "36": "HU",
  "39": "IT VA",
  "40": "RO",
  "41": "CH",
  "43": "AT",
  "44": "GB GG IM JE",
  "45": "DK",
  "46": "SE",
  "47": "NO SJ",
  "48": "PL",
  "49": "DE",
  "51": "PE",
  "52": "MX",
  "53": "CU",
  "54": "AR",
  "55": "BR",
  "56": "CL",
  "57": "CO",
  "58": "VE",
  "60": "MY",
  "61": "AU CC CX",
  "62": "ID",
  "63": "PH",
  "64": "NZ",
  "65": "SG",
  "66": "TH",
  "81": "JP",
  "82": "KR",
  "84": "VN",
  "86": "CN",
  "90": "TR",
  "91": "IN",
  "92": "PK",
  "93": "AF",
  "94": "LK",
  "95": "MM",
  "98": "IR",
  "211": "SS",
  "212": "MA EH",
  "213": "DZ",
  "216": "TN",
  "218": "LY",
  "220": "GM",
  "221": "SN",
  "222": "MR",
  "223": "ML",
  "224": "GN",
  "225": "CI",
  "226": "BF",
  "227": "NE",
  "228": "TG",
  "229": "BJ",
  "230": "MU",
  "231": "LR",
  "232": "SL",
  "233": "GH",
  "234": "NG",
  "235": "TD",
  "236": "CF",
  "237": "CM",
  "238": "CV",
  "239": "ST",
  "240": "GQ",
  "241": "GA",
  "242": "CG",
  "243": "CD",
  "244": "AO",
  "245": "GW",
  "246": "IO",
  "248": "SC",
  "249": "SD",
  "250": "RW",
  "251": "ET",
  "252": "SO",
  "253": "DJ",
  "254": "KE",
  "255": "TZ",
  "256": "UG",
  "257": "BI",
  "258": "MZ",
  "260": "ZM",
  "261": "MG",
  "262": "RE YT",
  "263": "ZW",
  "264": "NA",
  "265": "MW",
  "266": "LS",
  "267": "BW",
  "268": "SZ",
  "269": "KM",
  "290": "SH",
  "291": "ER",
  "297": "AW",
  "298": "FO",
  "299": "GL",
  "350": "GI",
  "351": "PT",
  "352": "LU",
  "353": "IE",
  "354": "IS",
  "355": "AL",
  "356": "MT",
  "357": "CY",
  "358": "FI AX",
  "359": "BG",
  "370": "LT",
  "371": "LV",
  "372": "EE",
  "373": "MD",
  "374": "AM",
  "375": "BY",
  "376": "AD",
  "377": "MC",
  "378": "SM",
  "380": "UA",
  "381": "RS",
  "382": "ME",
  "383": "XK",
  "385": "HR",
  "386": "SI",
  "387": "BA",
  "389": "MK",
  "420": "CZ",
  "421": "SK",
  "423": "LI",
  "500": "FK",
  "501": "BZ",
  "502": "GT",
  "503": "SV",
  "504": "HN",
  "505": "NI",
  "506": "CR",
  "507": "PA",
  "508": "PM",
  "509": "HT",
  "590": "GP BL MF",
  "591": "BO",
  "592": "GY",
  "593": "EC",
  "594": "GF",
  "595": "PY",
  "596": "MQ",
  "597": "SR",
  "598": "UY",
  "599": "CW BQ",
  "670": "TL",
  "672": "NF",
  "673": "BN",
  "674": "NR",
  "675": "PG",
  "676": "TO",
  "677": "SB",
  "678": "VU",
  "679": "FJ",
  "680": "PW",
  "681": "WF",
  "682": "CK",
  "683": "NU",
  "685": "WS",
  "686": "KI",
  "687": "NC",
  "688": "TV",
  "689": "PF",
  "690": "TK",
  "691": "FM",
  "692": "MH",
  "850": "KP",
  "852": "HK",
  "853": "MO",
  "855": "KH",
  "856": "LA",
  "880": "BD",
  "886": "TW",
  "960": "MV",
  "961": "LB",
  "962": "JO",
  "963": "SY",
  "964": "IQ",
  "965": "KW",
  "966": "SA",
  "967": "YE",
  "968": "OM",
  "970": "PS",
  "971": "AE",
  "972": "IL",
  "973": "BH",
  "974": "QA",
  "975": "BT",
  "976": "MN",
  "977": "NP",
  "992": "TJ",
  "993": "TM",
  "994": "AZ",
  "995": "GE",
  "996": "KG",
  "998": "UZ",
};

const DIAL = new Map<string, string>();
for (const [code, countries] of Object.entries(CALLING_CODES)) {
  for (const country of countries.split(" ")) DIAL.set(country, code);
}

/** Every supported ISO 3166-1 alpha-2 code. */
export const COUNTRY_CODES: readonly string[] = [...DIAL.keys()];

/** Layouts where `#` is a digit. A country with several layouts accepts each length. */
const LAYOUTS: Record<string, readonly string[]> = {
  BR: ["(##) ####-####", "(##) #####-####"],
  US: ["(###) ###-####"],
  CA: ["(###) ###-####"],
  PT: ["### ### ###"],
  ES: ["### ## ## ##"],
  FR: ["# ## ## ## ##"],
  GB: ["#### ######"],
  DE: ["### #######", "### ########"],
  IT: ["### ### ###", "### ### ####"],
  MX: ["## #### ####"],
  AR: ["## ####-####"],
  CL: ["# #### ####"],
  CO: ["### ### ####"],
  AU: ["### ### ###"],
  JP: ["## #### ####"],
  IN: ["##### #####"],
  NL: ["# ########"],
};

/** Numbers people write with a leading 0 that E.164 drops. */
const TRUNK_ZERO = new Set(["GB", "FR", "DE", "NL", "BE", "AT", "CH", "AU", "JP", "ZA", "TR"]);

const GENERIC_MIN = 6;
const E164 = /^\+[1-9]\d{6,14}$/;

export const isCountryCode = (value: string): boolean => DIAL.has(value);

/** The calling code of a country without the plus, or undefined for an unknown country. */
export function callingCode(country: string): string | undefined {
  return DIAL.get(country);
}

function nationalDigits(country: string, input: string): string {
  const digits = input.replace(/\D/g, "");
  return TRUNK_ZERO.has(country) ? digits.replace(/^0+/, "") : digits;
}

const slots = (layout: string) => layout.replace(/[^#]/g, "").length;

function lengths(country: string): [number, number] {
  const layouts = LAYOUTS[country];
  if (layouts) {
    const sizes = layouts.map(slots);
    return [Math.min(...sizes), Math.max(...sizes)];
  }
  return [GENERIC_MIN, 14 - (DIAL.get(country)?.length ?? 1)];
}

function chunk(digits: string): string {
  const groups: string[] = digits.match(/\d{1,3}/g) ?? [];
  if (groups.length > 1 && groups[groups.length - 1]!.length === 1) {
    groups.push(groups.splice(-2).join(""));
  }
  return groups.join(" ");
}

/** The national number laid out for its country, as far as the digits go. Safe to call on every keystroke. */
export function formatNational(country: string, input: string): string {
  const [, max] = lengths(country);
  const digits = nationalDigits(country, input).slice(0, max);
  const layouts = LAYOUTS[country];
  if (!layouts) return chunk(digits);
  const layout =
    layouts.find((candidate) => slots(candidate) >= digits.length) ?? layouts[layouts.length - 1]!;
  let out = "";
  let used = 0;
  for (const char of layout) {
    if (used >= digits.length) break;
    out += char === "#" ? digits[used++] : char;
  }
  return out;
}

/** Whether the national number is complete for its country. */
export function isValidNational(country: string, input: string): boolean {
  if (!DIAL.has(country)) return false;
  const length = nationalDigits(country, input).length;
  const layouts = LAYOUTS[country];
  if (layouts) return layouts.some((layout) => slots(layout) === length);
  const [min, max] = lengths(country);
  return length >= min && length <= max;
}

/** The number in E.164 (`+5511912345678`), or undefined when it is not valid for the country. */
export function toE164(country: string, input: string): string | undefined {
  if (!isValidNational(country, input)) return undefined;
  return `+${DIAL.get(country)}${nationalDigits(country, input)}`;
}

/**
 * Checks an E.164 number against a country: the calling code must be that country's and the rest
 * must be a valid national number. Without a country only the E.164 shape is checked.
 */
export function isValidE164(value: string, country?: string): boolean {
  if (!E164.test(value)) return false;
  if (!country) return true;
  const code = DIAL.get(country);
  if (!code || !value.startsWith(`+${code}`)) return false;
  return isValidNational(country, value.slice(code.length + 1));
}
