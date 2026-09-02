import * as Haptics from "expo-haptics";
import { Dialog, useThemeColor } from "heroui-native";
import { useState } from "react";
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
          // outline so the white page stays visible against a white sheet.
          borderWidth: isSelected ? 3 : 1,
          borderColor: isSelected ? accentColor : separatorColor,
        }}
      >
        <Text style={{ color: meta.ink, fontSize: 22 }} className="font-serif-semibold">
          Aa
        </Text>
      </View>
      <Text className={isSelected ? "text-foreground text-xs" : "text-muted text-xs"}>
        {meta.label}
      </Text>
    </Pressable>
  );
}

/**
 * Kindle's "Aa" menu: the header control that switches the page colour.
 * Replaces the scaffold's binary light/dark toggle.
 */
export function ReadingThemePicker() {
  const [isOpen, setIsOpen] = useState(false);
  const { currentTheme, setTheme } = useAppTheme();

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Reading settings" className="px-2.5">
          <Text className="text-foreground text-lg font-serif-semibold">Aa</Text>
        </Pressable>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="p-6 w-[90%] max-w-sm">
          <Dialog.Title className="mb-1">Page colour</Dialog.Title>
          <Dialog.Description className="mb-5">
            Applies everywhere in the app, and is remembered between launches.
          </Dialog.Description>

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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
