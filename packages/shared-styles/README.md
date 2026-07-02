# Shared Design Tokens

This package provides shared design tokens (CSS variables) and base styles for both the LCYT site (lcyt-site) and web app (lcyt-web).

## Overview

The LCYT design system is built on CSS custom properties (variables) that define:
- **Colors** — primary, accent, semantic colors (success, error, warning)
- **Typography** — font families, sizes, line heights
- **Layout** — spacing scale, sidebar widths, navigation heights
- **Components** — shadows, border radii, transitions
- **Dark mode** — automatic dark theme support via `prefers-color-scheme`

## Usage

### For lcyt-site (Astro)

Import the tokens in your global styles:

```css
/* src/styles/global.css */
@import 'shared-styles/tokens.css';
```

The tokens are automatically available throughout your Astro components via CSS custom properties like:
```css
color: var(--color-primary);
padding: var(--spacing-lg);
border-radius: var(--radius-md);
```

### For lcyt-web (React + Vite)

Import the tokens in your main styles file:

```css
/* src/main.css or src/index.css (before your app styles) */
@import 'shared-styles/tokens.css';
```

Then use the CSS variables in your component styles:

```jsx
// Example component
export function MyComponent() {
  return (
    <div style={{ color: 'var(--color-primary)' }}>
      Styled text
    </div>
  );
}
```

Or in CSS modules:

```css
/* Button.module.css */
.button {
  background: var(--color-primary);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  transition: background var(--transition-slow);
}

.button:hover {
  background: var(--color-primary-dark);
}
```

## Token Reference

### Colors

**Primary Theme**
- `--color-primary`: `#4daae6` — main brand color
- `--color-primary-dark`: `#3a96d4` — hover state
- `--color-primary-light`: `#7ec5f0` — light variant
- `--color-primary-bg`: `rgba(77, 170, 230, 0.06)` — background tint

**Accent**
- `--color-accent`: `#cb0000` — secondary color
- `--color-accent-dark`: `#a00000` — darker variant
- `--color-accent-bg`: `rgba(203, 0, 0, 0.04)` — background tint

**Semantic**
- `--color-success` / `--color-success-bg` / `--color-success-border`
- `--color-error` / `--color-error-bg` / `--color-error-border`
- `--color-warning` / `--color-warning-bg` / `--color-warning-border`

**Neutral**
- `--color-bg`: White (light) / `#1a1a1a` (dark)
- `--color-bg-secondary`: Light gray / Medium dark
- `--color-bg-tertiary`: Medium gray / Dark gray
- `--color-text`: Black (light) / Light gray (dark)
- `--color-text-secondary`: Medium gray / Light medium
- `--color-text-muted`: Dark gray / Medium gray
- `--color-border`: Edge color for dividers
- `--color-divider`: Subtle separator color

### Typography

```
--font-family-base: system-ui, -apple-system, sans-serif
--font-family-mono: 'SFMono-Regular', Consolas, monospace

--font-size-xs: 0.72rem
--font-size-sm: 0.9rem
--font-size-base: 1rem
--font-size-md: 1.05rem
--font-size-lg: 1.2rem
--font-size-xl: 1.4rem
--font-size-2xl: 1.8rem
--font-size-3xl: 2rem
--font-size-4xl: 3rem

--line-height-tight: 1.3
--line-height-normal: 1.6
--line-height-relaxed: 1.8
```

### Layout

```
--sidebar-width: 240px
--nav-height: 56px
--max-content-width: 900px
```

### Spacing Scale

```
--spacing-xs: 0.25rem
--spacing-sm: 0.5rem
--spacing-md: 1rem
--spacing-lg: 1.5rem
--spacing-xl: 2rem
--spacing-2xl: 2.5rem
--spacing-3xl: 3rem
--spacing-4xl: 4rem
```

### Shadows

```
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.15)
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.12)
--shadow-lg: 0 6px 28px rgba(77, 170, 230, 0.16)
--shadow-primary: 0 2px 8px rgba(77, 170, 230, 0.45)
--shadow-primary-lg: 0 3px 12px rgba(77, 170, 230, 0.6)
```

### Border Radius

```
--radius-sm: 3px
--radius-md: 6px
--radius-lg: 8px
--radius-xl: 10px
--radius-2xl: 20px
--radius-full: 9999px
```

### Transitions

```
--transition-fast: 0.1s
--transition-base: 0.15s
--transition-slow: 0.2s
```

### Z-index Scale

```
--z-dropdown: 10
--z-sticky: 20
--z-fixed: 100
--z-modal: 1000
--z-tooltip: 1001
```

## Dark Mode

Dark mode is automatically supported via the CSS `prefers-color-scheme: dark` media query. When a user's system prefers dark mode, the token values are automatically adjusted.

To test dark mode in development:
- **macOS**: System Preferences → General → Appearance
- **Windows**: Settings → Personalization → Colors
- **Browser DevTools**: Toggle with the device pixel ratio dropdown

## Design Philosophy

The design tokens follow these principles:

1. **Consistency** — Both projects use the same color palette and spacing
2. **Accessibility** — Colors meet WCAG AA contrast requirements
3. **Semantic naming** — Variables describe *what* they're for, not their value
4. **Flexibility** — Dark mode support via `prefers-color-scheme`
5. **Performance** — CSS variables only, no JavaScript overhead
6. **Maintainability** — Single source of truth for the design system

## Examples

### Button Component

```css
.button {
  background: var(--color-primary);
  color: #fff;
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  font-size: var(--font-size-base);
  transition: background var(--transition-base);
}

.button:hover {
  background: var(--color-primary-dark);
}

.button--secondary {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.button--secondary:hover {
  background: var(--color-bg-tertiary);
}
```

### Card Component

```css
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-slow);
}

.card:hover {
  box-shadow: var(--shadow-md);
}
```

### Alert Component

```css
.alert {
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  border-left: 4px solid;
}

.alert--success {
  background: var(--color-success-bg);
  border-left-color: var(--color-success);
  color: var(--color-success);
}

.alert--error {
  background: var(--color-error-bg);
  border-left-color: var(--color-error);
  color: var(--color-error);
}
```

## Contributing

When adding new design tokens:
1. Add them to `tokens.css` with descriptive variable names
2. Include both light and dark mode values if applicable
3. Use semantic naming (e.g., `--color-success` not `--color-green`)
4. Add documentation to this README
5. Update both lcyt-site and lcyt-web to verify the change works in both contexts

## License

Same as the main LCYT project.
