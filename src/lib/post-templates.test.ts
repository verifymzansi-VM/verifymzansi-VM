import { describe, expect, it } from "vitest";
import {
  formFieldsFromTemplate,
  postTemplateData,
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
});
