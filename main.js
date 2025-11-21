// OMDb Proxy Configuration
const OMDB_PROXY_URL = '/api/tmdb';
const AUTH_BASE_URL = '/api/auth';
const USER_STORAGE_KEY = 'flixvault_user';
const LIST_TYPES = ['watched', 'watching', 'planned', 'onhold', 'dropped'];
const POSTER_PLACEHOLDER = 'https://via.placeholder.com/300x450?text=No+Image';

const CATEGORY_TITLE_MAP = {
    trending: ['Oppenheimer', 'Barbie', 'Dune: Part Two', 'Killers of the Flower Moon', 'Poor Things', 'The Marvels', 'The Batman', 'Everything Everywhere All at Once', 'Top Gun: Maverick', 'Spider-Man: No Way Home', 'Dune', 'No Time to Die', 'The Matrix Resurrections', 'Eternals', 'Shang-Chi'],
    popular: ['The Dark Knight', 'Inception', 'Interstellar', 'Avengers: Endgame', 'Avatar', 'Joker', 'Parasite', '1917', 'Once Upon a Time in Hollywood', 'Joker', 'Avengers: Infinity War', 'The Lion King', 'Frozen II', 'Toy Story 4', 'Captain Marvel'],
    top_rated: ['The Godfather', 'The Shawshank Redemption', '12 Angry Men', 'Fight Club', 'Pulp Fiction', 'The Green Mile', 'Schindler\'s List', 'The Lord of the Rings: The Return of the King', 'Forrest Gump', 'Goodfellas', 'The Matrix', 'Se7en', 'The Silence of the Lambs', 'Saving Private Ryan', 'The Prestige'],
    bollywood: ['Jawan', 'Pathaan', 'RRR', 'Kantara', '3 Idiots', 'Gadar 2', 'Dangal', 'Baahubali 2', 'PK', 'Dhoom 3', 'Bajrangi Bhaijaan', 'Sultan', 'Tiger Zinda Hai', 'War', 'Kabir Singh'],
    hollywood: ['Mission: Impossible - Dead Reckoning', 'Top Gun: Maverick', 'John Wick: Chapter 4', 'No Time to Die', 'Black Panther', 'Spider-Man: No Way Home', 'Doctor Strange', 'Thor: Love and Thunder', 'Jurassic World Dominion', 'Minions: The Rise of Gru', 'The Batman', 'Uncharted', 'Sonic the Hedgehog 2', 'Morbius', 'The Lost City']
};

const MOVIES_PER_PAGE = 6; // Number of movies to load per scroll

// Google OAuth Configuration
// Setup Instructions:
// 1. Go to Google Cloud Console (https://console.cloud.google.com/)
// 2. Create/Select your project
// 3. Enable "Google+ API" or "Google Identity Services"
// 4. Go to Credentials → Create OAuth 2.0 Client ID → Web application
// 5. Add Authorized JavaScript origins:
//    - http://localhost:3000 (for local testing)
//    - http://127.0.0.1:3000 (alternative localhost)
//    - Your production domain (e.g., https://yourdomain.com)
// 6. NO REDIRECT URIs needed for Google Identity Services (new method)
// 7. Copy the Client ID and paste it below
// Cache for API responses - Performance Optimization
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// User state
let currentUser = null;
let currentCategory = 'trending';
let currentCategoryMovies = []; // Store movies from current category for filtering
let displayedMoviesCount = 0; // Track how many movies are currently displayed
let isLoadingMore = false; // Prevent multiple simultaneous loads
let allCategoryMovies = []; // Store all movies for infinite scroll
let lastSearchResults = []; // Store latest search results so filters can apply to searches

function createEmptyLists() {
    return {
        watched: [],
        watching: [],
        planned: [],
        onhold: [],
        dropped: []
    };
}

let userMovieLists = createEmptyLists();

// Filter state
let currentFilters = {
    genre: '',
    year: '',
    language: '',
    rating: ''
};

function normalizeServerLists(lists = {}) {
    const normalized = createEmptyLists();
    LIST_TYPES.forEach(type => {
        if (Array.isArray(lists[type])) {
            normalized[type] = lists[type].map(item => ({
                ...item,
                id: item.imdbId || item.id,
                listType: type
            }));
        } else {
            normalized[type] = [];
        }
    });
    return normalized;
}

function movieMatchesFilters(movie) {
    if (!movie) return false;

    // Normalize movie fields into a predictable shape for matching
    function normalizeMovieForFiltering(m) {
        const LANG_MAP = {
            english: 'en', hindi: 'hi', tamil: 'ta', telugu: 'te', malayalam: 'ml', kannada: 'kn',
            spanish: 'es', french: 'fr', japanese: 'ja', korean: 'ko', german: 'de', italian: 'it',
            portuguese: 'pt', russian: 'ru', chinese: 'zh'
        };

        const out = {
            genres: [], // array of normalized genre strings
            year: null,  // 'YYYY'
            languages: new Set(), // mix of names & iso codes
            rating: null
        };

        // Genres
        const rawGenres = m.genres || m.genre || m.Genre || [];
        const pushGenre = (g) => {
            if (!g) return;
            if (typeof g === 'string') {
                g.split(',').forEach(p => {
                    const s = String(p).toLowerCase().trim().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
                    if (s) out.genres.push(s);
                });
            } else if (typeof g === 'object') {
                const name = (g.name || g.label || '').toString().toLowerCase().trim();
                name.split(',').forEach(p => {
                    const s = String(p).toLowerCase().trim().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
                    if (s) out.genres.push(s);
                });
            }
        };
        if (Array.isArray(rawGenres)) rawGenres.forEach(pushGenre);
        else pushGenre(rawGenres);

        // Year extraction
        const yearCandidates = [m.year, m.release_date, m.releaseDate, m.Year, m.raw && m.raw.Year];
        for (const c of yearCandidates) {
            if (!c) continue;
            const s = String(c);
            const match = s.match(/(\d{4})/);
            if (match) { out.year = match[1]; break; }
        }

        // Languages
        if (m.language) m.language.toString().split(',').forEach(l => out.languages.add(l.toLowerCase().trim()));
        if (m.raw && m.raw.Language) m.raw.Language.toString().split(',').forEach(l => out.languages.add(l.toLowerCase().trim()));
        if (m.spoken_languages && Array.isArray(m.spoken_languages)) {
            m.spoken_languages.forEach(sl => {
                if (!sl) return;
                if (typeof sl === 'string') sl.split(',').forEach(l => out.languages.add(l.toLowerCase().trim()));
                else {
                    if (sl.name) out.languages.add(sl.name.toLowerCase().trim());
                    if (sl.iso_639_1) out.languages.add(sl.iso_639_1.toLowerCase().trim());
                }
            });
        }
        if (m.original_language) out.languages.add(m.original_language.toLowerCase().trim());

        // Augment with ISO codes and names from map
        Array.from(out.languages).forEach(l => {
            const key = l.toLowerCase();
            if (LANG_MAP[key]) out.languages.add(LANG_MAP[key]);
            const nameFromCode = Object.keys(LANG_MAP).find(k => LANG_MAP[k] === key);
            if (nameFromCode) out.languages.add(nameFromCode);
        });

        // Rating
        const mr = m.vote_average || m.rating || m.imdbRating;
        out.rating = mr === null || mr === undefined ? null : Number(mr);

        return out;
    }

    const norm = normalizeMovieForFiltering(movie);

    // Genre filter
    if (currentFilters.genre) {
        const filter = currentFilters.genre.toLowerCase().trim().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');
        if (!filter) return false;
        if (!norm.genres || norm.genres.length === 0) return false;
        const matched = norm.genres.some(g => g === filter || g.includes(filter) || filter.includes(g));
        if (!matched) return false;
    }

    // Year filter
    if (currentFilters.year) {
        const filterYear = currentFilters.year.toString().trim();
        if (!norm.year) return false;
        if (filterYear.endsWith('s')) {
            const prefix = filterYear.replace(/s$/i, '');
            if (!norm.year.startsWith(prefix)) return false;
        } else if (norm.year !== filterYear) {
            return false;
        }
    }

    // Language filter
    if (currentFilters.language) {
        const filterLanguage = currentFilters.language.toLowerCase().trim();
        if (!filterLanguage) return false;
        if (!norm.languages || norm.languages.size === 0) return false;
        const found = Array.from(norm.languages).some(l => {
            const ll = l.toLowerCase();
            return ll === filterLanguage || ll.includes(filterLanguage) || filterLanguage.includes(ll);
        });
        if (!found) return false;
    }

    // Rating filter
    if (currentFilters.rating) {
        const ratingValue = Number(currentFilters.rating);
        if (Number.isNaN(ratingValue)) return false;
        if (norm.rating === null || norm.rating === undefined || Number.isNaN(norm.rating) || norm.rating < ratingValue) return false;
    }

    return true;
}

