document.getElementById('proxy-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const input = document.getElementById('url-input').value.trim();
    
    if (input) {
        // Show the iframe
        const iframe = document.getElementById('content-frame');
        iframe.style.display = 'block';
        
        let targetUrl = input;
        
        // Basic URL validation/fix
        if (!targetUrl.includes('.') && !targetUrl.startsWith('http')) {
            // Search query
            targetUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
        } else if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        // Use the unblocker URL format: /proxy/{url}
        iframe.src = `https://server.geobattery.com/proxy/${targetUrl}`;
    }
});
