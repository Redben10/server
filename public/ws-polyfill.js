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
            this.url = url;
            this.protocols = protocols;
            this.readyState = 0; // CONNECTING
            this.bufferedAmount = 0;
            this.onopen = null;
            this.onmessage = null;
            this.onerror = null;
            this.onclose = null;
            this.sessionId = generateUUID();
            
            console.log('[ProxyWS] Intercepting WebSocket connection to:', url);

            // Connect to the proxy's SSE endpoint for downstream messages
            // We encode the target URL and session ID
            const sseUrl = `/proxy/ws-connect?target=${encodeURIComponent(url)}&session=${this.sessionId}`;
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                console.log('[ProxyWS] SSE Connected');
                // We wait for the 'open' event from the server to confirm the real WS is open
            };

            this.eventSource.onmessage = (event) => {
                const message = JSON.parse(event.data);
                
                if (message.type === 'open') {
                    this.readyState = 1; // OPEN
                    if (this.onopen) this.onopen(new Event('open'));
                } else if (message.type === 'message') {
                    if (this.onmessage) {
                        // Reconstruct a MessageEvent
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
            fetch('/proxy/ws-send', {
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
            fetch('/proxy/ws-close', {
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
