# Amatu Sketch

SketchUp-style 3D modeling in the browser — live at **https://amatu-id.github.io/sketchup/**

- Edge/face engine: closed coplanar edges become faces, lines split faces, Push/Pull with stretch/heal and cut-through, Follow Me, Offset, Intersect Faces, Solid Tools (union/subtract/intersect/trim/split/outer shell).
- Inference engine: endpoint, midpoint, on edge, on face, center, red/green/blue axis locks (arrow keys), parallel/perpendicular, from-point tracking, Shift lock, Measurements box (type values, `x5` / `/5` arrays).
- Default SketchUp shortcuts (Space, L, R, C, A, P, M, Q, S, F, T, B, E, O, H, Z, Shift+Z, G, K…), editable in Preferences › Shortcuts.
- Navigation: middle-drag orbit, Shift+middle pan, wheel zoom to cursor, trackpad two-finger orbit / Shift pan / pinch zoom, touch gestures. Preferences › Navigation sets the sensitivity of each (mouse orbit/pan/wheel zoom, trackpad swipe/pinch, touch orbit/pan/pinch), middle-button and two-finger actions, inversion, orbit pivot and mouse-vs-trackpad detection.
- **Image to 3D (AI)** (File › Image to 3D Model, toolbar, Components panel, or drop/paste a photo): the object is cut out on the device (plain background, or the IS-Net model shared with Amatu Hapus Background), sent straight from the browser to free image-to-3D models on Hugging Face Spaces (Hunyuan3D 2.1, TRELLIS, Stable Fast 3D, TripoSG, TRELLIS.2; Auto tries them in order within the visitor's daily ZeroGPU quota), then simplified (meshoptimizer), stood upright, coloured from the texture or projected from the photo (pose found by silhouette matching), reduced to a few materials and placed as a component at the real size you enter. Generated models are cached in the browser, so re-converting the same photo costs no quota. An optional Hugging Face token (Preferences › Image to 3D) raises the quota.
- Groups & components with edit contexts, tags, materials (procedural textures), styles, scenes, shadows (sun position), fog, section planes with cuts & fills, Outliner, Entity Info.
- Export: working drawings (Gambar Kerja) to multi-sheet PDF and AutoCAD DXF with plans, elevations, sections, auto dimensions and title block; COLLADA `.dae` (opens in SketchUp via File › Import), OBJ, STL, glTF, 3D DXF, PNG/JPG, SVG.
- Import: DAE, OBJ, STL, GLB/GLTF, DXF (2D lines), images.

Native files are `.amsk` (JSON). Not affiliated with Trimble Inc.; “SketchUp” is a trademark of Trimble Inc.
