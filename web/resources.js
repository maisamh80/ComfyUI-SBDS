const metrics = [
    { key: "cpu", label: "CPU", trend: true },
    { key: "ram", label: "RAM" },
    { key: "gpu", label: "GPU", trend: true },
    { key: "vram", label: "VRAM" },
];

export const resourceMeters = `
    <div class="sbds-meters" role="group" aria-label="ComfyUI server resource usage">
        ${metrics.map(({ key, label, trend }) => `
            <div class="sbds-meter" data-meter="${key}">
                <div class="sbds-meter-reading"><span>${label}</span><strong>—</strong></div>
                ${trend
                    ? '<svg viewBox="0 0 84 12" preserveAspectRatio="none" aria-hidden="true"><polyline /></svg>'
                    : '<div class="sbds-meter-track" aria-hidden="true"><span></span></div>'}
            </div>
        `).join("")}
    </div>`;

export function createResourceMonitor(container, readStats) {
    const cards = metrics.map(({ key, label, trend }) => {
        const card = container.querySelector(`[data-meter="${key}"]`);
        return {
            key, label, card, trend, samples: [],
            name: card.querySelector(".sbds-meter-reading span"),
            reading: card.querySelector("strong"),
            graph: card.querySelector(trend ? "polyline" : ".sbds-meter-track span"),
        };
    });
    let timer;
    let active = false;
    let fetching = false;

    function render(stats, unavailableReason) {
        for (const { key, label, card, trend, samples, name, reading, graph } of cards) {
            const value = Number.isFinite(stats[key]) ? Math.max(0, Math.min(100, stats[key])) : null;
            const title = key === "gpu" && stats.gpuName ? stats.gpuName : label;
            name.textContent = title.replace(/^NVIDIA GeForce\s+/i, "");
            reading.textContent = value === null ? "—" : `${Math.round(value)}%`;
            const used = stats[`${key}UsedMiB`];
            const total = stats[`${key}TotalMiB`];
            card.title = value === null ? unavailableReason || `${title} unavailable` : `${title} · ${reading.textContent}`;
            if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
                card.title += ` · ${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GiB`;
            }
            if (trend) {
                if (value === null) samples.length = 0;
                else samples.push(value);
                if (samples.length > 22) samples.shift();
                const points = samples.map((sample, index) =>
                    `${84 - 4 * (samples.length - 1 - index)},${11 - sample / 10}`
                );
                graph.setAttribute("points", points.join(" "));
            } else {
                graph.style.width = `${value ?? 0}%`;
            }
        }
    }

    async function refresh() {
        if (!active || fetching) return;
        fetching = true;
        try {
            const stats = await readStats();
            if (active) render(stats);
        } catch (error) {
            if (active) render({}, error.message);
        } finally {
            fetching = false;
        }
    }

    return {
        start() {
            if (active) return;
            active = true;
            void refresh();
            timer = setInterval(refresh, 2500);
        },
        stop() {
            active = false;
            clearInterval(timer);
        },
        refresh,
    };
}
