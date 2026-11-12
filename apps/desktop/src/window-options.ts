export const DEFAULT_WARM_WINDOW_TTL_MS = 15 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function warmWindowTtlMs(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_WARM_WINDOW_TTL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIMER_DELAY_MS
    ? parsed
    : DEFAULT_WARM_WINDOW_TTL_MS;
}

// Keep in sync with webDarkTokens.background and webLightTokens.background from
// @corvo/ui-tokens (asserted in tests). Do not import that package here: desktop packs
// compiled JS only and ui-tokens is a TypeScript source / devDependency.
const DARK_BACKGROUND = "#0A0A0A";
const LIGHT_BACKGROUND = "#F2F2EF";

/** The window paints before the web UI does, so it takes the scheme the UI will follow (the system one). */
export function windowBackground(dark: boolean) {
  return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function windowChrome(platform: NodeJS.Platform, dark: boolean) {
  const mac = platform === "darwin";
  return {
    backgroundColor: windowBackground(dark),
    show: true,
    autoHideMenuBar: true,
    frame: mac,
    titleBarStyle: mac ? ("hiddenInset" as const) : undefined,
    trafficLightPosition: mac ? { x: 16, y: 16 } : undefined,
  };
}

export function browserWindowOptions(platform: NodeJS.Platform, dark = true) {
  return { width: 1440, height: 900, ...windowChrome(platform, dark) };
}

/**
 * Unpackaged (dev) launches set the dock/taskbar icon by hand. macOS draws the file as-is,
 * so it needs the squircle-with-margins asset; packaged builds already use icon.icns.
 */
export function developmentIconFile(platform: NodeJS.Platform) {
  return platform === "darwin" ? "icon-macos.png" : "icon.png";
}

/** The first-run setup window is smaller and keeps the same frameless chrome. */
export function setupWindowOptions(platform: NodeJS.Platform, dark = true) {
  return {
    width: 720,
    height: 700,
    minWidth: 480,
    minHeight: 560,
    ...windowChrome(platform, dark),
  };
}
