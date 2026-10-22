import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { nativeTotp } from "./foundation-native-totp.mjs";

type Sql = (statement: string) => Promise<string>;
type StaffRole = "moderator" | "governance_controller" | "admin";
type Principal = { label: string; client: SupabaseClient; staff?: StaffRole };

/**
 * Which callers may read owner A's row in each personal-data table, as the
 * reviewed RLS policies and grants intend. Anyone not listed must see nothing:
 * other accounts, signed-out visitors, staff without a fresh authenticator
 * code, and staff roles not named here.
 */
const MATRIX: Record<string, { owner: boolean; staff: StaffRole[] }> = {
  account_profiles: { owner: true, staff: ["admin"] },
  kyc_artifacts: { owner: true, staff: ["moderator", "admin"] },
  verification_sessions: { owner: true, staff: ["moderator", "admin"] },
  verification_steps: { owner: true, staff: ["moderator", "admin"] },
  kyc_provider_results: { owner: false, staff: ["moderator", "admin"] },
  kyc_risk_signals: { owner: false, staff: ["moderator", "admin"] },
  payments: { owner: true, staff: ["admin"] },
  invoices: { owner: true, staff: ["admin"] },
  entitlements: { owner: true, staff: ["admin"] },
  leads: { owner: true, staff: ["admin"] },
  notifications: { owner: true, staff: [] },
  consent_records: { owner: true, staff: ["admin"] },
  contact_change_history: { owner: true, staff: ["admin"] },
  profile_change_history: { owner: true, staff: [] },
  media_uploads: { owner: true, staff: [] },
  listing_drafts: { owner: true, staff: [] },
  otp_challenges: { owner: false, staff: [] },
  otp_logs: { owner: false, staff: ["admin"] },
  dsar_cases: { owner: false, staff: ["admin"] },
  contact_submissions: { owner: false, staff: [] },
  buyer_verifications: { owner: false, staff: ["admin"] },
  listings: { owner: true, staff: ["moderator", "admin"] },
  listing_private: { owner: false, staff: [] },
  businesses: { owner: true, staff: ["moderator", "admin"] },
  business_private: { owner: false, staff: [] },
  business_verifications: { owner: false, staff: ["moderator", "governance_controller", "admin"] },
  business_verification_messages: {
    owner: false,
    staff: ["moderator", "governance_controller", "admin"],
  },
  partners: { owner: true, staff: ["governance_controller", "admin"] },
  audit_logs: { owner: false, staff: ["admin"] },
  kyc_evidence_access_logs: { owner: false, staff: ["moderator", "admin"] },
  account_acquisition: { owner: false, staff: ["governance_controller", "admin"] },
};
const KEY: Record<string, string> = {
  account_profiles: "user_id",
  listing_private: "listing_id",
  business_private: "business_id",
};

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Real local Auth accounts against the isolated database with every legacy
 * migration applied. Staff get genuine TOTP factors; one admin session is aged
 * past the 12 hour re-verification window by editing only its local AMR rows.
 */
