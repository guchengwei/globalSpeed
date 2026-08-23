// Regression harness for #24: manual Music/Live page marks.
//
// Replication note (honest): like badge-predicate.mjs, this script REPLICATES normalizePageUrl from
// src/utils/configUtils.ts and the matching half of matchesManualMark from
// src/contentScript/isolated/utils/exemption.ts rather than importing them — the sources are TypeScript
// with bundler path aliases, so the standalone node run cannot import them directly. Keep these copies in
// sync with the source; drift here means the fixture no longer guards the shipped predicate.
//
// Red-before-fix is structural: pre-#24 neither function existed, so no mark identity or mark-match
// semantics existed to fail. This run pins the shipped behavior:
//   - YouTube /watch URLs collapse to origin+pathname+?v=<id> (t/list/si/… are churn; param ORDER is
//     irrelevant); missing v degrades to the generic rule.
//   - Bilibili /video/BV… and every other page carry their identity in origin+pathname (hash/search gone).
//   - Weird input must never throw — the fallback is a crude query/hash cut of the raw string.
//   - Mark match = exact equality of normalized URLs, per channel, lists independent.
//
// #30 adds a second replicated decision: whether an incoming message produces an Explicit Override
// mark in MessageTower.handleMessage. Verbatim replication of the gate `msg.type === "APPLY_MEDIA_EVENT" &&
// msg.event.type === "PLAYBACK_RATE"` — same honest caveat as above, keep in sync with the source.
// The MediaEvent union (applyMediaEvent.ts) was enumerated for #30; PLAYBACK_RATE is its ONLY
// rate-altering member (SetPlaybackRate.set), so it alone may pierce Exempt Media.
//
// #32 adds two more replicas:
//   - classifyExempt (src/contentScript/isolated/utils/exemption.ts): the negative-mark guard must stand
//     BEFORE both channel unions so a Negative Mark forces exempt=false over every positive signal
//     (duration/badge/domains/category/keywords/mix/music-manual/live-manual). Automatic signals are stood
//     in by booleans; the manual-mark matching and channel gating are replicated faithfully.
//   - toggleManualMark (src/popup/Header.tsx) mutual exclusivity: a FRESH mark evicts the same normalized
//     URL from the other two lists; unmarking touches only its own list.

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

function matchesManualMark(marks, label, href) {
	const url = normalizePageUrl(href)
	return (label === "music" ? marks.music : label === "live" ? marks.live : marks.negative).some((m) => m.url === url)
}

// Replicated verbatim from src/contentScript/isolated/utils/exemption.ts classifyExempt (#24/#32).
// `signals` = { live, music } booleans standing in for the automatic Live/Music hits (duration, badge,
// DOMAIN presets, category "Music", title keywords, RD-mix context); the manual-mark terms and the
// per-channel enable gates are faithful. The negative guard precedes the whole union.
function classifyExempt(state, href, signals) {
	if (matchesManualMark(state.marks, "negative", href)) return false
	return (
		(state.liveEnabled && (signals.live || matchesManualMark(state.marks, "live", href))) ||
		(state.musicEnabled && (signals.music || matchesManualMark(state.marks, "music", href)))
	)
}

// Replicated from src/popup/Header.tsx toggleManualMark (#24/#32): read-modify-write over all three lists;
// a fresh mark unshifts onto its list AND evicts the same normalized URL from the other two; an unmark
// splices out of its own list only. `url` arrives pre-normalized exactly as the popup computes it.
// Returns the next ManualMarks (pure — input untouched).
function toggleManualMark(marks, label, url) {
	const next = { music: [...marks.music], live: [...marks.live], negative: [...marks.negative] }
	const list = next[label]
	const existingIndex = list.findIndex((m) => m.url === url)
	if (existingIndex >= 0) {
		list.splice(existingIndex, 1)
	} else {
		list.unshift({ url, title: "", at: Date.now() })
		for (const other of ["music", "live", "negative"]) {
			if (other === label) continue
			next[other] = next[other].filter((m) => m.url !== url)
		}
	}
	return next
}

// Replicated verbatim from src/contentScript/isolated/MessageTower.ts handleMessage (#30):
// the APPLY_MEDIA_EVENT branch marks Explicit Override only for speed-affecting events.
function marksExplicitOverride(msg) {
	return msg.type === "APPLY_MEDIA_EVENT" && msg.event.type === "PLAYBACK_RATE"
}

