# LCYT Design System

## Overview

LCYT uses a shared design token system to maintain visual consistency across multiple products:
- **lcyt-site** — Astro-based marketing/documentation site
- **lcyt-web** — React-based web application

Both projects import the same CSS variables from the `packages/shared-styles/` package, ensuring that:
- Color palettes match
- Typography scales are consistent
- Spacing and layout patterns align
- Dark mode is supported uniformly

## Architecture

```
packages/
├── shared-styles/               # Shared design tokens (CSS variables)
│   ├── tokens.css              # Single source of truth for design
│   ├── package.json            # Published as npm package
│   └── README.md               # Token reference
├── lcyt-site/                  # Astro site
│   └── src/styles/global.css   # @import 'shared-styles/tokens.css'
└── lcyt-web/                   # React app
    └── src/styles/             # Reset CSS imports shared tokens
```

## Design Tokens

All design decisions are encoded as CSS custom properties:

### Color System
- **Primary**: `#4daae6` — main UI color
- **Accent**: `#cb0000` — secondary highlight
- **Semantic**: Success, error, warning colors
- **Neutral**: Text, backgrounds, borders (light + dark variants)

### Typography
- System font stack (no external fonts)
- Size scale: xs (0.72rem) → 4xl (3rem)
- Line height variants: tight (1.3), normal (1.6), relaxed (1.8)

### Spacing
Consistent scale used for margins, padding, gaps:
- xs (0.25rem) → 4xl (4rem)
- All layouts use this scale for rhythm

### Components
- **Shadows**: Four intensity levels for depth
- **Radius**: Five sizes from sharp (3px) to pill (9999px)
- **Transitions**: Three speeds for consistent motion

## Usage Guide

### For lcyt-site (Astro)

The global styles automatically inherit all design tokens via CSS custom properties:

```css
/* src/styles/global.css already imports: */
@import 'shared-styles/tokens.css';
```

Create component stylesheets that reference variables:

```astro
---
// src/components/MyComponent.astro
---
<div class="my-component">
  <h2>Title</h2>
  <p>Content</p>
</div>

<style>
  .my-component {
    padding: var(--spacing-lg);
    border-radius: var(--radius-lg);
    color: var(--color-text);
    background: var(--color-bg);
  }

  .my-component h2 {
    color: var(--color-primary);
    font-size: var(--font-size-xl);
  }
</style>
```

### For lcyt-web (React)

Import tokens in your app's main CSS file (before component styles):

```css
/* src/main.css */
@import 'shared-styles/tokens.css';

/* Your app styles follow */
```

Use variables in CSS modules or inline styles:

```css
/* Button.module.css */
.button {
  background: var(--color-primary);
  color: white;
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  transition: background var(--transition-base);
}

.button:hover {
  background: var(--color-primary-dark);
}
```

```jsx
// Button.jsx
import styles from './Button.module.css';

export function Button({ children, ...props }) {
  return (
    <button className={styles.button} {...props}>
      {children}
    </button>
  );
}
```

### Dark Mode

Dark mode is handled automatically via CSS media queries. When users enable dark mode in their OS:

```css
/* In tokens.css */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1a1a1a;
    --color-text: #f0f0f0;
    /* ... other adjustments ... */
  }
}
```

No component code changes are needed — CSS variables automatically update.

## Guide Page Components (lcyt-site)

Three reusable components help create consistent guide pages:

### GuideHeader

Shows the page title, subtitle, estimated reading time, and quick navigation:

```astro
---
import GuideHeader from '../../components/GuideHeader.astro';
---

<GuideHeader
  title="Getting Started with LCYT"
  subtitle="Learn the basics in 5 minutes"
  estimatedTime="5 min read"
  sections={[
    { id: 'setup', label: 'Setup' },
    { id: 'first-caption', label: 'Send First Caption' },
  ]}
/>
```

### GuideSection

Wraps content with proper semantic HTML and consistent typography:

