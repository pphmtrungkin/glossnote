import { type ReactNode, useState } from "react";
import { Image, Text, View } from "react-native";

/**
 * A book's cover — Hardcover's own image, or an Open Library link for a book
 * Hardcover has no image for — or `fallback` when there is neither.
 *
 * Open Library links carry `?default=false` (see openLibraryCoverUrl in the
 * book router), so a book it has no cover for is a 404 instead of a blank white
 * image. A 404 is only discovered by trying to load it, which is why this
 * tracks a failed load and not just a null link. The failure is remembered per
 * URL, so a reused row showing a different book tries again.
 */
export function BookCover({
  uri,
  className,
  fallback = null,
}: {
  uri: string | null | undefined;
  className?: string;
  fallback?: ReactNode;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri) return <>{fallback}</>;

  // Open Library links ask for its medium size (180×288 px), which blurs on a
  // 3× screen once a cover is wider than ~60pt. Large is 311×500 px and ~38 KB
  // — enough for the 100pt book-page cover — so every tile asks for it. Swapped
  // here rather than in the stored link, so rows already saved get it.
  // Hardcover serves one size per image and has no such suffix to swap.
  const source = uri.includes("covers.openlibrary.org") ? uri.replace(/-M\.jpg/, "-L.jpg") : uri;

  return (
    <Image source={{ uri: source }} className={className} resizeMode="cover" onError={() => setFailedUri(uri)} />
  );
}

/**
 * A cover-shaped tile: the book's cover when there is one, and the title set in
 * type when there isn't. Plenty of books still have none, so the fallback is
 * part of the design rather than an empty box.
 *
 * Size it with `className`. `compact` is for tiles too small for legible type,
 * which show the title's first letter instead. `accent` gives the tile the
 * scheme's accent as its top edge — keep it for the book the reader is reading
 * now, which is the one-accent rule applied to a cover.
 */
export function CoverTile({
  uri,
  title,
  className,
  accent = false,
  compact = false,
}: {
  uri: string | null | undefined;
  title: string;
  className?: string;
  accent?: boolean;
  compact?: boolean;
}) {
  const fallback = compact ? (
    <View className="flex-1 items-center justify-center">
      <Text className="font-serif-semibold text-[18px] text-muted">{title.trim().charAt(0).toUpperCase()}</Text>
    </View>
  ) : (
    // The padding lives on the fallback, not the tile: padding on the tile
    // shrank the cover image with it, leaving a gap on its right and bottom.
    <View className="flex-1 justify-end p-1.5">
      <Text className="font-serif-semibold text-[11px] leading-[13px] text-foreground" numberOfLines={6}>
        {title}
      </Text>
    </View>
  );

  return (
    <View
      className={`overflow-hidden border-t-[3px] bg-surface-secondary ${
        accent ? "border-primary" : "border-surface-strong"
      } ${className ?? ""}`}
    >
      {/* Pinned to all four edges rather than sized in percent, so the cover
          fills the whole box below the accent rule and crops to fit. */}
      <BookCover uri={uri} className="absolute top-0 right-0 bottom-0 left-0" fallback={fallback} />
    </View>
  );
}
