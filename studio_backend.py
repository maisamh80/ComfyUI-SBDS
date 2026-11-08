import mimetypes
from io import BytesIO
from pathlib import Path
import re
from shutil import copyfileobj
import wave
from zipfile import ZipFile
from uuid import uuid4

import av
import folder_paths
import numpy as np
from aiohttp import web

from .audio_export import saved_take_path
from .projects import LOCK, open_project, read_catalog, write_json


RATE = 48000
MAX_TIME = 600
MAX_MEDIA = 64 * 1024 * 1024
AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".ogg", ".opus", ".m4a", ".aac", ".aiff"}
COLORS = ("mint", "blue", "lilac", "rose", "amber", "cyan", "orange", "slate")
TRACK_TYPES = ("dialogue", "music", "sfx")


def child_folder(root, name):
    path = root / name
    if path.resolve() != path or not path.is_dir():
        raise ValueError(f"The project needs its original {name} folder.")
    return path


def record_file(folder, name):
    path = folder / name
    if path.is_symlink():
        raise ValueError("Project metadata must be stored inside the project.")
    return path


def project_root(index, project_id):
    return Path(open_project(index, project_id)["path"])


def field(value, low, high):
    if type(value) not in (int, float) or not low <= value <= high:
        raise ValueError("A timeline setting is outside its allowed range.")
    return value


def string(value, length):
    if not isinstance(value, str) or len(value) > length:
        raise ValueError("A timeline text field is invalid.")
    return value


def validate_timeline(data):
    tracks = data.get("tracks")
    if data.get("version") != 1 or not isinstance(tracks, list) or len(tracks) > 24:
        raise ValueError("This timeline format is invalid or has more than 24 tracks.")
    result = []
    ids = set()

    def identifier(value):
        value = string(value, 80)
        if not value or value in ids:
            raise ValueError("Timeline track and clip IDs must be unique.")
        ids.add(value)
        return value

    for track in tracks:
        if not isinstance(track, dict) or track.get("kind") not in TRACK_TYPES:
            raise ValueError("A timeline track is invalid.")
        clips = track.get("clips")
        if not isinstance(clips, list) or len(clips) > 80:
            raise ValueError("A track can hold up to 80 clips.")
        clean = {
            "id": identifier(track.get("id")), "kind": track["kind"],
            "name": string(track.get("name"), 80), "muted": bool(track.get("muted")),
            "solo": bool(track.get("solo")),
            "color": track["color"] if track.get("color") in COLORS else "mint",
            "clips": [],
        }
        for clip in clips:
            if not isinstance(clip, dict):
                raise ValueError("A timeline clip is invalid.")
            start = field(clip.get("start"), 0, MAX_TIME)
            duration = field(clip.get("duration"), 0.01, MAX_TIME)
            if start + duration > MAX_TIME + 0.000001:
                raise ValueError("The timeline can be up to 10 minutes long.")
            refs = clip.get("refs", [])
            if not isinstance(refs, list) or len(refs) > 2:
                raise ValueError("Choose up to two voice references.")
            clean["clips"].append({
                "id": identifier(clip.get("id")), "name": string(clip.get("name"), 80),
                "start": start, "duration": duration, "offset": field(clip.get("offset", 0), 0, MAX_TIME),
                "gain": field(clip.get("gain", 0), -60, 12),
                "fadeIn": field(clip.get("fadeIn", 0), 0, duration),
                "fadeOut": field(clip.get("fadeOut", 0), 0, duration),
                "color": clip["color"] if clip.get("color") in COLORS else "",
                "media": string(clip.get("media", ""), 80),
                "prompt": string(clip.get("prompt", ""), 16000),
                "refs": [string(ref, 80) for ref in refs],
                "generation": validate_generation(clip.get("generation", {})),
            })
        result.append(clean)
    return {"version": 1, "tracks": result}


