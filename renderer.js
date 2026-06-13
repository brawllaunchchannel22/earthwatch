// ═══════════════════════════════════════════════════════════════
//  EarthWatch — renderer.js  v3
// ═══════════════════════════════════════════════════════════════

const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3';

const CATEGORY_CONFIG = {
  wildfires:    { label: 'Waldbrände',     icon: '🔥', color: '#ff4d1a' },
  severeStorms: { label: 'Stürme',          icon: '⛈️',  color: '#facc15' },
  volcanoes:    { label: 'Vulkane',          icon: '🌋', color: '#f97316' },
  seaLakeIce:   { label: 'Eis',              icon: '❄️',  color: '#7dd3fc' },
  earthquakes:  { label: 'Erdbeben',         icon: '💥', color: '#e879f9' },
  floods:       { label: 'Überflutungen',    icon: '🌊', color: '#60a5fa' },
  landslides:   { label: 'Erdrutsche',       icon: '⛰️',  color: '#a78bfa' },
  dustHaze:     { label: 'Staub & Dunst',   icon: '🌫️',  color: '#94a3b8' },
  drought:      { label: 'Dürre',            icon: '🏜️',  color: '#ca8a04' },
  snow:         { label: 'Schnee & Eis',    icon: '🌨️',  color: '#bae6fd' },
  manmade:      { label: 'Menschengemacht', icon: '🏭', color: '#f43f5e' },
  waterColor:   { label: 'Wasser',           icon: '💧', color: '#38bdf8' },
  tempExtremes: { label: 'Temperatur',       icon: '🌡️',  color: '#fb923c' },
};

// ══════════════════════════════════════════════════════════
//  EVENT INFO — Magnitude, Fläche, Skalen
// ══════════════════════════════════════════════════════════

