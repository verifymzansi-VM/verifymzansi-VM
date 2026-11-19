import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlobalLoading from "./loading";

describe("shared route loading fallback", () => {
  it("announces exactly one status named 'Loading'", () => {
    const { container } = render(<GlobalLoading />);

    // getByRole throws when more than one status exists. A status takes no name
    // from its content, so its announced text is checked directly.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^Loading$/);
    expect(status).toHaveClass("sr-only");
    expect(status.nextElementSibling?.tagName).toBe("MAIN");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
  });

  it("keeps exactly one main landmark", () => {
    render(<GlobalLoading />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
