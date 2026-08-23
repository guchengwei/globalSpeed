// Regression harness for #21: default Music Content TITLE_KEYWORD seeds "music" and "cover".
//
// Unlike stale-cache-invalidation.mjs (which must replicate its machinery because the seam is stateful),
// this fixture reads the seed values straight out of the DEFAULT_MUSIC_KEYWORDS literal in
// src/defaults/index.ts via a plain scan of the enabled TITLE_KEYWORD lines, then compiles them with the
// verbatim algorithm of src/contentScript/isolated/utils/exemption.ts (ASCII → \b regex, non-ASCII →
// substring). So the shipped seed list itself is what gets exercised — no copy to drift.
//
// Red/green evidence: pre-#21 both positives fail structurally (no "music"/"cover" seeds exist), and the
// negatives pin the #7 \b semantics that made bare "cover" safe to ship again: "musical" and "discovery"
// embed the keywords as substrings yet must never match.

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

console.log("== #21 default music keyword seed regression harness ==\n")
check(`seed list contains "music"`, keywordValues.includes("music"), true)
check(`seed list contains "cover"`, keywordValues.includes("cover"), true)
check(`"Relaxing Xenoblade Chronicles 3 Music" classifies as Music Content`, classifies("Relaxing Xenoblade Chronicles 3 Music"), true)
check(`"Beethoven cover" classifies as Music Content`, classifies("Beethoven Cover"), true)
check(`"musical" does NOT hit via boundary collision`, classifies("A Musical History Of Piano"), false)
check(`"discovery" does NOT hit via boundary collision`, classifies("Discovery Channel: Ocean Life"), false)
console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
