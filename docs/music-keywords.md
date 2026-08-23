# Music Content keyword presets

The maintained curation record for the Music Content Detection Channel's `TITLE_KEYWORD` seeds. `DEFAULT_MUSIC_KEYWORDS` in [`src/defaults/index.ts`](../src/defaults/index.ts) implements this document; the regression harness [`tools/diag/music-keyword-seeds.mjs`](../tools/diag/music-keyword-seeds.mjs) pins both the list and its matching semantics. Keywords are the primary Music Content signal for user-uploaded mixes, covers, and edits that carry no domain or media-category signal.

## How matching works

- ASCII keywords compile to case-insensitive **word-boundary** regexes: `mix` hits "dj mix" but never "mixed" or "remix". `\b` treats CJK characters as non-word, so a boundary-bound seed still matches flush against CJK neighbors ("KTV点歌").
- Non-ASCII (CJK or mixed-script) keywords match as **lowercased substrings**: `作業用BGM` hits mid-title without any boundary requirement.
- Match sources per pass: the frame's `document.title`, the mediaSession metadata title (YouTube only), and platform keyword tags; the YouTube Mix URL signal (`list=RD…`) is separate and lives in `exemption.ts`.

## English seeds (15)

| Keyword                | Why it ships                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `official music video` | Standard label on official channel uploads of music videos.                                                                              |
| `lyric video`          | Common version descriptor for lyric-only uploads.                                                                                        |
| `song`                 | Generic descriptor word ("new song"); boundaries keep "songwriter" out.                                                                  |
| `songs`                | Plural companion ("top songs", "songs to sleep to").                                                                                     |
| `unplugged`            | Acoustic-session version naming convention (MTV Unplugged lineage).                                                                      |
| `instrumental`         | No-vocal version descriptor on covers and karaoke tracks.                                                                                |
| `karaoke`              | Karaoke backing-track uploads label themselves with it.                                                                                  |
| `nightcore`            | Sped-up remix scene naming convention.                                                                                                   |
| `slowed`               | The slowed + reverb edit scene's own descriptor.                                                                                         |
| `sped up`              | The other half of the sped-up/slowed edit scene.                                                                                         |
| `medley`               | Multi-song medley uploads.                                                                                                               |
| `vocaloid`             | Romanized Vocaloid scene tag; boundary-matched so it stays precise.                                                                      |
| `concert`              | Full concert film uploads.                                                                                                               |
| `m/v`                  | Slash form used widely on official K-pop uploads; the escaped boundary builder matches the literal slash form.                           |
| `mix`                  | User-uploaded DJ/channel mixes; deliberate reversal of the substring-era exclusion — boundaries make "mixed"/"remix"/"megamix" safe now. |

## Japanese seeds (12)

| Keyword        | Why it ships                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `歌ってみた`   | "I tried singing" — utattemita cover culture on Niconico/YouTube.                                                               |
| `弾いてみた`   | "I tried playing" — instrumental cover culture.                                                                                 |
| `踊ってみた`   | "I tried dancing" — odotteta dance-cover culture.                                                                               |
| `作業用BGM`    | "work BGM" study/work playlist culture; mixed-script, so substring-matched (the standalone `bgm` seed already covers bare BGM). |
| `ボカロ`       | Katakana shorthand for Vocaloid music.                                                                                          |
| `VOCALOID`     | Romanized brand form as written by JP uploaders; pure ASCII, so word-boundary matched.                                          |
| `ミュージック` | Katakana "music" as in ミュージックビデオ titles.                                                                               |
| `歌詞`         | "Lyrics" in JP lyric-video titles.                                                                                              |
| `邦楽`         | Japanese popular music category term.                                                                                           |
| `洋楽`         | Western music category term.                                                                                                    |
| `アニソン`     | Anime-song genre term.                                                                                                          |
| `メドレー`     | Katakana "medley".                                                                                                              |

## Chinese seeds (15)

| Keyword    | Why it ships                                                                       |
| ---------- | ---------------------------------------------------------------------------------- |
| `原创`     | "Original work" marker (原创音乐).                                                 |
| `单曲`     | "Single" release uploads.                                                          |
| `新歌`     | "New song" chart/radio naming (新歌推荐).                                          |
| `热歌`     | "Hot song" charts.                                                                 |
| `金曲`     | Golden-classic songs (年度金曲).                                                   |
| `歌曲`     | Generic "song(s)".                                                                 |
| `伴奏`     | Instrumental/backing-track uploads.                                                |
| `原声`     | Original soundtrack (OST) uploads.                                                 |
| `演奏`     | Instrumental performance covers.                                                   |
| `全曲`     | "Full song" uploads, as opposed to previews or cuts.                               |
| `曲目`     | Track/tracklist naming.                                                            |
| `卡拉OK`   | Karaoke; mixed-script, so substring-matched.                                       |
| `KTV`      | Karaoke-venue shorthand; boundary-matched, still hits flush against CJK neighbors. |
| `音乐现场` | Live music performance sessions.                                                   |
| `歌回`     | VTuber singing-stream archive naming (歌回/歌枠 culture).                          |

## Deliberately excluded

| Candidate  | Why excluded                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `live`     | Ambiguous everyday sense ("live your life"), and live content belongs to the Live Stream channel anyway. |
| `audio`    | Too generic — tech reviews, audio settings, audiobooks.                                                  |
| `acoustic` | Gear/panel/product contexts dominate; `unplugged` already carries the version-descriptor use.            |
| `session`  | Dev/coding/studio-talk usage dwarfs the jam-session sense.                                               |
| `festival` | News, lineup, outfit, and travel content dominate.                                                       |
| `band`     | Elastic bands, wedding bands, band gossip — noise outweighs signal.                                      |
| `track`    | "Track order/package", track & field sports.                                                             |
| `video`    | Far too generic; nearly every title contains it.                                                         |
| `フル`     | Substring-matches fruit words like フルーツ under CJK semantics; no safe boundary exists.                |

## Maintenance

To add keywords: either edit `DEFAULT_MUSIC_KEYWORDS` in `src/defaults/index.ts` (keep the EN → JP → CN grouping, add a one-line rationale here, extend the harness) — or, per user, use the preset editor under options' Keep Original Speed → Music Content.

**Storage caveat:** users who saved custom presets keep theirs; the expanded list applies to fresh installs and restore-defaults only. Stored keyword slices are never rewritten by schema migrations, so existing installs pick up new seeds solely through the preset editor's Restore Defaults button.
