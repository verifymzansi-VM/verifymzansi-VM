// Database limits from docs/testing/limits-register.json, checked on the
// replayed production schema (candidate.sql plus every update, in the same
// embedded Postgres as the replay gate; no Docker, no hosted database).
//
// 1. Register-driven (LIM-MECH-PG-CHECK, LIM-MECH-SQL-GUARD): every table
//    CHECK constraint in the register is present and validated with exactly
//    the registered definition, and simple length/number ranges are probed one
//    step inside and outside each bound; every database guard line in the
//    register is in the replayed function body.
// 2. Behaviour: the limits named below are exercised through the production
//    API commands (as a member with a synthetic session, as the service role
//    or as a visitor) one below, at and past their bound.
//
//   node --import tsx --test scripts/limits-sql.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { replayFoundation } from "./lib/foundation-replay.mjs";

const register = JSON.parse(readFileSync("docs/testing/limits-register.json", "utf8"));
const TABLES = "database/foundation/current/tables/";
const FUNCTIONS = "database/foundation/current/functions/";

let db;
before(async () => {
  ({ db } = await replayFoundation());
  await db.exec(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;`);
});
after(async () => {
  await db?.close();
});

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const one = async (sql, params) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const member = async (label) => one(`select vmtest.member($1)`, [label]);

/** Runs `sql` as `role`; for "authenticated", with `user`'s JWT claims. */
async function as(role, sql, user) {
  const claims = user
    ? {
        sub: user.id,
        role: "authenticated",
        session_id: user.session,
        aal: "aal1",
        is_anonymous: false,
      }
    : { role };
  await db.exec(`select set_config('request.jwt.claim.sub',${lit(user?.id ?? "")},false),
      set_config('request.jwt.claims',${lit(JSON.stringify(claims))},false);
    set role ${role};`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec(
      `reset role; select set_config('request.jwt.claims','',false), set_config('request.jwt.claim.sub','',false);`
    );
  }
}
const asMember = (user, sql) => as("authenticated", sql, user);
const asService = (sql) => as("service_role", sql);
const asVisitor = (sql) => as("anon", sql);

async function refused(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}
/** The owner writes `sql` with triggers and foreign-key checks off (fixtures). */
const seed = (sql) =>
  db.exec(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

// ---------------------------------------------------------------- register-driven

describe("LIM-MECH-PG-CHECK: registered table CHECK constraints", () => {
  const entries = register.limits.filter((entry) =>
    entry.enforcedAt.some((anchor) => anchor.file.startsWith(TABLES))
  );
  const SIMPLE = [
    // [nullable column] length(col) >= a AND length(col) <= b
    /^(?:(\w+) IS NULL OR )?(length|char_length)\((\w+)\) >= (\d+) AND \2\(\3\) <= (\d+)$/,
    // [nullable column] col >= a AND col <= b
    /^(?:(\w+) IS NULL OR )?()(\w+) >= (\d+) AND \3 <= (\d+)$/,
  ];

  test("every table limit is registered against a real constraint", () => {
    assert.ok(entries.length > 100, `only ${entries.length} table limits registered`);
  });

  test("each is present, validated and exactly as registered; simple ranges hold at their bounds", async () => {
    let probed = 0;
    for (const entry of entries) {
      for (const anchor of entry.enforcedAt.filter((a) => a.file.startsWith(TABLES))) {
        const [schema, table] = anchor.file
          .slice(TABLES.length)
          .replace(/\.sql$/, "")
          .split("/");
        const match = /^constraint (\S+) (CHECK \((.*)\))$/.exec(anchor.contains);
        assert.ok(match, `${entry.id}: anchor is not a CHECK constraint line`);
        const [, name, , expression] = match;
        const row = (
          await db.query(
            `select c.convalidated, pg_get_constraintdef(c.oid, true) as definition
             from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
             where n.nspname=$1 and t.relname=$2 and quote_ident(c.conname)=$3 and c.contype='c'`,
            [schema, table, name]
          )
        ).rows[0];
        assert.ok(row, `${entry.id}: ${schema}.${table} has no constraint ${name}`);
        assert.equal(row.convalidated, true, `${entry.id}: constraint is NOT VALID`);
        assert.equal(`constraint ${name} ${row.definition}`, anchor.contains, entry.id);

        const simple = SIMPLE.map((re) => re.exec(expression)).find(Boolean);
        if (!simple) continue;
        const [, nullable, lengthFn, column, low, high] = simple;
        if (nullable && nullable !== column) continue;
        const value = (n) => (lengthFn ? "a".repeat(n) : n);
        const holds = async (n) =>
          one(
            `select coalesce((${expression}), true) from jsonb_populate_record(null::${schema}.${table}, jsonb_build_object($1::text, $2::jsonb)) as t`,
            [column, JSON.stringify(value(n))]
          );
        assert.equal(await holds(Number(high)), true, `${entry.id}: ${high} should be allowed`);
        assert.equal(
          await holds(Number(high) + 1),
          false,
          `${entry.id}: ${Number(high) + 1} should be refused`
        );
        if (Number(low) > 0) {
          assert.equal(await holds(Number(low)), true, `${entry.id}: ${low} should be allowed`);
          assert.equal(
            await holds(Number(low) - 1),
            false,
            `${entry.id}: ${Number(low) - 1} should be refused`
          );
        }
        probed += 1;
      }
    }
    assert.ok(probed > 80, `only ${probed} table ranges were probed at their bounds`);
  });
});

describe("LIM-MECH-SQL-GUARD: registered database guard lines", () => {
  test("each guard line is in its replayed function's body", async () => {
    let checked = 0;
    for (const entry of register.limits) {
      for (const anchor of entry.enforcedAt.filter((a) => a.file.startsWith(FUNCTIONS))) {
        const [schema, name] = anchor.file
          .slice(FUNCTIONS.length)
          .replace(/\.sql$/, "")
          .split("/");
        const bodies = (
          await db.query(
            `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname=$1 and p.proname=$2`,
            [schema, name]
          )
        ).rows.map((row) => row.definition);
        assert.ok(
          bodies.length > 0,
          `${entry.id}: ${schema}.${name} is not in the replayed schema`
        );
        assert.ok(
          bodies.some((body) => body.includes(anchor.contains)),
          `${entry.id}: ${schema}.${name} does not contain ${JSON.stringify(anchor.contains)}`
        );
        checked += 1;
      }
    }
    assert.ok(checked > 250, `only ${checked} guard lines checked`);
  });
});

// ---------------------------------------------------------------- behaviour

describe("text and value rules", () => {
  test("LIM-MECH-PRIVACY-TEXT: privacy_text trims and enforces the caller's minimum and maximum", async () => {
    const text = (value, min, max) =>
      db.query(`select internal.privacy_text($1,$2,$3) as v`, [value, min, max]);
    assert.equal((await text("  ab  ", 2, 4)).rows[0].v, "ab");
    assert.equal((await text("abcd", 2, 4)).rows[0].v, "abcd");
    await refused(text("a", 2, 4), "22023", /check the request text/);
    await refused(text("abcde", 2, 4), "22023", /check the request text/);
    await refused(text("   ", 1, 4), "22023");
    await refused(text("ab\u0007c", 1, 10), "22023");
  });

  test("LIM-SQL-person-name-length and LIM-SQL-profile-bio-length", async () => {
    const name = (value) => one(`select internal.person_name_valid($1)`, [value]);
    assert.equal(await name("Al"), true);
    assert.equal(await name("A"), false);
    assert.equal(await name("a".repeat(50)), true);
    assert.equal(await name("a".repeat(51)), false);
    const bio = (value) => one(`select internal.profile_bio_valid($1)`, [value]);
    assert.equal(await bio("x"), true);
    assert.equal(await bio("x".repeat(300)), true);
    assert.equal(await bio("x".repeat(301)), false);
  });

  test("LIM-SQL-enquiry-email-length and LIM-SQL-signup-email-length", async () => {
    // An address of exactly n characters: a short local part and a long
    // domain of 50-character labels, so only the length rule can refuse it.
    const address = (n) => {
      let domain = "";
      while (domain.length < n - 2 - ".com".length)
        domain += `${domain ? "." : ""}${"d".repeat(Math.min(50, n - 2 - ".com".length - domain.length - (domain ? 1 : 0)))}`;
      const value = `a@${domain}.com`;
      assert.equal(value.length, n);
      return value;
    };
    const enquiry = (value) => one(`select internal.enquiry_email_valid($1)`, [value]);
    assert.equal(await enquiry(address(254)), true);
    assert.equal(await enquiry(address(255)), false);
    const signup = (value) => db.query(`select internal.check_email_domain($1)`, [value]);
    await signup(address(320));
    await refused(signup(address(321)), "22023", /email_invalid/);
  });

  test("LIM-SQL-refund-second-approval: refunds over R1,000 in total need a second approval", async () => {
    const needs = (before, amount) =>
      one(`select internal.refund_needs_approval('refunded',$1,$2)`, [before, amount]);
    assert.equal(await needs(0, 100000), false);
    assert.equal(await needs(0, 100001), true);
    assert.equal(await needs(60000, 40000), false);
    assert.equal(await needs(60000, 40001), true);
  });

  test("LIM-SQL-listing-price-range and LIM-SQL-listing-terms-size", async () => {
    const terms = (value) =>
      db.query(`select internal.validated_listing_terms('electronics',$1::jsonb)`, [
        JSON.stringify(value),
      ]);
    const amount = (cents) => ({ price: { mode: "amount", amount_cents: cents } });
    await terms(amount(1));
    await terms(amount(9999999900));
    await refused(terms(amount(0)), "22023", /invalid amount/);
    await refused(terms(amount(9999999901)), "22023", /invalid amount/);
    // Only "price" and "negotiable" keys are allowed, so the size rule is the
    // one that refuses an over-size value of otherwise allowed shape first.
    const sizeOf = async (value) =>
      Number(await one(`select octet_length($1::jsonb::text)`, [JSON.stringify(value)]));
    const padded = { price: { mode: "amount", amount_cents: 100, pad: "y".repeat(600) } };
    assert.ok((await sizeOf(padded)) > 512);
    await refused(terms(padded), "22023", /invalid price terms/);
    const small = { price: { mode: "amount", amount_cents: 100, pad: "y" } };
    await refused(terms(small), "22023", /invalid amount fields/);
  });
});

describe("public search", () => {
  const search = (request) =>
    asVisitor(`select api.search_posts(${lit(JSON.stringify(request))}::jsonb)`);

  test("LIM-SQL-search-request-size: requests over 4 KB are refused", async () => {
    const sized = async (bytes) => {
      const base = { area: "market", q: "" };
      const empty = Number(
        await one(`select octet_length($1::jsonb::text)`, [JSON.stringify(base)])
      );
      return { area: "market", q: "a".repeat(bytes - empty) };
    };
    const atLimit = await sized(4096);
    assert.equal(
      Number(await one(`select octet_length($1::jsonb::text)`, [JSON.stringify(atLimit)])),
      4096
    );
    // At 4096 bytes the size rule passes (the 200-character query rule then refuses it).
    await refused(search(atLimit), "22023", /query too long/);
    await refused(search(await sized(4097)), "22023");
    await assert.rejects(
      search(await sized(4097)),
      (error) => !/query too long/.test(error.message)
    );
  });

  test("LIM-SQL-search-page-size: 1 to 48 results per page", async () => {
    await search({ area: "market", limit: 48 });
    await search({ area: "market", limit: 1 });
    await refused(search({ area: "market", limit: 49 }), "22023");
    await refused(search({ area: "market", limit: 0 }), "22023");
  });

  test("LIM-SQL-search-offset: nothing beyond position 4,800", async () => {
    await search({ area: "market", limit: 48, offset: 4800 });
    await refused(
      search({ area: "market", limit: 48, offset: 4801 }),
      "22023",
      /invalid page offset/
    );
  });

  test("LIM-SQL-search-query-length and LIM-SQL-search-terms", async () => {
    await search({ area: "market", q: "a".repeat(40) });
    await refused(search({ area: "market", q: "a".repeat(201) }), "22023", /query too long/);
    await search({ area: "market", q: Array.from({ length: 8 }, (_, i) => `term${i}`).join(" ") });
    await refused(
      search({ area: "market", q: Array.from({ length: 9 }, (_, i) => `term${i}`).join(" ") }),
      "22023"
    );
    await refused(search({ area: "market", q: "a".repeat(41) }), "22023");
  });
});

describe("member and service limits", () => {
  test("LIM-SQL-privacy-requests-hour: at most 5 privacy requests an hour per account", async () => {
    const user = await member("limits-privacy");
    const request = (n) =>
      asService(
        `select api.record_frontend_privacy_request(${lit(user.id)},${lit(user.session)},'access','Fixture Person',null,${lit(`Request number ${n}`)})`
      );
    for (let n = 1; n <= 5; n += 1) await request(n);
    await refused(request(6), "PT429", /privacy request limit reached/);
  });

  test("LIM-SQL-communication-choice-grants-day: at most 20 consents given a day", async () => {
    const user = await member("limits-choices");
    // The current choice is the latest event by time; the embedded database's
    // clock can tick only once a millisecond, so saves are spaced apart.
    const save = async (on) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return asMember(
        user,
        `select api.save_my_communication_choices('communication-2026-11',p_marketing_email=>${on})`
      );
    };
    for (let n = 1; n <= 20; n += 1) {
      await save(true);
      await save(false);
    }
    await refused(save(true), "PT429", /too many changes today/);
    await save(false); // turning a choice off never counts
  });

  test("LIM-SQL-media-upload-size and LIM-SQL-media-unfinished-uploads", async () => {
    const user = await member("limits-media");
    const begin = (kind, bytes) =>
      asMember(user, `select api.begin_media_upload(${lit(kind)},${bytes})`);
    await refused(begin("image", 5242881), "22023", /images up to 5 MB, videos up to 50 MB/);
    await refused(begin("video", 52428801), "22023", /images up to 5 MB, videos up to 50 MB/);
    await begin("image", 5242880);
    for (let n = 2; n <= 20; n += 1) await begin("image", 1000);
    await refused(begin("image", 1000), "PT429", /too many unfinished uploads/);
  });

  test("LIM-SQL-evidence-unfinished-uploads: at most 5 unfinished uploads per case", async () => {
    const user = await member("limits-evidence");
    const caseId = randomUUID();
    await db.query(
      `insert into private.evidence_cases(id,subject_id,kind) values($1,$2,'business')`,
      [caseId, user.id]
    );
    const begin = () =>
      asMember(user, `select api.begin_evidence_upload(${lit(caseId)},'registration')`);
    for (let n = 1; n <= 5; n += 1) await begin();
    await refused(begin(), "PT429", /too many unfinished uploads/);
  });

  test("LIM-SQL-phone-code-attempts: at most 5 attempts per code", async () => {
    const user = await member("limits-phone");
    const challenge = (
      await asService(
        `select api.create_verification_phone_challenge(${lit(user.id)},'+27721009999',${lit("h".repeat(64))}) as c`
      )
    )[0].c;
    const id = challenge.challenge_id;
    assert.ok(id, JSON.stringify(challenge));
    const attempt = () =>
      asService(`select api.claim_verification_phone_attempt(${lit(user.id)},${lit(id)})`);
    for (let n = 1; n <= 5; n += 1) await attempt();
    await refused(attempt(), "PT409", /challenge unavailable/);
  });

  test("LIM-SQL-form-draft-size: saved form drafts at most 64 KB", async () => {
    const user = await member("limits-draft");
    const save = (data) =>
      asMember(
        user,
        `select api.frontend_form_draft('listing','save',1,${lit(JSON.stringify(data))}::jsonb)`
      );
    const sizeOf = async (data) =>
      Number(await one(`select octet_length($1::jsonb::text)`, [JSON.stringify(data)]));
    const sized = async (bytes) => {
      const empty = await sizeOf({ text: "" });
      return { text: "a".repeat(bytes - empty) };
    };
    const atLimit = await sized(65536);
    assert.equal(await sizeOf(atLimit), 65536);
    await save(atLimit);
    await refused(save(await sized(65537)), "22023");
  });

  test("LIM-SQL-inbox-page-size: owner inbox pages of 1 to 50", async () => {
    const user = await member("limits-inbox");
    const page = (limit) =>
      asMember(user, `select api.list_my_frontend_notifications(${limit},false,null)`);
    await page(50);
    await refused(page(51), "22023");
    await refused(page(0), "22023");
  });

  test("LIM-SQL-engagement-read-batch and LIM-SQL-views-per-request", async () => {
    const ids = (n) =>
      `array[${Array.from({ length: n }, () => lit(randomUUID())).join(",")}]::uuid[]`;
    await asVisitor(`select api.get_post_engagement(${ids(50)})`);
    await refused(asVisitor(`select api.get_post_engagement(${ids(51)})`), "22023");
    await asService(`select api.record_post_views(${ids(5)},${lit(randomUUID())})`);
    await refused(
      asService(`select api.record_post_views(${ids(6)},${lit(randomUUID())})`),
      "22023"
    );
  });
});

describe("post media allowance", () => {
  test("LIM-SQL-event-media-allowance: a free event takes at most 10 photos and 1 video", async () => {
    const user = await member("limits-event-media");
    const post = randomUUID();
    const category = await one(
      `select c.category_key from private.post_category_contracts c where c.kind='event' order by c.category_key limit 1`
    );
    await seed(`
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(${lit(post)},${lit(user.id)},'event',
          (select c.area from private.post_category_contracts c where c.category_key=${lit(category)} and c.kind='event'),
          ${lit(category)},(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
            where a.category_key=${lit(category)} and c.activity_required order by a.key limit 1),
          'Fixture event','A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(${lit(post)},now()+interval '1 day',now()+interval '2 days','Africa/Johannesburg');`);
    const media = async (kind, mime) =>
      one(
        `insert into private.media_objects(owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
         values($1,$2,'media/'||gen_random_uuid(),1024,1024,encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),$3,800,600,'ready')
         returning id`,
        [user.id, kind, mime]
      );
    const photos = [];
    for (let n = 0; n < 11; n += 1) photos.push(await media("image", "image/jpeg"));
    const videos = [await media("video", "video/mp4"), await media("video", "video/mp4")];
    const items = (photoCount, videoCount) => [
      ...photos.slice(0, photoCount).map((id, i) => ({
        object_id: id,
        purpose: i === 0 ? "cover" : "gallery",
        position: i,
      })),
      ...videos.slice(0, videoCount).map((id, i) => ({
        object_id: id,
        purpose: "video",
        position: photoCount + i,
      })),
    ];
    let revision = 1;
    const set = async (photoCount, videoCount) => {
      const rows = await asMember(
        user,
        `select api.set_post_media(${lit(post)},${revision},${lit(JSON.stringify(items(photoCount, videoCount)))}::jsonb) as r`
      );
      revision = rows[0].r.revision;
    };
    await set(10, 1);
    await refused(set(11, 1), "22023", /exceed the current post allowance/);
    await refused(set(10, 2), "22023", /exceed the current post allowance/);
  });
});

