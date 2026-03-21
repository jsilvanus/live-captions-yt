// Minimal container-aware renderer shim. This is a placeholder showing how the
// renderer can be launched inside a container. Real implementation should use
// DockerFfmpegRunner or Worker Daemon job dispatch.

export async function startRenderer({ key, image = process.env.DSK_RENDERER_IMAGE || 'lcyt-dsk-renderer:latest' } = {}) {
  // In this minimal implementation we return a mocked renderer controller.
  return {
    key,
    image,
    startTime: Date.now(),
    async stop() {
      // noop
      return { stopped: true };
    },
    async status() {
      return { running: true, key, image };
    }
  };
}

export default { startRenderer };
