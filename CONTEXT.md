# globalSpeed

A browser extension that enforces a user-chosen playback speed on media across every website, with per-site URL rules, shortcuts, and audio effects.

## Language

### Speed enforcement

**Keep Original Speed**:
The behavior whereby media detected as a Live Stream or Music Content plays at its natural rate instead of the enforced speed.
_Avoid_: whitelist, ignore mode, bypass

**Exempt Media**:
A media element currently classified by any Detection Channel; enforcement skips it entirely.
_Avoid_: blocked media, protected media, excluded media

**Explicit Override**:
A user-initiated speed change applied to Exempt Media; it pierces the exemption and lasts until the classification flips or the document unloads.
_Avoid_: manual speed, forced speed

### Classification

**Detection Channel**:
One of two independent classifiers — Live Stream and Music Content — each with its own toggle, both feeding the same Keep Original Speed behavior.
_Avoid_: detector, heuristic, signal source

**Live Stream**:
Media whose playback is real-time, having no fixed duration to traverse.
_Avoid_: live video, broadcast, DVR

**Music Content**:
Media presenting music rather than narrative or informational content, whether from a dedicated music service, a music-categorized page, or a keyword-matched title.
_Avoid_: MV, audio, song

**Preset**:
A built-in, editable bundle of classification data — domains and title keywords — shipped per Detection Channel and restorable to defaults.
_Avoid_: whitelist, blocklist, template
