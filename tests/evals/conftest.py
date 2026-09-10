import os

os.environ.setdefault("TESTING", "true")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("DEFAULT_MODEL_ID", "dummy-model-id")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-any-real-deployment")
