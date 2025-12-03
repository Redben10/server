const express = require('express');
const Unblocker = require('unblocker');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Unblocker
// We configure it to strip security headers that prevent iframing
const unblocker = new Unblocker({
    prefix: '/proxy/',
    responseMiddleware: [
        (data) => {
            // Strip X-Frame-Options and Content-Security-Policy to allow iframing
            if (data.headers['x-frame-options']) {
                delete data.headers['x-frame-options'];
            }
            if (data.headers['content-security-policy']) {
                delete data.headers['content-security-policy'];
            }
            if (data.headers['x-content-type-options']) {
                delete data.headers['x-content-type-options'];
            }
        }
    ]
});

// Use Unblocker middleware
// This handles all the complex rewriting of HTML, JS, CSS, cookies, etc.
app.use(unblocker);

// Serve the unlock folder as static files
app.use(express.static(path.join(__dirname, '../unlock')));

// Fallback for the root URL to serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../unlock/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Proxy ready at /proxy/`);
});
