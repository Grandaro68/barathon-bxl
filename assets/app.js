/* assets/app.js — Barathon BXL (robuste pour CSV) */

/* ------------------ Config ------------------ */
const CFG = Object.assign(
  {
    dataUrl: "./data/bars.csv",
    city: [50.85045, 4.34878],
    zoom: 12,
    geocode: false,
  },
  window.BARATHON_CONFIG || {}
);

/* ------------------ Helpers ------------------ */
const toNum = (v) => {
  if (v === undefined || v === null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return NaN;
  return parseFloat(s.replace(",", "."));
};

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return obj[k];
    }
  }
  return undefined;
};

const el = (sel) => document.querySelector(sel);

/* ------------------ Map ------------------ */
const map = L.map("map", {
  center: CFG.city,
  zoom: CFG.zoom,
  scrollWheelZoom: true,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  maxZoom: 20,
}).addTo(map);

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 18,
});
map.addLayer(cluster);

/* ------------------ UI elements ------------------ */
const $filterTodo = el("#filterTodo");
const $filterDone = el("#filterDone");
const $minRating = el("#minRating");
const $ratingVal = el("#ratingVal");
const $search = el("#search");
const $counter = el("#counter");
const $barFill = el("#barFill");

const $panel = el("#panel");
const $panelEmpty = $panel.querySelector(".panel-empty");
const $panelContent = $panel.querySelector(".panel-content");
const $pName = el("#pName");
const $pAddress = el("#pAddress");
const $pTags = el("#pTags");
const $pRating = el("#pRating");
const $pComment = el("#pComment");
const $pVisitedAt = el("#pVisitedAt");
const $pGmaps = el("#pGmaps");

/* ------------------ State ------------------ */
let ALL_ROWS = [];         // toutes les lignes du CSV (même sans coords)
let BARS = [];             // lignes mappées (avec/without coords)
let BARS_WITH_COORDS = []; // seulement celles avec coords
let MARKERS = [];          // { marker, data }

/* ------------------ Load CSV ------------------ */
Papa.parse(CFG.dataUrl + (CFG.dataUrl.includes("?") ? "&v=3" : "?v=3"), {
  download: true,
  header: true,
  skipEmptyLines: true,
  transformHeader: (h) => (h || "").trim(),
  complete: (res) => initApp(res.data || []),
  error: (err) => {
    console.error("Papa error", err);
    alert("Impossible de charger data/bars.csv. Vérifie que le fichier est bien en ligne.");
  },
});

function initApp(rows) {
  ALL_ROWS = rows;
  // Mapper CSV -> modèle interne
  BARS = rows.map((r) => {
    const lat = toNum(
      pick(r, ["Latitude", "latitude", "lat", "Lat"])
    );
    const lng = toNum(
      pick(r, ["Longitude", "longitude", "lng", "lon", "Long"])
    );

    const name = pick(r, ["Bar", "Nom", "name"]) || "(Bar sans nom)";
    const addr = pick(r, ["Adresse", "address", "Address"]) || "";
    const cp = pick(r, ["Code Postal", "CP", "code_postal"]) || "";
    const quartier = pick(r, ["Quartier", "quartier"]) || "";
    const pays = pick(r, ["Pays", "Country"]) || "Belgique";
    const note = toNum(pick(r, ["Note", "note", "rating"]));
    const prix = toNum(pick(r, ["Prix", "prix"]));
    const consommateur = (pick(r, ["Consommateur", "consommateur"]) || "").toString();
    const commentAR = pick(r, ["Commentaire AR", "commentaire AR", "commentAR"]) || "";
    const commentVB = pick(r, ["Commentaire VB", "commentaire VB", "commentVB"]) || "";

    // Statut "visité" : si note > 0 on considère "visité"
    const visited = Number.isFinite(note) && note > 0;

    return {
      name,
      addr,
      cp,
      quartier,
      pays,
      lat,
      lng,
      note,
      prix,
      consommateur,
      commentAR,
      commentVB,
      visited,
      raw: r,
    };
  });

  // On ne crée des marqueurs que pour les bars avec coords
  BARS_WITH_COORDS = BARS.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
  console.log(`Bars valides (avec coords): ${BARS_WITH_COORDS.length} / ${BARS.length}`);

  buildMarkers();
  fitInitialView();
  bindFilters();
  updateListAndProgress();
}

