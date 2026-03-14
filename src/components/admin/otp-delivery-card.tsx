import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maskPhone } from "@/lib/utils/mask";
import { timeAgo } from "@/lib/utils/format";
import type { RecentOtpAttempt } from "@/lib/utils/admin-queries";

interface OtpDeliveryCardProps {
  attempts: RecentOtpAttempt[];
}

function statusVariant(
  status: RecentOtpAttempt["delivery_status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "sent":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function formatShortTime(isoDate: string | null): string {
  if (!isoDate) return "not verified";
  return new Date(isoDate).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExpiry(isoDate: string): string {
  return new Date(isoDate).getTime() <= Date.now() ? "expired" : formatShortTime(isoDate);
}

function statusLabel(status: RecentOtpAttempt["delivery_status"]): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

export function OtpDeliveryCard({ attempts }: OtpDeliveryCardProps) {
  return (
    <Card className="border-warm-200/70 bg-background/95 dark:border-warm-700/70">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base font-display">Recent OTP Delivery</CardTitle>
        <p className="text-sm text-muted-foreground">
          Latest SMS attempts recorded in the OTP audit trail.
        </p>
      </CardHeader>
      <CardContent>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No OTP attempts recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {attempts.map((attempt) => (
              <div
                key={attempt.id}
                className="rounded-lg border border-warm-200/70 p-3 dark:border-warm-700/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{maskPhone(attempt.phone)}</span>
                    <Badge variant={statusVariant(attempt.delivery_status)}>
                      {statusLabel(attempt.delivery_status)}
                    </Badge>
                    {attempt.verified && <Badge variant="outline">Verified</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(attempt.created_at)}
                  </span>
                </div>

                <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>Provider: {attempt.provider_name ?? "unknown"}</p>
                  <p>Message ID: {attempt.provider_message_id ?? "not recorded"}</p>
                  <p>Expires: {formatExpiry(attempt.expires_at)}</p>
                  <p>Verified at: {formatShortTime(attempt.verified_at)}</p>
                </div>

                {attempt.provider_error && (
                  <p className="mt-2 text-xs text-destructive">{attempt.provider_error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
