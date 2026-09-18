import { CameraView, scanFromURLAsync, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Notice } from "@/components/notice";
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
  const [photoError, setPhotoError] = useState<{ title: string; body: string } | null>(null);

  // Re-arming forgets the last code, so pointing at the same book again after
  // "Not this one" still registers.
  useEffect(() => {
    if (isArmed) lastScanned.current = null;
  }, [isArmed]);

  /**
   * The same decoder, run over a still image instead of the live preview.
   *
   * This needs no camera permission — the picker hands back a file — so it is
   * the way in when the camera is blocked, when the book is not to hand, and on
   * a simulator, which has no camera at all.
   */
  async function scanFromPhoto() {
    setPhotoError(null);

    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images" });
    if (picked.canceled) return;

    const uri = picked.assets?.[0]?.uri;
    if (!uri) return;

    try {
      const [found] = await scanFromURLAsync(uri, ["ean13", "upc_a"]);
      if (!found) {
        setPhotoError({
          title: "No barcode in that photo",
          body: "A straight, close shot of the back cover reads best — fill the frame with the stripes.",
        });
        return;
      }
      onScanned(found.data);
    } catch {
      // An unreadable file, or a format the decoder will not open.
      setPhotoError({
        title: "That image could not be opened",
        body: "Some screenshots and edited files lose the barcode. A photo taken of the book works best.",
      });
    }
  }

  const photoOption = (
    <>
      {photoError ? (
        <Notice
          tone="warn"
          title={photoError.title}
          body={photoError.body}
          action={
            <Pressable onPress={scanFromPhoto} accessibilityRole="button" className="mt-2">
              <Text className="font-serif-semibold text-[12.5px] text-primary">
                Try another photo
              </Text>
            </Pressable>
          }
        />
      ) : (
        <Pressable
          onPress={scanFromPhoto}
          accessibilityRole="button"
          className="min-h-[44px] items-center justify-center rounded-card border border-surface-strong active:opacity-60"
        >
          <Text className="font-serif-semibold text-[13px] text-foreground">
            Choose a photo instead
          </Text>
        </Pressable>
      )}
    </>
  );

  if (!permission) {
    // Permissions are still loading — a blank box rather than a flash of the
    // "turn it on" copy that is about to be replaced.
    return <View className="mb-4 h-[186px] bg-surface-strong" />;
  }

  if (!permission.granted) {
    const isBlocked = !permission.canAskAgain;
    return (
      <View className="mb-4 gap-3">
        <Notice
          tone={isBlocked ? "warn" : "info"}
          title={isBlocked ? "The camera is off for GlossNote" : "Scanning needs the camera"}
          body={
            isBlocked
              ? "Settings › GlossNote › Camera turns it back on. A photo of the barcode works without it."
              : "The barcode is read on this phone. Nothing is recorded, and no image is uploaded."
          }
        />

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

        {photoOption}

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

      <View>
        <Text className="font-serif-semibold text-[14.5px] leading-[20px] text-foreground">
          Point at the barcode on the back
        </Text>
        <Text className="font-serif mt-1 text-[12.5px] leading-[19px] text-muted">
          Reading the ISBN gets you the right edition — its cover, and its page count for reading
          progress.
        </Text>
      </View>

      {photoOption}

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
