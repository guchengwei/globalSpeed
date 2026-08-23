# GlobalSpeed CE

Universal playback-speed control for video and audio — set a speed once and every site obeys.

<img src="screenshot.png" width="600">

## Install

Download straight from this repository's [**Releases page**](https://github.com/guchengwei/globalSpeed/releases/latest). Every release ships:

| Artifact                    | For                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `global-speed-chromium.zip` | Chrome, Edge, Brave, and other Chromium browsers                                                                    |
| `global-speed-firefox.zip`  | Firefox and Gecko-based browsers                                                                                    |
| `source.zip`                | Unminified source for the matching version (required by Mozilla review; also handy if you want to audit or rebuild) |

### Chromium browsers

1. Download and unzip `global-speed-chromium.zip`.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

### Firefox

The signed build is distributed through [Mozilla Add-ons (AMO)](https://addons.mozilla.org/) — grab it there once listed. Until then you can run the release zip by unzipping it and loading it via `about:debugging` → **This Firefox** → **Load Temporary Add-on** (removed on restart), or permanently in Firefox Developer Edition / Nightly with `xpinstall.signatures.required` set to `false`.

### Coming from upstream Global Speed?

GlobalSpeed CE is an independently maintained, separately published fork of [polywock/globalSpeed](https://github.com/polywock/globalSpeed) under its own add-on ID. Because the ID differs, browsers treat it as a different add-on: existing **Global Speed** settings do **not** migrate — configure CE after installing.

## Features

### Speed control

- Set the speed once and forget: it automatically applies to all video and audio
- Define URL rules to auto-apply your favorite speeds on specific sites
- Compatible with YouTube, Netflix, Spotify, podcast sites, and more

### Keep Original Speed

- Live streams and music content stay at their natural rate instead of the enforced speed
- Detection channels for Live Stream and Music Content, each with editable domain/title-keyword presets you can restore to defaults
- Mark any page yourself from the popup to override automatic classification

### Media hotkeys

- Conveniently change speed through customizable shortcuts — enable or disable them individually, or check/uncheck an entire shortcut section at once
- Rewind/forward, frame-by-frame analysis, volume up/down and more
- Multiple trigger modes: page keys, browser shortcuts, and context-menu items; control background music or PiP videos while using another app

### Filters & effects

- Netflix movie too dark? Brighten it and dial in the contrast
- Video too quiet? Boost volume up to 600%
- Listen to songs or shows in a new way with pitch shift
- Optionally assign hotkeys to toggle filters and effects on the fly
  _Audio Effects [Chromium Only]_

## Build

```sh
npm install
npm run dev      # Chromium build → build/unpacked
npm run devFf    # Firefox build  → buildFf/unpacked
```

Production zips: `npm run prod`, `npm run prodFf`. Firefox-specific build notes live in [`firefox-build.md`](firefox-build.md).

## Releasing

1. Push a tag to cut a release: `git tag vX.Y.Z && git push origin vX.Y.Z`
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
