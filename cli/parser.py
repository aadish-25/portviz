import argparse


def create_parser():
    parser = argparse.ArgumentParser(
        prog="portviz", description="Windows Port Inspection CLI Tool"
    )

    parser.add_argument(
        "--json", action="store_true", help="Output results in JSON format"
    )

    subparsers = parser.add_subparsers(dest="command")

    # report command
    subparsers.add_parser("report", help="Show full Portviz report")

    # summary command
    subparsers.add_parser("summary", help="Show summarized port statistics")

    # list command and its flags
    list_parser = subparsers.add_parser("list", help="List listening ports")

    list_parser.add_argument(
        "--public",
        action="store_true",
        help="Show externally accessible listening ports",
    )

    list_parser.add_argument(
        "--local", action="store_true", help="Show local-only listening ports"
    )

    list_parser.add_argument(
        "--dual",
        action="store_true",
        help="Show dual-stack listening ports (IPv4 + IPv6)",
    )

    # port command
    port_parser = subparsers.add_parser("port", help="Inspect a specific port")
    port_parser.add_argument("port_number", type=int, help="Port number to inspect")

    # kill command
    kill_parser = subparsers.add_parser("kill", help="Kill a process by PID or by port")

    group = kill_parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--pid", type=int, help="Process ID to terminate")
    group.add_argument("--port", type=int, help="Kill process(es) using this port")

    # snapshot parser
    snapshot_parser = subparsers.add_parser("snapshot", help="Manage port snapshots")

    snapshot_subparsers = snapshot_parser.add_subparsers(dest="snapshot_command")

    snapshot_subparsers.add_parser("save", help="Save current port state as snapshot")
    snapshot_subparsers.add_parser("list", help="List saved snapshots")
    diff_parser = snapshot_subparsers.add_parser(
        "diff", help="Diff two snapshots (default: last two)"
    )
    diff_parser.add_argument("snapshot1", nargs="?", help="First snapshot filename")
    diff_parser.add_argument("snapshot2", nargs="?", help="Second snapshot filename")

    return parser
