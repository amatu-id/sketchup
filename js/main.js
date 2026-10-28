import { App } from './app.js';
import { IO } from './io/files.js';
import { cloneDef } from './core/ops.js';

const app = new App(document.getElementById('app'));
app.io = new IO(app);
app._cloneDef = (id) => cloneDef(app.model, id);
window.amatu = app; // handy for debugging from the console
// drag & drop files onto the window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) app.io.importBlob(f); });
const q = new URLSearchParams(location.search);
if (q.has('demo')) { app.newModel('mm'); app.io.loadDemo(); }
else if (!q.has('blank')) app.ui.welcome(false);
