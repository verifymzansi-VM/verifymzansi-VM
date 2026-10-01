"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "@/components/admin/commercial/commercial-action";

export type ExtensionTargetType = "organisation_trial" | "founding_contract" | "intro_trial_claim";

export interface ExtensionTarget {
  type: ExtensionTargetType;
  id: string;
  label: string;
  detail: string;
  endsAt: string;
  href?: string;
}

export interface AdminExtensionOffer {
  id: string;
  target_type: ExtensionTargetType;
  target_label: string;
  kind: "consent" | "correction";
  days: number;
  current_ends_at: string;
  proposed_ends_at: string;
  respond_by: string | null;
  reason: string;
  status: "pending_approval" | "offered";
  approval_required_because: string | null;
  offered_by: string;
  offeredByName: string;
  email_sends: number;
  created_at: string;
}

export interface NearCapacityProgramme {
  id: string;
  name: string;
  filled: number;
  capacity: number;
  waiting: number;
}

const sast = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});
const DAY = 86_400_000;
const TYPE_LABEL: Record<ExtensionTargetType, string> = {
  organisation_trial: "Group 3 programme",
  founding_contract: "Founding contract",
  intro_trial_claim: "Introductory trial",
};

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY));
}

function OfferForm({
  targets,
  initialTarget,
  defaultDays,
}: {
  targets: ExtensionTarget[];
  initialTarget: string | null;
  defaultDays: number;
}) {
  const { run, busy, message } = useCommercialAction();
  const [targetKey, setTargetKey] = useState(
    initialTarget && targets.some((t) => `${t.type}:${t.id}` === initialTarget) ? initialTarget : ""
  );
  const [days, setDays] = useState(defaultDays);
  const [kind, setKind] = useState<"consent" | "correction">("consent");
  const [reviewing, setReviewing] = useState(false);
  const target = targets.find((t) => `${t.type}:${t.id}` === targetKey);
  const newEnd = useMemo(
    () => (target ? new Date(Date.parse(target.endsAt) + days * DAY) : null),
    [target, days]
  );

  return (
    <AdminCard
      title="Offer an extension"
      description="Adds 1–30 days only after the participant accepts. A second extension, or a correction applied without consent, waits for a different administrator to approve."
    >
      <form
        id="extension-offer-form"
        className="grid scroll-mt-24 gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!target) return;
          if (!reviewing) {
            setReviewing(true);
            return;
          }
          const form = readForm(event.currentTarget);
          void run(
            {
              action: "trial_extension.offer",
              targetType: target.type,
              targetId: target.id,
              days,
              kind,
              reason: form.reason,
            },
            kind === "correction" ? "Sent for approval" : "Offer created"
          ).then((result) => {
            if (result) setReviewing(false);
          });
        }}
      >
        <label className="text-sm sm:col-span-2">
          Trial
          <select
            required
            value={targetKey}
            onChange={(e) => {
              setTargetKey(e.target.value);
              setReviewing(false);
            }}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          >
            <option value="">Choose a trial…</option>
            {targets.map((t) => (
              <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>
                {TYPE_LABEL[t.type]} — {t.label} (ends {sast.format(new Date(t.endsAt))})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Extra days
          <input
            type="number"
            min={1}
            max={30}
            required
            value={days}
            onChange={(e) => {
              setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)));
              setReviewing(false);
            }}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="text-sm">
          Type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "consent" | "correction");
              setReviewing(false);
            }}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          >
            <option value="consent">Offer (participant accepts)</option>
            <option value="correction">Correction (second admin approves)</option>
          </select>
        </label>
        <div className="sm:col-span-4">
          <ReasonField />
        </div>
        {target && newEnd ? (
          <p
            className="rounded-lg border bg-muted/50 p-3 text-sm sm:col-span-4"
            role={reviewing ? "status" : undefined}
          >
            Current end <strong>{sast.format(new Date(target.endsAt))}</strong> → new end if
            accepted <strong>{sast.format(newEnd)} SAST</strong>.{" "}
            {reviewing ? "Check the dates, then confirm." : null}
          </p>
        ) : null}
        <div className="flex gap-2 sm:col-span-4">
          <SubmitButton busy={busy}>{reviewing ? "Confirm offer" : "Review offer"}</SubmitButton>
          {reviewing ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={() => setReviewing(false)}
            >
              Change
            </Button>
          ) : null}
        </div>
        <div className="sm:col-span-4">
          <ActionMessage message={message} />
        </div>
      </form>
    </AdminCard>
  );
}

