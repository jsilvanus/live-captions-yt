# Guide Page Template

This template shows how to create new guide pages for lcyt-site that follow the established design system and component patterns.

## Step 1: Create Content File

Add a markdown file to either:
- `/docs/guide-web/` for web app guides
- `/docs/guide-cli/` for CLI guides

**Filename**: Use descriptive kebab-case (e.g., `keyboard-shortcuts.md`)

**Template**:
```markdown
---
title: "Page Title Here"
order: 5  # Optional: numeric order for sidebar (auto-ordered by filename if omitted)
---

# Page Title

Content here...
```

## Step 2: Content Structure

Use semantic HTML headings and follow this pattern:

```markdown
---
title: "Getting Started"
order: 1
---

# Getting Started

[Brief intro paragraph explaining what this guide covers]

## Section One

Content for first section...

### Subsection

More detailed content...

## Section Two

More content...
```

## Step 3: Using Guide Components

In the main guide page (`src/pages/guide/index.astro`), content is automatically rendered with the DocsLayout. To add visual highlights, the guide components provide reusable patterns:

### For Emphasis
Use the built-in markdown blockquote for notes:

```markdown
> **Note:** This is an important observation
```

Renders as a styled note box with left border.

### For Tips and Warnings

When rendering guides with Astro components, you can inject component markup:

```astro
---
import GuideNote from '../../components/GuideNote.astro';
---

<GuideNote type="tip" title="Pro Tip">
  Keyboard shortcuts can save you time!
</GuideNote>

<GuideNote type="warning" title="Important">
  Never share your API keys publicly.
</GuideNote>
```

Available types:
- `note` (default) — general information
- `tip` — helpful suggestions
- `warning` — important cautions
- `info` — informational details

### For Code Examples

Use standard markdown code blocks:

````markdown
```javascript
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({
  streamKey: 'your-key-here'
});

await sender.send('Hello, world!');
```
````

The syntax highlighting is automatic based on the language tag.

## Step 4: Design Guidelines

### Typography
- Use **H2** (`##`) for major sections
- Use **H3** (`###`) for subsections
- Use **bold** and _italic_ sparingly for emphasis
- Use `code` for inline code references

### Spacing
- Add blank lines between sections
- Lists should be concise (one sentence per item)
- Tables work well for comparisons

### Colors & Styling
All styling is handled automatically through CSS classes. Don't add inline styles.

### Code Examples
- Show practical, runnable examples
- Include output/expected results
- Comment confusing lines
- Keep examples focused and short

## Step 5: Sidebar Navigation

The guide sidebar automatically displays:

1. **Web App Guide** sections (from `/docs/guide-web/`)
   - Ordered by filename or `order` field
   - Labels from `title` field or filename
   
2. **CLI Guide** sections (from `/docs/guide-cli/`)
   - Same ordering rules

The page header shows a quick-jump table of contents that links to each section.

## Example: Complete Guide Page

**File**: `/docs/guide-web/keyboard-shortcuts.md`

```markdown
---
title: "Keyboard Shortcuts"
order: 8
---

# Keyboard Shortcuts

Learn keyboard shortcuts to speed up your captioning workflow.

## General Shortcuts

| Action | Shortcut | Notes |
|--------|----------|-------|
| Send Caption | <kbd>Ctrl</kbd> + <kbd>S</kbd> | macOS: <kbd>Cmd</kbd> + <kbd>S</kbd> |
| Previous File | <kbd>Ctrl</kbd> + <kbd>P</kbd> | Only in sidebar |
| Next File | <kbd>Ctrl</kbd> + <kbd>N</kbd> | Only in sidebar |

## Text Editing

- **Undo**: <kbd>Ctrl</kbd> + <kbd>Z</kbd>
- **Redo**: <kbd>Ctrl</kbd> + <kbd>Y</kbd>
- **Select All**: <kbd>Ctrl</kbd> + <kbd>A</kbd>

## Pro Tips

> These shortcuts work in the main input area and rich text editor.

```

## Step 6: Local Testing

Before committing, verify your guide renders correctly:

```bash
# Build the web app first (required)
npm run build:web

# Build and preview the site
npm run build:site

# Or for development
npm run dev -w packages/lcyt-site
```

Then visit:
- `http://localhost:3000/guide` (or configured port)
- Look for your new section in the sidebar
- Check that links work and formatting is correct

## Step 7: Best Practices

✅ **Do**:
- Keep guides focused and concise
- Use clear, simple language
- Include practical examples
- Test in both light and dark mode
- Use relative links for internal references (`/guide#section-id`)

❌ **Don't**:
- Use external fonts or styles (use design tokens instead)
- Add inline CSS or scripts
- Create very long sections (break into subsections)
- Use absolute positioning or floats
- Hardcode colors (use CSS variables)

## Step 8: Metadata

The guide page auto-generates:
- **Title** from markdown frontmatter `title` field
- **Order** from `order` field (numeric, lower first)
- **Sidebar label** from `title` field or filename
- **Table of contents** from H2/H3 headings

Fallback behavior:
- If no `title` — uses filename with dashes converted to spaces
- If no `order` — uses position in sorted filename list
- If no H2/H3 — sidebar still shows the file but without subsections

## Component API Reference

### GuideNote

```astro
<GuideNote type="tip" title="Custom Title">
  Your content here
</GuideNote>
```

- `type`: 'note' | 'tip' | 'warning' | 'info'
- `title`: Custom header text (optional)

### GuideHeader (used on main guide page)

```astro
<GuideHeader
  title="Complete Guide"
  subtitle="Learn LCYT step by step"
  estimatedTime="30 min read"
  sections={[
    { id: 'section-id', label: 'Section Label' }
  ]}
/>
```

Automatically appears on the guide index page.

## Troubleshooting

**My guide doesn't appear in the sidebar**
- Verify file is in `/docs/guide-web/` or `/docs/guide-cli/`
- Check filename is lowercase with hyphens (e.g., `my-guide.md`)
- Ensure frontmatter has valid YAML syntax

**Formatting looks wrong**
- Check for missing blank lines before/after code blocks
- Verify code block language is specified (e.g., ` ```javascript`)
- Look for mismatched quote characters in frontmatter

**Sidebar shows old content**
- Rebuild the site: `npm run build:site`
- Clear any build cache: `rm -rf packages/lcyt-site/dist`

## Styling Reference

All styles are automatically applied via classes:

```css
/* Main heading */
h1 { font-size: 2rem; color: var(--color-primary); }

/* Section heading */
h2 { font-size: 1.4rem; color: var(--color-primary); }

/* Code block background */
pre { background: var(--color-bg-tertiary); }

/* Link color */
a { color: var(--color-primary); }

/* Note box */
blockquote { border-left: 4px solid var(--color-primary); }

/* Table styling */
th { background: var(--color-bg-tertiary); }
td { border: 1px solid var(--color-border); }
```

No additional CSS is needed—the design system handles everything.

---

## Quick Start

1. Create `/docs/guide-web/my-topic.md`
2. Add frontmatter and content
3. Run `npm run build:site`
4. Visit `http://localhost:3000/guide`
5. Verify your section appears and links work
6. Commit with message: "docs: add my-topic guide"

Happy guide writing! 📖
