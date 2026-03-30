import { redirect } from "next/navigation";

export const metadata = {
  title: "Promotions & Events",
  description: "Manage your promotions, ads, and event listings on VerifyMzansi.",
};

export default function PromotionsPage() {
  redirect("/dashboard/listings?area=PROMOTIONS_EVENTS");
}
