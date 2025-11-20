// OMDb Proxy Configuration
const OMDB_PROXY_URL = '/api/tmdb';
const AUTH_BASE_URL = '/api/auth';
const USER_STORAGE_KEY = 'flixvault_user';
const LIST_TYPES = ['watched', 'watching', 'planned', 'onhold', 'dropped'];
const POSTER_PLACEHOLDER = 'https://via.placeholder.com/300x450?text=No+Image';

const CATEGORY_TITLE_MAP = {
    trending: ['Oppenheimer', 'Barbie', 'Dune: Part Two', 'Killers of the Flower Moon', 'Poor Things', 'The Marvels'],
    popular: ['The Dark Knight', 'Inception', 'Interstellar', 'Avengers: Endgame', 'Avatar', 'Joker'],
    top_rated: ['The Godfather', 'The Shawshank Redemption', '12 Angry Men', 'Fight Club', 'Pulp Fiction', 'The Green Mile'],
    bollywood: ['Jawan', 'Pathaan', 'RRR', 'Kantara', '3 Idiots', 'Gadar 2'],
    hollywood: ['Mission: Impossible - Dead Reckoning', 'Top Gun: Maverick', 'John Wick: Chapter 4', 'No Time to Die', 'Black Panther', 'Spider-Man: No Way Home']
};

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
    
    if (currentFilters.genre) {
        const normalizedGenre = currentFilters.genre.toLowerCase();
        const movieGenres = (movie.genres || []).map(g => g.name.toLowerCase());
        if (!movieGenres.some(g => g.includes(normalizedGenre))) {
            return false;
        }
    }
    
    if (currentFilters.year) {
        // Extract year from year field or release_date
        let movieYear = movie.year;
        if (!movieYear && movie.release_date) {
            // Try to extract year from release_date (format: "DD MMM YYYY" or "YYYY-MM-DD")
            const dateMatch = movie.release_date.match(/\d{4}/);
            if (dateMatch) {
                movieYear = dateMatch[0];
            }
        }
        if ((movieYear || '').toString() !== currentFilters.year) {
            return false;
        }
    }
    
    if (currentFilters.language) {
        const movieLanguages = (movie.language || '').toLowerCase();
        if (!movieLanguages.includes(currentFilters.language.toLowerCase())) {
            return false;
        }
    }
    
    if (currentFilters.rating) {
        const ratingValue = Number(currentFilters.rating);
        if (!movie.vote_average || movie.vote_average < ratingValue) {
            return false;
        }
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

async function fetchMoviesByTitles(titles = []) {
    const movies = [];
    
    for (const title of titles) {
        try {
            const movie = await fetchMovieByTitle(title);
            movies.push(movie);
        } catch (error) {
            console.warn(`OMDb lookup failed for "${title}":`, error.message);
        }
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
            genre: document.getElementById('genreFilter').value,
            year: document.getElementById('yearFilter').value,
            language: document.getElementById('languageFilter').value,
            rating: document.getElementById('ratingFilter').value
        };
        loadMoviesWithFilters();
    });

    // Reset Filters
    resetFilters.addEventListener('click', () => {
        document.getElementById('genreFilter').value = '';
        document.getElementById('yearFilter').value = '';
        document.getElementById('languageFilter').value = '';
        document.getElementById('ratingFilter').value = '';
        currentFilters = { genre: '', year: '', language: '', rating: '' };
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

// Load Movies by Category
async function loadMoviesByCategory(category) {
    showLoading();
    console.log('📺 Loading category:', category);
    
    try {
        const curatedTitles = CATEGORY_TITLE_MAP[category] || CATEGORY_TITLE_MAP.trending;
        const movies = await fetchMoviesByTitles(curatedTitles);
        currentCategoryMovies = movies; // Store for filtering
        displayMovies(movies);
    } catch (error) {
        console.error('❌ Error loading movies:', error);
        currentCategoryMovies = []; // Clear on error
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
    hideLoading();
}

// Load Movies with Filters
async function loadMoviesWithFilters() {
    showLoading();
    try {
        const query = searchInput.value.trim();
        
        if (query) {
            // If there's a search query, search for that specific movie
            const extraParams = {};
            if (currentFilters.year) extraParams.year = currentFilters.year;
            
            const movie = await fetchMovieByTitle(query, extraParams);
            if (movieMatchesFilters(movie)) {
                displayMovies([movie]);
            } else {
                moviesGrid.innerHTML = `
                    <p style="text-align:center;color:#aaa;grid-column:1/-1;padding:3rem;">
                        "${query}" does not match the selected filters.
                    </p>
                `;
            }
        } else {
            // If no search query, filter the current category's movies
            if (currentCategoryMovies.length === 0) {
                // Load category first if not loaded
                await loadMoviesByCategory(currentCategory);
            }
            
            // Filter the current category movies
            const filteredMovies = currentCategoryMovies.filter(movie => movieMatchesFilters(movie));
            
            if (filteredMovies.length === 0) {
                moviesGrid.innerHTML = `
                    <p style="text-align:center;color:#aaa;grid-column:1/-1;padding:3rem;">
                        No movies found matching the selected filters. Try adjusting your filter criteria.
                    </p>
                `;
            } else {
                displayMovies(filteredMovies);
            }
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
    hideLoading();
}

// Search Movies
async function searchMovies(query) {
    showLoading();
    console.log('🔍 Searching for:', query);
    
    try {
        const movie = await fetchMovieByTitle(query);
        displayMovies([movie]);
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
    hideLoading();
}

// Display Movies with Optimized Rendering
function displayMovies(movies) {
    if (!movies || movies.length === 0) {
        moviesGrid.innerHTML = `
            <p style="text-align:center;color:#ff6b6b;grid-column:1/-1;padding:3rem;">
                Movie not found. Please try again.
            </p>
        `;
        return;
    }

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
                    <img src="${posterPath}" alt="${movie.title}" class="movie-poster" loading="lazy">
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
    
    moviesGrid.innerHTML = cardsHtml;
    
    movies.forEach(movie => {
        const cacheKey = `movie_${movie.id}`;
        apiCache.set(cacheKey, { data: movie, timestamp: Date.now() });
    });
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
        renderMovieDetails(movie);
    } catch (error) {
        console.error('Error fetching movie details:', error);
        document.getElementById('modalBody').innerHTML = '<p style="text-align:center;padding:2rem;">Error loading movie details.</p>';
    }
    hideLoading();
}

// Render Movie Details
function renderMovieDetails(movie) {
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
                <img src="${posterPath}" alt="${movie.title}" class="movie-poster" loading="lazy">
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
}

// Make functions globally accessible
window.showMovieDetails = showMovieDetails;
window.toggleListDropdown = toggleListDropdown;
window.addToList = addToList;
window.removeFromList = removeFromList;
window.toggleModalListDropdown = toggleModalListDropdown;
window.addToListFromModal = addToListFromModal;




