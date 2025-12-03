const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve the unlock folder as static files
app.use(express.static(path.join(__dirname, '../unlock')));

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
    
    // This is a very basic regex-based rewriter. 
    // For a production proxy, use a proper HTML parser.
    
    // Replace href="..."
    let newHtml = html.replace(/href="([^"]*)"/g, (match, p1) => {
        if (p1.startsWith('http')) {
            return `href="/proxy?url=${encodeURIComponent(p1)}"`;
        } else if (p1.startsWith('//')) {
            return `href="/proxy?url=${encodeURIComponent('https:' + p1)}"`;
        } else if (p1.startsWith('/')) {
            return `href="/proxy?url=${encodeURIComponent(origin + p1)}"`;
        } else {
            // Relative path without leading /
             return `href="/proxy?url=${encodeURIComponent(new URL(p1, baseUrl).href)}"`;
        }
    });

    // Replace src="..."
    newHtml = newHtml.replace(/src="([^"]*)"/g, (match, p1) => {
        if (p1.startsWith('http')) {
            return `src="/proxy?url=${encodeURIComponent(p1)}"`;
        } else if (p1.startsWith('//')) {
            return `src="/proxy?url=${encodeURIComponent('https:' + p1)}"`;
        } else if (p1.startsWith('/')) {
            return `src="/proxy?url=${encodeURIComponent(origin + p1)}"`;
        } else {
             return `src="/proxy?url=${encodeURIComponent(new URL(p1, baseUrl).href)}"`;
        }
    });
    
    // Replace action="..." for forms
    newHtml = newHtml.replace(/action="([^"]*)"/g, (match, p1) => {
         if (p1.startsWith('http')) {
            return `action="/proxy?url=${encodeURIComponent(p1)}"`;
        } else if (p1.startsWith('//')) {
            return `action="/proxy?url=${encodeURIComponent('https:' + p1)}"`;
        } else if (p1.startsWith('/')) {
            return `action="/proxy?url=${encodeURIComponent(origin + p1)}"`;
        } else {
             return `action="/proxy?url=${encodeURIComponent(new URL(p1, baseUrl).href)}"`;
        }
    });

    return newHtml;
}

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    // If it's not a URL, treat it as a search query
    if (!isValidUrl(targetUrl) && !targetUrl.includes('.') && !targetUrl.startsWith('http')) {
        targetUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
    } else if (!targetUrl.startsWith('http')) {
        // Try adding https:// if missing
        targetUrl = 'https://' + targetUrl;
    }

    try {
        console.log(`Proxying request to: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer', // Handle images/binary too
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            validateStatus: () => true // Don't throw on 404/500
        });

        // Forward headers
        const contentType = response.headers['content-type'];
        if (contentType) {
            res.setHeader('Content-Type', contentType);
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
