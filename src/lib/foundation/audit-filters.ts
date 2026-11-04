import { z } from "zod";
/** Shared literal selectors for native audit readers. They select events;
 * none supplies the caller's identity or authority. */
export const auditSubjectFilters = {
  actor: z.uuid().optional(),
  target: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().min(1).max(100).optional(),
};
