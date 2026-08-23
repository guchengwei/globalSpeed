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
	return (label === "music" ? marks.music : marks.live).some((m) => m.url === url)
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

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
