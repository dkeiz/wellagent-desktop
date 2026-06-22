# Android Release Folder

Keep only the current installable APK and its matching `<apk>.metadata.json` file here.

Rules:

- Prefer versioned filenames.
- Keep one current APK in Git history to limit repo bloat.
- Move older APKs to `mobile/dist/archive/` locally or to GitHub Release assets.
- The desktop companion download endpoint scans this folder first.
