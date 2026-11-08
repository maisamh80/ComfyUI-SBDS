import { listLibraryProjects, saveProjectSound } from "./projects.js";

const speakerIcon = '<path d="M3 7h3l4-3v12l-4-3H3z" fill="currentColor"/>';

export const latestTakeControls = `
    <div class="sbds-audio-row" hidden>
        <audio preload="metadata" hidden></audio>
        <div class="sbds-player" role="group" aria-label="Audio player">
            <button type="button" data-play aria-label="Play" title="Play">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path data-play-icon d="M6 3l11 7-11 7z" fill="currentColor"/>
                    <path data-pause-icon d="M5 4h4v12H5zm6 0h4v12h-4z" fill="currentColor" hidden/>
                </svg>
            </button>
            <span class="sbds-audio-time">0:00 / 0:00</span>
            <input type="range" data-seek aria-label="Playback position" min="0" max="1" step="0.01" value="0" disabled>
            <button type="button" data-mute aria-label="Mute" title="Mute" aria-pressed="false">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                    ${speakerIcon}
                    <path data-unmuted-icon d="M13 7a4 4 0 010 6m2-8a7 7 0 010 10" fill="none" stroke="currentColor" stroke-linecap="round"/>
                    <path data-muted-icon d="m13 8 4 4m0-4-4 4" fill="none" stroke="currentColor" stroke-linecap="round" hidden/>
                </svg>
            </button>
            <input type="range" data-volume aria-label="Volume" min="0" max="1" step="0.05" value="1">
        </div>
        <div class="sbds-export" role="group" aria-label="Audio export">
            <label>Format
                <select data-format>
                    <option value="flac">FLAC</option>
                    <option value="wav">WAV</option>
                    <option value="mp3">MP3</option>
                    <option value="opus">Opus</option>
                </select>
            </label>
            <label>Quality<select data-quality></select></label>
            <button type="button" data-add-library>Add to Library</button>
            <button type="button" data-download>Download</button>
        </div>
    </div>
    <p class="sbds-audio-status" role="status" hidden></p>
    <dialog class="sbds-project-editor" data-library-editor aria-label="Add to Library">
        <form>
            <h2>Add to Library</h2>
            <p data-library-project></p>
            <label data-library-chooser hidden>Project<select name="project" required disabled></select></label>
            <label>Sound name<input name="name" required maxlength="80" autofocus></label>
            <p class="sbds-project-hint">Use this name to find the sound later in Studio.</p>
            <p class="sbds-project-status" data-library-error data-error="true" role="status" hidden></p>
            <div class="sbds-actions">
                <button type="submit" class="sbds-primary">Save</button>
                <button type="button" data-library-cancel>Cancel</button>
            </div>
        </form>
    </dialog>
`;

const qualityOptions = {
    flac: [["lossless", "Lossless"]],
    wav: [["16", "16-bit PCM"], ["24", "24-bit PCM"]],
    mp3: ["128", "192", "256", "320"].map(rate => [rate, `${rate} kbps`]),
    opus: ["64", "96", "128", "192", "256"].map(rate => [rate, `${rate} kbps`]),
};
const defaultQuality = { flac: "lossless", wav: "16", mp3: "192", opus: "128" };

