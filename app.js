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

// Map category -> icon file (stored in assets/icons/)
const CATEGORY_ICON_FILE = {
  "Natural Disasters & Weather": "cloud-bolt-solid-full.svg",
  "Operational Incidents (Fires, accidents, industrial incidents)": "triangle-exclamation-solid-full.svg",
  "Infrastructure & Logistics Failure": "wrench-solid-full.svg",
  "Trade Policy (Tariffs, quotas, barriers)": "scale-balanced-solid-full.svg",
  "Regulatory & Compliance": "gavel-solid-full.svg",
  "Piracy": "skull-crossbones-solid-full.svg",
  "Cyber attacks & ICT Disruption": "bug-solid-full.svg",
  "Geopolitical & Security": "shield-solid-full.svg",
  "Labour & Industrial Action": "people-group-solid-full.svg",
  "Crime, Fraud & Corruption": "money-bill-solid-full.svg",
  "Other": "question-solid-full.svg",
  "Uncategorised": "question-solid-full.svg"
};

function normaliseCategory(cat) {
  const c = String(cat ?? "").trim();
  return c || "Uncategorised";
}

function makeCategoryIcon(category) {
  const cat = normaliseCategory(category);
  const filename = CATEGORY_ICON_FILE[cat] || CATEGORY_ICON_FILE["Other"];

  // IMPORTANT: relative path from index.html
  const src = `assets/icons/${filename}`;

  return L.divIcon({
    className: "category-marker",
    html: `<div class="category-marker__pin"><img src="${src}" alt="" /></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -24]
  });
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

function makeClusterGroup() {
  return L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    zoomToBoundsOnClick: true,

    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();

      // Neutral, category-agnostic cluster marker
      return L.divIcon({
        html: `<div class="cluster-badge"><span>${count}</span></div>`,
        className: "cluster-icon",
        iconSize: [36, 36]
      });
    }
  });
}

function getOrCreateCategoryLayer(category) {
  const key = category || "Uncategorised";
  if (!categoryLayers.has(key)) {
    categoryLayers.set(key, makeClusterGroup());
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

    const catNorm = normaliseCategory(cat);
    const filename = CATEGORY_ICON_FILE[catNorm] || CATEGORY_ICON_FILE["Other"];
    const iconSrc = `assets/icons/${filename}`;

    const icon = document.createElement("img");
    icon.className = "filter-item__icon";
    icon.src = iconSrc;
    icon.alt = ""; // decorative
    icon.loading = "lazy";

    const meta = document.createElement("div");
  meta.className = "filter-item__meta";

  const label = document.createElement("div");
  label.className = "filter-item__label";

  // NEW: label becomes a row containing icon + text
  const labelRow = document.createElement("div");
  labelRow.className = "filter-item__labelRow";

  const labelText = document.createElement("span");
  labelText.textContent = cat;

  labelRow.appendChild(icon);
  labelRow.appendChild(labelText);
  label.appendChild(labelRow);

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

      const marker = L.marker([lat, lon], { icon: makeCategoryIcon(category) });
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
