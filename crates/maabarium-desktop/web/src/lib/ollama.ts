import type { OllamaStatus } from "../types/console";

function uniqueNonEmptyStrings(
  values: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );
}

export function listOllamaModelNames(
  ollama: OllamaStatus | null | undefined,
  extraNames: Array<string | null | undefined> = [],
): string[] {
  return uniqueNonEmptyStrings([
    ...(ollama?.models.map((model) => model.name) ?? []),
    ...(ollama?.recommendedModels ?? []),
    ...extraNames,
  ]);
}
