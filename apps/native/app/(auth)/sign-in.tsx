import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";

export default function SignInScreen() {
  return (
    <Container className="p-6">
      <View className="py-4 mb-2">
        <Text className="text-4xl font-bold text-foreground mb-1">Lexishelf</Text>
        <Text className="text-muted">Every word you look up, kept on a shelf.</Text>
      </View>

      <View className="gap-4">
        <SignIn />
        <SignUp />
      </View>
    </Container>
  );
}
