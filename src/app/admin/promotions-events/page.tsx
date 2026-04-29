import { AreaAdminPage } from "../_lib/area-admin-page";

export const metadata = {
  title: "Tourism & Events — Admin",
  description: "Manage events and tourism content — approve, flag, or remove.",
};

export default async function AdminPromotionsEventsPage() {
  return AreaAdminPage({
    area: "PROMOTIONS_EVENTS",
    areaLabel: "Tourism & Events",
    description: "Moderation and reports for Tourism & Events.",
  });
}
