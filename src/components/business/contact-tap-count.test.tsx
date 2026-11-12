/**
 * @vitest-environment jsdom
 */
// Contacting a business takes no more taps than contacting a Market seller
// (roadmap M10.8). Both post pages are rendered with their real contact card
// and sticky phone bar; each path is walked by tapping what a phone visitor
// sees first and counting every tap, starting with the card that opened the
// page. Typing in the form is not a tap. Following the sticky bar's "#contact"
// link only scrolls, so the next tap is on the contact card.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { UnifiedLayout } from "@/components/business/layouts/unified-layout";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));
vi.mock("@/app/listing/[id]/client", () => ({ ListingDetailClient: () => <div /> }));
vi.mock("@/components/ui/media-lightbox-lazy", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/profile-video-player", () => ({ ProfileVideoPlayer: () => <div /> }));
vi.mock("@/components/analytics/view-tracker", () => ({
  ViewTracker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/components/ui/turnstile-widget", () => ({
  // The site's test mode: the check passes without a visible widget.
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => {
    React.useEffect(() => onSuccess("token"), [onSuccess]);
    return null;
  },
}));
vi.mock("@/lib/utils/csrf-client", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

/** The bar fixed to the bottom of a phone screen (hidden from lg up). */
const stickyBar = () => {
  const bar = document.querySelector<HTMLElement>(".glass-panel.fixed");
  if (!bar) throw new Error("no sticky contact bar");
  return within(bar);
};

async function sendEnquiry(tap: (element: HTMLElement) => void, submitLabel: string) {
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Your name"), { target: { value: "Thabo Visitor" } });
  fireEvent.change(dialog.getByLabelText("Reply email"), {
    target: { value: "thabo@example.com" },
  });
  fireEvent.change(dialog.getByLabelText("Your message"), {
    target: { value: "Is this still available on Saturday?" },
  });
  await waitFor(() => expect(dialog.getByRole("button", { name: submitLabel })).toBeEnabled());
  tap(dialog.getByRole("button", { name: submitLabel }));
  await waitFor(() => expect(dialog.getByText("Enquiry saved!")).toBeInTheDocument());
}

function counter() {
  let taps = 1; // the card that opened the post page
  return {
    tap: (element: HTMLElement) => {
      taps += 1;
      fireEvent.click(element);
    },
    get taps() {
      return taps;
    },
  };
}

async function marketSellerTapsToSentMessage() {
  render(
    <ListingDetailContent
      listing={{
        id: "listing-1",
        owner_id: "owner-1",
        title: "Toyota Hilux 2.4",
        description: "One owner.",
        price_cents: 25000000,
        price_negotiable: false,
        category: "vehicles",
        condition: "used",
        attributes: null,
        photos: [],
        videos: [],
        video_thumbnail: null,
        logo_url: null,
        location_province: "KwaZulu-Natal",
        location_city: "Richards Bay",
        location_suburb: null,
        location_address: null,
        contact_methods: ["call", "whatsapp", "form"],
        created_at: new Date().toISOString(),
      }}
      // A private seller: the number is protected, so the bar says "Contact seller".
      seller={{
        display_name: "Thando D.",
        location_province: "KwaZulu-Natal",
        location_city: "Richards Bay",
        account_verification_status: "verified",
        has_phone: true,
      }}
      showContactActions
      showSimilarListings={false}
    />
  );
  const path = counter();
  path.tap(stickyBar().getByRole("link", { name: /Contact seller/ }));
  path.tap(screen.getByRole("button", { name: "Send an enquiry" }));
  await sendEnquiry(path.tap, "Send");
  return path.taps;
}

const business = {
  id: "business-1",
  owner_id: "",
  business_name: "Mzansi Motor Workshop",
  description: "Services and repairs.",
  status: "live",
  business_type: "standalone_shop",
  category: "automotive_services",
  subcategory: null,
  // No saved contact methods: enquiries are on, the live default.
  category_details: null,
  cover_photo: null,
  logo_url: null,
  cover_video: null,
  video_thumbnail: null,
  gallery_photos: [],
  social_links: null,
  operating_hours: null,
  services_offered: null,
  payment_methods_accepted: null,
  delivery_options: null,
  service_areas: null,
  location_city: "Johannesburg",
  location_province: "Gauteng",
  location_town: null,
  location_address: null,
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  store_number: null,
  map_directions: null,
  business_details: null,
  layout_template: null,
} as BusinessDetailRecord;

function renderBusiness(record: BusinessDetailRecord) {
  return render(
    <UnifiedLayout
      family="showroom"
      business={record}
      trustLevel={null}
      ownerProfile={{ display_name: "Lerato F." }}
      promotions={[]}
      showPromotions={false}
      showPublicActions
      galleryPhotos={[]}
      deliveryAvailable={false}
    />
  );
}

async function businessTapsToSentMessage(record: BusinessDetailRecord) {
  renderBusiness(record);
  const path = counter();
  path.tap(stickyBar().getByRole("button", { name: "Send an enquiry" }));
  await sendEnquiry(path.tap, "Send enquiry");
  return path.taps;
}

describe("taps from a card to a sent message on a phone", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ success: true }))
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("a Market seller takes four taps", async () => {
    expect(await marketSellerTapsToSentMessage()).toBe(4);
  });

  it("a business that takes enquiries takes no more than a Market seller", async () => {
    const business_ = await businessTapsToSentMessage(business);
    expect(business_).toBe(3);
    expect(business_).toBeLessThanOrEqual(4);
  });

  it("a business that shows its numbers keeps Call and WhatsApp in the bar", () => {
    renderBusiness({ ...business, phone: "0720000000", whatsapp: "0720000000" });
    expect(stickyBar().getByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
      "href",
      "https://wa.me/27720000000"
    );
    expect(stickyBar().queryByRole("button", { name: "Send an enquiry" })).toBeNull();
  });

  it("a business that turned enquiries off and shows no number gets no bar", () => {
    renderBusiness({ ...business, category_details: { contact_methods: ["call"] } });
    expect(document.querySelector(".glass-panel.fixed")).toBeNull();
  });
});
