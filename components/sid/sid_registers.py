"""
Complete MOS 6581/8580 SID Register Definitions and Utilities

This module provides complete register definitions, bit masks, and utility
functions for working with SID chip registers.
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional
from enum import IntEnum


# ============================================================================
# BASE ADDRESSES
# ============================================================================

SID_BASE = 0xD400
SID_REGISTERS = 29  # $D400-$D41C


# ============================================================================
# REGISTER OFFSETS
# ============================================================================

class SIDRegister(IntEnum):
    """SID register offsets from base address"""
    
    # Voice 1
    FRELO1 = 0x00   # Frequency Low
    FREHI1 = 0x01   # Frequency High
    PWLO1  = 0x02   # Pulse Width Low
    PWHI1  = 0x03   # Pulse Width High
    VCREG1 = 0x04   # Control Register
    ATDCY1 = 0x05   # Attack/Decay
    SUREL1 = 0x06   # Sustain/Release
    
    # Voice 2
    FRELO2 = 0x07
    FREHI2 = 0x08
    PWLO2  = 0x09
    PWHI2  = 0x0A
    VCREG2 = 0x0B
    ATDCY2 = 0x0C
    SUREL2 = 0x0D
    
    # Voice 3
    FRELO3 = 0x0E
    FREHI3 = 0x0F
    PWLO3  = 0x10
    PWHI3  = 0x11
    VCREG3 = 0x12
    ATDCY3 = 0x13
    SUREL3 = 0x14
    
    # Filter and Global
    CUTLO  = 0x15   # Filter Cutoff Low
    CUTHI  = 0x16   # Filter Cutoff High
    RESON  = 0x17   # Resonance + Filter Routing
    SIGVOL = 0x18   # Filter Mode + Volume
    
    # Read-only
    POTX   = 0x19   # Paddle X
    POTY   = 0x1A   # Paddle Y
    OSC3   = 0x1B   # Oscillator 3 Output
    ENV3   = 0x1C   # Envelope 3 Output


# ============================================================================
# CONTROL REGISTER BIT MASKS
# ============================================================================

class ControlBits(IntEnum):
    """Control register bit masks"""
    GATE      = 0x01  # Bit 0: Gate (0=off, 1=on)
    SYNC      = 0x02  # Bit 1: Sync oscillator
    RING_MOD  = 0x04  # Bit 2: Ring modulation
    TEST      = 0x08  # Bit 3: Test (disable oscillator)
    TRIANGLE  = 0x10  # Bit 4: Triangle waveform
    SAWTOOTH  = 0x20  # Bit 5: Sawtooth waveform
    PULSE     = 0x40  # Bit 6: Pulse waveform
    NOISE     = 0x80  # Bit 7: Noise waveform


class WaveformBits(IntEnum):
    """Waveform selection bits (bits 4-7 of control register)"""
    NONE            = 0x00
    TRIANGLE        = 0x10
    SAWTOOTH        = 0x20
    TRIANGLE_SAW    = 0x30
    PULSE           = 0x40
    TRIANGLE_PULSE  = 0x50
    SAWTOOTH_PULSE  = 0x60
    TRI_SAW_PULSE   = 0x70
    NOISE           = 0x80


# ============================================================================
# FILTER REGISTER BIT MASKS
# ============================================================================

class FilterRoutingBits(IntEnum):
    """Filter routing bits in RESON register"""
    VOICE_1  = 0x01  # Bit 0: Filter Voice 1
    VOICE_2  = 0x02  # Bit 1: Filter Voice 2
    VOICE_3  = 0x04  # Bit 2: Filter Voice 3
    EXT      = 0x08  # Bit 3: Filter external input


class FilterModeBits(IntEnum):
    """Filter mode bits in SIGVOL register"""
    LOW_PASS  = 0x10  # Bit 4: Low-pass filter
    BAND_PASS = 0x20  # Bit 5: Band-pass filter
    HIGH_PASS = 0x40  # Bit 6: High-pass filter
    VOICE3_OFF = 0x80  # Bit 7: Disconnect Voice 3 output


# ============================================================================
# REGISTER GROUPS
# ============================================================================

@dataclass
class VoiceRegisters:
    """Register offsets for a single voice"""
    freq_lo: int
    freq_hi: int
    pw_lo: int
    pw_hi: int
    control: int
    attack_decay: int
    sustain_release: int


# Voice register groups
VOICE_REGISTERS = {
    1: VoiceRegisters(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06),
    2: VoiceRegisters(0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D),
    3: VoiceRegisters(0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14),
}


# ============================================================================
# ENUMS FOR REGISTER VALUES
# ============================================================================

class ADSRRate(IntEnum):
    """ADSR time values (approximate milliseconds)"""
    RATE_0  = 2      # Instant
    RATE_1  = 8      # Very fast
    RATE_2  = 16     # Fast
    RATE_3  = 24
    RATE_4  = 38
    RATE_5  = 56
    RATE_6  = 68
    RATE_7  = 80
    RATE_8  = 100    # Medium
    RATE_9  = 250
    RATE_10 = 500    # Slow
    RATE_11 = 800
    RATE_12 = 1000   # 1 second
    RATE_13 = 3000   # 3 seconds
    RATE_14 = 5000   # 5 seconds
    RATE_15 = 8000   # 8 seconds


# ============================================================================
# REGISTER METADATA
# ============================================================================

REGISTER_INFO = {
    'FRELO1': {'offset': 0x00, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Frequency Low'},
    'FREHI1': {'offset': 0x01, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Frequency High'},
    'PWLO1':  {'offset': 0x02, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Pulse Width Low'},
    'PWHI1':  {'offset': 0x03, 'size': 4, 'type': 'W', 'desc': 'Voice 1 Pulse Width High'},
    'VCREG1': {'offset': 0x04, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Control'},
    'ATDCY1': {'offset': 0x05, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Attack/Decay'},
    'SUREL1': {'offset': 0x06, 'size': 8, 'type': 'W', 'desc': 'Voice 1 Sustain/Release'},
    
    'FRELO2': {'offset': 0x07, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Frequency Low'},
    'FREHI2': {'offset': 0x08, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Frequency High'},
    'PWLO2':  {'offset': 0x09, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Pulse Width Low'},
    'PWHI2':  {'offset': 0x0A, 'size': 4, 'type': 'W', 'desc': 'Voice 2 Pulse Width High'},
    'VCREG2': {'offset': 0x0B, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Control'},
    'ATDCY2': {'offset': 0x0C, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Attack/Decay'},
    'SUREL2': {'offset': 0x0D, 'size': 8, 'type': 'W', 'desc': 'Voice 2 Sustain/Release'},
    
    'FRELO3': {'offset': 0x0E, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Frequency Low'},
    'FREHI3': {'offset': 0x0F, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Frequency High'},
    'PWLO3':  {'offset': 0x10, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Pulse Width Low'},
    'PWHI3':  {'offset': 0x11, 'size': 4, 'type': 'W', 'desc': 'Voice 3 Pulse Width High'},
    'VCREG3': {'offset': 0x12, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Control'},
    'ATDCY3': {'offset': 0x13, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Attack/Decay'},
    'SUREL3': {'offset': 0x14, 'size': 8, 'type': 'W', 'desc': 'Voice 3 Sustain/Release'},
    
    'CUTLO':  {'offset': 0x15, 'size': 8, 'type': 'W', 'desc': 'Filter Cutoff Low'},
    'CUTHI':  {'offset': 0x16, 'size': 3, 'type': 'W', 'desc': 'Filter Cutoff High'},
    'RESON':  {'offset': 0x17, 'size': 8, 'type': 'W', 'desc': 'Resonance + Routing'},
    'SIGVOL': {'offset': 0x18, 'size': 8, 'type': 'W', 'desc': 'Filter Mode + Volume'},
    
    'POTX':   {'offset': 0x19, 'size': 8, 'type': 'R', 'desc': 'Paddle X'},
    'POTY':   {'offset': 0x1A, 'size': 8, 'type': 'R', 'desc': 'Paddle Y'},
    'OSC3':   {'offset': 0x1B, 'size': 8, 'type': 'R', 'desc': 'Oscillator 3 Output'},
    'ENV3':   {'offset': 0x1C, 'size': 8, 'type': 'R', 'desc': 'Envelope 3 Output'},
}


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def frequency_to_register(freq_hz: float, clock_hz: int = 985248) -> int:
    """
    Convert frequency in Hz to 16-bit SID frequency register value.
    
    Args:
        freq_hz: Desired frequency in Hz
        clock_hz: SID clock frequency (985248 for PAL, 1022730 for NTSC)
    
    Returns:
        16-bit frequency register value (0-65535)
    """
    return int((freq_hz * 16777216) / clock_hz)


def register_to_frequency(freq_reg: int, clock_hz: int = 985248) -> float:
    """
    Convert 16-bit SID frequency register value to Hz.
    
    Args:
        freq_reg: 16-bit frequency register value
        clock_hz: SID clock frequency
    
    Returns:
        Frequency in Hz
    """
    return (freq_reg * clock_hz) / 16777216


def pulse_width_to_duty_cycle(pw: int) -> float:
    """
    Convert 12-bit pulse width value to duty cycle percentage.
    
    Args:
        pw: Pulse width value (0-4095)
    
    Returns:
        Duty cycle as percentage (0.0-100.0)
    """
    return (pw / 4096) * 100


def duty_cycle_to_pulse_width(duty_percent: float) -> int:
    """
    Convert duty cycle percentage to 12-bit pulse width value.
    
    Args:
        duty_percent: Duty cycle percentage (0.0-100.0)
    
    Returns:
        12-bit pulse width value (0-4095)
    """
    return int((duty_percent / 100) * 4096)


def cutoff_to_frequency(cutoff: int) -> float:
    """
    Approximate filter cutoff register value to frequency in Hz.
    
    Args:
        cutoff: 11-bit cutoff value (0-2047)
    
    Returns:
        Approximate frequency in Hz
    
    Note: This is an approximation. Actual frequency varies by chip.
    """
    return (cutoff * 5.8) + 30


def frequency_to_cutoff(freq_hz: float) -> int:
    """
    Approximate frequency in Hz to filter cutoff register value.
    
    Args:
        freq_hz: Desired cutoff frequency in Hz
    
    Returns:
        11-bit cutoff value (0-2047)
    """
    cutoff = int((freq_hz - 30) / 5.8)
    return max(0, min(2047, cutoff))


def split_frequency(freq: int) -> Tuple[int, int]:
    """
    Split 16-bit frequency into low and high bytes.
    
    Args:
        freq: 16-bit frequency value
    
    Returns:
        Tuple of (low_byte, high_byte)
    """
    return (freq & 0xFF, (freq >> 8) & 0xFF)


def combine_frequency(low: int, high: int) -> int:
    """
    Combine low and high bytes into 16-bit frequency.
    
    Args:
        low: Low byte (0-255)
        high: High byte (0-255)
    
    Returns:
        16-bit frequency value
    """
    return low | (high << 8)


def split_pulse_width(pw: int) -> Tuple[int, int]:
    """
    Split 12-bit pulse width into low and high parts.
    
    Args:
        pw: 12-bit pulse width value
    
    Returns:
        Tuple of (low_byte, high_nybble)
    """
    return (pw & 0xFF, (pw >> 8) & 0x0F)


def combine_pulse_width(low: int, high: int) -> int:
    """
    Combine low byte and high nybble into 12-bit pulse width.
    
    Args:
        low: Low byte (0-255)
        high: High nybble (0-15)
    
    Returns:
        12-bit pulse width value
    """
    return low | ((high & 0x0F) << 8)


def make_attack_decay(attack: int, decay: int) -> int:
    """
    Create ATDCY register value from attack and decay rates.
    
    Args:
        attack: Attack rate (0-15)
        decay: Decay rate (0-15)
    
    Returns:
        8-bit ATDCY value
    """
    return ((attack & 0x0F) << 4) | (decay & 0x0F)


def split_attack_decay(atdcy: int) -> Tuple[int, int]:
    """
    Extract attack and decay rates from ATDCY register.
    
    Args:
        atdcy: 8-bit ATDCY value
    
    Returns:
        Tuple of (attack, decay)
    """
    return ((atdcy >> 4) & 0x0F, atdcy & 0x0F)


def make_sustain_release(sustain: int, release: int) -> int:
    """
    Create SUREL register value from sustain and release.
    
    Args:
        sustain: Sustain level (0-15)
        release: Release rate (0-15)
    
    Returns:
        8-bit SUREL value
    """
    return ((sustain & 0x0F) << 4) | (release & 0x0F)


def split_sustain_release(surel: int) -> Tuple[int, int]:
    """
    Extract sustain and release from SUREL register.
    
    Args:
        surel: 8-bit SUREL value
    
    Returns:
        Tuple of (sustain, release)
    """
    return ((surel >> 4) & 0x0F, surel & 0x0F)


def decode_control_register(control: int) -> Dict[str, bool]:
    """
    Decode control register into individual flags.
    
    Args:
        control: 8-bit control register value
    
    Returns:
        Dictionary with flag names and boolean values
    """
    return {
        'gate': bool(control & ControlBits.GATE),
        'sync': bool(control & ControlBits.SYNC),
        'ring_mod': bool(control & ControlBits.RING_MOD),
        'test': bool(control & ControlBits.TEST),
        'triangle': bool(control & ControlBits.TRIANGLE),
        'sawtooth': bool(control & ControlBits.SAWTOOTH),
        'pulse': bool(control & ControlBits.PULSE),
        'noise': bool(control & ControlBits.NOISE),
    }


def decode_waveform(control: int) -> List[str]:
    """
    Extract waveform names from control register.
    
    Args:
        control: 8-bit control register value
    
    Returns:
        List of active waveform names
    """
    waveforms = []
    if control & ControlBits.TRIANGLE:
        waveforms.append('Triangle')
    if control & ControlBits.SAWTOOTH:
        waveforms.append('Sawtooth')
    if control & ControlBits.PULSE:
        waveforms.append('Pulse')
    if control & ControlBits.NOISE:
        waveforms.append('Noise')
    return waveforms


def decode_filter_routing(reson: int) -> Dict[str, bool]:
    """
    Decode filter routing from RESON register.
    
    Args:
        reson: 8-bit RESON register value
    
    Returns:
        Dictionary with routing flags
    """
    return {
        'voice_1': bool(reson & FilterRoutingBits.VOICE_1),
        'voice_2': bool(reson & FilterRoutingBits.VOICE_2),
        'voice_3': bool(reson & FilterRoutingBits.VOICE_3),
        'external': bool(reson & FilterRoutingBits.EXT),
        'resonance': (reson >> 4) & 0x0F,
    }


def decode_filter_mode(sigvol: int) -> Dict[str, any]:
    """
    Decode filter mode and volume from SIGVOL register.
    
    Args:
        sigvol: 8-bit SIGVOL register value
    
    Returns:
        Dictionary with mode flags and volume
    """
    return {
        'low_pass': bool(sigvol & FilterModeBits.LOW_PASS),
        'band_pass': bool(sigvol & FilterModeBits.BAND_PASS),
        'high_pass': bool(sigvol & FilterModeBits.HIGH_PASS),
        'voice3_off': bool(sigvol & FilterModeBits.VOICE3_OFF),
        'volume': sigvol & 0x0F,
    }


def get_voice_registers(voice: int) -> VoiceRegisters:
    """
    Get register offsets for a specific voice.
    
    Args:
        voice: Voice number (1, 2, or 3)
    
    Returns:
        VoiceRegisters object with offsets
    
    Raises:
        ValueError: If voice is not 1, 2, or 3
    """
    if voice not in VOICE_REGISTERS:
        raise ValueError(f"Invalid voice number: {voice} (must be 1, 2, or 3)")
    return VOICE_REGISTERS[voice]


# ============================================================================
# REGISTER STATE CLASS
# ============================================================================

@dataclass
class SIDRegisterState:
    """Complete state of all SID registers"""
    # Voice 1
    v1_freq: int = 0
    v1_pw: int = 0
    v1_control: int = 0
    v1_attack_decay: int = 0
    v1_sustain_release: int = 0
    
    # Voice 2
    v2_freq: int = 0
    v2_pw: int = 0
    v2_control: int = 0
    v2_attack_decay: int = 0
    v2_sustain_release: int = 0
    
    # Voice 3
    v3_freq: int = 0
    v3_pw: int = 0
    v3_control: int = 0
    v3_attack_decay: int = 0
    v3_sustain_release: int = 0
    
    # Filter
    filter_cutoff: int = 0
    filter_resonance_routing: int = 0
    filter_mode_volume: int = 0
    
    def to_bytes(self) -> bytes:
        """Convert register state to 29-byte array"""
        data = bytearray(29)
        
        # Voice 1
        data[0x00], data[0x01] = split_frequency(self.v1_freq)
        data[0x02], data[0x03] = split_pulse_width(self.v1_pw)
        data[0x04] = self.v1_control
        data[0x05] = self.v1_attack_decay
        data[0x06] = self.v1_sustain_release
        
        # Voice 2
        data[0x07], data[0x08] = split_frequency(self.v2_freq)
        data[0x09], data[0x0A] = split_pulse_width(self.v2_pw)
        data[0x0B] = self.v2_control
        data[0x0C] = self.v2_attack_decay
        data[0x0D] = self.v2_sustain_release
        
        # Voice 3
        data[0x0E], data[0x0F] = split_frequency(self.v3_freq)
        data[0x10], data[0x11] = split_pulse_width(self.v3_pw)
        data[0x12] = self.v3_control
        data[0x13] = self.v3_attack_decay
        data[0x14] = self.v3_sustain_release
        
        # Filter and global
        cutlo, cuthi = split_pulse_width(self.filter_cutoff)  # 11-bit like PW
        data[0x15] = cutlo
        data[0x16] = cuthi
        data[0x17] = self.filter_resonance_routing
        data[0x18] = self.filter_mode_volume
        
        return bytes(data)
    
    @classmethod
    def from_bytes(cls, data: bytes) -> 'SIDRegisterState':
        """Create register state from 29-byte array"""
        if len(data) < 29:
            raise ValueError(f"Data must be at least 29 bytes, got {len(data)}")
        
        return cls(
            # Voice 1
            v1_freq=combine_frequency(data[0x00], data[0x01]),
            v1_pw=combine_pulse_width(data[0x02], data[0x03]),
            v1_control=data[0x04],
            v1_attack_decay=data[0x05],
            v1_sustain_release=data[0x06],
            
            # Voice 2
            v2_freq=combine_frequency(data[0x07], data[0x08]),
            v2_pw=combine_pulse_width(data[0x09], data[0x0A]),
            v2_control=data[0x0B],
            v2_attack_decay=data[0x0C],
            v2_sustain_release=data[0x0D],
            
            # Voice 3
            v3_freq=combine_frequency(data[0x0E], data[0x0F]),
            v3_pw=combine_pulse_width(data[0x10], data[0x11]),
            v3_control=data[0x12],
            v3_attack_decay=data[0x13],
            v3_sustain_release=data[0x14],
            
            # Filter
            filter_cutoff=combine_pulse_width(data[0x15], data[0x16]),
            filter_resonance_routing=data[0x17],
            filter_mode_volume=data[0x18],
        )
