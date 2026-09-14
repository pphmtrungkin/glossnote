import { useQueryClient } from "@tanstack/react-query";
import { cn } from "heroui-native";
import { type PropsWithChildren, useState } from "react";
import { RefreshControl, ScrollView, View, type ScrollViewProps, type ViewProps } from "react-native";
import Animated, { type AnimatedProps } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "@/lib/palette";

const AnimatedView = Animated.createAnimatedComponent(View);

type Props = AnimatedProps<ViewProps> & {
  className?: string;
  isScrollable?: boolean;
  /**
   * Pad past the status bar. Needed by any screen rendered with
   * `headerShown: false` — a stack or tab header already clears it otherwise,
   * and setting this there would leave a header-high gap of dead space.
   */
  hasTopInset?: boolean;
  /**
   * Pull down to refresh. On for every scrollable screen by default; the auth
   * screens turn it off, since there is nothing of the reader's to reload
   * before they sign in. A non-scrollable screen has nothing to pull.
   */
  isRefreshable?: boolean;
  scrollViewProps?: Omit<ScrollViewProps, "contentContainerStyle">;
};

export function Container({
  children,
  className,
  isScrollable = true,
  hasTopInset = false,
  isRefreshable = true,
  scrollViewProps,
  ...props
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const palette = usePalette();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refetches every query a mounted screen is showing, rather than a list per
  // screen, so a new screen is refreshable without wiring anything up.
  // Inactive queries are left alone: that is what keeps a review deck the
  // reader already closed from being reshuffled behind their back.
  async function refresh() {
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <AnimatedView
      className={cn("flex-1 bg-background", className)}
      style={{
        paddingTop: hasTopInset ? insets.top : undefined,
        paddingBottom: insets.bottom,
      }}
      {...props}
    >
      {isScrollable ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          // `automatic` is iOS-only, so it used to inset the scrollable screens
          // on one platform and neither the non-scrollable ones nor Android.
          // The inset is `hasTopInset`'s job on both platforms instead.
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            isRefreshable ? (
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={refresh}
                // iOS draws a spinner in `tintColor`; Android draws a disc in
                // `colors` on `progressBackgroundColor`. Both follow the page.
                tintColor={palette.muted}
                colors={[palette.primary]}
                progressBackgroundColor={palette.base}
              />
            ) : undefined
          }
          {...scrollViewProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </AnimatedView>
  );
}
