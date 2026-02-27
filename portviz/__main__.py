from .cli.parser import create_parser
from .cli.commands import handle_command
from .version import __version__

from pyfiglet import figlet_format
from rich.console import Console
from rich.text import Text

console = Console()


def print_banner():
    ascii_banner = figlet_format("Portviz", font="slant")

    # Solid bold green banner
    banner_text = Text(ascii_banner, style="bold green")
    console.print(banner_text)

    # Subtitle
    console.print(
        f"[dim]Windows Port Inspection CLI Tool  v{__version__}[/dim]\n"
    )


def main():
    parser = create_parser()
    args = parser.parse_args()

    if not args.command:
        print_banner()
        parser.print_help()
        return

    handle_command(args)


if __name__ == "__main__":
    main()