const ROESSLER = { name: "Roessler Hall, UC Davis", lat: 38.5370688, lon: -121.751826 };
const DEFAULTS = { enabled: true, latitude: ROESSLER.lat, longitude: ROESSLER.lon, accuracy: 15, places: [ROESSLER] };
const TILE = 256;
const $ = (id) => document.getElementById(id);

let state = { ...DEFAULTS };
let cur = { lat: DEFAULTS.latitude, lon: DEFAULTS.longitude };
let zoom = 17;

const fmt = (n) => Number(n).toFixed(6);
const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
const valid = (p) => p && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// --- Parsing -----------------------------------------------------------------

const NUM = "(-?\\d+(?:\\.\\d+)?)";

function parseCoords(input) {
  const s = input.trim();
  if (!s) return null;
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),                          // Google Maps place data
    new RegExp(`@${NUM},${NUM}`),                              // Google Maps @lat,lon
    new RegExp(`[?&#](?:q|query|ll|center|map=\\d+/)=?${NUM}[,/]\\s*${NUM}`), // ?q=lat,lon, OSM #map=z/lat/lon
    new RegExp(`^\\(?\\s*${NUM}\\s*[,;\\s]\\s*${NUM}\\s*\\)?$`), // plain "lat, lon"
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  // DMS / decimal with hemispheres: 38°32'13.4"N 121°45'06.6"W  or  38.537 N, 121.75 W
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|'')\s*)?([NSEW])/gi)];
  if (parts.length === 2) {
    const out = {};
    for (const [, d, m = 0, sec = 0, h] of parts) {
      let v = +d + m / 60 + sec / 3600;
      if (/[SW]/i.test(h)) v = -v;
      out[/[NS]/i.test(h) ? "lat" : "lon"] = v;
    }
    if ("lat" in out && "lon" in out) return out;
  }
  return null;
}

// --- Map ---------------------------------------------------------------------

function project(lat, lon, z) {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    lon: (x / n) * 360 - 180,
  };
}

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const tileUrl = (z, x, y) =>
  `https://${"abcd"[(x + y) % 4]}.basemaps.cartocdn.com/${dark ? "dark_all" : "rastertiles/voyager"}/${z}/${x}/${y}@2x.png`;

function viewport() {
  const el = $("map");
  const w = el.clientWidth, h = el.clientHeight;
  const c = project(cur.lat, cur.lon, zoom);
  return { w, h, left: c.x - w / 2, top: c.y - h / 2 };
}

function renderMap() {
  const { w, h, left, top } = viewport();
  const max = 2 ** zoom;
  const frag = document.createDocumentFragment();
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
    if (ty < 0 || ty >= max) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      const img = new Image();
      img.src = tileUrl(zoom, ((tx % max) + max) % max, ty);
      img.style.left = `${tx * TILE - left}px`;
      img.style.top = `${ty * TILE - top}px`;
      img.alt = "";
      frag.appendChild(img);
    }
  }
  $("tiles").replaceChildren(frag);

  const metersPerPx = (156543.03392 * Math.cos((cur.lat * Math.PI) / 180)) / 2 ** zoom;
  const d = Math.max(10, (2 * (Number($("accuracy").value) || 0)) / metersPerPx);
  Object.assign($("radius").style, { width: `${d}px`, height: `${d}px` });
  $("map").classList.toggle("disabled", !$("enabled").checked);
}

$("map").addEventListener("click", (e) => {
  if (e.target.closest(".zoom")) return;
  const rect = $("map").getBoundingClientRect();
  const { left, top } = viewport();
  setCurrent(unproject(left + e.clientX - rect.left, top + e.clientY - rect.top, zoom));
});
$("zoomIn").addEventListener("click", () => { zoom = Math.min(19, zoom + 1); renderMap(); });
$("zoomOut").addEventListener("click", () => { zoom = Math.max(3, zoom - 1); renderMap(); });
$("map").addEventListener("wheel", (e) => {
  e.preventDefault();
  zoom = Math.max(3, Math.min(19, zoom + (e.deltaY < 0 ? 1 : -1)));
  renderMap();
}, { passive: false });

// --- UI ----------------------------------------------------------------------

function setCurrent(p, { fromInput = false } = {}) {
  cur = { lat: p.lat, lon: p.lon };
  if (!fromInput) {
    $("coords").value = `${fmt(cur.lat)}, ${fmt(cur.lon)}`;
    setHint();
  }
  renderMap();
  renderPlaces();
  markDirty();
}

