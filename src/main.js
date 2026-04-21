import * as THREE from 'three';
import * as ZapparThree from '@zappar/zappar-threejs';

// ─────────────────────────────────────────────────────────
// Browser compatibility check
// ─────────────────────────────────────────────────────────
if (ZapparThree.browserIncompatible()) {
  ZapparThree.browserIncompatibleUI();
  throw new Error('Unsupported browser');
}

// ─────────────────────────────────────────────────────────
// Renderer + Scene + Camera
// ─────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

ZapparThree.glContextSet(renderer.getContext());

const scene = new THREE.Scene();
const camera = new ZapparThree.Camera();
scene.background = camera.backgroundTexture;

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(0.5, 1, 0.5);
scene.add(dirLight);

// ─────────────────────────────────────────────────────────
// Camera permissions
// ─────────────────────────────────────────────────────────
ZapparThree.permissionRequestUI().then((granted) => {
  if (granted) camera.start();
  else ZapparThree.permissionDeniedUI();
});

// ─────────────────────────────────────────────────────────
// Image Tracking
// ─────────────────────────────────────────────────────────
let imageTracker;
try {
  imageTracker = new ZapparThree.ImageTrackerLoader().load('target.zpt');
} catch {
  document.getElementById('missing-target').style.display = 'flex';
  throw new Error('target.zpt not found');
}

const trackerGroup = new ZapparThree.ImageAnchorGroup(camera, imageTracker);
scene.add(trackerGroup);

// Show/hide hint based on tracking state
imageTracker.onVisible.bind(() => {
  document.getElementById('hint').classList.add('hidden');
});
imageTracker.onNotVisible.bind(() => {
  document.getElementById('hint').classList.remove('hidden');
});

// ─────────────────────────────────────────────────────────
// Road path helpers
//
// Coordinate system:
//   - Image center = (0, 0, 0) in AR space
//   - x: left (-) → right (+)  (image horizontal axis)
//   - z: top (-)  → bottom (+) (image vertical axis)
//   - y: height above image plane
//
// The image is treated as roughly 4:3 landscape.
// All coordinates are in image-width units (full image = ±0.5 in x).
// ─────────────────────────────────────────────────────────
function circleWaypoints(cx, cz, radius, count) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cz + Math.sin(a) * radius];
  });
}

// ─────────────────────────────────────────────────────────
// Car paths  (x, z)  —  traced from the road map image
// ─────────────────────────────────────────────────────────

const CAR_PATHS = [
  // ── Car 1: Roundabout circuit (pure circle) ──────────────
  circleWaypoints(-0.220, -0.068, 0.100, 18),

  // ── Car 2: Outer perimeter loop (clockwise) ──────────────
  // top-left → top → top-right → right (down) → bottom → left (up) → back
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
    [-0.450, -0.315],
  ],

  // ── Car 3: Inner route ─────────────────────────────────
  // Exits roundabout right → across middle → right road (down) →
  // bottom → left side (up) → short arc under roundabout → back
  [
    [-0.120, -0.068],   // roundabout right exit
    [ 0.000, -0.075],
    [ 0.150, -0.075],   // right road mid
    [ 0.150,  0.038],
    [ 0.150,  0.150],
    [ 0.150,  0.265],   // bottom-right junction
    [-0.050,  0.278],
    [-0.220,  0.278],
    [-0.380,  0.188],
    [-0.380,  0.038],
    [-0.380, -0.075],   // left side at roundabout height
    [-0.320, -0.068],   // roundabout left entry
    [-0.280,  0.030],   // arc under roundabout
    [-0.220,  0.042],
    [-0.165,  0.030],
    [-0.120, -0.068],   // back to roundabout right exit
  ],

  // ── Car 4: Top road sprint + short inner return ───────
  [
    [-0.450, -0.315],   // top-left
    [-0.220, -0.315],   // above roundabout junction
    [ 0.000, -0.315],
    [ 0.150, -0.315],   // top-right junction
    [ 0.150, -0.225],
    [ 0.150, -0.075],   // right mid
    [ 0.000, -0.075],   // cut back left
    [-0.120, -0.075],
    [-0.200, -0.168],   // arc over roundabout top
    [-0.220, -0.175],
    [-0.240, -0.168],
    [-0.320, -0.075],
    [-0.380, -0.075],
    [-0.440, -0.090],
    [-0.440, -0.225],
    [-0.450, -0.315],
  ],
];

// ─────────────────────────────────────────────────────────
// Traffic Light factory
// ─────────────────────────────────────────────────────────
const trafficLights = [];
const tlPickTargets = [];   // meshes for raycasting

