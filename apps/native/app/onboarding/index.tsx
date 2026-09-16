import { router } from "expo-router";
import { Button } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { useFinishOnboarding } from "@/hooks/use-finish-onboarding";
import { packUrl } from "@/lib/dictionary-pack";

/**
 * The design's `tour` screen — three steps behind one route.
 *
 * The canvas models it as `isTour` wrapping `tour1`/`tour2`/`tour3` with a
 * shared header and footer, so it is one screen with a step index rather than
 * three routes: the wordmark, the Skip link, the dots and the Back/Next pair
 * never change between steps, and three routes would have to re-render them.
 *
 * It runs *after* the account exists, so there is a session behind it — which
 * is what lets the dictionary step record its choice on the account as well as
 * on the device. Both exits stamp `onboarding.seen`; the root layout's guard
 * reads that and swaps this stack for the tabs, the same way it swaps the auth
 * group out when a session appears.
 */

type Step = {
  /** The design's ordinal eyebrow: "One · catching". */
  eyebrow: string;
  headline: string;
  body: string;
};

const STEPS: Step[] = [
  {
    eyebrow: "One · catching",
    // The design promises a camera here as well. It is cut for the reason the
    // welcome screen's copy was cut: there is no camera capture, and onboarding
    // is the worst place to promise one.
    headline: "Catch the word without leaving the page.",
    body: "Type the word you just hit, or take it from the list other readers of the same book stopped on. No hunting through an app mid-sentence.",
  },
  {
    eyebrow: "Two · learning",
    // The design's step two is a tutor conversation — "you guess first, then we
    // talk". There is no tutor chat, so this points at what enrichment actually
    // produces and `word/[id]` actually renders: a definition, an example
    // sentence and a usage note.
    headline: "A meaning, and a sentence to hang it on.",
    body: "A word comes back with more than a gloss: an example sentence and a note on how it really gets used, so the meaning sticks to something.",
  },
  {
    eyebrow: "Three · keeping",
    headline: "Every word files itself under its book.",
    // The design adds "your shelf remembers the page you were on". It doesn't:
    // there are no page numbers in the data model.
    body: "Each word stays under the book you met it in. Review comes back a few at a time, and an ochre mark means it's yours and holding.",
  },
];

/** The design's brace-marked sample line, as the sentence the reader just hit. */
function CatchingFigure() {
  return (
    <View className="mt-8 bg-surface p-[18px]">
      <Text className="font-serif text-[14.5px] leading-[25px] text-muted">
        She was{" "}
        <Text className="font-serif-semibold text-foreground underline decoration-primary-soft">
          solicitous
        </Text>
        , the way a nurse might be, and Josie let her be.
      </Text>

      {/* The design offers three ways in. Only one of them exists, so the other
          renders muted rather than as a live chip — the same call `add-word`
          makes for the affordances it can't back. */}
      <View className="mt-4 flex-row gap-1.5">
        <View className="bg-primary px-2.5 py-1.5">
          <Text className="font-serif-semibold text-[11px] text-primary-content">Type it</Text>
        </View>
        <View className="border border-surface-strong px-2.5 py-1.5">
          <Text className="font-serif-semibold text-[11px] text-muted">Say it</Text>
        </View>
      </View>
    </View>
  );
}

/** A word as `word/[id]` renders one: the gloss, then what enrichment added. */
function LearningFigure() {
  return (
    <View className="mt-8 gap-3">
      <Text className="font-serif-semibold text-[19px] leading-[22px] text-foreground">
        solicitous
      </Text>
      <Text className="font-serif text-[14.5px] leading-[22px] text-muted">
        Showing interest or concern for someone's health or wellbeing.
      </Text>
      <Text className="font-italic text-[14.5px] leading-[23px] text-foreground">
        "She was solicitous about the journey, asking twice whether I had eaten."
      </Text>
      <Text className="font-serif text-[13px] leading-[20px] text-muted">
        Warmer than "worried" — it's attention paid on someone's behalf.
      </Text>
    </View>
  );
}

