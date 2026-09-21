# VerifyMzansi email operations

## Where a contact-form request goes

The `/contact` form writes to Supabase `contact_submissions`. Staff read it in
`https://verifymzansi.com/admin/support`; access requires a current staff role.
The email typed into the form is the sender's reply address, not the staff
inbox. The original live implementation saved the request and displayed "Message
Sent" without sending any acknowledgement or staff email. This explains a saved
request with no corresponding email in Resend. It is not evidence that Gmail
lost it.

The updated flow returns a `VM-<submission UUID>` reference, sends a minimal
acknowledgement to the sender and a category-specific alert to the team, and
logs each send outcome against that submission in `audit_logs`. Failed email
does not discard the saved request. The success page distinguishes saved
requests from email acceptance. The admin inbox shows notification status,
reference links, search within the current page and pagination beyond the
previous 200-row cap. Provider acceptance is not proof of inbox delivery.
Historical requests are not automatically emailed retrospectively.

The Support Inbox contains website form requests only. Direct messages to domain
addresses and replies sent through the mailbox remain in the mailbox. Resend's
transactional send history is separate again. Changing mailbox providers does
not automatically import all three communication channels into one place.

## Free mailbox alternative

Zoho Mail's published Forever Free plan hosts one custom domain for up to five
users, with 5 GB per user and web/mobile access; IMAP/POP/ActiveSync are
excluded. Availability depends on the data center/region. Confirm the free offer
during signup before changing DNS. Source:
https://www.zoho.com/mail/zohomail-pricing.html

For a migration, create and verify the Zoho organization, provision every active
alias, obtain the region-specific MX/SPF/DKIM values, then plan the root MX
switch from Cloudflare routing to Zoho. Preserve Resend's DKIM and `send`
return-path records, merge root SPF into one record, and test inbound/outbound
delivery before retiring the Gmail forwarding path. No mailbox account or MX
migration was made during this maintenance work. The existing app Support Inbox
needs no additional mailbox subscription to read website requests.

## Current configuration (checked 21 September 2026)

Cloudflare Email Routing forwards incoming domain mail to the verified
destination `verifymzansi2s@gmail.com`. The Cloudflare account name contains a
different Gmail address; the account login is not the forwarding destination.
Routing is enabled, synced and ready. Root MX records belong to Cloudflare.

Explicit forwarding rules now exist for:

- `hello@verifymzansi.com`: general enquiries.
- `support@verifymzansi.com`: account and platform support.
- `billing@verifymzansi.com`: payments and refunds.
- `verification@verifymzansi.com`: verification questions and appeals.
- `privacy@verifymzansi.com`: privacy and data requests.
- `security@verifymzansi.com`: vulnerabilities and account security.
- `abuse@verifymzansi.com`: fraud and abuse reports.
- `dmarc@verifymzansi.com`: authentication aggregate reports.
- `postmaster@verifymzansi.com`: mail delivery administration.
- `noreply@verifymzansi.com`: catches direct replies to the app sender.
- `team@verifymzansi.com`: replies to Supabase authentication emails.

These are aliases of the same inbox, not separate mailboxes or access
boundaries. The existing catch-all remains enabled. Consider disabling it only
after identifying every legitimate address in use.

Resend sends application messages from
`VerifyMzansi <noreply@verifymzansi.com>`. Replies default to support;
marketplace enquiry replies go to the buyer. Resend's domain status is now
**verified**, with sending enabled and receiving disabled. Receiving previously
failed because root MX correctly points to Cloudflare. Do not replace root MX
with Resend inbound MX.

Resend confirmed all three sending records as verified:

- DKIM: `resend._domainkey.verifymzansi.com`.
- Return-path SPF: `send.verifymzansi.com` includes `amazonses.com`.
- Return-path MX: `send.verifymzansi.com` uses the provider-issued SES host.

Root SPF separately includes Cloudflare and Google. Resend does not need a root
SPF include when using its separate return path. Never create two SPF records at
the same hostname. Publish provider-issued values, not guessed keys.

DMARC remains `p=none; adkim=s; aspf=s`, with aggregate reports now directed to
`dmarc@verifymzansi.com`. Strict SPF alignment does not align the `send`
subdomain with the root From domain; correctly aligned root DKIM can still pass
DMARC. Validate all actual sending paths before moving to quarantine/reject.
Records such as `_dmarc.support.verifymzansi.com` apply to the subdomain, not to
the local part in `support@verifymzansi.com`.

