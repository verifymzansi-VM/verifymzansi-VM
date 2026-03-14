import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Post in Promotions & Events",
  description:
    "Create a verified Promotions & Events campaign on VerifyMzansi for launches, specials, and time-sensitive offers.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-promotion");
  return children;
}
