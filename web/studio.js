import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { buildAudioGraph, modelInputs, outputNode } from "./t2a.js";

const settingsKey = "sbds-model-setup";
const settingsLabels = {
    model: "LTX diffusion model", encoder: "LTX text encoder", vae: "Audio VAE",
    sampler: "Sampler", scheduler: "Scheduler",
};
let studio;

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./studio.css", import.meta.url).href;
document.head.append(stylesheet);

async function request(path, options) {
    const response = await api.fetchApi(path, options);
    const data = await response.json();
    if (!response.ok) {
        const errors = Object.values(data.node_errors ?? {})
            .flatMap((node) => node.errors ?? [])
            .map((error) => error.details || error.message);
        throw new Error(errors.join(" · ") || data.error?.message || `ComfyUI returned HTTP ${response.status}.`);
    }
    return data;
}

function savedSettings() {
    try {
        return JSON.parse(localStorage.getItem(settingsKey)) ?? {};
    } catch {
        return {};
    }
}

function createStudio() {
    const dialog = document.createElement("dialog");
    dialog.className = "sbds";
    dialog.innerHTML = `
        <header>
            <div><span class="sbds-mark" aria-hidden="true">▣</span> <strong>Sound Band Design Studio</strong></div>
            <div class="sbds-actions">
                <button type="button" data-action="settings">Settings</button>
                <button type="button" data-action="expand" aria-pressed="false">Expand</button>
                <button type="button" data-action="close" aria-label="Close studio">✕</button>
            </div>
        </header>
        <main>
            <section data-identity>
                <p class="sbds-label">IDENTITY / TEXT TO AUDIO</p>
                <h1>Make a sound.</h1>
                <p>Describe a character voice, musical cue, or sound effect for LTX.</p>
                <form>
                    <label class="sbds-text">Sound description
                        <textarea name="text" rows="4" required placeholder="Describe a sound or enter a line of dialogue in quotes…"></textarea>
                    </label>
                    <fieldset class="sbds-voice">
                        <legend>Voice design</legend>
                        <p>Optional voice details for a character or a line of dialogue.</p>
                        <div class="sbds-fields">
                            <label>Voice type
                                <select name="voiceType">
                                    <option value="">Any</option>
                                    <option value="female">Female</option>
                                    <option value="male">Male</option>
                                    <option value="androgynous">Androgynous</option>
                                </select>
                            </label>
                            <label>Mood
                                <select name="mood">
                                    <option value="">Any</option>
                                    <option value="warm and reassuring">Warm</option>
                                    <option value="curious and alert">Curious</option>
                                    <option value="playful and amused">Playful</option>
                                    <option value="calm and relaxed">Calm</option>
                                    <option value="excited and delighted">Excited</option>
                                    <option value="worried and slightly tense">Worried</option>
                                    <option value="sad and subdued">Sad</option>
                                    <option value="angry and tense">Angry</option>
                                </select>
                            </label>
                            <label>Delivery
                                <select name="delivery">
                                    <option value="">Any</option>
                                    <option value="with an everyday conversational delivery">Conversational</option>
                                    <option value="in a soft whisper">Whisper</option>
                                    <option value="with a wise, measured delivery and thoughtful pauses">Wise and measured</option>
                                    <option value="with the expressive delivery of a storyteller">Storytelling</option>
                                    <option value="with crisp, formal delivery">Formal</option>
                                </select>
                            </label>
                            <div class="sbds-age">
                                <label class="sbds-check"><input name="setAge" type="checkbox"> Set age</label>
                                <label>
                                    <span>Age <output data-age for="sbds-age" hidden>30 years</output></span>
                                    <input id="sbds-age" name="age" type="range" min="3" max="100" value="30" disabled>
                                </label>
                            </div>
                            <label>Language <input name="language" maxlength="60" placeholder="e.g. English"></label>
                            <label>Accent <input name="accent" maxlength="80" placeholder="e.g. British"></label>
                            <label>Pitch
                                <select name="pitch">
                                    <option value="">Any</option>
                                    <option value="low">Low</option>
                                    <option value="mid-range">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </label>
                            <label>Speaking pace
                                <select name="pace">
                                    <option value="">Any</option>
                                    <option value="at a slow, unhurried pace">Slow</option>
                                    <option value="at an even, natural pace">Natural</option>
                                    <option value="at a quick, clear pace">Fast</option>
                                </select>
                            </label>
                        </div>
                    </fieldset>
                    <div class="sbds-fields">
                        <label>Duration (s)<input name="seconds" type="number" min="0.5" max="30" step="0.1" value="5" required></label>
                        <label>Generation FPS<input name="fps" type="number" min="1" max="60" step="1" value="24" required></label>
                    </div>
                    <details>
                        <summary>Generation settings</summary>
                        <div class="sbds-fields" data-generation-fields>
                            <label>Seed mode<select name="seedMode"><option value="random">Random</option><option value="fixed">Fixed</option></select></label>
                            <label>Seed<input name="seed" type="number" min="0" max="4294967295" step="1" value="52" disabled required></label>
                            <label>Steps<input name="steps" type="number" min="1" max="100" step="1" value="8" required></label>
                            <label>CFG<input name="cfg" type="number" min="0" max="20" step="0.1" value="1" required></label>
                        </div>
                        <label class="sbds-text">Negative prompt<textarea name="negative" rows="2" placeholder="Optional. Standard CFG at 1 may ignore this."></textarea></label>
                    </details>
                    <button type="submit" class="sbds-primary" disabled>Generate</button>
                </form>
            </section>
            <section data-settings hidden>
                <p class="sbds-label">SETTINGS</p>
                <h2 tabindex="-1">Model setup</h2>
                <div data-model-fields></div>
                <button type="button" data-action="refresh">Refresh model list</button>
                <p data-model-status role="status">Loading ComfyUI model lists…</p>
            </section>
            <section data-latest-take>
                <p class="sbds-label">LATEST TAKE</p>
                <p data-take>No audio generated yet.</p>
                <audio controls hidden></audio>
                <a data-download hidden>Download audio</a>
            </section>
        </main>
        <footer>
            <span role="status">Loading ComfyUI model lists…</span>
            <div class="sbds-progress">
                <progress max="1" value="0" aria-label="Generation progress"></progress>
                <span data-elapsed hidden></span>
            </div>
        </footer>`;
    document.body.append(dialog);

    const form = dialog.querySelector("form");
    const generate = form.querySelector('button[type="submit"]');
    const refresh = dialog.querySelector('[data-action="refresh"]');
    const expand = dialog.querySelector('[data-action="expand"]');
    const settingsButton = dialog.querySelector('[data-action="settings"]');
    const settingsPanel = dialog.querySelector("[data-settings]");
    const modelStatus = settingsPanel.querySelector("[data-model-status]");
    const footer = dialog.querySelector("footer");
    const status = footer.querySelector('[role="status"]');
    const progress = dialog.querySelector("progress");
    const elapsed = dialog.querySelector("[data-elapsed]");
    const audio = dialog.querySelector("audio");
    const download = dialog.querySelector("[data-download]");
    const takes = dialog.querySelector("[data-take]");
    const selects = {};
    let promptId;
    let busy = false;
    let ready = false;

    for (const [key, title] of Object.entries(settingsLabels)) {
        const label = document.createElement("label");
        const select = document.createElement("select");
        select.setAttribute("aria-label", title);
        label.append(title, select);
        const fieldGroup = key === "sampler" || key === "scheduler" ? "[data-generation-fields]" : "[data-model-fields]";
        dialog.querySelector(fieldGroup).append(label);
        selects[key] = select;
        select.addEventListener("change", () => {
            localStorage.setItem(settingsKey, JSON.stringify(modelSettings()));
            updateControls();
            if (ready && dialog.dataset.state === "idle") updateSetupStatus();
        });
    }

    function modelSettings() {
        return Object.fromEntries(Object.entries(selects).map(([key, select]) => [key, select.value]));
    }

    function updateControls() {
        generate.disabled = busy || !ready || Object.values(selects).some((select) => !select.value);
        refresh.disabled = busy;
    }

    function setStatus(message, state) {
        status.textContent = message;
        dialog.dataset.state = state;
    }

    function setSetupStatus(message, state) {
        modelStatus.textContent = message;
        modelStatus.dataset.state = state;
        setStatus(message, state);
    }

    function updateSetupStatus() {
        const missing = Object.entries(selects).filter(([, select]) => !select.value);
        const fields = missing.map(([key]) => settingsLabels[key]).join(", ");
        setSetupStatus(fields ? `Choose ${fields} in Settings or Generation settings.` : "Ready", "idle");
    }

    async function refreshModels() {
        ready = false;
        refresh.disabled = true;
        generate.disabled = true;
        setSetupStatus("Loading ComfyUI model lists…", "idle");
        try {
            const definitions = await request("/object_info");
            const required = new Set(Object.values(buildAudioGraph({
                text: "Check node availability.", model: "model", encoder: "encoder",
                vae: "vae", sampler: "sampler", scheduler: "scheduler", fps: 24, seconds: 1,
            })).map((node) => node.class_type));
            const missing = [...required].filter((type) => !definitions[type]);
            if (missing.length) throw new Error(`Missing ComfyUI nodes: ${missing.join(", ")}. See the SBDS installation guide.`);

            const previous = { ...savedSettings(), ...Object.fromEntries(Object.entries(modelSettings()).filter(([, value]) => value)) };
            for (const [key, [node, input, preferred]] of Object.entries(modelInputs)) {
                const [spec, info] = definitions[node].input.required[input] ?? [];
                const choices = Array.isArray(spec) ? spec : info?.options;
                if (!Array.isArray(choices)) throw new Error(`Cannot read the choices for ${settingsLabels[key]}.`);
                const select = selects[key];
                select.replaceChildren(new Option(choices.length ? "Choose…" : "No files found", ""));
                for (const value of choices) select.add(new Option(value, value));
                select.value = choices.includes(previous[key]) ? previous[key] : (choices.find((value) => preferred.test(value)) ?? "");
            }
            ready = true;
            updateSetupStatus();
        } catch (error) {
            setSetupStatus(error.message, "error");
        } finally {
            updateControls();
        }
    }

    dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
    settingsButton.onclick = () => {
        const showSettings = settingsPanel.hidden;
        settingsPanel.hidden = !showSettings;
        dialog.querySelector("[data-identity]").hidden = showSettings;
        dialog.querySelector("[data-latest-take]").hidden = showSettings;
        footer.hidden = showSettings;
        settingsButton.textContent = showSettings ? "Back to Identity" : "Settings";
        if (showSettings) settingsPanel.querySelector("h2").focus();
    };
    expand.onclick = () => {
        const expanded = dialog.classList.toggle("sbds-expanded");
        expand.textContent = expanded ? "Compact" : "Expand";
        expand.setAttribute("aria-pressed", String(expanded));
    };
    refresh.onclick = refreshModels;
    const ageOutput = dialog.querySelector("[data-age]");
    const ageInput = form.elements.age;
    form.elements.setAge.onchange = () => {
        const enabled = form.elements.setAge.checked;
        ageInput.disabled = !enabled;
        ageOutput.hidden = !enabled;
    };
    ageInput.oninput = () => {
        ageOutput.value = `${ageInput.value} years`;
    };
    form.elements.seedMode.onchange = () => {
        form.elements.seed.disabled = form.elements.seedMode.value === "random";
    };

    api.addEventListener("progress", ({ detail }) => {
        if (!promptId || detail.prompt_id !== promptId || !detail.max) return;
        progress.value = detail.value / detail.max;
        setStatus(`Generating · step ${detail.value} / ${detail.max}`, "running");
    });

    form.onsubmit = async (event) => {
        event.preventDefault();
        if (generate.disabled) return;
        const data = new FormData(form);
        const seed = data.get("seedMode") === "fixed"
            ? Number(data.get("seed"))
            : crypto.getRandomValues(new Uint32Array(1))[0];
        busy = true;
        updateControls();
        progress.value = 0;
        const startedAt = performance.now();
        const updateElapsed = () => {
            const seconds = Math.floor((performance.now() - startedAt) / 1000);
            elapsed.textContent = `Elapsed ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        };
        elapsed.hidden = false;
        updateElapsed();
        const timer = setInterval(updateElapsed, 250);
        setStatus("Submitting to ComfyUI…", "running");
        try {
            const prompt = buildAudioGraph({
                ...modelSettings(),
                text: String(data.get("text")), negative: String(data.get("negative")),
                voice: Object.fromEntries(data),
                seconds: Number(data.get("seconds")), fps: Number(data.get("fps")),
                steps: Number(data.get("steps")), cfg: Number(data.get("cfg")), seed,
            });
            const queued = await request("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt, client_id: api.clientId }),
            });
            promptId = queued.prompt_id;
            if (!promptId) throw new Error("ComfyUI did not return a job ID.");
            setStatus("Queued · waiting for ComfyUI…", "running");
            let result;
            while (!result) {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                const history = await request(`/history/${encodeURIComponent(promptId)}`);
                result = history[promptId];
            }
            const output = result.outputs?.[outputNode]?.audio?.[0];
            if (!output) {
                const failure = result.status?.messages?.find(([type]) => type === "execution_error");
                throw new Error(failure?.[1]?.exception_message || "Generation ended without an audio file.");
            }
            const params = new URLSearchParams({
                filename: output.filename, subfolder: output.subfolder, type: output.type,
            });
            const url = api.apiURL(`/view?${params}`);
            audio.src = url;
            audio.hidden = false;
            download.href = url;
            download.download = output.filename;
            download.hidden = false;
            takes.textContent = `${output.filename} · Seed ${seed}`;
            progress.value = 1;
            setStatus("Take ready", "done");
        } catch (error) {
            progress.value = 0;
            setStatus(error.message, "error");
        } finally {
            clearInterval(timer);
            updateElapsed();
            busy = false;
            promptId = undefined;
            updateControls();
        }
    };

    void refreshModels();
    return dialog;
}

app.registerExtension({
    name: "SBDS.Studio",
    nodeCreated(node) {
        if (node.comfyClass !== "SBDSStudio") return;
        node.addWidget("button", "Open Studio", null, () => {
            studio ??= createStudio();
            if (!studio.open) studio.showModal();
        });
    },
});
