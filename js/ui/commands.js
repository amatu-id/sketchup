// Command registry, default keyboard shortcuts (SketchUp defaults), menus and toolbars.
import * as THREE from 'three';
import { isMac } from '../tools/base.js';

// SketchUp default shortcuts. "Ctrl" means ⌘ on macOS.
export const DEFAULT_KEYS = {
  'tool:select': 'Space', 'tool:paint': 'B', 'tool:eraser': 'E', 'tool:line': 'L', 'tool:arc2': 'A', 'tool:rect': 'R', 'tool:circle': 'C',
  'tool:pushpull': 'P', 'tool:move': 'M', 'tool:rotate': 'Q', 'tool:scale': 'S', 'tool:offset': 'F', 'tool:tape': 'T',
  'tool:orbit': 'O', 'tool:pan': 'H', 'tool:zoom': 'Z', 'zoomext': 'Shift+Z', 'makecomponent': 'G', 'style:backedges': 'K',
  'style:xray': 'Alt+R', 'flip:x': '', 'tool:flip': 'Shift+F',
  'undo': 'Ctrl+Z', 'redo': isMac ? 'Ctrl+Shift+Z|Ctrl+Y' : 'Ctrl+Y|Ctrl+Shift+Z', 'cut': 'Ctrl+X', 'copy': 'Ctrl+C', 'paste': 'Ctrl+V', 'pasteinplace': 'Ctrl+Shift+V',
  'selectall': 'Ctrl+A', 'selectnone': 'Ctrl+T', 'invertsel': 'Ctrl+Shift+I', 'delete': 'Delete',
  'new': 'Ctrl+N', 'open': 'Ctrl+O', 'save': 'Ctrl+S', 'saveas': 'Ctrl+Shift+S', 'print': 'Ctrl+P', 'drawings': 'Ctrl+Shift+D', 'import': 'Ctrl+I',
  'view:top': 'F2', 'view:front': 'F3', 'view:right': 'F4', 'view:back': 'F5', 'view:left': 'F6', 'view:bottom': 'F7', 'view:iso': 'F8',
  'prevview': 'F9', 'parallel': 'V', 'closegroup': '', 'help:keys': 'F1', 'hide': '', 'unhide:all': '',
};

export function keyLabel(k) {
  if (!k) return '';
  return k.split('|')[0].split('+').map((p) => (isMac ? { Ctrl: '⌘', Shift: '⇧', Alt: '⌥', MacCtrl: '⌃', Delete: '⌫', Space: 'Space' }[p] ?? p : p === 'Alt' ? 'Alt' : p)).join(isMac ? '' : '+');
}

