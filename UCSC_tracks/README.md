# Setup

This script requires Python 3.5 and various packages/libraries, along with the following [Jim Kent binaries][jksrc]:

- `bedToBigBed`
- `fetchChromSizes`

[jksrc]: http://hgdownload.cse.ucsc.edu/admin/exe/

To setup the Python environment you can use `conda` or `virtualenv` + `pip`.

## Using `conda`

On most computers (particularly Macs) it is easiest to install [Anaconda](https://www.continuum.io/downloads), and then:

    $ conda create --name track_scraper --file conda-requirements.txt
    $ source activate track_scraper
    $ python get_tracks.py

## Using `virtualenv` and `pip`

1. You need Python 3.5 and libxml >2.9.x to be installed and accessible on PATH. If you're on Minerva, `source minerva-modules.sh` will load them.

2. Run: `virtualenv -p \`which python3\` venv` to set up a Python virtual environment.

3. Run: `source bin/env/activate` to activate this environment. You should now see `(venv)` at the beginning of your prompt.

4. Run: `pip install -r requirements.txt` to locally install required packages.

*Important:* Re-run the first three steps in any new shell before you use this script.

# Usage

`cd` into this directory, activate the environment as necessary if you used `virtualenv`, and 

    $ python get_tracks.py

If you only want to fetch tracks for organism databases matching a prefix, e.g. `hg38`,

    $ python get_tracks.py --org_prefix=hg38
