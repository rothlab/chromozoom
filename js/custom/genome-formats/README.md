This is where we define functions specific to particular genome formats.

+ .init() and .parse() MUST be defined.

+ .parse() must do two things: put enough stuff into this.opts for .options() to construct a configuration
    for $.ui.genobrowser (see CustomGenome.defaults for what the starting platform for that is), and if
    sequence information is given, that should be stored as a continuous string in this.data.sequence so that
    .getSequence() can access it.

+ If the genome contains track information, it should be added as an entry to this.opts.availTracks with the
    information 