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

