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

    return parser
