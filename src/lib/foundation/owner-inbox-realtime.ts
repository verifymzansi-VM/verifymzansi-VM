import type { SupabaseClient } from "@supabase/supabase-js";
import { foundationOwnerInboxTopic } from "./owner-inbox";

type RealtimeClient = Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">;

/**
 * Subscribes the signed-in owner to their private inbox topic. The signal
 * carries no content: on "inbox_changed" the caller rereads through the API.
 * Private channels are authorised by the realtime.messages policy (own live
 * session only). Returns an unsubscribe function.
 */
export async function subscribeFoundationOwnerInbox(
  client: RealtimeClient,
  accountId: string,
  accessToken: string,
  onChange: () => void
) {
  const topic = foundationOwnerInboxTopic(accountId);
  await client.realtime.setAuth(accessToken);
  const channel = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "inbox_changed" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
