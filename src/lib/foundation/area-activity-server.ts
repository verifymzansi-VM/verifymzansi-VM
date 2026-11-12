import "server-only";
import { cache } from "react";
import { readFoundationServerSession } from "./server-session";
import { readFrontendReportQueue } from "./report-queue";
import { readFrontendAreaActivity } from "./area-activity";
import { parseRestoredArea } from "./areas";
function nativeArea(value?: string) {
  if (value === undefined) return;
  const area = parseRestoredArea(value);
  if (!area) throw new Error("Unknown program");
  return area;
}
export const readNativeProgramReports = cache(async (area: string) => {
  const current = await readFoundationServerSession();
  return readFrontendReportQueue(current.api, current.user.id, nativeArea(area));
});
export const readNativeAreaActivity = cache(async (area?: string, limit = 20) => {
  const native = nativeArea(area),
    current = await readFoundationServerSession();
  return readFrontendAreaActivity(current.api, current.user.id, native, limit);
});
