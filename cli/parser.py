import argparse


def create_parser():
    parser = argparse.ArgumentParser(
        prog="portviz", description="Windows Port Inspection CLI Tool"
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

    return parser
