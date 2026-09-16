import { normalizeTerm } from "@better-vocab/domain";
import { Ionicons } from "@expo/vector-icons";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Button, Chip, Spinner, Surface, useThemeColor, useToast } from "heroui-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import z from "zod";

import { Container } from "@/components/container";
import { TextField } from "@/components/text-field";
import { WordUsage } from "@/components/word-usage";
import { useCaptureWord } from "@/hooks/use-capture-word";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDefinition } from "@/hooks/use-definition";
import { useFolders } from "@/hooks/use-folders";
import { completeTerm } from "@/lib/dictionary";
import { getFormErrorMessage } from "@/lib/form-error";
import { trpc } from "@/utils/trpc";

const addWordSchema = z.object({
  term: z.string().trim().min(1, "Enter the word you looked up"),
});

/** Section label — the same small tracked kicker the rest of the app uses. */
function Kicker({ children }: { children: string }) {
  return (
    <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">{children}</Text>
  );
}

export default function AddWordScreen() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const foregroundColor = useThemeColor("foreground");

  // Saves through the shared capture path, which queues the word on this
  // device when the request never leaves it. See hooks/use-capture-word.ts.
  const createWord = useCaptureWord({
    onSettled: (outcome) => {
      if (outcome.status === "queued") {
        toast.show({ label: "Saved on this device — it will sync when you're back online." });
        return;
      }
      // A saved word leaves both recommendation lists for this folder.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.word.listByFolder.queryKey({ folderId }) }),
        queryClient.invalidateQueries({ queryKey: trpc.word.suggestions.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.word.topicWords.queryKey({ folderId }) }),
        // A page moves the shelf's progress, which home and the shelf show.
        queryClient.invalidateQueries({ queryKey: trpc.folder.list.queryKey() }),
      ]);
    },
    onError: (error) => toast.show({ variant: "danger", label: error.message }),
  });

  // The page field starts on the shelf's current page, so a reader who hasn't
  // moved on just saves, and one who has edits the number. Null = untouched,
  // which also lets the folder list arrive after the screen opens.
  const folder = useFolders().data?.find((row) => row.id === folderId);
  const [pageText, setPageText] = useState<string | null>(null);
  const shownPage = pageText ?? (folder?.currentPage ? String(folder.currentPage) : "");
  const parsedPage = Number.parseInt(shownPage, 10);
  // Read by onSubmit through a ref, like latestSuggestion below.
  const latestPage = useRef<number | undefined>(undefined);
  latestPage.current = parsedPage >= 1 ? parsedPage : undefined;

  const form = useForm({
    defaultValues: { term: "" },
    validators: { onSubmit: addWordSchema },
    onSubmit: async ({ value }) => {
      const term = value.term.trim();
      const shown = latestSuggestion.current;

      await createWord.mutateAsync({
        folderId,
        term,
        // The definition this screen showed, never text the reader typed:
        // definitions are not editable. It stays on this user's row as
        // definitionOverride, and only when the server has no shared entry.
        //
        // Sent only when it belongs to this exact term. The lookup runs on a
        // debounced copy of the field, so a quick Save after an edit would
        // otherwise file the previous word's definition.
        definition: shown && shown.term === normalizeTerm(term) ? shown.definition : undefined,
        captureMethod: "manual",
        page: latestPage.current,
      });

      router.back();
    },
  });

  const term = useStore(form.store, (state) => state.values.term);
  const debouncedTerm = useDebouncedValue(term);

  // Server when online, device dictionary when not — all of it behind one
  // call. See hooks/use-definition.ts.
  const resolution = useDefinition(debouncedTerm);
  const suggestion = resolution.data?.status === "found" ? resolution.data : null;

  // onSubmit is handed to the form once, so it reads the latest lookup through
  // a ref instead of whichever render created it.
  const latestSuggestion = useRef(suggestion);
  latestSuggestion.current = suggestion;

  const hasSearched = debouncedTerm.trim().length > 0 && !resolution.isFetching;

  // ---- New words for this book ---------------------------------------------
  // This form is the only place the app recommends words, from two sources.
  // Tapping one only fills the field, so the definition card below takes over
  // and a recommended word is saved exactly like a typed one.
  const typed = term.trim();
  const prefix = debouncedTerm.trim();

  // Other readers of this book: their most-saved words while the field is
  // empty, and completions once two letters are typed — mostly names and
  // invented words no dictionary has, so completing one saves a misspelling.
  const readers = useQuery({
    ...trpc.word.suggestions.queryOptions({
      folderId,
      prefix: prefix.length >= 2 ? prefix : undefined,
      limit: 5,
    }),
    // A convenience, not a result: offline or on a freeform shelf there are
    // simply none, and a retry would only delay the definition card.
    retry: false,
  });
  // One typed letter narrows nothing, so the list waits for a second. The
  // word already in the field is not a suggestion for itself.
  const readerWords =
    typed.length === 0 || prefix.length >= 2
      ? (readers.data ?? []).filter((match) => match.normalizedTerm !== normalizeTerm(term))
      : [];

  // AI-picked words for the subjects the book draws on, generated once per
  // book on the server and checked against a dictionary. Shown only while the
  // field is empty: once the reader types their own word, these are in the way.
  const topics = useQuery({ ...trpc.word.topicWords.queryOptions({ folderId }), retry: false });
  const topicGroups = typed.length === 0 ? (topics.data ?? []) : [];

  // Dictionary words starting with what's typed, from this phone's own
  // dictionary — so a reader types "persp" and taps "perspicacious" instead of
  // spelling it out. An index read on the device, so it works offline and costs
  // nothing per keystroke. Listed after other readers' words, which already
  // cover the names and invented words a dictionary can't.
  const db = useSQLiteContext();
  const dictionaryMatches = useQuery({
    queryKey: ["term-completions", prefix],
    queryFn: () => completeTerm(db, normalizeTerm(prefix), 6),
    enabled: prefix.length >= 2,
  });
  const readerTerms = new Set(readerWords.map((match) => match.normalizedTerm));
  const dictionaryWords =
    typed.length >= 2
      ? (dictionaryMatches.data ?? []).filter((word) => word !== normalizeTerm(term) && !readerTerms.has(word))
      : [];

  return (
    <Container className="px-6 pb-8">
      {/* A modal needs a visible way out: the swipe-down gesture is iOS-only
          and undiscoverable, and Android shows no back arrow on a modal. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              className="px-2.5"
            >
              <Ionicons name="close" size={24} color={foregroundColor} />
            </Pressable>
          ),
        }}
      />

      <View className="gap-3 pt-4">
        <View className="flex-row items-start gap-3">
          <View className="flex-1">
            <form.Field name="term">
              {(field) => (
                <TextField
                  label="Word"
                  error={getFormErrorMessage(field.state.meta.errors)}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChangeText={field.handleChange}
                  placeholder="perspicacious"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="done"
                />
              )}
            </form.Field>
          </View>
          <View className="w-[88px]">
            <TextField
              label="Page"
              value={shownPage}
              onChangeText={(text) => setPageText(text.replace(/[^0-9]/g, ""))}
              placeholder="—"
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
        </View>

        {readerWords.length > 0 ? (
          <View>
            {/* Other readers' data stays muted grey by rule. */}
            <Kicker>Readers of this book saved</Kicker>
            {readerWords.map((match) => (
              <Pressable
                key={match.normalizedTerm}
                onPress={() => form.setFieldValue("term", match.term)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${match.term}`}
                className="flex-row items-baseline justify-between gap-3 border-b border-surface-strong py-2.5"
              >
                <Text className="flex-1 font-serif-semibold text-[16px] text-foreground">{match.term}</Text>
                <Text className="font-serif text-[11px] text-muted">
                  {match.readers === 1 ? "1 reader" : `${match.readers} readers`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {dictionaryWords.length > 0 ? (
          <View>
            <Kicker>From the dictionary</Kicker>
            <View className="mt-1.5 flex-row flex-wrap gap-2">
              {dictionaryWords.map((word) => (
                <Pressable
                  key={word}
                  onPress={() => form.setFieldValue("term", word)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${word}`}
                  className="rounded-card border border-surface-strong px-2.5 py-1.5"
                >
                  <Text className="font-serif text-[14px] text-foreground">{word}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {topicGroups.length > 0 ? (
          <View className="gap-3 pt-1">
            <Kicker>Suggested by AI for this book</Kicker>
            {topicGroups.map((group) => (
              <View key={group.topic}>
                <Text className="font-serif text-[12.5px] text-muted">{group.topic}</Text>
                <View className="mt-1.5 flex-row flex-wrap gap-2">
                  {group.terms.map((word) => (
                    <Pressable
                      key={word}
                      onPress={() => form.setFieldValue("term", word)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${word}`}
                      className="rounded-card border border-surface-strong px-2.5 py-1.5"
                    >
                      <Text className="font-serif text-[14px] text-foreground">{word}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {resolution.isFetching && !suggestion ? (
          <View className="items-start py-2">
            <Spinner size="sm" />
          </View>
        ) : suggestion ? (
          <Surface variant="secondary" className="p-4 rounded-lg">
            <View className="flex-row items-center gap-2 mb-2">
              <Text className="text-foreground font-serif-semibold text-base">{suggestion.term}</Text>
              {suggestion.partOfSpeech ? (
                <Chip size="sm" variant="soft" color="default">
                  <Chip.Label className="font-serif-medium">{suggestion.partOfSpeech}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-foreground text-[15px] font-serif leading-6">{suggestion.definition}</Text>
            <Text className="font-serif text-muted text-xs mt-2">
              {suggestion.fromNetwork ? "Found online." : "From your offline dictionary."}
            </Text>

            <WordUsage
              contexts={suggestion.contexts}
              exampleSentence={suggestion.exampleSentence}
              usageNote={suggestion.usageNote}
            />
          </Surface>
        ) : hasSearched ? (
          <Surface variant="secondary" className="p-4 rounded-lg">
            <Text className="font-serif text-muted text-sm">
              {resolution.data?.status === "unreachable"
                ? "No connection, and not in your offline dictionary. Save the word now — its definition fills in once it's looked up online."
                : "Not in any dictionary — this may be a name or a word invented for the book. Save it anyway, and write what it means in your note on the word's page."}
            </Text>
          </Surface>
        ) : null}

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-1">
              {isSubmitting ? <Spinner size="sm" color="default" /> : <Button.Label className="font-serif-medium">Save word</Button.Label>}
            </Button>
          )}
        </form.Subscribe>
      </View>
    </Container>
  );
}
