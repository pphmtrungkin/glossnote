import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { Button, useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { useFinishOnboarding } from "@/hooks/use-finish-onboarding";
import {
  formatBytes,
  installPack,
  packUrl,
  readPackInstall,
  type DownloadProgress,
} from "@/lib/dictionary-pack";
import { trpc } from "@/utils/trpc";

/**
 * The design's `dict` screen — the offline dictionary offered once, at the end
 * of the tour.
 *
 * It drives the same `installPack` that Settings does and shares its query key,
 * so a pack taken here is already "Installed" by the time Settings is opened.
 * Because the tour now runs behind a session, it can also mirror the choice
 * into `preference.offlineDictionaryTier` the way Settings does: the pack is
 * per-device, the preference is the account-level intent that tells a second
 * phone to fetch it too.
 */
export default function OnboardingDictionaryScreen() {
  const db = useSQLiteContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const finishOnboarding = useFinishOnboarding();

  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  // Same key as Settings, so whichever screen runs second sees the install.
  const pack = useQuery({
    queryKey: ["dictionary-pack"],
    queryFn: () => readPackInstall(db),
  });

  const updatePreference = useMutation(trpc.preference.update.mutationOptions());

  // No pack is published for this build, so there is nothing to offer. The tour
  // routes around this screen already; this is the deep-link path, and it ends
  // the tour rather than stranding the reader on an empty offer.
  useEffect(() => {
    if (!packUrl) void finishOnboarding();
  }, [finishOnboarding]);

  if (!packUrl) return null;

  const install = pack.data;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesWritten / progress.totalBytes) * 100)
      : null;

  async function download() {
    setIsWorking(true);
    setProgress(null);
    try {
      await installPack(db, setProgress);
      // Not awaited: the pack is already on the phone, and the account-level
      // intent failing (no signal, say) must not undo a finished download.
      updatePreference.mutate({ offlineDictionaryTier: "extended" });
      await queryClient.invalidateQueries({ queryKey: ["dictionary-pack"] });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "The download failed.",
      });
    } finally {
      setIsWorking(false);
      setProgress(null);
    }
  }

  return (
    <Container isScrollable={false} hasTopInset className="px-8 pt-16 pb-10">
      <View className="flex-1">
        <Text className="font-serif-semibold text-[12px] uppercase tracking-[2.2px] text-primary">
          GlossNote
        </Text>

        <View className="mt-8 flex-1">
          <Text className="mb-4 font-serif-semibold text-[10px] uppercase tracking-[1.8px] text-muted">
            One optional extra
          </Text>
          <Text className="mb-3.5 font-serif-semibold text-[33px] leading-[36px] tracking-[-0.66px] text-foreground">
            Keep a dictionary on the phone?
          </Text>
          <Text className="font-serif max-w-[310px] text-[15.5px] leading-[25px] text-muted">
            Looking a word up needs signal. Meanings don't have to. With the dictionary on the
            phone, a word caught on a train still comes back with its definition.
          </Text>

          {/* The design lists download size, entry count and a refresh schedule
              up front. Only the first two are knowable, and only once the pack
              is down — the server reports its size as it streams — so they are
              shown as what was installed rather than guessed at beforehand.
              There is no refresh mechanism, so that row is gone. */}
          {install ? (
            <View className="mt-8 flex-row items-center gap-2.5 border-l-2 border-primary bg-primary-tint px-3.5 py-3">
              <Text className="font-serif flex-1 text-[13.5px] leading-[19px] text-foreground">
                On the phone. {install.rows.toLocaleString()} words · {formatBytes(install.bytes)}.
                Lookups will work with no signal.
              </Text>
            </View>
          ) : null}

          {isWorking ? (
            <View className="mt-8">
              <View className="h-[3px] bg-surface-strong">
                <View className="h-[3px] bg-primary" style={{ width: `${percent ?? 0}%` }} />
              </View>
              <View className="mt-2.5 flex-row justify-between">
                <Text className="font-serif text-[12.5px] text-muted">Downloading dictionary…</Text>
                <Text className="font-serif text-[12.5px] text-muted">
                  {percent === null ? "Starting…" : `${percent}%`}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View className="gap-2.5">
          {install ? (
            <Button size="lg" onPress={() => void finishOnboarding()}>
              Continue
            </Button>
          ) : (
            <>
              <Button size="lg" isDisabled={isWorking} onPress={download}>
                Download the dictionary
              </Button>
              <Button
                variant="ghost"
                isDisabled={isWorking}
                onPress={() => void finishOnboarding()}
              >
                Not now
              </Button>
            </>
          )}
          <Text className="font-serif text-center text-[12px] leading-[18px] text-muted">
            You can add or remove it later in Settings.
          </Text>
        </View>
      </View>
    </Container>
  );
}
