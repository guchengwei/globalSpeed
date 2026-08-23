// Regression harness for #18 (stale Keep Original Speed caches across SPA media reuse), #20 (mediaSession title source goes stale across Bilibili SPA navs), #25 (category freshness decoupled from element lifecycle via a periodic self-check), and #31 (category read via the live player response + yt-navigate-finish).
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
// Seq C (#20): the red leg rides a TRUE structural red against post-#18 code — Bilibili never
// updates navigator.mediaSession.metadata.title across SPA navigations, so #18's invalidation
// re-reads the SAME stale OST string forever and the switched-to video stays Exempt indefinitely.
// The green leg gates the mediaSession slot behind a YouTube-host check: off YouTube the sources
// shrink to title + tags, navigator.mediaSession is never touched, and the stale string cannot
// reach the matcher.
//
// Seq D (#25): the red leg rides a TRUE structural red against post-#18/#20 code — MSE-based YT
// players swap SourceBuffers on SPA navs, so emptied/loadedmetadata never fire and NOTHING ever
// re-reads the category after document_start: a category that appears or vanishes mid-document is
// invisible forever (the TF-T chip-missing symptom). The green leg adds the shipped #25 wiring: a
// 2s StratumClient self-check interval that runs the unforced read for the document lifetime.
// Timer simulation: ticks fire at exact SELF_CHECK_MS spacing on virtual-clock advancement and call
// reportMediaCategory() unforced; pre-#25 the driver is inert because no timer existed. The
// unforced memo compares normalized values (string | undefined), so unchanged values send nothing
// and →null clears; sends are counted at the bridge (handleMediaCategoryMsg) to prove exact-once.
//
// Seq E (#31): window.ytInitialPlayerResponse is assigned once per document load and NEVER
// reassigned across YouTube SPA navigations, so post-#25 code still re-reads a stale global
// forever. The red leg rides that TRUE structural red — the global stays "Music" while each
// navigation's real category flips Music→People & Blogs→Music, no lifecycle events fire, and the
// #25 timer faithfully re-reads the SAME stale global every tick (zero messages, exemption frozen).
// The green leg adds the shipped #31 wiring: reportMediaCategory reads through readCategory — the
// live player element's getPlayerResponse() first (fresh per navigation), the document-load global
// as fallback — plus a yt-navigate-finish listener running the same unforced report path. The
// navigate event is simulated as firing once right after each navigation commits its world change;
// classification must follow each flip within one probe period, with exactly one bridge message
// per flip.
//
// Debounce modeling: the shipped trigger is lodash.debounce(500, trailing) inside MediaTower; here
// the trailing-edge contract is simulated by advancing the clock past the quiet window. Coalescing
// (one bridge message per burst) is asserted explicitly.

const DEBOUNCE_MS = 500
const TAG_TTL_MS = 1000
const SELF_CHECK_MS = 2000

