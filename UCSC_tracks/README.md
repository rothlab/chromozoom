To run the UCSC track scraper, which requires Python3 and certain packages, it is easiest to install [Anaconda](https://www.continuum.io/downloads), and then:

    $ conda create --name track_scraper --file conda-requirements.txt
    $ source activate track_scraper
    $ python get_tracks.py