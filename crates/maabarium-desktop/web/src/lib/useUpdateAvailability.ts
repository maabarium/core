import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { UpdateCheckResult, UpdaterConfigurationState } from "../types/console";

export const UPDATE_STARTUP_DELAY_MS = 15_000;
export const UPDATE_PERIOD_MS = 6 * 60 * 60 * 1_000;
export const UPDATE_RETRY_MS = 30 * 60 * 1_000;

function identity(config: UpdaterConfigurationState | null | undefined) {
  return JSON.stringify([config?.currentVersion, config?.channel, config?.endpoint]);
}

const pending = new Map<string, Promise<UpdateCheckResult>>();

// Menu, maintenance and background checks for the same release channel share
// one native manifest request. Downloads are a separate, explicit action.
export function requestUpdateCheck(config?: UpdaterConfigurationState | null) {
  const key = identity(config);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = invoke<UpdateCheckResult>("check_for_updates").finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function useUpdateAvailability(config: UpdaterConfigurationState | undefined, automatic: boolean) {
  const key = identity(config);
  const enabled = automatic && config?.configured === true;
  const [checks, setChecks] = useState<Record<string, UpdateCheckResult>>({});
  const [installedVersion, setInstalledVersion] = useState<string>();
  const installed = installedVersion !== undefined && installedVersion === config?.currentVersion;

  const recordCheck = useCallback((result: UpdateCheckResult) => {
    setChecks((previous) => ({ ...previous, [identity(result)]: result }));
    return result;
  }, []);
  const check = () => requestUpdateCheck(config).then(recordCheck);
  const markInstalled = () => setInstalledVersion(config?.currentVersion);

  useEffect(() => {
    if (!enabled || installed) return;
    let disposed = false;
    let checking = false;
    let due = Date.now() + UPDATE_STARTUP_DELAY_MS;
    let timer: number | undefined;
    // Use only stable scalar configuration values, not the frequently
    // refreshed console snapshot object.
    const checkConfig = config;
    const schedule = () => {
      window.clearTimeout(timer);
      if (disposed || checking || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        if (disposed || checking || document.visibilityState === "hidden") return;
        checking = true;
        void requestUpdateCheck(checkConfig).then((result) => {
          if (disposed) return;
          if (identity(result) === key) recordCheck(result);
          due = Date.now() + UPDATE_PERIOD_MS;
        }, () => {
          due = Date.now() + UPDATE_RETRY_MS;
        }).finally(() => {
          checking = false;
          schedule();
        });
      }, Math.max(0, due - Date.now()));
    };
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [enabled, installed, key, recordCheck]);

  const latest = config?.configured && !installed ? checks[key] : undefined;
  return { availableUpdate: latest?.configured && latest.available && latest.version ? latest : undefined,
    check, recordCheck, markInstalled };
}
