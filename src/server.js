const express = require('express');
const axios = require('axios');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

// Helper to rewrite URLs in HTML
const rewriteHtml = (html, baseUrl) => {
    // This is a very basic regex-based rewriter. 
    // In a production environment, you'd use a proper HTML parser.
    // It looks for href="...", src="...", action="..."
    
    const proxyUrl = '/proxy?url=';
    
    // Function to replace URLs
    const replaceUrl = (match, attribute, quote, originalUrl) => {
        if (!originalUrl) return match;
        if (originalUrl.startsWith('data:') || originalUrl.startsWith('#')) return match;
        
        try {
            const absoluteUrl = new url.URL(originalUrl, baseUrl).href;
            return `${attribute}=${quote}${proxyUrl}${encodeURIComponent(absoluteUrl)}${quote}`;
        } catch (e) {
            return match;
        }
    };

    // Regex for href, src, action
    // Captures: 1=attribute, 2=quote, 3=url
    const regex = /(href|src|action)=(['"])(.*?)\2/gi;
    
    return html.replace(regex, replaceUrl);
};

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    // "Block" the specific domain as requested (though technically we just don't proxy it)
    if (targetUrl.includes('chromebook.ccpsnet.net')) {
        return res.status(403).send('Access to this domain is blocked by policy.');
    }

    try {
        // Validate URL
        new url.URL(targetUrl);
    } catch (err) {
        // If it's not a valid URL, maybe it's a search query? 
        // But the frontend should handle that. We'll assume it's a malformed URL here.
        // Or we can try to prepend https://
        try {
             const fixedUrl = 'https://' + targetUrl;
             new url.URL(fixedUrl); // Check if valid now
             return res.redirect(`/proxy?url=${encodeURIComponent(fixedUrl)}`);
        } catch (e) {
            return res.status(400).send('Invalid URL');
        }
    }

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'arraybuffer', // Get raw data
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            validateStatus: () => true // Don't throw on 404/500
        });

        // Forward headers
        Object.keys(response.headers).forEach(key => {
            // Skip some headers that might cause issues
            if (['content-length', 'content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) return;
            res.setHeader(key, response.headers[key]);
        });

        const contentType = response.headers['content-type'] || '';

        if (contentType.includes('text/html')) {
            // Rewrite HTML
            const html = response.data.toString('utf-8');
            const rewrittenHtml = rewriteHtml(html, targetUrl);
            res.send(rewrittenHtml);
        } else {
            // Pipe other content directly
            res.send(response.data);
        }

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).send(`Error fetching URL: ${error.message}`);
    }
});

// SSE Endpoint (as requested, though not strictly used for the proxying itself)
// This could be used for status updates or keeping the connection alive if needed.
app.get('/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = () => {
        res.write(`data: ${JSON.stringify({ status: 'active', time: new Date().toISOString() })}\n\n`);
    };

    const interval = setInterval(sendStatus, 5000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