export async function verifyLegacyAccessMatrix(
  url: string,
  anonKey: string,
  serviceKey: string,
  sql: Sql
): Promise<{ tables: number; principals: number }> {
  if (new URL(url).hostname !== "127.0.0.1") fail("Synthetic access matrix requires loopback");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, options);
  const created: string[] = [];
  const signIn = async (label: string) => {
    const email = `${label}-${randomUUID()}@example.invalid`,
      password = `Synthetic-${randomUUID()}-A9!`;
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (user.error || !user.data.user) fail("Synthetic account creation failed");
    created.push(user.data.user.id);
    const login = async () => {
      const client = createClient(url, anonKey, options);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) fail("Synthetic sign-in failed");
      return client;
    };
    return { id: user.data.user.id, client: await login(), login };
  };
  const withTotp = async (client: SupabaseClient) => {
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    if (enrolled.error) fail("Synthetic TOTP enrolment failed");
    const challenge = await client.auth.mfa.challenge({ factorId: enrolled.data.id });
    if (challenge.error) fail("Synthetic TOTP challenge failed");
    const verified = await client.auth.mfa.verify({
      factorId: enrolled.data.id,
      challengeId: challenge.data.id,
      code: nativeTotp(enrolled.data.totp.secret),
    });
    if (verified.error) fail("Synthetic TOTP verification failed");
    return { factorId: enrolled.data.id, secret: enrolled.data.totp.secret };
  };
  try {
    const owner = await signIn("access-owner");
    const other = await signIn("access-other");
    const principals: Principal[] = [
      { label: "anon", client: createClient(url, anonKey, options) },
      { label: "other", client: other.client },
    ];
    for (const role of ["moderator", "governance_controller", "admin"] as StaffRole[]) {
      const person = await signIn(`access-${role}`);
      await sql(
        `INSERT INTO public.staff_roles(user_id,role,status) VALUES ('${person.id}','${role}','active');`
      );
      // A second session that never completes the second step.
      principals.push({ label: `${role}-no-2fa`, client: await person.login() });
      const { factorId, secret } = await withTotp(person.client);
      principals.push({ label: role, client: person.client, staff: role });
      if (role === "admin") {
        // A second session verified with the next code, then aged 13 hours.
        const stale = await person.login();
        const challenge = await stale.auth.mfa.challenge({ factorId });
        if (challenge.error) fail("Synthetic TOTP challenge failed");
        await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500));
        const verified = await stale.auth.mfa.verify({
          factorId,
          challengeId: challenge.data.id,
          code: nativeTotp(secret),
        });
        if (verified.error) fail("Synthetic TOTP re-verification failed");
        const session = (await stale.auth.getSession()).data.session ?? fail("No session");
        const sessionId = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64url").toString()
        ).session_id;
        await sql(
          `UPDATE auth.mfa_amr_claims SET created_at=now()-interval '13 hours', updated_at=now()-interval '13 hours' WHERE session_id='${sessionId}' AND authentication_method='totp';`
        );
        const refreshed = await stale.auth.refreshSession();
        if (refreshed.error) fail("Synthetic stale session refresh failed");
        principals.push({ label: "admin-totp-13h-old", client: stale });
      }
    }

    // Owner A's private rows, one per table, with synthetic values only.
    const A = owner.id;
    const one = async (statement: string) => (await sql(statement)).split("\n")[0].trim();
    const rows: Record<string, string> = {};
    const profile = await one(`SELECT user_id FROM public.account_profiles WHERE user_id='${A}';`);
    rows.account_profiles =
      profile ||
      (await one(
        `INSERT INTO public.account_profiles(user_id,display_name) VALUES ('${A}','Synthetic Owner') RETURNING user_id;`
      ));
    rows.kyc_artifacts = await one(
      `INSERT INTO public.kyc_artifacts(user_id,step_type,r2_key,content_type,file_size_bytes) VALUES ('${A}','id_doc','synthetic/${A}','image/jpeg',1) RETURNING id;`
    );
    rows.verification_sessions = await one(
      `INSERT INTO public.verification_sessions(user_id,id_artifact_id) VALUES ('${A}','${rows.kyc_artifacts}') RETURNING id;`
    );
    rows.verification_steps = await one(
      `INSERT INTO public.verification_steps(user_id,step_type,status,risk_score) VALUES ('${A}','id_doc','pending',20) RETURNING id;`
    );
    rows.kyc_provider_results = await one(
      `INSERT INTO public.kyc_provider_results(user_id,artifact_id,provider_name,provider_status,provider_ref) VALUES ('${A}','${rows.kyc_artifacts}','manual','pending','${randomUUID()}') RETURNING id;`
    );
    rows.kyc_risk_signals = await one(
      `INSERT INTO public.kyc_risk_signals(user_id,signal_code,severity) VALUES ('${A}','synthetic','info') RETURNING id;`
    );
    rows.payments = await one(
      `INSERT INTO public.payments(user_id,area,amount_cents,status,provider,provider_payment_id) VALUES ('${A}','MZANSI_MARKET',3000,'pending','ozow','synthetic-${randomUUID()}') RETURNING id;`
    );
    rows.invoices = await one(
      `INSERT INTO public.invoices(invoice_number,user_id,payment_id,amount_cents,vat_cents,total_cents,description) VALUES ('SYN-${randomUUID().slice(0, 8)}','${A}','${rows.payments}',2609,391,3000,'Synthetic invoice') RETURNING id;`
    );
    rows.entitlements = await one(
      `INSERT INTO public.entitlements(user_id,area,type) VALUES ('${A}','MZANSI_MARKET','trial') RETURNING id;`
    );
    rows.notifications = await one(
      `INSERT INTO public.notifications(user_id,title) VALUES ('${A}','Synthetic private notice') RETURNING id;`
    );
    rows.consent_records = await one(
      `INSERT INTO public.consent_records(user_id,consent_type,version,granted) VALUES ('${A}','marketing','v1',true) RETURNING id;`
    );
    rows.contact_change_history = await one(
      `INSERT INTO public.contact_change_history(user_id,change_type,source) VALUES ('${A}','phone','user') RETURNING id;`
    );
    rows.profile_change_history = await one(
      `INSERT INTO public.profile_change_history(user_id,change_type,source) VALUES ('${A}','location','user') RETURNING id;`
    );
    rows.media_uploads = await one(
      `INSERT INTO public.media_uploads(user_id,r2_key,url) VALUES ('${A}','synthetic/media/${A}','https://example.invalid/${A}') RETURNING id;`
    );
    rows.listing_drafts = await one(
      `INSERT INTO public.listing_drafts(user_id,flow) VALUES ('${A}','listing') RETURNING id;`
    );
    rows.otp_challenges = await one(
      `INSERT INTO public.otp_challenges(user_id,phone,otp_hash,expires_at) VALUES ('${A}','+27820000001','synthetic-hash',now()+interval '5 minutes') RETURNING id;`
    );
    rows.otp_logs = await one(
      `INSERT INTO public.otp_logs(phone,otp_hash,expires_at) VALUES ('+27820000001','synthetic-hash',now()+interval '5 minutes') RETURNING id;`
    );
    rows.dsar_cases = await one(
      `INSERT INTO public.dsar_cases(type,requester_email,requester_phone,description,due_by,subject_user_id) VALUES ('access','owner@example.invalid','+27820000001','Synthetic request',now()+interval '30 days','${A}') RETURNING id;`
    );
    rows.contact_submissions = await one(
      `INSERT INTO public.contact_submissions(name,email,message) VALUES ('Synthetic Person','person@example.invalid','Synthetic private message') RETURNING id;`
    );
    rows.buyer_verifications = await one(
      `INSERT INTO public.buyer_verifications(phone,expires_at) VALUES ('+27820000002',now()+interval '1 day') RETURNING id;`
    );
    rows.listings = await one(
      `INSERT INTO public.listings(category,title,description,photos,location_province,location_city,contact_methods,owner_id) VALUES ('electronics','Synthetic draft','Synthetic private draft listing',ARRAY['synthetic/photo.jpg'],'Gauteng','Johannesburg',ARRAY['form']::contact_method[],'${A}') RETURNING id;`
    );
    rows.listing_private = await one(
      `INSERT INTO public.listing_private(listing_id,location_address) VALUES ('${rows.listings}','1 Synthetic Street') ON CONFLICT (listing_id) DO UPDATE SET location_address=excluded.location_address RETURNING listing_id;`
    );
    rows.businesses = await one(
      `INSERT INTO public.businesses(business_type,business_name,location_province,location_city,owner_id,slug) VALUES ('home_business','Synthetic Draft Business','Gauteng','Johannesburg','${A}','synthetic-${randomUUID().slice(0, 8)}') RETURNING id;`
    );
    rows.business_private = await one(
      `INSERT INTO public.business_private(business_id,phone,email) VALUES ('${rows.businesses}','+27820000003','biz@example.invalid') ON CONFLICT (business_id) DO UPDATE SET phone=excluded.phone RETURNING business_id;`
    );
    rows.business_verifications = await one(
      `INSERT INTO public.business_verifications(business_id,owner_id,kind,registration_number) VALUES ('${rows.businesses}','${A}','cipc','2020/123456/07') RETURNING id;`
    );
    rows.business_verification_messages = await one(
      `INSERT INTO public.business_verification_messages(case_id,author_role,body) VALUES ('${rows.business_verifications}','owner','Synthetic private message') RETURNING id;`
    );
    rows.leads = await one(
      `INSERT INTO public.leads(target_id,target_type,message,owner_id,buyer_email,buyer_phone) VALUES ('${rows.listings}','listing','Synthetic private enquiry message','${A}','buyer@example.invalid','+27820000004') RETURNING id;`
    );
    rows.partners = await one(
      `INSERT INTO public.partners(user_id,code) VALUES ('${A}','SYN${randomUUID()
        .slice(0, 6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "7")}') RETURNING id;`
    );
    rows.audit_logs = await one(
      `INSERT INTO public.audit_logs(actor_id,actor_role,action,target_type,target_id) VALUES ('${A}','system','synthetic_action','user','${A}') RETURNING id;`
    );
    rows.kyc_evidence_access_logs = await one(
      `INSERT INTO public.kyc_evidence_access_logs(actor_role,user_id) VALUES ('moderator','${A}') RETURNING id;`
    );
    rows.account_acquisition = await one(
      `INSERT INTO public.account_acquisition(user_id,acquisition_source) VALUES ('${A}','DIRECT') ON CONFLICT (user_id) DO UPDATE SET acquisition_source=excluded.acquisition_source RETURNING user_id;`
    );
    KEY.account_acquisition = "user_id";
    for (const table of Object.keys(MATRIX))
      if (!/^[a-f0-9-]{36}$/.test(rows[table] ?? "")) fail(`Synthetic ${table} row missing`);

    const snapshot = async (table: string) => {
      const key = KEY[table] ?? "id";
      return sql(
        `SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE ${key}='${rows[table]}';`
      );
    };
    const reads = async (client: SupabaseClient, table: string) => {
      const key = KEY[table] ?? "id";
      const result = await client.from(table).select(key).eq(key, rows[table]);
      return result.error ? 0 : (result.data?.length ?? 0);
    };

    // The owner and each permitted staff role really see the row.
    for (const [table, rule] of Object.entries(MATRIX))
      if ((await reads(owner.client, table)) !== (rule.owner ? 1 : 0))
        fail(`Owner visibility differs for ${table}`);
    for (const principal of principals) {
      for (const [table, rule] of Object.entries(MATRIX)) {
        const allowed = principal.staff ? rule.staff.includes(principal.staff) : false;
        const seen = await reads(principal.client, table);
        if (seen !== (allowed ? 1 : 0))
          fail(`${principal.label} ${allowed ? "cannot" : "can"} read owner data in ${table}`);
      }
    }
    // Nobody but the owner (and no staff without a fresh code) can change it.
    for (const principal of principals.filter((p) => !p.staff)) {
      for (const table of Object.keys(MATRIX)) {
        const key = KEY[table] ?? "id";
        const before = await snapshot(table);
        const changed = await principal.client
          .from(table)
          .update({ [key]: rows[table] })
          .eq(key, rows[table])
          .select(key);
        const removed = await principal.client
          .from(table)
          .delete()
          .eq(key, rows[table])
          .select(key);
        if ((changed.data?.length ?? 0) || (removed.data?.length ?? 0))
          fail(`${principal.label} changed owner data in ${table}`);
        if ((await snapshot(table)) !== before) fail(`${table} changed after ${principal.label}`);
      }
      for (const [table, row] of [
        ["notifications", { user_id: A, title: "Injected" }],
        ["listing_drafts", { user_id: A, flow: "listing" }],
        ["free_posts_used", { user_id: A, area: "MZANSI_MARKET" }],
      ] as const) {
        const injected = await principal.client.from(table).insert(row).select();
        if (!injected.error) fail(`${principal.label} wrote a row for owner A in ${table}`);
      }
    }
    return { tables: Object.keys(MATRIX).length, principals: principals.length + 1 };
  } finally {
    for (const id of created) {
      await sql(`DELETE FROM public.staff_roles WHERE user_id='${id}';`).catch(() => undefined);
    }
  }
}
