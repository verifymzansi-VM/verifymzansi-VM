import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { officeToLocation, UseRegisteredOffice } from "./use-registered-office";

const office = {
  streetLines: ["12 Main Road"],
  suburb: "Empangeni Rail",
  city: "Empangeni",
  province: "KwaZulu-Natal",
  postalCode: "3880",
  cityKnown: true,
};

afterEach(() => vi.unstubAllGlobals());

describe("officeToLocation", () => {
  it("maps the office to location fields", () => {
    expect(officeToLocation(office)).toEqual({
      province: "KwaZulu-Natal",
      city: "Empangeni",
      town: "Empangeni Rail",
      address: "12 Main Road",
    });
  });

  it("offers nothing without a province and city", () => {
    expect(officeToLocation({ ...office, city: null })).toBeNull();
  });
});

describe("UseRegisteredOffice", () => {
  it("fills the location only when the owner taps it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stickers: { cipc: { registeredOffice: office } } }),
      })
    );
    const onUse = vi.fn();
    render(<UseRegisteredOffice businessId="b1" onUse={onUse} />);
    const button = await screen.findByRole("button", { name: /Use registered office/ });
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ city: "Empangeni" }));
  });

  it("stays hidden without the CIPC sticker", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stickers: { cipc: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<UseRegisteredOffice businessId="b1" onUse={vi.fn()} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
