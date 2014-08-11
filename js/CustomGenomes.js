(function(global){
  
  function parseInt10(val) { return parseInt(val, 10); }
  
  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  
  function log10(val) { return Math.log(val) / Math.LN10; }
  
  function roundToPlaces(num, dec) { return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec); }
  
  // ================================================================
  // = CustomGenomes, the module exported to the global environment =
  // ================================================================
  
  var CustomGenomes = {
    parse: function(text, metadata) {
      metadata = metadata || {};
      if (!metadata.format) { metadata.format = this.guessFormat(text); }
      var genome = new CustomGenome(metadata.format, metadata);
      genome.parse(text);
      return genome;
    },
    
    guessFormat: function(text) {
      // TODO
      throw "TODO";
    }
  };
  
  // ================================================================================================
  // = CustomGenome represents a genome specification that can produce options for $.ui.genobrowser =
  // ================================================================================================
  
  function CustomGenome(givenFormat, metadata) {
    this._parsed = false;
    this._format = (givenFormat && givenFormat.toLowerCase()) || "chromsizes";
    var format = this.format();
    if (format === null) { throw new Error("Unsupported genome format '"+format+"' encountered"); }
    
    // this.opts holds everything that $.ui.genobrowser will need to construct a view (see CustomGenome.defaults below)
    this.opts = _.extend({}, deepClone(this.constructor.defaults), deepClone(format.defaults || {}));
    
    // this.sequence holds the sequence if provided
    this.sequence = null;
    
    // this.parseOpts holds information external to the parsed text passed in from the browser (e.g. filename, metadata)
    this.metadata = metadata;
    // this.data holds anything additionally parsed from the genome file (metadata, references, etc.)
    this.data = {};
    
    format.init && format.init.call(this)
  }
  
  CustomGenome.defaults = {
    // The following keys should be overridden while parsing the genome file
    genome: 'custom',
    species: 'Custom Genome',
    assemblyDate: '',
    tileDir: null,
    overzoomBppps: [],
    ntsBelow: [1, 0.1],
    availTracks: [
      {
        fh: {},
        n: "ruler",
        s: ["dense"],
        h: 25
      }
    ],
    genomeSize: 0,
    chrLengths: {},
    chrOrder: [],
    chrBands: null,
    tileWidth: 1000,
    subdirForBpppsUnder: 330,
    ideogramsAbove: 1000,
    maxNtRequest: 20000,
    tracks: [{n: "ruler"}],
    trackDesc: {
      ruler: {
        cat: "Mapping and Sequencing Tracks",
        sm: "Base Position"
      }
    },
    // These last three will be overridden using knowledge of the window's width
    bppps: [],
    bpppNumbersBelow: [],
    initZoom: null
  };
  
  CustomGenome.formats = {
    
    chromsizes: {
      init: function() {
        var m = this.metadata,
          o = this.opts;
        o.species = m.species || 'Custom Genome';
        o.assemblyDate = m.assemblyDate || '';
      },
      
      parse: function(text) {
        var lines = text.split("\n"),
          o = this.opts;
        _.each(lines, function(line, i) {
          var chrsize = line.replace(/^\s+|\s+$/g, '').split(/\s+/, 2),
            chr = chrsize[0],
            size = parseInt10(chrsize[1]);
          if (_.isNaN(size)) { return; }
          o.chrOrder.push(chr);
          o.chrLengths[chr] = size;
          o.genomeSize += size;
        });
      }
    },
    
    fasta: {
      init: function() {},
      parse: function(text) {}
    },
    
    genbank: {
      
    },
    
    embl: {
      
    }
    
  };
  
  // These functions branch to different methods depending on the .type() of the track
  // _.each(['parse'], function(fn) {
  //   CustomGenome.prototype[fn] = function() {
  //     var args = _.toArray(arguments),
  //       format = this.format();
  //     if (!format[fn]) { throw "Unimplemented"; }
  //     return format[fn].apply(this, args);
  //   }
  // });
  
  CustomGenome.prototype.parse = function() {
    this.format().parse.apply(this, _.toArray(arguments));
    this.setGenomeString();
    this._parsed = true;
  };
  
  CustomGenome.prototype.format = function(format) {
    if (_.isUndefined(format)) { format = this._format; }
    return this.constructor.formats[format] || null;
  };
  
  CustomGenome.prototype.setGenomeString = function() {
    var self = this,
      o = self.opts,
      exceptions = ['file', 'acc', 'url', 'ucsc'],
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
  
  CustomGenome.prototype.setBppps = function(windowOpts) {
    var o = this.opts,
      windowOpts = windowOpts || {},
      windowWidth = (windowOpts.width * 0.6) || 1000,
      bppp = Math.round(o.genomeSize / windowWidth),
      lowestBppp = windowOpts.lowestBppp || 0.1,
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
    o.bpppNumbersBelow = bppps.slice(0, 2);
    o.initZoom = bppps[0];
  };
  
  CustomGenome.prototype.options = function(windowOpts) {
    if (!this._parsed) { throw "Cannot generate options before parsing the genome file"; }
    this.setBppps(windowOpts);
    return this.opts;
  }
  
  global.CustomGenomes = CustomGenomes;
  
})(this);