// ── Richter / Magnitude ──────────────────────────────────
function parseMagnitude(title) {
  const m = title.match(/[Mm]\s*(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

// Felt-radius anchor table (km), interpolated logarithmically
const EQ_MAG_RADIUS_KM = [
  [0, 1], [1, 3], [2, 8], [3, 18], [4, 55],
  [5, 150], [6, 400], [7, 800], [8, 1500], [9, 2500], [10, 4000],
];
function magnitudeToRadiusM(mag) {
  const m = Math.max(0, Math.min(10, mag));
  for (let i = 1; i < EQ_MAG_RADIUS_KM.length; i++) {
    const [m0, r0] = EQ_MAG_RADIUS_KM[i - 1];
    const [m1, r1] = EQ_MAG_RADIUS_KM[i];
    if (m <= m1) {
      // log-interpolate
      const t = (m - m0) / (m1 - m0);
      return (r0 * Math.pow(r1 / r0, t)) * 1000; // → metres
    }
  }
  return 4000000;
}

function richterLabel(mag) {
  if (mag < 1)  return 'Mikroerdbeben';
  if (mag < 2)  return 'Mikroerdbeben';
  if (mag < 3)  return 'Sehr schwach';
  if (mag < 4)  return 'Schwach';
  if (mag < 5)  return 'Leicht';
  if (mag < 6)  return 'Mäßig';
  if (mag < 7)  return 'Stark';
  if (mag < 8)  return 'Sehr stark';
  if (mag < 9)  return 'Gewaltig';
  if (mag < 10) return 'Extrem – selten';
  return 'Rekordstark';
}

function richterColor(mag) {
  if (mag < 3)  return '#94a3b8';
  if (mag < 4)  return '#facc15';
  if (mag < 5)  return '#fb923c';
  if (mag < 6)  return '#f97316';
  if (mag < 7)  return '#ef4444';
  if (mag < 8)  return '#dc2626';
  return '#9f1239';
}

// ── Storm category ───────────────────────────────────────
function parseStormCategory(title) {
  const m = title.match(/[Cc]ategor[yie]+\s*(\d)/i) ||
            title.match(/[Tt]yphoon|[Cc]yclone|[Hh]urricane/i);
  if (!m) return null;
  if (m[1]) return parseInt(m[1]);
  // Typhoon/Cyclone without number → default Cat 1
  return 1;
}

function stormCategoryRadiusM(cat) {
  return [0, 200, 300, 400, 500, 600][Math.min(5, Math.max(1, cat))] * 1000;
}

function stormCategoryLabel(cat) {
  return ['','Kategorie 1','Kategorie 2','Kategorie 3','Kategorie 4 (Extrem)','Kategorie 5 (Katastrophal)'][Math.min(5, Math.max(1, cat))];
}

// ── Polygon area (Shoelace + spherical correction) ───────
function polygonAreaKm2(ring) {
  if (!ring || ring.length < 3) return null;
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    area += (lng2 - lng1) * (lat2 + lat1);
  }
  const avgLat = ring.reduce((s, c) => s + c[1], 0) / n;
  const kmPerDeg = 111.32;
  return Math.abs(area / 2) * kmPerDeg * kmPerDeg * Math.cos(avgLat * Math.PI / 180);
}

function formatArea(km2) {
  if (km2 >= 1000000) return `${(km2 / 1000000).toFixed(1)} Mio. km²`;
  if (km2 >= 1000)    return `${Math.round(km2 / 1000).toLocaleString('de-DE')} Tsd. km²`;
  return `${Math.round(km2).toLocaleString('de-DE')} km²`;
}

// ── Master event-info resolver ───────────────────────────
// Returns { radiusM, label, sublabel, scaleType, scaleValue, color, areaKm2 }
function getEventInfo(ev) {
  const catId = (ev.categories?.[0]?.id || '').toLowerCase();
  const title =  ev.title || '';

  // Polygon area from geometry
  const polyGeo   = (ev.geometry || []).find(g => g.type === 'Polygon');
  const areaKm2   = polyGeo ? polygonAreaKm2(polyGeo.coordinates[0]) : null;
  const areaRadiusM = areaKm2 ? Math.sqrt(areaKm2 / Math.PI) * 1000 : null;

  if (catId.includes('earthquake')) {
    const mag = parseMagnitude(title);
    if (mag !== null) {
      return {
        radiusM:    magnitudeToRadiusM(mag),
        label:      `M ${mag.toFixed(1)} Richter`,
        sublabel:   richterLabel(mag),
        scaleType:  'richter',
        scaleValue: mag,
        color:      richterColor(mag),
        areaKm2:    null,
      };
    }
    return { radiusM: 40000, label: 'Erdbeben', sublabel: 'Stärke unbekannt', scaleType: 'none', color: '#e879f9' };
  }

  if (catId.includes('wildfire') || catId.includes('fire')) {
    return {
      radiusM:    areaRadiusM || 20000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Waldbrand',
      sublabel:   areaKm2 ? 'Betroffene Fläche (aus Polygon)' : 'Geschätzte Ausdehnung',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#ff4d1a',
      areaKm2,
    };
  }

  if (catId.includes('storm') || catId.includes('cyclone') || catId.includes('hurricane') || catId.includes('typhoon')) {
    const cat = parseStormCategory(title);
    return {
      radiusM:    cat ? stormCategoryRadiusM(cat) : (areaRadiusM || 280000),
      label:      cat ? stormCategoryLabel(cat) : 'Sturm',
      sublabel:   'Wirkungsradius (Windfeld)',
      scaleType:  'storm',
      scaleValue: cat,
      color:      '#facc15',
      areaKm2,
    };
  }

  if (catId.includes('volcano')) {
    return {
      radiusM:    areaRadiusM || 45000,
      label:      'Vulkanausbruch',
      sublabel:   'Gefahren- / Aschefall-Zone',
      scaleType:  'volcano',
      scaleValue: null,
      color:      '#f97316',
      areaKm2,
    };
  }

  if (catId.includes('flood')) {
    return {
      radiusM:    areaRadiusM || 35000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Überflutung',
      sublabel:   areaKm2 ? 'Überflutete Fläche' : 'Geschätzte Fläche',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#60a5fa',
      areaKm2,
    };
  }

  if (catId.includes('sealakeice') || catId.includes('ice')) {
    return {
      radiusM:    areaRadiusM || 150000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Eisformation',
      sublabel:   'Betroffene Eisfläche',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#7dd3fc',
      areaKm2,
    };
  }

  if (catId.includes('dust') || catId.includes('haze')) {
    return {
      radiusM:    areaRadiusM || 200000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Staubwolke',
      sublabel:   'Ausbreitungsgebiet',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#94a3b8',
      areaKm2,
    };
  }

  if (catId.includes('landslide')) {
    return {
      radiusM:    areaRadiusM || 8000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Erdrutsch',
      sublabel:   'Betroffenes Gebiet',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#a78bfa',
      areaKm2,
    };
  }

  if (catId.includes('drought')) {
    return {
      radiusM:    areaRadiusM || 300000,
      label:      areaKm2 ? `~${formatArea(areaKm2)}` : 'Dürre',
      sublabel:   'Betroffene Region',
      scaleType:  'area',
      scaleValue: areaKm2,
      color:      '#ca8a04',
      areaKm2,
    };
  }

  // Fallback
  return {
    radiusM:    areaRadiusM || 25000,
    label:      areaKm2 ? formatArea(areaKm2) : '—',
    sublabel:   'Ereignisgebiet',
    scaleType:  'none',
    scaleValue: null,
    color:      getCatConfig(ev.categories?.[0]?.id).color,
    areaKm2,
  };
}

// ── Scale HTML for detail panel ──────────────────────────
function buildScaleHtml(info) {
  if (info.scaleType === 'richter') {
    const pct = Math.min(100, (info.scaleValue / 10) * 100);
    const col  = info.color;
    return `
      <div class="scale-block">
        <div class="scale-header">
          <span class="scale-value" style="color:${col}">${info.label}</span>
          <span class="scale-desc">${info.sublabel}</span>
        </div>
        <div class="richter-bar">
          <div class="richter-track">
            ${[...Array(10)].map((_, i) =>
              `<div class="richter-seg" style="background:${richterColor(i + 0.5)};opacity:${i < info.scaleValue ? 1 : 0.15}"></div>`
            ).join('')}
          </div>
          <div class="richter-labels"><span>1</span><span>5</span><span>10</span></div>
        </div>
        <div class="scale-radius">📐 Spürbar bis ~${Math.round(info.radiusM / 1000).toLocaleString('de-DE')} km</div>
      </div>`;
  }

  if (info.scaleType === 'storm') {
    const cat = info.scaleValue;
    const cats = [1,2,3,4,5];
    return `
      <div class="scale-block">
        <div class="scale-header">
          <span class="scale-value" style="color:${info.color}">${info.label}</span>
          <span class="scale-desc">${info.sublabel}</span>
        </div>
        ${cat ? `<div class="cat-dots">${cats.map(c =>
          `<div class="cat-dot-item ${c <= cat ? 'active' : ''}" style="background:${c <= cat ? info.color : 'var(--border)'}"></div>`
        ).join('')}</div>` : ''}
        <div class="scale-radius">📐 Windfeld-Radius ~${Math.round(info.radiusM / 1000).toLocaleString('de-DE')} km</div>
      </div>`;
  }

  if (info.scaleType === 'area' && info.areaKm2) {
    return `
      <div class="scale-block">
        <div class="scale-header">
          <span class="scale-value" style="color:${info.color}">${info.label}</span>
          <span class="scale-desc">${info.sublabel}</span>
        </div>
        <div class="scale-radius">📐 Entspricht ~${Math.round(info.radiusM / 1000)} km Radius</div>
      </div>`;
  }

  if (info.scaleType === 'volcano' || info.scaleType === 'none') {
    return `
      <div class="scale-block">
        <div class="scale-header">
          <span class="scale-value" style="color:${info.color}">${info.label}</span>
          <span class="scale-desc">${info.sublabel}</span>
        </div>
        <div class="scale-radius">📐 Radius ~${Math.round(info.radiusM / 1000)} km</div>
      </div>`;
  }

  return '';
}

// ── Globe point size from event info ────────────────────
function getGlobePointRadius(ev) {
  const info = getEventInfo(ev);
  // Richter: 0.2–2.5 units (M3=0.3, M7=1.5, M9=2.5)
  if (info.scaleType === 'richter' && info.scaleValue != null) {
    return Math.max(0.2, Math.min(2.5, info.scaleValue * 0.28));
  }
  // Area-based: sqrt of km² → normalize
  if (info.areaKm2) {
    return Math.max(0.25, Math.min(2.0, Math.sqrt(info.areaKm2) / 200));
  }
  // radius-based
  const rkm = info.radiusM / 1000;
  return Math.max(0.25, Math.min(1.8, Math.sqrt(rkm) / 18));
}
// ── Category config lookup ────────────────────────────
function getCatConfig(id) {
  if (!id) return { label: 'Sonstiges', icon: '🌍', color: '#4ade80' };
  if (CATEGORY_CONFIG[id]) return CATEGORY_CONFIG[id];
  const key = Object.keys(CATEGORY_CONFIG).find(k =>
    id.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(id.toLowerCase())
  );
  return key ? CATEGORY_CONFIG[key] : { label: id, icon: '🌍', color: '#4ade80' };
}

// ── Themes ───────────────────────────────────────────────
const THEMES = {
  dark: {
    label: 'Dark',
    icon: '🌑',
    tileKey: 'dark',
    vars: {
      '--bg': '#080c12', '--surface': '#0e1520', '--surface2': '#131d2e',
      '--border': '#1e2d45', '--accent': '#4ade80', '--accent2': '#22d3ee',
      '--text': '#e2e8f0', '--text-muted': '#64748b',
    },
    tileFilter: 'brightness(0.85) saturate(0.7) hue-rotate(200deg)',
  },
  light: {
    label: 'Light',
    icon: '☀️',
    tileKey: 'light',
    vars: {
      '--bg': '#f1f5f9', '--surface': '#ffffff', '--surface2': '#f8fafc',
      '--border': '#cbd5e1', '--accent': '#16a34a', '--accent2': '#0891b2',
      '--text': '#0f172a', '--text-muted': '#64748b',
    },
    tileFilter: 'brightness(1.05) saturate(0.9)',
  },
  midnight: {
    label: 'Midnight',
    icon: '🌌',
    tileKey: 'dark',
    vars: {
      '--bg': '#0b0d1a', '--surface': '#10132a', '--surface2': '#151836',
      '--border': '#252850', '--accent': '#818cf8', '--accent2': '#c084fc',
      '--text': '#e2e8f0', '--text-muted': '#6b7280',
    },
    tileFilter: 'brightness(0.75) saturate(0.6) hue-rotate(240deg)',
  },
  hacker: {
    label: 'Hacker',
    icon: '💻',
    tileKey: 'dark',
    vars: {
      '--bg': '#000000', '--surface': '#0a0a0a', '--surface2': '#111111',
      '--border': '#1a3a1a', '--accent': '#00ff41', '--accent2': '#00cc33',
      '--text': '#ccffcc', '--text-muted': '#3a7a3a',
    },
    tileFilter: 'brightness(0.6) saturate(0) hue-rotate(90deg)',
  },
};

// ── NASA GIBS date helper (kept for potential future use) ────
function getGibsDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Tile layers ──────────────────────────────────────────
const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    opts: { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 },
    useThemeFilter: true,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 },
    useThemeFilter: true,
  },
  normal: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opts: { attribution: '© CARTO / OSM', subdomains: 'abcd', maxZoom: 19 },
    useThemeFilter: false,
  },
  // FIX: GIBS had CORS block in Electron → Esri World Imagery is reliable & free
  // Add Esri label overlay so country names stay visible on satellite view
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { attribution: '© Esri World Imagery', maxZoom: 19 },
    useThemeFilter: false,
    ownFilter: 'brightness(1.02) contrast(1.06) saturate(1.08)',
    // second layer URL for labels on top
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: { attribution: '© OpenTopoMap', subdomains: 'abc', maxZoom: 17 },
    useThemeFilter: false,
    ownFilter: 'brightness(0.95) saturate(0.85)',
  },
};

