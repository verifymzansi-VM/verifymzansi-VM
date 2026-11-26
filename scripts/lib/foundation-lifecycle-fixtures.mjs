// Shared fixtures for the lifecycle rule checks
// (scripts/test-foundation-small-lifecycle-rules.mjs, 20261125150215, and
// scripts/test-foundation-lifecycle-rule-follow-ups.mjs, 20261125225855):
// stickers written as their review flow writes them, the minute job and the
// email job for the sticker renewal reminder, free events through the
// production commands, public reports and the two owner delete commands.
// Everything is synthetic and written as the database owner unless a member
// or the service role acts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const DAY_MS = 86_400_000;

/** The lifecycle fixtures over the update check kit `{ q, json, member, service }`. */
export function lifecycleFixtures({ q, json, member, service }) {
  /** Runs `sql` as the database owner with triggers and foreign keys off. */
  const replica = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

  // ------------------------------------------------------------ stickers
  /** An approved sticker check of `kind` on `business`, ending `days` from now; its id. */
  const sticker = (owner, business, kind, days) => {
    const id = randomUUID();
    replica(`insert into private.evidence_cases(id,subject_id,kind,status) values('${id}','${owner.id}','business','decided');
      insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,seen_method,available_slots,
        screenshots_consent_at,decided_at,expires_at)
      values('${id}','${business}','${owner.id}','${kind}','approved',
        ${kind === "seen" ? "'video',array['Monday morning'],now()" : "null,null,null"},
        now()-interval '335 days',now()+make_interval(secs=>${days}*86400));`);
    return id;
  };
  /** Moves the sticker's end to `days` from now. */
  const endsIn = (id, days) =>
    replica(`update private.frontend_business_checks set expires_at=now()+make_interval(secs=>${days}*86400)
      where id='${id}';`);
  /** The minute job, as the website's scheduler runs it. */
  const sweep = () => json(service("select api.run_slot_renewals(100);"));
  /** The dedupe keys of the sticker's queued reminders, oldest first. */
  const reminders = (id) =>
    json(`select coalesce(jsonb_agg(dedupe_key order by created_at, id),'[]') from private.outbox_events
      where kind='sticker_renewal_reminder' and subject_id='${id}';`);
  /** One email job claim of sticker reminders. */
  const claim = () =>
    json(
      service(
        "select api.claim_supported_notification_outbox(array['sticker_renewal_reminder'],50);"
      )
    );
  /** One claim; the sticker's job from it. */
  const claimFor = (id) => {
    const jobs = claim();
    const job = jobs.find((j) => j.subject_id === id);
    assert.ok(job, JSON.stringify(jobs));
    return job;
  };
  /** Finishes a claimed job (sent, or with `error`, e.g. "skipped"). */
  const complete = (job, error = null) =>
    q(
      service(
        `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,${
          error ? `'${error}'` : "null"
        });`
      )
    );
  /** The reminder key the sticker's current end gives. */
  const keyOf = (id) =>
    `sticker_renewal_reminder:${id}:${q(
      `select floor(extract(epoch from expires_at))::bigint from private.frontend_business_checks where id='${id}';`
    )}`;
  const endOf = (id) =>
    json(`select to_jsonb(expires_at) from private.frontend_business_checks where id='${id}';`);

  // ------------------------------------------------------------ events
  /** An ISO time `days` from now, in whole seconds. */
  const at = (days) =>
    new Date(Math.floor((Date.now() + days * DAY_MS) / 1000) * 1000).toISOString();
  /** An event window starting `startDays` from now, `lengthDays` long. */
  const window = (startDays, lengthDays = 1) => ({
    starts_at: at(startDays),
    ends_at: at(startDays + lengthDays),
    timezone: "Africa/Johannesburg",
  });
  const activity = q(
    "select coalesce((select a.key from private.category_activities a join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required order by a.key limit 1),'')"
  );
  /** The SQL that creates a free event draft for `person` in window `w`. */
  const createEventSql = (person, w) =>
    member(
      person,
      `select api.create_core_draft('event','tourism_events','events','${JSON.stringify(w)}'::jsonb,${
        activity ? `'${activity}'` : "null"
      });`
    );
  const revision = (id) => q(`select revision from private.posts where id='${id}';`);
  /** The SQL that moves the event `id` to window `w`. */
  const moveSql = (person, id, w) =>
    member(
      person,
      `select api.save_business_event_context('${id}',${revision(id)},'${JSON.stringify({ event_window: w })}'::jsonb);`
    );
  const startOf = (id) =>
    Date.parse(
      json(`select to_jsonb(starts_at) from private.event_details where post_id='${id}';`)
    );

  // ------------------------------------------------------------ reports
  /** An open public report about `post`, as the report flow writes it; its id. */
  const report = (owner, post) =>
    q(`insert into private.reports(post_id,subject_account_id,category,severity,description,
        reporter_ip_hmac,frontend_reason)
      values('${post}','${owner.id}','scam','standard','A synthetic report description.',
        '${"B".repeat(42)}${(Math.random() * 10) | 0}','fake_listing') returning id;`);
  const exists = (id) => q(`select count(*) from private.posts where id='${id}';`) === "1";
  /** The SQL of the owner's delete command. */
  const deleteSql = (owner, id) =>
    member(owner, `select api.delete_post('${id}',${revision(id)});`);
  /** The SQL of the My posts action that deletes. */
  const actionDeleteSql = (owner, id) =>
    member(
      owner,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${revision(id)},'delete','listing','market');`
    );

  return {
    replica,
    sticker,
    endsIn,
    sweep,
    reminders,
    claim,
    claimFor,
    complete,
    keyOf,
    endOf,
    at,
    window,
    createEventSql,
    revision,
    moveSql,
    startOf,
    report,
    exists,
    deleteSql,
    actionDeleteSql,
  };
}
