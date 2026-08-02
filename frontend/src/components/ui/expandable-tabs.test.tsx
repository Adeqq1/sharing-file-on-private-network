import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell, Home, Settings } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandableTabs } from "./expandable-tabs";

afterEach(() => cleanup());

const tabs = [
  { title: "Dashboard", icon: Home },
  { title: "Notifications", icon: Bell },
  { type: "separator" as const },
  { title: "Settings", icon: Settings },
];

describe("ExpandableTabs", () => {
  it("selects a tab and calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ExpandableTabs tabs={tabs} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Dashboard" }));

    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("supports controlled selection", () => {
    render(<ExpandableTabs tabs={tabs} value={1} />);

    expect(screen.getByRole("tab", { name: "Notifications" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("clears selection on outside click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ExpandableTabs tabs={tabs} defaultValue={0} onChange={onChange} />);

    await user.click(document.body);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("skips separators during keyboard navigation", async () => {
    const user = userEvent.setup();

    render(<ExpandableTabs tabs={tabs} defaultValue={1} />);

    const notifications = screen.getByRole("tab", { name: "Notifications" });
    notifications.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("renders separators as hidden presentation elements", () => {
    render(<ExpandableTabs tabs={tabs} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
