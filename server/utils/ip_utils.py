import ipaddress
from typing import Optional, Any
from fastapi import Request
import structlog

logger = structlog.get_logger(__name__)

def parse_proxy_networks(raw: str) -> list[Any]:
    networks = []
    for item in raw.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        try:
            networks.append(ipaddress.ip_network(candidate, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_IPS entry: %s", candidate)
    return networks


def is_trusted_proxy(ip: Optional[str], trusted_networks: list[Any]) -> bool:
    if not ip:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(address in network for network in trusted_networks)


def client_ip_from_request(request: Request, trusted_networks: list[Any]) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded and is_trusted_proxy(direct_ip, trusted_networks):
        forwarded_ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
        for candidate in reversed(forwarded_ips):
            try:
                ipaddress.ip_address(candidate)
            except ValueError:
                continue
            if not is_trusted_proxy(candidate, trusted_networks):
                return candidate[:64]
    return direct_ip
