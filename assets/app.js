/* global L, Papa, BARATHON_CONFIG */
// Adapté à la table :
// Bar | Type | Adresse | Code Postal | Quartier | Pays | Latitude | Longitude |
// Consommateur | Prix | Note | Commentaire AR | Commentaire VB

(async function () {
  const cfg = window.BARATHON_CONFIG;

  // --- Carte ---
  const map = L.map('map', { zoomControl: false }).setView(cfg.city, cfg.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  // Clusters + icônes
  const createDivIcon = (cls) =>
    L.divIcon({ className: cls, iconSize: [16, 16] });
  const clusterTodo = L.markerClusterGroup({
    disableClusteringAtZoom: 17,
    chunkedLoading: true,
  });
  const clusterDone = L.markerClusterGroup({
    disableClusteringAtZoom: 17,
    chunkedLoading: true,
  });

  // --- Chargement CSV Google Sheets publié ---
  const res = await fetch(cfg.dataUrl);
  const text = await res.text();
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  // util: récupère une valeur en gérant variantes/espaces/accents éventuels
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  function pick(row, ...candidates) {
    for (const key of candidates) {
      // essaie clé exacte puis clé "normalisée"
      if (key in row) return row[key];
      const k = Object.keys(row).find((h) => norm(h) === norm(key));
      if (k) return row[k];
    }
    return undefined;
  }

  // Mapping de TA table -> modèle du site
  let data = parsed.data
    .map((r, i) => {
      const name = pick(r, 'Bar');
      const type = pick(r, 'Type');
      const adresse = pick(r, 'Adresse');
      const cp = pick(r, 'Code Postal', 'CP');
      const quartier = pick(r, 'Quartier');
      const pays = pick(r, 'Pays');
      const lat = Number(pick(r, 'Latitude'));
      const lng = Number(pick(r, 'Longitude'));
      const consommateur = pick(r, 'Consommateur'); // AR / VB / ALL
      const prix = Number(pick(r, 'Prix')); // 1..3
      const note = Number(pick(r, 'Note')); // 1..5
      const comAR = (pick(r, 'Commentaire AR') || '').toString().trim();
      const comVB = (pick(r, 'Commentaire VB') || '').toString().trim();

      // Visité = s’il y a une note OU au moins un commentaire
      const visited = Number.isFinite(note) || comAR || comVB ? true : false;

      // Tags (pour la recherche et l’affichage)
      const euro = Number.isFinite(prix) ? '€'.repeat(Math.max(1, Math.min(4, prix))) : '';
      const tags = [
        type,
        quartier,
        cp ? `CP ${cp}` : '',
        pays,
        consommateur, // AR, VB, ALL
        euro,
      ]
        .filter(Boolean)
        .map((t) => String(t));

      // Commentaire combiné (on garde l’attribution)
      const comment = [comAR && `AR : ${comAR}`, comVB && `]()
