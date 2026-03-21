// Minimal Hetzner client utilities (stubbed for local dev)
// If HETZNER_API_TOKEN is present, functions will return mocked server objects.

function checkToken() {
  return !!process.env.HETZNER_API_TOKEN;
}

export async function createServer({ name, server_type = 'cx21', image, networks = [] } = {}) {
  if (!checkToken()) throw new Error('HETZNER_API_TOKEN not configured');
  // Mocked create: return an object with id and status
  const id = `mock-${Date.now().toString(36)}`;
  return { id, name, server_type, image, networks, status: 'running', createdAt: Date.now() };
}

export async function deleteServer(id) {
  if (!checkToken()) throw new Error('HETZNER_API_TOKEN not configured');
  // Mock delete
  return { id, deleted: true };
}

export async function getServer(id) {
  if (!checkToken()) throw new Error('HETZNER_API_TOKEN not configured');
  return { id, status: 'running' };
}

export default { createServer, deleteServer, getServer };
