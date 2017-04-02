# ChromoZoom

The goal of ChromoZoom is to make genome browsing online as effortless as navigating the world on Google Maps, while retaining superior data density and customizability, modeled off of the capabilities of [UCSC genome browser](http://genome.ucsc.edu/) and [IGV](http://software.broadinstitute.org/software/igv/).

All data is drawn directly in the browser using [canvas][] and [SVG][], similar to the approach of [igv.js][] and [pileup.js][]. Unlike these other projects, however, you do not need to download and install code onto a webserver to make full use of ChromoZoom. Instead of a demo instance, we instead intend to provide a first-class genome browsing experience at [chromozoom.org](http://chromozoom.org), with nearly all data from UCSC mirrored or immediately cross-loadable via extensive use of the [bigBed and bigWig formats][bbbw].

[canvas]: http://en.wikipedia.org/wiki/Canvas_element
[SVG]: http://en.wikipedia.org/wiki/Scalable_Vector_Graphics
[pileup.js]: https://github.com/hammerlab/pileup.js/
[igv.js]: https://github.com/igvteam/igv.js
[bbbw]: https://www.ncbi.nlm.nih.gov/pubmed/20639541

## License

ChromoZoom is free for academic, nonprofit, and personal use.  The source code is licensed under the [GNU Affero General Public License v3](http://www.gnu.org/licenses/agpl-3.0.html).  In a nutshell, this license means that you are free to copy, redistribute, and modify the source code, but you are expected to provide the source for any code derived from ChromoZoom to anybody that receives the modified code or uses it over a computer network (e.g. as a web application).  ChromoZoom is not free for commercial use.  For commercial licensing, please contact the [Roth laboratory](http://llama.mshri.on.ca).

## Requirements

To host ChromoZoom or run the UCSC track scraper, you need either macOS or Linux. For Windows users, we suggest 
[usage of our virtual environment](#running-in-virtual-environment).

The web interface should work in any recent version of a modern HTML5-capable web browser (Chrome, Firefox, Safari, IE ≥11).

### To serve the ChromoZoom web interface

Out of the box, ChromoZoom is serves a web interface that can display data on top of genome layouts crossloaded from UCSC, or data in [IGB Quickload directories][igbql]. You will need:

- PHP 5.x + Apache (or another webserver that can run PHP scripts)
    - Note that [magic quotes][16] must be **disabled**.
- [libcurl bindings for PHP][10] (included in OS X's default PHP install)
- If you would like to support the full range of custom tracks and genomes, you need the following on your `$PATH`, which during setup will be symlinked into a new directory in this repo called `bin/`:
    - [`tabix`][11], a generic indexer for TAB-delimited genome position files
    - [`samtools`][11], utilities for viewing for the Sequence Alignment/Map (SAM) and BAM (Binary SAM) formats
    - The following [Jim Kent binaries for big tracks][12]:
        - `bigBedInfo`
        - `bigBedSummary`
        - `bigBedToBed`
        - `bigWigSummary`
        - `bigWigInfo`
        - `twoBitToFa`

Place a checkout of this repo somewhere in your webserver's DOCROOT.  To setup the aforementioned symlinks to binaries, run `rake check` from the command line at the root of the repo.  Files under `php/` and `index.php` will need to be executable by the webserver.  Access `index.php` from a web browser to view the ChromoZoom interface.

**Note:** To view VCF/tabix or BAM files from `https://` URLs, you will need to compile `tabix` and `samtools` with support for `libcurl`. See [below](#https-support-for-samtools) for details.

[10]: http://php.net/manual/en/book.curl.php
[11]: http://www.htslib.org/download/
[12]: http://hgdownload.cse.ucsc.edu/admin/exe/
[16]: http://php.net/manual/en/security.magicquotes.disabling.php
[igbql]: https://wiki.transvar.org/display/igbman/Sharing+data+using+QuickLoad+sites

### To scrape data from UCSC

We use a pipeline to stream data from genomes hosted at UCSC into highly efficient [binary formats][bbbw] that make it simple to serve the data from [chromozoom.org](http://chromozoom.org).

You'll find this script under `UCSC_tracks/get_tracks.py`. 

### Running in virtual environment

Using virtualization ChromoZoom can run easily from any system. [VirtualBox](http://www.virtualbox.org/wiki/Downloads) and [Vagrant](http://www.vagrantup.com/downloads.html) must be installed.
To set up your environment use commands:

    $ cd path/to/this/repo
    $ vagrant up

Once set up, you can access ChromoZoom at `localhost:8080`
	
## Development

In addition to the above, you'll need [node.js](https://nodejs.org/) and two [npm](https://www.npmjs.com/) packages:

    $ npm install -g browserify watchify

### Basic setup

    $ git clone https://github.com/rothlab/chromozoom.git
    $ cd chromozoom
    $ rake check

This will tell you if you're missing any of the previously mentioned binaries needed for hosting ChromoZoom or running the UCSC track scraper. You should then serve this directory from Apache + PHP (symlinking into your existing webroot usually works) and access `index.php`.

After making changes to the JavaScript in `js/`, you need to recompile the scripts in `build/`. When developing, use

    $ rake watchify

which will open three screen sessions and continuously recompile debug-friendly versions of the scripts (quit with Ctrl-A and typing `:quit`.) To compile production versions, use

    $ rake browserify

which will also run before you commit code to git, since `rake check` installs a pre-commit hook (see `git-hooks-pre-commit.sh`).

## Recommended Enhancements

None of the following components are strictly necessary for running ChromoZoom; however, they increase the capabilities of the browser, such as being able to search and display certain formats. Both of these upgrades are in use on our main instance, [chromozoom.org](http://chromozoom.org).

1. Compiling [`bigBedSearch`][bbs], which allows prefix searching of bigBed fields
2. [HTTPS support](#https-support-for-samtools) for `samtools` and `tabix`

[bbs]: https://github.com/powerpak/bigBedSearch

### Compiling [`bigBedSearch`][bbs]

The [bigBed format][] can include extra B+ tree indices in the very last section of the file, which ChromoZoom can then use to search for features by the text content of various fields in the uncompressed BED data. e.g., if you want to search a gene track for gene names matching a certain prefix, these indices make such a search practical even if the track itself is large and somewhere else on the web.

I've created a binary that enables these prefix queries, which you can install if you have `gcc` and `make`:

    $ git clone https://github.com/powerpak/bigBedSearch.git
    $ cd bigBedSearch
    $ make

This should produce a `bigBedSearch` executable that you can copy to ChromoZoom's `bin/` directory so the web frontend can use it.

If you want HTTPS to work, either make sure /usr/include/openssl is available, or specify the equivalent SSL_DIR as an environment variable.

You can also use that source tree to produce customized versions of `bigBedInfo`, `bigBedSummary`, `bigBedToBed`, `bigWigInfo`, and `bigWigSummary`, e.g., if you're having problems with UCSC's binaries. (HTTPS doesn't always seem to work in UCSC's macOS binaries.)

### HTTPS support for `samtools`

Current release versions for `samtools` and `tabix` don't support HTTPS, but `libcurl` is being merged into the next planned release so that this is possible. To get these features now, follow these instructions, which are largely cribbed from [this answer on BioStars](https://www.biostars.org/p/147772/), with a major change being that libcurl was already merged into the development branch for htslib.

You'll first need to have `gcc`, `autoconf`, and `zlib`, `libcurl`, `openssl`, and `ncurses` with development headers. On macs, `brew install autoconf` and you should already have the rest if you have Xcode. On most Linux distros, these are all easily found in your respective package manager.

Get the development version of htslib and setup the configure script:

    $ git clone https://github.com/samtools/htslib.git
    $ cd htslib/
    $ autoconf

If the last step fails with something about m4 macros, try being more forceful with `autoreconf --install`. Then configure with libcurl support and compile:

    $ ./configure --enable-libcurl
    $ make

(**Side note.** To get this to compile with a slightly older `libcurl`, such as the moderately ancient version 7.19.7 on [certain high-performance computing nodes](https://hpc.mssm.edu), you may have to remove the case statement about `CURLE_NOT_BUILT_IN` from `hfile_libcurl.c`.)

Once it works, you'll find `tabix` in this directory, along with `htsfile` (which is like `file`, for sequencing formats), both with HTTPS formats. Test that it's working with

    $ ./htsfile https://hostname.example.com/path/to/some.bam

All good? Then get the source release for `samtools` 1.2:

    $ cd ..
    $ curl -LO https://github.com/samtools/samtools/releases/download/1.2/samtools-1.2.tar.bz2
    $ tar xzvf samtools-1.2.tar.bz2
    $ cd samtools-1.2

Although this includes htslib 1.2.1, you want to point it to the development version you just installed:

    $ rm -rf htslib-1.2.1
    $ ln -s ../htslib htslib-1.2.1
    $ make LDLIBS+=-lcurl LDLIBS+=-lcrypto

You should find `samtools` in this directory. Test it against some BAM file on an HTTPS server, and if you get back SAM data you're in good shape:

    $ ./samtools view https://hostname.example.com/path/to/some.bam 1:1-10000

(Note that this will spit out a `.bai` file into the current directory, which you'll want to delete.)