
import { useEffect, useState } from 'react';
import { EditorCursor } from '../types';

interface KeyboardControls {
  onPlayPause: () => void;
  onRewind: () => void;
  onForward: () => void;
  onPrevPattern: () => void;
  onNextPattern: () => void;
  onToggleLoop: () => void;
}

export const useKeyboardControls = (controls: KeyboardControls) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          controls.onPlayPause();
          break;
        case 'ArrowUp':
          if (e.ctrlKey) { e.preventDefault(); controls.onPrevPattern(); }
          break;
        case 'ArrowDown':
          if (e.ctrlKey) { e.preventDefault(); controls.onNextPattern(); }
          break;
        case 'KeyL':
          if (e.ctrlKey) { e.preventDefault(); controls.onToggleLoop(); }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controls]);
};

const KEY_TO_NOTE: Record<string, string> = {
    'KeyZ': 'C-', 'KeyS': 'C#', 'KeyX': 'D-', 'KeyD': 'D#', 'KeyC': 'E-', 'KeyV': 'F-',
    'KeyG': 'F#', 'KeyB': 'G-', 'KeyH': 'G#', 'KeyN': 'A-', 'KeyJ': 'A#', 'KeyM': 'B-',
    'KeyQ': 'C-', 'Digit2': 'C#', 'KeyW': 'D-', 'Digit3': 'D#', 'KeyE': 'E-', 'KeyR': 'F-',
    'Digit5': 'F#', 'KeyT': 'G-', 'Digit6': 'G#', 'KeyY': 'A-', 'Digit7': 'A#', 'KeyU': 'B-'
};

const HEX_CHARS = new Set(['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f']);

interface TrackerInputProps {
    enabled: boolean;
    cursor: EditorCursor;
    setCursor: (c: EditorCursor) => void;
    onEdit: (cursor: EditorCursor, value: string) => void;
    step: number;
    patternLen: number;
    onSetNoteLength: (len: number) => void;
}

export const useTrackerInput = ({ enabled, cursor, setCursor, onEdit, step, patternLen, onSetNoteLength }: TrackerInputProps) => {
    const [octave, setOctave] = useState(4);

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
            
            // F1-F8 for octave control
            if (e.code.startsWith('F') && e.code.length <= 3) {
                const fNum = parseInt(e.code.substring(1));
                if (fNum >= 1 && fNum <= 8) {
                    e.preventDefault();
                    setOctave(fNum);
                    return;
                }
            }

            if (e.ctrlKey || e.metaKey) return; 

            const { patternIdx, row, channel, column } = cursor;

            // Navigation
            if (e.code === 'ArrowUp') {
                e.preventDefault();
                setCursor({ ...cursor, row: Math.max(0, row - 1) });
                return;
            }
            if (e.code === 'ArrowDown') {
                e.preventDefault();
                setCursor({ ...cursor, row: Math.min(patternLen - 1, row + 1) });
                return;
            }
            if (e.code === 'ArrowLeft') {
                e.preventDefault();
                if (column > 0) setCursor({ ...cursor, column: column - 1 });
                else if (channel > 0) setCursor({ ...cursor, channel: channel - 1, column: 4 });
                return;
            }
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                if (column < 4) setCursor({ ...cursor, column: column + 1 });
                else if (channel < 2) setCursor({ ...cursor, channel: channel + 1, column: 0 });
                return;
            }
            if (e.code === 'Tab') {
                e.preventDefault();
                const nextChan = e.shiftKey ? Math.max(0, channel - 1) : Math.min(2, channel + 1);
                setCursor({ ...cursor, channel: nextChan, column: 0 });
                return;
            }

            // Browser key-repeat is useful for navigation, but it is harmful
            // for tracker entry: holding a piano key would write a stream of
            // notes/gates and make the instrument sound stuck. Accept one
            // edit per physical key press after navigation has been handled.
            if (e.repeat && column >= 0 && column <= 4) return;

            // Erasure
            if (e.code === 'Delete' || e.code === 'Backspace') {
                e.preventDefault();
                if (column === 0) onEdit(cursor, '---');
                else if (column === 1) onEdit(cursor, '00');
                else if (column === 2) onEdit(cursor, '..');
                else if (column === 3) onEdit(cursor, '...');
                else if (column === 4) onEdit(cursor, '..');
                return;
            }

            // Note Entry
            if (column === 0) {
                if (KEY_TO_NOTE[e.code]) {
                    e.preventDefault();
                    const note = KEY_TO_NOTE[e.code];
                    const upperKeys = ['KeyQ','Digit2','KeyW','Digit3','KeyE','KeyR','Digit5','KeyT','Digit6','KeyY','Digit7','KeyU'];
                    const effectiveOctave = upperKeys.includes(e.code) ? octave + 1 : octave;
                    onEdit(cursor, `${note}${Math.min(9, effectiveOctave)}`);
                    setCursor({ ...cursor, row: Math.min(patternLen - 1, row + step) });
                } else if (e.code === 'Digit1') { 
                    e.preventDefault();
                    onEdit(cursor, '===');
                    setCursor({ ...cursor, row: Math.min(patternLen - 1, row + step) });
                }
                return;
            }

            // Hex Entry (INST, VOL, CMD, VAL)
            if (column >= 1 && column <= 4) {
                const char = e.key.toLowerCase();
                if (HEX_CHARS.has(char)) {
                    e.preventDefault();
                    onEdit(cursor, `HEX:${char.toUpperCase()}`);
                    
                    // Auto-step for single digit command field
                    if (column === 3) {
                      setCursor({ ...cursor, column: 4 });
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enabled, cursor, setCursor, onEdit, step, patternLen, onSetNoteLength, octave]);
};
