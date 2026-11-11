import { z } from "zod";

/** The marks of the coach tour, in the order they take priority. */
export const TOUR_MARKS = ["ask", "first", "chief", "missions"] as const;
export const TourMark = z.enum(TOUR_MARKS);
export type TourMark = z.infer<typeof TourMark>;

export const TourStateSchema = z.object({
  done: z.array(TourMark),
  skipped: z.boolean(),
});
export type TourState = z.infer<typeof TourStateSchema>;
