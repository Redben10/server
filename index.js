const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.set('trust proxy', 1); // Trust first proxy (Render)
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

// Entry point: /proxy?url=...
app.get('/proxy', (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
    
    try {
        const urlObj = new URL(targetUrl);
        const protocol = urlObj.protocol.replace(':', '');
        const host = urlObj.host;
        const path = urlObj.pathname + urlObj.search;
        res.redirect(`/browse/${protocol}/${host}${path}`);
    } catch (e) {
        res.status(400).send('Invalid URL');
    }
});

// Path-based proxy handler
app.use('/browse/:protocol/:host/*', async (req, res) => {
    const protocol = req.params.protocol;
    const host = req.params.host;
    const path = req.params[0]; // The wildcard match
    
    const targetUrl = `${protocol}://${host}/${path}`;
    
    if (targetUrl.includes('chromebook.ccpsnet.net')) {
        return res.status(403).send('Blocked');
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': `${protocol}://${host}/`
            },
            validateStatus: () => true 
        });

        // Remove restrictive headers that break iframes
        delete response.headers['x-frame-options'];
        delete response.headers['content-security-policy'];
        delete response.headers['content-security-policy-report-only'];
        delete response.headers['x-content-type-options'];

        // Forward headers (excluding the ones we deleted)
        Object.keys(response.headers).forEach(key => {
            res.setHeader(key, response.headers[key]);
        });

        // Set permissive Referrer-Policy to help the wildcard handler
        res.setHeader('Referrer-Policy', 'unsafe-url');

        const contentType = response.headers['content-type'];
        // res.set('Content-Type', contentType); // Already set in loop above
        res.status(response.status);

        if (contentType && contentType.includes('text/html')) {
            let html = response.data.toString('utf-8');
            
            // Replace target="_top" and target="_blank" to keep links in iframe
            html = html.replace(/target="_top"/g, 'target="_self"');
            html = html.replace(/target="_blank"/g, 'target="_self"');

            const proxyOrigin = `${req.protocol}://${req.get('host')}`;
            const currentProxyPath = `/browse/${protocol}/${host}`;
            
            const scriptInjection = `
            <script>
            // Attempt to bypass frame busting
            try {
                if (window.self !== window.top) {
                    // We can't overwrite window.top, but we can try to stop navigation
                    window.onbeforeunload = function() {
                        // This is annoying for users, so maybe not.
                        // Instead, let's just hope the target="_self" replacement works.
                    };
                }
            } catch(e) {}

            document.addEventListener('click', function(e) {
                const target = e.target.closest('a');
                if (target && target.href) {
                    e.preventDefault();
                    const href = target.getAttribute('href');
                    
                    // Check if it's already a proxy URL (avoid double proxy)
                    if (target.href.includes('/browse/')) {
                        window.location.href = target.href;
                        return;
                    }

                    if (href.startsWith('http')) {
                        window.location.href = '${proxyOrigin}/proxy?url=' + encodeURIComponent(href);
                        return;
                    }
                    
                    if (href.startsWith('/')) {
                        window.location.href = '${proxyOrigin}${currentProxyPath}' + href;
                        return;
                    }
                    
                    // Relative links
                    window.location.href = target.href;
                }
            });
            
            document.addEventListener('submit', function(e) {
                const target = e.target;
                const action = target.getAttribute('action');
                if (action) {
                    e.preventDefault();
                    if (action.startsWith('http')) {
                        window.location.href = '${proxyOrigin}/proxy?url=' + encodeURIComponent(action);
                    } else if (action.startsWith('/')) {
                        window.location.href = '${proxyOrigin}${currentProxyPath}' + action;
                    } else {
                        const resolved = new URL(action, window.location.href).href;
                        window.location.href = resolved;
                    }
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
        res.status(500).send('Error: ' + error.message);
    }
});

// Handle root-relative paths that escaped the proxy
app.use((req, res, next) => {
    if (req.url.startsWith('/browse/')) return next();
    if (req.url === '/proxy') return next();
    if (req.url === '/events') return next();
    
    const referer = req.get('Referer');
    if (referer && referer.includes('/browse/')) {
        const match = referer.match(/\/browse\/(https?)\/([^\/]+)/);
        if (match) {
            const protocol = match[1];
            const host = match[2];
            res.redirect(`/browse/${protocol}/${host}${req.url}`);
            return;
        }
    }
    
    // Fallback: If no referer, we can't guess.
    // But for Poki, maybe we can try to be smart?
    // If the request is for a common asset like /favicon.ico, we might ignore it.
    // But if it's /api/v2/..., it's important.
    
    res.status(404).send('Not Found (Proxy - Missing Referer)');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
