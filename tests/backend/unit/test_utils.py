import pytest
from server.utils.role_utils import ensure_alternating_roles
from server.utils.ip_utils import is_trusted_proxy, parse_proxy_networks

def test_ensure_alternating_roles_empty():
    assert ensure_alternating_roles([]) == []

def test_ensure_alternating_roles_merging():
    messages = [
        {"role": "user", "content": [{"text": "Hello"}]},
        {"role": "user", "content": [{"text": "World"}]},
        {"role": "assistant", "content": [{"text": "Hi there"}]},
    ]
    result = ensure_alternating_roles(messages)
    assert len(result) == 2
    assert result[0]["role"] == "user"
    assert result[0]["content"][0]["text"] == "Hello\nWorld"
    assert result[1]["role"] == "assistant"

def test_ensure_alternating_roles_starts_with_assistant():
    messages = [
        {"role": "assistant", "content": [{"text": "Welcome"}]},
    ]
    result = ensure_alternating_roles(messages)
    assert len(result) == 2
    assert result[0]["role"] == "user"
    assert result[1]["role"] == "assistant"

def test_trusted_proxy_parsing():
    networks = parse_proxy_networks("192.168.1.0/24, 10.0.0.1")
    assert len(networks) == 2
    assert is_trusted_proxy("192.168.1.50", networks) is True
    assert is_trusted_proxy("1.1.1.1", networks) is False
