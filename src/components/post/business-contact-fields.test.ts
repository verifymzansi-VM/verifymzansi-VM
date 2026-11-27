import { describe, expect, it } from "vitest";
import { readContactMethods, selectedContacts } from "./business-contact-fields";

const values = { phone: "0821234567", whatsapp: "", website: "" };

describe("business contact methods", () => {
  it("never offers or keeps email as a contact method", () => {
    expect(readContactMethods(["call", "email", "form"], values)).toEqual(["call", "form"]);
    expect(readContactMethods(undefined, values)).toEqual(["call"]);
    expect(selectedContacts(["call", "email"], values)).not.toHaveProperty("email");
  });
});
