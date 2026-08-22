import { DEFAULT_LIVE_PRESETS } from "@/defaults"
import { KosPresetEntry } from "@/types"
import { applyMediaEvent } from "./applyMediaEvent"

// Keep Original Speed classification seam: decides per media element whether enforced speed application should be skipped (Live Stream / Music Content).
// The Live Stream Detection Channel is driven by ConfigSync; while it is off this answers "not exempt" for every element.

// Latest channel state pushed by the content-script subscription.
let liveChannelEnabled = false

// Enabled Live Stream DOMAIN presets pushed from state; an undefined slice (feature never touched) resolves to the built-in seed.
let liveDomainPresets: KosPresetEntry[] = []

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

export function setKeepOriginalSpeedLive(enabled: boolean) {
	liveChannelEnabled = enabled
}

export function setLivePresets(presets?: KosPresetEntry[]) {
	// Filter to active DOMAIN entries once here so the per-element pass only scans plain strings. TITLE_KEYWORD entries are inert until their matcher lands (#7).
	liveDomainPresets = (presets ?? DEFAULT_LIVE_PRESETS).filter((entry) => entry.enabled && entry.type === "DOMAIN")
}

export function markExplicitOverride() {
	explicitOverride = true
}

export function shouldSkipEnforcement(elem: HTMLMediaElement): boolean {
	// Loose union of Live signals — any hit classifies the element as Exempt Media. Ordered cheapest-first; the DOM query is last and memoized.
	const exempt = liveChannelEnabled && (elem.duration === Infinity || hostnameMatchesLivePreset() || youTubeLiveBadgePresent())

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
