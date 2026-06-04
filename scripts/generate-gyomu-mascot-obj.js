const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "assets", "3d");
fs.mkdirSync(outDir, { recursive: true });

const obj = [];
let vertices = [];
let uvs = [];
let normals = [];

const materials = {
  stone: "stone_gray",
  stoneDark: "stone_groove",
  black: "soft_black",
  decal: "front_decal",
};

function v(x, y, z) {
  vertices.push([x, y, z]);
  return vertices.length;
}

function vt(u, vv) {
  uvs.push([u, vv]);
  return uvs.length;
}

function vn(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  normals.push([x / len, y / len, z / len]);
  return normals.length;
}

function use(name) {
  obj.push(`usemtl ${name}`);
}

function face(items) {
  obj.push(`f ${items.map((i) => `${i.v}/${i.vt || ""}/${i.vn || ""}`).join(" ")}`);
}

function addRevolvedRing(name, material) {
  obj.push(`o ${name}`);
  use(material);
  const seg = 144;
  const outer = 1.68;
  const inner = 0.68;
  const halfDepth = 0.34;
  const bevel = 0.16;
  const profile = [
    [outer - bevel, -halfDepth],
    [outer, -halfDepth + bevel],
    [outer, halfDepth - bevel],
    [outer - bevel, halfDepth],
    [inner + bevel, halfDepth],
    [inner, halfDepth - bevel],
    [inner, -halfDepth + bevel],
    [inner + bevel, -halfDepth],
  ];
  const ids = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ids[i] = [];
    for (let j = 0; j < profile.length; j++) {
      const [r, z] = profile[j];
      ids[i][j] = {
        v: v(r * ca, r * sa, z),
        vt: vt(i / seg, j / profile.length),
        vn: vn(ca, sa, 0.2 * Math.sign(z)),
      };
    }
  }
  for (let i = 0; i < seg; i++) {
    const ni = (i + 1) % seg;
    for (let j = 0; j < profile.length; j++) {
      const nj = (j + 1) % profile.length;
      face([ids[i][j], ids[ni][j], ids[ni][nj], ids[i][nj]]);
    }
  }
}

function addUvSphere(name, material, cx, cy, cz, sx, sy, sz, rows = 18, cols = 28) {
  obj.push(`o ${name}`);
  use(material);
  const ids = [];
  for (let r = 0; r <= rows; r++) {
    const phi = (r / rows) * Math.PI;
    ids[r] = [];
    for (let c = 0; c <= cols; c++) {
      const theta = (c / cols) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      ids[r][c] = {
        v: v(cx + x * sx, cy + y * sy, cz + z * sz),
        vt: vt(c / cols, r / rows),
        vn: vn(x / sx, y / sy, z / sz),
      };
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      face([ids[r][c], ids[r + 1][c], ids[r + 1][c + 1], ids[r][c + 1]]);
    }
  }
}

function addTube(name, material, points, radius, sides = 12) {
  obj.push(`o ${name}`);
  use(material);
  const rings = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const tz = next[2] - prev[2];
    const tLen = Math.hypot(tx, ty, tz) || 1;
    const t = [tx / tLen, ty / tLen, tz / tLen];
    const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const nx = up[1] * t[2] - up[2] * t[1];
    const ny = up[2] * t[0] - up[0] * t[2];
    const nz = up[0] * t[1] - up[1] * t[0];
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / nLen, ny / nLen, nz / nLen];
    const b = [
      t[1] * n[2] - t[2] * n[1],
      t[2] * n[0] - t[0] * n[2],
      t[0] * n[1] - t[1] * n[0],
    ];
    rings[i] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ox = Math.cos(a) * n[0] * radius + Math.sin(a) * b[0] * radius;
      const oy = Math.cos(a) * n[1] * radius + Math.sin(a) * b[1] * radius;
      const oz = Math.cos(a) * n[2] * radius + Math.sin(a) * b[2] * radius;
      rings[i][s] = {
        v: v(p[0] + ox, p[1] + oy, p[2] + oz),
        vt: vt(s / sides, i / Math.max(1, points.length - 1)),
        vn: vn(ox, oy, oz),
      };
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      face([rings[i][s], rings[i + 1][s], rings[i + 1][(s + 1) % sides], rings[i][(s + 1) % sides]]);
    }
  }
}

