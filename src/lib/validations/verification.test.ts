import { describe, expect, it } from "vitest";
import {
  verificationPhoneSchema,
  verificationOtpSchema,
  verificationIdDocSchema,
  verificationSelfieSchema,
  verificationLocationSchema,
  buyerVerifySchema,
  fileUploadSchema,
  validateUploadedFile,
  dsarRequestSchema,
  MAX_FILE_SIZE_BYTES,
} from "./verification";

// ── Phone Schema ────────────────────────────────────────────────────────────

describe("verificationPhoneSchema", () => {
  it("accepts valid SA phone", () => {
    expect(verificationPhoneSchema.safeParse({ phone: "+27812345678" }).success).toBe(true);
  });

  it("rejects invalid phone", () => {
    expect(verificationPhoneSchema.safeParse({ phone: "12345" }).success).toBe(false);
  });
});

// ── OTP Schema ──────────────────────────────────────────────────────────────

describe("verificationOtpSchema", () => {
  it("accepts valid phone + OTP", () => {
    expect(
      verificationOtpSchema.safeParse({
        phone: "+27812345678",
        otp: "123456",
      }).success
    ).toBe(true);
  });

  it("rejects invalid OTP", () => {
    expect(
      verificationOtpSchema.safeParse({
        phone: "+27812345678",
        otp: "abc",
      }).success
    ).toBe(false);
  });
});

// ── ID Doc Schema ───────────────────────────────────────────────────────────

