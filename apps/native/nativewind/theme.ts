/** GlossNote — Ochre spot.
 *  Colour values for the places className can't reach: StatusBar,
 *  react-native-svg fills, chart libraries, navigation theme, Animated.
 *
 *  `useThemeColors()` derives the palette from HeroUI's CSS variables,
 *  so it stays in sync with global.css automatically. The static `light`
 *  and `dark` objects remain for non-React contexts (module-level code,
 *  tests) and as the Palette type source.
 */

import { useThemeColor } from "heroui-native";
import { useCSSVariable } from "uniwind";

export const light = {
  primary: "#a8560f",
  primaryPressed: "#94490b",
  primaryDeep: "#7d3f0a",
  primaryTint: "#f2e6da",
  primarySoft: "#ddb894",
  primaryContent: "#ffffff",
  base: "#f4f3f0",
  surface: "#e7e5e1",
  surfaceStrong: "#d3d0ca",
  ink: "#1a1a18",
  muted: "#6b6a66",
  stateNew: "#6b6a66",
  stateLearning: "#a8560f",
  stateSteady: "#403f3c",
  success: "#4f7a4a",
  warning: "#b8862a",
  danger: "#a63b2a",
} as const;

export const dark = {
  primary: "#d99a52",
  primaryPressed: "#e7ad6a",
  primaryDeep: "#f0c48a",
  primaryTint: "#33261a",
  primarySoft: "#5e4429",
  primaryContent: "#2a1706",
  base: "#191713",
  surface: "#24211b",
  surfaceStrong: "#332f28",
  ink: "#eceae4",
  muted: "#9a958c",
  stateNew: "#9a958c",
  stateLearning: "#d99a52",
  stateSteady: "#bab5ac",
  success: "#84ad7e",
  warning: "#d6ac60",
  danger: "#d47664",
} as const;

/* The keys are fixed by `light`; the values are not — `useThemeColors()`
 * resolves them from the live CSS variables, which are plain strings. */
export type Palette = Record<keyof typeof light, string>;
export type Mastery = "new" | "learning" | "steady";

/**
 * The full palette derived from the active HeroUI theme.
 *
 * Standard HeroUI tokens read via `useThemeColor`; custom accent-variant
 * and mastery-state tokens read via `useCSSVariable` because they aren't
 * in HeroUI's ThemeColor union.
 *
 * Use this in React components instead of `usePalette()` when you need
 * the full set of tokens (StatusBar, SVG fills, Animated, charts).
 */
export function useThemeColors(): Palette {
  const [accentPressed, accentDeep, accentTint, accentSoft, stateNew, stateLearning, stateSteady] =
    useCSSVariable([
      "--color-accent-pressed",
      "--color-accent-deep",
      "--color-accent-tint",
      "--color-accent-soft",
      "--color-state-new",
      "--color-state-learning",
      "--color-state-steady",
    ]);

  // A variable missing from a theme resolves to undefined rather than
  // erroring, which would render the dot uncoloured; fall back to the static
  // value so a token added to one theme and forgotten in another still draws.
  const cssColor = (value: string | number | undefined, fallback: string) =>
    typeof value === "string" ? value : fallback;

  return {
    primary: useThemeColor("accent"),
    primaryPressed: cssColor(accentPressed, light.primaryPressed),
    primaryDeep: cssColor(accentDeep, light.primaryDeep),
    primaryTint: cssColor(accentTint, light.primaryTint),
    primarySoft: cssColor(accentSoft, light.primarySoft),
    primaryContent: useThemeColor("accent-foreground"),
    base: useThemeColor("background"),
    surface: useThemeColor("surface-secondary"),
    surfaceStrong: useThemeColor("surface-tertiary"),
    ink: useThemeColor("foreground"),
    muted: useThemeColor("muted"),
    stateNew: cssColor(stateNew, light.stateNew),
    stateLearning: cssColor(stateLearning, light.stateLearning),
    stateSteady: cssColor(stateSteady, light.stateSteady),
    success: useThemeColor("success"),
    warning: useThemeColor("warning"),
    danger: useThemeColor("danger"),
  };
}

/** The one semantic mapping the app depends on. */
export const masteryColor = (p: Palette, state: Mastery): string =>
  state === "new" ? p.stateNew : state === "learning" ? p.stateLearning : p.stateSteady;

/** Unpractised progress reads as inert paper, never as a warning. */
export const masteryTrack = (p: Palette) => p.surfaceStrong;

/** Community data — lookup counts, shared shelves, ranks. Never the accent. */
export const communityColor = (p: Palette) => p.muted;
