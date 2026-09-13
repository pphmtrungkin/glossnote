import { router } from "expo-router";
import { Button } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

/**
 * The welcome page — the first thing a signed-out reader sees.
 *
 * The two buttons lead to the design's two auth screens, which swap into each
 * other by `replace` — so the answer to "I already have an account" is one tap
 * either way round, and the back stack never grows a chain of them.
 *
 * No "seen once" flag: signed-out is the condition this screen renders on, and
 * a reader who signs out has genuinely returned to the front door. Persisting a
 * flag would add a state to get wrong for no behaviour anyone asked for.
 */
export default function WelcomeScreen() {
  return (
    <Container isScrollable={false} hasTopInset className="px-8 pt-16 pb-10">
      {/* Every screen in this group has the same skeleton: the wordmark pinned
          to the top, the rest hanging off the bottom, `gap-8` between blocks
          and `gap-4` inside one. Spacing is set here and never per-element, so
          the three pages can't drift apart a pixel at a time. */}
      <View className="flex-1 justify-between">
        <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
          GlossNote
        </Text>

        <View className="gap-8">
          <View className="gap-4">
            {/* The design sets this as three misregistered CMYK plates — a print
              treatment built from mix-blend-mode, SVG filters and cyan/magenta
              inks. None of those exist in React Native, and the inks are the
              colours this app deliberately doesn't use, so the headline is set
              plainly in the reading face. */}
            <Text className="font-serif-semibold text-[46px] leading-[47px] tracking-[-0.9px] text-foreground">
              Read on.{"\n"}I'll keep{"\n"}the words.
            </Text>

            <Text className="max-w-[280px] text-[16px] leading-[26px] text-muted">
              Say a word out loud or type it. We'll tell you what it means —
              then it files itself onto the book's shelf.
            </Text>
          </View>

          <View className="gap-2.5">
            <Button size="lg" onPress={() => router.push("/sign-up")}>
              Begin
            </Button>
            <Button variant="ghost" onPress={() => router.push("/sign-in")}>
              I already have an account
            </Button>
          </View>
        </View>
      </View>
    </Container>
  );
}
