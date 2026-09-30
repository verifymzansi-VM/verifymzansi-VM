import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateBusinessPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";

type MockAuthState = {
  user: { id: string; email?: string | null } | null;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
};

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => MockAuthState>(() => ({ user: null, profile: null, isLoading: false })),
}));
const { businessLayoutRouterSpy } = vi.hoisted(() => ({
  businessLayoutRouterSpy: vi.fn(),
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

vi.mock("@/lib/media/compress-before-upload", () => ({
  compressVideoForUpload: vi.fn(async (file: File) => file),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
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
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({
    label,
    error,
    onChange,
  }: {
    label: string;
    error?: string;
    onChange?: (files: File[]) => void;
  }) => {
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
      <div>
        <button type="button" onClick={() => onChange?.(files)}>
          {label}
        </button>
        {error ? <p>{error}</p> : null}
      </div>
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
  BusinessLayoutRouter: (props: {
    business: { business_name: string };
    layoutMode?: "public" | "review";
  }) => {
    businessLayoutRouterSpy(props);
    return <div data-testid="layout-router">{props.business.business_name}</div>;
  },
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

  function acceptBusinessTerms() {
    fireEvent.click(screen.getByLabelText(/I accept the VerifyMzansi posting terms/i));
  }

  function fillCoreBusinessFields({
    businessName = "Nomsa Fashion",
    slug = "nomsa-fashion",
    category = "fashion_accessories",
  } = {}) {
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: businessName },
    });
    fireEvent.change(screen.getByLabelText(/^Custom profile link/i), {
      target: { value: slug },
    });
    // Description is required (min 20 chars) since the create-flow unification.
    fireEvent.change(screen.getByLabelText(/About Your Business/i), {
      target: { value: "A proudly South African business serving our local community." },
    });
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === category);
    if (!catDef) throw new Error(`Unknown test category: ${category}`);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(catDef.label, "i") }));
  }

  async function completeStandaloneStepOne() {
    fillCoreBusinessFields();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next" })));
  }

  async function completeAccessStep() {
    fireEvent.click(screen.getByRole("checkbox", { name: "Customers visit me" }));
    fireEvent.change(screen.getByLabelText(/Where do customers visit you/), {
      target: { value: "standalone_shop" },
    });
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City or town$/i), {
      target: { value: "Johannesburg" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next" })));
    fireEvent.click(screen.getByRole("checkbox", { name: "Phone calls" }));
    fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: "0821234567" } });
  }

  async function completeLocationStep() {
    await completeAccessStep();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next" })));
  }

  function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
    };
  }

  it("asks about the business before customer access", async () => {
    render(<CreateBusinessPage />);
    expect(
      screen.getByRole("group", { name: /What does your business mainly do/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Customers visit me" })).not.toBeInTheDocument();
    await completeStandaloneStepOne();
    expect(screen.getByRole("checkbox", { name: "Customers visit me" })).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument();
  });

  it("preselects a category-specific link", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("category=beauty_personal")
    );
    render(<CreateBusinessPage />);
    expect(screen.getByRole("button", { name: /Beauty & Personal Care/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("retains an ambiguous legacy category until the owner chooses", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("category=health_beauty")
    );
    render(<CreateBusinessPage />);
    expect(
      screen.getByText(/previous category; choose a more specific category/)
    ).toBeInTheDocument();
  });

  it("requires service areas when the business travels to customers", async () => {
    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    fireEvent.click(screen.getByRole("checkbox", { name: "I travel to customers" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Add at least one service area.").length).toBeGreaterThan(0);
  });

  it("allows online consulting without a physical address or checkout URL", async () => {
    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    fireEvent.click(screen.getByRole("checkbox", { name: "I sell or provide services online" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Order URL/)).not.toBeInTheDocument();
  });

  it("progresses through the wizard and shows the review step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();

    expect(screen.getByText(/Profile preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    expect(businessLayoutRouterSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: "review" })
    );
  });

  it("does not submit while advancing into the media review step", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();

    expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    expect(screen.getByText("Business logo (optional)")).toBeInTheDocument();
    expect(screen.getByText("Cover photo (optional)")).toBeInTheDocument();
    expect(screen.getByText(/Profile photos \(up to 5\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Video \(optional\)/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits successfully without any media uploads", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

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
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Business logo (optional)" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cover photo (optional)" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Profile photos \(up to 5\)/i }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((call) => call[0] === "/api/businesses")).toBe(true);
    });

    const submitCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "/api/businesses"
    );
    expect(submitCall).toBeDefined();
    if (!submitCall) {
      throw new Error("Expected /api/businesses submission call");
    }
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
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Business logo (optional)" }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    expect(
      (await screen.findAllByText("Business logo upload failed. Retry the selected image.")).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Selected business media could not be uploaded. Retry the highlighted files and try again."
      ).length
    ).toBeGreaterThan(0);
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
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Profile photos \(up to 5\)/i }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    expect(
      (
        await screen.findAllByText(
          "One or more profile photos failed to upload. Retry the selected files."
        )
      ).length
    ).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("maps business image upload network failures back to the media step", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Business logo (optional)" }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    await waitFor(
      () => {
        expect(
          screen.getAllByText(
            "We couldn't reach the upload service. Check your connection and try again."
          ).length
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText(
            "Selected business media could not be uploaded. Retry the highlighted files and try again."
          ).length
        ).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("starts uploads without waiting for the preflight check to finish", async () => {
    (checkUploadServiceReachable as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise(() => undefined)
    );
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          return jsonResponse({
            urls: ["https://media.verifymzansi.com/media/business_logo/user/logo.png"],
            errors: [],
          });
        }

        if (input === "/api/businesses") {
          return jsonResponse({ success: true, business: { id: "biz-1" } }, { status: 201 });
        }

        return jsonResponse({});
      }
    );

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Business logo \(optional\)/i }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/media/upload",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("marks photos complete while video is pending and ignores repeated submit events", async () => {
    let finishVideo!: (response: ReturnType<typeof jsonResponse>) => void;
    const videoResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      finishVideo = resolve;
    });
    const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/media/upload") {
        const file = (init?.body as FormData).get("files") as File;
        if (file.type.startsWith("video/")) return videoResponse;
        return jsonResponse({ urls: ["https://media.verifymzansi.com/photo.png"] });
      }
      if (input === "/api/businesses") return jsonResponse({ success: true });
      return jsonResponse({});
    });
    global.fetch = calls as unknown as typeof fetch;
    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    await completeLocationStep();
    fireEvent.click(screen.getByRole("button", { name: "Cover photo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: /Video \(optional\)/i }));
    acceptBusinessTerms();
    const form = screen.getByRole("button", { name: /Submit for review/i }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(await screen.findByText("Photos uploaded")).toBeInTheDocument();
    expect(screen.getByText("Preparing and verifying video...")).toBeInTheDocument();
    expect(calls.mock.calls.filter(([input]) => input === "/api/businesses")).toHaveLength(0);
    await act(async () => {
      finishVideo(jsonResponse({ urls: ["https://media.verifymzansi.com/video.mp4"] }));
    });
    await waitFor(() =>
      expect(calls.mock.calls.filter(([input]) => input === "/api/businesses")).toHaveLength(1)
    );
    expect(calls.mock.calls.filter(([input]) => input === "/api/media/upload")).toHaveLength(2);
  });

  it("uploads promo video through the validated server upload path", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          return jsonResponse({
            urls: ["https://media.verifymzansi.com/media/business_cover/user/video-fallback.mp4"],
          });
        }

        if (input === "/api/businesses") {
          return jsonResponse({ success: true, business: { id: "biz-1" } }, { status: 201 });
        }

        return jsonResponse({});
      }
    );

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Video \(optional\)/i }));
    });
    acceptBusinessTerms();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/businesses",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"cover_video":"https://media.verifymzansi.com/media/business_cover/user/video-fallback.mp4"'
          ),
        })
      );
    });

    expect(screen.queryByText("Promo video upload failed. Retry the selected file.")).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/listings?area=MZANSI_BUSINESS&created=business"
    );
  });

  it("reviews the structured customer access choices", async () => {
    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    await completeLocationStep();
    expect(businessLayoutRouterSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        business: expect.objectContaining({
          category_details: expect.objectContaining({
            customer_access: expect.objectContaining({ methods: ["visit"] }),
          }),
        }),
      })
    );
  });

  it("blocks advancing and final submit when optional social URLs are invalid", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeAccessStep();

    // Social links sit in the always-visible section on Step 3 (Contact).
    expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Facebook (Optional)"), {
      target: { value: "not-a-url" },
    });

    // Invalid social URL blocks advancing from Step 2.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(screen.getAllByText("Enter a valid Facebook URL.").length).toBeGreaterThan(0);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Please fix 1 field on Step 3"))).toBe(
      true
    );
    expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows website, social media and location pin fields openly on the contact step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeAccessStep();

    expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    expect(screen.queryByText("Optional extras")).not.toBeInTheDocument();
    expect(screen.getByText("Website, social media & location pin")).toBeVisible();
    for (const name of ["Website", "Facebook", "Instagram", "X (Twitter)", "TikTok"]) {
      const label = `${name} (Optional)`;
      expect(screen.getByLabelText(label)).toBeVisible();
    }
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
    await completeLocationStep();
    acceptBusinessTerms();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect((await screen.findAllByText("This URL slug is already taken.")).length).toBeGreaterThan(
      0
    );
    expect(screen.getByText(/Please fix 1 field on Step 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 4/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("maps API 422 photo-limit errors to business media field errors", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "Maximum 5 gallery photos allowed on your plan" }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(
      (await screen.findAllByText("Maximum 5 gallery photos allowed on your plan")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("maps API 422 video-limit errors to business media field errors", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "Video upload is not available on your current plan." }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(
      (await screen.findAllByText("Video upload is not available on your current plan.")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("redirects to complete profile when API returns phone-gate 403 redirectUrl", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ redirectUrl: "/dashboard/complete-profile" }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/complete-profile");
    });
  });

  it("shows plan-limit reason when API returns 403 reason", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ reason: "You reached your plan posting limit." }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(screen.getByText("You reached your plan posting limit.")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("offers a sign-in link back to this page when the session expired (401)", async () => {
    window.history.pushState({}, "", "/post/create-business");
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `/login?returnUrl=${encodeURIComponent("/post/create-business")}`
    );
    expect(screen.getByText(/re-attach your photos and videos/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });

  it("does not follow an off-site server redirectUrl", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ redirectUrl: "https://evil.example/phish" }),
    });

    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
    });
    expect(mockPush).not.toHaveBeenCalledWith("https://evil.example/phish");
  });

  it("keeps the submitted-for-review state after redirecting to the dashboard", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    await completeLocationStep();
    acceptBusinessTerms();

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

  it("keeps delivery areas separate from online customer access", async () => {
    render(<CreateBusinessPage />);
    await completeStandaloneStepOne();
    fireEvent.click(screen.getByRole("checkbox", { name: "I sell or provide services online" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I deliver orders" }));
    expect(screen.getByLabelText(/Delivery areas/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Delivery areas/), { target: { value: "Soweto" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I deliver orders" }));
    expect(screen.queryByLabelText(/Delivery areas/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "I deliver orders" }));
    expect(screen.getByLabelText(/Delivery areas/)).toHaveValue("Soweto");
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
        expect(screen.getByLabelText(/Business Name/)).toHaveValue("Saved Boutique");
      });
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft restored" }));
    });

    it("clears restored fields when discard draft is clicked", async () => {
      seedDraft();
      render(<CreateBusinessPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Business Name/)).toHaveValue("Saved Boutique");
      });

      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

      expect(screen.getByLabelText(/Business Name/)).toHaveValue("");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });
  });
});
