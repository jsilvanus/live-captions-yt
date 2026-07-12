/**
 * Hosted Operator (Phase 2 — plan_unified_external_control.md).
 *
 * A persistent, event-fed agent session that subscribes to the EventBus and
 * reacts autonomously. Unlike the Production Assistant (which fires per-trigger
 * and returns), the Operator maintains a continuous session — relevant events
 * become turns in its context, it decides whether to act (with cooldowns), and
 * executes via the tool registry with confirm-by-default.
 *
 * BYO model/key via the existing provider registry / per-role model config.
 * The operator's brain runs through the existing agentic-turn loop (OpenAI-
 * compatible).
 */

import { randomUUID } from 'node:crypto';

const DEFAULT_COOLDOWN_MS = 5000;
const MAX_CONTEXT_EVENTS = 50;
const DEFAULT_TOPICS = ['cue.fired', 'caption.*', 'session.*', 'dsk.*', 'external.*'];

/**
 * @typedef {Object} OperatorSession
 * @property {string} id
 * @property {string} projectId
 * @property {'running'|'stopped'|'error'} status
 * @property {string[]} topics
 * @property {Array<{role: string, content: string, ts: number}>} context
 * @property {() => void} unsubscribe
 * @property {number} startedAt
 * @property {number} lastActionAt
 * @property {object} config
 */

export class OperatorManager {
  /**
   * @param {object} opts
   * @param {import('lcyt/event-bus').EventBus} opts.eventBus
   * @param {import('better-sqlite3').Database} opts.db
   * @param {object} opts.toolsContext — { tools, callTool }
   * @param {object} [opts.assistantManager]
   */
  constructor({ eventBus, db, toolsContext, assistantManager }) {
    this._eventBus = eventBus;
    this._db = db;
    this._toolsContext = toolsContext;
    this._assistantManager = assistantManager;
    /** @type {Map<string, OperatorSession>} keyed by projectId */
    this._sessions = new Map();
  }

  /**
   * Start an operator session for a project.
   * @param {string} projectId
   * @param {object} [config]
   * @param {string[]} [config.topics] — event topics to subscribe to
   * @param {'confirm'|'auto'} [config.mode] — confirm-by-default or auto
   * @param {number} [config.cooldownMs]
   * @param {string} [config.systemPrompt]
   * @returns {{ ok: boolean, session?: object, error?: string }}
   */
  start(projectId, config = {}) {
    if (this._sessions.has(projectId)) {
      return { ok: false, error: 'Operator already running for this project' };
    }

    const topics = config.topics || DEFAULT_TOPICS;
    const mode = config.mode || 'confirm';
    const cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const systemPrompt = config.systemPrompt || 'You are an autonomous production operator. Monitor events and take action when appropriate using the available tools.';

    const session = {
      id: randomUUID(),
      projectId,
      status: 'running',
      topics,
      context: [],
      unsubscribe: null,
      startedAt: Date.now(),
      lastActionAt: 0,
      config: { mode, cooldownMs, systemPrompt, topics },
      /** @type {Array<{ id, tool, args, reasoning, ts }>} */
      pendingActions: [],
      /** @type {Array<{ id, tool, args, result, ts }>} */
      actionHistory: [],
    };

    // Subscribe to EventBus
    const unsubscribe = this._eventBus.subscribe(projectId, topics, (envelope) => {
      this._handleEvent(projectId, envelope);
    });
    session.unsubscribe = unsubscribe;

    this._sessions.set(projectId, session);

    this._eventBus.publish(projectId, 'operator.started', {
      sessionId: session.id,
      topics,
      mode,
    });

    return {
      ok: true,
      session: this._summarize(session),
    };
  }

  /**
   * Stop the operator for a project.
   */
  stop(projectId) {
    const session = this._sessions.get(projectId);
    if (!session) return { ok: false, error: 'No operator running for this project' };

    session.unsubscribe?.();
    session.status = 'stopped';
    this._sessions.delete(projectId);

    this._eventBus.publish(projectId, 'operator.stopped', {
      sessionId: session.id,
      ran: Date.now() - session.startedAt,
    });

    return { ok: true };
  }

  /**
   * Get status of the operator for a project.
   */
  status(projectId) {
    const session = this._sessions.get(projectId);
    if (!session) return { running: false };
    return { running: true, ...this._summarize(session) };
  }

  /**
   * List pending actions awaiting confirmation.
   */
  listPending(projectId) {
    const session = this._sessions.get(projectId);
    if (!session) return [];
    return session.pendingActions;
  }

