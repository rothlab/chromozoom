(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
},{"../underscore.min.js":25,"./genome-formats/chromsizes.js":6,"./genome-formats/fasta.js":7,"./genome-formats/genbank.js":8,"./genome-formats/utils/utils.js":9}],2:[function(require,module,exports){
var global = self;  // grab global scole for Web Workers
require('./jquery.nodom.min.js')(global);
global._ = require('../underscore.min.js');
require('./CustomGenomes.js')(global);

if (!global.console || !global.console.log) {
  global.console = global.console || {};
  global.console.log = function() {
    global.postMessage({log: JSON.stringify(_.toArray(arguments))});
  };
}

var CustomGenomeWorker = {
  _genomes: [],
  _throwErrors: false,
  parse: function(text, metadata) {
    var self = this,
      genome = CustomGenomes.parse(text, metadata),
      serializable;
    
    // we want to keep the genome object in our private store, and delete the data from the copy that
    // is sent back over the fence, since it is expensive/impossible to serialize
    genome.id = self._genomes.push(genome) - 1;
    
    serializable = _.extend({}, genome);
    delete serializable.data;
    return serializable;
  },
  options: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      genome = this._genomes[id];
    return genome.options.apply(genome, _.rest(args));
  },
  getSequence: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      genome = this._genomes[id];
    return genome.getSequence.apply(genome, _.rest(args));
  },
  throwErrors: function(toggle) {
    this._throwErrors = toggle;
  }
};

global.addEventListener('message', function(e) {
  var data = e.data,
    callback = function(r) { global.postMessage({id: data.id, ret: JSON.stringify(r || null)}); },
    ret;

  if (CustomGenomeWorker._throwErrors) {
    ret = CustomGenomeWorker[data.op].apply(CustomGenomeWorker, data.args.concat(callback));
  } else {
    try { ret = CustomGenomeWorker[data.op].apply(CustomGenomeWorker, data.args.concat(callback)); } 
    catch (err) { global.postMessage({id: data.id, error: JSON.stringify({message: err.message})}); }
  }
  
  if (!_.isUndefined(ret)) { callback(ret); }
});
},{"../underscore.min.js":25,"./CustomGenomes.js":3,"./jquery.nodom.min.js":10}],3:[function(require,module,exports){
module.exports = (function(global){
  
  var _ = require('../underscore.min.js');
  if (!global.CustomTracks) { require('./CustomTracks.js')(global); }
  
  // The class that represents a singular custom genome object
  var CustomGenome = require('./CustomGenome')(global);
  
  // ================================================================
  // = CustomGenomes, the module exported to the global environment =
  // ================================================================
  //
  // Broadly speaking this is a factory for CustomGenome objects that can delegate the
  // work of parsing to a Web Worker thread.
  
  var CustomGenomes = {
    parse: function(text, metadata) {
      metadata = metadata || {};
      if (!metadata.format) { metadata.format = this.guessFormat(text); }
      var genome = new CustomGenome(metadata.format, metadata);
      genome.parse(text);
      return genome;
    },
    
    blank: function() {
      var genome = new CustomGenome("chromsizes", {species: "Blank Genome"});
      genome.parse("blank\t50000");
      return genome;
    },
    
    guessFormat: function(text) {
      if (text.substring(0, 5) == 'LOCUS') { return "genbank"; }
      if (/^[A-Z]{2} {3}/.test(text)) { return "embl"; }
      if (/^[>;]/.test(text)) { return "fasta"; }
      // default is fasta
      return "fasta";
    },
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      console.log(e);
    },
    
    _workerScript: 'build/CustomGenomeWorker.js',
    _disableWorkers: false,
    worker: global.CustomTracks.worker,
    
    async: global.CustomTracks.async,
    
    parseAsync: function() {
      this.async(this, 'parse', arguments, [], function(genome) {
        // This has been serialized, so it must be hydrated into a real CustomGenome object.
        // We replace .getSequence() with an asynchronous version.
        return _.extend(new CustomGenome(false), genome, {
          getSequence: function() { CustomGenome.prototype.getSequenceAsync.apply(this, arguments); }
        });
      });
    }
  };
  
  global.CustomGenomes = CustomGenomes;
  
});
},{"../underscore.min.js":25,"./CustomGenome":1,"./CustomTracks.js":5}],4:[function(require,module,exports){
// =============================================================================
// = CustomTrack, an object representing a custom track as understood by UCSC. =
// =============================================================================
//
// This class *does* depend on global objects and therefore must be required as a 
// function that is executed on the global object.

module.exports = function(global) {

var _ = require('../underscore.min.js');

var utils = require('./track-types/utils/utils.js'),
  parseInt10 = utils.parseInt10;

function CustomTrack(opts, browserOpts) {
  if (!opts) { return; } // This is an empty customTrack that will be hydrated with values from a serialized object
  this._type = (opts.type && opts.type.toLowerCase()) || "bed";
  var type = this.type();
  if (type === null) { throw new Error("Unsupported track type '"+opts.type+"' encountered on line " + opts.lineNum); }
  this.opts = _.extend({}, this.constructor.defaults, type.defaults || {}, opts);
  _.extend(this, {
    browserOpts: browserOpts,
    stretchHeight: false,
    heights: {},
    sizes: ['dense'],
    mapSizes: [],
    areas: {},
    noAreaLabels: false,
    expectsSequence: false
  });
  this.init();
}

CustomTrack.defaults = {
  name: 'User Track',
  description: 'User Supplied Track',
  color: '0,0,0'
};

CustomTrack.types = {
  bed: require('./track-types/bed.js'),
  featuretable: require('./track-types/featuretable.js'),
  bedgraph: require('./track-types/bedgraph.js'),
  wiggle_0: require('./track-types/wiggle_0.js'),
  vcftabix: require('./track-types/vcftabix.js'),
  bigbed: require('./track-types/bigbed.js'),
  bam: require('./track-types/bam.js'),
  bigwig: require('./track-types/bigwig.js')
};

// ==========================================================================
// = bedDetail format: https://genome.ucsc.edu/FAQ/FAQformat.html#format1.7 =
// ==========================================================================  

CustomTrack.types.beddetail = _.clone(CustomTrack.types.bed);
CustomTrack.types.beddetail.defaults = _.extend({}, CustomTrack.types.beddetail.defaults, {detail: true});

// These functions branch to different methods depending on the .type() of the track
_.each(['init', 'parse', 'render', 'renderSequence', 'prerender'], function(fn) {
  CustomTrack.prototype[fn] = function() {
    var args = _.toArray(arguments),
      type = this.type();
    if (!type[fn]) { return false; }
    return type[fn].apply(this, args);
  }
});

CustomTrack.prototype.loadOpts = function($dialog) {
  var type = this.type(),
    o = this.opts;
  $dialog.find('.custom-opts-form').hide();
  $dialog.find('.custom-opts-form.'+this._type).show();
  $dialog.find('.custom-name').text(o.name);
  $dialog.find('.custom-desc').text(o.description);
  $dialog.find('.custom-format').text(this._type);
  $dialog.find('[name=color]').val(o.color).change();
  if (type.loadOpts) { type.loadOpts.call(this, $dialog); }
  $dialog.find('.enabler').change();
};

CustomTrack.prototype.saveOpts = function($dialog) {
  var type = this.type(),
    o = this.opts;
  o.color = $dialog.find('[name=color]').val();
  if (!this.validateColor(o.color)) { o.color = '0,0,0'; }
  if (type.saveOpts) { type.saveOpts.call(this, $dialog); }
  this.applyOpts();
  global.CustomTracks.worker() && this.applyOptsAsync(); // Apply the changes to the worker too!
};

CustomTrack.prototype.applyOpts = function(opts) {
  var type = this.type();
  if (opts) { this.opts = opts; }
  if (type.applyOpts) { type.applyOpts.call(this); }
};

CustomTrack.prototype.erase = function(canvas) {
  var self = this,
    ctx = canvas.getContext && canvas.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

CustomTrack.prototype.type = function(type) {
  if (_.isUndefined(type)) { type = this._type; }
  return this.constructor.types[type] || null;
};

CustomTrack.prototype.warn = function(warning) {
  if (this.opts.strict) {
    throw new Error(warning);
  } else {
    if (!this.warnings) { this.warnings = []; }
    this.warnings.push(warning);
  }
};

CustomTrack.prototype.isOn = function(val) {
  return /^(on|yes|true|t|y|1)$/i.test(val.toString());
};

CustomTrack.prototype.chrList = function() {
  if (!this._chrList) {
    this._chrList = _.sortBy(_.map(this.browserOpts.chrPos, function(pos, chr) { return [pos, chr]; }), function(v) { return v[0]; });
  }
  return this._chrList;
}

CustomTrack.prototype.chrAt = function(pos) {
  var chrList = this.chrList(),
    chrIndex = _.sortedIndex(chrList, [pos], function(v) { return v[0]; }),
    chr = chrIndex > 0 ? chrList[chrIndex - 1][1] : null;
  return {i: chrIndex - 1, c: chr, p: pos - this.browserOpts.chrPos[chr]};
};

CustomTrack.prototype.chrRange = function(start, end) {
  var chrLengths = this.browserOpts.chrLengths,
    startChr = this.chrAt(start),
    endChr = this.chrAt(end),
    range;
  if (startChr.c && startChr.i === endChr.i) { return [startChr.c + ':' + startChr.p + '-' + endChr.p]; }
  else {
    range = _.map(this.chrList().slice(startChr.i + 1, endChr.i), function(v) {
      return v[1] + ':1-' + chrLengths[v[1]];
    });
    startChr.c && range.unshift(startChr.c + ':' + startChr.p + '-' + chrLengths[startChr.c]);
    endChr.c && range.push(endChr.c + ':1-' + endChr.p);
    return range;
  }
}

CustomTrack.prototype.prerenderAsync = function() {
  global.CustomTracks.async(this, 'prerender', arguments, [this.id]);
};

CustomTrack.prototype.applyOptsAsync = function() {
  global.CustomTracks.async(this, 'applyOpts', [this.opts, function(){}], [this.id]);
};

CustomTrack.prototype.ajaxDir = function() {
  // Web Workers fetch URLs relative to the JS file itself.
  return (global.HTMLDocument ? '' : '../') + this.browserOpts.ajaxDir;
};

CustomTrack.prototype.rgbToHsl = function(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;

  if (max == min) {
    h = s = 0; // achromatic
  } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch(max){
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h, s, l];
}

CustomTrack.prototype.hslToRgb = function(h, s, l) {
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    function hue2rgb(p, q, t) {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6) return p + (q - p) * 6 * t;
      if(t < 1/2) return q;
      if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [r * 255, g * 255, b * 255];
}

CustomTrack.prototype.validateColor = function(color) {
  var m = color.match(/(\d+),(\d+),(\d+)/);
  if (!m) { return false; }
  m.shift();
  return _.all(_.map(m, parseInt10), function(v) { return v >=0 && v <= 255; });
}

return CustomTrack;

};
},{"../underscore.min.js":25,"./track-types/bam.js":11,"./track-types/bed.js":12,"./track-types/bedgraph.js":13,"./track-types/bigbed.js":14,"./track-types/bigwig.js":15,"./track-types/featuretable.js":16,"./track-types/utils/utils.js":22,"./track-types/vcftabix.js":23,"./track-types/wiggle_0.js":24}],5:[function(require,module,exports){
module.exports = (function(global){
  
  var _ = require('../underscore.min.js');
  
  // Some utility functions.
  var utils = require('./track-types/utils/utils.js'),
    parseDeclarationLine = utils.parseDeclarationLine;
  
  // The class that represents a singular custom track object
  var CustomTrack = require('./CustomTrack.js')(global);

  // ========================================================================
  // = CustomTracks, the module that is exported to the global environment. =
  // ========================================================================
  //
  // Broadly speaking this is a factory for parsing data into CustomTrack objects,
  // and it can delegate this work to a worker thread.

  var CustomTracks = {
    parse: function(chunks, browserOpts) {
      var customTracks = [],
        data = [],
        track, opts, m;
      
      if (typeof chunks == "string") { chunks = [chunks]; }
      
      function pushTrack() {
        if (track.parse(data)) { customTracks.push(track); }
      }
      
      customTracks.browser = {};
      _.each(chunks, function(text) {
        _.each(text.split("\n"), function(line, lineno) {
          if (/^#/.test(line)) {
            // comment line
          } else if (/^browser\s+/.test(line)) {
            // browser lines
            m = line.match(/^browser\s+(\w+)\s+(\S*)/);
            if (!m) { throw new Error("Could not parse browser line found at line " + (lineno + 1)); }
            customTracks.browser[m[1]] = m[2];
          } else if (/^track\s+/i.test(line)) {
            if (track) { pushTrack(); }
            opts = parseDeclarationLine(line, (/^track\s+/i));
            if (!opts) { throw new Error("Could not parse track line found at line " + (lineno + 1)); }
            opts.lineNum = lineno + 1;
            track = new CustomTrack(opts, browserOpts);
            data = [];
          } else if (/\S/.test(line)) {
            if (!track) { throw new Error("Found data on line "+(lineno+1)+" but no preceding track definition"); }
            data.push(line);
          }
        });
      });
      if (track) { pushTrack(); }
      return customTracks;
    },
    
    parseDeclarationLine: parseDeclarationLine,
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      // Note: this is overridden by ui.genobrowser during UI setup.
      console.log(e);
    },
    
    _workerScript: 'build/CustomTrackWorker.js',
    // NOTE: To temporarily disable Web Worker usage, set this to true.
    _disableWorkers: false,
    
    worker: function() { 
      var self = this,
        callbacks = [];
      if (!self._worker && global.Worker) { 
        self._worker = new global.Worker(self._workerScript);
        self._worker.addEventListener('error', function(e) { self.error(e); }, false);
        self._worker.addEventListener('message', function(e) {
          if (e.data.log) { console.log(JSON.parse(e.data.log)); return; }
          if (e.data.error) {
            if (e.data.id) { callbacks[e.data.id] = null; }
            self.error(JSON.parse(e.data.error));
            return;
          }
          callbacks[e.data.id](JSON.parse(e.data.ret));
          callbacks[e.data.id] = null;
        });
        self._worker.call = function(op, args, callback) {
          var id = callbacks.push(callback) - 1;
          this.postMessage({op: op, id: id, args: args});
        };
        // To have the worker throw errors instead of passing them nicely back, call this with toggle=true
        self._worker.throwErrors = function(toggle) {
          this.postMessage({op: 'throwErrors', args: [toggle]});
        };
      }
      return self._disableWorkers ? null : self._worker;
    },
    
    async: function(self, fn, args, asyncExtraArgs, wrapper) {
      args = _.toArray(args);
      wrapper = wrapper || _.identity;
      var argsExceptLastOne = _.initial(args),
        callback = _.last(args),
        w = this.worker();
      // Fallback if web workers are not supported.
      // This could also be tweaked to not use web workers when there would be no performance gain;
      //   activating this branch disables web workers entirely and everything happens synchronously.
      if (!w) { return callback(self[fn].apply(self, argsExceptLastOne)); }
      Array.prototype.unshift.apply(argsExceptLastOne, asyncExtraArgs);
      w.call(fn, argsExceptLastOne, function(ret) { callback(wrapper(ret)); });
    },
    
    parseAsync: function() {
      this.async(this, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          return _.extend(new CustomTrack(), t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
        });
      });
    }
  };

  global.CustomTracks = CustomTracks;

});
},{"../underscore.min.js":25,"./CustomTrack.js":4,"./track-types/utils/utils.js":22}],6:[function(require,module,exports){
(function (global){
// ====================================================================
// = chrom.sizes format: http://www.broadinstitute.org/igv/chromSizes =
// ====================================================================
// Note: we are extending the general use of this to include data loaded from the genome.txt and annots.xml
// files of an IGB quickload directory,

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  optsAsTrackLine = utils.optsAsTrackLine;

var ChromSizesFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
    o.species = m.species || 'Custom Genome';
    o.assemblyDate = m.assemblyDate || '';
    
    // TODO: if metadata also contains custom track data, e.g. from annots.xml
    // must convert them into items for o.availTracks, o.tracks, and o.trackDesc
    // The o.availTracks items should contain {customData: tracklines} to be parsed
    if (m.tracks) { self.format().createTracks(m.tracks); }
  },
  
  createTracks: function(tracks) {
    var self = this,
      o = self.opts;
      
    _.each(tracks, function(t) {
      var trackOpts;
      t.lines = t.lines || [];
      trackOpts = /^track\s+/i.test(t.lines[0]) ? global.CustomTracks.parseDeclarationLine(t.lines.shift()) : {};
      t.lines.unshift('track ' + optsAsTrackLine(_.extend(trackOpts, t.opts, {name: t.name, type: t.type})) + '\n');
      o.availTracks.push({
        fh: {},
        n: t.name,
        s: ['dense', 'squish', 'pack'],
        h: 15,
        m: ['pack'],
        customData: t.lines
      });
      o.tracks.push({n: t.name});
      o.trackDesc[t.name] = {
        cat: "Feature Tracks",
        sm: t.name,
        lg: t.description || t.name
      };
    });
  },
  
  parse: function(text) {
    var lines = text.split("\n"),
      o = this.opts;
    _.each(lines, function(line, i) {
      var chrsize = strip(line).split(/\s+/, 2),
        chr = chrsize[0],
        size = parseInt10(chrsize[1]);
      if (_.isNaN(size)) { return; }
      o.chrOrder.push(chr);
      o.chrLengths[chr] = size;
      o.genomeSize += size;
    });
  }
};

module.exports = ChromSizesFormat;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils/utils.js":9}],7:[function(require,module,exports){
// ===========================================================
// = FASTA format: http://en.wikipedia.org/wiki/FASTA_format =
// ===========================================================

var utils = require('./utils/utils.js'),
  ensureUnique = utils.ensureUnique;

var FastaFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
      
    self.data = {};
  },
  
  parse: function(text) {
    var lines = text.split("\n"),
      self = this,
      o = self.opts,
      chr = null,
      unnamedCounter = 1,
      chrseq = [];
      
    self.data.sequence = [];
    
    _.each(lines, function(line, i) {
      var chrLine = line.match(/^[>;](.+)/),
        cleanedLine = line.replace(/\s+/g, '');
      if (chrLine) {
        chr = chrLine[1].replace(/^\s+|\s+$/g, '');
        if (!chr.length) { chr = "unnamedChr"; }
        chr = ensureUnique(chr, o.chrLengths);
        o.chrOrder.push(chr);
      } else {
        self.data.sequence.push(cleanedLine);
        o.chrLengths[chr] = (o.chrLengths[chr] || 0) + cleanedLine.length;
        o.genomeSize += cleanedLine.length;
      }
    });
    
    self.data.sequence = self.data.sequence.join('');
    self.canGetSequence = true;
  }
};

module.exports = FastaFormat;
},{"./utils/utils.js":9}],8:[function(require,module,exports){

// =========================================================================
// = GenBank format: http://www.ncbi.nlm.nih.gov/Sitemap/samplerecord.html =
// =========================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  topTagsAsArray = utils.topTagsAsArray,
  subTagsAsArray = utils.subTagsAsArray,
  fetchField = utils.fetchField,
  getTag = utils.getTag,
  ensureUnique = utils.ensureUnique;

var GenBankFormat = {
  init: function() {
    // Note that we call GenBank field names like "LOCUS", "DEFINITION", etc. tags instead of keys.
    // We do this because: 1) certain field names can be repeated (e.g. REFERENCE) which is more 
    // evocative of "tags" as opposed to the behavior of keys in a hash.  Also, 2) this is the
    // nomenclature picked by BioRuby.
    
    this.tagSize = 12; // how wide the column for tags is in a GenBank file
    this.featureTagSize = 21; // how wide the column for tags is in the feature table section
                              // see section 4.1 of http://www.insdc.org/files/feature_table.html
    
    this.data = {
      contigs: [],
      trackLines: {
        source: [],
        genes: [],
        other: []
      }
    };
  },
  
  parseLocus: function(contig) {
    var locusLine = contig.orig.locus;
    if (locusLine) {
      if (locusLine.length > 75) { // after Rel 126.0
        contig.entryId  = strip(locusLine.substring(12, 28));
        contig.length   = parseInt10(locusLine.substring(29, 40));
        contig.strand   = strip(locusLine.substring(44, 47));
        contig.natype   = strip(locusLine.substring(47, 53));
        contig.circular = strip(locusLine.substring(55, 63));
        contig.division = strip(locusLine.substring(63, 67));
        contig.date     = strip(locusLine.substring(68, 79));
      } else {
        contig.entryId  = strip(locusLine.substring(12, 22));
        contig.length   = parseInt10(locusLine.substring(22, 30));
        contig.strand   = strip(locusLine.substring(33, 36));
        contig.natype   = strip(locusLine.substring(36, 40));
        contig.circular = strip(locusLine.substring(42, 52));
        contig.division = strip(locusLine.substring(52, 55));
        contig.date     = strip(locusLine.substring(62, 73));
      }
    }
  },
  
  parseHeaderFields: function(contig) {
    var tagSize = this.tagSize,
      headerFieldsToParse = {
        simple: ['definition', 'accession', 'version'],
        deep: ['source'] // could add references, but we don't care about those here
      };
    
    // Parse simple fields (tag --> content)
    _.each(headerFieldsToParse.simple, function(tag) {
      if (!contig.orig[tag]) { contig[tag] = null; return; }
      contig[tag] = fetchField(contig.orig[tag], tagSize);
    });
    
    // Parse tags that can repeat and have subtags
    _.each(headerFieldsToParse.deep, function(tag) {
      var data = [],
        items;
      if (!contig.orig[tag]) { contig[tag] = null; return; }
      
      items = contig.orig[tag].replace(/\n([A-Za-z\/\*])/g, "\n\001$1").split("\001");
      _.each(items, function(item) {
        var subTags = subTagsAsArray(item, tagSize),
          itemName = fetchField(subTags.shift(), tagSize), 
          itemData = {_name: itemName};
        _.each(subTags, function(subTagField) {
          var tag = getTag(subTagField, tagSize);
          itemData[tag] = fetchField(subTagField, tagSize);
        });
        data.push(itemData);
      });
      contig[tag] = data;
      
    });
  },
  
  parseFeatureTable: function(chr, contigData) {
    var self = this,
      tagSize = self.tagSize,
      featureTagSize = self.featureTagSize,
      tagsToSkip = ["features"],
      tagsRelatedToGenes = ["cds", "gene", "mrna", "exon", "intron"],
      contigLine = "ACCESSION   " + chr + "\n";
    if (contigData.orig.features) {
      var subTags = subTagsAsArray(contigData.orig.features, tagSize);
      self.data.trackLines.source.push(contigLine);
      self.data.trackLines.genes.push(contigLine);
      self.data.trackLines.other.push(contigLine);
      _.each(subTags, function(subTagField) {
        var tag = getTag(subTagField, featureTagSize);
        if (tagsToSkip.indexOf(tag) !== -1) { return; }
        else if (tag === "source") { self.data.trackLines.source.push(subTagField); }
        else if (tagsRelatedToGenes.indexOf(tag) !== -1) { self.data.trackLines.genes.push(subTagField);  }
        else { self.data.trackLines.other.push(subTagField); }
      });
    }
  },
  
  parseSequence: function(contigData) {
    if (contigData.orig.origin) {
      return contigData.orig.origin.replace(/^origin.*|\n[ 0-9]{10}| /ig, '');
    } else {
      return Array(contigData.length).join('n');
    }
  },
  
  createTracksFromFeatures: function() {
    var self = this,
      o = self.opts,
      categoryTuples = [
        ["source", "Sources", "Regions annotated by source organism or specimen"], 
        ["genes", "Gene annotations", "CDS and gene features"], 
        ["other", "Other annotations", "tRNAs and other features"]
      ];
    
    // For the categories of features, create appropriate entries in o.availTracks, o.tracks, and o.trackDesc
    // Leave the actual data as arrays of lines that are attached as .customData to o.availTracks
    // They will be parsed later via CustomTracks.parse.
    _.each(categoryTuples, function(categoryTuple) {
      var category = categoryTuple[0],
        label = categoryTuple[1],
        longLabel = categoryTuple[2],
        trackLines = [];
      if (self.data.trackLines[category].length > 0) {
        self.data.trackLines[category].unshift('track type="featureTable" name="' + label + 
          '" collapseByGene="' + (category=="genes" ? 'on' : 'off') + '"\n');
      }
      o.availTracks.push({
        fh: {},
        n: category,
        s: ['dense', 'squish', 'pack'],
        h: 15,
        m: ['pack'],
        customData: self.data.trackLines[category]
      });
      o.tracks.push({n: category});
      o.trackDesc[category] = {
        cat: "Feature Tracks",
        sm: label,
        lg: longLabel
      };
    });
  },
  
  parse: function(text) {
    var self = this,
      o = self.opts,
      contigDelimiter = "\n//\n",
      contigs = text.split(contigDelimiter),
      firstContig = null;
    
    self.data.sequence = [];
      
    _.each(contigs, function(contig) {
      if (!strip(contig).length) { return; }
                           
      var contigData = {orig: {}},
        chr, size, contigSequence;
      
      // Splits on any lines with a character in the first column
      _.each(topTagsAsArray(contig), function(field) {
        var tag = getTag(field, self.tagSize);
        if (_.isUndefined(contigData.orig[tag])) { contigData.orig[tag] = field; }
        else { contigData.orig[tag] += field; }
      });
      
      self.data.contigs.push(contigData);
      self.format().parseLocus(contigData);
      self.format().parseHeaderFields(contigData);
      contigSequence = self.format().parseSequence(contigData);
      
      chr = contigData.accession && contigData.accession != 'unknown' ? contigData.accession : contigData.entryId;
      chr = ensureUnique(chr, o.chrLengths);
      
      if (contigData.length) {
        size = contigData.length;
        if (size != contigSequence.length) {
          throw new Error("Sequence data for contig "+chr+" does not match length "+size+"bp from header");
        }
      } else {
        size = contigSequence.length;
      }
      
      o.chrOrder.push(chr);
      o.chrLengths[chr] = size;
      o.genomeSize += size;
      
      self.format().parseFeatureTable(chr, contigData);
      self.data.sequence.push(contigSequence);
      
      firstContig = firstContig || contigData;
    });
    
    self.data.sequence = self.data.sequence.join('');
    self.canGetSequence = true;
    self.format().createTracksFromFeatures();
    
    o.species = firstContig.source ? firstContig.source[0].organism.split("\n")[0] : 'Custom Genome';
    if (firstContig.date) { o.assemblyDate = firstContig.date; }
  }
  
};

module.exports = GenBankFormat;
},{"./utils/utils.js":9}],9:[function(require,module,exports){
var trackUtils = require('../../track-types/utils/utils.js');

module.exports.parseInt10 = trackUtils.parseInt10;

module.exports.deepClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }

module.exports.log10 = function(val) { return Math.log(val) / Math.LN10; }

var strip = module.exports.strip = trackUtils.strip;

module.exports.roundToPlaces = function(num, dec) { return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec); }

/****
 * These functions are common subroutines for parsing GenBank and other formats based on column positions
 ****/

// Splits a multiline string before the lines that contain a character in the first column
// (a "top tag") in a GenBank-style text file
module.exports.topTagsAsArray = function(field) {
  return field.replace(/\n([A-Za-z\/\*])/g, "\n\001$1").split("\001");
}

// Splits a multiline string before the lines that contain a character not in the first column
// but within the next tagSize columns, which is a "sub tag" in a GenBank-style text file
module.exports.subTagsAsArray = function(field, tagSize) {
  if (!isFinite(tagSize) || tagSize < 2) { throw "invalid tagSize"; }
  var re = new RegExp("\\n(\\s{1," + (tagSize - 1) + "}\\S)", "g");
  return field.replace(re, "\n\001$1").split("\001");
}

// Returns a new string with the first tagSize columns from field removed
module.exports.fetchField = function(field, tagSize) {
  if (!isFinite(tagSize) || tagSize < 1) { throw "invalid tagSize"; }
  var re = new RegExp("(^|\\n).{0," + tagSize + "}", "g");
  return strip(field.replace(re, "$1"));
}

// Gets a tag from a field by trimming it out of the first tagSize characters of the field
module.exports.getTag = function(field, tagSize) { 
  if (!isFinite(tagSize) || tagSize < 1) { throw "invalid tagSize"; }
  return strip(field.substring(0, tagSize).toLowerCase());
}

/****
 * End GenBank and column-based format helpers
 ****/

// Given a hash and a presumptive new key, appends a counter to the key until it is actually an unused key
module.exports.ensureUnique = function(key, hash) {
  var i = 1, keyCheck = key;
  while (typeof hash[keyCheck] != 'undefined') { keyCheck = key + '_' + i++; }
  return keyCheck;
}

// Given a hash with option names and values, formats it in BED track line format (similar to HTML element attributes)
module.exports.optsAsTrackLine = function(opthash) {
  return _.map(opthash, function(v, k) { return k + '="' + v.toString().replace(/"/g, '') + '"'; }).join(' ');
}
},{"../../track-types/utils/utils.js":22}],10:[function(require,module,exports){
module.exports = function(global){global.window=global.window||global;global.window.document=global.window.document||{};(function(a,b){function N(){try{return new a.ActiveXObject("Microsoft.XMLHTTP")}catch(b){}}function M(){try{return new a.XMLHttpRequest}catch(b){}}function I(a,c){if(a.dataFilter){c=a.dataFilter(c,a.dataType)}var d=a.dataTypes,e={},g,h,i=d.length,j,k=d[0],l,m,n,o,p;for(g=1;g<i;g++){if(g===1){for(h in a.converters){if(typeof h==="string"){e[h.toLowerCase()]=a.converters[h]}}}l=k;k=d[g];if(k==="*"){k=l}else if(l!=="*"&&l!==k){m=l+" "+k;n=e[m]||e["* "+k];if(!n){p=b;for(o in e){j=o.split(" ");if(j[0]===l||j[0]==="*"){p=e[j[1]+" "+k];if(p){o=e[o];if(o===true){n=p}else if(p===true){n=o}break}}}}if(!(n||p)){f.error("No conversion from "+m.replace(" "," to "))}if(n!==true){c=n?n(c):p(o(c))}}}return c}function H(a,c,d){var e=a.contents,f=a.dataTypes,g=a.responseFields,h,i,j,k;for(i in g){if(i in d){c[g[i]]=d[i]}}while(f[0]==="*"){f.shift();if(h===b){h=a.mimeType||c.getResponseHeader("content-type")}}if(h){for(i in e){if(e[i]&&e[i].test(h)){f.unshift(i);break}}}if(f[0]in d){j=f[0]}else{for(i in d){if(!f[0]||a.converters[i+" "+f[0]]){j=i;break}if(!k){k=i}}j=j||k}if(j){if(j!==f[0]){f.unshift(j)}return d[j]}}function G(a,b,c,d){if(f.isArray(b)){f.each(b,function(b,e){if(c||j.test(a)){d(a,e)}else{G(a+"["+(typeof e==="object"||f.isArray(e)?b:"")+"]",e,c,d)}})}else if(!c&&b!=null&&typeof b==="object"){for(var e in b){G(a+"["+e+"]",b[e],c,d)}}else{d(a,b)}}function F(a,c){var d,e,g=f.ajaxSettings.flatOptions||{};for(d in c){if(c[d]!==b){(g[d]?a:e||(e={}))[d]=c[d]}}if(e){f.extend(true,a,e)}}function E(a,c,d,e,f,g){f=f||c.dataTypes[0];g=g||{};g[f]=true;var h=a[f],i=0,j=h?h.length:0,k=a===y,l;for(;i<j&&(k||!l);i++){l=h[i](c,d,e);if(typeof l==="string"){if(!k||g[l]){l=b}else{c.dataTypes.unshift(l);l=E(a,c,d,e,l,g)}}}if((k||!l)&&!g["*"]){l=E(a,c,d,e,"*",g)}return l}function D(a){return function(b,c){if(typeof b!=="string"){c=b;b="*"}if(f.isFunction(c)){var d=b.toLowerCase().split(u),e=0,g=d.length,h,i,j;for(;e<g;e++){h=d[e];j=/^\+/.test(h);if(j){h=h.substr(1)||"*"}i=a[h]=a[h]||[];i[j?"unshift":"push"](c)}}}}var c=a.document,d=a.navigator,e=a.location;var f=function(){function J(){if(e.isReady){return}try{c.documentElement.doScroll("left")}catch(a){setTimeout(J,1);return}e.ready()}var e=function(a,b){return new e.fn.init(a,b,h)},f=a.jQuery,g=a.$,h,i=/^(?:[^<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,j=/\S/,k=/^\s+/,l=/\s+$/,m=/\d/,n=/^<(\w+)\s*\/?>(?:<\/\1>)?$/,o=/^[\],:{}\s]*$/,p=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,q=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,r=/(?:^|:|,)(?:\s*\[)+/g,s=/(webkit)[ \/]([\w.]+)/,t=/(opera)(?:.*version)?[ \/]([\w.]+)/,u=/(msie) ([\w.]+)/,v=/(mozilla)(?:.*? rv:([\w.]+))?/,w=/-([a-z])/ig,x=function(a,b){return b.toUpperCase()},y=d.userAgent,z,A,B,C=Object.prototype.toString,D=Object.prototype.hasOwnProperty,E=Array.prototype.push,F=Array.prototype.slice,G=String.prototype.trim,H=Array.prototype.indexOf,I={};e.fn=e.prototype={constructor:e,init:function(a,d,f){var g,h,j,k;if(!a){return this}if(a.nodeType){this.context=this[0]=a;this.length=1;return this}if(a==="body"&&!d&&c.body){this.context=c;this[0]=c.body;this.selector=a;this.length=1;return this}if(typeof a==="string"){if(a.charAt(0)==="<"&&a.charAt(a.length-1)===">"&&a.length>=3){g=[null,a,null]}else{g=i.exec(a)}if(g&&(g[1]||!d)){if(g[1]){d=d instanceof e?d[0]:d;k=d?d.ownerDocument||d:c;j=n.exec(a);if(j){if(e.isPlainObject(d)){a=[c.createElement(j[1])];e.fn.attr.call(a,d,true)}else{a=[k.createElement(j[1])]}}else{j=e.buildFragment([g[1]],[k]);a=(j.cacheable?e.clone(j.fragment):j.fragment).childNodes}return e.merge(this,a)}else{h=c.getElementById(g[2]);if(h&&h.parentNode){if(h.id!==g[2]){return f.find(a)}this.length=1;this[0]=h}this.context=c;this.selector=a;return this}}else if(!d||d.jquery){return(d||f).find(a)}else{return this.constructor(d).find(a)}}else if(e.isFunction(a)){return f.ready(a)}if(a.selector!==b){this.selector=a.selector;this.context=a.context}return e.makeArray(a,this)},selector:"",jquery:"1.6.3pre",length:0,size:function(){return this.length},toArray:function(){return F.call(this,0)},get:function(a){return a==null?this.toArray():a<0?this[this.length+a]:this[a]},pushStack:function(a,b,c){var d=this.constructor();if(e.isArray(a)){E.apply(d,a)}else{e.merge(d,a)}d.prevObject=this;d.context=this.context;if(b==="find"){d.selector=this.selector+(this.selector?" ":"")+c}else if(b){d.selector=this.selector+"."+b+"("+c+")"}return d},each:function(a,b){return e.each(this,a,b)},ready:function(a){e.bindReady();A.done(a);return this},eq:function(a){return a===-1?this.slice(a):this.slice(a,+a+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack(F.apply(this,arguments),"slice",F.call(arguments).join(","))},map:function(a){return this.pushStack(e.map(this,function(b,c){return a.call(b,c,b)}))},end:function(){return this.prevObject||this.constructor(null)},push:E,sort:[].sort,splice:[].splice};e.fn.init.prototype=e.fn;e.extend=e.fn.extend=function(){var a,c,d,f,g,h,i=arguments[0]||{},j=1,k=arguments.length,l=false;if(typeof i==="boolean"){l=i;i=arguments[1]||{};j=2}if(typeof i!=="object"&&!e.isFunction(i)){i={}}if(k===j){i=this;--j}for(;j<k;j++){if((a=arguments[j])!=null){for(c in a){d=i[c];f=a[c];if(i===f){continue}if(l&&f&&(e.isPlainObject(f)||(g=e.isArray(f)))){if(g){g=false;h=d&&e.isArray(d)?d:[]}else{h=d&&e.isPlainObject(d)?d:{}}i[c]=e.extend(l,h,f)}else if(f!==b){i[c]=f}}}}return i};e.extend({noConflict:function(b){if(a.$===e){a.$=g}if(b&&a.jQuery===e){a.jQuery=f}return e},isReady:false,readyWait:1,holdReady:function(a){if(a){e.readyWait++}else{e.ready(true)}},ready:function(a){if(a===true&&!--e.readyWait||a!==true&&!e.isReady){if(!c.body){return setTimeout(e.ready,1)}e.isReady=true;if(a!==true&&--e.readyWait>0){return}A.resolveWith(c,[e]);if(e.fn.trigger){e(c).trigger("ready").unbind("ready")}}},bindReady:function(){if(A){return}A=e._Deferred();if(c.readyState==="complete"){return setTimeout(e.ready,1)}if(c.addEventListener){c.addEventListener("DOMContentLoaded",B,false);a.addEventListener("load",e.ready,false)}else if(c.attachEvent){c.attachEvent("onreadystatechange",B);a.attachEvent("onload",e.ready);var b=false;try{b=a.frameElement==null}catch(d){}if(c.documentElement.doScroll&&b){J()}}},isFunction:function(a){return e.type(a)==="function"},isArray:Array.isArray||function(a){return e.type(a)==="array"},isWindow:function(a){return a&&typeof a==="object"&&"setInterval"in a},isNaN:function(a){return a==null||!m.test(a)||isNaN(a)},type:function(a){return a==null?String(a):I[C.call(a)]||"object"},isPlainObject:function(a){if(!a||e.type(a)!=="object"||a.nodeType||e.isWindow(a)){return false}if(a.constructor&&!D.call(a,"constructor")&&!D.call(a.constructor.prototype,"isPrototypeOf")){return false}var c;for(c in a){}return c===b||D.call(a,c)},isEmptyObject:function(a){for(var b in a){return false}return true},error:function(a){throw a},parseJSON:function(b){if(typeof b!=="string"||!b){return null}b=e.trim(b);if(a.JSON&&a.JSON.parse){return a.JSON.parse(b)}if(o.test(b.replace(p,"@").replace(q,"]").replace(r,""))){return(new Function("return "+b))()}e.error("Invalid JSON: "+b)},parseXML:function(c){var d,f;try{if(a.DOMParser){f=new DOMParser;d=f.parseFromString(c,"text/xml")}else{d=new ActiveXObject("Microsoft.XMLDOM");d.async="false";d.loadXML(c)}}catch(g){d=b}if(!d||!d.documentElement||d.getElementsByTagName("parsererror").length){e.error("Invalid XML: "+c)}return d},noop:function(){},globalEval:function(b){if(b&&j.test(b)){(a.execScript||function(b){a["eval"].call(a,b)})(b)}},camelCase:function(a){return a.replace(w,x)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toUpperCase()===b.toUpperCase()},each:function(a,c,d){var f,g=0,h=a.length,i=h===b||e.isFunction(a);if(d){if(i){for(f in a){if(c.apply(a[f],d)===false){break}}}else{for(;g<h;){if(c.apply(a[g++],d)===false){break}}}}else{if(i){for(f in a){if(c.call(a[f],f,a[f])===false){break}}}else{for(;g<h;){if(c.call(a[g],g,a[g++])===false){break}}}}return a},trim:G?function(a){return a==null?"":G.call(a)}:function(a){return a==null?"":a.toString().replace(k,"").replace(l,"")},makeArray:function(a,b){var c=b||[];if(a!=null){var d=e.type(a);if(a.length==null||d==="string"||d==="function"||d==="regexp"||e.isWindow(a)){E.call(c,a)}else{e.merge(c,a)}}return c},inArray:function(a,b){if(H){return H.call(b,a)}for(var c=0,d=b.length;c<d;c++){if(b[c]===a){return c}}return-1},merge:function(a,c){var d=a.length,e=0;if(typeof c.length==="number"){for(var f=c.length;e<f;e++){a[d++]=c[e]}}else{while(c[e]!==b){a[d++]=c[e++]}}a.length=d;return a},grep:function(a,b,c){var d=[],e;c=!!c;for(var f=0,g=a.length;f<g;f++){e=!!b(a[f],f);if(c!==e){d.push(a[f])}}return d},map:function(a,c,d){var f,g,h=[],i=0,j=a.length,k=a instanceof e||j!==b&&typeof j==="number"&&(j>0&&a[0]&&a[j-1]||j===0||e.isArray(a));if(k){for(;i<j;i++){f=c(a[i],i,d);if(f!=null){h[h.length]=f}}}else{for(g in a){f=c(a[g],g,d);if(f!=null){h[h.length]=f}}}return h.concat.apply([],h)},guid:1,proxy:function(a,c){if(typeof c==="string"){var d=a[c];c=a;a=d}if(!e.isFunction(a)){return b}var f=F.call(arguments,2),g=function(){return a.apply(c,f.concat(F.call(arguments)))};g.guid=a.guid=a.guid||g.guid||e.guid++;return g},access:function(a,c,d,f,g,h){var i=a.length;if(typeof c==="object"){for(var j in c){e.access(a,j,c[j],f,g,d)}return a}if(d!==b){f=!h&&f&&e.isFunction(d);for(var k=0;k<i;k++){g(a[k],c,f?d.call(a[k],k,g(a[k],c)):d,h)}return a}return i?g(a[0],c):b},now:function(){return(new Date).getTime()},uaMatch:function(a){a=a.toLowerCase();var b=s.exec(a)||t.exec(a)||u.exec(a)||a.indexOf("compatible")<0&&v.exec(a)||[];return{browser:b[1]||"",version:b[2]||"0"}},sub:function(){function a(b,c){return new a.fn.init(b,c)}e.extend(true,a,this);a.superclass=this;a.fn=a.prototype=this();a.fn.constructor=a;a.sub=this.sub;a.fn.init=function d(c,d){if(d&&d instanceof e&&!(d instanceof a)){d=a(d)}return e.fn.init.call(this,c,d,b)};a.fn.init.prototype=a.fn;var b=a(c);return a},browser:{}});e.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(a,b){I["[object "+b+"]"]=b.toLowerCase()});z=e.uaMatch(y);if(z.browser){e.browser[z.browser]=true;e.browser.version=z.version}if(e.browser.webkit){e.browser.safari=true}if(j.test(" ")){k=/^[\s\xA0]+/;l=/[\s\xA0]+$/}h=e(c);if(c.addEventListener){B=function(){c.removeEventListener("DOMContentLoaded",B,false);e.ready()}}else if(c.attachEvent){B=function(){if(c.readyState==="complete"){c.detachEvent("onreadystatechange",B);e.ready()}}}return e}();var g="done fail isResolved isRejected promise then always pipe".split(" "),h=[].slice;f.extend({_Deferred:function(){var a=[],b,c,d,e={done:function(){if(!d){var c=arguments,g,h,i,j,k;if(b){k=b;b=0}for(g=0,h=c.length;g<h;g++){i=c[g];j=f.type(i);if(j==="array"){e.done.apply(e,i)}else if(j==="function"){a.push(i)}}if(k){e.resolveWith(k[0],k[1])}}return this},resolveWith:function(e,f){if(!d&&!b&&!c){f=f||[];c=1;try{while(a[0]){a.shift().apply(e,f)}}finally{b=[e,f];c=0}}return this},resolve:function(){e.resolveWith(this,arguments);return this},isResolved:function(){return!!(c||b)},cancel:function(){d=1;a=[];return this}};return e},Deferred:function(a){var b=f._Deferred(),c=f._Deferred(),d;f.extend(b,{then:function(a,c){b.done(a).fail(c);return this},always:function(){return b.done.apply(b,arguments).fail.apply(this,arguments)},fail:c.done,rejectWith:c.resolveWith,reject:c.resolve,isRejected:c.isResolved,pipe:function(a,c){return f.Deferred(function(d){f.each({done:[a,"resolve"],fail:[c,"reject"]},function(a,c){var e=c[0],g=c[1],h;if(f.isFunction(e)){b[a](function(){h=e.apply(this,arguments);if(h&&f.isFunction(h.promise)){h.promise().then(d.resolve,d.reject)}else{d[g+"With"](this===b?d:this,[h])}})}else{b[a](d[g])}})}).promise()},promise:function(a){if(a==null){if(d){return d}d=a={}}var c=g.length;while(c--){a[g[c]]=b[g[c]]}return a}});b.done(c.cancel).fail(b.cancel);delete b.cancel;if(a){a.call(b,b)}return b},when:function(a){function i(a){return function(c){b[a]=arguments.length>1?h.call(arguments,0):c;if(!--e){g.resolveWith(g,h.call(b,0))}}}var b=arguments,c=0,d=b.length,e=d,g=d<=1&&a&&f.isFunction(a.promise)?a:f.Deferred();if(d>1){for(;c<d;c++){if(b[c]&&f.isFunction(b[c].promise)){b[c].promise().then(i(c),g.reject)}else{--e}}if(!e){g.resolveWith(g,b)}}else if(g!==a){g.resolveWith(g,d?[a]:[])}return g.promise()}});f.support=f.support||{};var i=/%20/g,j=/\[\]$/,k=/\r?\n/g,l=/#.*$/,m=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,n=/^(?:color|date|datetime|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,o=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,p=/^(?:GET|HEAD)$/,q=/^\/\//,r=/\?/,s=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,t=/^(?:select|textarea)/i,u=/\s+/,v=/([?&])_=[^&]*/,w=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/,x=f.fn.load,y={},z={},A,B;try{A=e.href}catch(C){A=c.createElement("a");A.href="";A=A.href}B=w.exec(A.toLowerCase())||[];f.fn.extend({load:function(a,c,d){if(typeof a!=="string"&&x){return x.apply(this,arguments)}else if(!this.length){return this}var e=a.indexOf(" ");if(e>=0){var g=a.slice(e,a.length);a=a.slice(0,e)}var h="GET";if(c){if(f.isFunction(c)){d=c;c=b}else if(typeof c==="object"){c=f.param(c,f.ajaxSettings.traditional);h="POST"}}var i=this;f.ajax({url:a,type:h,dataType:"html",data:c,complete:function(a,b,c){c=a.responseText;if(a.isResolved()){a.done(function(a){c=a});i.html(g?f("<div>").append(c.replace(s,"")).find(g):c)}if(d){i.each(d,[c,b,a])}}});return this},serialize:function(){return f.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?f.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||t.test(this.nodeName)||n.test(this.type))}).map(function(a,b){var c=f(this).val();return c==null?null:f.isArray(c)?f.map(c,function(a,c){return{name:b.name,value:a.replace(k,"\r\n")}}):{name:b.name,value:c.replace(k,"\r\n")}}).get()}});f.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(a,b){f.fn[b]=function(a){return this.bind(b,a)}});f.each(["get","post"],function(a,c){f[c]=function(a,d,e,g){if(f.isFunction(d)){g=g||e;e=d;d=b}return f.ajax({type:c,url:a,data:d,success:e,dataType:g})}});f.extend({getScript:function(a,c){return f.get(a,b,c,"script")},getJSON:function(a,b,c){return f.get(a,b,c,"json")},ajaxSetup:function(a,b){if(b){F(a,f.ajaxSettings)}else{b=a;a=f.ajaxSettings}F(a,b);return a},ajaxSettings:{url:A,isLocal:o.test(B[1]),global:true,type:"GET",contentType:"application/x-www-form-urlencoded",processData:true,async:true,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":"*/*"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":a.String,"text html":true,"text json":f.parseJSON,"text xml":f.parseXML},flatOptions:{context:true,url:true}},ajaxPrefilter:D(y),ajaxTransport:D(z),ajax:function(a,c){function K(a,c,l,m){if(D===2){return}D=2;if(A){clearTimeout(A)}x=b;s=m||"";J.readyState=a>0?4:0;var n,o,p,q=c,r=l?H(d,J,l):b,t,u;if(a>=200&&a<300||a===304){if(d.ifModified){if(t=J.getResponseHeader("Last-Modified")){f.lastModified[k]=t}if(u=J.getResponseHeader("Etag")){f.etag[k]=u}}if(a===304){q="notmodified";n=true}else{try{o=I(d,r);q="success";n=true}catch(v){q="parsererror";p=v}}}else{p=q;if(!q||a){q="error";if(a<0){a=0}}}J.status=a;J.statusText=""+(c||q);if(n){h.resolveWith(e,[o,q,J])}else{h.rejectWith(e,[J,q,p])}J.statusCode(j);j=b;if(F){g.trigger("ajax"+(n?"Success":"Error"),[J,d,n?o:p])}i.resolveWith(e,[J,q]);if(F){g.trigger("ajaxComplete",[J,d]);if(!--f.active){f.event.trigger("ajaxStop")}}}if(typeof a==="object"){c=a;a=b}c=c||{};var d=f.ajaxSetup({},c),e=d.context||d,g=e!==d&&(e.nodeType||e instanceof f)?f(e):f.event,h=f.Deferred(),i=f._Deferred(),j=d.statusCode||{},k,n={},o={},s,t,x,A,C,D=0,F,G,J={readyState:0,setRequestHeader:function(a,b){if(!D){var c=a.toLowerCase();a=o[c]=o[c]||a;n[a]=b}return this},getAllResponseHeaders:function(){return D===2?s:null},getResponseHeader:function(a){var c;if(D===2){if(!t){t={};while(c=m.exec(s)){t[c[1].toLowerCase()]=c[2]}}c=t[a.toLowerCase()]}return c===b?null:c},overrideMimeType:function(a){if(!D){d.mimeType=a}return this},abort:function(a){a=a||"abort";if(x){x.abort(a)}K(0,a);return this}};h.promise(J);J.success=J.done;J.error=J.fail;J.complete=i.done;J.statusCode=function(a){if(a){var b;if(D<2){for(b in a){j[b]=[j[b],a[b]]}}else{b=a[J.status];J.then(b,b)}}return this};d.url=((a||d.url)+"").replace(l,"").replace(q,B[1]+"//");d.dataTypes=f.trim(d.dataType||"*").toLowerCase().split(u);if(d.crossDomain==null){C=w.exec(d.url.toLowerCase());d.crossDomain=!!(C&&(C[1]!=B[1]||C[2]!=B[2]||(C[3]||(C[1]==="http:"?80:443))!=(B[3]||(B[1]==="http:"?80:443))))}if(d.data&&d.processData&&typeof d.data!=="string"){d.data=f.param(d.data,d.traditional)}E(y,d,c,J);if(D===2){return false}F=d.global;d.type=d.type.toUpperCase();d.hasContent=!p.test(d.type);if(F&&f.active++===0){f.event.trigger("ajaxStart")}if(!d.hasContent){if(d.data){d.url+=(r.test(d.url)?"&":"?")+d.data;delete d.data}k=d.url;if(d.cache===false){var L=f.now(),M=d.url.replace(v,"$1_="+L);d.url=M+(M===d.url?(r.test(d.url)?"&":"?")+"_="+L:"")}}if(d.data&&d.hasContent&&d.contentType!==false||c.contentType){J.setRequestHeader("Content-Type",d.contentType)}if(d.ifModified){k=k||d.url;if(f.lastModified[k]){J.setRequestHeader("If-Modified-Since",f.lastModified[k])}if(f.etag[k]){J.setRequestHeader("If-None-Match",f.etag[k])}}J.setRequestHeader("Accept",d.dataTypes[0]&&d.accepts[d.dataTypes[0]]?d.accepts[d.dataTypes[0]]+(d.dataTypes[0]!=="*"?", */*; q=0.01":""):d.accepts["*"]);for(G in d.headers){J.setRequestHeader(G,d.headers[G])}if(d.beforeSend&&(d.beforeSend.call(e,J,d)===false||D===2)){J.abort();return false}for(G in{success:1,error:1,complete:1}){J[G](d[G])}x=E(z,d,c,J);if(!x){K(-1,"No Transport")}else{J.readyState=1;if(F){g.trigger("ajaxSend",[J,d])}if(d.async&&d.timeout>0){A=setTimeout(function(){J.abort("timeout")},d.timeout)}try{D=1;x.send(n,K)}catch(N){if(D<2){K(-1,N)}else{f.error(N)}}}return J},param:function(a,c){var d=[],e=function(a,b){b=f.isFunction(b)?b():b;d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(c===b){c=f.ajaxSettings.traditional}if(f.isArray(a)||a.jquery&&!f.isPlainObject(a)){f.each(a,function(){e(this.name,this.value)})}else{for(var g in a){G(g,a[g],c,e)}}return d.join("&").replace(i,"+")}});f.extend({active:0,lastModified:{},etag:{}});var J=a.ActiveXObject?function(){for(var a in L){L[a](0,1)}}:false,K=0,L;f.ajaxSettings.xhr=a.ActiveXObject?function(){return!this.isLocal&&M()||N()}:M;(function(a){f.extend(f.support,{ajax:!!a,cors:!!a&&"withCredentials"in a})})(f.ajaxSettings.xhr());if(f.support.ajax){f.ajaxTransport(function(c){if(!c.crossDomain||f.support.cors){var d;return{send:function(e,g){var h=c.xhr(),i,j;if(c.username){h.open(c.type,c.url,c.async,c.username,c.password)}else{h.open(c.type,c.url,c.async)}if(c.xhrFields){for(j in c.xhrFields){h[j]=c.xhrFields[j]}}if(c.mimeType&&h.overrideMimeType){h.overrideMimeType(c.mimeType)}if(!c.crossDomain&&!e["X-Requested-With"]){e["X-Requested-With"]="XMLHttpRequest"}try{for(j in e){h.setRequestHeader(j,e[j])}}catch(k){}h.send(c.hasContent&&c.data||null);d=function(a,e){var j,k,l,m,n;try{if(d&&(e||h.readyState===4)){d=b;if(i){h.onreadystatechange=f.noop;if(J){delete L[i]}}if(e){if(h.readyState!==4){h.abort()}}else{j=h.status;l=h.getAllResponseHeaders();m={};n=h.responseXML;if(n&&n.documentElement){m.xml=n}m.text=h.responseText;try{k=h.statusText}catch(o){k=""}if(!j&&c.isLocal&&!c.crossDomain){j=m.text?200:404}else if(j===1223){j=204}}}}catch(p){if(!e){g(-1,p)}}if(m){g(j,k,m,l)}};if(!c.async||h.readyState===4){d()}else{i=++K;if(J){if(!L){L={};f(a).unload(J)}L[i]=d}h.onreadystatechange=d}},abort:function(){if(d){d(0,1)}}}}})}f.ajaxSettings.global=false;a.jQuery=a.$=f})(global)}
},{}],11:[function(require,module,exports){
// ==============================================================
// = BAM format: https://samtools.github.io/hts-specs/SAMv1.pdf =
// ==============================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10,
  deepClone = utils.deepClone;
var PairedIntervalTree = require('./utils/PairedIntervalTree.js').PairedIntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

var BamFormat = {
  defaults: {
    chromosomes: '',
    itemRgb: 'off',
    color: '188,188,188',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: 2000, pack: 2000},
    // If a nucleotide differs from the reference sequence in greater than 20% of quality weighted reads, 
    // IGV colors the bar in proportion to the read count of each base; the following changes that threshold for chromozoom
    alleleFreqThreshold: 0.2,
    optimalFetchWindow: 0,
    maxFetchWindow: 0,
    // The following can be "ensembl_ucsc" or "ucsc_ensembl" to attempt auto-crossmapping of reference contig names
    // between the two schemes, which IGV does, but is a perennial issue: https://www.biostars.org/p/10062/
    // I hope not to need all the mappings in here https://github.com/dpryan79/ChromosomeMappings but it may be necessary
    convertChrScheme: "auto",
    // Draw paired ends within a range of expected insert sizes as a continuous feature?
    // See https://www.broadinstitute.org/igv/AlignmentData#paired for how this works
    viewAsPairs: false,
    expectedInsertSizePercentiles: [0.005, 0.995]
  },
  
  // The FLAG column for BAM/SAM is a combination of bitwise flags
  flags: {
    isReadPaired: 0x1,
    isReadProperlyAligned: 0x2,
    isReadUnmapped: 0x4,
    isMateUnmapped: 0x8,
    readStrandReverse: 0x10,
    mateStrandReverse: 0x20,
    isReadFirstOfPair: 0x40,
    isReadLastOfPair: 0x80,
    isSecondaryAlignment: 0x100,
    isReadFailingVendorQC: 0x200,
    isDuplicateRead: 0x400,
    isSupplementaryAlignment: 0x800
  },

  init: function() {
    var browserChrs = _.keys(this.browserOpts);
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for BAM track at " +
          JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.browserChrScheme = this.type("bam").guessChrScheme(_.keys(this.browserOpts.chrPos));
  },
  
  // TODO: If the pairing interval changed, we should toss the entire cache and reset the RemoteTrack bins,
  //         *and* blow up the areaIndex.
  applyOpts: function() {
    var o = this.opts;
    // When we change opts.viewAsPairs, we *need* to throw out this.data.pileup.
    if (o.viewAsPairs != this.prevOpts.viewAsPairs) { this.data.pileup = {}; }
    this.prevOpts = deepClone(this.opts);
  },
  
  guessChrScheme: function(chrs) {
    limit = Math.min(chrs.length * 0.8, 20);
    if (_.filter(chrs, function(chr) { return (/^chr/).test(chr); }).length > limit) { return 'ucsc'; }
    if (_.filter(chrs, function(chr) { return (/^\d\d?$/).test(chr); }).length > limit) { return 'ensembl'; }
    return null;
  },
  
  parse: function(lines) {
    var self = this,
      o = self.opts,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new PairedIntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}, 
          {startKey: 'templateStart', endKey: 'templateEnd', pairedLengthKey: 'tlen', pairingKey: 'qname'}),
      ajaxUrl = self.ajaxDir() + 'bam.php',
      infoChrRange = self.chrRange(Math.round(self.browserOpts.pos), Math.round(self.browserOpts.pos + 10000)),
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
      // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
      switch (o.convertChrScheme == "auto" ? self.data.info.convertChrScheme : o.convertChrScheme) {
        case 'ensembl_ucsc': range = _.map(range, function(r) { return r.replace(/^chr/, ''); }); break;
        case 'ucsc_ensembl': range = _.map(range, function(r) { return r.replace(/^(\d\d?|X):/, 'chr$1:'); }); break;
      }
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl},
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          
          // Parse the SAM format into intervals that can be inserted into the IntervalTree cache
          var intervals = _.map(lines, function(l) { return self.type('bam').parseLine.call(self, l); });
          storeIntervals(intervals);
        }
      });
    });
    
    self.data = {cache: cache, remote: remote, pileup: {}, info: {}};
    self.heights = {max: null, min: 24, start: 24};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    self.noAreaLabels = true;
    self.expectsSequence = true;
    self.renderSequenceCallbacks = {};
    self.prevOpts = deepClone(o);  // used to detect which drawing options have been changed by the user
    
    // Get general info on the bam (e.g. `samtools idxstats`, use mapped reads per reference sequence
    // to estimate maxFetchWindow and optimalFetchWindow, and setup binning on the RemoteTrack.
    $.ajax(ajaxUrl, {
      data: {range: infoChrRange, url: o.bigDataUrl, info: 1},
      success: function(data) {
        var mappedReads = 0,
          maxItemsToDraw = _.max(_.values(o.drawLimit)),
          bamChrs = [],
          infoParts = data.split("\n\n"),
          estimatedInsertSizes = [],
          pctiles = o.expectedInsertSizePercentiles,
          lowerBound = 10, 
          upperBound = 5000, 
          sampleIntervals, meanItemLength, hasAMatePair, chrScheme, meanItemsPerBp;
        
        _.each(infoParts[0].split("\n"), function(line) {
          var fields = line.split("\t"),
            readsMappedToContig = parseInt(fields[2], 10);
          if (fields.length == 1 && fields[0] == '') { return; } // blank line
          bamChrs.push(fields[0]);
          if (_.isNaN(readsMappedToContig)) { throw new Error("Invalid output for samtools idxstats on this BAM track."); }
          mappedReads += readsMappedToContig;
        });
        
        self.data.info.chrScheme = chrScheme = self.type("bam").guessChrScheme(bamChrs);
        if (chrScheme && self.browserChrScheme) {
          self.data.info.convertChrScheme = chrScheme != self.browserChrScheme ? chrScheme + '_' + self.browserChrScheme : null;
        }
        
        sampleIntervals = _.compact(_.map(infoParts[1].split("\n"), function(line) {
          return self.type('bam').parseLine.call(self, line);
        }));
        if (sampleIntervals.length) {
          meanItemLength = _.reduce(sampleIntervals, function(memo, next) { return memo + (next.end - next.start); }, 0);
          meanItemLength = Math.round(meanItemLength / sampleIntervals.length);
          hasAMatePair = _.some(sampleIntervals, function(itvl) { 
            return itvl.flags.isReadFirstOfPair || itvl.flags.isReadLastOfPair;
          });
          estimatedInsertSizes = _.compact(_.map(sampleIntervals, function(itvl) { 
            return itvl.tlen ? Math.abs(itvl.tlen) : 0; 
          }));
          estimatedInsertSizes.sort(function(a, b) { return a - b; });  // NOTE: JavaScript does string sorting by default -_-
        }
        
        self.data.info.meanItemsPerBp = meanItemsPerBp = mappedReads / self.browserOpts.genomeSize;
        self.data.info.meanItemLength = meanItemLength = _.isUndefined(meanItemLength) ? 100 : meanItemLength;
        o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp / (Math.max(meanItemLength, 100) / 100);
        o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 2);
        
        // If there is pairing, we need to tell the PairedIntervalTree what range of insert sizes should trigger pairing.
        if (hasAMatePair) {
          if (estimatedInsertSizes.length) {
            lowerBound = estimatedInsertSizes[Math.floor(estimatedInsertSizes.length * pctiles[0])];
            upperBound = estimatedInsertSizes[Math.floor(estimatedInsertSizes.length * pctiles[1])];
          }
          self.data.cache.setPairingInterval(lowerBound, upperBound);
        } else {
          // If we don't see any paired reads in this BAM, deactivate the pairing functionality of the PairedIntervalTree 
          self.data.cache.disablePairing();
        }
        remote.setupBins(self.browserOpts.genomeSize, o.optimalFetchWindow, o.maxFetchWindow);
      }
    });
    
    return true;
  },
  
  // Sets feature.flags[...] to a human interpretable version of feature.flag (expanding the bitwise flags)
  parseFlags: function(feature, lineno) {
    feature.flags = {};
    _.each(this.type('bam').flags, function(bit, flag) {
      feature.flags[flag] = !!(feature.flag & bit);
    });
  },
  
  // Sets feature.blocks and feature.end based on feature.cigar
  // See section 1.4 of https://samtools.github.io/hts-specs/SAMv1.pdf for an explanation of CIGAR 
  parseCigar: function(feature, lineno) {        
    var cigar = feature.cigar,
      seq = (!feature.seq || feature.seq == '*') ? "" : feature.seq,
      refLen = 0,
      seqPos = 0,
      operations, lengths;
    
    feature.blocks = [];
    feature.insertions = [];
    
    ops = cigar.split(/\d+/).slice(1);
    lengths = cigar.split(/[A-Z=]/).slice(0, -1);
    if (ops.length != lengths.length) { this.warn("Invalid CIGAR '" + cigar + "' for " + feature.desc); return; }
    lengths = _.map(lengths, parseInt10);
    
    _.each(ops, function(op, i) {
      var len = lengths[i],
        block, insertion;
      if (/^[MX=]$/.test(op)) {
        // Alignment match, sequence match, sequence mismatch
        block = {start: feature.start + refLen};
        block.end = block.start + len;
        block.type = op;
        block.seq = seq.slice(seqPos, seqPos + len);
        feature.blocks.push(block);
        refLen += len;
        seqPos += len;
      } else if (/^[ND]$/.test(op)) {
        // Skipped reference region, deletion from reference
        refLen += len;
      } else if (op == 'I') {
        // Insertion
        insertion = {start: feature.start + refLen, end: feature.start + refLen};
        insertion.seq = seq.slice(seqPos, seqPos + len);
        feature.insertions.push(insertion);
        seqPos += len;
      } else if (op == 'S') {
        // Soft clipping; simply skip these bases in SEQ, position on reference is unchanged.
        seqPos += len;
      }
      // The other two CIGAR ops, H and P, are not relevant to drawing alignments.
    });
    
    feature.end = feature.start + refLen;
  },
  
  parseLine: function(line, lineno) {
    var o = this.opts,
      cols = ['qname', 'flag', 'rname', 'pos', 'mapq', 'cigar', 'rnext', 'pnext', 'tlen', 'seq', 'qual'],
      feature = {},
      fields = line.split("\t"),
      availFlags = this.type('bam').flags,
      chrPos, blockSizes;
    
    _.each(_.first(fields, cols.length), function(v, i) { feature[cols[i]] = v; });
    // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
    // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
    switch (o.convertChrScheme == "auto" ? this.data.info.convertChrScheme : o.convertChrScheme) {
      case 'ucsc_ensembl': feature.rname = feature.rname.replace(/^chr/, ''); break;
      case 'ensembl_ucsc': feature.rname = (/^(\d\d?|X)$/.test(feature.rname) ? 'chr' : '') + feature.rname; break;
    }
    feature.name = feature.qname;
    feature.flag = parseInt10(feature.flag);
    chrPos = this.browserOpts.chrPos[feature.rname];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) {
      this.warn("Invalid RNAME '"+feature.rname+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else if (feature.pos === '0' || !feature.cigar || feature.cigar == '*' || feature.flag & availFlags.isReadUnmapped) {
      // Unmapped read. Since we can't draw these at all, we don't bother parsing them further.
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.pos);        // POS is 1-based, hence no increment as for parsing BED
      feature.desc = feature.qname + ' at ' + feature.rname + ':' + feature.pos;
      feature.tlen = parseInt10(feature.tlen);
      this.type('bam').parseFlags.call(this, feature, lineno);
      feature.strand = feature.flags.readStrandReverse ? '-' : '+';
      this.type('bam').parseCigar.call(this, feature, lineno); // This also sets .end appropriately
    }
    // We have to come up with something that is a unique label for every line to dedupe rows.
    // The following is technically not guaranteed by a valid BAM (even at GATK standards), but it's the best I got.
    feature.id = [feature.qname, feature.flag, feature.rname, feature.pos, feature.cigar].join("\t");
    
    return feature;
  },
  
  pileup: function(intervals, start, end) {
    var pileup = this.data.pileup,
      positionsToCalculate = {},
      numPositionsToCalculate = 0,
      i;
    
    for (i = start; i < end; i++) {
      // No need to pileup again on already-piled-up nucleotide positions
      if (!pileup[i]) { positionsToCalculate[i] = true; numPositionsToCalculate++; }
    }
    if (numPositionsToCalculate === 0) { return; } // All positions already piled up!
    
    _.each(intervals, function(interval) {
      var blockSets = [interval.data.blocks];
      if (interval.data.drawAsMates && interval.data.mate) { blockSets.push(interval.data.mate.blocks); }
      _.each(blockSets, function(blocks) {
        _.each(blocks, function(block) {
          var nt, i;
          for (i = Math.max(block.start, start); i < Math.min(block.end, end); i++) {
            if (!positionsToCalculate[i]) { continue; }
            nt = (block.seq[i - block.start] || '').toUpperCase();
            pileup[i] = pileup[i] || {A: 0, C: 0, G: 0, T: 0, N: 0, cov: 0};
            pileup[i][(/[ACTG]/).test(nt) ? nt : 'N'] += 1;
            pileup[i].cov += 1;
          }
        });
      });
    });
  },
  
  coverage: function(start, width, bppp) {
    // Compare with binning on the fly in .type('wiggle_0').prerender(...)
    var j = start,
      vScale = this.data.info.meanItemsPerBp * this.data.info.meanItemLength * 2,
      curr = this.data.pileup[j],
      bars = [],
      next, bin, i;
    for (i = 0; i < width; i++) {
      bin = curr && (j + 1 >= i * bppp + start) ? [curr.cov] : [];
      next = this.data.pileup[j + 1];
      while (j + 1 < (i + 1) * bppp + start && j + 2 >= i * bppp + start) { 
        if (next) { bin.push(next.cov); }
        ++j;
        curr = next;
        next = this.data.pileup[j + 1];
      }
      bars.push(utils.wigBinFunctions.maximum(bin) / vScale);
    }
    return bars;
  },
  
  alleles: function(start, sequence, bppp) {
    var pileup = this.data.pileup,
      vScale = this.data.info.meanItemsPerBp * this.data.info.meanItemLength * 2,
      alleleFreqThreshold = this.opts.alleleFreqThreshold,
      alleleSplits = [],
      split, refNt, i, pile;
      
    for (i = 0; i < sequence.length; i++) {
      refNt = sequence[i].toUpperCase();
      pile = pileup[start + i];
      if (pile && pile.cov && pile[refNt] / (pile.cov - pile.N) < (1 - alleleFreqThreshold)) {
        split = {
          x: i / bppp,
          splits: []
        };
        _.each(['A', 'C', 'G', 'T'], function(nt) {
          if (pile[nt] > 0) { split.splits.push({nt: nt, h: pile[nt] / vScale}); }
        });
        alleleSplits.push(split);
      }
    }
    
    return alleleSplits;
  },
  
  mismatches: function(start, sequence, bppp, intervals, width, lineNum, viewAsPairs) {
    var mismatches = [],
      viewAsPairs = this.opts.viewAsPairs;
    sequence = sequence.toUpperCase();
    _.each(intervals, function(interval) {
      var blockSets = [interval.data.blocks];
      if (viewAsPairs && interval.data.drawAsMates && interval.data.mate) { 
        blockSets.push(interval.data.mate.blocks);
      }
      _.each(blockSets, function(blocks) {
        _.each(blocks, function(block) {
          var line = lineNum(interval.data),
            nt, i, x;
          for (i = Math.max(block.start, start); i < Math.min(block.end, start + width * bppp); i++) {
            x = (i - start) / bppp;
            nt = (block.seq[i - block.start] || '').toUpperCase();
            if (nt && nt != sequence[i - start] && line) { mismatches.push({x: x, nt: nt, line: line}); }
          }
        });
      });
    });
    return mismatches;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      sequence = precalc.sequence,
      data = self.data,
      viewAsPairs = self.opts.viewAsPairs,
      startKey = viewAsPairs ? 'templateStart' : 'start',
      endKey = viewAsPairs ? 'templateEnd' : 'end',
      bppp = (end - start) / width;
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density + '_' + (viewAsPairs ? 'p' : 'u');
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch an insane amount of rows 
    // (>500 alignments), as this will only hold up other requests.
    if (self.opts.maxFetchWindow && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      // Fetch from the RemoteTrack and call the above when the data is available.
      self.data.remote.fetchAsync(start, end, viewAsPairs, function(intervals) {
        var drawSpec = {sequence: !!sequence, width: width},
          calcPixIntervalMated = new utils.pixIntervalCalculator(start, width, bppp, 4, false, startKey, endKey),
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, 4);
        
        if (intervals.tooMany) { return callback(intervals); }

        if (!sequence) {
          // First drawing pass, with features that don't depend on sequence.
          self.type('bam').pileup.call(self, intervals, start, end);
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixIntervalMated, lineNum);
          _.each(drawSpec.layout, function(lines) {
            _.each(lines, function(interval) {
              interval.insertionPts = _.map(interval.d.insertions, calcPixInterval);
              if (!viewAsPairs) { return; }
              if (interval.d.drawAsMates && interval.d.mate) {
                interval.mateInts = _.map([interval.d, interval.d.mate], calcPixInterval);
                interval.mateBlockInts = _.map(interval.d.mate.blocks, calcPixInterval);
                interval.mateInsertionPts = _.map(interval.d.mate.insertionPts, calcPixInterval);
              } else if (interval.d.mateExpected) {
                interval.mateInts = [calcPixInterval(interval)];
                interval.mateBlockInts = [];
                interval.mateInsertionPts = [];
              }
            });
          });
          drawSpec.coverage = self.type('bam').coverage.call(self, start, width, bppp);
        } else {
          // Second drawing pass, to draw things that are dependent on sequence, like mismatches (potential SNPs).
          drawSpec.bppp = bppp;  
          // Find allele splits within the coverage graph.
          drawSpec.alleles = self.type('bam').alleles.call(self, start, sequence, bppp);
          // Find mismatches within each aligned block.
          drawSpec.mismatches = self.type('bam').mismatches.call(self, start, sequence, bppp, intervals, width, lineNum);
        }
        
        callback(drawSpec);
      });
    }
  },
  
  // special formatter for content in tooltips for features
  tipTipData: function(data) {
    var o = this.opts,
      content = {},
      firstMate = data.d,
      secondMate = data.d.mate,
      mateHeaders = ["this alignment", "mate pair alignment"],
      leftMate, rightMate, pairOrientation;
    function yesNo(bool) { return bool ? "yes" : "no"; }
    function addAlignedSegmentInfo(content, seg, prefix) {
      var cigarAbbrev = seg.cigar && seg.cigar.length > 25 ? seg.cigar.substr(0, 24) + '...' : seg.cigar;
      prefix = prefix || "";
      
      _.each({
        "position": seg.rname + ':' + seg.pos,
        "cigar": cigarAbbrev,
        "read strand": seg.flags.readStrandReverse ? '(-)' : '(+)',
        "mapped": yesNo(!seg.flags.isReadUnmapped),
        "map quality": seg.mapq,
        "secondary": yesNo(seg.flags.isSecondaryAlignment),
        "supplementary": yesNo(seg.flags.isSupplementaryAlignment),
        "duplicate": yesNo(seg.flags.isDuplicateRead),
        "failed QC": yesNo(seg.flags.isReadFailingVendorQC)
      }, function(v, k) { content[prefix + k] = v; });
    }
    
    if (data.d.mate && data.d.mate.flags) {
      leftMate = data.d.start < data.d.mate.start ? data.d : data.d.mate;
      rightMate = data.d.start < data.d.mate.start ? data.d.mate : data.d;
      pairOrientation = (leftMate.flags.readStrandReverse ? "R" : "F") + (leftMate.flags.isReadFirstOfPair ? "1" : "2");
      pairOrientation += (rightMate.flags.readStrandReverse ? "R" : "F") + (rightMate.flags.isReadLastOfPair ? "2" : "1");
    }
    
    if (o.viewAsPairs && data.d.drawAsMates && data.d.mate) {
      firstMate = leftMate;
      secondMate = rightMate;
      mateHeaders = ["left alignment", "right alignment"];
    }
    if (secondMate) {
      if (!_.isUndefined(data.d.insertSize)) { content["insert size"] = data.d.insertSize; }
      if (!_.isUndefined(pairOrientation)) { content["pair orientation"] = pairOrientation; }
      content[mateHeaders[0]] = "---";
      addAlignedSegmentInfo(content, firstMate);
      content[mateHeaders[1]] = "---";
      addAlignedSegmentInfo(content, secondMate, " ");
    } else {
      addAlignedSegmentInfo(content, data.d);
    }
    
    return content;
  },
  
  // See https://www.broadinstitute.org/igv/AlignmentData#coverage for an idea of what we're imitating
  drawCoverage: function(ctx, coverage, height) {
    _.each(coverage, function(d, x) {
      if (d === null) { return; }
      ctx.fillRect(x, Math.max(height - (d * height), 0), 1, Math.min(d * height, height));
    });
  },
  
  drawStrandIndicator: function(ctx, x, blockY, blockHeight, xScale, bigStyle) {
    var prevFillStyle = ctx.fillStyle;
    if (bigStyle) {
      ctx.beginPath();
      ctx.moveTo(x - (2 * xScale), blockY);
      ctx.lineTo(x + (3 * xScale), blockY + blockHeight/2);
      ctx.lineTo(x - (2 * xScale), blockY + blockHeight);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgb(140,140,140)';
      ctx.fillRect(x + (xScale > 0 ? -2 : 1), blockY, 1, blockHeight);
      ctx.fillRect(x + (xScale > 0 ? -1 : 0), blockY + 1, 1, blockHeight - 2);
      ctx.fillStyle = prevFillStyle;
    }
  },
  
  drawAlignment: function(ctx, width, data, i, lineHeight) {
    var self = this,
      drawMates = data.mateInts,
      color = self.opts.color,
      lineGap = lineHeight > 6 ? 2 : 0,
      blockY = i * lineHeight + lineGap/2,
      blockHeight = lineHeight - lineGap,
      deletionLineWidth = 2,
      insertionCaretLineWidth = lineHeight > 6 ? 2 : 1,
      halfHeight = Math.round(0.5 * lineHeight) - deletionLineWidth * 0.5,
      blockSets = [{blockInts: data.blockInts, strand: data.d.strand}];
    
    // For mate pairs, the full pixel interval represents the line linking the mates
    if (drawMates) {
      ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
      ctx.fillRect(data.pInt.x, i * lineHeight + halfHeight, data.pInt.w, deletionLineWidth);
    }
    
    // Draw the lines that show the full alignment for each segment, including deletions
    ctx.fillStyle = ctx.strokeStyle = 'rgb(0,0,0)';
    _.each(drawMates || [data.pInt], function(pInt) {
      if (pInt.w <= 0) { return; }
      // Note that the "- 1" below fixes rounding issues but gambles on there never being a deletion at the right edge
      ctx.fillRect(pInt.x, i * lineHeight + halfHeight, pInt.w - 1, deletionLineWidth);
    });
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
    ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
    
    // Draw the [mis]match (M/X/=) blocks
    if (drawMates && data.d.mate) { blockSets.push({blockInts: data.mateBlockInts, strand: data.d.mate.strand}); }
    _.each(blockSets, function(blockSet) {
      var strand = blockSet.strand;
      _.each(blockSet.blockInts, function(bInt, blockNum) {
      
        // Skip drawing blocks that aren't inside the canvas
        if (bInt.x + bInt.w < 0 || bInt.x > width) { return; }
      
        if (blockNum == 0 && blockSet.strand == '-' && !bInt.oPrev) {
          ctx.fillRect(bInt.x + 2, blockY, bInt.w - 2, blockHeight);
          self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x, blockY, blockHeight, -1, lineHeight > 6);
        } else if (blockNum == blockSet.blockInts.length - 1 && blockSet.strand == '+' && !bInt.oNext) {
          ctx.fillRect(bInt.x, blockY, bInt.w - 2, blockHeight);
          self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x + bInt.w, blockY, blockHeight, 1, lineHeight > 6);
        } else {
          ctx.fillRect(bInt.x, blockY, bInt.w, blockHeight);
        }
      });
    });
    
    // Draw insertions
    ctx.fillStyle = ctx.strokeStyle = "rgb(114,41,218)";
    _.each(drawMates ? [data.insertionPts, data.mateInsertionPts] : [data.insertionPts], function(insertionPts) {
      _.each(insertionPts, function(insert) {
        if (insert.x + insert.w < 0 || insert.x > width) { return; }
        ctx.fillRect(insert.x - 1, i * lineHeight, 2, lineHeight);
        ctx.fillRect(insert.x - 2, i * lineHeight, 4, insertionCaretLineWidth);
        ctx.fillRect(insert.x - 2, (i + 1) * lineHeight - insertionCaretLineWidth, 4, insertionCaretLineWidth);
      });
    });
  },
  
  drawAlleles: function(ctx, alleles, height, barWidth) {
    // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
    var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
      yPos;
    _.each(alleles, function(allelesForPosition) {
      yPos = height;
      _.each(allelesForPosition.splits, function(split) {
        ctx.fillStyle = 'rgb('+colors[split.nt]+')';
        ctx.fillRect(allelesForPosition.x, yPos -= (split.h * height), Math.max(barWidth, 1), split.h * height);
      });
    });
  },
  
  drawMismatch: function(ctx, mismatch, lineOffset, lineHeight, ppbp) {
    // ppbp == pixels per base pair (inverse of bppp)
    // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
    var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
      lineGap = lineHeight > 6 ? 2 : 0,
      yPos;
    ctx.fillStyle = 'rgb('+colors[mismatch.nt]+')';
    ctx.fillRect(mismatch.x, (mismatch.line + lineOffset) * lineHeight + lineGap / 2, Math.max(ppbp, 1), lineHeight - lineGap);
    // Do we have room to print a whole letter?
    if (ppbp > 7 && lineHeight > 10) {
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillText(mismatch.nt, mismatch.x + ppbp * 0.5, (mismatch.line + lineOffset + 1) * lineHeight - lineGap);
    }
  },
  
  drawSpec: function(canvas, drawSpec, density) {
    var self = this,
      ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = 'javascript:void("'+self.opts.name+':$$")',
      drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
      lineHeight = density == 'pack' ? 14 : 4,
      covHeight = density == 'dense' ? 24 : 38,
      covMargin = 7,
      lineOffset = ((covHeight + covMargin) / lineHeight), 
      color = self.opts.color,
      areas = null;
            
    if (!ctx) { throw "Canvas not supported"; }
    
    if (!drawSpec.sequence) {
      // First drawing pass, with features that don't depend on sequence.
      
      // If necessary, indicate there was too much data to load/draw and that the user needs to zoom to see more
      if (drawSpec.tooMany || (drawLimit && drawSpec.layout.length > drawLimit)) { 
        canvas.height = 0;
        canvas.className = canvas.className + ' too-many';
        return;
      }
      
      // Only store areas for the "pack" density.
      // We have to empty this for every render, because areas can change if BAM display options change.
      if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
      // Set the expected height for the canvas (this also erases it).
      canvas.height = covHeight + ((density == 'dense') ? 0 : covMargin + drawSpec.layout.length * lineHeight);
      
      // First draw the coverage graph
      ctx.fillStyle = "rgb(159,159,159)";
      self.type('bam').drawCoverage.call(self, ctx, drawSpec.coverage, covHeight);
                
      // Now, draw alignments below it
      if (density != 'dense') {
        // Border between coverage
        ctx.fillStyle = "rgb(109,109,109)";
        ctx.fillRect(0, covHeight + 1, drawSpec.width, 1); 
        ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
        
        _.each(drawSpec.layout, function(l, i) {
          i += lineOffset; // hackish method for leaving space at the top for the coverage graph
          _.each(l, function(data) {
            self.type('bam').drawAlignment.call(self, ctx, drawSpec.width, data, i, lineHeight, drawSpec.viewAsPairs);
            self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
          });
        });
      }
    } else {
      // Second drawing pass, to draw things that are dependent on sequence:
      // (1) allele splits over coverage
      self.type('bam').drawAlleles.call(self, ctx, drawSpec.alleles, covHeight, 1 / drawSpec.bppp);
      // (2) mismatches over the alignments
      ctx.font = "12px 'Menlo','Bitstream Vera Sans Mono','Consolas','Lucida Console',monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'baseline';
      _.each(drawSpec.mismatches, function(mismatch) {
        self.type('bam').drawMismatch.call(self, ctx, mismatch, lineOffset, lineHeight, 1 / drawSpec.bppp);
      });
    }

  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      var callbackKey = start + '-' + end + '-' + density;
      self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
      
      // Have we been waiting to draw sequence data too? If so, do that now, too.
      if (_.isFunction(self.renderSequenceCallbacks[callbackKey])) {
        self.renderSequenceCallbacks[callbackKey]();
        delete self.renderSequenceCallbacks[callbackKey];
      }
      
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  renderSequence: function(canvas, start, end, density, sequence, callback) {
    var self = this;
    
    // If we weren't able to fetch sequence for some reason, there is no reason to proceed.
    if (!sequence) { return false; }

    function renderSequenceCallback() {
      self.prerender(start, end, density, {width: canvas.width, sequence: sequence}, function(drawSpec) {
        self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
        if (_.isFunction(callback)) { callback(); }
      });
    }
    
    // Check if the canvas was already rendered (by lack of the class 'unrendered').
    // If yes, go ahead and execute renderSequenceCallback(); if not, save it for later.
    if ((' ' + canvas.className + ' ').indexOf(' unrendered ') > -1) {
      self.renderSequenceCallbacks[start + '-' + end + '-' + density] = renderSequenceCallback;
    } else {
      renderSequenceCallback();
    }
  },
  
  loadOpts: function($dialog) {
    var o = this.opts;
    $dialog.find('[name=viewAsPairs]').attr('checked', !!o.viewAsPairs);
    $dialog.find('[name=convertChrScheme]').val(o.convertChrScheme).change();
  },

  saveOpts: function($dialog) {
    var o = this.opts;
    o.viewAsPairs = $dialog.find('[name=viewAsPairs]').is(':checked');
    o.convertChrScheme = $dialog.find('[name=convertChrScheme]').val();
    
    // If o.viewAsPairs was changed, we *need* to blow away the genobrowser's areaIndex 
    // and our locally cached areas, as all the areas will change.
    if (o.viewAsPairs != this.prevOpts.viewAsPairs) {
      this.areas = {};
      delete $dialog.data('genobrowser').genobrowser('areaIndex')[$dialog.data('track').n];
    }
  }
  
};

module.exports = BamFormat;
},{"./utils/PairedIntervalTree.js":19,"./utils/RemoteTrack.js":20,"./utils/utils.js":22}],12:[function(require,module,exports){
// =================================================================
// = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
// =================================================================
//
// bedDetail is a trivial extension of BED that is defined separately,
// although a BED file with >12 columns is assumed to be bedDetail track regardless of type.

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var LineMask = require('./utils/LineMask.js').LineMask;

// Intended to be loaded into CustomTrack.types.bed
var BedFormat = {
  defaults: {
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: null, pack: null}
  },
  
  init: function() {
    this.type().initOpts.call(this);
  },
  
  initOpts: function() {
    var self = this,
      altColors = self.opts.colorByStrand.split(/\s+/),
      validColorByStrand = altColors.length > 1 && _.all(altColors, self.validateColor);
    self.opts.useScore = self.isOn(self.opts.useScore);
    self.opts.itemRgb = self.isOn(self.opts.itemRgb);
    if (!validColorByStrand) { self.opts.colorByStrand = ''; self.opts.altColor = null; }
    else { self.opts.altColor = altColors[1]; }
  },

  parseLine: function(line, lineno) {
    var cols = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'itemRgb',
      'blockCount', 'blockSizes', 'blockStarts', 'id', 'description'],
      feature = {},
      fields = /\t/.test(line) ? line.split("\t") : line.split(/\s+/),
      chrPos, blockSizes;
    
    if (this.opts.detail) {
      cols[fields.length - 2] = 'id';
      cols[fields.length - 1] = 'description';
    }
    _.each(fields, function(v, i) { feature[cols[i]] = v; });
    chrPos = this.browserOpts.chrPos[feature.chrom];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) { 
      this.warn("Invalid chromosome '"+feature.chrom+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.chromStart) + 1;
      feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
      feature.blocks = null;
      // fancier BED features to express coding regions and exons/introns
      if (/^\d+$/.test(feature.thickStart) && /^\d+$/.test(feature.thickEnd)) {
        feature.thickStart = chrPos + parseInt10(feature.thickStart) + 1;
        feature.thickEnd = chrPos + parseInt10(feature.thickEnd) + 1;
        if (/^\d+(,\d*)*$/.test(feature.blockSizes) && /^\d+(,\d*)*$/.test(feature.blockStarts)) {
          feature.blocks = [];
          blockSizes = feature.blockSizes.split(/,/);
          _.each(feature.blockStarts.split(/,/), function(start, i) {
            if (start === '') { return; }
            var block = {start: feature.start + parseInt10(start)};
            block.end = block.start + parseInt10(blockSizes[i]);
            feature.blocks.push(block);
          });
        }
      } else {
        feature.thickStart = feature.thickEnd = null;
      }
    }
    
    return feature;
  },

  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'});
    _.each(lines, function(line, lineno) {
      var feature = self.type().parseLine.call(self, line, lineno);
      if (feature) { data.add(feature); }
    });
    self.data = data;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    return true;
  },
  
  stackedLayout: function(intervals, width, calcPixInterval, lineNum) {
    // A lineNum function can be provided which can set/retrieve the line of already rendered datapoints
    // so as to not break a ranged feature that extends over multiple tiles.
    lineNum = _.isFunction(lineNum) ? lineNum : function() { return; };
    var lines = [],
      maxExistingLine = _.max(_.map(intervals, function(v) { return lineNum(v.data) || 0; })) + 1,
      sortedIntervals = _.sortBy(intervals, function(v) { var ln = lineNum(v.data); return _.isUndefined(ln) ? 1 : -ln; });
    
    while (maxExistingLine-->0) { lines.push(new LineMask(width, 5)); }
    _.each(sortedIntervals, function(v) {
      var d = v.data,
        ln = lineNum(d),
        pInt = calcPixInterval(d),
        thickInt = d.thickStart !== null && calcPixInterval({start: d.thickStart, end: d.thickEnd}),
        blockInts = d.blocks !== null &&  _.map(d.blocks, calcPixInterval),
        i = 0,
        l = lines.length;
      if (!_.isUndefined(ln)) {
        if (lines[ln].conflict(pInt.tx, pInt.tw)) { console.log("Unresolvable LineMask conflict!"); }
        lines[ln].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      } else {
        while (i < l && lines[i].conflict(pInt.tx, pInt.tw)) { ++i; }
        if (i == l) { lines.push(new LineMask(width, 5)); }
        lineNum(d, i);
        lines[i].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      }
    });
    return _.map(lines, function(l) { return _.pluck(l.items, 'data'); });
  },
  
  prerender: function(start, end, density, precalc, callback) {
    var width = precalc.width,
      bppp = (end - start) / width,
      intervals = this.data.search(start, end),
      drawSpec = [],
      calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density=='pack');
    
    function lineNum(d, set) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(set)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = set);
      }
      return d.line && d.line[key]; 
    }
    
    if (density == 'dense') {
      _.each(intervals, function(v) {
        var pInt = calcPixInterval(v.data);
        pInt.v = v.data.score;
        drawSpec.push(pInt);
      });
    } else {
      drawSpec = {layout: this.type('bed').stackedLayout.call(this, intervals, width, calcPixInterval, lineNum)};
      drawSpec.width = width;
    }
    return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
  },
  
  addArea: function(areas, data, i, lineHeight, urlTemplate) {
    var tipTipData = {},
      tipTipDataCallback = this.type().tipTipData;
    if (!areas) { return; }
    if (_.isFunction(tipTipDataCallback)) {
      tipTipData = tipTipDataCallback.call(this, data);
    } else {
      if (!_.isUndefined(data.d.description)) { tipTipData.description = data.d.description; }
      if (!_.isUndefined(data.d.score)) { tipTipData.score = data.d.score; }
      _.extend(tipTipData, {
        position: data.d.chrom + ':' + data.d.chromStart, 
        size: data.d.chromEnd - data.d.chromStart
      });
      // Display the ID column (from bedDetail), unless it contains a tab character, which means it was autogenerated
      if (!_.isUndefined(data.d.id) && !(/\t/).test(data.d.id)) { tipTipData.id = data.d.id; }
    }
    areas.push([
      data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, x2, y1, y2
      data.d.name || data.d.id || '',                                                   // name
      urlTemplate.replace('$$', _.isUndefined(data.d.id) ? data.d.name : data.d.id),    // href
      data.pInt.oPrev,                                                                  // continuation from previous tile?
      null,
      null,
      tipTipData
    ]);
  },
  
  // Scales a score from 0-1000 into an alpha value between 0.2 and 1.0
  calcAlpha: function(value) { return Math.max(value, 166)/1000; },
  
  // Scales a score from 0-1000 into a color scaled between #cccccc and max Color
  calcGradient: function(maxColor, value) {
    var minColor = [230,230,230],
      valueColor = [];
    if (!_.isArray(maxColor)) { maxColor = _.map(maxColor.split(','), parseInt10); }
    _.each(minColor, function(v, i) { valueColor[i] = (v - maxColor[i]) * ((1000 - value) / 1000.0) + maxColor[i]; });
    return _.map(valueColor, parseInt10).join(',');
  },
  
  drawArrows: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, direction) {
    var arrowHeight = Math.min(halfHeight, 3),
      X1, X2;
    startX = Math.max(startX, 0);
    endX = Math.min(endX, canvasWidth);
    if (endX - startX < 5) { return; } // can't draw arrows in that narrow of a space
    if (direction !== '+' && direction !== '-') { return; } // invalid direction
    ctx.beginPath();
    // All the 0.5's here are due to <canvas>'s somewhat silly coordinate system 
    // http://diveintohtml5.info/canvas.html#pixel-madness
    X1 = direction == '+' ? 0.5 : arrowHeight + 0.5;
    X2 = direction == '+' ? arrowHeight + 0.5 : 0.5;
    for (var i = Math.floor(startX) + 2; i < endX - arrowHeight; i += 7) {
      ctx.moveTo(i + X1, lineY + halfHeight - arrowHeight + 0.5);
      ctx.lineTo(i + X2, lineY + halfHeight + 0.5);
      ctx.lineTo(i + X1, lineY + halfHeight + arrowHeight + 0.5);
    }
    ctx.stroke();
  },
  
  drawFeature: function(ctx, width, data, i, lineHeight) {
    var self = this,
      color = self.opts.color,
      y = i * lineHeight,
      halfHeight = Math.round(0.5 * (lineHeight - 1)),
      quarterHeight = Math.ceil(0.25 * (lineHeight - 1)),
      lineGap = lineHeight > 6 ? 2 : 1,
      thickOverlap = null,
      prevBInt = null;
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
    
    if (self.opts.itemRgb && data.d.itemRgb && this.validateColor(data.d.itemRgb)) { color = data.d.itemRgb; }
    
    if (self.opts.useScore) { color = self.type('bed').calcGradient(color, data.d.score); }
    
    if (self.opts.itemRgb || self.opts.altColor || self.opts.useScore) { ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")"; }
    
    if (data.thickInt) {
      // The coding region is drawn as a thicker line within the gene
      if (data.blockInts) {
        // If there are exons and introns, draw the introns with a 1px line
        prevBInt = null;
        ctx.fillRect(data.pInt.x, y + halfHeight, data.pInt.w, 1);
        ctx.strokeStyle = color;
        _.each(data.blockInts, function(bInt) {
          if (bInt.x + bInt.w <= width && bInt.x >= 0) {
            ctx.fillRect(bInt.x, y + halfHeight - quarterHeight + 1, bInt.w, quarterHeight * 2 - 1);
          }
          thickOverlap = utils.pixIntervalOverlap(bInt, data.thickInt);
          if (thickOverlap) {
            ctx.fillRect(thickOverlap.x, y + 1, thickOverlap.w, lineHeight - lineGap);
          }
          // If there are introns, arrows are drawn on the introns, not the exons...
          if (data.d.strand && prevBInt) {
            ctx.strokeStyle = "rgb(" + color + ")";
            self.type('bed').drawArrows(ctx, width, y, halfHeight, prevBInt.x + prevBInt.w, bInt.x, data.d.strand);
          }
          prevBInt = bInt;
        });
        // ...unless there were no introns. Then it is drawn on the coding region.
        if (data.blockInts.length == 1) {
          ctx.strokeStyle = "white";
          self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
        }
      } else {
        // We have a coding region but no introns/exons
        ctx.fillRect(data.pInt.x, y + halfHeight - quarterHeight + 1, data.pInt.w, quarterHeight * 2 - 1);
        ctx.fillRect(data.thickInt.x, y + 1, data.thickInt.w, lineHeight - lineGap);
        ctx.strokeStyle = "white";
        self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
      }
    } else {
      // Nothing fancy.  It's a box.
      ctx.fillRect(data.pInt.x, y + 1, data.pInt.w, lineHeight - lineGap);
      ctx.strokeStyle = "white";
      self.type('bed').drawArrows(ctx, width, y, halfHeight, data.pInt.x, data.pInt.x + data.pInt.w, data.d.strand);
    }
  },
  
  drawSpec: function(canvas, drawSpec, density) {
    var self = this,
      ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = self.opts.url ? self.opts.url : 'javascript:void("'+self.opts.name+':$$")',
      drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
      lineHeight = density == 'pack' ? 15 : 6,
      color = self.opts.color,
      areas = null;
    
    if (!ctx) { throw "Canvas not supported"; }
    // TODO: I disabled regenerating areas here, which assumes that lineNum remains stable across re-renders. Should check on this.
    if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
    
    if (density == 'dense') {
      canvas.height = 15;
      ctx.fillStyle = "rgb("+color+")";
      _.each(drawSpec, function(pInt) {
        if (self.opts.useScore) { ctx.fillStyle = "rgba("+self.type('bed').calcGradient(color, pInt.v)+")"; }
        ctx.fillRect(pInt.x, 1, pInt.w, 13);
      });
    } else {
      if ((drawLimit && drawSpec.layout && drawSpec.layout.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
        return;
      }
      canvas.height = drawSpec.layout.length * lineHeight;
      ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
      _.each(drawSpec.layout, function(l, i) {
        _.each(l, function(data) {
          self.type('bed').drawFeature.call(self, ctx, drawSpec.width, data, i, lineHeight);              
          self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
        });
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      self.type().drawSpec.call(self, canvas, drawSpec, density);
      if (_.isFunction(callback)) { callback(); }
    });
  },

  loadOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = /\d+,\d+,\d+\s+\d+,\d+,\d+/.test(o.colorByStrand),
      colorByStrand = colorByStrandOn ? o.colorByStrand.split(/\s+/)[1] : '0,0,0';
    $dialog.find('[name=colorByStrandOn]').attr('checked', !!colorByStrandOn);
    $dialog.find('[name=colorByStrand]').val(colorByStrand).change();
    $dialog.find('[name=useScore]').attr('checked', this.isOn(o.useScore));    
    $dialog.find('[name=url]').val(o.url);
  },
  
  saveOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = $dialog.find('[name=colorByStrandOn]').is(':checked'),
      colorByStrand = $dialog.find('[name=colorByStrand]').val(),
      validColorByStrand = this.validateColor(colorByStrand);
    o.colorByStrand = colorByStrandOn && validColorByStrand ? o.color + ' ' + colorByStrand : '';
    o.useScore = $dialog.find('[name=useScore]').is(':checked') ? 1 : 0;
    o.url = $dialog.find('[name=url]').val();
    this.type('bed').initOpts.call(this);
  }
};

module.exports = BedFormat;
},{"./utils/IntervalTree.js":17,"./utils/LineMask.js":18,"./utils/utils.js":22}],13:[function(require,module,exports){
// =========================================================================
// = bedGraph format: http://genome.ucsc.edu/goldenPath/help/bedgraph.html =
// =========================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.bedgraph
var BedGraphFormat = {
  defaults: {
    altColor: '',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() { return this.type('wiggle_0').init.call(this); },
  
  _binFunctions: utils.wigBinFunctions,
  
  initOpts: function() { return this.type('wiggle_0').initOpts.call(this); },
  
  applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },
  
  parse: function(lines) {
    var self = this,
      genomeSize = this.browserOpts.genomeSize,
      data = {all: []},
      mode, modeOpts, chrPos, m;
    self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
  
    _.each(lines, function(line, lineno) {
      var cols = ['chrom', 'chromStart', 'chromEnd', 'dataValue'],
        datum = {},
        chrPos, start, end, val;
      _.each(line.split(/\s+/), function(v, i) { datum[cols[i]] = v; });
      chrPos = self.browserOpts.chrPos[datum.chrom];
      if (_.isUndefined(chrPos)) {
        self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
      }
      start = parseInt10(datum.chromStart);
      end = parseInt10(datum.chromEnd);
      val = parseFloat(datum.dataValue);
      data.all.push({start: chrPos + start, end: chrPos + end, val: val});
    });

    return self.type('wiggle_0').finishParse.call(self, data);
  },
  
  initDrawSpec: function() { return this.type('wiggle_0').initDrawSpec.apply(this, arguments); },
  
  drawBars: function() { return this.type('wiggle_0').drawBars.apply(this, arguments); },

  prerender: function(start, end, density, precalc, callback) {
    return this.type('wiggle_0').prerender.call(this, start, end, density, precalc, callback);
  },

  render: function(canvas, start, end, density, callback) {
    this.type('wiggle_0').render.call(this, canvas, start, end, density, callback);
  },
  
  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
  
};

module.exports = BedGraphFormat;
},{"./utils/utils.js":22}],14:[function(require,module,exports){
// =====================================================================
// = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
// =====================================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

// Intended to be loaded into CustomTrack.types.bigbed
var BigBedFormat = {
  defaults: {
    chromosomes: '',
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: 500, pack: 100},
    maxFetchWindow: 0
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigBed track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
  },
  
  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'bigbed.php',
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl, density: 'pack'},
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          var intervals = _.map(lines, function(l) { 
            var itvl = self.type('bed').parseLine.call(self, l); 
            // Use BioPerl's Bio::DB:BigBed strategy for deduplicating re-fetched intervals:
            // "Because BED files don't actually use IDs, the ID is constructed from the feature's name (if any), chromosome coordinates, strand and block count."
            if (_.isUndefined(itvl.id)) {
              itvl.id = [itvl.name, itvl.chrom, itvl.chromStart, itvl.chromEnd, itvl.strand, itvl.blockCount].join("\t");
            }
            return itvl;
          });
          storeIntervals(intervals);
        }
      });
    });
    
    self.data = {cache: cache, remote: remote};
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    
    // Get general info on the bigBed and setup the binning scheme for the RemoteTrack
    $.ajax(ajaxUrl, {
      data: { url: self.opts.bigDataUrl },
      success: function(data) {
        // Set maxFetchWindow to avoid overfetching data.
        if (!self.opts.maxFetchWindow) {
          var meanItemsPerBp = data.itemCount / self.browserOpts.genomeSize,
            maxItemsToDraw = _.max(_.values(self.opts.drawLimit));
          self.opts.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
          self.opts.optimalFetchWindow = Math.floor(self.opts.maxFetchWindow / 3);
        }
        remote.setupBins(self.browserOpts.genomeSize, self.opts.optimalFetchWindow, self.opts.maxFetchWindow);
      }
    });
    
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = this.chrRange(start, end);
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    function parseDenseData(data) {
      var drawSpec = [], 
        lines;
      lines = data.split(/\s+/g);
      _.each(lines, function(line, x) { 
        if (line != 'n/a' && line.length) { drawSpec.push({x: x, w: 1, v: parseFloat(line) * 1000}); } 
      });
      callback(drawSpec);
    }
    
    // Don't even attempt to fetch the data if density is not 'dense' and we can reasonably
    // estimate that we will fetch too many rows (>500 features), as this will only delay other requests.
    if (density != 'dense' && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      if (density == 'dense') {
        $.ajax(self.ajaxDir() + 'bigbed.php', {
          data: {range: range, url: self.opts.bigDataUrl, width: width, density: density},
          success: parseDenseData
        });
      } else {
        self.data.remote.fetchAsync(start, end, function(intervals) {
          var calcPixInterval, drawSpec = {};
          if (intervals.tooMany) { return callback(intervals); }
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density == 'pack');
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
          drawSpec.width = width;
          callback(drawSpec);
        });
      }
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
};

module.exports = BigBedFormat;
},{"./utils/IntervalTree.js":17,"./utils/RemoteTrack.js":20,"./utils/utils.js":22}],15:[function(require,module,exports){


// =====================================================================
// = bigWig format: http://genome.ucsc.edu/goldenPath/help/bigWig.html =
// =====================================================================

var BigWigFormat = {
  defaults: {
    altColor: '128,128,128',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigWig track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type('wiggle_0').initOpts.call(this);
  },
  
  _binFunctions: {'minimum':1, 'maximum':1, 'mean':1, 'min':1, 'max':1, 'std':1, 'coverage':1},
  
  applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },

  parse: function(lines) {
    var self = this;
    self.stretchHeight = true;
    self.range = self.isOn(self.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {info: 1, url: this.opts.bigDataUrl},
      async: false,  // This is cool since parsing normally happens in a Web Worker
      success: function(data) {
        var rows = data.split("\n");
        _.each(rows, function(r) {
          var keyval = r.split(': ');
          if (keyval[0]=='min') { self.range[0] = Math.min(parseFloat(keyval[1]), self.range[0]); }
          if (keyval[0]=='max') { self.range[1] = Math.max(parseFloat(keyval[1]), self.range[1]); }
        });
      }
    });
    self.type('wiggle_0').applyOpts.apply(self);
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      chrRange = self.chrRange(start, end);
  
    function success(data) {
      var drawSpec = self.type('wiggle_0').initDrawSpec.call(self, precalc),
        lines = data.split(/\s+/g);
      _.each(lines, function(line) {
        if (line == 'n/a') { drawSpec.bars.push(null); }
        else if (line.length) { drawSpec.bars.push((parseFloat(line) - self.drawRange[0]) / drawSpec.vScale); }
      });
      callback(drawSpec);
    }
  
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {range: chrRange, url: self.opts.bigDataUrl, width: width, winFunc: self.opts.windowingFunction},
      success: success
    });
  },

  render: function(canvas, start, end, density, callback) {
    var self = this,
      height = canvas.height,
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
      self.type('wiggle_0').drawBars.call(self, ctx, drawSpec, height, width);
      _.isFunction(callback) && callback();
    });
  },

  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },

  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
};

module.exports = BigWigFormat;
},{}],16:[function(require,module,exports){
// ======================================================================
// = featureTable format: http://www.insdc.org/files/feature_table.html =
// ======================================================================

var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var utils = require('./utils/utils.js'),
  strip = utils.strip,
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.featuretable
var FeatureTableFormat = {
  defaults: {
    collapseByGene: 'off',
    keyColumnWidth: 21,
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: null, pack: null}
  },
  
  init: function() {
    this.type('bed').initOpts.call(this);
    this.opts.collapseByGene = this.isOn(this.opts.collapseByGene);
    this.featureTypeCounts = {};
  },
  
  // parses one feature key + location/qualifiers row from the feature table
  parseEntry: function(chrom, lines, startLineNo) {
    var feature = {
        chrom: chrom,
        score: '?',
        blocks: null,
        qualifiers: {}
      },
      keyColumnWidth = this.opts.keyColumnWidth,
      qualifier = null,
      fullLocation = [],
      collapseKeyQualifiers = ['locus_tag', 'gene', 'db_xref'],
      qualifiersThatAreNames = ['gene', 'locus_tag', 'db_xref'],
      RNATypes = ['rrna', 'trna'],
      alsoTryForRNATypes = ['product'],
      locationPositions, chrPos, blockSizes;
    
    chrPos = this.browserOpts.chrPos[chrom];
    startLineNo = startLineNo || 0;
    if (_.isUndefined(chrPos)) {
      this.warn("Invalid chromosome at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    }
    
    // fill out feature's keys with info from these lines
    _.each(lines, function(line, lineno) {
      var key = line.substr(0, keyColumnWidth),
        restOfLine = line.substr(keyColumnWidth),
        qualifierMatch = restOfLine.match(/^\/(\w+)(=?)(.*)/);
      if (key.match(/\w/)) {
        feature.type = strip(key);
        qualifier = null;
        fullLocation.push(restOfLine);
      } else {
        if (qualifierMatch) {
          qualifier = qualifierMatch[1];
          if (!feature.qualifiers[qualifier]) { feature.qualifiers[qualifier] = []; }
          feature.qualifiers[qualifier].push([qualifierMatch[2] ? qualifierMatch[3] : true]);
        } else {
          if (qualifier !== null) { 
            _.last(feature.qualifiers[qualifier]).push(restOfLine);
          } else {
            fullLocation.push(restOfLine);
          }
        }
      }
    });
    
    feature.fullLocation = fullLocation = fullLocation.join('');
    locationPositions = _.map(_.filter(fullLocation.split(/\D+/), _.identity), parseInt10);
    feature.chromStart =  _.min(locationPositions);
    feature.chromEnd = _.max(locationPositions) + 1; // Feature table ranges are *inclusive* of the end base
                                                     // chromEnd columns in BED format are *not*.
    feature.start = chrPos + feature.chromStart;
    feature.end = chrPos + feature.chromEnd; 
    feature.strand = /complement/.test(fullLocation) ? "-" : "+";
    
    // Until we merge by gene name, we don't care about these
    feature.thickStart = feature.thickEnd = null;
    feature.blocks = null;
    
    // Parse the qualifiers properly
    _.each(feature.qualifiers, function(v, k) {
      _.each(v, function(entryLines, i) {
        v[i] = strip(entryLines.join(' '));
        if (/^"[\s\S]*"$/.test(v[i])) {
          // Dequote free text
          v[i] = v[i].replace(/^"|"$/g, '').replace(/""/g, '"');
        }
      });
      //if (v.length == 1) { feature.qualifiers[k] = v[0]; }
    });
    
    // Find something that can serve as a name
    feature.name = feature.type;
    if (_.contains(RNATypes, feature.type.toLowerCase())) { 
      Array.prototype.push.apply(qualifiersThatAreNames, alsoTryForRNATypes); 
    }
    _.find(qualifiersThatAreNames, function(k) {
      if (feature.qualifiers[k] && feature.qualifiers[k][0]) { return (feature.name = feature.qualifiers[k][0]); }
    });
    // In the worst case, add a counter to disambiguate features named only by type
    if (feature.name == feature.type) {
      if (!this.featureTypeCounts[feature.type]) { this.featureTypeCounts[feature.type] = 1; }
      feature.name = feature.name + '_' + this.featureTypeCounts[feature.type]++;
    }
    
    // Find a key that is appropriate for collapsing
    if (this.opts.collapseByGene) {
      _.find(collapseKeyQualifiers, function(k) {
        if (feature.qualifiers[k] && feature.qualifiers[k][0]) { 
          return (feature._collapseKey = feature.qualifiers[k][0]);
        }
      });
    }
    
    return feature;
  },
  
  // collapses multiple features that are about the same gene into one drawable feature
  collapseFeatures: function(features) {
    var chrPos = this.browserOpts.chrPos,
      preferredTypeToMergeInto = ['mrna', 'gene', 'cds'],
      preferredTypeForExons = ['exon', 'cds'],
      mergeInto = features[0],
      blocks = [],
      foundType, cds, exons;
    foundType = _.find(preferredTypeToMergeInto, function(type) {
      var found = _.find(features, function(feat) { return feat.type.toLowerCase() == type; });
      if (found) { mergeInto = found; return true; }
    });
    
    // Look for exons (eukaryotic) or a CDS (prokaryotic)
    _.find(preferredTypeForExons, function(type) {
      exons = _.select(features, function(feat) { return feat.type.toLowerCase() == type; });
      if (exons.length) { return true; }
    });
    cds = _.find(features, function(feat) { return feat.type.toLowerCase() == "cds"; });
    
    _.each(exons, function(exonFeature) {
      exonFeature.fullLocation.replace(/(\d+)\.\.[><]?(\d+)/g, function(fullMatch, start, end) {
        blocks.push({
          start: chrPos[exonFeature.chrom] + Math.min(start, end), 
          // Feature table ranges are *inclusive* of the end base.
          end: chrPos[exonFeature.chrom] +  Math.max(start, end) + 1
        });
      });
    });
    
    // Convert exons and CDS into blocks, thickStart and thickEnd (in BED terminology)
    if (blocks.length) { 
      mergeInto.blocks = _.sortBy(blocks, function(b) { return b.start; });
      mergeInto.thickStart = cds ? cds.start : feature.start;
      mergeInto.thickEnd = cds ? cds.end : feature.end;
    }
    
    // finally, merge all the qualifiers
    _.each(features, function(feat) {
      if (feat === mergeInto) { return; }
      _.each(feat.qualifiers, function(values, k) {
        if (!mergeInto.qualifiers[k]) { mergeInto.qualifiers[k] = []; }
        _.each(values, function(v) {
          if (!_.contains(mergeInto.qualifiers[k], v)) { mergeInto.qualifiers[k].push(v); }
        });
      });
    });
    
    return mergeInto;
  },

  parse: function(lines) {
    var self = this,
      o = self.opts,
      middleishPos = this.browserOpts.genomeSize / 2,
      data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      numLines = lines.length,
      chrom = null,
      lastEntryStart = null,
      featuresByCollapseKey = {},
      feature;
    
    function collectLastEntry(lineno) {
      if (lastEntryStart !== null) {
        feature = self.type().parseEntry.call(self, chrom, lines.slice(lastEntryStart, lineno), lastEntryStart);
        if (feature) { 
          if (o.collapseByGene) {
            featuresByCollapseKey[feature._collapseKey] = featuresByCollapseKey[feature._collapseKey] || [];
            featuresByCollapseKey[feature._collapseKey].push(feature);
          } else { data.add(feature); }
        }
      }
    }
    
    // Chunk the lines into entries and parse each of them
    _.each(lines, function(line, lineno) {
      if (line.substr(0, 12) == "ACCESSION   ") {
        collectLastEntry(lineno);
        chrom = line.substr(12);
        lastEntryStart = null;
      } else if (chrom !== null && line.substr(5, 1).match(/\w/)) {
        collectLastEntry(lineno);
        lastEntryStart = lineno;
      }
    });
    // parse the last entry
    if (chrom !== null) { collectLastEntry(lines.length); }
    
    if (o.collapseByGene) {
      _.each(featuresByCollapseKey, function(features, gene) {
        data.add(self.type().collapseFeatures.call(self, features));
      });
    }
    
    self.data = data;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    return true;
  },
  
  // special formatter for content in tooltips for features
  tipTipData: function(data) {
    var qualifiersToAbbreviate = {translation: 1},
      content = {
        type: data.d.type,
        position: data.d.chrom + ':' + data.d.chromStart, 
        size: data.d.chromEnd - data.d.chromStart
      };
    if (data.d.qualifiers.note && data.d.qualifiers.note[0]) {  }
    _.each(data.d.qualifiers, function(v, k) {
      if (k == 'note') { content.description = v.join('; '); return; }
      content[k] = v.join('; ');
      if (qualifiersToAbbreviate[k] && content[k].length > 25) { content[k] = content[k].substr(0, 25) + '...'; }
    });
    return content;
  },
  
  prerender: function(start, end, density, precalc, callback) {
    return this.type('bed').prerender.call(this, start, end, density, precalc, callback);
  },
  
  drawSpec: function() { return this.type('bed').drawSpec.apply(this, arguments); },
  
  render: function(canvas, start, end, density, callback) {
    this.type('bed').render.call(this, canvas, start, end, density, callback);
  },
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
};

module.exports = FeatureTableFormat;
},{"./utils/IntervalTree.js":17,"./utils/utils.js":22}],17:[function(require,module,exports){
(function(exports){
  
var SortedList = require('./SortedList.js').SortedList;  

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * By Shin Suzuki, MIT license
 * https://github.com/shinout/interval-tree
 * IntervalTree
 *
 * @param (object) data:
 * @param (number) center:
 * @param (object) options:
 *   center:
 *
 **/
function IntervalTree(center, options) {
  options || (options = {});

  this.startKey     = options.startKey || 0; // start key
  this.endKey       = options.endKey   || 1; // end key
  this.intervalHash = {};                    // id => interval object
  this.pointTree = new SortedList({          // b-tree of start, end points 
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a[0]- b[0];
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this._autoIncrement = 0;

  // index of the root node
  if (!center || typeof center != 'number') {
    throw new Error('you must specify center index as the 2nd argument.');
  }

  this.root = new Node(center, this);
}


/**
 * public methods
 **/


/**
 * add new range
 **/
IntervalTree.prototype.add = function(data, id) {
  if (this.contains(id)) {
    throw new DuplicateError('id ' + id + ' is already registered.');
  }

  if (id == undefined) {
    while (this.intervalHash[this._autoIncrement]) {
      this._autoIncrement++;
    }
    id = this._autoIncrement;
  }

  var itvl = new Interval(data, id, this.startKey, this.endKey);
  this.pointTree.insert([itvl.start, id]);
  this.pointTree.insert([itvl.end,   id]);
  this.intervalHash[id] = itvl;
  this._autoIncrement++;
  
  _insert.call(this, this.root, itvl);
};


/**
 * check if range is already present, based on its id
 **/
IntervalTree.prototype.contains = function(id) {
  return !!this.get(id);
}


/**
 * retrieve an interval by its id; returns null if it does not exist
 **/
IntervalTree.prototype.get = function(id) {
  return this.intervalHash[id] || null;
}


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
IntervalTree.prototype.addIfNew = function(data, id) {
  try {
    this.add(data, id);
  } catch (e) {
    if (e instanceof DuplicateError) { return; }
    throw e;
  }
}


/**
 * search
 *
 * @param (integer) val:
 * @return (array)
 **/
IntervalTree.prototype.search = function(val1, val2) {
  var ret = [];
  if (typeof val1 != 'number') {
    throw new Error(val1 + ': invalid input');
  }

  if (val2 == undefined) {
    _pointSearch.call(this, this.root, val1, ret);
  }
  else if (typeof val2 == 'number') {
    _rangeSearch.call(this, val1, val2, ret);
  }
  else {
    throw new Error(val1 + ',' + val2 + ': invalid input');
  }
  return ret;
};


/**
 * remove: 
 **/
IntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};



/**
 * private methods
 **/

// the shift-right-and-fill operator, extended beyond the range of an int32
function _bitShiftRight(num) {
  if (num > 2147483647 || num < -2147483648) { return Math.floor(num / 2); }
  return num >>> 1;
}

/**
 * _insert
 **/
function _insert(node, itvl) {
  while (true) {
    if (itvl.end < node.idx) {
      if (!node.left) {
        node.left = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.left;
    } else if (node.idx < itvl.start) {
      if (!node.right) {
        node.right = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.right;
    } else {
      return node.insert(itvl);
    }
  }
}


/**
 * _pointSearch
 * @param (Node) node
 * @param (integer) idx 
 * @param (Array) arr
 **/
function _pointSearch(node, idx, arr) {
  while (true) {
    if (!node) break;
    if (idx < node.idx) {
      node.starts.arr.every(function(itvl) {
        var bool = (itvl.start <= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.left;
    } else if (idx > node.idx) {
      node.ends.arr.every(function(itvl) {
        var bool = (itvl.end >= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.right;
    } else {
      node.starts.arr.map(function(itvl) { arr.push(itvl.result()) });
      break;
    }
  }
}



/**
 * _rangeSearch
 * @param (integer) start
 * @param (integer) end
 * @param (Array) arr
 **/
function _rangeSearch(start, end, arr) {
  if (end - start <= 0) {
    throw new Error('end must be greater than start. start: ' + start + ', end: ' + end);
  }
  var resultHash = {};

  var wholeWraps = [];
  _pointSearch.call(this, this.root, _bitShiftRight(start + end), wholeWraps, true);

  wholeWraps.forEach(function(result) {
    resultHash[result.id] = true;
  });


  var idx1 = this.pointTree.bsearch([start, null]);
  while (idx1 >= 0 && this.pointTree.arr[idx1][0] == start) {
    idx1--;
  }

  var idx2 = this.pointTree.bsearch([end,   null]);
  var len = this.pointTree.arr.length - 1;
  while (idx2 == -1 || (idx2 <= len && this.pointTree.arr[idx2][0] <= end)) {
    idx2++;
  }

  this.pointTree.arr.slice(idx1 + 1, idx2).forEach(function(point) {
    var id = point[1];
    resultHash[id] = true;
  }, this);

  Object.keys(resultHash).forEach(function(id) {
    var itvl = this.intervalHash[id];
    arr.push(itvl.result(start, end));
  }, this);

}



/**
 * subclasses
 * 
 **/


/**
 * Node : prototype of each node in a interval tree
 * 
 **/
function Node(idx) {
  this.idx = idx;
  this.starts = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.start - b.start;
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this.ends = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.end - b.end;
      return (c < 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });
};

/**
 * insert an Interval object to this node
 **/
Node.prototype.insert = function(interval) {
  this.starts.insert(interval);
  this.ends.insert(interval);
};



/**
 * Interval : prototype of interval info
 **/
function Interval(data, id, s, e) {
  this.id     = id;
  this.start  = data[s];
  this.end    = data[e];
  this.data   = data;

  if (typeof this.start != 'number' || typeof this.end != 'number') {
    throw new Error('start, end must be number. start: ' + this.start + ', end: ' + this.end);
  }

  if ( this.start >= this.end) {
    throw new Error('start must be smaller than end. start: ' + this.start + ', end: ' + this.end);
  }
}

/**
 * get result object
 **/
Interval.prototype.result = function(start, end) {
  var ret = {
    id   : this.id,
    data : this.data
  };
  if (typeof start == 'number' && typeof end == 'number') {
    /**
     * calc overlapping rate
     **/
    var left  = Math.max(this.start, start);
    var right = Math.min(this.end,   end);
    var lapLn = right - left;
    ret.rate1 = lapLn / (end - start);
    ret.rate2 = lapLn / (this.end - this.start);
  }
  return ret;
};

function DuplicateError(message) {
    this.name = 'DuplicateError';
    this.message = message;
    this.stack = (new Error()).stack;
}
DuplicateError.prototype = new Error;

exports.IntervalTree = IntervalTree;

})(module && module.exports || this);
},{"./SortedList.js":21}],18:[function(require,module,exports){
(function (global){
(function(exports){

// ==============================================================================================
// = LineMask: A (very cheap) alternative to IntervalTree: a small, 1D pixel buffer of objects. =
// ==============================================================================================
  
var utils = require('./utils.js'),
  floorHack = utils.floorHack;

function LineMask(width, fudge) {
  this.fudge = fudge = (fudge || 1);
  this.items = [];
  this.length = Math.ceil(width / fudge);
  this.mask = global.Uint8Array ? new Uint8Array(this.length) : new Array(this.length);
}

LineMask.prototype.add = function(x, w, data) {
  var upTo = Math.ceil((x + w) / this.fudge);
  this.items.push({x: x, w: w, data: data});
  for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { this.mask[i] = 1; }
};

LineMask.prototype.conflict = function(x, w) {
  var upTo = Math.ceil((x + w) / this.fudge);
  for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { if (this.mask[i]) return true; }
  return false;
};

exports.LineMask = LineMask;

})(module && module.exports || this);
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils.js":22}],19:[function(require,module,exports){
(function(exports){
  
var IntervalTree = require('./IntervalTree.js').IntervalTree;  
var _ = require('../../../underscore.min.js');
var parseInt10 = require('./utils.js').parseInt10;

var PAIRING_CANNOT_MATE = 0,
  PAIRING_MATE_ONLY = 1,
  PAIRING_DRAW_AS_MATES = 2;

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * Wraps two of Shin Suzuki's IntervalTrees to store intervals that *may*
 * be paired.
 *
 * @see IntervalTree()
 **/
function PairedIntervalTree(center, unpairedOptions, pairedOptions) {
  var defaultOptions = {startKey: 0, endKey: 1};
  
  this.unpaired = new IntervalTree(center, unpairedOptions);
  this.unpairedOptions = _.extend({}, defaultOptions, unpairedOptions);
  
  this.paired = new IntervalTree(center, pairedOptions);
  this.pairedOptions = _.extend({pairingKey: 'qname', pairedLengthKey: 'tlen'}, defaultOptions, pairedOptions);
  if (this.pairedOptions.startKey === this.unpairedOptions.startKey) {
    throw new Error('startKey for unpairedOptions and pairedOptions must be different in a PairedIntervalTree');
  }
  if (this.pairedOptions.endKey === this.unpairedOptions.endKey) {
    throw new Error('endKey for unpairedOptions and pairedOptions must be different in a PairedIntervalTree');
  }
  
  this.pairingDisabled = false;
  this.pairingMinDistance = this.pairingMaxDistance = null;
}


/**
 * public methods
 **/


/**
 * Disables pairing. Effectively makes this equivalent, externally, to an IntervalTree.
 * This is useful if we discover that this data source doesn't contain paired reads.
 **/
PairedIntervalTree.prototype.disablePairing = function() {
  this.pairingDisabled = true;
  this.paired = this.unpaired;
};


/**
 * Set an interval within which paired mates will be saved as a continuous feature in .paired
 *
 * @param (number) min: Minimum distance, in bp
 * @param (number) max: Maximum distance, in bp
 **/
PairedIntervalTree.prototype.setPairingInterval = function(min, max) {
  if (typeof min != 'number') { throw new Error('you must specify min as the 1st argument.'); }
  if (typeof max != 'number') { throw new Error('you must specify max as the 2nd argument.'); }
  if (this.pairingMinDistance !== null) { throw new Error('Can only be called once. You can\'t change the pairing interval.'); }
  
  this.pairingMinDistance = min;
  this.pairingMaxDistance = max;
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
PairedIntervalTree.prototype.addIfNew = function(data, id) {
  var mated = false,
    increment = 0,
    unpairedStart = this.unpairedOptions.startKey,
    unpairedEnd = this.unpairedOptions.endKey,
    pairedStart = this.pairedOptions.startKey,
    pairedEnd = this.pairedOptions.endKey,
    pairedLength = data[this.pairedOptions.pairedLengthKey],
    pairingState = PAIRING_CANNOT_MATE,
    newId, potentialMate;
  
  // .unpaired contains every alignment as a separate interval.
  // If it already contains this id, we've seen this read before and should disregard.
  if (this.unpaired.contains(id)) { return; }
  this.unpaired.add(data, id);
  
  // .paired contains alignments that may be mated into one interval if they are within the pairing range
  if (!this.pairingDisabled && _eligibleForPairing(this, data)) {
    if (this.pairingMinDistance === null) { 
      throw new Error('Can only add paired data after the pairing interval has been set!');
    }
    
    // instead of storing them with the given id, the pairingKey (for BAM, QNAME) is used as the id.
    // As intervals are added, we check if a read with the same pairingKey already exists in the .paired IntervalTree.
    newId = data[this.pairedOptions.pairingKey];
    potentialMate = this.paired.get(newId);
    
    if (potentialMate !== null) {
      potentialMate = potentialMate.data;
      pairingState = _pairingState(this, data, potentialMate);
      // Are the reads suitable for mating?
      if (pairingState === PAIRING_DRAW_AS_MATES || pairingState === PAIRING_MATE_ONLY) {
        // If yes: mate the reads
        potentialMate.mate = data;
        // In the other direction, has to be a selective shallow copy to avoid circular references.
        data.mate = _.extend({}, _.omit(potentialMate, function(v, k) { return _.isObject(v)}));
        data.mate.flags = _.clone(potentialMate.flags);
      }
    }
    
    // Are the mated reads within drawable range? If so, simply flag that they should be drawn together, and they will.
    // Alternatively, if the potentialMate expected a mate, we should mate them anyway.
    // The only reason we wouldn't get .drawAsMates is if the mate was on the threshold of the insert size range.
    if (pairingState === PAIRING_DRAW_AS_MATES || (pairingState === PAIRING_MATE_ONLY && potentialMate.mateExpected)) {
      data.drawAsMates = potentialMate.drawAsMates = true;
    } else {
      // Otherwise, need to insert this read into this.paired as a separate read.
      // Ensure the id is unique first.
      while (this.paired.contains(newId)) {
        newId = newId.replace(/\t.*/, '') + "\t" + (++increment);
      }
      
      data.mateExpected = _pairingState(this, data) === PAIRING_DRAW_AS_MATES;
      // FIXME: The following is perhaps a bit too specific to how TLEN for BAM files works; could generalize later
      // When inserting into .paired, the interval's .start and .end shouldn't be based on POS and the CIGAR string;
      // we must adjust them for TLEN, if it is nonzero, depending on its sign, and set new bounds for the interval.
      if (data.mateExpected && pairedLength > 0) {
        data[pairedStart] = data[unpairedStart];
        data[pairedEnd] = data[unpairedStart] + pairedLength;
      } else if (data.mateExpected && pairedLength < 0) {
        data[pairedEnd] = data[unpairedEnd];
        data[pairedStart] = data[unpairedEnd] + pairedLength;
      } else { // !data.mateExpected || pairedLength == 0
        data[pairedStart] = data[unpairedStart];
        data[pairedEnd] = data[unpairedEnd];
      }
      
      this.paired.add(data, newId);
    }
  }

};


/**
 * alias .add() to .addIfNew()
 **/
PairedIntervalTree.prototype.add = PairedIntervalTree.prototype.addIfNew;


/**
 * search
 *
 * @param (number) val:
 * @return (array)
 **/
PairedIntervalTree.prototype.search = function(val1, val2, paired) {
  if (paired && !this.pairingDisabled) {
    return this.paired.search(val1, val2);
  } else {
    return this.unpaired.search(val1, val2);
  }
};


/**
 * remove: unimplemented for now
 **/
PairedIntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};


/**
 * private methods
 **/

// Check if an itvl is eligible for pairing. 
// For now, this means that if any FLAG's 0x100 or higher are set, we totally discard this alignment and interval.
// FIXME: The following is entangled with bam.js internals; perhaps allow this to be generalized, overridden,
//        or set alongside .setPairingInterval()
//
// @return (boolean)
function _eligibleForPairing(pairedItvlTree, itvl) {
  var flags = itvl.flags;
  if (flags.isSecondaryAlignment || flags.isReadFailingVendorQC || flags.isDuplicateRead || flags.isSupplementaryAlignment) {
    return false;
  }
  return true;
}

// Check if an itvl and its potentialMate are within the right distance, and orientation, to be mated.
// If potentialMate isn't given, takes a best guess if a mate is expected, given the information in itvl alone.
// FIXME: The following is entangled with bam.js internals; perhaps allow this to be generalized, overridden,
//        or set alongside .setPairingInterval()
// 
// @return (number)
function _pairingState(pairedItvlTree, itvl, potentialMate) {
  var tlen = itvl[pairedItvlTree.pairedOptions.pairedLengthKey],
    itvlLength = itvl.end - itvl.start,
    itvlIsLater, inferredInsertSize;

  if (_.isUndefined(potentialMate)) {
    // Create the most receptive hypothetical mate, given the information in itvl.
    potentialMate = {
      _mocked: true,
      flags: {
        isReadPaired: true,
        isReadProperlyAligned: true,
        isReadFirstOfPair: itvl.flags.isReadLastOfPair,
        isReadLastOfPair: itvl.flags.isReadFirstOfPair
      }
    };
  }

  // First check a whole host of FLAG's. To make a long story short, we expect paired ends to be either
  // 99-147 or 163-83, depending on whether the rightmost or leftmost segment is primary.
  if (!itvl.flags.isReadPaired || !potentialMate.flags.isReadPaired) { return PAIRING_CANNOT_MATE; }
  if (!itvl.flags.isReadProperlyAligned || !potentialMate.flags.isReadProperlyAligned) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadUnmapped || potentialMate.flags.isReadUnmapped) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isMateUnmapped || potentialMate.flags.isMateUnmapped) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadFirstOfPair && !potentialMate.flags.isReadLastOfPair) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadLastOfPair && !potentialMate.flags.isReadFirstOfPair) { return PAIRING_CANNOT_MATE; }
    
  if (potentialMate._mocked) {
    _.extend(potentialMate, {
      rname: itvl.rnext == '=' ? itvl.rname : itvl.rnext,
      pos: itvl.pnext,
      start: itvl.rnext == '=' ? parseInt10(itvl.pnext) + (itvl.start - parseInt10(itvl.pos)) : 0,
      end: tlen > 0 ? itvl.start + tlen : (tlen < 0 ? itvl.end + tlen + itvlLength : 0),
      rnext: itvl.rnext == '=' ? '=' : itvl.rname,
      pnext: itvl.pos
    });
  }
  
  // Check that the alignments are on the same reference sequence
  if (itvl.rnext != '=' || potentialMate.rnext != '=') { 
    // and if not, do the coordinates match at all?
    if (itvl.rnext != potentialMate.rname || itvl.rnext != potentialMate.rname) { return PAIRING_CANNOT_MATE; }
    if (itvl.pnext != potentialMate.pos || itvl.pos != potentialMate.pnext) { return PAIRING_CANNOT_MATE; }
    return PAIRING_MATE_ONLY;
  }
  
  if (potentialMate._mocked) {
    _.extend(potentialMate.flags, {
      readStrandReverse: itvl.flags.mateStrandReverse,
      mateStrandReverse: itvl.flags.readStrandReverse
    });
  } 
  
  itvlIsLater = itvl.start > potentialMate.start;
  inferredInsertSize = Math.abs(tlen);
  
  // Check that the alignments are --> <--
  if (itvlIsLater) {
    if (!itvl.flags.readStrandReverse || itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (potentialMate.flags.readStrandReverse || !potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  } else {
    if (itvl.flags.readStrandReverse || !itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (!potentialMate.flags.readStrandReverse || potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  }
  
  // Check that the inferredInsertSize is within the acceptable range.
  itvl.insertSize = potentialMate.insertSize = inferredInsertSize;
  if (inferredInsertSize > this.pairingMaxDistance || inferredInsertSize < this.pairingMinDistance) { return PAIRING_MATE_ONLY; }
  
  return PAIRING_DRAW_AS_MATES;
}

exports.PairedIntervalTree = PairedIntervalTree;

})(module && module.exports || this);
},{"../../../underscore.min.js":25,"./IntervalTree.js":17,"./utils.js":22}],20:[function(require,module,exports){
(function(exports){

var _ = require('../../../underscore.min.js');

/**
  * RemoteTrack
  *
  * A helper class built for caching data fetched from a remote track (data aligned to a genome).
  * The genome is divided into bins of optimalFetchWindow nts, for each of which data will only be fetched once.
  * To setup the bins, call .setupBins(...) after initializing the class.
  *
  * There is one main public method for this class: .fetchAsync(start, end, callback)
  * (For consistency with CustomTracks.js, all `start` and `end` positions are 1-based, oriented to
  * the start of the genome, and intervals are right-open.)
  *
  * This method will request and cache data for the given interval that is not already cached, and call 
  * callback(intervals) as soon as data for all intervals is available. (If the data is already available, 
  * it will call the callback immediately.)
  **/

var BIN_LOADING = 1,
  BIN_LOADED = 2;

/**
  * RemoteTrack constructor.
  *
  * Note you still must call `.setupBins(...)` before the RemoteTrack is ready to fetch data.
  *
  * @param (IntervalTree) cache: An cache store that will receive intervals fetched for each bin.
  *                              Should be an IntervalTree or equivalent, that implements `.addIfNew(...)` and 
  *                              `.search(start, end)` methods. If it is an *extension* of an IntervalTree, note 
  *                              the `extraArgs` param permitted for `.fetchAsync()`, which are passed along as 
  *                              extra arguments to `.search()`.
  * @param (function) fetcher: A function that will be called to fetch data for each bin.
  *                            This function should take three arguments, `start`, `end`, and `storeIntervals`.
  *                            `start` and `end` are 1-based genomic coordinates forming a right-open interval.
  *                            `storeIntervals` is a callback that `fetcher` MUST call on the array of intervals
  *                            once they have been fetched from the remote data source and parsed.
  * @see _fetchBin for how `fetcher` is utilized.
  **/
function RemoteTrack(cache, fetcher) {
  if (typeof cache != 'object' || (!cache.addIfNew && (!_.keys(cache).length || cache[_.keys(cache)[0]].addIfNew))) { 
    throw new Error('you must specify an IntervalTree cache, or an object/array containing IntervalTrees, as the 1st argument.'); 
  }
  if (typeof fetcher != 'function') { throw new Error('you must specify a fetcher function as the 2nd argument.'); }
  
  this.cache = cache;
  this.fetcher = fetcher;
  
  this.callbacks = [];
  this.afterBinSetup = [];
  this.binsLoaded = null;
}

/**
 * public methods
 **/

// Setup the binning scheme for this RemoteTrack. This can occur anytime after initialization, and in fact,
// can occur after calls to `.fetchAsync()` have been made, in which case they will be waiting on this method
// to be called to proceed. But it MUST be called before data will be received by callbacks passed to 
// `.fetchAsync()`.
RemoteTrack.prototype.setupBins = function(genomeSize, optimalFetchWindow, maxFetchWindow) {
  var self = this;
  if (self.binsLoaded) { throw new Error('you cannot run setupBins more than once.'); }
  if (typeof genomeSize != 'number') { throw new Error('you must specify the genomeSize as the 1st argument.'); }
  if (typeof optimalFetchWindow != 'number') { throw new Error('you must specify optimalFetchWindow as the 2nd argument.'); }
  if (typeof maxFetchWindow != 'number') { throw new Error('you must specify maxFetchWindow as the 3rd argument.'); }
  
  self.genomeSize = genomeSize;
  self.optimalFetchWindow = optimalFetchWindow;
  self.maxFetchWindow = maxFetchWindow;
  
  self.numBins = Math.ceil(genomeSize / optimalFetchWindow);
  self.binsLoaded = {};
  
  // Fire off ranges saved to afterBinSetup
  _.each(this.afterBinSetup, function(range) {
    self.fetchAsync(range.start, range.end, range.extraArgs);
  });
  _clearCallbacksForTooBigIntervals(self);
}


// Fetches data (if necessary) for unfetched bins overlapping with the interval from `start` to `end`.
// Then, run `callback` on all stored subintervals that overlap with the interval from `start` to `end`.
// `extraArgs` is an *optional* parameter that can contain arguments passed to the `.search()` function of the cache.
//
// @param (number) start:       1-based genomic coordinate to start fetching from
// @param (number) end:         1-based genomic coordinate (right-open) to start fetching *until*
// @param (Array) [extraArgs]:  optional, passed along to the `.search()` calls on the .cache as arguments 3 and up; 
//                              perhaps useful if the .cache has overridden this method
// @param (function) callback:  A function that will be called once data is ready for this interval. Will be passed
//                              all interval features that have been fetched for this interval, or {tooMany: true}
//                              if more data was requested than could be reasonably fetched.
RemoteTrack.prototype.fetchAsync = function(start, end, extraArgs, callback) {
  var self = this;
  if (_.isFunction(extraArgs) && _.isUndefined(callback)) { callback = extraArgs; extraArgs = undefined; }
  if (!self.binsLoaded) {
    // If bins *aren't* setup yet:
    // Save the callback onto the queue
    if (_.isFunction(callback)) { 
      self.callbacks.push({start: start, end: end, extraArgs: extraArgs, callback: callback}); 
    }
    
    // Save this fetch for when the bins are loaded
    self.afterBinSetup.push({start: start, end: end, extraArgs: extraArgs});
  } else {
    // If bins *are* setup, first calculate which bins correspond to this interval, 
    // and what state those bins are in
    var bins = _binOverlap(self, start, end),
      loadedBins = _.filter(bins, function(i) { return self.binsLoaded[i] === BIN_LOADED; }),
      binsToFetch = _.filter(bins, function(i) { return !self.binsLoaded[i]; });
    
    if (loadedBins.length == bins.length) {
      // If we've already loaded data for all the bins in question, short-circuit and run the callback now
      extraArgs = _.isUndefined(extraArgs) ? [] : extraArgs;
      return _.isFunction(callback) && callback(self.cache.search.apply(self.cache, [start, end].concat(extraArgs)));
    } else if (end - start > self.maxFetchWindow) {
      // else, if this interval is too big (> maxFetchWindow), fire the callback right away with {tooMany: true}
      return _.isFunction(callback) && callback({tooMany: true});
    }
    
    // else, push the callback onto the queue
    if (_.isFunction(callback)) { 
      self.callbacks.push({start: start, end: end, extraArgs: extraArgs, callback: callback}); 
    }
    
    // then run fetches for the unfetched bins, which should call _fireCallbacks after they complete,
    // which will automatically fire callbacks from the above queue as they acquire all needed data.
    _.each(binsToFetch, function(binIndex) {
      _fetchBin(self, binIndex, function() { _fireCallbacks(self); });
    });
  }
}


/**
 * private methods
 **/

// Calculates which bins overlap with an interval given by `start` and `end`.
// `start` and `end` are 1-based coordinates forming a right-open interval.
function _binOverlap(remoteTrk, start, end) {
  if (!remoteTrk.binsLoaded) { throw new Error('you cannot calculate bin overlap before setupBins is called.'); }
  // Internally, for assigning coordinates to bins, we use 0-based coordinates for easier calculations.
  var startBin = Math.floor((start - 1) / remoteTrk.optimalFetchWindow),
    endBin = Math.floor((end - 1) / remoteTrk.optimalFetchWindow);
  return _.range(startBin, endBin + 1);
}

// Runs the fetcher function on a given bin.
// The fetcher function is obligated to run a callback function `storeIntervals`, 
//    passed as its third argument, on a set of intervals that will be inserted into the 
//    remoteTrk.cache IntervalTree.
// The `storeIntervals` function may accept a second argument called `cacheIndex`, in case
//    remoteTrk.cache is actually a container for multiple IntervalTrees, indicating which 
//    one to store it in.
// We then call the `callback` given here after that is complete.
function _fetchBin(remoteTrk, binIndex, callback) {
  var start = binIndex * remoteTrk.optimalFetchWindow + 1,
    end = (binIndex + 1) * remoteTrk.optimalFetchWindow + 1;
  remoteTrk.binsLoaded[binIndex] = BIN_LOADING;
  remoteTrk.fetcher(start, end, function storeIntervals(intervals) {
    _.each(intervals, function(interval) {
      if (!interval) { return; }
      remoteTrk.cache.addIfNew(interval, interval.id);
    });
    remoteTrk.binsLoaded[binIndex] = BIN_LOADED;
    _.isFunction(callback) && callback();
  });
}

// Runs through all saved callbacks and fires any callbacks where all the required data is ready
// Callbacks that are fired are removed from the queue.
function _fireCallbacks(remoteTrk) {
  remoteTrk.callbacks = _.filter(remoteTrk.callbacks, function(afterLoad) {
    var callback = afterLoad.callback,
      extraArgs = _.isUndefined(afterLoad.extraArgs) ? [] : afterLoad.extraArgs,
      bins, stillLoadingBins;
        
    if (afterLoad.end - afterLoad.start > remoteTrk.maxFetchWindow) {
      callback({tooMany: true});
      return false;
    }
    
    bins = _binOverlap(remoteTrk, afterLoad.start, afterLoad.end);
    stillLoadingBins = _.filter(bins, function(i) { return remoteTrk.binsLoaded[i] !== BIN_LOADED; }).length > 0;
    if (!stillLoadingBins) {
      callback(remoteTrk.cache.search.apply(remoteTrk.cache, [afterLoad.start, afterLoad.end].concat(extraArgs)));
      return false;
    }
    return true;
  });
}

// Runs through all saved callbacks and fires any callbacks for which we won't load data since the amount
// requested is too large. Callbacks that are fired are removed from the queue.
function _clearCallbacksForTooBigIntervals(remoteTrk) {
  remoteTrk.callbacks = _.filter(remoteTrk.callbacks, function(afterLoad) {
    var callback = afterLoad.callback;
    if (afterLoad.end - afterLoad.start > remoteTrk.maxFetchWindow) {
      callback({tooMany: true});
      return false;
    }
    return true;
  });
}


exports.RemoteTrack = RemoteTrack;

})(module && module.exports || this);
},{"../../../underscore.min.js":25}],21:[function(require,module,exports){
(function(exports){
// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * By Shin Suzuki, MIT license
 * https://github.com/shinout/SortedList
 *
 * SortedList : constructor
 * 
 * @param arr : Array or null : an array to set
 *
 * @param options : object  or null
 *         (function) filter  : filter function called before inserting data.
 *                              This receives a value and returns true if the value is valid.
 *
 *         (function) compare : function to compare two values, 
 *                              which is used for sorting order.
 *                              the same signature as Array.prototype.sort(fn).
 *                              
 *         (string)   compare : if you'd like to set a common comparison function,
 *                              you can specify it by string:
 *                              "number" : compares number
 *                              "string" : compares string
 */
function SortedList() {
  var arr     = null,
      options = {},
      args    = arguments;

  ["0","1"].forEach(function(n) {
    var val = args[n];
    if (Array.isArray(val)) {
      arr = val;
    }
    else if (val && typeof val == "object") {
      options = val;
    }
  });
  this.arr = [];

  ["filter", "compare"].forEach(function(k) {
    if (typeof options[k] == "function") {
      this[k] = options[k];
    }
    else if (options[k] && SortedList[k][options[k]]) {
      this[k] = SortedList[k][options[k]];
    }
  }, this);
  if (arr) this.massInsert(arr);
};

// Binary search for the index of the item equal to `val`, or if no such item exists, the next lower item
// This can be -1 if `val` is lower than the lowest item in the SortedList
SortedList.prototype.bsearch = function(val) {
  var mpos,
      spos = 0,
      epos = this.arr.length;
  while (epos - spos > 1) {
    mpos = Math.floor((spos + epos)/2);
    mval = this.arr[mpos];
    switch (this.compare(val, mval)) {
    case 1  :
    default :
      spos = mpos;
      break;
    case -1 :
      epos = mpos;
      break;
    case 0  :
      return mpos;
    }
  }
  return (this.arr[0] == null || spos == 0 && this.arr[0] != null && this.compare(this.arr[0], val) == 1) ? -1 : spos;
};

SortedList.prototype.get = function(pos) {
  return this.arr[pos];
};

SortedList.prototype.toArray = function(pos) {
  return this.arr.slice();
};

SortedList.prototype.slice = function() {
  return this.arr.slice.apply(this.arr, arguments);
}

SortedList.prototype.size = function() {
  return this.arr.length;
};

SortedList.prototype.head = function() {
  return this.arr[0];
};

SortedList.prototype.tail = function() {
  return (this.arr.length == 0) ? null : this.arr[this.arr.length -1];
};

SortedList.prototype.massInsert = function(items) {
  // This loop avoids call stack overflow because of too many arguments
  for (var i = 0; i < items.length; i += 4096) {
    Array.prototype.push.apply(this.arr, Array.prototype.slice.call(items, i, i + 4096));
  }
  this.arr.sort(this.compare);
}

SortedList.prototype.insert = function() {
  if (arguments.length > 100) {
    // .bsearch + .splice is too expensive to repeat for so many elements.
    // Let's just append them all to this.arr and resort.
    this.massInsert(arguments);
  } else {
    Array.prototype.forEach.call(arguments, function(val) {
      var pos = this.bsearch(val);
      if (this.filter(val, pos)) {
        this.arr.splice(pos+1, 0, val);
      }
    }, this);
  }
};

SortedList.prototype.filter = function(val, pos) {
  return true;
};

SortedList.prototype.add = SortedList.prototype.insert;

SortedList.prototype["delete"] = function(pos) {
  this.arr.splice(pos, 1);
};

SortedList.prototype.remove = SortedList.prototype["delete"];

SortedList.prototype.massRemove = function(startPos, count) {
  this.arr.splice(startPos, count);
};

/**
 * default compare functions 
 **/
SortedList.compare = {
  "number": function(a, b) {
    var c = a - b;
    return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
  },

  "string": function(a, b) {
    return (a > b) ? 1 : (a == b)  ? 0 : -1;
  }
};

SortedList.prototype.compare = SortedList.compare["number"];

exports.SortedList = SortedList;

})(module && module.exports || this);
},{}],22:[function(require,module,exports){
var _ = require('../../../underscore.min.js');

// Parse a track declaration line, which is in the format of:
// track name="blah" optname1="value1" optname2="value2" ...
// into a hash of options
module.exports.parseDeclarationLine = function(line, start) {
  var opts = {}, optname = '', value = '', state = 'optname';
  function pushValue(quoting) {
    state = 'optname';
    opts[optname.replace(/^\s+|\s+$/g, '')] = value;
    optname = value = '';
  }
  for (i = line.match(start)[0].length; i < line.length; i++) {
    c = line[i];
    if (state == 'optname') {
      if (c == '=') { state = 'startvalue'; }
      else { optname += c; }
    } else if (state == 'startvalue') {
      if (/'|"/.test(c)) { state = c; }
      else { value += c; state = 'value'; }
    } else if (state == 'value') {
      if (/\s/.test(c)) { pushValue(); }
      else { value += c; }
    } else if (/'|"/.test(state)) {
      if (c == state) { pushValue(state); }
      else { value += c; }
    }
  }
  if (state == 'value') { pushValue(); }
  if (state != 'optname') { return false; }
  return opts;
}

// Constructs a mapping function that converts bp intervals into pixel intervals, with optional calculations for text too
module.exports.pixIntervalCalculator = function(start, width, bppp, withText, nameFunc, startkey, endkey) {
  if (!_.isFunction(nameFunc)) { nameFunc = function(d) { return d.name || ''; }; }
  if (_.isUndefined(startkey)) { startkey = 'start'; }
  if (_.isUndefined(endkey)) { endkey = 'end'; }
  return function(d) {
    var itvlStart = _.isUndefined(d[startkey]) ? d.start : d[startkey],
      itvlEnd = _.isUndefined(d[endkey]) ? d.end : d[endkey];
    var pInt = {
      x: Math.round((itvlStart - start) / bppp),
      w: Math.round((itvlEnd - itvlStart) / bppp) + 1,
      t: 0,          // calculated width of text
      oPrev: false,  // overflows into previous tile?
      oNext: false   // overflows into next tile?
    };
    pInt.tx = pInt.x;
    pInt.tw = pInt.w;
    if (pInt.x < 0) { pInt.w += pInt.x; pInt.x = 0; pInt.oPrev = true; }
    else if (withText) {
      pInt.t = _.isNumber(withText) ? withText : Math.min(nameFunc(d).length * 10 + 2, pInt.x);
      pInt.tx -= pInt.t;
      pInt.tw += pInt.t;  
    }
    if (pInt.x + pInt.w > width) { pInt.w = width - pInt.x; pInt.oNext = true; }
    return pInt;
  };
};

// For two given objects of the form {x: 1, w: 2} (pixel intervals), describe the overlap.
// Returns null if there is no overlap.
module.exports.pixIntervalOverlap = function(pInt1, pInt2) {
  var overlap = {},
    tmp;
  if (pInt1.x > pInt2.x) { tmp = pInt2; pInt2 = pInt1; pInt1 = tmp; }       // swap so that pInt1 is always lower
  if (!pInt1.w || !pInt2.w || pInt1.x + pInt1.w < pInt2.x) { return null; } // detect no-overlap conditions
  overlap.x = pInt2.x;
  overlap.w = Math.min(pInt1.w - pInt2.x + pInt1.x, pInt2.w);
  return overlap;
};

// Common functions for summarizing data in bins while plotting wiggle tracks
module.exports.wigBinFunctions = {
  minimum: function(bin) { return bin.length ? Math.min.apply(Math, bin) : 0; },
  mean: function(bin) { return _.reduce(bin, function(a,b) { return a + b; }, 0) / bin.length; },
  maximum: function(bin) { return bin.length ? Math.max.apply(Math, bin) : 0; }
};

// Faster than Math.floor (http://webdood.com/?p=219)
module.exports.floorHack = function(num) { return (num << 0) - (num < 0 ? 1 : 0); }

// Other tiny functions that we need for odds and ends...
module.exports.strip = function(str) { return str.replace(/^\s+|\s+$/g, ''); }
module.exports.parseInt10 = function(val) { return parseInt(val, 10); }
module.exports.deepClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }
},{"../../../underscore.min.js":25}],23:[function(require,module,exports){
// ====================================================================
// = vcfTabix format: http://genome.ucsc.edu/goldenPath/help/vcf.html =
// ====================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.vcftabix
var VcfTabixFormat = {
  defaults: {
    priority: 100,
    drawLimit: {squish: 500, pack: 100},
    maxFetchWindow: 100000,
    chromosomes: ''
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for vcfTabix track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
  },

  parse: function(lines) {
    var self = this;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    // TODO: Set maxFetchWindow using some heuristic based on how many items are in the tabix index
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = this.chrRange(start, end);
    
    function lineToInterval(line) {
      var fields = line.split('\t'), data = {}, info = {};
      if (fields[7]) {
        _.each(fields[7].split(';'), function(l) { l = l.split('='); if (l.length > 1) { info[l[0]] = l[1]; } });
      }
      data.start = self.browserOpts.chrPos[fields[0]] + parseInt10(fields[1]);
      data.id = fields[2]=='.' ? 'vcf-' + Math.floor(Math.random() * 100000000) : fields[2];
      data.end = data.start + 1;
      data.ref = fields[3];
      data.alt = fields[4];
      data.qual = parseFloat(fields[5]);
      data.info = info;
      return {data: data};
    }
    function nameFunc(fields) {
      var ref = fields.ref || '',
        alt = fields.alt || '';
      return (ref.length > alt.length ? ref : alt) || '';
    }
  
    function success(data) {
      var drawSpec = [],
        lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length > 8; }),
        calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density=='pack', nameFunc);
      if (density == 'dense') {
        _.each(lines, function(line) {
          drawSpec.push(calcPixInterval(lineToInterval(line).data));
        });
      } else {
        drawSpec = {layout: self.type('bed').stackedLayout(_.map(lines, lineToInterval), width, calcPixInterval)};
        drawSpec.width = width;
      }
      callback(drawSpec);
    }
  
    // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch too much data, as this will only delay other requests.
    // TODO: cache results so we aren't refetching the same regions over and over again.
    if ((end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      $.ajax(this.ajaxDir() + 'tabix.php', {
        data: {range: range, url: this.opts.bigDataUrl},
        success: success
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = this.opts.url ? this.opts.url : 'javascript:void("'+this.opts.name+':$$")',
      lineHeight = density == 'pack' ? 27 : 6,
      colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,255,0'},
      drawLimit = this.opts.drawLimit && this.opts.drawLimit[density],
      areas = null;
    if (!ctx) { throw "Canvas not supported"; }
    if (density == 'pack') { areas = this.areas[canvas.id] = []; }
    ctx.fillStyle = "rgb(0,0,0)";
    this.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      if ((drawLimit && drawSpec.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
      } else if (density == 'dense') {
        canvas.height = 15;
        _.each(drawSpec, function(pInt) {
          ctx.fillRect(pInt.x, 1, pInt.w, 13);
        });
      } else {
        canvas.height = drawSpec.layout.length * lineHeight;
        _.each(drawSpec.layout, function(l, i) {
          _.each(l, function(data) {
            var altColor, refColor;
            if (areas) {
              refColor = colors[data.d.ref.toLowerCase()] || '255,0,0';
              altColor = colors[data.d.alt.toLowerCase()] || '255,0,0';
              ctx.fillStyle = "rgb(" + altColor + ")"; 
            }
            ctx.fillRect(data.pInt.x, i * lineHeight + 1, data.pInt.w, lineHeight - 1);
            if (areas) {
              areas.push([
                data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, //x1, x2, y1, y2
                data.d.ref + ' > ' + data.d.alt, // title
                urlTemplate.replace('$$', data.d.id), // href
                data.pInt.oPrev, // continuation from previous tile?
                altColor, // label color
                '<span style="color: rgb(' + refColor + ')">' + data.d.ref + '</span><br/>' + data.d.alt, // label
                data.d.info
              ]);
            }
          });
        });
      }
      if (_.isFunction(callback)) { callback(); }
    });
  }
};

module.exports = VcfTabixFormat;


},{"./utils/utils.js":22}],24:[function(require,module,exports){
(function (global){
// ==================================================================
// = WIG format: http://genome.ucsc.edu/goldenPath/help/wiggle.html =
// ==================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  parseDeclarationLine = utils.parseDeclarationLine;
var SortedList = require('./utils/SortedList.js').SortedList;

// Intended to be loaded into CustomTrack.types.wiggle_0
var WiggleFormat = {
  defaults: {
    altColor: '',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() {
    this.type().initOpts.call(this);
  },
  
  _binFunctions: utils.wigBinFunctions,
  
  initOpts: function() {
    var o = this.opts,
      _binFunctions = this.type()._binFunctions;
    if (!this.validateColor(o.altColor)) { o.altColor = ''; }
    o.viewLimits = _.map(o.viewLimits.split(':'), parseFloat);
    o.maxHeightPixels = _.map(o.maxHeightPixels.split(':'), parseInt10);
    o.yLineOnOff = this.isOn(o.yLineOnOff);
    o.yLineMark = parseFloat(o.yLineMark);
    o.autoScale = this.isOn(o.autoScale);
    if (_binFunctions && !_binFunctions[o.windowingFunction]) {
      throw new Error("invalid windowingFunction at line " + o.lineNum); 
    }
    if (_.isNaN(o.yLineMark)) { o.yLineMark = 0.0; }
  },
  
  applyOpts: function() {
    var self = this,
      o = self.opts;
    self.drawRange = o.autoScale || o.viewLimits.length < 2 ? self.range : o.viewLimits;
    _.each({max: 0, min: 2, start: 1}, function(v, k) { self.heights[k] = o.maxHeightPixels[v]; });
    if (!o.altColor) {
      var hsl = this.rgbToHsl.apply(this, o.color.split(/,\s*/g));
      hsl[0] = hsl[0] + 0.02 % 1;
      hsl[1] = hsl[1] * 0.7;
      hsl[2] = 1 - (1 - hsl[2]) * 0.7;
      self.altColor = _.map(this.hslToRgb.apply(this, hsl), parseInt10).join(',');
    }
  },

  parse: function(lines) {
    var self = this,
      genomeSize = this.browserOpts.genomeSize,
      data = {all: []},
      mode, modeOpts, chrPos, m;
    self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
  
    _.each(lines, function(line, lineno) {
      var val, start;
      
      m = line.match(/^(variable|fixed)Step\s+/i);
      if (m) {
        mode = m[1].toLowerCase();
        modeOpts = parseDeclarationLine(line, /^(variable|fixed)Step\s+/i);
        modeOpts.start = parseInt10(modeOpts.start);
        if (mode == 'fixed' && (_.isNaN(modeOpts.start) || !modeOpts.start)) {
          throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero start parameter"); 
        }
        modeOpts.step = parseInt10(modeOpts.step);
        if (mode == 'fixed' && (_.isNaN(modeOpts.step) || !modeOpts.step)) {
          throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero step parameter"); 
        }
        modeOpts.span = parseInt10(modeOpts.span) || 1;
        chrPos = self.browserOpts.chrPos[modeOpts.chrom];
        if (_.isUndefined(chrPos)) {
          self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
        }
      } else {
        if (!mode) { 
          throw new Error("Wiggle format at " + (lineno + 1 + self.opts.lineNum) + " has no preceding mode declaration"); 
        } else if (_.isUndefined(chrPos)) {
          // invalid chromosome
        } else {
          if (mode == 'fixed') {
            val = parseFloat(line);
            data.all.push({start: chrPos + modeOpts.start, end: chrPos + modeOpts.start + modeOpts.span, val: val});
            modeOpts.start += modeOpts.step;
          } else {
            line = line.split(/\s+/);
            if (line.length < 2) {
              throw new Error("variableStep at line " + (lineno + 1 + self.opts.lineNum) + " requires two values per line"); 
            }
            start = parseInt10(line[0]);
            val = parseFloat(line[1]);
            data.all.push({start: chrPos + start, end: chrPos + start + modeOpts.span, val: val});
          }
        }
      }
    });
    
    return self.type().finishParse.call(self, data);
  },
  
  finishParse: function(data) {
    var self = this,
      binFunction = self.type()._binFunctions[self.opts.windowingFunction];
    if (data.all.length > 0) {
      self.range[0] = _.min(data.all, function(d) { return d.val; }).val;
      self.range[1] = _.max(data.all, function(d) { return d.val; }).val;
    }
    data.all = new SortedList(data.all, {
      compare: function(a, b) {
        if (a === null) return -1;
        if (b === null) return  1;
        var c = a.start - b.start;
        return (c > 0) ? 1 : (c === 0)  ? 0 : -1;
      }
    });
  
    // Pre-optimize data for high bppps by downsampling
    _.each(self.browserOpts.bppps, function(bppp) {
      if (self.browserOpts.genomeSize / bppp > 1000000) { return; }
      var pixLen = Math.ceil(self.browserOpts.genomeSize / bppp),
        downsampledData = (data[bppp] = (global.Float32Array ? new Float32Array(pixLen) : new Array(pixLen))),
        j = 0,
        curr = data.all.get(0),
        bin, next;
      for (var i = 0; i < pixLen; i++) {
        bin = curr && (curr.start <= i * bppp && curr.end > i * bppp) ? [curr.val] : [];
        while ((next = data.all.get(j + 1)) && next.start < (i + 1) * bppp && next.end > i * bppp) { 
          bin.push(next.val); ++j; curr = next; 
        }
        downsampledData[i] = binFunction(bin);
      }
      data._binFunction = self.opts.windowingFunction;
    });
    self.data = data;
    self.stretchHeight = true;
    self.type('wiggle_0').applyOpts.apply(self);
    return true; // success!
  },
  
  initDrawSpec: function(precalc) {
    var vScale = (this.drawRange[1] - this.drawRange[0]) / precalc.height,
      drawSpec = {
        bars: [],
        vScale: vScale,
        yLine: this.isOn(this.opts.yLineOnOff) ? Math.round((this.opts.yLineMark - this.drawRange[0]) / vScale) : null, 
        zeroLine: -this.drawRange[0] / vScale
      };
    return drawSpec;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      bppp = (end - start) / precalc.width,
      drawSpec = self.type().initDrawSpec.call(self, precalc),
      binFunction = self.type()._binFunctions[self.opts.windowingFunction],
      downsampledData;
    if (self.data._binFunction == self.opts.windowingFunction && (downsampledData = self.data[bppp])) {
      // We've already pre-optimized for this bppp
      drawSpec.bars = _.map(_.range((start - 1) / bppp, (end - 1) / bppp), function(xFromOrigin, x) {
        return ((downsampledData[xFromOrigin] || 0) - self.drawRange[0]) / drawSpec.vScale;
      });
    } else {
      // We have to do the binning on the fly
      var j = self.data.all.bsearch({start: start}),
        curr = self.data.all.get(j), next, bin;
      for (var i = 0; i < precalc.width; i++) {
        bin = curr && (curr.end >= i * bppp + start) ? [curr.val] : [];
        while ((next = self.data.all.get(j + 1)) && next.start < (i + 1) * bppp + start && next.end >= i * bppp + start) { 
          bin.push(next.val); ++j; curr = next; 
        }
        drawSpec.bars.push((binFunction(bin) - self.drawRange[0]) / drawSpec.vScale);
      }
    }
    return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
  },
  
  drawBars: function(ctx, drawSpec, height, width) {
    var zeroLine = drawSpec.zeroLine, // pixel position of the data value 0
      color = "rgb("+this.opts.color+")",
      altColor = "rgb("+(this.opts.altColor || this.altColor)+")",
      pointGraph = this.opts.graphType==='points';
    
    ctx.fillStyle = color;
    _.each(drawSpec.bars, function(d, x) {
      if (d === null) { return; }
      else if (d > zeroLine) { 
        if (pointGraph) { ctx.fillRect(x, height - d, 1, 1); }
        else { ctx.fillRect(x, height - d, 1, zeroLine > 0 ? (d - zeroLine) : d); }
      } else {
        ctx.fillStyle = altColor;
        if (pointGraph) { ctx.fillRect(x, zeroLine - d - 1, 1, 1); } 
        else { ctx.fillRect(x, height - zeroLine, 1, zeroLine - d); }
        ctx.fillStyle = color;
      }
    });
    if (drawSpec.yLine !== null) {
      ctx.fillStyle = "rgb(0,0,0)";
      ctx.fillRect(0, height - drawSpec.yLine, width, 1);
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this,
      height = canvas.height,
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
      self.type().drawBars.call(self, ctx, drawSpec, height, width);
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  loadOpts: function($dialog) {
    var o = this.opts,
      $viewLimits = $dialog.find('.view-limits'),
      $maxHeightPixels = $dialog.find('.max-height-pixels'),
      altColorOn = this.validateColor(o.altColor);
    $dialog.find('[name=altColorOn]').attr('checked', altColorOn).change();
    $dialog.find('[name=altColor]').val(altColorOn ? o.altColor :'128,128,128').change();
    $dialog.find('[name=autoScale]').attr('checked', !this.isOn(o.autoScale)).change();
    $viewLimits.slider("option", "min", this.range[0]);
    $viewLimits.slider("option", "max", this.range[1]);
    $dialog.find('[name=viewLimitsMin]').val(this.drawRange[0]).change();
    $dialog.find('[name=viewLimitsMax]').val(this.drawRange[1]).change();
    $dialog.find('[name=yLineOnOff]').attr('checked', this.isOn(o.yLineOnOff)).change();
    $dialog.find('[name=yLineMark]').val(o.yLineMark).change();
    $dialog.find('[name=graphType]').val(o.graphType).change();
    $dialog.find('[name=windowingFunction]').val(o.windowingFunction).change();
    $dialog.find('[name=maxHeightPixelsOn]').attr('checked', o.maxHeightPixels.length >= 3);
    $dialog.find('[name=maxHeightPixelsMin]').val(o.maxHeightPixels[2]).change();
    $dialog.find('[name=maxHeightPixelsMax]').val(o.maxHeightPixels[0]).change();
  },
  
  saveOpts: function($dialog) {
    var o = this.opts,
      altColorOn = $dialog.find('[name=altColorOn]').is(':checked'),
      maxHeightPixelsOn = $dialog.find('[name=maxHeightPixelsOn]').is(':checked'),
      maxHeightPixelsMax = $dialog.find('[name=maxHeightPixelsMax]').val();
    o.altColor = altColorOn ? $dialog.find('[name=altColor]').val() : '';
    o.autoScale = !$dialog.find('[name=autoScale]').is(':checked');
    o.viewLimits = $dialog.find('[name=viewLimitsMin]').val() + ':' + $dialog.find('[name=viewLimitsMax]').val();
    o.yLineOnOff = $dialog.find('[name=yLineOnOff]').is(':checked');
    o.yLineMark = $dialog.find('[name=yLineMark]').val();
    o.graphType = $dialog.find('[name=graphType]').val();
    o.windowingFunction = $dialog.find('[name=windowingFunction]').val();
    o.maxHeightPixels = maxHeightPixelsOn ? 
      [maxHeightPixelsMax, maxHeightPixelsMax, $dialog.find('[name=maxHeightPixelsMin]').val()].join(':') : '';
    this.type('wiggle_0').initOpts.call(this);
  }
  
};

module.exports = WiggleFormat;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils/SortedList.js":21,"./utils/utils.js":22}],25:[function(require,module,exports){
//     Underscore.js 1.8.3
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.
(function(){function n(n){function t(t,r,e,u,i,o){for(;i>=0&&o>i;i+=n){var a=u?u[i]:i;e=r(e,t[a],a,t)}return e}return function(r,e,u,i){e=b(e,i,4);var o=!k(r)&&m.keys(r),a=(o||r).length,c=n>0?0:a-1;return arguments.length<3&&(u=r[o?o[c]:c],c+=n),t(r,e,u,o,c,a)}}function t(n){return function(t,r,e){r=x(r,e);for(var u=O(t),i=n>0?0:u-1;i>=0&&u>i;i+=n)if(r(t[i],i,t))return i;return-1}}function r(n,t,r){return function(e,u,i){var o=0,a=O(e);if("number"==typeof i)n>0?o=i>=0?i:Math.max(i+a,o):a=i>=0?Math.min(i+1,a):i+a+1;else if(r&&i&&a)return i=r(e,u),e[i]===u?i:-1;if(u!==u)return i=t(l.call(e,o,a),m.isNaN),i>=0?i+o:-1;for(i=n>0?o:a-1;i>=0&&a>i;i+=n)if(e[i]===u)return i;return-1}}function e(n,t){var r=I.length,e=n.constructor,u=m.isFunction(e)&&e.prototype||a,i="constructor";for(m.has(n,i)&&!m.contains(t,i)&&t.push(i);r--;)i=I[r],i in n&&n[i]!==u[i]&&!m.contains(t,i)&&t.push(i)}var u=this,i=u._,o=Array.prototype,a=Object.prototype,c=Function.prototype,f=o.push,l=o.slice,s=a.toString,p=a.hasOwnProperty,h=Array.isArray,v=Object.keys,g=c.bind,y=Object.create,d=function(){},m=function(n){return n instanceof m?n:this instanceof m?void(this._wrapped=n):new m(n)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=m),exports._=m):u._=m,m.VERSION="1.8.3";var b=function(n,t,r){if(t===void 0)return n;switch(null==r?3:r){case 1:return function(r){return n.call(t,r)};case 2:return function(r,e){return n.call(t,r,e)};case 3:return function(r,e,u){return n.call(t,r,e,u)};case 4:return function(r,e,u,i){return n.call(t,r,e,u,i)}}return function(){return n.apply(t,arguments)}},x=function(n,t,r){return null==n?m.identity:m.isFunction(n)?b(n,t,r):m.isObject(n)?m.matcher(n):m.property(n)};m.iteratee=function(n,t){return x(n,t,1/0)};var _=function(n,t){return function(r){var e=arguments.length;if(2>e||null==r)return r;for(var u=1;e>u;u++)for(var i=arguments[u],o=n(i),a=o.length,c=0;a>c;c++){var f=o[c];t&&r[f]!==void 0||(r[f]=i[f])}return r}},j=function(n){if(!m.isObject(n))return{};if(y)return y(n);d.prototype=n;var t=new d;return d.prototype=null,t},w=function(n){return function(t){return null==t?void 0:t[n]}},A=Math.pow(2,53)-1,O=w("length"),k=function(n){var t=O(n);return"number"==typeof t&&t>=0&&A>=t};m.each=m.forEach=function(n,t,r){t=b(t,r);var e,u;if(k(n))for(e=0,u=n.length;u>e;e++)t(n[e],e,n);else{var i=m.keys(n);for(e=0,u=i.length;u>e;e++)t(n[i[e]],i[e],n)}return n},m.map=m.collect=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=Array(u),o=0;u>o;o++){var a=e?e[o]:o;i[o]=t(n[a],a,n)}return i},m.reduce=m.foldl=m.inject=n(1),m.reduceRight=m.foldr=n(-1),m.find=m.detect=function(n,t,r){var e;return e=k(n)?m.findIndex(n,t,r):m.findKey(n,t,r),e!==void 0&&e!==-1?n[e]:void 0},m.filter=m.select=function(n,t,r){var e=[];return t=x(t,r),m.each(n,function(n,r,u){t(n,r,u)&&e.push(n)}),e},m.reject=function(n,t,r){return m.filter(n,m.negate(x(t)),r)},m.every=m.all=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(!t(n[o],o,n))return!1}return!0},m.some=m.any=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(t(n[o],o,n))return!0}return!1},m.contains=m.includes=m.include=function(n,t,r,e){return k(n)||(n=m.values(n)),("number"!=typeof r||e)&&(r=0),m.indexOf(n,t,r)>=0},m.invoke=function(n,t){var r=l.call(arguments,2),e=m.isFunction(t);return m.map(n,function(n){var u=e?t:n[t];return null==u?u:u.apply(n,r)})},m.pluck=function(n,t){return m.map(n,m.property(t))},m.where=function(n,t){return m.filter(n,m.matcher(t))},m.findWhere=function(n,t){return m.find(n,m.matcher(t))},m.max=function(n,t,r){var e,u,i=-1/0,o=-1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],e>i&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(u>o||u===-1/0&&i===-1/0)&&(i=n,o=u)});return i},m.min=function(n,t,r){var e,u,i=1/0,o=1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],i>e&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(o>u||1/0===u&&1/0===i)&&(i=n,o=u)});return i},m.shuffle=function(n){for(var t,r=k(n)?n:m.values(n),e=r.length,u=Array(e),i=0;e>i;i++)t=m.random(0,i),t!==i&&(u[i]=u[t]),u[t]=r[i];return u},m.sample=function(n,t,r){return null==t||r?(k(n)||(n=m.values(n)),n[m.random(n.length-1)]):m.shuffle(n).slice(0,Math.max(0,t))},m.sortBy=function(n,t,r){return t=x(t,r),m.pluck(m.map(n,function(n,r,e){return{value:n,index:r,criteria:t(n,r,e)}}).sort(function(n,t){var r=n.criteria,e=t.criteria;if(r!==e){if(r>e||r===void 0)return 1;if(e>r||e===void 0)return-1}return n.index-t.index}),"value")};var F=function(n){return function(t,r,e){var u={};return r=x(r,e),m.each(t,function(e,i){var o=r(e,i,t);n(u,e,o)}),u}};m.groupBy=F(function(n,t,r){m.has(n,r)?n[r].push(t):n[r]=[t]}),m.indexBy=F(function(n,t,r){n[r]=t}),m.countBy=F(function(n,t,r){m.has(n,r)?n[r]++:n[r]=1}),m.toArray=function(n){return n?m.isArray(n)?l.call(n):k(n)?m.map(n,m.identity):m.values(n):[]},m.size=function(n){return null==n?0:k(n)?n.length:m.keys(n).length},m.partition=function(n,t,r){t=x(t,r);var e=[],u=[];return m.each(n,function(n,r,i){(t(n,r,i)?e:u).push(n)}),[e,u]},m.first=m.head=m.take=function(n,t,r){return null==n?void 0:null==t||r?n[0]:m.initial(n,n.length-t)},m.initial=function(n,t,r){return l.call(n,0,Math.max(0,n.length-(null==t||r?1:t)))},m.last=function(n,t,r){return null==n?void 0:null==t||r?n[n.length-1]:m.rest(n,Math.max(0,n.length-t))},m.rest=m.tail=m.drop=function(n,t,r){return l.call(n,null==t||r?1:t)},m.compact=function(n){return m.filter(n,m.identity)};var S=function(n,t,r,e){for(var u=[],i=0,o=e||0,a=O(n);a>o;o++){var c=n[o];if(k(c)&&(m.isArray(c)||m.isArguments(c))){t||(c=S(c,t,r));var f=0,l=c.length;for(u.length+=l;l>f;)u[i++]=c[f++]}else r||(u[i++]=c)}return u};m.flatten=function(n,t){return S(n,t,!1)},m.without=function(n){return m.difference(n,l.call(arguments,1))},m.uniq=m.unique=function(n,t,r,e){m.isBoolean(t)||(e=r,r=t,t=!1),null!=r&&(r=x(r,e));for(var u=[],i=[],o=0,a=O(n);a>o;o++){var c=n[o],f=r?r(c,o,n):c;t?(o&&i===f||u.push(c),i=f):r?m.contains(i,f)||(i.push(f),u.push(c)):m.contains(u,c)||u.push(c)}return u},m.union=function(){return m.uniq(S(arguments,!0,!0))},m.intersection=function(n){for(var t=[],r=arguments.length,e=0,u=O(n);u>e;e++){var i=n[e];if(!m.contains(t,i)){for(var o=1;r>o&&m.contains(arguments[o],i);o++);o===r&&t.push(i)}}return t},m.difference=function(n){var t=S(arguments,!0,!0,1);return m.filter(n,function(n){return!m.contains(t,n)})},m.zip=function(){return m.unzip(arguments)},m.unzip=function(n){for(var t=n&&m.max(n,O).length||0,r=Array(t),e=0;t>e;e++)r[e]=m.pluck(n,e);return r},m.object=function(n,t){for(var r={},e=0,u=O(n);u>e;e++)t?r[n[e]]=t[e]:r[n[e][0]]=n[e][1];return r},m.findIndex=t(1),m.findLastIndex=t(-1),m.sortedIndex=function(n,t,r,e){r=x(r,e,1);for(var u=r(t),i=0,o=O(n);o>i;){var a=Math.floor((i+o)/2);r(n[a])<u?i=a+1:o=a}return i},m.indexOf=r(1,m.findIndex,m.sortedIndex),m.lastIndexOf=r(-1,m.findLastIndex),m.range=function(n,t,r){null==t&&(t=n||0,n=0),r=r||1;for(var e=Math.max(Math.ceil((t-n)/r),0),u=Array(e),i=0;e>i;i++,n+=r)u[i]=n;return u};var E=function(n,t,r,e,u){if(!(e instanceof t))return n.apply(r,u);var i=j(n.prototype),o=n.apply(i,u);return m.isObject(o)?o:i};m.bind=function(n,t){if(g&&n.bind===g)return g.apply(n,l.call(arguments,1));if(!m.isFunction(n))throw new TypeError("Bind must be called on a function");var r=l.call(arguments,2),e=function(){return E(n,e,t,this,r.concat(l.call(arguments)))};return e},m.partial=function(n){var t=l.call(arguments,1),r=function(){for(var e=0,u=t.length,i=Array(u),o=0;u>o;o++)i[o]=t[o]===m?arguments[e++]:t[o];for(;e<arguments.length;)i.push(arguments[e++]);return E(n,r,this,this,i)};return r},m.bindAll=function(n){var t,r,e=arguments.length;if(1>=e)throw new Error("bindAll must be passed function names");for(t=1;e>t;t++)r=arguments[t],n[r]=m.bind(n[r],n);return n},m.memoize=function(n,t){var r=function(e){var u=r.cache,i=""+(t?t.apply(this,arguments):e);return m.has(u,i)||(u[i]=n.apply(this,arguments)),u[i]};return r.cache={},r},m.delay=function(n,t){var r=l.call(arguments,2);return setTimeout(function(){return n.apply(null,r)},t)},m.defer=m.partial(m.delay,m,1),m.throttle=function(n,t,r){var e,u,i,o=null,a=0;r||(r={});var c=function(){a=r.leading===!1?0:m.now(),o=null,i=n.apply(e,u),o||(e=u=null)};return function(){var f=m.now();a||r.leading!==!1||(a=f);var l=t-(f-a);return e=this,u=arguments,0>=l||l>t?(o&&(clearTimeout(o),o=null),a=f,i=n.apply(e,u),o||(e=u=null)):o||r.trailing===!1||(o=setTimeout(c,l)),i}},m.debounce=function(n,t,r){var e,u,i,o,a,c=function(){var f=m.now()-o;t>f&&f>=0?e=setTimeout(c,t-f):(e=null,r||(a=n.apply(i,u),e||(i=u=null)))};return function(){i=this,u=arguments,o=m.now();var f=r&&!e;return e||(e=setTimeout(c,t)),f&&(a=n.apply(i,u),i=u=null),a}},m.wrap=function(n,t){return m.partial(t,n)},m.negate=function(n){return function(){return!n.apply(this,arguments)}},m.compose=function(){var n=arguments,t=n.length-1;return function(){for(var r=t,e=n[t].apply(this,arguments);r--;)e=n[r].call(this,e);return e}},m.after=function(n,t){return function(){return--n<1?t.apply(this,arguments):void 0}},m.before=function(n,t){var r;return function(){return--n>0&&(r=t.apply(this,arguments)),1>=n&&(t=null),r}},m.once=m.partial(m.before,2);var M=!{toString:null}.propertyIsEnumerable("toString"),I=["valueOf","isPrototypeOf","toString","propertyIsEnumerable","hasOwnProperty","toLocaleString"];m.keys=function(n){if(!m.isObject(n))return[];if(v)return v(n);var t=[];for(var r in n)m.has(n,r)&&t.push(r);return M&&e(n,t),t},m.allKeys=function(n){if(!m.isObject(n))return[];var t=[];for(var r in n)t.push(r);return M&&e(n,t),t},m.values=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=n[t[u]];return e},m.mapObject=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=u.length,o={},a=0;i>a;a++)e=u[a],o[e]=t(n[e],e,n);return o},m.pairs=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=[t[u],n[t[u]]];return e},m.invert=function(n){for(var t={},r=m.keys(n),e=0,u=r.length;u>e;e++)t[n[r[e]]]=r[e];return t},m.functions=m.methods=function(n){var t=[];for(var r in n)m.isFunction(n[r])&&t.push(r);return t.sort()},m.extend=_(m.allKeys),m.extendOwn=m.assign=_(m.keys),m.findKey=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=0,o=u.length;o>i;i++)if(e=u[i],t(n[e],e,n))return e},m.pick=function(n,t,r){var e,u,i={},o=n;if(null==o)return i;m.isFunction(t)?(u=m.allKeys(o),e=b(t,r)):(u=S(arguments,!1,!1,1),e=function(n,t,r){return t in r},o=Object(o));for(var a=0,c=u.length;c>a;a++){var f=u[a],l=o[f];e(l,f,o)&&(i[f]=l)}return i},m.omit=function(n,t,r){if(m.isFunction(t))t=m.negate(t);else{var e=m.map(S(arguments,!1,!1,1),String);t=function(n,t){return!m.contains(e,t)}}return m.pick(n,t,r)},m.defaults=_(m.allKeys,!0),m.create=function(n,t){var r=j(n);return t&&m.extendOwn(r,t),r},m.clone=function(n){return m.isObject(n)?m.isArray(n)?n.slice():m.extend({},n):n},m.tap=function(n,t){return t(n),n},m.isMatch=function(n,t){var r=m.keys(t),e=r.length;if(null==n)return!e;for(var u=Object(n),i=0;e>i;i++){var o=r[i];if(t[o]!==u[o]||!(o in u))return!1}return!0};var N=function(n,t,r,e){if(n===t)return 0!==n||1/n===1/t;if(null==n||null==t)return n===t;n instanceof m&&(n=n._wrapped),t instanceof m&&(t=t._wrapped);var u=s.call(n);if(u!==s.call(t))return!1;switch(u){case"[object RegExp]":case"[object String]":return""+n==""+t;case"[object Number]":return+n!==+n?+t!==+t:0===+n?1/+n===1/t:+n===+t;case"[object Date]":case"[object Boolean]":return+n===+t}var i="[object Array]"===u;if(!i){if("object"!=typeof n||"object"!=typeof t)return!1;var o=n.constructor,a=t.constructor;if(o!==a&&!(m.isFunction(o)&&o instanceof o&&m.isFunction(a)&&a instanceof a)&&"constructor"in n&&"constructor"in t)return!1}r=r||[],e=e||[];for(var c=r.length;c--;)if(r[c]===n)return e[c]===t;if(r.push(n),e.push(t),i){if(c=n.length,c!==t.length)return!1;for(;c--;)if(!N(n[c],t[c],r,e))return!1}else{var f,l=m.keys(n);if(c=l.length,m.keys(t).length!==c)return!1;for(;c--;)if(f=l[c],!m.has(t,f)||!N(n[f],t[f],r,e))return!1}return r.pop(),e.pop(),!0};m.isEqual=function(n,t){return N(n,t)},m.isEmpty=function(n){return null==n?!0:k(n)&&(m.isArray(n)||m.isString(n)||m.isArguments(n))?0===n.length:0===m.keys(n).length},m.isElement=function(n){return!(!n||1!==n.nodeType)},m.isArray=h||function(n){return"[object Array]"===s.call(n)},m.isObject=function(n){var t=typeof n;return"function"===t||"object"===t&&!!n},m.each(["Arguments","Function","String","Number","Date","RegExp","Error"],function(n){m["is"+n]=function(t){return s.call(t)==="[object "+n+"]"}}),m.isArguments(arguments)||(m.isArguments=function(n){return m.has(n,"callee")}),"function"!=typeof/./&&"object"!=typeof Int8Array&&(m.isFunction=function(n){return"function"==typeof n||!1}),m.isFinite=function(n){return isFinite(n)&&!isNaN(parseFloat(n))},m.isNaN=function(n){return m.isNumber(n)&&n!==+n},m.isBoolean=function(n){return n===!0||n===!1||"[object Boolean]"===s.call(n)},m.isNull=function(n){return null===n},m.isUndefined=function(n){return n===void 0},m.has=function(n,t){return null!=n&&p.call(n,t)},m.noConflict=function(){return u._=i,this},m.identity=function(n){return n},m.constant=function(n){return function(){return n}},m.noop=function(){},m.property=w,m.propertyOf=function(n){return null==n?function(){}:function(t){return n[t]}},m.matcher=m.matches=function(n){return n=m.extendOwn({},n),function(t){return m.isMatch(t,n)}},m.times=function(n,t,r){var e=Array(Math.max(0,n));t=b(t,r,1);for(var u=0;n>u;u++)e[u]=t(u);return e},m.random=function(n,t){return null==t&&(t=n,n=0),n+Math.floor(Math.random()*(t-n+1))},m.now=Date.now||function(){return(new Date).getTime()};var B={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},T=m.invert(B),R=function(n){var t=function(t){return n[t]},r="(?:"+m.keys(n).join("|")+")",e=RegExp(r),u=RegExp(r,"g");return function(n){return n=null==n?"":""+n,e.test(n)?n.replace(u,t):n}};m.escape=R(B),m.unescape=R(T),m.result=function(n,t,r){var e=null==n?void 0:n[t];return e===void 0&&(e=r),m.isFunction(e)?e.call(n):e};var q=0;m.uniqueId=function(n){var t=++q+"";return n?n+t:t},m.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var K=/(.)^/,z={"'":"'","\\":"\\","\r":"r","\n":"n","\u2028":"u2028","\u2029":"u2029"},D=/\\|'|\r|\n|\u2028|\u2029/g,L=function(n){return"\\"+z[n]};m.template=function(n,t,r){!t&&r&&(t=r),t=m.defaults({},t,m.templateSettings);var e=RegExp([(t.escape||K).source,(t.interpolate||K).source,(t.evaluate||K).source].join("|")+"|$","g"),u=0,i="__p+='";n.replace(e,function(t,r,e,o,a){return i+=n.slice(u,a).replace(D,L),u=a+t.length,r?i+="'+\n((__t=("+r+"))==null?'':_.escape(__t))+\n'":e?i+="'+\n((__t=("+e+"))==null?'':__t)+\n'":o&&(i+="';\n"+o+"\n__p+='"),t}),i+="';\n",t.variable||(i="with(obj||{}){\n"+i+"}\n"),i="var __t,__p='',__j=Array.prototype.join,"+"print=function(){__p+=__j.call(arguments,'');};\n"+i+"return __p;\n";try{var o=new Function(t.variable||"obj","_",i)}catch(a){throw a.source=i,a}var c=function(n){return o.call(this,n,m)},f=t.variable||"obj";return c.source="function("+f+"){\n"+i+"}",c},m.chain=function(n){var t=m(n);return t._chain=!0,t};var P=function(n,t){return n._chain?m(t).chain():t};m.mixin=function(n){m.each(m.functions(n),function(t){var r=m[t]=n[t];m.prototype[t]=function(){var n=[this._wrapped];return f.apply(n,arguments),P(this,r.apply(m,n))}})},m.mixin(m),m.each(["pop","push","reverse","shift","sort","splice","unshift"],function(n){var t=o[n];m.prototype[n]=function(){var r=this._wrapped;return t.apply(r,arguments),"shift"!==n&&"splice"!==n||0!==r.length||delete r[0],P(this,r)}}),m.each(["concat","join","slice"],function(n){var t=o[n];m.prototype[n]=function(){return P(this,t.apply(this._wrapped,arguments))}}),m.prototype.value=function(){return this._wrapped},m.prototype.valueOf=m.prototype.toJSON=m.prototype.value,m.prototype.toString=function(){return""+this._wrapped},"function"==typeof define&&define.amd&&define("underscore",[],function(){return m})}).call(this);
},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzlIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6REE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3Z1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDN1VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN6SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMzUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQ3VzdG9tR2Vub21lIHJlcHJlc2VudHMgYSBnZW5vbWUgc3BlY2lmaWNhdGlvbiB0aGF0IGNhbiBwcm9kdWNlIG9wdGlvbnMgZm9yICQudWkuZ2Vub2Jyb3dzZXIgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKSB7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy91dGlscy91dGlscy5qcycpLFxuICBkZWVwQ2xvbmUgPSB1dGlscy5kZWVwQ2xvbmUsXG4gIGxvZzEwID0gdXRpbHMubG9nMTAsXG4gIHJvdW5kVG9QbGFjZXMgPSB1dGlscy5yb3VuZFRvUGxhY2VzO1xuXG5mdW5jdGlvbiBDdXN0b21HZW5vbWUoZ2l2ZW5Gb3JtYXQsIG1ldGFkYXRhKSB7ICAgIFxuICAvLyBnaXZlbkZvcm1hdCA9IGZhbHNlIC0tPiB0aGlzIGlzIGFuIGVtcHR5IEN1c3RvbUdlbm9tZSB0aGF0IHdpbGwgYmUgaHlkcmF0ZWQgd2l0aCB2YWx1ZXMgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0XG4gIGlmIChnaXZlbkZvcm1hdCA9PT0gZmFsc2UpIHsgcmV0dXJuOyB9IFxuICBcbiAgdGhpcy5fcGFyc2VkID0gZmFsc2U7XG4gIHRoaXMuX2Zvcm1hdCA9IChnaXZlbkZvcm1hdCAmJiBnaXZlbkZvcm1hdC50b0xvd2VyQ2FzZSgpKSB8fCBcImNocm9tc2l6ZXNcIjtcbiAgdmFyIGZvcm1hdCA9IHRoaXMuZm9ybWF0KCk7XG4gIGlmIChmb3JtYXQgPT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZ2Vub21lIGZvcm1hdCAnXCIrZm9ybWF0K1wiJyBlbmNvdW50ZXJlZFwiKTsgfVxuICBcbiAgLy8gdGhpcy5vcHRzIGhvbGRzIGV2ZXJ5dGhpbmcgdGhhdCAkLnVpLmdlbm9icm93c2VyIHdpbGwgbmVlZCB0byBjb25zdHJ1Y3QgYSB2aWV3IChzZWUgQ3VzdG9tR2Vub21lLmRlZmF1bHRzIGJlbG93KVxuICAvLyBpdCBET0VTIE5PVCByZWxhdGUgdG8gXCJvcHRpb25zXCIgZm9yIHBhcnNpbmcsIG9yIGhvdyB0aGUgZ2Vub21lIGlzIGJlaW5nIGludGVycHJldGVkLCBvciBhbnl0aGluZyBsaWtlIHRoYXRcbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIGRlZXBDbG9uZSh0aGlzLmNvbnN0cnVjdG9yLmRlZmF1bHRzKSwgZGVlcENsb25lKGZvcm1hdC5kZWZhdWx0cyB8fCB7fSkpO1xuICBcbiAgLy8gdGhpcy5tZXRhZGF0YSBob2xkcyBpbmZvcm1hdGlvbiBleHRlcm5hbCB0byB0aGUgcGFyc2VkIHRleHQgcGFzc2VkIGluIGZyb20gdGhlIGJyb3dzZXIgKGUuZy4gZmlsZW5hbWUsIHNvdXJjZSlcbiAgdGhpcy5tZXRhZGF0YSA9IG1ldGFkYXRhO1xuICBcbiAgLy8gdGhpcy5kYXRhIGhvbGRzIGFueXRoaW5nIGFkZGl0aW9uYWxseSBwYXJzZWQgZnJvbSB0aGUgZ2Vub21lIGZpbGUgKG1ldGFkYXRhLCByZWZlcmVuY2VzLCBldGMuKVxuICAvLyB0eXBpY2FsbHkgdGhpcyBpcyBhcnJhbmdlZCBwZXIgY29udGlnLCBpbiB0aGUgYXJyYW5nZW1lbnQgb2YgdGhpcy5kYXRhLmNvbnRpZ3NbaV0uIC4uLlxuICB0aGlzLmRhdGEgPSB7XG4gICAgc2VxdWVuY2U6IFwiXCIgLy8gdGhlIGZ1bGwgY29uY2F0ZW5hdGVkIHNlcXVlbmNlIGZvciBhbGwgY29udGlncyBpbiB0aGlzIGdlbm9tZSwgaWYgYXZhaWxhYmxlXG4gIH07XG4gIFxuICAvLyBjYW4gd2UgY2FsbCAuZ2V0U2VxdWVuY2Ugb24gdGhpcyBDdXN0b21HZW5vbWU/XG4gIHRoaXMuY2FuR2V0U2VxdWVuY2UgPSBmYWxzZTtcbiAgXG4gIGlmKGZvcm1hdC5pbml0KSB7IGZvcm1hdC5pbml0LmNhbGwodGhpcyk7IH1cbn1cblxuQ3VzdG9tR2Vub21lLmRlZmF1bHRzID0ge1xuICAvLyBUaGUgZm9sbG93aW5nIGtleXMgc2hvdWxkIGJlIG92ZXJyaWRkZW4gd2hpbGUgcGFyc2luZyB0aGUgZ2Vub21lIGZpbGVcbiAgZ2Vub21lOiAnX2JsYW5rJyxcbiAgc3BlY2llczogJ0JsYW5rIEdlbm9tZScsXG4gIGFzc2VtYmx5RGF0ZTogJycsXG4gIHRpbGVEaXI6IG51bGwsXG4gIG92ZXJ6b29tQnBwcHM6IFtdLFxuICBudHNCZWxvdzogWzEsIDAuMV0sXG4gIGF2YWlsVHJhY2tzOiBbXG4gICAge1xuICAgICAgZmg6IHt9LCAgICAgICAgLy8gXCJmaXhlZCBoZWlnaHRzXCIgYWJvdmUgd2hpY2ggYSBkZW5zaXR5IGlzIGZvcmNlZCB0byBkaXNwbGF5IGFib3ZlIGEgY2VydGFpbiB0cmFjayBoZWlnaHRcbiAgICAgICAgICAgICAgICAgICAgIC8vICAgIGZvcm1hdHRlZCBsaWtlIHtcIjEuMDBlKzA1XCI6e1wiZGVuc2VcIjoxNX19XG4gICAgICBuOiBcInJ1bGVyXCIsICAgIC8vIHNob3J0IHVuaXF1ZSBuYW1lIGZvciB0aGUgdHJhY2tcbiAgICAgIHM6IFtcImRlbnNlXCJdLCAgLy8gcG9zc2libGUgZGVuc2l0aWVzIGZvciB0aWxlcywgZS5nLiBbXCJkZW5zZVwiLCBcInNxdWlzaFwiLCBcInBhY2tcIl1cbiAgICAgIGg6IDI1ICAgICAgICAgIC8vIHN0YXJ0aW5nIGhlaWdodCBpbiBweFxuICAgIH1cbiAgXSxcbiAgZ2Vub21lU2l6ZTogMCxcbiAgY2hyTGVuZ3Roczoge30sXG4gIGNock9yZGVyOiBbXSxcbiAgY2hyQmFuZHM6IG51bGwsXG4gIHRpbGVXaWR0aDogMTAwMCxcbiAgc3ViZGlyRm9yQnBwcHNVbmRlcjogMzMwLFxuICBpZGVvZ3JhbXNBYm92ZTogMTAwMCxcbiAgbWF4TnRSZXF1ZXN0OiAyMDAwMCxcbiAgdHJhY2tzOiBbe246IFwicnVsZXJcIn1dLFxuICB0cmFja0Rlc2M6IHtcbiAgICBydWxlcjoge1xuICAgICAgY2F0OiBcIk1hcHBpbmcgYW5kIFNlcXVlbmNpbmcgVHJhY2tzXCIsXG4gICAgICBzbTogXCJCYXNlIFBvc2l0aW9uXCJcbiAgICB9XG4gIH0sXG4gIC8vIFRoZXNlIGxhc3QgdGhyZWUgd2lsbCBiZSBvdmVycmlkZGVuIHVzaW5nIGtub3dsZWRnZSBvZiB0aGUgd2luZG93J3Mgd2lkdGhcbiAgYnBwcHM6IFtdLFxuICBicHBwTnVtYmVyc0JlbG93OiBbXSxcbiAgaW5pdFpvb206IG51bGxcbn07XG5cbkN1c3RvbUdlbm9tZS5mb3JtYXRzID0ge1xuICBjaHJvbXNpemVzOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2Nocm9tc2l6ZXMuanMnKSxcbiAgZmFzdGE6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvZmFzdGEuanMnKSxcbiAgZ2VuYmFuazogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9nZW5iYW5rLmpzJyksXG4gIGVtYmw6IG51bGwgLy8gVE9ETy4gQmFzaWNhbGx5IGdlbmJhbmsgd2l0aCBleHRyYSBjb2x1bW5zLlxufVxuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnBhcnNlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9ybWF0KCkucGFyc2UuYXBwbHkodGhpcywgXy50b0FycmF5KGFyZ3VtZW50cykpO1xuICB0aGlzLnNldEdlbm9tZVN0cmluZygpO1xuICB0aGlzLl9wYXJzZWQgPSB0cnVlO1xufTtcblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5mb3JtYXQgPSBmdW5jdGlvbihmb3JtYXQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc1VuZGVmaW5lZChmb3JtYXQpKSB7IGZvcm1hdCA9IHNlbGYuX2Zvcm1hdDsgfVxuICB2YXIgRm9ybWF0V3JhcHBlciA9IGZ1bmN0aW9uKCkgeyBfLmV4dGVuZCh0aGlzLCBzZWxmLmNvbnN0cnVjdG9yLmZvcm1hdHNbZm9ybWF0XSk7IHJldHVybiB0aGlzOyB9O1xuICBGb3JtYXRXcmFwcGVyLnByb3RvdHlwZSA9IHNlbGY7XG4gIHJldHVybiBuZXcgRm9ybWF0V3JhcHBlcigpO1xufTtcblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5zZXRHZW5vbWVTdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNlbGYgPSB0aGlzLFxuICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgZXhjZXB0aW9ucyA9IFsnZmlsZScsICdpZ2InLCAnYWNjJywgJ3VybCcsICd1Y3NjJ10sXG4gICAgZXhjZXB0aW9uID0gXy5maW5kKGV4Y2VwdGlvbnMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuICFfLmlzVW5kZWZpbmVkKHNlbGYubWV0YWRhdGFbdl0pOyB9KSxcbiAgICBwaWVjZXMgPSBbXTtcbiAgaWYgKGV4Y2VwdGlvbikgeyBvLmdlbm9tZSA9IGV4Y2VwdGlvbiArIFwiOlwiICsgc2VsZi5tZXRhZGF0YVtleGNlcHRpb25dOyB9XG4gIGVsc2Uge1xuICAgIHBpZWNlcyA9IFsnY3VzdG9tJyArIChzZWxmLm1ldGFkYXRhLm5hbWUgPyAnOicgKyBzZWxmLm1ldGFkYXRhLm5hbWUgOiAnJyldO1xuICAgIF8uZWFjaChvLmNock9yZGVyLCBmdW5jdGlvbihjaHIpIHtcbiAgICAgIHBpZWNlcy5wdXNoKGNociArICc6JyArIG8uY2hyTGVuZ3Roc1tjaHJdKTtcbiAgICB9KTtcbiAgICBvLmdlbm9tZSA9IHBpZWNlcy5qb2luKCd8Jyk7XG4gIH1cbn07XG5cbi8vIFNvbWUgb2YgdGhlIG9wdGlvbnMgZm9yICQudWkuZ2Vub2Jyb3dzZXIgKGFsbCByL3Qgem9vbSBsZXZlbHMpIG11c3QgYmUgc2V0IGJhc2VkIG9uIHRoZSB3aWR0aCBvZiB0aGUgd2luZG93XG4vLyAgIFRoZXkgYXJlIC5icHBwcywgLmJwcHBOdW1iZXJzQmVsb3csIGFuZCAuaW5pdFpvb21cbi8vICAgVGhleSBkbyBub3QgYWZmZWN0IGFueSBvZiB0aGUgb3RoZXIgb3B0aW9ucyBzZXQgZHVyaW5nIHBhcnNpbmcuXG4vL1xuLy8gd2luZG93T3B0cyBNVVNUIGluY2x1ZGUgYSBwcm9wZXJ0eSwgLndpZHRoLCB0aGF0IGlzIHRoZSB3aW5kb3cuaW5uZXJXaWR0aFxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5zZXRCcHBwcyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgd2luZG93T3B0cyA9IHdpbmRvd09wdHMgfHwge307XG4gIFxuICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICB3aW5kb3dXaWR0aCA9ICh3aW5kb3dPcHRzLndpZHRoICogMC42KSB8fCAxMDAwLFxuICAgIGJwcHAgPSBNYXRoLnJvdW5kKG8uZ2Vub21lU2l6ZSAvIHdpbmRvd1dpZHRoKSxcbiAgICBsb3dlc3RCcHBwID0gd2luZG93T3B0cy5sb3dlc3RCcHBwIHx8IDAuMSxcbiAgICBtYXhCcHBwcyA9IDEwMCxcbiAgICBicHBwcyA9IFtdLCBpID0gMCwgbG9nO1xuICBcbiAgLy8gY29tcGFyYWJsZSB0byBwYXJ0IG9mIFVDU0NDbGllbnQjbWFrZV9jb25maWcgaW4gbGliL3Vjc2Nfc3RpdGNoLnJiXG4gIHdoaWxlIChicHBwID49IGxvd2VzdEJwcHAgJiYgaSA8IG1heEJwcHBzKSB7XG4gICAgYnBwcHMucHVzaChicHBwKTtcbiAgICBsb2cgPSByb3VuZFRvUGxhY2VzKGxvZzEwKGJwcHApLCA0KTtcbiAgICBicHBwID0gKE1hdGguY2VpbChsb2cpIC0gbG9nIDwgMC40ODEpID8gMy4zICogTWF0aC5wb3coMTAsIE1hdGguY2VpbChsb2cpIC0gMSkgOiBNYXRoLnBvdygxMCwgTWF0aC5mbG9vcihsb2cpKTtcbiAgICBpKys7XG4gIH1cbiAgby5icHBwcyA9IGJwcHBzO1xuICBvLmJwcHBOdW1iZXJzQmVsb3cgPSBicHBwcy5zbGljZSgwLCAyKTtcbiAgby5pbml0Wm9vbSA9IGJwcHBzWzBdO1xufTtcblxuLy8gQ29uc3RydWN0IGEgY29tcGxldGUgY29uZmlndXJhdGlvbiBmb3IgJC51aS5nZW5vYnJvd3NlciBiYXNlZCBvbiB0aGUgaW5mb3JtYXRpb24gcGFyc2VkIGZyb20gdGhlIGdlbm9tZSBmaWxlXG4vLyB3aGljaCBzaG91bGQgYmUgbW9zdGx5IGluIHRoaXMub3B0cywgZXhjZXB0aW5nIHRob3NlIHJlbGF0ZWQgdG8gem9vbSBsZXZlbHMsIHdoaWNoIGNhbiBiZSBzZXQgbm93LlxuLy8gKHNlZSBDdXN0b21HZW5vbWUuZGVmYXVsdHMgYWJvdmUgZm9yIHdoYXQgYSBiYXNlIGNvbmZpZ3VyYXRpb24gbG9va3MgbGlrZSlcbi8vXG4vLyB3aW5kb3dPcHRzIE1VU1QgaW5jbHVkZSBpbmNsdWRlIHRoZSBwcm9wZXJ0eSAud2lkdGggd2hpY2ggaXMgdGhlIHdpbmRvdy5pbm5lcldpZHRoXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLm9wdGlvbnMgPSBmdW5jdGlvbih3aW5kb3dPcHRzKSB7XG4gIGlmICghdGhpcy5fcGFyc2VkKSB7IHRocm93IFwiQ2Fubm90IGdlbmVyYXRlIG9wdGlvbnMgYmVmb3JlIHBhcnNpbmcgdGhlIGdlbm9tZSBmaWxlXCI7IH1cbiAgdGhpcy5zZXRCcHBwcyh3aW5kb3dPcHRzKTtcbiAgdGhpcy5vcHRzLmN1c3RvbSA9IHRoaXM7ICAgLy8gc2FtZSBjb252ZW50aW9uIGFzIGN1c3RvbSB0cmFja3MgaW4gc2VsZi5hdmFpbFRyYWNrcyBpbiBjaHJvbW96b29tLmpzXG4gIHJldHVybiB0aGlzLm9wdHM7XG59O1xuXG4vLyBGZXRjaCB0aGUgc2VxdWVuY2UsIGlmIGF2YWlsYWJsZSwgYmV0d2VlbiBsZWZ0IGFuZCByaWdodCwgYW5kIG9wdGlvbmFsbHkgcGFzcyBpdCB0byB0aGUgY2FsbGJhY2suXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlID0gZnVuY3Rpb24obGVmdCwgcmlnaHQsIGNhbGxiYWNrKSB7XG4gIHZhciBzZXEgPSB0aGlzLmRhdGEuc2VxdWVuY2Uuc3Vic3RyaW5nKGxlZnQgLSAxLCByaWdodCAtIDEpO1xuICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKHNlcSkgOiBzZXE7IFxufTtcblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5nZXRTZXF1ZW5jZUFzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21HZW5vbWVzLmFzeW5jKHRoaXMsICdnZXRTZXF1ZW5jZScsIGFyZ3VtZW50cywgW3RoaXMuaWRdKTtcbn07XG5cbnJldHVybiBDdXN0b21HZW5vbWU7XG5cbn07IiwidmFyIGdsb2JhbCA9IHNlbGY7ICAvLyBncmFiIGdsb2JhbCBzY29sZSBmb3IgV2ViIFdvcmtlcnNcbnJlcXVpcmUoJy4vanF1ZXJ5Lm5vZG9tLm1pbi5qcycpKGdsb2JhbCk7XG5nbG9iYWwuXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5yZXF1aXJlKCcuL0N1c3RvbUdlbm9tZXMuanMnKShnbG9iYWwpO1xuXG5pZiAoIWdsb2JhbC5jb25zb2xlIHx8ICFnbG9iYWwuY29uc29sZS5sb2cpIHtcbiAgZ2xvYmFsLmNvbnNvbGUgPSBnbG9iYWwuY29uc29sZSB8fCB7fTtcbiAgZ2xvYmFsLmNvbnNvbGUubG9nID0gZnVuY3Rpb24oKSB7XG4gICAgZ2xvYmFsLnBvc3RNZXNzYWdlKHtsb2c6IEpTT04uc3RyaW5naWZ5KF8udG9BcnJheShhcmd1bWVudHMpKX0pO1xuICB9O1xufVxuXG52YXIgQ3VzdG9tR2Vub21lV29ya2VyID0ge1xuICBfZ2Vub21lczogW10sXG4gIF90aHJvd0Vycm9yczogZmFsc2UsXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0LCBtZXRhZGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGdlbm9tZSA9IEN1c3RvbUdlbm9tZXMucGFyc2UodGV4dCwgbWV0YWRhdGEpLFxuICAgICAgc2VyaWFsaXphYmxlO1xuICAgIFxuICAgIC8vIHdlIHdhbnQgdG8ga2VlcCB0aGUgZ2Vub21lIG9iamVjdCBpbiBvdXIgcHJpdmF0ZSBzdG9yZSwgYW5kIGRlbGV0ZSB0aGUgZGF0YSBmcm9tIHRoZSBjb3B5IHRoYXRcbiAgICAvLyBpcyBzZW50IGJhY2sgb3ZlciB0aGUgZmVuY2UsIHNpbmNlIGl0IGlzIGV4cGVuc2l2ZS9pbXBvc3NpYmxlIHRvIHNlcmlhbGl6ZVxuICAgIGdlbm9tZS5pZCA9IHNlbGYuX2dlbm9tZXMucHVzaChnZW5vbWUpIC0gMTtcbiAgICBcbiAgICBzZXJpYWxpemFibGUgPSBfLmV4dGVuZCh7fSwgZ2Vub21lKTtcbiAgICBkZWxldGUgc2VyaWFsaXphYmxlLmRhdGE7XG4gICAgcmV0dXJuIHNlcmlhbGl6YWJsZTtcbiAgfSxcbiAgb3B0aW9uczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBfLnRvQXJyYXkoYXJndW1lbnRzKSxcbiAgICAgIGlkID0gXy5maXJzdChhcmdzKSxcbiAgICAgIGdlbm9tZSA9IHRoaXMuX2dlbm9tZXNbaWRdO1xuICAgIHJldHVybiBnZW5vbWUub3B0aW9ucy5hcHBseShnZW5vbWUsIF8ucmVzdChhcmdzKSk7XG4gIH0sXG4gIGdldFNlcXVlbmNlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgZ2Vub21lID0gdGhpcy5fZ2Vub21lc1tpZF07XG4gICAgcmV0dXJuIGdlbm9tZS5nZXRTZXF1ZW5jZS5hcHBseShnZW5vbWUsIF8ucmVzdChhcmdzKSk7XG4gIH0sXG4gIHRocm93RXJyb3JzOiBmdW5jdGlvbih0b2dnbGUpIHtcbiAgICB0aGlzLl90aHJvd0Vycm9ycyA9IHRvZ2dsZTtcbiAgfVxufTtcblxuZ2xvYmFsLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihlKSB7XG4gIHZhciBkYXRhID0gZS5kYXRhLFxuICAgIGNhbGxiYWNrID0gZnVuY3Rpb24ocikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCByZXQ6IEpTT04uc3RyaW5naWZ5KHIgfHwgbnVsbCl9KTsgfSxcbiAgICByZXQ7XG5cbiAgaWYgKEN1c3RvbUdlbm9tZVdvcmtlci5fdGhyb3dFcnJvcnMpIHtcbiAgICByZXQgPSBDdXN0b21HZW5vbWVXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tR2Vub21lV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7XG4gIH0gZWxzZSB7XG4gICAgdHJ5IHsgcmV0ID0gQ3VzdG9tR2Vub21lV29ya2VyW2RhdGEub3BdLmFwcGx5KEN1c3RvbUdlbm9tZVdvcmtlciwgZGF0YS5hcmdzLmNvbmNhdChjYWxsYmFjaykpOyB9IFxuICAgIGNhdGNoIChlcnIpIHsgZ2xvYmFsLnBvc3RNZXNzYWdlKHtpZDogZGF0YS5pZCwgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHttZXNzYWdlOiBlcnIubWVzc2FnZX0pfSk7IH1cbiAgfVxuICBcbiAgaWYgKCFfLmlzVW5kZWZpbmVkKHJldCkpIHsgY2FsbGJhY2socmV0KTsgfVxufSk7IiwibW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24oZ2xvYmFsKXtcbiAgXG4gIHZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbiAgaWYgKCFnbG9iYWwuQ3VzdG9tVHJhY2tzKSB7IHJlcXVpcmUoJy4vQ3VzdG9tVHJhY2tzLmpzJykoZ2xvYmFsKTsgfVxuICBcbiAgLy8gVGhlIGNsYXNzIHRoYXQgcmVwcmVzZW50cyBhIHNpbmd1bGFyIGN1c3RvbSBnZW5vbWUgb2JqZWN0XG4gIHZhciBDdXN0b21HZW5vbWUgPSByZXF1aXJlKCcuL0N1c3RvbUdlbm9tZScpKGdsb2JhbCk7XG4gIFxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vID0gQ3VzdG9tR2Vub21lcywgdGhlIG1vZHVsZSBleHBvcnRlZCB0byB0aGUgZ2xvYmFsIGVudmlyb25tZW50ID1cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBCcm9hZGx5IHNwZWFraW5nIHRoaXMgaXMgYSBmYWN0b3J5IGZvciBDdXN0b21HZW5vbWUgb2JqZWN0cyB0aGF0IGNhbiBkZWxlZ2F0ZSB0aGVcbiAgLy8gd29yayBvZiBwYXJzaW5nIHRvIGEgV2ViIFdvcmtlciB0aHJlYWQuXG4gIFxuICB2YXIgQ3VzdG9tR2Vub21lcyA9IHtcbiAgICBwYXJzZTogZnVuY3Rpb24odGV4dCwgbWV0YWRhdGEpIHtcbiAgICAgIG1ldGFkYXRhID0gbWV0YWRhdGEgfHwge307XG4gICAgICBpZiAoIW1ldGFkYXRhLmZvcm1hdCkgeyBtZXRhZGF0YS5mb3JtYXQgPSB0aGlzLmd1ZXNzRm9ybWF0KHRleHQpOyB9XG4gICAgICB2YXIgZ2Vub21lID0gbmV3IEN1c3RvbUdlbm9tZShtZXRhZGF0YS5mb3JtYXQsIG1ldGFkYXRhKTtcbiAgICAgIGdlbm9tZS5wYXJzZSh0ZXh0KTtcbiAgICAgIHJldHVybiBnZW5vbWU7XG4gICAgfSxcbiAgICBcbiAgICBibGFuazogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZ2Vub21lID0gbmV3IEN1c3RvbUdlbm9tZShcImNocm9tc2l6ZXNcIiwge3NwZWNpZXM6IFwiQmxhbmsgR2Vub21lXCJ9KTtcbiAgICAgIGdlbm9tZS5wYXJzZShcImJsYW5rXFx0NTAwMDBcIik7XG4gICAgICByZXR1cm4gZ2Vub21lO1xuICAgIH0sXG4gICAgXG4gICAgZ3Vlc3NGb3JtYXQ6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICAgIGlmICh0ZXh0LnN1YnN0cmluZygwLCA1KSA9PSAnTE9DVVMnKSB7IHJldHVybiBcImdlbmJhbmtcIjsgfVxuICAgICAgaWYgKC9eW0EtWl17Mn0gezN9Ly50ZXN0KHRleHQpKSB7IHJldHVybiBcImVtYmxcIjsgfVxuICAgICAgaWYgKC9eWz47XS8udGVzdCh0ZXh0KSkgeyByZXR1cm4gXCJmYXN0YVwiOyB9XG4gICAgICAvLyBkZWZhdWx0IGlzIGZhc3RhXG4gICAgICByZXR1cm4gXCJmYXN0YVwiO1xuICAgIH0sXG4gICAgXG4gICAgZXJyb3I6IGZ1bmN0aW9uKGUpIHtcbiAgICAgIC8vIENhbiBiZSBvdmVycmlkZGVuIGJ5IGEgcGFyZW50IGxpYnJhcnkgdG8gaGFuZGxlIGVycm9ycyBtb3JlIGdyYWNlZnVsbHkuXG4gICAgICBjb25zb2xlLmxvZyhlKTtcbiAgICB9LFxuICAgIFxuICAgIF93b3JrZXJTY3JpcHQ6ICdidWlsZC9DdXN0b21HZW5vbWVXb3JrZXIuanMnLFxuICAgIF9kaXNhYmxlV29ya2VyczogZmFsc2UsXG4gICAgd29ya2VyOiBnbG9iYWwuQ3VzdG9tVHJhY2tzLndvcmtlcixcbiAgICBcbiAgICBhc3luYzogZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyxcbiAgICBcbiAgICBwYXJzZUFzeW5jOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuYXN5bmModGhpcywgJ3BhcnNlJywgYXJndW1lbnRzLCBbXSwgZnVuY3Rpb24oZ2Vub21lKSB7XG4gICAgICAgIC8vIFRoaXMgaGFzIGJlZW4gc2VyaWFsaXplZCwgc28gaXQgbXVzdCBiZSBoeWRyYXRlZCBpbnRvIGEgcmVhbCBDdXN0b21HZW5vbWUgb2JqZWN0LlxuICAgICAgICAvLyBXZSByZXBsYWNlIC5nZXRTZXF1ZW5jZSgpIHdpdGggYW4gYXN5bmNocm9ub3VzIHZlcnNpb24uXG4gICAgICAgIHJldHVybiBfLmV4dGVuZChuZXcgQ3VzdG9tR2Vub21lKGZhbHNlKSwgZ2Vub21lLCB7XG4gICAgICAgICAgZ2V0U2VxdWVuY2U6IGZ1bmN0aW9uKCkgeyBDdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlQXN5bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcbiAgXG4gIGdsb2JhbC5DdXN0b21HZW5vbWVzID0gQ3VzdG9tR2Vub21lcztcbiAgXG59KTsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBDdXN0b21UcmFjaywgYW4gb2JqZWN0IHJlcHJlc2VudGluZyBhIGN1c3RvbSB0cmFjayBhcyB1bmRlcnN0b29kIGJ5IFVDU0MuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gVGhpcyBjbGFzcyAqZG9lcyogZGVwZW5kIG9uIGdsb2JhbCBvYmplY3RzIGFuZCB0aGVyZWZvcmUgbXVzdCBiZSByZXF1aXJlZCBhcyBhIFxuLy8gZnVuY3Rpb24gdGhhdCBpcyBleGVjdXRlZCBvbiB0aGUgZ2xvYmFsIG9iamVjdC5cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpIHtcblxudmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG5mdW5jdGlvbiBDdXN0b21UcmFjayhvcHRzLCBicm93c2VyT3B0cykge1xuICBpZiAoIW9wdHMpIHsgcmV0dXJuOyB9IC8vIFRoaXMgaXMgYW4gZW1wdHkgY3VzdG9tVHJhY2sgdGhhdCB3aWxsIGJlIGh5ZHJhdGVkIHdpdGggdmFsdWVzIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdFxuICB0aGlzLl90eXBlID0gKG9wdHMudHlwZSAmJiBvcHRzLnR5cGUudG9Mb3dlckNhc2UoKSkgfHwgXCJiZWRcIjtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgaWYgKHR5cGUgPT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgdHJhY2sgdHlwZSAnXCIrb3B0cy50eXBlK1wiJyBlbmNvdW50ZXJlZCBvbiBsaW5lIFwiICsgb3B0cy5saW5lTnVtKTsgfVxuICB0aGlzLm9wdHMgPSBfLmV4dGVuZCh7fSwgdGhpcy5jb25zdHJ1Y3Rvci5kZWZhdWx0cywgdHlwZS5kZWZhdWx0cyB8fCB7fSwgb3B0cyk7XG4gIF8uZXh0ZW5kKHRoaXMsIHtcbiAgICBicm93c2VyT3B0czogYnJvd3Nlck9wdHMsXG4gICAgc3RyZXRjaEhlaWdodDogZmFsc2UsXG4gICAgaGVpZ2h0czoge30sXG4gICAgc2l6ZXM6IFsnZGVuc2UnXSxcbiAgICBtYXBTaXplczogW10sXG4gICAgYXJlYXM6IHt9LFxuICAgIG5vQXJlYUxhYmVsczogZmFsc2UsXG4gICAgZXhwZWN0c1NlcXVlbmNlOiBmYWxzZVxuICB9KTtcbiAgdGhpcy5pbml0KCk7XG59XG5cbkN1c3RvbVRyYWNrLmRlZmF1bHRzID0ge1xuICBuYW1lOiAnVXNlciBUcmFjaycsXG4gIGRlc2NyaXB0aW9uOiAnVXNlciBTdXBwbGllZCBUcmFjaycsXG4gIGNvbG9yOiAnMCwwLDAnXG59O1xuXG5DdXN0b21UcmFjay50eXBlcyA9IHtcbiAgYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZC5qcycpLFxuICBmZWF0dXJldGFibGU6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzJyksXG4gIGJlZGdyYXBoOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzJyksXG4gIHdpZ2dsZV8wOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3dpZ2dsZV8wLmpzJyksXG4gIHZjZnRhYml4OiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3ZjZnRhYml4LmpzJyksXG4gIGJpZ2JlZDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWdiZWQuanMnKSxcbiAgYmFtOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JhbS5qcycpLFxuICBiaWd3aWc6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnd2lnLmpzJylcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJlZERldGFpbCBmb3JtYXQ6IGh0dHBzOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxLjcgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gIFxuXG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwgPSBfLmNsb25lKEN1c3RvbVRyYWNrLnR5cGVzLmJlZCk7XG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMgPSBfLmV4dGVuZCh7fSwgQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsLmRlZmF1bHRzLCB7ZGV0YWlsOiB0cnVlfSk7XG5cbi8vIFRoZXNlIGZ1bmN0aW9ucyBicmFuY2ggdG8gZGlmZmVyZW50IG1ldGhvZHMgZGVwZW5kaW5nIG9uIHRoZSAudHlwZSgpIG9mIHRoZSB0cmFja1xuXy5lYWNoKFsnaW5pdCcsICdwYXJzZScsICdyZW5kZXInLCAncmVuZGVyU2VxdWVuY2UnLCAncHJlcmVuZGVyJ10sIGZ1bmN0aW9uKGZuKSB7XG4gIEN1c3RvbVRyYWNrLnByb3RvdHlwZVtmbl0gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgdHlwZSA9IHRoaXMudHlwZSgpO1xuICAgIGlmICghdHlwZVtmbl0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgcmV0dXJuIHR5cGVbZm5dLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG59KTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmxvYWRPcHRzID0gZnVuY3Rpb24oJGRpYWxvZykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpLFxuICAgIG8gPSB0aGlzLm9wdHM7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0nKS5oaWRlKCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0uJyt0aGlzLl90eXBlKS5zaG93KCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1uYW1lJykudGV4dChvLm5hbWUpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tZGVzYycpLnRleHQoby5kZXNjcmlwdGlvbik7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1mb3JtYXQnKS50ZXh0KHRoaXMuX3R5cGUpO1xuICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yXScpLnZhbChvLmNvbG9yKS5jaGFuZ2UoKTtcbiAgaWYgKHR5cGUubG9hZE9wdHMpIHsgdHlwZS5sb2FkT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gICRkaWFsb2cuZmluZCgnLmVuYWJsZXInKS5jaGFuZ2UoKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zYXZlT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICBvLmNvbG9yID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoKTtcbiAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5jb2xvcikpIHsgby5jb2xvciA9ICcwLDAsMCc7IH1cbiAgaWYgKHR5cGUuc2F2ZU9wdHMpIHsgdHlwZS5zYXZlT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gIHRoaXMuYXBwbHlPcHRzKCk7XG4gIGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkgJiYgdGhpcy5hcHBseU9wdHNBc3luYygpOyAvLyBBcHBseSB0aGUgY2hhbmdlcyB0byB0aGUgd29ya2VyIHRvbyFcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hcHBseU9wdHMgPSBmdW5jdGlvbihvcHRzKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmIChvcHRzKSB7IHRoaXMub3B0cyA9IG9wdHM7IH1cbiAgaWYgKHR5cGUuYXBwbHlPcHRzKSB7IHR5cGUuYXBwbHlPcHRzLmNhbGwodGhpcyk7IH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5lcmFzZSA9IGZ1bmN0aW9uKGNhbnZhcykge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gIGlmIChjdHgpIHsgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpOyB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAoXy5pc1VuZGVmaW5lZCh0eXBlKSkgeyB0eXBlID0gdGhpcy5fdHlwZTsgfVxuICByZXR1cm4gdGhpcy5jb25zdHJ1Y3Rvci50eXBlc1t0eXBlXSB8fCBudWxsO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLndhcm4gPSBmdW5jdGlvbih3YXJuaW5nKSB7XG4gIGlmICh0aGlzLm9wdHMuc3RyaWN0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHdhcm5pbmcpO1xuICB9IGVsc2Uge1xuICAgIGlmICghdGhpcy53YXJuaW5ncykgeyB0aGlzLndhcm5pbmdzID0gW107IH1cbiAgICB0aGlzLndhcm5pbmdzLnB1c2god2FybmluZyk7XG4gIH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5pc09uID0gZnVuY3Rpb24odmFsKSB7XG4gIHJldHVybiAvXihvbnx5ZXN8dHJ1ZXx0fHl8MSkkL2kudGVzdCh2YWwudG9TdHJpbmcoKSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyTGlzdCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuX2Nockxpc3QpIHtcbiAgICB0aGlzLl9jaHJMaXN0ID0gXy5zb3J0QnkoXy5tYXAodGhpcy5icm93c2VyT3B0cy5jaHJQb3MsIGZ1bmN0aW9uKHBvcywgY2hyKSB7IHJldHVybiBbcG9zLCBjaHJdOyB9KSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2Nockxpc3Q7XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJBdCA9IGZ1bmN0aW9uKHBvcykge1xuICB2YXIgY2hyTGlzdCA9IHRoaXMuY2hyTGlzdCgpLFxuICAgIGNockluZGV4ID0gXy5zb3J0ZWRJbmRleChjaHJMaXN0LCBbcG9zXSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSksXG4gICAgY2hyID0gY2hySW5kZXggPiAwID8gY2hyTGlzdFtjaHJJbmRleCAtIDFdWzFdIDogbnVsbDtcbiAgcmV0dXJuIHtpOiBjaHJJbmRleCAtIDEsIGM6IGNociwgcDogcG9zIC0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyXX07XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyUmFuZ2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHZhciBjaHJMZW5ndGhzID0gdGhpcy5icm93c2VyT3B0cy5jaHJMZW5ndGhzLFxuICAgIHN0YXJ0Q2hyID0gdGhpcy5jaHJBdChzdGFydCksXG4gICAgZW5kQ2hyID0gdGhpcy5jaHJBdChlbmQpLFxuICAgIHJhbmdlO1xuICBpZiAoc3RhcnRDaHIuYyAmJiBzdGFydENoci5pID09PSBlbmRDaHIuaSkgeyByZXR1cm4gW3N0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgZW5kQ2hyLnBdOyB9XG4gIGVsc2Uge1xuICAgIHJhbmdlID0gXy5tYXAodGhpcy5jaHJMaXN0KCkuc2xpY2Uoc3RhcnRDaHIuaSArIDEsIGVuZENoci5pKSwgZnVuY3Rpb24odikge1xuICAgICAgcmV0dXJuIHZbMV0gKyAnOjEtJyArIGNockxlbmd0aHNbdlsxXV07XG4gICAgfSk7XG4gICAgc3RhcnRDaHIuYyAmJiByYW5nZS51bnNoaWZ0KHN0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgY2hyTGVuZ3Roc1tzdGFydENoci5jXSk7XG4gICAgZW5kQ2hyLmMgJiYgcmFuZ2UucHVzaChlbmRDaHIuYyArICc6MS0nICsgZW5kQ2hyLnApO1xuICAgIHJldHVybiByYW5nZTtcbiAgfVxufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucHJlcmVuZGVyQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAncHJlcmVuZGVyJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0c0FzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ2FwcGx5T3B0cycsIFt0aGlzLm9wdHMsIGZ1bmN0aW9uKCl7fV0sIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYWpheERpciA9IGZ1bmN0aW9uKCkge1xuICAvLyBXZWIgV29ya2VycyBmZXRjaCBVUkxzIHJlbGF0aXZlIHRvIHRoZSBKUyBmaWxlIGl0c2VsZi5cbiAgcmV0dXJuIChnbG9iYWwuSFRNTERvY3VtZW50ID8gJycgOiAnLi4vJykgKyB0aGlzLmJyb3dzZXJPcHRzLmFqYXhEaXI7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucmdiVG9Ic2wgPSBmdW5jdGlvbihyLCBnLCBiKSB7XG4gIHIgLz0gMjU1LCBnIC89IDI1NSwgYiAvPSAyNTU7XG4gIHZhciBtYXggPSBNYXRoLm1heChyLCBnLCBiKSwgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIHZhciBoLCBzLCBsID0gKG1heCArIG1pbikgLyAyO1xuXG4gIGlmIChtYXggPT0gbWluKSB7XG4gICAgaCA9IHMgPSAwOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgdmFyIGQgPSBtYXggLSBtaW47XG4gICAgcyA9IGwgPiAwLjUgPyBkIC8gKDIgLSBtYXggLSBtaW4pIDogZCAvIChtYXggKyBtaW4pO1xuICAgIHN3aXRjaChtYXgpe1xuICAgICAgY2FzZSByOiBoID0gKGcgLSBiKSAvIGQgKyAoZyA8IGIgPyA2IDogMCk7IGJyZWFrO1xuICAgICAgY2FzZSBnOiBoID0gKGIgLSByKSAvIGQgKyAyOyBicmVhaztcbiAgICAgIGNhc2UgYjogaCA9IChyIC0gZykgLyBkICsgNDsgYnJlYWs7XG4gICAgfVxuICAgIGggLz0gNjtcbiAgfVxuXG4gIHJldHVybiBbaCwgcywgbF07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5oc2xUb1JnYiA9IGZ1bmN0aW9uKGgsIHMsIGwpIHtcbiAgdmFyIHIsIGcsIGI7XG5cbiAgaWYgKHMgPT0gMCkge1xuICAgIHIgPSBnID0gYiA9IGw7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICBmdW5jdGlvbiBodWUycmdiKHAsIHEsIHQpIHtcbiAgICAgIGlmKHQgPCAwKSB0ICs9IDE7XG4gICAgICBpZih0ID4gMSkgdCAtPSAxO1xuICAgICAgaWYodCA8IDEvNikgcmV0dXJuIHAgKyAocSAtIHApICogNiAqIHQ7XG4gICAgICBpZih0IDwgMS8yKSByZXR1cm4gcTtcbiAgICAgIGlmKHQgPCAyLzMpIHJldHVybiBwICsgKHEgLSBwKSAqICgyLzMgLSB0KSAqIDY7XG4gICAgICByZXR1cm4gcDtcbiAgICB9XG5cbiAgICB2YXIgcSA9IGwgPCAwLjUgPyBsICogKDEgKyBzKSA6IGwgKyBzIC0gbCAqIHM7XG4gICAgdmFyIHAgPSAyICogbCAtIHE7XG4gICAgciA9IGh1ZTJyZ2IocCwgcSwgaCArIDEvMyk7XG4gICAgZyA9IGh1ZTJyZ2IocCwgcSwgaCk7XG4gICAgYiA9IGh1ZTJyZ2IocCwgcSwgaCAtIDEvMyk7XG4gIH1cblxuICByZXR1cm4gW3IgKiAyNTUsIGcgKiAyNTUsIGIgKiAyNTVdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUudmFsaWRhdGVDb2xvciA9IGZ1bmN0aW9uKGNvbG9yKSB7XG4gIHZhciBtID0gY29sb3IubWF0Y2goLyhcXGQrKSwoXFxkKyksKFxcZCspLyk7XG4gIGlmICghbSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgbS5zaGlmdCgpO1xuICByZXR1cm4gXy5hbGwoXy5tYXAobSwgcGFyc2VJbnQxMCksIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHYgPj0wICYmIHYgPD0gMjU1OyB9KTtcbn1cblxucmV0dXJuIEN1c3RvbVRyYWNrO1xuXG59OyIsIm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uKGdsb2JhbCl7XG4gIFxuICB2YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG4gIFxuICAvLyBTb21lIHV0aWxpdHkgZnVuY3Rpb25zLlxuICB2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyksXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmUgPSB1dGlscy5wYXJzZURlY2xhcmF0aW9uTGluZTtcbiAgXG4gIC8vIFRoZSBjbGFzcyB0aGF0IHJlcHJlc2VudHMgYSBzaW5ndWxhciBjdXN0b20gdHJhY2sgb2JqZWN0XG4gIHZhciBDdXN0b21UcmFjayA9IHJlcXVpcmUoJy4vQ3VzdG9tVHJhY2suanMnKShnbG9iYWwpO1xuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyA9IEN1c3RvbVRyYWNrcywgdGhlIG1vZHVsZSB0aGF0IGlzIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQuID1cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIHBhcnNpbmcgZGF0YSBpbnRvIEN1c3RvbVRyYWNrIG9iamVjdHMsXG4gIC8vIGFuZCBpdCBjYW4gZGVsZWdhdGUgdGhpcyB3b3JrIHRvIGEgd29ya2VyIHRocmVhZC5cblxuICB2YXIgQ3VzdG9tVHJhY2tzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbihjaHVua3MsIGJyb3dzZXJPcHRzKSB7XG4gICAgICB2YXIgY3VzdG9tVHJhY2tzID0gW10sXG4gICAgICAgIGRhdGEgPSBbXSxcbiAgICAgICAgdHJhY2ssIG9wdHMsIG07XG4gICAgICBcbiAgICAgIGlmICh0eXBlb2YgY2h1bmtzID09IFwic3RyaW5nXCIpIHsgY2h1bmtzID0gW2NodW5rc107IH1cbiAgICAgIFxuICAgICAgZnVuY3Rpb24gcHVzaFRyYWNrKCkge1xuICAgICAgICBpZiAodHJhY2sucGFyc2UoZGF0YSkpIHsgY3VzdG9tVHJhY2tzLnB1c2godHJhY2spOyB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyID0ge307XG4gICAgICBfLmVhY2goY2h1bmtzLCBmdW5jdGlvbih0ZXh0KSB7XG4gICAgICAgIF8uZWFjaCh0ZXh0LnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgICAgICBpZiAoL14jLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBjb21tZW50IGxpbmVcbiAgICAgICAgICB9IGVsc2UgaWYgKC9eYnJvd3NlclxccysvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIC8vIGJyb3dzZXIgbGluZXNcbiAgICAgICAgICAgIG0gPSBsaW5lLm1hdGNoKC9eYnJvd3NlclxccysoXFx3KylcXHMrKFxcUyopLyk7XG4gICAgICAgICAgICBpZiAoIW0pIHsgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IHBhcnNlIGJyb3dzZXIgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgY3VzdG9tVHJhY2tzLmJyb3dzZXJbbVsxXV0gPSBtWzJdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoL150cmFja1xccysvaS50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICBpZiAodHJhY2spIHsgcHVzaFRyYWNrKCk7IH1cbiAgICAgICAgICAgIG9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAoL150cmFja1xccysvaSkpO1xuICAgICAgICAgICAgaWYgKCFvcHRzKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSB0cmFjayBsaW5lIGZvdW5kIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSkpOyB9XG4gICAgICAgICAgICBvcHRzLmxpbmVOdW0gPSBsaW5lbm8gKyAxO1xuICAgICAgICAgICAgdHJhY2sgPSBuZXcgQ3VzdG9tVHJhY2sob3B0cywgYnJvd3Nlck9wdHMpO1xuICAgICAgICAgICAgZGF0YSA9IFtdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoL1xcUy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKCF0cmFjaykgeyB0aHJvdyBuZXcgRXJyb3IoXCJGb3VuZCBkYXRhIG9uIGxpbmUgXCIrKGxpbmVubysxKStcIiBidXQgbm8gcHJlY2VkaW5nIHRyYWNrIGRlZmluaXRpb25cIik7IH1cbiAgICAgICAgICAgIGRhdGEucHVzaChsaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBpZiAodHJhY2spIHsgcHVzaFRyYWNrKCk7IH1cbiAgICAgIHJldHVybiBjdXN0b21UcmFja3M7XG4gICAgfSxcbiAgICBcbiAgICBwYXJzZURlY2xhcmF0aW9uTGluZTogcGFyc2VEZWNsYXJhdGlvbkxpbmUsXG4gICAgXG4gICAgZXJyb3I6IGZ1bmN0aW9uKGUpIHtcbiAgICAgIC8vIENhbiBiZSBvdmVycmlkZGVuIGJ5IGEgcGFyZW50IGxpYnJhcnkgdG8gaGFuZGxlIGVycm9ycyBtb3JlIGdyYWNlZnVsbHkuXG4gICAgICAvLyBOb3RlOiB0aGlzIGlzIG92ZXJyaWRkZW4gYnkgdWkuZ2Vub2Jyb3dzZXIgZHVyaW5nIFVJIHNldHVwLlxuICAgICAgY29uc29sZS5sb2coZSk7XG4gICAgfSxcbiAgICBcbiAgICBfd29ya2VyU2NyaXB0OiAnYnVpbGQvQ3VzdG9tVHJhY2tXb3JrZXIuanMnLFxuICAgIC8vIE5PVEU6IFRvIHRlbXBvcmFyaWx5IGRpc2FibGUgV2ViIFdvcmtlciB1c2FnZSwgc2V0IHRoaXMgdG8gdHJ1ZS5cbiAgICBfZGlzYWJsZVdvcmtlcnM6IGZhbHNlLFxuICAgIFxuICAgIHdvcmtlcjogZnVuY3Rpb24oKSB7IFxuICAgICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBjYWxsYmFja3MgPSBbXTtcbiAgICAgIGlmICghc2VsZi5fd29ya2VyICYmIGdsb2JhbC5Xb3JrZXIpIHsgXG4gICAgICAgIHNlbGYuX3dvcmtlciA9IG5ldyBnbG9iYWwuV29ya2VyKHNlbGYuX3dvcmtlclNjcmlwdCk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGUpIHsgc2VsZi5lcnJvcihlKTsgfSwgZmFsc2UpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICBpZiAoZS5kYXRhLmxvZykgeyBjb25zb2xlLmxvZyhKU09OLnBhcnNlKGUuZGF0YS5sb2cpKTsgcmV0dXJuOyB9XG4gICAgICAgICAgaWYgKGUuZGF0YS5lcnJvcikge1xuICAgICAgICAgICAgaWYgKGUuZGF0YS5pZCkgeyBjYWxsYmFja3NbZS5kYXRhLmlkXSA9IG51bGw7IH1cbiAgICAgICAgICAgIHNlbGYuZXJyb3IoSlNPTi5wYXJzZShlLmRhdGEuZXJyb3IpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0oSlNPTi5wYXJzZShlLmRhdGEucmV0KSk7XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0gPSBudWxsO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmNhbGwgPSBmdW5jdGlvbihvcCwgYXJncywgY2FsbGJhY2spIHtcbiAgICAgICAgICB2YXIgaWQgPSBjYWxsYmFja3MucHVzaChjYWxsYmFjaykgLSAxO1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiBvcCwgaWQ6IGlkLCBhcmdzOiBhcmdzfSk7XG4gICAgICAgIH07XG4gICAgICAgIC8vIFRvIGhhdmUgdGhlIHdvcmtlciB0aHJvdyBlcnJvcnMgaW5zdGVhZCBvZiBwYXNzaW5nIHRoZW0gbmljZWx5IGJhY2ssIGNhbGwgdGhpcyB3aXRoIHRvZ2dsZT10cnVlXG4gICAgICAgIHNlbGYuX3dvcmtlci50aHJvd0Vycm9ycyA9IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiAndGhyb3dFcnJvcnMnLCBhcmdzOiBbdG9nZ2xlXX0pO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNlbGYuX2Rpc2FibGVXb3JrZXJzID8gbnVsbCA6IHNlbGYuX3dvcmtlcjtcbiAgICB9LFxuICAgIFxuICAgIGFzeW5jOiBmdW5jdGlvbihzZWxmLCBmbiwgYXJncywgYXN5bmNFeHRyYUFyZ3MsIHdyYXBwZXIpIHtcbiAgICAgIGFyZ3MgPSBfLnRvQXJyYXkoYXJncyk7XG4gICAgICB3cmFwcGVyID0gd3JhcHBlciB8fCBfLmlkZW50aXR5O1xuICAgICAgdmFyIGFyZ3NFeGNlcHRMYXN0T25lID0gXy5pbml0aWFsKGFyZ3MpLFxuICAgICAgICBjYWxsYmFjayA9IF8ubGFzdChhcmdzKSxcbiAgICAgICAgdyA9IHRoaXMud29ya2VyKCk7XG4gICAgICAvLyBGYWxsYmFjayBpZiB3ZWIgd29ya2VycyBhcmUgbm90IHN1cHBvcnRlZC5cbiAgICAgIC8vIFRoaXMgY291bGQgYWxzbyBiZSB0d2Vha2VkIHRvIG5vdCB1c2Ugd2ViIHdvcmtlcnMgd2hlbiB0aGVyZSB3b3VsZCBiZSBubyBwZXJmb3JtYW5jZSBnYWluO1xuICAgICAgLy8gICBhY3RpdmF0aW5nIHRoaXMgYnJhbmNoIGRpc2FibGVzIHdlYiB3b3JrZXJzIGVudGlyZWx5IGFuZCBldmVyeXRoaW5nIGhhcHBlbnMgc3luY2hyb25vdXNseS5cbiAgICAgIGlmICghdykgeyByZXR1cm4gY2FsbGJhY2soc2VsZltmbl0uYXBwbHkoc2VsZiwgYXJnc0V4Y2VwdExhc3RPbmUpKTsgfVxuICAgICAgQXJyYXkucHJvdG90eXBlLnVuc2hpZnQuYXBwbHkoYXJnc0V4Y2VwdExhc3RPbmUsIGFzeW5jRXh0cmFBcmdzKTtcbiAgICAgIHcuY2FsbChmbiwgYXJnc0V4Y2VwdExhc3RPbmUsIGZ1bmN0aW9uKHJldCkgeyBjYWxsYmFjayh3cmFwcGVyKHJldCkpOyB9KTtcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbih0cmFja3MpIHtcbiAgICAgICAgLy8gVGhlc2UgaGF2ZSBiZWVuIHNlcmlhbGl6ZWQsIHNvIHRoZXkgbXVzdCBiZSBoeWRyYXRlZCBpbnRvIHJlYWwgQ3VzdG9tVHJhY2sgb2JqZWN0cy5cbiAgICAgICAgLy8gV2UgcmVwbGFjZSAucHJlcmVuZGVyKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8ubWFwKHRyYWNrcywgZnVuY3Rpb24odCkge1xuICAgICAgICAgIHJldHVybiBfLmV4dGVuZChuZXcgQ3VzdG9tVHJhY2soKSwgdCwge1xuICAgICAgICAgICAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHsgQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcyA9IEN1c3RvbVRyYWNrcztcblxufSk7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gY2hyb20uc2l6ZXMgZm9ybWF0OiBodHRwOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvY2hyb21TaXplcyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90ZTogd2UgYXJlIGV4dGVuZGluZyB0aGUgZ2VuZXJhbCB1c2Ugb2YgdGhpcyB0byBpbmNsdWRlIGRhdGEgbG9hZGVkIGZyb20gdGhlIGdlbm9tZS50eHQgYW5kIGFubm90cy54bWxcbi8vIGZpbGVzIG9mIGFuIElHQiBxdWlja2xvYWQgZGlyZWN0b3J5LFxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICBvcHRzQXNUcmFja0xpbmUgPSB1dGlscy5vcHRzQXNUcmFja0xpbmU7XG5cbnZhciBDaHJvbVNpemVzRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgby5zcGVjaWVzID0gbS5zcGVjaWVzIHx8ICdDdXN0b20gR2Vub21lJztcbiAgICBvLmFzc2VtYmx5RGF0ZSA9IG0uYXNzZW1ibHlEYXRlIHx8ICcnO1xuICAgIFxuICAgIC8vIFRPRE86IGlmIG1ldGFkYXRhIGFsc28gY29udGFpbnMgY3VzdG9tIHRyYWNrIGRhdGEsIGUuZy4gZnJvbSBhbm5vdHMueG1sXG4gICAgLy8gbXVzdCBjb252ZXJ0IHRoZW0gaW50byBpdGVtcyBmb3Igby5hdmFpbFRyYWNrcywgby50cmFja3MsIGFuZCBvLnRyYWNrRGVzY1xuICAgIC8vIFRoZSBvLmF2YWlsVHJhY2tzIGl0ZW1zIHNob3VsZCBjb250YWluIHtjdXN0b21EYXRhOiB0cmFja2xpbmVzfSB0byBiZSBwYXJzZWRcbiAgICBpZiAobS50cmFja3MpIHsgc2VsZi5mb3JtYXQoKS5jcmVhdGVUcmFja3MobS50cmFja3MpOyB9XG4gIH0sXG4gIFxuICBjcmVhdGVUcmFja3M6IGZ1bmN0aW9uKHRyYWNrcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgICBcbiAgICBfLmVhY2godHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICB2YXIgdHJhY2tPcHRzO1xuICAgICAgdC5saW5lcyA9IHQubGluZXMgfHwgW107XG4gICAgICB0cmFja09wdHMgPSAvXnRyYWNrXFxzKy9pLnRlc3QodC5saW5lc1swXSkgPyBnbG9iYWwuQ3VzdG9tVHJhY2tzLnBhcnNlRGVjbGFyYXRpb25MaW5lKHQubGluZXMuc2hpZnQoKSkgOiB7fTtcbiAgICAgIHQubGluZXMudW5zaGlmdCgndHJhY2sgJyArIG9wdHNBc1RyYWNrTGluZShfLmV4dGVuZCh0cmFja09wdHMsIHQub3B0cywge25hbWU6IHQubmFtZSwgdHlwZTogdC50eXBlfSkpICsgJ1xcbicpO1xuICAgICAgby5hdmFpbFRyYWNrcy5wdXNoKHtcbiAgICAgICAgZmg6IHt9LFxuICAgICAgICBuOiB0Lm5hbWUsXG4gICAgICAgIHM6IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXSxcbiAgICAgICAgaDogMTUsXG4gICAgICAgIG06IFsncGFjayddLFxuICAgICAgICBjdXN0b21EYXRhOiB0LmxpbmVzXG4gICAgICB9KTtcbiAgICAgIG8udHJhY2tzLnB1c2goe246IHQubmFtZX0pO1xuICAgICAgby50cmFja0Rlc2NbdC5uYW1lXSA9IHtcbiAgICAgICAgY2F0OiBcIkZlYXR1cmUgVHJhY2tzXCIsXG4gICAgICAgIHNtOiB0Lm5hbWUsXG4gICAgICAgIGxnOiB0LmRlc2NyaXB0aW9uIHx8IHQubmFtZVxuICAgICAgfTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIGxpbmVzID0gdGV4dC5zcGxpdChcIlxcblwiKSxcbiAgICAgIG8gPSB0aGlzLm9wdHM7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBpKSB7XG4gICAgICB2YXIgY2hyc2l6ZSA9IHN0cmlwKGxpbmUpLnNwbGl0KC9cXHMrLywgMiksXG4gICAgICAgIGNociA9IGNocnNpemVbMF0sXG4gICAgICAgIHNpemUgPSBwYXJzZUludDEwKGNocnNpemVbMV0pO1xuICAgICAgaWYgKF8uaXNOYU4oc2l6ZSkpIHsgcmV0dXJuOyB9XG4gICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gc2l6ZTtcbiAgICAgIG8uZ2Vub21lU2l6ZSArPSBzaXplO1xuICAgIH0pO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENocm9tU2l6ZXNGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gRkFTVEEgZm9ybWF0OiBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0ZBU1RBX2Zvcm1hdCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGVuc3VyZVVuaXF1ZSA9IHV0aWxzLmVuc3VyZVVuaXF1ZTtcblxudmFyIEZhc3RhRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgICBcbiAgICBzZWxmLmRhdGEgPSB7fTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIGxpbmVzID0gdGV4dC5zcGxpdChcIlxcblwiKSxcbiAgICAgIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNociA9IG51bGwsXG4gICAgICB1bm5hbWVkQ291bnRlciA9IDEsXG4gICAgICBjaHJzZXEgPSBbXTtcbiAgICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IFtdO1xuICAgIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgaSkge1xuICAgICAgdmFyIGNockxpbmUgPSBsaW5lLm1hdGNoKC9eWz47XSguKykvKSxcbiAgICAgICAgY2xlYW5lZExpbmUgPSBsaW5lLnJlcGxhY2UoL1xccysvZywgJycpO1xuICAgICAgaWYgKGNockxpbmUpIHtcbiAgICAgICAgY2hyID0gY2hyTGluZVsxXS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7XG4gICAgICAgIGlmICghY2hyLmxlbmd0aCkgeyBjaHIgPSBcInVubmFtZWRDaHJcIjsgfVxuICAgICAgICBjaHIgPSBlbnN1cmVVbmlxdWUoY2hyLCBvLmNockxlbmd0aHMpO1xuICAgICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5zZXF1ZW5jZS5wdXNoKGNsZWFuZWRMaW5lKTtcbiAgICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSAoby5jaHJMZW5ndGhzW2Nocl0gfHwgMCkgKyBjbGVhbmVkTGluZS5sZW5ndGg7XG4gICAgICAgIG8uZ2Vub21lU2l6ZSArPSBjbGVhbmVkTGluZS5sZW5ndGg7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gc2VsZi5kYXRhLnNlcXVlbmNlLmpvaW4oJycpO1xuICAgIHNlbGYuY2FuR2V0U2VxdWVuY2UgPSB0cnVlO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZhc3RhRm9ybWF0OyIsIlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBHZW5CYW5rIGZvcm1hdDogaHR0cDovL3d3dy5uY2JpLm5sbS5uaWguZ292L1NpdGVtYXAvc2FtcGxlcmVjb3JkLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICB0b3BUYWdzQXNBcnJheSA9IHV0aWxzLnRvcFRhZ3NBc0FycmF5LFxuICBzdWJUYWdzQXNBcnJheSA9IHV0aWxzLnN1YlRhZ3NBc0FycmF5LFxuICBmZXRjaEZpZWxkID0gdXRpbHMuZmV0Y2hGaWVsZCxcbiAgZ2V0VGFnID0gdXRpbHMuZ2V0VGFnLFxuICBlbnN1cmVVbmlxdWUgPSB1dGlscy5lbnN1cmVVbmlxdWU7XG5cbnZhciBHZW5CYW5rRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAvLyBOb3RlIHRoYXQgd2UgY2FsbCBHZW5CYW5rIGZpZWxkIG5hbWVzIGxpa2UgXCJMT0NVU1wiLCBcIkRFRklOSVRJT05cIiwgZXRjLiB0YWdzIGluc3RlYWQgb2Yga2V5cy5cbiAgICAvLyBXZSBkbyB0aGlzIGJlY2F1c2U6IDEpIGNlcnRhaW4gZmllbGQgbmFtZXMgY2FuIGJlIHJlcGVhdGVkIChlLmcuIFJFRkVSRU5DRSkgd2hpY2ggaXMgbW9yZSBcbiAgICAvLyBldm9jYXRpdmUgb2YgXCJ0YWdzXCIgYXMgb3Bwb3NlZCB0byB0aGUgYmVoYXZpb3Igb2Yga2V5cyBpbiBhIGhhc2guICBBbHNvLCAyKSB0aGlzIGlzIHRoZVxuICAgIC8vIG5vbWVuY2xhdHVyZSBwaWNrZWQgYnkgQmlvUnVieS5cbiAgICBcbiAgICB0aGlzLnRhZ1NpemUgPSAxMjsgLy8gaG93IHdpZGUgdGhlIGNvbHVtbiBmb3IgdGFncyBpcyBpbiBhIEdlbkJhbmsgZmlsZVxuICAgIHRoaXMuZmVhdHVyZVRhZ1NpemUgPSAyMTsgLy8gaG93IHdpZGUgdGhlIGNvbHVtbiBmb3IgdGFncyBpcyBpbiB0aGUgZmVhdHVyZSB0YWJsZSBzZWN0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzZWUgc2VjdGlvbiA0LjEgb2YgaHR0cDovL3d3dy5pbnNkYy5vcmcvZmlsZXMvZmVhdHVyZV90YWJsZS5odG1sXG4gICAgXG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgY29udGlnczogW10sXG4gICAgICB0cmFja0xpbmVzOiB7XG4gICAgICAgIHNvdXJjZTogW10sXG4gICAgICAgIGdlbmVzOiBbXSxcbiAgICAgICAgb3RoZXI6IFtdXG4gICAgICB9XG4gICAgfTtcbiAgfSxcbiAgXG4gIHBhcnNlTG9jdXM6IGZ1bmN0aW9uKGNvbnRpZykge1xuICAgIHZhciBsb2N1c0xpbmUgPSBjb250aWcub3JpZy5sb2N1cztcbiAgICBpZiAobG9jdXNMaW5lKSB7XG4gICAgICBpZiAobG9jdXNMaW5lLmxlbmd0aCA+IDc1KSB7IC8vIGFmdGVyIFJlbCAxMjYuMFxuICAgICAgICBjb250aWcuZW50cnlJZCAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDEyLCAyOCkpO1xuICAgICAgICBjb250aWcubGVuZ3RoICAgPSBwYXJzZUludDEwKGxvY3VzTGluZS5zdWJzdHJpbmcoMjksIDQwKSk7XG4gICAgICAgIGNvbnRpZy5zdHJhbmQgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDQsIDQ3KSk7XG4gICAgICAgIGNvbnRpZy5uYXR5cGUgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDcsIDUzKSk7XG4gICAgICAgIGNvbnRpZy5jaXJjdWxhciA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNTUsIDYzKSk7XG4gICAgICAgIGNvbnRpZy5kaXZpc2lvbiA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjMsIDY3KSk7XG4gICAgICAgIGNvbnRpZy5kYXRlICAgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjgsIDc5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb250aWcuZW50cnlJZCAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDEyLCAyMikpO1xuICAgICAgICBjb250aWcubGVuZ3RoICAgPSBwYXJzZUludDEwKGxvY3VzTGluZS5zdWJzdHJpbmcoMjIsIDMwKSk7XG4gICAgICAgIGNvbnRpZy5zdHJhbmQgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMzMsIDM2KSk7XG4gICAgICAgIGNvbnRpZy5uYXR5cGUgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMzYsIDQwKSk7XG4gICAgICAgIGNvbnRpZy5jaXJjdWxhciA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDIsIDUyKSk7XG4gICAgICAgIGNvbnRpZy5kaXZpc2lvbiA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNTIsIDU1KSk7XG4gICAgICAgIGNvbnRpZy5kYXRlICAgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjIsIDczKSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICBcbiAgcGFyc2VIZWFkZXJGaWVsZHM6IGZ1bmN0aW9uKGNvbnRpZykge1xuICAgIHZhciB0YWdTaXplID0gdGhpcy50YWdTaXplLFxuICAgICAgaGVhZGVyRmllbGRzVG9QYXJzZSA9IHtcbiAgICAgICAgc2ltcGxlOiBbJ2RlZmluaXRpb24nLCAnYWNjZXNzaW9uJywgJ3ZlcnNpb24nXSxcbiAgICAgICAgZGVlcDogWydzb3VyY2UnXSAvLyBjb3VsZCBhZGQgcmVmZXJlbmNlcywgYnV0IHdlIGRvbid0IGNhcmUgYWJvdXQgdGhvc2UgaGVyZVxuICAgICAgfTtcbiAgICBcbiAgICAvLyBQYXJzZSBzaW1wbGUgZmllbGRzICh0YWcgLS0+IGNvbnRlbnQpXG4gICAgXy5lYWNoKGhlYWRlckZpZWxkc1RvUGFyc2Uuc2ltcGxlLCBmdW5jdGlvbih0YWcpIHtcbiAgICAgIGlmICghY29udGlnLm9yaWdbdGFnXSkgeyBjb250aWdbdGFnXSA9IG51bGw7IHJldHVybjsgfVxuICAgICAgY29udGlnW3RhZ10gPSBmZXRjaEZpZWxkKGNvbnRpZy5vcmlnW3RhZ10sIHRhZ1NpemUpO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIFBhcnNlIHRhZ3MgdGhhdCBjYW4gcmVwZWF0IGFuZCBoYXZlIHN1YnRhZ3NcbiAgICBfLmVhY2goaGVhZGVyRmllbGRzVG9QYXJzZS5kZWVwLCBmdW5jdGlvbih0YWcpIHtcbiAgICAgIHZhciBkYXRhID0gW10sXG4gICAgICAgIGl0ZW1zO1xuICAgICAgaWYgKCFjb250aWcub3JpZ1t0YWddKSB7IGNvbnRpZ1t0YWddID0gbnVsbDsgcmV0dXJuOyB9XG4gICAgICBcbiAgICAgIGl0ZW1zID0gY29udGlnLm9yaWdbdGFnXS5yZXBsYWNlKC9cXG4oW0EtWmEtelxcL1xcKl0pL2csIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xuICAgICAgXy5lYWNoKGl0ZW1zLCBmdW5jdGlvbihpdGVtKSB7XG4gICAgICAgIHZhciBzdWJUYWdzID0gc3ViVGFnc0FzQXJyYXkoaXRlbSwgdGFnU2l6ZSksXG4gICAgICAgICAgaXRlbU5hbWUgPSBmZXRjaEZpZWxkKHN1YlRhZ3Muc2hpZnQoKSwgdGFnU2l6ZSksIFxuICAgICAgICAgIGl0ZW1EYXRhID0ge19uYW1lOiBpdGVtTmFtZX07XG4gICAgICAgIF8uZWFjaChzdWJUYWdzLCBmdW5jdGlvbihzdWJUYWdGaWVsZCkge1xuICAgICAgICAgIHZhciB0YWcgPSBnZXRUYWcoc3ViVGFnRmllbGQsIHRhZ1NpemUpO1xuICAgICAgICAgIGl0ZW1EYXRhW3RhZ10gPSBmZXRjaEZpZWxkKHN1YlRhZ0ZpZWxkLCB0YWdTaXplKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEucHVzaChpdGVtRGF0YSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnRpZ1t0YWddID0gZGF0YTtcbiAgICAgIFxuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2VGZWF0dXJlVGFibGU6IGZ1bmN0aW9uKGNociwgY29udGlnRGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHRhZ1NpemUgPSBzZWxmLnRhZ1NpemUsXG4gICAgICBmZWF0dXJlVGFnU2l6ZSA9IHNlbGYuZmVhdHVyZVRhZ1NpemUsXG4gICAgICB0YWdzVG9Ta2lwID0gW1wiZmVhdHVyZXNcIl0sXG4gICAgICB0YWdzUmVsYXRlZFRvR2VuZXMgPSBbXCJjZHNcIiwgXCJnZW5lXCIsIFwibXJuYVwiLCBcImV4b25cIiwgXCJpbnRyb25cIl0sXG4gICAgICBjb250aWdMaW5lID0gXCJBQ0NFU1NJT04gICBcIiArIGNociArIFwiXFxuXCI7XG4gICAgaWYgKGNvbnRpZ0RhdGEub3JpZy5mZWF0dXJlcykge1xuICAgICAgdmFyIHN1YlRhZ3MgPSBzdWJUYWdzQXNBcnJheShjb250aWdEYXRhLm9yaWcuZmVhdHVyZXMsIHRhZ1NpemUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMuc291cmNlLnB1c2goY29udGlnTGluZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5nZW5lcy5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMub3RoZXIucHVzaChjb250aWdMaW5lKTtcbiAgICAgIF8uZWFjaChzdWJUYWdzLCBmdW5jdGlvbihzdWJUYWdGaWVsZCkge1xuICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKHN1YlRhZ0ZpZWxkLCBmZWF0dXJlVGFnU2l6ZSk7XG4gICAgICAgIGlmICh0YWdzVG9Ta2lwLmluZGV4T2YodGFnKSAhPT0gLTEpIHsgcmV0dXJuOyB9XG4gICAgICAgIGVsc2UgaWYgKHRhZyA9PT0gXCJzb3VyY2VcIikgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5zb3VyY2UucHVzaChzdWJUYWdGaWVsZCk7IH1cbiAgICAgICAgZWxzZSBpZiAodGFnc1JlbGF0ZWRUb0dlbmVzLmluZGV4T2YodGFnKSAhPT0gLTEpIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMuZ2VuZXMucHVzaChzdWJUYWdGaWVsZCk7ICB9XG4gICAgICAgIGVsc2UgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5vdGhlci5wdXNoKHN1YlRhZ0ZpZWxkKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBcbiAgcGFyc2VTZXF1ZW5jZTogZnVuY3Rpb24oY29udGlnRGF0YSkge1xuICAgIGlmIChjb250aWdEYXRhLm9yaWcub3JpZ2luKSB7XG4gICAgICByZXR1cm4gY29udGlnRGF0YS5vcmlnLm9yaWdpbi5yZXBsYWNlKC9eb3JpZ2luLip8XFxuWyAwLTldezEwfXwgL2lnLCAnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBBcnJheShjb250aWdEYXRhLmxlbmd0aCkuam9pbignbicpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGNyZWF0ZVRyYWNrc0Zyb21GZWF0dXJlczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNhdGVnb3J5VHVwbGVzID0gW1xuICAgICAgICBbXCJzb3VyY2VcIiwgXCJTb3VyY2VzXCIsIFwiUmVnaW9ucyBhbm5vdGF0ZWQgYnkgc291cmNlIG9yZ2FuaXNtIG9yIHNwZWNpbWVuXCJdLCBcbiAgICAgICAgW1wiZ2VuZXNcIiwgXCJHZW5lIGFubm90YXRpb25zXCIsIFwiQ0RTIGFuZCBnZW5lIGZlYXR1cmVzXCJdLCBcbiAgICAgICAgW1wib3RoZXJcIiwgXCJPdGhlciBhbm5vdGF0aW9uc1wiLCBcInRSTkFzIGFuZCBvdGhlciBmZWF0dXJlc1wiXVxuICAgICAgXTtcbiAgICBcbiAgICAvLyBGb3IgdGhlIGNhdGVnb3JpZXMgb2YgZmVhdHVyZXMsIGNyZWF0ZSBhcHByb3ByaWF0ZSBlbnRyaWVzIGluIG8uYXZhaWxUcmFja3MsIG8udHJhY2tzLCBhbmQgby50cmFja0Rlc2NcbiAgICAvLyBMZWF2ZSB0aGUgYWN0dWFsIGRhdGEgYXMgYXJyYXlzIG9mIGxpbmVzIHRoYXQgYXJlIGF0dGFjaGVkIGFzIC5jdXN0b21EYXRhIHRvIG8uYXZhaWxUcmFja3NcbiAgICAvLyBUaGV5IHdpbGwgYmUgcGFyc2VkIGxhdGVyIHZpYSBDdXN0b21UcmFja3MucGFyc2UuXG4gICAgXy5lYWNoKGNhdGVnb3J5VHVwbGVzLCBmdW5jdGlvbihjYXRlZ29yeVR1cGxlKSB7XG4gICAgICB2YXIgY2F0ZWdvcnkgPSBjYXRlZ29yeVR1cGxlWzBdLFxuICAgICAgICBsYWJlbCA9IGNhdGVnb3J5VHVwbGVbMV0sXG4gICAgICAgIGxvbmdMYWJlbCA9IGNhdGVnb3J5VHVwbGVbMl0sXG4gICAgICAgIHRyYWNrTGluZXMgPSBbXTtcbiAgICAgIGlmIChzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV0ubGVuZ3RoID4gMCkge1xuICAgICAgICBzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV0udW5zaGlmdCgndHJhY2sgdHlwZT1cImZlYXR1cmVUYWJsZVwiIG5hbWU9XCInICsgbGFiZWwgKyBcbiAgICAgICAgICAnXCIgY29sbGFwc2VCeUdlbmU9XCInICsgKGNhdGVnb3J5PT1cImdlbmVzXCIgPyAnb24nIDogJ29mZicpICsgJ1wiXFxuJyk7XG4gICAgICB9XG4gICAgICBvLmF2YWlsVHJhY2tzLnB1c2goe1xuICAgICAgICBmaDoge30sXG4gICAgICAgIG46IGNhdGVnb3J5LFxuICAgICAgICBzOiBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ10sXG4gICAgICAgIGg6IDE1LFxuICAgICAgICBtOiBbJ3BhY2snXSxcbiAgICAgICAgY3VzdG9tRGF0YTogc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldXG4gICAgICB9KTtcbiAgICAgIG8udHJhY2tzLnB1c2goe246IGNhdGVnb3J5fSk7XG4gICAgICBvLnRyYWNrRGVzY1tjYXRlZ29yeV0gPSB7XG4gICAgICAgIGNhdDogXCJGZWF0dXJlIFRyYWNrc1wiLFxuICAgICAgICBzbTogbGFiZWwsXG4gICAgICAgIGxnOiBsb25nTGFiZWxcbiAgICAgIH07XG4gICAgfSk7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjb250aWdEZWxpbWl0ZXIgPSBcIlxcbi8vXFxuXCIsXG4gICAgICBjb250aWdzID0gdGV4dC5zcGxpdChjb250aWdEZWxpbWl0ZXIpLFxuICAgICAgZmlyc3RDb250aWcgPSBudWxsO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IFtdO1xuICAgICAgXG4gICAgXy5lYWNoKGNvbnRpZ3MsIGZ1bmN0aW9uKGNvbnRpZykge1xuICAgICAgaWYgKCFzdHJpcChjb250aWcpLmxlbmd0aCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgdmFyIGNvbnRpZ0RhdGEgPSB7b3JpZzoge319LFxuICAgICAgICBjaHIsIHNpemUsIGNvbnRpZ1NlcXVlbmNlO1xuICAgICAgXG4gICAgICAvLyBTcGxpdHMgb24gYW55IGxpbmVzIHdpdGggYSBjaGFyYWN0ZXIgaW4gdGhlIGZpcnN0IGNvbHVtblxuICAgICAgXy5lYWNoKHRvcFRhZ3NBc0FycmF5KGNvbnRpZyksIGZ1bmN0aW9uKGZpZWxkKSB7XG4gICAgICAgIHZhciB0YWcgPSBnZXRUYWcoZmllbGQsIHNlbGYudGFnU2l6ZSk7XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNvbnRpZ0RhdGEub3JpZ1t0YWddKSkgeyBjb250aWdEYXRhLm9yaWdbdGFnXSA9IGZpZWxkOyB9XG4gICAgICAgIGVsc2UgeyBjb250aWdEYXRhLm9yaWdbdGFnXSArPSBmaWVsZDsgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIHNlbGYuZGF0YS5jb250aWdzLnB1c2goY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlTG9jdXMoY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlSGVhZGVyRmllbGRzKGNvbnRpZ0RhdGEpO1xuICAgICAgY29udGlnU2VxdWVuY2UgPSBzZWxmLmZvcm1hdCgpLnBhcnNlU2VxdWVuY2UoY29udGlnRGF0YSk7XG4gICAgICBcbiAgICAgIGNociA9IGNvbnRpZ0RhdGEuYWNjZXNzaW9uICYmIGNvbnRpZ0RhdGEuYWNjZXNzaW9uICE9ICd1bmtub3duJyA/IGNvbnRpZ0RhdGEuYWNjZXNzaW9uIDogY29udGlnRGF0YS5lbnRyeUlkO1xuICAgICAgY2hyID0gZW5zdXJlVW5pcXVlKGNociwgby5jaHJMZW5ndGhzKTtcbiAgICAgIFxuICAgICAgaWYgKGNvbnRpZ0RhdGEubGVuZ3RoKSB7XG4gICAgICAgIHNpemUgPSBjb250aWdEYXRhLmxlbmd0aDtcbiAgICAgICAgaWYgKHNpemUgIT0gY29udGlnU2VxdWVuY2UubGVuZ3RoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2VxdWVuY2UgZGF0YSBmb3IgY29udGlnIFwiK2NocitcIiBkb2VzIG5vdCBtYXRjaCBsZW5ndGggXCIrc2l6ZStcImJwIGZyb20gaGVhZGVyXCIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzaXplID0gY29udGlnU2VxdWVuY2UubGVuZ3RoO1xuICAgICAgfVxuICAgICAgXG4gICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gc2l6ZTtcbiAgICAgIG8uZ2Vub21lU2l6ZSArPSBzaXplO1xuICAgICAgXG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlRmVhdHVyZVRhYmxlKGNociwgY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmRhdGEuc2VxdWVuY2UucHVzaChjb250aWdTZXF1ZW5jZSk7XG4gICAgICBcbiAgICAgIGZpcnN0Q29udGlnID0gZmlyc3RDb250aWcgfHwgY29udGlnRGF0YTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBzZWxmLmRhdGEuc2VxdWVuY2Uuam9pbignJyk7XG4gICAgc2VsZi5jYW5HZXRTZXF1ZW5jZSA9IHRydWU7XG4gICAgc2VsZi5mb3JtYXQoKS5jcmVhdGVUcmFja3NGcm9tRmVhdHVyZXMoKTtcbiAgICBcbiAgICBvLnNwZWNpZXMgPSBmaXJzdENvbnRpZy5zb3VyY2UgPyBmaXJzdENvbnRpZy5zb3VyY2VbMF0ub3JnYW5pc20uc3BsaXQoXCJcXG5cIilbMF0gOiAnQ3VzdG9tIEdlbm9tZSc7XG4gICAgaWYgKGZpcnN0Q29udGlnLmRhdGUpIHsgby5hc3NlbWJseURhdGUgPSBmaXJzdENvbnRpZy5kYXRlOyB9XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEdlbkJhbmtGb3JtYXQ7IiwidmFyIHRyYWNrVXRpbHMgPSByZXF1aXJlKCcuLi8uLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpO1xuXG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gdHJhY2tVdGlscy5wYXJzZUludDEwO1xuXG5tb2R1bGUuZXhwb3J0cy5kZWVwQ2xvbmUgPSBmdW5jdGlvbihvYmopIHsgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob2JqKSk7IH1cblxubW9kdWxlLmV4cG9ydHMubG9nMTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIE1hdGgubG9nKHZhbCkgLyBNYXRoLkxOMTA7IH1cblxudmFyIHN0cmlwID0gbW9kdWxlLmV4cG9ydHMuc3RyaXAgPSB0cmFja1V0aWxzLnN0cmlwO1xuXG5tb2R1bGUuZXhwb3J0cy5yb3VuZFRvUGxhY2VzID0gZnVuY3Rpb24obnVtLCBkZWMpIHsgcmV0dXJuIE1hdGgucm91bmQobnVtICogTWF0aC5wb3coMTAsIGRlYykpIC8gTWF0aC5wb3coMTAsIGRlYyk7IH1cblxuLyoqKipcbiAqIFRoZXNlIGZ1bmN0aW9ucyBhcmUgY29tbW9uIHN1YnJvdXRpbmVzIGZvciBwYXJzaW5nIEdlbkJhbmsgYW5kIG90aGVyIGZvcm1hdHMgYmFzZWQgb24gY29sdW1uIHBvc2l0aW9uc1xuICoqKiovXG5cbi8vIFNwbGl0cyBhIG11bHRpbGluZSBzdHJpbmcgYmVmb3JlIHRoZSBsaW5lcyB0aGF0IGNvbnRhaW4gYSBjaGFyYWN0ZXIgaW4gdGhlIGZpcnN0IGNvbHVtblxuLy8gKGEgXCJ0b3AgdGFnXCIpIGluIGEgR2VuQmFuay1zdHlsZSB0ZXh0IGZpbGVcbm1vZHVsZS5leHBvcnRzLnRvcFRhZ3NBc0FycmF5ID0gZnVuY3Rpb24oZmllbGQpIHtcbiAgcmV0dXJuIGZpZWxkLnJlcGxhY2UoL1xcbihbQS1aYS16XFwvXFwqXSkvZywgXCJcXG5cXDAwMSQxXCIpLnNwbGl0KFwiXFwwMDFcIik7XG59XG5cbi8vIFNwbGl0cyBhIG11bHRpbGluZSBzdHJpbmcgYmVmb3JlIHRoZSBsaW5lcyB0aGF0IGNvbnRhaW4gYSBjaGFyYWN0ZXIgbm90IGluIHRoZSBmaXJzdCBjb2x1bW5cbi8vIGJ1dCB3aXRoaW4gdGhlIG5leHQgdGFnU2l6ZSBjb2x1bW5zLCB3aGljaCBpcyBhIFwic3ViIHRhZ1wiIGluIGEgR2VuQmFuay1zdHlsZSB0ZXh0IGZpbGVcbm1vZHVsZS5leHBvcnRzLnN1YlRhZ3NBc0FycmF5ID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHtcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMikgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHZhciByZSA9IG5ldyBSZWdFeHAoXCJcXFxcbihcXFxcc3sxLFwiICsgKHRhZ1NpemUgLSAxKSArIFwifVxcXFxTKVwiLCBcImdcIik7XG4gIHJldHVybiBmaWVsZC5yZXBsYWNlKHJlLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbn1cblxuLy8gUmV0dXJucyBhIG5ldyBzdHJpbmcgd2l0aCB0aGUgZmlyc3QgdGFnU2l6ZSBjb2x1bW5zIGZyb20gZmllbGQgcmVtb3ZlZFxubW9kdWxlLmV4cG9ydHMuZmV0Y2hGaWVsZCA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7XG4gIGlmICghaXNGaW5pdGUodGFnU2l6ZSkgfHwgdGFnU2l6ZSA8IDEpIHsgdGhyb3cgXCJpbnZhbGlkIHRhZ1NpemVcIjsgfVxuICB2YXIgcmUgPSBuZXcgUmVnRXhwKFwiKF58XFxcXG4pLnswLFwiICsgdGFnU2l6ZSArIFwifVwiLCBcImdcIik7XG4gIHJldHVybiBzdHJpcChmaWVsZC5yZXBsYWNlKHJlLCBcIiQxXCIpKTtcbn1cblxuLy8gR2V0cyBhIHRhZyBmcm9tIGEgZmllbGQgYnkgdHJpbW1pbmcgaXQgb3V0IG9mIHRoZSBmaXJzdCB0YWdTaXplIGNoYXJhY3RlcnMgb2YgdGhlIGZpZWxkXG5tb2R1bGUuZXhwb3J0cy5nZXRUYWcgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkgeyBcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMSkgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHJldHVybiBzdHJpcChmaWVsZC5zdWJzdHJpbmcoMCwgdGFnU2l6ZSkudG9Mb3dlckNhc2UoKSk7XG59XG5cbi8qKioqXG4gKiBFbmQgR2VuQmFuayBhbmQgY29sdW1uLWJhc2VkIGZvcm1hdCBoZWxwZXJzXG4gKioqKi9cblxuLy8gR2l2ZW4gYSBoYXNoIGFuZCBhIHByZXN1bXB0aXZlIG5ldyBrZXksIGFwcGVuZHMgYSBjb3VudGVyIHRvIHRoZSBrZXkgdW50aWwgaXQgaXMgYWN0dWFsbHkgYW4gdW51c2VkIGtleVxubW9kdWxlLmV4cG9ydHMuZW5zdXJlVW5pcXVlID0gZnVuY3Rpb24oa2V5LCBoYXNoKSB7XG4gIHZhciBpID0gMSwga2V5Q2hlY2sgPSBrZXk7XG4gIHdoaWxlICh0eXBlb2YgaGFzaFtrZXlDaGVja10gIT0gJ3VuZGVmaW5lZCcpIHsga2V5Q2hlY2sgPSBrZXkgKyAnXycgKyBpKys7IH1cbiAgcmV0dXJuIGtleUNoZWNrO1xufVxuXG4vLyBHaXZlbiBhIGhhc2ggd2l0aCBvcHRpb24gbmFtZXMgYW5kIHZhbHVlcywgZm9ybWF0cyBpdCBpbiBCRUQgdHJhY2sgbGluZSBmb3JtYXQgKHNpbWlsYXIgdG8gSFRNTCBlbGVtZW50IGF0dHJpYnV0ZXMpXG5tb2R1bGUuZXhwb3J0cy5vcHRzQXNUcmFja0xpbmUgPSBmdW5jdGlvbihvcHRoYXNoKSB7XG4gIHJldHVybiBfLm1hcChvcHRoYXNoLCBmdW5jdGlvbih2LCBrKSB7IHJldHVybiBrICsgJz1cIicgKyB2LnRvU3RyaW5nKCkucmVwbGFjZSgvXCIvZywgJycpICsgJ1wiJzsgfSkuam9pbignICcpO1xufSIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKXtnbG9iYWwud2luZG93PWdsb2JhbC53aW5kb3d8fGdsb2JhbDtnbG9iYWwud2luZG93LmRvY3VtZW50PWdsb2JhbC53aW5kb3cuZG9jdW1lbnR8fHt9OyhmdW5jdGlvbihhLGIpe2Z1bmN0aW9uIE4oKXt0cnl7cmV0dXJuIG5ldyBhLkFjdGl2ZVhPYmplY3QoXCJNaWNyb3NvZnQuWE1MSFRUUFwiKX1jYXRjaChiKXt9fWZ1bmN0aW9uIE0oKXt0cnl7cmV0dXJuIG5ldyBhLlhNTEh0dHBSZXF1ZXN0fWNhdGNoKGIpe319ZnVuY3Rpb24gSShhLGMpe2lmKGEuZGF0YUZpbHRlcil7Yz1hLmRhdGFGaWx0ZXIoYyxhLmRhdGFUeXBlKX12YXIgZD1hLmRhdGFUeXBlcyxlPXt9LGcsaCxpPWQubGVuZ3RoLGosaz1kWzBdLGwsbSxuLG8scDtmb3IoZz0xO2c8aTtnKyspe2lmKGc9PT0xKXtmb3IoaCBpbiBhLmNvbnZlcnRlcnMpe2lmKHR5cGVvZiBoPT09XCJzdHJpbmdcIil7ZVtoLnRvTG93ZXJDYXNlKCldPWEuY29udmVydGVyc1toXX19fWw9aztrPWRbZ107aWYoaz09PVwiKlwiKXtrPWx9ZWxzZSBpZihsIT09XCIqXCImJmwhPT1rKXttPWwrXCIgXCIraztuPWVbbV18fGVbXCIqIFwiK2tdO2lmKCFuKXtwPWI7Zm9yKG8gaW4gZSl7aj1vLnNwbGl0KFwiIFwiKTtpZihqWzBdPT09bHx8alswXT09PVwiKlwiKXtwPWVbalsxXStcIiBcIitrXTtpZihwKXtvPWVbb107aWYobz09PXRydWUpe249cH1lbHNlIGlmKHA9PT10cnVlKXtuPW99YnJlYWt9fX19aWYoIShufHxwKSl7Zi5lcnJvcihcIk5vIGNvbnZlcnNpb24gZnJvbSBcIittLnJlcGxhY2UoXCIgXCIsXCIgdG8gXCIpKX1pZihuIT09dHJ1ZSl7Yz1uP24oYyk6cChvKGMpKX19fXJldHVybiBjfWZ1bmN0aW9uIEgoYSxjLGQpe3ZhciBlPWEuY29udGVudHMsZj1hLmRhdGFUeXBlcyxnPWEucmVzcG9uc2VGaWVsZHMsaCxpLGosaztmb3IoaSBpbiBnKXtpZihpIGluIGQpe2NbZ1tpXV09ZFtpXX19d2hpbGUoZlswXT09PVwiKlwiKXtmLnNoaWZ0KCk7aWYoaD09PWIpe2g9YS5taW1lVHlwZXx8Yy5nZXRSZXNwb25zZUhlYWRlcihcImNvbnRlbnQtdHlwZVwiKX19aWYoaCl7Zm9yKGkgaW4gZSl7aWYoZVtpXSYmZVtpXS50ZXN0KGgpKXtmLnVuc2hpZnQoaSk7YnJlYWt9fX1pZihmWzBdaW4gZCl7aj1mWzBdfWVsc2V7Zm9yKGkgaW4gZCl7aWYoIWZbMF18fGEuY29udmVydGVyc1tpK1wiIFwiK2ZbMF1dKXtqPWk7YnJlYWt9aWYoIWspe2s9aX19aj1qfHxrfWlmKGope2lmKGohPT1mWzBdKXtmLnVuc2hpZnQoail9cmV0dXJuIGRbal19fWZ1bmN0aW9uIEcoYSxiLGMsZCl7aWYoZi5pc0FycmF5KGIpKXtmLmVhY2goYixmdW5jdGlvbihiLGUpe2lmKGN8fGoudGVzdChhKSl7ZChhLGUpfWVsc2V7RyhhK1wiW1wiKyh0eXBlb2YgZT09PVwib2JqZWN0XCJ8fGYuaXNBcnJheShlKT9iOlwiXCIpK1wiXVwiLGUsYyxkKX19KX1lbHNlIGlmKCFjJiZiIT1udWxsJiZ0eXBlb2YgYj09PVwib2JqZWN0XCIpe2Zvcih2YXIgZSBpbiBiKXtHKGErXCJbXCIrZStcIl1cIixiW2VdLGMsZCl9fWVsc2V7ZChhLGIpfX1mdW5jdGlvbiBGKGEsYyl7dmFyIGQsZSxnPWYuYWpheFNldHRpbmdzLmZsYXRPcHRpb25zfHx7fTtmb3IoZCBpbiBjKXtpZihjW2RdIT09Yil7KGdbZF0/YTplfHwoZT17fSkpW2RdPWNbZF19fWlmKGUpe2YuZXh0ZW5kKHRydWUsYSxlKX19ZnVuY3Rpb24gRShhLGMsZCxlLGYsZyl7Zj1mfHxjLmRhdGFUeXBlc1swXTtnPWd8fHt9O2dbZl09dHJ1ZTt2YXIgaD1hW2ZdLGk9MCxqPWg/aC5sZW5ndGg6MCxrPWE9PT15LGw7Zm9yKDtpPGomJihrfHwhbCk7aSsrKXtsPWhbaV0oYyxkLGUpO2lmKHR5cGVvZiBsPT09XCJzdHJpbmdcIil7aWYoIWt8fGdbbF0pe2w9Yn1lbHNle2MuZGF0YVR5cGVzLnVuc2hpZnQobCk7bD1FKGEsYyxkLGUsbCxnKX19fWlmKChrfHwhbCkmJiFnW1wiKlwiXSl7bD1FKGEsYyxkLGUsXCIqXCIsZyl9cmV0dXJuIGx9ZnVuY3Rpb24gRChhKXtyZXR1cm4gZnVuY3Rpb24oYixjKXtpZih0eXBlb2YgYiE9PVwic3RyaW5nXCIpe2M9YjtiPVwiKlwifWlmKGYuaXNGdW5jdGlvbihjKSl7dmFyIGQ9Yi50b0xvd2VyQ2FzZSgpLnNwbGl0KHUpLGU9MCxnPWQubGVuZ3RoLGgsaSxqO2Zvcig7ZTxnO2UrKyl7aD1kW2VdO2o9L15cXCsvLnRlc3QoaCk7aWYoail7aD1oLnN1YnN0cigxKXx8XCIqXCJ9aT1hW2hdPWFbaF18fFtdO2lbaj9cInVuc2hpZnRcIjpcInB1c2hcIl0oYyl9fX19dmFyIGM9YS5kb2N1bWVudCxkPWEubmF2aWdhdG9yLGU9YS5sb2NhdGlvbjt2YXIgZj1mdW5jdGlvbigpe2Z1bmN0aW9uIEooKXtpZihlLmlzUmVhZHkpe3JldHVybn10cnl7Yy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwoXCJsZWZ0XCIpfWNhdGNoKGEpe3NldFRpbWVvdXQoSiwxKTtyZXR1cm59ZS5yZWFkeSgpfXZhciBlPWZ1bmN0aW9uKGEsYil7cmV0dXJuIG5ldyBlLmZuLmluaXQoYSxiLGgpfSxmPWEualF1ZXJ5LGc9YS4kLGgsaT0vXig/OltePF0qKDxbXFx3XFxXXSs+KVtePl0qJHwjKFtcXHdcXC1dKikkKS8saj0vXFxTLyxrPS9eXFxzKy8sbD0vXFxzKyQvLG09L1xcZC8sbj0vXjwoXFx3KylcXHMqXFwvPz4oPzo8XFwvXFwxPik/JC8sbz0vXltcXF0sOnt9XFxzXSokLyxwPS9cXFxcKD86W1wiXFxcXFxcL2JmbnJ0XXx1WzAtOWEtZkEtRl17NH0pL2cscT0vXCJbXlwiXFxcXFxcblxccl0qXCJ8dHJ1ZXxmYWxzZXxudWxsfC0/XFxkKyg/OlxcLlxcZCopPyg/OltlRV1bK1xcLV0/XFxkKyk/L2cscj0vKD86Xnw6fCwpKD86XFxzKlxcWykrL2cscz0vKHdlYmtpdClbIFxcL10oW1xcdy5dKykvLHQ9LyhvcGVyYSkoPzouKnZlcnNpb24pP1sgXFwvXShbXFx3Ll0rKS8sdT0vKG1zaWUpIChbXFx3Ll0rKS8sdj0vKG1vemlsbGEpKD86Lio/IHJ2OihbXFx3Ll0rKSk/Lyx3PS8tKFthLXpdKS9pZyx4PWZ1bmN0aW9uKGEsYil7cmV0dXJuIGIudG9VcHBlckNhc2UoKX0seT1kLnVzZXJBZ2VudCx6LEEsQixDPU9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsRD1PYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LEU9QXJyYXkucHJvdG90eXBlLnB1c2gsRj1BcnJheS5wcm90b3R5cGUuc2xpY2UsRz1TdHJpbmcucHJvdG90eXBlLnRyaW0sSD1BcnJheS5wcm90b3R5cGUuaW5kZXhPZixJPXt9O2UuZm49ZS5wcm90b3R5cGU9e2NvbnN0cnVjdG9yOmUsaW5pdDpmdW5jdGlvbihhLGQsZil7dmFyIGcsaCxqLGs7aWYoIWEpe3JldHVybiB0aGlzfWlmKGEubm9kZVR5cGUpe3RoaXMuY29udGV4dD10aGlzWzBdPWE7dGhpcy5sZW5ndGg9MTtyZXR1cm4gdGhpc31pZihhPT09XCJib2R5XCImJiFkJiZjLmJvZHkpe3RoaXMuY29udGV4dD1jO3RoaXNbMF09Yy5ib2R5O3RoaXMuc2VsZWN0b3I9YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKHR5cGVvZiBhPT09XCJzdHJpbmdcIil7aWYoYS5jaGFyQXQoMCk9PT1cIjxcIiYmYS5jaGFyQXQoYS5sZW5ndGgtMSk9PT1cIj5cIiYmYS5sZW5ndGg+PTMpe2c9W251bGwsYSxudWxsXX1lbHNle2c9aS5leGVjKGEpfWlmKGcmJihnWzFdfHwhZCkpe2lmKGdbMV0pe2Q9ZCBpbnN0YW5jZW9mIGU/ZFswXTpkO2s9ZD9kLm93bmVyRG9jdW1lbnR8fGQ6YztqPW4uZXhlYyhhKTtpZihqKXtpZihlLmlzUGxhaW5PYmplY3QoZCkpe2E9W2MuY3JlYXRlRWxlbWVudChqWzFdKV07ZS5mbi5hdHRyLmNhbGwoYSxkLHRydWUpfWVsc2V7YT1bay5jcmVhdGVFbGVtZW50KGpbMV0pXX19ZWxzZXtqPWUuYnVpbGRGcmFnbWVudChbZ1sxXV0sW2tdKTthPShqLmNhY2hlYWJsZT9lLmNsb25lKGouZnJhZ21lbnQpOmouZnJhZ21lbnQpLmNoaWxkTm9kZXN9cmV0dXJuIGUubWVyZ2UodGhpcyxhKX1lbHNle2g9Yy5nZXRFbGVtZW50QnlJZChnWzJdKTtpZihoJiZoLnBhcmVudE5vZGUpe2lmKGguaWQhPT1nWzJdKXtyZXR1cm4gZi5maW5kKGEpfXRoaXMubGVuZ3RoPTE7dGhpc1swXT1ofXRoaXMuY29udGV4dD1jO3RoaXMuc2VsZWN0b3I9YTtyZXR1cm4gdGhpc319ZWxzZSBpZighZHx8ZC5qcXVlcnkpe3JldHVybihkfHxmKS5maW5kKGEpfWVsc2V7cmV0dXJuIHRoaXMuY29uc3RydWN0b3IoZCkuZmluZChhKX19ZWxzZSBpZihlLmlzRnVuY3Rpb24oYSkpe3JldHVybiBmLnJlYWR5KGEpfWlmKGEuc2VsZWN0b3IhPT1iKXt0aGlzLnNlbGVjdG9yPWEuc2VsZWN0b3I7dGhpcy5jb250ZXh0PWEuY29udGV4dH1yZXR1cm4gZS5tYWtlQXJyYXkoYSx0aGlzKX0sc2VsZWN0b3I6XCJcIixqcXVlcnk6XCIxLjYuM3ByZVwiLGxlbmd0aDowLHNpemU6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5sZW5ndGh9LHRvQXJyYXk6ZnVuY3Rpb24oKXtyZXR1cm4gRi5jYWxsKHRoaXMsMCl9LGdldDpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD90aGlzLnRvQXJyYXkoKTphPDA/dGhpc1t0aGlzLmxlbmd0aCthXTp0aGlzW2FdfSxwdXNoU3RhY2s6ZnVuY3Rpb24oYSxiLGMpe3ZhciBkPXRoaXMuY29uc3RydWN0b3IoKTtpZihlLmlzQXJyYXkoYSkpe0UuYXBwbHkoZCxhKX1lbHNle2UubWVyZ2UoZCxhKX1kLnByZXZPYmplY3Q9dGhpcztkLmNvbnRleHQ9dGhpcy5jb250ZXh0O2lmKGI9PT1cImZpbmRcIil7ZC5zZWxlY3Rvcj10aGlzLnNlbGVjdG9yKyh0aGlzLnNlbGVjdG9yP1wiIFwiOlwiXCIpK2N9ZWxzZSBpZihiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrXCIuXCIrYitcIihcIitjK1wiKVwifXJldHVybiBkfSxlYWNoOmZ1bmN0aW9uKGEsYil7cmV0dXJuIGUuZWFjaCh0aGlzLGEsYil9LHJlYWR5OmZ1bmN0aW9uKGEpe2UuYmluZFJlYWR5KCk7QS5kb25lKGEpO3JldHVybiB0aGlzfSxlcTpmdW5jdGlvbihhKXtyZXR1cm4gYT09PS0xP3RoaXMuc2xpY2UoYSk6dGhpcy5zbGljZShhLCthKzEpfSxmaXJzdDpmdW5jdGlvbigpe3JldHVybiB0aGlzLmVxKDApfSxsYXN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoLTEpfSxzbGljZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLnB1c2hTdGFjayhGLmFwcGx5KHRoaXMsYXJndW1lbnRzKSxcInNsaWNlXCIsRi5jYWxsKGFyZ3VtZW50cykuam9pbihcIixcIikpfSxtYXA6ZnVuY3Rpb24oYSl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKGUubWFwKHRoaXMsZnVuY3Rpb24oYixjKXtyZXR1cm4gYS5jYWxsKGIsYyxiKX0pKX0sZW5kOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHJldk9iamVjdHx8dGhpcy5jb25zdHJ1Y3RvcihudWxsKX0scHVzaDpFLHNvcnQ6W10uc29ydCxzcGxpY2U6W10uc3BsaWNlfTtlLmZuLmluaXQucHJvdG90eXBlPWUuZm47ZS5leHRlbmQ9ZS5mbi5leHRlbmQ9ZnVuY3Rpb24oKXt2YXIgYSxjLGQsZixnLGgsaT1hcmd1bWVudHNbMF18fHt9LGo9MSxrPWFyZ3VtZW50cy5sZW5ndGgsbD1mYWxzZTtpZih0eXBlb2YgaT09PVwiYm9vbGVhblwiKXtsPWk7aT1hcmd1bWVudHNbMV18fHt9O2o9Mn1pZih0eXBlb2YgaSE9PVwib2JqZWN0XCImJiFlLmlzRnVuY3Rpb24oaSkpe2k9e319aWYoaz09PWope2k9dGhpczstLWp9Zm9yKDtqPGs7aisrKXtpZigoYT1hcmd1bWVudHNbal0pIT1udWxsKXtmb3IoYyBpbiBhKXtkPWlbY107Zj1hW2NdO2lmKGk9PT1mKXtjb250aW51ZX1pZihsJiZmJiYoZS5pc1BsYWluT2JqZWN0KGYpfHwoZz1lLmlzQXJyYXkoZikpKSl7aWYoZyl7Zz1mYWxzZTtoPWQmJmUuaXNBcnJheShkKT9kOltdfWVsc2V7aD1kJiZlLmlzUGxhaW5PYmplY3QoZCk/ZDp7fX1pW2NdPWUuZXh0ZW5kKGwsaCxmKX1lbHNlIGlmKGYhPT1iKXtpW2NdPWZ9fX19cmV0dXJuIGl9O2UuZXh0ZW5kKHtub0NvbmZsaWN0OmZ1bmN0aW9uKGIpe2lmKGEuJD09PWUpe2EuJD1nfWlmKGImJmEualF1ZXJ5PT09ZSl7YS5qUXVlcnk9Zn1yZXR1cm4gZX0saXNSZWFkeTpmYWxzZSxyZWFkeVdhaXQ6MSxob2xkUmVhZHk6ZnVuY3Rpb24oYSl7aWYoYSl7ZS5yZWFkeVdhaXQrK31lbHNle2UucmVhZHkodHJ1ZSl9fSxyZWFkeTpmdW5jdGlvbihhKXtpZihhPT09dHJ1ZSYmIS0tZS5yZWFkeVdhaXR8fGEhPT10cnVlJiYhZS5pc1JlYWR5KXtpZighYy5ib2R5KXtyZXR1cm4gc2V0VGltZW91dChlLnJlYWR5LDEpfWUuaXNSZWFkeT10cnVlO2lmKGEhPT10cnVlJiYtLWUucmVhZHlXYWl0PjApe3JldHVybn1BLnJlc29sdmVXaXRoKGMsW2VdKTtpZihlLmZuLnRyaWdnZXIpe2UoYykudHJpZ2dlcihcInJlYWR5XCIpLnVuYmluZChcInJlYWR5XCIpfX19LGJpbmRSZWFkeTpmdW5jdGlvbigpe2lmKEEpe3JldHVybn1BPWUuX0RlZmVycmVkKCk7aWYoYy5yZWFkeVN0YXRlPT09XCJjb21wbGV0ZVwiKXtyZXR1cm4gc2V0VGltZW91dChlLnJlYWR5LDEpfWlmKGMuYWRkRXZlbnRMaXN0ZW5lcil7Yy5hZGRFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLEIsZmFsc2UpO2EuYWRkRXZlbnRMaXN0ZW5lcihcImxvYWRcIixlLnJlYWR5LGZhbHNlKX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe2MuYXR0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTthLmF0dGFjaEV2ZW50KFwib25sb2FkXCIsZS5yZWFkeSk7dmFyIGI9ZmFsc2U7dHJ5e2I9YS5mcmFtZUVsZW1lbnQ9PW51bGx9Y2F0Y2goZCl7fWlmKGMuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsJiZiKXtKKCl9fX0saXNGdW5jdGlvbjpmdW5jdGlvbihhKXtyZXR1cm4gZS50eXBlKGEpPT09XCJmdW5jdGlvblwifSxpc0FycmF5OkFycmF5LmlzQXJyYXl8fGZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImFycmF5XCJ9LGlzV2luZG93OmZ1bmN0aW9uKGEpe3JldHVybiBhJiZ0eXBlb2YgYT09PVwib2JqZWN0XCImJlwic2V0SW50ZXJ2YWxcImluIGF9LGlzTmFOOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsfHwhbS50ZXN0KGEpfHxpc05hTihhKX0sdHlwZTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9TdHJpbmcoYSk6SVtDLmNhbGwoYSldfHxcIm9iamVjdFwifSxpc1BsYWluT2JqZWN0OmZ1bmN0aW9uKGEpe2lmKCFhfHxlLnR5cGUoYSkhPT1cIm9iamVjdFwifHxhLm5vZGVUeXBlfHxlLmlzV2luZG93KGEpKXtyZXR1cm4gZmFsc2V9aWYoYS5jb25zdHJ1Y3RvciYmIUQuY2FsbChhLFwiY29uc3RydWN0b3JcIikmJiFELmNhbGwoYS5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsXCJpc1Byb3RvdHlwZU9mXCIpKXtyZXR1cm4gZmFsc2V9dmFyIGM7Zm9yKGMgaW4gYSl7fXJldHVybiBjPT09Ynx8RC5jYWxsKGEsYyl9LGlzRW1wdHlPYmplY3Q6ZnVuY3Rpb24oYSl7Zm9yKHZhciBiIGluIGEpe3JldHVybiBmYWxzZX1yZXR1cm4gdHJ1ZX0sZXJyb3I6ZnVuY3Rpb24oYSl7dGhyb3cgYX0scGFyc2VKU09OOmZ1bmN0aW9uKGIpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcInx8IWIpe3JldHVybiBudWxsfWI9ZS50cmltKGIpO2lmKGEuSlNPTiYmYS5KU09OLnBhcnNlKXtyZXR1cm4gYS5KU09OLnBhcnNlKGIpfWlmKG8udGVzdChiLnJlcGxhY2UocCxcIkBcIikucmVwbGFjZShxLFwiXVwiKS5yZXBsYWNlKHIsXCJcIikpKXtyZXR1cm4obmV3IEZ1bmN0aW9uKFwicmV0dXJuIFwiK2IpKSgpfWUuZXJyb3IoXCJJbnZhbGlkIEpTT046IFwiK2IpfSxwYXJzZVhNTDpmdW5jdGlvbihjKXt2YXIgZCxmO3RyeXtpZihhLkRPTVBhcnNlcil7Zj1uZXcgRE9NUGFyc2VyO2Q9Zi5wYXJzZUZyb21TdHJpbmcoYyxcInRleHQveG1sXCIpfWVsc2V7ZD1uZXcgQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxET01cIik7ZC5hc3luYz1cImZhbHNlXCI7ZC5sb2FkWE1MKGMpfX1jYXRjaChnKXtkPWJ9aWYoIWR8fCFkLmRvY3VtZW50RWxlbWVudHx8ZC5nZXRFbGVtZW50c0J5VGFnTmFtZShcInBhcnNlcmVycm9yXCIpLmxlbmd0aCl7ZS5lcnJvcihcIkludmFsaWQgWE1MOiBcIitjKX1yZXR1cm4gZH0sbm9vcDpmdW5jdGlvbigpe30sZ2xvYmFsRXZhbDpmdW5jdGlvbihiKXtpZihiJiZqLnRlc3QoYikpeyhhLmV4ZWNTY3JpcHR8fGZ1bmN0aW9uKGIpe2FbXCJldmFsXCJdLmNhbGwoYSxiKX0pKGIpfX0sY2FtZWxDYXNlOmZ1bmN0aW9uKGEpe3JldHVybiBhLnJlcGxhY2Uodyx4KX0sbm9kZU5hbWU6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYS5ub2RlTmFtZSYmYS5ub2RlTmFtZS50b1VwcGVyQ2FzZSgpPT09Yi50b1VwcGVyQ2FzZSgpfSxlYWNoOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnPTAsaD1hLmxlbmd0aCxpPWg9PT1ifHxlLmlzRnVuY3Rpb24oYSk7aWYoZCl7aWYoaSl7Zm9yKGYgaW4gYSl7aWYoYy5hcHBseShhW2ZdLGQpPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuYXBwbHkoYVtnKytdLGQpPT09ZmFsc2Upe2JyZWFrfX19fWVsc2V7aWYoaSl7Zm9yKGYgaW4gYSl7aWYoYy5jYWxsKGFbZl0sZixhW2ZdKT09PWZhbHNlKXticmVha319fWVsc2V7Zm9yKDtnPGg7KXtpZihjLmNhbGwoYVtnXSxnLGFbZysrXSk9PT1mYWxzZSl7YnJlYWt9fX19cmV0dXJuIGF9LHRyaW06Rz9mdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOkcuY2FsbChhKX06ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/XCJcIjphLnRvU3RyaW5nKCkucmVwbGFjZShrLFwiXCIpLnJlcGxhY2UobCxcIlwiKX0sbWFrZUFycmF5OmZ1bmN0aW9uKGEsYil7dmFyIGM9Ynx8W107aWYoYSE9bnVsbCl7dmFyIGQ9ZS50eXBlKGEpO2lmKGEubGVuZ3RoPT1udWxsfHxkPT09XCJzdHJpbmdcInx8ZD09PVwiZnVuY3Rpb25cInx8ZD09PVwicmVnZXhwXCJ8fGUuaXNXaW5kb3coYSkpe0UuY2FsbChjLGEpfWVsc2V7ZS5tZXJnZShjLGEpfX1yZXR1cm4gY30saW5BcnJheTpmdW5jdGlvbihhLGIpe2lmKEgpe3JldHVybiBILmNhbGwoYixhKX1mb3IodmFyIGM9MCxkPWIubGVuZ3RoO2M8ZDtjKyspe2lmKGJbY109PT1hKXtyZXR1cm4gY319cmV0dXJuLTF9LG1lcmdlOmZ1bmN0aW9uKGEsYyl7dmFyIGQ9YS5sZW5ndGgsZT0wO2lmKHR5cGVvZiBjLmxlbmd0aD09PVwibnVtYmVyXCIpe2Zvcih2YXIgZj1jLmxlbmd0aDtlPGY7ZSsrKXthW2QrK109Y1tlXX19ZWxzZXt3aGlsZShjW2VdIT09Yil7YVtkKytdPWNbZSsrXX19YS5sZW5ndGg9ZDtyZXR1cm4gYX0sZ3JlcDpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9W10sZTtjPSEhYztmb3IodmFyIGY9MCxnPWEubGVuZ3RoO2Y8ZztmKyspe2U9ISFiKGFbZl0sZik7aWYoYyE9PWUpe2QucHVzaChhW2ZdKX19cmV0dXJuIGR9LG1hcDpmdW5jdGlvbihhLGMsZCl7dmFyIGYsZyxoPVtdLGk9MCxqPWEubGVuZ3RoLGs9YSBpbnN0YW5jZW9mIGV8fGohPT1iJiZ0eXBlb2Ygaj09PVwibnVtYmVyXCImJihqPjAmJmFbMF0mJmFbai0xXXx8aj09PTB8fGUuaXNBcnJheShhKSk7aWYoayl7Zm9yKDtpPGo7aSsrKXtmPWMoYVtpXSxpLGQpO2lmKGYhPW51bGwpe2hbaC5sZW5ndGhdPWZ9fX1lbHNle2ZvcihnIGluIGEpe2Y9YyhhW2ddLGcsZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fXJldHVybiBoLmNvbmNhdC5hcHBseShbXSxoKX0sZ3VpZDoxLHByb3h5OmZ1bmN0aW9uKGEsYyl7aWYodHlwZW9mIGM9PT1cInN0cmluZ1wiKXt2YXIgZD1hW2NdO2M9YTthPWR9aWYoIWUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGJ9dmFyIGY9Ri5jYWxsKGFyZ3VtZW50cywyKSxnPWZ1bmN0aW9uKCl7cmV0dXJuIGEuYXBwbHkoYyxmLmNvbmNhdChGLmNhbGwoYXJndW1lbnRzKSkpfTtnLmd1aWQ9YS5ndWlkPWEuZ3VpZHx8Zy5ndWlkfHxlLmd1aWQrKztyZXR1cm4gZ30sYWNjZXNzOmZ1bmN0aW9uKGEsYyxkLGYsZyxoKXt2YXIgaT1hLmxlbmd0aDtpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2Zvcih2YXIgaiBpbiBjKXtlLmFjY2VzcyhhLGosY1tqXSxmLGcsZCl9cmV0dXJuIGF9aWYoZCE9PWIpe2Y9IWgmJmYmJmUuaXNGdW5jdGlvbihkKTtmb3IodmFyIGs9MDtrPGk7aysrKXtnKGFba10sYyxmP2QuY2FsbChhW2tdLGssZyhhW2tdLGMpKTpkLGgpfXJldHVybiBhfXJldHVybiBpP2coYVswXSxjKTpifSxub3c6ZnVuY3Rpb24oKXtyZXR1cm4obmV3IERhdGUpLmdldFRpbWUoKX0sdWFNYXRjaDpmdW5jdGlvbihhKXthPWEudG9Mb3dlckNhc2UoKTt2YXIgYj1zLmV4ZWMoYSl8fHQuZXhlYyhhKXx8dS5leGVjKGEpfHxhLmluZGV4T2YoXCJjb21wYXRpYmxlXCIpPDAmJnYuZXhlYyhhKXx8W107cmV0dXJue2Jyb3dzZXI6YlsxXXx8XCJcIix2ZXJzaW9uOmJbMl18fFwiMFwifX0sc3ViOmZ1bmN0aW9uKCl7ZnVuY3Rpb24gYShiLGMpe3JldHVybiBuZXcgYS5mbi5pbml0KGIsYyl9ZS5leHRlbmQodHJ1ZSxhLHRoaXMpO2Euc3VwZXJjbGFzcz10aGlzO2EuZm49YS5wcm90b3R5cGU9dGhpcygpO2EuZm4uY29uc3RydWN0b3I9YTthLnN1Yj10aGlzLnN1YjthLmZuLmluaXQ9ZnVuY3Rpb24gZChjLGQpe2lmKGQmJmQgaW5zdGFuY2VvZiBlJiYhKGQgaW5zdGFuY2VvZiBhKSl7ZD1hKGQpfXJldHVybiBlLmZuLmluaXQuY2FsbCh0aGlzLGMsZCxiKX07YS5mbi5pbml0LnByb3RvdHlwZT1hLmZuO3ZhciBiPWEoYyk7cmV0dXJuIGF9LGJyb3dzZXI6e319KTtlLmVhY2goXCJCb29sZWFuIE51bWJlciBTdHJpbmcgRnVuY3Rpb24gQXJyYXkgRGF0ZSBSZWdFeHAgT2JqZWN0XCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7SVtcIltvYmplY3QgXCIrYitcIl1cIl09Yi50b0xvd2VyQ2FzZSgpfSk7ej1lLnVhTWF0Y2goeSk7aWYoei5icm93c2VyKXtlLmJyb3dzZXJbei5icm93c2VyXT10cnVlO2UuYnJvd3Nlci52ZXJzaW9uPXoudmVyc2lvbn1pZihlLmJyb3dzZXIud2Via2l0KXtlLmJyb3dzZXIuc2FmYXJpPXRydWV9aWYoai50ZXN0KFwiwqBcIikpe2s9L15bXFxzXFx4QTBdKy87bD0vW1xcc1xceEEwXSskL31oPWUoYyk7aWYoYy5hZGRFdmVudExpc3RlbmVyKXtCPWZ1bmN0aW9uKCl7Yy5yZW1vdmVFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLEIsZmFsc2UpO2UucmVhZHkoKX19ZWxzZSBpZihjLmF0dGFjaEV2ZW50KXtCPWZ1bmN0aW9uKCl7aWYoYy5yZWFkeVN0YXRlPT09XCJjb21wbGV0ZVwiKXtjLmRldGFjaEV2ZW50KFwib25yZWFkeXN0YXRlY2hhbmdlXCIsQik7ZS5yZWFkeSgpfX19cmV0dXJuIGV9KCk7dmFyIGc9XCJkb25lIGZhaWwgaXNSZXNvbHZlZCBpc1JlamVjdGVkIHByb21pc2UgdGhlbiBhbHdheXMgcGlwZVwiLnNwbGl0KFwiIFwiKSxoPVtdLnNsaWNlO2YuZXh0ZW5kKHtfRGVmZXJyZWQ6ZnVuY3Rpb24oKXt2YXIgYT1bXSxiLGMsZCxlPXtkb25lOmZ1bmN0aW9uKCl7aWYoIWQpe3ZhciBjPWFyZ3VtZW50cyxnLGgsaSxqLGs7aWYoYil7az1iO2I9MH1mb3IoZz0wLGg9Yy5sZW5ndGg7ZzxoO2crKyl7aT1jW2ddO2o9Zi50eXBlKGkpO2lmKGo9PT1cImFycmF5XCIpe2UuZG9uZS5hcHBseShlLGkpfWVsc2UgaWYoaj09PVwiZnVuY3Rpb25cIil7YS5wdXNoKGkpfX1pZihrKXtlLnJlc29sdmVXaXRoKGtbMF0sa1sxXSl9fXJldHVybiB0aGlzfSxyZXNvbHZlV2l0aDpmdW5jdGlvbihlLGYpe2lmKCFkJiYhYiYmIWMpe2Y9Znx8W107Yz0xO3RyeXt3aGlsZShhWzBdKXthLnNoaWZ0KCkuYXBwbHkoZSxmKX19ZmluYWxseXtiPVtlLGZdO2M9MH19cmV0dXJuIHRoaXN9LHJlc29sdmU6ZnVuY3Rpb24oKXtlLnJlc29sdmVXaXRoKHRoaXMsYXJndW1lbnRzKTtyZXR1cm4gdGhpc30saXNSZXNvbHZlZDpmdW5jdGlvbigpe3JldHVybiEhKGN8fGIpfSxjYW5jZWw6ZnVuY3Rpb24oKXtkPTE7YT1bXTtyZXR1cm4gdGhpc319O3JldHVybiBlfSxEZWZlcnJlZDpmdW5jdGlvbihhKXt2YXIgYj1mLl9EZWZlcnJlZCgpLGM9Zi5fRGVmZXJyZWQoKSxkO2YuZXh0ZW5kKGIse3RoZW46ZnVuY3Rpb24oYSxjKXtiLmRvbmUoYSkuZmFpbChjKTtyZXR1cm4gdGhpc30sYWx3YXlzOmZ1bmN0aW9uKCl7cmV0dXJuIGIuZG9uZS5hcHBseShiLGFyZ3VtZW50cykuZmFpbC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9LGZhaWw6Yy5kb25lLHJlamVjdFdpdGg6Yy5yZXNvbHZlV2l0aCxyZWplY3Q6Yy5yZXNvbHZlLGlzUmVqZWN0ZWQ6Yy5pc1Jlc29sdmVkLHBpcGU6ZnVuY3Rpb24oYSxjKXtyZXR1cm4gZi5EZWZlcnJlZChmdW5jdGlvbihkKXtmLmVhY2goe2RvbmU6W2EsXCJyZXNvbHZlXCJdLGZhaWw6W2MsXCJyZWplY3RcIl19LGZ1bmN0aW9uKGEsYyl7dmFyIGU9Y1swXSxnPWNbMV0saDtpZihmLmlzRnVuY3Rpb24oZSkpe2JbYV0oZnVuY3Rpb24oKXtoPWUuYXBwbHkodGhpcyxhcmd1bWVudHMpO2lmKGgmJmYuaXNGdW5jdGlvbihoLnByb21pc2UpKXtoLnByb21pc2UoKS50aGVuKGQucmVzb2x2ZSxkLnJlamVjdCl9ZWxzZXtkW2crXCJXaXRoXCJdKHRoaXM9PT1iP2Q6dGhpcyxbaF0pfX0pfWVsc2V7YlthXShkW2ddKX19KX0pLnByb21pc2UoKX0scHJvbWlzZTpmdW5jdGlvbihhKXtpZihhPT1udWxsKXtpZihkKXtyZXR1cm4gZH1kPWE9e319dmFyIGM9Zy5sZW5ndGg7d2hpbGUoYy0tKXthW2dbY11dPWJbZ1tjXV19cmV0dXJuIGF9fSk7Yi5kb25lKGMuY2FuY2VsKS5mYWlsKGIuY2FuY2VsKTtkZWxldGUgYi5jYW5jZWw7aWYoYSl7YS5jYWxsKGIsYil9cmV0dXJuIGJ9LHdoZW46ZnVuY3Rpb24oYSl7ZnVuY3Rpb24gaShhKXtyZXR1cm4gZnVuY3Rpb24oYyl7YlthXT1hcmd1bWVudHMubGVuZ3RoPjE/aC5jYWxsKGFyZ3VtZW50cywwKTpjO2lmKCEtLWUpe2cucmVzb2x2ZVdpdGgoZyxoLmNhbGwoYiwwKSl9fX12YXIgYj1hcmd1bWVudHMsYz0wLGQ9Yi5sZW5ndGgsZT1kLGc9ZDw9MSYmYSYmZi5pc0Z1bmN0aW9uKGEucHJvbWlzZSk/YTpmLkRlZmVycmVkKCk7aWYoZD4xKXtmb3IoO2M8ZDtjKyspe2lmKGJbY10mJmYuaXNGdW5jdGlvbihiW2NdLnByb21pc2UpKXtiW2NdLnByb21pc2UoKS50aGVuKGkoYyksZy5yZWplY3QpfWVsc2V7LS1lfX1pZighZSl7Zy5yZXNvbHZlV2l0aChnLGIpfX1lbHNlIGlmKGchPT1hKXtnLnJlc29sdmVXaXRoKGcsZD9bYV06W10pfXJldHVybiBnLnByb21pc2UoKX19KTtmLnN1cHBvcnQ9Zi5zdXBwb3J0fHx7fTt2YXIgaT0vJTIwL2csaj0vXFxbXFxdJC8saz0vXFxyP1xcbi9nLGw9LyMuKiQvLG09L14oLio/KTpbIFxcdF0qKFteXFxyXFxuXSopXFxyPyQvbWcsbj0vXig/OmNvbG9yfGRhdGV8ZGF0ZXRpbWV8ZW1haWx8aGlkZGVufG1vbnRofG51bWJlcnxwYXNzd29yZHxyYW5nZXxzZWFyY2h8dGVsfHRleHR8dGltZXx1cmx8d2VlaykkL2ksbz0vXig/OmFib3V0fGFwcHxhcHBcXC1zdG9yYWdlfC4rXFwtZXh0ZW5zaW9ufGZpbGV8cmVzfHdpZGdldCk6JC8scD0vXig/OkdFVHxIRUFEKSQvLHE9L15cXC9cXC8vLHI9L1xcPy8scz0vPHNjcmlwdFxcYltePF0qKD86KD8hPFxcL3NjcmlwdD4pPFtePF0qKSo8XFwvc2NyaXB0Pi9naSx0PS9eKD86c2VsZWN0fHRleHRhcmVhKS9pLHU9L1xccysvLHY9LyhbPyZdKV89W14mXSovLHc9L14oW1xcd1xcK1xcLlxcLV0rOikoPzpcXC9cXC8oW15cXC8/IzpdKikoPzo6KFxcZCspKT8pPy8seD1mLmZuLmxvYWQseT17fSx6PXt9LEEsQjt0cnl7QT1lLmhyZWZ9Y2F0Y2goQyl7QT1jLmNyZWF0ZUVsZW1lbnQoXCJhXCIpO0EuaHJlZj1cIlwiO0E9QS5ocmVmfUI9dy5leGVjKEEudG9Mb3dlckNhc2UoKSl8fFtdO2YuZm4uZXh0ZW5kKHtsb2FkOmZ1bmN0aW9uKGEsYyxkKXtpZih0eXBlb2YgYSE9PVwic3RyaW5nXCImJngpe3JldHVybiB4LmFwcGx5KHRoaXMsYXJndW1lbnRzKX1lbHNlIGlmKCF0aGlzLmxlbmd0aCl7cmV0dXJuIHRoaXN9dmFyIGU9YS5pbmRleE9mKFwiIFwiKTtpZihlPj0wKXt2YXIgZz1hLnNsaWNlKGUsYS5sZW5ndGgpO2E9YS5zbGljZSgwLGUpfXZhciBoPVwiR0VUXCI7aWYoYyl7aWYoZi5pc0Z1bmN0aW9uKGMpKXtkPWM7Yz1ifWVsc2UgaWYodHlwZW9mIGM9PT1cIm9iamVjdFwiKXtjPWYucGFyYW0oYyxmLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbCk7aD1cIlBPU1RcIn19dmFyIGk9dGhpcztmLmFqYXgoe3VybDphLHR5cGU6aCxkYXRhVHlwZTpcImh0bWxcIixkYXRhOmMsY29tcGxldGU6ZnVuY3Rpb24oYSxiLGMpe2M9YS5yZXNwb25zZVRleHQ7aWYoYS5pc1Jlc29sdmVkKCkpe2EuZG9uZShmdW5jdGlvbihhKXtjPWF9KTtpLmh0bWwoZz9mKFwiPGRpdj5cIikuYXBwZW5kKGMucmVwbGFjZShzLFwiXCIpKS5maW5kKGcpOmMpfWlmKGQpe2kuZWFjaChkLFtjLGIsYV0pfX19KTtyZXR1cm4gdGhpc30sc2VyaWFsaXplOmZ1bmN0aW9uKCl7cmV0dXJuIGYucGFyYW0odGhpcy5zZXJpYWxpemVBcnJheSgpKX0sc2VyaWFsaXplQXJyYXk6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5tYXAoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lbGVtZW50cz9mLm1ha2VBcnJheSh0aGlzLmVsZW1lbnRzKTp0aGlzfSkuZmlsdGVyKGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubmFtZSYmIXRoaXMuZGlzYWJsZWQmJih0aGlzLmNoZWNrZWR8fHQudGVzdCh0aGlzLm5vZGVOYW1lKXx8bi50ZXN0KHRoaXMudHlwZSkpfSkubWFwKGZ1bmN0aW9uKGEsYil7dmFyIGM9Zih0aGlzKS52YWwoKTtyZXR1cm4gYz09bnVsbD9udWxsOmYuaXNBcnJheShjKT9mLm1hcChjLGZ1bmN0aW9uKGEsYyl7cmV0dXJue25hbWU6Yi5uYW1lLHZhbHVlOmEucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pOntuYW1lOmIubmFtZSx2YWx1ZTpjLnJlcGxhY2UoayxcIlxcclxcblwiKX19KS5nZXQoKX19KTtmLmVhY2goXCJhamF4U3RhcnQgYWpheFN0b3AgYWpheENvbXBsZXRlIGFqYXhFcnJvciBhamF4U3VjY2VzcyBhamF4U2VuZFwiLnNwbGl0KFwiIFwiKSxmdW5jdGlvbihhLGIpe2YuZm5bYl09ZnVuY3Rpb24oYSl7cmV0dXJuIHRoaXMuYmluZChiLGEpfX0pO2YuZWFjaChbXCJnZXRcIixcInBvc3RcIl0sZnVuY3Rpb24oYSxjKXtmW2NdPWZ1bmN0aW9uKGEsZCxlLGcpe2lmKGYuaXNGdW5jdGlvbihkKSl7Zz1nfHxlO2U9ZDtkPWJ9cmV0dXJuIGYuYWpheCh7dHlwZTpjLHVybDphLGRhdGE6ZCxzdWNjZXNzOmUsZGF0YVR5cGU6Z30pfX0pO2YuZXh0ZW5kKHtnZXRTY3JpcHQ6ZnVuY3Rpb24oYSxjKXtyZXR1cm4gZi5nZXQoYSxiLGMsXCJzY3JpcHRcIil9LGdldEpTT046ZnVuY3Rpb24oYSxiLGMpe3JldHVybiBmLmdldChhLGIsYyxcImpzb25cIil9LGFqYXhTZXR1cDpmdW5jdGlvbihhLGIpe2lmKGIpe0YoYSxmLmFqYXhTZXR0aW5ncyl9ZWxzZXtiPWE7YT1mLmFqYXhTZXR0aW5nc31GKGEsYik7cmV0dXJuIGF9LGFqYXhTZXR0aW5nczp7dXJsOkEsaXNMb2NhbDpvLnRlc3QoQlsxXSksZ2xvYmFsOnRydWUsdHlwZTpcIkdFVFwiLGNvbnRlbnRUeXBlOlwiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkXCIscHJvY2Vzc0RhdGE6dHJ1ZSxhc3luYzp0cnVlLGFjY2VwdHM6e3htbDpcImFwcGxpY2F0aW9uL3htbCwgdGV4dC94bWxcIixodG1sOlwidGV4dC9odG1sXCIsdGV4dDpcInRleHQvcGxhaW5cIixqc29uOlwiYXBwbGljYXRpb24vanNvbiwgdGV4dC9qYXZhc2NyaXB0XCIsXCIqXCI6XCIqLypcIn0sY29udGVudHM6e3htbDoveG1sLyxodG1sOi9odG1sLyxqc29uOi9qc29uL30scmVzcG9uc2VGaWVsZHM6e3htbDpcInJlc3BvbnNlWE1MXCIsdGV4dDpcInJlc3BvbnNlVGV4dFwifSxjb252ZXJ0ZXJzOntcIiogdGV4dFwiOmEuU3RyaW5nLFwidGV4dCBodG1sXCI6dHJ1ZSxcInRleHQganNvblwiOmYucGFyc2VKU09OLFwidGV4dCB4bWxcIjpmLnBhcnNlWE1MfSxmbGF0T3B0aW9uczp7Y29udGV4dDp0cnVlLHVybDp0cnVlfX0sYWpheFByZWZpbHRlcjpEKHkpLGFqYXhUcmFuc3BvcnQ6RCh6KSxhamF4OmZ1bmN0aW9uKGEsYyl7ZnVuY3Rpb24gSyhhLGMsbCxtKXtpZihEPT09Mil7cmV0dXJufUQ9MjtpZihBKXtjbGVhclRpbWVvdXQoQSl9eD1iO3M9bXx8XCJcIjtKLnJlYWR5U3RhdGU9YT4wPzQ6MDt2YXIgbixvLHAscT1jLHI9bD9IKGQsSixsKTpiLHQsdTtpZihhPj0yMDAmJmE8MzAwfHxhPT09MzA0KXtpZihkLmlmTW9kaWZpZWQpe2lmKHQ9Si5nZXRSZXNwb25zZUhlYWRlcihcIkxhc3QtTW9kaWZpZWRcIikpe2YubGFzdE1vZGlmaWVkW2tdPXR9aWYodT1KLmdldFJlc3BvbnNlSGVhZGVyKFwiRXRhZ1wiKSl7Zi5ldGFnW2tdPXV9fWlmKGE9PT0zMDQpe3E9XCJub3Rtb2RpZmllZFwiO249dHJ1ZX1lbHNle3RyeXtvPUkoZCxyKTtxPVwic3VjY2Vzc1wiO249dHJ1ZX1jYXRjaCh2KXtxPVwicGFyc2VyZXJyb3JcIjtwPXZ9fX1lbHNle3A9cTtpZighcXx8YSl7cT1cImVycm9yXCI7aWYoYTwwKXthPTB9fX1KLnN0YXR1cz1hO0ouc3RhdHVzVGV4dD1cIlwiKyhjfHxxKTtpZihuKXtoLnJlc29sdmVXaXRoKGUsW28scSxKXSl9ZWxzZXtoLnJlamVjdFdpdGgoZSxbSixxLHBdKX1KLnN0YXR1c0NvZGUoaik7aj1iO2lmKEYpe2cudHJpZ2dlcihcImFqYXhcIisobj9cIlN1Y2Nlc3NcIjpcIkVycm9yXCIpLFtKLGQsbj9vOnBdKX1pLnJlc29sdmVXaXRoKGUsW0oscV0pO2lmKEYpe2cudHJpZ2dlcihcImFqYXhDb21wbGV0ZVwiLFtKLGRdKTtpZighLS1mLmFjdGl2ZSl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0b3BcIil9fX1pZih0eXBlb2YgYT09PVwib2JqZWN0XCIpe2M9YTthPWJ9Yz1jfHx7fTt2YXIgZD1mLmFqYXhTZXR1cCh7fSxjKSxlPWQuY29udGV4dHx8ZCxnPWUhPT1kJiYoZS5ub2RlVHlwZXx8ZSBpbnN0YW5jZW9mIGYpP2YoZSk6Zi5ldmVudCxoPWYuRGVmZXJyZWQoKSxpPWYuX0RlZmVycmVkKCksaj1kLnN0YXR1c0NvZGV8fHt9LGssbj17fSxvPXt9LHMsdCx4LEEsQyxEPTAsRixHLEo9e3JlYWR5U3RhdGU6MCxzZXRSZXF1ZXN0SGVhZGVyOmZ1bmN0aW9uKGEsYil7aWYoIUQpe3ZhciBjPWEudG9Mb3dlckNhc2UoKTthPW9bY109b1tjXXx8YTtuW2FdPWJ9cmV0dXJuIHRoaXN9LGdldEFsbFJlc3BvbnNlSGVhZGVyczpmdW5jdGlvbigpe3JldHVybiBEPT09Mj9zOm51bGx9LGdldFJlc3BvbnNlSGVhZGVyOmZ1bmN0aW9uKGEpe3ZhciBjO2lmKEQ9PT0yKXtpZighdCl7dD17fTt3aGlsZShjPW0uZXhlYyhzKSl7dFtjWzFdLnRvTG93ZXJDYXNlKCldPWNbMl19fWM9dFthLnRvTG93ZXJDYXNlKCldfXJldHVybiBjPT09Yj9udWxsOmN9LG92ZXJyaWRlTWltZVR5cGU6ZnVuY3Rpb24oYSl7aWYoIUQpe2QubWltZVR5cGU9YX1yZXR1cm4gdGhpc30sYWJvcnQ6ZnVuY3Rpb24oYSl7YT1hfHxcImFib3J0XCI7aWYoeCl7eC5hYm9ydChhKX1LKDAsYSk7cmV0dXJuIHRoaXN9fTtoLnByb21pc2UoSik7Si5zdWNjZXNzPUouZG9uZTtKLmVycm9yPUouZmFpbDtKLmNvbXBsZXRlPWkuZG9uZTtKLnN0YXR1c0NvZGU9ZnVuY3Rpb24oYSl7aWYoYSl7dmFyIGI7aWYoRDwyKXtmb3IoYiBpbiBhKXtqW2JdPVtqW2JdLGFbYl1dfX1lbHNle2I9YVtKLnN0YXR1c107Si50aGVuKGIsYil9fXJldHVybiB0aGlzfTtkLnVybD0oKGF8fGQudXJsKStcIlwiKS5yZXBsYWNlKGwsXCJcIikucmVwbGFjZShxLEJbMV0rXCIvL1wiKTtkLmRhdGFUeXBlcz1mLnRyaW0oZC5kYXRhVHlwZXx8XCIqXCIpLnRvTG93ZXJDYXNlKCkuc3BsaXQodSk7aWYoZC5jcm9zc0RvbWFpbj09bnVsbCl7Qz13LmV4ZWMoZC51cmwudG9Mb3dlckNhc2UoKSk7ZC5jcm9zc0RvbWFpbj0hIShDJiYoQ1sxXSE9QlsxXXx8Q1syXSE9QlsyXXx8KENbM118fChDWzFdPT09XCJodHRwOlwiPzgwOjQ0MykpIT0oQlszXXx8KEJbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkpKX1pZihkLmRhdGEmJmQucHJvY2Vzc0RhdGEmJnR5cGVvZiBkLmRhdGEhPT1cInN0cmluZ1wiKXtkLmRhdGE9Zi5wYXJhbShkLmRhdGEsZC50cmFkaXRpb25hbCl9RSh5LGQsYyxKKTtpZihEPT09Mil7cmV0dXJuIGZhbHNlfUY9ZC5nbG9iYWw7ZC50eXBlPWQudHlwZS50b1VwcGVyQ2FzZSgpO2QuaGFzQ29udGVudD0hcC50ZXN0KGQudHlwZSk7aWYoRiYmZi5hY3RpdmUrKz09PTApe2YuZXZlbnQudHJpZ2dlcihcImFqYXhTdGFydFwiKX1pZighZC5oYXNDb250ZW50KXtpZihkLmRhdGEpe2QudXJsKz0oci50ZXN0KGQudXJsKT9cIiZcIjpcIj9cIikrZC5kYXRhO2RlbGV0ZSBkLmRhdGF9az1kLnVybDtpZihkLmNhY2hlPT09ZmFsc2Upe3ZhciBMPWYubm93KCksTT1kLnVybC5yZXBsYWNlKHYsXCIkMV89XCIrTCk7ZC51cmw9TSsoTT09PWQudXJsPyhyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStcIl89XCIrTDpcIlwiKX19aWYoZC5kYXRhJiZkLmhhc0NvbnRlbnQmJmQuY29udGVudFR5cGUhPT1mYWxzZXx8Yy5jb250ZW50VHlwZSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsZC5jb250ZW50VHlwZSl9aWYoZC5pZk1vZGlmaWVkKXtrPWt8fGQudXJsO2lmKGYubGFzdE1vZGlmaWVkW2tdKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJJZi1Nb2RpZmllZC1TaW5jZVwiLGYubGFzdE1vZGlmaWVkW2tdKX1pZihmLmV0YWdba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU5vbmUtTWF0Y2hcIixmLmV0YWdba10pfX1KLnNldFJlcXVlc3RIZWFkZXIoXCJBY2NlcHRcIixkLmRhdGFUeXBlc1swXSYmZC5hY2NlcHRzW2QuZGF0YVR5cGVzWzBdXT9kLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dKyhkLmRhdGFUeXBlc1swXSE9PVwiKlwiP1wiLCAqLyo7IHE9MC4wMVwiOlwiXCIpOmQuYWNjZXB0c1tcIipcIl0pO2ZvcihHIGluIGQuaGVhZGVycyl7Si5zZXRSZXF1ZXN0SGVhZGVyKEcsZC5oZWFkZXJzW0ddKX1pZihkLmJlZm9yZVNlbmQmJihkLmJlZm9yZVNlbmQuY2FsbChlLEosZCk9PT1mYWxzZXx8RD09PTIpKXtKLmFib3J0KCk7cmV0dXJuIGZhbHNlfWZvcihHIGlue3N1Y2Nlc3M6MSxlcnJvcjoxLGNvbXBsZXRlOjF9KXtKW0ddKGRbR10pfXg9RSh6LGQsYyxKKTtpZigheCl7SygtMSxcIk5vIFRyYW5zcG9ydFwiKX1lbHNle0oucmVhZHlTdGF0ZT0xO2lmKEYpe2cudHJpZ2dlcihcImFqYXhTZW5kXCIsW0osZF0pfWlmKGQuYXN5bmMmJmQudGltZW91dD4wKXtBPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtKLmFib3J0KFwidGltZW91dFwiKX0sZC50aW1lb3V0KX10cnl7RD0xO3guc2VuZChuLEspfWNhdGNoKE4pe2lmKEQ8Mil7SygtMSxOKX1lbHNle2YuZXJyb3IoTil9fX1yZXR1cm4gSn0scGFyYW06ZnVuY3Rpb24oYSxjKXt2YXIgZD1bXSxlPWZ1bmN0aW9uKGEsYil7Yj1mLmlzRnVuY3Rpb24oYik/YigpOmI7ZFtkLmxlbmd0aF09ZW5jb2RlVVJJQ29tcG9uZW50KGEpK1wiPVwiK2VuY29kZVVSSUNvbXBvbmVudChiKX07aWYoYz09PWIpe2M9Zi5hamF4U2V0dGluZ3MudHJhZGl0aW9uYWx9aWYoZi5pc0FycmF5KGEpfHxhLmpxdWVyeSYmIWYuaXNQbGFpbk9iamVjdChhKSl7Zi5lYWNoKGEsZnVuY3Rpb24oKXtlKHRoaXMubmFtZSx0aGlzLnZhbHVlKX0pfWVsc2V7Zm9yKHZhciBnIGluIGEpe0coZyxhW2ddLGMsZSl9fXJldHVybiBkLmpvaW4oXCImXCIpLnJlcGxhY2UoaSxcIitcIil9fSk7Zi5leHRlbmQoe2FjdGl2ZTowLGxhc3RNb2RpZmllZDp7fSxldGFnOnt9fSk7dmFyIEo9YS5BY3RpdmVYT2JqZWN0P2Z1bmN0aW9uKCl7Zm9yKHZhciBhIGluIEwpe0xbYV0oMCwxKX19OmZhbHNlLEs9MCxMO2YuYWpheFNldHRpbmdzLnhocj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtyZXR1cm4hdGhpcy5pc0xvY2FsJiZNKCl8fE4oKX06TTsoZnVuY3Rpb24oYSl7Zi5leHRlbmQoZi5zdXBwb3J0LHthamF4OiEhYSxjb3JzOiEhYSYmXCJ3aXRoQ3JlZGVudGlhbHNcImluIGF9KX0pKGYuYWpheFNldHRpbmdzLnhocigpKTtpZihmLnN1cHBvcnQuYWpheCl7Zi5hamF4VHJhbnNwb3J0KGZ1bmN0aW9uKGMpe2lmKCFjLmNyb3NzRG9tYWlufHxmLnN1cHBvcnQuY29ycyl7dmFyIGQ7cmV0dXJue3NlbmQ6ZnVuY3Rpb24oZSxnKXt2YXIgaD1jLnhocigpLGksajtpZihjLnVzZXJuYW1lKXtoLm9wZW4oYy50eXBlLGMudXJsLGMuYXN5bmMsYy51c2VybmFtZSxjLnBhc3N3b3JkKX1lbHNle2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyl9aWYoYy54aHJGaWVsZHMpe2ZvcihqIGluIGMueGhyRmllbGRzKXtoW2pdPWMueGhyRmllbGRzW2pdfX1pZihjLm1pbWVUeXBlJiZoLm92ZXJyaWRlTWltZVR5cGUpe2gub3ZlcnJpZGVNaW1lVHlwZShjLm1pbWVUeXBlKX1pZighYy5jcm9zc0RvbWFpbiYmIWVbXCJYLVJlcXVlc3RlZC1XaXRoXCJdKXtlW1wiWC1SZXF1ZXN0ZWQtV2l0aFwiXT1cIlhNTEh0dHBSZXF1ZXN0XCJ9dHJ5e2ZvcihqIGluIGUpe2guc2V0UmVxdWVzdEhlYWRlcihqLGVbal0pfX1jYXRjaChrKXt9aC5zZW5kKGMuaGFzQ29udGVudCYmYy5kYXRhfHxudWxsKTtkPWZ1bmN0aW9uKGEsZSl7dmFyIGosayxsLG0sbjt0cnl7aWYoZCYmKGV8fGgucmVhZHlTdGF0ZT09PTQpKXtkPWI7aWYoaSl7aC5vbnJlYWR5c3RhdGVjaGFuZ2U9Zi5ub29wO2lmKEope2RlbGV0ZSBMW2ldfX1pZihlKXtpZihoLnJlYWR5U3RhdGUhPT00KXtoLmFib3J0KCl9fWVsc2V7aj1oLnN0YXR1cztsPWguZ2V0QWxsUmVzcG9uc2VIZWFkZXJzKCk7bT17fTtuPWgucmVzcG9uc2VYTUw7aWYobiYmbi5kb2N1bWVudEVsZW1lbnQpe20ueG1sPW59bS50ZXh0PWgucmVzcG9uc2VUZXh0O3RyeXtrPWguc3RhdHVzVGV4dH1jYXRjaChvKXtrPVwiXCJ9aWYoIWomJmMuaXNMb2NhbCYmIWMuY3Jvc3NEb21haW4pe2o9bS50ZXh0PzIwMDo0MDR9ZWxzZSBpZihqPT09MTIyMyl7aj0yMDR9fX19Y2F0Y2gocCl7aWYoIWUpe2coLTEscCl9fWlmKG0pe2coaixrLG0sbCl9fTtpZighYy5hc3luY3x8aC5yZWFkeVN0YXRlPT09NCl7ZCgpfWVsc2V7aT0rK0s7aWYoSil7aWYoIUwpe0w9e307ZihhKS51bmxvYWQoSil9TFtpXT1kfWgub25yZWFkeXN0YXRlY2hhbmdlPWR9fSxhYm9ydDpmdW5jdGlvbigpe2lmKGQpe2QoMCwxKX19fX19KX1mLmFqYXhTZXR0aW5ncy5nbG9iYWw9ZmFsc2U7YS5qUXVlcnk9YS4kPWZ9KShnbG9iYWwpfSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJBTSBmb3JtYXQ6IGh0dHBzOi8vc2FtdG9vbHMuZ2l0aHViLmlvL2h0cy1zcGVjcy9TQU12MS5wZGYgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBkZWVwQ2xvbmUgPSB1dGlscy5kZWVwQ2xvbmU7XG52YXIgUGFpcmVkSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMnKS5QYWlyZWRJbnRlcnZhbFRyZWU7XG52YXIgUmVtb3RlVHJhY2sgPSByZXF1aXJlKCcuL3V0aWxzL1JlbW90ZVRyYWNrLmpzJykuUmVtb3RlVHJhY2s7XG5cbnZhciBCYW1Gb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY2hyb21vc29tZXM6ICcnLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yOiAnMTg4LDE4OCwxODgnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogMjAwMCwgcGFjazogMjAwMH0sXG4gICAgLy8gSWYgYSBudWNsZW90aWRlIGRpZmZlcnMgZnJvbSB0aGUgcmVmZXJlbmNlIHNlcXVlbmNlIGluIGdyZWF0ZXIgdGhhbiAyMCUgb2YgcXVhbGl0eSB3ZWlnaHRlZCByZWFkcywgXG4gICAgLy8gSUdWIGNvbG9ycyB0aGUgYmFyIGluIHByb3BvcnRpb24gdG8gdGhlIHJlYWQgY291bnQgb2YgZWFjaCBiYXNlOyB0aGUgZm9sbG93aW5nIGNoYW5nZXMgdGhhdCB0aHJlc2hvbGQgZm9yIGNocm9tb3pvb21cbiAgICBhbGxlbGVGcmVxVGhyZXNob2xkOiAwLjIsXG4gICAgb3B0aW1hbEZldGNoV2luZG93OiAwLFxuICAgIG1heEZldGNoV2luZG93OiAwLFxuICAgIC8vIFRoZSBmb2xsb3dpbmcgY2FuIGJlIFwiZW5zZW1ibF91Y3NjXCIgb3IgXCJ1Y3NjX2Vuc2VtYmxcIiB0byBhdHRlbXB0IGF1dG8tY3Jvc3NtYXBwaW5nIG9mIHJlZmVyZW5jZSBjb250aWcgbmFtZXNcbiAgICAvLyBiZXR3ZWVuIHRoZSB0d28gc2NoZW1lcywgd2hpY2ggSUdWIGRvZXMsIGJ1dCBpcyBhIHBlcmVubmlhbCBpc3N1ZTogaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTAwNjIvXG4gICAgLy8gSSBob3BlIG5vdCB0byBuZWVkIGFsbCB0aGUgbWFwcGluZ3MgaW4gaGVyZSBodHRwczovL2dpdGh1Yi5jb20vZHByeWFuNzkvQ2hyb21vc29tZU1hcHBpbmdzIGJ1dCBpdCBtYXkgYmUgbmVjZXNzYXJ5XG4gICAgY29udmVydENoclNjaGVtZTogXCJhdXRvXCIsXG4gICAgLy8gRHJhdyBwYWlyZWQgZW5kcyB3aXRoaW4gYSByYW5nZSBvZiBleHBlY3RlZCBpbnNlcnQgc2l6ZXMgYXMgYSBjb250aW51b3VzIGZlYXR1cmU/XG4gICAgLy8gU2VlIGh0dHBzOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvQWxpZ25tZW50RGF0YSNwYWlyZWQgZm9yIGhvdyB0aGlzIHdvcmtzXG4gICAgdmlld0FzUGFpcnM6IGZhbHNlLFxuICAgIGV4cGVjdGVkSW5zZXJ0U2l6ZVBlcmNlbnRpbGVzOiBbMC4wMDUsIDAuOTk1XVxuICB9LFxuICBcbiAgLy8gVGhlIEZMQUcgY29sdW1uIGZvciBCQU0vU0FNIGlzIGEgY29tYmluYXRpb24gb2YgYml0d2lzZSBmbGFnc1xuICBmbGFnczoge1xuICAgIGlzUmVhZFBhaXJlZDogMHgxLFxuICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogMHgyLFxuICAgIGlzUmVhZFVubWFwcGVkOiAweDQsXG4gICAgaXNNYXRlVW5tYXBwZWQ6IDB4OCxcbiAgICByZWFkU3RyYW5kUmV2ZXJzZTogMHgxMCxcbiAgICBtYXRlU3RyYW5kUmV2ZXJzZTogMHgyMCxcbiAgICBpc1JlYWRGaXJzdE9mUGFpcjogMHg0MCxcbiAgICBpc1JlYWRMYXN0T2ZQYWlyOiAweDgwLFxuICAgIGlzU2Vjb25kYXJ5QWxpZ25tZW50OiAweDEwMCxcbiAgICBpc1JlYWRGYWlsaW5nVmVuZG9yUUM6IDB4MjAwLFxuICAgIGlzRHVwbGljYXRlUmVhZDogMHg0MDAsXG4gICAgaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50OiAweDgwMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBicm93c2VyQ2hycyA9IF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzKTtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIEJBTSB0cmFjayBhdCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy5icm93c2VyQ2hyU2NoZW1lID0gdGhpcy50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcykpO1xuICB9LFxuICBcbiAgLy8gVE9ETzogSWYgdGhlIHBhaXJpbmcgaW50ZXJ2YWwgY2hhbmdlZCwgd2Ugc2hvdWxkIHRvc3MgdGhlIGVudGlyZSBjYWNoZSBhbmQgcmVzZXQgdGhlIFJlbW90ZVRyYWNrIGJpbnMsXG4gIC8vICAgICAgICAgKmFuZCogYmxvdyB1cCB0aGUgYXJlYUluZGV4LlxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIC8vIFdoZW4gd2UgY2hhbmdlIG9wdHMudmlld0FzUGFpcnMsIHdlICpuZWVkKiB0byB0aHJvdyBvdXQgdGhpcy5kYXRhLnBpbGV1cC5cbiAgICBpZiAoby52aWV3QXNQYWlycyAhPSB0aGlzLnByZXZPcHRzLnZpZXdBc1BhaXJzKSB7IHRoaXMuZGF0YS5waWxldXAgPSB7fTsgfVxuICAgIHRoaXMucHJldk9wdHMgPSBkZWVwQ2xvbmUodGhpcy5vcHRzKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSwgXG4gICAgICAgICAge3N0YXJ0S2V5OiAndGVtcGxhdGVTdGFydCcsIGVuZEtleTogJ3RlbXBsYXRlRW5kJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbicsIHBhaXJpbmdLZXk6ICdxbmFtZSd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiYW0ucGhwJyxcbiAgICAgIGluZm9DaHJSYW5nZSA9IHNlbGYuY2hyUmFuZ2UoTWF0aC5yb3VuZChzZWxmLmJyb3dzZXJPcHRzLnBvcyksIE1hdGgucm91bmQoc2VsZi5icm93c2VyT3B0cy5wb3MgKyAxMDAwMCkpLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lID09IFwiYXV0b1wiID8gc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA6IG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL15jaHIvLCAnJyk7IH0pOyBicmVhaztcbiAgICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eKFxcZFxcZD98WCk6LywgJ2NociQxOicpOyB9KTsgYnJlYWs7XG4gICAgICB9XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBQYXJzZSB0aGUgU0FNIGZvcm1hdCBpbnRvIGludGVydmFscyB0aGF0IGNhbiBiZSBpbnNlcnRlZCBpbnRvIHRoZSBJbnRlcnZhbFRyZWUgY2FjaGVcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7IH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlLCBwaWxldXA6IHt9LCBpbmZvOiB7fX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAyNCwgc3RhcnQ6IDI0fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBzZWxmLm5vQXJlYUxhYmVscyA9IHRydWU7XG4gICAgc2VsZi5leHBlY3RzU2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3MgPSB7fTtcbiAgICBzZWxmLnByZXZPcHRzID0gZGVlcENsb25lKG8pOyAgLy8gdXNlZCB0byBkZXRlY3Qgd2hpY2ggZHJhd2luZyBvcHRpb25zIGhhdmUgYmVlbiBjaGFuZ2VkIGJ5IHRoZSB1c2VyXG4gICAgXG4gICAgLy8gR2V0IGdlbmVyYWwgaW5mbyBvbiB0aGUgYmFtIChlLmcuIGBzYW10b29scyBpZHhzdGF0c2AsIHVzZSBtYXBwZWQgcmVhZHMgcGVyIHJlZmVyZW5jZSBzZXF1ZW5jZVxuICAgIC8vIHRvIGVzdGltYXRlIG1heEZldGNoV2luZG93IGFuZCBvcHRpbWFsRmV0Y2hXaW5kb3csIGFuZCBzZXR1cCBiaW5uaW5nIG9uIHRoZSBSZW1vdGVUcmFjay5cbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YToge3JhbmdlOiBpbmZvQ2hyUmFuZ2UsIHVybDogby5iaWdEYXRhVXJsLCBpbmZvOiAxfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIG1hcHBlZFJlYWRzID0gMCxcbiAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKG8uZHJhd0xpbWl0KSksXG4gICAgICAgICAgYmFtQ2hycyA9IFtdLFxuICAgICAgICAgIGluZm9QYXJ0cyA9IGRhdGEuc3BsaXQoXCJcXG5cXG5cIiksXG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMgPSBbXSxcbiAgICAgICAgICBwY3RpbGVzID0gby5leHBlY3RlZEluc2VydFNpemVQZXJjZW50aWxlcyxcbiAgICAgICAgICBsb3dlckJvdW5kID0gMTAsIFxuICAgICAgICAgIHVwcGVyQm91bmQgPSA1MDAwLCBcbiAgICAgICAgICBzYW1wbGVJbnRlcnZhbHMsIG1lYW5JdGVtTGVuZ3RoLCBoYXNBTWF0ZVBhaXIsIGNoclNjaGVtZSwgbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goaW5mb1BhcnRzWzBdLnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICAgICAgICByZWFkc01hcHBlZFRvQ29udGlnID0gcGFyc2VJbnQoZmllbGRzWzJdLCAxMCk7XG4gICAgICAgICAgaWYgKGZpZWxkcy5sZW5ndGggPT0gMSAmJiBmaWVsZHNbMF0gPT0gJycpIHsgcmV0dXJuOyB9IC8vIGJsYW5rIGxpbmVcbiAgICAgICAgICBiYW1DaHJzLnB1c2goZmllbGRzWzBdKTtcbiAgICAgICAgICBpZiAoXy5pc05hTihyZWFkc01hcHBlZFRvQ29udGlnKSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG91dHB1dCBmb3Igc2FtdG9vbHMgaWR4c3RhdHMgb24gdGhpcyBCQU0gdHJhY2suXCIpOyB9XG4gICAgICAgICAgbWFwcGVkUmVhZHMgKz0gcmVhZHNNYXBwZWRUb0NvbnRpZztcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBzZWxmLmRhdGEuaW5mby5jaHJTY2hlbWUgPSBjaHJTY2hlbWUgPSBzZWxmLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoYmFtQ2hycyk7XG4gICAgICAgIGlmIChjaHJTY2hlbWUgJiYgc2VsZi5icm93c2VyQ2hyU2NoZW1lKSB7XG4gICAgICAgICAgc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA9IGNoclNjaGVtZSAhPSBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgPyBjaHJTY2hlbWUgKyAnXycgKyBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgOiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBzYW1wbGVJbnRlcnZhbHMgPSBfLmNvbXBhY3QoXy5tYXAoaW5mb1BhcnRzWzFdLnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSk7XG4gICAgICAgIH0pKTtcbiAgICAgICAgaWYgKHNhbXBsZUludGVydmFscy5sZW5ndGgpIHtcbiAgICAgICAgICBtZWFuSXRlbUxlbmd0aCA9IF8ucmVkdWNlKHNhbXBsZUludGVydmFscywgZnVuY3Rpb24obWVtbywgbmV4dCkgeyByZXR1cm4gbWVtbyArIChuZXh0LmVuZCAtIG5leHQuc3RhcnQpOyB9LCAwKTtcbiAgICAgICAgICBtZWFuSXRlbUxlbmd0aCA9IE1hdGgucm91bmQobWVhbkl0ZW1MZW5ndGggLyBzYW1wbGVJbnRlcnZhbHMubGVuZ3RoKTtcbiAgICAgICAgICBoYXNBTWF0ZVBhaXIgPSBfLnNvbWUoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihpdHZsKSB7IFxuICAgICAgICAgICAgcmV0dXJuIGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIgfHwgaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGVzdGltYXRlZEluc2VydFNpemVzID0gXy5jb21wYWN0KF8ubWFwKHNhbXBsZUludGVydmFscywgZnVuY3Rpb24oaXR2bCkgeyBcbiAgICAgICAgICAgIHJldHVybiBpdHZsLnRsZW4gPyBNYXRoLmFicyhpdHZsLnRsZW4pIDogMDsgXG4gICAgICAgICAgfSkpO1xuICAgICAgICAgIGVzdGltYXRlZEluc2VydFNpemVzLnNvcnQoZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYSAtIGI7IH0pOyAgLy8gTk9URTogSmF2YVNjcmlwdCBkb2VzIHN0cmluZyBzb3J0aW5nIGJ5IGRlZmF1bHQgLV8tXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwID0gbWVhbkl0ZW1zUGVyQnAgPSBtYXBwZWRSZWFkcyAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZTtcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggPSBtZWFuSXRlbUxlbmd0aCA9IF8uaXNVbmRlZmluZWQobWVhbkl0ZW1MZW5ndGgpID8gMTAwIDogbWVhbkl0ZW1MZW5ndGg7XG4gICAgICAgIG8ubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwIC8gKE1hdGgubWF4KG1lYW5JdGVtTGVuZ3RoLCAxMDApIC8gMTAwKTtcbiAgICAgICAgby5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKG8ubWF4RmV0Y2hXaW5kb3cgLyAyKTtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIHRoZXJlIGlzIHBhaXJpbmcsIHdlIG5lZWQgdG8gdGVsbCB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIHdoYXQgcmFuZ2Ugb2YgaW5zZXJ0IHNpemVzIHNob3VsZCB0cmlnZ2VyIHBhaXJpbmcuXG4gICAgICAgIGlmIChoYXNBTWF0ZVBhaXIpIHtcbiAgICAgICAgICBpZiAoZXN0aW1hdGVkSW5zZXJ0U2l6ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsb3dlckJvdW5kID0gZXN0aW1hdGVkSW5zZXJ0U2l6ZXNbTWF0aC5mbG9vcihlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGggKiBwY3RpbGVzWzBdKV07XG4gICAgICAgICAgICB1cHBlckJvdW5kID0gZXN0aW1hdGVkSW5zZXJ0U2l6ZXNbTWF0aC5mbG9vcihlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGggKiBwY3RpbGVzWzFdKV07XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlbGYuZGF0YS5jYWNoZS5zZXRQYWlyaW5nSW50ZXJ2YWwobG93ZXJCb3VuZCwgdXBwZXJCb3VuZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gSWYgd2UgZG9uJ3Qgc2VlIGFueSBwYWlyZWQgcmVhZHMgaW4gdGhpcyBCQU0sIGRlYWN0aXZhdGUgdGhlIHBhaXJpbmcgZnVuY3Rpb25hbGl0eSBvZiB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIFxuICAgICAgICAgIHNlbGYuZGF0YS5jYWNoZS5kaXNhYmxlUGFpcmluZygpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBvLm9wdGltYWxGZXRjaFdpbmRvdywgby5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuZmxhZ3NbLi4uXSB0byBhIGh1bWFuIGludGVycHJldGFibGUgdmVyc2lvbiBvZiBmZWF0dXJlLmZsYWcgKGV4cGFuZGluZyB0aGUgYml0d2lzZSBmbGFncylcbiAgcGFyc2VGbGFnczogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7XG4gICAgZmVhdHVyZS5mbGFncyA9IHt9O1xuICAgIF8uZWFjaCh0aGlzLnR5cGUoJ2JhbScpLmZsYWdzLCBmdW5jdGlvbihiaXQsIGZsYWcpIHtcbiAgICAgIGZlYXR1cmUuZmxhZ3NbZmxhZ10gPSAhIShmZWF0dXJlLmZsYWcgJiBiaXQpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmJsb2NrcyBhbmQgZmVhdHVyZS5lbmQgYmFzZWQgb24gZmVhdHVyZS5jaWdhclxuICAvLyBTZWUgc2VjdGlvbiAxLjQgb2YgaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiBmb3IgYW4gZXhwbGFuYXRpb24gb2YgQ0lHQVIgXG4gIHBhcnNlQ2lnYXI6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykgeyAgICAgICAgXG4gICAgdmFyIGNpZ2FyID0gZmVhdHVyZS5jaWdhcixcbiAgICAgIHNlcSA9ICghZmVhdHVyZS5zZXEgfHwgZmVhdHVyZS5zZXEgPT0gJyonKSA/IFwiXCIgOiBmZWF0dXJlLnNlcSxcbiAgICAgIHJlZkxlbiA9IDAsXG4gICAgICBzZXFQb3MgPSAwLFxuICAgICAgb3BlcmF0aW9ucywgbGVuZ3RocztcbiAgICBcbiAgICBmZWF0dXJlLmJsb2NrcyA9IFtdO1xuICAgIGZlYXR1cmUuaW5zZXJ0aW9ucyA9IFtdO1xuICAgIFxuICAgIG9wcyA9IGNpZ2FyLnNwbGl0KC9cXGQrLykuc2xpY2UoMSk7XG4gICAgbGVuZ3RocyA9IGNpZ2FyLnNwbGl0KC9bQS1aPV0vKS5zbGljZSgwLCAtMSk7XG4gICAgaWYgKG9wcy5sZW5ndGggIT0gbGVuZ3Rocy5sZW5ndGgpIHsgdGhpcy53YXJuKFwiSW52YWxpZCBDSUdBUiAnXCIgKyBjaWdhciArIFwiJyBmb3IgXCIgKyBmZWF0dXJlLmRlc2MpOyByZXR1cm47IH1cbiAgICBsZW5ndGhzID0gXy5tYXAobGVuZ3RocywgcGFyc2VJbnQxMCk7XG4gICAgXG4gICAgXy5lYWNoKG9wcywgZnVuY3Rpb24ob3AsIGkpIHtcbiAgICAgIHZhciBsZW4gPSBsZW5ndGhzW2ldLFxuICAgICAgICBibG9jaywgaW5zZXJ0aW9uO1xuICAgICAgaWYgKC9eW01YPV0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBBbGlnbm1lbnQgbWF0Y2gsIHNlcXVlbmNlIG1hdGNoLCBzZXF1ZW5jZSBtaXNtYXRjaFxuICAgICAgICBibG9jayA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGJsb2NrLmVuZCA9IGJsb2NrLnN0YXJ0ICsgbGVuO1xuICAgICAgICBibG9jay50eXBlID0gb3A7XG4gICAgICAgIGJsb2NrLnNlcSA9IHNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmICgvXltORF0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBTa2lwcGVkIHJlZmVyZW5jZSByZWdpb24sIGRlbGV0aW9uIGZyb20gcmVmZXJlbmNlXG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdJJykge1xuICAgICAgICAvLyBJbnNlcnRpb25cbiAgICAgICAgaW5zZXJ0aW9uID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuLCBlbmQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBpbnNlcnRpb24uc2VxID0gc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5pbnNlcnRpb25zLnB1c2goaW5zZXJ0aW9uKTtcbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ1MnKSB7XG4gICAgICAgIC8vIFNvZnQgY2xpcHBpbmc7IHNpbXBseSBza2lwIHRoZXNlIGJhc2VzIGluIFNFUSwgcG9zaXRpb24gb24gcmVmZXJlbmNlIGlzIHVuY2hhbmdlZC5cbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH1cbiAgICAgIC8vIFRoZSBvdGhlciB0d28gQ0lHQVIgb3BzLCBIIGFuZCBQLCBhcmUgbm90IHJlbGV2YW50IHRvIGRyYXdpbmcgYWxpZ25tZW50cy5cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmVuZCA9IGZlYXR1cmUuc3RhcnQgKyByZWZMZW47XG4gIH0sXG4gIFxuICBwYXJzZUxpbmU6IGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29scyA9IFsncW5hbWUnLCAnZmxhZycsICdybmFtZScsICdwb3MnLCAnbWFwcScsICdjaWdhcicsICdybmV4dCcsICdwbmV4dCcsICd0bGVuJywgJ3NlcScsICdxdWFsJ10sXG4gICAgICBmZWF0dXJlID0ge30sXG4gICAgICBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgYXZhaWxGbGFncyA9IHRoaXMudHlwZSgnYmFtJykuZmxhZ3MsXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgXy5lYWNoKF8uZmlyc3QoZmllbGRzLCBjb2xzLmxlbmd0aCksIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgIC8vIE5vdGUgdGhhdCBjaHJNIGlzIE5PVCBlcXVpdmFsZW50IHRvIE1UIGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEyMDA0Mi8jMTIwMDU4XG4gICAgc3dpdGNoIChvLmNvbnZlcnRDaHJTY2hlbWUgPT0gXCJhdXRvXCIgPyB0aGlzLmRhdGEuaW5mby5jb252ZXJ0Q2hyU2NoZW1lIDogby5jb252ZXJ0Q2hyU2NoZW1lKSB7XG4gICAgICBjYXNlICd1Y3NjX2Vuc2VtYmwnOiBmZWF0dXJlLnJuYW1lID0gZmVhdHVyZS5ybmFtZS5yZXBsYWNlKC9eY2hyLywgJycpOyBicmVhaztcbiAgICAgIGNhc2UgJ2Vuc2VtYmxfdWNzYyc6IGZlYXR1cmUucm5hbWUgPSAoL14oXFxkXFxkP3xYKSQvLnRlc3QoZmVhdHVyZS5ybmFtZSkgPyAnY2hyJyA6ICcnKSArIGZlYXR1cmUucm5hbWU7IGJyZWFrO1xuICAgIH1cbiAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnFuYW1lO1xuICAgIGZlYXR1cmUuZmxhZyA9IHBhcnNlSW50MTAoZmVhdHVyZS5mbGFnKTtcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tmZWF0dXJlLnJuYW1lXTtcbiAgICBsaW5lbm8gPSBsaW5lbm8gfHwgMDtcbiAgICBcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIFJOQU1FICdcIitmZWF0dXJlLnJuYW1lK1wiJyBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIGlmIChmZWF0dXJlLnBvcyA9PT0gJzAnIHx8ICFmZWF0dXJlLmNpZ2FyIHx8IGZlYXR1cmUuY2lnYXIgPT0gJyonIHx8IGZlYXR1cmUuZmxhZyAmIGF2YWlsRmxhZ3MuaXNSZWFkVW5tYXBwZWQpIHtcbiAgICAgIC8vIFVubWFwcGVkIHJlYWQuIFNpbmNlIHdlIGNhbid0IGRyYXcgdGhlc2UgYXQgYWxsLCB3ZSBkb24ndCBib3RoZXIgcGFyc2luZyB0aGVtIGZ1cnRoZXIuXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5wb3MpOyAgICAgICAgLy8gUE9TIGlzIDEtYmFzZWQsIGhlbmNlIG5vIGluY3JlbWVudCBhcyBmb3IgcGFyc2luZyBCRURcbiAgICAgIGZlYXR1cmUuZGVzYyA9IGZlYXR1cmUucW5hbWUgKyAnIGF0ICcgKyBmZWF0dXJlLnJuYW1lICsgJzonICsgZmVhdHVyZS5wb3M7XG4gICAgICBmZWF0dXJlLnRsZW4gPSBwYXJzZUludDEwKGZlYXR1cmUudGxlbik7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlRmxhZ3MuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pO1xuICAgICAgZmVhdHVyZS5zdHJhbmQgPSBmZWF0dXJlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gJy0nIDogJysnO1xuICAgICAgdGhpcy50eXBlKCdiYW0nKS5wYXJzZUNpZ2FyLmNhbGwodGhpcywgZmVhdHVyZSwgbGluZW5vKTsgLy8gVGhpcyBhbHNvIHNldHMgLmVuZCBhcHByb3ByaWF0ZWx5XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgdG8gY29tZSB1cCB3aXRoIHNvbWV0aGluZyB0aGF0IGlzIGEgdW5pcXVlIGxhYmVsIGZvciBldmVyeSBsaW5lIHRvIGRlZHVwZSByb3dzLlxuICAgIC8vIFRoZSBmb2xsb3dpbmcgaXMgdGVjaG5pY2FsbHkgbm90IGd1YXJhbnRlZWQgYnkgYSB2YWxpZCBCQU0gKGV2ZW4gYXQgR0FUSyBzdGFuZGFyZHMpLCBidXQgaXQncyB0aGUgYmVzdCBJIGdvdC5cbiAgICBmZWF0dXJlLmlkID0gW2ZlYXR1cmUucW5hbWUsIGZlYXR1cmUuZmxhZywgZmVhdHVyZS5ybmFtZSwgZmVhdHVyZS5wb3MsIGZlYXR1cmUuY2lnYXJdLmpvaW4oXCJcXHRcIik7XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICBwaWxldXA6IGZ1bmN0aW9uKGludGVydmFscywgc3RhcnQsIGVuZCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgcG9zaXRpb25zVG9DYWxjdWxhdGUgPSB7fSxcbiAgICAgIG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID0gMCxcbiAgICAgIGk7XG4gICAgXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgLy8gTm8gbmVlZCB0byBwaWxldXAgYWdhaW4gb24gYWxyZWFkeS1waWxlZC11cCBudWNsZW90aWRlIHBvc2l0aW9uc1xuICAgICAgaWYgKCFwaWxldXBbaV0pIHsgcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0gPSB0cnVlOyBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSsrOyB9XG4gICAgfVxuICAgIGlmIChudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9PT0gMCkgeyByZXR1cm47IH0gLy8gQWxsIHBvc2l0aW9ucyBhbHJlYWR5IHBpbGVkIHVwIVxuICAgIFxuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmIChpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTsgfVxuICAgICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tzKSB7XG4gICAgICAgIF8uZWFjaChibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgICAgdmFyIG50LCBpO1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIGVuZCk7IGkrKykge1xuICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSkgeyBjb250aW51ZTsgfVxuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBwaWxldXBbaV0gPSBwaWxldXBbaV0gfHwge0E6IDAsIEM6IDAsIEc6IDAsIFQ6IDAsIE46IDAsIGNvdjogMH07XG4gICAgICAgICAgICBwaWxldXBbaV1bKC9bQUNUR10vKS50ZXN0KG50KSA/IG50IDogJ04nXSArPSAxO1xuICAgICAgICAgICAgcGlsZXVwW2ldLmNvdiArPSAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGNvdmVyYWdlOiBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHApIHtcbiAgICAvLyBDb21wYXJlIHdpdGggYmlubmluZyBvbiB0aGUgZmx5IGluIC50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlciguLi4pXG4gICAgdmFyIGogPSBzdGFydCxcbiAgICAgIHZTY2FsZSA9IHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwICogdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggKiAyLFxuICAgICAgY3VyciA9IHRoaXMuZGF0YS5waWxldXBbal0sXG4gICAgICBiYXJzID0gW10sXG4gICAgICBuZXh0LCBiaW4sIGk7XG4gICAgZm9yIChpID0gMDsgaSA8IHdpZHRoOyBpKyspIHtcbiAgICAgIGJpbiA9IGN1cnIgJiYgKGogKyAxID49IGkgKiBicHBwICsgc3RhcnQpID8gW2N1cnIuY292XSA6IFtdO1xuICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgd2hpbGUgKGogKyAxIDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBqICsgMiA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICBpZiAobmV4dCkgeyBiaW4ucHVzaChuZXh0LmNvdik7IH1cbiAgICAgICAgKytqO1xuICAgICAgICBjdXJyID0gbmV4dDtcbiAgICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgfVxuICAgICAgYmFycy5wdXNoKHV0aWxzLndpZ0JpbkZ1bmN0aW9ucy5tYXhpbXVtKGJpbikgLyB2U2NhbGUpO1xuICAgIH1cbiAgICByZXR1cm4gYmFycztcbiAgfSxcbiAgXG4gIGFsbGVsZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgdlNjYWxlID0gdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgKiB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCAqIDIsXG4gICAgICBhbGxlbGVGcmVxVGhyZXNob2xkID0gdGhpcy5vcHRzLmFsbGVsZUZyZXFUaHJlc2hvbGQsXG4gICAgICBhbGxlbGVTcGxpdHMgPSBbXSxcbiAgICAgIHNwbGl0LCByZWZOdCwgaSwgcGlsZTtcbiAgICAgIFxuICAgIGZvciAoaSA9IDA7IGkgPCBzZXF1ZW5jZS5sZW5ndGg7IGkrKykge1xuICAgICAgcmVmTnQgPSBzZXF1ZW5jZVtpXS50b1VwcGVyQ2FzZSgpO1xuICAgICAgcGlsZSA9IHBpbGV1cFtzdGFydCArIGldO1xuICAgICAgaWYgKHBpbGUgJiYgcGlsZS5jb3YgJiYgcGlsZVtyZWZOdF0gLyAocGlsZS5jb3YgLSBwaWxlLk4pIDwgKDEgLSBhbGxlbGVGcmVxVGhyZXNob2xkKSkge1xuICAgICAgICBzcGxpdCA9IHtcbiAgICAgICAgICB4OiBpIC8gYnBwcCxcbiAgICAgICAgICBzcGxpdHM6IFtdXG4gICAgICAgIH07XG4gICAgICAgIF8uZWFjaChbJ0EnLCAnQycsICdHJywgJ1QnXSwgZnVuY3Rpb24obnQpIHtcbiAgICAgICAgICBpZiAocGlsZVtudF0gPiAwKSB7IHNwbGl0LnNwbGl0cy5wdXNoKHtudDogbnQsIGg6IHBpbGVbbnRdIC8gdlNjYWxlfSk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGFsbGVsZVNwbGl0cy5wdXNoKHNwbGl0KTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGFsbGVsZVNwbGl0cztcbiAgfSxcbiAgXG4gIG1pc21hdGNoZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSwgdmlld0FzUGFpcnMpIHtcbiAgICB2YXIgbWlzbWF0Y2hlcyA9IFtdLFxuICAgICAgdmlld0FzUGFpcnMgPSB0aGlzLm9wdHMudmlld0FzUGFpcnM7XG4gICAgc2VxdWVuY2UgPSBzZXF1ZW5jZS50b1VwcGVyQ2FzZSgpO1xuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmICh2aWV3QXNQYWlycyAmJiBpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBcbiAgICAgICAgYmxvY2tTZXRzLnB1c2goaW50ZXJ2YWwuZGF0YS5tYXRlLmJsb2Nrcyk7XG4gICAgICB9XG4gICAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja3MpIHtcbiAgICAgICAgXy5lYWNoKGJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgICB2YXIgbGluZSA9IGxpbmVOdW0oaW50ZXJ2YWwuZGF0YSksXG4gICAgICAgICAgICBudCwgaSwgeDtcbiAgICAgICAgICBmb3IgKGkgPSBNYXRoLm1heChibG9jay5zdGFydCwgc3RhcnQpOyBpIDwgTWF0aC5taW4oYmxvY2suZW5kLCBzdGFydCArIHdpZHRoICogYnBwcCk7IGkrKykge1xuICAgICAgICAgICAgeCA9IChpIC0gc3RhcnQpIC8gYnBwcDtcbiAgICAgICAgICAgIG50ID0gKGJsb2NrLnNlcVtpIC0gYmxvY2suc3RhcnRdIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgaWYgKG50ICYmIG50ICE9IHNlcXVlbmNlW2kgLSBzdGFydF0gJiYgbGluZSkgeyBtaXNtYXRjaGVzLnB1c2goe3g6IHgsIG50OiBudCwgbGluZTogbGluZX0pOyB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBtaXNtYXRjaGVzO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBzZXF1ZW5jZSA9IHByZWNhbGMuc2VxdWVuY2UsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgdmlld0FzUGFpcnMgPSBzZWxmLm9wdHMudmlld0FzUGFpcnMsXG4gICAgICBzdGFydEtleSA9IHZpZXdBc1BhaXJzID8gJ3RlbXBsYXRlU3RhcnQnIDogJ3N0YXJ0JyxcbiAgICAgIGVuZEtleSA9IHZpZXdBc1BhaXJzID8gJ3RlbXBsYXRlRW5kJyA6ICdlbmQnLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aDtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHkgKyAnXycgKyAodmlld0FzUGFpcnMgPyAncCcgOiAndScpO1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldFRvKSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldFRvKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIGFuIGluc2FuZSBhbW91bnQgb2Ygcm93cyBcbiAgICAvLyAoPjUwMCBhbGlnbm1lbnRzKSwgYXMgdGhpcyB3aWxsIG9ubHkgaG9sZCB1cCBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoc2VsZi5vcHRzLm1heEZldGNoV2luZG93ICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZldGNoIGZyb20gdGhlIFJlbW90ZVRyYWNrIGFuZCBjYWxsIHRoZSBhYm92ZSB3aGVuIHRoZSBkYXRhIGlzIGF2YWlsYWJsZS5cbiAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCB2aWV3QXNQYWlycywgZnVuY3Rpb24oaW50ZXJ2YWxzKSB7XG4gICAgICAgIHZhciBkcmF3U3BlYyA9IHtzZXF1ZW5jZTogISFzZXF1ZW5jZSwgd2lkdGg6IHdpZHRofSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWxNYXRlZCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCA0LCBmYWxzZSwgc3RhcnRLZXksIGVuZEtleSksXG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIDQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG5cbiAgICAgICAgaWYgKCFzZXF1ZW5jZSkge1xuICAgICAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLnBpbGV1cC5jYWxsKHNlbGYsIGludGVydmFscywgc3RhcnQsIGVuZCk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsTWF0ZWQsIGxpbmVOdW0pO1xuICAgICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICAgICAgICAgIGludGVydmFsLmluc2VydGlvblB0cyA9IF8ubWFwKGludGVydmFsLmQuaW5zZXJ0aW9ucywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgaWYgKCF2aWV3QXNQYWlycykgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgaWYgKGludGVydmFsLmQuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZC5tYXRlKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBfLm1hcChbaW50ZXJ2YWwuZCwgaW50ZXJ2YWwuZC5tYXRlXSwgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlQmxvY2tJbnRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmJsb2NrcywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmluc2VydGlvblB0cywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChpbnRlcnZhbC5kLm1hdGVFeHBlY3RlZCkge1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnRzID0gW2NhbGNQaXhJbnRlcnZhbChpbnRlcnZhbCldO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBbXTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gW107XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGRyYXdTcGVjLmNvdmVyYWdlID0gc2VsZi50eXBlKCdiYW0nKS5jb3ZlcmFnZS5jYWxsKHNlbGYsIHN0YXJ0LCB3aWR0aCwgYnBwcCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2Vjb25kIGRyYXdpbmcgcGFzcywgdG8gZHJhdyB0aGluZ3MgdGhhdCBhcmUgZGVwZW5kZW50IG9uIHNlcXVlbmNlLCBsaWtlIG1pc21hdGNoZXMgKHBvdGVudGlhbCBTTlBzKS5cbiAgICAgICAgICBkcmF3U3BlYy5icHBwID0gYnBwcDsgIFxuICAgICAgICAgIC8vIEZpbmQgYWxsZWxlIHNwbGl0cyB3aXRoaW4gdGhlIGNvdmVyYWdlIGdyYXBoLlxuICAgICAgICAgIGRyYXdTcGVjLmFsbGVsZXMgPSBzZWxmLnR5cGUoJ2JhbScpLmFsbGVsZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHApO1xuICAgICAgICAgIC8vIEZpbmQgbWlzbWF0Y2hlcyB3aXRoaW4gZWFjaCBhbGlnbmVkIGJsb2NrLlxuICAgICAgICAgIGRyYXdTcGVjLm1pc21hdGNoZXMgPSBzZWxmLnR5cGUoJ2JhbScpLm1pc21hdGNoZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIFxuICAvLyBzcGVjaWFsIGZvcm1hdHRlciBmb3IgY29udGVudCBpbiB0b29sdGlwcyBmb3IgZmVhdHVyZXNcbiAgdGlwVGlwRGF0YTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29udGVudCA9IHt9LFxuICAgICAgZmlyc3RNYXRlID0gZGF0YS5kLFxuICAgICAgc2Vjb25kTWF0ZSA9IGRhdGEuZC5tYXRlLFxuICAgICAgbWF0ZUhlYWRlcnMgPSBbXCJ0aGlzIGFsaWdubWVudFwiLCBcIm1hdGUgcGFpciBhbGlnbm1lbnRcIl0sXG4gICAgICBsZWZ0TWF0ZSwgcmlnaHRNYXRlLCBwYWlyT3JpZW50YXRpb247XG4gICAgZnVuY3Rpb24geWVzTm8oYm9vbCkgeyByZXR1cm4gYm9vbCA/IFwieWVzXCIgOiBcIm5vXCI7IH1cbiAgICBmdW5jdGlvbiBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgc2VnLCBwcmVmaXgpIHtcbiAgICAgIHZhciBjaWdhckFiYnJldiA9IHNlZy5jaWdhciAmJiBzZWcuY2lnYXIubGVuZ3RoID4gMjUgPyBzZWcuY2lnYXIuc3Vic3RyKDAsIDI0KSArICcuLi4nIDogc2VnLmNpZ2FyO1xuICAgICAgcHJlZml4ID0gcHJlZml4IHx8IFwiXCI7XG4gICAgICBcbiAgICAgIF8uZWFjaCh7XG4gICAgICAgIFwicG9zaXRpb25cIjogc2VnLnJuYW1lICsgJzonICsgc2VnLnBvcyxcbiAgICAgICAgXCJjaWdhclwiOiBjaWdhckFiYnJldixcbiAgICAgICAgXCJyZWFkIHN0cmFuZFwiOiBzZWcuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnKC0pJyA6ICcoKyknLFxuICAgICAgICBcIm1hcHBlZFwiOiB5ZXNObyghc2VnLmZsYWdzLmlzUmVhZFVubWFwcGVkKSxcbiAgICAgICAgXCJtYXAgcXVhbGl0eVwiOiBzZWcubWFwcSxcbiAgICAgICAgXCJzZWNvbmRhcnlcIjogeWVzTm8oc2VnLmZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50KSxcbiAgICAgICAgXCJzdXBwbGVtZW50YXJ5XCI6IHllc05vKHNlZy5mbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcImR1cGxpY2F0ZVwiOiB5ZXNObyhzZWcuZmxhZ3MuaXNEdXBsaWNhdGVSZWFkKSxcbiAgICAgICAgXCJmYWlsZWQgUUNcIjogeWVzTm8oc2VnLmZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQylcbiAgICAgIH0sIGZ1bmN0aW9uKHYsIGspIHsgY29udGVudFtwcmVmaXggKyBrXSA9IHY7IH0pO1xuICAgIH1cbiAgICBcbiAgICBpZiAoZGF0YS5kLm1hdGUgJiYgZGF0YS5kLm1hdGUuZmxhZ3MpIHtcbiAgICAgIGxlZnRNYXRlID0gZGF0YS5kLnN0YXJ0IDwgZGF0YS5kLm1hdGUuc3RhcnQgPyBkYXRhLmQgOiBkYXRhLmQubWF0ZTtcbiAgICAgIHJpZ2h0TWF0ZSA9IGRhdGEuZC5zdGFydCA8IGRhdGEuZC5tYXRlLnN0YXJ0ID8gZGF0YS5kLm1hdGUgOiBkYXRhLmQ7XG4gICAgICBwYWlyT3JpZW50YXRpb24gPSAobGVmdE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyBcIlJcIiA6IFwiRlwiKSArIChsZWZ0TWF0ZS5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciA/IFwiMVwiIDogXCIyXCIpO1xuICAgICAgcGFpck9yaWVudGF0aW9uICs9IChyaWdodE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyBcIlJcIiA6IFwiRlwiKSArIChyaWdodE1hdGUuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpciA/IFwiMlwiIDogXCIxXCIpO1xuICAgIH1cbiAgICBcbiAgICBpZiAoby52aWV3QXNQYWlycyAmJiBkYXRhLmQuZHJhd0FzTWF0ZXMgJiYgZGF0YS5kLm1hdGUpIHtcbiAgICAgIGZpcnN0TWF0ZSA9IGxlZnRNYXRlO1xuICAgICAgc2Vjb25kTWF0ZSA9IHJpZ2h0TWF0ZTtcbiAgICAgIG1hdGVIZWFkZXJzID0gW1wibGVmdCBhbGlnbm1lbnRcIiwgXCJyaWdodCBhbGlnbm1lbnRcIl07XG4gICAgfVxuICAgIGlmIChzZWNvbmRNYXRlKSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmluc2VydFNpemUpKSB7IGNvbnRlbnRbXCJpbnNlcnQgc2l6ZVwiXSA9IGRhdGEuZC5pbnNlcnRTaXplOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQocGFpck9yaWVudGF0aW9uKSkgeyBjb250ZW50W1wicGFpciBvcmllbnRhdGlvblwiXSA9IHBhaXJPcmllbnRhdGlvbjsgfVxuICAgICAgY29udGVudFttYXRlSGVhZGVyc1swXV0gPSBcIi0tLVwiO1xuICAgICAgYWRkQWxpZ25lZFNlZ21lbnRJbmZvKGNvbnRlbnQsIGZpcnN0TWF0ZSk7XG4gICAgICBjb250ZW50W21hdGVIZWFkZXJzWzFdXSA9IFwiLS0tXCI7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgc2Vjb25kTWF0ZSwgXCIgXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgZGF0YS5kKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI2NvdmVyYWdlIGZvciBhbiBpZGVhIG9mIHdoYXQgd2UncmUgaW1pdGF0aW5nXG4gIGRyYXdDb3ZlcmFnZTogZnVuY3Rpb24oY3R4LCBjb3ZlcmFnZSwgaGVpZ2h0KSB7XG4gICAgXy5lYWNoKGNvdmVyYWdlLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGN0eC5maWxsUmVjdCh4LCBNYXRoLm1heChoZWlnaHQgLSAoZCAqIGhlaWdodCksIDApLCAxLCBNYXRoLm1pbihkICogaGVpZ2h0LCBoZWlnaHQpKTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdTdHJhbmRJbmRpY2F0b3I6IGZ1bmN0aW9uKGN0eCwgeCwgYmxvY2tZLCBibG9ja0hlaWdodCwgeFNjYWxlLCBiaWdTdHlsZSkge1xuICAgIHZhciBwcmV2RmlsbFN0eWxlID0gY3R4LmZpbGxTdHlsZTtcbiAgICBpZiAoYmlnU3R5bGUpIHtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZKTtcbiAgICAgIGN0eC5saW5lVG8oeCArICgzICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQvMik7XG4gICAgICBjdHgubGluZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5jbG9zZVBhdGgoKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDE0MCwxNDAsMTQwKSc7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTIgOiAxKSwgYmxvY2tZLCAxLCBibG9ja0hlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTEgOiAwKSwgYmxvY2tZICsgMSwgMSwgYmxvY2tIZWlnaHQgLSAyKTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBwcmV2RmlsbFN0eWxlO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdBbGlnbm1lbnQ6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBkcmF3TWF0ZXMgPSBkYXRhLm1hdGVJbnRzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIGJsb2NrWSA9IGkgKiBsaW5lSGVpZ2h0ICsgbGluZUdhcC8yLFxuICAgICAgYmxvY2tIZWlnaHQgPSBsaW5lSGVpZ2h0IC0gbGluZUdhcCxcbiAgICAgIGRlbGV0aW9uTGluZVdpZHRoID0gMixcbiAgICAgIGluc2VydGlvbkNhcmV0TGluZVdpZHRoID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIGxpbmVIZWlnaHQpIC0gZGVsZXRpb25MaW5lV2lkdGggKiAwLjUsXG4gICAgICBibG9ja1NldHMgPSBbe2Jsb2NrSW50czogZGF0YS5ibG9ja0ludHMsIHN0cmFuZDogZGF0YS5kLnN0cmFuZH1dO1xuICAgIFxuICAgIC8vIEZvciBtYXRlIHBhaXJzLCB0aGUgZnVsbCBwaXhlbCBpbnRlcnZhbCByZXByZXNlbnRzIHRoZSBsaW5lIGxpbmtpbmcgdGhlIG1hdGVzXG4gICAgaWYgKGRyYXdNYXRlcykge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgZGVsZXRpb25MaW5lV2lkdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEcmF3IHRoZSBsaW5lcyB0aGF0IHNob3cgdGhlIGZ1bGwgYWxpZ25tZW50IGZvciBlYWNoIHNlZ21lbnQsIGluY2x1ZGluZyBkZWxldGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gJ3JnYigwLDAsMCknO1xuICAgIF8uZWFjaChkcmF3TWF0ZXMgfHwgW2RhdGEucEludF0sIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgIGlmIChwSW50LncgPD0gMCkgeyByZXR1cm47IH1cbiAgICAgIC8vIE5vdGUgdGhhdCB0aGUgXCItIDFcIiBiZWxvdyBmaXhlcyByb3VuZGluZyBpc3N1ZXMgYnV0IGdhbWJsZXMgb24gdGhlcmUgbmV2ZXIgYmVpbmcgYSBkZWxldGlvbiBhdCB0aGUgcmlnaHQgZWRnZVxuICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBwSW50LncgLSAxLCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgIFxuICAgIC8vIERyYXcgdGhlIFttaXNdbWF0Y2ggKE0vWC89KSBibG9ja3NcbiAgICBpZiAoZHJhd01hdGVzICYmIGRhdGEuZC5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKHtibG9ja0ludHM6IGRhdGEubWF0ZUJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQubWF0ZS5zdHJhbmR9KTsgfVxuICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2NrU2V0KSB7XG4gICAgICB2YXIgc3RyYW5kID0gYmxvY2tTZXQuc3RyYW5kO1xuICAgICAgXy5lYWNoKGJsb2NrU2V0LmJsb2NrSW50cywgZnVuY3Rpb24oYkludCwgYmxvY2tOdW0pIHtcbiAgICAgIFxuICAgICAgICAvLyBTa2lwIGRyYXdpbmcgYmxvY2tzIHRoYXQgYXJlbid0IGluc2lkZSB0aGUgY2FudmFzXG4gICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPCAwIHx8IGJJbnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgXG4gICAgICAgIGlmIChibG9ja051bSA9PSAwICYmIGJsb2NrU2V0LnN0cmFuZCA9PSAnLScgJiYgIWJJbnQub1ByZXYpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54ICsgMiwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LngsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIC0xLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSBpZiAoYmxvY2tOdW0gPT0gYmxvY2tTZXQuYmxvY2tJbnRzLmxlbmd0aCAtIDEgJiYgYmxvY2tTZXQuc3RyYW5kID09ICcrJyAmJiAhYkludC5vTmV4dCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54ICsgYkludC53LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAxLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRHJhdyBpbnNlcnRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKDExNCw0MSwyMTgpXCI7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyA/IFtkYXRhLmluc2VydGlvblB0cywgZGF0YS5tYXRlSW5zZXJ0aW9uUHRzXSA6IFtkYXRhLmluc2VydGlvblB0c10sIGZ1bmN0aW9uKGluc2VydGlvblB0cykge1xuICAgICAgXy5lYWNoKGluc2VydGlvblB0cywgZnVuY3Rpb24oaW5zZXJ0KSB7XG4gICAgICAgIGlmIChpbnNlcnQueCArIGluc2VydC53IDwgMCB8fCBpbnNlcnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAxLCBpICogbGluZUhlaWdodCwgMiwgbGluZUhlaWdodCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIGkgKiBsaW5lSGVpZ2h0LCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIChpICsgMSkgKiBsaW5lSGVpZ2h0IC0gaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd0FsbGVsZXM6IGZ1bmN0aW9uKGN0eCwgYWxsZWxlcywgaGVpZ2h0LCBiYXJXaWR0aCkge1xuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICB5UG9zO1xuICAgIF8uZWFjaChhbGxlbGVzLCBmdW5jdGlvbihhbGxlbGVzRm9yUG9zaXRpb24pIHtcbiAgICAgIHlQb3MgPSBoZWlnaHQ7XG4gICAgICBfLmVhY2goYWxsZWxlc0ZvclBvc2l0aW9uLnNwbGl0cywgZnVuY3Rpb24oc3BsaXQpIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbc3BsaXQubnRdKycpJztcbiAgICAgICAgY3R4LmZpbGxSZWN0KGFsbGVsZXNGb3JQb3NpdGlvbi54LCB5UG9zIC09IChzcGxpdC5oICogaGVpZ2h0KSwgTWF0aC5tYXgoYmFyV2lkdGgsIDEpLCBzcGxpdC5oICogaGVpZ2h0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd01pc21hdGNoOiBmdW5jdGlvbihjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCBwcGJwKSB7XG4gICAgLy8gcHBicCA9PSBwaXhlbHMgcGVyIGJhc2UgcGFpciAoaW52ZXJzZSBvZiBicHBwKVxuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIHlQb3M7XG4gICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbbWlzbWF0Y2gubnRdKycpJztcbiAgICBjdHguZmlsbFJlY3QobWlzbWF0Y2gueCwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0KSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwIC8gMiwgTWF0aC5tYXgocHBicCwgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAvLyBEbyB3ZSBoYXZlIHJvb20gdG8gcHJpbnQgYSB3aG9sZSBsZXR0ZXI/XG4gICAgaWYgKHBwYnAgPiA3ICYmIGxpbmVIZWlnaHQgPiAxMCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMjU1LDI1NSwyNTUpJztcbiAgICAgIGN0eC5maWxsVGV4dChtaXNtYXRjaC5udCwgbWlzbWF0Y2gueCArIHBwYnAgKiAwLjUsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCArIDEpICogbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTQgOiA0LFxuICAgICAgY292SGVpZ2h0ID0gZGVuc2l0eSA9PSAnZGVuc2UnID8gMjQgOiAzOCxcbiAgICAgIGNvdk1hcmdpbiA9IDcsXG4gICAgICBsaW5lT2Zmc2V0ID0gKChjb3ZIZWlnaHQgKyBjb3ZNYXJnaW4pIC8gbGluZUhlaWdodCksIFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgICAgICAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBcbiAgICBpZiAoIWRyYXdTcGVjLnNlcXVlbmNlKSB7XG4gICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICBcbiAgICAgIC8vIElmIG5lY2Vzc2FyeSwgaW5kaWNhdGUgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgIGlmIChkcmF3U3BlYy50b29NYW55IHx8IChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE9ubHkgc3RvcmUgYXJlYXMgZm9yIHRoZSBcInBhY2tcIiBkZW5zaXR5LlxuICAgICAgLy8gV2UgaGF2ZSB0byBlbXB0eSB0aGlzIGZvciBldmVyeSByZW5kZXIsIGJlY2F1c2UgYXJlYXMgY2FuIGNoYW5nZSBpZiBCQU0gZGlzcGxheSBvcHRpb25zIGNoYW5nZS5cbiAgICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICAgIC8vIFNldCB0aGUgZXhwZWN0ZWQgaGVpZ2h0IGZvciB0aGUgY2FudmFzICh0aGlzIGFsc28gZXJhc2VzIGl0KS5cbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBjb3ZIZWlnaHQgKyAoKGRlbnNpdHkgPT0gJ2RlbnNlJykgPyAwIDogY292TWFyZ2luICsgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQpO1xuICAgICAgXG4gICAgICAvLyBGaXJzdCBkcmF3IHRoZSBjb3ZlcmFnZSBncmFwaFxuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDE1OSwxNTksMTU5KVwiO1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3Q292ZXJhZ2UuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmNvdmVyYWdlLCBjb3ZIZWlnaHQpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgLy8gTm93LCBkcmF3IGFsaWdubWVudHMgYmVsb3cgaXRcbiAgICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScpIHtcbiAgICAgICAgLy8gQm9yZGVyIGJldHdlZW4gY292ZXJhZ2VcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDEwOSwxMDksMTA5KVwiO1xuICAgICAgICBjdHguZmlsbFJlY3QoMCwgY292SGVpZ2h0ICsgMSwgZHJhd1NwZWMud2lkdGgsIDEpOyBcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgICBcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICAgIGkgKz0gbGluZU9mZnNldDsgLy8gaGFja2lzaCBtZXRob2QgZm9yIGxlYXZpbmcgc3BhY2UgYXQgdGhlIHRvcCBmb3IgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsaWdubWVudC5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQsIGRyYXdTcGVjLnZpZXdBc1BhaXJzKTtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2U6XG4gICAgICAvLyAoMSkgYWxsZWxlIHNwbGl0cyBvdmVyIGNvdmVyYWdlXG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGxlbGVzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5hbGxlbGVzLCBjb3ZIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIC8vICgyKSBtaXNtYXRjaGVzIG92ZXIgdGhlIGFsaWdubWVudHNcbiAgICAgIGN0eC5mb250ID0gXCIxMnB4ICdNZW5sbycsJ0JpdHN0cmVhbSBWZXJhIFNhbnMgTW9ubycsJ0NvbnNvbGFzJywnTHVjaWRhIENvbnNvbGUnLG1vbm9zcGFjZVwiO1xuICAgICAgY3R4LnRleHRBbGlnbiA9ICdjZW50ZXInO1xuICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdiYXNlbGluZSc7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubWlzbWF0Y2hlcywgZnVuY3Rpb24obWlzbWF0Y2gpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3TWlzbWF0Y2guY2FsbChzZWxmLCBjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgdmFyIGNhbGxiYWNrS2V5ID0gc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5O1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgXG4gICAgICAvLyBIYXZlIHdlIGJlZW4gd2FpdGluZyB0byBkcmF3IHNlcXVlbmNlIGRhdGEgdG9vPyBJZiBzbywgZG8gdGhhdCBub3csIHRvby5cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0pKSB7XG4gICAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKCk7XG4gICAgICAgIGRlbGV0ZSBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgcmVuZGVyU2VxdWVuY2U6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgc2VxdWVuY2UsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIFxuICAgIC8vIElmIHdlIHdlcmVuJ3QgYWJsZSB0byBmZXRjaCBzZXF1ZW5jZSBmb3Igc29tZSByZWFzb24sIHRoZXJlIGlzIG5vIHJlYXNvbiB0byBwcm9jZWVkLlxuICAgIGlmICghc2VxdWVuY2UpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCkge1xuICAgICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGgsIHNlcXVlbmNlOiBzZXF1ZW5jZX0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoZSBjYW52YXMgd2FzIGFscmVhZHkgcmVuZGVyZWQgKGJ5IGxhY2sgb2YgdGhlIGNsYXNzICd1bnJlbmRlcmVkJykuXG4gICAgLy8gSWYgeWVzLCBnbyBhaGVhZCBhbmQgZXhlY3V0ZSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7IGlmIG5vdCwgc2F2ZSBpdCBmb3IgbGF0ZXIuXG4gICAgaWYgKCgnICcgKyBjYW52YXMuY2xhc3NOYW1lICsgJyAnKS5pbmRleE9mKCcgdW5yZW5kZXJlZCAnKSA+IC0xKSB7XG4gICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW3N0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eV0gPSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrO1xuICAgIH0gZWxzZSB7XG4gICAgICByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7XG4gICAgfVxuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmF0dHIoJ2NoZWNrZWQnLCAhIW8udmlld0FzUGFpcnMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoby5jb252ZXJ0Q2hyU2NoZW1lKS5jaGFuZ2UoKTtcbiAgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIG8udmlld0FzUGFpcnMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8uY29udmVydENoclNjaGVtZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoKTtcbiAgICBcbiAgICAvLyBJZiBvLnZpZXdBc1BhaXJzIHdhcyBjaGFuZ2VkLCB3ZSAqbmVlZCogdG8gYmxvdyBhd2F5IHRoZSBnZW5vYnJvd3NlcidzIGFyZWFJbmRleCBcbiAgICAvLyBhbmQgb3VyIGxvY2FsbHkgY2FjaGVkIGFyZWFzLCBhcyBhbGwgdGhlIGFyZWFzIHdpbGwgY2hhbmdlLlxuICAgIGlmIChvLnZpZXdBc1BhaXJzICE9IHRoaXMucHJldk9wdHMudmlld0FzUGFpcnMpIHtcbiAgICAgIHRoaXMuYXJlYXMgPSB7fTtcbiAgICAgIGRlbGV0ZSAkZGlhbG9nLmRhdGEoJ2dlbm9icm93c2VyJykuZ2Vub2Jyb3dzZXIoJ2FyZWFJbmRleCcpWyRkaWFsb2cuZGF0YSgndHJhY2snKS5uXTtcbiAgICB9XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJhbUZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCRUQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gYmVkRGV0YWlsIGlzIGEgdHJpdmlhbCBleHRlbnNpb24gb2YgQkVEIHRoYXQgaXMgZGVmaW5lZCBzZXBhcmF0ZWx5LFxuLy8gYWx0aG91Z2ggYSBCRUQgZmlsZSB3aXRoID4xMiBjb2x1bW5zIGlzIGFzc3VtZWQgdG8gYmUgYmVkRGV0YWlsIHRyYWNrIHJlZ2FyZGxlc3Mgb2YgdHlwZS5cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIExpbmVNYXNrID0gcmVxdWlyZSgnLi91dGlscy9MaW5lTWFzay5qcycpLkxpbmVNYXNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRcbnZhciBCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfVxuICB9LFxuICBcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBhbHRDb2xvcnMgPSBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gYWx0Q29sb3JzLmxlbmd0aCA+IDEgJiYgXy5hbGwoYWx0Q29sb3JzLCBzZWxmLnZhbGlkYXRlQ29sb3IpO1xuICAgIHNlbGYub3B0cy51c2VTY29yZSA9IHNlbGYuaXNPbihzZWxmLm9wdHMudXNlU2NvcmUpO1xuICAgIHNlbGYub3B0cy5pdGVtUmdiID0gc2VsZi5pc09uKHNlbGYub3B0cy5pdGVtUmdiKTtcbiAgICBpZiAoIXZhbGlkQ29sb3JCeVN0cmFuZCkgeyBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZCA9ICcnOyBzZWxmLm9wdHMuYWx0Q29sb3IgPSBudWxsOyB9XG4gICAgZWxzZSB7IHNlbGYub3B0cy5hbHRDb2xvciA9IGFsdENvbG9yc1sxXTsgfVxuICB9LFxuXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnbmFtZScsICdzY29yZScsICdzdHJhbmQnLCAndGhpY2tTdGFydCcsICd0aGlja0VuZCcsICdpdGVtUmdiJyxcbiAgICAgICdibG9ja0NvdW50JywgJ2Jsb2NrU2l6ZXMnLCAnYmxvY2tTdGFydHMnLCAnaWQnLCAnZGVzY3JpcHRpb24nXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IC9cXHQvLnRlc3QobGluZSkgPyBsaW5lLnNwbGl0KFwiXFx0XCIpIDogbGluZS5zcGxpdCgvXFxzKy8pLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGlmICh0aGlzLm9wdHMuZGV0YWlsKSB7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAyXSA9ICdpZCc7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAxXSA9ICdkZXNjcmlwdGlvbic7XG4gICAgfVxuICAgIF8uZWFjaChmaWVsZHMsIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUuY2hyb21dO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHsgXG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgJ1wiK2ZlYXR1cmUuY2hyb20rXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbVN0YXJ0KSArIDE7XG4gICAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbUVuZCkgKyAxO1xuICAgICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgICAgLy8gZmFuY2llciBCRUQgZmVhdHVyZXMgdG8gZXhwcmVzcyBjb2RpbmcgcmVnaW9ucyBhbmQgZXhvbnMvaW50cm9uc1xuICAgICAgaWYgKC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja1N0YXJ0KSAmJiAvXlxcZCskLy50ZXN0KGZlYXR1cmUudGhpY2tFbmQpKSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja1N0YXJ0KSArIDE7XG4gICAgICAgIGZlYXR1cmUudGhpY2tFbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUudGhpY2tFbmQpICsgMTtcbiAgICAgICAgaWYgKC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU2l6ZXMpICYmIC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU3RhcnRzKSkge1xuICAgICAgICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgICAgICAgYmxvY2tTaXplcyA9IGZlYXR1cmUuYmxvY2tTaXplcy5zcGxpdCgvLC8pO1xuICAgICAgICAgIF8uZWFjaChmZWF0dXJlLmJsb2NrU3RhcnRzLnNwbGl0KC8sLyksIGZ1bmN0aW9uKHN0YXJ0LCBpKSB7XG4gICAgICAgICAgICBpZiAoc3RhcnQgPT09ICcnKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcGFyc2VJbnQxMChzdGFydCl9O1xuICAgICAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBwYXJzZUludDEwKGJsb2NrU2l6ZXNbaV0pO1xuICAgICAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pO1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGxpbmUsIGxpbmVubyk7XG4gICAgICBpZiAoZmVhdHVyZSkgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIHN0YWNrZWRMYXlvdXQ6IGZ1bmN0aW9uKGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSkge1xuICAgIC8vIEEgbGluZU51bSBmdW5jdGlvbiBjYW4gYmUgcHJvdmlkZWQgd2hpY2ggY2FuIHNldC9yZXRyaWV2ZSB0aGUgbGluZSBvZiBhbHJlYWR5IHJlbmRlcmVkIGRhdGFwb2ludHNcbiAgICAvLyBzbyBhcyB0byBub3QgYnJlYWsgYSByYW5nZWQgZmVhdHVyZSB0aGF0IGV4dGVuZHMgb3ZlciBtdWx0aXBsZSB0aWxlcy5cbiAgICBsaW5lTnVtID0gXy5pc0Z1bmN0aW9uKGxpbmVOdW0pID8gbGluZU51bSA6IGZ1bmN0aW9uKCkgeyByZXR1cm47IH07XG4gICAgdmFyIGxpbmVzID0gW10sXG4gICAgICBtYXhFeGlzdGluZ0xpbmUgPSBfLm1heChfLm1hcChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIGxpbmVOdW0odi5kYXRhKSB8fCAwOyB9KSkgKyAxLFxuICAgICAgc29ydGVkSW50ZXJ2YWxzID0gXy5zb3J0QnkoaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7IHZhciBsbiA9IGxpbmVOdW0odi5kYXRhKTsgcmV0dXJuIF8uaXNVbmRlZmluZWQobG4pID8gMSA6IC1sbjsgfSk7XG4gICAgXG4gICAgd2hpbGUgKG1heEV4aXN0aW5nTGluZS0tPjApIHsgbGluZXMucHVzaChuZXcgTGluZU1hc2sod2lkdGgsIDUpKTsgfVxuICAgIF8uZWFjaChzb3J0ZWRJbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHZhciBkID0gdi5kYXRhLFxuICAgICAgICBsbiA9IGxpbmVOdW0oZCksXG4gICAgICAgIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwoZCksXG4gICAgICAgIHRoaWNrSW50ID0gZC50aGlja1N0YXJ0ICE9PSBudWxsICYmIGNhbGNQaXhJbnRlcnZhbCh7c3RhcnQ6IGQudGhpY2tTdGFydCwgZW5kOiBkLnRoaWNrRW5kfSksXG4gICAgICAgIGJsb2NrSW50cyA9IGQuYmxvY2tzICE9PSBudWxsICYmICBfLm1hcChkLmJsb2NrcywgY2FsY1BpeEludGVydmFsKSxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGwgPSBsaW5lcy5sZW5ndGg7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQobG4pKSB7XG4gICAgICAgIGlmIChsaW5lc1tsbl0uY29uZmxpY3QocEludC50eCwgcEludC50dykpIHsgY29uc29sZS5sb2coXCJVbnJlc29sdmFibGUgTGluZU1hc2sgY29uZmxpY3QhXCIpOyB9XG4gICAgICAgIGxpbmVzW2xuXS5hZGQocEludC50eCwgcEludC50dywge3BJbnQ6IHBJbnQsIHRoaWNrSW50OiB0aGlja0ludCwgYmxvY2tJbnRzOiBibG9ja0ludHMsIGQ6IGR9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoaWxlIChpIDwgbCAmJiBsaW5lc1tpXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyArK2k7IH1cbiAgICAgICAgaWYgKGkgPT0gbCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgICAgIGxpbmVOdW0oZCwgaSk7XG4gICAgICAgIGxpbmVzW2ldLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gXy5wbHVjayhsLml0ZW1zLCAnZGF0YScpOyB9KTtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIGludGVydmFscyA9IHRoaXMuZGF0YS5zZWFyY2goc3RhcnQsIGVuZCksXG4gICAgICBkcmF3U3BlYyA9IFtdLFxuICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJyk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXQpIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXQpKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgIHZhciBwSW50ID0gY2FsY1BpeEludGVydmFsKHYuZGF0YSk7XG4gICAgICAgIHBJbnQudiA9IHYuZGF0YS5zY29yZTtcbiAgICAgICAgZHJhd1NwZWMucHVzaChwSW50KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHRoaXMudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHRoaXMsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSl9O1xuICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGFkZEFyZWE6IGZ1bmN0aW9uKGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSkge1xuICAgIHZhciB0aXBUaXBEYXRhID0ge30sXG4gICAgICB0aXBUaXBEYXRhQ2FsbGJhY2sgPSB0aGlzLnR5cGUoKS50aXBUaXBEYXRhO1xuICAgIGlmICghYXJlYXMpIHsgcmV0dXJuOyB9XG4gICAgaWYgKF8uaXNGdW5jdGlvbih0aXBUaXBEYXRhQ2FsbGJhY2spKSB7XG4gICAgICB0aXBUaXBEYXRhID0gdGlwVGlwRGF0YUNhbGxiYWNrLmNhbGwodGhpcywgZGF0YSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuZGVzY3JpcHRpb24pKSB7IHRpcFRpcERhdGEuZGVzY3JpcHRpb24gPSBkYXRhLmQuZGVzY3JpcHRpb247IH1cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuc2NvcmUpKSB7IHRpcFRpcERhdGEuc2NvcmUgPSBkYXRhLmQuc2NvcmU7IH1cbiAgICAgIF8uZXh0ZW5kKHRpcFRpcERhdGEsIHtcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH0pO1xuICAgICAgLy8gRGlzcGxheSB0aGUgSUQgY29sdW1uIChmcm9tIGJlZERldGFpbCksIHVubGVzcyBpdCBjb250YWlucyBhIHRhYiBjaGFyYWN0ZXIsIHdoaWNoIG1lYW5zIGl0IHdhcyBhdXRvZ2VuZXJhdGVkXG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSAmJiAhKC9cXHQvKS50ZXN0KGRhdGEuZC5pZCkpIHsgdGlwVGlwRGF0YS5pZCA9IGRhdGEuZC5pZDsgfVxuICAgIH1cbiAgICBhcmVhcy5wdXNoKFtcbiAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvLyB4MSwgeDIsIHkxLCB5MlxuICAgICAgZGF0YS5kLm5hbWUgfHwgZGF0YS5kLmlkIHx8ICcnLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5hbWVcbiAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgXy5pc1VuZGVmaW5lZChkYXRhLmQuaWQpID8gZGF0YS5kLm5hbWUgOiBkYXRhLmQuaWQpLCAgICAvLyBocmVmXG4gICAgICBkYXRhLnBJbnQub1ByZXYsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgIG51bGwsXG4gICAgICBudWxsLFxuICAgICAgdGlwVGlwRGF0YVxuICAgIF0pO1xuICB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhbiBhbHBoYSB2YWx1ZSBiZXR3ZWVuIDAuMiBhbmQgMS4wXG4gIGNhbGNBbHBoYTogZnVuY3Rpb24odmFsdWUpIHsgcmV0dXJuIE1hdGgubWF4KHZhbHVlLCAxNjYpLzEwMDA7IH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGEgY29sb3Igc2NhbGVkIGJldHdlZW4gI2NjY2NjYyBhbmQgbWF4IENvbG9yXG4gIGNhbGNHcmFkaWVudDogZnVuY3Rpb24obWF4Q29sb3IsIHZhbHVlKSB7XG4gICAgdmFyIG1pbkNvbG9yID0gWzIzMCwyMzAsMjMwXSxcbiAgICAgIHZhbHVlQ29sb3IgPSBbXTtcbiAgICBpZiAoIV8uaXNBcnJheShtYXhDb2xvcikpIHsgbWF4Q29sb3IgPSBfLm1hcChtYXhDb2xvci5zcGxpdCgnLCcpLCBwYXJzZUludDEwKTsgfVxuICAgIF8uZWFjaChtaW5Db2xvciwgZnVuY3Rpb24odiwgaSkgeyB2YWx1ZUNvbG9yW2ldID0gKHYgLSBtYXhDb2xvcltpXSkgKiAoKDEwMDAgLSB2YWx1ZSkgLyAxMDAwLjApICsgbWF4Q29sb3JbaV07IH0pO1xuICAgIHJldHVybiBfLm1hcCh2YWx1ZUNvbG9yLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gIH0sXG4gIFxuICBkcmF3QXJyb3dzOiBmdW5jdGlvbihjdHgsIGNhbnZhc1dpZHRoLCBsaW5lWSwgaGFsZkhlaWdodCwgc3RhcnRYLCBlbmRYLCBkaXJlY3Rpb24pIHtcbiAgICB2YXIgYXJyb3dIZWlnaHQgPSBNYXRoLm1pbihoYWxmSGVpZ2h0LCAzKSxcbiAgICAgIFgxLCBYMjtcbiAgICBzdGFydFggPSBNYXRoLm1heChzdGFydFgsIDApO1xuICAgIGVuZFggPSBNYXRoLm1pbihlbmRYLCBjYW52YXNXaWR0aCk7XG4gICAgaWYgKGVuZFggLSBzdGFydFggPCA1KSB7IHJldHVybjsgfSAvLyBjYW4ndCBkcmF3IGFycm93cyBpbiB0aGF0IG5hcnJvdyBvZiBhIHNwYWNlXG4gICAgaWYgKGRpcmVjdGlvbiAhPT0gJysnICYmIGRpcmVjdGlvbiAhPT0gJy0nKSB7IHJldHVybjsgfSAvLyBpbnZhbGlkIGRpcmVjdGlvblxuICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAvLyBBbGwgdGhlIDAuNSdzIGhlcmUgYXJlIGR1ZSB0byA8Y2FudmFzPidzIHNvbWV3aGF0IHNpbGx5IGNvb3JkaW5hdGUgc3lzdGVtIFxuICAgIC8vIGh0dHA6Ly9kaXZlaW50b2h0bWw1LmluZm8vY2FudmFzLmh0bWwjcGl4ZWwtbWFkbmVzc1xuICAgIFgxID0gZGlyZWN0aW9uID09ICcrJyA/IDAuNSA6IGFycm93SGVpZ2h0ICsgMC41O1xuICAgIFgyID0gZGlyZWN0aW9uID09ICcrJyA/IGFycm93SGVpZ2h0ICsgMC41IDogMC41O1xuICAgIGZvciAodmFyIGkgPSBNYXRoLmZsb29yKHN0YXJ0WCkgKyAyOyBpIDwgZW5kWCAtIGFycm93SGVpZ2h0OyBpICs9IDcpIHtcbiAgICAgIGN0eC5tb3ZlVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgLSBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMiwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgKyBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgfVxuICAgIGN0eC5zdHJva2UoKTtcbiAgfSxcbiAgXG4gIGRyYXdGZWF0dXJlOiBmdW5jdGlvbihjdHgsIHdpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICB5ID0gaSAqIGxpbmVIZWlnaHQsXG4gICAgICBoYWxmSGVpZ2h0ID0gTWF0aC5yb3VuZCgwLjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIHF1YXJ0ZXJIZWlnaHQgPSBNYXRoLmNlaWwoMC4yNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDEsXG4gICAgICB0aGlja092ZXJsYXAgPSBudWxsLFxuICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgIFxuICAgIC8vIEZpcnN0LCBkZXRlcm1pbmUgYW5kIHNldCB0aGUgY29sb3Igd2Ugd2lsbCBiZSB1c2luZ1xuICAgIC8vIE5vdGUgdGhhdCB0aGUgZGVmYXVsdCBjb2xvciB3YXMgYWxyZWFkeSBzZXQgaW4gZHJhd1NwZWNcbiAgICBpZiAoc2VsZi5vcHRzLmFsdENvbG9yICYmIGRhdGEuZC5zdHJhbmQgPT0gJy0nKSB7IGNvbG9yID0gc2VsZi5vcHRzLmFsdENvbG9yOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy5pdGVtUmdiICYmIGRhdGEuZC5pdGVtUmdiICYmIHRoaXMudmFsaWRhdGVDb2xvcihkYXRhLmQuaXRlbVJnYikpIHsgY29sb3IgPSBkYXRhLmQuaXRlbVJnYjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMudXNlU2NvcmUpIHsgY29sb3IgPSBzZWxmLnR5cGUoJ2JlZCcpLmNhbGNHcmFkaWVudChjb2xvciwgZGF0YS5kLnNjb3JlKTsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiB8fCBzZWxmLm9wdHMuYWx0Q29sb3IgfHwgc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7IH1cbiAgICBcbiAgICBpZiAoZGF0YS50aGlja0ludCkge1xuICAgICAgLy8gVGhlIGNvZGluZyByZWdpb24gaXMgZHJhd24gYXMgYSB0aGlja2VyIGxpbmUgd2l0aGluIHRoZSBnZW5lXG4gICAgICBpZiAoZGF0YS5ibG9ja0ludHMpIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGV4b25zIGFuZCBpbnRyb25zLCBkcmF3IHRoZSBpbnRyb25zIHdpdGggYSAxcHggbGluZVxuICAgICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQsIGRhdGEucEludC53LCAxKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gICAgICAgIF8uZWFjaChkYXRhLmJsb2NrSW50cywgZnVuY3Rpb24oYkludCkge1xuICAgICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPD0gd2lkdGggJiYgYkludC54ID49IDApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGJJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpY2tPdmVybGFwID0gdXRpbHMucGl4SW50ZXJ2YWxPdmVybGFwKGJJbnQsIGRhdGEudGhpY2tJbnQpO1xuICAgICAgICAgIGlmICh0aGlja092ZXJsYXApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdCh0aGlja092ZXJsYXAueCwgeSArIDEsIHRoaWNrT3ZlcmxhcC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBpbnRyb25zLCBhcnJvd3MgYXJlIGRyYXduIG9uIHRoZSBpbnRyb25zLCBub3QgdGhlIGV4b25zLi4uXG4gICAgICAgICAgaWYgKGRhdGEuZC5zdHJhbmQgJiYgcHJldkJJbnQpIHtcbiAgICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBwcmV2QkludC54ICsgcHJldkJJbnQudywgYkludC54LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJldkJJbnQgPSBiSW50O1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gLi4udW5sZXNzIHRoZXJlIHdlcmUgbm8gaW50cm9ucy4gVGhlbiBpdCBpcyBkcmF3biBvbiB0aGUgY29kaW5nIHJlZ2lvbi5cbiAgICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFdlIGhhdmUgYSBjb2RpbmcgcmVnaW9uIGJ1dCBubyBpbnRyb25zL2V4b25zXG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQgLSBxdWFydGVySGVpZ2h0ICsgMSwgZGF0YS5wSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnRoaWNrSW50LngsIHkgKyAxLCBkYXRhLnRoaWNrSW50LncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb3RoaW5nIGZhbmN5LiAgSXQncyBhIGJveC5cbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS5wSW50LngsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHNlbGYub3B0cy51cmwgPyBzZWxmLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNSA6IDYsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICAvLyBUT0RPOiBJIGRpc2FibGVkIHJlZ2VuZXJhdGluZyBhcmVhcyBoZXJlLCB3aGljaCBhc3N1bWVzIHRoYXQgbGluZU51bSByZW1haW5zIHN0YWJsZSBhY3Jvc3MgcmUtcmVuZGVycy4gU2hvdWxkIGNoZWNrIG9uIHRoaXMuXG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgIF8uZWFjaChkcmF3U3BlYywgZnVuY3Rpb24ocEludCkge1xuICAgICAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBcInJnYmEoXCIrc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIHBJbnQudikrXCIpXCI7IH1cbiAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0ICYmIGRyYXdTcGVjLmxheW91dC5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3RmVhdHVyZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpOyAgICAgICAgICAgICAgXG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG5cbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbG9yQnlTdHJhbmRPbiA9IC9cXGQrLFxcZCssXFxkK1xccytcXGQrLFxcZCssXFxkKy8udGVzdChvLmNvbG9yQnlTdHJhbmQpLFxuICAgICAgY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiA/IG8uY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pWzFdIDogJzAsMCwwJztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5hdHRyKCdjaGVja2VkJywgISFjb2xvckJ5U3RyYW5kT24pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZF0nKS52YWwoY29sb3JCeVN0cmFuZCkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11c2VTY29yZV0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8udXNlU2NvcmUpKTsgICAgXG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11cmxdJykudmFsKG8udXJsKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKCksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSB0aGlzLnZhbGlkYXRlQ29sb3IoY29sb3JCeVN0cmFuZCk7XG4gICAgby5jb2xvckJ5U3RyYW5kID0gY29sb3JCeVN0cmFuZE9uICYmIHZhbGlkQ29sb3JCeVN0cmFuZCA/IG8uY29sb3IgKyAnICcgKyBjb2xvckJ5U3RyYW5kIDogJyc7XG4gICAgby51c2VTY29yZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuaXMoJzpjaGVja2VkJykgPyAxIDogMDtcbiAgICBvLnVybCA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbCgpO1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiZWRHcmFwaCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JlZGdyYXBoLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRncmFwaFxudmFyIEJlZEdyYXBoRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0LmNhbGwodGhpcyk7IH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB1dGlscy53aWdCaW5GdW5jdGlvbnMsXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTsgfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICdkYXRhVmFsdWUnXSxcbiAgICAgICAgZGF0dW0gPSB7fSxcbiAgICAgICAgY2hyUG9zLCBzdGFydCwgZW5kLCB2YWw7XG4gICAgICBfLmVhY2gobGluZS5zcGxpdCgvXFxzKy8pLCBmdW5jdGlvbih2LCBpKSB7IGRhdHVtW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tkYXR1bS5jaHJvbV07XG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgfVxuICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGRhdHVtLmNocm9tU3RhcnQpO1xuICAgICAgZW5kID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbUVuZCk7XG4gICAgICB2YWwgPSBwYXJzZUZsb2F0KGRhdHVtLmRhdGFWYWx1ZSk7XG4gICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgZW5kLCB2YWw6IHZhbH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRHcmFwaEZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnQmVkIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnQmVkLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iaWdiZWRcbnZhciBCaWdCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY2hyb21vc29tZXM6ICcnLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAwXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdCZWQgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBjYWNoZSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIGRlbnNpdHk6ICdwYWNrJ30sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IFxuICAgICAgICAgICAgdmFyIGl0dmwgPSBzZWxmLnR5cGUoJ2JlZCcpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyBcbiAgICAgICAgICAgIC8vIFVzZSBCaW9QZXJsJ3MgQmlvOjpEQjpCaWdCZWQgc3RyYXRlZ3kgZm9yIGRlZHVwbGljYXRpbmcgcmUtZmV0Y2hlZCBpbnRlcnZhbHM6XG4gICAgICAgICAgICAvLyBcIkJlY2F1c2UgQkVEIGZpbGVzIGRvbid0IGFjdHVhbGx5IHVzZSBJRHMsIHRoZSBJRCBpcyBjb25zdHJ1Y3RlZCBmcm9tIHRoZSBmZWF0dXJlJ3MgbmFtZSAoaWYgYW55KSwgY2hyb21vc29tZSBjb29yZGluYXRlcywgc3RyYW5kIGFuZCBibG9jayBjb3VudC5cIlxuICAgICAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoaXR2bC5pZCkpIHtcbiAgICAgICAgICAgICAgaXR2bC5pZCA9IFtpdHZsLm5hbWUsIGl0dmwuY2hyb20sIGl0dmwuY2hyb21TdGFydCwgaXR2bC5jaHJvbUVuZCwgaXR2bC5zdHJhbmQsIGl0dmwuYmxvY2tDb3VudF0uam9pbihcIlxcdFwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpdHZsO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlfTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJpZ0JlZCBhbmQgc2V0dXAgdGhlIGJpbm5pbmcgc2NoZW1lIGZvciB0aGUgUmVtb3RlVHJhY2tcbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YTogeyB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsIH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIC8vIFNldCBtYXhGZXRjaFdpbmRvdyB0byBhdm9pZCBvdmVyZmV0Y2hpbmcgZGF0YS5cbiAgICAgICAgaWYgKCFzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgICAgICB2YXIgbWVhbkl0ZW1zUGVyQnAgPSBkYXRhLml0ZW1Db3VudCAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgICAgICAgIG1heEl0ZW1zVG9EcmF3ID0gXy5tYXgoXy52YWx1ZXMoc2VsZi5vcHRzLmRyYXdMaW1pdCkpO1xuICAgICAgICAgIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyA9IG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgICAgc2VsZi5vcHRzLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioc2VsZi5vcHRzLm1heEZldGNoV2luZG93IC8gMyk7XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3csIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gcGFyc2VEZW5zZURhdGEoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gW10sIFxuICAgICAgICBsaW5lcztcbiAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgeCkgeyBcbiAgICAgICAgaWYgKGxpbmUgIT0gJ24vYScgJiYgbGluZS5sZW5ndGgpIHsgZHJhd1NwZWMucHVzaCh7eDogeCwgdzogMSwgdjogcGFyc2VGbG9hdChsaW5lKSAqIDEwMDB9KTsgfSBcbiAgICAgIH0pO1xuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgZGVuc2l0eSBpcyBub3QgJ2RlbnNlJyBhbmQgd2UgY2FuIHJlYXNvbmFibHlcbiAgICAvLyBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggdG9vIG1hbnkgcm93cyAoPjUwMCBmZWF0dXJlcyksIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsIHtcbiAgICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCB3aWR0aDogd2lkdGgsIGRlbnNpdHk6IGRlbnNpdHl9LFxuICAgICAgICAgIHN1Y2Nlc3M6IHBhcnNlRGVuc2VEYXRhXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICAgIHZhciBjYWxjUGl4SW50ZXJ2YWwsIGRyYXdTcGVjID0ge307XG4gICAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHkgPT0gJ3BhY2snKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pO1xuICAgICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdCZWRGb3JtYXQ7IiwiXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdXaWcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdXaWcuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEJpZ1dpZ0Zvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJzEyOCwxMjgsMTI4JyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIGJpZ1dpZyB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogeydtaW5pbXVtJzoxLCAnbWF4aW11bSc6MSwgJ21lYW4nOjEsICdtaW4nOjEsICdtYXgnOjEsICdzdGQnOjEsICdjb3ZlcmFnZSc6MX0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24oc2VsZi5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge2luZm86IDEsIHVybDogdGhpcy5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgYXN5bmM6IGZhbHNlLCAgLy8gVGhpcyBpcyBjb29sIHNpbmNlIHBhcnNpbmcgbm9ybWFsbHkgaGFwcGVucyBpbiBhIFdlYiBXb3JrZXJcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIHJvd3MgPSBkYXRhLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICBfLmVhY2gocm93cywgZnVuY3Rpb24ocikge1xuICAgICAgICAgIHZhciBrZXl2YWwgPSByLnNwbGl0KCc6ICcpO1xuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtaW4nKSB7IHNlbGYucmFuZ2VbMF0gPSBNYXRoLm1pbihwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMF0pOyB9XG4gICAgICAgICAgaWYgKGtleXZhbFswXT09J21heCcpIHsgc2VsZi5yYW5nZVsxXSA9IE1hdGgubWF4KHBhcnNlRmxvYXQoa2V5dmFsWzFdKSwgc2VsZi5yYW5nZVsxXSk7IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgY2hyUmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIGlmIChsaW5lID09ICduL2EnKSB7IGRyYXdTcGVjLmJhcnMucHVzaChudWxsKTsgfVxuICAgICAgICBlbHNlIGlmIChsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5iYXJzLnB1c2goKHBhcnNlRmxvYXQobGluZSkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpOyB9XG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge3JhbmdlOiBjaHJSYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCB3aW5GdW5jOiBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb259LFxuICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgIH0pO1xuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpO1xuICAgICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpZ1dpZ0Zvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGZlYXR1cmVUYWJsZSBmb3JtYXQ6IGh0dHA6Ly93d3cuaW5zZGMub3JnL2ZpbGVzL2ZlYXR1cmVfdGFibGUuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuZmVhdHVyZXRhYmxlXG52YXIgRmVhdHVyZVRhYmxlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNvbGxhcHNlQnlHZW5lOiAnb2ZmJyxcbiAgICBrZXlDb2x1bW5XaWR0aDogMjEsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogbnVsbCwgcGFjazogbnVsbH1cbiAgfSxcbiAgXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgICB0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUgPSB0aGlzLmlzT24odGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKTtcbiAgICB0aGlzLmZlYXR1cmVUeXBlQ291bnRzID0ge307XG4gIH0sXG4gIFxuICAvLyBwYXJzZXMgb25lIGZlYXR1cmUga2V5ICsgbG9jYXRpb24vcXVhbGlmaWVycyByb3cgZnJvbSB0aGUgZmVhdHVyZSB0YWJsZVxuICBwYXJzZUVudHJ5OiBmdW5jdGlvbihjaHJvbSwgbGluZXMsIHN0YXJ0TGluZU5vKSB7XG4gICAgdmFyIGZlYXR1cmUgPSB7XG4gICAgICAgIGNocm9tOiBjaHJvbSxcbiAgICAgICAgc2NvcmU6ICc/JyxcbiAgICAgICAgYmxvY2tzOiBudWxsLFxuICAgICAgICBxdWFsaWZpZXJzOiB7fVxuICAgICAgfSxcbiAgICAgIGtleUNvbHVtbldpZHRoID0gdGhpcy5vcHRzLmtleUNvbHVtbldpZHRoLFxuICAgICAgcXVhbGlmaWVyID0gbnVsbCxcbiAgICAgIGZ1bGxMb2NhdGlvbiA9IFtdLFxuICAgICAgY29sbGFwc2VLZXlRdWFsaWZpZXJzID0gWydsb2N1c190YWcnLCAnZ2VuZScsICdkYl94cmVmJ10sXG4gICAgICBxdWFsaWZpZXJzVGhhdEFyZU5hbWVzID0gWydnZW5lJywgJ2xvY3VzX3RhZycsICdkYl94cmVmJ10sXG4gICAgICBSTkFUeXBlcyA9IFsncnJuYScsICd0cm5hJ10sXG4gICAgICBhbHNvVHJ5Rm9yUk5BVHlwZXMgPSBbJ3Byb2R1Y3QnXSxcbiAgICAgIGxvY2F0aW9uUG9zaXRpb25zLCBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyb21dO1xuICAgIHN0YXJ0TGluZU5vID0gc3RhcnRMaW5lTm8gfHwgMDtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaWxsIG91dCBmZWF0dXJlJ3Mga2V5cyB3aXRoIGluZm8gZnJvbSB0aGVzZSBsaW5lc1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIga2V5ID0gbGluZS5zdWJzdHIoMCwga2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICByZXN0T2ZMaW5lID0gbGluZS5zdWJzdHIoa2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICBxdWFsaWZpZXJNYXRjaCA9IHJlc3RPZkxpbmUubWF0Y2goL15cXC8oXFx3KykoPT8pKC4qKS8pO1xuICAgICAgaWYgKGtleS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgZmVhdHVyZS50eXBlID0gc3RyaXAoa2V5KTtcbiAgICAgICAgcXVhbGlmaWVyID0gbnVsbDtcbiAgICAgICAgZnVsbExvY2F0aW9uLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocXVhbGlmaWVyTWF0Y2gpIHtcbiAgICAgICAgICBxdWFsaWZpZXIgPSBxdWFsaWZpZXJNYXRjaFsxXTtcbiAgICAgICAgICBpZiAoIWZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKSB7IGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdID0gW107IH1cbiAgICAgICAgICBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXS5wdXNoKFtxdWFsaWZpZXJNYXRjaFsyXSA/IHF1YWxpZmllck1hdGNoWzNdIDogdHJ1ZV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChxdWFsaWZpZXIgIT09IG51bGwpIHsgXG4gICAgICAgICAgICBfLmxhc3QoZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0pLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uLmpvaW4oJycpO1xuICAgIGxvY2F0aW9uUG9zaXRpb25zID0gXy5tYXAoXy5maWx0ZXIoZnVsbExvY2F0aW9uLnNwbGl0KC9cXEQrLyksIF8uaWRlbnRpdHkpLCBwYXJzZUludDEwKTtcbiAgICBmZWF0dXJlLmNocm9tU3RhcnQgPSAgXy5taW4obG9jYXRpb25Qb3NpdGlvbnMpO1xuICAgIGZlYXR1cmUuY2hyb21FbmQgPSBfLm1heChsb2NhdGlvblBvc2l0aW9ucykgKyAxOyAvLyBGZWF0dXJlIHRhYmxlIHJhbmdlcyBhcmUgKmluY2x1c2l2ZSogb2YgdGhlIGVuZCBiYXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNocm9tRW5kIGNvbHVtbnMgaW4gQkVEIGZvcm1hdCBhcmUgKm5vdCouXG4gICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21TdGFydDtcbiAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21FbmQ7IFxuICAgIGZlYXR1cmUuc3RyYW5kID0gL2NvbXBsZW1lbnQvLnRlc3QoZnVsbExvY2F0aW9uKSA/IFwiLVwiIDogXCIrXCI7XG4gICAgXG4gICAgLy8gVW50aWwgd2UgbWVyZ2UgYnkgZ2VuZSBuYW1lLCB3ZSBkb24ndCBjYXJlIGFib3V0IHRoZXNlXG4gICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgIFxuICAgIC8vIFBhcnNlIHRoZSBxdWFsaWZpZXJzIHByb3Blcmx5XG4gICAgXy5lYWNoKGZlYXR1cmUucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgXy5lYWNoKHYsIGZ1bmN0aW9uKGVudHJ5TGluZXMsIGkpIHtcbiAgICAgICAgdltpXSA9IHN0cmlwKGVudHJ5TGluZXMuam9pbignICcpKTtcbiAgICAgICAgaWYgKC9eXCJbXFxzXFxTXSpcIiQvLnRlc3QodltpXSkpIHtcbiAgICAgICAgICAvLyBEZXF1b3RlIGZyZWUgdGV4dFxuICAgICAgICAgIHZbaV0gPSB2W2ldLnJlcGxhY2UoL15cInxcIiQvZywgJycpLnJlcGxhY2UoL1wiXCIvZywgJ1wiJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy9pZiAodi5sZW5ndGggPT0gMSkgeyBmZWF0dXJlLnF1YWxpZmllcnNba10gPSB2WzBdOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmluZCBzb21ldGhpbmcgdGhhdCBjYW4gc2VydmUgYXMgYSBuYW1lXG4gICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS50eXBlO1xuICAgIGlmIChfLmNvbnRhaW5zKFJOQVR5cGVzLCBmZWF0dXJlLnR5cGUudG9Mb3dlckNhc2UoKSkpIHsgXG4gICAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseShxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBhbHNvVHJ5Rm9yUk5BVHlwZXMpOyBcbiAgICB9XG4gICAgXy5maW5kKHF1YWxpZmllcnNUaGF0QXJlTmFtZXMsIGZ1bmN0aW9uKGspIHtcbiAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IHJldHVybiAoZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKTsgfVxuICAgIH0pO1xuICAgIC8vIEluIHRoZSB3b3JzdCBjYXNlLCBhZGQgYSBjb3VudGVyIHRvIGRpc2FtYmlndWF0ZSBmZWF0dXJlcyBuYW1lZCBvbmx5IGJ5IHR5cGVcbiAgICBpZiAoZmVhdHVyZS5uYW1lID09IGZlYXR1cmUudHlwZSkge1xuICAgICAgaWYgKCF0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0pIHsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdID0gMTsgfVxuICAgICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5uYW1lICsgJ18nICsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKys7XG4gICAgfVxuICAgIFxuICAgIC8vIEZpbmQgYSBrZXkgdGhhdCBpcyBhcHByb3ByaWF0ZSBmb3IgY29sbGFwc2luZ1xuICAgIGlmICh0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZmluZChjb2xsYXBzZUtleVF1YWxpZmllcnMsIGZ1bmN0aW9uKGspIHtcbiAgICAgICAgaWYgKGZlYXR1cmUucXVhbGlmaWVyc1trXSAmJiBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pIHsgXG4gICAgICAgICAgcmV0dXJuIChmZWF0dXJlLl9jb2xsYXBzZUtleSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIC8vIGNvbGxhcHNlcyBtdWx0aXBsZSBmZWF0dXJlcyB0aGF0IGFyZSBhYm91dCB0aGUgc2FtZSBnZW5lIGludG8gb25lIGRyYXdhYmxlIGZlYXR1cmVcbiAgY29sbGFwc2VGZWF0dXJlczogZnVuY3Rpb24oZmVhdHVyZXMpIHtcbiAgICB2YXIgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3MsXG4gICAgICBwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8gPSBbJ21ybmEnLCAnZ2VuZScsICdjZHMnXSxcbiAgICAgIHByZWZlcnJlZFR5cGVGb3JFeG9ucyA9IFsnZXhvbicsICdjZHMnXSxcbiAgICAgIG1lcmdlSW50byA9IGZlYXR1cmVzWzBdLFxuICAgICAgYmxvY2tzID0gW10sXG4gICAgICBmb3VuZFR5cGUsIGNkcywgZXhvbnM7XG4gICAgZm91bmRUeXBlID0gXy5maW5kKHByZWZlcnJlZFR5cGVUb01lcmdlSW50bywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgdmFyIGZvdW5kID0gXy5maW5kKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChmb3VuZCkgeyBtZXJnZUludG8gPSBmb3VuZDsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBMb29rIGZvciBleG9ucyAoZXVrYXJ5b3RpYykgb3IgYSBDRFMgKHByb2thcnlvdGljKVxuICAgIF8uZmluZChwcmVmZXJyZWRUeXBlRm9yRXhvbnMsIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIGV4b25zID0gXy5zZWxlY3QoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IHR5cGU7IH0pO1xuICAgICAgaWYgKGV4b25zLmxlbmd0aCkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH0pO1xuICAgIGNkcyA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gXCJjZHNcIjsgfSk7XG4gICAgXG4gICAgXy5lYWNoKGV4b25zLCBmdW5jdGlvbihleG9uRmVhdHVyZSkge1xuICAgICAgZXhvbkZlYXR1cmUuZnVsbExvY2F0aW9uLnJlcGxhY2UoLyhcXGQrKVxcLlxcLls+PF0/KFxcZCspL2csIGZ1bmN0aW9uKGZ1bGxNYXRjaCwgc3RhcnQsIGVuZCkge1xuICAgICAgICBibG9ja3MucHVzaCh7XG4gICAgICAgICAgc3RhcnQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyBNYXRoLm1pbihzdGFydCwgZW5kKSwgXG4gICAgICAgICAgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZS5cbiAgICAgICAgICBlbmQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyAgTWF0aC5tYXgoc3RhcnQsIGVuZCkgKyAxXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ29udmVydCBleG9ucyBhbmQgQ0RTIGludG8gYmxvY2tzLCB0aGlja1N0YXJ0IGFuZCB0aGlja0VuZCAoaW4gQkVEIHRlcm1pbm9sb2d5KVxuICAgIGlmIChibG9ja3MubGVuZ3RoKSB7IFxuICAgICAgbWVyZ2VJbnRvLmJsb2NrcyA9IF8uc29ydEJ5KGJsb2NrcywgZnVuY3Rpb24oYikgeyByZXR1cm4gYi5zdGFydDsgfSk7XG4gICAgICBtZXJnZUludG8udGhpY2tTdGFydCA9IGNkcyA/IGNkcy5zdGFydCA6IGZlYXR1cmUuc3RhcnQ7XG4gICAgICBtZXJnZUludG8udGhpY2tFbmQgPSBjZHMgPyBjZHMuZW5kIDogZmVhdHVyZS5lbmQ7XG4gICAgfVxuICAgIFxuICAgIC8vIGZpbmFsbHksIG1lcmdlIGFsbCB0aGUgcXVhbGlmaWVyc1xuICAgIF8uZWFjaChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkge1xuICAgICAgaWYgKGZlYXQgPT09IG1lcmdlSW50bykgeyByZXR1cm47IH1cbiAgICAgIF8uZWFjaChmZWF0LnF1YWxpZmllcnMsIGZ1bmN0aW9uKHZhbHVlcywgaykge1xuICAgICAgICBpZiAoIW1lcmdlSW50by5xdWFsaWZpZXJzW2tdKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdID0gW107IH1cbiAgICAgICAgXy5lYWNoKHZhbHVlcywgZnVuY3Rpb24odikge1xuICAgICAgICAgIGlmICghXy5jb250YWlucyhtZXJnZUludG8ucXVhbGlmaWVyc1trXSwgdikpIHsgbWVyZ2VJbnRvLnF1YWxpZmllcnNba10ucHVzaCh2KTsgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBtZXJnZUludG87XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBudW1MaW5lcyA9IGxpbmVzLmxlbmd0aCxcbiAgICAgIGNocm9tID0gbnVsbCxcbiAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbCxcbiAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleSA9IHt9LFxuICAgICAgZmVhdHVyZTtcbiAgICBcbiAgICBmdW5jdGlvbiBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubykge1xuICAgICAgaWYgKGxhc3RFbnRyeVN0YXJ0ICE9PSBudWxsKSB7XG4gICAgICAgIGZlYXR1cmUgPSBzZWxmLnR5cGUoKS5wYXJzZUVudHJ5LmNhbGwoc2VsZiwgY2hyb20sIGxpbmVzLnNsaWNlKGxhc3RFbnRyeVN0YXJ0LCBsaW5lbm8pLCBsYXN0RW50cnlTdGFydCk7XG4gICAgICAgIGlmIChmZWF0dXJlKSB7IFxuICAgICAgICAgIGlmIChvLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldID0gZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSB8fCBbXTtcbiAgICAgICAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0ucHVzaChmZWF0dXJlKTtcbiAgICAgICAgICB9IGVsc2UgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIENodW5rIHRoZSBsaW5lcyBpbnRvIGVudHJpZXMgYW5kIHBhcnNlIGVhY2ggb2YgdGhlbVxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICBpZiAobGluZS5zdWJzdHIoMCwgMTIpID09IFwiQUNDRVNTSU9OICAgXCIpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBjaHJvbSA9IGxpbmUuc3Vic3RyKDEyKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmIChjaHJvbSAhPT0gbnVsbCAmJiBsaW5lLnN1YnN0cig1LCAxKS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBsYXN0RW50cnlTdGFydCA9IGxpbmVubztcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBwYXJzZSB0aGUgbGFzdCBlbnRyeVxuICAgIGlmIChjaHJvbSAhPT0gbnVsbCkgeyBjb2xsZWN0TGFzdEVudHJ5KGxpbmVzLmxlbmd0aCk7IH1cbiAgICBcbiAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgXy5lYWNoKGZlYXR1cmVzQnlDb2xsYXBzZUtleSwgZnVuY3Rpb24oZmVhdHVyZXMsIGdlbmUpIHtcbiAgICAgICAgZGF0YS5hZGQoc2VsZi50eXBlKCkuY29sbGFwc2VGZWF0dXJlcy5jYWxsKHNlbGYsIGZlYXR1cmVzKSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gc3BlY2lhbCBmb3JtYXR0ZXIgZm9yIGNvbnRlbnQgaW4gdG9vbHRpcHMgZm9yIGZlYXR1cmVzXG4gIHRpcFRpcERhdGE6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgcXVhbGlmaWVyc1RvQWJicmV2aWF0ZSA9IHt0cmFuc2xhdGlvbjogMX0sXG4gICAgICBjb250ZW50ID0ge1xuICAgICAgICB0eXBlOiBkYXRhLmQudHlwZSxcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH07XG4gICAgaWYgKGRhdGEuZC5xdWFsaWZpZXJzLm5vdGUgJiYgZGF0YS5kLnF1YWxpZmllcnMubm90ZVswXSkgeyAgfVxuICAgIF8uZWFjaChkYXRhLmQucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgaWYgKGsgPT0gJ25vdGUnKSB7IGNvbnRlbnQuZGVzY3JpcHRpb24gPSB2LmpvaW4oJzsgJyk7IHJldHVybjsgfVxuICAgICAgY29udGVudFtrXSA9IHYuam9pbignOyAnKTtcbiAgICAgIGlmIChxdWFsaWZpZXJzVG9BYmJyZXZpYXRlW2tdICYmIGNvbnRlbnRba10ubGVuZ3RoID4gMjUpIHsgY29udGVudFtrXSA9IGNvbnRlbnRba10uc3Vic3RyKDAsIDI1KSArICcuLi4nOyB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykucHJlcmVuZGVyLmNhbGwodGhpcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5kcmF3U3BlYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5yZW5kZXIuY2FsbCh0aGlzLCBjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBGZWF0dXJlVGFibGVGb3JtYXQ7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBTb3J0ZWRMaXN0ID0gcmVxdWlyZSgnLi9Tb3J0ZWRMaXN0LmpzJykuU29ydGVkTGlzdDsgIFxuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvaW50ZXJ2YWwtdHJlZVxuICogSW50ZXJ2YWxUcmVlXG4gKlxuICogQHBhcmFtIChvYmplY3QpIGRhdGE6XG4gKiBAcGFyYW0gKG51bWJlcikgY2VudGVyOlxuICogQHBhcmFtIChvYmplY3QpIG9wdGlvbnM6XG4gKiAgIGNlbnRlcjpcbiAqXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbFRyZWUoY2VudGVyLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgfHwgKG9wdGlvbnMgPSB7fSk7XG5cbiAgdGhpcy5zdGFydEtleSAgICAgPSBvcHRpb25zLnN0YXJ0S2V5IHx8IDA7IC8vIHN0YXJ0IGtleVxuICB0aGlzLmVuZEtleSAgICAgICA9IG9wdGlvbnMuZW5kS2V5ICAgfHwgMTsgLy8gZW5kIGtleVxuICB0aGlzLmludGVydmFsSGFzaCA9IHt9OyAgICAgICAgICAgICAgICAgICAgLy8gaWQgPT4gaW50ZXJ2YWwgb2JqZWN0XG4gIHRoaXMucG9pbnRUcmVlID0gbmV3IFNvcnRlZExpc3QoeyAgICAgICAgICAvLyBiLXRyZWUgb2Ygc3RhcnQsIGVuZCBwb2ludHMgXG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhWzBdLSBiWzBdO1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5fYXV0b0luY3JlbWVudCA9IDA7XG5cbiAgLy8gaW5kZXggb2YgdGhlIHJvb3Qgbm9kZVxuICBpZiAoIWNlbnRlciB8fCB0eXBlb2YgY2VudGVyICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGNlbnRlciBpbmRleCBhcyB0aGUgMm5kIGFyZ3VtZW50LicpO1xuICB9XG5cbiAgdGhpcy5yb290ID0gbmV3IE5vZGUoY2VudGVyLCB0aGlzKTtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIGlmICh0aGlzLmNvbnRhaW5zKGlkKSkge1xuICAgIHRocm93IG5ldyBEdXBsaWNhdGVFcnJvcignaWQgJyArIGlkICsgJyBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuJyk7XG4gIH1cblxuICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgd2hpbGUgKHRoaXMuaW50ZXJ2YWxIYXNoW3RoaXMuX2F1dG9JbmNyZW1lbnRdKSB7XG4gICAgICB0aGlzLl9hdXRvSW5jcmVtZW50Kys7XG4gICAgfVxuICAgIGlkID0gdGhpcy5fYXV0b0luY3JlbWVudDtcbiAgfVxuXG4gIHZhciBpdHZsID0gbmV3IEludGVydmFsKGRhdGEsIGlkLCB0aGlzLnN0YXJ0S2V5LCB0aGlzLmVuZEtleSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5zdGFydCwgaWRdKTtcbiAgdGhpcy5wb2ludFRyZWUuaW5zZXJ0KFtpdHZsLmVuZCwgICBpZF0pO1xuICB0aGlzLmludGVydmFsSGFzaFtpZF0gPSBpdHZsO1xuICB0aGlzLl9hdXRvSW5jcmVtZW50Kys7XG4gIFxuICBfaW5zZXJ0LmNhbGwodGhpcywgdGhpcy5yb290LCBpdHZsKTtcbn07XG5cblxuLyoqXG4gKiBjaGVjayBpZiByYW5nZSBpcyBhbHJlYWR5IHByZXNlbnQsIGJhc2VkIG9uIGl0cyBpZFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5jb250YWlucyA9IGZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiAhIXRoaXMuZ2V0KGlkKTtcbn1cblxuXG4vKipcbiAqIHJldHJpZXZlIGFuIGludGVydmFsIGJ5IGl0cyBpZDsgcmV0dXJucyBudWxsIGlmIGl0IGRvZXMgbm90IGV4aXN0XG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiB0aGlzLmludGVydmFsSGFzaFtpZF0gfHwgbnVsbDtcbn1cblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICB0cnkge1xuICAgIHRoaXMuYWRkKGRhdGEsIGlkKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlIGluc3RhbmNlb2YgRHVwbGljYXRlRXJyb3IpIHsgcmV0dXJuOyB9XG4gICAgdGhyb3cgZTtcbiAgfVxufVxuXG5cbi8qKlxuICogc2VhcmNoXG4gKlxuICogQHBhcmFtIChpbnRlZ2VyKSB2YWw6XG4gKiBAcmV0dXJuIChhcnJheSlcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24odmFsMSwgdmFsMikge1xuICB2YXIgcmV0ID0gW107XG4gIGlmICh0eXBlb2YgdmFsMSAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcih2YWwxICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG5cbiAgaWYgKHZhbDIgPT0gdW5kZWZpbmVkKSB7XG4gICAgX3BvaW50U2VhcmNoLmNhbGwodGhpcywgdGhpcy5yb290LCB2YWwxLCByZXQpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiB2YWwyID09ICdudW1iZXInKSB7XG4gICAgX3JhbmdlU2VhcmNoLmNhbGwodGhpcywgdmFsMSwgdmFsMiwgcmV0KTtcbiAgfVxuICBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICcsJyArIHZhbDIgKyAnOiBpbnZhbGlkIGlucHV0Jyk7XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cblxuLyoqXG4gKiByZW1vdmU6IFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihpbnRlcnZhbF9pZCkge1xuICB0aHJvdyBcIi5yZW1vdmUoKSBpcyBjdXJyZW50bHkgdW5pbXBsZW1lbnRlZFwiO1xufTtcblxuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIHRoZSBzaGlmdC1yaWdodC1hbmQtZmlsbCBvcGVyYXRvciwgZXh0ZW5kZWQgYmV5b25kIHRoZSByYW5nZSBvZiBhbiBpbnQzMlxuZnVuY3Rpb24gX2JpdFNoaWZ0UmlnaHQobnVtKSB7XG4gIGlmIChudW0gPiAyMTQ3NDgzNjQ3IHx8IG51bSA8IC0yMTQ3NDgzNjQ4KSB7IHJldHVybiBNYXRoLmZsb29yKG51bSAvIDIpOyB9XG4gIHJldHVybiBudW0gPj4+IDE7XG59XG5cbi8qKlxuICogX2luc2VydFxuICoqL1xuZnVuY3Rpb24gX2luc2VydChub2RlLCBpdHZsKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKGl0dmwuZW5kIDwgbm9kZS5pZHgpIHtcbiAgICAgIGlmICghbm9kZS5sZWZ0KSB7XG4gICAgICAgIG5vZGUubGVmdCA9IG5ldyBOb2RlKF9iaXRTaGlmdFJpZ2h0KGl0dmwuc3RhcnQgKyBpdHZsLmVuZCksIHRoaXMpO1xuICAgICAgfVxuICAgICAgbm9kZSA9IG5vZGUubGVmdDtcbiAgICB9IGVsc2UgaWYgKG5vZGUuaWR4IDwgaXR2bC5zdGFydCkge1xuICAgICAgaWYgKCFub2RlLnJpZ2h0KSB7XG4gICAgICAgIG5vZGUucmlnaHQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLnJpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbm9kZS5pbnNlcnQoaXR2bCk7XG4gICAgfVxuICB9XG59XG5cblxuLyoqXG4gKiBfcG9pbnRTZWFyY2hcbiAqIEBwYXJhbSAoTm9kZSkgbm9kZVxuICogQHBhcmFtIChpbnRlZ2VyKSBpZHggXG4gKiBAcGFyYW0gKEFycmF5KSBhcnJcbiAqKi9cbmZ1bmN0aW9uIF9wb2ludFNlYXJjaChub2RlLCBpZHgsIGFycikge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmICghbm9kZSkgYnJlYWs7XG4gICAgaWYgKGlkeCA8IG5vZGUuaWR4KSB7XG4gICAgICBub2RlLnN0YXJ0cy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLnN0YXJ0IDw9IGlkeCk7XG4gICAgICAgIGlmIChib29sKSBhcnIucHVzaChpdHZsLnJlc3VsdCgpKTtcbiAgICAgICAgcmV0dXJuIGJvb2w7XG4gICAgICB9KTtcbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChpZHggPiBub2RlLmlkeCkge1xuICAgICAgbm9kZS5lbmRzLmFyci5ldmVyeShmdW5jdGlvbihpdHZsKSB7XG4gICAgICAgIHZhciBib29sID0gKGl0dmwuZW5kID49IGlkeCk7XG4gICAgICAgIGlmIChib29sKSBhcnIucHVzaChpdHZsLnJlc3VsdCgpKTtcbiAgICAgICAgcmV0dXJuIGJvb2w7XG4gICAgICB9KTtcbiAgICAgIG5vZGUgPSBub2RlLnJpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlLnN0YXJ0cy5hcnIubWFwKGZ1bmN0aW9uKGl0dmwpIHsgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSkgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbn1cblxuXG5cbi8qKlxuICogX3JhbmdlU2VhcmNoXG4gKiBAcGFyYW0gKGludGVnZXIpIHN0YXJ0XG4gKiBAcGFyYW0gKGludGVnZXIpIGVuZFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcmFuZ2VTZWFyY2goc3RhcnQsIGVuZCwgYXJyKSB7XG4gIGlmIChlbmQgLSBzdGFydCA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdlbmQgbXVzdCBiZSBncmVhdGVyIHRoYW4gc3RhcnQuIHN0YXJ0OiAnICsgc3RhcnQgKyAnLCBlbmQ6ICcgKyBlbmQpO1xuICB9XG4gIHZhciByZXN1bHRIYXNoID0ge307XG5cbiAgdmFyIHdob2xlV3JhcHMgPSBbXTtcbiAgX3BvaW50U2VhcmNoLmNhbGwodGhpcywgdGhpcy5yb290LCBfYml0U2hpZnRSaWdodChzdGFydCArIGVuZCksIHdob2xlV3JhcHMsIHRydWUpO1xuXG4gIHdob2xlV3JhcHMuZm9yRWFjaChmdW5jdGlvbihyZXN1bHQpIHtcbiAgICByZXN1bHRIYXNoW3Jlc3VsdC5pZF0gPSB0cnVlO1xuICB9KTtcblxuXG4gIHZhciBpZHgxID0gdGhpcy5wb2ludFRyZWUuYnNlYXJjaChbc3RhcnQsIG51bGxdKTtcbiAgd2hpbGUgKGlkeDEgPj0gMCAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4MV1bMF0gPT0gc3RhcnQpIHtcbiAgICBpZHgxLS07XG4gIH1cblxuICB2YXIgaWR4MiA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW2VuZCwgICBudWxsXSk7XG4gIHZhciBsZW4gPSB0aGlzLnBvaW50VHJlZS5hcnIubGVuZ3RoIC0gMTtcbiAgd2hpbGUgKGlkeDIgPT0gLTEgfHwgKGlkeDIgPD0gbGVuICYmIHRoaXMucG9pbnRUcmVlLmFycltpZHgyXVswXSA8PSBlbmQpKSB7XG4gICAgaWR4MisrO1xuICB9XG5cbiAgdGhpcy5wb2ludFRyZWUuYXJyLnNsaWNlKGlkeDEgKyAxLCBpZHgyKS5mb3JFYWNoKGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIGlkID0gcG9pbnRbMV07XG4gICAgcmVzdWx0SGFzaFtpZF0gPSB0cnVlO1xuICB9LCB0aGlzKTtcblxuICBPYmplY3Qua2V5cyhyZXN1bHRIYXNoKS5mb3JFYWNoKGZ1bmN0aW9uKGlkKSB7XG4gICAgdmFyIGl0dmwgPSB0aGlzLmludGVydmFsSGFzaFtpZF07XG4gICAgYXJyLnB1c2goaXR2bC5yZXN1bHQoc3RhcnQsIGVuZCkpO1xuICB9LCB0aGlzKTtcblxufVxuXG5cblxuLyoqXG4gKiBzdWJjbGFzc2VzXG4gKiBcbiAqKi9cblxuXG4vKipcbiAqIE5vZGUgOiBwcm90b3R5cGUgb2YgZWFjaCBub2RlIGluIGEgaW50ZXJ2YWwgdHJlZVxuICogXG4gKiovXG5mdW5jdGlvbiBOb2RlKGlkeCkge1xuICB0aGlzLmlkeCA9IGlkeDtcbiAgdGhpcy5zdGFydHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLnN0YXJ0IC0gYi5zdGFydDtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuZW5kcyA9IG5ldyBTb3J0ZWRMaXN0KHtcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGEuZW5kIC0gYi5lbmQ7XG4gICAgICByZXR1cm4gKGMgPCAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogaW5zZXJ0IGFuIEludGVydmFsIG9iamVjdCB0byB0aGlzIG5vZGVcbiAqKi9cbk5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGludGVydmFsKSB7XG4gIHRoaXMuc3RhcnRzLmluc2VydChpbnRlcnZhbCk7XG4gIHRoaXMuZW5kcy5pbnNlcnQoaW50ZXJ2YWwpO1xufTtcblxuXG5cbi8qKlxuICogSW50ZXJ2YWwgOiBwcm90b3R5cGUgb2YgaW50ZXJ2YWwgaW5mb1xuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWwoZGF0YSwgaWQsIHMsIGUpIHtcbiAgdGhpcy5pZCAgICAgPSBpZDtcbiAgdGhpcy5zdGFydCAgPSBkYXRhW3NdO1xuICB0aGlzLmVuZCAgICA9IGRhdGFbZV07XG4gIHRoaXMuZGF0YSAgID0gZGF0YTtcblxuICBpZiAodHlwZW9mIHRoaXMuc3RhcnQgIT0gJ251bWJlcicgfHwgdHlwZW9mIHRoaXMuZW5kICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCwgZW5kIG11c3QgYmUgbnVtYmVyLiBzdGFydDogJyArIHRoaXMuc3RhcnQgKyAnLCBlbmQ6ICcgKyB0aGlzLmVuZCk7XG4gIH1cblxuICBpZiAoIHRoaXMuc3RhcnQgPj0gdGhpcy5lbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0IG11c3QgYmUgc21hbGxlciB0aGFuIGVuZC4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG59XG5cbi8qKlxuICogZ2V0IHJlc3VsdCBvYmplY3RcbiAqKi9cbkludGVydmFsLnByb3RvdHlwZS5yZXN1bHQgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSB7XG4gICAgaWQgICA6IHRoaXMuaWQsXG4gICAgZGF0YSA6IHRoaXMuZGF0YVxuICB9O1xuICBpZiAodHlwZW9mIHN0YXJ0ID09ICdudW1iZXInICYmIHR5cGVvZiBlbmQgPT0gJ251bWJlcicpIHtcbiAgICAvKipcbiAgICAgKiBjYWxjIG92ZXJsYXBwaW5nIHJhdGVcbiAgICAgKiovXG4gICAgdmFyIGxlZnQgID0gTWF0aC5tYXgodGhpcy5zdGFydCwgc3RhcnQpO1xuICAgIHZhciByaWdodCA9IE1hdGgubWluKHRoaXMuZW5kLCAgIGVuZCk7XG4gICAgdmFyIGxhcExuID0gcmlnaHQgLSBsZWZ0O1xuICAgIHJldC5yYXRlMSA9IGxhcExuIC8gKGVuZCAtIHN0YXJ0KTtcbiAgICByZXQucmF0ZTIgPSBsYXBMbiAvICh0aGlzLmVuZCAtIHRoaXMuc3RhcnQpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5mdW5jdGlvbiBEdXBsaWNhdGVFcnJvcihtZXNzYWdlKSB7XG4gICAgdGhpcy5uYW1lID0gJ0R1cGxpY2F0ZUVycm9yJztcbiAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgIHRoaXMuc3RhY2sgPSAobmV3IEVycm9yKCkpLnN0YWNrO1xufVxuRHVwbGljYXRlRXJyb3IucHJvdG90eXBlID0gbmV3IEVycm9yO1xuXG5leHBvcnRzLkludGVydmFsVHJlZSA9IEludGVydmFsVHJlZTtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBMaW5lTWFzazogQSAodmVyeSBjaGVhcCkgYWx0ZXJuYXRpdmUgdG8gSW50ZXJ2YWxUcmVlOiBhIHNtYWxsLCAxRCBwaXhlbCBidWZmZXIgb2Ygb2JqZWN0cy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrO1xuXG5mdW5jdGlvbiBMaW5lTWFzayh3aWR0aCwgZnVkZ2UpIHtcbiAgdGhpcy5mdWRnZSA9IGZ1ZGdlID0gKGZ1ZGdlIHx8IDEpO1xuICB0aGlzLml0ZW1zID0gW107XG4gIHRoaXMubGVuZ3RoID0gTWF0aC5jZWlsKHdpZHRoIC8gZnVkZ2UpO1xuICB0aGlzLm1hc2sgPSBnbG9iYWwuVWludDhBcnJheSA/IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKSA6IG5ldyBBcnJheSh0aGlzLmxlbmd0aCk7XG59XG5cbkxpbmVNYXNrLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih4LCB3LCBkYXRhKSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgdGhpcy5pdGVtcy5wdXNoKHt4OiB4LCB3OiB3LCBkYXRhOiBkYXRhfSk7XG4gIGZvciAodmFyIGkgPSBNYXRoLm1heChmbG9vckhhY2soeCAvIHRoaXMuZnVkZ2UpLCAwKTsgaSA8IE1hdGgubWluKHVwVG8sIHRoaXMubGVuZ3RoKTsgaSsrKSB7IHRoaXMubWFza1tpXSA9IDE7IH1cbn07XG5cbkxpbmVNYXNrLnByb3RvdHlwZS5jb25mbGljdCA9IGZ1bmN0aW9uKHgsIHcpIHtcbiAgdmFyIHVwVG8gPSBNYXRoLmNlaWwoKHggKyB3KSAvIHRoaXMuZnVkZ2UpO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyBpZiAodGhpcy5tYXNrW2ldKSByZXR1cm4gdHJ1ZTsgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5leHBvcnRzLkxpbmVNYXNrID0gTGluZU1hc2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4gIFxudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlOyAgXG52YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG52YXIgcGFyc2VJbnQxMCA9IHJlcXVpcmUoJy4vdXRpbHMuanMnKS5wYXJzZUludDEwO1xuXG52YXIgUEFJUklOR19DQU5OT1RfTUFURSA9IDAsXG4gIFBBSVJJTkdfTUFURV9PTkxZID0gMSxcbiAgUEFJUklOR19EUkFXX0FTX01BVEVTID0gMjtcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBXcmFwcyB0d28gb2YgU2hpbiBTdXp1a2kncyBJbnRlcnZhbFRyZWVzIHRvIHN0b3JlIGludGVydmFscyB0aGF0ICptYXkqXG4gKiBiZSBwYWlyZWQuXG4gKlxuICogQHNlZSBJbnRlcnZhbFRyZWUoKVxuICoqL1xuZnVuY3Rpb24gUGFpcmVkSW50ZXJ2YWxUcmVlKGNlbnRlciwgdW5wYWlyZWRPcHRpb25zLCBwYWlyZWRPcHRpb25zKSB7XG4gIHZhciBkZWZhdWx0T3B0aW9ucyA9IHtzdGFydEtleTogMCwgZW5kS2V5OiAxfTtcbiAgXG4gIHRoaXMudW5wYWlyZWQgPSBuZXcgSW50ZXJ2YWxUcmVlKGNlbnRlciwgdW5wYWlyZWRPcHRpb25zKTtcbiAgdGhpcy51bnBhaXJlZE9wdGlvbnMgPSBfLmV4dGVuZCh7fSwgZGVmYXVsdE9wdGlvbnMsIHVucGFpcmVkT3B0aW9ucyk7XG4gIFxuICB0aGlzLnBhaXJlZCA9IG5ldyBJbnRlcnZhbFRyZWUoY2VudGVyLCBwYWlyZWRPcHRpb25zKTtcbiAgdGhpcy5wYWlyZWRPcHRpb25zID0gXy5leHRlbmQoe3BhaXJpbmdLZXk6ICdxbmFtZScsIHBhaXJlZExlbmd0aEtleTogJ3RsZW4nfSwgZGVmYXVsdE9wdGlvbnMsIHBhaXJlZE9wdGlvbnMpO1xuICBpZiAodGhpcy5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5ID09PSB0aGlzLnVucGFpcmVkT3B0aW9ucy5zdGFydEtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnRLZXkgZm9yIHVucGFpcmVkT3B0aW9ucyBhbmQgcGFpcmVkT3B0aW9ucyBtdXN0IGJlIGRpZmZlcmVudCBpbiBhIFBhaXJlZEludGVydmFsVHJlZScpO1xuICB9XG4gIGlmICh0aGlzLnBhaXJlZE9wdGlvbnMuZW5kS2V5ID09PSB0aGlzLnVucGFpcmVkT3B0aW9ucy5lbmRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZEtleSBmb3IgdW5wYWlyZWRPcHRpb25zIGFuZCBwYWlyZWRPcHRpb25zIG11c3QgYmUgZGlmZmVyZW50IGluIGEgUGFpcmVkSW50ZXJ2YWxUcmVlJyk7XG4gIH1cbiAgXG4gIHRoaXMucGFpcmluZ0Rpc2FibGVkID0gZmFsc2U7XG4gIHRoaXMucGFpcmluZ01pbkRpc3RhbmNlID0gdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgPSBudWxsO1xufVxuXG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuXG4vKipcbiAqIERpc2FibGVzIHBhaXJpbmcuIEVmZmVjdGl2ZWx5IG1ha2VzIHRoaXMgZXF1aXZhbGVudCwgZXh0ZXJuYWxseSwgdG8gYW4gSW50ZXJ2YWxUcmVlLlxuICogVGhpcyBpcyB1c2VmdWwgaWYgd2UgZGlzY292ZXIgdGhhdCB0aGlzIGRhdGEgc291cmNlIGRvZXNuJ3QgY29udGFpbiBwYWlyZWQgcmVhZHMuXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmRpc2FibGVQYWlyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucGFpcmluZ0Rpc2FibGVkID0gdHJ1ZTtcbiAgdGhpcy5wYWlyZWQgPSB0aGlzLnVucGFpcmVkO1xufTtcblxuXG4vKipcbiAqIFNldCBhbiBpbnRlcnZhbCB3aXRoaW4gd2hpY2ggcGFpcmVkIG1hdGVzIHdpbGwgYmUgc2F2ZWQgYXMgYSBjb250aW51b3VzIGZlYXR1cmUgaW4gLnBhaXJlZFxuICpcbiAqIEBwYXJhbSAobnVtYmVyKSBtaW46IE1pbmltdW0gZGlzdGFuY2UsIGluIGJwXG4gKiBAcGFyYW0gKG51bWJlcikgbWF4OiBNYXhpbXVtIGRpc3RhbmNlLCBpbiBicFxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZXRQYWlyaW5nSW50ZXJ2YWwgPSBmdW5jdGlvbihtaW4sIG1heCkge1xuICBpZiAodHlwZW9mIG1pbiAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWluIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBtYXggIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1heCBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIGlmICh0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSAhPT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoJ0NhbiBvbmx5IGJlIGNhbGxlZCBvbmNlLiBZb3UgY2FuXFwndCBjaGFuZ2UgdGhlIHBhaXJpbmcgaW50ZXJ2YWwuJyk7IH1cbiAgXG4gIHRoaXMucGFpcmluZ01pbkRpc3RhbmNlID0gbWluO1xuICB0aGlzLnBhaXJpbmdNYXhEaXN0YW5jZSA9IG1heDtcbn07XG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlIG9ubHkgaWYgaXQgaXMgbmV3LCBiYXNlZCBvbiB3aGV0aGVyIHRoZSBpZCB3YXMgYWxyZWFkeSByZWdpc3RlcmVkXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3ID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgdmFyIG1hdGVkID0gZmFsc2UsXG4gICAgaW5jcmVtZW50ID0gMCxcbiAgICB1bnBhaXJlZFN0YXJ0ID0gdGhpcy51bnBhaXJlZE9wdGlvbnMuc3RhcnRLZXksXG4gICAgdW5wYWlyZWRFbmQgPSB0aGlzLnVucGFpcmVkT3B0aW9ucy5lbmRLZXksXG4gICAgcGFpcmVkU3RhcnQgPSB0aGlzLnBhaXJlZE9wdGlvbnMuc3RhcnRLZXksXG4gICAgcGFpcmVkRW5kID0gdGhpcy5wYWlyZWRPcHRpb25zLmVuZEtleSxcbiAgICBwYWlyZWRMZW5ndGggPSBkYXRhW3RoaXMucGFpcmVkT3B0aW9ucy5wYWlyZWRMZW5ndGhLZXldLFxuICAgIHBhaXJpbmdTdGF0ZSA9IFBBSVJJTkdfQ0FOTk9UX01BVEUsXG4gICAgbmV3SWQsIHBvdGVudGlhbE1hdGU7XG4gIFxuICAvLyAudW5wYWlyZWQgY29udGFpbnMgZXZlcnkgYWxpZ25tZW50IGFzIGEgc2VwYXJhdGUgaW50ZXJ2YWwuXG4gIC8vIElmIGl0IGFscmVhZHkgY29udGFpbnMgdGhpcyBpZCwgd2UndmUgc2VlbiB0aGlzIHJlYWQgYmVmb3JlIGFuZCBzaG91bGQgZGlzcmVnYXJkLlxuICBpZiAodGhpcy51bnBhaXJlZC5jb250YWlucyhpZCkpIHsgcmV0dXJuOyB9XG4gIHRoaXMudW5wYWlyZWQuYWRkKGRhdGEsIGlkKTtcbiAgXG4gIC8vIC5wYWlyZWQgY29udGFpbnMgYWxpZ25tZW50cyB0aGF0IG1heSBiZSBtYXRlZCBpbnRvIG9uZSBpbnRlcnZhbCBpZiB0aGV5IGFyZSB3aXRoaW4gdGhlIHBhaXJpbmcgcmFuZ2VcbiAgaWYgKCF0aGlzLnBhaXJpbmdEaXNhYmxlZCAmJiBfZWxpZ2libGVGb3JQYWlyaW5nKHRoaXMsIGRhdGEpKSB7XG4gICAgaWYgKHRoaXMucGFpcmluZ01pbkRpc3RhbmNlID09PSBudWxsKSB7IFxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBhZGQgcGFpcmVkIGRhdGEgYWZ0ZXIgdGhlIHBhaXJpbmcgaW50ZXJ2YWwgaGFzIGJlZW4gc2V0IScpO1xuICAgIH1cbiAgICBcbiAgICAvLyBpbnN0ZWFkIG9mIHN0b3JpbmcgdGhlbSB3aXRoIHRoZSBnaXZlbiBpZCwgdGhlIHBhaXJpbmdLZXkgKGZvciBCQU0sIFFOQU1FKSBpcyB1c2VkIGFzIHRoZSBpZC5cbiAgICAvLyBBcyBpbnRlcnZhbHMgYXJlIGFkZGVkLCB3ZSBjaGVjayBpZiBhIHJlYWQgd2l0aCB0aGUgc2FtZSBwYWlyaW5nS2V5IGFscmVhZHkgZXhpc3RzIGluIHRoZSAucGFpcmVkIEludGVydmFsVHJlZS5cbiAgICBuZXdJZCA9IGRhdGFbdGhpcy5wYWlyZWRPcHRpb25zLnBhaXJpbmdLZXldO1xuICAgIHBvdGVudGlhbE1hdGUgPSB0aGlzLnBhaXJlZC5nZXQobmV3SWQpO1xuICAgIFxuICAgIGlmIChwb3RlbnRpYWxNYXRlICE9PSBudWxsKSB7XG4gICAgICBwb3RlbnRpYWxNYXRlID0gcG90ZW50aWFsTWF0ZS5kYXRhO1xuICAgICAgcGFpcmluZ1N0YXRlID0gX3BhaXJpbmdTdGF0ZSh0aGlzLCBkYXRhLCBwb3RlbnRpYWxNYXRlKTtcbiAgICAgIC8vIEFyZSB0aGUgcmVhZHMgc3VpdGFibGUgZm9yIG1hdGluZz9cbiAgICAgIGlmIChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUyB8fCBwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfTUFURV9PTkxZKSB7XG4gICAgICAgIC8vIElmIHllczogbWF0ZSB0aGUgcmVhZHNcbiAgICAgICAgcG90ZW50aWFsTWF0ZS5tYXRlID0gZGF0YTtcbiAgICAgICAgLy8gSW4gdGhlIG90aGVyIGRpcmVjdGlvbiwgaGFzIHRvIGJlIGEgc2VsZWN0aXZlIHNoYWxsb3cgY29weSB0byBhdm9pZCBjaXJjdWxhciByZWZlcmVuY2VzLlxuICAgICAgICBkYXRhLm1hdGUgPSBfLmV4dGVuZCh7fSwgXy5vbWl0KHBvdGVudGlhbE1hdGUsIGZ1bmN0aW9uKHYsIGspIHsgcmV0dXJuIF8uaXNPYmplY3Qodil9KSk7XG4gICAgICAgIGRhdGEubWF0ZS5mbGFncyA9IF8uY2xvbmUocG90ZW50aWFsTWF0ZS5mbGFncyk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIEFyZSB0aGUgbWF0ZWQgcmVhZHMgd2l0aGluIGRyYXdhYmxlIHJhbmdlPyBJZiBzbywgc2ltcGx5IGZsYWcgdGhhdCB0aGV5IHNob3VsZCBiZSBkcmF3biB0b2dldGhlciwgYW5kIHRoZXkgd2lsbC5cbiAgICAvLyBBbHRlcm5hdGl2ZWx5LCBpZiB0aGUgcG90ZW50aWFsTWF0ZSBleHBlY3RlZCBhIG1hdGUsIHdlIHNob3VsZCBtYXRlIHRoZW0gYW55d2F5LlxuICAgIC8vIFRoZSBvbmx5IHJlYXNvbiB3ZSB3b3VsZG4ndCBnZXQgLmRyYXdBc01hdGVzIGlzIGlmIHRoZSBtYXRlIHdhcyBvbiB0aGUgdGhyZXNob2xkIG9mIHRoZSBpbnNlcnQgc2l6ZSByYW5nZS5cbiAgICBpZiAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVMgfHwgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19NQVRFX09OTFkgJiYgcG90ZW50aWFsTWF0ZS5tYXRlRXhwZWN0ZWQpKSB7XG4gICAgICBkYXRhLmRyYXdBc01hdGVzID0gcG90ZW50aWFsTWF0ZS5kcmF3QXNNYXRlcyA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE90aGVyd2lzZSwgbmVlZCB0byBpbnNlcnQgdGhpcyByZWFkIGludG8gdGhpcy5wYWlyZWQgYXMgYSBzZXBhcmF0ZSByZWFkLlxuICAgICAgLy8gRW5zdXJlIHRoZSBpZCBpcyB1bmlxdWUgZmlyc3QuXG4gICAgICB3aGlsZSAodGhpcy5wYWlyZWQuY29udGFpbnMobmV3SWQpKSB7XG4gICAgICAgIG5ld0lkID0gbmV3SWQucmVwbGFjZSgvXFx0LiovLCAnJykgKyBcIlxcdFwiICsgKCsraW5jcmVtZW50KTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgZGF0YS5tYXRlRXhwZWN0ZWQgPSBfcGFpcmluZ1N0YXRlKHRoaXMsIGRhdGEpID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVM7XG4gICAgICAvLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBwZXJoYXBzIGEgYml0IHRvbyBzcGVjaWZpYyB0byBob3cgVExFTiBmb3IgQkFNIGZpbGVzIHdvcmtzOyBjb3VsZCBnZW5lcmFsaXplIGxhdGVyXG4gICAgICAvLyBXaGVuIGluc2VydGluZyBpbnRvIC5wYWlyZWQsIHRoZSBpbnRlcnZhbCdzIC5zdGFydCBhbmQgLmVuZCBzaG91bGRuJ3QgYmUgYmFzZWQgb24gUE9TIGFuZCB0aGUgQ0lHQVIgc3RyaW5nO1xuICAgICAgLy8gd2UgbXVzdCBhZGp1c3QgdGhlbSBmb3IgVExFTiwgaWYgaXQgaXMgbm9uemVybywgZGVwZW5kaW5nIG9uIGl0cyBzaWduLCBhbmQgc2V0IG5ldyBib3VuZHMgZm9yIHRoZSBpbnRlcnZhbC5cbiAgICAgIGlmIChkYXRhLm1hdGVFeHBlY3RlZCAmJiBwYWlyZWRMZW5ndGggPiAwKSB7XG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XTtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XSArIHBhaXJlZExlbmd0aDtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5tYXRlRXhwZWN0ZWQgJiYgcGFpcmVkTGVuZ3RoIDwgMCkge1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkRW5kXTtcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkRW5kXSArIHBhaXJlZExlbmd0aDtcbiAgICAgIH0gZWxzZSB7IC8vICFkYXRhLm1hdGVFeHBlY3RlZCB8fCBwYWlyZWRMZW5ndGggPT0gMFxuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRTdGFydF07XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRFbmRdO1xuICAgICAgfVxuICAgICAgXG4gICAgICB0aGlzLnBhaXJlZC5hZGQoZGF0YSwgbmV3SWQpO1xuICAgIH1cbiAgfVxuXG59O1xuXG5cbi8qKlxuICogYWxpYXMgLmFkZCgpIHRvIC5hZGRJZk5ldygpXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IFBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXc7XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKG51bWJlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIsIHBhaXJlZCkge1xuICBpZiAocGFpcmVkICYmICF0aGlzLnBhaXJpbmdEaXNhYmxlZCkge1xuICAgIHJldHVybiB0aGlzLnBhaXJlZC5zZWFyY2godmFsMSwgdmFsMik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHRoaXMudW5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xuICB9XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiB1bmltcGxlbWVudGVkIGZvciBub3dcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2hlY2sgaWYgYW4gaXR2bCBpcyBlbGlnaWJsZSBmb3IgcGFpcmluZy4gXG4vLyBGb3Igbm93LCB0aGlzIG1lYW5zIHRoYXQgaWYgYW55IEZMQUcncyAweDEwMCBvciBoaWdoZXIgYXJlIHNldCwgd2UgdG90YWxseSBkaXNjYXJkIHRoaXMgYWxpZ25tZW50IGFuZCBpbnRlcnZhbC5cbi8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIGVudGFuZ2xlZCB3aXRoIGJhbS5qcyBpbnRlcm5hbHM7IHBlcmhhcHMgYWxsb3cgdGhpcyB0byBiZSBnZW5lcmFsaXplZCwgb3ZlcnJpZGRlbixcbi8vICAgICAgICBvciBzZXQgYWxvbmdzaWRlIC5zZXRQYWlyaW5nSW50ZXJ2YWwoKVxuLy9cbi8vIEByZXR1cm4gKGJvb2xlYW4pXG5mdW5jdGlvbiBfZWxpZ2libGVGb3JQYWlyaW5nKHBhaXJlZEl0dmxUcmVlLCBpdHZsKSB7XG4gIHZhciBmbGFncyA9IGl0dmwuZmxhZ3M7XG4gIGlmIChmbGFncy5pc1NlY29uZGFyeUFsaWdubWVudCB8fCBmbGFncy5pc1JlYWRGYWlsaW5nVmVuZG9yUUMgfHwgZmxhZ3MuaXNEdXBsaWNhdGVSZWFkIHx8IGZsYWdzLmlzU3VwcGxlbWVudGFyeUFsaWdubWVudCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gQ2hlY2sgaWYgYW4gaXR2bCBhbmQgaXRzIHBvdGVudGlhbE1hdGUgYXJlIHdpdGhpbiB0aGUgcmlnaHQgZGlzdGFuY2UsIGFuZCBvcmllbnRhdGlvbiwgdG8gYmUgbWF0ZWQuXG4vLyBJZiBwb3RlbnRpYWxNYXRlIGlzbid0IGdpdmVuLCB0YWtlcyBhIGJlc3QgZ3Vlc3MgaWYgYSBtYXRlIGlzIGV4cGVjdGVkLCBnaXZlbiB0aGUgaW5mb3JtYXRpb24gaW4gaXR2bCBhbG9uZS5cbi8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIGVudGFuZ2xlZCB3aXRoIGJhbS5qcyBpbnRlcm5hbHM7IHBlcmhhcHMgYWxsb3cgdGhpcyB0byBiZSBnZW5lcmFsaXplZCwgb3ZlcnJpZGRlbixcbi8vICAgICAgICBvciBzZXQgYWxvbmdzaWRlIC5zZXRQYWlyaW5nSW50ZXJ2YWwoKVxuLy8gXG4vLyBAcmV0dXJuIChudW1iZXIpXG5mdW5jdGlvbiBfcGFpcmluZ1N0YXRlKHBhaXJlZEl0dmxUcmVlLCBpdHZsLCBwb3RlbnRpYWxNYXRlKSB7XG4gIHZhciB0bGVuID0gaXR2bFtwYWlyZWRJdHZsVHJlZS5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgaXR2bExlbmd0aCA9IGl0dmwuZW5kIC0gaXR2bC5zdGFydCxcbiAgICBpdHZsSXNMYXRlciwgaW5mZXJyZWRJbnNlcnRTaXplO1xuXG4gIGlmIChfLmlzVW5kZWZpbmVkKHBvdGVudGlhbE1hdGUpKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBtb3N0IHJlY2VwdGl2ZSBoeXBvdGhldGljYWwgbWF0ZSwgZ2l2ZW4gdGhlIGluZm9ybWF0aW9uIGluIGl0dmwuXG4gICAgcG90ZW50aWFsTWF0ZSA9IHtcbiAgICAgIF9tb2NrZWQ6IHRydWUsXG4gICAgICBmbGFnczoge1xuICAgICAgICBpc1JlYWRQYWlyZWQ6IHRydWUsXG4gICAgICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogdHJ1ZSxcbiAgICAgICAgaXNSZWFkRmlyc3RPZlBhaXI6IGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcixcbiAgICAgICAgaXNSZWFkTGFzdE9mUGFpcjogaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpclxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBGaXJzdCBjaGVjayBhIHdob2xlIGhvc3Qgb2YgRkxBRydzLiBUbyBtYWtlIGEgbG9uZyBzdG9yeSBzaG9ydCwgd2UgZXhwZWN0IHBhaXJlZCBlbmRzIHRvIGJlIGVpdGhlclxuICAvLyA5OS0xNDcgb3IgMTYzLTgzLCBkZXBlbmRpbmcgb24gd2hldGhlciB0aGUgcmlnaHRtb3N0IG9yIGxlZnRtb3N0IHNlZ21lbnQgaXMgcHJpbWFyeS5cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFBhaXJlZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQYWlyZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFByb3Blcmx5QWxpZ25lZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQcm9wZXJseUFsaWduZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkVW5tYXBwZWQgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRVbm1hcHBlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc01hdGVVbm1hcHBlZCB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLmlzTWF0ZVVubWFwcGVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyICYmICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpciAmJiAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRGaXJzdE9mUGFpcikgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIFxuICBpZiAocG90ZW50aWFsTWF0ZS5fbW9ja2VkKSB7XG4gICAgXy5leHRlbmQocG90ZW50aWFsTWF0ZSwge1xuICAgICAgcm5hbWU6IGl0dmwucm5leHQgPT0gJz0nID8gaXR2bC5ybmFtZSA6IGl0dmwucm5leHQsXG4gICAgICBwb3M6IGl0dmwucG5leHQsXG4gICAgICBzdGFydDogaXR2bC5ybmV4dCA9PSAnPScgPyBwYXJzZUludDEwKGl0dmwucG5leHQpICsgKGl0dmwuc3RhcnQgLSBwYXJzZUludDEwKGl0dmwucG9zKSkgOiAwLFxuICAgICAgZW5kOiB0bGVuID4gMCA/IGl0dmwuc3RhcnQgKyB0bGVuIDogKHRsZW4gPCAwID8gaXR2bC5lbmQgKyB0bGVuICsgaXR2bExlbmd0aCA6IDApLFxuICAgICAgcm5leHQ6IGl0dmwucm5leHQgPT0gJz0nID8gJz0nIDogaXR2bC5ybmFtZSxcbiAgICAgIHBuZXh0OiBpdHZsLnBvc1xuICAgIH0pO1xuICB9XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBhbGlnbm1lbnRzIGFyZSBvbiB0aGUgc2FtZSByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgaWYgKGl0dmwucm5leHQgIT0gJz0nIHx8IHBvdGVudGlhbE1hdGUucm5leHQgIT0gJz0nKSB7IFxuICAgIC8vIGFuZCBpZiBub3QsIGRvIHRoZSBjb29yZGluYXRlcyBtYXRjaCBhdCBhbGw/XG4gICAgaWYgKGl0dmwucm5leHQgIT0gcG90ZW50aWFsTWF0ZS5ybmFtZSB8fCBpdHZsLnJuZXh0ICE9IHBvdGVudGlhbE1hdGUucm5hbWUpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICBpZiAoaXR2bC5wbmV4dCAhPSBwb3RlbnRpYWxNYXRlLnBvcyB8fCBpdHZsLnBvcyAhPSBwb3RlbnRpYWxNYXRlLnBuZXh0KSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZO1xuICB9XG4gIFxuICBpZiAocG90ZW50aWFsTWF0ZS5fbW9ja2VkKSB7XG4gICAgXy5leHRlbmQocG90ZW50aWFsTWF0ZS5mbGFncywge1xuICAgICAgcmVhZFN0cmFuZFJldmVyc2U6IGl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UsXG4gICAgICBtYXRlU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZVxuICAgIH0pO1xuICB9IFxuICBcbiAgaXR2bElzTGF0ZXIgPSBpdHZsLnN0YXJ0ID4gcG90ZW50aWFsTWF0ZS5zdGFydDtcbiAgaW5mZXJyZWRJbnNlcnRTaXplID0gTWF0aC5hYnModGxlbik7XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBhbGlnbm1lbnRzIGFyZSAtLT4gPC0tXG4gIGlmIChpdHZsSXNMYXRlcikge1xuICAgIGlmICghaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCBpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICAgIGlmIChwb3RlbnRpYWxNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICB9IGVsc2Uge1xuICAgIGlmIChpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8ICFpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICAgIGlmICghcG90ZW50aWFsTWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICB9XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBpbmZlcnJlZEluc2VydFNpemUgaXMgd2l0aGluIHRoZSBhY2NlcHRhYmxlIHJhbmdlLlxuICBpdHZsLmluc2VydFNpemUgPSBwb3RlbnRpYWxNYXRlLmluc2VydFNpemUgPSBpbmZlcnJlZEluc2VydFNpemU7XG4gIGlmIChpbmZlcnJlZEluc2VydFNpemUgPiB0aGlzLnBhaXJpbmdNYXhEaXN0YW5jZSB8fCBpbmZlcnJlZEluc2VydFNpemUgPCB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgXG4gIHJldHVybiBQQUlSSU5HX0RSQVdfQVNfTUFURVM7XG59XG5cbmV4cG9ydHMuUGFpcmVkSW50ZXJ2YWxUcmVlID0gUGFpcmVkSW50ZXJ2YWxUcmVlO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrXG4gICpcbiAgKiBBIGhlbHBlciBjbGFzcyBidWlsdCBmb3IgY2FjaGluZyBkYXRhIGZldGNoZWQgZnJvbSBhIHJlbW90ZSB0cmFjayAoZGF0YSBhbGlnbmVkIHRvIGEgZ2Vub21lKS5cbiAgKiBUaGUgZ2Vub21lIGlzIGRpdmlkZWQgaW50byBiaW5zIG9mIG9wdGltYWxGZXRjaFdpbmRvdyBudHMsIGZvciBlYWNoIG9mIHdoaWNoIGRhdGEgd2lsbCBvbmx5IGJlIGZldGNoZWQgb25jZS5cbiAgKiBUbyBzZXR1cCB0aGUgYmlucywgY2FsbCAuc2V0dXBCaW5zKC4uLikgYWZ0ZXIgaW5pdGlhbGl6aW5nIHRoZSBjbGFzcy5cbiAgKlxuICAqIFRoZXJlIGlzIG9uZSBtYWluIHB1YmxpYyBtZXRob2QgZm9yIHRoaXMgY2xhc3M6IC5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIGNhbGxiYWNrKVxuICAqIChGb3IgY29uc2lzdGVuY3kgd2l0aCBDdXN0b21UcmFja3MuanMsIGFsbCBgc3RhcnRgIGFuZCBgZW5kYCBwb3NpdGlvbnMgYXJlIDEtYmFzZWQsIG9yaWVudGVkIHRvXG4gICogdGhlIHN0YXJ0IG9mIHRoZSBnZW5vbWUsIGFuZCBpbnRlcnZhbHMgYXJlIHJpZ2h0LW9wZW4uKVxuICAqXG4gICogVGhpcyBtZXRob2Qgd2lsbCByZXF1ZXN0IGFuZCBjYWNoZSBkYXRhIGZvciB0aGUgZ2l2ZW4gaW50ZXJ2YWwgdGhhdCBpcyBub3QgYWxyZWFkeSBjYWNoZWQsIGFuZCBjYWxsIFxuICAqIGNhbGxiYWNrKGludGVydmFscykgYXMgc29vbiBhcyBkYXRhIGZvciBhbGwgaW50ZXJ2YWxzIGlzIGF2YWlsYWJsZS4gKElmIHRoZSBkYXRhIGlzIGFscmVhZHkgYXZhaWxhYmxlLCBcbiAgKiBpdCB3aWxsIGNhbGwgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5LilcbiAgKiovXG5cbnZhciBCSU5fTE9BRElORyA9IDEsXG4gIEJJTl9MT0FERUQgPSAyO1xuXG4vKipcbiAgKiBSZW1vdGVUcmFjayBjb25zdHJ1Y3Rvci5cbiAgKlxuICAqIE5vdGUgeW91IHN0aWxsIG11c3QgY2FsbCBgLnNldHVwQmlucyguLi4pYCBiZWZvcmUgdGhlIFJlbW90ZVRyYWNrIGlzIHJlYWR5IHRvIGZldGNoIGRhdGEuXG4gICpcbiAgKiBAcGFyYW0gKEludGVydmFsVHJlZSkgY2FjaGU6IEFuIGNhY2hlIHN0b3JlIHRoYXQgd2lsbCByZWNlaXZlIGludGVydmFscyBmZXRjaGVkIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNob3VsZCBiZSBhbiBJbnRlcnZhbFRyZWUgb3IgZXF1aXZhbGVudCwgdGhhdCBpbXBsZW1lbnRzIGAuYWRkSWZOZXcoLi4uKWAgYW5kIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYC5zZWFyY2goc3RhcnQsIGVuZClgIG1ldGhvZHMuIElmIGl0IGlzIGFuICpleHRlbnNpb24qIG9mIGFuIEludGVydmFsVHJlZSwgbm90ZSBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBgZXh0cmFBcmdzYCBwYXJhbSBwZXJtaXR0ZWQgZm9yIGAuZmV0Y2hBc3luYygpYCwgd2hpY2ggYXJlIHBhc3NlZCBhbG9uZyBhcyBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4dHJhIGFyZ3VtZW50cyB0byBgLnNlYXJjaCgpYC5cbiAgKiBAcGFyYW0gKGZ1bmN0aW9uKSBmZXRjaGVyOiBBIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgdG8gZmV0Y2ggZGF0YSBmb3IgZWFjaCBiaW4uXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgVGhpcyBmdW5jdGlvbiBzaG91bGQgdGFrZSB0aHJlZSBhcmd1bWVudHMsIGBzdGFydGAsIGBlbmRgLCBhbmQgYHN0b3JlSW50ZXJ2YWxzYC5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgc3RhcnRgIGFuZCBgZW5kYCBhcmUgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdG9yZUludGVydmFsc2AgaXMgYSBjYWxsYmFjayB0aGF0IGBmZXRjaGVyYCBNVVNUIGNhbGwgb24gdGhlIGFycmF5IG9mIGludGVydmFsc1xuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uY2UgdGhleSBoYXZlIGJlZW4gZmV0Y2hlZCBmcm9tIHRoZSByZW1vdGUgZGF0YSBzb3VyY2UgYW5kIHBhcnNlZC5cbiAgKiBAc2VlIF9mZXRjaEJpbiBmb3IgaG93IGBmZXRjaGVyYCBpcyB1dGlsaXplZC5cbiAgKiovXG5mdW5jdGlvbiBSZW1vdGVUcmFjayhjYWNoZSwgZmV0Y2hlcikge1xuICBpZiAodHlwZW9mIGNhY2hlICE9ICdvYmplY3QnIHx8ICghY2FjaGUuYWRkSWZOZXcgJiYgKCFfLmtleXMoY2FjaGUpLmxlbmd0aCB8fCBjYWNoZVtfLmtleXMoY2FjaGUpWzBdXS5hZGRJZk5ldykpKSB7IFxuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBhbiBJbnRlcnZhbFRyZWUgY2FjaGUsIG9yIGFuIG9iamVjdC9hcnJheSBjb250YWluaW5nIEludGVydmFsVHJlZXMsIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IFxuICB9XG4gIGlmICh0eXBlb2YgZmV0Y2hlciAhPSAnZnVuY3Rpb24nKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBhIGZldGNoZXIgZnVuY3Rpb24gYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBcbiAgdGhpcy5jYWNoZSA9IGNhY2hlO1xuICB0aGlzLmZldGNoZXIgPSBmZXRjaGVyO1xuICBcbiAgdGhpcy5jYWxsYmFja3MgPSBbXTtcbiAgdGhpcy5hZnRlckJpblNldHVwID0gW107XG4gIHRoaXMuYmluc0xvYWRlZCA9IG51bGw7XG59XG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuLy8gU2V0dXAgdGhlIGJpbm5pbmcgc2NoZW1lIGZvciB0aGlzIFJlbW90ZVRyYWNrLiBUaGlzIGNhbiBvY2N1ciBhbnl0aW1lIGFmdGVyIGluaXRpYWxpemF0aW9uLCBhbmQgaW4gZmFjdCxcbi8vIGNhbiBvY2N1ciBhZnRlciBjYWxscyB0byBgLmZldGNoQXN5bmMoKWAgaGF2ZSBiZWVuIG1hZGUsIGluIHdoaWNoIGNhc2UgdGhleSB3aWxsIGJlIHdhaXRpbmcgb24gdGhpcyBtZXRob2Rcbi8vIHRvIGJlIGNhbGxlZCB0byBwcm9jZWVkLiBCdXQgaXQgTVVTVCBiZSBjYWxsZWQgYmVmb3JlIGRhdGEgd2lsbCBiZSByZWNlaXZlZCBieSBjYWxsYmFja3MgcGFzc2VkIHRvIFxuLy8gYC5mZXRjaEFzeW5jKClgLlxuUmVtb3RlVHJhY2sucHJvdG90eXBlLnNldHVwQmlucyA9IGZ1bmN0aW9uKGdlbm9tZVNpemUsIG9wdGltYWxGZXRjaFdpbmRvdywgbWF4RmV0Y2hXaW5kb3cpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoc2VsZi5iaW5zTG9hZGVkKSB7IHRocm93IG5ldyBFcnJvcigneW91IGNhbm5vdCBydW4gc2V0dXBCaW5zIG1vcmUgdGhhbiBvbmNlLicpOyB9XG4gIGlmICh0eXBlb2YgZ2Vub21lU2l6ZSAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgdGhlIGdlbm9tZVNpemUgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG9wdGltYWxGZXRjaFdpbmRvdyAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgb3B0aW1hbEZldGNoV2luZG93IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBtYXhGZXRjaFdpbmRvdyAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWF4RmV0Y2hXaW5kb3cgYXMgdGhlIDNyZCBhcmd1bWVudC4nKTsgfVxuICBcbiAgc2VsZi5nZW5vbWVTaXplID0gZ2Vub21lU2l6ZTtcbiAgc2VsZi5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBvcHRpbWFsRmV0Y2hXaW5kb3c7XG4gIHNlbGYubWF4RmV0Y2hXaW5kb3cgPSBtYXhGZXRjaFdpbmRvdztcbiAgXG4gIHNlbGYubnVtQmlucyA9IE1hdGguY2VpbChnZW5vbWVTaXplIC8gb3B0aW1hbEZldGNoV2luZG93KTtcbiAgc2VsZi5iaW5zTG9hZGVkID0ge307XG4gIFxuICAvLyBGaXJlIG9mZiByYW5nZXMgc2F2ZWQgdG8gYWZ0ZXJCaW5TZXR1cFxuICBfLmVhY2godGhpcy5hZnRlckJpblNldHVwLCBmdW5jdGlvbihyYW5nZSkge1xuICAgIHNlbGYuZmV0Y2hBc3luYyhyYW5nZS5zdGFydCwgcmFuZ2UuZW5kLCByYW5nZS5leHRyYUFyZ3MpO1xuICB9KTtcbiAgX2NsZWFyQ2FsbGJhY2tzRm9yVG9vQmlnSW50ZXJ2YWxzKHNlbGYpO1xufVxuXG5cbi8vIEZldGNoZXMgZGF0YSAoaWYgbmVjZXNzYXJ5KSBmb3IgdW5mZXRjaGVkIGJpbnMgb3ZlcmxhcHBpbmcgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gVGhlbiwgcnVuIGBjYWxsYmFja2Agb24gYWxsIHN0b3JlZCBzdWJpbnRlcnZhbHMgdGhhdCBvdmVybGFwIHdpdGggdGhlIGludGVydmFsIGZyb20gYHN0YXJ0YCB0byBgZW5kYC5cbi8vIGBleHRyYUFyZ3NgIGlzIGFuICpvcHRpb25hbCogcGFyYW1ldGVyIHRoYXQgY2FuIGNvbnRhaW4gYXJndW1lbnRzIHBhc3NlZCB0byB0aGUgYC5zZWFyY2goKWAgZnVuY3Rpb24gb2YgdGhlIGNhY2hlLlxuLy9cbi8vIEBwYXJhbSAobnVtYmVyKSBzdGFydDogICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgdG8gc3RhcnQgZmV0Y2hpbmcgZnJvbVxuLy8gQHBhcmFtIChudW1iZXIpIGVuZDogICAgICAgICAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZSAocmlnaHQtb3BlbikgdG8gc3RhcnQgZmV0Y2hpbmcgKnVudGlsKlxuLy8gQHBhcmFtIChBcnJheSkgW2V4dHJhQXJnc106ICBvcHRpb25hbCwgcGFzc2VkIGFsb25nIHRvIHRoZSBgLnNlYXJjaCgpYCBjYWxscyBvbiB0aGUgLmNhY2hlIGFzIGFyZ3VtZW50cyAzIGFuZCB1cDsgXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBlcmhhcHMgdXNlZnVsIGlmIHRoZSAuY2FjaGUgaGFzIG92ZXJyaWRkZW4gdGhpcyBtZXRob2Rcbi8vIEBwYXJhbSAoZnVuY3Rpb24pIGNhbGxiYWNrOiAgQSBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgY2FsbGVkIG9uY2UgZGF0YSBpcyByZWFkeSBmb3IgdGhpcyBpbnRlcnZhbC4gV2lsbCBiZSBwYXNzZWRcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxsIGludGVydmFsIGZlYXR1cmVzIHRoYXQgaGF2ZSBiZWVuIGZldGNoZWQgZm9yIHRoaXMgaW50ZXJ2YWwsIG9yIHt0b29NYW55OiB0cnVlfVxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiBtb3JlIGRhdGEgd2FzIHJlcXVlc3RlZCB0aGFuIGNvdWxkIGJlIHJlYXNvbmFibHkgZmV0Y2hlZC5cblJlbW90ZVRyYWNrLnByb3RvdHlwZS5mZXRjaEFzeW5jID0gZnVuY3Rpb24oc3RhcnQsIGVuZCwgZXh0cmFBcmdzLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChfLmlzRnVuY3Rpb24oZXh0cmFBcmdzKSAmJiBfLmlzVW5kZWZpbmVkKGNhbGxiYWNrKSkgeyBjYWxsYmFjayA9IGV4dHJhQXJnczsgZXh0cmFBcmdzID0gdW5kZWZpbmVkOyB9XG4gIGlmICghc2VsZi5iaW5zTG9hZGVkKSB7XG4gICAgLy8gSWYgYmlucyAqYXJlbid0KiBzZXR1cCB5ZXQ6XG4gICAgLy8gU2F2ZSB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIFNhdmUgdGhpcyBmZXRjaCBmb3Igd2hlbiB0aGUgYmlucyBhcmUgbG9hZGVkXG4gICAgc2VsZi5hZnRlckJpblNldHVwLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgYmlucyAqYXJlKiBzZXR1cCwgZmlyc3QgY2FsY3VsYXRlIHdoaWNoIGJpbnMgY29ycmVzcG9uZCB0byB0aGlzIGludGVydmFsLCBcbiAgICAvLyBhbmQgd2hhdCBzdGF0ZSB0aG9zZSBiaW5zIGFyZSBpblxuICAgIHZhciBiaW5zID0gX2Jpbk92ZXJsYXAoc2VsZiwgc3RhcnQsIGVuZCksXG4gICAgICBsb2FkZWRCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gc2VsZi5iaW5zTG9hZGVkW2ldID09PSBCSU5fTE9BREVEOyB9KSxcbiAgICAgIGJpbnNUb0ZldGNoID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gIXNlbGYuYmluc0xvYWRlZFtpXTsgfSk7XG4gICAgXG4gICAgaWYgKGxvYWRlZEJpbnMubGVuZ3RoID09IGJpbnMubGVuZ3RoKSB7XG4gICAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGxvYWRlZCBkYXRhIGZvciBhbGwgdGhlIGJpbnMgaW4gcXVlc3Rpb24sIHNob3J0LWNpcmN1aXQgYW5kIHJ1biB0aGUgY2FsbGJhY2sgbm93XG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGV4dHJhQXJncykgPyBbXSA6IGV4dHJhQXJncztcbiAgICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKHNlbGYuY2FjaGUuc2VhcmNoLmFwcGx5KHNlbGYuY2FjaGUsIFtzdGFydCwgZW5kXS5jb25jYXQoZXh0cmFBcmdzKSkpO1xuICAgIH0gZWxzZSBpZiAoZW5kIC0gc3RhcnQgPiBzZWxmLm1heEZldGNoV2luZG93KSB7XG4gICAgICAvLyBlbHNlLCBpZiB0aGlzIGludGVydmFsIGlzIHRvbyBiaWcgKD4gbWF4RmV0Y2hXaW5kb3cpLCBmaXJlIHRoZSBjYWxsYmFjayByaWdodCBhd2F5IHdpdGgge3Rvb01hbnk6IHRydWV9XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH1cbiAgICBcbiAgICAvLyBlbHNlLCBwdXNoIHRoZSBjYWxsYmFjayBvbnRvIHRoZSBxdWV1ZVxuICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IFxuICAgICAgc2VsZi5jYWxsYmFja3MucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3MsIGNhbGxiYWNrOiBjYWxsYmFja30pOyBcbiAgICB9XG4gICAgXG4gICAgLy8gdGhlbiBydW4gZmV0Y2hlcyBmb3IgdGhlIHVuZmV0Y2hlZCBiaW5zLCB3aGljaCBzaG91bGQgY2FsbCBfZmlyZUNhbGxiYWNrcyBhZnRlciB0aGV5IGNvbXBsZXRlLFxuICAgIC8vIHdoaWNoIHdpbGwgYXV0b21hdGljYWxseSBmaXJlIGNhbGxiYWNrcyBmcm9tIHRoZSBhYm92ZSBxdWV1ZSBhcyB0aGV5IGFjcXVpcmUgYWxsIG5lZWRlZCBkYXRhLlxuICAgIF8uZWFjaChiaW5zVG9GZXRjaCwgZnVuY3Rpb24oYmluSW5kZXgpIHtcbiAgICAgIF9mZXRjaEJpbihzZWxmLCBiaW5JbmRleCwgZnVuY3Rpb24oKSB7IF9maXJlQ2FsbGJhY2tzKHNlbGYpOyB9KTtcbiAgICB9KTtcbiAgfVxufVxuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIENhbGN1bGF0ZXMgd2hpY2ggYmlucyBvdmVybGFwIHdpdGggYW4gaW50ZXJ2YWwgZ2l2ZW4gYnkgYHN0YXJ0YCBhbmQgYGVuZGAuXG4vLyBgc3RhcnRgIGFuZCBgZW5kYCBhcmUgMS1iYXNlZCBjb29yZGluYXRlcyBmb3JtaW5nIGEgcmlnaHQtb3BlbiBpbnRlcnZhbC5cbmZ1bmN0aW9uIF9iaW5PdmVybGFwKHJlbW90ZVRyaywgc3RhcnQsIGVuZCkge1xuICBpZiAoIXJlbW90ZVRyay5iaW5zTG9hZGVkKSB7IHRocm93IG5ldyBFcnJvcigneW91IGNhbm5vdCBjYWxjdWxhdGUgYmluIG92ZXJsYXAgYmVmb3JlIHNldHVwQmlucyBpcyBjYWxsZWQuJyk7IH1cbiAgLy8gSW50ZXJuYWxseSwgZm9yIGFzc2lnbmluZyBjb29yZGluYXRlcyB0byBiaW5zLCB3ZSB1c2UgMC1iYXNlZCBjb29yZGluYXRlcyBmb3IgZWFzaWVyIGNhbGN1bGF0aW9ucy5cbiAgdmFyIHN0YXJ0QmluID0gTWF0aC5mbG9vcigoc3RhcnQgLSAxKSAvIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cpLFxuICAgIGVuZEJpbiA9IE1hdGguZmxvb3IoKGVuZCAtIDEpIC8gcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyk7XG4gIHJldHVybiBfLnJhbmdlKHN0YXJ0QmluLCBlbmRCaW4gKyAxKTtcbn1cblxuLy8gUnVucyB0aGUgZmV0Y2hlciBmdW5jdGlvbiBvbiBhIGdpdmVuIGJpbi5cbi8vIFRoZSBmZXRjaGVyIGZ1bmN0aW9uIGlzIG9ibGlnYXRlZCB0byBydW4gYSBjYWxsYmFjayBmdW5jdGlvbiBgc3RvcmVJbnRlcnZhbHNgLCBcbi8vICAgIHBhc3NlZCBhcyBpdHMgdGhpcmQgYXJndW1lbnQsIG9uIGEgc2V0IG9mIGludGVydmFscyB0aGF0IHdpbGwgYmUgaW5zZXJ0ZWQgaW50byB0aGUgXG4vLyAgICByZW1vdGVUcmsuY2FjaGUgSW50ZXJ2YWxUcmVlLlxuLy8gVGhlIGBzdG9yZUludGVydmFsc2AgZnVuY3Rpb24gbWF5IGFjY2VwdCBhIHNlY29uZCBhcmd1bWVudCBjYWxsZWQgYGNhY2hlSW5kZXhgLCBpbiBjYXNlXG4vLyAgICByZW1vdGVUcmsuY2FjaGUgaXMgYWN0dWFsbHkgYSBjb250YWluZXIgZm9yIG11bHRpcGxlIEludGVydmFsVHJlZXMsIGluZGljYXRpbmcgd2hpY2ggXG4vLyAgICBvbmUgdG8gc3RvcmUgaXQgaW4uXG4vLyBXZSB0aGVuIGNhbGwgdGhlIGBjYWxsYmFja2AgZ2l2ZW4gaGVyZSBhZnRlciB0aGF0IGlzIGNvbXBsZXRlLlxuZnVuY3Rpb24gX2ZldGNoQmluKHJlbW90ZVRyaywgYmluSW5kZXgsIGNhbGxiYWNrKSB7XG4gIHZhciBzdGFydCA9IGJpbkluZGV4ICogcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyArIDEsXG4gICAgZW5kID0gKGJpbkluZGV4ICsgMSkgKiByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93ICsgMTtcbiAgcmVtb3RlVHJrLmJpbnNMb2FkZWRbYmluSW5kZXhdID0gQklOX0xPQURJTkc7XG4gIHJlbW90ZVRyay5mZXRjaGVyKHN0YXJ0LCBlbmQsIGZ1bmN0aW9uIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscykge1xuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICBpZiAoIWludGVydmFsKSB7IHJldHVybjsgfVxuICAgICAgcmVtb3RlVHJrLmNhY2hlLmFkZElmTmV3KGludGVydmFsLCBpbnRlcnZhbC5pZCk7XG4gICAgfSk7XG4gICAgcmVtb3RlVHJrLmJpbnNMb2FkZWRbYmluSW5kZXhdID0gQklOX0xPQURFRDtcbiAgICBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKCk7XG4gIH0pO1xufVxuXG4vLyBSdW5zIHRocm91Z2ggYWxsIHNhdmVkIGNhbGxiYWNrcyBhbmQgZmlyZXMgYW55IGNhbGxiYWNrcyB3aGVyZSBhbGwgdGhlIHJlcXVpcmVkIGRhdGEgaXMgcmVhZHlcbi8vIENhbGxiYWNrcyB0aGF0IGFyZSBmaXJlZCBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBxdWV1ZS5cbmZ1bmN0aW9uIF9maXJlQ2FsbGJhY2tzKHJlbW90ZVRyaykge1xuICByZW1vdGVUcmsuY2FsbGJhY2tzID0gXy5maWx0ZXIocmVtb3RlVHJrLmNhbGxiYWNrcywgZnVuY3Rpb24oYWZ0ZXJMb2FkKSB7XG4gICAgdmFyIGNhbGxiYWNrID0gYWZ0ZXJMb2FkLmNhbGxiYWNrLFxuICAgICAgZXh0cmFBcmdzID0gXy5pc1VuZGVmaW5lZChhZnRlckxvYWQuZXh0cmFBcmdzKSA/IFtdIDogYWZ0ZXJMb2FkLmV4dHJhQXJncyxcbiAgICAgIGJpbnMsIHN0aWxsTG9hZGluZ0JpbnM7XG4gICAgICAgIFxuICAgIGlmIChhZnRlckxvYWQuZW5kIC0gYWZ0ZXJMb2FkLnN0YXJ0ID4gcmVtb3RlVHJrLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBcbiAgICBiaW5zID0gX2Jpbk92ZXJsYXAocmVtb3RlVHJrLCBhZnRlckxvYWQuc3RhcnQsIGFmdGVyTG9hZC5lbmQpO1xuICAgIHN0aWxsTG9hZGluZ0JpbnMgPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiByZW1vdGVUcmsuYmluc0xvYWRlZFtpXSAhPT0gQklOX0xPQURFRDsgfSkubGVuZ3RoID4gMDtcbiAgICBpZiAoIXN0aWxsTG9hZGluZ0JpbnMpIHtcbiAgICAgIGNhbGxiYWNrKHJlbW90ZVRyay5jYWNoZS5zZWFyY2guYXBwbHkocmVtb3RlVHJrLmNhY2hlLCBbYWZ0ZXJMb2FkLnN0YXJ0LCBhZnRlckxvYWQuZW5kXS5jb25jYXQoZXh0cmFBcmdzKSkpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59XG5cbi8vIFJ1bnMgdGhyb3VnaCBhbGwgc2F2ZWQgY2FsbGJhY2tzIGFuZCBmaXJlcyBhbnkgY2FsbGJhY2tzIGZvciB3aGljaCB3ZSB3b24ndCBsb2FkIGRhdGEgc2luY2UgdGhlIGFtb3VudFxuLy8gcmVxdWVzdGVkIGlzIHRvbyBsYXJnZS4gQ2FsbGJhY2tzIHRoYXQgYXJlIGZpcmVkIGFyZSByZW1vdmVkIGZyb20gdGhlIHF1ZXVlLlxuZnVuY3Rpb24gX2NsZWFyQ2FsbGJhY2tzRm9yVG9vQmlnSW50ZXJ2YWxzKHJlbW90ZVRyaykge1xuICByZW1vdGVUcmsuY2FsbGJhY2tzID0gXy5maWx0ZXIocmVtb3RlVHJrLmNhbGxiYWNrcywgZnVuY3Rpb24oYWZ0ZXJMb2FkKSB7XG4gICAgdmFyIGNhbGxiYWNrID0gYWZ0ZXJMb2FkLmNhbGxiYWNrO1xuICAgIGlmIChhZnRlckxvYWQuZW5kIC0gYWZ0ZXJMb2FkLnN0YXJ0ID4gcmVtb3RlVHJrLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG59XG5cblxuZXhwb3J0cy5SZW1vdGVUcmFjayA9IFJlbW90ZVRyYWNrO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBCeSBTaGluIFN1enVraSwgTUlUIGxpY2Vuc2VcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGlub3V0L1NvcnRlZExpc3RcbiAqXG4gKiBTb3J0ZWRMaXN0IDogY29uc3RydWN0b3JcbiAqIFxuICogQHBhcmFtIGFyciA6IEFycmF5IG9yIG51bGwgOiBhbiBhcnJheSB0byBzZXRcbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyA6IG9iamVjdCAgb3IgbnVsbFxuICogICAgICAgICAoZnVuY3Rpb24pIGZpbHRlciAgOiBmaWx0ZXIgZnVuY3Rpb24gY2FsbGVkIGJlZm9yZSBpbnNlcnRpbmcgZGF0YS5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgVGhpcyByZWNlaXZlcyBhIHZhbHVlIGFuZCByZXR1cm5zIHRydWUgaWYgdGhlIHZhbHVlIGlzIHZhbGlkLlxuICpcbiAqICAgICAgICAgKGZ1bmN0aW9uKSBjb21wYXJlIDogZnVuY3Rpb24gdG8gY29tcGFyZSB0d28gdmFsdWVzLCBcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2hpY2ggaXMgdXNlZCBmb3Igc29ydGluZyBvcmRlci5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIHNhbWUgc2lnbmF0dXJlIGFzIEFycmF5LnByb3RvdHlwZS5zb3J0KGZuKS5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gKiAgICAgICAgIChzdHJpbmcpICAgY29tcGFyZSA6IGlmIHlvdSdkIGxpa2UgdG8gc2V0IGEgY29tbW9uIGNvbXBhcmlzb24gZnVuY3Rpb24sXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHlvdSBjYW4gc3BlY2lmeSBpdCBieSBzdHJpbmc6XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwibnVtYmVyXCIgOiBjb21wYXJlcyBudW1iZXJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJzdHJpbmdcIiA6IGNvbXBhcmVzIHN0cmluZ1xuICovXG5mdW5jdGlvbiBTb3J0ZWRMaXN0KCkge1xuICB2YXIgYXJyICAgICA9IG51bGwsXG4gICAgICBvcHRpb25zID0ge30sXG4gICAgICBhcmdzICAgID0gYXJndW1lbnRzO1xuXG4gIFtcIjBcIixcIjFcIl0uZm9yRWFjaChmdW5jdGlvbihuKSB7XG4gICAgdmFyIHZhbCA9IGFyZ3Nbbl07XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgICAgYXJyID0gdmFsO1xuICAgIH1cbiAgICBlbHNlIGlmICh2YWwgJiYgdHlwZW9mIHZhbCA9PSBcIm9iamVjdFwiKSB7XG4gICAgICBvcHRpb25zID0gdmFsO1xuICAgIH1cbiAgfSk7XG4gIHRoaXMuYXJyID0gW107XG5cbiAgW1wiZmlsdGVyXCIsIFwiY29tcGFyZVwiXS5mb3JFYWNoKGZ1bmN0aW9uKGspIHtcbiAgICBpZiAodHlwZW9mIG9wdGlvbnNba10gPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aGlzW2tdID0gb3B0aW9uc1trXTtcbiAgICB9XG4gICAgZWxzZSBpZiAob3B0aW9uc1trXSAmJiBTb3J0ZWRMaXN0W2tdW29wdGlvbnNba11dKSB7XG4gICAgICB0aGlzW2tdID0gU29ydGVkTGlzdFtrXVtvcHRpb25zW2tdXTtcbiAgICB9XG4gIH0sIHRoaXMpO1xuICBpZiAoYXJyKSB0aGlzLm1hc3NJbnNlcnQoYXJyKTtcbn07XG5cbi8vIEJpbmFyeSBzZWFyY2ggZm9yIHRoZSBpbmRleCBvZiB0aGUgaXRlbSBlcXVhbCB0byBgdmFsYCwgb3IgaWYgbm8gc3VjaCBpdGVtIGV4aXN0cywgdGhlIG5leHQgbG93ZXIgaXRlbVxuLy8gVGhpcyBjYW4gYmUgLTEgaWYgYHZhbGAgaXMgbG93ZXIgdGhhbiB0aGUgbG93ZXN0IGl0ZW0gaW4gdGhlIFNvcnRlZExpc3RcblNvcnRlZExpc3QucHJvdG90eXBlLmJzZWFyY2ggPSBmdW5jdGlvbih2YWwpIHtcbiAgdmFyIG1wb3MsXG4gICAgICBzcG9zID0gMCxcbiAgICAgIGVwb3MgPSB0aGlzLmFyci5sZW5ndGg7XG4gIHdoaWxlIChlcG9zIC0gc3BvcyA+IDEpIHtcbiAgICBtcG9zID0gTWF0aC5mbG9vcigoc3BvcyArIGVwb3MpLzIpO1xuICAgIG12YWwgPSB0aGlzLmFyclttcG9zXTtcbiAgICBzd2l0Y2ggKHRoaXMuY29tcGFyZSh2YWwsIG12YWwpKSB7XG4gICAgY2FzZSAxICA6XG4gICAgZGVmYXVsdCA6XG4gICAgICBzcG9zID0gbXBvcztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgLTEgOlxuICAgICAgZXBvcyA9IG1wb3M7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDAgIDpcbiAgICAgIHJldHVybiBtcG9zO1xuICAgIH1cbiAgfVxuICByZXR1cm4gKHRoaXMuYXJyWzBdID09IG51bGwgfHwgc3BvcyA9PSAwICYmIHRoaXMuYXJyWzBdICE9IG51bGwgJiYgdGhpcy5jb21wYXJlKHRoaXMuYXJyWzBdLCB2YWwpID09IDEpID8gLTEgOiBzcG9zO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHJldHVybiB0aGlzLmFycltwb3NdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUudG9BcnJheSA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gdGhpcy5hcnIuc2xpY2UoKTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyci5zbGljZS5hcHBseSh0aGlzLmFyciwgYXJndW1lbnRzKTtcbn1cblxuU29ydGVkTGlzdC5wcm90b3R5cGUuc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnIubGVuZ3RoO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuaGVhZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnJbMF07XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS50YWlsID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAodGhpcy5hcnIubGVuZ3RoID09IDApID8gbnVsbCA6IHRoaXMuYXJyW3RoaXMuYXJyLmxlbmd0aCAtMV07XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5tYXNzSW5zZXJ0ID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgLy8gVGhpcyBsb29wIGF2b2lkcyBjYWxsIHN0YWNrIG92ZXJmbG93IGJlY2F1c2Ugb2YgdG9vIG1hbnkgYXJndW1lbnRzXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpICs9IDQwOTYpIHtcbiAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseSh0aGlzLmFyciwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoaXRlbXMsIGksIGkgKyA0MDk2KSk7XG4gIH1cbiAgdGhpcy5hcnIuc29ydCh0aGlzLmNvbXBhcmUpO1xufVxuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxMDApIHtcbiAgICAvLyAuYnNlYXJjaCArIC5zcGxpY2UgaXMgdG9vIGV4cGVuc2l2ZSB0byByZXBlYXQgZm9yIHNvIG1hbnkgZWxlbWVudHMuXG4gICAgLy8gTGV0J3MganVzdCBhcHBlbmQgdGhlbSBhbGwgdG8gdGhpcy5hcnIgYW5kIHJlc29ydC5cbiAgICB0aGlzLm1hc3NJbnNlcnQoYXJndW1lbnRzKTtcbiAgfSBlbHNlIHtcbiAgICBBcnJheS5wcm90b3R5cGUuZm9yRWFjaC5jYWxsKGFyZ3VtZW50cywgZnVuY3Rpb24odmFsKSB7XG4gICAgICB2YXIgcG9zID0gdGhpcy5ic2VhcmNoKHZhbCk7XG4gICAgICBpZiAodGhpcy5maWx0ZXIodmFsLCBwb3MpKSB7XG4gICAgICAgIHRoaXMuYXJyLnNwbGljZShwb3MrMSwgMCwgdmFsKTtcbiAgICAgIH1cbiAgICB9LCB0aGlzKTtcbiAgfVxufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuZmlsdGVyID0gZnVuY3Rpb24odmFsLCBwb3MpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5hZGQgPSBTb3J0ZWRMaXN0LnByb3RvdHlwZS5pbnNlcnQ7XG5cblNvcnRlZExpc3QucHJvdG90eXBlW1wiZGVsZXRlXCJdID0gZnVuY3Rpb24ocG9zKSB7XG4gIHRoaXMuYXJyLnNwbGljZShwb3MsIDEpO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gU29ydGVkTGlzdC5wcm90b3R5cGVbXCJkZWxldGVcIl07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLm1hc3NSZW1vdmUgPSBmdW5jdGlvbihzdGFydFBvcywgY291bnQpIHtcbiAgdGhpcy5hcnIuc3BsaWNlKHN0YXJ0UG9zLCBjb3VudCk7XG59O1xuXG4vKipcbiAqIGRlZmF1bHQgY29tcGFyZSBmdW5jdGlvbnMgXG4gKiovXG5Tb3J0ZWRMaXN0LmNvbXBhcmUgPSB7XG4gIFwibnVtYmVyXCI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICB2YXIgYyA9IGEgLSBiO1xuICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgfSxcblxuICBcInN0cmluZ1wiOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgcmV0dXJuIChhID4gYikgPyAxIDogKGEgPT0gYikgID8gMCA6IC0xO1xuICB9XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5jb21wYXJlID0gU29ydGVkTGlzdC5jb21wYXJlW1wibnVtYmVyXCJdO1xuXG5leHBvcnRzLlNvcnRlZExpc3QgPSBTb3J0ZWRMaXN0O1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwidmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG4vLyBQYXJzZSBhIHRyYWNrIGRlY2xhcmF0aW9uIGxpbmUsIHdoaWNoIGlzIGluIHRoZSBmb3JtYXQgb2Y6XG4vLyB0cmFjayBuYW1lPVwiYmxhaFwiIG9wdG5hbWUxPVwidmFsdWUxXCIgb3B0bmFtZTI9XCJ2YWx1ZTJcIiAuLi5cbi8vIGludG8gYSBoYXNoIG9mIG9wdGlvbnNcbm1vZHVsZS5leHBvcnRzLnBhcnNlRGVjbGFyYXRpb25MaW5lID0gZnVuY3Rpb24obGluZSwgc3RhcnQpIHtcbiAgdmFyIG9wdHMgPSB7fSwgb3B0bmFtZSA9ICcnLCB2YWx1ZSA9ICcnLCBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgZnVuY3Rpb24gcHVzaFZhbHVlKHF1b3RpbmcpIHtcbiAgICBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgICBvcHRzW29wdG5hbWUucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXSA9IHZhbHVlO1xuICAgIG9wdG5hbWUgPSB2YWx1ZSA9ICcnO1xuICB9XG4gIGZvciAoaSA9IGxpbmUubWF0Y2goc3RhcnQpWzBdLmxlbmd0aDsgaSA8IGxpbmUubGVuZ3RoOyBpKyspIHtcbiAgICBjID0gbGluZVtpXTtcbiAgICBpZiAoc3RhdGUgPT0gJ29wdG5hbWUnKSB7XG4gICAgICBpZiAoYyA9PSAnPScpIHsgc3RhdGUgPSAnc3RhcnR2YWx1ZSc7IH1cbiAgICAgIGVsc2UgeyBvcHRuYW1lICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICdzdGFydHZhbHVlJykge1xuICAgICAgaWYgKC8nfFwiLy50ZXN0KGMpKSB7IHN0YXRlID0gYzsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IHN0YXRlID0gJ3ZhbHVlJzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykge1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykpIHsgcHVzaFZhbHVlKCk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmICgvJ3xcIi8udGVzdChzdGF0ZSkpIHtcbiAgICAgIGlmIChjID09IHN0YXRlKSB7IHB1c2hWYWx1ZShzdGF0ZSk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfVxuICB9XG4gIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7IHB1c2hWYWx1ZSgpOyB9XG4gIGlmIChzdGF0ZSAhPSAnb3B0bmFtZScpIHsgcmV0dXJuIGZhbHNlOyB9XG4gIHJldHVybiBvcHRzO1xufVxuXG4vLyBDb25zdHJ1Y3RzIGEgbWFwcGluZyBmdW5jdGlvbiB0aGF0IGNvbnZlcnRzIGJwIGludGVydmFscyBpbnRvIHBpeGVsIGludGVydmFscywgd2l0aCBvcHRpb25hbCBjYWxjdWxhdGlvbnMgZm9yIHRleHQgdG9vXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbENhbGN1bGF0b3IgPSBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHAsIHdpdGhUZXh0LCBuYW1lRnVuYywgc3RhcnRrZXksIGVuZGtleSkge1xuICBpZiAoIV8uaXNGdW5jdGlvbihuYW1lRnVuYykpIHsgbmFtZUZ1bmMgPSBmdW5jdGlvbihkKSB7IHJldHVybiBkLm5hbWUgfHwgJyc7IH07IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoc3RhcnRrZXkpKSB7IHN0YXJ0a2V5ID0gJ3N0YXJ0JzsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChlbmRrZXkpKSB7IGVuZGtleSA9ICdlbmQnOyB9XG4gIHJldHVybiBmdW5jdGlvbihkKSB7XG4gICAgdmFyIGl0dmxTdGFydCA9IF8uaXNVbmRlZmluZWQoZFtzdGFydGtleV0pID8gZC5zdGFydCA6IGRbc3RhcnRrZXldLFxuICAgICAgaXR2bEVuZCA9IF8uaXNVbmRlZmluZWQoZFtlbmRrZXldKSA/IGQuZW5kIDogZFtlbmRrZXldO1xuICAgIHZhciBwSW50ID0ge1xuICAgICAgeDogTWF0aC5yb3VuZCgoaXR2bFN0YXJ0IC0gc3RhcnQpIC8gYnBwcCksXG4gICAgICB3OiBNYXRoLnJvdW5kKChpdHZsRW5kIC0gaXR2bFN0YXJ0KSAvIGJwcHApICsgMSxcbiAgICAgIHQ6IDAsICAgICAgICAgIC8vIGNhbGN1bGF0ZWQgd2lkdGggb2YgdGV4dFxuICAgICAgb1ByZXY6IGZhbHNlLCAgLy8gb3ZlcmZsb3dzIGludG8gcHJldmlvdXMgdGlsZT9cbiAgICAgIG9OZXh0OiBmYWxzZSAgIC8vIG92ZXJmbG93cyBpbnRvIG5leHQgdGlsZT9cbiAgICB9O1xuICAgIHBJbnQudHggPSBwSW50Lng7XG4gICAgcEludC50dyA9IHBJbnQudztcbiAgICBpZiAocEludC54IDwgMCkgeyBwSW50LncgKz0gcEludC54OyBwSW50LnggPSAwOyBwSW50Lm9QcmV2ID0gdHJ1ZTsgfVxuICAgIGVsc2UgaWYgKHdpdGhUZXh0KSB7XG4gICAgICBwSW50LnQgPSBfLmlzTnVtYmVyKHdpdGhUZXh0KSA/IHdpdGhUZXh0IDogTWF0aC5taW4obmFtZUZ1bmMoZCkubGVuZ3RoICogMTAgKyAyLCBwSW50LngpO1xuICAgICAgcEludC50eCAtPSBwSW50LnQ7XG4gICAgICBwSW50LnR3ICs9IHBJbnQudDsgIFxuICAgIH1cbiAgICBpZiAocEludC54ICsgcEludC53ID4gd2lkdGgpIHsgcEludC53ID0gd2lkdGggLSBwSW50Lng7IHBJbnQub05leHQgPSB0cnVlOyB9XG4gICAgcmV0dXJuIHBJbnQ7XG4gIH07XG59O1xuXG4vLyBGb3IgdHdvIGdpdmVuIG9iamVjdHMgb2YgdGhlIGZvcm0ge3g6IDEsIHc6IDJ9IChwaXhlbCBpbnRlcnZhbHMpLCBkZXNjcmliZSB0aGUgb3ZlcmxhcC5cbi8vIFJldHVybnMgbnVsbCBpZiB0aGVyZSBpcyBubyBvdmVybGFwLlxubW9kdWxlLmV4cG9ydHMucGl4SW50ZXJ2YWxPdmVybGFwID0gZnVuY3Rpb24ocEludDEsIHBJbnQyKSB7XG4gIHZhciBvdmVybGFwID0ge30sXG4gICAgdG1wO1xuICBpZiAocEludDEueCA+IHBJbnQyLngpIHsgdG1wID0gcEludDI7IHBJbnQyID0gcEludDE7IHBJbnQxID0gdG1wOyB9ICAgICAgIC8vIHN3YXAgc28gdGhhdCBwSW50MSBpcyBhbHdheXMgbG93ZXJcbiAgaWYgKCFwSW50MS53IHx8ICFwSW50Mi53IHx8IHBJbnQxLnggKyBwSW50MS53IDwgcEludDIueCkgeyByZXR1cm4gbnVsbDsgfSAvLyBkZXRlY3Qgbm8tb3ZlcmxhcCBjb25kaXRpb25zXG4gIG92ZXJsYXAueCA9IHBJbnQyLng7XG4gIG92ZXJsYXAudyA9IE1hdGgubWluKHBJbnQxLncgLSBwSW50Mi54ICsgcEludDEueCwgcEludDIudyk7XG4gIHJldHVybiBvdmVybGFwO1xufTtcblxuLy8gQ29tbW9uIGZ1bmN0aW9ucyBmb3Igc3VtbWFyaXppbmcgZGF0YSBpbiBiaW5zIHdoaWxlIHBsb3R0aW5nIHdpZ2dsZSB0cmFja3Ncbm1vZHVsZS5leHBvcnRzLndpZ0JpbkZ1bmN0aW9ucyA9IHtcbiAgbWluaW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5taW4uYXBwbHkoTWF0aCwgYmluKSA6IDA7IH0sXG4gIG1lYW46IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gXy5yZWR1Y2UoYmluLCBmdW5jdGlvbihhLGIpIHsgcmV0dXJuIGEgKyBiOyB9LCAwKSAvIGJpbi5sZW5ndGg7IH0sXG4gIG1heGltdW06IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gYmluLmxlbmd0aCA/IE1hdGgubWF4LmFwcGx5KE1hdGgsIGJpbikgOiAwOyB9XG59O1xuXG4vLyBGYXN0ZXIgdGhhbiBNYXRoLmZsb29yIChodHRwOi8vd2ViZG9vZC5jb20vP3A9MjE5KVxubW9kdWxlLmV4cG9ydHMuZmxvb3JIYWNrID0gZnVuY3Rpb24obnVtKSB7IHJldHVybiAobnVtIDw8IDApIC0gKG51bSA8IDAgPyAxIDogMCk7IH1cblxuLy8gT3RoZXIgdGlueSBmdW5jdGlvbnMgdGhhdCB3ZSBuZWVkIGZvciBvZGRzIGFuZCBlbmRzLi4uXG5tb2R1bGUuZXhwb3J0cy5zdHJpcCA9IGZ1bmN0aW9uKHN0cikgeyByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKTsgfVxubW9kdWxlLmV4cG9ydHMucGFyc2VJbnQxMCA9IGZ1bmN0aW9uKHZhbCkgeyByZXR1cm4gcGFyc2VJbnQodmFsLCAxMCk7IH1cbm1vZHVsZS5leHBvcnRzLmRlZXBDbG9uZSA9IGZ1bmN0aW9uKG9iaikgeyByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvYmopKTsgfSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IHZjZlRhYml4IGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvdmNmLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMudmNmdGFiaXhcbnZhciBWY2ZUYWJpeEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAxMDAwMDAsXG4gICAgY2hyb21vc29tZXM6ICcnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciB2Y2ZUYWJpeCB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIC8vIFRPRE86IFNldCBtYXhGZXRjaFdpbmRvdyB1c2luZyBzb21lIGhldXJpc3RpYyBiYXNlZCBvbiBob3cgbWFueSBpdGVtcyBhcmUgaW4gdGhlIHRhYml4IGluZGV4XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVUb0ludGVydmFsKGxpbmUpIHtcbiAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KCdcXHQnKSwgZGF0YSA9IHt9LCBpbmZvID0ge307XG4gICAgICBpZiAoZmllbGRzWzddKSB7XG4gICAgICAgIF8uZWFjaChmaWVsZHNbN10uc3BsaXQoJzsnKSwgZnVuY3Rpb24obCkgeyBsID0gbC5zcGxpdCgnPScpOyBpZiAobC5sZW5ndGggPiAxKSB7IGluZm9bbFswXV0gPSBsWzFdOyB9IH0pO1xuICAgICAgfVxuICAgICAgZGF0YS5zdGFydCA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW2ZpZWxkc1swXV0gKyBwYXJzZUludDEwKGZpZWxkc1sxXSk7XG4gICAgICBkYXRhLmlkID0gZmllbGRzWzJdPT0nLicgPyAndmNmLScgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDAwMDAwMDApIDogZmllbGRzWzJdO1xuICAgICAgZGF0YS5lbmQgPSBkYXRhLnN0YXJ0ICsgMTtcbiAgICAgIGRhdGEucmVmID0gZmllbGRzWzNdO1xuICAgICAgZGF0YS5hbHQgPSBmaWVsZHNbNF07XG4gICAgICBkYXRhLnF1YWwgPSBwYXJzZUZsb2F0KGZpZWxkc1s1XSk7XG4gICAgICBkYXRhLmluZm8gPSBpbmZvO1xuICAgICAgcmV0dXJuIHtkYXRhOiBkYXRhfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbmFtZUZ1bmMoZmllbGRzKSB7XG4gICAgICB2YXIgcmVmID0gZmllbGRzLnJlZiB8fCAnJyxcbiAgICAgICAgYWx0ID0gZmllbGRzLmFsdCB8fCAnJztcbiAgICAgIHJldHVybiAocmVmLmxlbmd0aCA+IGFsdC5sZW5ndGggPyByZWYgOiBhbHQpIHx8ICcnO1xuICAgIH1cbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSxcbiAgICAgICAgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPiA4OyB9KSxcbiAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJywgbmFtZUZ1bmMpO1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICBkcmF3U3BlYy5wdXNoKGNhbGNQaXhJbnRlcnZhbChsaW5lVG9JbnRlcnZhbChsaW5lKS5kYXRhKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZHJhd1NwZWMgPSB7bGF5b3V0OiBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQoXy5tYXAobGluZXMsIGxpbmVUb0ludGVydmFsKSwgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCl9O1xuICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbXVjaCBkYXRhLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICAvLyBUT0RPOiBjYWNoZSByZXN1bHRzIHNvIHdlIGFyZW4ndCByZWZldGNoaW5nIHRoZSBzYW1lIHJlZ2lvbnMgb3ZlciBhbmQgb3ZlciBhZ2Fpbi5cbiAgICBpZiAoKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgJC5hamF4KHRoaXMuYWpheERpcigpICsgJ3RhYml4LnBocCcsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiB0aGlzLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHRoaXMub3B0cy51cmwgPyB0aGlzLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrdGhpcy5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAyNyA6IDYsXG4gICAgICBjb2xvcnMgPSB7YTonMjU1LDAsMCcsIHQ6JzI1NSwwLDI1NScsIGM6JzAsMCwyNTUnLCBnOicwLDI1NSwwJ30sXG4gICAgICBkcmF3TGltaXQgPSB0aGlzLm9wdHMuZHJhd0xpbWl0ICYmIHRoaXMub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snKSB7IGFyZWFzID0gdGhpcy5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgdGhpcy5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgIH0gZWxzZSBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBhbHRDb2xvciwgcmVmQ29sb3I7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgcmVmQ29sb3IgPSBjb2xvcnNbZGF0YS5kLnJlZi50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGFsdENvbG9yID0gY29sb3JzW2RhdGEuZC5hbHQudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIgKyBhbHRDb2xvciArIFwiKVwiOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIDEpO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIGFyZWFzLnB1c2goW1xuICAgICAgICAgICAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvL3gxLCB4MiwgeTEsIHkyXG4gICAgICAgICAgICAgICAgZGF0YS5kLnJlZiArICcgPiAnICsgZGF0YS5kLmFsdCwgLy8gdGl0bGVcbiAgICAgICAgICAgICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIGRhdGEuZC5pZCksIC8vIGhyZWZcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQub1ByZXYsIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICAgICAgICAgICAgYWx0Q29sb3IsIC8vIGxhYmVsIGNvbG9yXG4gICAgICAgICAgICAgICAgJzxzcGFuIHN0eWxlPVwiY29sb3I6IHJnYignICsgcmVmQ29sb3IgKyAnKVwiPicgKyBkYXRhLmQucmVmICsgJzwvc3Bhbj48YnIvPicgKyBkYXRhLmQuYWx0LCAvLyBsYWJlbFxuICAgICAgICAgICAgICAgIGRhdGEuZC5pbmZvXG4gICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBWY2ZUYWJpeEZvcm1hdDtcblxuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IFdJRyBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3dpZ2dsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL3V0aWxzL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0O1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy53aWdnbGVfMFxudmFyIFdpZ2dsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHV0aWxzLndpZ0JpbkZ1bmN0aW9ucyxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIF9iaW5GdW5jdGlvbnMgPSB0aGlzLnR5cGUoKS5fYmluRnVuY3Rpb25zO1xuICAgIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpKSB7IG8uYWx0Q29sb3IgPSAnJzsgfVxuICAgIG8udmlld0xpbWl0cyA9IF8ubWFwKG8udmlld0xpbWl0cy5zcGxpdCgnOicpLCBwYXJzZUZsb2F0KTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IF8ubWFwKG8ubWF4SGVpZ2h0UGl4ZWxzLnNwbGl0KCc6JyksIHBhcnNlSW50MTApO1xuICAgIG8ueUxpbmVPbk9mZiA9IHRoaXMuaXNPbihvLnlMaW5lT25PZmYpO1xuICAgIG8ueUxpbmVNYXJrID0gcGFyc2VGbG9hdChvLnlMaW5lTWFyayk7XG4gICAgby5hdXRvU2NhbGUgPSB0aGlzLmlzT24oby5hdXRvU2NhbGUpO1xuICAgIGlmIChfYmluRnVuY3Rpb25zICYmICFfYmluRnVuY3Rpb25zW28ud2luZG93aW5nRnVuY3Rpb25dKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHdpbmRvd2luZ0Z1bmN0aW9uIGF0IGxpbmUgXCIgKyBvLmxpbmVOdW0pOyBcbiAgICB9XG4gICAgaWYgKF8uaXNOYU4oby55TGluZU1hcmspKSB7IG8ueUxpbmVNYXJrID0gMC4wOyB9XG4gIH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgc2VsZi5kcmF3UmFuZ2UgPSBvLmF1dG9TY2FsZSB8fCBvLnZpZXdMaW1pdHMubGVuZ3RoIDwgMiA/IHNlbGYucmFuZ2UgOiBvLnZpZXdMaW1pdHM7XG4gICAgXy5lYWNoKHttYXg6IDAsIG1pbjogMiwgc3RhcnQ6IDF9LCBmdW5jdGlvbih2LCBrKSB7IHNlbGYuaGVpZ2h0c1trXSA9IG8ubWF4SGVpZ2h0UGl4ZWxzW3ZdOyB9KTtcbiAgICBpZiAoIW8uYWx0Q29sb3IpIHtcbiAgICAgIHZhciBoc2wgPSB0aGlzLnJnYlRvSHNsLmFwcGx5KHRoaXMsIG8uY29sb3Iuc3BsaXQoLyxcXHMqL2cpKTtcbiAgICAgIGhzbFswXSA9IGhzbFswXSArIDAuMDIgJSAxO1xuICAgICAgaHNsWzFdID0gaHNsWzFdICogMC43O1xuICAgICAgaHNsWzJdID0gMSAtICgxIC0gaHNsWzJdKSAqIDAuNztcbiAgICAgIHNlbGYuYWx0Q29sb3IgPSBfLm1hcCh0aGlzLmhzbFRvUmdiLmFwcGx5KHRoaXMsIGhzbCksIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIHZhbCwgc3RhcnQ7XG4gICAgICBcbiAgICAgIG0gPSBsaW5lLm1hdGNoKC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgaWYgKG0pIHtcbiAgICAgICAgbW9kZSA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbW9kZU9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgICAgbW9kZU9wdHMuc3RhcnQgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0YXJ0KTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGFydCkgfHwgIW1vZGVPcHRzLnN0YXJ0KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0YXJ0IHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3RlcCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RlcCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RlcCkgfHwgIW1vZGVPcHRzLnN0ZXApKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RlcCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnNwYW4gPSBwYXJzZUludDEwKG1vZGVPcHRzLnNwYW4pIHx8IDE7XG4gICAgICAgIGNoclBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW21vZGVPcHRzLmNocm9tXTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIW1vZGUpIHsgXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV2lnZ2xlIGZvcm1hdCBhdCBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgaGFzIG5vIHByZWNlZGluZyBtb2RlIGRlY2xhcmF0aW9uXCIpOyBcbiAgICAgICAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICAvLyBpbnZhbGlkIGNocm9tb3NvbWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnKSB7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmUpO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0LCBlbmQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICAgIG1vZGVPcHRzLnN0YXJ0ICs9IG1vZGVPcHRzLnN0ZXA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmUgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgICAgICBpZiAobGluZS5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlhYmxlU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlcyB0d28gdmFsdWVzIHBlciBsaW5lXCIpOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChsaW5lWzBdKTtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZVsxXSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBzZWxmLnR5cGUoKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgZmluaXNoUGFyc2U6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXTtcbiAgICBpZiAoZGF0YS5hbGwubGVuZ3RoID4gMCkge1xuICAgICAgc2VsZi5yYW5nZVswXSA9IF8ubWluKGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgICAgc2VsZi5yYW5nZVsxXSA9IF8ubWF4KGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgIH1cbiAgICBkYXRhLmFsbCA9IG5ldyBTb3J0ZWRMaXN0KGRhdGEuYWxsLCB7XG4gICAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhID09PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICAgIGlmIChiID09PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09PSAwKSAgPyAwIDogLTE7XG4gICAgICB9XG4gICAgfSk7XG4gIFxuICAgIC8vIFByZS1vcHRpbWl6ZSBkYXRhIGZvciBoaWdoIGJwcHBzIGJ5IGRvd25zYW1wbGluZ1xuICAgIF8uZWFjaChzZWxmLmJyb3dzZXJPcHRzLmJwcHBzLCBmdW5jdGlvbihicHBwKSB7XG4gICAgICBpZiAoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCA+IDEwMDAwMDApIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgcGl4TGVuID0gTWF0aC5jZWlsKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHApLFxuICAgICAgICBkb3duc2FtcGxlZERhdGEgPSAoZGF0YVticHBwXSA9IChnbG9iYWwuRmxvYXQzMkFycmF5ID8gbmV3IEZsb2F0MzJBcnJheShwaXhMZW4pIDogbmV3IEFycmF5KHBpeExlbikpKSxcbiAgICAgICAgaiA9IDAsXG4gICAgICAgIGN1cnIgPSBkYXRhLmFsbC5nZXQoMCksXG4gICAgICAgIGJpbiwgbmV4dDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGl4TGVuOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5zdGFydCA8PSBpICogYnBwcCAmJiBjdXJyLmVuZCA+IGkgKiBicHBwKSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICYmIG5leHQuZW5kID4gaSAqIGJwcHApIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkb3duc2FtcGxlZERhdGFbaV0gPSBiaW5GdW5jdGlvbihiaW4pO1xuICAgICAgfVxuICAgICAgZGF0YS5fYmluRnVuY3Rpb24gPSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb247XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7IC8vIHN1Y2Nlc3MhXG4gIH0sXG4gIFxuICBpbml0RHJhd1NwZWM6IGZ1bmN0aW9uKHByZWNhbGMpIHtcbiAgICB2YXIgdlNjYWxlID0gKHRoaXMuZHJhd1JhbmdlWzFdIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gcHJlY2FsYy5oZWlnaHQsXG4gICAgICBkcmF3U3BlYyA9IHtcbiAgICAgICAgYmFyczogW10sXG4gICAgICAgIHZTY2FsZTogdlNjYWxlLFxuICAgICAgICB5TGluZTogdGhpcy5pc09uKHRoaXMub3B0cy55TGluZU9uT2ZmKSA/IE1hdGgucm91bmQoKHRoaXMub3B0cy55TGluZU1hcmsgLSB0aGlzLmRyYXdSYW5nZVswXSkgLyB2U2NhbGUpIDogbnVsbCwgXG4gICAgICAgIHplcm9MaW5lOiAtdGhpcy5kcmF3UmFuZ2VbMF0gLyB2U2NhbGVcbiAgICAgIH07XG4gICAgcmV0dXJuIGRyYXdTcGVjO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHByZWNhbGMud2lkdGgsXG4gICAgICBkcmF3U3BlYyA9IHNlbGYudHlwZSgpLmluaXREcmF3U3BlYy5jYWxsKHNlbGYsIHByZWNhbGMpLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl0sXG4gICAgICBkb3duc2FtcGxlZERhdGE7XG4gICAgaWYgKHNlbGYuZGF0YS5fYmluRnVuY3Rpb24gPT0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uICYmIChkb3duc2FtcGxlZERhdGEgPSBzZWxmLmRhdGFbYnBwcF0pKSB7XG4gICAgICAvLyBXZSd2ZSBhbHJlYWR5IHByZS1vcHRpbWl6ZWQgZm9yIHRoaXMgYnBwcFxuICAgICAgZHJhd1NwZWMuYmFycyA9IF8ubWFwKF8ucmFuZ2UoKHN0YXJ0IC0gMSkgLyBicHBwLCAoZW5kIC0gMSkgLyBicHBwKSwgZnVuY3Rpb24oeEZyb21PcmlnaW4sIHgpIHtcbiAgICAgICAgcmV0dXJuICgoZG93bnNhbXBsZWREYXRhW3hGcm9tT3JpZ2luXSB8fCAwKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBoYXZlIHRvIGRvIHRoZSBiaW5uaW5nIG9uIHRoZSBmbHlcbiAgICAgIHZhciBqID0gc2VsZi5kYXRhLmFsbC5ic2VhcmNoKHtzdGFydDogc3RhcnR9KSxcbiAgICAgICAgY3VyciA9IHNlbGYuZGF0YS5hbGwuZ2V0KGopLCBuZXh0LCBiaW47XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByZWNhbGMud2lkdGg7IGkrKykge1xuICAgICAgICBiaW4gPSBjdXJyICYmIChjdXJyLmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gc2VsZi5kYXRhLmFsbC5nZXQoaiArIDEpKSAmJiBuZXh0LnN0YXJ0IDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBuZXh0LmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZHJhd1NwZWMuYmFycy5wdXNoKChiaW5GdW5jdGlvbihiaW4pIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbihjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKSB7XG4gICAgdmFyIHplcm9MaW5lID0gZHJhd1NwZWMuemVyb0xpbmUsIC8vIHBpeGVsIHBvc2l0aW9uIG9mIHRoZSBkYXRhIHZhbHVlIDBcbiAgICAgIGNvbG9yID0gXCJyZ2IoXCIrdGhpcy5vcHRzLmNvbG9yK1wiKVwiLFxuICAgICAgYWx0Q29sb3IgPSBcInJnYihcIisodGhpcy5vcHRzLmFsdENvbG9yIHx8IHRoaXMuYWx0Q29sb3IpK1wiKVwiLFxuICAgICAgcG9pbnRHcmFwaCA9IHRoaXMub3B0cy5ncmFwaFR5cGU9PT0ncG9pbnRzJztcbiAgICBcbiAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgXy5lYWNoKGRyYXdTcGVjLmJhcnMsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgZWxzZSBpZiAoZCA+IHplcm9MaW5lKSB7IFxuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgMSk7IH1cbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSBkLCAxLCB6ZXJvTGluZSA+IDAgPyAoZCAtIHplcm9MaW5lKSA6IGQpOyB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gYWx0Q29sb3I7XG4gICAgICAgIGlmIChwb2ludEdyYXBoKSB7IGN0eC5maWxsUmVjdCh4LCB6ZXJvTGluZSAtIGQgLSAxLCAxLCAxKTsgfSBcbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSB6ZXJvTGluZSwgMSwgemVyb0xpbmUgLSBkKTsgfVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGRyYXdTcGVjLnlMaW5lICE9PSBudWxsKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgICBjdHguZmlsbFJlY3QoMCwgaGVpZ2h0IC0gZHJhd1NwZWMueUxpbmUsIHdpZHRoLCAxKTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgaGVpZ2h0ID0gY2FudmFzLmhlaWdodCxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aCwgaGVpZ2h0OiBoZWlnaHR9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCkuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICAkdmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnLnZpZXctbGltaXRzJyksXG4gICAgICAkbWF4SGVpZ2h0UGl4ZWxzID0gJGRpYWxvZy5maW5kKCcubWF4LWhlaWdodC1waXhlbHMnKSxcbiAgICAgIGFsdENvbG9yT24gPSB0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmF0dHIoJ2NoZWNrZWQnLCBhbHRDb2xvck9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbChhbHRDb2xvck9uID8gby5hbHRDb2xvciA6JzEyOCwxMjgsMTI4JykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuYXR0cignY2hlY2tlZCcsICF0aGlzLmlzT24oby5hdXRvU2NhbGUpKS5jaGFuZ2UoKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtaW5cIiwgdGhpcy5yYW5nZVswXSk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWF4XCIsIHRoaXMucmFuZ2VbMV0pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMF0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMV0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8ueUxpbmVPbk9mZikpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbChvLnlMaW5lTWFyaykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKG8uZ3JhcGhUeXBlKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbChvLndpbmRvd2luZ0Z1bmN0aW9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmF0dHIoJ2NoZWNrZWQnLCBvLm1heEhlaWdodFBpeGVscy5sZW5ndGggPj0gMyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzJdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMF0pLmNoYW5nZSgpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGFsdENvbG9yT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNNYXggPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoKTtcbiAgICBvLmFsdENvbG9yID0gYWx0Q29sb3JPbiA/ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKCkgOiAnJztcbiAgICBvLmF1dG9TY2FsZSA9ICEkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKCkgKyAnOicgKyAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKCk7XG4gICAgby55TGluZU9uT2ZmID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8ueUxpbmVNYXJrID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKCk7XG4gICAgby5ncmFwaFR5cGUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoKTtcbiAgICBvLndpbmRvd2luZ0Z1bmN0aW9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoKTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IG1heEhlaWdodFBpeGVsc09uID8gXG4gICAgICBbbWF4SGVpZ2h0UGl4ZWxzTWF4LCBtYXhIZWlnaHRQaXhlbHNNYXgsICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbCgpXS5qb2luKCc6JykgOiAnJztcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gV2lnZ2xlRm9ybWF0OyIsIi8vICAgICBVbmRlcnNjb3JlLmpzIDEuOC4zXG4vLyAgICAgaHR0cDovL3VuZGVyc2NvcmVqcy5vcmdcbi8vICAgICAoYykgMjAwOS0yMDE1IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4vLyAgICAgVW5kZXJzY29yZSBtYXkgYmUgZnJlZWx5IGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbihmdW5jdGlvbigpe2Z1bmN0aW9uIG4obil7ZnVuY3Rpb24gdCh0LHIsZSx1LGksbyl7Zm9yKDtpPj0wJiZvPmk7aSs9bil7dmFyIGE9dT91W2ldOmk7ZT1yKGUsdFthXSxhLHQpfXJldHVybiBlfXJldHVybiBmdW5jdGlvbihyLGUsdSxpKXtlPWIoZSxpLDQpO3ZhciBvPSFrKHIpJiZtLmtleXMociksYT0ob3x8cikubGVuZ3RoLGM9bj4wPzA6YS0xO3JldHVybiBhcmd1bWVudHMubGVuZ3RoPDMmJih1PXJbbz9vW2NdOmNdLGMrPW4pLHQocixlLHUsbyxjLGEpfX1mdW5jdGlvbiB0KG4pe3JldHVybiBmdW5jdGlvbih0LHIsZSl7cj14KHIsZSk7Zm9yKHZhciB1PU8odCksaT1uPjA/MDp1LTE7aT49MCYmdT5pO2krPW4paWYocih0W2ldLGksdCkpcmV0dXJuIGk7cmV0dXJuLTF9fWZ1bmN0aW9uIHIobix0LHIpe3JldHVybiBmdW5jdGlvbihlLHUsaSl7dmFyIG89MCxhPU8oZSk7aWYoXCJudW1iZXJcIj09dHlwZW9mIGkpbj4wP289aT49MD9pOk1hdGgubWF4KGkrYSxvKTphPWk+PTA/TWF0aC5taW4oaSsxLGEpOmkrYSsxO2Vsc2UgaWYociYmaSYmYSlyZXR1cm4gaT1yKGUsdSksZVtpXT09PXU/aTotMTtpZih1IT09dSlyZXR1cm4gaT10KGwuY2FsbChlLG8sYSksbS5pc05hTiksaT49MD9pK286LTE7Zm9yKGk9bj4wP286YS0xO2k+PTAmJmE+aTtpKz1uKWlmKGVbaV09PT11KXJldHVybiBpO3JldHVybi0xfX1mdW5jdGlvbiBlKG4sdCl7dmFyIHI9SS5sZW5ndGgsZT1uLmNvbnN0cnVjdG9yLHU9bS5pc0Z1bmN0aW9uKGUpJiZlLnByb3RvdHlwZXx8YSxpPVwiY29uc3RydWN0b3JcIjtmb3IobS5oYXMobixpKSYmIW0uY29udGFpbnModCxpKSYmdC5wdXNoKGkpO3ItLTspaT1JW3JdLGkgaW4gbiYmbltpXSE9PXVbaV0mJiFtLmNvbnRhaW5zKHQsaSkmJnQucHVzaChpKX12YXIgdT10aGlzLGk9dS5fLG89QXJyYXkucHJvdG90eXBlLGE9T2JqZWN0LnByb3RvdHlwZSxjPUZ1bmN0aW9uLnByb3RvdHlwZSxmPW8ucHVzaCxsPW8uc2xpY2Uscz1hLnRvU3RyaW5nLHA9YS5oYXNPd25Qcm9wZXJ0eSxoPUFycmF5LmlzQXJyYXksdj1PYmplY3Qua2V5cyxnPWMuYmluZCx5PU9iamVjdC5jcmVhdGUsZD1mdW5jdGlvbigpe30sbT1mdW5jdGlvbihuKXtyZXR1cm4gbiBpbnN0YW5jZW9mIG0/bjp0aGlzIGluc3RhbmNlb2YgbT92b2lkKHRoaXMuX3dyYXBwZWQ9bik6bmV3IG0obil9O1widW5kZWZpbmVkXCIhPXR5cGVvZiBleHBvcnRzPyhcInVuZGVmaW5lZFwiIT10eXBlb2YgbW9kdWxlJiZtb2R1bGUuZXhwb3J0cyYmKGV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bSksZXhwb3J0cy5fPW0pOnUuXz1tLG0uVkVSU0lPTj1cIjEuOC4zXCI7dmFyIGI9ZnVuY3Rpb24obix0LHIpe2lmKHQ9PT12b2lkIDApcmV0dXJuIG47c3dpdGNoKG51bGw9PXI/MzpyKXtjYXNlIDE6cmV0dXJuIGZ1bmN0aW9uKHIpe3JldHVybiBuLmNhbGwodCxyKX07Y2FzZSAyOnJldHVybiBmdW5jdGlvbihyLGUpe3JldHVybiBuLmNhbGwodCxyLGUpfTtjYXNlIDM6cmV0dXJuIGZ1bmN0aW9uKHIsZSx1KXtyZXR1cm4gbi5jYWxsKHQscixlLHUpfTtjYXNlIDQ6cmV0dXJuIGZ1bmN0aW9uKHIsZSx1LGkpe3JldHVybiBuLmNhbGwodCxyLGUsdSxpKX19cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIG4uYXBwbHkodCxhcmd1bWVudHMpfX0seD1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PW4/bS5pZGVudGl0eTptLmlzRnVuY3Rpb24obik/YihuLHQscik6bS5pc09iamVjdChuKT9tLm1hdGNoZXIobik6bS5wcm9wZXJ0eShuKX07bS5pdGVyYXRlZT1mdW5jdGlvbihuLHQpe3JldHVybiB4KG4sdCwxLzApfTt2YXIgXz1mdW5jdGlvbihuLHQpe3JldHVybiBmdW5jdGlvbihyKXt2YXIgZT1hcmd1bWVudHMubGVuZ3RoO2lmKDI+ZXx8bnVsbD09cilyZXR1cm4gcjtmb3IodmFyIHU9MTtlPnU7dSsrKWZvcih2YXIgaT1hcmd1bWVudHNbdV0sbz1uKGkpLGE9by5sZW5ndGgsYz0wO2E+YztjKyspe3ZhciBmPW9bY107dCYmcltmXSE9PXZvaWQgMHx8KHJbZl09aVtmXSl9cmV0dXJuIHJ9fSxqPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybnt9O2lmKHkpcmV0dXJuIHkobik7ZC5wcm90b3R5cGU9bjt2YXIgdD1uZXcgZDtyZXR1cm4gZC5wcm90b3R5cGU9bnVsbCx0fSx3PWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbih0KXtyZXR1cm4gbnVsbD09dD92b2lkIDA6dFtuXX19LEE9TWF0aC5wb3coMiw1MyktMSxPPXcoXCJsZW5ndGhcIiksaz1mdW5jdGlvbihuKXt2YXIgdD1PKG4pO3JldHVyblwibnVtYmVyXCI9PXR5cGVvZiB0JiZ0Pj0wJiZBPj10fTttLmVhY2g9bS5mb3JFYWNoPWZ1bmN0aW9uKG4sdCxyKXt0PWIodCxyKTt2YXIgZSx1O2lmKGsobikpZm9yKGU9MCx1PW4ubGVuZ3RoO3U+ZTtlKyspdChuW2VdLGUsbik7ZWxzZXt2YXIgaT1tLmtleXMobik7Zm9yKGU9MCx1PWkubGVuZ3RoO3U+ZTtlKyspdChuW2lbZV1dLGlbZV0sbil9cmV0dXJuIG59LG0ubWFwPW0uY29sbGVjdD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9QXJyYXkodSksbz0wO3U+bztvKyspe3ZhciBhPWU/ZVtvXTpvO2lbb109dChuW2FdLGEsbil9cmV0dXJuIGl9LG0ucmVkdWNlPW0uZm9sZGw9bS5pbmplY3Q9bigxKSxtLnJlZHVjZVJpZ2h0PW0uZm9sZHI9bigtMSksbS5maW5kPW0uZGV0ZWN0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZTtyZXR1cm4gZT1rKG4pP20uZmluZEluZGV4KG4sdCxyKTptLmZpbmRLZXkobix0LHIpLGUhPT12b2lkIDAmJmUhPT0tMT9uW2VdOnZvaWQgMH0sbS5maWx0ZXI9bS5zZWxlY3Q9ZnVuY3Rpb24obix0LHIpe3ZhciBlPVtdO3JldHVybiB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsdSl7dChuLHIsdSkmJmUucHVzaChuKX0pLGV9LG0ucmVqZWN0PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbS5maWx0ZXIobixtLm5lZ2F0ZSh4KHQpKSxyKX0sbS5ldmVyeT1tLmFsbD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9MDt1Pmk7aSsrKXt2YXIgbz1lP2VbaV06aTtpZighdChuW29dLG8sbikpcmV0dXJuITF9cmV0dXJuITB9LG0uc29tZT1tLmFueT1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9MDt1Pmk7aSsrKXt2YXIgbz1lP2VbaV06aTtpZih0KG5bb10sbyxuKSlyZXR1cm4hMH1yZXR1cm4hMX0sbS5jb250YWlucz1tLmluY2x1ZGVzPW0uaW5jbHVkZT1mdW5jdGlvbihuLHQscixlKXtyZXR1cm4gayhuKXx8KG49bS52YWx1ZXMobikpLChcIm51bWJlclwiIT10eXBlb2Ygcnx8ZSkmJihyPTApLG0uaW5kZXhPZihuLHQscik+PTB9LG0uaW52b2tlPWZ1bmN0aW9uKG4sdCl7dmFyIHI9bC5jYWxsKGFyZ3VtZW50cywyKSxlPW0uaXNGdW5jdGlvbih0KTtyZXR1cm4gbS5tYXAobixmdW5jdGlvbihuKXt2YXIgdT1lP3Q6blt0XTtyZXR1cm4gbnVsbD09dT91OnUuYXBwbHkobixyKX0pfSxtLnBsdWNrPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0ubWFwKG4sbS5wcm9wZXJ0eSh0KSl9LG0ud2hlcmU9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5maWx0ZXIobixtLm1hdGNoZXIodCkpfSxtLmZpbmRXaGVyZT1mdW5jdGlvbihuLHQpe3JldHVybiBtLmZpbmQobixtLm1hdGNoZXIodCkpfSxtLm1heD1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPS0xLzAsbz0tMS8wO2lmKG51bGw9PXQmJm51bGwhPW4pe249ayhuKT9uOm0udmFsdWVzKG4pO2Zvcih2YXIgYT0wLGM9bi5sZW5ndGg7Yz5hO2ErKyllPW5bYV0sZT5pJiYoaT1lKX1lbHNlIHQ9eCh0LHIpLG0uZWFjaChuLGZ1bmN0aW9uKG4scixlKXt1PXQobixyLGUpLCh1Pm98fHU9PT0tMS8wJiZpPT09LTEvMCkmJihpPW4sbz11KX0pO3JldHVybiBpfSxtLm1pbj1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPTEvMCxvPTEvMDtpZihudWxsPT10JiZudWxsIT1uKXtuPWsobik/bjptLnZhbHVlcyhuKTtmb3IodmFyIGE9MCxjPW4ubGVuZ3RoO2M+YTthKyspZT1uW2FdLGk+ZSYmKGk9ZSl9ZWxzZSB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsZSl7dT10KG4scixlKSwobz51fHwxLzA9PT11JiYxLzA9PT1pKSYmKGk9bixvPXUpfSk7cmV0dXJuIGl9LG0uc2h1ZmZsZT1mdW5jdGlvbihuKXtmb3IodmFyIHQscj1rKG4pP246bS52YWx1ZXMobiksZT1yLmxlbmd0aCx1PUFycmF5KGUpLGk9MDtlPmk7aSsrKXQ9bS5yYW5kb20oMCxpKSx0IT09aSYmKHVbaV09dVt0XSksdVt0XT1yW2ldO3JldHVybiB1fSxtLnNhbXBsZT1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PXR8fHI/KGsobil8fChuPW0udmFsdWVzKG4pKSxuW20ucmFuZG9tKG4ubGVuZ3RoLTEpXSk6bS5zaHVmZmxlKG4pLnNsaWNlKDAsTWF0aC5tYXgoMCx0KSl9LG0uc29ydEJ5PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gdD14KHQsciksbS5wbHVjayhtLm1hcChuLGZ1bmN0aW9uKG4scixlKXtyZXR1cm57dmFsdWU6bixpbmRleDpyLGNyaXRlcmlhOnQobixyLGUpfX0pLnNvcnQoZnVuY3Rpb24obix0KXt2YXIgcj1uLmNyaXRlcmlhLGU9dC5jcml0ZXJpYTtpZihyIT09ZSl7aWYocj5lfHxyPT09dm9pZCAwKXJldHVybiAxO2lmKGU+cnx8ZT09PXZvaWQgMClyZXR1cm4tMX1yZXR1cm4gbi5pbmRleC10LmluZGV4fSksXCJ2YWx1ZVwiKX07dmFyIEY9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKHQscixlKXt2YXIgdT17fTtyZXR1cm4gcj14KHIsZSksbS5lYWNoKHQsZnVuY3Rpb24oZSxpKXt2YXIgbz1yKGUsaSx0KTtuKHUsZSxvKX0pLHV9fTttLmdyb3VwQnk9RihmdW5jdGlvbihuLHQscil7bS5oYXMobixyKT9uW3JdLnB1c2godCk6bltyXT1bdF19KSxtLmluZGV4Qnk9RihmdW5jdGlvbihuLHQscil7bltyXT10fSksbS5jb3VudEJ5PUYoZnVuY3Rpb24obix0LHIpe20uaGFzKG4scik/bltyXSsrOm5bcl09MX0pLG0udG9BcnJheT1mdW5jdGlvbihuKXtyZXR1cm4gbj9tLmlzQXJyYXkobik/bC5jYWxsKG4pOmsobik/bS5tYXAobixtLmlkZW50aXR5KTptLnZhbHVlcyhuKTpbXX0sbS5zaXplPWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT1uPzA6ayhuKT9uLmxlbmd0aDptLmtleXMobikubGVuZ3RofSxtLnBhcnRpdGlvbj1mdW5jdGlvbihuLHQscil7dD14KHQscik7dmFyIGU9W10sdT1bXTtyZXR1cm4gbS5lYWNoKG4sZnVuY3Rpb24obixyLGkpeyh0KG4scixpKT9lOnUpLnB1c2gobil9KSxbZSx1XX0sbS5maXJzdD1tLmhlYWQ9bS50YWtlPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09bj92b2lkIDA6bnVsbD09dHx8cj9uWzBdOm0uaW5pdGlhbChuLG4ubGVuZ3RoLXQpfSxtLmluaXRpYWw9ZnVuY3Rpb24obix0LHIpe3JldHVybiBsLmNhbGwobiwwLE1hdGgubWF4KDAsbi5sZW5ndGgtKG51bGw9PXR8fHI/MTp0KSkpfSxtLmxhc3Q9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT1uP3ZvaWQgMDpudWxsPT10fHxyP25bbi5sZW5ndGgtMV06bS5yZXN0KG4sTWF0aC5tYXgoMCxuLmxlbmd0aC10KSl9LG0ucmVzdD1tLnRhaWw9bS5kcm9wPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbC5jYWxsKG4sbnVsbD09dHx8cj8xOnQpfSxtLmNvbXBhY3Q9ZnVuY3Rpb24obil7cmV0dXJuIG0uZmlsdGVyKG4sbS5pZGVudGl0eSl9O3ZhciBTPWZ1bmN0aW9uKG4sdCxyLGUpe2Zvcih2YXIgdT1bXSxpPTAsbz1lfHwwLGE9TyhuKTthPm87bysrKXt2YXIgYz1uW29dO2lmKGsoYykmJihtLmlzQXJyYXkoYyl8fG0uaXNBcmd1bWVudHMoYykpKXt0fHwoYz1TKGMsdCxyKSk7dmFyIGY9MCxsPWMubGVuZ3RoO2Zvcih1Lmxlbmd0aCs9bDtsPmY7KXVbaSsrXT1jW2YrK119ZWxzZSByfHwodVtpKytdPWMpfXJldHVybiB1fTttLmZsYXR0ZW49ZnVuY3Rpb24obix0KXtyZXR1cm4gUyhuLHQsITEpfSxtLndpdGhvdXQ9ZnVuY3Rpb24obil7cmV0dXJuIG0uZGlmZmVyZW5jZShuLGwuY2FsbChhcmd1bWVudHMsMSkpfSxtLnVuaXE9bS51bmlxdWU9ZnVuY3Rpb24obix0LHIsZSl7bS5pc0Jvb2xlYW4odCl8fChlPXIscj10LHQ9ITEpLG51bGwhPXImJihyPXgocixlKSk7Zm9yKHZhciB1PVtdLGk9W10sbz0wLGE9TyhuKTthPm87bysrKXt2YXIgYz1uW29dLGY9cj9yKGMsbyxuKTpjO3Q/KG8mJmk9PT1mfHx1LnB1c2goYyksaT1mKTpyP20uY29udGFpbnMoaSxmKXx8KGkucHVzaChmKSx1LnB1c2goYykpOm0uY29udGFpbnModSxjKXx8dS5wdXNoKGMpfXJldHVybiB1fSxtLnVuaW9uPWZ1bmN0aW9uKCl7cmV0dXJuIG0udW5pcShTKGFyZ3VtZW50cywhMCwhMCkpfSxtLmludGVyc2VjdGlvbj1mdW5jdGlvbihuKXtmb3IodmFyIHQ9W10scj1hcmd1bWVudHMubGVuZ3RoLGU9MCx1PU8obik7dT5lO2UrKyl7dmFyIGk9bltlXTtpZighbS5jb250YWlucyh0LGkpKXtmb3IodmFyIG89MTtyPm8mJm0uY29udGFpbnMoYXJndW1lbnRzW29dLGkpO28rKyk7bz09PXImJnQucHVzaChpKX19cmV0dXJuIHR9LG0uZGlmZmVyZW5jZT1mdW5jdGlvbihuKXt2YXIgdD1TKGFyZ3VtZW50cywhMCwhMCwxKTtyZXR1cm4gbS5maWx0ZXIobixmdW5jdGlvbihuKXtyZXR1cm4hbS5jb250YWlucyh0LG4pfSl9LG0uemlwPWZ1bmN0aW9uKCl7cmV0dXJuIG0udW56aXAoYXJndW1lbnRzKX0sbS51bnppcD1mdW5jdGlvbihuKXtmb3IodmFyIHQ9biYmbS5tYXgobixPKS5sZW5ndGh8fDAscj1BcnJheSh0KSxlPTA7dD5lO2UrKylyW2VdPW0ucGx1Y2sobixlKTtyZXR1cm4gcn0sbS5vYmplY3Q9ZnVuY3Rpb24obix0KXtmb3IodmFyIHI9e30sZT0wLHU9TyhuKTt1PmU7ZSsrKXQ/cltuW2VdXT10W2VdOnJbbltlXVswXV09bltlXVsxXTtyZXR1cm4gcn0sbS5maW5kSW5kZXg9dCgxKSxtLmZpbmRMYXN0SW5kZXg9dCgtMSksbS5zb3J0ZWRJbmRleD1mdW5jdGlvbihuLHQscixlKXtyPXgocixlLDEpO2Zvcih2YXIgdT1yKHQpLGk9MCxvPU8obik7bz5pOyl7dmFyIGE9TWF0aC5mbG9vcigoaStvKS8yKTtyKG5bYV0pPHU/aT1hKzE6bz1hfXJldHVybiBpfSxtLmluZGV4T2Y9cigxLG0uZmluZEluZGV4LG0uc29ydGVkSW5kZXgpLG0ubGFzdEluZGV4T2Y9cigtMSxtLmZpbmRMYXN0SW5kZXgpLG0ucmFuZ2U9ZnVuY3Rpb24obix0LHIpe251bGw9PXQmJih0PW58fDAsbj0wKSxyPXJ8fDE7Zm9yKHZhciBlPU1hdGgubWF4KE1hdGguY2VpbCgodC1uKS9yKSwwKSx1PUFycmF5KGUpLGk9MDtlPmk7aSsrLG4rPXIpdVtpXT1uO3JldHVybiB1fTt2YXIgRT1mdW5jdGlvbihuLHQscixlLHUpe2lmKCEoZSBpbnN0YW5jZW9mIHQpKXJldHVybiBuLmFwcGx5KHIsdSk7dmFyIGk9aihuLnByb3RvdHlwZSksbz1uLmFwcGx5KGksdSk7cmV0dXJuIG0uaXNPYmplY3Qobyk/bzppfTttLmJpbmQ9ZnVuY3Rpb24obix0KXtpZihnJiZuLmJpbmQ9PT1nKXJldHVybiBnLmFwcGx5KG4sbC5jYWxsKGFyZ3VtZW50cywxKSk7aWYoIW0uaXNGdW5jdGlvbihuKSl0aHJvdyBuZXcgVHlwZUVycm9yKFwiQmluZCBtdXN0IGJlIGNhbGxlZCBvbiBhIGZ1bmN0aW9uXCIpO3ZhciByPWwuY2FsbChhcmd1bWVudHMsMiksZT1mdW5jdGlvbigpe3JldHVybiBFKG4sZSx0LHRoaXMsci5jb25jYXQobC5jYWxsKGFyZ3VtZW50cykpKX07cmV0dXJuIGV9LG0ucGFydGlhbD1mdW5jdGlvbihuKXt2YXIgdD1sLmNhbGwoYXJndW1lbnRzLDEpLHI9ZnVuY3Rpb24oKXtmb3IodmFyIGU9MCx1PXQubGVuZ3RoLGk9QXJyYXkodSksbz0wO3U+bztvKyspaVtvXT10W29dPT09bT9hcmd1bWVudHNbZSsrXTp0W29dO2Zvcig7ZTxhcmd1bWVudHMubGVuZ3RoOylpLnB1c2goYXJndW1lbnRzW2UrK10pO3JldHVybiBFKG4scix0aGlzLHRoaXMsaSl9O3JldHVybiByfSxtLmJpbmRBbGw9ZnVuY3Rpb24obil7dmFyIHQscixlPWFyZ3VtZW50cy5sZW5ndGg7aWYoMT49ZSl0aHJvdyBuZXcgRXJyb3IoXCJiaW5kQWxsIG11c3QgYmUgcGFzc2VkIGZ1bmN0aW9uIG5hbWVzXCIpO2Zvcih0PTE7ZT50O3QrKylyPWFyZ3VtZW50c1t0XSxuW3JdPW0uYmluZChuW3JdLG4pO3JldHVybiBufSxtLm1lbW9pemU9ZnVuY3Rpb24obix0KXt2YXIgcj1mdW5jdGlvbihlKXt2YXIgdT1yLmNhY2hlLGk9XCJcIisodD90LmFwcGx5KHRoaXMsYXJndW1lbnRzKTplKTtyZXR1cm4gbS5oYXModSxpKXx8KHVbaV09bi5hcHBseSh0aGlzLGFyZ3VtZW50cykpLHVbaV19O3JldHVybiByLmNhY2hlPXt9LHJ9LG0uZGVsYXk9ZnVuY3Rpb24obix0KXt2YXIgcj1sLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7cmV0dXJuIG4uYXBwbHkobnVsbCxyKX0sdCl9LG0uZGVmZXI9bS5wYXJ0aWFsKG0uZGVsYXksbSwxKSxtLnRocm90dGxlPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGksbz1udWxsLGE9MDtyfHwocj17fSk7dmFyIGM9ZnVuY3Rpb24oKXthPXIubGVhZGluZz09PSExPzA6bS5ub3coKSxvPW51bGwsaT1uLmFwcGx5KGUsdSksb3x8KGU9dT1udWxsKX07cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGY9bS5ub3coKTthfHxyLmxlYWRpbmchPT0hMXx8KGE9Zik7dmFyIGw9dC0oZi1hKTtyZXR1cm4gZT10aGlzLHU9YXJndW1lbnRzLDA+PWx8fGw+dD8obyYmKGNsZWFyVGltZW91dChvKSxvPW51bGwpLGE9ZixpPW4uYXBwbHkoZSx1KSxvfHwoZT11PW51bGwpKTpvfHxyLnRyYWlsaW5nPT09ITF8fChvPXNldFRpbWVvdXQoYyxsKSksaX19LG0uZGVib3VuY2U9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaSxvLGEsYz1mdW5jdGlvbigpe3ZhciBmPW0ubm93KCktbzt0PmYmJmY+PTA/ZT1zZXRUaW1lb3V0KGMsdC1mKTooZT1udWxsLHJ8fChhPW4uYXBwbHkoaSx1KSxlfHwoaT11PW51bGwpKSl9O3JldHVybiBmdW5jdGlvbigpe2k9dGhpcyx1PWFyZ3VtZW50cyxvPW0ubm93KCk7dmFyIGY9ciYmIWU7cmV0dXJuIGV8fChlPXNldFRpbWVvdXQoYyx0KSksZiYmKGE9bi5hcHBseShpLHUpLGk9dT1udWxsKSxhfX0sbS53cmFwPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0ucGFydGlhbCh0LG4pfSxtLm5lZ2F0ZT1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4hbi5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fSxtLmNvbXBvc2U9ZnVuY3Rpb24oKXt2YXIgbj1hcmd1bWVudHMsdD1uLmxlbmd0aC0xO3JldHVybiBmdW5jdGlvbigpe2Zvcih2YXIgcj10LGU9blt0XS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7ci0tOyllPW5bcl0uY2FsbCh0aGlzLGUpO3JldHVybiBlfX0sbS5hZnRlcj1mdW5jdGlvbihuLHQpe3JldHVybiBmdW5jdGlvbigpe3JldHVybi0tbjwxP3QuYXBwbHkodGhpcyxhcmd1bWVudHMpOnZvaWQgMH19LG0uYmVmb3JlPWZ1bmN0aW9uKG4sdCl7dmFyIHI7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuLS1uPjAmJihyPXQuYXBwbHkodGhpcyxhcmd1bWVudHMpKSwxPj1uJiYodD1udWxsKSxyfX0sbS5vbmNlPW0ucGFydGlhbChtLmJlZm9yZSwyKTt2YXIgTT0he3RvU3RyaW5nOm51bGx9LnByb3BlcnR5SXNFbnVtZXJhYmxlKFwidG9TdHJpbmdcIiksST1bXCJ2YWx1ZU9mXCIsXCJpc1Byb3RvdHlwZU9mXCIsXCJ0b1N0cmluZ1wiLFwicHJvcGVydHlJc0VudW1lcmFibGVcIixcImhhc093blByb3BlcnR5XCIsXCJ0b0xvY2FsZVN0cmluZ1wiXTttLmtleXM9ZnVuY3Rpb24obil7aWYoIW0uaXNPYmplY3QobikpcmV0dXJuW107aWYodilyZXR1cm4gdihuKTt2YXIgdD1bXTtmb3IodmFyIHIgaW4gbiltLmhhcyhuLHIpJiZ0LnB1c2gocik7cmV0dXJuIE0mJmUobix0KSx0fSxtLmFsbEtleXM9ZnVuY3Rpb24obil7aWYoIW0uaXNPYmplY3QobikpcmV0dXJuW107dmFyIHQ9W107Zm9yKHZhciByIGluIG4pdC5wdXNoKHIpO3JldHVybiBNJiZlKG4sdCksdH0sbS52YWx1ZXM9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW0ua2V5cyhuKSxyPXQubGVuZ3RoLGU9QXJyYXkociksdT0wO3I+dTt1KyspZVt1XT1uW3RbdV1dO3JldHVybiBlfSxtLm1hcE9iamVjdD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlLHU9bS5rZXlzKG4pLGk9dS5sZW5ndGgsbz17fSxhPTA7aT5hO2ErKyllPXVbYV0sb1tlXT10KG5bZV0sZSxuKTtyZXR1cm4gb30sbS5wYWlycz1mdW5jdGlvbihuKXtmb3IodmFyIHQ9bS5rZXlzKG4pLHI9dC5sZW5ndGgsZT1BcnJheShyKSx1PTA7cj51O3UrKyllW3VdPVt0W3VdLG5bdFt1XV1dO3JldHVybiBlfSxtLmludmVydD1mdW5jdGlvbihuKXtmb3IodmFyIHQ9e30scj1tLmtleXMobiksZT0wLHU9ci5sZW5ndGg7dT5lO2UrKyl0W25bcltlXV1dPXJbZV07cmV0dXJuIHR9LG0uZnVuY3Rpb25zPW0ubWV0aG9kcz1mdW5jdGlvbihuKXt2YXIgdD1bXTtmb3IodmFyIHIgaW4gbiltLmlzRnVuY3Rpb24obltyXSkmJnQucHVzaChyKTtyZXR1cm4gdC5zb3J0KCl9LG0uZXh0ZW5kPV8obS5hbGxLZXlzKSxtLmV4dGVuZE93bj1tLmFzc2lnbj1fKG0ua2V5cyksbS5maW5kS2V5PWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGUsdT1tLmtleXMobiksaT0wLG89dS5sZW5ndGg7bz5pO2krKylpZihlPXVbaV0sdChuW2VdLGUsbikpcmV0dXJuIGV9LG0ucGljaz1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPXt9LG89bjtpZihudWxsPT1vKXJldHVybiBpO20uaXNGdW5jdGlvbih0KT8odT1tLmFsbEtleXMobyksZT1iKHQscikpOih1PVMoYXJndW1lbnRzLCExLCExLDEpLGU9ZnVuY3Rpb24obix0LHIpe3JldHVybiB0IGluIHJ9LG89T2JqZWN0KG8pKTtmb3IodmFyIGE9MCxjPXUubGVuZ3RoO2M+YTthKyspe3ZhciBmPXVbYV0sbD1vW2ZdO2UobCxmLG8pJiYoaVtmXT1sKX1yZXR1cm4gaX0sbS5vbWl0PWZ1bmN0aW9uKG4sdCxyKXtpZihtLmlzRnVuY3Rpb24odCkpdD1tLm5lZ2F0ZSh0KTtlbHNle3ZhciBlPW0ubWFwKFMoYXJndW1lbnRzLCExLCExLDEpLFN0cmluZyk7dD1mdW5jdGlvbihuLHQpe3JldHVybiFtLmNvbnRhaW5zKGUsdCl9fXJldHVybiBtLnBpY2sobix0LHIpfSxtLmRlZmF1bHRzPV8obS5hbGxLZXlzLCEwKSxtLmNyZWF0ZT1mdW5jdGlvbihuLHQpe3ZhciByPWoobik7cmV0dXJuIHQmJm0uZXh0ZW5kT3duKHIsdCkscn0sbS5jbG9uZT1mdW5jdGlvbihuKXtyZXR1cm4gbS5pc09iamVjdChuKT9tLmlzQXJyYXkobik/bi5zbGljZSgpOm0uZXh0ZW5kKHt9LG4pOm59LG0udGFwPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIHQobiksbn0sbS5pc01hdGNoPWZ1bmN0aW9uKG4sdCl7dmFyIHI9bS5rZXlzKHQpLGU9ci5sZW5ndGg7aWYobnVsbD09bilyZXR1cm4hZTtmb3IodmFyIHU9T2JqZWN0KG4pLGk9MDtlPmk7aSsrKXt2YXIgbz1yW2ldO2lmKHRbb10hPT11W29dfHwhKG8gaW4gdSkpcmV0dXJuITF9cmV0dXJuITB9O3ZhciBOPWZ1bmN0aW9uKG4sdCxyLGUpe2lmKG49PT10KXJldHVybiAwIT09bnx8MS9uPT09MS90O2lmKG51bGw9PW58fG51bGw9PXQpcmV0dXJuIG49PT10O24gaW5zdGFuY2VvZiBtJiYobj1uLl93cmFwcGVkKSx0IGluc3RhbmNlb2YgbSYmKHQ9dC5fd3JhcHBlZCk7dmFyIHU9cy5jYWxsKG4pO2lmKHUhPT1zLmNhbGwodCkpcmV0dXJuITE7c3dpdGNoKHUpe2Nhc2VcIltvYmplY3QgUmVnRXhwXVwiOmNhc2VcIltvYmplY3QgU3RyaW5nXVwiOnJldHVyblwiXCIrbj09XCJcIit0O2Nhc2VcIltvYmplY3QgTnVtYmVyXVwiOnJldHVybituIT09K24/K3QhPT0rdDowPT09K24/MS8rbj09PTEvdDorbj09PSt0O2Nhc2VcIltvYmplY3QgRGF0ZV1cIjpjYXNlXCJbb2JqZWN0IEJvb2xlYW5dXCI6cmV0dXJuK249PT0rdH12YXIgaT1cIltvYmplY3QgQXJyYXldXCI9PT11O2lmKCFpKXtpZihcIm9iamVjdFwiIT10eXBlb2Ygbnx8XCJvYmplY3RcIiE9dHlwZW9mIHQpcmV0dXJuITE7dmFyIG89bi5jb25zdHJ1Y3RvcixhPXQuY29uc3RydWN0b3I7aWYobyE9PWEmJiEobS5pc0Z1bmN0aW9uKG8pJiZvIGluc3RhbmNlb2YgbyYmbS5pc0Z1bmN0aW9uKGEpJiZhIGluc3RhbmNlb2YgYSkmJlwiY29uc3RydWN0b3JcImluIG4mJlwiY29uc3RydWN0b3JcImluIHQpcmV0dXJuITF9cj1yfHxbXSxlPWV8fFtdO2Zvcih2YXIgYz1yLmxlbmd0aDtjLS07KWlmKHJbY109PT1uKXJldHVybiBlW2NdPT09dDtpZihyLnB1c2gobiksZS5wdXNoKHQpLGkpe2lmKGM9bi5sZW5ndGgsYyE9PXQubGVuZ3RoKXJldHVybiExO2Zvcig7Yy0tOylpZighTihuW2NdLHRbY10scixlKSlyZXR1cm4hMX1lbHNle3ZhciBmLGw9bS5rZXlzKG4pO2lmKGM9bC5sZW5ndGgsbS5rZXlzKHQpLmxlbmd0aCE9PWMpcmV0dXJuITE7Zm9yKDtjLS07KWlmKGY9bFtjXSwhbS5oYXModCxmKXx8IU4obltmXSx0W2ZdLHIsZSkpcmV0dXJuITF9cmV0dXJuIHIucG9wKCksZS5wb3AoKSwhMH07bS5pc0VxdWFsPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIE4obix0KX0sbS5pc0VtcHR5PWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT1uPyEwOmsobikmJihtLmlzQXJyYXkobil8fG0uaXNTdHJpbmcobil8fG0uaXNBcmd1bWVudHMobikpPzA9PT1uLmxlbmd0aDowPT09bS5rZXlzKG4pLmxlbmd0aH0sbS5pc0VsZW1lbnQ9ZnVuY3Rpb24obil7cmV0dXJuISghbnx8MSE9PW4ubm9kZVR5cGUpfSxtLmlzQXJyYXk9aHx8ZnVuY3Rpb24obil7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiPT09cy5jYWxsKG4pfSxtLmlzT2JqZWN0PWZ1bmN0aW9uKG4pe3ZhciB0PXR5cGVvZiBuO3JldHVyblwiZnVuY3Rpb25cIj09PXR8fFwib2JqZWN0XCI9PT10JiYhIW59LG0uZWFjaChbXCJBcmd1bWVudHNcIixcIkZ1bmN0aW9uXCIsXCJTdHJpbmdcIixcIk51bWJlclwiLFwiRGF0ZVwiLFwiUmVnRXhwXCIsXCJFcnJvclwiXSxmdW5jdGlvbihuKXttW1wiaXNcIituXT1mdW5jdGlvbih0KXtyZXR1cm4gcy5jYWxsKHQpPT09XCJbb2JqZWN0IFwiK24rXCJdXCJ9fSksbS5pc0FyZ3VtZW50cyhhcmd1bWVudHMpfHwobS5pc0FyZ3VtZW50cz1mdW5jdGlvbihuKXtyZXR1cm4gbS5oYXMobixcImNhbGxlZVwiKX0pLFwiZnVuY3Rpb25cIiE9dHlwZW9mLy4vJiZcIm9iamVjdFwiIT10eXBlb2YgSW50OEFycmF5JiYobS5pc0Z1bmN0aW9uPWZ1bmN0aW9uKG4pe3JldHVyblwiZnVuY3Rpb25cIj09dHlwZW9mIG58fCExfSksbS5pc0Zpbml0ZT1mdW5jdGlvbihuKXtyZXR1cm4gaXNGaW5pdGUobikmJiFpc05hTihwYXJzZUZsb2F0KG4pKX0sbS5pc05hTj1mdW5jdGlvbihuKXtyZXR1cm4gbS5pc051bWJlcihuKSYmbiE9PStufSxtLmlzQm9vbGVhbj1mdW5jdGlvbihuKXtyZXR1cm4gbj09PSEwfHxuPT09ITF8fFwiW29iamVjdCBCb29sZWFuXVwiPT09cy5jYWxsKG4pfSxtLmlzTnVsbD1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09PW59LG0uaXNVbmRlZmluZWQ9ZnVuY3Rpb24obil7cmV0dXJuIG49PT12b2lkIDB9LG0uaGFzPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG51bGwhPW4mJnAuY2FsbChuLHQpfSxtLm5vQ29uZmxpY3Q9ZnVuY3Rpb24oKXtyZXR1cm4gdS5fPWksdGhpc30sbS5pZGVudGl0eT1mdW5jdGlvbihuKXtyZXR1cm4gbn0sbS5jb25zdGFudD1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4gbn19LG0ubm9vcD1mdW5jdGlvbigpe30sbS5wcm9wZXJ0eT13LG0ucHJvcGVydHlPZj1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj9mdW5jdGlvbigpe306ZnVuY3Rpb24odCl7cmV0dXJuIG5bdF19fSxtLm1hdGNoZXI9bS5tYXRjaGVzPWZ1bmN0aW9uKG4pe3JldHVybiBuPW0uZXh0ZW5kT3duKHt9LG4pLGZ1bmN0aW9uKHQpe3JldHVybiBtLmlzTWF0Y2godCxuKX19LG0udGltZXM9ZnVuY3Rpb24obix0LHIpe3ZhciBlPUFycmF5KE1hdGgubWF4KDAsbikpO3Q9Yih0LHIsMSk7Zm9yKHZhciB1PTA7bj51O3UrKyllW3VdPXQodSk7cmV0dXJuIGV9LG0ucmFuZG9tPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG51bGw9PXQmJih0PW4sbj0wKSxuK01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSoodC1uKzEpKX0sbS5ub3c9RGF0ZS5ub3d8fGZ1bmN0aW9uKCl7cmV0dXJuKG5ldyBEYXRlKS5nZXRUaW1lKCl9O3ZhciBCPXtcIiZcIjpcIiZhbXA7XCIsXCI8XCI6XCImbHQ7XCIsXCI+XCI6XCImZ3Q7XCIsJ1wiJzpcIiZxdW90O1wiLFwiJ1wiOlwiJiN4Mjc7XCIsXCJgXCI6XCImI3g2MDtcIn0sVD1tLmludmVydChCKSxSPWZ1bmN0aW9uKG4pe3ZhciB0PWZ1bmN0aW9uKHQpe3JldHVybiBuW3RdfSxyPVwiKD86XCIrbS5rZXlzKG4pLmpvaW4oXCJ8XCIpK1wiKVwiLGU9UmVnRXhwKHIpLHU9UmVnRXhwKHIsXCJnXCIpO3JldHVybiBmdW5jdGlvbihuKXtyZXR1cm4gbj1udWxsPT1uP1wiXCI6XCJcIituLGUudGVzdChuKT9uLnJlcGxhY2UodSx0KTpufX07bS5lc2NhcGU9UihCKSxtLnVuZXNjYXBlPVIoVCksbS5yZXN1bHQ9ZnVuY3Rpb24obix0LHIpe3ZhciBlPW51bGw9PW4/dm9pZCAwOm5bdF07cmV0dXJuIGU9PT12b2lkIDAmJihlPXIpLG0uaXNGdW5jdGlvbihlKT9lLmNhbGwobik6ZX07dmFyIHE9MDttLnVuaXF1ZUlkPWZ1bmN0aW9uKG4pe3ZhciB0PSsrcStcIlwiO3JldHVybiBuP24rdDp0fSxtLnRlbXBsYXRlU2V0dGluZ3M9e2V2YWx1YXRlOi88JShbXFxzXFxTXSs/KSU+L2csaW50ZXJwb2xhdGU6LzwlPShbXFxzXFxTXSs/KSU+L2csZXNjYXBlOi88JS0oW1xcc1xcU10rPyklPi9nfTt2YXIgSz0vKC4pXi8sej17XCInXCI6XCInXCIsXCJcXFxcXCI6XCJcXFxcXCIsXCJcXHJcIjpcInJcIixcIlxcblwiOlwiblwiLFwiXFx1MjAyOFwiOlwidTIwMjhcIixcIlxcdTIwMjlcIjpcInUyMDI5XCJ9LEQ9L1xcXFx8J3xcXHJ8XFxufFxcdTIwMjh8XFx1MjAyOS9nLEw9ZnVuY3Rpb24obil7cmV0dXJuXCJcXFxcXCIreltuXX07bS50ZW1wbGF0ZT1mdW5jdGlvbihuLHQscil7IXQmJnImJih0PXIpLHQ9bS5kZWZhdWx0cyh7fSx0LG0udGVtcGxhdGVTZXR0aW5ncyk7dmFyIGU9UmVnRXhwKFsodC5lc2NhcGV8fEspLnNvdXJjZSwodC5pbnRlcnBvbGF0ZXx8Sykuc291cmNlLCh0LmV2YWx1YXRlfHxLKS5zb3VyY2VdLmpvaW4oXCJ8XCIpK1wifCRcIixcImdcIiksdT0wLGk9XCJfX3ArPSdcIjtuLnJlcGxhY2UoZSxmdW5jdGlvbih0LHIsZSxvLGEpe3JldHVybiBpKz1uLnNsaWNlKHUsYSkucmVwbGFjZShELEwpLHU9YSt0Lmxlbmd0aCxyP2krPVwiJytcXG4oKF9fdD0oXCIrcitcIikpPT1udWxsPycnOl8uZXNjYXBlKF9fdCkpK1xcbidcIjplP2krPVwiJytcXG4oKF9fdD0oXCIrZStcIikpPT1udWxsPycnOl9fdCkrXFxuJ1wiOm8mJihpKz1cIic7XFxuXCIrbytcIlxcbl9fcCs9J1wiKSx0fSksaSs9XCInO1xcblwiLHQudmFyaWFibGV8fChpPVwid2l0aChvYmp8fHt9KXtcXG5cIitpK1wifVxcblwiKSxpPVwidmFyIF9fdCxfX3A9JycsX19qPUFycmF5LnByb3RvdHlwZS5qb2luLFwiK1wicHJpbnQ9ZnVuY3Rpb24oKXtfX3ArPV9fai5jYWxsKGFyZ3VtZW50cywnJyk7fTtcXG5cIitpK1wicmV0dXJuIF9fcDtcXG5cIjt0cnl7dmFyIG89bmV3IEZ1bmN0aW9uKHQudmFyaWFibGV8fFwib2JqXCIsXCJfXCIsaSl9Y2F0Y2goYSl7dGhyb3cgYS5zb3VyY2U9aSxhfXZhciBjPWZ1bmN0aW9uKG4pe3JldHVybiBvLmNhbGwodGhpcyxuLG0pfSxmPXQudmFyaWFibGV8fFwib2JqXCI7cmV0dXJuIGMuc291cmNlPVwiZnVuY3Rpb24oXCIrZitcIil7XFxuXCIraStcIn1cIixjfSxtLmNoYWluPWZ1bmN0aW9uKG4pe3ZhciB0PW0obik7cmV0dXJuIHQuX2NoYWluPSEwLHR9O3ZhciBQPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG4uX2NoYWluP20odCkuY2hhaW4oKTp0fTttLm1peGluPWZ1bmN0aW9uKG4pe20uZWFjaChtLmZ1bmN0aW9ucyhuKSxmdW5jdGlvbih0KXt2YXIgcj1tW3RdPW5bdF07bS5wcm90b3R5cGVbdF09ZnVuY3Rpb24oKXt2YXIgbj1bdGhpcy5fd3JhcHBlZF07cmV0dXJuIGYuYXBwbHkobixhcmd1bWVudHMpLFAodGhpcyxyLmFwcGx5KG0sbikpfX0pfSxtLm1peGluKG0pLG0uZWFjaChbXCJwb3BcIixcInB1c2hcIixcInJldmVyc2VcIixcInNoaWZ0XCIsXCJzb3J0XCIsXCJzcGxpY2VcIixcInVuc2hpZnRcIl0sZnVuY3Rpb24obil7dmFyIHQ9b1tuXTttLnByb3RvdHlwZVtuXT1mdW5jdGlvbigpe3ZhciByPXRoaXMuX3dyYXBwZWQ7cmV0dXJuIHQuYXBwbHkocixhcmd1bWVudHMpLFwic2hpZnRcIiE9PW4mJlwic3BsaWNlXCIhPT1ufHwwIT09ci5sZW5ndGh8fGRlbGV0ZSByWzBdLFAodGhpcyxyKX19KSxtLmVhY2goW1wiY29uY2F0XCIsXCJqb2luXCIsXCJzbGljZVwiXSxmdW5jdGlvbihuKXt2YXIgdD1vW25dO20ucHJvdG90eXBlW25dPWZ1bmN0aW9uKCl7cmV0dXJuIFAodGhpcyx0LmFwcGx5KHRoaXMuX3dyYXBwZWQsYXJndW1lbnRzKSl9fSksbS5wcm90b3R5cGUudmFsdWU9ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5fd3JhcHBlZH0sbS5wcm90b3R5cGUudmFsdWVPZj1tLnByb3RvdHlwZS50b0pTT049bS5wcm90b3R5cGUudmFsdWUsbS5wcm90b3R5cGUudG9TdHJpbmc9ZnVuY3Rpb24oKXtyZXR1cm5cIlwiK3RoaXMuX3dyYXBwZWR9LFwiZnVuY3Rpb25cIj09dHlwZW9mIGRlZmluZSYmZGVmaW5lLmFtZCYmZGVmaW5lKFwidW5kZXJzY29yZVwiLFtdLGZ1bmN0aW9uKCl7cmV0dXJuIG19KX0pLmNhbGwodGhpcyk7Il19
