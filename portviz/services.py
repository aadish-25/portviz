from typing import List
from .collectors.windows import collect_ports
from .core.models import PortEntry


def collect_port_data() -> List[PortEntry]:
    """
    Orchestrates data collection.
    Currently Windows-only.
    """
    return collect_ports()