"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Inbox, Mail, Loader2, ShieldCheck, Megaphone, BarChart2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatRelativeTime } from "@/lib/utils/format";
import { useToast } from "@/hooks/use-toast";

interface NotificationItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  href?: string;
  read: boolean;
  created_at: string;
}

interface OptionalPreferences {
  marketing_email: boolean;
  marketing_sms: boolean;
  analytics: boolean;
  third_party_sharing: boolean;
}

interface EmailActivityItem {
  id: string;
  action: "communication_email_sent" | "communication_email_failed";
  created_at: string;
  metadata?: {
    template?: string;
    error?: string;
  };
}

const EMAIL_TEMPLATE_CATALOG = [
  { key: "verification_outcomes", label: "Verification outcomes", channel: "Email" },
  { key: "lead_alerts", label: "Lead alerts", channel: "Email" },
  { key: "payment_status", label: "Payment success/failure", channel: "Email" },
  { key: "dsar_lifecycle", label: "DSAR lifecycle", channel: "Email" },
  { key: "enforcement_actions", label: "Account enforcement actions", channel: "Email" },
] as const;

const DEFAULT_PREFERENCES: OptionalPreferences = {
  marketing_email: false,
  marketing_sms: false,
  analytics: false,
  third_party_sharing: false,
};

