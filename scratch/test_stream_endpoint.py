import sys
import os
import asyncio
import uuid
import json

# Set dummy environment variables to prevent RuntimeError on load
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["DEFAULT_MODEL_ID"] = "anthropic.claude-3-haiku-20240307-v1:0"

# Add project root to path
sys.path.append(r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp")

from server.main import app
from server.services.kafka_stream import active_streams, process_incoming_event

async def test_streaming_endpoint():
    print("Testing SSE stream endpoint locally using direct function invocation...")
    
    session_id = uuid.uuid4()
    print(f"Generated test session_id: {session_id}")
    
    # 1. Verify active streams dictionary is initially empty for this session_id
    assert len(active_streams[session_id]) == 0
    print("Initial active streams check: SUCCESS")

    # 2. Simulate SSE client connection by registering a stream
    from server.services.kafka_stream import register_stream, unregister_stream
    client_queue = await register_stream(session_id)
    assert len(active_streams[session_id]) == 1
    print("SSE client register check: SUCCESS")
    
    # 3. Simulate incoming Kafka event for this session
    test_event = {
        "session_id": str(session_id),
        "event_type": "terminal_command",
        "page_path": "/activity",
        # Base64 encoded: {"command": "git commit -m 'Initial commit'", "args": []}
        "event_data": "eyJjb21tYW5kIjogImdpdCBjb21taXQgLW0gJ0luaXRpYWwgY29tbWl0JyIsICJhcmdzIjogW119"
    }
    
    print("Injecting test event into incoming event processor...")
    await process_incoming_event(test_event)
    
    # 4. Read from client queue
    print("Reading message from SSE broadcast queue...")
    try:
        msg = await asyncio.wait_for(client_queue.get(), timeout=2.0)
        print("Message received successfully!")
        print(f"Received JSON: {json.dumps(msg, indent=2)}")
        
        # Verify decoding worked
        assert msg["event_type"] == "terminal_command"
        assert isinstance(msg["event_data"], dict)
        assert msg["event_data"]["command"] == "git commit -m 'Initial commit'"
        print("Payload base64 decoding check: SUCCESS")
    except asyncio.TimeoutError:
        print("ERROR: Did not receive message in queue!")
        sys.exit(1)
        
    # 5. Clean up stream connection
    unregister_stream(session_id, client_queue)
    assert session_id not in active_streams
    print("SSE client unregister check: SUCCESS")
    print("All stream logic test scenarios: SUCCESS!")

if __name__ == "__main__":
    asyncio.run(test_streaming_endpoint())
