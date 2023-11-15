import hashlib
from os import system

from pyteal import (
    compileTeal,
    Mode,
    Expr,
    OptimizeOptions,
)

def fullyCompileContract(genTeal, contract: Expr, name, devmode) -> bytes:
    if genTeal:
        if devmode:
            teal = compileTeal(contract, mode=Mode.Application, version=6, assembleConstants=True)
        else:
            teal = compileTeal(contract, mode=Mode.Application, version=6, assembleConstants=True, optimize=OptimizeOptions(scratch_slots=True))

        with open(name, "w") as f:
            print("Writing " + name)
            f.write(teal)
    else:
        with open(name, "r") as f:
            print("Reading " + name)
            teal = f.read()

    status = system(f"goal clerk compile --map --outfile '{name + '.bin'}' '{name}' ")
    if status != 0:
        raise Exception("Failed to compile")

    with open(name + ".bin", "rb") as contractBin:
        with open(name + ".hash", "w") as fout:
            binary = contractBin.read()
            checksum = hashlib.new("sha512_256")
            checksum.update(binary)
            fout.write(checksum.hexdigest())

    return binary