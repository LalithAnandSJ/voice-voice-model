// Session management
let sessionId = 'session_' + Date.now();
let currentMode = 'mnemonic';
let isRecognizing = false;
let micClickTimer = null;

// DOM elements
const micButton = document.getElementById('micButton');
const status = document.getElementById('status');
const result = document.getElementById('result');
const audioOutput = document.getElementById('audioOutput');
const modeSelector = document.getElementById('modeSelector');
const waveVisualizer = document.querySelector('.wave');

// Initialize speech recognition
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.continuous = false;

// Fetch available modes
fetch('/modes')
    .then(response => response.json())
    .then(data => {
        // Populate mode selector
        data.modes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.id;
            option.textContent = mode.name;
            modeSelector.appendChild(option);
        });
    })
    .catch(error => {
        console.error('Error fetching modes:', error);
        status.textContent = 'Could not load learning modes. Please refresh.';
    });

// Mode change handler
modeSelector.addEventListener('change', (event) => {
    currentMode = event.target.value;
    status.textContent = `Mode set to: ${event.target.options[event.target.selectedIndex].text}`;
});

// Microphone button handler with debounce
micButton.addEventListener('click', () => {
    // Prevent rapid multiple clicks
    if (micClickTimer !== null) {
        clearTimeout(micClickTimer);
    }
    
    micClickTimer = setTimeout(() => {
        try {
            if (micButton.textContent.includes('Speak')) {
                startListening();
            } else {
                stopListening();
            }
        } catch (error) {
            console.error("Microphone button error:", error);
            isRecognizing = false;
            status.textContent = "Error with speech recognition. Please reload the page.";
            micButton.textContent = '🎙️ Speak';
            waveVisualizer.classList.remove('active');
        }
        micClickTimer = null;
    }, 300); // 300ms debounce
});

// Start listening with permission check
async function startListening() {
    try {
        // First check if recognition is already running
        if (isRecognizing) {
            console.log("Recognition already running, stopping first");
            recognition.stop();
            // Wait a brief moment before starting again
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Explicitly request microphone permission
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Now start recognition
        recognition.start();
        isRecognizing = true;
        status.textContent = 'Listening...';
        micButton.textContent = '🎙️ Stop';
        waveVisualizer.classList.add('active');
    } catch (err) {
        console.error('Microphone permission error:', err);
        isRecognizing = false;
        if (err.name === 'NotAllowedError') {
            status.textContent = 'Microphone access denied. Please allow microphone access in your browser settings.';
        } else {
            status.textContent = `Error: ${err.message}. Please try again.`;
        }
        micButton.textContent = '🎙️ Speak';
        waveVisualizer.classList.remove('active');
    }
}

// Stop listening
function stopListening() {
    if (isRecognizing) {
        try {
            recognition.stop();
        } catch (err) {
            console.error('Error stopping recognition:', err);
        }
        isRecognizing = false;
    }
    micButton.textContent = '🎙️ Speak';
    waveVisualizer.classList.remove('active');
}

// Speech recognition handlers
recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    status.textContent = `Heard: ${transcript}`;
    stopListening();
    
    if (transcript.trim()) {
        processUserInput(transcript);
    }
};

// Process user input
function processUserInput(userInput) {
    result.textContent = "Processing...";
    
    // Visual feedback
    waveVisualizer.classList.add('processing');
    
    // Send to Flask backend
    fetch('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            text: userInput,
            session_id: sessionId,
            mode: currentMode
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server responded with status ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Update session ID if provided
        if (data.session_id) {
            sessionId = data.session_id;
        }
        
        // Display response
        result.textContent = data.response;
        
        // Play audio if available
        if (data.audio) {
            audioOutput.src = data.audio;
            audioOutput.style.display = 'block';
            
            // Add timestamp to avoid caching
            audioOutput.src = data.audio + '?t=' + new Date().getTime();
            
            audioOutput.play().catch(err => {
                console.error('Error playing audio:', err);
            });
        }
        
        waveVisualizer.classList.remove('processing');
    })
    .catch(error => {
        console.error('Error:', error);
        result.textContent = "Sorry, there was an error processing your request. " + error.message;
        waveVisualizer.classList.remove('processing');
    });
}

// Handle recognition errors
recognition.onerror = (event) => {
    console.error('Recognition error:', event.error);
    isRecognizing = false;
    
    if (event.error === 'not-allowed') {
        status.textContent = 'Microphone access denied. Please allow microphone access in your browser settings.';
    } else if (event.error === 'network') {
        status.textContent = 'Network error. Please check your connection.';
    } else {
        status.textContent = `Error: ${event.error}. Please try again.`;
    }
    
    stopListening();
};

recognition.onend = () => {
    isRecognizing = false;
    if (status.textContent === 'Listening...') {
        status.textContent = 'Click the microphone to start...';
        stopListening();
    }
};

// Add keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // Space bar toggles microphone
    if (event.key === ' ' && document.activeElement.tagName !== 'INPUT') {
        event.preventDefault();
        
        // Prevent rapid keypresses
        if (micClickTimer !== null) {
            return;
        }
        
        if (micButton.textContent.includes('Speak')) {
            startListening();
        } else {
            stopListening();
        }
    }
});

// Check browser compatibility
window.addEventListener('load', () => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        status.textContent = 'Speech recognition is not supported in your browser. Try Chrome.';
        micButton.disabled = true;
    }
    
    // Check if backend server is reachable
    fetch('/health')
        .catch(error => {
            console.error('Backend server not reachable:', error);
            status.textContent = 'Warning: Backend server not connected. Voice processing will not work.';
        });
});