## Evidence and remaining checks

The Resend list API returned 30 messages dated 27 August-20 September 2026: 29
had a last event of delivered and one bounced. Seven subjects appeared to relate
to authentication: six delivered and one bounced. This is historical provider
evidence, not a fresh test of every template or proof of inbox placement. No new
email was sent during this maintenance work.

The deployed Cloudflare Worker has a `RESEND_API_KEY` secret binding. Its value
cannot be read back; successful Resend API checks used the local operator key.

The production-file Supabase management credential returned HTTP 401. A separate
local operator credential succeeded. Live Auth settings use Resend SMTP on port
465, username `resend`, with a password configured, sender
`team@verifymzansi.com`, and site URL `https://verifymzansi.com`. Confirmation,
recovery and email-change templates are configured. Email confirmation and
secure email change are enabled; the custom send-email hook is disabled. The
auth email limit is **25 per hour**; review capacity before a larger launch. A
stored password was not independently SMTP-authenticated during this check.
Replace the stale operator credential through the normal credential process; it
does not imply broken application auth.

Gmail inbox access and Send mail as settings were unavailable. Do not mark a
fresh end-to-end delivery test complete from DNS or an API acceptance result
alone.

No Resend delivery webhooks are configured. Application audit events currently
record provider acceptance/failure, not final delivery, bounce, or complaint.
Review events in Resend until a signed webhook and persistent delivery event
handling are implemented. App retries now share an idempotency key within each
send operation; this does not deduplicate separate HTTP requests or provide a
durable outbox across process restarts.

## Manual Gmail replies

Keep Cloudflare forwarding plus Resend for now: the existing sending domain is
verified and migration is unnecessary to fix the current gaps. For each staffed
alias, configure Gmail Settings > Accounts and Import > Send mail as with an
authenticated domain sender, and complete Gmail's alias verification.

For Resend SMTP, use `smtp.resend.com`, username `resend`, a dedicated sending
API key as the password, and TLS using the provider's documented port. Set Gmail
to reply from the address the message was sent to. Store the key only in the
SMTP credential field. Google SPF alone does not authenticate a branded Gmail
alias.

For multiple staff members, consider Google Workspace mailboxes/groups with
individual logins and a shared support inbox. This provides clearer ownership
than sharing one personal Gmail login. Plan its MX migration separately; leave
Resend transactional DKIM and return-path records intact.

References: [Gmail aliases](https://support.google.com/mail/answer/22370?hl=en),
[Resend SMTP](https://resend.com/docs/send-with-smtp),
[Cloudflare routing](https://developers.cloudflare.com/email-service/get-started/route-emails/).

## Supabase authentication email

The live SMTP settings above are configured. Complete a controlled signup/reset
test and verify callback completion. Review the current 25-emails/hour capacity
against expected traffic and the Resend account quota. Keep click tracking
disabled for authentication links (Resend reports it disabled). The app's Resend
API key does not configure Supabase SMTP automatically.

Reference:
[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Verification after deploying application changes

1. Run `pnpm email:domain:check`. It now checks the actual Resend return path
   and DKIM selector, detects duplicate SPF/DMARC records, and does not require
   a nonexistent Cloudflare TXT marker or an unused Google DKIM selector.
2. From a different external mailbox, send a uniquely labelled test to support,
   billing, verification, privacy and security. Confirm arrival in the verified
   Gmail inbox, then reply using the matching domain alias. Inspect
   SPF/DKIM/DMARC results in the external recipient's message headers.
3. Test signup confirmation, password reset and email change with a controlled
   account; inspect delivery and link completion, not only HTTP success.
4. Submit a controlled contact request. Confirm it is stored in `/admin/support`
   and the matching category alias receives the alert. Request contents remain
   in the authenticated queue; email alerts contain only category and queue
   link.
5. Confirm receipt and verification emails, and inspect bounce/complaint events
   in Resend. A successful send response means accepted, not delivered.

Application changes must be deployed before these code improvements are live.
Cloudflare aliases, DMARC reporting destination and the Resend capability fix
were applied directly and verified separately from the source changes.