export function CommunicationHub() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [preferences, setPreferences] = useState<OptionalPreferences>(DEFAULT_PREFERENCES);
  const [emailActivity, setEmailActivity] = useState<EmailActivityItem[]>([]);
  const [loadingEmailActivity, setLoadingEmailActivity] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof OptionalPreferences | null>(null);
  const [loadingPreferences, setLoadingPreferences] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const response = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load notifications");
      }

      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      toast({
        title: "Failed to load activity",
        description: error instanceof Error ? error.message : "Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoadingNotifications(false);
    }
  }, [toast]);

  const fetchPreferences = useCallback(async () => {
    setLoadingPreferences(true);
    try {
      const response = await fetch("/api/communications/preferences", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load communication preferences");
      }

      setPreferences({
        marketing_email: Boolean(data.preferences?.marketing_email),
        marketing_sms: Boolean(data.preferences?.marketing_sms),
        analytics: Boolean(data.preferences?.analytics),
        third_party_sharing: Boolean(data.preferences?.third_party_sharing),
      });
    } catch (error) {
      toast({
        title: "Failed to load preferences",
        description: error instanceof Error ? error.message : "Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoadingPreferences(false);
    }
  }, [toast]);

  const fetchEmailActivity = useCallback(async () => {
    setLoadingEmailActivity(true);
    try {
      const response = await fetch("/api/communications/email-activity", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load email activity");
      }

      setEmailActivity(data.items || []);
    } catch (error) {
      toast({
        title: "Failed to load email activity",
        description: error instanceof Error ? error.message : "Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoadingEmailActivity(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchNotifications();
    void fetchPreferences();
    void fetchEmailActivity();
  }, [fetchNotifications, fetchPreferences, fetchEmailActivity]);

  const sortedNotifications = useMemo(
    () => [...notifications].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [notifications]
  );

  async function markAllRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });

    if (!response.ok) {
      toast({
        title: "Unable to mark all as read",
        variant: "destructive",
      });
      return;
    }

    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
  }

  async function clearAll() {
    const response = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });

    if (!response.ok) {
      toast({
        title: "Unable to clear activity",
        variant: "destructive",
      });
      return;
    }

    setNotifications([]);
    setUnreadCount(0);
  }

  async function togglePreference(key: keyof OptionalPreferences, enabled: boolean) {
    setSavingKey(key);

    const response = await fetch("/api/communications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: enabled }),
    });

    const data = await response.json();

    if (!response.ok) {
      toast({
        title: "Unable to update preference",
        description: data.error || "Please try again.",
        variant: "destructive",
      });
      setSavingKey(null);
      return;
    }

    setPreferences((current) => ({ ...current, [key]: enabled }));
    setSavingKey(null);
  }

  return (
    <Tabs defaultValue="activity" className="space-y-4">
      <TabsList>
        <TabsTrigger value="activity" className="gap-2">
          <Inbox className="h-4 w-4" />
          Activity
        </TabsTrigger>
        <TabsTrigger value="emails" className="gap-2">
          <Mail className="h-4 w-4" />
          <span className="sm:hidden">Emails</span>
          <span className="hidden sm:inline">Email Coverage</span>
        </TabsTrigger>
        <TabsTrigger value="preferences" className="gap-2">
          <Bell className="h-4 w-4" />
          Preferences
        </TabsTrigger>
      </TabsList>

      <TabsContent value="activity" className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Communication Activity</CardTitle>
                <CardDescription>
                  Realtime in-app notifications and account updates.
                </CardDescription>
              </div>
              <Badge variant={unreadCount > 0 ? "destructive" : "outline"}>
                {unreadCount} unread
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void clearAll()}>
                Clear activity
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingNotifications ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading communication activity...
              </div>
            ) : sortedNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No communication activity yet. Notification history appears here as you use the
                platform.
              </p>
            ) : (
              <div className="space-y-3">
                {sortedNotifications.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/60 p-3 transition-colors hover:border-border"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-tight">{item.title}</p>
                        {item.message && (
                          <p className="text-sm text-muted-foreground leading-tight">
                            {item.message}
                          </p>
                        )}
                      </div>
                      {!item.read && <Badge variant="destructive">New</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatRelativeTime(item.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="emails" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Transactional Email Coverage</CardTitle>
            <CardDescription>
              These critical communications are automatically sent when related platform events
              occur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingEmailActivity ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading recent email events...
              </div>
            ) : emailActivity.length > 0 ? (
              <div className="space-y-3">
                {emailActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between rounded-lg border border-border/70 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {(item.metadata?.template || "transactional_email").replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.action === "communication_email_sent"
                          ? "Delivered to email provider"
                          : item.metadata?.error || "Delivery failed"}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          item.action === "communication_email_sent" ? "pending" : "destructive"
                        }
                      >
                        {item.action === "communication_email_sent" ? "Sent" : "Failed"}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRelativeTime(item.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent email delivery events yet. Transactional emails will appear here after
                important account actions.
              </p>
            )}

            {EMAIL_TEMPLATE_CATALOG.map((template) => (
              <div
                key={template.key}
                className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{template.label}</p>
                  <p className="text-xs text-muted-foreground">{template.channel}</p>
                </div>
                <Badge className="bg-emerald-600 text-white">Active</Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              Transactional messages cannot be unsubscribed from because they contain service,
              billing, security, or legal updates.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="preferences" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Optional Communication Preferences</CardTitle>
            <CardDescription>
              Manage non-essential communication channels and data usage preferences.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingPreferences ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading preferences...
              </div>
            ) : (
              <>
                <PreferenceRow
                  icon={Megaphone}
                  id="marketing-email"
                  label="Marketing email"
                  description="Product updates, offers, and campaign announcements."
                  checked={preferences.marketing_email}
                  disabled={savingKey !== null}
                  onCheckedChange={(checked) => void togglePreference("marketing_email", checked)}
                />
                <PreferenceRow
                  icon={Megaphone}
                  id="marketing-sms"
                  label="Marketing SMS"
                  description="Occasional promotional SMS alerts."
                  checked={preferences.marketing_sms}
                  disabled={savingKey !== null}
                  onCheckedChange={(checked) => void togglePreference("marketing_sms", checked)}
                />
                <PreferenceRow
                  icon={BarChart2}
                  id="analytics"
                  label="Analytics"
                  description="Allow usage analytics to improve platform features."
                  checked={preferences.analytics}
                  disabled={savingKey !== null}
                  onCheckedChange={(checked) => void togglePreference("analytics", checked)}
                />
                <PreferenceRow
                  icon={ShieldCheck}
                  id="third-party-sharing"
                  label="Third-party sharing"
                  description="Allow approved third-party processing for extended services."
                  checked={preferences.third_party_sharing}
                  disabled={savingKey !== null}
                  onCheckedChange={(checked) =>
                    void togglePreference("third_party_sharing", checked)
                  }
                />
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function PreferenceRow({
  icon: Icon,
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: React.ElementType;
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md bg-muted p-1.5">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
