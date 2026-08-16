require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;

// Web Authentication Configuration
const WEB_AUTH_REQUIRED = process.env.WEB_AUTH_REQUIRED !== 'false';
const WEB_USERNAME = process.env.WEB_USERNAME || 'admin';
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'palanweb';
const SESSION_SECRET = process.env.SESSION_SECRET || 'palanweb_secret_key_2026';

// TMDB API Key Configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY || '8476a7ab80ad76f0936744df0430e67c';

// Store active token sessions in memory: Map<token, { username, createdAt }>
const activeSessions = new Map();

// Helper to generate secure token
function generateToken(username) {
  const payload = `${username}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

// Helper to verify token
function verifyToken(token) {
  if (!token) return false;
  if (activeSessions.has(token)) {
    return activeSessions.get(token);
  }
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return false;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(Buffer.from(payloadB64, 'base64url').toString('utf8')).digest('hex');
    if (signature !== expectedSig) return false;
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const [username] = payload.split(':');
    return { username };
  } catch (e) {
    return false;
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// AUTHENTICATION ENDPOINTS & MIDDLEWARE
// -------------------------------------------------------------

app.get('/api/auth/status', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-web-token'] || req.query.token);
  const session = verifyToken(token);
  
  res.json({
    success: true,
    authRequired: WEB_AUTH_REQUIRED,
    authenticated: !WEB_AUTH_REQUIRED || !!session,
    username: session ? session.username : null
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!WEB_AUTH_REQUIRED) {
    return res.json({ success: true, message: 'Autenticación no requerida', token: 'auth_disabled' });
  }

  if (username === WEB_USERNAME && password === WEB_PASSWORD) {
    const token = generateToken(username);
    activeSessions.set(token, { username, createdAt: Date.now() });
    return res.json({
      success: true,
      message: 'Inicio de sesión correcto',
      token,
      username
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Usuario o contraseña incorrectos'
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-web-token'] || req.body.token);
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// Middleware for securing API routes
app.use((req, res, next) => {
  if (!WEB_AUTH_REQUIRED) return next();
  
  // Public auth endpoints & health
  if (req.path.startsWith('/api/auth/') || req.path === '/api/health') {
    return next();
  }

  // Guard all /api/ routes
  if (req.path.startsWith('/api/')) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-web-token'] || req.query.token);
    const session = verifyToken(token);
    if (!session) {
      return res.status(401).json({ success: false, message: 'No autorizado. Inicie sesión en la web.' });
    }
    req.user = session;
  }
  next();
});

// Helper for HTTP/HTTPS requests with Redirect & Compression Support
async function makeRequest(url, options = {}) {
  try {
    const controller = new AbortController();
    const timeoutMs = options.timeout || 10000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': options.headers?.['User-Agent'] || 'Stremio/4.4.168',
        'Accept': 'application/json, text/plain, */*',
        ...(options.headers || {})
      },
      signal: controller.signal,
      body: options.body || undefined
    });

    clearTimeout(timer);

    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {}

    return { statusCode: response.status, data, raw };
  } catch (err) {
    return { statusCode: 500, data: null, raw: err.message };
  }
}

// AllDebrid Agent Name required by AllDebrid API
const AGENT = 'palanweb';

// -------------------------------------------------------------
// ALLDEBRID ENDPOINTS
// -------------------------------------------------------------


// Check AllDebrid API key status
app.get('/api/debrid/check', async (req, res) => {
  const apikey = req.headers['x-apikey'] || req.query.apikey;
  if (!apikey) {
    return res.status(400).json({ success: false, message: 'Falta la clave API de AllDebrid' });
  }

  try {
    const url = `https://api.alldebrid.com/v4/user?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}`;
    const response = await makeRequest(url);
    
    if (response.data && response.data.status === 'success') {
      return res.json({
        success: true,
        user: response.data.data.user
      });
    } else {
      return res.status(401).json({
        success: false,
        message: response.data?.error?.message || 'Clave API no válida o expirada'
      });
    }
  } catch (error) {
    console.error('Error al verificar AllDebrid:', error);
    res.status(500).json({ success: false, message: 'Error conectando con AllDebrid' });
  }
});

// Unlock a stream link using AllDebrid
app.post('/api/debrid/unlock', async (req, res) => {
  const apikey = req.headers['x-apikey'] || req.body.apikey;
  const { link } = req.body;

  if (!apikey || !link) {
    return res.status(400).json({ success: false, message: 'Se requiere la API key y el enlace a desbloquear' });
  }

  try {
    const url = `https://api.alldebrid.com/v4/link/unlock?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&link=${encodeURIComponent(link)}`;
    const response = await makeRequest(url);

    if (response.data && response.data.status === 'success') {
      return res.json({
        success: true,
        stream: response.data.data
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.data?.error?.message || 'No se pudo desrestringir el enlace con AllDebrid'
      });
    }
  } catch (error) {
    console.error('Error al desbloquear enlace:', error);
    res.status(500).json({ success: false, message: 'Error interno al procesar con AllDebrid' });
  }
});