/* ------------------ Build markers ------------------ */
function buildMarkers() {
  cluster.clearLayers();
  MARKERS = [];

  BARS_WITH_COORDS.forEach((b) => {
    const m = L.marker([b.lat, b.lng]);
    m.on("click", () => openPanel(b));
    MARKERS.push({ marker: m, data: b });
  });

  MARKERS.forEach(({ marker }) => cluster.addLayer(marker));
}

/* ------------------ View helpers ------------------ */
function fitInitialView() {
  if (BARS_WITH_COORDS.length === 0) {
    map.setView(CFG.city, CFG.zoom);
    return;
  }
  const bounds = L.latLngBounds(BARS_WITH_COORDS.map((b) => [b.lat, b.lng]));
  map.fitBounds(bounds.pad(0.2));
}

function openPanel(b) {
  $panelEmpty.classList.add("hidden");
  $panelContent.classList.remove("hidden");

  $pName.textContent = b.name;
  $pAddress.textContent = [b.addr, b.cp, b.quartier].filter(Boolean).join(" · ");

  $pTags.innerHTML = "";
  const tags = [];
  if (b.prix) tags.push(`€${b.prix}`);
  if (b.consommateur) tags.push(b.consommateur);
  if (b.quartier) tags.push(b.quartier);
  if (b.pays && b.pays !== "Belgique") tags.push(b.pays);
  tags.forEach((t) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = t;
    $pTags.appendChild(span);
  });

  $pRating.textContent = Number.isFinite(b.note) ? b.note.toString() : "–";

  const comments = [b.commentAR, b.commentVB].filter((c) => c && c.trim());
  $pComment.textContent = comments.length ? comments.join(" · ") : "—";
  $pVisitedAt.textContent = b.visited ? "Visité ✅" : "À faire 🕑";

  const q = encodeURIComponent(`${b.name} ${b.addr} ${b.cp} ${b.quartier}`);
  $pGmaps.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${b.lat},${b.lng}`
  )}&query_place_id=${q}`;
}

/* ------------------ Filters & search ------------------ */
function bindFilters() {
  $ratingVal.textContent = $minRating.value;

  $filterTodo.addEventListener("change", applyFilters);
  $filterDone.addEventListener("change", applyFilters);
  $minRating.addEventListener("input", () => {
    $ratingVal.textContent = $minRating.value;
    applyFilters();
  });
  $search.addEventListener("input", applyFilters);
}

function applyFilters() {
  const showTodo = $filterTodo.checked;
  const showDone = $filterDone.checked;
  const minRating = toNum($minRating.value) || 0;
  const q = ($search.value || "").toLowerCase().trim();

  cluster.clearLayers();

  let shown = 0;
  MARKERS.forEach(({ marker, data }) => {
    const isDone = !!data.visited;
    const passStatus = (isDone && showDone) || (!isDone && showTodo);
    const passRating =
      !Number.isFinite(minRating) || !Number.isFinite(data.note) ? true : data.note >= minRating;
    const hay = `${data.name} ${data.addr} ${data.quartier} ${data.consommateur}`.toLowerCase();
    const passSearch = q ? hay.includes(q) : true;

    if (passStatus && passRating && passSearch) {
      cluster.addLayer(marker);
      shown++;
    }
  });

  updateListAndProgress(shown);
}

function updateListAndProgress(currentShown) {
  // compteur “visités” = nb de bars (avec coords) où visited = true
  const totalWithCoords = BARS_WITH_COORDS.length;
  const visitedCount = BARS_WITH_COORDS.filter((b) => b.visited).length;

  $counter.textContent = `${visitedCount} / ${totalWithCoords} bars visités`;

  const pct = totalWithCoords ? Math.round((visitedCount / totalWithCoords) * 100) : 0;
  $barFill.style.width = `${pct}%`;

  if (typeof currentShown === "number") {
    // Rien à faire ici pour la liste, mais tu peux afficher “X pins visibles”
    // console.log(`Pins visibles: ${currentShown}`);
  }
}

/* ------------------ Fin ------------------ */
