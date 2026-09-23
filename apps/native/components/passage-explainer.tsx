import { MAX_PASSAGE_LENGTH } from "@better-vocab/domain";
import { useQuery } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { Button, Spinner, Surface } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Notice } from "@/components/notice";
import { TextField } from "@/components/text-field";
import { PASSAGE_NOTES_KEY, useExplainPassage } from "@/hooks/use-explain-passage";
import { listPassageNotes, type PassageNote } from "@/lib/passage";

/** How many past explanations the history lists. */
const HISTORY_LIMIT = 5;

/** Characters left before the cap starts being worth mentioning. */
const COUNTDOWN_FROM = 100;

/**
 * Context mode — "I understood every word and still don't know what this says."
 *
 * The other half of the add-word screen. Word mode ends in a save; this ends in
 * an answer, and the two are deliberately not made to look alike: there is no
 * Save button here that quietly does nothing. What it produces is kept on this
 * device only (lib/passage.ts), so the history below the field is this phone's,
 * not this account's.
 *
 * The result is two parts because the difficulty comes in two kinds. `plain` is
 * the passage said straight, for a reader who has lost the thread entirely.
 * `notes` picks out the phrases that carried the trouble — the allusion, the
 * metaphor, the joke — for a reader who followed it but felt something go past
 * them. Munger's "bad press in the laws of Moses" needs the second, not the
 * first: the sentence parses perfectly and means nothing without the tenth
 * commandment.
 */
export function PassageExplainer({ folderId }: { folderId?: string }) {
  const db = useSQLiteContext();
  const [passage, setPassage] = useState("");
  const explain = useExplainPassage({ folderId });

  // This phone's past explanations, newest first — context mode's equivalent
  // of the word recommendations, and the only reason the local table exists.
  const history = useQuery({
    queryKey: [...PASSAGE_NOTES_KEY, folderId ?? null],
    queryFn: () => listPassageNotes(db, { folderId, limit: HISTORY_LIMIT }),
  });

  const trimmed = passage.trim();
  const remaining = MAX_PASSAGE_LENGTH - passage.length;
  const result = explain.data;

  // A past explanation is shown by putting its passage back in the field and
  // asking again — which the device cache answers without a call, so reopening
  // one is free and works offline.
  const reopen = (note: PassageNote) => {
    setPassage(note.passage);
    explain.mutate(note.passage);
  };

  return (
    <View className="gap-3">
      <TextField
        label="Passage"
        value={passage}
        onChangeText={(text) => setPassage(text.slice(0, MAX_PASSAGE_LENGTH))}
        placeholder="Paste or type the sentence you're stuck on"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />

      {remaining <= COUNTDOWN_FROM ? (
        <Text className="font-serif text-[12px] text-muted">
          {remaining === 0
            ? "That's the longest passage I can take — trim it to the part that's giving trouble."
            : `${remaining} characters left`}
        </Text>
      ) : null}

      <Button
        onPress={() => explain.mutate(trimmed)}
        isDisabled={trimmed.length === 0 || explain.isPending}
      >
        {explain.isPending ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label className="font-serif-medium">Explain</Button.Label>
        )}
      </Button>

      {explain.isError ? (
        <Notice
          tone="warn"
          title="Couldn't explain that"
          body={explain.error.message}
          action={
            <Pressable
              onPress={() => explain.mutate(trimmed)}
              accessibilityRole="button"
              className="mt-2"
            >
              <Text className="font-serif-semibold text-[12.5px] text-primary">Try again</Text>
            </Pressable>
          }
        />
      ) : null}

      {result ? (
        // An empty `plain` with no notes is a real answer, not a failure: the
        // model was asked to say nothing rather than invent difficulty.
        result.plain || result.notes.length > 0 ? (
          <Surface variant="secondary" className="gap-3 rounded-lg p-4">
            {result.plain ? (
              <Text className="font-serif text-[15px] leading-6 text-foreground">
                {result.plain}
              </Text>
            ) : null}

            {result.notes.length > 0 ? (
              <View className="gap-2.5">
                {result.notes.map((note) => (
                  <View key={note.phrase} className="border-surface-strong border-t pt-2.5">
                    {/* The reader's own book quoted back at them — the one place
                        the app shows book text, and it never leaves the device. */}
                    <Text className="font-italic text-[14px] leading-5 text-foreground">
                      {note.phrase}
                    </Text>
                    <Text className="mt-1 font-serif text-[13.5px] leading-5 text-muted">
                      {note.gloss}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Surface>
        ) : (
          <Notice
            tone="info"
            title="This one reads plainly"
            body="Nothing here is doing anything unusual — no metaphor, allusion or turn worth flagging."
          />
        )
      ) : null}

      {!result && !explain.isPending && (history.data ?? []).length > 0 ? (
        <View>
          <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">
            Explained on this device
          </Text>
          {(history.data ?? []).map((note) => (
            <Pressable
              key={note.passage}
              onPress={() => reopen(note)}
              accessibilityRole="button"
              accessibilityLabel={`Reopen: ${note.passage}`}
              className="border-surface-strong border-b py-2.5"
            >
              <Text numberOfLines={2} className="font-serif text-[14px] leading-5 text-foreground">
                {note.passage}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
