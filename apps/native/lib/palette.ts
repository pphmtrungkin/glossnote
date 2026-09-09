import { dark, light, type Palette } from "@/nativewind/theme";

/**
 * Ochre spot colour values for the places a className cannot reach — StatusBar,
 * react-native-svg fills, chart libraries, navigation themes, Animated.
 *
 * Anything that renders through a className should use the utilities instead
 * (`bg-primary`, `text-ink`, `text-state-learning`): those resolve per theme in
 * global.css, so they follow the reader's chosen page without passing a palette
 * around. Reach for this module only when there is no className to put a colour
 * on.
 *
 * The values themselves live in `nativewind/theme.ts` and are re-exported here
 * rather than copied, so there is one spelling of ochre in the codebase.
 */
export { dark, light, masteryColor, masteryTrack, communityColor, useThemeColors } from "@/nativewind/theme";
export type { Palette, Mastery } from "@/nativewind/theme";

/**
 * The palette matching the page the reader is on.
 *
 * Delegates to `useThemeColors()` which reads from HeroUI's CSS variables,
 * so it stays in sync with global.css automatically. Kept as a named export
 * for backward compatibility — new code should import `useThemeColors` directly.
 */
export { useThemeColors as usePalette } from "@/nativewind/theme";
