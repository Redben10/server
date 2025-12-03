document.getElementById('proxy-form').addEventListener('submit', function(e) {
    e.preventDefault();
    let input = document.getElementById('url-input').value.trim();
    
    if (input) {
        // Determine if it's a URL or search
        if (!input.startsWith('http://') && !input.startsWith('https://')) {
            if (input.includes('.') && !input.includes(' ')) {
                input = 'https://' + input;
            } else {
                input = 'https://www.google.com/search?q=' + encodeURIComponent(input);
            }
        }
        
        // Redirect to the path-based proxy endpoint
        window.location.href = `/service/${input}`;
    }
});
