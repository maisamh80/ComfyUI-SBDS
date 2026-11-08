import { compilePrompt, queueStudioTake, referenceSetup, studioGraph } from "./studio_generation.js";
import { createTimelinePlayback } from "./timeline_playback.js";
import { audioExportFields, bindAudioExportFields } from "./audio.js";
import { bindCueEditor, cueEditorView } from "./cue_editor.js";

const transportIcon = name => new URL(`./artwork/${name}.svg`, import.meta.url).href;

const colors = ["mint", "blue", "lilac", "rose", "amber", "cyan", "orange", "slate"];
const kinds = { dialogue: "Dialogue", music: "Music", sfx: "Sound Effects" };
const timeLimit = 1200;
const clipTimingFields = new Set(["start", "duration", "offset", "fadeIn", "fadeOut"]);
const rulerIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300];

export const studioView = `
    <div class="sbds-project-heading">
        <div><p class="sbds-label">STUDIO</p><h1 data-active-project>Studio</h1>
            <p data-active-project-description>Open a project to start working in Studio.</p></div>
        <div data-studio-tools hidden>
            <div class="sbds-actions">
                <label class="sbds-studio-fps">Project FPS<input type="number" data-studio-fps min="1" max="120" step="1"></label>
                <button type="button" class="sbds-primary" data-studio-mix>Export Mix</button>
                <button type="button" class="sbds-primary" data-studio-stems>Export Multi Track</button>
            </div>
            <div class="sbds-export" role="group" aria-label="Studio audio export">${audioExportFields}</div>
        </div>
    </div>
    <p data-studio-status class="sbds-project-status" role="status" hidden></p>
    <div data-studio-body hidden>
        <div class="sbds-reference-preview" data-reference-preview hidden>
            <video data-reference-video preload="metadata" playsinline aria-label="Reference video"></video>
        </div>
        <div class="sbds-timeline-toolbar">
            <div class="sbds-actions sbds-timeline-tracks">
                <select data-new-track-type aria-label="Track type">${Object.entries(kinds).map(([key, title]) => `<option value="${key}">${title}</option>`).join("")}</select>
                <button type="button" data-studio-track>+ Track</button>
                <button type="button" data-studio-import>Import audio</button>
                <input type="file" data-studio-file accept="audio/*,.flac,.wav,.mp3,.ogg,.opus,.m4a,.aac,.aiff" hidden>
                <button type="button" data-studio-import-video>Import video</button>
                <input type="file" data-studio-video-file accept=".mp4,.webm" hidden>
            </div>
            <div class="sbds-actions sbds-timeline-transport">
                <span data-studio-time>00:00:00</span>
                <button type="button" class="sbds-icon-button" data-studio-play aria-label="Play timeline" title="Play timeline (Space)">
                    <img src="${transportIcon("play")}" alt="">
                </button>
                <input type="range" data-studio-zoom aria-label="Timeline zoom" title="Timeline zoom" min="0" max="100" step="1" value="50">
            </div>
            <button type="button" class="sbds-primary" data-studio-generate-all>Generate All</button>
        </div>
        <div class="sbds-timeline-scroll" data-timeline-scroll>
            <div class="sbds-timeline" data-timeline></div>
        </div>
        <div class="sbds-progress" data-studio-progress hidden>
            <progress max="1" value="0" aria-label="Studio generation progress"></progress><span data-studio-elapsed></span>
        </div>
        <div class="sbds-inspector-scroll" data-inspector-scroll hidden>
            <fieldset class="sbds-clip-inspector" data-clip-inspector hidden>
                <legend>Clip settings</legend>
                <div class="sbds-fields">
                    <label>Clip name<input data-clip="name" maxlength="80"></label>
                    <label>Start (s:ff)<input data-clip="start" maxlength="14" title="Seconds and frames, or decimal seconds"></label>
                    <label>Duration (s:ff)<input data-clip="duration" maxlength="14" title="Seconds and frames, or decimal seconds"></label>
                    <label>Source offset (s:ff)<input data-clip="offset" maxlength="14" title="Seconds and frames, or decimal seconds"></label>
                    <label>Gain (dB)<input type="number" data-clip="gain" min="-60" max="12" step="0.1"></label>
                    <label>Fade in (s:ff)<input data-clip="fadeIn" maxlength="14" title="Seconds and frames, or decimal seconds"></label>
                    <label>Fade out (s:ff)<input data-clip="fadeOut" maxlength="14" title="Seconds and frames, or decimal seconds"></label>
                </div>
                <div data-generation-editor hidden>
                    ${cueEditorView}
                    <div data-studio-dialogue>
                        <div class="sbds-fields">
                            <label>Speaker 1 reference<select data-reference="0"></select></label>
                            <label>Speaker 2 reference<select data-reference="1"></select></label>
                        </div>
                        <p class="sbds-project-hint">For two voices, label lines Speaker 1 and Speaker 2. A cue such as [pause:3s] asks LTX for a timed pause.</p>
                    </div>
                    <details><summary>Generation settings</summary>
                        <div class="sbds-fields">
                            <label>Seed mode<select data-generation="seedMode"><option value="random">Random</option><option value="fixed">Fixed</option></select></label>
                            <label>Seed<input data-generation="seed" type="number" min="0" max="4294967295" placeholder="Random"></label>
                            <label>Steps<input data-generation="steps" type="number" min="1" max="100"></label>
                            <label>CFG<input data-generation="cfg" type="number" min="0" max="20" step="0.1"></label>
                            <label>Sampler<select data-generation="sampler"></select></label>
                            <label>Scheduler<select data-generation="scheduler"></select></label>
                        </div>
                        <label>Negative prompt<textarea data-generation="negative" rows="2" maxlength="8000"></textarea></label>
                    </details>
                </div>
                <div class="sbds-actions">
                    <button type="button" class="sbds-primary" data-studio-generate>Generate clip</button>
                    <button type="button" data-studio-final-prompt>Final Prompt</button>
                    <button type="button" class="sbds-primary" data-studio-regenerate hidden>Generate Again</button>
                    <button type="button" data-studio-delete-clip>Remove clip</button>
                    <label data-last-seed hidden>Last used seed<input readonly aria-label="Last used seed"></label>
                </div>
            </fieldset>
        </div>
    </div>

    <div class="sbds-color-palette" data-color-palette popover="auto" role="group" aria-label="Timeline colors"></div>
    <dialog class="sbds-prompt-editor sbds-studio-prompt" aria-label="Final Prompt">
        <form method="dialog">
            <h2>Final Prompt</h2>
            <p>Review the text sent to LTX for this clip.</p>
            <textarea rows="9" aria-label="Final prompt" readonly></textarea>
            <button type="submit">Close</button>
        </form>
    </dialog>
`;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const uuid = () => crypto.randomUUID();
const elapsedTime = (time) => `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, "0")}`;
const frameAt = (time, fps) => Math.floor(time * fps + 1e-7);
const nearestFrame = (seconds, fps) => Math.round(seconds * fps);

