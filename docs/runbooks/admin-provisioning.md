# Staff access: provisioning and recovery

Staff access is granted only by rows in `public.staff_roles`. The `role` in a
user's auth metadata is a display hint and grants nothing. Every page, API
route, database policy and SQL function checks `staff_roles` on each request.
That same check also refuses staff whose account is banned or suspended.

## Everyday role changes: Admin → Role Management

| Change                     | Proposed by               | Approved by                      |
| -------------------------- | ------------------------- | -------------------------------- |
| Member → moderator         | an admin                  | an independent governor or admin |
| Anyone → governor or admin | an admin                  | a second, independent admin      |
| Demotion or removal        | an admin                  | none: takes effect immediately   |
| Remove a moderator         | a governor may propose it | an admin                         |

The approver cannot be the proposer or the person being changed. Proposals
expire after 7 days. A proposal is cancelled when it is approved in any of these
cases:

- the person's role changed after it was made;
- the proposer lost their authority;
- the proposal was edited after it was opened.

Every role action needs a code from the approver's authenticator app entered in
the last 15 minutes.

The last active admin can never be removed. Add a second admin first.

## First admins and recovery: `pnpm bootstrap:operator`

Use the script only when the app cannot be used to make the change:

- **First launch.** The first admin cannot approve their own promotion. Create
  the first admin with the script, then create a second admin with it too. After
  that, use Role Management.
- **Recovery.** Use it when only one admin is left and they need a second admin,
  or when every admin is locked out.

```bash
pnpm bootstrap:operator -- \
  --email=second.admin@verifymzansi.com \
  --password='temporary-strong-password' \
  --display-name='Second Admin' \
  --role=admin \
  --reason='Second admin so role changes have an independent approver' \
  --confirm-project=<project-ref>
```

- The script uses the service role key, so only the platform owner runs it, from
  a trusted machine.
- It refuses to run unless `--confirm-project` matches the configured project.
- Each run writes a role-history row and an audit entry with action
  `role_provisioned_by_owner`. Review these entries in the audit log after every
  use; nobody should run the script routinely.
- Ask the new staff member to change the temporary password straight away.

## Two-step verification

- Staff must add an authenticator app at `/staff/two-step`. They have 7 days to
  do this after their role is granted. A banner on every admin page shows the
  deadline.
- After the deadline, admin pages and APIs redirect to the two-step page until
  the staff member has added the app and entered a code.
- Role changes, high-risk KYC overrides and DSAR exports need a code entered in
  the last 15 minutes, even during the 7 days.
- Enforcement is controlled by the `staff_mfa_enforced` feature flag, which is
  on by default. Turn it off only to handle an incident, and turn it back on
  afterwards.

### Lost authenticator

1. Confirm the person's identity outside the platform, for example by a call to
   a known number.
2. An admin removes the lost factor: Supabase dashboard → Authentication → Users
   → the user → MFA factors → delete. With the service key, use
   `auth.admin.mfa.deleteFactor`.
3. The staff member signs in again and enrols a new app at `/staff/two-step`.
4. Record the reset in the support log with the reason.

## Removing access

When someone leaves, an admin sets their role to **Member** in Role Management.
Access ends on their next request, even with an old token. Their auth metadata
is then synced. If that sync fails, an alert is sent to Sentry; the sync is only
a display hint, because `staff_roles` already denies access.

## Alerts

Critical incidents are sent to Sentry as `fatal` events tagged
`severity: critical`. An example is a committed role change whose metadata sync
failed. Route those events to the on-call channel in Sentry's alert rules.

## Enforcement decisions and appeals

Every warning, suspension, ban, hide, lift and appeal outcome commits in one
database transaction, together with its recorded effects, decision events and
audit row. A failure leaves nothing half-applied.

| Action                            | Who                         | Second person needed?                 |
| --------------------------------- | --------------------------- | ------------------------------------- |
| Dismiss a report, warn an account | any staff                   | no                                    |
| Hide the reported item            | governor or admin           | no                                    |
| Suspend (1–30 days) or ban        | any staff proposes          | yes: an independent governor or admin |
| Emergency containment             | governor or admin, 72 hours | the full action needs someone else    |
| High-risk KYC approval            | any staff proposes          | yes: an independent governor or admin |
| Lift a restriction, decide appeal | governor or admin           | must not have taken part              |

- Nobody acts on a report they filed, a decision about themselves, or a decision
  they already took part in.
- A warning never changes account status. Lifting a restriction restores only
  the content that restriction hid, and only once nothing else restricts the
  account. Content whose listing period ended stays hidden, with the reason
  recorded.
- Suspensions end, emergency containments lapse and proposals expire through the
  `expire-due-items` pg_cron job, which runs every 5 minutes. Admin → Operations
  Health shows when it last ran.
- Members see their decisions at `/appeals` and can appeal each decision once.
  Banned and suspended members can still reach appeals, notifications, support,
  privacy requests and sign-out.

## Notices and other background jobs

Member notices, and auth metadata syncs that failed inline, are durable jobs in
`operation_jobs`. The `verifymzansi-ops-jobs` worker triggers
`/api/webhooks/ops-jobs` every minute. Jobs retry with backoff; after 6 failures
a job is marked stuck and a critical incident is recorded.

Setup (once per environment):

```bash
wrangler secret put OPS_JOBS_SECRET --config wrangler.ops-jobs.toml
```

```bash
wrangler deploy --config wrangler.ops-jobs.toml
```

Set the same `OPS_JOBS_SECRET` (at least 32 characters) on the app worker. If
the secret is missing, the endpoint refuses every call and notices wait in the
queue.

Admin → Operations Health lists stuck jobs (admins can retry them), approved
decisions whose update failed (for example a KYC override; admins retry from the
decision page), open incidents, and whether the expiry job is running.
