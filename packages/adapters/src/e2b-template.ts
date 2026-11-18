import type { BuildOptions, TemplateClass } from "@e2b/desktop";
import { Template } from "@e2b/desktop";

/** E2B's stock desktop image, which reserves 8 vCPU and 8 GB for every sandbox. */
export const E2B_DESKTOP_TEMPLATE = "desktop";
/** The single-size template published before sizes existed; computers on it count as `small`. */
export const E2B_LEGACY_COMPUTER_TEMPLATE = "corvo-computer";

/**
 * A computer runs one desktop per active bot (Xvfb, fluxbox, x11vnc, Chromium) plus shell
 * work. Two cores keep the desktop and a browser responsive; 4 GB leaves room for a second
 * bot's Chromium on a Team Computer, where 2 GB would start swapping or killing tabs. Larger
 * sizes scale the same desktop for heavier work.
 *
 * Disk is a free-space request, not a total. It is passed as `minFreeDiskMb` in the template
 * build, the E2B SDK's field for "requested minimum free space after the template's build steps"
 * (docs.e2b.dev/template/build, "Minimum free disk space"). It only takes effect if the
 * E2B-compatible host honours it; on e2b.dev the plan caps it, and on a self-run host such as
 * Rookbox the operator controls the real disk. Without it the filesystem stays near the image's
 * size (about 2.5 GB, of which the image uses 1.3 GB), which browser profiles and the agent CLIs'
 * caches fill. The figures are a target total minus the image.
 */
export const E2B_COMPUTER_SIZES = {
  small: { template: "rook-computer-s", cpuCount: 2, memoryMB: 4096, minFreeDiskMb: 8192 },
  medium: { template: "rook-computer-m", cpuCount: 4, memoryMB: 8192, minFreeDiskMb: 18432 },
  large: { template: "rook-computer-l", cpuCount: 8, memoryMB: 16384, minFreeDiskMb: 38912 },
} as const;
export type E2BComputerSize = keyof typeof E2B_COMPUTER_SIZES;
export const E2B_DEFAULT_COMPUTER_SIZE: E2BComputerSize = "small";
export const E2B_COMPUTER_SIZE_NAMES = Object.keys(E2B_COMPUTER_SIZES) as E2BComputerSize[];

/** Templates to try for a size, best first. The legacy name is still the small computer. */
export function e2bTemplatesForSize(size: E2BComputerSize): string[] {
  const { template } = E2B_COMPUTER_SIZES[size];
  return size === "small" ? [template, E2B_LEGACY_COMPUTER_TEMPLATE] : [template];
}

type BuildTemplate = (
  template: TemplateClass,
  name: string,
  options: Omit<BuildOptions, "alias">,
) => Promise<{ name: string }>;

/** Publish one size of the Rook computer template to the E2B team that owns this API key. */
export function buildE2BComputerTemplate(
  apiKey: string,
  options: {
    size?: E2BComputerSize;
    build?: BuildTemplate;
    onBuildLogs?: (line: string) => void;
  } = {},
) {
  const { template, ...resources } = E2B_COMPUTER_SIZES[options.size ?? E2B_DEFAULT_COMPUTER_SIZE];
  const build: BuildTemplate =
    options.build ?? ((image, name, buildOptions) => Template.build(image, name, buildOptions));
  return build(Template().fromTemplate(E2B_DESKTOP_TEMPLATE), template, {
    apiKey,
    ...resources,
    ...(options.onBuildLogs
      ? { onBuildLogs: (entry) => options.onBuildLogs?.(entry.toString()) }
      : {}),
  });
}
