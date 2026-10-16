export function creationError(error) {
  const code = error.response?.data?.code;
  if (code === 'CREATION_DELETED')
    return 'The original creation was deleted. This retry key cannot recreate it. Review existing records before starting a new intent.';
  if (code === 'IDEMPOTENCY_CONFLICT')
    return 'This retry key belongs to a different creation payload. Review existing records before starting a new intent.';
}
