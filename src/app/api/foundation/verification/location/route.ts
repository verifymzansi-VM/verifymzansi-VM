import { type NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "../../_lib/owner-route";
import { createLogger } from "@/lib/utils/logger";
const log = createLogger("FoundationLocation");
export function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:manual-location",
    mutate: true,
    unavailableMessage: "Your location could not be saved",
    signInMessage: "Sign in to confirm your location",
    refusal: () => null,
    command: async (api, input) => {
      const value = z
        .strictObject({
          province: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
          city: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
        })
        .parse(input);
      const result = await api.rpc("confirm_verification_locality", {
        p_province: value.province,
        p_city: value.city,
      });
      if (result.error) throw new Error();
      return result.data;
    },
  });
}