export function buildCommands(app) {
  const C = {};
  const add = (id, label, run, o = {}) => { C[id] = { id, label, run, ...o }; };
  const tool = (id, label, icon) => add('tool:' + id, label, () => app.setTool(id), { icon: icon || id, checked: () => app.tool?.id === id, tool: true });
  // tools
  tool('select', 'Select'); tool('eraser', 'Eraser'); tool('paint', 'Paint Bucket');
  tool('line', 'Line'); tool('freehand', 'Freehand'); tool('arc', 'Arc', 'arc'); tool('arc2', '2 Point Arc', 'arc2'); tool('arc3', '3 Point Arc', 'arc3'); tool('pie', 'Pie');
  tool('rect', 'Rectangle'); tool('rotrect', 'Rotated Rectangle'); tool('circle', 'Circle'); tool('polygon', 'Polygon');
  tool('pushpull', 'Push/Pull'); tool('followme', 'Follow Me'); tool('offset', 'Offset'); tool('move', 'Move'); tool('rotate', 'Rotate'); tool('scale', 'Scale');
  tool('tape', 'Tape Measure'); tool('protractor', 'Protractor'); tool('dimension', 'Dimensions'); tool('text', 'Text'); tool('axes', 'Axes'); tool('section', 'Section Plane');
  tool('orbit', 'Orbit'); tool('pan', 'Pan'); tool('zoom', 'Zoom'); tool('zoomwindow', 'Zoom Window'); tool('walk', 'Walk'); tool('look', 'Look Around'); tool('poscam', 'Position Camera');
  for (const [op, label] of [['shell', 'Outer Shell'], ['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect'], ['trim', 'Trim'], ['split', 'Split']]) add('tool:solid-' + op, label, () => app.setTool('solid-' + op), { icon: op, checked: () => app.tool?.id === 'solid-' + op, tool: true });
  add('tool:flip', 'Flip Along Red', () => app.flipAlong(0), { icon: 'flip' });
  add('text3d', '3D Text', () => app.ui.dialog3DText(), { icon: 'text3d' });
  // file
  add('new', 'New', () => app.ui.confirmDiscard(() => app.ui.welcome(true)), { icon: 'new' });
  add('open', 'Open…', () => app.ui.confirmDiscard(() => app.io.open()), { icon: 'open' });
  add('save', 'Save', () => app.io.save(), { icon: 'save' });
  add('saveas', 'Save As…', () => app.io.save(true));
  add('import', 'Import…', () => app.io.importFile(), { icon: 'import' });
  add('image3d', 'Image to 3D Model (AI)…', () => app.ui.image3d(), { icon: 'image3d' });
  add('render', 'Render (lingkungan otomatis)…', () => app.ui.render(), { icon: 'render' });
  add('autopaint', 'Auto Paint…', () => app.ui.autoPaint(), { icon: 'autopaint' });
  add('export:dae', 'SketchUp-compatible COLLADA (*.dae)…', () => app.io.export3D('dae'));
  add('export:skp', 'SketchUp Model (*.dae for SketchUp)…', () => app.io.export3D('dae'));
  add('export:obj', 'OBJ File (*.obj)…', () => app.io.export3D('obj'));
  add('export:stl', 'STL File (*.stl)…', () => app.io.export3D('stl'));
  add('export:glb', 'glTF Binary (*.glb)…', () => app.io.export3D('glb'));
  add('export:dxf3d', 'AutoCAD 3D DXF (*.dxf)…', () => app.io.export3D('dxf'));
  add('export:png', 'PNG Image…', () => app.ui.dialogExportImage('png'));
  add('export:jpg', 'JPEG Image…', () => app.ui.dialogExportImage('jpg'));
  add('export:svg', 'Vector View (*.svg)…', () => app.io.exportView('svg'));
  add('export:pdfview', 'PDF of Current View…', () => app.io.exportView('pdf'));
  add('export:dxfview', 'AutoCAD 2D of Current View (*.dxf)…', () => app.io.exportView('dxf'));
  add('drawings', 'Working Drawings (PDF / DXF)…', () => app.ui.dialogDrawings(), { icon: 'drawings' });
  add('print', 'Print…', () => app.io.print(), { icon: 'print' });
  // edit
  add('undo', 'Undo', () => app.undo(), { icon: 'undo', label2: () => (app.undoStack.length ? 'Undo ' + app.undoStack[app.undoStack.length - 1].label : 'Undo'), enabled: () => app.undoStack.length > 0 || !!app.liveState });
  add('redo', 'Redo', () => app.redo(), { icon: 'redo', enabled: () => app.redoStack.length > 0 });
  add('cut', 'Cut', () => app.copySel(true), { enabled: () => app.sel.size > 0 });
  add('copy', 'Copy', () => app.copySel(), { enabled: () => app.sel.size > 0 });
  add('paste', 'Paste', () => app.paste());
  add('pasteinplace', 'Paste In Place', () => app.paste(true));
  add('delete', 'Delete', () => app.deleteSelected(), { enabled: () => app.sel.size > 0 });
  add('deleteguides', 'Delete Guides', () => app.commit('Delete Guides', () => { const { ents } = app.ctxInfo(); ents.guides.clear(); ents.touch(); }));
  add('selectall', 'Select All', () => app.selectAll());
  add('selectnone', 'Select None', () => app.clearSelection());
  add('invertsel', 'Invert Selection', () => app.invertSelection());
  add('hide', 'Hide', () => app.hideSel(), { enabled: () => app.sel.size > 0 });
  add('unhide:sel', 'Selected', () => app.unhide('selected'));
  add('unhide:last', 'Last', () => app.unhide('last'));
  add('unhide:all', 'All', () => app.unhide('all'));
  add('lock', 'Lock', () => app.setLock(true));
  add('unlock', 'Unlock', () => app.setLock(false));
  add('makecomponent', 'Make Component…', () => app.ui.dialogMakeComponent(), { icon: 'component', enabled: () => app.sel.size > 0 });
  add('makegroup', 'Make Group', () => app.makeGroupCmd(false), { icon: 'group', enabled: () => app.sel.size > 0 });
  add('closegroup', 'Close Group / Component', () => app.closeContext(), { enabled: () => app.ctxPath.length > 0 });
  add('editgroup', 'Edit Group', () => { const k = [...app.sel].find((x) => x[0] === 'i'); if (k) app.openContext(+k.slice(1)); });
  add('explode', 'Explode', () => app.explodeSel());
  add('intersect:model', 'With Model', () => app.intersect('model'));
  add('intersect:selection', 'With Selection', () => app.intersect('selection'));
  add('intersect:context', 'With Context', () => app.intersect('context'));
  add('reverse', 'Reverse Faces', () => app.reverseFaces());
  add('orient', 'Orient Faces', () => app.orientFaces());
  add('flip:x', 'Red Direction', () => app.flipAlong(0)); add('flip:y', 'Green Direction', () => app.flipAlong(1)); add('flip:z', 'Blue Direction', () => app.flipAlong(2));
  add('zoomsel', 'Zoom Selection', () => app.zoomSelection());
  add('sel:connected', 'All Connected', () => app.selectSimilar('connected'));
  add('sel:material', 'All with Same Material', () => app.selectSimilar('material'));
  add('sel:tag', 'All on Same Tag', () => app.selectSimilar('tag'));
  add('sel:instances', 'All Instances', () => app.selectSimilar('instances'));
  add('sel:bounding', 'Bounding Edges', () => app.selectSimilar('bounding'));
  add('soften:sel', 'Soften/Smooth Edges', () => app.ui.openPanel('soften'));
  // view toggles
  const st = () => app.model.style;
  const toggle = (id, label, key, icon, after) => add(id, label, () => { st()[key] = !st()[key]; after?.(); app.afterChange({ noHistory: true, dirty: true }); app.emit('style'); }, { checked: () => !!st()[key], icon });
  toggle('view:hidden', 'Hidden Geometry', 'hidden');
  toggle('view:sectionplanes', 'Section Planes', 'sectionPlanes', 'sectionplanes');
  toggle('view:sectioncuts', 'Section Cuts', 'sectionCuts', 'sectioncuts');
  toggle('view:sectionfill', 'Section Fill', 'sectionFill', 'sectionfill');
  toggle('view:axes', 'Axes', 'axes', 'axes');
  toggle('view:guides', 'Guides', 'guides');
  toggle('style:edges', 'Edges', 'edges');
  toggle('style:backedges', 'Back Edges', 'backEdges', 'backedges');
  toggle('style:profiles', 'Profiles', 'profiles');
  toggle('style:xray', 'X-ray', 'xray', 'xray');
  toggle('view:fade', 'Fade Rest of Model', 'fadeOthers');
  const mode = (m, label, icon) => add('style:' + m, label, () => { st().faceMode = m; app.afterChange({ noHistory: true, dirty: true }); app.emit('style'); }, { checked: () => st().faceMode === m, icon, radio: true });
  mode('wire', 'Wireframe', 'wire'); mode('hidden', 'Hidden Line', 'hiddenline'); mode('shaded', 'Shaded', 'shaded'); mode('textured', 'Shaded With Textures', 'textured'); mode('mono', 'Monochrome', 'mono');
  add('view:shadows', 'Shadows', () => { app.model.shadow.on = !app.model.shadow.on; app.afterChange({ noHistory: true, dirty: true }); app.emit('shadow'); }, { checked: () => app.model.shadow.on, icon: 'shadows' });
  add('view:fog', 'Fog', () => { app.model.fog.on = !app.model.fog.on; app.afterChange({ noHistory: true, dirty: true }); app.emit('style'); }, { checked: () => app.model.fog.on, icon: 'fog' });
  add('view:scenetabs', 'Scene Tabs', () => { app.settings.sceneTabs = app.settings.sceneTabs === false; app.saveSettings(); app.ui.renderSceneTabs(); }, { checked: () => app.settings.sceneTabs !== false });
  add('scene:add', 'Add Scene', () => app.ui.scenes.add(), { icon: 'plus' });
  add('scene:update', 'Update Scene', () => app.ui.scenes.update());
  add('scene:delete', 'Delete Scene', () => app.ui.scenes.remove());
  add('scene:play', 'Play Animation', () => app.ui.scenes.play());
  // camera
  for (const v of ['top', 'bottom', 'front', 'back', 'left', 'right', 'iso']) add('view:' + v, v === 'iso' ? 'Iso' : v[0].toUpperCase() + v.slice(1), () => { app.view.standardView(v); app.view.pushHistory(); }, { icon: v });
  add('prevview', 'Previous', () => app.view.prevView(), { icon: 'prevview' });
  add('nextview', 'Next', () => app.view.nextView(), { icon: 'nextview' });
  add('parallel', 'Parallel Projection', () => { app.view.cam.twoPoint = false; app.view.setOrtho(true); app.emit('camera'); }, { checked: () => app.view.cam.ortho, radio: true });
  add('perspective', 'Perspective', () => { app.view.cam.twoPoint = false; app.view.setOrtho(false); app.emit('camera'); }, { checked: () => !app.view.cam.ortho && !app.view.cam.twoPoint, radio: true });
  add('twopoint', 'Two-Point Perspective', () => { app.view.setOrtho(false); app.view.cam.twoPoint = true; app.view.applyCamera(); app.emit('camera'); }, { checked: () => app.view.cam.twoPoint, radio: true });
  add('zoomext', 'Zoom Extents', () => { app.view.zoomExtents(); setTimeout(() => app.view.pushHistory(), 400); }, { icon: 'zoomext' });
  add('fov', 'Field of View…', () => app.setTool('zoom'));
  // window
  for (const p of ['entity', 'materials', 'components', 'styles', 'tags', 'scenes', 'shadows', 'fog', 'outliner', 'soften', 'instructor']) add('panel:' + p, null, () => app.ui.togglePanel(p), { checked: () => app.ui.panelVisible(p) });
  add('modelinfo', 'Model Info', () => app.ui.dialogModelInfo(), { icon: 'modelinfo' });
  add('prefs', 'Preferences', () => app.ui.dialogPrefs(), { icon: 'prefs' });
  add('help:keys', 'Keyboard Shortcuts', () => app.ui.dialogPrefs('shortcuts'));
  add('help:about', 'About Amatu Sketch', () => app.ui.dialogAbout());
  add('help:welcome', 'Welcome Screen', () => app.ui.welcome(false));
  add('help:gestures', 'Mouse, Trackpad & Gestures', () => app.ui.dialogGestures());
  add('help:nav', 'Navigation Sensitivity…', () => app.ui.dialogPrefs('nav'));
  void THREE;
  return C;
}

