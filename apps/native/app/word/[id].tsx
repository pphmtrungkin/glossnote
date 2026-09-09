import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Spinner, TextArea, useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useFolders } from "@/hooks/use-folders";
import { masteryOf } from "@/lib/mastery";
import { trpc } from "@/utils/trpc";

/**
 * The design's `word` screen — one saved word in full.
 *
 * There is no `word.byId` procedure and this deliberately doesn't add one: the
 * row is already in the folder's list, which the previous screen just fetched,
 * so reading it from the cache costs nothing and keeps the two screens showing
 * the same thing. The `folderId` param is what makes that lookup one query
 * instead of a scan of every folder.
 */

/** Section label — the same small tracked kicker the rest of the app uses. */
function Kicker({ children }: { children: string }) {
  return (
    <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">
      {children}
    </Text>
  );
}

function longDate(date: Date) {
  return date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export default function WordScreen() {
  const { id, folderId } = useLocalSearchParams<{ id: string; folderId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const words = useQuery(trpc.word.listByFolder.queryOptions({ folderId }));
  const folders = useFolders();

  const word = words.data?.find((candidate) => candidate.id === id);
  const folder = folders.data?.find((candidate) => candidate.id === folderId);

  const [note, setNote] = useState("");
  // Seeded once the row arrives, and again if the reader navigates to another
  // word without the screen unmounting.
  useEffect(() => setNote(word?.personalNote ?? ""), [word?.id, word?.personalNote]);

  const updateWord = useMutation(
    trpc.word.update.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.word.listByFolder.queryKey({ folderId }),
        }),
      onError: (error) => toast.show({ variant: "danger", label: error.message }),
    }),
  );

  if (words.isPending) {
    return (
      <Container className="items-center justify-center">
        <Spinner />
      </Container>
    );
  }

  if (!word) {
    return (
      <Container className="items-center justify-center px-8">
        <Stack.Screen options={{ title: "Word" }} />
        <Text className="text-center text-[14px] text-muted">
          That word is no longer on this shelf.
        </Text>
      </Container>
    );
  }

  const entry = word.dictionaryEntry;
  const definition = word.definitionOverride ?? entry?.definition ?? null;
  const state = masteryOf(word);

  return (
    <Container className="px-6 pb-8">
      <Stack.Screen options={{ title: folder?.title ?? "Word" }} />

      <Text className="mt-3 text-[10.5px] uppercase tracking-[1.5px] text-muted">
        {/* The design ends this line with a page number. Captures don't record
            one, so the shelf title is where it stops. */}
        {[state, folder?.title].filter(Boolean).join(" · ")}
      </Text>

      <Text className="mt-3.5 font-serif-semibold text-[40px] leading-[40px] tracking-[-1px] text-foreground">
        {word.term}
      </Text>

      {/* ---- What it means -------------------------------------------------- */}
      <View className="mt-6 border-t-2 border-foreground pt-4">
        {definition ? (
          <Text className="text-[17px] leading-[26px] text-foreground">{definition}</Text>
        ) : (
          <Text className="text-[14px] text-muted">
            No definition resolved yet. It fills in the next time this word is looked up online.
          </Text>
        )}
      </View>

      {/* The AI columns' first reader on this screen: `dictionary.lookup` has
          been writing both since enrichment landed. Both are on the shared
          term-keyed row, so they're the same for every reader of this word. */}
      {entry?.exampleSentence ? (
        <Text className="mt-5 border-l-2 border-primary-soft pl-4 font-italic text-[15.5px] leading-[25px] text-foreground">
          {entry.exampleSentence}
        </Text>
      ) : null}

      {entry?.usageNote ? (
        <Text className="mt-4 text-[13.5px] leading-[21px] text-muted">{entry.usageNote}</Text>
      ) : null}

      {/* ---- Two facts the row actually carries ----------------------------- */}
      <View className="mt-7 flex-row gap-4">
        <View className="flex-1">
          <Kicker>Saved</Kicker>
          <Text className="mt-1.5 text-[15px] text-foreground">
            {longDate(new Date(word.createdAt))}
          </Text>
        </View>
        <View className="flex-1">
          {/* The design says "Next review". There is no schedule — `word.quiz`
              sorts by least recently reviewed — so this reports the past
              instead of promising a future. */}
          <Kicker>Last practised</Kicker>
          <Text className="mt-1.5 text-[15px] text-foreground">
            {word.lastReviewedAt ? longDate(new Date(word.lastReviewedAt)) : "Not yet"}
          </Text>
        </View>
      </View>

      {/* ---- The reader's own note ------------------------------------------ */}
      <View className="mt-7">
        <Kicker>Your note</Kicker>
        <TextArea
          value={note}
          onChangeText={setNote}
          placeholder="Where you met it, or how you'd use it."
          className="mt-2"
          numberOfLines={3}
        />
        {note !== (word.personalNote ?? "") ? (
          <Pressable
            onPress={() => updateWord.mutate({ id: word.id, personalNote: note })}
            className="mt-2 self-start"
          >
            <Text className="font-serif-semibold text-[12.5px] text-primary">Save note</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ---- Actions --------------------------------------------------------- */}
      {/* The design's second button is "Ask about it", which opens a tutor chat
          that has no server behind it. Mastery is the real second action: it is
          what takes a word out of the review rotation. */}
      <View className="mt-8 flex-row gap-2">
        <Pressable
          onPress={() => router.push({ pathname: "/review", params: { folderId } })}
          className="min-h-[46px] flex-1 items-center justify-center rounded-card bg-primary"
        >
          <Text className="font-serif-semibold text-[14px] text-primary-content">Practise now</Text>
        </Pressable>
        <Pressable
          onPress={() => updateWord.mutate({ id: word.id, mastered: !word.mastered })}
          className={`min-h-[46px] flex-1 items-center justify-center rounded-card border ${
            word.mastered ? "border-primary bg-primary-tint" : "border-surface-strong"
          }`}
        >
          <Text
            className={`font-serif-semibold text-[14px] ${
              word.mastered ? "text-primary-deep" : "text-foreground"
            }`}
          >
            {word.mastered ? "Mastered" : "Mark mastered"}
          </Text>
        </Pressable>
      </View>
    </Container>
  );
}
