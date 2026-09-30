import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppealForm } from "./appeal-form";

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("a".repeat(64)),
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
}));

const REASON = "The listing was a genuine second-hand phone with my own photos.";

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/Why should this decision be reviewed/), {
    target: { value: REASON },
  });
  fireEvent.click(screen.getByRole("button"));
}

describe("AppealForm", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("shows readable copy and keeps the reason after a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    render(<AppealForm decisionId="d-1" />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your appeal could not be sent. Check your connection and try again."
    );
    expect(screen.getByLabelText(/Why should this decision be reviewed/)).toHaveValue(REASON);
    expect(screen.getByRole("button")).toBeEnabled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not render a non-string API error as [object Object]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: { code: "conflict" } }), { status: 409 })
      )
    );
    render(<AppealForm decisionId="d-1" />);
    fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your appeal could not be sent. Try again."
    );
  });
});
