from typing import List, Dict
from .models import PortEntry


def get_port_by_state(data: List[PortEntry], state: str):
    processes_with_required_state = []
    for entry in data:
        if entry.state == state.upper():
            processes_with_required_state.append(entry)
    return processes_with_required_state


def filter_by_port(data: List[PortEntry], port: int):
    process_with_port = []
    for entry in data:
        if entry.local_port == port:
            process_with_port.append(entry)
    return process_with_port


def get_listening_port_numbers(data: List[PortEntry]):
    listening_port_list = []
    for entry in data:
        if entry.state == "LISTENING":
            listening_port_list.append(entry.local_port)
    return sorted(set(listening_port_list))


def group_by_process(data: List[PortEntry]):
    process_groups = {}

    for entry in data:
        pid = entry.pid

        if pid not in process_groups:
            process_groups[pid] = {
                "process_name": entry.process_name,
                "ports": []
            }

        if entry.local_port not in process_groups[pid]["ports"]:
            process_groups[pid]["ports"].append(entry.local_port)

    return process_groups


def get_externally_accessible_listening_ports(data: List[PortEntry]):
    externally_accessible_listening_port_list = []

    for entry in data:
        if entry.state != "LISTENING":
            continue

        local_ip = entry.local_ip

        if local_ip in ("127.0.0.1", "[::1]"):
            continue

        externally_accessible_listening_port_list.append(entry.local_port)

    return sorted(set(externally_accessible_listening_port_list))


def get_local_listening_ports(data: List[PortEntry]):
    local_listening_port_list = []
    for entry in data:
        if entry.state == "LISTENING" and entry.local_ip in (
            "127.0.0.1",
            "[::1]",
        ):
            local_listening_port_list.append(entry.local_port)
    return sorted(set(local_listening_port_list))


def get_dual_stack_ports(data: List[PortEntry]):
    port_ip_map = {}

    for entry in data:
        if entry.state != "LISTENING":
            continue

        port = entry.local_port
        ip = entry.local_ip

        if port not in port_ip_map:
            port_ip_map[port] = set()

        if ip.startswith("["):
            port_ip_map[port].add("IPv6")
        else:
            port_ip_map[port].add("IPv4")

    dual_stack_ports = []

    for port, versions in port_ip_map.items():
        if "IPv4" in versions and "IPv6" in versions:
            dual_stack_ports.append(port)

    return sorted(dual_stack_ports)


def get_port_owners(data: List[PortEntry]):
    port_owners = {}
    for entry in data:
        local_port = entry.local_port
        if local_port not in port_owners:
            port_owners[local_port] = []
        if entry.process_name not in port_owners[local_port]:
            port_owners[local_port].append(entry.process_name)
    return port_owners