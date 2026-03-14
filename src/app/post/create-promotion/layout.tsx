import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Create Promotion",
  description: "Create a promotion or event ad on VerifyMzansi to boost your reach.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-promotion");
  return children;
}
