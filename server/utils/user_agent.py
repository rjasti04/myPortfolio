"""Device classification from a User-Agent string.

`POST /sessions` takes `device_type` from the client, which classifies itself in
`analytics.js` (`getDeviceType`). A refresh token is minted on a request that
carries no such field, so the session panel needs the server to make the same
call from the header alone. The two patterns below are ports of that function,
kept deliberately identical so a browser is not filed as "mobile" in one place
and "desktop" in the other, and bucketed into the same three values
`SessionCreate.device_type` already declares.
"""

import re
from typing import Optional

# Tablets first: an Android tablet's UA contains "Android" but not "Mobi", and
# testing for a phone first would claim it.
_TABLET = re.compile(r"(tablet|ipad|playbook|silk)|(android(?!.*mobi))", re.I)
_MOBILE = re.compile(
    r"Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated"
    r"|(hpw|web)OS|Opera M(obi|ini)"
)


def device_type_from_user_agent(user_agent: Optional[str]) -> Optional[str]:
    """One of "tablet", "mobile", "desktop"; None when there is no header.

    None rather than "desktop" for a missing header: an absent User-Agent means
    the caller is not a browser at all, and recording that as a desktop would
    put a script in the session list looking like a laptop.
    """
    if not user_agent:
        return None
    if _TABLET.search(user_agent):
        return "tablet"
    if _MOBILE.search(user_agent):
        return "mobile"
    return "desktop"
