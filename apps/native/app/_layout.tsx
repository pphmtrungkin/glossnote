import "@/global.css";
import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_500Medium,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from "@expo-google-fonts/source-serif-4";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from "expo-sqlite";
import * as SystemUI from "expo-system-ui";
import { HeroUINativeProvider, Spinner } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider, useAppTheme } from "@/contexts/app-theme-context";
import { usePendingSync } from "@/hooks/use-pending-sync";
import { authClient } from "@/lib/auth-client";
import { installBundledCore } from "@/lib/dictionary-pack";
import { usePalette } from "@/lib/palette";
import { LOCAL_DB_NAME, migrateLocalDb } from "@/lib/local-db";
import { ONBOARDING_QUERY_KEY, hasSeenOnboarding } from "@/lib/onboarding";
import { queryClient } from "@/utils/trpc";

// Held until the reading font is registered and the stored page colour has
// been replayed, so the first painted frame is already the right theme.
SplashScreen.preventAutoHideAsync();

/**
 * The longest a cold start waits on the server's session answer when the phone
 * has no saved session to open with. See StackLayout.
 */
const SESSION_WAIT_MS = 4000;

function StackLayout() {
  const { data: session, isPending } = authClient.useSession();
  const db = useSQLiteContext();
  const { isDark } = useAppTheme();

  // Per install, not per account — see lib/onboarding.ts. Read here rather than
  // inside the tour so the tabs are never mounted first and then replaced, and
  // invalidated by `useFinishOnboarding` so ending the tour flips the guard.
  const onboarding = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: () => hasSeenOnboarding(db),
  });
  // Chrome colours come from the palette module rather than from HeroUI
  // directly — it is the one place the app spells a colour that no className
  // can reach, and the window background below is exactly that case.
  const palette = usePalette();

  // Android is edge-to-edge, so the status bar is transparent and whatever is
  // behind it shows through. `react-native-screens` lays each screen out below
  // the bar, which leaves the window background itself on show there — and that
  // is expo-splash-screen's colour, not the reader's page. Repainting it is the
  // only thing that reaches the strip; an overlay View loses to the elevated
  // native stack. iOS shares it harmlessly: the window is covered there anyway.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.base);
  }, [palette.base]);

  // Words captured offline are flushed from here rather than from a screen:
  // the queue belongs to the session, not to whichever shelf happens to be
  // open. Gated on the session because the flush is a protected procedure.
  usePendingSync(!!session?.user);

  // With no session known yet, rendering the stack would flash the sign-in
  // screen at every cold start for an already-signed-in user, so startup waits
  // — but never on the network alone. `isPending` stays true until
  // `get-session` answers, while Better Auth's Expo client restores the last
  // session from SecureStore into `data` well before that; and a server that
  // can't be reached (a changed dev IP, no signal) can hold that request open
  // for a minute. So a restored session opens the app at once, and with none
  // the wait is capped: the stack renders signed out, and flips to the shelf
  // if the answer still arrives. Offline mode must never feel broken.
  const [hasWaitedForSession, setHasWaitedForSession] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setHasWaitedForSession(true), SESSION_WAIT_MS);
    return () => clearTimeout(timeout);
  }, []);
  const isWaitingForSession = isPending && !session && !hasWaitedForSession;

  // The device flag is a local SQLite read, waited on for the same reason as
  // the session, one screen further in.
  if (isWaitingForSession || onboarding.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  const isSignedIn = !!session?.user;
  // A failed read (no table yet on a half-migrated device) is treated as seen:
  // a reader who can't be shown the tour should land on their shelf, not on a
  // spinner. `hasSeenOnboarding` already swallows its own errors.
  const needsOnboarding = isSignedIn && onboarding.data === false;

  return (
    <>
      <Stack
        screenOptions={{
          headerTintColor: palette.ink,
          headerStyle: { backgroundColor: palette.base },
          headerTitleStyle: { fontFamily: "SourceSerif4_600SemiBold", color: palette.ink },
          contentStyle: { backgroundColor: palette.base },
        }}
      >
        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>

        {/* The tour sits between the account and the app: signed in, but this
            phone hasn't seen it. Its own stack, so the tabs aren't mounted
            behind it and the back gesture has nowhere to go. */}
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>

        <Stack.Protected guard={isSignedIn && !needsOnboarding}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="folder/[id]" options={{ title: "Shelf" }} />
          <Stack.Screen name="word/[id]" options={{ title: "Word" }} />
          <Stack.Screen name="add-word" options={{ title: "Add word", presentation: "modal" }} />
          {/* The review run owns the whole screen — its own close button and
              progress rail are the chrome, so the stack header would duplicate
              them. */}
          <Stack.Screen name="review" options={{ headerShown: false }} />
          {/* Search across every shelf, opened from Library's magnifier. */}
          <Stack.Screen name="search" options={{ title: "Search" }} />
        </Stack.Protected>
      </Stack>

      {/* The icons on top of it follow the reader's page, not the OS scheme. */}
      <StatusBar style={isDark ? "light" : "dark"} />
    </>
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
