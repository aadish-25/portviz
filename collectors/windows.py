import subprocess
from typing import List
from portviz.core.models import PortEntry


def get_process_map():
    process_map = {}

    output = subprocess.run(
        ["tasklist"], capture_output=True, text=True
    ).stdout.splitlines()

    for line in output[3:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            process_name = parts[0]
            pid = int(parts[1])
            process_map[pid] = process_name

    return process_map


def collect_ports() -> List[PortEntry]:
    process_map = get_process_map()

    header_index = None
    lines = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True
    ).stdout.split("\n")

    for i, line in enumerate(lines):
        if line.strip().startswith("Proto"):
            header_index = i
            break

    if header_index is None:
        return []

    data_lines = lines[header_index + 1 :]

    port_details = []

    for line in data_lines:
        parts = line.split()

        if not parts or parts[0] not in ("TCP", "UDP"):
            continue

        if parts[0] == "TCP":
            protocol = parts[0].upper()
            local_address, local_port = parts[1].rsplit(":", 1)
            foreign_address, foreign_port = parts[2].rsplit(":", 1)
            state = parts[3].upper()
            pid = parts[4]

        elif parts[0] == "UDP":
            protocol = parts[0].upper()
            local_address, local_port = parts[1].rsplit(":", 1)
            foreign_address, foreign_port = parts[2].rsplit(":", 1)
            state = None
            pid = parts[3]

        entry = PortEntry(
            protocol=protocol,
            local_ip=local_address,
            local_port=int(local_port) if local_port.isdigit() else local_port,
            foreign_ip=foreign_address,
            foreign_port=int(foreign_port) if foreign_port.isdigit() else foreign_port,
            state=state,
            pid=int(pid),
            process_name=process_map.get(int(pid)),
        )

        port_details.append(entry)

    return port_details
