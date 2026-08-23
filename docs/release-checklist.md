# AMO submission checklist (GlobalSpeed CE)

The human half of distributing GlobalSpeed CE to Firefox-based browsers (Firefox, Zen Browser,
and other Gecko forks) through a LISTED submission on [Mozilla Add-ons](https://addons.mozilla.org/).
CI ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) builds, lints, and attaches
the artifacts; this checklist covers everything a person must do, top to bottom.

## 1. Prerequisites

- A [Mozilla account](https://addons.mozilla.org/) with release permissions on the GlobalSpeed CE
  listing in the [AMO developer hub](https://addons.mozilla.org/developers/). For a first-ever
  submission, you just need the account; the listing is created in step 3.
- Push rights to `guchengwei/globalSpeed` (to bump versions and push tags).
- Node.js 22 installed locally if you need to build or lint by hand. Otherwise CI does all building.
- Know the version rule: versions are `3.4.x` and strictly increasing. Never reuse or decrease a
  version number, even for a failed or rolled-back submission (e.g. current: `3.4.116`).

## 2. Cut the release

1. Bump `version` in **both** [`staticCh/manifest.json`](../staticCh/manifest.json) and
   [`staticFf/manifest.json`](../staticFf/manifest.json) to the same next `3.4.x` value. They must
   match each other and the tag. CI derives the release title from `staticCh`'s version and warns
   when the pushed tag doesn't match it — but nothing cross-checks `staticFf`, so verify manually.
2. Commit the bump, then tag and push:

   ```sh
   git tag vX.Y.Z && git push origin master vX.Y.Z
   ```

3. Watch the **Release** workflow run in the Actions tab. It builds both zips plus the source
   bundle, gates on `web-ext lint`, and attaches the artifacts to a **draft** GitHub Release.
   - To dry-run the pipeline without tagging, trigger **Release** via _Run workflow_
     (`workflow_dispatch`) on any branch.
4. When the workflow is green, open Releases and confirm the draft exists, titled
   **GlobalSpeed CE vX.Y.Z**, with exactly three artifacts attached:
   - `global-speed-chromium.zip`
   - `global-speed-firefox.zip`
   - `source.zip`
5. Check the `web-ext lint` gate output. Expected baseline: **0 errors, ~8 warnings**, all
   upstream-inherited:
   - 2 × `data_collection_permissions` key vs. `strict_min_version: "128"` (key needs Gecko 128+;
     our minimum is exactly 128, so this is fine).
   - 6 × Chrome-only API references in code shared with the Chromium build.
   - Worry (stop and investigate) if: any **error** appears; the warning count jumps; or warnings
     name files/patterns you don't recognize as inherited shared code.
6. Review the draft, then publish it so the artifacts are publicly downloadable alongside the AMO
   listing.

## 3. Submit to AMO listed

1. Sign in to the [developer hub](https://addons.mozilla.org/developers/) and open the
   GlobalSpeed CE listing (first time: create it — the add-on name and ID are read from the
   manifest; the ID is `{6abd70e7-3878-4141-8391-384c83f0717f}`).
2. Upload `global-speed-firefox.zip` as a **new version** of the add-on.
3. When the submission asks for source code, upload `source.zip`. This is required because the
   extension zip is minified: AMO's automated tools and reviewers need unminified sources to
   validate what the shipped code does. Do not submit the minified zip alone.
4. Fill the version's **Review Notes** with the template from section 4, replacing every
   placeholder.
5. Confirm the channel is **listed**, check the submission declarations (source provided, no
   obfuscation intent), and submit for review.

## 4. Reviewer notes template

Copy into the AMO version's Review Notes field and fill the blanks:

```markdown
### What this extension does

GlobalSpeed CE is a universal playback-speed controller for video and audio, based on the upstream
project "Global Speed" (polywock/globalSpeed). It applies a chosen speed to all media on a page,
supports URL rules that auto-apply saved speeds on specific sites, provides hotkeys for
speed/rewind/volume control, and offers audio filters and effects. Users interact with it via the
toolbar popup, options page, and keyboard shortcuts.

### What this fork adds

This fork's functional delta is the **Keep Original Speed** feature set: media detected as a live
stream or music content plays at its natural rate instead of the enforced speed, while deliberate
user speed actions still apply to such media.

- Detection runs entirely locally — **no network requests** are made to any API. Signals come only
  from the page the user already opened: the element's duration, YouTube's on-page live badge,
  YouTube's page-declared category (read once from `ytInitialPlayerResponse` in page context),
  YouTube `<meta name="keywords">`, Bilibili tag elements in the DOM, and user-editable domain /
  title-keyword lists stored in local extension settings.
- Exempt media keeps its native rate; user-initiated speed changes pierce this until the media's
  classification changes or the page unloads.
- Options-page editors manage the domain/keyword lists (with restore-to-defaults); the popup shows
  a badge reflecting the current state.
- The add-on publishes under its own name and add-on ID — see "Fork relationship" below.

### Why a source bundle is attached

The uploaded add-on zip is produced by our build tooling (Vite + esbuild) and ships minified
JavaScript. Attached `source.zip` contains the corresponding unminified source tree: the same
revision this version was built from, including the build configuration needed to reproduce the
zip (`npm install`, then `npm run prodFf`; see its README.md). Please review the source bundle;
the minified files are its build output, not hand-written code.

### Data collection

This extension collects no data of any kind — nothing is transmitted to us or third parties, and
nothing is stored outside the user's own browser profile. This matches the manifest declaration
`browser_specific_settings.gecko.data_collection_permissions.required: ["none"]`.

### Host permissions

The extension requests broad host permissions (<all urls>) because speed control must be available
on any page where the user plays media — video sites, podcast sites, embedded players, and local
files. The content scripts expose no page data anywhere; they exist solely to detect media elements
and inject the player controls the user invokes. There is no background network activity tied to
these permissions.

### Fork relationship

GlobalSpeed CE is an independently maintained, separately published fork of polywock/globalSpeed,
rebranded under its own name and its own add-on ID ({6abd70e7-3878-4141-8391-384c83f0717f}) per our
rebranding decision (ADR-0003). We make no redistribution claims beyond those granted by the
project's license; ongoing fixes and additions are developed in our own repository.
```

## 5. After approval

1. Confirm the listing is live on [addons.mozilla.org](https://addons.mozilla.org/) and shows the
   correct version, name (**GlobalSpeed CE**), and screenshots/description.
2. In Zen Browser (or any Gecko browser with AMO support), install the add-on from its AMO listing
   page — not from the GitHub zip — to exercise the signed, reviewed artifact.
3. Smoke test on a video site and a music site:
   - Speed slider changes actual playback rate and sticks across navigation.
   - **Keep Original Speed**: live-stream mode keeps live streams pinned at 1x while normal videos
     stay at the chosen speed; music-mode toggles behave as configured.
   - The toolbar popup badge is currently absent — known and harmless; it returns when issue #9
     lands. Do not fail the smoke test over it.
4. If anything regressed vs. the previous AMO version, treat it as a blocker: disable the new
   version (section 6) rather than leaving users on a broken build.

## 6. Rollback / abuse handling

If a submitted or approved version turns out broken, maliciously abused, or flagged by Mozilla:

1. In the [developer hub](https://addons.mozilla.org/developers/), **disable the affected version**
   (or the entire listing if the problem is systemic). Disabling pulls it from distribution while
   keeping the record intact for Mozilla's review trail.
2. Yank the matching GitHub artifacts: edit (draft again or delete) the affected release so the
   bad zip is no longer downloadable. Prefer deleting the release's assets over leaving them up.
3. Investigate before resubmitting; the next submission must use a fresh, higher `3.4.x` version —
   never re-upload a yanked version number.
4. If Mozilla disabled the add-on themselves, follow the email instructions and respond through the
   hub's support thread; do not attempt to re-upload around a moderation action.
