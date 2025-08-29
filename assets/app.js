/* global L, Papa, BARATHON_CONFIG */
// Barathon BXL — parsing FR + géocodage Nominatim (qualité) + cache

(async function () {
  const cfg = Object.assign(
    { geocode: true, geocodeLimitPerLoad: 200, geocodeDelayMs: 650 },
    window.BARATHON_CONFIG || {}
  );

  // ---------- Helpers ----------
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  function pick(row, ...cands) {
    for (const key of cands) {
      if (key in row) return row[key];
      const k = Object.keys(row).find((h) => norm(h) === norm(key));
      if (k) return row[k];
    }
    return undefined;
  }

  // nombre FR/EN + artefacts -> Number
  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    let s = String(v).trim();
    // cas tordu "4.3461448,556" -> on garde la partie avant la virgule résiduelle
    if (/^\d+(\.\d+)?,\d+$/.test(s)) s = s.split(",")[0];
    s = s.replace(/\s/g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // distance approx (m) depuis bbox Nominatim pour filtrer les résultats "trop larges"
  function bboxDiagMeters(bbox) {
    // bbox: [south, north, west, east]
    if (!bbox || bbox.length !== 4) return Infinity;
    const [s, n, w, e] = bbox.map(Number);
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(n - s);
    const dLon = toRad(e - w);
    // approx plate carrée
    return Math.sqrt(
      Math.pow(R * dLat, 2) + Math.pow(R * Math.cos(toRad((n + s) / 2)) * dLon, 2)
    );
  }

  // ---------- Map ----------
  const map = L.map("map", { zoomControl: false }).setView(cfg.city, cfg.zoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const mkIcon = (cls) => L.divIcon({ className: cls, iconSize: [16, 16] });
  const clusterTodo = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading: true });
  const clusterDone = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading: true });

  // ---------- UI refs ----------
  const $todo = document.getElementById("filterTodo");
  const $done = document.getElementById("filterDone");
  const $minRating = document.getElementById("minRating");
  const $ratingVal = document.getElementById("ratingVal");
  const $search = document.getElementById("search");
  const $counter = document.getElementById("counter");
  const $barFill = document.getElementById("barFill");

  const $panel = document.getElementById("panel");
  const $pContent = $panel.querySelector(".panel-content");
  const $pName = document.getElementById("pName");
  const $pAddress = document.getElementById("pAddress");
  const $pTags = document.getElementById("pTags");
  const $pRating = document.getElementById("pRating");
  const $pComment = document.getElementById("pComment");
  const $pVisitedAt = document.getElementById("pVisitedAt");
  const $pGmaps = document.getElementById("pGmaps");

  function renderTags(tags, d) {
    $pTags.innerHTML = "";
    const ordered = [
      d.type,
      d.consommateur && `👤 ${d.consommateur}`,
      Number.isFinite(d.prix) && `💶 ${"€".repeat(Math.max(1, Math.min(4, d.prix)))}`,
      d.quartier && `📍 ${d.quartier}`,
      d.cp && `CP ${d.cp}`,
      ...tags,
    ].filter(Boolean);
    ordered.forEach((t) => {
      const el = document.createElement("span");
      el.className = "chip";
      el.textContent = t;
      $pTags.appendChild(el);
    });
  }

  function openPanel(d) {
    $panel.querySelector(".panel-empty").classList.add("hidden");
    $pContent.classList.remove("hidden");
    $pName.textContent = d.name || "(Bar sans nom)";
    $pAddress.textContent = d.address || "";
    renderTags(d.tags, d);
    $pRating.textContent = d.rating ? d.rating.toFixed(1) : "—";
    $pComment.textContent = d.comment || "—";
    $pVisitedAt.textContent = d.visited ? "Visité ✅" : "À faire 🟡";
    $pGmaps.href = d.gmaps;
  }

  function updateProgress() {
    const total = data.length;
    const visited = data.filter((d) => d.visited).length;
    $counter.textContent = `${visited} / ${total} bars visités`;
    const pct = total ? Math.round((visited / total) * 100) : 0;
    $barFill.style.width = `${pct}%`;
  }

  function matchesFilters(d) {
    const showTodo = $todo.checked && !d.visited;
    const showDone = $done.checked && d.visited && (d.rating ?? 0) >= +$minRating.value;
    const q = $search.value.trim().toLowerCase();
    const inSearch =
      !q ||
      [d.name, d.address, d.type, d.quartier, d.cp, d.pays, d.tags.join(" "), d.comment]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return (showTodo || showDone) && inSearch;
  }

  function addMarker(d) {
    const icon = d.visited ? mkIcon("marker-done") : mkIcon("marker-todo");
    const m = L.marker([d.lat, d.lng], { icon, title: d.name || "" });
    m.on("click", () => openPanel(d));
    (d.visited ? clusterDone : clusterTodo).addLayer(m);
  }

  function refresh() {
    clusterTodo.clearLayers();
    clusterDone.clearLayers();
    data
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
      .filter(matchesFilters)
      .forEach(addMarker);

    if ($todo.checked) map.addLayer(clusterTodo);
    else map.removeLayer(clusterTodo);
    if ($done.checked) map.addLayer(clusterDone);
    else map.removeLayer(clusterDone);

    updateProgress();
  }

  $minRating.addEventListener("input", () => {
    $ratingVal.textContent = $minRating.value;
    refresh();
  });
  $todo.addEventListener("change", refresh);
  $done.addEventListener("change", refresh);
  $search.addEventListener("input", refresh);

  // ---------- Load data ----------
  const res = await fetch(cfg.dataUrl);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: true });

  // mapping table -> modèle interne
  let data = parsed.data.map((r, i) => {
    const name = (pick(r, "Bar", "Nom") || "").toString().trim();
    const type = pick(r, "Type");
    const adresse = (pick(r, "Adresse", "Address") || "").toString().trim();
    const cp = (pick(r, "Code Postal", "CP") || "").toString().trim();
    const quartier = pick(r, "Quartier");
    const pays = pick(r, "Pays") || "Belgique";

    let lat = toNum(pick(r, "Latitude", "Lat"));
    let lng = toNum(pick(r, "Longitude", "Lng", "Lon"));

    const consommateur = pick(r, "Consommateur");
    const prix = toNum(pick(r, "Prix"));
    const note = toNum(pick(r, "Note"));
    const comAR = (pick(r, "Commentaire AR") || "").toString().trim();
    const comVB = (pick(r, "Commentaire VB") || "").toString().trim();

    const visited = (Number.isFinite(note) && note > 0) || comAR || comVB ? true : false;

    const tags = [
      type,
      quartier,
      cp ? `CP ${cp}` : "",
      pays,
      consommateur,
      Number.isFinite(prix) ? "€".repeat(Math.max(1, Math.min(4, prix))) : "",
    ].filter(Boolean);

    const comment = [comAR && `AR : ${comAR}`, comVB && `VB : ${comVB}`]
      .filter(Boolean)
      .join("  •  ");

    // Meilleur "query" pour le géocode (on insiste sur CP + Bruxelles)
    const city = /brux/i.test(adresse) || /brux/i.test(quartier || "") ? "" : "Bruxelles";
    const addrStr = [name, adresse, cp, quartier, city, pays].filter(Boolean).join(" ");
    const addrStrLite = [adresse, cp, city, pays].filter(Boolean).join(" ");
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [name || adresse, cp, "Bruxelles", pays].filter(Boolean).join(" ")
    )}`;

    return {
      id: i + 1,
      name: name || adresse || "(Bar sans nom)",
      type,
      address: adresse,
      cp,
      quartier,
      pays,
      lat,
      lng,
      consommateur,
      prix: Number.isFinite(prix) ? prix : null,
      visited,
      rating: Number.isFinite(note) ? note : null,
      tags,
      comment,
      visited_at: "",
      gmaps,
      _queries: [addrStr, addrStrLite], // tentatives
    };
  });

  // ---------- Geocoding (qualité + cache) ----------
  const cacheKey = "barathon_geoCache_v2";
  const geoCache = JSON.parse(localStorage.getItem(cacheKey) || "{}");

  function acceptGeo(result) {
    // On refuse les résultats trop larges (bbox > ~2km) ou trop génériques
    const bbox = result.boundingbox;
    const diag = bboxDiagMeters(bbox);
    const klass = result.class || "";
    const type = result.type || "";
    const address = result.address || {};

    const tooWide = !Number.isFinite(diag) || diag > 2000; // > 2 km = trop vague
    const genericPlace =
      klass === "place" &&
      /^(city|town|suburb|borough|quarter|neighbourhood|city_block|residential)$/i.test(type);

    // on préfère quand il y a house_number ou building/amenity/shop/leisure
    const preciseClass = /^(building|amenity|shop|leisure|tourism|railway|highway)$/i.test(klass);
    const hasNumber = !!(address.house_number || address.building || address.amenity);

    if (genericPlace || tooWide) return false;
    if (preciseClass || hasNumber) return true;

    // sinon, on accepte si la bbox est petite (< 400 m)
    return diag < 400;
  }

  async function geocodeQ(q) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=be&limit=3&accept-language=fr&q=" +
      encodeURIComponent(q);
    const r = await fetch(url, { headers: { "Accept-Language": "fr" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function geocodeOne(queries) {
    for (const q of queries) {
      let list = await geocodeQ(q);
      // on trie pour favoriser les classes précises
      list = list.sort((a, b) => {
        const aScore =
          (acceptGeo(a) ? 1 : 0) * 10 + (a.importance || 0) + (a.place_rank || 0) / 100;
        const bScore =
          (acceptGeo(b) ? 1 : 0) * 10 + (b.importance || 0) + (b.place_rank || 0) / 100;
        return bScore - aScore;
      });
      const best = list.find(acceptGeo);
      if (best) return { lat: Number(best.lat), lon: Number(best.lon), raw: best };
    }
    throw new Error("not precise");
  }

  async function runGeocodingQueue() {
    if (!cfg.geocode) return;
    let todo = data.filter((d) => !(Number.isFinite(d.lat) && Number.isFinite(d.lng)));
    let count = 0,
      kept = 0,
      skipped = 0;

    for (const d of todo) {
      if (count >= cfg.geocodeLimitPerLoad) break;

      // cache
      const cacheKeyQ = d._queries.join(" | ");
      if (geoCache[cacheKeyQ]) {
        const { lat, lon } = geoCache[cacheKeyQ];
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          d.lat = lat;
          d.lng = lon;
          kept++;
          continue;
        }
      }

      try {
        await new Promise((ok) => setTimeout(ok, cfg.geocodeDelayMs));
        const ans = await geocodeOne(d._queries);
        if (Number.isFinite(ans.lat) && Number.isFinite(ans.lon)) {
          d.lat = ans.lat;
          d.lng = ans.lon;
          geoCache[cacheKeyQ] = { lat: d.lat, lon: d.lng };
          localStorage.setItem(cacheKey, JSON.stringify(geoCache));
          count++;
          kept++;
          if (matchesFilters(d)) addMarker(d); // ajout à la volée
        }
      } catch (e) {
        skipped++;
        // pas de coords fiables → on ignore
      }
    }

    console.info(
      `[Barathon] Géocodage terminé: ajoutés=${kept} ignorés=${skipped} (cette passe). Cache=${Object.keys(geoCache).length}`
    );
    updateProgress();
    try {
      const group = L.featureGroup([...clusterTodo.getLayers(), ...clusterDone.getLayers()]);
      if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.12));
    } catch (_) {}
  }

  // injecte du cache existant si présent
  data.forEach((d) => {
    const key = (d._queries || []).join(" | ");
    if (!(Number.isFinite(d.lat) && Number.isFinite(d.lng)) && geoCache[key]) {
      d.lat = geoCache[key].lat;
      d.lng = geoCache[key].lon;
    }
  });

  // rendu initial + géocodage progressif
  refresh();
  runGeocodingQueue();
})();
