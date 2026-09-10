"""
conftest.py — pytest configuration for the tests/ package.

Adds app/services to sys.path so tests can import service modules
directly (e.g. `from sm2_service import ...`).
"""

import sys
from pathlib import Path

# Resolve <project-root>/app/services and add it to the front of sys.path
_services_dir = str(Path(__file__).resolve().parent.parent / "app" / "services")
if _services_dir not in sys.path:
    sys.path.insert(0, _services_dir)

# Also add the app directory itself for any app-level imports
_app_dir = str(Path(__file__).resolve().parent.parent / "app")
if _app_dir not in sys.path:
    sys.path.insert(0, _app_dir)
