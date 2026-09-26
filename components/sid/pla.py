
class PLA:
    def decode(self, addr, loram, hiram, charen):
        if 0xA000 <= addr <= 0xBFFF and hiram and loram:
            return "BASIC"
        if 0xE000 <= addr <= 0xFFFF and hiram:
            return "KERNAL"
        if 0xD000 <= addr <= 0xDFFF and charen:
            return "IO"
        return "RAM"
