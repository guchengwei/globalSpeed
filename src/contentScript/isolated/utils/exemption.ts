import { applyMediaEvent } from "./applyMediaEvent"

// Keep Original Speed classification seam: decides per media element whether enforced speed application should be skipped (Live Stream / Music Content).
// The Live Stream Detection Channel is driven by ConfigSync; while it is off this answers "not exempt" for every element.

// Latest channel state pushed by the content-script subscription.
let liveChannelEnabled = false

// Per-element Live Stream classification. A rising edge onto exempt resets a previously enforced rate back to native exactly once, so repeated enforcement ticks never fight the stream.
const exemptElements = new WeakMap<HTMLMediaElement, boolean>()

// Explicit Override: set by deliberate user speed actions (popup, shortcuts, hold-to-speed). It pierces the Exempt Media skip until a classification flip or document unload. In-memory only.
let explicitOverride = false

export function setKeepOriginalSpeedLive(enabled: boolean) {
	liveChannelEnabled = enabled
}

export function markExplicitOverride() {
	explicitOverride = true
}

export function shouldSkipEnforcement(elem: HTMLMediaElement): boolean {
	const exempt = liveChannelEnabled && elem.duration === Infinity

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