function formatClipTime(seconds, fps) {
    const frames = nearestFrame(seconds, fps);
    const remainder = String(frames % fps).padStart(fps > 100 ? 3 : 2, "0");
    return `${Math.floor(frames / fps)}:${remainder}`;
}

function parseClipTime(value, fps) {
    const text = value.trim();
    const timecode = /^(\d+):(\d{1,3})$/.exec(text);
    if (timecode) {
        const frames = Number(timecode[2]);
        return frames < fps ? Number(timecode[1]) + frames / fps : NaN;
    }
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
}

function timecode(time, fps) {
    const frame = frameAt(time, fps);
    const seconds = Math.floor(frame / fps);
    const minutesText = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secondsText = String(seconds % 60).padStart(2, "0");
    const framesText = String(frame % fps).padStart(fps > 100 ? 3 : 2, "0");
    return `${minutesText}:${secondsText}:${framesText}`;
}
const audibleTracks = tracks => tracks.filter(track => !track.muted && (!tracks.some(item => item.solo) || track.solo));
const studioDefaults = { sampler: "uni_pc", scheduler: "simple" };

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (tag === "button") node.type = "button";
    return node;
}

function choiceList(select, values, empty, value, missingLabel = "Missing audio") {
    select.replaceChildren(new Option(empty, ""), ...values.map(([id, name]) => new Option(name, id)));
    select.value = value ?? "";
    if (value && !select.value) select.add(new Option(`${missingLabel}: ${value}`, value, false, true));
}

