# Repository Guidelines

## Project Structure & Module Organization
This repository is an Electron app. Main-process code lives in `src/main`, with ADB lifecycle code in `src/main/adb` and local proxy code in `src/main/proxy`. The preload bridge is `src/preload/index.js`. Renderer HTML, JS, CSS, and bundled browser-side libraries live in `src/renderer`. Build assets and icons are in `assets/` and `img/`. Packaging-only ADB binaries are staged in `bundled-tools/platform-tools`. Utility and manual verification scripts live in `scripts/`.

## Build, Test, and Development Commands
- `npm start`: run the Electron app locally.
- `npm run prepare:platform-tools`: download platform-tools into `bundled-tools/platform-tools` for packaging.
- `npm run build`: build with `electron-builder.yml`.
- `npm run build:win`, `npm run build:mac`, `npm run build:linux`: platform-specific builds.
- `npm run debug:auto` or `npm run debug:screenshot`: quick UI/debug helpers.
- `node scripts/test-browser-features.js` or other `scripts/test-*.js`: ad hoc verification scripts. There is no formal unit test suite yet.

## Coding Style & Naming Conventions
Use plain JavaScript with CommonJS modules, 2-space indentation, semicolons, and single quotes. Prefer descriptive names over abbreviations. Use `camelCase` for variables/functions, `PascalCase` for classes, and lowercase filenames unless existing files establish a pattern such as `README.md`. Keep renderer logic in `src/renderer/app.js`; keep ADB-specific logic under `src/main/adb`.

## Testing Guidelines
Testing is script-driven. Add focused validation scripts in `scripts/` when fixing nontrivial behavior, especially around ADB startup, window events, and SSH/terminal flows. Name them by behavior, for example `test-ssh-connection.js`. Before release work, verify the relevant path locally and check application logs under `%APPDATA%/adb-proxy-browser/logs/app.log`.

## Commit & Pull Request Guidelines
Follow the existing commit style: `fix: ...`, `feat: ...`, `chore: ...`, `ci: ...`. Keep subjects short and imperative. For releases, use a separate version bump commit such as `chore: bump version to 0.7.49`. PRs should state user-visible impact, platform scope, and validation performed. Include screenshots for renderer changes and call out any packaging or workflow changes that affect release artifacts.

## Packaging Notes
Release builds must use `electron-builder.yml`. The embedded ADB flow depends on `extraResources` copying `bundled-tools/platform-tools` into `resources/platform-tools`, so avoid splitting build config across multiple sources without updating both the workflow and packaging commands.
