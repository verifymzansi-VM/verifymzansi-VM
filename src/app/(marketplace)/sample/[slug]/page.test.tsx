import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSamplePost } from "@/lib/sample-posts/load";

const { mockFind } = vi.hoisted(() => ({ mockFind: vi.fn() }));

vi.mock("@/lib/sample-posts/load", () => ({ findSamplePost: mockFind }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

import sitemap from "@/app/sitemap";
import SamplePostPage, { generateMetadata } from "./page";

const post: ResolvedSamplePost = {
  slug: "beach-fish-braai",
  area: "event",
  category: "food_wine",
  title: "Fish braai on the beach",
  description: "Fresh fish on the coals, music and a view of the sea for the whole family.",
  province: "KwaZulu-Natal",
  city: "Richards Bay",
  videoKey: "media/samples/beach-fish-braai.mp4",
  posterKey: "media/samples/beach-fish-braai.webp",
  source: "committed",
  videoUrl: "https://media.verifymzansi.com/media/samples/beach-fish-braai.mp4",
  posterUrl: "https://media.verifymzansi.com/media/samples/beach-fish-braai.webp",
};

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("sample post page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the video, details and label as VerifyMzansi's example, and no trust badges", async () => {
    mockFind.mockResolvedValue(post);
    const { container } = render(await SamplePostPage(params(post.slug)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(post.title);
    expect(screen.getByText("Sample post · for display only")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This is an example post to show how VerifyMzansi looks. VerifyMzansi has not checked the business in the video."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Richards Bay, KwaZulu-Natal")).toBeInTheDocument();
    const presenter = container.querySelector("[data-sample-presenter]");
    expect(presenter).toHaveTextContent("VerifyMzansi");
    expect(presenter?.querySelector("svg image")?.getAttribute("href")).toContain(
      "brand-shield-small.png"
    );
    expect(container.querySelector("video")).toHaveAttribute("src", post.videoUrl);
    expect(container.textContent).not.toMatch(
      /ID reviewed|Phone verified|CIPC|Verified|permission/
    );
  });

  it("names a sample placed only by its province or region once", async () => {
    mockFind.mockResolvedValue({ ...post, city: "KwaZulu-Natal" });
    const province = render(await SamplePostPage(params(post.slug)));
    expect(screen.getByText("KwaZulu-Natal")).toBeInTheDocument();
    expect(province.container.textContent).not.toContain("KwaZulu-Natal, KwaZulu-Natal");
    province.unmount();

    mockFind.mockResolvedValue({ ...post, province: "Western Cape", city: "Western Cape coast" });
    render(await SamplePostPage(params(post.slug)));
    expect(screen.getByText("Western Cape coast")).toBeInTheDocument();
  });

  it("shows an event date until the day has passed, then hides only the date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-10T08:00:00Z"));
    mockFind.mockResolvedValue({ ...post, eventDate: "2026-12-16" });
    const upcoming = render(await SamplePostPage(params(post.slug)));
    expect(upcoming.container.querySelector("time")).toHaveAttribute("dateTime", "2026-12-16");
    upcoming.unmount();

    vi.setSystemTime(new Date("2026-12-17T08:00:00Z"));
    const past = render(await SamplePostPage(params(post.slug)));
    expect(past.container.querySelector("time")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(post.title);
  });

  it("has no contact area while VerifyMzansi's numbers are not set or not valid", async () => {
    mockFind.mockResolvedValue(post);
    vi.stubEnv("SAMPLE_CONTACT_PHONE", "12345");
    vi.stubEnv("SAMPLE_CONTACT_WHATSAPP", "");
    const { container } = render(await SamplePostPage(params(post.slug)));
    expect(container.querySelector("[data-sample-contact]")).toBeNull();
    expect(screen.queryByRole("button", { name: /number/i })).not.toBeInTheDocument();
  });

  it("reveals VerifyMzansi's numbers only after a click, never in the page", async () => {
    mockFind.mockResolvedValue(post);
    vi.stubEnv("SAMPLE_CONTACT_PHONE", "082 123 4567");
    vi.stubEnv("SAMPLE_CONTACT_WHATSAPP", "0821234568");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ phone: "+27821234567", whatsapp: "+27821234568" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(await SamplePostPage(params(post.slug)));
    expect(container.innerHTML).not.toMatch(/82\s?123\s?456/);
    expect(
      screen.getByText("These buttons contact VerifyMzansi, not the business in the video.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show VerifyMzansi's number" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Call VerifyMzansi/ })).toHaveAttribute(
        "href",
        "tel:+27821234567"
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sample-posts/contact",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: post.slug }) })
    );
    const whatsapp = screen.getByRole("link", { name: "WhatsApp VerifyMzansi" });
    expect(whatsapp.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/27821234568\?text=Hi%20VerifyMzansi/
    );
  });

  it("calls notFound for an unknown, removed or switched-off slug", async () => {
    mockFind.mockResolvedValue(null);
    await expect(SamplePostPage(params("missing"))).rejects.toThrow("notFound");
  });

  it("is never indexed", async () => {
    mockFind.mockResolvedValue(post);
    expect((await generateMetadata(params(post.slug))).robots).toEqual({
      index: false,
      follow: false,
    });
    mockFind.mockResolvedValue(null);
    expect((await generateMetadata(params("missing"))).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("is not in the sitemap", () => {
    expect(sitemap().some((entry) => entry.url.includes("/sample"))).toBe(false);
  });
});
