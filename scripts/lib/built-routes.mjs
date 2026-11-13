// Routes the production build must contain: the payment and KYC provider
// callbacks, the verification start and the pricing page. A build that drops
// one of them (for example through a bad route-group move) still compiles.
// Checked by CI (build-route-verify, scripts/check-built-routes.mjs).
export const REQUIRED_BUILT_ROUTES = [
  "/api/webhooks/ozow/route",
  "/api/webhooks/kyc/provider/route",
  "/api/verification/session/start/route",
  "/pricing/page",
];

/**
 * @param {Record<string, string>} manifest .next/server/app-paths-manifest.json
 * @returns {string[]} required routes the manifest lacks
 */
export function missingBuiltRoutes(manifest, required = REQUIRED_BUILT_ROUTES) {
  const keys = Object.keys(manifest ?? {});
  return required.filter((route) => !keys.some((key) => key.endsWith(route)));
}
