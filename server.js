const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const url = require('url');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessions = new Map();

// Helper to rewrite URLs in the fetched content
function rewriteUrls(html, baseUrl) {
    const $ = cheerio.load(html);
    
    $('head').prepend('<script src="/ws-polyfill.js"></script>');

    // We only need to rewrite ABSOLUTE URLs now.
    // Relative URLs will naturally resolve against the current path (/service/https://site.com/...)
    
    const processUrl = (link) => {
        if (!link) return link;
        if (link.startsWith('http://') || link.startsWith('https://')) {
            // Rewrite absolute URLs to go through /service/
            // We remove the protocol's double slash to avoid path issues, or just handle it in the route
            // Let's keep it simple: /service/https://site.com
            return `/service/${link}`;
        }
        // Leave relative URLs alone!
        return link;
    };

    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            $(el).attr('href', processUrl(href));
        }
    });

    $('img, script, link, iframe').each((i, el) => {
        const src = $(el).attr('src');
        const href = $(el).attr('href');
        
        if (src) {
            // Don't rewrite the polyfill
            if (src.includes('/ws-polyfill.js')) return;
            $(el).attr('src', processUrl(src));
        }
        if (href && $(el).is('link')) {
            $(el).attr('href', processUrl(href));
        }
    });

    $('form').each((i, el) => {
        const action = $(el).attr('action');
        if (action) {
            $(el).attr('action', processUrl(action));
        }
    });

    return $.html();
}

// Path-based Proxy Handler
// Matches /service/https://google.com/foo/bar
app.use('/service/*', async (req, res) => {
    // Reconstruct the target URL from the request path
    // req.baseUrl is '/service'
    // req.path is '/https://google.com/foo/bar' (Note: express might strip slashes)
    
    // We need the full original URL after /service/
    // req.originalUrl is '/service/https://google.com/foo/bar?q=123'
    
    let targetPath = req.originalUrl.substring('/service/'.length);
    
    // Handle the case where browsers/proxies merge slashes (e.g. https:/google.com)
    if (targetPath.startsWith('http:/') && !targetPath.startsWith('http://')) {
        targetPath = targetPath.replace('http:/', 'http://');
    } else if (targetPath.startsWith('https:/') && !targetPath.startsWith('https://')) {
        targetPath = targetPath.replace('https:/', 'https://');
    }

    // If it doesn't have a protocol, it might be a relative request that got messed up
    // But with this structure, relative requests should append correctly.
    
    // Basic validation
    if (!targetPath.startsWith('http')) {
        return res.status(400).send('Invalid URL protocol');
    }

    // Block the specific domain
    if (targetPath.includes('chromebook.ccpsnet.net')) {
        return res.status(403).send('Blocked domain');
    }

    try {
        const response = await axios.get(targetPath, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // Forward cookies if needed (omitted for simplicity, but crucial for sessions)
            },
            responseType: 'arraybuffer',
            validateStatus: () => true // Accept all status codes
        });

        // Forward headers
        const contentType = response.headers['content-type'];
        if (contentType) res.set('Content-Type', contentType);
        
        // Handle redirects manually to keep them in the proxy
        // (Axios follows redirects by default, but if we get a 3xx, we might want to rewrite it)
        // Since axios follows them, response.request.res.responseUrl is the final URL.
        // But if we want to support relative redirects, we rely on the browser.
        
        if (contentType && contentType.includes('text/html')) {
            const html = response.data.toString('utf-8');
            // We pass the targetPath as the base, but actually we don't need it for relative link preservation
            // We only need it if we were resolving relative links to absolute (which we aren't anymore)
            const rewrittenHtml = rewriteUrls(html, targetPath);
            res.send(rewrittenHtml);
        } else {
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy error:', error.message, targetPath);
        // If it's a 404 from the target, forward it
        if (error.response) {
             res.status(error.response.status).send(error.response.data);
        } else {
             res.status(500).send(`Error fetching URL: ${error.message}`);
        }
    }
});


// --- WebSocket Tunneling via SSE ---

app.get('/api/ws-connect', (req, res) => {
    const targetUrl = req.query.target;
    const sessionId = req.query.session;

    if (!targetUrl || !sessionId) {
        return res.status(400).send('Missing target or session');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendToClient = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    let wsUrl = targetUrl;
    if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');
    if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');

    console.log(`[Proxy] Opening WS to ${wsUrl} for session ${sessionId}`);

    try {
        const ws = new WebSocket(wsUrl);
        sessions.set(sessionId, { ws, res });

        ws.on('open', () => sendToClient('open'));
        ws.on('message', (data) => sendToClient('message', data.toString()));
        ws.on('error', (err) => sendToClient('error', err.message));
        ws.on('close', (code, reason) => {
            sendToClient('close', { code, reason: reason.toString() });
            sessions.delete(sessionId);
            res.end();
        });

        req.on('close', () => {
            if (ws.readyState === WebSocket.OPEN) ws.close();
            sessions.delete(sessionId);
        });

    } catch (e) {
        console.error('[Proxy] WS Connection Failed:', e);
        res.status(500).end();
    }
});

app.post('/api/ws-send', (req, res) => {
    const { session, data } = req.body;
    const sessionData = sessions.get(session);

    if (sessionData && sessionData.ws && sessionData.ws.readyState === WebSocket.OPEN) {
        sessionData.ws.send(data);
        res.status(200).send('Sent');
    } else {
        res.status(400).send('WebSocket not open');
    }
});

app.post('/api/ws-close', (req, res) => {
    const { session } = req.body;
    const sessionData = sessions.get(session);
    if (sessionData && sessionData.ws) {
        sessionData.ws.close();
        sessions.delete(session);
    }
    res.status(200).send('Closed');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
