import { router } from "expo-router";
import { Button } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

/**
 * The welcome page — the first thing a signed-out reader sees.
 *
 * Both buttons lead to the same place: `sign-in` already renders a sign-in and
 * a sign-up form together, so there is nothing to branch on. They are still two
 * buttons because the design asks a returning reader a different question than
 * a new one, and answering "I already have an account" with the same screen is
 * fine — answering it with a *dead* button would not be.
 *
 * No "seen once" flag: signed-out is the condition this screen renders on, and
 * a reader who signs out has genuinely returned to the front door. Persisting a
 * flag would add a state to get wrong for no behaviour anyone asked for.
 */
export default function WelcomeScreen() {
  return (
    <Container isScrollable={false} className="px-8 pt-16 pb-12">
      {/* The wordmark sits at the top of the page while the rest of the content
          hangs off the bottom, which is what `justify-between` buys — the two
          children are the only things it has to space apart. */}
      <View className="flex-1 justify-between">
        <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
          GlossNote
        </Text>

        <View>
          {/* The design sets this as three misregistered CMYK plates — a print
            treatment built from mix-blend-mode, SVG filters and cyan/magenta
            inks. None of those exist in React Native, and the inks are the
            colours this app deliberately doesn't use, so the headline is set
            plainly in the reading face. */}
          <Text className="mb-5 font-serif-semibold text-[46px] leading-[47px] tracking-[-0.9px] text-foreground">
            Read on.{"\n"}I'll keep{"\n"}the words.
          </Text>

          <Text className="mb-8 max-w-[280px] text-[16px] leading-[26px] text-muted">
            Say a word out loud or type it. We'll tell you what it means — then
            it files itself onto the book's shelf.
          </Text>

          <View className="gap-2.5">
            <Button size="lg" onPress={() => router.push("/sign-in")}>
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
