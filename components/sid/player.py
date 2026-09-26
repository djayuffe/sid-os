"""SID player that converts SID files to JSON dumps"""

from typing import Optional
from .parser import parse_sid_header
from .sidtypes import SidDump, SidDumpFrame
from .system import C64System
from .logger import system_logger


class SidPlayer:
    """SID music player and converter"""
    
    def __init__(self):
        self.c64 = C64System()
    
    def convert_to_json(
        self,
        file_data: bytes,
        duration_secs: int = 60,
        song_num: int = 1,
        dump_states: bool = False,
        *,
        cpu_trace: bool = False,
        cpu_trace_max: Optional[int] = None,
        cpu_trace_bus: bool = False,
        vic_trace: bool = False,
        vic_trace_max_lines: Optional[int] = None,
        sid_strict: bool = False,
        sid_model: str = "6581",
        force_rsid: bool = False,
        rom_dir: Optional[str] = None,
    ) -> SidDump:
        """
        Convert a SID file to JSON format by emulating playback.
        
        Args:
            file_data: Raw SID file bytes
            duration_secs: Duration to capture in seconds
            song_num: Song number to play (1-based)
            
        Returns:
            SidDump object containing metadata and frame data
        """
        system_logger.log('Player', f'Parsing SID file ({len(file_data)} bytes)...', 'info')
        header, sid_data = parse_sid_header(file_data)
        
        system_logger.log('Player', f'Loading: {header.title}', 'info')
        system_logger.log('Player', f'Author: {header.author}', 'info')
        system_logger.log('Player', f'Released: {header.released}', 'info')
        system_logger.log('Player', f'Format: {header.magic} v{header.version}', 'debug')
        system_logger.log('Player', f'Clock: {"NTSC" if header.is_ntsc else "PAL"} ({header.clock_freq} Hz)', 'info')
        system_logger.log('Player', f'Songs: {header.songs}, Starting: {header.start_song}', 'debug')
        system_logger.log('Player', f'Load: ${header.load_address:04X}, Init: ${header.init_address:04X}, Play: ${header.play_address:04X}', 'debug')
        
        # RSID requires a more "real" environment. We don't try to run the KERNAL ROM
        # boot sequence (too heavy), but we do install a reset-like bootstrap and
        # avoid PSID-only dummy IRQ vectors.
        rsid_mode = bool(force_rsid or header.is_rsid or header.requires_c64_env)

        if rom_dir is not None:
            self.c64.set_rom_dir(rom_dir)

        self.c64.init(
            header.is_ntsc,
            header.clock_freq,
            sid_strict=sid_strict,
            sid_model=sid_model,
            rsid=rsid_mode,
        )

        # Optional instruction trace (Phase 1 CPU timing debug)
        if cpu_trace:
            if system_logger.verbosity < 4:
                system_logger.set_verbosity(4)
            self.c64.cpu.set_trace(True, cpu_trace_max, bus=cpu_trace_bus)

        # Optional VIC line trace (Phase 3 bus contention debug)
        if vic_trace:
            if system_logger.verbosity < 4:
                system_logger.set_verbosity(4)
            self.c64.vic.set_trace(True, vic_trace_max_lines)

        # Load SID data into memory
        system_logger.log('Player', f'Loading {len(sid_data)} bytes to ${header.load_address:04X}...', 'info')
        for i, byte in enumerate(sid_data):
            if header.load_address + i < 65536:
                self.c64.ram[header.load_address + i] = byte
        
        if dump_states:
            self.c64.log_memory_region("Loaded SID Data", header.load_address, min(64, len(sid_data)))
        
        init_addr = header.init_address if header.init_address != 0 else header.load_address

        # --- Init / Boot path ---
        # PSID: jump straight into init with an RTS trap.
        # RSID: install a small bootstrap at $0800 and start via RESET vector.
        if not rsid_mode:
            # Setup init call
            self.c64.cpu.a = song_num - 1
            self.c64.cpu.x = 0
            self.c64.cpu.y = 0
            self.c64.cpu.pc = init_addr

            # Trap RTS (return from init) by putting 0xFFFF on stack
            self.c64.cpu.sp = 0xFD
            self.c64.ram[0x01FF] = 0xFF
            self.c64.ram[0x01FE] = 0xFE
        else:
            # Bootstrap sets up stack + $00/$01 banking, calls init, then JMP $FFFF.
            self.c64.install_rsid_bootstrap(init_addr, song_num=song_num)
            self.c64.cpu.reset()
        
        if dump_states:
            self.c64.log_system_state("Before Init")
        
        # Run init (until sentinel)
        system_logger.log('Player', f'Executing init at ${init_addr:04X} (song #{song_num})...', 'info')
        cycles_executed = self.c64.cpu.execute(2000000, 0xFFFF)
        system_logger.log('Player', f'Init complete ({cycles_executed} cycles executed)', 'debug')
        
        if dump_states:
            self.c64.log_system_state("After Init")
        
        system_logger.log('Player', self.c64._bank_state_dump(), 'debug')
        system_logger.log('Player', self.c64._rom_state_dump(), 'debug')
        system_logger.log('Player', 'Starting playback emulation...', 'info')
        
        frames = []
        refresh_rate = 60 if header.is_ntsc else 50
        cycles_per_frame = header.clock_freq // refresh_rate
        total_frames = duration_secs * refresh_rate
        
        system_logger.log('Player', f'Target: {total_frames} frames @ {refresh_rate} Hz', 'info')
        system_logger.log('Player', f'Cycles per frame: {cycles_per_frame}', 'debug')
        
        # Playback strategy:
        # - PSID: call play routine each frame (if present).
        # - RSID:
        #    * If play_address != 0, call it each frame (many modern RSIDs still provide it).
        #    * Else, try "fake IRQ" calls into the RAM IRQ vector ($0314/$0315) once per frame.
        is_psid_style = not rsid_mode
        
        play_addr = header.play_address
        if play_addr != 0:
            system_logger.log('Player', f'Play routine at ${play_addr:04X}', 'debug')

        irq_ram_vec = (self.c64.ram[0x0314] | (self.c64.ram[0x0315] << 8)) & 0xFFFF
        if rsid_mode and play_addr == 0:
            system_logger.log('Player', f'RSID: RAM IRQ vector ($0314) = ${irq_ram_vec:04X}', 'info')
        
        silence_frame_count = 0
        silence_threshold_frames = 3 * refresh_rate  # 3 seconds of silence to stop
        
        # Progress reporting
        progress_interval = refresh_rate * 5  # Every 5 seconds
        
        for f in range(total_frames):
            start_cycles = self.c64.cpu.cycles
            frame_cycles = 0
            
            if play_addr != 0:
                # PSID OR RSID-with-explicit-play: call play routine each frame
                self.c64.cpu.sp = 0xFD
                self.c64.ram[0x01FF] = 0xFF
                self.c64.ram[0x01FE] = 0xFE
                self.c64.cpu.pc = play_addr

                # Run until RTS or frame cycles exhausted
                while self.c64.cpu.pc != 0xFFFF and frame_cycles < cycles_per_frame:
                    self.c64.step()
                    frame_cycles = self.c64.cpu.cycles - start_cycles

                # Fill remaining cycles
                while frame_cycles < cycles_per_frame:
                    self.c64.step()
                    frame_cycles = self.c64.cpu.cycles - start_cycles
            elif rsid_mode and irq_ram_vec not in (0x0000, 0xFFFF, 0xFF00):
                # RSID fallback: simulate a periodic IRQ by jumping into the RAM IRQ vector.
                # We prepare a stack frame so the routine can finish with RTI and return
                # to the sentinel $FFFF (end of "fake IRQ" call).
                self.c64.cpu.sp = 0xFC
                self.c64.ram[0x01FD] = (self.c64.cpu.p | 0x20 | 0x04) & 0xFF  # U + I set, B clear
                self.c64.ram[0x01FE] = 0xFF
                self.c64.ram[0x01FF] = 0xFF
                self.c64.cpu.pc = irq_ram_vec

                # Run until RTI returns to sentinel or budget exhausted
                while self.c64.cpu.pc != 0xFFFF and frame_cycles < cycles_per_frame:
                    self.c64.step()
                    frame_cycles = self.c64.cpu.cycles - start_cycles

                while frame_cycles < cycles_per_frame:
                    self.c64.step()
                    frame_cycles = self.c64.cpu.cycles - start_cycles
            else:
                # RSID style (native): just run for frame duration.
                while frame_cycles < cycles_per_frame:
                    self.c64.step()
                    frame_cycles = self.c64.cpu.cycles - start_cycles
            
            # Get SID snapshot
            voices, filter_status = self.c64.sid.get_snapshot()
            
            # Copy registers
            regs_array = list(self.c64.ram[0xD400:0xD419])
            
            # Auto-silence detection
            max_env = max(v.envelope for v in voices)
            
            if max_env < 0.001:
                silence_frame_count += 1
            else:
                silence_frame_count = 0
            
            if silence_frame_count > silence_threshold_frames:
                system_logger.log(
                    'Player', 
                    f'Auto-stop: Detected {silence_threshold_frames/refresh_rate:.1f}s of silence at frame {f}', 
                    'warn'
                )
                break
            
            # Progress reporting
            if f > 0 and f % progress_interval == 0:
                elapsed = f / refresh_rate
                percent = (f / total_frames) * 100
                system_logger.log('Player', f'Progress: {elapsed:.1f}s / {duration_secs}s ({percent:.1f}%)', 'info')
                
                if dump_states and f % (refresh_rate * 10) == 0:  # Every 10 seconds
                    self.c64.log_system_state(f"Frame {f} State")
                    system_logger.log('SID', self.c64.sid.get_register_dump(bytes(regs_array)), 'debug')
            
            # First frame state dump
            if dump_states and f == 0:
                self.c64.log_system_state("First Frame State")
                self.c64.sid.log_all_voices()
            
            frames.append(SidDumpFrame(
                frame=f,
                time=f / refresh_rate,
                cycles=frame_cycles,
                registers=regs_array,
                voices=voices,
                filter=filter_status
            ))
        
        final_duration = len(frames) / refresh_rate
        system_logger.log('Player', f'Capture complete: {len(frames)} frames, {final_duration:.2f}s', 'info')
        
        return SidDump(
            metadata=header,
            frames=frames,
            total_duration=final_duration,
            frame_count=len(frames)
        )
