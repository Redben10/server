document.getElementById('proxy-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const input = document.getElementById('url-input').value.trim();
    
    if (input) {
        // Redirect to the proxy endpoint
        // The server handles whether it's a URL or a search query
        window.location.href = `/proxy?url=${encodeURIComponent(input)}`;
    }
});

// Connect to SSE endpoint (as requested)
const eventSource = new EventSource('/events');

eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log('Server Event:', data);
    
    const statusDiv = document.getElementById('status');
    if (data.message) {
        statusDiv.textContent = data.message;
    }
};

eventSource.onerror = function(err) {
    console.error('EventSource failed:', err);
    eventSource.close();
};
