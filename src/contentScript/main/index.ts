import { IS_FIREFOX_BUILD } from "../../utils/buildFlags"
import { randomId } from "../../utils/helper"
import { native } from "./utils/nativeCodes"
import { seekNetflix } from "./utils/seekNetflix"

declare global {
	interface Window {
		loadedGsCtx: boolean
	}
}

let mediaReferences: HTMLMediaElement[] = []
let shadowRoots: ShadowRoot[] = []
let client: StratumClient
let ghostMode: GhostMode

function main() {
	if (IS_FIREFOX_BUILD) {
		if (window.loadedGsCtx) return
		window.loadedGsCtx = true

		ensureSoundcloud()
	}
	ensureBaidu()

	ghostMode = new GhostMode()
	client = new StratumClient()

	overridePrototypeMethod(HTMLMediaElement, "play", handleOverrideMedia)
	overridePrototypeMethod(HTMLMediaElement, "pause", handleOverrideMedia)
	overridePrototypeMethod(HTMLMediaElement, "load", handleOverrideMedia)
	overridePrototypeMethod(Element, "attachShadow", handleOverrideShadow)
}

function overridePrototypeMethod(type: any, methodName: string, eventCb: (args: any, _this: any, _return: any) => void) {
	const ogFunc = type?.prototype[methodName]
	if (!ogFunc) return
	const ogString = ogFunc.toString()
	type.prototype[methodName] = function (...args: any[]) {
		const _return = ogFunc.apply(this, args)
		eventCb(args, this, _return)
		return _return
	}

	// For amazon music's sake.
	type.prototype[methodName].toString = () => ogString
}

function handleOverrideMedia(args: any, _this: HTMLMediaElement, _return: any) {
	if (!(_this instanceof native.HTMLMediaElement)) return
	if (native.array.includes.call(mediaReferences, _this)) return
	native.array.push.call(mediaReferences, _this)
	client.wiggleOn(_this)
}

function handleOverrideShadow(args: [ShadowRootInit], _this: Element, _return: ShadowRoot) {
	if (!(_return instanceof native.ShadowRoot)) return
	if (native.array.includes.call(shadowRoots, _return)) return
	native.array.push.call(shadowRoots, _return)
	client.wiggleOn(_return)
}

// soundcloud support for Firefox (may remove later)
function ensureSoundcloud() {
	if (!location.hostname.includes("soundcloud.com")) return

	const og = AudioContext.prototype.createMediaElementSource
	AudioContext.prototype.createMediaElementSource = function (...args) {
		const out = og.apply(this, [document.createElement("audio")])
		return out
	}
}

function ensureBaidu() {
	return
	if (!location.hostname.includes("pan.baidu.com")) return
	let ua = navigator.userAgent

	ua = ua.replace("Windows NT", "Windоws NT")
	ua = ua.replace("Macintosh", "Macintоsh")
	ua = ua.replace("Chrome", "Chrоme")
	ua = ua.replace("Firefox", "Firefоx")
	ua = ua.replace("Edg", "Eԁg")
	ua = ua.replace("Safari", "Sаfari")

	const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent")
	Object.defineProperty(Navigator.prototype, "userAgent", {
		...desc,
		get: function () {
			return ua
		},
	})
}

class GhostMode {
	active = false
	tempTimeout?: number
	dummyAudio = new Audio()
	ogDesc = {
		playbackRate: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate"),
		defaultPlaybackRate: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "defaultPlaybackRate"),
	}
	coherence = {
		playbackRate: new Map<HTMLMediaElement, number>(),
		defaultPlaybackRate: new Map<HTMLMediaElement, number>(),
	}
	constructor() {
		for (let key of ["playbackRate", "defaultPlaybackRate"] as ("playbackRate" | "defaultPlaybackRate")[]) {
			const ogDesc = this.ogDesc[key]
			let coherence = this.coherence[key]
			const self = this

			try {
				Object.defineProperty(HTMLMediaElement.prototype, key, {
					configurable: true,
					enumerable: true,
					get: function () {
						self.ogDesc[key].get.call(this)
						return self.active ? (native.map.has.call(coherence, this) ? native.map.get.call(coherence, this) : 1) : ogDesc.get.call(this)
					},
					set: function (newValue) {
						if (self.active && !(this instanceof native.HTMLMediaElement)) {
							self.ogDesc[key].set.call(this, newValue)
						}
						try {
							let output = ogDesc.set.call(self.active ? self.dummyAudio : this, newValue)
							let rate = ogDesc.get.call(self.active ? self.dummyAudio : this)
							native.map.set.call(coherence, this, rate)
							return output
						} catch (err) {
							throw err
						}
					},
				})
			} catch (err) {}
		}
	}
	activate = () => {
		if (this.tempTimeout) {
			clearTimeout(this.tempTimeout)
			delete this.tempTimeout
		}
		if (this.active) return
		this.active = true

		native.map.clear.call(this.coherence.playbackRate)
		native.map.clear.call(this.coherence.defaultPlaybackRate)

		mediaReferences.forEach((m) => {
			native.map.set.call(this.coherence.playbackRate, m, this.ogDesc.playbackRate.get.call(m))
			native.map.set.call(this.coherence.defaultPlaybackRate, m, this.ogDesc.defaultPlaybackRate.get.call(m))
		})
	}
	deactivate = () => {
		if (this.tempTimeout) {
			clearTimeout(this.tempTimeout)
			delete this.tempTimeout
		}
		if (!this.active) return
		this.active = false
	}
	activateFor = (ms: number) => {
		if (this.active) return
		this.activate()
		this.tempTimeout = window.setTimeout(this.deactivate, ms)
	}
}

