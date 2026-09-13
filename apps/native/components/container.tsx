import { cn } from "heroui-native";
import { type PropsWithChildren } from "react";
import { ScrollView, View, type ScrollViewProps, type ViewProps } from "react-native";
import Animated, { type AnimatedProps } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  scrollViewProps?: Omit<ScrollViewProps, "contentContainerStyle">;
};

export function Container({
  children,
  className,
  isScrollable = true,
  hasTopInset = false,
  scrollViewProps,
  ...props
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();

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
