/// <reference types="bun" />
// Pulls Open English WordNet (github.com/globalwordnet/english-wordnet) and
// produces two intermediate JSON files consumed by build-dictionary-db.ts:
//
//   dictionary-core.json     single-word lemmas, most frequent sense only
//   dictionary-extended.json every lemma (incl. multi-word phrases), every
//                             sense, ranked by frequency
//
// The split exists because WordNet has ~127k lemmas (too big to bundle in
// the app binary as a "small core set"); single-word/rank-0 keeps the
// bundled core compact while still covering ordinary vocabulary lookups.
//
// The source is the JSON export attached to a tagged OEWN release — one 9.5 MB
// zip rather than 72 requests to raw.githubusercontent, and pinned to an
// edition rather than to `main`, so a rebuild a year from now produces the
// same dictionary. JSON exports start with the 2025 edition; older tags ship
// only XML and RDF.
//
// Two file groups inside the zip, both needed:
//   <lexname>.json   synsets — the definitions themselves
//   entries-*.json   the lemma index — which synsets a word means, in
//                    WordNet's own sense order
//
// `src/sense-orders.csv` in the repo looks like the lemma index and is not: it
// holds ~1.3k manual sense-order corrections, so building from it yields under
// a thousand words. The entries files are the whole vocabulary.
//
// Usage: bun run scripts/wordnet-to-dictionary.ts <output-dir> [edition]
import { $ } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , outputDir, edition = "2025"] = process.argv;
if (!outputDir) {
  throw new Error("Usage: bun run scripts/wordnet-to-dictionary.ts <output-dir> [edition]");
}

const ZIP_URL = `https://github.com/globalwordnet/english-wordnet/releases/download/${edition}-edition/english-wordnet-${edition}-json.zip`;

// Standard WordNet lexicographer files (26 noun categories, 15 verb
// categories, 3 adjective files, 1 adverb file) — each keys synsets by id.
const SYNSET_FILES = [
  "noun.Tops",
  "noun.act",
  "noun.animal",
  "noun.artifact",
  "noun.attribute",
  "noun.body",
  "noun.cognition",
  "noun.communication",
  "noun.event",
  "noun.feeling",
  "noun.food",
  "noun.group",
  "noun.location",
  "noun.motive",
  "noun.object",
  "noun.person",
  "noun.phenomenon",
  "noun.plant",
  "noun.possession",
  "noun.process",
  "noun.quantity",
  "noun.relation",
  "noun.shape",
  "noun.state",
  "noun.substance",
  "noun.time",
  "verb.body",
  "verb.change",
  "verb.cognition",
  "verb.communication",
  "verb.competition",
  "verb.consumption",
  "verb.contact",
  "verb.creation",
  "verb.emotion",
  "verb.motion",
  "verb.perception",
  "verb.possession",
  "verb.social",
  "verb.stative",
  "verb.weather",
  "adj.all",
  "adj.pert",
  "adj.ppl",
  "adv.all",
].map((name) => `${name}.json`);

// The lemma index, split by first character across 27 files.
const ENTRY_FILES = ["0", ..."abcdefghijklmnopqrstuvwxyz"].map((k) => `entries-${k}.json`);

const POS_LABEL: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  s: "adjective", // adjective satellite, treated as a plain adjective
  r: "adverb",
};

type SynsetInfo = { definition: string; example: string | null; partOfSpeech: string };
type DictionaryEntry = { term: string; definition: string; partOfSpeech: string; exampleSentence: string | null };

/** An example is usually a plain sentence, but an attributed quotation is an
 *  object instead. Both appear in the same array, in the same file. */
type Example = string | { text: string; source?: string };
type SynsetDoc = Record<string, { definition?: string[]; example?: Example[]; partOfSpeech: string }>;

/** One lemma's senses, already in WordNet's sense order within each part of
 *  speech. The `synset` value is the full `NNNNNNNN-p` id. */
type EntryDoc = Record<string, Record<string, { sense?: { synset?: string }[] }>>;

/** Downloads the release zip and unpacks it into a temp directory. */
async function fetchExport(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "oewn-"));
  const zipPath = join(dir, "oewn.zip");

  console.log(`Downloading ${ZIP_URL}...`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to download the ${edition} JSON export: ${res.status} ${res.statusText}. ` +
        "JSON exports start with the 2025 edition — older tags ship only XML and RDF.",
    );
  }
  await Bun.write(zipPath, res);

  // Bun has no zip reader, and `unzip` is on every machine that would run a
  // build script — not worth a dependency for one call.
  await $`unzip -oq ${zipPath} -d ${dir}`;
  return dir;
}

function read<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), "utf-8")) as T;
}

function loadSynsets(dir: string): Map<string, SynsetInfo> {
  const synsets = new Map<string, SynsetInfo>();

  for (const file of SYNSET_FILES) {
    for (const [synsetId, entry] of Object.entries(read<SynsetDoc>(dir, file))) {
      const definition = entry.definition?.[0];
      // A synset with no gloss has nothing to show a reader.
      if (!definition) continue;
      const example = entry.example?.[0];
      synsets.set(synsetId, {
        definition,
        // The attribution is dropped: the app shows the sentence, not who said
        // it, and passing the object straight through reaches the SQLite driver
        // as an unbindable value rather than as a visible mistake.
        example: typeof example === "string" ? example : (example?.text ?? null),
        partOfSpeech: POS_LABEL[entry.partOfSpeech] ?? entry.partOfSpeech,
      });
    }
  }
  return synsets;
}

async function main() {
  const dir = await fetchExport();

  try {
    const synsets = loadSynsets(dir);
    console.log(`Loaded ${synsets.size} synsets`);

    const core: DictionaryEntry[] = [];
    const extended: (DictionaryEntry & { rank: number })[] = [];

    for (const file of ENTRY_FILES) {
      for (const [lemma, byPos] of Object.entries(read<EntryDoc>(dir, file))) {
        const term = lemma.replace(/_/g, " ");
        const isSingleWord = !term.includes(" ");

        // Rank counts across the whole lemma, not per part of speech. The
        // device table's unique index is (term, source, rank), so restarting
        // at 0 for a word's verb senses would collide with its noun senses and
        // INSERT OR IGNORE would drop them silently.
        let rank = 0;

        for (const pos of Object.keys(byPos).sort()) {
          for (const sense of byPos[pos]?.sense ?? []) {
            const info = sense.synset ? synsets.get(sense.synset) : undefined;
            if (!info) continue;

            const entry: DictionaryEntry = {
              term,
              definition: info.definition,
              partOfSpeech: info.partOfSpeech,
              exampleSentence: info.example,
            };

            extended.push({ ...entry, rank });
            // The bundled set is one sense per single word: the most frequent
            // sense of the first part of speech, which is what a reader who
            // just met the word in a sentence wants first.
            if (isSingleWord && rank === 0) core.push(entry);
            rank += 1;
          }
        }
      }
    }

    await Bun.write(`${outputDir}/dictionary-core.json`, JSON.stringify(core));
    await Bun.write(`${outputDir}/dictionary-extended.json`, JSON.stringify(extended));
    console.log(`Wrote ${core.length} core entries and ${extended.length} extended entries to ${outputDir}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