// ── State ────────────────────────────────────────────────
let allEvents        = [];
let filteredEvents   = [];
let activeCategories = new Set();
let userDeselected   = new Set();
let activeDays       = 7;
let statusFilter     = 'all';   // 'all' | 'open' | 'closed'
let sortMode         = 'date-desc'; // 'date-desc' | 'date-asc' | 'category'
let markers          = [];
let polygons         = [];
let map;
let currentTileLayer = null;
let activeThemeKey   = 'dark';
let activeTileMapKey = 'dark';
let selectedEventId  = null;
let searchQuery      = '';
let sidebarCollapsed = false;
let lastLoadedIds    = new Set();
let lastUpdated      = null;
let globeInstance    = null;
let globeActive      = false;

// BUG FIX: flag to prevent marker click from immediately re-closing the panel
let suppressNextMapClick = false;

// ── Init Map ─────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom: 3,
    minZoom: 2,
    maxZoom: 14,
    zoomControl: true,
    // FIX: snap back to primary world copy when scrolling infinitely left/right
    // so markers always appear regardless of how far you've panned
    worldCopyJump: true,
  });

  // BUG FIX: only close panel when click is NOT suppressed
  map.on('click', () => {
    if (suppressNextMapClick) { suppressNextMapClick = false; return; }
    hideDetailPanel();
  });

  // FIX: worldCopyJump teleport causes a brief black flash because the CSS
  // filter transition on .leaflet-tile-pane fights the instant position change.
  // Solution: freeze the transition around the jump.
  map.on('worldcopyjump', () => {
    const pane = document.querySelector('.leaflet-tile-pane');
    if (!pane) return;
    const saved = pane.style.transition;
    pane.style.transition = 'none';           // kill transition instantly
    
    // Using setTimeout gives the browser enough time to complete the
    // layout shift and repaint before we turn the transition back on.
    setTimeout(() => {
        pane.style.transition = saved;
    }, 150); 
  });

  applyTheme('dark', true);
}

