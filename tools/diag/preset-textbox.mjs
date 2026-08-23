// Regression harness for #33: the preset textbox editors' pure text codec (src/utils/kosPresetText.ts).
//
// Unlike most fixtures here this one IMPORTS the shipped module instead of replicating it — the codec was
// written dependency-free precisely so node --experimental-strip-types can load it (no bundler aliases,
// no runtime imports). Drift is therefore impossible; if the module moves or gains an import this script
// fails loudly.
//
// Red/green evidence: pre-#33 the module does not exist, so the import itself fails. Post-fix the run pins
// the issue's verbatim syntax contract — one entry per line, blank lines ignored, values trimmed, "#"/"//"
// lines parsed as DISABLED with the marker stripped, exact duplicates deduped keeping the first position,
// serialize as the exact inverse ("# "+value) with order preserved — plus round-trip stability and a
// lossless migration fixture over representative pre-#33 stored arrays (enabled and seeded-disabled
// entries). The Cmd/Ctrl+/ toggle is simulated on single lines, multi-line selections spanning comment +
// active lines (mixed ⇒ comment all), already-commented lines (⇒ uncomment), repeated presses (⇒ back to
// the start), trailing-newline selection boundaries, and blank lines inside a selection.

import { isCommentedLine, parsePresetText, serializePresetText, stripCommentMarker, togglePresetComments } from "../../src/utils/kosPresetText.ts"

let failed = 0
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected)
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

console.log("== #33 preset textbox parse/serialize + Cmd+/ regression harness ==\n")

// --- parse: basic syntax ------------------------------------------------------
check("single active line", parsePresetText("youtube.com"), [{ value: "youtube.com", enabled: true }])
check("values are trimmed", parsePresetText("  youtube.com  "), [{ value: "youtube.com", enabled: true }])
check("blank lines ignored", parsePresetText("\n\na.com\n\n\nb.com\n\n"), [
	{ value: "a.com", enabled: true },
	{ value: "b.com", enabled: true },
])
check("whitespace-only line ignored", parsePresetText("a.com\n   \nb.com"), [
	{ value: "a.com", enabled: true },
	{ value: "b.com", enabled: true },
])

// --- parse: comment forms (# and //) ----------------------------------------
check("# line parses disabled with marker stripped", parsePresetText("# soundcloud.com"), [{ value: "soundcloud.com", enabled: false }])
check("// line parses disabled with marker stripped", parsePresetText("// soundcloud.com"), [{ value: "soundcloud.com", enabled: false }])
check("marker without space still strips", parsePresetText("#soundcloud.com"), [{ value: "soundcloud.com", enabled: false }])
check("indented comment line still disables", parsePresetText("   #  soundcloud.com  "), [{ value: "soundcloud.com", enabled: false }])
check("only one marker is stripped on parse", parsePresetText("# #1 hits"), [{ value: "#1 hits", enabled: false }])
check("marker-only line dropped", parsePresetText("a.com\n#\n//\nb.com"), [
	{ value: "a.com", enabled: true },
	{ value: "b.com", enabled: true },
])
check(
	"isCommentedLine classification",
	[isCommentedLine("# x"), isCommentedLine("//x"), isCommentedLine("x"), isCommentedLine("")],
	[true, true, false, false],
)
check("stripCommentMarker single marker", stripCommentMarker("# //keep-slash"), "//keep-slash")

// --- parse: dedupe + order ---------------------------------------------------
check("exact duplicates deduped preserving first position", parsePresetText("a.com\n# b.com\na.com\n# b.com\nc.com"), [
	{ value: "a.com", enabled: true },
	{ value: "b.com", enabled: false },
	{ value: "c.com", enabled: true },
])
check("same value with different enabled states are NOT duplicates", parsePresetText("# a.com\na.com"), [
	{ value: "a.com", enabled: false },
	{ value: "a.com", enabled: true },
])

// --- serialize: inverse render ----------------------------------------------
check("serialize undefined renders empty text", serializePresetText(undefined), "")
check(
	"serialize renders disabled as # value, order preserved",
	serializePresetText([
		{ value: "a", enabled: true },
		{ value: "b", enabled: false },
	]),
	"a\n# b",
)
// Known syntax boundary (documented deviation): an ENABLED value whose trimmed form starts with "#" or "//"
// renders as a commented-looking line, so it reads back as DISABLED. Inherent to the issue's comment syntax —
// there is no escape form to serialize it with — this fixture pins the behavior instead of hiding it.
check("enabled value starting with # renders as a commented-looking line", serializePresetText([{ value: "#1 hits", enabled: true }]), "#1 hits")
check("…and reads back as disabled (pinned limitation)", parsePresetText("#1 hits"), [{ value: "1 hits", enabled: false }])

