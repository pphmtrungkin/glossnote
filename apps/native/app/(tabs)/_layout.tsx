import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useCallback } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function TabLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  // The drawer that used to host the theme toggle is gone, so it lives in the
  // tab header instead.
  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);
  const renderSignOut = useCallback(() => <SignOutButton />, []);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: themeColorBackground },
        headerTintColor: themeColorForeground,
        headerTitleStyle: { color: themeColorForeground, fontWeight: "600" },
        headerRight: renderThemeToggle,
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