// Helper to normalize OMDb payload into the structure the UI expects
function normalizeOmdbMovie(data) {
    if (!data || data.Response === 'False') return null;
    
    return {
        id: data.imdbID,
        title: data.Title,
        originalTitle: data.Title,
        release_date: data.Released && data.Released !== 'N/A' ? data.Released : '',
        year: data.Year && data.Year !== 'N/A' ? data.Year : '',
        runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : '',
        genres: data.Genre ? data.Genre.split(',').map(name => ({ name: name.trim() })) : [],
        poster_path: data.Poster && data.Poster !== 'N/A' ? data.Poster : '',
        backdrop_path: data.Poster && data.Poster !== 'N/A' ? data.Poster : '',
        vote_average: data.imdbRating && data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null,
        imdbVotes: data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : '',
        plot: data.Plot && data.Plot !== 'N/A' ? data.Plot : 'Plot information unavailable.',
        director: data.Director && data.Director !== 'N/A' ? data.Director : 'Unknown',
        writer: data.Writer && data.Writer !== 'N/A' ? data.Writer : 'Unknown',
        actors: data.Actors && data.Actors !== 'N/A' ? data.Actors.split(',').map(name => name.trim()) : [],
        language: data.Language && data.Language !== 'N/A' ? data.Language : 'Unknown',
        country: data.Country && data.Country !== 'N/A' ? data.Country : 'Unknown',
        awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : 'No awards info',
        boxOffice: data.BoxOffice && data.BoxOffice !== 'N/A' ? data.BoxOffice : 'N/A',
        website: data.Website && data.Website !== 'N/A' ? data.Website : '',
        raw: data
    };
}

async function fetchMovieByTitle(title, extraParams = {}) {
    if (!title && !extraParams.imdb) {
        throw new Error('Movie title is required');
    }

    const payload = {
        plot: 'full',
        ...extraParams
    };

    if (title) {
        payload.title = title.trim();
    }

    Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
            delete payload[key];
        }
    });

    const cacheKey = `omdb_${JSON.stringify(payload)}`;
    const now = Date.now();
    const cached = apiCache.get(cacheKey);
    if (cached && (now - cached.timestamp < CACHE_DURATION)) {
        return cached.data;
    }

    let response;
    try {
        response = await fetch(OMDB_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (networkError) {
        // Network error - no internet connection
        const error = new Error('NO_INTERNET');
        error.originalError = networkError;
        throw error;
    }

    if (!response.ok) {
        let errorMessage = '';
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || '';
        } catch {
            try {
                errorMessage = await response.text();
            } catch {
                // Ignore parsing failures
            }
        }
        
        // Check if it's a 404 (movie not found)
        if (response.status === 404 || errorMessage.toLowerCase().includes('movie not found') || errorMessage.toLowerCase().includes('not found')) {
            const error = new Error('MOVIE_NOT_FOUND');
            error.details = errorMessage || 'Movie does not exist';
            throw error;
        }
        
        // Other HTTP errors
        const error = new Error('ERROR_OCCURRED');
        error.details = errorMessage || 'An error occurred while searching for the movie';
        throw error;
    }

    const data = await response.json();
    const normalized = normalizeOmdbMovie(data);
    if (!normalized) {
        const error = new Error('MOVIE_NOT_FOUND');
        throw error;
    }

    apiCache.set(cacheKey, { data: normalized, timestamp: now });
    if (apiCache.size > 100) {
        const firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
    }

    return normalized;
}

// Fetch multiple movies by title in batches to reduce total load time
async function fetchMoviesByTitles(titles = [], batchSize = 4) {
    const movies = [];
    if (!Array.isArray(titles) || titles.length === 0) return movies;

    // Process titles in batches to avoid firing too many concurrent requests
    for (let i = 0; i < titles.length; i += batchSize) {
        const batch = titles.slice(i, i + batchSize);

        // Map each title to a fetch promise and catch errors per-title
        const promises = batch.map(title =>
            fetchMovieByTitle(title).catch(error => {
                console.warn(`OMDb lookup failed for "${title}":`, error && error.message ? error.message : error);
                return null;
            })
        );

        // Wait for the batch to complete
        const results = await Promise.all(promises);

        // Add successful results
        results.forEach(m => { if (m) movies.push(m); });
    }

    return movies;
}

function getFriendlyMovieError(error) {
    if (!error) {
        return 'An error occurred';
    }
    
    // Check for specific error types
    if (error.message === 'NO_INTERNET') {
        return 'No internet connection. Please check your network and try again.';
    }
    
    if (error.message === 'MOVIE_NOT_FOUND') {
        return 'Movie does not exist';
    }
    
    if (error.message === 'ERROR_OCCURRED') {
        return 'An error occurred';
    }
    
    // Fallback for other errors
    if (error.message) {
        const msg = error.message.toLowerCase();
        if (msg.includes('movie not found') || msg.includes('does not exist')) {
            return 'Movie does not exist';
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
            return 'No internet connection. Please check your network and try again.';
        }
        return 'An error occurred';
    }
    
    return 'An error occurred';
}

