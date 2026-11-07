import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { buildAudioGraph, describeSound, modelInputs, outputNode } from "./t2a.js";
import { createResourceMonitor, resourceMeters } from "./resources.js";
import { createTakeControls, latestTakeControls } from "./audio.js";

const settingsKey = "sbds-model-setup";
const promptKey = "sbds-final-prompt";
const purgeTitle = "Ask ComfyUI to unload models and clear its execution cache";
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

async function purgeMemory() {
    const response = await api.fetchApi("/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (!response.ok) throw new Error(`Memory cleanup request failed (HTTP ${response.status}).`);
}

async function readResourceStats() {
    const response = await api.fetchApi("/sbds/resources");
    if (response.status === 404) {
        throw new Error("Restart ComfyUI to load SBDS resource monitoring.");
    }
    if (!response.ok) throw new Error(`SBDS resource monitoring returned HTTP ${response.status}.`);
    return response.json();
}

function readSaved(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch {
        return null;
    }
}

function createStudio() {
    const dialog = document.createElement("dialog");
    dialog.className = "sbds";
    dialog.innerHTML = `
        <header>
            <div class="sbds-title"><span class="sbds-mark" aria-hidden="true">▣</span> <strong>Sound Band Design Studio</strong></div>
            ${resourceMeters}
            <div class="sbds-actions">
                <button type="button" data-action="purge" title="${purgeTitle}">Purge</button>
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
                    <label class="sbds-audio-type">Audio type
                        <select name="audioType">
                            <option value="voice">Character Voice</option>
                            <option value="music">Music</option>
                            <option value="sfx">Sound Effect</option>
                        </select>
                    </label>
                    <label class="sbds-text">Sound description
                        <textarea name="text" rows="4" placeholder="Describe a sound or enter a line of dialogue in quotes…"></textarea>
                    </label>
                    <fieldset class="sbds-voice">
                        <legend>Voice design</legend>
                        <p>Shape the character voice or the delivery of a line.</p>
                        <div class="sbds-fields">
                            <label>Voice type
                                <select name="voiceType">
                                    <option value="female" selected>Female</option>
                                    <option value="male">Male</option>
                                    <option value="androgynous">Androgynous</option>
                                    <option value="cartoon-style female">Cartoon Female</option>
                                    <option value="cartoon-style male">Cartoon Male</option>
                                </select>
                            </label>
                            <label>Mood
                                <select name="mood">
                                    <option value="warm and reassuring">Warm</option>
                                    <option value="curious and alert">Curious</option>
                                    <option value="playful and amused">Playful</option>
                                    <option value="calm and relaxed" selected>Calm</option>
                                    <option value="excited and delighted">Excited</option>
                                    <option value="worried and slightly tense">Worried</option>
                                    <option value="sad and subdued">Sad</option>
                                    <option value="angry and tense">Angry</option>
                                </select>
                            </label>
                            <label>Delivery
                                <select name="delivery">
                                    <option value="with an everyday conversational delivery">Conversational</option>
                                    <option value="in a soft whisper">Whisper</option>
                                    <option value="with a wise, measured delivery and thoughtful pauses">Wise and measured</option>
                                    <option value="with the expressive delivery of a storyteller">Storytelling</option>
                                    <option value="with crisp, formal delivery" selected>Formal</option>
                                </select>
                            </label>
                            <label class="sbds-age">
                                <span>Set age <output data-age for="sbds-age">30 years</output></span>
                                <input id="sbds-age" name="age" type="range" min="3" max="100" value="30">
                            </label>
                            <label>Language
                                <select name="language">
                                    <option value="">Auto</option>
                                    <option selected>English</option>
                                    <option>French</option>
                                    <option>German</option>
                                    <option>Russian</option>
                                    <option>Spanish</option>
                                    <optgroup label="Experimental">
                                        <option value="Mandarin Chinese">Chinese (Mandarin)</option>
                                        <option>Korean</option>
                                        <option>Japanese</option>
                                        <option>Arabic</option>
                                        <option>Persian</option>
                                    </optgroup>
                                    <option value="custom">Custom…</option>
                                </select>
                            </label>
                            <label data-custom-language hidden>Custom language
                                <input name="customLanguage" maxlength="60" placeholder="e.g. Italian" disabled required>
                            </label>
                            <label>Pitch
                                <select name="pitch">
                                    <option value="very low">Very Low</option>
                                    <option value="low">Low</option>
                                    <option value="mid-range" selected>Moderate</option>
                                    <option value="high">High</option>
                                    <option value="very high">Very High</option>
                                </select>
                            </label>
                            <label>Speaking pace
                                <select name="pace">
                                    <option value="at a slow, unhurried pace">Slow</option>
                                    <option value="at an even, natural pace" selected>Natural</option>
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
                    <div class="sbds-actions">
                        <button type="submit" class="sbds-primary" disabled>Generate</button>
                        <button type="button" data-action="prompt" aria-keyshortcuts="Shift+P" title="Shift+P outside text fields">Final Prompt</button>
                    </div>
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
                ${latestTakeControls}
            </section>
        </main>
        <footer>
            <span role="status">Loading ComfyUI model lists…</span>
            <div class="sbds-progress">
                <progress max="1" value="0" aria-label="Generation progress"></progress>
                <span data-elapsed hidden></span>
            </div>
        </footer>
        <dialog class="sbds-prompt-editor" aria-labelledby="sbds-prompt-title">
            <form>
                <h2 id="sbds-prompt-title">Final Prompt</h2>
                <p>This is the positive prompt SBDS will send to LTX. Save edits to use them with these sound settings.</p>
                <label>Prompt text <textarea rows="9"></textarea></label>
                <div class="sbds-actions">
                    <button type="submit" class="sbds-primary">Save prompt</button>
                    <button type="button" data-action="reset-prompt">Reset to generated</button>
                    <button type="button" data-action="close-prompt">Cancel</button>
                </div>
            </form>
        </dialog>`;
    document.body.append(dialog);

    const form = dialog.querySelector("form");
    const generate = form.querySelector('button[type="submit"]');
    const refresh = dialog.querySelector('[data-action="refresh"]');
    const expand = dialog.querySelector('[data-action="expand"]');
    const settingsButton = dialog.querySelector('[data-action="settings"]');
    const purgeButton = dialog.querySelector('[data-action="purge"]');
    const monitor = createResourceMonitor(dialog.querySelector(".sbds-meters"), readResourceStats);
    const settingsPanel = dialog.querySelector("[data-settings]");
    const modelStatus = settingsPanel.querySelector("[data-model-status]");
    const footer = dialog.querySelector("footer");
    const status = footer.querySelector('[role="status"]');
    const progress = dialog.querySelector("progress");
    const elapsed = dialog.querySelector("[data-elapsed]");
    const showTake = createTakeControls(dialog.querySelector("[data-latest-take]"), api);
    const takes = dialog.querySelector("[data-take]");
    const promptButton = form.querySelector('[data-action="prompt"]');
    const promptEditor = dialog.querySelector(".sbds-prompt-editor");
    const promptText = promptEditor.querySelector("textarea");
    const selects = {};
    let promptOverride = readSaved(promptKey);
    let editorBase;
    let promptId;
    let busy = false;
    let ready = false;
    let purging = false;
    let purgeFeedback;

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
        generate.disabled = busy || purging || !ready || Object.values(selects).some((select) => !select.value);
        refresh.disabled = busy;
        purgeButton.disabled = busy || purging;
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

            const previous = { ...readSaved(settingsKey), ...Object.fromEntries(Object.entries(modelSettings()).filter(([, value]) => value)) };
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
    dialog.addEventListener("close", () => monitor.stop());
    dialog.addEventListener("close", () => dialog.querySelector("audio").pause());
    purgeButton.onclick = async () => {
        if (purgeButton.disabled) return;
        clearTimeout(purgeFeedback);
        purging = true;
        updateControls();
        purgeButton.textContent = "Purging…";
        purgeButton.title = purgeTitle;
        try {
            await purgeMemory();
            purgeButton.textContent = "Queued";
        } catch (error) {
            purgeButton.textContent = "Failed";
            purgeButton.title = error.message;
        } finally {
            purging = false;
            updateControls();
            purgeFeedback = setTimeout(() => {
                purgeButton.textContent = "Purge";
                purgeButton.title = purgeTitle;
            }, 3000);
        }
    };
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
    const voiceDesign = form.querySelector(".sbds-voice");
    form.elements.audioType.onchange = () => {
        const isVoice = form.elements.audioType.value === "voice";
        voiceDesign.hidden = !isVoice;
        voiceDesign.disabled = !isVoice;
    };
    const customLanguage = form.elements.customLanguage;
    form.elements.language.onchange = () => {
        const isCustom = form.elements.language.value === "custom";
        dialog.querySelector("[data-custom-language]").hidden = !isCustom;
        customLanguage.disabled = !isCustom;
        if (isCustom) customLanguage.focus();
    };
    const ageOutput = dialog.querySelector("[data-age]");
    const ageInput = form.elements.age;
    ageInput.oninput = () => {
        ageOutput.value = `${ageInput.value} years`;
    };
    form.elements.seedMode.onchange = () => {
        form.elements.seed.disabled = form.elements.seedMode.value === "random";
    };

    function generatedPrompt(data) {
        const text = String(data.get("text")).trim();
        if (!text) return "";
        switch (data.get("audioType")) {
            case "voice": return describeSound(text, Object.fromEntries(data));
            case "music": return `Generate a music cue. ${text}`;
            case "sfx": return `Generate a sound effect. ${text}`;
            default: return text;
        }
    }

    function finalPrompt(base) {
        return promptOverride?.base === base ? promptOverride.text : base;
    }

    function openPromptEditor() {
        editorBase = generatedPrompt(new FormData(form));
        promptText.value = finalPrompt(editorBase);
        promptText.setCustomValidity("");
        promptEditor.showModal();
        promptText.focus();
    }

    promptButton.onclick = openPromptEditor;
    dialog.addEventListener("keydown", (event) => {
        if (!settingsPanel.hidden || promptEditor.open || event.defaultPrevented || event.repeat) return;
        if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "p") return;
        if (event.target.closest('input, textarea, select, [contenteditable]')) return;
        event.preventDefault();
        openPromptEditor();
    });
    promptEditor.querySelector('[data-action="reset-prompt"]').onclick = () => {
        promptText.value = editorBase;
        promptText.setCustomValidity("");
        promptText.focus();
    };
    promptEditor.querySelector('[data-action="close-prompt"]').onclick = () => promptEditor.close();
    promptText.oninput = () => promptText.setCustomValidity("");
    promptEditor.querySelector("form").onsubmit = (event) => {
        event.preventDefault();
        const edited = promptText.value.trim();
        if (!edited && editorBase) {
            promptText.setCustomValidity("Enter a prompt or reset to the generated text.");
            promptText.reportValidity();
            return;
        }
        promptOverride = edited === editorBase ? null : { base: editorBase, text: edited };
        try {
            localStorage.setItem(promptKey, JSON.stringify(promptOverride));
        } catch {
            // The edit can still be used for this open studio.
        }
        promptEditor.close();
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
                finalPrompt: finalPrompt(generatedPrompt(data)),
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
            if (!output || result.status?.status_str === "error") {
                const failure = result.status?.messages?.find(([type]) => type === "execution_error");
                throw new Error(failure?.[1]?.exception_message || "Generation ended without an audio file.");
            }
            showTake(output);
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
    return () => {
        if (dialog.open) return;
        dialog.showModal();
        monitor.start();
    };
}

app.registerExtension({
    name: "SBDS.Studio",
    nodeCreated(node) {
        if (node.comfyClass !== "SBDSStudio") return;
        node.addWidget("button", "Open Studio", null, () => {
            studio ??= createStudio();
            studio();
        });
    },
});