// Process magnet link with AllDebrid
app.post('/api/debrid/magnet', async (req, res) => {
  const apikey = req.headers['x-apikey'] || req.body.apikey;
  const { magnet } = req.body;

  if (!apikey || !magnet) {
    return res.status(400).json({ success: false, message: 'API key y enlace Magnet requeridos' });
  }

  try {
    // 1. Upload magnet
    const uploadUrl = `https://api.alldebrid.com/v4/magnet/upload?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&magnets[]=${encodeURIComponent(magnet)}`;
    const uploadRes = await makeRequest(uploadUrl);

    if (!uploadRes.data || uploadRes.data.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: uploadRes.data?.error?.message || 'Error al enviar el magnet a AllDebrid'
      });
    }

    const magnetInfo = uploadRes.data.data.magnets[0];
    const id = magnetInfo.id;

    // 2. Check magnet status
    const statusUrl = `https://api.alldebrid.com/v4/magnet/status?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&id=${id}`;
    const statusRes = await makeRequest(statusUrl);

    if (statusRes.data && statusRes.data.status === 'success') {
      return res.json({
        success: true,
        magnet: statusRes.data.data.magnets
      });
    } else {
      return res.json({
        success: true,
        magnet: magnetInfo
      });
    }
  } catch (error) {
    console.error('Error al procesar Magnet:', error);
    res.status(500).json({ success: false, message: 'Error procesando magnet' });
  }
});

// Helper to recursively flatten file tree from torrent status
function flattenFiles(filesArray) {
  if (!filesArray || !Array.isArray(filesArray)) return [];
  const result = [];
  filesArray.forEach(item => {
    const link = item.l || item.link;
    const name = item.n || item.filename || item.name;
    if (link && name) {
      result.push({ ...item, l: link, n: name });
    }
    if (item.e && Array.isArray(item.e)) {
      result.push(...flattenFiles(item.e));
    }
  });
  return result;
}

// Helper to find exact episode file in multi-episode torrents
function findEpisodeFile(filesArray, seasonNum, episodeNum) {
  const allFiles = flattenFiles(filesArray);
  if (allFiles.length === 0) return null;

  const sStr = String(seasonNum).padStart(2, '0');
  const eStr = String(episodeNum).padStart(2, '0');

  const patterns = [
    new RegExp(`S${sStr}E${eStr}`, 'i'),
    new RegExp(`S${seasonNum}E${episodeNum}`, 'i'),
    new RegExp(`${sStr}x${eStr}`, 'i'),
    new RegExp(`${seasonNum}x${eStr}`, 'i'),
    new RegExp(`${seasonNum}x${episodeNum}`, 'i'),
    new RegExp(`Cap[\\._\\s]?${seasonNum}?${eStr}`, 'i'),
    new RegExp(`Cap[\\._\\s]?${eStr}`, 'i'),
    new RegExp(`Capitulo[\\._\\s]?${episodeNum}`, 'i'),
    new RegExp(`Capitulo[\\._\\s]?${eStr}`, 'i'),
    new RegExp(`E${eStr}`, 'i'),
    new RegExp(`Episodio[\\._\\s]?${episodeNum}`, 'i'),
    new RegExp(`Episodio[\\._\\s]?${eStr}`, 'i')
  ];

  for (const pat of patterns) {
    const match = allFiles.find(f => pat.test(f.n) && f.l);
    if (match) return match;
  }

  const videoFiles = allFiles.filter(f => f.n && f.n.match(/\.(mp4|mkv|avi|mov|m4v)$/i));
  if (videoFiles.length > 0) {
    return videoFiles[episodeNum - 1] || videoFiles[0];
  }

  return allFiles[0];
}

function findMovieVideoFile(filesArray) {
  const allFiles = flattenFiles(filesArray);
  const videoFiles = allFiles.filter(f => f.n && f.n.match(/\.(mp4|mkv|avi|mov|m4v)$/i));
  return videoFiles.length > 0 ? videoFiles[0] : allFiles[0];
}

const DEFAULT_ALLDEBRID_KEY = process.env.ALLDEBRID_API_KEY || 'xSk7D1sWYiGGNnUJwt7s';

