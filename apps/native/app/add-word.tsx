import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Chip,
  FieldError,
  Input,
  Label,
  Spinner,
  Surface,
  TextArea,
  TextField,
  useToast,
} from "heroui-native";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import z from "zod";

import { Container } from "@/components/container";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDictionaryLookup } from "@/hooks/use-dictionary-lookup";
import { trpc } from "@/utils/trpc";

const addWordSchema = z.object({
  term: z.string().trim().min(1, "Enter the word you looked up"),
  definition: z.string(),
  exampleSentence: z.string(),
});

export default function AddWordScreen() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Once the user edits the definition themselves, a later dictionary hit must
  // not clobber what they typed.
  const isDefinitionUserEdited = useRef(false);

  const createWord = useMutation(
    trpc.word.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.word.listByFolder.queryKey({ folderId }),
        });
      },
      onError: (error) => toast.show({ variant: "danger", label: error.message }),
    }),
  );

  const form = useForm({
    defaultValues: { term: "", definition: "", exampleSentence: "" },
    validators: { onSubmit: addWordSchema },
    onSubmit: async ({ value }) => {
      const definition = value.definition.trim();
      const exampleSentence = value.exampleSentence.trim();

      await createWord.mutateAsync({
        folderId,
        term: value.term.trim(),
        definition: definition || undefined,
        exampleSentence: exampleSentence || undefined,
        captureMethod: "manual",
      });

      router.back();
    },
  });

  const term = useStore(form.store, (state) => state.values.term);
  const debouncedTerm = useDebouncedValue(term);
  const lookup = useDictionaryLookup(debouncedTerm);
  const suggestion = lookup.data;

  useEffect(() => {
    if (!suggestion || isDefinitionUserEdited.current) return;
    form.setFieldValue("definition", suggestion.definition);
    if (suggestion.exampleSentence) {
      form.setFieldValue("exampleSentence", suggestion.exampleSentence);
    }
  }, [suggestion, form]);

  const hasSearched = debouncedTerm.trim().length > 0 && !lookup.isFetching;

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
                returnKeyType="next"
              />
              <FieldError isInvalid={!field.state.meta.isValid}>
                {field.state.meta.errors[0]?.message}
              </FieldError>
            </TextField>
          )}
        </form.Field>

        {suggestion ? (
          <Surface variant="secondary" className="p-4 rounded-lg">
            <View className="flex-row items-center gap-2 mb-2">
              <Text className="text-foreground font-serif-semibold text-base">{suggestion.term}</Text>
              {suggestion.partOfSpeech ? (
                <Chip size="sm" variant="soft" color="default">
                  <Chip.Label>{suggestion.partOfSpeech}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-muted text-sm font-serif leading-6">{suggestion.definition}</Text>
            <Text className="text-muted text-xs mt-2">
              Found in your offline dictionary — edit it below if it&apos;s the wrong sense.
            </Text>
          </Surface>
        ) : hasSearched ? (
          <Surface variant="secondary" className="p-4 rounded-lg">
            <Text className="text-muted text-sm">
              Not in your offline dictionary. Type a definition below, or save the word now and fill it in
              later.
            </Text>
          </Surface>
        ) : null}

        <form.Field name="definition">
          {(field) => (
            <TextField>
              <Label>Definition (optional)</Label>
              <TextArea
                value={field.state.value}
                onBlur={field.handleBlur}
                onChangeText={(text) => {
                  isDefinitionUserEdited.current = true;
                  field.handleChange(text);
                }}
                placeholder="Having keen insight or understanding"
                multiline
                numberOfLines={3}
              />
            </TextField>
          )}
        </form.Field>

        <form.Field name="exampleSentence">
          {(field) => (
            <TextField>
              <Label>Example sentence (optional)</Label>
              <TextArea
                value={field.state.value}
                onBlur={field.handleBlur}
                onChangeText={field.handleChange}
                placeholder="The sentence you found it in"
                multiline
                numberOfLines={2}
              />
            </TextField>
          )}
        </form.Field>

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
