const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Middleware to block the specific domain
const blockList = ['chromebook.ccpsnet.net'];

// Helper to rewrite URLs
function rewriteUrl(originalUrl, baseUrl) {
    try {
        // If it's already a proxy URL, leave it (or decode it to check)
        if (originalUrl.startsWith('/proxy')) return originalUrl;
        
        // Resolve relative URLs
        const resolvedUrl = new url.URL(originalUrl, baseUrl).href;
        
        // Check blocklist
        if (blockList.some(domain => resolvedUrl.includes(domain))) {
            return '#blocked';
        }

        return `/proxy?url=${encodeURIComponent(resolvedUrl)}`;
    } catch (e) {
        return originalUrl;
    }
}

app.get('/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.redirect('/');
    
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    res.redirect(`/proxy?url=${encodeURIComponent(searchUrl)}`);
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.status(400).send('No URL provided');
    }

    // Check if the target itself is blocked
    if (blockList.some(domain => targetUrl.includes(domain))) {
        return res.status(403).send('This domain is blocked by the proxy.');
    }

    try {
        // Fetch the content
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
            const $ = cheerio.load(html);

            // Rewrite hrefs
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href) $(el).attr('href', rewriteUrl(href, targetUrl));
            });

            // Rewrite srcs (images, scripts)
            $('img, script, iframe, link').each((i, el) => {
                const src = $(el).attr('src');
                if (src) $(el).attr('src', rewriteUrl(src, targetUrl));
                
                const href = $(el).attr('href'); // for <link> tags
                if (href) $(el).attr('href', rewriteUrl(href, targetUrl));
            });

            // Rewrite forms
            $('form').each((i, el) => {
                const action = $(el).attr('action');
                if (action) $(el).attr('action', rewriteUrl(action, targetUrl));
            });

            res.set('Content-Type', 'text/html');
            res.send($.html());
        } else {
            // For non-HTML, just pipe the data
            res.set('Content-Type', contentType);
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send(`Error fetching URL: ${error.message}`);
    }
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
