/**
 * Unit tests for DSK template DB helpers.
 *
 * Tests saveTemplate, listTemplates, getTemplate, deleteTemplate,
 * findTemplatesWithAnyElementIds, and autoRenameConflictingIds.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import {
  saveTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  findTemplatesWithAnyElementIds,
  autoRenameConflictingIds,
} from '../src/db/dsk-templates.js';

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  // runMigrations references PRAGMA table_info(caption_files), so create it first
  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT,
      filename TEXT,
      size_bytes INTEGER,
      type TEXT,
      format TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  runMigrations(db);
  return db;
}

const KEY = 'testkey';
const OTHER_KEY = 'otherkey';

// ---------------------------------------------------------------------------
// saveTemplate / listTemplates / getTemplate
// ---------------------------------------------------------------------------

describe('dsk-templates: saveTemplate', () => {
  it('inserts a new template and returns a numeric id', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { layers: [] } });
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
  });

  it('updates existing template when same (apiKey, name) already exists', () => {
    const db = makeDb();
    const id1 = saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { v: 1 } });
    const id2 = saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { v: 2 } });
    assert.equal(id1, id2); // same row updated
    const row = getTemplate(db, id1, KEY);
    assert.equal(row.templateJson.v, 2);
  });

  it('different API keys can have templates with the same name', () => {
    const db = makeDb();
    const id1 = saveTemplate(db, { apiKey: KEY, name: 'logo', templateJson: {} });
    const id2 = saveTemplate(db, { apiKey: OTHER_KEY, name: 'logo', templateJson: {} });
    assert.notEqual(id1, id2);
  });
});

describe('dsk-templates: listTemplates', () => {
  it('returns empty array for unknown key', () => {
    const db = makeDb();
    assert.deepEqual(listTemplates(db, 'nobody'), []);
  });

  it('returns templates for the correct key only', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'a', templateJson: {} });
    saveTemplate(db, { apiKey: OTHER_KEY, name: 'b', templateJson: {} });
    const rows = listTemplates(db, KEY);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'a');
  });

  it('returns id, name, updated_at fields (no template_json)', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: { secret: true } });
    const rows = listTemplates(db, KEY);
    assert.ok('id' in rows[0]);
    assert.ok('name' in rows[0]);
    assert.ok('updated_at' in rows[0]);
    assert.equal('template_json' in rows[0], false);
  });
});

describe('dsk-templates: getTemplate', () => {
  it('returns template with parsed templateJson', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: { layers: [1, 2] } });
    const row = getTemplate(db, id, KEY);
    assert.ok(row);
    assert.equal(row.name, 'tmpl');
    assert.deepEqual(row.templateJson, { layers: [1, 2] });
  });

  it('returns null for unknown id', () => {
    const db = makeDb();
    assert.equal(getTemplate(db, 9999, KEY), null);
  });

  it('returns null when apiKey does not match (cross-key isolation)', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    assert.equal(getTemplate(db, id, OTHER_KEY), null);
  });
});

// ---------------------------------------------------------------------------
// deleteTemplate
// ---------------------------------------------------------------------------

describe('dsk-templates: deleteTemplate', () => {
  it('returns true and removes the row', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    const deleted = deleteTemplate(db, id, KEY);
    assert.equal(deleted, true);
    assert.equal(getTemplate(db, id, KEY), null);
  });

  it('returns false for unknown id', () => {
    const db = makeDb();
    assert.equal(deleteTemplate(db, 9999, KEY), false);
  });

  it('returns false when apiKey does not match', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    assert.equal(deleteTemplate(db, id, OTHER_KEY), false);
    assert.ok(getTemplate(db, id, KEY)); // row still exists
  });
});

// ---------------------------------------------------------------------------
// findTemplatesWithAnyElementIds
// ---------------------------------------------------------------------------

describe('dsk-templates: findTemplatesWithAnyElementIds', () => {
  it('returns empty array for templateJson with no ids', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'other', templateJson: { id: 'elem1' } });
    const result = findTemplatesWithAnyElementIds(db, KEY, { layers: [] });
    assert.deepEqual(result, []);
  });

  it('returns conflicts when ids overlap', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1', child: { id: 'elem2' } } });
    const result = findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'existing');
    assert.ok(result[0].overlapping.includes('elem1'));
  });

  it('returns empty when ids do not overlap', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const result = findTemplatesWithAnyElementIds(db, KEY, { id: 'elem999' });
    assert.deepEqual(result, []);
  });

  it('excludes the specified excludeTemplateId', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'self', templateJson: { id: 'elem1' } });
    const result = findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' }, id);
    assert.deepEqual(result, []);
  });

  it('does not return conflicts from other API keys', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: OTHER_KEY, name: 'other', templateJson: { id: 'elem1' } });
    const result = findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' });
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// autoRenameConflictingIds
// ---------------------------------------------------------------------------

describe('dsk-templates: autoRenameConflictingIds', () => {
  it('returns templateJson unchanged when no conflicts', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'other', templateJson: { id: 'elem2' } });
    const tmpl = { id: 'elem1' };
    const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, KEY, tmpl);
    assert.deepEqual(updatedTemplateJson, tmpl);
    assert.deepEqual(renameMap, {});
  });

  it('returns unchanged when templateJson has no ids', () => {
    const db = makeDb();
    const tmpl = { layers: [] };
    const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, KEY, tmpl);
    assert.deepEqual(renameMap, {});
    assert.deepEqual(updatedTemplateJson, tmpl);
  });

  it('renames conflicting ids with _r1 suffix', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, KEY, { id: 'elem1' });
    assert.equal(renameMap['elem1'], 'elem1_r1');
    assert.equal(updatedTemplateJson.id, 'elem1_r1');
  });

  it('increments suffix if _r1 is already taken', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'a', templateJson: { id: 'elem1' } });
    saveTemplate(db, { apiKey: KEY, name: 'b', templateJson: { id: 'elem1_r1' } });
    const { renameMap } = autoRenameConflictingIds(db, KEY, { id: 'elem1' });
    assert.equal(renameMap['elem1'], 'elem1_r2');
  });

  it('respects excludeTemplateId when checking conflicts', () => {
    const db = makeDb();
    const id = saveTemplate(db, { apiKey: KEY, name: 'self', templateJson: { id: 'elem1' } });
    // elem1 exists in the excluded template → should not be treated as a conflict
    const { renameMap } = autoRenameConflictingIds(db, KEY, { id: 'elem1' }, id);
    assert.deepEqual(renameMap, {});
  });

  it('renames nested ids correctly', () => {
    const db = makeDb();
    saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const { updatedTemplateJson } = autoRenameConflictingIds(db, KEY, {
      child: { id: 'elem1' },
    });
    assert.equal(updatedTemplateJson.child.id, 'elem1_r1');
  });
});
