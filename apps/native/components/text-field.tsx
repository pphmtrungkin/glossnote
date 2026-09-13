import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { usePalette } from "@/lib/palette";

type Props = TextInputProps & {
  label: string;
  /** The message for this field, or null when it is valid. */
  error?: string | null;
};

/**
 * A labelled text input in plain React Native — label, field, error message.
 *
 * The focus ring is local state rather than a `:focus` variant: React Native
 * has no focus pseudo-class, so a border that changes on focus has to be told
 * when that happens.
 *
 * `secureTextEntry` brings its own reveal toggle, because a masked field
 * without one is the single most common reason a sign-in fails on a phone
 * keyboard.
 */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, onFocus, onBlur, secureTextEntry, ...props },
  ref,
) {
  const [isFocused, setIsFocused] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const palette = usePalette();

  const borderClassName = error
    ? "border-danger"
    : isFocused
      ? "border-primary"
      : "border-surface-strong";

  return (
    <View className="gap-1.5">
      <Text className="text-[13px] text-muted">{label}</Text>

      <View className="justify-center">
        <TextInput
          ref={ref}
          className={`min-h-12 rounded-lg border-2 bg-base px-3 text-[15px] text-foreground ${borderClassName} ${
            secureTextEntry ? "pr-11" : ""
          }`}
          placeholderTextColor={palette.muted}
          selectionColor={palette.primary}
          secureTextEntry={secureTextEntry && !isRevealed}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />

        {secureTextEntry ? (
          <Pressable
            className="absolute right-3"
            hitSlop={12}
            onPress={() => setIsRevealed((revealed) => !revealed)}
            accessibilityRole="button"
            accessibilityLabel={isRevealed ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={isRevealed ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={palette.muted}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text className="text-[12px] text-danger">{error}</Text> : null}
    </View>
  );
});