export function menus(app) {
  const sep = '-';
  const panelLabel = { entity: 'Entity Info', materials: 'Materials', components: 'Components', styles: 'Styles', tags: 'Tags', scenes: 'Scenes', shadows: 'Shadows', fog: 'Fog', outliner: 'Outliner', soften: 'Soften Edges', instructor: 'Instructor' };
  return [
    { label: 'File', items: ['new', 'open', sep, 'save', 'saveas', sep, 'import', 'image3d', sep, 'render', { label: 'Export', items: [{ label: '3D Model', items: ['export:skp', 'export:dae', 'export:obj', 'export:stl', 'export:glb', 'export:dxf3d'] }, { label: '2D Graphic', items: ['export:png', 'export:jpg', 'export:svg', 'export:pdfview', 'export:dxfview'] }, sep, 'drawings'] }, 'drawings', sep, 'print'] },
    { label: 'Edit', items: ['undo', 'redo', sep, 'cut', 'copy', 'paste', 'pasteinplace', 'delete', 'deleteguides', sep, 'selectall', 'selectnone', 'invertsel', sep, 'hide', { label: 'Unhide', items: ['unhide:sel', 'unhide:last', 'unhide:all'] }, 'lock', 'unlock', sep, 'makecomponent', 'makegroup', 'closegroup', { label: 'Intersect Faces', items: ['intersect:model', 'intersect:selection', 'intersect:context'] }, sep, { label: 'Group / Component', items: ['editgroup', 'explode'] }, { label: 'Flip Along', items: ['flip:x', 'flip:y', 'flip:z'] }] },
    { label: 'View', items: [{ label: 'Toolbars', items: [{ label: 'Large Tool Set', run: () => app.ui.toggleToolbar('left'), checked: () => app.ui.toolbarVisible('left') }, { label: 'Getting Started / Principal', run: () => app.ui.toggleToolbar('main'), checked: () => app.ui.toolbarVisible('main') }, { label: 'Views', run: () => app.ui.toggleToolbar('views'), checked: () => app.ui.toolbarVisible('views') }, { label: 'Styles', run: () => app.ui.toggleToolbar('styles'), checked: () => app.ui.toolbarVisible('styles') }, { label: 'Section', run: () => app.ui.toggleToolbar('section'), checked: () => app.ui.toolbarVisible('section') }, { label: 'Solid Tools', run: () => app.ui.toggleToolbar('solid'), checked: () => app.ui.toolbarVisible('solid') }, { label: 'Camera', run: () => app.ui.toggleToolbar('camera'), checked: () => app.ui.toolbarVisible('camera') }] }, 'view:scenetabs', 'view:hidden', 'view:sectionplanes', 'view:sectioncuts', 'view:sectionfill', 'view:axes', 'view:guides', 'view:shadows', 'view:fog', sep,
      { label: 'Edge Style', items: ['style:edges', 'style:backedges', 'style:profiles'] }, { label: 'Face Style', items: ['style:xray', sep, 'style:wire', 'style:hidden', 'style:shaded', 'style:textured', 'style:mono'] }, { label: 'Component Edit', items: ['view:fade'] }, { label: 'Animation', items: ['scene:add', 'scene:update', 'scene:delete', sep, 'scene:play'] }] },
    { label: 'Camera', items: ['prevview', 'nextview', { label: 'Standard Views', items: ['view:top', 'view:bottom', 'view:front', 'view:back', 'view:left', 'view:right', 'view:iso'] }, sep, 'parallel', 'perspective', 'twopoint', sep, 'tool:orbit', 'tool:pan', 'tool:zoom', 'fov', 'tool:zoomwindow', 'zoomext', sep, 'tool:poscam', 'tool:walk', 'tool:look'] },
    { label: 'Draw', items: [{ label: 'Lines', items: ['tool:line', 'tool:freehand'] }, { label: 'Arcs', items: ['tool:arc', 'tool:arc2', 'tool:arc3', 'tool:pie'] }, { label: 'Shapes', items: ['tool:rect', 'tool:rotrect', 'tool:circle', 'tool:polygon'] }] },
    { label: 'Tools', items: ['tool:select', 'tool:eraser', 'tool:paint', 'autopaint', sep, 'tool:move', 'tool:rotate', 'tool:scale', 'tool:flip', sep, 'tool:pushpull', 'tool:followme', 'tool:offset', sep, 'tool:solid-shell', { label: 'Solid Tools', items: ['tool:solid-intersect', 'tool:solid-union', 'tool:solid-subtract', 'tool:solid-trim', 'tool:solid-split'] }, sep, 'tool:tape', 'tool:protractor', 'tool:axes', 'tool:dimension', 'tool:text', 'text3d', sep, 'tool:section'] },
    { label: 'Window', items: [{ label: 'Default Tray', items: Object.keys(panelLabel).map((p) => ({ cmd: 'panel:' + p, label: panelLabel[p] })) }, sep, 'modelinfo', 'prefs'] },
    { label: 'Help', items: ['help:welcome', 'help:keys', 'help:gestures', 'help:nav', sep, 'help:about'] },
  ];
}

