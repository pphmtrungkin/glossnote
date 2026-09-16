import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { CoverTile } from "@/components/book-cover";
import { Container } from "@/components/container";
import { useFolders } from "@/hooks/use-folders";
import { useIsOnline } from "@/hooks/use-is-online";
import { authClient } from "@/lib/auth-client";
import { usePalette } from "@/lib/palette";
import { trpc } from "@/utils/trpc";

/**
 * The design's `home` screen — the `isHome` artboard of GlossNote.dc.html,
 * built to its measurements. Every size, weight, tracking value and gap below
 * is the canvas's own (letter-spacing converted from em to px at each size),
 * and every line of text is Source Serif 4, as the design sets it.
 *
 * Where it departs from the canvas, on purpose:
 *   - The tab's navigation header is hidden ((tabs)/_layout.tsx): the wordmark
 *     and date are the page's own first row, as drawn.
 *   - The accent button is "Type it", not "Scan page". Scan and Say it have
 *     nothing behind them and render disabled, and the one accent goes to the
 *     single real action (the colour rule in CLAUDE.md).
 *   - No streak line — nothing records one, so it is left out rather than
 *     invented. The progress bar is real: a saved word's page moves it.
 *   - The Offline marker is `danger`, not the canvas's second accent, which
 *     this scheme deliberately doesn't have.
 *   - Secondary text is the ink at the canvas's strength applied as opacity,
 *     and hairlines use the surface tokens nearest the canvas's 8% and 18%
 *     ink: React Native has no color-mix().
 */

/** How many due words the home page lists before deferring to the review run. */
const DUE_PREVIEW = 3;

/** Enough of the queue to count "waiting to be practised" honestly. */
const DUE_COUNT_LIMIT = 50;

/** The canvas spells the count out: "Nine words are waiting to be practised." */
const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

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

function waitingLine(count: number) {
  if (count === 0) return "Nothing is waiting to be practised.";
  // The quiz page is capped, so a full page means "at least this many".
  const amount =
    count >= DUE_COUNT_LIMIT ? `${DUE_COUNT_LIMIT}+` : NUMBER_WORDS[count] ?? String(count);
  return `${amount} ${count === 1 ? "word is" : "words are"} waiting to be practised.`;
}

/** Section label: 600 10px, 0.16em tracking, uppercase, ink at 45%. */
function Kicker({ children, className }: { children: string; className?: string }) {
  return (
    <Text
      className={`font-serif-semibold text-[10px] leading-[10px] uppercase tracking-[1.6px] text-foreground opacity-[0.45] ${className ?? ""}`}
    >
      {children}
    </Text>
  );
}

/** The canvas's capture icons: 22px, 1.4 stroke, drawn on a 24px grid. */
function CaptureIcon({ kind, color }: { kind: "scan" | "say" | "type"; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.4, fill: "none" } as const;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      {kind === "scan" ? (
        <>
          <Path d="M3 8h4l1.5-2h7L17 8h4v11H3z" {...stroke} />
          <Circle cx={12} cy={13} r={3.4} {...stroke} />
        </>
      ) : kind === "say" ? (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...stroke} />
          <Path d="M5 12a7 7 0 0014 0M12 19v3" {...stroke} />
        </>
      ) : (
        <Path d="M4 7V5h16v2M12 5v14M9 19h6" {...stroke} />
      )}
    </Svg>
  );
}

