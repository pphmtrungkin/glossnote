import "@/global.css";
import {
  Literata_400Regular,
  Literata_500Medium,
  Literata_600SemiBold,
  Literata_700Bold,
  useFonts,
} from "@expo-google-fonts/literata";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SQLiteProvider } from "expo-sqlite";
import { HeroUINativeProvider, Spinner, useThemeColor } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider, useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { LOCAL_DB_NAME, migrateLocalDb } from "@/lib/local-db";
import { queryClient } from "@/utils/trpc";

// Held until the reading font is registered and the stored page colour has
// been replayed, so the first painted frame is already the right theme.
SplashScreen.preventAutoHideAsync();

function StackLayout() {
  const { data: session, isPending } = authClient.useSession();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  // The session comes from SecureStore, so it isn't available on the first
  // render. Rendering the stack before it resolves would flash the sign-in
  // screen at every cold start for an already-signed-in user.
  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  const isSignedIn = !!session?.user;

  return (
    <Stack
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: { fontFamily: "Literata_600SemiBold", color: themeColorForeground },
        contentStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="folder/[id]" options={{ title: "Folder" }} />
        <Stack.Screen name="add-word" options={{ title: "Add word", presentation: "modal" }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Sits inside AppThemeProvider so it can wait on the persisted theme as well
 * as the font — hiding the splash any earlier would show one frame of the
 * default page colour before the stored one is applied.
 */
function SplashGate({ areFontsLoaded }: { areFontsLoaded: boolean }) {
  const { isThemeReady } = useAppTheme();

  useEffect(() => {
    if (areFontsLoaded && isThemeReady) {
      SplashScreen.hideAsync();
    }
  }, [areFontsLoaded, isThemeReady]);

  if (!areFontsLoaded || !isThemeReady) return null;

  return <StackLayout />;
}

export default function Layout() {
  const [areFontsLoaded, fontError] = useFonts({
    Literata_400Regular,
    Literata_500Medium,
    Literata_600SemiBold,
    Literata_700Bold,
  });

  // A font that fails to load shouldn't wedge the app on the splash screen —
  // React Native falls back to the system serif.
  const isFontStepDone = areFontsLoaded || !!fontError;

  return (
    <SQLiteProvider databaseName={LOCAL_DB_NAME} onInit={migrateLocalDb}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AppThemeProvider>
              <HeroUINativeProvider>
                <SplashGate areFontsLoaded={isFontStepDone} />
              </HeroUINativeProvider>
            </AppThemeProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </SQLiteProvider>
  );
}
