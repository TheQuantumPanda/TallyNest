export function createAuthController(authService, { cookieName, cookieOptions, jwtTtlSeconds }) {
  function sendSession(res, result, status, message) {
    res.cookie(cookieName, result.token, { ...cookieOptions, maxAge: jwtTtlSeconds * 1000 });
    res.status(status).json({ status: 'ok', message, data: { user: result.user } });
  }

  return {
    async register(req, res) {
      sendSession(
        res,
        await authService.register(req.validatedBody),
        201,
        'Registration successful',
      );
    },
    async login(req, res) {
      sendSession(res, await authService.login(req.validatedBody), 200, 'Login successful');
    },
    logout(_req, res) {
      // Same path, security and SameSite settings; no maxAge when clearing.
      res.clearCookie(cookieName, cookieOptions);
      res.status(200).json({ status: 'ok', message: 'Logout successful' });
    },
    me(req, res) {
      res.status(200).json({ status: 'ok', data: { user: req.user } });
    },
  };
}
