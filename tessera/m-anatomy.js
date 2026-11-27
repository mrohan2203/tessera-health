/* Tessera Health — 3D anatomy viewer (no libraries; WebGL 1).
   Renders the BodyParts3D atlas packed by build_anatomy.py: 2,234 separately addressable
   structures (bones, cartilage, ligaments and tendons, muscles, arteries, veins, heart, brain,
   nerves, organs). One draw call per structure so each can be coloured, hidden, isolated,
   exploded or picked. Rendering happens on demand only (when something changes).
   Anatomy: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0
   International. */
(function (T) {
  'use strict';
  const LAYER_COLOR = {
    bone: [0.91, 0.87, 0.78], cartilage: [0.64, 0.80, 0.90], ligament: [0.84, 0.82, 0.74], muscle: [0.71, 0.30, 0.27],
    artery: [0.86, 0.17, 0.20], vein: [0.22, 0.36, 0.78], heart: [0.80, 0.24, 0.24], cns: [0.93, 0.72, 0.70],
    nerve: [0.97, 0.83, 0.25], resp: [0.92, 0.62, 0.62], gi: [0.86, 0.57, 0.40], urinary: [0.74, 0.40, 0.32],
    endocrine: [0.62, 0.42, 0.82], sensory: [0.93, 0.93, 0.93], lymph: [0.52, 0.32, 0.58], skin: [0.92, 0.77, 0.64],
    repro: [0.80, 0.55, 0.63], other: [0.65, 0.65, 0.65]
  };
  const STATE_COLOR = { 2: [0.95, 0.20, 0.18], 1: [0.98, 0.70, 0.12], 0: [0.20, 0.78, 0.74] };
  const PRESETS = {
    organs: ['bone', 'cartilage', 'artery', 'vein', 'heart', 'cns', 'nerve', 'resp', 'gi', 'urinary', 'endocrine', 'sensory', 'lymph', 'repro'],
    skeleton: ['bone', 'cartilage', 'ligament'],
    vessels: ['artery', 'vein', 'heart', 'bone'],
    nervous: ['cns', 'nerve', 'bone'],
    muscles: ['muscle', 'ligament', 'bone', 'cartilage'],
    all: null
  };

  /* ---------- Data ---------- */
  let ATLAS = null, LOADING = null;
  function load(onProgress) {
    if (ATLAS) return Promise.resolve(ATLAS);
    if (LOADING) return LOADING;
    LOADING = fetch('anatomy/atlas.json').then((r) => { if (!r.ok) throw new Error('atlas ' + r.status); return r.json(); }).then((a) => {
      let done = 0; const total = a.chunks.reduce((s, c) => s + c.bytes, 0);
      const b64 = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); }).then((t) => { const s = atob(t.trim()); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out.buffer; });
      // Binary chunks in the app and repo; hosts that won't serve .bin get base64 text copies instead.
      const chunk = (c) => fetch('anatomy/' + c.url).then((r) => (r.ok && !/text\/html/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : b64('anatomy/' + c.url + '.b64.txt'))).catch(() => b64('anatomy/' + c.url + '.b64.txt'))
        .then((b) => { if (b.byteLength !== c.bytes) throw new Error(c.url + ' is incomplete'); return b; });
      return Promise.all(a.chunks.map((c) => chunk(c).then((b) => { done += c.bytes; onProgress && onProgress(done / total); return b; })))
        .then((bufs) => {
          a.bufs = bufs;
          a.parts.forEach((p, i) => {
            p.idx = i;
            p.ctr = [(p.b[0][0] + p.b[1][0]) / 2, (p.b[0][1] + p.b[1][1]) / 2, (p.b[0][2] + p.b[1][2]) / 2];
            p.side = /^left\b|\bleft\b/i.test(p.name) ? 'Left' : /^right\b|\bright\b/i.test(p.name) ? 'Right' : 'Midline';
            const z = p.ctr[2];
            p.region = z > 1480 ? 'Head' : z > 1400 ? 'Neck' : Math.abs(p.ctr[0]) > 190 && z > 800 ? 'Upper limb' : z > 1080 ? 'Thorax' : z > 900 ? 'Abdomen' : z > 780 ? 'Pelvis' : 'Lower limb';
          });
          const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
          a.parts.forEach((p) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.b[0][k]); hi[k] = Math.max(hi[k], p.b[1][k]); } });
          a.lo = lo; a.hi = hi; a.center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
          ATLAS = a; return a;
        });
    }).catch((e) => { LOADING = null; throw e; });
    return LOADING;
  }

  /* ---------- Math ---------- */
  const m4 = {
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
    look(e, c, u) {
      let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
      let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
    },
    mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    xf(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; }
  };

  const VS = `attribute vec3 aPos; attribute vec3 aNrm; uniform mat4 uVP; uniform vec3 uMin; uniform vec3 uScale; uniform vec3 uOff;
    varying vec3 vN; varying vec3 vW;
    void main(){ vec3 p = uMin + (aPos + 32767.0) * uScale + uOff; vW = p; vN = aNrm; gl_Position = uVP * vec4(p, 1.0); }`;
  const FS = `precision mediump float; varying vec3 vN; varying vec3 vW; uniform vec4 uCol; uniform vec3 uEye; uniform float uSel;
    void main(){ vec3 n = normalize(vN); vec3 v = normalize(uEye - vW); if (dot(n, v) < 0.0) n = -n;
      vec3 l1 = normalize(v + vec3(0.25, -0.2, 0.55)); float d = max(dot(n, l1), 0.0); float h = 0.5 + 0.5 * n.z;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
      float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 28.0) * 0.25;
      vec3 c = uCol.rgb * (0.30 + 0.20 * h + 0.62 * d) + spec + rim * (0.18 + uSel * 0.6) * vec3(0.55, 0.85, 1.0);
      gl_FragColor = vec4(c, uCol.a); }`;
  const PS = `precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor = uCol; }`;

  function prog(gl, vs, fs) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    const u = {}; ['uVP', 'uMin', 'uScale', 'uOff', 'uCol', 'uEye', 'uSel'].forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
    return { p, u, aPos: gl.getAttribLocation(p, 'aPos'), aNrm: gl.getAttribLocation(p, 'aNrm') };
  }

  /* ---------- Viewer ---------- */
  function Viewer(canvas, atlas, opts) {
    this.c = canvas; this.a = atlas; this.o = opts || {};
    const gl = this.gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false, alpha: true }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is not available on this device');
    this.main = prog(gl, VS, FS); this.pick = prog(gl, VS, PS);
    this.vbo = atlas.bufs.map((b) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, o); gl.bufferData(gl.ARRAY_BUFFER, b, gl.STATIC_DRAW); return o; });
    this.ibo = atlas.bufs.map((b) => { const o = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b, gl.STATIC_DRAW); return o; });
    this.layers = new Set(PRESETS.organs); this.hidden = new Set(); this.iso = null; this.sel = -1; this.hover = -1;
    this.explode = 0; this.xray = 0; this.state = null; this.overlay = true; this.ghost = 0.12;
    const h = atlas.hi[2] - atlas.lo[2];
    this.cam = { yaw: 0, pitch: 0.08, dist: h * 1.25, tgt: atlas.center.slice() };
    this.view('F'); this.bind(); this.resize(); this.dirty = true; this.loop();
  }
  Viewer.prototype.view = function (v) {
    const c = this.cam;
    c.yaw = { F: 0, B: Math.PI, L: Math.PI / 2, R: -Math.PI / 2 }[v] != null ? { F: 0, B: Math.PI, L: Math.PI / 2, R: -Math.PI / 2 }[v] : c.yaw;
    c.pitch = v === 'T' ? 1.35 : 0.06;
    c.tgt = this.a.center.slice(); c.dist = (this.a.hi[2] - this.a.lo[2]) * 1.22; this.dirty = true;
  };
  Viewer.prototype.focus = function (i) {
    const p = this.a.parts[i]; if (!p) return;
    const ext = Math.max(p.b[1][0] - p.b[0][0], p.b[1][1] - p.b[0][1], p.b[1][2] - p.b[0][2]);
    const off = this.offset(p); this.cam.tgt = [p.ctr[0] + off[0], p.ctr[1] + off[1], p.ctr[2] + off[2]]; this.cam.dist = Math.max(260, ext * 5); this.dirty = true;
  };
  Viewer.prototype.eye = function () {
    const c = this.cam; return [c.tgt[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.tgt[1] - c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), c.tgt[2] + c.dist * Math.sin(c.pitch)];
  };
  Viewer.prototype.vp = function () {
    const asp = this.c.width / Math.max(1, this.c.height);
    return m4.mul(m4.persp(0.62, asp, 8, 12000), m4.look(this.eye(), this.cam.tgt, [0, 0, 1]));
  };
  Viewer.prototype.visible = function (p) {
    if (this.iso) return this.iso.has(p.idx);
    return this.layers.has(p.layer) && !this.hidden.has(p.idx);
  };
  Viewer.prototype.offset = function (p) {
    if (!this.explode) return [0, 0, 0];
    const c = this.a.center, f = this.explode;
    // Spread outward from the body's midline, sideways and vertically, never towards the camera.
    const shell = { skin: 2.2, muscle: 1.5, bone: 1.1, ligament: 1.2, cartilage: 1.1 }[p.layer] || 0.8;
    return [(p.ctr[0] - c[0]) * f * 1.6 * shell, (p.ctr[1] - c[1]) * f * 0.6, (p.ctr[2] - c[2]) * f * 0.55];
  };
  Viewer.prototype.colorOf = function (p) {
    const st = this.state && this.overlay ? this.state[p.idx] : undefined;
    let col = LAYER_COLOR[p.layer] || LAYER_COLOR.other, a = 1;
    if (this.state && this.overlay) {
      if (st != null) col = STATE_COLOR[st];
      else { const g = (col[0] + col[1] + col[2]) / 3; col = [g * 0.55 + col[0] * 0.25 + 0.12, g * 0.55 + col[1] * 0.25 + 0.12, g * 0.55 + col[2] * 0.25 + 0.14]; a = Math.max(0.08, 1 - this.xray * 0.9 - (this.o.muteAlpha || 0)); }
    }
    if (this.xray && (p.layer === 'skin' || p.layer === 'muscle' || p.layer === 'bone') && st == null) a = Math.min(a, 1 - this.xray * 0.88);
    if (p.layer === 'skin' && p.idx !== this.sel) a = Math.min(a, 0.2);
    if (this.state && this.overlay && st == null && p.layer === 'muscle' && p.idx !== this.sel) a = Math.min(a, 0.42);
    if (p.idx === this.sel) { col = [Math.min(1, col[0] * 0.6 + 0.45), Math.min(1, col[1] * 0.6 + 0.6), Math.min(1, col[2] * 0.6 + 0.7)]; a = 1; }
    else if (p.idx === this.hover) col = col.map((v) => Math.min(1, v * 1.18 + 0.05));
    return [col[0], col[1], col[2], a];
  };
  Viewer.prototype.draw = function (pick) {
    const gl = this.gl, P = pick ? this.pick : this.main, a = this.a;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp()); gl.uniform3fv(P.u.uMin, a.min); gl.uniform3fv(P.u.uScale, a.scale);
    if (!pick) gl.uniform3fv(P.u.uEye, this.eye());
    gl.enableVertexAttribArray(P.aPos); if (P.aNrm >= 0) gl.enableVertexAttribArray(P.aNrm);
    const list = a.parts.filter((p) => this.visible(p));
    const opaque = [], trans = [];
    list.forEach((p) => { const c = pick ? null : this.colorOf(p); (c && c[3] < 0.99 ? trans : opaque).push([p, c]); });
    const one = ([p, c]) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo[p.c]); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo[p.c]);
      gl.vertexAttribPointer(P.aPos, 3, gl.SHORT, false, 6, p.p);
      if (P.aNrm >= 0) gl.vertexAttribPointer(P.aNrm, 3, gl.BYTE, true, 4, p.n);
      gl.uniform3fv(P.u.uOff, this.offset(p));
      if (pick) { const k = p.idx + 1; gl.uniform4f(P.u.uCol, (k & 255) / 255, ((k >> 8) & 255) / 255, ((k >> 16) & 255) / 255, 1); }
      else { gl.uniform4fv(P.u.uCol, c); gl.uniform1f(P.u.uSel, p.idx === this.sel ? 1 : 0); }
      gl.drawElements(gl.TRIANGLES, p.ic, gl.UNSIGNED_SHORT, p.i);
    };
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
    opaque.forEach(one);
    if (!pick && trans.length) {
      const e = this.eye(); trans.sort((x, y) => { const d = (q) => (q.ctr[0] - e[0]) ** 2 + (q.ctr[1] - e[1]) ** 2 + (q.ctr[2] - e[2]) ** 2; return d(y[0]) - d(x[0]); });
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      trans.forEach(one); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    if (!pick && this.sel >= 0 && this.visible(a.parts[this.sel])) { // show the selection through whatever is in front of it
      const p = a.parts[this.sel], c = this.colorOf(p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthFunc(gl.GREATER); gl.depthMask(false);
      one([p, [c[0], c[1], c[2], 0.55]]);
      gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    return list.length;
  };
  Viewer.prototype.render = function () {
    const gl = this.gl; gl.viewport(0, 0, this.c.width, this.c.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.shown = this.draw(false);
    this.o.onRender && this.o.onRender(this);
  };
  Viewer.prototype.pickAt = function (x, y) {
    const gl = this.gl, w = this.c.width, h = this.c.height;
    if (!this.fb || this.fbw !== w || this.fbh !== h) {
      this.fb = gl.createFramebuffer(); const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); this.fbw = w; this.fbh = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.draw(true);
    const px = new Uint8Array(4); gl.readPixels(Math.round(x), Math.round(h - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.dirty = true;
    const k = px[0] + (px[1] << 8) + (px[2] << 16);
    return k ? k - 1 : -1;
  };
  Viewer.prototype.project = function (pt) {
    const v = m4.xf(this.vp(), pt); const r = this.c.getBoundingClientRect();
    return { x: (v[0] * 0.5 + 0.5) * r.width, y: (0.5 - v[1] * 0.5) * r.height, z: v[2] };
  };
  Viewer.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; this.dirty = true; }
  };
  Viewer.prototype.loop = function () {
    const tick = () => {
      if (!this.c.isConnected) { this.dead = true; return; }
      this.resize();
      if (this.dirty) { this.dirty = false; this.render(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };
  Viewer.prototype.bind = function () {
    const c = this.c, pts = new Map(); let moved = 0, last = null, pinch = null, hoverT = 0;
    const dpr = () => c.width / c.getBoundingClientRect().width;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; last = [e.clientX, e.clientY]; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: this.cam.dist }; } });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) {
        const now = performance.now(); if (now - hoverT < 90 || e.pointerType !== 'mouse') return; hoverT = now;
        const r = c.getBoundingClientRect(); const k = this.pickAt((e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
        if (k !== this.hover) { this.hover = k; this.dirty = true; this.o.onHover && this.o.onHover(k, e); }
        return;
      }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); this.cam.dist = Math.max(60, Math.min(6000, pinch.dist * pinch.d / Math.max(1, d))); this.dirty = true; moved = 99; return; }
      const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY]; moved += Math.abs(dx) + Math.abs(dy);
      if (e.shiftKey || e.buttons === 2 || e.buttons === 4) {
        const s = this.cam.dist / c.getBoundingClientRect().height * 1.1, cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
        this.cam.tgt[0] -= dx * s * cy; this.cam.tgt[1] -= dx * s * sy; this.cam.tgt[2] += dy * s;
      } else { this.cam.yaw -= dx * 0.008; this.cam.pitch = Math.max(-1.45, Math.min(1.45, this.cam.pitch + dy * 0.006)); }
      this.dirty = true;
    });
    const up = (e) => {
      const was = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (was && moved < 6 && e.type === 'pointerup') { const r = c.getBoundingClientRect(); const k = this.pickAt((e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()); this.sel = k; this.dirty = true; this.o.onSelect && this.o.onSelect(k); }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.dirty = true; this.o.onHover && this.o.onHover(-1); } });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = Math.max(60, Math.min(6000, this.cam.dist * Math.exp(e.deltaY * 0.0012))); this.dirty = true; }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('keydown', (e) => {
      const k = e.key; const step = 0.12;
      if (k === 'ArrowLeft') this.cam.yaw += step; else if (k === 'ArrowRight') this.cam.yaw -= step;
      else if (k === 'ArrowUp') this.cam.pitch = Math.min(1.45, this.cam.pitch + step); else if (k === 'ArrowDown') this.cam.pitch = Math.max(-1.45, this.cam.pitch - step);
      else if (k === '+' || k === '=') this.cam.dist *= 0.85; else if (k === '-') this.cam.dist /= 0.85; else return;
      e.preventDefault(); this.dirty = true;
    });
  };

  T.anatomy = { load, Viewer, PRESETS, LAYER_COLOR, get atlas() { return ATLAS; } };
})(window.Tessera);
