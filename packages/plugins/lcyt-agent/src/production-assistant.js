/**
 * Production Assistant (plan/ai_roles_framework, Runtime Shape 2's
 * "Production Assistant — Event-Driven Trigger, Suggestion Queue").
 *
 * Unlike the chat-driven-dialog roles, Assistant has no dialog to drive —
 * its "actions" are device calls (camera.preset, mixer.switch), both
 * destructiveHint tools. The shared turn loop's default shouldExecute
 * (read-only only) already holds every one of Assistant's tool calls back
 * as a pendingAction; this manager decides what happens to that pending
 * action: queued for a human (confirm mode) or executed immediately with an
 * audit trail (auto mode) — never partially, never silently.
 *
 * Rate limiting mirrors CueEngine's cooldown_ms / Map<key, lastFiredTs>
 * pattern: a server-enforced floor (3000ms, not user-overridable) applies
 * only to auto mode, since confirm mode is already self-limiting (a human
 * has to act on each suggestion).
 */

import { randomUUID } from 'node:crypto';
import { runAgenticTurn, defaultShouldExecute } from './agentic-turn.js';

export const AUTO_COOLDOWN_FLOOR_MS = 3000;

export class ProductionAssistantManager {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {import('./roles-bus.js').RolesBus} rolesBus
   */
  constructor(db, rolesBus) {
    this._db = db;
    this._rolesBus = rolesBus;
    /** @type {Map<string, Map<string, { id, tool, args, reasoning, ts }>>} */
    this._suggestions = new Map();
    /** @type {Map<string, number>} */
    this._lastFiredAt = new Map();
  }

  /**
   * @param {string} apiKey
   * @returns {Array<{ id, tool, args, reasoning, ts }>}
   */
  listSuggestions(apiKey) {
    const map = this._suggestions.get(apiKey);
    return map ? [...map.values()] : [];
  }

  _addSuggestion(apiKey, suggestion) {
    if (!this._suggestions.has(apiKey)) this._suggestions.set(apiKey, new Map());
    this._suggestions.get(apiKey).set(suggestion.id, suggestion);
  }

  /**
   * Public entry point for external callers (e.g. the MCP endpoint) to stage
   * a suggestion for human confirmation, without reaching into the
   * underscore-prefixed internal queue directly.
   * @param {string} apiKey
   * @param {{ id: string, tool: string, args: object, reasoning?: string, ts?: number }} suggestion
   */
  stageSuggestion(apiKey, suggestion) {
    this._addSuggestion(apiKey, suggestion);
  }

  _takeSuggestion(apiKey, id) {
    const map = this._suggestions.get(apiKey);
    const suggestion = map?.get(id);
    if (!suggestion) return null;
    map.delete(id);
    return suggestion;
  }

  /**
   * Cooldown check. Auto mode has a hard floor (AUTO_COOLDOWN_FLOOR_MS);
   * confirm mode uses the configured value as-is (including 0 — a human
   * gating each suggestion is already self-limiting).
   * @returns {boolean} true if the trigger is allowed to fire now
   */
  _checkCooldown(apiKey, mode, cooldownMs) {
    const effective = mode === 'auto' ? Math.max(cooldownMs ?? 0, AUTO_COOLDOWN_FLOOR_MS) : (cooldownMs ?? 0);
    const last = this._lastFiredAt.get(apiKey) ?? 0;
    if (Date.now() - last < effective) return false;
    this._lastFiredAt.set(apiKey, Date.now());
    return true;
  }

  /**
   * Run one Assistant decision cycle against the current context window.
   *
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.triggerText] — a direct human nudge; added to context if present
   * @param {import('./agent-engine.js').AgentEngine} opts.agent — for getContext/addContext
   * @param {{ apiUrl, apiKey, model }} opts.apiSettings
   * @param {string} opts.systemPrompt
   * @param {Array<object>} opts.tools — Assistant's allowlisted tools (camera.preset/mixer.switch subset)
   * @param {Function} opts.callTool
   * @param {'confirm'|'auto'} opts.mode
   * @param {number} [opts.cooldownMs]
   * @returns {Promise<{ ok: boolean, skipped?: string, suggestion?: object, action?: object, reply?: string }>}
   */
  async runTrigger(opts) {
    const { apiKey, triggerText, agent, apiSettings, systemPrompt, tools, callTool, mode, cooldownMs } = opts;

    if (!this._checkCooldown(apiKey, mode, cooldownMs)) {
      return { ok: true, skipped: 'cooldown' };
    }

    if (triggerText) agent.addContext(apiKey, 'user_prompt', triggerText);

    const context = agent.getContext(apiKey);
    const contextStr = context.map((e) => `[${e.type}] ${e.text}`).join('\n') || '(no recent context)';
    const messages = [{ role: 'user', content: `Recent context:\n${contextStr}\n\nDecide whether a camera/mixer change is warranted right now.` }];

    const result = await runAgenticTurn({
      apiSettings, systemPrompt, messages, tools, callTool, apiKey,
      shouldExecute: defaultShouldExecute, // read-only only — every camera.preset/mixer.switch call is held back
    });

    if (result.error) return { ok: false, error: result.error };
    if (result.pendingActions.length === 0) return { ok: true, reply: result.reply };

    // Only the first proposed action is actioned — Assistant makes one
    // decision per trigger, not a batch of device changes.
    const [proposed] = result.pendingActions;

    if (mode === 'auto') {
      let toolResult;
      try {
        toolResult = await callTool(proposed.name, proposed.args, { apiKey });
      } catch (err) {
        toolResult = { ok: false, error: err.message };
      }
      const action = { id: randomUUID(), tool: proposed.name, args: proposed.args, reasoning: result.reply, result: toolResult, ts: Date.now() };
      this._rolesBus.emit(apiKey, 'assistant', 'assistant_action', action);
      return { ok: true, action };
    }

    const suggestion = { id: randomUUID(), tool: proposed.name, args: proposed.args, reasoning: result.reply, ts: Date.now() };
    this._addSuggestion(apiKey, suggestion);
    this._rolesBus.emit(apiKey, 'assistant', 'assistant_suggestion', suggestion);
    return { ok: true, suggestion };
  }

  /**
   * Execute a pending suggestion now (human confirmed it).
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async confirmSuggestion(apiKey, id, callTool) {
    const suggestion = this._takeSuggestion(apiKey, id);
    if (!suggestion) return { ok: false, error: 'Suggestion not found' };
    let toolResult;
    try {
      toolResult = await callTool(suggestion.tool, suggestion.args, { apiKey });
    } catch (err) {
      toolResult = { ok: false, error: err.message };
    }
    const action = { id: suggestion.id, tool: suggestion.tool, args: suggestion.args, reasoning: suggestion.reasoning, result: toolResult, ts: Date.now() };
    this._rolesBus.emit(apiKey, 'assistant', 'assistant_action', action);
    return { ok: true, action };
  }

  /**
   * Discard a pending suggestion (human rejected it).
   * @returns {boolean} — false if no matching suggestion existed
   */
  rejectSuggestion(apiKey, id) {
    return this._takeSuggestion(apiKey, id) !== null;
  }
}
