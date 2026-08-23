// Regenerates static/_locales from static/locales.
//
// Source format (per file in static/locales):
//   ":key"  -> manifest i18n message, emitted to _locales/<lang>/messages.json
//              and consumed by the manifests via __MSG_key__
//   "!key"  -> human-facing comment, never shipped or generated
//   others  -> runtime UI strings fetched by src/utils/gsm.ts from locales/<lang>.json
//
// Run `node tools/genLocales.mjs` after editing static/locales, then commit static/_locales.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")
const localesDir = resolve(projectRoot, "static/locales")
const outDir = resolve(projectRoot, "static/_locales")

const files = readdirSync(localesDir)
	.filter((f) => f.endsWith(".json"))
	.sort()

for (const file of files) {
	const lang = file.replace(/\.json$/, "")
	const source = JSON.parse(readFileSync(resolve(localesDir, file), "utf8"))
	const messages = {}
	for (const [key, value] of Object.entries(source)) {
		if (!key.startsWith(":")) continue
		if (typeof value !== "string" || !value) throw new Error(`${file}: ${key} must map to a non-empty string`)
		messages[key.slice(1)] = { message: value }
	}
	mkdirSync(resolve(outDir, lang), { recursive: true })
	writeFileSync(resolve(outDir, lang, "messages.json"), JSON.stringify(messages, null, "\t") + "\n")
}

console.log(`Wrote _locales for ${files.length} languages into static/_locales`)
