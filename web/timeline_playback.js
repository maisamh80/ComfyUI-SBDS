export function createTimelinePlayback(onTime, onStop) {
    let context;
    let sources = [];
    let started;
    let animation;
    let ticket = 0;
    const decoded = new Map();

    function stop() {
        ++ticket;
        cancelAnimationFrame(animation);
        for (const source of sources) {
            try { source.stop(); } catch {}
            source.disconnect();
        }
        sources = [];
        started = undefined;
        onStop();
    }

    function audio(url) {
        if (!decoded.has(url)) {
            const request = fetch(url).then(response => {
                if (!response.ok) throw new Error("A timeline audio file could not be loaded.");
                return response.arrayBuffer();
            }).then(bytes => context.decodeAudioData(bytes)).catch(error => {
                decoded.delete(url);
                throw error;
            });
            decoded.set(url, request);
        }
        return decoded.get(url);
    }

    async function play(clips, from, end, urlFor) {
        stop();
        const current = ticket;
        context ??= new AudioContext();
        await context.resume();
        const items = clips.filter(clip => clip.media && clip.start + clip.duration > from);
        const buffers = await Promise.all(items.map(clip => audio(urlFor(clip.media))));
        if (current !== ticket) return false;
        started = context.currentTime + 0.04;
        items.forEach((clip, index) => {
            const buffer = buffers[index];
            const into = Math.max(0, from - clip.start);
            const offset = clip.offset + into;
            const duration = Math.min(clip.duration - into, buffer.duration - offset);
            if (duration <= 0) return;
            const when = started + Math.max(0, clip.start - from);
            const source = context.createBufferSource();
            source.buffer = buffer;
            const volume = context.createGain();
            const fadeIn = context.createGain();
            const fadeOut = context.createGain();
            volume.gain.value = 10 ** (clip.gain / 20);
            fadeIn.gain.setValueAtTime(clip.fadeIn ? Math.min(1, into / clip.fadeIn) : 1, when);
            if (clip.fadeIn > into) fadeIn.gain.linearRampToValueAtTime(1, when + clip.fadeIn - into);
            const fadeStart = clip.duration - clip.fadeOut;
            fadeOut.gain.setValueAtTime(!clip.fadeOut || into < fadeStart ? 1 : Math.max(0, (clip.duration - into) / clip.fadeOut), when);
            if (clip.fadeOut) {
                if (fadeStart > into) fadeOut.gain.setValueAtTime(1, when + fadeStart - into);
                fadeOut.gain.linearRampToValueAtTime(0, when + clip.duration - into);
            }
            source.connect(volume).connect(fadeIn).connect(fadeOut).connect(context.destination);
            source.start(when, offset, duration);
            source.onended = () => { source.disconnect(); volume.disconnect(); fadeIn.disconnect(); fadeOut.disconnect(); };
            sources.push(source);
        });
        function tick() {
            if (current !== ticket) return;
            const position = from + Math.max(0, context.currentTime - started);
            onTime(Math.min(end, position));
            if (position >= end) stop();
            else animation = requestAnimationFrame(tick);
        }
        animation = requestAnimationFrame(tick);
        return true;
    }

    return { play, stop, clear: () => { stop(); decoded.clear(); } };
}