// --- round-trip stability ----------------------------------------------------
const stored = [
	{ type: "DOMAIN", value: "live.bilibili.com", enabled: true },
	{ type: "DOMAIN", value: "www.douyu.com", enabled: false },
	{ type: "DOMAIN", value: "www.huya.com", enabled: false },
]
const roundTripped = parsePresetText(serializePresetText(stored))
check(
	"round-trip keeps {value, enabled} pairs losslessly",
	roundTripped,
	stored.map(({ value, enabled }) => ({ value, enabled })),
)
check("round-trip is stable when repeated", parsePresetText(serializePresetText(roundTripped)), roundTripped)
const canonical = "a.com\n# b.com\nc.com"
check("canonical text survives serialize(parse(text)) unchanged", serializePresetText(parsePresetText(canonical)), canonical)

// --- pre-#33 migration fixture ----------------------------------------------
const pre33Keywords = [
	{ type: "TITLE_KEYWORD", value: "playlist", enabled: true },
	{ type: "TITLE_KEYWORD", value: "full album", enabled: true },
	{ type: "TITLE_KEYWORD", value: "音楽", enabled: true },
	{ type: "TITLE_KEYWORD", value: "the first take", enabled: true },
]
check(
	"pre-#33 keyword array migrates losslessly through render+save",
	parsePresetText(serializePresetText(pre33Keywords)),
	pre33Keywords.map(({ value, enabled }) => ({ value, enabled })),
)

// --- Cmd/Ctrl+/ simulation ---------------------------------------------------
{
	const t = "one\ntwo\nthree"
	const r = togglePresetComments(t, t.indexOf("two"), t.indexOf("two"))
	check("Cmd+/ on a bare caret comments its whole line", r.text, "one\n# two\nthree")
	check("Cmd+/ selection covers the affected line", [r.selStart, r.selEnd], [r.text.indexOf("# two"), r.text.indexOf("# two") + "# two".length])

	const r2 = togglePresetComments(r.text, r.selStart, r.selEnd)
	check("repeated press on an already-commented line uncomments it", r2.text, t)

	const r3 = togglePresetComments(r2.text, r2.selStart, r2.selEnd)
	check("third press re-comments", r3.text, r.text)
}
{
	const t = "alpha\nbeta\ngamma"
	const selStart = t.indexOf("alpha")
	const selEnd = t.indexOf("gamma") + "gamma".length
	check("Cmd+/ multi-line selection comments every non-blank line", togglePresetComments(t, selStart, selEnd).text, "# alpha\n# beta\n# gamma")
}
{
	// Mixed selection: comment + active lines ⇒ standard editors comment ALL of them.
	const t = "alpha\n# beta\ngamma"
	const selStart = 0
	const selEnd = t.length
	check("Cmd+/ mixed comment+active selection comments all", togglePresetComments(t, selStart, selEnd).text, "# alpha\n# # beta\n# gamma")
	const back = togglePresetComments("# alpha\n# # beta\n# gamma", 0, "# alpha\n# # beta\n# gamma".length)
	check("then a second press uncomments all (markers restored)", back.text, t)
}
{
	const t = "# alpha\n# beta"
	check("Cmd+/ all-commented selection uncomments all", togglePresetComments(t, 0, t.length).text, "alpha\nbeta")
}
{
	// Selection ending exactly after a newline must not swallow the next line.
	const t = "alpha\nbeta\ngamma"
	const selEnd = t.indexOf("\n", t.indexOf("alpha")) + 1
	check("selection ending at newline boundary excludes next line", togglePresetComments(t, 0, selEnd).text, "# alpha\nbeta\ngamma")
}
{
	const t = "alpha\n\nbeta"
	check("blank line inside selection stays blank", togglePresetComments(t, 0, t.length).text, "# alpha\n\n# beta")
}
{
	const t = "alpha\nbeta"
	const end = t.length
	check("caret at very end of text targets last line", togglePresetComments(t, end, end).text, "alpha\n# beta")
}
{
	check("empty text toggle is a safe no-op", togglePresetComments("", 0, 0).text, "")
}

console.log(failed === 0 ? "\nAll fixtures pass." : `\n${failed} fixture(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
