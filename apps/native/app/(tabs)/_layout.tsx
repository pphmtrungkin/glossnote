import { Ionicons } from "@expo/vector-icons";
import { Link, Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useCallback } from "react";
import { Pressable } from "react-native";

import { ReadingThemePicker } from "@/components/reading-theme-picker";

export default function TabLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

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
          <Ionicons name="settings-outline" size={20} color={themeColorForeground} />
        </Pressable>
      </Link>
    ),
    [themeColorForeground],
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: themeColorBackground },
        headerTintColor: themeColorForeground,
        headerTitleStyle: { color: themeColorForeground, fontFamily: "SourceSerif4_600SemiBold" },
        headerRight: renderThemePicker,
        headerLeft: renderSettings,
        tabBarStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "GlossNote",
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shelf"
        options={{
          title: "Shelf",
          tabBarIcon: ({ color, size }) => <Ionicons name="library" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
