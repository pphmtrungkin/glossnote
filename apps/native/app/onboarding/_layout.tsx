import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* The tour is the group's index, so the root layout's guard lands here
          the moment a session appears on a device that hasn't seen it. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="dictionary" />
    </Stack>
  );
}
