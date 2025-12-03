(function() {
    const OriginalWebSocket = window.WebSocket;
    
    // Generate a random session ID
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    class ProxiedWebSocket {
        constructor(url, protocols) {
            // Handle relative WebSocket URLs (e.g. new WebSocket('/socket.io'))
            // We need to resolve them against the REAL target URL, not the proxy URL.
            
            // Extract current target from window.location.pathname
            // Path is /service/https://site.com/foo
            let currentPath = window.location.pathname;
            let targetBase = '';
            
            if (currentPath.startsWith('/service/')) {
                targetBase = currentPath.substring('/service/'.length);
                // Fix protocol slashes if needed
                if (targetBase.startsWith('http:/') && !targetBase.startsWith('http://')) targetBase = targetBase.replace('http:/', 'http://');
                if (targetBase.startsWith('https:/') && !targetBase.startsWith('https://')) targetBase = targetBase.replace('https:/', 'https://');
            }

            let finalUrl = url;
            
            // If it's a relative URL, resolve it against the target base
            if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
                try {
                    // Create a dummy URL object to resolve relative path
                    // If targetBase is https://site.com/foo, and url is /socket, result is https://site.com/socket
                    // Then replace http/https with ws/wss
                    const resolved = new URL(url, targetBase);
                    finalUrl = resolved.href;
                    if (finalUrl.startsWith('http')) finalUrl = finalUrl.replace('http', 'ws');
                } catch (e) {
                    console.error('[ProxyWS] Failed to resolve relative URL:', url, e);
                }
            }

            this.url = finalUrl;
            this.protocols = protocols;
            this.readyState = 0; // CONNECTING
            this.bufferedAmount = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onerror = null;
            this.onclose = null;
            this.sessionId = generateUUID();
            
            console.log('[ProxyWS] Intercepting WebSocket connection to:', finalUrl);

            // Connect to the proxy's SSE endpoint for downstream messages
            // We encode the target URL and session ID
            // Note: Updated endpoint to /api/ws-connect
            const sseUrl = `/api/ws-connect?target=${encodeURIComponent(finalUrl)}&session=${this.sessionId}`;
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                console.log('[ProxyWS] SSE Connected');
            };

            this.eventSource.onmessage = (event) => {
                const message = JSON.parse(event.data);
                
                if (message.type === 'open') {
                    this.readyState = 1; // OPEN
                    if (this.onopen) this.onopen(new Event('open'));
                } else if (message.type === 'message') {
                    if (this.onmessage) {
                        this.onmessage(new MessageEvent('message', {
                            data: message.data,
                            origin: this.url
                        }));
                    }
                } else if (message.type === 'error') {
                    if (this.onerror) this.onerror(new Event('error'));
                } else if (message.type === 'close') {
                    this.close(message.code, message.reason);
                }
            };

            this.eventSource.onerror = (err) => {
                console.error('[ProxyWS] SSE Error:', err);
                if (this.onerror) this.onerror(new Event('error'));
                this.close();
            };
        }

        send(data) {
            if (this.readyState !== 1) {
                throw new Error('WebSocket is not open');
            }

            // Send data upstream via HTTP POST
            // Note: Updated endpoint to /api/ws-send
            fetch('/api/ws-send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session: this.sessionId,
                    data: data
                })
            }).catch(err => {
                console.error('[ProxyWS] Send Error:', err);
                if (this.onerror) this.onerror(new Event('error'));
            });
        }

        close(code, reason) {
            if (this.readyState === 3) return;
            this.readyState = 3; // CLOSED
            
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }

            // Notify server to close
            // Note: Updated endpoint to /api/ws-close
            fetch('/api/ws-close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: this.sessionId })
            }).catch(() => {});

            if (this.onclose) {
                this.onclose(new CloseEvent('close', {
                    code: code || 1000,
                    reason: reason || '',
                    wasClean: true
                }));
            }
        }
    }

    // Constants
    ProxiedWebSocket.CONNECTING = 0;
    ProxiedWebSocket.OPEN = 1;
    ProxiedWebSocket.CLOSING = 2;
    ProxiedWebSocket.CLOSED = 3;

    // Override global WebSocket
    window.WebSocket = ProxiedWebSocket;
    console.log('[ProxyWS] WebSocket Polyfill installed');
})();
