/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  AutoplayPolicyProvider,
  DisableMobileAutoplay,
  useAutoplayPolicy,
} from "./autoplay-policy-context";

const { hoverCapabilityMock } = vi.hoisted(() => ({
  hoverCapabilityMock: vi.fn(),
}));

vi.mock("@/hooks/use-hover-capability", () => ({
  useHoverCapability: hoverCapabilityMock,
}));

function Probe() {
  const { disableAutoplay } = useAutoplayPolicy();
  return <output data-testid="policy">{disableAutoplay ? "disabled" : "allowed"}</output>;
}

describe("autoplay policy context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoverCapabilityMock.mockReturnValue(true);
  });

  it("allows autoplay by default when no provider is present", () => {
    render(<Probe />);
    expect(screen.getByTestId("policy").textContent).toBe("allowed");
  });

  it("applies an explicit provider value", () => {
    render(
      <AutoplayPolicyProvider disableAutoplay>
        <Probe />
      </AutoplayPolicyProvider>
    );
    expect(screen.getByTestId("policy").textContent).toBe("disabled");
  });

  it("disables autoplay on mobile browsers (no hover-capable fine pointer)", () => {
    hoverCapabilityMock.mockReturnValue(false);
    render(
      <DisableMobileAutoplay>
        <Probe />
      </DisableMobileAutoplay>
    );
    expect(screen.getByTestId("policy").textContent).toBe("disabled");
  });

  it("keeps autoplay enabled on hover-capable desktop browsers", () => {
    hoverCapabilityMock.mockReturnValue(true);
    render(
      <DisableMobileAutoplay>
        <Probe />
      </DisableMobileAutoplay>
    );
    expect(screen.getByTestId("policy").textContent).toBe("allowed");
  });

  it("hydrates a late consumer with the server policy after the provider detects desktop hover", async () => {
    const container = document.createElement("div");
    const errors: unknown[] = [];
    hoverCapabilityMock.mockReturnValue(false);
    container.innerHTML = renderToString(
      <DisableMobileAutoplay>
        <Probe />
      </DisableMobileAutoplay>
    );
    expect(container.textContent).toBe("disabled");
    // The page shell has already mounted before this streamed consumer hydrates.
    hoverCapabilityMock.mockReturnValue(true);
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        container,
        <DisableMobileAutoplay>
          <Probe />
        </DisableMobileAutoplay>,
        {
          onRecoverableError: (error) => errors.push(error),
        }
      );
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("allowed");
    await act(async () => root!.unmount());
  });
});
