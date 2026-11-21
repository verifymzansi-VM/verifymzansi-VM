/**
 * What the register page does once the server has accepted a sign-up.
 *
 * While sign-up is by invitation the server gives every address the same
 * answer (it never says who is invited). The sign-in page's "Check your
 * email" box says what happens next, so no toast repeats it there. An open
 * sign-up keeps its "Account created!" toast.
 */
export function registrationOutcome(result: unknown): {
  redirect: string;
  toast: { title: string; description: string } | null;
} {
  const inviteOnly =
    typeof result === "object" &&
    result !== null &&
    (result as { inviteOnly?: unknown }).inviteOnly === true;
  if (inviteOnly) return { redirect: "/login?registered=invite", toast: null };
  return {
    redirect: "/login?registered=true",
    toast: {
      title: "Account created!",
      description: "Check your email to confirm, then complete your account verification.",
    },
  };
}
