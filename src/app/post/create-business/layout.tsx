import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Register Business",
  description:
    "Register your business on VerifyMzansi to reach verified customers across South Africa.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-business");
  return children;
}
