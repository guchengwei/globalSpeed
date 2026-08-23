// Regression harness for #19: the YouTube live-badge visibility predicate.
//
// Replication note (honest): this script REPLICATES badgeCountsAsLive/defaultRendersVisible from
// src/contentScript/isolated/utils/exemption.ts rather than importing them — the source is TypeScript
// with bundler path aliases, so the standalone node run cannot import it directly. Keep this copy in
// sync with the source; drift here means the fixture no longer guards the shipped predicate.
//
// Red-before-fix is structural: the pre-fix code had NO visibility input at all (mere querySelector
// existence), so these fixtures could not even be expressed against it. This run verifies the fix's
// behavior, not a red→green transition.

function badgeCountsAsLive(el, rendersVisible) {
	return el !== null && rendersVisible(el)
}

function defaultRendersVisible(el) {
	return el.getClientRects().length > 0
}

function fakeBadge(rectCount) {
	return { getClientRects: () => ({ length: rectCount }) }
}

const cases = [
	{ name: "hidden on regular VOD (no rendered rects)", el: fakeBadge(0), expected: false },
	{ name: "rendered on live / DVR-scrubbed live", el: fakeBadge(1), expected: true },
	{ name: "selector miss (null element)", el: null, expected: false },
]

let failed = 0
for (const { name, el, expected } of cases) {
	const actual = badgeCountsAsLive(el, defaultRendersVisible)
	const ok = actual === expected
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: rectCount=${el === null ? "null" : el.getClientRects().length} → ${actual} (expected ${expected})`)
}

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
