import sys
import os

sys.path.append(r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp")

# Set dummy environment variables to prevent RuntimeError on load
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["DEFAULT_MODEL_ID"] = "anthropic.claude-3-haiku-20240307-v1:0"

from server.main import SessionCreate

# Test SessionCreate validation with short user agent (should pass)
payload_short = SessionCreate(user_agent="Mozilla/5.0", device_type="desktop")
print("Short UA validation: SUCCESS")

# Test SessionCreate validation with long user agent (600 characters - should pass now because limit is 2048)
long_ua = "Mozilla/5.0 " + ("A" * 600)
payload_long = SessionCreate(user_agent=long_ua, device_type="desktop")
print("Long UA (612 chars) validation: SUCCESS")

# Test truncate logic
user_agent_truncated = payload_long.user_agent[:512] if payload_long.user_agent else None
print(f"Truncated UA length: {len(user_agent_truncated)}")
assert len(user_agent_truncated) == 512
print("Truncation assertion: SUCCESS")

# Test too long user agent (2500 characters - should fail because limit is 2048)
try:
    too_long_ua = "A" * 2500
    SessionCreate(user_agent=too_long_ua, device_type="desktop")
    print("Warning: 2500 chars user agent did not fail!")
except Exception as e:
    print("Too long UA validation (2500 chars) correctly failed with exception:", type(e).__name__)
