import asyncio
from io import BytesIO
from pathlib import Path
import re

import av
from aiohttp import web

import folder_paths


TAKE_NAME = re.compile(r"take_[0-9]+_?\.flac")
EXPORTS = {
    "flac": ("audio/flac", {"lossless"}),
    "wav": ("audio/wav", {"16", "24"}),
    "mp3": ("audio/mpeg", {"128", "192", "256", "320"}),
    "opus": ("audio/ogg", {"64", "96", "128", "192", "256"}),
}


def audio_encoder(container, format_name, quality, rate, layout):
    codec = {"wav": f"pcm_s{quality}le", "flac": "flac", "mp3": "libmp3lame", "opus": "libopus"}[format_name]
    output = container.add_stream(codec, rate=rate)
    output.layout = layout
    if format_name in ("mp3", "opus"):
        output.bit_rate = int(quality) * 1000
    return output


def encode_take(path, format_name, quality):
    buffer = BytesIO()
    with av.open(str(path), format="flac") as source:
        audio = source.streams.audio[0]
        rate = audio.rate
        if format_name == "opus" or (format_name == "mp3" and rate not in (32000, 44100, 48000)):
            rate = 48000
        with av.open(buffer, mode="w", format=format_name) as target:
            output = audio_encoder(target, format_name, quality, rate, audio.layout.name)
            for frame in source.decode(audio):
                target.mux(output.encode(frame))
            target.mux(output.encode())
    return buffer.getvalue()


def saved_take_path(filename):
    if not isinstance(filename, str) or not TAKE_NAME.fullmatch(filename):
        raise ValueError("Choose a saved SBDS take.")
    output_dir = Path(folder_paths.get_output_directory()).resolve()
    take_dir = output_dir / "audio" / "SBDS"
    path = (take_dir / filename).resolve()
    if path.parent != take_dir or not path.is_file():
        raise FileNotFoundError("The original SBDS take is no longer available.")
    return path


async def export_audio(request):
    filename = request.query.get("filename", "")
    format_name = request.query.get("format", "")
    quality = request.query.get("quality", "")
    if format_name not in EXPORTS or quality not in EXPORTS[format_name][1]:
        raise web.HTTPBadRequest(text="Choose a supported format and quality.")
    try:
        path = saved_take_path(filename)
    except ValueError as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except FileNotFoundError as error:
        raise web.HTTPNotFound(text=str(error)) from error

    headers = {
        "Content-Disposition": f'attachment; filename="{path.stem}.{format_name}"',
        "Cache-Control": "no-store",
    }
    content_type = EXPORTS[format_name][0]
    if format_name == "flac":
        headers["Content-Type"] = content_type
        return web.FileResponse(path, headers=headers)
    try:
        audio = await asyncio.to_thread(encode_take, path, format_name, quality)
    except av.error.FileNotFoundError as error:
        raise web.HTTPNotFound(text="The original SBDS take is no longer available.") from error
    except (av.error.FFmpegError, ValueError, IndexError) as error:
        raise web.HTTPUnprocessableEntity(text="ComfyUI could not encode this take in the selected format.") from error
    return web.Response(body=audio, headers=headers, content_type=content_type)
