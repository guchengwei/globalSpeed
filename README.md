# GlobalSpeed CE

Universal playback-speed control for video and audio — set a speed once and every site obeys. Works with YouTube, Netflix, Twitch, Spotify, podcast sites, and more.

<img src="screenshot.png" width="600">

## The original work

This project descends from [Global Speed](https://github.com/polywock/globalSpeed) by [polywock](https://github.com/polywock): a mature browser extension whose core idea is one-shot speed control everywhere — pick 2× once and YouTube, Netflix, Twitch, lectures, and podcasts all play at 2×. It also ships customizable media hotkeys (rewind/forward, frame stepping, volume up/down), URL rules for per-site speeds, and video filters & effects (brightness, volume boost beyond 100%, pitch shift). The original remains available from the [Chrome Web Store](https://chrome.google.com/webstore/detail/jpbjcnkcffbooppibceonlgknpkniiff), [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/mjhlabbcmjflkpjknnicihkfnmbdfced), and [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/global-speed/).

## What this fork adds

GlobalSpeed CE is an independently maintained fork. The original's features all still work; this repository extends them:

- **Keep Original Speed** — the headline addition. Media classified as a live stream or music keeps its natural rate instead of the enforced speed, while deliberate speed changes you make still apply:
  - **Live Stream channel** — detects real-time media from infinite duration signals, YouTube's rendered live badge, and platform tag signals; whole-domain presets (Bilibili Live, Douyu, Huya) catch dedicated streaming sites without exempting their VODs. On Twitch, lives keep real-time pace automatically while VODs stay enforceable — `twitch.tv` is deliberately absent from the domain presets so VODs never get blanket-exempted.
  - **Music Content channel** — recognizes music via domain presets, YouTube's page-declared category, and title keywords over a curated trilingual list.
  - **Editable presets** — each channel ships built-in domain/title-keyword lists you edit as plain textboxes (with comment syntax) and restore to defaults anytime.
  - **Manual marks** — label any page Music or Live from the popup, or mark it "normal video" to force enforcement no matter what the automatic channels say; every media row badges its exempt/override state.
  - **Fully local** — classification reads only the page you opened; no network requests, ever. Debugging a misclassification? Set `localStorage.gsKosTrace = "1"` and reload for per-flip channel traces in the console.
- **Bulk shortcut toggles** — enable/disable media hotkeys individually or check/uncheck an entire shortcut section at once.
- **Fixed Firefox injection** — the MAIN-world content script loads through a dedicated loader on Gecko.
- **Standalone releases** — published under its own add-on identity so it installs alongside the original; CI-built zips gated by `web-ext lint`, each shipping the matching unminified source.
- **No promotions** — the popup self-promo card and donation links are gone.

## Install

Download straight from this repository's [**Releases page**](https://github.com/guchengwei/globalSpeed/releases/latest). Every release ships:

| Artifact                    | For                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `global-speed-chromium.zip` | Chrome, Edge, Brave, and other Chromium browsers                                                              |
| `global-speed-firefox.zip`  | Firefox and Gecko-based browsers. This **is** an XPI (a ZIP with `manifest.json` at its root); rename a copy to `.xpi` wherever a picker insists on that extension |
| `source.zip`                | Unminified source of the exact released build — required by Mozilla review, and handy for auditing            |

### Chromium browsers

1. Download and unzip `global-speed-chromium.zip`.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

### Firefox

A signed listing on [Mozilla Add-ons](https://addons.mozilla.org/) is being prepared. Until it appears there:

- **Temporary try-out** — open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick the downloaded `global-speed-firefox.zip`. The add-on is removed when Firefox restarts.
- **Permanent install** — requires Firefox Developer Edition / Nightly (or any build where you can set `xpinstall.signatures.required` to `false` in `about:config`). Rename the download to `global-speed-firefox.xpi`, then open `about:addons` → gear icon → **Install Add-on From File…**.

Release builds are unsigned because AMO signing requires passing Mozilla review; `source.zip` exists so you can audit precisely what you install.

### Coming from upstream Global Speed?

CE publishes under its own add-on ID, so browsers treat it as a different add-on. You can run both side by side, but existing **Global Speed** settings do **not** migrate — configure CE after installing.

## Features

### Inherited from Global Speed

- Set the speed once and forget: it automatically applies to all video and audio
- Define URL rules to auto-apply your favorite speeds on specific sites
- Media hotkeys: rewind/forward, frame-by-frame analysis, volume up/down and more — triggered by page keys, browser shortcuts, or context-menu items; control background music or PiP videos while using another app
- Filters & effects: brighten dark movies, boost volume past the browser maximum, pitch shift — optionally bound to hotkeys (_audio effects: Chromium only_)

## Build

```sh
npm install
npm run dev      # Chromium build → build/unpacked
npm run devFf    # Firefox build  → buildFf/unpacked
```

Production zips: `npm run prod`, `npm run prodFf`. Firefox-specific build notes live in [`firefox-build.md`](firefox-build.md).

## Releasing

1. Merge a PR into `master` to trigger CI. The workflow checks manifest parity, bumps both
   manifests to the next unused patch version when needed, commits that bump, and creates the
   matching `vX.Y.Z` tag. Manually pushed versioned tags remain supported.
2. CI ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the Chromium zip,
   Firefox zip, and AMO source zip, gates on `web-ext lint`, then attaches all three to a
   **draft** GitHub Release.
3. Review the draft's artifacts, then publish the release.
4. Firefox: a human uploads `global-speed-firefox.zip` plus `source.zip` to
   [AMO](https://addons.mozilla.org/developers/) for the listed submission —
   follow [`docs/release-checklist.md`](docs/release-checklist.md).
5. To dry-run the pipeline on a branch without tagging, trigger **Release** from the Actions tab.
6. If `static/locales/` changed, run `node tools/genLocales.mjs` and commit the regenerated `static/_locales`.

## Privacy

GlobalSpeed CE collects nothing: no analytics, no network requests, nothing stored outside your browser profile. See [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md).

## Disclaimer

- GlobalSpeed CE is an independent, unofficial fork. It is not affiliated with, sponsored by, or endorsed by polywock or the upstream Global Speed project.
- The software is provided "as is", without warranty of any kind. Use it at your own discretion.
- Firefox artifacts here are self-published and unsigned; review `source.zip` before installing if that matters to you.
- Site and product names (YouTube, Netflix, Twitch, Spotify, …) are trademarks of their respective owners, referenced solely to describe compatibility.
