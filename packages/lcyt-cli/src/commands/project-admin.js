/**
 * Project admin commands — CRUD operations for projects and setup settings.
 *
 * Usage:
 *   lcyt project create --owner "Project Name" --email "owner@example.com"
 *   lcyt project list
 *   lcyt project get <api-key>
 *   lcyt project update <api-key> --owner "New Name"
 *   lcyt project delete <api-key>
 *   lcyt project export <api-key> --output project.json
 *   lcyt project import --file project.json
 *   lcyt project generate-script <api-key> --output setup.sh
 *   lcyt features set <api-key> --enable captions,file-saving --disable graphics-client
 *   lcyt features get <api-key>
 */

import { writeFile } from 'fs/promises';
import { ProjectAdminClient } from '../lib/project-client.js';
import { exportProject, importProject } from '../lib/project-import-export.js';
import { generateSetupScript } from '../lib/script-generator.js';
import logger from 'lcyt/logger';

/**
 * Create the project admin command builder for yargs.
 * @param {Object} globalConfig - Shared CLI configuration
 * @returns {Object} yargs command builder
 */
export function createProjectAdminCommand(globalConfig = {}) {
  return {
    command: 'project <subcommand> [args..]',
    describe: 'Manage projects and setup settings',
    builder: (yargs) => {
      return yargs
        .positional('subcommand', {
          describe: 'Subcommand: create, list, get, update, delete, export, import, generate-script',
          type: 'string',
        })
        .positional('args', {
          describe: 'Arguments for the subcommand',
          type: 'array',
        })
        .option('backend-url', {
          describe: 'Backend URL (e.g., http://localhost:3000)',
          type: 'string',
          default: globalConfig.backendUrl || process.env.LCYT_BACKEND_URL,
        })
        .option('admin-key', {
          describe: 'Admin key for authentication',
          type: 'string',
          default: process.env.ADMIN_KEY,
        })
        .option('jwt-token', {
          describe: 'JWT token for authentication (instead of admin key)',
          type: 'string',
          default: process.env.JWT_TOKEN,
        })
        .option('output', {
          alias: 'o',
          describe: 'Output file path (for export, import, generate-script)',
          type: 'string',
        })
        .option('file', {
          alias: 'f',
          describe: 'Input file path (for import)',
          type: 'string',
        })
        .option('owner', {
          describe: 'Project owner name',
          type: 'string',
        })
        .option('email', {
          describe: 'Project owner email',
          type: 'string',
        })
        .option('daily-limit', {
          describe: 'Daily usage limit',
          type: 'number',
        })
        .option('lifetime-limit', {
          describe: 'Lifetime usage limit',
          type: 'number',
        })
        .option('enable', {
          describe: 'Comma-separated feature codes to enable',
          type: 'string',
        })
        .option('disable', {
          describe: 'Comma-separated feature codes to disable',
          type: 'string',
        })
        .option('limit', {
          describe: 'Pagination limit for list command',
          type: 'number',
          default: 50,
        })
        .option('offset', {
          describe: 'Pagination offset for list command',
          type: 'number',
          default: 0,
        });
    },
    handler: (argv) => handleProjectCommand(argv),
  };
}

/**
 * Create the features admin command builder for yargs.
 * @param {Object} globalConfig - Shared CLI configuration
 * @returns {Object} yargs command builder
 */
export function createFeaturesCommand(globalConfig = {}) {
  return {
    command: 'features <subcommand> <apiKey>',
    describe: 'Manage project features',
    builder: (yargs) => {
      return yargs
        .positional('subcommand', {
          describe: 'Subcommand: get, set, reset',
          type: 'string',
        })
        .positional('apiKey', {
          describe: 'API key (project identifier)',
          type: 'string',
        })
        .option('backend-url', {
          describe: 'Backend URL',
          type: 'string',
          default: globalConfig.backendUrl || process.env.LCYT_BACKEND_URL,
        })
        .option('admin-key', {
          describe: 'Admin key for authentication',
          type: 'string',
          default: process.env.ADMIN_KEY,
        })
        .option('jwt-token', {
          describe: 'JWT token for authentication',
          type: 'string',
          default: process.env.JWT_TOKEN,
        })
        .option('enable', {
          describe: 'Comma-separated feature codes to enable',
          type: 'string',
        })
        .option('disable', {
          describe: 'Comma-separated feature codes to disable',
          type: 'string',
        })
        .option('output', {
          alias: 'o',
          describe: 'Output file path (for get command)',
          type: 'string',
        });
    },
    handler: (argv) => handleFeaturesCommand(argv),
  };
}

