import { type NormalizedTerm, normalizeTerm } from "@better-vocab/domain";
import type * as SpeechRecognition from "expo-speech-recognition";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";

import { useIsOnline } from "@/hooks/use-is-online";
import { knownTerms } from "@/lib/dictionary";

/**
 * "Say the word you looked up" — the recogniser behind Today's Say it tile.
 *
 * This hook is about one word, never dictation: `continuous: false` and no
 * punctuation, so a reader says "perspicacious" and the recogniser stops on its
 * own. What it hands back is a *candidate*, not a capture — it fills the
 * add-word field and the reader still sees the definition and presses Save.
 * Speech is an input method for that field, so voice keeps the one capture path
 * (hooks/use-capture-word.ts) rather than growing a second one.
 *
 * Accuracy is the whole problem here. A recogniser is trained on ordinary
 * speech and the words this app exists for are the rarest ones in the book, so
 * the top transcript is wrong often enough that saving it blind would file
 * misspellings. Two things push back, both in `bestCandidate` below:
 *
 *   - `maxAlternatives`, weighed against the device dictionary. The recogniser
 *     ranks by how likely the sounds are; we re-rank by which guesses are real
 *     words, which is the thing it has no idea about.
 *   - `contextualStrings`, which the caller fills with what other readers of
 *     this book saved. Those are mostly names and invented words no recogniser
 *     would ever reach on its own, and they are exactly what gets said aloud.
 *
 * A guess that matches no dictionary word is still returned rather than
 * discarded: a word invented for the book is a first-class capture here, and
 * the add-word screen already says so ("this may be a name or a word invented
 * for the book"). Snapping to the nearest real word would quietly destroy them.
 */

/** Alternatives to ask for — enough to re-rank, few enough to stay one query. */
const MAX_ALTERNATIVES = 5;

/**
 * The recogniser, or null where there is no native module to talk to.
 *
 * `expo-speech-recognition` resolves its native module at import and throws
 * when it is missing — which is every run in Expo Go, since this is a
 * third-party module rather than one Expo Go bundles. A bare import would
 * therefore turn the add-word screen, which works perfectly well with a
 * keyboard, into a blank crash on the client `dev:native` opens by default.
 * Adding a way to say a word may not take away the way to type one.
 *
 * Resolved once at module load and never again, so nothing downstream has to
 * treat "is there a recogniser" as a value that moves. A dev build
 * (`expo run:ios` / `run:android` — what the camera already needs) is what
 * fills it in.
 */
const speech: typeof SpeechRecognition | null = (() => {
  try {
    return require("expo-speech-recognition") as typeof SpeechRecognition;
  } catch {
    return null;
  }
})();

/**
 * The two pieces of the package this hook uses, with the missing-module case
 * already absorbed: a no-op listener so `useDictation` calls the same hooks in
 * the same order whether or not there is a recogniser, and an undefined
 * `recognizer` that `start` checks for before anything else.
 */
const useSpeechRecognitionEvent: typeof SpeechRecognition.useSpeechRecognitionEvent =
  speech?.useSpeechRecognitionEvent ?? (() => {});
const recognizer = speech?.ExpoSpeechRecognitionModule;

export type DictationStatus =
  /** Never started, or finished and handed a word back. */
  | "idle"
  /** Permission asked for, recogniser not yet running. */
  | "starting"
  /** Microphone live. */
  | "listening"
  /** No recogniser on this device — the tile should not be offered at all. */
  | "unavailable"
  /** Microphone or speech-recognition permission refused. */
  | "denied"
  | "error";

export type Dictation = {
  status: DictationStatus;
  /** Interim transcript, so the reader can see it heard something. */
  heard: string;
  /** What went wrong, in the reader's terms. Set with `error` and `denied`. */
  message: string | null;
  /** False once refused for good — Settings is then the only way back. */
  canAskAgain: boolean;
  start: () => void;
  stop: () => void;
};

/**
 * Every spelling worth testing against the dictionary, best-first.
 *
 * Three shapes per alternative, because a recogniser breaks an unfamiliar word
 * in predictable ways: the transcript whole ("perspicacious"), with the spaces
 * closed up ("per spicacious" → "perspicacious", the common failure on a long
 * word), and each word alone (so "the word perspicacious" still yields it).
 */
