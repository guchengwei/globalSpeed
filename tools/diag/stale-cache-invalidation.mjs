// Regression harness for #18: stale Keep Original Speed classification caches across SPA media reuse.
//
// Replication note (honest): this script REPLICATES the match-source machinery of
// src/contentScript/isolated/utils/exemption.ts (keyword compilation, platform-tag TTL probe,
// raw-title compare keys, classifyExempt music channel), the edge/reset bookkeeping of
// shouldSkipEnforcement, and the MAIN-world reportMediaCategory memo — adapted to plain JS with an
// injectable clock and a world object standing in for document/navigator/location. The source is
// TypeScript with bundler path aliases, so a standalone node run cannot import it. Keep this copy
// in sync with the source; drift here means the fixture no longer guards the shipped classifier.
//
// Red/green evidence: Seq A's pre-fix leg IS mechanically faithful — pre-fix, the category push
// cache has no invalidation trigger on element reuse (wiggleOn fires once per element ever, see
// main/index.ts mediaReferences dedup), so a stale "Music" classifies forever. That is a true
// structural red. Seq B's pre-fix leg is red through the tag TTL gate (a real shipped mechanic:
// currentTagSource serves its cached join for up to 1s regardless of content change); the
// title/mediaSession memos self-heal on value change in BOTH eras, so the fix's raw-key resets are
// hygiene there, asserted as such. Each sequence asserts the pre-fix STALE outcome (red reproduced)
// and the post-fix CLEAN outcome (green) against identical world evolution.
//
// Debounce modeling: the shipped trigger is lodash.debounce(500, trailing) inside MediaTower; here
// the trailing-edge contract is simulated by advancing the clock past the quiet window. Coalescing
// (one bridge message per burst) is asserted explicitly.

const DEBOUNCE_MS = 500
const TAG_TTL_MS = 1000

// World stands in for document / navigator / location / ytInitialPlayerResponse.
function makeWorld() {
	return {
		hostname: "www.youtube.com",
		docTitle: "",
		mediaSessionTitle: "",
		tags: [],
		pageCategory: undefined, // ytInitialPlayerResponse microformat category
	}
}

// Representative DEFAULT_MUSIC_KEYWORDS subset (ASCII boundary + CJK substring cases), compiled with the verbatim algorithm.
const KEYWORD_VALUES = ["playlist", "mv", "lyrics", "歌单", "音乐", "合集"]

function compileKeywordMatcher(value) {
	value = (value || "").trim().toLowerCase()
	if (!value) return {}
	if (/[^\x00-\x7F]/.test(value)) return { substring: value }
	return { regex: new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) }
}

function onPlayerHost(hostname) {
	return (
		hostname === "youtube.com" ||
		hostname.endsWith(".youtube.com") ||
		hostname === "bilibili.com" ||
		hostname.endsWith(".bilibili.com")
	)
}

