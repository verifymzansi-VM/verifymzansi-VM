import { z } from "zod";
import { uuidSchema } from "@/lib/validations/shared";

export const idRouteParamsSchema = z.object({
  id: uuidSchema,
});
