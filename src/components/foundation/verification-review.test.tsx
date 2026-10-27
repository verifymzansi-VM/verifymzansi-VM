import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FoundationVerificationReview } from "./verification-review";
const { auth, csrf } = vi.hoisted(() => ({
  auth: { state: {} as Record<string, unknown> },
  csrf: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector(auth.state),
}));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: csrf,
  withCsrfHeaders: (headers: HeadersInit) => new Headers(headers),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const authorized = () => ({
  user: { id: id(1), role: "governance_controller" },
  isLoading: false,
  foundationContext: {
    account_id: id(1),
    staff: {
      can_access: true,
      assigned_capabilities: ["queue:view", "case:claim", "evidence:view"],
    },
  },
});
const item = {
  case_id: id(2),
  version: 1,
  display_name: "Synthetic member",
  submitted_at: "2026-10-27T00:00:00Z",
  risk_score: 90,
  decision_id: id(3),
  proposed_by: id(4),
};
const number = "0".repeat(13);
const context = {
  case_id: id(2),
  case_version: 1,
  submission_id: id(5),
  risk_score: 90,
  claimed_number: number,
  claimed_names: { first_name: "Synthetic", last_name: "Member" },
  id_artifact_id: id(6),
  selfie_artifact_id: id(7),
};
const lease = {
  case_id: id(2),
  claim_generation: "1",
  claim_nonce: id(8),
  claim_expires_at: "2100-01-01T00:00:00Z",
};
const NativeURL = URL;
let sequence = 0;
const createUrl = vi.fn((_value: Blob | MediaSource) => `blob:synthetic-evidence-${sequence++}`);
const revokeUrl = vi.fn((_url: string) => {});
class EvidenceURL extends NativeURL {
  static createObjectURL = createUrl;
  static revokeObjectURL = revokeUrl;
}
const fetcher = vi.fn<typeof fetch>();
let finished = false,
  queueFailure = false,
  contextFailure = false;
function response(input: RequestInfo | URL, init?: RequestInit): Response {
  if (String(input).endsWith("/evidence"))
    return new Response("synthetic-evidence", { headers: { "content-type": "image/png" } });
  if (!init?.method || init.method === "GET")
    return queueFailure
      ? Response.json({ error: "Review queue unavailable" }, { status: 503 })
      : Response.json(finished ? [] : [item]);
  const body = JSON.parse(String(init.body));
  if (body.action === "claim") return Response.json(lease);
  if (body.action === "context")
    return contextFailure
      ? Response.json({ error: "Evidence context unavailable" }, { status: 503 })
      : Response.json(context);
  finished = true;
  return Response.json({ status: "approved" });
}
beforeEach(() => {
  vi.clearAllMocks();
  sequence = 0;
  finished = false;
  queueFailure = false;
  contextFailure = false;
  auth.state = authorized();
  csrf.mockResolvedValue("synthetic-csrf");
  fetcher.mockImplementation(async (input, init) => response(input, init));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("URL", EvidenceURL);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function open() {
  fireEvent.click(await screen.findByRole("button", { name: "Claim and review" }));
}

it("does not report an empty review queue when its read failed", async () => {
  queueFailure = true;
  render(<FoundationVerificationReview />);
  await screen.findByText("Review queue unavailable");
  expect(
    screen.queryByText("No identity submissions are waiting for review.")
  ).not.toBeInTheDocument();
});
it("keeps an acquired claim releasable when evidence context could not load", async () => {
  contextFailure = true;
  render(<FoundationVerificationReview />);
  await open();
  const release = await screen.findByRole("button", { name: "Release case" });
  await waitFor(() => expect(release).not.toBeDisabled());
  fireEvent.click(release);
  await screen.findByText("Claim released.");
  expect(
    fetcher.mock.calls.some(
      ([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).action === "release"
    )
  ).toBe(true);
  expect(createUrl).not.toHaveBeenCalled();
});
it("clears private identity data and object URLs after independent approval", async () => {
  render(<FoundationVerificationReview />);
  await open();
  await screen.findByText(number);
  fireEvent.click(screen.getByLabelText(/exact ID number and declared legal names/));
  fireEvent.click(screen.getByLabelText(/document portrait matches the selfie/));
  const approve = screen.getByRole("button", { name: "Approve independent review" });
  await waitFor(() => expect(approve).not.toBeDisabled());
  fireEvent.click(approve);
  await screen.findByText("Independent review approved.");
  expect(screen.queryByText(number)).not.toBeInTheDocument();
  expect(screen.queryByAltText("Claimed identity document")).not.toBeInTheDocument();
  expect(revokeUrl).toHaveBeenCalledTimes(2);
});
it("unmounts the private viewer when the current capability assignment is withdrawn", async () => {
  const view = render(<FoundationVerificationReview />);
  await open();
  await screen.findByText(number);
  const state = authorized();
  state.foundationContext.staff.assigned_capabilities = ["queue:view"];
  auth.state = state;
  view.rerender(<FoundationVerificationReview />);
  expect(screen.getByRole("alert")).toHaveTextContent("reviewer assignment");
  expect(screen.queryByText(number)).not.toBeInTheDocument();
  expect(revokeUrl).toHaveBeenCalledTimes(2);
});
it("never creates an evidence object URL for a response arriving after unmount", async () => {
  let finish: ((value: Response) => void) | undefined;
  fetcher.mockImplementation(async (input, init) =>
    String(input).endsWith("/evidence")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : response(input, init)
  );
  const view = render(<FoundationVerificationReview />);
  await open();
  await waitFor(() => expect(finish).toBeDefined());
  view.unmount();
  await act(async () => {
    finish!(new Response("synthetic-evidence", { headers: { "content-type": "image/png" } }));
  });
  expect(createUrl).not.toHaveBeenCalled();
});
it("does not send a claim mutation before the same-origin security token is ready", async () => {
  csrf.mockResolvedValue(null);
  render(<FoundationVerificationReview />);
  await open();
  await screen.findByText("Refresh the security check before continuing.");
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
