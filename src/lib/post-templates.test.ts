import { describe, expect, it } from "vitest";
import {
  formFieldsFromTemplate,
  parsePostTemplateList,
  postTemplateData,
  postTemplateName,
  templateDataFromForm,
  templateSummary,
} from "./post-templates";

const form = {
  category: "vehicles",
  condition: "used",
  categoryAttributes: {
    make: "Toyota",
    model: "Hilux",
    transmission: "manual",
    fuel_type: "diesel",
    year: "2019",
    mileage_km: "98000",
    colour: "",
  },
  description: " A clean bakkie. ",
  province: "gauteng",
  city: "johannesburg",
  town: "",
  address: "",
  contactMethods: ["call", "whatsapp", "in_app"],
};

describe("post templates", () => {
  it("keeps the plan's fields from the form, never the year, mileage or empty values", () => {
    const data = templateDataFromForm(form);
    expect(data).toEqual({
      category: "vehicles",
      condition: "used",
      categoryAttributes: {
        make: "Toyota",
        model: "Hilux",
        transmission: "manual",
        fuel_type: "diesel",
      },
      description: "A clean bakkie.",
      province: "gauteng",
      city: "johannesburg",
      contactMethods: ["call", "whatsapp", "in_app"],
    });
    expect(postTemplateData.parse(data)).toEqual(data);
  });

  it("refuses titles, prices, per-item details and numbers", () => {
    for (const extra of [
      { title: "Demo" },
      { price: "100" },
      { photos: [] },
      { categoryAttributes: { year: "2019" } },
      { categoryAttributes: { mileage_km: "1" } },
      { contactMethods: ["+27820000000"] },
    ])
      expect(postTemplateData.safeParse({ category: "vehicles", ...extra }).success).toBe(false);
  });

  it("fills the form back in, with the private enquiry button always on", () => {
    expect(formFieldsFromTemplate({ category: "electronics", contactMethods: ["call"] })).toEqual({
      category: "electronics",
      condition: "",
      categoryAttributes: {},
      description: "",
      province: "",
      city: "",
      town: "",
      address: "",
      contactMethods: ["call", "in_app"],
    });
    expect(formFieldsFromTemplate({ category: "electronics" }).contactMethods).toEqual([
      "call",
      "in_app",
    ]);
  });

  it("summarises a card as section, category and number of details", () => {
    expect(templateSummary(templateDataFromForm(form))).toBe("Market · Vehicles · 5 details");
    expect(templateSummary({ category: "electronics" })).toBe(
      "Market · Electronics & Tech · 0 details"
    );
  });

  it("leaves out price details and details of one item", () => {
    const data = templateDataFromForm({
      ...form,
      categoryAttributes: {
        make: "Toyota",
        colour: "White",
        number_of_owners: "1",
        levy_zar: "1200",
        monthly_rent_zar: "9000",
        quantity: "4",
      },
    });
    expect(data.categoryAttributes).toEqual({ make: "Toyota" });
    expect(
      postTemplateData.safeParse({ category: "property", categoryAttributes: { levy_zar: "1" } })
        .success
    ).toBe(false);
  });

  it("counts a name in characters as the database does", () => {
    expect(postTemplateName.safeParse("🚗".repeat(60)).success).toBe(true);
    expect(postTemplateName.safeParse("🚗".repeat(61)).success).toBe(false);
    expect(postTemplateName.safeParse("   ").success).toBe(false);
  });

  it("keeps the readable templates of a list and counts the others", () => {
    const good = {
      id: "00000000-0000-4000-8000-0000000000e1",
      kind: "listing",
      name: "Used bakkie",
      data: { category: "vehicles" },
      updated_at: "2026-11-21T10:00:00Z",
    };
    const parsed = parsePostTemplateList({
      package_running: true,
      templates: [good, { ...good, data: { category: "vehicles", price: "1" } }],
    });
    expect(parsed.templates).toEqual([good]);
    expect(parsed.dropped).toBe(1);
    expect(() => parsePostTemplateList({ templates: [] })).toThrow();
  });

  it("refuses control characters in names and the NUL character in data", () => {
    expect(postTemplateName.safeParse("Used\u0000bakkie").success).toBe(false);
    expect(postTemplateName.safeParse("Used\tbakkie").success).toBe(false);
    expect(postTemplateName.safeParse("Used\u0085bakkie").success).toBe(false);
    expect(
      postTemplateData.safeParse({ category: "vehicles", description: "a\u0000b" }).success
    ).toBe(false);
    expect(
      postTemplateData.safeParse({ category: "vehicles", categoryAttributes: { make: "\u0000" } })
        .success
    ).toBe(false);
    // New lines in a description are fine.
    expect(
      postTemplateData.safeParse({ category: "vehicles", description: "Line one\nLine two" })
        .success
    ).toBe(true);
  });
});
