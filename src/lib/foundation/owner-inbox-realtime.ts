import type { SupabaseClient } from "@supabase/supabase-js";
import { foundationOwnerInboxTopic } from "./owner-inbox";

type RealtimeClient = Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">;
type Subscription = {
  token: string;
  listeners: Set<() => void>;
  ready: Promise<void>;
  channel?: ReturnType<RealtimeClient["channel"]>;
};
const subscriptions = new WeakMap<RealtimeClient, Map<string, Subscription>>();

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
  let topics = subscriptions.get(client);
  if (!topics) {
    topics = new Map();
    subscriptions.set(client, topics);
  }
  let current = topics.get(topic);
  if (!current) {
    current = { token: accessToken, listeners: new Set(), ready: Promise.resolve() };
    topics.set(topic, current);
    const entry = current;
    entry.ready = (async () => {
      await client.realtime.setAuth(accessToken);
      entry.channel = client.channel(topic, { config: { private: true } });
      try {
        entry.channel
          .on("broadcast", { event: "inbox_changed" }, () => {
            for (const listener of entry.listeners) listener();
          })
          .subscribe((status) => {
            // Catch changes between the server render and the channel join.
            if (status === "SUBSCRIBED") for (const listener of entry.listeners) listener();
          });
      } catch (error) {
        await Promise.resolve(client.removeChannel(entry.channel)).catch(() => {});
        throw error;
      }
    })();
  } else if (current.token !== accessToken) {
    await client.realtime.setAuth(accessToken);
    current.token = accessToken;
  }
  const entry = current;
  const listener = () => onChange();
  entry.listeners.add(listener);
  try {
    await entry.ready;
  } catch (error) {
    entry.listeners.delete(listener);
    if (topics.get(topic) === entry) topics.delete(topic);
    throw error;
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      if (topics.get(topic) === entry) topics.delete(topic);
      if (entry.channel) void Promise.resolve(client.removeChannel(entry.channel)).catch(() => {});
    }
  };
}
