import type { AppRouter } from "@better-vocab/api/routers/index";
import { Ionicons } from "@expo/vector-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Link } from "expo-router";
import {
  Button,
  Card,
  Chip,
  FieldError,
  Input,
  Label,
  Spinner,
  Surface,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import z from "zod";

import { Container } from "@/components/container";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  FOLDER_STATUSES,
  FOLDER_STATUS_COLORS,
  FOLDER_STATUS_LABELS,
  type FolderStatus,
} from "@/lib/folder-status";
import { trpc } from "@/utils/trpc";

// One result from Hardcover, shaped by book.search. `folder.create` takes this
// object straight back and upserts it — the client never handles a book id.
type BookHit = inferRouterOutputs<AppRouter>["book"]["search"][number];

const folderSchema = z.object({
  title: z.string().trim().min(1, "Give the folder a title"),
  status: z.enum(FOLDER_STATUSES),
});

export default function ShelfScreen() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutedColor = useThemeColor("muted");
  const [isFormOpen, setIsFormOpen] = useState(false);

  // The Hardcover hit the user picked, held until submit. Null means a
  // freeform folder — either they skipped search, or they're offline and typed
  // a title by hand, which UserFlow §2 requires to keep working.
  const [pickedBook, setPickedBook] = useState<BookHit | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const debouncedBookQuery = useDebouncedValue(bookQuery);

  const folders = useQuery(trpc.folder.list.queryOptions());

  // Debounced and gated on a picked book: Hardcover's free tier allows 60
  // requests a minute with a burst of 10, so a request per keystroke would
  // burn the budget on one search.
  const bookResults = useQuery({
    ...trpc.book.search.queryOptions({ query: debouncedBookQuery.trim() }),
    enabled: !pickedBook && debouncedBookQuery.trim().length >= 2,
    retry: false,
  });

  function invalidateFolders() {
    return queryClient.invalidateQueries({ queryKey: trpc.folder.list.queryKey() });
  }

  function showError(error: { message: string }) {
    toast.show({ variant: "danger", label: error.message });
  }

  const createFolder = useMutation(
    trpc.folder.create.mutationOptions({ onSuccess: invalidateFolders, onError: showError }),
  );
  const updateStatus = useMutation(
    trpc.folder.updateStatus.mutationOptions({ onSuccess: invalidateFolders, onError: showError }),
  );
  const deleteFolder = useMutation(
    trpc.folder.delete.mutationOptions({ onSuccess: invalidateFolders, onError: showError }),
  );

  const form = useForm({
    defaultValues: { title: "", status: "reading" as FolderStatus },
    validators: { onSubmit: folderSchema },
    onSubmit: async ({ value, formApi }) => {
      await createFolder.mutateAsync({
        title: value.title.trim(),
        status: value.status,
        book: pickedBook ?? undefined,
      });
      formApi.reset();
      closeForm();
    },
  });

  function closeForm() {
    setIsFormOpen(false);
    setPickedBook(null);
    setBookQuery("");
  }

  function pickBook(hit: BookHit) {
    setPickedBook(hit);
    form.setFieldValue("title", hit.title);
    setBookQuery("");
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert("Delete folder?", `"${title}" and every word in it will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteFolder.mutate({ id }) },
    ]);
  }

  return (
    <Container className="px-6 pb-8">
      <View className="flex-row items-center justify-between py-4">
        <Text className="text-2xl font-serif-bold text-foreground">Your shelf</Text>
        <Button
          size="sm"
          variant={isFormOpen ? "tertiary" : "primary"}
          onPress={() => (isFormOpen ? closeForm() : setIsFormOpen(true))}
        >
          <Button.Label>{isFormOpen ? "Cancel" : "New folder"}</Button.Label>
        </Button>
      </View>

      {isFormOpen && (
        <Surface variant="secondary" className="p-4 rounded-lg mb-4">
          <Text className="text-foreground font-medium mb-4">New folder</Text>

          {pickedBook ? (
            <Surface variant="secondary" className="flex-row items-center gap-3 mb-3 p-2 rounded-md">
              {pickedBook.coverImageUrl ? (
                <Image source={{ uri: pickedBook.coverImageUrl }} className="w-10 h-14 rounded" resizeMode="cover" />
              ) : (
                <View className="w-10 h-14 rounded items-center justify-center bg-surface-2">
                  <Ionicons name="book-outline" size={18} color={mutedColor} />
                </View>
              )}
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {pickedBook.title}
                </Text>
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {pickedBook.authors.join(", ") || "Unknown author"}
                </Text>
              </View>
              <Button size="sm" variant="tertiary" onPress={() => setPickedBook(null)}>
                <Button.Label>Change</Button.Label>
              </Button>
            </Surface>
          ) : (
            <View className="mb-3">
              <TextField>
                <Label>Find the book</Label>
                <Input
                  value={bookQuery}
                  onChangeText={setBookQuery}
                  placeholder="Search Hardcover, or skip for a freeform folder"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </TextField>

              {bookResults.isFetching && (
                <View className="py-3 items-center">
                  <Spinner size="sm" />
                </View>
              )}

              {/* Search needs connectivity; typing a title below always works,
                  which is the offline fallback UserFlow §2 asks for. */}
              {bookResults.error && (
                <Text className="text-muted text-xs mt-2">
                  {bookResults.error.message} You can still type a title below.
                </Text>
              )}

              {bookResults.data?.map((hit) => (
                <Pressable key={hit.externalId} onPress={() => pickBook(hit)} className="flex-row items-center gap-3 py-2">
                  {hit.coverImageUrl ? (
                    <Image source={{ uri: hit.coverImageUrl }} className="w-8 h-12 rounded" resizeMode="cover" />
                  ) : (
                    <View className="w-8 h-12 rounded items-center justify-center bg-surface-2">
                      <Ionicons name="book-outline" size={14} color={mutedColor} />
                    </View>
                  )}
                  <View className="flex-1">
                    <Text className="text-foreground text-sm" numberOfLines={1}>
                      {hit.title}
                    </Text>
                    <Text className="text-muted text-xs" numberOfLines={1}>
                      {[hit.authors.join(", "), hit.releaseYear].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                </Pressable>
              ))}

              {bookResults.data?.length === 0 && (
                <Text className="text-muted text-xs mt-2">No matches. Type a title below instead.</Text>
              )}
            </View>
          )}

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <View className="gap-3">
                <form.Field name="title">
                  {(field) => (
                    <TextField>
                      <Label>Title</Label>
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChangeText={field.handleChange}
                        placeholder="Pride and Prejudice"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={form.handleSubmit}
                      />
                      <FieldError isInvalid={!field.state.meta.isValid}>
                        {field.state.meta.errors[0]?.message}
                      </FieldError>
                    </TextField>
                  )}
                </form.Field>

                <form.Field name="status">
                  {(field) => (
                    <View>
                      <Label>Status</Label>
                      <View className="flex-row gap-2 mt-2">
                        {FOLDER_STATUSES.map((status) => (
                          <Chip
                            key={status}
                            size="sm"
                            color={FOLDER_STATUS_COLORS[status]}
                            variant={field.state.value === status ? "primary" : "secondary"}
                            onPress={() => field.handleChange(status)}
                          >
                            <Chip.Label>{FOLDER_STATUS_LABELS[status]}</Chip.Label>
                          </Chip>
                        ))}
                      </View>
                    </View>
                  )}
                </form.Field>

                <Button onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-1">
                  {isSubmitting ? <Spinner size="sm" color="default" /> : <Button.Label>Create folder</Button.Label>}
                </Button>
              </View>
            )}
          </form.Subscribe>
        </Surface>
      )}

      {folders.isPending && (
        <View className="items-center py-10">
          <Spinner />
        </View>
      )}

      {folders.error && (
        <Surface variant="secondary" className="p-4 rounded-lg">
          <Text className="text-danger mb-3">{folders.error.message}</Text>
          <Button size="sm" variant="tertiary" onPress={() => folders.refetch()}>
            <Button.Label>Try again</Button.Label>
          </Button>
        </Surface>
      )}

      {folders.data?.length === 0 && !isFormOpen && (
        <Surface variant="secondary" className="p-6 rounded-lg items-center">
          <Ionicons name="library-outline" size={32} color={mutedColor} />
          <Text className="text-foreground font-medium mt-3 mb-1">Your shelf is empty</Text>
          <Text className="text-muted text-sm text-center mb-4">
            Create a folder for what you&apos;re reading, then log the words you look up.
          </Text>
          <Button size="sm" onPress={() => setIsFormOpen(true)}>
            <Button.Label>Create your first folder</Button.Label>
          </Button>
        </Surface>
      )}

      <View className="gap-3">
        {folders.data?.map((folder) => (
          <Link key={folder.id} href={{ pathname: "/folder/[id]", params: { id: folder.id } }} asChild>
            <Pressable onLongPress={() => confirmDelete(folder.id, folder.title)}>
              <Card variant="secondary" className="p-4">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    <Card.Title className="font-serif-medium text-base">{folder.title}</Card.Title>
                    {/* No author line yet: folders are title-only until a book
                        search populates `folder.bookId`. */}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={mutedColor} />
                </View>

                <View className="flex-row gap-2 mt-3">
                  {FOLDER_STATUSES.map((status) => {
                    const isActive = folder.status === status;
                    return (
                      <Chip
                        key={status}
                        size="sm"
                        color={FOLDER_STATUS_COLORS[status]}
                        variant={isActive ? "primary" : "secondary"}
                        onPress={() => {
                          if (!isActive) updateStatus.mutate({ id: folder.id, status });
                        }}
                      >
                        <Chip.Label>{FOLDER_STATUS_LABELS[status]}</Chip.Label>
                      </Chip>
                    );
                  })}
                </View>
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>

      {!!folders.data?.length && (
        <Text className="text-muted text-xs text-center mt-4">Long-press a folder to delete it.</Text>
      )}
    </Container>
  );
}
