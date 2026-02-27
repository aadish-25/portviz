import subprocess
from ..core.models import KillResult


def kill_process(pid):
    try:
        result = subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            text=True,
        )

        return KillResult(
            success=result.returncode == 0,
            message=result.stdout.strip() or result.stderr.strip(),
        )

    except Exception as e:
        return KillResult(success=False, message=str(e))