import os
import json
from flask import Flask, request, jsonify, send_file, render_template
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
import pyttsx3
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')

# Configuration
MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {DEVICE}")

# Global model variables
model = None
tokenizer = None

def load_model():
    global model, tokenizer
    logger.info(f"Loading model {MODEL_NAME}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME)
    model = model.to(DEVICE)
    logger.info("Model loaded successfully")

# Initialize TTS engine
def get_tts_engine():
    engine = pyttsx3.init()
    engine.setProperty('rate', 145)  # Slightly slower for better clarity
    engine.setProperty('volume', 0.9)
    
    # Get available voices and set a more natural one if available
    voices = engine.getProperty('voices')
    if len(voices) > 1:  # Try to use a female voice if available
        engine.setProperty('voice', voices[1].id)
    
    return engine

# Educational prompt templates
SYSTEM_PROMPT = "You are Edu-Vox, an AI educational assistant that creates memorable mnemonics and explanations. Be concise, clear, and creative."

PROMPT_TEMPLATES = {
    "mnemonic": "<|system|>\n{system}\n<|user|>\nCreate a mnemonic for: {input}\n<|assistant|>",
    "explain": "<|system|>\n{system}\n<|user|>\nExplain in simple terms: {input}\n<|assistant|>",
    "quiz": "<|system|>\n{system}\n<|user|>\nCreate a quick quiz question about: {input}\n<|assistant|>"
}

# Session management
sessions = {}

# Generate response
def generate_response(user_input, session_id, mode="mnemonic"):
    # Create or get session
    if session_id not in sessions:
        sessions[session_id] = {"history": []}
    
    # Prepare prompt
    prompt_template = PROMPT_TEMPLATES.get(mode, PROMPT_TEMPLATES["mnemonic"])
    prompt = prompt_template.format(system=SYSTEM_PROMPT, input=user_input)
    
    # Generate response
    try:
        inputs = tokenizer(prompt, return_tensors="pt", max_length=256, truncation=True).to(DEVICE)
        outputs = model.generate(
            **inputs,
            max_new_tokens=64,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id
        )
        
        full_response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Extract assistant's response (after the last assistant tag)
        assistant_response = full_response.split("<|assistant|>")[-1].strip()
        
        # Update session history
        sessions[session_id]["history"].append({
            "user": user_input,
            "assistant": assistant_response
        })
        
        return assistant_response
    except Exception as e:
        logger.error(f"Error generating response: {str(e)}")
        return "I'm having trouble processing that. Could you try again?"

# Convert text to audio
def text_to_audio(text, session_id):
    audio_dir = "audio"
    os.makedirs(audio_dir, exist_ok=True)
    
    audio_path = f"{audio_dir}/output_{session_id}.wav"
    
    engine = get_tts_engine()
    engine.save_to_file(text, audio_path)
    engine.runAndWait()
    
    # Ensure file is written before returning
    timeout = 10
    start_time = time.time()
    while not os.path.exists(audio_path) and time.time() - start_time < timeout:
        time.sleep(0.1)
    
    if not os.path.exists(audio_path):
        logger.error("Failed to create audio file")
        return None
    
    return audio_path

# Routes
@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/process', methods=['POST'])
def process():
    data = request.json
    user_input = data.get('text', '')
    session_id = data.get('session_id', 'default')
    mode = data.get('mode', 'mnemonic')
    
    if not user_input:
        response = "Please say something so I can help you."
    elif "stop" in user_input.lower() or "quit" in user_input.lower() or "exit" in user_input.lower():
        response = "Edu-Vox is now inactive. Say hello to start again!"
    else:
        response = generate_response(user_input, session_id, mode)
    
    audio_path = text_to_audio(response, session_id)
    
    if audio_path:
        return jsonify({
            'response': response, 
            'audio': f'/audio/output_{session_id}.wav',
            'session_id': session_id
        })
    else:
        return jsonify({
            'response': response,
            'error': 'Failed to generate audio',
            'session_id': session_id
        }), 500

@app.route('/audio/<path:filename>')
def serve_audio(filename):
    return send_file(f"audio/{filename}")

@app.route('/modes')
def get_modes():
    return jsonify({
        'modes': [
            {'id': 'mnemonic', 'name': 'Mnemonic Generator'},
            {'id': 'explain', 'name': 'Simple Explanation'},
            {'id': 'quiz', 'name': 'Quick Quiz'}
        ]
    })

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'})

if __name__ == "__main__":
    os.makedirs("audio", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    load_model()  # Load model at startup
    app.run(host="0.0.0.0", port=5000, debug=True)