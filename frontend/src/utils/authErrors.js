export function authErrorMessage(error, operation = 'login') {
  const status = error.response?.status;
  if (status === 401) return 'Email or password is incorrect. Please try again.';
  if (status === 409) return 'An account with this email already exists. Try signing in.';
  if (status === 429) return 'Too many attempts. Please wait a few minutes before trying again.';
  if (status === 403) return 'This request could not be verified. Refresh the page and try again.';
  if (status === 400) return 'Please check your details and try again.';
  if (operation === 'logout')
    return 'We could not sign you out. Please check your connection and try again.';
  return 'We could not reach your workspace. Please check your connection and try again.';
}
