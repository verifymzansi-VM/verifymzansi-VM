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
