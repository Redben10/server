const express = require('express');
const axios = require('axios');
const cookieSession = require('cookie-session');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for secure cookies on Render/Heroku)
app.set('trust proxy', 1);

app.use(cookieSession({
    name: 'session',
    keys: ['secret-key-1', 'secret-key-2'],
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend app at a specific path to avoid conflict with proxied root
app.use('/_app', express.static(path.join(__dirname, 'public')));

// Helper to check if string is a URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Endpoint to set the target URL
app.post('/_api/set-target', (req, res) => {
    let targetUrl = req.body.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    if (!isValidUrl(targetUrl) && !targetUrl.includes('.') && !targetUrl.startsWith('http')) {
        targetUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
    } else if (!targetUrl.startsWith('http')) {
        targetUrl = 'https://' + targetUrl;
    }

    // Save base origin to session
    try {
        const u = new URL(targetUrl);
        req.session.targetOrigin = u.origin;
        // Redirect to the specific path requested
        // If user typed "google.com/search", we want to go to "/search" on our proxy
        const startPath = u.pathname + u.search;
        if (startPath && startPath !== '/') {
             res.redirect(startPath);
        } else {
             res.redirect('/');
        }
    } catch (e) {
        return res.status(400).send('Invalid URL');
    }
});

// The Proxy Handler
app.use(async (req, res, next) => {
    // Skip internal routes
    if (req.path.startsWith('/_app') || req.path.startsWith('/_api')) {
        return next();
    }

    // If no target is set, redirect to the app
    if (!req.session || !req.session.targetOrigin) {
        return res.redirect('/_app/');
    }

    // BLOCKING LOGIC requested by user
    if (req.url.includes('chromebook.ccpsnet.net') || 
        (req.headers.referer && req.headers.referer.includes('chromebook.ccpsnet.net'))) {
        console.log('Blocked request related to chromebook.ccpsnet.net');
        return res.status(403).send('Blocked by User Request');
    }

    const targetUrl = req.session.targetOrigin + req.url;

    try {
        const options = {
            method: req.method,
            url: targetUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),
                'Referer': req.session.targetOrigin
            },
            data: req.body,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            maxRedirects: 0 
        };

        const response = await axios(options);

        // Forward headers
        Object.keys(response.headers).forEach(key => {
            if (['content-length', 'transfer-encoding', 'content-encoding'].includes(key)) return;
            
            if (key === 'location') {
                const location = response.headers[key];
                try {
                    const locUrl = new URL(location);
                    if (locUrl.origin === req.session.targetOrigin) {
                        res.setHeader(key, locUrl.pathname + locUrl.search);
                    } else {
                        // If redirecting to a new domain, we can't easily handle it in this simple proxy
                        // without updating the session. For now, let's just pass it through.
                        // If the browser follows it, it leaves the proxy.
                        res.setHeader(key, location);
                    }
                } catch (e) {
                    res.setHeader(key, location);
                }
            } else if (key === 'set-cookie') {
                const cookies = response.headers[key].map(c => {
                    return c.replace(/Domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '').replace(/SameSite=[^;]+;?/gi, '');
                });
                res.setHeader(key, cookies);
            } else {
                res.setHeader(key, response.headers[key]);
            }
        });

        res.status(response.status).send(response.data);

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send(`Proxy Error: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
