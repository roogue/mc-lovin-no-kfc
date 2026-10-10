/*
 * Plant Condition card
 * - Three.js park scene with a potted plant that animates between healthy, sick and withered
 * - Sky, sun, moon, stars and the park lamp follow the local time (of the weather location when known)
 * - Fan -> wind, irrigation -> watering can, rainy weather -> rain (events from controls.js / weather.js)
 *
 * Public hooks (for wiring up real data later):
 *   PlantCard.setState('healthy' | 'sick' | 'withered')
 *   PlantCard.setHour(19.5)   // preview a time of day; PlantCard.setHour(null) returns to the real clock
 * You can also preview with URL params, e.g. index.html?hour=20&state=sick&weather=rain
 */
(function () {
  'use strict';

  /* ---------------- Plant status copy ---------------- */
  const STATUS = {
    healthy:  { emoji: '🌱', title: 'Thriving!',    msg: 'Happy leaves, happy life.',             health: 92 },
    sick:     { emoji: '🤒', title: 'Feeling sick', msg: 'Yellow spots found. Check Disease.',    health: 48 },
    withered: { emoji: '🥀', title: 'Withered',     msg: 'SOS! Water and care needed ASAP.',      health: 12 },
  };

  /* ---------------- Time of day ---------------- */
  // Sky colors through the day; values are interpolated between keys.
  const SKY_KEYS = [
    { h: 0,     top: '#0B1026', bottom: '#1D2B53', cloud: '#3A4466' },
    { h: 5,     top: '#1A2350', bottom: '#4A4E7E', cloud: '#5A5F85' },
    { h: 6.5,   top: '#6A8FD8', bottom: '#FFB58A', cloud: '#FFD7C2' },
    { h: 9,     top: '#3E9BEF', bottom: '#BFE6FF', cloud: '#FFFFFF' },
    { h: 13,    top: '#2F8FEA', bottom: '#D2F0FF', cloud: '#FFFFFF' },
    { h: 17,    top: '#4E9FE6', bottom: '#FFE1B0', cloud: '#FFF4E6' },
    { h: 18.75, top: '#4A5BA6', bottom: '#FF8E6B', cloud: '#FFB89E' },
    { h: 20,    top: '#1B2452', bottom: '#4D3D6E', cloud: '#55507A' },
    { h: 24,    top: '#0B1026', bottom: '#1D2B53', cloud: '#3A4466' },
  ];
  const SUNRISE = 6;
  const SUNSET = 19.2;

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const mixRgb = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const rgbCss = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`;

  SKY_KEYS.forEach((k) => { k.top = hexToRgb(k.top); k.bottom = hexToRgb(k.bottom); k.cloud = hexToRgb(k.cloud); });

  function skyAt(h) {
    let i = 0;
    while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1].h) i++;
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
    return { top: mixRgb(a.top, b.top, t), bottom: mixRgb(a.bottom, b.bottom, t), cloud: mixRgb(a.cloud, b.cloud, t) };
  }

  function sunAt(h) {
    const dayT = (h - SUNRISE) / (SUNSET - SUNRISE);
    const nightT = ((((h - SUNSET) % 24) + 24) % 24) / (24 - (SUNSET - SUNRISE));
    const elevation = dayT > -0.1 && dayT < 1.1 ? Math.sin(Math.PI * dayT) : -0.3;
    return { dayT, nightT, elevation, daylight: smoothstep(-0.08, 0.3, elevation) };
  }

  function phaseAt(h) {
    if (h < 5)    return { icon: '🌙', name: 'Night' };
    if (h < 7)    return { icon: '🌅', name: 'Sunrise' };
    if (h < 12)   return { icon: '🌤️', name: 'Morning' };
    if (h < 17)   return { icon: '☀️', name: 'Afternoon' };
    if (h < 19.5) return { icon: '🌇', name: 'Sunset' };
    if (h < 21)   return { icon: '🌆', name: 'Evening' };
    return { icon: '🌙', name: 'Night' };
  }

  function formatTime(h) {
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  }

  const params = new URLSearchParams(window.location.search);
  let hourOverride = params.has('hour') ? Number(params.get('hour')) : null;

  // Live conditions that change the scene
  const conditions = { fan: false, watering: false, rain: false, storm: false, cloudy: 0, windSpeed: 0 };
  let zoneFormatter = null; // set when the weather API tells us the location's time zone

  function currentHour() {
    if (hourOverride !== null && Number.isFinite(hourOverride)) return ((hourOverride % 24) + 24) % 24;
    if (zoneFormatter) {
      const parts = zoneFormatter.formatToParts(new Date());
      const get = (type) => Number((parts.find((x) => x.type === type) || {}).value || 0);
      return (get('hour') % 24) + get('minute') / 60 + get('second') / 3600;
    }
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  /* ---------------- DOM / status UI ---------------- */
  const card = document.querySelector('.plant-card');
  if (!card) return;

  const ui = {
    scene: document.getElementById('plant-scene'),
    timeChip: document.getElementById('time-chip'),
    statusCard: document.getElementById('status-card'),
    emoji: document.getElementById('status-emoji'),
    title: document.getElementById('status-title'),
    msg: document.getElementById('status-msg'),
    health: document.getElementById('health-value'),
    effects: document.getElementById('effect-chips'),
    buttons: card.querySelectorAll('.state-switch button'),
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let currentState = null;
  let park = null;

  function setState(name) {
    if (!STATUS[name] || name === currentState) return;
    const s = STATUS[name];
    const firstRun = currentState === null;
    currentState = name;

    card.dataset.state = name;
    ui.emoji.textContent = s.emoji;
    ui.title.textContent = s.title;
    ui.msg.textContent = s.msg;
    ui.health.textContent = `${s.health}%`;
    ui.buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.state === name)));

    if (!firstRun) {
      ui.statusCard.classList.remove('pop');
      void ui.statusCard.offsetWidth; // restart the pop animation
      ui.statusCard.classList.add('pop');
    }
    if (park) park.setState(name, firstRun);
  }

  function updateTimeUI() {
    const h = currentHour();
    const sky = skyAt(h);
    const phase = phaseAt(h);
    ui.timeChip.textContent = `${phase.icon} ${phase.name} · ${formatTime(h)}`;
    card.style.setProperty('--sky-top', rgbCss(sky.top));
    card.style.setProperty('--sky-bottom', rgbCss(sky.bottom));
    card.dataset.sky = sunAt(h).daylight < 0.35 ? 'night' : 'day';
  }

  ui.buttons.forEach((b) => b.addEventListener('click', () => setState(b.dataset.state)));

  function renderEffects() {
    const chips = [];
    if (conditions.fan) chips.push('💨 Windy');
    if (conditions.watering) chips.push('💧 Watering');
    if (conditions.storm) chips.push('⛈️ Storm');
    else if (conditions.rain) chips.push('🌧️ Raining');
    ui.effects.replaceChildren(...chips.map((text) => {
      const chip = document.createElement('span');
      chip.className = 'effect-chip glass';
      chip.textContent = text;
      return chip;
    }));
  }

  function setConditions(patch) {
    Object.assign(conditions, patch);
    renderEffects();
  }

  document.addEventListener('device:fan', (e) => setConditions({ fan: !!e.detail.on }));
  document.addEventListener('device:irrigation', (e) => setConditions({ watering: !!e.detail.running }));
  document.addEventListener('weather:update', (e) => {
    const d = e.detail || {};
    zoneFormatter = null;
    if (d.timeZone) {
      try {
        zoneFormatter = new Intl.DateTimeFormat('en-US', { timeZone: d.timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
      } catch (err) { /* unknown time zone: keep the local clock */ }
    }
    setConditions({ rain: !!d.rain, storm: !!d.storm, cloudy: d.cloudy || 0, windSpeed: d.windSpeed || 0 });
    updateTimeUI();
  });

  /* ---------------- Three.js park scene ---------------- */
  function createPark(container) {
    const T = window.THREE;
    const V3 = T.Vector3;

    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const scene = new T.Scene();
    scene.fog = new T.Fog(0xffffff, 14, 42);
    const camera = new T.PerspectiveCamera(35, 1, 0.1, 200);

    const mat = (color, opts) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0, flatShading: true }, opts));

    function glowTexture(rgb) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, `rgba(${rgb},1)`);
      grd.addColorStop(0.25, `rgba(${rgb},0.5)`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    }

    const glow = (rgb, size) => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(rgb), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      s.scale.set(size, size, 1);
      return s;
    };

    const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });
    const shadowGeo = new T.CircleGeometry(1, 24);
    const shadow = (r) => {
      const m = new T.Mesh(shadowGeo, shadowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.01;
      m.scale.setScalar(r);
      return m;
    };

    /* --- Lights --- */
    const hemi = new T.HemisphereLight(0xbfe6ff, 0x3d5a2f, 0.6);
    const sunLight = new T.DirectionalLight(0xffffff, 0.9);
    const lampLight = new T.PointLight(0xffc56b, 0, 7, 1.5);
    lampLight.position.set(-1.8, 1.9, -2.6);
    scene.add(hemi, sunLight, lampLight);

    /* --- Sky dome --- */
    const skyUniforms = {
      topColor: { value: new T.Color() },
      bottomColor: { value: new T.Color() },
    };
    const sky = new T.Mesh(
      new T.SphereGeometry(80, 32, 16),
      new T.ShaderMaterial({
        uniforms: skyUniforms,
        side: T.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          varying vec3 vWorld;
          void main() {
            float h = clamp(normalize(vWorld).y * 3.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.8)), 1.0);
          }`,
      })
    );
    sky.renderOrder = -1;
    scene.add(sky);

    /* --- Sun, moon, stars --- */
    const sun = new T.Mesh(new T.SphereGeometry(1.3, 24, 16), new T.MeshBasicMaterial({ color: 0xffe28a, fog: false, transparent: true }));
    sun.add(glow('255,214,120', 10));
    const moon = new T.Mesh(new T.SphereGeometry(1.0, 24, 16), new T.MeshBasicMaterial({ color: 0xf4f1de, fog: false, transparent: true }));
    moon.add(glow('190,210,255', 7));
    scene.add(sun, moon);

    const starPos = [];
    for (let i = 0; i < 260; i++) {
      const az = (Math.random() - 0.5) * 2.4;
      const el = 0.04 + Math.random() * 0.5;
      starPos.push(70 * Math.cos(el) * Math.sin(az), 70 * Math.sin(el), -70 * Math.cos(el) * Math.cos(az));
    }
    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute('position', new T.Float32BufferAttribute(starPos, 3));
    const starMat = new T.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0, depthWrite: false, fog: false });
    scene.add(new T.Points(starGeo, starMat));

    /* --- Clouds --- */
    const cloudMat = new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
    const puffGeo = new T.IcosahedronGeometry(1, 1);
    const clouds = [];
    for (let i = 0; i < 9; i++) {
      const extra = i >= 4; // extra clouds roll in when the sky is overcast
      const g = new T.Group();
      const puffs = [[0, 0, 0, 1.3], [1.4, -0.2, 0, 1], [-1.3, -0.3, 0, 0.9], [0.5, 0.6, 0, 0.9]];
      puffs.forEach(([x, y, z, s]) => {
        const p = new T.Mesh(puffGeo, cloudMat);
        p.position.set(x, y, z);
        p.scale.set(s, s * 0.75, s * 0.8);
        g.add(p);
      });
      if (extra) g.position.set(-16 + (i - 4) * 8 + Math.random() * 3, 3.4 + Math.random() * 2.2, -26 - Math.random() * 3);
      else g.position.set(-14 + i * 9 + Math.random() * 3, 4.6 + Math.random() * 2.6, -28 - Math.random() * 3);
      g.userData.baseScale = extra ? 1.1 + Math.random() * 0.5 : 0.8 + Math.random() * 0.5;
      g.userData.extra = extra;
      g.scale.setScalar(g.userData.baseScale);
      g.userData.speed = 0.18 + Math.random() * 0.2;
      clouds.push(g);
      scene.add(g);
    }

    /* --- Park: ground, hills, trees, bushes, bench, lamp, flowers --- */
    const grassDry = new T.Color(0x7cc96d);
    const grassWet = new T.Color(0x4f9a52);
    const ground = new T.Mesh(new T.PlaneGeometry(140, 140), mat(0x7cc96d, { flatShading: false }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    [[-14, -7, -26, 10, 0x69b85c], [12, -9, -30, 14, 0x5aa651], [0, -10, -36, 14, 0x63ae57]].forEach(([x, y, z, r, c]) => {
      const hill = new T.Mesh(new T.SphereGeometry(r, 24, 12), mat(c, { flatShading: false }));
      hill.position.set(x, y, z);
      scene.add(hill);
    });

    const trunkMat = mat(0x8b5e3c);
    const trees = [];
    function tree(x, z, s, color) {
      const g = new T.Group();
      const trunk = new T.Mesh(new T.CylinderGeometry(0.1, 0.14, 1, 6), trunkMat);
      trunk.position.y = 0.5;
      const crown = new T.Group();
      crown.position.y = 1.0;
      const c1 = new T.Mesh(new T.IcosahedronGeometry(0.75, 0), mat(color));
      c1.position.y = 0.45;
      const c2 = new T.Mesh(new T.IcosahedronGeometry(0.55, 0), mat(color));
      c2.position.set(0.25, 0.95, 0.1);
      crown.add(c1, c2);
      g.add(trunk, crown, shadow(0.75));
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      g.userData = { crown, phase: Math.random() * 6 };
      trees.push(g);
      scene.add(g);
    }
    // Keep the space directly behind the plant open so it stands out against the sky
    tree(-3.1, -3.4, 1.1, 0x4caf50);
    tree(3.4, -4.4, 1.3, 0x3f9e48);
    tree(-5.8, -8, 1.6, 0x46a84d);
    tree(6.2, -9, 1.8, 0x3a9442);
    tree(-9.5, -13, 2.2, 0x3f9e48);
    tree(9.5, -14, 2, 0x4caf50);
    tree(-4, -17, 2.2, 0x43a04a);
    tree(4.5, -19, 2.4, 0x4fb257);

    const bushMat = mat(0x5cbf62);
    [[-1.1, -2.0, 0.4], [2.8, -3.2, 0.5], [-3.2, -1.2, 0.45], [1.2, -5.5, 0.45]].forEach(([x, z, s]) => {
      const b = new T.Mesh(new T.IcosahedronGeometry(1, 0), bushMat);
      b.position.set(x, s * 0.6, z);
      b.scale.set(s * 1.3, s, s);
      const blob = shadow(s * 1.4);
      blob.position.set(x, 0.01, z);
      scene.add(b, blob);
    });

    const bench = new T.Group();
    const wood = mat(0xb07a4a);
    const metal = mat(0x4b5260);
    const seat = new T.Mesh(new T.BoxGeometry(1.1, 0.07, 0.36), wood);
    seat.position.y = 0.42;
    const back = new T.Mesh(new T.BoxGeometry(1.1, 0.26, 0.05), wood);
    back.position.set(0, 0.68, -0.16);
    bench.add(seat, back);
    [-0.48, 0.48].forEach((x) => {
      const leg = new T.Mesh(new T.BoxGeometry(0.06, 0.42, 0.32), metal);
      leg.position.set(x, 0.21, 0);
      bench.add(leg);
    });
    bench.add(shadow(0.6));
    bench.position.set(1.9, 0, -2.6);
    bench.rotation.y = -0.35;
    scene.add(bench);

    const lamp = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.05, 2, 8), metal);
    pole.position.y = 1;
    const head = new T.Mesh(new T.CylinderGeometry(0.15, 0.1, 0.16, 8), metal);
    head.position.y = 2.06;
    const bulbMat = new T.MeshBasicMaterial({ color: 0x777777 });
    const bulb = new T.Mesh(new T.SphereGeometry(0.085, 12, 8), bulbMat);
    bulb.position.y = 1.95;
    const lampGlow = glow('255,200,110', 1.8);
    lampGlow.position.y = 1.95;
    lamp.add(pole, head, bulb, lampGlow, shadow(0.25));
    lamp.position.set(-1.8, 0, -2.6);
    scene.add(lamp);

    const flowerColors = [0xff7aa8, 0xffd84d, 0xffffff, 0xb88cff, 0xff9466];
    const flowers = new T.InstancedMesh(new T.SphereGeometry(0.06, 6, 4), mat(0xffffff), 46);
    const fm = new T.Object3D();
    const fc = new T.Color();
    for (let i = 0; i < flowers.count; i++) {
      let x, z;
      do { x = (Math.random() - 0.5) * 8; z = -6 + Math.random() * 7; } while (Math.abs(x) < 1 && z > -1);
      fm.position.set(x, 0.06, z);
      fm.updateMatrix();
      flowers.setMatrixAt(i, fm.matrix);
      flowers.setColorAt(i, fc.setHex(flowerColors[i % flowerColors.length]));
    }
    scene.add(flowers);

    const fireflies = [];
    for (let i = 0; i < 14; i++) {
      const f = glow('215,255,120', 0.22);
      f.userData = { x: (Math.random() - 0.5) * 6, y: 0.4 + Math.random() * 1.5, z: -4 + Math.random() * 4, phase: Math.random() * 10 };
      fireflies.push(f);
      scene.add(f);
    }

    /* --- The plant --- */
    const plantRoot = new T.Group();
    plantRoot.scale.setScalar(0.85);
    scene.add(plantRoot, shadow(0.75));

    const pot = new T.Mesh(new T.CylinderGeometry(0.55, 0.42, 0.8, 32), mat(0xf48a5c, { flatShading: false }));
    pot.position.y = 0.4;
    const rim = new T.Mesh(new T.CylinderGeometry(0.63, 0.63, 0.18, 32), mat(0xf7a073, { flatShading: false }));
    rim.position.y = 0.86;
    const soilDry = new T.Color(0x5b3a24);
    const soilWet = new T.Color(0x2c180c);
    const soil = new T.Mesh(new T.CylinderGeometry(0.57, 0.57, 0.04, 32), mat(0x5b3a24));
    soil.position.y = 0.94;
    plantRoot.add(pot, rim, soil);

    // Face
    const ink = new T.MeshBasicMaterial({ color: 0x2b1d16 });
    const shine = new T.MeshBasicMaterial({ color: 0xffffff });
    const eyes = [-0.17, 0.17].map((x) => {
      const g = new T.Group();
      g.position.set(x, 0.52, 0.475);
      const open = new T.Group();
      const ball = new T.Mesh(new T.SphereGeometry(0.062, 16, 12), ink);
      ball.scale.z = 0.5;
      const glint = new T.Mesh(new T.SphereGeometry(0.02, 8, 6), shine);
      glint.position.set(0.02, 0.022, 0.03);
      open.add(ball, glint);
      const cross = new T.Group();
      [Math.PI / 4, -Math.PI / 4].forEach((r) => {
        const bar = new T.Mesh(new T.BoxGeometry(0.13, 0.026, 0.02), ink);
        bar.rotation.z = r;
        cross.add(bar);
      });
      g.add(open, cross);
      plantRoot.add(g);
      return { open, cross };
    });

    const smile = new T.Mesh(new T.TorusGeometry(0.09, 0.02, 8, 20, Math.PI), ink);
    smile.rotation.z = Math.PI;
    smile.position.set(0, 0.38, 0.48);
    const frown = new T.Mesh(new T.TorusGeometry(0.08, 0.02, 8, 20, Math.PI), ink);
    frown.position.set(0, 0.3, 0.485);
    const wavyPts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -0.09 + (i / 8) * 0.18;
      wavyPts.push(new V3(x, Math.sin((i / 8) * Math.PI * 3) * 0.015, 0));
    }
    const wavy = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(wavyPts), 24, 0.016, 6, false), ink);
    wavy.position.set(0, 0.34, 0.49);
    plantRoot.add(smile, frown, wavy);

    const cheekMat = new T.MeshStandardMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.75, roughness: 1 });
    const cheeks = [-1, 1].map((side) => {
      const c = new T.Mesh(new T.SphereGeometry(0.06, 12, 8), cheekMat);
      c.position.set(side * 0.29, 0.42, 0.4);
      c.rotation.y = side * 0.64;
      c.scale.set(1.3, 0.8, 0.3);
      plantRoot.add(c);
      return c;
    });

    // Sweat drop (sick)
    const sweat = new T.Group();
    const dropMat = new T.MeshStandardMaterial({ color: 0x7cc8ff, roughness: 0.2 });
    const dropBall = new T.Mesh(new T.SphereGeometry(0.05, 12, 8), dropMat);
    const dropTip = new T.Mesh(new T.ConeGeometry(0.047, 0.09, 12), dropMat);
    dropTip.position.y = 0.06;
    sweat.add(dropBall, dropTip);
    sweat.position.set(0.4, 0.72, 0.45);
    plantRoot.add(sweat);

    // Sparkles (healthy)
    const sparkleMat = new T.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0, depthWrite: false });
    const sparkleGeo = new T.OctahedronGeometry(0.05, 0);
    const sparkles = [];
    for (let i = 0; i < 7; i++) {
      const s = new T.Mesh(sparkleGeo, sparkleMat.clone());
      s.userData = { angle: (i / 7) * Math.PI * 2, r: 0.75 + Math.random() * 0.4, phase: Math.random() };
      sparkles.push(s);
      plantRoot.add(s);
    }

    // Stem + leaves sway around the stem base
    const sway = new T.Group();
    sway.position.y = 0.94;
    plantRoot.add(sway);

    const stemMat = mat(0x6bcb77, { flatShading: false });
    const stemPts = [new V3(), new V3(), new V3(), new V3()];
    const stemCurve = new T.CatmullRomCurve3(stemPts);
    const stem = new T.Mesh(new T.BufferGeometry(), stemMat);
    sway.add(stem);
    let lastDroop = -1;

    function buildStem(d) {
      if (Math.abs(d - lastDroop) < 0.002) return;
      lastDroop = d;
      stemPts[0].set(0, 0, 0);
      stemPts[1].set(lerp(0, 0.12, d), lerp(0.53, 0.48, d), 0);
      stemPts[2].set(lerp(0.02, 0.5, d), lerp(1.03, 0.78, d), 0);
      stemPts[3].set(lerp(0, 0.85, d), lerp(1.43, 0.53, d), 0);
      stem.geometry.dispose();
      stem.geometry = new T.TubeGeometry(stemCurve, 32, 0.045, 8, false);
    }

    const topLeafMat = mat(0x4cd179, { flatShading: false, side: T.DoubleSide });
    const lowLeafMat = mat(0x3bb865, { flatShading: false, side: T.DoubleSide });
    const spotMat = new T.MeshBasicMaterial({ color: 0x6e4a1f, transparent: true, opacity: 0, depthWrite: false });
    const spotGeo = new T.CircleGeometry(1, 12);
    const SPOTS = [[-0.15, 0.35, 0.045], [0.14, 0.55, 0.035], [0.02, 0.75, 0.03]];

    function makeLeaf(len, width, material) {
      const geo = new T.PlaneGeometry(1, 1, 6, 10);
      const mesh = new T.Mesh(geo, material);
      const spots = SPOTS.map(([u, v, r]) => {
        const s = new T.Mesh(spotGeo, spotMat);
        s.scale.setScalar(r);
        s.userData = { u, v };
        mesh.add(s);
        return s;
      });
      return { mesh, geo, uv: geo.attributes.uv.array.slice(), len, width, spots, key: '' };
    }

    function leafPoint(leaf, u, v, ws, curl, bend) {
      const w = leaf.width * ws * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.85)), 0.9);
      return [
        u * w * (1 - curl * 0.35 * Math.abs(u * 2)),
        v * leaf.len * (1 - 0.12 * bend),
        Math.pow(u * 2, 2) * w * (0.18 + 0.55 * curl) - bend * v * v * leaf.len * 0.5,
      ];
    }

    function shapeLeaf(leaf, ws, curl, bend) {
      const key = `${ws.toFixed(3)}|${curl.toFixed(3)}|${bend.toFixed(3)}`;
      if (key === leaf.key) return;
      leaf.key = key;
      const pos = leaf.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const p = leafPoint(leaf, leaf.uv[i * 2] - 0.5, leaf.uv[i * 2 + 1], ws, curl, bend);
        pos.setXYZ(i, p[0], p[1], p[2]);
      }
      pos.needsUpdate = true;
      leaf.geo.computeVertexNormals();
      leaf.geo.computeBoundingSphere();
      leaf.spots.forEach((s) => {
        const p = leafPoint(leaf, s.userData.u, s.userData.v, ws, curl, bend);
        s.position.set(p[0], p[1], p[2] + 0.012);
      });
    }

    // side 1 = left, -1 = right; `at` = position along the stem (0 base → 1 tip)
    const leaves = [
      { leaf: makeLeaf(0.95, 0.62, topLeafMat), side: 1,  at: 1,    top: true,  phase: 0 },
      { leaf: makeLeaf(0.95, 0.62, topLeafMat), side: -1, at: 1,    top: true,  phase: 1.3 },
      { leaf: makeLeaf(0.6, 0.4, lowLeafMat),   side: 1,  at: 0.42, top: false, phase: 2.1 },
      { leaf: makeLeaf(0.6, 0.4, lowLeafMat),   side: -1, at: 0.55, top: false, phase: 0.7 },
    ];
    leaves.forEach((l) => {
      l.group = new T.Group();
      l.group.add(l.leaf.mesh);
      sway.add(l.group);
    });

    // The lower-left leaf drops off when the plant withers
    const fallenMat = mat(0x86603a, { flatShading: false, side: T.DoubleSide });
    const fallen = makeLeaf(0.6, 0.4, fallenMat);
    fallen.spots.forEach((s) => { s.visible = false; });
    shapeLeaf(fallen, 0.6, 0.9, 0.5);
    fallen.mesh.visible = false;
    scene.add(fallen.mesh);
    const fall = { phase: 'none', delay: 0, t: 0, start: new V3(), end: new V3(-0.95, 0.03, 0.6), scale: 0 };
    let attach = 1;


    /* --- Wind, watering can and rain effects --- */
    const fx = { wind: 0, can: 0, rain: 0, overcast: 0, wet: 0, flash: 0 };
    let nextFlash = 3;
    let windPhase = 0;

    // Wind streaks
    const streakTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 4;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 128, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.7, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 4);
      return new T.CanvasTexture(c);
    })();
    const streakGeo = new T.PlaneGeometry(1, 1);
    const streaks = [];
    function resetStreak(m) {
      m.userData.y = 0.3 + Math.random() * 2.8;
      m.userData.z = -1.5 + Math.random() * 3;
      m.scale.set(0.7 + Math.random() * 0.9, 0.018 + Math.random() * 0.016, 1);
    }
    for (let i = 0; i < 14; i++) {
      const m = new T.Mesh(streakGeo, new T.MeshBasicMaterial({ map: streakTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      m.userData = { prog: Math.random(), speed: 4 + Math.random() * 3, phase: Math.random() * 6 };
      resetStreak(m);
      m.visible = false;
      streaks.push(m);
      scene.add(m);
    }

    // Leaf bits tumbling in the wind
    const bitColors = [0x6bcb77, 0x9ad66f, 0xd9c04a];
    const bitGeo = new T.PlaneGeometry(0.12, 0.06);
    const bits = [];
    for (let i = 0; i < 6; i++) {
      const m = new T.Mesh(bitGeo, new T.MeshStandardMaterial({ color: bitColors[i % 3], side: T.DoubleSide, transparent: true, opacity: 0 }));
      m.userData = { y: 0.4 + Math.random() * 2, z: -1 + Math.random() * 2.5, speed: 2.5 + Math.random() * 1.5, prog: Math.random(), spin: 3 + Math.random() * 4 };
      m.visible = false;
      bits.push(m);
      scene.add(m);
    }

    // Watering can (spout points left, toward the plant)
    const canMat = mat(0x5bbcf0, { flatShading: false, roughness: 0.45, metalness: 0.2 });
    const canDark = mat(0x3c94c7, { flatShading: false, roughness: 0.45, metalness: 0.2 });
    const can = new T.Group();
    const canTilt = new T.Group();
    can.add(canTilt);
    const canBody = new T.Mesh(new T.CylinderGeometry(0.28, 0.3, 0.48, 28), canMat);
    const canBand = new T.Mesh(new T.CylinderGeometry(0.302, 0.302, 0.07, 28), mat(0xffffff, { flatShading: false }));
    canBand.position.y = 0.04;
    const canCap = new T.Mesh(new T.CylinderGeometry(0.21, 0.21, 0.04, 24), canDark);
    canCap.position.y = 0.25;
    const canHandle = new T.Mesh(new T.TorusGeometry(0.2, 0.035, 8, 24, Math.PI), canDark);
    canHandle.position.set(0.05, 0.22, 0);
    const SPOUT_ANGLE = 0.9;
    const SPOUT_DIR = new V3(-Math.sin(SPOUT_ANGLE), Math.cos(SPOUT_ANGLE), 0);
    const spoutBase = new V3(-0.22, -0.1, 0);
    const spout = new T.Mesh(new T.CylinderGeometry(0.035, 0.05, 0.75, 12), canMat);
    spout.position.copy(spoutBase).addScaledVector(SPOUT_DIR, 0.375);
    spout.rotation.z = SPOUT_ANGLE;
    const spoutTip = spoutBase.clone().addScaledVector(SPOUT_DIR, 0.8);
    const rose = new T.Mesh(new T.CylinderGeometry(0.09, 0.05, 0.08, 16), canDark);
    rose.position.copy(spoutTip);
    rose.rotation.z = SPOUT_ANGLE;
    canTilt.add(canBody, canBand, canCap, canHandle, spout, rose);
    can.visible = false;
    scene.add(can);
    const CAN_OFF = new V3(2.6, 3.0, 0.6);
    const CAN_ON = new V3(1.2, 1.7, 0.6);

    // Water droplets from the can
    const dropGeo = new T.SphereGeometry(0.024, 8, 6);
    const waterMat = new T.MeshStandardMaterial({ color: 0x6fc4ff, roughness: 0.15, transparent: true, opacity: 0.9 });
    const drops = [];
    for (let i = 0; i < 60; i++) {
      const d = new T.Mesh(dropGeo, waterMat);
      d.scale.y = 1.5;
      d.visible = false;
      d.userData = { vel: new V3(), alive: false };
      drops.push(d);
      scene.add(d);
    }
    let dropTimer = 0;

    // Splash ripples (shared by watering and rain)
    const ringGeo = new T.RingGeometry(0.6, 1, 20);
    const splashes = [];
    for (let i = 0; i < 28; i++) {
      const r = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      r.userData = { t: 1, size: 0.05 };
      splashes.push(r);
      scene.add(r);
    }
    let splashIndex = 0;
    function splash(x, y, z, size) {
      const r = splashes[splashIndex++ % splashes.length];
      r.position.set(x, y + 0.006, z);
      r.userData.t = 0;
      r.userData.size = size;
      r.visible = true;
    }

    // Rain streaks
    const RAIN_COUNT = 600;
    const rainPos = new Float32Array(RAIN_COUNT * 6);
    const rainDrops = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainDrops.push({ x: (Math.random() - 0.5) * 12, y: Math.random() * 9, z: -10 + Math.random() * 13, speed: 9 + Math.random() * 4 });
    }
    const rainGeo = new T.BufferGeometry();
    rainGeo.setAttribute('position', new T.BufferAttribute(rainPos, 3));
    const rainMat = new T.LineBasicMaterial({ color: 0xdde9ff, transparent: true, opacity: 0, depthWrite: false });
    const rainLines = new T.LineSegments(rainGeo, rainMat);
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    scene.add(rainLines);
    let rainSplashTimer = 0;

    /* --- State targets --- */
    const TARGETS = {
      healthy: {
        droop: 0, topAngle: 0.9, lowAngle: 1.15, width: 1, curl: 0, bend: 0.05, spots: 0, sway: 1,
        smile: 1, wavy: 0, frown: 0, eyeOpen: 1, xEyes: 0, cheek: 1, sweat: 0, sparkle: 1, hop: 1,
        topLeaf: '#4CD179', lowLeaf: '#3BB865', stem: '#6BCB77', cheekColor: '#FF8FA3',
      },
      sick: {
        droop: 0.4, topAngle: 1.45, lowAngle: 1.75, width: 0.92, curl: 0.25, bend: 0.25, spots: 1, sway: 0.5,
        smile: 0, wavy: 1, frown: 0, eyeOpen: 0.45, xEyes: 0, cheek: 1, sweat: 1, sparkle: 0, hop: 0,
        topLeaf: '#CDBF4C', lowLeaf: '#B8A944', stem: '#A3B356', cheekColor: '#A7D98B',
      },
      withered: {
        droop: 1, topAngle: 2.5, lowAngle: 2.7, width: 0.6, curl: 0.9, bend: 0.5, spots: 0.7, sway: 0.15,
        smile: 0, wavy: 0, frown: 1, eyeOpen: 1, xEyes: 1, cheek: 0, sweat: 0, sparkle: 0, hop: 0,
        topLeaf: '#9A7246', lowLeaf: '#86603A', stem: '#8E7048', cheekColor: '#FF8FA3',
      },
    };
    const COLOR_KEYS = ['topLeaf', 'lowLeaf', 'stem', 'cheekColor'];
    Object.values(TARGETS).forEach((t) => COLOR_KEYS.forEach((k) => { t[k] = new T.Color(t[k]); }));

    let state = 'healthy';
    const cur = {};
    function snapTo(name) {
      const t = TARGETS[name];
      Object.keys(t).forEach((k) => { cur[k] = t[k].isColor ? t[k].clone() : t[k]; });
    }
    snapTo(state);

    function setParkState(name, instant) {
      state = name;
      if (instant) snapTo(name);
      if (name === 'withered') {
        if (fall.phase === 'none') { fall.phase = instant ? 'landed' : 'waiting'; fall.delay = 1.4; }
        else if (fall.phase === 'removing') fall.phase = 'landed';
        if (instant) { attach = 0; fall.scale = 1; fallen.mesh.visible = true; placeFallenLanded(); }
      } else if (fall.phase === 'waiting') {
        fall.phase = 'none';
      } else if (fall.phase !== 'none') {
        fall.phase = 'removing';
      }
    }

    function placeFallenLanded() {
      fallen.mesh.position.copy(fall.end);
      fallen.mesh.rotation.set(-Math.PI / 2, 0, 0.9);
    }

    /* --- Time of day --- */
    const tmp = new V3();
    const tmp2 = new V3();
    const sunColor = new T.Color();
    const warm = new T.Color(0xffa066);
    const white = new T.Color(0xfff4e0);
    const moonLightColor = new T.Color(0x8ea6ff);
    const bulbOff = new T.Color(0x777777);
    const bulbOn = new T.Color(0xffe3a0);
    let lampOn = 0;

    function applySky(h) {
      const s = skyAt(h);
      const sunInfo = sunAt(h);
      const day = sunInfo.daylight;
      const night = 1 - day;

      // Clouds and rain turn the sky grey; lightning briefly lights it up
      const oc = fx.overcast;
      const dim = 0.3 + 0.7 * day;
      const flash = [0.85, 0.88, 1];
      const top = mixRgb(mixRgb(s.top, [0.47 * dim, 0.52 * dim, 0.6 * dim], oc), flash, fx.flash * 0.6);
      const bottom = mixRgb(mixRgb(s.bottom, [0.68 * dim, 0.71 * dim, 0.76 * dim], oc), flash, fx.flash * 0.5);
      const cloud = mixRgb(s.cloud, [0.6 * dim, 0.63 * dim, 0.68 * dim], oc);
      skyUniforms.topColor.value.setRGB(top[0], top[1], top[2]);
      skyUniforms.bottomColor.value.setRGB(bottom[0], bottom[1], bottom[2]);
      scene.fog.color.setRGB(bottom[0], bottom[1], bottom[2]);
      cloudMat.color.setRGB(cloud[0], cloud[1], cloud[2]);
      cloudMat.emissive.setRGB(cloud[0] * 0.4, cloud[1] * 0.4, cloud[2] * 0.4);
      const clear = clamp01(1 - oc * 1.15);
      sun.material.opacity = sun.children[0].material.opacity = clear;
      moon.material.opacity = moon.children[0].material.opacity = clear;

      // Sun and moon arc across the visible part of the sky
      const dist = camera.position.z + 35;
      const xRange = 0.75 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * dist;
      const arcY = (t) => 1.9 + Math.sin(Math.PI * t) * 6.6;
      sun.visible = sunInfo.dayT > -0.05 && sunInfo.dayT < 1.05;
      sun.position.set(-Math.cos(Math.PI * sunInfo.dayT) * xRange, arcY(sunInfo.dayT), -35);
      moon.visible = sunInfo.nightT > -0.05 && sunInfo.nightT < 1.05;
      moon.position.set(-Math.cos(Math.PI * sunInfo.nightT) * xRange, arcY(sunInfo.nightT) * 0.95, -35);

      hemi.color.setRGB(lerp(0.45, s.top[0], 0.6), lerp(0.5, s.top[1], 0.6), lerp(0.7, s.top[2], 0.6));
      hemi.intensity = (0.4 + 0.5 * day) * (1 - 0.3 * oc) + fx.flash * 1.2;

      sunColor.copy(white).lerp(warm, 1 - smoothstep(0, 0.45, sunInfo.elevation));
      sunLight.color.copy(moonLightColor).lerp(sunColor, day);
      sunLight.intensity = (0.25 + 0.7 * day) * (1 - 0.55 * oc);
      // Light from the camera side (shifted toward the sun/moon) so the plant's face is lit
      tmp.copy(moon.position).lerp(sun.position, day);
      sunLight.position.set(tmp.x * 0.25, 6, 8);

      starMat.opacity = Math.pow(night, 1.5) * 0.9 * clear;
      lampOn = smoothstep(0.35, 0.75, night);
      bulbMat.color.copy(bulbOff).lerp(bulbOn, lampOn);
      lampGlow.material.opacity = lampOn;
      lampLight.intensity = 1.4 * lampOn;
    }

    /* --- Sizing --- */
    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const dist = Math.max(8.4, 6 / camera.aspect);
      camera.position.set(0, 1.15, dist);
      camera.lookAt(0, 0.8, 0);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);
    resize();

    /* --- Animation loop --- */
    const clock = new T.Clock();
    const motion = reducedMotion ? 0.25 : 1;
    let time = 0;
    let nextBlink = 2;
    let running = true;

    function frame() {
      if (!running) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      time += dt;

      // Ease every parameter toward the current state's target
      const k = 1 - Math.exp(-dt * 3);
      const target = TARGETS[state];
      Object.keys(target).forEach((key) => {
        if (target[key].isColor) cur[key].lerp(target[key], k);
        else cur[key] = lerp(cur[key], target[key], k);
      });
      const p = cur;

      // Ease the weather / device effects toward the live conditions
      const windTarget = Math.max(conditions.fan ? 1 : 0, clamp01((conditions.windSpeed - 15) / 35));
      fx.wind = lerp(fx.wind, windTarget, 1 - Math.exp(-dt * 2));
      fx.can = lerp(fx.can, conditions.watering ? 1 : 0, 1 - Math.exp(-dt * 2.5));
      fx.rain = lerp(fx.rain, conditions.rain ? 1 : 0, 1 - Math.exp(-dt * 1.2));
      fx.overcast = lerp(fx.overcast, conditions.rain ? 0.85 : conditions.cloudy, 1 - Math.exp(-dt * 0.8));
      const pour = smoothstep(0.6, 0.95, fx.can);
      const pouring = conditions.watering && pour > 0.8;
      const gust = fx.wind * (0.75 + 0.25 * Math.sin(time * 2.3)) * motion;
      windPhase += dt * (0.8 + 2.5 * fx.wind);

      topLeafMat.color.copy(p.topLeaf);
      lowLeafMat.color.copy(p.lowLeaf);
      stemMat.color.copy(p.stem);
      cheekMat.color.copy(p.cheekColor);
      spotMat.opacity = p.spots;

      buildStem(p.droop);

      // Gentle sway (healthy), tired shiver (sick), almost still (withered)
      const shiver = (time % 3.2) < 0.45 ? Math.sin(time * 45) * 0.012 * p.sweat : 0;
      sway.rotation.z = (Math.sin(time * 1.4) * 0.035 * p.sway + shiver) * motion - gust * (0.14 + 0.04 * Math.sin(time * 9));
      plantRoot.rotation.z = -gust * 0.015 * Math.sin(time * 11);

      leaves.forEach((l, i) => {
        stemCurve.getPoint(l.at, tmp);
        stemCurve.getTangent(l.at, tmp2);
        l.group.position.copy(tmp);
        const lean = Math.atan2(tmp2.x, tmp2.y);
        const base = l.top ? p.topAngle : p.lowAngle;
        const flutter = Math.sin(time * 2.2 + l.phase) * 0.06 * p.sway * motion
          + Math.sin(time * 12 + l.phase * 3) * 0.22 * gust - gust * 0.35;
        l.group.rotation.set(0.2, -0.25 * l.side, l.side * base - lean * 0.3 + flutter);
        shapeLeaf(l.leaf, p.width, p.curl, p.bend + gust * 0.12 * (1 + Math.sin(time * 10 + l.phase * 2)));
        if (i === 2) l.group.scale.setScalar(Math.max(0.0001, attach));
      });

      // Falling leaf
      if (fall.phase === 'waiting') {
        fall.delay -= dt;
        if (fall.delay <= 0) {
          leaves[2].leaf.mesh.getWorldPosition(fall.start);
          fall.phase = 'falling';
          fall.t = 0;
          fall.scale = 1;
          attach = 0;
          fallen.mesh.visible = true;
        }
      } else if (fall.phase === 'falling') {
        fall.t = Math.min(1, fall.t + dt / 2.2);
        const e = Math.pow(fall.t, 1.6);
        fallen.mesh.position.lerpVectors(fall.start, fall.end, e);
        fallen.mesh.position.x += Math.sin(fall.t * 9) * 0.18 * (1 - fall.t);
        fallen.mesh.rotation.set(lerp(0.2, -Math.PI / 2, e), 0, 1.9 + Math.sin(fall.t * 8) * 0.8 * (1 - fall.t) - fall.t);
        if (fall.t >= 1) fall.phase = 'landed';
      } else if (fall.phase === 'landed') {
        fall.scale = lerp(fall.scale, 1, k * 2);
        attach = lerp(attach, 0, k * 2);
      } else if (fall.phase === 'removing') {
        fall.scale = lerp(fall.scale, 0, k * 2);
        if (fall.scale < 0.02) { fall.phase = 'none'; fallen.mesh.visible = false; }
      }
      fallen.mesh.scale.setScalar(0.85 * Math.max(0.0001, fall.scale));
      if (state !== 'withered') attach = lerp(attach, 1, k);

      // Face: blink, eyes, mouth, cheeks
      if (time > nextBlink + 0.14) nextBlink = time + 2.5 + Math.random() * 3;
      const blink = time > nextBlink ? 0.1 : 1;
      eyes.forEach((e) => {
        const o = 1 - p.xEyes;
        e.open.visible = o > 0.02;
        // squint into the wind, happy squint while being watered
        const squint = 1 - Math.max(fx.wind * 0.45, pour * 0.6);
        e.open.scale.set(o, Math.max(0.05, o * p.eyeOpen * blink * squint), o);
        e.cross.visible = p.xEyes > 0.02;
        e.cross.scale.setScalar(Math.max(0.0001, p.xEyes));
      });
      [[smile, p.smile], [wavy, p.wavy], [frown, p.frown]].forEach(([m, w]) => {
        m.visible = w > 0.02;
        m.scale.setScalar(Math.max(0.0001, w));
      });
      cheeks.forEach((c) => {
        c.visible = p.cheek > 0.02;
        c.scale.set(1.3 * p.cheek, 0.8 * p.cheek, 0.3);
      });

      // Healthy: happy hop + sparkles
      const hopT = (time % 3.6) / 0.5;
      const hop = hopT < 1 ? Math.sin(Math.PI * hopT) : 0;
      plantRoot.position.y = hop * 0.1 * p.hop * motion;
      plantRoot.scale.set(0.85 * (1 + hop * 0.03 * p.hop), 0.85 * (1 - hop * 0.03 * p.hop + hop * 0.06 * p.hop), 0.85);
      sparkles.forEach((s) => {
        const u = s.userData;
        const prog = (time * 0.35 + u.phase) % 1;
        s.position.set(Math.cos(u.angle) * u.r, 1.3 + prog * 1.6, Math.sin(u.angle) * u.r * 0.5 + 0.3);
        s.rotation.y = time * 2;
        s.material.opacity = p.sparkle * Math.sin(Math.PI * prog);
        s.visible = p.sparkle > 0.02;
      });

      // Sick: sweat drop bobbing
      sweat.visible = p.sweat > 0.02;
      sweat.scale.setScalar(Math.max(0.0001, p.sweat));
      sweat.position.y = 0.72 - ((time * 0.6) % 1) * 0.12 * motion;


      // Wind: streaks + tumbling leaf bits
      const halfW = camera.position.z * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect + 1.5;
      streaks.forEach((m) => {
        const u = m.userData;
        m.visible = fx.wind > 0.01;
        if (!m.visible) return;
        u.prog += (u.speed * dt) / (2 * halfW);
        if (u.prog > 1) { u.prog = 0; resetStreak(m); }
        const wave = u.prog * 6 + u.phase;
        m.position.set(lerp(-halfW, halfW, u.prog), u.y + Math.sin(wave) * 0.1, u.z);
        m.rotation.z = Math.cos(wave) * 0.12;
        m.material.opacity = fx.wind * 0.75 * Math.sin(Math.PI * u.prog);
      });
      bits.forEach((m) => {
        const u = m.userData;
        m.visible = fx.wind > 0.01;
        if (!m.visible) return;
        u.prog += (u.speed * dt) / (2 * halfW);
        if (u.prog > 1) { u.prog = 0; u.y = 0.4 + Math.random() * 2; }
        m.position.set(lerp(-halfW, halfW, u.prog), u.y + Math.sin(u.prog * 9) * 0.25, u.z);
        m.rotation.set(time * u.spin, time * u.spin * 0.7, time * u.spin * 0.4);
        m.material.opacity = fx.wind * Math.min(1, Math.sin(Math.PI * u.prog) * 2);
      });

      // Watering can swoops in, tilts and pours
      can.visible = fx.can > 0.01;
      if (can.visible) {
        const e = smoothstep(0, 1, fx.can);
        can.position.lerpVectors(CAN_OFF, CAN_ON, e);
        can.position.y += Math.sin(time * 2) * 0.02;
        can.scale.setScalar(0.9 * Math.max(0.0001, e));
        canTilt.rotation.z = 0.62 * pour + Math.sin(time * 3.1) * 0.03 * pour;
      }
      if (pouring) {
        can.updateMatrixWorld(true);
        dropTimer += dt * 55;
        while (dropTimer >= 1) {
          dropTimer -= 1;
          const d = drops.find((x) => !x.userData.alive);
          if (!d) break;
          d.position.copy(spoutTip);
          canTilt.localToWorld(d.position);
          tmp2.copy(SPOUT_DIR).transformDirection(canTilt.matrixWorld);
          d.userData.vel.copy(tmp2).multiplyScalar(0.85 + Math.random() * 0.35);
          d.userData.vel.y += (Math.random() - 0.5) * 0.1;
          d.userData.vel.z += (Math.random() - 0.5) * 0.15;
          d.userData.alive = true;
          d.visible = true;
        }
      }
      const soilY = 0.96 * plantRoot.scale.y + plantRoot.position.y;
      drops.forEach((d) => {
        const u = d.userData;
        if (!u.alive) return;
        u.vel.y -= 5 * dt;
        d.position.addScaledVector(u.vel, dt);
        const onSoil = d.position.y < soilY && d.position.y > soilY - 0.12 && Math.hypot(d.position.x, d.position.z) < 0.5;
        if (onSoil || d.position.y < 0.02) {
          u.alive = false;
          d.visible = false;
          splash(d.position.x, onSoil ? soilY : 0.01, d.position.z, 0.07);
        }
      });

      // Rain
      rainLines.visible = fx.rain > 0.01;
      if (rainLines.visible) {
        const drift = 0.8 + fx.wind * 4;
        rainDrops.forEach((r, i) => {
          r.y -= r.speed * dt;
          r.x += drift * dt;
          if (r.y < 0) { r.y = 8 + Math.random(); r.x = (Math.random() - 0.5) * 12 - drift * 0.5; }
          rainPos.set([r.x, r.y, r.z, r.x - drift * 0.03, r.y + 0.28, r.z], i * 6);
        });
        rainGeo.attributes.position.needsUpdate = true;
        rainMat.opacity = fx.rain * 0.6;
        rainSplashTimer += dt * 14 * fx.rain;
        while (rainSplashTimer >= 1) {
          rainSplashTimer -= 1;
          if (Math.random() < 0.3) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.45;
            splash(Math.cos(a) * r, soilY, Math.sin(a) * r, 0.06);
          } else {
            splash((Math.random() - 0.5) * 4.4, 0.01, -2 + Math.random() * 3.4, 0.09);
          }
        }
      }
      splashes.forEach((r) => {
        const u = r.userData;
        if (!r.visible) return;
        u.t += dt * 2.5;
        if (u.t >= 1) { r.visible = false; return; }
        r.scale.setScalar(u.size * (0.3 + u.t));
        r.material.opacity = (1 - u.t) * 0.8;
      });

      // Wet soil and grass
      fx.wet = pouring || fx.rain > 0.4 ? Math.min(1, fx.wet + dt * 0.5) : Math.max(0, fx.wet - dt * 0.03);
      soil.material.color.copy(soilDry).lerp(soilWet, fx.wet);
      ground.material.color.copy(grassDry).lerp(grassWet, fx.rain * 0.6);

      // Lightning during storms
      if (conditions.storm && fx.rain > 0.5 && time > nextFlash) {
        fx.flash = 1;
        nextFlash = time + 4 + Math.random() * 6;
      }
      fx.flash *= Math.exp(-dt * 6);

      // Park life
      applySky(currentHour());
      const cloudSpan = 0.315 * camera.aspect * 36 + 6;
      clouds.forEach((c) => {
        const scale = c.userData.baseScale * (c.userData.extra ? fx.overcast : 1);
        c.visible = scale > 0.02;
        c.scale.setScalar(Math.max(0.0001, scale));
        c.position.x += c.userData.speed * (1 + 4 * fx.wind) * dt * motion;
        if (c.position.x > cloudSpan) c.position.x = -cloudSpan;
      });
      trees.forEach((t) => {
        t.userData.crown.rotation.z = (Math.sin(windPhase + t.userData.phase) * (0.02 + 0.05 * fx.wind) - fx.wind * 0.06) * motion;
      });
      fireflies.forEach((f) => {
        const u = f.userData;
        f.position.set(u.x + Math.sin(time * 0.5 + u.phase) * 0.5, u.y + Math.sin(time * 0.9 + u.phase * 2) * 0.25, u.z + Math.cos(time * 0.4 + u.phase) * 0.4);
        f.material.opacity = lampOn * (1 - fx.rain) * (0.45 + 0.55 * Math.sin(time * 3 + u.phase));
      });

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    // Only animate while the card is on screen
    new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      if (visible && !running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
      running = visible;
    }).observe(container);
    requestAnimationFrame(frame);

    return { setState: setParkState };
  }

  /* ---------------- Boot ---------------- */
  if (window.THREE && ui.scene) {
    try {
      park = createPark(ui.scene);
    } catch (err) {
      console.warn('Plant scene disabled, showing the flat fallback instead:', err);
    }
  }

  setState(STATUS[params.get('state')] ? params.get('state') : card.dataset.state || 'healthy');
  updateTimeUI();
  setInterval(updateTimeUI, 15000);

  window.PlantCard = {
    setState,
    setHour(h) { hourOverride = h; updateTimeUI(); },
  };
})();
