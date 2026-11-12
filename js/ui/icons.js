// Inline SVG icon set (24×24) and tool cursors.
const S = '#262a31', B = '#2f7ff0', Y = '#f6c343', R = '#e5484d', G = '#2fa36b', O = '#f08c2e', W = '#ffffff', L = '#cfd8e6', P = '#8b5cf6';
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${S}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
const box = (fill = L) => `<path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="${fill}"/><path d="M4 8l8 4 8-4M12 12v9"/>`;

export const ICONS = {
  select: svg(`<path d="M6 3l12 10-5.5.8L15.5 20l-2.6 1.2-3-6.3L6 18.5z" fill="${W}"/>`),
  component: svg(`<path d="M3 9l6-3 6 3v6l-6 3-6-3z" fill="${L}"/><path d="M3 9l6 3 6-3M9 12v6"/><path d="M11 5l5-2.5L21 5v5l-3 1.5" stroke="${B}"/>`),
  group: svg(`${box('#e3ebf7')}<path d="M2 3h4M2 3v4M22 3h-4M22 3v4M2 21h4M2 21v-4M22 21h-4M22 21v-4" stroke="${B}"/>`),
  eraser: svg(`<path d="M14 4l6 6-9 9H6l-3-3z" fill="#f6a0b0"/><path d="M8.5 9.5l6 6" /><path d="M11 19h9"/>`),
  paint: svg(`<path d="M5 11l7-7 7 7-7 7z" fill="${Y}"/><path d="M12 4l-1.5-1.5M19 11c1.5 2 2 3.4 2 4.4a2 2 0 01-4 0c0-1 .5-2.4 2-4.4z" fill="${B}"/><path d="M5 11h14"/>`),
  line: svg(`<path d="M4 20l2-5L16.5 4.5a2 2 0 013 3L9 18z" fill="${Y}"/><path d="M14.5 6.5l3 3M4 20l2-5 3 3z" fill="#e8c7a0"/>`),
  freehand: svg(`<path d="M3 17c3-6 5 2 8-3s4-7 6-4 2 6 4 4" stroke="${B}" stroke-width="1.8"/><path d="M15 21l1-3 4-4 2 2-4 4z" fill="${Y}"/>`),
  arc2: svg(`<path d="M4 18A8.5 8.5 0 0120 18" stroke="${B}" stroke-width="1.8"/><circle cx="4" cy="18" r="1.8" fill="${W}"/><circle cx="20" cy="18" r="1.8" fill="${W}"/><path d="M12 18V9.5" stroke-dasharray="2 2"/>`),
  arc: svg(`<path d="M12 18L19 11" stroke-dasharray="2 2"/><path d="M5 18a7 7 0 0114-7" stroke="${B}" stroke-width="1.8"/><circle cx="12" cy="18" r="1.8" fill="${W}"/>`),
  arc3: svg(`<path d="M4 17C6 8 18 8 20 17" stroke="${B}" stroke-width="1.8"/><circle cx="4" cy="17" r="1.7" fill="${W}"/><circle cx="12" cy="10.3" r="1.7" fill="${W}"/><circle cx="20" cy="17" r="1.7" fill="${W}"/>`),
  pie: svg(`<path d="M12 13V4a9 9 0 019 9z" fill="${Y}"/><path d="M12 13H3a9 9 0 009 9 9 9 0 009-9" fill="#dbe7fb"/>`),
  rect: svg(`<rect x="3.5" y="6" width="17" height="12" fill="#dbe7fb"/><path d="M3.5 6h17v12h-17z" stroke="${B}" stroke-width="1.6"/><circle cx="3.5" cy="18" r="1.6" fill="${W}"/><circle cx="20.5" cy="6" r="1.6" fill="${W}"/>`),
  rotrect: svg(`<path d="M3 13l7-9 11 8-7 9z" fill="#dbe7fb" stroke="${B}" stroke-width="1.6"/><circle cx="3" cy="13" r="1.6" fill="${W}"/>`),
  circle: svg(`<circle cx="12" cy="12" r="8.5" fill="#dbe7fb" stroke="${B}" stroke-width="1.6"/><path d="M12 12h8.5" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="1.4" fill="${S}"/>`),
  polygon: svg(`<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" fill="#dbe7fb" stroke="${B}" stroke-width="1.6"/><circle cx="12" cy="12" r="1.4" fill="${S}"/>`),
  pushpull: svg(`<path d="M4 15l8-4 8 4-8 4z" fill="${L}"/><path d="M4 15v3l8 4 8-4v-3" /><path d="M12 15V3M9 6l3-3 3 3" stroke="${R}" stroke-width="1.8"/>`),
  followme: svg(`<path d="M3 20V9a5 5 0 015-5h12" stroke="${B}" stroke-width="3.5" stroke-linecap="butt"/><path d="M3 20V9a5 5 0 015-5h12"/><path d="M15 2l3 2-3 2" stroke="${R}"/>`),
  offset: svg(`<rect x="3" y="3" width="18" height="18" fill="#dbe7fb"/><rect x="7" y="7" width="10" height="10" stroke="${R}" stroke-width="1.6"/><path d="M3 3h18v18H3z"/>`),
  move: svg(`<path d="M12 2v20M2 12h20" stroke="${R}" stroke-width="1.6"/><path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" stroke="${R}" stroke-width="1.6"/>`),
  rotate: svg(`<path d="M19 12a7 7 0 11-2.1-5" stroke="${R}" stroke-width="1.8"/><path d="M17.5 2.5l-.6 4.6-4.6-.6" stroke="${R}" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="${S}"/>`),
  scale: svg(`<rect x="3" y="9" width="12" height="12" fill="#dbe7fb"/><path d="M3 9h12v12H3z" stroke-dasharray="2 1.5"/><rect x="3" y="3" width="18" height="18"/><rect x="18.5" y="1.5" width="4" height="4" fill="${G}" stroke="none"/><path d="M13 11l7-7" stroke="${R}" stroke-width="1.6"/>`),
  flip: svg(`<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M10 6L3 18h7z" fill="${L}"/><path d="M14 6l7 12h-7z" fill="#dbe7fb" stroke="${B}"/>`),
  tape: svg(`<circle cx="9" cy="12" r="6.5" fill="${Y}"/><circle cx="9" cy="12" r="2" fill="${W}"/><path d="M15 15h7v3h-7" fill="${Y}"/><path d="M17 15v1.5M19 15v1.5"/>`),
  protractor: svg(`<path d="M2 18a10 10 0 0120 0z" fill="${Y}"/><path d="M12 18L18 9" stroke="${R}" stroke-width="1.6"/><path d="M12 18v-2"/><circle cx="12" cy="18" r="1.4" fill="${S}"/>`),
  dimension: svg(`<path d="M4 6v12M20 6v12"/><path d="M4 12h16" stroke="${B}" stroke-width="1.6"/><path d="M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5" stroke="${B}" stroke-width="1.6"/><path d="M9 7h6" stroke-width="2"/>`),
  text: svg(`<path d="M4 5h11v8H9l-3 3v-3H4z" fill="${W}"/><path d="M7 8h5M7 10.5h3"/><path d="M14 13l6 6" stroke="${R}"/><circle cx="20" cy="19" r="1.5" fill="${R}" stroke="none"/>`),
  text3d: svg(`<path d="M4 6h10v3H10.5v11h-3V9H4z" fill="${L}"/><path d="M14 6l3-2h-10L4 6M14 6v3l3-2V4M10.5 20l3-2V9" />`),
  axes: svg(`<path d="M5 19L19 19" stroke="${R}" stroke-width="2"/><path d="M5 19L13 11" stroke="${G}" stroke-width="2"/><path d="M5 19V4" stroke="${B}" stroke-width="2"/>`),
  section: svg(`<path d="M5 4h14v16H5z" fill="#fde7cf" stroke="${O}" stroke-width="1.6"/><path d="M5 4l-3 3M19 4l3 3M5 20l-3-3M19 20l3-3" stroke="${O}" stroke-width="1.6"/>`),
  sectionplanes: svg(`<path d="M4 6l10-3v15L4 21z" fill="#fde7cf" stroke="${O}" stroke-width="1.6"/><path d="M14 10h7"/>`),
  sectioncuts: svg(`<path d="M3 17l9-5 9 5-9 5z" fill="${L}"/><path d="M3 12l9-5 9 5" stroke="${S}" stroke-width="2.4"/>`),
  sectionfill: svg(`<path d="M3 14l9-5 9 5-9 5z" fill="#3a3f47"/><path d="M3 14l9-5 9 5-9 5z" stroke="${O}"/>`),
  orbit: svg(`<ellipse cx="12" cy="12" rx="9" ry="4.5" stroke="${B}" stroke-width="1.6"/><path d="M18 6.5l2.6 2.2-3.2.9" stroke="${B}" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="${R}" stroke="none"/>`),
  pan: svg(`<path d="M8 12V6.5a1.4 1.4 0 012.8 0V11V4.5a1.4 1.4 0 012.8 0V11V5.5a1.4 1.4 0 012.8 0V12V8a1.4 1.4 0 012.8 0v6.5a6.5 6.5 0 01-6.5 6.5h-1a6 6 0 01-5-2.7L4.6 14a1.4 1.4 0 012.2-1.7z" fill="${W}"/>`),
  zoom: svg(`<circle cx="10" cy="10" r="6.5" fill="#e8f1ff"/><path d="M15 15l6 6" stroke-width="2.6"/><path d="M10 7v6M7 10h6" stroke="${B}" stroke-width="1.6"/>`),
  zoomwindow: svg(`<rect x="2.5" y="2.5" width="12" height="12" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="5" fill="#e8f1ff"/><path d="M15.5 15.5l5.5 5.5" stroke-width="2.4"/>`),
  zoomext: svg(`<circle cx="11" cy="11" r="7" fill="#e8f1ff"/><path d="M16 16l5 5" stroke-width="2.4"/><path d="M7 9V7h2M15 9V7h-2M7 13v2h2M15 13v2h-2" stroke="${R}"/>`),
  prevview: svg(`<path d="M9 7L4 12l5 5" stroke="${B}" stroke-width="1.8"/><path d="M4 12h10a6 6 0 016 6" stroke="${B}" stroke-width="1.8"/>`),
  nextview: svg(`<path d="M15 7l5 5-5 5" stroke="${B}" stroke-width="1.8"/><path d="M20 12H10a6 6 0 00-6 6" stroke="${B}" stroke-width="1.8"/>`),
  walk: svg(`<circle cx="13" cy="4" r="2" fill="${S}"/><path d="M12 7l-3 5 3 2-1 7M12 7l3 4 3 1M9 12l-3 1M12 14l4 3 1 4" stroke-width="1.8"/>`),
  look: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" fill="${W}"/><circle cx="12" cy="12" r="3.2" fill="${B}"/><circle cx="12" cy="12" r="1.2" fill="${S}" stroke="none"/>`),
  poscam: svg(`<path d="M12 21v-6" stroke-width="1.8"/><circle cx="12" cy="9" r="5" fill="${W}"/><circle cx="12" cy="9" r="2" fill="${B}"/><path d="M8 21h8"/>`),
  iso: svg(`${box()}`),
  top: svg(`<path d="M4 8l8-4 8 4-8 4z" fill="${B}" opacity=".8"/><path d="M4 8v9l8 4 8-4V8M12 12v9"/>`),
  front: svg(`<path d="M4 8l8 4v9l-8-4z" fill="${B}" opacity=".8"/><path d="M4 8l8-4 8 4v9l-8 4M12 12l8-4"/>`),
  right: svg(`<path d="M12 12l8-4v9l-8 4z" fill="${B}" opacity=".8"/><path d="M4 8l8-4 8 4M4 8v9l8 4M4 8l8 4"/>`),
  back: svg(`<path d="M12 4l8 4v9l-8-4z" fill="${B}" opacity=".55"/><path d="M4 8l8-4M4 8v9l8 4 8-4M4 8l8 4 8-4M12 12v9"/>`),
  left: svg(`<path d="M4 8l8-4v9l-8 4z" fill="${B}" opacity=".55"/><path d="M12 4l8 4v9l-8 4-8-4M4 8l8 4 8-4M12 12v9"/>`),
  bottom: svg(`<path d="M4 17l8-4 8 4-8 4z" fill="${B}" opacity=".55"/><path d="M4 8l8-4 8 4v9M4 8v9M4 8l8 4 8-4M12 12v1"/>`),
  xray: svg(`<path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="${B}" opacity=".25"/><path d="M4 8l8 4 8-4M12 12v9M4 17l8-4 8 4M12 4v9" stroke-dasharray="1.5 1.5"/><path d="M4 8l8-4 8 4v9l-8 4-8-4z"/>`),
  backedges: svg(`<path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="${L}"/><path d="M4 8l8 4 8-4M12 12v9"/><path d="M4 17l8-4 8 4M12 4v9" stroke-dasharray="2 2" stroke="#808792"/>`),
  wire: svg(`<path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9M4 17l8-4 8 4M12 4v9"/>`),
  hiddenline: svg(`<path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="${W}"/><path d="M4 8l8 4 8-4M12 12v9"/>`),
  shaded: svg(`<path d="M4 8l8-4 8 4-8 4z" fill="#e9edf3"/><path d="M4 8l8 4v9l-8-4z" fill="#b8c3d3"/><path d="M12 12l8-4v9l-8 4z" fill="#8f9db2"/>`),
  textured: svg(`<path d="M4 8l8-4 8 4-8 4z" fill="#d9a066"/><path d="M4 8l8 4v9l-8-4z" fill="#b5784a"/><path d="M12 12l8-4v9l-8 4z" fill="#9b5f37"/><path d="M6 11l4 2M6 14l4 2M14 13l4-2M14 16l4-2" stroke="#6b4426" stroke-width="1"/>`),
  mono: svg(`<path d="M4 8l8-4 8 4-8 4z" fill="${W}"/><path d="M4 8l8 4v9l-8-4z" fill="#e2e2e2"/><path d="M12 12l8-4v9l-8 4z" fill="#a8b4c4"/>`),
  shell: svg(`<path d="M3 10l6-3 6 3v7l-6 3-6-3z" fill="${L}"/><path d="M9 7l6-3 6 3v7l-6 3" fill="#dbe7fb" stroke="${B}"/>`),
  union: svg(`<rect x="3" y="7" width="11" height="11" fill="#dbe7fb" stroke="${B}"/><rect x="10" y="3" width="11" height="11" fill="#dbe7fb" stroke="${B}"/><path d="M10 7h4v7h-4" fill="#dbe7fb" stroke="none"/>`),
  subtract: svg(`<rect x="3" y="7" width="11" height="11" stroke-dasharray="2 2"/><path d="M10 3h11v11h-7V7h-4z" fill="#dbe7fb" stroke="${B}"/>`),
  intersect: svg(`<rect x="3" y="7" width="11" height="11" stroke-dasharray="2 2"/><rect x="10" y="3" width="11" height="11" stroke-dasharray="2 2"/><rect x="10" y="7" width="4" height="7" fill="${B}" stroke="${B}"/>`),
  trim: svg(`<rect x="3" y="7" width="11" height="11" fill="${L}"/><path d="M10 3h11v11h-7V7h-4z" fill="#dbe7fb" stroke="${B}"/>`),
  split: svg(`<path d="M3 7h7v11H3z" fill="#dbe7fb" stroke="${B}"/><path d="M11 7h3v7h-3z" fill="${Y}"/><path d="M15 3h6v11h-6z" fill="#dbe7fb" stroke="${B}"/>`),
  shadows: svg(`<circle cx="17" cy="6" r="3.2" fill="${Y}"/><path d="M3 12l5-2.5 5 2.5v5l-5 2.5-5-2.5z" fill="${L}"/><path d="M13 17l7 3-5 1.5L8 19.5" fill="#7d8592" stroke="none" opacity=".6"/>`),
  fog: svg(`<path d="M3 8h14M6 12h15M3 16h13M7 20h10" stroke="#8a95a5" stroke-width="1.8"/>`),
  undo: svg(`<path d="M9 5L4 10l5 5" stroke-width="1.8"/><path d="M4 10h10a6 6 0 010 12h-2" stroke-width="1.8"/>`),
  redo: svg(`<path d="M15 5l5 5-5 5" stroke-width="1.8"/><path d="M20 10H10a6 6 0 000 12h2" stroke-width="1.8"/>`),
  new: svg(`<path d="M6 2h8l5 5v15H6z" fill="${W}"/><path d="M14 2v5h5"/>`),
  open: svg(`<path d="M3 6h6l2 2h10v11H3z" fill="${Y}"/><path d="M3 19l3-8h17l-3 8" fill="#fbd97a"/>`),
  save: svg(`<path d="M4 3h13l3 3v15H4z" fill="${B}"/><path d="M7 3h9v6H7z" fill="${W}"/><rect x="7" y="13" width="10" height="8" fill="${W}"/>`),
  print: svg(`<path d="M6 3h12v5H6z" fill="${W}"/><rect x="3" y="8" width="18" height="9" rx="1.5" fill="${L}"/><path d="M6 14h12v7H6z" fill="${W}"/>`),
  export: svg(`<path d="M5 3h9l5 5v13H5z" fill="${W}"/><path d="M12 10v8M9 15l3 3 3-3" stroke="${G}" stroke-width="1.8"/>`),
  image3d: svg(`<rect x="2.5" y="3" width="11" height="9.5" rx="1.2" fill="${W}"/><path d="M3.6 11.3l3.1-3.4 2.3 2.3 1.6-1.5 2.4 2.6" stroke="${G}"/><circle cx="10" cy="6" r="1.1" fill="${Y}" stroke="none"/><path d="M11.5 14.5l5.2-2.6 5.2 2.6v5.6l-5.2 2.6-5.2-2.6z" fill="#dbe7fb"/><path d="M11.5 14.5l5.2 2.6 5.2-2.6M16.7 17.1v5.6"/><path d="M15.5 3.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z" fill="${P}" stroke="${P}" stroke-width=".8"/><path d="M19.6 6.6l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="${P}" stroke="${P}" stroke-width=".6"/>`),
  import: svg(`<path d="M5 3h9l5 5v13H5z" fill="${W}"/><path d="M12 18v-8M9 13l3-3 3 3" stroke="${B}" stroke-width="1.8"/>`),
  drawings: svg(`<rect x="2.5" y="4" width="19" height="16" fill="${W}"/><path d="M2.5 16h19M15 16v4M5 7h7v6H5z"/><path d="M14 7h5v6h-5" stroke="${B}"/>`),
  info: svg(`<circle cx="12" cy="12" r="9" fill="#e8f1ff"/><path d="M12 11v6M12 7.5v.5" stroke-width="2"/>`),
  materials: svg(`<circle cx="9" cy="9" r="5" fill="${R}"/><circle cx="15" cy="9" r="5" fill="${Y}" opacity=".9"/><circle cx="12" cy="14" r="5" fill="${B}" opacity=".85"/>`),
  components: svg(`<path d="M3 9l6-3 6 3v6l-6 3-6-3z" fill="${L}"/><path d="M3 9l6 3 6-3M9 12v6"/><path d="M11 5l5-2.5L21 5v5l-3 1.5" stroke="${B}"/>`),
  styles: svg(`<rect x="3" y="3" width="18" height="18" rx="2" fill="#e8f1ff"/><path d="M6 17l5-9 3 5 2-3 3 7z" fill="${B}"/>`),
  tags: svg(`<path d="M3 12V4h8l10 10-8 8z" fill="${Y}"/><circle cx="7.5" cy="8" r="1.6" fill="${W}"/>`),
  scenes: svg(`<rect x="2.5" y="5" width="19" height="14" rx="1.5" fill="#e8f1ff"/><path d="M2.5 9h19M7 5v4M12 5v4"/>`),
  outliner: svg(`<path d="M4 5h4M8 10h4M8 15h4M4 5v10h4M12 10h8M12 15h8M8 5h12"/>`),
  soften: svg(`<path d="M3 18c5 0 5-12 9-12s4 12 9 12" stroke="${B}" stroke-width="1.8"/>`),
  instructor: svg(`<circle cx="12" cy="12" r="9" fill="${Y}"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.8-2.5 2-2.5 4M12 16.5v.5" stroke-width="1.8"/>`),
  modelinfo: svg(`<rect x="4" y="3" width="16" height="18" rx="1.5" fill="${W}"/><path d="M8 8h8M8 12h8M8 16h5"/>`),
  prefs: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke-width="1.8"/>`),
  hide: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><path d="M4 20L20 4" stroke="${R}" stroke-width="1.8"/>`),
  trash: svg(`<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14" stroke-width="1.8"/>`),
  minus: svg(`<path d="M5 12h14" stroke-width="1.8"/>`),
  eye: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  eyeoff: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" opacity=".35"/><path d="M4 20L20 4"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18" stroke-width="1.8"/>`),
  chevron: svg(`<path d="M8 10l4 4 4-4" stroke-width="1.8"/>`),
  search: svg(`<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4" stroke-width="1.8"/>`),
  geo: svg(`<path d="M12 21s7-6.5 7-11.5a7 7 0 00-14 0C5 14.5 12 21 12 21z" fill="${R}"/><circle cx="12" cy="9.5" r="2.5" fill="${W}"/>`),
  user: svg(`<circle cx="12" cy="8" r="4" fill="${L}"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="${L}"/>`),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.8-2.5 2-2.5 4M12 16.5v.5" stroke-width="1.8"/>`),
  layout: svg(`<rect x="3" y="3" width="18" height="18" fill="${W}"/><path d="M3 16h18M14 16v5"/><path d="M6 6h6v7H6z" fill="#dbe7fb"/>`),
  pdf: svg(`<path d="M5 2h10l4 4v16H5z" fill="${W}"/><rect x="3" y="11" width="13" height="7" rx="1" fill="${R}" stroke="none"/><text x="4.4" y="16.6" font-size="5.2" font-family="Arial" font-weight="700" fill="#fff" stroke="none">PDF</text>`),
  dxf: svg(`<path d="M5 2h10l4 4v16H5z" fill="${W}"/><rect x="3" y="11" width="13" height="7" rx="1" fill="${B}" stroke="none"/><text x="4.1" y="16.6" font-size="5.2" font-family="Arial" font-weight="700" fill="#fff" stroke="none">DXF</text>`),
};

