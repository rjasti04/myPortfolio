from pydantic import BaseModel, EmailStr, Field, field_validator

# Bounds, not ergonomics. POST /contact is unauthenticated by necessity - a
# stranger reaching out is the whole point - so whatever this schema accepts is
# what an anonymous caller can put into an email and into the log stream.
MAX_NAME_CHARS = 100
MAX_MESSAGE_CHARS = 5_000
MAX_SUBJECT_CHARS = 150


class ContactRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=MAX_NAME_CHARS)
    email: EmailStr
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)

    # The markup has carried a honeypot for as long as the form has. It rode
    # along on a native form POST but the hand-built AJAX payload dropped it,
    # so the path virtually every submission takes never applied it. Checked
    # server-side now, where a bot cannot edit it away.
    honeypot: str = Field(default="", max_length=MAX_SUBJECT_CHARS, alias="_honey")

    model_config = {"populate_by_name": True}

    @field_validator("name", "message")
    @classmethod
    def strip_and_require_content(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("name")
    @classmethod
    def reject_header_injection(cls, value: str) -> str:
        """A newline in the name would break out of the Subject header.

        `name` is interpolated into the subject line, so CR/LF here could add
        arbitrary headers - a Bcc, a forged Reply-To - to a message this server
        sends. EmailStr already rejects them in `email`.
        """
        if "\n" in value or "\r" in value:
            raise ValueError("must not contain line breaks")
        return value
