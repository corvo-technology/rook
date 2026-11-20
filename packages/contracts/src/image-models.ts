/** Proportions an image can ask for, as width:height. */
export const MEDIA_ASPECT_RATIOS = [
  "1:1",
  "4:5",
  "5:4",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
] as const;
export type MediaAspectRatio = (typeof MEDIA_ASPECT_RATIOS)[number];

/** Most pictures one call can ask for, whatever the model could make. */
export const IMAGE_MAX_COUNT = 4;
/** Most reference pictures one call can carry. */
export const IMAGE_MAX_REFERENCES = 4;
/** What one image holds on the account when the model is not in the catalog. */
export const IMAGE_UNLISTED_WORST_CASE_USD = 0.3;

export interface ImageModelEntry {
  /** The id the provider is asked for. */
  id: string;
  label: string;
  /** Whether it can start from reference pictures (edits and variations). */
  references: boolean;
  aspectRatios: readonly MediaAspectRatio[];
  /** Most pictures per call this model makes. */
  maxCount: number;
  price: {
    /** Per image, in US dollars, at the usual size and quality. */
    typicalUsd: number;
    /** Per image, at the dearest size and quality; what is held before the call. */
    worstCaseUsd: number;
  };
  /** When the price was last checked against the provider, as YYYY-MM-DD. */
  pricedOn: string;
}

/**
 * The image models Rook knows. They are not chat models and never reach a chat model picker:
 * the deployment names one, and this list says what it can do and costs. A model that is not
 * listed still works, held at a cautious price and without references.
 */
export const IMAGE_MODEL_CATALOG: readonly ImageModelEntry[] = [
  {
    id: "google/gemini-2.5-flash-image",
    label: "Fast image",
    references: false,
    aspectRatios: ["1:1", "4:5", "5:4", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
    maxCount: 4,
    price: { typicalUsd: 0.039, worstCaseUsd: 0.039 },
    pricedOn: "2026-11-20",
  },
  {
    id: "gpt-image-1",
    label: "Detailed image",
    references: true,
    aspectRatios: ["1:1", "2:3", "3:2"],
    maxCount: 4,
    price: { typicalUsd: 0.042, worstCaseUsd: 0.25 },
    pricedOn: "2026-11-20",
  },
  {
    id: "gpt-image-1-mini",
    label: "Light image",
    references: true,
    aspectRatios: ["1:1", "2:3", "3:2"],
    maxCount: 4,
    price: { typicalUsd: 0.011, worstCaseUsd: 0.052 },
    pricedOn: "2026-11-20",
  },
  {
    id: "dall-e-3",
    label: "Classic image",
    references: false,
    aspectRatios: ["1:1", "16:9", "9:16"],
    maxCount: 1,
    price: { typicalUsd: 0.04, worstCaseUsd: 0.12 },
    pricedOn: "2026-11-20",
  },
];

export function imageModelEntry(id: string | undefined): ImageModelEntry | undefined {
  return id ? IMAGE_MODEL_CATALOG.find((entry) => entry.id === id) : undefined;
}

/** The most one call for `count` pictures can cost; what is held on the account first. */
export function imageWorstCaseUsd(model: string | undefined, count: number): number {
  const perImage = imageModelEntry(model)?.price.worstCaseUsd ?? IMAGE_UNLISTED_WORST_CASE_USD;
  return roundUsd(perImage * count);
}

/** What `count` pictures cost at the catalog price, for a provider that does not report it. */
export function imageCatalogUsd(model: string | undefined, count: number): number | undefined {
  const entry = imageModelEntry(model);
  return entry ? roundUsd(entry.price.typicalUsd * count) : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
