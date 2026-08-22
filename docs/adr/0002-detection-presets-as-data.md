# Platform detection knowledge ships as data presets, not code branches

Live Stream / Music Content classification for known platforms is stored as editable preset data in extension state — typed entries of `DOMAIN` (e.g. `live.bilibili.com`) and `TITLE_KEYWORD` (e.g. `歌单`) grouped per Detection Channel with per-entry enable flags and restore-to-defaults. Site-specific extraction that requires code (YouTube category metadata, `duration === Infinity`, YouTube live badge) stays as built-in logic owned by the channel toggle.

Rejected alternative: extending the existing hardcoded hostname-flag pattern (`isWebsite.ts`) with more site branches. Every new platform would require shipping code; presets make platform additions pure data, editable by users without an update.

Constraint recorded: domain-level exemptions are only safe for platforms where *all* content qualifies (e.g. `music.youtube.com`). Mixed platforms like Twitch must rely on content signals instead.
