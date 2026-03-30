import { redirect } from "next/navigation";

export const metadata = {
  title: "Mzansi Business",
  description: "Manage your registered businesses on VerifyMzansi.",
};

export default function MyBusinessesPage() {
  redirect("/dashboard/listings?area=MZANSI_BUSINESS");
}
