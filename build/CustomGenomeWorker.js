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
    viewAsPairs: false
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
  
  // TODO: We must note that when we change opts.viewAsPairs, we *need* to throw out this.data.pileup.
  // TODO: If the pairing interval changed, we should toss the entire cache and reset the RemoteTrack bins,
  //         and blow up the areaIndex.
  applyOpts: function() {
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
      data: {url: o.bigDataUrl},
      success: function(data) {
        var mappedReads = 0,
          maxItemsToDraw = _.max(_.values(o.drawLimit)),
          bamChrs = [],
          chrScheme, meanItemsPerBp;
        _.each(data.split("\n"), function(line) {
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
        self.data.info.meanItemsPerBp = meanItemsPerBp = mappedReads / self.browserOpts.genomeSize;
        self.data.info.meanItemLength = 100; // TODO: this is a total guess now, should grab this from some sampled reads.
        o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
        o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 2);
        
        // TODO: We should deactivate the pairing functionality of the PairedIntervalTree 
        //       if we don't see any paired reads in this BAM.
        //       If there is pairing, we need to tell the PairedIntervalTree what range of insert sizes
        //       should trigger pairing.
        self.data.cache.setPairingInterval(10, 5000);
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
        block.seq = feature.seq.slice(seqPos, seqPos + len);
        feature.blocks.push(block);
        refLen += len;
        seqPos += len;
      } else if (/^[ND]$/.test(op)) {
        // Skipped reference region, deletion from reference
        refLen += len;
      } else if (op == 'I') {
        // Insertion
        insertion = {start: feature.start + refLen, end: feature.start + refLen};
        insertion.seq = feature.seq.slice(seqPos, seqPos + len);
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
            if (/[ACTGN]/.test(nt)) { pileup[i][nt] += 1; }
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
      split, refNt, i, pileupAtPos;
      
    for (i = 0; i < sequence.length; i++) {
      refNt = sequence[i].toUpperCase();
      pileupAtPos = pileup[start + i];
      if (pileupAtPos && pileupAtPos.cov && pileupAtPos[refNt] / pileupAtPos.cov < (1 - alleleFreqThreshold)) {
        split = {
          x: i / bppp,
          splits: []
        };
        _.each(['A', 'C', 'G', 'T'], function(nt) {
          if (pileupAtPos[nt] > 0) { split.splits.push({nt: nt, h: pileupAtPos[nt] / vScale}); }
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
    function yesNo(bool) { return bool ? "yes" : "no"; }
    var content = {
        "position": data.d.rname + ':' + data.d.pos,
        "cigar": data.d.cigar,
        "read strand": data.d.flags.readStrandReverse ? '(-)' : '(+)',
        "mapped": yesNo(!data.d.flags.isReadUnmapped),
        "map quality": data.d.mapq,
        "secondary": yesNo(data.d.flags.isSecondaryAlignment),
        "supplementary": yesNo(data.d.flags.isSupplementaryAlignment),
        "duplicate": yesNo(data.d.flags.isDuplicateRead),
        "failed QC": yesNo(data.d.flags.isReadFailingVendorQC),
        "tlen": data.d.tlen,
        "drawAsMates": data.d.drawAsMates || 'false',
        "mateExpected": data.d.mateExpected || 'false', 
        "mate": data.d.mate && data.d.mate.pos || 'null'
      };
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
      tipTipData = tipTipDataCallback(data);
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
        // Has to be by id, to avoid circular references (prevents serialization). This is the id used by this.unpaired.
        data.mate = potentialMate.id;
      }
    }
    
    // Are the mated reads within drawable range? If so, simply flag that they should be drawn together, and they will
    if (pairingState === PAIRING_DRAW_AS_MATES) {
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
  inferredInsertSize = itvlIsLater ? itvl.start - potentialMate.end : potentialMate.start - itvl.end;
  
  // Check that the alignments are --> <--
  if (itvlIsLater) {
    if (!itvl.flags.readStrandReverse || itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (potentialMate.flags.readStrandReverse || !potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  } else {
    if (itvl.flags.readStrandReverse || !itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (!potentialMate.flags.readStrandReverse || potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  }
  
  // Check that the inferredInsertSize is within the acceptable range.
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
// Underscore.js 1.2.3
// (c) 2009-2011 Jeremy Ashkenas, DocumentCloud Inc.
// Underscore is freely distributable under the MIT license.
// Portions of Underscore are inspired or borrowed from Prototype,
// Oliver Steele's Functional, and John Resig's Micro-Templating.
// For all details and documentation:
// http://documentcloud.github.com/underscore
(function(){function r(a,c,d){if(a===c)return a!==0||1/a==1/c;if(a==null||c==null)return a===c;if(a._chain)a=a._wrapped;if(c._chain)c=c._wrapped;if(a.isEqual&&b.isFunction(a.isEqual))return a.isEqual(c);if(c.isEqual&&b.isFunction(c.isEqual))return c.isEqual(a);var e=l.call(a);if(e!=l.call(c))return false;switch(e){case "[object String]":return a==String(c);case "[object Number]":return a!=+a?c!=+c:a==0?1/a==1/c:a==+c;case "[object Date]":case "[object Boolean]":return+a==+c;case "[object RegExp]":return a.source==
c.source&&a.global==c.global&&a.multiline==c.multiline&&a.ignoreCase==c.ignoreCase}if(typeof a!="object"||typeof c!="object")return false;for(var f=d.length;f--;)if(d[f]==a)return true;d.push(a);var f=0,g=true;if(e=="[object Array]"){if(f=a.length,g=f==c.length)for(;f--;)if(!(g=f in a==f in c&&r(a[f],c[f],d)))break}else{if("constructor"in a!="constructor"in c||a.constructor!=c.constructor)return false;for(var h in a)if(m.call(a,h)&&(f++,!(g=m.call(c,h)&&r(a[h],c[h],d))))break;if(g){for(h in c)if(m.call(c,
h)&&!f--)break;g=!f}}d.pop();return g}var s=this,F=s._,o={},k=Array.prototype,p=Object.prototype,i=k.slice,G=k.concat,H=k.unshift,l=p.toString,m=p.hasOwnProperty,v=k.forEach,w=k.map,x=k.reduce,y=k.reduceRight,z=k.filter,A=k.every,B=k.some,q=k.indexOf,C=k.lastIndexOf,p=Array.isArray,I=Object.keys,t=Function.prototype.bind,b=function(a){return new n(a)};if(typeof exports!=="undefined"){if(typeof module!=="undefined"&&module.exports)exports=module.exports=b;exports._=b}else typeof define==="function"&&
define.amd?define("underscore",function(){return b}):s._=b;b.VERSION="1.2.3";var j=b.each=b.forEach=function(a,c,b){if(a!=null)if(v&&a.forEach===v)a.forEach(c,b);else if(a.length===+a.length)for(var e=0,f=a.length;e<f;e++){if(e in a&&c.call(b,a[e],e,a)===o)break}else for(e in a)if(m.call(a,e)&&c.call(b,a[e],e,a)===o)break};b.map=function(a,c,b){var e=[];if(a==null)return e;if(w&&a.map===w)return a.map(c,b);j(a,function(a,g,h){e[e.length]=c.call(b,a,g,h)});return e};b.reduce=b.foldl=b.inject=function(a,
c,d,e){var f=arguments.length>2;a==null&&(a=[]);if(x&&a.reduce===x)return e&&(c=b.bind(c,e)),f?a.reduce(c,d):a.reduce(c);j(a,function(a,b,i){f?d=c.call(e,d,a,b,i):(d=a,f=true)});if(!f)throw new TypeError("Reduce of empty array with no initial value");return d};b.reduceRight=b.foldr=function(a,c,d,e){var f=arguments.length>2;a==null&&(a=[]);if(y&&a.reduceRight===y)return e&&(c=b.bind(c,e)),f?a.reduceRight(c,d):a.reduceRight(c);var g=b.toArray(a).reverse();e&&!f&&(c=b.bind(c,e));return f?b.reduce(g,
c,d,e):b.reduce(g,c)};b.find=b.detect=function(a,c,b){var e;D(a,function(a,g,h){if(c.call(b,a,g,h))return e=a,true});return e};b.filter=b.select=function(a,c,b){var e=[];if(a==null)return e;if(z&&a.filter===z)return a.filter(c,b);j(a,function(a,g,h){c.call(b,a,g,h)&&(e[e.length]=a)});return e};b.reject=function(a,c,b){var e=[];if(a==null)return e;j(a,function(a,g,h){c.call(b,a,g,h)||(e[e.length]=a)});return e};b.every=b.all=function(a,c,b){var e=true;if(a==null)return e;if(A&&a.every===A)return a.every(c,
b);j(a,function(a,g,h){if(!(e=e&&c.call(b,a,g,h)))return o});return e};var D=b.some=b.any=function(a,c,d){c||(c=b.identity);var e=false;if(a==null)return e;if(B&&a.some===B)return a.some(c,d);j(a,function(a,b,h){if(e||(e=c.call(d,a,b,h)))return o});return!!e};b.include=b.contains=function(a,c){var b=false;if(a==null)return b;return q&&a.indexOf===q?a.indexOf(c)!=-1:b=D(a,function(a){return a===c})};b.invoke=function(a,c){var d=i.call(arguments,2);return b.map(a,function(a){return(c.call?c||a:a[c]).apply(a,
d)})};b.pluck=function(a,c){return b.map(a,function(a){return a[c]})};b.max=function(a,c,d){if(!c&&b.isArray(a))return Math.max.apply(Math,a);if(!c&&b.isEmpty(a))return-Infinity;var e={computed:-Infinity};j(a,function(a,b,h){b=c?c.call(d,a,b,h):a;b>=e.computed&&(e={value:a,computed:b})});return e.value};b.min=function(a,c,d){if(!c&&b.isArray(a))return Math.min.apply(Math,a);if(!c&&b.isEmpty(a))return Infinity;var e={computed:Infinity};j(a,function(a,b,h){b=c?c.call(d,a,b,h):a;b<e.computed&&(e={value:a,
computed:b})});return e.value};b.shuffle=function(a){var c=[],b;j(a,function(a,f){f==0?c[0]=a:(b=Math.floor(Math.random()*(f+1)),c[f]=c[b],c[b]=a)});return c};b.sortBy=function(a,c,d){return b.pluck(b.map(a,function(a,b,g){return{value:a,criteria:c.call(d,a,b,g)}}).sort(function(a,c){var b=a.criteria,d=c.criteria;return b<d?-1:b>d?1:0}),"value")};b.groupBy=function(a,c){var d={},e=b.isFunction(c)?c:function(a){return a[c]};j(a,function(a,b){var c=e(a,b);(d[c]||(d[c]=[])).push(a)});return d};b.sortedIndex=
function(a,c,d){d||(d=b.identity);for(var e=0,f=a.length;e<f;){var g=e+f>>1;d(a[g])<d(c)?e=g+1:f=g}return e};b.toArray=function(a){return!a?[]:a.toArray?a.toArray():b.isArray(a)?i.call(a):b.isArguments(a)?i.call(a):b.values(a)};b.size=function(a){return b.toArray(a).length};b.first=b.head=function(a,b,d){return b!=null&&!d?i.call(a,0,b):a[0]};b.initial=function(a,b,d){return i.call(a,0,a.length-(b==null||d?1:b))};b.last=function(a,b,d){return b!=null&&!d?i.call(a,Math.max(a.length-b,0)):a[a.length-
1]};b.rest=b.tail=function(a,b,d){return i.call(a,b==null||d?1:b)};b.compact=function(a){return b.filter(a,function(a){return!!a})};b.flatten=function(a,c){return b.reduce(a,function(a,e){if(b.isArray(e))return a.concat(c?e:b.flatten(e));a[a.length]=e;return a},[])};b.without=function(a){return b.difference(a,i.call(arguments,1))};b.uniq=b.unique=function(a,c,d){var d=d?b.map(a,d):a,e=[];b.reduce(d,function(d,g,h){if(0==h||(c===true?b.last(d)!=g:!b.include(d,g)))d[d.length]=g,e[e.length]=a[h];return d},
[]);return e};b.union=function(){return b.uniq(b.flatten(arguments,true))};b.intersection=b.intersect=function(a){var c=i.call(arguments,1);return b.filter(b.uniq(a),function(a){return b.every(c,function(c){return b.indexOf(c,a)>=0})})};b.difference=function(a){var c=b.flatten(i.call(arguments,1));return b.filter(a,function(a){return!b.include(c,a)})};b.zip=function(){for(var a=i.call(arguments),c=b.max(b.pluck(a,"length")),d=Array(c),e=0;e<c;e++)d[e]=b.pluck(a,""+e);return d};b.indexOf=function(a,
c,d){if(a==null)return-1;var e;if(d)return d=b.sortedIndex(a,c),a[d]===c?d:-1;if(q&&a.indexOf===q)return a.indexOf(c);for(d=0,e=a.length;d<e;d++)if(d in a&&a[d]===c)return d;return-1};b.lastIndexOf=function(a,b){if(a==null)return-1;if(C&&a.lastIndexOf===C)return a.lastIndexOf(b);for(var d=a.length;d--;)if(d in a&&a[d]===b)return d;return-1};b.range=function(a,b,d){arguments.length<=1&&(b=a||0,a=0);for(var d=arguments[2]||1,e=Math.max(Math.ceil((b-a)/d),0),f=0,g=Array(e);f<e;)g[f++]=a,a+=d;return g};
var E=function(){};b.bind=function(a,c){var d,e;if(a.bind===t&&t)return t.apply(a,i.call(arguments,1));if(!b.isFunction(a))throw new TypeError;e=i.call(arguments,2);return d=function(){if(!(this instanceof d))return a.apply(c,e.concat(i.call(arguments)));E.prototype=a.prototype;var b=new E,g=a.apply(b,e.concat(i.call(arguments)));return Object(g)===g?g:b}};b.bindAll=function(a){var c=i.call(arguments,1);c.length==0&&(c=b.functions(a));j(c,function(c){a[c]=b.bind(a[c],a)});return a};b.memoize=function(a,
c){var d={};c||(c=b.identity);return function(){var b=c.apply(this,arguments);return m.call(d,b)?d[b]:d[b]=a.apply(this,arguments)}};b.delay=function(a,b){var d=i.call(arguments,2);return setTimeout(function(){return a.apply(a,d)},b)};b.defer=function(a){return b.delay.apply(b,[a,1].concat(i.call(arguments,1)))};b.throttle=function(a,c){var d,e,f,g,h,i=b.debounce(function(){h=g=false},c);return function(){d=this;e=arguments;var b;f||(f=setTimeout(function(){f=null;h&&a.apply(d,e);i()},c));g?h=true:
a.apply(d,e);i();g=true}};b.debounce=function(a,b){var d;return function(){var e=this,f=arguments;clearTimeout(d);d=setTimeout(function(){d=null;a.apply(e,f)},b)}};b.once=function(a){var b=false,d;return function(){if(b)return d;b=true;return d=a.apply(this,arguments)}};b.wrap=function(a,b){return function(){var d=G.apply([a],arguments);return b.apply(this,d)}};b.compose=function(){var a=arguments;return function(){for(var b=arguments,d=a.length-1;d>=0;d--)b=[a[d].apply(this,b)];return b[0]}};b.after=
function(a,b){return a<=0?b():function(){if(--a<1)return b.apply(this,arguments)}};b.keys=I||function(a){if(a!==Object(a))throw new TypeError("Invalid object");var b=[],d;for(d in a)m.call(a,d)&&(b[b.length]=d);return b};b.values=function(a){return b.map(a,b.identity)};b.functions=b.methods=function(a){var c=[],d;for(d in a)b.isFunction(a[d])&&c.push(d);return c.sort()};b.extend=function(a){j(i.call(arguments,1),function(b){for(var d in b)b[d]!==void 0&&(a[d]=b[d])});return a};b.defaults=function(a){j(i.call(arguments,
1),function(b){for(var d in b)a[d]==null&&(a[d]=b[d])});return a};b.clone=function(a){return!b.isObject(a)?a:b.isArray(a)?a.slice():b.extend({},a)};b.tap=function(a,b){b(a);return a};b.isEqual=function(a,b){return r(a,b,[])};b.isEmpty=function(a){if(b.isArray(a)||b.isString(a))return a.length===0;for(var c in a)if(m.call(a,c))return false;return true};b.isElement=function(a){return!!(a&&a.nodeType==1)};b.isArray=p||function(a){return l.call(a)=="[object Array]"};b.isObject=function(a){return a===
Object(a)};b.isArguments=function(a){return l.call(a)=="[object Arguments]"};if(!b.isArguments(arguments))b.isArguments=function(a){return!(!a||!m.call(a,"callee"))};b.isFunction=function(a){return l.call(a)=="[object Function]"};b.isString=function(a){return l.call(a)=="[object String]"};b.isNumber=function(a){return l.call(a)=="[object Number]"};b.isNaN=function(a){return a!==a};b.isBoolean=function(a){return a===true||a===false||l.call(a)=="[object Boolean]"};b.isDate=function(a){return l.call(a)==
"[object Date]"};b.isRegExp=function(a){return l.call(a)=="[object RegExp]"};b.isNull=function(a){return a===null};b.isUndefined=function(a){return a===void 0};b.noConflict=function(){s._=F;return this};b.identity=function(a){return a};b.times=function(a,b,d){for(var e=0;e<a;e++)b.call(d,e)};b.escape=function(a){return(""+a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").replace(/\//g,"&#x2F;")};b.mixin=function(a){j(b.functions(a),function(c){J(c,
b[c]=a[c])})};var K=0;b.uniqueId=function(a){var b=K++;return a?a+b:b};b.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};b.template=function(a,c){var d=b.templateSettings,d="var __p=[],print=function(){__p.push.apply(__p,arguments);};with(obj||{}){__p.push('"+a.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(d.escape,function(a,b){return"',_.escape("+b.replace(/\\'/g,"'")+"),'"}).replace(d.interpolate,function(a,b){return"',"+b.replace(/\\'/g,
"'")+",'"}).replace(d.evaluate||null,function(a,b){return"');"+b.replace(/\\'/g,"'").replace(/[\r\n\t]/g," ")+";__p.push('"}).replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t")+"');}return __p.join('');",e=new Function("obj","_",d);return c?e(c,b):function(a){return e.call(this,a,b)}};var n=function(a){this._wrapped=a};b.prototype=n.prototype;var u=function(a,c){return c?b(a).chain():a},J=function(a,c){n.prototype[a]=function(){var a=i.call(arguments);H.call(a,this._wrapped);return u(c.apply(b,
a),this._chain)}};b.mixin(b);j("pop,push,reverse,shift,sort,splice,unshift".split(","),function(a){var b=k[a];n.prototype[a]=function(){b.apply(this._wrapped,arguments);return u(this._wrapped,this._chain)}});j(["concat","join","slice"],function(a){var b=k[a];n.prototype[a]=function(){return u(b.apply(this._wrapped,arguments),this._chain)}});n.prototype.chain=function(){this._chain=true;return this};n.prototype.value=function(){return this._wrapped}}).call(this);
},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdnFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN6SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUMzUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBDdXN0b21HZW5vbWUgcmVwcmVzZW50cyBhIGdlbm9tZSBzcGVjaWZpY2F0aW9uIHRoYXQgY2FuIHByb2R1Y2Ugb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpIHtcblxudmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL3V0aWxzL3V0aWxzLmpzJyksXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZSxcbiAgbG9nMTAgPSB1dGlscy5sb2cxMCxcbiAgcm91bmRUb1BsYWNlcyA9IHV0aWxzLnJvdW5kVG9QbGFjZXM7XG5cbmZ1bmN0aW9uIEN1c3RvbUdlbm9tZShnaXZlbkZvcm1hdCwgbWV0YWRhdGEpIHsgICAgXG4gIC8vIGdpdmVuRm9ybWF0ID0gZmFsc2UgLS0+IHRoaXMgaXMgYW4gZW1wdHkgQ3VzdG9tR2Vub21lIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgaWYgKGdpdmVuRm9ybWF0ID09PSBmYWxzZSkgeyByZXR1cm47IH0gXG4gIFxuICB0aGlzLl9wYXJzZWQgPSBmYWxzZTtcbiAgdGhpcy5fZm9ybWF0ID0gKGdpdmVuRm9ybWF0ICYmIGdpdmVuRm9ybWF0LnRvTG93ZXJDYXNlKCkpIHx8IFwiY2hyb21zaXplc1wiO1xuICB2YXIgZm9ybWF0ID0gdGhpcy5mb3JtYXQoKTtcbiAgaWYgKGZvcm1hdCA9PT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBnZW5vbWUgZm9ybWF0ICdcIitmb3JtYXQrXCInIGVuY291bnRlcmVkXCIpOyB9XG4gIFxuICAvLyB0aGlzLm9wdHMgaG9sZHMgZXZlcnl0aGluZyB0aGF0ICQudWkuZ2Vub2Jyb3dzZXIgd2lsbCBuZWVkIHRvIGNvbnN0cnVjdCBhIHZpZXcgKHNlZSBDdXN0b21HZW5vbWUuZGVmYXVsdHMgYmVsb3cpXG4gIC8vIGl0IERPRVMgTk9UIHJlbGF0ZSB0byBcIm9wdGlvbnNcIiBmb3IgcGFyc2luZywgb3IgaG93IHRoZSBnZW5vbWUgaXMgYmVpbmcgaW50ZXJwcmV0ZWQsIG9yIGFueXRoaW5nIGxpa2UgdGhhdFxuICB0aGlzLm9wdHMgPSBfLmV4dGVuZCh7fSwgZGVlcENsb25lKHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMpLCBkZWVwQ2xvbmUoZm9ybWF0LmRlZmF1bHRzIHx8IHt9KSk7XG4gIFxuICAvLyB0aGlzLm1ldGFkYXRhIGhvbGRzIGluZm9ybWF0aW9uIGV4dGVybmFsIHRvIHRoZSBwYXJzZWQgdGV4dCBwYXNzZWQgaW4gZnJvbSB0aGUgYnJvd3NlciAoZS5nLiBmaWxlbmFtZSwgc291cmNlKVxuICB0aGlzLm1ldGFkYXRhID0gbWV0YWRhdGE7XG4gIFxuICAvLyB0aGlzLmRhdGEgaG9sZHMgYW55dGhpbmcgYWRkaXRpb25hbGx5IHBhcnNlZCBmcm9tIHRoZSBnZW5vbWUgZmlsZSAobWV0YWRhdGEsIHJlZmVyZW5jZXMsIGV0Yy4pXG4gIC8vIHR5cGljYWxseSB0aGlzIGlzIGFycmFuZ2VkIHBlciBjb250aWcsIGluIHRoZSBhcnJhbmdlbWVudCBvZiB0aGlzLmRhdGEuY29udGlnc1tpXS4gLi4uXG4gIHRoaXMuZGF0YSA9IHtcbiAgICBzZXF1ZW5jZTogXCJcIiAvLyB0aGUgZnVsbCBjb25jYXRlbmF0ZWQgc2VxdWVuY2UgZm9yIGFsbCBjb250aWdzIGluIHRoaXMgZ2Vub21lLCBpZiBhdmFpbGFibGVcbiAgfTtcbiAgXG4gIC8vIGNhbiB3ZSBjYWxsIC5nZXRTZXF1ZW5jZSBvbiB0aGlzIEN1c3RvbUdlbm9tZT9cbiAgdGhpcy5jYW5HZXRTZXF1ZW5jZSA9IGZhbHNlO1xuICBcbiAgaWYoZm9ybWF0LmluaXQpIHsgZm9ybWF0LmluaXQuY2FsbCh0aGlzKTsgfVxufVxuXG5DdXN0b21HZW5vbWUuZGVmYXVsdHMgPSB7XG4gIC8vIFRoZSBmb2xsb3dpbmcga2V5cyBzaG91bGQgYmUgb3ZlcnJpZGRlbiB3aGlsZSBwYXJzaW5nIHRoZSBnZW5vbWUgZmlsZVxuICBnZW5vbWU6ICdfYmxhbmsnLFxuICBzcGVjaWVzOiAnQmxhbmsgR2Vub21lJyxcbiAgYXNzZW1ibHlEYXRlOiAnJyxcbiAgdGlsZURpcjogbnVsbCxcbiAgb3Zlcnpvb21CcHBwczogW10sXG4gIG50c0JlbG93OiBbMSwgMC4xXSxcbiAgYXZhaWxUcmFja3M6IFtcbiAgICB7XG4gICAgICBmaDoge30sICAgICAgICAvLyBcImZpeGVkIGhlaWdodHNcIiBhYm92ZSB3aGljaCBhIGRlbnNpdHkgaXMgZm9yY2VkIHRvIGRpc3BsYXkgYWJvdmUgYSBjZXJ0YWluIHRyYWNrIGhlaWdodFxuICAgICAgICAgICAgICAgICAgICAgLy8gICAgZm9ybWF0dGVkIGxpa2Uge1wiMS4wMGUrMDVcIjp7XCJkZW5zZVwiOjE1fX1cbiAgICAgIG46IFwicnVsZXJcIiwgICAgLy8gc2hvcnQgdW5pcXVlIG5hbWUgZm9yIHRoZSB0cmFja1xuICAgICAgczogW1wiZGVuc2VcIl0sICAvLyBwb3NzaWJsZSBkZW5zaXRpZXMgZm9yIHRpbGVzLCBlLmcuIFtcImRlbnNlXCIsIFwic3F1aXNoXCIsIFwicGFja1wiXVxuICAgICAgaDogMjUgICAgICAgICAgLy8gc3RhcnRpbmcgaGVpZ2h0IGluIHB4XG4gICAgfVxuICBdLFxuICBnZW5vbWVTaXplOiAwLFxuICBjaHJMZW5ndGhzOiB7fSxcbiAgY2hyT3JkZXI6IFtdLFxuICBjaHJCYW5kczogbnVsbCxcbiAgdGlsZVdpZHRoOiAxMDAwLFxuICBzdWJkaXJGb3JCcHBwc1VuZGVyOiAzMzAsXG4gIGlkZW9ncmFtc0Fib3ZlOiAxMDAwLFxuICBtYXhOdFJlcXVlc3Q6IDIwMDAwLFxuICB0cmFja3M6IFt7bjogXCJydWxlclwifV0sXG4gIHRyYWNrRGVzYzoge1xuICAgIHJ1bGVyOiB7XG4gICAgICBjYXQ6IFwiTWFwcGluZyBhbmQgU2VxdWVuY2luZyBUcmFja3NcIixcbiAgICAgIHNtOiBcIkJhc2UgUG9zaXRpb25cIlxuICAgIH1cbiAgfSxcbiAgLy8gVGhlc2UgbGFzdCB0aHJlZSB3aWxsIGJlIG92ZXJyaWRkZW4gdXNpbmcga25vd2xlZGdlIG9mIHRoZSB3aW5kb3cncyB3aWR0aFxuICBicHBwczogW10sXG4gIGJwcHBOdW1iZXJzQmVsb3c6IFtdLFxuICBpbml0Wm9vbTogbnVsbFxufTtcblxuQ3VzdG9tR2Vub21lLmZvcm1hdHMgPSB7XG4gIGNocm9tc2l6ZXM6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvY2hyb21zaXplcy5qcycpLFxuICBmYXN0YTogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9mYXN0YS5qcycpLFxuICBnZW5iYW5rOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMnKSxcbiAgZW1ibDogbnVsbCAvLyBUT0RPLiBCYXNpY2FsbHkgZ2VuYmFuayB3aXRoIGV4dHJhIGNvbHVtbnMuXG59XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JtYXQoKS5wYXJzZS5hcHBseSh0aGlzLCBfLnRvQXJyYXkoYXJndW1lbnRzKSk7XG4gIHRoaXMuc2V0R2Vub21lU3RyaW5nKCk7XG4gIHRoaXMuX3BhcnNlZCA9IHRydWU7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmZvcm1hdCA9IGZ1bmN0aW9uKGZvcm1hdCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChfLmlzVW5kZWZpbmVkKGZvcm1hdCkpIHsgZm9ybWF0ID0gc2VsZi5fZm9ybWF0OyB9XG4gIHZhciBGb3JtYXRXcmFwcGVyID0gZnVuY3Rpb24oKSB7IF8uZXh0ZW5kKHRoaXMsIHNlbGYuY29uc3RydWN0b3IuZm9ybWF0c1tmb3JtYXRdKTsgcmV0dXJuIHRoaXM7IH07XG4gIEZvcm1hdFdyYXBwZXIucHJvdG90eXBlID0gc2VsZjtcbiAgcmV0dXJuIG5ldyBGb3JtYXRXcmFwcGVyKCk7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEdlbm9tZVN0cmluZyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgbyA9IHNlbGYub3B0cyxcbiAgICBleGNlcHRpb25zID0gWydmaWxlJywgJ2lnYicsICdhY2MnLCAndXJsJywgJ3Vjc2MnXSxcbiAgICBleGNlcHRpb24gPSBfLmZpbmQoZXhjZXB0aW9ucywgZnVuY3Rpb24odikgeyByZXR1cm4gIV8uaXNVbmRlZmluZWQoc2VsZi5tZXRhZGF0YVt2XSk7IH0pLFxuICAgIHBpZWNlcyA9IFtdO1xuICBpZiAoZXhjZXB0aW9uKSB7IG8uZ2Vub21lID0gZXhjZXB0aW9uICsgXCI6XCIgKyBzZWxmLm1ldGFkYXRhW2V4Y2VwdGlvbl07IH1cbiAgZWxzZSB7XG4gICAgcGllY2VzID0gWydjdXN0b20nICsgKHNlbGYubWV0YWRhdGEubmFtZSA/ICc6JyArIHNlbGYubWV0YWRhdGEubmFtZSA6ICcnKV07XG4gICAgXy5lYWNoKG8uY2hyT3JkZXIsIGZ1bmN0aW9uKGNocikge1xuICAgICAgcGllY2VzLnB1c2goY2hyICsgJzonICsgby5jaHJMZW5ndGhzW2Nocl0pO1xuICAgIH0pO1xuICAgIG8uZ2Vub21lID0gcGllY2VzLmpvaW4oJ3wnKTtcbiAgfVxufTtcblxuLy8gU29tZSBvZiB0aGUgb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciAoYWxsIHIvdCB6b29tIGxldmVscykgbXVzdCBiZSBzZXQgYmFzZWQgb24gdGhlIHdpZHRoIG9mIHRoZSB3aW5kb3dcbi8vICAgVGhleSBhcmUgLmJwcHBzLCAuYnBwcE51bWJlcnNCZWxvdywgYW5kIC5pbml0Wm9vbVxuLy8gICBUaGV5IGRvIG5vdCBhZmZlY3QgYW55IG9mIHRoZSBvdGhlciBvcHRpb25zIHNldCBkdXJpbmcgcGFyc2luZy5cbi8vXG4vLyB3aW5kb3dPcHRzIE1VU1QgaW5jbHVkZSBhIHByb3BlcnR5LCAud2lkdGgsIHRoYXQgaXMgdGhlIHdpbmRvdy5pbm5lcldpZHRoXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEJwcHBzID0gZnVuY3Rpb24od2luZG93T3B0cykge1xuICB3aW5kb3dPcHRzID0gd2luZG93T3B0cyB8fCB7fTtcbiAgXG4gIHZhciBvID0gdGhpcy5vcHRzLFxuICAgIHdpbmRvd1dpZHRoID0gKHdpbmRvd09wdHMud2lkdGggKiAwLjYpIHx8IDEwMDAsXG4gICAgYnBwcCA9IE1hdGgucm91bmQoby5nZW5vbWVTaXplIC8gd2luZG93V2lkdGgpLFxuICAgIGxvd2VzdEJwcHAgPSB3aW5kb3dPcHRzLmxvd2VzdEJwcHAgfHwgMC4xLFxuICAgIG1heEJwcHBzID0gMTAwLFxuICAgIGJwcHBzID0gW10sIGkgPSAwLCBsb2c7XG4gIFxuICAvLyBjb21wYXJhYmxlIHRvIHBhcnQgb2YgVUNTQ0NsaWVudCNtYWtlX2NvbmZpZyBpbiBsaWIvdWNzY19zdGl0Y2gucmJcbiAgd2hpbGUgKGJwcHAgPj0gbG93ZXN0QnBwcCAmJiBpIDwgbWF4QnBwcHMpIHtcbiAgICBicHBwcy5wdXNoKGJwcHApO1xuICAgIGxvZyA9IHJvdW5kVG9QbGFjZXMobG9nMTAoYnBwcCksIDQpO1xuICAgIGJwcHAgPSAoTWF0aC5jZWlsKGxvZykgLSBsb2cgPCAwLjQ4MSkgPyAzLjMgKiBNYXRoLnBvdygxMCwgTWF0aC5jZWlsKGxvZykgLSAxKSA6IE1hdGgucG93KDEwLCBNYXRoLmZsb29yKGxvZykpO1xuICAgIGkrKztcbiAgfVxuICBvLmJwcHBzID0gYnBwcHM7XG4gIG8uYnBwcE51bWJlcnNCZWxvdyA9IGJwcHBzLnNsaWNlKDAsIDIpO1xuICBvLmluaXRab29tID0gYnBwcHNbMF07XG59O1xuXG4vLyBDb25zdHJ1Y3QgYSBjb21wbGV0ZSBjb25maWd1cmF0aW9uIGZvciAkLnVpLmdlbm9icm93c2VyIGJhc2VkIG9uIHRoZSBpbmZvcm1hdGlvbiBwYXJzZWQgZnJvbSB0aGUgZ2Vub21lIGZpbGVcbi8vIHdoaWNoIHNob3VsZCBiZSBtb3N0bHkgaW4gdGhpcy5vcHRzLCBleGNlcHRpbmcgdGhvc2UgcmVsYXRlZCB0byB6b29tIGxldmVscywgd2hpY2ggY2FuIGJlIHNldCBub3cuXG4vLyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBhYm92ZSBmb3Igd2hhdCBhIGJhc2UgY29uZmlndXJhdGlvbiBsb29rcyBsaWtlKVxuLy9cbi8vIHdpbmRvd09wdHMgTVVTVCBpbmNsdWRlIGluY2x1ZGUgdGhlIHByb3BlcnR5IC53aWR0aCB3aGljaCBpcyB0aGUgd2luZG93LmlubmVyV2lkdGhcbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUub3B0aW9ucyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgaWYgKCF0aGlzLl9wYXJzZWQpIHsgdGhyb3cgXCJDYW5ub3QgZ2VuZXJhdGUgb3B0aW9ucyBiZWZvcmUgcGFyc2luZyB0aGUgZ2Vub21lIGZpbGVcIjsgfVxuICB0aGlzLnNldEJwcHBzKHdpbmRvd09wdHMpO1xuICB0aGlzLm9wdHMuY3VzdG9tID0gdGhpczsgICAvLyBzYW1lIGNvbnZlbnRpb24gYXMgY3VzdG9tIHRyYWNrcyBpbiBzZWxmLmF2YWlsVHJhY2tzIGluIGNocm9tb3pvb20uanNcbiAgcmV0dXJuIHRoaXMub3B0cztcbn07XG5cbi8vIEZldGNoIHRoZSBzZXF1ZW5jZSwgaWYgYXZhaWxhYmxlLCBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0LCBhbmQgb3B0aW9uYWxseSBwYXNzIGl0IHRvIHRoZSBjYWxsYmFjay5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2UgPSBmdW5jdGlvbihsZWZ0LCByaWdodCwgY2FsbGJhY2spIHtcbiAgdmFyIHNlcSA9IHRoaXMuZGF0YS5zZXF1ZW5jZS5zdWJzdHJpbmcobGVmdCAtIDEsIHJpZ2h0IC0gMSk7XG4gIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soc2VxKSA6IHNlcTsgXG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMuYXN5bmModGhpcywgJ2dldFNlcXVlbmNlJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxucmV0dXJuIEN1c3RvbUdlbm9tZTtcblxufTsiLCJ2YXIgZ2xvYmFsID0gc2VsZjsgIC8vIGdyYWIgZ2xvYmFsIHNjb2xlIGZvciBXZWIgV29ya2Vyc1xucmVxdWlyZSgnLi9qcXVlcnkubm9kb20ubWluLmpzJykoZ2xvYmFsKTtcbmdsb2JhbC5fID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lcy5qcycpKGdsb2JhbCk7XG5cbmlmICghZ2xvYmFsLmNvbnNvbGUgfHwgIWdsb2JhbC5jb25zb2xlLmxvZykge1xuICBnbG9iYWwuY29uc29sZSA9IGdsb2JhbC5jb25zb2xlIHx8IHt9O1xuICBnbG9iYWwuY29uc29sZS5sb2cgPSBmdW5jdGlvbigpIHtcbiAgICBnbG9iYWwucG9zdE1lc3NhZ2Uoe2xvZzogSlNPTi5zdHJpbmdpZnkoXy50b0FycmF5KGFyZ3VtZW50cykpfSk7XG4gIH07XG59XG5cbnZhciBDdXN0b21HZW5vbWVXb3JrZXIgPSB7XG4gIF9nZW5vbWVzOiBbXSxcbiAgX3Rocm93RXJyb3JzOiBmYWxzZSxcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIG1ldGFkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lID0gQ3VzdG9tR2Vub21lcy5wYXJzZSh0ZXh0LCBtZXRhZGF0YSksXG4gICAgICBzZXJpYWxpemFibGU7XG4gICAgXG4gICAgLy8gd2Ugd2FudCB0byBrZWVwIHRoZSBnZW5vbWUgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgIC8vIGlzIHNlbnQgYmFjayBvdmVyIHRoZSBmZW5jZSwgc2luY2UgaXQgaXMgZXhwZW5zaXZlL2ltcG9zc2libGUgdG8gc2VyaWFsaXplXG4gICAgZ2Vub21lLmlkID0gc2VsZi5fZ2Vub21lcy5wdXNoKGdlbm9tZSkgLSAxO1xuICAgIFxuICAgIHNlcmlhbGl6YWJsZSA9IF8uZXh0ZW5kKHt9LCBnZW5vbWUpO1xuICAgIGRlbGV0ZSBzZXJpYWxpemFibGUuZGF0YTtcbiAgICByZXR1cm4gc2VyaWFsaXphYmxlO1xuICB9LFxuICBvcHRpb25zOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgZ2Vub21lID0gdGhpcy5fZ2Vub21lc1tpZF07XG4gICAgcmV0dXJuIGdlbm9tZS5vcHRpb25zLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgZ2V0U2VxdWVuY2U6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICBnZW5vbWUgPSB0aGlzLl9nZW5vbWVzW2lkXTtcbiAgICByZXR1cm4gZ2Vub21lLmdldFNlcXVlbmNlLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgdGhyb3dFcnJvcnM6IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgIHRoaXMuX3Rocm93RXJyb3JzID0gdG9nZ2xlO1xuICB9XG59O1xuXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGRhdGEgPSBlLmRhdGEsXG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbihyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIHJldDogSlNPTi5zdHJpbmdpZnkociB8fCBudWxsKX0pOyB9LFxuICAgIHJldDtcblxuICBpZiAoQ3VzdG9tR2Vub21lV29ya2VyLl90aHJvd0Vycm9ycykge1xuICAgIHJldCA9IEN1c3RvbUdlbm9tZVdvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21HZW5vbWVXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTtcbiAgfSBlbHNlIHtcbiAgICB0cnkgeyByZXQgPSBDdXN0b21HZW5vbWVXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tR2Vub21lV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3MpIHsgcmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpOyB9XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIGdlbm9tZSBvYmplY3RcbiAgdmFyIEN1c3RvbUdlbm9tZSA9IHJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lJykoZ2xvYmFsKTtcbiAgXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21HZW5vbWVzLCB0aGUgbW9kdWxlIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQgPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIEN1c3RvbUdlbm9tZSBvYmplY3RzIHRoYXQgY2FuIGRlbGVnYXRlIHRoZVxuICAvLyB3b3JrIG9mIHBhcnNpbmcgdG8gYSBXZWIgV29ya2VyIHRocmVhZC5cbiAgXG4gIHZhciBDdXN0b21HZW5vbWVzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbih0ZXh0LCBtZXRhZGF0YSkge1xuICAgICAgbWV0YWRhdGEgPSBtZXRhZGF0YSB8fCB7fTtcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7IG1ldGFkYXRhLmZvcm1hdCA9IHRoaXMuZ3Vlc3NGb3JtYXQodGV4dCk7IH1cbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKG1ldGFkYXRhLmZvcm1hdCwgbWV0YWRhdGEpO1xuICAgICAgZ2Vub21lLnBhcnNlKHRleHQpO1xuICAgICAgcmV0dXJuIGdlbm9tZTtcbiAgICB9LFxuICAgIFxuICAgIGJsYW5rOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKFwiY2hyb21zaXplc1wiLCB7c3BlY2llczogXCJCbGFuayBHZW5vbWVcIn0pO1xuICAgICAgZ2Vub21lLnBhcnNlKFwiYmxhbmtcXHQ1MDAwMFwiKTtcbiAgICAgIHJldHVybiBnZW5vbWU7XG4gICAgfSxcbiAgICBcbiAgICBndWVzc0Zvcm1hdDogZnVuY3Rpb24odGV4dCkge1xuICAgICAgaWYgKHRleHQuc3Vic3RyaW5nKDAsIDUpID09ICdMT0NVUycpIHsgcmV0dXJuIFwiZ2VuYmFua1wiOyB9XG4gICAgICBpZiAoL15bQS1aXXsyfSB7M30vLnRlc3QodGV4dCkpIHsgcmV0dXJuIFwiZW1ibFwiOyB9XG4gICAgICBpZiAoL15bPjtdLy50ZXN0KHRleHQpKSB7IHJldHVybiBcImZhc3RhXCI7IH1cbiAgICAgIC8vIGRlZmF1bHQgaXMgZmFzdGFcbiAgICAgIHJldHVybiBcImZhc3RhXCI7XG4gICAgfSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbUdlbm9tZVdvcmtlci5qcycsXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICB3b3JrZXI6IGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyLFxuICAgIFxuICAgIGFzeW5jOiBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jLFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbihnZW5vbWUpIHtcbiAgICAgICAgLy8gVGhpcyBoYXMgYmVlbiBzZXJpYWxpemVkLCBzbyBpdCBtdXN0IGJlIGh5ZHJhdGVkIGludG8gYSByZWFsIEN1c3RvbUdlbm9tZSBvYmplY3QuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLmdldFNlcXVlbmNlKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21HZW5vbWUoZmFsc2UpLCBnZW5vbWUsIHtcbiAgICAgICAgICBnZXRTZXF1ZW5jZTogZnVuY3Rpb24oKSB7IEN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2VBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuICBcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMgPSBDdXN0b21HZW5vbWVzO1xuICBcbn0pOyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbVRyYWNrLCBhbiBvYmplY3QgcmVwcmVzZW50aW5nIGEgY3VzdG9tIHRyYWNrIGFzIHVuZGVyc3Rvb2QgYnkgVUNTQy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBUaGlzIGNsYXNzICpkb2VzKiBkZXBlbmQgb24gZ2xvYmFsIG9iamVjdHMgYW5kIHRoZXJlZm9yZSBtdXN0IGJlIHJlcXVpcmVkIGFzIGEgXG4vLyBmdW5jdGlvbiB0aGF0IGlzIGV4ZWN1dGVkIG9uIHRoZSBnbG9iYWwgb2JqZWN0LlxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbmZ1bmN0aW9uIEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKSB7XG4gIGlmICghb3B0cykgeyByZXR1cm47IH0gLy8gVGhpcyBpcyBhbiBlbXB0eSBjdXN0b21UcmFjayB0aGF0IHdpbGwgYmUgaHlkcmF0ZWQgd2l0aCB2YWx1ZXMgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0XG4gIHRoaXMuX3R5cGUgPSAob3B0cy50eXBlICYmIG9wdHMudHlwZS50b0xvd2VyQ2FzZSgpKSB8fCBcImJlZFwiO1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAodHlwZSA9PT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCB0cmFjayB0eXBlICdcIitvcHRzLnR5cGUrXCInIGVuY291bnRlcmVkIG9uIGxpbmUgXCIgKyBvcHRzLmxpbmVOdW0pOyB9XG4gIHRoaXMub3B0cyA9IF8uZXh0ZW5kKHt9LCB0aGlzLmNvbnN0cnVjdG9yLmRlZmF1bHRzLCB0eXBlLmRlZmF1bHRzIHx8IHt9LCBvcHRzKTtcbiAgXy5leHRlbmQodGhpcywge1xuICAgIGJyb3dzZXJPcHRzOiBicm93c2VyT3B0cyxcbiAgICBzdHJldGNoSGVpZ2h0OiBmYWxzZSxcbiAgICBoZWlnaHRzOiB7fSxcbiAgICBzaXplczogWydkZW5zZSddLFxuICAgIG1hcFNpemVzOiBbXSxcbiAgICBhcmVhczoge30sXG4gICAgbm9BcmVhTGFiZWxzOiBmYWxzZSxcbiAgICBleHBlY3RzU2VxdWVuY2U6IGZhbHNlXG4gIH0pO1xuICB0aGlzLmluaXQoKTtcbn1cblxuQ3VzdG9tVHJhY2suZGVmYXVsdHMgPSB7XG4gIG5hbWU6ICdVc2VyIFRyYWNrJyxcbiAgZGVzY3JpcHRpb246ICdVc2VyIFN1cHBsaWVkIFRyYWNrJyxcbiAgY29sb3I6ICcwLDAsMCdcbn07XG5cbkN1c3RvbVRyYWNrLnR5cGVzID0ge1xuICBiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkLmpzJyksXG4gIGZlYXR1cmV0YWJsZTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9mZWF0dXJldGFibGUuanMnKSxcbiAgYmVkZ3JhcGg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkZ3JhcGguanMnKSxcbiAgd2lnZ2xlXzA6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMnKSxcbiAgdmNmdGFiaXg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdmNmdGFiaXguanMnKSxcbiAgYmlnYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcycpLFxuICBiYW06IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmFtLmpzJyksXG4gIGJpZ3dpZzogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWd3aWcuanMnKVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkRGV0YWlsIGZvcm1hdDogaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEuNyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAgXG5cbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbCA9IF8uY2xvbmUoQ3VzdG9tVHJhY2sudHlwZXMuYmVkKTtcbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cyA9IF8uZXh0ZW5kKHt9LCBDdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMsIHtkZXRhaWw6IHRydWV9KTtcblxuLy8gVGhlc2UgZnVuY3Rpb25zIGJyYW5jaCB0byBkaWZmZXJlbnQgbWV0aG9kcyBkZXBlbmRpbmcgb24gdGhlIC50eXBlKCkgb2YgdGhlIHRyYWNrXG5fLmVhY2goWydpbml0JywgJ3BhcnNlJywgJ3JlbmRlcicsICdyZW5kZXJTZXF1ZW5jZScsICdwcmVyZW5kZXInXSwgZnVuY3Rpb24oZm4pIHtcbiAgQ3VzdG9tVHJhY2sucHJvdG90eXBlW2ZuXSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICB0eXBlID0gdGhpcy50eXBlKCk7XG4gICAgaWYgKCF0eXBlW2ZuXSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICByZXR1cm4gdHlwZVtmbl0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pO1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUubG9hZE9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybScpLmhpZGUoKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybS4nK3RoaXMuX3R5cGUpLnNob3coKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW5hbWUnKS50ZXh0KG8ubmFtZSk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1kZXNjJykudGV4dChvLmRlc2NyaXB0aW9uKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWZvcm1hdCcpLnRleHQodGhpcy5fdHlwZSk7XG4gICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKG8uY29sb3IpLmNoYW5nZSgpO1xuICBpZiAodHlwZS5sb2FkT3B0cykgeyB0eXBlLmxvYWRPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgJGRpYWxvZy5maW5kKCcuZW5hYmxlcicpLmNoYW5nZSgpO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnNhdmVPcHRzID0gZnVuY3Rpb24oJGRpYWxvZykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpLFxuICAgIG8gPSB0aGlzLm9wdHM7XG4gIG8uY29sb3IgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yXScpLnZhbCgpO1xuICBpZiAoIXRoaXMudmFsaWRhdGVDb2xvcihvLmNvbG9yKSkgeyBvLmNvbG9yID0gJzAsMCwwJzsgfVxuICBpZiAodHlwZS5zYXZlT3B0cykgeyB0eXBlLnNhdmVPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgdGhpcy5hcHBseU9wdHMoKTtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy53b3JrZXIoKSAmJiB0aGlzLmFwcGx5T3B0c0FzeW5jKCk7IC8vIEFwcGx5IHRoZSBjaGFuZ2VzIHRvIHRoZSB3b3JrZXIgdG9vIVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0cyA9IGZ1bmN0aW9uKG9wdHMpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgaWYgKG9wdHMpIHsgdGhpcy5vcHRzID0gb3B0czsgfVxuICBpZiAodHlwZS5hcHBseU9wdHMpIHsgdHlwZS5hcHBseU9wdHMuY2FsbCh0aGlzKTsgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmVyYXNlID0gZnVuY3Rpb24oY2FudmFzKSB7XG4gIHZhciBzZWxmID0gdGhpcyxcbiAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgaWYgKGN0eCkgeyBjdHguY2xlYXJSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7IH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHR5cGUpKSB7IHR5cGUgPSB0aGlzLl90eXBlOyB9XG4gIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLnR5cGVzW3R5cGVdIHx8IG51bGw7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUud2FybiA9IGZ1bmN0aW9uKHdhcm5pbmcpIHtcbiAgaWYgKHRoaXMub3B0cy5zdHJpY3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3Iod2FybmluZyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCF0aGlzLndhcm5pbmdzKSB7IHRoaXMud2FybmluZ3MgPSBbXTsgfVxuICAgIHRoaXMud2FybmluZ3MucHVzaCh3YXJuaW5nKTtcbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmlzT24gPSBmdW5jdGlvbih2YWwpIHtcbiAgcmV0dXJuIC9eKG9ufHllc3x0cnVlfHR8eXwxKSQvaS50ZXN0KHZhbC50b1N0cmluZygpKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJMaXN0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fY2hyTGlzdCkge1xuICAgIHRoaXMuX2Nockxpc3QgPSBfLnNvcnRCeShfLm1hcCh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcywgZnVuY3Rpb24ocG9zLCBjaHIpIHsgcmV0dXJuIFtwb3MsIGNocl07IH0pLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KTtcbiAgfVxuICByZXR1cm4gdGhpcy5fY2hyTGlzdDtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockF0ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHZhciBjaHJMaXN0ID0gdGhpcy5jaHJMaXN0KCksXG4gICAgY2hySW5kZXggPSBfLnNvcnRlZEluZGV4KGNockxpc3QsIFtwb3NdLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KSxcbiAgICBjaHIgPSBjaHJJbmRleCA+IDAgPyBjaHJMaXN0W2NockluZGV4IC0gMV1bMV0gOiBudWxsO1xuICByZXR1cm4ge2k6IGNockluZGV4IC0gMSwgYzogY2hyLCBwOiBwb3MgLSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJdfTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJSYW5nZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGNockxlbmd0aHMgPSB0aGlzLmJyb3dzZXJPcHRzLmNockxlbmd0aHMsXG4gICAgc3RhcnRDaHIgPSB0aGlzLmNockF0KHN0YXJ0KSxcbiAgICBlbmRDaHIgPSB0aGlzLmNockF0KGVuZCksXG4gICAgcmFuZ2U7XG4gIGlmIChzdGFydENoci5jICYmIHN0YXJ0Q2hyLmkgPT09IGVuZENoci5pKSB7IHJldHVybiBbc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBlbmRDaHIucF07IH1cbiAgZWxzZSB7XG4gICAgcmFuZ2UgPSBfLm1hcCh0aGlzLmNockxpc3QoKS5zbGljZShzdGFydENoci5pICsgMSwgZW5kQ2hyLmkpLCBmdW5jdGlvbih2KSB7XG4gICAgICByZXR1cm4gdlsxXSArICc6MS0nICsgY2hyTGVuZ3Roc1t2WzFdXTtcbiAgICB9KTtcbiAgICBzdGFydENoci5jICYmIHJhbmdlLnVuc2hpZnQoc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBjaHJMZW5ndGhzW3N0YXJ0Q2hyLmNdKTtcbiAgICBlbmRDaHIuYyAmJiByYW5nZS5wdXNoKGVuZENoci5jICsgJzoxLScgKyBlbmRDaHIucCk7XG4gICAgcmV0dXJuIHJhbmdlO1xuICB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdwcmVyZW5kZXInLCBhcmd1bWVudHMsIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAnYXBwbHlPcHRzJywgW3RoaXMub3B0cywgZnVuY3Rpb24oKXt9XSwgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hamF4RGlyID0gZnVuY3Rpb24oKSB7XG4gIC8vIFdlYiBXb3JrZXJzIGZldGNoIFVSTHMgcmVsYXRpdmUgdG8gdGhlIEpTIGZpbGUgaXRzZWxmLlxuICByZXR1cm4gKGdsb2JhbC5IVE1MRG9jdW1lbnQgPyAnJyA6ICcuLi8nKSArIHRoaXMuYnJvd3Nlck9wdHMuYWpheERpcjtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5yZ2JUb0hzbCA9IGZ1bmN0aW9uKHIsIGcsIGIpIHtcbiAgciAvPSAyNTUsIGcgLz0gMjU1LCBiIC89IDI1NTtcbiAgdmFyIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpLCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgdmFyIGgsIHMsIGwgPSAobWF4ICsgbWluKSAvIDI7XG5cbiAgaWYgKG1heCA9PSBtaW4pIHtcbiAgICBoID0gcyA9IDA7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICB2YXIgZCA9IG1heCAtIG1pbjtcbiAgICBzID0gbCA+IDAuNSA/IGQgLyAoMiAtIG1heCAtIG1pbikgOiBkIC8gKG1heCArIG1pbik7XG4gICAgc3dpdGNoKG1heCl7XG4gICAgICBjYXNlIHI6IGggPSAoZyAtIGIpIC8gZCArIChnIDwgYiA/IDYgOiAwKTsgYnJlYWs7XG4gICAgICBjYXNlIGc6IGggPSAoYiAtIHIpIC8gZCArIDI7IGJyZWFrO1xuICAgICAgY2FzZSBiOiBoID0gKHIgLSBnKSAvIGQgKyA0OyBicmVhaztcbiAgICB9XG4gICAgaCAvPSA2O1xuICB9XG5cbiAgcmV0dXJuIFtoLCBzLCBsXTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmhzbFRvUmdiID0gZnVuY3Rpb24oaCwgcywgbCkge1xuICB2YXIgciwgZywgYjtcblxuICBpZiAocyA9PSAwKSB7XG4gICAgciA9IGcgPSBiID0gbDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIGZ1bmN0aW9uIGh1ZTJyZ2IocCwgcSwgdCkge1xuICAgICAgaWYodCA8IDApIHQgKz0gMTtcbiAgICAgIGlmKHQgPiAxKSB0IC09IDE7XG4gICAgICBpZih0IDwgMS82KSByZXR1cm4gcCArIChxIC0gcCkgKiA2ICogdDtcbiAgICAgIGlmKHQgPCAxLzIpIHJldHVybiBxO1xuICAgICAgaWYodCA8IDIvMykgcmV0dXJuIHAgKyAocSAtIHApICogKDIvMyAtIHQpICogNjtcbiAgICAgIHJldHVybiBwO1xuICAgIH1cblxuICAgIHZhciBxID0gbCA8IDAuNSA/IGwgKiAoMSArIHMpIDogbCArIHMgLSBsICogcztcbiAgICB2YXIgcCA9IDIgKiBsIC0gcTtcbiAgICByID0gaHVlMnJnYihwLCBxLCBoICsgMS8zKTtcbiAgICBnID0gaHVlMnJnYihwLCBxLCBoKTtcbiAgICBiID0gaHVlMnJnYihwLCBxLCBoIC0gMS8zKTtcbiAgfVxuXG4gIHJldHVybiBbciAqIDI1NSwgZyAqIDI1NSwgYiAqIDI1NV07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS52YWxpZGF0ZUNvbG9yID0gZnVuY3Rpb24oY29sb3IpIHtcbiAgdmFyIG0gPSBjb2xvci5tYXRjaCgvKFxcZCspLChcXGQrKSwoXFxkKykvKTtcbiAgaWYgKCFtKSB7IHJldHVybiBmYWxzZTsgfVxuICBtLnNoaWZ0KCk7XG4gIHJldHVybiBfLmFsbChfLm1hcChtLCBwYXJzZUludDEwKSwgZnVuY3Rpb24odikgeyByZXR1cm4gdiA+PTAgJiYgdiA8PSAyNTU7IH0pO1xufVxuXG5yZXR1cm4gQ3VzdG9tVHJhY2s7XG5cbn07IiwibW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24oZ2xvYmFsKXtcbiAgXG4gIHZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbiAgXG4gIC8vIFNvbWUgdXRpbGl0eSBmdW5jdGlvbnMuXG4gIHZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xuICBcbiAgLy8gVGhlIGNsYXNzIHRoYXQgcmVwcmVzZW50cyBhIHNpbmd1bGFyIGN1c3RvbSB0cmFjayBvYmplY3RcbiAgdmFyIEN1c3RvbVRyYWNrID0gcmVxdWlyZSgnLi9DdXN0b21UcmFjay5qcycpKGdsb2JhbCk7XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vID0gQ3VzdG9tVHJhY2tzLCB0aGUgbW9kdWxlIHRoYXQgaXMgZXhwb3J0ZWQgdG8gdGhlIGdsb2JhbCBlbnZpcm9ubWVudC4gPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8gQnJvYWRseSBzcGVha2luZyB0aGlzIGlzIGEgZmFjdG9yeSBmb3IgcGFyc2luZyBkYXRhIGludG8gQ3VzdG9tVHJhY2sgb2JqZWN0cyxcbiAgLy8gYW5kIGl0IGNhbiBkZWxlZ2F0ZSB0aGlzIHdvcmsgdG8gYSB3b3JrZXIgdGhyZWFkLlxuXG4gIHZhciBDdXN0b21UcmFja3MgPSB7XG4gICAgcGFyc2U6IGZ1bmN0aW9uKGNodW5rcywgYnJvd3Nlck9wdHMpIHtcbiAgICAgIHZhciBjdXN0b21UcmFja3MgPSBbXSxcbiAgICAgICAgZGF0YSA9IFtdLFxuICAgICAgICB0cmFjaywgb3B0cywgbTtcbiAgICAgIFxuICAgICAgaWYgKHR5cGVvZiBjaHVua3MgPT0gXCJzdHJpbmdcIikgeyBjaHVua3MgPSBbY2h1bmtzXTsgfVxuICAgICAgXG4gICAgICBmdW5jdGlvbiBwdXNoVHJhY2soKSB7XG4gICAgICAgIGlmICh0cmFjay5wYXJzZShkYXRhKSkgeyBjdXN0b21UcmFja3MucHVzaCh0cmFjayk7IH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgY3VzdG9tVHJhY2tzLmJyb3dzZXIgPSB7fTtcbiAgICAgIF8uZWFjaChjaHVua3MsIGZ1bmN0aW9uKHRleHQpIHtcbiAgICAgICAgXy5lYWNoKHRleHQuc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgICAgIGlmICgvXiMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIC8vIGNvbW1lbnQgbGluZVxuICAgICAgICAgIH0gZWxzZSBpZiAoL15icm93c2VyXFxzKy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gYnJvd3NlciBsaW5lc1xuICAgICAgICAgICAgbSA9IGxpbmUubWF0Y2goL15icm93c2VyXFxzKyhcXHcrKVxccysoXFxTKikvKTtcbiAgICAgICAgICAgIGlmICghbSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgYnJvd3NlciBsaW5lIGZvdW5kIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSkpOyB9XG4gICAgICAgICAgICBjdXN0b21UcmFja3MuYnJvd3NlclttWzFdXSA9IG1bMl07XG4gICAgICAgICAgfSBlbHNlIGlmICgvXnRyYWNrXFxzKy9pLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgICAgICAgb3B0cyA9IHBhcnNlRGVjbGFyYXRpb25MaW5lKGxpbmUsICgvXnRyYWNrXFxzKy9pKSk7XG4gICAgICAgICAgICBpZiAoIW9wdHMpIHsgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IHBhcnNlIHRyYWNrIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIG9wdHMubGluZU51bSA9IGxpbmVubyArIDE7XG4gICAgICAgICAgICB0cmFjayA9IG5ldyBDdXN0b21UcmFjayhvcHRzLCBicm93c2VyT3B0cyk7XG4gICAgICAgICAgICBkYXRhID0gW107XG4gICAgICAgICAgfSBlbHNlIGlmICgvXFxTLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICBpZiAoIXRyYWNrKSB7IHRocm93IG5ldyBFcnJvcihcIkZvdW5kIGRhdGEgb24gbGluZSBcIisobGluZW5vKzEpK1wiIGJ1dCBubyBwcmVjZWRpbmcgdHJhY2sgZGVmaW5pdGlvblwiKTsgfVxuICAgICAgICAgICAgZGF0YS5wdXNoKGxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgcmV0dXJuIGN1c3RvbVRyYWNrcztcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lOiBwYXJzZURlY2xhcmF0aW9uTGluZSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbVRyYWNrV29ya2VyLmpzJyxcbiAgICAvLyBOT1RFOiBUbyB0ZW1wb3JhcmlseSBkaXNhYmxlIFdlYiBXb3JrZXIgdXNhZ2UsIHNldCB0aGlzIHRvIHRydWUuXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICBcbiAgICB3b3JrZXI6IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgY2FsbGJhY2tzID0gW107XG4gICAgICBpZiAoIXNlbGYuX3dvcmtlciAmJiBnbG9iYWwuV29ya2VyKSB7IFxuICAgICAgICBzZWxmLl93b3JrZXIgPSBuZXcgZ2xvYmFsLldvcmtlcihzZWxmLl93b3JrZXJTY3JpcHQpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBmdW5jdGlvbihlKSB7IHNlbGYuZXJyb3IoZSk7IH0sIGZhbHNlKTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgaWYgKGUuZGF0YS5sb2cpIHsgY29uc29sZS5sb2coSlNPTi5wYXJzZShlLmRhdGEubG9nKSk7IHJldHVybjsgfVxuICAgICAgICAgIGlmIChlLmRhdGEuZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChlLmRhdGEuaWQpIHsgY2FsbGJhY2tzW2UuZGF0YS5pZF0gPSBudWxsOyB9XG4gICAgICAgICAgICBzZWxmLmVycm9yKEpTT04ucGFyc2UoZS5kYXRhLmVycm9yKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGNhbGxiYWNrc1tlLmRhdGEuaWRdKEpTT04ucGFyc2UoZS5kYXRhLnJldCkpO1xuICAgICAgICAgIGNhbGxiYWNrc1tlLmRhdGEuaWRdID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5jYWxsID0gZnVuY3Rpb24ob3AsIGFyZ3MsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgdmFyIGlkID0gY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC0gMTtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogb3AsIGlkOiBpZCwgYXJnczogYXJnc30pO1xuICAgICAgICB9O1xuICAgICAgICAvLyBUbyBoYXZlIHRoZSB3b3JrZXIgdGhyb3cgZXJyb3JzIGluc3RlYWQgb2YgcGFzc2luZyB0aGVtIG5pY2VseSBiYWNrLCBjYWxsIHRoaXMgd2l0aCB0b2dnbGU9dHJ1ZVxuICAgICAgICBzZWxmLl93b3JrZXIudGhyb3dFcnJvcnMgPSBmdW5jdGlvbih0b2dnbGUpIHtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogJ3Rocm93RXJyb3JzJywgYXJnczogW3RvZ2dsZV19KTtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZWxmLl9kaXNhYmxlV29ya2VycyA/IG51bGwgOiBzZWxmLl93b3JrZXI7XG4gICAgfSxcbiAgICBcbiAgICBhc3luYzogZnVuY3Rpb24oc2VsZiwgZm4sIGFyZ3MsIGFzeW5jRXh0cmFBcmdzLCB3cmFwcGVyKSB7XG4gICAgICBhcmdzID0gXy50b0FycmF5KGFyZ3MpO1xuICAgICAgd3JhcHBlciA9IHdyYXBwZXIgfHwgXy5pZGVudGl0eTtcbiAgICAgIHZhciBhcmdzRXhjZXB0TGFzdE9uZSA9IF8uaW5pdGlhbChhcmdzKSxcbiAgICAgICAgY2FsbGJhY2sgPSBfLmxhc3QoYXJncyksXG4gICAgICAgIHcgPSB0aGlzLndvcmtlcigpO1xuICAgICAgLy8gRmFsbGJhY2sgaWYgd2ViIHdvcmtlcnMgYXJlIG5vdCBzdXBwb3J0ZWQuXG4gICAgICAvLyBUaGlzIGNvdWxkIGFsc28gYmUgdHdlYWtlZCB0byBub3QgdXNlIHdlYiB3b3JrZXJzIHdoZW4gdGhlcmUgd291bGQgYmUgbm8gcGVyZm9ybWFuY2UgZ2FpbjtcbiAgICAgIC8vICAgYWN0aXZhdGluZyB0aGlzIGJyYW5jaCBkaXNhYmxlcyB3ZWIgd29ya2VycyBlbnRpcmVseSBhbmQgZXZlcnl0aGluZyBoYXBwZW5zIHN5bmNocm9ub3VzbHkuXG4gICAgICBpZiAoIXcpIHsgcmV0dXJuIGNhbGxiYWNrKHNlbGZbZm5dLmFwcGx5KHNlbGYsIGFyZ3NFeGNlcHRMYXN0T25lKSk7IH1cbiAgICAgIEFycmF5LnByb3RvdHlwZS51bnNoaWZ0LmFwcGx5KGFyZ3NFeGNlcHRMYXN0T25lLCBhc3luY0V4dHJhQXJncyk7XG4gICAgICB3LmNhbGwoZm4sIGFyZ3NFeGNlcHRMYXN0T25lLCBmdW5jdGlvbihyZXQpIHsgY2FsbGJhY2sod3JhcHBlcihyZXQpKTsgfSk7XG4gICAgfSxcbiAgICBcbiAgICBwYXJzZUFzeW5jOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuYXN5bmModGhpcywgJ3BhcnNlJywgYXJndW1lbnRzLCBbXSwgZnVuY3Rpb24odHJhY2tzKSB7XG4gICAgICAgIC8vIFRoZXNlIGhhdmUgYmVlbiBzZXJpYWxpemVkLCBzbyB0aGV5IG11c3QgYmUgaHlkcmF0ZWQgaW50byByZWFsIEN1c3RvbVRyYWNrIG9iamVjdHMuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLnByZXJlbmRlcigpIHdpdGggYW4gYXN5bmNocm9ub3VzIHZlcnNpb24uXG4gICAgICAgIHJldHVybiBfLm1hcCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICByZXR1cm4gXy5leHRlbmQobmV3IEN1c3RvbVRyYWNrKCksIHQsIHtcbiAgICAgICAgICAgIHByZXJlbmRlcjogZnVuY3Rpb24oKSB7IEN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIGdsb2JhbC5DdXN0b21UcmFja3MgPSBDdXN0b21UcmFja3M7XG5cbn0pOyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGNocm9tLnNpemVzIGZvcm1hdDogaHR0cDovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L2Nocm9tU2l6ZXMgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE5vdGU6IHdlIGFyZSBleHRlbmRpbmcgdGhlIGdlbmVyYWwgdXNlIG9mIHRoaXMgdG8gaW5jbHVkZSBkYXRhIGxvYWRlZCBmcm9tIHRoZSBnZW5vbWUudHh0IGFuZCBhbm5vdHMueG1sXG4vLyBmaWxlcyBvZiBhbiBJR0IgcXVpY2tsb2FkIGRpcmVjdG9yeSxcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgb3B0c0FzVHJhY2tMaW5lID0gdXRpbHMub3B0c0FzVHJhY2tMaW5lO1xuXG52YXIgQ2hyb21TaXplc0Zvcm1hdCA9IHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbSA9IHNlbGYubWV0YWRhdGEsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgIG8uc3BlY2llcyA9IG0uc3BlY2llcyB8fCAnQ3VzdG9tIEdlbm9tZSc7XG4gICAgby5hc3NlbWJseURhdGUgPSBtLmFzc2VtYmx5RGF0ZSB8fCAnJztcbiAgICBcbiAgICAvLyBUT0RPOiBpZiBtZXRhZGF0YSBhbHNvIGNvbnRhaW5zIGN1c3RvbSB0cmFjayBkYXRhLCBlLmcuIGZyb20gYW5ub3RzLnhtbFxuICAgIC8vIG11c3QgY29udmVydCB0aGVtIGludG8gaXRlbXMgZm9yIG8uYXZhaWxUcmFja3MsIG8udHJhY2tzLCBhbmQgby50cmFja0Rlc2NcbiAgICAvLyBUaGUgby5hdmFpbFRyYWNrcyBpdGVtcyBzaG91bGQgY29udGFpbiB7Y3VzdG9tRGF0YTogdHJhY2tsaW5lc30gdG8gYmUgcGFyc2VkXG4gICAgaWYgKG0udHJhY2tzKSB7IHNlbGYuZm9ybWF0KCkuY3JlYXRlVHJhY2tzKG0udHJhY2tzKTsgfVxuICB9LFxuICBcbiAgY3JlYXRlVHJhY2tzOiBmdW5jdGlvbih0cmFja3MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgICAgXG4gICAgXy5lYWNoKHRyYWNrcywgZnVuY3Rpb24odCkge1xuICAgICAgdmFyIHRyYWNrT3B0cztcbiAgICAgIHQubGluZXMgPSB0LmxpbmVzIHx8IFtdO1xuICAgICAgdHJhY2tPcHRzID0gL150cmFja1xccysvaS50ZXN0KHQubGluZXNbMF0pID8gZ2xvYmFsLkN1c3RvbVRyYWNrcy5wYXJzZURlY2xhcmF0aW9uTGluZSh0LmxpbmVzLnNoaWZ0KCkpIDoge307XG4gICAgICB0LmxpbmVzLnVuc2hpZnQoJ3RyYWNrICcgKyBvcHRzQXNUcmFja0xpbmUoXy5leHRlbmQodHJhY2tPcHRzLCB0Lm9wdHMsIHtuYW1lOiB0Lm5hbWUsIHR5cGU6IHQudHlwZX0pKSArICdcXG4nKTtcbiAgICAgIG8uYXZhaWxUcmFja3MucHVzaCh7XG4gICAgICAgIGZoOiB7fSxcbiAgICAgICAgbjogdC5uYW1lLFxuICAgICAgICBzOiBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ10sXG4gICAgICAgIGg6IDE1LFxuICAgICAgICBtOiBbJ3BhY2snXSxcbiAgICAgICAgY3VzdG9tRGF0YTogdC5saW5lc1xuICAgICAgfSk7XG4gICAgICBvLnRyYWNrcy5wdXNoKHtuOiB0Lm5hbWV9KTtcbiAgICAgIG8udHJhY2tEZXNjW3QubmFtZV0gPSB7XG4gICAgICAgIGNhdDogXCJGZWF0dXJlIFRyYWNrc1wiLFxuICAgICAgICBzbTogdC5uYW1lLFxuICAgICAgICBsZzogdC5kZXNjcmlwdGlvbiB8fCB0Lm5hbWVcbiAgICAgIH07XG4gICAgfSk7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCkge1xuICAgIHZhciBsaW5lcyA9IHRleHQuc3BsaXQoXCJcXG5cIiksXG4gICAgICBvID0gdGhpcy5vcHRzO1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgaSkge1xuICAgICAgdmFyIGNocnNpemUgPSBzdHJpcChsaW5lKS5zcGxpdCgvXFxzKy8sIDIpLFxuICAgICAgICBjaHIgPSBjaHJzaXplWzBdLFxuICAgICAgICBzaXplID0gcGFyc2VJbnQxMChjaHJzaXplWzFdKTtcbiAgICAgIGlmIChfLmlzTmFOKHNpemUpKSB7IHJldHVybjsgfVxuICAgICAgby5jaHJPcmRlci5wdXNoKGNocik7XG4gICAgICBvLmNockxlbmd0aHNbY2hyXSA9IHNpemU7XG4gICAgICBvLmdlbm9tZVNpemUgKz0gc2l6ZTtcbiAgICB9KTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBDaHJvbVNpemVzRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEZBU1RBIGZvcm1hdDogaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9GQVNUQV9mb3JtYXQgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBlbnN1cmVVbmlxdWUgPSB1dGlscy5lbnN1cmVVbmlxdWU7XG5cbnZhciBGYXN0YUZvcm1hdCA9IHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbSA9IHNlbGYubWV0YWRhdGEsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgICAgXG4gICAgc2VsZi5kYXRhID0ge307XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCkge1xuICAgIHZhciBsaW5lcyA9IHRleHQuc3BsaXQoXCJcXG5cIiksXG4gICAgICBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjaHIgPSBudWxsLFxuICAgICAgdW5uYW1lZENvdW50ZXIgPSAxLFxuICAgICAgY2hyc2VxID0gW107XG4gICAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBbXTtcbiAgICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGkpIHtcbiAgICAgIHZhciBjaHJMaW5lID0gbGluZS5tYXRjaCgvXls+O10oLispLyksXG4gICAgICAgIGNsZWFuZWRMaW5lID0gbGluZS5yZXBsYWNlKC9cXHMrL2csICcnKTtcbiAgICAgIGlmIChjaHJMaW5lKSB7XG4gICAgICAgIGNociA9IGNockxpbmVbMV0ucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpO1xuICAgICAgICBpZiAoIWNoci5sZW5ndGgpIHsgY2hyID0gXCJ1bm5hbWVkQ2hyXCI7IH1cbiAgICAgICAgY2hyID0gZW5zdXJlVW5pcXVlKGNociwgby5jaHJMZW5ndGhzKTtcbiAgICAgICAgby5jaHJPcmRlci5wdXNoKGNocik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLmRhdGEuc2VxdWVuY2UucHVzaChjbGVhbmVkTGluZSk7XG4gICAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gKG8uY2hyTGVuZ3Roc1tjaHJdIHx8IDApICsgY2xlYW5lZExpbmUubGVuZ3RoO1xuICAgICAgICBvLmdlbm9tZVNpemUgKz0gY2xlYW5lZExpbmUubGVuZ3RoO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IHNlbGYuZGF0YS5zZXF1ZW5jZS5qb2luKCcnKTtcbiAgICBzZWxmLmNhbkdldFNlcXVlbmNlID0gdHJ1ZTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBGYXN0YUZvcm1hdDsiLCJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gR2VuQmFuayBmb3JtYXQ6IGh0dHA6Ly93d3cubmNiaS5ubG0ubmloLmdvdi9TaXRlbWFwL3NhbXBsZXJlY29yZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgdG9wVGFnc0FzQXJyYXkgPSB1dGlscy50b3BUYWdzQXNBcnJheSxcbiAgc3ViVGFnc0FzQXJyYXkgPSB1dGlscy5zdWJUYWdzQXNBcnJheSxcbiAgZmV0Y2hGaWVsZCA9IHV0aWxzLmZldGNoRmllbGQsXG4gIGdldFRhZyA9IHV0aWxzLmdldFRhZyxcbiAgZW5zdXJlVW5pcXVlID0gdXRpbHMuZW5zdXJlVW5pcXVlO1xuXG52YXIgR2VuQmFua0Zvcm1hdCA9IHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgLy8gTm90ZSB0aGF0IHdlIGNhbGwgR2VuQmFuayBmaWVsZCBuYW1lcyBsaWtlIFwiTE9DVVNcIiwgXCJERUZJTklUSU9OXCIsIGV0Yy4gdGFncyBpbnN0ZWFkIG9mIGtleXMuXG4gICAgLy8gV2UgZG8gdGhpcyBiZWNhdXNlOiAxKSBjZXJ0YWluIGZpZWxkIG5hbWVzIGNhbiBiZSByZXBlYXRlZCAoZS5nLiBSRUZFUkVOQ0UpIHdoaWNoIGlzIG1vcmUgXG4gICAgLy8gZXZvY2F0aXZlIG9mIFwidGFnc1wiIGFzIG9wcG9zZWQgdG8gdGhlIGJlaGF2aW9yIG9mIGtleXMgaW4gYSBoYXNoLiAgQWxzbywgMikgdGhpcyBpcyB0aGVcbiAgICAvLyBub21lbmNsYXR1cmUgcGlja2VkIGJ5IEJpb1J1YnkuXG4gICAgXG4gICAgdGhpcy50YWdTaXplID0gMTI7IC8vIGhvdyB3aWRlIHRoZSBjb2x1bW4gZm9yIHRhZ3MgaXMgaW4gYSBHZW5CYW5rIGZpbGVcbiAgICB0aGlzLmZlYXR1cmVUYWdTaXplID0gMjE7IC8vIGhvdyB3aWRlIHRoZSBjb2x1bW4gZm9yIHRhZ3MgaXMgaW4gdGhlIGZlYXR1cmUgdGFibGUgc2VjdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VlIHNlY3Rpb24gNC4xIG9mIGh0dHA6Ly93d3cuaW5zZGMub3JnL2ZpbGVzL2ZlYXR1cmVfdGFibGUuaHRtbFxuICAgIFxuICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgIGNvbnRpZ3M6IFtdLFxuICAgICAgdHJhY2tMaW5lczoge1xuICAgICAgICBzb3VyY2U6IFtdLFxuICAgICAgICBnZW5lczogW10sXG4gICAgICAgIG90aGVyOiBbXVxuICAgICAgfVxuICAgIH07XG4gIH0sXG4gIFxuICBwYXJzZUxvY3VzOiBmdW5jdGlvbihjb250aWcpIHtcbiAgICB2YXIgbG9jdXNMaW5lID0gY29udGlnLm9yaWcubG9jdXM7XG4gICAgaWYgKGxvY3VzTGluZSkge1xuICAgICAgaWYgKGxvY3VzTGluZS5sZW5ndGggPiA3NSkgeyAvLyBhZnRlciBSZWwgMTI2LjBcbiAgICAgICAgY29udGlnLmVudHJ5SWQgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygxMiwgMjgpKTtcbiAgICAgICAgY29udGlnLmxlbmd0aCAgID0gcGFyc2VJbnQxMChsb2N1c0xpbmUuc3Vic3RyaW5nKDI5LCA0MCkpO1xuICAgICAgICBjb250aWcuc3RyYW5kICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQ0LCA0NykpO1xuICAgICAgICBjb250aWcubmF0eXBlICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQ3LCA1MykpO1xuICAgICAgICBjb250aWcuY2lyY3VsYXIgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDU1LCA2MykpO1xuICAgICAgICBjb250aWcuZGl2aXNpb24gPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDYzLCA2NykpO1xuICAgICAgICBjb250aWcuZGF0ZSAgICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDY4LCA3OSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29udGlnLmVudHJ5SWQgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygxMiwgMjIpKTtcbiAgICAgICAgY29udGlnLmxlbmd0aCAgID0gcGFyc2VJbnQxMChsb2N1c0xpbmUuc3Vic3RyaW5nKDIyLCAzMCkpO1xuICAgICAgICBjb250aWcuc3RyYW5kICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDMzLCAzNikpO1xuICAgICAgICBjb250aWcubmF0eXBlICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDM2LCA0MCkpO1xuICAgICAgICBjb250aWcuY2lyY3VsYXIgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQyLCA1MikpO1xuICAgICAgICBjb250aWcuZGl2aXNpb24gPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDUyLCA1NSkpO1xuICAgICAgICBjb250aWcuZGF0ZSAgICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDYyLCA3MykpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlSGVhZGVyRmllbGRzOiBmdW5jdGlvbihjb250aWcpIHtcbiAgICB2YXIgdGFnU2l6ZSA9IHRoaXMudGFnU2l6ZSxcbiAgICAgIGhlYWRlckZpZWxkc1RvUGFyc2UgPSB7XG4gICAgICAgIHNpbXBsZTogWydkZWZpbml0aW9uJywgJ2FjY2Vzc2lvbicsICd2ZXJzaW9uJ10sXG4gICAgICAgIGRlZXA6IFsnc291cmNlJ10gLy8gY291bGQgYWRkIHJlZmVyZW5jZXMsIGJ1dCB3ZSBkb24ndCBjYXJlIGFib3V0IHRob3NlIGhlcmVcbiAgICAgIH07XG4gICAgXG4gICAgLy8gUGFyc2Ugc2ltcGxlIGZpZWxkcyAodGFnIC0tPiBjb250ZW50KVxuICAgIF8uZWFjaChoZWFkZXJGaWVsZHNUb1BhcnNlLnNpbXBsZSwgZnVuY3Rpb24odGFnKSB7XG4gICAgICBpZiAoIWNvbnRpZy5vcmlnW3RhZ10pIHsgY29udGlnW3RhZ10gPSBudWxsOyByZXR1cm47IH1cbiAgICAgIGNvbnRpZ1t0YWddID0gZmV0Y2hGaWVsZChjb250aWcub3JpZ1t0YWddLCB0YWdTaXplKTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBQYXJzZSB0YWdzIHRoYXQgY2FuIHJlcGVhdCBhbmQgaGF2ZSBzdWJ0YWdzXG4gICAgXy5lYWNoKGhlYWRlckZpZWxkc1RvUGFyc2UuZGVlcCwgZnVuY3Rpb24odGFnKSB7XG4gICAgICB2YXIgZGF0YSA9IFtdLFxuICAgICAgICBpdGVtcztcbiAgICAgIGlmICghY29udGlnLm9yaWdbdGFnXSkgeyBjb250aWdbdGFnXSA9IG51bGw7IHJldHVybjsgfVxuICAgICAgXG4gICAgICBpdGVtcyA9IGNvbnRpZy5vcmlnW3RhZ10ucmVwbGFjZSgvXFxuKFtBLVphLXpcXC9cXCpdKS9nLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbiAgICAgIF8uZWFjaChpdGVtcywgZnVuY3Rpb24oaXRlbSkge1xuICAgICAgICB2YXIgc3ViVGFncyA9IHN1YlRhZ3NBc0FycmF5KGl0ZW0sIHRhZ1NpemUpLFxuICAgICAgICAgIGl0ZW1OYW1lID0gZmV0Y2hGaWVsZChzdWJUYWdzLnNoaWZ0KCksIHRhZ1NpemUpLCBcbiAgICAgICAgICBpdGVtRGF0YSA9IHtfbmFtZTogaXRlbU5hbWV9O1xuICAgICAgICBfLmVhY2goc3ViVGFncywgZnVuY3Rpb24oc3ViVGFnRmllbGQpIHtcbiAgICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKHN1YlRhZ0ZpZWxkLCB0YWdTaXplKTtcbiAgICAgICAgICBpdGVtRGF0YVt0YWddID0gZmV0Y2hGaWVsZChzdWJUYWdGaWVsZCwgdGFnU2l6ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLnB1c2goaXRlbURhdGEpO1xuICAgICAgfSk7XG4gICAgICBjb250aWdbdGFnXSA9IGRhdGE7XG4gICAgICBcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlRmVhdHVyZVRhYmxlOiBmdW5jdGlvbihjaHIsIGNvbnRpZ0RhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB0YWdTaXplID0gc2VsZi50YWdTaXplLFxuICAgICAgZmVhdHVyZVRhZ1NpemUgPSBzZWxmLmZlYXR1cmVUYWdTaXplLFxuICAgICAgdGFnc1RvU2tpcCA9IFtcImZlYXR1cmVzXCJdLFxuICAgICAgdGFnc1JlbGF0ZWRUb0dlbmVzID0gW1wiY2RzXCIsIFwiZ2VuZVwiLCBcIm1ybmFcIiwgXCJleG9uXCIsIFwiaW50cm9uXCJdLFxuICAgICAgY29udGlnTGluZSA9IFwiQUNDRVNTSU9OICAgXCIgKyBjaHIgKyBcIlxcblwiO1xuICAgIGlmIChjb250aWdEYXRhLm9yaWcuZmVhdHVyZXMpIHtcbiAgICAgIHZhciBzdWJUYWdzID0gc3ViVGFnc0FzQXJyYXkoY29udGlnRGF0YS5vcmlnLmZlYXR1cmVzLCB0YWdTaXplKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLnNvdXJjZS5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMuZ2VuZXMucHVzaChjb250aWdMaW5lKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLm90aGVyLnB1c2goY29udGlnTGluZSk7XG4gICAgICBfLmVhY2goc3ViVGFncywgZnVuY3Rpb24oc3ViVGFnRmllbGQpIHtcbiAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhzdWJUYWdGaWVsZCwgZmVhdHVyZVRhZ1NpemUpO1xuICAgICAgICBpZiAodGFnc1RvU2tpcC5pbmRleE9mKHRhZykgIT09IC0xKSB7IHJldHVybjsgfVxuICAgICAgICBlbHNlIGlmICh0YWcgPT09IFwic291cmNlXCIpIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMuc291cmNlLnB1c2goc3ViVGFnRmllbGQpOyB9XG4gICAgICAgIGVsc2UgaWYgKHRhZ3NSZWxhdGVkVG9HZW5lcy5pbmRleE9mKHRhZykgIT09IC0xKSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLmdlbmVzLnB1c2goc3ViVGFnRmllbGQpOyAgfVxuICAgICAgICBlbHNlIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMub3RoZXIucHVzaChzdWJUYWdGaWVsZCk7IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlU2VxdWVuY2U6IGZ1bmN0aW9uKGNvbnRpZ0RhdGEpIHtcbiAgICBpZiAoY29udGlnRGF0YS5vcmlnLm9yaWdpbikge1xuICAgICAgcmV0dXJuIGNvbnRpZ0RhdGEub3JpZy5vcmlnaW4ucmVwbGFjZSgvXm9yaWdpbi4qfFxcblsgMC05XXsxMH18IC9pZywgJycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gQXJyYXkoY29udGlnRGF0YS5sZW5ndGgpLmpvaW4oJ24nKTtcbiAgICB9XG4gIH0sXG4gIFxuICBjcmVhdGVUcmFja3NGcm9tRmVhdHVyZXM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjYXRlZ29yeVR1cGxlcyA9IFtcbiAgICAgICAgW1wic291cmNlXCIsIFwiU291cmNlc1wiLCBcIlJlZ2lvbnMgYW5ub3RhdGVkIGJ5IHNvdXJjZSBvcmdhbmlzbSBvciBzcGVjaW1lblwiXSwgXG4gICAgICAgIFtcImdlbmVzXCIsIFwiR2VuZSBhbm5vdGF0aW9uc1wiLCBcIkNEUyBhbmQgZ2VuZSBmZWF0dXJlc1wiXSwgXG4gICAgICAgIFtcIm90aGVyXCIsIFwiT3RoZXIgYW5ub3RhdGlvbnNcIiwgXCJ0Uk5BcyBhbmQgb3RoZXIgZmVhdHVyZXNcIl1cbiAgICAgIF07XG4gICAgXG4gICAgLy8gRm9yIHRoZSBjYXRlZ29yaWVzIG9mIGZlYXR1cmVzLCBjcmVhdGUgYXBwcm9wcmlhdGUgZW50cmllcyBpbiBvLmF2YWlsVHJhY2tzLCBvLnRyYWNrcywgYW5kIG8udHJhY2tEZXNjXG4gICAgLy8gTGVhdmUgdGhlIGFjdHVhbCBkYXRhIGFzIGFycmF5cyBvZiBsaW5lcyB0aGF0IGFyZSBhdHRhY2hlZCBhcyAuY3VzdG9tRGF0YSB0byBvLmF2YWlsVHJhY2tzXG4gICAgLy8gVGhleSB3aWxsIGJlIHBhcnNlZCBsYXRlciB2aWEgQ3VzdG9tVHJhY2tzLnBhcnNlLlxuICAgIF8uZWFjaChjYXRlZ29yeVR1cGxlcywgZnVuY3Rpb24oY2F0ZWdvcnlUdXBsZSkge1xuICAgICAgdmFyIGNhdGVnb3J5ID0gY2F0ZWdvcnlUdXBsZVswXSxcbiAgICAgICAgbGFiZWwgPSBjYXRlZ29yeVR1cGxlWzFdLFxuICAgICAgICBsb25nTGFiZWwgPSBjYXRlZ29yeVR1cGxlWzJdLFxuICAgICAgICB0cmFja0xpbmVzID0gW107XG4gICAgICBpZiAoc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldLnVuc2hpZnQoJ3RyYWNrIHR5cGU9XCJmZWF0dXJlVGFibGVcIiBuYW1lPVwiJyArIGxhYmVsICsgXG4gICAgICAgICAgJ1wiIGNvbGxhcHNlQnlHZW5lPVwiJyArIChjYXRlZ29yeT09XCJnZW5lc1wiID8gJ29uJyA6ICdvZmYnKSArICdcIlxcbicpO1xuICAgICAgfVxuICAgICAgby5hdmFpbFRyYWNrcy5wdXNoKHtcbiAgICAgICAgZmg6IHt9LFxuICAgICAgICBuOiBjYXRlZ29yeSxcbiAgICAgICAgczogWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddLFxuICAgICAgICBoOiAxNSxcbiAgICAgICAgbTogWydwYWNrJ10sXG4gICAgICAgIGN1c3RvbURhdGE6IHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XVxuICAgICAgfSk7XG4gICAgICBvLnRyYWNrcy5wdXNoKHtuOiBjYXRlZ29yeX0pO1xuICAgICAgby50cmFja0Rlc2NbY2F0ZWdvcnldID0ge1xuICAgICAgICBjYXQ6IFwiRmVhdHVyZSBUcmFja3NcIixcbiAgICAgICAgc206IGxhYmVsLFxuICAgICAgICBsZzogbG9uZ0xhYmVsXG4gICAgICB9O1xuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY29udGlnRGVsaW1pdGVyID0gXCJcXG4vL1xcblwiLFxuICAgICAgY29udGlncyA9IHRleHQuc3BsaXQoY29udGlnRGVsaW1pdGVyKSxcbiAgICAgIGZpcnN0Q29udGlnID0gbnVsbDtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBbXTtcbiAgICAgIFxuICAgIF8uZWFjaChjb250aWdzLCBmdW5jdGlvbihjb250aWcpIHtcbiAgICAgIGlmICghc3RyaXAoY29udGlnKS5sZW5ndGgpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgIHZhciBjb250aWdEYXRhID0ge29yaWc6IHt9fSxcbiAgICAgICAgY2hyLCBzaXplLCBjb250aWdTZXF1ZW5jZTtcbiAgICAgIFxuICAgICAgLy8gU3BsaXRzIG9uIGFueSBsaW5lcyB3aXRoIGEgY2hhcmFjdGVyIGluIHRoZSBmaXJzdCBjb2x1bW5cbiAgICAgIF8uZWFjaCh0b3BUYWdzQXNBcnJheShjb250aWcpLCBmdW5jdGlvbihmaWVsZCkge1xuICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKGZpZWxkLCBzZWxmLnRhZ1NpemUpO1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChjb250aWdEYXRhLm9yaWdbdGFnXSkpIHsgY29udGlnRGF0YS5vcmlnW3RhZ10gPSBmaWVsZDsgfVxuICAgICAgICBlbHNlIHsgY29udGlnRGF0YS5vcmlnW3RhZ10gKz0gZmllbGQ7IH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBzZWxmLmRhdGEuY29udGlncy5wdXNoKGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUxvY3VzKGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUhlYWRlckZpZWxkcyhjb250aWdEYXRhKTtcbiAgICAgIGNvbnRpZ1NlcXVlbmNlID0gc2VsZi5mb3JtYXQoKS5wYXJzZVNlcXVlbmNlKGNvbnRpZ0RhdGEpO1xuICAgICAgXG4gICAgICBjaHIgPSBjb250aWdEYXRhLmFjY2Vzc2lvbiAmJiBjb250aWdEYXRhLmFjY2Vzc2lvbiAhPSAndW5rbm93bicgPyBjb250aWdEYXRhLmFjY2Vzc2lvbiA6IGNvbnRpZ0RhdGEuZW50cnlJZDtcbiAgICAgIGNociA9IGVuc3VyZVVuaXF1ZShjaHIsIG8uY2hyTGVuZ3Rocyk7XG4gICAgICBcbiAgICAgIGlmIChjb250aWdEYXRhLmxlbmd0aCkge1xuICAgICAgICBzaXplID0gY29udGlnRGF0YS5sZW5ndGg7XG4gICAgICAgIGlmIChzaXplICE9IGNvbnRpZ1NlcXVlbmNlLmxlbmd0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNlcXVlbmNlIGRhdGEgZm9yIGNvbnRpZyBcIitjaHIrXCIgZG9lcyBub3QgbWF0Y2ggbGVuZ3RoIFwiK3NpemUrXCJicCBmcm9tIGhlYWRlclwiKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2l6ZSA9IGNvbnRpZ1NlcXVlbmNlLmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgby5jaHJPcmRlci5wdXNoKGNocik7XG4gICAgICBvLmNockxlbmd0aHNbY2hyXSA9IHNpemU7XG4gICAgICBvLmdlbm9tZVNpemUgKz0gc2l6ZTtcbiAgICAgIFxuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUZlYXR1cmVUYWJsZShjaHIsIGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5kYXRhLnNlcXVlbmNlLnB1c2goY29udGlnU2VxdWVuY2UpO1xuICAgICAgXG4gICAgICBmaXJzdENvbnRpZyA9IGZpcnN0Q29udGlnIHx8IGNvbnRpZ0RhdGE7XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gc2VsZi5kYXRhLnNlcXVlbmNlLmpvaW4oJycpO1xuICAgIHNlbGYuY2FuR2V0U2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYuZm9ybWF0KCkuY3JlYXRlVHJhY2tzRnJvbUZlYXR1cmVzKCk7XG4gICAgXG4gICAgby5zcGVjaWVzID0gZmlyc3RDb250aWcuc291cmNlID8gZmlyc3RDb250aWcuc291cmNlWzBdLm9yZ2FuaXNtLnNwbGl0KFwiXFxuXCIpWzBdIDogJ0N1c3RvbSBHZW5vbWUnO1xuICAgIGlmIChmaXJzdENvbnRpZy5kYXRlKSB7IG8uYXNzZW1ibHlEYXRlID0gZmlyc3RDb250aWcuZGF0ZTsgfVxuICB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBHZW5CYW5rRm9ybWF0OyIsInZhciB0cmFja1V0aWxzID0gcmVxdWlyZSgnLi4vLi4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKTtcblxubW9kdWxlLmV4cG9ydHMucGFyc2VJbnQxMCA9IHRyYWNrVXRpbHMucGFyc2VJbnQxMDtcblxubW9kdWxlLmV4cG9ydHMuZGVlcENsb25lID0gZnVuY3Rpb24ob2JqKSB7IHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iaikpOyB9XG5cbm1vZHVsZS5leHBvcnRzLmxvZzEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBNYXRoLmxvZyh2YWwpIC8gTWF0aC5MTjEwOyB9XG5cbnZhciBzdHJpcCA9IG1vZHVsZS5leHBvcnRzLnN0cmlwID0gdHJhY2tVdGlscy5zdHJpcDtcblxubW9kdWxlLmV4cG9ydHMucm91bmRUb1BsYWNlcyA9IGZ1bmN0aW9uKG51bSwgZGVjKSB7IHJldHVybiBNYXRoLnJvdW5kKG51bSAqIE1hdGgucG93KDEwLCBkZWMpKSAvIE1hdGgucG93KDEwLCBkZWMpOyB9XG5cbi8qKioqXG4gKiBUaGVzZSBmdW5jdGlvbnMgYXJlIGNvbW1vbiBzdWJyb3V0aW5lcyBmb3IgcGFyc2luZyBHZW5CYW5rIGFuZCBvdGhlciBmb3JtYXRzIGJhc2VkIG9uIGNvbHVtbiBwb3NpdGlvbnNcbiAqKioqL1xuXG4vLyBTcGxpdHMgYSBtdWx0aWxpbmUgc3RyaW5nIGJlZm9yZSB0aGUgbGluZXMgdGhhdCBjb250YWluIGEgY2hhcmFjdGVyIGluIHRoZSBmaXJzdCBjb2x1bW5cbi8vIChhIFwidG9wIHRhZ1wiKSBpbiBhIEdlbkJhbmstc3R5bGUgdGV4dCBmaWxlXG5tb2R1bGUuZXhwb3J0cy50b3BUYWdzQXNBcnJheSA9IGZ1bmN0aW9uKGZpZWxkKSB7XG4gIHJldHVybiBmaWVsZC5yZXBsYWNlKC9cXG4oW0EtWmEtelxcL1xcKl0pL2csIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xufVxuXG4vLyBTcGxpdHMgYSBtdWx0aWxpbmUgc3RyaW5nIGJlZm9yZSB0aGUgbGluZXMgdGhhdCBjb250YWluIGEgY2hhcmFjdGVyIG5vdCBpbiB0aGUgZmlyc3QgY29sdW1uXG4vLyBidXQgd2l0aGluIHRoZSBuZXh0IHRhZ1NpemUgY29sdW1ucywgd2hpY2ggaXMgYSBcInN1YiB0YWdcIiBpbiBhIEdlbkJhbmstc3R5bGUgdGV4dCBmaWxlXG5tb2R1bGUuZXhwb3J0cy5zdWJUYWdzQXNBcnJheSA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7XG4gIGlmICghaXNGaW5pdGUodGFnU2l6ZSkgfHwgdGFnU2l6ZSA8IDIpIHsgdGhyb3cgXCJpbnZhbGlkIHRhZ1NpemVcIjsgfVxuICB2YXIgcmUgPSBuZXcgUmVnRXhwKFwiXFxcXG4oXFxcXHN7MSxcIiArICh0YWdTaXplIC0gMSkgKyBcIn1cXFxcUylcIiwgXCJnXCIpO1xuICByZXR1cm4gZmllbGQucmVwbGFjZShyZSwgXCJcXG5cXDAwMSQxXCIpLnNwbGl0KFwiXFwwMDFcIik7XG59XG5cbi8vIFJldHVybnMgYSBuZXcgc3RyaW5nIHdpdGggdGhlIGZpcnN0IHRhZ1NpemUgY29sdW1ucyBmcm9tIGZpZWxkIHJlbW92ZWRcbm1vZHVsZS5leHBvcnRzLmZldGNoRmllbGQgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkge1xuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAxKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgdmFyIHJlID0gbmV3IFJlZ0V4cChcIihefFxcXFxuKS57MCxcIiArIHRhZ1NpemUgKyBcIn1cIiwgXCJnXCIpO1xuICByZXR1cm4gc3RyaXAoZmllbGQucmVwbGFjZShyZSwgXCIkMVwiKSk7XG59XG5cbi8vIEdldHMgYSB0YWcgZnJvbSBhIGZpZWxkIGJ5IHRyaW1taW5nIGl0IG91dCBvZiB0aGUgZmlyc3QgdGFnU2l6ZSBjaGFyYWN0ZXJzIG9mIHRoZSBmaWVsZFxubW9kdWxlLmV4cG9ydHMuZ2V0VGFnID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHsgXG4gIGlmICghaXNGaW5pdGUodGFnU2l6ZSkgfHwgdGFnU2l6ZSA8IDEpIHsgdGhyb3cgXCJpbnZhbGlkIHRhZ1NpemVcIjsgfVxuICByZXR1cm4gc3RyaXAoZmllbGQuc3Vic3RyaW5nKDAsIHRhZ1NpemUpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG4vKioqKlxuICogRW5kIEdlbkJhbmsgYW5kIGNvbHVtbi1iYXNlZCBmb3JtYXQgaGVscGVyc1xuICoqKiovXG5cbi8vIEdpdmVuIGEgaGFzaCBhbmQgYSBwcmVzdW1wdGl2ZSBuZXcga2V5LCBhcHBlbmRzIGEgY291bnRlciB0byB0aGUga2V5IHVudGlsIGl0IGlzIGFjdHVhbGx5IGFuIHVudXNlZCBrZXlcbm1vZHVsZS5leHBvcnRzLmVuc3VyZVVuaXF1ZSA9IGZ1bmN0aW9uKGtleSwgaGFzaCkge1xuICB2YXIgaSA9IDEsIGtleUNoZWNrID0ga2V5O1xuICB3aGlsZSAodHlwZW9mIGhhc2hba2V5Q2hlY2tdICE9ICd1bmRlZmluZWQnKSB7IGtleUNoZWNrID0ga2V5ICsgJ18nICsgaSsrOyB9XG4gIHJldHVybiBrZXlDaGVjaztcbn1cblxuLy8gR2l2ZW4gYSBoYXNoIHdpdGggb3B0aW9uIG5hbWVzIGFuZCB2YWx1ZXMsIGZvcm1hdHMgaXQgaW4gQkVEIHRyYWNrIGxpbmUgZm9ybWF0IChzaW1pbGFyIHRvIEhUTUwgZWxlbWVudCBhdHRyaWJ1dGVzKVxubW9kdWxlLmV4cG9ydHMub3B0c0FzVHJhY2tMaW5lID0gZnVuY3Rpb24ob3B0aGFzaCkge1xuICByZXR1cm4gXy5tYXAob3B0aGFzaCwgZnVuY3Rpb24odiwgaykgeyByZXR1cm4gayArICc9XCInICsgdi50b1N0cmluZygpLnJlcGxhY2UoL1wiL2csICcnKSArICdcIic7IH0pLmpvaW4oJyAnKTtcbn0iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCl7Z2xvYmFsLndpbmRvdz1nbG9iYWwud2luZG93fHxnbG9iYWw7Z2xvYmFsLndpbmRvdy5kb2N1bWVudD1nbG9iYWwud2luZG93LmRvY3VtZW50fHx7fTsoZnVuY3Rpb24oYSxiKXtmdW5jdGlvbiBOKCl7dHJ5e3JldHVybiBuZXcgYS5BY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTEhUVFBcIil9Y2F0Y2goYil7fX1mdW5jdGlvbiBNKCl7dHJ5e3JldHVybiBuZXcgYS5YTUxIdHRwUmVxdWVzdH1jYXRjaChiKXt9fWZ1bmN0aW9uIEkoYSxjKXtpZihhLmRhdGFGaWx0ZXIpe2M9YS5kYXRhRmlsdGVyKGMsYS5kYXRhVHlwZSl9dmFyIGQ9YS5kYXRhVHlwZXMsZT17fSxnLGgsaT1kLmxlbmd0aCxqLGs9ZFswXSxsLG0sbixvLHA7Zm9yKGc9MTtnPGk7ZysrKXtpZihnPT09MSl7Zm9yKGggaW4gYS5jb252ZXJ0ZXJzKXtpZih0eXBlb2YgaD09PVwic3RyaW5nXCIpe2VbaC50b0xvd2VyQ2FzZSgpXT1hLmNvbnZlcnRlcnNbaF19fX1sPWs7az1kW2ddO2lmKGs9PT1cIipcIil7az1sfWVsc2UgaWYobCE9PVwiKlwiJiZsIT09ayl7bT1sK1wiIFwiK2s7bj1lW21dfHxlW1wiKiBcIitrXTtpZighbil7cD1iO2ZvcihvIGluIGUpe2o9by5zcGxpdChcIiBcIik7aWYoalswXT09PWx8fGpbMF09PT1cIipcIil7cD1lW2pbMV0rXCIgXCIra107aWYocCl7bz1lW29dO2lmKG89PT10cnVlKXtuPXB9ZWxzZSBpZihwPT09dHJ1ZSl7bj1vfWJyZWFrfX19fWlmKCEobnx8cCkpe2YuZXJyb3IoXCJObyBjb252ZXJzaW9uIGZyb20gXCIrbS5yZXBsYWNlKFwiIFwiLFwiIHRvIFwiKSl9aWYobiE9PXRydWUpe2M9bj9uKGMpOnAobyhjKSl9fX1yZXR1cm4gY31mdW5jdGlvbiBIKGEsYyxkKXt2YXIgZT1hLmNvbnRlbnRzLGY9YS5kYXRhVHlwZXMsZz1hLnJlc3BvbnNlRmllbGRzLGgsaSxqLGs7Zm9yKGkgaW4gZyl7aWYoaSBpbiBkKXtjW2dbaV1dPWRbaV19fXdoaWxlKGZbMF09PT1cIipcIil7Zi5zaGlmdCgpO2lmKGg9PT1iKXtoPWEubWltZVR5cGV8fGMuZ2V0UmVzcG9uc2VIZWFkZXIoXCJjb250ZW50LXR5cGVcIil9fWlmKGgpe2ZvcihpIGluIGUpe2lmKGVbaV0mJmVbaV0udGVzdChoKSl7Zi51bnNoaWZ0KGkpO2JyZWFrfX19aWYoZlswXWluIGQpe2o9ZlswXX1lbHNle2ZvcihpIGluIGQpe2lmKCFmWzBdfHxhLmNvbnZlcnRlcnNbaStcIiBcIitmWzBdXSl7aj1pO2JyZWFrfWlmKCFrKXtrPWl9fWo9anx8a31pZihqKXtpZihqIT09ZlswXSl7Zi51bnNoaWZ0KGopfXJldHVybiBkW2pdfX1mdW5jdGlvbiBHKGEsYixjLGQpe2lmKGYuaXNBcnJheShiKSl7Zi5lYWNoKGIsZnVuY3Rpb24oYixlKXtpZihjfHxqLnRlc3QoYSkpe2QoYSxlKX1lbHNle0coYStcIltcIisodHlwZW9mIGU9PT1cIm9iamVjdFwifHxmLmlzQXJyYXkoZSk/YjpcIlwiKStcIl1cIixlLGMsZCl9fSl9ZWxzZSBpZighYyYmYiE9bnVsbCYmdHlwZW9mIGI9PT1cIm9iamVjdFwiKXtmb3IodmFyIGUgaW4gYil7RyhhK1wiW1wiK2UrXCJdXCIsYltlXSxjLGQpfX1lbHNle2QoYSxiKX19ZnVuY3Rpb24gRihhLGMpe3ZhciBkLGUsZz1mLmFqYXhTZXR0aW5ncy5mbGF0T3B0aW9uc3x8e307Zm9yKGQgaW4gYyl7aWYoY1tkXSE9PWIpeyhnW2RdP2E6ZXx8KGU9e30pKVtkXT1jW2RdfX1pZihlKXtmLmV4dGVuZCh0cnVlLGEsZSl9fWZ1bmN0aW9uIEUoYSxjLGQsZSxmLGcpe2Y9Znx8Yy5kYXRhVHlwZXNbMF07Zz1nfHx7fTtnW2ZdPXRydWU7dmFyIGg9YVtmXSxpPTAsaj1oP2gubGVuZ3RoOjAsaz1hPT09eSxsO2Zvcig7aTxqJiYoa3x8IWwpO2krKyl7bD1oW2ldKGMsZCxlKTtpZih0eXBlb2YgbD09PVwic3RyaW5nXCIpe2lmKCFrfHxnW2xdKXtsPWJ9ZWxzZXtjLmRhdGFUeXBlcy51bnNoaWZ0KGwpO2w9RShhLGMsZCxlLGwsZyl9fX1pZigoa3x8IWwpJiYhZ1tcIipcIl0pe2w9RShhLGMsZCxlLFwiKlwiLGcpfXJldHVybiBsfWZ1bmN0aW9uIEQoYSl7cmV0dXJuIGZ1bmN0aW9uKGIsYyl7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wiKXtjPWI7Yj1cIipcIn1pZihmLmlzRnVuY3Rpb24oYykpe3ZhciBkPWIudG9Mb3dlckNhc2UoKS5zcGxpdCh1KSxlPTAsZz1kLmxlbmd0aCxoLGksajtmb3IoO2U8ZztlKyspe2g9ZFtlXTtqPS9eXFwrLy50ZXN0KGgpO2lmKGope2g9aC5zdWJzdHIoMSl8fFwiKlwifWk9YVtoXT1hW2hdfHxbXTtpW2o/XCJ1bnNoaWZ0XCI6XCJwdXNoXCJdKGMpfX19fXZhciBjPWEuZG9jdW1lbnQsZD1hLm5hdmlnYXRvcixlPWEubG9jYXRpb247dmFyIGY9ZnVuY3Rpb24oKXtmdW5jdGlvbiBKKCl7aWYoZS5pc1JlYWR5KXtyZXR1cm59dHJ5e2MuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsKFwibGVmdFwiKX1jYXRjaChhKXtzZXRUaW1lb3V0KEosMSk7cmV0dXJufWUucmVhZHkoKX12YXIgZT1mdW5jdGlvbihhLGIpe3JldHVybiBuZXcgZS5mbi5pbml0KGEsYixoKX0sZj1hLmpRdWVyeSxnPWEuJCxoLGk9L14oPzpbXjxdKig8W1xcd1xcV10rPilbXj5dKiR8IyhbXFx3XFwtXSopJCkvLGo9L1xcUy8saz0vXlxccysvLGw9L1xccyskLyxtPS9cXGQvLG49L148KFxcdyspXFxzKlxcLz8+KD86PFxcL1xcMT4pPyQvLG89L15bXFxdLDp7fVxcc10qJC8scD0vXFxcXCg/OltcIlxcXFxcXC9iZm5ydF18dVswLTlhLWZBLUZdezR9KS9nLHE9L1wiW15cIlxcXFxcXG5cXHJdKlwifHRydWV8ZmFsc2V8bnVsbHwtP1xcZCsoPzpcXC5cXGQqKT8oPzpbZUVdWytcXC1dP1xcZCspPy9nLHI9Lyg/Ol58OnwsKSg/OlxccypcXFspKy9nLHM9Lyh3ZWJraXQpWyBcXC9dKFtcXHcuXSspLyx0PS8ob3BlcmEpKD86Lip2ZXJzaW9uKT9bIFxcL10oW1xcdy5dKykvLHU9Lyhtc2llKSAoW1xcdy5dKykvLHY9Lyhtb3ppbGxhKSg/Oi4qPyBydjooW1xcdy5dKykpPy8sdz0vLShbYS16XSkvaWcseD1mdW5jdGlvbihhLGIpe3JldHVybiBiLnRvVXBwZXJDYXNlKCl9LHk9ZC51c2VyQWdlbnQseixBLEIsQz1PYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLEQ9T2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSxFPUFycmF5LnByb3RvdHlwZS5wdXNoLEY9QXJyYXkucHJvdG90eXBlLnNsaWNlLEc9U3RyaW5nLnByb3RvdHlwZS50cmltLEg9QXJyYXkucHJvdG90eXBlLmluZGV4T2YsST17fTtlLmZuPWUucHJvdG90eXBlPXtjb25zdHJ1Y3RvcjplLGluaXQ6ZnVuY3Rpb24oYSxkLGYpe3ZhciBnLGgsaixrO2lmKCFhKXtyZXR1cm4gdGhpc31pZihhLm5vZGVUeXBlKXt0aGlzLmNvbnRleHQ9dGhpc1swXT1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYoYT09PVwiYm9keVwiJiYhZCYmYy5ib2R5KXt0aGlzLmNvbnRleHQ9Yzt0aGlzWzBdPWMuYm9keTt0aGlzLnNlbGVjdG9yPWE7dGhpcy5sZW5ndGg9MTtyZXR1cm4gdGhpc31pZih0eXBlb2YgYT09PVwic3RyaW5nXCIpe2lmKGEuY2hhckF0KDApPT09XCI8XCImJmEuY2hhckF0KGEubGVuZ3RoLTEpPT09XCI+XCImJmEubGVuZ3RoPj0zKXtnPVtudWxsLGEsbnVsbF19ZWxzZXtnPWkuZXhlYyhhKX1pZihnJiYoZ1sxXXx8IWQpKXtpZihnWzFdKXtkPWQgaW5zdGFuY2VvZiBlP2RbMF06ZDtrPWQ/ZC5vd25lckRvY3VtZW50fHxkOmM7aj1uLmV4ZWMoYSk7aWYoail7aWYoZS5pc1BsYWluT2JqZWN0KGQpKXthPVtjLmNyZWF0ZUVsZW1lbnQoalsxXSldO2UuZm4uYXR0ci5jYWxsKGEsZCx0cnVlKX1lbHNle2E9W2suY3JlYXRlRWxlbWVudChqWzFdKV19fWVsc2V7aj1lLmJ1aWxkRnJhZ21lbnQoW2dbMV1dLFtrXSk7YT0oai5jYWNoZWFibGU/ZS5jbG9uZShqLmZyYWdtZW50KTpqLmZyYWdtZW50KS5jaGlsZE5vZGVzfXJldHVybiBlLm1lcmdlKHRoaXMsYSl9ZWxzZXtoPWMuZ2V0RWxlbWVudEJ5SWQoZ1syXSk7aWYoaCYmaC5wYXJlbnROb2RlKXtpZihoLmlkIT09Z1syXSl7cmV0dXJuIGYuZmluZChhKX10aGlzLmxlbmd0aD0xO3RoaXNbMF09aH10aGlzLmNvbnRleHQ9Yzt0aGlzLnNlbGVjdG9yPWE7cmV0dXJuIHRoaXN9fWVsc2UgaWYoIWR8fGQuanF1ZXJ5KXtyZXR1cm4oZHx8ZikuZmluZChhKX1lbHNle3JldHVybiB0aGlzLmNvbnN0cnVjdG9yKGQpLmZpbmQoYSl9fWVsc2UgaWYoZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gZi5yZWFkeShhKX1pZihhLnNlbGVjdG9yIT09Yil7dGhpcy5zZWxlY3Rvcj1hLnNlbGVjdG9yO3RoaXMuY29udGV4dD1hLmNvbnRleHR9cmV0dXJuIGUubWFrZUFycmF5KGEsdGhpcyl9LHNlbGVjdG9yOlwiXCIsanF1ZXJ5OlwiMS42LjNwcmVcIixsZW5ndGg6MCxzaXplOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubGVuZ3RofSx0b0FycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIEYuY2FsbCh0aGlzLDApfSxnZXQ6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/dGhpcy50b0FycmF5KCk6YTwwP3RoaXNbdGhpcy5sZW5ndGgrYV06dGhpc1thXX0scHVzaFN0YWNrOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD10aGlzLmNvbnN0cnVjdG9yKCk7aWYoZS5pc0FycmF5KGEpKXtFLmFwcGx5KGQsYSl9ZWxzZXtlLm1lcmdlKGQsYSl9ZC5wcmV2T2JqZWN0PXRoaXM7ZC5jb250ZXh0PXRoaXMuY29udGV4dDtpZihiPT09XCJmaW5kXCIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcisodGhpcy5zZWxlY3Rvcj9cIiBcIjpcIlwiKStjfWVsc2UgaWYoYil7ZC5zZWxlY3Rvcj10aGlzLnNlbGVjdG9yK1wiLlwiK2IrXCIoXCIrYytcIilcIn1yZXR1cm4gZH0sZWFjaDpmdW5jdGlvbihhLGIpe3JldHVybiBlLmVhY2godGhpcyxhLGIpfSxyZWFkeTpmdW5jdGlvbihhKXtlLmJpbmRSZWFkeSgpO0EuZG9uZShhKTtyZXR1cm4gdGhpc30sZXE6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT0tMT90aGlzLnNsaWNlKGEpOnRoaXMuc2xpY2UoYSwrYSsxKX0sZmlyc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgwKX0sbGFzdDpmdW5jdGlvbigpe3JldHVybiB0aGlzLmVxKC0xKX0sc2xpY2U6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soRi5hcHBseSh0aGlzLGFyZ3VtZW50cyksXCJzbGljZVwiLEYuY2FsbChhcmd1bWVudHMpLmpvaW4oXCIsXCIpKX0sbWFwOmZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLnB1c2hTdGFjayhlLm1hcCh0aGlzLGZ1bmN0aW9uKGIsYyl7cmV0dXJuIGEuY2FsbChiLGMsYil9KSl9LGVuZDpmdW5jdGlvbigpe3JldHVybiB0aGlzLnByZXZPYmplY3R8fHRoaXMuY29uc3RydWN0b3IobnVsbCl9LHB1c2g6RSxzb3J0OltdLnNvcnQsc3BsaWNlOltdLnNwbGljZX07ZS5mbi5pbml0LnByb3RvdHlwZT1lLmZuO2UuZXh0ZW5kPWUuZm4uZXh0ZW5kPWZ1bmN0aW9uKCl7dmFyIGEsYyxkLGYsZyxoLGk9YXJndW1lbnRzWzBdfHx7fSxqPTEsaz1hcmd1bWVudHMubGVuZ3RoLGw9ZmFsc2U7aWYodHlwZW9mIGk9PT1cImJvb2xlYW5cIil7bD1pO2k9YXJndW1lbnRzWzFdfHx7fTtqPTJ9aWYodHlwZW9mIGkhPT1cIm9iamVjdFwiJiYhZS5pc0Z1bmN0aW9uKGkpKXtpPXt9fWlmKGs9PT1qKXtpPXRoaXM7LS1qfWZvcig7ajxrO2orKyl7aWYoKGE9YXJndW1lbnRzW2pdKSE9bnVsbCl7Zm9yKGMgaW4gYSl7ZD1pW2NdO2Y9YVtjXTtpZihpPT09Zil7Y29udGludWV9aWYobCYmZiYmKGUuaXNQbGFpbk9iamVjdChmKXx8KGc9ZS5pc0FycmF5KGYpKSkpe2lmKGcpe2c9ZmFsc2U7aD1kJiZlLmlzQXJyYXkoZCk/ZDpbXX1lbHNle2g9ZCYmZS5pc1BsYWluT2JqZWN0KGQpP2Q6e319aVtjXT1lLmV4dGVuZChsLGgsZil9ZWxzZSBpZihmIT09Yil7aVtjXT1mfX19fXJldHVybiBpfTtlLmV4dGVuZCh7bm9Db25mbGljdDpmdW5jdGlvbihiKXtpZihhLiQ9PT1lKXthLiQ9Z31pZihiJiZhLmpRdWVyeT09PWUpe2EualF1ZXJ5PWZ9cmV0dXJuIGV9LGlzUmVhZHk6ZmFsc2UscmVhZHlXYWl0OjEsaG9sZFJlYWR5OmZ1bmN0aW9uKGEpe2lmKGEpe2UucmVhZHlXYWl0Kyt9ZWxzZXtlLnJlYWR5KHRydWUpfX0scmVhZHk6ZnVuY3Rpb24oYSl7aWYoYT09PXRydWUmJiEtLWUucmVhZHlXYWl0fHxhIT09dHJ1ZSYmIWUuaXNSZWFkeSl7aWYoIWMuYm9keSl7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1lLmlzUmVhZHk9dHJ1ZTtpZihhIT09dHJ1ZSYmLS1lLnJlYWR5V2FpdD4wKXtyZXR1cm59QS5yZXNvbHZlV2l0aChjLFtlXSk7aWYoZS5mbi50cmlnZ2VyKXtlKGMpLnRyaWdnZXIoXCJyZWFkeVwiKS51bmJpbmQoXCJyZWFkeVwiKX19fSxiaW5kUmVhZHk6ZnVuY3Rpb24oKXtpZihBKXtyZXR1cm59QT1lLl9EZWZlcnJlZCgpO2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1pZihjLmFkZEV2ZW50TGlzdGVuZXIpe2MuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTthLmFkZEV2ZW50TGlzdGVuZXIoXCJsb2FkXCIsZS5yZWFkeSxmYWxzZSl9ZWxzZSBpZihjLmF0dGFjaEV2ZW50KXtjLmF0dGFjaEV2ZW50KFwib25yZWFkeXN0YXRlY2hhbmdlXCIsQik7YS5hdHRhY2hFdmVudChcIm9ubG9hZFwiLGUucmVhZHkpO3ZhciBiPWZhbHNlO3RyeXtiPWEuZnJhbWVFbGVtZW50PT1udWxsfWNhdGNoKGQpe31pZihjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbCYmYil7SigpfX19LGlzRnVuY3Rpb246ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiZnVuY3Rpb25cIn0saXNBcnJheTpBcnJheS5pc0FycmF5fHxmdW5jdGlvbihhKXtyZXR1cm4gZS50eXBlKGEpPT09XCJhcnJheVwifSxpc1dpbmRvdzpmdW5jdGlvbihhKXtyZXR1cm4gYSYmdHlwZW9mIGE9PT1cIm9iamVjdFwiJiZcInNldEludGVydmFsXCJpbiBhfSxpc05hTjpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbHx8IW0udGVzdChhKXx8aXNOYU4oYSl9LHR5cGU6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/U3RyaW5nKGEpOklbQy5jYWxsKGEpXXx8XCJvYmplY3RcIn0saXNQbGFpbk9iamVjdDpmdW5jdGlvbihhKXtpZighYXx8ZS50eXBlKGEpIT09XCJvYmplY3RcInx8YS5ub2RlVHlwZXx8ZS5pc1dpbmRvdyhhKSl7cmV0dXJuIGZhbHNlfWlmKGEuY29uc3RydWN0b3ImJiFELmNhbGwoYSxcImNvbnN0cnVjdG9yXCIpJiYhRC5jYWxsKGEuY29uc3RydWN0b3IucHJvdG90eXBlLFwiaXNQcm90b3R5cGVPZlwiKSl7cmV0dXJuIGZhbHNlfXZhciBjO2ZvcihjIGluIGEpe31yZXR1cm4gYz09PWJ8fEQuY2FsbChhLGMpfSxpc0VtcHR5T2JqZWN0OmZ1bmN0aW9uKGEpe2Zvcih2YXIgYiBpbiBhKXtyZXR1cm4gZmFsc2V9cmV0dXJuIHRydWV9LGVycm9yOmZ1bmN0aW9uKGEpe3Rocm93IGF9LHBhcnNlSlNPTjpmdW5jdGlvbihiKXtpZih0eXBlb2YgYiE9PVwic3RyaW5nXCJ8fCFiKXtyZXR1cm4gbnVsbH1iPWUudHJpbShiKTtpZihhLkpTT04mJmEuSlNPTi5wYXJzZSl7cmV0dXJuIGEuSlNPTi5wYXJzZShiKX1pZihvLnRlc3QoYi5yZXBsYWNlKHAsXCJAXCIpLnJlcGxhY2UocSxcIl1cIikucmVwbGFjZShyLFwiXCIpKSl7cmV0dXJuKG5ldyBGdW5jdGlvbihcInJldHVybiBcIitiKSkoKX1lLmVycm9yKFwiSW52YWxpZCBKU09OOiBcIitiKX0scGFyc2VYTUw6ZnVuY3Rpb24oYyl7dmFyIGQsZjt0cnl7aWYoYS5ET01QYXJzZXIpe2Y9bmV3IERPTVBhcnNlcjtkPWYucGFyc2VGcm9tU3RyaW5nKGMsXCJ0ZXh0L3htbFwiKX1lbHNle2Q9bmV3IEFjdGl2ZVhPYmplY3QoXCJNaWNyb3NvZnQuWE1MRE9NXCIpO2QuYXN5bmM9XCJmYWxzZVwiO2QubG9hZFhNTChjKX19Y2F0Y2goZyl7ZD1ifWlmKCFkfHwhZC5kb2N1bWVudEVsZW1lbnR8fGQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoXCJwYXJzZXJlcnJvclwiKS5sZW5ndGgpe2UuZXJyb3IoXCJJbnZhbGlkIFhNTDogXCIrYyl9cmV0dXJuIGR9LG5vb3A6ZnVuY3Rpb24oKXt9LGdsb2JhbEV2YWw6ZnVuY3Rpb24oYil7aWYoYiYmai50ZXN0KGIpKXsoYS5leGVjU2NyaXB0fHxmdW5jdGlvbihiKXthW1wiZXZhbFwiXS5jYWxsKGEsYil9KShiKX19LGNhbWVsQ2FzZTpmdW5jdGlvbihhKXtyZXR1cm4gYS5yZXBsYWNlKHcseCl9LG5vZGVOYW1lOmZ1bmN0aW9uKGEsYil7cmV0dXJuIGEubm9kZU5hbWUmJmEubm9kZU5hbWUudG9VcHBlckNhc2UoKT09PWIudG9VcHBlckNhc2UoKX0sZWFjaDpmdW5jdGlvbihhLGMsZCl7dmFyIGYsZz0wLGg9YS5sZW5ndGgsaT1oPT09Ynx8ZS5pc0Z1bmN0aW9uKGEpO2lmKGQpe2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuYXBwbHkoYVtmXSxkKT09PWZhbHNlKXticmVha319fWVsc2V7Zm9yKDtnPGg7KXtpZihjLmFwcGx5KGFbZysrXSxkKT09PWZhbHNlKXticmVha319fX1lbHNle2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuY2FsbChhW2ZdLGYsYVtmXSk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5jYWxsKGFbZ10sZyxhW2crK10pPT09ZmFsc2Upe2JyZWFrfX19fXJldHVybiBhfSx0cmltOkc/ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/XCJcIjpHLmNhbGwoYSl9OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6YS50b1N0cmluZygpLnJlcGxhY2UoayxcIlwiKS5yZXBsYWNlKGwsXCJcIil9LG1ha2VBcnJheTpmdW5jdGlvbihhLGIpe3ZhciBjPWJ8fFtdO2lmKGEhPW51bGwpe3ZhciBkPWUudHlwZShhKTtpZihhLmxlbmd0aD09bnVsbHx8ZD09PVwic3RyaW5nXCJ8fGQ9PT1cImZ1bmN0aW9uXCJ8fGQ9PT1cInJlZ2V4cFwifHxlLmlzV2luZG93KGEpKXtFLmNhbGwoYyxhKX1lbHNle2UubWVyZ2UoYyxhKX19cmV0dXJuIGN9LGluQXJyYXk6ZnVuY3Rpb24oYSxiKXtpZihIKXtyZXR1cm4gSC5jYWxsKGIsYSl9Zm9yKHZhciBjPTAsZD1iLmxlbmd0aDtjPGQ7YysrKXtpZihiW2NdPT09YSl7cmV0dXJuIGN9fXJldHVybi0xfSxtZXJnZTpmdW5jdGlvbihhLGMpe3ZhciBkPWEubGVuZ3RoLGU9MDtpZih0eXBlb2YgYy5sZW5ndGg9PT1cIm51bWJlclwiKXtmb3IodmFyIGY9Yy5sZW5ndGg7ZTxmO2UrKyl7YVtkKytdPWNbZV19fWVsc2V7d2hpbGUoY1tlXSE9PWIpe2FbZCsrXT1jW2UrK119fWEubGVuZ3RoPWQ7cmV0dXJuIGF9LGdyZXA6ZnVuY3Rpb24oYSxiLGMpe3ZhciBkPVtdLGU7Yz0hIWM7Zm9yKHZhciBmPTAsZz1hLmxlbmd0aDtmPGc7ZisrKXtlPSEhYihhW2ZdLGYpO2lmKGMhPT1lKXtkLnB1c2goYVtmXSl9fXJldHVybiBkfSxtYXA6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGcsaD1bXSxpPTAsaj1hLmxlbmd0aCxrPWEgaW5zdGFuY2VvZiBlfHxqIT09YiYmdHlwZW9mIGo9PT1cIm51bWJlclwiJiYoaj4wJiZhWzBdJiZhW2otMV18fGo9PT0wfHxlLmlzQXJyYXkoYSkpO2lmKGspe2Zvcig7aTxqO2krKyl7Zj1jKGFbaV0saSxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19ZWxzZXtmb3IoZyBpbiBhKXtmPWMoYVtnXSxnLGQpO2lmKGYhPW51bGwpe2hbaC5sZW5ndGhdPWZ9fX1yZXR1cm4gaC5jb25jYXQuYXBwbHkoW10saCl9LGd1aWQ6MSxwcm94eTpmdW5jdGlvbihhLGMpe2lmKHR5cGVvZiBjPT09XCJzdHJpbmdcIil7dmFyIGQ9YVtjXTtjPWE7YT1kfWlmKCFlLmlzRnVuY3Rpb24oYSkpe3JldHVybiBifXZhciBmPUYuY2FsbChhcmd1bWVudHMsMiksZz1mdW5jdGlvbigpe3JldHVybiBhLmFwcGx5KGMsZi5jb25jYXQoRi5jYWxsKGFyZ3VtZW50cykpKX07Zy5ndWlkPWEuZ3VpZD1hLmd1aWR8fGcuZ3VpZHx8ZS5ndWlkKys7cmV0dXJuIGd9LGFjY2VzczpmdW5jdGlvbihhLGMsZCxmLGcsaCl7dmFyIGk9YS5sZW5ndGg7aWYodHlwZW9mIGM9PT1cIm9iamVjdFwiKXtmb3IodmFyIGogaW4gYyl7ZS5hY2Nlc3MoYSxqLGNbal0sZixnLGQpfXJldHVybiBhfWlmKGQhPT1iKXtmPSFoJiZmJiZlLmlzRnVuY3Rpb24oZCk7Zm9yKHZhciBrPTA7azxpO2srKyl7ZyhhW2tdLGMsZj9kLmNhbGwoYVtrXSxrLGcoYVtrXSxjKSk6ZCxoKX1yZXR1cm4gYX1yZXR1cm4gaT9nKGFbMF0sYyk6Yn0sbm93OmZ1bmN0aW9uKCl7cmV0dXJuKG5ldyBEYXRlKS5nZXRUaW1lKCl9LHVhTWF0Y2g6ZnVuY3Rpb24oYSl7YT1hLnRvTG93ZXJDYXNlKCk7dmFyIGI9cy5leGVjKGEpfHx0LmV4ZWMoYSl8fHUuZXhlYyhhKXx8YS5pbmRleE9mKFwiY29tcGF0aWJsZVwiKTwwJiZ2LmV4ZWMoYSl8fFtdO3JldHVybnticm93c2VyOmJbMV18fFwiXCIsdmVyc2lvbjpiWzJdfHxcIjBcIn19LHN1YjpmdW5jdGlvbigpe2Z1bmN0aW9uIGEoYixjKXtyZXR1cm4gbmV3IGEuZm4uaW5pdChiLGMpfWUuZXh0ZW5kKHRydWUsYSx0aGlzKTthLnN1cGVyY2xhc3M9dGhpczthLmZuPWEucHJvdG90eXBlPXRoaXMoKTthLmZuLmNvbnN0cnVjdG9yPWE7YS5zdWI9dGhpcy5zdWI7YS5mbi5pbml0PWZ1bmN0aW9uIGQoYyxkKXtpZihkJiZkIGluc3RhbmNlb2YgZSYmIShkIGluc3RhbmNlb2YgYSkpe2Q9YShkKX1yZXR1cm4gZS5mbi5pbml0LmNhbGwodGhpcyxjLGQsYil9O2EuZm4uaW5pdC5wcm90b3R5cGU9YS5mbjt2YXIgYj1hKGMpO3JldHVybiBhfSxicm93c2VyOnt9fSk7ZS5lYWNoKFwiQm9vbGVhbiBOdW1iZXIgU3RyaW5nIEZ1bmN0aW9uIEFycmF5IERhdGUgUmVnRXhwIE9iamVjdFwiLnNwbGl0KFwiIFwiKSxmdW5jdGlvbihhLGIpe0lbXCJbb2JqZWN0IFwiK2IrXCJdXCJdPWIudG9Mb3dlckNhc2UoKX0pO3o9ZS51YU1hdGNoKHkpO2lmKHouYnJvd3Nlcil7ZS5icm93c2VyW3ouYnJvd3Nlcl09dHJ1ZTtlLmJyb3dzZXIudmVyc2lvbj16LnZlcnNpb259aWYoZS5icm93c2VyLndlYmtpdCl7ZS5icm93c2VyLnNhZmFyaT10cnVlfWlmKGoudGVzdChcIsKgXCIpKXtrPS9eW1xcc1xceEEwXSsvO2w9L1tcXHNcXHhBMF0rJC99aD1lKGMpO2lmKGMuYWRkRXZlbnRMaXN0ZW5lcil7Qj1mdW5jdGlvbigpe2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTtlLnJlYWR5KCl9fWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Qj1mdW5jdGlvbigpe2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7Yy5kZXRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2UucmVhZHkoKX19fXJldHVybiBlfSgpO3ZhciBnPVwiZG9uZSBmYWlsIGlzUmVzb2x2ZWQgaXNSZWplY3RlZCBwcm9taXNlIHRoZW4gYWx3YXlzIHBpcGVcIi5zcGxpdChcIiBcIiksaD1bXS5zbGljZTtmLmV4dGVuZCh7X0RlZmVycmVkOmZ1bmN0aW9uKCl7dmFyIGE9W10sYixjLGQsZT17ZG9uZTpmdW5jdGlvbigpe2lmKCFkKXt2YXIgYz1hcmd1bWVudHMsZyxoLGksaixrO2lmKGIpe2s9YjtiPTB9Zm9yKGc9MCxoPWMubGVuZ3RoO2c8aDtnKyspe2k9Y1tnXTtqPWYudHlwZShpKTtpZihqPT09XCJhcnJheVwiKXtlLmRvbmUuYXBwbHkoZSxpKX1lbHNlIGlmKGo9PT1cImZ1bmN0aW9uXCIpe2EucHVzaChpKX19aWYoayl7ZS5yZXNvbHZlV2l0aChrWzBdLGtbMV0pfX1yZXR1cm4gdGhpc30scmVzb2x2ZVdpdGg6ZnVuY3Rpb24oZSxmKXtpZighZCYmIWImJiFjKXtmPWZ8fFtdO2M9MTt0cnl7d2hpbGUoYVswXSl7YS5zaGlmdCgpLmFwcGx5KGUsZil9fWZpbmFsbHl7Yj1bZSxmXTtjPTB9fXJldHVybiB0aGlzfSxyZXNvbHZlOmZ1bmN0aW9uKCl7ZS5yZXNvbHZlV2l0aCh0aGlzLGFyZ3VtZW50cyk7cmV0dXJuIHRoaXN9LGlzUmVzb2x2ZWQ6ZnVuY3Rpb24oKXtyZXR1cm4hIShjfHxiKX0sY2FuY2VsOmZ1bmN0aW9uKCl7ZD0xO2E9W107cmV0dXJuIHRoaXN9fTtyZXR1cm4gZX0sRGVmZXJyZWQ6ZnVuY3Rpb24oYSl7dmFyIGI9Zi5fRGVmZXJyZWQoKSxjPWYuX0RlZmVycmVkKCksZDtmLmV4dGVuZChiLHt0aGVuOmZ1bmN0aW9uKGEsYyl7Yi5kb25lKGEpLmZhaWwoYyk7cmV0dXJuIHRoaXN9LGFsd2F5czpmdW5jdGlvbigpe3JldHVybiBiLmRvbmUuYXBwbHkoYixhcmd1bWVudHMpLmZhaWwuYXBwbHkodGhpcyxhcmd1bWVudHMpfSxmYWlsOmMuZG9uZSxyZWplY3RXaXRoOmMucmVzb2x2ZVdpdGgscmVqZWN0OmMucmVzb2x2ZSxpc1JlamVjdGVkOmMuaXNSZXNvbHZlZCxwaXBlOmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuRGVmZXJyZWQoZnVuY3Rpb24oZCl7Zi5lYWNoKHtkb25lOlthLFwicmVzb2x2ZVwiXSxmYWlsOltjLFwicmVqZWN0XCJdfSxmdW5jdGlvbihhLGMpe3ZhciBlPWNbMF0sZz1jWzFdLGg7aWYoZi5pc0Z1bmN0aW9uKGUpKXtiW2FdKGZ1bmN0aW9uKCl7aD1lLmFwcGx5KHRoaXMsYXJndW1lbnRzKTtpZihoJiZmLmlzRnVuY3Rpb24oaC5wcm9taXNlKSl7aC5wcm9taXNlKCkudGhlbihkLnJlc29sdmUsZC5yZWplY3QpfWVsc2V7ZFtnK1wiV2l0aFwiXSh0aGlzPT09Yj9kOnRoaXMsW2hdKX19KX1lbHNle2JbYV0oZFtnXSl9fSl9KS5wcm9taXNlKCl9LHByb21pc2U6ZnVuY3Rpb24oYSl7aWYoYT09bnVsbCl7aWYoZCl7cmV0dXJuIGR9ZD1hPXt9fXZhciBjPWcubGVuZ3RoO3doaWxlKGMtLSl7YVtnW2NdXT1iW2dbY11dfXJldHVybiBhfX0pO2IuZG9uZShjLmNhbmNlbCkuZmFpbChiLmNhbmNlbCk7ZGVsZXRlIGIuY2FuY2VsO2lmKGEpe2EuY2FsbChiLGIpfXJldHVybiBifSx3aGVuOmZ1bmN0aW9uKGEpe2Z1bmN0aW9uIGkoYSl7cmV0dXJuIGZ1bmN0aW9uKGMpe2JbYV09YXJndW1lbnRzLmxlbmd0aD4xP2guY2FsbChhcmd1bWVudHMsMCk6YztpZighLS1lKXtnLnJlc29sdmVXaXRoKGcsaC5jYWxsKGIsMCkpfX19dmFyIGI9YXJndW1lbnRzLGM9MCxkPWIubGVuZ3RoLGU9ZCxnPWQ8PTEmJmEmJmYuaXNGdW5jdGlvbihhLnByb21pc2UpP2E6Zi5EZWZlcnJlZCgpO2lmKGQ+MSl7Zm9yKDtjPGQ7YysrKXtpZihiW2NdJiZmLmlzRnVuY3Rpb24oYltjXS5wcm9taXNlKSl7YltjXS5wcm9taXNlKCkudGhlbihpKGMpLGcucmVqZWN0KX1lbHNley0tZX19aWYoIWUpe2cucmVzb2x2ZVdpdGgoZyxiKX19ZWxzZSBpZihnIT09YSl7Zy5yZXNvbHZlV2l0aChnLGQ/W2FdOltdKX1yZXR1cm4gZy5wcm9taXNlKCl9fSk7Zi5zdXBwb3J0PWYuc3VwcG9ydHx8e307dmFyIGk9LyUyMC9nLGo9L1xcW1xcXSQvLGs9L1xccj9cXG4vZyxsPS8jLiokLyxtPS9eKC4qPyk6WyBcXHRdKihbXlxcclxcbl0qKVxccj8kL21nLG49L14oPzpjb2xvcnxkYXRlfGRhdGV0aW1lfGVtYWlsfGhpZGRlbnxtb250aHxudW1iZXJ8cGFzc3dvcmR8cmFuZ2V8c2VhcmNofHRlbHx0ZXh0fHRpbWV8dXJsfHdlZWspJC9pLG89L14oPzphYm91dHxhcHB8YXBwXFwtc3RvcmFnZXwuK1xcLWV4dGVuc2lvbnxmaWxlfHJlc3x3aWRnZXQpOiQvLHA9L14oPzpHRVR8SEVBRCkkLyxxPS9eXFwvXFwvLyxyPS9cXD8vLHM9LzxzY3JpcHRcXGJbXjxdKig/Oig/ITxcXC9zY3JpcHQ+KTxbXjxdKikqPFxcL3NjcmlwdD4vZ2ksdD0vXig/OnNlbGVjdHx0ZXh0YXJlYSkvaSx1PS9cXHMrLyx2PS8oWz8mXSlfPVteJl0qLyx3PS9eKFtcXHdcXCtcXC5cXC1dKzopKD86XFwvXFwvKFteXFwvPyM6XSopKD86OihcXGQrKSk/KT8vLHg9Zi5mbi5sb2FkLHk9e30sej17fSxBLEI7dHJ5e0E9ZS5ocmVmfWNhdGNoKEMpe0E9Yy5jcmVhdGVFbGVtZW50KFwiYVwiKTtBLmhyZWY9XCJcIjtBPUEuaHJlZn1CPXcuZXhlYyhBLnRvTG93ZXJDYXNlKCkpfHxbXTtmLmZuLmV4dGVuZCh7bG9hZDpmdW5jdGlvbihhLGMsZCl7aWYodHlwZW9mIGEhPT1cInN0cmluZ1wiJiZ4KXtyZXR1cm4geC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9ZWxzZSBpZighdGhpcy5sZW5ndGgpe3JldHVybiB0aGlzfXZhciBlPWEuaW5kZXhPZihcIiBcIik7aWYoZT49MCl7dmFyIGc9YS5zbGljZShlLGEubGVuZ3RoKTthPWEuc2xpY2UoMCxlKX12YXIgaD1cIkdFVFwiO2lmKGMpe2lmKGYuaXNGdW5jdGlvbihjKSl7ZD1jO2M9Yn1lbHNlIGlmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Yz1mLnBhcmFtKGMsZi5hamF4U2V0dGluZ3MudHJhZGl0aW9uYWwpO2g9XCJQT1NUXCJ9fXZhciBpPXRoaXM7Zi5hamF4KHt1cmw6YSx0eXBlOmgsZGF0YVR5cGU6XCJodG1sXCIsZGF0YTpjLGNvbXBsZXRlOmZ1bmN0aW9uKGEsYixjKXtjPWEucmVzcG9uc2VUZXh0O2lmKGEuaXNSZXNvbHZlZCgpKXthLmRvbmUoZnVuY3Rpb24oYSl7Yz1hfSk7aS5odG1sKGc/ZihcIjxkaXY+XCIpLmFwcGVuZChjLnJlcGxhY2UocyxcIlwiKSkuZmluZChnKTpjKX1pZihkKXtpLmVhY2goZCxbYyxiLGFdKX19fSk7cmV0dXJuIHRoaXN9LHNlcmlhbGl6ZTpmdW5jdGlvbigpe3JldHVybiBmLnBhcmFtKHRoaXMuc2VyaWFsaXplQXJyYXkoKSl9LHNlcmlhbGl6ZUFycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubWFwKGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZWxlbWVudHM/Zi5tYWtlQXJyYXkodGhpcy5lbGVtZW50cyk6dGhpc30pLmZpbHRlcihmdW5jdGlvbigpe3JldHVybiB0aGlzLm5hbWUmJiF0aGlzLmRpc2FibGVkJiYodGhpcy5jaGVja2VkfHx0LnRlc3QodGhpcy5ub2RlTmFtZSl8fG4udGVzdCh0aGlzLnR5cGUpKX0pLm1hcChmdW5jdGlvbihhLGIpe3ZhciBjPWYodGhpcykudmFsKCk7cmV0dXJuIGM9PW51bGw/bnVsbDpmLmlzQXJyYXkoYyk/Zi5tYXAoYyxmdW5jdGlvbihhLGMpe3JldHVybntuYW1lOmIubmFtZSx2YWx1ZTphLnJlcGxhY2UoayxcIlxcclxcblwiKX19KTp7bmFtZTpiLm5hbWUsdmFsdWU6Yy5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSkuZ2V0KCl9fSk7Zi5lYWNoKFwiYWpheFN0YXJ0IGFqYXhTdG9wIGFqYXhDb21wbGV0ZSBhamF4RXJyb3IgYWpheFN1Y2Nlc3MgYWpheFNlbmRcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtmLmZuW2JdPWZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLmJpbmQoYixhKX19KTtmLmVhY2goW1wiZ2V0XCIsXCJwb3N0XCJdLGZ1bmN0aW9uKGEsYyl7ZltjXT1mdW5jdGlvbihhLGQsZSxnKXtpZihmLmlzRnVuY3Rpb24oZCkpe2c9Z3x8ZTtlPWQ7ZD1ifXJldHVybiBmLmFqYXgoe3R5cGU6Yyx1cmw6YSxkYXRhOmQsc3VjY2VzczplLGRhdGFUeXBlOmd9KX19KTtmLmV4dGVuZCh7Z2V0U2NyaXB0OmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwic2NyaXB0XCIpfSxnZXRKU09OOmZ1bmN0aW9uKGEsYixjKXtyZXR1cm4gZi5nZXQoYSxiLGMsXCJqc29uXCIpfSxhamF4U2V0dXA6ZnVuY3Rpb24oYSxiKXtpZihiKXtGKGEsZi5hamF4U2V0dGluZ3MpfWVsc2V7Yj1hO2E9Zi5hamF4U2V0dGluZ3N9RihhLGIpO3JldHVybiBhfSxhamF4U2V0dGluZ3M6e3VybDpBLGlzTG9jYWw6by50ZXN0KEJbMV0pLGdsb2JhbDp0cnVlLHR5cGU6XCJHRVRcIixjb250ZW50VHlwZTpcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLHByb2Nlc3NEYXRhOnRydWUsYXN5bmM6dHJ1ZSxhY2NlcHRzOnt4bWw6XCJhcHBsaWNhdGlvbi94bWwsIHRleHQveG1sXCIsaHRtbDpcInRleHQvaHRtbFwiLHRleHQ6XCJ0ZXh0L3BsYWluXCIsanNvbjpcImFwcGxpY2F0aW9uL2pzb24sIHRleHQvamF2YXNjcmlwdFwiLFwiKlwiOlwiKi8qXCJ9LGNvbnRlbnRzOnt4bWw6L3htbC8saHRtbDovaHRtbC8sanNvbjovanNvbi99LHJlc3BvbnNlRmllbGRzOnt4bWw6XCJyZXNwb25zZVhNTFwiLHRleHQ6XCJyZXNwb25zZVRleHRcIn0sY29udmVydGVyczp7XCIqIHRleHRcIjphLlN0cmluZyxcInRleHQgaHRtbFwiOnRydWUsXCJ0ZXh0IGpzb25cIjpmLnBhcnNlSlNPTixcInRleHQgeG1sXCI6Zi5wYXJzZVhNTH0sZmxhdE9wdGlvbnM6e2NvbnRleHQ6dHJ1ZSx1cmw6dHJ1ZX19LGFqYXhQcmVmaWx0ZXI6RCh5KSxhamF4VHJhbnNwb3J0OkQoeiksYWpheDpmdW5jdGlvbihhLGMpe2Z1bmN0aW9uIEsoYSxjLGwsbSl7aWYoRD09PTIpe3JldHVybn1EPTI7aWYoQSl7Y2xlYXJUaW1lb3V0KEEpfXg9YjtzPW18fFwiXCI7Si5yZWFkeVN0YXRlPWE+MD80OjA7dmFyIG4sbyxwLHE9YyxyPWw/SChkLEosbCk6Yix0LHU7aWYoYT49MjAwJiZhPDMwMHx8YT09PTMwNCl7aWYoZC5pZk1vZGlmaWVkKXtpZih0PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJMYXN0LU1vZGlmaWVkXCIpKXtmLmxhc3RNb2RpZmllZFtrXT10fWlmKHU9Si5nZXRSZXNwb25zZUhlYWRlcihcIkV0YWdcIikpe2YuZXRhZ1trXT11fX1pZihhPT09MzA0KXtxPVwibm90bW9kaWZpZWRcIjtuPXRydWV9ZWxzZXt0cnl7bz1JKGQscik7cT1cInN1Y2Nlc3NcIjtuPXRydWV9Y2F0Y2godil7cT1cInBhcnNlcmVycm9yXCI7cD12fX19ZWxzZXtwPXE7aWYoIXF8fGEpe3E9XCJlcnJvclwiO2lmKGE8MCl7YT0wfX19Si5zdGF0dXM9YTtKLnN0YXR1c1RleHQ9XCJcIisoY3x8cSk7aWYobil7aC5yZXNvbHZlV2l0aChlLFtvLHEsSl0pfWVsc2V7aC5yZWplY3RXaXRoKGUsW0oscSxwXSl9Si5zdGF0dXNDb2RlKGopO2o9YjtpZihGKXtnLnRyaWdnZXIoXCJhamF4XCIrKG4/XCJTdWNjZXNzXCI6XCJFcnJvclwiKSxbSixkLG4/bzpwXSl9aS5yZXNvbHZlV2l0aChlLFtKLHFdKTtpZihGKXtnLnRyaWdnZXIoXCJhamF4Q29tcGxldGVcIixbSixkXSk7aWYoIS0tZi5hY3RpdmUpe2YuZXZlbnQudHJpZ2dlcihcImFqYXhTdG9wXCIpfX19aWYodHlwZW9mIGE9PT1cIm9iamVjdFwiKXtjPWE7YT1ifWM9Y3x8e307dmFyIGQ9Zi5hamF4U2V0dXAoe30sYyksZT1kLmNvbnRleHR8fGQsZz1lIT09ZCYmKGUubm9kZVR5cGV8fGUgaW5zdGFuY2VvZiBmKT9mKGUpOmYuZXZlbnQsaD1mLkRlZmVycmVkKCksaT1mLl9EZWZlcnJlZCgpLGo9ZC5zdGF0dXNDb2RlfHx7fSxrLG49e30sbz17fSxzLHQseCxBLEMsRD0wLEYsRyxKPXtyZWFkeVN0YXRlOjAsc2V0UmVxdWVzdEhlYWRlcjpmdW5jdGlvbihhLGIpe2lmKCFEKXt2YXIgYz1hLnRvTG93ZXJDYXNlKCk7YT1vW2NdPW9bY118fGE7blthXT1ifXJldHVybiB0aGlzfSxnZXRBbGxSZXNwb25zZUhlYWRlcnM6ZnVuY3Rpb24oKXtyZXR1cm4gRD09PTI/czpudWxsfSxnZXRSZXNwb25zZUhlYWRlcjpmdW5jdGlvbihhKXt2YXIgYztpZihEPT09Mil7aWYoIXQpe3Q9e307d2hpbGUoYz1tLmV4ZWMocykpe3RbY1sxXS50b0xvd2VyQ2FzZSgpXT1jWzJdfX1jPXRbYS50b0xvd2VyQ2FzZSgpXX1yZXR1cm4gYz09PWI/bnVsbDpjfSxvdmVycmlkZU1pbWVUeXBlOmZ1bmN0aW9uKGEpe2lmKCFEKXtkLm1pbWVUeXBlPWF9cmV0dXJuIHRoaXN9LGFib3J0OmZ1bmN0aW9uKGEpe2E9YXx8XCJhYm9ydFwiO2lmKHgpe3guYWJvcnQoYSl9SygwLGEpO3JldHVybiB0aGlzfX07aC5wcm9taXNlKEopO0ouc3VjY2Vzcz1KLmRvbmU7Si5lcnJvcj1KLmZhaWw7Si5jb21wbGV0ZT1pLmRvbmU7Si5zdGF0dXNDb2RlPWZ1bmN0aW9uKGEpe2lmKGEpe3ZhciBiO2lmKEQ8Mil7Zm9yKGIgaW4gYSl7altiXT1baltiXSxhW2JdXX19ZWxzZXtiPWFbSi5zdGF0dXNdO0oudGhlbihiLGIpfX1yZXR1cm4gdGhpc307ZC51cmw9KChhfHxkLnVybCkrXCJcIikucmVwbGFjZShsLFwiXCIpLnJlcGxhY2UocSxCWzFdK1wiLy9cIik7ZC5kYXRhVHlwZXM9Zi50cmltKGQuZGF0YVR5cGV8fFwiKlwiKS50b0xvd2VyQ2FzZSgpLnNwbGl0KHUpO2lmKGQuY3Jvc3NEb21haW49PW51bGwpe0M9dy5leGVjKGQudXJsLnRvTG93ZXJDYXNlKCkpO2QuY3Jvc3NEb21haW49ISEoQyYmKENbMV0hPUJbMV18fENbMl0hPUJbMl18fChDWzNdfHwoQ1sxXT09PVwiaHR0cDpcIj84MDo0NDMpKSE9KEJbM118fChCWzFdPT09XCJodHRwOlwiPzgwOjQ0MykpKSl9aWYoZC5kYXRhJiZkLnByb2Nlc3NEYXRhJiZ0eXBlb2YgZC5kYXRhIT09XCJzdHJpbmdcIil7ZC5kYXRhPWYucGFyYW0oZC5kYXRhLGQudHJhZGl0aW9uYWwpfUUoeSxkLGMsSik7aWYoRD09PTIpe3JldHVybiBmYWxzZX1GPWQuZ2xvYmFsO2QudHlwZT1kLnR5cGUudG9VcHBlckNhc2UoKTtkLmhhc0NvbnRlbnQ9IXAudGVzdChkLnR5cGUpO2lmKEYmJmYuYWN0aXZlKys9PT0wKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RhcnRcIil9aWYoIWQuaGFzQ29udGVudCl7aWYoZC5kYXRhKXtkLnVybCs9KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK2QuZGF0YTtkZWxldGUgZC5kYXRhfWs9ZC51cmw7aWYoZC5jYWNoZT09PWZhbHNlKXt2YXIgTD1mLm5vdygpLE09ZC51cmwucmVwbGFjZSh2LFwiJDFfPVwiK0wpO2QudXJsPU0rKE09PT1kLnVybD8oci50ZXN0KGQudXJsKT9cIiZcIjpcIj9cIikrXCJfPVwiK0w6XCJcIil9fWlmKGQuZGF0YSYmZC5oYXNDb250ZW50JiZkLmNvbnRlbnRUeXBlIT09ZmFsc2V8fGMuY29udGVudFR5cGUpe0ouc2V0UmVxdWVzdEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLGQuY29udGVudFR5cGUpfWlmKGQuaWZNb2RpZmllZCl7az1rfHxkLnVybDtpZihmLmxhc3RNb2RpZmllZFtrXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTW9kaWZpZWQtU2luY2VcIixmLmxhc3RNb2RpZmllZFtrXSl9aWYoZi5ldGFnW2tdKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJJZi1Ob25lLU1hdGNoXCIsZi5ldGFnW2tdKX19Si5zZXRSZXF1ZXN0SGVhZGVyKFwiQWNjZXB0XCIsZC5kYXRhVHlwZXNbMF0mJmQuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0/ZC5hY2NlcHRzW2QuZGF0YVR5cGVzWzBdXSsoZC5kYXRhVHlwZXNbMF0hPT1cIipcIj9cIiwgKi8qOyBxPTAuMDFcIjpcIlwiKTpkLmFjY2VwdHNbXCIqXCJdKTtmb3IoRyBpbiBkLmhlYWRlcnMpe0ouc2V0UmVxdWVzdEhlYWRlcihHLGQuaGVhZGVyc1tHXSl9aWYoZC5iZWZvcmVTZW5kJiYoZC5iZWZvcmVTZW5kLmNhbGwoZSxKLGQpPT09ZmFsc2V8fEQ9PT0yKSl7Si5hYm9ydCgpO3JldHVybiBmYWxzZX1mb3IoRyBpbntzdWNjZXNzOjEsZXJyb3I6MSxjb21wbGV0ZToxfSl7SltHXShkW0ddKX14PUUoeixkLGMsSik7aWYoIXgpe0soLTEsXCJObyBUcmFuc3BvcnRcIil9ZWxzZXtKLnJlYWR5U3RhdGU9MTtpZihGKXtnLnRyaWdnZXIoXCJhamF4U2VuZFwiLFtKLGRdKX1pZihkLmFzeW5jJiZkLnRpbWVvdXQ+MCl7QT1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7Si5hYm9ydChcInRpbWVvdXRcIil9LGQudGltZW91dCl9dHJ5e0Q9MTt4LnNlbmQobixLKX1jYXRjaChOKXtpZihEPDIpe0soLTEsTil9ZWxzZXtmLmVycm9yKE4pfX19cmV0dXJuIEp9LHBhcmFtOmZ1bmN0aW9uKGEsYyl7dmFyIGQ9W10sZT1mdW5jdGlvbihhLGIpe2I9Zi5pc0Z1bmN0aW9uKGIpP2IoKTpiO2RbZC5sZW5ndGhdPWVuY29kZVVSSUNvbXBvbmVudChhKStcIj1cIitlbmNvZGVVUklDb21wb25lbnQoYil9O2lmKGM9PT1iKXtjPWYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsfWlmKGYuaXNBcnJheShhKXx8YS5qcXVlcnkmJiFmLmlzUGxhaW5PYmplY3QoYSkpe2YuZWFjaChhLGZ1bmN0aW9uKCl7ZSh0aGlzLm5hbWUsdGhpcy52YWx1ZSl9KX1lbHNle2Zvcih2YXIgZyBpbiBhKXtHKGcsYVtnXSxjLGUpfX1yZXR1cm4gZC5qb2luKFwiJlwiKS5yZXBsYWNlKGksXCIrXCIpfX0pO2YuZXh0ZW5kKHthY3RpdmU6MCxsYXN0TW9kaWZpZWQ6e30sZXRhZzp7fX0pO3ZhciBKPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe2Zvcih2YXIgYSBpbiBMKXtMW2FdKDAsMSl9fTpmYWxzZSxLPTAsTDtmLmFqYXhTZXR0aW5ncy54aHI9YS5BY3RpdmVYT2JqZWN0P2Z1bmN0aW9uKCl7cmV0dXJuIXRoaXMuaXNMb2NhbCYmTSgpfHxOKCl9Ok07KGZ1bmN0aW9uKGEpe2YuZXh0ZW5kKGYuc3VwcG9ydCx7YWpheDohIWEsY29yczohIWEmJlwid2l0aENyZWRlbnRpYWxzXCJpbiBhfSl9KShmLmFqYXhTZXR0aW5ncy54aHIoKSk7aWYoZi5zdXBwb3J0LmFqYXgpe2YuYWpheFRyYW5zcG9ydChmdW5jdGlvbihjKXtpZighYy5jcm9zc0RvbWFpbnx8Zi5zdXBwb3J0LmNvcnMpe3ZhciBkO3JldHVybntzZW5kOmZ1bmN0aW9uKGUsZyl7dmFyIGg9Yy54aHIoKSxpLGo7aWYoYy51c2VybmFtZSl7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jLGMudXNlcm5hbWUsYy5wYXNzd29yZCl9ZWxzZXtoLm9wZW4oYy50eXBlLGMudXJsLGMuYXN5bmMpfWlmKGMueGhyRmllbGRzKXtmb3IoaiBpbiBjLnhockZpZWxkcyl7aFtqXT1jLnhockZpZWxkc1tqXX19aWYoYy5taW1lVHlwZSYmaC5vdmVycmlkZU1pbWVUeXBlKXtoLm92ZXJyaWRlTWltZVR5cGUoYy5taW1lVHlwZSl9aWYoIWMuY3Jvc3NEb21haW4mJiFlW1wiWC1SZXF1ZXN0ZWQtV2l0aFwiXSl7ZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl09XCJYTUxIdHRwUmVxdWVzdFwifXRyeXtmb3IoaiBpbiBlKXtoLnNldFJlcXVlc3RIZWFkZXIoaixlW2pdKX19Y2F0Y2goayl7fWguc2VuZChjLmhhc0NvbnRlbnQmJmMuZGF0YXx8bnVsbCk7ZD1mdW5jdGlvbihhLGUpe3ZhciBqLGssbCxtLG47dHJ5e2lmKGQmJihlfHxoLnJlYWR5U3RhdGU9PT00KSl7ZD1iO2lmKGkpe2gub25yZWFkeXN0YXRlY2hhbmdlPWYubm9vcDtpZihKKXtkZWxldGUgTFtpXX19aWYoZSl7aWYoaC5yZWFkeVN0YXRlIT09NCl7aC5hYm9ydCgpfX1lbHNle2o9aC5zdGF0dXM7bD1oLmdldEFsbFJlc3BvbnNlSGVhZGVycygpO209e307bj1oLnJlc3BvbnNlWE1MO2lmKG4mJm4uZG9jdW1lbnRFbGVtZW50KXttLnhtbD1ufW0udGV4dD1oLnJlc3BvbnNlVGV4dDt0cnl7az1oLnN0YXR1c1RleHR9Y2F0Y2gobyl7az1cIlwifWlmKCFqJiZjLmlzTG9jYWwmJiFjLmNyb3NzRG9tYWluKXtqPW0udGV4dD8yMDA6NDA0fWVsc2UgaWYoaj09PTEyMjMpe2o9MjA0fX19fWNhdGNoKHApe2lmKCFlKXtnKC0xLHApfX1pZihtKXtnKGosayxtLGwpfX07aWYoIWMuYXN5bmN8fGgucmVhZHlTdGF0ZT09PTQpe2QoKX1lbHNle2k9KytLO2lmKEope2lmKCFMKXtMPXt9O2YoYSkudW5sb2FkKEopfUxbaV09ZH1oLm9ucmVhZHlzdGF0ZWNoYW5nZT1kfX0sYWJvcnQ6ZnVuY3Rpb24oKXtpZihkKXtkKDAsMSl9fX19fSl9Zi5hamF4U2V0dGluZ3MuZ2xvYmFsPWZhbHNlO2EualF1ZXJ5PWEuJD1mfSkoZ2xvYmFsKX0iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCQU0gZm9ybWF0OiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgZGVlcENsb25lID0gdXRpbHMuZGVlcENsb25lO1xudmFyIFBhaXJlZEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzJykuUGFpcmVkSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG52YXIgQmFtRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvcjogJzE4OCwxODgsMTg4JyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDIwMDAsIHBhY2s6IDIwMDB9LFxuICAgIC8vIElmIGEgbnVjbGVvdGlkZSBkaWZmZXJzIGZyb20gdGhlIHJlZmVyZW5jZSBzZXF1ZW5jZSBpbiBncmVhdGVyIHRoYW4gMjAlIG9mIHF1YWxpdHkgd2VpZ2h0ZWQgcmVhZHMsIFxuICAgIC8vIElHViBjb2xvcnMgdGhlIGJhciBpbiBwcm9wb3J0aW9uIHRvIHRoZSByZWFkIGNvdW50IG9mIGVhY2ggYmFzZTsgdGhlIGZvbGxvd2luZyBjaGFuZ2VzIHRoYXQgdGhyZXNob2xkIGZvciBjaHJvbW96b29tXG4gICAgYWxsZWxlRnJlcVRocmVzaG9sZDogMC4yLFxuICAgIG9wdGltYWxGZXRjaFdpbmRvdzogMCxcbiAgICBtYXhGZXRjaFdpbmRvdzogMCxcbiAgICAvLyBUaGUgZm9sbG93aW5nIGNhbiBiZSBcImVuc2VtYmxfdWNzY1wiIG9yIFwidWNzY19lbnNlbWJsXCIgdG8gYXR0ZW1wdCBhdXRvLWNyb3NzbWFwcGluZyBvZiByZWZlcmVuY2UgY29udGlnIG5hbWVzXG4gICAgLy8gYmV0d2VlbiB0aGUgdHdvIHNjaGVtZXMsIHdoaWNoIElHViBkb2VzLCBidXQgaXMgYSBwZXJlbm5pYWwgaXNzdWU6IGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEwMDYyL1xuICAgIC8vIEkgaG9wZSBub3QgdG8gbmVlZCBhbGwgdGhlIG1hcHBpbmdzIGluIGhlcmUgaHR0cHM6Ly9naXRodWIuY29tL2Rwcnlhbjc5L0Nocm9tb3NvbWVNYXBwaW5ncyBidXQgaXQgbWF5IGJlIG5lY2Vzc2FyeVxuICAgIGNvbnZlcnRDaHJTY2hlbWU6IFwiYXV0b1wiLFxuICAgIC8vIERyYXcgcGFpcmVkIGVuZHMgd2l0aGluIGEgcmFuZ2Ugb2YgZXhwZWN0ZWQgaW5zZXJ0IHNpemVzIGFzIGEgY29udGludW91cyBmZWF0dXJlP1xuICAgIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjcGFpcmVkIGZvciBob3cgdGhpcyB3b3Jrc1xuICAgIHZpZXdBc1BhaXJzOiBmYWxzZVxuICB9LFxuICBcbiAgLy8gVGhlIEZMQUcgY29sdW1uIGZvciBCQU0vU0FNIGlzIGEgY29tYmluYXRpb24gb2YgYml0d2lzZSBmbGFnc1xuICBmbGFnczoge1xuICAgIGlzUmVhZFBhaXJlZDogMHgxLFxuICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogMHgyLFxuICAgIGlzUmVhZFVubWFwcGVkOiAweDQsXG4gICAgaXNNYXRlVW5tYXBwZWQ6IDB4OCxcbiAgICByZWFkU3RyYW5kUmV2ZXJzZTogMHgxMCxcbiAgICBtYXRlU3RyYW5kUmV2ZXJzZTogMHgyMCxcbiAgICBpc1JlYWRGaXJzdE9mUGFpcjogMHg0MCxcbiAgICBpc1JlYWRMYXN0T2ZQYWlyOiAweDgwLFxuICAgIGlzU2Vjb25kYXJ5QWxpZ25tZW50OiAweDEwMCxcbiAgICBpc1JlYWRGYWlsaW5nVmVuZG9yUUM6IDB4MjAwLFxuICAgIGlzRHVwbGljYXRlUmVhZDogMHg0MDAsXG4gICAgaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50OiAweDgwMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBicm93c2VyQ2hycyA9IF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzKTtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIEJBTSB0cmFjayBhdCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy5icm93c2VyQ2hyU2NoZW1lID0gdGhpcy50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcykpO1xuICB9LFxuICBcbiAgLy8gVE9ETzogV2UgbXVzdCBub3RlIHRoYXQgd2hlbiB3ZSBjaGFuZ2Ugb3B0cy52aWV3QXNQYWlycywgd2UgKm5lZWQqIHRvIHRocm93IG91dCB0aGlzLmRhdGEucGlsZXVwLlxuICAvLyBUT0RPOiBJZiB0aGUgcGFpcmluZyBpbnRlcnZhbCBjaGFuZ2VkLCB3ZSBzaG91bGQgdG9zcyB0aGUgZW50aXJlIGNhY2hlIGFuZCByZXNldCB0aGUgUmVtb3RlVHJhY2sgYmlucyxcbiAgLy8gICAgICAgICBhbmQgYmxvdyB1cCB0aGUgYXJlYUluZGV4LlxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucHJldk9wdHMgPSBkZWVwQ2xvbmUodGhpcy5vcHRzKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSwgXG4gICAgICAgICAge3N0YXJ0S2V5OiAndGVtcGxhdGVTdGFydCcsIGVuZEtleTogJ3RlbXBsYXRlRW5kJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbicsIHBhaXJpbmdLZXk6ICdxbmFtZSd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiYW0ucGhwJyxcbiAgICAgIHJlbW90ZTtcbiAgICBcbiAgICByZW1vdGUgPSBuZXcgUmVtb3RlVHJhY2soY2FjaGUsIGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIHN0b3JlSW50ZXJ2YWxzKSB7XG4gICAgICByYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgICAvLyBDb252ZXJ0IGF1dG9tYXRpY2FsbHkgYmV0d2VlbiBFbnNlbWJsIHN0eWxlIDEsIDIsIDMsIFggPC0tPiBVQ1NDIHN0eWxlIGNocjEsIGNocjIsIGNocjMsIGNoclggYXMgY29uZmlndXJlZC9hdXRvZGV0ZWN0ZWRcbiAgICAgIC8vIE5vdGUgdGhhdCBjaHJNIGlzIE5PVCBlcXVpdmFsZW50IHRvIE1UIGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEyMDA0Mi8jMTIwMDU4XG4gICAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSA9PSBcImF1dG9cIiA/IHNlbGYuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgOiBvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eY2hyLywgJycpOyB9KTsgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IHJhbmdlID0gXy5tYXAocmFuZ2UsIGZ1bmN0aW9uKHIpIHsgcmV0dXJuIHIucmVwbGFjZSgvXihcXGRcXGQ/fFgpOi8sICdjaHIkMTonKTsgfSk7IGJyZWFrO1xuICAgICAgfVxuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUGFyc2UgdGhlIFNBTSBmb3JtYXQgaW50byBpbnRlcnZhbHMgdGhhdCBjYW4gYmUgaW5zZXJ0ZWQgaW50byB0aGUgSW50ZXJ2YWxUcmVlIGNhY2hlXG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBzZWxmLnR5cGUoJ2JhbScpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZSwgcGlsZXVwOiB7fSwgaW5mbzoge319O1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMjQsIHN0YXJ0OiAyNH07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgc2VsZi5ub0FyZWFMYWJlbHMgPSB0cnVlO1xuICAgIHNlbGYuZXhwZWN0c1NlcXVlbmNlID0gdHJ1ZTtcbiAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzID0ge307XG4gICAgc2VsZi5wcmV2T3B0cyA9IGRlZXBDbG9uZShvKTsgIC8vIHVzZWQgdG8gZGV0ZWN0IHdoaWNoIGRyYXdpbmcgb3B0aW9ucyBoYXZlIGJlZW4gY2hhbmdlZCBieSB0aGUgdXNlclxuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJhbSAoZS5nLiBgc2FtdG9vbHMgaWR4c3RhdHNgLCB1c2UgbWFwcGVkIHJlYWRzIHBlciByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgICAvLyB0byBlc3RpbWF0ZSBtYXhGZXRjaFdpbmRvdyBhbmQgb3B0aW1hbEZldGNoV2luZG93LCBhbmQgc2V0dXAgYmlubmluZyBvbiB0aGUgUmVtb3RlVHJhY2suXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHt1cmw6IG8uYmlnRGF0YVVybH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciBtYXBwZWRSZWFkcyA9IDAsXG4gICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhvLmRyYXdMaW1pdCkpLFxuICAgICAgICAgIGJhbUNocnMgPSBbXSxcbiAgICAgICAgICBjaHJTY2hlbWUsIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBfLmVhY2goZGF0YS5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgICAgICAgcmVhZHNNYXBwZWRUb0NvbnRpZyA9IHBhcnNlSW50KGZpZWxkc1syXSwgMTApO1xuICAgICAgICAgIGlmIChmaWVsZHMubGVuZ3RoID09IDEgJiYgZmllbGRzWzBdID09ICcnKSB7IHJldHVybjsgfSAvLyBibGFuayBsaW5lXG4gICAgICAgICAgYmFtQ2hycy5wdXNoKGZpZWxkc1swXSk7XG4gICAgICAgICAgaWYgKF8uaXNOYU4ocmVhZHNNYXBwZWRUb0NvbnRpZykpIHsgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBvdXRwdXQgZm9yIHNhbXRvb2xzIGlkeHN0YXRzIG9uIHRoaXMgQkFNIHRyYWNrLlwiKTsgfVxuICAgICAgICAgIG1hcHBlZFJlYWRzICs9IHJlYWRzTWFwcGVkVG9Db250aWc7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8uY2hyU2NoZW1lID0gY2hyU2NoZW1lID0gc2VsZi50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKGJhbUNocnMpO1xuICAgICAgICBpZiAoY2hyU2NoZW1lICYmIHNlbGYuYnJvd3NlckNoclNjaGVtZSkge1xuICAgICAgICAgIHNlbGYuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgPSBjaHJTY2hlbWUgIT0gc2VsZi5icm93c2VyQ2hyU2NoZW1lID8gY2hyU2NoZW1lICsgJ18nICsgc2VsZi5icm93c2VyQ2hyU2NoZW1lIDogbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBzZWxmLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCA9IG1lYW5JdGVtc1BlckJwID0gbWFwcGVkUmVhZHMgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemU7XG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoID0gMTAwOyAvLyBUT0RPOiB0aGlzIGlzIGEgdG90YWwgZ3Vlc3Mgbm93LCBzaG91bGQgZ3JhYiB0aGlzIGZyb20gc29tZSBzYW1wbGVkIHJlYWRzLlxuICAgICAgICBvLm1heEZldGNoV2luZG93ID0gbWF4SXRlbXNUb0RyYXcgLyBtZWFuSXRlbXNQZXJCcDtcbiAgICAgICAgby5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKG8ubWF4RmV0Y2hXaW5kb3cgLyAyKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFRPRE86IFdlIHNob3VsZCBkZWFjdGl2YXRlIHRoZSBwYWlyaW5nIGZ1bmN0aW9uYWxpdHkgb2YgdGhlIFBhaXJlZEludGVydmFsVHJlZSBcbiAgICAgICAgLy8gICAgICAgaWYgd2UgZG9uJ3Qgc2VlIGFueSBwYWlyZWQgcmVhZHMgaW4gdGhpcyBCQU0uXG4gICAgICAgIC8vICAgICAgIElmIHRoZXJlIGlzIHBhaXJpbmcsIHdlIG5lZWQgdG8gdGVsbCB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIHdoYXQgcmFuZ2Ugb2YgaW5zZXJ0IHNpemVzXG4gICAgICAgIC8vICAgICAgIHNob3VsZCB0cmlnZ2VyIHBhaXJpbmcuXG4gICAgICAgIHNlbGYuZGF0YS5jYWNoZS5zZXRQYWlyaW5nSW50ZXJ2YWwoMTAsIDUwMDApO1xuICAgICAgICByZW1vdGUuc2V0dXBCaW5zKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSwgby5vcHRpbWFsRmV0Y2hXaW5kb3csIG8ubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmZsYWdzWy4uLl0gdG8gYSBodW1hbiBpbnRlcnByZXRhYmxlIHZlcnNpb24gb2YgZmVhdHVyZS5mbGFnIChleHBhbmRpbmcgdGhlIGJpdHdpc2UgZmxhZ3MpXG4gIHBhcnNlRmxhZ3M6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykge1xuICAgIGZlYXR1cmUuZmxhZ3MgPSB7fTtcbiAgICBfLmVhY2godGhpcy50eXBlKCdiYW0nKS5mbGFncywgZnVuY3Rpb24oYml0LCBmbGFnKSB7XG4gICAgICBmZWF0dXJlLmZsYWdzW2ZsYWddID0gISEoZmVhdHVyZS5mbGFnICYgYml0KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5ibG9ja3MgYW5kIGZlYXR1cmUuZW5kIGJhc2VkIG9uIGZlYXR1cmUuY2lnYXJcbiAgLy8gU2VlIHNlY3Rpb24gMS40IG9mIGh0dHBzOi8vc2FtdG9vbHMuZ2l0aHViLmlvL2h0cy1zcGVjcy9TQU12MS5wZGYgZm9yIGFuIGV4cGxhbmF0aW9uIG9mIENJR0FSIFxuICBwYXJzZUNpZ2FyOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHsgICAgICAgIFxuICAgIHZhciBjaWdhciA9IGZlYXR1cmUuY2lnYXIsXG4gICAgICByZWZMZW4gPSAwLFxuICAgICAgc2VxUG9zID0gMCxcbiAgICAgIG9wZXJhdGlvbnMsIGxlbmd0aHM7XG4gICAgXG4gICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICBmZWF0dXJlLmluc2VydGlvbnMgPSBbXTtcbiAgICBcbiAgICBvcHMgPSBjaWdhci5zcGxpdCgvXFxkKy8pLnNsaWNlKDEpO1xuICAgIGxlbmd0aHMgPSBjaWdhci5zcGxpdCgvW0EtWj1dLykuc2xpY2UoMCwgLTEpO1xuICAgIGlmIChvcHMubGVuZ3RoICE9IGxlbmd0aHMubGVuZ3RoKSB7IHRoaXMud2FybihcIkludmFsaWQgQ0lHQVIgJ1wiICsgY2lnYXIgKyBcIicgZm9yIFwiICsgZmVhdHVyZS5kZXNjKTsgcmV0dXJuOyB9XG4gICAgbGVuZ3RocyA9IF8ubWFwKGxlbmd0aHMsIHBhcnNlSW50MTApO1xuICAgIFxuICAgIF8uZWFjaChvcHMsIGZ1bmN0aW9uKG9wLCBpKSB7XG4gICAgICB2YXIgbGVuID0gbGVuZ3Roc1tpXSxcbiAgICAgICAgYmxvY2ssIGluc2VydGlvbjtcbiAgICAgIGlmICgvXltNWD1dJC8udGVzdChvcCkpIHtcbiAgICAgICAgLy8gQWxpZ25tZW50IG1hdGNoLCBzZXF1ZW5jZSBtYXRjaCwgc2VxdWVuY2UgbWlzbWF0Y2hcbiAgICAgICAgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIGxlbjtcbiAgICAgICAgYmxvY2sudHlwZSA9IG9wO1xuICAgICAgICBibG9jay5zZXEgPSBmZWF0dXJlLnNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmICgvXltORF0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBTa2lwcGVkIHJlZmVyZW5jZSByZWdpb24sIGRlbGV0aW9uIGZyb20gcmVmZXJlbmNlXG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdJJykge1xuICAgICAgICAvLyBJbnNlcnRpb25cbiAgICAgICAgaW5zZXJ0aW9uID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuLCBlbmQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBpbnNlcnRpb24uc2VxID0gZmVhdHVyZS5zZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmluc2VydGlvbnMucHVzaChpbnNlcnRpb24pO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnUycpIHtcbiAgICAgICAgLy8gU29mdCBjbGlwcGluZzsgc2ltcGx5IHNraXAgdGhlc2UgYmFzZXMgaW4gU0VRLCBwb3NpdGlvbiBvbiByZWZlcmVuY2UgaXMgdW5jaGFuZ2VkLlxuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfVxuICAgICAgLy8gVGhlIG90aGVyIHR3byBDSUdBUiBvcHMsIEggYW5kIFAsIGFyZSBub3QgcmVsZXZhbnQgdG8gZHJhd2luZyBhbGlnbm1lbnRzLlxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZW5kID0gZmVhdHVyZS5zdGFydCArIHJlZkxlbjtcbiAgfSxcbiAgXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xzID0gWydxbmFtZScsICdmbGFnJywgJ3JuYW1lJywgJ3BvcycsICdtYXBxJywgJ2NpZ2FyJywgJ3JuZXh0JywgJ3BuZXh0JywgJ3RsZW4nLCAnc2VxJywgJ3F1YWwnXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICBhdmFpbEZsYWdzID0gdGhpcy50eXBlKCdiYW0nKS5mbGFncyxcbiAgICAgIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBfLmVhY2goXy5maXJzdChmaWVsZHMsIGNvbHMubGVuZ3RoKSwgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgLy8gQ29udmVydCBhdXRvbWF0aWNhbGx5IGJldHdlZW4gRW5zZW1ibCBzdHlsZSAxLCAyLCAzLCBYIDwtLT4gVUNTQyBzdHlsZSBjaHIxLCBjaHIyLCBjaHIzLCBjaHJYIGFzIGNvbmZpZ3VyZWQvYXV0b2RldGVjdGVkXG4gICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSA9PSBcImF1dG9cIiA/IHRoaXMuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgOiBvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IGZlYXR1cmUucm5hbWUgPSBmZWF0dXJlLnJuYW1lLnJlcGxhY2UoL15jaHIvLCAnJyk7IGJyZWFrO1xuICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogZmVhdHVyZS5ybmFtZSA9ICgvXihcXGRcXGQ/fFgpJC8udGVzdChmZWF0dXJlLnJuYW1lKSA/ICdjaHInIDogJycpICsgZmVhdHVyZS5ybmFtZTsgYnJlYWs7XG4gICAgfVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucW5hbWU7XG4gICAgZmVhdHVyZS5mbGFnID0gcGFyc2VJbnQxMChmZWF0dXJlLmZsYWcpO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUucm5hbWVdO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgUk5BTUUgJ1wiK2ZlYXR1cmUucm5hbWUrXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGZlYXR1cmUucG9zID09PSAnMCcgfHwgIWZlYXR1cmUuY2lnYXIgfHwgZmVhdHVyZS5jaWdhciA9PSAnKicgfHwgZmVhdHVyZS5mbGFnICYgYXZhaWxGbGFncy5pc1JlYWRVbm1hcHBlZCkge1xuICAgICAgLy8gVW5tYXBwZWQgcmVhZC4gU2luY2Ugd2UgY2FuJ3QgZHJhdyB0aGVzZSBhdCBhbGwsIHdlIGRvbid0IGJvdGhlciBwYXJzaW5nIHRoZW0gZnVydGhlci5cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnBvcyk7ICAgICAgICAvLyBQT1MgaXMgMS1iYXNlZCwgaGVuY2Ugbm8gaW5jcmVtZW50IGFzIGZvciBwYXJzaW5nIEJFRFxuICAgICAgZmVhdHVyZS5kZXNjID0gZmVhdHVyZS5xbmFtZSArICcgYXQgJyArIGZlYXR1cmUucm5hbWUgKyAnOicgKyBmZWF0dXJlLnBvcztcbiAgICAgIGZlYXR1cmUudGxlbiA9IHBhcnNlSW50MTAoZmVhdHVyZS50bGVuKTtcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VGbGFncy5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7XG4gICAgICBmZWF0dXJlLnN0cmFuZCA9IGZlYXR1cmUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnLScgOiAnKyc7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlQ2lnYXIuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pOyAvLyBUaGlzIGFsc28gc2V0cyAuZW5kIGFwcHJvcHJpYXRlbHlcbiAgICB9XG4gICAgLy8gV2UgaGF2ZSB0byBjb21lIHVwIHdpdGggc29tZXRoaW5nIHRoYXQgaXMgYSB1bmlxdWUgbGFiZWwgZm9yIGV2ZXJ5IGxpbmUgdG8gZGVkdXBlIHJvd3MuXG4gICAgLy8gVGhlIGZvbGxvd2luZyBpcyB0ZWNobmljYWxseSBub3QgZ3VhcmFudGVlZCBieSBhIHZhbGlkIEJBTSAoZXZlbiBhdCBHQVRLIHN0YW5kYXJkcyksIGJ1dCBpdCdzIHRoZSBiZXN0IEkgZ290LlxuICAgIGZlYXR1cmUuaWQgPSBbZmVhdHVyZS5xbmFtZSwgZmVhdHVyZS5mbGFnLCBmZWF0dXJlLnJuYW1lLCBmZWF0dXJlLnBvcywgZmVhdHVyZS5jaWdhcl0uam9pbihcIlxcdFwiKTtcbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIHBpbGV1cDogZnVuY3Rpb24oaW50ZXJ2YWxzLCBzdGFydCwgZW5kKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICBwb3NpdGlvbnNUb0NhbGN1bGF0ZSA9IHt9LFxuICAgICAgbnVtUG9zaXRpb25zVG9DYWxjdWxhdGUgPSAwLFxuICAgICAgaTtcbiAgICBcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICAvLyBObyBuZWVkIHRvIHBpbGV1cCBhZ2FpbiBvbiBhbHJlYWR5LXBpbGVkLXVwIG51Y2xlb3RpZGUgcG9zaXRpb25zXG4gICAgICBpZiAoIXBpbGV1cFtpXSkgeyBwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSA9IHRydWU7IG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlKys7IH1cbiAgICB9XG4gICAgaWYgKG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID09PSAwKSB7IHJldHVybjsgfSAvLyBBbGwgcG9zaXRpb25zIGFscmVhZHkgcGlsZWQgdXAhXG4gICAgXG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKGludGVydmFsLmRhdGEubWF0ZS5ibG9ja3MpOyB9XG4gICAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja3MpIHtcbiAgICAgICAgXy5lYWNoKGJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgICB2YXIgbnQsIGk7XG4gICAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgZW5kKTsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoIXBvc2l0aW9uc1RvQ2FsY3VsYXRlW2ldKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgIHBpbGV1cFtpXSA9IHBpbGV1cFtpXSB8fCB7QTogMCwgQzogMCwgRzogMCwgVDogMCwgTjogMCwgY292OiAwfTtcbiAgICAgICAgICAgIGlmICgvW0FDVEdOXS8udGVzdChudCkpIHsgcGlsZXVwW2ldW250XSArPSAxOyB9XG4gICAgICAgICAgICBwaWxldXBbaV0uY292ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgY292ZXJhZ2U6IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCkge1xuICAgIC8vIENvbXBhcmUgd2l0aCBiaW5uaW5nIG9uIHRoZSBmbHkgaW4gLnR5cGUoJ3dpZ2dsZV8wJykucHJlcmVuZGVyKC4uLilcbiAgICB2YXIgaiA9IHN0YXJ0LFxuICAgICAgdlNjYWxlID0gdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgKiB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCAqIDIsXG4gICAgICBjdXJyID0gdGhpcy5kYXRhLnBpbGV1cFtqXSxcbiAgICAgIGJhcnMgPSBbXSxcbiAgICAgIG5leHQsIGJpbiwgaTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgICAgYmluID0gY3VyciAmJiAoaiArIDEgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci5jb3ZdIDogW107XG4gICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB3aGlsZSAoaiArIDEgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIGogKyAyID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgIGlmIChuZXh0KSB7IGJpbi5wdXNoKG5leHQuY292KTsgfVxuICAgICAgICArK2o7XG4gICAgICAgIGN1cnIgPSBuZXh0O1xuICAgICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB9XG4gICAgICBiYXJzLnB1c2godXRpbHMud2lnQmluRnVuY3Rpb25zLm1heGltdW0oYmluKSAvIHZTY2FsZSk7XG4gICAgfVxuICAgIHJldHVybiBiYXJzO1xuICB9LFxuICBcbiAgYWxsZWxlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICB2U2NhbGUgPSB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCAqIHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoICogMixcbiAgICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQgPSB0aGlzLm9wdHMuYWxsZWxlRnJlcVRocmVzaG9sZCxcbiAgICAgIGFsbGVsZVNwbGl0cyA9IFtdLFxuICAgICAgc3BsaXQsIHJlZk50LCBpLCBwaWxldXBBdFBvcztcbiAgICAgIFxuICAgIGZvciAoaSA9IDA7IGkgPCBzZXF1ZW5jZS5sZW5ndGg7IGkrKykge1xuICAgICAgcmVmTnQgPSBzZXF1ZW5jZVtpXS50b1VwcGVyQ2FzZSgpO1xuICAgICAgcGlsZXVwQXRQb3MgPSBwaWxldXBbc3RhcnQgKyBpXTtcbiAgICAgIGlmIChwaWxldXBBdFBvcyAmJiBwaWxldXBBdFBvcy5jb3YgJiYgcGlsZXVwQXRQb3NbcmVmTnRdIC8gcGlsZXVwQXRQb3MuY292IDwgKDEgLSBhbGxlbGVGcmVxVGhyZXNob2xkKSkge1xuICAgICAgICBzcGxpdCA9IHtcbiAgICAgICAgICB4OiBpIC8gYnBwcCxcbiAgICAgICAgICBzcGxpdHM6IFtdXG4gICAgICAgIH07XG4gICAgICAgIF8uZWFjaChbJ0EnLCAnQycsICdHJywgJ1QnXSwgZnVuY3Rpb24obnQpIHtcbiAgICAgICAgICBpZiAocGlsZXVwQXRQb3NbbnRdID4gMCkgeyBzcGxpdC5zcGxpdHMucHVzaCh7bnQ6IG50LCBoOiBwaWxldXBBdFBvc1tudF0gLyB2U2NhbGV9KTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgYWxsZWxlU3BsaXRzLnB1c2goc3BsaXQpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYWxsZWxlU3BsaXRzO1xuICB9LFxuICBcbiAgbWlzbWF0Y2hlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwLCBpbnRlcnZhbHMsIHdpZHRoLCBsaW5lTnVtLCB2aWV3QXNQYWlycykge1xuICAgIHZhciBtaXNtYXRjaGVzID0gW10sXG4gICAgICB2aWV3QXNQYWlycyA9IHRoaXMub3B0cy52aWV3QXNQYWlycztcbiAgICBzZXF1ZW5jZSA9IHNlcXVlbmNlLnRvVXBwZXJDYXNlKCk7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKHZpZXdBc1BhaXJzICYmIGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IFxuICAgICAgICBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTtcbiAgICAgIH1cbiAgICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2Nrcykge1xuICAgICAgICBfLmVhY2goYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICAgIHZhciBsaW5lID0gbGluZU51bShpbnRlcnZhbC5kYXRhKSxcbiAgICAgICAgICAgIG50LCBpLCB4O1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIHN0YXJ0ICsgd2lkdGggKiBicHBwKTsgaSsrKSB7XG4gICAgICAgICAgICB4ID0gKGkgLSBzdGFydCkgLyBicHBwO1xuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAobnQgJiYgbnQgIT0gc2VxdWVuY2VbaSAtIHN0YXJ0XSAmJiBsaW5lKSB7IG1pc21hdGNoZXMucHVzaCh7eDogeCwgbnQ6IG50LCBsaW5lOiBsaW5lfSk7IH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIG1pc21hdGNoZXM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIHNlcXVlbmNlID0gcHJlY2FsYy5zZXF1ZW5jZSxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICB2aWV3QXNQYWlycyA9IHNlbGYub3B0cy52aWV3QXNQYWlycyxcbiAgICAgIHN0YXJ0S2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVTdGFydCcgOiAnc3RhcnQnLFxuICAgICAgZW5kS2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVFbmQnIDogJ2VuZCcsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eSArICdfJyArICh2aWV3QXNQYWlycyA/ICdwJyA6ICd1Jyk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiB3ZSBjYW4gcmVhc29uYWJseSBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggYW4gaW5zYW5lIGFtb3VudCBvZiByb3dzIFxuICAgIC8vICg+NTAwIGFsaWdubWVudHMpLCBhcyB0aGlzIHdpbGwgb25seSBob2xkIHVwIG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmV0Y2ggZnJvbSB0aGUgUmVtb3RlVHJhY2sgYW5kIGNhbGwgdGhlIGFib3ZlIHdoZW4gdGhlIGRhdGEgaXMgYXZhaWxhYmxlLlxuICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIHZpZXdBc1BhaXJzLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgdmFyIGRyYXdTcGVjID0ge3NlcXVlbmNlOiAhIXNlcXVlbmNlLCB3aWR0aDogd2lkdGh9LFxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbE1hdGVkID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIDQsIGZhbHNlLCBzdGFydEtleSwgZW5kS2V5KSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgNCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW50ZXJ2YWxzLnRvb01hbnkpIHsgcmV0dXJuIGNhbGxiYWNrKGludGVydmFscyk7IH1cblxuICAgICAgICBpZiAoIXNlcXVlbmNlKSB7XG4gICAgICAgICAgLy8gRmlyc3QgZHJhd2luZyBwYXNzLCB3aXRoIGZlYXR1cmVzIHRoYXQgZG9uJ3QgZGVwZW5kIG9uIHNlcXVlbmNlLlxuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykucGlsZXVwLmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCBzdGFydCwgZW5kKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWxNYXRlZCwgbGluZU51bSk7XG4gICAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obGluZXMpIHtcbiAgICAgICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgICAgICAgICAgaW50ZXJ2YWwuaW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5pbnNlcnRpb25zLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICBpZiAoIXZpZXdBc1BhaXJzKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICBpZiAoaW50ZXJ2YWwuZC5kcmF3QXNNYXRlcyAmJiBpbnRlcnZhbC5kLm1hdGUpIHtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW50cyA9IF8ubWFwKFtpbnRlcnZhbC5kLCBpbnRlcnZhbC5kLm1hdGVdLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuaW5zZXJ0aW9uUHRzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGludGVydmFsLmQubWF0ZUV4cGVjdGVkKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBbY2FsY1BpeEludGVydmFsKGludGVydmFsKV07XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUJsb2NrSW50cyA9IFtdO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBbXTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZHJhd1NwZWMuY292ZXJhZ2UgPSBzZWxmLnR5cGUoJ2JhbScpLmNvdmVyYWdlLmNhbGwoc2VsZiwgc3RhcnQsIHdpZHRoLCBicHBwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2UsIGxpa2UgbWlzbWF0Y2hlcyAocG90ZW50aWFsIFNOUHMpLlxuICAgICAgICAgIGRyYXdTcGVjLmJwcHAgPSBicHBwOyAgXG4gICAgICAgICAgLy8gRmluZCBhbGxlbGUgc3BsaXRzIHdpdGhpbiB0aGUgY292ZXJhZ2UgZ3JhcGguXG4gICAgICAgICAgZHJhd1NwZWMuYWxsZWxlcyA9IHNlbGYudHlwZSgnYmFtJykuYWxsZWxlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCk7XG4gICAgICAgICAgLy8gRmluZCBtaXNtYXRjaGVzIHdpdGhpbiBlYWNoIGFsaWduZWQgYmxvY2suXG4gICAgICAgICAgZHJhd1NwZWMubWlzbWF0Y2hlcyA9IHNlbGYudHlwZSgnYmFtJykubWlzbWF0Y2hlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgZnVuY3Rpb24geWVzTm8oYm9vbCkgeyByZXR1cm4gYm9vbCA/IFwieWVzXCIgOiBcIm5vXCI7IH1cbiAgICB2YXIgY29udGVudCA9IHtcbiAgICAgICAgXCJwb3NpdGlvblwiOiBkYXRhLmQucm5hbWUgKyAnOicgKyBkYXRhLmQucG9zLFxuICAgICAgICBcImNpZ2FyXCI6IGRhdGEuZC5jaWdhcixcbiAgICAgICAgXCJyZWFkIHN0cmFuZFwiOiBkYXRhLmQuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnKC0pJyA6ICcoKyknLFxuICAgICAgICBcIm1hcHBlZFwiOiB5ZXNObyghZGF0YS5kLmZsYWdzLmlzUmVhZFVubWFwcGVkKSxcbiAgICAgICAgXCJtYXAgcXVhbGl0eVwiOiBkYXRhLmQubWFwcSxcbiAgICAgICAgXCJzZWNvbmRhcnlcIjogeWVzTm8oZGF0YS5kLmZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50KSxcbiAgICAgICAgXCJzdXBwbGVtZW50YXJ5XCI6IHllc05vKGRhdGEuZC5mbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcImR1cGxpY2F0ZVwiOiB5ZXNObyhkYXRhLmQuZmxhZ3MuaXNEdXBsaWNhdGVSZWFkKSxcbiAgICAgICAgXCJmYWlsZWQgUUNcIjogeWVzTm8oZGF0YS5kLmZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQyksXG4gICAgICAgIFwidGxlblwiOiBkYXRhLmQudGxlbixcbiAgICAgICAgXCJkcmF3QXNNYXRlc1wiOiBkYXRhLmQuZHJhd0FzTWF0ZXMgfHwgJ2ZhbHNlJyxcbiAgICAgICAgXCJtYXRlRXhwZWN0ZWRcIjogZGF0YS5kLm1hdGVFeHBlY3RlZCB8fCAnZmFsc2UnLCBcbiAgICAgICAgXCJtYXRlXCI6IGRhdGEuZC5tYXRlICYmIGRhdGEuZC5tYXRlLnBvcyB8fCAnbnVsbCdcbiAgICAgIH07XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI2NvdmVyYWdlIGZvciBhbiBpZGVhIG9mIHdoYXQgd2UncmUgaW1pdGF0aW5nXG4gIGRyYXdDb3ZlcmFnZTogZnVuY3Rpb24oY3R4LCBjb3ZlcmFnZSwgaGVpZ2h0KSB7XG4gICAgXy5lYWNoKGNvdmVyYWdlLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGN0eC5maWxsUmVjdCh4LCBNYXRoLm1heChoZWlnaHQgLSAoZCAqIGhlaWdodCksIDApLCAxLCBNYXRoLm1pbihkICogaGVpZ2h0LCBoZWlnaHQpKTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdTdHJhbmRJbmRpY2F0b3I6IGZ1bmN0aW9uKGN0eCwgeCwgYmxvY2tZLCBibG9ja0hlaWdodCwgeFNjYWxlLCBiaWdTdHlsZSkge1xuICAgIHZhciBwcmV2RmlsbFN0eWxlID0gY3R4LmZpbGxTdHlsZTtcbiAgICBpZiAoYmlnU3R5bGUpIHtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZKTtcbiAgICAgIGN0eC5saW5lVG8oeCArICgzICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQvMik7XG4gICAgICBjdHgubGluZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5jbG9zZVBhdGgoKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDE0MCwxNDAsMTQwKSc7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTIgOiAxKSwgYmxvY2tZLCAxLCBibG9ja0hlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTEgOiAwKSwgYmxvY2tZICsgMSwgMSwgYmxvY2tIZWlnaHQgLSAyKTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBwcmV2RmlsbFN0eWxlO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdBbGlnbm1lbnQ6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBkcmF3TWF0ZXMgPSBkYXRhLm1hdGVJbnRzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIGJsb2NrWSA9IGkgKiBsaW5lSGVpZ2h0ICsgbGluZUdhcC8yLFxuICAgICAgYmxvY2tIZWlnaHQgPSBsaW5lSGVpZ2h0IC0gbGluZUdhcCxcbiAgICAgIGRlbGV0aW9uTGluZVdpZHRoID0gMixcbiAgICAgIGluc2VydGlvbkNhcmV0TGluZVdpZHRoID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIGxpbmVIZWlnaHQpIC0gZGVsZXRpb25MaW5lV2lkdGggKiAwLjUsXG4gICAgICBibG9ja1NldHMgPSBbe2Jsb2NrSW50czogZGF0YS5ibG9ja0ludHMsIHN0cmFuZDogZGF0YS5kLnN0cmFuZH1dO1xuICAgIFxuICAgIC8vIEZvciBtYXRlIHBhaXJzLCB0aGUgZnVsbCBwaXhlbCBpbnRlcnZhbCByZXByZXNlbnRzIHRoZSBsaW5lIGxpbmtpbmcgdGhlIG1hdGVzXG4gICAgaWYgKGRyYXdNYXRlcykge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgZGVsZXRpb25MaW5lV2lkdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEcmF3IHRoZSBsaW5lcyB0aGF0IHNob3cgdGhlIGZ1bGwgYWxpZ25tZW50IGZvciBlYWNoIHNlZ21lbnQsIGluY2x1ZGluZyBkZWxldGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gJ3JnYigwLDAsMCknO1xuICAgIF8uZWFjaChkcmF3TWF0ZXMgfHwgW2RhdGEucEludF0sIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgIGlmIChwSW50LncgPD0gMCkgeyByZXR1cm47IH1cbiAgICAgIC8vIE5vdGUgdGhhdCB0aGUgXCItIDFcIiBiZWxvdyBmaXhlcyByb3VuZGluZyBpc3N1ZXMgYnV0IGdhbWJsZXMgb24gdGhlcmUgbmV2ZXIgYmVpbmcgYSBkZWxldGlvbiBhdCB0aGUgcmlnaHQgZWRnZVxuICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBwSW50LncgLSAxLCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgIFxuICAgIC8vIERyYXcgdGhlIFttaXNdbWF0Y2ggKE0vWC89KSBibG9ja3NcbiAgICBpZiAoZHJhd01hdGVzICYmIGRhdGEuZC5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKHtibG9ja0ludHM6IGRhdGEubWF0ZUJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQubWF0ZS5zdHJhbmR9KTsgfVxuICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2NrU2V0KSB7XG4gICAgICB2YXIgc3RyYW5kID0gYmxvY2tTZXQuc3RyYW5kO1xuICAgICAgXy5lYWNoKGJsb2NrU2V0LmJsb2NrSW50cywgZnVuY3Rpb24oYkludCwgYmxvY2tOdW0pIHtcbiAgICAgIFxuICAgICAgICAvLyBTa2lwIGRyYXdpbmcgYmxvY2tzIHRoYXQgYXJlbid0IGluc2lkZSB0aGUgY2FudmFzXG4gICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPCAwIHx8IGJJbnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgXG4gICAgICAgIGlmIChibG9ja051bSA9PSAwICYmIGJsb2NrU2V0LnN0cmFuZCA9PSAnLScgJiYgIWJJbnQub1ByZXYpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54ICsgMiwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LngsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIC0xLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSBpZiAoYmxvY2tOdW0gPT0gYmxvY2tTZXQuYmxvY2tJbnRzLmxlbmd0aCAtIDEgJiYgYmxvY2tTZXQuc3RyYW5kID09ICcrJyAmJiAhYkludC5vTmV4dCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54ICsgYkludC53LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAxLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRHJhdyBpbnNlcnRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKDExNCw0MSwyMTgpXCI7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyA/IFtkYXRhLmluc2VydGlvblB0cywgZGF0YS5tYXRlSW5zZXJ0aW9uUHRzXSA6IFtkYXRhLmluc2VydGlvblB0c10sIGZ1bmN0aW9uKGluc2VydGlvblB0cykge1xuICAgICAgXy5lYWNoKGluc2VydGlvblB0cywgZnVuY3Rpb24oaW5zZXJ0KSB7XG4gICAgICAgIGlmIChpbnNlcnQueCArIGluc2VydC53IDwgMCB8fCBpbnNlcnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAxLCBpICogbGluZUhlaWdodCwgMiwgbGluZUhlaWdodCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIGkgKiBsaW5lSGVpZ2h0LCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIChpICsgMSkgKiBsaW5lSGVpZ2h0IC0gaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd0FsbGVsZXM6IGZ1bmN0aW9uKGN0eCwgYWxsZWxlcywgaGVpZ2h0LCBiYXJXaWR0aCkge1xuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICB5UG9zO1xuICAgIF8uZWFjaChhbGxlbGVzLCBmdW5jdGlvbihhbGxlbGVzRm9yUG9zaXRpb24pIHtcbiAgICAgIHlQb3MgPSBoZWlnaHQ7XG4gICAgICBfLmVhY2goYWxsZWxlc0ZvclBvc2l0aW9uLnNwbGl0cywgZnVuY3Rpb24oc3BsaXQpIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbc3BsaXQubnRdKycpJztcbiAgICAgICAgY3R4LmZpbGxSZWN0KGFsbGVsZXNGb3JQb3NpdGlvbi54LCB5UG9zIC09IChzcGxpdC5oICogaGVpZ2h0KSwgTWF0aC5tYXgoYmFyV2lkdGgsIDEpLCBzcGxpdC5oICogaGVpZ2h0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd01pc21hdGNoOiBmdW5jdGlvbihjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCBwcGJwKSB7XG4gICAgLy8gcHBicCA9PSBwaXhlbHMgcGVyIGJhc2UgcGFpciAoaW52ZXJzZSBvZiBicHBwKVxuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIHlQb3M7XG4gICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbbWlzbWF0Y2gubnRdKycpJztcbiAgICBjdHguZmlsbFJlY3QobWlzbWF0Y2gueCwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0KSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwIC8gMiwgTWF0aC5tYXgocHBicCwgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAvLyBEbyB3ZSBoYXZlIHJvb20gdG8gcHJpbnQgYSB3aG9sZSBsZXR0ZXI/XG4gICAgaWYgKHBwYnAgPiA3ICYmIGxpbmVIZWlnaHQgPiAxMCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMjU1LDI1NSwyNTUpJztcbiAgICAgIGN0eC5maWxsVGV4dChtaXNtYXRjaC5udCwgbWlzbWF0Y2gueCArIHBwYnAgKiAwLjUsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCArIDEpICogbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTQgOiA0LFxuICAgICAgY292SGVpZ2h0ID0gZGVuc2l0eSA9PSAnZGVuc2UnID8gMjQgOiAzOCxcbiAgICAgIGNvdk1hcmdpbiA9IDcsXG4gICAgICBsaW5lT2Zmc2V0ID0gKChjb3ZIZWlnaHQgKyBjb3ZNYXJnaW4pIC8gbGluZUhlaWdodCksIFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgICAgICAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBcbiAgICBpZiAoIWRyYXdTcGVjLnNlcXVlbmNlKSB7XG4gICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICBcbiAgICAgIC8vIElmIG5lY2Vzc2FyeSwgaW5kaWNhdGUgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgIGlmIChkcmF3U3BlYy50b29NYW55IHx8IChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE9ubHkgc3RvcmUgYXJlYXMgZm9yIHRoZSBcInBhY2tcIiBkZW5zaXR5LlxuICAgICAgLy8gV2UgaGF2ZSB0byBlbXB0eSB0aGlzIGZvciBldmVyeSByZW5kZXIsIGJlY2F1c2UgYXJlYXMgY2FuIGNoYW5nZSBpZiBCQU0gZGlzcGxheSBvcHRpb25zIGNoYW5nZS5cbiAgICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICAgIC8vIFNldCB0aGUgZXhwZWN0ZWQgaGVpZ2h0IGZvciB0aGUgY2FudmFzICh0aGlzIGFsc28gZXJhc2VzIGl0KS5cbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBjb3ZIZWlnaHQgKyAoKGRlbnNpdHkgPT0gJ2RlbnNlJykgPyAwIDogY292TWFyZ2luICsgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQpO1xuICAgICAgXG4gICAgICAvLyBGaXJzdCBkcmF3IHRoZSBjb3ZlcmFnZSBncmFwaFxuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDE1OSwxNTksMTU5KVwiO1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3Q292ZXJhZ2UuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmNvdmVyYWdlLCBjb3ZIZWlnaHQpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgLy8gTm93LCBkcmF3IGFsaWdubWVudHMgYmVsb3cgaXRcbiAgICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScpIHtcbiAgICAgICAgLy8gQm9yZGVyIGJldHdlZW4gY292ZXJhZ2VcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDEwOSwxMDksMTA5KVwiO1xuICAgICAgICBjdHguZmlsbFJlY3QoMCwgY292SGVpZ2h0ICsgMSwgZHJhd1NwZWMud2lkdGgsIDEpOyBcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgICBcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICAgIGkgKz0gbGluZU9mZnNldDsgLy8gaGFja2lzaCBtZXRob2QgZm9yIGxlYXZpbmcgc3BhY2UgYXQgdGhlIHRvcCBmb3IgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsaWdubWVudC5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQsIGRyYXdTcGVjLnZpZXdBc1BhaXJzKTtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2U6XG4gICAgICAvLyAoMSkgYWxsZWxlIHNwbGl0cyBvdmVyIGNvdmVyYWdlXG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGxlbGVzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5hbGxlbGVzLCBjb3ZIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIC8vICgyKSBtaXNtYXRjaGVzIG92ZXIgdGhlIGFsaWdubWVudHNcbiAgICAgIGN0eC5mb250ID0gXCIxMnB4ICdNZW5sbycsJ0JpdHN0cmVhbSBWZXJhIFNhbnMgTW9ubycsJ0NvbnNvbGFzJywnTHVjaWRhIENvbnNvbGUnLG1vbm9zcGFjZVwiO1xuICAgICAgY3R4LnRleHRBbGlnbiA9ICdjZW50ZXInO1xuICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdiYXNlbGluZSc7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubWlzbWF0Y2hlcywgZnVuY3Rpb24obWlzbWF0Y2gpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3TWlzbWF0Y2guY2FsbChzZWxmLCBjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgdmFyIGNhbGxiYWNrS2V5ID0gc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5O1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgXG4gICAgICAvLyBIYXZlIHdlIGJlZW4gd2FpdGluZyB0byBkcmF3IHNlcXVlbmNlIGRhdGEgdG9vPyBJZiBzbywgZG8gdGhhdCBub3csIHRvby5cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0pKSB7XG4gICAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKCk7XG4gICAgICAgIGRlbGV0ZSBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgcmVuZGVyU2VxdWVuY2U6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgc2VxdWVuY2UsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIFxuICAgIC8vIElmIHdlIHdlcmVuJ3QgYWJsZSB0byBmZXRjaCBzZXF1ZW5jZSBmb3Igc29tZSByZWFzb24sIHRoZXJlIGlzIG5vIHJlYXNvbiB0byBwcm9jZWVkLlxuICAgIGlmICghc2VxdWVuY2UpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCkge1xuICAgICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGgsIHNlcXVlbmNlOiBzZXF1ZW5jZX0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoZSBjYW52YXMgd2FzIGFscmVhZHkgcmVuZGVyZWQgKGJ5IGxhY2sgb2YgdGhlIGNsYXNzICd1bnJlbmRlcmVkJykuXG4gICAgLy8gSWYgeWVzLCBnbyBhaGVhZCBhbmQgZXhlY3V0ZSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7IGlmIG5vdCwgc2F2ZSBpdCBmb3IgbGF0ZXIuXG4gICAgaWYgKCgnICcgKyBjYW52YXMuY2xhc3NOYW1lICsgJyAnKS5pbmRleE9mKCcgdW5yZW5kZXJlZCAnKSA+IC0xKSB7XG4gICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW3N0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eV0gPSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrO1xuICAgIH0gZWxzZSB7XG4gICAgICByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7XG4gICAgfVxuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmF0dHIoJ2NoZWNrZWQnLCAhIW8udmlld0FzUGFpcnMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoby5jb252ZXJ0Q2hyU2NoZW1lKS5jaGFuZ2UoKTtcbiAgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIG8udmlld0FzUGFpcnMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8uY29udmVydENoclNjaGVtZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoKTtcbiAgICBcbiAgICAvLyBJZiBvLnZpZXdBc1BhaXJzIHdhcyBjaGFuZ2VkLCB3ZSAqbmVlZCogdG8gYmxvdyBhd2F5IHRoZSBnZW5vYnJvd3NlcidzIGFyZWFJbmRleCBcbiAgICAvLyBhbmQgb3VyIGxvY2FsbHkgY2FjaGVkIGFyZWFzLCBhcyBhbGwgdGhlIGFyZWFzIHdpbGwgY2hhbmdlLlxuICAgIGlmIChvLnZpZXdBc1BhaXJzICE9IHRoaXMucHJldk9wdHMudmlld0FzUGFpcnMpIHtcbiAgICAgIHRoaXMuYXJlYXMgPSB7fTtcbiAgICAgIGRlbGV0ZSAkZGlhbG9nLmRhdGEoJ2dlbm9icm93c2VyJykuZ2Vub2Jyb3dzZXIoJ2FyZWFJbmRleCcpWyRkaWFsb2cuZGF0YSgndHJhY2snKS5uXTtcbiAgICB9XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJhbUZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCRUQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gYmVkRGV0YWlsIGlzIGEgdHJpdmlhbCBleHRlbnNpb24gb2YgQkVEIHRoYXQgaXMgZGVmaW5lZCBzZXBhcmF0ZWx5LFxuLy8gYWx0aG91Z2ggYSBCRUQgZmlsZSB3aXRoID4xMiBjb2x1bW5zIGlzIGFzc3VtZWQgdG8gYmUgYmVkRGV0YWlsIHRyYWNrIHJlZ2FyZGxlc3Mgb2YgdHlwZS5cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIExpbmVNYXNrID0gcmVxdWlyZSgnLi91dGlscy9MaW5lTWFzay5qcycpLkxpbmVNYXNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRcbnZhciBCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfVxuICB9LFxuICBcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBhbHRDb2xvcnMgPSBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gYWx0Q29sb3JzLmxlbmd0aCA+IDEgJiYgXy5hbGwoYWx0Q29sb3JzLCBzZWxmLnZhbGlkYXRlQ29sb3IpO1xuICAgIHNlbGYub3B0cy51c2VTY29yZSA9IHNlbGYuaXNPbihzZWxmLm9wdHMudXNlU2NvcmUpO1xuICAgIHNlbGYub3B0cy5pdGVtUmdiID0gc2VsZi5pc09uKHNlbGYub3B0cy5pdGVtUmdiKTtcbiAgICBpZiAoIXZhbGlkQ29sb3JCeVN0cmFuZCkgeyBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZCA9ICcnOyBzZWxmLm9wdHMuYWx0Q29sb3IgPSBudWxsOyB9XG4gICAgZWxzZSB7IHNlbGYub3B0cy5hbHRDb2xvciA9IGFsdENvbG9yc1sxXTsgfVxuICB9LFxuXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnbmFtZScsICdzY29yZScsICdzdHJhbmQnLCAndGhpY2tTdGFydCcsICd0aGlja0VuZCcsICdpdGVtUmdiJyxcbiAgICAgICdibG9ja0NvdW50JywgJ2Jsb2NrU2l6ZXMnLCAnYmxvY2tTdGFydHMnLCAnaWQnLCAnZGVzY3JpcHRpb24nXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IC9cXHQvLnRlc3QobGluZSkgPyBsaW5lLnNwbGl0KFwiXFx0XCIpIDogbGluZS5zcGxpdCgvXFxzKy8pLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGlmICh0aGlzLm9wdHMuZGV0YWlsKSB7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAyXSA9ICdpZCc7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAxXSA9ICdkZXNjcmlwdGlvbic7XG4gICAgfVxuICAgIF8uZWFjaChmaWVsZHMsIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUuY2hyb21dO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHsgXG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgJ1wiK2ZlYXR1cmUuY2hyb20rXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbVN0YXJ0KSArIDE7XG4gICAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbUVuZCkgKyAxO1xuICAgICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgICAgLy8gZmFuY2llciBCRUQgZmVhdHVyZXMgdG8gZXhwcmVzcyBjb2RpbmcgcmVnaW9ucyBhbmQgZXhvbnMvaW50cm9uc1xuICAgICAgaWYgKC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja1N0YXJ0KSAmJiAvXlxcZCskLy50ZXN0KGZlYXR1cmUudGhpY2tFbmQpKSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja1N0YXJ0KSArIDE7XG4gICAgICAgIGZlYXR1cmUudGhpY2tFbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUudGhpY2tFbmQpICsgMTtcbiAgICAgICAgaWYgKC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU2l6ZXMpICYmIC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU3RhcnRzKSkge1xuICAgICAgICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgICAgICAgYmxvY2tTaXplcyA9IGZlYXR1cmUuYmxvY2tTaXplcy5zcGxpdCgvLC8pO1xuICAgICAgICAgIF8uZWFjaChmZWF0dXJlLmJsb2NrU3RhcnRzLnNwbGl0KC8sLyksIGZ1bmN0aW9uKHN0YXJ0LCBpKSB7XG4gICAgICAgICAgICBpZiAoc3RhcnQgPT09ICcnKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcGFyc2VJbnQxMChzdGFydCl9O1xuICAgICAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBwYXJzZUludDEwKGJsb2NrU2l6ZXNbaV0pO1xuICAgICAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pO1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGxpbmUsIGxpbmVubyk7XG4gICAgICBpZiAoZmVhdHVyZSkgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIHN0YWNrZWRMYXlvdXQ6IGZ1bmN0aW9uKGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSkge1xuICAgIC8vIEEgbGluZU51bSBmdW5jdGlvbiBjYW4gYmUgcHJvdmlkZWQgd2hpY2ggY2FuIHNldC9yZXRyaWV2ZSB0aGUgbGluZSBvZiBhbHJlYWR5IHJlbmRlcmVkIGRhdGFwb2ludHNcbiAgICAvLyBzbyBhcyB0byBub3QgYnJlYWsgYSByYW5nZWQgZmVhdHVyZSB0aGF0IGV4dGVuZHMgb3ZlciBtdWx0aXBsZSB0aWxlcy5cbiAgICBsaW5lTnVtID0gXy5pc0Z1bmN0aW9uKGxpbmVOdW0pID8gbGluZU51bSA6IGZ1bmN0aW9uKCkgeyByZXR1cm47IH07XG4gICAgdmFyIGxpbmVzID0gW10sXG4gICAgICBtYXhFeGlzdGluZ0xpbmUgPSBfLm1heChfLm1hcChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIGxpbmVOdW0odi5kYXRhKSB8fCAwOyB9KSkgKyAxLFxuICAgICAgc29ydGVkSW50ZXJ2YWxzID0gXy5zb3J0QnkoaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7IHZhciBsbiA9IGxpbmVOdW0odi5kYXRhKTsgcmV0dXJuIF8uaXNVbmRlZmluZWQobG4pID8gMSA6IC1sbjsgfSk7XG4gICAgXG4gICAgd2hpbGUgKG1heEV4aXN0aW5nTGluZS0tPjApIHsgbGluZXMucHVzaChuZXcgTGluZU1hc2sod2lkdGgsIDUpKTsgfVxuICAgIF8uZWFjaChzb3J0ZWRJbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHZhciBkID0gdi5kYXRhLFxuICAgICAgICBsbiA9IGxpbmVOdW0oZCksXG4gICAgICAgIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwoZCksXG4gICAgICAgIHRoaWNrSW50ID0gZC50aGlja1N0YXJ0ICE9PSBudWxsICYmIGNhbGNQaXhJbnRlcnZhbCh7c3RhcnQ6IGQudGhpY2tTdGFydCwgZW5kOiBkLnRoaWNrRW5kfSksXG4gICAgICAgIGJsb2NrSW50cyA9IGQuYmxvY2tzICE9PSBudWxsICYmICBfLm1hcChkLmJsb2NrcywgY2FsY1BpeEludGVydmFsKSxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGwgPSBsaW5lcy5sZW5ndGg7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQobG4pKSB7XG4gICAgICAgIGlmIChsaW5lc1tsbl0uY29uZmxpY3QocEludC50eCwgcEludC50dykpIHsgY29uc29sZS5sb2coXCJVbnJlc29sdmFibGUgTGluZU1hc2sgY29uZmxpY3QhXCIpOyB9XG4gICAgICAgIGxpbmVzW2xuXS5hZGQocEludC50eCwgcEludC50dywge3BJbnQ6IHBJbnQsIHRoaWNrSW50OiB0aGlja0ludCwgYmxvY2tJbnRzOiBibG9ja0ludHMsIGQ6IGR9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoaWxlIChpIDwgbCAmJiBsaW5lc1tpXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyArK2k7IH1cbiAgICAgICAgaWYgKGkgPT0gbCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgICAgIGxpbmVOdW0oZCwgaSk7XG4gICAgICAgIGxpbmVzW2ldLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gXy5wbHVjayhsLml0ZW1zLCAnZGF0YScpOyB9KTtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIGludGVydmFscyA9IHRoaXMuZGF0YS5zZWFyY2goc3RhcnQsIGVuZCksXG4gICAgICBkcmF3U3BlYyA9IFtdLFxuICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJyk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXQpIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXQpKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgIHZhciBwSW50ID0gY2FsY1BpeEludGVydmFsKHYuZGF0YSk7XG4gICAgICAgIHBJbnQudiA9IHYuZGF0YS5zY29yZTtcbiAgICAgICAgZHJhd1NwZWMucHVzaChwSW50KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHRoaXMudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHRoaXMsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSl9O1xuICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGFkZEFyZWE6IGZ1bmN0aW9uKGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSkge1xuICAgIHZhciB0aXBUaXBEYXRhID0ge30sXG4gICAgICB0aXBUaXBEYXRhQ2FsbGJhY2sgPSB0aGlzLnR5cGUoKS50aXBUaXBEYXRhO1xuICAgIGlmICghYXJlYXMpIHsgcmV0dXJuOyB9XG4gICAgaWYgKF8uaXNGdW5jdGlvbih0aXBUaXBEYXRhQ2FsbGJhY2spKSB7XG4gICAgICB0aXBUaXBEYXRhID0gdGlwVGlwRGF0YUNhbGxiYWNrKGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmRlc2NyaXB0aW9uKSkgeyB0aXBUaXBEYXRhLmRlc2NyaXB0aW9uID0gZGF0YS5kLmRlc2NyaXB0aW9uOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLnNjb3JlKSkgeyB0aXBUaXBEYXRhLnNjb3JlID0gZGF0YS5kLnNjb3JlOyB9XG4gICAgICBfLmV4dGVuZCh0aXBUaXBEYXRhLCB7XG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9KTtcbiAgICAgIC8vIERpc3BsYXkgdGhlIElEIGNvbHVtbiAoZnJvbSBiZWREZXRhaWwpLCB1bmxlc3MgaXQgY29udGFpbnMgYSB0YWIgY2hhcmFjdGVyLCB3aGljaCBtZWFucyBpdCB3YXMgYXV0b2dlbmVyYXRlZFxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5pZCkgJiYgISgvXFx0LykudGVzdChkYXRhLmQuaWQpKSB7IHRpcFRpcERhdGEuaWQgPSBkYXRhLmQuaWQ7IH1cbiAgICB9XG4gICAgYXJlYXMucHVzaChbXG4gICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy8geDEsIHgyLCB5MSwgeTJcbiAgICAgIGRhdGEuZC5uYW1lIHx8IGRhdGEuZC5pZCB8fCAnJywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBuYW1lXG4gICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIF8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSA/IGRhdGEuZC5uYW1lIDogZGF0YS5kLmlkKSwgICAgLy8gaHJlZlxuICAgICAgZGF0YS5wSW50Lm9QcmV2LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICBudWxsLFxuICAgICAgbnVsbCxcbiAgICAgIHRpcFRpcERhdGFcbiAgICBdKTtcbiAgfSxcbiAgXG4gIC8vIFNjYWxlcyBhIHNjb3JlIGZyb20gMC0xMDAwIGludG8gYW4gYWxwaGEgdmFsdWUgYmV0d2VlbiAwLjIgYW5kIDEuMFxuICBjYWxjQWxwaGE6IGZ1bmN0aW9uKHZhbHVlKSB7IHJldHVybiBNYXRoLm1heCh2YWx1ZSwgMTY2KS8xMDAwOyB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhIGNvbG9yIHNjYWxlZCBiZXR3ZWVuICNjY2NjY2MgYW5kIG1heCBDb2xvclxuICBjYWxjR3JhZGllbnQ6IGZ1bmN0aW9uKG1heENvbG9yLCB2YWx1ZSkge1xuICAgIHZhciBtaW5Db2xvciA9IFsyMzAsMjMwLDIzMF0sXG4gICAgICB2YWx1ZUNvbG9yID0gW107XG4gICAgaWYgKCFfLmlzQXJyYXkobWF4Q29sb3IpKSB7IG1heENvbG9yID0gXy5tYXAobWF4Q29sb3Iuc3BsaXQoJywnKSwgcGFyc2VJbnQxMCk7IH1cbiAgICBfLmVhY2gobWluQ29sb3IsIGZ1bmN0aW9uKHYsIGkpIHsgdmFsdWVDb2xvcltpXSA9ICh2IC0gbWF4Q29sb3JbaV0pICogKCgxMDAwIC0gdmFsdWUpIC8gMTAwMC4wKSArIG1heENvbG9yW2ldOyB9KTtcbiAgICByZXR1cm4gXy5tYXAodmFsdWVDb2xvciwgcGFyc2VJbnQxMCkuam9pbignLCcpO1xuICB9LFxuICBcbiAgZHJhd0Fycm93czogZnVuY3Rpb24oY3R4LCBjYW52YXNXaWR0aCwgbGluZVksIGhhbGZIZWlnaHQsIHN0YXJ0WCwgZW5kWCwgZGlyZWN0aW9uKSB7XG4gICAgdmFyIGFycm93SGVpZ2h0ID0gTWF0aC5taW4oaGFsZkhlaWdodCwgMyksXG4gICAgICBYMSwgWDI7XG4gICAgc3RhcnRYID0gTWF0aC5tYXgoc3RhcnRYLCAwKTtcbiAgICBlbmRYID0gTWF0aC5taW4oZW5kWCwgY2FudmFzV2lkdGgpO1xuICAgIGlmIChlbmRYIC0gc3RhcnRYIDwgNSkgeyByZXR1cm47IH0gLy8gY2FuJ3QgZHJhdyBhcnJvd3MgaW4gdGhhdCBuYXJyb3cgb2YgYSBzcGFjZVxuICAgIGlmIChkaXJlY3Rpb24gIT09ICcrJyAmJiBkaXJlY3Rpb24gIT09ICctJykgeyByZXR1cm47IH0gLy8gaW52YWxpZCBkaXJlY3Rpb25cbiAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgLy8gQWxsIHRoZSAwLjUncyBoZXJlIGFyZSBkdWUgdG8gPGNhbnZhcz4ncyBzb21ld2hhdCBzaWxseSBjb29yZGluYXRlIHN5c3RlbSBcbiAgICAvLyBodHRwOi8vZGl2ZWludG9odG1sNS5pbmZvL2NhbnZhcy5odG1sI3BpeGVsLW1hZG5lc3NcbiAgICBYMSA9IGRpcmVjdGlvbiA9PSAnKycgPyAwLjUgOiBhcnJvd0hlaWdodCArIDAuNTtcbiAgICBYMiA9IGRpcmVjdGlvbiA9PSAnKycgPyBhcnJvd0hlaWdodCArIDAuNSA6IDAuNTtcbiAgICBmb3IgKHZhciBpID0gTWF0aC5mbG9vcihzdGFydFgpICsgMjsgaSA8IGVuZFggLSBhcnJvd0hlaWdodDsgaSArPSA3KSB7XG4gICAgICBjdHgubW92ZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0IC0gYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgICAgY3R4LmxpbmVUbyhpICsgWDIsIGxpbmVZICsgaGFsZkhlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgIH1cbiAgICBjdHguc3Ryb2tlKCk7XG4gIH0sXG4gIFxuICBkcmF3RmVhdHVyZTogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgeSA9IGkgKiBsaW5lSGVpZ2h0LFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBxdWFydGVySGVpZ2h0ID0gTWF0aC5jZWlsKDAuMjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgdGhpY2tPdmVybGFwID0gbnVsbCxcbiAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiAmJiBkYXRhLmQuaXRlbVJnYiAmJiB0aGlzLnZhbGlkYXRlQ29sb3IoZGF0YS5kLml0ZW1SZ2IpKSB7IGNvbG9yID0gZGF0YS5kLml0ZW1SZ2I7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGNvbG9yID0gc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIGRhdGEuZC5zY29yZSk7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLml0ZW1SZ2IgfHwgc2VsZi5vcHRzLmFsdENvbG9yIHx8IHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiOyB9XG4gICAgXG4gICAgaWYgKGRhdGEudGhpY2tJbnQpIHtcbiAgICAgIC8vIFRoZSBjb2RpbmcgcmVnaW9uIGlzIGRyYXduIGFzIGEgdGhpY2tlciBsaW5lIHdpdGhpbiB0aGUgZ2VuZVxuICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzKSB7XG4gICAgICAgIC8vIElmIHRoZXJlIGFyZSBleG9ucyBhbmQgaW50cm9ucywgZHJhdyB0aGUgaW50cm9ucyB3aXRoIGEgMXB4IGxpbmVcbiAgICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgMSk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICAgICAgICBfLmVhY2goZGF0YS5ibG9ja0ludHMsIGZ1bmN0aW9uKGJJbnQpIHtcbiAgICAgICAgICBpZiAoYkludC54ICsgYkludC53IDw9IHdpZHRoICYmIGJJbnQueCA+PSAwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBiSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaWNrT3ZlcmxhcCA9IHV0aWxzLnBpeEludGVydmFsT3ZlcmxhcChiSW50LCBkYXRhLnRoaWNrSW50KTtcbiAgICAgICAgICBpZiAodGhpY2tPdmVybGFwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QodGhpY2tPdmVybGFwLngsIHkgKyAxLCB0aGlja092ZXJsYXAudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgaW50cm9ucywgYXJyb3dzIGFyZSBkcmF3biBvbiB0aGUgaW50cm9ucywgbm90IHRoZSBleG9ucy4uLlxuICAgICAgICAgIGlmIChkYXRhLmQuc3RyYW5kICYmIHByZXZCSW50KSB7XG4gICAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgcHJldkJJbnQueCArIHByZXZCSW50LncsIGJJbnQueCwgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHByZXZCSW50ID0gYkludDtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIC4uLnVubGVzcyB0aGVyZSB3ZXJlIG5vIGludHJvbnMuIFRoZW4gaXQgaXMgZHJhd24gb24gdGhlIGNvZGluZyByZWdpb24uXG4gICAgICAgIGlmIChkYXRhLmJsb2NrSW50cy5sZW5ndGggPT0gMSkge1xuICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBXZSBoYXZlIGEgY29kaW5nIHJlZ2lvbiBidXQgbm8gaW50cm9ucy9leG9uc1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGRhdGEucEludC53LCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS50aGlja0ludC54LCB5ICsgMSwgZGF0YS50aGlja0ludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm90aGluZyBmYW5jeS4gIEl0J3MgYSBib3guXG4gICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEucEludC54LCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICB9XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSBzZWxmLm9wdHMudXJsID8gc2VsZi5vcHRzLnVybCA6ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTUgOiA2LFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgXG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgLy8gVE9ETzogSSBkaXNhYmxlZCByZWdlbmVyYXRpbmcgYXJlYXMgaGVyZSwgd2hpY2ggYXNzdW1lcyB0aGF0IGxpbmVOdW0gcmVtYWlucyBzdGFibGUgYWNyb3NzIHJlLXJlbmRlcnMuIFNob3VsZCBjaGVjayBvbiB0aGlzLlxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gXCJyZ2JhKFwiK3NlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBwSW50LnYpK1wiKVwiOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxheW91dCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0ZlYXR1cmUuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KTsgICAgICAgICAgICAgIFxuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAvXFxkKyxcXGQrLFxcZCtcXHMrXFxkKyxcXGQrLFxcZCsvLnRlc3Qoby5jb2xvckJ5U3RyYW5kKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gPyBvLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKVsxXSA6ICcwLDAsMCc7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuYXR0cignY2hlY2tlZCcsICEhY29sb3JCeVN0cmFuZE9uKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKGNvbG9yQnlTdHJhbmQpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnVzZVNjb3JlKSk7ICAgIFxuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbChvLnVybCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbCgpLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gdGhpcy52YWxpZGF0ZUNvbG9yKGNvbG9yQnlTdHJhbmQpO1xuICAgIG8uY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiAmJiB2YWxpZENvbG9yQnlTdHJhbmQgPyBvLmNvbG9yICsgJyAnICsgY29sb3JCeVN0cmFuZCA6ICcnO1xuICAgIG8udXNlU2NvcmUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmlzKCc6Y2hlY2tlZCcpID8gMSA6IDA7XG4gICAgby51cmwgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoKTtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkR3JhcGggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iZWRncmFwaC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkZ3JhcGhcbnZhciBCZWRHcmFwaEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdC5jYWxsKHRoaXMpOyB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7IH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnZGF0YVZhbHVlJ10sXG4gICAgICAgIGRhdHVtID0ge30sXG4gICAgICAgIGNoclBvcywgc3RhcnQsIGVuZCwgdmFsO1xuICAgICAgXy5lYWNoKGxpbmUuc3BsaXQoL1xccysvKSwgZnVuY3Rpb24odiwgaSkgeyBkYXR1bVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZGF0dW0uY2hyb21dO1xuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbVN0YXJ0KTtcbiAgICAgIGVuZCA9IHBhcnNlSW50MTAoZGF0dW0uY2hyb21FbmQpO1xuICAgICAgdmFsID0gcGFyc2VGbG9hdChkYXR1bS5kYXRhVmFsdWUpO1xuICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIGVuZCwgdmFsOiB2YWx9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkR3JhcGhGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ0JlZCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ0JlZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmlnYmVkXG52YXIgQmlnQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnQmVkIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgY2FjaGUgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiaWdiZWQucGhwJyxcbiAgICAgIHJlbW90ZTtcbiAgICBcbiAgICByZW1vdGUgPSBuZXcgUmVtb3RlVHJhY2soY2FjaGUsIGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIHN0b3JlSW50ZXJ2YWxzKSB7XG4gICAgICByYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCBkZW5zaXR5OiAncGFjayd9LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgdmFyIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID49IDI7IH0pO1xuICAgICAgICAgIHZhciBpbnRlcnZhbHMgPSBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyBcbiAgICAgICAgICAgIHZhciBpdHZsID0gc2VsZi50eXBlKCdiZWQnKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsKTsgXG4gICAgICAgICAgICAvLyBVc2UgQmlvUGVybCdzIEJpbzo6REI6QmlnQmVkIHN0cmF0ZWd5IGZvciBkZWR1cGxpY2F0aW5nIHJlLWZldGNoZWQgaW50ZXJ2YWxzOlxuICAgICAgICAgICAgLy8gXCJCZWNhdXNlIEJFRCBmaWxlcyBkb24ndCBhY3R1YWxseSB1c2UgSURzLCB0aGUgSUQgaXMgY29uc3RydWN0ZWQgZnJvbSB0aGUgZmVhdHVyZSdzIG5hbWUgKGlmIGFueSksIGNocm9tb3NvbWUgY29vcmRpbmF0ZXMsIHN0cmFuZCBhbmQgYmxvY2sgY291bnQuXCJcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGl0dmwuaWQpKSB7XG4gICAgICAgICAgICAgIGl0dmwuaWQgPSBbaXR2bC5uYW1lLCBpdHZsLmNocm9tLCBpdHZsLmNocm9tU3RhcnQsIGl0dmwuY2hyb21FbmQsIGl0dmwuc3RyYW5kLCBpdHZsLmJsb2NrQ291bnRdLmpvaW4oXCJcXHRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaXR2bDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBcbiAgICAvLyBHZXQgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiaWdCZWQgYW5kIHNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhlIFJlbW90ZVRyYWNrXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHsgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCB9LFxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAvLyBTZXQgbWF4RmV0Y2hXaW5kb3cgdG8gYXZvaWQgb3ZlcmZldGNoaW5nIGRhdGEuXG4gICAgICAgIGlmICghc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICAgICAgdmFyIG1lYW5JdGVtc1BlckJwID0gZGF0YS5pdGVtQ291bnQgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKHNlbGYub3B0cy5kcmF3TGltaXQpKTtcbiAgICAgICAgICBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICAgIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAvIDMpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93LCBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGZ1bmN0aW9uIHBhcnNlRGVuc2VEYXRhKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLCBcbiAgICAgICAgbGluZXM7XG4gICAgICBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccysvZyk7XG4gICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIHgpIHsgXG4gICAgICAgIGlmIChsaW5lICE9ICduL2EnICYmIGxpbmUubGVuZ3RoKSB7IGRyYXdTcGVjLnB1c2goe3g6IHgsIHc6IDEsIHY6IHBhcnNlRmxvYXQobGluZSkgKiAxMDAwfSk7IH0gXG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIGRlbnNpdHkgaXMgbm90ICdkZW5zZScgYW5kIHdlIGNhbiByZWFzb25hYmx5XG4gICAgLy8gZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtYW55IHJvd3MgKD41MDAgZmVhdHVyZXMpLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLCB7XG4gICAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCBkZW5zaXR5OiBkZW5zaXR5fSxcbiAgICAgICAgICBzdWNjZXNzOiBwYXJzZURlbnNlRGF0YVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgICB2YXIgY2FsY1BpeEludGVydmFsLCBkcmF3U3BlYyA9IHt9O1xuICAgICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5ID09ICdwYWNrJyk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKTtcbiAgICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnQmVkRm9ybWF0OyIsIlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnV2lnIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnV2lnLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBCaWdXaWdGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcxMjgsMTI4LDEyOCcsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdXaWcgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHsnbWluaW11bSc6MSwgJ21heGltdW0nOjEsICdtZWFuJzoxLCAnbWluJzoxLCAnbWF4JzoxLCAnc3RkJzoxLCAnY292ZXJhZ2UnOjF9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHNlbGYub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgIGFzeW5jOiBmYWxzZSwgIC8vIFRoaXMgaXMgY29vbCBzaW5jZSBwYXJzaW5nIG5vcm1hbGx5IGhhcHBlbnMgaW4gYSBXZWIgV29ya2VyXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciByb3dzID0gZGF0YS5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgXy5lYWNoKHJvd3MsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICB2YXIga2V5dmFsID0gci5zcGxpdCgnOiAnKTtcbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWluJykgeyBzZWxmLnJhbmdlWzBdID0gTWF0aC5taW4ocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzBdKTsgfVxuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtYXgnKSB7IHNlbGYucmFuZ2VbMV0gPSBNYXRoLm1heChwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMV0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGNoclJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZSA9PSAnbi9hJykgeyBkcmF3U3BlYy5iYXJzLnB1c2gobnVsbCk7IH1cbiAgICAgICAgZWxzZSBpZiAobGluZS5sZW5ndGgpIHsgZHJhd1NwZWMuYmFycy5wdXNoKChwYXJzZUZsb2F0KGxpbmUpIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTsgfVxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtyYW5nZTogY2hyUmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIHdpZHRoOiB3aWR0aCwgd2luRnVuYzogc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9ufSxcbiAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICB9KTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdXaWdGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBmZWF0dXJlVGFibGUgZm9ybWF0OiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmZlYXR1cmV0YWJsZVxudmFyIEZlYXR1cmVUYWJsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjb2xsYXBzZUJ5R2VuZTogJ29mZicsXG4gICAga2V5Q29sdW1uV2lkdGg6IDIxLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lID0gdGhpcy5pc09uKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSk7XG4gICAgdGhpcy5mZWF0dXJlVHlwZUNvdW50cyA9IHt9O1xuICB9LFxuICBcbiAgLy8gcGFyc2VzIG9uZSBmZWF0dXJlIGtleSArIGxvY2F0aW9uL3F1YWxpZmllcnMgcm93IGZyb20gdGhlIGZlYXR1cmUgdGFibGVcbiAgcGFyc2VFbnRyeTogZnVuY3Rpb24oY2hyb20sIGxpbmVzLCBzdGFydExpbmVObykge1xuICAgIHZhciBmZWF0dXJlID0ge1xuICAgICAgICBjaHJvbTogY2hyb20sXG4gICAgICAgIHNjb3JlOiAnPycsXG4gICAgICAgIGJsb2NrczogbnVsbCxcbiAgICAgICAgcXVhbGlmaWVyczoge31cbiAgICAgIH0sXG4gICAgICBrZXlDb2x1bW5XaWR0aCA9IHRoaXMub3B0cy5rZXlDb2x1bW5XaWR0aCxcbiAgICAgIHF1YWxpZmllciA9IG51bGwsXG4gICAgICBmdWxsTG9jYXRpb24gPSBbXSxcbiAgICAgIGNvbGxhcHNlS2V5UXVhbGlmaWVycyA9IFsnbG9jdXNfdGFnJywgJ2dlbmUnLCAnZGJfeHJlZiddLFxuICAgICAgcXVhbGlmaWVyc1RoYXRBcmVOYW1lcyA9IFsnZ2VuZScsICdsb2N1c190YWcnLCAnZGJfeHJlZiddLFxuICAgICAgUk5BVHlwZXMgPSBbJ3JybmEnLCAndHJuYSddLFxuICAgICAgYWxzb1RyeUZvclJOQVR5cGVzID0gWydwcm9kdWN0J10sXG4gICAgICBsb2NhdGlvblBvc2l0aW9ucywgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocm9tXTtcbiAgICBzdGFydExpbmVObyA9IHN0YXJ0TGluZU5vIHx8IDA7XG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmlsbCBvdXQgZmVhdHVyZSdzIGtleXMgd2l0aCBpbmZvIGZyb20gdGhlc2UgbGluZXNcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGtleSA9IGxpbmUuc3Vic3RyKDAsIGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcmVzdE9mTGluZSA9IGxpbmUuc3Vic3RyKGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcXVhbGlmaWVyTWF0Y2ggPSByZXN0T2ZMaW5lLm1hdGNoKC9eXFwvKFxcdyspKD0/KSguKikvKTtcbiAgICAgIGlmIChrZXkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGZlYXR1cmUudHlwZSA9IHN0cmlwKGtleSk7XG4gICAgICAgIHF1YWxpZmllciA9IG51bGw7XG4gICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHF1YWxpZmllck1hdGNoKSB7XG4gICAgICAgICAgcXVhbGlmaWVyID0gcXVhbGlmaWVyTWF0Y2hbMV07XG4gICAgICAgICAgaWYgKCFmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkgeyBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSA9IFtdOyB9XG4gICAgICAgICAgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0ucHVzaChbcXVhbGlmaWVyTWF0Y2hbMl0gPyBxdWFsaWZpZXJNYXRjaFszXSA6IHRydWVdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAocXVhbGlmaWVyICE9PSBudWxsKSB7IFxuICAgICAgICAgICAgXy5sYXN0KGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKS5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbi5qb2luKCcnKTtcbiAgICBsb2NhdGlvblBvc2l0aW9ucyA9IF8ubWFwKF8uZmlsdGVyKGZ1bGxMb2NhdGlvbi5zcGxpdCgvXFxEKy8pLCBfLmlkZW50aXR5KSwgcGFyc2VJbnQxMCk7XG4gICAgZmVhdHVyZS5jaHJvbVN0YXJ0ID0gIF8ubWluKGxvY2F0aW9uUG9zaXRpb25zKTtcbiAgICBmZWF0dXJlLmNocm9tRW5kID0gXy5tYXgobG9jYXRpb25Qb3NpdGlvbnMpICsgMTsgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaHJvbUVuZCBjb2x1bW5zIGluIEJFRCBmb3JtYXQgYXJlICpub3QqLlxuICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tU3RhcnQ7XG4gICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tRW5kOyBcbiAgICBmZWF0dXJlLnN0cmFuZCA9IC9jb21wbGVtZW50Ly50ZXN0KGZ1bGxMb2NhdGlvbikgPyBcIi1cIiA6IFwiK1wiO1xuICAgIFxuICAgIC8vIFVudGlsIHdlIG1lcmdlIGJ5IGdlbmUgbmFtZSwgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aGVzZVxuICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgIGZlYXR1cmUuYmxvY2tzID0gbnVsbDtcbiAgICBcbiAgICAvLyBQYXJzZSB0aGUgcXVhbGlmaWVycyBwcm9wZXJseVxuICAgIF8uZWFjaChmZWF0dXJlLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIF8uZWFjaCh2LCBmdW5jdGlvbihlbnRyeUxpbmVzLCBpKSB7XG4gICAgICAgIHZbaV0gPSBzdHJpcChlbnRyeUxpbmVzLmpvaW4oJyAnKSk7XG4gICAgICAgIGlmICgvXlwiW1xcc1xcU10qXCIkLy50ZXN0KHZbaV0pKSB7XG4gICAgICAgICAgLy8gRGVxdW90ZSBmcmVlIHRleHRcbiAgICAgICAgICB2W2ldID0gdltpXS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKS5yZXBsYWNlKC9cIlwiL2csICdcIicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vaWYgKHYubGVuZ3RoID09IDEpIHsgZmVhdHVyZS5xdWFsaWZpZXJzW2tdID0gdlswXTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZpbmQgc29tZXRoaW5nIHRoYXQgY2FuIHNlcnZlIGFzIGEgbmFtZVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUudHlwZTtcbiAgICBpZiAoXy5jb250YWlucyhSTkFUeXBlcywgZmVhdHVyZS50eXBlLnRvTG93ZXJDYXNlKCkpKSB7IFxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgYWxzb1RyeUZvclJOQVR5cGVzKTsgXG4gICAgfVxuICAgIF8uZmluZChxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBmdW5jdGlvbihrKSB7XG4gICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyByZXR1cm4gKGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7IH1cbiAgICB9KTtcbiAgICAvLyBJbiB0aGUgd29yc3QgY2FzZSwgYWRkIGEgY291bnRlciB0byBkaXNhbWJpZ3VhdGUgZmVhdHVyZXMgbmFtZWQgb25seSBieSB0eXBlXG4gICAgaWYgKGZlYXR1cmUubmFtZSA9PSBmZWF0dXJlLnR5cGUpIHtcbiAgICAgIGlmICghdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKSB7IHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSA9IDE7IH1cbiAgICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUubmFtZSArICdfJyArIHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSsrO1xuICAgIH1cbiAgICBcbiAgICAvLyBGaW5kIGEga2V5IHRoYXQgaXMgYXBwcm9wcmlhdGUgZm9yIGNvbGxhcHNpbmdcbiAgICBpZiAodGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmZpbmQoY29sbGFwc2VLZXlRdWFsaWZpZXJzLCBmdW5jdGlvbihrKSB7XG4gICAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IFxuICAgICAgICAgIHJldHVybiAoZmVhdHVyZS5fY29sbGFwc2VLZXkgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICAvLyBjb2xsYXBzZXMgbXVsdGlwbGUgZmVhdHVyZXMgdGhhdCBhcmUgYWJvdXQgdGhlIHNhbWUgZ2VuZSBpbnRvIG9uZSBkcmF3YWJsZSBmZWF0dXJlXG4gIGNvbGxhcHNlRmVhdHVyZXM6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XG4gICAgdmFyIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLFxuICAgICAgcHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvID0gWydtcm5hJywgJ2dlbmUnLCAnY2RzJ10sXG4gICAgICBwcmVmZXJyZWRUeXBlRm9yRXhvbnMgPSBbJ2V4b24nLCAnY2RzJ10sXG4gICAgICBtZXJnZUludG8gPSBmZWF0dXJlc1swXSxcbiAgICAgIGJsb2NrcyA9IFtdLFxuICAgICAgZm91bmRUeXBlLCBjZHMsIGV4b25zO1xuICAgIGZvdW5kVHlwZSA9IF8uZmluZChwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8sIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBmb3VuZCA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZm91bmQpIHsgbWVyZ2VJbnRvID0gZm91bmQ7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gTG9vayBmb3IgZXhvbnMgKGV1a2FyeW90aWMpIG9yIGEgQ0RTIChwcm9rYXJ5b3RpYylcbiAgICBfLmZpbmQocHJlZmVycmVkVHlwZUZvckV4b25zLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICBleG9ucyA9IF8uc2VsZWN0KGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChleG9ucy5sZW5ndGgpIHsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBjZHMgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IFwiY2RzXCI7IH0pO1xuICAgIFxuICAgIF8uZWFjaChleG9ucywgZnVuY3Rpb24oZXhvbkZlYXR1cmUpIHtcbiAgICAgIGV4b25GZWF0dXJlLmZ1bGxMb2NhdGlvbi5yZXBsYWNlKC8oXFxkKylcXC5cXC5bPjxdPyhcXGQrKS9nLCBmdW5jdGlvbihmdWxsTWF0Y2gsIHN0YXJ0LCBlbmQpIHtcbiAgICAgICAgYmxvY2tzLnB1c2goe1xuICAgICAgICAgIHN0YXJ0OiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgTWF0aC5taW4oc3RhcnQsIGVuZCksIFxuICAgICAgICAgIC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2UuXG4gICAgICAgICAgZW5kOiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgIE1hdGgubWF4KHN0YXJ0LCBlbmQpICsgMVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIENvbnZlcnQgZXhvbnMgYW5kIENEUyBpbnRvIGJsb2NrcywgdGhpY2tTdGFydCBhbmQgdGhpY2tFbmQgKGluIEJFRCB0ZXJtaW5vbG9neSlcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCkgeyBcbiAgICAgIG1lcmdlSW50by5ibG9ja3MgPSBfLnNvcnRCeShibG9ja3MsIGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGIuc3RhcnQ7IH0pO1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrU3RhcnQgPSBjZHMgPyBjZHMuc3RhcnQgOiBmZWF0dXJlLnN0YXJ0O1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrRW5kID0gY2RzID8gY2RzLmVuZCA6IGZlYXR1cmUuZW5kO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaW5hbGx5LCBtZXJnZSBhbGwgdGhlIHF1YWxpZmllcnNcbiAgICBfLmVhY2goZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHtcbiAgICAgIGlmIChmZWF0ID09PSBtZXJnZUludG8pIHsgcmV0dXJuOyB9XG4gICAgICBfLmVhY2goZmVhdC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2YWx1ZXMsIGspIHtcbiAgICAgICAgaWYgKCFtZXJnZUludG8ucXVhbGlmaWVyc1trXSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXSA9IFtdOyB9XG4gICAgICAgIF8uZWFjaCh2YWx1ZXMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICBpZiAoIV8uY29udGFpbnMobWVyZ2VJbnRvLnF1YWxpZmllcnNba10sIHYpKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLnB1c2godik7IH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VJbnRvO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgbnVtTGluZXMgPSBsaW5lcy5sZW5ndGgsXG4gICAgICBjaHJvbSA9IG51bGwsXG4gICAgICBsYXN0RW50cnlTdGFydCA9IG51bGwsXG4gICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXkgPSB7fSxcbiAgICAgIGZlYXR1cmU7XG4gICAgXG4gICAgZnVuY3Rpb24gY29sbGVjdExhc3RFbnRyeShsaW5lbm8pIHtcbiAgICAgIGlmIChsYXN0RW50cnlTdGFydCAhPT0gbnVsbCkge1xuICAgICAgICBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VFbnRyeS5jYWxsKHNlbGYsIGNocm9tLCBsaW5lcy5zbGljZShsYXN0RW50cnlTdGFydCwgbGluZW5vKSwgbGFzdEVudHJ5U3RhcnQpO1xuICAgICAgICBpZiAoZmVhdHVyZSkgeyBcbiAgICAgICAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSA9IGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gfHwgW107XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldLnB1c2goZmVhdHVyZSk7XG4gICAgICAgICAgfSBlbHNlIHsgZGF0YS5hZGQoZmVhdHVyZSk7IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBDaHVuayB0aGUgbGluZXMgaW50byBlbnRyaWVzIGFuZCBwYXJzZSBlYWNoIG9mIHRoZW1cbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgaWYgKGxpbmUuc3Vic3RyKDAsIDEyKSA9PSBcIkFDQ0VTU0lPTiAgIFwiKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgY2hyb20gPSBsaW5lLnN1YnN0cigxMik7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbDtcbiAgICAgIH0gZWxzZSBpZiAoY2hyb20gIT09IG51bGwgJiYgbGluZS5zdWJzdHIoNSwgMSkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBsaW5lbm87XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gcGFyc2UgdGhlIGxhc3QgZW50cnlcbiAgICBpZiAoY2hyb20gIT09IG51bGwpIHsgY29sbGVjdExhc3RFbnRyeShsaW5lcy5sZW5ndGgpOyB9XG4gICAgXG4gICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZWFjaChmZWF0dXJlc0J5Q29sbGFwc2VLZXksIGZ1bmN0aW9uKGZlYXR1cmVzLCBnZW5lKSB7XG4gICAgICAgIGRhdGEuYWRkKHNlbGYudHlwZSgpLmNvbGxhcHNlRmVhdHVyZXMuY2FsbChzZWxmLCBmZWF0dXJlcykpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHF1YWxpZmllcnNUb0FiYnJldmlhdGUgPSB7dHJhbnNsYXRpb246IDF9LFxuICAgICAgY29udGVudCA9IHtcbiAgICAgICAgdHlwZTogZGF0YS5kLnR5cGUsXG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9O1xuICAgIGlmIChkYXRhLmQucXVhbGlmaWVycy5ub3RlICYmIGRhdGEuZC5xdWFsaWZpZXJzLm5vdGVbMF0pIHsgIH1cbiAgICBfLmVhY2goZGF0YS5kLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIGlmIChrID09ICdub3RlJykgeyBjb250ZW50LmRlc2NyaXB0aW9uID0gdi5qb2luKCc7ICcpOyByZXR1cm47IH1cbiAgICAgIGNvbnRlbnRba10gPSB2LmpvaW4oJzsgJyk7XG4gICAgICBpZiAocXVhbGlmaWVyc1RvQWJicmV2aWF0ZVtrXSAmJiBjb250ZW50W2tdLmxlbmd0aCA+IDI1KSB7IGNvbnRlbnRba10gPSBjb250ZW50W2tdLnN1YnN0cigwLCAyNSkgKyAnLi4uJzsgfVxuICAgIH0pO1xuICAgIHJldHVybiBjb250ZW50O1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuZHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMudHlwZSgnYmVkJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmVhdHVyZVRhYmxlRm9ybWF0OyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7ICBcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBCeSBTaGluIFN1enVraSwgTUlUIGxpY2Vuc2VcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGlub3V0L2ludGVydmFsLXRyZWVcbiAqIEludGVydmFsVHJlZVxuICpcbiAqIEBwYXJhbSAob2JqZWN0KSBkYXRhOlxuICogQHBhcmFtIChudW1iZXIpIGNlbnRlcjpcbiAqIEBwYXJhbSAob2JqZWN0KSBvcHRpb25zOlxuICogICBjZW50ZXI6XG4gKlxuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucykge1xuICBvcHRpb25zIHx8IChvcHRpb25zID0ge30pO1xuXG4gIHRoaXMuc3RhcnRLZXkgICAgID0gb3B0aW9ucy5zdGFydEtleSB8fCAwOyAvLyBzdGFydCBrZXlcbiAgdGhpcy5lbmRLZXkgICAgICAgPSBvcHRpb25zLmVuZEtleSAgIHx8IDE7IC8vIGVuZCBrZXlcbiAgdGhpcy5pbnRlcnZhbEhhc2ggPSB7fTsgICAgICAgICAgICAgICAgICAgIC8vIGlkID0+IGludGVydmFsIG9iamVjdFxuICB0aGlzLnBvaW50VHJlZSA9IG5ldyBTb3J0ZWRMaXN0KHsgICAgICAgICAgLy8gYi10cmVlIG9mIHN0YXJ0LCBlbmQgcG9pbnRzIFxuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYVswXS0gYlswXTtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQgPSAwO1xuXG4gIC8vIGluZGV4IG9mIHRoZSByb290IG5vZGVcbiAgaWYgKCFjZW50ZXIgfHwgdHlwZW9mIGNlbnRlciAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBjZW50ZXIgaW5kZXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IG5ldyBOb2RlKGNlbnRlciwgdGhpcyk7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICBpZiAodGhpcy5jb250YWlucyhpZCkpIHtcbiAgICB0aHJvdyBuZXcgRHVwbGljYXRlRXJyb3IoJ2lkICcgKyBpZCArICcgaXMgYWxyZWFkeSByZWdpc3RlcmVkLicpO1xuICB9XG5cbiAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgIHdoaWxlICh0aGlzLmludGVydmFsSGFzaFt0aGlzLl9hdXRvSW5jcmVtZW50XSkge1xuICAgICAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICAgIH1cbiAgICBpZCA9IHRoaXMuX2F1dG9JbmNyZW1lbnQ7XG4gIH1cblxuICB2YXIgaXR2bCA9IG5ldyBJbnRlcnZhbChkYXRhLCBpZCwgdGhpcy5zdGFydEtleSwgdGhpcy5lbmRLZXkpO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuc3RhcnQsIGlkXSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5lbmQsICAgaWRdKTtcbiAgdGhpcy5pbnRlcnZhbEhhc2hbaWRdID0gaXR2bDtcbiAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICBcbiAgX2luc2VydC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgaXR2bCk7XG59O1xuXG5cbi8qKlxuICogY2hlY2sgaWYgcmFuZ2UgaXMgYWxyZWFkeSBwcmVzZW50LCBiYXNlZCBvbiBpdHMgaWRcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuY29udGFpbnMgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gISF0aGlzLmdldChpZCk7XG59XG5cblxuLyoqXG4gKiByZXRyaWV2ZSBhbiBpbnRlcnZhbCBieSBpdHMgaWQ7IHJldHVybnMgbnVsbCBpZiBpdCBkb2VzIG5vdCBleGlzdFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gdGhpcy5pbnRlcnZhbEhhc2hbaWRdIHx8IG51bGw7XG59XG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlIG9ubHkgaWYgaXQgaXMgbmV3LCBiYXNlZCBvbiB3aGV0aGVyIHRoZSBpZCB3YXMgYWxyZWFkeSByZWdpc3RlcmVkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3ID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgdHJ5IHtcbiAgICB0aGlzLmFkZChkYXRhLCBpZCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIER1cGxpY2F0ZUVycm9yKSB7IHJldHVybjsgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAoaW50ZWdlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIpIHtcbiAgdmFyIHJldCA9IFtdO1xuICBpZiAodHlwZW9mIHZhbDEgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuXG4gIGlmICh2YWwyID09IHVuZGVmaW5lZCkge1xuICAgIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgdmFsMSwgcmV0KTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2YgdmFsMiA9PSAnbnVtYmVyJykge1xuICAgIF9yYW5nZVNlYXJjaC5jYWxsKHRoaXMsIHZhbDEsIHZhbDIsIHJldCk7XG4gIH1cbiAgZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnLCcgKyB2YWwyICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiBcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyB0aGUgc2hpZnQtcmlnaHQtYW5kLWZpbGwgb3BlcmF0b3IsIGV4dGVuZGVkIGJleW9uZCB0aGUgcmFuZ2Ugb2YgYW4gaW50MzJcbmZ1bmN0aW9uIF9iaXRTaGlmdFJpZ2h0KG51bSkge1xuICBpZiAobnVtID4gMjE0NzQ4MzY0NyB8fCBudW0gPCAtMjE0NzQ4MzY0OCkgeyByZXR1cm4gTWF0aC5mbG9vcihudW0gLyAyKTsgfVxuICByZXR1cm4gbnVtID4+PiAxO1xufVxuXG4vKipcbiAqIF9pbnNlcnRcbiAqKi9cbmZ1bmN0aW9uIF9pbnNlcnQobm9kZSwgaXR2bCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChpdHZsLmVuZCA8IG5vZGUuaWR4KSB7XG4gICAgICBpZiAoIW5vZGUubGVmdCkge1xuICAgICAgICBub2RlLmxlZnQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChub2RlLmlkeCA8IGl0dmwuc3RhcnQpIHtcbiAgICAgIGlmICghbm9kZS5yaWdodCkge1xuICAgICAgICBub2RlLnJpZ2h0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG5vZGUuaW5zZXJ0KGl0dmwpO1xuICAgIH1cbiAgfVxufVxuXG5cbi8qKlxuICogX3BvaW50U2VhcmNoXG4gKiBAcGFyYW0gKE5vZGUpIG5vZGVcbiAqIEBwYXJhbSAoaW50ZWdlcikgaWR4IFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcG9pbnRTZWFyY2gobm9kZSwgaWR4LCBhcnIpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoIW5vZGUpIGJyZWFrO1xuICAgIGlmIChpZHggPCBub2RlLmlkeCkge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5zdGFydCA8PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAoaWR4ID4gbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuZW5kcy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLmVuZCA+PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLm1hcChmdW5jdGlvbihpdHZsKSB7IGFyci5wdXNoKGl0dmwucmVzdWx0KCkpIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cblxuXG4vKipcbiAqIF9yYW5nZVNlYXJjaFxuICogQHBhcmFtIChpbnRlZ2VyKSBzdGFydFxuICogQHBhcmFtIChpbnRlZ2VyKSBlbmRcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3JhbmdlU2VhcmNoKHN0YXJ0LCBlbmQsIGFycikge1xuICBpZiAoZW5kIC0gc3RhcnQgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kIG11c3QgYmUgZ3JlYXRlciB0aGFuIHN0YXJ0LiBzdGFydDogJyArIHN0YXJ0ICsgJywgZW5kOiAnICsgZW5kKTtcbiAgfVxuICB2YXIgcmVzdWx0SGFzaCA9IHt9O1xuXG4gIHZhciB3aG9sZVdyYXBzID0gW107XG4gIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgX2JpdFNoaWZ0UmlnaHQoc3RhcnQgKyBlbmQpLCB3aG9sZVdyYXBzLCB0cnVlKTtcblxuICB3aG9sZVdyYXBzLmZvckVhY2goZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgcmVzdWx0SGFzaFtyZXN1bHQuaWRdID0gdHJ1ZTtcbiAgfSk7XG5cblxuICB2YXIgaWR4MSA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW3N0YXJ0LCBudWxsXSk7XG4gIHdoaWxlIChpZHgxID49IDAgJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDFdWzBdID09IHN0YXJ0KSB7XG4gICAgaWR4MS0tO1xuICB9XG5cbiAgdmFyIGlkeDIgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtlbmQsICAgbnVsbF0pO1xuICB2YXIgbGVuID0gdGhpcy5wb2ludFRyZWUuYXJyLmxlbmd0aCAtIDE7XG4gIHdoaWxlIChpZHgyID09IC0xIHx8IChpZHgyIDw9IGxlbiAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4Ml1bMF0gPD0gZW5kKSkge1xuICAgIGlkeDIrKztcbiAgfVxuXG4gIHRoaXMucG9pbnRUcmVlLmFyci5zbGljZShpZHgxICsgMSwgaWR4MikuZm9yRWFjaChmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBpZCA9IHBvaW50WzFdO1xuICAgIHJlc3VsdEhhc2hbaWRdID0gdHJ1ZTtcbiAgfSwgdGhpcyk7XG5cbiAgT2JqZWN0LmtleXMocmVzdWx0SGFzaCkuZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgIHZhciBpdHZsID0gdGhpcy5pbnRlcnZhbEhhc2hbaWRdO1xuICAgIGFyci5wdXNoKGl0dmwucmVzdWx0KHN0YXJ0LCBlbmQpKTtcbiAgfSwgdGhpcyk7XG5cbn1cblxuXG5cbi8qKlxuICogc3ViY2xhc3Nlc1xuICogXG4gKiovXG5cblxuLyoqXG4gKiBOb2RlIDogcHJvdG90eXBlIG9mIGVhY2ggbm9kZSBpbiBhIGludGVydmFsIHRyZWVcbiAqIFxuICoqL1xuZnVuY3Rpb24gTm9kZShpZHgpIHtcbiAgdGhpcy5pZHggPSBpZHg7XG4gIHRoaXMuc3RhcnRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVuZHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLmVuZCAtIGIuZW5kO1xuICAgICAgcmV0dXJuIChjIDwgMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIGluc2VydCBhbiBJbnRlcnZhbCBvYmplY3QgdG8gdGhpcyBub2RlXG4gKiovXG5Ob2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihpbnRlcnZhbCkge1xuICB0aGlzLnN0YXJ0cy5pbnNlcnQoaW50ZXJ2YWwpO1xuICB0aGlzLmVuZHMuaW5zZXJ0KGludGVydmFsKTtcbn07XG5cblxuXG4vKipcbiAqIEludGVydmFsIDogcHJvdG90eXBlIG9mIGludGVydmFsIGluZm9cbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsKGRhdGEsIGlkLCBzLCBlKSB7XG4gIHRoaXMuaWQgICAgID0gaWQ7XG4gIHRoaXMuc3RhcnQgID0gZGF0YVtzXTtcbiAgdGhpcy5lbmQgICAgPSBkYXRhW2VdO1xuICB0aGlzLmRhdGEgICA9IGRhdGE7XG5cbiAgaWYgKHR5cGVvZiB0aGlzLnN0YXJ0ICE9ICdudW1iZXInIHx8IHR5cGVvZiB0aGlzLmVuZCAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQsIGVuZCBtdXN0IGJlIG51bWJlci4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG5cbiAgaWYgKCB0aGlzLnN0YXJ0ID49IHRoaXMuZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCBtdXN0IGJlIHNtYWxsZXIgdGhhbiBlbmQuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxufVxuXG4vKipcbiAqIGdldCByZXN1bHQgb2JqZWN0XG4gKiovXG5JbnRlcnZhbC5wcm90b3R5cGUucmVzdWx0ID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0ge1xuICAgIGlkICAgOiB0aGlzLmlkLFxuICAgIGRhdGEgOiB0aGlzLmRhdGFcbiAgfTtcbiAgaWYgKHR5cGVvZiBzdGFydCA9PSAnbnVtYmVyJyAmJiB0eXBlb2YgZW5kID09ICdudW1iZXInKSB7XG4gICAgLyoqXG4gICAgICogY2FsYyBvdmVybGFwcGluZyByYXRlXG4gICAgICoqL1xuICAgIHZhciBsZWZ0ICA9IE1hdGgubWF4KHRoaXMuc3RhcnQsIHN0YXJ0KTtcbiAgICB2YXIgcmlnaHQgPSBNYXRoLm1pbih0aGlzLmVuZCwgICBlbmQpO1xuICAgIHZhciBsYXBMbiA9IHJpZ2h0IC0gbGVmdDtcbiAgICByZXQucmF0ZTEgPSBsYXBMbiAvIChlbmQgLSBzdGFydCk7XG4gICAgcmV0LnJhdGUyID0gbGFwTG4gLyAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0KTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gRHVwbGljYXRlRXJyb3IobWVzc2FnZSkge1xuICAgIHRoaXMubmFtZSA9ICdEdXBsaWNhdGVFcnJvcic7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLnN0YWNrID0gKG5ldyBFcnJvcigpKS5zdGFjaztcbn1cbkR1cGxpY2F0ZUVycm9yLnByb3RvdHlwZSA9IG5ldyBFcnJvcjtcblxuZXhwb3J0cy5JbnRlcnZhbFRyZWUgPSBJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gTGluZU1hc2s6IEEgKHZlcnkgY2hlYXApIGFsdGVybmF0aXZlIHRvIEludGVydmFsVHJlZTogYSBzbWFsbCwgMUQgcGl4ZWwgYnVmZmVyIG9mIG9iamVjdHMuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcblxuZnVuY3Rpb24gTGluZU1hc2sod2lkdGgsIGZ1ZGdlKSB7XG4gIHRoaXMuZnVkZ2UgPSBmdWRnZSA9IChmdWRnZSB8fCAxKTtcbiAgdGhpcy5pdGVtcyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IE1hdGguY2VpbCh3aWR0aCAvIGZ1ZGdlKTtcbiAgdGhpcy5tYXNrID0gZ2xvYmFsLlVpbnQ4QXJyYXkgPyBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aCkgOiBuZXcgQXJyYXkodGhpcy5sZW5ndGgpO1xufVxuXG5MaW5lTWFzay5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oeCwgdywgZGF0YSkge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIHRoaXMuaXRlbXMucHVzaCh7eDogeCwgdzogdywgZGF0YTogZGF0YX0pO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyB0aGlzLm1hc2tbaV0gPSAxOyB9XG59O1xuXG5MaW5lTWFzay5wcm90b3R5cGUuY29uZmxpY3QgPSBmdW5jdGlvbih4LCB3KSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgaWYgKHRoaXMubWFza1tpXSkgcmV0dXJuIHRydWU7IH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuZXhwb3J0cy5MaW5lTWFzayA9IExpbmVNYXNrO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTsgIFxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xudmFyIHBhcnNlSW50MTAgPSByZXF1aXJlKCcuL3V0aWxzLmpzJykucGFyc2VJbnQxMDtcblxudmFyIFBBSVJJTkdfQ0FOTk9UX01BVEUgPSAwLFxuICBQQUlSSU5HX01BVEVfT05MWSA9IDEsXG4gIFBBSVJJTkdfRFJBV19BU19NQVRFUyA9IDI7XG5cbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogV3JhcHMgdHdvIG9mIFNoaW4gU3V6dWtpJ3MgSW50ZXJ2YWxUcmVlcyB0byBzdG9yZSBpbnRlcnZhbHMgdGhhdCAqbWF5KlxuICogYmUgcGFpcmVkLlxuICpcbiAqIEBzZWUgSW50ZXJ2YWxUcmVlKClcbiAqKi9cbmZ1bmN0aW9uIFBhaXJlZEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucywgcGFpcmVkT3B0aW9ucykge1xuICB2YXIgZGVmYXVsdE9wdGlvbnMgPSB7c3RhcnRLZXk6IDAsIGVuZEtleTogMX07XG4gIFxuICB0aGlzLnVucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMudW5wYWlyZWRPcHRpb25zID0gXy5leHRlbmQoe30sIGRlZmF1bHRPcHRpb25zLCB1bnBhaXJlZE9wdGlvbnMpO1xuICBcbiAgdGhpcy5wYWlyZWQgPSBuZXcgSW50ZXJ2YWxUcmVlKGNlbnRlciwgcGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHtwYWlyaW5nS2V5OiAncW5hbWUnLCBwYWlyZWRMZW5ndGhLZXk6ICd0bGVuJ30sIGRlZmF1bHRPcHRpb25zLCBwYWlyZWRPcHRpb25zKTtcbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0S2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBpZiAodGhpcy5wYWlyZWRPcHRpb25zLmVuZEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdlbmRLZXkgZm9yIHVucGFpcmVkT3B0aW9ucyBhbmQgcGFpcmVkT3B0aW9ucyBtdXN0IGJlIGRpZmZlcmVudCBpbiBhIFBhaXJlZEludGVydmFsVHJlZScpO1xuICB9XG4gIFxuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IGZhbHNlO1xuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbnVsbDtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBEaXNhYmxlcyBwYWlyaW5nLiBFZmZlY3RpdmVseSBtYWtlcyB0aGlzIGVxdWl2YWxlbnQsIGV4dGVybmFsbHksIHRvIGFuIEludGVydmFsVHJlZS5cbiAqIFRoaXMgaXMgdXNlZnVsIGlmIHdlIGRpc2NvdmVyIHRoYXQgdGhpcyBkYXRhIHNvdXJjZSBkb2Vzbid0IGNvbnRhaW4gcGFpcmVkIHJlYWRzLlxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5kaXNhYmxlUGFpcmluZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IHRydWU7XG4gIHRoaXMucGFpcmVkID0gdGhpcy51bnBhaXJlZDtcbn07XG5cblxuLyoqXG4gKiBTZXQgYW4gaW50ZXJ2YWwgd2l0aGluIHdoaWNoIHBhaXJlZCBtYXRlcyB3aWxsIGJlIHNhdmVkIGFzIGEgY29udGludW91cyBmZWF0dXJlIGluIC5wYWlyZWRcbiAqXG4gKiBAcGFyYW0gKG51bWJlcikgbWluOiBNaW5pbXVtIGRpc3RhbmNlLCBpbiBicFxuICogQHBhcmFtIChudW1iZXIpIG1heDogTWF4aW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuc2V0UGFpcmluZ0ludGVydmFsID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgaWYgKHR5cGVvZiBtaW4gIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1pbiBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgIT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBiZSBjYWxsZWQgb25jZS4gWW91IGNhblxcJ3QgY2hhbmdlIHRoZSBwYWlyaW5nIGludGVydmFsLicpOyB9XG4gIFxuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IG1pbjtcbiAgdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgPSBtYXg7XG59O1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHZhciBtYXRlZCA9IGZhbHNlLFxuICAgIGluY3JlbWVudCA9IDAsXG4gICAgdW5wYWlyZWRTdGFydCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHVucGFpcmVkRW5kID0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZFN0YXJ0ID0gdGhpcy5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHBhaXJlZEVuZCA9IHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXksXG4gICAgcGFpcmVkTGVuZ3RoID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmVkTGVuZ3RoS2V5XSxcbiAgICBwYWlyaW5nU3RhdGUgPSBQQUlSSU5HX0NBTk5PVF9NQVRFLFxuICAgIG5ld0lkLCBwb3RlbnRpYWxNYXRlO1xuICBcbiAgLy8gLnVucGFpcmVkIGNvbnRhaW5zIGV2ZXJ5IGFsaWdubWVudCBhcyBhIHNlcGFyYXRlIGludGVydmFsLlxuICAvLyBJZiBpdCBhbHJlYWR5IGNvbnRhaW5zIHRoaXMgaWQsIHdlJ3ZlIHNlZW4gdGhpcyByZWFkIGJlZm9yZSBhbmQgc2hvdWxkIGRpc3JlZ2FyZC5cbiAgaWYgKHRoaXMudW5wYWlyZWQuY29udGFpbnMoaWQpKSB7IHJldHVybjsgfVxuICB0aGlzLnVucGFpcmVkLmFkZChkYXRhLCBpZCk7XG4gIFxuICAvLyAucGFpcmVkIGNvbnRhaW5zIGFsaWdubWVudHMgdGhhdCBtYXkgYmUgbWF0ZWQgaW50byBvbmUgaW50ZXJ2YWwgaWYgdGhleSBhcmUgd2l0aGluIHRoZSBwYWlyaW5nIHJhbmdlXG4gIGlmICghdGhpcy5wYWlyaW5nRGlzYWJsZWQgJiYgX2VsaWdpYmxlRm9yUGFpcmluZyh0aGlzLCBkYXRhKSkge1xuICAgIGlmICh0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9PT0gbnVsbCkgeyBcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYWRkIHBhaXJlZCBkYXRhIGFmdGVyIHRoZSBwYWlyaW5nIGludGVydmFsIGhhcyBiZWVuIHNldCEnKTtcbiAgICB9XG4gICAgXG4gICAgLy8gaW5zdGVhZCBvZiBzdG9yaW5nIHRoZW0gd2l0aCB0aGUgZ2l2ZW4gaWQsIHRoZSBwYWlyaW5nS2V5IChmb3IgQkFNLCBRTkFNRSkgaXMgdXNlZCBhcyB0aGUgaWQuXG4gICAgLy8gQXMgaW50ZXJ2YWxzIGFyZSBhZGRlZCwgd2UgY2hlY2sgaWYgYSByZWFkIHdpdGggdGhlIHNhbWUgcGFpcmluZ0tleSBhbHJlYWR5IGV4aXN0cyBpbiB0aGUgLnBhaXJlZCBJbnRlcnZhbFRyZWUuXG4gICAgbmV3SWQgPSBkYXRhW3RoaXMucGFpcmVkT3B0aW9ucy5wYWlyaW5nS2V5XTtcbiAgICBwb3RlbnRpYWxNYXRlID0gdGhpcy5wYWlyZWQuZ2V0KG5ld0lkKTtcbiAgICBcbiAgICBpZiAocG90ZW50aWFsTWF0ZSAhPT0gbnVsbCkge1xuICAgICAgcG90ZW50aWFsTWF0ZSA9IHBvdGVudGlhbE1hdGUuZGF0YTtcbiAgICAgIHBhaXJpbmdTdGF0ZSA9IF9wYWlyaW5nU3RhdGUodGhpcywgZGF0YSwgcG90ZW50aWFsTWF0ZSk7XG4gICAgICAvLyBBcmUgdGhlIHJlYWRzIHN1aXRhYmxlIGZvciBtYXRpbmc/XG4gICAgICBpZiAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVMgfHwgcGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX01BVEVfT05MWSkge1xuICAgICAgICAvLyBJZiB5ZXM6IG1hdGUgdGhlIHJlYWRzXG4gICAgICAgIHBvdGVudGlhbE1hdGUubWF0ZSA9IGRhdGE7XG4gICAgICAgIC8vIEhhcyB0byBiZSBieSBpZCwgdG8gYXZvaWQgY2lyY3VsYXIgcmVmZXJlbmNlcyAocHJldmVudHMgc2VyaWFsaXphdGlvbikuIFRoaXMgaXMgdGhlIGlkIHVzZWQgYnkgdGhpcy51bnBhaXJlZC5cbiAgICAgICAgZGF0YS5tYXRlID0gcG90ZW50aWFsTWF0ZS5pZDtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gQXJlIHRoZSBtYXRlZCByZWFkcyB3aXRoaW4gZHJhd2FibGUgcmFuZ2U/IElmIHNvLCBzaW1wbHkgZmxhZyB0aGF0IHRoZXkgc2hvdWxkIGJlIGRyYXduIHRvZ2V0aGVyLCBhbmQgdGhleSB3aWxsXG4gICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTKSB7XG4gICAgICBkYXRhLmRyYXdBc01hdGVzID0gcG90ZW50aWFsTWF0ZS5kcmF3QXNNYXRlcyA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE90aGVyd2lzZSwgbmVlZCB0byBpbnNlcnQgdGhpcyByZWFkIGludG8gdGhpcy5wYWlyZWQgYXMgYSBzZXBhcmF0ZSByZWFkLlxuICAgICAgLy8gRW5zdXJlIHRoZSBpZCBpcyB1bmlxdWUgZmlyc3QuXG4gICAgICB3aGlsZSAodGhpcy5wYWlyZWQuY29udGFpbnMobmV3SWQpKSB7XG4gICAgICAgIG5ld0lkID0gbmV3SWQucmVwbGFjZSgvXFx0LiovLCAnJykgKyBcIlxcdFwiICsgKCsraW5jcmVtZW50KTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgZGF0YS5tYXRlRXhwZWN0ZWQgPSBfcGFpcmluZ1N0YXRlKHRoaXMsIGRhdGEpID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVM7XG4gICAgICAvLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBwZXJoYXBzIGEgYml0IHRvbyBzcGVjaWZpYyB0byBob3cgVExFTiBmb3IgQkFNIGZpbGVzIHdvcmtzOyBjb3VsZCBnZW5lcmFsaXplIGxhdGVyXG4gICAgICAvLyBXaGVuIGluc2VydGluZyBpbnRvIC5wYWlyZWQsIHRoZSBpbnRlcnZhbCdzIC5zdGFydCBhbmQgLmVuZCBzaG91bGRuJ3QgYmUgYmFzZWQgb24gUE9TIGFuZCB0aGUgQ0lHQVIgc3RyaW5nO1xuICAgICAgLy8gd2UgbXVzdCBhZGp1c3QgdGhlbSBmb3IgVExFTiwgaWYgaXQgaXMgbm9uemVybywgZGVwZW5kaW5nIG9uIGl0cyBzaWduLCBhbmQgc2V0IG5ldyBib3VuZHMgZm9yIHRoZSBpbnRlcnZhbC5cbiAgICAgIGlmIChkYXRhLm1hdGVFeHBlY3RlZCAmJiBwYWlyZWRMZW5ndGggPiAwKSB7XG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XTtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XSArIHBhaXJlZExlbmd0aDtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5tYXRlRXhwZWN0ZWQgJiYgcGFpcmVkTGVuZ3RoIDwgMCkge1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkRW5kXTtcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkRW5kXSArIHBhaXJlZExlbmd0aDtcbiAgICAgIH0gZWxzZSB7IC8vICFkYXRhLm1hdGVFeHBlY3RlZCB8fCBwYWlyZWRMZW5ndGggPT0gMFxuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRTdGFydF07XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRFbmRdO1xuICAgICAgfVxuICAgICAgXG4gICAgICB0aGlzLnBhaXJlZC5hZGQoZGF0YSwgbmV3SWQpO1xuICAgIH1cbiAgfVxuXG59O1xuXG5cbi8qKlxuICogYWxpYXMgLmFkZCgpIHRvIC5hZGRJZk5ldygpXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IFBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXc7XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKG51bWJlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIsIHBhaXJlZCkge1xuICBpZiAocGFpcmVkICYmICF0aGlzLnBhaXJpbmdEaXNhYmxlZCkge1xuICAgIHJldHVybiB0aGlzLnBhaXJlZC5zZWFyY2godmFsMSwgdmFsMik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHRoaXMudW5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xuICB9XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiB1bmltcGxlbWVudGVkIGZvciBub3dcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2hlY2sgaWYgYW4gaXR2bCBpcyBlbGlnaWJsZSBmb3IgcGFpcmluZy4gXG4vLyBGb3Igbm93LCB0aGlzIG1lYW5zIHRoYXQgaWYgYW55IEZMQUcncyAweDEwMCBvciBoaWdoZXIgYXJlIHNldCwgd2UgdG90YWxseSBkaXNjYXJkIHRoaXMgYWxpZ25tZW50IGFuZCBpbnRlcnZhbC5cbi8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIGVudGFuZ2xlZCB3aXRoIGJhbS5qcyBpbnRlcm5hbHM7IHBlcmhhcHMgYWxsb3cgdGhpcyB0byBiZSBnZW5lcmFsaXplZCwgb3ZlcnJpZGRlbixcbi8vICAgICAgICBvciBzZXQgYWxvbmdzaWRlIC5zZXRQYWlyaW5nSW50ZXJ2YWwoKVxuLy9cbi8vIEByZXR1cm4gKGJvb2xlYW4pXG5mdW5jdGlvbiBfZWxpZ2libGVGb3JQYWlyaW5nKHBhaXJlZEl0dmxUcmVlLCBpdHZsKSB7XG4gIHZhciBmbGFncyA9IGl0dmwuZmxhZ3M7XG4gIGlmIChmbGFncy5pc1NlY29uZGFyeUFsaWdubWVudCB8fCBmbGFncy5pc1JlYWRGYWlsaW5nVmVuZG9yUUMgfHwgZmxhZ3MuaXNEdXBsaWNhdGVSZWFkIHx8IGZsYWdzLmlzU3VwcGxlbWVudGFyeUFsaWdubWVudCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gQ2hlY2sgaWYgYW4gaXR2bCBhbmQgaXRzIHBvdGVudGlhbE1hdGUgYXJlIHdpdGhpbiB0aGUgcmlnaHQgZGlzdGFuY2UsIGFuZCBvcmllbnRhdGlvbiwgdG8gYmUgbWF0ZWQuXG4vLyBJZiBwb3RlbnRpYWxNYXRlIGlzbid0IGdpdmVuLCB0YWtlcyBhIGJlc3QgZ3Vlc3MgaWYgYSBtYXRlIGlzIGV4cGVjdGVkLCBnaXZlbiB0aGUgaW5mb3JtYXRpb24gaW4gaXR2bCBhbG9uZS5cbi8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIGVudGFuZ2xlZCB3aXRoIGJhbS5qcyBpbnRlcm5hbHM7IHBlcmhhcHMgYWxsb3cgdGhpcyB0byBiZSBnZW5lcmFsaXplZCwgb3ZlcnJpZGRlbixcbi8vICAgICAgICBvciBzZXQgYWxvbmdzaWRlIC5zZXRQYWlyaW5nSW50ZXJ2YWwoKVxuLy8gXG4vLyBAcmV0dXJuIChudW1iZXIpXG5mdW5jdGlvbiBfcGFpcmluZ1N0YXRlKHBhaXJlZEl0dmxUcmVlLCBpdHZsLCBwb3RlbnRpYWxNYXRlKSB7XG4gIHZhciB0bGVuID0gaXR2bFtwYWlyZWRJdHZsVHJlZS5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgaXR2bExlbmd0aCA9IGl0dmwuZW5kIC0gaXR2bC5zdGFydCxcbiAgICBpdHZsSXNMYXRlciwgaW5mZXJyZWRJbnNlcnRTaXplO1xuXG4gIGlmIChfLmlzVW5kZWZpbmVkKHBvdGVudGlhbE1hdGUpKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBtb3N0IHJlY2VwdGl2ZSBoeXBvdGhldGljYWwgbWF0ZSwgZ2l2ZW4gdGhlIGluZm9ybWF0aW9uIGluIGl0dmwuXG4gICAgcG90ZW50aWFsTWF0ZSA9IHtcbiAgICAgIF9tb2NrZWQ6IHRydWUsXG4gICAgICBmbGFnczoge1xuICAgICAgICBpc1JlYWRQYWlyZWQ6IHRydWUsXG4gICAgICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogdHJ1ZSxcbiAgICAgICAgaXNSZWFkRmlyc3RPZlBhaXI6IGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcixcbiAgICAgICAgaXNSZWFkTGFzdE9mUGFpcjogaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpclxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBGaXJzdCBjaGVjayBhIHdob2xlIGhvc3Qgb2YgRkxBRydzLiBUbyBtYWtlIGEgbG9uZyBzdG9yeSBzaG9ydCwgd2UgZXhwZWN0IHBhaXJlZCBlbmRzIHRvIGJlIGVpdGhlclxuICAvLyA5OS0xNDcgb3IgMTYzLTgzLCBkZXBlbmRpbmcgb24gd2hldGhlciB0aGUgcmlnaHRtb3N0IG9yIGxlZnRtb3N0IHNlZ21lbnQgaXMgcHJpbWFyeS5cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFBhaXJlZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQYWlyZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFByb3Blcmx5QWxpZ25lZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQcm9wZXJseUFsaWduZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkVW5tYXBwZWQgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRVbm1hcHBlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc01hdGVVbm1hcHBlZCB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLmlzTWF0ZVVubWFwcGVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyICYmICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpciAmJiAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRGaXJzdE9mUGFpcikgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIFxuICBpZiAocG90ZW50aWFsTWF0ZS5fbW9ja2VkKSB7XG4gICAgXy5leHRlbmQocG90ZW50aWFsTWF0ZSwge1xuICAgICAgcm5hbWU6IGl0dmwucm5leHQgPT0gJz0nID8gaXR2bC5ybmFtZSA6IGl0dmwucm5leHQsXG4gICAgICBwb3M6IGl0dmwucG5leHQsXG4gICAgICBzdGFydDogaXR2bC5ybmV4dCA9PSAnPScgPyBwYXJzZUludDEwKGl0dmwucG5leHQpICsgKGl0dmwuc3RhcnQgLSBwYXJzZUludDEwKGl0dmwucG9zKSkgOiAwLFxuICAgICAgZW5kOiB0bGVuID4gMCA/IGl0dmwuc3RhcnQgKyB0bGVuIDogKHRsZW4gPCAwID8gaXR2bC5lbmQgKyB0bGVuICsgaXR2bExlbmd0aCA6IDApLFxuICAgICAgcm5leHQ6IGl0dmwucm5leHQgPT0gJz0nID8gJz0nIDogaXR2bC5ybmFtZSxcbiAgICAgIHBuZXh0OiBpdHZsLnBvc1xuICAgIH0pO1xuICB9XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBhbGlnbm1lbnRzIGFyZSBvbiB0aGUgc2FtZSByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgaWYgKGl0dmwucm5leHQgIT0gJz0nIHx8IHBvdGVudGlhbE1hdGUucm5leHQgIT0gJz0nKSB7IFxuICAgIC8vIGFuZCBpZiBub3QsIGRvIHRoZSBjb29yZGluYXRlcyBtYXRjaCBhdCBhbGw/XG4gICAgaWYgKGl0dmwucm5leHQgIT0gcG90ZW50aWFsTWF0ZS5ybmFtZSB8fCBpdHZsLnJuZXh0ICE9IHBvdGVudGlhbE1hdGUucm5hbWUpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICBpZiAoaXR2bC5wbmV4dCAhPSBwb3RlbnRpYWxNYXRlLnBvcyB8fCBpdHZsLnBvcyAhPSBwb3RlbnRpYWxNYXRlLnBuZXh0KSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZO1xuICB9XG4gIFxuICBpZiAocG90ZW50aWFsTWF0ZS5fbW9ja2VkKSB7XG4gICAgXy5leHRlbmQocG90ZW50aWFsTWF0ZS5mbGFncywge1xuICAgICAgcmVhZFN0cmFuZFJldmVyc2U6IGl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UsXG4gICAgICBtYXRlU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZVxuICAgIH0pO1xuICB9IFxuICBcbiAgaXR2bElzTGF0ZXIgPSBpdHZsLnN0YXJ0ID4gcG90ZW50aWFsTWF0ZS5zdGFydDtcbiAgaW5mZXJyZWRJbnNlcnRTaXplID0gaXR2bElzTGF0ZXIgPyBpdHZsLnN0YXJ0IC0gcG90ZW50aWFsTWF0ZS5lbmQgOiBwb3RlbnRpYWxNYXRlLnN0YXJ0IC0gaXR2bC5lbmQ7XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBhbGlnbm1lbnRzIGFyZSAtLT4gPC0tXG4gIGlmIChpdHZsSXNMYXRlcikge1xuICAgIGlmICghaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCBpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICAgIGlmIChwb3RlbnRpYWxNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICB9IGVsc2Uge1xuICAgIGlmIChpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8ICFpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICAgIGlmICghcG90ZW50aWFsTWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICB9XG4gIFxuICAvLyBDaGVjayB0aGF0IHRoZSBpbmZlcnJlZEluc2VydFNpemUgaXMgd2l0aGluIHRoZSBhY2NlcHRhYmxlIHJhbmdlLlxuICBpZiAoaW5mZXJyZWRJbnNlcnRTaXplID4gdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgfHwgaW5mZXJyZWRJbnNlcnRTaXplIDwgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIFxuICByZXR1cm4gUEFJUklOR19EUkFXX0FTX01BVEVTO1xufVxuXG5leHBvcnRzLlBhaXJlZEludGVydmFsVHJlZSA9IFBhaXJlZEludGVydmFsVHJlZTtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcblxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG4vKipcbiAgKiBSZW1vdGVUcmFja1xuICAqXG4gICogQSBoZWxwZXIgY2xhc3MgYnVpbHQgZm9yIGNhY2hpbmcgZGF0YSBmZXRjaGVkIGZyb20gYSByZW1vdGUgdHJhY2sgKGRhdGEgYWxpZ25lZCB0byBhIGdlbm9tZSkuXG4gICogVGhlIGdlbm9tZSBpcyBkaXZpZGVkIGludG8gYmlucyBvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgbnRzLCBmb3IgZWFjaCBvZiB3aGljaCBkYXRhIHdpbGwgb25seSBiZSBmZXRjaGVkIG9uY2UuXG4gICogVG8gc2V0dXAgdGhlIGJpbnMsIGNhbGwgLnNldHVwQmlucyguLi4pIGFmdGVyIGluaXRpYWxpemluZyB0aGUgY2xhc3MuXG4gICpcbiAgKiBUaGVyZSBpcyBvbmUgbWFpbiBwdWJsaWMgbWV0aG9kIGZvciB0aGlzIGNsYXNzOiAuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBjYWxsYmFjaylcbiAgKiAoRm9yIGNvbnNpc3RlbmN5IHdpdGggQ3VzdG9tVHJhY2tzLmpzLCBhbGwgYHN0YXJ0YCBhbmQgYGVuZGAgcG9zaXRpb25zIGFyZSAxLWJhc2VkLCBvcmllbnRlZCB0b1xuICAqIHRoZSBzdGFydCBvZiB0aGUgZ2Vub21lLCBhbmQgaW50ZXJ2YWxzIGFyZSByaWdodC1vcGVuLilcbiAgKlxuICAqIFRoaXMgbWV0aG9kIHdpbGwgcmVxdWVzdCBhbmQgY2FjaGUgZGF0YSBmb3IgdGhlIGdpdmVuIGludGVydmFsIHRoYXQgaXMgbm90IGFscmVhZHkgY2FjaGVkLCBhbmQgY2FsbCBcbiAgKiBjYWxsYmFjayhpbnRlcnZhbHMpIGFzIHNvb24gYXMgZGF0YSBmb3IgYWxsIGludGVydmFscyBpcyBhdmFpbGFibGUuIChJZiB0aGUgZGF0YSBpcyBhbHJlYWR5IGF2YWlsYWJsZSwgXG4gICogaXQgd2lsbCBjYWxsIHRoZSBjYWxsYmFjayBpbW1lZGlhdGVseS4pXG4gICoqL1xuXG52YXIgQklOX0xPQURJTkcgPSAxLFxuICBCSU5fTE9BREVEID0gMjtcblxuLyoqXG4gICogUmVtb3RlVHJhY2sgY29uc3RydWN0b3IuXG4gICpcbiAgKiBOb3RlIHlvdSBzdGlsbCBtdXN0IGNhbGwgYC5zZXR1cEJpbnMoLi4uKWAgYmVmb3JlIHRoZSBSZW1vdGVUcmFjayBpcyByZWFkeSB0byBmZXRjaCBkYXRhLlxuICAqXG4gICogQHBhcmFtIChJbnRlcnZhbFRyZWUpIGNhY2hlOiBBbiBjYWNoZSBzdG9yZSB0aGF0IHdpbGwgcmVjZWl2ZSBpbnRlcnZhbHMgZmV0Y2hlZCBmb3IgZWFjaCBiaW4uXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBTaG91bGQgYmUgYW4gSW50ZXJ2YWxUcmVlIG9yIGVxdWl2YWxlbnQsIHRoYXQgaW1wbGVtZW50cyBgLmFkZElmTmV3KC4uLilgIGFuZCBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAuc2VhcmNoKHN0YXJ0LCBlbmQpYCBtZXRob2RzLiBJZiBpdCBpcyBhbiAqZXh0ZW5zaW9uKiBvZiBhbiBJbnRlcnZhbFRyZWUsIG5vdGUgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgYGV4dHJhQXJnc2AgcGFyYW0gcGVybWl0dGVkIGZvciBgLmZldGNoQXN5bmMoKWAsIHdoaWNoIGFyZSBwYXNzZWQgYWxvbmcgYXMgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHRyYSBhcmd1bWVudHMgdG8gYC5zZWFyY2goKWAuXG4gICogQHBhcmFtIChmdW5jdGlvbikgZmV0Y2hlcjogQSBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgY2FsbGVkIHRvIGZldGNoIGRhdGEgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgZnVuY3Rpb24gc2hvdWxkIHRha2UgdGhyZWUgYXJndW1lbnRzLCBgc3RhcnRgLCBgZW5kYCwgYW5kIGBzdG9yZUludGVydmFsc2AuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlcyBmb3JtaW5nIGEgcmlnaHQtb3BlbiBpbnRlcnZhbC5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgc3RvcmVJbnRlcnZhbHNgIGlzIGEgY2FsbGJhY2sgdGhhdCBgZmV0Y2hlcmAgTVVTVCBjYWxsIG9uIHRoZSBhcnJheSBvZiBpbnRlcnZhbHNcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbmNlIHRoZXkgaGF2ZSBiZWVuIGZldGNoZWQgZnJvbSB0aGUgcmVtb3RlIGRhdGEgc291cmNlIGFuZCBwYXJzZWQuXG4gICogQHNlZSBfZmV0Y2hCaW4gZm9yIGhvdyBgZmV0Y2hlcmAgaXMgdXRpbGl6ZWQuXG4gICoqL1xuZnVuY3Rpb24gUmVtb3RlVHJhY2soY2FjaGUsIGZldGNoZXIpIHtcbiAgaWYgKHR5cGVvZiBjYWNoZSAhPSAnb2JqZWN0JyB8fCAoIWNhY2hlLmFkZElmTmV3ICYmICghXy5rZXlzKGNhY2hlKS5sZW5ndGggfHwgY2FjaGVbXy5rZXlzKGNhY2hlKVswXV0uYWRkSWZOZXcpKSkgeyBcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYW4gSW50ZXJ2YWxUcmVlIGNhY2hlLCBvciBhbiBvYmplY3QvYXJyYXkgY29udGFpbmluZyBJbnRlcnZhbFRyZWVzLCBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyBcbiAgfVxuICBpZiAodHlwZW9mIGZldGNoZXIgIT0gJ2Z1bmN0aW9uJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYSBmZXRjaGVyIGZ1bmN0aW9uIGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHRoaXMuY2FjaGUgPSBjYWNoZTtcbiAgdGhpcy5mZXRjaGVyID0gZmV0Y2hlcjtcbiAgXG4gIHRoaXMuY2FsbGJhY2tzID0gW107XG4gIHRoaXMuYWZ0ZXJCaW5TZXR1cCA9IFtdO1xuICB0aGlzLmJpbnNMb2FkZWQgPSBudWxsO1xufVxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cbi8vIFNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhpcyBSZW1vdGVUcmFjay4gVGhpcyBjYW4gb2NjdXIgYW55dGltZSBhZnRlciBpbml0aWFsaXphdGlvbiwgYW5kIGluIGZhY3QsXG4vLyBjYW4gb2NjdXIgYWZ0ZXIgY2FsbHMgdG8gYC5mZXRjaEFzeW5jKClgIGhhdmUgYmVlbiBtYWRlLCBpbiB3aGljaCBjYXNlIHRoZXkgd2lsbCBiZSB3YWl0aW5nIG9uIHRoaXMgbWV0aG9kXG4vLyB0byBiZSBjYWxsZWQgdG8gcHJvY2VlZC4gQnV0IGl0IE1VU1QgYmUgY2FsbGVkIGJlZm9yZSBkYXRhIHdpbGwgYmUgcmVjZWl2ZWQgYnkgY2FsbGJhY2tzIHBhc3NlZCB0byBcbi8vIGAuZmV0Y2hBc3luYygpYC5cblJlbW90ZVRyYWNrLnByb3RvdHlwZS5zZXR1cEJpbnMgPSBmdW5jdGlvbihnZW5vbWVTaXplLCBvcHRpbWFsRmV0Y2hXaW5kb3csIG1heEZldGNoV2luZG93KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHNlbGYuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgcnVuIHNldHVwQmlucyBtb3JlIHRoYW4gb25jZS4nKTsgfVxuICBpZiAodHlwZW9mIGdlbm9tZVNpemUgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IHRoZSBnZW5vbWVTaXplIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG9wdGltYWxGZXRjaFdpbmRvdyBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4RmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1heEZldGNoV2luZG93IGFzIHRoZSAzcmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHNlbGYuZ2Vub21lU2l6ZSA9IGdlbm9tZVNpemU7XG4gIHNlbGYub3B0aW1hbEZldGNoV2luZG93ID0gb3B0aW1hbEZldGNoV2luZG93O1xuICBzZWxmLm1heEZldGNoV2luZG93ID0gbWF4RmV0Y2hXaW5kb3c7XG4gIFxuICBzZWxmLm51bUJpbnMgPSBNYXRoLmNlaWwoZ2Vub21lU2l6ZSAvIG9wdGltYWxGZXRjaFdpbmRvdyk7XG4gIHNlbGYuYmluc0xvYWRlZCA9IHt9O1xuICBcbiAgLy8gRmlyZSBvZmYgcmFuZ2VzIHNhdmVkIHRvIGFmdGVyQmluU2V0dXBcbiAgXy5lYWNoKHRoaXMuYWZ0ZXJCaW5TZXR1cCwgZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICBzZWxmLmZldGNoQXN5bmMocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCwgcmFuZ2UuZXh0cmFBcmdzKTtcbiAgfSk7XG4gIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhzZWxmKTtcbn1cblxuXG4vLyBGZXRjaGVzIGRhdGEgKGlmIG5lY2Vzc2FyeSkgZm9yIHVuZmV0Y2hlZCBiaW5zIG92ZXJsYXBwaW5nIHdpdGggdGhlIGludGVydmFsIGZyb20gYHN0YXJ0YCB0byBgZW5kYC5cbi8vIFRoZW4sIHJ1biBgY2FsbGJhY2tgIG9uIGFsbCBzdG9yZWQgc3ViaW50ZXJ2YWxzIHRoYXQgb3ZlcmxhcCB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBgZXh0cmFBcmdzYCBpcyBhbiAqb3B0aW9uYWwqIHBhcmFtZXRlciB0aGF0IGNhbiBjb250YWluIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIGAuc2VhcmNoKClgIGZ1bmN0aW9uIG9mIHRoZSBjYWNoZS5cbi8vXG4vLyBAcGFyYW0gKG51bWJlcikgc3RhcnQ6ICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIHRvIHN0YXJ0IGZldGNoaW5nIGZyb21cbi8vIEBwYXJhbSAobnVtYmVyKSBlbmQ6ICAgICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgKHJpZ2h0LW9wZW4pIHRvIHN0YXJ0IGZldGNoaW5nICp1bnRpbCpcbi8vIEBwYXJhbSAoQXJyYXkpIFtleHRyYUFyZ3NdOiAgb3B0aW9uYWwsIHBhc3NlZCBhbG9uZyB0byB0aGUgYC5zZWFyY2goKWAgY2FsbHMgb24gdGhlIC5jYWNoZSBhcyBhcmd1bWVudHMgMyBhbmQgdXA7IFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJoYXBzIHVzZWZ1bCBpZiB0aGUgLmNhY2hlIGhhcyBvdmVycmlkZGVuIHRoaXMgbWV0aG9kXG4vLyBAcGFyYW0gKGZ1bmN0aW9uKSBjYWxsYmFjazogIEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCBvbmNlIGRhdGEgaXMgcmVhZHkgZm9yIHRoaXMgaW50ZXJ2YWwuIFdpbGwgYmUgcGFzc2VkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbCBpbnRlcnZhbCBmZWF0dXJlcyB0aGF0IGhhdmUgYmVlbiBmZXRjaGVkIGZvciB0aGlzIGludGVydmFsLCBvciB7dG9vTWFueTogdHJ1ZX1cbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgbW9yZSBkYXRhIHdhcyByZXF1ZXN0ZWQgdGhhbiBjb3VsZCBiZSByZWFzb25hYmx5IGZldGNoZWQuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuZmV0Y2hBc3luYyA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGV4dHJhQXJncywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc0Z1bmN0aW9uKGV4dHJhQXJncykgJiYgXy5pc1VuZGVmaW5lZChjYWxsYmFjaykpIHsgY2FsbGJhY2sgPSBleHRyYUFyZ3M7IGV4dHJhQXJncyA9IHVuZGVmaW5lZDsgfVxuICBpZiAoIXNlbGYuYmluc0xvYWRlZCkge1xuICAgIC8vIElmIGJpbnMgKmFyZW4ndCogc2V0dXAgeWV0OlxuICAgIC8vIFNhdmUgdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyBTYXZlIHRoaXMgZmV0Y2ggZm9yIHdoZW4gdGhlIGJpbnMgYXJlIGxvYWRlZFxuICAgIHNlbGYuYWZ0ZXJCaW5TZXR1cC5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJnc30pO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGJpbnMgKmFyZSogc2V0dXAsIGZpcnN0IGNhbGN1bGF0ZSB3aGljaCBiaW5zIGNvcnJlc3BvbmQgdG8gdGhpcyBpbnRlcnZhbCwgXG4gICAgLy8gYW5kIHdoYXQgc3RhdGUgdGhvc2UgYmlucyBhcmUgaW5cbiAgICB2YXIgYmlucyA9IF9iaW5PdmVybGFwKHNlbGYsIHN0YXJ0LCBlbmQpLFxuICAgICAgbG9hZGVkQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHNlbGYuYmluc0xvYWRlZFtpXSA9PT0gQklOX0xPQURFRDsgfSksXG4gICAgICBiaW5zVG9GZXRjaCA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuICFzZWxmLmJpbnNMb2FkZWRbaV07IH0pO1xuICAgIFxuICAgIGlmIChsb2FkZWRCaW5zLmxlbmd0aCA9PSBiaW5zLmxlbmd0aCkge1xuICAgICAgLy8gSWYgd2UndmUgYWxyZWFkeSBsb2FkZWQgZGF0YSBmb3IgYWxsIHRoZSBiaW5zIGluIHF1ZXN0aW9uLCBzaG9ydC1jaXJjdWl0IGFuZCBydW4gdGhlIGNhbGxiYWNrIG5vd1xuICAgICAgZXh0cmFBcmdzID0gXy5pc1VuZGVmaW5lZChleHRyYUFyZ3MpID8gW10gOiBleHRyYUFyZ3M7XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayhzZWxmLmNhY2hlLnNlYXJjaC5hcHBseShzZWxmLmNhY2hlLCBbc3RhcnQsIGVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICB9IGVsc2UgaWYgKGVuZCAtIHN0YXJ0ID4gc2VsZi5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgLy8gZWxzZSwgaWYgdGhpcyBpbnRlcnZhbCBpcyB0b28gYmlnICg+IG1heEZldGNoV2luZG93KSwgZmlyZSB0aGUgY2FsbGJhY2sgcmlnaHQgYXdheSB3aXRoIHt0b29NYW55OiB0cnVlfVxuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gZWxzZSwgcHVzaCB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIHRoZW4gcnVuIGZldGNoZXMgZm9yIHRoZSB1bmZldGNoZWQgYmlucywgd2hpY2ggc2hvdWxkIGNhbGwgX2ZpcmVDYWxsYmFja3MgYWZ0ZXIgdGhleSBjb21wbGV0ZSxcbiAgICAvLyB3aGljaCB3aWxsIGF1dG9tYXRpY2FsbHkgZmlyZSBjYWxsYmFja3MgZnJvbSB0aGUgYWJvdmUgcXVldWUgYXMgdGhleSBhY3F1aXJlIGFsbCBuZWVkZWQgZGF0YS5cbiAgICBfLmVhY2goYmluc1RvRmV0Y2gsIGZ1bmN0aW9uKGJpbkluZGV4KSB7XG4gICAgICBfZmV0Y2hCaW4oc2VsZiwgYmluSW5kZXgsIGZ1bmN0aW9uKCkgeyBfZmlyZUNhbGxiYWNrcyhzZWxmKTsgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDYWxjdWxhdGVzIHdoaWNoIGJpbnMgb3ZlcmxhcCB3aXRoIGFuIGludGVydmFsIGdpdmVuIGJ5IGBzdGFydGAgYW5kIGBlbmRgLlxuLy8gYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG5mdW5jdGlvbiBfYmluT3ZlcmxhcChyZW1vdGVUcmssIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFyZW1vdGVUcmsuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgY2FsY3VsYXRlIGJpbiBvdmVybGFwIGJlZm9yZSBzZXR1cEJpbnMgaXMgY2FsbGVkLicpOyB9XG4gIC8vIEludGVybmFsbHksIGZvciBhc3NpZ25pbmcgY29vcmRpbmF0ZXMgdG8gYmlucywgd2UgdXNlIDAtYmFzZWQgY29vcmRpbmF0ZXMgZm9yIGVhc2llciBjYWxjdWxhdGlvbnMuXG4gIHZhciBzdGFydEJpbiA9IE1hdGguZmxvb3IoKHN0YXJ0IC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KSxcbiAgICBlbmRCaW4gPSBNYXRoLmZsb29yKChlbmQgLSAxKSAvIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICByZXR1cm4gXy5yYW5nZShzdGFydEJpbiwgZW5kQmluICsgMSk7XG59XG5cbi8vIFJ1bnMgdGhlIGZldGNoZXIgZnVuY3Rpb24gb24gYSBnaXZlbiBiaW4uXG4vLyBUaGUgZmV0Y2hlciBmdW5jdGlvbiBpcyBvYmxpZ2F0ZWQgdG8gcnVuIGEgY2FsbGJhY2sgZnVuY3Rpb24gYHN0b3JlSW50ZXJ2YWxzYCwgXG4vLyAgICBwYXNzZWQgYXMgaXRzIHRoaXJkIGFyZ3VtZW50LCBvbiBhIHNldCBvZiBpbnRlcnZhbHMgdGhhdCB3aWxsIGJlIGluc2VydGVkIGludG8gdGhlIFxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIEludGVydmFsVHJlZS5cbi8vIFRoZSBgc3RvcmVJbnRlcnZhbHNgIGZ1bmN0aW9uIG1heSBhY2NlcHQgYSBzZWNvbmQgYXJndW1lbnQgY2FsbGVkIGBjYWNoZUluZGV4YCwgaW4gY2FzZVxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIGlzIGFjdHVhbGx5IGEgY29udGFpbmVyIGZvciBtdWx0aXBsZSBJbnRlcnZhbFRyZWVzLCBpbmRpY2F0aW5nIHdoaWNoIFxuLy8gICAgb25lIHRvIHN0b3JlIGl0IGluLlxuLy8gV2UgdGhlbiBjYWxsIHRoZSBgY2FsbGJhY2tgIGdpdmVuIGhlcmUgYWZ0ZXIgdGhhdCBpcyBjb21wbGV0ZS5cbmZ1bmN0aW9uIF9mZXRjaEJpbihyZW1vdGVUcmssIGJpbkluZGV4LCBjYWxsYmFjaykge1xuICB2YXIgc3RhcnQgPSBiaW5JbmRleCAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxLFxuICAgIGVuZCA9IChiaW5JbmRleCArIDEpICogcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyArIDE7XG4gIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FESU5HO1xuICByZW1vdGVUcmsuZmV0Y2hlcihzdGFydCwgZW5kLCBmdW5jdGlvbiBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpIHtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgaWYgKCFpbnRlcnZhbCkgeyByZXR1cm47IH1cbiAgICAgIHJlbW90ZVRyay5jYWNoZS5hZGRJZk5ldyhpbnRlcnZhbCwgaW50ZXJ2YWwuaWQpO1xuICAgIH0pO1xuICAgIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FERUQ7XG4gICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3Mgd2hlcmUgYWxsIHRoZSByZXF1aXJlZCBkYXRhIGlzIHJlYWR5XG4vLyBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfZmlyZUNhbGxiYWNrcyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjayxcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoYWZ0ZXJMb2FkLmV4dHJhQXJncykgPyBbXSA6IGFmdGVyTG9hZC5leHRyYUFyZ3MsXG4gICAgICBiaW5zLCBzdGlsbExvYWRpbmdCaW5zO1xuICAgICAgICBcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgXG4gICAgYmlucyA9IF9iaW5PdmVybGFwKHJlbW90ZVRyaywgYWZ0ZXJMb2FkLnN0YXJ0LCBhZnRlckxvYWQuZW5kKTtcbiAgICBzdGlsbExvYWRpbmdCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gcmVtb3RlVHJrLmJpbnNMb2FkZWRbaV0gIT09IEJJTl9MT0FERUQ7IH0pLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFzdGlsbExvYWRpbmdCaW5zKSB7XG4gICAgICBjYWxsYmFjayhyZW1vdGVUcmsuY2FjaGUuc2VhcmNoLmFwcGx5KHJlbW90ZVRyay5jYWNoZSwgW2FmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG4vLyBSdW5zIHRocm91Z2ggYWxsIHNhdmVkIGNhbGxiYWNrcyBhbmQgZmlyZXMgYW55IGNhbGxiYWNrcyBmb3Igd2hpY2ggd2Ugd29uJ3QgbG9hZCBkYXRhIHNpbmNlIHRoZSBhbW91bnRcbi8vIHJlcXVlc3RlZCBpcyB0b28gbGFyZ2UuIENhbGxiYWNrcyB0aGF0IGFyZSBmaXJlZCBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBxdWV1ZS5cbmZ1bmN0aW9uIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjaztcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5cbmV4cG9ydHMuUmVtb3RlVHJhY2sgPSBSZW1vdGVUcmFjaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9Tb3J0ZWRMaXN0XG4gKlxuICogU29ydGVkTGlzdCA6IGNvbnN0cnVjdG9yXG4gKiBcbiAqIEBwYXJhbSBhcnIgOiBBcnJheSBvciBudWxsIDogYW4gYXJyYXkgdG8gc2V0XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgOiBvYmplY3QgIG9yIG51bGxcbiAqICAgICAgICAgKGZ1bmN0aW9uKSBmaWx0ZXIgIDogZmlsdGVyIGZ1bmN0aW9uIGNhbGxlZCBiZWZvcmUgaW5zZXJ0aW5nIGRhdGEuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgcmVjZWl2ZXMgYSB2YWx1ZSBhbmQgcmV0dXJucyB0cnVlIGlmIHRoZSB2YWx1ZSBpcyB2YWxpZC5cbiAqXG4gKiAgICAgICAgIChmdW5jdGlvbikgY29tcGFyZSA6IGZ1bmN0aW9uIHRvIGNvbXBhcmUgdHdvIHZhbHVlcywgXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdoaWNoIGlzIHVzZWQgZm9yIHNvcnRpbmcgb3JkZXIuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBzYW1lIHNpZ25hdHVyZSBhcyBBcnJheS5wcm90b3R5cGUuc29ydChmbikuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICogICAgICAgICAoc3RyaW5nKSAgIGNvbXBhcmUgOiBpZiB5b3UnZCBsaWtlIHRvIHNldCBhIGNvbW1vbiBjb21wYXJpc29uIGZ1bmN0aW9uLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5b3UgY2FuIHNwZWNpZnkgaXQgYnkgc3RyaW5nOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIm51bWJlclwiIDogY29tcGFyZXMgbnVtYmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwic3RyaW5nXCIgOiBjb21wYXJlcyBzdHJpbmdcbiAqL1xuZnVuY3Rpb24gU29ydGVkTGlzdCgpIHtcbiAgdmFyIGFyciAgICAgPSBudWxsLFxuICAgICAgb3B0aW9ucyA9IHt9LFxuICAgICAgYXJncyAgICA9IGFyZ3VtZW50cztcblxuICBbXCIwXCIsXCIxXCJdLmZvckVhY2goZnVuY3Rpb24obikge1xuICAgIHZhciB2YWwgPSBhcmdzW25dO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgIGFyciA9IHZhbDtcbiAgICB9XG4gICAgZWxzZSBpZiAodmFsICYmIHR5cGVvZiB2YWwgPT0gXCJvYmplY3RcIikge1xuICAgICAgb3B0aW9ucyA9IHZhbDtcbiAgICB9XG4gIH0pO1xuICB0aGlzLmFyciA9IFtdO1xuXG4gIFtcImZpbHRlclwiLCBcImNvbXBhcmVcIl0uZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zW2tdID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpc1trXSA9IG9wdGlvbnNba107XG4gICAgfVxuICAgIGVsc2UgaWYgKG9wdGlvbnNba10gJiYgU29ydGVkTGlzdFtrXVtvcHRpb25zW2tdXSkge1xuICAgICAgdGhpc1trXSA9IFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV07XG4gICAgfVxuICB9LCB0aGlzKTtcbiAgaWYgKGFycikgdGhpcy5tYXNzSW5zZXJ0KGFycik7XG59O1xuXG4vLyBCaW5hcnkgc2VhcmNoIGZvciB0aGUgaW5kZXggb2YgdGhlIGl0ZW0gZXF1YWwgdG8gYHZhbGAsIG9yIGlmIG5vIHN1Y2ggaXRlbSBleGlzdHMsIHRoZSBuZXh0IGxvd2VyIGl0ZW1cbi8vIFRoaXMgY2FuIGJlIC0xIGlmIGB2YWxgIGlzIGxvd2VyIHRoYW4gdGhlIGxvd2VzdCBpdGVtIGluIHRoZSBTb3J0ZWRMaXN0XG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5ic2VhcmNoID0gZnVuY3Rpb24odmFsKSB7XG4gIHZhciBtcG9zLFxuICAgICAgc3BvcyA9IDAsXG4gICAgICBlcG9zID0gdGhpcy5hcnIubGVuZ3RoO1xuICB3aGlsZSAoZXBvcyAtIHNwb3MgPiAxKSB7XG4gICAgbXBvcyA9IE1hdGguZmxvb3IoKHNwb3MgKyBlcG9zKS8yKTtcbiAgICBtdmFsID0gdGhpcy5hcnJbbXBvc107XG4gICAgc3dpdGNoICh0aGlzLmNvbXBhcmUodmFsLCBtdmFsKSkge1xuICAgIGNhc2UgMSAgOlxuICAgIGRlZmF1bHQgOlxuICAgICAgc3BvcyA9IG1wb3M7XG4gICAgICBicmVhaztcbiAgICBjYXNlIC0xIDpcbiAgICAgIGVwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAwICA6XG4gICAgICByZXR1cm4gbXBvcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh0aGlzLmFyclswXSA9PSBudWxsIHx8IHNwb3MgPT0gMCAmJiB0aGlzLmFyclswXSAhPSBudWxsICYmIHRoaXMuY29tcGFyZSh0aGlzLmFyclswXSwgdmFsKSA9PSAxKSA/IC0xIDogc3Bvcztcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gdGhpcy5hcnJbcG9zXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlKCk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnIuc2xpY2UuYXBwbHkodGhpcy5hcnIsIGFyZ3VtZW50cyk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLmxlbmd0aDtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmhlYWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyWzBdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gKHRoaXMuYXJyLmxlbmd0aCA9PSAwKSA/IG51bGwgOiB0aGlzLmFyclt0aGlzLmFyci5sZW5ndGggLTFdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc0luc2VydCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIC8vIFRoaXMgbG9vcCBhdm9pZHMgY2FsbCBzdGFjayBvdmVyZmxvdyBiZWNhdXNlIG9mIHRvbyBtYW55IGFyZ3VtZW50c1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSA0MDk2KSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkodGhpcy5hcnIsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGl0ZW1zLCBpLCBpICsgNDA5NikpO1xuICB9XG4gIHRoaXMuYXJyLnNvcnQodGhpcy5jb21wYXJlKTtcbn1cblxuU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oKSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMTAwKSB7XG4gICAgLy8gLmJzZWFyY2ggKyAuc3BsaWNlIGlzIHRvbyBleHBlbnNpdmUgdG8gcmVwZWF0IGZvciBzbyBtYW55IGVsZW1lbnRzLlxuICAgIC8vIExldCdzIGp1c3QgYXBwZW5kIHRoZW0gYWxsIHRvIHRoaXMuYXJyIGFuZCByZXNvcnQuXG4gICAgdGhpcy5tYXNzSW5zZXJ0KGFyZ3VtZW50cyk7XG4gIH0gZWxzZSB7XG4gICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uKHZhbCkge1xuICAgICAgdmFyIHBvcyA9IHRoaXMuYnNlYXJjaCh2YWwpO1xuICAgICAgaWYgKHRoaXMuZmlsdGVyKHZhbCwgcG9zKSkge1xuICAgICAgICB0aGlzLmFyci5zcGxpY2UocG9zKzEsIDAsIHZhbCk7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmZpbHRlciA9IGZ1bmN0aW9uKHZhbCwgcG9zKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuYWRkID0gU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXSA9IGZ1bmN0aW9uKHBvcykge1xuICB0aGlzLmFyci5zcGxpY2UocG9zLCAxKTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IFNvcnRlZExpc3QucHJvdG90eXBlW1wiZGVsZXRlXCJdO1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5tYXNzUmVtb3ZlID0gZnVuY3Rpb24oc3RhcnRQb3MsIGNvdW50KSB7XG4gIHRoaXMuYXJyLnNwbGljZShzdGFydFBvcywgY291bnQpO1xufTtcblxuLyoqXG4gKiBkZWZhdWx0IGNvbXBhcmUgZnVuY3Rpb25zIFxuICoqL1xuU29ydGVkTGlzdC5jb21wYXJlID0ge1xuICBcIm51bWJlclwiOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIGMgPSBhIC0gYjtcbiAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gIH0sXG5cbiAgXCJzdHJpbmdcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiAoYSA+IGIpID8gMSA6IChhID09IGIpICA/IDAgOiAtMTtcbiAgfVxufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuY29tcGFyZSA9IFNvcnRlZExpc3QuY29tcGFyZVtcIm51bWJlclwiXTtcblxuZXhwb3J0cy5Tb3J0ZWRMaXN0ID0gU29ydGVkTGlzdDtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsInZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLy8gUGFyc2UgYSB0cmFjayBkZWNsYXJhdGlvbiBsaW5lLCB3aGljaCBpcyBpbiB0aGUgZm9ybWF0IG9mOlxuLy8gdHJhY2sgbmFtZT1cImJsYWhcIiBvcHRuYW1lMT1cInZhbHVlMVwiIG9wdG5hbWUyPVwidmFsdWUyXCIgLi4uXG4vLyBpbnRvIGEgaGFzaCBvZiBvcHRpb25zXG5tb2R1bGUuZXhwb3J0cy5wYXJzZURlY2xhcmF0aW9uTGluZSA9IGZ1bmN0aW9uKGxpbmUsIHN0YXJ0KSB7XG4gIHZhciBvcHRzID0ge30sIG9wdG5hbWUgPSAnJywgdmFsdWUgPSAnJywgc3RhdGUgPSAnb3B0bmFtZSc7XG4gIGZ1bmN0aW9uIHB1c2hWYWx1ZShxdW90aW5nKSB7XG4gICAgc3RhdGUgPSAnb3B0bmFtZSc7XG4gICAgb3B0c1tvcHRuYW1lLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKV0gPSB2YWx1ZTtcbiAgICBvcHRuYW1lID0gdmFsdWUgPSAnJztcbiAgfVxuICBmb3IgKGkgPSBsaW5lLm1hdGNoKHN0YXJ0KVswXS5sZW5ndGg7IGkgPCBsaW5lLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IGxpbmVbaV07XG4gICAgaWYgKHN0YXRlID09ICdvcHRuYW1lJykge1xuICAgICAgaWYgKGMgPT0gJz0nKSB7IHN0YXRlID0gJ3N0YXJ0dmFsdWUnOyB9XG4gICAgICBlbHNlIHsgb3B0bmFtZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAnc3RhcnR2YWx1ZScpIHtcbiAgICAgIGlmICgvJ3xcIi8udGVzdChjKSkgeyBzdGF0ZSA9IGM7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyBzdGF0ZSA9ICd2YWx1ZSc7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICd2YWx1ZScpIHtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7IHB1c2hWYWx1ZSgpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoLyd8XCIvLnRlc3Qoc3RhdGUpKSB7XG4gICAgICBpZiAoYyA9PSBzdGF0ZSkgeyBwdXNoVmFsdWUoc3RhdGUpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH1cbiAgfVxuICBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykgeyBwdXNoVmFsdWUoKTsgfVxuICBpZiAoc3RhdGUgIT0gJ29wdG5hbWUnKSB7IHJldHVybiBmYWxzZTsgfVxuICByZXR1cm4gb3B0cztcbn1cblxuLy8gQ29uc3RydWN0cyBhIG1hcHBpbmcgZnVuY3Rpb24gdGhhdCBjb252ZXJ0cyBicCBpbnRlcnZhbHMgaW50byBwaXhlbCBpbnRlcnZhbHMsIHdpdGggb3B0aW9uYWwgY2FsY3VsYXRpb25zIGZvciB0ZXh0IHRvb1xubW9kdWxlLmV4cG9ydHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yID0gZnVuY3Rpb24oc3RhcnQsIHdpZHRoLCBicHBwLCB3aXRoVGV4dCwgbmFtZUZ1bmMsIHN0YXJ0a2V5LCBlbmRrZXkpIHtcbiAgaWYgKCFfLmlzRnVuY3Rpb24obmFtZUZ1bmMpKSB7IG5hbWVGdW5jID0gZnVuY3Rpb24oZCkgeyByZXR1cm4gZC5uYW1lIHx8ICcnOyB9OyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKHN0YXJ0a2V5KSkgeyBzdGFydGtleSA9ICdzdGFydCc7IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoZW5ka2V5KSkgeyBlbmRrZXkgPSAnZW5kJzsgfVxuICByZXR1cm4gZnVuY3Rpb24oZCkge1xuICAgIHZhciBpdHZsU3RhcnQgPSBfLmlzVW5kZWZpbmVkKGRbc3RhcnRrZXldKSA/IGQuc3RhcnQgOiBkW3N0YXJ0a2V5XSxcbiAgICAgIGl0dmxFbmQgPSBfLmlzVW5kZWZpbmVkKGRbZW5ka2V5XSkgPyBkLmVuZCA6IGRbZW5ka2V5XTtcbiAgICB2YXIgcEludCA9IHtcbiAgICAgIHg6IE1hdGgucm91bmQoKGl0dmxTdGFydCAtIHN0YXJ0KSAvIGJwcHApLFxuICAgICAgdzogTWF0aC5yb3VuZCgoaXR2bEVuZCAtIGl0dmxTdGFydCkgLyBicHBwKSArIDEsXG4gICAgICB0OiAwLCAgICAgICAgICAvLyBjYWxjdWxhdGVkIHdpZHRoIG9mIHRleHRcbiAgICAgIG9QcmV2OiBmYWxzZSwgIC8vIG92ZXJmbG93cyBpbnRvIHByZXZpb3VzIHRpbGU/XG4gICAgICBvTmV4dDogZmFsc2UgICAvLyBvdmVyZmxvd3MgaW50byBuZXh0IHRpbGU/XG4gICAgfTtcbiAgICBwSW50LnR4ID0gcEludC54O1xuICAgIHBJbnQudHcgPSBwSW50Lnc7XG4gICAgaWYgKHBJbnQueCA8IDApIHsgcEludC53ICs9IHBJbnQueDsgcEludC54ID0gMDsgcEludC5vUHJldiA9IHRydWU7IH1cbiAgICBlbHNlIGlmICh3aXRoVGV4dCkge1xuICAgICAgcEludC50ID0gXy5pc051bWJlcih3aXRoVGV4dCkgPyB3aXRoVGV4dCA6IE1hdGgubWluKG5hbWVGdW5jKGQpLmxlbmd0aCAqIDEwICsgMiwgcEludC54KTtcbiAgICAgIHBJbnQudHggLT0gcEludC50O1xuICAgICAgcEludC50dyArPSBwSW50LnQ7ICBcbiAgICB9XG4gICAgaWYgKHBJbnQueCArIHBJbnQudyA+IHdpZHRoKSB7IHBJbnQudyA9IHdpZHRoIC0gcEludC54OyBwSW50Lm9OZXh0ID0gdHJ1ZTsgfVxuICAgIHJldHVybiBwSW50O1xuICB9O1xufTtcblxuLy8gRm9yIHR3byBnaXZlbiBvYmplY3RzIG9mIHRoZSBmb3JtIHt4OiAxLCB3OiAyfSAocGl4ZWwgaW50ZXJ2YWxzKSwgZGVzY3JpYmUgdGhlIG92ZXJsYXAuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlcmUgaXMgbm8gb3ZlcmxhcC5cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsT3ZlcmxhcCA9IGZ1bmN0aW9uKHBJbnQxLCBwSW50Mikge1xuICB2YXIgb3ZlcmxhcCA9IHt9LFxuICAgIHRtcDtcbiAgaWYgKHBJbnQxLnggPiBwSW50Mi54KSB7IHRtcCA9IHBJbnQyOyBwSW50MiA9IHBJbnQxOyBwSW50MSA9IHRtcDsgfSAgICAgICAvLyBzd2FwIHNvIHRoYXQgcEludDEgaXMgYWx3YXlzIGxvd2VyXG4gIGlmICghcEludDEudyB8fCAhcEludDIudyB8fCBwSW50MS54ICsgcEludDEudyA8IHBJbnQyLngpIHsgcmV0dXJuIG51bGw7IH0gLy8gZGV0ZWN0IG5vLW92ZXJsYXAgY29uZGl0aW9uc1xuICBvdmVybGFwLnggPSBwSW50Mi54O1xuICBvdmVybGFwLncgPSBNYXRoLm1pbihwSW50MS53IC0gcEludDIueCArIHBJbnQxLngsIHBJbnQyLncpO1xuICByZXR1cm4gb3ZlcmxhcDtcbn07XG5cbi8vIENvbW1vbiBmdW5jdGlvbnMgZm9yIHN1bW1hcml6aW5nIGRhdGEgaW4gYmlucyB3aGlsZSBwbG90dGluZyB3aWdnbGUgdHJhY2tzXG5tb2R1bGUuZXhwb3J0cy53aWdCaW5GdW5jdGlvbnMgPSB7XG4gIG1pbmltdW06IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gYmluLmxlbmd0aCA/IE1hdGgubWluLmFwcGx5KE1hdGgsIGJpbikgOiAwOyB9LFxuICBtZWFuOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIF8ucmVkdWNlKGJpbiwgZnVuY3Rpb24oYSxiKSB7IHJldHVybiBhICsgYjsgfSwgMCkgLyBiaW4ubGVuZ3RoOyB9LFxuICBtYXhpbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1heC5hcHBseShNYXRoLCBiaW4pIDogMDsgfVxufTtcblxuLy8gRmFzdGVyIHRoYW4gTWF0aC5mbG9vciAoaHR0cDovL3dlYmRvb2QuY29tLz9wPTIxOSlcbm1vZHVsZS5leHBvcnRzLmZsb29ySGFjayA9IGZ1bmN0aW9uKG51bSkgeyByZXR1cm4gKG51bSA8PCAwKSAtIChudW0gPCAwID8gMSA6IDApOyB9XG5cbi8vIE90aGVyIHRpbnkgZnVuY3Rpb25zIHRoYXQgd2UgbmVlZCBmb3Igb2RkcyBhbmQgZW5kcy4uLlxubW9kdWxlLmV4cG9ydHMuc3RyaXAgPSBmdW5jdGlvbihzdHIpIHsgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7IH1cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIHBhcnNlSW50KHZhbCwgMTApOyB9XG5tb2R1bGUuZXhwb3J0cy5kZWVwQ2xvbmUgPSBmdW5jdGlvbihvYmopIHsgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob2JqKSk7IH0iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSB2Y2ZUYWJpeCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3ZjZi5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLnZjZnRhYml4XG52YXIgVmNmVGFiaXhGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMTAwMDAwLFxuICAgIGNocm9tb3NvbWVzOiAnJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgdmNmVGFiaXggdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICAvLyBUT0RPOiBTZXQgbWF4RmV0Y2hXaW5kb3cgdXNpbmcgc29tZSBoZXVyaXN0aWMgYmFzZWQgb24gaG93IG1hbnkgaXRlbXMgYXJlIGluIHRoZSB0YWJpeCBpbmRleFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lVG9JbnRlcnZhbChsaW5lKSB7XG4gICAgICB2YXIgZmllbGRzID0gbGluZS5zcGxpdCgnXFx0JyksIGRhdGEgPSB7fSwgaW5mbyA9IHt9O1xuICAgICAgaWYgKGZpZWxkc1s3XSkge1xuICAgICAgICBfLmVhY2goZmllbGRzWzddLnNwbGl0KCc7JyksIGZ1bmN0aW9uKGwpIHsgbCA9IGwuc3BsaXQoJz0nKTsgaWYgKGwubGVuZ3RoID4gMSkgeyBpbmZvW2xbMF1dID0gbFsxXTsgfSB9KTtcbiAgICAgIH1cbiAgICAgIGRhdGEuc3RhcnQgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tmaWVsZHNbMF1dICsgcGFyc2VJbnQxMChmaWVsZHNbMV0pO1xuICAgICAgZGF0YS5pZCA9IGZpZWxkc1syXT09Jy4nID8gJ3ZjZi0nICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTAwMDAwMDAwKSA6IGZpZWxkc1syXTtcbiAgICAgIGRhdGEuZW5kID0gZGF0YS5zdGFydCArIDE7XG4gICAgICBkYXRhLnJlZiA9IGZpZWxkc1szXTtcbiAgICAgIGRhdGEuYWx0ID0gZmllbGRzWzRdO1xuICAgICAgZGF0YS5xdWFsID0gcGFyc2VGbG9hdChmaWVsZHNbNV0pO1xuICAgICAgZGF0YS5pbmZvID0gaW5mbztcbiAgICAgIHJldHVybiB7ZGF0YTogZGF0YX07XG4gICAgfVxuICAgIGZ1bmN0aW9uIG5hbWVGdW5jKGZpZWxkcykge1xuICAgICAgdmFyIHJlZiA9IGZpZWxkcy5yZWYgfHwgJycsXG4gICAgICAgIGFsdCA9IGZpZWxkcy5hbHQgfHwgJyc7XG4gICAgICByZXR1cm4gKHJlZi5sZW5ndGggPiBhbHQubGVuZ3RoID8gcmVmIDogYWx0KSB8fCAnJztcbiAgICB9XG4gIFxuICAgIGZ1bmN0aW9uIHN1Y2Nlc3MoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gW10sXG4gICAgICAgIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID4gODsgfSksXG4gICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5PT0ncGFjaycsIG5hbWVGdW5jKTtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgZHJhd1NwZWMucHVzaChjYWxjUGl4SW50ZXJ2YWwobGluZVRvSW50ZXJ2YWwobGluZSkuZGF0YSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRyYXdTcGVjID0ge2xheW91dDogc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0KF8ubWFwKGxpbmVzLCBsaW5lVG9JbnRlcnZhbCksIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwpfTtcbiAgICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiB3ZSBjYW4gcmVhc29uYWJseSBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggdG9vIG11Y2ggZGF0YSwgYXMgdGhpcyB3aWxsIG9ubHkgZGVsYXkgb3RoZXIgcmVxdWVzdHMuXG4gICAgLy8gVE9ETzogY2FjaGUgcmVzdWx0cyBzbyB3ZSBhcmVuJ3QgcmVmZXRjaGluZyB0aGUgc2FtZSByZWdpb25zIG92ZXIgYW5kIG92ZXIgYWdhaW4uXG4gICAgaWYgKChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICQuYWpheCh0aGlzLmFqYXhEaXIoKSArICd0YWJpeC5waHAnLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogdGhpcy5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgICBzdWNjZXNzOiBzdWNjZXNzXG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSB0aGlzLm9wdHMudXJsID8gdGhpcy5vcHRzLnVybCA6ICdqYXZhc2NyaXB0OnZvaWQoXCInK3RoaXMub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMjcgOiA2LFxuICAgICAgY29sb3JzID0ge2E6JzI1NSwwLDAnLCB0OicyNTUsMCwyNTUnLCBjOicwLDAsMjU1JywgZzonMCwyNTUsMCd9LFxuICAgICAgZHJhd0xpbWl0ID0gdGhpcy5vcHRzLmRyYXdMaW1pdCAmJiB0aGlzLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgYXJlYXMgPSBudWxsO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJykgeyBhcmVhcyA9IHRoaXMuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgIHRoaXMucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxlbmd0aCA+IGRyYXdMaW1pdCkgfHwgZHJhd1NwZWMudG9vTWFueSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIC8vIFRoaXMgYXBwbGllcyBzdHlsaW5nIHRoYXQgaW5kaWNhdGVzIHRoZXJlIHdhcyB0b28gbXVjaCBkYXRhIHRvIGxvYWQvZHJhdyBhbmQgdGhhdCB0aGUgdXNlciBuZWVkcyB0byB6b29tIHRvIHNlZSBtb3JlXG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICB9IGVsc2UgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICAgIF8uZWFjaChkcmF3U3BlYywgZnVuY3Rpb24ocEludCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodDtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgICB2YXIgYWx0Q29sb3IsIHJlZkNvbG9yO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIHJlZkNvbG9yID0gY29sb3JzW2RhdGEuZC5yZWYudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBhbHRDb2xvciA9IGNvbG9yc1tkYXRhLmQuYWx0LnRvTG93ZXJDYXNlKCldIHx8ICcyNTUsMCwwJztcbiAgICAgICAgICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKFwiICsgYWx0Q29sb3IgKyBcIilcIjsgXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LncsIGxpbmVIZWlnaHQgLSAxKTtcbiAgICAgICAgICAgIGlmIChhcmVhcykge1xuICAgICAgICAgICAgICBhcmVhcy5wdXNoKFtcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy94MSwgeDIsIHkxLCB5MlxuICAgICAgICAgICAgICAgIGRhdGEuZC5yZWYgKyAnID4gJyArIGRhdGEuZC5hbHQsIC8vIHRpdGxlXG4gICAgICAgICAgICAgICAgdXJsVGVtcGxhdGUucmVwbGFjZSgnJCQnLCBkYXRhLmQuaWQpLCAvLyBocmVmXG4gICAgICAgICAgICAgICAgZGF0YS5wSW50Lm9QcmV2LCAvLyBjb250aW51YXRpb24gZnJvbSBwcmV2aW91cyB0aWxlP1xuICAgICAgICAgICAgICAgIGFsdENvbG9yLCAvLyBsYWJlbCBjb2xvclxuICAgICAgICAgICAgICAgICc8c3BhbiBzdHlsZT1cImNvbG9yOiByZ2IoJyArIHJlZkNvbG9yICsgJylcIj4nICsgZGF0YS5kLnJlZiArICc8L3NwYW4+PGJyLz4nICsgZGF0YS5kLmFsdCwgLy8gbGFiZWxcbiAgICAgICAgICAgICAgICBkYXRhLmQuaW5mb1xuICAgICAgICAgICAgICBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVmNmVGFiaXhGb3JtYXQ7XG5cbiIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBXSUcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC93aWdnbGUuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgcGFyc2VEZWNsYXJhdGlvbkxpbmUgPSB1dGlscy5wYXJzZURlY2xhcmF0aW9uTGluZTtcbnZhciBTb3J0ZWRMaXN0ID0gcmVxdWlyZSgnLi91dGlscy9Tb3J0ZWRMaXN0LmpzJykuU29ydGVkTGlzdDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMud2lnZ2xlXzBcbnZhciBXaWdnbGVGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcnLFxuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgYXV0b1NjYWxlOiAnb24nLFxuICAgIGFsd2F5c1plcm86ICdvZmYnLFxuICAgIGdyaWREZWZhdWx0OiAnb2ZmJyxcbiAgICBtYXhIZWlnaHRQaXhlbHM6ICcxMjg6MTI4OjE1JyxcbiAgICBncmFwaFR5cGU6ICdiYXInLFxuICAgIHZpZXdMaW1pdHM6ICcnLFxuICAgIHlMaW5lTWFyazogMC4wLFxuICAgIHlMaW5lT25PZmY6ICdvZmYnLFxuICAgIHdpbmRvd2luZ0Z1bmN0aW9uOiAnbWF4aW11bScsXG4gICAgc21vb3RoaW5nV2luZG93OiAnb2ZmJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB1dGlscy53aWdCaW5GdW5jdGlvbnMsXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBfYmluRnVuY3Rpb25zID0gdGhpcy50eXBlKCkuX2JpbkZ1bmN0aW9ucztcbiAgICBpZiAoIXRoaXMudmFsaWRhdGVDb2xvcihvLmFsdENvbG9yKSkgeyBvLmFsdENvbG9yID0gJyc7IH1cbiAgICBvLnZpZXdMaW1pdHMgPSBfLm1hcChvLnZpZXdMaW1pdHMuc3BsaXQoJzonKSwgcGFyc2VGbG9hdCk7XG4gICAgby5tYXhIZWlnaHRQaXhlbHMgPSBfLm1hcChvLm1heEhlaWdodFBpeGVscy5zcGxpdCgnOicpLCBwYXJzZUludDEwKTtcbiAgICBvLnlMaW5lT25PZmYgPSB0aGlzLmlzT24oby55TGluZU9uT2ZmKTtcbiAgICBvLnlMaW5lTWFyayA9IHBhcnNlRmxvYXQoby55TGluZU1hcmspO1xuICAgIG8uYXV0b1NjYWxlID0gdGhpcy5pc09uKG8uYXV0b1NjYWxlKTtcbiAgICBpZiAoX2JpbkZ1bmN0aW9ucyAmJiAhX2JpbkZ1bmN0aW9uc1tvLndpbmRvd2luZ0Z1bmN0aW9uXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCB3aW5kb3dpbmdGdW5jdGlvbiBhdCBsaW5lIFwiICsgby5saW5lTnVtKTsgXG4gICAgfVxuICAgIGlmIChfLmlzTmFOKG8ueUxpbmVNYXJrKSkgeyBvLnlMaW5lTWFyayA9IDAuMDsgfVxuICB9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgIHNlbGYuZHJhd1JhbmdlID0gby5hdXRvU2NhbGUgfHwgby52aWV3TGltaXRzLmxlbmd0aCA8IDIgPyBzZWxmLnJhbmdlIDogby52aWV3TGltaXRzO1xuICAgIF8uZWFjaCh7bWF4OiAwLCBtaW46IDIsIHN0YXJ0OiAxfSwgZnVuY3Rpb24odiwgaykgeyBzZWxmLmhlaWdodHNba10gPSBvLm1heEhlaWdodFBpeGVsc1t2XTsgfSk7XG4gICAgaWYgKCFvLmFsdENvbG9yKSB7XG4gICAgICB2YXIgaHNsID0gdGhpcy5yZ2JUb0hzbC5hcHBseSh0aGlzLCBvLmNvbG9yLnNwbGl0KC8sXFxzKi9nKSk7XG4gICAgICBoc2xbMF0gPSBoc2xbMF0gKyAwLjAyICUgMTtcbiAgICAgIGhzbFsxXSA9IGhzbFsxXSAqIDAuNztcbiAgICAgIGhzbFsyXSA9IDEgLSAoMSAtIGhzbFsyXSkgKiAwLjc7XG4gICAgICBzZWxmLmFsdENvbG9yID0gXy5tYXAodGhpcy5oc2xUb1JnYi5hcHBseSh0aGlzLCBoc2wpLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGdlbm9tZVNpemUgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICBkYXRhID0ge2FsbDogW119LFxuICAgICAgbW9kZSwgbW9kZU9wdHMsIGNoclBvcywgbTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHRoaXMub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciB2YWwsIHN0YXJ0O1xuICAgICAgXG4gICAgICBtID0gbGluZS5tYXRjaCgvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIG1vZGUgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIG1vZGVPcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgL14odmFyaWFibGV8Zml4ZWQpU3RlcFxccysvaSk7XG4gICAgICAgIG1vZGVPcHRzLnN0YXJ0ID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zdGFydCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RhcnQpIHx8ICFtb2RlT3B0cy5zdGFydCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmaXhlZFN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZSBub24temVybyBzdGFydCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnN0ZXAgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0ZXApO1xuICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnICYmIChfLmlzTmFOKG1vZGVPcHRzLnN0ZXApIHx8ICFtb2RlT3B0cy5zdGVwKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0ZXAgcGFyYW1ldGVyXCIpOyBcbiAgICAgICAgfVxuICAgICAgICBtb2RlT3B0cy5zcGFuID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zcGFuKSB8fCAxO1xuICAgICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1ttb2RlT3B0cy5jaHJvbV07XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFtb2RlKSB7IFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIldpZ2dsZSBmb3JtYXQgYXQgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIGhhcyBubyBwcmVjZWRpbmcgbW9kZSBkZWNsYXJhdGlvblwiKTsgXG4gICAgICAgIH0gZWxzZSBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgICAgLy8gaW52YWxpZCBjaHJvbW9zb21lXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJykge1xuICAgICAgICAgICAgdmFsID0gcGFyc2VGbG9hdChsaW5lKTtcbiAgICAgICAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCwgZW5kOiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCArIG1vZGVPcHRzLnNwYW4sIHZhbDogdmFsfSk7XG4gICAgICAgICAgICBtb2RlT3B0cy5zdGFydCArPSBtb2RlT3B0cy5zdGVwO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsaW5lID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICAgICAgaWYgKGxpbmUubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZVN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZXMgdHdvIHZhbHVlcyBwZXIgbGluZVwiKTsgXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGFydCA9IHBhcnNlSW50MTAobGluZVswXSk7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmVbMV0pO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIHN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gc2VsZi50eXBlKCkuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGZpbmlzaFBhcnNlOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl07XG4gICAgaWYgKGRhdGEuYWxsLmxlbmd0aCA+IDApIHtcbiAgICAgIHNlbGYucmFuZ2VbMF0gPSBfLm1pbihkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICAgIHNlbGYucmFuZ2VbMV0gPSBfLm1heChkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICB9XG4gICAgZGF0YS5hbGwgPSBuZXcgU29ydGVkTGlzdChkYXRhLmFsbCwge1xuICAgICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICBpZiAoYSA9PT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgICBpZiAoYiA9PT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PT0gMCkgID8gMCA6IC0xO1xuICAgICAgfVxuICAgIH0pO1xuICBcbiAgICAvLyBQcmUtb3B0aW1pemUgZGF0YSBmb3IgaGlnaCBicHBwcyBieSBkb3duc2FtcGxpbmdcbiAgICBfLmVhY2goc2VsZi5icm93c2VyT3B0cy5icHBwcywgZnVuY3Rpb24oYnBwcCkge1xuICAgICAgaWYgKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHAgPiAxMDAwMDAwKSB7IHJldHVybjsgfVxuICAgICAgdmFyIHBpeExlbiA9IE1hdGguY2VpbChzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyBicHBwKSxcbiAgICAgICAgZG93bnNhbXBsZWREYXRhID0gKGRhdGFbYnBwcF0gPSAoZ2xvYmFsLkZsb2F0MzJBcnJheSA/IG5ldyBGbG9hdDMyQXJyYXkocGl4TGVuKSA6IG5ldyBBcnJheShwaXhMZW4pKSksXG4gICAgICAgIGogPSAwLFxuICAgICAgICBjdXJyID0gZGF0YS5hbGwuZ2V0KDApLFxuICAgICAgICBiaW4sIG5leHQ7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBpeExlbjsgaSsrKSB7XG4gICAgICAgIGJpbiA9IGN1cnIgJiYgKGN1cnIuc3RhcnQgPD0gaSAqIGJwcHAgJiYgY3Vyci5lbmQgPiBpICogYnBwcCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IGRhdGEuYWxsLmdldChqICsgMSkpICYmIG5leHQuc3RhcnQgPCAoaSArIDEpICogYnBwcCAmJiBuZXh0LmVuZCA+IGkgKiBicHBwKSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZG93bnNhbXBsZWREYXRhW2ldID0gYmluRnVuY3Rpb24oYmluKTtcbiAgICAgIH1cbiAgICAgIGRhdGEuX2JpbkZ1bmN0aW9uID0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uO1xuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHNlbGYpO1xuICAgIHJldHVybiB0cnVlOyAvLyBzdWNjZXNzIVxuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbihwcmVjYWxjKSB7XG4gICAgdmFyIHZTY2FsZSA9ICh0aGlzLmRyYXdSYW5nZVsxXSAtIHRoaXMuZHJhd1JhbmdlWzBdKSAvIHByZWNhbGMuaGVpZ2h0LFxuICAgICAgZHJhd1NwZWMgPSB7XG4gICAgICAgIGJhcnM6IFtdLFxuICAgICAgICB2U2NhbGU6IHZTY2FsZSxcbiAgICAgICAgeUxpbmU6IHRoaXMuaXNPbih0aGlzLm9wdHMueUxpbmVPbk9mZikgPyBNYXRoLnJvdW5kKCh0aGlzLm9wdHMueUxpbmVNYXJrIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gdlNjYWxlKSA6IG51bGwsIFxuICAgICAgICB6ZXJvTGluZTogLXRoaXMuZHJhd1JhbmdlWzBdIC8gdlNjYWxlXG4gICAgICB9O1xuICAgIHJldHVybiBkcmF3U3BlYztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyBwcmVjYWxjLndpZHRoLFxuICAgICAgZHJhd1NwZWMgPSBzZWxmLnR5cGUoKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dLFxuICAgICAgZG93bnNhbXBsZWREYXRhO1xuICAgIGlmIChzZWxmLmRhdGEuX2JpbkZ1bmN0aW9uID09IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbiAmJiAoZG93bnNhbXBsZWREYXRhID0gc2VsZi5kYXRhW2JwcHBdKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBwcmUtb3B0aW1pemVkIGZvciB0aGlzIGJwcHBcbiAgICAgIGRyYXdTcGVjLmJhcnMgPSBfLm1hcChfLnJhbmdlKChzdGFydCAtIDEpIC8gYnBwcCwgKGVuZCAtIDEpIC8gYnBwcCksIGZ1bmN0aW9uKHhGcm9tT3JpZ2luLCB4KSB7XG4gICAgICAgIHJldHVybiAoKGRvd25zYW1wbGVkRGF0YVt4RnJvbU9yaWdpbl0gfHwgMCkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGU7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2UgaGF2ZSB0byBkbyB0aGUgYmlubmluZyBvbiB0aGUgZmx5XG4gICAgICB2YXIgaiA9IHNlbGYuZGF0YS5hbGwuYnNlYXJjaCh7c3RhcnQ6IHN0YXJ0fSksXG4gICAgICAgIGN1cnIgPSBzZWxmLmRhdGEuYWxsLmdldChqKSwgbmV4dCwgYmluO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjYWxjLndpZHRoOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IHNlbGYuZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgbmV4dC5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRyYXdTcGVjLmJhcnMucHVzaCgoYmluRnVuY3Rpb24oYmluKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soZHJhd1NwZWMpIDogZHJhd1NwZWM7XG4gIH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCkge1xuICAgIHZhciB6ZXJvTGluZSA9IGRyYXdTcGVjLnplcm9MaW5lLCAvLyBwaXhlbCBwb3NpdGlvbiBvZiB0aGUgZGF0YSB2YWx1ZSAwXG4gICAgICBjb2xvciA9IFwicmdiKFwiK3RoaXMub3B0cy5jb2xvcitcIilcIixcbiAgICAgIGFsdENvbG9yID0gXCJyZ2IoXCIrKHRoaXMub3B0cy5hbHRDb2xvciB8fCB0aGlzLmFsdENvbG9yKStcIilcIixcbiAgICAgIHBvaW50R3JhcGggPSB0aGlzLm9wdHMuZ3JhcGhUeXBlPT09J3BvaW50cyc7XG4gICAgXG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgIF8uZWFjaChkcmF3U3BlYy5iYXJzLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGVsc2UgaWYgKGQgPiB6ZXJvTGluZSkgeyBcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIGQsIDEsIDEpOyB9XG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgemVyb0xpbmUgPiAwID8gKGQgLSB6ZXJvTGluZSkgOiBkKTsgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGFsdENvbG9yO1xuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgemVyb0xpbmUgLSBkIC0gMSwgMSwgMSk7IH0gXG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gemVyb0xpbmUsIDEsIHplcm9MaW5lIC0gZCk7IH1cbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChkcmF3U3BlYy55TGluZSAhPT0gbnVsbCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIGhlaWdodCAtIGRyYXdTcGVjLnlMaW5lLCB3aWR0aCwgMSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdCYXJzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgJHZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJy52aWV3LWxpbWl0cycpLFxuICAgICAgJG1heEhlaWdodFBpeGVscyA9ICRkaWFsb2cuZmluZCgnLm1heC1oZWlnaHQtcGl4ZWxzJyksXG4gICAgICBhbHRDb2xvck9uID0gdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JPbl0nKS5hdHRyKCdjaGVja2VkJywgYWx0Q29sb3JPbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvcl0nKS52YWwoYWx0Q29sb3JPbiA/IG8uYWx0Q29sb3IgOicxMjgsMTI4LDEyOCcpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YXV0b1NjYWxlXScpLmF0dHIoJ2NoZWNrZWQnLCAhdGhpcy5pc09uKG8uYXV0b1NjYWxlKSkuY2hhbmdlKCk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWluXCIsIHRoaXMucmFuZ2VbMF0pO1xuICAgICR2aWV3TGltaXRzLnNsaWRlcihcIm9wdGlvblwiLCBcIm1heFwiLCB0aGlzLnJhbmdlWzFdKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKHRoaXMuZHJhd1JhbmdlWzBdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKHRoaXMuZHJhd1JhbmdlWzFdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lT25PZmZdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnlMaW5lT25PZmYpKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lTWFya10nKS52YWwoby55TGluZU1hcmspLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Z3JhcGhUeXBlXScpLnZhbChvLmdyYXBoVHlwZSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoby53aW5kb3dpbmdGdW5jdGlvbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNPbl0nKS5hdHRyKCdjaGVja2VkJywgby5tYXhIZWlnaHRQaXhlbHMubGVuZ3RoID49IDMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbChvLm1heEhlaWdodFBpeGVsc1syXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzBdKS5jaGFuZ2UoKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBhbHRDb2xvck9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzTWF4ID0gJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKCk7XG4gICAgby5hbHRDb2xvciA9IGFsdENvbG9yT24gPyAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbCgpIDogJyc7XG4gICAgby5hdXRvU2NhbGUgPSAhJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby52aWV3TGltaXRzID0gJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWluXScpLnZhbCgpICsgJzonICsgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWF4XScpLnZhbCgpO1xuICAgIG8ueUxpbmVPbk9mZiA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnlMaW5lTWFyayA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbCgpO1xuICAgIG8uZ3JhcGhUeXBlID0gJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKCk7XG4gICAgby53aW5kb3dpbmdGdW5jdGlvbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9d2luZG93aW5nRnVuY3Rpb25dJykudmFsKCk7XG4gICAgby5tYXhIZWlnaHRQaXhlbHMgPSBtYXhIZWlnaHRQaXhlbHNPbiA/IFxuICAgICAgW21heEhlaWdodFBpeGVsc01heCwgbWF4SGVpZ2h0UGl4ZWxzTWF4LCAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01pbl0nKS52YWwoKV0uam9pbignOicpIDogJyc7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdpZ2dsZUZvcm1hdDsiLCIvLyBVbmRlcnNjb3JlLmpzIDEuMi4zXG4vLyAoYykgMjAwOS0yMDExIEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBJbmMuXG4vLyBVbmRlcnNjb3JlIGlzIGZyZWVseSBkaXN0cmlidXRhYmxlIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbi8vIFBvcnRpb25zIG9mIFVuZGVyc2NvcmUgYXJlIGluc3BpcmVkIG9yIGJvcnJvd2VkIGZyb20gUHJvdG90eXBlLFxuLy8gT2xpdmVyIFN0ZWVsZSdzIEZ1bmN0aW9uYWwsIGFuZCBKb2huIFJlc2lnJ3MgTWljcm8tVGVtcGxhdGluZy5cbi8vIEZvciBhbGwgZGV0YWlscyBhbmQgZG9jdW1lbnRhdGlvbjpcbi8vIGh0dHA6Ly9kb2N1bWVudGNsb3VkLmdpdGh1Yi5jb20vdW5kZXJzY29yZVxuKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihhLGMsZCl7aWYoYT09PWMpcmV0dXJuIGEhPT0wfHwxL2E9PTEvYztpZihhPT1udWxsfHxjPT1udWxsKXJldHVybiBhPT09YztpZihhLl9jaGFpbilhPWEuX3dyYXBwZWQ7aWYoYy5fY2hhaW4pYz1jLl93cmFwcGVkO2lmKGEuaXNFcXVhbCYmYi5pc0Z1bmN0aW9uKGEuaXNFcXVhbCkpcmV0dXJuIGEuaXNFcXVhbChjKTtpZihjLmlzRXF1YWwmJmIuaXNGdW5jdGlvbihjLmlzRXF1YWwpKXJldHVybiBjLmlzRXF1YWwoYSk7dmFyIGU9bC5jYWxsKGEpO2lmKGUhPWwuY2FsbChjKSlyZXR1cm4gZmFsc2U7c3dpdGNoKGUpe2Nhc2UgXCJbb2JqZWN0IFN0cmluZ11cIjpyZXR1cm4gYT09U3RyaW5nKGMpO2Nhc2UgXCJbb2JqZWN0IE51bWJlcl1cIjpyZXR1cm4gYSE9K2E/YyE9K2M6YT09MD8xL2E9PTEvYzphPT0rYztjYXNlIFwiW29iamVjdCBEYXRlXVwiOmNhc2UgXCJbb2JqZWN0IEJvb2xlYW5dXCI6cmV0dXJuK2E9PStjO2Nhc2UgXCJbb2JqZWN0IFJlZ0V4cF1cIjpyZXR1cm4gYS5zb3VyY2U9PVxuYy5zb3VyY2UmJmEuZ2xvYmFsPT1jLmdsb2JhbCYmYS5tdWx0aWxpbmU9PWMubXVsdGlsaW5lJiZhLmlnbm9yZUNhc2U9PWMuaWdub3JlQ2FzZX1pZih0eXBlb2YgYSE9XCJvYmplY3RcInx8dHlwZW9mIGMhPVwib2JqZWN0XCIpcmV0dXJuIGZhbHNlO2Zvcih2YXIgZj1kLmxlbmd0aDtmLS07KWlmKGRbZl09PWEpcmV0dXJuIHRydWU7ZC5wdXNoKGEpO3ZhciBmPTAsZz10cnVlO2lmKGU9PVwiW29iamVjdCBBcnJheV1cIil7aWYoZj1hLmxlbmd0aCxnPWY9PWMubGVuZ3RoKWZvcig7Zi0tOylpZighKGc9ZiBpbiBhPT1mIGluIGMmJnIoYVtmXSxjW2ZdLGQpKSlicmVha31lbHNle2lmKFwiY29uc3RydWN0b3JcImluIGEhPVwiY29uc3RydWN0b3JcImluIGN8fGEuY29uc3RydWN0b3IhPWMuY29uc3RydWN0b3IpcmV0dXJuIGZhbHNlO2Zvcih2YXIgaCBpbiBhKWlmKG0uY2FsbChhLGgpJiYoZisrLCEoZz1tLmNhbGwoYyxoKSYmcihhW2hdLGNbaF0sZCkpKSlicmVhaztpZihnKXtmb3IoaCBpbiBjKWlmKG0uY2FsbChjLFxuaCkmJiFmLS0pYnJlYWs7Zz0hZn19ZC5wb3AoKTtyZXR1cm4gZ312YXIgcz10aGlzLEY9cy5fLG89e30saz1BcnJheS5wcm90b3R5cGUscD1PYmplY3QucHJvdG90eXBlLGk9ay5zbGljZSxHPWsuY29uY2F0LEg9ay51bnNoaWZ0LGw9cC50b1N0cmluZyxtPXAuaGFzT3duUHJvcGVydHksdj1rLmZvckVhY2gsdz1rLm1hcCx4PWsucmVkdWNlLHk9ay5yZWR1Y2VSaWdodCx6PWsuZmlsdGVyLEE9ay5ldmVyeSxCPWsuc29tZSxxPWsuaW5kZXhPZixDPWsubGFzdEluZGV4T2YscD1BcnJheS5pc0FycmF5LEk9T2JqZWN0LmtleXMsdD1GdW5jdGlvbi5wcm90b3R5cGUuYmluZCxiPWZ1bmN0aW9uKGEpe3JldHVybiBuZXcgbihhKX07aWYodHlwZW9mIGV4cG9ydHMhPT1cInVuZGVmaW5lZFwiKXtpZih0eXBlb2YgbW9kdWxlIT09XCJ1bmRlZmluZWRcIiYmbW9kdWxlLmV4cG9ydHMpZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1iO2V4cG9ydHMuXz1ifWVsc2UgdHlwZW9mIGRlZmluZT09PVwiZnVuY3Rpb25cIiYmXG5kZWZpbmUuYW1kP2RlZmluZShcInVuZGVyc2NvcmVcIixmdW5jdGlvbigpe3JldHVybiBifSk6cy5fPWI7Yi5WRVJTSU9OPVwiMS4yLjNcIjt2YXIgaj1iLmVhY2g9Yi5mb3JFYWNoPWZ1bmN0aW9uKGEsYyxiKXtpZihhIT1udWxsKWlmKHYmJmEuZm9yRWFjaD09PXYpYS5mb3JFYWNoKGMsYik7ZWxzZSBpZihhLmxlbmd0aD09PSthLmxlbmd0aClmb3IodmFyIGU9MCxmPWEubGVuZ3RoO2U8ZjtlKyspe2lmKGUgaW4gYSYmYy5jYWxsKGIsYVtlXSxlLGEpPT09bylicmVha31lbHNlIGZvcihlIGluIGEpaWYobS5jYWxsKGEsZSkmJmMuY2FsbChiLGFbZV0sZSxhKT09PW8pYnJlYWt9O2IubWFwPWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT1bXTtpZihhPT1udWxsKXJldHVybiBlO2lmKHcmJmEubWFwPT09dylyZXR1cm4gYS5tYXAoYyxiKTtqKGEsZnVuY3Rpb24oYSxnLGgpe2VbZS5sZW5ndGhdPWMuY2FsbChiLGEsZyxoKX0pO3JldHVybiBlfTtiLnJlZHVjZT1iLmZvbGRsPWIuaW5qZWN0PWZ1bmN0aW9uKGEsXG5jLGQsZSl7dmFyIGY9YXJndW1lbnRzLmxlbmd0aD4yO2E9PW51bGwmJihhPVtdKTtpZih4JiZhLnJlZHVjZT09PXgpcmV0dXJuIGUmJihjPWIuYmluZChjLGUpKSxmP2EucmVkdWNlKGMsZCk6YS5yZWR1Y2UoYyk7aihhLGZ1bmN0aW9uKGEsYixpKXtmP2Q9Yy5jYWxsKGUsZCxhLGIsaSk6KGQ9YSxmPXRydWUpfSk7aWYoIWYpdGhyb3cgbmV3IFR5cGVFcnJvcihcIlJlZHVjZSBvZiBlbXB0eSBhcnJheSB3aXRoIG5vIGluaXRpYWwgdmFsdWVcIik7cmV0dXJuIGR9O2IucmVkdWNlUmlnaHQ9Yi5mb2xkcj1mdW5jdGlvbihhLGMsZCxlKXt2YXIgZj1hcmd1bWVudHMubGVuZ3RoPjI7YT09bnVsbCYmKGE9W10pO2lmKHkmJmEucmVkdWNlUmlnaHQ9PT15KXJldHVybiBlJiYoYz1iLmJpbmQoYyxlKSksZj9hLnJlZHVjZVJpZ2h0KGMsZCk6YS5yZWR1Y2VSaWdodChjKTt2YXIgZz1iLnRvQXJyYXkoYSkucmV2ZXJzZSgpO2UmJiFmJiYoYz1iLmJpbmQoYyxlKSk7cmV0dXJuIGY/Yi5yZWR1Y2UoZyxcbmMsZCxlKTpiLnJlZHVjZShnLGMpfTtiLmZpbmQ9Yi5kZXRlY3Q9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlO0QoYSxmdW5jdGlvbihhLGcsaCl7aWYoYy5jYWxsKGIsYSxnLGgpKXJldHVybiBlPWEsdHJ1ZX0pO3JldHVybiBlfTtiLmZpbHRlcj1iLnNlbGVjdD1mdW5jdGlvbihhLGMsYil7dmFyIGU9W107aWYoYT09bnVsbClyZXR1cm4gZTtpZih6JiZhLmZpbHRlcj09PXopcmV0dXJuIGEuZmlsdGVyKGMsYik7aihhLGZ1bmN0aW9uKGEsZyxoKXtjLmNhbGwoYixhLGcsaCkmJihlW2UubGVuZ3RoXT1hKX0pO3JldHVybiBlfTtiLnJlamVjdD1mdW5jdGlvbihhLGMsYil7dmFyIGU9W107aWYoYT09bnVsbClyZXR1cm4gZTtqKGEsZnVuY3Rpb24oYSxnLGgpe2MuY2FsbChiLGEsZyxoKXx8KGVbZS5sZW5ndGhdPWEpfSk7cmV0dXJuIGV9O2IuZXZlcnk9Yi5hbGw9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlPXRydWU7aWYoYT09bnVsbClyZXR1cm4gZTtpZihBJiZhLmV2ZXJ5PT09QSlyZXR1cm4gYS5ldmVyeShjLFxuYik7aihhLGZ1bmN0aW9uKGEsZyxoKXtpZighKGU9ZSYmYy5jYWxsKGIsYSxnLGgpKSlyZXR1cm4gb30pO3JldHVybiBlfTt2YXIgRD1iLnNvbWU9Yi5hbnk9ZnVuY3Rpb24oYSxjLGQpe2N8fChjPWIuaWRlbnRpdHkpO3ZhciBlPWZhbHNlO2lmKGE9PW51bGwpcmV0dXJuIGU7aWYoQiYmYS5zb21lPT09QilyZXR1cm4gYS5zb21lKGMsZCk7aihhLGZ1bmN0aW9uKGEsYixoKXtpZihlfHwoZT1jLmNhbGwoZCxhLGIsaCkpKXJldHVybiBvfSk7cmV0dXJuISFlfTtiLmluY2x1ZGU9Yi5jb250YWlucz1mdW5jdGlvbihhLGMpe3ZhciBiPWZhbHNlO2lmKGE9PW51bGwpcmV0dXJuIGI7cmV0dXJuIHEmJmEuaW5kZXhPZj09PXE/YS5pbmRleE9mKGMpIT0tMTpiPUQoYSxmdW5jdGlvbihhKXtyZXR1cm4gYT09PWN9KX07Yi5pbnZva2U9ZnVuY3Rpb24oYSxjKXt2YXIgZD1pLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBiLm1hcChhLGZ1bmN0aW9uKGEpe3JldHVybihjLmNhbGw/Y3x8YTphW2NdKS5hcHBseShhLFxuZCl9KX07Yi5wbHVjaz1mdW5jdGlvbihhLGMpe3JldHVybiBiLm1hcChhLGZ1bmN0aW9uKGEpe3JldHVybiBhW2NdfSl9O2IubWF4PWZ1bmN0aW9uKGEsYyxkKXtpZighYyYmYi5pc0FycmF5KGEpKXJldHVybiBNYXRoLm1heC5hcHBseShNYXRoLGEpO2lmKCFjJiZiLmlzRW1wdHkoYSkpcmV0dXJuLUluZmluaXR5O3ZhciBlPXtjb21wdXRlZDotSW5maW5pdHl9O2ooYSxmdW5jdGlvbihhLGIsaCl7Yj1jP2MuY2FsbChkLGEsYixoKTphO2I+PWUuY29tcHV0ZWQmJihlPXt2YWx1ZTphLGNvbXB1dGVkOmJ9KX0pO3JldHVybiBlLnZhbHVlfTtiLm1pbj1mdW5jdGlvbihhLGMsZCl7aWYoIWMmJmIuaXNBcnJheShhKSlyZXR1cm4gTWF0aC5taW4uYXBwbHkoTWF0aCxhKTtpZighYyYmYi5pc0VtcHR5KGEpKXJldHVybiBJbmZpbml0eTt2YXIgZT17Y29tcHV0ZWQ6SW5maW5pdHl9O2ooYSxmdW5jdGlvbihhLGIsaCl7Yj1jP2MuY2FsbChkLGEsYixoKTphO2I8ZS5jb21wdXRlZCYmKGU9e3ZhbHVlOmEsXG5jb21wdXRlZDpifSl9KTtyZXR1cm4gZS52YWx1ZX07Yi5zaHVmZmxlPWZ1bmN0aW9uKGEpe3ZhciBjPVtdLGI7aihhLGZ1bmN0aW9uKGEsZil7Zj09MD9jWzBdPWE6KGI9TWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpKihmKzEpKSxjW2ZdPWNbYl0sY1tiXT1hKX0pO3JldHVybiBjfTtiLnNvcnRCeT1mdW5jdGlvbihhLGMsZCl7cmV0dXJuIGIucGx1Y2soYi5tYXAoYSxmdW5jdGlvbihhLGIsZyl7cmV0dXJue3ZhbHVlOmEsY3JpdGVyaWE6Yy5jYWxsKGQsYSxiLGcpfX0pLnNvcnQoZnVuY3Rpb24oYSxjKXt2YXIgYj1hLmNyaXRlcmlhLGQ9Yy5jcml0ZXJpYTtyZXR1cm4gYjxkPy0xOmI+ZD8xOjB9KSxcInZhbHVlXCIpfTtiLmdyb3VwQnk9ZnVuY3Rpb24oYSxjKXt2YXIgZD17fSxlPWIuaXNGdW5jdGlvbihjKT9jOmZ1bmN0aW9uKGEpe3JldHVybiBhW2NdfTtqKGEsZnVuY3Rpb24oYSxiKXt2YXIgYz1lKGEsYik7KGRbY118fChkW2NdPVtdKSkucHVzaChhKX0pO3JldHVybiBkfTtiLnNvcnRlZEluZGV4PVxuZnVuY3Rpb24oYSxjLGQpe2R8fChkPWIuaWRlbnRpdHkpO2Zvcih2YXIgZT0wLGY9YS5sZW5ndGg7ZTxmOyl7dmFyIGc9ZStmPj4xO2QoYVtnXSk8ZChjKT9lPWcrMTpmPWd9cmV0dXJuIGV9O2IudG9BcnJheT1mdW5jdGlvbihhKXtyZXR1cm4hYT9bXTphLnRvQXJyYXk/YS50b0FycmF5KCk6Yi5pc0FycmF5KGEpP2kuY2FsbChhKTpiLmlzQXJndW1lbnRzKGEpP2kuY2FsbChhKTpiLnZhbHVlcyhhKX07Yi5zaXplPWZ1bmN0aW9uKGEpe3JldHVybiBiLnRvQXJyYXkoYSkubGVuZ3RofTtiLmZpcnN0PWIuaGVhZD1mdW5jdGlvbihhLGIsZCl7cmV0dXJuIGIhPW51bGwmJiFkP2kuY2FsbChhLDAsYik6YVswXX07Yi5pbml0aWFsPWZ1bmN0aW9uKGEsYixkKXtyZXR1cm4gaS5jYWxsKGEsMCxhLmxlbmd0aC0oYj09bnVsbHx8ZD8xOmIpKX07Yi5sYXN0PWZ1bmN0aW9uKGEsYixkKXtyZXR1cm4gYiE9bnVsbCYmIWQ/aS5jYWxsKGEsTWF0aC5tYXgoYS5sZW5ndGgtYiwwKSk6YVthLmxlbmd0aC1cbjFdfTtiLnJlc3Q9Yi50YWlsPWZ1bmN0aW9uKGEsYixkKXtyZXR1cm4gaS5jYWxsKGEsYj09bnVsbHx8ZD8xOmIpfTtiLmNvbXBhY3Q9ZnVuY3Rpb24oYSl7cmV0dXJuIGIuZmlsdGVyKGEsZnVuY3Rpb24oYSl7cmV0dXJuISFhfSl9O2IuZmxhdHRlbj1mdW5jdGlvbihhLGMpe3JldHVybiBiLnJlZHVjZShhLGZ1bmN0aW9uKGEsZSl7aWYoYi5pc0FycmF5KGUpKXJldHVybiBhLmNvbmNhdChjP2U6Yi5mbGF0dGVuKGUpKTthW2EubGVuZ3RoXT1lO3JldHVybiBhfSxbXSl9O2Iud2l0aG91dD1mdW5jdGlvbihhKXtyZXR1cm4gYi5kaWZmZXJlbmNlKGEsaS5jYWxsKGFyZ3VtZW50cywxKSl9O2IudW5pcT1iLnVuaXF1ZT1mdW5jdGlvbihhLGMsZCl7dmFyIGQ9ZD9iLm1hcChhLGQpOmEsZT1bXTtiLnJlZHVjZShkLGZ1bmN0aW9uKGQsZyxoKXtpZigwPT1ofHwoYz09PXRydWU/Yi5sYXN0KGQpIT1nOiFiLmluY2x1ZGUoZCxnKSkpZFtkLmxlbmd0aF09ZyxlW2UubGVuZ3RoXT1hW2hdO3JldHVybiBkfSxcbltdKTtyZXR1cm4gZX07Yi51bmlvbj1mdW5jdGlvbigpe3JldHVybiBiLnVuaXEoYi5mbGF0dGVuKGFyZ3VtZW50cyx0cnVlKSl9O2IuaW50ZXJzZWN0aW9uPWIuaW50ZXJzZWN0PWZ1bmN0aW9uKGEpe3ZhciBjPWkuY2FsbChhcmd1bWVudHMsMSk7cmV0dXJuIGIuZmlsdGVyKGIudW5pcShhKSxmdW5jdGlvbihhKXtyZXR1cm4gYi5ldmVyeShjLGZ1bmN0aW9uKGMpe3JldHVybiBiLmluZGV4T2YoYyxhKT49MH0pfSl9O2IuZGlmZmVyZW5jZT1mdW5jdGlvbihhKXt2YXIgYz1iLmZsYXR0ZW4oaS5jYWxsKGFyZ3VtZW50cywxKSk7cmV0dXJuIGIuZmlsdGVyKGEsZnVuY3Rpb24oYSl7cmV0dXJuIWIuaW5jbHVkZShjLGEpfSl9O2IuemlwPWZ1bmN0aW9uKCl7Zm9yKHZhciBhPWkuY2FsbChhcmd1bWVudHMpLGM9Yi5tYXgoYi5wbHVjayhhLFwibGVuZ3RoXCIpKSxkPUFycmF5KGMpLGU9MDtlPGM7ZSsrKWRbZV09Yi5wbHVjayhhLFwiXCIrZSk7cmV0dXJuIGR9O2IuaW5kZXhPZj1mdW5jdGlvbihhLFxuYyxkKXtpZihhPT1udWxsKXJldHVybi0xO3ZhciBlO2lmKGQpcmV0dXJuIGQ9Yi5zb3J0ZWRJbmRleChhLGMpLGFbZF09PT1jP2Q6LTE7aWYocSYmYS5pbmRleE9mPT09cSlyZXR1cm4gYS5pbmRleE9mKGMpO2ZvcihkPTAsZT1hLmxlbmd0aDtkPGU7ZCsrKWlmKGQgaW4gYSYmYVtkXT09PWMpcmV0dXJuIGQ7cmV0dXJuLTF9O2IubGFzdEluZGV4T2Y9ZnVuY3Rpb24oYSxiKXtpZihhPT1udWxsKXJldHVybi0xO2lmKEMmJmEubGFzdEluZGV4T2Y9PT1DKXJldHVybiBhLmxhc3RJbmRleE9mKGIpO2Zvcih2YXIgZD1hLmxlbmd0aDtkLS07KWlmKGQgaW4gYSYmYVtkXT09PWIpcmV0dXJuIGQ7cmV0dXJuLTF9O2IucmFuZ2U9ZnVuY3Rpb24oYSxiLGQpe2FyZ3VtZW50cy5sZW5ndGg8PTEmJihiPWF8fDAsYT0wKTtmb3IodmFyIGQ9YXJndW1lbnRzWzJdfHwxLGU9TWF0aC5tYXgoTWF0aC5jZWlsKChiLWEpL2QpLDApLGY9MCxnPUFycmF5KGUpO2Y8ZTspZ1tmKytdPWEsYSs9ZDtyZXR1cm4gZ307XG52YXIgRT1mdW5jdGlvbigpe307Yi5iaW5kPWZ1bmN0aW9uKGEsYyl7dmFyIGQsZTtpZihhLmJpbmQ9PT10JiZ0KXJldHVybiB0LmFwcGx5KGEsaS5jYWxsKGFyZ3VtZW50cywxKSk7aWYoIWIuaXNGdW5jdGlvbihhKSl0aHJvdyBuZXcgVHlwZUVycm9yO2U9aS5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gZD1mdW5jdGlvbigpe2lmKCEodGhpcyBpbnN0YW5jZW9mIGQpKXJldHVybiBhLmFwcGx5KGMsZS5jb25jYXQoaS5jYWxsKGFyZ3VtZW50cykpKTtFLnByb3RvdHlwZT1hLnByb3RvdHlwZTt2YXIgYj1uZXcgRSxnPWEuYXBwbHkoYixlLmNvbmNhdChpLmNhbGwoYXJndW1lbnRzKSkpO3JldHVybiBPYmplY3QoZyk9PT1nP2c6Yn19O2IuYmluZEFsbD1mdW5jdGlvbihhKXt2YXIgYz1pLmNhbGwoYXJndW1lbnRzLDEpO2MubGVuZ3RoPT0wJiYoYz1iLmZ1bmN0aW9ucyhhKSk7aihjLGZ1bmN0aW9uKGMpe2FbY109Yi5iaW5kKGFbY10sYSl9KTtyZXR1cm4gYX07Yi5tZW1vaXplPWZ1bmN0aW9uKGEsXG5jKXt2YXIgZD17fTtjfHwoYz1iLmlkZW50aXR5KTtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgYj1jLmFwcGx5KHRoaXMsYXJndW1lbnRzKTtyZXR1cm4gbS5jYWxsKGQsYik/ZFtiXTpkW2JdPWEuYXBwbHkodGhpcyxhcmd1bWVudHMpfX07Yi5kZWxheT1mdW5jdGlvbihhLGIpe3ZhciBkPWkuY2FsbChhcmd1bWVudHMsMik7cmV0dXJuIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShhLGQpfSxiKX07Yi5kZWZlcj1mdW5jdGlvbihhKXtyZXR1cm4gYi5kZWxheS5hcHBseShiLFthLDFdLmNvbmNhdChpLmNhbGwoYXJndW1lbnRzLDEpKSl9O2IudGhyb3R0bGU9ZnVuY3Rpb24oYSxjKXt2YXIgZCxlLGYsZyxoLGk9Yi5kZWJvdW5jZShmdW5jdGlvbigpe2g9Zz1mYWxzZX0sYyk7cmV0dXJuIGZ1bmN0aW9uKCl7ZD10aGlzO2U9YXJndW1lbnRzO3ZhciBiO2Z8fChmPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtmPW51bGw7aCYmYS5hcHBseShkLGUpO2koKX0sYykpO2c/aD10cnVlOlxuYS5hcHBseShkLGUpO2koKTtnPXRydWV9fTtiLmRlYm91bmNlPWZ1bmN0aW9uKGEsYil7dmFyIGQ7cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGU9dGhpcyxmPWFyZ3VtZW50cztjbGVhclRpbWVvdXQoZCk7ZD1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7ZD1udWxsO2EuYXBwbHkoZSxmKX0sYil9fTtiLm9uY2U9ZnVuY3Rpb24oYSl7dmFyIGI9ZmFsc2UsZDtyZXR1cm4gZnVuY3Rpb24oKXtpZihiKXJldHVybiBkO2I9dHJ1ZTtyZXR1cm4gZD1hLmFwcGx5KHRoaXMsYXJndW1lbnRzKX19O2Iud3JhcD1mdW5jdGlvbihhLGIpe3JldHVybiBmdW5jdGlvbigpe3ZhciBkPUcuYXBwbHkoW2FdLGFyZ3VtZW50cyk7cmV0dXJuIGIuYXBwbHkodGhpcyxkKX19O2IuY29tcG9zZT1mdW5jdGlvbigpe3ZhciBhPWFyZ3VtZW50cztyZXR1cm4gZnVuY3Rpb24oKXtmb3IodmFyIGI9YXJndW1lbnRzLGQ9YS5sZW5ndGgtMTtkPj0wO2QtLSliPVthW2RdLmFwcGx5KHRoaXMsYildO3JldHVybiBiWzBdfX07Yi5hZnRlcj1cbmZ1bmN0aW9uKGEsYil7cmV0dXJuIGE8PTA/YigpOmZ1bmN0aW9uKCl7aWYoLS1hPDEpcmV0dXJuIGIuYXBwbHkodGhpcyxhcmd1bWVudHMpfX07Yi5rZXlzPUl8fGZ1bmN0aW9uKGEpe2lmKGEhPT1PYmplY3QoYSkpdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgb2JqZWN0XCIpO3ZhciBiPVtdLGQ7Zm9yKGQgaW4gYSltLmNhbGwoYSxkKSYmKGJbYi5sZW5ndGhdPWQpO3JldHVybiBifTtiLnZhbHVlcz1mdW5jdGlvbihhKXtyZXR1cm4gYi5tYXAoYSxiLmlkZW50aXR5KX07Yi5mdW5jdGlvbnM9Yi5tZXRob2RzPWZ1bmN0aW9uKGEpe3ZhciBjPVtdLGQ7Zm9yKGQgaW4gYSliLmlzRnVuY3Rpb24oYVtkXSkmJmMucHVzaChkKTtyZXR1cm4gYy5zb3J0KCl9O2IuZXh0ZW5kPWZ1bmN0aW9uKGEpe2ooaS5jYWxsKGFyZ3VtZW50cywxKSxmdW5jdGlvbihiKXtmb3IodmFyIGQgaW4gYiliW2RdIT09dm9pZCAwJiYoYVtkXT1iW2RdKX0pO3JldHVybiBhfTtiLmRlZmF1bHRzPWZ1bmN0aW9uKGEpe2ooaS5jYWxsKGFyZ3VtZW50cyxcbjEpLGZ1bmN0aW9uKGIpe2Zvcih2YXIgZCBpbiBiKWFbZF09PW51bGwmJihhW2RdPWJbZF0pfSk7cmV0dXJuIGF9O2IuY2xvbmU9ZnVuY3Rpb24oYSl7cmV0dXJuIWIuaXNPYmplY3QoYSk/YTpiLmlzQXJyYXkoYSk/YS5zbGljZSgpOmIuZXh0ZW5kKHt9LGEpfTtiLnRhcD1mdW5jdGlvbihhLGIpe2IoYSk7cmV0dXJuIGF9O2IuaXNFcXVhbD1mdW5jdGlvbihhLGIpe3JldHVybiByKGEsYixbXSl9O2IuaXNFbXB0eT1mdW5jdGlvbihhKXtpZihiLmlzQXJyYXkoYSl8fGIuaXNTdHJpbmcoYSkpcmV0dXJuIGEubGVuZ3RoPT09MDtmb3IodmFyIGMgaW4gYSlpZihtLmNhbGwoYSxjKSlyZXR1cm4gZmFsc2U7cmV0dXJuIHRydWV9O2IuaXNFbGVtZW50PWZ1bmN0aW9uKGEpe3JldHVybiEhKGEmJmEubm9kZVR5cGU9PTEpfTtiLmlzQXJyYXk9cHx8ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IEFycmF5XVwifTtiLmlzT2JqZWN0PWZ1bmN0aW9uKGEpe3JldHVybiBhPT09XG5PYmplY3QoYSl9O2IuaXNBcmd1bWVudHM9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IEFyZ3VtZW50c11cIn07aWYoIWIuaXNBcmd1bWVudHMoYXJndW1lbnRzKSliLmlzQXJndW1lbnRzPWZ1bmN0aW9uKGEpe3JldHVybiEoIWF8fCFtLmNhbGwoYSxcImNhbGxlZVwiKSl9O2IuaXNGdW5jdGlvbj1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgRnVuY3Rpb25dXCJ9O2IuaXNTdHJpbmc9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IFN0cmluZ11cIn07Yi5pc051bWJlcj1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgTnVtYmVyXVwifTtiLmlzTmFOPWZ1bmN0aW9uKGEpe3JldHVybiBhIT09YX07Yi5pc0Jvb2xlYW49ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT10cnVlfHxhPT09ZmFsc2V8fGwuY2FsbChhKT09XCJbb2JqZWN0IEJvb2xlYW5dXCJ9O2IuaXNEYXRlPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVxuXCJbb2JqZWN0IERhdGVdXCJ9O2IuaXNSZWdFeHA9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IFJlZ0V4cF1cIn07Yi5pc051bGw9ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT1udWxsfTtiLmlzVW5kZWZpbmVkPWZ1bmN0aW9uKGEpe3JldHVybiBhPT09dm9pZCAwfTtiLm5vQ29uZmxpY3Q9ZnVuY3Rpb24oKXtzLl89RjtyZXR1cm4gdGhpc307Yi5pZGVudGl0eT1mdW5jdGlvbihhKXtyZXR1cm4gYX07Yi50aW1lcz1mdW5jdGlvbihhLGIsZCl7Zm9yKHZhciBlPTA7ZTxhO2UrKyliLmNhbGwoZCxlKX07Yi5lc2NhcGU9ZnVuY3Rpb24oYSl7cmV0dXJuKFwiXCIrYSkucmVwbGFjZSgvJi9nLFwiJmFtcDtcIikucmVwbGFjZSgvPC9nLFwiJmx0O1wiKS5yZXBsYWNlKC8+L2csXCImZ3Q7XCIpLnJlcGxhY2UoL1wiL2csXCImcXVvdDtcIikucmVwbGFjZSgvJy9nLFwiJiN4Mjc7XCIpLnJlcGxhY2UoL1xcLy9nLFwiJiN4MkY7XCIpfTtiLm1peGluPWZ1bmN0aW9uKGEpe2ooYi5mdW5jdGlvbnMoYSksZnVuY3Rpb24oYyl7SihjLFxuYltjXT1hW2NdKX0pfTt2YXIgSz0wO2IudW5pcXVlSWQ9ZnVuY3Rpb24oYSl7dmFyIGI9SysrO3JldHVybiBhP2ErYjpifTtiLnRlbXBsYXRlU2V0dGluZ3M9e2V2YWx1YXRlOi88JShbXFxzXFxTXSs/KSU+L2csaW50ZXJwb2xhdGU6LzwlPShbXFxzXFxTXSs/KSU+L2csZXNjYXBlOi88JS0oW1xcc1xcU10rPyklPi9nfTtiLnRlbXBsYXRlPWZ1bmN0aW9uKGEsYyl7dmFyIGQ9Yi50ZW1wbGF0ZVNldHRpbmdzLGQ9XCJ2YXIgX19wPVtdLHByaW50PWZ1bmN0aW9uKCl7X19wLnB1c2guYXBwbHkoX19wLGFyZ3VtZW50cyk7fTt3aXRoKG9ianx8e30pe19fcC5wdXNoKCdcIithLnJlcGxhY2UoL1xcXFwvZyxcIlxcXFxcXFxcXCIpLnJlcGxhY2UoLycvZyxcIlxcXFwnXCIpLnJlcGxhY2UoZC5lc2NhcGUsZnVuY3Rpb24oYSxiKXtyZXR1cm5cIicsXy5lc2NhcGUoXCIrYi5yZXBsYWNlKC9cXFxcJy9nLFwiJ1wiKStcIiksJ1wifSkucmVwbGFjZShkLmludGVycG9sYXRlLGZ1bmN0aW9uKGEsYil7cmV0dXJuXCInLFwiK2IucmVwbGFjZSgvXFxcXCcvZyxcblwiJ1wiKStcIiwnXCJ9KS5yZXBsYWNlKGQuZXZhbHVhdGV8fG51bGwsZnVuY3Rpb24oYSxiKXtyZXR1cm5cIicpO1wiK2IucmVwbGFjZSgvXFxcXCcvZyxcIidcIikucmVwbGFjZSgvW1xcclxcblxcdF0vZyxcIiBcIikrXCI7X19wLnB1c2goJ1wifSkucmVwbGFjZSgvXFxyL2csXCJcXFxcclwiKS5yZXBsYWNlKC9cXG4vZyxcIlxcXFxuXCIpLnJlcGxhY2UoL1xcdC9nLFwiXFxcXHRcIikrXCInKTt9cmV0dXJuIF9fcC5qb2luKCcnKTtcIixlPW5ldyBGdW5jdGlvbihcIm9ialwiLFwiX1wiLGQpO3JldHVybiBjP2UoYyxiKTpmdW5jdGlvbihhKXtyZXR1cm4gZS5jYWxsKHRoaXMsYSxiKX19O3ZhciBuPWZ1bmN0aW9uKGEpe3RoaXMuX3dyYXBwZWQ9YX07Yi5wcm90b3R5cGU9bi5wcm90b3R5cGU7dmFyIHU9ZnVuY3Rpb24oYSxjKXtyZXR1cm4gYz9iKGEpLmNoYWluKCk6YX0sSj1mdW5jdGlvbihhLGMpe24ucHJvdG90eXBlW2FdPWZ1bmN0aW9uKCl7dmFyIGE9aS5jYWxsKGFyZ3VtZW50cyk7SC5jYWxsKGEsdGhpcy5fd3JhcHBlZCk7cmV0dXJuIHUoYy5hcHBseShiLFxuYSksdGhpcy5fY2hhaW4pfX07Yi5taXhpbihiKTtqKFwicG9wLHB1c2gscmV2ZXJzZSxzaGlmdCxzb3J0LHNwbGljZSx1bnNoaWZ0XCIuc3BsaXQoXCIsXCIpLGZ1bmN0aW9uKGEpe3ZhciBiPWtbYV07bi5wcm90b3R5cGVbYV09ZnVuY3Rpb24oKXtiLmFwcGx5KHRoaXMuX3dyYXBwZWQsYXJndW1lbnRzKTtyZXR1cm4gdSh0aGlzLl93cmFwcGVkLHRoaXMuX2NoYWluKX19KTtqKFtcImNvbmNhdFwiLFwiam9pblwiLFwic2xpY2VcIl0sZnVuY3Rpb24oYSl7dmFyIGI9a1thXTtuLnByb3RvdHlwZVthXT1mdW5jdGlvbigpe3JldHVybiB1KGIuYXBwbHkodGhpcy5fd3JhcHBlZCxhcmd1bWVudHMpLHRoaXMuX2NoYWluKX19KTtuLnByb3RvdHlwZS5jaGFpbj1mdW5jdGlvbigpe3RoaXMuX2NoYWluPXRydWU7cmV0dXJuIHRoaXN9O24ucHJvdG90eXBlLnZhbHVlPWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuX3dyYXBwZWR9fSkuY2FsbCh0aGlzKTsiXX0=
