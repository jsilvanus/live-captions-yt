# lcyt-site — Marketing & Documentation Website

Static documentation and marketing website built with **Astro**. Combines marketing content with comprehensive user guides, API documentation, and deployment guides.

**Version:** 0.1.0 (private)  
**License:** MIT  
**Author:** Juha Itäleino <jsilvanus@gmail.com>

## Overview

lcyt-site is an Astro-based website that serves as:
- **Marketing site** for the LCYT platform
- **User documentation** (how-to guides, tutorials)
- **API reference** (endpoint documentation)
- **Library reference** (Node.js and Python SDKs)
- **MCP documentation** (AI assistant integration)
- **Deployment guides** (self-hosting, Docker, Kubernetes)

The site is statically generated and can be deployed anywhere (Netlify, Vercel, static hosting, CDN).

## Installation & Setup

```bash
npm install -w packages/lcyt-site
```

## Development

Start the dev server:

```bash
npm run dev -w packages/lcyt-site
```

Opens at `http://localhost:4321` (or specified port) with hot reload.

## Building

Build for production:

```bash
npm run build -w packages/lcyt-site
```

Output is generated in `packages/lcyt-site/dist/`.

### Full build (with web UI):

Build the web UI first, then the site:

```bash
npm run build:site
```

This runs:
1. `npm run build:web` (Vite → `packages/lcyt-web/dist/`)
2. `npm run build -w packages/lcyt-site` (Astro)

## Deployment

### Static hosting (Netlify, Vercel, GitHub Pages)

```bash
npm run build
# Upload dist/ to your hosting
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build:site
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PUBLIC_URL` | `https://lcyt.fi` | Site base URL (for links, canonical tags) |
| `API_URL` | `https://api.lcyt.fi` | API backend URL (docs reference) |

## Project Structure

```
packages/lcyt-site/
├── src/
│   ├── pages/                    # Astro pages (one file = one route)
│   │   ├── index.astro           # / (landing)
│   │   ├── blog/                 # /blog/ pages
│   │   ├── guide/                # /guide/ (getting started, tutorials)
│   │   ├── embed/                # /embed/ (embed widget guides)
│   │   ├── api/                  # /api/ (API reference)
│   │   ├── lib/                  # /lib/ (SDK documentation)
│   │   ├── mcp/                  # /mcp/ (AI assistant integration)
│   │   └── deploy/               # /deploy/ (deployment guides)
│   ├── layouts/                  # Astro layout components
│   ├── components/               # Astro/HTML components
│   ├── content.config.ts         # Astro content collections config
│   └── styles/                   # Global CSS
├── public/                        # Static assets (images, favicons)
├── astro.config.mjs              # Astro configuration
├── tsconfig.json                 # TypeScript config
└── package.json
```

## Content Organization

**Marketing:**
- `/` — Landing page
- `/blog/*` — Blog posts
- `/pricing` — Pricing information
- `/about` — About the project

**User Guides:**
- `/guide/getting-started` — Quick start
- `/guide/cli` — CLI usage
- `/guide/web` — Web UI tutorials
- `/guide/embed` — Embed widgets
- `/guide/deploy` — Self-hosting

**Developer Documentation:**
- `/api/*` — REST API endpoints
- `/lib/js` — Node.js library
- `/lib/python` — Python library
- `/mcp/*` — MCP server integration

**Deployment:**
- `/deploy/docker` — Docker
- `/deploy/kubernetes` — Kubernetes
- `/deploy/production` — Production checklist

## Using the Web UI

The website embeds the **lcyt-web** application (React/Vite) in certain pages.

When you run `npm run build:site`:
1. The web UI is built to `packages/lcyt-web/dist/`
2. Astro copies it into the site
3. Pages can embed it via `<iframe>` or client-side integration

**Environment:** lcyt-web uses `import.meta.env.PUBLIC_*` variables, which Astro injects at build time.

## Styling

Global CSS in `src/styles/`:
- `reset.css` — Normalize browser defaults
- `layout.css` — Page layout (grid, flexbox)
- `components.css` — Component styles
- `dashboard.css` — Dashboard-specific styles

Astro supports:
- **Scoped styles** (CSS-in-Astro)
- **CSS imports** (regular .css files)
- **Tailwind CSS** (if configured)
- **CSS variables** for theming

## Navigation

Update `navConfig.js` or equivalent to customize sidebar/menu:

```javascript
export const navConfig = [
  { label: 'Getting Started', href: '/guide/getting-started' },
  { label: 'API', href: '/api/', submenu: [...] },
  { label: 'Libraries', href: '/lib/', submenu: [...] },
  // ...
];
```

## Metadata & SEO

Each page should include:
- `title` — Page title
- `description` — Meta description
- `canonical` — Canonical URL (Astro auto-generates based on `PUBLIC_URL`)
- `ogImage` — Open Graph image (for social sharing)

```astro
---
title = "Getting Started with LCYT"
description = "Step-by-step guide to sending captions to YouTube Live"
---
```

## Analytics & Tracking

Configure Astro integrations for:
- **Google Analytics** — `astro add google-analytics`
- **Plausible** — Privacy-friendly analytics
- **Custom tracking** — Via client-side scripts

See `astro.config.mjs` for integration setup.

## Performance

Build optimizations:
- **Astro static generation** — Zero JS by default
- **Partial hydration** — Only interactive components ship JS
- **Image optimization** — Astro auto-optimizes images
- **CSS minification** — Automatic in prod build

Monitor with:
```bash
npm run build:site
# Check dist/ file sizes
```

## Related Documentation

- [LCYT overview](../../README.md)
- [CLAUDE.md](../../CLAUDE.md) — Complete codebase guide
- [Web UI documentation](../lcyt-web/README.md)
- [User guides](../../docs/guide-web/)
- [API reference](../../docs/api/)

## Contributing

To add content:

1. Create `.astro` or `.md` file in `src/pages/`
2. Add frontmatter (title, description, layout)
3. Write content in Astro/HTML/Markdown
4. Run `npm run dev` to preview
5. Commit to repository

## License

MIT — See LICENSE file in repo
