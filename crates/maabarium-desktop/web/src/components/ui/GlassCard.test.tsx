import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GlassCard } from "./GlassCard";

describe("GlassCard", () => {
  it("hides its body when collapsed", () => {
    render(
      <GlassCard title="Evidence" collapsible collapsed>
        <div>Panel content</div>
      </GlassCard>,
    );

    expect(screen.queryByText("Panel content")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Expand Evidence/i }),
    ).toBeTruthy();
  });

  it("calls the collapse handler when the toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();

    render(
      <GlassCard
        title="Run Analytics"
        collapsible
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
      >
        <div>Analytics body</div>
      </GlassCard>,
    );

    await user.click(
      screen.getByRole("button", { name: /Collapse Run Analytics/i }),
    );

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Analytics body")).toBeTruthy();
  });
});