describe("enquiry flood limits", () => {
  /** A live event that accepts enquiries, written directly as fixtures. */
  async function liveEvent(owner) {
    const id = randomUUID();
    const category = await one(
      `select c.category_key from private.post_category_contracts c where c.kind='event' order by c.category_key limit 1`
    );
    const area = await one(
      `select c.area from private.post_category_contracts c where c.category_key=$1 and c.kind='event'`,
      [category]
    );
    await seed(`
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,status,published_at,visible_until)
        values(${lit(id)},${lit(owner.id)},'event',${lit(area)},${lit(category)},
          (select a.key from private.category_activities a join private.categories c on c.key=a.category_key
            where a.category_key=${lit(category)} and c.activity_required order by a.key limit 1),
          'Fixture event','A synthetic description long enough for every rule.','gp','gp_johannesburg',
          'live',now()-interval '1 hour',now()+interval '7 days');
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(${lit(id)},now()+interval '1 day',now()+interval '2 days','Africa/Johannesburg');
      insert into private.post_contacts(post_id,post_kind,channels) values(${lit(id)},'event',array['form']);
      insert into private.post_search_documents(post_id,kind,area,category_key,province_id,locality_label,title,published_at,is_visible,document)
        values(${lit(id)},'event',${lit(area)},${lit(category)},'gp','Johannesburg','Fixture event',now()-interval '1 hour',true,to_tsvector('simple','fixture'));`);
    return id;
  }
  /** `count` earlier enquiries on `post` from `email(n)`, received just now. */
  const earlier = (post, owner, count, email) =>
    seed(
      Array.from(
        { length: count },
        (
          _,
          n
        ) => `insert into private.enquiries(id,request_id,post_id,owner_id,buyer_name,buyer_email,email_confirmed,message,status,created_at,updated_at,retain_until)
          values(gen_random_uuid(),gen_random_uuid(),${lit(post)},${lit(owner.id)},'Fixture Buyer',${lit(email(n))},false,
            'Is this still available please?','new',now(),now(),now()+interval '1 year');`
      ).join("\n")
    );
  const submit = (post, email) =>
    asService(
      `select api.submit_enquiry(${lit(randomUUID())},${lit(post)},${lit(email)},'Is this still available please?',null,'Fixture Buyer')`
    );

  test("LIM-SQL-enquiry-per-post-day: at most 100 enquiries a day to one post", async () => {
    const owner = await member("limits-enquiry-post");
    const post = await liveEvent(owner);
    await earlier(post, owner, 99, (n) => `buyer${n}@example.com`);
    await submit(post, "buyer-100@example.com");
    await refused(submit(post, "buyer-101@example.com"), "PT429", /too many enquiries/);
  });

  test("LIM-SQL-enquiry-per-sender-hour: at most 10 an hour from one address, across posts", async () => {
    const owner = await member("limits-enquiry-sender");
    const first = await liveEvent(owner);
    const second = await liveEvent(owner);
    await earlier(second, owner, 9, () => "busy@example.com");
    await submit(first, "busy@example.com");
    await refused(submit(first, "busy@example.com"), "PT429", /too many enquiries/);
    await submit(first, "calm@example.com");
  });
});