function formatTime(seconds) {
    const total = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function createTakeControls(section, api, getProject) {
    const row = section.querySelector(".sbds-audio-row");
    const audio = row.querySelector("audio");
    const play = row.querySelector("[data-play]");
    const seek = row.querySelector("[data-seek]");
    const mute = row.querySelector("[data-mute]");
    const volume = row.querySelector("[data-volume]");
    const time = row.querySelector(".sbds-audio-time");
    const format = row.querySelector("[data-format]");
    const quality = row.querySelector("[data-quality]");
    const download = row.querySelector("[data-download]");
    const addToLibrary = row.querySelector("[data-add-library]");
    const status = section.querySelector(".sbds-audio-status");
    const libraryEditor = section.querySelector("[data-library-editor]");
    const libraryForm = libraryEditor.querySelector("form");
    const libraryProject = libraryForm.querySelector("[data-library-project]");
    const projectChooser = libraryForm.querySelector("[data-library-chooser]");
    const projectSelect = libraryForm.elements.project;
    const libraryName = libraryForm.elements.name;
    const libraryError = libraryForm.querySelector("[data-library-error]");
    const save = libraryForm.querySelector('button[type="submit"]');
    const cancel = libraryForm.querySelector("[data-library-cancel]");
    const selectedQuality = { ...defaultQuality };
    let filename;
    let libraryTake;
    let libraryProjectId;
    let libraryRequest = 0;

    function showMessage(message = "", error = true) {
        status.textContent = message;
        status.hidden = !message;
        status.dataset.error = String(error);
    }

    function setLibraryError(message = "") {
        libraryError.textContent = message;
        libraryError.hidden = !message;
    }

    addToLibrary.onclick = async () => {
        if (!filename) return;
        const ticket = ++libraryRequest;
        const project = getProject();
        libraryTake = filename;
        libraryProjectId = project?.id;
        libraryForm.reset();
        setLibraryError();
        projectChooser.hidden = Boolean(project);
        projectSelect.disabled = true;
        projectSelect.replaceChildren(new Option("Select a project…", ""));
        libraryProject.textContent = project ? `Project: ${project.name}` : "Loading projects…";
        save.disabled = !project;
        libraryEditor.showModal();
        if (project) return;

        try {
            const projects = await listLibraryProjects(api);
            if (ticket !== libraryRequest || !libraryEditor.open) return;
            libraryProject.textContent = projects.length ? "" : "Create or import a project first.";
            if (!projects.length) return;
            for (const item of projects) projectSelect.add(new Option(item.name, item.id));
            projectSelect.disabled = false;
            projectSelect.focus();
        } catch (error) {
            if (ticket === libraryRequest && libraryEditor.open) {
                libraryProject.textContent = "";
                setLibraryError(error.message);
            }
        }
    };
    projectSelect.onchange = () => { save.disabled = !projectSelect.value; };
    cancel.onclick = () => libraryEditor.close();
    libraryEditor.addEventListener("cancel", event => { if (cancel.disabled) event.preventDefault(); });
    libraryForm.onsubmit = async (event) => {
        event.preventDefault();
        if (save.disabled) return;
        const projectId = libraryProjectId || projectSelect.value;
        save.disabled = cancel.disabled = true;
        projectSelect.disabled = true;
        setLibraryError();
        try {
            const sound = await saveProjectSound(api, projectId, libraryName.value, libraryTake);
            libraryEditor.close();
            showMessage(`Added “${sound.name}” to the project library.`, false);
        } catch (error) {
            setLibraryError(error.message);
            libraryName.focus();
            libraryName.select();
        } finally {
            save.disabled = cancel.disabled = false;
            projectSelect.disabled = Boolean(libraryProjectId);
        }
    };

    function updatePlay() {
        const playing = !audio.paused && !audio.ended;
        play.title = playing ? "Pause" : "Play";
        play.setAttribute("aria-label", play.title);
        play.querySelector("[data-play-icon]").toggleAttribute("hidden", playing);
        play.querySelector("[data-pause-icon]").toggleAttribute("hidden", !playing);
    }

    function updateTime() {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        seek.disabled = duration <= 0;
        seek.max = duration || 1;
        seek.value = audio.currentTime;
        seek.style.setProperty("--filled", `${duration ? 100 * audio.currentTime / duration : 0}%`);
        time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
        seek.setAttribute("aria-valuetext", time.textContent);
    }

    function updateVolume() {
        const muted = audio.muted || audio.volume === 0;
        mute.title = muted ? "Unmute" : "Mute";
        mute.setAttribute("aria-label", mute.title);
        mute.setAttribute("aria-pressed", String(muted));
        mute.querySelector("[data-unmuted-icon]").toggleAttribute("hidden", muted);
        mute.querySelector("[data-muted-icon]").toggleAttribute("hidden", !muted);
        volume.value = muted ? 0 : audio.volume;
        volume.style.setProperty("--filled", `${100 * Number(volume.value)}%`);
    }

    for (const event of ["play", "pause", "ended", "emptied"]) audio.addEventListener(event, updatePlay);
    for (const event of ["timeupdate", "durationchange", "loadedmetadata", "emptied"]) audio.addEventListener(event, updateTime);
    audio.addEventListener("volumechange", updateVolume);
    audio.addEventListener("error", () => showMessage("This take could not be played."));
    play.onclick = async () => {
        if (!audio.paused) {
            audio.pause();
            return;
        }
        try {
            await audio.play();
        } catch (error) {
            if (error.name !== "AbortError") showMessage("This take could not be played.");
        }
    };
    seek.oninput = () => { audio.currentTime = Number(seek.value); };
    volume.oninput = () => {
        audio.volume = Number(volume.value);
        audio.muted = false;
    };
    mute.onclick = () => {
        if (audio.volume === 0) {
            audio.volume = 1;
            audio.muted = false;
        } else {
            audio.muted = !audio.muted;
        }
    };
    updateVolume();

    function updateQuality() {
        const options = qualityOptions[format.value];
        quality.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
        quality.value = selectedQuality[format.value];
        quality.disabled = options.length === 1;
    }
    format.onchange = updateQuality;
    quality.onchange = () => { selectedQuality[format.value] = quality.value; };
    updateQuality();

    download.onclick = async () => {
        if (!filename || download.disabled) return;
        const params = new URLSearchParams({ filename, format: format.value, quality: quality.value });
        const targetName = filename.replace(/\.flac$/i, `.${format.value}`);
        download.disabled = true;
        download.textContent = "Preparing…";
        showMessage();
        try {
            const response = await api.fetchApi(`/sbds/export?${params}`);
            if (!response.ok) {
                const message = await response.text();
                if (response.status === 404 && message.trim() === "404: Not Found") {
                    throw new Error("Restart ComfyUI to load audio export.");
                }
                throw new Error(message || "Audio export failed.");
            }
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            link.download = targetName;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) {
            showMessage(error.message);
        } finally {
            download.disabled = false;
            download.textContent = "Download";
        }
    };

    return (output) => {
        filename = output.filename;
        const params = new URLSearchParams({ filename, subfolder: output.subfolder, type: output.type });
        audio.src = api.apiURL(`/view?${params}`);
        showMessage();
        row.hidden = false;
    };
}
