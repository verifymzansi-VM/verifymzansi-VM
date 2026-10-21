import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PostingTermsAcceptance } from "./posting-terms-acceptance";
import type { FoundationOwnerPostingTerms } from "@/lib/foundation/posting-terms";

const document: FoundationOwnerPostingTerms = {
  version: "posting-v1",
  document_hash: "A".repeat(43),
  document_path: "/terms/versions/posting-v1",
  accepted_at: null,
};
const receipt = { ...document, accepted_at: "2026-10-21T08:00:00.123456+00:00" };
afterEach(() => vi.unstubAllGlobals());

it("requires an explicit choice, records once and shows the confirmed receipt", async () => {
  const accept = vi.fn().mockResolvedValue(receipt),
    onAccepted = vi.fn();
  render(<PostingTermsAcceptance document={document} accept={accept} onAccepted={onAccepted} />);
  expect(screen.getByRole("button")).toBeDisabled();
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("status");
  expect(accept).toHaveBeenCalledExactlyOnceWith({
    version: document.version,
    document_hash: document.document_hash,
    accepted: true,
  });
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("does not ask again for the same accepted version", () => {
  const accept = vi.fn();
  render(<PostingTermsAcceptance document={receipt} accept={accept} onAccepted={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("accepted the current posting terms");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
});
it("clears the choice on a new version and ignores a late receipt for the old document", async () => {
  let resolve!: (value: FoundationOwnerPostingTerms) => void;
  const accept = vi.fn(
    () =>
      new Promise<FoundationOwnerPostingTerms>((done) => {
        resolve = done;
      })
  );
  const onAccepted = vi.fn();
  const view = render(
    <PostingTermsAcceptance document={document} accept={accept} onAccepted={onAccepted} />
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  view.rerender(
    <PostingTermsAcceptance
      document={{ ...document, version: "posting-v2", document_path: "/terms/versions/posting-v2" }}
      accept={accept}
      onAccepted={onAccepted}
    />
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button")).toBeDisabled();
  await act(async () => resolve(receipt));
  expect(onAccepted).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("fails closed without a published document", () => {
  render(<PostingTermsAcceptance document={null} onAccepted={vi.fn()} />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("shows a safe error without replaying an uncertain write", async () => {
  const accept = vi.fn().mockRejectedValue(new Error("private provider diagnostic"));
  render(<PostingTermsAcceptance document={document} accept={accept} onAccepted={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
  expect(accept).toHaveBeenCalledTimes(1);
});
it("posts the selected document to the guarded route and validates its acknowledgement", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(receipt));
  vi.stubGlobal("fetch", fetcher);
  render(<PostingTermsAcceptance document={document} onAccepted={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("/api/foundation/posting-terms");
  expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
  expect(JSON.parse(init.body)).toEqual({
    version: document.version,
    document_hash: document.document_hash,
    accepted: true,
  });
});
