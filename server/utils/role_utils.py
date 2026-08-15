from typing import Any, Dict, List, Union


def _extract_text(content: Union[str, List[Any], Dict[str, Any]]) -> str:
    """Extract string content from string, Converse API list/dict payload structures."""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
        return "\n".join(parts)
    elif isinstance(content, dict) and "text" in content:
        return str(content["text"])
    return str(content) if content is not None else ""


def ensure_alternating_roles(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ensure Bedrock-compatible role alternation (user/assistant/user/...).

    - Filters out empty or whitespace-only messages.
    - Merges consecutive same-role messages into a single turn separated by newlines.
    - Prepends a synthetic user message if the conversation starts with assistant.
    - Preserves Converse API format if input was formatted with [{"text": ...}].
    """
    if not messages:
        return []

    merged: List[Dict[str, Any]] = []

    for msg in messages:
        role = msg.get("role", "user")
        raw_content = msg.get("content", "")
        text_content = _extract_text(raw_content).strip()

        if not text_content:
            continue

        is_converse = (
            isinstance(raw_content, list)
            and len(raw_content) > 0
            and isinstance(raw_content[0], dict)
            and "text" in raw_content[0]
        )

        if merged and merged[-1]["role"] == role:
            prev_content = merged[-1]["content"]
            if isinstance(prev_content, list) and len(prev_content) > 0 and isinstance(prev_content[0], dict):
                prev_text = _extract_text(prev_content)
                merged[-1]["content"] = [{"text": f"{prev_text}\n\n{text_content}"}]
            else:
                prev_text = _extract_text(prev_content)
                merged[-1]["content"] = f"{prev_text}\n\n{text_content}"
        else:
            if is_converse:
                merged.append({"role": role, "content": [{"text": text_content}]})
            else:
                merged.append({"role": role, "content": text_content})

    if not merged:
        return []

    # Bedrock requires the first message to be 'user'
    if merged[0]["role"] != "user":
        is_converse_first = isinstance(merged[0]["content"], list)
        synthetic_content = [{"text": "[conversation context]"}] if is_converse_first else "[conversation context]"
        merged.insert(0, {"role": "user", "content": synthetic_content})

    return merged
