import { RefreshCw } from "lucide-react";

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
      {tokenErrorMessage && !errorMessage && !unavailableMessage && (
        <p className="inline-form-error">{tokenErrorMessage}</p>
      )}

      {unavailableMessage && (
        <div className="flex items-center gap-2">
          <p className="inline-form-error">{unavailableMessage}</p>
          {canRetryUnavailable && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline hover:text-brand-green/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2">
          <p className="inline-form-error">{errorMessage}</p>
          {canRetryError && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline hover:text-brand-green/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}
