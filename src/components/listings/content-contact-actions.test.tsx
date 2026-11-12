import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MessageSquare } from "lucide-react";
import { ListingContactActions } from "@/app/listing/[id]/listing-contact-actions";
import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { businessContactConfig } from "@/components/listings/contact-action-configs";

const { widgetProps } = vi.hoisted(() => ({
  widgetProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: (props: { onSuccess: (token: string) => void }) => {
    widgetProps.push(props);
    return <button onClick={() => props.onSuccess("token")}>Complete CAPTCHA</button>;
  },
}));
vi.mock("@/lib/utils/csrf-client", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

describe("seller contact actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    widgetProps.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requests a fresh challenge before revealing private foundation contact numbers", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ phone: "+27821234567", whatsapp: "+27821234567" }))
      );
    const view = render(
      <ListingContactActions
        listingId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001"
        revealable={{ phone: true, whatsapp: true }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show contact number" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+27821234567")
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      targetType: "listing",
      turnstileToken: "token",
    });
    view.rerender(
      <ListingContactActions
        listingId="aaaaaaaa-aaaa-4aaa-8aaa-000000000002"
        revealable={{ phone: true, whatsapp: true }}
      />
    );
    expect(screen.queryByRole("link", { name: /Call/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show contact number" })).toBeInTheDocument();
  });
  it("makes WhatsApp available without a phone reveal and attaches listing context", () => {
    render(
      <ListingContactActions
        listingId="abc"
        listingTitle="Garden cottage"
        ownerWhatsapp="082 123 4567"
      />
    );
    const link = screen.getByRole("link", { name: "WhatsApp 082 123 4567" });
    expect(link.getAttribute("href")).toContain("https://wa.me/27821234567?");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("Garden cottage");
    expect(screen.queryByText("Show Contact")).toBeNull();
  });
  it("always offers a private enquiry on Market listings, so the empty-contact note never shows", () => {
    render(<ListingContactActions listingId="abc" />);
    expect(screen.getByRole("button", { name: "Send an enquiry" })).toBeInTheDocument();
    expect(screen.queryByText("No contact details added.")).toBeNull();
  });
  it("sends reply details and shows saved status only after persistence", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true })));
    render(<ListingContactActions listingId="abc" />);
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
  it("shows the check before a number as the compact, out-of-sight widget that fits a 320 px phone", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    render(<ListingContactActions listingId="abc" revealable={{ phone: true, whatsapp: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show contact number" }));
    expect(widgetProps.at(-1)).toMatchObject({ size: "compact", appearance: "interaction-only" });
    // While the check runs, the button shows it is working.
    expect(screen.getByRole("button", { name: "Show contact number" })).toBeDisabled();
  });
  it("says no number was shared when the reveal comes back empty, and points to the enquiry", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ phone: null, whatsapp: null }))
    );
    render(<ListingContactActions listingId="abc" revealable={{ phone: true, whatsapp: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show contact number" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
    await waitFor(() =>
      expect(screen.getByText("No number shared. Send an enquiry instead.")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Send an enquiry" })).toBeInTheDocument();
    expect(screen.queryByText("No contact details added.")).toBeNull();
  });
  const businessCard = (hasOtherContact: boolean) => (
    <ContentContactActions
      showPhoneButton
      showMessageButton={false}
      messageIcon={MessageSquare}
      config={businessContactConfig("biz-1", "Workshop", "/mzansi-business/biz-1")}
      hasOtherContact={hasOtherContact}
    />
  );
  it("does not say 'No contact details added.' under an email or website the page shows", () => {
    render(businessCard(true));
    expect(screen.queryByText("No contact details added.")).toBeNull();
  });
  it("still says 'No contact details added.' when there is truly nothing", () => {
    render(businessCard(false));
    expect(screen.getByText("No contact details added.")).toBeInTheDocument();
  });
});
