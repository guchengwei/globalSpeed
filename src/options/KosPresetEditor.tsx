import debounce from "lodash.debounce"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/comps/ui/button"
import { DEFAULT_LIVE_PRESETS, DEFAULT_MUSIC_KEYWORDS, DEFAULT_MUSIC_PRESETS } from "@/defaults"
import { gvar } from "@/globalVar"
import { isCommentedLine, parsePresetText, serializePresetText, togglePresetComments } from "@/utils/kosPresetText"
import { distinctMarkedUrlCount, KeywordCandidate, mineKeywordCandidates } from "@/utils/markCorpusMining"
import { SetView } from "../hooks/useStateView"
import { KosPresets, StateView } from "../types"

export function KosPresetEditor(props: { view: StateView; setView: SetView; channel: "live" | "music" }) {
	const [open, setOpen] = useState(false)
	const isMusic = props.channel === "music"

	return (
		<div className="mb-7.5 ml-5">
			<Button aria-expanded={open} onClick={() => setOpen(!open)}>
				{gvar.gsm.options.flags.kosEditPresets}
			</Button>

			{open && (
				<div className="mt-3.75">
					<KosTextboxList
						label={gvar.gsm.options.flags.kosDomains}
						type="DOMAIN"
						placeholder={gvar.gsm.options.flags.kosExampleDomain}
						entries={isMusic ? props.view.keepOriginalSpeedMusicPresets : props.view.keepOriginalSpeedLivePresets}
						onChange={
							isMusic
								? (keepOriginalSpeedMusicPresets) => props.setView({ keepOriginalSpeedMusicPresets })
								: (keepOriginalSpeedLivePresets) => props.setView({ keepOriginalSpeedLivePresets })
						}
						onRestore={
							isMusic
								? () => props.setView({ keepOriginalSpeedMusicPresets: copyKosDefaults(DEFAULT_MUSIC_PRESETS) })
								: () => props.setView({ keepOriginalSpeedLivePresets: copyKosDefaults(DEFAULT_LIVE_PRESETS) })
						}
					/>

					{isMusic && (
						<KosTextboxList
							className="mt-5"
							label={gvar.gsm.options.flags.kosTitleKeywords}
							type="TITLE_KEYWORD"
							placeholder={gvar.gsm.options.flags.kosExampleKeyword}
							entries={props.view.keepOriginalSpeedMusicKeywords}
							onChange={(keepOriginalSpeedMusicKeywords) => props.setView({ keepOriginalSpeedMusicKeywords })}
							onRestore={() => props.setView({ keepOriginalSpeedMusicKeywords: copyKosDefaults(DEFAULT_MUSIC_KEYWORDS) })}
						/>
					)}
				</div>
			)}
		</div>
	)
}

type KosTextboxEnv = {
	props?: {
		entries?: KosPresets
		onChange: (entries: KosPresets) => void
		type: "DOMAIN" | "TITLE_KEYWORD"
	}
	push?: ((value: string) => void) & { flush: () => void }
	/** Serialization of the entries our own last push wrote, so storage echoes never clobber the ghost text. */
	lastPushed?: string
	/** Selection to restore after the controlled value commits (Cmd+/ and Tab rewrite it mid-render). */
	selection?: { start: number; end: number }
}

