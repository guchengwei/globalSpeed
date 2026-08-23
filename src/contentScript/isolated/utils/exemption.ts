import { DEFAULT_LIVE_PRESETS, DEFAULT_MUSIC_KEYWORDS, DEFAULT_MUSIC_PRESETS } from "@/defaults"
import { KosPresetEntry } from "@/types"
import { applyMediaEvent } from "./applyMediaEvent"

// Keep Original Speed classification seam: decides per media element whether enforced speed application should be skipped (Live Stream / Music Content).
// Two independent Detection Channels driven by ConfigSync; while a channel is off it answers "not exempt" for every element.

// Latest channel state pushed by the content-script subscription.
let liveChannelEnabled = false
let musicChannelEnabled = false

// Enabled DOMAIN presets pushed from state; an undefined slice (feature never touched) resolves to the built-in seed.
let liveDomainPresets: KosPresetEntry[] = []
let musicDomainPresets: KosPresetEntry[] = []

// Enabled TITLE_KEYWORD presets pushed from state, compiled once per preset-set change so every classification pass only re-runs the matching itself.
type KeywordMatcher = { regex?: RegExp; substring?: string }
let musicKeywordMatchers: KeywordMatcher[] = []

// Watch-page media category reported through the MAIN↔isolated bridge; only "Music" classifies as Music Content.
let mediaCategory: string | null = null

// Per-element Live Stream classification. A rising edge onto exempt resets a previously enforced rate back to native exactly once, so repeated enforcement ticks never fight the stream.
const exemptElements = new WeakMap<HTMLMediaElement, boolean>()

// Explicit Override: set by deliberate user speed actions (popup, shortcuts, hold-to-speed). It pierces the Exempt Media skip until a classification flip or document unload. In-memory only.
let explicitOverride = false

// YouTube live badge as a second Live signal (catches lives whose duration heuristic misses). Only a RENDERED badge counts: YouTube keeps `.ytp-live-badge` in the DOM even on regular videos and merely hides it there, so existence would exempt everything; a DVR-scrubbed live still shows the badge and stays exempt. Rendered-visibility decision is memoized for a second so the per-element pass never hammers querySelector.
const LIVE_BADGE_SELECTOR = ".ytp-live-badge"
const LIVE_BADGE_TTL_MS = 1000
let badgeCheckedAt = 0
let badgePresent = false

// Pure decision seam over badge visibility: a null lookup and any element the resolver says does not render both answer "not live". Kept side-effect-free so the standalone regression harness can drive it without a real document.
export function badgeCountsAsLive(el: Element | null, rendersVisible: (el: Element) => boolean): boolean {
	return el !== null && rendersVisible(el)
}

// Default resolver: getClientRects() is empty exactly when the element renders no boxes (display:none subtree or detached).
export function defaultRendersVisible(el: Element): boolean {
	return el.getClientRects().length > 0
}

function youTubeLiveBadgePresent(): boolean {
	const now = Date.now()
	if (now - badgeCheckedAt >= LIVE_BADGE_TTL_MS) {
		badgeCheckedAt = now
		badgePresent = badgeCountsAsLive(document.querySelector(LIVE_BADGE_SELECTOR), defaultRendersVisible)
	}
	return badgePresent
}

