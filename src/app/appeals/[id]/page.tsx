import { redirect } from "next/navigation";

/** Appeal outcomes are shown on the decisions page; notifications link here. */
export default async function AppealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/appeals#${encodeURIComponent(id)}`);
}
