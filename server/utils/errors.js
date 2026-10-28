export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export function sendError(res, err, fallback = 'Internal server error') {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  // Only AppError (and client errors below 500) carry a message meant for the client. Anything else that ends
  // up as a 5xx (database driver, runtime errors) keeps its detail in the server log, never in the response.
  const exposeMessage = err instanceof AppError || status < 500;
  res.status(status).json({ error: (exposeMessage && err.message) || fallback });
}
