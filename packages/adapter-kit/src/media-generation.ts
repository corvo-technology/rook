import type { MediaAspectRatio } from "@corvo/contracts";
import type { AdapterContext } from "./types.js";

export type { MediaAspectRatio } from "@corvo/contracts";
export { MEDIA_ASPECT_RATIOS } from "@corvo/contracts";
/** A picture an image starts from, already read and checked by the caller. */
export type MediaReferenceImage = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};
export type MediaGenerationInput = {
  prompt: string;
  aspectRatio?: MediaAspectRatio;
  /** Pictures to edit or vary; only for a provider whose capabilities say `references`. */
  references?: readonly MediaReferenceImage[];
  /** How many pictures to make; at most the provider's `maxCount`. */
  count?: number;
};
export type GeneratedMedia = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4";
  /** What the provider charged for this output, in US dollars, when it says. */
  costUsd?: number;
};
export type MediaVideoJob =
  | { id: string; status: "queued" | "running"; progress?: number }
  | { id: string; status: "completed"; output: GeneratedMedia }
  | { id: string; status: "failed" };
export interface MediaGenerationProvider {
  readonly id: string;
  /** The image model in use, for the credit record. */
  readonly imageModel?: string;
  readonly capabilities: {
    images: boolean;
    video: boolean;
    offline: boolean;
    /** Takes reference pictures for edits and variations. */
    references: boolean;
    /** Most pictures one call makes. */
    maxCount: number;
  };
  /** One output per picture asked for. */
  generateImage(input: MediaGenerationInput, context: AdapterContext): Promise<GeneratedMedia[]>;
  generateVideo(input: MediaGenerationInput, context: AdapterContext): Promise<MediaVideoJob>;
  pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob>;
}
export type MediaGenerationErrorCode =
  | "invalid_input"
  | "unsupported"
  | "authentication"
  | "rate_limit"
  | "provider_failure"
  | "output_limit";
export class MediaGenerationError extends Error {
  /**
   * True when the provider may already have produced, and charged for, the output (the answer
   * never arrived or could not be read). False when it refused before generating anything.
   */
  readonly uncertain: boolean;
  constructor(
    public readonly code: MediaGenerationErrorCode,
    options: { uncertain?: boolean } = {},
  ) {
    super(`Media generation: ${code}`);
    this.name = "MediaGenerationError";
    this.uncertain = options.uncertain ?? false;
  }
}
