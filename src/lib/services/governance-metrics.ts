import "server-only";
export async function readGovernanceMetrics() {
  const { readNativeGovernanceMetrics } = await import("@/lib/foundation/feature-controls-server");
  return readNativeGovernanceMetrics();
}
