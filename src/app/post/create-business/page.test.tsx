import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateBusinessPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";

type MockAuthState = {
  user: { id: string; email?: string | null } | null;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
};

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => MockAuthState>(() => ({ user: null, profile: null, isLoading: false })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-business"),
  useSearchParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("test-csrf-token"),
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
}));

vi.mock("@/lib/utils/upload-preflight", () => ({
  checkUploadServiceReachable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 5,
  usePlanCoverVideoAllowed: () => true,
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label, onChange }: { label: string; onChange?: (files: File[]) => void }) => {
    const normalizedLabel = label.toLowerCase();
    const isThumbnail = normalizedLabel.includes("thumbnail");
    const isVideo = normalizedLabel.includes("video") && !isThumbnail;
    const createFile = (name: string, type: string) => new File(["mock"], name, { type });
    const files =
      normalizedLabel.includes("profile photos") || normalizedLabel.includes("mall photos")
        ? [createFile("photo-1.png", "image/png"), createFile("photo-2.png", "image/png")]
        : [
            createFile(
              isVideo ? "clip.mp4" : isThumbnail ? "thumb.png" : "image.png",
              isVideo ? "video/mp4" : "image/png"
            ),
          ];

    return (
      <button type="button" onClick={() => onChange?.(files)}>
        {label}
      </button>
    );
  },
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
  getTownsForCity: () => [],
}));

vi.mock("@/components/business/layouts/business-layout-router", () => ({
  BusinessLayoutRouter: ({ business }: { business: { business_name: string } }) => (
    <div data-testid="layout-router">{business.business_name}</div>
  ),
}));

