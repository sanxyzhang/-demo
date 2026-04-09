// ===== DOM =====
const placePoolEl = document.getElementById("placePool");
const addPlaceBtn = document.getElementById("addPlaceBtn");
const smartPlanBtn = document.getElementById("smartPlanBtn");
const smartPlanStatus = document.getElementById("smartPlanStatus");
const statusText = document.getElementById("statusText");
const planGrid = document.getElementById("planGrid");
const plannerInstructionEl = document.getElementById("plannerInstruction");
const adjustInstructionEl = document.getElementById("adjustInstruction");
const applyAdjustBtn = document.getElementById("applyAdjustBtn");

const poolPlaceTpl = document.getElementById("poolPlaceTemplate");

let map;
let routePolylines = [];
let routeMarkers = [];
const DEFAULT_DAY_SETUPS = [
  { dayName: "5.3 东京", hotel: "APA Hotel Asakusa Tawaramachi Ekimae" },
  { dayName: "5.4 东京", hotel: "APA Hotel Asakusa Tawaramachi Ekimae" },
  { dayName: "5.5 东京→横滨", hotel: "SOTETSU HOTELS THE SPLAISIR YOKOHAMA" },
  { dayName: "5.6 横滨→镰仓", hotel: "SOTETSU HOTELS THE SPLAISIR YOKOHAMA" },
  { dayName: "5.7 横滨收尾", hotel: "SOTETSU HOTELS THE SPLAISIR YOKOHAMA" },
];

// ===== Type helpers =====
const TYPE_BADGE = { 景点: "badge-attraction", 餐厅: "badge-restaurant", 商场: "badge-mall", 其他: "badge-other", 酒店: "badge-hotel" };
const TYPE_ICON  = { 景点: "🏛", 餐厅: "🍜", 商场: "🛍", 其他: "📍", 酒店: "🏨" };

function typeBadge(type) {
  return `<span class="type-badge ${TYPE_BADGE[type] || "badge-other"}">${TYPE_ICON[type] || "📍"} ${type}</span>`;
}

function updateStatus(t) { statusText.textContent = t; }
function setPlanStatus(t) { if (smartPlanStatus) smartPlanStatus.textContent = t; }

// ===== LocalStorage =====
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 600);
}

function persist() {
  try {
    localStorage.setItem("tripPlacePool", JSON.stringify(readPlacePool()));
    localStorage.setItem("tripPlanResults", JSON.stringify(planResults));
  } catch (_) {}
}

function loadFromStorage() {
  try {
    const places = JSON.parse(localStorage.getItem("tripPlacePool") || "[]");
    if (!places.length) return false;
    places.forEach(p => addPoolPlace(p.name, p.type));
    const saved = localStorage.getItem("tripPlanResults");
    if (saved) planResults = JSON.parse(saved);
    return true;
  } catch (_) { return false; }
}

// ===== Plan Results (keyed by dayIndex string) =====
let planResults = {};
let lastSmartInfo = null;

function readDaySetups() { return DEFAULT_DAY_SETUPS; }

// ===== Place Pool =====
function addPoolPlace(name = "", type = "景点") {
  const node = poolPlaceTpl.content.firstElementChild.cloneNode(true);
  const input = node.querySelector(".place-input");
  const typeSelect = node.querySelector(".place-type");
  const delBtn = node.querySelector(".delete-pool-place-btn");

  input.value = name;
  if (typeSelect) typeSelect.value = type;

  input.addEventListener("input", scheduleSave);
  typeSelect.addEventListener("change", scheduleSave);
  delBtn.addEventListener("click", () => { node.remove(); scheduleSave(); });

  placePoolEl.appendChild(node);
}

function readPlacePool() {
  return Array.from(placePoolEl.querySelectorAll(".pool-place-row")).map(row => ({
    name: row.querySelector(".place-input").value.trim(),
    type: row.querySelector(".place-type").value || "景点",
  })).filter(p => p.name);
}

// ===== Google Maps helpers =====
function clearMapOverlays() {
  routePolylines.forEach(p => p.setMap(null));
  routePolylines = [];
  routeMarkers.forEach(m => m.setMap(null));
  routeMarkers = [];
}

