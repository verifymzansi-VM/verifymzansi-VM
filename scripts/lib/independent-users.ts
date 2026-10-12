import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
export async function verifyIndependentUsers(url: string, anonKey: string, serviceKey: string) {
  if (new URL(url).hostname !== "127.0.0.1")
    throw new Error("Synthetic auth tests require loopback");
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `${randomUUID()}@example.invalid`,
      password = `Synthetic-${randomUUID()}-A9!`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "admin" },
    });
    if (created.error || !created.data.user) throw new Error("Synthetic account creation failed");
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw new Error("Synthetic sign-in failed");
    users.push({ id: created.data.user.id, client });
  }
  try {
    for (let i = 0; i < 2; i++) {
      const owner = users[i],
        other = users[1 - i];
      const own = await owner.client
        .from("account_profiles")
        .select("user_id")
        .eq("user_id", owner.id);
      if (own.error || own.data.length !== 1) throw new Error("Owner profile read failed");
      const foreign = await owner.client
        .from("account_profiles")
        .select("user_id")
        .eq("user_id", other.id);
      if (foreign.error || foreign.data.length)
        throw new Error("Cross-user profile read not denied");
      const change = await owner.client
        .from("account_profiles")
        .update({ display_name: "unauthorized" })
        .eq("user_id", other.id)
        .select("user_id");
      if (!change.error && change.data?.length)
        throw new Error("Cross-user profile write succeeded");
      const role = await owner.client.rpc("current_staff_role");
      if (role.error || role.data !== null)
        throw new Error("Ordinary user obtained staff authority");
      const privileged = await owner.client.rpc("staff_access_of", { p_user: other.id });
      if (!privileged.error) throw new Error("Ordinary user can call service-only staff lookup");
      const insert = await admin
        .from("kyc_artifacts")
        .insert({
          user_id: owner.id,
          step_type: "id_doc",
          r2_key: `synthetic-isolation/${owner.id}`,
          content_type: "image/jpeg",
          file_size_bytes: 1,
        })
        .select("id")
        .single();
      if (insert.error || !insert.data) throw new Error("Synthetic artifact setup failed");
      for (const unauthorized of [other.client, createClient(url, anonKey)]) {
        const result = await unauthorized
          .from("kyc_artifacts")
          .select("id")
          .eq("id", insert.data.id);
        if (result.error || result.data.length)
          throw new Error("Private artifact metadata exposed");
      }
    }
  } finally {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }
}
