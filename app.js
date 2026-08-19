(() => {
  "use strict";

  const CONTACT_EMAIL = "fhfhfhrod@gmail.com";
  const dataset = window.KNEWNEW_DATA || { stats: {}, places: [] };
  const places = (dataset.places || []).filter((place) =>
    Number.isFinite(place.lat) && Number.isFinite(place.lng) && !place.geo_suspect);

  const CATEGORY_CONFIG = {
    "술집": { className: "marker-bar", color: "var(--bar)" },
    "카페": { className: "marker-cafe", color: "var(--cafe)" },
    "독서": { className: "marker-books", color: "var(--books)" },
    "걸스": { className: "marker-girls", color: "var(--girls)" },
    "맛집": { className: "marker-food", color: "var(--food)" },
    "쇼핑": { className: "marker-shopping", color: "var(--shopping)" },
    "전시·문화": { className: "marker-culture", color: "var(--culture)" },
    "여행·숙소": { className: "marker-travel", color: "var(--travel)" },
    "기타": { className: "", color: "var(--other)" }
  };
  const CATEGORY_ORDER = Object.keys(CATEGORY_CONFIG);

  const state = {
    query: "",
    categories: new Set(),
    accounts: new Set(),
    adMode: "all",
    crossAccountOnly: false,
    region: "",
    district: "",
    locality: "",
    userLocation: null,
    radiusKm: null,
    sort: "recommended",
    selectedId: null,
    detailId: null
  };

  const dom = {
    categoryFilters: document.querySelector("#categoryFilters"),
    accountFilters: document.querySelector("#accountFilters"),
    accountAddForm: document.querySelector("#accountAddForm"),
    accountAddInput: document.querySelector("#accountAddInput"),
    searchInput: document.querySelector("#searchInput"),
    placeList: document.querySelector("#placeList"),
    placeCount: document.querySelector("#placeCount"),
    postCount: document.querySelector("#postCount"),
    crossCount: document.querySelector("#crossCount"),
    resultCount: document.querySelector("#resultCount"),
    sortSelect: document.querySelector("#sortSelect"),
    crossAccountOnly: document.querySelector("#crossAccountOnly"),
    clearCategories: document.querySelector("#clearCategories"),
    clearAdmin: document.querySelector("#clearAdmin"),
    clearNearby: document.querySelector("#clearNearby"),
    useMyLocation: document.querySelector("#useMyLocation"),
    mapLocate: document.querySelector("#mapLocate"),
    radiusSelect: document.querySelector("#radiusSelect"),
    locationStatus: document.querySelector("#locationStatus"),
    regionSelect: document.querySelector("#regionSelect"),
    districtSelect: document.querySelector("#districtSelect"),
    localitySelect: document.querySelector("#localitySelect"),
    distanceSortOption: document.querySelector("#distanceSortOption"),
    userLocationKey: document.querySelector("#userLocationKey"),
    filterToggle: document.querySelector("#filterToggle"),
    filterPanel: document.querySelector("#filterPanel"),
    activeFilterCount: document.querySelector("#activeFilterCount"),
    fitMap: document.querySelector("#fitMap"),
    template: document.querySelector("#placeCardTemplate")
  };

  const map = L.map("map", { zoomControl: false, minZoom: 3, worldCopyJump: true }).setView([37.5665, 126.978], 11);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }).addTo(map);

  const markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 46,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17
  });
  map.addLayer(markerCluster);
  map.on("popupopen", () => processEmbeds());

  const markers = new Map();
  const MOBILE_LAYOUT = window.matchMedia("(max-width: 860px)");
  const isMobile = () => MOBILE_LAYOUT.matches;
  const customAccounts = new Set(JSON.parse(localStorage.getItem("comap_custom_accounts") || "[]"));
  let dataAccountTotal = 0;
  let userMarker = null;
  let userAccuracyCircle = null;
  let visiblePlaces = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
  }

  function adminParts(address) {
    const parts = String(address || "").trim().split(/\s+/).filter(Boolean);
    const region = parts[0] || "";
    const administrative = parts.slice(1).filter((part) => /(?:특별자치시|시|군|구|읍|면|동|가)$/.test(part));
    return {
      region,
      district: administrative[0] || "",
      locality: administrative[1] || ""
    };
  }

  function distanceKm(from, to) {
    if (!from || !to) return Number.POSITIVE_INFINITY;
    const radians = (degrees) => degrees * Math.PI / 180;
    const latDistance = radians(to.lat - from.lat);
    const lngDistance = radians(to.lng - from.lng);
    const a = Math.sin(latDistance / 2) ** 2
      + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDistance / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function userDistance(place) {
    return distanceKm(state.userLocation, { lat: place.lat, lng: place.lng });
  }

  function distanceLabel(distance) {
    if (!Number.isFinite(distance)) return "";
    if (distance < 1) return `${Math.max(10, Math.round(distance * 1000 / 10) * 10)}m`;
    return `${distance.toFixed(distance < 10 ? 1 : 0)}km`;
  }

  function latestDate(place) {
    return place.mentions?.[0]?.date || "";
  }

  function primaryCategory(place) {
    return CATEGORY_ORDER.find((category) => place.categories?.includes(category)) || "기타";
  }

  function categoryClass(place) {
    return CATEGORY_CONFIG[primaryCategory(place)]?.className || "";
  }

  function categoryColor(place) {
    return CATEGORY_CONFIG[primaryCategory(place)]?.color || "var(--other)";
  }

  function popupHtml(place) {
    const accounts = (place.source_accounts || []).map((account) => `@${escapeHtml(account)}`).join(" · ");
    const tags = (place.categories || []).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    const sources = (place.mentions || []).slice(0, 4).map((mention) => `
      <a href="${escapeHtml(mention.post_url)}" target="_blank" rel="noopener">
        <span>@${escapeHtml(mention.source_username)}</span>
        <time>${escapeHtml(mention.date.replaceAll("-", "."))}</time>
        ${mention.is_ad ? '<b>AD</b>' : ''}
        <i aria-hidden="true">↗</i>
      </a>`).join("");
    const adMessage = place.ad_recommendation_count
      ? `<p class="popup-ad">광고 표기 추천 ${formatNumber(place.ad_recommendation_count)}건 포함</p>`
      : "";
    return `
      <div class="popup-card">
        <p class="popup-kicker">${accounts || "Knewnew archive"}</p>
        <h3>${escapeHtml(place.name)}</h3>
        <p class="popup-address">${escapeHtml(place.address || place.area_hint || "주소 확인 중")}</p>
        <div class="popup-stats">
          <div><strong>${formatNumber(place.recommendation_count)}</strong><span>추천 게시물</span></div>
          <div><strong>${formatNumber(place.account_count)}</strong><span>추천 계정</span></div>
        </div>
        <div class="popup-tags">${tags}</div>
        ${adMessage}
        <div class="popup-sources">
          <p>추천 출처</p>
          ${sources}
        </div>
        <div class="popup-links detail-links">
          <a href="${escapeHtml(place.naver_url)}" target="_blank" rel="noopener">네이버지도</a>
          <a href="${escapeHtml(place.kakao_url)}" target="_blank" rel="noopener">카카오맵</a>
          ${place.kakao_url ? `<a href="${escapeHtml(place.kakao_url)}#menuInfo" target="_blank" rel="noopener">메뉴판</a>` : ""}
        </div>
        ${place.mentions?.length ? `
        <div class="detail-embed">
          <p>분위기 · 메뉴</p>
          <blockquote class="instagram-media" data-instgrm-permalink="${escapeHtml(place.mentions[0].post_url)}" data-instgrm-version="14"></blockquote>
        </div>` : ""}
      </div>`;
  }

  function detailHtml(place) {
    const accounts = (place.source_accounts || []).map((account) => `@${escapeHtml(account)}`).join(" · ");
    const tags = (place.categories || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    const sources = (place.mentions || []).slice(0, 8).map((mention) => `
      <a href="${escapeHtml(mention.post_url)}" target="_blank" rel="noopener">
        <span>@${escapeHtml(mention.source_username)}</span>
        <time>${escapeHtml(mention.date.replaceAll("-", "."))}</time>
        ${mention.is_ad ? '<b>AD</b>' : ''}
        <i aria-hidden="true">↗</i>
      </a>`).join("");
    const adMessage = place.ad_recommendation_count
      ? `<p class="popup-ad">광고 표기 추천 ${formatNumber(place.ad_recommendation_count)}건 포함</p>`
      : "";
    const distance = state.userLocation ? distanceLabel(userDistance(place)) : "";
    return `
      <div class="place-detail">
        <button type="button" class="detail-back" id="detailBack">← 목록으로</button>
        <p class="popup-kicker">${accounts || "comap archive"}</p>
        <h2>${escapeHtml(place.name)}</h2>
        <p class="popup-address">${escapeHtml(place.address || place.area_hint || "주소 확인 중")}${distance ? ` · <b class="detail-distance">${distance}</b>` : ""}</p>
        <div class="popup-stats">
          <div><strong>${formatNumber(place.recommendation_count)}</strong><span>추천 게시물</span></div>
          <div><strong>${formatNumber(place.account_count)}</strong><span>추천 계정</span></div>
        </div>
        <div class="popup-tags">${tags}</div>
        ${adMessage}
        <div class="popup-sources">
          <p>추천 출처</p>
          ${sources}
        </div>
        <a class="detail-report" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[comap] 정보 제보: ${place.name}`)}">잘못된 정보 제보 ↗</a>
        ${isMobile() && place.mentions?.length ? `
        <div class="detail-embed">
          <p>분위기 · 메뉴</p>
          <blockquote class="instagram-media" data-instgrm-permalink="${escapeHtml(place.mentions[0].post_url)}" data-instgrm-version="14"></blockquote>
        </div>` : ""}
        <div class="popup-links detail-links">
          <a href="${escapeHtml(place.naver_url)}" target="_blank" rel="noopener">네이버지도</a>
          <a href="${escapeHtml(place.kakao_url)}" target="_blank" rel="noopener">카카오맵</a>
          ${place.kakao_url ? `<a href="${escapeHtml(place.kakao_url)}#menuInfo" target="_blank" rel="noopener">메뉴판</a>` : ""}
        </div>
      </div>`;
  }

  let igEmbedScript = null;
  function processEmbeds() {
    if (window.instgrm?.Embeds) {
      window.instgrm.Embeds.process();
      return;
    }
    if (!igEmbedScript) {
      igEmbedScript = document.createElement("script");
      igEmbedScript.src = "https://www.instagram.com/embed.js";
      igEmbedScript.async = true;
      document.body.appendChild(igEmbedScript);
    }
  }

  function openDetail(id) {
    state.detailId = id;
    state.selectedId = id;
    document.querySelector(".sidebar").classList.add("detail-open");
    renderList();
  }

  function closeDetail() {
    state.detailId = null;
    document.querySelector(".sidebar").classList.remove("detail-open");
    renderList();
  }

  function markerIcon(place) {
    const adClass = place.ad_recommendation_count > 0 ? "has-ad" : "";
    const crossClass = place.account_count > 1 ? "cross" : "";
    return L.divIcon({
      className: "place-marker-wrap",
      html: `<div class="place-marker ${categoryClass(place)} ${adClass} ${crossClass}"></div>`,
      iconSize: [24, 24],
      iconAnchor: [11, 22],
      popupAnchor: [0, -21]
    });
  }

  function ensureMarkers() {
    for (const place of places) {
      if (markers.has(place.id)) continue;
      const marker = L.marker([place.lat, place.lng], { icon: markerIcon(place), title: place.name });
      // 모바일: 팝업 autoPan 이동 + 고스트 클릭으로 팝업이 바로 닫히는 문제 → 상세 패널로 일원화
      if (!isMobile()) marker.bindPopup(popupHtml(place), { maxWidth: 320, offset: L.point(0, -2) });
      marker.on("click", () => openDetail(place.id));
      markers.set(place.id, marker);
    }
  }

  function matchesFilters(place) {
    if (state.query) {
      const haystack = normalize([
        place.name,
        place.address,
        place.area_hint,
        ...(place.aliases || []),
        ...(place.categories || [])
      ].join(" "));
      if (!haystack.includes(normalize(state.query))) return false;
    }
    if (state.categories.size && !(place.categories || []).some((category) => state.categories.has(category))) return false;
    if (state.accounts.size && !(place.source_accounts || []).some((account) => state.accounts.has(account))) return false;
    if (state.adMode === "ad" && !(place.ad_recommendation_count > 0)) return false;
    if (state.adMode === "organic" && place.ad_recommendation_count > 0) return false;
    if (state.crossAccountOnly && !(place.account_count >= Math.max(2, dataAccountTotal))) return false;
    if (state.region && place._admin.region !== state.region) return false;
    if (state.district && place._admin.district !== state.district) return false;
    if (state.locality && place._admin.locality !== state.locality) return false;
    if (state.userLocation && state.radiusKm && userDistance(place) > state.radiusKm) return false;
    return true;
  }

  function sortPlaces(input) {
    const rows = [...input];
    if (state.sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (state.sort === "latest") return rows.sort((a, b) => latestDate(b).localeCompare(latestDate(a)));
    if (state.sort === "distance" && state.userLocation) return rows.sort((a, b) => userDistance(a) - userDistance(b));
    return rows.sort((a, b) =>
      b.account_count - a.account_count ||
      b.recommendation_count - a.recommendation_count ||
      latestDate(b).localeCompare(latestDate(a))
    );
  }

  function renderList() {
    dom.placeList.textContent = "";
    if (state.detailId) {
      const place = places.find((row) => row.id === state.detailId);
      if (place) {
        dom.placeList.innerHTML = detailHtml(place);
        dom.placeList.querySelector("#detailBack").addEventListener("click", closeDetail);
        dom.placeList.scrollTop = 0;
        processEmbeds();
        return;
      }
      state.detailId = null;
    }
    if (!visiblePlaces.length) {
      dom.placeList.innerHTML = `<div class="empty-state"><strong>No places found.</strong>필터를 줄이거나 다른 검색어를 입력해 보세요.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    visiblePlaces.forEach((place) => {
      const card = dom.template.content.firstElementChild.cloneNode(true);
      card.dataset.id = place.id;
      card.classList.toggle("cross-account", place.account_count > 1);
      card.classList.toggle("has-ad", place.ad_recommendation_count > 0);
      card.classList.toggle("active", state.selectedId === place.id);
      card.querySelector(".category-dot").style.background = categoryColor(place);
      card.querySelector("h2").textContent = place.name;
      card.querySelector(".place-address").textContent = place.address || place.area_hint || "주소 확인 중";
      card.querySelector(".account-count").textContent = `×${place.account_count}`;
      card.querySelector(".recommendation-count").textContent = `추천 ${formatNumber(place.recommendation_count)}회`;
      const distanceBadge = card.querySelector(".distance-badge");
      distanceBadge.textContent = state.userLocation ? distanceLabel(userDistance(place)) : "";
      distanceBadge.hidden = !state.userLocation;
      card.querySelector("time").textContent = latestDate(place).replaceAll("-", ".");
      card.querySelector(".place-tags").innerHTML = (place.categories || []).slice(0, 4)
        .map((tag) => `<span class="place-tag">${escapeHtml(tag)}</span>`).join("");
      const open = () => selectPlace(place.id, { scroll: false, zoom: true });
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      fragment.appendChild(card);
    });
    dom.placeList.appendChild(fragment);
  }

  function renderMarkers() {
    markerCluster.clearLayers();
    visiblePlaces.forEach((place) => markerCluster.addLayer(markers.get(place.id)));
  }

  function renderActiveFilterCount() {
    const count = state.categories.size
      + state.accounts.size
      + (state.adMode !== "all" ? 1 : 0)
      + (state.crossAccountOnly ? 1 : 0)
      + (state.region ? 1 : 0)
      + (state.district ? 1 : 0)
      + (state.locality ? 1 : 0)
      + (state.userLocation && state.radiusKm ? 1 : 0);
    dom.activeFilterCount.textContent = count;
  }

  function updateResults() {
    state.detailId = null;
    document.querySelector(".sidebar").classList.remove("detail-open");
    visiblePlaces = sortPlaces(places.filter(matchesFilters));
    dom.resultCount.textContent = formatNumber(visiblePlaces.length);
    renderList();
    renderMarkers();
    renderActiveFilterCount();
  }

  function selectPlace(id, { scroll = false, zoom = true } = {}) {
    const place = places.find((row) => row.id === id);
    const marker = markers.get(id);
    if (!place || !marker) return;
    state.selectedId = id;
    const reveal = () => markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
    if (zoom) {
      map.once("moveend", reveal);
      map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 15), { duration: .5 });
    } else {
      reveal();
    }
    document.querySelectorAll(".place-card").forEach((card) => card.classList.toggle("active", card.dataset.id === id));
    if (scroll) document.querySelector(`.place-card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function fitVisible() {
    if (!visiblePlaces.length) return;
    const bounds = L.latLngBounds(visiblePlaces.map((place) => [place.lat, place.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }

  function setSelectOptions(select, placeholder, values, selectedValue = "") {
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.includes(selectedValue) ? selectedValue : "";
  }

  function refreshAdminOptions() {
    const regions = [...new Set(places.map((place) => place._admin.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    setSelectOptions(dom.regionSelect, "시·도 전체", regions, state.region);

    const districtRows = state.region ? places.filter((place) => place._admin.region === state.region) : [];
    const districts = [...new Set(districtRows.map((place) => place._admin.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    setSelectOptions(dom.districtSelect, "시·군·구 전체", districts, state.district);
    dom.districtSelect.disabled = !state.region || !districts.length;

    const localityRows = state.district
      ? districtRows.filter((place) => place._admin.district === state.district)
      : [];
    const localities = [...new Set(localityRows.map((place) => place._admin.locality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    setSelectOptions(dom.localitySelect, "세부 지역 전체", localities, state.locality);
    dom.localitySelect.disabled = !state.district || !localities.length;
  }

  function renderUserLocation() {
    if (!state.userLocation) return;
    const point = [state.userLocation.lat, state.userLocation.lng];
    if (userMarker) map.removeLayer(userMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);
    const icon = L.divIcon({
      className: "user-location-wrap",
      html: '<span class="user-location-dot"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    userAccuracyCircle = L.circle(point, {
      radius: Math.max(20, state.userLocation.accuracy || 0),
      color: "#2563eb",
      weight: 1,
      opacity: .5,
      fillColor: "#2563eb",
      fillOpacity: .08,
      interactive: false
    }).addTo(map);
    userMarker = L.marker(point, { icon, zIndexOffset: 1200, title: "내 위치" })
      .addTo(map)
      .bindTooltip("내 위치", { direction: "top", offset: [0, -10] });
    dom.userLocationKey.hidden = false;
  }

  function setLocationLoading(loading) {
    dom.useMyLocation.disabled = loading;
    dom.mapLocate.disabled = loading;
    dom.useMyLocation.classList.toggle("loading", loading);
    dom.useMyLocation.querySelector("span").textContent = loading ? "위치 확인 중" : (state.userLocation ? "위치 새로고침" : "내 위치 찾기");
  }

  function updateLocationStatus(message) {
    if (message) {
      dom.locationStatus.textContent = message;
      return;
    }
    if (!state.userLocation) {
      dom.locationStatus.textContent = "위치를 허용하면 가까운 장소부터 볼 수 있어요.";
      return;
    }
    const accuracy = state.userLocation.accuracy ? `정확도 약 ${Math.round(state.userLocation.accuracy)}m` : "내 위치 표시 중";
    const radius = state.radiusKm ? ` · 반경 ${state.radiusKm}km 검색` : " · 거리 제한 없음";
    dom.locationStatus.textContent = accuracy + radius;
  }

  function requestUserLocation() {
    if (!navigator.geolocation) {
      updateLocationStatus("이 브라우저에서는 위치 기능을 지원하지 않아요.");
      return;
    }
    setLocationLoading(true);
    updateLocationStatus("현재 위치를 확인하고 있어요…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        dom.radiusSelect.disabled = false;
        state.radiusKm = Number(dom.radiusSelect.value) || null;
        dom.clearNearby.disabled = !state.radiusKm;
        dom.distanceSortOption.disabled = false;
        state.sort = "distance";
        dom.sortSelect.value = "distance";
        renderUserLocation();
        setLocationLoading(false);
        updateLocationStatus();
        updateResults();
        map.flyTo([state.userLocation.lat, state.userLocation.lng], state.radiusKm && state.radiusKm <= 3 ? 14 : 12, { duration: .6 });
      },
      (error) => {
        setLocationLoading(false);
        const messages = {
          1: "위치 권한이 거부됐어요. 브라우저 설정에서 위치 접근을 허용해 주세요.",
          2: "현재 위치를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
          3: "위치 확인 시간이 초과됐어요. 다시 시도해 주세요."
        };
        updateLocationStatus(messages[error.code] || "위치를 불러오지 못했어요.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function buildFilters() {
    const categoryCounts = new Map();
    const accountCounts = new Map();
    places.forEach((place) => {
      (place.categories || []).forEach((category) => categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1));
      (place.source_accounts || []).forEach((account) => accountCounts.set(account, (accountCounts.get(account) || 0) + 1));
    });

    CATEGORY_ORDER.filter((category) => categoryCounts.has(category)).forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-chip";
      button.dataset.category = category;
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = `${escapeHtml(category)} <span class="chip-count">${formatNumber(categoryCounts.get(category))}</span>`;
      button.addEventListener("click", () => {
        state.categories.has(category) ? state.categories.delete(category) : state.categories.add(category);
        button.classList.toggle("active", state.categories.has(category));
        button.setAttribute("aria-pressed", String(state.categories.has(category)));
        updateResults();
      });
      dom.categoryFilters.appendChild(button);
    });

    dataAccountTotal = accountCounts.size;
    renderAccountChips(accountCounts);

    dom.accountAddForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const account = dom.accountAddInput.value.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9._]{2,30}$/.test(account)) {
        dom.accountAddInput.value = "";
        dom.accountAddInput.placeholder = "영문 계정명만 입력할 수 있어요";
        return;
      }
      customAccounts.add(account);
      localStorage.setItem("comap_custom_accounts", JSON.stringify([...customAccounts]));
      dom.accountAddInput.value = "";
      dom.accountAddInput.placeholder = "@계정 추가";
      renderAccountChips(accountCounts);
      updateResults();
    });
  }

  function makeAccountChip(account, count, removable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip account-chip";
    button.dataset.account = account;
    button.classList.toggle("active", state.accounts.has(account));
    button.setAttribute("aria-pressed", String(state.accounts.has(account)));
    button.innerHTML = `@${escapeHtml(account)} <span class="chip-count">${formatNumber(count)}</span>${removable ? '<span class="chip-remove" title="계정 삭제" aria-label="계정 삭제">×</span>' : ""}`;
    button.addEventListener("click", (event) => {
      if (removable && event.target.classList.contains("chip-remove")) {
        customAccounts.delete(account);
        state.accounts.delete(account);
        localStorage.setItem("comap_custom_accounts", JSON.stringify([...customAccounts]));
        button.remove();
        updateResults();
        return;
      }
      state.accounts.has(account) ? state.accounts.delete(account) : state.accounts.add(account);
      button.classList.toggle("active", state.accounts.has(account));
      button.setAttribute("aria-pressed", String(state.accounts.has(account)));
      updateResults();
    });
    return button;
  }

  function renderAccountChips(accountCounts) {
    dom.accountFilters.textContent = "";
    [...accountCounts.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([account, count]) => dom.accountFilters.appendChild(makeAccountChip(account, count, false)));
    [...customAccounts].sort().forEach((account) => {
      if (accountCounts.has(account)) return;
      const count = places.filter((place) => (place.source_accounts || []).includes(account)).length;
      dom.accountFilters.appendChild(makeAccountChip(account, count, true));
    });
  }

  function bindControls() {
    let searchTimer;
    dom.searchInput.addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = event.target.value.trim();
        updateResults();
      }, 120);
    });

    document.querySelectorAll("[data-ad-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.adMode = button.dataset.adMode;
        document.querySelectorAll("[data-ad-mode]").forEach((row) => row.classList.toggle("active", row === button));
        updateResults();
      });
    });

    dom.crossAccountOnly.addEventListener("change", (event) => {
      state.crossAccountOnly = event.target.checked;
      updateResults();
    });

    dom.sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      updateResults();
    });

    dom.regionSelect.addEventListener("change", (event) => {
      state.region = event.target.value;
      state.district = "";
      state.locality = "";
      refreshAdminOptions();
      updateResults();
      setTimeout(fitVisible, 0);
    });

    dom.districtSelect.addEventListener("change", (event) => {
      state.district = event.target.value;
      state.locality = "";
      refreshAdminOptions();
      updateResults();
      setTimeout(fitVisible, 0);
    });

    dom.localitySelect.addEventListener("change", (event) => {
      state.locality = event.target.value;
      updateResults();
      setTimeout(fitVisible, 0);
    });

    dom.clearAdmin.addEventListener("click", () => {
      state.region = "";
      state.district = "";
      state.locality = "";
      refreshAdminOptions();
      updateResults();
      setTimeout(fitVisible, 0);
    });

    dom.useMyLocation.addEventListener("click", requestUserLocation);
    dom.mapLocate.addEventListener("click", requestUserLocation);
    dom.radiusSelect.addEventListener("change", (event) => {
      if (!state.userLocation) return;
      state.radiusKm = Number(event.target.value) || null;
      dom.clearNearby.disabled = !state.radiusKm;
      updateLocationStatus();
      updateResults();
      if (state.radiusKm) map.flyTo([state.userLocation.lat, state.userLocation.lng], state.radiusKm <= 3 ? 14 : state.radiusKm <= 10 ? 12 : 10, { duration: .5 });
    });

    dom.clearNearby.addEventListener("click", () => {
      state.radiusKm = null;
      dom.radiusSelect.value = "";
      dom.clearNearby.disabled = true;
      updateLocationStatus();
      updateResults();
    });

    dom.clearCategories.addEventListener("click", () => {
      state.categories.clear();
      dom.categoryFilters.querySelectorAll(".filter-chip").forEach((button) => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      });
      updateResults();
    });

    dom.fitMap.addEventListener("click", fitVisible);
    dom.filterToggle.addEventListener("click", () => {
      const open = dom.filterPanel.classList.toggle("open");
      dom.filterToggle.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        event.preventDefault();
        dom.searchInput.focus();
      }
      if (event.key === "Escape" && dom.filterPanel.classList.contains("open")) {
        dom.filterPanel.classList.remove("open");
        dom.filterToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function setSummary() {
    const recommendationCount = new Set(places.flatMap((place) => (place.mentions || []).map((mention) => mention.post_key))).size;
    dom.placeCount.textContent = formatNumber(places.length);
    dom.postCount.textContent = formatNumber(recommendationCount || dataset.stats?.collected_posts || 0);
    dom.crossCount.textContent = formatNumber(places.filter((place) => place.account_count > 1).length);
  }

  places.forEach((place) => { place._admin = adminParts(place.address); });
  ensureMarkers();
  buildFilters();
  refreshAdminOptions();
  bindControls();
  setSummary();
  updateLocationStatus();
  updateResults();
  if (places.length) setTimeout(fitVisible, 50);
})();