/** Three shelf rows, in the folder screen's own row treatment. */
function KeepingFigure() {
  const rows = [
    { term: "solicitous", book: "Klara and the Sun", state: "learning" },
    { term: "wan", book: "Klara and the Sun", state: "new" },
    { term: "verdant", book: "The Overstory", state: "steady" },
  ] as const;

  return (
    <View className="mt-8">
      {rows.map((row) => (
        <View key={row.term} className="border-b border-surface-strong py-3.5">
          <View className="flex-row items-baseline gap-2.5">
            <Text className="font-serif-semibold text-[19px] leading-[22px] tracking-[-0.2px] text-foreground">
              {row.term}
            </Text>
            <View className="mb-1 flex-1 border-b border-dotted border-surface-strong" />
            <Text
              className={`font-serif text-[11px] uppercase tracking-[0.6px] ${
                row.state === "learning"
                  ? "text-state-learning"
                  : row.state === "steady"
                    ? "text-state-steady"
                    : "text-state-new"
              }`}
            >
              {row.state}
            </Text>
          </View>
          {/* The design puts a page number here too. Omitted — nothing records
              one. The book is real: `word.bookId` is snapshotted at capture. */}
          <Text className="font-serif mt-0.5 text-[12px] text-muted">{row.book}</Text>
        </View>
      ))}
    </View>
  );
}

const FIGURES = [CatchingFigure, LearningFigure, KeepingFigure];

export default function TourScreen() {
  const finishOnboarding = useFinishOnboarding();
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const Figure = FIGURES[index]!;
  const isLast = index === STEPS.length - 1;

  // The dictionary offer is the design's next screen, but it is only a screen
  // when there is a pack to offer — without a URL it would be a dead button on
  // a dead page, so the tour ends here instead. `dictionary` guards the same
  // condition for anyone arriving by deep link.
  const finish = () =>
    packUrl ? router.replace("/onboarding/dictionary") : void finishOnboarding();

  return (
    <Container isScrollable={false} hasTopInset className="px-8 pt-16 pb-10">
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
            GlossNote
          </Text>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-3"
            onPress={() => void finishOnboarding()}
          >
            <Button.Label className="font-serif-medium text-[13px] text-muted">Skip</Button.Label>
          </Button>
        </View>

        <View className="mt-8 flex-1">
          <Text className="mb-4 font-serif-semibold text-[10px] uppercase tracking-[1.8px] text-muted">
            {step.eyebrow}
          </Text>
          <Text className="mb-3.5 font-serif-semibold text-[33px] leading-[36px] tracking-[-0.66px] text-foreground">
            {step.headline}
          </Text>
          <Text className="font-serif max-w-[300px] text-[15.5px] leading-[25px] text-muted">{step.body}</Text>

          <Figure />
        </View>

        <View className="flex-row items-center gap-3.5">
          {/* The design widens the active dot rather than recolouring it, so the
              rail reads as progress without spending the accent on chrome. */}
          <View className="flex-row gap-1.5">
            {STEPS.map((s, i) => (
              <View
                key={s.eyebrow}
                className={`h-[5px] rounded-[3px] ${
                  i === index ? "w-[18px] bg-primary" : "w-[5px] bg-surface-strong"
                }`}
              />
            ))}
          </View>

          {/* Hidden on the first step rather than disabled: there is nothing
              behind the tour now — the auth group is gone the moment the
              session lands. */}
          {index > 0 ? (
            <Button variant="ghost" className="ml-auto" onPress={() => setIndex(index - 1)}>
              <Button.Label className="font-serif-medium text-[14px] text-muted">Back</Button.Label>
            </Button>
          ) : (
            <View className="ml-auto" />
          )}
          <Button onPress={() => (isLast ? finish() : setIndex(index + 1))}>
            {isLast ? "Continue" : "Next"}
          </Button>
        </View>
      </View>
    </Container>
  );
}
