import { redirect } from "next/navigation";

export const metadata = {
  title: "Tourism & Events",
  description: "Manage your tourism and event listings on VerifyMzansi.",
};

export default function TourismEventsPage() {
  redirect("/dashboard/listings?area=PROMOTIONS_EVENTS");
}
