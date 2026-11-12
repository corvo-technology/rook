export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "corvo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  /** Modals: a step lighter than the page so they read as raised above it. */
  dialog: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /** Fill and hairline where native Liquid Glass is unavailable (Android, iOS before 26). */
  glassFill: string;
  glassStroke: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  /** White in both themes: the user bubble is a solid fill (light grey in dark, near-black in light). */
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  /** Tertiary text: placeholders, list markers, quote bars, timestamps. */
  faintForeground: string;
  accent: string;
  accentForeground: string;
  /** The mint of the Rook mark: an approval's main action, the "waiting for you" label. Used sparingly. */
  brand: string;
  brandForeground: string;
  /** Destructive text and outlines. */
  destructive: string;
  /** Solid destructive fill (Hang up, a filled Delete); its text is `destructiveForeground`. */
  destructiveFill: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible on any bubble. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  /** Unread dot. The one blue in the inbox, in both themes. */
  unread: string;
  /** Working dot on a busy bot's avatar. The one green, in both themes. */
  workingDot: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  background: "#0A0A0A",
  dialog: "#111113",
  foreground: "#F4F4F5",
  card: "#111113",
  cardForeground: "#F4F4F5",
  popover: "#111113",
  popoverForeground: "#F4F4F5",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#F4F4F5",
  primaryForeground: "#0A0A0A",
  secondary: "#17171A",
  secondaryForeground: "#F4F4F5",
  chatUser: "#1C1C20",
  chatUserForeground: "#F4F4F5",
  muted: "#111113",
  mutedForeground: "#A3A3AA",
  faintForeground: "#6E6E76",
  accent: "#17171A",
  accentForeground: "#F4F4F5",
  brand: "#54C398",
  brandForeground: "#0A0A0A",
  destructive: "#FF6463",
  destructiveFill: "#CF2B35",
  destructiveForeground: "#FFFFFF",
  border: "#1F1F23",
  input: "#2A2A30",
  ring: "#54C398",
  sidebar: "#0D0D0E",
  sidebarForeground: "#F4F4F5",
  sidebarBorder: "#1F1F23",
  sidebarAccent: "#17171A",
  sidebarAccentForeground: "#F4F4F5",
  link: "#54C398",
  faviconPlate: "#FFFFFF",
  success: "#54C398",
  warning: "#E28600",
  statusWorking: "#54C398",
  unread: "#0062DB",
  workingDot: "#3FA266",
  overlay: "#000000B2",
  scrollbar: "#2A2A30",
  scrollbarHover: "#3A3A40",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#F2F2EF",
  dialog: "#FFFFFF",
  foreground: "#0A0A0A",
  card: "#FFFFFF",
  cardForeground: "#0A0A0A",
  popover: "#FFFFFF",
  popoverForeground: "#0A0A0A",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#0A0A0A",
  primaryForeground: "#FAFAF8",
  secondary: "#F1F1EE",
  secondaryForeground: "#0A0A0A",
  chatUser: "#1C1C1C",
  chatUserForeground: "#FFFFFF",
  muted: "#F4F4F1",
  mutedForeground: "#5C5C63",
  faintForeground: "#85858C",
  accent: "#F1F1EE",
  accentForeground: "#0A0A0A",
  brand: "#197B56",
  brandForeground: "#FFFFFF",
  destructive: "#CD2834",
  destructiveFill: "#E72E3B",
  destructiveForeground: "#FFFFFF",
  border: "#E7E7E2",
  input: "#D4D4CE",
  ring: "#2FA77A",
  sidebar: "#F8F8F6",
  sidebarForeground: "#0A0A0A",
  sidebarBorder: "#E7E7E2",
  sidebarAccent: "#F1F1EE",
  sidebarAccentForeground: "#0A0A0A",
  link: "#197B56",
  faviconPlate: "#FFFFFF",
  success: "#007A43",
  warning: "#945600",
  statusWorking: "#197B56",
  unread: "#0B6DD3",
  workingDot: "#3FA266",
  overlay: "#00000080",
  scrollbar: "#D4D4CE",
  scrollbarHover: "#A8A8A2",
} as const satisfies ColorTokens;

