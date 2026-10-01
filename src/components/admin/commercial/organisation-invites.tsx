"use client";

import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";

export interface AdminOrganisationInvite {
  id: string;
  email: string;
  expires_at: string;
  created_at: string;
}

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

function RevokeInvite({ invite }: { invite: AdminOrganisationInvite }) {
  const { run, busy, message } = useCommercialAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = readForm(event.currentTarget);
        void run(
          { action: "organisation.revoke_invite", inviteId: invite.id, reason: form.reason },
          "Invitation withdrawn"
        );
      }}
    >
      <div className="min-w-48 flex-1">
        <ReasonField />
      </div>
      <SubmitButton busy={busy}>Withdraw</SubmitButton>
      <ActionMessage message={message} />
    </form>
  );
}

/**
 * Invite sponsor administrators by email. The link is single use, valid for
 * 7 days and bound to the address; open invitations hold an admin seat.
 */
export function OrganisationInvitesCard({
  organisationId,
  invites,
  seatsLeft,
}: {
  organisationId: string;
  invites: AdminOrganisationInvite[];
  seatsLeft: number;
}) {
  const { run, busy, message } = useCommercialAction();
  return (
    <AdminCard
      title="Invite a sponsor administrator"
      description={`Sends a 7-day, single-use link bound to the email address. ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left (open invitations hold a seat). Re-inviting an address replaces its old link.`}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = readForm(formElement);
          void run(
            {
              action: "organisation.invite_admin",
              organisationId,
              email: form.email,
              reason: form.reason,
            },
            "Invitation sent"
          ).then((result) => {
            if (result) formElement.reset();
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">Email address</span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
        </label>
        <ReasonField />
        <SubmitButton busy={busy}>Send invitation</SubmitButton>
        <ActionMessage message={message} />
      </form>
      {invites.length > 0 ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Open invitations</h3>
          <ul className="space-y-3 text-sm">
            {invites.map((invite) => (
              <li key={invite.id} className="space-y-2 rounded-lg border p-3">
                <p className="break-all">
                  <strong>{invite.email}</strong> · expires{" "}
                  {date.format(new Date(invite.expires_at))}
                </p>
                <RevokeInvite invite={invite} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AdminCard>
  );
}
