import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping ai-roles tests');
  process.exit(0);
}

describe('ai-roles', () => {
  let roles;

  before(async () => {
    roles = await import('../src/ai-roles.js');
  });

  function createDb() {
    const db = new Database(':memory:');
    roles.runAiRolesMigrations(db);
    return db;
  }

  test('seeds all seven builtin roles idempotently', () => {
    const db = createDb();
    const list = roles.listRoles(db);
    assert.equal(list.length, 7);
    const codes = list.map((r) => r.roleCode).sort();
    assert.deepEqual(codes, [
      'asset_control_assistant', 'assistant', 'describer', 'dsk_designer',
      'planner', 'setup_assistant', 'tracker',
    ]);
    // Re-running migrations does not duplicate rows
    roles.runAiRolesMigrations(db);
    assert.equal(roles.listRoles(db).length, 7);
  });

  test('runtime_kind splits into continuous_vision (2) and agentic_chat (5)', () => {
    const db = createDb();
    const list = roles.listRoles(db);
    const vision = list.filter((r) => r.runtimeKind === 'continuous_vision');
    const chat = list.filter((r) => r.runtimeKind === 'agentic_chat');
    assert.equal(vision.length, 2);
    assert.equal(chat.length, 5);
    assert.deepEqual(vision.map((r) => r.roleCode).sort(), ['describer', 'tracker']);
  });

  test('getRole returns parsed input_types/available_tools, null for unknown', () => {
    const db = createDb();
    const tracker = roles.getRole(db, 'tracker');
    assert.deepEqual(tracker.inputTypes, ['video_frames']);
    assert.deepEqual(tracker.availableTools, []);
    const assistant = roles.getRole(db, 'assistant');
    assert.deepEqual(assistant.availableTools, ['camera.preset', 'mixer.switch']);
    assert.equal(roles.getRole(db, 'no-such-role'), null);
  });

  test('getRoleConfig returns a default shape when unconfigured', () => {
    const db = createDb();
    const cfg = roles.getRoleConfig(db, 'key1', 'planner');
    assert.deepEqual(cfg, {
      roleCode: 'planner', enabled: false, providerId: null, modelName: '',
      harnessConfig: {}, updatedAt: null,
    });
  });

  test('setRoleConfig creates then updates, isolated per (api_key, role_code)', () => {
    const db = createDb();
    const created = roles.setRoleConfig(db, 'key1', 'planner', {
      enabled: true, providerId: 'prov-1', modelName: 'gpt-4o-mini',
      harnessConfig: { systemPromptOverride: 'Be terse' },
    });
    assert.equal(created.enabled, true);
    assert.equal(created.providerId, 'prov-1');
    assert.deepEqual(created.harnessConfig, { systemPromptOverride: 'Be terse' });

    const updated = roles.setRoleConfig(db, 'key1', 'planner', { enabled: false });
    assert.equal(updated.enabled, false);
    assert.equal(updated.providerId, 'prov-1', 'unspecified fields are left alone');

    // A different project's config for the same role is independent
    const other = roles.getRoleConfig(db, 'key2', 'planner');
    assert.equal(other.enabled, false);
    assert.equal(other.providerId, null);

    // A different role for the same project is independent
    const otherRole = roles.getRoleConfig(db, 'key1', 'dsk_designer');
    assert.equal(otherRole.enabled, false);
  });

  describe('effectiveMode — the confirm/auto safety gate', () => {
    test('defaults to confirm when harnessConfig is empty/absent', () => {
      assert.equal(roles.effectiveMode(), 'confirm');
      assert.equal(roles.effectiveMode({}), 'confirm');
    });

    test('mode: auto alone (without autoConfirmed) stays confirm', () => {
      assert.equal(roles.effectiveMode({ mode: 'auto' }), 'confirm');
    });

    test('autoConfirmed alone (without mode: auto) stays confirm', () => {
      assert.equal(roles.effectiveMode({ autoConfirmed: true }), 'confirm');
    });

    test('both mode: auto AND autoConfirmed: true together unlock auto', () => {
      assert.equal(roles.effectiveMode({ mode: 'auto', autoConfirmed: true }), 'auto');
    });
  });
});