// ── Theme system ─────────────────────────────────────────
function applyTheme(key, init = false) {
  const theme = THEMES[key];
  if (!theme) return;
  activeThemeKey = key;

  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  document.body.dataset.theme = key;

  // Update theme buttons
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === key)
  );

  // BUG FIX: get the currently active map style (not the theme's default tileKey)
  // so switching themes doesn't reset a manually chosen satellite/terrain/normal view
  const activeTileStyle = init
    ? theme.tileKey
    : (document.querySelector('.map-style-btn.active')?.dataset.style || theme.tileKey);

  // Pass the theme filter — setTileLayer will only apply it if the tile uses theme filters
  setTileLayer(activeTileStyle, theme.tileFilter);
}

// ── Map tile layers ──────────────────────────────────────
let labelTileLayer = null; // extra label overlay (used for satellite mode)

function setTileLayer(key, filterOverride) {
  const cfg = TILE_LAYERS[key];
  if (!cfg) return;

  if (currentTileLayer) map.removeLayer(currentTileLayer);
  if (labelTileLayer)   { map.removeLayer(labelTileLayer); labelTileLayer = null; }

  currentTileLayer = L.tileLayer(cfg.url, cfg.opts).addTo(map);
  activeTileMapKey = key;

  // Add label overlay for satellite so country borders/names stay visible
  if (cfg.labelUrl) {
    labelTileLayer = L.tileLayer(cfg.labelUrl, { opacity: 0.75, maxZoom: 19 }).addTo(map);
  }

  const resolveFilter = () => {
    if (cfg.useThemeFilter) {
      return filterOverride || THEMES[activeThemeKey]?.tileFilter || '';
    }
    return cfg.ownFilter || '';
  };

  const applyFilter = () => {
    const pane = document.querySelector('.leaflet-tile-pane');
    if (pane) {
      pane.style.filter = resolveFilter();
      pane.style.transition = 'filter 0.5s ease';
    }
  };
  currentTileLayer.once('load', applyFilter);
  setTimeout(applyFilter, 100);

  document.querySelectorAll('.map-style-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.style === key)
  );
}

// ── EONET Fetch ──────────────────────────────────────────
async function fetchEONET(days = 7) {
  showListLoading();
  try {
    const res = await fetch(`${EONET_BASE}/events?days=${days}&status=all&limit=500`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.error('EONET fetch error:', err);
    showListError();
    return [];
  }
}

// ── Category filters ─────────────────────────────────────
function buildCategoryFilters(events) {
  const cats = {};
  events.forEach(ev =>
    (ev.categories || []).forEach(c => {
      if (!cats[c.id]) cats[c.id] = { count: 0, ...getCatConfig(c.id) };
      cats[c.id].count++;
    })
  );

  activeCategories = new Set(Object.keys(cats).filter(id => !userDeselected.has(id)));

  const container = document.getElementById('category-filters');
  container.innerHTML = '';

  const shortcuts = document.createElement('div');
  shortcuts.className = 'cat-shortcuts';
  shortcuts.innerHTML =
    `<button class="cat-shortcut" id="cat-all">Alle</button>
     <button class="cat-shortcut" id="cat-none">Keine</button>`;
  container.appendChild(shortcuts);

  document.getElementById('cat-all').onclick = () => {
    userDeselected.clear();
    activeCategories = new Set(Object.keys(cats));
    container.querySelectorAll('.cat-btn').forEach(b => b.classList.add('active'));
    applyFilters();
  };
  document.getElementById('cat-none').onclick = () => {
    userDeselected = new Set(Object.keys(cats));
    activeCategories.clear();
    container.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    applyFilters();
  };

  Object.entries(cats)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([id, cfg]) => {
      const active = activeCategories.has(id);
      const btn = document.createElement('button');
      btn.className = 'cat-btn' + (active ? ' active' : '');
      btn.dataset.catId = id;
      btn.title = cfg.label;
      btn.innerHTML =
        `<span class="cat-dot" style="background:${cfg.color}"></span>`
      + `<span class="cat-icon">${cfg.icon}</span>`
      + `<span class="cat-count">${cfg.count}</span>`;
      btn.addEventListener('click', () => {
        if (activeCategories.has(id)) {
          activeCategories.delete(id); userDeselected.add(id); btn.classList.remove('active');
        } else {
          activeCategories.add(id); userDeselected.delete(id); btn.classList.add('active');
        }
        applyFilters();
      });
      container.appendChild(btn);
    });
}

// ── Filters ──────────────────────────────────────────────
function applyFilters() {
  filteredEvents = allEvents.filter(ev => {
    const cats = (ev.categories || []).map(c => c.id);
    if (!cats.some(c => activeCategories.has(c))) return false;
    if (searchQuery && !ev.title.toLowerCase().includes(searchQuery)) return false;
    if (statusFilter === 'open'   && ev.closed !== null) return false;
    if (statusFilter === 'closed' && ev.closed === null) return false;
    return true;
  });
  renderMarkers();
  renderEventList();
  updateStats();
  if (globeActive) updateGlobePoints();
}

