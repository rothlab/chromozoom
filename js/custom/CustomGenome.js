// ================================================================================================
// = CustomGenome represents a genome specification that can produce options for $.ui.genobrowser =
// ================================================================================================

module.exports = function(global) {

var _ = require('../underscore.min.js');

var utils = require('./genome-formats/utils/utils.js'),
  deepClone = utils.deepClone,
  log10 = utils.log10,
  roundToPlaces = utils.roundToPlaces;

function CustomGenome(givenFormat, metadata) {    
  // givenFormat = false --> this is an empty CustomGenome that will be hydrated with values from a serialized object
  if (givenFormat === false) { return; } 
  
  this._parsed = false;
  this._format = (givenFormat && givenFormat.toLowerCase()) || "chromsizes";
  var format = this.format();
  if (format === null) { throw new Error("Unsupported genome format '"+format+"' encountered"); }
  
  // this.opts holds everything that $.ui.genobrowser will need to construct a view (see CustomGenome.defaults below)
  // it DOES NOT relate to "options" for parsing, or how the genome is being interpreted, or anything like that
  this.opts = _.extend({}, deepClone(this.constructor.defaults), deepClone(format.defaults || {}));
  
  // this.metadata holds information external to the parsed text passed in from the browser (e.g. filename, source)
  this.metadata = metadata;
  
  // this.data holds anything additionally parsed from the genome file (metadata, references, etc.)
  // typically this is arranged per contig, in the arrangement of this.data.contigs[i]. ...
  this.data = {
    sequence: "" // the full concatenated sequence for all contigs in this genome, if available
  };
  
  // can we call .getSequence on this CustomGenome?
  this.canGetSequence = false;
  
  if(format.init) { format.init.call(this); }
}

CustomGenome.defaults = {
  // The following keys should be overridden while parsing the genome file
  genome: '_blank',
  species: 'Blank Genome',
  assemblyDate: '',
  tileDir: null,
  overzoomBppps: [],
  ntsBelow: [1, 0.1],
  availTracks: [
    {
      fh: {},        // "fixed heights" above which a density is forced to display above a certain track height
                     //    formatted like {"1.00e+05":{"dense":15}}
      n: "ruler",    // short unique name for the track
      s: ["dense"],  // possible densities for tiles, e.g. ["dense", "squish", "pack"]
      h: 25          // starting height in px
    }
  ],
  genomeSize: 0,
  chrLengths: {},
  chrOrder: [],
  chrBands: null,
  tileWidth: 1000,
  subdirForBpppsUnder: 330,
  ideogramsAbove: 0,
  maxNtRequest: 20000,
  tracks: [{n: "ruler"}],
  trackDesc: {
    ruler: {
      cat: "Mapping and Sequencing",
      sm: "Base Position"
    }
  },
  groupTracksByCategory: false,
  // These last three will be overridden using knowledge of the window's width
  bppps: [],
  bpppNumbersBelow: [],
  initZoom: null
};

CustomGenome.formats = {
  chromsizes: require('./genome-formats/chromsizes.js'),
  fasta: require('./genome-formats/fasta.js'),
  genbank: require('./genome-formats/genbank.js'),
  embl: null // TODO. Basically genbank with extra columns.
}

CustomGenome.prototype.parse = function() {
  this.format().parse.apply(this, _.toArray(arguments));
  this.setGenomeString();
  this._parsed = true;
};

CustomGenome.prototype.format = function(format) {
  var self = this;
  if (_.isUndefined(format)) { format = self._format; }
  var FormatWrapper = function() { _.extend(this, self.constructor.formats[format]); return this; };
  FormatWrapper.prototype = self;
  return new FormatWrapper();
};

CustomGenome.prototype.setGenomeString = function() {
  var self = this,
    o = self.opts,
    exceptions = ['file', 'igb', 'acc', 'url', 'ucsc'],
    exception = _.find(exceptions, function(v) { return !_.isUndefined(self.metadata[v]); }),
    pieces = [];
  if (exception) { o.genome = exception + ":" + self.metadata[exception]; }
  else {
    pieces = ['custom' + (self.metadata.name ? ':' + self.metadata.name : '')];
    _.each(o.chrOrder, function(chr) {
      pieces.push(chr + ':' + o.chrLengths[chr]);
    });
    o.genome = pieces.join('|');
  }
};

// Some of the options for $.ui.genobrowser (all r/t zoom levels) must be set based on the width of the window
//   They are .bppps, .bpppNumbersBelow, and .initZoom
//   They do not affect any of the other options set during parsing.
//
// windowOpts MUST include a property, .width, that is the window.innerWidth
CustomGenome.prototype.setBppps = function(windowOpts) {
  windowOpts = windowOpts || {};
  
  var o = this.opts,
    windowWidth = (windowOpts.width * 0.6) || 1000,
    bppp = Math.round(o.genomeSize / windowWidth),
    lowestBppp = windowOpts.lowestBppp || 0.1,
    longestContig = _.max(o.chrLengths),
    maxBppps = 100,
    bppps = [], i = 0, log;
  
  // comparable to part of UCSCClient#make_config in lib/ucsc_stitch.rb
  while (bppp >= lowestBppp && i < maxBppps) {
    bppps.push(bppp);
    log = roundToPlaces(log10(bppp), 4);
    bppp = (Math.ceil(log) - log < 0.481) ? 3.3 * Math.pow(10, Math.ceil(log) - 1) : Math.pow(10, Math.floor(log));
    i++;
  }
  o.bppps = bppps;
  o.bpppNumbersBelow = [bppps[0], _.find(bppps, function(x) { return x < longestContig / 500; })];
  o.initZoom = bppps[0];
  
  // if custom genomes have ideograms, we draw them at all zoom levels
  o.ideogramsAbove = o.ideogramsAbove ? bppps[0] : 0;
};

// Construct a complete configuration for $.ui.genobrowser based on the information parsed from the genome file
// which should be mostly in this.opts, excepting those related to zoom levels, which can be set now.
// (see CustomGenome.defaults above for what a base configuration looks like)
//
// windowOpts MUST include include the property .width which is the window.innerWidth
CustomGenome.prototype.options = function(windowOpts) {
  if (!this._parsed) { throw "Cannot generate options before parsing the genome file"; }
  this.setBppps(windowOpts);
  this.opts.custom = this;   // same convention as custom tracks in self.availTracks in chromozoom.js
  return this.opts;
};

// Fetch the sequence, if available, between left and right, and optionally pass it to the callback.
CustomGenome.prototype.getSequence = function(left, right, callback) {
  var seq = this.data.sequence.substring(left - 1, right - 1);
  return _.isFunction(callback) ? callback(seq) : seq; 
};

CustomGenome.prototype.getSequenceAsync = function() {
  global.CustomGenomes.async(this, 'getSequence', arguments, [this.id]);
};

return CustomGenome;

};