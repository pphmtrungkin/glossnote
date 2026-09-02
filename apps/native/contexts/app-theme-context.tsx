import { useSQLiteContext } from "expo-sqlite";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Uniwind, useUniwind } from "uniwind";

import { getAppSetting, setAppSetting } from "@/lib/app-settings";

/**
 * The four Kindle page themes. `light` and `dark` are Uniwind built-ins
 * redefined in global.css; `sepia` and `green` are registered through
 * `extraThemes` in metro.config.js.
 */
export const READING_THEMES = ["light", "sepia", "green", "dark"] as const;

export type ReadingTheme = (typeof READING_THEMES)[number];

export type ReadingThemeMeta = {
  name: ReadingTheme;
  /** Kindle's own wording for the page colour. */
  label: string;
  /** Swatch colours for the picker, mirroring the CSS tokens. */
  page: string;
  ink: string;
};

export const READING_THEME_META: Record<ReadingTheme, ReadingThemeMeta> = {
  light: { name: "light", label: "White", page: "#ffffff", ink: "#1b1b1b" },
  sepia: { name: "sepia", label: "Sepia", page: "#fbf0d9", ink: "#4a3b28" },
  green: { name: "green", label: "Green", page: "#dce7d5", ink: "#263323" },
  dark: { name: "dark", label: "Black", page: "#000000", ink: "#cccccc" },
};

const THEME_SETTING_KEY = "reading-theme";

const DEFAULT_THEME: ReadingTheme = "light";

function isReadingTheme(value: string | null): value is ReadingTheme {
  return !!value && (READING_THEMES as readonly string[]).includes(value);
}

type AppThemeContextType = {
  currentTheme: ReadingTheme;
  isLight: boolean;
  isDark: boolean;
  /** False until the persisted choice has been read back from SQLite. */
  isThemeReady: boolean;
  setTheme: (theme: ReadingTheme) => void;
  /** Steps through the four page colours, in Kindle's order. */
  cycleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(undefined);

export const AppThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useUniwind();
  const db = useSQLiteContext();
  const [isThemeReady, setIsThemeReady] = useState(false);

  const currentTheme: ReadingTheme = isReadingTheme(theme) ? theme : DEFAULT_THEME;

  // Uniwind holds the active theme in memory only, so the stored choice has to
  // be replayed on every cold start.
  useEffect(() => {
    let isActive = true;

    getAppSetting(db, THEME_SETTING_KEY)
      .then((stored) => {
        if (!isActive) return;
        if (isReadingTheme(stored)) {
          Uniwind.setTheme(stored);
        }
      })
      .finally(() => {
        if (isActive) setIsThemeReady(true);
      });

    return () => {
      isActive = false;
    };
  }, [db]);

  const setTheme = useCallback(
    (newTheme: ReadingTheme) => {
      Uniwind.setTheme(newTheme);
      // Fire-and-forget: the theme is already applied, and a failed write only
      // costs the preference on next launch.
      void setAppSetting(db, THEME_SETTING_KEY, newTheme).catch(() => {});
    },
    [db],
  );

  const cycleTheme = useCallback(() => {
    const nextIndex = (READING_THEMES.indexOf(currentTheme) + 1) % READING_THEMES.length;
    setTheme(READING_THEMES[nextIndex]);
  }, [currentTheme, setTheme]);

  const value = useMemo(
    () => ({
      currentTheme,
      isLight: currentTheme !== "dark",
      isDark: currentTheme === "dark",
      isThemeReady,
      setTheme,
      cycleTheme,
    }),
    [currentTheme, isThemeReady, setTheme, cycleTheme],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
