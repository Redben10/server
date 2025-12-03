const express = require('express');
const Unblocker = require('unblocker');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Unblocker
const unblocker = new Unblocker({
    prefix: '/proxy/',
    responseMiddleware: [
        // Custom middleware to block specific domains if they are requested
        (data) => {
            if (data.url.includes('chromebook.ccpsnet.net')) {
                data.clientResponse.status(403).send('Blocked by Proxy');
                return true; // handled
            }
        }
    ]
});

// Use Unblocker middleware
// It handles the proxying of requests to /proxy/
app.use(unblocker);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.redirect('/');
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    res.redirect(`/proxy/${searchUrl}`);
});

// SSE Endpoint (as requested, though not strictly needed for basic proxy)
app.get('/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = () => {
        res.write(`data: ${JSON.stringify({ status: 'Proxy Active', time: new Date().toISOString() })}\n\n`);
    };

    const interval = setInterval(sendStatus, 5000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
