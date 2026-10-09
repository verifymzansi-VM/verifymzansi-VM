import {
  useState,
  useHostTheme,
  Stack,
  Row,
  Grid,
  H1,
  H2,
  Text,
  Table,
  Button,
  Callout,
  Stat,
} from "cursor/canvas";
const findings = [
  {
    id: "F1",
    priority: "P1",
    kind: "Live configuration",
    title: "Staff RLS authority is available without MFA",
    detail:
      "staff_mfa_enforced has mode=off, even though enabled=true. current_staff_role explicitly accepts the off mode. A read-only role simulation with an active staff account and aal1 returned staff authority. Staff policies on KYC and other sensitive tables therefore do not require a second factor while this switch is off.",
    remediation:
      "Complete staff MFA enrolment and switch staff_mfa_enforced to mode=on through the audited admin workflow; review enrolment grace periods. Verify enrolled staff at AAL1 are denied and AAL2 sessions succeed.",
    evidence:
      "Live feature flag and read-only staff AAL1 role simulation; current_staff_role deployed body; src/lib/auth/staff-mfa.ts.",
    limit:
      "Role simulation used trusted SQL-set claims; it did not authenticate with a password or retrieve KYC records.",
  },
  {
    id: "F2",
    priority: "P2",
    kind: "Authorization defect",
    title: "Owners can forge engaged-view analytics on non-live posts",
    detail:
      "authenticated has table-wide UPDATE on listings, businesses and promotions. Owner policies permit own rows. guard_content_monetization_columns protects view_count and click_count but omits engaged_view_count. guard_owner_content_edits blocks live/suspended/reviewed rows, while draft and hidden counters can be changed. The metrics dashboard trusts this counter.",
    remediation:
      "Add engaged_view_count to the protected counter list and restrict editable columns where practical. Add coverage for owner attempts in all post states while preserving service-only analytics writes.",
    evidence:
      "Live grants, RLS policies and guard bodies. Focused PGlite replay changed draft and hidden counters to 1,000,000 in all 3 tables; view_count/live edits/cross-owner edits were denied.",
    limit:
      "Local reproduction executes three unmodified deployed guards with minimal fixtures. Remaining production triggers were inspected but not replayed; no production UPDATE or full HTTP reproduction was attempted.",
  },
  {
    id: "F3",
    priority: "P2",
    kind: "Hardening",
    title: "API roles have excessive grants and unsafe object defaults",
    detail:
      "The authenticated role retains TRUNCATE, REFERENCES and TRIGGER on 64 public tables; anon retains them on 60. Current RLS blocks unauthorized normal DML, but TRUNCATE and REFERENCES are outside RLS. Public-schema defaults grant table-wide privileges and function EXECUTE to anon/authenticated for postgres and supabase_admin creators. A new function can become callable before its author deliberately grants access.",
    remediation:
      "Revoke unneeded whole-table privileges on application-owned tables. Revoke implicit PUBLIC/anon/authenticated function EXECUTE defaults for the actual object creators, then explicitly grant intended API functions and required policy helpers. Narrow table default grants and test fresh migrations.",
    evidence: "Live pg_default_acl and effective table/function/column privilege queries.",
    limit:
      "No currently reachable TRUNCATE RPC or direct-SQL path for browser users was found. These roles have no LOGIN, BYPASSRLS, superuser or public CREATE privileges. This is excessive authority/future exposure risk, not a demonstrated REST mass-delete exploit.",
  },
  {
    id: "F4",
    priority: "P2",
    kind: "Auth configuration",
    title: "Native breached-password protection is disabled",
    detail:
      "The live security advisor and repository strict check confirm leaked-password protection is disabled. The strict check identifies the organisation plan as Free and classifies the feature as plan-blocked.",
    remediation:
      "Enable Supabase leaked-password protection on a supported plan. Until then, verify effective application-level breached-password controls across every password creation/change path; those paths were outside this schema review.",
    evidence:
      "Live Security Advisor auth_leaked_password_protection; timestamped strict-check log.",
    limit:
      "This review did not test password signup/change paths or claim that an application-level compensating control is absent.",
  },
  {
    id: "F5",
    priority: "P2",
    kind: "Platform maintenance",
    title: "Database remains on PostgreSQL 17.6",
    detail:
      "The live server_version is 17.6. Supabase's 25 September 2026 changelog announces a 17.11 rollout that closes 44 CVEs. Installed pgcrypto is 1.3; ltree and btree_gist were not installed.",
    remediation:
      "Check upgrade availability in Supabase and schedule the supported security update after extension/backup checks. Review pgcrypto usage for legacy cipher options before upgrading.",
    evidence:
      "Live server_version and extension queries; Supabase PostgreSQL 15.19 / 17.11 changelog.",
    limit:
      "No individual CVE exploit was attempted or confirmed; hosted patch backports were not verified.",
  },
];
export default function SupabaseSecurityReview() {
  const theme = useHostTheme();
  const [selected, setSelected] = useState("F1");
  const detail = findings.find((f) => f.id === selected)!;
  return (
    <Stack gap={20} style={{ padding: 24, color: theme.text.primary, background: theme.bg.editor }}>
      <H1>VerifyMzansi Supabase security review</H1>
      <Text tone="secondary">
        8 October 2026 · Review and live remediation · Project tnygdgormnofpgjknlhr
      </Text>
      <Callout tone="warning" title="Application fixes deployed · platform work remains">
        Staff MFA, the engaged-view counter guard, application defaults and table grants are fixed.
        Native password protection remains blocked on Free. PostgreSQL awaits a maintenance window
        and verified backup; Supabase-owned defaults require platform privileges.
      </Callout>
      <Text tone="secondary">
        The findings below preserve the original review observations. The current remediation
        evidence records live fixes and remaining limits.
      </Text>
      <Row gap={28}>
        <Stat value={88} label="Public tables with RLS" />
        <Stat value={115} label="Policies reviewed" />
        <Stat value={7} label="Browser-callable privileged functions reviewed" />
      </Row>
      <Grid columns="minmax(280px, 1fr) minmax(300px, 1.3fr)" gap={24}>
        <Stack gap={12}>
          <H2>Findings, ordered by priority</H2>
          <Table
            headers={["Priority", "Finding", "Classification"]}
            rows={findings.map((f) => [
              f.priority,
              <Button
                key={f.id}
                variant={selected === f.id ? "secondary" : "ghost"}
                onClick={() => setSelected(f.id)}
              >
                {f.title}
              </Button>,
              f.kind,
            ])}
          />
          <Text size="small" tone="secondary">
            Source: live catalog/advisor queries on 8 October 2026. Click a finding to inspect
            evidence and limits.
          </Text>
        </Stack>
        <Stack gap={12}>
          <H2>{detail.title}</H2>
          <Text weight="medium">
            {detail.priority} · {detail.kind}
          </Text>
          <Text>{detail.detail}</Text>
          <H2>Recommended change</H2>
          <Text>{detail.remediation}</Text>
          <H2>Evidence</H2>
          <Text>{detail.evidence}</Text>
          <Text size="small" tone="secondary">
            {detail.limit}
          </Text>
        </Stack>
      </Grid>
      <H2>Access controls that held</H2>
      <Text>
        All public tables have RLS. Six no-policy tables lack browser-role table and column grants.
        Anonymous and synthetic non-staff checks saw zero profiles, payments, KYC artifacts or
        organisation notes. Examined public RPCs scope to the caller or filtered public data.
      </Text>
      <H2>Strict check remains blocked</H2>
      <Text>
        The exact attestations now pass: 19 reviewed controls, zero actionable advisor findings, one
        plan-blocked finding. The strict gate remains FAIL for native password protection. The user
        chose to retain the Free plan.
      </Text>
      <Text size="small" tone="secondary">
        Migration 20261008182329 is live. 107 focused tests passed; TypeScript, scoped
        lint/formatting and live schema checks passed. Docker verification and the upgrade backup
        remain incomplete. Trusted SQL role simulations do not validate HTTP/JWT behavior.
      </Text>
    </Stack>
  );
}
