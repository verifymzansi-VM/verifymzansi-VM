import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FoundationPostingTermsGate } from "./foundation-posting-terms-gate";

const current = {
  version: "posting-v1",
  document_hash: "A".repeat(43),
  document_path: "/terms/versions/posting-v1",
  accepted_at: null,
};
afterEach(() => vi.unstubAllGlobals());
const gate = (enabled = true) => (
  <FoundationPostingTermsGate enabled={enabled}>
    <button>Choose a post category</button>
  </FoundationPostingTermsGate>
);

it("keeps the existing application independent when the foundation is not bound", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(gate(false));
  expect(screen.getByRole("button", { name: "Choose a post category" })).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires an explicit choice for an unaccepted document and hides posting until confirmed", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(current));
  vi.stubGlobal("fetch", fetcher);
  render(gate());
  expect(screen.queryByRole("button", { name: "Choose a post category" })).not.toBeInTheDocument();
  await screen.findByRole("checkbox");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button")).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([
    "/api/foundation/posting-terms",
    expect.objectContaining({
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    }),
  ]);
});

it("uses a current account receipt without asking for acceptance again", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...current, accepted_at: "2026-10-21T08:00:00Z" }))
  );
  render(gate());
  await screen.findByRole("button", { name: "Choose a post category" });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("sends an unauthenticated account to sign in without rendering posting controls", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  render(gate());
  expect(await screen.findByRole("link", { name: "Sign in to continue posting" })).toHaveAttribute(
    "href",
    "/login?returnUrl=%2Fpost%2Fcreate"
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("fails closed on malformed status and permits an explicit fresh read", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...current, owner_id: "unexpected-private-data" }))
    .mockResolvedValueOnce(Response.json({ ...current, accepted_at: "2026-10-21T08:00:00Z" }));
  vi.stubGlobal("fetch", fetcher);
  render(gate());
  expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Choose a post category" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("checks current status after an uncertain write without automatically accepting again", async () => {
  const accepted = { ...current, accepted_at: "2026-10-21T08:00:00Z" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(current))
    .mockRejectedValueOnce(new Error("connection lost after possible commit"))
    .mockResolvedValueOnce(Response.json(accepted));
  vi.stubGlobal("fetch", fetcher);
  render(gate());
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Accept posting terms" }));
  await screen.findByRole("alert");
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Check current terms" }));
  await screen.findByRole("button", { name: "Choose a post category" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("requires a new choice when an explicit status check finds a changed version", async () => {
  const next = { ...current, version: "posting-v2", document_path: "/terms/versions/posting-v2" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(current))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(Response.json(next));
  vi.stubGlobal("fetch", fetcher);
  render(gate());
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Accept posting terms" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Check current terms" }));
  expect(await screen.findByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("link", { name: "Read posting terms" })).toHaveAttribute(
    "href",
    next.document_path
  );
  expect(screen.getByRole("button", { name: "Accept posting terms" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Choose a post category" })).not.toBeInTheDocument();
});

it("aborts an old status request when the gate unmounts", async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(gate());
  const signal = fetcher.mock.calls[0]?.[1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => complete(Response.json(current)));
});
