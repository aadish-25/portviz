from ..core.summary import build_port_summary
from ..core.processors import (
    get_externally_accessible_listening_ports,
    get_local_listening_ports,
    get_dual_stack_ports,
)
from ..core.models import PortEntry
from typing import List


def print_portviz_report(data: List[PortEntry]):
    summary = build_port_summary(data)
    external_ports = get_externally_accessible_listening_ports(data)
    local_ports = get_local_listening_ports(data)
    dual_stack = get_dual_stack_ports(data)

    print("\n================ PORTVIZ REPORT ================\n")

    print("---- Summary ----")
    print(f"Total Entries               : {summary.total_entries}")
    print(f"Listening Ports             : {summary.listening_count}")
    print(f"Established Connections     : {summary.established_count}")
    print(f"Externally Accessible Ports : {summary.public_listening_count}")
    print(f"Local-Only Listening Ports  : {summary.local_listening_count}")
    print()

    print("---- Listening Ports (Detailed) ----")
    header = f"{'Port':<8} {'Protocol':<8} {'IP':<20} {'Process':<25} {'PID':<8}"
    print(header)
    print("-" * len(header))

    for entry in data:
        if entry.state == "LISTENING":
            print(
                f"{entry.local_port:<8} "
                f"{entry.protocol:<8} "
                f"{entry.local_ip:<20} "
                f"{str(entry.process_name):<25} "
                f"{entry.pid:<8}"
            )

    print()

    print("---- Externally Accessible Ports ----")
    print(", ".join(map(str, external_ports)) if external_ports else "None")
    print()

    print("---- Local-Only Listening Ports ----")
    print(", ".join(map(str, local_ports)) if local_ports else "None")
    print()

    print("---- Dual Stack Ports (IPv4 + IPv6) ----")
    print(", ".join(map(str, dual_stack)) if dual_stack else "None")
    print()

    print("=================================================\n")