import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import { saveTemplate, findTemplatesWithAnyElementIds } from '../src/db/dsk-templates.js';

test('detects conflicting element ids across templates', async () => {
  const db = await initDb(':memory:');

  const apiKey = 'test-key';
  const templateA = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'title', type: 'text' }] };
  const templateB = { layers: [{ id: 'logo-1', type: 'image' }, { id: 'subtitle', type: 'text' }] };

  const idA = await saveTemplate(db, { apiKey, name: 'A', templateJson: templateA });
  const idB = await saveTemplate(db, { apiKey, name: 'B', templateJson: templateB });

  const conflicts = await findTemplatesWithAnyElementIds(db, apiKey, templateA);
  assert.ok(Array.isArray(conflicts));
  // template A should detect template B as conflicting on 'logo-1'
  const other = conflicts.find(c => Number(c.id) === idB);
  assert.ok(other, 'Expected conflict with template B');
  assert.deepEqual(other.overlapping, ['logo-1']);
  await db.close();
});
