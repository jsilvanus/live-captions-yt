/**
 * deer embeddings — text embeddings from a local `@jsilvanus/embedeer` model server.
 *
 * The model runs in its own process (embedeer's gRPC server, e.g. `npm run server`
 * in the deer repo), never inside the backend: one model copy in RAM, a crash
 * cannot take the backend down, and the server can live on another machine.
 * This module is only the client side. `@jsilvanus/embedeer` is NOT a dependency
 * of this package; install it where `deer` embeddings are wanted (it pulls in
 * onnxruntime and transformers.js). It is imported lazily on first use.
 *
 * Environment:
 *   DEER_EMBED_ADDRESS — gRPC address of the embedeer server (default localhost:50051);
 *                        a per-project `embeddingApiUrl` wins when set.
 *   DEER_EMBED_MODEL   — model identifier (default onnx-community/gte-multilingual-base);
 *                        a per-project `embeddingModel` wins when set.
 */

export const DEER_DEFAULT_ADDRESS = 'localhost:50051';
export const DEER_DEFAULT_MODEL = 'onnx-community/gte-multilingual-base';

const PACKAGE = '@jsilvanus/embedeer';

/** Cached clients: Map<`${address}|${model}`, Promise<Embedder>> */
const clients = new Map();

async function defaultLoadEmbedder() {
  try {
    return (await import(/* @vite-ignore */ PACKAGE)).Embedder;
  } catch (err) {
    throw new Error(`deer embeddings need the ${PACKAGE} package (npm install ${PACKAGE}): ${err?.message || err}`);
  }
}

/** Resolve address/model from per-project values, then env, then defaults. */
export function resolveDeerTarget(opts = {}, env = process.env) {
  return {
    address: (opts.apiUrl || env.DEER_EMBED_ADDRESS || DEER_DEFAULT_ADDRESS).trim(),
    model: (opts.model || env.DEER_EMBED_MODEL || DEER_DEFAULT_MODEL).trim(),
  };
}

/**
 * Embed texts through an embedeer gRPC server.
 *
 * @param {string[]} texts
 * @param {{ apiUrl?: string, model?: string }} [opts] — apiUrl is the gRPC address
 * @param {{ loadEmbedder?: () => Promise<{ create: Function }> }} [deps] — test seam
 * @returns {Promise<number[][]>}
 */
export async function computeDeerEmbeddings(texts, opts = {}, deps = {}) {
  const { address, model } = resolveDeerTarget(opts);
  const key = `${address}|${model}`;
  if (!clients.has(key)) {
    const load = deps.loadEmbedder || defaultLoadEmbedder;
    const pending = load()
      .then(Embedder => Embedder.create(model, { mode: 'grpc', grpcAddress: address, autoStartServer: false }))
      .catch(err => { clients.delete(key); throw err; });
    clients.set(key, pending);
  }
  const embedder = await clients.get(key);
  try {
    const vectors = await embedder.embed(texts);
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error('deer embedding server returned an unexpected number of vectors');
    }
    return vectors.map(v => Array.from(v));
  } catch (err) {
    // Drop the cached client so the next call reconnects (server restart, network blip).
    clients.delete(key);
    Promise.resolve(embedder.destroy?.()).catch(() => {});
    throw err;
  }
}

/** Close every cached client (shutdown, tests). */
export async function closeDeerEmbeddings() {
  const pending = [...clients.values()];
  clients.clear();
  await Promise.all(pending.map(p => p.then(e => e.destroy?.()).catch(() => {})));
}
