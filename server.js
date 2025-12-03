const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const url = require('url');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // For parsing JSON bodies in POST requests

// Store active WebSocket sessions
// Map<sessionId, { ws: WebSocket, res: Response (SSE) }>
const sessions = new Map();

// Helper to validate URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Helper to rewrite URLs in the fetched content
function rewriteUrls(html, baseUrl) {
    const $ = cheerio.load(html);
    
    // Inject WS Polyfill at the top of <head>
    $('head').prepend('<script src="/ws-polyfill.js"></script>');

    // Rewrite hrefs
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            } catch (e) {
                // Ignore invalid URLs
            }
        }
    });

    // Rewrite srcs (images, scripts, etc.)
    $('img, script, link, iframe').each((i, el) => {
        const src = $(el).attr('src');
        const href = $(el).attr('href'); // for link tags
        
        if (src) {
            try {
                const absoluteUrl = new URL(src, baseUrl).href;
                // Don't rewrite the polyfill script we just added
                if (absoluteUrl.includes('/ws-polyfill.js')) return;
                
                $(el).attr('src', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            } catch (e) {}
        }
        
        if (href && $(el).is('link')) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            } catch (e) {}
        }
    });

    // Rewrite form actions
    $('form').each((i, el) => {
        const action = $(el).attr('action');
        if (action) {
            try {
                const absoluteUrl = new URL(action, baseUrl).href;
                $(el).attr('action', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            } catch (e) {}
        }
    });

    return $.html();
}

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    // If it doesn't start with http, and looks like a search query, search google
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
            targetUrl = 'https://' + targetUrl;
        } else {
            targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
        }
    }

    // Block the specific domain mentioned by the user
    if (targetUrl.includes('chromebook.ccpsnet.net')) {
        return res.status(403).send('Blocked domain');
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                // Updated User-Agent to a newer Chrome version
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            responseType: 'arraybuffer' // Handle binary data like images
        });

        const contentType = response.headers['content-type'];

        // If it's HTML, rewrite links
        if (contentType && contentType.includes('text/html')) {
            const html = response.data.toString('utf-8');
            const rewrittenHtml = rewriteUrls(html, targetUrl);
            res.set('Content-Type', 'text/html');
            res.send(rewrittenHtml);
        } else {
            // Forward other content types directly
            res.set('Content-Type', contentType);
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send(`Error fetching URL: ${error.message}`);
    }
});

// --- WebSocket Tunneling via SSE ---

// 1. Downstream: Client connects via SSE
app.get('/proxy/ws-connect', (req, res) => {
    const targetUrl = req.query.target;
    const sessionId = req.query.session;

    if (!targetUrl || !sessionId) {
        return res.status(400).send('Missing target or session');
    }

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendToClient = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    // Connect to the REAL WebSocket target
    // We need to convert http/https to ws/wss
    let wsUrl = targetUrl;
    if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');
    if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');

    console.log(`[Proxy] Opening WS to ${wsUrl} for session ${sessionId}`);

    try {
        const ws = new WebSocket(wsUrl);

        sessions.set(sessionId, { ws, res });

        ws.on('open', () => {
            sendToClient('open');
        });

        ws.on('message', (data) => {
            // Convert buffer to string if needed, or send as base64 if binary
            // For simplicity, assuming text for now
            sendToClient('message', data.toString());
        });

        ws.on('error', (err) => {
            console.error(`[Proxy] WS Error for ${sessionId}:`, err.message);
            sendToClient('error', err.message);
        });

        ws.on('close', (code, reason) => {
            sendToClient('close', { code, reason: reason.toString() });
            sessions.delete(sessionId);
            res.end();
        });

        // Clean up if client disconnects SSE
        req.on('close', () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            sessions.delete(sessionId);
        });

    } catch (e) {
        console.error('[Proxy] WS Connection Failed:', e);
        res.status(500).end();
    }
});

// 2. Upstream: Client sends data via POST
app.post('/proxy/ws-send', (req, res) => {
    const { session, data } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.ws) {
        return res.status(404).send('Session not found');
    }

    if (sessionData.ws.readyState === WebSocket.OPEN) {
        sessionData.ws.send(data);
        res.status(200).send('Sent');
    } else {
        res.status(400).send('WebSocket not open');
    }
});

// 3. Close: Client requests close
app.post('/proxy/ws-close', (req, res) => {
    const { session } = req.body;
    const sessionData = sessions.get(session);

    if (sessionData && sessionData.ws) {
        sessionData.ws.close();
        sessions.delete(session);
    }
    res.status(200).send('Closed');
});

// Original SSE Endpoint (kept for the status page)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ message: 'Connected to proxy server' });

    const interval = setInterval(() => {
        sendEvent({ timestamp: new Date().toISOString() });
    }, 10000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
