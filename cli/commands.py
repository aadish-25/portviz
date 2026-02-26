from ..services import collect_port_data
from ..cli.formatter import print_portviz_report
from ..core.summary import build_port_summary
from ..core.processors import (get_externally_accessible_listening_ports, get_local_listening_ports, get_dual_stack_ports)

def handle_command(args):
    if args.command == "report":
        data = collect_port_data()
        print_portviz_report(data)

    elif args.command == "summary":
        data = collect_port_data()
        summary = build_port_summary(data)

        print("---- Port Summary ----")
        print(f"Total Entries               : {summary.total_entries}")
        print(f"Listening Ports             : {summary.listening_count}")
        print(f"Established Connections     : {summary.established_count}")
        print(f"Externally Accessible Ports : {summary.public_listening_count}")
        print(f"Local-Only Listening Ports  : {summary.local_listening_count}")

    elif args.command == "list":
        data = collect_port_data()

        if args.public:
            ports = get_externally_accessible_listening_ports(data)
            print("Externally Accessible Listening Ports:")
            print(", ".join(map(str, ports)) if ports else "None")

        elif args.local:
            ports = get_local_listening_ports(data)
            print("Local-Only Listening Ports:")
            print(", ".join(map(str, ports)) if ports else "None")

        elif args.dual:
            ports = get_dual_stack_ports(data)
            print("Dual Stack Listening Ports:")
            print(", ".join(map(str, ports)) if ports else "None")

        else:
            print("---- Listening Ports ----")
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