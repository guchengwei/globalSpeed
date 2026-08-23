// Regression harness for #27: version-stamped additive merge so shipped KosPresets seed expansions reach users
// whose preset arrays were persisted (any write to keepOriginalSpeed* keys freezes the then-current list forever,
// which caused the recurring "keywords limited" reports across #21/#22/#23 releases).
//
// Like music-keyword-seeds.mjs, this fixture reads the seed values straight out of the DEFAULT_* literals in
// src/defaults/index.ts via a plain scan, so the shipped seeds themselves are what gets exercised. The merge is
// replicated verbatim from src/background/utils/migrateSchema.ts (propagateKosSeeds) because the seam mutates a
// State object under a chrome-extension runtime. Source-level checks additionally pin the wiring: the State field,
// the getDefaultState stamp, and the migrateSchema call site must exist or the real extension would silently skip
// propagation.
//
// Red/green evidence: pre-#27 there is no kosSeedsVersion field, no merge function, and no call site, so every
// wiring check fails; behaviorally, an old persisted keyword list keeps missing later seeds ("mix", "the first
// take") after any number of passes. Post-fix the union appends exactly the missing defaults while user-added and
// user-disabled entries survive untouched, absent keys stay absent, and re-running is a no-op once stamped.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const defaultsSource = readFileSync(fileURLToPath(new URL("../../src/defaults/index.ts", import.meta.url)), "utf8")
const migrateSource = readFileSync(fileURLToPath(new URL("../../src/background/utils/migrateSchema.ts", import.meta.url)), "utf8")
const typesSource = readFileSync(fileURLToPath(new URL("../../src/types.ts", import.meta.url)), "utf8")

function parseSeedBlock(source, name) {
	const start = source.indexOf(`export const ${name}`)
	const end = source.indexOf("\n]", start)
	return [...source.slice(start, end).matchAll(/\{ type: "(DOMAIN|TITLE_KEYWORD)", value: "([^"]*)", enabled: (true|false) \}/g)].map((m) => ({
		type: m[1],
		value: m[2],
		enabled: m[3] === "true",
	}))
}

const DEFAULT_LIVE_PRESETS = parseSeedBlock(defaultsSource, "DEFAULT_LIVE_PRESETS")
const DEFAULT_MUSIC_KEYWORDS = parseSeedBlock(defaultsSource, "DEFAULT_MUSIC_KEYWORDS")
const DEFAULT_MUSIC_PRESETS = parseSeedBlock(defaultsSource, "DEFAULT_MUSIC_PRESETS")
const KOS_SEEDS_VERSION = Number(defaultsSource.match(/export const KOS_SEEDS_VERSION = (\d+)/)?.[1])

let failed = 0
function check(name, actual, expected) {
	const ok = actual === expected
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}
function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b)
}

// Verbatim propagateKosSeeds shape from migrateSchema.ts.
function propagateKosSeeds(state) {
	if ((state.kosSeedsVersion ?? 0) >= KOS_SEEDS_VERSION) return state

	const channels = [
		["keepOriginalSpeedLivePresets", DEFAULT_LIVE_PRESETS],
		["keepOriginalSpeedMusicKeywords", DEFAULT_MUSIC_KEYWORDS],
		["keepOriginalSpeedMusicPresets", DEFAULT_MUSIC_PRESETS],
	]

	channels.forEach(([key, seeds]) => {
		const stored = state[key]
		if (!Array.isArray(stored)) return

		const known = new Set(stored.map((entry) => `${entry.type}:${entry.value}`))
		seeds.forEach((seed) => {
			if (!known.has(`${seed.type}:${seed.value}`)) stored.push({ ...seed })
		})
	})

	state.kosSeedsVersion = KOS_SEEDS_VERSION
	return state
}

console.log("== #27 seed migration regression harness ==\n")

// Shipped-seed sanity: the parsed fixtures must be non-empty and the stamp present, else everything below proves nothing.
check("parsed live presets", DEFAULT_LIVE_PRESETS.length > 0, true)
check("parsed music keywords", DEFAULT_MUSIC_KEYWORDS.length > 0, true)
check("parsed music presets", DEFAULT_MUSIC_PRESETS.length > 0, true)
check("KOS_SEEDS_VERSION parses to a positive integer", Number.isInteger(KOS_SEEDS_VERSION) && KOS_SEEDS_VERSION > 0, true)

// Wiring pins: without these the merge exists but never runs.
check("types.ts declares kosSeedsVersion?: number on State", /kosSeedsVersion\?: number/.test(typesSource), true)
check("getDefaultState stamps kosSeedsVersion", defaultsSource.includes("kosSeedsVersion: KOS_SEEDS_VERSION"), true)
check("migrateSchema imports KOS_SEEDS_VERSION", /import \{[^}]*KOS_SEEDS_VERSION[^}]*\} from "\.\.\/\.\.\/defaults"/.test(migrateSource), true)
check("migrateSchema calls propagateKosSeeds", /^	state = propagateKosSeeds\(state\)$/m.test(migrateSource), true)

