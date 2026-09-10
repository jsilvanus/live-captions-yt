/**
 * Wraps a project-access `auth` middleware so requests matching `matcher`
 * skip it entirely, even though `auth` is configured. Returns `null` when
 * `auth` itself is falsy, matching every router's existing
 * `if (auth) router.use(...)` opt-in pattern — callers should keep that
 * `if` check around the returned value.
 *
 * @param {import('express').RequestHandler|null} auth
 * @param {(req: import('express').Request) => boolean} matcher
 * @returns {import('express').RequestHandler|null}
 */
export function createAuthWithBypass(auth, matcher) {
  if (!auth) return null;
  return (req, res, next) => {
    if (matcher(req)) return next();
    return auth(req, res, next);
  };
}
