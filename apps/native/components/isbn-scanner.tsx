import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { usePalette } from "@/lib/palette";

/**
 * The viewfinder behind the add-a-book sheet's Scan segment.
 *
 * It reads barcodes and nothing else: what an ISBN *means* is the sheet's
 * business (`book.byIsbn`). Keeping the lookup out of here is what lets the
 * sheet re-arm after a wrong match without remounting the camera, which on iOS
 * costs a visible black flash each time.
 *
 * `onBarcodeScanned` fires continuously while a code is in frame — several
 * times a second — so the first read latches and every later one is ignored
 * until `isArmed` goes false and back to true. Without that latch, one barcode
 * spends a dozen Hardcover requests.
 *
 * EAN-13 is the barcode on the back of a book; a 10-digit ISBN reaches us as
 * its EAN-13 form, and `normalizeIsbn` on the server takes either.
 */
export function IsbnScanner({
  isArmed,
  onScanned,
  onEnterByHand,
}: {
  isArmed: boolean;
  onScanned: (isbn: string) => void;
  onEnterByHand: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const palette = usePalette();
  const lastScanned = useRef<string | null>(null);

  // Re-arming forgets the last code, so pointing at the same book again after
  // "Not this one" still registers.
  useEffect(() => {
    if (isArmed) lastScanned.current = null;
  }, [isArmed]);

  if (!permission) {
    // Permissions are still loading — a blank box rather than a flash of the
    // "turn it on" copy that is about to be replaced.
    return <View className="mb-4 h-[186px] bg-surface-strong" />;
  }

  if (!permission.granted) {
    const isBlocked = !permission.canAskAgain;
    return (
      <View className="mb-4 gap-3">
        <View className="h-[186px] items-center justify-center bg-surface-strong px-6">
          <Text className="font-serif text-center text-[13.5px] leading-[20px] text-muted">
            {isBlocked
              ? "The camera is turned off for GlossNote. Settings will let it back in — or put the book on the shelf by hand."
              : "Scanning needs the camera. Nothing is recorded or uploaded: the barcode is read on this phone."}
          </Text>
        </View>

        {!isBlocked ? (
          <Pressable
            onPress={requestPermission}
            accessibilityRole="button"
            className="min-h-[46px] items-center justify-center rounded-card bg-primary"
          >
            <Text className="font-serif-semibold text-[14px] text-primary-content">
              Turn on the camera
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onEnterByHand}
          accessibilityRole="button"
          className="min-h-[44px] items-center justify-center"
        >
          <Text className="font-serif-semibold text-[13px] text-muted">Enter it by hand</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mb-4 gap-3">
      {/* 186px, the canvas's own height for this viewport. */}
      <View className="h-[186px] overflow-hidden">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          // A book's barcode is EAN-13; upc_a covers the older US printings.
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "upc_a"] }}
          onBarcodeScanned={({ data }) => {
            if (!isArmed || lastScanned.current === data) return;
            lastScanned.current = data;
            onScanned(data);
          }}
        />

        {/* The canvas's framing rectangle and hint, drawn over the preview. */}
        <View
          className="absolute left-[34px] right-[34px] top-[56px] h-[74px] border"
          style={{ borderColor: palette.primaryContent }}
          pointerEvents="none"
        />
        <Text
          className="absolute bottom-3.5 left-0 right-0 text-center font-serif-semibold text-[10px] uppercase tracking-[1.6px]"
          style={{ color: palette.primaryContent }}
          pointerEvents="none"
        >
          Looking for a barcode
        </Text>
      </View>

      <Text className="font-serif text-[14.5px] leading-[22px] text-muted">
        Point at the barcode on the back. We read the ISBN, so you get the right edition, cover and
        page count.
      </Text>

      <Pressable
        onPress={onEnterByHand}
        accessibilityRole="button"
        className="min-h-[44px] items-center justify-center"
      >
        <Text className="font-serif-semibold text-[13px] text-muted">No barcode on this book</Text>
      </Pressable>
    </View>
  );
}
