import { hasCapability, type Capability } from "@/lib/auth/roles";
import type { StaffRole } from "@/types/enums";

/**
 * The admin navigation registry: every admin page, the capability its page
 * guard requires, and where it sits in the sidebar. The sidebar shows a
 * page exactly when the viewer's role holds that capability, and
 * `nav.test.ts` checks each entry against the page's own `requireStaff`
 * call, so a link is never shown to someone the page would turn away, and
 * no page a role can use is left out of its menu.
 */

export type NavIcon =
  | "home"
  | "shield"
  | "eye"
  | "clock"
  | "flag"
  | "inbox"
  | "shopping"
  | "building"
  | "palm"
  | "alert"
  | "scale"
  | "gavel"
  | "file"
  | "users"
  | "activity"
  | "scroll"
  | "chart"
  | "trending"
  | "percent"
  | "award"
  | "landmark"
  | "handshake"
  | "receipt"
  | "gift"
  | "toggle";

/** Keys of `staff_nav_counts()` shown as badges. */
export type NavBadge =
  | "reports"
  | "kyc"
  | "business_kyc"
  | "content"
  | "support"
  | "decisions"
  | "appeals"
  | "dsar_overdue"
  | "role_changes";

export type NavSectionId =
  | "home"
  | "queues"
  | "areas"
  | "decisions"
  | "compliance"
  | "oversight"
  | "intelligence"
  | "commercial"
  | "platform";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  section: NavSectionId;
  /** The page guard's capability; null means any active staff member. */
  capability: Capability | null;
  badge?: NavBadge;
  /** Shown only while this feature flag is on. */
  flag?: "kyc_evidence_desk";
}

const NAV_SECTION_LABELS: Record<NavSectionId, string> = {
  home: "Home",
  queues: "Queues",
  areas: "Marketplace areas",
  decisions: "Decisions",
  compliance: "Compliance",
  oversight: "Oversight",
  intelligence: "Intelligence",
  commercial: "Commercial",
  platform: "Platform",
};

const SECTION_ORDER: NavSectionId[] = [
  "home",
  "queues",
  "decisions",
  "compliance",
  "areas",
  "oversight",
  "commercial",
  "intelligence",
  "platform",
];