function createTrafficLight(x, z, initialState = 'green') {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.085, 6),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  pole.position.y = 0.0425;
  group.add(pole);

  // Housing box
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.038, 0.014),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  housing.position.y = 0.104;
  group.add(housing);

  // Red bulb
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff2200,
    emissiveIntensity: initialState === 'red' ? 1.0 : 0.08,
    roughness: 0.4,
  });
  const redBulb = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), redMat);
  redBulb.position.set(0, 0.111, 0.008);
  group.add(redBulb);

  // Green bulb
  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x00ee44,
    emissive: 0x00ee44,
    emissiveIntensity: initialState === 'green' ? 1.0 : 0.08,
    roughness: 0.4,
  });
  const greenBulb = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), greenMat);
  greenBulb.position.set(0, 0.096, 0.008);
  group.add(greenBulb);

  trackerGroup.add(group);

  const tl = { group, redBulb, greenBulb, redMat, greenMat, state: initialState, x, z };
  trafficLights.push(tl);

  // Make the housing and both bulbs tappable
  [housing, redBulb, greenBulb].forEach((m) => {
    m.userData.trafficLight = tl;
    tlPickTargets.push(m);
  });

  return tl;
}

function applyLightState(tl, state) {
  tl.state = state;
  tl.redMat.emissiveIntensity   = state === 'red'   ? 1.0 : 0.08;
  tl.greenMat.emissiveIntensity = state === 'green' ? 1.0 : 0.08;
}

// Place lights at key intersections that multiple car routes cross
createTrafficLight( 0.150, -0.075, 'green'); // right road mid — paths 2, 3, 4
createTrafficLight(-0.220,  0.278, 'red');   // bottom centre  — paths 2, 3
createTrafficLight(-0.220, -0.315, 'green'); // top junction   — paths 2, 4

// Expose global for HTML buttons
window.setAllLights = (state) => trafficLights.forEach((tl) => applyLightState(tl, state));

// ─────────────────────────────────────────────────────────
// Car factory
// ─────────────────────────────────────────────────────────
const CAR_COLORS = [0xff2200, 0xff5500, 0xff8800, 0xff3300];
const CAR_SPEEDS = [0.0030, 0.0025, 0.0028, 0.0032];

// Distribute starting positions evenly around each path
const CAR_OFFSETS = [0.0, 0.25, 0.5, 0.75];

const cars = CAR_PATHS.map((path, i) => {
  const mat = new THREE.MeshStandardMaterial({
    color: CAR_COLORS[i],
    emissive: CAR_COLORS[i],
    emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  // Flat disc = the "car" viewed from above
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.010, 16), mat);
  body.position.y = 0.006;

  const group = new THREE.Group();
  group.add(body);
  trackerGroup.add(group);

  // Offset starting segment
  const startSeg = Math.floor(CAR_OFFSETS[i] * path.length);

  return {
    group,
    path,
    segIndex: startSeg % path.length,
    t: 0,
    speed: CAR_SPEEDS[i],
    stopped: false,
  };
});

// ─────────────────────────────────────────────────────────
// Car update
// ─────────────────────────────────────────────────────────
const STOP_RADIUS = 0.065;  // stop within this distance of a red light

function updateCars() {
  for (const car of cars) {
    const from = car.path[car.segIndex];
    const toIdx = (car.segIndex + 1) % car.path.length;
    const to   = car.path[toIdx];

    // Current interpolated position
    const cx = from[0] + (to[0] - from[0]) * car.t;
    const cz = from[1] + (to[1] - from[1]) * car.t;

    // Check proximity to any red traffic light
    car.stopped = false;
    for (const tl of trafficLights) {
      if (tl.state === 'red') {
        const dx = cx - tl.x;
        const dz = cz - tl.z;
        if (Math.sqrt(dx * dx + dz * dz) < STOP_RADIUS) {
          car.stopped = true;
          break;
        }
      }
    }

    if (!car.stopped) {
      car.t += car.speed;
      if (car.t >= 1) {
        car.t -= 1;
        car.segIndex = toIdx;
      }
    }

    // Apply position (y slightly above image plane)
    const fx = from[0] + (to[0] - from[0]) * car.t;
    const fz = from[1] + (to[1] - from[1]) * car.t;
    car.group.position.set(fx, 0, fz);

    // Face direction of travel
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      car.group.rotation.y = Math.atan2(dx, dz);
    }
  }
}

// ─────────────────────────────────────────────────────────
// Tap / click → toggle traffic light
// ─────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

function onPointerDown(e) {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  pointer.x = (clientX / window.innerWidth)  *  2 - 1;
  pointer.y = (clientY / window.innerHeight) * -2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(tlPickTargets, false);
  if (hits.length > 0) {
    const tl = hits[0].object.userData.trafficLight;
    if (tl) applyLightState(tl, tl.state === 'red' ? 'green' : 'red');
  }
}

renderer.domElement.addEventListener('click',      onPointerDown);
renderer.domElement.addEventListener('touchstart', onPointerDown, { passive: true });

// ─────────────────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────
// Render loop
// ─────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  camera.updateFrame(renderer);

  if (trackerGroup.visible) {
    updateCars();
  }

  renderer.render(scene, camera);
}

animate();
