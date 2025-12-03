const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

    // Block the specific domain mentioned by the user (as requested, though this is server-side)
    if (targetUrl.includes('chromebook.ccpsnet.net')) {
        return res.status(403).send('Blocked domain');
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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

// SSE Endpoint (as requested, though not strictly needed for basic proxy, keeping it for compliance)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ message: 'Connected to proxy server' });

    // Keep connection open
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
