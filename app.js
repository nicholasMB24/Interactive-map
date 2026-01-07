/* Leaflet MVP — loads data/events.geojson and provides category checkbox filtering */

function escapeHTML(value) {
  const s = String(value ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Pick the first non-empty property value from a list of candidate keys
function pickProp(obj, keys, fallback = "") {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null) continue;
    const t = String(v).trim();
    if (t !== "") return v;
  }
  return fallback;
}

function popupHTML(p) {
  const title = escapeHTML(pickProp(p, ["title", "title*"], "Untitled event"));
  const category = escapeHTML(pickProp(p, ["category", "category *", "category*"], "Uncategorised"));
  const date = escapeHTML(pickProp(p, ["date"], ""));
  const country = escapeHTML(pickProp(p, ["country"], ""));
  const desc = escapeHTML(pickProp(p, ["description", "description*"], ""));
  const confidence = escapeHTML(pickProp(p, ["geocode_confidence"], ""));
  const method = escapeHTML(pickProp(p, ["geocode_method"], ""));

  const metaParts = [
  category,
  date ? `Date: ${date}` : "",
  country ? `Country: ${country}` : ""
].filter(Boolean);

  return `
    <div class="popup">
      <h3>${title}</h3>
      <p class="meta">${metaParts.join(" • ")}</p>
      <p class="desc">${desc}</p>
    </div>
  `;
}

const statusEl = document.getElementById("status");
const filtersEl = document.getElementById("filters");
const visibleCountEl = document.getElementById("visibleCount");
const selectAllBtn = document.getElementById("selectAll");
const selectNoneBtn = document.getElementById("selectNone");
const zoomVisibleBtn = document.getElementById("zoomVisible");

// Panel collapse elements
const panelEl = document.querySelector(".panel");
const togglePanelBtn = document.getElementById("togglePanel");

// Zoom caps
const TILE_MIN_ZOOM = 2;
const TILE_MAX_ZOOM = 19;

// Base map
const map = L.map("map", {
  minZoom: TILE_MIN_ZOOM,
  maxZoom: TILE_MAX_ZOOM
}).setView([20, 0], TILE_MIN_ZOOM);

// Prevent the world from repeating left/right and stop endless panning
const bounds = L.latLngBounds([[-85, -180], [85, 180]]);
map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

// CARTO Positron tiles
L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png", {
  minZoom: TILE_MIN_ZOOM,
  maxZoom: TILE_MAX_ZOOM,
  maxNativeZoom: TILE_MAX_ZOOM,
  noWrap: true,
  attribution: "Map tiles by Carto, under CC BY 3.0. Data by OpenStreetMap, under ODbL."
}).addTo(map);

// Collapsible panel behaviour
function setPanelCollapsed(collapsed) {
  if (!panelEl || !togglePanelBtn) return;

  panelEl.classList.toggle("is-collapsed", collapsed);
  togglePanelBtn.setAttribute("aria-expanded", String(!collapsed));
  togglePanelBtn.textContent = collapsed ? "Show filters" : "Hide filters";

  setTimeout(() => map.invalidateSize(), 50);
}

// Default: expanded
setPanelCollapsed(false);

if (togglePanelBtn) {
  togglePanelBtn.addEventListener("click", () => {
    const collapsed = panelEl?.classList.contains("is-collapsed") ?? false;
    setPanelCollapsed(!collapsed);
  });
}

const categoryLayers = new Map();    // category -> L.LayerGroup
const categoryCounts = new Map();    // category -> number
const allMarkers = L.featureGroup(); // to fit bounds / zoom visible

function getOrCreateCategoryLayer(category) {
  const key = category || "Uncategorised";
  if (!categoryLayers.has(key)) {
    // Cluster group per category (so your checkbox filtering still works)
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true
    });
    categoryLayers.set(key, cluster);
  }
  return categoryLayers.get(key);
}

function updateVisibleCount() {
  let count = 0;
  for (const [cat, layer] of categoryLayers.entries()) {
    if (map.hasLayer(layer)) {
      count += (categoryCounts.get(cat) || 0);
    }
  }
  visibleCountEl.textContent = String(count);
}

function buildFiltersUI() {
  filtersEl.innerHTML = "";
  const categories = Array.from(categoryLayers.keys()).sort((a, b) => a.localeCompare(b));

  for (const cat of categories) {
    const id = `cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    const wrapper = document.createElement("label");
    wrapper.className = "filter-item";
    wrapper.setAttribute("for", id);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.checked = true;

    checkbox.addEventListener("change", () => {
      const layer = categoryLayers.get(cat);
      if (!layer) return;

      if (checkbox.checked) layer.addTo(map);
      else map.removeLayer(layer);

      updateVisibleCount();
    });

    const meta = document.createElement("div");
    meta.className = "filter-item__meta";

    const label = document.createElement("div");
    label.className = "filter-item__label";
    label.textContent = cat;

    const count = document.createElement("div");
    count.className = "filter-item__count";
    count.textContent = `${categoryCounts.get(cat) || 0} event(s)`;

    meta.appendChild(label);
    meta.appendChild(count);

    wrapper.appendChild(checkbox);
    wrapper.appendChild(meta);

    filtersEl.appendChild(wrapper);
  }
}

function setAllCheckboxes(checked) {
  const checkboxes = filtersEl.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    cb.dispatchEvent(new Event("change"));
  });
}

selectAllBtn.addEventListener("click", () => setAllCheckboxes(true));
selectNoneBtn.addEventListener("click", () => setAllCheckboxes(false));

zoomVisibleBtn.addEventListener("click", () => {
  const visibleMarkers = L.featureGroup();

  for (const [cat, layer] of categoryLayers.entries()) {
    if (!map.hasLayer(layer)) continue;
    layer.eachLayer(m => visibleMarkers.addLayer(m));
  }

  const b = visibleMarkers.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: TILE_MAX_ZOOM });
});

// Load data
(async function init() {
  try {
    statusEl.textContent = "Loading events…";

    const res = await fetch("data/events.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load GeoJSON (HTTP ${res.status})`);
    const geojson = await res.json();

    if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      throw new Error("GeoJSON file is not a FeatureCollection");
    }

    for (const feature of geojson.features) {
      if (!feature || feature.type !== "Feature") continue;
      const geom = feature.geometry || {};
      const props = feature.properties || {};
      if (geom.type !== "Point" || !Array.isArray(geom.coordinates) || geom.coordinates.length !== 2) continue;

      const [lon, lat] = geom.coordinates;
      if (typeof lat !== "number" || typeof lon !== "number") continue;

      const category = pickProp(props, ["category", "category *", "category*"], "Uncategorised");
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

      const marker = L.marker([lat, lon]);
      marker.bindPopup(popupHTML(props), { maxWidth: 320 });

      const layer = getOrCreateCategoryLayer(category);
      layer.addLayer(marker);
      allMarkers.addLayer(marker);
    }

    for (const layer of categoryLayers.values()) layer.addTo(map);

    buildFiltersUI();
    updateVisibleCount();

    const b = allMarkers.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: TILE_MAX_ZOOM });

    statusEl.textContent = `Loaded ${allMarkers.getLayers().length} events`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error loading events (see console)";
  }
})();
