# Keep Original Speed exempts media instead of pinning playbackRate to 1x

When media is classified as a Live Stream or Music Content, the extension **exempts** the element — speed enforcement skips it entirely and its rate is reset once on entering the exempt state — rather than actively pinning it at 1x. User-initiated speed actions (popup, shortcuts) pierce the exemption and last until the classification flips or the document unloads.

Considered alternatives:

- **Pin to 1x**: continuously fighting the site's player over `playbackRate` trips the extension's own anti-fight rate limiter (`gsRateBanned`), is physically wrong for live streams (the position is anchored to "now"), and removes user agency.
- **Pure exemption without passthrough**: manual speed changes would silently do nothing on exempt media, which reads as a bug.

Consequence: exemption must live at the single choke point where enforced speed is applied to each element, so all entry paths (shortcuts, URL rules, popup, background broadcast) are covered by one skip.
