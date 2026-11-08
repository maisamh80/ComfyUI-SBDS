import asyncio
from ipaddress import ip_address
import os
from pathlib import Path
import re
import shutil
import subprocess
from threading import Lock
from urllib.parse import urlsplit

from aiohttp import web


UPSTREAM = "https://github.com/maisamh80/ComfyUI-SBDS.git"
MAIN_REF = "refs/heads/main"


class UpdateError(Exception):
    pass


class Updater:
    def __init__(self, directory, upstream=UPSTREAM):
        self.directory = directory.resolve()
        self.upstream = upstream
        self.lock = Lock()
        self.checked = None
        self.restart_required = False

    def git(self, *args, failure="Git could not read this SBDS installation.", timeout=12):
        executable = shutil.which("git")
        if not executable:
            raise UpdateError("Git is required to update SBDS from Settings.")
        environment = os.environ.copy()
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
            environment.pop(key, None)
        environment.update(GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="Never")
        try:
            result = subprocess.run(
                [executable, "-C", str(self.directory), "-c", f"core.hooksPath={os.devnull}",
                 "-c", "submodule.recurse=false", *args],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=True,
                env=environment,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as error:
            raise UpdateError("Git timed out. Check your connection and try again.") from error
        except (OSError, subprocess.CalledProcessError) as error:
            raise UpdateError(failure) from error
        return result.stdout.strip()

    def head(self):
        if not (self.directory / ".git").exists():
            raise UpdateError("This copy was not installed with Git. Install SBDS with git clone to update here.")
        root = self.git("rev-parse", "--show-toplevel")
        if Path(root).resolve() != self.directory:
            raise UpdateError("SBDS must have its own Git checkout to update here.")
        return self.git("rev-parse", "--verify", "HEAD")

    def verify_checkout(self):
        branch = self.git("branch", "--show-current")
        if branch != "main":
            raise UpdateError("Switch the SBDS checkout to its main branch before updating.")
        if self.git("status", "--porcelain", "--untracked-files=normal"):
            raise UpdateError("The SBDS folder has local changes. Save or commit them before updating.")

    def status(self):
        with self.lock:
            current = self.head()
            latest = self.checked[1] if self.checked and self.checked[0] == current else None
            return {"current": current, "latest": latest, "restartRequired": self.restart_required}

    def check(self):
        with self.lock:
            current = self.head()
            if self.restart_required:
                return {"current": current, "latest": None, "restartRequired": True}
            self.checked = None
            output = self.git(
                "ls-remote", "--exit-code", self.upstream, MAIN_REF, timeout=25,
                failure="Could not check GitHub. Check your internet connection and Git access to ComfyUI-SBDS.",
            )
            latest = output.partition("\t")[0]
            if not re.fullmatch("[0-9a-f]{40}", latest):
                raise UpdateError("GitHub did not return a valid update.")
            self.checked = (current, latest)
            return {"current": current, "latest": latest, "restartRequired": False}

    def apply(self):
        with self.lock:
            current = self.head()
            if self.restart_required:
                return {"current": current, "latest": None, "restartRequired": True}
            if not self.checked or self.checked[0] != current or self.checked[1] == current:
                raise UpdateError("Check for updates again before installing.")
            target = self.checked[1]
            self.verify_checkout()
            self.git(
                "fetch", "--no-tags", "--no-recurse-submodules", self.upstream, MAIN_REF, timeout=45,
                failure="Could not download the update. Check your internet connection and Git access.",
            )
            if self.git("rev-parse", "--verify", "FETCH_HEAD") != target or self.head() != current:
                self.checked = None
                raise UpdateError("The available version changed. Check for updates again.")
            self.verify_checkout()
            self.git(
                "merge-base", "--is-ancestor", current, target,
                failure="This checkout has commits outside GitHub main. Reconcile them before updating.",
            )
            self.git(
                "merge", "--ff-only", target,
                failure="Git could not fast-forward this checkout. Check its local commits before updating.",
            )
            self.restart_required = True
            self.checked = None
            return {"current": target, "latest": None, "restartRequired": True}


def register_update_routes(server):
    updater = Updater(Path(__file__).parent)
    routes = server.routes

    async def run(request, operation):
        try:
            peer = ip_address(request.remote)
            host = urlsplit(f"//{request.host}").hostname
        except ValueError as error:
            raise web.HTTPForbidden(text="Open Updates from local ComfyUI.") from error
        origin = request.headers.get("Origin")
        if (
            not peer.is_loopback or host not in ("localhost", "127.0.0.1", "::1")
            or request.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site")
            or (origin and origin != f"{request.scheme}://{request.host}")
            or (request.method == "POST" and request.headers.get("X-SBDS-Update") != "1")
        ):
            raise web.HTTPForbidden(text="Open Updates from local ComfyUI.")
        try:
            result = await asyncio.to_thread(operation)
        except UpdateError as error:
            raise web.HTTPConflict(text=str(error)) from error
        return web.json_response(result, headers={"Cache-Control": "no-store"})

    @routes.get("/sbds/update")
    async def status(request):
        return await run(request, updater.status)

    @routes.post("/sbds/update/check")
    async def check(request):
        return await run(request, updater.check)

    @routes.post("/sbds/update/apply")
    async def apply(request):
        return await run(request, updater.apply)
