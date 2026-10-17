import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PackageRulesNote } from "./package-rules-note";
it("shows only currently enforced rules on source edit screens", () => {
  render(<PackageRulesNote kind="listing" />);
  expect(screen.getByText(/up to 2 approved edits/)).toBeInTheDocument();
  expect(screen.queryByText(/one price change a day/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/90 days: 6/)).not.toBeInTheDocument();
});
it("requires explicit foundation selection for the agreed expanded allowances", () => {
  render(<PackageRulesNote kind="listing" policy="foundation" />);
  expect(screen.getByText(/90 days: 6/)).toBeInTheDocument();
  expect(screen.getByText(/One price change a day/)).toBeInTheDocument();
});
