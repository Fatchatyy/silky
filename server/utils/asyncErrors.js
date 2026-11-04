// Express 4 ignores the promise an async route handler returns, so an error thrown before the handler's own try/catch
// (for example a text field that arrives as an object) leaves the request hanging, and with Node's default settings
// takes the whole process down. This sends such errors to the normal error handler instead. Nothing else changes:
// handlers that catch their own errors never reach it. Must be imported before any router is created.
import Layer from 'express/lib/router/layer.js';

Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error-handling middleware is not part of the normal chain
  try {
    const returned = fn(req, res, next);
    if (returned && typeof returned.catch === 'function') returned.catch(next);
  } catch (err) {
    next(err);
  }
};
