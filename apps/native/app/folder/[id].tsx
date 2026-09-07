import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { Button, Card, Chip, Spinner, Surface, useThemeColor, useToast } from "heroui-native";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useDefinition } from "@/hooks/use-definition";
import { trpc } from "@/utils/trpc";

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
    <Card variant="secondary" className="p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Card.Title className="font-serif-semibold text-base">{term}</Card.Title>
          {definition ? (
            <Card.Description className="font-serif leading-6">{definition}</Card.Description>
          ) : (
            <Text className="text-muted text-xs mt-1">Not in your offline dictionary yet.</Text>
          )}
          <Text className="text-muted text-xs mt-2">
            {readers === 1 ? "1 other reader saved this" : `${readers} other readers saved this`}
          </Text>
        </View>
        <Button size="sm" variant="tertiary" isDisabled={isAdding} onPress={() => onAdd(definition ?? undefined)}>
          <Button.Label>Add</Button.Label>
        </Button>
      </View>
    </Card>
  );
}

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutedColor = useThemeColor("muted");
  const foregroundColor = useThemeColor("foreground");

  const folders = useQuery(trpc.folder.list.queryOptions());
  const folder = folders.data?.find((candidate) => candidate.id === id);

  const words = useQuery(trpc.word.listByFolder.queryOptions({ folderId: id }));

  // Only meaningful once the folder is linked to a book — the server returns an
  // empty list for freeform folders rather than erroring.
  const suggestions = useQuery({
    ...trpc.word.suggestions.queryOptions({ folderId: id }),
    enabled: !!folder?.bookId,
  });

  function invalidateWords() {
    // Adding a suggested word removes it from the suggestion list, so both
    // queries have to refetch.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.word.listByFolder.queryKey({ folderId: id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.word.suggestions.queryKey({ folderId: id }) }),
    ]);
  }

  function showError(error: { message: string }) {
    toast.show({ variant: "danger", label: error.message });
  }

  const updateWord = useMutation(
    trpc.word.update.mutationOptions({ onSuccess: invalidateWords, onError: showError }),
  );
  const deleteWord = useMutation(
    trpc.word.delete.mutationOptions({ onSuccess: invalidateWords, onError: showError }),
  );
  const addWord = useMutation(
    trpc.word.create.mutationOptions({ onSuccess: invalidateWords, onError: showError }),
  );

  function confirmDelete(wordId: string, term: string) {
    Alert.alert("Delete word?", `"${term}" will be removed from this folder.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteWord.mutate({ id: wordId }) },
    ]);
  }

  return (
    <Container className="px-6 pb-8">
      <Stack.Screen
        options={{
          title: folder?.title ?? "Folder",
          headerRight: () => (
            <Link href={{ pathname: "/add-word", params: { folderId: id } }} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Add word" className="px-2.5">
                <Ionicons name="add" size={24} color={foregroundColor} />
              </Pressable>
            </Link>
          ),
        }}
      />

      {words.isPending && (
        <View className="items-center py-10">
          <Spinner />
        </View>
      )}

      {words.error && (
        <Surface variant="secondary" className="p-4 rounded-lg mt-4">
          <Text className="text-danger mb-3">{words.error.message}</Text>
          <Button size="sm" variant="tertiary" onPress={() => words.refetch()}>
            <Button.Label>Try again</Button.Label>
          </Button>
        </Surface>
      )}

      {words.data?.length === 0 && (
        <Surface variant="secondary" className="p-6 rounded-lg items-center mt-4">
          <Ionicons name="bookmark-outline" size={32} color={mutedColor} />
          <Text className="text-foreground font-medium mt-3 mb-1">No words yet</Text>
          <Text className="text-muted text-sm text-center mb-4">
            Log the first word you looked up while reading this.
          </Text>
          <Link href={{ pathname: "/add-word", params: { folderId: id } }} asChild>
            <Button size="sm">
              <Button.Label>Add a word</Button.Label>
            </Button>
          </Link>
        </Surface>
      )}

      <View className="gap-3 pt-4">
        {words.data?.map((word) => {
          // The personal override wins over the shared dictionary entry — see
          // the `definitionOverride` comment in packages/db/src/schema/word.ts.
          const definition = word.definitionOverride ?? word.dictionaryEntry?.definition ?? null;

          return (
            <Card key={word.id} variant="secondary" className="p-4">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Card.Title
                    className={`font-serif-semibold text-lg ${word.mastered ? "line-through" : ""}`}
                  >
                    {word.term}
                  </Card.Title>
                  {definition ? (
                    <Card.Description className="font-serif leading-6">{definition}</Card.Description>
                  ) : (
                    // Not an error: word.create leaves dictionaryEntryId null
                    // when no definition was known at capture time.
                    <Chip size="sm" variant="soft" color="warning" className="mt-1 self-start">
                      <Chip.Label>Pending definition</Chip.Label>
                    </Chip>
                  )}
                  {word.dictionaryEntry?.exampleSentence ? (
                    <Text className="text-muted text-xs italic mt-2 font-serif">{word.dictionaryEntry.exampleSentence}</Text>
                  ) : null}
                </View>
              </View>

              <View className="flex-row gap-2 mt-3">
                <Button
                  size="sm"
                  variant={word.mastered ? "primary" : "tertiary"}
                  onPress={() => updateWord.mutate({ id: word.id, mastered: !word.mastered })}
                >
                  <Button.Label>{word.mastered ? "Mastered" : "Mark mastered"}</Button.Label>
                </Button>
                <Button size="sm" variant="danger-soft" onPress={() => confirmDelete(word.id, word.term)}>
                  <Button.Label>Delete</Button.Label>
                </Button>
              </View>
            </Card>
          );
        })}
      </View>

      {!!suggestions.data?.length && (
        <View className="pt-8">
          <Text className="text-foreground font-serif-medium text-base mb-1">Other readers looked up</Text>
          <Text className="text-muted text-xs mb-3">
            Words readers of this book saved, that you don&apos;t have yet.
          </Text>
          <View className="gap-3">
            {suggestions.data.map((suggestion) => (
              <SuggestionRow
                key={suggestion.normalizedTerm}
                term={suggestion.term}
                readers={suggestion.readers}
                isAdding={addWord.isPending}
                onAdd={(definition) =>
                  addWord.mutate({ folderId: id, term: suggestion.term, definition, captureMethod: "manual" })
                }
              />
            ))}
          </View>
        </View>
      )}
    </Container>
  );
}
