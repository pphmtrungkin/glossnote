/** GlossNote — Ochre spot.
 *  Colour values for the places className can't reach: StatusBar,
 *  react-native-svg fills, chart libraries, navigation theme, Animated.
 */

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

export type Palette = typeof light;
export type Mastery = "new" | "learning" | "steady";

/** The one semantic mapping the app depends on. */
export const masteryColor = (p: Palette, state: Mastery): string =>
  state === "new" ? p.stateNew : state === "learning" ? p.stateLearning : p.stateSteady;

/** Unpractised progress reads as inert paper, never as a warning. */
export const masteryTrack = (p: Palette) => p.surfaceStrong;

/** Community data — lookup counts, shared shelves, ranks. Never the accent. */
export const communityColor = (p: Palette) => p.muted;

import { useColorScheme } from "react-native";
export const usePalette = (): Palette =>
  useColorScheme() === "dark" ? (dark as unknown as Palette) : light;