// Old-version simulation: a keyword list frozen before the #23/#26 expansions, plus a live list missing one seeded domain.
const missingKeywords = ["mix", "the first take", "歌回"].map((value) => DEFAULT_MUSIC_KEYWORDS.find((s) => s.value === value))
const oldKeywords = DEFAULT_MUSIC_KEYWORDS.filter((s) => !missingKeywords.some((m) => m.value === s.value))
const missingLive = [DEFAULT_LIVE_PRESETS.find((s) => s.value === "www.huya.com")]
const oldLive = DEFAULT_LIVE_PRESETS.filter((s) => !missingLive.some((m) => m.value === s.value))

const oldState = {
	version: 15,
	kosSeedsVersion: undefined, // stored before the field existed
	keepOriginalSpeedLivePresets: [...oldLive.map((e) => ({ ...e })), { type: "DOMAIN", value: "my-live.example", enabled: true }],
	// Same list with "cover" hand-disabled in the editor, plus one user-added keyword.
	keepOriginalSpeedMusicKeywords: [
		...oldKeywords.map((e) => (e.value === "cover" ? { ...e, enabled: false } : { ...e })),
		{ type: "TITLE_KEYWORD", value: "my custom jam", enabled: true },
	],
	// keepOriginalSpeedMusicPresets deliberately absent: fallback already covers it.
}

const merged = propagateKosSeeds(oldState)

check("migration stamps kosSeedsVersion", merged.kosSeedsVersion, KOS_SEEDS_VERSION)

const kw = merged.keepOriginalSpeedMusicKeywords
check(
	"user-added entry preserved",
	kw.some((e) => e.value === "my custom jam" && e.enabled),
	true,
)
check("user-disabled default preserved as disabled", kw.filter((e) => e.value === "cover").length, 1)
check("disabled entry not flipped by its own re-add", kw.find((e) => e.value === "cover").enabled, false)
for (const m of missingKeywords) {
	check(
		`missing default "${m.value}" appended`,
		kw.some((e) => e.type === m.type && e.value === m.value && e.enabled === m.enabled),
		true,
	)
}
check(`exactly ${missingKeywords.length} keywords appended`, kw.length, oldKeywords.length + 1 + missingKeywords.length)
check("appended defaults land at the tail in shipped order", same(kw.slice(-missingKeywords.length), missingKeywords), true)
check(
	"pre-existing entries byte-identical",
	same(kw.slice(0, oldKeywords.length + 1), [
		...oldKeywords.map((e) => (e.value === "cover" ? { ...e, enabled: false } : { ...e })),
		{ type: "TITLE_KEYWORD", value: "my custom jam", enabled: true },
	]),
	true,
)

check("missing live default appended after user entry", same(merged.keepOriginalSpeedLivePresets.at(-1), missingLive[0]), true)
check("absent preset key left absent", Object.hasOwn(merged, "keepOriginalSpeedMusicPresets"), false)
check("other state fields untouched", merged.version, 15)

// Idempotency: stamped states skip entirely, and even bypassing the stamp the union adds nothing twice.
const snapshot = structuredClone(merged)
propagateKosSeeds(merged)
check("re-run on stamped state is a no-op", same(structuredClone(merged), snapshot), true)

const unguarded = structuredClone({ ...merged, kosSeedsVersion: undefined })
propagateKosSeeds(unguarded)
propagateKosSeeds(unguarded)
check("union itself adds nothing twice", same(structuredClone(unguarded), snapshot), true)

// Fresh installs ship complete, stamped lists: the merge must pass them through unchanged.
const fresh = { version: 15, kosSeedsVersion: KOS_SEEDS_VERSION, keepOriginalSpeedMusicKeywords: DEFAULT_MUSIC_KEYWORDS.map((e) => ({ ...e })) }
propagateKosSeeds(fresh)
check("fresh install unaffected", same(fresh.keepOriginalSpeedMusicKeywords, DEFAULT_MUSIC_KEYWORDS), true)

// Forward compatibility: a stamp from a hypothetical future bump must not be downgraded or rewritten.
const future = { kosSeedsVersion: KOS_SEEDS_VERSION + 1, keepOriginalSpeedMusicKeywords: [] }
propagateKosSeeds(future)
check("newer stamp skipped, not downgraded", future.kosSeedsVersion, KOS_SEEDS_VERSION + 1)

// Documented v1 tradeoff (#27): removing a previously-shipped default resurfaces on upgrade.
const removedDefault = propagateKosSeeds({
	kosSeedsVersion: undefined,
	keepOriginalSpeedMusicKeywords: [], // every shipped seed deleted by hand
})
check(
	"removed shipped default resurfaces",
	removedDefault.keepOriginalSpeedMusicKeywords.some((e) => e.value === "remix"),
	true,
)

// Identity is the type+value pair: the same string under the other channel's type is still appended.
const crossType = propagateKosSeeds({
	kosSeedsVersion: undefined,
	keepOriginalSpeedMusicKeywords: [{ type: "TITLE_KEYWORD", value: "soundcloud.com", enabled: true }],
	keepOriginalSpeedMusicPresets: [],
})
check(
	"same value under a different type does not suppress the DOMAIN seed",
	crossType.keepOriginalSpeedMusicPresets.some((e) => e.value === "soundcloud.com" && e.type === "DOMAIN"),
	true,
)
check(
	"present-but-empty array is repopulated",
	DEFAULT_MUSIC_KEYWORDS.every((s) => crossType.keepOriginalSpeedMusicKeywords.some((e) => same(e, s))),
	true,
)

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
