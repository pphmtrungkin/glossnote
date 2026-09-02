import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useCallback } from "react";

import { ReadingThemePicker } from "@/components/reading-theme-picker";
import { SignOutButton } from "@/components/sign-out-button";

export default function TabLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  // The drawer that used to host the theme control is gone, so the Kindle-style
  // "Aa" page-colour picker lives in the tab header instead.
  const renderThemePicker = useCallback(() => <ReadingThemePicker />, []);
  const renderSignOut = useCallback(() => <SignOutButton />, []);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: themeColorBackground },
        headerTintColor: themeColorForeground,
        headerTitleStyle: { color: themeColorForeground, fontFamily: "Literata_600SemiBold" },
        headerRight: renderThemePicker,
        headerLeft: renderSignOut,
        tabBarStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Tabs.Screen
        name="index"
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
