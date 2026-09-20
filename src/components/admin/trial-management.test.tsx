import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrialManagement } from "./trial-management";

vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

describe("account free-post management", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("saves the selected account's remaining count and displays failures without losing input", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "Please retry" }) });
    vi.stubGlobal("fetch", fetch);
    render(
      <TrialManagement
        campaigns={[]}
        claims={[]}
        summary={[]}
        accountSearch="Siya"
        accounts={[{ user_id: "account-1", display_name: "Siya", remaining: 2 }]}
      />
    );
    expect(screen.getByText("Currently 2 extra free posts remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save free posts" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for change"), {
      target: { value: "Support allowance" },
    });
    fireEvent.change(screen.getByLabelText("Free posts remaining"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save free posts" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please retry"));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: "set_account_free_posts",
      target: "account-1",
      values: { remaining: 3 },
      reason: "Support allowance",
    });
    expect(screen.getByLabelText("Free posts remaining")).toHaveValue(3);
  });
});