def validate_generation(value):
    if not isinstance(value, dict):
        raise ValueError("These generation settings are invalid.")
    seed = value.get("seed", "")
    if seed != "":
        if not isinstance(seed, str) or not seed.isascii() or not seed.isdecimal() or len(seed) > 10:
            raise ValueError("Choose a valid fixed seed.")
        seed = str(int(field(int(seed), 0, 2 ** 32 - 1)))
    seed_mode = value.get("seedMode", "fixed" if seed else "random")
    if seed_mode not in ("random", "fixed"):
        raise ValueError("Choose Random or Fixed seed mode.")
    return {
        "seedMode": seed_mode,
        "steps": int(field(value.get("steps", 8), 1, 100)),
        "cfg": field(value.get("cfg", 1), 0, 20),
        "seed": seed or ("0" if seed_mode == "fixed" else ""),
        "sampler": string(value.get("sampler", ""), 120),
        "scheduler": string(value.get("scheduler", ""), 120),
        "negative": string(value.get("negative", ""), 8000),
    }


def timeline_path(root):
    return record_file(child_folder(root, "prompts"), "studio.json")


def studio_media(assets):
    path = record_file(assets, "studio-media.json")
    return path, read_catalog(path)


def audio_duration(source):
    try:
        with av.open(source) as container:
            if not container.streams.audio:
                raise ValueError("Choose a file with an audio stream.")
            stream = container.streams.audio[0]
            duration = float(stream.duration * stream.time_base) if stream.duration is not None else (container.duration or 0) / av.time_base
            if duration <= 0:
                duration = sum(frame.samples / frame.sample_rate for frame in container.decode(stream))
    except av.error.FFmpegError as error:
        raise ValueError("This audio file could not be read.") from error
    if not 0 < duration <= MAX_TIME + 1:
        raise ValueError("Choose audio between zero and ten minutes long.")
    return duration


def asset_path(assets, filename):
    if not isinstance(filename, str) or Path(filename).name != filename or Path(filename).suffix.lower() not in AUDIO_SUFFIXES:
        raise ValueError("This audio asset has an invalid path.")
    path = (assets / filename).resolve(strict=True)
    if path.parent != assets or not path.is_file():
        raise FileNotFoundError
    return path


def studio_asset_path(assets, entry):
    folder = child_folder(assets.parent, "cache") if entry.get("origin") == "generated" else assets
    return asset_path(folder, entry["file"])


def media_catalog(root):
    assets = child_folder(root, "assets")
    _, studio_entries = studio_media(assets)
    result = dict(studio_entries)
    for entry in read_catalog(record_file(assets, "library.json")).values():
        try:
            source = asset_path(assets, entry["file"])
            result[entry["id"]] = {**entry, "duration": audio_duration(str(source)), "library": True}
        except (FileNotFoundError, ValueError):
            continue
    return assets, result


def open_session(index, project_id):
    root = project_root(index, project_id)
    path = timeline_path(root)
    data = read_catalog(path)
    timeline = validate_timeline(data) if data else {"version": 1, "tracks": []}
    return {"timeline": timeline, "media": list(media_catalog(root)[1].values())}


def save_session(index, project_id, data):
    clean = validate_timeline(data)
    with LOCK:
        write_json(timeline_path(project_root(index, project_id)), clean)


def save_fps(index, project_id, data):
    fps = data.get("fps")
    if type(fps) is not int or not 1 <= fps <= 120:
        raise ValueError("Choose a project frame rate between 1 and 120 FPS.")
    with LOCK:
        project = open_project(index, project_id)
        root = Path(project.pop("path"))
        project["fps"] = fps
        write_json(record_file(root, "project.json"), project)
    return {"fps": fps}


def add_media(root, name, suffix, duration, write, *, origin):
    assets = child_folder(root, "assets")
    media_id = uuid4().hex
    filename = f"studio-{media_id}{suffix}"
    folder = child_folder(root, "cache") if origin == "generated" else assets
    path = folder / filename
    entry = {"id": media_id, "file": filename, "name": name, "duration": duration, "library": False, "origin": origin}
    with LOCK:
        index, library = studio_media(assets)
        try:
            write(path)
            library[media_id] = entry
            write_json(index, library)
        except Exception:
            path.unlink(missing_ok=True)
            raise
    return entry


