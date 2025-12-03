const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Helper to parse cookies
const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
};

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
        // Extract base URL for the cookie
        const urlObj = new URL(targetUrl);
        const baseUrl = urlObj.origin;

        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': baseUrl
            }
        });

        const contentType = response.headers['content-type'];
        res.set('Content-Type', contentType);
        
        // Set cookie for subsequent resource requests
        // Added SameSite=None; Secure to allow cross-site usage in iframe
        res.setHeader('Set-Cookie', `proxy_base=${encodeURIComponent(baseUrl)}; Path=/; HttpOnly; SameSite=None; Secure`);

        // If it's HTML, inject script to handle links
        if (contentType && contentType.includes('text/html')) {
            let html = response.data.toString('utf-8');
            
            // Rewrite absolute src attributes to go through proxy (helps with CDNs)
            html = html.replace(/src="(https?:\/\/[^"]+)"/g, (match, url) => `src="/proxy?url=${encodeURIComponent(url)}"`);
            
            const scriptInjection = `
            <script>
            document.addEventListener('click', function(e) {
                const target = e.target.closest('a');
                if (target && target.href) {
                    const href = target.href;
                    // If it's already pointing to our proxy (relative link resolved), don't double wrap
                    if (href.startsWith(window.location.origin)) {
                        return; 
                    }
                    e.preventDefault();
                    window.location.href = window.location.origin + '/proxy?url=' + encodeURIComponent(href);
                }
            });
            // Override form submissions too
            document.addEventListener('submit', function(e) {
                const target = e.target;
                if (target.action) {
                    const action = target.action;
                    if (action.startsWith(window.location.origin)) {
                        return;
                    }
                    e.preventDefault();
                    window.location.href = window.location.origin + '/proxy?url=' + encodeURIComponent(action);
                }
            });
            </script>
            `;

            if (html.includes('</body>')) {
                html = html.replace('</body>', `${scriptInjection}</body>`);
            } else {
                html += scriptInjection;
            }

            res.send(html);
        } else {
            res.send(response.data);
        }
    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send('Error fetching URL: ' + error.message);
    }
});

// SSE Endpoint
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ message: 'Connected to SSE server' });

    const interval = setInterval(() => {
        sendEvent({ message: 'Heartbeat', timestamp: new Date() });
    }, 10000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

// Wildcard handler for resources (images, css, js)
app.get('*', async (req, res) => {
    const cookies = parseCookies(req);
    const proxyBase = cookies.proxy_base ? decodeURIComponent(cookies.proxy_base) : null;

    if (!proxyBase) {
        return res.status(404).send('Resource not found and no proxy session active.');
    }

    const targetUrl = proxyBase + req.url;

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': proxyBase
            }
        });

        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);
    } catch (error) {
        // console.error('Resource proxy error:', error.message);
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
