/* assets/app.js — Barathon BXL (CSV + API votes & tops) */

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

const $panelToggle = document.getElementById("panelToggle");
const $panel = el("#panel");
const $panelEmpty = $panel?.querySelector(".panel-empty");
const $panelContent = $panel?.querySelector(".panel-content");
const $pName = el("#pName");
const $pAddress = el("#pAddress");
const $pTags = el("#pTags");
const $pRating = el("#pRating");
const $pComment = el("#pComment");
const $pVisitedAt = el("#pVisitedAt");
const $pGmaps = el("#pGmaps");

if ($panelToggle) {
  $panelToggle.addEventListener("click", () => {
    $panel.classList.toggle("open");
    setTimeout(() => map.invalidateSize(), 250);
  });
}

/* ------------------ UI elements ------------------ */
const $filterTodo = el("#filterTodo");
const $filterDone = el("#filterDone");
const $minRating = el("#minRating");
const $ratingVal = el("#ratingVal");
const $search = el("#search");
const $counter = el("#counter");
const $barFill = el("#barFill");

/* ------------------ State ------------------ */
let ALL_ROWS = []; // toutes les lignes du CSV (même sans coords)
let BARS = []; // lignes mappées (avec/without coords)
let BARS_WITH_COORDS = []; // seulement celles avec coords
let MARKERS = []; // { marker, data }

/* ------------------ API (NEW) ------------------ */
const API_URL = "http://localhost:8080"; // en dev; en prod: ton URL d'API HTTPS

// Index pour retrouver l'id Postgres depuis le CSV (clé = name|lat|lng arrondis)
const BAR_ID_INDEX = new Map();

function keyFromBarLike(obj) {
  const name =
    (obj.name || obj.Bar || obj.Nom || "").toString().trim();
  const lat = Math.round(
    (toNum(obj.lat ?? obj.Latitude ?? obj.latitude ?? obj.Lat) || 0) * 1e6
  );
  const lng = Math.round(
    (toNum(
      obj.lng ?? obj.Longitude ?? obj.longitude ?? obj.lon ?? obj.Long
    ) || 0) * 1e6
  );
  return `${name}|${lat}|${lng}`;
}

async function loadBarIndexFromAPI() {
  try {
    const r = await fetch(`${API_URL}/api/v1/bars`);
    const data = await r.json();
    if (Array.isArray(data.items)) {
      data.items.forEach((it) => {
        const lat = Math.round(Number(it.latitude || 0) * 1e6);
        const lng = Math.round(Number(it.longitude || 0) * 1e6);
        const key = `${(it.name || "").trim()}|${lat}|${lng}`;
        BAR_ID_INDEX.set(key, it.id);
      });
      console.log(`Index bars chargé: ${BAR_ID_INDEX.size} entrées`);
    }
  } catch (e) {
    console.error("loadBarIndexFromAPI failed", e);
  }
}

// Hash SHA-256 en hex (pour ua_hash)
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toast(msg) {
  // Simple fallback ; remplace par un vrai toast si tu as une lib UI
  alert(msg);
}

function resolveBarId(b) {
  const key = keyFromBarLike({ name: b.name, lat: b.lat, lng: b.lng });
  return BAR_ID_INDEX.get(key);
}

async function voteBarId(bar_id) {
  try {
    const ua_hash = await sha256Hex(navigator.userAgent);
    const payload = { bar_id, ua_hash, fp_hash: null };

    const sigRes = await fetch(`${API_URL}/api/v1/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());

    const voteRes = await fetch(`${API_URL}/api/v1/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, signature: sigRes.signature }),
    }).then((r) => r.json());

    if (voteRes.ok) {
      toast("Tchin ! 🍻 Ton vote est compté.");
    } else if (voteRes.duplicate) {
      toast("Tu as déjà trinqué pour ce bar aujourd'hui 😉");
    } else if (voteRes.error === "too_many_votes") {
      toast("Trop de votes depuis ton appareil, reviens plus tard 🍺");
    } else {
      toast("Oups, une erreur est survenue.");
    }
  } catch (err) {
    console.error("Erreur vote:", err);
    toast("Erreur de connexion à l’API.");
  }
}

async function fetchTop(quartier = null, limit = 10) {
  const qs = new URLSearchParams({ limit });
  if (quartier) qs.set("quartier", quartier);
  const res = await fetch(`${API_URL}/api/v1/top?${qs.toString()}`);
  return res.json();
}

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

