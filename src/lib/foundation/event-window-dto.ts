import { z } from "zod";

// Exact stored instants for owner and approved public reads; requests normalize separately.
const instant = z.iso.datetime({ precision: 3 }).refine((value) => {
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
  );
});
export const foundationEventWindowSchema = z
  .strictObject({
    starts_at: instant,
    ends_at: instant,
    // Preserve stored PostgreSQL timezone aliases; creation canonicalization is separate.
    timezone: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_+./-]+$/),
  })
  .refine((value) => {
    const duration = Date.parse(value.ends_at) - Date.parse(value.starts_at);
    return duration > 0 && duration <= 90 * 86400000;
  });