/** Web and Electron only: the primary fill's hover and disabled states. Mobile has no hover. */
export type WebColorTokens = ColorTokens & {
  primaryHover: string;
  primaryDisabled: string;
};

/**
 * What only web and Electron have: the primary fill's hover and disabled states. Every other token is
 * shared, so mobile (`darkTokens` / `lightTokens`) and web (`tokens.css`, rendered from the merged
 * palettes) read the same Clean values.
 */
export const webDarkOverrides = {
  primaryHover: "#E2E2E5",
  primaryDisabled: "#F4F4F529",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  primaryHover: "#262626",
  primaryDisabled: "#0A0A0A26",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

/** Large radii for the Clean look: cards and dialogs take the larger steps (20 to 28px). */
export const RADIUS = "1rem";

/**
 * Raised surfaces (panels, popovers, cards) share two layered, soft shadows per theme. Layers
 * stack a hairline ring, a close contact shadow and a wide ambient one; dark leans on the ring
 * because a shadow barely reads on a near-black page. Web only: native surfaces use system chrome.
 */
export const elevation = {
  light: {
    raised:
      "0 0 0 1px rgb(10 10 10 / 0.04), 0 1px 2px rgb(10 10 10 / 0.04), 0 4px 12px rgb(10 10 10 / 0.05)",
    overlay:
      "0 0 0 1px rgb(10 10 10 / 0.05), 0 2px 4px rgb(10 10 10 / 0.04), 0 12px 32px rgb(10 10 10 / 0.1), 0 32px 64px rgb(10 10 10 / 0.06)",
  },
  dark: {
    raised:
      "0 0 0 1px rgb(255 255 255 / 0.06), 0 1px 2px rgb(0 0 0 / 0.4), 0 4px 12px rgb(0 0 0 / 0.3)",
    overlay:
      "0 0 0 1px rgb(255 255 255 / 0.08), 0 2px 4px rgb(0 0 0 / 0.4), 0 12px 32px rgb(0 0 0 / 0.5), 0 32px 64px rgb(0 0 0 / 0.35)",
  },
} as const;

/** Durations and easing for transitions. Panels slide and fade in `panel`; hovers use `fast`. */
export const motion = {
  fast: "120ms",
  panel: "200ms",
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/**
 * Page and section titles, mirroring the landing: Inter Tight, light, tight tracking. Sizes come
 * from the type scale; these are only what makes a title read as a title.
 */
export const titleType = { weight: "300", tracking: "-0.02em", lineHeight: "1.15" } as const;

export const fontWeight = { regular: "400", medium: "500", semibold: "600" } as const;

/**
 * Native text styles on the system font, in points: iOS body text is 17/22. Titles use the
 * font's own line spacing, written out so they don't inherit a smaller body line height.
 */
export const typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
} as const;

/**
 * Text grows with the iOS text size until body text reaches 23pt, the xxxLarge size. Larger
 * accessibility sizes keep that size, so message bubbles, rows and cards keep their layout.
 */
export const MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

/** The ink of a drawn bot's eyes, the same on every body colour and in both themes. */
export const botEyeColor = "#101014";

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "system";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

/** The web and Electron palette; `tokensForAppearance` is the mobile one. */
export function webTokensForAppearance(appearance: ResolvedAppearance): WebColorTokens {
  return appearance === "light" ? webLightTokens : webDarkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof WebColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  const extras = [
    `  --elevation-raised: ${elevation[colorScheme].raised};`,
    `  --elevation-overlay: ${elevation[colorScheme].overlay};`,
    `  --radius: ${RADIUS};`,
    `  --motion-fast: ${motion.fast};`,
    `  --motion-panel: ${motion.panel};`,
    `  --motion-ease-out: ${motion.easeOut};`,
    `  --title-weight: ${titleType.weight};`,
    `  --title-tracking: ${titleType.tracking};`,
    `  --title-line-height: ${titleType.lineHeight};`,
  ];
  return `${selector} {\n  color-scheme: ${colorScheme};\n${[...lines, ...extras].join("\n")}\n}`;
}

/** The CSS in `tokens.css` (web and Electron). Generated from the web palettes so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @corvo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", webDarkTokens),
    renderBlock('[data-theme="light"]', "light", webLightTokens),
  ].join("\n\n")}\n`;
}
