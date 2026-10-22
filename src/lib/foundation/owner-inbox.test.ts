import { describe, expect, it, vi } from "vitest";
import {
  FoundationInboxError,
  buildFoundationEnquiry,
  foundationOwnerInboxTopic,
  isPlainText,
  markFoundationNotificationsRead,
  readFoundationEnquiries,
  readFoundationNotifications,
  setFoundationEnquiryStatus,
} from "./owner-inbox";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationAuthenticatedApi & {
    rpc: ReturnType<typeof vi.fn>;
  };
const enquiry = {
  request_id: request,
  post_id: post,
  buyer_email: " Buyer@Example.co.za ",
  message: " Is this still available?\r\nThanks ",
};

describe("foundation owner inbox adapter", () => {
  it("normalizes an enquiry and binds only the verified sender", () => {
    expect(buildFoundationEnquiry({ ...enquiry, buyer_phone: "082 123 4567" }, id)).toEqual({
      p_request_id: request,
      p_post_id: post,
      p_buyer_email: "buyer@example.co.za",
      p_message: "Is this still available?\nThanks",
      p_sender: id,
      p_buyer_phone: "+27821234567",
    });
    expect(buildFoundationEnquiry(enquiry, null)).not.toHaveProperty("p_sender");
  });

  it("refuses unsafe, oversized and identity-bearing input", () => {
    for (const input of [
      { ...enquiry, message: "short" },
      { ...enquiry, message: "x".repeat(1001) },
      { ...enquiry, message: "Hidden " + String.fromCharCode(0x202e) + " override text" },
      { ...enquiry, buyer_email: "not-an-email" },
      { ...enquiry, buyer_name: "Two" + String.fromCharCode(10) + "Lines" },
      { ...enquiry, buyer_phone: "12345" },
      { ...enquiry, sender: id },
      { ...enquiry, owner_id: id },
    ])
      expect(() => buildFoundationEnquiry(input, null)).toThrow(FoundationInboxError);
    expect(() => buildFoundationEnquiry(enquiry, "not-a-uuid")).toThrow(FoundationInboxError);
    expect(isPlainText("Line one" + String.fromCharCode(10) + "two", 2, 80, true)).toBe(true);
    expect(isPlainText("Zero" + String.fromCharCode(0x200b) + "width", 2, 80, true)).toBe(false);
  });

  it("parses strict inbox pages and maps refusals", async () => {
    const page = {
      items: [
        {
          id,
          post_id: post,
          post_kind: "event",
          post_title: "Synthetic event",
          buyer_name: null,
          buyer_email: "buyer@example.org",
          buyer_phone: null,
          email_confirmed: false,
          message: "Synthetic message text",
          status: "new",
          created_at: "2026-10-22T08:00:00.123+00:00",
          updated_at: "2026-10-22T08:00:00.123+00:00",
        },
      ],
      unread_count: 1,
      next_cursor: null,
    };
    const client = api({ data: page, error: null });
    await expect(readFoundationEnquiries(client, { limit: 10, status: "new" })).resolves.toEqual(
      page
    );
    expect(client.rpc).toHaveBeenCalledWith("list_my_enquiries", { p_limit: 10, p_status: "new" });
    await expect(
      readFoundationEnquiries(api({ data: { ...page, owner_id: id }, error: null }))
    ).rejects.toMatchObject({ reason: "unavailable" });
    await expect(
      readFoundationEnquiries(api({ data: null, error: { details: "inbox_page_invalid" } }))
    ).rejects.toMatchObject({ reason: "invalid" });
    await expect(readFoundationEnquiries(client, { limit: 500 })).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("returns null for a foreign status change and marks all when ids are omitted", async () => {
    await expect(
      setFoundationEnquiryStatus(api({ data: null, error: null }), { id, status: "read" })
    ).resolves.toBeNull();
    await expect(
      setFoundationEnquiryStatus(api({ data: null, error: null }), { id, status: "new" })
    ).rejects.toMatchObject({ reason: "invalid" });
    const client = api({ data: { marked: 2, unread_count: 0 }, error: null });
    await markFoundationNotificationsRead(client, {});
    expect(client.rpc).toHaveBeenCalledWith("mark_my_notifications_read", {});
  });

  it("parses enquiry and organisation notifications and refuses unknown kinds", async () => {
    const note = {
      id,
      kind: "organisation_application_decided",
      post_id: post,
      post_title: "Synthetic workshop",
      organisation_name: "Synthetic Chamber",
      created_at: "2026-10-22T08:00:00Z",
      read_at: null,
    };
    const page = { items: [note], unread_count: 1, next_cursor: null };
    await expect(readFoundationNotifications(api({ data: page, error: null }))).resolves.toEqual(
      page
    );
    await expect(
      readFoundationNotifications(
        api({ data: { ...page, items: [{ ...note, kind: "promotion" }] }, error: null })
      )
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("names the private owner topic only from a valid account id", () => {
    expect(foundationOwnerInboxTopic(id.toUpperCase())).toBe("owner:" + id);
    expect(() => foundationOwnerInboxTopic("owner:x")).toThrow();
  });
});
