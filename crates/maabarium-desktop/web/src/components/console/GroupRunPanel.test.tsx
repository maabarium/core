import { render, screen, within } from "@testing-library/react";
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