def import_media(index, project_id, filename, data):
    suffix = Path(filename).suffix.lower()
    if suffix not in AUDIO_SUFFIXES or not data or len(data) > MAX_MEDIA:
        raise ValueError("Choose a supported audio file under 64 MB.")
    duration = audio_duration(BytesIO(data))
    return add_media(
        project_root(index, project_id), Path(filename).stem[:80], suffix, duration,
        lambda path: path.write_bytes(data), origin="imported",
    )


def read_audio(path, skip, limit):
    chunks = []
    with av.open(str(path)) as container:
        convert = av.AudioResampler(format="fltp", layout="stereo", rate=RATE)
        stream = container.streams.audio[0]
        for frame in container.decode(stream):
            for output in convert.resample(frame):
                samples = output.to_ndarray().T
                if skip >= len(samples):
                    skip -= len(samples)
                    continue
                samples = samples[skip:skip + limit]
                skip = 0
                chunks.append(samples)
                limit -= len(samples)
                if not limit:
                    return np.concatenate(chunks)
        for output in convert.resample(None):
            samples = output.to_ndarray().T
            if skip < len(samples):
                chunks.append(samples[skip:skip + limit])
                break
            skip -= len(samples)
    return np.concatenate(chunks) if chunks else np.empty((0, 2), dtype=np.float32)


def write_wav(path, samples):
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        for start in range(0, len(samples), RATE * 4):
            chunk = samples[start:start + RATE * 4]
            output.writeframes(np.rint(np.clip(chunk, -1, 1) * 32767).astype("<i2").tobytes())


def save_take(index, project_id, data):
    name = string(data.get("name"), 80)
    parts = data.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 31:
        raise ValueError("This take has too many sections.")
    chunks = []
    total = 0
    for part in parts:
        if not isinstance(part, dict):
            raise ValueError("This take has an invalid section.")
        count = round(field(part.get("duration"), 0.01, 60) * RATE)
        total += count
        if total > RATE * 120:
            raise ValueError("A generated take can be up to two minutes long.")
        samples = np.zeros((count, 2), dtype=np.float32)
        if not part.get("silence"):
            audio = read_audio(saved_take_path(part.get("filename")), 0, count)
            samples[:len(audio)] = audio
        chunks.append(samples)
    return add_media(
        project_root(index, project_id), name, ".wav", total / RATE,
        lambda path: write_wav(path, np.concatenate(chunks)), origin="generated",
    )


def stage_reference(index, project_id, media_id):
    if not re.fullmatch("[0-9a-f]{32}", media_id):
        raise ValueError("Choose a voice from the project library.")
    assets, library = media_catalog(project_root(index, project_id))
    entry = library.get(media_id)
    if not entry or not entry.get("library"):
        raise ValueError("Choose a voice from the project library.")
    source = asset_path(assets, entry["file"])
    inputs = Path(folder_paths.get_input_directory()).resolve()
    staging = inputs / "SBDS-studio"
    staging.mkdir(exist_ok=True)
    if staging.resolve() != staging:
        raise ValueError("The ComfyUI reference folder must be inside its input folder.")
    relative = f"SBDS-studio/ref-{media_id}.flac"
    target = inputs / relative
    with LOCK:
        if target.is_symlink():
            raise ValueError("The reference file must be inside the ComfyUI input folder.")
        if not target.exists():
            try:
                with source.open("rb") as original, target.open("xb") as copy:
                    copyfileobj(original, copy)
            except Exception:
                target.unlink(missing_ok=True)
                raise
    return relative


def mix_track(track, assets, media, frames, destination):
    for clip in track["clips"]:
        if not clip["media"]:
            continue
        item = media.get(clip["media"])
        if not item:
            raise ValueError(f'Missing audio for “{clip["name"]}”. Remove that clip before exporting.')
        length = round(clip["duration"] * RATE)
        audio = read_audio(studio_asset_path(assets, item), round(clip["offset"] * RATE), length)
        start = round(clip["start"] * RATE)
        audio = audio[:max(0, frames - start)].copy()
        audio *= 10 ** (clip["gain"] / 20)
        fade_in = round(clip["fadeIn"] * RATE)
        fade_out = round(clip["fadeOut"] * RATE)
        if fade_in:
            fade = min(len(audio), fade_in)
            audio[:fade] *= (np.arange(fade, dtype=np.float32) / fade_in)[:, None]
        if fade_out:
            first = min(len(audio), max(0, length - fade_out))
            audio[first:] *= ((length - np.arange(first, len(audio), dtype=np.float32)) / fade_out)[:, None]
        destination[start:start + len(audio)] += audio