function addQuad(name, material, cx, cy, cz, w, h) {
  obj.push(`o ${name}`);
  use(material);
  const n = vn(0, 0, 1);
  const a = { v: v(cx - w / 2, cy - h / 2, cz), vt: vt(0, 0), vn: n };
  const b = { v: v(cx + w / 2, cy - h / 2, cz), vt: vt(1, 0), vn: n };
  const c = { v: v(cx + w / 2, cy + h / 2, cz), vt: vt(1, 1), vn: n };
  const d = { v: v(cx - w / 2, cy + h / 2, cz), vt: vt(0, 1), vn: n };
  face([a, b, c, d]);
}

function addWoodGrooves() {
  const lines = 34;
  for (let i = 0; i < lines; i++) {
    const y = -1.18 + i * 0.073;
    const maxX = Math.sqrt(Math.max(0, 1.52 * 1.52 - y * y));
    const holeX = Math.sqrt(Math.max(0, 0.77 * 0.77 - y * y));
    const parts = [];
    if (Math.abs(y) > 0.72) {
      parts.push([-maxX + 0.1, maxX - 0.1]);
    } else {
      parts.push([-maxX + 0.1, -holeX - 0.09], [holeX + 0.09, maxX - 0.1]);
    }
    for (const [x1, x2] of parts) {
      const points = [];
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x1 + (x2 - x1) * t;
        points.push([x, y + Math.sin(t * Math.PI * 4 + i) * 0.01, 0.365]);
      }
      addTube(`grain_${i}`, materials.stoneDark, points, 0.006, 6);
    }
  }
}

function addPores() {
  const dots = [
    [-1.05, 1.05], [-0.62, 1.34], [-0.16, 1.48], [0.4, 1.24], [0.96, 1.0],
    [-1.2, 0.46], [-0.95, -0.1], [-1.25, -0.58], [-0.55, -1.16], [0.12, -1.28],
    [0.78, -0.98], [1.14, -0.34], [1.1, 0.45], [0.34, -1.1], [-0.12, 0.92],
  ];
  for (let i = 0; i < dots.length; i++) {
    const [x, y] = dots[i];
    addUvSphere(`pore_${i}`, materials.stoneDark, x, y, 0.374, 0.018, 0.018, 0.004, 8, 10);
  }
}

function addMascotParts() {
  addUvSphere("left_eye", materials.black, -0.52, 0.95, 0.43, 0.13, 0.20, 0.055);
  addUvSphere("right_eye", materials.black, 0.52, 0.95, 0.43, 0.13, 0.20, 0.055);

  const smile = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const a = Math.PI * (1.07 + 0.86 * t);
    smile.push([Math.cos(a) * 0.44, 0.78 + Math.sin(a) * 0.28, 0.43]);
  }
  addTube("smile", materials.black, smile, 0.042, 14);

  addTube("left_arm", materials.stone, [[-1.45, -0.18, 0.02], [-1.78, -0.25, 0.08], [-1.98, -0.36, 0.14]], 0.12, 16);
  addTube("right_arm", materials.stone, [[1.45, -0.18, 0.02], [1.78, -0.25, 0.08], [1.98, -0.36, 0.14]], 0.12, 16);
  for (const side of [-1, 1]) {
    addUvSphere(`${side < 0 ? "left" : "right"}_palm`, materials.stone, side * 2.08, -0.39, 0.18, 0.18, 0.16, 0.14, 14, 18);
    addUvSphere(`${side < 0 ? "left" : "right"}_finger_top`, materials.stone, side * 2.0, -0.21, 0.2, 0.11, 0.17, 0.1, 12, 16);
    addUvSphere(`${side < 0 ? "left" : "right"}_finger_mid`, materials.stone, side * 1.9, -0.39, 0.23, 0.11, 0.17, 0.1, 12, 16);
    addUvSphere(`${side < 0 ? "left" : "right"}_finger_low`, materials.stone, side * 2.0, -0.55, 0.19, 0.11, 0.15, 0.1, 12, 16);
  }

  addTube("left_leg", materials.stone, [[-0.45, -1.46, -0.05], [-0.5, -1.72, -0.02]], 0.13, 16);
  addTube("right_leg", materials.stone, [[0.45, -1.46, -0.05], [0.5, -1.72, -0.02]], 0.13, 16);
  addUvSphere("left_foot", materials.stone, -0.55, -1.85, 0.13, 0.42, 0.18, 0.23, 16, 24);
  addUvSphere("right_foot", materials.stone, 0.55, -1.85, 0.13, 0.42, 0.18, 0.23, 16, 24);
}