export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin", label: "Home", icon: "home", section: "home", capability: null },

  // Queue work: moderators claim; governors and admins can act and reassign.
  {
    href: "/admin/verification",
    label: "Verify accounts",
    icon: "shield",
    section: "queues",
    capability: "queue:view",
    badge: "kyc",
  },
  {
    href: "/admin/verification/evidence",
    label: "Evidence desk",
    icon: "eye",
    section: "queues",
    capability: "queue:view",
    flag: "kyc_evidence_desk",
  },
  {
    href: "/admin/business-verification",
    label: "Verify businesses",
    icon: "building",
    section: "queues",
    capability: "queue:view",
    badge: "business_kyc",
  },
  {
    href: "/admin/moderation",
    label: "Content moderation",
    icon: "clock",
    section: "queues",
    capability: "queue:view",
    badge: "content",
  },
  {
    href: "/admin/reports",
    label: "Reports",
    icon: "flag",
    section: "queues",
    capability: "queue:view",
    badge: "reports",
  },
  {
    href: "/admin/support",
    label: "Support inbox",
    icon: "inbox",
    section: "queues",
    capability: null,
    badge: "support",
  },

  {
    href: "/admin/mzansi-market",
    label: "Mzansi Market",
    icon: "shopping",
    section: "areas",
    capability: "queue:view",
  },
  {
    href: "/admin/businesses",
    label: "Mzansi Business",
    icon: "building",
    section: "areas",
    capability: "queue:view",
  },
  {
    href: "/admin/tourism-events",
    label: "Tourism & Events",
    icon: "palm",
    section: "areas",
    capability: "queue:view",
  },

  {
    href: "/admin/governance/escalations",
    label: "Escalations",
    icon: "gavel",
    section: "decisions",
    capability: "decision:approve",
    badge: "decisions",
  },
  {
    href: "/admin/governance/appeals",
    label: "Appeals",
    icon: "scale",
    section: "decisions",
    capability: "appeal:decide",
    badge: "appeals",
  },
  {
    href: "/admin/governance/enforcement",
    label: "Restrictions",
    icon: "alert",
    section: "decisions",
    capability: "enforcement:execute",
  },

  {
    href: "/admin/dsar",
    label: "Data requests",
    icon: "file",
    section: "compliance",
    capability: "dsar:manage",
    badge: "dsar_overdue",
  },

  {
    href: "/admin/governance/oversight",
    label: "Oversight",
    icon: "eye",
    section: "oversight",
    capability: "oversight:view",
  },
  {
    href: "/admin/governance/roles",
    label: "Staff roles",
    icon: "users",
    section: "oversight",
    capability: "role:review",
    badge: "role_changes",
  },
  {
    href: "/admin/audit-log",
    label: "Audit log",
    icon: "scroll",
    section: "oversight",
    capability: "audit:view",
  },
  {
    href: "/admin/operations",
    label: "Operations health",
    icon: "activity",
    section: "oversight",
    capability: "audit:view",
  },

  {
    href: "/admin/commercial",
    label: "Commercial settings",
    icon: "percent",
    section: "commercial",
    capability: "commercial:manage",
  },
  {
    href: "/admin/trials",
    label: "Free posts & trials",
    icon: "gift",
    section: "commercial",
    capability: "trials:manage",
  },
  {
    href: "/admin/programmes",
    label: "Programmes & contracts",
    icon: "award",
    section: "commercial",
    capability: "contracts:manage",
  },
  {
    href: "/admin/organisations",
    label: "Organisations",
    icon: "landmark",
    section: "commercial",
    capability: "organisations:manage",
  },
  {
    href: "/admin/partners",
    label: "Partners & commission",
    icon: "handshake",
    section: "commercial",
    capability: "partners:manage",
  },
  {
    href: "/admin/payments",
    label: "Payments & refunds",
    icon: "receipt",
    section: "commercial",
    capability: "bi:view",
  },

  {
    href: "/admin/intelligence/users",
    label: "Users & growth",
    icon: "users",
    section: "intelligence",
    capability: "bi:view",
  },
  {
    href: "/admin/intelligence/verification",
    label: "Verification metrics",
    icon: "shield",
    section: "intelligence",
    capability: "bi:view",
  },
  {
    href: "/admin/intelligence/revenue",
    label: "Revenue & costs",
    icon: "trending",
    section: "intelligence",
    capability: "bi:view",
  },
  {
    href: "/admin/intelligence/marketplace",
    label: "Marketplace health",
    icon: "chart",
    section: "intelligence",
    capability: "bi:view",
  },
  {
    href: "/admin/intelligence/trends",
    label: "Trends",
    icon: "trending",
    section: "intelligence",
    capability: "bi:view",
  },
  {
    href: "/admin/intelligence/operations",
    label: "Operations summary",
    icon: "clock",
    section: "intelligence",
    capability: "bi:view",
  },

  {
    href: "/admin/feature-flags",
    label: "Feature flags",
    icon: "toggle",
    section: "platform",
    capability: "feature_flag:toggle",
  },
];

/** What each role's home page is called. */
export const HOME_TITLES: Record<StaffRole, string> = {
  moderator: "My shift",
  governance_controller: "Decisions",
  admin: "Platform",
};

export interface NavSectionView {
  id: NavSectionId;
  label: string;
  items: NavItem[];
}

function canSeeNavItem(role: StaffRole, item: NavItem): boolean {
  // The pure role → capability map; this module is also used in the browser.
  return (
    item.capability === null ||
    hasCapability({ app_metadata: { role }, is_anonymous: false }, item.capability)
  );
}

/** The sidebar for a role: the pages its capabilities open, grouped and ordered. */
export function navFor(
  role: StaffRole,
  flags: { kyc_evidence_desk?: boolean } = {}
): NavSectionView[] {
  const visible = ADMIN_NAV.filter(
    (item) => canSeeNavItem(role, item) && (!item.flag || flags[item.flag] === true)
  );
  return SECTION_ORDER.map((id) => ({
    id,
    label: NAV_SECTION_LABELS[id],
    items: visible
      .filter((item) => item.section === id)
      .map((item) => (item.href === "/admin" ? { ...item, label: HOME_TITLES[role] } : item)),
  })).filter((section) => section.items.length > 0);
}

/** The registry entry for a path: the longest matching href. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return [...ADMIN_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find(
      (item) =>
        pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`))
    );
}