describe("verificationIdDocSchema", () => {
  it("accepts valid ID doc submission", () => {
    const result = verificationIdDocSchema.safeParse({
      idNumber: "8001015009087",
      firstName: "Test",
      lastName: "User",
      idDocumentUrl: "https://r2.example.com/file.jpg",
      idDocumentType: "sa_id",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid ID number", () => {
    expect(
      verificationIdDocSchema.safeParse({
        idNumber: "1234",
        idDocumentUrl: "https://example.com/f.jpg",
        idDocumentType: "sa_id",
      }).success
    ).toBe(false);
  });
});

// ── Selfie Schema ───────────────────────────────────────────────────────────

describe("verificationSelfieSchema", () => {
  it("accepts valid selfie URL", () => {
    expect(
      verificationSelfieSchema.safeParse({
        selfieUrl: "https://r2.example.com/selfie.jpg",
      }).success
    ).toBe(true);
  });

  it("rejects non-URL", () => {
    expect(verificationSelfieSchema.safeParse({ selfieUrl: "not-a-url" }).success).toBe(false);
  });
});

// ── Location Schema ─────────────────────────────────────────────────────────

describe("verificationLocationSchema", () => {
  it("accepts valid location", () => {
    expect(
      verificationLocationSchema.safeParse({
        province: "gauteng",
        city: "Johannesburg",
        latitude: -26.2,
        longitude: 28.0,
      }).success
    ).toBe(true);
  });

  it("rejects missing province", () => {
    expect(
      verificationLocationSchema.safeParse({
        province: "",
        city: "Cape Town",
      }).success
    ).toBe(false);
  });

  it("rejects latitude outside SA bounds", () => {
    expect(
      verificationLocationSchema.safeParse({
        province: "gauteng",
        city: "Jozi",
        latitude: 50,
        longitude: 28,
      }).success
    ).toBe(false);
  });
});

// ── Buyer Verify Schema ─────────────────────────────────────────────────────

describe("buyerVerifySchema", () => {
  it("accepts valid input", () => {
    expect(
      buyerVerifySchema.safeParse({
        accountProfileId: "550e8400-e29b-41d4-a716-446655440000",
        turnstileToken: "tok",
      }).success
    ).toBe(true);
  });

  it("rejects non-UUID", () => {
    expect(
      buyerVerifySchema.safeParse({
        accountProfileId: "abc",
        turnstileToken: "tok",
      }).success
    ).toBe(false);
  });
});

// ── File Upload Schema ──────────────────────────────────────────────────────

describe("fileUploadSchema", () => {
  it("accepts valid doc types", () => {
    for (const t of ["id_document", "selfie", "proof_of_address"]) {
      expect(fileUploadSchema.safeParse({ docType: t }).success).toBe(true);
    }
  });

  it("rejects invalid doc type", () => {
    expect(fileUploadSchema.safeParse({ docType: "other" }).success).toBe(false);
  });
});

// ── validateUploadedFile ────────────────────────────────────────────────────

describe("validateUploadedFile", () => {
  it("accepts valid JPEG image within size limit", () => {
    const result = validateUploadedFile({
      size: 1024 * 1024,
      type: "image/jpeg",
      name: "photo.jpg",
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts PNG and WebP", () => {
    expect(validateUploadedFile({ size: 1000, type: "image/png", name: "a.png" }).valid).toBe(true);
    expect(validateUploadedFile({ size: 1000, type: "image/webp", name: "a.webp" }).valid).toBe(
      true
    );
  });

  it("rejects files exceeding size limit", () => {
    const result = validateUploadedFile({
      size: MAX_FILE_SIZE_BYTES + 1,
      type: "image/jpeg",
      name: "big.jpg",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain("maximum size");
  });

  it("rejects empty files", () => {
    const result = validateUploadedFile({
      size: 0,
      type: "image/jpeg",
      name: "empty.jpg",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain("empty");
  });

  it("rejects disallowed file types", () => {
    const result = validateUploadedFile({
      size: 1000,
      type: "application/exe",
      name: "malware.exe",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain("not allowed");
  });

  it("rejects PDF when allowPdf is false", () => {
    const result = validateUploadedFile({
      size: 1000,
      type: "application/pdf",
      name: "doc.pdf",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts PDF when allowPdf is true", () => {
    const result = validateUploadedFile(
      { size: 1000, type: "application/pdf", name: "doc.pdf" },
      { allowPdf: true }
    );
    expect(result.valid).toBe(true);
  });

  it("rejects files whose extension does not match the declared MIME type", () => {
    const result = validateUploadedFile({
      size: 1000,
      type: "image/jpeg",
      name: "renamed.png",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain("extension does not match");
  });

  it("accepts uppercase extensions after normalization", () => {
    const result = validateUploadedFile({
      size: 1000,
      type: "image/jpeg",
      name: "PHOTO.JPG",
    });
    expect(result.valid).toBe(true);
  });
});

// ── DSAR Request Schema ─────────────────────────────────────────────────────

describe("dsarRequestSchema", () => {
  const valid = {
    type: "access" as const,
    name: "Jane Doe",
    email: "jane@test.com",
    idNumber: "8001015009087",
  };

  it("accepts valid DSAR request", () => {
    expect(dsarRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all request types", () => {
    for (const t of ["access", "correction", "deletion", "objection"]) {
      expect(dsarRequestSchema.safeParse({ ...valid, type: t }).success).toBe(true);
    }
  });

  it("rejects invalid email", () => {
    expect(dsarRequestSchema.safeParse({ ...valid, email: "bad" }).success).toBe(false);
  });

  it("rejects short name", () => {
    expect(dsarRequestSchema.safeParse({ ...valid, name: "J" }).success).toBe(false);
  });

  it("rejects invalid ID number", () => {
    expect(dsarRequestSchema.safeParse({ ...valid, idNumber: "123" }).success).toBe(false);
  });

  it("rejects all-zeros ID (invalid DOB)", () => {
    expect(dsarRequestSchema.safeParse({ ...valid, idNumber: "0000000000000" }).success).toBe(
      false
    );
  });

  it("rejects ID with impossible month (month=13)", () => {
    expect(dsarRequestSchema.safeParse({ ...valid, idNumber: "8013015009087" }).success).toBe(
      false
    );
  });

  it("accepts optional details", () => {
    expect(
      dsarRequestSchema.safeParse({
        ...valid,
        details: "I need a copy of my data.",
      }).success
    ).toBe(true);
  });

  it("rejects details exceeding max length", () => {
    expect(
      dsarRequestSchema.safeParse({
        ...valid,
        details: "x".repeat(2001),
      }).success
    ).toBe(false);
  });
});