// Shared whole-domain boundary: exact equality or any deeper subdomain counts. One implementation for DOMAIN presets and per-platform source guards so the scope semantics can never drift apart.
function hostMatchesDomain(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`)
}

function isYouTubeHost(hostname: string): boolean {
	return hostMatchesDomain(hostname, "youtube.com")
}

// DOMAIN presets are whole-domain by design: exact hostname equality or any deeper subdomain counts. Deliberately not URLCondition parts — presets are platform-knowledge data evaluated against location.hostname, and the whole-domain scope is why twitch.tv (whose VODs must stay enforceable) is excluded from the seeds.
function hostnameMatchesLivePreset(): boolean {
	const hostname = location.hostname
	return liveDomainPresets.some((entry) => entry.type === "DOMAIN" && hostMatchesDomain(hostname, entry.value))
}

function hostnameMatchesMusicPreset(): boolean {
	const hostname = location.hostname
	return musicDomainPresets.some((entry) => entry.type === "DOMAIN" && hostMatchesDomain(hostname, entry.value))
}

export function setKeepOriginalSpeedLive(enabled: boolean) {
	liveChannelEnabled = enabled
}

export function setKeepOriginalSpeedMusic(enabled: boolean) {
	musicChannelEnabled = enabled
}

export function setLivePresets(presets?: KosPresetEntry[]) {
	// Filter to active DOMAIN entries once here so the per-element pass only scans plain strings. (The Live channel has no keyword matcher; TITLE_KEYWORD entries in its slice are inert.)
	liveDomainPresets = (presets ?? DEFAULT_LIVE_PRESETS).filter((entry) => entry.enabled && entry.type === "DOMAIN")
}

export function setMusicPresets(presets?: KosPresetEntry[]) {
	musicDomainPresets = (presets ?? DEFAULT_MUSIC_PRESETS).filter((entry) => entry.enabled && entry.type === "DOMAIN")
}

export function setMusicKeywords(keywords?: KosPresetEntry[]) {
	// Same undefined→seed-fallback as the DOMAIN preset slices. Compilation happens here, once per preset-set change, never per pass.
	musicKeywordMatchers = (keywords ?? DEFAULT_MUSIC_KEYWORDS)
		.filter((entry) => entry.enabled && entry.type === "TITLE_KEYWORD")
		.map(compileKeywordMatcher)
		.filter((matcher) => matcher.regex || matcher.substring)
}

// ASCII keywords match on word boundaries (so "playlist" never hits "mixed martial arts"); non-ASCII (CJK) keywords match by substring.
// Values are lowercased at compile time and the haystacks per pass, keeping the compiled patterns case-normalized without a per-test toLowerCase.
function compileKeywordMatcher(entry: KosPresetEntry): KeywordMatcher {
	const value = (entry.value || "").trim().toLowerCase()
	if (!value) return {}
	if (/[^\x00-\x7F]/.test(value)) return { substring: value }
	return { regex: new RegExp(`\\b${escapeRegExp(value)}\\b`) }
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Platform-provided tag signals for TITLE_KEYWORD matching (higher precision than title substrings): YouTube exposes uploader
// tags in the watch-page <meta name="keywords"> content; Bilibili renders them as DOM tag links behind a couple of historical
// markup shapes, tried in candidate order. Extraction is guarded by cheap hostname checks before any querySelector and memoized
// with the same 1s-TTL pattern as the live badge above — never per element per tick. Anything missing or failing degrades
// silently to an empty tag list (title-only matching); extraction never throws or logs.
const KEYWORD_TAG_TTL_MS = 1000
const BILIBILI_TAG_SELECTORS = [".tag-info .tag-link", ".video-tag-container .tag-link", "a.tag-link"]
let tagsCheckedAt = 0
let tagsRawKey: string | null = null
let tagsJoined = ""

// Whole-domain scope like the DOMAIN presets: the apex host or any deeper subdomain (www., m., …).
function onPlayerHost(hostname: string): boolean {
	return isYouTubeHost(hostname) || hostMatchesDomain(hostname, "bilibili.com")
}

function extractPlatformTags(): string[] {
	try {
		const hostname = location.hostname
		// Guard before any querySelector: tag extraction only makes sense on pages plausibly hosting these players.
		if (!onPlayerHost(hostname)) return []
		if (isYouTubeHost(hostname)) {
			const keywords = document.querySelector<HTMLMetaElement>('meta[name="keywords"]')?.content ?? ""
			return keywords
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean)
		}
		if (hostMatchesDomain(hostname, "bilibili.com")) {
			for (const selector of BILIBILI_TAG_SELECTORS) {
				const tags = Array.from(document.querySelectorAll(selector))
					.map((el) => el.textContent?.trim() || "")
					.filter(Boolean)
				if (tags.length) return tags
			}
		}
	} catch {}
	return []
}

// Returns the tag texts joined into one lowercased haystack, recomputed only when the raw set actually changed — so steady-state passes pay nothing beyond a timestamp compare.
function currentTagSource(): string {
	const now = Date.now()
	if (now - tagsCheckedAt >= KEYWORD_TAG_TTL_MS) {
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

// Match sources consulted for TITLE_KEYWORD matching: the frame's document.title, the mediaSession metadata title when the page
// publishes one (same source genMediaInfo.ts reads for MediaScope displayTitle; read defensively since support varies), and the
// platform tag signals joined into one slot. A hit from any single source classifies as Exempt Media.
// The mediaSession slot exists ONLY on YouTube hosts: the player republishes it across SPA navigations and iframe/embed frames
// need it because document.title belongs to the parent page. Elsewhere the slot collapses away (sources = title + tags) and
// navigator.mediaSession is never touched — some players (Bilibili) leave the metadata stale after SPA navigation, so re-reads
// would keep matching the previous video's title forever (#20).
let matchSources: string[] | null = null
let docTitleRaw: string | null = null
let mediaTitleRaw: string | null = null

function currentMatchSources(): string[] {
	// Host is constant per document, so the slot layout resolves once: [title, mediaSession, tags] on YouTube, [title, tags]
	// elsewhere. Every returned slot is (re)written below before returning, so no empty placeholder can reach the matcher.
	const onYouTube = isYouTubeHost(location.hostname)
	matchSources ??= onYouTube ? ["", "", ""] : ["", ""]
	const sources = matchSources
	const docTitle = document.title ?? ""
	// Lowercase each source once per pass (only when its raw value actually changed) instead of once per keyword test.
	if (docTitle !== docTitleRaw) {
		docTitleRaw = docTitle
		sources[0] = docTitle.toLowerCase()
	}
	if (onYouTube) {
		let mediaTitle = ""
		try {
			mediaTitle = (navigator as any).mediaSession?.metadata?.title || ""
		} catch {}
		if (mediaTitle !== mediaTitleRaw) {
			mediaTitleRaw = mediaTitle
			sources[1] = mediaTitle.toLowerCase()
		}
		sources[2] = currentTagSource()
	} else {
		sources[1] = currentTagSource()
	}
	return sources
}

function matchesMusicKeyword(): boolean {
	if (!musicKeywordMatchers.length) return false
	const sources = currentMatchSources()
	return musicKeywordMatchers.some((matcher) =>
		matcher.regex ? sources.some((source) => matcher.regex!.test(source)) : sources.some((source) => source.includes(matcher.substring!)),
	)
}

// Media-content-change invalidation, wired to the emptied/loadedmetadata lifecycle events: SPA players reuse one <video> across navigations, so nothing else tells these caches the CONTENT changed. Drops the raw-title compare keys so the next classification pass re-reads document.title and mediaSession metadata, and expires the tag TTL probe. Pure cache resets — no classification or rate-reset bookkeeping here (that edge lives solely in shouldSkipEnforcement), so event bursts cannot re-trigger the one-time reset.
export function invalidateMatchSources() {
	docTitleRaw = null
	mediaTitleRaw = null
	tagsCheckedAt = 0
}

export function setMusicCategory(category: string | null) {
	mediaCategory = category
}

// YouTube Mix context: radio queues are `list=RD…` by construction and music-only by product design, so their watch URLs alone
// classify the current media as Music Content (#22). Only the exact "RD" prefix counts — PL/OL/UU and other list kinds carry no
// such guarantee. Pure string ops over location.search, which SPA navigations rewrite without a reload; the raw search string
// is the compare key so steady-state passes pay one string equality, re-parsing only when it actually changed.
let mixSearchRaw: string | null = null
let mixContextPresent = false

function youTubeMixContextPresent(): boolean {
	const search = location.search
	if (search !== mixSearchRaw) {
		mixSearchRaw = search
		mixContextPresent = false
		if (isYouTubeHost(location.hostname)) {
			mixContextPresent = (new URLSearchParams(search).get("list") || "").startsWith("RD")
		}
	}
	return mixContextPresent
}

export function markExplicitOverride() {
	explicitOverride = true
}

// Pure per-element classification: independent channels OR-ed per their own toggles — any hit classifies the element as Exempt Media.
// Ordered cheapest-first; the DOM query is memoized, keyword matching runs over the title/tag sources, and the Mix-context check
// (string equality steady-state) closes the Music union.
// Deliberately side-effect-free so snapshot publishing can read it without disturbing edge/reset bookkeeping.
function classifyExempt(elem: HTMLMediaElement): boolean {
	return (
		(liveChannelEnabled && (elem.duration === Infinity || hostnameMatchesLivePreset() || youTubeLiveBadgePresent())) ||
		(musicChannelEnabled && (hostnameMatchesMusicPreset() || mediaCategory === "Music" || matchesMusicKeyword() || youTubeMixContextPresent()))
	)
}

// Published Keep Original Speed state for scope snapshots (popup badge). Reading never mutates classification or override bookkeeping.
export function getKosMediaState(elem: HTMLMediaElement): { exempt: boolean; overridden: boolean } {
	const exempt = classifyExempt(elem)
	return { exempt, overridden: exempt && explicitOverride }
}

export function shouldSkipEnforcement(elem: HTMLMediaElement): boolean {
	const exempt = classifyExempt(elem)

	if ((exemptElements.get(elem) ?? false) !== exempt) {
		exemptElements.set(elem, exempt)
		// Any classification flip re-arms the exemption: an Explicit Override never outlives it.
		explicitOverride = false
		// Entering the exempt state: one-time reset to native rate (Infinity is truthy, so the dispatcher accepts it).
		exempt && applyMediaEvent(elem, { type: "PLAYBACK_RATE", value: 1, freePitch: false })
	}

	// An active Explicit Override pierces the skip: ticks then carry the user's own chosen rate into Exempt Media instead of fighting it.
	return exempt && !explicitOverride
}
