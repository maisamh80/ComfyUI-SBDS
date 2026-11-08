import { buildAudioGraph, outputNode } from "./t2a.js";

const annotation = /\bSpeaker ([12]):|\[(lang|emotion|style|prosody|sfx):([^\]\r\n]+)\]/gi;
const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const deliveryVerbs = new Map([
    ["sung", "sings"],
    ["whispered", "whispers"],
    ["shouted", "shouts"],
]);

export function stripLegacyTiming(text) {
    return text.replace(/\[pause:[^\]\r\n]*\]/gi, " ");
}

export function compilePrompt(kind, text, references = []) {
    text = (kind === "dialogue" ? stripLegacyTiming(text) : text).trim();
    if (!text) throw new Error("Enter a prompt for this clip.");
    if (kind !== "dialogue") {
        const instruction = kind === "music" ? "Generate a music cue." : "Generate a sound effect.";
        return instruction + " " + text;
    }

    const lines = [];
    let speaker = 0;
    let directions = new Map();
    let index = 0;

    function addSpeech(value) {
        const words = value.trim();
        if (!words) return;
        const segments = directions.size ? sentences.segment(words) : [{ segment: words }];
        for (const { segment } of segments) {
            const line = segment.trim();
            if (!line) continue;
            const label = ["The speaker", "The first speaker", "The second speaker"][speaker];
            const slot = speaker || references.findIndex(Boolean) + 1;
            const identity = references[slot - 1] ? ", using the voice in Audio " + slot + "," : "";
            const style = directions.get("style");
            const verb = deliveryVerbs.get(style?.toLowerCase()) || "says";
            const language = directions.get("lang");
            const emotion = directions.get("emotion");
            const pace = directions.get("prosody");
            const sound = directions.get("sfx");
            const delivery = [
                language && "in " + language,
                emotion && (/^[aeiou]/i.test(emotion) ? "in an " : "in a ") + emotion + " tone",
                pace,
                style && verb === "says" && "with a " + style + " delivery",
                sound && "with a " + sound,
            ].filter(Boolean);
            lines.push([label + identity, verb, ...delivery].join(" ") + ", " + JSON.stringify(line));
            directions = new Map();
        }
    }

    for (const tag of text.matchAll(annotation)) {
        addSpeech(text.slice(index, tag.index));
        index = tag.index + tag[0].length;
        if (tag[1]) speaker = Number(tag[1]);
        else directions.set(tag[2].toLowerCase(), tag[3].trim());
    }
    addSpeech(text.slice(index));
    if (!lines.length) throw new Error("Enter the words to speak.");
    return lines.join("\n");
}

const referenceNodes = ["ComfyUILTX25MSRICLoRALoader", "ComfyUILTX25MSRMultiReferenceGuide",
    "EmptyImage", "EmptyLTXVLatentVideo", "LoadAudio", "LTXVAudioVAEEncode"];

function options(definitions, node, input) {
    const [values, settings] = definitions[node]?.input?.required?.[input] ?? [];
    return Array.isArray(values) ? values : settings?.options ?? [];
}

export async function referenceSetup(request, configure) {
    const definitions = await request("/object_info");
    if (referenceNodes.some(node => !definitions[node])) {
        throw new Error("Voice references need ComfyUI-LTX2.5-MSR. Install it and restart ComfyUI.");
    }
    const loras = options(definitions, referenceNodes[0], "lora_name");
    const vaes = options(definitions, "VAELoader", "vae_name");
    const { lora, vae } = configure;
    if (!lora || !vae || !loras.includes(lora) || !vaes.includes(vae)) {
        throw new Error("Choose an AVref LoRA and LTX Video VAE in Settings → Model setup.");
    }
    return { lora, vae };
}

export function referenceOptions(definitions) {
    return {
        loras: options(definitions, referenceNodes[0], "lora_name"),
        vaes: options(definitions, "VAELoader", "vae_name"),
    };
}

export function studioGraph(settings, references = [], referenceModels) {
    const graph = buildAudioGraph(settings);
    const slotCount = references.findLastIndex(Boolean) + 1;
    if (!slotCount) return graph;
    const node = (class_type, inputs) => ({ class_type, inputs });
    const link = (id, index = 0) => [String(id), index];
    graph["20"] = node(referenceNodes[0], { model: link(1), lora_name: referenceModels.lora, strength_model: 1 });
    graph["2"].inputs.model = link(20);
    graph["21"] = node("VAELoader", { vae_name: referenceModels.vae });
    graph["9"] = node("EmptyLTXVLatentVideo", {
        width: 96, height: 96, length: graph["8"].inputs.frames_number, batch_size: 1,
    });
    const guide = {
        positive: link(7), negative: link(7, 1), vae: link(21), latent: link(9), msr_parameters: link(20, 1),
        strength: 1, reference_frames: "33", use_tiled_encode: false, tile_size: 256, tile_overlap: 64,
    };
    // MSR requires contiguous image slots even when an audio slot is empty.
    for (const [index, audio] of references.slice(0, slotCount).entries()) {
        const n = 24 + index * 3;
        graph[n + 2] = node("EmptyImage", { width: 512, height: 512, batch_size: 1, color: 0xffffff });
        guide[`pic${index + 1}`] = link(n + 2);
        if (audio) {
            graph[n] = node("LoadAudio", { audio });
            graph[n + 1] = node("LTXVAudioVAEEncode", { audio: link(n), audio_vae: link(4) });
            guide[`audio_ref${index + 1}`] = link(n + 1);
        }
    }
    graph["22"] = node(referenceNodes[1], guide);
    graph["10"].inputs.video_latent = link(22, 2);
    graph["11"].inputs.positive = link(22);
    graph["11"].inputs.negative = link(22, 1);
    return graph;
}

export async function queueStudioTake(request, api, graph, setJob) {
    const queued = await request("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: api.clientId }),
    });
    if (!queued.prompt_id) throw new Error("ComfyUI did not return a job ID.");
    setJob(queued.prompt_id);
    try {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1200));
            const history = await request(`/history/${encodeURIComponent(queued.prompt_id)}`);
            const result = history[queued.prompt_id];
            if (!result) continue;
            const output = result.outputs?.[outputNode]?.audio?.[0];
            if (result.status?.status_str !== "error" && output) return output.filename;
            const detail = result.status?.messages?.find(([type]) => type === "execution_error")?.[1]?.exception_message;
            throw new Error(detail || "ComfyUI did not return a Studio audio file.");
        }
    } finally {
        setJob(null);
    }
}
