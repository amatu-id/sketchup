import { App } from './app.js';
import { IO } from './io/files.js';
import { cloneDef } from './core/ops.js';

const app = new App(document.getElementById('app'));
app.io = new IO(app);
app._cloneDef = (id) => cloneDef(app.model, id);
window.amatu = app; // handy for debugging from the console
// drag & drop files onto the window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  if (app.ui.modalOpen()) return; // dialogs handle their own drops
  if (/^image\/(png|jpe?g|webp|gif|bmp|avif|heic)/i.test(f.type) || /\.(png|jpe?g|webp|avif)$/i.test(f.name)) app.ui.imageChoice(f);
  else app.io.importBlob(f);
});
// paste a photo straight into the window → same choice
document.addEventListener('paste', (e) => {
  if (app.ui.modalOpen() || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); app.ui.imageChoice(f); }
});
if (new URLSearchParams(location.search).has('image3d')) setTimeout(() => app.ui.image3d(), 300);
const q = new URLSearchParams(location.search);
if (q.has('demo')) { app.newModel('mm'); app.io.loadDemo(); }
else if (!q.has('blank')) app.ui.welcome(false);
