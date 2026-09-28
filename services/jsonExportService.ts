
import { ParsedTrace, TrackerProject } from '../types';

export const exportTraceToJson = (traceData: ParsedTrace | null) => {
    if (!traceData) return;

    const exportData = {
        header: {
            ...traceData.header,
            exportedAt: new Date().toISOString(),
            generator: "SID_OS"
        },
        frames: traceData.frames.map(f => Array.from(f)),
        events: traceData.events
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    
    let filename = 'sid_trace_dump.json';
    if (traceData.header.originalFilename) {
        const base = traceData.header.originalFilename.replace(/\.[^/.]+$/, "");
        filename = `${base.replace(/[^a-z0-9\-_]/gi, '_')}.json`;
    } else if (traceData.header.song && traceData.header.song !== 'Unknown') {
        filename = `${traceData.header.song.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase()}.json`;
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const exportProjectToJson = (trackerProject: TrackerProject | undefined) => {
    if (!trackerProject) return;

    const exportData: TrackerProject = {
        meta: { ...trackerProject.meta },
        frameSpeed: trackerProject.frameSpeed || 6,
        frameRate: trackerProject.frameRate ?? 50,
        instruments: trackerProject.instruments,
        subtunes: trackerProject.subtunes,
        patterns: trackerProject.patterns,
        chordTable: trackerProject.chordTable || [],
        tempoTable: trackerProject.tempoTable || []
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const filename = trackerProject.meta.title 
        ? `${trackerProject.meta.title.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase()}_project.json` 
        : 'project_data.json';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