// #31: window.ytInitialPlayerResponse is assigned once per document load and never reassigned across YouTube SPA navigations, so any trigger reading only that global re-reads the first page's category forever. Single source for every trigger (document_start read, wiggle re-read, MEDIA_CATEGORY_REPROBE, 2s heartbeat, yt-navigate-finish): prefer the LIVE player element's getPlayerResponse(), which YouTube refreshes in place across navigations; the document-load global stays as the fallback for frames where #movie_player is absent or not ready yet. Optional-chained end to end and run under the callers' existing try/catch so every failure stays silent.
function readCategory(): string | undefined {
	try {
		const live = (document.querySelector("#movie_player") as any)?.getPlayerResponse?.()?.microformat?.playerMicroformatRenderer?.category
		if (typeof live === "string") return live
	} catch (err) {}
	const global = (window as any).ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.category
	return typeof global === "string" ? global : undefined
}

class StratumClient {
	#parasite = document.createElement("div")
	#parasiteRoot = this.#parasite.attachShadow({ mode: "open" })
	#key = randomId()
	#serverName = `GS_SERVER_${this.#key}`
	#clientName = `GS_CLIENT_${this.#key}`
	#reportedCategory?: string
	#selfCheck?: number

	constructor() {
		this.#parasite.id = "GS_PARASITE"
		this.#parasiteRoot.addEventListener(this.#clientName, this.handle, { capture: true })
		document.documentElement.appendChild(this.#parasite)
		this.#parasite.dispatchEvent(new CustomEvent("GS_INIT", { detail: this.#key }))
		this.#parasite.remove()
		this.reportMediaCategory()
		this.#startSelfCheck()
		// #31: YouTube's canonical SPA navigation event (never dispatched off YouTube). Runs the same unforced report path as the heartbeat — the wrapper keeps the dispatched event from masquerading as `force`, and reportMediaCategory's memo makes each distinct transition (string | undefined | null) report exactly once. No explicit teardown: the listener dies with the document.
		document.addEventListener("yt-navigate-finish", () => this.reportMediaCategory())
	}
	handle = (e: CustomEvent) => {
		native.stopImmediatePropagation.call(e)
		let data: any
		try {
			e.detail && (data = native.JSON.parse(e.detail))
		} catch (err) {}

		if (!data) return

		if (data.type === "SEEK_NETFLIX") {
			seekNetflix(data.value)
		} else if (data.type === "GHOST") {
			data.off ? ghostMode.deactivate() : ghostMode.activate()
		} else if (data.type === "MEDIA_CATEGORY_REPROBE") {
			this.reportMediaCategory(true)
		}
	}
	send = (data: any) => {
		native.dispatchEvent.call(
			this.#parasiteRoot,
			new native.CustomEvent(this.#serverName, { detail: native.JSON.stringify({ type: "MSG", data }) }),
		)
	}
	wiggleOn = (parent: HTMLElement | ShadowRoot) => {
		native.appendChild.call(parent, this.#parasite)
		native.dispatchEvent.call(this.#parasiteRoot, new native.CustomEvent(this.#serverName, { detail: native.JSON.stringify({ type: "WIGGLE" }) }))
		native.elementRemove.call(this.#parasite)
		this.reportMediaCategory()
	}
	// #25: MSE-based players swap SourceBuffers on SPA navigations, so emptied/loadedmetadata never fire and category freshness cannot ride element lifecycle. One 2s interval per instance re-reads the category for the document lifetime; reportMediaCategory's memo keeps unchanged values silent and reports a vanished category as null so stale values clear. Off YouTube the read resolves undefined forever, so the tick sends nothing. #31: the tick reads through readCategory (live player first), so when the player method answers fresh the timer is no longer the staleness carrier — it only backstops transitions the navigate event fired before the data landed. Cleared on pagehide/beforeunload (belt and braces; document teardown kills it anyway).
	#startSelfCheck = () => {
		if (this.#selfCheck !== undefined) return
		this.#selfCheck = window.setInterval(this.reportMediaCategory, 2000)
		const stop = () => {
			if (this.#selfCheck === undefined) return
			window.clearInterval(this.#selfCheck)
			this.#selfCheck = undefined
		}
		document.addEventListener("pagehide", stop, { capture: true, once: true })
		window.addEventListener("beforeunload", stop, { capture: true, once: true })
	}
	// YouTube-only best effort: surfaces the watch page's media category to the isolated world via readCategory above (live player response first, document-load global as fallback). Read once per distinct value at document_start, again on wiggle time (covers late page scripts), by forced probes (MEDIA_CATEGORY_REPROBE after media content change), at every yt-navigate-finish (#31), and every 2s by the self-check heartbeat above — freshness never depends on element lifecycle. All paths memo-compare normalized values (string | undefined): unchanged values send nothing, and a category that disappeared reports null so the isolated world's stale "Music" clears on music→normal navigations. Try/catch keeps every read silent everywhere else.
	reportMediaCategory = (force = false) => {
		try {
			const next = readCategory()
			if (!force && next === this.#reportedCategory) return
			this.#reportedCategory = next
			this.send({ type: "MEDIA_CATEGORY", value: next ?? null })
		} catch (err) {}
	}
}

main()
