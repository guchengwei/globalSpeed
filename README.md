# GlobalSpeed CE

Universal speed control for video and audio.

## About this fork

GlobalSpeed CE is an independently maintained, separately published fork of [polywock/globalSpeed](https://github.com/polywock/globalSpeed). It carries the same core feature set plus ongoing fixes and additions (such as continued Firefox support), published under its own add-on identity as **GlobalSpeed CE**. Because the extension uses its own add-on ID, existing **Global Speed** installations are treated as a different add-on: settings and storage do **not** migrate — configure the extension after installing CE.

## Install

Grab a build from the [GitHub releases](https://github.com/guchengwei/globalSpeed/releases), or install the signed Firefox add-on from [Mozilla Add-ons (AMO)](https://addons.mozilla.org/) once listed.

### Speed Control

- Set the speed once and forget: it automatically applies to all video and audio
- Define URL rules to auto-apply your favorite speeds on specific sites
- Compatible with YouTube, Netflix, Spotify, podcast sites, and more

### Media Hotkeys

- Conveniently change speed through customizable shortcuts
- Rewind/forward, frame-by-frame analysis, volume up/down and more
- Support for multiple trigger modes, including context menu and global shortcuts; control background music or PiP videos while using another app

### Filters & Effects

- Netflix movie too dark? Brighten it and dial in the contrast
- Video too quiet? Boost volume up to 600%
- Listen to songs or shows in a new way with pitch shift
- Optionally assign hotkeys to toggle filters and effects on the fly  
  _Audio Effects [Chromium Only]_

<img src="https://github.com/polywock/globalSpeed/blob/master/screenshot.png?raw=true" width="600">

## Build

1. `npm install` to install required dependencies.
1. `npm run dev` build unpacked version.
1. Load the unpacked folder
   1. Chrome: open extensions page, enable dev mode, load unpacked.
   1. Edge: open extensions page, load unpacked.

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
