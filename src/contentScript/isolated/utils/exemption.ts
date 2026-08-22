// Keep Original Speed classification seam: decides per media element whether enforced speed application should be skipped (Live Stream / Music Content). Later tickets plug detection logic into this decision; it always answers "not exempt" today.
export function shouldSkipEnforcement(elem: HTMLMediaElement): boolean {
	return false
}
