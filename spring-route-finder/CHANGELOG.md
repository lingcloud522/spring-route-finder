# Changelog

## 0.1.5

- Declared the source repository in the manifest now that the project is public on GitHub.

## 0.1.4

- All user-facing text, documentation and code comments are now in English.
- Command titles, setting descriptions and extension metadata translated.

## 0.1.3

- Documentation rewritten as a Marketplace listing; internal distribution notes removed.
- Examples in the docs, UI strings and tests now use a generic login endpoint
  (`api/v1/auth/login`).

## 0.1.2

- Added the metadata required by the Marketplace: icon, LICENSE, keywords, banner.
- README gained an English summary and a privacy section.

## 0.1.1

- Security hardening: the method declaration match is anchored to line starts and limited
  to a window after the annotation, which removes quadratic backtracking on malformed
  files (the same crafted sample dropped from 35.4s to 6ms).
- Added `springRouteFinder.maxFileSizeKb` and `springRouteFinder.maxTotalSizeMb`; files
  are filtered by size before they are read.
- Line numbers now come from a precomputed line index instead of recounting newlines for
  every route.

## 0.1.0

- Declared support for Restricted Mode, so the extension also works in untrusted
  workspaces.

## 0.0.1

- First release: resolve a Spring Controller handler from an API path, with keyboard
  shortcuts, selection lookup, multi-path support and cross-file constant resolution.
