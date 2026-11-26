import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostingTermsConsent } from "./posting-terms-consent";

describe("PostingTermsConsent", () => {
  it("is one wording for every form, naming what is posted in the area's colours", () => {
    const onCheckedChange = vi.fn();
    render(
      <PostingTermsConsent
        id="business-terms-checkbox"
        checked={false}
        onCheckedChange={onCheckedChange}
        error="Accept the posting terms before submitting."
        subject="business post"
        accent="blue"
      />
    );
    const tick = screen.getByRole("checkbox", {
      name: /I accept the VerifyMzansi posting terms, including the free-post visibility period and my responsibility for the accuracy and legality of this business post\. View terms\./,
    });
    expect(tick).toHaveAttribute("id", "business-terms-checkbox");
    expect(tick).toHaveClass("accent-brand-blue-600");
    expect(tick).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("link", { name: "View terms" })).toHaveClass("text-brand-blue-700");
    expect(screen.getByText("Accept the posting terms before submitting.")).toBeInTheDocument();
    fireEvent.click(tick);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("defaults to a post in green, and has a teal tourism form", () => {
    const { rerender } = render(<PostingTermsConsent id="t" checked onCheckedChange={() => {}} />);
    expect(screen.getByText(/legality of this post\./)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveClass("accent-brand-green-600");
    rerender(
      <PostingTermsConsent
        id="t"
        checked
        onCheckedChange={() => {}}
        subject="tourism or event post"
        accent="teal"
      />
    );
    expect(screen.getByText(/legality of this tourism or event post\./)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveClass("accent-teal-600");
    expect(screen.getByRole("link", { name: "View terms" })).toHaveClass("text-teal-700");
  });
});
