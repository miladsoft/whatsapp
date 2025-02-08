const socket = io();

// Add connection status logs
socket.on('connect', () => {
    console.log('Connected to server');
    connectionStatus.textContent = 'Connected to server, waiting for QR...';
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    connectionStatus.textContent = 'Error connecting to server';
});

// Elements
const qrSection = document.getElementById('qr-section');
const qrCode = document.getElementById('qr-code');
const connectionStatus = document.getElementById('connection-status');
const messageSection = document.getElementById('message-section');
const phoneInput = document.getElementById('phone');
const messageInput = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const testTextBtn = document.getElementById('test-text');
const testLocationBtn = document.getElementById('test-location');
const testPollBtn = document.getElementById('test-poll');

// Modify QR code handler
socket.on('qr', (data) => {
    console.log('Received QR code');
    qrCode.innerHTML = ''; // Clear existing content
    
    // Create new pre element for QR
    const qrPre = document.createElement('pre');
    qrPre.textContent = data.qr;
    qrCode.appendChild(qrPre);
    
    connectionStatus.textContent = 'Scan this QR code with WhatsApp';
});

// Make status updates more visible
socket.on('status', (data) => {
    console.log('Status update:', data.status);
    connectionStatus.textContent = `Status: ${data.status}`;
    
    if (data.status === 'connected') {
        qrSection.style.display = 'none';
        messageSection.style.display = 'block';
    }
});

socket.on('message', (data) => {
    alert(data.message);
});

// Event listeners
sendBtn.addEventListener('click', () => {
    const phone = phoneInput.value.trim();
    const message = messageInput.value.trim();
    
    if (!phone || !message) {
        alert('Please fill in all fields');
        return;
    }

    socket.emit('send-message', {
        phone: phone,
        message: message
    });
});

testTextBtn.addEventListener('click', () => {
    const phone = phoneInput.value.trim();
    if (!phone) {
        alert('Please enter a phone number');
        return;
    }
    socket.emit('test-text', { phone });
});

testLocationBtn.addEventListener('click', () => {
    const phone = phoneInput.value.trim();
    if (!phone) {
        alert('Please enter a phone number');
        return;
    }
    socket.emit('test-location', { phone });
});

testPollBtn.addEventListener('click', () => {
    const phone = phoneInput.value.trim();
    if (!phone) {
        alert('Please enter a phone number');
        return;
    }
    socket.emit('test-poll', { phone });
});
