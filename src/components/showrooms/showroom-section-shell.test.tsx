import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReactDom from "react-dom";

const preloadMock = vi.hoisted(() => vi.fn());
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactDom>()),
  preload: preloadMock,
}));

import { preloadShowroomBackground, ShowroomSectionShell } from "./showroom-section-shell";
import { mzansiMarketShowroomBackground } from "./showroom-backgrounds";

describe("preloadShowroomBackground", () => {
  beforeEach(() => preloadMock.mockClear());

  it("preloads each artwork only for the screens its <picture> source serves", () => {
    preloadShowroomBackground(mzansiMarketShowroomBackground);

    expect(preloadMock).toHaveBeenCalledWith(mzansiMarketShowroomBackground.src, {
      as: "image",
      fetchPriority: "high",
      // The <picture> source query, written without a comma for the Link header.
      media: "not all and (max-width: 767.98px) and (orientation: portrait)",
    });
    expect(preloadMock).toHaveBeenCalledWith(mzansiMarketShowroomBackground.mobileSrc, {
      as: "image",
      fetchPriority: "high",
      media: "(max-width: 767.98px) and (orientation: portrait)",
    });
  });

  it("leaves a single shared artwork to next/image", () => {
    preloadShowroomBackground({ src: "/images/showrooms/shared.avif" });

    expect(preloadMock).not.toHaveBeenCalled();
  });
});

describe("ShowroomSectionShell artwork", () => {
  it("keeps the same artwork size while loading and once listings arrive", () => {
    const loading = render(
      <ShowroomSectionShell
        sectionClassName="showroom-viewport"
        background={mzansiMarketShowroomBackground}
      >
        <div />
      </ShowroomSectionShell>
    );
    const populated = render(
      <ShowroomSectionShell
        sectionClassName="showroom-viewport"
        background={mzansiMarketShowroomBackground}
        hasListings
      >
        <div />
      </ShowroomSectionShell>
    );

    const className = (container: HTMLElement) =>
      container.querySelector('[data-showroom-background="responsive"]')?.className;
    expect(className(loading.container)).toBe(className(populated.container));
  });
});