function renderRouteOnMap(encodedPolylines, orderedStops, stopPoints = []) {
  clearMapOverlays();
  if (!Array.isArray(encodedPolylines) || !encodedPolylines.length) return;

  const path = encodedPolylines.flatMap(p => google.maps.geometry.encoding.decodePath(p || ""));
  const poly = new google.maps.Polyline({ path, geodesic: true, strokeColor: "#1d4ed8", strokeOpacity: 0.85, strokeWeight: 5 });
  poly.setMap(map);
  routePolylines.push(poly);

  const bounds = new google.maps.LatLngBounds();
  path.forEach(p => bounds.extend(p));
  map.fitBounds(bounds);

  (stopPoints.length ? stopPoints : []).forEach((p, idx) => {
    routeMarkers.push(new google.maps.Marker({
      map,
      position: { lat: p.lat, lng: p.lng },
      label: String((idx + 1) % 10),
      title: `${idx + 1}. ${p.name}`,
    }));
  });
}

function buildGmapsUrl(stops) {
  return `https://www.google.com/maps/dir/${stops.map(v => encodeURIComponent(v)).join("/")}/`;
}

// ===== Plan Table: pre-render loading cards =====
function preRenderPlanGrid(daySetups) {
  if (!planGrid) return;
  planGrid.innerHTML = daySetups.map((d, i) => `
    <div class="plan-card" id="plan-card-${i}">
      <div class="plan-card-header">
        <div class="plan-day-index">Day ${i + 1}</div>
        <div class="plan-day-info">
          <div class="plan-day-name">${d.dayName || "未命名"}</div>
          <div class="plan-hotel-name">🏨 ${d.hotel || "（未设置酒店）"}</div>
        </div>
        <span class="plan-status status-loading" id="plan-status-${i}">⏳ 等待中</span>
      </div>
      <div class="plan-card-body" id="plan-body-${i}">
        <div class="plan-loading-placeholder">
          <div class="loading-bar"></div>
          <div class="loading-bar short"></div>
          <div class="loading-bar"></div>
        </div>
      </div>
    </div>
  `).join("");
}

// 单张卡片实时更新（规划完成一天立即刷新）
function updatePlanCard(i, daySetup, result) {
  const statusEl = document.getElementById(`plan-status-${i}`);
  const bodyEl = document.getElementById(`plan-body-${i}`);
  const card = document.getElementById(`plan-card-${i}`);
  if (!card) return;

  if (statusEl) {
    statusEl.className = "plan-status status-done";
    statusEl.textContent = "✓ 已优化";
  }
  if (bodyEl) bodyEl.innerHTML = renderPlanTimeline(result);

  // Footer with Google Maps link
  const existingFooter = card.querySelector(".plan-card-footer");
  if (existingFooter) existingFooter.remove();
  const footer = document.createElement("div");
  footer.className = "plan-card-footer";
  footer.innerHTML = `<a href="${result.mapsUrl}" target="_blank" rel="noopener noreferrer" class="plan-maps-btn">🗺 打开全天地图</a>`;
  card.appendChild(footer);

  // 点击卡片在地图上预览路线（仅当地图已就绪时）
  card.style.cursor = "pointer";
  card.onclick = () => {
    if (map && result.polylines) {
      renderRouteOnMap(result.polylines, result.orderedStops, result.stopPoints || []);
      updateStatus(`正在预览：${daySetup.dayName}`);
      switchTab("editor");
    }
  };
}

function markPlanCardFailed(i, reason) {
  const statusEl = document.getElementById(`plan-status-${i}`);
  const bodyEl = document.getElementById(`plan-body-${i}`);
  if (statusEl) { statusEl.className = "plan-status status-failed"; statusEl.textContent = "✗ 失败"; }
  if (bodyEl) bodyEl.innerHTML = `<div class="plan-error">${reason}</div>`;
}