function normalizeListsAfterResponse(lists) {
    userMovieLists = normalizeServerLists(lists);
    updateListCounts();
}

async function fetchUserLists(showErrors = true) {
    if (!currentUser || currentUser.provider === 'demo') {
        userMovieLists = createEmptyLists();
        updateListCounts();
        return;
    }
    
    try {
        const response = await fetch('/api/lists', { credentials: 'include' });
        if (!response.ok) {
            throw new Error('Failed to load your lists');
        }
        const data = await response.json();
        normalizeListsAfterResponse(data.lists);
    } catch (error) {
        if (showErrors) {
            console.error('Failed to load lists:', error);
        }
        userMovieLists = createEmptyLists();
        updateListCounts();
    }
}

function buildMoviePayload(movie) {
    if (!movie) return null;
    return {
        imdbId: movie.id || movie.imdbId || movie.imdbID,
        title: movie.title || movie.originalTitle || 'Untitled',
        poster: movie.poster_path || movie.poster || '',
        releaseDate: movie.release_date || movie.year || movie.releaseDate || '',
        rating: movie.vote_average || movie.rating || null,
        runtime: movie.runtime || movie.runtimeMinutes || '',
        plot: movie.plot || movie.overview || ''
    };
}

async function saveMovieToListOnServer(movie, listType) {
    if (!currentUser || currentUser.provider === 'demo') {
        // Demo mode fallback to in-memory only
        LIST_TYPES.forEach(type => {
            userMovieLists[type] = userMovieLists[type].filter(item => item.id !== movie.id);
        });
        userMovieLists[listType].unshift({
            ...movie,
            id: movie.id,
            listType
        });
        updateListCounts();
        return;
    }
    
    const payload = buildMoviePayload(movie);
    if (!payload || !payload.imdbId) {
        throw new Error('Movie is missing identifier');
    }
    
    const response = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ listType, movie: payload })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to save movie to list');
    }
    
    const data = await response.json();
    normalizeListsAfterResponse(data.lists);
}

async function deleteMovieFromServer(listType, movieId) {
    if (!currentUser || currentUser.provider === 'demo') {
        if (listType === 'all') {
            LIST_TYPES.forEach(type => {
                userMovieLists[type] = userMovieLists[type].filter(m => (m.id || m.imdbId) !== movieId);
            });
        } else {
            userMovieLists[listType] = userMovieLists[listType].filter(m => (m.id || m.imdbId) !== movieId);
        }
        updateListCounts();
        return;
    }
    
    const response = await fetch(`/api/lists/${listType}/${movieId}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to remove movie from list');
    }
    
    const data = await response.json();
    normalizeListsAfterResponse(data.lists);
}

function showAuthMessage(element, message = '') {
    if (!element) return;
    element.textContent = message;
    if (message) {
        element.classList.add('active');
    } else {
        element.classList.remove('active');
    }
}

function toggleButtonLoading(button, isLoading, loadingText = 'Please wait...') {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        button.disabled = true;
        button.textContent = loadingText;
        button.classList.add('loading');
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || button.textContent;
        button.classList.remove('loading');
    }
}

async function authRequest(endpoint, payload) {
    const response = await fetch(`${AUTH_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
    });
    
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        console.warn('Failed to parse auth response', error);
    }
    
    if (!response.ok) {
        const message = data?.message || 'Authentication failed. Please try again.';
        throw new Error(message);
    }
    
    return data;
}

// DOM elements
const authContainer = document.getElementById('authContainer');
const mainContent = document.getElementById('mainContent');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const logoutBtn = document.getElementById('logoutBtn');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const moviesGrid = document.getElementById('moviesGrid');
const loading = document.getElementById('loading');
const movieModal = document.getElementById('movieModal');
const modalClose = document.getElementById('modalClose');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const filterToggle = document.getElementById('filterToggle');
const advancedFilters = document.getElementById('advancedFilters');
const closeFilters = document.getElementById('closeFilters');
const applyFilters = document.getElementById('applyFilters');
const resetFilters = document.getElementById('resetFilters');
const homePage = document.getElementById('homePage');
const myListPage = document.getElementById('myListPage');
const myListGrid = document.getElementById('myListGrid');
const dashboardPage = document.getElementById('dashboardPage');
const loginErrorText = document.getElementById('loginError');
const registerErrorText = document.getElementById('registerError');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setupEventListeners();
});

function setupEventListeners() {
    // Auth Tab Switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById(`${tabName}Form`).classList.add('active');
        });
    });

    // Login Handler
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = loginForm.querySelector('input[type="email"]').value.trim();
        const password = loginForm.querySelector('input[type="password"]').value;
        const submitBtn = loginForm.querySelector('.auth-btn');
        
        showAuthMessage(loginErrorText, '');
        toggleButtonLoading(submitBtn, true, 'Logging in...');
        
        try {
            const data = await authRequest('/login', { email, password });
            if (data?.user) {
                await loginUser({ ...data.user, provider: 'email' });
                loginForm.reset();
            }
        } catch (error) {
            showAuthMessage(loginErrorText, error.message);
        } finally {
            toggleButtonLoading(submitBtn, false);
        }
    });

    // Register Handler
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = registerForm.querySelector('input[type="text"]').value.trim();
        const email = registerForm.querySelector('input[type="email"]').value.trim();
        const password = registerForm.querySelector('input[type="password"]').value;
        const submitBtn = registerForm.querySelector('.auth-btn');
        
        showAuthMessage(registerErrorText, '');
        toggleButtonLoading(submitBtn, true, 'Creating account...');
        
        try {
            const data = await authRequest('/signup', { name, email, password });
            if (data?.user) {
                await loginUser({ ...data.user, provider: 'email' });
                registerForm.reset();
            }
        } catch (error) {
            showAuthMessage(registerErrorText, error.message);
        } finally {
            toggleButtonLoading(submitBtn, false);
        }
    });

    // Logout Handler
    logoutBtn.addEventListener('click', logout);

    // Category Filter
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentCategory = btn.dataset.category;
            searchInput.value = '';
            loadMoviesByCategory(currentCategory);
        });
    });

    // Search Handler with Debouncing for Performance
    let searchTimeout;
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        performSearch();
    });

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length >= 3) {
            searchTimeout = setTimeout(() => performSearch(), 500);
        }
    });

    function performSearch() {
        const query = searchInput.value.trim();
        if (query) {
            searchMovies(query);
        }
    }

    // Filter Toggle
    filterToggle.addEventListener('click', () => {
        advancedFilters.classList.toggle('active');
    });

    closeFilters.addEventListener('click', () => {
        advancedFilters.classList.remove('active');
    });

    // Apply Filters
    applyFilters.addEventListener('click', () => {
        currentFilters = {
            genre: document.getElementById('genreFilter').value.trim(),
            year: document.getElementById('yearFilter').value.trim(),
            language: document.getElementById('languageFilter').value.trim(),
            rating: document.getElementById('ratingFilter').value.trim()
        };
        // Filters work on category movies regardless of search input
        loadMoviesWithFilters();
    });

    // Reset Filters
    resetFilters.addEventListener('click', () => {
        document.getElementById('genreFilter').value = '';
        document.getElementById('yearFilter').value = '';
        document.getElementById('languageFilter').value = '';
        document.getElementById('ratingFilter').value = '';
        currentFilters = { genre: '', year: '', language: '', rating: '' };
        // Reload category movies without filters (don't clear search input)
        loadMoviesByCategory(currentCategory);
    });

    // Modal Close
    modalClose.addEventListener('click', closeModal);
    movieModal.addEventListener('click', (e) => {
        if (e.target === movieModal) closeModal();
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && movieModal.classList.contains('active')) closeModal();
    });

    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            
            if (page === 'home') {
                homePage.classList.add('active');
            } else if (page === 'mylist') {
                myListPage.classList.add('active');
                renderMyList();
            } else if (page === 'dashboard') {
                dashboardPage.classList.add('active');
                loadDashboard();
            }
        });
    });

    // My List Categories
    document.querySelectorAll('.list-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.list-category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderMyList(btn.dataset.list);
        });
    });
}