export default function HomeScreen() {
  const palette = usePalette();
  const isOnline = useIsOnline();
  const session = authClient.useSession();
  const firstName = session.data?.user?.name?.trim().split(/\s+/)[0];

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
    // Canvas padding 62 26 20 — the 62 is the status bar plus a few points,
    // which hasTopInset supplies on any device.
    <Container hasTopInset className="px-[26px] pt-2 pb-5">
      {/* ---- Wordmark and date ------------------------------------------- */}
      <View className="mb-[26px] flex-row items-baseline justify-between">
        <Text className="font-serif-semibold text-[11px] leading-[11px] uppercase tracking-[2.4px] text-foreground">
          GlossNote
        </Text>
        <View className="flex-row items-center gap-2.5">
          {!isOnline ? (
            <View className="flex-row items-center gap-[5px]">
              <Svg width={13} height={13} viewBox="0 0 24 24">
                <Path
                  d="M4 4l16 16M8.5 13a5 5 0 017 0M5 9.5a10 10 0 0114 0"
                  stroke={palette.danger}
                  strokeWidth={1.8}
                  fill="none"
                />
              </Svg>
              <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.2px] text-danger">
                Offline
              </Text>
            </View>
          ) : null}
          <Text className="font-serif text-[11px] tracking-[0.66px] text-foreground opacity-50">
            {shortDate(new Date())}
          </Text>
        </View>
      </View>

      {/* ---- Greeting ----------------------------------------------------- */}
      <Text className="mb-1 font-serif-semibold text-[29px] leading-[33px] tracking-[-0.58px] text-foreground">
        {greeting(new Date().getHours())}
        {firstName ? `, ${firstName}` : ""}.
      </Text>
      <Text className="mb-[30px] font-serif text-[14px] leading-[22px] text-foreground opacity-60">
        {waitingLine(dueWords.length)}
      </Text>

      {/* ---- Currently reading ------------------------------------------- */}
      {current ? (
        <>
          <Kicker className="mb-3">Currently reading</Kicker>
          <Link href={{ pathname: "/folder/[id]", params: { id: current.id } }} asChild>
            <Pressable className="mb-3.5 flex-row items-start gap-4">
              {/* 62×92, the accent as its top edge — the block's one spot of
                  colour. */}
              <CoverTile
                uri={current.book?.coverImageUrl}
                title={current.title}
                accent
                className="h-[92px] w-[62px]"
              />

              <View className="min-w-0 flex-1">
                <Text
                  className="font-serif-semibold text-[19px] leading-[22px] tracking-[-0.29px] text-foreground"
                  numberOfLines={2}
                >
                  {current.title}
                </Text>
                <Text className="mb-3 font-serif text-[13px] leading-[20px] text-foreground opacity-55">
                  {current.book?.authors?.length ? current.book.authors.join(", ") : " "}
                </Text>
                {/* The canvas's 2px bar and "62% · p.184". The bar needs the
                    book's page count, which a freeform shelf has none of —
                    then the page stands alone. Capped at 100%: Hardcover's
                    count is one edition's, and the reader's may run longer. */}
                {current.currentPage && current.book?.pages ? (
                  <View className="mb-1.5 h-0.5 bg-surface-strong">
                    <View
                      className="h-0.5 bg-primary"
                      style={{ width: `${Math.min(current.currentPage / current.book.pages, 1) * 100}%` }}
                    />
                  </View>
                ) : null}
                <View className="flex-row items-baseline">
                  {current.currentPage ? (
                    <Text className="font-serif text-[11.5px] leading-[18px] text-foreground opacity-50">
                      {current.book?.pages
                        ? `${Math.min(Math.round((current.currentPage / current.book.pages) * 100), 100)}% · p.${current.currentPage}`
                        : `p.${current.currentPage}`}
                    </Text>
                  ) : null}
                  <Text className="ml-auto font-serif text-[11.5px] leading-[18px] text-foreground opacity-50">
                    {current.wordCount === 1 ? "1 word saved" : `${current.wordCount} words saved`}
                  </Text>
                </View>
              </View>
            </Pressable>
          </Link>
        </>
      ) : null}

      {/* ---- Capture ------------------------------------------------------ */}
      <View className="mt-6 mb-8 flex-row gap-2">
        <Pressable
          disabled
          className="min-h-[76px] flex-1 items-center gap-2 rounded-[2px] border border-surface-strong px-1 py-4 opacity-40"
        >
          <CaptureIcon kind="scan" color={palette.ink} />
          <Text className="font-serif-semibold text-[12px] text-foreground">Scan page</Text>
        </Pressable>

        <Pressable
          disabled
          className="min-h-[76px] flex-1 items-center gap-2 rounded-[2px] border border-surface-strong px-1 py-4 opacity-40"
        >
          <CaptureIcon kind="say" color={palette.ink} />
          <Text className="font-serif-semibold text-[12px] text-foreground">Say it</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            router.push(
              current ? { pathname: "/add-word", params: { folderId: current.id } } : "/shelf",
            )
          }
          className="min-h-[76px] flex-1 items-center gap-2 rounded-[2px] bg-primary px-1 py-4"
        >
          <CaptureIcon kind="type" color={palette.primaryContent} />
          <Text className="font-serif-semibold text-[12px] text-primary-content">Type it</Text>
        </Pressable>
      </View>

      {/* ---- Due today ---------------------------------------------------- */}
      {/* "Start review" only renders when there is something to practise —
          the run screen would otherwise open straight onto its own empty
          state. Tapping a word opens its folder instead of jumping into the
          middle of a run. */}
      <View className="mb-3.5 flex-row items-center justify-between">
        <Kicker>Due today</Kicker>
        {dueWords.length > 0 ? (
          <Pressable
            onPress={() => router.push("/review")}
            className="min-h-[32px] justify-center px-[5px]"
          >
            <Text className="font-serif-semibold text-[12.5px] text-primary">Start review</Text>
          </Pressable>
        ) : null}
      </View>

      {dueWords.length === 0 ? (
        <Text className="font-serif text-[12.5px] leading-[20px] text-foreground opacity-50">
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
            <Pressable className="flex-row items-center gap-3 border-b border-surface py-[13px]">
              {/* Grey until a word has been practised at least once: an
                  unpractised word shouldn't shout. */}
              <View
                className={`h-[7px] w-[7px] rounded-full ${
                  card.state === "learning" ? "bg-state-learning" : "bg-state-new"
                }`}
              />
              <View className="min-w-0 flex-1">
                <Text className="font-serif-semibold text-[17px] leading-[20px] text-foreground">
                  {card.term}
                </Text>
                <Text className="mt-0.5 font-serif text-[12px] leading-[18px] text-foreground opacity-50">
                  {folderTitle(card.folderId)}
                </Text>
              </View>
              <Text className="font-serif text-[11px] tracking-[0.66px] text-foreground opacity-[0.42]">
                {card.state}
              </Text>
            </Pressable>
          </Link>
        ))
      )}
    </Container>
  );
}
