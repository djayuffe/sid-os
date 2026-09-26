"""
Explicit system bus arbiter.

Controls ownership and RDY behavior per cycle.
"""


class Bus:
    def __init__(self):
        self.owner = "CPU"
        self.rdy = True

    def steal(self, owner):
        self.owner = owner
        self.rdy = False

    def release(self):
        self.owner = "CPU"
        self.rdy = True
