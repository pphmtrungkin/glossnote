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
import { useDefinition } from "@/hooks/use-definition";
import { trpc } from "@/utils/trpc";

const addWordSchema = z.object({
  term: z.string().trim().min(1, "Enter the word you looked up"),
  definition: z.string(),
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
    defaultValues: { term: "", definition: "" },
    validators: { onSubmit: addWordSchema },
    onSubmit: async ({ value }) => {
      const definition = value.definition.trim();

      await createWord.mutateAsync({
        folderId,
        term: value.term.trim(),
        // Stays on this user's row as definitionOverride — definitions are
        // never shared between readers, only lookup counts are.
        definition: definition || undefined,
        captureMethod: "manual",
      });

      router.back();
    },
  });

  const term = useStore(form.store, (state) => state.values.term);
  const debouncedTerm = useDebouncedValue(term);

  // Device dictionary first, server second, result cached for next time — all
  // of it behind one call. See hooks/use-definition.ts.
  const resolution = useDefinition(debouncedTerm);
  const suggestion = resolution.data?.status === "found" ? resolution.data : null;

  useEffect(() => {
    if (!suggestion || isDefinitionUserEdited.current) return;
    form.setFieldValue("definition", suggestion.definition);
    // Only the definition text matters here; `suggestion` is rebuilt each
    // render, so depend on the value rather than the object.
  }, [suggestion?.definition, form]);

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
              {suggestion.fromNetwork
                ? "Found online — edit it below if it's the wrong sense."
                : "Found in your offline dictionary — edit it below if it's the wrong sense."}
            </Text>
          </Surface>
        ) : hasSearched ? (
          <Surface variant="secondary" className="p-4 rounded-lg">
            <Text className="text-muted text-sm">
              {resolution.data?.status === "unreachable"
                ? "No connection, and not in your offline dictionary. Type a definition below, or save the word now and fill it in later."
                : "Not in any dictionary — this may be a name or a word invented for the book. Type a definition below, or save the word now and fill it in later."}
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