async function checkAuthStatus() {
    try {
        const response = await fetch(`${AUTH_BASE_URL}/me`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data?.user) {
                await loginUser({ ...data.user, provider: data.user.provider || 'email' }, { silent: true });
                return;
            }
        }
    } catch (error) {
        console.warn('Unable to verify session with backend:', error.message);
    }
    
    const savedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        if (parsedUser?.provider === 'demo') {
            await loginUser(parsedUser, { silent: true });
        }
    }
}

async function loginUser(user, options = {}) {
    if (!user) return;
    
    if (!user.name && user.email) {
        user.name = user.email.split('@')[0];
    }
    
    currentUser = user;
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    
    if (currentUser.provider === 'demo') {
        userMovieLists = createEmptyLists();
        updateListCounts();
    } else {
        await fetchUserLists(!options.silent);
    }
    
    if (!options.silent) {
        console.log(`🎬 Welcome to FlixVault, ${user.name}!`);
    }
    
    showMainContent();
}

async function logout() {
    try {
        await fetch(`${AUTH_BASE_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.warn('Logout request failed:', error.message);
    }
    
    currentUser = null;
    localStorage.removeItem(USER_STORAGE_KEY);
    userMovieLists = createEmptyLists();
    authContainer.style.display = 'flex';
    mainContent.classList.remove('active');
    moviesGrid.innerHTML = '';
    apiCache.clear(); // Clear cache on logout
    
    console.log('👋 Logged out successfully');
}

function showMainContent() {
    authContainer.style.display = 'none';
    mainContent.classList.add('active');
    
    // Set user avatar
    if (currentUser.picture) {
        userAvatar.style.backgroundImage = `url(${currentUser.picture})`;
        userAvatar.style.backgroundSize = 'cover';
        userAvatar.textContent = '';
    } else {
        userAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
    }
    
    userName.textContent = currentUser.name;
    
    loadMoviesByCategory('trending');
    updateListCounts();
}

// Show Skeleton Loaders
function showSkeletonLoaders(count = 6) {
    const skeletons = Array(count).fill(0).map(() => `
        <div class="movie-card skeleton-card">
            <div class="skeleton-poster"></div>
            <div class="skeleton-content">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-meta"></div>
                <div class="skeleton-line skeleton-text"></div>
                <div class="skeleton-line skeleton-text short"></div>
            </div>
        </div>
    `).join('');
    moviesGrid.innerHTML = skeletons;
}

// Load Movies by Category
async function loadMoviesByCategory(category) {
    showSkeletonLoaders(6);
    console.log('📺 Loading category:', category);
    displayedMoviesCount = 0;
    allCategoryMovies = [];
    
    try {
        const curatedTitles = CATEGORY_TITLE_MAP[category] || CATEGORY_TITLE_MAP.trending;
        const movies = await fetchMoviesByTitles(curatedTitles);
        // Clear previous search results when switching categories
        lastSearchResults = [];
        currentCategoryMovies = movies; // Store for filtering
        allCategoryMovies = movies; // Store all for infinite scroll
        displayMovies(movies.slice(0, MOVIES_PER_PAGE), true); // Initial load
        setupInfiniteScroll();
    } catch (error) {
        console.error('❌ Error loading movies:', error);
        currentCategoryMovies = []; // Clear on error
        allCategoryMovies = [];
        moviesGrid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ff6b6b;">
                <h2 style="margin-bottom:1rem;">❌ Error Loading Movies</h2>
                <p style="margin-bottom:0.5rem;color:#aaa;">${error.message}</p>
                <p style="font-size:0.9rem;color:#666;">Check the browser console (F12) for more details</p>
                <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer;">
                    Retry
                </button>
            </div>
        `;
    }
}

// Load Movies with Filters
async function loadMoviesWithFilters() {
    showSkeletonLoaders(6);
    try {
        // Check if any filters are actually set
        const hasFilters = currentFilters.genre || currentFilters.year || currentFilters.language || currentFilters.rating;
        
        if (!hasFilters) {
            // No filters set, just reload the current category
            await loadMoviesByCategory(currentCategory);
            hideLoading();
            return;
        }
        
        // Filters are set - filter the current category movies by default.
        // This keeps filter behavior consistent regardless of a recent search.
        if (!currentCategoryMovies || currentCategoryMovies.length === 0) {
            await loadMoviesByCategory(currentCategory);
        }
        const sourceMovies = currentCategoryMovies || [];

        // Filter the chosen source
        const filteredMovies = (sourceMovies || []).filter(movie => movieMatchesFilters(movie));
        allCategoryMovies = filteredMovies; // Update for infinite scroll

        if (filteredMovies.length === 0) {
            moviesGrid.innerHTML = `
                <p style="text-align:center;color:#aaa;grid-column:1/-1;padding:3rem;">
                    No movies found matching the selected filters. Try adjusting your filter criteria.
                </p>
            `;
            displayedMoviesCount = 0;
            removeLoadingIndicator();
        } else {
            displayMovies(filteredMovies.slice(0, MOVIES_PER_PAGE), true); // Initial load
            setupInfiniteScroll();
        }
        
        advancedFilters.classList.remove('active');
    } catch (error) {
        console.error('Error loading filtered movies:', error);
        const message = getFriendlyMovieError(error);
        
        // Determine icon and title based on error type
        let icon = '❌';
        let title = 'Error';
        
        if (error.message === 'NO_INTERNET') {
            icon = '📡';
            title = 'No Internet Connection';
        } else if (error.message === 'MOVIE_NOT_FOUND') {
            icon = '🔍';
            title = 'Movie Not Found';
        } else {
            icon = '⚠️';
            title = 'Error Occurred';
        }
        
        moviesGrid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ff6b6b;">
                <h2 style="margin-bottom:1rem;font-size:1.5rem;">${icon} ${title}</h2>
                <p style="margin-bottom:0.5rem;color:#aaa;font-size:1.1rem;">${message}</p>
            </div>
        `;
    }
}

// Search Movies
async function searchMovies(query) {
    showSkeletonLoaders(1);
    console.log('🔍 Searching for:', query);
    
    try {
        const movie = await fetchMovieByTitle(query);
        // Store last search result so filters can apply to it
        lastSearchResults = movie ? [movie] : [];
        displayMovies(lastSearchResults, true);
    } catch (error) {
        console.error('❌ Error searching movies:', error);
        const message = getFriendlyMovieError(error);
        
        // Determine icon and title based on error type
        let icon = '❌';
        let title = 'Search Error';
        
        if (error.message === 'NO_INTERNET') {
            icon = '📡';
            title = 'No Internet Connection';
        } else if (error.message === 'MOVIE_NOT_FOUND') {
            icon = '🔍';
            title = 'Movie Not Found';
        } else {
            icon = '⚠️';
            title = 'Error Occurred';
        }
        
        moviesGrid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ff6b6b;">
                <h2 style="margin-bottom:1rem;font-size:1.5rem;">${icon} ${title}</h2>
                <p style="margin-bottom:0.5rem;color:#aaa;font-size:1.1rem;">${message}</p>
            </div>
        `;
    }
}

// Setup Infinite Scroll
function setupInfiniteScroll() {
    // Remove existing scroll listener
    window.removeEventListener('scroll', handleScroll);
    // Add new scroll listener with throttling
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(handleScroll, 100);
    }, { passive: true });
}

