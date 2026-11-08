const categories = [
    ["Speaker", "amber", ["Speaker 1:", "Speaker 2:"]],
    ["Language", "mint", ["lang:English", "lang:Persian", "lang:Spanish", "lang:French", "lang:Chinese", "lang:Japanese", "lang:Korean", "lang:Arabic", "lang:Portuguese", "lang:Russian"]],
    ["Emotion", "rose", ["emotion:happy", "emotion:sad", "emotion:angry", "emotion:scared", "emotion:surprised", "emotion:calm"]],
    ["Delivery", "blue", ["style:whispered", "style:shouted", "style:sung", "prosody:slowly", "prosody:quickly"]],
    ["Vocal Effects", "lilac", ["sfx:laugh", "sfx:cough", "sfx:sigh", "sfx:sneeze", "sfx:cry"]],
];

const cuePattern = /\bSpeaker [12]:|\[(lang|emotion|style|prosody|sfx):[^\]\r\n]+\]/gi;
const cueColors = { lang: "mint", emotion: "rose", style: "blue", prosody: "blue", sfx: "lilac" };

export const cueEditorView = `
    <div class="sbds-prompt-heading">
        <label for="sbds-studio-dialogue-prompt">Prompt</label>
        <div class="sbds-cue-bar" data-cue-bar role="group" aria-label="Insert a cue">
            <span>Insert a Cue:</span>
            ${categories.map(([name, color, values], index) => `
                <div class="sbds-cue-group" data-color="${color}">
                    <button type="button" class="sbds-cue-trigger" popovertarget="sbds-cue-${index}">${name}</button>
                    <div class="sbds-cue-menu" id="sbds-cue-${index}" popover="auto" role="group" aria-label="${name} cues">
                        ${values.map(value => {
                            const speaker = index === 0;
                            const label = speaker ? value.slice(0, -1) : value.split(":")[1];
                            return `<button type="button" data-cue="${speaker ? value : `[${value}]`}">${label}</button>`;
                        }).join("")}
                    </div>
                </div>`).join("")}
        </div>
    </div>
    <div class="sbds-cue-editor">
        <div class="sbds-cue-mirror" data-cue-mirror aria-hidden="true" dir="auto"></div>
        <textarea id="sbds-studio-dialogue-prompt" data-clip="prompt" rows="3" maxlength="16000" dir="auto"></textarea>
    </div>`;

export function bindCueEditor(section) {
    const bar = section.querySelector("[data-cue-bar]");
    const prompt = section.querySelector('[data-clip="prompt"]');
    const mirror = section.querySelector("[data-cue-mirror]");

    function syncScroll() {
        mirror.scrollTop = prompt.scrollTop;
        mirror.scrollLeft = prompt.scrollLeft;
    }

    function highlight() {
        const value = prompt.value;
        const content = document.createDocumentFragment();
        let offset = 0;
        if (!bar.hidden) {
            for (const match of value.matchAll(cuePattern)) {
                const mark = document.createElement("span");
                mark.dataset.color = match[1] ? cueColors[match[1].toLowerCase()] : "amber";
                mark.textContent = match[0];
                content.append(value.slice(offset, match.index), mark);
                offset = match.index + match[0].length;
            }
        }
        content.append(value.slice(offset), "\u200b");
        mirror.replaceChildren(content);
        syncScroll();
    }

    prompt.addEventListener("input", highlight);
    prompt.addEventListener("scroll", syncScroll);
    for (const menu of bar.querySelectorAll("[popover]")) {
        const trigger = menu.previousElementSibling;
        menu.addEventListener("beforetoggle", event => {
            if (event.newState !== "open") return;
            const rect = trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom - 8;
            const above = rect.top - 8;
            const openAbove = below < 150 && above > below;
            menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 154))}px`;
            menu.style.top = openAbove ? "auto" : `${rect.bottom + 4}px`;
            menu.style.bottom = openAbove ? `${window.innerHeight - rect.top + 4}px` : "auto";
            menu.style.maxHeight = `${Math.max(60, (openAbove ? above : below) - 4)}px`;
        });
        menu.addEventListener("click", event => {
            const button = event.target.closest("[data-cue]");
            if (!button) return;
            const { selectionStart, selectionEnd, value } = prompt;
            const prefix = selectionStart && !/\s/.test(value[selectionStart - 1]) ? " " : "";
            const suffix = value[selectionEnd] && /\s/.test(value[selectionEnd]) ? "" : " ";
            const insertion = prefix + button.dataset.cue + suffix;
            if (value.length - (selectionEnd - selectionStart) + insertion.length > prompt.maxLength) return;
            menu.hidePopover();
            prompt.focus();
            prompt.setRangeText(insertion, selectionStart, selectionEnd, "end");
            prompt.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    return {
        show(dialogue) {
            if (!dialogue) bar.querySelector(":popover-open")?.hidePopover();
            bar.hidden = !dialogue;
            highlight();
        },
        close() { bar.querySelector(":popover-open")?.hidePopover(); },
    };
}
