import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router, Stack, useLocalSearchParams } from "expo-router";
import { Spinner, useThemeColor, useToast } from "heroui-native";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useCaptureWord } from "@/hooks/use-capture-word";
import { useDefinition } from "@/hooks/use-definition";
import { useFolders } from "@/hooks/use-folders";
import { MASTERY_CLASS, masteryOf } from "@/lib/mastery";
import { trpc } from "@/utils/trpc";

/**
 * The design's `book` screen: one shelf, its words, and what other readers of
 * the same book saved.
 */

/** Section label — the same small tracked kicker the home page uses. */
function Kicker({ children, className }: { children: string; className?: string }) {
  return (
    <Text
      className={`font-serif-semibold text-[10px] uppercase tracking-[1.6px] ${className ?? "text-muted"}`}
    >
      {children}
    </Text>
  );
}

// One suggested term. The reader count comes from the server; the definition
// does not — it is resolved here against this device's own dictionary, which
// is the whole point of the design: readers share how often a word was saved,
// never what it means.
function SuggestionRow({
  term,
  readers,
  onAdd,
  isAdding,
}: {
  term: string;
  readers: number;
  onAdd: (definition: string | undefined) => void;
  isAdding: boolean;
}) {
  // Local tiers only: this renders once per suggested term, and firing a
  // request per visible row would spend the whole list's worth of round trips
  // to fill in text the reader has not asked for yet.
  const lookup = useDefinition(term, { online: false });
  const definition = lookup.data?.status === "found" ? lookup.data.definition : null;

  return (
    <View className="flex-row items-center gap-3 border-b border-surface-strong py-3">
      <View className="flex-1">
        <Text className="font-serif-semibold text-[16px] leading-[19px] text-foreground">
          {term}
        </Text>
        {definition ? (
          <Text className="mt-0.5 text-[12.5px] leading-[19px] text-muted" numberOfLines={2}>
            {definition}
          </Text>
        ) : (
          <Text className="mt-0.5 text-[12.5px] text-muted">Not in your offline dictionary yet.</Text>
        )}
        {/* Other readers' data stays muted grey by rule — a lookup count is
            reference material, not the reader's own progress. */}
        <Text className="mt-1 text-[11px] text-muted">
          {readers === 1 ? "saved by 1 reader" : `saved by ${readers} readers`}
        </Text>
      </View>

      <Pressable
        disabled={isAdding}
        onPress={() => onAdd(definition ?? undefined)}
        className="min-h-[36px] items-center justify-center rounded-card border border-primary px-3"
      >
        <Text className="font-serif-semibold text-[12.5px] text-primary">Add</Text>
      </Pressable>
    </View>
  );
}

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutedColor = useThemeColor("muted");
  const foregroundColor = useThemeColor("foreground");

  const folders = useFolders();
  const folder = folders.data?.find((candidate) => candidate.id === id);

  const words = useQuery(trpc.word.listByFolder.queryOptions({ folderId: id }));

  // Only meaningful once the folder is linked to a book — the server returns an
  // empty list for freeform folders rather than erroring.
  const suggestions = useQuery({
    ...trpc.word.suggestions.queryOptions({ folderId: id }),
    enabled: !!folder?.bookId,
  });

  function invalidateWords() {
    // Adding a suggested word removes it from the suggestion list, and moves
    // the shelf's word count, so all three queries have to refetch.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.word.listByFolder.queryKey({ folderId: id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.word.suggestions.queryKey({ folderId: id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.folder.list.queryKey() }),
    ]);
  }

  function showError(error: { message: string }) {
    toast.show({ variant: "danger", label: error.message });
  }

  const deleteWord = useMutation(
    trpc.word.delete.mutationOptions({ onSuccess: invalidateWords, onError: showError }),
  );
  // Adding a suggested word goes through the same offline-aware capture path
  // as the add-word form, so a shelf tapped on a train queues like any other.
  const addWord = useCaptureWord({
    onSettled: (outcome) => {
      if (outcome.status === "queued") {
        toast.show({ label: "Saved on this device — it will sync when you're back online." });
        return;
      }
      return invalidateWords();
    },
    onError: showError,
  });

  function confirmDelete(wordId: string, term: string) {
    Alert.alert("Delete word?", `"${term}" will be removed from this shelf.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteWord.mutate({ id: wordId }) },
    ]);
  }

  const wordCount = words.data?.length ?? 0;

  return (
    <Container className="px-6 pb-8">
      <Stack.Screen
        options={{
          title: folder?.title ?? "Shelf",
          headerRight: () => (
            <Link href={{ pathname: "/add-word", params: { folderId: id } }} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Add word" className="px-2.5">
                <Ionicons name="add" size={24} color={foregroundColor} />
              </Pressable>
            </Link>
          ),
        }}
      />

      {/* ---- Masthead ------------------------------------------------------ */}
      <Text className="mt-3 font-serif-semibold text-[27px] leading-[31px] tracking-[-0.6px] text-foreground">
        {folder?.title ?? ""}
      </Text>
      {/* The design's meta line ends with "62% read". Nothing records a reading
          position, so the line stops at what the shelf actually knows. */}
      <Text className="mt-1 text-[13.5px] text-muted">
        {[folder?.book?.authors?.join(", "), wordCount === 1 ? "1 word" : `${wordCount} words`]
          .filter(Boolean)
          .join(" · ")}
      </Text>

      {/* The design pairs this with a "Share shelf" button. Sharing a shelf has
          no server behind it — only lookup counts cross between readers — so
          the row is the one action that is real. */}
      {wordCount > 0 ? (
        <Pressable
          onPress={() => router.push({ pathname: "/review", params: { folderId: id } })}
          className="mt-5 min-h-[44px] items-center justify-center rounded-card bg-primary"
        >
          <Text className="font-serif-semibold text-[14px] text-primary-content">
            {wordCount === 1 ? "Review this word" : `Review these ${wordCount}`}
          </Text>
        </Pressable>
      ) : null}

      {words.isPending ? (
        <View className="items-center py-10">
          <Spinner />
        </View>
      ) : null}

      {words.error ? (
        <View className="mt-5">
          <Text className="mb-3 text-[13px] text-danger">{words.error.message}</Text>
          <Pressable
            onPress={() => words.refetch()}
            className="min-h-[40px] items-center justify-center rounded-card border border-surface-strong"
          >
            <Text className="font-serif-semibold text-[13px] text-foreground">Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {words.data?.length === 0 ? (
        <View className="items-center py-12">
          <Ionicons name="bookmark-outline" size={28} color={mutedColor} />
          <Text className="mt-3 font-serif-semibold text-[16px] text-foreground">No words yet</Text>
          <Text className="mt-1 text-center text-[13px] text-muted">
            Log the first word you looked up while reading this.
          </Text>
          <Link href={{ pathname: "/add-word", params: { folderId: id } }} asChild>
            <Pressable className="mt-4 min-h-[40px] items-center justify-center rounded-card bg-primary px-4">
              <Text className="font-serif-semibold text-[13px] text-primary-content">
                Add a word
              </Text>
            </Pressable>
          </Link>
        </View>
      ) : null}

      {/* ---- The reader's own words ---------------------------------------- */}
      <View className="mt-6">
        {words.data?.map((word) => {
          // The personal override wins over the shared dictionary entry — see
          // the `definitionOverride` comment in packages/db/src/schema/word.ts.
          const definition = word.definitionOverride ?? word.dictionaryEntry?.definition ?? null;
          const mastery = masteryOf(word);

          return (
            <Link
              key={word.id}
              href={{ pathname: "/word/[id]", params: { id: word.id, folderId: id } }}
              asChild
            >
              <Pressable
                onLongPress={() => confirmDelete(word.id, word.term)}
                className="border-b border-surface-strong py-3.5"
              >
                <View className="flex-row items-baseline gap-2.5">
                  <Text className="font-serif-semibold text-[19px] leading-[22px] tracking-[-0.2px] text-foreground">
                    {word.term}
                  </Text>
                  {/* The design's dotted leader, filling the gap between the
                      word and its state the way a table of contents does. */}
                  <View className="mb-1 flex-1 border-b border-dotted border-surface-strong" />
                  <Text
                    className={`text-[11px] uppercase tracking-[0.6px] ${MASTERY_CLASS[mastery]}`}
                  >
                    {mastery}
                  </Text>
                </View>

                {definition ? (
                  <Text className="mt-1 text-[13.5px] leading-[20px] text-muted" numberOfLines={2}>
                    {definition}
                  </Text>
                ) : (
                  // Not an error: word.create leaves dictionaryEntryId null
                  // when no definition was known at capture time.
                  <Text className="mt-1 text-[12px] text-muted">Waiting on a definition.</Text>
                )}
              </Pressable>
            </Link>
          );
        })}
      </View>

      {words.data?.length ? (
        <Text className="mt-3 text-center text-[11px] text-muted">
          Long-press a word to delete it.
        </Text>
      ) : null}

      {/* ---- What other readers of this book saved -------------------------- */}
      {suggestions.data?.length ? (
        <View className="mt-8 border-t-2 border-foreground pt-4">
          <Kicker>Others reading this also saved</Kicker>
          {/* The design says "From 3,120 shared shelves of this book". The
              aggregate counts readers per term, not shelves, so the per-row
              count is the only number here. */}
          <Text className="mt-1.5 mb-2 text-[12.5px] text-muted">
            Words readers of this book saved, that you don&apos;t have yet.
          </Text>

          {suggestions.data.map((suggestion) => (
            <SuggestionRow
              key={suggestion.normalizedTerm}
              term={suggestion.term}
              readers={suggestion.readers}
              isAdding={addWord.isPending}
              onAdd={(definition) =>
                addWord.mutate({
                  folderId: id,
                  term: suggestion.term,
                  definition,
                  captureMethod: "manual",
                })
              }
            />
          ))}
        </View>
      ) : null}
    </Container>
  );
}
