/**
 * Express 4 does not catch rejected promises from async handlers/middleware (the request would hang
 * and the rejection would be unhandled). Route all of them to next(err), as Express 5 does.
 * Imported for its side effect (once) by src/db/connection.js and src/server.js.
 */
import Layer from 'express/lib/router/layer.js';

if (!Layer.prototype.__lcytAsync) {
  Layer.prototype.__lcytAsync = true;
  Layer.prototype.handle_request = function (req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype.handle_error = function (error, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(error);
    try {
      const result = fn(error, req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}
