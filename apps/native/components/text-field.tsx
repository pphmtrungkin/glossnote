import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { usePalette } from "@/lib/palette";

type Props = TextInputProps & {
  /** Omit when the screen labels the field itself — a search bar, or a section kicker. */
  label?: string;
  /** The message for this field, or null when it is valid. */
  error?: string | null;
  /** The bigger serif field a search bar uses. */
  large?: boolean;
};

/**
 * The app's one text input, in plain React Native — label, field, error message.
 *
 * Every text field in the app goes through this rather than HeroUI's `Input`,
 * `TextField` or `TextArea`, so one component owns how a field looks and
 * behaves on every page theme. `multiline` makes it a note box; `className` is
 * added to the field's own classes rather than replacing them.
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
  { label, error, large = false, onFocus, onBlur, secureTextEntry, multiline, className, ...props },
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

  // One size class per field, never two: which of two `text-[…]` classes wins
  // is decided by stylesheet order, not by their order in the string.
  // One size class per field, and one font face with it: two `font-serif…`
  // classes on the same input would be settled by stylesheet order, not by
  // which comes last in the string.
  const sizeClassName = multiline
    ? "min-h-24 py-2.5 font-serif text-[15px]"
    : large
      ? "min-h-14 font-serif-semibold text-[19px]"
      : "min-h-12 font-serif text-[15px]";

  return (
    <View className="gap-1.5">
      {label ? <Text className="font-serif text-[13px] text-muted">{label}</Text> : null}

      <View className="justify-center">
        <TextInput
          ref={ref}
          className={`rounded-lg border-2 bg-page px-3 text-foreground ${sizeClassName} ${borderClassName} ${
            secureTextEntry ? "pr-11" : ""
          } ${className ?? ""}`}
          placeholderTextColor={palette.muted}
          selectionColor={palette.primary}
          secureTextEntry={secureTextEntry && !isRevealed}
          multiline={multiline}
          // Android centres multiline text vertically by default.
          textAlignVertical={multiline ? "top" : undefined}
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

      {error ? <Text className="font-serif text-[12px] text-danger">{error}</Text> : null}
    </View>
  );
});
