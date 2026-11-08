export const projectsView = `
    <div class="sbds-project-heading">
        <div>
            <p class="sbds-label">WORKSPACE</p>
            <h1>Projects</h1>
            <p>Create a project or pick up where you left off.</p>
        </div>
        <div class="sbds-actions">
            <button type="button" data-import-project>Import Project</button>
            <button type="button" class="sbds-primary" data-new-project>+ New Project</button>
        </div>
    </div>
    <p class="sbds-project-status" data-project-status role="status" hidden></p>
    <div class="sbds-project-grid"></div>
    <template data-project-card>
        <article class="sbds-project-card">
            <div class="sbds-project-art"><img alt="" loading="lazy"></div>
            <div class="sbds-project-card-body">
                <h2></h2>
                <p data-project-summary></p>
                <div class="sbds-actions">
                    <button type="button" data-open-project>Open</button>
                    <button type="button" data-delete-project>Delete</button>
                </div>
            </div>
        </article>
    </template>
    <dialog class="sbds-project-editor" aria-label="Project details">
        <form>
            <h2 data-project-dialog-title></h2>
            <label data-create-field>Project name<input name="name" required maxlength="80"></label>
            <label data-create-field>Short description<textarea name="description" rows="2" maxlength="300"></textarea></label>
            <label data-create-field>
                <span>Project frame rate (FPS) <span class="sbds-project-hint">(You can change this later in Studio.)</span></span>
                <input name="fps" type="number" value="24" min="1" max="120" step="1" required>
            </label>
            <label><span data-path-label>Project location</span>
                <span class="sbds-project-path">
                    <input name="path" required placeholder="Absolute folder path">
                    <button type="button" data-browse-folders>Browse…</button>
                </span>
            </label>
            <p class="sbds-project-hint" data-path-hint></p>
            <div class="sbds-folder-picker" data-folder-picker hidden>
                <div class="sbds-actions">
                    <button type="button" data-folder-home>Home</button>
                    <button type="button" data-folder-up>Up</button>
                    <select data-folder-root aria-label="Drive"></select>
                    <button type="button" data-folder-use>Use this folder</button>
                </div>
                <p data-folder-current role="status"></p>
                <div class="sbds-folder-list"></div>
            </div>
            <label data-create-field>Thumbnail <span class="sbds-project-hint">Optional. A preset is picked at random if left blank.</span>
                <input name="thumbnail" type="file" accept="image/jpeg,image/png,image/webp">
            </label>
            <p class="sbds-project-status" data-editor-status role="status" hidden></p>
            <div class="sbds-actions">
                <button type="submit" class="sbds-primary" data-submit-project></button>
                <button type="button" data-cancel-project>Cancel</button>
            </div>
        </form>
    </dialog>
    <dialog class="sbds-project-editor" data-delete-dialog aria-label="Delete project card">
        <form method="dialog">
            <h2>Delete project card?</h2>
            <p data-delete-description></p>
            <p class="sbds-project-status" data-delete-status role="status" hidden></p>
            <div class="sbds-actions">
                <button value="cancel" autofocus>Cancel</button>
                <button value="delete" data-delete-project>Delete card</button>
            </div>
        </form>
    </dialog>
`;

const root = "/sbds/projects";

async function projectRequest(api, path = "", method = "GET", payload) {
    const options = { method };
    if (method !== "GET") options.headers = { "X-SBDS-Projects": "1" };
    if (payload) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(payload);
    }
    const response = await api.fetchApi(root + path, options);
    if (!response.ok) {
        const message = await response.text();
        if (response.status === 405 || (response.status === 404 && (!message.trim() || message.trim() === "404: Not Found"))) {
            throw new Error("Restart the ComfyUI server, then refresh the browser to load Projects.");
        }
        throw new Error(message || "The project request failed.");
    }
    return response.status === 204 ? null : response.json();
}

function readThumbnail(file) {
    if (!file?.size) return null;
    if (file.size > 6_000_000) throw new Error("Choose a thumbnail under 6 MB.");
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",", 2)[1]);
        reader.onerror = () => reject(new Error("Could not read the thumbnail."));
        reader.readAsDataURL(file);
    });
}

export function listLibraryProjects(api) {
    return projectRequest(api);
}

export function saveProjectSound(api, projectId, name, filename) {
    return projectRequest(api, "/" + encodeURIComponent(projectId) + "/library", "POST", { name, filename });
}

