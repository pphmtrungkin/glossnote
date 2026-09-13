import { router } from "expo-router";
import { Button } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { SignUp } from "@/components/sign-up";

/**
 * The design's `signup` screen. Its social-provider row is omitted for the same
 * reason as on `sign-in`, and its terms/privacy links are set as plain text —
 * the design points them at nowhere, and this app has no such pages to point at.
 *
 * Same skeleton as `sign-in`, down to the class names.
 */
export default function SignUpScreen() {
  return (
    <Container hasTopInset className="px-8 pt-16 pb-10">
      <View className="flex-1 justify-between">
        <View className="flex-row items-center justify-between">
          <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
            GlossNote
          </Text>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-3"
            onPress={() => router.replace("/sign-in")}
          >
            <Button.Label className="text-[13px] text-muted">Sign in</Button.Label>
          </Button>
        </View>

        <View className="gap-4">
          <Text className="font-serif-semibold text-[32px] leading-[35px] tracking-[-0.64px] text-foreground">
            Make a shelf of your own.
          </Text>
          <Text className="max-w-[300px] text-[15px] leading-[23px] text-muted">
            An account keeps your words when you change phones, and lets you
            share a shelf if you ever want to.
          </Text>
        </View>

        <View className="gap-4">
          <SignUp />
          <Text className="text-[12px] leading-[18px] text-muted">
            By continuing you agree to the terms and privacy notice.
          </Text>
        </View>
      </View>
    </Container>
  );
}
