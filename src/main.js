import * as THREE from 'three';
import * as ZapparThree from '@zappar/zappar-threejs';

if (ZapparThree.browserIncompatible()) {
  ZapparThree.browserIncompatibleUI();
  throw new Error('Unsupported browser');
}

// ── Renderer ──────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

ZapparThree.glContextSet(renderer.getContext());

// ── Scene / Camera ────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new ZapparThree.Camera();
scene.background = camera.backgroundTexture;

scene.add(new THREE.AmbientLight(0xffffff, 1.5));

ZapparThree.permissionRequestUI().then((granted) => {
  if (granted) camera.start();
  else ZapparThree.permissionDeniedUI();
});

// ── Image tracker ─────────────────────────────────────────
const imageTracker = new ZapparThree.ImageTrackerLoader().load('target.zpt');
const trackerGroup = new ZapparThree.ImageAnchorGroup(camera, imageTracker);
scene.add(trackerGroup);

imageTracker.onVisible.bind(()    => document.getElementById('hint').style.opacity = '0');
imageTracker.onNotVisible.bind(() => document.getElementById('hint').style.opacity = '1');

// ── Road waypoints ────────────────────────────────────────
// Coordinate system: image centre = (0,0,0)
//   x  left(-) → right(+)   maps to image horizontal axis
//   z  top(-)  → bottom(+)  maps to image vertical axis
//   y  height above image plane
//
// Image is ~4:3 landscape → x ∈ [-0.5, 0.5], z ∈ [-0.375, 0.375]
// Waypoints are traced along the grey road pixels.

function circle(cx, cz, r, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
}

const PATHS = [
  // Car 1 – roundabout ring
  circle(-0.220, -0.068, 0.100, 20),

  // Car 2 – outer perimeter (clockwise)
  [
    [-0.450, -0.315],
    [-0.220, -0.315],
    [ 0.000, -0.315],
    [ 0.150, -0.315],
    [ 0.150, -0.225],
    [ 0.150, -0.075],
    [ 0.150,  0.038],
    [ 0.150,  0.150],
    [ 0.150,  0.265],
    [-0.050,  0.278],
    [-0.220,  0.278],
    [-0.380,  0.263],
    [-0.440,  0.172],
    [-0.440,  0.038],
    [-0.440, -0.090],
    [-0.440, -0.225],
  ],

  // Car 3 – inner route (roundabout right exit → right road → bottom → left → arc back)
  [
    [-0.120, -0.068],
    [ 0.000, -0.075],
    [ 0.150, -0.075],
    [ 0.150,  0.038],
    [ 0.150,  0.150],
    [ 0.150,  0.265],
    [-0.050,  0.278],
    [-0.220,  0.278],
    [-0.380,  0.188],
    [-0.380,  0.038],
    [-0.380, -0.075],
    [-0.320, -0.068],
    [-0.280,  0.030],
    [-0.220,  0.042],
    [-0.165,  0.030],
  ],

  // Car 4 – top sprint + inner return
  [
    [-0.450, -0.315],
    [-0.220, -0.315],
    [ 0.000, -0.315],
    [ 0.150, -0.315],
    [ 0.150, -0.225],
    [ 0.150, -0.075],
    [ 0.000, -0.075],
    [-0.120, -0.075],
    [-0.200, -0.168],
    [-0.220, -0.175],
    [-0.240, -0.168],
    [-0.320, -0.075],
    [-0.380, -0.075],
    [-0.440, -0.090],
    [-0.440, -0.225],
  ],
];

// ── Cars (red flat discs) ─────────────────────────────────
const SPEEDS   = [0.0028, 0.0022, 0.0025, 0.0030];
const OFFSETS  = [0.00,   0.25,   0.50,   0.75];   // stagger start positions

const carMat = new THREE.MeshStandardMaterial({
  color: 0xff2200,
  emissive: 0xff2200,
  emissiveIntensity: 0.6,
  roughness: 0.4,
});

const cars = PATHS.map((path, i) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, 0.010, 16),
    carMat,
  );

  const group = new THREE.Group();
  group.add(mesh);
  trackerGroup.add(group);

  const startSeg = Math.floor(OFFSETS[i] * path.length) % path.length;

  return { group, path, seg: startSeg, t: 0, speed: SPEEDS[i] };
});

// ── Animation ─────────────────────────────────────────────
function updateCars() {
  for (const car of cars) {
    car.t += car.speed;
    if (car.t >= 1) {
      car.t -= 1;
      car.seg = (car.seg + 1) % car.path.length;
    }

    const from = car.path[car.seg];
    const to   = car.path[(car.seg + 1) % car.path.length];
    const x = from[0] + (to[0] - from[0]) * car.t;
    const z = from[1] + (to[1] - from[1]) * car.t;

    car.group.position.set(x, 0.008, z);

    // face direction of travel
    const dx = to[0] - from[0], dz = to[1] - from[1];
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      car.group.rotation.y = Math.atan2(dx, dz);
    }
  }
}

window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

(function animate() {
  requestAnimationFrame(animate);
  camera.updateFrame(renderer);
  if (trackerGroup.visible) updateCars();
  renderer.render(scene, camera);
})();
