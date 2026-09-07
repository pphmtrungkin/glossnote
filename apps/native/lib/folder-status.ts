import { FOLDER_STATUSES, type FolderStatus } from "@better-vocab/domain";
import type { ChipColor } from "heroui-native";

/**
 * How a folder status is presented. The values themselves come from
 * @better-vocab/domain, which is also where packages/db builds the Postgres
 * enum from — they were previously three independent literal lists.
 */
export { FOLDER_STATUSES, type FolderStatus };

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
