import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Input, Spinner, TextField } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { MASTERY_CLASS, masteryOf } from "@/lib/mastery";
import { trpc } from "@/utils/trpc";

/**
 * The design's `search` screen — one field over every shelf.
 *
 * The design splits results into "On your shelves" and "Not saved yet", the
 * second being terms other readers saved. `word.suggestions` is scoped to one
 * folder's book, so there is no cross-shelf source for that half; searching
 * unsaved words belongs to `dictionary.lookup`, which costs a request per
 * keystroke. Only the reader's own words are listed here.
 */

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const trimmedQuery = debouncedQuery.trim();

  const results = useQuery({
    ...trpc.word.search.queryOptions({ query: trimmedQuery }),
    // `word.search` requires a non-empty query; the server caps results at 50.
    enabled: trimmedQuery.length > 0,
  });

  return (
    <Container className="px-6 pb-8">
      <View className="pt-4">
        <TextField>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Any word, any shelf"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="font-serif-semibold text-[19px]"
          />
        </TextField>
      </View>

      {trimmedQuery.length === 0 ? (
        <Text className="mt-6 text-[13.5px] leading-[21px] text-muted">
          Search across every shelf you keep.
        </Text>
      ) : null}

      {trimmedQuery.length > 0 && results.isPending ? (
        <View className="items-center py-10">
          <Spinner />
        </View>
      ) : null}

      {results.error ? (
        <Text className="mt-5 text-[13px] text-danger">{results.error.message}</Text>
      ) : null}

      {trimmedQuery.length > 0 && results.data?.length === 0 ? (
        <Text className="mt-6 text-[13.5px] text-muted">
          No words match &quot;{trimmedQuery}&quot;.
        </Text>
      ) : null}

      {results.data?.length ? (
        <View className="mt-6">
          <Text className="mb-2 font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">
            On your shelves
          </Text>

          {results.data.map((word) => {
            const definition = word.definitionOverride ?? word.dictionaryEntry?.definition ?? null;
            const mastery = masteryOf(word);

            return (
              <Link
                key={word.id}
                href={{ pathname: "/word/[id]", params: { id: word.id, folderId: word.folderId } }}
                asChild
              >
                <Pressable className="border-b border-surface-strong py-3.5">
                  <View className="flex-row items-baseline gap-2.5">
                    <Text className="font-serif-semibold text-[19px] leading-[22px] text-foreground">
                      {word.term}
                    </Text>
                    <Text
                      className={`text-[11px] uppercase tracking-[0.6px] ${MASTERY_CLASS[mastery]}`}
                    >
                      {mastery}
                    </Text>
                  </View>
                  <Text className="mt-1 text-[13px] text-muted">{word.folder.title}</Text>
                  {definition ? (
                    <Text className="mt-1 text-[13.5px] leading-[20px] text-muted" numberOfLines={2}>
                      {definition}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
            );
          })}
        </View>
      ) : null}
    </Container>
  );
}
