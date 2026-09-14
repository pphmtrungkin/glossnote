import {
  CAPTURE_METHODS,
  DICTIONARY_SOURCES,
  FOLDER_STATUSES,
  FOLDER_VISIBILITIES,
  OFFLINE_DICTIONARY_TIERS,
} from "@better-vocab/domain";
import { pgEnum } from "drizzle-orm/pg-core";

// The value lists live in @better-vocab/domain so the Expo app can read the
// same ones without importing this package (and with it, Postgres drivers).
// Changing a set means editing that file, not this one.
export const folderStatusEnum = pgEnum("folder_status", FOLDER_STATUSES);

export const folderVisibilityEnum = pgEnum("folder_visibility", FOLDER_VISIBILITIES);

export const captureMethodEnum = pgEnum("capture_method", CAPTURE_METHODS);

export const dictionarySourceEnum = pgEnum("dictionary_source", DICTIONARY_SOURCES);

export const offlineDictionaryTierEnum = pgEnum("offline_dictionary_tier", OFFLINE_DICTIONARY_TIERS);
