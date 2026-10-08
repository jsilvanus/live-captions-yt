/**
 * Import/export functionality for projects and their settings.
 *
 * Allows saving and restoring entire project configurations as JSON files,
 * which can be version-controlled or used for backup/restore operations.
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import logger from 'lcyt/logger';

/**
 * Export a project and all its settings to a JSON object.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string} apiKey - API key to export
 * @returns {Promise<Object>} Complete project export
 */
export async function exportProject(client, apiKey) {
  logger.info(`Exporting project ${apiKey}...`);

  const project = await client.getProject(apiKey);
  if (!project) {
    throw new Error(`Project not found: ${apiKey}`);
  }

  // Collect all project data
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    project: {
      key: project.key,
      owner: project.owner,
      email: project.email || null,
      createdAt: project.createdAt,
      active: project.active,
      dailyLimit: project.dailyLimit ?? null,
      lifetimeLimit: project.lifetimeLimit ?? null,
      lifetimeUsed: project.lifetimeUsed ?? 0,
      backendFileEnabled: project.backendFileEnabled ?? false,
      relayAllowed: project.relayAllowed ?? false,
      relayActive: project.relayActive ?? false,
      radioEnabled: project.radioEnabled ?? false,
      hlsEnabled: project.hlsEnabled ?? false,
      cea708DelayMs: project.cea708DelayMs ?? 0,
      embedCors: project.embedCors ?? '*',
      publicSlug: project.publicSlug ?? null,
      restricted: project.restricted ?? false,
      orgBaselineRole: project.orgBaselineRole ?? 'viewer',
    },
    features: project.features || {},
    members: project.members || [],
    deviceRoles: project.deviceRoles || [],
  };

  logger.info(`Export complete: ${Object.keys(exportData).join(', ')}`);
  return exportData;
}

/**
 * Import a project from a JSON export file or object.
 * Creates a new project or updates an existing one.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string|Object} filePathOrData - Path to JSON export file or pre-parsed object
 * @param {Object} [options] - Import options
 * @param {boolean} [options.skipExisting=false] - Skip if project already exists
 * @returns {Promise<Object>} Import result with project key
 */
export async function importProject(client, filePathOrData, options = {}) {
  const skipExisting = options.skipExisting || false;

  let importData;
  if (typeof filePathOrData === 'string') {
    logger.info(`Reading import file: ${filePathOrData}`);
    const fileContent = await readFile(filePathOrData, 'utf-8');
    importData = JSON.parse(fileContent);
  } else {
    // Pre-parsed object
    importData = filePathOrData;
  }

  if (!importData.project) {
    throw new Error('Invalid export format: missing "project" field');
  }

  const projectData = importData.project;

  // Check if project already exists
  let existing = null;
  try {
    existing = await client.getProject(projectData.key);
  } catch (err) {
    // Project doesn't exist yet
  }

  if (existing) {
    if (skipExisting) {
      logger.warn(`Project already exists (skipping): ${projectData.key}`);
      return { key: projectData.key, skipped: true };
    }

    logger.info(`Updating existing project: ${projectData.key}`);
    // Update existing project metadata
    const updates = {
      owner: projectData.owner,
      email: projectData.email,
      dailyLimit: projectData.dailyLimit,
      lifetimeLimit: projectData.lifetimeLimit,
    };

    await client.updateProject(projectData.key, updates);
  } else {
    logger.info(`Creating new project: ${projectData.key}`);
    // For now, we can't directly create with a specific key via the client
    // The backend typically generates keys. This would need backend support.
    throw new Error('Creating projects with specific keys is not yet supported. Create manually first, then update with import.');
  }

  // Import features
  if (importData.features && Object.keys(importData.features).length > 0) {
    logger.info('Applying features...');
    const features = importData.features;
    // Convert from old format to new format if needed
    const normalizedFeatures = {};
    for (const [code, val] of Object.entries(features)) {
      if (typeof val === 'boolean') {
        normalizedFeatures[code] = val;
      } else if (typeof val === 'object' && val.enabled !== undefined) {
        normalizedFeatures[code] = val;
      } else {
        normalizedFeatures[code] = !!val;
      }
    }

    await client.setProjectFeatures(projectData.key, normalizedFeatures);
  }

  // Note: Members and device roles would require additional API endpoints
  // that may not exist yet. Log a warning if they're present in the export.
  if (importData.members && importData.members.length > 0) {
    logger.warn('Project members are not yet supported in import (would require additional API)');
  }

  if (importData.deviceRoles && importData.deviceRoles.length > 0) {
    logger.warn('Device roles are not yet supported in import (would require additional API)');
  }

  logger.info(`Import complete: ${projectData.key}`);
  return {
    key: projectData.key,
    imported: true,
    owner: projectData.owner,
  };
}

/**
 * Batch import multiple projects from a JSON file.
 * @param {ProjectAdminClient} client - Admin client instance
 * @param {string} filePath - Path to JSON file with array of exports
 * @param {Object} [options] - Import options
 * @param {boolean} [options.skipExisting=true] - Skip if projects exist
 * @returns {Promise<Object>} Batch import summary
 */
export async function batchImportProjects(client, filePath, options = {}) {
  const skipExisting = options.skipExisting !== false;

  logger.info(`Reading batch import file: ${filePath}`);
  const fileContent = await readFile(filePath, 'utf-8');
  const imports = JSON.parse(fileContent);

  if (!Array.isArray(imports)) {
    throw new Error('Batch import file must contain an array of project exports');
  }

  const results = {
    total: imports.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const importData of imports) {
    try {
      const result = await importProject(client, importData, { skipExisting });

      if (result.skipped) {
        results.skipped++;
      } else {
        results.imported++;
      }
    } catch (err) {
      results.failed++;
      results.errors.push({
        projectKey: importData.project?.key || 'unknown',
        error: err.message,
      });
      logger.error(`Failed to import project: ${err.message}`);
    }
  }

  logger.info(`Batch import complete: ${results.imported} imported, ${results.skipped} skipped, ${results.failed} failed`);
  return results;
}
