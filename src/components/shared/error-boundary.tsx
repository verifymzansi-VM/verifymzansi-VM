"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI to render instead of the default */
  fallback?: ReactNode;
  /** Optional callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Optional label for logging context */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Reusable React Error Boundary.
 *
 * Wraps components that may throw at render time and provides a
 * recovery UI with a "Try again" button. Logs errors for observability.
 *
 * Usage:
 *   <ErrorBoundary label="EvidenceDesk">
 *     <EvidenceDesk />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const label = this.props.label ?? "Unknown";
    console.error(`[ErrorBoundary:${label}]`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card px-5 py-7 text-center elev-xs"
        >
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300"
          >
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-base font-semibold tracking-tight">
              This section didn&apos;t load
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Something went wrong while showing it. Give it another go, or refresh the page if the
              problem continues.
            </p>
          </div>
          <Button variant="outline" className="h-11 rounded-full px-5" onClick={this.handleReset}>
            Try again
          </Button>
          {this.state.error?.message ? (
            <details className="w-full text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer py-1 text-center font-medium">
                Technical details
              </summary>
              <p className="mt-1 break-all">{this.state.error.message}</p>
            </details>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}
