/* global L, Papa, BARATHON_CONFIG */
(async function(){
  const cfg = window.BARATHON_CONFIG;
  const map = L.map('map', { zoomControl: false }).setView(cfg.city, cfg.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // Custom markers
  const createDivIcon = cls => L.divIcon({ className: cls, iconSize: [16,16] });
  const clusterTodo = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading:true });
  const clusterDone = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading:true });

  const res = await fetch(cfg.dataUrl);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  let data = parsed.data.map((d,i)=>({
    id: d.id ?? i+1,
    name: d.name?.trim(),
    address: d.address?.trim() || '',
    lat: +d.lat, lng: +d.lng,
    visited: (''+d.visited).toLowerCase() === 'true',
    rating: d.rating ? +d.rating : null,
    tags: (d.tags||'').split(',').map(s=>s.trim()).filter(Boolean),
    comment: d.comment || '',
    visited_at: d.visited_at || '',
    gmaps: d.gmaps || ''
  })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng));

  // UI elements
  const $todo = document.getElementById('filterTodo');
  const $done = document.getElementById('filterDone');
  const $minRating = document.getElementById('minRating');
  const $ratingVal = document.getElementById('ratingVal');
  const $search = document.getElementById('search');
  const $counter = document.getElementById('counter');
  const $barFill = document.getElementById('barFill');

  const $panel = document.getElementById('panel');
  const $pContent = $panel.querySelector('.panel-content');
  const $pName = document.getElementById('pName');
  const $pAddress = document.getElementById('pAddress');
  const $pTags = document.getElementById('pTags');
  const $pRating = document.getElementById('pRating');
  const $pComment = document.getElementById('pComment');
  const $pVisitedAt = document.getElementById('pVisitedAt');
  const $pGmaps = document.getElementById('pGmaps');

  function updateProgress(){
    const total = data.length;
    const visited = data.filter(d=>d.visited).length;
    $counter.textContent = `${visited} / ${total} bars visités`;
    const pct = total ? Math.round((visited/total)*100) : 0;
    $barFill.style.width = `${pct}%`;
  }

  function matchesFilters(d){
    const showTodo = $todo.checked && !d.visited;
    const showDone = $done.checked && d.visited && (d.rating ?? 0) >= +$minRating.value;
    const q = $search.value.trim().toLowerCase();
    const inSearch = !q || [d.name, d.address, d.tags.join(' '), d.comment].join(' ').toLowerCase().includes(q);
    return (showTodo || showDone) && inSearch;
  }

  function renderTags(tags){
    $pTags.innerHTML = '';
    tags.forEach(t=>{
      const el = document.createElement('span');
      el.className = 'chip';
      el.textContent = t;
      $pTags.appendChild(el);
    });
  }

  function openPanel(d){
    $panel.querySelector('.panel-empty').classList.add('hidden');
    $pContent.classList.remove('hidden');
    $pName.textContent = d.name || 'Bar sans nom';
    $pAddress.textContent = d.address;
    renderTags(d.tags);
    $pRating.textContent = d.rating ? d.rating.toFixed(1) : '—';
    $pComment.textContent = d.comment || '—';
    $pVisitedAt.textContent = d.visited_at ? `Visité le ${d.visited_at}` : (d.visited ? 'Visité' : 'À faire');
    $pGmaps.href = d.gmaps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.name + ' ' + d.address)}`;
  }

  function refresh(){
    clusterTodo.clearLayers(); clusterDone.clearLayers();
    data.filter(matchesFilters).forEach(d=>{
      const icon = d.visited ? createDivIcon('marker-done') : createDivIcon('marker-todo');
      const m = L.marker([d.lat, d.lng], { icon, title: d.name });
      m.on('click', ()=>openPanel(d));
      (d.visited ? clusterDone : clusterTodo).addLayer(m);
    });
    $todo.checked && map.addLayer(clusterTodo) || map.removeLayer(clusterTodo);
    $done.checked && map.addLayer(clusterDone) || map.removeLayer(clusterDone);
  }

  $minRating.addEventListener('input', ()=>{ $ratingVal.textContent = $minRating.value; refresh(); });
  $todo.addEventListener('change', refresh);
  $done.addEventListener('change', refresh);
  $search.addEventListener('input', refresh);

  updateProgress(); refresh();

  // Center map on Brussels bounds from data if available
  if (data.length){
    const group = L.featureGroup([...clusterTodo.getLayers(), ...clusterDone.getLayers()]);
    try { map.fitBounds(group.getBounds().pad(0.1)); } catch(e) {}
  }
})();
