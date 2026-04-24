import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ConfirmMediaUploads");

type SupabaseLike = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (
        column: string,
        value: unknown
      ) => {
        in: (
          column: string,
          values: unknown[]
        ) => PromiseLike<{
          error?: { message?: string } | null;
        }>;
      };
    };
  };
};

export type MediaContentType = "listing" | "business" | "promotion";

export async function confirmMediaUploads({
  supabase,
  userId,
  urls,
  contentType,
  contentId,
}: {
  supabase: SupabaseLike;
  userId: string;
  urls: Array<string | null | undefined>;
  contentType: MediaContentType;
  contentId: string;
}): Promise<void> {
  const uniqueUrls = Array.from(
    new Set(urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0))
  );

  if (uniqueUrls.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("media_uploads")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("url", uniqueUrls);

  if (error) {
    log.error("Failed to confirm media uploads", {
      userId,
      contentType,
      contentId,
      urlCount: uniqueUrls.length,
      error: error.message,
    });
  }
}
