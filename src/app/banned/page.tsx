import { redirect } from "next/navigation";
import { BannedPageContent } from "./banned-content";
import { readSelfReviewSession } from "@/lib/foundation/self-review-session";
import { FoundationSessionError } from "@/lib/foundation/request-api";

export default async function BannedPage() {
  let status;
  try {
    status = await readSelfReviewSession();
  } catch (error) {
    if (error instanceof FoundationSessionError && error.status === 401) redirect("/");
    throw error;
  }
  if (status?.status !== "banned") redirect("/");
  return <BannedPageContent />;
}
