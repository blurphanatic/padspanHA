class PadSpanError(Exception):
    """Base exception for PadSpan integration."""

class PadSpanApiError(PadSpanError):
    """PadSpan API returned an error."""

class PadSpanApiConnectionError(PadSpanApiError):
    """PadSpan API connection failed."""
