
import http.server
import socketserver
import json
import os
import sys

# Ensure we can import chat.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from chat import GigaChatBot

PORT = 8000
bot = None

try:
    bot = GigaChatBot()
    print("AI Bot initialized successfully.")
except Exception as e:
    print(f"Failed to initialize AI Bot: {e}")

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/chat':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                
                # Input format: { "history": [...], "message": "...", "context": {...} }
                history = data.get('history', [])
                user_message = data.get('message')
                context = data.get('context') # Only present on first call

                if user_message:
                    history.append({"role": "user", "content": user_message})
                
                print(f"Received request. Context: {bool(context)}, Msg: {user_message}")

                # Get response from bot
                response_text = bot.get_response(history, context)
                
                # Check for approval
                approved = False
                if '[APPROVE]' in response_text:
                    approved = True
                    response_text = response_text.replace('[APPROVE]', '').strip()

                # Send back JSON
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                
                response_data = {
                    "text": response_text,
                    "approved": approved
                }
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
                
            except Exception as e:
                print(f"Error processing request: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), RequestHandler) as httpd:
        print(f"Serving AI Chat API at port {PORT}")
        httpd.serve_forever()
