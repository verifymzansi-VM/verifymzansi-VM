import { create } from "zustand";
import type { ListingInput } from "@/lib/validations/listing";

type WizardStep = "category" | "details" | "attributes" | "images" | "review";

/**
 * Partial draft of a listing being built through the wizard.
 * Uses Partial<ListingInput> for type-safe field access while allowing
 * incremental population across wizard steps.
 */
type ListingDraft = Partial<ListingInput>;

interface ListingWizardState {
  currentStep: WizardStep;
  draft: ListingDraft;
  imageFiles: File[];
  isSubmitting: boolean;

  setStep: (step: WizardStep) => void;
  updateDraft: (partial: ListingDraft) => void;
  setImageFiles: (files: File[]) => void;
  addImageFile: (file: File) => void;
  removeImageFile: (index: number) => void;
  setSubmitting: (submitting: boolean) => void;
  reset: () => void;
}

const STEP_ORDER: WizardStep[] = ["category", "details", "attributes", "images", "review"];

const MAX_WIZARD_IMAGES = 8;

export const useListingWizardStore = create<ListingWizardState>((set) => ({
  currentStep: "category",
  draft: {},
  imageFiles: [],
  isSubmitting: false,

  setStep: (currentStep) => set({ currentStep }),
  updateDraft: (partial) =>
    set((state) => ({ draft: { ...state.draft, ...partial } as ListingDraft })),
  setImageFiles: (imageFiles) => set({ imageFiles }),
  addImageFile: (file) =>
    set((state) => {
      if (state.imageFiles.length >= MAX_WIZARD_IMAGES) return state;
      return { imageFiles: [...state.imageFiles, file] };
    }),
  removeImageFile: (index) =>
    set((state) => ({
      imageFiles: state.imageFiles.filter((_, i) => i !== index),
    })),
  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  reset: () =>
    set({
      currentStep: "category",
      draft: {},
      imageFiles: [],
      isSubmitting: false,
    }),
}));

export { STEP_ORDER };
export type { WizardStep };