export function createProjectLibrary(section, api, onOpen, onRemove) {
    const get = (selector) => section.querySelector(selector);
    const grid = get(".sbds-project-grid");
    const template = get("[data-project-card]");
    const status = get("[data-project-status]");
    const editor = get(".sbds-project-editor");
    const deleteDialog = get("[data-delete-dialog]");
    const deleteForm = deleteDialog.querySelector("form");
    const deleteStatus = get("[data-delete-status]");
    const form = editor.querySelector("form");
    const submit = get("[data-submit-project]");
    const editorStatus = get("[data-editor-status]");
    const picker = get("[data-folder-picker]");
    const current = get("[data-folder-current]");
    const folderList = get(".sbds-folder-list");
    const rootSelect = get("[data-folder-root]");
    const up = get("[data-folder-up]");
    const useFolder = get("[data-folder-use]");
    let editorMode;
    let deleting;
    let folder;
    let folderRequest = 0;
    let refreshRequest = 0;

    function message(target, text = "", error = false) {
        target.textContent = text;
        target.hidden = !text;
        target.dataset.error = String(error);
    }

    function render(projects) {
        grid.replaceChildren();
        message(status, projects.length ? "" : "No projects yet. Create one or import an existing folder.");
        for (const project of projects) {
            const card = template.content.firstElementChild.cloneNode(true);
            const route = "/" + encodeURIComponent(project.id);
            const art = card.querySelector("img");
            art.onerror = () => art.remove();
            art.src = api.apiURL(root + route + "/thumbnail");
            card.querySelector("h2").textContent = project.name;
            card.querySelector("[data-project-summary]").textContent = project.description || "No description";
            card.querySelector("[data-open-project]").onclick = async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    const selected = await projectRequest(api, route);
                    message(status);
                    onOpen(selected);
                } catch (error) {
                    message(status, error.message, true);
                } finally {
                    button.disabled = false;
                }
            };
            card.querySelector("[data-delete-project]").onclick = () => {
                deleting = project;
                message(deleteStatus);
                get("[data-delete-description]").textContent = `Remove “${project.name}” from Projects? Its folder and files will stay on disk.`;
                deleteDialog.showModal();
            };
            grid.append(card);
        }
    }

    async function refresh() {
        const ticket = ++refreshRequest;
        try {
            const projects = await projectRequest(api);
            if (ticket === refreshRequest) render(projects);
        } catch (error) {
            if (ticket === refreshRequest) message(status, error.message, true);
        }
    }

    function showEditor(mode) {
        editorMode = mode;
        const importing = mode === "import";
        form.reset();
        for (const field of editor.querySelectorAll("[data-create-field]")) {
            field.hidden = importing;
            field.querySelector("input,textarea").disabled = importing;
        }
        get("[data-project-dialog-title]").textContent = importing ? "Import Project" : "New Project";
        get("[data-path-label]").textContent = importing ? "Existing project folder" : "Save in";
        get("[data-path-hint]").textContent = importing
            ? "Select the folder containing project.json."
            : "SBDS creates a new folder with your project name here.";
        submit.textContent = importing ? "Import project" : "Create project";
        picker.hidden = true;
        message(editorStatus);
        editor.showModal();
    }

    async function browse(path = "") {
        const ticket = ++folderRequest;
        picker.hidden = false;
        current.textContent = "Reading folders…";
        folderList.replaceChildren();
        useFolder.disabled = up.disabled = true;
        try {
            const selection = await projectRequest(api, "/folders?" + new URLSearchParams({ path }));
            if (ticket !== folderRequest || picker.hidden) return;
            folder = selection;
            rootSelect.replaceChildren(new Option("Drives", ""), ...folder.roots.map(drive => new Option(drive, drive)));
            rootSelect.value = "";
            current.textContent = folder.path;
            useFolder.disabled = false;
            up.disabled = !folder.parent;
            for (const entry of folder.folders) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = entry.name;
                button.onclick = () => void browse(entry.path);
                folderList.append(button);
            }
        } catch (error) {
            if (ticket === folderRequest) current.textContent = error.message;
        }
    }

    get("[data-new-project]").onclick = () => showEditor("new");
    get("[data-import-project]").onclick = () => showEditor("import");
    get("[data-cancel-project]").onclick = () => editor.close();
    get("[data-browse-folders]").onclick = () => void browse(form.elements.path.value);
    get("[data-folder-home]").onclick = () => void browse();
    up.onclick = () => void browse(folder.parent);
    rootSelect.onchange = () => { if (rootSelect.value) void browse(rootSelect.value); };
    useFolder.onclick = () => {
        form.elements.path.value = folder.path;
        picker.hidden = true;
        form.elements.path.focus();
    };

    editor.addEventListener("close", () => { ++folderRequest; });
    editor.addEventListener("cancel", event => { if (submit.disabled) event.preventDefault(); });
    form.onsubmit = async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        const values = new FormData(form);
        submit.disabled = get("[data-cancel-project]").disabled = true;
        message(editorStatus);
        try {
            const data = { path: values.get("path") };
            if (editorMode === "new") {
                data.name = values.get("name");
                data.description = values.get("description");
                data.fps = Number(values.get("fps"));
                data.thumbnail = await readThumbnail(values.get("thumbnail"));
            }
            const project = await projectRequest(api, editorMode === "new" ? "" : "/open", "POST", data);
            editor.close();
            await refresh();
            onOpen(project);
        } catch (error) {
            message(editorStatus, error.message, true);
        } finally {
            submit.disabled = get("[data-cancel-project]").disabled = false;
        }
    };

    deleteDialog.addEventListener("cancel", event => {
        if (deleteForm.querySelector('[value="delete"]').disabled) event.preventDefault();
    });
    deleteForm.onsubmit = async (event) => {
        if (event.submitter?.value !== "delete") return;
        event.preventDefault();
        const project = deleting;
        const buttons = [...deleteForm.querySelectorAll("button")];
        for (const button of buttons) button.disabled = true;
        try {
            await projectRequest(api, "/" + encodeURIComponent(project.id), "DELETE");
            deleteDialog.close();
            onRemove(project);
            await refresh();
        } catch (error) {
            message(deleteStatus, error.message, true);
        } finally {
            for (const button of buttons) button.disabled = false;
        }
    };
    return { refresh };
}
