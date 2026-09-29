/** MIDI note ownership, separate from SID envelope/release-tail state. */
export interface AllocatedNote {
    id: number;
    channel: number;
    note: number;
    velocity: number;
    keyDown: boolean;
    voice: number | null;
}

export class VoiceAllocator {
    readonly slots: (AllocatedNote | null)[] = [null, null, null];
    private notes = new Map<number, AllocatedNote>();
    private queues = new Map<number, number[]>();
    private pedals = new Set<number>();
    private sequence = 0;
    private releasedAt = [0, 0, 0];

    constructor(private loudness: (note: AllocatedNote) => number = note => note.velocity) {}

    noteOn(channel: number, note: number, velocity: number) {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15 ||
            !Number.isInteger(note) || note < 0 || note > 127 ||
            !Number.isFinite(velocity) || velocity <= 0 || velocity > 127) {
            throw new Error('Invalid allocator note-on');
        }
        const candidates = this.slots.map((entry, voice) => ({ entry, voice }));
        candidates.sort((a, b) => {
            if (!a.entry || !b.entry) return Number(!!a.entry) - Number(!!b.entry) || this.releasedAt[a.voice] - this.releasedAt[b.voice] || a.voice - b.voice;
            return Number(a.entry.keyDown) - Number(b.entry.keyDown)
                || this.loudness(a.entry) - this.loudness(b.entry)
                || a.entry.id - b.entry.id;
        });
        const voice = candidates[0].voice;
        const previous = this.slots[voice];
        const stolen = previous ? { ...previous } : null;
        if (previous) {
            // Keep a held stolen instance in its FIFO: its eventual note-off
            // must be consumed without releasing a newer note of that pitch.
            previous.voice = null;
            if (!previous.keyDown) this.notes.delete(previous.id);
        }
        const entry: AllocatedNote = { id: ++this.sequence, channel, note, velocity, keyDown: true, voice };
        this.slots[voice] = entry;
        this.notes.set(entry.id, entry);
        const key = channel * 128 + note;
        const queue = this.queues.get(key) ?? [];
        queue.push(entry.id);
        this.queues.set(key, queue);
        return { voice, entry, stolen };
    }

    private release(entry: AllocatedNote): AllocatedNote | null {
        const released = entry.voice === null ? null : { ...entry };
        if (entry.voice !== null) {
            this.slots[entry.voice] = null;
            this.releasedAt[entry.voice] = ++this.sequence;
        }
        entry.voice = null;
        this.notes.delete(entry.id);
        return released;
    }

    noteOff(channel: number, note: number): AllocatedNote | null {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15 ||
            !Number.isInteger(note) || note < 0 || note > 127) return null;
        const key = channel * 128 + note;
        const queue = this.queues.get(key);
        const id = queue?.shift();
        if (!queue?.length) this.queues.delete(key);
        if (id === undefined) return null;
        const entry = this.notes.get(id);
        if (!entry) return null;
        entry.keyDown = false;
        if (entry.voice !== null && this.pedals.has(channel)) return null;
        return this.release(entry);
    }

    setSustain(channel: number, enabled: boolean): AllocatedNote[] {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15) return [];
        if (enabled) { this.pedals.add(channel); return []; }
        this.pedals.delete(channel);
        const released: AllocatedNote[] = [];
        for (const entry of this.notes.values()) {
            if (entry.channel === channel && !entry.keyDown) {
                const result = this.release(entry);
                if (result) released.push(result);
            }
        }
        return released;
    }

    allNotesOff(channel: number, honorSustain = true): AllocatedNote[] {
        if (!Number.isInteger(channel) || channel < 0 || channel > 15) return [];
        const released: AllocatedNote[] = [];
        for (const key of this.queues.keys()) if (Math.floor(key / 128) === channel) this.queues.delete(key);
        for (const entry of this.notes.values()) {
            if (entry.channel !== channel) continue;
            entry.keyDown = false;
            if (honorSustain && this.pedals.has(channel) && entry.voice !== null) continue;
            const result = this.release(entry);
            if (result) released.push(result);
        }
        return released;
    }

    /** An autonomous drum envelope ended; retain held-key FIFO ownership. */
    retireVoice(voice: number) {
        const entry = this.slots[voice];
        if (!entry) return;
        this.slots[voice] = null;
        this.releasedAt[voice] = ++this.sequence;
        entry.voice = null;
        if (!entry.keyDown) this.notes.delete(entry.id);
    }

    get activeNotes(): readonly AllocatedNote[] {
        return Array.from(this.notes.values()).filter(entry => entry.keyDown || entry.voice !== null);
    }
}

/** Unison is a rendering choice, never duplicated allocator ownership. */
export function voiceLayout(allocator: VoiceAllocator, unison = false): (AllocatedNote | null)[] {
    const sounding = allocator.slots.filter((note): note is AllocatedNote => note !== null);
    return unison && sounding.length === 1 ? [sounding[0], sounding[0], sounding[0]] : [...allocator.slots];
}
