export function invitationReturn(hash) {
  return /^#join=[A-Za-z0-9_-]{43}$/.test(hash || '') ? `/app/join/${hash.slice(6)}` : null;
}
