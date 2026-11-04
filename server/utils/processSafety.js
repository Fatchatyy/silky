// Last-resort handlers so one stray error does not take the shop down silently.
// Installed by server/index.js only (never by app.js), so tests that import the app are not affected.

/**
 * - unhandledRejection: a promise failed and nobody caught it. It is logged and the server keeps running (Node's default
 *   would stop the whole process for one failed background task).
 * - uncaughtException: the process state is unknown, so it is logged and the process exits with code 1 for the process
 *   manager (pm2, systemd, the host) to start it again.
 *
 * `proc` and `log` are parameters so the behaviour can be tested without touching the real process.
 */
export function installProcessSafetyHandlers({ proc = process, log = console, exit = (code) => process.exit(code) } = {}) {
  proc.on('unhandledRejection', (reason) => {
    log.error('[process] Unhandled promise rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
  });
  proc.on('uncaughtException', (err) => {
    log.error('[process] Uncaught exception, exiting:', err instanceof Error ? err.stack || err.message : err);
    exit(1);
  });
}
