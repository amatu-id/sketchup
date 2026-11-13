// Physical sky (Preetham scattering, after three.js Sky.js — MIT) with a lit, self-shadowed cloud
// layer, a thin cirrus layer, horizon haze and the ground below the horizon. Z is up.
import * as THREE from 'three';
import { sunDirection } from '../view/viewport.js';

export const SKY_PRESETS = {
  cerah: { label: 'Cerah', hour: 10.5, cover: 0.3, turbidity: 2.2, rayleigh: 2.1, mie: 0.004, mieG: 0.78, overcast: 0, cirrus: 0.35, haze: 0.25 },
  berawan: { label: 'Berawan', hour: 11.5, cover: 0.55, turbidity: 2.8, rayleigh: 1.9, mie: 0.005, mieG: 0.78, overcast: 0.06, cirrus: 0.25, haze: 0.35 },
  pagi: { label: 'Pagi', hour: 7.4, cover: 0.36, turbidity: 4.5, rayleigh: 2.2, mie: 0.005, mieG: 0.8, overcast: 0, cirrus: 0.4, haze: 0.6 },
  sore: { label: 'Sore keemasan', hour: 16.6, cover: 0.34, turbidity: 5.5, rayleigh: 2.1, mie: 0.006, mieG: 0.82, overcast: 0, cirrus: 0.45, haze: 0.65 },
  senja: { label: 'Senja', hour: 17.72, cover: 0.42, turbidity: 8, rayleigh: 3, mie: 0.008, mieG: 0.85, overcast: 0, cirrus: 0.55, haze: 0.8 },
  mendung: { label: 'Mendung', hour: 13, cover: 0.9, turbidity: 6, rayleigh: 1.2, mie: 0.01, mieG: 0.6, overcast: 0.85, cirrus: 0, haze: 0.9 },
};

const VS = `varying vec3 vDir;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vDir = wp.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w; }`;

