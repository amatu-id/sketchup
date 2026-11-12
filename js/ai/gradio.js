// Minimal client for public Gradio apps on Hugging Face Spaces (queue protocol sse_v3,
// Gradio 4–6). Runs straight from the browser: Spaces answer CORS for any origin, so no
// server of ours sits in between, and each visitor uses their own free GPU quota.

const rid = () => Math.random().toString(36).slice(2, 13);

export class SpaceError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

// "microsoft/TRELLIS.2" -> https://microsoft-trellis-2.hf.space
export const spaceHost = (id) => 'https://' + id.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.hf.space';

export class Space {
  constructor(id, opts = {}) {
    this.id = id; this.host = spaceHost(id);
    this.token = opts.token || '';
    this.signal = opts.signal || null;
    this.onStatus = opts.onStatus || (() => {});
    this.session = rid();
    this.config = null; this.api = '';
  }
  headers(json) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    return h;
  }
  async fetch(url, init = {}, ms = 30000) {
    const ac = new AbortController();
    const stop = () => ac.abort();
    this.signal?.addEventListener('abort', stop);
    const t = setTimeout(stop, ms);
    try { return await fetch(url, { ...init, signal: ac.signal }); }
    catch (e) {
      if (this.signal?.aborted) throw new SpaceError('Cancelled', 'cancel');
      throw new SpaceError(`${this.id} is not reachable (${e.name === 'AbortError' ? 'timeout' : e.message})`, 'down');
    } finally { clearTimeout(t); this.signal?.removeEventListener('abort', stop); }
  }
  async connect() {
    const r = await this.fetch(this.host + '/config', { headers: this.headers() }, 25000);
    if (!r.ok) throw new SpaceError(`${this.id} is ${r.status === 503 || r.status === 404 ? 'sleeping or offline' : 'unavailable'} (HTTP ${r.status})`, 'down');
    let cfg;
    try { cfg = await r.json(); } catch (e) { throw new SpaceError(`${this.id} is starting up, try again in a minute`, 'down'); }
    if (!cfg || !Array.isArray(cfg.dependencies)) throw new SpaceError(`${this.id} returned an unexpected config`, 'down');
    this.config = cfg;
    this.api = this.host + (cfg.api_prefix || '');
    return this;
  }
  // dependency (event listener) by api name, e.g. "run_button"
  dep(name) {
    const deps = this.config.dependencies;
    const i = deps.findIndex((d) => d.api_name === name || d.api_name === name.replace(/^\//, ''));
    if (i < 0) throw new SpaceError(`${this.id} no longer has the "${name}" function`, 'down');
    return { dep: deps[i], fn: deps[i].id ?? i };
  }
  comp(id) { return this.config.components.find((c) => c.id === id); }
  async upload(blob, name = 'image.png') {
    const fd = new FormData(); fd.append('files', blob, name);
    const r = await this.fetch(this.api + '/upload?upload_id=' + rid(), { method: 'POST', body: fd, headers: this.headers() }, 60000);
    if (!r.ok) throw new SpaceError(`Upload to ${this.id} failed (HTTP ${r.status})`, 'down');
    const [path] = await r.json();
    return { path, orig_name: name, size: blob.size, mime_type: blob.type || 'image/png', meta: { _type: 'gradio.FileData' } };
  }
  // values: object keyed by input label / component type, or an array in input order.
  // States are sent as null (the server keeps them per session).
  build(name, values) {
    const { dep, fn } = this.dep(name);
    if (Array.isArray(values)) {
      // positional values, with or without the state slots (nulls are inserted for those)
      if (values.length === dep.inputs.length) return { fn, data: values, dep };
      const vals = [...values];
      return { fn, data: dep.inputs.map((id) => (this.comp(id)?.type === 'state' ? null : vals.shift() ?? null)), dep };
    }
    const data = dep.inputs.map((id) => {
      const c = this.comp(id) || {}; const label = c.props?.label;
      if (c.type === 'state') return null;
      for (const k of [label, c.props?.elem_id, c.type]) if (k != null && k in values) return values[k];
      return c.props?.value ?? null;
    });
    return { fn, data, dep };
  }
  // runs one event and resolves with its output data array
  async call(name, values = {}, opts = {}) {
    const { fn, data } = this.build(name, values);
    const r = await this.fetch(this.api + '/queue/join?', { method: 'POST', headers: this.headers(true), body: JSON.stringify({ data, event_data: null, fn_index: fn, trigger_id: null, session_hash: this.session }) }, 30000);
    if (r.status === 429) throw new SpaceError(`${this.id} is too busy right now`, 'busy');
    if (!r.ok) { let m = ''; try { m = (await r.json()).detail || ''; } catch (e) { /* not json */ } throw new SpaceError(`${this.id} refused the job (HTTP ${r.status}${m ? ': ' + m : ''})`, r.status === 401 || r.status === 403 ? 'auth' : 'down'); }
    const { event_id: eid } = await r.json();
    return this.listen(eid, opts.timeout || 600000);
  }
  async listen(eid, ms) {
    const ac = new AbortController();
    const stop = () => ac.abort();
    this.signal?.addEventListener('abort', stop);
    let idle; const arm = () => { clearTimeout(idle); idle = setTimeout(stop, 120000); };
    const total = setTimeout(stop, ms);
    arm();
    try {
      const res = await fetch(this.api + '/queue/data?session_hash=' + this.session, { headers: { ...this.headers(), Accept: 'text/event-stream' }, signal: ac.signal });
      if (!res.ok || !res.body) throw new SpaceError(`${this.id} stream failed (HTTP ${res.status})`, 'down');
      const rd = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        arm();
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
          const line = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch (e) { continue; }
          if (m.msg === 'heartbeat') continue;
          if (m.msg === 'unexpected_error') throw new SpaceError(m.message || `${this.id} failed`, 'down');
          if (m.event_id && m.event_id !== eid) continue;
          if (m.msg === 'estimation') this.onStatus({ stage: 'queue', rank: m.rank, size: m.queue_size, eta: m.rank_eta });
          else if (m.msg === 'process_starts') this.onStatus({ stage: 'run', eta: m.eta });
          else if (m.msg === 'progress') this.onStatus({ stage: 'run', progress: m.progress_data });
          else if (m.msg === 'log') this.onStatus({ stage: 'log', text: m.log, level: m.level });
          else if (m.msg === 'process_completed') {
            if (m.success === false || m.output?.error) throw classify(this.id, m.output?.error || m.title || 'failed', m.title);
            rd.cancel().catch(() => {});
            return m.output?.data || [];
          } else if (m.msg === 'close_stream') throw new SpaceError(`${this.id} closed the connection`, 'down');
        }
      }
      throw new SpaceError(`${this.id} stopped answering`, 'down');
    } catch (e) {
      if (e instanceof SpaceError) throw e;
      if (this.signal?.aborted) throw new SpaceError('Cancelled', 'cancel');
      throw new SpaceError(`${this.id} timed out`, 'down');
    } finally {
      clearTimeout(idle); clearTimeout(total); ac.abort();
      this.signal?.removeEventListener('abort', stop);
    }
  }
}

function classify(id, msg, title) {
  const s = String(msg);
  if (/quota|ZeroGPU|GPU duration|exceeded your/i.test(s + ' ' + (title || ''))) return new SpaceError(s.replace(/<[^>]+>/g, ''), 'quota');
  if (/No GPU|queue is full|too many|busy|try again later/i.test(s)) return new SpaceError(s, 'busy');
  return new SpaceError(`${id}: ${s.replace(/<[^>]+>/g, '').slice(0, 300)}`, 'error');
}

// every file the app returned (gr.update dicts, lists and nested values included)
export function filesIn(data) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v.path === 'string' && (v.url || v.meta?._type === 'gradio.FileData')) out.push(v);
    for (const k of Object.keys(v)) if (k !== 'meta') walk(v[k]);
  };
  walk(data);
  return out;
}
export function fileUrl(space, f) {
  if (f.url) return f.url;
  return space.api + '/file=' + f.path;
}
