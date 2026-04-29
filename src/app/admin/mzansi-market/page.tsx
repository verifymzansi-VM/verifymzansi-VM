import { AreaAdminPage } from "../_lib/area-admin-page";

export const metadata = {
  title: "Mzansi Market — Admin",
  description: "Manage classified listings — review, approve, or remove marketplace ads.",
};

export default async function AdminMzansiMarketPage() {
  return AreaAdminPage({
    area: "MZANSI_MARKET",
    areaLabel: "Mzansi Market",
    description: "Moderation and reports for Mzansi Market.",
  });
}
