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
    document.dispatchEvent(new CustomEvent('plant:state', { detail: { state: name, health: s.health } }));
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

    // Colours are authored in sRGB, lighting runs in linear space, and the frame is graded with ACES filmic tone mapping
    T.ColorManagement.legacyMode = false;
    // Phones and low-core machines get less grass, smaller shadow maps and a lower resolution cap
    const lowPower = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      throw new Error('WebGL2 is needed for the plant scene'); // the card falls back to its flat CSS park
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0xffffff, 0.016);
    const camera = new T.PerspectiveCamera(35, 1, 0.1, 200);

    const mat = (color, opts) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0 }, opts));

    /* --- Procedural surface shaders (patched into the standard PBR material) --- */
    const NOISE_GLSL = `
      float pc_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float pc_noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(pc_hash(i), pc_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(pc_hash(i + vec3(0.0, 1.0, 0.0)), pc_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                   mix(mix(pc_hash(i + vec3(0.0, 0.0, 1.0)), pc_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(pc_hash(i + vec3(0.0, 1.0, 1.0)), pc_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
      }
      float pc_fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * pc_noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
      // Bump-map a surface from a procedural height (screen-space derivatives)
      vec3 pc_bump(vec3 n, float h, float strength) {
        vec3 pos = -vViewPosition;
        vec3 dpdx = dFdx(pos); vec3 dpdy = dFdy(pos);
        vec3 r1 = cross(dpdy, n); vec3 r2 = cross(n, dpdx);
        float det = dot(dpdx, r1);
        vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
        return normalize(abs(det) * n - strength * grad);
      }`;

    const glslType = (v) => (typeof v === 'number' ? 'float' : v.isColor || v.isVector3 ? 'vec3' : v.isVector2 ? 'vec2' : 'float');

    // Inject GLSL into MeshStandardMaterial / MeshPhysicalMaterial at fixed points, keeping all of three's lighting,
    // shadows, fog and image-based lighting. `key` keeps each variant's compiled program separate.
    function shade(material, key, { uniforms = {}, vertexPars = '', vertex = '', project = '', fragmentPars = '', color = '', roughness = '', normal = '', output = '' }) {
      material.userData.uniforms = uniforms;
      const decl = 'varying vec3 vObjP;\nvarying vec3 vWorldP;\nvarying vec2 vLocalUv;\n'
        + Object.entries(uniforms).map(([k, u]) => `uniform ${glslType(u.value)} ${k};`).join('\n');
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${decl}\n${vertexPars}`)
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vObjP = position;
            vLocalUv = uv;
            {
              vec4 pcWorld = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                pcWorld = instanceMatrix * pcWorld;
              #endif
              vWorldP = (modelMatrix * pcWorld).xyz;
            }
            ${vertex}`);
        if (project) shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', project);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${decl}\n${NOISE_GLSL}\n${fragmentPars}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughness}`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normal}`)
          .replace('#include <output_fragment>', `${output}\n#include <output_fragment>`);
      };
      material.customProgramCacheKey = () => `plantcheck-${key}`;
      return material;
    }

    // Value noise in JS, used to sculpt lumpy tree canopies
    const hash3 = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
    function noise3(x, y, z) {
      const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
      const xf = x - xi; const yf = y - yi; const zf = z - zi;
      const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf); const w = zf * zf * (3 - 2 * zf);
      const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
      return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
        w
      );
    }

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
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      return tex;
    }

    const glow = (rgb, size) => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(rgb), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      s.scale.set(size, size, 1);
      return s;
    };

    // soft contact shadows under objects (real-time shadows do the rest)
    const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false });
    const shadowGeo = new T.CircleGeometry(1, 24);
    const shadow = (r) => {
      const m = new T.Mesh(shadowGeo, shadowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.01;
      m.scale.setScalar(r);
      return m;
    };

    /* --- Lights --- */
    const hemi = new T.HemisphereLight(0xbfdcff, 0x3d5a2f, 0.12);
    const sunLight = new T.DirectionalLight(0xffffff, 3); // key light: the sun by day, the moon by night
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
    Object.assign(sunLight.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 60 });
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
    sunLight.target.position.set(0, 0.5, -1.5);
    const fillLight = new T.DirectionalLight(0xdfe8ff, 0.3); // soft fill from the camera side
    fillLight.position.set(0.5, 3, 10);
    const lampLight = new T.PointLight(0xffc56b, 0, 7, 1.5);
    lampLight.position.set(-1.8, 1.9, -2.6);
    scene.add(hemi, sunLight, sunLight.target, fillLight, lampLight);

    /* --- Physically based sky (Preetham atmospheric scattering) --- */
    const U = {
      sunPosition: { value: new V3(0, 1, 0) },
      up: { value: new V3(0, 1, 0) },
      turbidity: { value: 5 },
      rayleigh: { value: 2.2 },
      mieCoefficient: { value: 0.005 },
      mieDirectionalG: { value: 0.8 },
      nightTop: { value: new T.Color(0x0b1430) },
      nightBottom: { value: new T.Color(0x22305c) },
      nightGain: { value: 3 },
      skyGain: { value: 0.6 }, // visible sky only; the lighting bake uses the full-strength sky
      nightMix: { value: 0 },
      overcast: { value: 0 },
      flash: { value: 0 },
    };
    const skyMat = new T.ShaderMaterial({
      uniforms: U,
      side: T.BackSide,
      depthWrite: false,
      vertexShader: `
        uniform vec3 sunPosition; uniform float rayleigh; uniform float turbidity; uniform float mieCoefficient; uniform vec3 up;
        varying vec3 vWorldPosition; varying vec3 vSunDirection; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
        const float e = 2.71828182845904523536028747135266249775724709369995957;
        const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
        const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
        const float cutoffAngle = 1.6110731556870734;
        const float steepness = 1.5;
        const float EE = 1000.0;
        float sunIntensity(float zenithAngleCos) {
          zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
          return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
        }
        vec3 totalMie(float T) { float c = (0.2 * T) * 10E-18; return 0.434 * c * MieConst; }
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w; // always at the far plane
          vSunDirection = normalize(sunPosition);
          vSunE = sunIntensity(dot(vSunDirection, up));
          vSunfade = 1.0 - clamp(1.0 - exp((sunPosition.y / 450000.0)), 0.0, 1.0);
          float rayleighCoefficient = rayleigh - (1.0 * (1.0 - vSunfade));
          vBetaR = totalRayleigh * rayleighCoefficient;
          vBetaM = totalMie(turbidity) * mieCoefficient;
        }`,
      fragmentShader: `
        varying vec3 vWorldPosition; varying vec3 vSunDirection; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
        uniform float mieDirectionalG; uniform vec3 up;
        uniform vec3 nightTop; uniform vec3 nightBottom; uniform float nightGain; uniform float nightMix; uniform float overcast; uniform float flash; uniform float skyGain;
        const float pi = 3.141592653589793238462643383279502884197169;
        const float rayleighZenithLength = 8.4E3;
        const float mieZenithLength = 1.25E3;
        const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;
        const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
        const float ONE_OVER_FOURPI = 0.07957747154594767;
        float rayleighPhase(float cosTheta) { return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0)); }
        float hgPhase(float cosTheta, float g) {
          float g2 = pow(g, 2.0);
          float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
          return ONE_OVER_FOURPI * ((1.0 - g2) * inverse);
        }
        void main() {
          vec3 direction = normalize(vWorldPosition - cameraPosition);
          float zenithAngle = acos(max(0.0, dot(up, direction)));
          float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
          float sR = rayleighZenithLength * inverse;
          float sM = mieZenithLength * inverse;
          vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));
          float cosTheta = dot(direction, vSunDirection);
          float rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
          vec3 betaRTheta = vBetaR * rPhase;
          float mPhase = hgPhase(cosTheta, mieDirectionalG);
          vec3 betaMTheta = vBetaM * mPhase;
          vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
          Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(1.0 / 2.0)), clamp(pow(1.0 - dot(up, vSunDirection), 5.0), 0.0, 1.0));
          vec3 L0 = vec3(0.1) * Fex;
          float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
          L0 += (vSunE * 19000.0 * Fex) * sundisk;
          vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
          vec3 retColor = pow(texColor, vec3(1.0 / (1.2 + (1.2 * vSunfade)))) * skyGain;
          // richer blues near the horizon (the card only shows the low sky), then night sky, cloud cover and lightning
          float sLum = dot(retColor, vec3(0.2126, 0.7152, 0.0722));
          retColor = max(mix(vec3(sLum), retColor, 1.45), 0.0);
          float hgt = clamp(direction.y * 3.0, 0.0, 1.0);
          retColor += mix(nightBottom, nightTop, pow(hgt, 0.7)) * nightGain * nightMix;
          float lum = dot(retColor, vec3(0.2126, 0.7152, 0.0722));
          retColor = mix(retColor, vec3(lum) * vec3(0.74, 0.76, 0.8), overcast * 0.85);
          retColor += vec3(0.55, 0.6, 0.75) * flash;
          gl_FragColor = vec4(retColor, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    const skyGeo = new T.SphereGeometry(80, 48, 24);
    const sky = new T.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    scene.add(sky);

    // The same scattering maths on the CPU, so fog can match the sky at the horizon exactly
    const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
    const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
    const nightTopL = U.nightTop.value;
    const nightBottomL = U.nightBottom.value;
    function skyRadiance(dir) {
      const sd = U.sunPosition.value;
      const sunCos = Math.min(1, Math.max(-1, sd.y));
      const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(sunCos)) / 1.5)));
      const sunfade = 1 - clamp01(1 - Math.exp(sd.y / 450000));
      const rayleighCoef = U.rayleigh.value - (1 - sunfade);
      const c = 0.2 * U.turbidity.value * 10e-18;
      const zenith = Math.acos(Math.max(0, dir.y));
      const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
      const cosTheta = dir.dot(sd);
      const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
      const g = U.mieDirectionalG.value;
      const mPhase = 0.07957747154594767 * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5));
      const fadeMix = clamp01(Math.pow(Math.max(0, 1 - sd.y), 5));
      const hgt = Math.pow(clamp01(dir.y * 3), 0.7);
      const out = [0, 1, 2].map((i) => {
        const bR = TOTAL_RAYLEIGH[i] * rayleighCoef;
        const bM = 0.434 * c * MIE_CONST[i] * U.mieCoefficient.value;
        const fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
        const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
        let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
        lin *= lerp(1, Math.pow(sunE * ratio * fex, 0.5), fadeMix);
        const tex = (lin + 0.1 * fex) * 0.04 + [0, 0.0003, 0.00075][i];
        return Math.pow(tex, 1 / (1.2 + 1.2 * sunfade)) * U.skyGain.value;
      });
      const sLum = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
      ['r', 'g', 'b'].forEach((c, i) => {
        out[i] = Math.max(0, lerp(sLum, out[i], 1.45)) + lerp(nightBottomL[c], nightTopL[c], hgt) * U.nightGain.value * U.nightMix.value;
      });
      const lum = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
      const oc = U.overcast.value * 0.85;
      return out.map((v, i) => lerp(v, lum * [0.74, 0.76, 0.8][i], oc) + [0.55, 0.6, 0.75][i] * U.flash.value);
    }

    // Image-based lighting: the sky (plus a grassy ground bounce) is pre-filtered into an environment map
    // that lights and reflects in every PBR material
    const pmrem = new T.PMREMGenerator(renderer);
    const envScene = new T.Scene();
    envScene.add(new T.Mesh(skyGeo, skyMat));
    const envGroundColor = new T.Color(0x4f7d3a);
    const envGround = new T.Mesh(new T.CircleGeometry(100, 32), new T.MeshBasicMaterial({ color: 0x4f7d3a }));
    envGround.rotation.x = -Math.PI / 2;
    envGround.position.y = -2;
    envScene.add(envGround);
    let envRT = null;
    function updateEnvironment() {
      const gain = U.skyGain.value;
      U.skyGain.value = 1;
      const rt = pmrem.fromScene(envScene, 0.02, 0.1, 200);
      U.skyGain.value = gain;
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
    }

    /* --- Sun, moon, stars --- */
    // Discs sit along the real sun / moon directions; HDR colours so they burn out to white through tone mapping
    const sun = new T.Mesh(new T.SphereGeometry(1.1, 24, 16), new T.MeshBasicMaterial({ fog: false, transparent: true }));
    sun.material.color.setRGB(6, 4.8, 3.2);
    sun.add(glow('255,214,150', 12));
    const moon = new T.Mesh(new T.SphereGeometry(0.9, 24, 16), new T.MeshBasicMaterial({ fog: false, transparent: true }));
    moon.material.color.setRGB(1.6, 1.55, 1.4);
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
    const starMat = new T.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    scene.add(new T.Points(starGeo, starMat));

    /* --- Clouds: soft billboards with a shaded underside --- */
    function cloudTexture() {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const g = c.getContext('2d');
      for (let i = 0; i < 46; i++) {
        const x = 40 + Math.random() * 176;
        const spread = 1 - Math.abs(x - 128) / 150;
        const y = 70 - Math.random() * 30 * spread;
        const r = 12 + Math.random() * 30 * spread;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.45)');
        grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // darker, flatter base like a real cumulus
      g.globalCompositeOperation = 'source-atop';
      const shade = g.createLinearGradient(0, 30, 0, 100);
      shade.addColorStop(0, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(118,128,150,0.65)');
      g.fillStyle = shade;
      g.fillRect(0, 0, 256, 128);
      g.globalCompositeOperation = 'destination-out';
      const base = g.createLinearGradient(0, 78, 0, 104);
      base.addColorStop(0, 'rgba(0,0,0,0)');
      base.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = base;
      g.fillRect(0, 78, 256, 50);
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      return tex;
    }
    const cloudMats = [0, 1, 2].map(() => new T.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false }));
    const clouds = [];
    for (let i = 0; i < 9; i++) {
      const extra = i >= 4; // extra clouds roll in when the sky is overcast
      const g = new T.Group();
      const n = 2 + (i % 2);
      for (let k = 0; k < n; k++) {
        const sp = new T.Sprite(cloudMats[(i + k) % 3]);
        sp.scale.set(5 + Math.random() * 2.5, 2.6 + Math.random(), 1);
        sp.position.set((k - (n - 1) / 2) * 3 + Math.random(), Math.random() * 0.8, k * 0.4);
        g.add(sp);
      }
      if (extra) g.position.set(-16 + (i - 4) * 8 + Math.random() * 3, 3.4 + Math.random() * 2.2, -26 - Math.random() * 3);
      else g.position.set(-14 + i * 9 + Math.random() * 3, 4.6 + Math.random() * 2.6, -28 - Math.random() * 3);
      g.userData.baseScale = extra ? 1.1 + Math.random() * 0.5 : 0.8 + Math.random() * 0.5;
      g.userData.extra = extra;
      g.scale.setScalar(g.userData.baseScale);
      g.userData.speed = 0.18 + Math.random() * 0.2;
      clouds.push(g);
      scene.add(g);
    }

    /* --- Park: ground, grass, hills, trees, bushes, bench, lamp --- */
    const groundU = { uWet: { value: 0 } };
    const groundMaterial = (color) => shade(mat(color, { roughness: 1 }), 'ground', {
      uniforms: groundU,
      color: `
        float gBig = pc_fbm(vec3(vWorldP.xz * 0.35, 1.7));
        float gFine = pc_fbm(vec3(vWorldP.xz * 2.5, 4.2));
        vec3 gc = diffuseColor.rgb * mix(0.7, 1.2, gBig);
        gc = mix(gc, gc * vec3(1.15, 1.05, 0.65), smoothstep(0.58, 0.8, gBig) * 0.6);
        gc *= 0.85 + 0.3 * gFine;
        diffuseColor.rgb = gc * (1.0 - uWet * 0.3);`,
      roughness: 'roughnessFactor = mix(roughnessFactor, 0.4, uWet * 0.6);',
      normal: 'normal = pc_bump(normal, pc_fbm(vec3(vWorldP.xz * 5.0, 0.0)), 0.02);',
    });
    const ground = new T.Mesh(new T.PlaneGeometry(140, 140), groundMaterial(0x5f9e45));
    ground.rotation.x = -Math.PI / 2;
    ground.userData.shadow = 'receive';
    scene.add(ground);

    [[-14, -7, -26, 10, 0x5c9e4c], [12, -9, -30, 14, 0x4f8f45], [0, -10, -36, 14, 0x57984a]].forEach(([x, y, z, r, c]) => {
      const hill = new T.Mesh(new T.SphereGeometry(r, 48, 24), groundMaterial(c));
      hill.position.set(x, y, z);
      hill.userData.shadow = 'none';
      scene.add(hill);
    });

    // Lawn: thousands of instanced blades that sway in the wind (the fan pushes them over)
    const GRASS_COUNT = lowPower ? 2600 : 5200;
    const bladeGeo = new T.PlaneGeometry(0.035, 1, 1, 4);
    bladeGeo.translate(0, 0.5, 0);
    {
      const bp = bladeGeo.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i);
        bp.setX(i, bp.getX(i) * (1 - y * 0.9)); // taper to a point
        bp.setZ(i, y * y * 0.12); // natural curve
      }
      // normals lean up so the lawn shades softly instead of like flat cards
      const nrm = bladeGeo.attributes.normal;
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 0.9, 0.44);
    }
    const grassU = { uTime: { value: 0 }, uWind: { value: 0 }, uWet: { value: 0 } };
    const grassMat = shade(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: T.DoubleSide }), 'grass', {
      uniforms: grassU,
      vertexPars: 'varying float vBladeH;',
      project: `
        vBladeH = uv.y;
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float gw = sin(mvPosition.x * 1.7 + mvPosition.z * 0.6 + uTime * 2.1) * 0.5 + sin(mvPosition.x * 0.7 - mvPosition.z * 1.3 + uTime * 1.1) * 0.5;
        float gh = uv.y * uv.y;
        float gb = (0.04 + uWind * (0.32 + 0.22 * gw)) * gh;
        mvPosition.x += gb + gw * 0.025 * gh;
        mvPosition.y -= gb * gb * 0.8;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      fragmentPars: 'varying float vBladeH;',
      color: 'diffuseColor.rgb *= mix(0.55, 1.12, pow(vBladeH, 0.8)) * (1.0 - uWet * 0.2);',
      normal: 'normal *= faceDirection;', // both sides of a blade face up, so the back isn't black
    });
    const grass = new T.InstancedMesh(bladeGeo, grassMat, GRASS_COUNT);
    {
      const gm = new T.Object3D();
      const gcol = new T.Color();
      const tones = [0x5e9e3c, 0x6fae45, 0x80bc4e, 0x8fbf55, 0x9cc65a, 0x6a9a3a];
      for (let i = 0; i < GRASS_COUNT; i++) {
        let x;
        let z;
        do { x = (Math.random() - 0.5) * 9; z = -7 + Math.random() * 8.8; } while (Math.hypot(x, z) < 0.62);
        gm.position.set(x, 0, z);
        gm.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
        gm.scale.set(0.7 + Math.random() * 0.6, 0.08 + Math.random() * 0.13, 1);
        gm.updateMatrix();
        grass.setMatrixAt(i, gm.matrix);
        grass.setColorAt(i, gcol.setHex(tones[(Math.random() * tones.length) | 0]).multiplyScalar(0.85 + Math.random() * 0.3));
      }
    }
    grass.userData.shadow = 'receive';
    scene.add(grass);

    // Lumpy, noise-sculpted spheres for tree canopies and bushes
    function lumpy(radius, amp, seed) {
      const geo = new T.SphereGeometry(radius, 40, 28);
      const pos = geo.attributes.position;
      const v = new V3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const n = noise3(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2) * 0.65 + noise3(v.x * 5 + seed, v.y * 5, v.z * 5) * 0.35;
        v.multiplyScalar(radius * (1 + amp * (n - 0.5) * 2));
        if (v.y < -radius * 0.3) v.y = -radius * 0.3 + (v.y + radius * 0.3) * 0.4; // flatter underside
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const foliage = (color) => shade(mat(color, { roughness: 0.85 }), 'foliage', {
      color: `
        float fBig = pc_fbm(vWorldP * 0.6);
        float fClump = pc_fbm(vObjP * 7.0);
        vec3 fc = diffuseColor.rgb * mix(0.75, 1.2, fBig);
        fc *= mix(0.5, 1.15, smoothstep(0.3, 0.72, fClump));
        diffuseColor.rgb = fc;`,
      normal: 'normal = pc_bump(normal, pc_fbm(vObjP * 7.0), 0.04);',
      output: 'outgoingLight += diffuseColor.rgb * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * 0.15;',
    });
    const barkMat = shade(mat(0x6b4a33, { roughness: 0.95 }), 'bark', {
      color: 'diffuseColor.rgb *= 0.65 + 0.55 * pc_fbm(vec3(vObjP.x * 18.0, vObjP.y * 2.5, vObjP.z * 18.0));',
      normal: 'normal = pc_bump(normal, pc_fbm(vec3(vObjP.x * 18.0, vObjP.y * 2.5, vObjP.z * 18.0)), 0.01);',
    });

    const trees = [];
    function tree(x, z, s, color) {
      const g = new T.Group();
      const trunk = new T.Mesh(new T.CylinderGeometry(0.08, 0.14, 1.1, 10), barkMat);
      trunk.position.y = 0.55;
      const crown = new T.Group();
      crown.position.y = 1.0;
      const leafy = foliage(color);
      const seed = Math.random() * 50;
      [[0, 0.5, 0, 0.78], [0.35, 0.85, 0.1, 0.55], [-0.32, 0.75, -0.08, 0.58], [0.05, 1.15, -0.05, 0.45]].forEach(([cx, cy, cz, r], k) => {
        const m = new T.Mesh(lumpy(r, 0.18, seed + k * 7), leafy);
        m.position.set(cx, cy, cz);
        crown.add(m);
      });
      g.add(trunk, crown, shadow(0.75));
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      g.userData = { crown, phase: Math.random() * 6 };
      trees.push(g);
      scene.add(g);
    }
    // Keep the space directly behind the plant open so it stands out against the sky
    tree(-3.1, -3.4, 1.1, 0x4c9a3f);
    tree(3.4, -4.4, 1.3, 0x3f8c3a);
    tree(-5.8, -8, 1.6, 0x46943f);
    tree(6.2, -9, 1.8, 0x3a8436);
    tree(-9.5, -13, 2.2, 0x3f8c3a);
    tree(9.5, -14, 2, 0x4c9a3f);
    tree(-4, -17, 2.2, 0x43903e);
    tree(4.5, -19, 2.4, 0x4f9e45);

    const bushMat = foliage(0x4f9f45);
    [[-1.1, -2.0, 0.4], [2.8, -3.2, 0.5], [-3.2, -1.2, 0.45], [1.2, -5.5, 0.45]].forEach(([x, z, s], k) => {
      const b = new T.Mesh(lumpy(1, 0.2, k * 13.7), bushMat);
      b.position.set(x, s * 0.6, z);
      b.scale.set(s * 1.3, s, s);
      const blob = shadow(s * 1.4);
      blob.position.set(x, 0.01, z);
      scene.add(b, blob);
    });

    const bench = new T.Group();
    const wood = shade(mat(0xa8744a, { roughness: 0.7 }), 'wood', {
      color: 'diffuseColor.rgb *= 0.78 + 0.3 * (sin(vObjP.x * 45.0 + pc_fbm(vObjP * vec3(1.5, 25.0, 25.0)) * 7.0) * 0.5 + 0.5);',
    });
    const metal = mat(0x3e444f, { roughness: 0.35, metalness: 0.8 });
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
    const pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.05, 2, 12), metal);
    pole.position.y = 1;
    const head = new T.Mesh(new T.CylinderGeometry(0.15, 0.1, 0.16, 16), metal);
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
    const flowers = new T.InstancedMesh(new T.SphereGeometry(0.06, 10, 8), mat(0xffffff, { roughness: 0.6 }), 46);
    flowers.userData.shadow = 'receive';
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

    // Terracotta: mottled clay, speckles, faint throwing rings, darker at the base
    const terracotta = (color) => shade(mat(color, { roughness: 0.82 }), 'terracotta', {
      color: `
        float tAng = atan(vObjP.z, vObjP.x);
        float tN = pc_fbm(vec3(cos(tAng) * 2.5, vObjP.y * 5.0, sin(tAng) * 2.5));
        float tSpeck = smoothstep(0.78, 0.82, pc_noise(vObjP * 80.0));
        float tDark = smoothstep(0.82, 0.86, pc_noise(vObjP * 64.0 + 3.0));
        vec3 tc = diffuseColor.rgb * mix(0.84, 1.12, tN);
        tc = mix(tc, tc * 1.25, tSpeck * 0.45);
        tc = mix(tc, tc * 0.62, tDark * 0.5);
        tc *= 0.95 + 0.05 * sin(vObjP.y * 75.0 + tN * 3.0);
        tc *= mix(0.75, 1.0, smoothstep(-0.4, -0.1, vObjP.y));
        diffuseColor.rgb = tc;`,
      roughness: 'roughnessFactor = clamp(roughnessFactor + (tN - 0.5) * 0.25, 0.0, 1.0);',
      normal: 'normal = pc_bump(normal, pc_noise(vObjP * 70.0) * 0.5 + tN * 0.5, 0.003);',
    });
    const pot = new T.Mesh(new T.CylinderGeometry(0.55, 0.42, 0.8, 48), terracotta(0xf48a5c));
    pot.position.y = 0.4;
    const rim = new T.Mesh(new T.CylinderGeometry(0.63, 0.63, 0.18, 48), terracotta(0xf7a073));
    rim.position.y = 0.86;
    // Soil: crumbly and matte when dry, dark and glossy when wet
    const soilU = { uWet: { value: 0 } };
    const soil = new T.Mesh(new T.CylinderGeometry(0.57, 0.57, 0.04, 48), shade(mat(0x5b3a24, { roughness: 0.95 }), 'soil', {
      uniforms: soilU,
      color: `
        float sN = pc_fbm(vObjP * 16.0);
        float sC = pc_noise(vObjP * 48.0);
        vec3 sc = diffuseColor.rgb * (0.65 + 0.7 * sN) * (0.8 + 0.4 * sC);
        diffuseColor.rgb = mix(sc, sc * 0.42, uWet);`,
      roughness: 'roughnessFactor = mix(roughnessFactor, 0.28, uWet * smoothstep(0.25, 0.65, sN));',
      normal: 'normal = pc_bump(normal, sN * 0.7 + sC * 0.3, 0.01);',
    }));
    soil.position.y = 0.94;
    plantRoot.add(pot, rim, soil);

    // Face
    const ink = new T.MeshPhysicalMaterial({ color: 0x1f1410, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
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
    const dropMat = new T.MeshPhysicalMaterial({ color: 0x8fd0ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 });
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

    const stemMat = mat(0x6bcb77, { roughness: 0.5 });
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

    // Leaves: veins, colour variation, blight-like blotches when sick, crisp edges when withered,
    // and light glowing through them when the sun is behind (translucency)
    const leafLight = { uSunDirView: { value: new V3(0, 1, 0) }, uSunColor: { value: new T.Color(1, 1, 1) } };
    function leafMaterial(seed) {
      return shade(mat(0x4cd179, { roughness: 0.55, side: T.DoubleSide }), 'leaf', {
        uniforms: Object.assign({ uSeed: { value: seed }, uSpots: { value: 0 }, uDry: { value: 0 } }, leafLight),
        fragmentPars: 'float leafVeins = 0.0;',
        color: `
          vec2 lu = vLocalUv;
          float ax = abs(lu.x - 0.5);
          float mid = 1.0 - smoothstep(0.006, 0.022, ax);
          float sv = abs(fract((lu.y - ax * 1.1) * 7.0) - 0.5);
          float side = (1.0 - smoothstep(0.02, 0.06, sv)) * smoothstep(0.03, 0.08, ax) * (1.0 - smoothstep(0.32, 0.48, ax));
          leafVeins = max(mid, side * 0.7) * (1.0 - smoothstep(0.9, 1.0, lu.y));
          vec3 lc = diffuseColor.rgb;
          lc *= 0.86 + 0.28 * pc_fbm(vec3(lu * vec2(5.0, 8.0), uSeed));
          lc *= mix(1.12, 0.92, lu.y);
          lc = mix(lc, lc * vec3(1.35, 1.4, 0.85) + vec3(0.015, 0.02, 0.0), leafVeins * 0.6);
          float edge = smoothstep(0.36, 0.5, ax);
          lc *= 1.0 - edge * (0.18 + 0.45 * uDry);
          float nb = pc_fbm(vec3(lu * vec2(6.0, 9.0), uSeed * 3.1 + 5.0));
          lc = mix(lc, lc * vec3(1.45, 1.25, 0.4), smoothstep(0.5, 0.62, nb) * uSpots * 0.75);
          lc = mix(lc, vec3(0.16, 0.09, 0.03), smoothstep(0.6, 0.67, nb) * uSpots);
          diffuseColor.rgb = lc;`,
        roughness: 'roughnessFactor = mix(mix(0.42, 0.68, 1.0 - leafVeins), 0.95, uDry);',
        normal: 'normal = pc_bump(normal, leafVeins * 0.5 + pc_noise(vec3(vLocalUv * 40.0, uSeed)) * 0.15, 0.003);',
        output: `
          vec3 lL = normalize(uSunDirView);
          float lBack = max(0.0, dot(-normal, lL));
          float lThrough = pow(max(0.0, dot(-normalize(vViewPosition), lL)), 4.0);
          outgoingLight += diffuseColor.rgb * vec3(1.05, 1.1, 0.6) * uSunColor * (lBack * 0.55 + lThrough * 0.9) * (1.0 - uDry * 0.8);`,
      });
    }
    const leafMats = [leafMaterial(1.3), leafMaterial(7.9), leafMaterial(4.4), leafMaterial(12.6)];
    const spotMat = new T.MeshBasicMaterial({ visible: false }); // spots are painted by the leaf shader now
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
      { leaf: makeLeaf(0.95, 0.62, leafMats[0]), side: 1,  at: 1,    top: true,  phase: 0 },
      { leaf: makeLeaf(0.95, 0.62, leafMats[1]), side: -1, at: 1,    top: true,  phase: 1.3 },
      { leaf: makeLeaf(0.6, 0.4, leafMats[2]),   side: 1,  at: 0.42, top: false, phase: 2.1 },
      { leaf: makeLeaf(0.6, 0.4, leafMats[3]),   side: -1, at: 0.55, top: false, phase: 0.7 },
    ];
    leaves.forEach((l) => {
      l.group = new T.Group();
      l.group.add(l.leaf.mesh);
      sway.add(l.group);
    });

    // The lower-left leaf drops off when the plant withers
    const fallenMat = leafMaterial(21.7);
    fallenMat.color.set(0x86603a);
    fallenMat.userData.uniforms.uDry.value = 1;
    fallenMat.userData.uniforms.uSpots.value = 0.5;
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
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      return tex;
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
    // Painted metal with a clear lacquer
    const canMat = new T.MeshPhysicalMaterial({ color: 0x4fb0e8, metalness: 0.35, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12 });
    const canDark = new T.MeshPhysicalMaterial({ color: 0x2f86bd, metalness: 0.45, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.15 });
    const can = new T.Group();
    const canTilt = new T.Group();
    can.add(canTilt);
    const canBody = new T.Mesh(new T.CylinderGeometry(0.28, 0.3, 0.48, 28), canMat);
    const canBand = new T.Mesh(new T.CylinderGeometry(0.302, 0.302, 0.07, 28), mat(0xffffff, { roughness: 0.4 }));
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
    const CAN_ON = new V3(0.95, 1.7, 0.6);

    // Water droplets from the can
    const dropGeo = new T.SphereGeometry(0.03, 10, 8);
    const waterMat = new T.MeshPhysicalMaterial({ color: 0x9fd6ff, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.9, envMapIntensity: 2 });
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

    // Real-time shadows: solid things cast and receive; face details and effects don't
    const noShadow = new Set([ink, cheekMat, dropMat, waterMat]);
    bits.forEach((b) => noShadow.add(b.material));
    scene.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      const mode = noShadow.has(o.material) ? 'none' : o.userData.shadow || 'both';
      o.receiveShadow = mode !== 'none';
      o.castShadow = mode === 'both';
      o.material.envMapIntensity = o.material === waterMat ? 2 : 0.75; // a little less sky fill so the sun models the shapes
    });

    /* --- Time of day --- */
    const tmp = new V3();
    const tmp2 = new V3();
    const sunColor = new T.Color();
    const warm = new T.Color(0xffa066);
    const white = new T.Color(0xfff4e0);
    const moonLightColor = new T.Color(0x8ea6ff);
    const bulbOff = new T.Color(0x777777);
    const bulbOn = new T.Color(0xffe3a0).multiplyScalar(3);
    let lampOn = 0;

    const sunDir = new V3();
    const moonDir = new V3();
    const lightDir = new V3();
    const horizon = new V3();
    const cloudTint = new T.Color();
    const grey = new T.Color();
    let envKey = '';
    let lastBake = -Infinity;

    // Sun / moon path: rises a little left of centre, peaks high overhead, sets a little right
    function skyPath(t, maxEl) {
      const el = t > -0.15 && t < 1.15 ? maxEl * Math.sin(Math.PI * t) : -0.32;
      return [el, T.MathUtils.degToRad(lerp(-5, 5, clamp01(t)))];
    }
    const setDir = (v, [el, az]) => v.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

    function applySky(h) {
      const s = skyAt(h);
      const sunInfo = sunAt(h);
      const day = sunInfo.daylight;
      const night = 1 - day;
      const oc = fx.overcast;
      const clear = clamp01(1 - oc * 1.15);

      const sunPath = skyPath(sunInfo.dayT, 1.25);
      const moonPath = skyPath(sunInfo.nightT, 1.0);
      setDir(sunDir, sunPath);
      setDir(moonDir, moonPath);

      // Atmosphere: hazier and flatter under cloud
      U.sunPosition.value.copy(sunDir);
      U.turbidity.value = lerp(2.5, 12, oc);
      U.rayleigh.value = lerp(3.0, 0.9, oc);
      U.nightMix.value = Math.pow(night, 1.2);
      U.overcast.value = oc;
      U.flash.value = fx.flash;
      const hz = skyRadiance(horizon.set(0, 0.035, -1).normalize());
      scene.fog.color.setRGB(hz[0], hz[1], hz[2]);

      // Clouds: tinted by the time of day, greyer and denser when overcast
      cloudTint.setRGB(s.cloud[0], s.cloud[1], s.cloud[2]).convertSRGBToLinear().multiplyScalar(lerp(0.12, 1.4, Math.sqrt(day)));
      grey.setRGB(0.42, 0.45, 0.5).multiplyScalar(lerp(0.08, 0.9, day));
      cloudTint.lerp(grey, oc * 0.8);
      cloudMats.forEach((m) => {
        m.color.copy(cloudTint);
        m.opacity = 0.75 + 0.25 * oc;
      });

      // Sun and moon discs follow their real directions (so they're in view around sunrise / sunset)
      sun.visible = sunPath[0] > -0.06;
      sun.position.copy(camera.position).addScaledVector(sunDir, 60);
      moon.visible = moonPath[0] > -0.06;
      moon.position.copy(camera.position).addScaledVector(moonDir, 60);
      sun.material.opacity = sun.children[0].material.opacity = clear;
      moon.material.opacity = moon.children[0].material.opacity = clear * clamp01(night * 1.5);

      // Key light: warm and low at golden hour, white at noon, cool moonlight at night
      const sunUp = smoothstep(-0.03, 0.12, sunPath[0]);
      const moonUp = smoothstep(-0.03, 0.15, moonPath[0]) * (1 - sunUp);
      sunColor.copy(white).lerp(warm, 1 - smoothstep(0.03, 0.45, sunPath[0]));
      sunLight.color.copy(moonLightColor).lerp(sunColor, sunUp / Math.max(1e-3, sunUp + moonUp));
      sunLight.intensity = (4.2 * sunUp + 0.35 * moonUp) * (1 - 0.7 * oc);
      lightDir.copy(sunUp >= moonUp ? sunDir : moonDir);
      lightDir.y = Math.max(lightDir.y, 0.08); // keep shadows a sensible length right at the horizon
      lightDir.normalize();
      sunLight.position.copy(sunLight.target.position).addScaledVector(lightDir, 25);

      // Soft fill from the camera side keeps the pot's face readable when the sun is behind it
      fillLight.intensity = (0.35 + 0.25 * oc) * day + 0.05;
      hemi.intensity = 0.12 + fx.flash * 2.5;

      // Leaf translucency follows the key light
      leafLight.uSunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
      leafLight.uSunColor.value.copy(sunLight.color).multiplyScalar(sunLight.intensity * 0.2);

      // exposure follows the real sun height, so dawn and dusk stay golden instead of being brightened to daylight
      renderer.toneMappingExposure = lerp(1.5, 0.45, smoothstep(-0.12, 0.06, sunPath[0])) * (1 + 0.35 * oc);
      starMat.opacity = Math.pow(night, 1.5) * 0.9 * clear;
      lampOn = smoothstep(0.35, 0.75, night);
      bulbMat.color.copy(bulbOff).lerp(bulbOn, lampOn);
      lampGlow.material.opacity = lampOn;
      lampLight.intensity = 3 * lampOn;
      envGround.material.color.copy(envGroundColor).multiplyScalar(lerp(0.02, 0.35, day) * (1 - 0.4 * oc));

      // Re-bake the image-based lighting when the sky has changed noticeably
      const key = [sunPath[0], moonPath[0], oc, night].map((v) => Math.round(v * 12)).join('|');
      const now = performance.now();
      if (key !== envKey && now - lastBake > 2000) {
        envKey = key;
        lastBake = now;
        updateEnvironment();
      }
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

      const dry = smoothstep(0.3, 0.9, p.curl);
      leaves.forEach((l, i) => {
        const m = leafMats[i];
        m.color.copy(l.top ? p.topLeaf : p.lowLeaf);
        m.userData.uniforms.uSpots.value = p.spots;
        m.userData.uniforms.uDry.value = dry;
      });
      stemMat.color.copy(p.stem);
      cheekMat.color.copy(p.cheekColor);
      grassU.uTime.value = time * motion;
      grassU.uWind.value = fx.wind * motion;

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
          d.userData.vel.copy(tmp2).multiplyScalar(0.6 + Math.random() * 0.3);
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
      soilU.uWet.value = fx.wet;
      groundU.uWet.value = fx.rain * 0.8;
      grassU.uWet.value = fx.rain * 0.8;

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
