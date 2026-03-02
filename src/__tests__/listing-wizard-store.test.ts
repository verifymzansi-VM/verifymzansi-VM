import { describe, it, expect } from "vitest";
import { useListingWizardStore, STEP_ORDER } from "@/stores/listing-wizard-store";
import { act } from "@testing-library/react";

describe("listing-wizard-store", () => {
  beforeEach(() => {
    // Reset store between tests
    act(() => {
      useListingWizardStore.getState().reset();
    });
  });

  it("should start with default state", () => {
    const state = useListingWizardStore.getState();
    expect(state.currentStep).toBe("category");
    expect(state.draft).toEqual({});
    expect(state.imageFiles).toEqual([]);
    expect(state.isSubmitting).toBe(false);
  });

  it("should update step", () => {
    act(() => {
      useListingWizardStore.getState().setStep("details");
    });
    expect(useListingWizardStore.getState().currentStep).toBe("details");
  });

  it("should update draft incrementally", () => {
    act(() => {
      useListingWizardStore.getState().updateDraft({ title: "Test Listing" });
    });
    expect(useListingWizardStore.getState().draft.title).toBe("Test Listing");

    act(() => {
      useListingWizardStore.getState().updateDraft({ price_zar: 10000 });
    });
    expect(useListingWizardStore.getState().draft.title).toBe("Test Listing");
    expect(useListingWizardStore.getState().draft.price_zar).toBe(10000);
  });

  it("should manage image files", () => {
    const file1 = new File(["a"], "img1.jpg", { type: "image/jpeg" });
    const file2 = new File(["b"], "img2.jpg", { type: "image/jpeg" });

    act(() => {
      useListingWizardStore.getState().addImageFile(file1);
      useListingWizardStore.getState().addImageFile(file2);
    });
    expect(useListingWizardStore.getState().imageFiles).toHaveLength(2);

    act(() => {
      useListingWizardStore.getState().removeImageFile(0);
    });
    expect(useListingWizardStore.getState().imageFiles).toHaveLength(1);
    expect(useListingWizardStore.getState().imageFiles[0].name).toBe("img2.jpg");
  });

  it("should reset to initial state", () => {
    act(() => {
      useListingWizardStore.getState().setStep("review");
      useListingWizardStore.getState().updateDraft({ title: "Test" });
      useListingWizardStore.getState().setSubmitting(true);
    });

    act(() => {
      useListingWizardStore.getState().reset();
    });

    const state = useListingWizardStore.getState();
    expect(state.currentStep).toBe("category");
    expect(state.draft).toEqual({});
    expect(state.isSubmitting).toBe(false);
  });

  it("should have correct step order", () => {
    expect(STEP_ORDER).toEqual(["category", "details", "attributes", "images", "review"]);
  });
});
