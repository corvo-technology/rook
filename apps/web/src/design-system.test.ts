import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The app is monochrome and every color comes from the semantic tokens in `@corvo/ui-tokens`
 * (AGENTS.md). This keeps it that way: a hard-coded color, or an arbitrary `[var(--…)]` value,
 * in the web UI fails here instead of slipping in during a review.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["apps/web/src", "packages/ui-web/src"];

/** Files that may carry a literal color, and why. A new entry needs a reason a reviewer accepts. */
const ALLOWED: Record<string, string> = {
  "packages/ui-web/src/styles.css": "the same mascot tile, in the shared stylesheet",
  "apps/web/src/pages/WindowChrome.tsx": "the macOS window buttons, which have fixed colors",
  "packages/ui-web/src/bot-avatar.tsx":
    "the default identity color of a bot, which is data, not chrome",
  "apps/web/src/pages/shell/chat-shared.ts": "the identity color shown for a bot that has none",
  "packages/ui-web/src/group-avatar.tsx": "a neutral black shadow under overlapping avatars",
  "apps/web/src/pages/RoutineEditor.tsx": "the brand colors of the apps a routine can connect to",
};

const HEX = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
// A color derived from one that already exists (`oklch(from currentColor …)`) adds none.
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\((?!\s*from\s)/;
// Black as the opaque stop of a CSS mask is opacity, not a color.
const MASK_STOP = /#000(?:000)?\b/g;
const ARBITRARY_VAR = /\[var\(--/;

/** The lines of a source file that hard-code a color or reach into a CSS variable. */
function colorViolations(
  source: string,
  kind: "css" | "code" = "code",
): Array<{ line: number; text: string }> {
  return source.split("\n").flatMap((text, index) => {
    const checked = kind === "css" ? text.replace(MASK_STOP, "") : text;
    return HEX.test(checked) || FUNCTIONAL_COLOR.test(checked) || ARBITRARY_VAR.test(checked)
      ? [{ line: index + 1, text: text.trim().slice(0, 120) }]
      : [];
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name === "locales" || name === "generated"
        ? []
        : sourceFiles(path);
    }
    return /\.(tsx?|css)$/.test(name) && !/\.(test|spec|stories)\./.test(name) ? [path] : [];
  });
}

const files = ROOTS.flatMap((dir) => sourceFiles(join(root, dir))).map((path) => ({
  path: relative(root, path),
  source: readFileSync(path, "utf8"),
}));

describe("the design system", () => {
  it("finds the sources it is supposed to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no hard-coded color or arbitrary variable outside the files allowed to", () => {
    const found = files
      .filter((file) => !(file.path in ALLOWED))
      .flatMap((file) =>
        colorViolations(file.source, file.path.endsWith(".css") ? "css" : "code").map(
          (hit) => `${file.path}:${hit.line}  ${hit.text}`,
        ),
      );
    expect(found, `Use a semantic token instead:\n${found.join("\n")}`).toEqual([]);
  });

  it("keeps the list of allowed files honest: each still has a color that needs the exception", () => {
    for (const path of Object.keys(ALLOWED)) {
      const file = files.find((item) => item.path === path);
      expect(file, `${path} no longer exists; remove it from the list`).toBeDefined();
      expect(
        colorViolations(file!.source, path.endsWith(".css") ? "css" : "code").length,
        `${path} has no hard-coded color left; remove it from the list`,
      ).toBeGreaterThan(0);
    }
  });

  it("catches the ways a color gets in", () => {
    for (const bad of [
      'className="bg-[#232323]"',
      "color: #fff;",
      'style={{ color: "rgb(1, 2, 3)" }}',
      'className="text-[var(--muted)]"',
      "fill: hsl(10 20% 30%)",
      'border-color: "#ff00ff80"',
    ]) {
      expect(colorViolations(bad), bad).toHaveLength(1);
    }
  });

  it("lets black through as a CSS mask stop, but not as a color in code", () => {
    expect(
      colorViolations("mask-image: linear-gradient(#000 0, transparent);", "css"),
    ).toHaveLength(0);
    expect(colorViolations('const c = "#000";')).toHaveLength(1);
    expect(colorViolations("color: #111;", "css")).toHaveLength(1);
  });

  it("lets semantic tokens and ordinary text through", () => {
    for (const fine of [
      'className="bg-background text-foreground border-border"',
      "const issue = 12; // see issue #12",
      "color: oklch(from var(--color-foreground) l c h / 0.6);",
      'className="bg-primary/80 text-muted-foreground"',
      "color: var(--foreground);",
    ]) {
      expect(colorViolations(fine), fine).toHaveLength(0);
    }
  });
});
