// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { LocationControl } from "./LocationControl";

// Stub the vendored map module: real useMap needs a live MapLibre instance, and
// the control-button primitives only need to forward onClick/label here.
const mocks = vi.hoisted(() => ({
  flyTo: vi.fn(),
}));

vi.mock("@/components/ui/map", () => ({
  useMap: () => ({ map: { flyTo: mocks.flyTo }, isLoaded: true }),
  ControlGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ControlButton: ({
    onClick,
    label,
    children,
    disabled,
  }: {
    onClick: () => void;
    label: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} aria-label={label} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function stubNavigator(partial: Partial<Navigator>) {
  vi.stubGlobal("navigator", partial as Navigator);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LocationControl", () => {
  it("renders nothing when geolocation is unsupported", () => {
    stubNavigator({});
    const { container } = render(<LocationControl />);
    expect(container.firstChild).toBeNull();
  });

  it("flies to the user's location when permission is granted", async () => {
    stubNavigator({
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { longitude: -120.5, latitude: 38.5 },
          } as GeolocationPosition),
      } as unknown as Geolocation,
      permissions: {
        query: async () => ({ state: "granted" }) as PermissionStatus,
      } as unknown as Permissions,
    });

    render(<LocationControl />);
    await userEvent.click(screen.getByLabelText("Find my location"));

    await waitFor(() =>
      expect(mocks.flyTo).toHaveBeenCalledWith(
        expect.objectContaining({ center: [-120.5, 38.5] }),
      ),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts and does not fly when permission is denied", async () => {
    stubNavigator({
      geolocation: {
        getCurrentPosition: vi.fn(),
      } as unknown as Geolocation,
      permissions: {
        query: async () => ({ state: "denied" }) as PermissionStatus,
      } as unknown as Permissions,
    });

    render(<LocationControl />);
    await userEvent.click(screen.getByLabelText("Find my location"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mocks.flyTo).not.toHaveBeenCalled();
  });
});
