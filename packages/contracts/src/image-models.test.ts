import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MAX_COUNT,
  IMAGE_MODEL_CATALOG,
  IMAGE_UNLISTED_WORST_CASE_USD,
  imageCatalogUsd,
  imageModelEntry,
  imageWorstCaseUsd,
  MEDIA_ASPECT_RATIOS,
} from "./image-models.js";

describe("image model catalog", () => {
  it("is well formed: ids unique, prices dated and ordered, counts within the cap", () => {
    expect(new Set(IMAGE_MODEL_CATALOG.map((entry) => entry.id)).size).toBe(
      IMAGE_MODEL_CATALOG.length,
    );
    for (const entry of IMAGE_MODEL_CATALOG) {
      expect(entry.pricedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.price.typicalUsd).toBeGreaterThan(0);
      expect(entry.price.worstCaseUsd).toBeGreaterThanOrEqual(entry.price.typicalUsd);
      expect(entry.maxCount).toBeGreaterThanOrEqual(1);
      expect(entry.maxCount).toBeLessThanOrEqual(IMAGE_MAX_COUNT);
      for (const ratio of entry.aspectRatios) expect(MEDIA_ASPECT_RATIOS).toContain(ratio);
    }
  });

  it("holds the worst case per picture, and a cautious price for an unlisted model", () => {
    expect(imageWorstCaseUsd("gpt-image-1", 3)).toBe(0.75);
    expect(imageWorstCaseUsd("acme/unlisted", 2)).toBe(IMAGE_UNLISTED_WORST_CASE_USD * 2);
    expect(imageWorstCaseUsd(undefined, 1)).toBe(IMAGE_UNLISTED_WORST_CASE_USD);
  });

  it("treats a router prefix as the same model", () => {
    expect(imageModelEntry("openai/gpt-image-1")).toBe(imageModelEntry("gpt-image-1"));
    expect(imageModelEntry("google/gemini-3.1-flash-image")?.id).toBe("gemini-3.1-flash-image");
    expect(imageWorstCaseUsd("openai/gpt-image-1", 1)).toBe(imageWorstCaseUsd("gpt-image-1", 1));
    expect(imageCatalogUsd("openai/gpt-image-1", 2)).toBe(0.084);
    expect(imageModelEntry("acme/gpt-image-1")).toBeUndefined();
    expect(imageModelEntry(DEFAULT_IMAGE_MODEL)).toBeDefined();
  });

  it("prices what was made at the usual price, and says nothing for an unlisted model", () => {
    expect(imageCatalogUsd("gpt-image-1", 2)).toBe(0.084);
    expect(imageCatalogUsd("acme/unlisted", 2)).toBeUndefined();
    expect(imageModelEntry("dall-e-3")?.references).toBe(false);
  });
});
