import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "app" / "backend"), str(ROOT / "scripts")]


def pytest_collection_modifyitems(config, items):
    """Tests marked `databricks` hit the SQL warehouse; they only run with RUN_DATABRICKS_TESTS=1."""
    if os.environ.get("RUN_DATABRICKS_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="set RUN_DATABRICKS_TESTS=1 to run warehouse tests")
    for item in items:
        if "databricks" in item.keywords:
            item.add_marker(skip)
