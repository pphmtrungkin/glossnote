import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { usePalette } from "@/lib/palette";

type Tone = "info" | "warn";

const ICONS: Record<Tone, "information-circle-outline" | "alert-circle-outline"> = {
  info: "information-circle-outline",
  warn: "alert-circle-outline",
};

/**
 * A short message with a state to it: an icon, a headline, and a line saying
 * what to do about it.
 *
 * The scanner alone has four — no barcode in a photo, no match for one, the
 * camera refused, and the guidance before a read — and as muted paragraphs they
 * all read as the same non-event. One shape lets a reader tell a dead end from
 * a hint at a glance, and `action` keeps the way out beside the words rather
 * than somewhere below them.
 */
export function Notice({
  tone = "info",
  title,
  body,
  action,
}: {
  tone?: Tone;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const palette = usePalette();

  return (
    <View className="flex-row gap-2.5 rounded-card border border-surface-strong p-3">
      <Ionicons
        name={ICONS[tone]}
        size={17}
        color={tone === "warn" ? palette.danger : palette.muted}
        style={{ marginTop: 1 }}
      />
      <View className="min-w-0 flex-1">
        <Text className="font-serif-semibold text-[13.5px] leading-[19px] text-foreground">
          {title}
        </Text>
        {body ? (
          <Text className="font-serif mt-1 text-[12.5px] leading-[19px] text-muted">{body}</Text>
        ) : null}
        {action}
      </View>
    </View>
  );
}
