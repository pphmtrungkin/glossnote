import { Ionicons } from "@expo/vector-icons";
import { Link, Tabs } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, type ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

import { ReadingThemePicker } from "@/components/reading-theme-picker";
import { usePalette } from "@/lib/palette";

/**
 * The design's bottom bar.
 *
 * The canvas draws five tabs — Today, Library, Shelves, Discover, You. Three of
 * them front the screens this app doesn't have (the social feed, discovery and
 * a profile), so only the three that exist are rendered; a tab that opens
 * nothing is worse than an absent one. "Discover" keeps its magnifier but not
 * its name: here the magnifier searches books and words, and borrowing the
 * design's label would advertise the social screen it belongs to.
 *
 * The icons are the canvas's own paths rather than Ionicons because the active
 * state is a *weight* shift — 1.3 to 1.9 stroke — and a glyph font can only
 * change colour. `tabBarIcon` gives us `focused`, so react-navigation still
 * owns the bar itself: press handling, accessibility and the bottom inset.
 */

/** viewBox 0 0 24 24, as drawn in the canvas. */
const ICONS = {
  today: "M4 11l8-6 8 6v9H4z",
  library: "M4 4h6v16H4zM12 4h3v16h-3zM17 5l3 15",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
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

  // The drawer that used to host the theme control is gone, so the Kindle-style
  // "Aa" page-colour picker lives in the tab header instead.
  const renderThemePicker = useCallback(() => <ReadingThemePicker />, []);
  // Sign-out used to sit here on its own. It now lives inside Settings, which
  // is where the offline dictionary and the privacy toggle need a home anyway
  // — one header slot, three settings behind it instead of one action.
  const renderSettings = useCallback(
    () => (
      <Link href="/settings" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" className="px-2.5">
          <Ionicons name="settings-outline" size={20} color={palette.ink} />
        </Pressable>
      </Link>
    ),
    [palette.ink],
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.base },
        headerTintColor: palette.ink,
        headerTitleStyle: { color: palette.ink, fontFamily: "SourceSerif4_600SemiBold" },
        headerRight: renderThemePicker,
        headerLeft: renderSettings,

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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon d={ICONS.today} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="shelf"
        options={{
          title: "Shelf",
          tabBarLabel: "Library",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon d={ICONS.library} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon d={ICONS.search} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
