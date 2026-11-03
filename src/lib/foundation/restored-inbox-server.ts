import "server-only";
import { readFoundationServerSession } from "./server-session";
import { readFoundationPresentedEnquiries } from "./owner-inbox";
import { restoredEnquiry } from "./restored-inbox";
export async function restoredOwnerEnquiries(accountId: string) {
  const current = await readFoundationServerSession();
  if (current.user.id !== accountId) throw new Error("Inbox account changed");
  const page = await readFoundationPresentedEnquiries(current.api, { limit: 50 });
  return page.items.map(restoredEnquiry);
}
