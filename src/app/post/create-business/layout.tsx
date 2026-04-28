import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Register Business",
  description: "Create a business profile on VerifyMzansi as an identity-reviewed representative.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-business");
  return children;
}
