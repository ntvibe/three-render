# Contributing to Three Render

Bug reports, focused improvements, documentation, and rendering evidence are welcome.

## Development

Use Node.js 22 or newer and npm.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Before proposing a change:

```sh
npm run assets:generate
npm run check:public
npm test
npm run build
```

For interaction changes, test the real app in a separate browser profile or isolated context. Preserve existing local scenes. Include reproduction steps, browser/GPU details, and before/after evidence where relevant. Use synthetic examples instead of confidential or personal projects.

## Pull requests

Explain the problem, the resulting behavior, and how you verified it. Keep changes focused and extend existing document/store/renderer mechanisms. Add meaningful regression checks for correctness bugs. A build alone does not verify viewport behavior.

Document renderer limitations honestly. Shader changes need rendered comparisons against controls; a new setting or slider does not prove a rendering capability. Maintain project-file compatibility and undo/redo behavior.

## Asset policy

All bundled creative assets must be public domain or explicitly dedicated under **CC0-1.0**. Attribution-required, noncommercial, editorial-only, subscription, proprietary, and unknown-license assets are not accepted. Do not remove a creator's notice and re-label their work. Replace it with an independently created or verified CC0 asset.

Record the creator, source, license URL, and checksum in `public/assets/manifest.json`. Regenerate original assets with `npm run assets:generate`. Do not add unreviewed files to `public/`. Original icon artwork and example scenes use CC0-1.0 too. Do not attach screenshots containing third-party models or private project data to the repository.

Software dependencies follow their own licenses. After changing production dependencies, run `npm run notices:generate` and review `THIRD_PARTY_NOTICES.md`.

Code contributions are under the project's MIT license. Contributions of creative assets must use CC0-1.0 and have a traceable source or an explicit original-work dedication.
