/* global L, Papa, BARATHON_CONFIG */
(async function () {
  const cfg = window.BARATHON_CONFIG;

  // --- helpers ---
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

  // nombre FR/EN -> Number (gère virgule décimale et blancs)
  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/\s+/g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // --- map ---
  const map = L.map("map", { zoomControl: false }).setView(cfg.city, cfg.zoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const mkIcon = (cls) => L.divIcon({ className: cls, iconSize: [16, 16] });
  const clusterTodo = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading: true });
  const clusterDone = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading: true });

  // --- data ---
  const res = await fetch(cfg.dataUrl);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: true });

  let data = parsed.data
    .map((r, i) => {
      const name = pick(r, "Bar", "Nom");
      const type = pick(r, "Type");
      const adresse = pick(r, "Adresse", "Address");
      const cp = pick(r, "Code Postal", "CP");
      const quartier = pick(r, "Quartier");
      const pays = pick(r, "Pays", "Country");

      const lat = toNum(pick(r, "Latitude", "Lat"));
      const lng = toNum(pick(r, "Longitude", "Lng", "Lon"));

      const consommateur = pick(r, "Consommateur"); // AR / VB / ALL
      const prix = toNum(pick(r, "Prix"));          // 1..3
      const note = toNum(pick(r, "Note"));          // 1..5

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

      const comment = [comAR && `AR : ${comAR}`, comVB && `VB : ${comVB}`].filter(Boolean).join("  •  ");
      const addrStr = [name, adresse, cp, "Bruxelles"].filter(Boolean).join(" ");
      const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrStr)}`;

      return {
        id: i + 1,
        name: name?.toString().trim() || "(Bar sans nom)",
        type,
        address: adresse || "",
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
      };
    })
    // on ne garde que les lignes géocodées
    .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));

  // --- UI refs ---
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
    $pName.textContent = d.name;
    $pAddress.textContent = d.address;
    renderTags(d.tags, d);
    $pRating.textContent = d.rating ? d.rating.toFixed(1) : "—";
    $pComment.textContent = d.comment || "—";
    $pVisitedAt.textContent = d.visited ? "Visité ✅" : "À faire 🟡";
    $pGmaps.href = d.gmaps;
  }

  function refresh() {
    clusterTodo.clearLayers();
    clusterDone.clearLayers();
    data.filter(matchesFilters).forEach((d) => {
      const icon = d.visited ? mkIcon("marker-done") : mkIcon("marker-todo");
      const m = L.marker([d.lat, d.lng], { icon, title: d.name });
      m.on("click", () => openPanel(d));
      (d.visited ? clusterDone : clusterTodo).addLayer(m);
    });
    if ($todo.checked) map.addLayer(clusterTodo); else map.removeLayer(clusterTodo);
    if ($done.checked) map.addLayer(clusterDone); else map.removeLayer(clusterDone);
    updateProgress();
  }

  $minRating.addEventListener("input", () => { $ratingVal.textContent = $minRating.value; refresh(); });
  $todo.addEventListener("change", refresh);
  $done.addEventListener("change", refresh);
  $search.addEventListener("input", refresh);

  refresh();

  // center
  try {
    const group = L.featureGroup([...clusterTodo.getLayers(), ...clusterDone.getLayers()]);
    if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.1));
  } catch (e) {}
})();