export function createStudioTimeline(section, api, request, modelSettings, referenceSettings, generationOptions) {
    const get = selector => section.querySelector(selector);
    const body = get("[data-studio-body]");
    const tools = get("[data-studio-tools]");
    const status = get("[data-studio-status]");
    const timeline = get("[data-timeline]");
    const timelineScroll = get("[data-timeline-scroll]");
    const exportFields = bindAudioExportFields(tools);
    const cueEditor = bindCueEditor(section);
    const inspector = get("[data-clip-inspector]");
    const colorPalette = get("[data-color-palette]");
    const finalPrompt = get(".sbds-studio-prompt");
    const inspectorScroll = get("[data-inspector-scroll]");
    const zoom = get("[data-studio-zoom]");
    const play = get("[data-studio-play]");
    const progress = get("[data-studio-progress]");
    const progressBar = progress.querySelector("progress");
    const file = get("[data-studio-file]");
    const videoFile = get("[data-studio-video-file]");
    const video = get("[data-reference-video]");
    const preview = get("[data-reference-preview]");
    let active;
    let selected;
    let regenerateClip;
    let playhead = 0;
    let scale = 48;
    let rulerLength = 24;
    let playheadHandle;
    let running = false;
    let playbackTicket = 0;
    let jobId;
    let busy = false;

    function showPlaybackState(playing) {
        running = playing;
        const action = playing ? "Pause" : "Play";
        play.querySelector("img").src = transportIcon(action.toLowerCase());
        play.setAttribute("aria-label", `${action} timeline`);
        play.title = `${action} timeline (Space)`;
    }

    const playback = createTimelinePlayback(setPlayhead, () => {
        video.pause();
        showPlaybackState(false);
    });

    function message(text = "", error = false) {
        status.textContent = text;
        status.dataset.error = String(error);
        status.hidden = !text;
    }

    function route(session, suffix = "") {
        return `/sbds/projects/${encodeURIComponent(session.project.id)}/studio${suffix}`;
    }

    async function service(session, suffix = "", data, raw = false, method = data === undefined ? "GET" : "POST") {
        const options = method === "GET" ? {} : { method, headers: { "X-SBDS-Projects": "1" } };
        if (method === "POST") {
            if (raw) options.body = data;
            else {
                options.headers["Content-Type"] = "application/json";
                options.body = JSON.stringify(data);
            }
        }
        const response = await api.fetchApi(route(session, suffix), options);
        if (!response.ok) {
            const detail = (await response.text()).trim();
            if (response.status === 405 || (response.status === 404 && (!detail || detail === "404: Not Found"))) {
                throw new Error("Restart ComfyUI to load Studio.");
            }
            throw new Error(detail || "The Studio request failed.");
        }
        if (suffix.startsWith("/export")) return response;
        return response.status === 204 ? null : response.json();
    }

    function stopPlayback() {
        ++playbackTicket;
        playback.stop();
    }

    function videoMonitor(session = active) {
        const monitor = session.timeline.videoMonitor;
        return monitor && monitor.id === session.video?.id ? monitor
            : { id: session.video?.id, muted: false, solo: false };
    }

    function videoRoute(item) {
        return "/video/" + encodeURIComponent(item.id);
    }

    function syncVideo() {
        if (!active?.video || video.readyState < 1) return;
        if (running && (video.seeking || (video.ended && playhead >= video.duration))) return;
        const target = clamp(playhead, 0, Math.max(0, video.duration - 0.001));
        const tolerance = running && !video.paused ? Math.max(1.5 / active.project.fps, 0.05) : 0.001;
        if (Math.abs(video.currentTime - target) > tolerance) video.currentTime = target;
    }

    function clearVideo() {
        if (!video.hasAttribute("src")) return;
        video.removeAttribute("src");
        video.load();
    }

    video.addEventListener("loadedmetadata", syncVideo);
    video.addEventListener("error", () => {
        if (video.hasAttribute("src")) message("The browser could not play this reference video.", true);
    });

    function setPlayhead(value) {
        playhead = clamp(value, 0, timeLimit);
        const label = timecode(playhead, active?.project.fps || 24);
        get("[data-studio-time]").textContent = label;
        timeline.style.setProperty("--playhead", `${playhead * scale}px`);
        if (playheadHandle) {
            playheadHandle.setAttribute("aria-valuenow", String(Number(playhead.toFixed(3))));
            playheadHandle.setAttribute("aria-valuetext", label);
        }
        syncVideo();
    }

    function flush(session) {
        clearTimeout(session.timer);
        if (!session.dirty) return session.save;
        session.dirty = false;
        const snapshot = JSON.parse(JSON.stringify(session.timeline));
        session.save = session.save.catch(() => {}).then(() => service(session, "", snapshot))
            .catch(error => {
                session.dirty = true;
                if (active === session) message(`Could not save timeline: ${error.message}`, true);
                throw error;
            });
        return session.save;
    }

    function changed(session = active) {
        session.dirty = true;
        clearTimeout(session.timer);
        session.timer = setTimeout(() => { void flush(session).catch(() => {}); }, 450);
    }

    function newTrack(kind) {
        return { id: uuid(), kind, name: kinds[kind], color: colors[Object.keys(kinds).indexOf(kind)], muted: false, solo: false, clips: [] };
    }

    function newClip(track, media) {
        const fps = active.project.fps;
        const duration = media ? Math.ceil(media.duration * fps - 1e-7) / fps : 5;
        const clip = {
            id: uuid(), name: media?.name || `${kinds[track.kind]} clip`, media: media?.id || "",
            start: playhead, duration, offset: 0,
            gain: 0, fadeIn: 0, fadeOut: 0, color: "", prompt: "", refs: [],
            generation: { seedMode: "random", seed: "", steps: 8, cfg: 1, negative: "" },
        };
        const options = generationOptions();
        const settings = modelSettings();
        for (const [key, preferred] of Object.entries(studioDefaults)) {
            clip.generation[key] = options[key]?.includes(preferred) ? preferred : settings[key] || "";
        }
        constrain(clip, fps);
        return clip;
    }

    async function open(project) {
        if (active?.project.id === project?.id && active?.project.path === project?.path) {
            if (active?.timeline) {
                try {
                    const session = active;
                    const fresh = await service(session);
                    if (active === session && !busy) {
                        session.media = fresh.media;
                        session.video = fresh.video;
                        render();
                    }
                } catch (error) { message(error.message, true); }
            }
            return;
        }
        if (active?.timeline) void flush(active).catch(() => {});
        playback.clear();
        clearVideo();
        preview.hidden = true;
        selected = regenerateClip = undefined;
        setPlayhead(0);
        active = project ? { project, save: Promise.resolve(), dirty: false } : undefined;
        body.hidden = tools.hidden = true;
        message(project ? "Loading timeline…" : "");
        if (!active) return;
        const session = active;
        try {
            const data = await service(session);
            if (active !== session) return;
            session.timeline = data.timeline;
            for (const track of session.timeline.tracks) {
                for (const clip of track.clips) constrain(clip, session.project.fps);
            }
            session.media = data.media;
            session.video = data.video;
            if (!session.timeline.tracks.length) session.timeline.tracks.push(newTrack("dialogue"));
            body.hidden = tools.hidden = false;
            message();
            render();
        } catch (error) {
            if (active === session) { active = undefined; message(error.message, true); }
        }
    }

    function findSelected() {
        const track = active?.timeline?.tracks.find(item => item.id === selected?.track);
        return { track, clip: track?.clips.find(item => item.id === selected?.clip) };
    }

    function clipStatus(clip) {
        if (!clip.media) return "pending";
        const item = active.media.find(entry => entry.id === clip.media);
        if (item?.origin) return item.origin;
        // Older projects did not store media provenance.
        return item?.library || !clip.prompt.trim() ? "imported" : "generated";
    }

    function endTime() {
        return Math.max(active.video?.duration || 0, ...active.timeline.tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)));
    }

    function renderVideoTrack(seek) {
        const item = active.video;
        preview.hidden = !item;
        get("[data-studio-import-video]").disabled = busy || Boolean(item);
        if (!item) { clearVideo(); return; }

        const source = api.apiURL(route(active, videoRoute(item)));
        if (video.getAttribute("src") !== source) video.src = source;
        const monitor = videoMonitor();
        video.muted = monitor.muted || (active.timeline.tracks.some(track => track.solo) && !monitor.solo);

        const row = element("div", "sbds-track-row sbds-video-track");
        const controls = element("div", "sbds-track-controls");
        const actions = element("div", "sbds-track-actions");
        for (const [key, label, symbol] of [["muted", "Mute reference video", "M"], ["solo", "Solo reference video", "S"]]) {
            const button = element("button", "", symbol);
            button.title = label;
            button.setAttribute("aria-label", label);
            button.setAttribute("aria-pressed", String(monitor[key]));
            button.disabled = busy || !item.hasAudio;
            button.onclick = () => {
                stopPlayback();
                active.timeline.videoMonitor = { ...monitor, [key]: !monitor[key] };
                changed();
                render();
            };
            actions.append(button);
        }
        const remove = element("button", "", "×");
        remove.title = "Remove reference video";
        remove.setAttribute("aria-label", remove.title);
        remove.disabled = busy;
        remove.onclick = () => void removeVideo();
        actions.append(remove);
        controls.append(element("span", "sbds-video-track-name", "Reference video"), actions);

        const lane = element("div", "sbds-track-lane");
        lane.onclick = event => { seek(event); select(); };
        const bar = element("div", "sbds-video-bar", item.name);
        bar.style.width = (item.duration * scale) + "px";
        bar.title = item.name;
        lane.append(bar);
        row.append(controls, lane);
        timeline.append(row);
    }

    function snap(value) {
        const fps = active.project.fps || 24;
        return nearestFrame(value, fps) / fps;
    }

    function select(track, clip, focusClip = false) {
        if (regenerateClip !== clip?.id) regenerateClip = undefined;
        selected = track ? { track: track.id, clip: clip?.id } : undefined;
        render();
        if (focusClip) timeline.querySelector('[data-selected="true"]')?.focus({ preventScroll: true });
    }

    function addClip(track, media) {
        if (busy || track.clips.length >= 80) return;
        const clip = newClip(track, media);
        track.clips.push(clip);
        changed();
        select(track, clip);
    }

    function constrain(clip, fps = active.project.fps) {
        const maxFrames = timeLimit * fps;
        const start = clamp(nearestFrame(clip.start, fps), 0, maxFrames - 1);
        const duration = clamp(nearestFrame(clip.duration, fps), 1, maxFrames - start);
        clip.start = start / fps;
        clip.duration = duration / fps;
        clip.offset = clamp(nearestFrame(clip.offset, fps), 0, maxFrames) / fps;
        clip.fadeIn = clamp(nearestFrame(clip.fadeIn, fps), 0, duration) / fps;
        clip.fadeOut = clamp(nearestFrame(clip.fadeOut, fps), 0, duration) / fps;
        clip.gain = clamp(clip.gain, -60, 12);
    }

    function drawClip(node, clip) {
        node.style.left = `${clip.start * scale}px`;
        node.style.width = `${clip.duration * scale}px`;
        node.style.setProperty("--fade-in", `${100 * clip.fadeIn / clip.duration}%`);
        node.style.setProperty("--fade-out", `${100 * clip.fadeOut / clip.duration}%`);
        node.style.setProperty("--gain-position", `${clamp(50 - clip.gain * 2, 12, 88)}%`);
        const duration = formatClipTime(clip.duration, active.project.fps);
        node.querySelector("small").textContent = duration;
        node.title = `${clip.name} · ${duration} (s:ff) · ${clip.gain.toFixed(1)} dB`;
    }

    function drag(event, track, clip, node) {
        if (event.button !== 0 || busy || event.target.closest("[data-color-trigger]")) return;
        event.preventDefault();
        stopPlayback();
        const handle = event.target.closest("[data-drag]")?.dataset.drag || "move";
        const original = { ...clip };
        const startX = event.clientX;
        const startY = event.clientY;
        const dragScale = scale;
        const frameDuration = 1 / active.project.fps;
        node.setPointerCapture(event.pointerId);
        const move = event => {
            const seconds = (event.clientX - startX) / dragScale;
            if (handle === "move") clip.start = clamp(snap(original.start + seconds), 0, timeLimit - original.duration);
            if (handle === "left") {
                const max = original.start + original.duration - frameDuration;
                clip.start = clamp(snap(original.start + seconds), clip.media ? Math.max(0, original.start - original.offset) : 0, max);
                clip.duration = original.duration - (clip.start - original.start);
                if (clip.media) clip.offset = original.offset + (clip.start - original.start);
            }
            if (handle === "right") clip.duration = snap(original.duration + seconds);
            if (handle === "fadeIn") clip.fadeIn = snap(original.fadeIn + seconds);
            if (handle === "fadeOut") clip.fadeOut = snap(original.fadeOut - seconds);
            if (handle === "gain") clip.gain = Math.round((original.gain + (startY - event.clientY) / 2) * 10) / 10;
            constrain(clip);
            drawClip(node, clip);
        };
        const finish = (event) => {
            node.removeEventListener("pointermove", move);
            node.removeEventListener("pointerup", finish);
            node.removeEventListener("pointercancel", finish);
            if (event.type === "pointercancel") Object.assign(clip, original);
            else if (JSON.stringify(clip) !== JSON.stringify(original)) changed();
            select(track, clip, true);
        };
        node.addEventListener("pointermove", move);
        node.addEventListener("pointerup", finish);
        node.addEventListener("pointercancel", finish);
    }

    function colorButton(label, value, inherited, update) {
        const button = element("button", "sbds-color-trigger");
        button.dataset.colorTrigger = "";
        button.dataset.color = value || inherited;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-haspopup", "true");
        button.disabled = busy;
        button.append(element("span", "sbds-color-swatch"));
        button.onclick = () => {
            if (colorPalette.matches(":popover-open")) colorPalette.hidePopover();
            colorPalette.replaceChildren();
            for (const color of inherited ? ["", ...colors] : colors) {
                const item = element("button", "sbds-color-choice");
                item.dataset.color = color || inherited;
                item.setAttribute("aria-label", color || "Use track color");
                item.setAttribute("aria-pressed", String(color === value));
                if (!color) item.dataset.inherited = "";
                item.append(element("span", "sbds-color-swatch"));
                item.onclick = () => {
                    update(color);
                    changed();
                    render();
                };
                colorPalette.append(item);
            }
            const anchor = button.getBoundingClientRect();
            colorPalette.showPopover();
            const width = colorPalette.offsetWidth;
            const height = colorPalette.offsetHeight;
            colorPalette.style.left = `${Math.max(6, Math.min(anchor.left, window.innerWidth - width - 6))}px`;
            colorPalette.style.top = `${anchor.bottom + height + 6 > window.innerHeight ? Math.max(6, anchor.top - height - 4) : anchor.bottom + 4}px`;
            colorPalette.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        return button;
    }

    function timelineViewport() {
        const header = parseFloat(getComputedStyle(timeline).getPropertyValue("--track-header")) || 146;
        return Math.max(1, timelineScroll.clientWidth - header);
    }

    function stepFrame(key) {
        const fps = active.project.fps;
        const direction = key === "ArrowLeft" ? -1 : 1;
        jumpTo((frameAt(playhead, fps) + direction) / fps);
    }

    function jumpTo(time) {
        const resume = running;
        stopPlayback();
        setPlayhead(clamp(time, 0, rulerLength));
        const position = playhead * scale;
        const visibleStart = timelineScroll.scrollLeft;
        const visibleWidth = timelineViewport();
        if (position < visibleStart || position > visibleStart + visibleWidth - 8) {
            timelineScroll.scrollLeft = Math.max(0, position - visibleWidth / 2);
        }
        if (resume && playhead < endTime()) void play.onclick();
    }

    function render() {
        if (!active?.timeline) return;
        if (colorPalette.matches(":popover-open")) colorPalette.hidePopover();
        const tracks = active.timeline.tracks;
        const fpsInput = get("[data-studio-fps]");
        fpsInput.value = active.project.fps;
        fpsInput.disabled = busy;
        exportFields.disable(busy);
        const width = timelineViewport();
        const contentLength = Math.min(timeLimit, Math.max(endTime(), playhead) + 4);
        const minimumScale = width / Math.max(180, contentLength);
        const zoomValue = Number(zoom.value);
        scale = zoomValue <= 50
            ? minimumScale * (48 / minimumScale) ** (zoomValue / 50)
            : 48 * 3 ** ((zoomValue - 50) / 50);
        rulerLength = Math.min(timeLimit, Math.max(24, Math.ceil(contentLength), Math.ceil(width / scale)));
        const length = rulerLength;
        const interval = rulerIntervals.find(step => step * scale >= 58) ?? rulerIntervals.at(-1);
        timeline.style.setProperty("--timeline-width", `${length * scale}px`);
        timeline.style.setProperty("--tick", `${interval * scale}px`);
        timeline.replaceChildren();
        const ruler = element("div", "sbds-track-row sbds-ruler");
        ruler.append(element("div", "sbds-track-controls", "Tracks"));
        const marks = element("div", "sbds-track-lane");
        for (let second = 0; second < length; second += interval) {
            const label = element("span", "sbds-time-label", timecode(second, active.project.fps));
            label.style.left = `${second * scale}px`;
            marks.append(label);
        }
        const seek = event => {
            stopPlayback();
            setPlayhead(snap((event.clientX - event.currentTarget.getBoundingClientRect().left) / scale));
        };
        playheadHandle = element("span", "sbds-playhead-handle");
        playheadHandle.tabIndex = 0;
        playheadHandle.setAttribute("role", "slider");
        playheadHandle.setAttribute("aria-label", "Timeline playhead");
        playheadHandle.setAttribute("aria-valuemin", "0");
        playheadHandle.setAttribute("aria-valuemax", String(length));
        playheadHandle.title = "Drag to scrub";
        marks.append(playheadHandle);
        let scrubPointer;
        let resumeAfterScrub;
        let gripOffset = 0;
        const scrub = (event) => {
            const offset = event.clientX - marks.getBoundingClientRect().left - gripOffset;
            setPlayhead(clamp(snap(offset / scale), 0, length));
        };
        marks.onpointerdown = event => {
            if (event.button !== 0 || scrubPointer !== undefined) return;
            event.preventDefault();
            resumeAfterScrub = running;
            stopPlayback();
            scrubPointer = event.pointerId;
            gripOffset = event.target === playheadHandle
                ? event.clientX - marks.getBoundingClientRect().left - playhead * scale
                : 0;
            marks.setPointerCapture(event.pointerId);
            playheadHandle.focus({ preventScroll: true });
            if (event.target !== playheadHandle) scrub(event);
        };
        marks.onpointermove = event => {
            if (event.pointerId === scrubPointer) scrub(event);
        };
        marks.onpointerup = marks.onlostpointercapture = event => {
            if (event.pointerId !== scrubPointer) return;
            scrubPointer = undefined;
            if (resumeAfterScrub && playhead < endTime()) void play.onclick();
        };
        playheadHandle.onkeydown = event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Home" || event.key === "End") jumpTo(event.key === "Home" ? 0 : length);
            else stepFrame(event.key);
        };
        ruler.append(marks);
        timeline.append(ruler);
        renderVideoTrack(seek);
        for (const track of tracks) {
            const row = element("div", "sbds-track-row");
            row.dataset.color = track.color;
            const controls = element("div", "sbds-track-controls");
            const name = element("input", "sbds-track-name");
            name.value = track.name;
            name.maxLength = 80;
            name.setAttribute("aria-label", `${kinds[track.kind]} track name`);
            name.onchange = () => { track.name = name.value.trim() || kinds[track.kind]; changed(); render(); };
            const actions = element("div", "sbds-track-actions");
            const toggle = (text, title, key) => {
                const button = element("button", "", text);
                button.title = title;
                button.setAttribute("aria-label", title);
                button.setAttribute("aria-pressed", String(track[key]));
                button.onclick = () => { stopPlayback(); track[key] = !track[key]; changed(); render(); };
                return button;
            };
            const plus = element("button", "", "+");
            plus.title = "Add clip";
            plus.setAttribute("aria-label", `Add clip to ${track.name}`);
            plus.onclick = () => addClip(track);
            const color = colorButton("Track color", track.color, "", value => { track.color = value; });
            const remove = element("button", "", "×");
            remove.title = "Remove empty track";
            remove.setAttribute("aria-label", `Remove track ${track.name}`);
            remove.disabled = Boolean(track.clips.length) || tracks.length === 1;
            remove.onclick = () => {
                tracks.splice(tracks.indexOf(track), 1);
                selected = undefined;
                changed(); render();
            };
            actions.append(plus, toggle("M", "Mute track", "muted"), toggle("S", "Solo track", "solo"), color, remove);
            controls.append(name, actions);
            if (busy) for (const input of controls.querySelectorAll("input, select, button")) input.disabled = true;
            const lane = element("div", "sbds-track-lane");
            lane.onclick = event => { if (event.target === lane) { seek(event); select(track); } };
            for (const clip of track.clips) {
                const node = element("div", "sbds-timeline-clip");
                node.dataset.color = clip.color || track.color;
                node.dataset.selected = String(clip.id === selected?.clip);
                node.dataset.ready = String(Boolean(clip.media) && !clip.retake);
                if (clip.retake) node.dataset.retake = "true";
                node.tabIndex = 0;
                node.setAttribute("role", "group");
                node.setAttribute("aria-label", clip.name);
                const label = element("span", "sbds-clip-name", clip.name);
                node.append(label, element("small"), colorButton("Clip color", clip.color, track.color, value => { clip.color = value; }));
                for (const [handle, title] of [["left", "Trim start"], ["right", "Trim end"], ["fadeIn", "Fade in"], ["fadeOut", "Fade out"], ["gain", "Clip gain"]]) {
                    const control = element("span", "sbds-clip-handle");
                    control.dataset.drag = handle;
                    control.title = title;
                    control.setAttribute("aria-hidden", "true");
                    node.append(control);
                }
                drawClip(node, clip);
                node.onpointerdown = event => drag(event, track, clip, node);
                node.onkeydown = event => { if (event.key === "Enter" && event.target === node) { event.preventDefault(); select(track, clip, true); } };
                lane.append(node);
            }
            row.append(controls, lane);
            timeline.append(row);
        }
        const cursor = element("div", "sbds-timeline-cursor");
        cursor.setAttribute("aria-hidden", "true");
        timeline.append(cursor);
        setPlayhead(playhead);
        renderInspector();
        for (const selector of ["[data-studio-track]", "[data-studio-import]", "[data-studio-generate-all]", "[data-studio-mix]", "[data-studio-stems]"]) get(selector).disabled = busy;
    }

    function renderInspector() {
        const { track, clip } = findSelected();
        inspector.hidden = inspectorScroll.hidden = !clip;
        inspector.disabled = busy;
        if (!clip) { cueEditor.close(); return; }
        const state = clipStatus(clip);
        const editGeneration = state === "pending" || (state === "generated" && regenerateClip === clip.id);
        get("[data-generation-editor]").hidden = !editGeneration;
        get("[data-studio-generate]").hidden = !editGeneration;
        get("[data-studio-final-prompt]").hidden = !editGeneration;
        get("[data-studio-regenerate]").hidden = state !== "generated" || editGeneration;
        const lastSeed = get("[data-last-seed]");
        lastSeed.hidden = clip.generation.lastSeed == null;
        lastSeed.querySelector("input").value = clip.generation.lastSeed ?? "";
        for (const input of inspector.querySelectorAll("[data-clip]")) {
            const key = input.dataset.clip;
            const value = clipTimingFields.has(key) ? formatClipTime(clip[key], active.project.fps) : String(clip[key]);
            if (input.value !== value) input.value = value;
        }
        if (!editGeneration || busy) cueEditor.close();
        if (!editGeneration) return;
        cueEditor.show(track.kind === "dialogue");
        get("[data-studio-dialogue]").hidden = track.kind !== "dialogue";
        const options = generationOptions();
        const settings = modelSettings();
        for (const input of inspector.querySelectorAll("[data-generation]")) {
            const key = input.dataset.generation;
            if (options[key]) {
                const fallback = settings[key] || studioDefaults[key];
                choiceList(input, options[key].map(value => [value, value]), fallback + " (model default)",
                    clip.generation[key], "Unavailable");
            } else {
                input.value = clip.generation[key];
            }
        }
        const seed = get('[data-generation="seed"]');
        seed.readOnly = clip.generation.seedMode !== "fixed";
        if (seed.readOnly) seed.value = clip.generation.lastSeed ?? "";
        for (const input of inspector.querySelectorAll("[data-reference]")) {
            choiceList(input, active.media.filter(item => item.library).map(item => [item.id, item.name]), "No reference", clip.refs[input.dataset.reference]);
        }
    }

    inspector.onchange = event => {
        const input = event.target;
        const { clip } = findSelected();
        if (!clip || busy) return;
        if (input.dataset.clip) {
            const key = input.dataset.clip;
            if (clipTimingFields.has(key)) {
                const seconds = parseClipTime(input.value, active.project.fps);
                if (!Number.isFinite(seconds)) { renderInspector(); return; }
                clip[key] = seconds;
            } else {
                if (input.type === "number" && (!input.value || !input.validity.valid)) { renderInspector(); return; }
                clip[key] = input.type === "number" ? Number(input.value) : input.value;
            }
            constrain(clip);
        } else if (input.dataset.reference !== undefined) {
            clip.refs[Number(input.dataset.reference)] = input.value;
            clip.refs = Array.from(clip.refs, value => value || "");
        } else if (input.dataset.generation) {
            if (!input.validity.valid) { renderInspector(); return; }
            const key = input.dataset.generation;
            clip.generation[key] = input.type === "number" && key !== "seed" ? Number(input.value) || (key === "cfg" ? 0 : 1) : input.value;
            if (key === "seedMode" && input.value === "fixed") clip.generation.seed ||= String(clip.generation.lastSeed ?? 0);
        } else {
            return;
        }
        stopPlayback();
        changed();
        if (input.dataset.clip !== "prompt") render();
    };
    get('[data-clip="prompt"]').oninput = event => {
        const { clip } = findSelected();
        if (clip) { clip.prompt = event.target.value; changed(); }
    };
    get("[data-studio-track]").onclick = () => {
        if (active.timeline.tracks.length >= 24) { message("A project can have up to 24 tracks.", true); return; }
        const track = newTrack(get("[data-new-track-type]").value);
        active.timeline.tracks.push(track);
        changed();
        select(track);
    };
    get("[data-studio-regenerate]").onclick = () => {
        const { clip } = findSelected();
        if (clip && clipStatus(clip) === "generated") {
            regenerateClip = clip.id;
            clip.retake = true;
            changed();
            render();
            get('[data-clip="prompt"]').focus();
        }
    };
    get("[data-studio-delete-clip]").onclick = () => {
        const { track, clip } = findSelected();
        if (!clip) return;
        stopPlayback();
        track.clips.splice(track.clips.indexOf(clip), 1);
        changed();
        select(track);
    };
    zoom.oninput = () => {
        render();
        timelineScroll.scrollLeft = Math.max(0, playhead * scale - timelineViewport() / 2);
    };
    let viewportWidth;
    new ResizeObserver(() => {
        const width = timelineScroll.clientWidth;
        if (!width || width === viewportWidth) return;
        viewportWidth = width;
        render();
    }).observe(timelineScroll);
    play.onclick = async () => {
        if (running) { stopPlayback(); return; }
        const session = active;
        const ticket = ++playbackTicket;
        const end = endTime();
        const tracks = session.video && videoMonitor(session).solo
            ? session.timeline.tracks.filter(track => track.solo) : session.timeline.tracks;
        const clips = audibleTracks(tracks).flatMap(track => track.clips).filter(clip => clip.media);
        if (!clips.length && !session.video) { message("Add audio or reference video to the timeline to play it."); return; }
        if (playhead >= end) setPlayhead(0);
        try {
            const started = playback.play(clips, playhead, end, id => api.apiURL(route(session, `/media/${encodeURIComponent(id)}`)));
            showPlaybackState(true);
            if (await started && ticket === playbackTicket && session.video && playhead < session.video.duration) {
                syncVideo();
                await video.play();
            }
        } catch (error) {
            if (ticket === playbackTicket) { stopPlayback(); message(error.message, true); }
        }
    };

    const dialog = section.closest("dialog");
    dialog?.addEventListener("keydown", event => {
        const arrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
        if ((!arrow && event.code !== "Space") || event.defaultPrevented || section.hidden || body.hidden
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (target.closest("dialog") !== dialog || target.closest("input, textarea, select, [contenteditable], [data-cue-bar]")) return;
        if (!arrow && target.closest("button, a, summary")) return;
        event.preventDefault();
        event.stopPropagation();
        if (arrow) stepFrame(event.key);
        else if (!event.repeat) void play.onclick();
    });

    get("[data-studio-import]").onclick = () => file.click();
    get("[data-studio-import-video]").onclick = () => videoFile.click();
    videoFile.onchange = async () => {
        const item = videoFile.files[0];
        const session = active;
        videoFile.value = "";
        if (!item || !session || busy || session.video) return;
        stopPlayback();
        busy = true;
        render();
        message("Importing reference video…");
        try {
            session.video = await service(session, "/video?" + new URLSearchParams({ filename: item.name }), item, true);
            if (active === session) {
                setPlayhead(0);
                timelineScroll.scrollLeft = 0;
                message("Reference video ready.");
            }
        } catch (error) {
            if (active === session) message(error.message, true);
        } finally {
            busy = false;
            render();
        }
    };

    async function removeVideo() {
        const session = active;
        if (busy || !session?.video) return;
        stopPlayback();
        busy = true;
        render();
        clearVideo();
        try {
            await service(session, videoRoute(session.video), undefined, false, "DELETE");
            session.video = undefined;
            delete session.timeline.videoMonitor;
            changed(session);
            if (active === session) message("Reference video removed.");
        } catch (error) {
            if (active === session) message(error.message, true);
        } finally {
            busy = false;
            render();
        }
    }

    file.onchange = async () => {
        const audio = file.files[0];
        const session = active;
        file.value = "";
        if (!audio || !session || busy) return;
        const track = findSelected().track || session.timeline.tracks[0];
        if (track.clips.length >= 80 || audio.size > 64 * 1024 * 1024) { message("Choose a file under 64 MB and a track with space for another clip.", true); return; }
        busy = true; render(); message("Importing audio…");
        try {
            const media = await service(session, "/media?" + new URLSearchParams({ filename: audio.name }), audio, true);
            if (active === session) {
                session.media.push(media);
                busy = false;
                addClip(track, media);
                message();
            }
        } catch (error) { if (active === session) message(error.message, true); }
        finally { busy = false; render(); }
    };

    get("[data-studio-fps]").onchange = async (event) => {
        const session = active;
        const input = event.currentTarget;
        if (!input.value || !input.validity.valid) { input.value = session.project.fps; return; }
        const requestedFps = Number(input.value);
        input.disabled = true;
        try {
            await flush(session);
            const { fps } = await service(session, "/fps", { fps: requestedFps });
            session.project.fps = fps;
            for (const track of session.timeline.tracks) {
                for (const clip of track.clips) constrain(clip, fps);
            }
            changed(session);
            if (active === session) {
                get("[data-active-project-description]").textContent = [session.project.description, `${fps} FPS`].filter(Boolean).join(" · ");
                stopPlayback();
                setPlayhead(snap(playhead));
                render();
                message("Project frame rate saved.");
            }
        } catch (error) { if (active === session) message(error.message, true); }
        finally { if (active === session) { input.disabled = busy; input.value = session.project.fps; } }
    };

    async function exportAudio(mode) {
        const session = active;
        const settings = exportFields.values();
        busy = true; render(); message(mode === "stems" ? "Rendering separate tracks…" : "Rendering mixdown…");
        try {
            await flush(session);
            const query = new URLSearchParams({ mode, ...settings });
            const response = await service(session, `/export?${query}`, session.timeline);
            const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || (mode === "stems" ? "Stems.zip" : `Mixdown.${settings.format}`);
            const url = URL.createObjectURL(await response.blob());
            const link = element("a");
            link.href = url;
            link.download = filename;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (active === session) message(`Saved ${filename} in the project’s exports folder.`);
        } catch (error) { if (active === session) message(error.message, true); }
        finally { busy = false; render(); }
    }
    get("[data-studio-mix]").onclick = () => void exportAudio("mix");
    get("[data-studio-stems]").onclick = () => void exportAudio("stems");

    api.addEventListener("progress", ({ detail }) => {
        if (jobId && detail.prompt_id === jobId && detail.max) progressBar.value = detail.value / detail.max;
    });

    function preparePrompt(track, clip, fps) {
        const refs = track.kind === "dialogue" ? [...new Set(clip.refs.filter(Boolean))] : [];
        const positive = compilePrompt(track.kind, clip.prompt, refs.length, clip.duration, fps);
        return { refs, positive };
    }

    get("[data-studio-final-prompt]").onclick = () => {
        const { track, clip } = findSelected();
        if (!clip) return;
        const preview = finalPrompt.querySelector("textarea");
        try {
            const { positive } = preparePrompt(track, clip, active.project.fps);
            const negative = clip.generation.negative;
            preview.value = negative ? `${positive}\n\nNegative prompt\n${negative}` : positive;
        } catch (error) {
            preview.value = error.message;
        }
        finalPrompt.showModal();
    };

    async function generate(jobs) {
        if (busy) return;
        if (!jobs.length) { message("No ungenerated clips with prompts."); return; }
        const session = active;
        const settings = modelSettings();
        busy = true; render(); progress.hidden = false;
        const startedAt = performance.now();
        const timer = setInterval(() => { get("[data-studio-elapsed]").textContent = `Elapsed ${elapsedTime((performance.now() - startedAt) / 1000)}`; }, 250);
        try {
            for (const [index, { track, clip }] of jobs.entries()) {
                message(`Generating ${index + 1}/${jobs.length} · ${clip.name}`);
                const { fps } = session.project;
                const { steps, cfg, seedMode, seed, negative, sampler, scheduler } = clip.generation;
                if (clip.duration > 120) throw new Error("Split generated clips longer than two minutes.");
                const { positive, refs } = preparePrompt(track, clip, fps);
                const referenceModels = refs.length ? await referenceSetup(request, referenceSettings()) : null;
                if (referenceModels && referenceModels.vae === settings.vae) {
                    throw new Error("Choose the LTX Video VAE separately from the Audio VAE in Model setup.");
                }
                const references = [];
                for (const id of refs) {
                    const { input } = await service(session, `/reference/${encodeURIComponent(id)}`, {});
                    references.push(input);
                }
                progressBar.value = 0;
                const usedSeed = seedMode === "random" ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(seed);
                const graph = studioGraph({
                    ...settings, text: clip.prompt, negative, finalPrompt: positive,
                    sampler: sampler || settings.sampler || studioDefaults.sampler,
                    scheduler: scheduler || settings.scheduler || studioDefaults.scheduler,
                    seconds: Math.max(8 / fps, Math.ceil(clip.duration * fps / 8) * 8 / fps),
                    fps, steps, cfg, seed: usedSeed,
                }, references, referenceModels);
                const filename = await queueStudioTake(request, api, graph, id => { jobId = id; });
                const media = await service(session, "/take", {
                    name: clip.name,
                    parts: [{ filename, duration: clip.duration }],
                });
                clip.media = media.id;
                clip.offset = 0;
                clip.retake = false;
                clip.generation.lastSeed = usedSeed;
                if (regenerateClip === clip.id) regenerateClip = undefined;
                session.media.push(media);
                changed(session);
                await flush(session);
            }
            if (active === session) { progressBar.value = 1; message("Studio audio is ready."); }
        } catch (error) {
            if (active === session) message(error.message, true);
        } finally {
            clearInterval(timer);
            busy = false; progress.hidden = true;
            render();
        }
    }
    get("[data-studio-generate]").onclick = () => {
        const item = findSelected();
        if (!item.clip || get("[data-studio-generate]").hidden) return;
        void generate([item]);
    };
    get("[data-studio-generate-all]").onclick = () => void generate(active.timeline.tracks.flatMap(track =>
        track.clips.filter(clip => !clip.media && clip.prompt.trim()).map(clip => ({ track, clip }))));

    return { open, stop: stopPlayback };
}