// ── Stats ────────────────────────────────────────────────
function updateStats() {
  document.getElementById('total-count').textContent = filteredEvents.length;
  document.getElementById('open-count').textContent  = filteredEvents.filter(e => e.closed === null).length;
  if (lastUpdated) {
    document.getElementById('last-updated').textContent =
      'Stand: ' + lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
}

// ── Geometry helpers ─────────────────────────────────────
function getGeometryCentroid(geo) {
  if (!geo) return null;
  if (geo.type === 'Point') {
    const [lng, lat] = geo.coordinates;
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
  }
  if (geo.type === 'Polygon') {
    const ring = geo.coordinates[0];
    if (!ring?.length) return null;
    let slat = 0, slng = 0;
    ring.forEach(([lng, lat]) => { slat += lat; slng += lng; });
    return { lat: slat / ring.length, lng: slng / ring.length };
  }
  if (geo.type === 'LineString') {
    const mid = Math.floor(geo.coordinates.length / 2);
    const [lng, lat] = geo.coordinates[mid];
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
  }
  return null;
}

function getLatestGeo(ev) {
  const valid = (ev.geometry || []).filter(g => getGeometryCentroid(g) !== null);
  if (!valid.length) return null;
  return valid.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
}

// ── Markers + Polygon overlays ────────────────────────────
function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  polygons.forEach(p => map.removeLayer(p));
  markers = [];
  polygons = [];

  filteredEvents.forEach(ev => {
    const cfg    = getCatConfig(ev.categories?.[0]?.id);
    const isOpen = ev.closed === null;

    // Polygon overlays
    (ev.geometry || []).forEach(geo => {
      if (geo.type !== 'Polygon') return;
      const latlngs = geo.coordinates[0].map(([lng, lat]) => [lat, lng]);
      const poly = L.polygon(latlngs, {
        color: cfg.color, fillColor: cfg.color,
        fillOpacity: 0.12, weight: 1.5, opacity: 0.45,
      });
      poly.on('click', e => {
        // BUG FIX: suppress the map click that follows
        suppressNextMapClick = true;
        L.DomEvent.stopPropagation(e);
        const c = getGeometryCentroid(geo);
        if (c) showDetailPanel(ev, c.lat, c.lng);
        highlightListItem(ev.id);
      });
      poly.addTo(map);
      polygons.push(poly);
    });

    const geo = getLatestGeo(ev);
    if (!geo) return;
    const center = getGeometryCentroid(geo);
    if (!center) return;
    const { lat, lng } = center;

    // ── Area circle (scaled to event magnitude / size) ──
    const info = getEventInfo(ev);
    const areaCircle = L.circle([lat, lng], {
      radius:      info.radiusM,
      color:       info.color,
      fillColor:   info.color,
      fillOpacity: isOpen ? 0.06 : 0.03,
      weight:      isOpen ? 1.2 : 0.6,
      opacity:     isOpen ? 0.35 : 0.18,
      dashArray:   '5, 6',
      interactive: false,  // don't intercept clicks — marker handles that
    });
    areaCircle.addTo(map);
    polygons.push(areaCircle);

    const el = document.createElement('div');
    el.className = 'event-marker';
    el.innerHTML =
      `<div class="marker-pulse" style="background:${cfg.color};`
    + `animation-delay:${Math.random()*2}s;`
    + `animation-duration:${isOpen ? '2s' : '4s'}"></div>`
    + `<div class="marker-core" style="background:${cfg.color};`
    + `box-shadow:0 0 8px ${cfg.color}88;`
    + `opacity:${isOpen ? 1 : 0.55};`
    + `width:${isOpen ? '12px' : '9px'};height:${isOpen ? '12px' : '9px'}"></div>`;

    const icon = L.divIcon({ html: el.outerHTML, className: '', iconSize: [24,24], iconAnchor: [12,12] });
    const marker = L.marker([lat, lng], { icon });

    const dateStr = geo.date
      ? new Date(geo.date).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'numeric' })
      : 'Unbekannt';

    marker.bindPopup(
      `<div class="popup-inner">
        <div class="popup-cat">${cfg.icon} ${cfg.label}</div>
        <div class="popup-title">${escapeHtml(ev.title)}</div>
        <div class="popup-date">📅 ${dateStr}</div>
        <div><span class="popup-status ${isOpen ? 'open' : 'closed'}">${isOpen ? '● AKTIV' : '○ GESCHLOSSEN'}</span></div>
       </div>`,
      { maxWidth: 240, closeButton: false }
    );

    marker.on('click', e => {
      // BUG FIX: set flag BEFORE stopPropagation so map-click handler sees it
      suppressNextMapClick = true;
      L.DomEvent.stopPropagation(e);
      showDetailPanel(ev, lat, lng);
      highlightListItem(ev.id);
    });

    marker.addTo(map);
    markers.push(marker);
  });
}

// ── Sort helpers ─────────────────────────────────────────
function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (sortMode === 'date-desc' || sortMode === 'date-asc') {
      // Always put open events first within same date direction
      if ((a.closed === null) !== (b.closed === null)) return a.closed === null ? -1 : 1;
      const da = new Date(getLatestGeo(a)?.date || 0);
      const db = new Date(getLatestGeo(b)?.date || 0);
      return sortMode === 'date-desc' ? db - da : da - db;
    }
    if (sortMode === 'category') {
      const ca = getCatConfig(a.categories?.[0]?.id).label;
      const cb = getCatConfig(b.categories?.[0]?.id).label;
      return ca.localeCompare(cb, 'de');
    }
    return 0;
  });
}

// ── Event List ───────────────────────────────────────────
function renderEventList() {
  const list = document.getElementById('event-list');
  list.innerHTML = '';

  if (!filteredEvents.length) {
    list.innerHTML = '<div class="error-msg"><span class="emoji">🔍</span>Keine Events gefunden</div>';
    return;
  }

  sortEvents(filteredEvents).forEach(ev => {
    const cfg    = getCatConfig(ev.categories?.[0]?.id);
    const isOpen = ev.closed === null;
    const geo    = getLatestGeo(ev);
    const date   = geo?.date
      ? new Date(geo.date).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'numeric' })
      : '—';

    const item = document.createElement('div');
    item.className = 'event-item' + (ev.id === selectedEventId ? ' highlighted' : '');
    item.dataset.eventId = ev.id;
    item.innerHTML =
      `<div class="event-icon">${cfg.icon}</div>
       <div class="event-info">
         <div class="event-name">${escapeHtml(ev.title)}</div>
         <div class="event-meta">${date} · ${cfg.label}</div>
       </div>
       <div class="event-status ${isOpen ? 'open' : 'closed'}">${isOpen ? 'AKTIV' : 'ARCH'}</div>`;

    item.addEventListener('click', () => {
      const c = geo ? getGeometryCentroid(geo) : null;
      if (c) {
        map.setView([c.lat, c.lng], 7, { animate: true });
        showDetailPanel(ev, c.lat, c.lng);
        highlightListItem(ev.id);
      }
    });
    list.appendChild(item);
  });
}