// ===== Timeline rendering (optimized result) =====
function renderPlanTimeline(result) {
  const stops = result.orderedStops || [];
  const legs = result.legSummaries || [];

  // Build name → {type, visitDuration, description, tip} lookup
  const infoMap = {};
  (result.places || []).forEach(p => { infoMap[p.name] = p; });

  const items = stops.map((stop, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === stops.length - 1;
    const isHotel = isFirst || isLast;
    const info = infoMap[stop] || {};

    let stopHtml;
    if (isHotel) {
      stopHtml = `
        <div class="plan-stop-row hotel-row">
          ${typeBadge("酒店")}
          <span class="stop-name">${stop}</span>
          <span class="stop-role">${isFirst ? "出发" : "返回"}</span>
        </div>`;
    } else {
      const durHtml = info.visitDuration ? `<span class="stop-dur">约${info.visitDuration}分钟</span>` : "";
      const tipHtml = info.tip ? `<div class="stop-tip">💡 ${info.tip}</div>` : "";
      stopHtml = `
        <div class="plan-stop-row">
          <span class="stop-num">${idx}</span>
          ${typeBadge(info.type || "景点")}
          <div class="stop-detail">
            <div class="stop-name-row">
              <span class="stop-name">${stop}</span>
              ${durHtml}
            </div>
            ${info.description ? `<div class="stop-desc">${info.description}</div>` : ""}
            ${tipHtml}
          </div>
        </div>`;
    }

    const legHtml = idx < legs.length
      ? `<div class="plan-leg-row">
           <span class="leg-arrow">↓</span>
           <span class="leg-info">${legs[idx].durationText || "-"} · ${legs[idx].distanceText || "-"}</span>
         </div>`
      : "";

    return stopHtml + legHtml;
  });

  return `<div class="plan-timeline">${items.join("")}</div>`;
}

// ===== Smart Plan (core flow) =====
async function smartPlan() {
  const daySetups = readDaySetups();
  const places = readPlacePool();

  if (daySetups.length === 0) {
    alert("请先在「行程设置」中添加天数和酒店");
    return;
  }
  if (places.length === 0) {
    alert("请先在「地点池」中添加景点/餐厅/商场");
    return;
  }

  // Switch to plan tab and pre-render loading cards
  switchTab("plan");
  planResults = {};
  preRenderPlanGrid(daySetups);

  const planTableStatus = document.getElementById("planTableStatus");
  function setStatus(t) {
    setPlanStatus(t);
    if (planTableStatus) planTableStatus.textContent = t;
  }

  // ── Step 1: Call Cursor LLM for place details + day assignments ──
  setStatus("⏳ 正在查询景点详情与分配行程...");
  let smartInfo;
  try {
    const instruction = (plannerInstructionEl?.value || "").trim();
    const res = await fetch("/api/smart-plan-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places, daySetups, instruction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "smart-plan-info 请求失败");
    smartInfo = data; // { places: [{name, visitDuration, description, tip, bestTimeSlot, dayIndex}] }
    lastSmartInfo = smartInfo;
    if (data.plannerSource) {
      if (data.plannerSource !== "cursor" && data.cursorDebug) {
        setStatus(`⚠ 分配回退到 ${data.plannerSource}：${data.cursorDebug}`);
      } else {
        setStatus(`✅ 分配完成（来源：${data.plannerSource}），开始逐天规划路线...`);
      }
    }
  } catch (err) {
    setStatus(`❌ 获取景点信息失败：${err.message}`);
    daySetups.forEach((_, i) => markPlanCardFailed(i, "智能规划请求失败：请检查网络、GOOGLE_MAPS_API_KEY 与代理配置"));
    return;
  }

  // Build lookup maps from LLM result
  const placeInfoMap = {}; // name → full info
  const dayBuckets = {}; // dayIndex → [placeInfo]
  daySetups.forEach((_, i) => { dayBuckets[i] = []; });

  (smartInfo.places || []).forEach(p => {
    placeInfoMap[p.name] = p;
    const idx = Math.max(0, Math.min(p.dayIndex, daySetups.length - 1));
    if (!dayBuckets[idx]) dayBuckets[idx] = [];
    dayBuckets[idx].push(p);
  });

  setStatus(`✅ 景点分配完成，开始逐天规划路线...`);

  // ── Step 2: Plan each day, update card in real-time ──
  let successCount = 0;
  for (let i = 0; i < daySetups.length; i++) {
    const { dayName, hotel } = daySetups[i];
    const bucket = dayBuckets[i] || [];

    if (!hotel) {
      markPlanCardFailed(i, "未填写酒店，跳过路线规划");
      continue;
    }
    if (bucket.length === 0) {
      markPlanCardFailed(i, "当天无分配地点");
      continue;
    }

    const statusEl = document.getElementById(`plan-status-${i}`);
    if (statusEl) { statusEl.className = "plan-status status-loading"; statusEl.textContent = "⏳ 规划中..."; }
    setStatus(`正在规划第 ${i + 1} 天：${dayName}`);

    try {
      const placeNames = bucket.filter(p => p.geocoded !== false).map(p => p.name);
      if (placeNames.length === 0) {
        markPlanCardFailed(i, "当天地点未能解析坐标，已跳过");
        continue;
      }
      const res = await fetch("/api/plan-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotel, places: placeNames, travelMode: "driving", strictTransit: false }),
      });
      const data = await res.json();

      if (!res.ok) {
        markPlanCardFailed(i, data.error || "路线规划失败");
        continue;
      }

      // Enrich orderedStops with type/duration info from LLM
      const enrichedPlaces = (data.orderedStops || [])
        .filter(name => name !== hotel)  // exclude hotel stops
        .map(name => placeInfoMap[name] || { name, type: "景点" });

      planResults[String(i)] = {
        dayName,
        hotel,
        places: enrichedPlaces,
        orderedStops: data.orderedStops,
        legSummaries: data.legSummaries || [],
        stopPoints: data.stopPoints || [],
        polylines: data.polylines,
        mapsUrl: buildGmapsUrl(data.orderedStops),
      };

      persist();
      updatePlanCard(i, daySetups[i], planResults[String(i)]);

      // Update map with last planned day
      if (map && data.polylines) {
        renderRouteOnMap(data.polylines, data.orderedStops, data.stopPoints || []);
        updateStatus(`已规划：${dayName}`);
      }

      successCount++;
    } catch (err) {
      markPlanCardFailed(i, err.message);
    }
  }

  setStatus(`🎉 规划完成，共 ${successCount}/${daySetups.length} 天成功`);
  persist();
}

