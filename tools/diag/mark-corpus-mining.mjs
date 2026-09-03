// Regression harness for #26: keyword mining over the Manual Mark corpus (g:markCorpus).
//
// Replication note (honest): like manual-marks.mjs, this script REPLICATES normalizePageUrl from
// src/utils/configUtils.ts and the whole of src/utils/markCorpusMining.ts rather than importing them —
// the sources are TypeScript with bundler path aliases, so a standalone node run cannot import them.
// Keep these copies in sync with the source; drift here means the fixture no longer guards the shipped miner.
//
// Red-before-fix is structural: pre-#26 no mining module existed, so no candidate could be produced. This
// run pins the shipped behavior:
//   - The latest snapshot per DISTINCT normalized URL wins; Music adds +1, Negative subtracts 1, Live is neutral.
//   - Candidates need support from at least two Music-marked URLs and a positive score.
//   - ASCII word unigrams + word windows and CJK 2-grams are ranked score desc, longest phrase first on
//     ties (maximal-phrase pruning absorbs same-score sub-phrases), then alphabetical; cap 30.
//   - Stopwords-only phrases never surface; candidates overlapping DEFAULT_MUSIC_KEYWORDS values or current
//     preset values ("mv", "music", "playlist"…) are excluded — including the new "the first take" seed,
//     which is why an added candidate disappears from the UI list.

function normalizePageUrl(url) {
	try {
		const parsed = new URL(url)
		if ((parsed.hostname === "youtube.com" || parsed.hostname.endsWith(".youtube.com")) && parsed.pathname === "/watch") {
			const id = parsed.searchParams.get("v")
			if (id) return `${parsed.origin}/watch?v=${id}`
		}
		return `${parsed.origin}${parsed.pathname}`
	} catch {}
	const [noHash] = url.split("#")
	const [noSearch] = noHash.split("?")
	return noSearch ?? ""
}

const MINING_STOPWORDS = ["the", "a", "an", "of", "and", "to", "in", "on", "for", "from", "youtube", "official", "video", "full", "hd"]
const MAX_PHRASE_WORDS = 4
const CANDIDATE_CAP = 30
const MIN_MUSIC_SUPPORT = 2