async function initApp(rows) {
  // Charger l'index des bars (id/name/lat/lng) depuis l'API
  await loadBarIndexFromAPI();

  ALL_ROWS = rows;
  // Mapper CSV -> modèle interne
  BARS = rows.map((r) => {
    const lat = toNum(pick(r, ["Latitude", "latitude", "lat", "Lat"]));
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
  BARS_WITH_COORDS = BARS.filter(
    (b) => Number.isFinite(b.lat) && Number.isFinite(b.lng)
  );
  console.log(
    `Bars valides (avec coords): ${BARS_WITH_COORDS.length} / ${BARS.length}`
  );

  buildMarkers();
  fitInitialView();
  bindFilters();
  updateListAndProgress();
  renderTop(); // charge le top général dans #top-list si présent
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

// Ouvrir le panneau de détails et le remplir (+ bouton Tchin !)
function openPanel(b) {
  // 1) afficher le drawer + invalider la taille de la carte (mobile)
  $panel.classList.add("open");
  $panelEmpty.classList.add("hidden");
  $panelContent.classList.remove("hidden");
  setTimeout(() => map.invalidateSize(), 250);

  // 2) contenu texte principal
  $pName.textContent = b.name || "(Bar sans nom)";
  $pAddress.textContent = [b.addr, b.cp, b.quartier]
    .filter(Boolean)
    .join(" · ");

  // 3) tags (prix, consommateur, quartier, pays…)
  $pTags.innerHTML = "";
  const tags = [];
  if (Number.isFinite(b.prix)) tags.push(`€${b.prix}`);
  if (b.consommateur) tags.push(b.consommateur);
  if (b.quartier) tags.push(b.quartier);
  if (b.pays && b.pays !== "Belgique") tags.push(b.pays);
  tags.forEach((t) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = t;
    $pTags.appendChild(span);
  });

  // 4) note, commentaires, statut
  $pRating.textContent = Number.isFinite(b.note) ? String(b.note) : "–";
  const comments = [b.commentAR, b.commentVB].filter((c) => c && c.trim());
  $pComment.textContent = comments.length ? comments.join(" · ") : "—";
  $pVisitedAt.textContent = b.visited ? "Visité ✅" : "À faire 🕑";

  // 5) lien Google Maps
  const queryPlace = encodeURIComponent(`${b.name} ${b.addr} ${b.cp} ${b.quartier}`);
  const queryCoords = encodeURIComponent(`${b.lat},${b.lng}`);
  $pGmaps.href = `https://www.google.com/maps/search/?api=1&query=${queryCoords}&query_place_id=${queryPlace}`;

  // 6) bouton Tchin ! (créé/maj à chaque ouverture)
  let btn = $panelContent.querySelector(".tchin-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "tchin-btn";
    btn.style.marginTop = "8px";
    $panelContent.appendChild(btn);
  }
  btn.textContent = "Tchin ! 🍻";

  const barId = resolveBarId(b);
  btn.disabled = !barId;
  btn.title = barId
    ? "Fais grimper ce bar dans le Top !"
    : "Bar non relié à la base (id introuvable)";

  btn.onclick = () => {
    if (!barId) {
      toast("Impossible d'identifier ce bar côté serveur (pas d'id).");
      return;
    }
    voteBarId(barId);
  };
}

/* ------------------ Filters & search ------------------ */
function bindFilters() {
  if ($ratingVal && $minRating) $ratingVal.textContent = $minRating.value;

  $filterTodo?.addEventListener("change", applyFilters);
  $filterDone?.addEventListener("change", applyFilters);
  $minRating?.addEventListener("input", () => {
    $ratingVal.textContent = $minRating.value;
    applyFilters();
  });
  $search?.addEventListener("input", applyFilters);
}

function applyFilters() {
  const showTodo = $filterTodo?.checked ?? true;
  const showDone = $filterDone?.checked ?? true;
  const minRating = toNum($minRating?.value) || 0;
  const q = ($search?.value || "").toLowerCase().trim();

  cluster.clearLayers();

  let shown = 0;
  MARKERS.forEach(({ marker, data }) => {
    const isDone = !!data.visited;
    const passStatus = (isDone && showDone) || (!isDone && showTodo);
    const passRating =
      !Number.isFinite(minRating) || !Number.isFinite(data.note)
        ? true
        : data.note >= minRating;
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
  const totalWithCoords = BARS_WITH_COORDS.length;
  const visitedCount = BARS_WITH_COORDS.filter((b) => b.visited).length;

  if ($counter) $counter.textContent = `${visitedCount} / ${totalWithCoords} bars visités`;

  const pct = totalWithCoords ? Math.round((visitedCount / totalWithCoords) * 100) : 0;
  if ($barFill) $barFill.style.width = `${pct}%`;
}

/* ------------------ Top 10 display (simple) ------------------ */
async function renderTop() {
  const container = document.getElementById("top-list");
  if (!container) return;
  try {
    const data = await fetchTop(null, 10); // top général
    container.innerHTML = "";
    (data.items || []).forEach((bar, i) => {
      const row = document.createElement("div");
      row.className = "top-row";
      row.innerHTML = `
        <span class="rank">#${i + 1}</span>
        <span class="name">${bar.name}</span>
        <span class="quartier">${bar.quartier || ""}</span>
        <span class="score">${bar.score_window} ❤️</span>
      `;
      container.appendChild(row);
    });
  } catch (e) {
    console.error("renderTop failed", e);
  }
}

/* ------------------ Boot ------------------ */
document.addEventListener("DOMContentLoaded", () => {
  // CSV -> markers + panneau
  // (Papa.parse est déjà lancé plus haut)

  // Bonus: si tu veux rafraîchir le top périodiquement:
  // setInterval(renderTop, 60_000);
});
