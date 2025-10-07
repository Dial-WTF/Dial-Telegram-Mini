from __future__ import annotations

import sys
import argparse
import requests


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", required=True)
    parser.add_argument("--prompt", required=True)
    args = parser.parse_args(argv)

    r = requests.post(f"{args.gateway}/inference", json={"prompt": args.prompt})
    r.raise_for_status()
    print(r.json()["text"])


if __name__ == "__main__":
    main(sys.argv[1:])


