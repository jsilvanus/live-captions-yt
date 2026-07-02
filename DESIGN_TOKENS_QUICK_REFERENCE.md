# Design Tokens — Quick Reference Card

## Colors

### Primary Theme
```css
--color-primary: #4daae6;         /* Main brand color */
--color-primary-dark: #3a96d4;    /* Hover state */
--color-primary-light: #7ec5f0;   /* Light variant */
--color-primary-bg: rgba(77, 170, 230, 0.06); /* Light bg */
```

### Accent
```css
--color-accent: #cb0000;          /* Secondary color */
--color-accent-dark: #a00000;     /* Darker variant */
--color-accent-bg: rgba(203, 0, 0, 0.04); /* Light bg */
```

### Semantic
```css
--color-success: #166534;         /* Success state */
--color-error: #991b1b;           /* Error state */
--color-warning: #b45309;         /* Warning state */

--color-success-bg: #f0fdf4;
--color-error-bg: #fff7f7;
--color-warning-bg: #fffbeb;
```

### Neutral
```css
--color-bg: #ffffff;              /* Main background */
--color-bg-secondary: #f8f9fa;    /* Secondary background */
--color-bg-tertiary: #f3f4f6;     /* Tertiary background */

--color-text: #1a1a1a;            /* Main text */
--color-text-secondary: #555555;  /* Secondary text */
--color-text-muted: #888888;      /* Muted text */

--color-border: #e0e0e0;          /* Borders */
--color-divider: #e8e8e8;         /* Dividers */
```

## Typography

### Sizes
```css
--font-size-xs: 0.72rem;   /* 10px @14px base */
--font-size-sm: 0.9rem;    /* 13px */
--font-size-base: 1rem;    /* 14px */
--font-size-md: 1.05rem;   /* 15px */
--font-size-lg: 1.2rem;    /* 17px */
--font-size-xl: 1.4rem;    /* 20px */
--font-size-2xl: 1.8rem;   /* 25px */
--font-size-3xl: 2rem;     /* 28px */
--font-size-4xl: 3rem;     /* 42px */
```

### Families
```css
--font-family-base: system-ui, -apple-system, sans-serif;
--font-family-mono: 'SFMono-Regular', Consolas, monospace;
```

### Line Heights
```css
--line-height-tight: 1.3;
--line-height-normal: 1.6;
--line-height-relaxed: 1.8;
```

## Spacing

```css
--spacing-xs: 0.25rem;    /* 4px */
--spacing-sm: 0.5rem;     /* 8px */
--spacing-md: 1rem;       /* 16px */
--spacing-lg: 1.5rem;     /* 24px */
--spacing-xl: 2rem;       /* 32px */
--spacing-2xl: 2.5rem;    /* 40px */
--spacing-3xl: 3rem;      /* 48px */
--spacing-4xl: 4rem;      /* 64px */
```

## Layout

```css
--sidebar-width: 240px;
--nav-height: 56px;
--max-content-width: 900px;
```

## Components

### Shadows
```css
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.15);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.12);
--shadow-lg: 0 6px 28px rgba(77, 170, 230, 0.16);
--shadow-primary: 0 2px 8px rgba(77, 170, 230, 0.45);
--shadow-primary-lg: 0 3px 12px rgba(77, 170, 230, 0.6);
```

### Border Radius
```css
--radius-sm: 3px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 10px;
--radius-2xl: 20px;
--radius-full: 9999px;
```

### Transitions
```css
--transition-fast: 0.1s;
--transition-base: 0.15s;
--transition-slow: 0.2s;
```

### Z-index
```css
--z-dropdown: 10;
--z-sticky: 20;
--z-fixed: 100;
--z-modal: 1000;
--z-tooltip: 1001;
```

## Common Patterns

### Button
```css
.button {
  background: var(--color-primary);
  color: #fff;
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: background var(--transition-base);
}

.button:hover {
  background: var(--color-primary-dark);
}
```

### Card
```css
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
}

.card:hover {
  box-shadow: var(--shadow-md);
}
```

### Alert
```css
.alert {
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  border-left: 4px solid;
  background: var(--color-bg-secondary);
}

.alert--success {
  border-left-color: var(--color-success);
  background: var(--color-success-bg);
  color: var(--color-success);
}
```

### Text Styles
```css
h1 { font-size: var(--font-size-4xl); }
h2 { font-size: var(--font-size-2xl); }
h3 { font-size: var(--font-size-xl); }
p { font-size: var(--font-size-base); }
code { font-size: var(--font-size-sm); }
```

## Usage Examples

### Astro Component
```astro
---
// MyComponent.astro
---

<div class="my-component">
  <h2>Title</h2>
  <p>Content</p>
</div>

<style>
  .my-component {
    padding: var(--spacing-lg);
    background: var(--color-bg-secondary);
    border-radius: var(--radius-lg);
  }

  .my-component h2 {
    color: var(--color-primary);
    font-size: var(--font-size-xl);
  }
</style>
```

### React Component
```jsx
// Button.module.css
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

## Dark Mode

Dark mode is **automatic**. When user enables dark mode in their OS, CSS variables update via:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1a1a1a;
    --color-text: #f0f0f0;
    /* ... */
  }
}
```

**No component code changes needed!**

## Tips

✅ **Always use variables** — never hardcode colors or sizes  
✅ **Use semantic names** — `--color-primary` not `--color-blue`  
✅ **Include dark variants** — define colors for both modes  
✅ **Document changes** — update README when adding tokens  
✅ **Test both modes** — verify light and dark rendering  
✅ **Use spacing scale** — maintain consistent rhythm  

❌ **Don't hardcode values** — `background: #4daae6` ❌  
❌ **Don't use magic numbers** — `padding: 24px` ❌  
❌ **Don't mix systems** — use tokens consistently ❌  
❌ **Don't skip dark mode** — it's automatic, test it ❌  

## Resources

- **Full reference:** `packages/shared-styles/README.md`
- **Architecture guide:** `docs/DESIGN_SYSTEM.md`
- **For Astro developers:** Look at `src/components/` for examples
- **For React developers:** Check imported React apps for patterns

---

**Last Updated:** 2026-07-02  
**Location:** `packages/shared-styles/tokens.css`