function highlightListItem(id) {
  selectedEventId = id;
  document.querySelectorAll('.event-item').forEach(el =>
    el.classList.toggle('highlighted', el.dataset.eventId === id)
  );
  const el = document.querySelector(`[data-event-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Detail Panel ─────────────────────────────────────────
function showDetailPanel(ev, lat, lng) {
  selectedEventId = ev.id;
  const cfg    = getCatConfig(ev.categories?.[0]?.id);
  const isOpen = ev.closed === null;
  const geo    = getLatestGeo(ev);
  const date   = geo?.date
    ? new Date(geo.date).toLocaleDateString('de-DE',
        { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  document.getElementById('detail-category').textContent = `${cfg.icon} ${cfg.label}`;
  document.getElementById('detail-title').textContent    = ev.title;
  document.getElementById('detail-date').textContent     = `📅 ${date}`;
  document.getElementById('detail-coords').textContent   = `📍 ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

  const statusEl = document.getElementById('detail-status');
  statusEl.textContent = isOpen ? '● AKTIV' : '○ GESCHLOSSEN';
  statusEl.className   = `detail-status ${isOpen ? 'open' : 'closed'}`;

  // Scale / magnitude block
  const info = getEventInfo(ev);
  document.getElementById('detail-scale').innerHTML = buildScaleHtml(info);

  document.getElementById('detail-link').href =
    ev.link || `https://eonet.gsfc.nasa.gov/api/v3/events/${ev.id}`;

  document.getElementById('detail-flyto').onclick = () =>
    map.flyTo([lat, lng], 8, { duration: 1.5 });

  document.getElementById('detail-copy-coords').onclick = () => {
    const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(coordStr).then(() => showToast('📍 Koordinaten kopiert!'));
    } else {
      // Fallback for non-HTTPS (shouldn't happen on GitHub Pages)
      const ta = document.createElement('textarea');
      ta.value = coordStr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📍 Koordinaten kopiert!');
    }
  };

  const srcEl = document.getElementById('detail-sources');
  if (ev.sources?.length) {
    srcEl.innerHTML = ev.sources.map(s =>
      `<a class="source-link" href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.id)} ↗</a>`
    ).join('');
    srcEl.style.display = 'flex';
  } else {
    srcEl.style.display = 'none';
  }

  document.getElementById('detail-panel').classList.add('visible');
}

function hideDetailPanel() {
  document.getElementById('detail-panel').classList.remove('visible');
  selectedEventId = null;
  document.querySelectorAll('.event-item').forEach(el => el.classList.remove('highlighted'));
}

document.getElementById('detail-close').addEventListener('click', hideDetailPanel);

// ── Sidebar toggle ───────────────────────────────────────
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  setTimeout(() => map.invalidateSize(), 320);
});

// ── Map style buttons ────────────────────────────────────
// BUG FIX: removed redundant .active class update from listener;
// setTileLayer() already centralises this, so no duplication needed.
document.querySelectorAll('.map-style-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    setTileLayer(btn.dataset.style);
  })
);

// ── Theme buttons ────────────────────────────────────────
document.querySelectorAll('.theme-btn').forEach(btn =>
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
);

// ── Status filter ────────────────────────────────────────
document.querySelectorAll('.status-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    statusFilter = btn.dataset.status;
    applyFilters();
  })
);

// ── Sort control ─────────────────────────────────────────
document.getElementById('sort-select').addEventListener('change', e => {
  sortMode = e.target.value;
  renderEventList();
});

// ── Search ───────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim().toLowerCase();
  applyFilters();
});

// ── Day selector ─────────────────────────────────────────
document.querySelectorAll('.day-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeDays = parseInt(btn.dataset.days);
    loadData();
  })
);

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') hideDetailPanel();
  if (e.key === 'r' || e.key === 'R') loadData();
  if (e.key === 'g' || e.key === 'G') toggleGlobe();
  if (e.key === 's' || e.key === 'S') {
    sidebarCollapsed = !sidebarCollapsed;
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    setTimeout(() => map.invalidateSize(), 320);
  }
  if (e.key === '1') applyTheme('dark');
  if (e.key === '2') applyTheme('light');
  if (e.key === '3') applyTheme('midnight');
  if (e.key === '4') applyTheme('hacker');
});

// ── Loading / Error ───────────────────────────────────────
function showListLoading() {
  document.getElementById('event-list').innerHTML =
    `<div class="loading-spinner"><div class="spinner"></div><span>Lade NASA EONET…</span></div>`;
  document.getElementById('total-count').textContent = '—';
  document.getElementById('open-count').textContent  = '—';
}