function candidatesFor(transcripts: string[]): NormalizedTerm[] {
  const seen = new Set<string>();
  const out: NormalizedTerm[] = [];

  const add = (raw: string) => {
    // Punctuation is the recogniser's, not the reader's: "perspicacious." is
    // the same word. Hyphens and apostrophes stay, since headwords hold them.
    const term = normalizeTerm(raw.replace(/[^\p{L}\p{N}\s'-]/gu, ""));
    if (!term || seen.has(term)) return;
    seen.add(term);
    out.push(term);
  };

  for (const transcript of transcripts) {
    add(transcript);
    add(transcript.replace(/\s+/g, ""));
    for (const word of transcript.split(/\s+/)) add(word);
  }
  return out;
}

/**
 * The word to put in the field: the best-ranked candidate the dictionary
 * knows, or failing that the recogniser's own first answer.
 */
async function bestCandidate(
  db: Parameters<typeof knownTerms>[0],
  transcripts: string[],
): Promise<string | null> {
  const candidates = candidatesFor(transcripts);
  if (candidates.length === 0) return null;

  const real = await knownTerms(db, candidates);
  // `candidates` is already best-first — alternatives in the recogniser's own
  // order, and within each the whole phrase before its parts.
  return candidates.find((term) => real.has(term)) ?? candidates[0] ?? null;
}

export function useDictation({
  contextualStrings,
  onTerm,
}: {
  /**
   * Words this reader is unusually likely to say — the add-word screen passes
   * what other readers of the same book saved. Biases the recogniser towards
   * them; it does not restrict it.
   */
  contextualStrings?: string[];
  onTerm: (term: string) => void;
}): Dictation {
  const db = useSQLiteContext();
  const isOnline = useIsOnline();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [heard, setHeard] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);

  // Read inside the event handlers, which are registered once.
  const latestOnTerm = useRef(onTerm);
  latestOnTerm.current = onTerm;
  const latestContext = useRef(contextualStrings);
  latestContext.current = contextualStrings;

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
    setHeard("");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcripts = event.results.map((result) => result.transcript).filter(Boolean);
    if (transcripts.length === 0) return;

    if (!event.isFinal) {
      // Interim results are the top guess only, and they are for showing, not
      // for keeping: the re-ranking below needs the final alternatives.
      setHeard(transcripts[0] ?? "");
      return;
    }

    bestCandidate(db, transcripts).then((term) => {
      if (term) latestOnTerm.current(term);
    });
  });

  useSpeechRecognitionEvent("end", () => {
    setStatus((current) => (current === "listening" || current === "starting" ? "idle" : current));
    setHeard("");
  });

  useSpeechRecognitionEvent("nomatch", () => {
    setStatus("error");
    setMessage("That didn't come through. Try saying just the word, close to the microphone.");
  });

  useSpeechRecognitionEvent("error", (event) => {
    // "aborted" is this screen closing or the reader tapping stop, which is not
    // a failure to report back to them.
    if (event.error === "aborted") {
      setStatus("idle");
      return;
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setStatus("denied");
      setMessage("GlossNote needs the microphone to hear a word.");
      return;
    }
    setStatus("error");
    setMessage(
      event.error === "no-speech" || event.error === "speech-timeout"
        ? "I didn't hear anything. Tap the microphone and say the word."
        : event.error === "network"
          ? "Speech recognition needs a connection on this device. Type the word instead."
          : "The microphone didn't work that time. Try again, or type the word.",
    );
  });

  // Leaving mid-listen must release the microphone: the recogniser is a native
  // singleton and a live one blocks the next screen that asks for it.
  useEffect(() => () => recognizer?.abort(), []);

  const start = useCallback(() => {
    setMessage(null);
    setHeard("");
    setStatus("starting");

    // Not a permission problem and not worth a retry — no recogniser is
    // installed, or it is disabled.
    if (!recognizer?.isRecognitionAvailable()) {
      setStatus("unavailable");
      setMessage(
        recognizer
          ? "This device has no speech recognition. Type the word instead."
          : "Saying a word needs a development build of GlossNote. Type the word instead.",
      );
      return;
    }

    recognizer.requestPermissionsAsync().then((permission) => {
      if (!permission.granted) {
        setStatus("denied");
        setCanAskAgain(permission.canAskAgain);
        setMessage(
          permission.canAskAgain
            ? "GlossNote needs the microphone to hear a word."
            : "Microphone access is off for GlossNote. Turn it on in Settings, or type the word.",
        );
        return;
      }

      recognizer.start({
        lang: "en-US",
        // One word, so the recogniser should stop by itself rather than wait
        // for a pause in a sentence that is never coming.
        continuous: false,
        interimResults: true,
        maxAlternatives: MAX_ALTERNATIVES,
        // A single word takes no punctuation, and a trailing full stop is one
        // more thing `candidatesFor` would have to strip.
        addsPunctuation: false,
        contextualStrings: latestContext.current?.slice(0, 100),
        // Offline the network recogniser would simply fail, and this app is
        // built to keep working there. Online the network models are better at
        // rare words, which is the whole difficulty, so they get the chance.
        requiresOnDeviceRecognition: !isOnline && recognizer.supportsOnDeviceRecognition(),
      });
    });
  }, [isOnline]);

  const stop = useCallback(() => {
    // `stop` finalises what it has heard; `abort` throws it away. A reader
    // tapping the live microphone means "I've said it", so it is stop.
    recognizer?.stop();
  }, []);

  return { status, heard, message, canAskAgain, start, stop };
}
