"use client";

import {
  type NotificationInsertRow,
  useLiveNotificationListener,
} from "@/components/notifications/use-live-notification-listener";

interface LiveLeadNotifierProps {
  userId?: string;
}

function isLeadNotification(row: NotificationInsertRow): boolean {
  if (typeof row.href === "string" && row.href.startsWith("/dashboard/leads")) {
    return true;
  }

  const title = row.title?.toLowerCase() || "";
  return title.includes("lead");
}

export function LiveLeadNotifier({ userId }: LiveLeadNotifierProps) {
  useLiveNotificationListener({
    userId,
    matches: isLeadNotification,
    fallbackTitle: "New lead received",
    fallbackDescription: "A buyer sent you a new enquiry.",
    fallbackHref: "/dashboard/leads",
    toastVariant: "success",
    actionAltText: "Open leads inbox",
    actionLabel: "View",
    afterToast: ({ notificationId, description, targetHref }) => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return;
      }

      if (document.visibilityState === "visible") {
        return;
      }

      if (Notification.permission !== "granted") {
        return;
      }

      const showFallbackNotification = () => {
        const notice = new Notification("VerifyMzansi", {
          body: description,
          icon: "/icons/icon-192.png?v=10",
          tag: notificationId ? `lead-${notificationId}` : "lead-alert",
        });

        notice.onclick = () => {
          window.focus();
          window.location.assign(targetHref);
        };
      };

      if ("serviceWorker" in navigator) {
        // Race the SW ready promise against a timeout — if no SW is registered
        // the promise never resolves and the notification would never appear.
        const SW_TIMEOUT_MS = 3_000;
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SW_TIMEOUT_MS)
        );

        void Promise.race([navigator.serviceWorker.ready, timeout])
          .then((registration) => {
            if (!registration) {
              showFallbackNotification();
              return;
            }
            return registration.showNotification("VerifyMzansi", {
              body: description,
              icon: "/icons/icon-192.png?v=10",
              tag: notificationId ? `lead-${notificationId}` : "lead-alert",
              data: { url: targetHref },
            });
          })
          .catch(showFallbackNotification);

        return;
      }

      showFallbackNotification();
    },
  });

  return null;
}
