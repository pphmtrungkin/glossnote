import { dark, light, type Palette } from "@/nativewind/theme";

import { useAppTheme } from "@/contexts/app-theme-context";

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
export { dark, light, masteryColor, masteryTrack, communityColor } from "@/nativewind/theme";
export type { Palette, Mastery } from "@/nativewind/theme";

/**
 * The palette matching the page the reader is on.
 *
 * Deliberately not `useColorScheme()` from React Native, which the scheme's own
 * file reaches for: this app's theme is a choice the reader makes and we persist
 * (five themes, in SQLite), not a mirror of the OS setting. Keying off the OS
 * would hand a reader on the Sepia page the light palette while the rest of the
 * app rendered sepia — and would ignore their choice entirely on a phone whose
 * system theme disagrees.
 *
 * Only `dark` is a night page, so every other theme takes the light palette.
 * That is the same split `isDark` already makes for the status bar.
 */
export function usePalette(): Palette {
  const { isDark } = useAppTheme();
  return isDark ? (dark as unknown as Palette) : light;
}
