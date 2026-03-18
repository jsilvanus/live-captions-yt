---
name: android-tv
summary: |
  Android TV skill: Kotlin + Compose for TV guidance, deep-links, signing, and
  TV UX/readability best practices.
---

## Purpose
Practical guidance for `android/lcyt-tv` to ensure readable TV UX, deep-link
support, and build/signing pipelines.

## When to use
- Implementing viewer features, D-pad navigation, or deep-link QR flows.
- Preparing release builds and CI signing steps.

## Checklist
- Large readable typography and generous spacing.
- D-pad focus states and predictable navigation order.
- Settings persistence in `SharedPreferences` and deep-link handling.
- CI: configure signing keys securely (GitHub Secrets or CI vault).

## Commands
- Build debug APK:

```bash
cd android/lcyt-tv
./gradlew assembleDebug
```

## Outputs
- UI review checklist, emulator test steps, signing CI snippets.
