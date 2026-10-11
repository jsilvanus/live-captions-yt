import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

const opened = [];
after(async () => { for (const d of opened) await d.close(); });


describe('ai-roles', () => {
  let roles;

  before(async () => {
    roles = await import('../src/ai-roles.js');
  });

  async function createDb() {
    const db = await initDb(':memory:');
    opened.push(db);
    await roles.runAiRolesMigrations(db);
    return db;
  }

  test('seeds all seven builtin roles idempotently', async () => {
    const db = await createDb();
    const list = await roles.listRoles(db);
    assert.equal(list.length, 7);
    const codes = list.map((r) => r.roleCode).sort();
    assert.deepEqual(codes, [
      'asset_control_assistant', 'assistant', 'describer', 'dsk_designer',
      'planner', 'setup_assistant', 'tracker',
    ]);
    // Re-running migrations does not duplicate rows
    await roles.runAiRolesMigrations(db);
    assert.equal((await roles.listRoles(db)).length, 7);
  });

  test('runtime_kind splits into continuous_vision (2) and agentic_chat (5)', async () => {
    const db = await createDb();
    const list = await roles.listRoles(db);
    const vision = list.filter((r) => r.runtimeKind === 'continuous_vision');
    const chat = list.filter((r) => r.runtimeKind === 'agentic_chat');
    assert.equal(vision.length, 2);
    assert.equal(chat.length, 5);
    assert.deepEqual(vision.map((r) => r.roleCode).sort(), ['describer', 'tracker']);
  });

  test('getRole returns parsed input_types/available_tools, null for unknown', async () => {
    const db = await createDb();
    const tracker = await roles.getRole(db, 'tracker');
    assert.deepEqual(tracker.inputTypes, ['video_frames']);
    assert.deepEqual(tracker.availableTools, []);
    const assistant = await roles.getRole(db, 'assistant');
    assert.deepEqual(assistant.availableTools, ['camera.preset', 'mixer.switch', 'crop.list_presets', 'crop.activate_preset']);
    assert.equal(await roles.getRole(db, 'no-such-role'), null);
  });

  test('getRoleConfig returns a default shape when unconfigured', async () => {
    const db = await createDb();
    const cfg = await roles.getRoleConfig(db, 'key1', 'planner');
    assert.deepEqual(cfg, {
      roleCode: 'planner', enabled: false, providerId: null, modelName: '',
      harnessConfig: {}, updatedAt: null,
    });
  });

  test('setRoleConfig creates then updates, isolated per (api_key, role_code)', async () => {
    const db = await createDb();
    const created = await roles.setRoleConfig(db, 'key1', 'planner', {
      enabled: true, providerId: 'prov-1', modelName: 'gpt-4o-mini',
      harnessConfig: { systemPromptOverride: 'Be terse' },
    });
    assert.equal(created.enabled, true);
    assert.equal(created.providerId, 'prov-1');
    assert.deepEqual(created.harnessConfig, { systemPromptOverride: 'Be terse' });

    const updated = await roles.setRoleConfig(db, 'key1', 'planner', { enabled: false });
    assert.equal(updated.enabled, false);
    assert.equal(updated.providerId, 'prov-1', 'unspecified fields are left alone');

    // A different project's config for the same role is independent
    const other = await roles.getRoleConfig(db, 'key2', 'planner');
    assert.equal(other.enabled, false);
    assert.equal(other.providerId, null);

    // A different role for the same project is independent
    const otherRole = await roles.getRoleConfig(db, 'key1', 'dsk_designer');
    assert.equal(otherRole.enabled, false);
  });

  describe('effectiveMode — the confirm/auto safety gate', () => {
    test('defaults to confirm when harnessConfig is empty/absent', async () => {
      assert.equal(roles.effectiveMode(), 'confirm');
      assert.equal(roles.effectiveMode({}), 'confirm');
    });

    test('mode: auto alone (without autoConfirmed) stays confirm', async () => {
      assert.equal(roles.effectiveMode({ mode: 'auto' }), 'confirm');
    });

    test('autoConfirmed alone (without mode: auto) stays confirm', async () => {
      assert.equal(roles.effectiveMode({ autoConfirmed: true }), 'confirm');
    });

    test('both mode: auto AND autoConfirmed: true together unlock auto', async () => {
      assert.equal(roles.effectiveMode({ mode: 'auto', autoConfirmed: true }), 'auto');
    });
  });
});
