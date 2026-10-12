import { STATUS_CODES } from 'node:http';

export function errorHandler(err, _req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const requestedStatus = err.status ?? err.statusCode;
  const status = Number.isInteger(requestedStatus)
    && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  const production = res.app.get('env') === 'production';
  const body = {
    status: 'error',
    message: production
      ? (status >= 500 ? 'Internal server error' : STATUS_CODES[status] ?? 'Request failed')
      : err.message || 'Internal server error',
  };

  if (!production && err.stack) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}
