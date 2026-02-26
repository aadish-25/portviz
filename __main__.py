from .cli.parser import create_parser
from .cli.commands import handle_command

def main():
    parser = create_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return
    
    handle_command(args)

if __name__ == "__main__":
    main()