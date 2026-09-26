"""Enhanced SID file data structures with complete format support and utilities"""
from dataclasses import dataclass, field
from typing import Literal, List, Optional


@dataclass
class SidHeader:
    """Complete SID file header information (PSID/RSID v1-v4)"""
    # Magic & Version
    magic: str  # 'PSID' or 'RSID'
    version: int  # 1, 2, 3, or 4
    
    # Addresses
    data_offset: int
    load_address: int
    init_address: int
    play_address: int
    
    # Song information
    songs: int
    start_song: int
    speed: int  # 32-bit bitfield
    
    # Text fields
    title: str
    author: str
    released: str
    
    # Version 2+ fields
    flags: int = 0
    start_page: int = 0
    page_length: int = 0
    second_sid_address: int = 0
    third_sid_address: int = 0
    
    # Derived information
    is_ntsc: bool = False
    clock_freq: int = 985248
    sid_model: Literal['6581', '8580', 'ANY'] = 'ANY'
    is_basic: bool = False
    is_compute_player_range: bool = False
    play_sid_sample: bool = False
    
    # Clock flags
    clock_unknown: bool = False
    clock_pal: bool = False
    clock_ntsc: bool = False
    clock_both: bool = False
    
    # SID model flags
    sid_unknown: bool = False
    sid_6581: bool = False
    sid_8580: bool = False
    sid_both: bool = False
    
    # RSID specific
    is_rsid: bool = False
    requires_c64_env: bool = False
    
    # Version 3+ fields
    second_sid_model: Literal['6581', '8580', 'ANY'] = 'ANY'
    third_sid_model: Literal['6581', '8580', 'ANY'] = 'ANY'
    
    # Reserved
    reserved: bytes = field(default_factory=bytes)
    
    def __str__(self) -> str:
        """Human-readable string representation"""
        lines = [
            f"{'='*60}",
            f"SID File: {self.title}",
            f"{'='*60}",
            f"Format: {self.magic} v{self.version}",
            f"Author: {self.author}",
            f"Released: {self.released}",
            f"",
            f"Songs: {self.songs} (default: {self.start_song})",
            f"Clock: {'NTSC' if self.is_ntsc else 'PAL'} ({self.clock_freq:,} Hz)",
            f"SID Model: {self.sid_model}",
            f"",
            f"Load: ${self.load_address:04X}",
            f"Init: ${self.init_address:04X}",
            f"Play: ${self.play_address:04X}",
        ]
        
        if self.second_sid_address:
            addr = 0xD000 | (self.second_sid_address << 4)
            lines.append(f"2nd SID: ${addr:04X} ({self.second_sid_model})")
        
        if self.third_sid_address:
            addr = 0xD000 | (self.third_sid_address << 4)
            lines.append(f"3rd SID: ${addr:04X} ({self.third_sid_model})")
        
        lines.append(f"{'='*60}")
        return "\n".join(lines)
    
    def get_sid_count(self) -> int:
        """Get number of SID chips"""
        count = 1
        if self.second_sid_address: count += 1
        if self.third_sid_address: count += 1
        return count
    
    def get_total_voices(self) -> int:
        """Get total number of voices"""
        return self.get_sid_count() * 3
    
    def validate(self) -> List[str]:
        """Validate header and return list of issues"""
        issues = []
        
        if self.magic not in ('PSID', 'RSID'):
            issues.append(f"Invalid magic: {self.magic}")
        
        if self.version < 1 or self.version > 4:
            issues.append(f"Invalid version: {self.version}")
        
        if self.songs < 1 or self.songs > 256:
            issues.append(f"Invalid song count: {self.songs}")
        
        if self.start_song < 1 or self.start_song > self.songs:
            issues.append(f"Invalid start song: {self.start_song}")
        
        if self.load_address >= 0x10000:
            issues.append(f"Invalid load address: ${self.load_address:04X}")
        
        return issues


