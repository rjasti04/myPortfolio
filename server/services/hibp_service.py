import hashlib
import httpx
import structlog

logger = structlog.get_logger(__name__)

HIBP_RANGE_API_URL = "https://api.pwnedpasswords.com/range/{prefix}"

async def check_password_breached(password: str) -> bool:
    """
    Checks if a password has appeared in a known data breach using Have I Been Pwned (HIBP) Range API.
    Uses k-Anonymity model by sending only the first 5 characters of the SHA-1 hash over HTTPS.
    Returns True if breached, False otherwise.
    """
    sha1_hash = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix = sha1_hash[:5]
    suffix = sha1_hash[5:]

    url = HIBP_RANGE_API_URL.format(prefix=prefix)
    headers = {"User-Agent": "rjWebApp-SecurityService/1.0"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                logger.warning("hibp_api_error", status_code=response.status_code, prefix=prefix)
                # Fallback: if HIBP service is unavailable, do not fail benign request or fail safe based on policy
                return False

            hashes = response.text.splitlines()
            for line in hashes:
                line = line.strip()
                if not line:
                    continue
                parts = line.split(":")
                if len(parts) == 2:
                    hash_tail, count_str = parts[0].strip().upper(), parts[1].strip()
                    if hash_tail == suffix:
                        count = int(count_str) if count_str.isdigit() else 0
                        if count > 0:
                            logger.info("hibp_breach_detected", count=count, prefix=prefix)
                            return True
            return False
    except Exception as e:
        logger.error("hibp_check_failed", error=str(e))
        # Log error and continue to avoid blocking user if HIBP is down/unreachable
        return False
