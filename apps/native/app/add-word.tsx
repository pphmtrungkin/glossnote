import { normalizeTerm } from "@better-vocab/domain";
import { useForm, useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Chip,
  FieldError,
  Input,
  Label,
  Spinner,
  Surface,
  TextField,
  useToast,
} from "heroui-native";
import { useRef } from "react";
import { Text, View } from "react-native";
import z from "zod";

import { Container } from "@/components/container";
import { WordUsage } from "@/components/word-usage";
import { useCaptureWord } from "@/hooks/use-capture-word";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDefinition } from "@/hooks/use-definition";
import { trpc } from "@/utils/trpc";

const addWordSchema = z.object({
  term: z.string().trim().min(1, "Enter the word you looked up"),
});

export default function AddWordScreen() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Saves through the shared capture path, which queues the word on this
  // device when the request never leaves it. See hooks/use-capture-word.ts.
  const createWord = useCaptureWord({
    onSettled: (outcome) => {
      if (outcome.status === "queued") {
        toast.show({ label: "Saved on this device — it will sync when you're back online." });
        return;
      }
      queryClient.invalidateQueries({
        queryKey: trpc.word.listByFolder.queryKey({ folderId }),
      });
    },
    onError: (error) => toast.show({ variant: "danger", label: error.message }),
  });

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

  return (
    <Container className="px-6 pb-8">
      <View className="gap-3 pt-4">
        <form.Field name="term">
          {(field) => (
            <TextField>
              <Label>Word</Label>
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChangeText={field.handleChange}
                placeholder="perspicacious"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
              />
              <FieldError isInvalid={!field.state.meta.isValid}>
                {field.state.meta.errors[0]?.message}
              </FieldError>
            </TextField>
          )}
        </form.Field>

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
                  <Chip.Label>{suggestion.partOfSpeech}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-foreground text-[15px] font-serif leading-6">{suggestion.definition}</Text>
            <Text className="text-muted text-xs mt-2">
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
            <Text className="text-muted text-sm">
              {resolution.data?.status === "unreachable"
                ? "No connection, and not in your offline dictionary. Save the word now — its definition fills in once it's looked up online."
                : "Not in any dictionary — this may be a name or a word invented for the book. Save it anyway, and write what it means in your note on the word's page."}
            </Text>
          </Surface>
        ) : null}

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-1">
              {isSubmitting ? <Spinner size="sm" color="default" /> : <Button.Label>Save word</Button.Label>}
            </Button>
          )}
        </form.Subscribe>
      </View>
    </Container>
  );
}
