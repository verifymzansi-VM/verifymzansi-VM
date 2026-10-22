import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import {
  FoundationInboxError,
  buildFoundationEnquiry,
  markFoundationNotificationsRead,
  readFoundationEnquiries,
  readFoundationInboxCounts,
  readFoundationNotifications,
  setFoundationEnquiryStatus,
} from "../../src/lib/foundation/owner-inbox.ts";
import {
  attachFixtureCover,
  createPostingVerifier,
  createTrustedPostingFixture,
  publishFixturePost,
} from "./foundation-trusted-posting-fixture.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

// Synthetic local proof of enquiries, notifications and owner signals. Hosted
// Realtime delivery is exercised separately against the target project.
export async function testOwnerInbox({
  createUser,
  rpc,
  sql,
  sqlFails,
  componentSql,
  record,
  connection,
  fixtureAdminId,
  stage,
}) {
  stage("owner inbox live posts");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const owner = await createUser("inbox-owner");
  const buyer = await createUser("inbox-buyer");
  const stranger = await createUser("inbox-stranger");
  await fixture.ready(owner);
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const call = async (name, body, user = owner, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "inbox fixture " + name);
    return response.data;
  };
  let serial = 0;
  const liveEvent = async (channels) => {
    let post = await call("create_core_draft", {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: reference.activities.find((a) => a.category === "events").key,
      p_detail: {
        contact_channels: channels,
        starts_at: new Date(Date.now() - 60000).toISOString(),
        ends_at: new Date(Date.now() + 7200000).toISOString(),
        timezone: "Africa/Johannesburg",
      },
    });
    post = await call("save_post_content", {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_content: {
        title: "Synthetic inbox event " + ++serial,
        description: "Synthetic local owner inbox verification event.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    });
    post = await attachFixtureCover(call, post, owner);
    return publishFixturePost({ call, sql, post, reviewer });
  };
  const formEvent = await liveEvent(["form"]);
  const callEvent = await liveEvent(["call"]);

  stage("owner inbox trusted submission");
  const email = (user) => sql("select email from auth.users where id='" + user.id + "';");
  const submit = (input, sender = null) =>
    rpc(
      "submit_enquiry",
      buildFoundationEnquiry({ request_id: randomUUID(), ...input }, sender),
      null,
      true
    );
  const rows = () =>
    sql(
      "select (select count(*) from private.enquiries)||':'||(select count(*) from private.notifications)||':'||" +
        "(select count(*) from private.outbox_events where kind='enquiry_received');"
    );
  const enquiry = {
    post_id: formEvent.id,
    buyer_name: "Synthetic Buyer",
    buyer_email: email(buyer),
    message: "Synthetic enquiry: is this event still on?\nThanks.",
  };
  for (const [token, service] of [
    [null, false],
    [buyer.token, false],
  ])
    assert.ok(
      [401, 403, 404].includes(
        (
          await rpc(
            "submit_enquiry",
            buildFoundationEnquiry({ request_id: randomUUID(), ...enquiry }, null),
            token,
            service
          )
        ).status
      )
    );
  const before = rows();
  const refused = async (input, sender, status, detail) => {
    const result = await submit(input, sender);
    assert.equal(result.status, status);
    assert.equal(result.data.details, detail);
    assert.equal(rows(), before, "A refused enquiry writes nothing");
  };
  await refused({ ...enquiry, post_id: callEvent.id }, buyer.id, 403, "enquiries_disabled");
  await refused(enquiry, owner.id, 400, "own_post");
  await refused({ ...enquiry, post_id: randomUUID() }, null, 404, "post_unavailable");
  sql("update auth.users set email_confirmed_at=null where id='" + stranger.id + "';");
  try {
    await refused(enquiry, stranger.id, 403, "sender_inactive");
  } finally {
    sql(
      "update auth.users set email_confirmed_at=clock_timestamp() where id='" + stranger.id + "';"
    );
  }
  const raw = buildFoundationEnquiry({ request_id: randomUUID(), ...enquiry }, buyer.id);
  for (const patch of [
    { p_message: "short" },
    { p_message: "Synthetic message with a hidden \u202e override" },
    { p_buyer_email: "Buyer@Example.com" },
    { p_buyer_phone: "0821234567" },
    { p_buyer_name: "Two\nLines" },
  ]) {
    const result = await rpc(
      "submit_enquiry",
      { ...raw, ...patch, p_request_id: randomUUID() },
      null,
      true
    );
    assert.equal(result.status, 400);
    assert.equal(result.data.details, "enquiry_invalid");
  }
  assert.throws(() =>
    buildFoundationEnquiry({ request_id: randomUUID(), ...enquiry, sender: owner.id }, null)
  );
  assert.equal(rows(), before);
  record("native-inbox-service-only-submission-and-refusals-roll-back");

  // Hosted Realtime is absent locally: a recording stand-in proves the exact,
  // content-free private signal, then is removed.
  // The fixture's realtime schema is empty and component-owned: add only the
  // recorder and remove exactly it afterwards.
  assert.equal(
    sql("select to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null;"),
    "t"
  );
  componentSql(
    "create table realtime.inbox_signal_calls(payload jsonb,event text,topic text,private boolean);" +
      "create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void " +
      "language sql security definer set search_path=pg_catalog " +
      "as 'insert into realtime.inbox_signal_calls values(payload,event,topic,private)';"
  );
  let signed, confirmedId, anonymousId;
  try {
    const signedRequest = randomUUID();
    signed = await rpc(
      "submit_enquiry",
      buildFoundationEnquiry({ request_id: signedRequest, ...enquiry }, buyer.id),
      null,
      true
    );
    assert.equal(signed.status, 200);
    assert.equal(signed.data.reused, false);
    confirmedId = signed.data.id;
    assert.deepEqual(
      JSON.parse(componentSql("select json_agg(to_json(c)) from realtime.inbox_signal_calls c;")),
      [
        {
          payload: { kind: "inbox" },
          event: "inbox_changed",
          topic: "owner:" + owner.id,
          private: true,
        },
      ]
    );
    const replay = await rpc(
      "submit_enquiry",
      buildFoundationEnquiry({ request_id: signedRequest, ...enquiry }, buyer.id),
      null,
      true
    );
    assert.deepEqual(replay.data, { id: confirmedId, reused: true });
    const conflict = await rpc(
      "submit_enquiry",
      buildFoundationEnquiry(
        { request_id: signedRequest, ...enquiry, message: "A different synthetic message." },
        buyer.id
      ),
      null,
      true
    );
    assert.equal(conflict.status, 409);
    assert.equal(
      componentSql("select count(*) from realtime.inbox_signal_calls;"),
      "1",
      "Replays do not signal again"
    );
  } finally {
    componentSql(
      "drop function realtime.send(jsonb,text,text,boolean); drop table realtime.inbox_signal_calls;"
    );
  }
  const anonymous = await submit({
    ...enquiry,
    buyer_name: undefined,
    buyer_email: "visitor@example.org",
    buyer_phone: "082 123 4567",
  });
  assert.equal(anonymous.status, 200);
  anonymousId = anonymous.data.id;
  const mismatched = await submit(
    { ...enquiry, buyer_email: "someone-else@example.org" },
    buyer.id
  );
  assert.equal(mismatched.status, 200);
  assert.equal(
    sql(
      "select string_agg(email_confirmed::text||':'||coalesce(buyer_phone,'-'),',' order by created_at) from private.enquiries where owner_id='" +
        owner.id +
        "';"
    ),
    "true:-,false:+27821234567,false:-"
  );
  assert.equal(
    sql(
      "select count(*) from private.outbox_events where kind='enquiry_received' and owner_id='" +
        owner.id +
        "';"
    ),
    "3"
  );
  record("native-inbox-idempotent-submission-confirmed-email-derived-and-private-signal");

  stage("owner inbox flood limits");
  for (let n = 0; n < 2; n++)
    assert.equal((await submit({ ...enquiry, buyer_email: "flood@example.org" })).status, 200);
  const flood = await submit({ ...enquiry, buyer_email: "flood@example.org" });
  assert.ok(flood.status === 200);
  const limited = await submit({ ...enquiry, buyer_email: "flood@example.org" });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.details, "enquiry_limit");
  record("native-inbox-per-post-sender-flood-limit");

  stage("owner inbox owner reads and status");
  const mine = await readFoundationEnquiries(typed(owner), { limit: 2 });
  assert.equal(mine.items.length, 2);
  assert.equal(mine.unread_count, 6);
  assert.ok(mine.next_cursor);
  const rest = await readFoundationEnquiries(typed(owner), { limit: 50, cursor: mine.next_cursor });
  assert.equal(rest.items.length, 4);
  assert.equal(rest.next_cursor, null);
  assert.equal(new Set([...mine.items, ...rest.items].map((x) => x.id)).size, 6);
  assert.equal(
    [...mine.items, ...rest.items].find((x) => x.id === confirmedId).post_title,
    "Synthetic inbox event 1"
  );
  for (const other of [buyer, stranger]) {
    const theirs = await readFoundationEnquiries(typed(other));
    assert.deepEqual(theirs.items, []);
    assert.equal(theirs.unread_count, 0);
    assert.equal(
      await setFoundationEnquiryStatus(typed(other), { id: confirmedId, status: "closed" }),
      null
    );
  }
  assert.equal(sql("select status from private.enquiries where id='" + confirmedId + "';"), "new");
  assert.ok([401, 403].includes((await rpc("list_my_enquiries", {}, null)).status));
  assert.ok([401, 403].includes((await rpc("list_my_enquiries", {}, null, true)).status));
  await assert.rejects(
    setFoundationEnquiryStatus(typed(owner), { id: confirmedId, status: "new" }),
    FoundationInboxError
  );
  const read = await setFoundationEnquiryStatus(typed(owner), { id: confirmedId, status: "read" });
  assert.equal(read.status, "read");
  assert.deepEqual(await readFoundationInboxCounts(typed(owner)), {
    unread_enquiries: 5,
    unread_notifications: 5,
  });
  sqlFails(
    "update private.enquiries set message='Changed synthetic text' where id='" + confirmedId + "';",
    "23514"
  );
  sqlFails(
    "update private.enquiries set owner_id='" + buyer.id + "' where id='" + confirmedId + "';",
    "23514"
  );
  record("native-inbox-owner-only-reads-status-pagination-and-immutable-content");

  stage("owner inbox notifications");
  const notes = await readFoundationNotifications(typed(owner), { limit: 50 });
  assert.equal(notes.items.length, 6);
  assert.equal(notes.unread_count, 5);
  assert.ok(notes.items.every((x) => x.kind === "enquiry_received" && x.post_id === formEvent.id));
  assert.deepEqual((await readFoundationNotifications(typed(buyer))).items, []);
  const one = notes.items.find((x) => x.read_at === null).id;
  assert.deepEqual(await markFoundationNotificationsRead(typed(buyer), { ids: [one] }), {
    marked: 0,
    unread_count: 0,
  });
  assert.deepEqual(await markFoundationNotificationsRead(typed(owner), { ids: [one] }), {
    marked: 1,
    unread_count: 4,
  });
  assert.deepEqual(await markFoundationNotificationsRead(typed(owner), {}), {
    marked: 4,
    unread_count: 0,
  });
  sqlFails("update private.notifications set read_at=null where id='" + one + "';", "23514");
  record("native-inbox-notifications-owner-only-and-first-read-immutable");

  stage("owner inbox realtime join authority");
  const claims = (user) => JSON.parse(Buffer.from(user.token.split(".")[1], "base64url"));
  const canJoin = (user, topic, sessionId = claims(user).session_id) =>
    sql(
      "begin; set local role authenticated; select set_config('request.jwt.claims','" +
        JSON.stringify({ ...claims(user), session_id: sessionId }) +
        "',true); select internal.can_receive_owner_topic('" +
        topic +
        "'); rollback;"
    )
      .split("\n")
      .filter((line) => line === "t" || line === "f")
      .pop();
  assert.equal(canJoin(owner, "owner:" + owner.id), "t");
  assert.equal(canJoin(buyer, "owner:" + owner.id), "f");
  assert.equal(canJoin(owner, "owner:" + buyer.id), "f");
  assert.equal(canJoin(owner, "owner:" + owner.id, randomUUID()), "f");
  for (const role of ["anon", "service_role"])
    assert.equal(
      sql(
        "select has_function_privilege('" +
          role +
          "','internal.can_receive_owner_topic(text)','execute');"
      ),
      "f"
    );
  record("native-inbox-private-topic-join-requires-own-live-session");

  stage("owner inbox retention and account deletion");
  sql(
    "begin; alter table private.enquiries disable trigger enquiry_guard;" +
      "update private.enquiries set created_at=created_at-interval '13 months',retain_until=retain_until-interval '13 months' where id='" +
      anonymousId +
      "';alter table private.enquiries enable trigger enquiry_guard;" +
      "alter table private.notifications disable trigger notification_guard;" +
      "update private.notifications set created_at=created_at-interval '91 days',read_at=read_at-interval '91 days' where subject_id='" +
      anonymousId +
      "';alter table private.notifications enable trigger notification_guard; commit;"
  );
  assert.ok(
    [401, 403].includes((await rpc("purge_expired_inbox", { p_limit: 100 }, owner.token)).status)
  );
  const purged = await call("purge_expired_inbox", { p_limit: 100 }, null, true);
  assert.deepEqual(purged, { enquiries: 1, notifications: 1 });
  assert.equal(sql("select count(*) from private.enquiries where id='" + anonymousId + "';"), "0");
  // A sender's account deletion keeps the owner's copy without the link.
  const ghost = randomUUID();
  sql(
    "insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('" +
      ghost +
      "','inbox-ghost-" +
      ghost +
      "@example.invalid',clock_timestamp(),false);"
  );
  let ghostEnquiry;
  try {
    const sent = await submit(
      { ...enquiry, buyer_email: "inbox-ghost-" + ghost + "@example.invalid" },
      ghost
    );
    assert.equal(sent.status, 200);
    ghostEnquiry = sent.data.id;
    assert.equal(
      sql("select email_confirmed from private.enquiries where id='" + ghostEnquiry + "';"),
      "t"
    );
  } finally {
    sql("delete from auth.users where id='" + ghost + "';");
  }
  assert.equal(
    sql(
      "select count(*)||':'||count(sender_account_id) from private.enquiries where id='" +
        ghostEnquiry +
        "';"
    ),
    "1:0"
  );
  record("native-inbox-retention-purge-service-only-and-sender-deletion-keeps-owner-copy");
}