obj.push("# Gyomu App Kobo mascot generated from reference image");
obj.push("mtllib gyomu-mascot.mtl");
addRevolvedRing("donut_body", materials.stone);
addWoodGrooves();
addPores();
addMascotParts();
addQuad("japanese_logo_decal", materials.decal, 0, -1.08, 0.452, 1.58, 0.34);

const objText = [
  ...obj,
  ...vertices.map((p) => `v ${p.map((n) => n.toFixed(6)).join(" ")}`),
  ...uvs.map((p) => `vt ${p.map((n) => n.toFixed(6)).join(" ")}`),
  ...normals.map((p) => `vn ${p.map((n) => n.toFixed(6)).join(" ")}`),
].join("\n").replace(/^(o |usemtl |f )/gm, "\n$1");

const ordered = objText.split("\n");
const header = ordered.filter((line) => line.startsWith("#") || line.startsWith("mtllib") || line.startsWith("v ") || line.startsWith("vt ") || line.startsWith("vn "));
const body = ordered.filter((line) => !(line.startsWith("#") || line.startsWith("mtllib") || line.startsWith("v ") || line.startsWith("vt ") || line.startsWith("vn ")));
fs.writeFileSync(path.join(outDir, "gyomu-mascot.obj"), [...header, ...body].join("\n"));

fs.writeFileSync(path.join(outDir, "gyomu-mascot.mtl"), `newmtl stone_gray
Ka 0.55 0.55 0.52
Kd 0.56 0.56 0.52
Ks 0.18 0.18 0.16
Ns 32

newmtl stone_groove
Ka 0.32 0.32 0.30
Kd 0.34 0.34 0.31
Ks 0.04 0.04 0.04
Ns 10

newmtl soft_black
Ka 0.01 0.01 0.01
Kd 0.005 0.005 0.005
Ks 0.25 0.25 0.25
Ns 80

newmtl front_decal
Ka 1 1 1
Kd 1 1 1
d 1
map_Kd gyomu-text.svg
map_d gyomu-text-alpha.svg
`);

fs.writeFileSync(path.join(outDir, "gyomu-text.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="220" viewBox="0 0 1024 220">
  <rect width="1024" height="220" fill="#ffffff"/>
  <text x="512" y="143" text-anchor="middle"
    font-family="Yu Gothic, Meiryo, Noto Sans CJK JP, sans-serif"
    font-size="136" font-weight="900" fill="#111111">業務アプリ工房</text>
</svg>
`);

fs.writeFileSync(path.join(outDir, "gyomu-text-alpha.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="220" viewBox="0 0 1024 220">
  <rect width="1024" height="220" fill="#000000"/>
  <text x="512" y="143" text-anchor="middle"
    font-family="Yu Gothic, Meiryo, Noto Sans CJK JP, sans-serif"
    font-size="136" font-weight="900" fill="#ffffff">業務アプリ工房</text>
</svg>
`);

fs.writeFileSync(path.join(outDir, "viewer.html"), `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<title>業務アプリ工房 3D Mascot Preview</title>
<style>
  html, body { margin: 0; height: 100%; background: #e9e8e3; overflow: hidden; }
  #label { position: fixed; left: 16px; top: 14px; font: 14px/1.4 system-ui, sans-serif; color: #202020; }
</style>
<div id="label">drag: rotate / wheel: zoom</div>
<script type="importmap">
{"imports":{"three":"https://unpkg.com/three@0.164.1/build/three.module.js","three/addons/":"https://unpkg.com/three@0.164.1/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e8e3);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, -5.2, 2.4);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(3, -4, 5);
scene.add(key);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.3, 0.12);
controls.enableDamping = true;

new MTLLoader().setPath("./").load("gyomu-mascot.mtl", (materials) => {
  materials.preload();
  new OBJLoader().setMaterials(materials).setPath("./").load("gyomu-mascot.obj", (model) => {
    model.rotation.x = Math.PI / 2;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
  });
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
</script>
</html>
`);

console.log(`Generated OBJ mascot in ${outDir}`);
