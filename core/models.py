from dataclasses import dataclass
from typing import Optional


@dataclass
class PortEntry:
    protocol: str
    local_ip: str
    local_port: int
    foreign_ip: str
    foreign_port: Optional[int]
    state: Optional[str]
    pid: int
    process_name: Optional[str]


@dataclass
class PortSummary:
    total_entries: int
    listening_count: int
    established_count: int
    public_listening_count: int
    local_listening_count: int


@dataclass
class KillResult:
    success: bool
    message: str
