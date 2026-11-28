import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BusinessContactFields,
  readContactMethods,
  selectedContacts,
} from "./business-contact-fields";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const verified = { phone: "0821234567", whatsapp: "0821234567", website: "" };

describe("readContactMethods", () => {
  it("starts Call and WhatsApp on when there is a verified number", () => {
    expect(readContactMethods(undefined, verified)).toEqual(["call", "whatsapp"]);
    expect(readContactMethods(undefined, { ...verified, phone: "", whatsapp: "" })).toEqual([]);
  });

  it("keeps the stored choice, drops numbers it cannot publish and adds a filled website", () => {
    expect(readContactMethods(["whatsapp", "form", "website"], verified)).toEqual([
      "whatsapp",
      "form",
    ]);
    expect(
      readContactMethods(["call", "form"], { phone: "", whatsapp: "", website: "https://a.co.za" })
    ).toEqual(["form", "website"]);
  });

  it("publishes only the numbers of switched-on methods", () => {
    expect(selectedContacts(["call"], verified)).toEqual({
      phone: "0821234567",
      whatsapp: "",
      website: "",
    });
  });
});

describe("BusinessContactFields", () => {
  it("shows switches with the verified number masked and nothing to type", () => {
    const onMethods = vi.fn();
    render(
      <BusinessContactFields
        methods={["call", "whatsapp", "website"]}
        verifiedPhone="0821234567"
        onMethods={onMethods}
        errors={{}}
      />
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Call" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "WhatsApp" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "VerifyMzansi inbox" })).not.toBeChecked();
    expect(screen.getByText("Enquiries arrive in your account")).toBeInTheDocument();
    expect(screen.getAllByText(/Your verified number 08/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("switch", { name: "VerifyMzansi inbox" }));
    expect(onMethods).toHaveBeenCalledWith(["call", "whatsapp", "form"]);
  });

  it("disables Call and WhatsApp without a verified number and shows the error", () => {
    render(
      <BusinessContactFields
        methods={[]}
        verifiedPhone={null}
        onMethods={vi.fn()}
        errors={{ contact_methods: "Choose at least one contact method." }}
      />
    );
    expect(screen.getByRole("switch", { name: "Call" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "WhatsApp" })).toBeDisabled();
    expect(screen.getByText("Choose at least one contact method.")).toBeInTheDocument();
  });
});
