import { Tabs } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, type ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

import { ReadingThemePicker } from "@/components/reading-theme-picker";
import { usePalette } from "@/lib/palette";

/**
 * The bottom bar: Today, Library, Practise, You.
 *
 * The canvas draws five tabs — Today, Library, Shelves, Discover, You. Shelves
 * and Library are the same screen here, and Discover fronts a social feed this
 * app doesn't have, so it is left out rather than opening nothing. Practise
 * takes its place: the review run is the retention half of the app, and it was
 * only reachable from buttons on other screens. Search lives behind Library's
 * magnifier, and the settings behind the old header gear now live in You.
 *
 * The icons are drawn rather than Ionicons because the active state is a
 * *weight* shift — 1.3 to 1.9 stroke — and a glyph font can only change
 * colour. `tabBarIcon` gives us `focused`, so react-navigation still owns the
 * bar itself: press handling, accessibility and the bottom inset.
 */

/** viewBox 0 0 24 24. Today and Library are the canvas's own paths. */
const ICONS = {
  today: "M4 11l8-6 8 6v9H4z",
  library: "M4 4h6v16H4zM12 4h3v16h-3zM17 5l3 15",
  // A card in front of the deck it came from.
  practise: "M7 4h12v14M4 7h12v13H4z",
  // A head and shoulders.
  you: "M12 4a4 4 0 110 8 4 4 0 010-8zM4 20c1.2-3.6 4.2-5.5 8-5.5s6.8 1.9 8 5.5",
} as const;

function TabIcon({ d, color, focused }: { d: string; color: ColorValue; focused: boolean }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={focused ? 1.9 : 1.3} />
    </Svg>
  );
}

export default function TabLayout() {
  const palette = usePalette();

  // The Kindle-style "Aa" page-colour picker lives in the tab header.
  const renderThemePicker = useCallback(() => <ReadingThemePicker />, []);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.base },
        headerTintColor: palette.ink,
        headerTitleStyle: { color: palette.ink, fontFamily: "SourceSerif4_600SemiBold" },
        headerRight: renderThemePicker,

        // The accent marks where the reader is, and nothing else in the bar —
        // the scheme spends it on one thing per screen.
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.base,
          // One hairline, the same separator the shelf rows use. The canvas's
          // 30px of bottom padding is the home indicator; react-navigation
          // already adds the real inset, so only the top is set here.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.surfaceStrong,
          paddingTop: 9,
        },
        tabBarLabelStyle: {
          fontFamily: "SourceSerif4_600SemiBold",
          fontSize: 9.5,
          letterSpacing: 0.7,
          textTransform: "uppercase",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "GlossNote",
          tabBarLabel: "Today",
          tabBarIcon: ({ color, focused }) => <TabIcon d={ICONS.today} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="shelf"
        options={{
          title: "Shelf",
          tabBarLabel: "Library",
          tabBarIcon: ({ color, focused }) => <TabIcon d={ICONS.library} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="practise"
        options={{
          title: "Practise",
          tabBarIcon: ({ color, focused }) => <TabIcon d={ICONS.practise} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: "You",
          tabBarIcon: ({ color, focused }) => <TabIcon d={ICONS.you} color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
