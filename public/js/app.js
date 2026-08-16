document.addEventListener('DOMContentLoaded', () => {

  // WEB AUTHENTICATION & FETCH INTERCEPTOR
  let webAuthToken = localStorage.getItem('palanweb_token') || '';
  let webAuthUser = localStorage.getItem('palanweb_user') || 'admin';
  let isAuthRequired = false;

  const originalFetch = window.fetch;
  window.fetch = async function (url, options = {}) {
    const opts = options || {};
    opts.headers = opts.headers || {};
    
    if (webAuthToken) {
      if (opts.headers instanceof Headers) {
        opts.headers.set('Authorization', `Bearer ${webAuthToken}`);
      } else {
        opts.headers['Authorization'] = `Bearer ${webAuthToken}`;
      }
    }

    const response = await originalFetch(url, opts);

    if (response.status === 401 && typeof url === 'string' && url.includes('/api/') && !url.includes('/api/auth/login')) {
      showLoginModal(true, 'La sesión ha caducado o no es válida. Inicie sesión.');
    }

    return response;
  };

  // STATE
  const state = {
    apiKey: localStorage.getItem('alldebrid_apikey') || 'xSk7D1sWYiGGNnUJwt7s',
    user: null,
    currentMedia: null, // Selected TMDB item
    selectedSeason: 1,
    selectedEpisode: 1,
    currentStreamUrl: '',
    searchDebounce: null,
    followedSeries: JSON.parse(localStorage.getItem('palanweb_followed_series') || '[]'),
    pendingMovies: JSON.parse(localStorage.getItem('palanweb_pending_movies') || '[]')
  };

  // DOM ELEMENTS
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginUsernameInput = document.getElementById('loginUsername');
  const loginPasswordInput = document.getElementById('loginPassword');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const togglePasswordIcon = document.getElementById('togglePasswordIcon');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const loginErrorText = document.getElementById('loginErrorText');
  const userBadge = document.getElementById('userBadge');
  const userBadgeText = document.getElementById('userBadgeText');
  const logoutBtn = document.getElementById('logoutBtn');
  const settingsLogoutBtn = document.getElementById('settingsLogoutBtn');
  const settingsUsernameText = document.getElementById('settingsUsernameText');

  const debridBadge = document.getElementById('debridBadge');
  const debridBadgeText = document.getElementById('debridBadgeText');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const apikeyInput = document.getElementById('apikeyInput');
  const saveApikeyBtn = document.getElementById('saveApikeyBtn');
  const checkApikeyBtn = document.getElementById('checkApikeyBtn');
  const accountStatusBox = document.getElementById('accountStatusBox');

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const searchResultsView = document.getElementById('searchResultsView');
  const searchResultsGrid = document.getElementById('searchResultsGrid');
  const resultsCount = document.getElementById('resultsCount');

  const heroBanner = document.getElementById('heroBanner');
  const trendingGrid = document.getElementById('trendingGrid');
  const moviesGrid = document.getElementById('moviesGrid');
  const seriesGrid = document.getElementById('seriesGrid');
  const trackingGrid = document.getElementById('trackingGrid');
  const trackingCountBadge = document.getElementById('trackingCountBadge');
  const watchlistGrid = document.getElementById('watchlistGrid');
  const watchlistCountBadge = document.getElementById('watchlistCountBadge');
  const top10MoviesGrid = document.getElementById('top10MoviesGrid');
  const top10SeriesGrid = document.getElementById('top10SeriesGrid');
  const spainContentGrid = document.getElementById('spainContentGrid');
  const justWatchGrid = document.getElementById('justWatchGrid');
  const jwProvidersGrid = document.getElementById('jwProvidersGrid');
  const jwSectionTitle = document.getElementById('jwSectionTitle');
  const toggleWatchlistBtn = document.getElementById('toggleWatchlistBtn');

  // Detail Modal Elements
  const detailModal = document.getElementById('detailModal');
  const closeDetailBtn = document.getElementById('closeDetailBtn');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalTitle = document.getElementById('modalTitle');
  const modalYear = document.getElementById('modalYear');
  const modalRating = document.getElementById('modalRating');
  const modalType = document.getElementById('modalType');
  const modalOverview = document.getElementById('modalOverview');
  const tvSelectorContainer = document.getElementById('tvSelectorContainer');
  const seasonSelect = document.getElementById('seasonSelect');
  const toggleTrackBtn = document.getElementById('toggleTrackBtn');

  const episodesList = document.getElementById('episodesList');
  const customStreamLink = document.getElementById('customStreamLink');
  const resolveLinkBtn = document.getElementById('resolveLinkBtn');
  const sourcePills = document.getElementById('sourcePills');

  // Player Elements
  const playerOverlay = document.getElementById('playerOverlay');
  const closePlayerBtn = document.getElementById('closePlayerBtn');
  const playerTitle = document.getElementById('playerTitle');
  const webVideoPlayer = document.getElementById('webVideoPlayer');
  const openInfuseBtn = document.getElementById('openInfuseBtn');
  const openVlcBtn = document.getElementById('openVlcBtn');
  const copyStreamUrlBtn = document.getElementById('copyStreamUrlBtn');

  // Direct Link Tab Elements
  const directLinkInput = document.getElementById('directLinkInput');
  const resolveDirectBtn = document.getElementById('resolveDirectBtn');
  const directResult = document.getElementById('directResult');

  // -------------------------------------------------------------
  // AUTHENTICATION LOGIC
  // -------------------------------------------------------------
  async function checkAuthStatus() {
    try {
      const res = await originalFetch('/api/auth/status', {
        headers: webAuthToken ? { 'Authorization': `Bearer ${webAuthToken}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        isAuthRequired = data.authRequired;
        if (!data.authRequired) {
          hideLoginModal();
          updateAuthUI(false);
        } else if (data.authenticated) {
          webAuthUser = data.username || webAuthUser;
          updateAuthUI(true, webAuthUser);
          hideLoginModal();
        } else {
          updateAuthUI(false);
          showLoginModal(false);
        }
      }
    } catch (e) {
      console.error('Error al comprobar estado de autenticación:', e);
    }
  }

  function showLoginModal(isExpired = false, customMsg = null) {
    if (loginModal) {
      loginModal.classList.add('active');
      if (customMsg) {
        loginErrorText.textContent = customMsg;
        loginErrorMsg.classList.remove('hidden');
      } else {
        loginErrorMsg.classList.add('hidden');
      }
    }
  }

  function hideLoginModal() {
    if (loginModal) {
      loginModal.classList.remove('active');
    }
  }

  function updateAuthUI(authenticated, username = 'admin') {
    if (authenticated) {
      if (userBadge) {
        userBadge.classList.remove('hidden');
        if (userBadgeText) userBadgeText.textContent = username;
      }
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (settingsUsernameText) settingsUsernameText.textContent = username;
    } else {
      if (userBadge) userBadge.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    if (!username || !password) {
      loginErrorText.textContent = 'Por favor, completa todos los campos';
      loginErrorMsg.classList.remove('hidden');
      return;
    }

    try {
      const res = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (data.success) {
        webAuthToken = data.token;
        webAuthUser = data.username || username;
        localStorage.setItem('palanweb_token', webAuthToken);
        localStorage.setItem('palanweb_user', webAuthUser);

        updateAuthUI(true, webAuthUser);
        hideLoginModal();
        showToast(`Bienvenido ${webAuthUser}`, 'success');
        
        loadPalantirCategories();
        loadCatalog();
      } else {
        loginErrorText.textContent = data.message || 'Usuario o contraseña incorrectos';
        loginErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      loginErrorText.textContent = 'Error al conectar con el servidor';
      loginErrorMsg.classList.remove('hidden');
    }
  }

  async function handleLogout() {
    try {
      if (webAuthToken) {
        await originalFetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${webAuthToken}` }
        });
      }
    } catch (e) {}

    webAuthToken = '';
    localStorage.removeItem('palanweb_token');
    localStorage.removeItem('palanweb_user');
    updateAuthUI(false);
    showToast('Sesión cerrada correctamente', 'success');
    showLoginModal(false);
  }

  // -------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------
  async function init() {
    await checkAuthStatus();

    if (state.apiKey) {
      localStorage.setItem('alldebrid_apikey', state.apiKey);
      apikeyInput.value = state.apiKey;
      verifyAllDebridKey(state.apiKey, false);
    } else {
      updateBadge(false, 'Configurar Key');
    }

    loadPalantirCategories();
    loadCatalog();
    renderTrackingSection();
    renderWatchlistSection();
    setupEventListeners();
  }





  // -------------------------------------------------------------
  // PALANTIR 3 CATEGORIES & SECTIONS
  // -------------------------------------------------------------
  async function loadPalantirCategories() {
    const palantirCategoriesGrid = document.getElementById('palantirCategoriesGrid');
    const palantirGrid = document.getElementById('palantirGrid');

    try {
      const res = await fetch('/api/palantir/sections');
      const data = await res.json();

      if (data.success && data.sections) {
        palantirCategoriesGrid.innerHTML = '';
        data.sections.forEach((sec, idx) => {
          const btn = document.createElement('button');
          btn.className = `palantir-cat-btn ${idx === 0 ? 'active' : ''}`;
          btn.innerHTML = `<i class="${sec.icon}" style="color: ${sec.color};"></i> ${sec.name}`;
          
          btn.addEventListener('click', () => {
            document.querySelectorAll('.palantir-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadPalantirSection(sec.id, sec.name, sec.icon);
          });

          palantirCategoriesGrid.appendChild(btn);
        });

        // Load first section (Estrenos)
        loadPalantirSection(data.sections[0].id, data.sections[0].name, data.sections[0].icon);
      }
    } catch (err) {
      console.error('Error cargando secciones Palantir:', err);
    }
  }

  async function loadPalantirSection(secId, secName, iconClass) {
    const palantirSectionTitle = document.getElementById('palantirSectionTitle');
    const palantirGrid = document.getElementById('palantirGrid');

    palantirSectionTitle.innerHTML = `<i class="${iconClass} text-gold"></i> Palantir: ${secName}`;
    palantirGrid.innerHTML = '<div style="padding: 20px; color: #94a3b8;">Cargando contenido de Palantir 3...</div>';

    try {
      const res = await fetch(`/api/palantir/catalog/${secId}`);
      const data = await res.json();
      if (data.success && data.results) {
        renderGrid(palantirGrid, data.results.slice(0, 30));
      }
    } catch (err) {

      console.error('Error al cargar sección Palantir:', err);
    }
  }


  // -------------------------------------------------------------
  // ALLDEBRID AUTHENTICATION
  // -------------------------------------------------------------
  async function verifyAllDebridKey(key, showToastMsg = true) {
    try {
      const res = await fetch('/api/debrid/check', {
        headers: { 'x-apikey': key }
      });
      const data = await res.json();

      if (data.success) {
        state.user = data.user;
        updateBadge(true, `AllDebrid (${data.user.username})`);
        
        accountStatusBox.innerHTML = `
          <div style="padding: 12px; background: rgba(16, 185, 129, 0.15); border-radius: 10px; color: #10b981; font-size: 0.85rem;">
            <strong><i class="fa-solid fa-check-circle"></i> Conectado con éxito:</strong> ${data.user.username}<br>
            <small style="color: #94a3b8;">Suscripción Premium activa (${data.user.isPremium ? 'Sí' : 'No'})</small>
          </div>
        `;
        if (showToastMsg) showToast('AllDebrid conectado correctamente', 'success');
        return true;
      } else {
        updateBadge(false, 'Clave Inválida');
        accountStatusBox.innerHTML = `
          <div style="padding: 12px; background: rgba(239, 68, 68, 0.15); border-radius: 10px; color: #ef4444; font-size: 0.85rem;">
            <strong><i class="fa-solid fa-triangle-exclamation"></i> Error:</strong> ${data.message}
          </div>
        `;
        if (showToastMsg) showToast(data.message, 'error');
        return false;
      }
    } catch (err) {
      updateBadge(false, 'Error Red');
      if (showToastMsg) showToast('Error al verificar AllDebrid', 'error');
      return false;
    }
  }

  function updateBadge(connected, text) {
    if (connected) {
      debridBadge.className = 'debrid-badge connected';
      debridBadgeText.textContent = text;
    } else {
      debridBadge.className = 'debrid-badge disconnected';
      debridBadgeText.textContent = text;
    }
  }

  // -------------------------------------------------------------
  // CATALOG FETCHING & RENDERING
  // -------------------------------------------------------------
  async function loadCatalog() {
    try {
      // 1. TOP 10 Movies Spain
      const topMoviesRes = await fetch('/api/catalog/top10/movies');
      const topMoviesData = await topMoviesRes.json();
      if (topMoviesData.success && topMoviesData.results.length > 0) {
        renderHero(topMoviesData.results[0]);
        if (top10MoviesGrid) renderRankedGrid(top10MoviesGrid, topMoviesData.results.slice(0, 10));
      }

      // 2. TOP 10 Series Spain
      const topSeriesRes = await fetch('/api/catalog/top10/series');
      const topSeriesData = await topSeriesRes.json();
      if (topSeriesData.success && topSeriesData.results.length > 0) {
        if (top10SeriesGrid) renderRankedGrid(top10SeriesGrid, topSeriesData.results.slice(0, 10));
      }

      // 3. Spanish Productions (100% España)
      const spMoviesRes = await fetch('/api/catalog/spain/movies');
      const spMoviesData = await spMoviesRes.json();
      const spSeriesRes = await fetch('/api/catalog/spain/series');
      const spSeriesData = await spSeriesRes.json();

      const combinedSpain = [];
      if (spMoviesData.success && spMoviesData.results) combinedSpain.push(...spMoviesData.results.slice(0, 6));
      if (spSeriesData.success && spSeriesData.results) combinedSpain.push(...spSeriesData.results.slice(0, 6));

      if (spainContentGrid && combinedSpain.length > 0) {
        renderGrid(spainContentGrid, combinedSpain);
      }

      // 4. Movies Catalog (30 Opciones)
      const moviesRes = await fetch('/api/catalog/trending?type=movie');
      const moviesData = await moviesRes.json();
      if (moviesData.success && moviesGrid) {
        renderGrid(moviesGrid, moviesData.results.slice(0, 30));
      }

      // 5. Series Catalog (30 Opciones)
      const seriesRes = await fetch('/api/catalog/trending?type=tv');
      const seriesData = await seriesRes.json();
      if (seriesData.success && seriesGrid) {
        renderGrid(seriesGrid, seriesData.results.slice(0, 30));
      }

      // 6. JustWatch Catalog (30 Opciones)
      loadJustWatchCatalog('');


    } catch (error) {
      console.error('Error cargando catálogo TOP 10:', error);
      showToast('Error al cargar recomendaciones TOP 10', 'error');
    }
  }

  async function loadJustWatchCatalog(providerId = '') {
    if (!justWatchGrid) return;
    justWatchGrid.innerHTML = '<div style="padding: 20px; color: #94a3b8;">Cargando catálogo JustWatch España...</div>';
    
    try {
      const url = providerId ? `/api/catalog/justwatch?provider=${providerId}` : '/api/catalog/justwatch';
      const res = await fetch(url);
      const data = await res.json();

      if (data.success && data.results) {
        renderGrid(justWatchGrid, data.results.slice(0, 30));
      }
    } catch (err) {
      console.error('Error al cargar JustWatch:', err);
    }
  }


  function renderRankedGrid(container, items) {
    if (!container) return;
    container.innerHTML = '';
    items.forEach((item, index) => {
      const title = item.title || item.name || 'Título';
      const posterUrl = item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : 'https://via.placeholder.com/500x750/131b2e/ffffff?text=Sin+Imagen';
      const rating = item.vote_average ? item.vote_average.toFixed(1) : '8.0';

      let rankBadge = `#${index + 1}`;
      let badgeStyle = 'background: rgba(15, 23, 42, 0.85); color: #fff; border: 1px solid rgba(255,255,255,0.2);';
      if (index === 0) {
        rankBadge = '🥇 TOP 1';
        badgeStyle = 'background: linear-gradient(135deg, #fbbf24, #d97706); color: #000; font-weight: 800; border: none; shadow: 0 0 10px rgba(251,191,36,0.6);';
      } else if (index === 1) {
        rankBadge = '🥈 TOP 2';
        badgeStyle = 'background: linear-gradient(135deg, #e2e8f0, #94a3b8); color: #000; font-weight: 800; border: none;';
      } else if (index === 2) {
        rankBadge = '🥉 TOP 3';
        badgeStyle = 'background: linear-gradient(135deg, #f97316, #c2410c); color: #fff; font-weight: 800; border: none;';
      }

      const card = document.createElement('div');
      card.className = 'media-card glass-card';
      card.innerHTML = `
        <div class="card-poster-wrap">
          <img src="${posterUrl}" alt="${title}" loading="lazy">
          <div class="card-badge" style="${badgeStyle}">
            ${rankBadge}
          </div>
        </div>
        <div class="card-info">
          <h3 class="card-title">${title}</h3>
          <div class="card-meta">
            <span class="card-rating"><i class="fa-solid fa-star text-gold"></i> ${rating}</span>
            <span class="card-type">${item.media_type === 'movie' ? 'Película' : 'Serie'}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openDetailModal(item.id, item.media_type || (item.title ? 'movie' : 'tv'));
      });

      container.appendChild(card);
    });
  }


  function renderHero(item) {
    const backdropUrl = item.backdrop_path 
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80';

    const title = item.title || item.name || 'Destacado';
    const overview = item.overview || 'Explora este título y reproduce en tu iPhone con tu cuenta de AllDebrid.';

    heroBanner.innerHTML = `
      <div class="hero-card" style="background-image: url('${backdropUrl}');">
        <div class="hero-overlay"></div>
        <div class="hero-info">
          <span class="badge badge-accent" style="margin-bottom: 8px; display: inline-block;">🔥 Novedad de hoy</span>
          <h2>${title}</h2>
          <p>${overview}</p>
        </div>
      </div>
    `;

    heroBanner.querySelector('.hero-card').addEventListener('click', () => {
      openDetailModal(item.id, item.media_type || (item.title ? 'movie' : 'tv'));
    });
  }

  function renderGrid(container, items) {
    container.innerHTML = '';
    items.forEach(item => {
      const title = item.title || item.name || 'Título';
      const posterUrl = item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : 'https://via.placeholder.com/500x750/131b2e/ffffff?text=Sin+Imagen';

      const year = (item.release_date || item.first_air_date || '').substring(0, 4);
      const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
      const mediaType = item.media_type || (item.title ? 'movie' : 'tv');

      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <div class="poster-wrap">
          <img src="${posterUrl}" alt="${title}" loading="lazy">
          <div class="rating-badge"><i class="fa-solid fa-star"></i> ${rating}</div>
        </div>
        <div class="card-info">
          <div class="card-title">${title}</div>
          <div class="card-meta">
            <span>${year}</span>
            <span style="text-transform: uppercase;">${mediaType === 'movie' ? 'Película' : 'Serie'}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openDetailModal(item.id, mediaType);
      });

      container.appendChild(card);
    });
  }

  // -------------------------------------------------------------
  // DETAIL MODAL & TV SEASONS
  // -------------------------------------------------------------
  async function openDetailModal(id, type) {
    try {
      const res = await fetch(`/api/catalog/details/${type}/${id}`);
      const data = await res.json();
      if (!data.success) {
        showToast('No se pudieron obtener detalles del título', 'error');
        return;
      }

      const item = data.details;
      state.currentMedia = { ...item, media_type: type };

      const title = item.title || item.name;
      const backdropUrl = item.backdrop_path 
        ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
        : 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80';

      const year = (item.release_date || item.first_air_date || '').substring(0, 4);
      const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';

      modalTitle.textContent = title;
      modalBackdrop.src = backdropUrl;
      modalYear.textContent = year || '2024';
      modalRating.innerHTML = `<i class="fa-solid fa-star"></i> ${rating}`;
      modalType.textContent = type === 'movie' ? 'Película' : 'Serie de TV';
      modalOverview.textContent = item.overview || 'Sin descripción disponible para este título.';

      // Generate search suggestions pills
      generateSourcePills(title, year, type);

      // Handle TV Show Seasons
      if (type === 'tv' && item.seasons && item.seasons.length > 0) {
        tvSelectorContainer.classList.remove('hidden');
        seasonSelect.innerHTML = '';
        
        item.seasons
          .filter(s => s.season_number > 0)
          .forEach(season => {
            const opt = document.createElement('option');
            opt.value = season.season_number;
            opt.textContent = `Temporada ${season.season_number} (${season.episode_count} eps)`;
            seasonSelect.appendChild(opt);
          });

        updateToggleTrackBtnState();
        loadEpisodes(item.id, seasonSelect.value);

        seasonSelect.onchange = () => {
          loadEpisodes(item.id, seasonSelect.value);
        };
      } else {
        tvSelectorContainer.classList.add('hidden');
      }

      updateToggleWatchlistBtnState();
      detailModal.classList.add('active');

    } catch (error) {
      console.error('Error al abrir detalle:', error);
      showToast('Error de conexión', 'error');
    }
  }

  async function loadEpisodes(showId, seasonNumber) {
    episodesList.innerHTML = '<div style="padding: 10px; color: #94a3b8; font-size: 0.8rem;">Cargando episodios...</div>';
    state.selectedSeason = parseInt(seasonNumber, 10);


    try {
      const res = await fetch(`/api/catalog/tv/${showId}/season/${seasonNumber}`);
      const data = await res.json();
      if (data.success && data.season.episodes) {
        episodesList.innerHTML = '';
        data.season.episodes.forEach(ep => {
          const item = document.createElement('div');
          item.className = 'episode-item';
          item.innerHTML = `
            <div>
              <strong>E${ep.episode_number}: ${ep.name}</strong>
            </div>
            <button class="btn btn-accent" style="padding: 4px 10px; font-size: 0.75rem;">
              <i class="fa-solid fa-play"></i> Reproducir
            </button>
          `;
          item.addEventListener('click', () => {
            document.querySelectorAll('.episode-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            state.selectedSeason = parseInt(seasonNumber, 10);
            state.selectedEpisode = parseInt(ep.episode_number, 10);

            const queryName = `${state.currentMedia.name} S${String(seasonNumber).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`;
            customStreamLink.value = queryName;
            showToast(`Episodio seleccionado: T${seasonNumber} E${ep.episode_number}`, 'success');

            // Auto play episode
            resolveAndPlayLink(queryName);
          });
          episodesList.appendChild(item);
        });
      }
    } catch (error) {
      episodesList.innerHTML = '<div style="padding: 10px; color: #ef4444;">Error al cargar episodios</div>';
    }
  }

  function generateSourcePills(title, year, type) {
    sourcePills.innerHTML = '';
    const cleanTitle = title.replace(/[^\w\s]/gi, '');
    const queries = [
      `${cleanTitle} ${year}`,
      `${cleanTitle} Spanish 1080p`,
      `${cleanTitle} Castellano`,
      `${cleanTitle} Multi`
    ];

    queries.forEach(q => {
      const pill = document.createElement('div');
      pill.className = 'source-pill';
      pill.textContent = q;
      pill.addEventListener('click', () => {
        customStreamLink.value = q;
        showToast(`Término de búsqueda asignado: ${q}`, 'success');
      });
      sourcePills.appendChild(pill);
    });
  }

  // -------------------------------------------------------------
  // STREAM RESOLVER & ALLDEBRID UNLOCK
  // -------------------------------------------------------------
  async function resolveAndPlayLink(linkOrQuery) {
    if (!state.apiKey) {
      showToast('Sin API Key de AllDebrid. Intentando reproducir directo/prueba.', 'warning');
    }

    const displayTitle = state.currentMedia 
      ? (state.currentMedia.media_type === 'tv' 
          ? `${state.currentMedia.name} T${state.selectedSeason}E${state.selectedEpisode}` 
          : (state.currentMedia.title || state.currentMedia.name))
      : 'Reproducción en Directo';

    showToast(`Resolviendo enlace para ${displayTitle}...`, 'success');

    try {
      const mediaTitle = state.currentMedia ? (state.currentMedia.title || state.currentMedia.name) : 'Reproducción en Directo';
      const mediaType = state.currentMedia ? state.currentMedia.media_type : 'movie';
      const isTv = mediaType === 'tv' || mediaType === 'series' || mediaType === 'show';
      const mediaKind = isTv ? 'series' : 'movie';
      const tmdbId = state.currentMedia ? state.currentMedia.id : null;

      let clientStreams = [];
      let targetImdb = state.currentMedia ? (state.currentMedia.imdb_id || (state.currentMedia.external_ids ? state.currentMedia.external_ids.imdb_id : null)) : null;

      // Fetch IMDb ID if missing and tmdbId exists
      if (!targetImdb && tmdbId) {
        try {
          const extRes = await fetch(`/api/catalog/details/${isTv ? 'tv' : 'movie'}/${tmdbId}`);
          const extData = await extRes.json();
          if (extData.success && extData.details) {
            targetImdb = extData.details.imdb_id || (extData.details.external_ids ? extData.details.external_ids.imdb_id : null);
          }
        } catch (e) {}
      }

      // Search TMDB by text title if IMDb ID still missing
      if (!targetImdb && mediaTitle) {
        try {
          const cleanTitle = mediaTitle.replace(/S\d+E\d+/i, '').replace(/T\d+E\d+/i, '').replace(/\d{4}/, '').trim();
          const sRes = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=8476a7ab80ad76f0936744df0430e67c&language=es-ES&query=${encodeURIComponent(cleanTitle)}&page=1`);
          const sData = await sRes.json();
          if (sData && sData.results && sData.results.length > 0) {
            const match = sData.results[0];
            const mType = match.media_type || (match.first_air_date ? 'tv' : 'movie');
            const extRes = await fetch(`https://api.themoviedb.org/3/${mType}/${match.id}/external_ids?api_key=8476a7ab80ad76f0936744df0430e67c`);
            const extData = await extRes.json();
            if (extData && extData.imdb_id) {
              targetImdb = extData.imdb_id;
            }
          }
        } catch (e) {}
      }

      // Parse season & episode from linkOrQuery string if present (e.g. S01E02 or 1x02)
      if (typeof linkOrQuery === 'string') {
        const sMatch = linkOrQuery.match(/S(\d+)E(\d+)/i) || linkOrQuery.match(/(\d+)x(\d+)/i);
        if (sMatch) {
          state.selectedSeason = parseInt(sMatch[1], 10);
          state.selectedEpisode = parseInt(sMatch[2], 10);
        }
      }

      // Fetch streams directly from Torrentio on client side (bypasses Cloudflare 403 blocks)
      if (targetImdb && (!linkOrQuery || (!linkOrQuery.startsWith('http') && !linkOrQuery.startsWith('magnet:')))) {
        const epSuffix = isTv ? `:${state.selectedSeason || 1}:${state.selectedEpisode || 1}` : '';
        const clientMirrors = [
          `https://torrentio.strem.fun/language=spanish/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
          `https://torrentio.strem.fun/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
          `https://torrentio.strem.fun/sort=quality/stream/${mediaKind}/${targetImdb}${epSuffix}.json`
        ];

        for (const cUrl of clientMirrors) {
          try {
            const tRes = await fetch(cUrl);
            const tData = await tRes.json();
            if (tData && tData.streams && tData.streams.length > 0) {
              clientStreams = tData.streams;
              console.log(`[client] Fetched ${clientStreams.length} streams from Torrentio mirror for ${targetImdb}${epSuffix}: ${cUrl}`);
              break;
            }
          } catch (e) {
            console.warn('[client] Mirror failed:', cUrl, e.message);
          }
        }
      }

      const res = await fetch('/api/debrid/smart-resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-apikey': state.apiKey || ''
        },
        body: JSON.stringify({
          apikey: state.apiKey || '',
          query: linkOrQuery,
          link: linkOrQuery && (linkOrQuery.startsWith('http') || linkOrQuery.startsWith('magnet:')) ? linkOrQuery : null,
          title: mediaTitle,
          type: mediaType,
          tmdbId: tmdbId,
          imdbId: targetImdb,
          streams: clientStreams,
          season: state.selectedSeason || 1,
          episode: state.selectedEpisode || 1
        })
      });

      const data = await res.json();
      const streamUrl = data.stream ? (data.stream.download || data.stream.link) : null;

      if (data.success && data.stream && streamUrl) {
        openVideoPlayer(streamUrl, displayTitle);
        showToast('¡Enlace obtenido y listo para reproducir!', 'success');

        // Update tracking progress for TV shows automatically
        if (state.currentMedia && isTv) {
          updateEpisodeProgress(state.currentMedia.id, state.selectedSeason, state.selectedEpisode);
        }
      } else {
        showToast(data.message || 'No se pudo resolver el vídeo', 'error');
      }
    } catch (err) {
      console.error('Error al resolver enlace:', err);
      showToast('Error de red al conectar con el servidor', 'error');
    }
  }

  // -------------------------------------------------------------
  // SERIES EN SEGUIMIENTO (TRACKING WATCHLIST)
  // -------------------------------------------------------------
  function saveFollowedSeries() {
    localStorage.setItem('palanweb_followed_series', JSON.stringify(state.followedSeries));
    renderTrackingSection();
  }

  function updateEpisodeProgress(showId, seasonNumber, episodeNumber) {
    if (!state.currentMedia || state.currentMedia.media_type !== 'tv') return;

    let item = state.followedSeries.find(s => s.id === showId);
    if (!item) {
      item = {
        id: showId,
        name: state.currentMedia.name || state.currentMedia.title || 'Serie',
        poster_path: state.currentMedia.poster_path,
        backdrop_path: state.currentMedia.backdrop_path,
        lastSeason: seasonNumber,
        lastEpisode: episodeNumber,
        nextSeason: seasonNumber,
        nextEpisode: episodeNumber + 1,
        updatedAt: Date.now()
      };
      state.followedSeries.unshift(item);
    } else {
      item.lastSeason = seasonNumber;
      item.lastEpisode = episodeNumber;
      item.nextSeason = seasonNumber;
      item.nextEpisode = episodeNumber + 1;
      item.updatedAt = Date.now();
    }

    saveFollowedSeries();
  }

  function updateToggleTrackBtnState() {
    if (!toggleTrackBtn || !state.currentMedia) return;
    const isFollowed = state.followedSeries.some(s => s.id === state.currentMedia.id);
    if (isFollowed) {
      toggleTrackBtn.innerHTML = '<i class="fa-solid fa-check text-accent"></i> En Seguimiento';
      toggleTrackBtn.classList.replace('btn-outline', 'btn-accent');
    } else {
      toggleTrackBtn.innerHTML = '<i class="fa-solid fa-bookmark text-gold"></i> Seguir Serie';
      toggleTrackBtn.classList.replace('btn-accent', 'btn-outline');
    }
  }

  function toggleTrackCurrentShow() {
    if (!state.currentMedia || state.currentMedia.media_type !== 'tv') return;
    const idx = state.followedSeries.findIndex(s => s.id === state.currentMedia.id);
    if (idx >= 0) {
      state.followedSeries.splice(idx, 1);
      showToast('Serie eliminada de seguimiento', 'success');
    } else {
      state.followedSeries.unshift({
        id: state.currentMedia.id,
        name: state.currentMedia.name || state.currentMedia.title || 'Serie',
        poster_path: state.currentMedia.poster_path,
        backdrop_path: state.currentMedia.backdrop_path,
        lastSeason: 1,
        lastEpisode: 0,
        nextSeason: 1,
        nextEpisode: 1,
        updatedAt: Date.now()
      });
      showToast('¡Serie añadida a Seguimiento!', 'success');
    }
    saveFollowedSeries();
    updateToggleTrackBtnState();
  }

  function renderTrackingSection() {
    if (!trackingGrid) return;
    if (trackingCountBadge) trackingCountBadge.textContent = `${state.followedSeries.length} series`;

    if (state.followedSeries.length === 0) {
      trackingGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: #94a3b8;" class="glass-card">
          <i class="fa-solid fa-bookmark" style="font-size: 2.5rem; margin-bottom: 12px; color: #fbbf24;"></i>
          <h3 style="color: #fff;">No tienes series en seguimiento aún</h3>
          <p style="font-size: 0.85rem; margin-top: 6px;">Entra a cualquier serie y pulsa <strong>"Seguir Serie"</strong> o reproduce un capítulo para registrar tu progreso.</p>
        </div>
      `;
      return;
    }

    trackingGrid.innerHTML = '';
    state.followedSeries.forEach(show => {
      const card = document.createElement('div');
      card.className = 'media-card glass-card';
      const posterUrl = show.poster_path 
        ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
        : 'https://via.placeholder.com/500x750/131b2e/ffffff?text=Serie';

      card.innerHTML = `
        <div class="card-poster-wrap">
          <img src="${posterUrl}" alt="${show.name}" loading="lazy">
          <div class="card-badge" style="background: rgba(251, 191, 36, 0.95); color: #000; font-weight: 700;">
            📍 T${show.nextSeason} E${show.nextEpisode}
          </div>
        </div>
        <div class="card-info" style="padding: 10px;">
          <h3 class="card-title" style="font-size: 0.95rem; font-weight: 700; margin-bottom: 4px;">${show.name}</h3>
          <p class="small-text" style="color: var(--accent-gold); font-size: 0.75rem; margin-bottom: 8px;">
            Siguiente: <strong>T${show.nextSeason} E${show.nextEpisode}</strong>
          </p>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button class="btn btn-accent play-next-btn" style="flex: 1; padding: 6px 8px; font-size: 0.75rem;">
              <i class="fa-solid fa-play"></i> Ver T${show.nextSeason}E${show.nextEpisode}
            </button>
            <button class="btn btn-outline remove-track-btn" style="padding: 6px 8px; font-size: 0.75rem;" title="Dejar de seguir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.play-next-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentMedia = { id: show.id, name: show.name, media_type: 'tv' };
        state.selectedSeason = show.nextSeason;
        state.selectedEpisode = show.nextEpisode;
        resolveAndPlayLink(`${show.name} S${String(show.nextSeason).padStart(2, '0')}E${String(show.nextEpisode).padStart(2, '0')}`);
      });

      card.querySelector('.remove-track-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.followedSeries = state.followedSeries.filter(s => s.id !== show.id);
        saveFollowedSeries();
        showToast('Serie eliminada de seguimiento', 'success');
      });

      card.addEventListener('click', () => {
        openDetailModal(show.id, 'tv');
      });

      trackingGrid.appendChild(card);
    });
  }

  // -------------------------------------------------------------
  // PELÍCULAS Y CONTENIDOS PENDIENTES (WATCHLIST)
  // -------------------------------------------------------------
  function savePendingMovies() {
    localStorage.setItem('palanweb_pending_movies', JSON.stringify(state.pendingMovies));
    renderWatchlistSection();
  }

  function updateToggleWatchlistBtnState() {
    if (!toggleWatchlistBtn || !state.currentMedia) return;
    const exists = state.pendingMovies.some(m => m.id === state.currentMedia.id);

    if (exists) {
      toggleWatchlistBtn.className = 'btn btn-accent';
      toggleWatchlistBtn.innerHTML = '<i class="fa-solid fa-check"></i> En Películas Pendientes';
    } else {
      toggleWatchlistBtn.className = 'btn btn-outline';
      toggleWatchlistBtn.innerHTML = '<i class="fa-solid fa-clock text-gold"></i> + Guardar en Pendientes';
    }
  }

  function togglePendingCurrentItem() {
    if (!state.currentMedia) return;
    const mediaId = state.currentMedia.id;
    const idx = state.pendingMovies.findIndex(m => m.id === mediaId);

    if (idx !== -1) {
      state.pendingMovies.splice(idx, 1);
      showToast('Eliminado de Películas Pendientes', 'success');
    } else {
      const title = state.currentMedia.title || state.currentMedia.name || 'Título';
      const item = {
        id: mediaId,
        title: title,
        name: title,
        media_type: state.currentMedia.media_type || (state.currentMedia.title ? 'movie' : 'tv'),
        poster_path: state.currentMedia.poster_path,
        backdrop_path: state.currentMedia.backdrop_path,
        vote_average: state.currentMedia.vote_average,
        addedAt: Date.now()
      };
      state.pendingMovies.unshift(item);
      showToast('¡Guardado en Películas Pendientes!', 'success');
    }

    savePendingMovies();
    updateToggleWatchlistBtnState();
  }

  function renderWatchlistSection() {
    if (!watchlistGrid) return;
    const count = state.pendingMovies.length;

    if (watchlistCountBadge) {
      watchlistCountBadge.textContent = `${count} ${count === 1 ? 'guardada' : 'guardadas'}`;
    }

    if (count === 0) {
      watchlistGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: #94a3b8; background: rgba(15, 23, 42, 0.4); border-radius: 16px; border: 1px dashed rgba(255,255,255,0.1);">
          <i class="fa-solid fa-clock" style="font-size: 2.5rem; margin-bottom: 12px; color: var(--accent-gold);"></i>
          <h3 style="font-size: 1.1rem; color: #fff; margin-bottom: 6px;">No tienes películas pendientes de ver</h3>
          <p style="font-size: 0.85rem;">Busca cualquier película o abre su ficha y pulsa <strong>"+ Guardar en Pendientes"</strong> para añadirla a tu lista.</p>
        </div>
      `;
      return;
    }

    watchlistGrid.innerHTML = '';
    state.pendingMovies.forEach(item => {
      const title = item.title || item.name || 'Título';
      const posterUrl = item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : 'https://via.placeholder.com/500x750/131b2e/ffffff?text=Sin+Imagen';

      const card = document.createElement('div');
      card.className = 'media-card glass-card';
      card.innerHTML = `
        <div class="card-poster-wrap">
          <img src="${posterUrl}" alt="${title}" loading="lazy">
          <div class="card-badge" style="background: rgba(15, 23, 42, 0.85); color: var(--accent-gold); font-weight: 700;">
            <i class="fa-solid fa-clock"></i> Pendiente
          </div>
        </div>
        <div class="card-info" style="padding: 10px;">
          <h3 class="card-title" style="font-size: 0.95rem; font-weight: 700; margin-bottom: 6px;">${title}</h3>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button class="btn btn-accent play-pending-btn" style="flex: 1; padding: 6px 8px; font-size: 0.75rem;">
              <i class="fa-solid fa-play"></i> Ver Ficha
            </button>
            <button class="btn btn-outline remove-pending-btn" style="padding: 6px 8px; font-size: 0.75rem;" title="Eliminar de pendientes">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.play-pending-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openDetailModal(item.id, item.media_type || 'movie');
      });

      card.querySelector('.remove-pending-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.pendingMovies = state.pendingMovies.filter(m => m.id !== item.id);
        savePendingMovies();
        showToast('Eliminado de Películas Pendientes', 'success');
      });

      card.addEventListener('click', () => {
        openDetailModal(item.id, item.media_type || 'movie');
      });

      watchlistGrid.appendChild(card);
    });
  }





  // -------------------------------------------------------------
  // PLAYER MODAL CONTROL & EXTERNAL APPS
  // -------------------------------------------------------------
  function openVideoPlayer(streamUrl, titleName) {
    state.currentStreamUrl = streamUrl;
    playerTitle.textContent = titleName;

    // Load stream into HTML5 Video
    webVideoPlayer.src = streamUrl;
    webVideoPlayer.play().catch(e => console.log('Auto-play prevent:', e));

    // Deep-links for iOS / PC apps
    const encodedUrl = encodeURIComponent(streamUrl);
    openInfuseBtn.href = `infuse://x-callback-url/play?url=${encodedUrl}`;

    // Clean VLC scheme for mobile and PC protocol handlers
    const cleanVlcUrl = streamUrl.replace(/^https?:\/\//, '');
    openVlcBtn.href = `vlc://${cleanVlcUrl}`;

    playerOverlay.classList.add('active');
    detailModal.classList.remove('active');
  }


  function closeVideoPlayer() {
    webVideoPlayer.pause();
    webVideoPlayer.src = '';
    playerOverlay.classList.remove('active');
  }

  // -------------------------------------------------------------
  // EVENT LISTENERS & SEARCH
  // -------------------------------------------------------------
  function setupEventListeners() {
    // Web Auth Listeners
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }
    if (togglePasswordBtn && loginPasswordInput && togglePasswordIcon) {
      togglePasswordBtn.addEventListener('click', () => {
        const isPass = loginPasswordInput.type === 'password';
        loginPasswordInput.type = isPass ? 'text' : 'password';
        togglePasswordIcon.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      });
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }
    if (settingsLogoutBtn) {
      settingsLogoutBtn.addEventListener('click', () => {
        if (settingsModal) settingsModal.classList.remove('active');
        handleLogout();
      });
    }

    // Settings Modal
    openSettingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
    closeDetailBtn.addEventListener('click', () => detailModal.classList.remove('active'));
    closePlayerBtn.addEventListener('click', closeVideoPlayer);

    saveApikeyBtn.addEventListener('click', async () => {
      const key = apikeyInput.value.trim();
      if (!key) {
        showToast('Ingresa una API Key válida', 'error');
        return;
      }
      const ok = await verifyAllDebridKey(key, true);
      if (ok) {
        state.apiKey = key;
        localStorage.setItem('alldebrid_apikey', key);
        settingsModal.classList.remove('active');
      }
    });

    checkApikeyBtn.addEventListener('click', () => {
      verifyAllDebridKey(apikeyInput.value.trim(), true);
    });

    if (toggleTrackBtn) {
      toggleTrackBtn.addEventListener('click', toggleTrackCurrentShow);
    }

    if (toggleWatchlistBtn) {
      toggleWatchlistBtn.addEventListener('click', togglePendingCurrentItem);
    }

    // Navigation Tabs
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');

        navTabs.forEach(t => {
          t.classList.remove('active');
          t.classList.remove('active-gold');
        });
        tabContents.forEach(c => c.classList.remove('active'));
        searchResultsView.classList.remove('active');

        if (targetTab === 'top10') {
          tab.classList.add('active-gold');
          document.getElementById('tabTop10').classList.add('active');
        } else if (targetTab === 'justwatch') {
          tab.classList.add('active-gold');
          document.getElementById('tabJustWatch').classList.add('active');
        } else if (targetTab === 'palantir') {
          tab.classList.add('active-gold');
          document.getElementById('tabPalantir').classList.add('active');
        } else {
          tab.classList.add('active');
          if (targetTab === 'movies') document.getElementById('tabMovies').classList.add('active');
          if (targetTab === 'series') document.getElementById('tabSeries').classList.add('active');
          if (targetTab === 'tracking') {
            document.getElementById('tabTracking').classList.add('active');
            renderTrackingSection();
          }
          if (targetTab === 'watchlist') {
            document.getElementById('tabWatchlist').classList.add('active');
            renderWatchlistSection();
          }
          if (targetTab === 'direct') document.getElementById('tabDirect').classList.add('active');
        }

      });
    });


    // JustWatch Provider Filter Buttons
    if (jwProvidersGrid) {
      const pBtns = jwProvidersGrid.querySelectorAll('.palantir-cat-btn');
      pBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          pBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const providerId = btn.getAttribute('data-provider') || '';
          loadJustWatchCatalog(providerId);
        });
      });
    }




    // Search Input Debounce
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearSearchBtn.style.display = query ? 'block' : 'none';

      clearTimeout(state.searchDebounce);
      if (query.length < 2) {
        searchResultsView.classList.remove('active');
        return;
      }

      state.searchDebounce = setTimeout(() => {
        performSearch(query);
      }, 400);
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      searchResultsView.classList.remove('active');
    });

    // Detail Modal Resolve Stream
    resolveLinkBtn.addEventListener('click', () => {
      const val = customStreamLink.value.trim();
      if (!val) {
        const defaultTerm = `${state.currentMedia.title || state.currentMedia.name} ${(state.currentMedia.release_date || state.currentMedia.first_air_date || '').substring(0, 4)}`;
        resolveAndPlayLink(defaultTerm);
      } else {
        resolveAndPlayLink(val);
      }
    });

    // Direct Link Tab Resolve
    resolveDirectBtn.addEventListener('click', () => {
      const inputVal = directLinkInput.value.trim();
      if (!inputVal) {
        showToast('Pega un enlace Magnet o URL de servidor', 'error');
        return;
      }
      resolveAndPlayLink(inputVal);
    });

    // Open in VLC (PC & Mobile fallback with .m3u playlist download)
    if (openVlcBtn) {
      openVlcBtn.addEventListener('click', (e) => {
        if (!state.currentStreamUrl) return;

        // Copy direct link to clipboard for convenience
        if (navigator.clipboard) {
          navigator.clipboard.writeText(state.currentStreamUrl).catch(() => {});
        }

        // Generate .m3u playlist file so double clicking it opens VLC directly on Windows/Mac PC
        const title = playerTitle.textContent || 'Video';
        const cleanTitle = title.replace(/[^\w\s-]/gi, '').trim() || 'palanweb_video';
        const m3uContent = `#EXTM3U\n#EXTINF:-1,${title}\n${state.currentStreamUrl}\n`;
        const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
        const blobUrl = URL.createObjectURL(blob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;
        downloadLink.download = `${cleanTitle}.m3u`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        showToast('Descargando archivo .m3u para VLC y enlace copiado', 'success');
      });
    }

    // Copy stream URL
    copyStreamUrlBtn.addEventListener('click', () => {
      if (state.currentStreamUrl) {
        navigator.clipboard.writeText(state.currentStreamUrl);
        showToast('Enlace copiado al portapapeles', 'success');
      }
    });
  }

  async function performSearch(query) {
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (data.success) {
        tabContents.forEach(c => c.classList.remove('active'));
        searchResultsView.classList.add('active');
        resultsCount.textContent = `${data.results.length} resultados`;
        renderGrid(searchResultsGrid, data.results);
      }
    } catch (err) {
      console.error('Error en búsqueda:', err);
    }
  }

  // -------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // -------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // Start App
  init();
});
