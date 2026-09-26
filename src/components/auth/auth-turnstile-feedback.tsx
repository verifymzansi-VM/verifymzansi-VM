import { AlertCircle, RefreshCw } from "lucide-react";
import { AuthFieldError } from "@/components/auth/auth-ui";

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      Retry
    </button>
  );
}

function SecurityCheckMessage({
  message,
  canRetry,
  onRetry,
}: {
  message: string;
  canRetry?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-xl border border-brand-red/25 bg-brand-red-50 px-3.5 py-2.5 dark:border-brand-red/30 dark:bg-brand-red/10"
    >
      <AlertCircle
        className="h-4 w-4 shrink-0 text-brand-red-700 dark:text-brand-red-300"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-brand-red-800 dark:text-brand-red-200">
        {message}
      </p>
      {canRetry ? <RetryButton onRetry={onRetry} /> : null}
    </div>
  );
}

export function AuthTurnstileFeedback({
  tokenErrorMessage,
  unavailableMessage,
  errorMessage,
  canRetryUnavailable,
  canRetryError,
  onRetry,
}: {
  tokenErrorMessage?: string;
  unavailableMessage?: string | null;
  errorMessage?: string | null;
  canRetryUnavailable?: boolean;
  canRetryError?: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {!errorMessage && !unavailableMessage && <AuthFieldError message={tokenErrorMessage} />}

      {unavailableMessage && (
        <SecurityCheckMessage
          message={unavailableMessage}
          canRetry={canRetryUnavailable}
          onRetry={onRetry}
        />
      )}

      {errorMessage && (
        <SecurityCheckMessage message={errorMessage} canRetry={canRetryError} onRetry={onRetry} />
      )}
    </>
  );
}
