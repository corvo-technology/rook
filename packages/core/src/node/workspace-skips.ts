/**
 * Browser state a workspace export leaves out. It lives in core so the Docker supervisor, which
 * archives a home on its own host, and the adapters that read exports agree on one list.
 */
/** Browser profile directories the browser rebuilds on its own; exports skip them. */
export const SKIPPED_BROWSER_PROFILE_DIRECTORIES: ReadonlySet<string> = new Set([
  "Cache",
  "Code Cache",
  "CacheStorage",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GraphiteDawnCache",
  "Crashpad",
  "startup_cache",
  "cache2",
  // Components and models the browser downloads again on its own; each copy is per bot.
  "ActorSafetyLists",
  "CertificateRevocation",
  "component_crx_cache",
  "Crowd Deny",
  "DeferredBrowserMetrics",
  "Dictionaries",
  "extensions_crx_cache",
  "hyphen-data",
  "OnDeviceHeadSuggestModel",
  "optimization_guide_model_store",
  "OptimizationHints",
  "PKIMetadata",
  "Safe Browsing",
  "SafetyTips",
  "screen_ai",
  "Subresource Filter",
  "WasmTtsEngine",
  "WidevineCdm",
  "ZxcvbnData",
]);
/** Browser profile files that are transient locks and metrics; exports skip them. */
export const SKIPPED_BROWSER_PROFILE_FILES: ReadonlySet<string> = new Set([
  "BrowserMetrics",
  "BrowserMetrics-spare.pma",
  "DevToolsActivePort",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
  ".parentlock",
  "lock",
]);

/** Excludes transient browser state that is unsafe or wasteful to restore. */
export function shouldSkipPortableWorkspaceFile(relative: string) {
  if (!relative.startsWith(".browser-profiles/")) return false;
  const segments = relative.split("/");
  const name = segments.at(-1) ?? "";
  return (
    segments.some((segment) => SKIPPED_BROWSER_PROFILE_DIRECTORIES.has(segment)) ||
    SKIPPED_BROWSER_PROFILE_FILES.has(name)
  );
}
