"""Enhanced SID file parser with complete PSID/RSID v1-v4 support"""
import struct
from typing import Tuple
from .sidtypes import SidHeader
from .logger import system_logger

PAL_CLOCK = 985248
NTSC_CLOCK = 1022730

def parse_sid_header(data: bytes, verbose: bool = True) -> Tuple[SidHeader, bytes]:
    """Parse complete SID file header (PSID/RSID v1-v4)"""
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    if len(data) < 0x7C:
        raise ValueError(f"File too small: {len(data)} bytes")
    
    # Magic ID
    magic_id = data[0:4].decode('ascii', errors='ignore')
    if magic_id not in ('PSID', 'RSID'):
        raise ValueError(f'Invalid magic: {magic_id}')
    
    is_rsid = (magic_id == 'RSID')
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Version
    version = struct.unpack('>H', data[4:6])[0]
    if version < 1 or version > 4:
        raise ValueError(f'Unsupported version: {version}')
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Addresses
    data_offset = struct.unpack('>H', data[6:8])[0]
    load_address = struct.unpack('>H', data[8:10])[0]
    init_address = struct.unpack('>H', data[10:12])[0]
    play_address = struct.unpack('>H', data[12:14])[0]
    
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Songs
    songs = struct.unpack('>H', data[14:16])[0]
    if songs < 1: songs = 1
    start_song = struct.unpack('>H', data[16:18])[0]
    if start_song < 1 or start_song > songs: start_song = 1
    
    speed = struct.unpack('>I', data[18:22])[0]
    
    # Text fields
    title = data[0x16:0x36].decode('iso-8859-1', errors='replace').rstrip('\x00')
    author = data[0x36:0x56].decode('iso-8859-1', errors='replace').rstrip('\x00')
    released = data[0x56:0x76].decode('iso-8859-1', errors='replace').rstrip('\x00')
    
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Version 2+ fields
    flags = 0
    start_page = 0
    page_length = 0
    second_sid_address = 0
    third_sid_address = 0
    
    if version >= 2 and len(data) >= 0x78:
        flags = struct.unpack('>H', data[0x76:0x78])[0]
        if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    if version >= 2 and len(data) >= 0x7A:
        start_page = data[0x78]
        page_length = data[0x79]
    
    if version >= 2 and len(data) >= 0x7B:
        second_sid_address = data[0x7A]
        if second_sid_address != 0 and verbose:
            actual_addr = 0xD000 | (second_sid_address << 4)
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    if version >= 3 and len(data) >= 0x7C:
        third_sid_address = data[0x7B]
        if third_sid_address != 0 and verbose:
            actual_addr = 0xD000 | (third_sid_address << 4)
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Clock detection
    clock_unknown = (flags & 0x0C) == 0x00
    clock_pal = (flags & 0x04) != 0
    clock_ntsc = (flags & 0x08) != 0
    clock_both = clock_pal and clock_ntsc
    
    is_ntsc = clock_ntsc and not clock_pal
    clock_freq = NTSC_CLOCK if is_ntsc else PAL_CLOCK
    
    if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # SID model
    sid_unknown = (flags & 0x30) == 0x00
    sid_6581 = (flags & 0x20) != 0
    sid_8580 = (flags & 0x10) != 0
    sid_both = sid_6581 and sid_8580
    
    if sid_both:
        sid_model = 'ANY'
    elif sid_8580:
        sid_model = '8580'
    elif sid_6581:
        sid_model = '6581'
    else:
        sid_model = 'ANY'
    
    # Second/Third SID models
    second_sid_model = 'ANY'
    third_sid_model = 'ANY'
    if version >= 3:
        if second_sid_address != 0:
            bits = (flags >> 6) & 0x03
            second_sid_model = _decode_sid_model(bits)
        if third_sid_address != 0:
            bits = (flags >> 8) & 0x03
            third_sid_model = _decode_sid_model(bits)
    
    # Other flags
    is_basic = (flags & 0x02) != 0
    is_compute_player_range = (flags & 0x01) != 0
    play_sid_sample = (flags & 0x0400) != 0
    requires_c64_env = is_rsid
    
    # Extract music data
    if data_offset > len(data):
        raise ValueError(f'Data offset ${data_offset:04X} exceeds file size')
    
    memory_data = data[data_offset:]
    
    # Handle embedded load address
    if load_address == 0:
        if len(memory_data) < 2:
            raise ValueError("No load address")
        load_address = memory_data[0] | (memory_data[1] << 8)
        memory_data = memory_data[2:]
        if verbose:
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    if verbose:
        end_addr = load_address + len(memory_data) - 1
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    system_logger.log('Parser', f'Songs: {songs} (default: {start_song})', 'info')
    
    # Build header
    header = SidHeader(
        magic=magic_id,
        version=version,
        data_offset=data_offset,
        load_address=load_address,
        init_address=init_address if init_address != 0 else load_address,
        play_address=play_address,
        songs=songs,
        start_song=start_song,
        speed=speed,
        title=title,
        author=author,
        released=released,
        flags=flags,
        start_page=start_page,
        page_length=page_length,
        second_sid_address=second_sid_address,
        third_sid_address=third_sid_address,
        is_ntsc=is_ntsc,
        clock_freq=clock_freq,
        sid_model=sid_model,
        is_basic=is_basic,
        is_compute_player_range=is_compute_player_range,
        play_sid_sample=play_sid_sample,
        clock_unknown=clock_unknown,
        clock_pal=clock_pal,
        clock_ntsc=clock_ntsc,
        clock_both=clock_both,
        sid_unknown=sid_unknown,
        sid_6581=sid_6581,
        sid_8580=sid_8580,
        sid_both=sid_both,
        is_rsid=is_rsid,
        requires_c64_env=requires_c64_env,
        second_sid_model=second_sid_model,
        third_sid_model=third_sid_model,
        reserved=bytes()
    )
    
    return header, memory_data


def _decode_sid_model(bits: int) -> str:
    """Decode 2-bit SID model field"""
    models = {0: 'ANY', 1: '6581', 2: '8580', 3: 'ANY'}
    return models.get(bits, 'ANY')