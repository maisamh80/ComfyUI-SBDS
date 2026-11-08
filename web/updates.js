export const updatesView = `
    <p class="sbds-label">SETTINGS</p>
    <h2>Updates</h2>
    <p>Check GitHub for a newer version of SBDS.</p>
    <p data-update-version hidden></p>
    <div class="sbds-actions">
        <button type="button" data-update-check>Check for updates</button>
        <button type="button" class="sbds-primary" data-update-apply hidden>Update now</button>
    </div>
    <p class="sbds-project-status" data-update-status role="status" hidden></p>
`;

export function createUpdateControls(section, api) {
    const version = section.querySelector("[data-update-version]");
    const status = section.querySelector("[data-update-status]");
    const check = section.querySelector("[data-update-check]");
    const apply = section.querySelector("[data-update-apply]");
    let busy = false;
    let needsRestart = false;

    function showMessage(text, isError = false) {
        status.textContent = text;
        status.hidden = !text;
        status.dataset.error = String(isError);
    }

    function render({ current, latest, restartRequired }) {
        const available = latest && latest !== current;
        needsRestart = restartRequired;
        version.textContent = `Installed revision: ${current.slice(0, 8)}`;
        version.hidden = false;
        apply.hidden = !available || needsRestart;
        if (needsRestart) {
            showMessage("Update installed. Restart ComfyUI and refresh this page to finish.");
        } else if (available) {
            showMessage(`Update available: ${latest.slice(0, 8)}.`);
        } else {
            showMessage(latest ? "SBDS is up to date." : "");
        }
    }

    async function request(action) {
        if (busy || (needsRestart && action)) return;
        busy = true;
        check.disabled = apply.disabled = true;
        if (action) showMessage(action === "check" ? "Checking GitHub…" : "Installing update…");
        try {
            const options = action
                ? { method: "POST", headers: { "X-SBDS-Update": "1" } }
                : undefined;
            const response = await api.fetchApi(`/sbds/update${action ? `/${action}` : ""}`, options);
            if (!response.ok) {
                if (response.status === 404 || response.status === 405) {
                    throw new Error("Restart ComfyUI to load Updates.");
                }
                throw new Error(await response.text() || "The update request failed.");
            }
            render(await response.json());
        } catch (error) {
            apply.hidden = true;
            showMessage(error.message, true);
        } finally {
            busy = false;
            check.disabled = apply.disabled = needsRestart;
        }
    }

    check.onclick = () => request("check");
    apply.onclick = () => request("apply");
    return () => request();
}
