import type { MarkedCorpusEntry } from "@/types"
import { normalizePageUrl } from "@/utils/configUtils"

// Local-only keyword mining over the Manual Mark corpus (#26): turns what the user marked into ranked
// TITLE_KEYWORD candidates for the Music Content channel. Pure functions, zero network, no storage access —
// the caller supplies the corpus and every value already known to the presets so mined candidates never
// duplicate them. The options preset editor is the only consumer.

/** Generic words that carry no Music Content signal wherever they appear in marked titles. */
export const MINING_STOPWORDS: string[] = [
	"the",
	"a",
	"an",
	"of",
	"and",
	"to",
	"in",
	"on",
	"for",
	"from",
	"youtube",
	"official",
	"video",
	"full",
	"hd",
]

/** Longest ASCII word window mined as one phrase candidate. */
const MAX_PHRASE_WORDS = 4

/** Hard ceiling on returned candidates, applied after ranking and subsumption pruning. */
const CANDIDATE_CAP = 30

/** A keyword seen on only one Music-marked page is too weak to suggest. */
const MIN_MUSIC_SUPPORT = 2

const LABEL_WEIGHT = { music: 1, live: 0, negative: -1 } as const
const STOPWORD_SET = new Set(MINING_STOPWORDS)

// One script class per regex: ASCII words (with in-word apostrophes) vs CJK ideographs/kana/hangul runs.
const ASCII_WORD = /[a-z0-9]+(?:['\u2019][a-z0-9]+)*/g
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g

export type KeywordCandidate = {
	/** Whitespace-normalized lowercase phrase, ready to store as a TITLE_KEYWORD value. */
	value: string
	/** Music-marked URLs minus Negative-marked URLs containing the phrase. */
	score: number
}

function normalizeValue(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function compareText(a: string, b: string) {
	if (a < b) return -1
	if (a > b) return 1
	return 0
}

/** Padded containment: does `b` occur in `a` on word boundaries ("m/v" contains "v", not "mix")? */
function containsPhrase(a: string, b: string) {
	return ` ${a} `.includes(` ${b} `)
}

function hasLetter(token: string) {
	return /[a-z]/.test(token)
}

function isStopwordOnly(phrase: string) {
	return phrase.split(" ").every((word) => STOPWORD_SET.has(word))
}

/**
 * Candidate keys present in one text: lowercased ASCII words, contiguous ASCII word windows up to
 * {@link MAX_PHRASE_WORDS}, and overlapping CJK 2-grams (a lone character stands in for a 1-char run).
 */
function extractKeys(text: string) {
	const keys = new Set<string>()
	for (const cjkRun of text.match(CJK_RUN) ?? []) {
		for (let i = 0; i < cjkRun.length; i++) keys.add(cjkRun.slice(i, i + 2))
	}
	const words = text.match(ASCII_WORD) ?? []
	for (let i = 0; i < words.length; i++) {
		if (hasLetter(words[i])) keys.add(words[i])
		let phrase = words[i]
		for (let j = i + 1; j < Math.min(words.length, i + MAX_PHRASE_WORDS); j++) {
			phrase += ` ${words[j]}`
			if (hasLetter(phrase)) keys.add(phrase)
		}
	}
	return keys
}

/** A candidate survives only if it isn't pure stopwords and doesn't overlap any normalized preset value. */
function isNovel(key: string, knownValues: string[]) {
	if (isStopwordOnly(key)) return false
	return !knownValues.some((value) => containsPhrase(value, key) || containsPhrase(key, value))
}

/** Number of distinct pages the corpus actually covers — the UI's floor for meaningful mining. */
export function distinctMarkedUrlCount(corpus: MarkedCorpusEntry[]): number {
	return new Set((corpus ?? []).map((entry) => normalizePageUrl(entry.url))).size
}

/**
 * Rank TITLE_KEYWORD candidates mined from the Manual Mark corpus (#26). The latest snapshot per DISTINCT
 * normalized URL wins. Music marks add one, Negative Marks subtract one, and Live Stream marks are neutral;
 * candidates need two Music-marked URLs and a positive score. Ranking is score desc, then more specific
 * phrases before their same-score sub-phrases (maximal-phrase pruning), then alphabetical.
 *
 * @param corpus captured mark snapshots, oldest to newest
 * @param exclude values already shipped or user-configured (defaults + current presets); candidates equal
 *   to, containing, or contained in any of them are dropped so adding a candidate never duplicates a preset
 * @param cap maximum candidates returned
 */
export function mineKeywordCandidates(corpus: MarkedCorpusEntry[], exclude: string[], cap = CANDIDATE_CAP): KeywordCandidate[] {
	// Dedupe snapshots before tokenizing: stale titles and neutral Live marks cannot affect the result.
	const latestByUrl = new Map<string, MarkedCorpusEntry>()
	for (const entry of corpus ?? []) latestByUrl.set(normalizePageUrl(entry.url), entry)

	const knownValues = exclude.map(normalizeValue).filter(Boolean)
	const novelCache = new Map<string, boolean>()
	const stats = new Map<string, { score: number; musicSupport: number; words: number }>()
	for (const entry of latestByUrl.values()) {
		const weight = LABEL_WEIGHT[entry.label]
		if (!weight) continue

		const keys = new Set<string>()
		// Signals are individually optional (#24); keep fields separate so phrases never cross them.
		for (const segment of [entry.msTitle ?? "", entry.title ?? "", ...(entry.tags ?? [])]) {
			if (!segment) continue
			for (const key of extractKeys(segment.toLowerCase())) keys.add(key)
		}
		for (const key of keys) {
			let novel = novelCache.get(key)
			if (novel == null) novelCache.set(key, (novel = isNovel(key, knownValues)))
			if (!novel) continue

			const current = stats.get(key)
			if (current) {
				current.score += weight
				if (weight > 0) current.musicSupport++
			} else {
				stats.set(key, { score: weight, musicSupport: weight > 0 ? 1 : 0, words: key.split(" ").length })
			}
		}
	}

	const ranked = [...stats.entries()]
		.filter(([, stat]) => stat.score > 0 && stat.musicSupport >= MIN_MUSIC_SUPPORT)
		.sort(([aValue, a], [bValue, b]) => b.score - a.score || b.words - a.words || compareText(aValue, bValue))

	// Maximal-phrase pruning: within one score tier, absorb sub-phrases into the longer survivor.
	const kept: KeywordCandidate[] = []
	for (const [value, { score }] of ranked) {
		if (kept.some((candidate) => candidate.score === score && containsPhrase(candidate.value, value))) continue
		kept.push({ value, score })
		if (kept.length >= cap) break
	}
	return kept
}