const LABEL_WEIGHT = { music: 1, live: 0, negative: -1 }
const STOPWORD_SET = new Set(MINING_STOPWORDS)
const ASCII_WORD = /[a-z0-9]+(?:['’][a-z0-9]+)*/g
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/g

function normalizeValue(value) {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function compareText(a, b) {
	if (a < b) return -1
	if (a > b) return 1
	return 0
}

function containsPhrase(a, b) {
	return ` ${a} `.includes(` ${b} `)
}

function hasLetter(token) {
	return /[a-z]/.test(token)
}

function isStopwordOnly(phrase) {
	return phrase.split(" ").every((word) => STOPWORD_SET.has(word))
}

function extractKeys(text) {
	const keys = new Set()
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

function isNovel(key, knownValues) {
	if (isStopwordOnly(key)) return false
	return !knownValues.some((value) => containsPhrase(value, key) || containsPhrase(key, value))
}

function distinctMarkedUrlCount(corpus) {
	return new Set((corpus ?? []).map((entry) => normalizePageUrl(entry.url))).size
}

function mineKeywordCandidates(corpus, exclude, cap = CANDIDATE_CAP) {
	const latestByUrl = new Map()
	for (const entry of corpus ?? []) latestByUrl.set(normalizePageUrl(entry.url), entry)

	const knownValues = exclude.map(normalizeValue).filter(Boolean)
	const novelCache = new Map()
	const stats = new Map()
	for (const entry of latestByUrl.values()) {
		const weight = LABEL_WEIGHT[entry.label]
		if (!weight) continue

		const keys = new Set()
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

	const kept = []
	for (const [value, { score }] of ranked) {
		if (kept.some((candidate) => candidate.score === score && containsPhrase(candidate.value, value))) continue
		kept.push({ value, score })
		if (kept.length >= cap) break
	}
	return kept
}

let failed = 0
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected)
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

// Default seed values as the options UI passes them: the #23 trilingual batches, pre-#26.
const PRESET_SEEDS = [
	"playlist",
	"full album",
	"album",
	"compilation",
	"megamix",
	"remix",
	"soundtrack",
	"ost",
	"bgm",
	"lofi",
	"lyrics",
	"official video",
	"mv",
	"music",
	"cover",
	"歌单",
	"音乐",
	"音楽",
	"合集",
	"纯音乐",
	"翻唱",
	"カバー",
	"演唱会",
	"串烧",
	"混音",
	"专辑",
	"official music video",
	"lyric video",
	"song",
	"songs",
	"unplugged",
	"instrumental",
	"karaoke",
	"nightcore",
	"slowed",
	"sped up",
	"medley",
	"vocaloid",
	"concert",
	"m/v",
	"mix",
	"歌ってみた",
	"弾いてみた",
	"踊ってみた",
	"作業用BGM",
	"ボカロ",
	"VOCALOID",
	"ミュージック",
	"歌詞",
	"邦楽",
	"洋楽",
	"アニソン",
	"メドレー",
	"原创",
	"单曲",
	"新歌",
	"热歌",
	"金曲",
	"歌曲",
	"伴奏",
	"原声",
	"演奏",
	"全曲",
	"曲目",
	"卡拉OK",
	"KTV",
	"音乐现场",
	"歌回",
]

// Post-#26 default set: the franchise-format seed ships enabled, so the options page excludes it from the
// candidate list — the same effect as the user clicking Add on that candidate.
const SEEDS_WITH_26 = [...PRESET_SEEDS, "the first take"]

function entry(url, title, extra = {}) {
	return { label: "music", url, rawUrl: url, title, at: 1, ...extra }
}

console.log("== #26 mark-corpus mining regression harness ==")

// Fixture: two DISTINCT pages share the phrase "the first take"; two others are unrelated. URL 1 also has a
// param-churned duplicate whose mention must NOT raise the score, and its titles carry seed words
// (MV, music), YouTube-suffix artifacts, and stopwords that must all stay out.
console.log("\n-- fixture ranking, dedupe, exclusions --")
const corpus = [
	entry("https://www.youtube.com/watch?v=a1&t=9&si=x", "The First Take / Artist A MV (Official Video)"),
	// Same video as above after normalization (?v=a1): must merge into one doc.
	entry("https://www.youtube.com/watch?si=z&v=a1#comments", "the first take music full hd youtube"),
	entry("https://www.youtube.com/watch?v=b2", "Artist B Live Session | THE FIRST TAKE"),
	entry("https://www.bilibili.com/video/BV1xx411c7mD/", "家常菜烹饪教程 钢琴曲", { tags: ["钢琴", "生活"] }),
	entry("https://www.bilibili.com/video/BV2aa11c7mE/", "深夜钢琴演奏合集"),
]
check("corpus covers exactly 4 distinct URLs despite the param-churn duplicate", distinctMarkedUrlCount(corpus), 4)

let candidates = mineKeywordCandidates(corpus, PRESET_SEEDS)
check(`top candidate is "the first take"`, candidates[0]?.value, "the first take")
check(`"the first take" score is 2 (distinct URLs only)`, candidates.find((c) => c.value === "the first take")?.score, 2)
check(
	"same-score sub-phrases absorbed into the maximal phrase",
	candidates.some((c) => ["first take", "the first"].includes(c.value)),
	false,
)
check(
	"stopword-only and YouTube-artifact tokens never surface",
	candidates.filter((c) => ["the", "a", "official", "video", "full", "hd", "youtube"].includes(c.value)),
	[],
)
check(
	"seed-value tokens excluded (mv, music, album…)",
	candidates.filter((c) => ["mv", "m/v", "music", "album", "mix", "song"].includes(c.value)),
	[],
)
check("CJK 2-gram mined across two docs", candidates.find((c) => c.value === "钢琴")?.score, 2)

console.log("\n-- annotation-aware scoring --")
const penalized = [
	entry("https://example.com/music/1", "rarephrase"),
	entry("https://example.com/music/2", "rarephrase"),
	entry("https://example.com/normal/1", "rarephrase", { label: "negative" }),
]
check("two Music marks minus one Negative Mark score 1", mineKeywordCandidates(penalized, []).find((c) => c.value === "rarephrase")?.score, 1)
check(
	"one Music mark cancelled by one Negative Mark is omitted",
	mineKeywordCandidates(
		[entry("https://example.com/music/3", "balancedphrase"), entry("https://example.com/normal/2", "balancedphrase", { label: "negative" })],
		[],
	).some((c) => c.value === "balancedphrase"),
	false,
)
check(
	"Negative-only phrase is omitted",
	mineKeywordCandidates([entry("https://example.com/normal/3", "negativephrase", { label: "negative" })], []).some(
		(c) => c.value === "negativephrase",
	),
	false,
)
check(
	"Live-only phrase is omitted",
	mineKeywordCandidates([entry("https://example.com/live/1", "livephrase", { label: "live" })], []).some((c) => c.value === "livephrase"),
	false,
)
check(
	"one Music plus one Live mark does not meet Music support floor",
	mineKeywordCandidates(
		[entry("https://example.com/music/4", "liveneutral"), entry("https://example.com/live/2", "liveneutral", { label: "live" })],
		[],
	).some((c) => c.value === "liveneutral"),
	false,
)

console.log("\n-- latest normalized-URL snapshot wins --")
check(
	"music to negative relabel uses the latest label",
	mineKeywordCandidates(
		[
			entry("https://example.com/watch/relabel?first=1", "relabelphrase"),
			entry("https://example.com/watch/relabel?second=1", "relabelphrase", { label: "negative" }),
			entry("https://example.com/music/5", "relabelphrase"),
		],
		[],
	).some((c) => c.value === "relabelphrase"),
	false,
)
check(
	"negative to music relabel uses the latest label",
	mineKeywordCandidates(
		[
			entry("https://example.com/watch/promoted?first=1", "promotedphrase", { label: "negative" }),
			entry("https://example.com/watch/promoted?second=1", "promotedphrase"),
			entry("https://example.com/music/6", "promotedphrase"),
		],
		[],
	).find((c) => c.value === "promotedphrase")?.score,
	2,
)
check(
	"music to live relabel becomes neutral",
	mineKeywordCandidates(
		[
			entry("https://example.com/watch/neutral?first=1", "neutralphrase"),
			entry("https://example.com/watch/neutral?second=1", "neutralphrase", { label: "live" }),
			entry("https://example.com/music/7", "neutralphrase"),
		],
		[],
	).some((c) => c.value === "neutralphrase"),
	false,
)
const latestSnapshot = mineKeywordCandidates(
	[
		entry("https://example.com/watch/changing?first=1", "stalephrase"),
		entry("https://example.com/watch/changing?second=1", "freshphrase"),
		entry("https://example.com/music/8", "stalephrase"),
		entry("https://example.com/music/9", "freshphrase"),
	],
	[],
)
check(
	"earlier snapshot keys are discarded",
	latestSnapshot.some((c) => c.value === "stalephrase"),
	false,
)
check("latest snapshot keys are retained", latestSnapshot.find((c) => c.value === "freshphrase")?.score, 2)
check(
	"relabels still count as one distinct URL",
	distinctMarkedUrlCount([
		entry("https://example.com/watch/relabel?first=1", "one"),
		entry("https://example.com/watch/relabel?second=1", "two", { label: "negative" }),
	]),
	1,
)

console.log("\n-- exclusion against CURRENT presets: added candidate disappears --")
candidates = mineKeywordCandidates(corpus, SEEDS_WITH_26)
check(
	`"the first take" gone once added to presets (post-#26 defaults included)`,
	candidates.some((c) => c.value === "the first take"),
	false,
)
candidates = mineKeywordCandidates(corpus, [...PRESET_SEEDS, "artist b live session"])
check(
	`candidate matching a just-added user preset is gone`,
	candidates.some((c) => c.value === "artist b live session"),
	false,
)

console.log("\n-- floor, cap, and field boundaries --")
check("empty corpus yields nothing", mineKeywordCandidates([], PRESET_SEEDS), [])
check("single distinct URL stays below the minable floor", distinctMarkedUrlCount([corpus[0], corpus[1]]), 1)
check(
	"one-off Music phrase is omitted despite corpus breadth",
	mineKeywordCandidates([entry("https://example.com/once/1", "oneoffphrase"), entry("https://example.com/once/2", "unrelatedphrase")], []).some(
		(c) => c.value === "oneoffphrase",
	),
	false,
)
check(
	"numeric-only ASCII phrases are omitted",
	mineKeywordCandidates([entry("https://example.com/numeric/1", "123 456"), entry("https://example.com/numeric/2", "123 456")], []),
	[],
)

const manyDocs = Array.from({ length: 80 }, (_, i) => entry(`https://example.com/watch/${i}`, `sharedphrase${Math.floor(i / 2)}`))
check("output capped at 30", mineKeywordCandidates(manyDocs, SEEDS_WITH_26).length, 30)
check(
	"phrases never cross field boundaries (title+tag)",
	mineKeywordCandidates(
		[
			entry("https://example.com/v1", "alpha beta", { tags: ["gamma delta"] }),
			entry("https://example.com/v2", "alpha beta", { tags: ["gamma delta"] }),
		],
		[],
	).some((c) => ["beta gamma", "beta gamma delta"].includes(c.value)),
	false,
)
check(
	"msTitle participates alongside title",
	mineKeywordCandidates(
		[
			entry("https://example.com/v3", "plain title", { msTitle: "rare gem" }),
			entry("https://example.com/v4", "another title", { msTitle: "rare gem" }),
		],
		[],
	).some((c) => c.value === "rare gem"),
	true,
)

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
