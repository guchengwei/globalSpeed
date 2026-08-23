// Regression harness for #21/#22/#23/#26: default Music Content TITLE_KEYWORD seeds "music"/"cover" (#21) and
// "音楽"/"カバー" (#22), the #22 YouTube Mix-context signal (list=RD*), the #23 trilingual expansion (EN/JP/CN
// batches), and the #26 franchise-format seed "the first take".
//
// Unlike stale-cache-invalidation.mjs (which must replicate its machinery because the seam is stateful),
// this fixture reads the seed values straight out of the DEFAULT_MUSIC_KEYWORDS literal in
// src/defaults/index.ts via a plain scan of the enabled TITLE_KEYWORD lines, then compiles them with the
// verbatim algorithm of src/contentScript/isolated/utils/exemption.ts (ASCII → \b regex, non-ASCII →
// substring). So the shipped seed list itself is what gets exercised — no copy to drift.
//
// Red/green evidence: pre-#21 both positives fail structurally (no "music"/"cover" seeds exist), and the
// negatives pin the #7 \b semantics that made bare "cover" safe to ship again: "musical" and "discovery"
// embed the keywords as substrings yet must never match. Pre-#22 no JP seeds exist (音楽/カバー miss) and a
// Mix watch URL classifies only via this signal: list=RD… hits, while PL lists and bare watch URLs must not.
// Pre-#23 the trilingual positives miss and the count assertion fails; the #23 negatives pin both matcher
// semantics — EN words stay boundary-bound ("mixed martial arts" must not hit via "mix") while CJK runs as
// substrings yet still needs its excluded candidates out of the list ("フルーツ" would hit a bare "フル").

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const defaultsSource = readFileSync(fileURLToPath(new URL("../../src/defaults/index.ts", import.meta.url)), "utf8")

// Verbatim compileKeywordMatcher shape from exemption.ts.
function compileKeywordMatcher(value) {
	value = (value || "").trim().toLowerCase()
	if (!value) return {}
	if (/[^\x00-\x7F]/.test(value)) return { substring: value }
	return { regex: new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) }
}

const keywordValues = [...defaultsSource.matchAll(/type: "TITLE_KEYWORD", value: "([^"]+)", enabled: true/g)].map((m) => m[1])
const matchers = keywordValues.map(compileKeywordMatcher).filter((m) => m.regex || m.substring)

let failed = 0
function check(name, actual, expected) {
	const ok = actual === expected
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

// Haystack shape per exemption.ts matchesMusicKeyword(): each source lowercased before matching.
function classifies(title) {
	const sources = [title.toLowerCase()]
	return matchers.some((matcher) =>
		matcher.regex ? sources.some((source) => matcher.regex.test(source)) : sources.some((source) => source.includes(matcher.substring)),
	)
}

// Verbatim youTubeMixContextPresent() shape from exemption.ts: YouTube-host guard, then URLSearchParams over
// location.search with an exact "RD" prefix on the list param.
function mixContextExempts(hostname, search) {
	const onYouTube = hostname === "youtube.com" || hostname.endsWith(".youtube.com")
	if (!onYouTube) return false
	return (new URLSearchParams(search).get("list") || "").startsWith("RD")
}

console.log("== #21/#22/#23 default music keyword seed regression harness ==\n")
check(`seed list contains "music"`, keywordValues.includes("music"), true)
check(`seed list contains "cover"`, keywordValues.includes("cover"), true)
check(`seed list contains "音楽"`, keywordValues.includes("音楽"), true)
check(`seed list contains "カバー"`, keywordValues.includes("カバー"), true)
check(`seed count is at least 69`, keywordValues.length >= 69, true)
check(`seed list contains "the first take"`, keywordValues.includes("the first take"), true)

// #23 verbatim addition batches (docs/music-keywords.md is the curation record). The scan above only picks
// enabled:true lines, so presence here proves both presence and enabled state.
const trilingualAdditions = {
	EN: [
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
	],
	JP: ["歌ってみた", "弾いてみた", "踊ってみた", "作業用BGM", "ボカロ", "VOCALOID", "ミュージック", "歌詞", "邦楽", "洋楽", "アニソン", "メドレー"],
	CN: ["原创", "单曲", "新歌", "热歌", "金曲", "歌曲", "伴奏", "原声", "演奏", "全曲", "曲目", "卡拉OK", "KTV", "音乐现场", "歌回"],
}
for (const [lang, values] of Object.entries(trilingualAdditions)) {
	for (const value of values) check(`${lang} addition "${value}" present and enabled`, keywordValues.includes(value), true)
}

// #23 positives per language.
check(`"Nightcore Edit of Blinding Lights" classifies via EN nightcore seed`, classifies("Nightcore Edit of Blinding Lights"), true)
check(`"Dynamite M/V" classifies via literal m/v seed`, classifies("Dynamite M/V"), true)
check(`"DJ Mix - Summer Club Anthems" hits via boundary-bound mix seed`, classifies("DJ Mix - Summer Club Anthems"), true)
check(`"【初音ミク】ボカロメドレー" classifies via JP seeds`, classifies("【初音ミク】ボカロメドレー"), true)
check(`"作業用BGM 落ち着く曲集" classifies via mixed-script JP seed`, classifies("作業用BGM 落ち着く曲集"), true)
check(`"KTV点歌 经典老歌" classifies via CN KTV seed flush against CJK`, classifies("KTV点歌 经典老歌"), true)
check(`"经典金曲原创伴奏合集" classifies via CJK substring semantics`, classifies("经典金曲原创伴奏合集"), true)
// #23 negatives: EN word boundaries must hold, and excluded-risky candidates must stay out even under substring semantics.
check(`"mixed martial arts" does NOT hit via boundary collision on mix`, classifies("Mixed Martial Arts Championship"), false)
check(`"フルーツ" does NOT hit (bare フル deliberately excluded)`, classifies("フルーツポンチの冒険"), false)
check(`"Relaxing Xenoblade Chronicles 3 Music" classifies as Music Content`, classifies("Relaxing Xenoblade Chronicles 3 Music"), true)
check(`"Beethoven cover" classifies as Music Content`, classifies("Beethoven Cover"), true)
check(`"musical" does NOT hit via boundary collision`, classifies("A Musical History Of Piano"), false)
check(`"discovery" does NOT hit via boundary collision`, classifies("Discovery Channel: Ocean Life"), false)
check(`"【和訳】Drifting Soul 音楽" classifies via JP seed`, classifies("【和訳】Drifting Soul 音楽"), true)
check(`"歌ってみたカバー集" classifies via JP cover seed`, classifies("歌ってみたカバー集"), true)
check(`"Aimer - Zankyou Sanka / The First Take" classifies via #26 franchise seed`, classifies("Aimer - Zankyou Sanka / The First Take"), true)
check(`watch URL with list=RD… classifies via Mix context`, mixContextExempts("www.youtube.com", "?v=x&list=RD54yKHYSwJcQ"), true)
check(`same video with list=PL… does NOT hit via Mix context`, mixContextExempts("www.youtube.com", "?v=x&list=PLxyz789"), false)
check(`bare watch URL without list does NOT hit via Mix context`, mixContextExempts("www.youtube.com", "?v=x"), false)
console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
