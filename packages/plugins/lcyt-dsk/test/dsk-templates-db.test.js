/**
 * Unit tests for DSK template DB helpers.
 *
 * Tests saveTemplate, listTemplates, getTemplate, deleteTemplate,
 * findTemplatesWithAnyElementIds, and autoRenameConflictingIds.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
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

let db;
before(async () => { db = await initDb(':memory:'); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.dsk_templates.deleteMany({}); });

const KEY = 'testkey';
const OTHER_KEY = 'otherkey';

// ---------------------------------------------------------------------------
// saveTemplate / listTemplates / getTemplate
// ---------------------------------------------------------------------------

describe('dsk-templates: saveTemplate', () => {
  it('inserts a new template and returns a numeric id', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { layers: [] } });
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
  });

  it('updates existing template when same (apiKey, name) already exists', async () => {
    const id1 = await saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { v: 1 } });
    const id2 = await saveTemplate(db, { apiKey: KEY, name: 'lower-third', templateJson: { v: 2 } });
    assert.equal(id1, id2); // same row updated
    const row = await getTemplate(db, id1, KEY);
    assert.equal(row.templateJson.v, 2);
  });

  it('different API keys can have templates with the same name', async () => {
    const id1 = await saveTemplate(db, { apiKey: KEY, name: 'logo', templateJson: {} });
    const id2 = await saveTemplate(db, { apiKey: OTHER_KEY, name: 'logo', templateJson: {} });
    assert.notEqual(id1, id2);
  });
});

describe('dsk-templates: listTemplates', () => {
  it('returns empty array for unknown key', async () => {
    assert.deepEqual(await listTemplates(db, 'nobody'), []);
  });

  it('returns templates for the correct key only', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'a', templateJson: {} });
    await saveTemplate(db, { apiKey: OTHER_KEY, name: 'b', templateJson: {} });
    const rows = await listTemplates(db, KEY);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'a');
  });

  it('returns id, name, updated_at fields (no template_json)', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: { secret: true } });
    const rows = await listTemplates(db, KEY);
    assert.ok('id' in rows[0]);
    assert.ok('name' in rows[0]);
    assert.ok('updated_at' in rows[0]);
    assert.equal('template_json' in rows[0], false);
  });
});

describe('dsk-templates: getTemplate', () => {
  it('returns template with parsed templateJson', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: { layers: [1, 2] } });
    const row = await getTemplate(db, id, KEY);
    assert.ok(row);
    assert.equal(row.name, 'tmpl');
    assert.deepEqual(row.templateJson, { layers: [1, 2] });
  });

  it('returns null for unknown id', async () => {
    assert.equal(await getTemplate(db, 9999, KEY), null);
  });

  it('returns null when apiKey does not match (cross-key isolation)', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    assert.equal(await getTemplate(db, id, OTHER_KEY), null);
  });
});

// ---------------------------------------------------------------------------
// deleteTemplate
// ---------------------------------------------------------------------------

describe('dsk-templates: deleteTemplate', () => {
  it('returns true and removes the row', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    const deleted = await deleteTemplate(db, id, KEY);
    assert.equal(deleted, true);
    assert.equal(await getTemplate(db, id, KEY), null);
  });

  it('returns false for unknown id', async () => {
    assert.equal(await deleteTemplate(db, 9999, KEY), false);
  });

  it('returns false when apiKey does not match', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'tmpl', templateJson: {} });
    assert.equal(await deleteTemplate(db, id, OTHER_KEY), false);
    assert.ok(await getTemplate(db, id, KEY)); // row still exists
  });
});

// ---------------------------------------------------------------------------
// findTemplatesWithAnyElementIds
// ---------------------------------------------------------------------------

describe('dsk-templates: findTemplatesWithAnyElementIds', () => {
  it('returns empty array for templateJson with no ids', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'other', templateJson: { id: 'elem1' } });
    const result = await findTemplatesWithAnyElementIds(db, KEY, { layers: [] });
    assert.deepEqual(result, []);
  });

  it('returns conflicts when ids overlap', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1', child: { id: 'elem2' } } });
    const result = await findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'existing');
    assert.ok(result[0].overlapping.includes('elem1'));
  });

  it('returns empty when ids do not overlap', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const result = await findTemplatesWithAnyElementIds(db, KEY, { id: 'elem999' });
    assert.deepEqual(result, []);
  });

  it('excludes the specified excludeTemplateId', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'self', templateJson: { id: 'elem1' } });
    const result = await findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' }, id);
    assert.deepEqual(result, []);
  });

  it('does not return conflicts from other API keys', async () => {
    await saveTemplate(db, { apiKey: OTHER_KEY, name: 'other', templateJson: { id: 'elem1' } });
    const result = await findTemplatesWithAnyElementIds(db, KEY, { id: 'elem1' });
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// autoRenameConflictingIds
// ---------------------------------------------------------------------------

describe('dsk-templates: autoRenameConflictingIds', () => {
  it('returns templateJson unchanged when no conflicts', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'other', templateJson: { id: 'elem2' } });
    const tmpl = { id: 'elem1' };
    const { updatedTemplateJson, renameMap } = await autoRenameConflictingIds(db, KEY, tmpl);
    assert.deepEqual(updatedTemplateJson, tmpl);
    assert.deepEqual(renameMap, {});
  });

  it('returns unchanged when templateJson has no ids', async () => {
    const tmpl = { layers: [] };
    const { updatedTemplateJson, renameMap } = await autoRenameConflictingIds(db, KEY, tmpl);
    assert.deepEqual(renameMap, {});
    assert.deepEqual(updatedTemplateJson, tmpl);
  });

  it('renames conflicting ids with _r1 suffix', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const { updatedTemplateJson, renameMap } = await autoRenameConflictingIds(db, KEY, { id: 'elem1' });
    assert.equal(renameMap['elem1'], 'elem1_r1');
    assert.equal(updatedTemplateJson.id, 'elem1_r1');
  });

  it('increments suffix if _r1 is already taken', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'a', templateJson: { id: 'elem1' } });
    await saveTemplate(db, { apiKey: KEY, name: 'b', templateJson: { id: 'elem1_r1' } });
    const { renameMap } = await autoRenameConflictingIds(db, KEY, { id: 'elem1' });
    assert.equal(renameMap['elem1'], 'elem1_r2');
  });

  it('respects excludeTemplateId when checking conflicts', async () => {
    const id = await saveTemplate(db, { apiKey: KEY, name: 'self', templateJson: { id: 'elem1' } });
    // elem1 exists in the excluded template → should not be treated as a conflict
    const { renameMap } = await autoRenameConflictingIds(db, KEY, { id: 'elem1' }, id);
    assert.deepEqual(renameMap, {});
  });

  it('renames nested ids correctly', async () => {
    await saveTemplate(db, { apiKey: KEY, name: 'existing', templateJson: { id: 'elem1' } });
    const { updatedTemplateJson } = await autoRenameConflictingIds(db, KEY, {
      child: { id: 'elem1' },
    });
    assert.equal(updatedTemplateJson.child.id, 'elem1_r1');
  });
});
