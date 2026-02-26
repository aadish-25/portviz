from typing import List
from .models import PortEntry, PortSummary
from .processors import (
    get_port_by_state,
    get_externally_accessible_listening_ports,
    get_local_listening_ports,
)


def build_port_summary(data: List[PortEntry]):
    return PortSummary(
        total_entries=len(data),
        listening_count=len(get_port_by_state(data, "LISTENING")),
        established_count=len(get_port_by_state(data, "ESTABLISHED")),
        public_listening_count=len(
            get_externally_accessible_listening_ports(data)
        ),
        local_listening_count=len(
            get_local_listening_ports(data)
        ),
    )