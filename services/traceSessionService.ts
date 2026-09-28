import type { ParsedTrace, TrackerProject } from '../types';
import { renderProjectToTrace } from './projectLoaderService';

export interface ImportedTraceSession {
    trace: ParsedTrace;
    project: TrackerProject | null;
}

/** A generated editor view must never replace its original cycle stream. */
export function selectPlaybackTrace(project: TrackerProject, imported: ImportedTraceSession | null, clock: number): ParsedTrace {
    if (imported && project === imported.project) {
        const source = imported.trace;
        const sourceClock = source.header.clock ?? 985248;
        if (clock === sourceClock) return source;
        // An explicit chip-clock change runs the same cycles at a new rate.
        // Adjust snapshot FPS too, so the visual playhead still matches audio.
        const sourceFps = source.header.fps ?? (sourceClock >= 1_000_000 ? 60 : 50);
        return { ...source, header: { ...source.header, clock, fps: sourceFps * clock / sourceClock } };
    }
    const rendered = renderProjectToTrace(project, clock);
    return { ...rendered, header: { ...imported?.trace.header, ...rendered.header } };
}

export function selectMidiExportTrace(current: ParsedTrace, project: TrackerProject | null,
    imported: ImportedTraceSession | null, clock: number, useProject: boolean): ParsedTrace {
    return useProject && project ? renderProjectToTrace(project, clock) : imported?.trace ?? current;
}
