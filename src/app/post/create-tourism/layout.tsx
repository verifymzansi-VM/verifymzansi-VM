import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Create Tourism & Events Listing",
  description:
    "List your accommodation, tour, or event on VerifyMzansi — South Africa's trusted marketplace.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-tourism");
  return children;
}
