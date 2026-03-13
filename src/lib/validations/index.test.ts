import { describe, it, expect } from "vitest";
import * as v from "./index";

describe("validations index barrel", () => {
  it("re-exports all validation modules", () => {
    // Shared schemas
    expect(v.saPhoneSchema).toBeDefined();
    expect(v.emailSchema).toBeDefined();
    expect(v.passwordSchema).toBeDefined();

    // Auth schemas
    expect(v.loginSchema).toBeDefined();
    expect(v.registerSchema).toBeDefined();

    // Listing schemas
    expect(v.listingSchema).toBeDefined();

    // Storefront schemas
    expect(v.storefrontSchema).toBeDefined();

    // Business schemas
    expect(v.businessProfileSchema).toBeDefined();

    // Verification schemas
    expect(v.verificationPhoneSchema).toBeDefined();
    expect(v.fileUploadSchema).toBeDefined();

    // Contact schemas
    expect(v.contactAccountHolderSchema).toBeDefined();
    expect(v.reportSchema).toBeDefined();
  });
});