export const TOOLBARS = {
  main: ['tool:select', 'makecomponent', 'tool:eraser', 'tool:paint', 'autopaint', '|', 'tool:line', 'tool:arc2', 'tool:rect', 'tool:circle', 'tool:pushpull', 'tool:offset', '|', 'tool:move', 'tool:rotate', 'tool:scale', 'tool:followme', '|', 'tool:tape', 'tool:dimension', 'tool:text', 'tool:section', '|', 'image3d', 'render', '|', 'tool:orbit', 'tool:pan', 'tool:zoom', 'zoomext', 'prevview'],
  views: ['view:iso', 'view:top', 'view:front', 'view:right', 'view:back', 'view:left'],
  styles: ['style:xray', 'style:backedges', 'style:wire', 'style:hidden', 'style:shaded', 'style:textured', 'style:mono'],
  section: ['tool:section', 'view:sectionplanes', 'view:sectioncuts', 'view:sectionfill'],
  solid: ['tool:solid-shell', 'tool:solid-intersect', 'tool:solid-union', 'tool:solid-subtract', 'tool:solid-trim', 'tool:solid-split'],
  camera: ['tool:poscam', 'tool:walk', 'tool:look', 'view:shadows', 'view:fog'],
  left: ['tool:select', 'makecomponent', 'tool:paint', 'autopaint', 'tool:eraser', 'tool:line', 'tool:freehand', 'tool:arc2', 'tool:arc', 'tool:rect', 'tool:circle', 'tool:polygon', 'tool:rotrect', 'tool:pushpull', 'tool:followme', 'tool:move', 'tool:rotate', 'tool:scale', 'tool:offset', 'tool:tape', 'tool:dimension', 'tool:protractor', 'tool:text', 'tool:axes', 'text3d', 'image3d', 'render', 'tool:orbit', 'tool:pan', 'tool:zoom', 'zoomext', 'tool:zoomwindow', 'prevview', 'tool:poscam', 'tool:look', 'tool:walk', 'tool:section'],
};