describe("CreateBusinessPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());
    global.URL.createObjectURL = vi.fn(() => "blob:business-media-preview");
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  async function selectBusinessType(name: RegExp) {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name }));
    });
  }

  function fillCoreBusinessFields({
    businessName = "Nomsa Fashion",
    slug = "nomsa-fashion",
    category = "fashion_accessories",
  } = {}) {
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: businessName },
    });
    fireEvent.change(screen.getByLabelText(/URL Slug/i), {
      target: { value: slug },
    });
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === category);
    if (!catDef) throw new Error(`Unknown test category: ${category}`);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(catDef.label, "i") }));
  }

  function fillStandaloneStepOneDetails() {
    fireEvent.change(screen.getByLabelText(/Street address/i), {
      target: { value: "24 Vilakazi Street" },
    });
    fireEvent.change(screen.getByLabelText(/Suburb/i), {
      target: { value: "Orlando West" },
    });
  }

  function fillOnlineOnlyStepOneDetails() {
    fireEvent.change(screen.getByLabelText(/Primary order channel/i), {
      target: { value: "website" },
    });
    fireEvent.change(screen.getByLabelText(/Order URL/i), {
      target: { value: "https://orders.example.com" },
    });
  }

  async function completeStandaloneStepOne() {
    await selectBusinessType(/Own Premises/i);
    fillCoreBusinessFields();
    fillStandaloneStepOneDetails();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  function completeLocationStep() {
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
    };
  }

  it.each([
    [/Mall Store/i, /Store Number/i],
    [/Own Premises/i, /Street address/i],
    [/Home Business/i, /Service suburb/i],
    [/Mobile Service/i, /Service Areas/i],
    [/Online Only/i, /Primary order channel/i],
    [/Market Stall/i, /Market name/i],
  ])("renders type-specific fields immediately on step 1 for %s", async (typeName, fieldLabel) => {
    render(<CreateBusinessPage />);

    await selectBusinessType(typeName);

    expect(screen.getByLabelText(fieldLabel)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("switching business types replaces fields and clears stale type-specific errors", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Own Premises/i);
    fillCoreBusinessFields();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Street address is required.")).toBeInTheDocument();
    expect(await screen.findByText("Suburb is required.")).toBeInTheDocument();

    await selectBusinessType(/Online Only/i);

    expect(await screen.findByLabelText(/Primary order channel/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText(/Street address/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Street address is required.")).not.toBeInTheDocument();
      expect(screen.queryByText("Suburb is required.")).not.toBeInTheDocument();
    });
  });

  it("requires store number for mall stores on step 1", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Mall Store/i);
    fillCoreBusinessFields({ businessName: "Mall Biz", slug: "mall-biz" });
    fireEvent.change(screen.getByLabelText(/Mall name/i), {
      target: { value: "Maponya Mall" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Store number is required for mall stores.")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("requires mall name for mall stores on step 1", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Mall Store/i);
    fillCoreBusinessFields({ businessName: "Mall Biz", slug: "mall-biz" });
    fireEvent.change(screen.getByLabelText(/Store Number/i), {
      target: { value: "12A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Mall name is required.")).toBeInTheDocument();
  });

  it("requires service areas for mobile services on step 1", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Mobile Service/i);
    fillCoreBusinessFields({
      businessName: "FixFast",
      slug: "fixfast",
      category: "trade_maintenance",
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Add at least one service area.")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("allows online-only businesses to continue without delivery-region details", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Online Only/i);
    fillCoreBusinessFields({
      businessName: "Mzansi Online",
      slug: "mzansi-online",
      category: "electronics_tech",
    });
    fillOnlineOnlyStepOneDetails();

    expect(screen.getByLabelText(/No, delivery is not available/i)).toBeChecked();
    expect(screen.queryByLabelText(/Delivery areas/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
  });

  it("reveals online-only delivery areas only after delivery is enabled", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Online Only/i);
    fillCoreBusinessFields({
      businessName: "Mzansi Online",
      slug: "mzansi-online",
      category: "electronics_tech",
    });
    fillOnlineOnlyStepOneDetails();

    expect(screen.queryByLabelText(/Delivery areas/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Yes, this business offers delivery/i));

    expect(screen.getByLabelText(/Delivery areas/i)).toBeInTheDocument();
  });

  it("step 2 no longer renders the business type details block", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();

    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Street address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Walk-in policy/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Province/i)).toBeInTheDocument();
  });

  it("progresses through the wizard and shows the review step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    expect(screen.getByText(/Profile preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
  });

  it("does not submit while advancing into the media review step", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByText("Business logo (optional)")).toBeInTheDocument();
    expect(screen.getByText("Cover photo (optional)")).toBeInTheDocument();
    expect(screen.getByText(/Profile photos \(up to 5\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Promo video \(optional\)/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits successfully without any media uploads", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const submitCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(submitCall[0]).toBe("/api/businesses");

    const payload = JSON.parse(submitCall[1].body as string);
    expect(payload.logo_url).toBeUndefined();
    expect(payload.cover_photo).toBeUndefined();
    expect(payload.gallery_photos).toBeUndefined();
    expect(payload.cover_video).toBeUndefined();
    expect(payload.video_thumbnail).toBeUndefined();
  });

  it("submits selected business media only after uploads succeed", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        jsonResponse({ urls: ["https://media.verifymzansi.com/media/business_logo/user/logo.png"] })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          urls: ["https://media.verifymzansi.com/media/business_cover/user/cover.png"],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          urls: [
            "https://media.verifymzansi.com/media/business_gallery/user/photo-1.png",
            "https://media.verifymzansi.com/media/business_gallery/user/photo-2.png",
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: "Business logo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cover photo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: /Profile photos \(up to 5\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    const submitCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[3];
    expect(submitCall[0]).toBe("/api/businesses");

    const payload = JSON.parse(submitCall[1].body as string);
    expect(payload.logo_url).toBe(
      "https://media.verifymzansi.com/media/business_logo/user/logo.png"
    );
    expect(payload.cover_photo).toBe(
      "https://media.verifymzansi.com/media/business_cover/user/cover.png"
    );
    expect(payload.gallery_photos).toEqual([
      "https://media.verifymzansi.com/media/business_gallery/user/photo-1.png",
      "https://media.verifymzansi.com/media/business_gallery/user/photo-2.png",
    ]);
  });

  it("blocks submission when a selected image upload fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: "Failed to upload media" }, { ok: false, status: 500 })
    );

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: "Business logo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(
      await screen.findByText("Business logo upload failed. Retry the selected image.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Selected business media could not be uploaded. Retry the highlighted files and try again."
      )
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("blocks submission when profile photo upload returns partial success", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(
        {
          urls: ["https://media.verifymzansi.com/media/business_gallery/user/photo-1.png"],
          errors: ['"photo-2.png": upload failed'],
        },
        { ok: true, status: 207 }
      )
    );

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: /Profile photos \(up to 5\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(
      await screen.findByText(
        "One or more profile photos failed to upload. Retry the selected files."
      )
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks submission when a selected promo video upload fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        jsonResponse({
          uploadUrl: "https://upload.example.com/business-video",
          publicUrl: "https://media.verifymzansi.com/media/business_cover/user/video.mp4",
        })
      )
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: /Promo video \(optional\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(
      await screen.findByText("Promo video upload failed. Retry the selected file.")
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("renders subtype-specific details in the shared review preview", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Home Business/i);
    fillCoreBusinessFields({
      businessName: "Nomsa Home Studio",
      slug: "nomsa-home-studio",
      category: "health_beauty",
    });
    fireEvent.change(screen.getByLabelText(/Service suburb/i), {
      target: { value: "Noordwyk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    completeLocationStep();

    expect(screen.getByText(/Profile preview/i)).toBeInTheDocument();
    expect(screen.getByText("Nomsa Home Studio")).toBeInTheDocument();
  });

  it("blocks final submit when step-3 optional social URLs are invalid", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    const details = screen.getByText("Optional extras").closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Optional extras"));
    fireEvent.change(screen.getByPlaceholderText("Facebook URL"), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(screen.getByText("Enter a valid Facebook URL.")).toBeInTheDocument();
    expect(screen.getByText("Please fix the highlighted fields.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
  });

  it("keeps optional extras collapsed by default on the review step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    const details = screen.getByText("Optional extras").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("shows an inline slug error when the API rejects a duplicate slug", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Business slug already in use",
        reason: "Choose a different URL slug for this business.",
        details: { slug: "This URL slug is already taken." },
      }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(await screen.findByText("This URL slug is already taken.")).toBeInTheDocument();
    expect(screen.getByText("Choose a different URL slug for this business.")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the submitted-for-review state after redirecting to the dashboard", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Business submitted for review.", variant: "success" })
      );
    });
    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/listings?area=MZANSI_BUSINESS&created=business"
    );
  });

  it("submits online-only delivery areas only when delivery is enabled and hides the duplicate step-3 prompt", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await selectBusinessType(/Online Only/i);
    fillCoreBusinessFields({
      businessName: "Mzansi Online",
      slug: "mzansi-online",
      category: "electronics_tech",
    });
    fillOnlineOnlyStepOneDetails();
    fireEvent.click(screen.getByLabelText(/Yes, this business offers delivery/i));
    fireEvent.change(screen.getByLabelText(/Delivery areas/i), {
      target: { value: "Johannesburg, Pretoria" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    completeLocationStep();

    expect(screen.queryByText(/^Delivery Service$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const submitCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(submitCall[1].body as string);

    expect(payload.delivery_options).toEqual(["delivery"]);
    expect(payload.business_details).toMatchObject({
      type: "online_only",
      primary_order_channel: "website",
      order_url: "https://orders.example.com",
      delivery_regions: ["Johannesburg", "Pretoria"],
    });
  });

  describe("draft restore", () => {
    const DRAFT_USER_ID = "user-draft-biz-123";

    function seedDraft(overrides: Record<string, unknown> = {}) {
      const data = {
        businessType: "mall_store",
        businessName: "Saved Boutique",
        slug: "saved-boutique",
        slugManual: false,
        description: "A saved business description that is long enough to pass validation.",
        category: "fashion",
        province: "Gauteng",
        city: "Johannesburg",
        locationTown: "",
        locationAddress: "",
        storeNumber: "",
        serviceAreasInput: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        hoursMonFri: "",
        hoursSat: "",
        hoursSun: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
        servicesInput: "",
        services: [],
        paymentMethods: [],
        deliveryOptions: [],
        businessDetails: null,
        selectedLayout: "",
        ...overrides,
      };
      localStorage.setItem(
        `vm-draft:business:${DRAFT_USER_ID}`,
        JSON.stringify({ v: 1, savedAt: Date.now(), step: 0, data })
      );
    }

    beforeEach(() => {
      useAuthMock.mockReturnValue({
        user: { id: DRAFT_USER_ID, email: "draft@test.com" },
        profile: null,
        isLoading: false,
      });
    });

    it("restores business name from a saved draft and shows a toast", async () => {
      seedDraft();
      render(<CreateBusinessPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Business Name *")).toHaveValue("Saved Boutique");
      });
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft restored" }));
    });

    it("clears restored fields when discard draft is clicked", async () => {
      seedDraft();
      render(<CreateBusinessPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Business Name *")).toHaveValue("Saved Boutique");
      });

      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

      expect(screen.getByLabelText("Business Name *")).toHaveValue("");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });
  });
});
