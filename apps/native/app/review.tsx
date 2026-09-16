import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Spinner, useThemeColor } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

/**
 * The review run — the design's `review` screen, served by `word.quiz`.
 *
 * A card is one usage context with the term blanked out. The cards come from
 * the shared `dictionary_entry.contexts` written at enrichment, so a session
 * costs no AI call of its own; `word.quiz` is what excludes mastered words and
 * words with no context to blank.
 *
 * The run is a fixed set fetched once, not a stream: `word.quiz` orders
 * least-recently-reviewed first, so refetching mid-session — which stamping a
 * review would trigger — would reshuffle the deck under the reader.
 */

/** One run's worth of cards. The server caps `limit` at 50. */
const RUN_SIZE = 10;

export default function ReviewScreen() {
  // Optional: passed from a folder to practise that book alone, omitted from
  // the home screen for a run across the whole shelf.
  const { folderId } = useLocalSearchParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const foregroundColor = useThemeColor("foreground");

  const [index, setIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  // Cards the reader answered "Not yet" to, replayed at the end of the run
  // rather than stamped as reviewed — so they stay at the front of the next
  // run's queue too.
  const [retries, setRetries] = useState<number[]>([]);

  const quiz = useQuery({
    ...trpc.word.quiz.queryOptions({ folderId, limit: RUN_SIZE }),
    // The deck must not change under the reader mid-run.
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const folders = useQuery(trpc.folder.list.queryOptions());

  // Fire-and-forget: the stamp only moves the word down the next run's queue,
  // so a failure costs the reader nothing they'd notice mid-session and must
  // not interrupt the run. The invalidation on unmount is what refreshes home.
  const markReviewed = useMutation(trpc.word.update.mutationOptions({}));

  const cards = quiz.data ?? [];
  // The retry queue is appended once the first pass is done, so the run length
  // grows as the reader defers cards.
  const order = [...cards.keys(), ...retries];
  const card = cards[order[index] ?? -1];

  function advance() {
    setIsRevealed(false);
    setIndex((current) => current + 1);
  }

  function goBack() {
    // Home counts due words off the same query, and a stamped review changes
    // that count. Invalidating on the way out rather than per answer is what
    // keeps the deck stable during the run.
    queryClient.invalidateQueries({ queryKey: trpc.word.quiz.queryKey() });
    router.back();
  }

  if (quiz.isPending) {
    return (
      <Container className="items-center justify-center">
        <Spinner />
      </Container>
    );
  }

  const isDone = !card;
  const answered = Math.min(index, order.length);

  return (
    <Container isScrollable={false} hasTopInset className="px-6 pt-4 pb-5">
      {/* ---- Progress rail ------------------------------------------------ */}
      <View className="mb-8 flex-row items-center gap-3.5">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Close review"
          className="-m-1.5 p-1.5"
        >
          <Ionicons name="close" size={20} color={foregroundColor} />
        </Pressable>

        <View className="h-0.5 flex-1 bg-surface-strong">
          <View
            className="h-0.5 bg-primary"
            style={{ width: `${order.length ? (answered / order.length) * 100 : 0}%` }}
          />
        </View>

        <Text className="font-serif text-[11.5px] text-muted">
          {order.length ? `${Math.min(index + 1, order.length)} / ${order.length}` : "0 / 0"}
        </Text>
      </View>

      {isDone ? (
        <View className="flex-1 justify-center">
          {/* The design sets this number as misregistered CMYK plates. React
              Native has no mix-blend-mode, and the inks are colours this app
              doesn't use, so it's set plainly at the same size. */}
          <Text className="font-serif-semibold text-[88px] leading-[79px] text-foreground">
            {cards.length}
          </Text>
          <Text className="mt-4 font-serif-semibold text-[26px] text-foreground">
            {cards.length === 1 ? "word practised" : "words practised"}
          </Text>
          {/* The design promises "I'll bring them back in four days". There is
              no schedule behind that — `word.quiz` sorts by least recently
              reviewed, with no interval — so the copy says what's true. */}
          {/* The measure is in points, not `ch`: React Native has no `ch` unit,
              so `max-w-[28ch]` squeezed this into a column a few letters wide —
              and that column grew tall enough to push the centred block, big
              number first, up under the status bar. */}
          <Text className="font-serif mt-2 max-w-[320px] text-[15px] leading-[24px] text-muted">
            {cards.length === 0
              ? "Nothing to practise yet. Words become cards once their definition has an example to work from."
              : "That's the set for now. The ones you've just seen go to the back of the queue."}
          </Text>
          <Pressable
            onPress={goBack}
            className="mt-7 min-h-[48px] items-center justify-center rounded-card bg-primary"
          >
            <Text className="font-serif-semibold text-[16px] text-primary-content">
              Back to today
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          <Text className="font-serif mb-4 text-[11px] uppercase tracking-[1.5px] text-muted">
            {folders.data?.find((folder) => folder.id === card.folderId)?.title ?? ""}
          </Text>

          {/* The design shows the term above the sentence. Keeping it there
              would give the blank away, so the term is held back until the
              reveal and the blank carries the card. */}
          <Text className="font-italic text-[19px] leading-[31px] text-foreground border-l-2 border-primary-soft pl-4">
            {card.prompt}
          </Text>

          {isRevealed ? (
            <View className="mt-7 border-t border-surface-strong pt-5">
              <Text className="font-serif-semibold text-[34px] leading-[36px] tracking-[-0.8px] text-foreground">
                {card.answer}
              </Text>
              {card.definition ? (
                <Text className="font-serif mt-3 text-[17px] leading-[26px] text-foreground">
                  {card.definition}
                </Text>
              ) : null}
              {card.usageNote ? (
                <Text className="font-serif mt-2.5 text-[13.5px] leading-[21px] text-muted">
                  {card.usageNote}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View className="mt-auto pt-6">
            {isRevealed ? (
              // Two buttons, not the design's three: the server records a
              // review as a timestamp, not a grade, so "Almost" and "Got it"
              // would write the identical row.
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => {
                    setRetries((current) => [...current, order[index]!]);
                    advance();
                  }}
                  className="min-h-[50px] flex-1 items-center justify-center rounded-card bg-primary-tint"
                >
                  <Text className="font-serif-semibold text-[14px] text-primary-deep">Not yet</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    markReviewed.mutate({ id: card.wordId, reviewed: true });
                    advance();
                  }}
                  className="min-h-[50px] flex-1 items-center justify-center rounded-card bg-primary"
                >
                  <Text className="font-serif-semibold text-[14px] text-primary-content">
                    Got it
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setIsRevealed(true)}
                className="min-h-[50px] items-center justify-center rounded-card bg-primary"
              >
                <Text className="font-serif-semibold text-[16px] text-primary-content">
                  Show the meaning
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {quiz.error ? (
        <Text className="font-serif mt-4 text-[13px] text-danger">{quiz.error.message}</Text>
      ) : null}
    </Container>
  );
}
