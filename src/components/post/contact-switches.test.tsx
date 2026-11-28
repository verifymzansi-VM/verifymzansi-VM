import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContactSwitches } from "./contact-switches";

const OPTIONS = [
  { id: "call", label: "Call", usesVerifiedNumber: true },
  { id: "whatsapp", label: "WhatsApp", usesVerifiedNumber: true },
  { id: "in_app", label: "Private enquiry", locked: true },
] as const;

describe("ContactSwitches", () => {
  it("shows the verified number masked and switches a method on and off", () => {
    const onChange = vi.fn();
    render(
      <ContactSwitches
        id="contacts"
        options={OPTIONS}
        selected={["call", "in_app"]}
        onChange={onChange}
        verifiedPhone="+27821234567"
      />
    );
    expect(screen.getAllByText("Your verified number 08• ••• 4567")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Call" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Private enquiry" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "WhatsApp" }));
    expect(onChange).toHaveBeenCalledWith(["call", "in_app", "whatsapp"]);
    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    expect(onChange).toHaveBeenLastCalledWith(["in_app"]);
  });

  it("keeps Call and WhatsApp off without a verified number", () => {
    render(
      <ContactSwitches
        id="contacts"
        options={OPTIONS}
        selected={["call"]}
        onChange={() => {}}
        verifiedPhone={null}
      />
    );
    expect(screen.getByRole("switch", { name: "Call" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Call" })).toBeDisabled();
    expect(screen.getAllByRole("link", { name: "Verify a number" })).toHaveLength(2);
  });
});
