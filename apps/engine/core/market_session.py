from enum import Enum

class SessionState(Enum):
    PRE_OPEN = "PRE_OPEN"
    OPEN = "OPEN"
    HALTED = "HALTED"
    CLOSED = "CLOSED"
