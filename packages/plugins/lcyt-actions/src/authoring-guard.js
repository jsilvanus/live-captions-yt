/**
 * Authoring guard for device actions (docs/plans/plan_backend_actions.md).
 *
 * Writing an action or a cue rule whose expression moves hardware needs the
 * Setup tier, because from then on it can run unattended; running one manually
 * needs only the Production tier. Callers without a user identity (project
 * session tokens, devices) pass, the same convention as the DSK activate
 * routes' operator gate.
 */
import { parseActionItems } from 'lcyt/actions';

/**
 * @param {object} deps
 * @param {{ isDeviceAtom: (metacode: string) => boolean }|null} deps.executor
 * @param {((tier: string, apiKey: string, userId: any) => boolean)|null} deps.checkProjectRole
 * @returns {(req: import('express').Request, apiKey: string, expr: unknown) => ({ status: number, error: string }|null)}
 */
export function createAuthoringGuard({ executor, checkProjectRole }) {
  return function guard(req, apiKey, expr) {
    if (!executor || typeof expr !== 'string' || !expr.trim()) return null;
    const hasDevice = parseActionItems(expr).some((i) => i.metacode && executor.isDeviceAtom(i.metacode));
    if (!hasDevice) return null;
    if (!req.user?.userId) return null;
    if (typeof checkProjectRole !== 'function' || !checkProjectRole('setup', apiKey, req.user.userId)) {
      return { status: 403, error: 'Explicit project admin/owner access required to save an action that controls devices' };
    }
    return null;
  };
}
