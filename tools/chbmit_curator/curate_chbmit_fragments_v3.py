#!/usr/bin/env python3
from __future__ import annotations

import curate_chbmit_fragments_v2 as v2

v2.CURATOR_VERSION = "v3"
v2.CURATOR_FAMILY = "v3-heuristic+yasa+subject-ictal-split"
v2.CURATOR_DESCRIPTION = (
    "Curate CHB-MIT fragments using V3 staging plus subject-specific ictal similarity."
)


if __name__ == "__main__":
    raise SystemExit(v2.main())
