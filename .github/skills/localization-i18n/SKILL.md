---
name: localization-i18n
summary: |
  Localization / i18n skill: translation workflow, locale formatting, runtime
  fallbacks, and tooling for developer and translator workflows.
---

## Purpose
Practical guidance to internationalize UI strings, date/number formats, and
manage translations across web and mobile targets.

## When to use
- Adding new UI copy, switching to ICU message format, or integrating translation pipeline.

## Checklist
- Use message IDs, avoid string concatenation, prefer ICU pluralization.
- Provide runtime fallbacks to default locale.
- Extract strings to PO/JSON and keep a translation pipeline (Crowdin/Locize).

## Commands
- Extract strings and run linter for missing translations as a CI step.

## Outputs
- i18n guidelines, extraction script snippets, locale test helpers.
