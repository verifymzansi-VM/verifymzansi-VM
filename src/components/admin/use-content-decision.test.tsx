/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useContentDecision } from "./use-content-decision";
import type { NativeContentReview } from "@/lib/admin/native-content-review";
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: HeadersInit) => headers }));
const fetcher = vi.fn(),
  complete = vi.fn();
const id = "11111111-1111-4111-8111-111111111111",
  secondId = "22222222-2222-4222-8222-222222222222";
const foundation: NativeContentReview = {
  expectedRevision: 7,
  claimGeneration: "8",
  claimNonce: "33333333-3333-4333-8333-333333333333",
};
const setup = () =>
  renderHook(() =>
    useContentDecision<{ id: string; foundation?: NativeContentReview }>({
      getArea: () => "MZANSI_MARKET",
      getContentType: () => "listing",
      rejectReasonRequiredMessage: "Give a reason",
      onDecisionComplete: complete,
    })
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("requires a represented native review before submitting a decision", async () => {
  const { result } = setup();
  act(() => result.current.openReview({ id }, "approve"));
  await act(() => result.current.submitDecision());
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.current.error).toContain("Claim this item");
});
it("submits the reviewed fence once even with two immediate clicks", async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const { result } = setup();
  act(() => result.current.openReview({ id, foundation }, "approve"));
  await act(async () => {
    const first = result.current.submitDecision(),
      second = result.current.submitDecision();
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(Response.json({ success: true }));
    await Promise.all([first, second]);
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    itemId: id,
    area: "MZANSI_MARKET",
    contentType: "listing",
    decision: "approve",
    ...foundation,
  });
  expect(complete).toHaveBeenCalledTimes(1);
});
it("does not close a newly selected review when an earlier reply arrives", async () => {
  let finish!: (value: Response) => void, pending!: Promise<void>;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const { result } = setup();
  act(() => result.current.openReview({ id, foundation }, "approve"));
  act(() => {
    pending = result.current.submitDecision();
  });
  act(() => {
    result.current.closeDialog();
    result.current.openReview({ id: secondId, foundation }, "reject");
  });
  await act(async () => {
    finish(Response.json({ success: true }));
    await pending;
  });
  expect(result.current.selectedItem?.id).toBe(secondId);
  expect(result.current.decision).toBe("reject");
  expect(complete).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
});
it("preserves the source request contract in isolated historical fixtures", async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "source");
  fetcher.mockResolvedValue(Response.json({ success: true }));
  const { result } = setup();
  act(() => result.current.openReview({ id }, "approve"));
  await act(() => result.current.submitDecision());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    itemId: id,
    area: "MZANSI_MARKET",
    contentType: "listing",
    decision: "approve",
  });
});
