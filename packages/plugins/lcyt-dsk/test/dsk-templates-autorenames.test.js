import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { saveTemplate, findTemplatesWithAnyElementIds, autoRenameConflictingIds } from '../src/db/dsk-templates.js';

test('auto-renames conflicting element ids on save', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS caption_files (id INTEGER PRIMARY KEY)');
  runMigrations(db);

  const apiKey = 'test-key';
  const templateA = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'title', type: 'text' }] };
  const templateB = { layers: [{ id: 'subtitle', type: 'text' }] };

  const idA = saveTemplate(db, { apiKey, name: 'A', templateJson: templateA });
  const idB = saveTemplate(db, { apiKey, name: 'B', templateJson: templateB });

  // New template C contains 'logo-1' which collides with template A's id
  const templateC = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'caption', type: 'text' }] };
  const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, apiKey, templateC);

  assert.ok(renameMap && Object.keys(renameMap).length === 1, 'Expected one rename');
  const newId = renameMap['logo-1'];
  assert.ok(typeof newId === 'string' && newId.length > 0);

  // Ensure the updated template no longer conflicts
  const conflictsAfter = findTemplatesWithAnyElementIds(db, apiKey, updatedTemplateJson);
  assert.deepEqual(conflictsAfter, []);
});
