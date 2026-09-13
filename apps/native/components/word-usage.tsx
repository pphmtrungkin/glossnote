import { CONTEXT_BLANK, type ParsedContext, parseContext } from "@better-vocab/domain";
import { Text, View } from "react-native";

/**
 * "In use" — the AI-written sentences showing a word at work, and its note on
 * where the word is used.
 *
 * Both come from the shared `dictionary_entry` row, so they are the same for
 * every reader and cost nothing to show: they were written by the one AI call
 * that term ever gets. Read-only, like the definition above them — this is
 * reference material, and a reader's own words go in their note.
 *
 * Renders nothing when there is nothing to show, so a caller never needs its
 * own emptiness check.
 */
export function WordUsage({
  contexts,
  exampleSentence,
  usageNote,
}: {
  contexts: string[];
  exampleSentence?: string | null;
  usageNote?: string | null;
}) {
  const sentences = contexts
    .map(parseContext)
    .filter((parsed): parsed is ParsedContext => parsed !== null);
  // A row enriched before contexts existed, or a bundled offline entry, has at
  // most the single plain sentence.
  const fallback = sentences.length === 0 ? exampleSentence : null;
  if (sentences.length === 0 && !fallback && !usageNote) return null;

  return (
    <View className="mt-6">
      <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">In use</Text>

      <View className="mt-3 gap-3">
        {sentences.map((parsed) => {
          // parseContext guarantees exactly one marked word, so one blank.
          const [before, after] = parsed.prompt.split(CONTEXT_BLANK);
          return (
            <Text
              key={parsed.sentence}
              className="border-l-2 border-primary-soft pl-4 font-italic text-[15.5px] leading-[25px] text-foreground"
            >
              {before}
              {/* The word as the sentence inflects it ("sietches", "running"),
                  which is why the stored braces mark it rather than a search. */}
              <Text className="font-serif-semibold">{parsed.answer}</Text>
              {after}
            </Text>
          );
        })}
        {fallback ? (
          <Text className="border-l-2 border-primary-soft pl-4 font-italic text-[15.5px] leading-[25px] text-foreground">
            {fallback}
          </Text>
        ) : null}
      </View>

      {usageNote ? <Text className="mt-3 text-[13.5px] leading-[21px] text-muted">{usageNote}</Text> : null}
    </View>
  );
}
