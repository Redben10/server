document.getElementById('proxy-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const input = document.getElementById('url-input').value.trim();
    
    if (input) {
        // Post to the server to set the target URL
        fetch('/_api/set-target', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: input }),
        })
        .then(response => {
            if (response.redirected) {
                window.location.href = response.url;
            } else {
                // Fallback if fetch doesn't follow redirect automatically (it usually does)
                window.location.href = '/';
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Failed to set proxy target');
        });
    }
});
