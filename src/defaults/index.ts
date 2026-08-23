import {
	AnyDict,
	AudioFx,
	Context,
	CONTEXT_KEYS,
	Fx,
	IndicatorInit,
	Keybind,
	KosPresets,
	State,
	URLCondition,
	URLConditionPart,
	URLRule,
} from "../types"
import { chunkByPredicate, isMobile, randomId } from "../utils/helper"
import { getDefaultMenuKeybinds, getDefaultPageKeybinds } from "./commands"
import { filterInfos, FilterName } from "./filters"

export type WebsiteInfo = {
	v: string
	contains?: boolean
}

export const SHORTCUT_ALLOWED_WEBSITES: WebsiteInfo[] = [
	{ v: "https://www.youtube.com" },
	{ v: "https://www.netflix.com" },
	{ v: "https://www.twitch.tv" },
	{ v: "https://www.hulu.com" },
	{ v: "https://www.disneyplus.com" },
	{ v: "https://play.max.com" },
	{ v: "https://www.amazon.com/gp/video" },
	{ v: "https://www.peacocktv.com" },
	{ v: "https://tv.apple.com" },
	{ v: "https://www.paramountplus.com" },
	{ v: "https://www.crunchyroll.com" },
	{ v: "https://www.dailymotion.com" },
	{ v: "https://www.bilibili.com" },
	{ v: "https://www.iqiyi.com" },
	{ v: "https://v.youku.com" },
	{ v: "https://v.qq.com" },
	{ v: "https://pan.baidu.com" },
	{ v: "https://www.nicovideo.jp" },
	{ v: "https://www.bbc.com/video" },
]

export function generateUrlPart(origin: string): URLConditionPart {
	return {
		id: randomId(),
		type: "STARTS_WITH",
		valueStartsWith: origin,
		valueContains: origin,
		valueRegex: "",
	}
}

// Built-in Live Stream channel DOMAIN presets. Twitch is deliberately absent: presets are whole-domain, so it would also exempt VODs.
export const DEFAULT_LIVE_PRESETS: KosPresets = [
	{ type: "DOMAIN", value: "live.bilibili.com", enabled: true },
	{ type: "DOMAIN", value: "www.douyu.com", enabled: false },
	{ type: "DOMAIN", value: "www.huya.com", enabled: false },
]

// Built-in Music Content channel DOMAIN presets. music.youtube.com ships enabled; the others are seeded as disabled candidates.
export const DEFAULT_MUSIC_PRESETS: KosPresets = [
	{ type: "DOMAIN", value: "music.youtube.com", enabled: true },
	{ type: "DOMAIN", value: "soundcloud.com", enabled: false },
	{ type: "DOMAIN", value: "music.163.com", enabled: false },
]

// Built-in Music Content channel TITLE_KEYWORD presets, shipped enabled. User-uploaded mixes/playlists carry no domain or
// category signal, so keywords are their only catch. "live" and bare "mix" stay excluded (too colliding); bare "cover" ships
// again because the #7 \b word-boundary matcher removed its substring collisions ("discovery" no longer hits). JP uploads use
// 音楽/カバー rather than their simplified-Chinese counterparts, so both ship alongside them (#22).
export const DEFAULT_MUSIC_KEYWORDS: KosPresets = [
	{ type: "TITLE_KEYWORD", value: "playlist", enabled: true },
	{ type: "TITLE_KEYWORD", value: "full album", enabled: true },
	{ type: "TITLE_KEYWORD", value: "album", enabled: true },
	{ type: "TITLE_KEYWORD", value: "compilation", enabled: true },
	{ type: "TITLE_KEYWORD", value: "megamix", enabled: true },
	{ type: "TITLE_KEYWORD", value: "remix", enabled: true },
	{ type: "TITLE_KEYWORD", value: "soundtrack", enabled: true },
	{ type: "TITLE_KEYWORD", value: "ost", enabled: true },
	{ type: "TITLE_KEYWORD", value: "bgm", enabled: true },
	{ type: "TITLE_KEYWORD", value: "lofi", enabled: true },
	{ type: "TITLE_KEYWORD", value: "lyrics", enabled: true },
	{ type: "TITLE_KEYWORD", value: "official video", enabled: true },
	{ type: "TITLE_KEYWORD", value: "mv", enabled: true },
	{ type: "TITLE_KEYWORD", value: "music", enabled: true },
	{ type: "TITLE_KEYWORD", value: "cover", enabled: true },
	{ type: "TITLE_KEYWORD", value: "歌单", enabled: true },
	{ type: "TITLE_KEYWORD", value: "音乐", enabled: true },
	{ type: "TITLE_KEYWORD", value: "音楽", enabled: true },
	{ type: "TITLE_KEYWORD", value: "合集", enabled: true },
	{ type: "TITLE_KEYWORD", value: "纯音乐", enabled: true },
	{ type: "TITLE_KEYWORD", value: "翻唱", enabled: true },
	{ type: "TITLE_KEYWORD", value: "カバー", enabled: true },
	{ type: "TITLE_KEYWORD", value: "演唱会", enabled: true },
	{ type: "TITLE_KEYWORD", value: "串烧", enabled: true },
	{ type: "TITLE_KEYWORD", value: "混音", enabled: true },
	{ type: "TITLE_KEYWORD", value: "专辑", enabled: true },
]

