from server.utils.role_utils import ensure_alternating_roles


def test_ensure_alternating_roles_consecutive_user_messages():
    raw_messages = [
        {"role": "user", "content": "First question"},
        {"role": "user", "content": "Second question without answer"},
    ]
    result = ensure_alternating_roles(raw_messages)
    assert len(result) == 1
    assert result[0]["role"] == "user"
    assert result[0]["content"] == "First question\n\nSecond question without answer"


def test_ensure_alternating_roles_leading_assistant_message():
    raw_messages = [
        {"role": "assistant", "content": "Hello! How can I help?"},
        {"role": "user", "content": "Tell me about Rajeev."},
    ]
    result = ensure_alternating_roles(raw_messages)
    assert len(result) == 3
    assert result[0]["role"] == "user"
    assert result[0]["content"] == "[conversation context]"
    assert result[1]["role"] == "assistant"
    assert result[1]["content"] == "Hello! How can I help?"
    assert result[2]["role"] == "user"
    assert result[2]["content"] == "Tell me about Rajeev."


def test_ensure_alternating_roles_filters_empty_messages():
    raw_messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "   "},
        {"role": "user", "content": "World"},
    ]
    result = ensure_alternating_roles(raw_messages)
    assert len(result) == 1
    assert result[0]["role"] == "user"
    assert result[0]["content"] == "Hello\n\nWorld"


def test_ensure_alternating_roles_converse_format():
    raw_messages = [
        {"role": "user", "content": [{"text": "Hello"}]},
        {"role": "user", "content": [{"text": "World"}]},
    ]
    result = ensure_alternating_roles(raw_messages)
    assert len(result) == 1
    assert result[0]["role"] == "user"
    assert result[0]["content"] == [{"text": "Hello\n\nWorld"}]