const FS = `
uniform vec3 uSun; uniform float uTurbidity, uRayleigh, uMie, uMieG, uGain;
uniform float uCover, uDensity, uScale, uOvercast, uCirrus, uHaze, uDisk;
uniform vec2 uWind; uniform vec3 uGround;
varying vec3 vDir;
const float PI = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
float sunIntensity(float c){ c = clamp(c, -1.0, 1.0); return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(c)) / 1.5))); }
vec3 totalMie(float T){ float c = (0.2 * T) * 10E-18; return 0.434 * c * MieConst; }
float rPhase(float c){ return 0.05968310365946075 * (1.0 + c * c); }
float hg(float c, float g){ float g2 = g * g; return 0.07957747154594767 * ((1.0 - g2) / pow(max(1e-4, 1.0 - 2.0 * g * c + g2), 1.5)); }
vec3 betaR(){ return totalRayleigh * uRayleigh; }
vec3 betaM(){ return totalMie(uTurbidity) * uMie; }
vec3 extinction(vec3 dir){
  float za = acos(max(0.0, dir.z));
  float inv = 1.0 / (cos(za) + 0.15 * pow(max(1e-3, 93.885 - za * 180.0 / PI), -1.253));
  return exp(-(betaR() * 8.4E3 * inv + betaM() * 1.25E3 * inv));
}
vec3 scatter(vec3 dir, float disk){
  float sunE = sunIntensity(uSun.z);
  vec3 bR = betaR(), bM = betaM();
  vec3 Fex = extinction(dir);
  float ct = dot(dir, uSun);
  vec3 bRT = bR * rPhase(ct * 0.5 + 0.5), bMT = bM * hg(ct, uMieG);
  vec3 Lin = pow(sunE * ((bRT + bMT) / (bR + bM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ((bRT + bMT) / (bR + bM)) * Fex, vec3(0.5)), clamp(pow(1.0 - uSun.z, 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  L0 += sunE * 19000.0 * Fex * smoothstep(0.99996, 0.999985, ct) * disk;
  vec3 c = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.4));
}
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p, int oct){ float a = 0.5, s = 0.0; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 7; i++){ if (i >= oct) break; s += a * vn(p); p = m * p; a *= 0.5; } return s; }
float field(vec2 p, int oct){
  vec2 q = vec2(fbm(p * 0.55 + vec2(1.7, 9.2), 3), fbm(p * 0.55 + vec2(8.3, 2.8), 3));
  float n = fbm(p + q * 1.4, oct);
  float thr = mix(0.63, 0.29, uCover);
  float d = smoothstep(thr, thr + mix(0.13, 0.36, uOvercast), n);
  // billowy edges
  if (oct > 4) d *= 0.72 + 0.28 * vn(p * 5.3 + q * 3.0);
  return d;
}
void main(){
  vec3 dir = normalize(vDir);
  float dz = dir.z;
  vec3 d2 = normalize(vec3(dir.xy, max(dz, 0.0015)));
  vec3 sky = scatter(d2, uDisk);
  { float l = dot(sky, vec3(0.2126, 0.7152, 0.0722)); sky = max(vec3(0.0), mix(vec3(l), sky, mix(1.22, 1.0, uOvercast))) * mix(0.92, 1.0, 1.0 - dz); }
  vec3 grayed = vec3(dot(sky, vec3(0.3, 0.55, 0.15))) * vec3(0.98, 1.0, 1.04);
  sky = mix(sky, grayed * 1.12, uOvercast * 0.9);
  // horizon haze: lighter, less saturated band
  vec3 hz = scatter(normalize(vec3(dir.xy, 0.02)), 0.0);
  float hb = exp(-max(dz, 0.0) * mix(16.0, 7.0, uHaze));
  sky = mix(sky, mix(hz, vec3(dot(hz, vec3(0.33))), 0.3), hb * uHaze * 0.45);
  vec3 col = sky;
  if (dz > 0.0) {
    vec3 sunCol = extinction(uSun) * smoothstep(-0.04, 0.12, uSun.z) * 1.05 * mix(1.0, 0.55, uOvercast);
    vec3 amb = mix(scatter(vec3(0.0, 0.0, 1.0), 0.0), hz, 0.5) * mix(0.95, 1.1, uOvercast);
    float mu = dot(dir, uSun);
    // cirrus (high, thin, streaky)
    if (uCirrus > 0.0) {
      vec2 pc = dir.xy / max(dz, 0.02) * 0.22 + uWind * 0.35;
      float cs = fbm(vec2(pc.x * 2.6 + pc.y * 0.8, pc.y * 0.7) * 1.3, 5);
      float ca = smoothstep(0.52, 0.85, cs) * uCirrus * smoothstep(0.0, 0.25, dz) * 0.55;
      col = mix(col, sunCol * 1.05 + amb * 0.35, ca);
    }
    // cumulus layer
    float t = 1.0 / max(dz, 0.004);
    vec2 p = dir.xy * t * uScale + uWind;
    int oct = t > 14.0 ? 4 : t > 6.0 ? 5 : 6;
    float d = field(p, oct);
    if (d > 0.002) {
      vec2 sd = normalize(uSun.xy + vec2(1e-4)) * 0.11;
      float sh = 0.0;
      for (int i = 1; i <= 4; i++) sh += field(p + sd * float(i), 3) * (1.0 - float(i) * 0.12);
      float light = exp(-sh * 0.75 * uDensity);
      float silver = hg(mu, 0.6) * 2.4 * (1.0 - d) + hg(mu, -0.2) * 0.4;
      vec3 lit = sunCol * (1.05 * light + silver * light) + amb * (0.38 + 0.3 * (1.0 - d));
      vec3 dark = amb * mix(0.58, 0.42, uOvercast) + sunCol * 0.04;
      vec3 cc = mix(dark, lit, 0.2 + 0.8 * light);
      float fade = exp(-t * 0.038) * smoothstep(0.0, 0.05, dz);
      cc = mix(hz * 1.02, cc, fade);
      float a = clamp(d * 2.3, 0.0, 1.0) * mix(0.55, 1.0, fade) * clamp(uDensity, 0.0, 1.0);
      col = mix(col, cc, a);
    }
  } else {
    float k = smoothstep(0.0, -0.08, dz);
    col = mix(sky, uGround, k);
  }
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, -0.5, 0.8).normalize() }, uTurbidity: { value: 3 }, uRayleigh: { value: 1.5 }, uMie: { value: 0.005 }, uMieG: { value: 0.78 },
      uGain: { value: 1 }, uCover: { value: 0.35 }, uDensity: { value: 1 }, uScale: { value: 1.5 }, uOvercast: { value: 0 }, uCirrus: { value: 0.3 },
      uHaze: { value: 0.5 }, uDisk: { value: 1 }, uWind: { value: new THREE.Vector2(3.1, 7.7) }, uGround: { value: new THREE.Color(0.22, 0.24, 0.16) },
    },
  });
}

// sun direction for an hour (uses the model's geo-location + Shadows date), rotated by `turn` degrees
export function sunFor(model, hour, turn = 0) {
  const d = sunDirection(model.geo, { ...model.shadow, hour });
  if (turn) d.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(turn));
  return d;
}

// JS twin of the scattering for light colours and the fog colour
const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5], MC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
function ext(dirZ, p) {
  const za = Math.acos(Math.max(0, dirZ)), inv = 1 / (Math.cos(za) + 0.15 * Math.pow(Math.max(1e-3, 93.885 - (za * 180) / Math.PI), -1.253));
  const mie = 0.434 * (0.2 * p.turbidity) * 10e-18;
  return TR.map((r, i) => Math.exp(-(r * p.rayleigh * 8400 * inv + mie * MC[i] * p.mie * 1250 * inv)));
}
export function sunLight(p, sun) {
  // colour + strength of direct sunlight (fades out at sunset and under overcast)
  const f = ext(sun.z, p), up = THREE.MathUtils.smoothstep(sun.z, -0.02, 0.18);
  const m = Math.max(...f);
  const c = new THREE.Color(f[0] / m, f[1] / m, f[2] / m);
  c.lerp(new THREE.Color(1, 1, 1), 0.15);
  const k = up * Math.pow(f[1], 0.6) * (1 - p.overcast * 0.92);
  return { color: c, intensity: k };
}

export class SkyDome {
  constructor() {
    this.mat = skyMaterial();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -1000; this.mesh.userData.noAO = true;
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.mat.clone());
    this.envMesh.material.uniforms = THREE.UniformsUtils.clone(this.mat.uniforms);
    this.envMesh.material.uniforms.uDisk.value = 0;
    this.envMesh.scale.setScalar(100);
    this.envScene.add(this.envMesh);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 1000, this.cubeRT);
    this.envScene.add(this.cubeCam);
  }
  set(p, sun, radius) {
    const u = this.mat.uniforms;
    u.uSun.value.copy(sun);
    u.uTurbidity.value = p.turbidity; u.uRayleigh.value = p.rayleigh; u.uMie.value = p.mie; u.uMieG.value = p.mieG;
    u.uCover.value = p.cover; u.uOvercast.value = p.overcast; u.uCirrus.value = p.cirrus; u.uHaze.value = p.haze;
    u.uGain.value = p.gain ?? 1; u.uDensity.value = p.density ?? 1;
    u.uWind.value.set(3.1 + (p.seed || 0) * 17.3, 7.7 + (p.seed || 0) * 5.1);
    if (p.ground) u.uGround.value.copy(p.ground);
    const e = this.envMesh.material.uniforms;
    for (const k of Object.keys(u)) if (k !== 'uDisk') { const v = u[k].value; if (v && v.copy) e[k].value.copy(v); else e[k].value = v; }
    this.mesh.scale.setScalar(radius);
  }
  follow(camera) { this.mesh.position.copy(camera.position); this.mesh.updateMatrixWorld(); }
  // environment map for image-based light + reflections
  env(renderer, pmrem) {
    this.cubeCam.update(renderer, this.envScene);
    const old = this.envRT; this.envRT = pmrem.fromCubemap(this.cubeRT.texture); old?.dispose();
    return this.envRT.texture;
  }
  // average colour around the horizon (linear) for fog
  horizon(renderer) {
    const out = new THREE.Color(0, 0, 0), buf = new Uint16Array(4 * 4);
    let n = 0;
    for (const face of [0, 1, 2, 3]) {
      // ±X and ±Y faces look level in a Z-up world: their centre is the horizon
      try { renderer.readRenderTargetPixels(this.cubeRT, 126, 126, 2, 2, buf, face); } catch { continue; }
      for (let i = 0; i < 4; i++) { out.r += THREE.DataUtils.fromHalfFloat(buf[i * 4]); out.g += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]); out.b += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]); n++; }
    }
    if (n) out.multiplyScalar(1 / n);
    return out;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.envMesh.material.dispose(); this.cubeRT.dispose(); this.envRT?.dispose(); }
}