// Builds the classifier replica. `fixed` selects the shipped-at-HEAD wiring (no invalidation seam,
// memo-gated-only category reporting); otherwise the #18 wiring is active. All other mechanics are
// identical in both configurations — the delta below is exactly the shipped diff.
function makeClassifier(world, clock, fixed) {
	const musicKeywordMatchers = KEYWORD_VALUES.map(compileKeywordMatcher).filter((m) => m.regex || m.substring)
	const musicDomainPresets = [] // no DOMAIN hits: keeps the sequence purely on category/keyword channels
	const liveChannelEnabled = false
	const musicChannelEnabled = true

	let mediaCategory = null
	let docTitleRaw = null
	let mediaTitleRaw = null
	let tagsCheckedAt = 0
	let tagsRawKey = null
	let tagsJoined = ""
	const matchSources = ["", "", ""]
	let reportedCategory

	function extractPlatformTags() {
		// Verbatim guard shape; the meta[name=keywords]/DOM parsing itself is stood in by world.tags.
		if (!onPlayerHost(world.hostname)) return []
		if (world.hostname === "youtube.com" || world.hostname.endsWith(".youtube.com")) return world.tags
		return []
	}

	function currentTagSource() {
		const now = clock()
		if (now - tagsCheckedAt >= TAG_TTL_MS) {
			tagsCheckedAt = now
			const tags = extractPlatformTags()
			const rawKey = tags.join("\n")
			if (rawKey !== tagsRawKey) {
				tagsRawKey = rawKey
				tagsJoined = tags.map((tag) => tag.toLowerCase()).join(", ")
			}
		}
		return tagsJoined
	}

	function currentMatchSources() {
		const docTitle = world.docTitle ?? ""
		const mediaTitle = world.mediaSessionTitle || ""
		if (docTitle !== docTitleRaw) {
			docTitleRaw = docTitle
			matchSources[0] = docTitle.toLowerCase()
		}
		if (mediaTitle !== mediaTitleRaw) {
			mediaTitleRaw = mediaTitle
			matchSources[1] = mediaTitle.toLowerCase()
		}
		matchSources[2] = currentTagSource()
		return matchSources
	}

	// NEW in #18: drops the compare keys so the next pass re-reads every source, and expires the tag probe.
	function invalidateMatchSources() {
		if (!fixed) return // pre-fix: no such seam exists
		docTitleRaw = null
		mediaTitleRaw = null
		tagsCheckedAt = 0
	}

	function matchesMusicKeyword() {
		if (!musicKeywordMatchers.length) return false
		const sources = currentMatchSources()
		return musicKeywordMatchers.some((matcher) =>
			matcher.regex ? sources.some((source) => matcher.regex.test(source)) : sources.some((source) => source.includes(matcher.substring)),
		)
	}

	function setMusicCategory(category) {
		mediaCategory = category
	}

	function classifyExempt() {
		return musicChannelEnabled && (musicDomainPresets.some(() => false) || mediaCategory === "Music" || matchesMusicKeyword())
	}

	// MAIN-world reportMediaCategory. Pre-fix: string-only, memo-gated. Post-fix (#18): forced probes bypass the memo once and also report a now-category-less page as null.
	function reportMediaCategory(force = false) {
		if (!fixed && force) throw new Error("forced probes do not exist pre-fix")
		const category = world.pageCategory
		if (!force && (typeof category !== "string" || category === reportedCategory)) return false
		// Sends MEDIA_CATEGORY over the bridge; the isolated side consumes it verbatim (bridge roundtrip collapsed):
		handleMediaCategoryMsg(typeof category === "string" ? category : null)
		return true
	}

	// Isolated-world ConfigSync.handleMediaCategoryMsg, verbatim.
	function handleMediaCategoryMsg(value) {
		reportedCategory = typeof value === "string" ? value : undefined
		setMusicCategory(value)
	}

	// shouldSkipEnforcement edge bookkeeping, verbatim shape (WeakMap → Map so tests can inspect size). Counts one-time native-rate resets on exempt entry.
	const exemptElements = new Map()
	let explicitOverride = false
	const stats = { resets: 0, flips: 0 }
	function shouldSkipEnforcement(elem) {
		const exempt = classifyExempt()
		if ((exemptElements.get(elem) ?? false) !== exempt) {
			exemptElements.set(elem, exempt)
			stats.flips++
			explicitOverride = false
			if (exempt) stats.resets++
		}
		return exempt && !explicitOverride
	}

	return { classifyExempt, invalidateMatchSources, reportMediaCategory, handleMediaCategoryMsg, shouldSkipEnforcement, stats, matchSources }
}

