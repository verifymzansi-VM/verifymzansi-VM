import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ListingPriceFields } from "./listing-price-fields";
import { listingPriceFormToTerms, type ListingPriceForm } from "@/lib/domains/listings/price-form";

describe("foundation price fields", () => {
  it("offers negotiable Price on request and submits it without an amount", () => {
    const submit = vi.fn();
    function Form() {
      const [value, setValue] = useState<ListingPriceForm>({
        mode: "on_request",
        amount: "",
        negotiable: false,
      });
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(listingPriceFormToTerms(value, "electronics"));
          }}
        >
          <ListingPriceFields category="electronics" value={value} onChange={setValue} />
          <button>Save</button>
        </form>
      );
    }
    render(<Form />);
    expect(screen.queryByLabelText("Price (R)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Price negotiable" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledWith({ price: { mode: "on_request" }, negotiable: true });
    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("normalizes a hidden negotiable value when category changes to jobs", () => {
    const submit = vi.fn();
    function Form() {
      const [category, setCategory] = useState<"electronics" | "jobs_services">("electronics");
      const [value, setValue] = useState<ListingPriceForm>({
        mode: "amount",
        amount: "100",
        negotiable: true,
      });
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(listingPriceFormToTerms(value, category));
          }}
        >
          <ListingPriceFields category={category} value={value} onChange={setValue} />
          <button type="button" onClick={() => setCategory("jobs_services")}>
            Choose Jobs
          </button>
          <button>Save</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledWith({
      price: { mode: "amount", amount_cents: 10000 },
      negotiable: false,
    });
  });
  it("clears hidden amount/negotiability before a new Free command is submitted", () => {
    const submit = vi.fn();
    function Form() {
      const [value, setValue] = useState<ListingPriceForm>({
        mode: "amount",
        amount: "120.00",
        negotiable: true,
      });
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(listingPriceFormToTerms(value, "electronics"));
          }}
        >
          <ListingPriceFields category="electronics" value={value} onChange={setValue} />
          <button>Save</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    expect(screen.queryByLabelText("Price (R)")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledWith({ price: { mode: "free" }, negotiable: false });
  });
  it("provides salary choices without Free or negotiation and connects error text", () => {
    render(
      <ListingPriceFields
        category="jobs_services"
        value={{ mode: "amount", amount: "", negotiable: false }}
        onChange={vi.fn()}
        error="Enter a salary"
      />
    );
    expect(screen.queryByRole("radio", { name: "Free" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Salary not provided" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Salary (R)")).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").id
    );
  });
  it("keeps choices disabled during a pending save", () => {
    render(
      <ListingPriceFields
        category="electronics"
        value={{ mode: "free", amount: "", negotiable: false }}
        onChange={vi.fn()}
        disabled
      />
    );
    expect(screen.getByRole("radio", { name: "Free" })).toBeDisabled();
  });
});
