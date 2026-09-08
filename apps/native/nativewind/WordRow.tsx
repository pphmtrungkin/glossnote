/** GlossNote — Ochre spot, in use.
 *  Rule: the accent is spent ONLY on the reader's own saved words and the one
 *  main action on a screen. Other readers' data is always muted gray.
 */
import { View, Text, Pressable } from "react-native";
import { usePalette, masteryColor, type Mastery } from "./theme";

const STATE_CLASS: Record<Mastery, string> = {
  new: "text-state-new",
  learning: "text-state-learning",
  steady: "text-state-steady",
};

export function WordRow({
  word,
  gloss,
  page,
  state,
}: {
  word: string;
  gloss: string;
  page: number;
  state: Mastery;
}) {
  return (
    <Pressable className="border-b border-ink/10 py-3.5 active:bg-primary-tint">
      <View className="flex-row items-baseline gap-2.5">
        <Text className="font-heading text-[19px] leading-[22px] text-ink">{word}</Text>
        <View className="h-px flex-1 bg-ink/25" />
        <Text className={`text-[11px] tracking-wider ${STATE_CLASS[state]}`}>
          {state.toUpperCase()}
        </Text>
      </View>
      <Text className="mt-1 font-body text-[13.5px] leading-5 text-ink/70">{gloss}</Text>
      <Text className="mt-1 font-body text-[11.5px] text-muted">p.{page}</Text>
    </Pressable>
  );
}

/** Primary action — one per screen. */
export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[46px] items-center justify-center rounded-card bg-primary px-4 active:bg-primary-pressed"
    >
      <Text className="font-heading text-[15px] text-primary-content">{label}</Text>
    </Pressable>
  );
}

/** Secondary — outlined in the accent. Never a second fill beside the primary. */
export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[46px] items-center justify-center rounded-card border border-primary px-4 active:bg-primary-tint"
    >
      <Text className="font-heading text-[15px] text-primary-deep">{label}</Text>
    </Pressable>
  );
}

/** Tertiary — ink only, no accent, no border. */
export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="min-h-[44px] items-center justify-center px-4">
      <Text className="font-heading text-[14px] text-ink/70">{label}</Text>
    </Pressable>
  );
}

/** How many other readers stopped on this word. Muted — this is not your progress. */
export function LookupBar({ share }: { share: number }) {
  return (
    <View className="h-[3px] flex-1 bg-surface-strong">
      <View className="h-[3px] bg-muted" style={{ width: `${share * 100}%` }} />
    </View>
  );
}

/** Non-className consumers (SVG, StatusBar, charts) read from the palette. */
export function MasteryDot({ state }: { state: Mastery }) {
  const p = usePalette();
  return (
    <View
      className="h-[7px] w-[7px] rounded-full"
      style={{ backgroundColor: masteryColor(p, state) }}
    />
  );
}
