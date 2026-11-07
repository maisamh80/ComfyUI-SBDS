export const outputNode = "15";

export const modelInputs = {
    model: ["UNETLoader", "unet_name", /ltx.*distill/i],
    encoder: ["CLIPLoader", "clip_name", /gemma.*ltx/i],
    vae: ["VAELoader", "vae_name", /ltx.*audio.*vae/i],
    sampler: ["KSamplerSelect", "sampler_name", /^uni_pc$/],
    scheduler: ["BasicScheduler", "scheduler", /^simple$/],
};

const speakerAgeGroups = [
    { under: 6, roles: ["young boy", "young girl", "young child"], delivery: "with a young child's voice" },
    { under: 13, roles: ["school-age boy", "school-age girl", "school-age child"], delivery: "with a child's voice" },
    { under: 18, roles: ["teenage boy", "teenage girl", "teenager"] },
    { under: 30, roles: ["young man", "young woman", "young adult"] },
    { under: 45, roles: ["adult man", "adult woman", "adult"] },
    { under: 65, roles: ["middle-aged man", "middle-aged woman", "middle-aged adult"] },
    { under: 85, roles: ["older man", "older woman", "older adult"] },
    { under: Infinity, roles: ["very elderly man", "very elderly woman", "very elderly adult"] },
];

function describeSpeaker(voiceType, age) {
    const years = Number(age);
    const isAgeSet = Number.isInteger(years) && years >= 3 && years <= 100;
    if (!isAgeSet) {
        const voice = voiceType ? `${voiceType} voice` : "voice";
        return `${/^[aeiou]/i.test(voice) ? "An" : "A"} ${voice}.`;
    }

    const gender = voiceType.replace(/^cartoon-style /, "");
    const { roles, delivery } = speakerAgeGroups.find(({ under }) => years < under);
    const [boyOrMan, girlOrWoman, neutral] = roles;
    const role = gender === "male" ? boyOrMan : gender === "female" ? girlOrWoman : neutral;
    const speaker = voiceType.startsWith("cartoon-style ") ? `cartoon-style ${role}` : role;
    const article = /^[aeiou]/i.test(speaker) ? "An" : "A";
    return [
        `${article} ${speaker}, about ${years} years old, speaks${delivery ? ` ${delivery}` : ""}.`,
        gender === "androgynous" && "The speaker has an androgynous voice.",
    ].filter(Boolean).join(" ");
}

export function describeSound(text, voice = {}) {
    const { voiceType, age, mood, delivery, pitch, pace } = voice;
    const language = (voice.language === "custom" ? voice.customLanguage : voice.language)?.trim();
    const description = text.trim();
    if (!description || ![voiceType, age, mood, delivery, pitch, pace, language].some(Boolean)) return description;

    const speaking = [language && `in ${language}`, delivery, pace].filter(Boolean).join(" ");
    const quotedLine = /^(?:"[\s\S]+"|“[\s\S]+”)$/.test(description);
    return [
        describeSpeaker(voiceType ?? "", age),
        mood && `The voice sounds ${mood}.`,
        pitch && `The voice has a ${pitch} pitch${age ? " for the speaker's age" : ""}.`,
        speaking && `The speaker talks ${speaking}.`,
        quotedLine ? `The speaker says ${description}` : description,
    ].filter(Boolean).join(" ");
}

export function buildAudioGraph(options) {
    const { text, negative, model, encoder, vae, sampler, scheduler, steps, fps, seconds, seed, cfg } = options;
    const finalPrompt = options.finalPrompt ?? describeSound(text, options.voice);
    if (!finalPrompt.trim()) throw new Error("Describe the sound you want to generate.");
    if (![model, encoder, vae, sampler, scheduler].every(Boolean)) {
        throw new Error("Choose the model, text encoder, audio VAE, sampler and scheduler in Settings.");
    }
    const frames = 1 + 8 * Math.floor(seconds * fps / 8);
    if (!Number.isFinite(frames) || frames < 9 || frames > 1000) {
        throw new Error("Choose a duration and FPS that produce 9–1000 frames.");
    }
    const link = (id, index = 0) => [String(id), index];
    const node = (class_type, inputs) => ({ class_type, inputs });
    return {
        "1": node("UNETLoader", { unet_name: model, weight_dtype: "default" }),
        "2": node("LTXVAudioOnlyModel", { model: link(1) }),
        "3": node("CLIPLoader", { clip_name: encoder, type: "ltxv", device: "default" }),
        "4": node("VAELoader", { vae_name: vae }),
        "5": node("CLIPTextEncode", { text: finalPrompt, clip: link(3) }),
        "6": node("CLIPTextEncode", { text: negative, clip: link(3) }),
        "7": node("LTXVConditioning", { positive: link(5), negative: link(6), frame_rate: fps }),
        "8": node("LTXVEmptyLatentAudio", { audio_vae: link(4), frames_number: frames, frame_rate: fps, batch_size: 1 }),
        "9": node("LTXVAudioOnlyEmptyVideoLatent", {}),
        "10": node("LTXVConcatAVLatent", { video_latent: link(9), audio_latent: link(8) }),
        "11": node("CFGGuider", { model: link(2), positive: link(7), negative: link(7, 1), cfg }),
        "12": node("RandomNoise", { noise_seed: seed }),
        "13": node("KSamplerSelect", { sampler_name: sampler }),
        "14": node("BasicScheduler", { model: link(2), scheduler, steps, denoise: 1 }),
        "16": node("SamplerCustomAdvanced", { noise: link(12), guider: link(11), sampler: link(13), sigmas: link(14), latent_image: link(10) }),
        "17": node("LTXVSeparateAVLatent", { av_latent: link(16) }),
        "18": node("LTXVAudioVAEDecode", { samples: link(17, 1), audio_vae: link(4) }),
        [outputNode]: node("SaveAudio", { audio: link(18), filename_prefix: "audio/SBDS/take" }),
        "19": node("SBDSReleaseAfterTake", { saved_audio: link(outputNode) }),
    };
}
