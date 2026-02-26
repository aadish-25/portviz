from ..services import collect_port_data
from ..cli.formatter import print_portviz_report
from ..core.summary import build_port_summary
from ..core.processors import (
    get_externally_accessible_listening_ports,
    get_local_listening_ports,
    get_dual_stack_ports,
)
from ..core.processors import filter_by_port
from ..actions.process import kill_process
from ..cli.json_utils import print_json
from ..storage.snapshot import save_snapshot
from ..storage.snapshot import list_snapshots
from ..storage.snapshot import diff_snapshots

def handle_command(args):
    if args.command == "report":
        data = collect_port_data()
        print_portviz_report(data)

    elif args.command == "summary":
        data = collect_port_data()
        summary = build_port_summary(data)

        if args.json:
            print_json(summary)
            return

        print("---- Port Summary ----")
        print(f"Total Entries               : {summary.total_entries}")
        print(f"Listening Ports             : {summary.listening_count}")
        print(f"Established Connections     : {summary.established_count}")
        print(f"Externally Accessible Ports : {summary.public_listening_count}")
        print(f"Local-Only Listening Ports  : {summary.local_listening_count}")

    elif args.command == "list":
        data = collect_port_data()

        if args.json:
            print_json(data)
            return

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
            header = (
                f"{'Port':<8} {'Protocol':<8} {'IP':<20} {'Process':<25} {'PID':<8}"
            )
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

    elif args.command == "port":
        data = collect_port_data()
        results = filter_by_port(data, args.port_number)

        if args.json:
            print_json(results)
            return

        if not results:
            print(f"No entries found for port {args.port_number}")
            return

        print(f"---- Details for Port {args.port_number} ----")
        header = f"{'Protocol':<8} {'Local IP':<20} {'Foreign IP':<20} {'State':<15} {'Process':<25} {'PID':<8}"
        print(header)
        print("-" * len(header))

        for entry in results:
            print(
                f"{entry.protocol:<8} "
                f"{entry.local_ip:<20} "
                f"{entry.foreign_ip:<20} "
                f"{str(entry.state):<15} "
                f"{str(entry.process_name):<25} "
                f"{entry.pid:<8}"
            )

    elif args.command == "kill":
        if args.pid:
            result = kill_process(args.pid)

            if args.json:
                print_json(result)
                return

            if result.success:
                print("Process terminated successfully.")
            else:
                print("Failed to terminate process.")

            print(result.message)

        elif args.port:
            data = collect_port_data()
            entries = filter_by_port(data, args.port)

            if not entries:
                if args.json:
                    print_json([])
                    return

                print(f"No process found using port {args.port}")
                return

            # Collect unique PIDs
            pids = set()
            for entry in entries:
                pids.add(entry.pid)

            results = []

            if not args.json:
                print(f"Found {len(pids)} process(es) using port {args.port}")

            for pid in pids:
                result = kill_process(pid)

                results.append(
                    {"pid": pid, "success": result.success, "message": result.message}
                )

                if not args.json:
                    print(f"\nKilling PID {pid}...")
                    if result.success:
                        print("Process terminated successfully.")
                    else:
                        print("Failed to terminate process.")
                    print(result.message)

            if args.json:
                print_json(results)

    elif args.command == "snapshot":
        if args.snapshot_command == "save":
            data = collect_port_data()
            filepath = save_snapshot(data)

            if args.json:
                print_json({"snapshot_file": filepath})
                return

            print(f"Snapshot saved to {filepath}")

        elif args.snapshot_command == "list":
            snapshots = list_snapshots()

            if args.json:
                print_json(snapshots)
                return

            if not snapshots:
                print("No snapshots found.")
                return

            print("---- Saved Snapshots ----")
            for snap in snapshots:
                print(f"{snap['filename']} | {snap['created_at']} | {snap['entry_count']} entries")

        elif args.snapshot_command == "diff":
            snapshots = list_snapshots()

            if len(snapshots) < 2:
                print("Need at least two snapshots to diff.")
                return

            file1 = snapshots[-2]["filename"]
            file2 = snapshots[-1]["filename"]

            diff_result = diff_snapshots(file1, file2)

            if args.json:
                print_json(diff_result)
                return

            print("---- Snapshot Diff ----")
            print(f"Comparing {file1} → {file2}\n")

            new_services = diff_result["new_listening"]
            closed_services = diff_result["closed_listening"]

            if new_services:
                print("🟢 New Listening Services:")
                for e in new_services:
                    print(
                        f"  - Port {e['local_port']} | "
                        f"PID {e['pid']} | "
                        f"{e.get('process_name')} | "
                        f"{e['protocol']} | "
                        f"{e['local_ip']}"
                    )
            else:
                print("🟢 New Listening Services: None")

            print()

            if closed_services:
                print("🔴 Closed Listening Services:")
                for e in closed_services:
                    print(
                        f"  - Port {e['local_port']} | "
                        f"PID {e['pid']} | "
                        f"{e.get('process_name')} | "
                        f"{e['protocol']} | "
                        f"{e['local_ip']}"
                    )
            else:
                print("🔴 Closed Listening Services: None")