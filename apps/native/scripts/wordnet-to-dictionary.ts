/// <reference types="bun" />
// Pulls Open English WordNet (github.com/globalwordnet/english-wordnet) and
// produces two intermediate JSON files consumed by build-dictionary-db.ts:
//
//   dictionary-core.json     single-word lemmas, most frequent sense only
//   dictionary-extended.json every lemma (incl. multi-word phrases), every
//                             sense, ranked by frequency
//
// The split exists because WordNet has ~136k lemmas (too big to bundle in
// the app binary as a "small core set"); single-word/rank-0 keeps the
// bundled core compact while still covering ordinary vocabulary lookups.
//
// Usage: bun run scripts/wordnet-to-dictionary.ts <output-dir> [git-ref]
import { parse } from "yaml";

const [, , outputDir, ref = "main"] = process.argv;
if (!outputDir) {
  throw new Error("Usage: bun run scripts/wordnet-to-dictionary.ts <output-dir> [git-ref]");
}

const RAW_BASE = `https://raw.githubusercontent.com/globalwordnet/english-wordnet/${ref}/src`;

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
].map((name) => `${name}.yaml`);

const POS_LABEL: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  s: "adjective", // adjective satellite, treated as a plain adjective
  r: "adverb",
};

type SynsetInfo = { definition: string; example: string | null; partOfSpeech: string };
type DictionaryEntry = { term: string; definition: string; partOfSpeech: string; exampleSentence: string | null };

async function fetchRaw(path: string): Promise<string> {
  const res = await fetch(`${RAW_BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function loadSynsets(): Promise<Map<string, SynsetInfo>> {
  const synsets = new Map<string, SynsetInfo>();
  for (const file of SYNSET_FILES) {
    console.log(`Fetching src/yaml/${file}...`);
    const doc = parse(await fetchRaw(`yaml/${file}`)) as Record<
      string,
      { definition?: string[]; example?: string[]; partOfSpeech: string }
    >;
    for (const [synsetId, entry] of Object.entries(doc)) {
      const definition = entry.definition?.[0];
      if (!definition) continue;
      synsets.set(synsetId, {
        definition,
        example: entry.example?.[0] ?? null,
        partOfSpeech: POS_LABEL[entry.partOfSpeech] ?? entry.partOfSpeech,
      });
    }
  }
  return synsets;
}

async function main() {
  const synsets = await loadSynsets();
  console.log(`Loaded ${synsets.size} synsets`);

  console.log("Fetching src/sense-orders.csv...");
  const csv = await fetchRaw("sense-orders.csv");

  const core: DictionaryEntry[] = [];
  const extended: (DictionaryEntry & { rank: number })[] = [];

  for (const line of csv.split("\n")) {
    if (!line.trim()) continue;
    const [lemma, pos, idsRaw] = line.split(",");
    if (!lemma || !pos || !idsRaw) continue;

    const isSingleWord = !lemma.includes("_") && !lemma.includes(" ");
    const synsetIds = idsRaw.trim().split(" ");

    synsetIds.forEach((rawId, rank) => {
      const info = synsets.get(`${rawId}-${pos}`);
      if (!info) return;

      const entry: DictionaryEntry = {
        term: lemma.replace(/_/g, " "),
        definition: info.definition,
        partOfSpeech: info.partOfSpeech,
        exampleSentence: info.example,
      };

      extended.push({ ...entry, rank });
      if (isSingleWord && rank === 0) core.push(entry);
    });
  }

  await Bun.write(`${outputDir}/dictionary-core.json`, JSON.stringify(core));
  await Bun.write(`${outputDir}/dictionary-extended.json`, JSON.stringify(extended));
  console.log(`Wrote ${core.length} core entries and ${extended.length} extended entries to ${outputDir}`);
}

main();
