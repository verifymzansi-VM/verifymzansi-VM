import { requireVerifiedPostAccess } from "@/app/post/_lib/require-verified-post-access";

export const metadata = {
  title: "Create Listing",
  description: "Post a new listing on Mzansi Market — reach verified buyers across South Africa.",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireVerifiedPostAccess("/post/create-listing");
  return children;
}
