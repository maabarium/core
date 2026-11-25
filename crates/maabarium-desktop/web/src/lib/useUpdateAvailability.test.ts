import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestUpdateCheck, UPDATE_PERIOD_MS, UPDATE_RETRY_MS,
  UPDATE_STARTUP_DELAY_MS, useUpdateAvailability } from "./useUpdateAvailability";
import type { UpdateCheckResult } from "../types/console";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const stable = { currentVersion: "0.5.3", channel: "stable", endpoint: "https://example.com/stable", configured: true };
const beta = { ...stable, channel: "beta", endpoint: "https://example.com/beta" };
const available = { ...stable, version: "0.5.4", available: true, date: null, body: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

it("checks quietly after startup and at the due interval, and clears a withdrawn update", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(available)
    .mockResolvedValueOnce({ ...available, available: false, version: null });
  const hook = renderHook(() => useUpdateAvailability(stable, true));
  await advance(UPDATE_STARTUP_DELAY_MS - 1);
  expect(invoke).not.toHaveBeenCalled();
  await advance(1);
  expect(hook.result.current.availableUpdate?.version).toBe("0.5.4");
  window.dispatchEvent(new Event("focus"));
  await advance(UPDATE_PERIOD_MS - 1);
  expect(invoke).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(hook.result.current.availableUpdate).toBeUndefined();
  expect(vi.mocked(invoke).mock.calls).toEqual([["check_for_updates"], ["check_for_updates"]]);
});

it("defers a due check while hidden, retries a failure, and stops after install", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(available);
  const hook = renderHook(() => useUpdateAvailability(stable, true));
  await advance(UPDATE_STARTUP_DELAY_MS + UPDATE_PERIOD_MS);
  expect(invoke).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await advance(1);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(hook.result.current.availableUpdate).toBeUndefined();
  await advance(UPDATE_RETRY_MS);
  expect(hook.result.current.availableUpdate?.version).toBe("0.5.4");
  act(() => hook.result.current.markInstalled());
  await advance(UPDATE_PERIOD_MS);
  expect(hook.result.current.availableUpdate).toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("shares an in-flight check and ignores a reply from the previous channel", async () => {
  let settle!: (value: UpdateCheckResult) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise<UpdateCheckResult>((resolve) => { settle = resolve; }))
    .mockResolvedValueOnce({ ...available, ...beta, version: "0.6.0-beta.1" });
  const hook = renderHook(({ config }) => useUpdateAvailability(config, true), { initialProps: { config: stable } });
  await advance(UPDATE_STARTUP_DELAY_MS);
  const manual = requestUpdateCheck(stable);
  expect(invoke).toHaveBeenCalledTimes(1);
  hook.rerender({ config: beta });
  await advance(UPDATE_STARTUP_DELAY_MS);
  expect(hook.result.current.availableUpdate?.version).toBe("0.6.0-beta.1");
  await act(async () => { settle(available); await manual; });
  expect(hook.result.current.availableUpdate?.channel).toBe("beta");
});

it("never polls an unconfigured or preview build", async () => {
  const a = renderHook(() => useUpdateAvailability({ ...stable, configured: false }, true));
  renderHook(() => useUpdateAvailability(stable, false));
  await advance(UPDATE_STARTUP_DELAY_MS + 2 * UPDATE_PERIOD_MS);
  expect(invoke).not.toHaveBeenCalled();
  expect(a.result.current.availableUpdate).toBeUndefined();
});
