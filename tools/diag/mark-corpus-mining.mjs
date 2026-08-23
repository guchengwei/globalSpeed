// Regression harness for #26: keyword mining over the Manual Mark corpus (g:markCorpus).
//
// Replication note (honest): like manual-marks.mjs, this script REPLICATES normalizePageUrl from
// src/utils/configUtils.ts and the whole of src/utils/markCorpusMining.ts rather than importing them —
// the sources are TypeScript with bundler path aliases, so a standalone node run cannot import them.
// Keep these copies in sync with the source; drift here means the fixture no longer guards the shipped miner.
//
// Red-before-fix is structural: pre-#26 no mining module existed, so no candidate could be produced. This
// run pins the shipped behavior:
//   - Doc-frequency counts DISTINCT normalized URLs; YouTube ?v= param churn re-marks count once.
//   - ASCII word unigrams + word windows and CJK 2-grams are ranked frequency desc, longest phrase first on
//     ties (maximal-phrase pruning absorbs same-frequency sub-phrases), then alphabetical; cap 30.
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

const STOPWORD_SET = new Set(MINING_STOPWORDS)
const ASCII_WORD = /[a-z0-9]+(?:['’][a-z0-9]+)*/g
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/g

function normalizeValue(value) {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
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
			keys.add(phrase)
		}
	}
	return [...keys]
}

function isNovel(key, knownValues) {
	if (isStopwordOnly(key)) return false
	return !knownValues.some((value) => {
		const normalized = normalizeValue(value)
		return normalized && (containsPhrase(normalized, key) || containsPhrase(key, normalized))
	})
}

function distinctMarkedUrlCount(corpus) {
	return new Set((corpus ?? []).map((entry) => normalizePageUrl(entry.url))).size
}

function mineKeywordCandidates(corpus, exclude, cap = CANDIDATE_CAP) {
	const docsByUrl = new Map()
	for (const entry of corpus ?? []) {
		const url = normalizePageUrl(entry.url)
		let doc = docsByUrl.get(url)
		if (!doc) docsByUrl.set(url, (doc = new Set()))
		for (const segment of [entry.msTitle ?? "", entry.title ?? "", ...(entry.tags ?? [])]) {
			if (!segment) continue
			for (const key of extractKeys(segment.toLowerCase())) doc.add(key)
		}
	}

	const knownValues = exclude.map(normalizeValue).filter(Boolean)
	const novelCache = new Map()
	const freq = new Map()
	for (const doc of docsByUrl.values()) {
		for (const key of doc) {
			let novel = novelCache.get(key)
			if (novel == null) novelCache.set(key, (novel = isNovel(key, knownValues)))
			if (novel) freq.set(key, (freq.get(key) ?? 0) + 1)
		}
	}

	const ranked = [...freq.entries()]
		.map(([value, docFreq]) => ({ value, docFreq }))
		.sort(
			(a, b) =>
				b.docFreq - a.docFreq || b.value.split(" ").length - a.value.split(" ").length || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
		)

	const kept = []
	for (const candidate of ranked) {
		if (kept.some((k) => k.docFreq === candidate.docFreq && containsPhrase(k.value, candidate.value))) continue
		kept.push(candidate)
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
// param-churned duplicate whose mention must NOT raise any doc-frequency, and its titles carry seed words
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
check(`"the first take" doc-frequency is 2 (distinct URLs only)`, candidates.find((c) => c.value === "the first take")?.docFreq, 2)
check(
	"same-frequency sub-phrases absorbed into the maximal phrase",
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
check("CJK 2-gram mined across two docs", candidates.find((c) => c.value === "钢琴")?.docFreq, 2)

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

const manyDocs = Array.from({ length: 40 }, (_, i) => entry(`https://example.com/watch?v=w${i}`, `junkword${i} sharedphrase`, { tags: [`tag${i}`] }))
manyDocs.forEach((d) => d.tags.push("commontag"))
check("output capped at 30", mineKeywordCandidates(manyDocs, SEEDS_WITH_26).length, 30)
check(
	"phrases never cross field boundaries (title+tag)",
	mineKeywordCandidates([entry("https://example.com/v1", "alpha beta", { tags: ["gamma delta"] })], []).some((c) =>
		["beta gamma", "beta gamma delta"].includes(c.value),
	),
	false,
)
check(
	"msTitle participates alongside title",
	mineKeywordCandidates([entry("https://example.com/v2", "plain title", { msTitle: "rare gem" })], []).some((c) => c.value === "rare gem"),
	true,
)

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
