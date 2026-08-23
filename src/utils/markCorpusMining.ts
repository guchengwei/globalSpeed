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

const STOPWORD_SET = new Set(MINING_STOPWORDS)

// One script class per regex: ASCII words (with in-word apostrophes) vs CJK ideographs/kana/hangul runs.
const ASCII_WORD = /[a-z0-9]+(?:['\u2019][a-z0-9]+)*/g
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g

export type KeywordCandidate = {
	/** Whitespace-normalized lowercase phrase, ready to store as a TITLE_KEYWORD value. */
	value: string
	/** How many distinct marked URLs contain the phrase; higher is a stronger candidate. */
	docFreq: number
}

function normalizeValue(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
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
function extractKeys(text: string): string[] {
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
			keys.add(phrase)
		}
	}
	return [...keys]
}

/** A candidate survives only if it isn't pure stopwords and doesn't overlap any known preset value. */
function isNovel(key: string, knownValues: string[]) {
	if (isStopwordOnly(key)) return false
	return !knownValues.some((value) => {
		const normalized = normalizeValue(value)
		return normalized && (containsPhrase(normalized, key) || containsPhrase(key, normalized))
	})
}

/** Number of distinct pages the corpus actually covers — the miner's floor for meaningful doc-frequency. */
export function distinctMarkedUrlCount(corpus: MarkedCorpusEntry[]): number {
	return new Set((corpus ?? []).map((entry) => normalizePageUrl(entry.url))).size
}

/**
 * Rank TITLE_KEYWORD candidates mined from the Manual Mark corpus (#26). Doc-frequency counts DISTINCT
 * normalized URLs (re-marks of the same page count once); ranking is frequency desc, then more specific
 * phrases before their same-frequency sub-phrases (maximal-phrase pruning), then alphabetical.
 *
 * @param corpus captured mark snapshots
 * @param exclude values already shipped or user-configured (defaults + current presets); candidates equal
 *   to, containing, or contained in any of them are dropped so adding a candidate never duplicates a preset
 * @param cap maximum candidates returned
 */
export function mineKeywordCandidates(corpus: MarkedCorpusEntry[], exclude: string[], cap = CANDIDATE_CAP): KeywordCandidate[] {
	const docsByUrl = new Map<string, Set<string>>()
	for (const entry of corpus ?? []) {
		const url = normalizePageUrl(entry.url)
		let doc = docsByUrl.get(url)
		if (!doc) docsByUrl.set(url, (doc = new Set()))
		// Signals are individually optional (#24); join fields as separate segments so phrases never cross them.
		for (const segment of [entry.msTitle ?? "", entry.title ?? "", ...(entry.tags ?? [])]) {
			if (!segment) continue
			for (const key of extractKeys(segment.toLowerCase())) doc.add(key)
		}
	}

	const knownValues = exclude.map(normalizeValue).filter(Boolean)
	const novelCache = new Map<string, boolean>()
	const freq = new Map<string, number>()
	for (const doc of docsByUrl.values()) {
		for (const key of doc) {
			let novel = novelCache.get(key)
			if (novel == null) novelCache.set(key, (novel = isNovel(key, knownValues)))
			if (novel) freq.set(key, (freq.get(key) ?? 0) + 1)
		}
	}

	const ranked = [...freq.entries()]
		.map(([value, docFreq]): KeywordCandidate => ({ value, docFreq }))
		.sort(
			(a, b) =>
				b.docFreq - a.docFreq || b.value.split(" ").length - a.value.split(" ").length || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
		)

	// Maximal-phrase pruning: within one frequency tier, absorb sub-phrases into the longer survivor.
	const kept: KeywordCandidate[] = []
	for (const candidate of ranked) {
		if (kept.some((k) => k.docFreq === candidate.docFreq && containsPhrase(k.value, candidate.value))) continue
		kept.push(candidate)
		if (kept.length >= cap) break
	}
	return kept
}
