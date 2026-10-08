# Project Admin CLI Tool

The Project Admin CLI tool provides comprehensive CRUD operations for managing projects and their setup settings via the backend admin API.

## Overview

This tool allows you to:

1. **Manage Projects** â€” Create, list, retrieve, update, and delete projects (API keys)
2. **Manage Features** â€” Enable/disable feature flags for projects
3. **Export/Import** â€” Backup and restore project configurations as JSON
4. **Generate Scripts** â€” Create runnable bash scripts to deploy configurations

## Installation

The project admin commands are built into `lcyt-cli`:

```bash
npm install -g lcyt-cli
# or
npm install lcyt-cli
```

## Authentication

All project admin commands require authentication via one of:

1. **Admin Key** (recommended for scripts):
   ```bash
   export ADMIN_KEY="your-admin-key-here"
   lcyt project list
   ```

2. **JWT Token** (for user authentication):
   ```bash
   export JWT_TOKEN="your-jwt-token"
   lcyt project list
   ```

3. **Command-line arguments**:
   ```bash
   lcyt project list --admin-key "your-key" --backend-url "http://localhost:3000"
   ```

## Backend Configuration

Ensure your backend is running and accessible:

```bash
export LCYT_BACKEND_URL="http://localhost:3000"
# or
lcyt project list --backend-url "http://localhost:3000"
```

## Usage Examples

### Project CRUD Operations

#### Create a Project

```bash
lcyt project create \
  --owner "My Broadcasting Project" \
  --email "admin@example.com" \
  --daily-limit 1000 \
  --backend-url "http://localhost:3000"
```

Output:
```json
{
  "key": "sk_abc123def456",
  "owner": "My Broadcasting Project",
  "email": "admin@example.com",
  "active": true,
  "dailyLimit": 1000,
  "lifetimeLimit": null,
  "createdAt": "2026-10-08T15:00:00.000Z"
}
```

#### List All Projects

```bash
lcyt project list --limit 50 --offset 0
```

Output:
```
Total projects: 127
Showing 50 of 127

  sk_abc123def456
    Owner: My Broadcasting Project (admin@example.com)
    Created: 2026-10-08T15:00:00.000Z
    Daily limit: 1000
    Active: yes

  sk_def456ghi789
    Owner: Another Project (other@example.com)
    Created: 2026-10-07T12:00:00.000Z
    Daily limit: unlimited
    Active: yes
```

#### Get Project Details

```bash
lcyt project get sk_abc123def456 | jq .
```

Output:
```json
{
  "key": "sk_abc123def456",
  "owner": "My Broadcasting Project",
  "email": "admin@example.com",
  "active": true,
  "dailyLimit": 1000,
  "features": {
    "captions": true,
    "file-saving": true,
    "files-local": true,
    "graphics-client": false,
    "ingest": false
  },
  "members": []
}
```

#### Update Project

```bash
lcyt project update sk_abc123def456 \
  --owner "Updated Project Name" \
  --daily-limit 5000
```

#### Delete Project

```bash
lcyt project delete sk_abc123def456
```

### Feature Management

#### Get Project Features

```bash
lcyt features get sk_abc123def456
```

Output:
```json
[
  {
    "code": "captions",
    "enabled": true,
    "config": null
  },
  {
    "code": "file-saving",
    "enabled": true,
    "config": null
  },
  {
    "code": "graphics-client",
    "enabled": false,
    "config": null
  }
]
```

#### Enable/Disable Features

```bash
# Enable multiple features
lcyt features set sk_abc123def456 \
  --enable captions,file-saving,graphics-client

# Disable features
lcyt features set sk_abc123def456 \
  --disable ingest,radio

# Mixed
lcyt features set sk_abc123def456 \
  --enable captions,file-saving \
  --disable graphics-server,stt-server
```

#### Reset Features to Default

```bash
lcyt features reset sk_abc123def456
```

### Export and Import

#### Export Project Configuration

```bash
# Export to stdout
lcyt project export sk_abc123def456

# Export to file
lcyt project export sk_abc123def456 --output project_backup.json
```

Exported format:
```json
{
  "version": "1.0",
  "exportedAt": "2026-10-08T15:14:52.762Z",
  "project": {
    "key": "sk_abc123def456",
    "owner": "My Broadcasting Project",
    "email": "admin@example.com",
    "dailyLimit": 1000,
    "lifetimeLimit": null,
    "active": true
  },
  "features": {
    "captions": true,
    "file-saving": true,
    "files-local": true,
    "graphics-client": false
  },
  "members": [],
  "deviceRoles": []
}
```

#### Import Project Configuration

```bash
# Import from file (updates existing project or creates new one)
lcyt project import --file project_backup.json
```

Note: The import command requires the project to exist first. It will:
1. Check if the project already exists
2. If it exists, update the metadata and features
3. If it doesn't exist, you'll need to create it first manually

### Generate Setup Scripts

