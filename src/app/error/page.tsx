import Link from "next/link";

type ErrorPageSearchParams = {
  reason?: string;
};

function getMessage(reason?: string) {
  switch (reason) {
    case "unavailable":
      return {
        title: "Service temporarily unavailable",
        description:
          "We couldn't verify your account details right now. Please try again from your dashboard in a moment.",
      };
    default:
      return {
        title: "Something went wrong",
        description: "We hit an unexpected problem. Please try again.",
      };
  }
}

export default async function ErrorPage({
  searchParams,
}: {
  searchParams?: Promise<ErrorPageSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const message = getMessage(params?.reason);

  return (
    <main className="container-page flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-6 py-12 text-center">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          VerifyMzansi
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {message.title}
        </h1>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
          {message.description}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90"
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
