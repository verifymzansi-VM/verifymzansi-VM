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

      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.ready
          .then((registration) =>
            registration.showNotification("VerifyMzansi", {
              body: description,
              icon: "/icons/icon-192.png?v=10",
              tag: notificationId ? `lead-${notificationId}` : "lead-alert",
              data: { url: targetHref },
            })
          )
          .catch(() => {
            // Fall back to Window Notification below if SW notifications fail.
            const fallbackNotice = new Notification("VerifyMzansi", {
              body: description,
              icon: "/icons/icon-192.png?v=10",
              tag: notificationId ? `lead-${notificationId}` : "lead-alert",
            });

            fallbackNotice.onclick = () => {
              window.focus();
              window.location.assign(targetHref);
            };
          });

        return;
      }

      const browserNotice = new Notification("VerifyMzansi", {
        body: description,
        icon: "/icons/icon-192.png?v=10",
        tag: notificationId ? `lead-${notificationId}` : "lead-alert",
      });

      browserNotice.onclick = () => {
        window.focus();
        window.location.assign(targetHref);
      };
    },
  });

  return null;
}
