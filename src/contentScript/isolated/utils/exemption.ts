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

// YouTube live badge as a second Live signal (catches lives whose duration heuristic misses). Presence is memoized for a second so the per-element pass never hammers querySelector.
const LIVE_BADGE_SELECTOR = ".ytp-live-badge"
const LIVE_BADGE_TTL_MS = 1000
let badgeCheckedAt = 0
let badgePresent = false

function youTubeLiveBadgePresent(): boolean {
	const now = Date.now()
	if (now - badgeCheckedAt >= LIVE_BADGE_TTL_MS) {
		badgeCheckedAt = now
		badgePresent = !!document.querySelector(LIVE_BADGE_SELECTOR)
	}
	return badgePresent
}

// DOMAIN presets are whole-domain by design: exact hostname equality or any deeper subdomain counts. Deliberately not URLCondition parts — presets are platform-knowledge data evaluated against location.hostname, and the whole-domain scope is why twitch.tv (whose VODs must stay enforceable) is excluded from the seeds.
function hostnameMatchesLivePreset(): boolean {
	const hostname = location.hostname
	return liveDomainPresets.some((entry) => entry.type === "DOMAIN" && (hostname === entry.value || hostname.endsWith(`.${entry.value}`)))
}

function hostnameMatchesMusicPreset(): boolean {
	const hostname = location.hostname
	return musicDomainPresets.some((entry) => entry.type === "DOMAIN" && (hostname === entry.value || hostname.endsWith(`.${entry.value}`)))
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

// Title sources consulted for TITLE_KEYWORD matching: the frame's document.title plus the mediaSession metadata title when the page publishes one
// (same source genMediaInfo.ts reads for MediaScope displayTitle; read defensively since support varies).
const titleSources: string[] = ["", ""]
let docTitleRaw: string | null = null
let mediaTitleRaw: string | null = null

function currentTitleSources(): string[] {
	const docTitle = document.title ?? ""
	let mediaTitle = ""
	try {
		mediaTitle = (navigator as any).mediaSession?.metadata?.title || ""
	} catch {}
	// Lowercase each source once per pass (only when its raw value actually changed) instead of once per keyword test.
	if (docTitle !== docTitleRaw) {
		docTitleRaw = docTitle
		titleSources[0] = docTitle.toLowerCase()
	}
	if (mediaTitle !== mediaTitleRaw) {
		mediaTitleRaw = mediaTitle
		titleSources[1] = mediaTitle.toLowerCase()
	}
	return titleSources
}

function titleMatchesMusicKeyword(): boolean {
	if (!musicKeywordMatchers.length) return false
	const sources = currentTitleSources()
	return musicKeywordMatchers.some((matcher) =>
		matcher.regex ? sources.some((source) => matcher.regex!.test(source)) : sources.some((source) => source.includes(matcher.substring!)),
	)
}

export function setMusicCategory(category: string | null) {
	mediaCategory = category
}

export function markExplicitOverride() {
	explicitOverride = true
}

export function shouldSkipEnforcement(elem: HTMLMediaElement): boolean {
	// Independent channels OR-ed per their own toggles — any hit classifies the element as Exempt Media. Ordered cheapest-first; the DOM query is memoized and keyword matching is last (regex work over the title sources).
	const exempt =
		(liveChannelEnabled && (elem.duration === Infinity || hostnameMatchesLivePreset() || youTubeLiveBadgePresent())) ||
		(musicChannelEnabled && (hostnameMatchesMusicPreset() || mediaCategory === "Music" || titleMatchesMusicKeyword()))

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
