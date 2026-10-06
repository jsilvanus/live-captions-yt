# Dockerfile Maintenance Guide

## Critical Rule: Keep package.json copies in sync with npm ci workspaces

When modifying the main `Dockerfile`, **ALL workspace packages must be included** in three places:

### 1. COPY manifests (Layer 1 - enables npm ci caching)
```dockerfile
COPY package.json package-lock.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
COPY packages/lcyt-web/package.json packages/lcyt-web/
COPY packages/shared-styles/package.json packages/shared-styles/  # ← Must be here
COPY packages/lcyt-mcp-http/package.json packages/lcyt-mcp-http/
# ... all other packages
```

### 2. npm ci workspace list (Layer 2 - install dependencies)
```dockerfile
RUN npm ci \
  --workspace=packages/lcyt \
  --workspace=packages/lcyt-backend \
  --workspace=packages/lcyt-web \
  --workspace=packages/shared-styles \  # ← Must be here too
  --workspace=packages/lcyt-mcp-http \
  # ... all other packages
```

### 3. Full source COPY (Layer 3 - copy actual source files)
```dockerfile
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/
COPY packages/lcyt-web/ packages/lcyt-web/
COPY packages/shared-styles/ packages/shared-styles/  # ← And here
COPY packages/lcyt-mcp-http/src/ packages/lcyt-mcp-http/src/
# ... all other packages
```

## How to find all workspace packages

```bash
ls packages/ | grep -v '\.' | sort
```

This lists all workspace directories that need to be included.

## Common Error Symptom

Build fails with:
```
ERROR: failed to build: failed to solve: process "/bin/npm run build:web" did not complete successfully: exit code: 1
```

**Root cause:** A dependency (like `shared-styles`) wasn't copied or included in npm ci, so the build step fails with missing packages.

**Check:** 
- Count packages in `ls packages/`
- Verify all appear in the three Dockerfile sections above
- If a new package is added to the monorepo, it MUST be added to all three sections

## When consolidating images

If you move builds around (e.g., `lcyt-web` → main `Dockerfile`), ensure:
1. All workspace packages are still copied
2. The `npm ci` command includes all workspaces
3. The source copy step includes all packages
4. Build/test scripts reference the correct packages

This caught an error twice:
- 2026-10-06: `shared-styles` missing when consolidating frontend build into main image
