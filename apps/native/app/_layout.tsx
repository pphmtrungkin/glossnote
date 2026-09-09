import "@/global.css";
import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_500Medium,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from "@expo-google-fonts/source-serif-4";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SQLiteProvider, type SQLiteDatabase } from "expo-sqlite";
import { HeroUINativeProvider, Spinner, useThemeColor } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider, useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { installBundledCore } from "@/lib/dictionary-pack";
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
        headerTitleStyle: { fontFamily: "SourceSerif4_600SemiBold", color: themeColorForeground },
        contentStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="folder/[id]" options={{ title: "Shelf" }} />
        <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
        <Stack.Screen name="add-word" options={{ title: "Add word", presentation: "modal" }} />
        {/* The review run owns the whole screen — its own close button and
            progress rail are the chrome, so the stack header would duplicate
            them. */}
        <Stack.Screen name="review" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Brings the on-device database up: schema first, then the bundled dictionary.
 *
 * The order is load-bearing — `installBundledCore` merges into the `dictionary`
 * table `migrateLocalDb` creates. Both are no-ops after the first launch, and
 * the core merge swallows its own failures, so this never blocks startup.
 */
async function initLocalDb(db: SQLiteDatabase) {
  await migrateLocalDb(db);
  await installBundledCore(db);
}

/** How long to wait on the reading font before rendering anyway. */
const FONT_TIMEOUT_MS = 3000;

/**
 * Sits inside AppThemeProvider so it can wait on the persisted theme as well
 * as the font — hiding the splash any earlier would show one frame of the
 * default page colour before the stored one is applied.
 */
function SplashGate({ areFontsLoaded }: { areFontsLoaded: boolean }) {
  const { isThemeReady } = useAppTheme();
  const [hasWaitedForFonts, setHasWaitedForFonts] = useState(false);

  // A font that never resolves must not leave a blank app behind the splash
  // screen: after the timeout the UI renders with the system serif instead.
  useEffect(() => {
    const timeout = setTimeout(() => setHasWaitedForFonts(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  const isReady = (areFontsLoaded || hasWaitedForFonts) && isThemeReady;

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) return null;

  return <StackLayout />;
}

export default function Layout() {
  // Five faces, not the family's full twelve: each one is a TTF that ships in
  // the binary, and the app renders exactly these. Italic is body weight only
  // — nothing sets italic headings.
  const [areFontsLoaded, fontError] = useFonts({
    SourceSerif4_400Regular,
    SourceSerif4_400Regular_Italic,
    SourceSerif4_500Medium,
    SourceSerif4_600SemiBold,
    SourceSerif4_700Bold,
  });

  // A font that fails to load shouldn't wedge the app on the splash screen —
  // React Native falls back to the system serif.
  const isFontStepDone = areFontsLoaded || !!fontError;

  return (
    <SQLiteProvider databaseName={LOCAL_DB_NAME} onInit={initLocalDb}>
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
