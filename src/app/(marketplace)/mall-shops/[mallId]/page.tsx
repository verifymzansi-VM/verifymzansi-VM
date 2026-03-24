import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ mallId: string }> }) {
  const { mallId } = await params;
  redirect(`/mzansi-business/${mallId}`);
}
