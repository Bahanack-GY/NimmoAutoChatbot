class WhatsAppQRScanner {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.qrCode = null;
        
        this.initializeElements();
        this.connectWebSocket();
    }

    initializeElements() {
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.statusDetails = document.getElementById('statusDetails');
        this.qrContainer = document.getElementById('qrContainer');
        this.qrcodeDiv = document.getElementById('qrcode');
        this.successMessage = document.getElementById('successMessage');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorDetails = document.getElementById('errorDetails');
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/whatsapp`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateStatus('connecting', 'WebSocket connected, waiting for WhatsApp status...');
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateStatus('disconnected', 'WebSocket disconnected');
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('error', 'WebSocket connection error');
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'qr':
                this.displayQRCode(data.qr);
                this.updateStatus('connecting', 'QR Code generated, please scan with WhatsApp');
                break;
                
            case 'ready':
                this.hideQRCode();
                this.updateStatus('ready', 'WhatsApp connected successfully!');
                this.showSuccessMessage();
                break;
                
            case 'loading':
                this.updateStatus('connecting', `Loading WhatsApp: ${data.percent}% - ${data.message}`);
                break;
                
            case 'auth_failure':
                this.updateStatus('error', 'Authentication failed');
                this.showErrorMessage('Authentication failed. Please try again.');
                break;
                
            case 'disconnected':
                this.updateStatus('disconnected', 'WhatsApp disconnected');
                this.showErrorMessage('WhatsApp disconnected. Please check your connection.');
                break;
                
            case 'message':
                this.handleIncomingMessage(data);
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    displayQRCode(qrData) {
        // Clear previous QR code
        this.qrcodeDiv.innerHTML = '';
        
        // Generate new QR code
        this.qrCode = new QRCode(this.qrcodeDiv, {
            text: qrData,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        
        this.qrContainer.classList.remove('ready', 'error');
        this.qrContainer.classList.add('connecting');
    }

    hideQRCode() {
        this.qrContainer.classList.add('hidden');
        this.qrContainer.classList.remove('ready', 'error', 'connecting');
    }

    updateStatus(status, message) {
        // Update status dot
        this.statusDot.className = `status-dot ${status}`;
        
        // Update status text
        this.statusText.textContent = this.getStatusText(status);
        
        // Update status details
        this.statusDetails.textContent = message;
        
        // Update QR container styling
        this.qrContainer.className = `qr-container ${status}`;
    }

    getStatusText(status) {
        const statusMap = {
            'connecting': 'Connecting...',
            'ready': 'Connected',
            'error': 'Error',
            'disconnected': 'Disconnected'
        };
        return statusMap[status] || 'Unknown';
    }

    showSuccessMessage() {
        this.successMessage.style.display = 'block';
        this.errorMessage.style.display = 'none';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.successMessage.style.display = 'none';
        }, 5000);
    }

    showErrorMessage(message) {
        this.errorDetails.textContent = message;
        this.errorMessage.style.display = 'block';
        this.successMessage.style.display = 'none';
    }

    handleIncomingMessage(data) {
        console.log('Incoming message:', data);
        // You can add custom logic here to handle incoming messages
        // For example, display them in a chat interface
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.updateStatus('connecting', `Reconnecting... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, this.reconnectDelay);
        } else {
            this.updateStatus('error', 'Failed to reconnect. Please refresh the page.');
            this.showErrorMessage('Connection lost. Please refresh the page to try again.');
        }
    }

    // Public method to send messages (if needed)
    sendMessage(to, message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'send_message',
                to: to,
                message: message
            }));
        }
    }
}

// Initialize the QR scanner when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WhatsAppQRScanner();
});

// Handle page visibility changes to reconnect if needed
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible, check connection
        console.log('Page became visible, checking connection...');
    }
});

// Handle beforeunload to clean up
window.addEventListener('beforeunload', () => {
    if (window.whatsappScanner && window.whatsappScanner.ws) {
        window.whatsappScanner.ws.close();
    }
});