function showListError() {
  document.getElementById('event-list').innerHTML =
    `<div class="error-msg">
       <span class="emoji">⚠️</span>
       Fehler beim Laden.<br>Verbindung prüfen.
       <br><button class="retry-btn" id="retry-btn">↻ Nochmal</button>
     </div>`;
  document.getElementById('retry-btn')?.addEventListener('click', loadData);
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Main load ─────────────────────────────────────────────
async function loadData(isAutoRefresh = false) {
  // BUG FIX: don't close panel during auto-refresh if user has one open
  if (!isAutoRefresh) hideDetailPanel();

  const events = await fetchEONET(activeDays);
  if (!events.length) return;

  // Detect new events since last load
  if (isAutoRefresh && lastLoadedIds.size) {
    const newCount = events.filter(e => !lastLoadedIds.has(e.id)).length;
    if (newCount > 0) showToast(`🔔 ${newCount} neue Events entdeckt`, 3500);
  }

  lastLoadedIds = new Set(events.map(e => e.id));
  allEvents     = events;
  lastUpdated   = new Date();

  buildCategoryFilters(events);
  applyFilters();

  if (!isAutoRefresh) {
    showToast(`${events.length} Events · ${events.filter(e => e.closed === null).length} aktiv`);
  }
}

// ── Globe ─────────────────────────────────────────────────
let globeSpinRAF    = null;
let spinVelocity    = { x: 0, y: 0.15 };
let isDragging      = false;
let isTransitioning = false;   // prevents double-triggering the zoom-to-map switch

// Distance (Three.js units, globe radius ≈ 100) at which we switch to 2D map
const GLOBE_SWITCH_DIST = 155;

// Converts Three.js camera position → {lat, lng}, accounting for scene rotation
function getGlobeCenterCoords() {
  try {
    const cam   = globeInstance.camera();
    const scene = globeInstance.scene();
    // Vector from globe center toward camera = the point on globe facing camera
    const camDir = cam.position.clone().normalize();
    // Undo scene rotation (our spin rotates the globe mesh, not the camera)
    const invQuat = scene.quaternion.clone().invert();
    camDir.applyQuaternion(invQuat);
    // globe.gl sphere: y=sin(lat), x=cos(lat)*sin(lng), z=cos(lat)*cos(lng)
    const lat = Math.asin(Math.max(-1, Math.min(1, camDir.y))) * 180 / Math.PI;
    const lng = Math.atan2(-camDir.x, -camDir.z) * 180 / Math.PI;
    return { lat, lng };
  } catch (e) {
    return { lat: 20, lng: 0 };
  }
}

// Converts camera distance to a sensible Leaflet zoom level
function distToMapZoom(dist) {
  // dist 800→z2, 400→z3, 200→z4, 150→z5, 120→z6 (rough log scale)
  return Math.round(Math.max(2, Math.min(8, 16 - Math.log2(Math.max(dist - 98, 1)) * 1.8)));
}

// The actual globe→map transition: animates zoom-in, then fades to Leaflet
function triggerGlobeToMapTransition() {
  if (isTransitioning) return;
  isTransitioning = true;

  const { lat, lng } = getGlobeCenterCoords();
  const dist         = globeInstance.camera().position.distanceTo(globeInstance.controls().target);
  const zoom         = distToMapZoom(dist);

  // Kill spin so it doesn't fight the animation
  spinVelocity = { x: 0, y: 0 };

  // 1. Animate camera quickly to near-surface
  const cam    = globeInstance.camera();
  const ctrl   = globeInstance.controls();
  const target = ctrl.target.clone();
  const startDist = cam.position.distanceTo(target);
  const endDist   = 103;
  const startTime = performance.now();
  const duration  = 520; // ms

  const zoomAnim = () => {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    // ease-in quad
    const e = t * t;
    const d = startDist + (endDist - startDist) * e;
    const dir = cam.position.clone().sub(target).normalize();
    cam.position.copy(dir.multiplyScalar(d));
    ctrl.update();
    if (t < 1) {
      requestAnimationFrame(zoomAnim);
    } else {
      // 2. After zoom anim, cross-fade to map
      crossfadeGlobeToMap(lat, lng, zoom);
    }
  };
  requestAnimationFrame(zoomAnim);
}

function crossfadeGlobeToMap(lat, lng, zoom) {
  const container = document.getElementById('globe-container');
  const mapEl     = document.getElementById('map');
  const btn       = document.getElementById('globe-toggle');
  const styleBar  = document.querySelector('.map-style-bar');

  // Pre-position map before showing it
  map.setView([lat, lng], zoom, { animate: false });

  // Fade globe out, map in simultaneously
  container.style.transition = 'opacity 0.45s ease';
  container.style.opacity    = '0';

  mapEl.style.transition   = 'opacity 0.45s ease';
  mapEl.style.opacity      = '1';
  mapEl.style.pointerEvents = '';
  styleBar.style.opacity   = '1';
  styleBar.style.pointerEvents = '';
  btn.classList.remove('active');

  setTimeout(() => {
    container.classList.add('globe-hidden');
    container.style.transition = '';
    container.style.opacity    = '';
    map.invalidateSize();

    // Reset globe so next open starts fresh
    if (globeSpinRAF) { cancelAnimationFrame(globeSpinRAF); globeSpinRAF = null; }
    globeInstance    = null;
    globeActive      = false;
    isTransitioning  = false;

    showToast(`🗺️ Karte: ${lat.toFixed(2)}°, ${lng.toFixed(2)}°`);
  }, 460);
}

function initGlobe() {
  if (globeInstance) return;
  isTransitioning = false;

  const container = document.getElementById('globe-container');

  globeInstance = Globe({ animateIn: true })(container)
    // Use jsDelivr CDN (global CDN, verified CORS support, pinned version)
    .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/earth-topology.png')
    .backgroundImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4ade80')
    .atmosphereAltitude(0.15)
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(d => d.color)
    .pointAltitude(d => d.isOpen ? 0.04 : 0.01)
    .pointRadius(d => d.globeRadius || (d.isOpen ? 0.5 : 0.3))
    .pointResolution(10)
    .pointLabel(d =>
      `<div style="background:#0e1520ee;border:1px solid #1e2d45;border-radius:5px;padding:9px 13px;
        font-family:'Space Mono',monospace;font-size:11px;color:#e2e8f0;min-width:170px;
        box-shadow:0 8px 24px rgba(0,0,0,0.6)">
        <div style="font-size:9px;letter-spacing:2px;color:#64748b;margin-bottom:4px">${d.icon} ${d.catLabel}</div>
        <div style="font-weight:700;margin-bottom:5px;line-height:1.35;font-family:'Syne',sans-serif">${d.title}</div>
        <div style="font-size:9px;color:${d.isOpen ? '#4ade80' : '#64748b'}">${d.isOpen ? '● AKTIV' : '○ GESCHLOSSEN'}</div>
      </div>`
    )
    .onPointClick(d => {
      showDetailPanel(d.event, d.lat, d.lng);
      highlightListItem(d.event.id);
    });

  // ── Controls ─────────────────────────────────────────
  const ctrl = globeInstance.controls();
  ctrl.enableZoom    = true;
  ctrl.zoomSpeed     = 1.1;
  ctrl.minDistance   = 102;   // just above surface; transition triggers before this
  ctrl.maxDistance   = 800;
  ctrl.enableDamping = true;
  ctrl.dampingFactor = 0.04;
  ctrl.rotateSpeed   = 0.6;
  ctrl.autoRotate    = false;
  ctrl.enablePan     = false;

  // ── Spin physics loop ────────────────────────────────
  let lastTime       = 0;
  let pointerHistory = [];

  const spinLoop = (ts) => {
    globeSpinRAF = requestAnimationFrame(spinLoop);

    if (!isDragging && !isTransitioning) {
      const scene   = globeInstance.scene();
      const elapsed = Math.min((ts - lastTime) / 16.67, 3);
      lastTime = ts;

      spinVelocity.y *= Math.pow(0.972, elapsed);
      spinVelocity.x *= Math.pow(0.972, elapsed);

      scene.rotation.y += (spinVelocity.y * elapsed * Math.PI) / 180;
      scene.rotation.x  = Math.max(-0.4, Math.min(0.4,
        scene.rotation.x + (spinVelocity.x * elapsed * Math.PI) / 180
      ));

      ctrl.update();
    }

    // ── Zoom-to-map threshold check ───────────────────
    if (!isTransitioning && globeInstance) {
      const dist = globeInstance.camera().position.distanceTo(ctrl.target);
      if (dist < GLOBE_SWITCH_DIST) {
        triggerGlobeToMapTransition();
      }
    }
  };
  globeSpinRAF = requestAnimationFrame(spinLoop);

  // ── Drag → release velocity ───────────────────────
  const canvas = container.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', e => {
      if (isTransitioning) return;
      isDragging = true;
      pointerHistory = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    });
    canvas.addEventListener('pointermove', e => {
      if (!isDragging) return;
      const now = performance.now();
      pointerHistory.push({ x: e.clientX, y: e.clientY, t: now });
      pointerHistory = pointerHistory.filter(p => now - p.t < 80);
    });
    const onRelease = () => {
      if (!isDragging) return;
      isDragging = false;
      if (pointerHistory.length >= 2) {
        const a = pointerHistory[0];
        const b = pointerHistory[pointerHistory.length - 1];
        const dt = (b.t - a.t) || 1;
        spinVelocity.y = ((b.x - a.x) / dt) * 16.67 * 0.08;
        spinVelocity.x = ((b.y - a.y) / dt) * 16.67 * 0.04;
      } else {
        spinVelocity = { x: 0, y: 0 };
      }
      pointerHistory = [];
      lastTime = performance.now();
    };
    canvas.addEventListener('pointerup',     onRelease);
    canvas.addEventListener('pointercancel', onRelease);
    canvas.addEventListener('pointerleave',  onRelease);
  }

  // ── +/− zoom buttons ────────────────────────────────
  const zoomIn  = document.getElementById('globe-zoom-in');
  const zoomOut = document.getElementById('globe-zoom-out');
  if (zoomIn && zoomOut) {
    const stepZoom = dir => {
      if (isTransitioning) return;
      const cam    = globeInstance.camera();
      const target = ctrl.target;
      const dir3   = cam.position.clone().sub(target).normalize();
      const dist   = cam.position.distanceTo(target);
      const step   = dist * 0.2 * dir;
      const newPos = cam.position.clone().addScaledVector(dir3, step);
      const newDist = newPos.distanceTo(target);
      if (newDist > ctrl.maxDistance) return;
      // Let threshold check in spinLoop handle the switch naturally
      if (newDist < ctrl.minDistance) { triggerGlobeToMapTransition(); return; }
      cam.position.copy(newPos);
      ctrl.update();
    };
    zoomIn.addEventListener('click',  () => stepZoom(-1));
    zoomOut.addEventListener('click', () => stepZoom( 1));
  }
}

