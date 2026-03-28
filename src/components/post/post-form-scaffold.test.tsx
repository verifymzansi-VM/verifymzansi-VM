import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostFormFooter } from "./post-form-scaffold";

describe("PostFormFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not submit the form while advancing into the final step", () => {
    const handleSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    function FooterHarness() {
      const [step, setStep] = useState(1);

      return (
        <form noValidate onSubmit={handleSubmit}>
          <PostFormFooter
            currentStep={step}
            totalSteps={3}
            onBack={() => setStep((current) => Math.max(current - 1, 0))}
            onNext={() => setStep((current) => Math.min(current + 1, 2))}
          />
        </form>
      );
    }

    const { container } = render(<FooterHarness />);

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toHaveAttribute("type", "button");
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);

    fireEvent.click(nextButton);

    expect(handleSubmit).not.toHaveBeenCalled();

    const submitButton = screen.getByRole("button", { name: /Submit for review/i });
    expect(submitButton).toHaveAttribute("type", "submit");
    expect(submitButton).not.toBe(nextButton);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it("submits only from the final-step action", () => {
    const handleSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <form noValidate onSubmit={handleSubmit}>
        <PostFormFooter currentStep={2} totalSteps={3} />
      </form>
    );

    const submitButton = screen.getByRole("button", { name: /Submit for review/i });
    expect(submitButton).toHaveAttribute("type", "submit");

    fireEvent.click(submitButton);

    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows an accessible loading state while submitting", () => {
    const { container } = render(
      <form noValidate>
        <PostFormFooter
          currentStep={2}
          totalSteps={3}
          isSubmitting
          submittingLabel="Uploading media..."
        />
      </form>
    );

    const submitButton = screen.getByRole("button", { name: /Uploading media/i });

    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
