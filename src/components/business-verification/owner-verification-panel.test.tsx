import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnerVerificationPanel } from "./owner-verification-panel";

const STATE = {
  business: { id: "b1", name: "Example Kitchen" },
  stickers: { idReviewed: true, cipc: null, seen: null },
  cases: [],
  linkable: [],
};

const PREVIEW = {
  readable: true,
  docType: "registration_certificate",
  registrationNumber: "2020/123456/07",
  registeredName: "EXAMPLE TRADING (PTY) LTD",
  status: "In Business",
  directors: [{ name: "DLAMINI, THANDO", role: "Director" }],
  registeredOffice: "KwaDlangezwa, Empangeni, KwaZulu-Natal",
  ownerListedAs: "Director",
  looksOriginal: true,
  officeUsable: true,
  profileHasAddress: false,
};

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(preview: Partial<typeof PREVIEW> = {}) {
  fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/cipc/preview")) return json({ preview: { ...PREVIEW, ...preview } });
    if (url.endsWith("/cipc")) return json({ caseId: "c1", status: "pending" }, 201);
    return json(STATE);
  });
  vi.stubGlobal("fetch", fetchMock);
}

const pdf = () => new File(["%PDF-1.7"], "cor14-3.pdf", { type: "application/pdf" });

async function choose(file: File) {
  const input = await screen.findByLabelText(/Upload your CIPC PDF/);
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => stubFetch());
afterEach(() => vi.unstubAllGlobals());

describe("CIPC upload", () => {
  it("shows which document we need", async () => {
    render(<OwnerVerificationPanel businessId="b1" />);
    expect(await screen.findByText("Which document do we need?")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /CoR14.3 Registration Certificate/ })
    ).toBeInTheDocument();
  });

  it("refuses a photo before uploading anything", async () => {
    render(<OwnerVerificationPanel businessId="b1" />);
    await choose(new File(["x"], "cert.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Upload the PDF you got from CIPC/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/cipc"))).toBe(false);
  });

  it("confirms an original download and offers the office as the address", async () => {
    render(<OwnerVerificationPanel businessId="b1" />);
    await choose(pdf());
    expect(await screen.findByText(/Looks like an original CIPC download/)).toBeInTheDocument();
    const useOffice = screen.getByRole("checkbox", { name: /registered office as my business/ });
    expect(useOffice).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Send for review/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cipc"))).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/cipc"))!;
    const sent = (init as RequestInit).body as FormData;
    expect(sent.get("useOfficeAsAddress")).toBe("1");
    expect(sent.get("registrationNumber")).toBe("2020/123456/07");
  });

  it("warns about a changed file but still lets the owner send it", async () => {
    stubFetch({ looksOriginal: false, profileHasAddress: true });
    render(<OwnerVerificationPanel businessId="b1" />);
    await choose(pdf());
    expect(await screen.findByText(/changed after CIPC issued it/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /registered office as my business/ })
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Send for review/ })).toBeEnabled();
  });

  it("hides the address choice when the office can't fill the profile", async () => {
    stubFetch({ officeUsable: false });
    render(<OwnerVerificationPanel businessId="b1" />);
    await choose(pdf());
    await screen.findByText(/Looks like an original CIPC download/);
    expect(screen.queryByRole("checkbox", { name: /registered office as my business/ })).toBeNull();
  });
});
