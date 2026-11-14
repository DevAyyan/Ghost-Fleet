import os

# Tests use the synthetic panel (known planted answers). The app itself defaults to real data.
os.environ.setdefault("GHOSTFLEET_DATA", "synthetic")
