from typing import List
from portviz.collectors.windows import collect_ports
from portviz.core.models import PortEntry


def collect_port_data() -> List[PortEntry]:
    """
    Orchestrates data collection.
    Currently Windows-only.
    """
    return collect_ports()