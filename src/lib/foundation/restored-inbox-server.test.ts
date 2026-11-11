import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoredOwnerEnquiries } from "./restored-inbox-server";
import { readFoundationPresentedEnquiries } from "./owner-inbox";
import { readFoundationServerSession } from "./server-session";

vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./owner-inbox", () => ({ readFoundationPresentedEnquiries: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1);
const api = { marker: "api" };
const enquiry = {
  id: uuid(10),
  post_id: uuid(11),
  post_kind: "business",
  post_area: "tourism_events",
  post_title: "Seaside guest house",
  message: "Is the room free next weekend?",
  status: "new",
  buyer_name: "Ayanda",
  buyer_email: "ayanda@example.test",
  email_confirmed: true,
  buyer_phone: null,
  created_at: "2026-11-10T08:00:00+02:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: owner }, api } as never);
});

describe("restoredOwnerEnquiries", () => {
  it("reads up to fifty enquiries and presents them as the restored lead cards", async () => {
    vi.mocked(readFoundationPresentedEnquiries).mockResolvedValueOnce({
      items: [enquiry],
    } as never);
    await expect(restoredOwnerEnquiries(owner)).resolves.toEqual([
      {
        id: enquiry.id,
        target_id: enquiry.post_id,
        target_type: "business",
        target_href: `/tourism-events/${enquiry.post_id}`,
        message: enquiry.message,
        status: "new",
        buyer_name: "Ayanda",
        buyer_email: "ayanda@example.test",
        email_confirmed: true,
        buyer_phone: null,
        created_at: enquiry.created_at,
        listings: { title: "Seaside guest house" },
      },
    ]);
    expect(readFoundationPresentedEnquiries).toHaveBeenCalledWith(api, { limit: 50 });
  });

  it("refuses when the session now belongs to another account", async () => {
    await expect(restoredOwnerEnquiries(uuid(2))).rejects.toThrow("Inbox account changed");
    expect(readFoundationPresentedEnquiries).not.toHaveBeenCalled();
  });
});