// World stands in for document / navigator / location / ytInitialPlayerResponse / #movie_player.
function makeWorld() {
	return {
		hostname: "www.youtube.com",
		docTitle: "",
		mediaSessionTitle: "",
		tags: [],
		pageCategory: undefined, // window.ytInitialPlayerResponse microformat category (assigned once per document load, never reassigned)
		playerCategory: undefined, // #movie_player.getPlayerResponse() microformat category (refreshed per SPA navigation)
		mediaSessionReads: 0, // counts every navigator.mediaSession consultation (proof surface for #20)
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

function hostMatchesDomain(hostname, domain) {
	return hostname === domain || hostname.endsWith(`.${domain}`)
}

function isYouTubeHost(hostname) {
	return hostMatchesDomain(hostname, "youtube.com")
}

function onPlayerHost(hostname) {
	return isYouTubeHost(hostname) || hostMatchesDomain(hostname, "bilibili.com")
}

// Builds the classifier replica. `fixed` selects the shipped-at-HEAD wiring (no invalidation seam,
// memo-gated-only category reporting); otherwise the #18 wiring is active. `msScoped` selects the
// #20 mediaSession host gate; pre-#20 wiring reads the metadata title unconditionally on every host.
// `livePlayer` selects the #31 readCategory source chain (live player object first, document-load
// global as fallback); pre-#31 wiring reads the global alone. All other mechanics are identical in
// both configurations — each flag's delta below is exactly the shipped diff.
function makeClassifier(world, clock, fixed, msScoped, livePlayer) {
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
	let matchSources = null // resolved lazily: 3 slots unconditional pre-#20, host-shaped after
	let reportedCategory

	function extractPlatformTags() {
		// Verbatim guard shape; the meta[name=keywords] parsing (YouTube) and the DOM tag-link
		// querySelectors (Bilibili) are both stood in by world.tags.
		if (!onPlayerHost(world.hostname)) return []
		if (isYouTubeHost(world.hostname)) return world.tags
		if (hostMatchesDomain(world.hostname, "bilibili.com")) return world.tags
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
		// #20 wiring: host is constant per document, so the slot layout resolves once —
		// [title, mediaSession, tags] on YouTube, [title, tags] elsewhere. Pre-#20: unconditional 3 slots.
		const onYouTube = isYouTubeHost(world.hostname)
		if (msScoped) matchSources ??= onYouTube ? ["", "", ""] : ["", ""]
		else matchSources ??= ["", "", ""]
		const docTitle = world.docTitle ?? ""
		if (docTitle !== docTitleRaw) {
			docTitleRaw = docTitle
			matchSources[0] = docTitle.toLowerCase()
		}
		if (!msScoped || onYouTube) {
			// navigator.mediaSession consultation counter: every read of the metadata title counts.
			world.mediaSessionReads++
			const mediaTitle = world.mediaSessionTitle || ""
			if (mediaTitle !== mediaTitleRaw) {
				mediaTitleRaw = mediaTitle
				matchSources[1] = mediaTitle.toLowerCase()
			}
			matchSources[2] = currentTagSource()
		} else {
			matchSources[1] = currentTagSource()
		}
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

	// MAIN-world reportMediaCategory. Pre-fix: string-only, memo-gated. Post-fix (#18): forced probes bypass the memo once and also report a now-category-less page as null. Post-#25: every unforced path (document_start, wiggle, self-check tick) memo-compares normalized values (string | undefined), so unchanged values send nothing and →null clears stale categories. Post-#31: every path reads through readCategory — live player response first (#movie_player.getPlayerResponse(), fresh per navigation), document-load global as fallback; pre-#31 the global alone.
	function readCategory() {
		if (livePlayer) {
			const live = world.playerCategory
			if (typeof live === "string") return live
		}
		const global = world.pageCategory
		return typeof global === "string" ? global : undefined
	}

	function reportMediaCategory(force = false) {
		if (!fixed && force) throw new Error("forced probes do not exist pre-fix")
		const next = readCategory()
		if (!force && next === reportedCategory) return false
		// Sends MEDIA_CATEGORY over the bridge; the isolated side consumes it verbatim (bridge roundtrip collapsed):
		handleMediaCategoryMsg(next)
		return true
	}

	// Isolated-world ConfigSync.handleMediaCategoryMsg, verbatim.
	function handleMediaCategoryMsg(value) {
		stats.sends++ // one bridge message per report — the no-message-spam proof surface for #25
		reportedCategory = typeof value === "string" ? value : undefined
		setMusicCategory(value)
	}

	// shouldSkipEnforcement edge bookkeeping, verbatim shape (WeakMap → Map so tests can inspect size). Counts one-time native-rate resets on exempt entry.
	const exemptElements = new Map()
	let explicitOverride = false
	const stats = { resets: 0, flips: 0, sends: 0 }
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

	// matchSources is resolved lazily (shape depends on wiring/host), so expose the live array.
	return {
		classifyExempt,
		invalidateMatchSources,
		reportMediaCategory,
		handleMediaCategoryMsg,
		shouldSkipEnforcement,
		stats,
		get matchSources() {
			return matchSources
		},
	}
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
	// Pre-#18 eras predate #20's host gate; the shipped post-#18 classifier includes it.
	const c = makeClassifier(world, clock, fixed, fixed)
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
	// Pre-#18 eras predate #20's host gate; the shipped post-#18 classifier includes it.
	const c = makeClassifier(world, clock, fixed, fixed)
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
// Seq C (#20) — stale mediaSession title on a host that never refreshes it (Bilibili SPA navs).
// The switched-to video's docTitle/tags are clean; navigator.mediaSession still carries the
// previous MV's OST title. #18 invalidation re-reads it faithfully — and re-matches it. World
// evolution is IDENTICAL for both legs; only the mediaSession wiring differs.
// ---------------------------------------------------------------------------
function seqC(msScoped) {
	const label = msScoped ? "post-scope" : "pre-scope "
	const world = makeWorld()
	world.hostname = "www.bilibili.com"
	let now = 40_000
	const clock = () => now
	const c = makeClassifier(world, clock, true, msScoped)
	const elem = { name: "reused <video>" }

	// Music MV page: exempt via keywords (title/tags/mediaSession all carry music signals).
	world.docTitle = "【4K】经典金曲 MV 合集 高清修复"
	world.tags = ["音乐", "MV"]
	world.mediaSessionTitle = "「xxx」原声音乐集 Disc1-6"
	now += 2000 // prime the tag probe with the music-page tags
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq C MV page classifies exempt via keywords`, c.classifyExempt(), true)
	c.shouldSkipEnforcement(elem)

	// SPA navigation onto an unrelated game video. Bilibili swaps title/tags but NEVER updates
	// mediaSession metadata — the OST string from the previous MV survives.
	world.docTitle = "【火焰纹章：风花雪月】剧情CG 解说"
	world.tags = ["火焰纹章", "风花雪月"]

	// emptied + loadedmetadata fire, then the debounced trailing edge settles.
	c.invalidateMatchSources()
	c.invalidateMatchSources()
	now += 50
	now += DEBOUNCE_MS
	c.invalidateMatchSources()
	for (let i = 0; i < 3; i++) c.shouldSkipEnforcement(elem)

	if (!msScoped) {
		// Post-#18 wiring still reads mediaSession unconditionally: perfect invalidation of an
		// unrefreshing source changes nothing. The bug reproduction:
		check(`[${label}] Seq C RED: stale mediaSession keeps switched-to video exempt`, c.shouldSkipEnforcement(elem), true)
		check(`[${label}] Seq C RED: mediaSession slot serves the previous MV's OST title`, c.matchSources[1].includes("音乐集"), true)
		check(`[${label}] Seq C RED: classification never flips back (resets stuck at entry-only)`, c.stats.resets, 1)
		check(`[${label}] Seq C RED: bilibili page consulted navigator.mediaSession`, world.mediaSessionReads > 0, true)
		return
	}

	// #20 wiring: off YouTube the slot collapses away and the metadata is never consulted.
	check(`[${label}] Seq C GREEN: switched-to video NOT exempt after invalidation`, c.shouldSkipEnforcement(elem), false)
	check(
		`[${label}] Seq C GREEN: mediaSession slot collapsed away off YouTube`,
		c.matchSources.length === 2 && !c.matchSources.some((s) => s.includes("音乐集")),
		true,
	)
	check(
		`[${label}] Seq C GREEN: sources are exactly [docTitle, tags]`,
		`${c.matchSources[0]} | ${c.matchSources[1]}`,
		"【火焰纹章：风花雪月】剧情cg 解说 | 火焰纹章, 风花雪月",
	)
	check(`[${label}] Seq C GREEN: non-YT page NEVER touched navigator.mediaSession`, world.mediaSessionReads, 0)
	check(`[${label}] Seq C GREEN: element flipped back to enforceable (one entry reset only)`, `${c.stats.resets}/${c.stats.flips}`, "1/2")

	// YouTube-host behavior unchanged by #20: the slot stays present and fresh there (Seq B GREEN covers
	// the slot's content; this pins its existence on a YT host).
	const ytWorld = makeWorld()
	ytWorld.hostname = "www.youtube.com"
	ytWorld.docTitle = "Top 10 Kitchen Mistakes"
	ytWorld.mediaSessionTitle = "Kitchen Mistakes OST"
	const ytClassifier = makeClassifier(ytWorld, clock, true, true)
	ytClassifier.classifyExempt()
	check(
		`[${label}] Seq C GREEN: YT host keeps all three slots (mediaSession present)`,
		ytClassifier.matchSources.length === 3 && ytClassifier.matchSources[1],
		"kitchen mistakes ost",
	)
}

// ---------------------------------------------------------------------------
// Seq D (#25) — category freshness must NOT depend on element lifecycle events.
// Simulated timeline: category ABSENT at construction, becomes "Music" at t1 with NO
// emptied/loadedmetadata ever firing (MSE SourceBuffer swap — the modern YT SPA behavior), and
// later flips to null. World evolution is IDENTICAL for both legs; only the #25 self-check timer
// differs. Tick phases are kept boundary-aligned (all advances are half/multiples of the period),
// so every "appears/vanishes" below lands just after a fired tick with a full period of headroom.
// ---------------------------------------------------------------------------
function seqD(timed) {
	const label = timed ? "post-timer" : "pre-timer "
	const world = makeWorld()
	let now = 50_000
	const clock = () => now
	// Post-#18/#20 wiring in BOTH legs: invalidation and forced probes exist but ride element
	// lifecycle events, and this timeline fires none. The only delta is the #25 heartbeat.
	const c = makeClassifier(world, clock, true, true)
	const elem = { name: "mse-reused <video>" }

	// The shipped wiring: window.setInterval(reportMediaCategory, 2000) started at construction.
	// Replica: ticks fire at exact SELF_CHECK_MS spacing during clock advancement and run the
	// UNFORCED read. Pre-#25 the driver is inert — no timer existed.
	let nextTickAt = now + SELF_CHECK_MS
	function advance(delta) {
		now += delta
		if (!timed) return
		while (now >= nextTickAt) {
			c.reportMediaCategory()
			nextTickAt += SELF_CHECK_MS
		}
	}

	// Construction (document_start read): category absent → memo undefined === undefined → silent.
	c.reportMediaCategory()
	check(`[${label}] Seq D construction read on absent category sends nothing`, c.stats.sends, 0)

	// Idle document: ticks run but the value never changes — inert, zero message spam.
	advance(SELF_CHECK_MS * 2 + 1000)
	check(`[${label}] Seq D idle ticks on unchanged absence send nothing`, c.stats.sends, 0)
	check(`[${label}] Seq D absent category never classifies exempt`, c.classifyExempt(), false)
	c.shouldSkipEnforcement(elem)

	if (!timed) {
		// Music appears mid-document with NO lifecycle events (the TF-T symptom: static HTML says
		// "category":"Music", chip never shows).
		world.pageCategory = "Music"
		advance(SELF_CHECK_MS * 5) // five probe periods elapse; nothing ever re-reads the category
		check(`[${label}] Seq D RED: Music live for 10s yet classification frozen non-exempt`, c.shouldSkipEnforcement(elem), false)
		check(`[${label}] Seq D RED: zero bridge messages — nothing tracks the category`, c.stats.sends, 0)

		// The later disappearance can't clear anything either: there was never a report to stale out.
		world.pageCategory = undefined
		advance(SELF_CHECK_MS * 3)
		check(`[${label}] Seq D RED: still zero messages across both transitions`, c.stats.sends, 0)
		return
	}

	// Music appears just after a fired tick — NO lifecycle events, one full period of headroom.
	advance(SELF_CHECK_MS / 2)
	world.pageCategory = "Music"
	advance(SELF_CHECK_MS / 2)
	check(`[${label}] Seq D GREEN: mid-probe, classification still pends the next tick`, c.classifyExempt(), false)
	advance(SELF_CHECK_MS / 2)
	check(`[${label}] Seq D GREEN: Music classified within one probe period`, c.classifyExempt(), true)
	check(`[${label}] Seq D GREEN: appearance reported exactly once`, c.stats.sends, 1)
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq D GREEN: exempt entry produced one native-rate reset`, c.stats.resets, 1)

	// Steady state: several ticks over an unchanged value — silence.
	advance(SELF_CHECK_MS * 4)
	check(`[${label}] Seq D GREEN: four steady-state ticks send nothing further`, c.stats.sends, 1)

	// Music → People & Blogs → Music, driven ONLY by ticks: each flip reports exactly once.
	world.pageCategory = "People & Blogs"
	advance(SELF_CHECK_MS)
	check(`[${label}] Seq D GREEN: People & Blogs flip reported once and un-exempts`, `${c.stats.sends}/${c.classifyExempt()}`, "2/false")
	c.shouldSkipEnforcement(elem)
	world.pageCategory = "Music"
	advance(SELF_CHECK_MS)
	check(`[${label}] Seq D GREEN: flip back to Music reported once and re-exempts`, `${c.stats.sends}/${c.classifyExempt()}`, "3/true")
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq D GREEN: each exempt re-entry reset native rate exactly once`, c.stats.resets, 2)

	// Final flip to null: the stale Music classification clears within one probe period.
	world.pageCategory = undefined
	advance(SELF_CHECK_MS)
	check(`[${label}] Seq D GREEN: →null clears the stale category at the tick`, c.classifyExempt(), false)
	check(`[${label}] Seq D GREEN: clearing reported exactly once`, c.stats.sends, 4)
}

// ---------------------------------------------------------------------------
// Seq E (#31) — SPA navigations where the global object stays stale but the live player response
// moves. window.ytInitialPlayerResponse is assigned once per document load and NEVER reassigned,
// so its microformat category stays "Music" across every navigation below, while the player-method
// category (what #movie_player.getPlayerResponse() actually returns per navigation) flips
// Music→People & Blogs→Music. NO emptied/loadedmetadata ever fires (MSE SourceBuffer swaps); the
// #25 heartbeat ticks in BOTH legs but pre-#31 it re-reads the SAME stale global. Titles/tags carry
// no music keywords, so the category channel is the sole exemption input throughout. World evolution
// is IDENTICAL for both legs; only the readCategory wiring differs.
// ---------------------------------------------------------------------------
function seqE(livePlayer) {
	const label = livePlayer ? "post-nav" : "pre-nav "
	const world = makeWorld()
	let now = 60_000
	const clock = () => now
	// Post-#18/#20/#25 wiring in BOTH legs — invalidation, host-scoped mediaSession, and the 2s
	// heartbeat all exist here. The only delta is #31's source chain + navigate listener.
	const c = makeClassifier(world, clock, true, true, livePlayer)
	const elem = { name: "spa-reused <video>" }

	// Shipped #25 heartbeat replica (identical shape to Seq D's): ticks fire at exact SELF_CHECK_MS
	// spacing and run the UNFORCED read through whatever source chain the leg ships.
	let nextTickAt = now + SELF_CHECK_MS
	function advance(delta) {
		now += delta
		while (now >= nextTickAt) {
			c.reportMediaCategory()
			nextTickAt += SELF_CHECK_MS
		}
	}

	// yt-navigate-finish replica (#31): YouTube commits the new watch-page data, THEN dispatches the
	// event on document; the shipped listener runs the same UNFORCED report path as the heartbeat.
	// Pre-#31 no listener exists, so this driver is inert there.
	function navigateFinish() {
		if (livePlayer) c.reportMediaCategory()
	}

	// Page 1 — Music watch page: global and player agree on "Music".
	world.docTitle = "Video One - Channel A"
	world.tags = ["alpha"]
	world.pageCategory = "Music"
	world.playerCategory = "Music"
	c.reportMediaCategory() // document_start / first-wiggle report
	check(`[${label}] Seq E music page classifies exempt via the category channel`, c.classifyExempt(), true)
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq E initial category reported exactly once`, c.stats.sends, 1)

	// Idle document: ticks over an unchanged value stay silent.
	advance(SELF_CHECK_MS * 2)
	check(`[${label}] Seq E steady ticks on unchanged category send nothing`, c.stats.sends, 1)

	// Navigation 1 → People & Blogs recipe video. Title/tags/player response all move; the global
	// does NOT (the issue's core fact).
	world.docTitle = "Video Two - Beef Brisket Recipe"
	world.tags = ["brisket"]
	world.playerCategory = "People & Blogs"
	navigateFinish()

	if (!livePlayer) {
		// RED: the memo still holds "Music" off the stale global, so the navigate moment passes silently…
		check(`[${label}] Seq E RED: navigation past a stale global sends nothing`, c.stats.sends, 1)
		check(`[${label}] Seq E RED: recipe video still classified exempt`, c.classifyExempt(), true)
		// …and the heartbeat cannot rescue it: five more probe periods faithfully re-read the SAME stale global.
		advance(SELF_CHECK_MS * 5)
		c.shouldSkipEnforcement(elem)
		check(
			`[${label}] Seq E RED: five probe periods later still exempt, still one total message`,
			`${c.stats.sends}/${c.classifyExempt()}`,
			"1/true",
		)
		return
	}

	// GREEN: classification follows the flip AT the navigate event — inside one probe period.
	check(`[${label}] Seq E GREEN: People & Blogs followed the flip within one probe period`, c.classifyExempt(), false)
	check(`[${label}] Seq E GREEN: flip reported exactly once`, c.stats.sends, 2)
	c.shouldSkipEnforcement(elem)
	// Steady state after the flip: several ticks re-read the same fresh player value — silence.
	advance(SELF_CHECK_MS * 3)
	check(`[${label}] Seq E GREEN: post-flip ticks send nothing further`, c.stats.sends, 2)
	check(`[${label}] Seq E GREEN: un-exemption produced no extra entry reset`, c.stats.resets, 1)

	// Navigation 2 → back to a Music watch page. Global STILL "Music"; the player flips back.
	world.docTitle = "Video Three - Channel C Session"
	world.tags = ["delta"]
	world.playerCategory = "Music"
	navigateFinish()
	check(`[${label}] Seq E GREEN: flip back to Music reported exactly once and re-exempts`, `${c.stats.sends}/${c.classifyExempt()}`, "3/true")
	c.shouldSkipEnforcement(elem)
	check(`[${label}] Seq E GREEN: exempt re-entry reset native rate exactly once`, c.stats.resets, 2)
	advance(SELF_CHECK_MS * 2)
	check(`[${label}] Seq E GREEN: steady state after re-entry sends nothing further`, c.stats.sends, 3)
}

// Empty-slot semantics invariant (#20 review point): an empty source string can never match any
// compiled matcher — substring needs a non-empty haystack hit, word-boundary regexes need a word
// char. So even a slot that ever held "" could not conjure a keyword classification.
function checkEmptySlotInvariant() {
	const matchers = KEYWORD_VALUES.map(compileKeywordMatcher).filter((m) => m.regex || m.substring)
	const noneMatchEmpty = matchers.every((m) => (m.substring ? !"".includes(m.substring) : !m.regex.test("")))
	check("[invariant] empty-string source matches no compiled keyword matcher", noneMatchEmpty, true)
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

console.log(
	"== #18 stale-cache invalidation + #20 mediaSession scope + #25 category self-check + #31 live-player category read regression harness ==\n",
)
seqA(false)
seqA(true)
seqB(false)
seqB(true)
seqC(false)
seqC(true)
seqD(false)
seqD(true)
seqE(false)
seqE(true)
checkEmptySlotInvariant()
seqBurst()
console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
