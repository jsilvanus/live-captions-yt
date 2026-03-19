import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { saveTemplate, findTemplatesWithAnyElementIds } from '../src/db/dsk-templates.js';

test('detects conflicting element ids across templates', () => {
  const db = new Database(':memory:');
  // Create minimal caption_files table so runMigrations' ALTER TABLE steps succeed
  db.exec('CREATE TABLE IF NOT EXISTS caption_files (id INTEGER PRIMARY KEY)');
  runMigrations(db);

  const apiKey = 'test-key';
  const templateA = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'title', type: 'text' }] };
  const templateB = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'subtitle', type: 'text' }] };

  const idA = saveTemplate(db, { apiKey, name: 'A', templateJson: templateA });
  const idB = saveTemplate(db, { apiKey, name: 'B', templateJson: templateB });

  const conflicts = findTemplatesWithAnyElementIds(db, apiKey, templateA);
  assert.ok(Array.isArray(conflicts));
  // template A should detect template B as conflicting on 'logo-1'
  const other = conflicts.find(c => Number(c.id) === idB);
  assert.ok(other, 'Expected conflict with template B');
  assert.deepEqual(other.overlapping, ['logo-1']);
});