function updateGlobePoints() {
  if (!globeInstance) return;
  const points = filteredEvents.flatMap(ev => {
    const geo = getLatestGeo(ev);
    const c   = geo ? getGeometryCentroid(geo) : null;
    if (!c) return [];
    const cfg = getCatConfig(ev.categories?.[0]?.id);
    return [{
      lat: c.lat, lng: c.lng,
      color: cfg.color,
      isOpen: ev.closed === null,
      title: ev.title,
      icon: cfg.icon,
      catLabel: cfg.label,
      globeRadius: getGlobePointRadius(ev),
      event: ev,
    }];
  });
  globeInstance.pointsData(points);
}

function toggleGlobe() {
  if (isTransitioning) return;
  globeActive = !globeActive;
  const container = document.getElementById('globe-container');
  const mapEl     = document.getElementById('map');
  const btn       = document.getElementById('globe-toggle');
  const styleBar  = document.querySelector('.map-style-bar');

  if (globeActive) {
    initGlobe();
    container.classList.remove('globe-hidden');
    container.style.opacity      = '';
    mapEl.style.opacity          = '0';
    mapEl.style.pointerEvents    = 'none';
    styleBar.style.opacity       = '0';
    styleBar.style.pointerEvents = 'none';
    btn.classList.add('active');
    updateGlobePoints();
    spinVelocity = { x: 0, y: 0.12 };
  } else {
    // Manual close
    if (globeSpinRAF) { cancelAnimationFrame(globeSpinRAF); globeSpinRAF = null; }
    container.classList.add('globe-hidden');
    mapEl.style.opacity       = '1';
    mapEl.style.pointerEvents = '';
    styleBar.style.opacity    = '1';
    styleBar.style.pointerEvents = '';
    btn.classList.remove('active');
    globeInstance = null;
    map.invalidateSize();
  }
}

document.getElementById('globe-toggle').addEventListener('click', toggleGlobe);

// ── Boot ──────────────────────────────────────────────────
initMap();
loadData(false);

// Auto-refresh — pass true so panel stays open
setInterval(() => loadData(true), 10 * 60 * 1000);
