import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { Button, Card, Chip, Spinner, Surface, useThemeColor, useToast } from "heroui-native";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutedColor = useThemeColor("muted");
  const foregroundColor = useThemeColor("foreground");

  const folders = useQuery(trpc.folder.list.queryOptions());
  const folder = folders.data?.find((candidate) => candidate.id === id);

  const words = useQuery(trpc.word.listByFolder.queryOptions({ folderId: id }));

  function invalidateWords() {
    return queryClient.invalidateQueries({
      queryKey: trpc.word.listByFolder.queryKey({ folderId: id }),
    });
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
    </Container>
  );
}