@dataclass
class SidVoiceStatus:
    """Complete SID voice status"""
    freq_reg: int
    freq_hz: float
    midi_note: float
    pitch_bend: float
    envelope: float
    gate: bool
    waveform: int
    raw_waveform: int
    pulse: int
    attack: int
    decay: int
    sustain: int
    release: int
    sync: bool
    ring_mod: bool
    test: bool
    state: Literal['attack', 'decay', 'sustain', 'release']
    
    # Extended
    note_on: bool = False
    note_name: str = ""
    waveform_names: List[str] = field(default_factory=list)
    
    def __post_init__(self):
        """Calculate derived fields"""
        # Determine if note is actually playing
        self.note_on = self.gate and self.envelope > 0.01 and self.freq_reg > 0
        
        # Calculate note name
        if self.midi_note > 0:
            notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            note_num = int(round(self.midi_note))
            octave = (note_num // 12) - 1
            note = notes[note_num % 12]
            self.note_name = f"{note}{octave}"
        
        # Decode waveform names
        self.waveform_names = []
        if self.waveform & 0x01: self.waveform_names.append("Triangle")
        if self.waveform & 0x02: self.waveform_names.append("Sawtooth")
        if self.waveform & 0x04: self.waveform_names.append("Pulse")
        if self.waveform & 0x08: self.waveform_names.append("Noise")
    
    def __str__(self) -> str:
        """Human-readable string"""
        wave = "+".join(self.waveform_names) if self.waveform_names else "OFF"
        status = "ON" if self.note_on else "OFF"
        note_str = f" ({self.note_name})" if self.note_name else ""
        return (f"Freq={self.freq_hz:7.2f}Hz{note_str} Wave={wave:12s} "
                f"Gate={status} Env={self.envelope:.3f} ADSR={self.attack:X}{self.decay:X}"
                f"{self.sustain:X}{self.release:X}")


@dataclass
class SidFilterStatus:
    """SID filter status"""
    cutoff: int
    resonance: int
    mode: int
    vol: int
    on: bool
    routing: int
    
    # Extended (calculated)
    cutoff_hz: float = 0.0
    mode_names: List[str] = field(default_factory=list)
    voice_1_filtered: bool = False
    voice_2_filtered: bool = False
    voice_3_filtered: bool = False
    ext_filtered: bool = False
    voice_3_off: bool = False
    
    def __post_init__(self):
        """Calculate derived fields"""
        # Approximate cutoff frequency (simplified formula)
        self.cutoff_hz = self.cutoff * 5.8 + 30
        
        # Decode mode
        self.mode_names = []
        if self.mode & 0x01: self.mode_names.append("Low-pass")
        if self.mode & 0x02: self.mode_names.append("Band-pass")
        if self.mode & 0x04: self.mode_names.append("High-pass")
        
        # Decode routing
        self.voice_1_filtered = (self.routing & 0x01) != 0
        self.voice_2_filtered = (self.routing & 0x02) != 0
        self.voice_3_filtered = (self.routing & 0x04) != 0
        self.ext_filtered = (self.routing & 0x08) != 0
    
    def __str__(self) -> str:
        """Human-readable string"""
        modes = "+".join(self.mode_names) if self.mode_names else "OFF"
        routed = []
        if self.voice_1_filtered: routed.append("V1")
        if self.voice_2_filtered: routed.append("V2")
        if self.voice_3_filtered: routed.append("V3")
        routing_str = "+".join(routed) if routed else "None"
        return (f"Cutoff={self.cutoff_hz:.1f}Hz Res={self.resonance} "
                f"Mode={modes} Vol={self.vol} Route={routing_str}")


@dataclass
class SidDumpFrame:
    """Single frame of SID register dump"""
    frame: int
    time: float
    cycles: int
    registers: List[int]
    voices: List[SidVoiceStatus]
    filter: SidFilterStatus
    
    # Multi-SID
    sid2_voices: Optional[List[SidVoiceStatus]] = None
    sid2_filter: Optional[SidFilterStatus] = None
    sid3_voices: Optional[List[SidVoiceStatus]] = None
    sid3_filter: Optional[SidFilterStatus] = None
    
    # CPU snapshot (optional)
    cpu_pc: Optional[int] = None
    cpu_a: Optional[int] = None
    cpu_x: Optional[int] = None
    cpu_y: Optional[int] = None
    cpu_sp: Optional[int] = None
    cpu_flags: Optional[int] = None


@dataclass
class SidDump:
    """Complete SID dump with metadata"""
    metadata: SidHeader
    frames: List[SidDumpFrame]
    total_duration: float
    frame_count: int
    pcm_samples: Optional[list] = None
    
    # Statistics
    peak_envelope_levels: Optional[List[float]] = None
    waveforms_used: Optional[List[int]] = None
    note_range: Optional[tuple] = None
    uses_filter: bool = False
    uses_second_sid: bool = False
    uses_third_sid: bool = False
    
    def calculate_statistics(self):
        """Calculate statistics from frames"""
        if not self.frames:
            return
        
        # Peak envelopes per voice
        num_voices = self.metadata.get_total_voices()
        self.peak_envelope_levels = [0.0] * num_voices
        
        # Track waveforms
        waveforms = set()
        min_note = 999
        max_note = 0
        
        for frame in self.frames:
            # Primary SID
            for i, voice in enumerate(frame.voices):
                self.peak_envelope_levels[i] = max(
                    self.peak_envelope_levels[i], 
                    voice.envelope
                )
                if voice.gate and voice.waveform:
                    waveforms.add(voice.waveform)
                    if voice.midi_note > 0:
                        min_note = min(min_note, voice.midi_note)
                        max_note = max(max_note, voice.midi_note)
            
            # Filter usage
            if frame.filter.on:
                self.uses_filter = True
            
            # Secondary SID
            if frame.sid2_voices:
                self.uses_second_sid = True
                for i, voice in enumerate(frame.sid2_voices):
                    idx = 3 + i
                    if idx < len(self.peak_envelope_levels):
                        self.peak_envelope_levels[idx] = max(
                            self.peak_envelope_levels[idx],
                            voice.envelope
                        )
            
            # Tertiary SID
            if frame.sid3_voices:
                self.uses_third_sid = True
                for i, voice in enumerate(frame.sid3_voices):
                    idx = 6 + i
                    if idx < len(self.peak_envelope_levels):
                        self.peak_envelope_levels[idx] = max(
                            self.peak_envelope_levels[idx],
                            voice.envelope
                        )
        
        self.waveforms_used = sorted(list(waveforms))
        self.note_range = (min_note, max_note) if max_note > 0 else None
    
    def get_summary(self) -> str:
        """Get summary statistics"""
        lines = [
            f"SID Dump Summary:",
            f"  Duration: {self.total_duration:.2f}s",
            f"  Frames: {self.frame_count}",
            f"  SID Chips: {self.metadata.get_sid_count()}",
            f"  Total Voices: {self.metadata.get_total_voices()}",
        ]
        
        if self.peak_envelope_levels:
            lines.append(f"  Peak Envelopes: {', '.join(f'{x:.3f}' for x in self.peak_envelope_levels)}")
        
        if self.waveforms_used:
            wave_names = {
                1: "Tri", 2: "Saw", 3: "Tri+Saw", 4: "Pul",
                5: "Tri+Pul", 6: "Saw+Pul", 7: "Tri+Saw+Pul",
                8: "Noise", 15: "All"
            }
            waves = [wave_names.get(w, f"${w:X}") for w in self.waveforms_used]
            lines.append(f"  Waveforms: {', '.join(waves)}")
        
        if self.note_range:
            lines.append(f"  Note Range: {self.note_range[0]:.0f} - {self.note_range[1]:.0f}")
        
        lines.append(f"  Filter Used: {'Yes' if self.uses_filter else 'No'}")
        
        return "\n".join(lines)


@dataclass
class C64SystemSnapshot:
    """Complete C64 system state snapshot"""
    # CPU
    cpu_pc: int
    cpu_a: int
    cpu_x: int
    cpu_y: int
    cpu_sp: int
    cpu_flags: int
    cpu_cycles: int
    
    # CIA
    cia1_timer_a: int
    cia1_timer_b: int
    cia1_cra: int
    cia1_crb: int
    cia2_timer_a: int
    cia2_timer_b: int
    cia2_cra: int
    cia2_crb: int
    
    # VIC-II
    vic_raster_line: int
    vic_irq_status: int
    
    # Memory samples
    zero_page: bytes
    stack: bytes
    vectors: bytes
    
    # PLA
    memory_config: int
    
    # Label
    label: str = ""


# Utility functions

def decode_waveform(waveform: int) -> List[str]:
    """Decode waveform byte to list of waveform names"""
    names = []
    if waveform & 0x01: names.append("Triangle")
    if waveform & 0x02: names.append("Sawtooth")
    if waveform & 0x04: names.append("Pulse")
    if waveform & 0x08: names.append("Noise")
    return names


def midi_note_to_name(midi_note: float) -> str:
    """Convert MIDI note number to note name (e.g., 69 -> A4)"""
    if midi_note <= 0:
        return ""
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    note_num = int(round(midi_note))
    octave = (note_num // 12) - 1
    note = notes[note_num % 12]
    return f"{note}{octave}"


def frequency_to_midi(freq_hz: float) -> float:
    """Convert frequency in Hz to MIDI note number"""
    if freq_hz < 4:
        return 0.0
    import math
    return 69 + 12 * math.log2(freq_hz / 440.0)


def sid_freq_to_hz(freq_reg: int, clock_freq: int) -> float:
    """Convert SID frequency register to Hz"""
    return (freq_reg * clock_freq) / 16777216


def hz_to_sid_freq(freq_hz: float, clock_freq: int) -> int:
    """Convert Hz to SID frequency register value"""
    return int((freq_hz * 16777216) / clock_freq)
