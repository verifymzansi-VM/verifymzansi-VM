import type { NextRequest } from "next/server";
import { POST as submitFoundationReport } from "../foundation/reports/route";

export async function POST(request: NextRequest) {
  return submitFoundationReport(request);
}
