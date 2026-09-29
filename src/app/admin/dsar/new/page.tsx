import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { DsarIntakeForm } from "./dsar-intake-form";

export const metadata = {
  title: "Record a Data Request — Admin",
  description: "Record a POPIA data request received by email, post or phone.",
};

export default async function NewDsarPage() {
  await requireStaff("dsar:manage");

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Record a data request"
        description="For requests received by email, post or phone from someone who cannot sign in."
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Data requests", href: "/admin/dsar" },
          { label: "Record a request" },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        The deadline runs from the date the request arrived and is set from the deadline rules. The
        requester&apos;s identity starts unchecked: check it yourself (for example, a copy of an ID
        matched against the account) and mark it verified before any data is exported, corrected or
        deleted.
      </p>
      <DsarIntakeForm />
    </div>
  );
}
