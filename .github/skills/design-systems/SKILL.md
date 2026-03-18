---
name: design-systems
summary: |
  Design Systems skill: design tokens, shared components, Storybook/preview,
  cross-platform theming and accessibility-first tokens.
---

## Purpose
Provide a reproducible approach to design tokens, component libraries, and
cross-platform themes used across the web UI, Astro site, and Android TV.

## When to use
- Adding or changing color/space/font tokens, or creating shared components.
- Building Storybook previews or preview pages for DSK templates.

## Checklist
- Centralize tokens (colors, spacing, fonts) and expose via CSS variables.
- Create visual preview pages (Astro) and Storybook stories for each component.
- Ensure tokens cover high-contrast and TV-safe themes.
- Publish versioned design token package if needed.

## Commands
- Storybook (if present): `npm run storybook -w packages/lcyt-site` (or follow repo-specific scripts).

## Outputs
- Token patches, story templates, migration notes, preview pages.
