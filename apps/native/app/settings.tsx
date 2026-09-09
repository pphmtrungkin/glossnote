import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { Spinner, useToast } from "heroui-native";
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import {
  formatBytes,
  installPack,
  packUrl,
  readPackInstall,
  removePack,
  type DownloadProgress,
} from "@/lib/dictionary-pack";
import { queryClient as appQueryClient, trpc } from "@/utils/trpc";

/**
 * The design's `settings` screen — grouped label/hint/value rows.
 *
 * Two of the three groups are backed by `preference.get`/`preference.update`,
 * which had no caller until now. The offline dictionary row is the odd one: the
 * *preference* is per-account (it follows the reader to a new phone), while the
 * downloaded pack is per-device, so the row drives both — installing sets the
 * tier to `extended`, removing sets it back to `core`.
 */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-7">
      <Text className="mb-1.5 font-serif-semibold text-[10px] uppercase tracking-[1.4px] text-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({
  label,
  hint,
  value,
  valueClassName,
  onPress,
  isBusy,
}: {
  label: string;
  hint?: string;
  value?: string;
  valueClassName?: string;
  onPress?: () => void;
  isBusy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || isBusy}
      className="flex-row items-center gap-3.5 border-b border-surface-strong py-3.5"
    >
      <View className="flex-1">
        <Text className="text-[15.5px] text-foreground">{label}</Text>
        {hint ? <Text className="mt-0.5 text-[12.5px] text-muted">{hint}</Text> : null}
      </View>
      {isBusy ? (
        <Spinner size="sm" />
      ) : value ? (
        <Text
          className={`font-serif-semibold text-[13.5px] ${valueClassName ?? "text-muted"}`}
        >
          {value}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const preference = useQuery(trpc.preference.get.queryOptions());
  const updatePreference = useMutation(
    trpc.preference.update.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.preference.get.queryKey() }),
      onError: (error) => toast.show({ variant: "danger", label: error.message }),
    }),
  );

  // The device's own half of the offline dictionary, read straight from SQLite
  // rather than through the server — the pack is per-device.
  const pack = useQuery({
    queryKey: ["dictionary-pack"],
    queryFn: () => readPackInstall(db),
  });

  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const refreshPack = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["dictionary-pack"] }),
    [queryClient],
  );

  async function download() {
    setIsWorking(true);
    setProgress(null);
    try {
      await installPack(db, setProgress);
      // The account-level intent, so a new phone knows to fetch it too.
      updatePreference.mutate({ offlineDictionaryTier: "extended" });
      await refreshPack();
      toast.show({ variant: "success", label: "Offline dictionary ready." });
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

  function confirmRemove(bytes: number) {
    Alert.alert(
      "Remove the offline dictionary?",
      `This frees ${formatBytes(bytes)}. Words you've already looked up stay available offline.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsWorking(true);
            try {
              await removePack(db);
              updatePreference.mutate({ offlineDictionaryTier: "core" });
              await refreshPack();
            } finally {
              setIsWorking(false);
            }
          },
        },
      ],
    );
  }

  const install = pack.data;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesWritten / progress.totalBytes) * 100)
      : null;

  return (
    <Container className="px-6 pb-10">
      <Text className="mt-3 mb-6 font-serif-semibold text-[27px] leading-[31px] tracking-[-0.6px] text-foreground">
        Settings
      </Text>

      <Group title="Offline">
        {!packUrl ? (
          <Row
            label="Offline dictionary"
            hint="No pack is published for this build yet."
            value="Unavailable"
          />
        ) : install ? (
          <>
            <Row
              label="Offline dictionary"
              hint={`${install.rows.toLocaleString()} words · ${formatBytes(install.bytes)}`}
              value="Installed"
              valueClassName="text-primary"
            />
            <Row
              label="Remove it"
              hint="Frees the space. You can download it again later."
              value="Remove"
              isBusy={isWorking}
              onPress={() => confirmRemove(install.bytes)}
            />
          </>
        ) : (
          <Row
            label="Download the offline dictionary"
            hint={
              isWorking
                ? percent === null
                  ? "Starting…"
                  : `Downloading — ${percent}%`
                : "One transfer while you're online. After that, meanings work with no signal."
            }
            value="Download"
            valueClassName="text-primary"
            isBusy={isWorking}
            onPress={download}
          />
        )}

        {/* The progress rail, in the same accent the review run uses. */}
        {isWorking && percent !== null ? (
          <View className="mt-2 h-0.5 bg-surface-strong">
            <View className="h-0.5 bg-primary" style={{ width: `${percent}%` }} />
          </View>
        ) : null}
      </Group>

      <Group title="Privacy">
        <Row
          label="Contribute to word counts"
          hint="Other readers of a book see how often a word was saved — never what it means to you, and never your notes."
          value={preference.data?.contributeToAggregateByDefault ? "On" : "Off"}
          valueClassName={
            preference.data?.contributeToAggregateByDefault ? "text-primary" : "text-muted"
          }
          isBusy={preference.isPending || updatePreference.isPending}
          onPress={() =>
            updatePreference.mutate({
              contributeToAggregateByDefault: !preference.data?.contributeToAggregateByDefault,
            })
          }
        />
      </Group>

      <Group title="Account">
        <Row
          label="Sign out"
          value="Sign out"
          onPress={async () => {
            await authClient.signOut();
            // Drop every cached query so the next account doesn't briefly see
            // the previous user's shelf.
            appQueryClient.clear();
          }}
        />
      </Group>

      <Text className="text-[12.5px] leading-[20px] text-muted">
        Words you save stay yours. Only how often a word was saved crosses between readers.
      </Text>
    </Container>
  );
}
