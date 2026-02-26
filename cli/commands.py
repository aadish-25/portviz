from ..services import collect_port_data
from ..cli.formatter import print_portviz_report
from ..core.summary import build_port_summary


def handle_command(args):
    if args.command == "report":
        data = collect_port_data()
        print_portviz_report(data)

    elif args.command == "summary":
        data = collect_port_data()
        summary = build_port_summary()

        print("---- Port Summary ----")
        print(f"Total Entries               : {summary.total_entries}")
        print(f"Listening Ports             : {summary.listening_count}")
        print(f"Established Connections     : {summary.established_count}")
        print(f"Externally Accessible Ports : {summary.public_listening_count}")
        print(f"Local-Only Listening Ports  : {summary.local_listening_count}")
