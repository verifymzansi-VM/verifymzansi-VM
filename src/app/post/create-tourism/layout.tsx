import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Create Tourism & Events Listing",
  description:
    "Post tourism accommodation, tours, experiences, venues, restaurants, or events on VerifyMzansi.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-tourism");
  return children;
}
