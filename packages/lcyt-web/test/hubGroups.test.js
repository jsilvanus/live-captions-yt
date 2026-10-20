import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/locales/en.js';
import fi from '../src/locales/fi.js';
import sv from '../src/locales/sv.js';
import { HUB_GROUPS, HUB_CARD_ORDER } from '../src/lib/hubGroups.js';

describe('Setup Hub groups', () => {
  it('puts every card in exactly one group, same cards as the flat order', () => {
    const grouped = HUB_GROUPS.flatMap(g => g.cards);
    assert.equal(new Set(grouped).size, grouped.length);
    assert.deepEqual([...grouped].sort(), [...HUB_CARD_ORDER].sort());
  });
  it('groups STT with captions, tally and storage with integrations', () => {
    const of = id => HUB_GROUPS.find(g => g.cards.includes(id)).id;
    assert.equal(of('stt'), 'captions');
    assert.equal(of('tally'), 'integrations');
    assert.equal(of('storage'), 'integrations');
  });
  it('has a heading in en, fi and sv for each group', () => {
    for (const l of [en, fi, sv]) {
      assert.ok(l.setupWizard.hub.groupCards);
      for (const g of HUB_GROUPS) assert.ok(l.setupWizard.hub.group[g.id], g.id);
    }
  });
});
