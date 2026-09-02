import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Card, Chip, Input, Label, Spinner, Surface, TextField, useThemeColor } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { trpc } from "@/utils/trpc";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const trimmedQuery = debouncedQuery.trim();
  const mutedColor = useThemeColor("muted");

  const results = useQuery({
    ...trpc.word.search.queryOptions({ query: trimmedQuery }),
    // `word.search` requires a non-empty query; the server caps results at 50.
    enabled: trimmedQuery.length > 0,
  });

  return (
    <Container className="px-6 pb-8">
      <View className="pt-4">
        <TextField>
          <Label>Search your words</Label>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Any word, any folder"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </TextField>
      </View>

      {trimmedQuery.length === 0 && (
        <View className="items-center py-12">
          <Ionicons name="search-outline" size={32} color={mutedColor} />
          <Text className="text-muted text-sm mt-3">Search across every folder on your shelf.</Text>
        </View>
      )}

      {trimmedQuery.length > 0 && results.isPending && (
        <View className="items-center py-10">
          <Spinner />
        </View>
      )}

      {results.error && (
        <Surface variant="secondary" className="p-4 rounded-lg mt-4">
          <Text className="text-danger">{results.error.message}</Text>
        </Surface>
      )}

      {trimmedQuery.length > 0 && results.data?.length === 0 && (
        <View className="items-center py-12">
          <Text className="text-muted text-sm">No words match &quot;{trimmedQuery}&quot;.</Text>
        </View>
      )}

      <View className="gap-3 pt-4">
        {results.data?.map((word) => {
          const definition = word.definitionOverride ?? word.dictionaryEntry?.definition ?? null;

          return (
            <Link
              key={word.id}
              href={{ pathname: "/folder/[id]", params: { id: word.folderId } }}
              asChild
            >
              <Pressable>
                <Card variant="secondary" className="p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Card.Title className="font-serif-semibold text-base">{word.term}</Card.Title>
                      {definition ? (
                        <Card.Description className="font-serif leading-6">{definition}</Card.Description>
                      ) : (
                        <Chip size="sm" variant="soft" color="warning" className="mt-1 self-start">
                          <Chip.Label>Pending definition</Chip.Label>
                        </Chip>
                      )}
                      <Text className="text-muted text-xs mt-2">{word.folder.title}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={mutedColor} />
                  </View>
                </Card>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </Container>
  );
}
