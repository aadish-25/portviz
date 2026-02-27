import os
import time
import json
from datetime import datetime
from rich.live import Live
from rich.table import Table
from rich.console import Group
from rich.text import Text
from rich import box
from collections import deque
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

        if args.json:
            print_json(data)
            return

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
                print(
                    f"{snap['filename']} | {snap['created_at']} | {snap['entry_count']} entries"
                )

        elif args.snapshot_command == "diff":
            snapshots = list_snapshots()

            if args.snapshot1 and args.snapshot2:
                file1 = args.snapshot1
                file2 = args.snapshot2

            else:
                if len(snapshots) < 2:
                    print("Need at least two snapshots to diff.")
                    return

                file1 = snapshots[-2]["filename"]
                file2 = snapshots[-1]["filename"]

            try:
                diff_result = diff_snapshots(file1, file2)
            except FileNotFoundError:
                print("One or both snapshot files not found.")
                return

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

    elif args.command == "watch":

        previous_state = {}
        recent_events = deque(maxlen=5)

        def build_dashboard(current_listening):
            table = Table(box=box.SIMPLE_HEAVY)
            table.add_column("Port", style="cyan", justify="right")
            table.add_column("PID", style="magenta", justify="right")
            table.add_column("Process", style="white")
            table.add_column("Proto", style="green")
            table.add_column("IP", style="yellow")

            for e in current_listening.values():
                table.add_row(
                    str(e.local_port),
                    str(e.pid),
                    str(e.process_name),
                    e.protocol,
                    e.local_ip,
                )

            header = Text()
            header.append("PORTVIZ LIVE MONITOR\n", style="bold bright_white")
            header.append(
                f"Last Updated: {datetime.now().strftime('%H:%M:%S')} | "
                f"Active Services: {len(current_listening)}",
                style="dim",
            )

            if recent_events:
                events_table = Table(box=box.SIMPLE)
                events_table.add_column("Recent Changes (last 5)", style="bold")
                for event in recent_events:
                    events_table.add_row(event)
                return Group(header, table, events_table)

            return Group(header, table)

        try:
            # ---- STREAM MODE ----
            if args.stream:
                while True:
                    data = collect_port_data()

                    current_listening = {
                        (e.local_port, e.pid): e
                        for e in data
                        if e.state == "LISTENING"
                    }

                    if not previous_state:
                        previous_state = current_listening
                        time.sleep(2)
                        continue

                    prev_keys = set(previous_state.keys())
                    curr_keys = set(current_listening.keys())

                    new_keys = curr_keys - prev_keys
                    closed_keys = prev_keys - curr_keys

                    timestamp = datetime.now().strftime("%H:%M:%S")

                    for key in new_keys:
                        e = current_listening[key]

                        if args.json:
                            print(json.dumps({
                                "event": "service_started",
                                "timestamp": timestamp,
                                "port": e.local_port,
                                "pid": e.pid,
                                "process": e.process_name,
                                "protocol": e.protocol,
                                "ip": e.local_ip
                            }))
                        else:
                            print(f"[{timestamp}] + Port {e.local_port} | {e.process_name}")

                    for key in closed_keys:
                        e = previous_state[key]

                        if args.json:
                            print(json.dumps({
                                "event": "service_stopped",
                                "timestamp": timestamp,
                                "port": e.local_port,
                                "pid": e.pid,
                                "process": e.process_name,
                                "protocol": e.protocol,
                                "ip": e.local_ip
                            }))
                        else:
                            print(f"[{timestamp}] - Port {e.local_port} | {e.process_name}")

                    previous_state = current_listening
                    time.sleep(2)

            # ---- DASHBOARD MODE ----
            else:
                with Live(refresh_per_second=2) as live:
                    while True:
                        data = collect_port_data()

                        current_listening = {
                            (e.local_port, e.pid): e
                            for e in data
                            if e.state == "LISTENING"
                        }

                        if not previous_state:
                            previous_state = current_listening
                            live.update(build_dashboard(current_listening))
                            time.sleep(2)
                            continue

                        prev_keys = set(previous_state.keys())
                        curr_keys = set(current_listening.keys())

                        new_keys = curr_keys - prev_keys
                        closed_keys = prev_keys - curr_keys

                        timestamp = datetime.now().strftime("%H:%M:%S")

                        for key in new_keys:
                            e = current_listening[key]
                            recent_events.appendleft(
                                f"[green][{timestamp}] + Port {e.local_port} | {e.process_name}[/green]"
                            )

                        for key in closed_keys:
                            e = previous_state[key]
                            recent_events.appendleft(
                                f"[red][{timestamp}] - Port {e.local_port} | {e.process_name}[/red]"
                            )

                        previous_state = current_listening
                        live.update(build_dashboard(current_listening))
                        time.sleep(2)

        except KeyboardInterrupt:
            if not args.json:
                print("\nStopped watching.")