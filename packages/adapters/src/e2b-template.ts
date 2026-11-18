import type { BuildOptions, TemplateClass } from "@e2b/desktop";
import { Template } from "@e2b/desktop";

/** E2B's stock desktop image, which reserves 8 vCPU and 8 GB for every sandbox. */
export const E2B_DESKTOP_TEMPLATE = "desktop";
/** The same desktop at the size a bot computer needs; see buildE2BComputerTemplate. */
export const E2B_COMPUTER_TEMPLATE = "corvo-computer";

/**
 * A computer runs one desktop per active bot (Xvfb, fluxbox, x11vnc, Chromium) plus shell
 * work. Two cores keep the desktop and a browser responsive; 4 GB leaves room for a second
 * bot's Chromium on a Team Computer, where 2 GB would start swapping or killing tabs.
 */
/**
 * Disk is not set directly. E2B takes the sandbox's disk from the team plan (10 GiB on Hobby,
 * 20+ GiB on Pro) and `minFreeDiskMb` asks the build to grow the root filesystem until that
 * much space is free on top of the image: "a free-space target for a template build, not a total
 * disk-size setting" (docs.e2b.dev/template/build, "Minimum free disk space"; docs.e2b.dev/faq/build-limits).
 * Without it the filesystem stays near the image's size (about 2.5 GB, of which the image uses
 * 1.3 GB), which a browser profile and the agent CLIs' caches fill. The growth is best effort and
 * never shrinks, and a plan smaller than the image plus this figure gets the plan's maximum.
 */
export const E2B_COMPUTER_MIN_FREE_DISK_MB = 8192;

const E2B_COMPUTER_RESOURCES = {
  cpuCount: 2,
  memoryMB: 4096,
  minFreeDiskMb: E2B_COMPUTER_MIN_FREE_DISK_MB,
} as const;

type BuildTemplate = (
  template: TemplateClass,
  name: string,
  options: Omit<BuildOptions, "alias">,
) => Promise<{ name: string }>;

/** Publish the Rook computer template to the E2B team that owns this API key. */
export function buildE2BComputerTemplate(
  apiKey: string,
  options: {
    build?: BuildTemplate;
    onBuildLogs?: (line: string) => void;
  } = {},
) {
  const build: BuildTemplate =
    options.build ??
    ((template, name, buildOptions) => Template.build(template, name, buildOptions));
  return build(Template().fromTemplate(E2B_DESKTOP_TEMPLATE), E2B_COMPUTER_TEMPLATE, {
    apiKey,
    ...E2B_COMPUTER_RESOURCES,
    ...(options.onBuildLogs
      ? { onBuildLogs: (entry) => options.onBuildLogs?.(entry.toString()) }
      : {}),
  });
}
