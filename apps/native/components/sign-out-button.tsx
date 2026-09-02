import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { withUniwind } from "uniwind";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/trpc";

const StyledIonicons = withUniwind(Ionicons);

export function SignOutButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      className="px-2.5"
      onPress={async () => {
        await authClient.signOut();
        // Drop every cached query so the next account doesn't briefly see the
        // previous user's shelf.
        queryClient.clear();
      }}
    >
      <StyledIonicons name="log-out-outline" size={20} className="text-foreground" />
    </Pressable>
  );
}
