import { redirect } from "next/navigation";

/** Old address of the Tourism & Events area page. */
export default function AdminTourismEventsRedirect() {
  redirect("/admin/promotions-events");
}