function OfferActions({ offer, actorId }: { offer: AdminExtensionOffer; actorId: string }) {
  const { run, busy, message } = useCommercialAction();
  const ownOffer = offer.offered_by === actorId;
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = submitter?.value;
        if (!intent) return;
        const form = readForm(event.currentTarget);
        void run(
          intent === "resend"
            ? { action: "trial_extension.resend", offerId: offer.id }
            : intent === "approve" || intent === "reject"
              ? {
                  action: "trial_extension.decide",
                  offerId: offer.id,
                  approve: intent === "approve",
                  reason: form.reason,
                }
              : { action: "trial_extension.withdraw", offerId: offer.id, reason: form.reason },
          intent === "resend" ? "Email queued" : "Saved"
        );
      }}
    >
      {/* Enter in the reason box would "click" the first submit button (Approve).
          A disabled default button makes browsers ignore Enter here, so these
          decisions are only ever made by clicking. */}
      <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
      <ReasonField />
      <div className="flex flex-wrap gap-2">
        {offer.status === "pending_approval" ? (
          <>
            <Button
              type="submit"
              name="intent"
              value="approve"
              className="h-11"
              disabled={busy || ownOffer}
              title={ownOffer ? "A different administrator must approve" : undefined}
            >
              Approve
            </Button>
            <Button
              type="submit"
              name="intent"
              value="reject"
              variant="outline"
              className="h-11"
              disabled={busy || ownOffer}
            >
              Reject
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant="outline"
            className="h-11"
            disabled={busy || offer.email_sends >= 3}
            formNoValidate
          >
            Resend email
          </Button>
        )}
        <Button
          type="submit"
          name="intent"
          value="withdraw"
          variant="ghost"
          className="h-11"
          disabled={busy}
        >
          Withdraw
        </Button>
      </div>
      {ownOffer && offer.status === "pending_approval" ? (
        <p className="text-xs text-muted-foreground">
          You made this offer; another administrator must approve it.
        </p>
      ) : null}
      <ActionMessage message={message} />
    </form>
  );
}

export function TrialExtensionsPanel({
  actorId,
  targets,
  offers,
  nearCapacity,
  initialTarget,
  defaultDays,
}: {
  actorId: string;
  targets: ExtensionTarget[];
  offers: AdminExtensionOffer[];
  nearCapacity: NearCapacityProgramme[];
  initialTarget: string | null;
  defaultDays: number;
}) {
  const ending = targets
    .filter((t) => daysLeft(t.endsAt) <= 30)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  return (
    <div className="space-y-6">
      <AdminCard
        title="Programme board"
        description="Free programmes and trials ending within 30 days, open extension offers and programmes near capacity."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section>
            <h3 className="text-sm font-semibold">Ending soon</h3>
            {ending.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing ends in the next 30 days.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {ending.map((t) => {
                  const left = daysLeft(t.endsAt);
                  return (
                    <li key={`${t.type}:${t.id}`} className="rounded-lg border p-2">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={left <= 7 ? "destructive" : left <= 14 ? "secondary" : "outline"}
                        >
                          {left} days
                        </Badge>
                        {t.href ? (
                          <Link className="font-medium underline" href={t.href}>
                            {t.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{t.label}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {TYPE_LABEL[t.type]} · {t.detail}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h3 className="text-sm font-semibold">Open offers</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {offers.filter((o) => o.status === "pending_approval").length} waiting for approval ·{" "}
              {offers.filter((o) => o.status === "offered").length} waiting for the participant
            </p>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Near capacity</h3>
            {nearCapacity.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No programme is above 80%.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {nearCapacity.map((p) => (
                  <li key={p.id}>
                    <Link className="underline" href={`/admin/organisations/${p.id}`}>
                      {p.name}
                    </Link>{" "}
                    — {p.filled}/{p.capacity}
                    {p.waiting ? ` · ${p.waiting} waiting` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </AdminCard>

      <OfferForm targets={targets} initialTarget={initialTarget} defaultDays={defaultDays} />

      <AdminCard title="Extension offers">
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open offers.</p>
        ) : (
          <ul className="space-y-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                className="grid gap-3 rounded-lg border p-3 text-sm lg:grid-cols-2"
              >
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {offer.target_label}
                    <Badge variant={offer.status === "pending_approval" ? "secondary" : "outline"}>
                      {offer.status === "pending_approval"
                        ? "Needs approval"
                        : "Waiting for answer"}
                    </Badge>
                    {offer.kind === "correction" ? (
                      <Badge variant="destructive">Correction</Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground">
                    +{offer.days} days: {sast.format(new Date(offer.current_ends_at))} →{" "}
                    {sast.format(new Date(offer.proposed_ends_at))}
                  </p>
                  {offer.respond_by ? (
                    <p className="text-muted-foreground">
                      Respond by {sast.format(new Date(offer.respond_by))} · emails sent{" "}
                      {offer.email_sends + 1}
                    </p>
                  ) : null}
                  <p>
                    <span className="text-muted-foreground">Reason:</span> {offer.reason}
                  </p>
                  {offer.approval_required_because ? (
                    <p className="text-muted-foreground">
                      Approval needed: {offer.approval_required_because}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Offered by {offer.offeredByName} · {sast.format(new Date(offer.created_at))}
                  </p>
                </div>
                <OfferActions offer={offer} actorId={actorId} />
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
