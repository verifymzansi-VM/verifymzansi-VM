import { notFound, redirect } from "next/navigation";

/** Notification links point here; applications are the dashboard's default tab. */
export default async function OrganisationApplicationsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  redirect(`/dashboard/organisation/${slug}`);
}
