"""Compatibility entrypoint for the shared isolated environment installer."""
import sys
def main():
    from environment_manager import main as manage
    sys.argv[1:1] = ['install', 'anima-lumina']
    manage()


if __name__ == '__main__':
    main()