// Handle Scroll for Infinite Loading
function handleScroll() {
    if (isLoadingMore) return;
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // Load more when user is 200px from bottom
    if (scrollTop + windowHeight >= documentHeight - 200) {
        loadMoreMovies();
    }
}

// Load More Movies (Infinite Scroll)
async function loadMoreMovies() {
    if (isLoadingMore || displayedMoviesCount >= allCategoryMovies.length) {
        return;
    }
    
    isLoadingMore = true;
    const nextBatch = allCategoryMovies.slice(displayedMoviesCount, displayedMoviesCount + MOVIES_PER_PAGE);
    
    if (nextBatch.length > 0) {
        displayMovies(nextBatch, false); // Append mode
    }
    
    isLoadingMore = false;
}

// Display Movies with Optimized Rendering
function displayMovies(movies, clear = true) {
    if (!movies || movies.length === 0) {
        if (clear) {
            moviesGrid.innerHTML = `
                <p style="text-align:center;color:#ff6b6b;grid-column:1/-1;padding:3rem;">
                    Movie not found. Please try again.
                </p>
            `;
        }
        return;
    }

    if (clear) {
        moviesGrid.innerHTML = '';
        displayedMoviesCount = 0;
    }

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    const cardsHtml = movies.map(movie => {
        const posterPath = movie.poster_path && movie.poster_path.startsWith('http')
            ? movie.poster_path
            : movie.poster_path
            ? `${movie.poster_path}`
            : POSTER_PLACEHOLDER;
        
        const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)}/10` : 'Rating N/A';
        const year = movie.year || (movie.release_date ? movie.release_date.split(',').pop()?.trim() : 'N/A');
        const runtime = movie.runtime || 'Runtime N/A';
        const genres = movie.genres && movie.genres.length > 0
            ? movie.genres.map(g => `<span class="genre-tag">${g.name}</span>`).join('')
            : '<span class="genre-tag">Genre N/A</span>';
        const isInList = isMovieInAnyList(movie.id);
        const actorsPreview = movie.actors && movie.actors.length > 0 ? movie.actors.slice(0, 3).join(', ') : '';

        return `
            <div class="movie-card" data-movie-id="${movie.id}" data-movie-title="${movie.title}">
                <button class="add-to-list-btn ${isInList ? 'added' : ''}" onclick="event.stopPropagation(); toggleListDropdown('${movie.id}', event)">
                    ${isInList ? '✓' : '+'}
                </button>
                <div class="list-dropdown" id="dropdown-${movie.id}">
                    <button onclick="event.stopPropagation(); addToList('${movie.id}', 'watched')">Watched</button>
                    <button onclick="event.stopPropagation(); addToList('${movie.id}', 'watching')">Currently Watching</button>
                    <button onclick="event.stopPropagation(); addToList('${movie.id}', 'planned')">Plan to Watch</button>
                    <button onclick="event.stopPropagation(); addToList('${movie.id}', 'onhold')">On Hold</button>
                    <button onclick="event.stopPropagation(); addToList('${movie.id}', 'dropped')">Dropped</button>
                </div>
                <div class="movie-card-body" onclick="showMovieDetails('${movie.id}')">
                    <div class="poster-wrapper">
                        <img src="${posterPath}" alt="${movie.title}" class="movie-poster" loading="lazy" data-src="${posterPath}" onerror="this.src='${POSTER_PLACEHOLDER}'">
                        <div class="poster-skeleton"></div>
                    </div>
                    <div class="movie-info">
                        <div class="movie-title">${movie.title}</div>
                        <div class="movie-meta">
                            <span>${year}</span>
                            <span>${runtime}</span>
                            <span class="movie-rating">⭐ ${rating}</span>
                        </div>
                        <div class="movie-genres">${genres}</div>
                        <p class="movie-plot">${movie.plot}</p>
                        ${actorsPreview ? `<p class="movie-actors"><strong>Cast:</strong> ${actorsPreview}${movie.actors.length > 3 ? ', ...' : ''}</p>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    tempDiv.innerHTML = cardsHtml;
    while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
    }
    
    moviesGrid.appendChild(fragment);
    displayedMoviesCount += movies.length;
    
    // Lazy load images after a short delay to allow DOM to settle
    setTimeout(() => {
        lazyLoadImages();
    }, 100);
    
    // Cache movies
    movies.forEach(movie => {
        const cacheKey = `movie_${movie.id}`;
        apiCache.set(cacheKey, { data: movie, timestamp: Date.now() });
    });
    
    // Add loading indicator if more movies available
    if (displayedMoviesCount < allCategoryMovies.length) {
        addLoadingIndicator();
    } else {
        removeLoadingIndicator();
    }
}

// Toggle List Dropdown
function toggleListDropdown(movieId, event) {
    const dropdown = document.getElementById(`dropdown-${movieId}`);
    
    // Close all other dropdowns
    document.querySelectorAll('.list-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
    });
    
    dropdown.classList.toggle('active');
    
    // Close dropdown when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 0);
}

// Add to List
async function addToList(movieId, listType) {
    try {
        // Fetch movie data if not already available
        const cacheKey = `movie_${movieId}`;
        let movie;
        
        if (apiCache.has(cacheKey)) {
            movie = apiCache.get(cacheKey).data;
        } else {
            const card = document.querySelector(`.movie-card[data-movie-id="${movieId}"]`);
            const movieTitle = card?.dataset.movieTitle;
            movie = await fetchMovieByTitle(movieTitle || '');
        }
        
        await saveMovieToListOnServer(movie, listType);
        
        // Update UI
        const btn = document.querySelector(`.movie-card[data-movie-id="${movieId}"] .add-to-list-btn`);
        if (btn) {
            btn.classList.add('added');
            btn.textContent = '✓';
        }
        
        // Close dropdown
        const dropdown = document.getElementById(`dropdown-${movieId}`);
        if (dropdown) dropdown.classList.remove('active');
        
    } catch (error) {
        console.error('Error adding to list:', error);
    }
}

// Check if movie is in any list
function isMovieInAnyList(movieId) {
    return Object.values(userMovieLists).some(list => 
        list.some(movie => movie.id === movieId || movie.imdbId === movieId)
    );
}

// Remove from List
async function removeFromList(movieId) {
    try {
        await deleteMovieFromServer('all', movieId);
    } catch (error) {
        console.error('Error removing from list:', error);
    }
    
    // Update UI
    const activeFilter = document.querySelector('.list-category-btn.active').dataset.list;
    renderMyList(activeFilter);
    
    // Update home page if movie card exists
    const btn = document.querySelector(`.movie-card[data-movie-id="${movieId}"] .add-to-list-btn`);
    if (btn) {
        btn.classList.remove('added');
        btn.textContent = '+';
    }
}

// Show Movie Details
async function showMovieDetails(movieId) {
    showLoading();
    movieModal.classList.add('active');
    
    try {
        const cacheKey = `movie_${movieId}`;
        let movie;
        if (apiCache.has(cacheKey)) {
            movie = apiCache.get(cacheKey).data;
        } else {
            const card = document.querySelector(`.movie-card[data-movie-id="${movieId}"]`);
            const title = card?.dataset.movieTitle;
            movie = await fetchMovieByTitle(title || '');
        }
        await renderMovieDetails(movie);
    } catch (error) {
        console.error('Error fetching movie details:', error);
        document.getElementById('modalBody').innerHTML = '<p style="text-align:center;padding:2rem;">Error loading movie details.</p>';
    }
    hideLoading();
}

// Fetch YouTube Trailer
async function fetchTrailer(title, year) {
    try {
        const response = await fetch(`/api/trailer?title=${encodeURIComponent(title)}&year=${year || ''}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching trailer:', error);
        return null;
    }
}

