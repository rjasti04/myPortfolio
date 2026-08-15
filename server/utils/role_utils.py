def ensure_alternating_roles(messages: list[dict]) -> list[dict]:
    """Ensure Bedrock-compatible role alternation (user/assistant/user/...).

    - Merges consecutive same-role messages into one.
    - Prepends a synthetic user message if the conversation starts with assistant.
    """
    if not messages:
        return messages

    merged: list[dict] = []
    for msg in messages:
        if merged and merged[-1]["role"] == msg["role"]:
            # Merge text content into the previous message
            merged[-1]["content"][0]["text"] += "\n" + msg["content"][0]["text"]
        else:
            merged.append({"role": msg["role"], "content": [{"text": msg["content"][0]["text"]}]})

    # Bedrock requires the first message to be 'user'
    if merged and merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": [{"text": "[conversation context]"}]})

    return merged