Generate a runnable bash script to deploy a project's configuration:

```bash
# Generate to stdout
lcyt project generate-script sk_abc123def456

# Generate to file
lcyt project generate-script sk_abc123def456 --output setup.sh
```

The generated script can be run on another server:

```bash
bash setup.sh \
  --backend-url "http://production:3000" \
  --admin-key "prod-admin-key"
```

## Workflow Examples

### Backup and Restore

```bash
# Backup a project
lcyt project export sk_abc123def456 --output backup_2026-10-08.json

# Later, restore to a new project (first create it)
lcyt project create --owner "Restored Project" --email "admin@example.com"
# Get the new key from output (let's say sk_new_key)

# Then import the features
lcyt project import --file backup_2026-10-08.json
```

### Deploy Configuration to Production

```bash
# On development server
lcyt project export dev_key --output config.json
lcyt project generate-script dev_key --output deploy.sh

# On production server
bash deploy.sh --backend-url "https://prod.example.com" --admin-key "$PROD_ADMIN_KEY"
```

### Script-Based Setup

Create a setup script that can be checked into version control:

```bash
#!/bin/bash
# setup-projects.sh - Deploy all projects for a broadcast

set -e

export LCYT_BACKEND_URL="${LCYT_BACKEND_URL:-http://localhost:3000}"
export ADMIN_KEY="${ADMIN_KEY:-}"

echo "Setting up broadcast projects..."

# Project 1: Main Stream
echo "Creating Main Stream project..."
MAIN_KEY=$(lcyt project create \
  --owner "Main Stream" \
  --email "broadcast@example.com" | jq -r '.key')

lcyt features set "$MAIN_KEY" \
  --enable captions,file-saving,graphics-client,restream

# Project 2: Backup Stream
echo "Creating Backup Stream project..."
BACKUP_KEY=$(lcyt project create \
  --owner "Backup Stream" \
  --email "backup@example.com" | jq -r '.key')

lcyt features set "$BACKUP_KEY" \
  --enable captions

echo "âœ“ Projects created:"
echo "  Main Stream: $MAIN_KEY"
echo "  Backup Stream: $BACKUP_KEY"
```

Run with:
```bash
bash setup-projects.sh
```

## Environment Variables

- `LCYT_BACKEND_URL` â€” Backend API URL (default: http://localhost:3000)
- `ADMIN_KEY` â€” Admin key for authentication
- `JWT_TOKEN` â€” JWT token for authentication (alternative to ADMIN_KEY)

## API Endpoints Used

The CLI tool interacts with these backend admin API endpoints:

- `POST /admin/keys` â€” Create project
- `GET /admin/keys` â€” List projects
- `GET /admin/projects/:key` â€” Get project details
- `PUT /admin/projects/:key` â€” Update project
- `DELETE /admin/projects/:key` â€” Delete project
- `PUT /admin/projects/:key/features` â€” Set features

## Error Handling

Common errors and solutions:

### Backend URL Not Set

```
Error: Backend URL is required (--backend-url or LCYT_BACKEND_URL env var)
```

Solution:
```bash
export LCYT_BACKEND_URL="http://localhost:3000"
# or use --backend-url flag
lcyt project list --backend-url "http://localhost:3000"
```

### Authentication Missing

```
Error: Admin key or JWT token is required
```

Solution:
```bash
export ADMIN_KEY="your-key"
# or
export JWT_TOKEN="your-token"
# or use --admin-key or --jwt-token flags
```

### Project Not Found

```
Error: Project not found
```

Solution:
- Check the API key is correct
- Verify the project exists on this backend
- Use `lcyt project list` to see available projects

### API Error

```
Error: API error (404): ...
```

Solution:
- Verify backend is running and accessible
- Check authentication credentials
- Review backend logs for details

## Testing

Run tests:

```bash
npm test -w packages/lcyt-cli

# Or run specific test file
npm test -w packages/lcyt-cli test/project-admin.test.js
```

## Troubleshooting

### Verbose Output

Add `--verbose` flag for detailed logging:

```bash
lcyt project list --verbose
```

### Check Backend Connectivity

```bash
# Verify backend is accessible
curl http://localhost:3000/health

# Test authentication
curl -H "X-Admin-Key: $ADMIN_KEY" http://localhost:3000/admin/keys
```

### Export for Debugging

```bash
# Export full project config for analysis
lcyt project export sk_abc123def456 | jq .
```

## Best Practices

1. **Use environment variables** for credentials instead of command-line arguments
2. **Store exports in version control** to track configuration changes
3. **Generate scripts** for repeatable deployments
4. **Test in development** before deploying to production
5. **Use `--limit` and `--offset`** when listing many projects
6. **Backup before major changes** with `project export`

## See Also

- Backend admin API documentation: `packages/lcyt-backend/src/routes/admin.js`
- Project features: `packages/lcyt-backend/src/db/project-features.js`
- CLI package: `packages/lcyt-cli/CLAUDE.md`

