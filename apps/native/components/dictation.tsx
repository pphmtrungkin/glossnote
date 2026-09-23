import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { Notice } from "@/components/notice";
import { useDictation } from "@/hooks/use-dictation";
import { usePalette } from "@/lib/palette";

/**
 * The microphone under the add-word form's Word field — Today's "Say it" tile,
 * landed on the screen that can actually show what was heard.
 *
 * It fills the field and stops there. The reader still reads the definition
 * that resolves and still presses Save, because a recogniser's best guess at a
 * rare word is a proposal: see hooks/use-dictation.ts for why the top
 * transcript alone isn't trustworthy enough to capture from.
 *
 * The microphone is deliberately not ochre, live or idle. The accent is spent
 * on the one main action per screen and here that is Save; a listening state is
 * feedback, not the action. It reads as live through its filled surface and the
 * words beside it instead.
 */
export function Dictation({
  autoStart = false,
  contextualStrings,
  onTerm,
}: {
  /** Opens the microphone on mount — how arriving from Today's Say it works. */
  autoStart?: boolean;
  contextualStrings?: string[];
  onTerm: (term: string) => void;
}) {
  const palette = usePalette();
  const dictation = useDictation({ contextualStrings, onTerm });

  // `start` is rebuilt whenever connectivity changes, so the effect reads it
  // through a ref — otherwise regaining a signal reopens the microphone.
  const latestStart = useRef(dictation.start);
  latestStart.current = dictation.start;
  useEffect(() => {
    if (autoStart) latestStart.current();
  }, [autoStart]);

  const isListening = dictation.status === "listening" || dictation.status === "starting";

  // A refusal that can't be asked about again has nothing behind a retry, and
  // neither does a device with no recogniser at all: say so once and leave the
  // reader on the field, which is a complete way to save a word on its own.
  if (
    dictation.status === "unavailable" ||
    (dictation.status === "denied" && !dictation.canAskAgain)
  ) {
    return (
      <Notice
        tone="info"
        title={
          dictation.status === "unavailable" ? "No speech recognition here" : "Microphone is off"
        }
        body={dictation.message ?? undefined}
      />
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={isListening ? dictation.stop : dictation.start}
          accessibilityRole="button"
          accessibilityLabel={isListening ? "Stop listening" : "Say the word"}
          accessibilityState={{ busy: isListening }}
          hitSlop={8}
          className={`h-11 w-11 items-center justify-center rounded-full border active:opacity-60 ${
            isListening ? "border-transparent bg-surface-strong" : "border-surface-strong"
          }`}
        >
          <Ionicons
            name={isListening ? "stop" : "mic-outline"}
            size={19}
            color={isListening ? palette.ink : palette.muted}
          />
        </Pressable>

        <View className="min-w-0 flex-1">
          {isListening ? (
            <>
              <Text className="font-serif-semibold text-[13px] text-foreground">
                {dictation.status === "starting" ? "Starting…" : "Listening — say the word"}
              </Text>
              {dictation.heard ? (
                <Text numberOfLines={1} className="font-serif text-[12.5px] text-muted">
                  {dictation.heard}
                </Text>
              ) : null}
            </>
          ) : (
            <Text className="font-serif text-[12.5px] text-muted">
              Say the word instead of spelling it
            </Text>
          )}
        </View>
      </View>

      {!isListening && dictation.message ? (
        <Notice
          tone="warn"
          title={dictation.status === "denied" ? "Microphone needed" : "Didn't catch that"}
          body={dictation.message}
          action={
            <Pressable onPress={dictation.start} accessibilityRole="button" className="mt-2">
              <Text className="font-serif-semibold text-[12.5px] text-primary">Try again</Text>
            </Pressable>
          }
        />
      ) : null}
    </View>
  );
}
