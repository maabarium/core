import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { GroupRunPanel } from "./GroupRunPanel";

test("group deletion requires a deliberate confirmation", async () => {
  const user = userEvent.setup();
  const deleteGroup = vi.fn();
  render(
    <GroupRunPanel
      groups={[{
        name: "Research batch", description: "", createdAt: "",
        blueprints: [], executionMode: "sequential", schedule: null,
        telegramEnabled: false,
      }]}
      groupRuns={[]}
      experiments={[]}
      telegramConfig={null}
      availableBlueprints={[]}
      defaultBlueprintName=""
      defaultBlueprintPath=""
      onCreateGroup={vi.fn()}
      onAddBlueprint={vi.fn()}
      onRunGroup={vi.fn()}
      onStopGroup={vi.fn()}
      onSetSchedule={vi.fn()}
      onDeleteGroup={deleteGroup}
    />,
  );
  const open = screen.getByRole("button", { name: "Delete group Research batch" });
  await user.click(open);
  expect(deleteGroup).not.toHaveBeenCalled();
  const confirmation = () => within(screen.getByRole("group", { name: "Confirm deletion of Research batch" }));
  await user.click(confirmation().getByRole("button", { name: "Cancel" }));
  expect(deleteGroup).not.toHaveBeenCalled();
  await user.click(open);
  await user.click(confirmation().getByRole("button", { name: "Delete group" }));
  expect(deleteGroup).toHaveBeenCalledExactlyOnceWith("Research batch");
});

const baseProps = {
  groupRuns: [],
  experiments: [],
  telegramConfig: null,
  availableBlueprints: [],
  defaultBlueprintName: "",
  defaultBlueprintPath: "",
  onCreateGroup: vi.fn(),
  onAddBlueprint: vi.fn(),
  onRunGroup: vi.fn(),
  onStopGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
};

const group = (overrides = {}) => ({
  name: "Nightly", description: "", createdAt: "",
  blueprints: [{ blueprintName: "alpha", blueprintPath: "/fixtures/alpha.toml", sortOrder: 0, notificationsEnabled: true }],
  executionMode: "sequential" as const, schedule: null, telegramEnabled: true,
  ...overrides,
});

test("escape closes the delete confirmation and returns focus", async () => {
  const user = userEvent.setup();
  render(<GroupRunPanel {...baseProps} groups={[group()]} onSetSchedule={vi.fn()} />);
  const trash = screen.getByRole("button", { name: "Delete group Nightly" });
  await user.click(trash);
  const confirm = screen.getByRole("group", { name: "Confirm deletion of Nightly" });
  expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "Cancel" }));
  fireEvent.keyDown(confirm, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Confirm deletion of Nightly" })).toBeNull();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  expect(document.activeElement).toBe(trash);
});

test("row controls name their group and empty groups cannot run", () => {
  render(
    <GroupRunPanel {...baseProps} groups={[group(), group({ name: "Empty", blueprints: [] })]} onSetSchedule={vi.fn()} />,
  );
  expect((screen.getByRole("button", { name: "Run group Nightly" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Run group Empty" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Schedule Nightly" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add blueprint to Empty" })).toBeTruthy();
  const toggle = screen.getByRole("button", { name: /^Nightly/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

test("weekly schedules are saved in local time with Sunday as 0", async () => {
  const user = userEvent.setup();
  const onSetSchedule = vi.fn();
  render(<GroupRunPanel {...baseProps} groups={[group()]} onSetSchedule={onSetSchedule} />);
  await user.click(screen.getByRole("button", { name: "Schedule Nightly" }));
  await user.selectOptions(screen.getByRole("combobox"), "weekly");
  const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
  // 2026-11-22 is a Sunday.
  fireEvent.change(input, { target: { value: "2026-11-22T10:05" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSetSchedule).toHaveBeenCalledWith("Nightly", "cron", "5 10 * * 0", true);
});

test("saved schedules are described in local time and prefill the editor", async () => {
  const user = userEvent.setup();
  render(
    <GroupRunPanel
      {...baseProps}
      groups={[group({ schedule: { kind: { type: "cron", expression: "30 7 * * *" }, enabled: true, lastRunAt: null, nextRunAt: null } })]}
      onSetSchedule={vi.fn()}
    />,
  );
  expect(screen.getByText("Every day at 07:30")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Schedule Nightly" }));
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("daily");
  expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe("07:30");
});

test("run history is labelled with its start time", async () => {
  const user = userEvent.setup();
  const startedAt = "2026-11-20T09:00:00Z";
  render(
    <GroupRunPanel
      {...baseProps}
      groups={[group()]}
      groupRuns={[{
        id: "abcdef0123456789", groupName: "Nightly", executionMode: "sequential",
        startedAt, completedAt: startedAt, status: "failed", summary: "0 promoted",
        experiments: [{ id: 1, groupRunId: "abcdef0123456789", experimentId: null, blueprintName: "alpha",
          blueprintPath: "/fixtures/alpha.toml", sortOrder: 0, status: "failed", startedAt, completedAt: startedAt,
          error: "Engine error: synthetic" }],
      }]}
      onSetSchedule={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /^Nightly/ }));
  const label = new Date(startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const runButton = screen.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await user.click(runButton);
  await user.click(screen.getByRole("button", { name: /alpha/ }));
  expect(screen.getByText("Error: Engine error: synthetic")).toBeTruthy();
});