let failed = 0
function check(name, actual, expected) {
	const ok = actual === expected
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

// ---------------------------------------------------------------------------
// Seq A — stale "Music" category across navigation must NOT exempt a clean-input video.
// World evolution is IDENTICAL for both legs; only the wiring differs.
// ---------------------------------------------------------------------------
function seqA(fixed) {
	const label = fixed ? "post-fix" : "pre-fix "
	const world = makeWorld()
	let now = 10_000
	const clock = () => now
	const c = makeClassifier(world, clock, fixed)
	const elem = { name: "reused <video>" }

	// Music-category watch page; element wiggles ONCE here (mediaReferences dedups later plays).
	world.docTitle = "Relaxing 歌单 Mix - 经典 音乐 合集"
	world.tags = ["音乐", "歌单"]
	world.pageCategory = "Music"
	c.reportMediaCategory() // document_start / first-wiggle report
	check(`[${label}] Seq A music page classifies exempt`, c.classifyExempt(), true)
	c.shouldSkipEnforcement(elem)

	// SPA navigation onto a recipe video: SAME element, fresh inputs, no second wiggle.
	world.docTitle = "Beef Brisket Recipe - How to Cook Brisket"
	world.tags = ["cooking", "brisket", "recipe"]
	world.pageCategory = "Howto & Style"

	if (!fixed) {
		// No lifecycle wiring existed: caches keep serving the previous page.
		now += 1500 // well past the tag TTL: isolates the category cache as the sole stale source
		for (let i = 0; i < 3; i++) c.shouldSkipEnforcement(elem)
		check(`[${label}] Seq A RED: stale category keeps recipe video exempt`, c.shouldSkipEnforcement(elem), true)
		check(`[${label}] Seq A RED: exactly one reset total (entry only, no flip churn)`, c.stats.resets, 1)
		return
	}

	// emptied + loadedmetadata fire: immediate cheap invalidation, one debounced re-probe pending.
	c.invalidateMatchSources()
	c.invalidateMatchSources()
	now += 50
	check(`[${label}] Seq A transient: within debounce window category still pends re-probe`, c.shouldSkipEnforcement(elem), true)

	// Burst settled (~500ms): debounced MEDIA_CATEGORY_REPROBE → forced report delivers the new category.
	now += DEBOUNCE_MS
	c.invalidateMatchSources()
	c.reportMediaCategory(true)
	for (let i = 0; i < 3; i++) c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq A GREEN: recipe video not exempt after invalidation`, c.shouldSkipEnforcement(elem), false)
	check(`[${label}] Seq A GREEN: keyword sources re-read clean (title slot)`, c.matchSources[0], "beef brisket recipe - how to cook brisket")
	check(`[${label}] Seq A GREEN: tag slot refreshed`, c.matchSources[2], "cooking, brisket, recipe")
	check(`[${label}] Seq A exactly one native-rate reset (initial music entry only)`, c.stats.resets, 1)

	// Edge bookkeeping untouched: flipping inputs back re-arms normally (one more entry reset).
	world.pageCategory = "Music"
	c.reportMediaCategory(true)
	check(`[${label}] Seq A re-arm: classification flips back on real signal`, c.shouldSkipEnforcement(elem), true)
	check(`[${label}] Seq A re-arm produced exactly one more entry reset`, c.stats.resets, 2)
}

// ---------------------------------------------------------------------------
// Seq B — stale mediaSession/tag sources must not keep matching after invalidation.
// Pre-fix red rides the REAL tag TTL gate (cached tag join survives content change for up to 1s);
// title/mediaSession memos self-heal in both eras, so their reset is hygiene, asserted directly.
// ---------------------------------------------------------------------------
function seqB(fixed) {
	const label = fixed ? "post-fix" : "pre-fix "
	const world = makeWorld()
	let now = 20_000
	const clock = () => now
	const c = makeClassifier(world, clock, fixed)
	const elem = { name: "reused <video>" }

	// Playlist page: keyword hits come from title + tags; no category involved.
	world.docTitle = "【4K】xxx 歌单 xxx 经典金曲合集"
	world.tags = ["音乐", "MV"]
	world.mediaSessionTitle = "xxx 歌单 xxx"
	now += 2000 // prime the tag probe with the music-page tags
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq B music page classifies exempt via keywords`, c.classifyExempt(), true)

	// Navigation: title/tags swap immediately; mediaSession republishes the clean value too (platform did move on).
	world.docTitle = "Top 10 Kitchen Mistakes - Home Cooking Basics"
	world.tags = ["cooking", "howto"]
	world.mediaSessionTitle = "Top 10 Kitchen Mistakes"

	// Advance less than the tag TTL so the pre-fix probe is still inside its stale window.
	now += 400

	if (!fixed) {
		for (let i = 0; i < 3; i++) c.shouldSkipEnforcement(elem)
		check(`[${label}] Seq B RED: cached tag join still matches after content change`, c.shouldSkipEnforcement(elem), true)
		check(`[${label}] Seq B RED: stale tag haystack served`, c.matchSources[2].includes("音乐"), true)

		// Even pre-fix, the TTL eventually heals — the window is the bug, not foreverness here.
		now += TAG_TTL_MS
		c.shouldSkipEnforcement(elem)
		check(`[${label}] Seq B pre-fix heals only after TTL expiry`, c.shouldSkipEnforcement(elem), false)
		return
	}

	// emptied/loadedmetadata invalidation expires the tag probe immediately.
	c.invalidateMatchSources()
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq B GREEN: not exempt on first pass after invalidation`, c.shouldSkipEnforcement(elem), false)
	check(`[${label}] Seq B GREEN: tag slot re-probed fresh`, c.matchSources[2], "cooking, howto")
	check(`[${label}] Seq B GREEN: title slot re-read fresh`, c.matchSources[0], "top 10 kitchen mistakes - home cooking basics")

	// Hygiene property: the raw-key reset forces the mediaSession slot back onto the CURRENT world value.
	check(`[${label}] Seq B GREEN: mediaSession slot reflects current metadata`, c.matchSources[1], "top 10 kitchen mistakes")
}

// ---------------------------------------------------------------------------
// Burst safety — repeated emptied/loadedmetadata bursts: no repeated 1x resets, one bridge message per burst.
// ---------------------------------------------------------------------------
function seqBurst() {
	const world = makeWorld()
	let now = 30_000
	const clock = () => now
	const c = makeClassifier(world, clock, true)
	const elem = { name: "burst target" }

	// Clean VOD, never exempt: invalidation must not conjure classifications or resets.
	world.docTitle = "A Quiet Documentary About Bridges"
	world.tags = ["documentary"]

	// Three bursts, each a rapid emptied/loadedmetadata pair inside the debounce window.
	let reprobes = 0
	let pendingDebounce = false
	function handleContentChange() {
		c.invalidateMatchSources()
		pendingDebounce = true
	}
	for (let burst = 0; burst < 3; burst++) {
		handleContentChange() // emptied
		handleContentChange() // loadedmetadata
		now += 50
		c.shouldSkipEnforcement(elem)
		now += DEBOUNCE_MS // quiet window elapses: trailing edge fires once
		if (pendingDebounce) {
			pendingDebounce = false
			c.invalidateMatchSources()
			c.reportMediaCategory(true)
			reprobes++
		}
		c.shouldSkipEnforcement(elem)
	}
	check(`[burst] one re-probe per settled burst (3 bursts)`, reprobes, 3)
	check(`[burst] zero native-rate resets on a never-exempt element`, c.stats.resets, 0)
	check(`[burst] zero classification flips (invalidation alone moves nothing)`, c.stats.flips, 0)

	// Rapid-fire single burst: 8 events coalesce into exactly one trailing re-probe.
	reprobes = 0
	for (let i = 0; i < 8; i++) handleContentChange()
	check(`[burst] 8-event burst still classified non-exempt mid-debounce`, c.shouldSkipEnforcement(elem), false)
	now += DEBOUNCE_MS
	if (pendingDebounce) {
		pendingDebounce = false
		c.invalidateMatchSources()
		reprobes++
	}
	check(`[burst] 8-event burst coalesces to one re-probe`, reprobes, 1)
}

console.log("== #18 stale-cache invalidation regression harness ==\n")
seqA(false)
seqA(true)
seqB(false)
seqB(true)
seqBurst()
console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
