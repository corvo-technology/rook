/** A six-digit hex colour as `#rrggbb`, or null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const red = Math.floor(n / 65536) % 256;
  const green = Math.floor(n / 256) % 256;
  const blue = n % 256;
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** WCAG contrast ratio of two six-digit hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

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
  /** A faint wash of the brand for selected states, progress tracks and soft accents. */
  brandSoft: string;
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
  /** The soft mint, lavender and peach of the band behind the plan cards; deep and muted in dark. */
  bandMint: string;
  bandLavender: string;
  bandPeach: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  background: "#000000",
  dialog: "#1D1D1F",
  foreground: "#F5F5F7",
  card: "#111113",
  cardForeground: "#F5F5F7",
  popover: "#1D1D1F",
  popoverForeground: "#F5F5F7",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#F5F5F7",
  primaryForeground: "#0A0A0A",
  secondary: "#1D1D1F",
  secondaryForeground: "#F5F5F7",
  chatUser: "#2C2C2E",
  chatUserForeground: "#F5F5F7",
  muted: "#161617",
  mutedForeground: "#A1A1A6",
  faintForeground: "#7C7C82",
  accent: "#232325",
  accentForeground: "#F5F5F7",
  brand: "#54C398",
  brandForeground: "#0A0A0A",
  brandSoft: "#12241C",
  destructive: "#FF6463",
  destructiveFill: "#CF2B35",
  destructiveForeground: "#FFFFFF",
  border: "#2C2C2E",
  input: "#3A3A3C",
  ring: "#54C398",
  sidebar: "#161617",
  sidebarForeground: "#F5F5F7",
  sidebarBorder: "#2C2C2E",
  sidebarAccent: "#2C2C2E",
  sidebarAccentForeground: "#F5F5F7",
  link: "#54C398",
  faviconPlate: "#FFFFFF",
  success: "#54C398",
  warning: "#E28600",
  statusWorking: "#54C398",
  unread: "#0062DB",
  workingDot: "#3FA266",
  bandMint: "#14261F",
  bandLavender: "#1E1A2E",
  bandPeach: "#2A1E17",
  overlay: "#000000B2",
  scrollbar: "#3A3A3C",
  scrollbarHover: "#58585C",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FFFFFF",
  dialog: "#FFFFFF",
  foreground: "#1D1D1F",
  card: "#FFFFFF",
  cardForeground: "#1D1D1F",
  popover: "#FFFFFF",
  popoverForeground: "#1D1D1F",
  glassFill: "#FFFFFF",
  glassStroke: "#1D1D1F14",
  primary: "#1D1D1F",
  primaryForeground: "#FFFFFF",
  secondary: "#F5F5F7",
  secondaryForeground: "#1D1D1F",
  chatUser: "#1D1D1F",
  chatUserForeground: "#FFFFFF",
  muted: "#F5F5F7",
  mutedForeground: "#656568",
  faintForeground: "#86868B",
  accent: "#F0F0F2",
  accentForeground: "#1D1D1F",
  brand: "#197B56",
  brandForeground: "#FFFFFF",
  brandSoft: "#E9F6EF",
  destructive: "#CD2834",
  destructiveFill: "#E72E3B",
  destructiveForeground: "#FFFFFF",
  border: "#E6E6E8",
  input: "#D6D6D6",
  ring: "#197B56",
  sidebar: "#F5F5F7",
  sidebarForeground: "#1D1D1F",
  sidebarBorder: "#E6E6E8",
  sidebarAccent: "#E6E6E8",
  sidebarAccentForeground: "#1D1D1F",
  link: "#197B56",
  faviconPlate: "#FFFFFF",
  success: "#007A43",
  warning: "#945600",
  statusWorking: "#197B56",
  unread: "#0B6DD3",
  workingDot: "#3FA266",
  bandMint: "#D7F0E4",
  bandLavender: "#E4DEF7",
  bandPeach: "#F9E3D3",
  overlay: "#00000080",
  scrollbar: "#D6D6D6",
  scrollbarHover: "#86868B",
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
  primaryDisabled: "#F5F5F729",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  primaryHover: "#3A3A3D",
  primaryDisabled: "#1D1D1F26",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

/**
 * Radii by role, in px: pill controls (buttons, inputs), menu items and links, popovers and rows,
 * cards and media, and the one main content panel. `--radius` is the card step; the Tailwind steps in `@corvo/ui-web`
 * derive from these.
 */
export const radius = { control: 9999, item: 10, surface: 16, card: 28, panel: 24 } as const;

export const RADIUS = `${radius.card}px`;

/**
 * Raised surfaces are flat: panels and cards take a 1px hairline, and only floating overlays
 * (popovers, menus) add one faint ambient shadow. Web only: native surfaces use system chrome.
 */
export const elevation = {
  light: {
    raised: "0 0 0 1px rgb(29 29 31 / 0.08)",
    overlay: "0 0 0 1px rgb(29 29 31 / 0.1), 0 8px 24px rgb(29 29 31 / 0.06)",
  },
  dark: {
    raised: "0 0 0 1px rgb(255 255 255 / 0.08)",
    overlay: "0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.5)",
  },
} as const;

