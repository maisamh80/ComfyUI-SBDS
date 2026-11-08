import { compilePrompt, planTake, queueStudioTake, referenceSetup, studioGraph } from "./studio_generation.js";
import { createTimelinePlayback } from "./timeline_playback.js";
import { audioExportFields, bindAudioExportFields } from "./audio.js";
import { bindCueEditor, cueEditorView } from "./cue_editor.js";

const transportIcon = name => new URL(`./artwork/${name}.svg`, import.meta.url).href;

const colors = ["mint", "blue", "lilac", "rose", "amber", "cyan", "orange", "slate"];
const kinds = { dialogue: "Dialogue", music: "Music", sfx: "Sound Effects" };
const timeLimit = 1200;
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
        <div class="sbds-timeline-toolbar">
            <div class="sbds-actions sbds-timeline-tracks">
                <select data-new-track-type aria-label="Track type">${Object.entries(kinds).map(([key, title]) => `<option value="${key}">${title}</option>`).join("")}</select>
                <button type="button" data-studio-track>+ Track</button>
                <button type="button" data-studio-import>Import audio</button>
                <input type="file" data-studio-file accept="audio/*,.flac,.wav,.mp3,.ogg,.opus,.m4a,.aac,.aiff" hidden>
            </div>
            <div class="sbds-actions sbds-timeline-transport">
                <span data-studio-time>0:00.0</span>
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
                    <label>Start (s)<input type="number" data-clip="start" min="0" step="any"></label>
                    <label>Duration (s)<input type="number" data-clip="duration" min="0.01" step="any"></label>
                    <label>Source offset (s)<input type="number" data-clip="offset" min="0" step="any"></label>
                    <label>Gain (dB)<input type="number" data-clip="gain" min="-60" max="12" step="0.1"></label>
                    <label>Fade in (s)<input type="number" data-clip="fadeIn" min="0" step="any"></label>
                    <label>Fade out (s)<input type="number" data-clip="fadeOut" min="0" step="any"></label>
                </div>
                <div data-generation-editor hidden>
                    ${cueEditorView}
                    <div data-studio-dialogue>
                        <div class="sbds-fields">
                            <label>Speaker 1 reference<select data-reference="0"></select></label>
                            <label>Speaker 2 reference<select data-reference="1"></select></label>
                        </div>
                        <p class="sbds-project-hint">For two voices, label lines Speaker 1 and Speaker 2. A cue such as [pause:3s] inserts silence.</p>
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
const timecode = (time) => `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, "0")}`;
const audibleTracks = tracks => tracks.filter(track => !track.muted && (!tracks.some(item => item.solo) || track.solo));

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

    const playback = createTimelinePlayback(setPlayhead, () => showPlaybackState(false));

    function message(text = "", error = false) {
        status.textContent = text;
        status.dataset.error = String(error);
        status.hidden = !text;
    }

    function route(session, suffix = "") {
        return `/sbds/projects/${encodeURIComponent(session.project.id)}/studio${suffix}`;
    }

    async function service(session, suffix = "", data, raw = false) {
        const options = data === undefined ? {} : { method: "POST", headers: { "X-SBDS-Projects": "1" } };
        if (data !== undefined) {
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

    function setPlayhead(value) {
        playhead = clamp(value, 0, timeLimit);
        get("[data-studio-time]").textContent = timecode(playhead);
        timeline.style.setProperty("--playhead", `${playhead * scale}px`);
        if (playheadHandle) {
            playheadHandle.setAttribute("aria-valuenow", String(Number(playhead.toFixed(3))));
            playheadHandle.setAttribute("aria-valuetext", timecode(playhead));
        }
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
        const start = Math.min(snap(playhead), timeLimit - 0.1);
        return {
            id: uuid(), name: media?.name || `${kinds[track.kind]} clip`, media: media?.id || "",
            start, duration: Math.min(media?.duration || 5, timeLimit - start), offset: 0,
            gain: 0, fadeIn: 0, fadeOut: 0, color: "", prompt: "", refs: [],
            generation: { seedMode: "random", seed: "", steps: 8, cfg: 1, sampler: "", scheduler: "", negative: "" },
        };
    }

    async function open(project) {
        if (active?.project.id === project?.id && active?.project.path === project?.path) {
            if (active?.timeline) {
                try {
                    const session = active;
                    const fresh = await service(session);
                    if (active === session) { session.media = fresh.media; render(); }
                } catch (error) { message(error.message, true); }
            }
            return;
        }
        if (active?.timeline) void flush(active).catch(() => {});
        playback.clear();
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
            session.media = data.media;
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
        return Math.max(0, ...active.timeline.tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)));
    }

    function snap(value) {
        const fps = active.project.fps || 24;
        return Math.round(value * fps) / fps;
    }

    function select(track, clip, focusClip = false) {
        if (regenerateClip !== clip?.id) regenerateClip = undefined;
        selected = { track: track.id, clip: clip?.id };
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

    function constrain(clip) {
        clip.start = clamp(clip.start, 0, timeLimit - 0.01);
        clip.duration = clamp(clip.duration, 0.01, timeLimit - clip.start);
        clip.offset = clamp(clip.offset, 0, timeLimit);
        clip.fadeIn = clamp(clip.fadeIn, 0, clip.duration);
        clip.fadeOut = clamp(clip.fadeOut, 0, clip.duration);
        clip.gain = clamp(clip.gain, -60, 12);
    }

    function drawClip(node, clip) {
        node.style.left = `${clip.start * scale}px`;
        node.style.width = `${clip.duration * scale}px`;
        node.style.setProperty("--fade-in", `${100 * clip.fadeIn / clip.duration}%`);
        node.style.setProperty("--fade-out", `${100 * clip.fadeOut / clip.duration}%`);
        node.style.setProperty("--gain-position", `${clamp(50 - clip.gain * 2, 12, 88)}%`);
        node.querySelector("small").textContent = `${clip.duration.toFixed(2)}s`;
        node.title = `${clip.name} · ${clip.duration.toFixed(2)}s · ${clip.gain.toFixed(1)} dB`;
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
        node.setPointerCapture(event.pointerId);
        const move = event => {
            const seconds = (event.clientX - startX) / dragScale;
            if (handle === "move") clip.start = clamp(snap(original.start + seconds), 0, timeLimit - original.duration);
            if (handle === "left") {
                const max = original.start + original.duration - 0.04;
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
        const interval = rulerIntervals.find(step => step * scale >= 50) ?? rulerIntervals.at(-1);
        timeline.style.setProperty("--timeline-width", `${length * scale}px`);
        timeline.style.setProperty("--tick", `${interval * scale}px`);
        timeline.replaceChildren();
        const ruler = element("div", "sbds-track-row sbds-ruler");
        ruler.append(element("div", "sbds-track-controls", "Tracks"));
        const marks = element("div", "sbds-track-lane");
        for (let second = 0; second < length; second += interval) {
            const label = element("span", "sbds-time-label", timecode(second));
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
            const positions = { ArrowLeft: playhead - 1, ArrowRight: playhead + 1, Home: 0, End: length };
            if (!(event.key in positions) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            event.stopPropagation();
            jumpTo(positions[event.key]);
        };
        ruler.append(marks);
        timeline.append(ruler);
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
                node.dataset.ready = String(Boolean(clip.media));
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
        for (const input of inspector.querySelectorAll("[data-clip]")) {
            const value = String(clip[input.dataset.clip]);
            if (input.value !== value) input.value = value;
        }
        if (!editGeneration || busy) cueEditor.close();
        if (!editGeneration) return;
        cueEditor.show(track.kind === "dialogue");
        get("[data-studio-dialogue]").hidden = track.kind !== "dialogue";
        const options = generationOptions();
        for (const input of inspector.querySelectorAll("[data-generation]")) {
            const key = input.dataset.generation;
            if (options[key]) {
                choiceList(input, options[key].map(value => [value, value]), "Use Model Setup", clip.generation[key], "Unavailable");
            } else {
                input.value = clip.generation[key];
            }
        }
        get('[data-generation="seed"]').disabled = clip.generation.seedMode !== "fixed";
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
            if (input.type === "number" && (!input.value || !input.validity.valid)) { renderInspector(); return; }
            clip[key] = input.type === "number" ? Number(input.value) : input.value;
            constrain(clip);
        } else if (input.dataset.reference !== undefined) {
            clip.refs[Number(input.dataset.reference)] = input.value;
            clip.refs = Array.from(clip.refs, value => value || "");
        } else if (input.dataset.generation) {
            if (!input.validity.valid) { renderInspector(); return; }
            const key = input.dataset.generation;
            clip.generation[key] = input.type === "number" && key !== "seed" ? Number(input.value) || (key === "cfg" ? 0 : 1) : input.value;
            if (key === "seedMode" && input.value === "fixed") clip.generation.seed ||= "0";
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
            renderInspector();
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
        const clips = audibleTracks(active.timeline.tracks).flatMap(track => track.clips).filter(clip => clip.media);
        if (!clips.length) { message("Add audio to the timeline to play it."); return; }
        if (playhead >= end) setPlayhead(0);
        try {
            const started = playback.play(clips, playhead, end, id => api.apiURL(route(session, `/media/${encodeURIComponent(id)}`)));
            showPlaybackState(true);
            await started;
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
        if (arrow) jumpTo(playhead + (event.key === "ArrowLeft" ? -1 : 1));
        else if (!event.repeat) void play.onclick();
    });

    get("[data-studio-import]").onclick = () => file.click();
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
        input.disabled = true;
        try {
            const { fps } = await service(session, "/fps", { fps: Number(input.value) });
            session.project.fps = fps;
            if (active === session) {
                get("[data-active-project-description]").textContent = [session.project.description, `${fps} FPS`].filter(Boolean).join(" · ");
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

    function preparePrompts(track, clip, fps) {
        const refs = track.kind === "dialogue" ? [...new Set(clip.refs.filter(Boolean))] : [];
        const parts = planTake(track.kind, clip, fps).map(part => part.silence ? part : {
            ...part, prompt: compilePrompt(track.kind, part.text, refs.length),
        });
        return { refs, parts };
    }

    get("[data-studio-final-prompt]").onclick = () => {
        const { track, clip } = findSelected();
        if (!clip) return;
        const preview = finalPrompt.querySelector("textarea");
        try {
            const { parts } = preparePrompts(track, clip, active.project.fps);
            const positive = parts.length === 1 ? parts[0].prompt : parts.map((part, index) =>
                part.silence ? `[Silence: ${part.duration}s]` : `Part ${index + 1}\n${part.prompt}`
            ).join("\n\n");
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
        const timer = setInterval(() => { get("[data-studio-elapsed]").textContent = `Elapsed ${timecode((performance.now() - startedAt) / 1000)}`; }, 250);
        try {
            for (const [index, { track, clip }] of jobs.entries()) {
                message(`Generating ${index + 1}/${jobs.length} · ${clip.name}`);
                const { fps } = session.project;
                const { steps, cfg, seedMode, seed, negative, sampler, scheduler } = clip.generation;
                if (clip.duration > 120) throw new Error("Split generated clips longer than two minutes.");
                const { parts, refs } = preparePrompts(track, clip, fps);
                const referenceModels = refs.length ? await referenceSetup(request, referenceSettings()) : null;
                if (referenceModels && referenceModels.vae === settings.vae) {
                    throw new Error("Choose the LTX Video VAE separately from the Audio VAE in Model setup.");
                }
                const references = [];
                for (const id of refs) {
                    const { input } = await service(session, `/reference/${encodeURIComponent(id)}`, {});
                    references.push(input);
                }
                const rendered = [];
                for (const part of parts) {
                    if (part.silence) { rendered.push(part); continue; }
                    progressBar.value = 0;
                    const graph = studioGraph({
                        ...settings, text: part.text, negative,
                        sampler: sampler || settings.sampler,
                        scheduler: scheduler || settings.scheduler,
                        finalPrompt: part.prompt,
                        seconds: Math.max(8 / fps, Math.ceil(part.duration * fps / 8) * 8 / fps),
                        fps, steps, cfg, seed: seedMode === "random" ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(seed),
                    }, references, referenceModels);
                    const filename = await queueStudioTake(request, api, graph, id => { jobId = id; });
                    rendered.push({ filename, duration: part.duration });
                }
                const media = await service(session, "/take", { name: clip.name, parts: rendered });
                clip.media = media.id;
                clip.offset = 0;
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
