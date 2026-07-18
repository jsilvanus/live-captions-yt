/**
 * Bus → metrics projection (plan_metering_audit §4.1). One global tap on the
 * shared EventBus, mirroring attachBusAuditLog but bumping usage counters
 * instead of persisting rows. Attribution comes from the envelope projectId.
 */

const TOPIC_COUNTERS = {
  'caption.sent': 'captions.sent',
  'caption.error': 'captions.failed',
  'plugin.cue_fired': 'cues.fired',
  'bridge.command_result': 'bridge.commands',
};

/**
 * @param {import('lcyt/event-bus').EventBus} eventBus
 * @param {ReturnType<import('./index.js').createMetrics>} metrics
 * @returns {() => void} unregister
 */
export function attachBusMetrics(eventBus, metrics) {
  return eventBus.tap((env) => {
    try {
      const project = env.projectId || '';
      const counter = TOPIC_COUNTERS[env.topic];
      if (counter) {
        metrics.count(counter, 1, { project });
        return;
      }
      if (env.topic === 'session.closed') {
        metrics.count('sessions.count', 1, { project });
        const durationMs = Number(env.data?.durationMs || 0);
        if (durationMs > 0) metrics.count('sessions.seconds', durationMs / 1000, { project });
        return;
      }
      // Connector refreshes surface as variable.<name>.changed
      if (env.topic.startsWith('variable.') && env.topic.endsWith('.changed')) {
        metrics.count('connectors.refreshes', 1, { project });
      }
    } catch {
      // Metrics must never break a publish.
    }
  });
}
