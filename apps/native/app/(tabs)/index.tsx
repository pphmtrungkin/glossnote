import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { useFolders } from "@/hooks/use-folders";
import { trpc } from "@/utils/trpc";

/** How many due words the home page lists before deferring to the review run. */
const DUE_PREVIEW = 3;

/** Enough of the queue to count "waiting to be practised" honestly. */
const DUE_COUNT_LIMIT = 50;

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Tues 28 Aug" — the design's own abbreviation, not the locale's. */
function shortDate(date: Date) {
  const day = ["Sun", "Mon", "Tues", "Wed", "Thur", "Fri", "Sat"][date.getDay()];
  const month = date.toLocaleDateString("en", { month: "short" });
  return `${day} ${date.getDate()} ${month}`;
}

/** Section label — small, tracked, quiet. Used three times on this page. */
function Kicker({ children }: { children: string }) {
  return (
    <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.6px] text-muted">
      {children}
    </Text>
  );
}

export default function HomeScreen() {
  const folders = useFolders().data;
  const due = useQuery(trpc.word.quiz.queryOptions({ limit: DUE_COUNT_LIMIT }));

  // "Currently reading" is the most recent folder still marked `reading` —
  // folder.list already orders by newest first, so this is the top of that
  // filter rather than a second query.
  const current = folders?.find((folder) => folder.status === "reading");

  const dueWords = due.data ?? [];
  const folderTitle = (folderId: string) =>
    folders?.find((folder) => folder.id === folderId)?.title ?? "";

  return (
    <Container className="px-6 pb-8">
      <Text className="mt-2 text-[11px] tracking-[0.6px] text-muted">{shortDate(new Date())}</Text>

      <Text className="mt-3 font-serif-semibold text-[29px] leading-[33px] tracking-[-0.6px] text-foreground">
        {greeting(new Date().getHours())}.
      </Text>
      <Text className="mt-1 text-[14px] text-muted">
        {dueWords.length === 0
          ? "Nothing waiting to be practised."
          : `${dueWords.length} ${dueWords.length === 1 ? "word is" : "words are"} waiting to be practised.`}
      </Text>

      {/* ---- Currently reading ------------------------------------------- */}
      {current ? (
        <View className="mt-8">
          <Kicker>Currently reading</Kicker>
          <Link href={{ pathname: "/folder/[id]", params: { id: current.id } }} asChild>
            <Pressable className="mt-3 flex-row items-start gap-4">
              {/* A cover with the accent as its top edge — the design's one
                  spot of colour in this block. */}
              <View className="h-[92px] w-[62px] justify-end border-t-[3px] border-primary bg-surface-secondary p-1.5">
                {current.book?.coverImageUrl ? (
                  <Image
                    source={{ uri: current.book.coverImageUrl }}
                    className="absolute inset-0 h-full w-full"
                    resizeMode="cover"
                  />
                ) : (
                  <Text className="font-serif-semibold text-[9px] leading-[11px] text-foreground">
                    {current.title}
                  </Text>
                )}
              </View>

              <View className="flex-1">
                <Text
                  className="font-serif-semibold text-[19px] leading-[22px] tracking-[-0.3px] text-foreground"
                  numberOfLines={2}
                >
                  {current.title}
                </Text>
                {current.book?.authors?.length ? (
                  <Text className="mt-0.5 text-[13px] text-muted">
                    {current.book.authors.join(", ")}
                  </Text>
                ) : null}
                <Text className="mt-3 text-[11.5px] text-muted">
                  {current.wordCount === 1 ? "1 word saved" : `${current.wordCount} words saved`}
                </Text>
              </View>
            </Pressable>
          </Link>
        </View>
      ) : null}

      {/* ---- Capture ------------------------------------------------------ */}
      <View className="mt-7 flex-row gap-2">
        <Pressable
          disabled
          className="min-h-[76px] flex-1 items-center justify-center gap-2 rounded-card border border-surface-strong opacity-40"
        >
          <Ionicons name="camera-outline" size={22} color="#6b6a66" />
          <Text className="font-serif-semibold text-[12px] text-muted">Scan page</Text>
        </Pressable>

        <Pressable
          disabled
          className="min-h-[76px] flex-1 items-center justify-center gap-2 rounded-card border border-surface-strong opacity-40"
        >
          <Ionicons name="mic-outline" size={22} color="#6b6a66" />
          <Text className="font-serif-semibold text-[12px] text-muted">Say it</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            router.push(
              current ? { pathname: "/add-word", params: { folderId: current.id } } : "/shelf",
            )
          }
          className="min-h-[76px] flex-1 items-center justify-center gap-2 rounded-card bg-primary"
        >
          <Ionicons name="create-outline" size={22} color="#ffffff" />
          <Text className="font-serif-semibold text-[12px] text-primary-content">Type it</Text>
        </Pressable>
      </View>

      {/* ---- Due today ---------------------------------------------------- */}
      {/* The design pairs this heading with a "Start review" button. It only
          renders when there is something to practise — the run screen would
          otherwise open straight onto its own empty state. Tapping a word opens
          its folder instead of jumping into the middle of a run. */}
      <View className="mt-8 flex-row items-baseline justify-between">
        <Kicker>Due today</Kicker>
        {dueWords.length > 0 ? (
          <Pressable onPress={() => router.push("/review")} className="-m-1.5 p-1.5">
            <Text className="font-serif-semibold text-[12px] text-primary">Start review</Text>
          </Pressable>
        ) : null}
      </View>

      {dueWords.length === 0 ? (
        <Text className="mt-3 text-[13px] text-muted">
          {folders?.length
            ? "Every word you've saved is either mastered or still waiting on a definition."
            : "Add a book to your shelf and the words you look up will land here."}
        </Text>
      ) : (
        dueWords.slice(0, DUE_PREVIEW).map((card) => (
          <Link
            key={card.wordId}
            href={{ pathname: "/folder/[id]", params: { id: card.folderId } }}
            asChild
          >
            <Pressable className="flex-row items-baseline gap-3 border-b border-surface-strong py-3.5">
              {/* Grey until a word has been practised at least once: an
                  unpractised word shouldn't shout. */}
              <View
                className={`h-[7px] w-[7px] rounded-full ${
                  card.state === "learning" ? "bg-state-learning" : "bg-state-new"
                }`}
              />
              <View className="flex-1">
                <Text className="font-serif-semibold text-[17px] leading-[20px] text-foreground">
                  {card.term}
                </Text>
                <Text className="mt-0.5 text-[12px] text-muted">{folderTitle(card.folderId)}</Text>
              </View>
              <Text className="text-[11px] uppercase tracking-[0.6px] text-muted">
                {card.state}
              </Text>
            </Pressable>
          </Link>
        ))
      )}
    </Container>
  );
}
