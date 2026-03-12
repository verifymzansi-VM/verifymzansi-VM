import { notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ mallId: string }> }) {
  await params;
  notFound();
}