def render_export(index, project_id, data, stems):
    root = project_root(index, project_id)
    timeline = validate_timeline(data)
    assets, media = media_catalog(root)
    tracks = timeline["tracks"]
    any_solo = any(track["solo"] for track in tracks)
    audible = [track for track in tracks if not track["muted"] and (not any_solo or track["solo"])]
    length = max((clip["start"] + clip["duration"] for track in tracks for clip in track["clips"]), default=0)
    if not any(clip["media"] for track in audible for clip in track["clips"]):
        raise ValueError("Add an audible clip before exporting.")
    frames = round(length * RATE)
    samples = np.zeros((frames, 2), dtype=np.float32)
    exports = child_folder(root, "exports")
    stamp = uuid4().hex[:8]
    output = exports / (f"Stems-{stamp}.zip" if stems else f"Mixdown-{stamp}.wav")
    try:
        if stems:
            cache = child_folder(root, "cache")
            temporary = cache / f"stem-{stamp}.wav"
            try:
                with ZipFile(output, "x") as archive:
                    for number, track in enumerate(audible, 1):
                        if not any(clip["media"] for clip in track["clips"]):
                            continue
                        samples.fill(0)
                        mix_track(track, assets, media, frames, samples)
                        write_wav(temporary, samples)
                        name = "".join(c if c.isalnum() or c in " _-" else "_" for c in track["name"])
                        archive.write(temporary, f"{number:02d}-{name or 'Track'}.wav")
            finally:
                temporary.unlink(missing_ok=True)
        else:
            for track in audible:
                mix_track(track, assets, media, frames, samples)
            write_wav(output, samples)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return output


def register_studio_routes(routes, catalog_for, run, payload):
    base = "/sbds/projects/{id}/studio"

    @routes.get(base)
    async def open_studio(request):
        return web.json_response(await run(open_session, catalog_for(request), request.match_info["id"]))

    @routes.post(base)
    async def save_studio(request):
        await run(save_session, catalog_for(request), request.match_info["id"], await payload(request))
        return web.Response(status=204)

    @routes.post(base + "/fps")
    async def frame_rate(request):
        result = await run(save_fps, catalog_for(request), request.match_info["id"], await payload(request))
        return web.json_response(result)

    @routes.get(base + "/media/{media}")
    async def get_media(request):
        def locate(index, project_id, media_id):
            assets, items = media_catalog(project_root(index, project_id))
            if media_id not in items:
                raise FileNotFoundError
            return studio_asset_path(assets, items[media_id])

        path = await run(locate, catalog_for(request), request.match_info["id"], request.match_info["media"])
        return web.FileResponse(path, headers={"Content-Type": mimetypes.guess_type(path)[0] or "application/octet-stream",
                                               "X-Content-Type-Options": "nosniff"})

    @routes.post(base + "/media")
    async def add_audio(request):
        index = catalog_for(request)
        data = await request.read()
        item = await run(import_media, index, request.match_info["id"], request.query.get("filename", ""), data)
        return web.json_response(item, status=201)

    @routes.post(base + "/take")
    async def add_take(request):
        item = await run(save_take, catalog_for(request), request.match_info["id"], await payload(request))
        return web.json_response(item, status=201)

    @routes.post(base + "/reference/{media}")
    async def prepare_reference(request):
        path = await run(stage_reference, catalog_for(request), request.match_info["id"], request.match_info["media"])
        return web.json_response({"input": path})

    @routes.post(base + "/export")
    async def export(request):
        path = await run(render_export, catalog_for(request), request.match_info["id"], await payload(request),
                         request.query.get("mode") == "stems")
        return web.FileResponse(path, headers={"Content-Disposition": f'attachment; filename="{path.name}"'})
