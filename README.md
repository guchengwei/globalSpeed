# Global Speed

Universal speed control for video and audio.

## Install the [Edge](https://microsoftedge.microsoft.com/addons/detail/mjhlabbcmjflkpjknnicihkfnmbdfced), [Firefox](https://addons.mozilla.org/firefox/addon/global-speed/), or [Chrome](https://chrome.google.com/webstore/detail/global-speed-youtube-netf/jpbjcnkcffbooppibceonlgknpkniiff) extension.

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
   [AMO](https://addons.mozilla.org/developers/) for the listed submission.
5. To dry-run the pipeline on a branch without tagging, trigger **Release** from the Actions tab.
