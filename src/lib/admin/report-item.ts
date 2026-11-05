import type { NativeReportReview } from "./native-report-review";
import type { ReportSeverity } from "@/types/enums";
/** Fields the selected report controls actually use. Reporter identifiers and
 * abuse-detection fingerprints are not part of the queue presentation. */
export interface ReportItem {
  id: string;
  target_id: string | null;
  target_type: string;
  category: string;
  severity: ReportSeverity;
  status: string;
  description?: string;
  reporter_user_id?: string | null;
  created_at: string;
  foundation?: NativeReportReview;
  awaitingDecision?: true;
}