/**
 * Main handler for project commands.
 */
async function handleProjectCommand(argv) {
  const { subcommand, args = [] } = argv;

  if (!subcommand) {
    logger.error('Subcommand is required: create, list, get, update, delete, export, import, generate-script');
    process.exit(1);
  }

  const client = new ProjectAdminClient({
    backendUrl: argv['backend-url'],
    adminKey: argv['admin-key'],
    jwtToken: argv['jwt-token'],
  });

  try {
    switch (subcommand) {
      case 'create':
        await handleProjectCreate(client, argv);
        break;
      case 'list':
        await handleProjectList(client, argv);
        break;
      case 'get':
        await handleProjectGet(client, args[0] || argv._[2]);
        break;
      case 'update':
        await handleProjectUpdate(client, args[0] || argv._[2], argv);
        break;
      case 'delete':
        await handleProjectDelete(client, args[0] || argv._[2], argv);
        break;
      case 'export':
        await handleProjectExport(client, args[0] || argv._[2], argv.output);
        break;
      case 'import':
        await handleProjectImport(client, argv.file);
        break;
      case 'generate-script':
        await handleGenerateScript(client, args[0] || argv._[2], argv.output);
        break;
      default:
        logger.error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
    }
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (argv.verbose) console.error(err);
    process.exit(1);
  }
}

/**
 * Main handler for features commands.
 */
async function handleFeaturesCommand(argv) {
  const { subcommand, apiKey } = argv;

  if (!subcommand || !apiKey) {
    logger.error('Usage: lcyt features <get|set|reset> <api-key>');
    process.exit(1);
  }

  const client = new ProjectAdminClient({
    backendUrl: argv['backend-url'],
    adminKey: argv['admin-key'],
    jwtToken: argv['jwt-token'],
  });

  try {
    switch (subcommand) {
      case 'get':
        await handleFeaturesGet(client, apiKey, argv.output);
        break;
      case 'set':
        await handleFeaturesSet(client, apiKey, argv.enable, argv.disable);
        break;
      case 'reset':
        await handleFeaturesReset(client, apiKey);
        break;
      default:
        logger.error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
    }
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (argv.verbose) console.error(err);
    process.exit(1);
  }
}

// ─── Project command handlers ────────────────────────────────────────────────

async function handleProjectCreate(client, argv) {
  if (!argv.owner || !argv.email) {
    logger.error('Error: --owner and --email are required for project creation');
    process.exit(1);
  }

  const payload = {
    owner: argv.owner,
    email: argv.email,
  };

  if (argv['daily-limit'] !== undefined) {
    payload.dailyLimit = argv['daily-limit'];
  }
  if (argv['lifetime-limit'] !== undefined) {
    payload.lifetimeLimit = argv['lifetime-limit'];
  }

  const result = await client.createProject(payload);
  logger.info(`Project created successfully!`);
  console.log(JSON.stringify(result, null, 2));
}

async function handleProjectList(client, argv) {
  const result = await client.listProjects({
    limit: argv.limit,
    offset: argv.offset,
  });

  console.log(`Total projects: ${result.total}`);
  console.log(`Showing ${result.keys.length} of ${result.total}\n`);

  for (const key of result.keys) {
    console.log(`  ${key.key}`);
    console.log(`    Owner: ${key.owner} (${key.email || 'no email'})`);
    console.log(`    Created: ${key.createdAt}`);
    console.log(`    Daily limit: ${key.dailyLimit ?? 'unlimited'}`);
    console.log(`    Active: ${key.active ? 'yes' : 'no'}\n`);
  }
}

