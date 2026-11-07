import asyncio
import csv
import shutil
import subprocess

import psutil
from aiohttp import web


NVIDIA_SMI = shutil.which("nvidia-smi")


def gpu_stats():
    if not NVIDIA_SMI:
        return {}
    try:
        result = subprocess.run(
            [
                NVIDIA_SMI,
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            errors="replace",
            check=True,
            timeout=2,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        name, usage, used, total = next(csv.reader(result.stdout.splitlines(), skipinitialspace=True))
    except (OSError, subprocess.SubprocessError, StopIteration, ValueError):
        return {}

    stats = {"gpuName": name}
    if usage.isdecimal():
        stats["gpu"] = int(usage)
    if used.isdecimal() and total.isdecimal() and int(total) > 0:
        stats["vram"] = 100 * int(used) / int(total)
        stats["vramUsedMiB"] = int(used)
        stats["vramTotalMiB"] = int(total)
    return stats


def read_resources():
    memory = psutil.virtual_memory()
    return {
        "cpu": psutil.cpu_percent(interval=0.1),
        "ram": memory.percent,
        "ramUsedMiB": (memory.total - memory.available) // 1048576,
        "ramTotalMiB": memory.total // 1048576,
        **gpu_stats(),
    }


async def resource_stats(_request):
    return web.json_response(
        await asyncio.to_thread(read_resources), headers={"Cache-Control": "no-store"}
    )
