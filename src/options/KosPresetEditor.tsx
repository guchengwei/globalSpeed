import { useMemo, useState } from "react"
import { GoX } from "react-icons/go"
import { Tooltip } from "@/comps/Tooltip"
import { Button } from "@/comps/ui/button"
import { DEFAULT_LIVE_PRESETS, DEFAULT_MUSIC_KEYWORDS, DEFAULT_MUSIC_PRESETS } from "@/defaults"
import { gvar } from "@/globalVar"
import { produce } from "@/utils/helper"
import { distinctMarkedUrlCount, KeywordCandidate, mineKeywordCandidates } from "@/utils/markCorpusMining"
import { ThrottledTextInput } from "../comps/ThrottledTextInput"
import { SetView } from "../hooks/useStateView"
import { KosPresetEntry, KosPresets, StateView } from "../types"

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
					<KosPresetList
						heading={gvar.gsm.options.flags.kosDomains}
						addLabel={gvar.gsm.options.flags.kosAddDomain}
						type="DOMAIN"
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
						<KosPresetList
							className="mt-5"
							heading={gvar.gsm.options.flags.kosTitleKeywords}
							addLabel={gvar.gsm.options.flags.kosAddKeyword}
							type="TITLE_KEYWORD"
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
								<span className="text-sm tabular-nums opacity-50" title={candidate.docFreq.toString()}>
									{candidate.docFreq}
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

function KosPresetList(props: {
	className?: string
	heading: string
	addLabel: string
	type: "DOMAIN" | "TITLE_KEYWORD"
	entries?: KosPresets
	onChange: (entries: KosPresets) => void
	onRestore: () => void
}) {
	const [newEntry, setNewEntry] = useState("")
	const entries = props.entries || []

	const update = (index: number, entry: KosPresetEntry) => {
		props.onChange(
			produce(entries, (d) => {
				d[index] = entry
			}),
		)
	}

	const remove = (index: number) => {
		props.onChange(
			produce(entries, (d) => {
				d.splice(index, 1)
			}),
		)
	}

	const add = () => {
		const value = newEntry.trim()
		if (!value) return
		props.onChange([...entries, { type: props.type, value, enabled: true }])
		setNewEntry("")
	}

	return (
		<div className={props.className}>
			<div className="mb-1.25 text-sm opacity-50">{props.heading}</div>

			{entries.map((entry, i) => (
				<div key={`${i}:${entry.value}`} className="mb-2 grid grid-cols-[max-content_1fr_max-content] items-center gap-x-2">
					<Tooltip title={entry.enabled ? gvar.gsm.token.off : gvar.gsm.token.on}>
						<input
							type="checkbox"
							checked={entry.enabled}
							aria-label={props.heading}
							onChange={() =>
								update(i, {
									...entry,
									enabled: !entry.enabled,
								})
							}
						/>
					</Tooltip>
					<ThrottledTextInput value={entry.value} onChange={(value) => update(i, { ...entry, value })} />
					<Tooltip title={gvar.gsm.token.delete}>
						<Button variant="icon" size="icon-auto" aria-label={gvar.gsm.token.delete} onClick={() => remove(i)}>
							<GoX size="1.6rem" />
						</Button>
					</Tooltip>
				</div>
			))}

			<div className="grid grid-cols-[1fr_max-content] items-center gap-x-2">
				<input
					type="text"
					value={newEntry}
					placeholder={props.addLabel}
					aria-label={props.addLabel}
					onChange={(e) => setNewEntry(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") add()
					}}
				/>
				<Button onClick={add}>{gvar.gsm.token.create}</Button>
			</div>

			<Button className="mt-2.5 block" onClick={props.onRestore}>
				{gvar.gsm.options.flags.kosRestoreDefaults}
			</Button>
		</div>
	)
}

function copyKosDefaults(presets: KosPresets): KosPresets {
	return presets.map((entry) => ({ ...entry }))
}
