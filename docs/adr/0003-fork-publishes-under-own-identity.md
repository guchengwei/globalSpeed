# The fork publishes under its own store identity

This repository is a fork of polywock/globalSpeed, whose upstream listing already occupies the "Global Speed" name on stores. To distribute to Firefox-based browsers (e.g. Zen) via an AMO **listed** submission, the fork must publish under a fresh gecko GUID and a distinct display name — the inherited GUID cannot carry a second developer listing, and sharing it would make fork and upstream installs clobber each other. Chromium Web Store distribution is deliberately out of scope for v1 (upstream already serves those users); releases target AMO only.

Consequences accepted: users migrating from upstream must uninstall/reinstall (extension storage does not follow a GUID change — acceptable because this fork's delta is new, stateless-until-now features); versions continue the upstream 3.4.x line, monotonically increasing per AMO rules; `main` periodically merges upstream, and releases always cut from the fork's own main.
