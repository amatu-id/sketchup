// Free image-to-3D models hosted on Hugging Face Spaces (ZeroGPU). Each engine uploads the
// cut-out photo, runs the Space's own functions and returns the URL of the generated GLB.
//
//  frame: 'canonical' → the model comes out upright with its real front at glTF +Z
//         'photo'     → upright, but which side is the front is unknown: the photo decides
//         'camera'    → built in the photo's camera frame (tilted like the photo), cam = camera direction
//  gpu:   seconds of ZeroGPU quota the Space reserves per run (from its @spaces.GPU duration)
//  crease: dihedral angle (deg) above which an edge stays visible with "sharp edges only" (noisier meshes need more)
import { Space, SpaceError, filesIn, fileUrl } from './gradio.js';

const glbOf = (sp, out) => {
  const f = filesIn(out).find((x) => /\.(glb|gltf|obj|ply)$/i.test(x.path || x.orig_name || ''));
  if (!f) throw new SpaceError(`${sp.id} finished without a 3D file`, 'error');
  return { url: fileUrl(sp, f), name: (f.orig_name || f.path).split('/').pop(), size: f.size || 0 };
};
const seedOf = (ctx) => (ctx.seed ?? 0) | 0;

export const ENGINES = [
  {
    id: 'hunyuan', name: 'Hunyuan3D 2.1', by: 'Tencent', space: 'tencent/Hunyuan3D-2.1', gpu: 60, textured: false, frame: 'canonical', crease: 35,
    note: 'Cleanest shape, colours taken from your photo',
    async run(sp, ctx) {
      const f = await sp.upload(ctx.png, 'object.png');
      ctx.step('Generating the shape…');
      // [image, front, back, left, right, steps, guidance, seed, octree, remove bg, chunks, randomize]
      const out = await sp.call('shape_generation', [f, null, null, null, null, 30, 5, seedOf(ctx), 256, !ctx.cut, 8000, false]);
      return glbOf(sp, out);
    },
  },
  {
    id: 'trellis', name: 'TRELLIS', by: 'Microsoft', space: 'trellis-community/TRELLIS', gpu: 120, textured: true, frame: 'photo', crease: 45,
    note: 'Shape and texture together',
    async run(sp, ctx) {
      try { await sp.call('start_session', []); } catch (e) { if (e.kind === 'cancel') throw e; }
      let f = await sp.upload(ctx.png, 'object.png');
      try { const pre = filesIn(await sp.call('preprocess_image', [f]))[0]; if (pre) f = pre; } catch (e) { if (e.kind === 'cancel') throw e; }
      ctx.step('Generating shape and texture…');
      const out = await sp.call('generate_and_extract_glb', [f, [], seedOf(ctx), 7.5, 12, 3, 12, 'stochastic', 0.95, 1024]);
      return glbOf(sp, out);
    },
  },
  {
    id: 'sf3d', name: 'Stable Fast 3D', by: 'Stability AI', space: 'stabilityai/stable-fast-3d', gpu: 60, textured: true, frame: 'camera', cam: [0, 0, -1], crease: 55,
    note: 'Fastest, textured, softer shapes',
    async run(sp, ctx) {
      const f = await sp.upload(ctx.png, 'object.png');
      const base = { 'Input Image': f, 'Foreground Ratio': 0.85, Remeshing: 'None', 'Target Vertex Count': -1, 'Texture Size': 1024 };
      const r = await sp.call('requires_bg_remove', { 'Input Image': f, 'Foreground Ratio': 0.85 });
      const btn = r?.[0]?.value || 'Run';
      if (btn !== 'Run') { ctx.step('Removing the background…'); await sp.call('run_button', { ...base, button: btn }); }
      ctx.step('Generating shape and texture…');
      const out = await sp.call('run_button', { ...base, button: 'Run' });
      return glbOf(sp, out);
    },
  },
  {
    id: 'triposg', name: 'TripoSG', by: 'VAST', space: 'VAST-AI/TripoSG', gpu: 60, textured: false, frame: 'photo', crease: 40,
    note: 'Detailed shape, colours from your photo',
    async run(sp, ctx) {
      try { await sp.call('start_session', []); } catch (e) { if (e.kind === 'cancel') throw e; }
      let f = await sp.upload(ctx.png, 'object.png');
      if (!ctx.cut) { ctx.step('Removing the background…'); const seg = filesIn(await sp.call('run_segmentation', [f]))[0]; if (seg) f = seg; }
      ctx.step('Generating the shape…');
      const out = await sp.call('image_to_3d', [f, seedOf(ctx), 50, 7, true, 100000]);
      return glbOf(sp, out);
    },
  },
  {
    id: 'trellis2', name: 'TRELLIS.2', by: 'Microsoft', space: 'microsoft/TRELLIS.2', gpu: 180, textured: true, frame: 'photo', crease: 40,
    note: 'Highest quality; needs a larger quota (HF token)',
    async run(sp, ctx) {
      try { await sp.call('start_session', []); } catch (e) { if (e.kind === 'cancel') throw e; }
      let f = await sp.upload(ctx.png, 'object.png');
      try { const pre = filesIn(await sp.call('preprocess_image', [f]))[0]; if (pre) f = pre; } catch (e) { if (e.kind === 'cancel') throw e; }
      ctx.step('Generating shape and texture…');
      await sp.call('image_to_3d', [f, seedOf(ctx), '1024', 7.5, 0.7, 12, 5, 7.5, 0.5, 12, 3, 1, 0, 12, 3]);
      ctx.step('Baking the textured model…');
      const out = await sp.call('extract_glb', [Math.max(20000, ctx.faces * 3), 1024]);
      return glbOf(sp, out);
    },
  },
];
export const AUTO_ORDER = ['hunyuan', 'trellis', 'sf3d', 'triposg'];
export const engineById = (id) => ENGINES.find((e) => e.id === id);

