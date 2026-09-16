import type { AppRouter } from "@better-vocab/api/routers/index";
import { FOLDER_VISIBILITIES, type FolderVisibility } from "@better-vocab/domain";
import { Ionicons } from "@expo/vector-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Link, router } from "expo-router";
import {
  BottomSheet,
  Button,
  Chip,
  Popover,
  Spinner,
  Surface,
  useBottomSheetAwareHandlers,
  useThemeColor,
  useToast,
} from "heroui-native";
import { type ComponentProps, useState } from "react";
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

/** Results per page of book search — what the sheet shows above the fold. */
const BOOK_PAGE_SIZE = 5;

/**
 * The design canvas's Search / Enter by hand / Scan segments.
 *
 * Scan is drawn in the canvas as a live camera reading an ISBN barcode. There
 * is no camera behind it here, so it renders disabled — the same rule Today
 * applies to Scan page and Say it.
 */
const ADD_MODES = [
  { id: "search", label: "Search", isDisabled: false },
  { id: "manual", label: "Enter by hand", isDisabled: false },
  { id: "scan", label: "Scan", isDisabled: true },
] as const;

type AddMode = (typeof ADD_MODES)[number]["id"];

/**
 * A TextField inside a bottom sheet.
 *
 * `@gorhom/bottom-sheet` has to be told which input holds the keyboard, or the
 * sheet will not move out of its way. `useBottomSheetAwareHandlers` is the hook
 * HeroUI ships for that; outside a sheet it returns no-ops, so this stays a
 * plain TextField everywhere else.
 */