function setHint(error) {
  $("hint").textContent = error || "Paste coordinates, a Google Maps link, or 38°32'13\"N 121°45'07\"W";
  $("hint").classList.toggle("error", !!error);
  $("coords").classList.toggle("invalid", !!error);
}

function renderStatus() {
  const bar = $("statusbar");
  const on = $("enabled").checked;
  const saved = { lat: state.latitude, lon: state.longitude };
  const place = state.places.find((p) => same(p, saved));
  bar.classList.toggle("on", on);
  bar.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = on ? "Spoofing as" : "Off — sites see your real location";
  bar.append(dot, label);
  if (on) {
    const name = document.createElement("strong");
    name.textContent = place ? place.name : `${fmt(saved.lat)}, ${fmt(saved.lon)}`;
    bar.append(name);
  }
}

function renderPlaces() {
  const list = $("places");
  list.replaceChildren();
  if (!state.places.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved places yet.";
    list.append(empty);
    return;
  }
  state.places.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "place" + (same(p, cur) ? " active" : "");
    row.innerHTML = `<div class="meta"><div class="name"></div><div class="ll"></div></div><button class="del" title="Remove">×</button>`;
    row.querySelector(".name").textContent = p.name;
    row.querySelector(".ll").textContent = `${fmt(p.lat)}, ${fmt(p.lon)}`;
    row.addEventListener("click", () => setCurrent(p));
    row.querySelector(".del").addEventListener("click", async (e) => {
      e.stopPropagation();
      state.places.splice(i, 1);
      await chrome.storage.local.set({ places: state.places });
      renderPlaces();
      renderStatus();
    });
    list.append(row);
  });
}

function markDirty() {
  const btn = $("apply");
  btn.classList.remove("done");
  btn.textContent = "Apply & reload tab";
}

$("coords").addEventListener("input", () => {
  const p = parseCoords($("coords").value);
  if (!p) return setHint($("coords").value.trim() ? "Couldn't read that — try “38.537, -121.752”" : null);
  if (!valid(p)) return setHint("Latitude must be ±90, longitude ±180");
  setHint();
  setCurrent(p, { fromInput: true });
});
$("coords").addEventListener("blur", () => {
  if (parseCoords($("coords").value)) $("coords").value = `${fmt(cur.lat)}, ${fmt(cur.lon)}`;
});
$("coords").addEventListener("keydown", (e) => { if (e.key === "Enter") $("apply").click(); });
$("coords").addEventListener("focus", () => $("coords").select());

$("accuracy").addEventListener("input", () => { renderMap(); markDirty(); });

$("enabled").addEventListener("change", async () => {
  state.enabled = $("enabled").checked;
  await chrome.storage.local.set({ enabled: state.enabled });
  renderStatus();
  renderMap();
  markDirty();
});

$("apply").addEventListener("click", async () => {
  if ($("coords").classList.contains("invalid")) return $("coords").focus();
  state.latitude = cur.lat;
  state.longitude = cur.lon;
  state.accuracy = Math.max(1, Number($("accuracy").value) || 15);
  state.enabled = $("enabled").checked;
  await chrome.storage.local.set({
    enabled: state.enabled, latitude: state.latitude, longitude: state.longitude, accuracy: state.accuracy,
  });
  renderStatus();
  const btn = $("apply");
  btn.classList.add("done");
  btn.textContent = "Applied ✓";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && /^(https?|file):/.test(tab.url ?? "https:")) chrome.tabs.reload(tab.id);
});

$("addPlace").addEventListener("click", () => {
  const form = $("placeForm");
  form.hidden = !form.hidden;
  if (!form.hidden) $("placeName").focus();
});
$("placeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("placeName").value.trim() || `${fmt(cur.lat)}, ${fmt(cur.lon)}`;
  state.places = state.places.filter((p) => !same(p, cur));
  state.places.unshift({ name, lat: cur.lat, lon: cur.lon });
  await chrome.storage.local.set({ places: state.places });
  $("placeName").value = "";
  $("placeForm").hidden = true;
  renderPlaces();
  renderStatus();
});

// --- Init --------------------------------------------------------------------

chrome.storage.local.get(DEFAULTS).then((cfg) => {
  state = cfg;
  $("enabled").checked = cfg.enabled;
  $("accuracy").value = cfg.accuracy;
  renderStatus();
  setCurrent({ lat: cfg.latitude, lon: cfg.longitude });
  $("apply").classList.add("done");
  $("apply").textContent = "Applied ✓";
});
