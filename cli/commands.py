from ..services import collect_port_data
from ..cli.formatter import print_portviz_report

def handle_command(args):
    if args.command == "report":
        data = collect_port_data()
        print_portviz_report(data)