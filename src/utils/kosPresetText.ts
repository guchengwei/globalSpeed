// Pure text<->entry codec for the #33 preset textbox editors: one entry per line, blank lines ignored,
// values trimmed, lines whose trimmed form starts with "#" or "//" are DISABLED entries (marker stripped
// on parse). No imports at all so tools/diag/preset-textbox.mjs can load this file directly under
// node --experimental-strip-types without any bundler alias or runtime dependency.

export type KosTextEntry = {
	value: string
	enabled: boolean
}

/** One leading comment marker plus at most one following space; leading whitespace goes with it. */
const COMMENT_MARKER = /^\s*(?:#|\/\/)\s?/

/** A line counts as commented when its trimmed form starts with "#" or "//". */
export function isCommentedLine(line: string): boolean {
	const trimmed = line.trim()
	return trimmed.startsWith("#") || trimmed.startsWith("//")
}

/** Strips exactly one comment marker ("#" or "//") and trims the remainder. */
export function stripCommentMarker(line: string): string {
	return line.trim().replace(COMMENT_MARKER, "").trim()
}

/**
 * Text -> entries. Blank lines are ignored; empty-valued lines are dropped; exact duplicates (same value
 * AND enabled state) are silently deduped preserving the first position; values are trimmed.
 */
export function parsePresetText(text: string): KosTextEntry[] {
	const entries: KosTextEntry[] = []
	const seen = new Set<string>()

	for (const rawLine of text.split("\n")) {
		const trimmed = rawLine.trim()
		if (!trimmed) continue

		let entry: KosTextEntry
		if (isCommentedLine(trimmed)) {
			const value = stripCommentMarker(trimmed)
			if (!value) continue
			entry = { value, enabled: false }
		} else {
			entry = { value: trimmed, enabled: true }
		}

		const key = `${entry.enabled}\u0000${entry.value}`
		if (seen.has(key)) continue
		seen.add(key)
		entries.push(entry)
	}

	return entries
}

/** Entries -> text. Disabled entries render as "# "+value; order preserved; undefined means empty list. */
export function serializePresetText(entries: readonly KosTextEntry[] | undefined): string {
	return (entries ?? []).map((entry) => (entry.enabled ? entry.value : `# ${entry.value}`)).join("\n")
}

/**
 * Cmd/Ctrl+/ simulation over [selStart, selEnd] (a bare caret targets its whole line). If every non-blank
 * line in range is commented, all markers are stripped; otherwise "# " is prepended to every non-blank line
 * (blank lines stay untouched). Returns the new text plus the selection covering the affected lines.
 */
export function togglePresetComments(text: string, selStart: number, selEnd: number): { text: string; selStart: number; selEnd: number } {
	selStart = Math.max(0, Math.min(selStart, text.length))
	selEnd = Math.max(selStart, Math.min(selEnd, text.length))

	// A selection ending right after a newline must not swallow the next (empty) line.
	if (selEnd > selStart && text[selEnd - 1] === "\n") selEnd--

	const rangeStart = text.lastIndexOf("\n", selStart - 1) + 1
	let rangeEnd = text.indexOf("\n", selEnd)
	if (rangeEnd === -1) rangeEnd = text.length

	const before = text.slice(0, rangeStart)
	const middle = text.slice(rangeStart, rangeEnd)
	const after = text.slice(rangeEnd)

	const lines = middle.split("\n")
	// Standard editor semantics: any active line in range ⇒ comment all; only an all-commented range uncomments.
	const commenting = lines.some((line) => line.trim() && !isCommentedLine(line))

	const nextMiddle = lines.map((line) => (!line.trim() ? line : commenting ? `# ${line}` : stripCommentMarker(line))).join("\n")

	return { text: before + nextMiddle + after, selStart: rangeStart, selEnd: rangeStart + nextMiddle.length }
}
