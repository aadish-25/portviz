import json
from dataclasses import asdict, is_dataclass


def to_serializable(data):
    if is_dataclass(data):
        return asdict(data)

    if isinstance(data, list):
        return [to_serializable(item) for item in data]

    if isinstance(data, dict):
        return {k: to_serializable(v) for k, v in data.items()}

    return data


def print_json(data):
    serializable = to_serializable(data)
    print(json.dumps(serializable, indent=4))