// #33: one multiline textbox per preset list replaces the per-entry checkbox rows. A transparent-text
// <textarea> overlays a <pre> backdrop rendering the same text, so DISABLED ("#"/"//" prefixed) lines show
// visibly dimmed while typing stays native. The textarea holds ghost text locally and pushes
// parse -> entries through the regular setView write path on the same throttle the old row inputs used.
function KosTextboxList(props: {
	className?: string
	label: string
	type: "DOMAIN" | "TITLE_KEYWORD"
	placeholder: string
	entries?: KosPresets
	onChange: (entries: KosPresets) => void
	onRestore: () => void
}) {
	const [text, setText] = useState(() => serializePresetText(props.entries))
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const env = useMemo<KosTextboxEnv>(() => ({}), [])
	env.props = props

	env.push = useMemo(
		() =>
			debounce(
				(value: string) => {
					const parsed = parsePresetText(value)
					env.lastPushed = serializePresetText(parsed)
					env.props?.onChange(parsed.map((entry) => ({ type: env.props!.type, ...entry })) as KosPresets)
				},
				500,
				{ maxWait: 3000, leading: true, trailing: true },
			),
		[],
	)

	const applyText = (value: string, selection?: { start: number; end: number }) => {
		env.selection = selection
		setText(value)
		env.push!(value)
	}

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget
		if ((e.metaKey || e.ctrlKey) && e.key === "/") {
			e.preventDefault()
			const next = togglePresetComments(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0)
			applyText(next.text, { start: next.selStart, end: next.selEnd })
		} else if (e.key === "Tab") {
			e.preventDefault()
			const start = el.selectionStart ?? 0
			const end = el.selectionEnd ?? 0
			applyText(el.value.slice(0, start) + "  " + el.value.slice(end), { start: start + 2, end: start + 2 })
		}
	}

	const handleBlur = () => {
		env.push!.flush()
	}

	// External writes (restore defaults, candidate Add) arrive as changed entries; our own storage echoes
	// serialize back to exactly what we pushed, so only genuine foreign writes reserialize the ghost text.
	// Keyed on the entries reference: views keep array identities stable across unrelated renders, so typing
	// never trips this even while a leading-edge push is still in flight.
	useEffect(() => {
		const serialized = serializePresetText(env.props?.entries)
		if (serialized !== env.lastPushed) {
			env.lastPushed = serialized
			setText(serialized)
		}
	}, [props.entries])

	useLayoutEffect(() => {
		if (env.selection && textareaRef.current) {
			textareaRef.current.selectionStart = env.selection.start
			textareaRef.current.selectionEnd = env.selection.end
		}
		delete env.selection
	})

	useEffect(() => {
		window.addEventListener("beforeunload", handleBlur)
		return () => {
			handleBlur()
			window.removeEventListener("beforeunload", handleBlur)
		}
	}, [])

	const counts = useMemo(() => {
		let active = 0
		let off = 0
		for (const entry of parsePresetText(text)) entry.enabled ? active++ : off++
		return { active, off }
	}, [text])

	const lines = text.split("\n")

	return (
		<div
			className={`rounded-lg border border-border bg-muted/50 transition-[border-color] duration-150 ease-out focus-within:border-accent/30 ${props.className ?? ""}`}
		>
			<div className="flex items-baseline justify-between gap-2 px-2.5 pt-1.75 pb-0.75">
				<span className="text-sm opacity-50">{props.label}</span>
				<span className="text-xs text-muted-foreground tabular-nums">
					{counts.active} {gvar.gsm.options.flags.kosActive} · {counts.off} {gvar.gsm.options.flags.kosOff}
				</span>
			</div>

			<div className="relative min-h-[7.5rem]">
				<pre
					aria-hidden
					className="pointer-events-none m-0 px-2.5 py-2 font-mono text-sm leading-relaxed wrap-break-word whitespace-pre-wrap select-none"
				>
					{text ? (
						lines.map((line, i) => (
							<span key={i} className={isCommentedLine(line) ? "text-muted-foreground opacity-60" : undefined}>
								{line}
								{i < lines.length - 1 ? "\n" : ""}
							</span>
						))
					) : (
						<span className="text-muted-foreground opacity-60">{props.placeholder}</span>
					)}
				</pre>
				<textarea
					ref={textareaRef}
					aria-label={props.label}
					spellCheck={false}
					onBlur={handleBlur}
					onChange={(e) => applyText(e.target.value)}
					onKeyDown={onKeyDown}
					value={text}
					className="absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent px-2.5 py-2 font-mono text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-transparent caret-foreground outline-none"
				/>
			</div>

			<div className="flex items-center justify-between gap-2 px-2.5 pt-0.75 pb-1.75">
				<span className="text-xs text-muted-foreground">{gvar.gsm.options.flags.kosTextboxHint}</span>
				<Button variant="ghost" onClick={props.onRestore}>
					{gvar.gsm.options.flags.kosRestoreDefaults}
				</Button>
			</div>
		</div>
	)
}

// Keyword mining over the Manual Mark corpus (#26): a collapsible candidate list under the Music Content KOS
// rows. Each Add writes through the same setView path as the preset editor above, so the new keyword lands in
// keepOriginalSpeedMusicKeywords and vanishes from the candidate list (mined candidates never duplicate
// existing preset values). Everything runs locally off the already-captured markCorpus state field.
export function KosCorpusCandidates(props: { view: StateView; setView: SetView }) {
	const [open, setOpen] = useState(false)
	const keywords = props.view.keepOriginalSpeedMusicKeywords

	const candidates = useMemo(
		() =>
			open && props.view.markCorpus?.length
				? mineKeywordCandidates(
						props.view.markCorpus,
						[...DEFAULT_MUSIC_KEYWORDS, ...(keywords ?? [])].map((entry) => entry.value),
					)
				: [],
		[open, props.view.markCorpus, keywords],
	)

	const add = (candidate: KeywordCandidate) => {
		props.setView({
			keepOriginalSpeedMusicKeywords: [...(keywords ?? []), { type: "TITLE_KEYWORD", value: candidate.value, enabled: true }],
		})
	}

	return (
		<div className="mb-7.5 ml-5">
			<Button aria-expanded={open} onClick={() => setOpen(!open)}>
				{gvar.gsm.options.flags.kosCorpusHeading}
			</Button>

			{open &&
				(distinctMarkedUrlCount(props.view.markCorpus ?? []) < 2 ? (
					<div className="mt-3.75 text-sm opacity-50">{gvar.gsm.options.flags.kosCorpusEmpty}</div>
				) : (
					<div className="mt-3.75">
						{candidates.map((candidate) => (
							<div key={candidate.value} className="mb-2 grid grid-cols-[max-content_1fr_max-content] items-center gap-x-2">
								<span className="text-sm tabular-nums opacity-50" title={candidate.score.toString()}>
									{candidate.score}
								</span>
								<span className="break-all">{candidate.value}</span>
								<Button aria-label={`${gvar.gsm.options.flags.kosCorpusAdd} ${candidate.value}`} onClick={() => add(candidate)}>
									{gvar.gsm.options.flags.kosCorpusAdd}
								</Button>
							</div>
						))}
					</div>
				))}
		</div>
	)
}

function copyKosDefaults(presets: KosPresets): KosPresets {
	return presets.map((entry) => ({ ...entry }))
}
