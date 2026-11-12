// On-device background removal for Image to 3D (IS-Net, onnxruntime-web; WebGPU when available, else WASM).
// Same model files and Cache API entry as Amatu "Hapus Background", so a model already downloaded there is reused.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
const HF = 'https://huggingface.co/';
const MIRROR = 'https://amatu-id.github.io/background/models/';
const CACHE = 'amatu-bg-models-v1';
const MODEL = {
  gpu: { url: 'onnx-community/ISNet-ONNX/resolve/main/onnx/model_fp16.onnx', mirror: 'isnet_fp16.onnx', mb: 88 },
  cpu: { url: 'onnx-community/ISNet-ONNX/resolve/main/onnx/model_quantized.onnx', mirror: 'isnet_quantized.onnx', mb: 44 },
};
const S = 1024;
let ort = null, session = null, inType = 'float32', useGPU = false;
const post = (m) => self.postMessage(m);

async function gpuOK() { try { return !!(self.navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } }
async function fetchModel(v) {
  const key = HF + v.url;
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { /* no Cache API */ }
  let err;
  for (const u of [MIRROR + v.mirror, HF + v.url]) {
    try {
      const res = await fetch(u); if (!res.ok) throw new Error('HTTP ' + res.status);
      // a compressed response reports its compressed length: fall back to the known model size
      const total = (res.headers.get('content-encoding') ? 0 : +res.headers.get('content-length')) || v.mb * 1e6, rd = res.body.getReader(), parts = []; let got = 0, last = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (Date.now() - last > 150) { last = Date.now(); post({ type: 'progress', text: `Downloading the cut-out model… ${Math.min(99, Math.round((got / total) * 100))}% of ${v.mb} MB (one time)`, p: Math.min(0.99, got / total) }); } }
      const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      if (cache) { try { await cache.put(key, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota */ } }
      return buf;
    } catch (e) { err = e; }
  }
  throw new Error('Could not download the cut-out model (' + (err && err.message) + ')');
}
// GPU (WebGPU): fp16 model, ~0.5 s per picture. Without a GPU the quantized model runs on one CPU thread
// (GitHub Pages is not cross-origin isolated), which takes about a minute on a laptop.
async function pick(device) {
  const gpu = device !== 'cpu' && await gpuOK();
  return gpu ? { v: MODEL.gpu, gpu: true } : { v: MODEL.cpu, gpu: false };
}
async function load(device) {
  if (session) return;
  const p = await pick(device); useGPU = p.gpu;
  post({ type: 'progress', text: 'Loading the cut-out model…' });
  ort = await import(ORT + (useGPU ? 'ort.webgpu.bundle.min.mjs' : 'ort.wasm.bundle.min.mjs'));
  ort.env.wasm.wasmPaths = ORT; ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  const buf = await fetchModel(p.v);
  try { session = await ort.InferenceSession.create(buf, { executionProviders: useGPU ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all' }); }
  catch (e) { if (!useGPU) throw e; session = null; ort = null; return load('cpu'); }
  const meta = session.inputMetadata && session.inputMetadata[0];
  inType = meta && /16/.test(String(meta.type)) ? 'float16' : 'float32';
}
// float32 <-> float16 bits
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) { f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff; if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | (e << 10) | (m >>> 13); }
function fromHalf(h) { const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff; if (!e) return s * m * 2 ** -24; if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * 2 ** (e - 15); }

self.onmessage = async (ev) => {
  const { rgba, w, h, device } = ev.data;
  try {
    await load(device);
    post({ type: 'progress', text: useGPU ? 'Cutting out the object (GPU)…' : 'Cutting out the object… (no GPU on this device, this can take a minute)' });
    const oc = new OffscreenCanvas(S, S), cx = oc.getContext('2d', { willReadFrequently: true });
    cx.drawImage(await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), w, h)), 0, 0, S, S);
    const px = cx.getImageData(0, 0, S, S).data, n = S * S, f = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { f[i] = px[j] / 255 - 0.5; f[n + i] = px[j + 1] / 255 - 0.5; f[2 * n + i] = px[j + 2] / 255 - 0.5; }
    const run = (type) => session.run({ [session.inputNames[0]]: new ort.Tensor(type, type === 'float16' ? Uint16Array.from(f, toHalf) : f, [1, 3, S, S]) });
    let out;
    try { out = await run(inType); } catch (e) { inType = inType === 'float16' ? 'float32' : 'float16'; out = await run(inType); }
    const t = out[session.outputNames[0]];
    let d = t.data; if (t.type === 'float16') d = Float32Array.from(d instanceof Uint16Array ? d : new Uint16Array(d.buffer), fromHalf);
    let mn = Infinity, mx = -Infinity; for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
    const m = new Float32Array(d.length), sig = mn < -0.01 || mx > 1.01, r = mx - mn || 1;
    for (let i = 0; i < d.length; i++) m[i] = sig ? 1 / (1 + Math.exp(-d[i])) : (d[i] - mn) / r;
    self.postMessage({ type: 'done', map: m, size: Math.round(Math.sqrt(m.length)), ep: useGPU ? 'webgpu' : 'wasm' }, [m.buffer]);
  } catch (e) { post({ type: 'error', message: String((e && e.message) || e) }); }
};
