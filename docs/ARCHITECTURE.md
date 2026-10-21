# Architecture

Three Render is a browser-only React/Vite/TypeScript application. It has no required server-side storage, analytics service, or account system.

## Document and state

`src/core/types.ts` defines the serializable project, scene nodes, assets, cameras, lights, and materials. `src/state/editorStore.ts` owns document mutations, selections, lock guards, and snapshot-based undo/redo. Add operations through this layer so document changes remain undoable and consistent.

`src/core/persistence.ts` manages IndexedDB autosave and `.studio.json` files. The legacy storage key is intentionally retained so existing local scenes remain accessible. Imported self-contained models and environments are embedded in the project as data URLs.

Parametric values belong to individual scene instances. Baking produces serializable geometry. Shared material records use explicit bindings and scoped editing. Isolation is a runtime visibility mask separate from authored Hide/Show state.

## UI and runtime

`src/App.tsx` composes a menu bar, tool strip, resizable scene/viewport/inspector docks, library, and status bar. Components live in `src/components/`; shared original CC0 icons live in `src/icons.tsx`. `src/styles.css` and `src/editor.css` define the visual system.

`src/components/Viewport.tsx` bridges document snapshots into the imperative `EditorEngine`. The engine owns Three.js runtime objects, controls, camera navigation, environment loading, material updates, exports, and progressive rendering. Keep transient rendering state out of project history where practical.

`src/engine/spectralDispersion.ts`, `realtimeGlass.ts`, and `areaShadows.ts` contain version-sensitive extensions to installed rendering dependencies. Their regression checks must be revisited when those dependencies change.

## Validation

`npm test` runs Vite-transformed SSR regressions without opening a browser. Real interaction, GPU output, asset imports, and export results need browser verification too. `npm run build` checks application TypeScript and produces a static bundle.

`npm run check:public` audits candidate Git files, checks prohibited legacy branding, private paths and common secret patterns, and requires CC0 provenance for every bundled creative asset. This is a focused release check, not a complete secret-scanning or copyright-verification service.
