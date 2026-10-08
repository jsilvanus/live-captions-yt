/**
 * Generate shell scripts for project setup.
 *
 * Creates runnable bash/sh scripts that can be used to recreate or alter
 * project configurations programmatically.
 */

import logger from 'lcyt/logger';

/**
 * Generate a shell script that recreates a project's configuration.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string} apiKey - API key to generate script for
 * @returns {Promise<string>} Shell script content
 */
export async function generateSetupScript(client, apiKey) {
  logger.info(`Generating setup script for project ${apiKey}...`);

  const project = await client.getProject(apiKey);
  if (!project) {
    throw new Error(`Project not found: ${apiKey}`);
  }

  const timestamp = new Date().toISOString();
  const script = generateBashScript({
    projectKey: project.key,
    owner: project.owner,
    email: project.email,
    dailyLimit: project.dailyLimit,
    lifetimeLimit: project.lifetimeLimit,
    features: project.features || {},
    timestamp,
  });

  logger.info('Setup script generated');
  return script;
}

/**
 * Generate a bash script with project configuration commands.
 * @private
 * @param {Object} projectConfig - Project configuration
 * @returns {string} Bash script content
 */
function generateBashScript(projectConfig) {
  const {
    projectKey,
    owner,
    email,
    dailyLimit,
    lifetimeLimit,
    features,
    timestamp,
  } = projectConfig;

  // Feature enable/disable commands
  const enableFeatures = [];
  const disableFeatures = [];

  for (const [code, config] of Object.entries(features)) {
    const enabled = typeof config === 'boolean' ? config : config.enabled;
    if (enabled) {
      enableFeatures.push(code);
    } else {
      disableFeatures.push(code);
    }
  }

  const enableCommand = enableFeatures.length > 0
    ? `lcyt-cli features set $PROJECT_KEY --enable ${enableFeatures.join(',')}`
    : '';

  const disableCommand = disableFeatures.length > 0
    ? `lcyt-cli features set $PROJECT_KEY --disable ${disableFeatures.join(',')}`
    : '';

  const featureCommands = [enableCommand, disableCommand]
    .filter(Boolean)
    .map(cmd => `  echo "Setting features..." && ${cmd}`)
    .join('\n');

  return `#!/usr/bin/env bash
#
# Project Setup Script
# Generated: ${timestamp}
# Project Key: ${projectKey}
# Owner: ${owner} <${email}>
#
# This script configures a project with the settings exported from:
# ${projectKey}
#
# Usage:
#   bash setup_${projectKey}.sh [--backend-url URL] [--admin-key KEY]
#
# Environment variables (optional):
#   LCYT_BACKEND_URL  - Backend URL (default: http://localhost:3000)
#   ADMIN_KEY         - Admin key for authentication
#

set -e

# Colors for output
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m' # No Color

# Parse command-line arguments
BACKEND_URL="\${LCYT_BACKEND_URL:-http://localhost:3000}"
ADMIN_KEY="\${ADMIN_KEY:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --backend-url)
      BACKEND_URL="$2"
      shift 2
      ;;
    --admin-key)
      ADMIN_KEY="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Export environment variables for lcyt-cli
export LCYT_BACKEND_URL="$BACKEND_URL"
export ADMIN_KEY="$ADMIN_KEY"

PROJECT_KEY="${projectKey}"

echo -e "\${BLUE}================================\${NC}"
echo -e "\${BLUE}Project Setup Script\${NC}"
echo -e "\${BLUE}================================\${NC}"
echo ""
echo "Project Key: $PROJECT_KEY"
echo "Owner: ${owner} <${email}>"
echo "Backend: $BACKEND_URL"
echo ""

# Verify project exists
echo -e "\${BLUE}Verifying project...\${NC}"
if ! lcyt-cli project get "$PROJECT_KEY" > /dev/null 2>&1; then
  echo -e "\${RED}✗ Project not found: $PROJECT_KEY\${NC}"
  exit 1
fi
echo -e "\${GREEN}✓ Project found\${NC}"
echo ""

# Apply configuration
${featureCommands}
${featureCommands ? '\n' : ''}
# Additional configuration can be applied here
# For example:
#   - Update caption targets
#   - Configure storage
#   - Set up members/roles
#   - etc.

echo ""
echo -e "\${GREEN}================================\${NC}"
echo -e "\${GREEN}✓ Setup Complete!\${NC}"
echo -e "\${GREEN}================================\${NC}"
echo ""
echo "Project configuration has been applied."
echo "You can now use the project with key: $PROJECT_KEY"
`;
}

/**
 * Generate a Node.js script (ESM) for project setup.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string} apiKey - API key
 * @returns {Promise<string>} Node.js script content
 */
export async function generateNodeScript(client, apiKey) {
  const project = await client.getProject(apiKey);
  if (!project) {
    throw new Error(`Project not found: ${apiKey}`);
  }

  const featureEntries = Object.entries(project.features || {});
  const enabledFeatures = featureEntries
    .filter(([_, config]) => {
      const enabled = typeof config === 'boolean' ? config : config.enabled;
      return enabled;
    })
    .map(([code]) => code);
  const disabledFeatures = featureEntries
    .filter(([_, config]) => {
      const enabled = typeof config === 'boolean' ? config : config.enabled;
      return !enabled;
    })
    .map(([code]) => code);

  const timestamp = new Date().toISOString();

  const featureLines = [];
  if (enabledFeatures.length > 0) {
    for (const code of enabledFeatures) {
      featureLines.push(`      '${code}': true,`);
    }
  }
  if (disabledFeatures.length > 0) {
    for (const code of disabledFeatures) {
      featureLines.push(`      '${code}': false,`);
    }
  }

  return `/**
 * Project Setup Script (Node.js)
 * Generated: ${timestamp}
 * Project: ${project.owner} <${project.email}>
 */

import { ProjectAdminClient } from 'lcyt-cli/lib/project-client.js';

const PROJECT_KEY = '${apiKey}';

const client = new ProjectAdminClient({
  backendUrl: process.env.LCYT_BACKEND_URL || 'http://localhost:3000',
  adminKey: process.env.ADMIN_KEY,
  jwtToken: process.env.JWT_TOKEN,
});

async function setupProject() {
  console.log('Setting up project...', PROJECT_KEY);

  try {
    // Verify project exists
    const project = await client.getProject(PROJECT_KEY);
    console.log('✓ Project found:', project.owner);

    // Apply features (both enabled and disabled)
    const features = {
${featureLines.join('\n')}
    };

    await client.setProjectFeatures(PROJECT_KEY, features);
    console.log('✓ Features applied');

    console.log('\\n✓ Setup complete!');
  } catch (err) {
    console.error('✗ Setup failed:', err.message);
    process.exit(1);
  }
}

setupProject();
`;
}

/**
 * Generate a JSON template for configuration.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string} apiKey - API key
 * @returns {Promise<string>} JSON template content
 */
export async function generateTemplate(client, apiKey) {
  const project = await client.getProject(apiKey);
  if (!project) {
    throw new Error(`Project not found: ${apiKey}`);
  }

  const template = {
    $schema: 'https://lcyt.example.com/project-schema.json',
    metadata: {
      description: `Configuration template for ${project.owner}`,
      version: '1.0',
    },
    project: {
      owner: '{{ PROJECT_OWNER }}',
      email: '{{ PROJECT_EMAIL }}',
      dailyLimit: project.dailyLimit,
      lifetimeLimit: project.lifetimeLimit,
    },
    features: project.features,
  };

  return JSON.stringify(template, null, 2);
}
