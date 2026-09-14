import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { Spinner } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { CoverTile } from "@/components/book-cover";
import { Container } from "@/components/container";
import { useFolders } from "@/hooks/use-folders";
import { trpc } from "@/utils/trpc";

/**
 * The Practise tab — the retention half of the app, one tap away.
 *
 * Everything here reads data that already existed: `word.quiz` for what is
 * waiting (the same query the Today tab counts), `folder.list` for the shelves,
 * and `word.mastered` for the words that have left the rotation. A run itself
 * is still the `review` screen, which this only opens.
 */

/**
 * The same cap the Today tab counts to.
 *
 * ponytail: waiting counts come from one quiz page, so past 50 they read
 * "50+" and a shelf's count can undercount. Add a count procedure if readers
 * routinely have more than 50 words waiting.
 */
const WAITING_LIMIT = 50;

/** Section label — the same small tracked kicker the rest of the app uses. */
function Kicker({ children }: { children: string }) {
  return (
    <Text className="font-serif-semibold text-[10px] uppercase tracking-[1.6px] text-muted">{children}</Text>
  );
}

export default function PractiseScreen() {
  const folders = useFolders();
  const waiting = useQuery(trpc.word.quiz.queryOptions({ limit: WAITING_LIMIT }));
  const mastered = useQuery(trpc.word.mastered.queryOptions({}));

  const cards = waiting.data ?? [];
  const waitingLabel = cards.length >= WAITING_LIMIT ? `${WAITING_LIMIT}+` : String(cards.length);

  const waitingByShelf = new Map<string, number>();
  for (const card of cards) waitingByShelf.set(card.folderId, (waitingByShelf.get(card.folderId) ?? 0) + 1);
  const shelves = (folders.data ?? []).filter((shelf) => waitingByShelf.has(shelf.id));

  return (
    <Container className="px-6 pb-8">
      <Text className="mt-3 font-serif-semibold text-[29px] leading-[33px] tracking-[-0.6px] text-foreground">
        Practise
      </Text>
      <Text className="mt-1 text-[14px] text-muted">
        {waiting.isPending
          ? " "
          : cards.length === 0
            ? "Nothing waiting to be practised."
            : `${waitingLabel} ${cards.length === 1 ? "word is" : "words are"} waiting.`}
      </Text>

      {waiting.isPending ? (
        <View className="items-center py-10">
          <Spinner />
        </View>
      ) : cards.length > 0 ? (
        <Pressable
          onPress={() => router.push("/review")}
          className="mt-6 min-h-[50px] items-center justify-center rounded-card bg-primary"
        >
          <Text className="font-serif-semibold text-[16px] text-primary-content">Practise all</Text>
        </Pressable>
      ) : (
        // A word becomes a card only once its definition has example
        // sentences to blank out — see word.quiz.
        <Text className="mt-4 text-[13px] leading-[20px] text-muted">
          Words become cards once their definition has an example to work from. Save a few more, and check
          back.
        </Text>
      )}

      {waiting.error ? <Text className="mt-4 text-[13px] text-danger">{waiting.error.message}</Text> : null}

      {/* ---- By shelf ------------------------------------------------------ */}
      {shelves.length > 0 ? (
        <View className="mt-9">
          <Kicker>By shelf</Kicker>
          {shelves.map((shelf) => {
            const count = waitingByShelf.get(shelf.id) ?? 0;
            return (
              <Pressable
                key={shelf.id}
                onPress={() => router.push({ pathname: "/review", params: { folderId: shelf.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Practise ${shelf.title}`}
                className="flex-row items-center gap-3.5 border-b border-surface-strong py-3"
              >
                <CoverTile
                  uri={shelf.book?.coverImageUrl}
                  title={shelf.title}
                  compact
                  accent={shelf.status === "reading"}
                  className="h-[60px] w-[40px]"
                />
                <View className="flex-1">
                  <Text className="font-serif-semibold text-[16px] leading-[20px] text-foreground" numberOfLines={2}>
                    {shelf.title}
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-muted">
                    {count === 1 ? "1 word waiting" : `${count} words waiting`}
                  </Text>
                </View>
                <Text className="font-serif-semibold text-[12.5px] text-primary">Practise</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* ---- Mastered ------------------------------------------------------ */}
      <View className="mt-9">
        <Kicker>{mastered.data?.total ? `Mastered · ${mastered.data.total}` : "Mastered"}</Kicker>
        {mastered.data?.words.length ? (
          mastered.data.words.map((word) => {
            const definition = word.definitionOverride ?? word.dictionaryEntry?.definition ?? null;
            return (
              <Link
                key={word.id}
                href={{ pathname: "/word/[id]", params: { id: word.id, folderId: word.folderId } }}
                asChild
              >
                <Pressable className="border-b border-surface-strong py-3">
                  <View className="flex-row items-baseline gap-2.5">
                    <Text className="font-serif-semibold text-[17px] leading-[20px] text-foreground">{word.term}</Text>
                    <Text className="flex-1 text-right text-[11.5px] text-muted" numberOfLines={1}>
                      {word.folder.title}
                    </Text>
                  </View>
                  {definition ? (
                    <Text className="mt-1 text-[13px] leading-[19px] text-muted" numberOfLines={1}>
                      {definition}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
            );
          })
        ) : (
          <Text className="mt-3 text-[13px] leading-[20px] text-muted">
            Mark a word mastered on its page and it leaves practice. It will be listed here.
          </Text>
        )}
      </View>
    </Container>
  );
}
