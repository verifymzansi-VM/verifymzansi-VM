/** Presentation aliases for the preserved staff interface. These are exact
 * renamed native capabilities, never a role hierarchy or a fallback grant.
 * Every database command still checks its own canonical capability. */
const aliases = new Map([
  ["organisations:manage", "organisation:manage"],
  ["partners:manage", "partner:manage"],
  ["role:review", "role:manage"],
  ["role:assign", "role:manage"],
  ["role:revoke", "role:manage"],
  ["oversight:view", "decision:approve"],
]);
export function nativeCapabilityFor(capability: string) {
  return aliases.get(capability) ?? capability;
}
