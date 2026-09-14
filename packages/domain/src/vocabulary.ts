/**
 * The closed sets of values the product speaks in, declared once.
 *
 * These were previously retyped per consumer — as a `pgEnum` in the Drizzle
 * schema, as a `z.enum` in the tRPC input, and again as a `as const` array in
 * the Expo app — with nothing keeping the three in step. Everything now
 * derives from the arrays below.
 *
 * No dependencies on purpose: `packages/db` builds Postgres enums from these,
 * `packages/api` builds Zod schemas from them, and `apps/native` reads them
 * directly, which it could not do if they lived in the db package.
 */

export const FOLDER_STATUSES = ["reading", "finished", "misc"] as const;
export type FolderStatus = (typeof FOLDER_STATUSES)[number];

/**
 * Who a shelf's words reach. `private`, the default, keeps them out of what
 * other readers of the same book see; `public` lets them count toward it —
 * as counts only, never definitions, notes or the shelf itself.
 */
export const FOLDER_VISIBILITIES = ["private", "public"] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITIES)[number];

export const CAPTURE_METHODS = ["manual", "voice"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/**
 * Where an on-device definition is stored. One `dictionary` table holds all
 * three (see apps/native/lib/local-db.ts); this column tells them apart.
 *
 *   core      bundled with the app
 *   extended  downloaded pack, many senses per term
 *   cached    resolved online, kept for offline reuse
 */
export const DICTIONARY_TIERS = ["core", "extended", "cached"] as const;
export type DictionaryTier = (typeof DICTIONARY_TIERS)[number];

/**
 * The tiers a user can actually choose to hold on disk — `cached` fills itself
 * as a side effect of looking words up, so it is never a setting. Backs
 * `user_preference.offline_dictionary_tier`.
 */
export const OFFLINE_DICTIONARY_TIERS = ["core", "extended"] as const;
export type OfflineDictionaryTier = (typeof OFFLINE_DICTIONARY_TIERS)[number];

/**
 * How a *shared* `dictionary_entry` row was resolved. A different axis from
 * DICTIONARY_TIERS, despite the overlap in meaning between `bundled` and
 * `core`: this describes provenance of one shared server row, that describes
 * which on-device table a copy sits in. They are deliberately not merged —
 * a row can be `bundled` provenance on the server while living in the `core`
 * tier on one device and the `cached` tier on another.
 */
export const DICTIONARY_SOURCES = ["bundled", "dictionary_api", "ai_enhanced"] as const;
export type DictionarySource = (typeof DICTIONARY_SOURCES)[number];

/**
 * What a user gets before they have ever opened Settings.
 *
 * `packages/db` applies these as the column defaults and the `preference`
 * router returns them for a user with no row yet, so "the default" is one
 * value rather than one per reader of it. `word.create` also falls back to
 * `contributeToAggregateByDefault` for a capture that races the first read.
 *
 * Changing a value here changes the Postgres column default, which needs a
 * generated migration — these are not free to edit.
 */
export const PREFERENCE_DEFAULTS = {
  contributeToAggregateByDefault: true,
  offlineDictionaryTier: "core",
} as const satisfies {
  contributeToAggregateByDefault: boolean;
  offlineDictionaryTier: OfflineDictionaryTier;
};