async function handleProjectGet(client, apiKey) {
  if (!apiKey) {
    logger.error('API key is required');
    process.exit(1);
  }

  const result = await client.getProject(apiKey);
  console.log(JSON.stringify(result, null, 2));
}

async function handleProjectUpdate(client, apiKey, argv) {
  if (!apiKey) {
    logger.error('API key is required');
    process.exit(1);
  }

  const updates = {};
  if (argv.owner) updates.owner = argv.owner;
  if (argv.email) updates.email = argv.email;
  if (argv['daily-limit'] !== undefined) updates.dailyLimit = argv['daily-limit'];
  if (argv['lifetime-limit'] !== undefined) updates.lifetimeLimit = argv['lifetime-limit'];

  if (Object.keys(updates).length === 0) {
    logger.warn('No updates specified');
    return;
  }

  const result = await client.updateProject(apiKey, updates);
  logger.info('Project updated successfully');
  console.log(JSON.stringify(result, null, 2));
}

async function handleProjectDelete(client, apiKey, argv) {
  if (!apiKey) {
    logger.error('API key is required');
    process.exit(1);
  }

  // Note: This should prompt for confirmation in a real implementation
  await client.deleteProject(apiKey);
  logger.info(`Project deleted: ${apiKey}`);
}

async function handleProjectExport(client, apiKey, outputPath) {
  if (!apiKey) {
    logger.error('API key is required');
    process.exit(1);
  }

  const data = await exportProject(client, apiKey);
  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(data, null, 2));
    logger.info(`Project exported to ${outputPath}`);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function handleProjectImport(client, inputPath) {
  if (!inputPath) {
    logger.error('Input file is required (--file <path>)');
    process.exit(1);
  }

  const result = await importProject(client, inputPath);
  logger.info(`Project imported successfully: ${result.key}`);
  console.log(JSON.stringify(result, null, 2));
}

async function handleGenerateScript(client, apiKey, outputPath) {
  if (!apiKey) {
    logger.error('API key is required');
    process.exit(1);
  }

  const script = await generateSetupScript(client, apiKey);
  if (outputPath) {
    await writeFile(outputPath, script);
    logger.info(`Setup script generated: ${outputPath}`);
  } else {
    console.log(script);
  }
}

// ─── Features command handlers ───────────────────────────────────────────────

async function handleFeaturesGet(client, apiKey, outputPath) {
  const features = await client.getProjectFeatures(apiKey);

  const output = Object.entries(features).map(([code, config]) => ({
    code,
    enabled: typeof config === 'boolean' ? config : config.enabled,
    config: typeof config === 'object' && config.config ? config.config : null,
  }));

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    logger.info(`Features exported to ${outputPath}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

async function handleFeaturesSet(client, apiKey, enableStr, disableStr) {
  const features = {};

  if (enableStr) {
    const codes = enableStr.split(',').map(s => s.trim());
    for (const code of codes) {
      features[code] = true;
    }
  }

  if (disableStr) {
    const codes = disableStr.split(',').map(s => s.trim());
    for (const code of codes) {
      features[code] = false;
    }
  }

  if (Object.keys(features).length === 0) {
    logger.warn('No features specified');
    return;
  }

  const result = await client.setProjectFeatures(apiKey, features);
  logger.info('Features updated successfully');
  console.log(JSON.stringify(result, null, 2));
}

async function handleFeaturesReset(client, apiKey) {
  // Reset all features to default (disabled) by fetching from project
  // and setting all to false
  const currentFeatures = await client.getProjectFeatures(apiKey);
  const features = {};

  for (const code of Object.keys(currentFeatures)) {
    features[code] = false;
  }

  const result = await client.setProjectFeatures(apiKey, features);
  logger.info('Features reset to defaults');
  console.log(JSON.stringify(result, null, 2));
}