/**
 * Atmosphere for the Home page: a fine dot grid under the content and the soft rings a focused
 * prompt and a working agent glow in. Neutral ink only, so no identity color leaks into chrome.
 */
export const atmosphere = {
  light: {
    dot: "rgb(10 10 10 / 0.1)",
    glow: "0 0 0 1px rgb(10 10 10 / 0.16), 0 0 0 4px rgb(10 10 10 / 0.05), 0 8px 28px rgb(10 10 10 / 0.08)",
    pulse: "rgb(10 10 10 / 0.22)",
    dither: "rgb(10 10 10 / 0.34)",
  },
  dark: {
    dot: "rgb(255 255 255 / 0.09)",
    glow: "0 0 0 1px rgb(255 255 255 / 0.22), 0 0 0 4px rgb(255 255 255 / 0.06), 0 8px 32px rgb(0 0 0 / 0.5)",
    pulse: "rgb(255 255 255 / 0.28)",
    dither: "rgb(255 255 255 / 0.3)",
  },
} as const;

/**
 * Durations and easing for transitions. Hovers and presses use `fast`, panels and page content
 * `panel`, and a one-off reveal `slow`. Components with motion must honour reduced motion.
 */
export const motion = {
  fast: "150ms",
  panel: "250ms",
  slow: "500ms",
  easeOut: "cubic-bezier(0.2, 0.7, 0.2, 1)",
} as const;

/**
 * Page and section titles, in the system display face with tight tracking. Sizes come
 * from the type scale; these are only what makes a title read as a title.
 */
export const titleType = { weight: "500", tracking: "-0.015em", lineHeight: "1.15" } as const;

/** The web and Electron UI font: the system San Francisco first, so text looks native on Apple devices. */
export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", "Helvetica Neue", Arial, sans-serif';

/** Body text tracks slightly tight; large headings tighter (see `titleType`). */
export const bodyTracking = "-0.01em";

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

/**
 * The web and Electron type scale, in px, for a calm work app: 15px text, 14px navigation, 13px
 * meta. Names are semibold and meta is muted at the point of use; sizes live only here.
 * `tokens.css` carries them as `--type-<name>-size` and `--type-<name>-line`.
 */
export const webTypeScale = {
  caption: { fontSize: 12, lineHeight: 16 },
  /** Role, time and other meta beside a name. */
  meta: { fontSize: 13, lineHeight: 18 },
  /** Navigation rows and the sidebar's lists. */
  nav: { fontSize: 14, lineHeight: 20 },
  body2: { fontSize: 14, lineHeight: 20 },
  /** Text in a conversation and the composer: 15px on a comfortable 24px line. */
  message: { fontSize: 15, lineHeight: 24 },
  /** A name above a message or in a header. */
  name: { fontSize: 15, lineHeight: 22 },
  body1: { fontSize: 15, lineHeight: 22 },
  heading3: { fontSize: 18, lineHeight: 26 },
  heading2: { fontSize: 24, lineHeight: 30 },
  heading1: { fontSize: 28, lineHeight: 34 },
} as const;

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

const CSS_LINE_WIDTH = 100;

/** A shadow list laid out the way the formatter lays it out: layers filled into 100-column lines. */
function cssShadow(name: string, layers: string): string {
  const one = `  ${name}: ${layers};`;
  if (one.length <= CSS_LINE_WIDTH) return one;
  const lines: string[] = [];
  let line = "   ";
  for (const layer of layers.split(", ")) {
    const piece = `${layer},`;
    if (line.length + 1 + piece.length > CSS_LINE_WIDTH && line.trim()) {
      lines.push(line);
      line = "   ";
    }
    line += ` ${piece}`;
  }
  lines.push(line);
  return `  ${name}:\n${lines.join("\n").replace(/,$/, "")};`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  const extras = [
    cssShadow("--elevation-raised", elevation[colorScheme].raised),
    cssShadow("--elevation-overlay", elevation[colorScheme].overlay),
    `  --atmosphere-dot: ${atmosphere[colorScheme].dot};`,
    cssShadow("--atmosphere-glow", atmosphere[colorScheme].glow),
    `  --atmosphere-pulse: ${atmosphere[colorScheme].pulse};`,
    `  --atmosphere-dither: ${atmosphere[colorScheme].dither};`,
    `  --radius: ${RADIUS};`,
    `  --radius-control: ${radius.control}px;`,
    `  --radius-item: ${radius.item}px;`,
    `  --radius-surface: ${radius.surface}px;`,
    `  --font-ui: ${fontFamily};`,
    `  --body-tracking: ${bodyTracking};`,
    `  --radius-card: ${radius.card}px;`,
    `  --radius-panel: ${radius.panel}px;`,
    `  --motion-fast: ${motion.fast};`,
    `  --motion-panel: ${motion.panel};`,
    `  --motion-slow: ${motion.slow};`,
    `  --motion-ease-out: ${motion.easeOut};`,
    `  --title-weight: ${titleType.weight};`,
    `  --title-tracking: ${titleType.tracking};`,
    `  --title-line-height: ${titleType.lineHeight};`,
    ...Object.entries(webTypeScale).flatMap(([name, { fontSize, lineHeight }]) => [
      `  --type-${name}-size: ${fontSize}px;`,
      `  --type-${name}-line: ${lineHeight}px;`,
    ]),
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
