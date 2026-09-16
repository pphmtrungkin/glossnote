import type { AppRouter } from "@better-vocab/api/routers/index";
import { FOLDER_VISIBILITIES, type FolderVisibility } from "@better-vocab/domain";
import { Ionicons } from "@expo/vector-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Link, router } from "expo-router";
import { BottomSheet, Button, Chip, Spinner, Surface, useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import z from "zod";

import { BookCover, CoverTile } from "@/components/book-cover";
import { Container } from "@/components/container";
import { TextField } from "@/components/text-field";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFolders } from "@/hooks/use-folders";
import {
  FOLDER_STATUSES,
  FOLDER_STATUS_COLORS,
  FOLDER_STATUS_LABELS,
  type FolderStatus,
} from "@/lib/folder-status";
import { getFormErrorMessage } from "@/lib/form-error";
import { trpc } from "@/utils/trpc";

// One result from Hardcover, shaped by book.search. `folder.create` takes this
// object straight back and upserts it — the client never handles a book id.
type BookHit = inferRouterOutputs<AppRouter>["book"]["search"][number];

// What each choice in a shelf's sheet means, in the reader's terms. Only
// counts ever cross between readers, so "public" never shows the shelf itself.
const VISIBILITY_COPY: Record<FolderVisibility, { label: string; description: string }> = {
  private: {
    label: "Private",
    description: "Only you. Words you save here don't count toward what other readers of this book see.",
  },
  public: {
    label: "Public",
    description:
      "Words you save here count toward what other readers of this book see — as counts only, never your notes or definitions.",
  },
};

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

  // The shelf whose long-press sheet is open, by id, so the sheet always shows
  // the latest row from `folder.list` rather than a copy taken at press time.
  const [sheetFolderId, setSheetFolderId] = useState<string | null>(null);
  // The sheet's page field while it's being edited; null shows the saved page.
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const debouncedBookQuery = useDebouncedValue(bookQuery);

  const folders = useFolders();
  const sheetFolder = folders.data?.find((row) => row.id === sheetFolderId) ?? null;
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
          <Text className="font-serif mt-1 text-[13.5px] text-muted">
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
          <Text className="text-foreground font-serif-medium mb-4">New folder</Text>

          {pickedBook ? (
            <Surface variant="secondary" className="flex-row items-center gap-3 mb-3 p-2 rounded-md">
              <BookCover
                uri={pickedBook.coverImageUrl}
                className="w-14 h-[84px] rounded"
                fallback={
                  <View className="w-14 h-[84px] rounded items-center justify-center bg-surface-2">
                    <Ionicons name="book-outline" size={18} color={mutedColor} />
                  </View>
                }
              />
              <View className="flex-1">
                <Text className="text-foreground text-sm font-serif-medium" numberOfLines={1}>
                  {pickedBook.title}
                </Text>
                <Text className="font-serif text-muted text-xs" numberOfLines={1}>
                  {pickedBook.authors.join(", ") || "Unknown author"}
                </Text>
              </View>
              <Button size="sm" variant="tertiary" onPress={() => setPickedBook(null)}>
                <Button.Label className="font-serif-medium">Change</Button.Label>
              </Button>
            </Surface>
          ) : (
            <View className="mb-3">
              <TextField
                label="Find the book"
                value={bookQuery}
                onChangeText={setBookQuery}
                placeholder="Search Hardcover, or skip for a freeform folder"
                autoCorrect={false}
                returnKeyType="search"
              />

              {bookResults.isFetching && (
                <View className="py-3 items-center">
                  <Spinner size="sm" />
                </View>
              )}

              {/* Search needs connectivity; typing a title below always works,
                  which is the offline fallback UserFlow §2 asks for. */}
              {bookResults.error && (
                <Text className="font-serif text-muted text-xs mt-2">
                  {bookResults.error.message} You can still type a title below.
                </Text>
              )}

              {bookResults.data?.map((hit) => (
                <Pressable key={hit.externalId} onPress={() => pickBook(hit)} className="flex-row items-center gap-3 py-2">
                  <BookCover
                    uri={hit.coverImageUrl}
                    className="w-12 h-[72px] rounded"
                    fallback={
                      <View className="w-12 h-[72px] rounded items-center justify-center bg-surface-2">
                        <Ionicons name="book-outline" size={14} color={mutedColor} />
                      </View>
                    }
                  />
                  <View className="flex-1">
                    <Text className="font-serif text-foreground text-sm" numberOfLines={1}>
                      {hit.title}
                    </Text>
                    <Text className="font-serif text-muted text-xs" numberOfLines={1}>
                      {[hit.authors.join(", "), hit.releaseYear].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                </Pressable>
              ))}

              {bookResults.data?.length === 0 && (
                <Text className="font-serif text-muted text-xs mt-2">No matches. Type a title below instead.</Text>
              )}
            </View>
          )}

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <View className="gap-3">
                <form.Field name="title">
                  {(field) => (
                    <TextField
                      label="Title"
                      error={getFormErrorMessage(field.state.meta.errors)}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                      placeholder="Pride and Prejudice"
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={form.handleSubmit}
                    />
                  )}
                </form.Field>

                <form.Field name="status">
                  {(field) => (
                    <View>
                      {/* A plain label, styled like TextField's, for a row of chips. */}
                      <Text className="font-serif text-[13px] text-muted">Status</Text>
                      <View className="flex-row gap-2 mt-2">
                        {FOLDER_STATUSES.map((status) => (
                          <Chip
                            key={status}
                            size="sm"
                            color={FOLDER_STATUS_COLORS[status]}
                            variant={field.state.value === status ? "primary" : "secondary"}
                            onPress={() => field.handleChange(status)}
                          >
                            <Chip.Label className="font-serif-medium">{FOLDER_STATUS_LABELS[status]}</Chip.Label>
                          </Chip>
                        ))}
                      </View>
                    </View>
                  )}
                </form.Field>

                <Button onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-1">
                  {isSubmitting ? <Spinner size="sm" color="default" /> : <Button.Label className="font-serif-medium">Create folder</Button.Label>}
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
          <Text className="font-serif text-danger mb-3">{folders.error.message}</Text>
          <Button size="sm" variant="tertiary" onPress={() => folders.refetch()}>
            <Button.Label className="font-serif-medium">Try again</Button.Label>
          </Button>
        </Surface>
      )}

      {folders.data?.length === 0 && !isFormOpen && (
        <Surface variant="secondary" className="p-6 rounded-lg items-center">
          <Ionicons name="library-outline" size={32} color={mutedColor} />
          <Text className="text-foreground font-serif-medium mt-3 mb-1">Your shelf is empty</Text>
          <Text className="font-serif text-muted text-sm text-center mb-4">
            Create a folder for what you&apos;re reading, then log the words you look up.
          </Text>
          <Button size="sm" onPress={() => setIsFormOpen(true)}>
            <Button.Label className="font-serif-medium">Create your first folder</Button.Label>
          </Button>
        </Surface>
      )}

      {/* ---- A shelf's long-press sheet ------------------------------------ */}
      {/* Long-press opens this rather than deleting outright: who a shelf
          reaches is the setting a reader needs per shelf, and delete sits
          behind it with its own confirmation. */}
      <BottomSheet
        isOpen={sheetFolder !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSheetFolderId(null);
            setPageDraft(null);
          }
        }}
      >
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content>
            {sheetFolder ? (
              <View className="gap-3 pb-4">
                <View className="mb-1">
                  <BottomSheet.Title className="font-serif-semibold">{sheetFolder.title}</BottomSheet.Title>
                  <BottomSheet.Description className="font-serif">Who this shelf&apos;s words reach.</BottomSheet.Description>
                </View>

                {FOLDER_VISIBILITIES.map((visibility) => {
                  const isActive = sheetFolder.visibility === visibility;
                  return (
                    <Pressable
                      key={visibility}
                      onPress={() => {
                        if (!isActive) updateStatus.mutate({ id: sheetFolder.id, visibility });
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isActive }}
                      className={`flex-row items-start gap-3 rounded-card border p-3 ${
                        isActive ? "border-primary" : "border-surface-strong"
                      }`}
                    >
                      <Ionicons
                        name={isActive ? "radio-button-on" : "radio-button-off"}
                        size={20}
                        color={isActive ? accentColor : mutedColor}
                      />
                      <View className="flex-1">
                        <Text className="font-serif-semibold text-[15px] text-foreground">
                          {VISIBILITY_COPY[visibility].label}
                        </Text>
                        <Text className="font-serif mt-0.5 text-[12.5px] leading-[18px] text-muted">
                          {VISIBILITY_COPY[visibility].description}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}

                {/* Captures with a page move this forward on their own; here
                    the reader can set any page, a re-read included. Empty
                    clears it. */}
                <View className="mt-2 flex-row items-end gap-3">
                  <View className="w-[110px]">
                    <TextField
                      label="Current page"
                      value={pageDraft ?? (sheetFolder.currentPage ? String(sheetFolder.currentPage) : "")}
                      onChangeText={(text) => setPageDraft(text.replace(/[^0-9]/g, ""))}
                      placeholder="—"
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                  <Text className="mb-3.5 flex-1 font-serif text-[13px] text-muted">
                    {sheetFolder.book?.pages ? `of ${sheetFolder.book.pages}` : ""}
                  </Text>
                  {pageDraft !== null ? (
                    <Pressable
                      onPress={() => {
                        const page = Number.parseInt(pageDraft, 10);
                        updateStatus.mutate({ id: sheetFolder.id, currentPage: page >= 1 ? page : null });
                        setPageDraft(null);
                      }}
                      accessibilityRole="button"
                      className="mb-3.5"
                    >
                      <Text className="font-serif-semibold text-[13px] text-primary">Save page</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => {
                    const target = sheetFolder;
                    setSheetFolderId(null);
                    confirmDelete(target.id, target.title);
                  }}
                  accessibilityRole="button"
                  className="mt-2 min-h-[46px] items-center justify-center rounded-card border border-danger"
                >
                  <Text className="font-serif-semibold text-[14px] text-danger">Delete shelf</Text>
                </Pressable>
              </View>
            ) : null}
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>

      <View className="mt-2">
        {folders.data?.map((folder) => (
          <View
            key={folder.id}
            className="flex-row items-start gap-4 border-b border-surface-strong py-4"
          >
            <Link href={{ pathname: "/folder/[id]", params: { id: folder.id } }} asChild>
              <Pressable
                onLongPress={() => setSheetFolderId(folder.id)}
                className="flex-1 flex-row items-start gap-4"
              >
                {/* The design's cover swatch, with the accent as its top edge.
                    The accent marks what the reader is reading now — every
                    other shelf gets the inert rule, which is the one-accent
                    rule applied to a list rather than a second colour. */}
                <CoverTile
                  uri={folder.book?.coverImageUrl}
                  title={folder.title}
                  accent={folder.status === "reading"}
                  className="h-[96px] w-[64px]"
                />

                <View className="flex-1">
                  <Text
                    className="font-serif-semibold text-[17.5px] leading-[21px] tracking-[-0.2px] text-foreground"
                    numberOfLines={2}
                  >
                    {folder.title}
                  </Text>
                  {folder.book?.authors?.length ? (
                    <Text className="font-serif mt-0.5 text-[12.5px] text-muted" numberOfLines={1}>
                      {folder.book.authors.join(", ")}
                    </Text>
                  ) : null}

                  {/* The design pairs the count with a reading-progress bar.
                      Nothing tracks a page position, so the bar is left out
                      rather than drawn against a number that isn't there. */}
                  <Text className="font-serif mt-2.5 text-[11.5px] text-muted">
                    {folder.wordCount === 1 ? "1 word" : `${folder.wordCount} words`}
                    {folder.visibility === "public" ? " · Public" : ""}
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
                          <Chip.Label className="font-serif-medium">{FOLDER_STATUS_LABELS[status]}</Chip.Label>
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
          <Text className="font-serif mt-3 text-center text-[11px] text-muted">
            Long-press a shelf to change who sees it, or to delete it.
          </Text>
        </>
      ) : null}
    </Container>
  );
}