// Smart Auto-Resolver Endpoint for Movies & Episodes
app.post('/api/debrid/smart-resolve', async (req, res) => {
  const clientKey = req.headers['x-apikey'] || req.body.apikey;
  const apikey = (clientKey && clientKey.trim()) ? clientKey.trim() : DEFAULT_ALLDEBRID_KEY;
  const { title, query, link, type, season, episode, imdbId, tmdbId, streams: clientStreams } = req.body;
  const isTv = type === 'tv' || type === 'series' || type === 'show';
  const targetLink = link || query;
  const FALLBACK_VIDEO = 'https://vjs.zencdn.net/v/oceans.mp4';

  // 1. Direct link handling (http/https mp4 or direct streams)
  if (targetLink && (targetLink.startsWith('http://') || targetLink.startsWith('https://')) && !targetLink.startsWith('magnet:')) {
    if (apikey) {
      try {
        const url = `https://api.alldebrid.com/v4/link/unlock?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&link=${encodeURIComponent(targetLink)}`;
        const response = await makeRequest(url);
        if (response.data && response.data.status === 'success') {
          return res.json({ success: true, stream: response.data.data });
        }
      } catch (e) {
        console.error('Error desrestringiendo enlace directo:', e);
      }
    }
    // Return direct HTTP link immediately if AllDebrid unlock not required/failed
    return res.json({
      success: true,
      stream: {
        download: targetLink,
        filename: title || 'Transmisión Directa'
      }
    });
  }

  // 2. Direct Magnet link handling
  if (targetLink && targetLink.startsWith('magnet:') && apikey) {
    try {
      const uploadUrl = `https://api.alldebrid.com/v4/magnet/upload?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&magnets[]=${encodeURIComponent(targetLink)}`;
      const uploadRes = await makeRequest(uploadUrl);
      
      if (uploadRes.data && uploadRes.data.status === 'success' && uploadRes.data.data.magnets[0]) {
        const magId = uploadRes.data.data.magnets[0].id;
        const statusUrl = `https://api.alldebrid.com/v4.1/magnet/status?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&id=${magId}`;
        const statusRes = await makeRequest(statusUrl);

        if (statusRes.data && statusRes.data.data && statusRes.data.data.magnets) {
          const rawMags = statusRes.data.data.magnets;
          const magInfo = Array.isArray(rawMags) ? rawMags[0] : rawMags;
          if (magInfo && magInfo.files && magInfo.files.length > 0) {
            const selectedFile = isTv 
              ? findEpisodeFile(magInfo.files, season || 1, episode || 1)
              : findMovieVideoFile(magInfo.files);
            if (selectedFile && selectedFile.l) {
              const unlockUrl = `https://api.alldebrid.com/v4/link/unlock?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&link=${encodeURIComponent(selectedFile.l)}`;
              const unlockRes = await makeRequest(unlockUrl);
              if (unlockRes.data && unlockRes.data.status === 'success') {
                return res.json({ success: true, stream: unlockRes.data.data });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Error al procesar magnet:', e);
    }
  }

  // 3. Dynamic IMDb resolution from TMDB if not provided
  let targetImdb = imdbId;

  if (!targetImdb && tmdbId) {
    try {
      const extUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const extRes = await makeRequest(extUrl);
      if (extRes.data && extRes.data.imdb_id) {
        targetImdb = extRes.data.imdb_id;
      }
    } catch (e) {
      console.error('Error obteniendo IMDb ID dinámico desde tmdbId:', e);
    }
  }

  // Search TMDB by text title/query if tmdbId/imdbId were missing
  if (!targetImdb && (title || query)) {
    try {
      const searchQuery = (title || query).replace(/S\d+E\d+/i, '').replace(/T\d+E\d+/i, '').replace(/\d{4}/, '').trim();
      if (searchQuery) {
        const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(searchQuery)}&page=1`;
        const searchRes = await makeRequest(searchUrl);
        if (searchRes.data && searchRes.data.results && searchRes.data.results.length > 0) {
          const match = searchRes.data.results[0];
          const matchType = match.media_type || (match.first_air_date ? 'tv' : 'movie');
          const extUrl = `https://api.themoviedb.org/3/${matchType}/${match.id}/external_ids?api_key=${TMDB_API_KEY}`;
          const extRes = await makeRequest(extUrl);
          if (extRes.data && extRes.data.imdb_id) {
            targetImdb = extRes.data.imdb_id;
          }
        }
      }
    } catch (e) {
      console.error('Error obteniendo IMDb ID por texto:', e);
    }
  }

  console.log(`[smart-resolve] Resolving for title="${title}", query="${query}", tmdbId=${tmdbId}, isTv=${isTv}`);
  console.log(`[smart-resolve] Resolved IMDb ID: ${targetImdb}`);

  let debugLog = {
    targetImdb: targetImdb || null,
    tmdbId: tmdbId || null,
    isTv,
    tmdbKeyPresent: !!TMDB_API_KEY,
    streamsFound: 0,
    uniqueHashes: 0,
    uploadAttempts: [],
    lastError: null
  };

  // 4. Search and unlock audio streams (Prioritizing Spanish / Castellano)
  if (targetImdb && apikey) {
    try {
      const mediaKind = isTv ? 'series' : 'movie';
      const epSuffix = isTv ? `:${season || 1}:${episode || 1}` : '';

      const mirrors = [
        `https://torrentio.strem.fun/language=spanish/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
        `https://torrentio.strem.fun/sort=quality/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
        `https://torrentio.strem.fun/stream/${mediaKind}/${targetImdb}${epSuffix}.json`
      ];

      let streams = (Array.isArray(clientStreams) && clientStreams.length > 0) ? clientStreams : [];
      if (streams.length > 0) {
        console.log(`[smart-resolve] Using ${streams.length} streams provided directly by client browser`);
      } else {
        for (const mUrl of mirrors) {
          const searchRes = await makeRequest(mUrl, { timeout: 7000 });
          if (searchRes.data && searchRes.data.streams && searchRes.data.streams.length > 0) {
            streams = searchRes.data.streams;
            console.log(`[smart-resolve] Found ${streams.length} streams from mirror: ${mUrl}`);
            break;
          } else {
            debugLog.uploadAttempts.push({ mirror: mUrl, status: searchRes.statusCode, rawSnippet: (searchRes.raw || '').substring(0, 100) });
          }
        }
      }

      debugLog.streamsFound = streams.length;

      if (streams.length > 0) {
        const getStreamText = (st) => ((st.title || '') + ' ' + (st.name || '') + ' ' + (st.behaviorHints?.filename || '')).toLowerCase();

        // Priority 1: Castellano / Spanish audio tags
        const castellanoStreams = streams.filter(st => {
          const txt = getStreamText(st);
          return /\[esp\]|castellano|español|lobezno|dontorrent|grantorrent|wolfmax4k|descargas2020|newpct|todotorrents|atomohd|spa\b|esp\b|spanish|spain|🇪🇸/i.test(txt);
        });

        // Priority 2: Multi / Dual audio tags
        const dualStreams = streams.filter(st => {
          const txt = getStreamText(st);
          return /multi|dual/i.test(txt) && !castellanoStreams.includes(st);
        });

        // Priority 3: Other available streams
        const otherStreams = streams.filter(st => !castellanoStreams.includes(st) && !dualStreams.includes(st));

        // Prioritized streams: Castellano -> Dual -> Other
        const sortedStreams = [...castellanoStreams, ...dualStreams, ...otherStreams];

        const uniqueStreams = [];
        const seenHashes = new Set();
        for (const st of sortedStreams) {
          if (st.infoHash && !seenHashes.has(st.infoHash)) {
            seenHashes.add(st.infoHash);
            uniqueStreams.push(st);
          }
        }

        debugLog.uniqueHashes = uniqueStreams.length;
        console.log(`[smart-resolve] Trying ${uniqueStreams.length} unique hashes on AllDebrid...`);

        for (const st of uniqueStreams.slice(0, 25)) {
          if (st.infoHash) {
            const magnetUri = `magnet:?xt=urn:btih:${st.infoHash}&dn=${encodeURIComponent(title || 'Video')}`;
            const uploadUrl = `https://api.alldebrid.com/v4/magnet/upload?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&magnets[]=${encodeURIComponent(magnetUri)}`;
            const uploadRes = await makeRequest(uploadUrl, { timeout: 7000 });

            if (uploadRes.data && uploadRes.data.status === 'success' && uploadRes.data.data.magnets[0]) {
              const magData = uploadRes.data.data.magnets[0];
              const magId = magData.id;

              let files = magData.files || magData.links;
              if (!files || files.length === 0) {
                const statusUrl = `https://api.alldebrid.com/v4.1/magnet/status?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&id=${magId}`;
                const statusRes = await makeRequest(statusUrl, { timeout: 7000 });

                if (statusRes.data && statusRes.data.data && statusRes.data.data.magnets) {
                  const rawMags = statusRes.data.data.magnets;
                  const magInfo = Array.isArray(rawMags) ? rawMags[0] : rawMags;
                  if (magInfo) {
                    files = magInfo.files || magInfo.links;
                    // If magnet is currently downloading, wait 1.2s and poll status again
                    if ((!files || files.length === 0) && (magInfo.status === 'Downloading' || magInfo.statusCode === 1 || magInfo.statusCode === 2)) {
                      await new Promise(r => setTimeout(r, 1200));
                      const retryRes = await makeRequest(statusUrl, { timeout: 7000 });
                      if (retryRes.data && retryRes.data.data && retryRes.data.data.magnets) {
                        const rMags = retryRes.data.data.magnets;
                        const rInfo = Array.isArray(rMags) ? rMags[0] : rMags;
                        if (rInfo) {
                          files = rInfo.files || rInfo.links;
                        }
                      }
                    }
                  }
                }
              }

              if (files && files.length > 0) {
                const selectedFile = isTv 
                  ? findEpisodeFile(files, season || 1, episode || 1)
                  : findMovieVideoFile(files);

                const fileLink = selectedFile ? (selectedFile.l || selectedFile.link) : null;

                if (fileLink) {
                  const unlockUrl = `https://api.alldebrid.com/v4/link/unlock?agent=${AGENT}&apikey=${encodeURIComponent(apikey)}&link=${encodeURIComponent(fileLink)}`;
                  const unlockRes = await makeRequest(unlockUrl, { timeout: 7000 });
                  if (unlockRes.data && unlockRes.data.status === 'success') {
                    console.log(`[smart-resolve] SUCCESS! Unlocked stream for "${title}":`, unlockRes.data.data.link || unlockRes.data.data.download);
                    return res.json({ success: true, stream: unlockRes.data.data });
                  }
                }
              }
            } else {
              debugLog.uploadAttempts.push({ hash: st.infoHash, res: uploadRes.data || uploadRes.raw });
            }
          }
        }
      } else {
        console.log(`[smart-resolve] No streams found from Torrentio mirrors for IMDb ${targetImdb}`);
      }
    } catch (err) {
      debugLog.lastError = err.message;
      console.error('[smart-resolve] Error resolviendo magnet para título:', err);
    }
  }

  // Return clear error if no stream could be resolved
  return res.json({
    success: false,
    message: `No se pudo encontrar ningún enlace disponible en AllDebrid para "${title || 'este título'}"`,
    debug: debugLog
  });
});










// -------------------------------------------------------------
// CATALOG & SEARCH (TMDB / Embedded Provider)
// -------------------------------------------------------------



// Fallback Catalog Data
const FALLBACK_CATALOG = [
  {
    id: 693134,
    title: 'Dune: Parte Dos',
    name: 'Dune: Parte Dos',
    media_type: 'movie',
    overview: 'Paul Atreides se une a Chani y a los Fremen mientras busca venganza contra los conspiradores que destruyeron a su familia.',
    poster_path: '/czembW0Rk1Ke7lWp3wWjU9v5t6g.jpg',
    backdrop_path: '/xOMo8BRK7PfcJv9JCnx7s52B3xs.jpg',
    vote_average: 8.3,
    release_date: '2024-02-27'
  },
  {
    id: 94997,
    title: 'La Casa del Dragón',
    name: 'La Casa del Dragón',
    media_type: 'tv',
    overview: 'La historia de la Casa Targaryen ambientada 200 años antes de los eventos de Juego de Tronos.',
    poster_path: '/1X4h40fcB4WWzUdqwhdGKG4z29q.jpg',
    backdrop_path: '/etj8E2o0uKuV2P8WfJyaGws4BEj.jpg',
    vote_average: 8.4,
    first_air_date: '2022-08-21'
  },
  {
    id: 573435,
    title: 'Deadpool y Lobezno',
    name: 'Deadpool y Lobezno',
    media_type: 'movie',
    overview: 'Wade Wilson se une a un Lobezno reacio en una misión para cambiar la historia del multiverso.',
    poster_path: '/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    backdrop_path: '/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg',
    vote_average: 7.9,
    release_date: '2024-07-24'
  },
  {
    id: 106379,
    title: 'Fallout',
    name: 'Fallout',
    media_type: 'tv',
    overview: 'En un futuro postapocalíptico, los habitantes de los refugios nucleares se ven obligados a regresar al desolado e infestado mundo exterior.',
    poster_path: '/AnsSKRawIZN0YjPqxjoPj6hUvev.jpg',
    backdrop_path: '/2rmK7mnchw9w3f9G2xwhlyy9y5V.jpg',
    vote_average: 8.4,
    first_air_date: '2024-04-10'
  },
  {
    id: 872585,
    title: 'Oppenheimer',
    name: 'Oppenheimer',
    media_type: 'movie',
    overview: 'La historia del físico estadounidense J. Robert Oppenheimer y su papel en el desarrollo de la bomba atómica.',
    poster_path: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    backdrop_path: '/fm6KqXrmjMQgrmZwhRyYtkxT3dO.jpg',
    vote_average: 8.1,
    release_date: '2023-07-19'
  },
  {
    id: 108978,
    title: 'El Problema de los 3 Cuerpos',
    name: 'El Problema de los 3 Cuerpos',
    media_type: 'tv',
    overview: 'Una decisión tomada en la China de los años 60 resuena a través del espacio y el tiempo en el presente.',
    poster_path: '/2j71sN21fQp9gX3J5LdZ7Wk8g3b.jpg',
    backdrop_path: '/pwGmXVKUgKn1jW9223x0u1G8Y2L.jpg',
    vote_average: 7.8,
    first_air_date: '2024-03-21'
  }
];

// TOP 10 España (JustWatch Streaming Data)
app.get('/api/catalog/top10/movies', async (req, res) => {
  try {
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=popularity.desc&page=1`;
    const response = await makeRequest(url);
    if (response.data && response.data.results) {
      const top10 = response.data.results.slice(0, 10).map(m => ({ ...m, media_type: 'movie' }));
      return res.json({ success: true, results: top10 });
    }
    return res.json({ success: true, results: FALLBACK_CATALOG.filter(i => i.media_type === 'movie').slice(0, 10) });
  } catch (err) {
    return res.json({ success: true, results: FALLBACK_CATALOG.filter(i => i.media_type === 'movie').slice(0, 10) });
  }
});

app.get('/api/catalog/top10/series', async (req, res) => {
  try {
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=popularity.desc&page=1`;
    const response = await makeRequest(url);
    if (response.data && response.data.results) {
      const top10 = response.data.results.slice(0, 10).map(s => ({ ...s, media_type: 'tv' }));
      return res.json({ success: true, results: top10 });
    }
    return res.json({ success: true, results: FALLBACK_CATALOG.filter(i => i.media_type === 'tv').slice(0, 10) });
  } catch (err) {
    return res.json({ success: true, results: FALLBACK_CATALOG.filter(i => i.media_type === 'tv').slice(0, 10) });
  }
});

// 100% Spanish Productions (Producciones de España)
app.get('/api/catalog/spain/movies', async (req, res) => {
  try {
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_origin_country=ES&sort_by=popularity.desc&page=1`;
    const response = await makeRequest(url);
    if (response.data && response.data.results) {
      const sp = response.data.results.map(m => ({ ...m, media_type: 'movie' }));
      return res.json({ success: true, results: sp });
    }
    return res.json({ success: true, results: [] });
  } catch (err) {
    return res.json({ success: true, results: [] });
  }
});

app.get('/api/catalog/spain/series', async (req, res) => {
  try {
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&language=es-ES&with_origin_country=ES&sort_by=popularity.desc&page=1`;
    const response = await makeRequest(url);
    if (response.data && response.data.results) {
      const sp = response.data.results.map(s => ({ ...s, media_type: 'tv' }));
      return res.json({ success: true, results: sp });
    }
    return res.json({ success: true, results: [] });
  } catch (err) {
    return res.json({ success: true, results: [] });
  }
});


// Proxy TMDB / JustWatch España Trending Movies & TV Shows (30 Items)
app.get('/api/catalog/trending', async (req, res) => {
  const type = req.query.type || 'all';

  try {
    let baseUrl = `https://api.themoviedb.org/3/trending/${type}/day?api_key=${TMDB_API_KEY}&language=es-ES&region=ES`;
    if (type === 'movie') {
      baseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=popularity.desc`;
    } else if (type === 'tv') {
      baseUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=popularity.desc`;
    }

    const [p1, p2] = await Promise.all([
      makeRequest(`${baseUrl}&page=1`),
      makeRequest(`${baseUrl}&page=2`)
    ]);

    const r1 = (p1.data && p1.data.results) ? p1.data.results : [];
    const r2 = (p2.data && p2.data.results) ? p2.data.results : [];
    const combined = [...r1, ...r2].slice(0, 30);

    if (combined.length > 0) {
      return res.json({ success: true, results: combined });
    }
    
    return res.json({ success: true, results: FALLBACK_CATALOG });
  } catch (error) {
    return res.json({ success: true, results: FALLBACK_CATALOG });
  }
});



// Endpoint JustWatch España (Popular Movies & TV Shows across Netflix, HBO, Prime Video, Movistar+, Disney+)
app.get('/api/catalog/justwatch', async (req, res) => {
  const providerId = req.query.provider; // e.g. 8 (Netflix), 337 (Disney+), 119 (Prime), 384 (HBO), 149 (Movistar+)
  const providerFilter = providerId ? `&with_watch_providers=${providerId}` : '&with_watch_providers=8|337|119|384|149|68|381';

  try {
    const movieUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES${providerFilter}&sort_by=popularity.desc&page=1`;
    const tvUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES${providerFilter}&sort_by=popularity.desc&page=1`;

    const [movieRes, tvRes] = await Promise.all([
      makeRequest(movieUrl),
      makeRequest(tvUrl)
    ]);

    const movies = (movieRes.data && movieRes.data.results) 
      ? movieRes.data.results.map(m => ({ ...m, media_type: 'movie' })) 
      : [];
    const series = (tvRes.data && tvRes.data.results) 
      ? tvRes.data.results.map(s => ({ ...s, media_type: 'tv' })) 
      : [];

    // Interleave movies and series for a balanced JustWatch ES feed
    const combined = [];
    const maxLen = Math.max(movies.length, series.length);
    for (let i = 0; i < maxLen; i++) {
      if (movies[i]) combined.push(movies[i]);
      if (series[i]) combined.push(series[i]);
    }

    return res.json({ success: true, results: combined.slice(0, 30) });
  } catch (err) {
    return res.json({ success: true, results: FALLBACK_CATALOG });
  }
});

// Proxy TMDB Search
app.get('/api/catalog/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.json({ success: true, results: [] });

  try {
    const cleanQuery = query.replace(/[ªº:.]/g, ' ').replace(/\s+/g, ' ').trim();

    const [rawRes, cleanRes] = await Promise.all([
      makeRequest(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=1`),
      makeRequest(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(cleanQuery)}&page=1`)
    ]);

    const items1 = (rawRes.data && rawRes.data.results) ? rawRes.data.results : [];
    const items2 = (cleanRes.data && cleanRes.data.results) ? cleanRes.data.results : [];

    const combinedMap = new Map();
    [...items1, ...items2].forEach(item => {
      if ((item.media_type === 'movie' || item.media_type === 'tv') && !combinedMap.has(item.id)) {
        combinedMap.set(item.id, item);
      }
    });

    const results = Array.from(combinedMap.values());
    if (results.length > 0) {
      return res.json({ success: true, results: results });
    }

    const matched = FALLBACK_CATALOG.filter(item => 
      (item.title || item.name || '').toLowerCase().includes(query.toLowerCase())
    );
    return res.json({ success: true, results: matched });
  } catch (error) {
    const matched = FALLBACK_CATALOG.filter(item => 
      (item.title || item.name || '').toLowerCase().includes(query.toLowerCase())
    );
    return res.json({ success: true, results: matched });
  }
});


// Fetch Stream Options for Palantir Stream Selector Modal
app.post('/api/debrid/streams', async (req, res) => {
  const { title, type, season, episode, tmdbId, imdbId } = req.body;
  const isTv = type === 'tv' || type === 'series' || type === 'show';
  const mediaKind = isTv ? 'series' : 'movie';

  let targetImdb = imdbId;

  if (!targetImdb && tmdbId) {
    try {
      const extUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const extRes = await makeRequest(extUrl);
      if (extRes.data && extRes.data.imdb_id) {
        targetImdb = extRes.data.imdb_id;
      }
    } catch (e) {}
  }

  if (!targetImdb && title) {
    try {
      const cleanTitle = title.replace(/S\d+E\d+/i, '').replace(/T\d+E\d+/i, '').replace(/\d{4}/, '').trim();
      const sUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(cleanTitle)}&page=1`;
      const sRes = await makeRequest(sUrl);
      if (sRes.data && sRes.data.results && sRes.data.results.length > 0) {
        const match = sRes.data.results[0];
        const mType = match.media_type || (match.first_air_date ? 'tv' : 'movie');
        const extUrl = `https://api.themoviedb.org/3/${mType}/${match.id}/external_ids?api_key=${TMDB_API_KEY}`;
        const extRes = await makeRequest(extUrl);
        if (extRes.data && extRes.data.imdb_id) {
          targetImdb = extRes.data.imdb_id;
        }
      }
    } catch (e) {}
  }

  if (!targetImdb) {
    return res.json({ success: false, message: 'No se pudo obtener la ID del contenido', streams: [] });
  }

  const epSuffix = isTv ? `:${season || 1}:${episode || 1}` : '';
  const mirrors = [
    `https://torrentio.strem.fun/language=spanish/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
    `https://torrentio.strem.fun/stream/${mediaKind}/${targetImdb}${epSuffix}.json`,
    `https://torrentio.strem.fun/sort=quality/stream/${mediaKind}/${targetImdb}${epSuffix}.json`
  ];

  let rawStreams = [];
  for (const mUrl of mirrors) {
    try {
      const response = await makeRequest(mUrl);
      if (response.data && response.data.streams && response.data.streams.length > 0) {
        rawStreams = response.data.streams;
        break;
      }
    } catch (e) {}
  }

  if (rawStreams.length === 0) {
    return res.json({ success: false, message: 'No se encontraron fuentes disponibles', streams: [] });
  }

  const parsedStreams = rawStreams.map(st => {
    const titleText = (st.title || '') + ' ' + (st.name || '') + ' ' + (st.behaviorHints?.filename || '');
    const txt = titleText.toLowerCase();

    let quality = 'HD';
    if (/2160p|4k|uhd/i.test(txt)) quality = '4K UHD';
    else if (/1080p|fhd/i.test(txt)) quality = '1080p';
    else if (/720p/i.test(txt)) quality = '720p';
    else if (/480p|dvdrip|sd/i.test(txt)) quality = '480p';

    let audio = '🇬🇧 Inglés / VOS';
    if (/\[esp\]|castellano|español|lobezno|dontorrent|grantorrent|wolfmax4k|descargas2020|newpct|todotorrents|atomohd|spa\b|esp\b|spanish|spain|🇪🇸/i.test(txt)) {
      audio = '🇪🇸 Castellano';
    } else if (/latino|lat\b|🇲🇽/i.test(txt)) {
      audio = '🇲🇽 Latino';
    } else if (/multi|dual/i.test(txt)) {
      audio = '🌐 Multi-Audio';
    }

    const sizeMatch = titleText.match(/💾\s*([\d\.]+\s*(?:GB|MB))/i) || titleText.match(/([\d\.]+\s*(?:GB|MB))/i);
    const size = sizeMatch ? sizeMatch[1] : '';

    const providerMatch = titleText.match(/⚙️\s*([^\n\r]+)/) || titleText.match(/([A-Za-z0-9]+Torrent[A-Za-z0-9]*|1337x|RARBG|TorrentGalaxy|EZTV|ThePirateBay)/i);
    const provider = providerMatch ? providerMatch[1].trim() : 'Torrent';

    return {
      quality,
      audio,
      size,
      provider,
      infoHash: st.infoHash,
      stream: st
    };
  });

  const castellano = parsedStreams.filter(p => p.audio.includes('Castellano'));
  const multi = parsedStreams.filter(p => p.audio.includes('Multi'));
  const latino = parsedStreams.filter(p => p.audio.includes('Latino'));
  const others = parsedStreams.filter(p => !castellano.includes(p) && !multi.includes(p) && !latino.includes(p));

  const sortedStreams = [...castellano, ...multi, ...latino, ...others];

  return res.json({ success: true, streams: sortedStreams });
});

