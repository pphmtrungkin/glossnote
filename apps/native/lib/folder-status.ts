import type { ChipColor } from "heroui-native";

/**
 * Mirrors `folderStatusEnum` in packages/db/src/schema/enums.ts. Duplicated
 * rather than imported because apps/native only depends on @better-vocab/api
 * for types — pulling in the db package would drag Postgres drivers into the
 * bundle.
 */
export const FOLDER_STATUSES = ["reading", "finished", "misc"] as const;

export type FolderStatus = (typeof FOLDER_STATUSES)[number];

export const FOLDER_STATUS_LABELS: Record<FolderStatus, string> = {
  reading: "Reading",
  finished: "Finished",
  misc: "Misc",
};

export const FOLDER_STATUS_COLORS: Record<FolderStatus, ChipColor> = {
  reading: "accent",
  finished: "success",
  misc: "default",
};