export function icon(name) { return ICONS[name] || ICONS.select; }

// cursors: tool icon at 22px with a white halo; hotspot per tool
const HOT = { select: [6, 3], line: [4, 21], freehand: [16, 21], eraser: [6, 18], paint: [21, 14], tape: [22, 16], pan: [12, 12], text: [20, 19] };
const cursorCache = new Map();
export function cursorCSS(name) {
  if (!name) return 'default';
  if (cursorCache.has(name)) return cursorCache.get(name);
  const plus = name.endsWith('-plus'), minus = name.endsWith('-minus');
  const base = name.replace(/-(plus|minus)$/, '');
  const map = { pencil: 'line', select: 'select' };
  const key = map[base] || base;
  if (key === 'select') { cursorCache.set(name, 'default'); return 'default'; }
  const ic = ICONS[key];
  if (!ic) { cursorCache.set(name, 'crosshair'); return 'crosshair'; }
  const inner = ic.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const extra = plus ? `<g transform="translate(18 18)"><circle r="5" fill="#fff" stroke="#262a31"/><path d="M-3 0h6M0-3v6" stroke="#262a31" stroke-width="1.6"/></g>` : minus ? `<g transform="translate(18 18)"><circle r="5" fill="#fff" stroke="#262a31"/><path d="M-3 0h6" stroke="#262a31" stroke-width="1.6"/></g>` : '';
  const halo = `<g transform="translate(5 5) scale(0.92)" stroke="#fff" stroke-width="3.6" opacity=".9" fill="none">${inner.replace(/fill="[^"]*"/g, 'fill="none"').replace(/stroke="[^"]*"/g, '')}</g>`;
  const body = `<g transform="translate(5 5) scale(0.92)" fill="none" stroke="#262a31" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;
  const cross = key === 'line' || key === 'freehand' || key === 'eraser' || key === 'paint' || key === 'tape' || key === 'pan' ? '' : `<path d="M0 4h8M4 0v8" stroke="#fff" stroke-width="3"/><path d="M0 4h8M4 0v8" stroke="#111" stroke-width="1.2"/>`;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${cross}${halo}${body}${extra}</svg>`;
  const hs = HOT[key] ? [Math.round(HOT[key][0] * 0.92 + 5), Math.round(HOT[key][1] * 0.92 + 5)] : [4, 4];
  const css = `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}") ${hs[0]} ${hs[1]}, crosshair`;
  cursorCache.set(name, css);
  return css;
}