async function applyAdjustment() {
  const daySetups = readDaySetups();
  const instruction = (adjustInstructionEl?.value || "").trim();
  if (!instruction) {
    alert("请先输入二次调节指令");
    return;
  }
  if (!lastSmartInfo?.places?.length) {
    alert("请先完成一次规划，再进行二次调节");
    return;
  }
  setPlanStatus("⏳ 正在应用二次调节...");
  const planTableStatus = document.getElementById("planTableStatus");
  if (planTableStatus) planTableStatus.textContent = "⏳ 正在应用二次调节...";
  try {
    const res = await fetch("/api/adjust-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        daySetups,
        currentPlaces: lastSmartInfo.places,
        instruction,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "二次调节失败");
    lastSmartInfo = { places: data.places || [] };
    await smartPlanWithProvidedAssignments(lastSmartInfo, daySetups, "二次调节已应用，");
  } catch (err) {
    setPlanStatus(`❌ 二次调节失败：${err.message}`);
    if (planTableStatus) planTableStatus.textContent = `❌ 二次调节失败：${err.message}`;
  }
}

async function smartPlanWithProvidedAssignments(smartInfo, daySetups, prefix = "") {
  switchTab("plan");
  planResults = {};
  preRenderPlanGrid(daySetups);

  const placeInfoMap = {};
  const dayBuckets = {};
  daySetups.forEach((_, i) => { dayBuckets[i] = []; });
  (smartInfo.places || []).forEach(p => {
    placeInfoMap[p.name] = p;
    const idx = Math.max(0, Math.min(p.dayIndex, daySetups.length - 1));
    if (!dayBuckets[idx]) dayBuckets[idx] = [];
    dayBuckets[idx].push(p);
  });

  let successCount = 0;
  for (let i = 0; i < daySetups.length; i++) {
    const { dayName, hotel } = daySetups[i];
    const bucket = dayBuckets[i] || [];
    if (!hotel) { markPlanCardFailed(i, "未填写酒店，跳过路线规划"); continue; }
    if (bucket.length === 0) { markPlanCardFailed(i, "当天无分配地点"); continue; }
    try {
      const placeNames = bucket.filter(p => p.geocoded !== false).map(p => p.name);
      if (placeNames.length === 0) { markPlanCardFailed(i, "当天地点未能解析坐标，已跳过"); continue; }
      const res = await fetch("/api/plan-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotel, places: placeNames, travelMode: "driving", strictTransit: false }),
      });
      const data = await res.json();
      if (!res.ok) { markPlanCardFailed(i, data.error || "路线规划失败"); continue; }
      const enrichedPlaces = (data.orderedStops || []).filter(name => name !== hotel).map(name => placeInfoMap[name] || { name, type: "景点" });
      planResults[String(i)] = {
        dayName, hotel, places: enrichedPlaces, orderedStops: data.orderedStops, legSummaries: data.legSummaries || [],
        stopPoints: data.stopPoints || [], polylines: data.polylines, mapsUrl: buildGmapsUrl(data.orderedStops),
      };
      updatePlanCard(i, daySetups[i], planResults[String(i)]);
      successCount++;
    } catch (err) {
      markPlanCardFailed(i, err.message);
    }
  }
  const msg = `${prefix}规划完成，共 ${successCount}/${daySetups.length} 天成功`;
  setPlanStatus(`🎉 ${msg}`);
  const planTableStatus = document.getElementById("planTableStatus");
  if (planTableStatus) planTableStatus.textContent = `🎉 ${msg}`;
  persist();
}

