const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- CONFIG ---
const BLOCKED_HOST = 'chromebook.ccpsnet.net';
const PROXY_BASE = '/p';

// --- MIDDLEWARE ---

// 1. Block the specific domain
app.use((req, res, next) => {
    if (req.url.includes(BLOCKED_HOST)) {
        return res.status(403).send('Blocked');
    }
    const referer = req.get('Referer');
    if (referer && referer.includes(BLOCKED_HOST)) {
        return res.status(403).send('Blocked');
    }
    next();
});

// --- PROXY LOGIC ---

// Helper to construct the target URL from the proxy path
// Path: /p/https/example.com/foo/bar
function getTargetUrl(path) {
    // Remove /p/
    const parts = path.substring(PROXY_BASE.length + 1).split('/');
    // parts[0] = protocol (https)
    // parts[1] = host (example.com)
    // parts[2...] = path
    if (parts.length < 2) return null;
    
    const protocol = parts[0];
    const host = parts[1];
    const rest = parts.slice(2).join('/');
    
    return `${protocol}://${host}/${rest}`;
}

// Main Proxy Handler
app.use(PROXY_BASE + '/:protocol/:host/*', async (req, res) => {
    const originalUrl = req.originalUrl; // /p/https/example.com/foo?query=1
    const targetUrl = getTargetUrl(originalUrl.split('?')[0]) + (originalUrl.includes('?') ? '?' + originalUrl.split('?')[1] : '');

    if (!targetUrl) return res.status(400).send('Invalid URL');

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // We fake the referer to be the target site
                'Referer': new URL(targetUrl).origin
            },
            validateStatus: () => true // Don't throw on 404/500
        });

        // Copy headers
        Object.keys(response.headers).forEach(key => {
            // Skip problematic headers
            if (['content-length', 'content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) return;
            res.setHeader(key, response.headers[key]);
        });

        // Remove blocking headers
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Content-Type-Options');

        // Send data
        res.status(response.status);
        res.send(response.data);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send('Proxy Error');
    }
});

// Catch-All Handler for "Escaped" Relative Links
// If a page at /p/https/site.com/ requests /style.css, it comes here.
app.use((req, res, next) => {
    if (req.url === '/' || req.url === '/events') return next();

    const referer = req.get('Referer');
    if (referer && referer.includes(PROXY_BASE)) {
        // Try to extract the base from the referer
        // Referer: http://localhost:3000/p/https/example.com/foo
        const match = referer.match(/\/p\/(https?)\/([^\/]+)/);
        if (match) {
            const protocol = match[1];
            const host = match[2];
            // Redirect to the correct proxy path
            return res.redirect(`${PROXY_BASE}/${protocol}/${host}${req.url}`);
        }
    }
    
    res.status(404).send('Not Found');
});

// --- SSE ENDPOINT (Requested) ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('data: connected\n\n');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
