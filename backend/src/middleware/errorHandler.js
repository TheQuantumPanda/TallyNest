import { STATUS_CODES } from 'node:http';
import { HttpError } from '../utils/httpError.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const requestedStatus = err.status ?? err.statusCode;
  const status = Number.isInteger(requestedStatus)
    && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  const production = res.app.get('env') === 'production';
  // Express routing is case-insensitive by default; protect matching aliases too.
  const requestPath = req.path.toLowerCase();
  const authRequest = requestPath === '/api/auth' || requestPath.startsWith('/api/auth/');
  const transactionRequest = requestPath === '/api/transactions' || requestPath.startsWith('/api/transactions/');
  const dashboardRequest = requestPath === '/api/dashboard' || requestPath.startsWith('/api/dashboard/');
  const privateRequest = authRequest || transactionRequest || dashboardRequest;
  const safeMessage = err instanceof HttpError ? err.message
    : (status >= 500 ? 'Internal server error' : STATUS_CODES[status] ?? 'Request failed');
  const body = {
    status: 'error',
    message: production || privateRequest
      ? safeMessage
      : err.message || 'Internal server error',
  };

  if (!production && !privateRequest && err.stack) {
    body.stack = err.stack;
  }

  if (transactionRequest || dashboardRequest) {
    body.code = err instanceof HttpError && err.code ? err.code
      : ({ 400: 'INVALID_REQUEST', 401: 'AUTH_REQUIRED', 403: 'CSRF_REJECTED',
        404: 'NOT_FOUND', 413: 'BODY_TOO_LARGE', 415: 'JSON_REQUIRED', 429: 'RATE_LIMITED' }[status] ?? 'INTERNAL_ERROR');
  }
  res.status(status).json(body);
}
