import asyncio
import base64
import binascii
from datetime import datetime, timezone
from io import BytesIO
from ipaddress import ip_address
import json
import os
from pathlib import Path
from secrets import choice
import tempfile
from threading import Lock
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from aiohttp import web
from PIL import Image, ImageOps, UnidentifiedImageError


MANIFEST = "project.json"
FOLDERS = ("assets", "cache", "prompts", "exports")
THUMBNAIL = Path("cache") / "thumbnail.jpg"
PRESETS = Path(__file__).parent / "web" / "artwork" / "projects"
LOCK = Lock()


def write_json(path, data):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temp_path = Path(temporary.name)
        try:
            json.dump(data, temporary, ensure_ascii=False, indent=2)
            temporary.close()
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)


def read_json(path):
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def read_catalog(index):
    return read_json(index) if index.is_file() else {}


def directory(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Choose a folder on this computer.")
    path = Path(value.strip()).expanduser()
    if not path.is_absolute() or (os.name == "nt" and path.drive.startswith("\\")):
        raise ValueError("Choose an absolute path on a local drive.")
    path = path.resolve(strict=True)
    if os.name == "nt" and path.drive.startswith("\\"):
        raise ValueError("Choose an absolute path on a local drive.")
    if not path.is_dir():
        raise ValueError("Choose an existing folder.")
    return path


def get_manifest(root):
    path = root / MANIFEST
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 65536:
        raise ValueError("This folder does not contain an SBDS project.")
    data = read_json(path)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("This SBDS project format is not supported.")
    if not isinstance(data.get("id"), str) or UUID(data["id"]).hex != data["id"]:
        raise ValueError("This SBDS project has an invalid ID.")
    if (
        not isinstance(data.get("name"), str) or not 1 <= len(data["name"].strip()) <= 80
        or not isinstance(data.get("description"), str) or len(data["description"]) > 300
        or not isinstance(data.get("created"), str)
        or type(data.get("fps")) is not int or not 1 <= data["fps"] <= 120
    ):
        raise ValueError("This SBDS project has incomplete or invalid details.")
    return {key: data[key] for key in ("version", "id", "name", "description", "created", "fps")}


def list_folders(value):
    current = directory(value) if value else Path.home()
    if os.name == "nt":
        roots = os.listdrives() if hasattr(os, "listdrives") else [Path.home().anchor]
    else:
        roots = ["/"]
    with os.scandir(current) as entries:
        folders = sorted(
            (entry.name for entry in entries if not entry.name.startswith(".") and entry.is_dir(follow_symlinks=False)),
            key=str.casefold,
        )
    return {
        "path": str(current),
        "parent": str(current.parent) if current != current.parent else None,
        "roots": roots,
        "folders": [{"name": name, "path": str(current / name)} for name in folders],
    }


def save_thumbnail(path, encoded):
    if not encoded:
        path.write_bytes((PRESETS / f"thumbnail-{choice(range(1, 5))}.jpg").read_bytes())
        return
    if not isinstance(encoded, str) or len(encoded) > 8_000_000:
        raise ValueError("Choose an image under 6 MB.")
    try:
        data = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as image:
            if image.width * image.height > 24_000_000:
                raise ValueError("Choose an image smaller than 24 megapixels.")
            thumb = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGB"), (800, 500))
            thumb.save(path, "JPEG", quality=88, optimize=True)
    except (binascii.Error, UnidentifiedImageError, Image.DecompressionBombError, OSError) as error:
        raise ValueError("Choose a valid JPG, PNG, or WebP thumbnail.") from error


def create_project(index, data):
    name = data.get("name", "")
    description = data.get("description", "")
    fps = data.get("fps", 24)
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise ValueError("Enter a project name between 1 and 80 characters.")
    name = name.strip()
    if (
        name in (".", "..") or name.endswith(".")
        or any(character in '<>:"/\\|?*' or ord(character) < 32 for character in name)
        or (os.name == "nt" and Path(name).is_reserved())
    ):
        raise ValueError("Use a project name that is valid as a folder name.")
    if not isinstance(description, str) or len(description) > 300:
        raise ValueError("Keep the description to 300 characters.")
    if type(fps) is not int or not 1 <= fps <= 120:
        raise ValueError("Choose a project frame rate between 1 and 120 FPS.")
    root = directory(data.get("path")) / name
    manifest = {
        "version": 1, "id": uuid4().hex, "name": name,
        "description": description.strip(), "fps": fps,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    with LOCK:
        catalog = read_catalog(index)
        root.mkdir()
        created = []
        try:
            for folder in FOLDERS:
                (root / folder).mkdir()
                created.append(root / folder)
            save_thumbnail(root / THUMBNAIL, data.get("thumbnail"))
            write_json(root / MANIFEST, manifest)
            project = {**manifest, "path": str(root)}
            catalog[project["id"]] = project
            write_json(index, catalog)
        except Exception:
            for path in (root / MANIFEST, root / THUMBNAIL, *reversed(created), root):
                try:
                    if path in created or path == root:
                        path.rmdir()
                    else:
                        path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise
    return project


def register_existing(index, data):
    root = directory(data.get("path"))
    project = {**get_manifest(root), "path": str(root)}
    with LOCK:
        catalog = read_catalog(index)
        catalog[project["id"]] = project
        write_json(index, catalog)
    return project


def list_projects(index):
    return sorted(read_catalog(index).values(), key=lambda project: project.get("created", ""), reverse=True)


def open_project(index, project_id):
    project = read_catalog(index).get(project_id)
    if not project:
        raise FileNotFoundError
    root = directory(project["path"])
    current = get_manifest(root)
    if current["id"] != project_id:
        raise ValueError("The project folder no longer matches this card.")
    return {**current, "path": str(root)}


def remove_project(index, project_id):
    with LOCK:
        catalog = read_catalog(index)
        if project_id not in catalog:
            raise FileNotFoundError
        del catalog[project_id]
        write_json(index, catalog)


def thumbnail_path(index, project_id):
    root = Path(open_project(index, project_id)["path"])
    image = (root / THUMBNAIL).resolve(strict=True)
    if image.parent != root / "cache" or not image.is_file():
        raise FileNotFoundError
    return image


def register_project_routes(server):
    routes = server.routes

    def catalog_for(request):
        try:
            peer = ip_address(request.remote)
            host = urlsplit(f"//{request.host}").hostname
        except ValueError as error:
            raise web.HTTPForbidden(text="Open Projects from local ComfyUI.") from error
        if not peer.is_loopback or host not in ("localhost", "127.0.0.1", "::1"):
            raise web.HTTPForbidden(text="Open Projects from local ComfyUI.")
        origin = request.headers.get("Origin")
        if request.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site") or (
            origin and origin != f"{request.scheme}://{request.host}"
        ):
            raise web.HTTPForbidden()
        if request.method in ("POST", "DELETE") and request.headers.get("X-SBDS-Projects") != "1":
            raise web.HTTPForbidden()
        try:
            index = server.user_manager.get_request_user_filepath(request, "sbds/projects.json")
        except KeyError as error:
            raise web.HTTPForbidden() from error
        if index is None:
            raise web.HTTPForbidden()
        return Path(index)

    async def run(operation, *args):
        try:
            return await asyncio.to_thread(operation, *args)
        except FileExistsError as error:
            raise web.HTTPConflict(text="A folder with that name already exists at this location.") from error
        except FileNotFoundError as error:
            raise web.HTTPNotFound(text="That project or folder could not be found.") from error
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        except OSError as error:
            raise web.HTTPBadRequest(text="ComfyUI could not access that folder. Check its permissions.") from error

    async def payload(request):
        try:
            data = await request.json()
        except ValueError as error:
            raise web.HTTPBadRequest(text="Invalid project details.") from error
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(text="Invalid project details.")
        return data

    @routes.get("/sbds/projects/folders")
    async def folders(request):
        catalog_for(request)
        return web.json_response(await run(list_folders, request.query.get("path")))

    @routes.get("/sbds/projects")
    async def projects(request):
        return web.json_response(await run(list_projects, catalog_for(request)))

    @routes.post("/sbds/projects")
    async def create(request):
        index = catalog_for(request)
        return web.json_response(await run(create_project, index, await payload(request)), status=201)

    @routes.post("/sbds/projects/open")
    async def import_project(request):
        index = catalog_for(request)
        return web.json_response(await run(register_existing, index, await payload(request)))

    @routes.get("/sbds/projects/{id}")
    async def open_card(request):
        return web.json_response(await run(open_project, catalog_for(request), request.match_info["id"]))

    @routes.delete("/sbds/projects/{id}")
    async def delete_card(request):
        await run(remove_project, catalog_for(request), request.match_info["id"])
        return web.Response(status=204)

    @routes.get("/sbds/projects/{id}/thumbnail")
    async def thumbnail(request):
        image = await run(thumbnail_path, catalog_for(request), request.match_info["id"])
        return web.FileResponse(image, headers={
            "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        })
