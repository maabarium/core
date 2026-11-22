import { expect, test } from "vitest";
import { normalizeConsoleState } from "./normalizers";
import type { ConsoleState } from "../types/console";

test("telegram settings sent in snake_case keep their event flags", () => {
  const state = normalizeConsoleState({
    telegramConfig: {
      chat_id: "-100000",
      enabled: true,
      notify_on_start: false,
      notify_on_complete: true,
      notify_on_error: true,
      notify_on_promotion: false,
      updated_at: "2026-11-22T00:00:00Z",
      bot_token: "must-not-survive",
    },
  } as unknown as ConsoleState);
  expect(state.telegramConfig).toEqual({
    chatId: "-100000",
    enabled: true,
    notifyOnStart: false,
    notifyOnComplete: true,
    notifyOnError: true,
    notifyOnPromotion: false,
    updatedAt: "2026-11-22T00:00:00Z",
  });
});

test("cron schedules sent as externally tagged enums are read", () => {
  const state = normalizeConsoleState({
    runGroups: [
      {
        name: "g",
        created_at: "",
        blueprints: [],
        execution_mode: "sequential",
        schedule: {
          kind: { cron: { expression: "0 9 * * 0" } },
          enabled: true,
          last_run_at: null,
          next_run_at: null,
        },
        telegram_enabled: true,
      },
    ],
  } as unknown as ConsoleState);
  expect(state.runGroups[0].schedule?.kind).toEqual({ type: "cron", expression: "0 9 * * 0" });
});
