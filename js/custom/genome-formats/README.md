This is where we define functions specific to particular genome formats.

+ `.init()` and `.parse()` MUST be defined, while `.searchTracks()` MAY be defined.

+ `.parse()` must do two things: put enough stuff into `this.opts` for `.options()` to construct a configuration
    for `$.ui.genobrowser` (see `CustomGenome.defaults` for what the default object for that is), and if
    sequence information is given, that should be stored as a continuous string in `this.data.sequence` so that
    `.getSequence()` can retrieve it.

+ If the genome contains information on annotation tracks, they should be added as entries to `this.opts.availTracks` 
    with all the necessary information for `$.ui.genobrowser` to add them to the "show tracks..." track picker.

+ `.searchTracks()` MAY be defined for genomes that have additional annotation tracks somewhere online that are not
    provided with the genome itself (e.g., if there are too many of them to send in one go).

+ Composite tracks should be added to this.opts.compositeTracks, and the entries in this.opts.availTracks
    should have .parent attributes that refer to the these tracks by name (`.n`).