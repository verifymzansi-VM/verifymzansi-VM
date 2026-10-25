import "server-only";
import { createFoundationPublicApi } from "./public-api";
import { readFoundationRuntimeConnection } from "./runtime-connection";
export function foundationServerPublicApi() {
  return createFoundationPublicApi(readFoundationRuntimeConnection());
}
