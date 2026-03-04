"use client";

/**
 * Global error boundary — catches errors thrown by the root layout itself.
 * Must include its own <html> and <body> tags since the root layout may
 * be unavailable when this renders.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-white text-gray-900">
        <div className="max-w-md text-center px-6">
          <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
          <p className="text-gray-600 mb-6">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {error.digest && <p className="text-xs text-gray-400 mb-4">Error ID: {error.digest}</p>}
          <button
            onClick={reset}
            className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