  /**
   * Confirm a pending operator action.
   */
  async confirmAction(projectId, actionId) {
    const session = this._sessions.get(projectId);
    if (!session) return { ok: false, error: 'No operator running' };

    const idx = session.pendingActions.findIndex((a) => a.id === actionId);
    if (idx === -1) return { ok: false, error: 'Action not found' };

    const [action] = session.pendingActions.splice(idx, 1);

    try {
      const result = await this._toolsContext.callTool(action.tool, action.args, { apiKey: projectId });
      const executed = { id: action.id, tool: action.tool, args: action.args, result, ts: Date.now() };
      session.actionHistory.push(executed);
      session.lastActionAt = Date.now();

      this._eventBus.publish(projectId, 'operator.action_executed', executed);
      return { ok: true, action: executed };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Reject a pending operator action.
   */
  rejectAction(projectId, actionId) {
    const session = this._sessions.get(projectId);
    if (!session) return { ok: false, error: 'No operator running' };

    const idx = session.pendingActions.findIndex((a) => a.id === actionId);
    if (idx === -1) return { ok: false, error: 'Action not found' };

    const [action] = session.pendingActions.splice(idx, 1);
    this._eventBus.publish(projectId, 'operator.action_rejected', { id: action.id, tool: action.tool });
    return { ok: true };
  }

  // --- Internal ---

  /**
   * Handle an incoming event from the bus.
   */
  _handleEvent(projectId, envelope) {
    const session = this._sessions.get(projectId);
    if (!session || session.status !== 'running') return;

    // Add to context window
    session.context.push({
      role: 'event',
      content: `[${envelope.topic}] ${JSON.stringify(envelope.data)}`,
      ts: envelope.ts,
    });

    // Trim context to max size
    if (session.context.length > MAX_CONTEXT_EVENTS) {
      session.context = session.context.slice(-MAX_CONTEXT_EVENTS);
    }

    // Cooldown check — don't evaluate on every single event
    const { cooldownMs } = session.config;
    if (session.lastActionAt && Date.now() - session.lastActionAt < cooldownMs) {
      return;
    }

    // Queue evaluation (non-blocking). The actual LLM call happens in
    // _evaluate, which is async. We don't await it here to avoid blocking
    // event delivery.
    this._evaluate(projectId, session).catch((err) => {
      session.context.push({
        role: 'system',
        content: `Operator evaluation error: ${err.message}`,
        ts: Date.now(),
      });
    });
  }

  /**
   * Run one operator evaluation cycle.
   * This is a simplified version — in production, this would call an LLM
   * through the agentic-turn loop with the operator's tools.
   */
  async _evaluate(projectId, session) {
    // For now, the operator evaluation is a hook point. Full LLM integration
    // requires the agent's AI config (model, API key) which comes from the
    // per-project AI settings. The infrastructure (event subscription, context
    // accumulation, cooldown, confirm/auto gate, action queue) is wired;
    // the actual LLM decision-making can be plugged in via setEvaluator().
    if (!this._evaluator) return;

    const { mode, systemPrompt } = session.config;
    const contextStr = session.context
      .slice(-20)
      .map((e) => `[${e.role}] ${e.content}`)
      .join('\n');

    const decision = await this._evaluator({
      projectId,
      systemPrompt,
      context: contextStr,
      tools: this._toolsContext.tools,
    });

    if (!decision || !decision.tool) return;

    if (mode === 'auto') {
      // Execute immediately
      try {
        const result = await this._toolsContext.callTool(decision.tool, decision.args || {}, { apiKey: projectId });
        const action = { id: randomUUID(), tool: decision.tool, args: decision.args || {}, result, ts: Date.now() };
        session.actionHistory.push(action);
        session.lastActionAt = Date.now();
        this._eventBus.publish(projectId, 'operator.action_executed', action);
      } catch (err) {
        session.context.push({ role: 'system', content: `Action failed: ${err.message}`, ts: Date.now() });
      }
    } else {
      // Stage for confirmation
      const pending = {
        id: randomUUID(),
        tool: decision.tool,
        args: decision.args || {},
        reasoning: decision.reasoning || '',
        ts: Date.now(),
      };
      session.pendingActions.push(pending);
      session.lastActionAt = Date.now();
      this._eventBus.publish(projectId, 'operator.action_staged', pending);
    }
  }

  /**
   * Set the evaluator function (LLM decision-maker).
   * @param {(opts: { projectId, systemPrompt, context, tools }) => Promise<{ tool?, args?, reasoning? }|null>} fn
   */
  setEvaluator(fn) {
    this._evaluator = fn;
  }

  _summarize(session) {
    return {
      id: session.id,
      projectId: session.projectId,
      status: session.status,
      topics: session.topics,
      startedAt: session.startedAt,
      lastActionAt: session.lastActionAt || null,
      contextSize: session.context.length,
      pendingCount: session.pendingActions.length,
      actionCount: session.actionHistory.length,
      config: session.config,
    };
  }
}