// -------------------------------------------------------------
// PALANTIR 3 API ENDPOINTS & CATALOG CLONE
// -------------------------------------------------------------
const PALANTIR_SECTIONS = [
  { id: 'estrenos', name: 'Estrenos de Cine', icon: 'fa-solid fa-fire-flame-curated', color: '#fbbf24' },
  { id: 'cine4k', name: 'Cine 4K UHD', icon: 'fa-solid fa-gem', color: '#38bdf8' },
  { id: 'series', name: 'Series Novedades', icon: 'fa-solid fa-tv', color: '#a855f7' },
  { id: 'infantil', name: 'Infantil & Anime', icon: 'fa-solid fa-child-reaching', color: '#f43f5e' },
  { id: 'documentales', name: 'Documentales', icon: 'fa-solid fa-earth-americas', color: '#10b981' },
  { id: 'colecciones', name: 'Sagas & Colecciones', icon: 'fa-solid fa-layer-group', color: '#eab308' }
];

app.get('/api/palantir/sections', (req, res) => {
  res.json({ success: true, sections: PALANTIR_SECTIONS });
});

app.get('/api/palantir/catalog/:sectionId', async (req, res) => {
  const { sectionId } = req.params;

  try {
    let tmdbBaseUrl = '';
    if (sectionId === 'estrenos') {
      tmdbBaseUrl = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES&region=ES`;
    } else if (sectionId === 'cine4k') {
      tmdbBaseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=vote_average.desc&vote_count.gte=300`;
    } else if (sectionId === 'series') {
      tmdbBaseUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&sort_by=popularity.desc`;
    } else if (sectionId === 'infantil') {
      tmdbBaseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&with_genres=16,10751&sort_by=popularity.desc`;
    } else if (sectionId === 'documentales') {
      tmdbBaseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&region=ES&watch_region=ES&with_genres=99&sort_by=popularity.desc`;
    } else {
      tmdbBaseUrl = `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=es-ES&region=ES`;
    }

    const [p1, p2] = await Promise.all([
      makeRequest(`${tmdbBaseUrl}&page=1`),
      makeRequest(`${tmdbBaseUrl}&page=2`)
    ]);

    const r1 = (p1.data && p1.data.results) ? p1.data.results : [];
    const r2 = (p2.data && p2.data.results) ? p2.data.results : [];
    const combined = [...r1, ...r2].slice(0, 30);

    if (combined.length > 0) {
      return res.json({ success: true, results: combined });
    }

    return res.json({ success: true, results: FALLBACK_CATALOG });
  } catch (err) {
    return res.json({ success: true, results: FALLBACK_CATALOG });
  }
});


// Proxy TMDB Details (Details + Videos + Seasons/Episodes if TV)
app.get('/api/catalog/details/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const numericId = parseInt(id, 10);

  // Check fallback catalog first
  const fallbackItem = FALLBACK_CATALOG.find(i => i.id === numericId);

  try {
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=external_ids,videos,credits,recommendations`;
    const response = await makeRequest(url);

    if (response.data && !response.data.status_code && (response.data.title || response.data.name)) {
      return res.json({ success: true, details: response.data });
    }

    if (fallbackItem) {
      return res.json({
        success: true,
        details: {
          ...fallbackItem,
          seasons: type === 'tv' ? [{ season_number: 1, episode_count: 8, name: 'Temporada 1' }] : []
        }
      });
    }

    // Generic fallback object if not in list
    return res.json({
      success: true,
      details: {
        id: numericId,
        title: 'Título de Catálogo',
        name: 'Título de Catálogo',
        overview: 'Disfruta de este título mediante el motor de búsqueda y desrestricción de AllDebrid.',
        poster_path: '',
        backdrop_path: '',
        vote_average: 8.0,
        release_date: '2024-01-01',
        seasons: type === 'tv' ? [{ season_number: 1, episode_count: 8, name: 'Temporada 1' }] : []
      }
    });
  } catch (error) {
    if (fallbackItem) {
      return res.json({ success: true, details: fallbackItem });
    }
    return res.json({
      success: true,
      details: {
        id: numericId,
        title: 'Título de Catálogo',
        name: 'Título de Catálogo',
        overview: 'Disfruta de este contenido con tu cuenta de AllDebrid.',
        vote_average: 8.0,
        seasons: type === 'tv' ? [{ season_number: 1, episode_count: 8, name: 'Temporada 1' }] : []
      }
    });
  }
});

// TV Season Details
app.get('/api/catalog/tv/:id/season/:seasonNumber', async (req, res) => {
  const { id, seasonNumber } = req.params;

  try {
    const url = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const response = await makeRequest(url);

    if (response.data && response.data.episodes && response.data.episodes.length > 0) {
      return res.json({ success: true, season: response.data });
    }

    // Fallback episodes
    const fallbackEpisodes = Array.from({ length: 8 }, (_, i) => ({
      episode_number: i + 1,
      name: `Episodio ${i + 1}`,
      overview: `Episodio ${i + 1} de la temporada ${seasonNumber}`
    }));

    return res.json({
      success: true,
      season: {
        season_number: parseInt(seasonNumber, 10),
        episodes: fallbackEpisodes
      }
    });
  } catch (error) {
    const fallbackEpisodes = Array.from({ length: 8 }, (_, i) => ({
      episode_number: i + 1,
      name: `Episodio ${i + 1}`,
      overview: `Episodio ${i + 1} de la temporada ${seasonNumber}`
    }));

    return res.json({
      success: true,
      season: {
        season_number: parseInt(seasonNumber, 10),
        episodes: fallbackEpisodes
      }
    });
  }
});


// Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'PalanWeb', timestamp: new Date().toISOString() });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` 🚀 PalanWeb iniciado exitosamente en puerto ${PORT}`);
  console.log(` 📱 Accede en iPhone: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
