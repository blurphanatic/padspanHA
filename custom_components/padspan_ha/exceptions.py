class PadSpanApiError(Exception):
    """Base PadSpan API error."""


class PadSpanApiConnectionError(PadSpanApiError):
    """Connectivity error to PadSpan hub/cloud."""
