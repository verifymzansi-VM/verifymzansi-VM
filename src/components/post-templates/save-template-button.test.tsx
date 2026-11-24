import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveTemplateButton } from "./save-template-button";

const { switches, toast } = vi.hoisted(() => ({
  switches: { SHOW_POST_TEMPLATES: true, SHOW_PACKAGE_TEAMS: false },
  toast: vi.fn(),
}));
vi.mock("@/lib/hidden-features", () => switches);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
}));

const data = { category: "vehicles", categoryAttributes: { make: "Toyota" } };
const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.clearAllMocks();
  switches.SHOW_POST_TEMPLATES = true;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Save as template", () => {
  it("names and saves the form's template fields while the package runs", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? answer({ id: "00000000-0000-4000-8000-0000000000e1", name: "Bakkie", replaced: false })
        : answer({ package_running: true, templates: [] })
    );
    render(<SaveTemplateButton defaultName="Demo bakkie 2.4" data={() => data} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save as template" }));
    expect(screen.getByRole("heading", { name: "Save as a template" })).toBeInTheDocument();
    expect(screen.getByText("Title, price, year and mileage")).toBeInTheDocument();
    expect(screen.getByText("You can keep up to 20.")).toBeInTheDocument();
    const name = screen.getByLabelText("Template name");
    expect(name).toHaveValue("Demo bakkie 2.4");
    fireEvent.change(name, { target: { value: "Used bakkie" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Template saved" }))
    );
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(url).toBe("/api/post-templates");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Used bakkie", data });
    expect(screen.queryByRole("heading", { name: "Save as a template" })).not.toBeInTheDocument();
  });

  it("shows the refusal and stays open", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? answer({ error: "You can keep up to 20 templates." }, 409)
        : answer({ package_running: true, templates: [] })
    );
    render(<SaveTemplateButton defaultName="Bakkie" data={() => data} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save as template" }));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can keep up to 20 templates.");
    expect(screen.getByRole("heading", { name: "Save as a template" })).toBeInTheDocument();
  });

  it("is not shown without a running package or with the switch off", async () => {
    fetchMock.mockImplementation(() => answer({ package_running: false, templates: [] }));
    const { unmount } = render(<SaveTemplateButton defaultName="" data={() => data} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Save as template" })).not.toBeInTheDocument();
    unmount();
    fetchMock.mockClear();
    switches.SHOW_POST_TEMPLATES = false;
    render(<SaveTemplateButton defaultName="" data={() => data} />);
    expect(screen.queryByRole("button", { name: "Save as template" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
