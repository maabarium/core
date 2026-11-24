import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { UpdatesCard } from "./UpdatesCard";

test("the saved update channel is announced and can be changed by keyboard", async () => {
  const user = userEvent.setup();
  const props = {
    desktopSetup: null, updateCheck: null, checkingForUpdates: false,
    installingUpdate: false, savingPreferences: false,
    onCheckForUpdates: vi.fn(), onInstallUpdate: vi.fn(), onSelectChannel: vi.fn(),
    onRemindLater: vi.fn(), onClearReminder: vi.fn(),
  };
  const updater = { currentVersion: "0.5.2", configured: true,
    endpoint: "https://example.test/latest.json", channel: "stable" };
  const { rerender } = render(<UpdatesCard {...props} updater={updater} />);
  const channels = within(screen.getByRole("group", { name: "Update channel" }));
  const stable = channels.getByRole("button", { name: "stable", pressed: true });
  stable.focus();
  await user.tab();
  expect(document.activeElement).toBe(channels.getByRole("button", { name: "beta", pressed: false }));
  await user.keyboard("{Enter}");
  expect(props.onSelectChannel).toHaveBeenCalledExactlyOnceWith("beta");
  rerender(<UpdatesCard {...props} updater={{ ...updater, channel: "beta" }} />);
  expect(channels.getByRole("button", { name: "beta", pressed: true })).toBeTruthy();
  expect(channels.getByRole("button", { name: "stable", pressed: false })).toBeTruthy();
});
