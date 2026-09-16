import * as Haptics from "expo-haptics";
import { useThemeColor } from "heroui-native";
import { Platform, Pressable, Text, View } from "react-native";

import {
  READING_THEMES,
  READING_THEME_META,
  useAppTheme,
  type ReadingTheme,
} from "@/contexts/app-theme-context";

function Swatch({
  theme,
  isSelected,
  onPress,
}: {
  theme: ReadingTheme;
  isSelected: boolean;
  onPress: () => void;
}) {
  const meta = READING_THEME_META[theme];
  const accentColor = useThemeColor("accent");
  const separatorColor = useThemeColor("separator");

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={meta.label}
      onPress={onPress}
      className="items-center gap-2 active:opacity-70"
    >
      <View
        className="w-16 h-16 rounded-xl items-center justify-center"
        style={{
          backgroundColor: meta.page,
          // The selected swatch gets an accent ring; the rest keep a hairline
          // outline so the white page stays visible against a white screen.
          borderWidth: isSelected ? 3 : 1,
          borderColor: isSelected ? accentColor : separatorColor,
        }}
      >
        <Text style={{ color: meta.ink, fontSize: 22 }} className="font-serif-semibold">
          Aa
        </Text>
      </View>
      <Text className={isSelected ? "font-serif text-foreground text-xs" : "font-serif text-muted text-xs"}>
        {meta.label}
      </Text>
    </Pressable>
  );
}

/**
 * The row of page-colour swatches, the selected one ringed — the app's one
 * place to change the page colour, on the You tab. It used to sit behind an
 * "Aa" button in the tab header too; that button was removed, so the choice
 * lives with the rest of the settings.
 *
 * Picking a swatch applies the theme everywhere at once and stores it on this
 * device (see app-theme-context).
 */
export function ReadingThemeSwatches() {
  const { currentTheme, setTheme } = useAppTheme();

  return (
    <View className="flex-row justify-between">
      {READING_THEMES.map((theme) => (
        <Swatch
          key={theme}
          theme={theme}
          isSelected={currentTheme === theme}
          onPress={() => {
            if (Platform.OS === "ios") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            setTheme(theme);
          }}
        />
      ))}
    </View>
  );
}
