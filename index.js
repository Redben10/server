const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const BLOCKED_DOMAIN = 'chromebook.ccpsnet.net';
const PROXY_PREFIX = '/view';

// --- MIDDLEWARE ---

// 1. Block specific domain
app.use((req, res, next) => {
    if (req.url.includes(BLOCKED_DOMAIN) || 
        (req.get('Referer') && req.get('Referer').includes(BLOCKED_DOMAIN))) {
        return res.status(403).send('Blocked');
    }
    next();
});

// 2. Cookie Helper
const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
};

// --- ROUTES ---

// Entry point: Redirects /proxy?url=... to /view/https://...
app.get('/proxy', (req, res) => {
    let url = req.query.url;
    if (!url) return res.status(400).send('URL required');
    if (!url.startsWith('http')) url = 'https://' + url;
    
    // Clean up the URL to fit our path structure
    // We want: /view/https://example.com/path/
    const urlObj = new URL(url);
    const cleanPath = `${PROXY_PREFIX}/${urlObj.protocol.replace(':', '')}/${urlObj.host}${urlObj.pathname}${urlObj.search}`;
    
    res.redirect(cleanPath);
});

// The Main Proxy Handler
// Matches: /view/https/google.com/some/path
app.use(`${PROXY_PREFIX}/:proto/:host/*`, async (req, res) => {
    const proto = req.params.proto;
    const host = req.params.host;
    const path = req.params[0]; // The rest of the path
    
    const targetUrl = `${proto}://${host}/${path}`;
    
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': `${proto}://${host}/`
            },
            validateStatus: () => true // Accept all status codes
        });

        // 1. Forward Headers
        const contentType = response.headers['content-type'];
        res.status(response.status);
        res.set('Content-Type', contentType);
        
        // 2. Set a cookie to remember where we are (helps with the "Catch-All" fix)
        res.setHeader('Set-Cookie', `proxy_root=${proto}://${host}; Path=/; HttpOnly; SameSite=None; Secure`);

        // 3. Handle HTML specifically
        if (contentType && contentType.includes('text/html')) {
            let html = response.data.toString('utf-8');

            // Remove headers that break iframes
            res.removeHeader('X-Frame-Options');
            res.removeHeader('Content-Security-Policy');

            // Inject a script to help with links
            const script = `
            <script>
                // Force all links to stay in the iframe
                document.addEventListener('DOMContentLoaded', () => {
                    document.querySelectorAll('a').forEach(a => {
                        if (a.target === '_top' || a.target === '_blank') a.target = '_self';
                    });
                    document.querySelectorAll('form').forEach(f => {
                        if (f.target === '_top' || f.target === '_blank') f.target = '_self';
                    });
                });
            </script>
            `;
            
            // Insert script before </body>
            if (html.includes('</body>')) {
                html = html.replace('</body>', script + '</body>');
            } else {
                html += script;
            }

            res.send(html);
        } else {
            // Send images, css, js, etc. as is
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send('Proxy Error: ' + error.message);
    }
});

// --- CATCH-ALL HANDLER ---
// This fixes the issue where a site requests "/style.css" (Root Relative)
// and it goes to "server.com/style.css" instead of "server.com/view/.../style.css"
app.use((req, res) => {
    // 1. Try to guess based on Referer
    const referer = req.get('Referer');
    if (referer && referer.includes(PROXY_PREFIX)) {
        // Extract the base from the referer
        // Referer: .../view/https/google.com/foo
        const match = referer.match(new RegExp(`${PROXY_PREFIX}/(https?)/([^/]+)`));
        if (match) {
            const proto = match[1];
            const host = match[2];
            return res.redirect(`${PROXY_PREFIX}/${proto}/${host}${req.url}`);
        }
    }

    // 2. Try to guess based on Cookie
    const cookies = parseCookies(req);
    if (cookies.proxy_root) {
        const root = cookies.proxy_root; // e.g. https://google.com
        const urlObj = new URL(root);
        return res.redirect(`${PROXY_PREFIX}/${urlObj.protocol.replace(':', '')}/${urlObj.host}${req.url}`);
    }

    res.status(404).send('Not Found (Proxy Catch-All)');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
