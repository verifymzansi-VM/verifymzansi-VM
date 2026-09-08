import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ListingContactActions } from "@/app/listing/[id]/listing-contact-actions";
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button onClick={() => onSuccess("token")}>Complete CAPTCHA</button>
  ),
}));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

describe("seller contact actions", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("makes WhatsApp available without a phone reveal and attaches listing context", () => {
    render(
      <ListingContactActions
        listingId="abc"
        listingTitle="Garden cottage"
        ownerWhatsapp="082 123 4567"
        contactMethods={["whatsapp"]}
      />
    );
    const link = screen.getByRole("link", { name: "Chat on WhatsApp" });
    expect(link.getAttribute("href")).toContain("https://wa.me/27821234567?");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("Garden cottage");
    expect(screen.queryByRole("button", { name: "Send an enquiry" })).toBeNull();
    expect(screen.queryByText("Show Contact")).toBeNull();
  });
  it("sends reply details and shows saved status only after persistence", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true })));
    render(<ListingContactActions listingId="abc" contactMethods={["form"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Send an enquiry" }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Buyer Name" } });
    fireEvent.change(screen.getByLabelText("Reply email"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("WhatsApp number (optional)"), {
      target: { value: "0821234567" },
    });
    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "Is this still available?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Enquiry saved!")).toBeInTheDocument());
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      buyerName: "Buyer Name",
      buyerEmail: "buyer@example.com",
      buyerPhone: "0821234567",
      listingId: "abc",
    });
  });
});
