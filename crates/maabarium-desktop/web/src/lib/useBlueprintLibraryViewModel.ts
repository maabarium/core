import { useMemo, useState } from "react";
import { formatBlueprintGroup } from "./blueprints";
import type { AvailableBlueprint } from "../types/console";

export type BlueprintDensity = "detailed" | "compact";

export type GroupedBlueprints = Array<{
  group: string;
  blueprints: AvailableBlueprint[];
}>;

type UseBlueprintLibraryViewModelArgs = {
  availableBlueprints: AvailableBlueprint[];
};

export function useBlueprintLibraryViewModel({
  availableBlueprints,
}: UseBlueprintLibraryViewModelArgs) {
  const [blueprintQuery, setBlueprintQuery] = useState("");
  const [blueprintLanguageFilter, setBlueprintLanguageFilter] =
    useState<string>("all");
  const [blueprintDensity, setBlueprintDensity] =
    useState<BlueprintDensity>("compact");
  const [collapsedBlueprintGroups, setCollapsedBlueprintGroups] = useState<
    Record<string, boolean>
  >({});

  const blueprintLanguageOptions = useMemo(() => {
    const languages = Array.from(
      new Set(
        availableBlueprints.map((blueprint) =>
          formatBlueprintGroup(blueprint.language, blueprint.libraryKind),
        ),
      ),
    );

    return languages.sort((left, right) => left.localeCompare(right));
  }, [availableBlueprints]);

  const filteredBlueprints = useMemo(() => {
    const query = blueprintQuery.trim().toLowerCase();

    return availableBlueprints.filter((blueprint) => {
      const group = formatBlueprintGroup(
        blueprint.language,
        blueprint.libraryKind,
      );
      const matchesLanguage =
        blueprintLanguageFilter === "all" || group === blueprintLanguageFilter;

      if (!matchesLanguage) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        blueprint.displayName,
        blueprint.fileName,
        blueprint.description,
        blueprint.language,
        blueprint.version,
        blueprint.repoPath,
        blueprint.path,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [availableBlueprints, blueprintLanguageFilter, blueprintQuery]);

  const groupedBlueprints = useMemo(() => {
    const groups = new Map<string, AvailableBlueprint[]>();

    for (const blueprint of filteredBlueprints) {
      const key = formatBlueprintGroup(
        blueprint.language,
        blueprint.libraryKind,
      );
      const existing = groups.get(key);
      if (existing) {
        existing.push(blueprint);
      } else {
        groups.set(key, [blueprint]);
      }
    }

    return Array.from(groups.entries())
      .sort(([leftGroup, leftBlueprints], [rightGroup, rightBlueprints]) => {
        const leftHasActive = leftBlueprints.some(
          (blueprint) => blueprint.isActive,
        );
        const rightHasActive = rightBlueprints.some(
          (blueprint) => blueprint.isActive,
        );

        if (leftHasActive !== rightHasActive) {
          return leftHasActive ? -1 : 1;
        }

        return leftGroup.localeCompare(rightGroup);
      })
      .map(([group, blueprints]) => ({
        group,
        blueprints: blueprints.sort((left, right) => {
          if (left.isActive !== right.isActive) {
            return left.isActive ? -1 : 1;
          }

          return left.displayName.localeCompare(right.displayName);
        }),
      }));
  }, [filteredBlueprints]);

  const activeBlueprintFilters = useMemo(() => {
    const filters: string[] = [];
    if (blueprintLanguageFilter !== "all") {
      filters.push(`Language: ${blueprintLanguageFilter}`);
    }
    if (blueprintQuery.trim()) {
      filters.push(`Query: ${blueprintQuery.trim()}`);
    }
    return filters;
  }, [blueprintLanguageFilter, blueprintQuery]);

  const toggleBlueprintGroup = (group: string) => {
    setCollapsedBlueprintGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  };

  const resetBlueprintLibraryFilters = () => {
    setBlueprintQuery("");
    setBlueprintLanguageFilter("all");
  };

  return {
    blueprintQuery,
    setBlueprintQuery,
    blueprintLanguageFilter,
    setBlueprintLanguageFilter,
    blueprintDensity,
    setBlueprintDensity,
    collapsedBlueprintGroups,
    blueprintLanguageOptions,
    filteredBlueprints,
    groupedBlueprints,
    activeBlueprintFilters,
    toggleBlueprintGroup,
    resetBlueprintLibraryFilters,
  };
}
