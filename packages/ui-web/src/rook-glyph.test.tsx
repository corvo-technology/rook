import { MASCOT_HAPPY_ARCS, MASCOT_SLEEP_ARCS, ROOK_SPINNER_ARC } from "@corvo/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RookGlyph } from "./rook-glyph.js";

const draw = (state?: Parameters<typeof RookGlyph>[0]["state"]) =>
  renderToString(<RookGlyph state={state} size={24} />);

describe("RookGlyph", () => {
  it("draws the rook in currentColor with two eyes cut out, looking around while idle", () => {
    const html = draw();
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('fill="currentColor"');
    expect(html.match(/corvo-rook-glyph-eye"/g)).toHaveLength(2);
    expect(html).toMatch(/mask="url\(#rook-glyph-[\w-]+\)"/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/width:24px;height:24px/);
  });

  it("thinks inside a ring of eight dots", () => {
    const html = draw("thinking");
    expect(html.match(/corvo-rook-glyph-dot"/g)).toHaveLength(8);
    expect(html).toContain("animation-delay:0.875s");
    expect(draw("idle")).not.toContain("corvo-rook-glyph-dot");
  });

  it("closes its eyes into curves when asleep, and smiles when done", () => {
    const asleep = draw("asleep");
    expect(asleep).toContain(MASCOT_SLEEP_ARCS[0]);
    expect(asleep).not.toContain("corvo-rook-glyph-eye");
    const done = draw("done");
    expect(done).toContain(MASCOT_HAPPY_ARCS[0]);
  });

  it("carries a spinner arc to fold into only while loading", () => {
    expect(draw("loading")).toContain(ROOK_SPINNER_ARC);
    expect(draw("thinking")).not.toContain(ROOK_SPINNER_ARC);
  });

  it("is an image with a name when labelled", () => {
    const html = renderToString(<RookGlyph state="loading" label="Loading" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Loading"');
    expect(html).not.toContain("aria-hidden");
  });
});