// Fetch Watch Options
async function fetchWatchOptions(title, year, imdbId) {
    try {
        const params = new URLSearchParams();
        if (title) params.append('title', title);
        if (year) params.append('year', year);
        if (imdbId) params.append('imdbId', imdbId);
        
        const response = await fetch(`/api/watch?${params.toString()}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching watch options:', error);
        return null;
    }
}

// Search YouTube for trailer video ID (client-side)
async function searchYouTubeTrailer(title, year) {
    // This is a simplified approach - in production, use YouTube Data API v3
    const searchQuery = `${title} ${year || ''} official trailer`.trim();
    // We'll use YouTube's embed API with a search-based approach
    // For now, return a search URL that can be embedded
    return {
        searchQuery,
        embedUrl: null // Will be populated if we find a video ID
    };
}

// Render Movie Details
async function renderMovieDetails(movie) {
    const posterPath = movie.poster_path && movie.poster_path.startsWith('http')
        ? movie.poster_path
        : movie.poster_path
        ? `${movie.poster_path}`
        : POSTER_PLACEHOLDER;
    
    const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)}/10` : 'Rating N/A';
    const year = movie.year || movie.release_date || 'Year N/A';
    const runtime = movie.runtime || 'Runtime N/A';
    const genres = movie.genres && movie.genres.length > 0 ? movie.genres.map(g => `<span class="genre-tag">${g.name}</span>`).join('') : '<span class="genre-tag">Genre N/A</span>';
    const actors = movie.actors && movie.actors.length > 0 ? movie.actors.join(', ') : 'Cast information unavailable.';
    const isInList = isMovieInAnyList(movie.id);
    const currentListType = getCurrentListType(movie.id);
    
    // Fetch trailer and watch options
    const trailerData = await fetchTrailer(movie.title, movie.year);
    const watchData = await fetchWatchOptions(movie.title, movie.year, movie.id);
    
    // Build trailer section
    const searchQuery = trailerData?.searchQuery || `${movie.title} ${movie.year || ''} official trailer`;
    const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    const trailerSection = `
        <div class="trailer-section">
            <h3 class="section-title-modal">🎬 Watch Trailer</h3>
            <div class="trailer-container-wrapper">
                <div class="trailer-search-info">
                    <p>Search for "${movie.title}" trailer on YouTube:</p>
                    <a href="${youtubeSearchUrl}" target="_blank" rel="noopener" class="youtube-search-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000">
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                        Search on YouTube
                    </a>
                </div>
                <div class="trailer-embed-placeholder">
                    <p>💡 Tip: Click the button above to find and watch the official trailer on YouTube</p>
                </div>
            </div>
        </div>
    `;
    
    // Build watch options section
    let watchSection = '';
    if (watchData && watchData.watchOptions) {
        const watchOptions = watchData.watchOptions;
        watchSection = `
            <div class="watch-section">
                <h3 class="section-title-modal">📺 Where to Watch</h3>
                <div class="watch-options-grid">
                    <a href="${watchOptions.netflix}" target="_blank" rel="noopener" class="watch-option-card" data-service="netflix">
                        <div class="watch-icon">🎬</div>
                        <div class="watch-label">Netflix</div>
                    </a>
                    <a href="${watchOptions.prime}" target="_blank" rel="noopener" class="watch-option-card" data-service="prime">
                        <div class="watch-icon">📦</div>
                        <div class="watch-label">Prime Video</div>
                    </a>
                    <a href="${watchOptions.hulu}" target="_blank" rel="noopener" class="watch-option-card" data-service="hulu">
                        <div class="watch-icon">📺</div>
                        <div class="watch-label">Hulu</div>
                    </a>
                    <a href="${watchOptions.disney}" target="_blank" rel="noopener" class="watch-option-card" data-service="disney">
                        <div class="watch-icon">🏰</div>
                        <div class="watch-label">Disney+</div>
                    </a>
                    <a href="${watchOptions.hbo}" target="_blank" rel="noopener" class="watch-option-card" data-service="hbo">
                        <div class="watch-icon">🎭</div>
                        <div class="watch-label">HBO Max</div>
                    </a>
                    <a href="${watchOptions.apple}" target="_blank" rel="noopener" class="watch-option-card" data-service="apple">
                        <div class="watch-icon">🍎</div>
                        <div class="watch-label">Apple TV+</div>
                    </a>
                    <a href="${watchOptions.youtube}" target="_blank" rel="noopener" class="watch-option-card" data-service="youtube">
                        <div class="watch-icon">▶️</div>
                        <div class="watch-label">YouTube</div>
                    </a>
                    <a href="${watchOptions.google}" target="_blank" rel="noopener" class="watch-option-card" data-service="google">
                        <div class="watch-icon">🔍</div>
                        <div class="watch-label">Search Online</div>
                    </a>
                </div>
                <p class="watch-note">💡 Click on any service to search for this movie</p>
            </div>
        `;
    }
    
    document.getElementById('modalBody').innerHTML = `
        <div class="movie-details">
            <div class="movie-header">
                <img src="${posterPath}" alt="${movie.title}" class="movie-poster-large">
                <div class="movie-header-info">
                    <h2 class="movie-title-large">${movie.title}</h2>
                    <div class="movie-details-meta">
                        <span class="meta-item">📅 ${year}</span>
                        <span class="meta-item">⏱️ ${runtime}</span>
                        <span class="meta-item">⭐ ${rating}</span>
                    </div>
                    <div class="movie-genres">${genres}</div>
                    <p class="movie-overview">${movie.plot}</p>
                    <ul class="movie-facts">
                        <li><strong>Director:</strong> ${movie.director}</li>
                        <li><strong>Writer:</strong> ${movie.writer}</li>
                        <li><strong>Cast:</strong> ${actors}</li>
                        <li><strong>Language:</strong> ${movie.language}</li>
                        <li><strong>Country:</strong> ${movie.country}</li>
                        <li><strong>Awards:</strong> ${movie.awards}</li>
                        <li><strong>Box Office:</strong> ${movie.boxOffice}</li>
                        ${movie.website ? `<li><strong>Website:</strong> <a href="${movie.website}" target="_blank" rel="noopener">Visit Official Site</a></li>` : ''}
                    </ul>
                    <div class="movie-actions">
                        <div style="position: relative; display: inline-block;">
                            <button class="modal-add-to-list-btn" onclick="toggleModalListDropdown('${movie.id}', event)">
                                ${isInList ? '✓ In Your List' : '+ Add to List'}
                            </button>
                            <div class="list-dropdown" id="modal-dropdown-${movie.id}">
                                <button class="${currentListType === 'watched' ? 'active' : ''}" onclick="addToListFromModal('${movie.id}', 'watched')">Watched</button>
                                <button class="${currentListType === 'watching' ? 'active' : ''}" onclick="addToListFromModal('${movie.id}', 'watching')">Currently Watching</button>
                                <button class="${currentListType === 'planned' ? 'active' : ''}" onclick="addToListFromModal('${movie.id}', 'planned')">Plan to Watch</button>
                                <button class="${currentListType === 'onhold' ? 'active' : ''}" onclick="addToListFromModal('${movie.id}', 'onhold')">On Hold</button>
                                <button class="${currentListType === 'dropped' ? 'active' : ''}" onclick="addToListFromModal('${movie.id}', 'dropped')">Dropped</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            ${trailerSection}
            ${watchSection}
        </div>
    `;
}

// Get current list type for a movie
function getCurrentListType(movieId) {
    for (let listType in userMovieLists) {
        if (userMovieLists[listType].some(m => m.id === movieId || m.imdbId === movieId)) {
            return listType;
        }
    }
    return null;
}

// Toggle Modal List Dropdown
function toggleModalListDropdown(movieId, event) {
    event.stopPropagation();
    const dropdown = document.getElementById(`modal-dropdown-${movieId}`);
    dropdown.classList.toggle('active');
    
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 0);
}

// Add to List from Modal
async function addToListFromModal(movieId, listType) {
    try {
        // Fetch movie data if not already available
        const cacheKey = `movie_${movieId}`;
        let movie;
        
        if (apiCache.has(cacheKey)) {
            movie = apiCache.get(cacheKey).data;
        } else {
            const card = document.querySelector(`.movie-card[data-movie-id="${movieId}"]`);
            const title = card?.dataset.movieTitle || '';
            movie = await fetchMovieByTitle(title);
        }
        
        await saveMovieToListOnServer(movie, listType);
        
        // Update button text
        const modalBtn = document.querySelector('.modal-add-to-list-btn');
        if (modalBtn) {
            modalBtn.textContent = '✓ In Your List';
        }
        
        // Update dropdown active states
        const dropdown = document.getElementById(`modal-dropdown-${movieId}`);
        if (dropdown) {
            dropdown.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            dropdown.querySelector(`button[onclick*="'${listType}'"]`).classList.add('active');
            dropdown.classList.remove('active');
        }
        
        // Update home page button if exists
        const homeBtn = document.querySelector(`.movie-card[data-movie-id="${movieId}"] .add-to-list-btn`);
        if (homeBtn) {
            homeBtn.classList.add('added');
            homeBtn.textContent = '✓';
        }
        
    } catch (error) {
        console.error('Error adding to list from modal:', error);
    }
}

// Close Modal
function closeModal() {
    movieModal.classList.remove('active');
    document.getElementById('modalBody').innerHTML = '';
}

// Show/Hide Loading
function showLoading() {
    loading.classList.add('active');
}

function hideLoading() {
    loading.classList.remove('active');
}

// Update List Counts
function updateListCounts() {
    const totalCount = Object.values(userMovieLists).reduce((sum, list) => sum + list.length, 0);
    document.getElementById('countAll').textContent = totalCount;
    document.getElementById('countWatched').textContent = userMovieLists.watched.length;
    document.getElementById('countWatching').textContent = userMovieLists.watching.length;
    document.getElementById('countPlanned').textContent = userMovieLists.planned.length;
    document.getElementById('countOnhold').textContent = userMovieLists.onhold.length;
    document.getElementById('countDropped').textContent = userMovieLists.dropped.length;
}

// Render My List
function renderMyList(filter = 'all') {
    let moviesToShow = [];
    
    if (filter === 'all') {
        moviesToShow = LIST_TYPES.flatMap(type => 
            (userMovieLists[type] || []).map(movie => ({ ...movie, listType: type }))
        );
    } else {
        moviesToShow = (userMovieLists[filter] || []).map(movie => ({ ...movie, listType: filter }));
    }
    
    if (moviesToShow.length === 0) {
        myListGrid.innerHTML = '<p class="empty-message">No movies in this category yet!</p>';
        return;
    }
    
    myListGrid.innerHTML = moviesToShow.map(movie => {
        const posterSource = movie.poster || movie.poster_path || '';
        const posterPath = posterSource && posterSource.startsWith('http')
            ? posterSource
            : posterSource
            ? `${posterSource}`
            : POSTER_PLACEHOLDER;
        
        const ratingValue = typeof movie.vote_average === 'number'
            ? movie.vote_average
            : typeof movie.rating === 'number'
                ? movie.rating
                : null;
        const rating = ratingValue ? ratingValue.toFixed(1) : 'N/A';
        const year = movie.year || movie.releaseDate || movie.release_date || 'N/A';
        
        const statusLabels = {
            watched: 'Watched',
            watching: 'Watching',
            planned: 'Planned',
            onhold: 'On Hold',
            dropped: 'Dropped'
        };
        
        return `
            <div class="mylist-movie-card" onclick="showMovieDetails('${movie.id || movie.imdbId}')">
                <span class="list-status-badge">${statusLabels[movie.listType]}</span>
                <button class="remove-from-list-btn" onclick="event.stopPropagation(); removeFromList('${movie.id || movie.imdbId}')">×</button>
                <img src="${posterPath || POSTER_PLACEHOLDER}" alt="${movie.title}" class="movie-poster" loading="lazy" onload="this.classList.add('loaded')" onerror="this.src='${POSTER_PLACEHOLDER}'; this.classList.add('loaded');">
                <div class="movie-info">
                    <div class="movie-title">${movie.title}</div>
                    <div class="movie-meta">
                        <span>${year}</span>
                        <span class="movie-rating">⭐ ${rating}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Ensure posters in My List get the loaded class if already cached/loaded
    setTimeout(() => lazyLoadImages(), 50);
}

// Dashboard Functions
async function loadDashboard() {
    const dashboardLoading = document.getElementById('dashboardLoading');
    const dashboardContent = document.getElementById('dashboardContent');
    const dashboardError = document.getElementById('dashboardError');
    
    dashboardLoading.style.display = 'block';
    dashboardContent.style.display = 'none';
    dashboardError.style.display = 'none';
    
    try {
        const response = await fetch('/api/stats', { credentials: 'include' });
        if (!response.ok) {
            throw new Error('Failed to load statistics');
        }
        
        const stats = await response.json();
        renderDashboard(stats);
        
        dashboardLoading.style.display = 'none';
        dashboardContent.style.display = 'block';
    } catch (error) {
        console.error('Error loading dashboard:', error);
        dashboardLoading.style.display = 'none';
        dashboardError.style.display = 'block';
    }
}

function renderDashboard(stats) {
    const { overview, distributions, topStats } = stats;
    
    // Update overview cards
    document.getElementById('statTotalMovies').textContent = overview.totalMovies;
    document.getElementById('statWatched').textContent = overview.watchedCount;
    document.getElementById('statWatchTime').textContent = Math.round(overview.totalWatchTime / 60);
    
    // Update breakdown
    document.getElementById('breakdownWatching').textContent = overview.watchingCount;
    document.getElementById('breakdownPlanned').textContent = overview.plannedCount;
    document.getElementById('breakdownOnhold').textContent = overview.onholdCount;
    document.getElementById('breakdownDropped').textContent = overview.droppedCount;
    
    // Render charts
    renderListChart(distributions.listDistribution);
    // Year/Decade charts removed per request
    
    // Top Years removed per request
}

function renderListChart(data) {
    const container = document.getElementById('listChart');
    const labels = {
        watched: 'Watched',
        watching: 'Watching',
        planned: 'Planned',
        onhold: 'On Hold',
        dropped: 'Dropped'
    };
    
    const maxValue = Math.max(...Object.values(data));
    const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b'];
    let colorIndex = 0;
    
    container.innerHTML = '<div class="bar-chart"></div>';
    const chart = container.querySelector('.bar-chart');
    
    Object.entries(data).forEach(([key, value]) => {
        const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const color = colors[colorIndex % colors.length];
        colorIndex++;
        
        const item = document.createElement('div');
        item.className = 'bar-item';
        item.innerHTML = `
            <span class="bar-label">${labels[key]}</span>
            <div class="bar-wrapper">
                <div class="bar-fill" style="width: ${percentage}%; background: ${color};">
                    ${value}
                </div>
            </div>
        `;
        chart.appendChild(item);
    });
}

// Rating chart removed

// Year/Decade/Top Years charts removed per request

// Make functions globally accessible
window.showMovieDetails = showMovieDetails;
window.toggleListDropdown = toggleListDropdown;
window.addToList = addToList;
window.removeFromList = removeFromList;
window.toggleModalListDropdown = toggleModalListDropdown;
window.addToListFromModal = addToListFromModal;

// Add missing UI helpers: loading indicator and image lazy loader
function addLoadingIndicator() {
    // Avoid duplicate indicator
    if (document.getElementById('loadingIndicator')) return;

    const indicator = document.createElement('div');
    indicator.id = 'loadingIndicator';
    indicator.className = 'loading-indicator';
    indicator.innerHTML = `
        <div class="loading-spinner" aria-hidden="true"></div>
        <div class="loading-text">Loading more movies...</div>
    `;

    // Basic inline styles if the page CSS doesn't provide them
    indicator.style.gridColumn = '1 / -1';
    indicator.style.display = 'flex';
    indicator.style.justifyContent = 'center';
    indicator.style.alignItems = 'center';
    indicator.style.padding = '1rem';
    indicator.style.color = '#888';

    moviesGrid.appendChild(indicator);
}

function removeLoadingIndicator() {
    const el = document.getElementById('loadingIndicator');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function lazyLoadImages() {
    const images = Array.from(document.querySelectorAll('img[data-src]'));
    if (images.length === 0) return;

    // Helper to set src and cleanup
    const loadImage = (img) => {
        const src = img.getAttribute('data-src');
        if (!src) return;
        img.src = src;
        img.removeAttribute('data-src');
        img.addEventListener('load', () => {
            const skeleton = img.closest('.poster-wrapper')?.querySelector('.poster-skeleton');
            if (skeleton) skeleton.style.display = 'none';
            img.classList.add('loaded');
        });
        img.addEventListener('error', () => {
            img.src = POSTER_PLACEHOLDER;
            const skeleton = img.closest('.poster-wrapper')?.querySelector('.poster-skeleton');
            if (skeleton) skeleton.style.display = 'none';
        });
    };

    if ('IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    loadImage(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '200px 0px', threshold: 0.01 });

        images.forEach(img => obs.observe(img));
    } else {
        // Fallback: load all immediately
        images.forEach(img => loadImage(img));
    }
}




