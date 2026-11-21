import type { ReactNode } from "react";
import type { DisclosureRecord } from "@/lib/foundation/identity-disclosures";
import { formatDisclosurePhone, formatIdNumber } from "@/lib/admin/authority-requests";
import { formatDate } from "@/lib/utils/format";
import { DisclosureSelfie } from "./record-parts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-0.5 block text-muted-foreground">{children}</span>;
}

/** One person the record names: the kept identity record, an ID number that
 * was only tried, or an account with no identity kept. */
export function DisclosureRecordView({
  disclosureId,
  record,
}: {
  disclosureId: string;
  record: DisclosureRecord;
}) {
  if ("attempts" in record)
    return (
      <div className="space-y-2 text-sm">
        <p>
          This ID number was tried on account{" "}
          <span className="font-mono text-xs">{record.account_id}</span> and never accepted, so no
          identity record is kept. Only a one-way code of the number exists, which confirms the
          attempt and nothing more.
        </p>
        <p className="text-muted-foreground">
          Tried on {record.attempts.map((at) => formatDate(at)).join(", ")}.
        </p>
      </div>
    );
  if (!("verified_at" in record))
    return (
      <p className="text-sm">
        Account <span className="font-mono text-xs">{record.account_id}</span> was found, but no
        identity record is kept for it: the person never completed an ID check.
        {record.account_closed_at && (
          <> The account closed on {formatDate(record.account_closed_at)}.</>
        )}
      </p>
    );
  const name = [record.legal_first_name, record.legal_last_name].filter(Boolean).join(" ");
  const [current, ...earlier] = record.phones;
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <figure className="space-y-2">
        {record.selfie.kept ? (
          <DisclosureSelfie
            disclosureId={disclosureId}
            subject={record.account_id}
            label={`Selfie of ${name || "the account holder"}`}
          />
        ) : (
          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-2xl border bg-muted p-4 text-center text-sm text-muted-foreground">
            No selfie is kept
            {record.selfie.deleted_at ? ` (deleted ${formatDate(record.selfie.deleted_at)})` : ""}.
          </div>
        )}
        {record.selfie.taken_at && (
          <figcaption className="text-sm text-muted-foreground">
            Selfie from the ID check, {formatDate(record.selfie.taken_at)}
          </figcaption>
        )}
      </figure>
      <dl>
        <Row label="Full names as on the ID">
          <span className="font-semibold">{name || "Not kept"}</span>
        </Row>
        <Row label="SA ID number">
          {record.id_number_unreadable ? (
            <>
              <span className="font-semibold">Kept, but it could not be read here</span>
              <Sub>
                Report this to the platform owner; don&apos;t answer the request without it.
              </Sub>
            </>
          ) : record.id_number ? (
            <span className="font-semibold tabular-nums">{formatIdNumber(record.id_number)}</span>
          ) : (
            <>
              <span className="font-semibold">Not kept</span>
              {record.id_number_erased_at && (
                <Sub>Erased {formatDate(record.id_number_erased_at)}.</Sub>
              )}
            </>
          )}
        </Row>
        <Row label="Verified phone">
          {current ? (
            <>
              <span className="font-semibold tabular-nums">
                {formatDisclosurePhone(current.phone)}
              </span>
              <Sub>
                Verified {formatDate(current.verified_at)}
                {current.revoked_at ? `, removed ${formatDate(current.revoked_at)}` : ""}.
                {earlier.length > 0 && (
                  <>
                    {" "}
                    Earlier number{earlier.length === 1 ? "" : "s"}:{" "}
                    {earlier
                      .map(
                        (phone) =>
                          `${formatDisclosurePhone(phone.phone)} (${formatDate(phone.verified_at)} – ${
                            phone.revoked_at ? formatDate(phone.revoked_at) : "now"
                          })`
                      )
                      .join("; ")}
                    .
                  </>
                )}
              </Sub>
            </>
          ) : (
            <span className="font-semibold">None verified</span>
          )}
        </Row>
        <Row label="How the ID was checked">
          <span className="font-semibold">
            {record.checked_by === "staff_review" ? "Staff review" : "ID check"},{" "}
            {formatDate(record.verified_at)}
          </span>
          {record.verification_revoked_at && (
            <Sub>Verification withdrawn {formatDate(record.verification_revoked_at)}.</Sub>
          )}
        </Row>
        <Row label="Photo of the ID document">
          {record.id_photo.kept ? (
            <span className="font-semibold">Kept</span>
          ) : (
            <>
              <span className="font-semibold">Deleted</span>
              {record.id_photo.deleted_at && (
                <Sub>Deleted {formatDate(record.id_photo.deleted_at)}.</Sub>
              )}
            </>
          )}
        </Row>
        <Row label="Account">
          <span className="font-mono text-xs">{record.account_id}</span>
          {record.account_closed_at && <Sub>Closed {formatDate(record.account_closed_at)}.</Sub>}
        </Row>
      </dl>
    </div>
  );
}
