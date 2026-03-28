import {
  ModerationPreviewPanel,
  type ModerationItem,
} from "@/app/admin/moderation/moderation-preview-panel";

const richBusinessItem: ModerationItem = {
  id: "preview-business-rich",
  title: "Nomsa Beauty Studio",
  business_name: "Nomsa Beauty Studio",
  business_type: "mall_store",
  status: "pending_moderation",
  created_at: new Date().toISOString(),
  category: "health_beauty",
  owner_id: "preview-user-1",
  area: "MZANSI_BUSINESS",
  areaLabel: "Mzansi Business",
  itemType: "Business",
  description:
    "A polished mall-based beauty studio with hair styling, nail care, and makeup bookings. This preview shows how photos, promo video, and the business logo are presented together for moderation.",
  location_city: "Johannesburg",
  location_province: "Gauteng",
  store_number: "L42",
  phone: "011 555 0101",
  whatsapp: "0720000000",
  email: "hello@nomsa.co.za",
  website: "https://nomsa.co.za",
  social_links: {
    instagram: "https://instagram.com/nomsa",
    facebook: "https://facebook.com/nomsa",
  },
  operating_hours: {
    Mon_Fri: "08:00 - 18:00",
    Sat: "09:00 - 16:00",
    Sun: "Closed",
  },
  services_offered: ["Hair styling", "Nail care", "Makeup sessions"],
  payment_methods_accepted: ["cash", "card", "eft"],
  delivery_options: ["in_store_pickup", "appointment_only"],
  cover_photo: "/images/promo/promo-1.png",
  cover_video: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  video_thumbnail: "/images/promo/promo-2.png",
  gallery_photos: ["/images/promo/promo-3.png", "/images/promo/promo-4.png"],
  logo_url: "/images/logo-transparent.png",
  business_details: {
    type: "mall_store",
    mall_name: "Maponya Mall",
    floor_or_wing: "Upper Level",
    nearest_entrance: "Entrance 3",
    mall_address: "2127 Chris Hani Road, Soweto",
  },
};

const emptyBusinessItem: ModerationItem = {
  id: "preview-business-empty",
  title: "Lindi Repairs",
  business_name: "Lindi Repairs",
  business_type: "mobile_service",
  status: "pending_moderation",
  created_at: new Date().toISOString(),
  category: "trade_maintenance",
  owner_id: "preview-user-2",
  area: "MZANSI_BUSINESS",
  areaLabel: "Mzansi Business",
  itemType: "Business",
  description: "Mobile repair service with no uploaded visuals yet.",
  location_city: "Soweto",
  location_province: "Gauteng",
  phone: "082 555 0101",
  service_areas: { areas: ["Soweto", "Roodepoort"] },
  business_details: {
    type: "mobile_service",
    travel_radius_km: 25,
    emergency_callouts: true,
  },
};

export default function BusinessModerationPreviewPage() {
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">Business Moderation Preview</h1>
          <p className="max-w-3xl text-muted-foreground">
            Local preview for the business moderation drawer, including a rich media example and the
            compact empty-media state.
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Rich Media Example</h2>
            <p className="text-sm text-muted-foreground">
              Cover photo, promo video, gallery photos, and logo displayed together.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
            <div className="max-h-[calc(100vh-8rem)] px-6 py-6">
              <ModerationPreviewPanel item={richBusinessItem} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Empty Media Example</h2>
            <p className="text-sm text-muted-foreground">
              Compact summary when no photos, video, or logo have been uploaded.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
            <div className="max-h-[calc(100vh-8rem)] px-6 py-6">
              <ModerationPreviewPanel item={emptyBusinessItem} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
