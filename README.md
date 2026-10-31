# GitHub keyvault

Holds your GitHub access, so your services don't: your own GitHub App, made once with one click on GitHub and installed on your repositories. You hand each project the repositories it gets (only you do), and your services that use it (GitHub access, GitHub releases) get short-lived access derived from your App, cut to those repositories and to the rights their contracts declare.

It's yours, shown in Keys & devices, never in a project. A service reaches it only by calling its own node: Weave checks that the service is yours, that its contract declares this use (you agreed when you added it), and that it asks for one of its projects and for repositories you handed that project. Then the keyvault mints an installation token for exactly that, and Weave logs it. The App's key stays sealed on your computer: Weave signs the App's JWTs, and no code ever reads the key.

The App asks GitHub for Administration (write: adding and removing collaborators), Contents (read: release files) and Metadata (read). No webhook.

## Where it lives

This repository is its only source. Weave ships it by pinning one of its releases (Weave's
`packages/shipped/pinned.json`: this repository, a tag and the archive's SHA-256), so what Weave ships is exactly
the file released here. A new version: tag it here, then move the pin in Weave.

## Building and releasing

```
npm install
npm run build              # → github-keyvault.wasm
```

A tag `v*` builds it on GitHub and attaches `weave-github-keyvault.tar.gz` (the component, `weave.app.json` and this README) to a
release (`.github/workflows/release.yml`).

`wit/service.wit` is Weave's service interface (`packages/sdk/wit` in Weave's repository), copied here to build against.