export function getDefaultState(): State {
	let state = {
		version: 15,
		freshState: true,
		firstUse: Date.now(),
		pageKeybinds: getDefaultPageKeybinds(),
		menuKeybinds: getDefaultMenuKeybinds(),
		browserKeybinds: [] as Keybind[],
		...getDefaultContext(),
		keybindsUrlCondition: getDefaultKeybindsUrlConditions(),
		hideMediaView: isMobile(),
		holdToSpeed: isMobile() ? 2 : undefined,
		keepOriginalSpeedLivePresets: DEFAULT_LIVE_PRESETS.map((entry) => ({ ...entry })),
		keepOriginalSpeedMusicPresets: DEFAULT_MUSIC_PRESETS.map((entry) => ({ ...entry })),
		keepOriginalSpeedMusicKeywords: DEFAULT_MUSIC_KEYWORDS.map((entry) => ({ ...entry })),
	} satisfies State

	return state
}

export function getDefaultKeybindsUrlConditions(): URLCondition {
	return {
		block: false,
		allowParts: SHORTCUT_ALLOWED_WEBSITES.map((origin) => {
			const part = generateUrlPart(origin.v)
			if (origin.contains) part.type = "CONTAINS"
			return part
		}),
		blockParts: [],
	}
}

export function getEmptyUrlConditions(block?: boolean) {
	return {
		block,
		blockParts: [],
		allowParts: [],
	} as URLCondition
}

export function getDefaultContext(withNulls?: boolean): Context {
	const obj: AnyDict = {
		speed: 1,
		enabled: true,
		audioFx: null,
	}
	withNulls &&
		CONTEXT_KEYS.forEach((key) => {
			obj[key] = obj[key] ?? null
		})
	return obj as Context
}

export function getDefaultFx(): Fx {
	const [passed, failed] = chunkByPredicate(Object.entries(filterInfos), ([k, v]) => v.isTransform)
	return {
		filters: failed.map(([k, v]) => ({ name: k as FilterName, value: v.ref.default })),
		transforms: passed.map(([k, v]) => ({ name: k as FilterName, value: v.ref.default })),
	}
}

export function getDefaultAudioFx(): AudioFx {
	return {
		pitch: 0,
		volume: 1,
		delay: 0,
		eq: getDefaultEq(),
	}
}

export function getDefaultEq(): AudioFx["eq"] {
	return {
		enabled: false,
		factor: 1,
		values: Array(10).fill(0),
	}
}

export function getDefaultURLConditionPart(): URLConditionPart {
	return {
		type: "CONTAINS",
		valueContains: "example.com",
		valueStartsWith: String.raw`https://example.com`,
		valueRegex: String.raw`example\.com`,
		id: randomId(),
	}
}

export function getDefaultURLCondition(block?: boolean): URLCondition {
	return {
		block,
		blockParts: [],
		allowParts: [],
	}
}

export function getDefaultURLRule(): URLRule {
	return {
		id: randomId(),
		enabled: true,
		type: "SPEED",
		overrideSpeed: 1,
		overrideJs: `// Javascript here\n`,
	}
}

export const INDICATOR_INIT: IndicatorInit = {
	position: "TL",
	backgroundColor: "#000000",
	textColor: "#ffffff",
	outlineWidth: 1,
	scaling: 1,
	rounding: 4,
	duration: 1,
	offset: 1,
}

export const INDICATOR_CIRCLE_INIT: IndicatorInit = {
	...INDICATOR_INIT,
	position: "C",
	rounding: 3,
	scaling: 1.2,
}
