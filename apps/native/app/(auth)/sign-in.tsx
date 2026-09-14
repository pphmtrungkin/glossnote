import { router } from "expo-router";
import { Button } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";

/**
 * The design's `signin` screen.
 *
 * The design pairs this with a "Forgotten your password?" link and a row of
 * social providers. Neither is rendered: a reset needs an email sender this app
 * doesn't have (the same reason `packages/auth` leaves `changeEmail` off), and
 * no social provider is configured — a dead link is worse than an absent one.
 *
 * Spacing is the group's skeleton (see `index`): the wrapper is *inside* the
 * container, because `Container`'s className lands on the outer view whose only
 * child is the ScrollView, so a `justify-between` set there spaces nothing.
 */
export default function SignInScreen() {
  return (
    <Container hasTopInset isRefreshable={false} className="px-8 pt-16 pb-10">
      <View className="flex-1 justify-between">
        <View className="flex-row items-center justify-between">
          <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
            GlossNote
          </Text>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-3"
            onPress={() => router.replace("/sign-up")}
          >
            <Button.Label className="text-[13px] text-muted">Create account</Button.Label>
          </Button>
        </View>

        <View className="gap-4">
          <Text className="font-serif-semibold text-[32px] leading-[35px] tracking-[-0.64px] text-foreground">
            Welcome back.
          </Text>
          <Text className="max-w-[280px] text-[15px] leading-[23px] text-muted">
            Your shelves are where you left them.
          </Text>
        </View>

        <SignIn />
      </View>
    </Container>
  );
}
