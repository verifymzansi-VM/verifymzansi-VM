// Preloaded (node --import) into the foundation test copy's `next start`
// process by `scripts/foundation-e2e.mjs serve`, and nowhere else. See
// foundation-e2e-outbound-guard.mjs.
import { installOutboundGuard } from "./foundation-e2e-outbound-guard.mjs";

installOutboundGuard();
