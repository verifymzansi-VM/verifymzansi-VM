import { redirect } from "next/navigation";

export const metadata = {
  title: "Tourism & Events",
  description: "Manage your event listings on VerifyMzansi.",
};

export default function PromotionsPage() {
  redirect("/dashboard/tourism-events");
}
