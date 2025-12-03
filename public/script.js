document.getElementById('proxyForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const input = document.getElementById('urlInput').value.trim();
    
    if (!input) return;

    let targetUrl;

    // Simple check if it's a URL
    // If it contains a space, it's definitely a search
    // If it doesn't have a dot, it's likely a search (unless localhost)
    // If it starts with http:// or https://, it's a URL
    
    if (input.includes(' ') || !input.includes('.')) {
        // Treat as search
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(input)}`;
    } else {
        // Treat as URL
        targetUrl = input;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
    }

    // Redirect to proxy
    window.location.href = `/proxy?url=${encodeURIComponent(targetUrl)}`;
});

// SSE Connection (as requested)
const statusDiv = document.getElementById('status');
if (!!window.EventSource) {
    const source = new EventSource('/status');

    source.addEventListener('message', function(e) {
        // Just logging or showing status to prove SSE is working
        // console.log('Server status:', e.data);
    }, false);

    source.addEventListener('open', function(e) {
        // console.log("Connection was opened.");
    }, false);

    source.addEventListener('error', function(e) {
        if (e.readyState == EventSource.CLOSED) {
            // console.log("Connection was closed.");
        }
    }, false);
}
