const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Middleware to block chromebook.ccpsnet.net
app.use((req, res, next) => {
    const blockedDomain = 'chromebook.ccpsnet.net';
    
    // Check Referer
    const referer = req.get('Referer');
    if (referer && referer.includes(blockedDomain)) {
        return res.status(403).send('Access denied from ' + blockedDomain);
    }

    // Check Origin
    const origin = req.get('Origin');
    if (origin && origin.includes(blockedDomain)) {
        return res.status(403).send('Access denied from ' + blockedDomain);
    }

    // Check if the user is trying to proxy to the blocked domain
    const queryUrl = req.query.url;
    if (queryUrl && queryUrl.includes(blockedDomain)) {
        return res.status(403).send('Access to ' + blockedDomain + ' is blocked.');
    }

    next();
});

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer', // Handle images/binary
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const contentType = response.headers['content-type'];
        res.set('Content-Type', contentType);

        // If it's HTML, inject <base> tag to fix relative links
        if (contentType && contentType.includes('text/html')) {
            let html = response.data.toString('utf-8');
            // Simple injection after <head>
            const baseTag = `<base href="${targetUrl}">`;
            const scriptInjection = `
            <script>
            document.addEventListener('click', function(e) {
                const target = e.target.closest('a');
                if (target && target.href) {
                    e.preventDefault();
                    const realUrl = target.href;
                    window.location.href = 'http://localhost:3000/proxy?url=' + encodeURIComponent(realUrl);
                }
            });
            </script>
            `;
            
            if (html.includes('<head>')) {
                html = html.replace('<head>', `<head>${baseTag}`);
            } else {
                html = baseTag + html;
            }

            if (html.includes('</body>')) {
                html = html.replace('</body>', `${scriptInjection}</body>`);
            } else {
                html += scriptInjection;
            }

            res.send(html);
        } else {
            // For non-HTML (images, css, etc), send as is
            res.send(response.data);
        }
    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send('Error fetching URL: ' + error.message);
    }
});

// SSE Endpoint (Only if needed, as requested)
// This is a placeholder to show how SSE would be implemented if the user needs it for status updates
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ message: 'Connected to SSE server' });

    // Keep connection alive
    const interval = setInterval(() => {
        sendEvent({ message: 'Heartbeat', timestamp: new Date() });
    }, 10000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
