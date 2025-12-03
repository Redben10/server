
(function() {
    const PROXY_URL = '/proxy?url=';

    function rewriteUrl(url) {
        if (!url) return url;
        if (url.startsWith(window.location.origin + '/proxy')) return url;
        
        // Handle absolute URLs
        if (url.startsWith('http')) {
            return PROXY_URL + encodeURIComponent(url);
        }
        
        // Handle relative URLs (resolve against current proxied URL if possible)
        // This is tricky because we don't easily know the "current" base URL from inside JS 
        // unless we track it. For now, we'll try to rely on the server's rewriting 
        // or let the browser resolve it against the current page (which is /proxy?url=...)
        // If the browser resolves "api/data" against "/proxy?url=...", it becomes "/api/data" 
        // which is wrong. It should be appended to the target origin.
        
        return url;
    }

    // Override fetch
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let url = input;
        if (typeof input === 'string') {
            // If it's a relative path like "api/v1", we need to know the base.
            // The base is hidden in the query param "url" of the current window.
            const currentUrlParams = new URLSearchParams(window.location.search);
            const currentTarget = currentUrlParams.get('url');
            
            if (currentTarget) {
                try {
                    const targetBase = new URL(currentTarget);
                    // Resolve input against targetBase
                    const absoluteUrl = new URL(input, targetBase).href;
                    url = PROXY_URL + encodeURIComponent(absoluteUrl);
                } catch (e) {
                    console.error('Error rewriting fetch URL:', e);
                }
            }
        }
        return originalFetch(url, init);
    };

    // Override XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        let newUrl = url;
        if (typeof url === 'string') {
            const currentUrlParams = new URLSearchParams(window.location.search);
            const currentTarget = currentUrlParams.get('url');
            
            if (currentTarget) {
                try {
                    const targetBase = new URL(currentTarget);
                    const absoluteUrl = new URL(url, targetBase).href;
                    newUrl = PROXY_URL + encodeURIComponent(absoluteUrl);
                } catch (e) {
                    console.error('Error rewriting XHR URL:', e);
                }
            }
        }
        return originalOpen.apply(this, [method, newUrl, async, user, password]);
    };
})();
