import type { AppRouter } from "@better-vocab/api/routers/index";
import { Ionicons } from "@expo/vector-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Link, router } from "expo-router";
import {
  Button,
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
import { useFolders } from "@/hooks/use-folders";
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
  const accentColor = useThemeColor("accent");
  const [isFormOpen, setIsFormOpen] = useState(false);

  // The Hardcover hit the user picked, held until submit. Null means a
  // freeform folder — either they skipped search, or they're offline and typed
  // a title by hand, which UserFlow §2 requires to keep working.
  const [pickedBook, setPickedBook] = useState<BookHit | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const debouncedBookQuery = useDebouncedValue(bookQuery);

  const folders = useFolders();
  const shelfCount = folders.data?.length ?? 0;
  const wordTotal = folders.data?.reduce((total, row) => total + row.wordCount, 0) ?? 0;

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
    trpc.folder.update.mutationOptions({ onSuccess: invalidateFolders, onError: showError }),
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
      {/* The design's Library masthead: the counts are the page's only numbers,
          and both are real — `folder.list` carries a word count per row. */}
      <View className="flex-row items-start justify-between pt-3">
        <View className="flex-1">
          <Text className="font-serif-semibold text-[29px] leading-[33px] tracking-[-0.6px] text-foreground">
            Library
          </Text>
          <Text className="mt-1 text-[13.5px] text-muted">
            {shelfCount === 1 ? "1 shelf" : `${shelfCount} shelves`} ·{" "}
            {wordTotal === 1 ? "1 word" : `${wordTotal} words`}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/search")}
          accessibilityRole="button"
          accessibilityLabel="Search your words"
          className="-mr-2 -mt-0.5 p-2"
        >
          <Ionicons name="search" size={21} color={accentColor} />
        </Pressable>
      </View>

      {isFormOpen ? (
        <Pressable onPress={closeForm} className="mt-4 self-start">
          <Text className="font-serif-semibold text-[12px] text-muted">Cancel</Text>
        </Pressable>
      ) : null}

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

      <View className="mt-2">
        {folders.data?.map((folder) => (
          <View
            key={folder.id}
            className="flex-row items-start gap-4 border-b border-surface-strong py-4"
          >
            <Link href={{ pathname: "/folder/[id]", params: { id: folder.id } }} asChild>
              <Pressable
                onLongPress={() => confirmDelete(folder.id, folder.title)}
                className="flex-1 flex-row items-start gap-4"
              >
                {/* The design's cover swatch, with the accent as its top edge.
                    The accent marks what the reader is reading now — every
                    other shelf gets the inert rule, which is the one-accent
                    rule applied to a list rather than a second colour. */}
                <View
                  className={`h-[68px] w-[46px] justify-end border-t-[3px] bg-surface-secondary ${
                    folder.status === "reading" ? "border-primary" : "border-surface-strong"
                  }`}
                >
                  {folder.book?.coverImageUrl ? (
                    <Image
                      source={{ uri: folder.book.coverImageUrl }}
                      className="h-full w-full"
                      resizeMode="cover"
                    />
                  ) : null}
                </View>

                <View className="flex-1">
                  <Text
                    className="font-serif-semibold text-[17.5px] leading-[21px] tracking-[-0.2px] text-foreground"
                    numberOfLines={2}
                  >
                    {folder.title}
                  </Text>
                  {folder.book?.authors?.length ? (
                    <Text className="mt-0.5 text-[12.5px] text-muted" numberOfLines={1}>
                      {folder.book.authors.join(", ")}
                    </Text>
                  ) : null}

                  {/* The design pairs the count with a reading-progress bar.
                      Nothing tracks a page position, so the bar is left out
                      rather than drawn against a number that isn't there. */}
                  <Text className="mt-2.5 text-[11.5px] text-muted">
                    {folder.wordCount === 1 ? "1 word" : `${folder.wordCount} words`}
                  </Text>

                  <View className="mt-2.5 flex-row gap-2">
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
                </View>
              </Pressable>
            </Link>
          </View>
        ))}
      </View>

      {folders.data?.length && !isFormOpen ? (
        <>
          <Pressable
            onPress={() => setIsFormOpen(true)}
            className="mt-6 min-h-[46px] items-center justify-center rounded-card border border-surface-strong"
          >
            <Text className="font-serif-semibold text-[14px] text-foreground">Add a book</Text>
          </Pressable>
          <Text className="mt-3 text-center text-[11px] text-muted">
            Long-press a shelf to delete it.
          </Text>
        </>
      ) : null}
    </Container>
  );
}