// ===== Tab Switching =====
function switchTab(tabName) {
  document.querySelectorAll(".tab-section").forEach(s => s.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const sectionId = "tab" + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  document.getElementById(sectionId)?.classList.remove("hidden");
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
  if (tabName === "plan") renderPlanTableFromCache();
}

// Render plan table from cached results (e.g. on tab switch without re-planning)
function renderPlanTableFromCache() {
  if (!planGrid) return;
  const daySetups = readDaySetups();
  if (daySetups.length === 0) {
    planGrid.innerHTML = '<div class="plan-empty">请先在「编辑行程」中设置行程天数和添加地点。</div>';
    return;
  }
  // If no results yet, show placeholder cards
  const hasResults = Object.keys(planResults).length > 0;
  if (!hasResults) {
    planGrid.innerHTML = daySetups.map((d, i) => `
      <div class="plan-card">
        <div class="plan-card-header">
          <div class="plan-day-index">Day ${i + 1}</div>
          <div class="plan-day-info">
            <div class="plan-day-name">${d.dayName || "未命名"}</div>
            <div class="plan-hotel-name">🏨 ${d.hotel || "（未设置酒店）"}</div>
          </div>
          <span class="plan-status status-pending">未规划</span>
        </div>
        <div class="plan-card-body">
          <div class="plan-hint">点击「智能规划所有天」生成计划</div>
        </div>
      </div>
    `).join("");
    return;
  }
  // Has results: render full plan table
  preRenderPlanGrid(daySetups);
  daySetups.forEach((d, i) => {
    const result = planResults[String(i)];
    if (result) updatePlanCard(i, d, result);
    else markPlanCardFailed(i, "未规划");
  });
}

// ===== Google Maps Init =====
function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) { reject(new Error("缺少 GOOGLE_MAPS_API_KEY")); return; }
    window.initMap = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMap&loading=async&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Maps 脚本加载失败"));
    document.head.appendChild(script);
  });
}

// ===== Init =====
async function init() {
  // Tab navigation
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  addPlaceBtn.addEventListener("click", () => addPoolPlace());
  smartPlanBtn.addEventListener("click", smartPlan);
  document.getElementById("planAllBtn2")?.addEventListener("click", smartPlan);
  applyAdjustBtn?.addEventListener("click", applyAdjustment);

  // Load saved data, else populate demo data
  const loaded = loadFromStorage();
  if (!loaded) {
    // Demo: place pool
    [
      ["代代木公园", "景点"], ["下北泽", "商场"], ["合羽桥道具街", "商场"],
      ["浅草寺", "景点"], ["隅田川", "景点"], ["横滨红砖仓库", "景点"],
      ["横滨港未来", "景点"], ["长谷寺", "景点"], ["高德院", "景点"],
      ["镰仓高校前站", "景点"], ["七里滨", "景点"], ["小町通", "商场"],
      ["一兰拉面", "餐厅"], ["横滨站周边", "商场"],
    ].forEach(([name, type]) => addPoolPlace(name, type));
  }

  // Google Maps
  try {
    await loadGoogleMapsScript(window.APP_CONFIG?.GOOGLE_MAPS_API_KEY);
    map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: 35.681236, lng: 139.767125 },
      zoom: 11,
      mapTypeControl: false,
    });
    updateStatus("地图已就绪");
  } catch (err) {
    updateStatus(`地图初始化失败：${err.message}`);
  }
}

init();
