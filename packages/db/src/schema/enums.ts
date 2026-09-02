import { pgEnum } from "drizzle-orm/pg-core";

export const folderStatusEnum = pgEnum("folder_status", ["reading", "finished", "misc"]);

export const captureMethodEnum = pgEnum("capture_method", ["manual", "voice"]);

export const dictionarySourceEnum = pgEnum("dictionary_source", ["bundled", "dictionary_api", "ai_enhanced"]);

export const offlineDictionaryTierEnum = pgEnum("offline_dictionary_tier", ["core", "extended"]);