```astro
---
import GuideSection from '../../components/GuideSection.astro';
---

<GuideSection title="Installation" id="setup">
  <p>First, install LCYT:</p>
  <pre><code>npm install lcyt</code></pre>
</GuideSection>
```

### GuideNote

Highlights important information with visual distinction:

```astro
---
import GuideNote from '../../components/GuideNote.astro';
---

<GuideNote type="tip" title="Pro Tip">
  Use the keyboard shortcut <code>Ctrl+S</code> to quickly send captions.
</GuideNote>

<GuideNote type="warning">
  Make sure your stream key is kept secret!
</GuideNote>
```

## Creating New Guide Pages

To add a new guide page for lcyt-site:

1. **Create markdown content** in `/docs/guide-web/` or `/docs/guide-cli/`:
   ```markdown
   ---
   title: "My Guide Title"
   order: 5
   ---

   # My Guide Title

   Content here...
   ```

2. **Content is automatically** picked up by `packages/lcyt-site/src/pages/guide/index.astro`

3. **Use guide components** in the Astro layout for consistent styling

4. **Test locally**:
   ```bash
   npm run web      # Build lcyt-web (required before site)
   npm run build:site  # Build lcyt-site
   ```

## Landing Page Design

The landing page (`packages/lcyt-site/src/pages/index.astro`) showcases:

- **Hero section** with tagline
- **Bilingual comparison** (English/Finnish) with draggable divider
- **Six card grid** linking to different sections
- **Responsive layout** that adapts to mobile

All styling uses design tokens for consistency. Key elements:

```astro
<!-- Hero -->
<section class="hero">
  <h1>{title}</h1>
  <p>{description}</p>
</section>

<!-- Speech bubble with bilingual content -->
<div class="speech-bubble">
  <!-- Interactive comparison widget -->
</div>

<!-- Card grid -->
<div class="cards-grid">
  <a class="card" href="...">
    <span class="card__emoji">📦</span>
    <div class="card__body">
      <h2>Title</h2>
      <p>Description</p>
    </div>
  </a>
</div>
```

## Customization

To update the design system:

1. **Edit tokens** in `packages/shared-styles/tokens.css`
2. **Update documentation** in `packages/shared-styles/README.md`
3. **Verify** changes work in both lcyt-site and lcyt-web
4. **Test dark mode** in browser DevTools
5. **Commit** changes with descriptive message

Example: Adding a new semantic color

```css
/* tokens.css */
:root {
  --color-info: #0ea5e9;
  --color-info-bg: #f0f9ff;
  --color-info-border: #bae6fd;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-info: #0284c7;
    --color-info-bg: #001f3f;
    --color-info-border: #0369a1;
  }
}
```

## Maintenance

### Adding a New Variable

1. Add to `tokens.css` with light and dark variants
2. Document in `packages/shared-styles/README.md`
3. Test in both projects
4. Update any relevant component examples

### Removing a Variable

1. Search both projects for usage
2. Replace with appropriate alternative
3. Remove from `tokens.css`
4. Update documentation

### Breaking Changes

Changes to variable names or values should be:
1. Communicated in commit messages
2. Documented in release notes
3. Tested across both products
4. Possibly versioned if released to external packages

## Performance

The design system is optimized for performance:

- **CSS variables only** — no runtime JavaScript
- **No external fonts** — system font stack
- **No CDN dependencies** — everything is local
- **Minimal CSS** — only what's needed
- **Dark mode via media queries** — native browser support

Typical bundle impact: < 2KB minified CSS

## Browser Support

- All modern browsers (Chrome, Firefox, Safari, Edge)
- CSS custom properties: IE 11 not supported (but that's OK)
- Dark mode: All modern browsers via `prefers-color-scheme`

## References

- CSS Variables: [MDN Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- Dark Mode: [MDN prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme)
- Design Tokens: [Design Systems 101](https://www.nngroup.com/articles/design-systems-101/)
