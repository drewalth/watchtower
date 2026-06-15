// @vitest-environment jsdom
import { Children, cloneElement, isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MapStyleControl } from "./MapStyleControl";

// Control-button primitives from the vendored map module.
vi.mock("@/components/ui/map", () => ({
  ControlGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ControlButton: ({
    onClick,
    label,
    children,
  }: {
    onClick?: () => void;
    label: string;
    children: React.ReactNode;
  }) => (
    <button onClick={onClick} aria-label={label}>
      {children}
    </button>
  ),
}));

// Faithful-enough stub of the Radix dropdown: preserves the
// value/onValueChange contract so we test our wiring, not the library.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-active={value}>
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(
              child as React.ReactElement<{ onSelect?: (v: string) => void }>,
              {
                onSelect: onValueChange,
              },
            )
          : child,
      )}
    </div>
  ),
  DropdownMenuRadioItem: ({
    children,
    value,
    onSelect,
  }: {
    children: React.ReactNode;
    value: string;
    onSelect?: (v: string) => void;
  }) => (
    <button role="menuitemradio" onClick={() => onSelect?.(value)}>
      {children}
    </button>
  ),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("MapStyleControl", () => {
  it("renders a labelled trigger and one option per style", () => {
    render(<MapStyleControl styleId="light" onStyleChange={vi.fn()} />);
    expect(screen.getByLabelText(/map style/i)).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("calls onStyleChange with the chosen style id", async () => {
    const onStyleChange = vi.fn();
    render(<MapStyleControl styleId="light" onStyleChange={onStyleChange} />);

    await userEvent.click(
      screen.getByRole("menuitemradio", { name: /satellite/i }),
    );

    expect(onStyleChange).toHaveBeenCalledWith("satellite");
  });

  it("marks the current style as active", () => {
    const { container } = render(
      <MapStyleControl styleId="dark" onStyleChange={vi.fn()} />,
    );
    expect(container.querySelector("[data-active='dark']")).toBeTruthy();
  });
});
