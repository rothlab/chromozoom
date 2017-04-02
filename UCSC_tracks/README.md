# Setup

This script requires Python 3.5 and packages that can be installed with `conda` or `pip`, along with the following [Jim Kent binaries][jksrc]:

- `bedToBigBed`
- `bigBedToBed`
- `bigBedInfo`
- `fetchChromSizes`
- `pslToBigPsl`

[jksrc]: http://hgdownload.cse.ucsc.edu/admin/exe/

The standard Unix utilities `rsync`, `awk`, `cut`, `sort`, and `zcat` are also employed (already installed on Macs, easily installed on any Linux via your package manager).

To setup the Python environment you can use `conda` or `virtualenv` + `pip`.

## Using `conda`

On most computers (particularly Macs) it is easiest to install [Anaconda](https://www.continuum.io/downloads), and then:

    $ conda create --name track_scraper --file conda-requirements.txt
    $ source activate track_scraper
    $ python get_tracks.py

## Using `virtualenv` and `pip`

1. You need Python 3.5 and libxml >2.9.x to be installed and accessible on PATH. If you're on Minerva, `source minerva-modules.sh` will load them, plus the Jim Kent binaries listed above.

2. To set up a virtual environment, run

            $ virtualenv -p `which python3` venv

3. Run `source bin/env/activate` to activate this environment. You should now see `(venv)` at the beginning of your prompt.

4. Run `pip install -r requirements.txt` to locally install required packages.

*Important:* Re-run steps (1) and (3) in any new shell to re-activate the virtualenv before you use this script.

# Usage

`cd` into this directory, activate the environment as necessary if you used `virtualenv`, and 

    $ python get_tracks.py

If you only want to fetch tracks for organism databases matching a prefix, e.g. `hg38`,

    $ python get_tracks.py --org_prefix=hg38

