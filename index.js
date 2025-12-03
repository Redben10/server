const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const url = require('url');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Support form data

// Serve the unlock folder as static files
app.use(express.static(path.join(__dirname, '../unlock')));

// Read injection script
const injectScript = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');

// Helper to check if string is a URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Helper to fix relative URLs in HTML
function rewriteLinks(html, baseUrl) {
    const base = new URL(baseUrl);
    const origin = base.origin;
    
    // Helper to rewrite a single URL
    const rewriteUrl = (u) => {
        if (!u) return u;
        if (u.startsWith('http')) {
            return `/proxy?url=${encodeURIComponent(u)}`;
        } else if (u.startsWith('//')) {
            return `/proxy?url=${encodeURIComponent('https:' + u)}`;
        } else if (u.startsWith('/')) {
            return `/proxy?url=${encodeURIComponent(origin + u)}`;
        } else {
            return `/proxy?url=${encodeURIComponent(new URL(u, baseUrl).href)}`;
        }
    };

    // Regex to match href, src, action with both single and double quotes
    // Matches: href="...", href='...', src="...", src='...', action="...", action='...'
    let newHtml = html.replace(/(href|src|action)=["']([^"']*)["']/g, (match, attr, p1) => {
        return `${attr}="${rewriteUrl(p1)}"`;
    });

    // Inject the script at the top of the head or body
    if (newHtml.includes('<head>')) {
        newHtml = newHtml.replace('<head>', `<head><script>${injectScript}</script>`);
    } else if (newHtml.includes('<body>')) {
        newHtml = newHtml.replace('<body>', `<body><script>${injectScript}</script>`);
    }

    return newHtml;
}

// Handle all HTTP methods (GET, POST, etc.)
app.all('/proxy', async (req, res) => {
    let targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    // If it's not a URL, treat it as a search query (only for GET)
    if (req.method === 'GET' && !isValidUrl(targetUrl) && !targetUrl.includes('.') && !targetUrl.startsWith('http')) {
        targetUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
    } else if (!targetUrl.startsWith('http')) {
        // Try adding https:// if missing
        targetUrl = 'https://' + targetUrl;
    }

    try {
        console.log(`Proxying ${req.method} request to: ${targetUrl}`);
        
        const options = {
            method: req.method,
            url: targetUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // Forward cookies
                ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {}),
                // Spoof referer to be the target URL
                'Referer': targetUrl
            },
            data: req.body, // Forward body for POST
            responseType: 'arraybuffer', // Handle images/binary too
            validateStatus: () => true // Don't throw on 404/500
        };

        const response = await axios(options);

        // Forward headers
        const contentType = response.headers['content-type'];
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // Forward Set-Cookie headers
        // We need to strip 'Secure' and 'Domain' attributes to make them work on localhost/proxy
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            const newCookies = setCookie.map(c => {
                // Remove Domain and Secure to allow cookies to be set on our proxy domain
                return c.replace(/Domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '').replace(/SameSite=[^;]+;?/gi, '');
            });
            res.setHeader('Set-Cookie', newCookies);
        }

        // If it's HTML, rewrite links
        if (contentType && contentType.includes('text/html')) {
            const html = response.data.toString('utf-8');
            const rewrittenHtml = rewriteLinks(html, targetUrl);
            res.send(rewrittenHtml);
        } else {
            // Just send the data (images, css, etc)
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send(`Error fetching URL: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
