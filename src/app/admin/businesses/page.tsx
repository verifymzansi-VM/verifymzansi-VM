import { AreaAdminPage } from "../_lib/area-admin-page";

export const metadata = {
  title: "Mzansi Business — Admin",
  description: "Manage registered businesses — review, approve, or flag business listings.",
};

export default async function AdminBusinessesPage() {
  return AreaAdminPage({
    area: "MZANSI_BUSINESS",
    areaLabel: "Mzansi Business",
    description: "Moderation and reports for Mzansi Business.",
  });
}
