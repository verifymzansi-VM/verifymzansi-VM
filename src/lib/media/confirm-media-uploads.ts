import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ConfirmMediaUploads");

type SupabaseLike = {
  from: (table: string) => unknown;
};

type MediaUploadsQueryBuilder = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: unknown
    ) => {
      in: (
        column: string,
        values: unknown[]
      ) => PromiseLike<{
        data?: Array<{ url: string | null }> | null;
        error?: { message?: string } | null;
      }>;
    };
  };
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

export type MediaContentType = "listing" | "business" | "promotion";

export class MediaUploadConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUploadConfirmationError";
  }
}

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

  try {
    const mediaUploads = supabase.from("media_uploads") as MediaUploadsQueryBuilder;
    const { data: savedUploads, error: lookupError } = await mediaUploads
      .select("url")
      .eq("user_id", userId)
      .in("url", uniqueUrls);

    if (lookupError) {
      log.error("Failed to verify media uploads before confirmation", {
        userId,
        contentType,
        contentId,
        urlCount: uniqueUrls.length,
        error: lookupError.message,
      });
      throw new MediaUploadConfirmationError("Unable to verify media uploads");
    }

    const savedUrlSet = new Set((savedUploads ?? []).map((upload) => upload.url).filter(Boolean));
    const missingUrls = uniqueUrls.filter((url) => !savedUrlSet.has(url));

    if (missingUrls.length > 0) {
      log.warn("Rejected unowned or missing media uploads", {
        userId,
        contentType,
        contentId,
        urlCount: uniqueUrls.length,
        missingCount: missingUrls.length,
      });
      throw new MediaUploadConfirmationError("One or more media uploads were not found");
    }

    const { error } = await mediaUploads
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
      throw new MediaUploadConfirmationError("Unable to confirm media uploads");
    }
  } catch (error) {
    if (error instanceof MediaUploadConfirmationError) {
      throw error;
    }

    log.error("Media upload confirmation threw unexpectedly", {
      userId,
      contentType,
      contentId,
      urlCount: uniqueUrls.length,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new MediaUploadConfirmationError("Unable to confirm media uploads");
  }
}