let failed = 0
function check(name, actual, expected) {
	const ok = actual === expected
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

console.log("== #24 manual marks regression harness ==\n-- normalizePageUrl --")
check(
	"YT watch with junk params collapses to ?v=",
	normalizePageUrl("https://www.youtube.com/watch?v=abc123&t=42&list=PLx&si=z"),
	"https://www.youtube.com/watch?v=abc123",
)
check(
	"YT watch junk-param order is irrelevant",
	normalizePageUrl("https://www.youtube.com/watch?si=q&t=9&v=dQw4w9WgXcQ"),
	"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
)
check(
	"both junk-param variants resolve to ONE key",
	normalizePageUrl("https://www.youtube.com/watch?v=abc123&t=42"),
	normalizePageUrl("https://www.youtube.com/watch?t=42&v=abc123#comments"),
)
check("YT watch without v degrades to generic rule", normalizePageUrl("https://www.youtube.com/watch?app=desktop"), "https://www.youtube.com/watch")
check("m.youtube.com watch keeps its subdomain host", normalizePageUrl("https://m.youtube.com/watch?v=xyz"), "https://m.youtube.com/watch?v=xyz")
check(
	"music.youtube.com watch keeps its subdomain host",
	normalizePageUrl("https://music.youtube.com/watch?v=abc123"),
	"https://music.youtube.com/watch?v=abc123",
)
check(
	"YT shorts rides the generic rule",
	normalizePageUrl("https://www.youtube.com/shorts/AbCdEf12345"),
	"https://www.youtube.com/shorts/AbCdEf12345",
)
check(
	"bilibili BV path strips query junk",
	normalizePageUrl("https://www.bilibili.com/video/BV1xx411c7mD/?p=3&spm_id_from=xyz"),
	"https://www.bilibili.com/video/BV1xx411c7mD/",
)
check("bilibili live room strips query junk", normalizePageUrl("https://live.bilibili.com/1234?extra=1"), "https://live.bilibili.com/1234")
check("generic page strips query and hash", normalizePageUrl("https://example.com/a/b?q=1#frag"), "https://example.com/a/b")
check("bare origin keeps trailing slash", normalizePageUrl("https://example.com/"), "https://example.com/")

const weird = ["", "not a url", "http://[::1/bad", "://x", "   "]
for (const input of weird) {
	let threw = false
	try {
		normalizePageUrl(input)
	} catch {
		threw = true
	}
	check(`never throws on ${JSON.stringify(input)}`, threw, false)
}
check("unparseable string falls back to raw cut (no query/hash)", normalizePageUrl("some weird path?q=1#x"), "some weird path")

console.log("\n-- manual-mark matching (per-channel equality over normalized URLs) --")
const marks = {
	music: [{ url: "https://www.youtube.com/watch?v=abc123", title: "t", at: 1 }],
	live: [{ url: "https://live.bilibili.com/1234", title: "t", at: 2 }],
}
check(
	"marked music page matches after adding junk params",
	matchesManualMark(marks, "music", "https://www.youtube.com/watch?v=abc123&t=1&si=x"),
	true,
)
check("marked music page survives SPA hash change", matchesManualMark(marks, "music", "https://www.youtube.com/watch?v=abc123#comments"), true)
check("different video id does NOT match", matchesManualMark(marks, "music", "https://www.youtube.com/watch?v=zzzz99"), false)
check("same video id on another host does NOT match", matchesManualMark(marks, "music", "https://music.youtube.com/watch?v=abc123"), false)
check("live channel list is independent of music list", matchesManualMark(marks, "live", "https://www.youtube.com/watch?v=abc123"), false)
check("marked live page matches its own list", matchesManualMark(marks, "live", "https://live.bilibili.com/1234?extra=junk"), true)
const emptyMarks = { music: [], live: [] }
check("empty mark lists never match", matchesManualMark(emptyMarks, "music", "https://www.youtube.com/watch?v=abc123"), false)

console.log("\n-- Explicit Override marking (#30): only speed-affecting APPLY_MEDIA_EVENTs pierce Exempt Media --")
// Representative shape of every MediaEvent union member (applyMediaEvent.ts), so the enumeration
// stays pinned: exactly one of these may mark.
const mediaEventShapes = {
	PLAYBACK_RATE: { type: "PLAYBACK_RATE", value: 2, freePitch: false },
	SEEK: { type: "SEEK", value: 5, relative: true },
	PAUSE: { type: "PAUSE", state: "toggle" },
	MUTE: { type: "MUTE", state: "on" },
	SET_VOLUME: { type: "SET_VOLUME", value: 0.1, relative: true },
	SET_MARK: { type: "SET_MARK", key: "intro" },
	SEEK_MARK: { type: "SEEK_MARK", key: "intro" },
	TOGGLE_LOOP: { type: "TOGGLE_LOOP", key: "intro" },
	PIP: { type: "PIP", state: "toggle" },
	FULLSCREEN: { type: "FULLSCREEN", direct: true },
	MEDIA_INFO: { type: "MEDIA_INFO" },
	CINEMA: { type: "CINEMA", init: {} },
	LOOP_ENTIRE: { type: "LOOP_ENTIRE", key: "k", state: "toggle" },
}
check(
	"SET_VOLUME-shaped APPLY_MEDIA_EVENT does NOT mark",
	marksExplicitOverride({ type: "APPLY_MEDIA_EVENT", key: "", event: mediaEventShapes.SET_VOLUME }),
	false,
)
check(
	"PLAYBACK_RATE-shaped APPLY_MEDIA_EVENT DOES mark",
	marksExplicitOverride({ type: "APPLY_MEDIA_EVENT", key: "", event: mediaEventShapes.PLAYBACK_RATE }),
	true,
)
for (const [type, event] of Object.entries(mediaEventShapes)) {
	if (type === "PLAYBACK_RATE") continue
	check(`${type}-shaped APPLY_MEDIA_EVENT does NOT mark`, marksExplicitOverride({ type: "APPLY_MEDIA_EVENT", key: "", event }), false)
}
check("non-media message types never mark via this gate", marksExplicitOverride({ type: "SET_TEMPORARY_SPEED", factor: 2 }), false)

console.log("\n-- #32 negative-mark precedence (negative guard precedes both channel unions) --")
const OMELETTE = "https://www.youtube.com/watch?v=9Ah4tW-k8Ao"
const channelsOn = { liveEnabled: true, musicEnabled: true }
const noMarks = { music: [], live: [], negative: [] }
const categoryHit = { live: false, music: true } // stands in for category="Music"/keyword/domain/mix hits
// Control: without a negative mark the Music signal still exempts.
check("control: category hit exempts when not negatively marked", classifyExempt({ ...channelsOn, marks: noMarks }, OMELETTE, categoryHit), true)
check(
	"control: manual-positive music mark exempts when not negatively marked",
	classifyExempt({ ...channelsOn, marks: { music: [{ url: OMELETTE, title: "t", at: 1 }], live: [], negative: [] } }, OMELETTE, {
		live: false,
		music: false,
	}),
	true,
)
// Negative beats each positive class of signal.
check(
	"negative beats category=Music",
	classifyExempt({ ...channelsOn, marks: { music: [], live: [], negative: [{ url: OMELETTE, title: "t", at: 3 }] } }, OMELETTE, {
		live: false,
		music: true,
	}),
	false,
)
check(
	"negative beats keyword hit",
	classifyExempt(
		{ ...channelsOn, marks: { music: [], live: [], negative: [{ url: normalizePageUrl(OMELETTE), title: "t", at: 3 }] } },
		`${OMELETTE}&t=42&si=x`,
		{ live: false, music: true },
	),
	false,
)
check(
	"negative beats manual-positive (same-URL music mark)",
	classifyExempt(
		{
			...channelsOn,
			marks: { music: [{ url: OMELETTE, title: "t", at: 1 }], live: [], negative: [{ url: OMELETTE, title: "t", at: 2 }] },
		},
		OMELETTE,
		{ live: false, music: false },
	),
	false,
)
check(
	"negative beats manual-positive (live channel) + auto live signals",
	classifyExempt(
		{ ...channelsOn, marks: { music: [], live: [{ url: OMELETTE, title: "t", at: 1 }], negative: [{ url: OMELETTE, title: "t", at: 2 }] } },
		OMELETTE,
		{ live: true, music: true },
	),
	false,
)
check(
	"negative on ANOTHER page does not suppress THIS page's category hit",
	classifyExempt(
		{ ...channelsOn, marks: { music: [], live: [], negative: [{ url: "https://www.youtube.com/watch?v=zzzzzz", title: "t", at: 1 }] } },
		OMELETTE,
		categoryHit,
	),
	true,
)
// Edge rule: stored while channels are OFF, still overriding once they re-enable.
const channelsOff = { liveEnabled: false, musicEnabled: false }
const negMarked = { music: [], live: [], negative: [{ url: OMELETTE, title: "t", at: 1 }] }
check("channels OFF: nothing exempts regardless of marks", classifyExempt({ ...channelsOff, marks: negMarked }, OMELETTE, categoryHit), false)
check(
	"negative stored while OFF keeps forcing non-exemption after re-enable",
	classifyExempt({ ...channelsOn, marks: negMarked }, OMELETTE, categoryHit),
	false,
)
check(
	"unmarking the negative restores exemption for the category hit",
	classifyExempt({ ...channelsOn, marks: toggleManualMark(negMarked, "negative", normalizePageUrl(OMELETTE)) }, OMELETTE, categoryHit),
	true,
)

console.log("\n-- #32 mutual exclusivity per URL (popup toggle semantics) --")
let marksState = { music: [{ url: OMELETTE, title: "t", at: 1 }], live: [], negative: [] }
marksState = toggleManualMark(marksState, "negative", OMELETTE)
check("marking enforce removes same-URL music entry", marksState.music.length, 0)
check("marking enforce stores the negative entry once", marksState.negative.length, 1)
check("negative entry carries the normalized URL identity", marksState.negative[0].url, normalizePageUrl(OMELETTE))
marksState = toggleManualMark(marksState, "music", normalizePageUrl(`${OMELETTE}&list=PLx`))
check("marking music removes same-URL enforce entry", marksState.negative.length, 0)
check("marking music stores the music entry", marksState.music.length, 1)
marksState = toggleManualMark(marksState, "live", OMELETTE)
check("marking live evicts same-URL music too", marksState.music.length, 0)
marksState = toggleManualMark(marksState, "live", OMELETTE)
check(
	"unmarking live leaves the other lists untouched",
	JSON.stringify([marksState.live.length, marksState.music.length, marksState.negative.length]),
	"[0,0,0]",
)
marksState = toggleManualMark(marksState, "negative", "https://other.example/a")
check("a different URL's enforce mark never touches this page's marks", marksState.music.length, 0)

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
