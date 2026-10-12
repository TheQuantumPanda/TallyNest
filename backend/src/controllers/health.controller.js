export function getHealth(_req, res) {
  res.status(200).json({
    status: 'ok',
    message: 'Smart Finance Manager API is running',
  });
}
