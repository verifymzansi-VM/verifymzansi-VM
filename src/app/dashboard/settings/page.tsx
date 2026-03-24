import { redirect } from "next/navigation";

/**
 * Settings page now redirects to the unified profile hub.
 * Kept as a server redirect to preserve bookmarks and shared links.
 */
export default function SettingsPage() {
  redirect("/dashboard/profile#account");
}
