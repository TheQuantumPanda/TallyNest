import { HttpError } from '../utils/httpError.js';

export function protectCsrf(clientOrigin) {
  return (req, _res, next) => {
    // Fail closed, including missing/null Origin. Custom headers require CORS
    // preflight; HTML forms cannot satisfy this contract.
    if (req.get('origin') !== clientOrigin || req.get('x-csrf-protection') !== '1') {
      return next(new HttpError(403, 'Request origin or CSRF header rejected'));
    }
    next();
  };
}
