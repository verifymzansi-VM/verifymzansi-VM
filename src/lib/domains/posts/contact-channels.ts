import { z } from "zod";

const postContactChannels = ["call", "whatsapp", "form"] as const;
const input = z.enum(["call", "whatsapp", "form", "in_app"]);

/** Explicit preference only; this neither verifies a number nor permits reveal. */
export const postContactSelectionSchema = z
  .array(input)
  .max(4)
  .transform((values) => {
    const chosen = new Set(values.map((value) => (value === "in_app" ? "form" : value)));
    return postContactChannels.filter((value) => chosen.has(value));
  });

/** Database outputs must already be canonical; do not silently repair a DTO. */
export const storedPostContactSelectionSchema = z
  .array(z.enum(postContactChannels))
  .max(3)
  .refine(
    (values) =>
      JSON.stringify(values) ===
      JSON.stringify(postContactChannels.filter((value) => values.includes(value)))
  );
