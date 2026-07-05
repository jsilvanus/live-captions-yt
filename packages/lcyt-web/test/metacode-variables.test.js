import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateVariables } from '../src/lib/metacode-variables.js';

describe('interpolateVariables()', () => {
  it('replaces {{name}} with the resolved value', () => {
    assert.equal(interpolateVariables('Hello {{name}}!', { name: 'World' }), 'Hello World!');
  });

  it('renders missing variables as empty string', () => {
    assert.equal(interpolateVariables('{{missing}}', {}), '');
  });

  it('leaves plain text without markers untouched', () => {
    assert.equal(interpolateVariables('plain text', { a: '1' }), 'plain text');
  });

  it('handles multiple references, some resolved some not', () => {
    assert.equal(interpolateVariables('{{a}}-{{b}}-{{c}}', { a: '1', c: '3' }), '1--3');
  });

  it('non-string input passes through unchanged', () => {
    assert.equal(interpolateVariables(null, {}), null);
    assert.equal(interpolateVariables(undefined, {}), undefined);
  });
});