// ---------------------------------------------------------------- daily GPU quota (learned from the Spaces' answers)
// sessionStorage: the quota belongs to this connection/IP, so it must not follow the account to other devices
const QKEY = 'amatu-sketch:ai-quota';
export function quotaState(token) {
  try {
    const q = JSON.parse(sessionStorage.getItem(QKEY) || 'null');
    if (!q || q.tok !== !!token || Date.now() > q.until) return null;
    return q;
  } catch (e) { return null; }
}
function noteQuota(token, msg) {
  const left = msg.match(/vs\.?\s*(\d+)\s*s\s*left/i), again = msg.match(/again in\s*(\d+):(\d+):(\d+)/i);
  const until = again ? Date.now() + ((+again[1] * 60 + +again[2]) * 60 + +again[3]) * 1000 : Date.now() + 3600e3;
  const q = { tok: !!token, left: left ? +left[1] : 0, until, t: Date.now() };
  try { sessionStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* storage off */ }
  return q;
}
export function quotaText(q) {
  if (!q) return '';
  const mins = Math.max(1, Math.ceil((q.until - Date.now()) / 60e3)), h = Math.floor(mins / 60), m = mins % 60;
  return `${q.left}s of free GPU left today · refills in ${h ? h + ' h' : ''}${h && m ? ' ' : ''}${m || !h ? m + ' min' : ''}`;
}

// Runs the chosen engine, or the Auto chain: on quota/busy/down errors the next engine is tried.
export async function generate(ctx) {
  const ids = ctx.engine === 'auto' ? AUTO_ORDER : [ctx.engine];
  const tried = [];
  for (const id of ids) {
    const E = engineById(id);
    const q = quotaState(ctx.token);
    if (ctx.engine === 'auto' && q && q.left < E.gpu) { tried.push({ E, kind: 'quota', msg: `needs ${E.gpu}s of GPU, ${q.left}s left` }); continue; }
    ctx.status({ engine: E, text: `Connecting to ${E.name}…` });
    try {
      const sp = new Space(E.space, { token: ctx.token, signal: ctx.signal, onStatus: (s) => ctx.status({ engine: E, ...s }) });
      await sp.connect();
      const res = await E.run(sp, { ...ctx, step: (text) => ctx.status({ engine: E, text }) });
      return { ...res, engine: E, tried };
    } catch (e) {
      if (e.kind === 'cancel' || ctx.signal?.aborted) throw new SpaceError('Cancelled', 'cancel');
      if (e.kind === 'quota') noteQuota(ctx.token, e.message);
      tried.push({ E, kind: e.kind || 'error', msg: e.message });
      ctx.status({ engine: E, text: `${E.name}: ${shortReason(e)}` + (ids.indexOf(id) < ids.length - 1 ? ' — trying the next model…' : ''), warn: true });
    }
  }
  const err = new SpaceError(tried.map((t) => `${t.E.name}: ${t.msg}`).join('\n'), tried.every((t) => t.kind === 'quota') ? 'quota' : tried.some((t) => t.kind === 'quota') ? 'quota' : 'down');
  err.tried = tried;
  throw err;
}
export function shortReason(e) {
  if (e.kind === 'quota') {
    const m = e.message.match(/\((\d+)s requested vs\.?\s*(\d+)s left\)/), sk = e.message.match(/needs (\d+)s of GPU, (\d+)s left/);
    if (sk) return `skipped — needs ${sk[1]} s of GPU, ${sk[2]} s left today`;
    return m ? `free GPU quota used up (needs ${m[1]} s, ${m[2]} s left)` : 'free GPU quota used up';
  }
  if (e.kind === 'busy') return 'busy right now';
  if (e.kind === 'down') return 'not available right now';
  if (e.kind === 'auth') return 'the Hugging Face token was refused';
  return String(e.message || e).split('\n')[0].slice(0, 160);
}
