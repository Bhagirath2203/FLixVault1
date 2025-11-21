const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const OMDB_KEY = process.env.OMDB_KEY;
const authRouter = require('./authRoute');
const listRouter = require('./listRoute');
const statsRouter = require('./statsRoute');
const connectDB = require('./db');
// Enable CORS for all routes (with credentials for auth cookies)
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use(cookieParser());

// Parse JSON bodies
app.use(express.json());

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.use('/api/auth', authRouter);
app.use('/api/lists', listRouter);
app.use('/api/stats', statsRouter);
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'FlixVault server is running!' });
});

const fetchOmdbData = async ({ title, year, plot = 'full', type, imdb }) => {
    if (!OMDB_KEY) {
        throw new Error('OMDB_KEY missing in environment configuration');
    }

    if (!title && !imdb) {
        const error = new Error('A movie "title" or "imdb" id is required');
        error.statusCode = 400;
        throw error;
    }

    const params = new URLSearchParams({
        apikey: OMDB_KEY,
        plot,
        r: 'json'
    });

    if (title) params.append('t', title);
    if (imdb) params.append('i', imdb);
    if (year) params.append('y', year);
    if (type) params.append('type', type);

    const response = await fetch(`${OMDB_BASE_URL}?${params.toString()}`);
    const data = await response.json();

    if (data.Response === 'False') {
        const error = new Error(data.Error || 'Failed to retrieve movie information');
        error.statusCode = data.Error === 'Movie not found!' ? 404 : 400;
        throw error;
    }

    return data;
};

const proxyOmdbRequest = async (payload, res) => {
    try {
        const data = await fetchOmdbData(payload);
        res.json(data);
    } catch (error) {
        console.error('OMDb proxy error:', error.message);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to fetch from OMDb'
        });
    }
};

// OMDb proxy endpoint (supports GET query params)
app.get('/api/tmdb', async (req, res) => {
    proxyOmdbRequest(req.query || {}, res);
});

// OMDb proxy endpoint (supports POST body from frontend)
app.post('/api/tmdb', async (req, res) => {
    proxyOmdbRequest(req.body || {}, res);
});

// YouTube Trailer Search Endpoint
app.get('/api/trailer', async (req, res) => {
    try {
        const { title, year } = req.query;
        if (!title) {
            return res.status(400).json({ error: 'Movie title is required' });
        }

        // Search YouTube for movie trailer
        const searchQuery = `${title} ${year || ''} official trailer`.trim();
        const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
        
        // For now, we'll return a search URL that can be used
        // In production, you'd use YouTube Data API v3 with an API key
        // For client-side, we'll use YouTube's embed API
        res.json({
            searchQuery,
            searchUrl: youtubeSearchUrl,
            // YouTube embed URL pattern: https://www.youtube.com/embed/VIDEO_ID
            // We'll let the frontend handle the actual search
        });
    } catch (error) {
        console.error('Trailer search error:', error);
        res.status(500).json({ error: 'Failed to search for trailer' });
    }
});

// Where to Watch Endpoint (using JustWatch API or similar)
app.get('/api/watch', async (req, res) => {
    try {
        const { title, year, imdbId } = req.query;
        if (!title && !imdbId) {
            return res.status(400).json({ error: 'Movie title or IMDb ID is required' });
        }

        // For now, we'll return links to common streaming services
        // In production, you'd integrate with JustWatch API or similar service
        const searchQuery = title || '';
        const watchOptions = {
            netflix: `https://www.netflix.com/search?q=${encodeURIComponent(searchQuery)}`,
            prime: `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}&i=prime-instant-video`,
            hulu: `https://www.hulu.com/search?q=${encodeURIComponent(searchQuery)}`,
            disney: `https://www.disneyplus.com/search?q=${encodeURIComponent(searchQuery)}`,
            hbo: `https://www.hbomax.com/search?q=${encodeURIComponent(searchQuery)}`,
            apple: `https://tv.apple.com/search?term=${encodeURIComponent(searchQuery)}`,
            youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery + ' movie')}`,
            google: `https://www.google.com/search?q=${encodeURIComponent(searchQuery + ' watch online')}`
        };

        res.json({
            title: searchQuery,
            watchOptions,
            // Note: For production, integrate with JustWatch API for accurate availability
            message: 'Click on any service to search for this movie'
        });
    } catch (error) {
        console.error('Watch options error:', error);
        res.status(500).json({ error: 'Failed to get watch options' });
    }
});

// Start server
app.listen(PORT, () => {
    connectDB();
    console.log('   🎬 FlixVault Server Running!');
    console.log(`\n📍 Server: http://localhost:${PORT}`);
    console.log(`   http://localhost:${PORT}`);
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