function SheetTextField({
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof TextField>) {
  const sheet = useBottomSheetAwareHandlers();

  return (
    <TextField
      {...props}
      onFocus={(event) => {
        sheet.onFocus(event);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        sheet.onBlur(event);
        onBlur?.(event);
      }}
    />
  );
}

export default function ShelfScreen() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutedColor = useThemeColor("muted");
  const accentColor = useThemeColor("accent");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("search");
  const [bookPage, setBookPage] = useState(1);

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
  const isSearchingBooks = !pickedBook && debouncedBookQuery.trim().length >= 2;

  const bookResults = useQuery({
    // Five at a time: the sheet shows them above the fold, and a shorter
    // list is a cheaper Hardcover response.
    ...trpc.book.search.queryOptions({
      query: debouncedBookQuery.trim(),
      limit: BOOK_PAGE_SIZE,
      page: bookPage,
    }),
    enabled: isSearchingBooks,
    retry: false,
  });

  // Results are read through this, never off the query directly: the cache
  // keeps the last search's books, so a reopened sheet — empty field, query
  // disabled — would otherwise still render them. The debounce leaves the old
  // phrase live for a moment after the field is cleared, which does the same.
  const bookHits = isSearchingBooks ? (bookResults.data ?? []) : [];

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
    setAddMode("search");
    setPickedBook(null);
    setBookQuery("");
    setBookPage(1);
  }

  function pickBook(hit: BookHit) {
    setPickedBook(hit);
    form.setFieldValue("title", hit.title);
    setBookQuery("");
    setBookPage(1);
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert("Delete folder?", `"${title}" and every word in it will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteFolder.mutate({ id }) },
    ]);
  }

  return (
    <Container className="w-full px-6">
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

      {/* The new-folder form, presented as a bottom sheet.

          A Popover in its default `popover` presentation is an anchored bubble
          sized to its trigger, which is the wrong container for this: two text
          inputs, an async result list and a keyboard that would shove a
          collision-positioned bubble around the screen. `bottom-sheet` is the
          same component with a presentation that fits a phone form, and it is
          the pattern the long-press sheet below already uses.

          Controlled rather than triggered: the form opens from two places (this
          screen's "Add a book" and the empty state's button), so `isFormOpen`
          stays the one source of truth and there is no Popover.Trigger. */}
      <Popover
        presentation="bottom-sheet"
        isOpen={isFormOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeForm();
        }}
      >
        <Popover.Portal>
          <Popover.Overlay />
          {/* `extend` grows the sheet by the keyboard's height rather than
              sliding it, so the field being typed into stays put. */}
          <Popover.Content
            presentation="bottom-sheet"
            keyboardBehavior="extend"
            contentContainerClassName="px-6 pb-8"
          >
            {/* The canvas's header: a tracked kicker over the title, with the
                close cross opposite it. Sizes are the canvas's own — 10px at
                .18em, and 24px at -.02em. */}
            <View className="mb-4 flex-row items-start justify-between">
              <View>
                <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.8px] text-muted">
                  New shelf
                </Text>
                <Text className="mt-2 font-serif-semibold text-[24px] leading-[28px] tracking-[-0.48px] text-foreground">
                  Add a book
                </Text>
              </View>
              <Pressable
                onPress={closeForm}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                className="-mr-2 -mt-1 p-2 active:opacity-60"
              >
                <Ionicons name="close" size={20} color={mutedColor} />
              </Pressable>
            </View>

            <View className="mb-4 flex-row overflow-hidden rounded-card border border-surface-strong">
              {ADD_MODES.map((mode) => {
                const isActive = !mode.isDisabled && addMode === mode.id;
                return (
                  <Pressable
                    key={mode.id}
                    disabled={mode.isDisabled}
                    onPress={() => {
                      setAddMode(mode.id);
                      // A query left behind would keep searching under a tab
                      // that doesn't show results.
                      if (mode.id !== "search") setBookQuery("");
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{
                      selected: isActive,
                      disabled: mode.isDisabled,
                    }}
                    className={`min-h-[42px] flex-1 items-center justify-center ${
                      isActive ? "bg-primary" : ""
                    } ${mode.isDisabled ? "opacity-40" : ""}`}
                  >
                    <Text
                      className={`font-serif-medium text-[13px] ${
                        isActive ? "text-primary-content" : "text-foreground"
                      }`}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {pickedBook ? (
              <Surface
                variant="secondary"
                className="flex-row items-center gap-3 mb-3 p-2 rounded-md"
              >
                <BookCover
                  uri={pickedBook.coverImageUrl}
                  className="w-14 h-[84px] rounded"
                  fallback={
                    <View className="w-14 h-[84px] rounded items-center justify-center bg-surface-2">
                      <Ionicons
                        name="book-outline"
                        size={18}
                        color={mutedColor}
                      />
                    </View>
                  }
                />
                <View className="flex-1">
                  <Text
                    className="text-foreground text-sm font-serif-medium"
                    numberOfLines={1}
                  >
                    {pickedBook.title}
                  </Text>
                  <Text
                    className="font-serif text-muted text-xs"
                    numberOfLines={1}
                  >
                    {pickedBook.authors.join(", ") || "Unknown author"}
                  </Text>
                </View>
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => setPickedBook(null)}
                >
                  <Button.Label className="font-serif-medium">
                    Change
                  </Button.Label>
                </Button>
              </Surface>
            ) : addMode === "search" ? (
              <View className="mb-3">
                <SheetTextField
                  label="Title or author"
                  value={bookQuery}
                  onChangeText={(text) => {
                    setBookQuery(text);
                    // A new phrase starts at its own first page.
                    setBookPage(1);
                  }}
                  placeholder="Piranesi, Ishiguro…"
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
                    {bookResults.error.message} You can still type a title
                    below.
                  </Text>
                )}

                {bookHits.map((hit) => (
                  <Pressable
                    key={hit.externalId}
                    onPress={() => pickBook(hit)}
                    className="flex-row items-center gap-3 py-2"
                  >
                    <BookCover
                      uri={hit.coverImageUrl}
                      className="w-[34px] h-[50px] rounded"
                      fallback={
                        <View className="w-[34px] h-[50px] rounded items-center justify-center bg-surface-2">
                          <Ionicons
                            name="book-outline"
                            size={12}
                            color={mutedColor}
                          />
                        </View>
                      }
                    />
                    <View className="flex-1">
                      <Text
                        className="font-serif text-foreground text-sm"
                        numberOfLines={1}
                      >
                        {hit.title}
                      </Text>
                      <Text
                        className="font-serif text-muted text-xs"
                        numberOfLines={1}
                      >
                        {[hit.authors.join(", "), hit.releaseYear]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Pressable>
                ))}

                {isSearchingBooks && !bookResults.isFetching && bookHits.length === 0 && bookPage === 1 && (
                  <Text className="font-serif text-muted text-xs mt-2">
                    Nothing matched that. You can still put it on the shelf
                    yourself.
                  </Text>
                )}

                {/* Paging. A short page is the last one — Hardcover's total
                    never reaches the client, and inferring it from the page
                    size costs no extra field. */}
                {isSearchingBooks && (bookPage > 1 || bookHits.length === BOOK_PAGE_SIZE) ? (
                  <View className="mt-2 flex-row items-center justify-between">
                    <Pressable
                      onPress={() => setBookPage((page) => Math.max(1, page - 1))}
                      disabled={bookPage === 1}
                      accessibilityRole="button"
                      accessibilityLabel="Previous results"
                      hitSlop={10}
                      className={`p-1 ${bookPage === 1 ? "opacity-30" : "active:opacity-60"}`}
                    >
                      <Ionicons name="chevron-back" size={18} color={mutedColor} />
                    </Pressable>

                    <Text className="font-serif text-[11.5px] text-muted">Page {bookPage}</Text>

                    <Pressable
                      onPress={() => setBookPage((page) => page + 1)}
                      disabled={bookHits.length < BOOK_PAGE_SIZE}
                      accessibilityRole="button"
                      accessibilityLabel="More results"
                      hitSlop={10}
                      className={`p-1 ${
                        bookHits.length < BOOK_PAGE_SIZE ? "opacity-30" : "active:opacity-60"
                      }`}
                    >
                      <Ionicons name="chevron-forward" size={18} color={mutedColor} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <View className="gap-3">
                  {/* Search mode has no title field: picking a result names the
                      shelf after the book (see pickBook). The Field stays
                      mounted and renders nothing, so the title it already holds
                      survives a switch between the two modes. */}
                  <form.Field name="title">
                    {(field) =>
                      addMode === "manual" ? (
                        <SheetTextField
                          label="Title"
                          error={getFormErrorMessage(field.state.meta.errors)}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChangeText={field.handleChange}
                          placeholder="Pride and Prejudice"
                          returnKeyType="done"
                          onSubmitEditing={form.handleSubmit}
                        />
                      ) : null
                    }
                  </form.Field>

                  <form.Field name="status">
                    {(field) => (
                      <View>
                        {/* A plain label, styled like TextField's, for a row of chips. */}
                        <Text className="font-serif text-[13px] text-muted">
                          Status
                        </Text>
                        <View className="flex-row gap-2 mt-2">
                          {FOLDER_STATUSES.map((status) => (
                            <Chip
                              key={status}
                              size="sm"
                              color={FOLDER_STATUS_COLORS[status]}
                              variant={
                                field.state.value === status
                                  ? "primary"
                                  : "secondary"
                              }
                              onPress={() => field.handleChange(status)}
                            >
                              <Chip.Label className="font-serif-medium">
                                {FOLDER_STATUS_LABELS[status]}
                              </Chip.Label>
                            </Chip>
                          ))}
                        </View>
                      </View>
                    )}
                  </form.Field>

                  <Button
                    onPress={form.handleSubmit}
                    // Nothing is typed in search mode, so the button waits for a
                    // picked book rather than failing on a title the reader
                    // cannot see.
                    isDisabled={isSubmitting || (addMode === "search" && !pickedBook)}
                    className="mt-1"
                  >
                    {isSubmitting ? (
                      <Spinner size="sm" color="default" />
                    ) : (
                      <Button.Label className="font-serif-medium">
                        Put it on the shelf
                      </Button.Label>
                    )}
                  </Button>
                </View>
              )}
            </form.Subscribe>
          </Popover.Content>
        </Popover.Portal>
      </Popover>

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
                <View className="mt-2">
                  {/* The book's own length rides in the label: the row that
                      used to hold it beside a 110px field is gone, and the
                      field now spans the sheet. */}
                  <SheetTextField
                    label={
                      sheetFolder.book?.pages
                        ? `Current page of ${sheetFolder.book.pages}`
                        : "Current page"
                    }
                    value={pageDraft ?? (sheetFolder.currentPage ? String(sheetFolder.currentPage) : "")}
                    onChangeText={(text) => setPageDraft(text.replace(/[^0-9]/g, ""))}
                    placeholder="—"
                    keyboardType="number-pad"
                    maxLength={5}
                    className="w-full"
                  />

                  {pageDraft !== null ? (
                    <Button
                      onPress={() => {
                        const page = Number.parseInt(pageDraft, 10);
                        updateStatus.mutate({ id: sheetFolder.id, currentPage: page >= 1 ? page : null });
                        setPageDraft(null);
                      }}
                      className="mt-2"
                    >
                      <Button.Label className="font-serif-medium">Save page</Button.Label>
                    </Button>
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
                      Home draws that bar for the book being read now; a list
                      row keeps to the count, so the shelf stays one column of
                      numbers rather than a row of competing ones. */}
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
