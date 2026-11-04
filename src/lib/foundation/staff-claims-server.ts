import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import { readFrontendStaffClaims, type FrontendClaimType } from "./staff-claims";
async function read(actorId: string, items: Array<{ type: FrontendClaimType; id: string }>) {
  const current = await readFoundationServerSession();
  if (current.user.id !== actorId) throw new Error("Staff account changed");
  const result = await readFrontendStaffClaims(current.api, items);
  if (result.account_id !== actorId) throw new Error("Staff claim account changed");
  return result;
}
export const readMyFrontendStaffClaims = cache((actorId: string) => read(actorId, []));
export async function readFrontendStaffClaimViews(
  actorId: string,
  items: Array<{ type: FrontendClaimType; id: string }>
) {
  const views: Record<string, { mine: boolean; holderName: string; expiresAt: string }> = {};
  const keys = new Set(items.map((i) => `${i.type}:${i.id.toLowerCase()}`));
  for (let at = 0; at < items.length; at += 300) {
    const result = await read(actorId, items.slice(at, at + 300));
    for (const item of result.items) {
      const key = `${item.item_type}:${item.id}`;
      if (keys.has(key))
        views[key] = { mine: item.mine, holderName: item.holder_name, expiresAt: item.expires_at };
    }
  }
  return views;
}
