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
  parseInt10 = utils.parseInt10;
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
    convertChrScheme: null,
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
    isThisAlignmentPrimary: 0x100,
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
      cache = new PairedIntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'bam.php',
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
      // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
      switch (o.convertChrScheme) {
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
        if (o.convertChrScheme !== false && chrScheme && self.browserChrScheme ) {
          o.convertChrScheme = chrScheme != self.browserChrScheme ? chrScheme + '_' + self.browserChrScheme : null;
        }
        self.data.info.meanItemsPerBp = meanItemsPerBp = mappedReads / self.browserOpts.genomeSize;
        self.data.info.meanItemLength = 100; // TODO: this is a total guess now, should grab this from some sampled reads.
        o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
        o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 2);
        
        // TODO: We can deactivate the pairing functionality of the PairedIntervalTree 
        //       if we don't see any paired reads in this BAM.
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
      chrPos, blockSizes;
    
    _.each(_.first(fields, cols.length), function(v, i) { feature[cols[i]] = v; });
    // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
    // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
    switch (o.convertChrScheme) {
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
    } else if (feature.pos === '0' || !feature.cigar || feature.cigar == '*') {
      // Unmapped read. Since we can't draw these at all, we don't bother parsing them further.
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.pos);  // POS is 1-based, hence no increment as for parsing BED
      feature.desc = feature.qname + ' at ' + feature.rname + ':' + feature.pos;
      this.type('bam').parseFlags.call(this, feature, lineno);
      feature.strand = feature.flags.readStrandReverse ? '-' : '+';
      this.type('bam').parseCigar.call(this, feature, lineno);
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
      _.each(interval.data.blocks, function(block) {
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
  
  mismatches: function(start, sequence, bppp, intervals, width, lineNum) {
    var mismatches = [];
    sequence = sequence.toUpperCase();
    _.each(intervals, function(interval) {
      _.each(interval.data.blocks, function(block) {
        var line = lineNum(interval.data),
          nt, i, x;
        for (i = Math.max(block.start, start); i < Math.min(block.end, start + width * bppp); i++) {
          x = (i - start) / bppp;
          nt = (block.seq[i - block.start] || '').toUpperCase();
          if (nt && nt != sequence[i - start] && line) { mismatches.push({x: x, nt: nt, line: line}); }
        }
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
      bppp = (end - start) / width;
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
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
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, false);
        
        if (intervals.tooMany) { return callback(intervals); }

        if (!sequence) {
          // First drawing pass, with features that don't depend on sequence.
          self.type('bam').pileup.call(self, intervals, start, end);
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
          _.each(drawSpec.layout, function(lines) {
            _.each(lines, function(interval) {
              interval.insertionPts = _.map(interval.d.insertions, calcPixInterval);
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
    var content = {
        position: data.d.rname + ':' + data.d.pos, 
        "read strand": data.d.flags.readStrand ? '(-)' : '(+)',
        "map quality": data.d.mapq
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
      color = self.opts.color,
      lineGap = lineHeight > 6 ? 2 : 0,
      deletionLineWidth = 2,
      insertionCaretLineWidth = lineHeight > 6 ? 2 : 1,
      halfHeight = Math.round(0.5 * lineHeight) - deletionLineWidth * 0.5;
    
    // Draw the line that shows the full alignment, including deletions
    ctx.fillStyle = ctx.strokeStyle = 'rgb(0,0,0)';
    // Note that the "- 1" below fixes rounding issues but gambles on there never being a deletion at the right edge
    ctx.fillRect(data.pInt.x, i * lineHeight + halfHeight, data.pInt.w - 1, deletionLineWidth);
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
    ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
    
    // Draw the [mis]match (M/X/=) blocks
    _.each(data.blockInts, function(bInt, blockNum) {
      var blockY = i * lineHeight + lineGap/2,
        blockHeight = lineHeight - lineGap;
      
      // Skip drawing blocks that aren't inside the canvas
      if (bInt.x + bInt.w < 0 || bInt.x > width) { return; }
      
      if (blockNum == 0 && data.d.strand == '-' && !bInt.oPrev) {
        ctx.fillRect(bInt.x + 2, blockY, bInt.w - 2, blockHeight);
        self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x, blockY, blockHeight, -1, lineHeight > 6);
      } else if (blockNum == data.blockInts.length - 1 && data.d.strand == '+' && !bInt.oNext) {
        ctx.fillRect(bInt.x, blockY, bInt.w - 2, blockHeight);
        self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x + bInt.w, blockY, blockHeight, 1, lineHeight > 6);
      } else {
        ctx.fillRect(bInt.x, blockY, bInt.w, blockHeight);
      }
    });
    
    // Draw insertions
    ctx.fillStyle = ctx.strokeStyle = "rgb(114,41,218)";
    _.each(data.insertionPts, function(insert) {
      if (insert.x + insert.w < 0 || insert.x > width) { return; }
      ctx.fillRect(insert.x - 1, i * lineHeight, 2, lineHeight);
      ctx.fillRect(insert.x - 2, i * lineHeight, 4, insertionCaretLineWidth);
      ctx.fillRect(insert.x - 2, (i + 1) * lineHeight - insertionCaretLineWidth, 4, insertionCaretLineWidth);
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
            // TODO: implement special drawing of alignment features, for BAMs.
            self.type('bam').drawAlignment.call(self, ctx, drawSpec.width, data, i, lineHeight);              
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
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
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
        if (lines[ln].conflict(pInt.tx, pInt.tw)) { /*throw "Unresolvable LineMask conflict!";*/ }
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
  if (this.intervalHash[id]) {
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
  //try {
    _insert.call(this, this.root, itvl);
  //} catch (e) {
  //  if (e instanceof RangeError) { console.log (data); }
  //}
};


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

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * Wraps two of Shin Suzuki's IntervalTrees to store intervals that *may*
 * be paired.
 *
 * @see IntervalTree()
 **/
function PairedIntervalTree(center, options) {
  this.unpaired = new IntervalTree(center, options);
  this.paired = new IntervalTree(center, options);
}


/**
 * public methods
 **/


/**
 * add new range
 **/
PairedIntervalTree.prototype.add = function(data, id) {
  // TODO: add to each of this.paired and this.unpaired.
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
PairedIntervalTree.prototype.addIfNew = function(data, id) {
  // TODO: add to each of this.paired and this.unpaired.
  this.unpaired.addIfNew(data, id);
}


/**
 * search
 *
 * @param (integer) val:
 * @return (array)
 **/
PairedIntervalTree.prototype.search = function(val1, val2, paired) {
  console.log(paired);
  return this.unpaired.search(val1, val2);
};


/**
 * remove: unimplemented for now
 **/
PairedIntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};


exports.PairedIntervalTree = PairedIntervalTree;

})(module && module.exports || this);
},{"./IntervalTree.js":17}],20:[function(require,module,exports){
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
// `extraArg` is an *optional* parameter that is passed along to the `.search()` function of the cache.
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
      self.callbacks.push({start: start, end: end, extraArg: extraArg, callback: callback}); 
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
    var pInt = {
      x: Math.round((d[startkey] - start) / bppp),
      w: Math.round((d[endkey] - d[startkey]) / bppp) + 1,
      t: 0,          // calculated width of text
      oPrev: false,  // overflows into previous tile?
      oNext: false   // overflows into next tile?
    };
    pInt.tx = pInt.x;
    pInt.tw = pInt.w;
    if (pInt.x < 0) { pInt.w += pInt.x; pInt.x = 0; pInt.oPrev = true; }
    else if (withText) { 
      pInt.t = Math.min(nameFunc(d).length * 10 + 2, pInt.x);
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
},{}],23:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5VkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4UUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNoVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzNRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbUdlbm9tZSByZXByZXNlbnRzIGEgZ2Vub21lIHNwZWNpZmljYXRpb24gdGhhdCBjYW4gcHJvZHVjZSBvcHRpb25zIGZvciAkLnVpLmdlbm9icm93c2VyID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMnKSxcbiAgZGVlcENsb25lID0gdXRpbHMuZGVlcENsb25lLFxuICBsb2cxMCA9IHV0aWxzLmxvZzEwLFxuICByb3VuZFRvUGxhY2VzID0gdXRpbHMucm91bmRUb1BsYWNlcztcblxuZnVuY3Rpb24gQ3VzdG9tR2Vub21lKGdpdmVuRm9ybWF0LCBtZXRhZGF0YSkgeyAgICBcbiAgLy8gZ2l2ZW5Gb3JtYXQgPSBmYWxzZSAtLT4gdGhpcyBpcyBhbiBlbXB0eSBDdXN0b21HZW5vbWUgdGhhdCB3aWxsIGJlIGh5ZHJhdGVkIHdpdGggdmFsdWVzIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdFxuICBpZiAoZ2l2ZW5Gb3JtYXQgPT09IGZhbHNlKSB7IHJldHVybjsgfSBcbiAgXG4gIHRoaXMuX3BhcnNlZCA9IGZhbHNlO1xuICB0aGlzLl9mb3JtYXQgPSAoZ2l2ZW5Gb3JtYXQgJiYgZ2l2ZW5Gb3JtYXQudG9Mb3dlckNhc2UoKSkgfHwgXCJjaHJvbXNpemVzXCI7XG4gIHZhciBmb3JtYXQgPSB0aGlzLmZvcm1hdCgpO1xuICBpZiAoZm9ybWF0ID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGdlbm9tZSBmb3JtYXQgJ1wiK2Zvcm1hdCtcIicgZW5jb3VudGVyZWRcIik7IH1cbiAgXG4gIC8vIHRoaXMub3B0cyBob2xkcyBldmVyeXRoaW5nIHRoYXQgJC51aS5nZW5vYnJvd3NlciB3aWxsIG5lZWQgdG8gY29uc3RydWN0IGEgdmlldyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBiZWxvdylcbiAgLy8gaXQgRE9FUyBOT1QgcmVsYXRlIHRvIFwib3B0aW9uc1wiIGZvciBwYXJzaW5nLCBvciBob3cgdGhlIGdlbm9tZSBpcyBiZWluZyBpbnRlcnByZXRlZCwgb3IgYW55dGhpbmcgbGlrZSB0aGF0XG4gIHRoaXMub3B0cyA9IF8uZXh0ZW5kKHt9LCBkZWVwQ2xvbmUodGhpcy5jb25zdHJ1Y3Rvci5kZWZhdWx0cyksIGRlZXBDbG9uZShmb3JtYXQuZGVmYXVsdHMgfHwge30pKTtcbiAgXG4gIC8vIHRoaXMubWV0YWRhdGEgaG9sZHMgaW5mb3JtYXRpb24gZXh0ZXJuYWwgdG8gdGhlIHBhcnNlZCB0ZXh0IHBhc3NlZCBpbiBmcm9tIHRoZSBicm93c2VyIChlLmcuIGZpbGVuYW1lLCBzb3VyY2UpXG4gIHRoaXMubWV0YWRhdGEgPSBtZXRhZGF0YTtcbiAgXG4gIC8vIHRoaXMuZGF0YSBob2xkcyBhbnl0aGluZyBhZGRpdGlvbmFsbHkgcGFyc2VkIGZyb20gdGhlIGdlbm9tZSBmaWxlIChtZXRhZGF0YSwgcmVmZXJlbmNlcywgZXRjLilcbiAgLy8gdHlwaWNhbGx5IHRoaXMgaXMgYXJyYW5nZWQgcGVyIGNvbnRpZywgaW4gdGhlIGFycmFuZ2VtZW50IG9mIHRoaXMuZGF0YS5jb250aWdzW2ldLiAuLi5cbiAgdGhpcy5kYXRhID0ge1xuICAgIHNlcXVlbmNlOiBcIlwiIC8vIHRoZSBmdWxsIGNvbmNhdGVuYXRlZCBzZXF1ZW5jZSBmb3IgYWxsIGNvbnRpZ3MgaW4gdGhpcyBnZW5vbWUsIGlmIGF2YWlsYWJsZVxuICB9O1xuICBcbiAgLy8gY2FuIHdlIGNhbGwgLmdldFNlcXVlbmNlIG9uIHRoaXMgQ3VzdG9tR2Vub21lP1xuICB0aGlzLmNhbkdldFNlcXVlbmNlID0gZmFsc2U7XG4gIFxuICBpZihmb3JtYXQuaW5pdCkgeyBmb3JtYXQuaW5pdC5jYWxsKHRoaXMpOyB9XG59XG5cbkN1c3RvbUdlbm9tZS5kZWZhdWx0cyA9IHtcbiAgLy8gVGhlIGZvbGxvd2luZyBrZXlzIHNob3VsZCBiZSBvdmVycmlkZGVuIHdoaWxlIHBhcnNpbmcgdGhlIGdlbm9tZSBmaWxlXG4gIGdlbm9tZTogJ19ibGFuaycsXG4gIHNwZWNpZXM6ICdCbGFuayBHZW5vbWUnLFxuICBhc3NlbWJseURhdGU6ICcnLFxuICB0aWxlRGlyOiBudWxsLFxuICBvdmVyem9vbUJwcHBzOiBbXSxcbiAgbnRzQmVsb3c6IFsxLCAwLjFdLFxuICBhdmFpbFRyYWNrczogW1xuICAgIHtcbiAgICAgIGZoOiB7fSwgICAgICAgIC8vIFwiZml4ZWQgaGVpZ2h0c1wiIGFib3ZlIHdoaWNoIGEgZGVuc2l0eSBpcyBmb3JjZWQgdG8gZGlzcGxheSBhYm92ZSBhIGNlcnRhaW4gdHJhY2sgaGVpZ2h0XG4gICAgICAgICAgICAgICAgICAgICAvLyAgICBmb3JtYXR0ZWQgbGlrZSB7XCIxLjAwZSswNVwiOntcImRlbnNlXCI6MTV9fVxuICAgICAgbjogXCJydWxlclwiLCAgICAvLyBzaG9ydCB1bmlxdWUgbmFtZSBmb3IgdGhlIHRyYWNrXG4gICAgICBzOiBbXCJkZW5zZVwiXSwgIC8vIHBvc3NpYmxlIGRlbnNpdGllcyBmb3IgdGlsZXMsIGUuZy4gW1wiZGVuc2VcIiwgXCJzcXVpc2hcIiwgXCJwYWNrXCJdXG4gICAgICBoOiAyNSAgICAgICAgICAvLyBzdGFydGluZyBoZWlnaHQgaW4gcHhcbiAgICB9XG4gIF0sXG4gIGdlbm9tZVNpemU6IDAsXG4gIGNockxlbmd0aHM6IHt9LFxuICBjaHJPcmRlcjogW10sXG4gIGNockJhbmRzOiBudWxsLFxuICB0aWxlV2lkdGg6IDEwMDAsXG4gIHN1YmRpckZvckJwcHBzVW5kZXI6IDMzMCxcbiAgaWRlb2dyYW1zQWJvdmU6IDEwMDAsXG4gIG1heE50UmVxdWVzdDogMjAwMDAsXG4gIHRyYWNrczogW3tuOiBcInJ1bGVyXCJ9XSxcbiAgdHJhY2tEZXNjOiB7XG4gICAgcnVsZXI6IHtcbiAgICAgIGNhdDogXCJNYXBwaW5nIGFuZCBTZXF1ZW5jaW5nIFRyYWNrc1wiLFxuICAgICAgc206IFwiQmFzZSBQb3NpdGlvblwiXG4gICAgfVxuICB9LFxuICAvLyBUaGVzZSBsYXN0IHRocmVlIHdpbGwgYmUgb3ZlcnJpZGRlbiB1c2luZyBrbm93bGVkZ2Ugb2YgdGhlIHdpbmRvdydzIHdpZHRoXG4gIGJwcHBzOiBbXSxcbiAgYnBwcE51bWJlcnNCZWxvdzogW10sXG4gIGluaXRab29tOiBudWxsXG59O1xuXG5DdXN0b21HZW5vbWUuZm9ybWF0cyA9IHtcbiAgY2hyb21zaXplczogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzJyksXG4gIGZhc3RhOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzJyksXG4gIGdlbmJhbms6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvZ2VuYmFuay5qcycpLFxuICBlbWJsOiBudWxsIC8vIFRPRE8uIEJhc2ljYWxseSBnZW5iYW5rIHdpdGggZXh0cmEgY29sdW1ucy5cbn1cblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5wYXJzZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvcm1hdCgpLnBhcnNlLmFwcGx5KHRoaXMsIF8udG9BcnJheShhcmd1bWVudHMpKTtcbiAgdGhpcy5zZXRHZW5vbWVTdHJpbmcoKTtcbiAgdGhpcy5fcGFyc2VkID0gdHJ1ZTtcbn07XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZm9ybWF0ID0gZnVuY3Rpb24oZm9ybWF0KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKF8uaXNVbmRlZmluZWQoZm9ybWF0KSkgeyBmb3JtYXQgPSBzZWxmLl9mb3JtYXQ7IH1cbiAgdmFyIEZvcm1hdFdyYXBwZXIgPSBmdW5jdGlvbigpIHsgXy5leHRlbmQodGhpcywgc2VsZi5jb25zdHJ1Y3Rvci5mb3JtYXRzW2Zvcm1hdF0pOyByZXR1cm4gdGhpczsgfTtcbiAgRm9ybWF0V3JhcHBlci5wcm90b3R5cGUgPSBzZWxmO1xuICByZXR1cm4gbmV3IEZvcm1hdFdyYXBwZXIoKTtcbn07XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuc2V0R2Vub21lU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzZWxmID0gdGhpcyxcbiAgICBvID0gc2VsZi5vcHRzLFxuICAgIGV4Y2VwdGlvbnMgPSBbJ2ZpbGUnLCAnaWdiJywgJ2FjYycsICd1cmwnLCAndWNzYyddLFxuICAgIGV4Y2VwdGlvbiA9IF8uZmluZChleGNlcHRpb25zLCBmdW5jdGlvbih2KSB7IHJldHVybiAhXy5pc1VuZGVmaW5lZChzZWxmLm1ldGFkYXRhW3ZdKTsgfSksXG4gICAgcGllY2VzID0gW107XG4gIGlmIChleGNlcHRpb24pIHsgby5nZW5vbWUgPSBleGNlcHRpb24gKyBcIjpcIiArIHNlbGYubWV0YWRhdGFbZXhjZXB0aW9uXTsgfVxuICBlbHNlIHtcbiAgICBwaWVjZXMgPSBbJ2N1c3RvbScgKyAoc2VsZi5tZXRhZGF0YS5uYW1lID8gJzonICsgc2VsZi5tZXRhZGF0YS5uYW1lIDogJycpXTtcbiAgICBfLmVhY2goby5jaHJPcmRlciwgZnVuY3Rpb24oY2hyKSB7XG4gICAgICBwaWVjZXMucHVzaChjaHIgKyAnOicgKyBvLmNockxlbmd0aHNbY2hyXSk7XG4gICAgfSk7XG4gICAgby5nZW5vbWUgPSBwaWVjZXMuam9pbignfCcpO1xuICB9XG59O1xuXG4vLyBTb21lIG9mIHRoZSBvcHRpb25zIGZvciAkLnVpLmdlbm9icm93c2VyIChhbGwgci90IHpvb20gbGV2ZWxzKSBtdXN0IGJlIHNldCBiYXNlZCBvbiB0aGUgd2lkdGggb2YgdGhlIHdpbmRvd1xuLy8gICBUaGV5IGFyZSAuYnBwcHMsIC5icHBwTnVtYmVyc0JlbG93LCBhbmQgLmluaXRab29tXG4vLyAgIFRoZXkgZG8gbm90IGFmZmVjdCBhbnkgb2YgdGhlIG90aGVyIG9wdGlvbnMgc2V0IGR1cmluZyBwYXJzaW5nLlxuLy9cbi8vIHdpbmRvd09wdHMgTVVTVCBpbmNsdWRlIGEgcHJvcGVydHksIC53aWR0aCwgdGhhdCBpcyB0aGUgd2luZG93LmlubmVyV2lkdGhcbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuc2V0QnBwcHMgPSBmdW5jdGlvbih3aW5kb3dPcHRzKSB7XG4gIHdpbmRvd09wdHMgPSB3aW5kb3dPcHRzIHx8IHt9O1xuICBcbiAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgd2luZG93V2lkdGggPSAod2luZG93T3B0cy53aWR0aCAqIDAuNikgfHwgMTAwMCxcbiAgICBicHBwID0gTWF0aC5yb3VuZChvLmdlbm9tZVNpemUgLyB3aW5kb3dXaWR0aCksXG4gICAgbG93ZXN0QnBwcCA9IHdpbmRvd09wdHMubG93ZXN0QnBwcCB8fCAwLjEsXG4gICAgbWF4QnBwcHMgPSAxMDAsXG4gICAgYnBwcHMgPSBbXSwgaSA9IDAsIGxvZztcbiAgXG4gIC8vIGNvbXBhcmFibGUgdG8gcGFydCBvZiBVQ1NDQ2xpZW50I21ha2VfY29uZmlnIGluIGxpYi91Y3NjX3N0aXRjaC5yYlxuICB3aGlsZSAoYnBwcCA+PSBsb3dlc3RCcHBwICYmIGkgPCBtYXhCcHBwcykge1xuICAgIGJwcHBzLnB1c2goYnBwcCk7XG4gICAgbG9nID0gcm91bmRUb1BsYWNlcyhsb2cxMChicHBwKSwgNCk7XG4gICAgYnBwcCA9IChNYXRoLmNlaWwobG9nKSAtIGxvZyA8IDAuNDgxKSA/IDMuMyAqIE1hdGgucG93KDEwLCBNYXRoLmNlaWwobG9nKSAtIDEpIDogTWF0aC5wb3coMTAsIE1hdGguZmxvb3IobG9nKSk7XG4gICAgaSsrO1xuICB9XG4gIG8uYnBwcHMgPSBicHBwcztcbiAgby5icHBwTnVtYmVyc0JlbG93ID0gYnBwcHMuc2xpY2UoMCwgMik7XG4gIG8uaW5pdFpvb20gPSBicHBwc1swXTtcbn07XG5cbi8vIENvbnN0cnVjdCBhIGNvbXBsZXRlIGNvbmZpZ3VyYXRpb24gZm9yICQudWkuZ2Vub2Jyb3dzZXIgYmFzZWQgb24gdGhlIGluZm9ybWF0aW9uIHBhcnNlZCBmcm9tIHRoZSBnZW5vbWUgZmlsZVxuLy8gd2hpY2ggc2hvdWxkIGJlIG1vc3RseSBpbiB0aGlzLm9wdHMsIGV4Y2VwdGluZyB0aG9zZSByZWxhdGVkIHRvIHpvb20gbGV2ZWxzLCB3aGljaCBjYW4gYmUgc2V0IG5vdy5cbi8vIChzZWUgQ3VzdG9tR2Vub21lLmRlZmF1bHRzIGFib3ZlIGZvciB3aGF0IGEgYmFzZSBjb25maWd1cmF0aW9uIGxvb2tzIGxpa2UpXG4vL1xuLy8gd2luZG93T3B0cyBNVVNUIGluY2x1ZGUgaW5jbHVkZSB0aGUgcHJvcGVydHkgLndpZHRoIHdoaWNoIGlzIHRoZSB3aW5kb3cuaW5uZXJXaWR0aFxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5vcHRpb25zID0gZnVuY3Rpb24od2luZG93T3B0cykge1xuICBpZiAoIXRoaXMuX3BhcnNlZCkgeyB0aHJvdyBcIkNhbm5vdCBnZW5lcmF0ZSBvcHRpb25zIGJlZm9yZSBwYXJzaW5nIHRoZSBnZW5vbWUgZmlsZVwiOyB9XG4gIHRoaXMuc2V0QnBwcHMod2luZG93T3B0cyk7XG4gIHRoaXMub3B0cy5jdXN0b20gPSB0aGlzOyAgIC8vIHNhbWUgY29udmVudGlvbiBhcyBjdXN0b20gdHJhY2tzIGluIHNlbGYuYXZhaWxUcmFja3MgaW4gY2hyb21vem9vbS5qc1xuICByZXR1cm4gdGhpcy5vcHRzO1xufTtcblxuLy8gRmV0Y2ggdGhlIHNlcXVlbmNlLCBpZiBhdmFpbGFibGUsIGJldHdlZW4gbGVmdCBhbmQgcmlnaHQsIGFuZCBvcHRpb25hbGx5IHBhc3MgaXQgdG8gdGhlIGNhbGxiYWNrLlxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5nZXRTZXF1ZW5jZSA9IGZ1bmN0aW9uKGxlZnQsIHJpZ2h0LCBjYWxsYmFjaykge1xuICB2YXIgc2VxID0gdGhpcy5kYXRhLnNlcXVlbmNlLnN1YnN0cmluZyhsZWZ0IC0gMSwgcmlnaHQgLSAxKTtcbiAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhzZXEpIDogc2VxOyBcbn07XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2VBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tR2Vub21lcy5hc3luYyh0aGlzLCAnZ2V0U2VxdWVuY2UnLCBhcmd1bWVudHMsIFt0aGlzLmlkXSk7XG59O1xuXG5yZXR1cm4gQ3VzdG9tR2Vub21lO1xuXG59OyIsInZhciBnbG9iYWwgPSBzZWxmOyAgLy8gZ3JhYiBnbG9iYWwgc2NvbGUgZm9yIFdlYiBXb3JrZXJzXG5yZXF1aXJlKCcuL2pxdWVyeS5ub2RvbS5taW4uanMnKShnbG9iYWwpO1xuZ2xvYmFsLl8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xucmVxdWlyZSgnLi9DdXN0b21HZW5vbWVzLmpzJykoZ2xvYmFsKTtcblxuaWYgKCFnbG9iYWwuY29uc29sZSB8fCAhZ2xvYmFsLmNvbnNvbGUubG9nKSB7XG4gIGdsb2JhbC5jb25zb2xlID0gZ2xvYmFsLmNvbnNvbGUgfHwge307XG4gIGdsb2JhbC5jb25zb2xlLmxvZyA9IGZ1bmN0aW9uKCkge1xuICAgIGdsb2JhbC5wb3N0TWVzc2FnZSh7bG9nOiBKU09OLnN0cmluZ2lmeShfLnRvQXJyYXkoYXJndW1lbnRzKSl9KTtcbiAgfTtcbn1cblxudmFyIEN1c3RvbUdlbm9tZVdvcmtlciA9IHtcbiAgX2dlbm9tZXM6IFtdLFxuICBfdGhyb3dFcnJvcnM6IGZhbHNlLFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCwgbWV0YWRhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWUgPSBDdXN0b21HZW5vbWVzLnBhcnNlKHRleHQsIG1ldGFkYXRhKSxcbiAgICAgIHNlcmlhbGl6YWJsZTtcbiAgICBcbiAgICAvLyB3ZSB3YW50IHRvIGtlZXAgdGhlIGdlbm9tZSBvYmplY3QgaW4gb3VyIHByaXZhdGUgc3RvcmUsIGFuZCBkZWxldGUgdGhlIGRhdGEgZnJvbSB0aGUgY29weSB0aGF0XG4gICAgLy8gaXMgc2VudCBiYWNrIG92ZXIgdGhlIGZlbmNlLCBzaW5jZSBpdCBpcyBleHBlbnNpdmUvaW1wb3NzaWJsZSB0byBzZXJpYWxpemVcbiAgICBnZW5vbWUuaWQgPSBzZWxmLl9nZW5vbWVzLnB1c2goZ2Vub21lKSAtIDE7XG4gICAgXG4gICAgc2VyaWFsaXphYmxlID0gXy5leHRlbmQoe30sIGdlbm9tZSk7XG4gICAgZGVsZXRlIHNlcmlhbGl6YWJsZS5kYXRhO1xuICAgIHJldHVybiBzZXJpYWxpemFibGU7XG4gIH0sXG4gIG9wdGlvbnM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICBnZW5vbWUgPSB0aGlzLl9nZW5vbWVzW2lkXTtcbiAgICByZXR1cm4gZ2Vub21lLm9wdGlvbnMuYXBwbHkoZ2Vub21lLCBfLnJlc3QoYXJncykpO1xuICB9LFxuICBnZXRTZXF1ZW5jZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBfLnRvQXJyYXkoYXJndW1lbnRzKSxcbiAgICAgIGlkID0gXy5maXJzdChhcmdzKSxcbiAgICAgIGdlbm9tZSA9IHRoaXMuX2dlbm9tZXNbaWRdO1xuICAgIHJldHVybiBnZW5vbWUuZ2V0U2VxdWVuY2UuYXBwbHkoZ2Vub21lLCBfLnJlc3QoYXJncykpO1xuICB9LFxuICB0aHJvd0Vycm9yczogZnVuY3Rpb24odG9nZ2xlKSB7XG4gICAgdGhpcy5fdGhyb3dFcnJvcnMgPSB0b2dnbGU7XG4gIH1cbn07XG5cbmdsb2JhbC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICB2YXIgZGF0YSA9IGUuZGF0YSxcbiAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKHIpIHsgZ2xvYmFsLnBvc3RNZXNzYWdlKHtpZDogZGF0YS5pZCwgcmV0OiBKU09OLnN0cmluZ2lmeShyIHx8IG51bGwpfSk7IH0sXG4gICAgcmV0O1xuXG4gIGlmIChDdXN0b21HZW5vbWVXb3JrZXIuX3Rocm93RXJyb3JzKSB7XG4gICAgcmV0ID0gQ3VzdG9tR2Vub21lV29ya2VyW2RhdGEub3BdLmFwcGx5KEN1c3RvbUdlbm9tZVdvcmtlciwgZGF0YS5hcmdzLmNvbmNhdChjYWxsYmFjaykpO1xuICB9IGVsc2Uge1xuICAgIHRyeSB7IHJldCA9IEN1c3RvbUdlbm9tZVdvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21HZW5vbWVXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTsgfSBcbiAgICBjYXRjaCAoZXJyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIGVycm9yOiBKU09OLnN0cmluZ2lmeSh7bWVzc2FnZTogZXJyLm1lc3NhZ2V9KX0pOyB9XG4gIH1cbiAgXG4gIGlmICghXy5pc1VuZGVmaW5lZChyZXQpKSB7IGNhbGxiYWNrKHJldCk7IH1cbn0pOyIsIm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uKGdsb2JhbCl7XG4gIFxuICB2YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG4gIGlmICghZ2xvYmFsLkN1c3RvbVRyYWNrcykgeyByZXF1aXJlKCcuL0N1c3RvbVRyYWNrcy5qcycpKGdsb2JhbCk7IH1cbiAgXG4gIC8vIFRoZSBjbGFzcyB0aGF0IHJlcHJlc2VudHMgYSBzaW5ndWxhciBjdXN0b20gZ2Vub21lIG9iamVjdFxuICB2YXIgQ3VzdG9tR2Vub21lID0gcmVxdWlyZSgnLi9DdXN0b21HZW5vbWUnKShnbG9iYWwpO1xuICBcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyA9IEN1c3RvbUdlbm9tZXMsIHRoZSBtb2R1bGUgZXhwb3J0ZWQgdG8gdGhlIGdsb2JhbCBlbnZpcm9ubWVudCA9XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8gQnJvYWRseSBzcGVha2luZyB0aGlzIGlzIGEgZmFjdG9yeSBmb3IgQ3VzdG9tR2Vub21lIG9iamVjdHMgdGhhdCBjYW4gZGVsZWdhdGUgdGhlXG4gIC8vIHdvcmsgb2YgcGFyc2luZyB0byBhIFdlYiBXb3JrZXIgdGhyZWFkLlxuICBcbiAgdmFyIEN1c3RvbUdlbm9tZXMgPSB7XG4gICAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIG1ldGFkYXRhKSB7XG4gICAgICBtZXRhZGF0YSA9IG1ldGFkYXRhIHx8IHt9O1xuICAgICAgaWYgKCFtZXRhZGF0YS5mb3JtYXQpIHsgbWV0YWRhdGEuZm9ybWF0ID0gdGhpcy5ndWVzc0Zvcm1hdCh0ZXh0KTsgfVxuICAgICAgdmFyIGdlbm9tZSA9IG5ldyBDdXN0b21HZW5vbWUobWV0YWRhdGEuZm9ybWF0LCBtZXRhZGF0YSk7XG4gICAgICBnZW5vbWUucGFyc2UodGV4dCk7XG4gICAgICByZXR1cm4gZ2Vub21lO1xuICAgIH0sXG4gICAgXG4gICAgYmxhbms6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGdlbm9tZSA9IG5ldyBDdXN0b21HZW5vbWUoXCJjaHJvbXNpemVzXCIsIHtzcGVjaWVzOiBcIkJsYW5rIEdlbm9tZVwifSk7XG4gICAgICBnZW5vbWUucGFyc2UoXCJibGFua1xcdDUwMDAwXCIpO1xuICAgICAgcmV0dXJuIGdlbm9tZTtcbiAgICB9LFxuICAgIFxuICAgIGd1ZXNzRm9ybWF0OiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgICBpZiAodGV4dC5zdWJzdHJpbmcoMCwgNSkgPT0gJ0xPQ1VTJykgeyByZXR1cm4gXCJnZW5iYW5rXCI7IH1cbiAgICAgIGlmICgvXltBLVpdezJ9IHszfS8udGVzdCh0ZXh0KSkgeyByZXR1cm4gXCJlbWJsXCI7IH1cbiAgICAgIGlmICgvXls+O10vLnRlc3QodGV4dCkpIHsgcmV0dXJuIFwiZmFzdGFcIjsgfVxuICAgICAgLy8gZGVmYXVsdCBpcyBmYXN0YVxuICAgICAgcmV0dXJuIFwiZmFzdGFcIjtcbiAgICB9LFxuICAgIFxuICAgIGVycm9yOiBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBDYW4gYmUgb3ZlcnJpZGRlbiBieSBhIHBhcmVudCBsaWJyYXJ5IHRvIGhhbmRsZSBlcnJvcnMgbW9yZSBncmFjZWZ1bGx5LlxuICAgICAgY29uc29sZS5sb2coZSk7XG4gICAgfSxcbiAgICBcbiAgICBfd29ya2VyU2NyaXB0OiAnYnVpbGQvQ3VzdG9tR2Vub21lV29ya2VyLmpzJyxcbiAgICBfZGlzYWJsZVdvcmtlcnM6IGZhbHNlLFxuICAgIHdvcmtlcjogZ2xvYmFsLkN1c3RvbVRyYWNrcy53b3JrZXIsXG4gICAgXG4gICAgYXN5bmM6IGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmMsXG4gICAgXG4gICAgcGFyc2VBc3luYzogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmFzeW5jKHRoaXMsICdwYXJzZScsIGFyZ3VtZW50cywgW10sIGZ1bmN0aW9uKGdlbm9tZSkge1xuICAgICAgICAvLyBUaGlzIGhhcyBiZWVuIHNlcmlhbGl6ZWQsIHNvIGl0IG11c3QgYmUgaHlkcmF0ZWQgaW50byBhIHJlYWwgQ3VzdG9tR2Vub21lIG9iamVjdC5cbiAgICAgICAgLy8gV2UgcmVwbGFjZSAuZ2V0U2VxdWVuY2UoKSB3aXRoIGFuIGFzeW5jaHJvbm91cyB2ZXJzaW9uLlxuICAgICAgICByZXR1cm4gXy5leHRlbmQobmV3IEN1c3RvbUdlbm9tZShmYWxzZSksIGdlbm9tZSwge1xuICAgICAgICAgIGdldFNlcXVlbmNlOiBmdW5jdGlvbigpIHsgQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5nZXRTZXF1ZW5jZUFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG4gIFxuICBnbG9iYWwuQ3VzdG9tR2Vub21lcyA9IEN1c3RvbUdlbm9tZXM7XG4gIFxufSk7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQ3VzdG9tVHJhY2ssIGFuIG9iamVjdCByZXByZXNlbnRpbmcgYSBjdXN0b20gdHJhY2sgYXMgdW5kZXJzdG9vZCBieSBVQ1NDLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIFRoaXMgY2xhc3MgKmRvZXMqIGRlcGVuZCBvbiBnbG9iYWwgb2JqZWN0cyBhbmQgdGhlcmVmb3JlIG11c3QgYmUgcmVxdWlyZWQgYXMgYSBcbi8vIGZ1bmN0aW9uIHRoYXQgaXMgZXhlY3V0ZWQgb24gdGhlIGdsb2JhbCBvYmplY3QuXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKSB7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuZnVuY3Rpb24gQ3VzdG9tVHJhY2sob3B0cywgYnJvd3Nlck9wdHMpIHtcbiAgaWYgKCFvcHRzKSB7IHJldHVybjsgfSAvLyBUaGlzIGlzIGFuIGVtcHR5IGN1c3RvbVRyYWNrIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgdGhpcy5fdHlwZSA9IChvcHRzLnR5cGUgJiYgb3B0cy50eXBlLnRvTG93ZXJDYXNlKCkpIHx8IFwiYmVkXCI7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmICh0eXBlID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIHRyYWNrIHR5cGUgJ1wiK29wdHMudHlwZStcIicgZW5jb3VudGVyZWQgb24gbGluZSBcIiArIG9wdHMubGluZU51bSk7IH1cbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMsIHR5cGUuZGVmYXVsdHMgfHwge30sIG9wdHMpO1xuICBfLmV4dGVuZCh0aGlzLCB7XG4gICAgYnJvd3Nlck9wdHM6IGJyb3dzZXJPcHRzLFxuICAgIHN0cmV0Y2hIZWlnaHQ6IGZhbHNlLFxuICAgIGhlaWdodHM6IHt9LFxuICAgIHNpemVzOiBbJ2RlbnNlJ10sXG4gICAgbWFwU2l6ZXM6IFtdLFxuICAgIGFyZWFzOiB7fSxcbiAgICBub0FyZWFMYWJlbHM6IGZhbHNlLFxuICAgIGV4cGVjdHNTZXF1ZW5jZTogZmFsc2VcbiAgfSk7XG4gIHRoaXMuaW5pdCgpO1xufVxuXG5DdXN0b21UcmFjay5kZWZhdWx0cyA9IHtcbiAgbmFtZTogJ1VzZXIgVHJhY2snLFxuICBkZXNjcmlwdGlvbjogJ1VzZXIgU3VwcGxpZWQgVHJhY2snLFxuICBjb2xvcjogJzAsMCwwJ1xufTtcblxuQ3VzdG9tVHJhY2sudHlwZXMgPSB7XG4gIGJlZDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iZWQuanMnKSxcbiAgZmVhdHVyZXRhYmxlOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2ZlYXR1cmV0YWJsZS5qcycpLFxuICBiZWRncmFwaDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iZWRncmFwaC5qcycpLFxuICB3aWdnbGVfMDogcmVxdWlyZSgnLi90cmFjay10eXBlcy93aWdnbGVfMC5qcycpLFxuICB2Y2Z0YWJpeDogcmVxdWlyZSgnLi90cmFjay10eXBlcy92Y2Z0YWJpeC5qcycpLFxuICBiaWdiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnYmVkLmpzJyksXG4gIGJhbTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iYW0uanMnKSxcbiAgYmlnd2lnOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ3dpZy5qcycpXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiZWREZXRhaWwgZm9ybWF0OiBodHRwczovL2dlbm9tZS51Y3NjLmVkdS9GQVEvRkFRZm9ybWF0Lmh0bWwjZm9ybWF0MS43ID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICBcblxuQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsID0gXy5jbG9uZShDdXN0b21UcmFjay50eXBlcy5iZWQpO1xuQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsLmRlZmF1bHRzID0gXy5leHRlbmQoe30sIEN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cywge2RldGFpbDogdHJ1ZX0pO1xuXG4vLyBUaGVzZSBmdW5jdGlvbnMgYnJhbmNoIHRvIGRpZmZlcmVudCBtZXRob2RzIGRlcGVuZGluZyBvbiB0aGUgLnR5cGUoKSBvZiB0aGUgdHJhY2tcbl8uZWFjaChbJ2luaXQnLCAncGFyc2UnLCAncmVuZGVyJywgJ3JlbmRlclNlcXVlbmNlJywgJ3ByZXJlbmRlciddLCBmdW5jdGlvbihmbikge1xuICBDdXN0b21UcmFjay5wcm90b3R5cGVbZm5dID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBfLnRvQXJyYXkoYXJndW1lbnRzKSxcbiAgICAgIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgICBpZiAoIXR5cGVbZm5dKSB7IHJldHVybiBmYWxzZTsgfVxuICAgIHJldHVybiB0eXBlW2ZuXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxufSk7XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5sb2FkT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tb3B0cy1mb3JtJykuaGlkZSgpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tb3B0cy1mb3JtLicrdGhpcy5fdHlwZSkuc2hvdygpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tbmFtZScpLnRleHQoby5uYW1lKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWRlc2MnKS50ZXh0KG8uZGVzY3JpcHRpb24pO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tZm9ybWF0JykudGV4dCh0aGlzLl90eXBlKTtcbiAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoby5jb2xvcikuY2hhbmdlKCk7XG4gIGlmICh0eXBlLmxvYWRPcHRzKSB7IHR5cGUubG9hZE9wdHMuY2FsbCh0aGlzLCAkZGlhbG9nKTsgfVxuICAkZGlhbG9nLmZpbmQoJy5lbmFibGVyJykuY2hhbmdlKCk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuc2F2ZU9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgby5jb2xvciA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKCk7XG4gIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uY29sb3IpKSB7IG8uY29sb3IgPSAnMCwwLDAnOyB9XG4gIGlmICh0eXBlLnNhdmVPcHRzKSB7IHR5cGUuc2F2ZU9wdHMuY2FsbCh0aGlzLCAkZGlhbG9nKTsgfVxuICB0aGlzLmFwcGx5T3B0cygpO1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLndvcmtlcigpICYmIHRoaXMuYXBwbHlPcHRzQXN5bmMoKTsgLy8gQXBwbHkgdGhlIGNoYW5nZXMgdG8gdGhlIHdvcmtlciB0b28hXG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzID0gZnVuY3Rpb24ob3B0cykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAob3B0cykgeyB0aGlzLm9wdHMgPSBvcHRzOyB9XG4gIGlmICh0eXBlLmFwcGx5T3B0cykgeyB0eXBlLmFwcGx5T3B0cy5jYWxsKHRoaXMpOyB9XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuZXJhc2UgPSBmdW5jdGlvbihjYW52YXMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzLFxuICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICBpZiAoY3R4KSB7IGN0eC5jbGVhclJlY3QoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0KTsgfVxufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUudHlwZSA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQodHlwZSkpIHsgdHlwZSA9IHRoaXMuX3R5cGU7IH1cbiAgcmV0dXJuIHRoaXMuY29uc3RydWN0b3IudHlwZXNbdHlwZV0gfHwgbnVsbDtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS53YXJuID0gZnVuY3Rpb24od2FybmluZykge1xuICBpZiAodGhpcy5vcHRzLnN0cmljdCkge1xuICAgIHRocm93IG5ldyBFcnJvcih3YXJuaW5nKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIXRoaXMud2FybmluZ3MpIHsgdGhpcy53YXJuaW5ncyA9IFtdOyB9XG4gICAgdGhpcy53YXJuaW5ncy5wdXNoKHdhcm5pbmcpO1xuICB9XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuaXNPbiA9IGZ1bmN0aW9uKHZhbCkge1xuICByZXR1cm4gL14ob258eWVzfHRydWV8dHx5fDEpJC9pLnRlc3QodmFsLnRvU3RyaW5nKCkpO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockxpc3QgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLl9jaHJMaXN0KSB7XG4gICAgdGhpcy5fY2hyTGlzdCA9IF8uc29ydEJ5KF8ubWFwKHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLCBmdW5jdGlvbihwb3MsIGNocikgeyByZXR1cm4gW3BvcywgY2hyXTsgfSksIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHZbMF07IH0pO1xuICB9XG4gIHJldHVybiB0aGlzLl9jaHJMaXN0O1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyQXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgdmFyIGNockxpc3QgPSB0aGlzLmNockxpc3QoKSxcbiAgICBjaHJJbmRleCA9IF8uc29ydGVkSW5kZXgoY2hyTGlzdCwgW3Bvc10sIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHZbMF07IH0pLFxuICAgIGNociA9IGNockluZGV4ID4gMCA/IGNockxpc3RbY2hySW5kZXggLSAxXVsxXSA6IG51bGw7XG4gIHJldHVybiB7aTogY2hySW5kZXggLSAxLCBjOiBjaHIsIHA6IHBvcyAtIHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocl19O1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNoclJhbmdlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgY2hyTGVuZ3RocyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyTGVuZ3RocyxcbiAgICBzdGFydENociA9IHRoaXMuY2hyQXQoc3RhcnQpLFxuICAgIGVuZENociA9IHRoaXMuY2hyQXQoZW5kKSxcbiAgICByYW5nZTtcbiAgaWYgKHN0YXJ0Q2hyLmMgJiYgc3RhcnRDaHIuaSA9PT0gZW5kQ2hyLmkpIHsgcmV0dXJuIFtzdGFydENoci5jICsgJzonICsgc3RhcnRDaHIucCArICctJyArIGVuZENoci5wXTsgfVxuICBlbHNlIHtcbiAgICByYW5nZSA9IF8ubWFwKHRoaXMuY2hyTGlzdCgpLnNsaWNlKHN0YXJ0Q2hyLmkgKyAxLCBlbmRDaHIuaSksIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHJldHVybiB2WzFdICsgJzoxLScgKyBjaHJMZW5ndGhzW3ZbMV1dO1xuICAgIH0pO1xuICAgIHN0YXJ0Q2hyLmMgJiYgcmFuZ2UudW5zaGlmdChzdGFydENoci5jICsgJzonICsgc3RhcnRDaHIucCArICctJyArIGNockxlbmd0aHNbc3RhcnRDaHIuY10pO1xuICAgIGVuZENoci5jICYmIHJhbmdlLnB1c2goZW5kQ2hyLmMgKyAnOjEtJyArIGVuZENoci5wKTtcbiAgICByZXR1cm4gcmFuZ2U7XG4gIH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ3ByZXJlbmRlcicsIGFyZ3VtZW50cywgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hcHBseU9wdHNBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdhcHBseU9wdHMnLCBbdGhpcy5vcHRzLCBmdW5jdGlvbigpe31dLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFqYXhEaXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gV2ViIFdvcmtlcnMgZmV0Y2ggVVJMcyByZWxhdGl2ZSB0byB0aGUgSlMgZmlsZSBpdHNlbGYuXG4gIHJldHVybiAoZ2xvYmFsLkhUTUxEb2N1bWVudCA/ICcnIDogJy4uLycpICsgdGhpcy5icm93c2VyT3B0cy5hamF4RGlyO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnJnYlRvSHNsID0gZnVuY3Rpb24ociwgZywgYikge1xuICByIC89IDI1NSwgZyAvPSAyNTUsIGIgLz0gMjU1O1xuICB2YXIgbWF4ID0gTWF0aC5tYXgociwgZywgYiksIG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICB2YXIgaCwgcywgbCA9IChtYXggKyBtaW4pIC8gMjtcblxuICBpZiAobWF4ID09IG1pbikge1xuICAgIGggPSBzID0gMDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIHZhciBkID0gbWF4IC0gbWluO1xuICAgIHMgPSBsID4gMC41ID8gZCAvICgyIC0gbWF4IC0gbWluKSA6IGQgLyAobWF4ICsgbWluKTtcbiAgICBzd2l0Y2gobWF4KXtcbiAgICAgIGNhc2UgcjogaCA9IChnIC0gYikgLyBkICsgKGcgPCBiID8gNiA6IDApOyBicmVhaztcbiAgICAgIGNhc2UgZzogaCA9IChiIC0gcikgLyBkICsgMjsgYnJlYWs7XG4gICAgICBjYXNlIGI6IGggPSAociAtIGcpIC8gZCArIDQ7IGJyZWFrO1xuICAgIH1cbiAgICBoIC89IDY7XG4gIH1cblxuICByZXR1cm4gW2gsIHMsIGxdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuaHNsVG9SZ2IgPSBmdW5jdGlvbihoLCBzLCBsKSB7XG4gIHZhciByLCBnLCBiO1xuXG4gIGlmIChzID09IDApIHtcbiAgICByID0gZyA9IGIgPSBsOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgZnVuY3Rpb24gaHVlMnJnYihwLCBxLCB0KSB7XG4gICAgICBpZih0IDwgMCkgdCArPSAxO1xuICAgICAgaWYodCA+IDEpIHQgLT0gMTtcbiAgICAgIGlmKHQgPCAxLzYpIHJldHVybiBwICsgKHEgLSBwKSAqIDYgKiB0O1xuICAgICAgaWYodCA8IDEvMikgcmV0dXJuIHE7XG4gICAgICBpZih0IDwgMi8zKSByZXR1cm4gcCArIChxIC0gcCkgKiAoMi8zIC0gdCkgKiA2O1xuICAgICAgcmV0dXJuIHA7XG4gICAgfVxuXG4gICAgdmFyIHEgPSBsIDwgMC41ID8gbCAqICgxICsgcykgOiBsICsgcyAtIGwgKiBzO1xuICAgIHZhciBwID0gMiAqIGwgLSBxO1xuICAgIHIgPSBodWUycmdiKHAsIHEsIGggKyAxLzMpO1xuICAgIGcgPSBodWUycmdiKHAsIHEsIGgpO1xuICAgIGIgPSBodWUycmdiKHAsIHEsIGggLSAxLzMpO1xuICB9XG5cbiAgcmV0dXJuIFtyICogMjU1LCBnICogMjU1LCBiICogMjU1XTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnZhbGlkYXRlQ29sb3IgPSBmdW5jdGlvbihjb2xvcikge1xuICB2YXIgbSA9IGNvbG9yLm1hdGNoKC8oXFxkKyksKFxcZCspLChcXGQrKS8pO1xuICBpZiAoIW0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gIG0uc2hpZnQoKTtcbiAgcmV0dXJuIF8uYWxsKF8ubWFwKG0sIHBhcnNlSW50MTApLCBmdW5jdGlvbih2KSB7IHJldHVybiB2ID49MCAmJiB2IDw9IDI1NTsgfSk7XG59XG5cbnJldHVybiBDdXN0b21UcmFjaztcblxufTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBcbiAgLy8gU29tZSB1dGlsaXR5IGZ1bmN0aW9ucy5cbiAgdmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIHRyYWNrIG9iamVjdFxuICB2YXIgQ3VzdG9tVHJhY2sgPSByZXF1aXJlKCcuL0N1c3RvbVRyYWNrLmpzJykoZ2xvYmFsKTtcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21UcmFja3MsIHRoZSBtb2R1bGUgdGhhdCBpcyBleHBvcnRlZCB0byB0aGUgZ2xvYmFsIGVudmlyb25tZW50LiA9XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBCcm9hZGx5IHNwZWFraW5nIHRoaXMgaXMgYSBmYWN0b3J5IGZvciBwYXJzaW5nIGRhdGEgaW50byBDdXN0b21UcmFjayBvYmplY3RzLFxuICAvLyBhbmQgaXQgY2FuIGRlbGVnYXRlIHRoaXMgd29yayB0byBhIHdvcmtlciB0aHJlYWQuXG5cbiAgdmFyIEN1c3RvbVRyYWNrcyA9IHtcbiAgICBwYXJzZTogZnVuY3Rpb24oY2h1bmtzLCBicm93c2VyT3B0cykge1xuICAgICAgdmFyIGN1c3RvbVRyYWNrcyA9IFtdLFxuICAgICAgICBkYXRhID0gW10sXG4gICAgICAgIHRyYWNrLCBvcHRzLCBtO1xuICAgICAgXG4gICAgICBpZiAodHlwZW9mIGNodW5rcyA9PSBcInN0cmluZ1wiKSB7IGNodW5rcyA9IFtjaHVua3NdOyB9XG4gICAgICBcbiAgICAgIGZ1bmN0aW9uIHB1c2hUcmFjaygpIHtcbiAgICAgICAgaWYgKHRyYWNrLnBhcnNlKGRhdGEpKSB7IGN1c3RvbVRyYWNrcy5wdXNoKHRyYWNrKTsgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjdXN0b21UcmFja3MuYnJvd3NlciA9IHt9O1xuICAgICAgXy5lYWNoKGNodW5rcywgZnVuY3Rpb24odGV4dCkge1xuICAgICAgICBfLmVhY2godGV4dC5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICAgICAgaWYgKC9eIy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gY29tbWVudCBsaW5lXG4gICAgICAgICAgfSBlbHNlIGlmICgvXmJyb3dzZXJcXHMrLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBicm93c2VyIGxpbmVzXG4gICAgICAgICAgICBtID0gbGluZS5tYXRjaCgvXmJyb3dzZXJcXHMrKFxcdyspXFxzKyhcXFMqKS8pO1xuICAgICAgICAgICAgaWYgKCFtKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSBicm93c2VyIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyW21bMV1dID0gbVsyXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9edHJhY2tcXHMrL2kudGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICAgICAgICBvcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgKC9edHJhY2tcXHMrL2kpKTtcbiAgICAgICAgICAgIGlmICghb3B0cykgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgdHJhY2sgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgb3B0cy5saW5lTnVtID0gbGluZW5vICsgMTtcbiAgICAgICAgICAgIHRyYWNrID0gbmV3IEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKTtcbiAgICAgICAgICAgIGRhdGEgPSBbXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9cXFMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICghdHJhY2spIHsgdGhyb3cgbmV3IEVycm9yKFwiRm91bmQgZGF0YSBvbiBsaW5lIFwiKyhsaW5lbm8rMSkrXCIgYnV0IG5vIHByZWNlZGluZyB0cmFjayBkZWZpbml0aW9uXCIpOyB9XG4gICAgICAgICAgICBkYXRhLnB1c2gobGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICByZXR1cm4gY3VzdG9tVHJhY2tzO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmU6IHBhcnNlRGVjbGFyYXRpb25MaW5lLFxuICAgIFxuICAgIGVycm9yOiBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBDYW4gYmUgb3ZlcnJpZGRlbiBieSBhIHBhcmVudCBsaWJyYXJ5IHRvIGhhbmRsZSBlcnJvcnMgbW9yZSBncmFjZWZ1bGx5LlxuICAgICAgY29uc29sZS5sb2coZSk7XG4gICAgfSxcbiAgICBcbiAgICBfd29ya2VyU2NyaXB0OiAnYnVpbGQvQ3VzdG9tVHJhY2tXb3JrZXIuanMnLFxuICAgIC8vIE5PVEU6IFRvIHRlbXBvcmFyaWx5IGRpc2FibGUgV2ViIFdvcmtlciB1c2FnZSwgc2V0IHRoaXMgdG8gdHJ1ZS5cbiAgICBfZGlzYWJsZVdvcmtlcnM6IGZhbHNlLFxuICAgIFxuICAgIHdvcmtlcjogZnVuY3Rpb24oKSB7IFxuICAgICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBjYWxsYmFja3MgPSBbXTtcbiAgICAgIGlmICghc2VsZi5fd29ya2VyICYmIGdsb2JhbC5Xb3JrZXIpIHsgXG4gICAgICAgIHNlbGYuX3dvcmtlciA9IG5ldyBnbG9iYWwuV29ya2VyKHNlbGYuX3dvcmtlclNjcmlwdCk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGUpIHsgc2VsZi5lcnJvcihlKTsgfSwgZmFsc2UpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICBpZiAoZS5kYXRhLmxvZykgeyBjb25zb2xlLmxvZyhKU09OLnBhcnNlKGUuZGF0YS5sb2cpKTsgcmV0dXJuOyB9XG4gICAgICAgICAgaWYgKGUuZGF0YS5lcnJvcikge1xuICAgICAgICAgICAgaWYgKGUuZGF0YS5pZCkgeyBjYWxsYmFja3NbZS5kYXRhLmlkXSA9IG51bGw7IH1cbiAgICAgICAgICAgIHNlbGYuZXJyb3IoSlNPTi5wYXJzZShlLmRhdGEuZXJyb3IpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0oSlNPTi5wYXJzZShlLmRhdGEucmV0KSk7XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0gPSBudWxsO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmNhbGwgPSBmdW5jdGlvbihvcCwgYXJncywgY2FsbGJhY2spIHtcbiAgICAgICAgICB2YXIgaWQgPSBjYWxsYmFja3MucHVzaChjYWxsYmFjaykgLSAxO1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiBvcCwgaWQ6IGlkLCBhcmdzOiBhcmdzfSk7XG4gICAgICAgIH07XG4gICAgICAgIC8vIFRvIGhhdmUgdGhlIHdvcmtlciB0aHJvdyBlcnJvcnMgaW5zdGVhZCBvZiBwYXNzaW5nIHRoZW0gbmljZWx5IGJhY2ssIGNhbGwgdGhpcyB3aXRoIHRvZ2dsZT10cnVlXG4gICAgICAgIHNlbGYuX3dvcmtlci50aHJvd0Vycm9ycyA9IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiAndGhyb3dFcnJvcnMnLCBhcmdzOiBbdG9nZ2xlXX0pO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNlbGYuX2Rpc2FibGVXb3JrZXJzID8gbnVsbCA6IHNlbGYuX3dvcmtlcjtcbiAgICB9LFxuICAgIFxuICAgIGFzeW5jOiBmdW5jdGlvbihzZWxmLCBmbiwgYXJncywgYXN5bmNFeHRyYUFyZ3MsIHdyYXBwZXIpIHtcbiAgICAgIGFyZ3MgPSBfLnRvQXJyYXkoYXJncyk7XG4gICAgICB3cmFwcGVyID0gd3JhcHBlciB8fCBfLmlkZW50aXR5O1xuICAgICAgdmFyIGFyZ3NFeGNlcHRMYXN0T25lID0gXy5pbml0aWFsKGFyZ3MpLFxuICAgICAgICBjYWxsYmFjayA9IF8ubGFzdChhcmdzKSxcbiAgICAgICAgdyA9IHRoaXMud29ya2VyKCk7XG4gICAgICAvLyBGYWxsYmFjayBpZiB3ZWIgd29ya2VycyBhcmUgbm90IHN1cHBvcnRlZC5cbiAgICAgIC8vIFRoaXMgY291bGQgYWxzbyBiZSB0d2Vha2VkIHRvIG5vdCB1c2Ugd2ViIHdvcmtlcnMgd2hlbiB0aGVyZSB3b3VsZCBiZSBubyBwZXJmb3JtYW5jZSBnYWluO1xuICAgICAgLy8gICBhY3RpdmF0aW5nIHRoaXMgYnJhbmNoIGRpc2FibGVzIHdlYiB3b3JrZXJzIGVudGlyZWx5IGFuZCBldmVyeXRoaW5nIGhhcHBlbnMgc3luY2hyb25vdXNseS5cbiAgICAgIGlmICghdykgeyByZXR1cm4gY2FsbGJhY2soc2VsZltmbl0uYXBwbHkoc2VsZiwgYXJnc0V4Y2VwdExhc3RPbmUpKTsgfVxuICAgICAgQXJyYXkucHJvdG90eXBlLnVuc2hpZnQuYXBwbHkoYXJnc0V4Y2VwdExhc3RPbmUsIGFzeW5jRXh0cmFBcmdzKTtcbiAgICAgIHcuY2FsbChmbiwgYXJnc0V4Y2VwdExhc3RPbmUsIGZ1bmN0aW9uKHJldCkgeyBjYWxsYmFjayh3cmFwcGVyKHJldCkpOyB9KTtcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbih0cmFja3MpIHtcbiAgICAgICAgLy8gVGhlc2UgaGF2ZSBiZWVuIHNlcmlhbGl6ZWQsIHNvIHRoZXkgbXVzdCBiZSBoeWRyYXRlZCBpbnRvIHJlYWwgQ3VzdG9tVHJhY2sgb2JqZWN0cy5cbiAgICAgICAgLy8gV2UgcmVwbGFjZSAucHJlcmVuZGVyKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8ubWFwKHRyYWNrcywgZnVuY3Rpb24odCkge1xuICAgICAgICAgIHJldHVybiBfLmV4dGVuZChuZXcgQ3VzdG9tVHJhY2soKSwgdCwge1xuICAgICAgICAgICAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHsgQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcyA9IEN1c3RvbVRyYWNrcztcblxufSk7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gY2hyb20uc2l6ZXMgZm9ybWF0OiBodHRwOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvY2hyb21TaXplcyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90ZTogd2UgYXJlIGV4dGVuZGluZyB0aGUgZ2VuZXJhbCB1c2Ugb2YgdGhpcyB0byBpbmNsdWRlIGRhdGEgbG9hZGVkIGZyb20gdGhlIGdlbm9tZS50eHQgYW5kIGFubm90cy54bWxcbi8vIGZpbGVzIG9mIGFuIElHQiBxdWlja2xvYWQgZGlyZWN0b3J5LFxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICBvcHRzQXNUcmFja0xpbmUgPSB1dGlscy5vcHRzQXNUcmFja0xpbmU7XG5cbnZhciBDaHJvbVNpemVzRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgby5zcGVjaWVzID0gbS5zcGVjaWVzIHx8ICdDdXN0b20gR2Vub21lJztcbiAgICBvLmFzc2VtYmx5RGF0ZSA9IG0uYXNzZW1ibHlEYXRlIHx8ICcnO1xuICAgIFxuICAgIC8vIFRPRE86IGlmIG1ldGFkYXRhIGFsc28gY29udGFpbnMgY3VzdG9tIHRyYWNrIGRhdGEsIGUuZy4gZnJvbSBhbm5vdHMueG1sXG4gICAgLy8gbXVzdCBjb252ZXJ0IHRoZW0gaW50byBpdGVtcyBmb3Igby5hdmFpbFRyYWNrcywgby50cmFja3MsIGFuZCBvLnRyYWNrRGVzY1xuICAgIC8vIFRoZSBvLmF2YWlsVHJhY2tzIGl0ZW1zIHNob3VsZCBjb250YWluIHtjdXN0b21EYXRhOiB0cmFja2xpbmVzfSB0byBiZSBwYXJzZWRcbiAgICBpZiAobS50cmFja3MpIHsgc2VsZi5mb3JtYXQoKS5jcmVhdGVUcmFja3MobS50cmFja3MpOyB9XG4gIH0sXG4gIFxuICBjcmVhdGVUcmFja3M6IGZ1bmN0aW9uKHRyYWNrcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgICBcbiAgICBfLmVhY2godHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICB2YXIgdHJhY2tPcHRzO1xuICAgICAgdC5saW5lcyA9IHQubGluZXMgfHwgW107XG4gICAgICB0cmFja09wdHMgPSAvXnRyYWNrXFxzKy9pLnRlc3QodC5saW5lc1swXSkgPyBnbG9iYWwuQ3VzdG9tVHJhY2tzLnBhcnNlRGVjbGFyYXRpb25MaW5lKHQubGluZXMuc2hpZnQoKSkgOiB7fTtcbiAgICAgIHQubGluZXMudW5zaGlmdCgndHJhY2sgJyArIG9wdHNBc1RyYWNrTGluZShfLmV4dGVuZCh0cmFja09wdHMsIHQub3B0cywge25hbWU6IHQubmFtZSwgdHlwZTogdC50eXBlfSkpICsgJ1xcbicpO1xuICAgICAgby5hdmFpbFRyYWNrcy5wdXNoKHtcbiAgICAgICAgZmg6IHt9LFxuICAgICAgICBuOiB0Lm5hbWUsXG4gICAgICAgIHM6IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXSxcbiAgICAgICAgaDogMTUsXG4gICAgICAgIG06IFsncGFjayddLFxuICAgICAgICBjdXN0b21EYXRhOiB0LmxpbmVzXG4gICAgICB9KTtcbiAgICAgIG8udHJhY2tzLnB1c2goe246IHQubmFtZX0pO1xuICAgICAgby50cmFja0Rlc2NbdC5uYW1lXSA9IHtcbiAgICAgICAgY2F0OiBcIkZlYXR1cmUgVHJhY2tzXCIsXG4gICAgICAgIHNtOiB0Lm5hbWUsXG4gICAgICAgIGxnOiB0LmRlc2NyaXB0aW9uIHx8IHQubmFtZVxuICAgICAgfTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIGxpbmVzID0gdGV4dC5zcGxpdChcIlxcblwiKSxcbiAgICAgIG8gPSB0aGlzLm9wdHM7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBpKSB7XG4gICAgICB2YXIgY2hyc2l6ZSA9IHN0cmlwKGxpbmUpLnNwbGl0KC9cXHMrLywgMiksXG4gICAgICAgIGNociA9IGNocnNpemVbMF0sXG4gICAgICAgIHNpemUgPSBwYXJzZUludDEwKGNocnNpemVbMV0pO1xuICAgICAgaWYgKF8uaXNOYU4oc2l6ZSkpIHsgcmV0dXJuOyB9XG4gICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gc2l6ZTtcbiAgICAgIG8uZ2Vub21lU2l6ZSArPSBzaXplO1xuICAgIH0pO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENocm9tU2l6ZXNGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gRkFTVEEgZm9ybWF0OiBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0ZBU1RBX2Zvcm1hdCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGVuc3VyZVVuaXF1ZSA9IHV0aWxzLmVuc3VyZVVuaXF1ZTtcblxudmFyIEZhc3RhRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgICBcbiAgICBzZWxmLmRhdGEgPSB7fTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIGxpbmVzID0gdGV4dC5zcGxpdChcIlxcblwiKSxcbiAgICAgIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNociA9IG51bGwsXG4gICAgICB1bm5hbWVkQ291bnRlciA9IDEsXG4gICAgICBjaHJzZXEgPSBbXTtcbiAgICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IFtdO1xuICAgIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgaSkge1xuICAgICAgdmFyIGNockxpbmUgPSBsaW5lLm1hdGNoKC9eWz47XSguKykvKSxcbiAgICAgICAgY2xlYW5lZExpbmUgPSBsaW5lLnJlcGxhY2UoL1xccysvZywgJycpO1xuICAgICAgaWYgKGNockxpbmUpIHtcbiAgICAgICAgY2hyID0gY2hyTGluZVsxXS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7XG4gICAgICAgIGlmICghY2hyLmxlbmd0aCkgeyBjaHIgPSBcInVubmFtZWRDaHJcIjsgfVxuICAgICAgICBjaHIgPSBlbnN1cmVVbmlxdWUoY2hyLCBvLmNockxlbmd0aHMpO1xuICAgICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5zZXF1ZW5jZS5wdXNoKGNsZWFuZWRMaW5lKTtcbiAgICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSAoby5jaHJMZW5ndGhzW2Nocl0gfHwgMCkgKyBjbGVhbmVkTGluZS5sZW5ndGg7XG4gICAgICAgIG8uZ2Vub21lU2l6ZSArPSBjbGVhbmVkTGluZS5sZW5ndGg7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gc2VsZi5kYXRhLnNlcXVlbmNlLmpvaW4oJycpO1xuICAgIHNlbGYuY2FuR2V0U2VxdWVuY2UgPSB0cnVlO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZhc3RhRm9ybWF0OyIsIlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBHZW5CYW5rIGZvcm1hdDogaHR0cDovL3d3dy5uY2JpLm5sbS5uaWguZ292L1NpdGVtYXAvc2FtcGxlcmVjb3JkLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICB0b3BUYWdzQXNBcnJheSA9IHV0aWxzLnRvcFRhZ3NBc0FycmF5LFxuICBzdWJUYWdzQXNBcnJheSA9IHV0aWxzLnN1YlRhZ3NBc0FycmF5LFxuICBmZXRjaEZpZWxkID0gdXRpbHMuZmV0Y2hGaWVsZCxcbiAgZ2V0VGFnID0gdXRpbHMuZ2V0VGFnLFxuICBlbnN1cmVVbmlxdWUgPSB1dGlscy5lbnN1cmVVbmlxdWU7XG5cbnZhciBHZW5CYW5rRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICAvLyBOb3RlIHRoYXQgd2UgY2FsbCBHZW5CYW5rIGZpZWxkIG5hbWVzIGxpa2UgXCJMT0NVU1wiLCBcIkRFRklOSVRJT05cIiwgZXRjLiB0YWdzIGluc3RlYWQgb2Yga2V5cy5cbiAgICAvLyBXZSBkbyB0aGlzIGJlY2F1c2U6IDEpIGNlcnRhaW4gZmllbGQgbmFtZXMgY2FuIGJlIHJlcGVhdGVkIChlLmcuIFJFRkVSRU5DRSkgd2hpY2ggaXMgbW9yZSBcbiAgICAvLyBldm9jYXRpdmUgb2YgXCJ0YWdzXCIgYXMgb3Bwb3NlZCB0byB0aGUgYmVoYXZpb3Igb2Yga2V5cyBpbiBhIGhhc2guICBBbHNvLCAyKSB0aGlzIGlzIHRoZVxuICAgIC8vIG5vbWVuY2xhdHVyZSBwaWNrZWQgYnkgQmlvUnVieS5cbiAgICBcbiAgICB0aGlzLnRhZ1NpemUgPSAxMjsgLy8gaG93IHdpZGUgdGhlIGNvbHVtbiBmb3IgdGFncyBpcyBpbiBhIEdlbkJhbmsgZmlsZVxuICAgIHRoaXMuZmVhdHVyZVRhZ1NpemUgPSAyMTsgLy8gaG93IHdpZGUgdGhlIGNvbHVtbiBmb3IgdGFncyBpcyBpbiB0aGUgZmVhdHVyZSB0YWJsZSBzZWN0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBzZWUgc2VjdGlvbiA0LjEgb2YgaHR0cDovL3d3dy5pbnNkYy5vcmcvZmlsZXMvZmVhdHVyZV90YWJsZS5odG1sXG4gICAgXG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgY29udGlnczogW10sXG4gICAgICB0cmFja0xpbmVzOiB7XG4gICAgICAgIHNvdXJjZTogW10sXG4gICAgICAgIGdlbmVzOiBbXSxcbiAgICAgICAgb3RoZXI6IFtdXG4gICAgICB9XG4gICAgfTtcbiAgfSxcbiAgXG4gIHBhcnNlTG9jdXM6IGZ1bmN0aW9uKGNvbnRpZykge1xuICAgIHZhciBsb2N1c0xpbmUgPSBjb250aWcub3JpZy5sb2N1cztcbiAgICBpZiAobG9jdXNMaW5lKSB7XG4gICAgICBpZiAobG9jdXNMaW5lLmxlbmd0aCA+IDc1KSB7IC8vIGFmdGVyIFJlbCAxMjYuMFxuICAgICAgICBjb250aWcuZW50cnlJZCAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDEyLCAyOCkpO1xuICAgICAgICBjb250aWcubGVuZ3RoICAgPSBwYXJzZUludDEwKGxvY3VzTGluZS5zdWJzdHJpbmcoMjksIDQwKSk7XG4gICAgICAgIGNvbnRpZy5zdHJhbmQgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDQsIDQ3KSk7XG4gICAgICAgIGNvbnRpZy5uYXR5cGUgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDcsIDUzKSk7XG4gICAgICAgIGNvbnRpZy5jaXJjdWxhciA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNTUsIDYzKSk7XG4gICAgICAgIGNvbnRpZy5kaXZpc2lvbiA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjMsIDY3KSk7XG4gICAgICAgIGNvbnRpZy5kYXRlICAgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjgsIDc5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb250aWcuZW50cnlJZCAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDEyLCAyMikpO1xuICAgICAgICBjb250aWcubGVuZ3RoICAgPSBwYXJzZUludDEwKGxvY3VzTGluZS5zdWJzdHJpbmcoMjIsIDMwKSk7XG4gICAgICAgIGNvbnRpZy5zdHJhbmQgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMzMsIDM2KSk7XG4gICAgICAgIGNvbnRpZy5uYXR5cGUgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMzYsIDQwKSk7XG4gICAgICAgIGNvbnRpZy5jaXJjdWxhciA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNDIsIDUyKSk7XG4gICAgICAgIGNvbnRpZy5kaXZpc2lvbiA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNTIsIDU1KSk7XG4gICAgICAgIGNvbnRpZy5kYXRlICAgICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoNjIsIDczKSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICBcbiAgcGFyc2VIZWFkZXJGaWVsZHM6IGZ1bmN0aW9uKGNvbnRpZykge1xuICAgIHZhciB0YWdTaXplID0gdGhpcy50YWdTaXplLFxuICAgICAgaGVhZGVyRmllbGRzVG9QYXJzZSA9IHtcbiAgICAgICAgc2ltcGxlOiBbJ2RlZmluaXRpb24nLCAnYWNjZXNzaW9uJywgJ3ZlcnNpb24nXSxcbiAgICAgICAgZGVlcDogWydzb3VyY2UnXSAvLyBjb3VsZCBhZGQgcmVmZXJlbmNlcywgYnV0IHdlIGRvbid0IGNhcmUgYWJvdXQgdGhvc2UgaGVyZVxuICAgICAgfTtcbiAgICBcbiAgICAvLyBQYXJzZSBzaW1wbGUgZmllbGRzICh0YWcgLS0+IGNvbnRlbnQpXG4gICAgXy5lYWNoKGhlYWRlckZpZWxkc1RvUGFyc2Uuc2ltcGxlLCBmdW5jdGlvbih0YWcpIHtcbiAgICAgIGlmICghY29udGlnLm9yaWdbdGFnXSkgeyBjb250aWdbdGFnXSA9IG51bGw7IHJldHVybjsgfVxuICAgICAgY29udGlnW3RhZ10gPSBmZXRjaEZpZWxkKGNvbnRpZy5vcmlnW3RhZ10sIHRhZ1NpemUpO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIFBhcnNlIHRhZ3MgdGhhdCBjYW4gcmVwZWF0IGFuZCBoYXZlIHN1YnRhZ3NcbiAgICBfLmVhY2goaGVhZGVyRmllbGRzVG9QYXJzZS5kZWVwLCBmdW5jdGlvbih0YWcpIHtcbiAgICAgIHZhciBkYXRhID0gW10sXG4gICAgICAgIGl0ZW1zO1xuICAgICAgaWYgKCFjb250aWcub3JpZ1t0YWddKSB7IGNvbnRpZ1t0YWddID0gbnVsbDsgcmV0dXJuOyB9XG4gICAgICBcbiAgICAgIGl0ZW1zID0gY29udGlnLm9yaWdbdGFnXS5yZXBsYWNlKC9cXG4oW0EtWmEtelxcL1xcKl0pL2csIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xuICAgICAgXy5lYWNoKGl0ZW1zLCBmdW5jdGlvbihpdGVtKSB7XG4gICAgICAgIHZhciBzdWJUYWdzID0gc3ViVGFnc0FzQXJyYXkoaXRlbSwgdGFnU2l6ZSksXG4gICAgICAgICAgaXRlbU5hbWUgPSBmZXRjaEZpZWxkKHN1YlRhZ3Muc2hpZnQoKSwgdGFnU2l6ZSksIFxuICAgICAgICAgIGl0ZW1EYXRhID0ge19uYW1lOiBpdGVtTmFtZX07XG4gICAgICAgIF8uZWFjaChzdWJUYWdzLCBmdW5jdGlvbihzdWJUYWdGaWVsZCkge1xuICAgICAgICAgIHZhciB0YWcgPSBnZXRUYWcoc3ViVGFnRmllbGQsIHRhZ1NpemUpO1xuICAgICAgICAgIGl0ZW1EYXRhW3RhZ10gPSBmZXRjaEZpZWxkKHN1YlRhZ0ZpZWxkLCB0YWdTaXplKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEucHVzaChpdGVtRGF0YSk7XG4gICAgICB9KTtcbiAgICAgIGNvbnRpZ1t0YWddID0gZGF0YTtcbiAgICAgIFxuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2VGZWF0dXJlVGFibGU6IGZ1bmN0aW9uKGNociwgY29udGlnRGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHRhZ1NpemUgPSBzZWxmLnRhZ1NpemUsXG4gICAgICBmZWF0dXJlVGFnU2l6ZSA9IHNlbGYuZmVhdHVyZVRhZ1NpemUsXG4gICAgICB0YWdzVG9Ta2lwID0gW1wiZmVhdHVyZXNcIl0sXG4gICAgICB0YWdzUmVsYXRlZFRvR2VuZXMgPSBbXCJjZHNcIiwgXCJnZW5lXCIsIFwibXJuYVwiLCBcImV4b25cIiwgXCJpbnRyb25cIl0sXG4gICAgICBjb250aWdMaW5lID0gXCJBQ0NFU1NJT04gICBcIiArIGNociArIFwiXFxuXCI7XG4gICAgaWYgKGNvbnRpZ0RhdGEub3JpZy5mZWF0dXJlcykge1xuICAgICAgdmFyIHN1YlRhZ3MgPSBzdWJUYWdzQXNBcnJheShjb250aWdEYXRhLm9yaWcuZmVhdHVyZXMsIHRhZ1NpemUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMuc291cmNlLnB1c2goY29udGlnTGluZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5nZW5lcy5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMub3RoZXIucHVzaChjb250aWdMaW5lKTtcbiAgICAgIF8uZWFjaChzdWJUYWdzLCBmdW5jdGlvbihzdWJUYWdGaWVsZCkge1xuICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKHN1YlRhZ0ZpZWxkLCBmZWF0dXJlVGFnU2l6ZSk7XG4gICAgICAgIGlmICh0YWdzVG9Ta2lwLmluZGV4T2YodGFnKSAhPT0gLTEpIHsgcmV0dXJuOyB9XG4gICAgICAgIGVsc2UgaWYgKHRhZyA9PT0gXCJzb3VyY2VcIikgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5zb3VyY2UucHVzaChzdWJUYWdGaWVsZCk7IH1cbiAgICAgICAgZWxzZSBpZiAodGFnc1JlbGF0ZWRUb0dlbmVzLmluZGV4T2YodGFnKSAhPT0gLTEpIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMuZ2VuZXMucHVzaChzdWJUYWdGaWVsZCk7ICB9XG4gICAgICAgIGVsc2UgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5vdGhlci5wdXNoKHN1YlRhZ0ZpZWxkKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBcbiAgcGFyc2VTZXF1ZW5jZTogZnVuY3Rpb24oY29udGlnRGF0YSkge1xuICAgIGlmIChjb250aWdEYXRhLm9yaWcub3JpZ2luKSB7XG4gICAgICByZXR1cm4gY29udGlnRGF0YS5vcmlnLm9yaWdpbi5yZXBsYWNlKC9eb3JpZ2luLip8XFxuWyAwLTldezEwfXwgL2lnLCAnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBBcnJheShjb250aWdEYXRhLmxlbmd0aCkuam9pbignbicpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGNyZWF0ZVRyYWNrc0Zyb21GZWF0dXJlczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNhdGVnb3J5VHVwbGVzID0gW1xuICAgICAgICBbXCJzb3VyY2VcIiwgXCJTb3VyY2VzXCIsIFwiUmVnaW9ucyBhbm5vdGF0ZWQgYnkgc291cmNlIG9yZ2FuaXNtIG9yIHNwZWNpbWVuXCJdLCBcbiAgICAgICAgW1wiZ2VuZXNcIiwgXCJHZW5lIGFubm90YXRpb25zXCIsIFwiQ0RTIGFuZCBnZW5lIGZlYXR1cmVzXCJdLCBcbiAgICAgICAgW1wib3RoZXJcIiwgXCJPdGhlciBhbm5vdGF0aW9uc1wiLCBcInRSTkFzIGFuZCBvdGhlciBmZWF0dXJlc1wiXVxuICAgICAgXTtcbiAgICBcbiAgICAvLyBGb3IgdGhlIGNhdGVnb3JpZXMgb2YgZmVhdHVyZXMsIGNyZWF0ZSBhcHByb3ByaWF0ZSBlbnRyaWVzIGluIG8uYXZhaWxUcmFja3MsIG8udHJhY2tzLCBhbmQgby50cmFja0Rlc2NcbiAgICAvLyBMZWF2ZSB0aGUgYWN0dWFsIGRhdGEgYXMgYXJyYXlzIG9mIGxpbmVzIHRoYXQgYXJlIGF0dGFjaGVkIGFzIC5jdXN0b21EYXRhIHRvIG8uYXZhaWxUcmFja3NcbiAgICAvLyBUaGV5IHdpbGwgYmUgcGFyc2VkIGxhdGVyIHZpYSBDdXN0b21UcmFja3MucGFyc2UuXG4gICAgXy5lYWNoKGNhdGVnb3J5VHVwbGVzLCBmdW5jdGlvbihjYXRlZ29yeVR1cGxlKSB7XG4gICAgICB2YXIgY2F0ZWdvcnkgPSBjYXRlZ29yeVR1cGxlWzBdLFxuICAgICAgICBsYWJlbCA9IGNhdGVnb3J5VHVwbGVbMV0sXG4gICAgICAgIGxvbmdMYWJlbCA9IGNhdGVnb3J5VHVwbGVbMl0sXG4gICAgICAgIHRyYWNrTGluZXMgPSBbXTtcbiAgICAgIGlmIChzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV0ubGVuZ3RoID4gMCkge1xuICAgICAgICBzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV0udW5zaGlmdCgndHJhY2sgdHlwZT1cImZlYXR1cmVUYWJsZVwiIG5hbWU9XCInICsgbGFiZWwgKyBcbiAgICAgICAgICAnXCIgY29sbGFwc2VCeUdlbmU9XCInICsgKGNhdGVnb3J5PT1cImdlbmVzXCIgPyAnb24nIDogJ29mZicpICsgJ1wiXFxuJyk7XG4gICAgICB9XG4gICAgICBvLmF2YWlsVHJhY2tzLnB1c2goe1xuICAgICAgICBmaDoge30sXG4gICAgICAgIG46IGNhdGVnb3J5LFxuICAgICAgICBzOiBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ10sXG4gICAgICAgIGg6IDE1LFxuICAgICAgICBtOiBbJ3BhY2snXSxcbiAgICAgICAgY3VzdG9tRGF0YTogc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldXG4gICAgICB9KTtcbiAgICAgIG8udHJhY2tzLnB1c2goe246IGNhdGVnb3J5fSk7XG4gICAgICBvLnRyYWNrRGVzY1tjYXRlZ29yeV0gPSB7XG4gICAgICAgIGNhdDogXCJGZWF0dXJlIFRyYWNrc1wiLFxuICAgICAgICBzbTogbGFiZWwsXG4gICAgICAgIGxnOiBsb25nTGFiZWxcbiAgICAgIH07XG4gICAgfSk7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjb250aWdEZWxpbWl0ZXIgPSBcIlxcbi8vXFxuXCIsXG4gICAgICBjb250aWdzID0gdGV4dC5zcGxpdChjb250aWdEZWxpbWl0ZXIpLFxuICAgICAgZmlyc3RDb250aWcgPSBudWxsO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IFtdO1xuICAgICAgXG4gICAgXy5lYWNoKGNvbnRpZ3MsIGZ1bmN0aW9uKGNvbnRpZykge1xuICAgICAgaWYgKCFzdHJpcChjb250aWcpLmxlbmd0aCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgdmFyIGNvbnRpZ0RhdGEgPSB7b3JpZzoge319LFxuICAgICAgICBjaHIsIHNpemUsIGNvbnRpZ1NlcXVlbmNlO1xuICAgICAgXG4gICAgICAvLyBTcGxpdHMgb24gYW55IGxpbmVzIHdpdGggYSBjaGFyYWN0ZXIgaW4gdGhlIGZpcnN0IGNvbHVtblxuICAgICAgXy5lYWNoKHRvcFRhZ3NBc0FycmF5KGNvbnRpZyksIGZ1bmN0aW9uKGZpZWxkKSB7XG4gICAgICAgIHZhciB0YWcgPSBnZXRUYWcoZmllbGQsIHNlbGYudGFnU2l6ZSk7XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNvbnRpZ0RhdGEub3JpZ1t0YWddKSkgeyBjb250aWdEYXRhLm9yaWdbdGFnXSA9IGZpZWxkOyB9XG4gICAgICAgIGVsc2UgeyBjb250aWdEYXRhLm9yaWdbdGFnXSArPSBmaWVsZDsgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIHNlbGYuZGF0YS5jb250aWdzLnB1c2goY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlTG9jdXMoY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlSGVhZGVyRmllbGRzKGNvbnRpZ0RhdGEpO1xuICAgICAgY29udGlnU2VxdWVuY2UgPSBzZWxmLmZvcm1hdCgpLnBhcnNlU2VxdWVuY2UoY29udGlnRGF0YSk7XG4gICAgICBcbiAgICAgIGNociA9IGNvbnRpZ0RhdGEuYWNjZXNzaW9uICYmIGNvbnRpZ0RhdGEuYWNjZXNzaW9uICE9ICd1bmtub3duJyA/IGNvbnRpZ0RhdGEuYWNjZXNzaW9uIDogY29udGlnRGF0YS5lbnRyeUlkO1xuICAgICAgY2hyID0gZW5zdXJlVW5pcXVlKGNociwgby5jaHJMZW5ndGhzKTtcbiAgICAgIFxuICAgICAgaWYgKGNvbnRpZ0RhdGEubGVuZ3RoKSB7XG4gICAgICAgIHNpemUgPSBjb250aWdEYXRhLmxlbmd0aDtcbiAgICAgICAgaWYgKHNpemUgIT0gY29udGlnU2VxdWVuY2UubGVuZ3RoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2VxdWVuY2UgZGF0YSBmb3IgY29udGlnIFwiK2NocitcIiBkb2VzIG5vdCBtYXRjaCBsZW5ndGggXCIrc2l6ZStcImJwIGZyb20gaGVhZGVyXCIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzaXplID0gY29udGlnU2VxdWVuY2UubGVuZ3RoO1xuICAgICAgfVxuICAgICAgXG4gICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gc2l6ZTtcbiAgICAgIG8uZ2Vub21lU2l6ZSArPSBzaXplO1xuICAgICAgXG4gICAgICBzZWxmLmZvcm1hdCgpLnBhcnNlRmVhdHVyZVRhYmxlKGNociwgY29udGlnRGF0YSk7XG4gICAgICBzZWxmLmRhdGEuc2VxdWVuY2UucHVzaChjb250aWdTZXF1ZW5jZSk7XG4gICAgICBcbiAgICAgIGZpcnN0Q29udGlnID0gZmlyc3RDb250aWcgfHwgY29udGlnRGF0YTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBzZWxmLmRhdGEuc2VxdWVuY2Uuam9pbignJyk7XG4gICAgc2VsZi5jYW5HZXRTZXF1ZW5jZSA9IHRydWU7XG4gICAgc2VsZi5mb3JtYXQoKS5jcmVhdGVUcmFja3NGcm9tRmVhdHVyZXMoKTtcbiAgICBcbiAgICBvLnNwZWNpZXMgPSBmaXJzdENvbnRpZy5zb3VyY2UgPyBmaXJzdENvbnRpZy5zb3VyY2VbMF0ub3JnYW5pc20uc3BsaXQoXCJcXG5cIilbMF0gOiAnQ3VzdG9tIEdlbm9tZSc7XG4gICAgaWYgKGZpcnN0Q29udGlnLmRhdGUpIHsgby5hc3NlbWJseURhdGUgPSBmaXJzdENvbnRpZy5kYXRlOyB9XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEdlbkJhbmtGb3JtYXQ7IiwidmFyIHRyYWNrVXRpbHMgPSByZXF1aXJlKCcuLi8uLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpO1xuXG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gdHJhY2tVdGlscy5wYXJzZUludDEwO1xuXG5tb2R1bGUuZXhwb3J0cy5kZWVwQ2xvbmUgPSBmdW5jdGlvbihvYmopIHsgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob2JqKSk7IH1cblxubW9kdWxlLmV4cG9ydHMubG9nMTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIE1hdGgubG9nKHZhbCkgLyBNYXRoLkxOMTA7IH1cblxudmFyIHN0cmlwID0gbW9kdWxlLmV4cG9ydHMuc3RyaXAgPSB0cmFja1V0aWxzLnN0cmlwO1xuXG5tb2R1bGUuZXhwb3J0cy5yb3VuZFRvUGxhY2VzID0gZnVuY3Rpb24obnVtLCBkZWMpIHsgcmV0dXJuIE1hdGgucm91bmQobnVtICogTWF0aC5wb3coMTAsIGRlYykpIC8gTWF0aC5wb3coMTAsIGRlYyk7IH1cblxuLyoqKipcbiAqIFRoZXNlIGZ1bmN0aW9ucyBhcmUgY29tbW9uIHN1YnJvdXRpbmVzIGZvciBwYXJzaW5nIEdlbkJhbmsgYW5kIG90aGVyIGZvcm1hdHMgYmFzZWQgb24gY29sdW1uIHBvc2l0aW9uc1xuICoqKiovXG5cbi8vIFNwbGl0cyBhIG11bHRpbGluZSBzdHJpbmcgYmVmb3JlIHRoZSBsaW5lcyB0aGF0IGNvbnRhaW4gYSBjaGFyYWN0ZXIgaW4gdGhlIGZpcnN0IGNvbHVtblxuLy8gKGEgXCJ0b3AgdGFnXCIpIGluIGEgR2VuQmFuay1zdHlsZSB0ZXh0IGZpbGVcbm1vZHVsZS5leHBvcnRzLnRvcFRhZ3NBc0FycmF5ID0gZnVuY3Rpb24oZmllbGQpIHtcbiAgcmV0dXJuIGZpZWxkLnJlcGxhY2UoL1xcbihbQS1aYS16XFwvXFwqXSkvZywgXCJcXG5cXDAwMSQxXCIpLnNwbGl0KFwiXFwwMDFcIik7XG59XG5cbi8vIFNwbGl0cyBhIG11bHRpbGluZSBzdHJpbmcgYmVmb3JlIHRoZSBsaW5lcyB0aGF0IGNvbnRhaW4gYSBjaGFyYWN0ZXIgbm90IGluIHRoZSBmaXJzdCBjb2x1bW5cbi8vIGJ1dCB3aXRoaW4gdGhlIG5leHQgdGFnU2l6ZSBjb2x1bW5zLCB3aGljaCBpcyBhIFwic3ViIHRhZ1wiIGluIGEgR2VuQmFuay1zdHlsZSB0ZXh0IGZpbGVcbm1vZHVsZS5leHBvcnRzLnN1YlRhZ3NBc0FycmF5ID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHtcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMikgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHZhciByZSA9IG5ldyBSZWdFeHAoXCJcXFxcbihcXFxcc3sxLFwiICsgKHRhZ1NpemUgLSAxKSArIFwifVxcXFxTKVwiLCBcImdcIik7XG4gIHJldHVybiBmaWVsZC5yZXBsYWNlKHJlLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbn1cblxuLy8gUmV0dXJucyBhIG5ldyBzdHJpbmcgd2l0aCB0aGUgZmlyc3QgdGFnU2l6ZSBjb2x1bW5zIGZyb20gZmllbGQgcmVtb3ZlZFxubW9kdWxlLmV4cG9ydHMuZmV0Y2hGaWVsZCA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7XG4gIGlmICghaXNGaW5pdGUodGFnU2l6ZSkgfHwgdGFnU2l6ZSA8IDEpIHsgdGhyb3cgXCJpbnZhbGlkIHRhZ1NpemVcIjsgfVxuICB2YXIgcmUgPSBuZXcgUmVnRXhwKFwiKF58XFxcXG4pLnswLFwiICsgdGFnU2l6ZSArIFwifVwiLCBcImdcIik7XG4gIHJldHVybiBzdHJpcChmaWVsZC5yZXBsYWNlKHJlLCBcIiQxXCIpKTtcbn1cblxuLy8gR2V0cyBhIHRhZyBmcm9tIGEgZmllbGQgYnkgdHJpbW1pbmcgaXQgb3V0IG9mIHRoZSBmaXJzdCB0YWdTaXplIGNoYXJhY3RlcnMgb2YgdGhlIGZpZWxkXG5tb2R1bGUuZXhwb3J0cy5nZXRUYWcgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkgeyBcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMSkgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHJldHVybiBzdHJpcChmaWVsZC5zdWJzdHJpbmcoMCwgdGFnU2l6ZSkudG9Mb3dlckNhc2UoKSk7XG59XG5cbi8qKioqXG4gKiBFbmQgR2VuQmFuayBhbmQgY29sdW1uLWJhc2VkIGZvcm1hdCBoZWxwZXJzXG4gKioqKi9cblxuLy8gR2l2ZW4gYSBoYXNoIGFuZCBhIHByZXN1bXB0aXZlIG5ldyBrZXksIGFwcGVuZHMgYSBjb3VudGVyIHRvIHRoZSBrZXkgdW50aWwgaXQgaXMgYWN0dWFsbHkgYW4gdW51c2VkIGtleVxubW9kdWxlLmV4cG9ydHMuZW5zdXJlVW5pcXVlID0gZnVuY3Rpb24oa2V5LCBoYXNoKSB7XG4gIHZhciBpID0gMSwga2V5Q2hlY2sgPSBrZXk7XG4gIHdoaWxlICh0eXBlb2YgaGFzaFtrZXlDaGVja10gIT0gJ3VuZGVmaW5lZCcpIHsga2V5Q2hlY2sgPSBrZXkgKyAnXycgKyBpKys7IH1cbiAgcmV0dXJuIGtleUNoZWNrO1xufVxuXG4vLyBHaXZlbiBhIGhhc2ggd2l0aCBvcHRpb24gbmFtZXMgYW5kIHZhbHVlcywgZm9ybWF0cyBpdCBpbiBCRUQgdHJhY2sgbGluZSBmb3JtYXQgKHNpbWlsYXIgdG8gSFRNTCBlbGVtZW50IGF0dHJpYnV0ZXMpXG5tb2R1bGUuZXhwb3J0cy5vcHRzQXNUcmFja0xpbmUgPSBmdW5jdGlvbihvcHRoYXNoKSB7XG4gIHJldHVybiBfLm1hcChvcHRoYXNoLCBmdW5jdGlvbih2LCBrKSB7IHJldHVybiBrICsgJz1cIicgKyB2LnRvU3RyaW5nKCkucmVwbGFjZSgvXCIvZywgJycpICsgJ1wiJzsgfSkuam9pbignICcpO1xufSIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKXtnbG9iYWwud2luZG93PWdsb2JhbC53aW5kb3d8fGdsb2JhbDtnbG9iYWwud2luZG93LmRvY3VtZW50PWdsb2JhbC53aW5kb3cuZG9jdW1lbnR8fHt9OyhmdW5jdGlvbihhLGIpe2Z1bmN0aW9uIE4oKXt0cnl7cmV0dXJuIG5ldyBhLkFjdGl2ZVhPYmplY3QoXCJNaWNyb3NvZnQuWE1MSFRUUFwiKX1jYXRjaChiKXt9fWZ1bmN0aW9uIE0oKXt0cnl7cmV0dXJuIG5ldyBhLlhNTEh0dHBSZXF1ZXN0fWNhdGNoKGIpe319ZnVuY3Rpb24gSShhLGMpe2lmKGEuZGF0YUZpbHRlcil7Yz1hLmRhdGFGaWx0ZXIoYyxhLmRhdGFUeXBlKX12YXIgZD1hLmRhdGFUeXBlcyxlPXt9LGcsaCxpPWQubGVuZ3RoLGosaz1kWzBdLGwsbSxuLG8scDtmb3IoZz0xO2c8aTtnKyspe2lmKGc9PT0xKXtmb3IoaCBpbiBhLmNvbnZlcnRlcnMpe2lmKHR5cGVvZiBoPT09XCJzdHJpbmdcIil7ZVtoLnRvTG93ZXJDYXNlKCldPWEuY29udmVydGVyc1toXX19fWw9aztrPWRbZ107aWYoaz09PVwiKlwiKXtrPWx9ZWxzZSBpZihsIT09XCIqXCImJmwhPT1rKXttPWwrXCIgXCIraztuPWVbbV18fGVbXCIqIFwiK2tdO2lmKCFuKXtwPWI7Zm9yKG8gaW4gZSl7aj1vLnNwbGl0KFwiIFwiKTtpZihqWzBdPT09bHx8alswXT09PVwiKlwiKXtwPWVbalsxXStcIiBcIitrXTtpZihwKXtvPWVbb107aWYobz09PXRydWUpe249cH1lbHNlIGlmKHA9PT10cnVlKXtuPW99YnJlYWt9fX19aWYoIShufHxwKSl7Zi5lcnJvcihcIk5vIGNvbnZlcnNpb24gZnJvbSBcIittLnJlcGxhY2UoXCIgXCIsXCIgdG8gXCIpKX1pZihuIT09dHJ1ZSl7Yz1uP24oYyk6cChvKGMpKX19fXJldHVybiBjfWZ1bmN0aW9uIEgoYSxjLGQpe3ZhciBlPWEuY29udGVudHMsZj1hLmRhdGFUeXBlcyxnPWEucmVzcG9uc2VGaWVsZHMsaCxpLGosaztmb3IoaSBpbiBnKXtpZihpIGluIGQpe2NbZ1tpXV09ZFtpXX19d2hpbGUoZlswXT09PVwiKlwiKXtmLnNoaWZ0KCk7aWYoaD09PWIpe2g9YS5taW1lVHlwZXx8Yy5nZXRSZXNwb25zZUhlYWRlcihcImNvbnRlbnQtdHlwZVwiKX19aWYoaCl7Zm9yKGkgaW4gZSl7aWYoZVtpXSYmZVtpXS50ZXN0KGgpKXtmLnVuc2hpZnQoaSk7YnJlYWt9fX1pZihmWzBdaW4gZCl7aj1mWzBdfWVsc2V7Zm9yKGkgaW4gZCl7aWYoIWZbMF18fGEuY29udmVydGVyc1tpK1wiIFwiK2ZbMF1dKXtqPWk7YnJlYWt9aWYoIWspe2s9aX19aj1qfHxrfWlmKGope2lmKGohPT1mWzBdKXtmLnVuc2hpZnQoail9cmV0dXJuIGRbal19fWZ1bmN0aW9uIEcoYSxiLGMsZCl7aWYoZi5pc0FycmF5KGIpKXtmLmVhY2goYixmdW5jdGlvbihiLGUpe2lmKGN8fGoudGVzdChhKSl7ZChhLGUpfWVsc2V7RyhhK1wiW1wiKyh0eXBlb2YgZT09PVwib2JqZWN0XCJ8fGYuaXNBcnJheShlKT9iOlwiXCIpK1wiXVwiLGUsYyxkKX19KX1lbHNlIGlmKCFjJiZiIT1udWxsJiZ0eXBlb2YgYj09PVwib2JqZWN0XCIpe2Zvcih2YXIgZSBpbiBiKXtHKGErXCJbXCIrZStcIl1cIixiW2VdLGMsZCl9fWVsc2V7ZChhLGIpfX1mdW5jdGlvbiBGKGEsYyl7dmFyIGQsZSxnPWYuYWpheFNldHRpbmdzLmZsYXRPcHRpb25zfHx7fTtmb3IoZCBpbiBjKXtpZihjW2RdIT09Yil7KGdbZF0/YTplfHwoZT17fSkpW2RdPWNbZF19fWlmKGUpe2YuZXh0ZW5kKHRydWUsYSxlKX19ZnVuY3Rpb24gRShhLGMsZCxlLGYsZyl7Zj1mfHxjLmRhdGFUeXBlc1swXTtnPWd8fHt9O2dbZl09dHJ1ZTt2YXIgaD1hW2ZdLGk9MCxqPWg/aC5sZW5ndGg6MCxrPWE9PT15LGw7Zm9yKDtpPGomJihrfHwhbCk7aSsrKXtsPWhbaV0oYyxkLGUpO2lmKHR5cGVvZiBsPT09XCJzdHJpbmdcIil7aWYoIWt8fGdbbF0pe2w9Yn1lbHNle2MuZGF0YVR5cGVzLnVuc2hpZnQobCk7bD1FKGEsYyxkLGUsbCxnKX19fWlmKChrfHwhbCkmJiFnW1wiKlwiXSl7bD1FKGEsYyxkLGUsXCIqXCIsZyl9cmV0dXJuIGx9ZnVuY3Rpb24gRChhKXtyZXR1cm4gZnVuY3Rpb24oYixjKXtpZih0eXBlb2YgYiE9PVwic3RyaW5nXCIpe2M9YjtiPVwiKlwifWlmKGYuaXNGdW5jdGlvbihjKSl7dmFyIGQ9Yi50b0xvd2VyQ2FzZSgpLnNwbGl0KHUpLGU9MCxnPWQubGVuZ3RoLGgsaSxqO2Zvcig7ZTxnO2UrKyl7aD1kW2VdO2o9L15cXCsvLnRlc3QoaCk7aWYoail7aD1oLnN1YnN0cigxKXx8XCIqXCJ9aT1hW2hdPWFbaF18fFtdO2lbaj9cInVuc2hpZnRcIjpcInB1c2hcIl0oYyl9fX19dmFyIGM9YS5kb2N1bWVudCxkPWEubmF2aWdhdG9yLGU9YS5sb2NhdGlvbjt2YXIgZj1mdW5jdGlvbigpe2Z1bmN0aW9uIEooKXtpZihlLmlzUmVhZHkpe3JldHVybn10cnl7Yy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwoXCJsZWZ0XCIpfWNhdGNoKGEpe3NldFRpbWVvdXQoSiwxKTtyZXR1cm59ZS5yZWFkeSgpfXZhciBlPWZ1bmN0aW9uKGEsYil7cmV0dXJuIG5ldyBlLmZuLmluaXQoYSxiLGgpfSxmPWEualF1ZXJ5LGc9YS4kLGgsaT0vXig/OltePF0qKDxbXFx3XFxXXSs+KVtePl0qJHwjKFtcXHdcXC1dKikkKS8saj0vXFxTLyxrPS9eXFxzKy8sbD0vXFxzKyQvLG09L1xcZC8sbj0vXjwoXFx3KylcXHMqXFwvPz4oPzo8XFwvXFwxPik/JC8sbz0vXltcXF0sOnt9XFxzXSokLyxwPS9cXFxcKD86W1wiXFxcXFxcL2JmbnJ0XXx1WzAtOWEtZkEtRl17NH0pL2cscT0vXCJbXlwiXFxcXFxcblxccl0qXCJ8dHJ1ZXxmYWxzZXxudWxsfC0/XFxkKyg/OlxcLlxcZCopPyg/OltlRV1bK1xcLV0/XFxkKyk/L2cscj0vKD86Xnw6fCwpKD86XFxzKlxcWykrL2cscz0vKHdlYmtpdClbIFxcL10oW1xcdy5dKykvLHQ9LyhvcGVyYSkoPzouKnZlcnNpb24pP1sgXFwvXShbXFx3Ll0rKS8sdT0vKG1zaWUpIChbXFx3Ll0rKS8sdj0vKG1vemlsbGEpKD86Lio/IHJ2OihbXFx3Ll0rKSk/Lyx3PS8tKFthLXpdKS9pZyx4PWZ1bmN0aW9uKGEsYil7cmV0dXJuIGIudG9VcHBlckNhc2UoKX0seT1kLnVzZXJBZ2VudCx6LEEsQixDPU9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsRD1PYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LEU9QXJyYXkucHJvdG90eXBlLnB1c2gsRj1BcnJheS5wcm90b3R5cGUuc2xpY2UsRz1TdHJpbmcucHJvdG90eXBlLnRyaW0sSD1BcnJheS5wcm90b3R5cGUuaW5kZXhPZixJPXt9O2UuZm49ZS5wcm90b3R5cGU9e2NvbnN0cnVjdG9yOmUsaW5pdDpmdW5jdGlvbihhLGQsZil7dmFyIGcsaCxqLGs7aWYoIWEpe3JldHVybiB0aGlzfWlmKGEubm9kZVR5cGUpe3RoaXMuY29udGV4dD10aGlzWzBdPWE7dGhpcy5sZW5ndGg9MTtyZXR1cm4gdGhpc31pZihhPT09XCJib2R5XCImJiFkJiZjLmJvZHkpe3RoaXMuY29udGV4dD1jO3RoaXNbMF09Yy5ib2R5O3RoaXMuc2VsZWN0b3I9YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKHR5cGVvZiBhPT09XCJzdHJpbmdcIil7aWYoYS5jaGFyQXQoMCk9PT1cIjxcIiYmYS5jaGFyQXQoYS5sZW5ndGgtMSk9PT1cIj5cIiYmYS5sZW5ndGg+PTMpe2c9W251bGwsYSxudWxsXX1lbHNle2c9aS5leGVjKGEpfWlmKGcmJihnWzFdfHwhZCkpe2lmKGdbMV0pe2Q9ZCBpbnN0YW5jZW9mIGU/ZFswXTpkO2s9ZD9kLm93bmVyRG9jdW1lbnR8fGQ6YztqPW4uZXhlYyhhKTtpZihqKXtpZihlLmlzUGxhaW5PYmplY3QoZCkpe2E9W2MuY3JlYXRlRWxlbWVudChqWzFdKV07ZS5mbi5hdHRyLmNhbGwoYSxkLHRydWUpfWVsc2V7YT1bay5jcmVhdGVFbGVtZW50KGpbMV0pXX19ZWxzZXtqPWUuYnVpbGRGcmFnbWVudChbZ1sxXV0sW2tdKTthPShqLmNhY2hlYWJsZT9lLmNsb25lKGouZnJhZ21lbnQpOmouZnJhZ21lbnQpLmNoaWxkTm9kZXN9cmV0dXJuIGUubWVyZ2UodGhpcyxhKX1lbHNle2g9Yy5nZXRFbGVtZW50QnlJZChnWzJdKTtpZihoJiZoLnBhcmVudE5vZGUpe2lmKGguaWQhPT1nWzJdKXtyZXR1cm4gZi5maW5kKGEpfXRoaXMubGVuZ3RoPTE7dGhpc1swXT1ofXRoaXMuY29udGV4dD1jO3RoaXMuc2VsZWN0b3I9YTtyZXR1cm4gdGhpc319ZWxzZSBpZighZHx8ZC5qcXVlcnkpe3JldHVybihkfHxmKS5maW5kKGEpfWVsc2V7cmV0dXJuIHRoaXMuY29uc3RydWN0b3IoZCkuZmluZChhKX19ZWxzZSBpZihlLmlzRnVuY3Rpb24oYSkpe3JldHVybiBmLnJlYWR5KGEpfWlmKGEuc2VsZWN0b3IhPT1iKXt0aGlzLnNlbGVjdG9yPWEuc2VsZWN0b3I7dGhpcy5jb250ZXh0PWEuY29udGV4dH1yZXR1cm4gZS5tYWtlQXJyYXkoYSx0aGlzKX0sc2VsZWN0b3I6XCJcIixqcXVlcnk6XCIxLjYuM3ByZVwiLGxlbmd0aDowLHNpemU6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5sZW5ndGh9LHRvQXJyYXk6ZnVuY3Rpb24oKXtyZXR1cm4gRi5jYWxsKHRoaXMsMCl9LGdldDpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD90aGlzLnRvQXJyYXkoKTphPDA/dGhpc1t0aGlzLmxlbmd0aCthXTp0aGlzW2FdfSxwdXNoU3RhY2s6ZnVuY3Rpb24oYSxiLGMpe3ZhciBkPXRoaXMuY29uc3RydWN0b3IoKTtpZihlLmlzQXJyYXkoYSkpe0UuYXBwbHkoZCxhKX1lbHNle2UubWVyZ2UoZCxhKX1kLnByZXZPYmplY3Q9dGhpcztkLmNvbnRleHQ9dGhpcy5jb250ZXh0O2lmKGI9PT1cImZpbmRcIil7ZC5zZWxlY3Rvcj10aGlzLnNlbGVjdG9yKyh0aGlzLnNlbGVjdG9yP1wiIFwiOlwiXCIpK2N9ZWxzZSBpZihiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrXCIuXCIrYitcIihcIitjK1wiKVwifXJldHVybiBkfSxlYWNoOmZ1bmN0aW9uKGEsYil7cmV0dXJuIGUuZWFjaCh0aGlzLGEsYil9LHJlYWR5OmZ1bmN0aW9uKGEpe2UuYmluZFJlYWR5KCk7QS5kb25lKGEpO3JldHVybiB0aGlzfSxlcTpmdW5jdGlvbihhKXtyZXR1cm4gYT09PS0xP3RoaXMuc2xpY2UoYSk6dGhpcy5zbGljZShhLCthKzEpfSxmaXJzdDpmdW5jdGlvbigpe3JldHVybiB0aGlzLmVxKDApfSxsYXN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoLTEpfSxzbGljZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLnB1c2hTdGFjayhGLmFwcGx5KHRoaXMsYXJndW1lbnRzKSxcInNsaWNlXCIsRi5jYWxsKGFyZ3VtZW50cykuam9pbihcIixcIikpfSxtYXA6ZnVuY3Rpb24oYSl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKGUubWFwKHRoaXMsZnVuY3Rpb24oYixjKXtyZXR1cm4gYS5jYWxsKGIsYyxiKX0pKX0sZW5kOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHJldk9iamVjdHx8dGhpcy5jb25zdHJ1Y3RvcihudWxsKX0scHVzaDpFLHNvcnQ6W10uc29ydCxzcGxpY2U6W10uc3BsaWNlfTtlLmZuLmluaXQucHJvdG90eXBlPWUuZm47ZS5leHRlbmQ9ZS5mbi5leHRlbmQ9ZnVuY3Rpb24oKXt2YXIgYSxjLGQsZixnLGgsaT1hcmd1bWVudHNbMF18fHt9LGo9MSxrPWFyZ3VtZW50cy5sZW5ndGgsbD1mYWxzZTtpZih0eXBlb2YgaT09PVwiYm9vbGVhblwiKXtsPWk7aT1hcmd1bWVudHNbMV18fHt9O2o9Mn1pZih0eXBlb2YgaSE9PVwib2JqZWN0XCImJiFlLmlzRnVuY3Rpb24oaSkpe2k9e319aWYoaz09PWope2k9dGhpczstLWp9Zm9yKDtqPGs7aisrKXtpZigoYT1hcmd1bWVudHNbal0pIT1udWxsKXtmb3IoYyBpbiBhKXtkPWlbY107Zj1hW2NdO2lmKGk9PT1mKXtjb250aW51ZX1pZihsJiZmJiYoZS5pc1BsYWluT2JqZWN0KGYpfHwoZz1lLmlzQXJyYXkoZikpKSl7aWYoZyl7Zz1mYWxzZTtoPWQmJmUuaXNBcnJheShkKT9kOltdfWVsc2V7aD1kJiZlLmlzUGxhaW5PYmplY3QoZCk/ZDp7fX1pW2NdPWUuZXh0ZW5kKGwsaCxmKX1lbHNlIGlmKGYhPT1iKXtpW2NdPWZ9fX19cmV0dXJuIGl9O2UuZXh0ZW5kKHtub0NvbmZsaWN0OmZ1bmN0aW9uKGIpe2lmKGEuJD09PWUpe2EuJD1nfWlmKGImJmEualF1ZXJ5PT09ZSl7YS5qUXVlcnk9Zn1yZXR1cm4gZX0saXNSZWFkeTpmYWxzZSxyZWFkeVdhaXQ6MSxob2xkUmVhZHk6ZnVuY3Rpb24oYSl7aWYoYSl7ZS5yZWFkeVdhaXQrK31lbHNle2UucmVhZHkodHJ1ZSl9fSxyZWFkeTpmdW5jdGlvbihhKXtpZihhPT09dHJ1ZSYmIS0tZS5yZWFkeVdhaXR8fGEhPT10cnVlJiYhZS5pc1JlYWR5KXtpZighYy5ib2R5KXtyZXR1cm4gc2V0VGltZW91dChlLnJlYWR5LDEpfWUuaXNSZWFkeT10cnVlO2lmKGEhPT10cnVlJiYtLWUucmVhZHlXYWl0PjApe3JldHVybn1BLnJlc29sdmVXaXRoKGMsW2VdKTtpZihlLmZuLnRyaWdnZXIpe2UoYykudHJpZ2dlcihcInJlYWR5XCIpLnVuYmluZChcInJlYWR5XCIpfX19LGJpbmRSZWFkeTpmdW5jdGlvbigpe2lmKEEpe3JldHVybn1BPWUuX0RlZmVycmVkKCk7aWYoYy5yZWFkeVN0YXRlPT09XCJjb21wbGV0ZVwiKXtyZXR1cm4gc2V0VGltZW91dChlLnJlYWR5LDEpfWlmKGMuYWRkRXZlbnRMaXN0ZW5lcil7Yy5hZGRFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLEIsZmFsc2UpO2EuYWRkRXZlbnRMaXN0ZW5lcihcImxvYWRcIixlLnJlYWR5LGZhbHNlKX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe2MuYXR0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTthLmF0dGFjaEV2ZW50KFwib25sb2FkXCIsZS5yZWFkeSk7dmFyIGI9ZmFsc2U7dHJ5e2I9YS5mcmFtZUVsZW1lbnQ9PW51bGx9Y2F0Y2goZCl7fWlmKGMuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsJiZiKXtKKCl9fX0saXNGdW5jdGlvbjpmdW5jdGlvbihhKXtyZXR1cm4gZS50eXBlKGEpPT09XCJmdW5jdGlvblwifSxpc0FycmF5OkFycmF5LmlzQXJyYXl8fGZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImFycmF5XCJ9LGlzV2luZG93OmZ1bmN0aW9uKGEpe3JldHVybiBhJiZ0eXBlb2YgYT09PVwib2JqZWN0XCImJlwic2V0SW50ZXJ2YWxcImluIGF9LGlzTmFOOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsfHwhbS50ZXN0KGEpfHxpc05hTihhKX0sdHlwZTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9TdHJpbmcoYSk6SVtDLmNhbGwoYSldfHxcIm9iamVjdFwifSxpc1BsYWluT2JqZWN0OmZ1bmN0aW9uKGEpe2lmKCFhfHxlLnR5cGUoYSkhPT1cIm9iamVjdFwifHxhLm5vZGVUeXBlfHxlLmlzV2luZG93KGEpKXtyZXR1cm4gZmFsc2V9aWYoYS5jb25zdHJ1Y3RvciYmIUQuY2FsbChhLFwiY29uc3RydWN0b3JcIikmJiFELmNhbGwoYS5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsXCJpc1Byb3RvdHlwZU9mXCIpKXtyZXR1cm4gZmFsc2V9dmFyIGM7Zm9yKGMgaW4gYSl7fXJldHVybiBjPT09Ynx8RC5jYWxsKGEsYyl9LGlzRW1wdHlPYmplY3Q6ZnVuY3Rpb24oYSl7Zm9yKHZhciBiIGluIGEpe3JldHVybiBmYWxzZX1yZXR1cm4gdHJ1ZX0sZXJyb3I6ZnVuY3Rpb24oYSl7dGhyb3cgYX0scGFyc2VKU09OOmZ1bmN0aW9uKGIpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcInx8IWIpe3JldHVybiBudWxsfWI9ZS50cmltKGIpO2lmKGEuSlNPTiYmYS5KU09OLnBhcnNlKXtyZXR1cm4gYS5KU09OLnBhcnNlKGIpfWlmKG8udGVzdChiLnJlcGxhY2UocCxcIkBcIikucmVwbGFjZShxLFwiXVwiKS5yZXBsYWNlKHIsXCJcIikpKXtyZXR1cm4obmV3IEZ1bmN0aW9uKFwicmV0dXJuIFwiK2IpKSgpfWUuZXJyb3IoXCJJbnZhbGlkIEpTT046IFwiK2IpfSxwYXJzZVhNTDpmdW5jdGlvbihjKXt2YXIgZCxmO3RyeXtpZihhLkRPTVBhcnNlcil7Zj1uZXcgRE9NUGFyc2VyO2Q9Zi5wYXJzZUZyb21TdHJpbmcoYyxcInRleHQveG1sXCIpfWVsc2V7ZD1uZXcgQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxET01cIik7ZC5hc3luYz1cImZhbHNlXCI7ZC5sb2FkWE1MKGMpfX1jYXRjaChnKXtkPWJ9aWYoIWR8fCFkLmRvY3VtZW50RWxlbWVudHx8ZC5nZXRFbGVtZW50c0J5VGFnTmFtZShcInBhcnNlcmVycm9yXCIpLmxlbmd0aCl7ZS5lcnJvcihcIkludmFsaWQgWE1MOiBcIitjKX1yZXR1cm4gZH0sbm9vcDpmdW5jdGlvbigpe30sZ2xvYmFsRXZhbDpmdW5jdGlvbihiKXtpZihiJiZqLnRlc3QoYikpeyhhLmV4ZWNTY3JpcHR8fGZ1bmN0aW9uKGIpe2FbXCJldmFsXCJdLmNhbGwoYSxiKX0pKGIpfX0sY2FtZWxDYXNlOmZ1bmN0aW9uKGEpe3JldHVybiBhLnJlcGxhY2Uodyx4KX0sbm9kZU5hbWU6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYS5ub2RlTmFtZSYmYS5ub2RlTmFtZS50b1VwcGVyQ2FzZSgpPT09Yi50b1VwcGVyQ2FzZSgpfSxlYWNoOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnPTAsaD1hLmxlbmd0aCxpPWg9PT1ifHxlLmlzRnVuY3Rpb24oYSk7aWYoZCl7aWYoaSl7Zm9yKGYgaW4gYSl7aWYoYy5hcHBseShhW2ZdLGQpPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuYXBwbHkoYVtnKytdLGQpPT09ZmFsc2Upe2JyZWFrfX19fWVsc2V7aWYoaSl7Zm9yKGYgaW4gYSl7aWYoYy5jYWxsKGFbZl0sZixhW2ZdKT09PWZhbHNlKXticmVha319fWVsc2V7Zm9yKDtnPGg7KXtpZihjLmNhbGwoYVtnXSxnLGFbZysrXSk9PT1mYWxzZSl7YnJlYWt9fX19cmV0dXJuIGF9LHRyaW06Rz9mdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOkcuY2FsbChhKX06ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/XCJcIjphLnRvU3RyaW5nKCkucmVwbGFjZShrLFwiXCIpLnJlcGxhY2UobCxcIlwiKX0sbWFrZUFycmF5OmZ1bmN0aW9uKGEsYil7dmFyIGM9Ynx8W107aWYoYSE9bnVsbCl7dmFyIGQ9ZS50eXBlKGEpO2lmKGEubGVuZ3RoPT1udWxsfHxkPT09XCJzdHJpbmdcInx8ZD09PVwiZnVuY3Rpb25cInx8ZD09PVwicmVnZXhwXCJ8fGUuaXNXaW5kb3coYSkpe0UuY2FsbChjLGEpfWVsc2V7ZS5tZXJnZShjLGEpfX1yZXR1cm4gY30saW5BcnJheTpmdW5jdGlvbihhLGIpe2lmKEgpe3JldHVybiBILmNhbGwoYixhKX1mb3IodmFyIGM9MCxkPWIubGVuZ3RoO2M8ZDtjKyspe2lmKGJbY109PT1hKXtyZXR1cm4gY319cmV0dXJuLTF9LG1lcmdlOmZ1bmN0aW9uKGEsYyl7dmFyIGQ9YS5sZW5ndGgsZT0wO2lmKHR5cGVvZiBjLmxlbmd0aD09PVwibnVtYmVyXCIpe2Zvcih2YXIgZj1jLmxlbmd0aDtlPGY7ZSsrKXthW2QrK109Y1tlXX19ZWxzZXt3aGlsZShjW2VdIT09Yil7YVtkKytdPWNbZSsrXX19YS5sZW5ndGg9ZDtyZXR1cm4gYX0sZ3JlcDpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9W10sZTtjPSEhYztmb3IodmFyIGY9MCxnPWEubGVuZ3RoO2Y8ZztmKyspe2U9ISFiKGFbZl0sZik7aWYoYyE9PWUpe2QucHVzaChhW2ZdKX19cmV0dXJuIGR9LG1hcDpmdW5jdGlvbihhLGMsZCl7dmFyIGYsZyxoPVtdLGk9MCxqPWEubGVuZ3RoLGs9YSBpbnN0YW5jZW9mIGV8fGohPT1iJiZ0eXBlb2Ygaj09PVwibnVtYmVyXCImJihqPjAmJmFbMF0mJmFbai0xXXx8aj09PTB8fGUuaXNBcnJheShhKSk7aWYoayl7Zm9yKDtpPGo7aSsrKXtmPWMoYVtpXSxpLGQpO2lmKGYhPW51bGwpe2hbaC5sZW5ndGhdPWZ9fX1lbHNle2ZvcihnIGluIGEpe2Y9YyhhW2ddLGcsZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fXJldHVybiBoLmNvbmNhdC5hcHBseShbXSxoKX0sZ3VpZDoxLHByb3h5OmZ1bmN0aW9uKGEsYyl7aWYodHlwZW9mIGM9PT1cInN0cmluZ1wiKXt2YXIgZD1hW2NdO2M9YTthPWR9aWYoIWUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGJ9dmFyIGY9Ri5jYWxsKGFyZ3VtZW50cywyKSxnPWZ1bmN0aW9uKCl7cmV0dXJuIGEuYXBwbHkoYyxmLmNvbmNhdChGLmNhbGwoYXJndW1lbnRzKSkpfTtnLmd1aWQ9YS5ndWlkPWEuZ3VpZHx8Zy5ndWlkfHxlLmd1aWQrKztyZXR1cm4gZ30sYWNjZXNzOmZ1bmN0aW9uKGEsYyxkLGYsZyxoKXt2YXIgaT1hLmxlbmd0aDtpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2Zvcih2YXIgaiBpbiBjKXtlLmFjY2VzcyhhLGosY1tqXSxmLGcsZCl9cmV0dXJuIGF9aWYoZCE9PWIpe2Y9IWgmJmYmJmUuaXNGdW5jdGlvbihkKTtmb3IodmFyIGs9MDtrPGk7aysrKXtnKGFba10sYyxmP2QuY2FsbChhW2tdLGssZyhhW2tdLGMpKTpkLGgpfXJldHVybiBhfXJldHVybiBpP2coYVswXSxjKTpifSxub3c6ZnVuY3Rpb24oKXtyZXR1cm4obmV3IERhdGUpLmdldFRpbWUoKX0sdWFNYXRjaDpmdW5jdGlvbihhKXthPWEudG9Mb3dlckNhc2UoKTt2YXIgYj1zLmV4ZWMoYSl8fHQuZXhlYyhhKXx8dS5leGVjKGEpfHxhLmluZGV4T2YoXCJjb21wYXRpYmxlXCIpPDAmJnYuZXhlYyhhKXx8W107cmV0dXJue2Jyb3dzZXI6YlsxXXx8XCJcIix2ZXJzaW9uOmJbMl18fFwiMFwifX0sc3ViOmZ1bmN0aW9uKCl7ZnVuY3Rpb24gYShiLGMpe3JldHVybiBuZXcgYS5mbi5pbml0KGIsYyl9ZS5leHRlbmQodHJ1ZSxhLHRoaXMpO2Euc3VwZXJjbGFzcz10aGlzO2EuZm49YS5wcm90b3R5cGU9dGhpcygpO2EuZm4uY29uc3RydWN0b3I9YTthLnN1Yj10aGlzLnN1YjthLmZuLmluaXQ9ZnVuY3Rpb24gZChjLGQpe2lmKGQmJmQgaW5zdGFuY2VvZiBlJiYhKGQgaW5zdGFuY2VvZiBhKSl7ZD1hKGQpfXJldHVybiBlLmZuLmluaXQuY2FsbCh0aGlzLGMsZCxiKX07YS5mbi5pbml0LnByb3RvdHlwZT1hLmZuO3ZhciBiPWEoYyk7cmV0dXJuIGF9LGJyb3dzZXI6e319KTtlLmVhY2goXCJCb29sZWFuIE51bWJlciBTdHJpbmcgRnVuY3Rpb24gQXJyYXkgRGF0ZSBSZWdFeHAgT2JqZWN0XCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7SVtcIltvYmplY3QgXCIrYitcIl1cIl09Yi50b0xvd2VyQ2FzZSgpfSk7ej1lLnVhTWF0Y2goeSk7aWYoei5icm93c2VyKXtlLmJyb3dzZXJbei5icm93c2VyXT10cnVlO2UuYnJvd3Nlci52ZXJzaW9uPXoudmVyc2lvbn1pZihlLmJyb3dzZXIud2Via2l0KXtlLmJyb3dzZXIuc2FmYXJpPXRydWV9aWYoai50ZXN0KFwiwqBcIikpe2s9L15bXFxzXFx4QTBdKy87bD0vW1xcc1xceEEwXSskL31oPWUoYyk7aWYoYy5hZGRFdmVudExpc3RlbmVyKXtCPWZ1bmN0aW9uKCl7Yy5yZW1vdmVFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLEIsZmFsc2UpO2UucmVhZHkoKX19ZWxzZSBpZihjLmF0dGFjaEV2ZW50KXtCPWZ1bmN0aW9uKCl7aWYoYy5yZWFkeVN0YXRlPT09XCJjb21wbGV0ZVwiKXtjLmRldGFjaEV2ZW50KFwib25yZWFkeXN0YXRlY2hhbmdlXCIsQik7ZS5yZWFkeSgpfX19cmV0dXJuIGV9KCk7dmFyIGc9XCJkb25lIGZhaWwgaXNSZXNvbHZlZCBpc1JlamVjdGVkIHByb21pc2UgdGhlbiBhbHdheXMgcGlwZVwiLnNwbGl0KFwiIFwiKSxoPVtdLnNsaWNlO2YuZXh0ZW5kKHtfRGVmZXJyZWQ6ZnVuY3Rpb24oKXt2YXIgYT1bXSxiLGMsZCxlPXtkb25lOmZ1bmN0aW9uKCl7aWYoIWQpe3ZhciBjPWFyZ3VtZW50cyxnLGgsaSxqLGs7aWYoYil7az1iO2I9MH1mb3IoZz0wLGg9Yy5sZW5ndGg7ZzxoO2crKyl7aT1jW2ddO2o9Zi50eXBlKGkpO2lmKGo9PT1cImFycmF5XCIpe2UuZG9uZS5hcHBseShlLGkpfWVsc2UgaWYoaj09PVwiZnVuY3Rpb25cIil7YS5wdXNoKGkpfX1pZihrKXtlLnJlc29sdmVXaXRoKGtbMF0sa1sxXSl9fXJldHVybiB0aGlzfSxyZXNvbHZlV2l0aDpmdW5jdGlvbihlLGYpe2lmKCFkJiYhYiYmIWMpe2Y9Znx8W107Yz0xO3RyeXt3aGlsZShhWzBdKXthLnNoaWZ0KCkuYXBwbHkoZSxmKX19ZmluYWxseXtiPVtlLGZdO2M9MH19cmV0dXJuIHRoaXN9LHJlc29sdmU6ZnVuY3Rpb24oKXtlLnJlc29sdmVXaXRoKHRoaXMsYXJndW1lbnRzKTtyZXR1cm4gdGhpc30saXNSZXNvbHZlZDpmdW5jdGlvbigpe3JldHVybiEhKGN8fGIpfSxjYW5jZWw6ZnVuY3Rpb24oKXtkPTE7YT1bXTtyZXR1cm4gdGhpc319O3JldHVybiBlfSxEZWZlcnJlZDpmdW5jdGlvbihhKXt2YXIgYj1mLl9EZWZlcnJlZCgpLGM9Zi5fRGVmZXJyZWQoKSxkO2YuZXh0ZW5kKGIse3RoZW46ZnVuY3Rpb24oYSxjKXtiLmRvbmUoYSkuZmFpbChjKTtyZXR1cm4gdGhpc30sYWx3YXlzOmZ1bmN0aW9uKCl7cmV0dXJuIGIuZG9uZS5hcHBseShiLGFyZ3VtZW50cykuZmFpbC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9LGZhaWw6Yy5kb25lLHJlamVjdFdpdGg6Yy5yZXNvbHZlV2l0aCxyZWplY3Q6Yy5yZXNvbHZlLGlzUmVqZWN0ZWQ6Yy5pc1Jlc29sdmVkLHBpcGU6ZnVuY3Rpb24oYSxjKXtyZXR1cm4gZi5EZWZlcnJlZChmdW5jdGlvbihkKXtmLmVhY2goe2RvbmU6W2EsXCJyZXNvbHZlXCJdLGZhaWw6W2MsXCJyZWplY3RcIl19LGZ1bmN0aW9uKGEsYyl7dmFyIGU9Y1swXSxnPWNbMV0saDtpZihmLmlzRnVuY3Rpb24oZSkpe2JbYV0oZnVuY3Rpb24oKXtoPWUuYXBwbHkodGhpcyxhcmd1bWVudHMpO2lmKGgmJmYuaXNGdW5jdGlvbihoLnByb21pc2UpKXtoLnByb21pc2UoKS50aGVuKGQucmVzb2x2ZSxkLnJlamVjdCl9ZWxzZXtkW2crXCJXaXRoXCJdKHRoaXM9PT1iP2Q6dGhpcyxbaF0pfX0pfWVsc2V7YlthXShkW2ddKX19KX0pLnByb21pc2UoKX0scHJvbWlzZTpmdW5jdGlvbihhKXtpZihhPT1udWxsKXtpZihkKXtyZXR1cm4gZH1kPWE9e319dmFyIGM9Zy5sZW5ndGg7d2hpbGUoYy0tKXthW2dbY11dPWJbZ1tjXV19cmV0dXJuIGF9fSk7Yi5kb25lKGMuY2FuY2VsKS5mYWlsKGIuY2FuY2VsKTtkZWxldGUgYi5jYW5jZWw7aWYoYSl7YS5jYWxsKGIsYil9cmV0dXJuIGJ9LHdoZW46ZnVuY3Rpb24oYSl7ZnVuY3Rpb24gaShhKXtyZXR1cm4gZnVuY3Rpb24oYyl7YlthXT1hcmd1bWVudHMubGVuZ3RoPjE/aC5jYWxsKGFyZ3VtZW50cywwKTpjO2lmKCEtLWUpe2cucmVzb2x2ZVdpdGgoZyxoLmNhbGwoYiwwKSl9fX12YXIgYj1hcmd1bWVudHMsYz0wLGQ9Yi5sZW5ndGgsZT1kLGc9ZDw9MSYmYSYmZi5pc0Z1bmN0aW9uKGEucHJvbWlzZSk/YTpmLkRlZmVycmVkKCk7aWYoZD4xKXtmb3IoO2M8ZDtjKyspe2lmKGJbY10mJmYuaXNGdW5jdGlvbihiW2NdLnByb21pc2UpKXtiW2NdLnByb21pc2UoKS50aGVuKGkoYyksZy5yZWplY3QpfWVsc2V7LS1lfX1pZighZSl7Zy5yZXNvbHZlV2l0aChnLGIpfX1lbHNlIGlmKGchPT1hKXtnLnJlc29sdmVXaXRoKGcsZD9bYV06W10pfXJldHVybiBnLnByb21pc2UoKX19KTtmLnN1cHBvcnQ9Zi5zdXBwb3J0fHx7fTt2YXIgaT0vJTIwL2csaj0vXFxbXFxdJC8saz0vXFxyP1xcbi9nLGw9LyMuKiQvLG09L14oLio/KTpbIFxcdF0qKFteXFxyXFxuXSopXFxyPyQvbWcsbj0vXig/OmNvbG9yfGRhdGV8ZGF0ZXRpbWV8ZW1haWx8aGlkZGVufG1vbnRofG51bWJlcnxwYXNzd29yZHxyYW5nZXxzZWFyY2h8dGVsfHRleHR8dGltZXx1cmx8d2VlaykkL2ksbz0vXig/OmFib3V0fGFwcHxhcHBcXC1zdG9yYWdlfC4rXFwtZXh0ZW5zaW9ufGZpbGV8cmVzfHdpZGdldCk6JC8scD0vXig/OkdFVHxIRUFEKSQvLHE9L15cXC9cXC8vLHI9L1xcPy8scz0vPHNjcmlwdFxcYltePF0qKD86KD8hPFxcL3NjcmlwdD4pPFtePF0qKSo8XFwvc2NyaXB0Pi9naSx0PS9eKD86c2VsZWN0fHRleHRhcmVhKS9pLHU9L1xccysvLHY9LyhbPyZdKV89W14mXSovLHc9L14oW1xcd1xcK1xcLlxcLV0rOikoPzpcXC9cXC8oW15cXC8/IzpdKikoPzo6KFxcZCspKT8pPy8seD1mLmZuLmxvYWQseT17fSx6PXt9LEEsQjt0cnl7QT1lLmhyZWZ9Y2F0Y2goQyl7QT1jLmNyZWF0ZUVsZW1lbnQoXCJhXCIpO0EuaHJlZj1cIlwiO0E9QS5ocmVmfUI9dy5leGVjKEEudG9Mb3dlckNhc2UoKSl8fFtdO2YuZm4uZXh0ZW5kKHtsb2FkOmZ1bmN0aW9uKGEsYyxkKXtpZih0eXBlb2YgYSE9PVwic3RyaW5nXCImJngpe3JldHVybiB4LmFwcGx5KHRoaXMsYXJndW1lbnRzKX1lbHNlIGlmKCF0aGlzLmxlbmd0aCl7cmV0dXJuIHRoaXN9dmFyIGU9YS5pbmRleE9mKFwiIFwiKTtpZihlPj0wKXt2YXIgZz1hLnNsaWNlKGUsYS5sZW5ndGgpO2E9YS5zbGljZSgwLGUpfXZhciBoPVwiR0VUXCI7aWYoYyl7aWYoZi5pc0Z1bmN0aW9uKGMpKXtkPWM7Yz1ifWVsc2UgaWYodHlwZW9mIGM9PT1cIm9iamVjdFwiKXtjPWYucGFyYW0oYyxmLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbCk7aD1cIlBPU1RcIn19dmFyIGk9dGhpcztmLmFqYXgoe3VybDphLHR5cGU6aCxkYXRhVHlwZTpcImh0bWxcIixkYXRhOmMsY29tcGxldGU6ZnVuY3Rpb24oYSxiLGMpe2M9YS5yZXNwb25zZVRleHQ7aWYoYS5pc1Jlc29sdmVkKCkpe2EuZG9uZShmdW5jdGlvbihhKXtjPWF9KTtpLmh0bWwoZz9mKFwiPGRpdj5cIikuYXBwZW5kKGMucmVwbGFjZShzLFwiXCIpKS5maW5kKGcpOmMpfWlmKGQpe2kuZWFjaChkLFtjLGIsYV0pfX19KTtyZXR1cm4gdGhpc30sc2VyaWFsaXplOmZ1bmN0aW9uKCl7cmV0dXJuIGYucGFyYW0odGhpcy5zZXJpYWxpemVBcnJheSgpKX0sc2VyaWFsaXplQXJyYXk6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5tYXAoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lbGVtZW50cz9mLm1ha2VBcnJheSh0aGlzLmVsZW1lbnRzKTp0aGlzfSkuZmlsdGVyKGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubmFtZSYmIXRoaXMuZGlzYWJsZWQmJih0aGlzLmNoZWNrZWR8fHQudGVzdCh0aGlzLm5vZGVOYW1lKXx8bi50ZXN0KHRoaXMudHlwZSkpfSkubWFwKGZ1bmN0aW9uKGEsYil7dmFyIGM9Zih0aGlzKS52YWwoKTtyZXR1cm4gYz09bnVsbD9udWxsOmYuaXNBcnJheShjKT9mLm1hcChjLGZ1bmN0aW9uKGEsYyl7cmV0dXJue25hbWU6Yi5uYW1lLHZhbHVlOmEucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pOntuYW1lOmIubmFtZSx2YWx1ZTpjLnJlcGxhY2UoayxcIlxcclxcblwiKX19KS5nZXQoKX19KTtmLmVhY2goXCJhamF4U3RhcnQgYWpheFN0b3AgYWpheENvbXBsZXRlIGFqYXhFcnJvciBhamF4U3VjY2VzcyBhamF4U2VuZFwiLnNwbGl0KFwiIFwiKSxmdW5jdGlvbihhLGIpe2YuZm5bYl09ZnVuY3Rpb24oYSl7cmV0dXJuIHRoaXMuYmluZChiLGEpfX0pO2YuZWFjaChbXCJnZXRcIixcInBvc3RcIl0sZnVuY3Rpb24oYSxjKXtmW2NdPWZ1bmN0aW9uKGEsZCxlLGcpe2lmKGYuaXNGdW5jdGlvbihkKSl7Zz1nfHxlO2U9ZDtkPWJ9cmV0dXJuIGYuYWpheCh7dHlwZTpjLHVybDphLGRhdGE6ZCxzdWNjZXNzOmUsZGF0YVR5cGU6Z30pfX0pO2YuZXh0ZW5kKHtnZXRTY3JpcHQ6ZnVuY3Rpb24oYSxjKXtyZXR1cm4gZi5nZXQoYSxiLGMsXCJzY3JpcHRcIil9LGdldEpTT046ZnVuY3Rpb24oYSxiLGMpe3JldHVybiBmLmdldChhLGIsYyxcImpzb25cIil9LGFqYXhTZXR1cDpmdW5jdGlvbihhLGIpe2lmKGIpe0YoYSxmLmFqYXhTZXR0aW5ncyl9ZWxzZXtiPWE7YT1mLmFqYXhTZXR0aW5nc31GKGEsYik7cmV0dXJuIGF9LGFqYXhTZXR0aW5nczp7dXJsOkEsaXNMb2NhbDpvLnRlc3QoQlsxXSksZ2xvYmFsOnRydWUsdHlwZTpcIkdFVFwiLGNvbnRlbnRUeXBlOlwiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkXCIscHJvY2Vzc0RhdGE6dHJ1ZSxhc3luYzp0cnVlLGFjY2VwdHM6e3htbDpcImFwcGxpY2F0aW9uL3htbCwgdGV4dC94bWxcIixodG1sOlwidGV4dC9odG1sXCIsdGV4dDpcInRleHQvcGxhaW5cIixqc29uOlwiYXBwbGljYXRpb24vanNvbiwgdGV4dC9qYXZhc2NyaXB0XCIsXCIqXCI6XCIqLypcIn0sY29udGVudHM6e3htbDoveG1sLyxodG1sOi9odG1sLyxqc29uOi9qc29uL30scmVzcG9uc2VGaWVsZHM6e3htbDpcInJlc3BvbnNlWE1MXCIsdGV4dDpcInJlc3BvbnNlVGV4dFwifSxjb252ZXJ0ZXJzOntcIiogdGV4dFwiOmEuU3RyaW5nLFwidGV4dCBodG1sXCI6dHJ1ZSxcInRleHQganNvblwiOmYucGFyc2VKU09OLFwidGV4dCB4bWxcIjpmLnBhcnNlWE1MfSxmbGF0T3B0aW9uczp7Y29udGV4dDp0cnVlLHVybDp0cnVlfX0sYWpheFByZWZpbHRlcjpEKHkpLGFqYXhUcmFuc3BvcnQ6RCh6KSxhamF4OmZ1bmN0aW9uKGEsYyl7ZnVuY3Rpb24gSyhhLGMsbCxtKXtpZihEPT09Mil7cmV0dXJufUQ9MjtpZihBKXtjbGVhclRpbWVvdXQoQSl9eD1iO3M9bXx8XCJcIjtKLnJlYWR5U3RhdGU9YT4wPzQ6MDt2YXIgbixvLHAscT1jLHI9bD9IKGQsSixsKTpiLHQsdTtpZihhPj0yMDAmJmE8MzAwfHxhPT09MzA0KXtpZihkLmlmTW9kaWZpZWQpe2lmKHQ9Si5nZXRSZXNwb25zZUhlYWRlcihcIkxhc3QtTW9kaWZpZWRcIikpe2YubGFzdE1vZGlmaWVkW2tdPXR9aWYodT1KLmdldFJlc3BvbnNlSGVhZGVyKFwiRXRhZ1wiKSl7Zi5ldGFnW2tdPXV9fWlmKGE9PT0zMDQpe3E9XCJub3Rtb2RpZmllZFwiO249dHJ1ZX1lbHNle3RyeXtvPUkoZCxyKTtxPVwic3VjY2Vzc1wiO249dHJ1ZX1jYXRjaCh2KXtxPVwicGFyc2VyZXJyb3JcIjtwPXZ9fX1lbHNle3A9cTtpZighcXx8YSl7cT1cImVycm9yXCI7aWYoYTwwKXthPTB9fX1KLnN0YXR1cz1hO0ouc3RhdHVzVGV4dD1cIlwiKyhjfHxxKTtpZihuKXtoLnJlc29sdmVXaXRoKGUsW28scSxKXSl9ZWxzZXtoLnJlamVjdFdpdGgoZSxbSixxLHBdKX1KLnN0YXR1c0NvZGUoaik7aj1iO2lmKEYpe2cudHJpZ2dlcihcImFqYXhcIisobj9cIlN1Y2Nlc3NcIjpcIkVycm9yXCIpLFtKLGQsbj9vOnBdKX1pLnJlc29sdmVXaXRoKGUsW0oscV0pO2lmKEYpe2cudHJpZ2dlcihcImFqYXhDb21wbGV0ZVwiLFtKLGRdKTtpZighLS1mLmFjdGl2ZSl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0b3BcIil9fX1pZih0eXBlb2YgYT09PVwib2JqZWN0XCIpe2M9YTthPWJ9Yz1jfHx7fTt2YXIgZD1mLmFqYXhTZXR1cCh7fSxjKSxlPWQuY29udGV4dHx8ZCxnPWUhPT1kJiYoZS5ub2RlVHlwZXx8ZSBpbnN0YW5jZW9mIGYpP2YoZSk6Zi5ldmVudCxoPWYuRGVmZXJyZWQoKSxpPWYuX0RlZmVycmVkKCksaj1kLnN0YXR1c0NvZGV8fHt9LGssbj17fSxvPXt9LHMsdCx4LEEsQyxEPTAsRixHLEo9e3JlYWR5U3RhdGU6MCxzZXRSZXF1ZXN0SGVhZGVyOmZ1bmN0aW9uKGEsYil7aWYoIUQpe3ZhciBjPWEudG9Mb3dlckNhc2UoKTthPW9bY109b1tjXXx8YTtuW2FdPWJ9cmV0dXJuIHRoaXN9LGdldEFsbFJlc3BvbnNlSGVhZGVyczpmdW5jdGlvbigpe3JldHVybiBEPT09Mj9zOm51bGx9LGdldFJlc3BvbnNlSGVhZGVyOmZ1bmN0aW9uKGEpe3ZhciBjO2lmKEQ9PT0yKXtpZighdCl7dD17fTt3aGlsZShjPW0uZXhlYyhzKSl7dFtjWzFdLnRvTG93ZXJDYXNlKCldPWNbMl19fWM9dFthLnRvTG93ZXJDYXNlKCldfXJldHVybiBjPT09Yj9udWxsOmN9LG92ZXJyaWRlTWltZVR5cGU6ZnVuY3Rpb24oYSl7aWYoIUQpe2QubWltZVR5cGU9YX1yZXR1cm4gdGhpc30sYWJvcnQ6ZnVuY3Rpb24oYSl7YT1hfHxcImFib3J0XCI7aWYoeCl7eC5hYm9ydChhKX1LKDAsYSk7cmV0dXJuIHRoaXN9fTtoLnByb21pc2UoSik7Si5zdWNjZXNzPUouZG9uZTtKLmVycm9yPUouZmFpbDtKLmNvbXBsZXRlPWkuZG9uZTtKLnN0YXR1c0NvZGU9ZnVuY3Rpb24oYSl7aWYoYSl7dmFyIGI7aWYoRDwyKXtmb3IoYiBpbiBhKXtqW2JdPVtqW2JdLGFbYl1dfX1lbHNle2I9YVtKLnN0YXR1c107Si50aGVuKGIsYil9fXJldHVybiB0aGlzfTtkLnVybD0oKGF8fGQudXJsKStcIlwiKS5yZXBsYWNlKGwsXCJcIikucmVwbGFjZShxLEJbMV0rXCIvL1wiKTtkLmRhdGFUeXBlcz1mLnRyaW0oZC5kYXRhVHlwZXx8XCIqXCIpLnRvTG93ZXJDYXNlKCkuc3BsaXQodSk7aWYoZC5jcm9zc0RvbWFpbj09bnVsbCl7Qz13LmV4ZWMoZC51cmwudG9Mb3dlckNhc2UoKSk7ZC5jcm9zc0RvbWFpbj0hIShDJiYoQ1sxXSE9QlsxXXx8Q1syXSE9QlsyXXx8KENbM118fChDWzFdPT09XCJodHRwOlwiPzgwOjQ0MykpIT0oQlszXXx8KEJbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkpKX1pZihkLmRhdGEmJmQucHJvY2Vzc0RhdGEmJnR5cGVvZiBkLmRhdGEhPT1cInN0cmluZ1wiKXtkLmRhdGE9Zi5wYXJhbShkLmRhdGEsZC50cmFkaXRpb25hbCl9RSh5LGQsYyxKKTtpZihEPT09Mil7cmV0dXJuIGZhbHNlfUY9ZC5nbG9iYWw7ZC50eXBlPWQudHlwZS50b1VwcGVyQ2FzZSgpO2QuaGFzQ29udGVudD0hcC50ZXN0KGQudHlwZSk7aWYoRiYmZi5hY3RpdmUrKz09PTApe2YuZXZlbnQudHJpZ2dlcihcImFqYXhTdGFydFwiKX1pZighZC5oYXNDb250ZW50KXtpZihkLmRhdGEpe2QudXJsKz0oci50ZXN0KGQudXJsKT9cIiZcIjpcIj9cIikrZC5kYXRhO2RlbGV0ZSBkLmRhdGF9az1kLnVybDtpZihkLmNhY2hlPT09ZmFsc2Upe3ZhciBMPWYubm93KCksTT1kLnVybC5yZXBsYWNlKHYsXCIkMV89XCIrTCk7ZC51cmw9TSsoTT09PWQudXJsPyhyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStcIl89XCIrTDpcIlwiKX19aWYoZC5kYXRhJiZkLmhhc0NvbnRlbnQmJmQuY29udGVudFR5cGUhPT1mYWxzZXx8Yy5jb250ZW50VHlwZSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsZC5jb250ZW50VHlwZSl9aWYoZC5pZk1vZGlmaWVkKXtrPWt8fGQudXJsO2lmKGYubGFzdE1vZGlmaWVkW2tdKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJJZi1Nb2RpZmllZC1TaW5jZVwiLGYubGFzdE1vZGlmaWVkW2tdKX1pZihmLmV0YWdba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU5vbmUtTWF0Y2hcIixmLmV0YWdba10pfX1KLnNldFJlcXVlc3RIZWFkZXIoXCJBY2NlcHRcIixkLmRhdGFUeXBlc1swXSYmZC5hY2NlcHRzW2QuZGF0YVR5cGVzWzBdXT9kLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dKyhkLmRhdGFUeXBlc1swXSE9PVwiKlwiP1wiLCAqLyo7IHE9MC4wMVwiOlwiXCIpOmQuYWNjZXB0c1tcIipcIl0pO2ZvcihHIGluIGQuaGVhZGVycyl7Si5zZXRSZXF1ZXN0SGVhZGVyKEcsZC5oZWFkZXJzW0ddKX1pZihkLmJlZm9yZVNlbmQmJihkLmJlZm9yZVNlbmQuY2FsbChlLEosZCk9PT1mYWxzZXx8RD09PTIpKXtKLmFib3J0KCk7cmV0dXJuIGZhbHNlfWZvcihHIGlue3N1Y2Nlc3M6MSxlcnJvcjoxLGNvbXBsZXRlOjF9KXtKW0ddKGRbR10pfXg9RSh6LGQsYyxKKTtpZigheCl7SygtMSxcIk5vIFRyYW5zcG9ydFwiKX1lbHNle0oucmVhZHlTdGF0ZT0xO2lmKEYpe2cudHJpZ2dlcihcImFqYXhTZW5kXCIsW0osZF0pfWlmKGQuYXN5bmMmJmQudGltZW91dD4wKXtBPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtKLmFib3J0KFwidGltZW91dFwiKX0sZC50aW1lb3V0KX10cnl7RD0xO3guc2VuZChuLEspfWNhdGNoKE4pe2lmKEQ8Mil7SygtMSxOKX1lbHNle2YuZXJyb3IoTil9fX1yZXR1cm4gSn0scGFyYW06ZnVuY3Rpb24oYSxjKXt2YXIgZD1bXSxlPWZ1bmN0aW9uKGEsYil7Yj1mLmlzRnVuY3Rpb24oYik/YigpOmI7ZFtkLmxlbmd0aF09ZW5jb2RlVVJJQ29tcG9uZW50KGEpK1wiPVwiK2VuY29kZVVSSUNvbXBvbmVudChiKX07aWYoYz09PWIpe2M9Zi5hamF4U2V0dGluZ3MudHJhZGl0aW9uYWx9aWYoZi5pc0FycmF5KGEpfHxhLmpxdWVyeSYmIWYuaXNQbGFpbk9iamVjdChhKSl7Zi5lYWNoKGEsZnVuY3Rpb24oKXtlKHRoaXMubmFtZSx0aGlzLnZhbHVlKX0pfWVsc2V7Zm9yKHZhciBnIGluIGEpe0coZyxhW2ddLGMsZSl9fXJldHVybiBkLmpvaW4oXCImXCIpLnJlcGxhY2UoaSxcIitcIil9fSk7Zi5leHRlbmQoe2FjdGl2ZTowLGxhc3RNb2RpZmllZDp7fSxldGFnOnt9fSk7dmFyIEo9YS5BY3RpdmVYT2JqZWN0P2Z1bmN0aW9uKCl7Zm9yKHZhciBhIGluIEwpe0xbYV0oMCwxKX19OmZhbHNlLEs9MCxMO2YuYWpheFNldHRpbmdzLnhocj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtyZXR1cm4hdGhpcy5pc0xvY2FsJiZNKCl8fE4oKX06TTsoZnVuY3Rpb24oYSl7Zi5leHRlbmQoZi5zdXBwb3J0LHthamF4OiEhYSxjb3JzOiEhYSYmXCJ3aXRoQ3JlZGVudGlhbHNcImluIGF9KX0pKGYuYWpheFNldHRpbmdzLnhocigpKTtpZihmLnN1cHBvcnQuYWpheCl7Zi5hamF4VHJhbnNwb3J0KGZ1bmN0aW9uKGMpe2lmKCFjLmNyb3NzRG9tYWlufHxmLnN1cHBvcnQuY29ycyl7dmFyIGQ7cmV0dXJue3NlbmQ6ZnVuY3Rpb24oZSxnKXt2YXIgaD1jLnhocigpLGksajtpZihjLnVzZXJuYW1lKXtoLm9wZW4oYy50eXBlLGMudXJsLGMuYXN5bmMsYy51c2VybmFtZSxjLnBhc3N3b3JkKX1lbHNle2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyl9aWYoYy54aHJGaWVsZHMpe2ZvcihqIGluIGMueGhyRmllbGRzKXtoW2pdPWMueGhyRmllbGRzW2pdfX1pZihjLm1pbWVUeXBlJiZoLm92ZXJyaWRlTWltZVR5cGUpe2gub3ZlcnJpZGVNaW1lVHlwZShjLm1pbWVUeXBlKX1pZighYy5jcm9zc0RvbWFpbiYmIWVbXCJYLVJlcXVlc3RlZC1XaXRoXCJdKXtlW1wiWC1SZXF1ZXN0ZWQtV2l0aFwiXT1cIlhNTEh0dHBSZXF1ZXN0XCJ9dHJ5e2ZvcihqIGluIGUpe2guc2V0UmVxdWVzdEhlYWRlcihqLGVbal0pfX1jYXRjaChrKXt9aC5zZW5kKGMuaGFzQ29udGVudCYmYy5kYXRhfHxudWxsKTtkPWZ1bmN0aW9uKGEsZSl7dmFyIGosayxsLG0sbjt0cnl7aWYoZCYmKGV8fGgucmVhZHlTdGF0ZT09PTQpKXtkPWI7aWYoaSl7aC5vbnJlYWR5c3RhdGVjaGFuZ2U9Zi5ub29wO2lmKEope2RlbGV0ZSBMW2ldfX1pZihlKXtpZihoLnJlYWR5U3RhdGUhPT00KXtoLmFib3J0KCl9fWVsc2V7aj1oLnN0YXR1cztsPWguZ2V0QWxsUmVzcG9uc2VIZWFkZXJzKCk7bT17fTtuPWgucmVzcG9uc2VYTUw7aWYobiYmbi5kb2N1bWVudEVsZW1lbnQpe20ueG1sPW59bS50ZXh0PWgucmVzcG9uc2VUZXh0O3RyeXtrPWguc3RhdHVzVGV4dH1jYXRjaChvKXtrPVwiXCJ9aWYoIWomJmMuaXNMb2NhbCYmIWMuY3Jvc3NEb21haW4pe2o9bS50ZXh0PzIwMDo0MDR9ZWxzZSBpZihqPT09MTIyMyl7aj0yMDR9fX19Y2F0Y2gocCl7aWYoIWUpe2coLTEscCl9fWlmKG0pe2coaixrLG0sbCl9fTtpZighYy5hc3luY3x8aC5yZWFkeVN0YXRlPT09NCl7ZCgpfWVsc2V7aT0rK0s7aWYoSil7aWYoIUwpe0w9e307ZihhKS51bmxvYWQoSil9TFtpXT1kfWgub25yZWFkeXN0YXRlY2hhbmdlPWR9fSxhYm9ydDpmdW5jdGlvbigpe2lmKGQpe2QoMCwxKX19fX19KX1mLmFqYXhTZXR0aW5ncy5nbG9iYWw9ZmFsc2U7YS5qUXVlcnk9YS4kPWZ9KShnbG9iYWwpfSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJBTSBmb3JtYXQ6IGh0dHBzOi8vc2FtdG9vbHMuZ2l0aHViLmlvL2h0cy1zcGVjcy9TQU12MS5wZGYgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xudmFyIFBhaXJlZEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzJykuUGFpcmVkSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG52YXIgQmFtRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvcjogJzE4OCwxODgsMTg4JyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDIwMDAsIHBhY2s6IDIwMDB9LFxuICAgIC8vIElmIGEgbnVjbGVvdGlkZSBkaWZmZXJzIGZyb20gdGhlIHJlZmVyZW5jZSBzZXF1ZW5jZSBpbiBncmVhdGVyIHRoYW4gMjAlIG9mIHF1YWxpdHkgd2VpZ2h0ZWQgcmVhZHMsIFxuICAgIC8vIElHViBjb2xvcnMgdGhlIGJhciBpbiBwcm9wb3J0aW9uIHRvIHRoZSByZWFkIGNvdW50IG9mIGVhY2ggYmFzZTsgdGhlIGZvbGxvd2luZyBjaGFuZ2VzIHRoYXQgdGhyZXNob2xkIGZvciBjaHJvbW96b29tXG4gICAgYWxsZWxlRnJlcVRocmVzaG9sZDogMC4yLFxuICAgIG9wdGltYWxGZXRjaFdpbmRvdzogMCxcbiAgICBtYXhGZXRjaFdpbmRvdzogMCxcbiAgICAvLyBUaGUgZm9sbG93aW5nIGNhbiBiZSBcImVuc2VtYmxfdWNzY1wiIG9yIFwidWNzY19lbnNlbWJsXCIgdG8gYXR0ZW1wdCBhdXRvLWNyb3NzbWFwcGluZyBvZiByZWZlcmVuY2UgY29udGlnIG5hbWVzXG4gICAgLy8gYmV0d2VlbiB0aGUgdHdvIHNjaGVtZXMsIHdoaWNoIElHViBkb2VzLCBidXQgaXMgYSBwZXJlbm5pYWwgaXNzdWU6IGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEwMDYyL1xuICAgIC8vIEkgaG9wZSBub3QgdG8gbmVlZCBhbGwgdGhlIG1hcHBpbmdzIGluIGhlcmUgaHR0cHM6Ly9naXRodWIuY29tL2Rwcnlhbjc5L0Nocm9tb3NvbWVNYXBwaW5ncyBidXQgaXQgbWF5IGJlIG5lY2Vzc2FyeVxuICAgIGNvbnZlcnRDaHJTY2hlbWU6IG51bGwsXG4gICAgLy8gRHJhdyBwYWlyZWQgZW5kcyB3aXRoaW4gYSByYW5nZSBvZiBleHBlY3RlZCBpbnNlcnQgc2l6ZXMgYXMgYSBjb250aW51b3VzIGZlYXR1cmU/XG4gICAgLy8gU2VlIGh0dHBzOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvQWxpZ25tZW50RGF0YSNwYWlyZWQgZm9yIGhvdyB0aGlzIHdvcmtzXG4gICAgdmlld0FzUGFpcnM6IGZhbHNlXG4gIH0sXG4gIFxuICAvLyBUaGUgRkxBRyBjb2x1bW4gZm9yIEJBTS9TQU0gaXMgYSBjb21iaW5hdGlvbiBvZiBiaXR3aXNlIGZsYWdzXG4gIGZsYWdzOiB7XG4gICAgaXNSZWFkUGFpcmVkOiAweDEsXG4gICAgaXNSZWFkUHJvcGVybHlBbGlnbmVkOiAweDIsXG4gICAgaXNSZWFkVW5tYXBwZWQ6IDB4NCxcbiAgICBpc01hdGVVbm1hcHBlZDogMHg4LFxuICAgIHJlYWRTdHJhbmRSZXZlcnNlOiAweDEwLFxuICAgIG1hdGVTdHJhbmRSZXZlcnNlOiAweDIwLFxuICAgIGlzUmVhZEZpcnN0T2ZQYWlyOiAweDQwLFxuICAgIGlzUmVhZExhc3RPZlBhaXI6IDB4ODAsXG4gICAgaXNUaGlzQWxpZ25tZW50UHJpbWFyeTogMHgxMDAsXG4gICAgaXNSZWFkRmFpbGluZ1ZlbmRvclFDOiAweDIwMCxcbiAgICBpc0R1cGxpY2F0ZVJlYWQ6IDB4NDAwLFxuICAgIGlzU3VwcGxlbWVudGFyeUFsaWdubWVudDogMHg4MDBcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYnJvd3NlckNocnMgPSBfLmtleXModGhpcy5icm93c2VyT3B0cyk7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBCQU0gdHJhY2sgYXQgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMuYnJvd3NlckNoclNjaGVtZSA9IHRoaXMudHlwZShcImJhbVwiKS5ndWVzc0NoclNjaGVtZShfLmtleXModGhpcy5icm93c2VyT3B0cy5jaHJQb3MpKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBhamF4VXJsID0gc2VsZi5hamF4RGlyKCkgKyAnYmFtLnBocCcsXG4gICAgICByZW1vdGU7XG4gICAgXG4gICAgcmVtb3RlID0gbmV3IFJlbW90ZVRyYWNrKGNhY2hlLCBmdW5jdGlvbihzdGFydCwgZW5kLCBzdG9yZUludGVydmFscykge1xuICAgICAgcmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgICAgLy8gQ29udmVydCBhdXRvbWF0aWNhbGx5IGJldHdlZW4gRW5zZW1ibCBzdHlsZSAxLCAyLCAzLCBYIDwtLT4gVUNTQyBzdHlsZSBjaHIxLCBjaHIyLCBjaHIzLCBjaHJYIGFzIGNvbmZpZ3VyZWQvYXV0b2RldGVjdGVkXG4gICAgICAvLyBOb3RlIHRoYXQgY2hyTSBpcyBOT1QgZXF1aXZhbGVudCB0byBNVCBodHRwczovL3d3dy5iaW9zdGFycy5vcmcvcC8xMjAwNDIvIzEyMDA1OFxuICAgICAgc3dpdGNoIChvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eY2hyLywgJycpOyB9KTsgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IHJhbmdlID0gXy5tYXAocmFuZ2UsIGZ1bmN0aW9uKHIpIHsgcmV0dXJuIHIucmVwbGFjZSgvXihcXGRcXGQ/fFgpOi8sICdjaHIkMTonKTsgfSk7IGJyZWFrO1xuICAgICAgfVxuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUGFyc2UgdGhlIFNBTSBmb3JtYXQgaW50byBpbnRlcnZhbHMgdGhhdCBjYW4gYmUgaW5zZXJ0ZWQgaW50byB0aGUgSW50ZXJ2YWxUcmVlIGNhY2hlXG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBzZWxmLnR5cGUoJ2JhbScpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZSwgcGlsZXVwOiB7fSwgaW5mbzoge319O1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMjQsIHN0YXJ0OiAyNH07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgc2VsZi5ub0FyZWFMYWJlbHMgPSB0cnVlO1xuICAgIHNlbGYuZXhwZWN0c1NlcXVlbmNlID0gdHJ1ZTtcbiAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzID0ge307XG4gICAgXG4gICAgLy8gR2V0IGdlbmVyYWwgaW5mbyBvbiB0aGUgYmFtIChlLmcuIGBzYW10b29scyBpZHhzdGF0c2AsIHVzZSBtYXBwZWQgcmVhZHMgcGVyIHJlZmVyZW5jZSBzZXF1ZW5jZVxuICAgIC8vIHRvIGVzdGltYXRlIG1heEZldGNoV2luZG93IGFuZCBvcHRpbWFsRmV0Y2hXaW5kb3csIGFuZCBzZXR1cCBiaW5uaW5nIG9uIHRoZSBSZW1vdGVUcmFjay5cbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YToge3VybDogby5iaWdEYXRhVXJsfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIG1hcHBlZFJlYWRzID0gMCxcbiAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKG8uZHJhd0xpbWl0KSksXG4gICAgICAgICAgYmFtQ2hycyA9IFtdLFxuICAgICAgICAgIGNoclNjaGVtZSwgbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgIF8uZWFjaChkYXRhLnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICAgICAgICByZWFkc01hcHBlZFRvQ29udGlnID0gcGFyc2VJbnQoZmllbGRzWzJdLCAxMCk7XG4gICAgICAgICAgaWYgKGZpZWxkcy5sZW5ndGggPT0gMSAmJiBmaWVsZHNbMF0gPT0gJycpIHsgcmV0dXJuOyB9IC8vIGJsYW5rIGxpbmVcbiAgICAgICAgICBiYW1DaHJzLnB1c2goZmllbGRzWzBdKTtcbiAgICAgICAgICBpZiAoXy5pc05hTihyZWFkc01hcHBlZFRvQ29udGlnKSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG91dHB1dCBmb3Igc2FtdG9vbHMgaWR4c3RhdHMgb24gdGhpcyBCQU0gdHJhY2suXCIpOyB9XG4gICAgICAgICAgbWFwcGVkUmVhZHMgKz0gcmVhZHNNYXBwZWRUb0NvbnRpZztcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBzZWxmLmRhdGEuaW5mby5jaHJTY2hlbWUgPSBjaHJTY2hlbWUgPSBzZWxmLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoYmFtQ2hycyk7XG4gICAgICAgIGlmIChvLmNvbnZlcnRDaHJTY2hlbWUgIT09IGZhbHNlICYmIGNoclNjaGVtZSAmJiBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgKSB7XG4gICAgICAgICAgby5jb252ZXJ0Q2hyU2NoZW1lID0gY2hyU2NoZW1lICE9IHNlbGYuYnJvd3NlckNoclNjaGVtZSA/IGNoclNjaGVtZSArICdfJyArIHNlbGYuYnJvd3NlckNoclNjaGVtZSA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgPSBtZWFuSXRlbXNQZXJCcCA9IG1hcHBlZFJlYWRzIC8gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplO1xuICAgICAgICBzZWxmLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCA9IDEwMDsgLy8gVE9ETzogdGhpcyBpcyBhIHRvdGFsIGd1ZXNzIG5vdywgc2hvdWxkIGdyYWIgdGhpcyBmcm9tIHNvbWUgc2FtcGxlZCByZWFkcy5cbiAgICAgICAgby5tYXhGZXRjaFdpbmRvdyA9IG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgIG8ub3B0aW1hbEZldGNoV2luZG93ID0gTWF0aC5mbG9vcihvLm1heEZldGNoV2luZG93IC8gMik7XG4gICAgICAgIFxuICAgICAgICAvLyBUT0RPOiBXZSBjYW4gZGVhY3RpdmF0ZSB0aGUgcGFpcmluZyBmdW5jdGlvbmFsaXR5IG9mIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgXG4gICAgICAgIC8vICAgICAgIGlmIHdlIGRvbid0IHNlZSBhbnkgcGFpcmVkIHJlYWRzIGluIHRoaXMgQkFNLlxuICAgICAgICByZW1vdGUuc2V0dXBCaW5zKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSwgby5vcHRpbWFsRmV0Y2hXaW5kb3csIG8ubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmZsYWdzWy4uLl0gdG8gYSBodW1hbiBpbnRlcnByZXRhYmxlIHZlcnNpb24gb2YgZmVhdHVyZS5mbGFnIChleHBhbmRpbmcgdGhlIGJpdHdpc2UgZmxhZ3MpXG4gIHBhcnNlRmxhZ3M6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykge1xuICAgIGZlYXR1cmUuZmxhZ3MgPSB7fTtcbiAgICBfLmVhY2godGhpcy50eXBlKCdiYW0nKS5mbGFncywgZnVuY3Rpb24oYml0LCBmbGFnKSB7XG4gICAgICBmZWF0dXJlLmZsYWdzW2ZsYWddID0gISEoZmVhdHVyZS5mbGFnICYgYml0KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5ibG9ja3MgYW5kIGZlYXR1cmUuZW5kIGJhc2VkIG9uIGZlYXR1cmUuY2lnYXJcbiAgLy8gU2VlIHNlY3Rpb24gMS40IG9mIGh0dHBzOi8vc2FtdG9vbHMuZ2l0aHViLmlvL2h0cy1zcGVjcy9TQU12MS5wZGYgZm9yIGFuIGV4cGxhbmF0aW9uIG9mIENJR0FSIFxuICBwYXJzZUNpZ2FyOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHsgICAgICAgIFxuICAgIHZhciBjaWdhciA9IGZlYXR1cmUuY2lnYXIsXG4gICAgICByZWZMZW4gPSAwLFxuICAgICAgc2VxUG9zID0gMCxcbiAgICAgIG9wZXJhdGlvbnMsIGxlbmd0aHM7XG4gICAgXG4gICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICBmZWF0dXJlLmluc2VydGlvbnMgPSBbXTtcbiAgICBcbiAgICBvcHMgPSBjaWdhci5zcGxpdCgvXFxkKy8pLnNsaWNlKDEpO1xuICAgIGxlbmd0aHMgPSBjaWdhci5zcGxpdCgvW0EtWj1dLykuc2xpY2UoMCwgLTEpO1xuICAgIGlmIChvcHMubGVuZ3RoICE9IGxlbmd0aHMubGVuZ3RoKSB7IHRoaXMud2FybihcIkludmFsaWQgQ0lHQVIgJ1wiICsgY2lnYXIgKyBcIicgZm9yIFwiICsgZmVhdHVyZS5kZXNjKTsgcmV0dXJuOyB9XG4gICAgbGVuZ3RocyA9IF8ubWFwKGxlbmd0aHMsIHBhcnNlSW50MTApO1xuICAgIFxuICAgIF8uZWFjaChvcHMsIGZ1bmN0aW9uKG9wLCBpKSB7XG4gICAgICB2YXIgbGVuID0gbGVuZ3Roc1tpXSxcbiAgICAgICAgYmxvY2ssIGluc2VydGlvbjtcbiAgICAgIGlmICgvXltNWD1dJC8udGVzdChvcCkpIHtcbiAgICAgICAgLy8gQWxpZ25tZW50IG1hdGNoLCBzZXF1ZW5jZSBtYXRjaCwgc2VxdWVuY2UgbWlzbWF0Y2hcbiAgICAgICAgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIGxlbjtcbiAgICAgICAgYmxvY2sudHlwZSA9IG9wO1xuICAgICAgICBibG9jay5zZXEgPSBmZWF0dXJlLnNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmICgvXltORF0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBTa2lwcGVkIHJlZmVyZW5jZSByZWdpb24sIGRlbGV0aW9uIGZyb20gcmVmZXJlbmNlXG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdJJykge1xuICAgICAgICAvLyBJbnNlcnRpb25cbiAgICAgICAgaW5zZXJ0aW9uID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuLCBlbmQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBpbnNlcnRpb24uc2VxID0gZmVhdHVyZS5zZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmluc2VydGlvbnMucHVzaChpbnNlcnRpb24pO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnUycpIHtcbiAgICAgICAgLy8gU29mdCBjbGlwcGluZzsgc2ltcGx5IHNraXAgdGhlc2UgYmFzZXMgaW4gU0VRLCBwb3NpdGlvbiBvbiByZWZlcmVuY2UgaXMgdW5jaGFuZ2VkLlxuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfVxuICAgICAgLy8gVGhlIG90aGVyIHR3byBDSUdBUiBvcHMsIEggYW5kIFAsIGFyZSBub3QgcmVsZXZhbnQgdG8gZHJhd2luZyBhbGlnbm1lbnRzLlxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZW5kID0gZmVhdHVyZS5zdGFydCArIHJlZkxlbjtcbiAgfSxcbiAgXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xzID0gWydxbmFtZScsICdmbGFnJywgJ3JuYW1lJywgJ3BvcycsICdtYXBxJywgJ2NpZ2FyJywgJ3JuZXh0JywgJ3BuZXh0JywgJ3RsZW4nLCAnc2VxJywgJ3F1YWwnXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgXy5lYWNoKF8uZmlyc3QoZmllbGRzLCBjb2xzLmxlbmd0aCksIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgIC8vIE5vdGUgdGhhdCBjaHJNIGlzIE5PVCBlcXVpdmFsZW50IHRvIE1UIGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEyMDA0Mi8jMTIwMDU4XG4gICAgc3dpdGNoIChvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IGZlYXR1cmUucm5hbWUgPSBmZWF0dXJlLnJuYW1lLnJlcGxhY2UoL15jaHIvLCAnJyk7IGJyZWFrO1xuICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogZmVhdHVyZS5ybmFtZSA9ICgvXihcXGRcXGQ/fFgpJC8udGVzdChmZWF0dXJlLnJuYW1lKSA/ICdjaHInIDogJycpICsgZmVhdHVyZS5ybmFtZTsgYnJlYWs7XG4gICAgfVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucW5hbWU7XG4gICAgZmVhdHVyZS5mbGFnID0gcGFyc2VJbnQxMChmZWF0dXJlLmZsYWcpO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUucm5hbWVdO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHsgXG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIFJOQU1FICdcIitmZWF0dXJlLnJuYW1lK1wiJyBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIGlmIChmZWF0dXJlLnBvcyA9PT0gJzAnIHx8ICFmZWF0dXJlLmNpZ2FyIHx8IGZlYXR1cmUuY2lnYXIgPT0gJyonKSB7XG4gICAgICAvLyBVbm1hcHBlZCByZWFkLiBTaW5jZSB3ZSBjYW4ndCBkcmF3IHRoZXNlIGF0IGFsbCwgd2UgZG9uJ3QgYm90aGVyIHBhcnNpbmcgdGhlbSBmdXJ0aGVyLlxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZlYXR1cmUuc2NvcmUgPSBfLmlzVW5kZWZpbmVkKGZlYXR1cmUuc2NvcmUpID8gJz8nIDogZmVhdHVyZS5zY29yZTtcbiAgICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUucG9zKTsgIC8vIFBPUyBpcyAxLWJhc2VkLCBoZW5jZSBubyBpbmNyZW1lbnQgYXMgZm9yIHBhcnNpbmcgQkVEXG4gICAgICBmZWF0dXJlLmRlc2MgPSBmZWF0dXJlLnFuYW1lICsgJyBhdCAnICsgZmVhdHVyZS5ybmFtZSArICc6JyArIGZlYXR1cmUucG9zO1xuICAgICAgdGhpcy50eXBlKCdiYW0nKS5wYXJzZUZsYWdzLmNhbGwodGhpcywgZmVhdHVyZSwgbGluZW5vKTtcbiAgICAgIGZlYXR1cmUuc3RyYW5kID0gZmVhdHVyZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/ICctJyA6ICcrJztcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VDaWdhci5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgdG8gY29tZSB1cCB3aXRoIHNvbWV0aGluZyB0aGF0IGlzIGEgdW5pcXVlIGxhYmVsIGZvciBldmVyeSBsaW5lIHRvIGRlZHVwZSByb3dzLlxuICAgIC8vIFRoZSBmb2xsb3dpbmcgaXMgdGVjaG5pY2FsbHkgbm90IGd1YXJhbnRlZWQgYnkgYSB2YWxpZCBCQU0gKGV2ZW4gYXQgR0FUSyBzdGFuZGFyZHMpLCBidXQgaXQncyB0aGUgYmVzdCBJIGdvdC5cbiAgICBmZWF0dXJlLmlkID0gW2ZlYXR1cmUucW5hbWUsIGZlYXR1cmUuZmxhZywgZmVhdHVyZS5ybmFtZSwgZmVhdHVyZS5wb3MsIGZlYXR1cmUuY2lnYXJdLmpvaW4oXCJcXHRcIik7XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICBwaWxldXA6IGZ1bmN0aW9uKGludGVydmFscywgc3RhcnQsIGVuZCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgcG9zaXRpb25zVG9DYWxjdWxhdGUgPSB7fSxcbiAgICAgIG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID0gMCxcbiAgICAgIGk7XG4gICAgXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgLy8gTm8gbmVlZCB0byBwaWxldXAgYWdhaW4gb24gYWxyZWFkeS1waWxlZC11cCBudWNsZW90aWRlIHBvc2l0aW9uc1xuICAgICAgaWYgKCFwaWxldXBbaV0pIHsgcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0gPSB0cnVlOyBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSsrOyB9XG4gICAgfVxuICAgIGlmIChudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9PT0gMCkgeyByZXR1cm47IH0gLy8gQWxsIHBvc2l0aW9ucyBhbHJlYWR5IHBpbGVkIHVwIVxuICAgIFxuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICBfLmVhY2goaW50ZXJ2YWwuZGF0YS5ibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgIHZhciBudCwgaTtcbiAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgZW5kKTsgaSsrKSB7XG4gICAgICAgICAgaWYgKCFwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSkgeyBjb250aW51ZTsgfVxuICAgICAgICAgIG50ID0gKGJsb2NrLnNlcVtpIC0gYmxvY2suc3RhcnRdIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgIHBpbGV1cFtpXSA9IHBpbGV1cFtpXSB8fCB7QTogMCwgQzogMCwgRzogMCwgVDogMCwgTjogMCwgY292OiAwfTtcbiAgICAgICAgICBpZiAoL1tBQ1RHTl0vLnRlc3QobnQpKSB7IHBpbGV1cFtpXVtudF0gKz0gMTsgfVxuICAgICAgICAgIHBpbGV1cFtpXS5jb3YgKz0gMTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBjb3ZlcmFnZTogZnVuY3Rpb24oc3RhcnQsIHdpZHRoLCBicHBwKSB7XG4gICAgLy8gQ29tcGFyZSB3aXRoIGJpbm5pbmcgb24gdGhlIGZseSBpbiAudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIoLi4uKVxuICAgIHZhciBqID0gc3RhcnQsXG4gICAgICB2U2NhbGUgPSB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCAqIHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoICogMixcbiAgICAgIGN1cnIgPSB0aGlzLmRhdGEucGlsZXVwW2pdLFxuICAgICAgYmFycyA9IFtdLFxuICAgICAgbmV4dCwgYmluLCBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB3aWR0aDsgaSsrKSB7XG4gICAgICBiaW4gPSBjdXJyICYmIChqICsgMSA+PSBpICogYnBwcCArIHN0YXJ0KSA/IFtjdXJyLmNvdl0gOiBbXTtcbiAgICAgIG5leHQgPSB0aGlzLmRhdGEucGlsZXVwW2ogKyAxXTtcbiAgICAgIHdoaWxlIChqICsgMSA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgaiArIDIgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgaWYgKG5leHQpIHsgYmluLnB1c2gobmV4dC5jb3YpOyB9XG4gICAgICAgICsrajtcbiAgICAgICAgY3VyciA9IG5leHQ7XG4gICAgICAgIG5leHQgPSB0aGlzLmRhdGEucGlsZXVwW2ogKyAxXTtcbiAgICAgIH1cbiAgICAgIGJhcnMucHVzaCh1dGlscy53aWdCaW5GdW5jdGlvbnMubWF4aW11bShiaW4pIC8gdlNjYWxlKTtcbiAgICB9XG4gICAgcmV0dXJuIGJhcnM7XG4gIH0sXG4gIFxuICBhbGxlbGVzOiBmdW5jdGlvbihzdGFydCwgc2VxdWVuY2UsIGJwcHApIHtcbiAgICB2YXIgcGlsZXVwID0gdGhpcy5kYXRhLnBpbGV1cCxcbiAgICAgIHZTY2FsZSA9IHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwICogdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggKiAyLFxuICAgICAgYWxsZWxlRnJlcVRocmVzaG9sZCA9IHRoaXMub3B0cy5hbGxlbGVGcmVxVGhyZXNob2xkLFxuICAgICAgYWxsZWxlU3BsaXRzID0gW10sXG4gICAgICBzcGxpdCwgcmVmTnQsIGksIHBpbGV1cEF0UG9zO1xuICAgICAgXG4gICAgZm9yIChpID0gMDsgaSA8IHNlcXVlbmNlLmxlbmd0aDsgaSsrKSB7XG4gICAgICByZWZOdCA9IHNlcXVlbmNlW2ldLnRvVXBwZXJDYXNlKCk7XG4gICAgICBwaWxldXBBdFBvcyA9IHBpbGV1cFtzdGFydCArIGldO1xuICAgICAgaWYgKHBpbGV1cEF0UG9zICYmIHBpbGV1cEF0UG9zLmNvdiAmJiBwaWxldXBBdFBvc1tyZWZOdF0gLyBwaWxldXBBdFBvcy5jb3YgPCAoMSAtIGFsbGVsZUZyZXFUaHJlc2hvbGQpKSB7XG4gICAgICAgIHNwbGl0ID0ge1xuICAgICAgICAgIHg6IGkgLyBicHBwLFxuICAgICAgICAgIHNwbGl0czogW11cbiAgICAgICAgfTtcbiAgICAgICAgXy5lYWNoKFsnQScsICdDJywgJ0cnLCAnVCddLCBmdW5jdGlvbihudCkge1xuICAgICAgICAgIGlmIChwaWxldXBBdFBvc1tudF0gPiAwKSB7IHNwbGl0LnNwbGl0cy5wdXNoKHtudDogbnQsIGg6IHBpbGV1cEF0UG9zW250XSAvIHZTY2FsZX0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBhbGxlbGVTcGxpdHMucHVzaChzcGxpdCk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBhbGxlbGVTcGxpdHM7XG4gIH0sXG4gIFxuICBtaXNtYXRjaGVzOiBmdW5jdGlvbihzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0pIHtcbiAgICB2YXIgbWlzbWF0Y2hlcyA9IFtdO1xuICAgIHNlcXVlbmNlID0gc2VxdWVuY2UudG9VcHBlckNhc2UoKTtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgXy5lYWNoKGludGVydmFsLmRhdGEuYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICB2YXIgbGluZSA9IGxpbmVOdW0oaW50ZXJ2YWwuZGF0YSksXG4gICAgICAgICAgbnQsIGksIHg7XG4gICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIHN0YXJ0ICsgd2lkdGggKiBicHBwKTsgaSsrKSB7XG4gICAgICAgICAgeCA9IChpIC0gc3RhcnQpIC8gYnBwcDtcbiAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICBpZiAobnQgJiYgbnQgIT0gc2VxdWVuY2VbaSAtIHN0YXJ0XSAmJiBsaW5lKSB7IG1pc21hdGNoZXMucHVzaCh7eDogeCwgbnQ6IG50LCBsaW5lOiBsaW5lfSk7IH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIG1pc21hdGNoZXM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIHNlcXVlbmNlID0gcHJlY2FsYy5zZXF1ZW5jZSxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICB2aWV3QXNQYWlycyA9IHNlbGYub3B0cy52aWV3QXNQYWlycyxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGg7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXRUbykge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldFRvKSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldFRvKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIGFuIGluc2FuZSBhbW91bnQgb2Ygcm93cyBcbiAgICAvLyAoPjUwMCBhbGlnbm1lbnRzKSwgYXMgdGhpcyB3aWxsIG9ubHkgaG9sZCB1cCBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoc2VsZi5vcHRzLm1heEZldGNoV2luZG93ICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZldGNoIGZyb20gdGhlIFJlbW90ZVRyYWNrIGFuZCBjYWxsIHRoZSBhYm92ZSB3aGVuIHRoZSBkYXRhIGlzIGF2YWlsYWJsZS5cbiAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCB2aWV3QXNQYWlycywgZnVuY3Rpb24oaW50ZXJ2YWxzKSB7XG4gICAgICAgIHZhciBkcmF3U3BlYyA9IHtzZXF1ZW5jZTogISFzZXF1ZW5jZSwgd2lkdGg6IHdpZHRofSwgXG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGZhbHNlKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuXG4gICAgICAgIGlmICghc2VxdWVuY2UpIHtcbiAgICAgICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5waWxldXAuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHN0YXJ0LCBlbmQpO1xuICAgICAgICAgIGRyYXdTcGVjLmxheW91dCA9IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHNlbGYsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSk7XG4gICAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obGluZXMpIHtcbiAgICAgICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgICAgICAgICAgaW50ZXJ2YWwuaW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5pbnNlcnRpb25zLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZHJhd1NwZWMuY292ZXJhZ2UgPSBzZWxmLnR5cGUoJ2JhbScpLmNvdmVyYWdlLmNhbGwoc2VsZiwgc3RhcnQsIHdpZHRoLCBicHBwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2UsIGxpa2UgbWlzbWF0Y2hlcyAocG90ZW50aWFsIFNOUHMpLlxuICAgICAgICAgIGRyYXdTcGVjLmJwcHAgPSBicHBwOyAgXG4gICAgICAgICAgLy8gRmluZCBhbGxlbGUgc3BsaXRzIHdpdGhpbiB0aGUgY292ZXJhZ2UgZ3JhcGguXG4gICAgICAgICAgZHJhd1NwZWMuYWxsZWxlcyA9IHNlbGYudHlwZSgnYmFtJykuYWxsZWxlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCk7XG4gICAgICAgICAgLy8gRmluZCBtaXNtYXRjaGVzIHdpdGhpbiBlYWNoIGFsaWduZWQgYmxvY2suXG4gICAgICAgICAgZHJhd1NwZWMubWlzbWF0Y2hlcyA9IHNlbGYudHlwZSgnYmFtJykubWlzbWF0Y2hlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSk7ICAgICAgICAgICAgICBcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBcbiAgLy8gc3BlY2lhbCBmb3JtYXR0ZXIgZm9yIGNvbnRlbnQgaW4gdG9vbHRpcHMgZm9yIGZlYXR1cmVzXG4gIHRpcFRpcERhdGE6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgY29udGVudCA9IHtcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5ybmFtZSArICc6JyArIGRhdGEuZC5wb3MsIFxuICAgICAgICBcInJlYWQgc3RyYW5kXCI6IGRhdGEuZC5mbGFncy5yZWFkU3RyYW5kID8gJygtKScgOiAnKCspJyxcbiAgICAgICAgXCJtYXAgcXVhbGl0eVwiOiBkYXRhLmQubWFwcVxuICAgICAgfTtcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSxcbiAgXG4gIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjY292ZXJhZ2UgZm9yIGFuIGlkZWEgb2Ygd2hhdCB3ZSdyZSBpbWl0YXRpbmdcbiAgZHJhd0NvdmVyYWdlOiBmdW5jdGlvbihjdHgsIGNvdmVyYWdlLCBoZWlnaHQpIHtcbiAgICBfLmVhY2goY292ZXJhZ2UsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgY3R4LmZpbGxSZWN0KHgsIE1hdGgubWF4KGhlaWdodCAtIChkICogaGVpZ2h0KSwgMCksIDEsIE1hdGgubWluKGQgKiBoZWlnaHQsIGhlaWdodCkpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd1N0cmFuZEluZGljYXRvcjogZnVuY3Rpb24oY3R4LCB4LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCB4U2NhbGUsIGJpZ1N0eWxlKSB7XG4gICAgdmFyIHByZXZGaWxsU3R5bGUgPSBjdHguZmlsbFN0eWxlO1xuICAgIGlmIChiaWdTdHlsZSkge1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4Lm1vdmVUbyh4IC0gKDIgKiB4U2NhbGUpLCBibG9ja1kpO1xuICAgICAgY3R4LmxpbmVUbyh4ICsgKDMgKiB4U2NhbGUpLCBibG9ja1kgKyBibG9ja0hlaWdodC8yKTtcbiAgICAgIGN0eC5saW5lVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQpO1xuICAgICAgY3R4LmNsb3NlUGF0aCgpO1xuICAgICAgY3R4LmZpbGwoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMTQwLDE0MCwxNDApJztcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMiA6IDEpLCBibG9ja1ksIDEsIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMSA6IDApLCBibG9ja1kgKyAxLCAxLCBibG9ja0hlaWdodCAtIDIpO1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IHByZXZGaWxsU3R5bGU7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd0FsaWdubWVudDogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDAsXG4gICAgICBkZWxldGlvbkxpbmVXaWR0aCA9IDIsXG4gICAgICBpbnNlcnRpb25DYXJldExpbmVXaWR0aCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDEsXG4gICAgICBoYWxmSGVpZ2h0ID0gTWF0aC5yb3VuZCgwLjUgKiBsaW5lSGVpZ2h0KSAtIGRlbGV0aW9uTGluZVdpZHRoICogMC41O1xuICAgIFxuICAgIC8vIERyYXcgdGhlIGxpbmUgdGhhdCBzaG93cyB0aGUgZnVsbCBhbGlnbm1lbnQsIGluY2x1ZGluZyBkZWxldGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gJ3JnYigwLDAsMCknO1xuICAgIC8vIE5vdGUgdGhhdCB0aGUgXCItIDFcIiBiZWxvdyBmaXhlcyByb3VuZGluZyBpc3N1ZXMgYnV0IGdhbWJsZXMgb24gdGhlcmUgbmV2ZXIgYmVpbmcgYSBkZWxldGlvbiBhdCB0aGUgcmlnaHQgZWRnZVxuICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudyAtIDEsIGRlbGV0aW9uTGluZVdpZHRoKTtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgXG4gICAgLy8gRHJhdyB0aGUgW21pc11tYXRjaCAoTS9YLz0pIGJsb2Nrc1xuICAgIF8uZWFjaChkYXRhLmJsb2NrSW50cywgZnVuY3Rpb24oYkludCwgYmxvY2tOdW0pIHtcbiAgICAgIHZhciBibG9ja1kgPSBpICogbGluZUhlaWdodCArIGxpbmVHYXAvMixcbiAgICAgICAgYmxvY2tIZWlnaHQgPSBsaW5lSGVpZ2h0IC0gbGluZUdhcDtcbiAgICAgIFxuICAgICAgLy8gU2tpcCBkcmF3aW5nIGJsb2NrcyB0aGF0IGFyZW4ndCBpbnNpZGUgdGhlIGNhbnZhc1xuICAgICAgaWYgKGJJbnQueCArIGJJbnQudyA8IDAgfHwgYkludC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICBcbiAgICAgIGlmIChibG9ja051bSA9PSAwICYmIGRhdGEuZC5zdHJhbmQgPT0gJy0nICYmICFiSW50Lm9QcmV2KSB7XG4gICAgICAgIGN0eC5maWxsUmVjdChiSW50LnggKyAyLCBibG9ja1ksIGJJbnQudyAtIDIsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LngsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIC0xLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICB9IGVsc2UgaWYgKGJsb2NrTnVtID09IGRhdGEuYmxvY2tJbnRzLmxlbmd0aCAtIDEgJiYgZGF0YS5kLnN0cmFuZCA9PSAnKycgJiYgIWJJbnQub05leHQpIHtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54ICsgYkludC53LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAxLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCBibG9ja1ksIGJJbnQudywgYmxvY2tIZWlnaHQpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIERyYXcgaW5zZXJ0aW9uc1xuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYigxMTQsNDEsMjE4KVwiO1xuICAgIF8uZWFjaChkYXRhLmluc2VydGlvblB0cywgZnVuY3Rpb24oaW5zZXJ0KSB7XG4gICAgICBpZiAoaW5zZXJ0LnggKyBpbnNlcnQudyA8IDAgfHwgaW5zZXJ0LnggPiB3aWR0aCkgeyByZXR1cm47IH1cbiAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDEsIGkgKiBsaW5lSGVpZ2h0LCAyLCBsaW5lSGVpZ2h0KTtcbiAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIGkgKiBsaW5lSGVpZ2h0LCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAyLCAoaSArIDEpICogbGluZUhlaWdodCAtIGluc2VydGlvbkNhcmV0TGluZVdpZHRoLCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3QWxsZWxlczogZnVuY3Rpb24oY3R4LCBhbGxlbGVzLCBoZWlnaHQsIGJhcldpZHRoKSB7XG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIHlQb3M7XG4gICAgXy5lYWNoKGFsbGVsZXMsIGZ1bmN0aW9uKGFsbGVsZXNGb3JQb3NpdGlvbikge1xuICAgICAgeVBvcyA9IGhlaWdodDtcbiAgICAgIF8uZWFjaChhbGxlbGVzRm9yUG9zaXRpb24uc3BsaXRzLCBmdW5jdGlvbihzcGxpdCkge1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1tzcGxpdC5udF0rJyknO1xuICAgICAgICBjdHguZmlsbFJlY3QoYWxsZWxlc0ZvclBvc2l0aW9uLngsIHlQb3MgLT0gKHNwbGl0LmggKiBoZWlnaHQpLCBNYXRoLm1heChiYXJXaWR0aCwgMSksIHNwbGl0LmggKiBoZWlnaHQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3TWlzbWF0Y2g6IGZ1bmN0aW9uKGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIHBwYnApIHtcbiAgICAvLyBwcGJwID09IHBpeGVscyBwZXIgYmFzZSBwYWlyIChpbnZlcnNlIG9mIGJwcHApXG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgeVBvcztcbiAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1ttaXNtYXRjaC5udF0rJyknO1xuICAgIGN0eC5maWxsUmVjdChtaXNtYXRjaC54LCAobWlzbWF0Y2gubGluZSArIGxpbmVPZmZzZXQpICogbGluZUhlaWdodCArIGxpbmVHYXAgLyAyLCBNYXRoLm1heChwcGJwLCAxKSwgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIC8vIERvIHdlIGhhdmUgcm9vbSB0byBwcmludCBhIHdob2xlIGxldHRlcj9cbiAgICBpZiAocHBicCA+IDcgJiYgbGluZUhlaWdodCA+IDEwKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYigyNTUsMjU1LDI1NSknO1xuICAgICAgY3R4LmZpbGxUZXh0KG1pc21hdGNoLm50LCBtaXNtYXRjaC54ICsgcHBicCAqIDAuNSwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0ICsgMSkgKiBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNCA6IDQsXG4gICAgICBjb3ZIZWlnaHQgPSBkZW5zaXR5ID09ICdkZW5zZScgPyAyNCA6IDM4LFxuICAgICAgY292TWFyZ2luID0gNyxcbiAgICAgIGxpbmVPZmZzZXQgPSAoKGNvdkhlaWdodCArIGNvdk1hcmdpbikgLyBsaW5lSGVpZ2h0KSwgXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICAgICAgICAgIFxuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIFxuICAgIGlmICghZHJhd1NwZWMuc2VxdWVuY2UpIHtcbiAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgIFxuICAgICAgLy8gSWYgbmVjZXNzYXJ5LCBpbmRpY2F0ZSB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgaWYgKGRyYXdTcGVjLnRvb01hbnkgfHwgKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gT25seSBzdG9yZSBhcmVhcyBmb3IgdGhlIFwicGFja1wiIGRlbnNpdHkuXG4gICAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycgJiYgIXNlbGYuYXJlYXNbY2FudmFzLmlkXSkgeyBhcmVhcyA9IHNlbGYuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgICAvLyBTZXQgdGhlIGV4cGVjdGVkIGhlaWdodCBmb3IgdGhlIGNhbnZhcyAodGhpcyBhbHNvIGVyYXNlcyBpdCkuXG4gICAgICBjYW52YXMuaGVpZ2h0ID0gY292SGVpZ2h0ICsgKChkZW5zaXR5ID09ICdkZW5zZScpID8gMCA6IGNvdk1hcmdpbiArIGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0KTtcbiAgICAgIFxuICAgICAgLy8gRmlyc3QgZHJhdyB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigxNTksMTU5LDE1OSlcIjtcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0NvdmVyYWdlLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5jb3ZlcmFnZSwgY292SGVpZ2h0KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgIC8vIE5vdywgZHJhdyBhbGlnbm1lbnRzIGJlbG93IGl0XG4gICAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnKSB7XG4gICAgICAgIC8vIEJvcmRlciBiZXR3ZWVuIGNvdmVyYWdlXG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigxMDksMTA5LDEwOSlcIjtcbiAgICAgICAgY3R4LmZpbGxSZWN0KDAsIGNvdkhlaWdodCArIDEsIGRyYXdTcGVjLndpZHRoLCAxKTsgXG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgICAgXG4gICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgICBpICs9IGxpbmVPZmZzZXQ7IC8vIGhhY2tpc2ggbWV0aG9kIGZvciBsZWF2aW5nIHNwYWNlIGF0IHRoZSB0b3AgZm9yIHRoZSBjb3ZlcmFnZSBncmFwaFxuICAgICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBpbXBsZW1lbnQgc3BlY2lhbCBkcmF3aW5nIG9mIGFsaWdubWVudCBmZWF0dXJlcywgZm9yIEJBTXMuXG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGlnbm1lbnQuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KTsgICAgICAgICAgICAgIFxuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlY29uZCBkcmF3aW5nIHBhc3MsIHRvIGRyYXcgdGhpbmdzIHRoYXQgYXJlIGRlcGVuZGVudCBvbiBzZXF1ZW5jZTpcbiAgICAgIC8vICgxKSBhbGxlbGUgc3BsaXRzIG92ZXIgY292ZXJhZ2VcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsbGVsZXMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmFsbGVsZXMsIGNvdkhlaWdodCwgMSAvIGRyYXdTcGVjLmJwcHApO1xuICAgICAgLy8gKDIpIG1pc21hdGNoZXMgb3ZlciB0aGUgYWxpZ25tZW50c1xuICAgICAgY3R4LmZvbnQgPSBcIjEycHggJ01lbmxvJywnQml0c3RyZWFtIFZlcmEgU2FucyBNb25vJywnQ29uc29sYXMnLCdMdWNpZGEgQ29uc29sZScsbW9ub3NwYWNlXCI7XG4gICAgICBjdHgudGV4dEFsaWduID0gJ2NlbnRlcic7XG4gICAgICBjdHgudGV4dEJhc2VsaW5lID0gJ2Jhc2VsaW5lJztcbiAgICAgIF8uZWFjaChkcmF3U3BlYy5taXNtYXRjaGVzLCBmdW5jdGlvbihtaXNtYXRjaCkge1xuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdNaXNtYXRjaC5jYWxsKHNlbGYsIGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICB2YXIgY2FsbGJhY2tLZXkgPSBzdGFydCArICctJyArIGVuZCArICctJyArIGRlbnNpdHk7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBcbiAgICAgIC8vIEhhdmUgd2UgYmVlbiB3YWl0aW5nIHRvIGRyYXcgc2VxdWVuY2UgZGF0YSB0b28/IElmIHNvLCBkbyB0aGF0IG5vdywgdG9vLlxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XSkpIHtcbiAgICAgICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0oKTtcbiAgICAgICAgZGVsZXRlIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldO1xuICAgICAgfVxuICAgICAgXG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICByZW5kZXJTZXF1ZW5jZTogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBzZXF1ZW5jZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgXG4gICAgLy8gSWYgd2Ugd2VyZW4ndCBhYmxlIHRvIGZldGNoIHNlcXVlbmNlIGZvciBzb21lIHJlYXNvbiwgdGhlcmUgaXMgbm8gcmVhc29uIHRvIHByb2NlZWQuXG4gICAgaWYgKCFzZXF1ZW5jZSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKSB7XG4gICAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aCwgc2VxdWVuY2U6IHNlcXVlbmNlfSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgdGhlIGNhbnZhcyB3YXMgYWxyZWFkeSByZW5kZXJlZCAoYnkgbGFjayBvZiB0aGUgY2xhc3MgJ3VucmVuZGVyZWQnKS5cbiAgICAvLyBJZiB5ZXMsIGdvIGFoZWFkIGFuZCBleGVjdXRlIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTsgaWYgbm90LCBzYXZlIGl0IGZvciBsYXRlci5cbiAgICBpZiAoKCcgJyArIGNhbnZhcy5jbGFzc05hbWUgKyAnICcpLmluZGV4T2YoJyB1bnJlbmRlcmVkICcpID4gLTEpIHtcbiAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3Nbc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5XSA9IHJlbmRlclNlcXVlbmNlQ2FsbGJhY2s7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTtcbiAgICB9XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmFtRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJFRCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBiZWREZXRhaWwgaXMgYSB0cml2aWFsIGV4dGVuc2lvbiBvZiBCRUQgdGhhdCBpcyBkZWZpbmVkIHNlcGFyYXRlbHksXG4vLyBhbHRob3VnaCBhIEJFRCBmaWxlIHdpdGggPjEyIGNvbHVtbnMgaXMgYXNzdW1lZCB0byBiZSBiZWREZXRhaWwgdHJhY2sgcmVnYXJkbGVzcyBvZiB0eXBlLlxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgTGluZU1hc2sgPSByZXF1aXJlKCcuL3V0aWxzL0xpbmVNYXNrLmpzJykuTGluZU1hc2s7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJlZFxudmFyIEJlZEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGFsdENvbG9ycyA9IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLyksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSBhbHRDb2xvcnMubGVuZ3RoID4gMSAmJiBfLmFsbChhbHRDb2xvcnMsIHNlbGYudmFsaWRhdGVDb2xvcik7XG4gICAgc2VsZi5vcHRzLnVzZVNjb3JlID0gc2VsZi5pc09uKHNlbGYub3B0cy51c2VTY29yZSk7XG4gICAgc2VsZi5vcHRzLml0ZW1SZ2IgPSBzZWxmLmlzT24oc2VsZi5vcHRzLml0ZW1SZ2IpO1xuICAgIGlmICghdmFsaWRDb2xvckJ5U3RyYW5kKSB7IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kID0gJyc7IHNlbGYub3B0cy5hbHRDb2xvciA9IG51bGw7IH1cbiAgICBlbHNlIHsgc2VsZi5vcHRzLmFsdENvbG9yID0gYWx0Q29sb3JzWzFdOyB9XG4gIH0sXG5cbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICduYW1lJywgJ3Njb3JlJywgJ3N0cmFuZCcsICd0aGlja1N0YXJ0JywgJ3RoaWNrRW5kJywgJ2l0ZW1SZ2InLFxuICAgICAgJ2Jsb2NrQ291bnQnLCAnYmxvY2tTaXplcycsICdibG9ja1N0YXJ0cycsICdpZCcsICdkZXNjcmlwdGlvbiddLFxuICAgICAgZmVhdHVyZSA9IHt9LFxuICAgICAgZmllbGRzID0gL1xcdC8udGVzdChsaW5lKSA/IGxpbmUuc3BsaXQoXCJcXHRcIikgOiBsaW5lLnNwbGl0KC9cXHMrLyksXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgaWYgKHRoaXMub3B0cy5kZXRhaWwpIHtcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDJdID0gJ2lkJztcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDFdID0gJ2Rlc2NyaXB0aW9uJztcbiAgICB9XG4gICAgXy5lYWNoKGZpZWxkcywgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbZmVhdHVyZS5jaHJvbV07XG4gICAgbGluZW5vID0gbGluZW5vIHx8IDA7XG4gICAgXG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkgeyBcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgY2hyb21vc29tZSAnXCIrZmVhdHVyZS5jaHJvbStcIicgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tU3RhcnQpICsgMTtcbiAgICAgIGZlYXR1cmUuZW5kID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tRW5kKSArIDE7XG4gICAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgICAvLyBmYW5jaWVyIEJFRCBmZWF0dXJlcyB0byBleHByZXNzIGNvZGluZyByZWdpb25zIGFuZCBleG9ucy9pbnRyb25zXG4gICAgICBpZiAoL15cXGQrJC8udGVzdChmZWF0dXJlLnRoaWNrU3RhcnQpICYmIC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja0VuZCkpIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnRoaWNrU3RhcnQpICsgMTtcbiAgICAgICAgZmVhdHVyZS50aGlja0VuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja0VuZCkgKyAxO1xuICAgICAgICBpZiAoL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTaXplcykgJiYgL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTdGFydHMpKSB7XG4gICAgICAgICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICAgICAgICBibG9ja1NpemVzID0gZmVhdHVyZS5ibG9ja1NpemVzLnNwbGl0KC8sLyk7XG4gICAgICAgICAgXy5lYWNoKGZlYXR1cmUuYmxvY2tTdGFydHMuc3BsaXQoLywvKSwgZnVuY3Rpb24oc3RhcnQsIGkpIHtcbiAgICAgICAgICAgIGlmIChzdGFydCA9PT0gJycpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyBwYXJzZUludDEwKHN0YXJ0KX07XG4gICAgICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIHBhcnNlSW50MTAoYmxvY2tTaXplc1tpXSk7XG4gICAgICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSk7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSwgbGluZW5vKTtcbiAgICAgIGlmIChmZWF0dXJlKSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgc3RhY2tlZExheW91dDogZnVuY3Rpb24oaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKSB7XG4gICAgLy8gQSBsaW5lTnVtIGZ1bmN0aW9uIGNhbiBiZSBwcm92aWRlZCB3aGljaCBjYW4gc2V0L3JldHJpZXZlIHRoZSBsaW5lIG9mIGFscmVhZHkgcmVuZGVyZWQgZGF0YXBvaW50c1xuICAgIC8vIHNvIGFzIHRvIG5vdCBicmVhayBhIHJhbmdlZCBmZWF0dXJlIHRoYXQgZXh0ZW5kcyBvdmVyIG11bHRpcGxlIHRpbGVzLlxuICAgIGxpbmVOdW0gPSBfLmlzRnVuY3Rpb24obGluZU51bSkgPyBsaW5lTnVtIDogZnVuY3Rpb24oKSB7IHJldHVybjsgfTtcbiAgICB2YXIgbGluZXMgPSBbXSxcbiAgICAgIG1heEV4aXN0aW5nTGluZSA9IF8ubWF4KF8ubWFwKGludGVydmFscywgZnVuY3Rpb24odikgeyByZXR1cm4gbGluZU51bSh2LmRhdGEpIHx8IDA7IH0pKSArIDEsXG4gICAgICBzb3J0ZWRJbnRlcnZhbHMgPSBfLnNvcnRCeShpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgdmFyIGxuID0gbGluZU51bSh2LmRhdGEpOyByZXR1cm4gXy5pc1VuZGVmaW5lZChsbikgPyAxIDogLWxuOyB9KTtcbiAgICBcbiAgICB3aGlsZSAobWF4RXhpc3RpbmdMaW5lLS0+MCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgXy5lYWNoKHNvcnRlZEludGVydmFscywgZnVuY3Rpb24odikge1xuICAgICAgdmFyIGQgPSB2LmRhdGEsXG4gICAgICAgIGxuID0gbGluZU51bShkKSxcbiAgICAgICAgcEludCA9IGNhbGNQaXhJbnRlcnZhbChkKSxcbiAgICAgICAgdGhpY2tJbnQgPSBkLnRoaWNrU3RhcnQgIT09IG51bGwgJiYgY2FsY1BpeEludGVydmFsKHtzdGFydDogZC50aGlja1N0YXJ0LCBlbmQ6IGQudGhpY2tFbmR9KSxcbiAgICAgICAgYmxvY2tJbnRzID0gZC5ibG9ja3MgIT09IG51bGwgJiYgIF8ubWFwKGQuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpLFxuICAgICAgICBpID0gMCxcbiAgICAgICAgbCA9IGxpbmVzLmxlbmd0aDtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChsbikpIHtcbiAgICAgICAgaWYgKGxpbmVzW2xuXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyAvKnRocm93IFwiVW5yZXNvbHZhYmxlIExpbmVNYXNrIGNvbmZsaWN0IVwiOyovIH1cbiAgICAgICAgbGluZXNbbG5dLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hpbGUgKGkgPCBsICYmIGxpbmVzW2ldLmNvbmZsaWN0KHBJbnQudHgsIHBJbnQudHcpKSB7ICsraTsgfVxuICAgICAgICBpZiAoaSA9PSBsKSB7IGxpbmVzLnB1c2gobmV3IExpbmVNYXNrKHdpZHRoLCA1KSk7IH1cbiAgICAgICAgbGluZU51bShkLCBpKTtcbiAgICAgICAgbGluZXNbaV0uYWRkKHBJbnQudHgsIHBJbnQudHcsIHtwSW50OiBwSW50LCB0aGlja0ludDogdGhpY2tJbnQsIGJsb2NrSW50czogYmxvY2tJbnRzLCBkOiBkfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBfLnBsdWNrKGwuaXRlbXMsICdkYXRhJyk7IH0pO1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgaW50ZXJ2YWxzID0gdGhpcy5kYXRhLnNlYXJjaChzdGFydCwgZW5kKSxcbiAgICAgIGRyYXdTcGVjID0gW10sXG4gICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldCkge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldCkpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgdmFyIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwodi5kYXRhKTtcbiAgICAgICAgcEludC52ID0gdi5kYXRhLnNjb3JlO1xuICAgICAgICBkcmF3U3BlYy5wdXNoKHBJbnQpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRyYXdTcGVjID0ge2xheW91dDogdGhpcy50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwodGhpcywgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKX07XG4gICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgYWRkQXJlYTogZnVuY3Rpb24oYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKSB7XG4gICAgdmFyIHRpcFRpcERhdGEgPSB7fSxcbiAgICAgIHRpcFRpcERhdGFDYWxsYmFjayA9IHRoaXMudHlwZSgpLnRpcFRpcERhdGE7XG4gICAgaWYgKCFhcmVhcykgeyByZXR1cm47IH1cbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHRpcFRpcERhdGFDYWxsYmFjaykpIHtcbiAgICAgIHRpcFRpcERhdGEgPSB0aXBUaXBEYXRhQ2FsbGJhY2soZGF0YSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuZGVzY3JpcHRpb24pKSB7IHRpcFRpcERhdGEuZGVzY3JpcHRpb24gPSBkYXRhLmQuZGVzY3JpcHRpb247IH1cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuc2NvcmUpKSB7IHRpcFRpcERhdGEuc2NvcmUgPSBkYXRhLmQuc2NvcmU7IH1cbiAgICAgIF8uZXh0ZW5kKHRpcFRpcERhdGEsIHtcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH0pO1xuICAgICAgLy8gRGlzcGxheSB0aGUgSUQgY29sdW1uIChmcm9tIGJlZERldGFpbCksIHVubGVzcyBpdCBjb250YWlucyBhIHRhYiBjaGFyYWN0ZXIsIHdoaWNoIG1lYW5zIGl0IHdhcyBhdXRvZ2VuZXJhdGVkXG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSAmJiAhKC9cXHQvKS50ZXN0KGRhdGEuZC5pZCkpIHsgdGlwVGlwRGF0YS5pZCA9IGRhdGEuZC5pZDsgfVxuICAgIH1cbiAgICBhcmVhcy5wdXNoKFtcbiAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvLyB4MSwgeDIsIHkxLCB5MlxuICAgICAgZGF0YS5kLm5hbWUgfHwgZGF0YS5kLmlkIHx8ICcnLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5hbWVcbiAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgXy5pc1VuZGVmaW5lZChkYXRhLmQuaWQpID8gZGF0YS5kLm5hbWUgOiBkYXRhLmQuaWQpLCAgICAvLyBocmVmXG4gICAgICBkYXRhLnBJbnQub1ByZXYsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgIG51bGwsXG4gICAgICBudWxsLFxuICAgICAgdGlwVGlwRGF0YVxuICAgIF0pO1xuICB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhbiBhbHBoYSB2YWx1ZSBiZXR3ZWVuIDAuMiBhbmQgMS4wXG4gIGNhbGNBbHBoYTogZnVuY3Rpb24odmFsdWUpIHsgcmV0dXJuIE1hdGgubWF4KHZhbHVlLCAxNjYpLzEwMDA7IH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGEgY29sb3Igc2NhbGVkIGJldHdlZW4gI2NjY2NjYyBhbmQgbWF4IENvbG9yXG4gIGNhbGNHcmFkaWVudDogZnVuY3Rpb24obWF4Q29sb3IsIHZhbHVlKSB7XG4gICAgdmFyIG1pbkNvbG9yID0gWzIzMCwyMzAsMjMwXSxcbiAgICAgIHZhbHVlQ29sb3IgPSBbXTtcbiAgICBpZiAoIV8uaXNBcnJheShtYXhDb2xvcikpIHsgbWF4Q29sb3IgPSBfLm1hcChtYXhDb2xvci5zcGxpdCgnLCcpLCBwYXJzZUludDEwKTsgfVxuICAgIF8uZWFjaChtaW5Db2xvciwgZnVuY3Rpb24odiwgaSkgeyB2YWx1ZUNvbG9yW2ldID0gKHYgLSBtYXhDb2xvcltpXSkgKiAoKDEwMDAgLSB2YWx1ZSkgLyAxMDAwLjApICsgbWF4Q29sb3JbaV07IH0pO1xuICAgIHJldHVybiBfLm1hcCh2YWx1ZUNvbG9yLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gIH0sXG4gIFxuICBkcmF3QXJyb3dzOiBmdW5jdGlvbihjdHgsIGNhbnZhc1dpZHRoLCBsaW5lWSwgaGFsZkhlaWdodCwgc3RhcnRYLCBlbmRYLCBkaXJlY3Rpb24pIHtcbiAgICB2YXIgYXJyb3dIZWlnaHQgPSBNYXRoLm1pbihoYWxmSGVpZ2h0LCAzKSxcbiAgICAgIFgxLCBYMjtcbiAgICBzdGFydFggPSBNYXRoLm1heChzdGFydFgsIDApO1xuICAgIGVuZFggPSBNYXRoLm1pbihlbmRYLCBjYW52YXNXaWR0aCk7XG4gICAgaWYgKGVuZFggLSBzdGFydFggPCA1KSB7IHJldHVybjsgfSAvLyBjYW4ndCBkcmF3IGFycm93cyBpbiB0aGF0IG5hcnJvdyBvZiBhIHNwYWNlXG4gICAgaWYgKGRpcmVjdGlvbiAhPT0gJysnICYmIGRpcmVjdGlvbiAhPT0gJy0nKSB7IHJldHVybjsgfSAvLyBpbnZhbGlkIGRpcmVjdGlvblxuICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAvLyBBbGwgdGhlIDAuNSdzIGhlcmUgYXJlIGR1ZSB0byA8Y2FudmFzPidzIHNvbWV3aGF0IHNpbGx5IGNvb3JkaW5hdGUgc3lzdGVtIFxuICAgIC8vIGh0dHA6Ly9kaXZlaW50b2h0bWw1LmluZm8vY2FudmFzLmh0bWwjcGl4ZWwtbWFkbmVzc1xuICAgIFgxID0gZGlyZWN0aW9uID09ICcrJyA/IDAuNSA6IGFycm93SGVpZ2h0ICsgMC41O1xuICAgIFgyID0gZGlyZWN0aW9uID09ICcrJyA/IGFycm93SGVpZ2h0ICsgMC41IDogMC41O1xuICAgIGZvciAodmFyIGkgPSBNYXRoLmZsb29yKHN0YXJ0WCkgKyAyOyBpIDwgZW5kWCAtIGFycm93SGVpZ2h0OyBpICs9IDcpIHtcbiAgICAgIGN0eC5tb3ZlVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgLSBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMiwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgKyBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgfVxuICAgIGN0eC5zdHJva2UoKTtcbiAgfSxcbiAgXG4gIGRyYXdGZWF0dXJlOiBmdW5jdGlvbihjdHgsIHdpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICB5ID0gaSAqIGxpbmVIZWlnaHQsXG4gICAgICBoYWxmSGVpZ2h0ID0gTWF0aC5yb3VuZCgwLjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIHF1YXJ0ZXJIZWlnaHQgPSBNYXRoLmNlaWwoMC4yNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDEsXG4gICAgICB0aGlja092ZXJsYXAgPSBudWxsLFxuICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgIFxuICAgIC8vIEZpcnN0LCBkZXRlcm1pbmUgYW5kIHNldCB0aGUgY29sb3Igd2Ugd2lsbCBiZSB1c2luZ1xuICAgIC8vIE5vdGUgdGhhdCB0aGUgZGVmYXVsdCBjb2xvciB3YXMgYWxyZWFkeSBzZXQgaW4gZHJhd1NwZWNcbiAgICBpZiAoc2VsZi5vcHRzLmFsdENvbG9yICYmIGRhdGEuZC5zdHJhbmQgPT0gJy0nKSB7IGNvbG9yID0gc2VsZi5vcHRzLmFsdENvbG9yOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy5pdGVtUmdiICYmIGRhdGEuZC5pdGVtUmdiICYmIHRoaXMudmFsaWRhdGVDb2xvcihkYXRhLmQuaXRlbVJnYikpIHsgY29sb3IgPSBkYXRhLmQuaXRlbVJnYjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMudXNlU2NvcmUpIHsgY29sb3IgPSBzZWxmLnR5cGUoJ2JlZCcpLmNhbGNHcmFkaWVudChjb2xvciwgZGF0YS5kLnNjb3JlKTsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiB8fCBzZWxmLm9wdHMuYWx0Q29sb3IgfHwgc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7IH1cbiAgICBcbiAgICBpZiAoZGF0YS50aGlja0ludCkge1xuICAgICAgLy8gVGhlIGNvZGluZyByZWdpb24gaXMgZHJhd24gYXMgYSB0aGlja2VyIGxpbmUgd2l0aGluIHRoZSBnZW5lXG4gICAgICBpZiAoZGF0YS5ibG9ja0ludHMpIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGV4b25zIGFuZCBpbnRyb25zLCBkcmF3IHRoZSBpbnRyb25zIHdpdGggYSAxcHggbGluZVxuICAgICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQsIGRhdGEucEludC53LCAxKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gICAgICAgIF8uZWFjaChkYXRhLmJsb2NrSW50cywgZnVuY3Rpb24oYkludCkge1xuICAgICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPD0gd2lkdGggJiYgYkludC54ID49IDApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGJJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpY2tPdmVybGFwID0gdXRpbHMucGl4SW50ZXJ2YWxPdmVybGFwKGJJbnQsIGRhdGEudGhpY2tJbnQpO1xuICAgICAgICAgIGlmICh0aGlja092ZXJsYXApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdCh0aGlja092ZXJsYXAueCwgeSArIDEsIHRoaWNrT3ZlcmxhcC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBpbnRyb25zLCBhcnJvd3MgYXJlIGRyYXduIG9uIHRoZSBpbnRyb25zLCBub3QgdGhlIGV4b25zLi4uXG4gICAgICAgICAgaWYgKGRhdGEuZC5zdHJhbmQgJiYgcHJldkJJbnQpIHtcbiAgICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBwcmV2QkludC54ICsgcHJldkJJbnQudywgYkludC54LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJldkJJbnQgPSBiSW50O1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gLi4udW5sZXNzIHRoZXJlIHdlcmUgbm8gaW50cm9ucy4gVGhlbiBpdCBpcyBkcmF3biBvbiB0aGUgY29kaW5nIHJlZ2lvbi5cbiAgICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFdlIGhhdmUgYSBjb2RpbmcgcmVnaW9uIGJ1dCBubyBpbnRyb25zL2V4b25zXG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQgLSBxdWFydGVySGVpZ2h0ICsgMSwgZGF0YS5wSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnRoaWNrSW50LngsIHkgKyAxLCBkYXRhLnRoaWNrSW50LncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb3RoaW5nIGZhbmN5LiAgSXQncyBhIGJveC5cbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS5wSW50LngsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHNlbGYub3B0cy51cmwgPyBzZWxmLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNSA6IDYsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICAvLyBUT0RPOiBJIGRpc2FibGVkIHJlZ2VuZXJhdGluZyBhcmVhcyBoZXJlLCB3aGljaCBhc3N1bWVzIHRoYXQgbGluZU51bSByZW1haW5zIHN0YWJsZSBhY3Jvc3MgcmUtcmVuZGVycy4gU2hvdWxkIGNoZWNrIG9uIHRoaXMuXG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgIF8uZWFjaChkcmF3U3BlYywgZnVuY3Rpb24ocEludCkge1xuICAgICAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBcInJnYmEoXCIrc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIHBJbnQudikrXCIpXCI7IH1cbiAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0ICYmIGRyYXdTcGVjLmxheW91dC5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3RmVhdHVyZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpOyAgICAgICAgICAgICAgXG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG5cbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbG9yQnlTdHJhbmRPbiA9IC9cXGQrLFxcZCssXFxkK1xccytcXGQrLFxcZCssXFxkKy8udGVzdChvLmNvbG9yQnlTdHJhbmQpLFxuICAgICAgY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiA/IG8uY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pWzFdIDogJzAsMCwwJztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5hdHRyKCdjaGVja2VkJywgISFjb2xvckJ5U3RyYW5kT24pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZF0nKS52YWwoY29sb3JCeVN0cmFuZCkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11c2VTY29yZV0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8udXNlU2NvcmUpKTsgICAgXG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11cmxdJykudmFsKG8udXJsKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKCksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSB0aGlzLnZhbGlkYXRlQ29sb3IoY29sb3JCeVN0cmFuZCk7XG4gICAgby5jb2xvckJ5U3RyYW5kID0gY29sb3JCeVN0cmFuZE9uICYmIHZhbGlkQ29sb3JCeVN0cmFuZCA/IG8uY29sb3IgKyAnICcgKyBjb2xvckJ5U3RyYW5kIDogJyc7XG4gICAgby51c2VTY29yZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuaXMoJzpjaGVja2VkJykgPyAxIDogMDtcbiAgICBvLnVybCA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbCgpO1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiZWRHcmFwaCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JlZGdyYXBoLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRncmFwaFxudmFyIEJlZEdyYXBoRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0LmNhbGwodGhpcyk7IH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB1dGlscy53aWdCaW5GdW5jdGlvbnMsXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTsgfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICdkYXRhVmFsdWUnXSxcbiAgICAgICAgZGF0dW0gPSB7fSxcbiAgICAgICAgY2hyUG9zLCBzdGFydCwgZW5kLCB2YWw7XG4gICAgICBfLmVhY2gobGluZS5zcGxpdCgvXFxzKy8pLCBmdW5jdGlvbih2LCBpKSB7IGRhdHVtW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tkYXR1bS5jaHJvbV07XG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgfVxuICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGRhdHVtLmNocm9tU3RhcnQpO1xuICAgICAgZW5kID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbUVuZCk7XG4gICAgICB2YWwgPSBwYXJzZUZsb2F0KGRhdHVtLmRhdGFWYWx1ZSk7XG4gICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgZW5kLCB2YWw6IHZhbH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRHcmFwaEZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnQmVkIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnQmVkLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iaWdiZWRcbnZhciBCaWdCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY2hyb21vc29tZXM6ICcnLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAwXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdCZWQgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBjYWNoZSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIGRlbnNpdHk6ICdwYWNrJ30sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IFxuICAgICAgICAgICAgdmFyIGl0dmwgPSBzZWxmLnR5cGUoJ2JlZCcpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyBcbiAgICAgICAgICAgIC8vIFVzZSBCaW9QZXJsJ3MgQmlvOjpEQjpCaWdCZWQgc3RyYXRlZ3kgZm9yIGRlZHVwbGljYXRpbmcgcmUtZmV0Y2hlZCBpbnRlcnZhbHM6XG4gICAgICAgICAgICAvLyBcIkJlY2F1c2UgQkVEIGZpbGVzIGRvbid0IGFjdHVhbGx5IHVzZSBJRHMsIHRoZSBJRCBpcyBjb25zdHJ1Y3RlZCBmcm9tIHRoZSBmZWF0dXJlJ3MgbmFtZSAoaWYgYW55KSwgY2hyb21vc29tZSBjb29yZGluYXRlcywgc3RyYW5kIGFuZCBibG9jayBjb3VudC5cIlxuICAgICAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoaXR2bC5pZCkpIHtcbiAgICAgICAgICAgICAgaXR2bC5pZCA9IFtpdHZsLm5hbWUsIGl0dmwuY2hyb20sIGl0dmwuY2hyb21TdGFydCwgaXR2bC5jaHJvbUVuZCwgaXR2bC5zdHJhbmQsIGl0dmwuYmxvY2tDb3VudF0uam9pbihcIlxcdFwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpdHZsO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlfTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJpZ0JlZCBhbmQgc2V0dXAgdGhlIGJpbm5pbmcgc2NoZW1lIGZvciB0aGUgUmVtb3RlVHJhY2tcbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YTogeyB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsIH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIC8vIFNldCBtYXhGZXRjaFdpbmRvdyB0byBhdm9pZCBvdmVyZmV0Y2hpbmcgZGF0YS5cbiAgICAgICAgaWYgKCFzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgICAgICB2YXIgbWVhbkl0ZW1zUGVyQnAgPSBkYXRhLml0ZW1Db3VudCAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgICAgICAgIG1heEl0ZW1zVG9EcmF3ID0gXy5tYXgoXy52YWx1ZXMoc2VsZi5vcHRzLmRyYXdMaW1pdCkpO1xuICAgICAgICAgIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyA9IG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgICAgc2VsZi5vcHRzLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioc2VsZi5vcHRzLm1heEZldGNoV2luZG93IC8gMyk7XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3csIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gcGFyc2VEZW5zZURhdGEoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gW10sIFxuICAgICAgICBsaW5lcztcbiAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgeCkgeyBcbiAgICAgICAgaWYgKGxpbmUgIT0gJ24vYScgJiYgbGluZS5sZW5ndGgpIHsgZHJhd1NwZWMucHVzaCh7eDogeCwgdzogMSwgdjogcGFyc2VGbG9hdChsaW5lKSAqIDEwMDB9KTsgfSBcbiAgICAgIH0pO1xuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgZGVuc2l0eSBpcyBub3QgJ2RlbnNlJyBhbmQgd2UgY2FuIHJlYXNvbmFibHlcbiAgICAvLyBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggdG9vIG1hbnkgcm93cyAoPjUwMCBmZWF0dXJlcyksIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsIHtcbiAgICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCB3aWR0aDogd2lkdGgsIGRlbnNpdHk6IGRlbnNpdHl9LFxuICAgICAgICAgIHN1Y2Nlc3M6IHBhcnNlRGVuc2VEYXRhXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICAgIHZhciBjYWxjUGl4SW50ZXJ2YWwsIGRyYXdTcGVjID0ge307XG4gICAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHkgPT0gJ3BhY2snKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pO1xuICAgICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdCZWRGb3JtYXQ7IiwiXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdXaWcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdXaWcuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEJpZ1dpZ0Zvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJzEyOCwxMjgsMTI4JyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIGJpZ1dpZyB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogeydtaW5pbXVtJzoxLCAnbWF4aW11bSc6MSwgJ21lYW4nOjEsICdtaW4nOjEsICdtYXgnOjEsICdzdGQnOjEsICdjb3ZlcmFnZSc6MX0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24oc2VsZi5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge2luZm86IDEsIHVybDogdGhpcy5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgYXN5bmM6IGZhbHNlLCAgLy8gVGhpcyBpcyBjb29sIHNpbmNlIHBhcnNpbmcgbm9ybWFsbHkgaGFwcGVucyBpbiBhIFdlYiBXb3JrZXJcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIHJvd3MgPSBkYXRhLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICBfLmVhY2gocm93cywgZnVuY3Rpb24ocikge1xuICAgICAgICAgIHZhciBrZXl2YWwgPSByLnNwbGl0KCc6ICcpO1xuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtaW4nKSB7IHNlbGYucmFuZ2VbMF0gPSBNYXRoLm1pbihwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMF0pOyB9XG4gICAgICAgICAgaWYgKGtleXZhbFswXT09J21heCcpIHsgc2VsZi5yYW5nZVsxXSA9IE1hdGgubWF4KHBhcnNlRmxvYXQoa2V5dmFsWzFdKSwgc2VsZi5yYW5nZVsxXSk7IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgY2hyUmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIGlmIChsaW5lID09ICduL2EnKSB7IGRyYXdTcGVjLmJhcnMucHVzaChudWxsKTsgfVxuICAgICAgICBlbHNlIGlmIChsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5iYXJzLnB1c2goKHBhcnNlRmxvYXQobGluZSkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpOyB9XG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge3JhbmdlOiBjaHJSYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCB3aW5GdW5jOiBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb259LFxuICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgIH0pO1xuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpO1xuICAgICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpZ1dpZ0Zvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGZlYXR1cmVUYWJsZSBmb3JtYXQ6IGh0dHA6Ly93d3cuaW5zZGMub3JnL2ZpbGVzL2ZlYXR1cmVfdGFibGUuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuZmVhdHVyZXRhYmxlXG52YXIgRmVhdHVyZVRhYmxlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNvbGxhcHNlQnlHZW5lOiAnb2ZmJyxcbiAgICBrZXlDb2x1bW5XaWR0aDogMjEsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogbnVsbCwgcGFjazogbnVsbH1cbiAgfSxcbiAgXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgICB0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUgPSB0aGlzLmlzT24odGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKTtcbiAgICB0aGlzLmZlYXR1cmVUeXBlQ291bnRzID0ge307XG4gIH0sXG4gIFxuICAvLyBwYXJzZXMgb25lIGZlYXR1cmUga2V5ICsgbG9jYXRpb24vcXVhbGlmaWVycyByb3cgZnJvbSB0aGUgZmVhdHVyZSB0YWJsZVxuICBwYXJzZUVudHJ5OiBmdW5jdGlvbihjaHJvbSwgbGluZXMsIHN0YXJ0TGluZU5vKSB7XG4gICAgdmFyIGZlYXR1cmUgPSB7XG4gICAgICAgIGNocm9tOiBjaHJvbSxcbiAgICAgICAgc2NvcmU6ICc/JyxcbiAgICAgICAgYmxvY2tzOiBudWxsLFxuICAgICAgICBxdWFsaWZpZXJzOiB7fVxuICAgICAgfSxcbiAgICAgIGtleUNvbHVtbldpZHRoID0gdGhpcy5vcHRzLmtleUNvbHVtbldpZHRoLFxuICAgICAgcXVhbGlmaWVyID0gbnVsbCxcbiAgICAgIGZ1bGxMb2NhdGlvbiA9IFtdLFxuICAgICAgY29sbGFwc2VLZXlRdWFsaWZpZXJzID0gWydsb2N1c190YWcnLCAnZ2VuZScsICdkYl94cmVmJ10sXG4gICAgICBxdWFsaWZpZXJzVGhhdEFyZU5hbWVzID0gWydnZW5lJywgJ2xvY3VzX3RhZycsICdkYl94cmVmJ10sXG4gICAgICBSTkFUeXBlcyA9IFsncnJuYScsICd0cm5hJ10sXG4gICAgICBhbHNvVHJ5Rm9yUk5BVHlwZXMgPSBbJ3Byb2R1Y3QnXSxcbiAgICAgIGxvY2F0aW9uUG9zaXRpb25zLCBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyb21dO1xuICAgIHN0YXJ0TGluZU5vID0gc3RhcnRMaW5lTm8gfHwgMDtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaWxsIG91dCBmZWF0dXJlJ3Mga2V5cyB3aXRoIGluZm8gZnJvbSB0aGVzZSBsaW5lc1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIga2V5ID0gbGluZS5zdWJzdHIoMCwga2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICByZXN0T2ZMaW5lID0gbGluZS5zdWJzdHIoa2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICBxdWFsaWZpZXJNYXRjaCA9IHJlc3RPZkxpbmUubWF0Y2goL15cXC8oXFx3KykoPT8pKC4qKS8pO1xuICAgICAgaWYgKGtleS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgZmVhdHVyZS50eXBlID0gc3RyaXAoa2V5KTtcbiAgICAgICAgcXVhbGlmaWVyID0gbnVsbDtcbiAgICAgICAgZnVsbExvY2F0aW9uLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocXVhbGlmaWVyTWF0Y2gpIHtcbiAgICAgICAgICBxdWFsaWZpZXIgPSBxdWFsaWZpZXJNYXRjaFsxXTtcbiAgICAgICAgICBpZiAoIWZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKSB7IGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdID0gW107IH1cbiAgICAgICAgICBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXS5wdXNoKFtxdWFsaWZpZXJNYXRjaFsyXSA/IHF1YWxpZmllck1hdGNoWzNdIDogdHJ1ZV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChxdWFsaWZpZXIgIT09IG51bGwpIHsgXG4gICAgICAgICAgICBfLmxhc3QoZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0pLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uLmpvaW4oJycpO1xuICAgIGxvY2F0aW9uUG9zaXRpb25zID0gXy5tYXAoXy5maWx0ZXIoZnVsbExvY2F0aW9uLnNwbGl0KC9cXEQrLyksIF8uaWRlbnRpdHkpLCBwYXJzZUludDEwKTtcbiAgICBmZWF0dXJlLmNocm9tU3RhcnQgPSAgXy5taW4obG9jYXRpb25Qb3NpdGlvbnMpO1xuICAgIGZlYXR1cmUuY2hyb21FbmQgPSBfLm1heChsb2NhdGlvblBvc2l0aW9ucykgKyAxOyAvLyBGZWF0dXJlIHRhYmxlIHJhbmdlcyBhcmUgKmluY2x1c2l2ZSogb2YgdGhlIGVuZCBiYXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNocm9tRW5kIGNvbHVtbnMgaW4gQkVEIGZvcm1hdCBhcmUgKm5vdCouXG4gICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21TdGFydDtcbiAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21FbmQ7IFxuICAgIGZlYXR1cmUuc3RyYW5kID0gL2NvbXBsZW1lbnQvLnRlc3QoZnVsbExvY2F0aW9uKSA/IFwiLVwiIDogXCIrXCI7XG4gICAgXG4gICAgLy8gVW50aWwgd2UgbWVyZ2UgYnkgZ2VuZSBuYW1lLCB3ZSBkb24ndCBjYXJlIGFib3V0IHRoZXNlXG4gICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgIFxuICAgIC8vIFBhcnNlIHRoZSBxdWFsaWZpZXJzIHByb3Blcmx5XG4gICAgXy5lYWNoKGZlYXR1cmUucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgXy5lYWNoKHYsIGZ1bmN0aW9uKGVudHJ5TGluZXMsIGkpIHtcbiAgICAgICAgdltpXSA9IHN0cmlwKGVudHJ5TGluZXMuam9pbignICcpKTtcbiAgICAgICAgaWYgKC9eXCJbXFxzXFxTXSpcIiQvLnRlc3QodltpXSkpIHtcbiAgICAgICAgICAvLyBEZXF1b3RlIGZyZWUgdGV4dFxuICAgICAgICAgIHZbaV0gPSB2W2ldLnJlcGxhY2UoL15cInxcIiQvZywgJycpLnJlcGxhY2UoL1wiXCIvZywgJ1wiJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy9pZiAodi5sZW5ndGggPT0gMSkgeyBmZWF0dXJlLnF1YWxpZmllcnNba10gPSB2WzBdOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmluZCBzb21ldGhpbmcgdGhhdCBjYW4gc2VydmUgYXMgYSBuYW1lXG4gICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS50eXBlO1xuICAgIGlmIChfLmNvbnRhaW5zKFJOQVR5cGVzLCBmZWF0dXJlLnR5cGUudG9Mb3dlckNhc2UoKSkpIHsgXG4gICAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseShxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBhbHNvVHJ5Rm9yUk5BVHlwZXMpOyBcbiAgICB9XG4gICAgXy5maW5kKHF1YWxpZmllcnNUaGF0QXJlTmFtZXMsIGZ1bmN0aW9uKGspIHtcbiAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IHJldHVybiAoZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKTsgfVxuICAgIH0pO1xuICAgIC8vIEluIHRoZSB3b3JzdCBjYXNlLCBhZGQgYSBjb3VudGVyIHRvIGRpc2FtYmlndWF0ZSBmZWF0dXJlcyBuYW1lZCBvbmx5IGJ5IHR5cGVcbiAgICBpZiAoZmVhdHVyZS5uYW1lID09IGZlYXR1cmUudHlwZSkge1xuICAgICAgaWYgKCF0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0pIHsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdID0gMTsgfVxuICAgICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5uYW1lICsgJ18nICsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKys7XG4gICAgfVxuICAgIFxuICAgIC8vIEZpbmQgYSBrZXkgdGhhdCBpcyBhcHByb3ByaWF0ZSBmb3IgY29sbGFwc2luZ1xuICAgIGlmICh0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZmluZChjb2xsYXBzZUtleVF1YWxpZmllcnMsIGZ1bmN0aW9uKGspIHtcbiAgICAgICAgaWYgKGZlYXR1cmUucXVhbGlmaWVyc1trXSAmJiBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pIHsgXG4gICAgICAgICAgcmV0dXJuIChmZWF0dXJlLl9jb2xsYXBzZUtleSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIC8vIGNvbGxhcHNlcyBtdWx0aXBsZSBmZWF0dXJlcyB0aGF0IGFyZSBhYm91dCB0aGUgc2FtZSBnZW5lIGludG8gb25lIGRyYXdhYmxlIGZlYXR1cmVcbiAgY29sbGFwc2VGZWF0dXJlczogZnVuY3Rpb24oZmVhdHVyZXMpIHtcbiAgICB2YXIgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3MsXG4gICAgICBwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8gPSBbJ21ybmEnLCAnZ2VuZScsICdjZHMnXSxcbiAgICAgIHByZWZlcnJlZFR5cGVGb3JFeG9ucyA9IFsnZXhvbicsICdjZHMnXSxcbiAgICAgIG1lcmdlSW50byA9IGZlYXR1cmVzWzBdLFxuICAgICAgYmxvY2tzID0gW10sXG4gICAgICBmb3VuZFR5cGUsIGNkcywgZXhvbnM7XG4gICAgZm91bmRUeXBlID0gXy5maW5kKHByZWZlcnJlZFR5cGVUb01lcmdlSW50bywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgdmFyIGZvdW5kID0gXy5maW5kKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChmb3VuZCkgeyBtZXJnZUludG8gPSBmb3VuZDsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBMb29rIGZvciBleG9ucyAoZXVrYXJ5b3RpYykgb3IgYSBDRFMgKHByb2thcnlvdGljKVxuICAgIF8uZmluZChwcmVmZXJyZWRUeXBlRm9yRXhvbnMsIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIGV4b25zID0gXy5zZWxlY3QoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IHR5cGU7IH0pO1xuICAgICAgaWYgKGV4b25zLmxlbmd0aCkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH0pO1xuICAgIGNkcyA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gXCJjZHNcIjsgfSk7XG4gICAgXG4gICAgXy5lYWNoKGV4b25zLCBmdW5jdGlvbihleG9uRmVhdHVyZSkge1xuICAgICAgZXhvbkZlYXR1cmUuZnVsbExvY2F0aW9uLnJlcGxhY2UoLyhcXGQrKVxcLlxcLls+PF0/KFxcZCspL2csIGZ1bmN0aW9uKGZ1bGxNYXRjaCwgc3RhcnQsIGVuZCkge1xuICAgICAgICBibG9ja3MucHVzaCh7XG4gICAgICAgICAgc3RhcnQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyBNYXRoLm1pbihzdGFydCwgZW5kKSwgXG4gICAgICAgICAgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZS5cbiAgICAgICAgICBlbmQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyAgTWF0aC5tYXgoc3RhcnQsIGVuZCkgKyAxXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ29udmVydCBleG9ucyBhbmQgQ0RTIGludG8gYmxvY2tzLCB0aGlja1N0YXJ0IGFuZCB0aGlja0VuZCAoaW4gQkVEIHRlcm1pbm9sb2d5KVxuICAgIGlmIChibG9ja3MubGVuZ3RoKSB7IFxuICAgICAgbWVyZ2VJbnRvLmJsb2NrcyA9IF8uc29ydEJ5KGJsb2NrcywgZnVuY3Rpb24oYikgeyByZXR1cm4gYi5zdGFydDsgfSk7XG4gICAgICBtZXJnZUludG8udGhpY2tTdGFydCA9IGNkcyA/IGNkcy5zdGFydCA6IGZlYXR1cmUuc3RhcnQ7XG4gICAgICBtZXJnZUludG8udGhpY2tFbmQgPSBjZHMgPyBjZHMuZW5kIDogZmVhdHVyZS5lbmQ7XG4gICAgfVxuICAgIFxuICAgIC8vIGZpbmFsbHksIG1lcmdlIGFsbCB0aGUgcXVhbGlmaWVyc1xuICAgIF8uZWFjaChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkge1xuICAgICAgaWYgKGZlYXQgPT09IG1lcmdlSW50bykgeyByZXR1cm47IH1cbiAgICAgIF8uZWFjaChmZWF0LnF1YWxpZmllcnMsIGZ1bmN0aW9uKHZhbHVlcywgaykge1xuICAgICAgICBpZiAoIW1lcmdlSW50by5xdWFsaWZpZXJzW2tdKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdID0gW107IH1cbiAgICAgICAgXy5lYWNoKHZhbHVlcywgZnVuY3Rpb24odikge1xuICAgICAgICAgIGlmICghXy5jb250YWlucyhtZXJnZUludG8ucXVhbGlmaWVyc1trXSwgdikpIHsgbWVyZ2VJbnRvLnF1YWxpZmllcnNba10ucHVzaCh2KTsgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBtZXJnZUludG87XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBudW1MaW5lcyA9IGxpbmVzLmxlbmd0aCxcbiAgICAgIGNocm9tID0gbnVsbCxcbiAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbCxcbiAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleSA9IHt9LFxuICAgICAgZmVhdHVyZTtcbiAgICBcbiAgICBmdW5jdGlvbiBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubykge1xuICAgICAgaWYgKGxhc3RFbnRyeVN0YXJ0ICE9PSBudWxsKSB7XG4gICAgICAgIGZlYXR1cmUgPSBzZWxmLnR5cGUoKS5wYXJzZUVudHJ5LmNhbGwoc2VsZiwgY2hyb20sIGxpbmVzLnNsaWNlKGxhc3RFbnRyeVN0YXJ0LCBsaW5lbm8pLCBsYXN0RW50cnlTdGFydCk7XG4gICAgICAgIGlmIChmZWF0dXJlKSB7IFxuICAgICAgICAgIGlmIChvLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldID0gZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSB8fCBbXTtcbiAgICAgICAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0ucHVzaChmZWF0dXJlKTtcbiAgICAgICAgICB9IGVsc2UgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIENodW5rIHRoZSBsaW5lcyBpbnRvIGVudHJpZXMgYW5kIHBhcnNlIGVhY2ggb2YgdGhlbVxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICBpZiAobGluZS5zdWJzdHIoMCwgMTIpID09IFwiQUNDRVNTSU9OICAgXCIpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBjaHJvbSA9IGxpbmUuc3Vic3RyKDEyKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmIChjaHJvbSAhPT0gbnVsbCAmJiBsaW5lLnN1YnN0cig1LCAxKS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBsYXN0RW50cnlTdGFydCA9IGxpbmVubztcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBwYXJzZSB0aGUgbGFzdCBlbnRyeVxuICAgIGlmIChjaHJvbSAhPT0gbnVsbCkgeyBjb2xsZWN0TGFzdEVudHJ5KGxpbmVzLmxlbmd0aCk7IH1cbiAgICBcbiAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgXy5lYWNoKGZlYXR1cmVzQnlDb2xsYXBzZUtleSwgZnVuY3Rpb24oZmVhdHVyZXMsIGdlbmUpIHtcbiAgICAgICAgZGF0YS5hZGQoc2VsZi50eXBlKCkuY29sbGFwc2VGZWF0dXJlcy5jYWxsKHNlbGYsIGZlYXR1cmVzKSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gc3BlY2lhbCBmb3JtYXR0ZXIgZm9yIGNvbnRlbnQgaW4gdG9vbHRpcHMgZm9yIGZlYXR1cmVzXG4gIHRpcFRpcERhdGE6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgcXVhbGlmaWVyc1RvQWJicmV2aWF0ZSA9IHt0cmFuc2xhdGlvbjogMX0sXG4gICAgICBjb250ZW50ID0ge1xuICAgICAgICB0eXBlOiBkYXRhLmQudHlwZSxcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH07XG4gICAgaWYgKGRhdGEuZC5xdWFsaWZpZXJzLm5vdGUgJiYgZGF0YS5kLnF1YWxpZmllcnMubm90ZVswXSkgeyAgfVxuICAgIF8uZWFjaChkYXRhLmQucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgaWYgKGsgPT0gJ25vdGUnKSB7IGNvbnRlbnQuZGVzY3JpcHRpb24gPSB2LmpvaW4oJzsgJyk7IHJldHVybjsgfVxuICAgICAgY29udGVudFtrXSA9IHYuam9pbignOyAnKTtcbiAgICAgIGlmIChxdWFsaWZpZXJzVG9BYmJyZXZpYXRlW2tdICYmIGNvbnRlbnRba10ubGVuZ3RoID4gMjUpIHsgY29udGVudFtrXSA9IGNvbnRlbnRba10uc3Vic3RyKDAsIDI1KSArICcuLi4nOyB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykucHJlcmVuZGVyLmNhbGwodGhpcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5kcmF3U3BlYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5yZW5kZXIuY2FsbCh0aGlzLCBjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBGZWF0dXJlVGFibGVGb3JtYXQ7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBTb3J0ZWRMaXN0ID0gcmVxdWlyZSgnLi9Tb3J0ZWRMaXN0LmpzJykuU29ydGVkTGlzdDsgIFxuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvaW50ZXJ2YWwtdHJlZVxuICogSW50ZXJ2YWxUcmVlXG4gKlxuICogQHBhcmFtIChvYmplY3QpIGRhdGE6XG4gKiBAcGFyYW0gKG51bWJlcikgY2VudGVyOlxuICogQHBhcmFtIChvYmplY3QpIG9wdGlvbnM6XG4gKiAgIGNlbnRlcjpcbiAqXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbFRyZWUoY2VudGVyLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgfHwgKG9wdGlvbnMgPSB7fSk7XG5cbiAgdGhpcy5zdGFydEtleSAgICAgPSBvcHRpb25zLnN0YXJ0S2V5IHx8IDA7IC8vIHN0YXJ0IGtleVxuICB0aGlzLmVuZEtleSAgICAgICA9IG9wdGlvbnMuZW5kS2V5ICAgfHwgMTsgLy8gZW5kIGtleVxuICB0aGlzLmludGVydmFsSGFzaCA9IHt9OyAgICAgICAgICAgICAgICAgICAgLy8gaWQgPT4gaW50ZXJ2YWwgb2JqZWN0XG4gIHRoaXMucG9pbnRUcmVlID0gbmV3IFNvcnRlZExpc3QoeyAgICAgICAgICAvLyBiLXRyZWUgb2Ygc3RhcnQsIGVuZCBwb2ludHMgXG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhWzBdLSBiWzBdO1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5fYXV0b0luY3JlbWVudCA9IDA7XG5cbiAgLy8gaW5kZXggb2YgdGhlIHJvb3Qgbm9kZVxuICBpZiAoIWNlbnRlciB8fCB0eXBlb2YgY2VudGVyICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGNlbnRlciBpbmRleCBhcyB0aGUgMm5kIGFyZ3VtZW50LicpO1xuICB9XG5cbiAgdGhpcy5yb290ID0gbmV3IE5vZGUoY2VudGVyLCB0aGlzKTtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIGlmICh0aGlzLmludGVydmFsSGFzaFtpZF0pIHtcbiAgICB0aHJvdyBuZXcgRHVwbGljYXRlRXJyb3IoJ2lkICcgKyBpZCArICcgaXMgYWxyZWFkeSByZWdpc3RlcmVkLicpO1xuICB9XG5cbiAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgIHdoaWxlICh0aGlzLmludGVydmFsSGFzaFt0aGlzLl9hdXRvSW5jcmVtZW50XSkge1xuICAgICAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICAgIH1cbiAgICBpZCA9IHRoaXMuX2F1dG9JbmNyZW1lbnQ7XG4gIH1cblxuICB2YXIgaXR2bCA9IG5ldyBJbnRlcnZhbChkYXRhLCBpZCwgdGhpcy5zdGFydEtleSwgdGhpcy5lbmRLZXkpO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuc3RhcnQsIGlkXSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5lbmQsICAgaWRdKTtcbiAgdGhpcy5pbnRlcnZhbEhhc2hbaWRdID0gaXR2bDtcbiAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICAvL3RyeSB7XG4gICAgX2luc2VydC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgaXR2bCk7XG4gIC8vfSBjYXRjaCAoZSkge1xuICAvLyAgaWYgKGUgaW5zdGFuY2VvZiBSYW5nZUVycm9yKSB7IGNvbnNvbGUubG9nIChkYXRhKTsgfVxuICAvL31cbn07XG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlIG9ubHkgaWYgaXQgaXMgbmV3LCBiYXNlZCBvbiB3aGV0aGVyIHRoZSBpZCB3YXMgYWxyZWFkeSByZWdpc3RlcmVkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3ID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgdHJ5IHtcbiAgICB0aGlzLmFkZChkYXRhLCBpZCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIER1cGxpY2F0ZUVycm9yKSB7IHJldHVybjsgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAoaW50ZWdlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIpIHtcbiAgdmFyIHJldCA9IFtdO1xuICBpZiAodHlwZW9mIHZhbDEgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuXG4gIGlmICh2YWwyID09IHVuZGVmaW5lZCkge1xuICAgIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgdmFsMSwgcmV0KTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2YgdmFsMiA9PSAnbnVtYmVyJykge1xuICAgIF9yYW5nZVNlYXJjaC5jYWxsKHRoaXMsIHZhbDEsIHZhbDIsIHJldCk7XG4gIH1cbiAgZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnLCcgKyB2YWwyICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiBcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyB0aGUgc2hpZnQtcmlnaHQtYW5kLWZpbGwgb3BlcmF0b3IsIGV4dGVuZGVkIGJleW9uZCB0aGUgcmFuZ2Ugb2YgYW4gaW50MzJcbmZ1bmN0aW9uIF9iaXRTaGlmdFJpZ2h0KG51bSkge1xuICBpZiAobnVtID4gMjE0NzQ4MzY0NyB8fCBudW0gPCAtMjE0NzQ4MzY0OCkgeyByZXR1cm4gTWF0aC5mbG9vcihudW0gLyAyKTsgfVxuICByZXR1cm4gbnVtID4+PiAxO1xufVxuXG4vKipcbiAqIF9pbnNlcnRcbiAqKi9cbmZ1bmN0aW9uIF9pbnNlcnQobm9kZSwgaXR2bCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChpdHZsLmVuZCA8IG5vZGUuaWR4KSB7XG4gICAgICBpZiAoIW5vZGUubGVmdCkge1xuICAgICAgICBub2RlLmxlZnQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChub2RlLmlkeCA8IGl0dmwuc3RhcnQpIHtcbiAgICAgIGlmICghbm9kZS5yaWdodCkge1xuICAgICAgICBub2RlLnJpZ2h0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG5vZGUuaW5zZXJ0KGl0dmwpO1xuICAgIH1cbiAgfVxufVxuXG5cbi8qKlxuICogX3BvaW50U2VhcmNoXG4gKiBAcGFyYW0gKE5vZGUpIG5vZGVcbiAqIEBwYXJhbSAoaW50ZWdlcikgaWR4IFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcG9pbnRTZWFyY2gobm9kZSwgaWR4LCBhcnIpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoIW5vZGUpIGJyZWFrO1xuICAgIGlmIChpZHggPCBub2RlLmlkeCkge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5zdGFydCA8PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAoaWR4ID4gbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuZW5kcy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLmVuZCA+PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLm1hcChmdW5jdGlvbihpdHZsKSB7IGFyci5wdXNoKGl0dmwucmVzdWx0KCkpIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cblxuXG4vKipcbiAqIF9yYW5nZVNlYXJjaFxuICogQHBhcmFtIChpbnRlZ2VyKSBzdGFydFxuICogQHBhcmFtIChpbnRlZ2VyKSBlbmRcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3JhbmdlU2VhcmNoKHN0YXJ0LCBlbmQsIGFycikge1xuICBpZiAoZW5kIC0gc3RhcnQgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kIG11c3QgYmUgZ3JlYXRlciB0aGFuIHN0YXJ0LiBzdGFydDogJyArIHN0YXJ0ICsgJywgZW5kOiAnICsgZW5kKTtcbiAgfVxuICB2YXIgcmVzdWx0SGFzaCA9IHt9O1xuXG4gIHZhciB3aG9sZVdyYXBzID0gW107XG4gIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgX2JpdFNoaWZ0UmlnaHQoc3RhcnQgKyBlbmQpLCB3aG9sZVdyYXBzLCB0cnVlKTtcblxuICB3aG9sZVdyYXBzLmZvckVhY2goZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgcmVzdWx0SGFzaFtyZXN1bHQuaWRdID0gdHJ1ZTtcbiAgfSk7XG5cblxuICB2YXIgaWR4MSA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW3N0YXJ0LCBudWxsXSk7XG4gIHdoaWxlIChpZHgxID49IDAgJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDFdWzBdID09IHN0YXJ0KSB7XG4gICAgaWR4MS0tO1xuICB9XG5cbiAgdmFyIGlkeDIgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtlbmQsICAgbnVsbF0pO1xuICB2YXIgbGVuID0gdGhpcy5wb2ludFRyZWUuYXJyLmxlbmd0aCAtIDE7XG4gIHdoaWxlIChpZHgyID09IC0xIHx8IChpZHgyIDw9IGxlbiAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4Ml1bMF0gPD0gZW5kKSkge1xuICAgIGlkeDIrKztcbiAgfVxuXG4gIHRoaXMucG9pbnRUcmVlLmFyci5zbGljZShpZHgxICsgMSwgaWR4MikuZm9yRWFjaChmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBpZCA9IHBvaW50WzFdO1xuICAgIHJlc3VsdEhhc2hbaWRdID0gdHJ1ZTtcbiAgfSwgdGhpcyk7XG5cbiAgT2JqZWN0LmtleXMocmVzdWx0SGFzaCkuZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgIHZhciBpdHZsID0gdGhpcy5pbnRlcnZhbEhhc2hbaWRdO1xuICAgIGFyci5wdXNoKGl0dmwucmVzdWx0KHN0YXJ0LCBlbmQpKTtcbiAgfSwgdGhpcyk7XG5cbn1cblxuXG5cbi8qKlxuICogc3ViY2xhc3Nlc1xuICogXG4gKiovXG5cblxuLyoqXG4gKiBOb2RlIDogcHJvdG90eXBlIG9mIGVhY2ggbm9kZSBpbiBhIGludGVydmFsIHRyZWVcbiAqIFxuICoqL1xuZnVuY3Rpb24gTm9kZShpZHgpIHtcbiAgdGhpcy5pZHggPSBpZHg7XG4gIHRoaXMuc3RhcnRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVuZHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLmVuZCAtIGIuZW5kO1xuICAgICAgcmV0dXJuIChjIDwgMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIGluc2VydCBhbiBJbnRlcnZhbCBvYmplY3QgdG8gdGhpcyBub2RlXG4gKiovXG5Ob2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihpbnRlcnZhbCkge1xuICB0aGlzLnN0YXJ0cy5pbnNlcnQoaW50ZXJ2YWwpO1xuICB0aGlzLmVuZHMuaW5zZXJ0KGludGVydmFsKTtcbn07XG5cblxuXG4vKipcbiAqIEludGVydmFsIDogcHJvdG90eXBlIG9mIGludGVydmFsIGluZm9cbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsKGRhdGEsIGlkLCBzLCBlKSB7XG4gIHRoaXMuaWQgICAgID0gaWQ7XG4gIHRoaXMuc3RhcnQgID0gZGF0YVtzXTtcbiAgdGhpcy5lbmQgICAgPSBkYXRhW2VdO1xuICB0aGlzLmRhdGEgICA9IGRhdGE7XG5cbiAgaWYgKHR5cGVvZiB0aGlzLnN0YXJ0ICE9ICdudW1iZXInIHx8IHR5cGVvZiB0aGlzLmVuZCAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQsIGVuZCBtdXN0IGJlIG51bWJlci4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG5cbiAgaWYgKCB0aGlzLnN0YXJ0ID49IHRoaXMuZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCBtdXN0IGJlIHNtYWxsZXIgdGhhbiBlbmQuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxufVxuXG4vKipcbiAqIGdldCByZXN1bHQgb2JqZWN0XG4gKiovXG5JbnRlcnZhbC5wcm90b3R5cGUucmVzdWx0ID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0ge1xuICAgIGlkICAgOiB0aGlzLmlkLFxuICAgIGRhdGEgOiB0aGlzLmRhdGFcbiAgfTtcbiAgaWYgKHR5cGVvZiBzdGFydCA9PSAnbnVtYmVyJyAmJiB0eXBlb2YgZW5kID09ICdudW1iZXInKSB7XG4gICAgLyoqXG4gICAgICogY2FsYyBvdmVybGFwcGluZyByYXRlXG4gICAgICoqL1xuICAgIHZhciBsZWZ0ICA9IE1hdGgubWF4KHRoaXMuc3RhcnQsIHN0YXJ0KTtcbiAgICB2YXIgcmlnaHQgPSBNYXRoLm1pbih0aGlzLmVuZCwgICBlbmQpO1xuICAgIHZhciBsYXBMbiA9IHJpZ2h0IC0gbGVmdDtcbiAgICByZXQucmF0ZTEgPSBsYXBMbiAvIChlbmQgLSBzdGFydCk7XG4gICAgcmV0LnJhdGUyID0gbGFwTG4gLyAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0KTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gRHVwbGljYXRlRXJyb3IobWVzc2FnZSkge1xuICAgIHRoaXMubmFtZSA9ICdEdXBsaWNhdGVFcnJvcic7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLnN0YWNrID0gKG5ldyBFcnJvcigpKS5zdGFjaztcbn1cbkR1cGxpY2F0ZUVycm9yLnByb3RvdHlwZSA9IG5ldyBFcnJvcjtcblxuZXhwb3J0cy5JbnRlcnZhbFRyZWUgPSBJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gTGluZU1hc2s6IEEgKHZlcnkgY2hlYXApIGFsdGVybmF0aXZlIHRvIEludGVydmFsVHJlZTogYSBzbWFsbCwgMUQgcGl4ZWwgYnVmZmVyIG9mIG9iamVjdHMuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcblxuZnVuY3Rpb24gTGluZU1hc2sod2lkdGgsIGZ1ZGdlKSB7XG4gIHRoaXMuZnVkZ2UgPSBmdWRnZSA9IChmdWRnZSB8fCAxKTtcbiAgdGhpcy5pdGVtcyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IE1hdGguY2VpbCh3aWR0aCAvIGZ1ZGdlKTtcbiAgdGhpcy5tYXNrID0gZ2xvYmFsLlVpbnQ4QXJyYXkgPyBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aCkgOiBuZXcgQXJyYXkodGhpcy5sZW5ndGgpO1xufVxuXG5MaW5lTWFzay5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oeCwgdywgZGF0YSkge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIHRoaXMuaXRlbXMucHVzaCh7eDogeCwgdzogdywgZGF0YTogZGF0YX0pO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyB0aGlzLm1hc2tbaV0gPSAxOyB9XG59O1xuXG5MaW5lTWFzay5wcm90b3R5cGUuY29uZmxpY3QgPSBmdW5jdGlvbih4LCB3KSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgaWYgKHRoaXMubWFza1tpXSkgcmV0dXJuIHRydWU7IH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuZXhwb3J0cy5MaW5lTWFzayA9IExpbmVNYXNrO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTsgIFxuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIFdyYXBzIHR3byBvZiBTaGluIFN1enVraSdzIEludGVydmFsVHJlZXMgdG8gc3RvcmUgaW50ZXJ2YWxzIHRoYXQgKm1heSpcbiAqIGJlIHBhaXJlZC5cbiAqXG4gKiBAc2VlIEludGVydmFsVHJlZSgpXG4gKiovXG5mdW5jdGlvbiBQYWlyZWRJbnRlcnZhbFRyZWUoY2VudGVyLCBvcHRpb25zKSB7XG4gIHRoaXMudW5wYWlyZWQgPSBuZXcgSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucyk7XG4gIHRoaXMucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIG9wdGlvbnMpO1xufVxuXG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2VcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgLy8gVE9ETzogYWRkIHRvIGVhY2ggb2YgdGhpcy5wYWlyZWQgYW5kIHRoaXMudW5wYWlyZWQuXG59O1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIC8vIFRPRE86IGFkZCB0byBlYWNoIG9mIHRoaXMucGFpcmVkIGFuZCB0aGlzLnVucGFpcmVkLlxuICB0aGlzLnVucGFpcmVkLmFkZElmTmV3KGRhdGEsIGlkKTtcbn1cblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAoaW50ZWdlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIsIHBhaXJlZCkge1xuICBjb25zb2xlLmxvZyhwYWlyZWQpO1xuICByZXR1cm4gdGhpcy51bnBhaXJlZC5zZWFyY2godmFsMSwgdmFsMik7XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiB1bmltcGxlbWVudGVkIGZvciBub3dcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuZXhwb3J0cy5QYWlyZWRJbnRlcnZhbFRyZWUgPSBQYWlyZWRJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLyoqXG4gICogUmVtb3RlVHJhY2tcbiAgKlxuICAqIEEgaGVscGVyIGNsYXNzIGJ1aWx0IGZvciBjYWNoaW5nIGRhdGEgZmV0Y2hlZCBmcm9tIGEgcmVtb3RlIHRyYWNrIChkYXRhIGFsaWduZWQgdG8gYSBnZW5vbWUpLlxuICAqIFRoZSBnZW5vbWUgaXMgZGl2aWRlZCBpbnRvIGJpbnMgb2Ygb3B0aW1hbEZldGNoV2luZG93IG50cywgZm9yIGVhY2ggb2Ygd2hpY2ggZGF0YSB3aWxsIG9ubHkgYmUgZmV0Y2hlZCBvbmNlLlxuICAqIFRvIHNldHVwIHRoZSBiaW5zLCBjYWxsIC5zZXR1cEJpbnMoLi4uKSBhZnRlciBpbml0aWFsaXppbmcgdGhlIGNsYXNzLlxuICAqXG4gICogVGhlcmUgaXMgb25lIG1haW4gcHVibGljIG1ldGhvZCBmb3IgdGhpcyBjbGFzczogLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgY2FsbGJhY2spXG4gICogKEZvciBjb25zaXN0ZW5jeSB3aXRoIEN1c3RvbVRyYWNrcy5qcywgYWxsIGBzdGFydGAgYW5kIGBlbmRgIHBvc2l0aW9ucyBhcmUgMS1iYXNlZCwgb3JpZW50ZWQgdG9cbiAgKiB0aGUgc3RhcnQgb2YgdGhlIGdlbm9tZSwgYW5kIGludGVydmFscyBhcmUgcmlnaHQtb3Blbi4pXG4gICpcbiAgKiBUaGlzIG1ldGhvZCB3aWxsIHJlcXVlc3QgYW5kIGNhY2hlIGRhdGEgZm9yIHRoZSBnaXZlbiBpbnRlcnZhbCB0aGF0IGlzIG5vdCBhbHJlYWR5IGNhY2hlZCwgYW5kIGNhbGwgXG4gICogY2FsbGJhY2soaW50ZXJ2YWxzKSBhcyBzb29uIGFzIGRhdGEgZm9yIGFsbCBpbnRlcnZhbHMgaXMgYXZhaWxhYmxlLiAoSWYgdGhlIGRhdGEgaXMgYWxyZWFkeSBhdmFpbGFibGUsIFxuICAqIGl0IHdpbGwgY2FsbCB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkuKVxuICAqKi9cblxudmFyIEJJTl9MT0FESU5HID0gMSxcbiAgQklOX0xPQURFRCA9IDI7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrIGNvbnN0cnVjdG9yLlxuICAqXG4gICogTm90ZSB5b3Ugc3RpbGwgbXVzdCBjYWxsIGAuc2V0dXBCaW5zKC4uLilgIGJlZm9yZSB0aGUgUmVtb3RlVHJhY2sgaXMgcmVhZHkgdG8gZmV0Y2ggZGF0YS5cbiAgKlxuICAqIEBwYXJhbSAoSW50ZXJ2YWxUcmVlKSBjYWNoZTogQW4gY2FjaGUgc3RvcmUgdGhhdCB3aWxsIHJlY2VpdmUgaW50ZXJ2YWxzIGZldGNoZWQgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU2hvdWxkIGJlIGFuIEludGVydmFsVHJlZSBvciBlcXVpdmFsZW50LCB0aGF0IGltcGxlbWVudHMgYC5hZGRJZk5ldyguLi4pYCBhbmQgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgLnNlYXJjaChzdGFydCwgZW5kKWAgbWV0aG9kcy4gSWYgaXQgaXMgYW4gKmV4dGVuc2lvbiogb2YgYW4gSW50ZXJ2YWxUcmVlLCBub3RlIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGBleHRyYUFyZ3NgIHBhcmFtIHBlcm1pdHRlZCBmb3IgYC5mZXRjaEFzeW5jKClgLCB3aGljaCBhcmUgcGFzc2VkIGFsb25nIGFzIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0cmEgYXJndW1lbnRzIHRvIGAuc2VhcmNoKClgLlxuICAqIEBwYXJhbSAoZnVuY3Rpb24pIGZldGNoZXI6IEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCB0byBmZXRjaCBkYXRhIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIGZ1bmN0aW9uIHNob3VsZCB0YWtlIHRocmVlIGFyZ3VtZW50cywgYHN0YXJ0YCwgYGVuZGAsIGFuZCBgc3RvcmVJbnRlcnZhbHNgLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0b3JlSW50ZXJ2YWxzYCBpcyBhIGNhbGxiYWNrIHRoYXQgYGZldGNoZXJgIE1VU1QgY2FsbCBvbiB0aGUgYXJyYXkgb2YgaW50ZXJ2YWxzXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgb25jZSB0aGV5IGhhdmUgYmVlbiBmZXRjaGVkIGZyb20gdGhlIHJlbW90ZSBkYXRhIHNvdXJjZSBhbmQgcGFyc2VkLlxuICAqIEBzZWUgX2ZldGNoQmluIGZvciBob3cgYGZldGNoZXJgIGlzIHV0aWxpemVkLlxuICAqKi9cbmZ1bmN0aW9uIFJlbW90ZVRyYWNrKGNhY2hlLCBmZXRjaGVyKSB7XG4gIGlmICh0eXBlb2YgY2FjaGUgIT0gJ29iamVjdCcgfHwgKCFjYWNoZS5hZGRJZk5ldyAmJiAoIV8ua2V5cyhjYWNoZSkubGVuZ3RoIHx8IGNhY2hlW18ua2V5cyhjYWNoZSlbMF1dLmFkZElmTmV3KSkpIHsgXG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGFuIEludGVydmFsVHJlZSBjYWNoZSwgb3IgYW4gb2JqZWN0L2FycmF5IGNvbnRhaW5pbmcgSW50ZXJ2YWxUcmVlcywgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgXG4gIH1cbiAgaWYgKHR5cGVvZiBmZXRjaGVyICE9ICdmdW5jdGlvbicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGEgZmV0Y2hlciBmdW5jdGlvbiBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIFxuICB0aGlzLmNhY2hlID0gY2FjaGU7XG4gIHRoaXMuZmV0Y2hlciA9IGZldGNoZXI7XG4gIFxuICB0aGlzLmNhbGxiYWNrcyA9IFtdO1xuICB0aGlzLmFmdGVyQmluU2V0dXAgPSBbXTtcbiAgdGhpcy5iaW5zTG9hZGVkID0gbnVsbDtcbn1cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG4vLyBTZXR1cCB0aGUgYmlubmluZyBzY2hlbWUgZm9yIHRoaXMgUmVtb3RlVHJhY2suIFRoaXMgY2FuIG9jY3VyIGFueXRpbWUgYWZ0ZXIgaW5pdGlhbGl6YXRpb24sIGFuZCBpbiBmYWN0LFxuLy8gY2FuIG9jY3VyIGFmdGVyIGNhbGxzIHRvIGAuZmV0Y2hBc3luYygpYCBoYXZlIGJlZW4gbWFkZSwgaW4gd2hpY2ggY2FzZSB0aGV5IHdpbGwgYmUgd2FpdGluZyBvbiB0aGlzIG1ldGhvZFxuLy8gdG8gYmUgY2FsbGVkIHRvIHByb2NlZWQuIEJ1dCBpdCBNVVNUIGJlIGNhbGxlZCBiZWZvcmUgZGF0YSB3aWxsIGJlIHJlY2VpdmVkIGJ5IGNhbGxiYWNrcyBwYXNzZWQgdG8gXG4vLyBgLmZldGNoQXN5bmMoKWAuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuc2V0dXBCaW5zID0gZnVuY3Rpb24oZ2Vub21lU2l6ZSwgb3B0aW1hbEZldGNoV2luZG93LCBtYXhGZXRjaFdpbmRvdykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChzZWxmLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IHJ1biBzZXR1cEJpbnMgbW9yZSB0aGFuIG9uY2UuJyk7IH1cbiAgaWYgKHR5cGVvZiBnZW5vbWVTaXplICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSB0aGUgZ2Vub21lU2l6ZSBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2Ygb3B0aW1hbEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBvcHRpbWFsRmV0Y2hXaW5kb3cgYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXhGZXRjaFdpbmRvdyBhcyB0aGUgM3JkIGFyZ3VtZW50LicpOyB9XG4gIFxuICBzZWxmLmdlbm9tZVNpemUgPSBnZW5vbWVTaXplO1xuICBzZWxmLm9wdGltYWxGZXRjaFdpbmRvdyA9IG9wdGltYWxGZXRjaFdpbmRvdztcbiAgc2VsZi5tYXhGZXRjaFdpbmRvdyA9IG1heEZldGNoV2luZG93O1xuICBcbiAgc2VsZi5udW1CaW5zID0gTWF0aC5jZWlsKGdlbm9tZVNpemUgLyBvcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICBzZWxmLmJpbnNMb2FkZWQgPSB7fTtcbiAgXG4gIC8vIEZpcmUgb2ZmIHJhbmdlcyBzYXZlZCB0byBhZnRlckJpblNldHVwXG4gIF8uZWFjaCh0aGlzLmFmdGVyQmluU2V0dXAsIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgc2VsZi5mZXRjaEFzeW5jKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQsIHJhbmdlLmV4dHJhQXJncyk7XG4gIH0pO1xuICBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMoc2VsZik7XG59XG5cblxuLy8gRmV0Y2hlcyBkYXRhIChpZiBuZWNlc3NhcnkpIGZvciB1bmZldGNoZWQgYmlucyBvdmVybGFwcGluZyB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBUaGVuLCBydW4gYGNhbGxiYWNrYCBvbiBhbGwgc3RvcmVkIHN1YmludGVydmFscyB0aGF0IG92ZXJsYXAgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gYGV4dHJhQXJnYCBpcyBhbiAqb3B0aW9uYWwqIHBhcmFtZXRlciB0aGF0IGlzIHBhc3NlZCBhbG9uZyB0byB0aGUgYC5zZWFyY2goKWAgZnVuY3Rpb24gb2YgdGhlIGNhY2hlLlxuLy9cbi8vIEBwYXJhbSAobnVtYmVyKSBzdGFydDogICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgdG8gc3RhcnQgZmV0Y2hpbmcgZnJvbVxuLy8gQHBhcmFtIChudW1iZXIpIGVuZDogICAgICAgICAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZSAocmlnaHQtb3BlbikgdG8gc3RhcnQgZmV0Y2hpbmcgKnVudGlsKlxuLy8gQHBhcmFtIChBcnJheSkgW2V4dHJhQXJnc106ICBvcHRpb25hbCwgcGFzc2VkIGFsb25nIHRvIHRoZSBgLnNlYXJjaCgpYCBjYWxscyBvbiB0aGUgLmNhY2hlIGFzIGFyZ3VtZW50cyAzIGFuZCB1cDsgXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBlcmhhcHMgdXNlZnVsIGlmIHRoZSAuY2FjaGUgaGFzIG92ZXJyaWRkZW4gdGhpcyBtZXRob2Rcbi8vIEBwYXJhbSAoZnVuY3Rpb24pIGNhbGxiYWNrOiAgQSBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgY2FsbGVkIG9uY2UgZGF0YSBpcyByZWFkeSBmb3IgdGhpcyBpbnRlcnZhbC4gV2lsbCBiZSBwYXNzZWRcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxsIGludGVydmFsIGZlYXR1cmVzIHRoYXQgaGF2ZSBiZWVuIGZldGNoZWQgZm9yIHRoaXMgaW50ZXJ2YWwsIG9yIHt0b29NYW55OiB0cnVlfVxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiBtb3JlIGRhdGEgd2FzIHJlcXVlc3RlZCB0aGFuIGNvdWxkIGJlIHJlYXNvbmFibHkgZmV0Y2hlZC5cblJlbW90ZVRyYWNrLnByb3RvdHlwZS5mZXRjaEFzeW5jID0gZnVuY3Rpb24oc3RhcnQsIGVuZCwgZXh0cmFBcmdzLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChfLmlzRnVuY3Rpb24oZXh0cmFBcmdzKSAmJiBfLmlzVW5kZWZpbmVkKGNhbGxiYWNrKSkgeyBjYWxsYmFjayA9IGV4dHJhQXJnczsgZXh0cmFBcmdzID0gdW5kZWZpbmVkOyB9XG4gIGlmICghc2VsZi5iaW5zTG9hZGVkKSB7XG4gICAgLy8gSWYgYmlucyAqYXJlbid0KiBzZXR1cCB5ZXQ6XG4gICAgLy8gU2F2ZSB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIFNhdmUgdGhpcyBmZXRjaCBmb3Igd2hlbiB0aGUgYmlucyBhcmUgbG9hZGVkXG4gICAgc2VsZi5hZnRlckJpblNldHVwLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgYmlucyAqYXJlKiBzZXR1cCwgZmlyc3QgY2FsY3VsYXRlIHdoaWNoIGJpbnMgY29ycmVzcG9uZCB0byB0aGlzIGludGVydmFsLCBcbiAgICAvLyBhbmQgd2hhdCBzdGF0ZSB0aG9zZSBiaW5zIGFyZSBpblxuICAgIHZhciBiaW5zID0gX2Jpbk92ZXJsYXAoc2VsZiwgc3RhcnQsIGVuZCksXG4gICAgICBsb2FkZWRCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gc2VsZi5iaW5zTG9hZGVkW2ldID09PSBCSU5fTE9BREVEOyB9KSxcbiAgICAgIGJpbnNUb0ZldGNoID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gIXNlbGYuYmluc0xvYWRlZFtpXTsgfSk7XG4gICAgXG4gICAgaWYgKGxvYWRlZEJpbnMubGVuZ3RoID09IGJpbnMubGVuZ3RoKSB7XG4gICAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGxvYWRlZCBkYXRhIGZvciBhbGwgdGhlIGJpbnMgaW4gcXVlc3Rpb24sIHNob3J0LWNpcmN1aXQgYW5kIHJ1biB0aGUgY2FsbGJhY2sgbm93XG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGV4dHJhQXJncykgPyBbXSA6IGV4dHJhQXJncztcbiAgICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKHNlbGYuY2FjaGUuc2VhcmNoLmFwcGx5KHNlbGYuY2FjaGUsIFtzdGFydCwgZW5kXS5jb25jYXQoZXh0cmFBcmdzKSkpO1xuICAgIH0gZWxzZSBpZiAoZW5kIC0gc3RhcnQgPiBzZWxmLm1heEZldGNoV2luZG93KSB7XG4gICAgICAvLyBlbHNlLCBpZiB0aGlzIGludGVydmFsIGlzIHRvbyBiaWcgKD4gbWF4RmV0Y2hXaW5kb3cpLCBmaXJlIHRoZSBjYWxsYmFjayByaWdodCBhd2F5IHdpdGgge3Rvb01hbnk6IHRydWV9XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH1cbiAgICBcbiAgICAvLyBlbHNlLCBwdXNoIHRoZSBjYWxsYmFjayBvbnRvIHRoZSBxdWV1ZVxuICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IFxuICAgICAgc2VsZi5jYWxsYmFja3MucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmc6IGV4dHJhQXJnLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIHRoZW4gcnVuIGZldGNoZXMgZm9yIHRoZSB1bmZldGNoZWQgYmlucywgd2hpY2ggc2hvdWxkIGNhbGwgX2ZpcmVDYWxsYmFja3MgYWZ0ZXIgdGhleSBjb21wbGV0ZSxcbiAgICAvLyB3aGljaCB3aWxsIGF1dG9tYXRpY2FsbHkgZmlyZSBjYWxsYmFja3MgZnJvbSB0aGUgYWJvdmUgcXVldWUgYXMgdGhleSBhY3F1aXJlIGFsbCBuZWVkZWQgZGF0YS5cbiAgICBfLmVhY2goYmluc1RvRmV0Y2gsIGZ1bmN0aW9uKGJpbkluZGV4KSB7XG4gICAgICBfZmV0Y2hCaW4oc2VsZiwgYmluSW5kZXgsIGZ1bmN0aW9uKCkgeyBfZmlyZUNhbGxiYWNrcyhzZWxmKTsgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDYWxjdWxhdGVzIHdoaWNoIGJpbnMgb3ZlcmxhcCB3aXRoIGFuIGludGVydmFsIGdpdmVuIGJ5IGBzdGFydGAgYW5kIGBlbmRgLlxuLy8gYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG5mdW5jdGlvbiBfYmluT3ZlcmxhcChyZW1vdGVUcmssIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFyZW1vdGVUcmsuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgY2FsY3VsYXRlIGJpbiBvdmVybGFwIGJlZm9yZSBzZXR1cEJpbnMgaXMgY2FsbGVkLicpOyB9XG4gIC8vIEludGVybmFsbHksIGZvciBhc3NpZ25pbmcgY29vcmRpbmF0ZXMgdG8gYmlucywgd2UgdXNlIDAtYmFzZWQgY29vcmRpbmF0ZXMgZm9yIGVhc2llciBjYWxjdWxhdGlvbnMuXG4gIHZhciBzdGFydEJpbiA9IE1hdGguZmxvb3IoKHN0YXJ0IC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KSxcbiAgICBlbmRCaW4gPSBNYXRoLmZsb29yKChlbmQgLSAxKSAvIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICByZXR1cm4gXy5yYW5nZShzdGFydEJpbiwgZW5kQmluICsgMSk7XG59XG5cbi8vIFJ1bnMgdGhlIGZldGNoZXIgZnVuY3Rpb24gb24gYSBnaXZlbiBiaW4uXG4vLyBUaGUgZmV0Y2hlciBmdW5jdGlvbiBpcyBvYmxpZ2F0ZWQgdG8gcnVuIGEgY2FsbGJhY2sgZnVuY3Rpb24gYHN0b3JlSW50ZXJ2YWxzYCwgXG4vLyAgICBwYXNzZWQgYXMgaXRzIHRoaXJkIGFyZ3VtZW50LCBvbiBhIHNldCBvZiBpbnRlcnZhbHMgdGhhdCB3aWxsIGJlIGluc2VydGVkIGludG8gdGhlIFxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIEludGVydmFsVHJlZS5cbi8vIFRoZSBgc3RvcmVJbnRlcnZhbHNgIGZ1bmN0aW9uIG1heSBhY2NlcHQgYSBzZWNvbmQgYXJndW1lbnQgY2FsbGVkIGBjYWNoZUluZGV4YCwgaW4gY2FzZVxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIGlzIGFjdHVhbGx5IGEgY29udGFpbmVyIGZvciBtdWx0aXBsZSBJbnRlcnZhbFRyZWVzLCBpbmRpY2F0aW5nIHdoaWNoIFxuLy8gICAgb25lIHRvIHN0b3JlIGl0IGluLlxuLy8gV2UgdGhlbiBjYWxsIHRoZSBgY2FsbGJhY2tgIGdpdmVuIGhlcmUgYWZ0ZXIgdGhhdCBpcyBjb21wbGV0ZS5cbmZ1bmN0aW9uIF9mZXRjaEJpbihyZW1vdGVUcmssIGJpbkluZGV4LCBjYWxsYmFjaykge1xuICB2YXIgc3RhcnQgPSBiaW5JbmRleCAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxLFxuICAgIGVuZCA9IChiaW5JbmRleCArIDEpICogcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyArIDE7XG4gIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FESU5HO1xuICByZW1vdGVUcmsuZmV0Y2hlcihzdGFydCwgZW5kLCBmdW5jdGlvbiBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpIHtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgaWYgKCFpbnRlcnZhbCkgeyByZXR1cm47IH1cbiAgICAgIHJlbW90ZVRyay5jYWNoZS5hZGRJZk5ldyhpbnRlcnZhbCwgaW50ZXJ2YWwuaWQpO1xuICAgIH0pO1xuICAgIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FERUQ7XG4gICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3Mgd2hlcmUgYWxsIHRoZSByZXF1aXJlZCBkYXRhIGlzIHJlYWR5XG4vLyBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfZmlyZUNhbGxiYWNrcyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjayxcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoYWZ0ZXJMb2FkLmV4dHJhQXJncykgPyBbXSA6IGFmdGVyTG9hZC5leHRyYUFyZ3MsXG4gICAgICBiaW5zLCBzdGlsbExvYWRpbmdCaW5zO1xuICAgICAgICBcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgXG4gICAgYmlucyA9IF9iaW5PdmVybGFwKHJlbW90ZVRyaywgYWZ0ZXJMb2FkLnN0YXJ0LCBhZnRlckxvYWQuZW5kKTtcbiAgICBzdGlsbExvYWRpbmdCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gcmVtb3RlVHJrLmJpbnNMb2FkZWRbaV0gIT09IEJJTl9MT0FERUQ7IH0pLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFzdGlsbExvYWRpbmdCaW5zKSB7XG4gICAgICBjYWxsYmFjayhyZW1vdGVUcmsuY2FjaGUuc2VhcmNoLmFwcGx5KHJlbW90ZVRyay5jYWNoZSwgW2FmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG4vLyBSdW5zIHRocm91Z2ggYWxsIHNhdmVkIGNhbGxiYWNrcyBhbmQgZmlyZXMgYW55IGNhbGxiYWNrcyBmb3Igd2hpY2ggd2Ugd29uJ3QgbG9hZCBkYXRhIHNpbmNlIHRoZSBhbW91bnRcbi8vIHJlcXVlc3RlZCBpcyB0b28gbGFyZ2UuIENhbGxiYWNrcyB0aGF0IGFyZSBmaXJlZCBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBxdWV1ZS5cbmZ1bmN0aW9uIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjaztcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5cbmV4cG9ydHMuUmVtb3RlVHJhY2sgPSBSZW1vdGVUcmFjaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9Tb3J0ZWRMaXN0XG4gKlxuICogU29ydGVkTGlzdCA6IGNvbnN0cnVjdG9yXG4gKiBcbiAqIEBwYXJhbSBhcnIgOiBBcnJheSBvciBudWxsIDogYW4gYXJyYXkgdG8gc2V0XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgOiBvYmplY3QgIG9yIG51bGxcbiAqICAgICAgICAgKGZ1bmN0aW9uKSBmaWx0ZXIgIDogZmlsdGVyIGZ1bmN0aW9uIGNhbGxlZCBiZWZvcmUgaW5zZXJ0aW5nIGRhdGEuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgcmVjZWl2ZXMgYSB2YWx1ZSBhbmQgcmV0dXJucyB0cnVlIGlmIHRoZSB2YWx1ZSBpcyB2YWxpZC5cbiAqXG4gKiAgICAgICAgIChmdW5jdGlvbikgY29tcGFyZSA6IGZ1bmN0aW9uIHRvIGNvbXBhcmUgdHdvIHZhbHVlcywgXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdoaWNoIGlzIHVzZWQgZm9yIHNvcnRpbmcgb3JkZXIuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBzYW1lIHNpZ25hdHVyZSBhcyBBcnJheS5wcm90b3R5cGUuc29ydChmbikuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICogICAgICAgICAoc3RyaW5nKSAgIGNvbXBhcmUgOiBpZiB5b3UnZCBsaWtlIHRvIHNldCBhIGNvbW1vbiBjb21wYXJpc29uIGZ1bmN0aW9uLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5b3UgY2FuIHNwZWNpZnkgaXQgYnkgc3RyaW5nOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIm51bWJlclwiIDogY29tcGFyZXMgbnVtYmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwic3RyaW5nXCIgOiBjb21wYXJlcyBzdHJpbmdcbiAqL1xuZnVuY3Rpb24gU29ydGVkTGlzdCgpIHtcbiAgdmFyIGFyciAgICAgPSBudWxsLFxuICAgICAgb3B0aW9ucyA9IHt9LFxuICAgICAgYXJncyAgICA9IGFyZ3VtZW50cztcblxuICBbXCIwXCIsXCIxXCJdLmZvckVhY2goZnVuY3Rpb24obikge1xuICAgIHZhciB2YWwgPSBhcmdzW25dO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgIGFyciA9IHZhbDtcbiAgICB9XG4gICAgZWxzZSBpZiAodmFsICYmIHR5cGVvZiB2YWwgPT0gXCJvYmplY3RcIikge1xuICAgICAgb3B0aW9ucyA9IHZhbDtcbiAgICB9XG4gIH0pO1xuICB0aGlzLmFyciA9IFtdO1xuXG4gIFtcImZpbHRlclwiLCBcImNvbXBhcmVcIl0uZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zW2tdID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpc1trXSA9IG9wdGlvbnNba107XG4gICAgfVxuICAgIGVsc2UgaWYgKG9wdGlvbnNba10gJiYgU29ydGVkTGlzdFtrXVtvcHRpb25zW2tdXSkge1xuICAgICAgdGhpc1trXSA9IFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV07XG4gICAgfVxuICB9LCB0aGlzKTtcbiAgaWYgKGFycikgdGhpcy5tYXNzSW5zZXJ0KGFycik7XG59O1xuXG4vLyBCaW5hcnkgc2VhcmNoIGZvciB0aGUgaW5kZXggb2YgdGhlIGl0ZW0gZXF1YWwgdG8gYHZhbGAsIG9yIGlmIG5vIHN1Y2ggaXRlbSBleGlzdHMsIHRoZSBuZXh0IGxvd2VyIGl0ZW1cbi8vIFRoaXMgY2FuIGJlIC0xIGlmIGB2YWxgIGlzIGxvd2VyIHRoYW4gdGhlIGxvd2VzdCBpdGVtIGluIHRoZSBTb3J0ZWRMaXN0XG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5ic2VhcmNoID0gZnVuY3Rpb24odmFsKSB7XG4gIHZhciBtcG9zLFxuICAgICAgc3BvcyA9IDAsXG4gICAgICBlcG9zID0gdGhpcy5hcnIubGVuZ3RoO1xuICB3aGlsZSAoZXBvcyAtIHNwb3MgPiAxKSB7XG4gICAgbXBvcyA9IE1hdGguZmxvb3IoKHNwb3MgKyBlcG9zKS8yKTtcbiAgICBtdmFsID0gdGhpcy5hcnJbbXBvc107XG4gICAgc3dpdGNoICh0aGlzLmNvbXBhcmUodmFsLCBtdmFsKSkge1xuICAgIGNhc2UgMSAgOlxuICAgIGRlZmF1bHQgOlxuICAgICAgc3BvcyA9IG1wb3M7XG4gICAgICBicmVhaztcbiAgICBjYXNlIC0xIDpcbiAgICAgIGVwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAwICA6XG4gICAgICByZXR1cm4gbXBvcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh0aGlzLmFyclswXSA9PSBudWxsIHx8IHNwb3MgPT0gMCAmJiB0aGlzLmFyclswXSAhPSBudWxsICYmIHRoaXMuY29tcGFyZSh0aGlzLmFyclswXSwgdmFsKSA9PSAxKSA/IC0xIDogc3Bvcztcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gdGhpcy5hcnJbcG9zXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlKCk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnIuc2xpY2UuYXBwbHkodGhpcy5hcnIsIGFyZ3VtZW50cyk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLmxlbmd0aDtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmhlYWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyWzBdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gKHRoaXMuYXJyLmxlbmd0aCA9PSAwKSA/IG51bGwgOiB0aGlzLmFyclt0aGlzLmFyci5sZW5ndGggLTFdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc0luc2VydCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIC8vIFRoaXMgbG9vcCBhdm9pZHMgY2FsbCBzdGFjayBvdmVyZmxvdyBiZWNhdXNlIG9mIHRvbyBtYW55IGFyZ3VtZW50c1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSA0MDk2KSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkodGhpcy5hcnIsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGl0ZW1zLCBpLCBpICsgNDA5NikpO1xuICB9XG4gIHRoaXMuYXJyLnNvcnQodGhpcy5jb21wYXJlKTtcbn1cblxuU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oKSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMTAwKSB7XG4gICAgLy8gLmJzZWFyY2ggKyAuc3BsaWNlIGlzIHRvbyBleHBlbnNpdmUgdG8gcmVwZWF0IGZvciBzbyBtYW55IGVsZW1lbnRzLlxuICAgIC8vIExldCdzIGp1c3QgYXBwZW5kIHRoZW0gYWxsIHRvIHRoaXMuYXJyIGFuZCByZXNvcnQuXG4gICAgdGhpcy5tYXNzSW5zZXJ0KGFyZ3VtZW50cyk7XG4gIH0gZWxzZSB7XG4gICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uKHZhbCkge1xuICAgICAgdmFyIHBvcyA9IHRoaXMuYnNlYXJjaCh2YWwpO1xuICAgICAgaWYgKHRoaXMuZmlsdGVyKHZhbCwgcG9zKSkge1xuICAgICAgICB0aGlzLmFyci5zcGxpY2UocG9zKzEsIDAsIHZhbCk7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmZpbHRlciA9IGZ1bmN0aW9uKHZhbCwgcG9zKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuYWRkID0gU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXSA9IGZ1bmN0aW9uKHBvcykge1xuICB0aGlzLmFyci5zcGxpY2UocG9zLCAxKTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IFNvcnRlZExpc3QucHJvdG90eXBlW1wiZGVsZXRlXCJdO1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5tYXNzUmVtb3ZlID0gZnVuY3Rpb24oc3RhcnRQb3MsIGNvdW50KSB7XG4gIHRoaXMuYXJyLnNwbGljZShzdGFydFBvcywgY291bnQpO1xufTtcblxuLyoqXG4gKiBkZWZhdWx0IGNvbXBhcmUgZnVuY3Rpb25zIFxuICoqL1xuU29ydGVkTGlzdC5jb21wYXJlID0ge1xuICBcIm51bWJlclwiOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIGMgPSBhIC0gYjtcbiAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gIH0sXG5cbiAgXCJzdHJpbmdcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiAoYSA+IGIpID8gMSA6IChhID09IGIpICA/IDAgOiAtMTtcbiAgfVxufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuY29tcGFyZSA9IFNvcnRlZExpc3QuY29tcGFyZVtcIm51bWJlclwiXTtcblxuZXhwb3J0cy5Tb3J0ZWRMaXN0ID0gU29ydGVkTGlzdDtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIi8vIFBhcnNlIGEgdHJhY2sgZGVjbGFyYXRpb24gbGluZSwgd2hpY2ggaXMgaW4gdGhlIGZvcm1hdCBvZjpcbi8vIHRyYWNrIG5hbWU9XCJibGFoXCIgb3B0bmFtZTE9XCJ2YWx1ZTFcIiBvcHRuYW1lMj1cInZhbHVlMlwiIC4uLlxuLy8gaW50byBhIGhhc2ggb2Ygb3B0aW9uc1xubW9kdWxlLmV4cG9ydHMucGFyc2VEZWNsYXJhdGlvbkxpbmUgPSBmdW5jdGlvbihsaW5lLCBzdGFydCkge1xuICB2YXIgb3B0cyA9IHt9LCBvcHRuYW1lID0gJycsIHZhbHVlID0gJycsIHN0YXRlID0gJ29wdG5hbWUnO1xuICBmdW5jdGlvbiBwdXNoVmFsdWUocXVvdGluZykge1xuICAgIHN0YXRlID0gJ29wdG5hbWUnO1xuICAgIG9wdHNbb3B0bmFtZS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyldID0gdmFsdWU7XG4gICAgb3B0bmFtZSA9IHZhbHVlID0gJyc7XG4gIH1cbiAgZm9yIChpID0gbGluZS5tYXRjaChzdGFydClbMF0ubGVuZ3RoOyBpIDwgbGluZS5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBsaW5lW2ldO1xuICAgIGlmIChzdGF0ZSA9PSAnb3B0bmFtZScpIHtcbiAgICAgIGlmIChjID09ICc9JykgeyBzdGF0ZSA9ICdzdGFydHZhbHVlJzsgfVxuICAgICAgZWxzZSB7IG9wdG5hbWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3N0YXJ0dmFsdWUnKSB7XG4gICAgICBpZiAoLyd8XCIvLnRlc3QoYykpIHsgc3RhdGUgPSBjOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgc3RhdGUgPSAndmFsdWUnOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7XG4gICAgICBpZiAoL1xccy8udGVzdChjKSkgeyBwdXNoVmFsdWUoKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKC8nfFwiLy50ZXN0KHN0YXRlKSkge1xuICAgICAgaWYgKGMgPT0gc3RhdGUpIHsgcHVzaFZhbHVlKHN0YXRlKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9XG4gIH1cbiAgaWYgKHN0YXRlID09ICd2YWx1ZScpIHsgcHVzaFZhbHVlKCk7IH1cbiAgaWYgKHN0YXRlICE9ICdvcHRuYW1lJykgeyByZXR1cm4gZmFsc2U7IH1cbiAgcmV0dXJuIG9wdHM7XG59XG5cbi8vIENvbnN0cnVjdHMgYSBtYXBwaW5nIGZ1bmN0aW9uIHRoYXQgY29udmVydHMgYnAgaW50ZXJ2YWxzIGludG8gcGl4ZWwgaW50ZXJ2YWxzLCB3aXRoIG9wdGlvbmFsIGNhbGN1bGF0aW9ucyBmb3IgdGV4dCB0b29cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCwgd2l0aFRleHQsIG5hbWVGdW5jLCBzdGFydGtleSwgZW5ka2V5KSB7XG4gIGlmICghXy5pc0Z1bmN0aW9uKG5hbWVGdW5jKSkgeyBuYW1lRnVuYyA9IGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQubmFtZSB8fCAnJzsgfTsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChzdGFydGtleSkpIHsgc3RhcnRrZXkgPSAnc3RhcnQnOyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKGVuZGtleSkpIHsgZW5ka2V5ID0gJ2VuZCc7IH1cbiAgcmV0dXJuIGZ1bmN0aW9uKGQpIHtcbiAgICB2YXIgcEludCA9IHtcbiAgICAgIHg6IE1hdGgucm91bmQoKGRbc3RhcnRrZXldIC0gc3RhcnQpIC8gYnBwcCksXG4gICAgICB3OiBNYXRoLnJvdW5kKChkW2VuZGtleV0gLSBkW3N0YXJ0a2V5XSkgLyBicHBwKSArIDEsXG4gICAgICB0OiAwLCAgICAgICAgICAvLyBjYWxjdWxhdGVkIHdpZHRoIG9mIHRleHRcbiAgICAgIG9QcmV2OiBmYWxzZSwgIC8vIG92ZXJmbG93cyBpbnRvIHByZXZpb3VzIHRpbGU/XG4gICAgICBvTmV4dDogZmFsc2UgICAvLyBvdmVyZmxvd3MgaW50byBuZXh0IHRpbGU/XG4gICAgfTtcbiAgICBwSW50LnR4ID0gcEludC54O1xuICAgIHBJbnQudHcgPSBwSW50Lnc7XG4gICAgaWYgKHBJbnQueCA8IDApIHsgcEludC53ICs9IHBJbnQueDsgcEludC54ID0gMDsgcEludC5vUHJldiA9IHRydWU7IH1cbiAgICBlbHNlIGlmICh3aXRoVGV4dCkgeyBcbiAgICAgIHBJbnQudCA9IE1hdGgubWluKG5hbWVGdW5jKGQpLmxlbmd0aCAqIDEwICsgMiwgcEludC54KTtcbiAgICAgIHBJbnQudHggLT0gcEludC50O1xuICAgICAgcEludC50dyArPSBwSW50LnQ7ICBcbiAgICB9XG4gICAgaWYgKHBJbnQueCArIHBJbnQudyA+IHdpZHRoKSB7IHBJbnQudyA9IHdpZHRoIC0gcEludC54OyBwSW50Lm9OZXh0ID0gdHJ1ZTsgfVxuICAgIHJldHVybiBwSW50O1xuICB9O1xufTtcblxuLy8gRm9yIHR3byBnaXZlbiBvYmplY3RzIG9mIHRoZSBmb3JtIHt4OiAxLCB3OiAyfSAocGl4ZWwgaW50ZXJ2YWxzKSwgZGVzY3JpYmUgdGhlIG92ZXJsYXAuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlcmUgaXMgbm8gb3ZlcmxhcC5cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsT3ZlcmxhcCA9IGZ1bmN0aW9uKHBJbnQxLCBwSW50Mikge1xuICB2YXIgb3ZlcmxhcCA9IHt9LFxuICAgIHRtcDtcbiAgaWYgKHBJbnQxLnggPiBwSW50Mi54KSB7IHRtcCA9IHBJbnQyOyBwSW50MiA9IHBJbnQxOyBwSW50MSA9IHRtcDsgfSAgICAgICAvLyBzd2FwIHNvIHRoYXQgcEludDEgaXMgYWx3YXlzIGxvd2VyXG4gIGlmICghcEludDEudyB8fCAhcEludDIudyB8fCBwSW50MS54ICsgcEludDEudyA8IHBJbnQyLngpIHsgcmV0dXJuIG51bGw7IH0gLy8gZGV0ZWN0IG5vLW92ZXJsYXAgY29uZGl0aW9uc1xuICBvdmVybGFwLnggPSBwSW50Mi54O1xuICBvdmVybGFwLncgPSBNYXRoLm1pbihwSW50MS53IC0gcEludDIueCArIHBJbnQxLngsIHBJbnQyLncpO1xuICByZXR1cm4gb3ZlcmxhcDtcbn07XG5cbi8vIENvbW1vbiBmdW5jdGlvbnMgZm9yIHN1bW1hcml6aW5nIGRhdGEgaW4gYmlucyB3aGlsZSBwbG90dGluZyB3aWdnbGUgdHJhY2tzXG5tb2R1bGUuZXhwb3J0cy53aWdCaW5GdW5jdGlvbnMgPSB7XG4gIG1pbmltdW06IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gYmluLmxlbmd0aCA/IE1hdGgubWluLmFwcGx5KE1hdGgsIGJpbikgOiAwOyB9LFxuICBtZWFuOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIF8ucmVkdWNlKGJpbiwgZnVuY3Rpb24oYSxiKSB7IHJldHVybiBhICsgYjsgfSwgMCkgLyBiaW4ubGVuZ3RoOyB9LFxuICBtYXhpbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1heC5hcHBseShNYXRoLCBiaW4pIDogMDsgfVxufTtcblxuLy8gRmFzdGVyIHRoYW4gTWF0aC5mbG9vciAoaHR0cDovL3dlYmRvb2QuY29tLz9wPTIxOSlcbm1vZHVsZS5leHBvcnRzLmZsb29ySGFjayA9IGZ1bmN0aW9uKG51bSkgeyByZXR1cm4gKG51bSA8PCAwKSAtIChudW0gPCAwID8gMSA6IDApOyB9XG5cbi8vIE90aGVyIHRpbnkgZnVuY3Rpb25zIHRoYXQgd2UgbmVlZCBmb3Igb2RkcyBhbmQgZW5kcy4uLlxubW9kdWxlLmV4cG9ydHMuc3RyaXAgPSBmdW5jdGlvbihzdHIpIHsgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7IH1cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIHBhcnNlSW50KHZhbCwgMTApOyB9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gdmNmVGFiaXggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC92Y2YuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy52Y2Z0YWJpeFxudmFyIFZjZlRhYml4Rm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiA1MDAsIHBhY2s6IDEwMH0sXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDEwMDAwMCxcbiAgICBjaHJvbW9zb21lczogJydcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIHZjZlRhYml4IHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgLy8gVE9ETzogU2V0IG1heEZldGNoV2luZG93IHVzaW5nIHNvbWUgaGV1cmlzdGljIGJhc2VkIG9uIGhvdyBtYW55IGl0ZW1zIGFyZSBpbiB0aGUgdGFiaXggaW5kZXhcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICByYW5nZSA9IHRoaXMuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZVRvSW50ZXJ2YWwobGluZSkge1xuICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoJ1xcdCcpLCBkYXRhID0ge30sIGluZm8gPSB7fTtcbiAgICAgIGlmIChmaWVsZHNbN10pIHtcbiAgICAgICAgXy5lYWNoKGZpZWxkc1s3XS5zcGxpdCgnOycpLCBmdW5jdGlvbihsKSB7IGwgPSBsLnNwbGl0KCc9Jyk7IGlmIChsLmxlbmd0aCA+IDEpIHsgaW5mb1tsWzBdXSA9IGxbMV07IH0gfSk7XG4gICAgICB9XG4gICAgICBkYXRhLnN0YXJ0ID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZmllbGRzWzBdXSArIHBhcnNlSW50MTAoZmllbGRzWzFdKTtcbiAgICAgIGRhdGEuaWQgPSBmaWVsZHNbMl09PScuJyA/ICd2Y2YtJyArIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMDAwMCkgOiBmaWVsZHNbMl07XG4gICAgICBkYXRhLmVuZCA9IGRhdGEuc3RhcnQgKyAxO1xuICAgICAgZGF0YS5yZWYgPSBmaWVsZHNbM107XG4gICAgICBkYXRhLmFsdCA9IGZpZWxkc1s0XTtcbiAgICAgIGRhdGEucXVhbCA9IHBhcnNlRmxvYXQoZmllbGRzWzVdKTtcbiAgICAgIGRhdGEuaW5mbyA9IGluZm87XG4gICAgICByZXR1cm4ge2RhdGE6IGRhdGF9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBuYW1lRnVuYyhmaWVsZHMpIHtcbiAgICAgIHZhciByZWYgPSBmaWVsZHMucmVmIHx8ICcnLFxuICAgICAgICBhbHQgPSBmaWVsZHMuYWx0IHx8ICcnO1xuICAgICAgcmV0dXJuIChyZWYubGVuZ3RoID4gYWx0Lmxlbmd0aCA/IHJlZiA6IGFsdCkgfHwgJyc7XG4gICAgfVxuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLFxuICAgICAgICBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+IDg7IH0pLFxuICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snLCBuYW1lRnVuYyk7XG4gICAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIGRyYXdTcGVjLnB1c2goY2FsY1BpeEludGVydmFsKGxpbmVUb0ludGVydmFsKGxpbmUpLmRhdGEpKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dChfLm1hcChsaW5lcywgbGluZVRvSW50ZXJ2YWwpLCB3aWR0aCwgY2FsY1BpeEludGVydmFsKX07XG4gICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtdWNoIGRhdGEsIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIC8vIFRPRE86IGNhY2hlIHJlc3VsdHMgc28gd2UgYXJlbid0IHJlZmV0Y2hpbmcgdGhlIHNhbWUgcmVnaW9ucyBvdmVyIGFuZCBvdmVyIGFnYWluLlxuICAgIGlmICgoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAkLmFqYXgodGhpcy5hamF4RGlyKCkgKyAndGFiaXgucGhwJywge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gdGhpcy5vcHRzLnVybCA/IHRoaXMub3B0cy51cmwgOiAnamF2YXNjcmlwdDp2b2lkKFwiJyt0aGlzLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDI3IDogNixcbiAgICAgIGNvbG9ycyA9IHthOicyNTUsMCwwJywgdDonMjU1LDAsMjU1JywgYzonMCwwLDI1NScsIGc6JzAsMjU1LDAnfSxcbiAgICAgIGRyYXdMaW1pdCA9IHRoaXMub3B0cy5kcmF3TGltaXQgJiYgdGhpcy5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycpIHsgYXJlYXMgPSB0aGlzLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigwLDAsMClcIjtcbiAgICB0aGlzLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBpZiAoKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgfSBlbHNlIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDE1O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QocEludC54LCAxLCBwSW50LncsIDEzKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgdmFyIGFsdENvbG9yLCByZWZDb2xvcjtcbiAgICAgICAgICAgIGlmIChhcmVhcykge1xuICAgICAgICAgICAgICByZWZDb2xvciA9IGNvbG9yc1tkYXRhLmQucmVmLnRvTG93ZXJDYXNlKCldIHx8ICcyNTUsMCwwJztcbiAgICAgICAgICAgICAgYWx0Q29sb3IgPSBjb2xvcnNbZGF0YS5kLmFsdC50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIiArIGFsdENvbG9yICsgXCIpXCI7IFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gMSk7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgYXJlYXMucHVzaChbXG4gICAgICAgICAgICAgICAgZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgKGkgKyAxKSAqIGxpbmVIZWlnaHQsIC8veDEsIHgyLCB5MSwgeTJcbiAgICAgICAgICAgICAgICBkYXRhLmQucmVmICsgJyA+ICcgKyBkYXRhLmQuYWx0LCAvLyB0aXRsZVxuICAgICAgICAgICAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgZGF0YS5kLmlkKSwgLy8gaHJlZlxuICAgICAgICAgICAgICAgIGRhdGEucEludC5vUHJldiwgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgICAgICAgICAgICBhbHRDb2xvciwgLy8gbGFiZWwgY29sb3JcbiAgICAgICAgICAgICAgICAnPHNwYW4gc3R5bGU9XCJjb2xvcjogcmdiKCcgKyByZWZDb2xvciArICcpXCI+JyArIGRhdGEuZC5yZWYgKyAnPC9zcGFuPjxici8+JyArIGRhdGEuZC5hbHQsIC8vIGxhYmVsXG4gICAgICAgICAgICAgICAgZGF0YS5kLmluZm9cbiAgICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZjZlRhYml4Rm9ybWF0O1xuXG4iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gV0lHIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvd2lnZ2xlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vdXRpbHMvU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLndpZ2dsZV8wXG52YXIgV2lnZ2xlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgX2JpbkZ1bmN0aW9ucyA9IHRoaXMudHlwZSgpLl9iaW5GdW5jdGlvbnM7XG4gICAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcikpIHsgby5hbHRDb2xvciA9ICcnOyB9XG4gICAgby52aWV3TGltaXRzID0gXy5tYXAoby52aWV3TGltaXRzLnNwbGl0KCc6JyksIHBhcnNlRmxvYXQpO1xuICAgIG8ubWF4SGVpZ2h0UGl4ZWxzID0gXy5tYXAoby5tYXhIZWlnaHRQaXhlbHMuc3BsaXQoJzonKSwgcGFyc2VJbnQxMCk7XG4gICAgby55TGluZU9uT2ZmID0gdGhpcy5pc09uKG8ueUxpbmVPbk9mZik7XG4gICAgby55TGluZU1hcmsgPSBwYXJzZUZsb2F0KG8ueUxpbmVNYXJrKTtcbiAgICBvLmF1dG9TY2FsZSA9IHRoaXMuaXNPbihvLmF1dG9TY2FsZSk7XG4gICAgaWYgKF9iaW5GdW5jdGlvbnMgJiYgIV9iaW5GdW5jdGlvbnNbby53aW5kb3dpbmdGdW5jdGlvbl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImludmFsaWQgd2luZG93aW5nRnVuY3Rpb24gYXQgbGluZSBcIiArIG8ubGluZU51bSk7IFxuICAgIH1cbiAgICBpZiAoXy5pc05hTihvLnlMaW5lTWFyaykpIHsgby55TGluZU1hcmsgPSAwLjA7IH1cbiAgfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICBzZWxmLmRyYXdSYW5nZSA9IG8uYXV0b1NjYWxlIHx8IG8udmlld0xpbWl0cy5sZW5ndGggPCAyID8gc2VsZi5yYW5nZSA6IG8udmlld0xpbWl0cztcbiAgICBfLmVhY2goe21heDogMCwgbWluOiAyLCBzdGFydDogMX0sIGZ1bmN0aW9uKHYsIGspIHsgc2VsZi5oZWlnaHRzW2tdID0gby5tYXhIZWlnaHRQaXhlbHNbdl07IH0pO1xuICAgIGlmICghby5hbHRDb2xvcikge1xuICAgICAgdmFyIGhzbCA9IHRoaXMucmdiVG9Ic2wuYXBwbHkodGhpcywgby5jb2xvci5zcGxpdCgvLFxccyovZykpO1xuICAgICAgaHNsWzBdID0gaHNsWzBdICsgMC4wMiAlIDE7XG4gICAgICBoc2xbMV0gPSBoc2xbMV0gKiAwLjc7XG4gICAgICBoc2xbMl0gPSAxIC0gKDEgLSBoc2xbMl0pICogMC43O1xuICAgICAgc2VsZi5hbHRDb2xvciA9IF8ubWFwKHRoaXMuaHNsVG9SZ2IuYXBwbHkodGhpcywgaHNsKSwgcGFyc2VJbnQxMCkuam9pbignLCcpO1xuICAgIH1cbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgdmFsLCBzdGFydDtcbiAgICAgIFxuICAgICAgbSA9IGxpbmUubWF0Y2goL14odmFyaWFibGV8Zml4ZWQpU3RlcFxccysvaSk7XG4gICAgICBpZiAobSkge1xuICAgICAgICBtb2RlID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBtb2RlT3B0cyA9IHBhcnNlRGVjbGFyYXRpb25MaW5lKGxpbmUsIC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgICBtb2RlT3B0cy5zdGFydCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RhcnQpO1xuICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnICYmIChfLmlzTmFOKG1vZGVPcHRzLnN0YXJ0KSB8fCAhbW9kZU9wdHMuc3RhcnQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RhcnQgcGFyYW1ldGVyXCIpOyBcbiAgICAgICAgfVxuICAgICAgICBtb2RlT3B0cy5zdGVwID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zdGVwKTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGVwKSB8fCAhbW9kZU9wdHMuc3RlcCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmaXhlZFN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZSBub24temVybyBzdGVwIHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3BhbiA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3BhbikgfHwgMTtcbiAgICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbbW9kZU9wdHMuY2hyb21dO1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgICAgc2VsZi53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghbW9kZSkgeyBcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXaWdnbGUgZm9ybWF0IGF0IFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiBoYXMgbm8gcHJlY2VkaW5nIG1vZGUgZGVjbGFyYXRpb25cIik7IFxuICAgICAgICB9IGVsc2UgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIC8vIGludmFsaWQgY2hyb21vc29tZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcpIHtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgbW9kZU9wdHMuc3RhcnQsIGVuZDogY2hyUG9zICsgbW9kZU9wdHMuc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgICAgbW9kZU9wdHMuc3RhcnQgKz0gbW9kZU9wdHMuc3RlcDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGluZSA9IGxpbmUuc3BsaXQoL1xccysvKTtcbiAgICAgICAgICAgIGlmIChsaW5lLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidmFyaWFibGVTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmVzIHR3byB2YWx1ZXMgcGVyIGxpbmVcIik7IFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGxpbmVbMF0pO1xuICAgICAgICAgICAgdmFsID0gcGFyc2VGbG9hdChsaW5lWzFdKTtcbiAgICAgICAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBzdGFydCwgZW5kOiBjaHJQb3MgKyBzdGFydCArIG1vZGVPcHRzLnNwYW4sIHZhbDogdmFsfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHNlbGYudHlwZSgpLmZpbmlzaFBhcnNlLmNhbGwoc2VsZiwgZGF0YSk7XG4gIH0sXG4gIFxuICBmaW5pc2hQYXJzZTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dO1xuICAgIGlmIChkYXRhLmFsbC5sZW5ndGggPiAwKSB7XG4gICAgICBzZWxmLnJhbmdlWzBdID0gXy5taW4oZGF0YS5hbGwsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudmFsOyB9KS52YWw7XG4gICAgICBzZWxmLnJhbmdlWzFdID0gXy5tYXgoZGF0YS5hbGwsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudmFsOyB9KS52YWw7XG4gICAgfVxuICAgIGRhdGEuYWxsID0gbmV3IFNvcnRlZExpc3QoZGF0YS5hbGwsIHtcbiAgICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgaWYgKGEgPT09IG51bGwpIHJldHVybiAtMTtcbiAgICAgICAgaWYgKGIgPT09IG51bGwpIHJldHVybiAgMTtcbiAgICAgICAgdmFyIGMgPSBhLnN0YXJ0IC0gYi5zdGFydDtcbiAgICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT09IDApICA/IDAgOiAtMTtcbiAgICAgIH1cbiAgICB9KTtcbiAgXG4gICAgLy8gUHJlLW9wdGltaXplIGRhdGEgZm9yIGhpZ2ggYnBwcHMgYnkgZG93bnNhbXBsaW5nXG4gICAgXy5lYWNoKHNlbGYuYnJvd3Nlck9wdHMuYnBwcHMsIGZ1bmN0aW9uKGJwcHApIHtcbiAgICAgIGlmIChzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyBicHBwID4gMTAwMDAwMCkgeyByZXR1cm47IH1cbiAgICAgIHZhciBwaXhMZW4gPSBNYXRoLmNlaWwoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCksXG4gICAgICAgIGRvd25zYW1wbGVkRGF0YSA9IChkYXRhW2JwcHBdID0gKGdsb2JhbC5GbG9hdDMyQXJyYXkgPyBuZXcgRmxvYXQzMkFycmF5KHBpeExlbikgOiBuZXcgQXJyYXkocGl4TGVuKSkpLFxuICAgICAgICBqID0gMCxcbiAgICAgICAgY3VyciA9IGRhdGEuYWxsLmdldCgwKSxcbiAgICAgICAgYmluLCBuZXh0O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwaXhMZW47IGkrKykge1xuICAgICAgICBiaW4gPSBjdXJyICYmIChjdXJyLnN0YXJ0IDw9IGkgKiBicHBwICYmIGN1cnIuZW5kID4gaSAqIGJwcHApID8gW2N1cnIudmFsXSA6IFtdO1xuICAgICAgICB3aGlsZSAoKG5leHQgPSBkYXRhLmFsbC5nZXQoaiArIDEpKSAmJiBuZXh0LnN0YXJ0IDwgKGkgKyAxKSAqIGJwcHAgJiYgbmV4dC5lbmQgPiBpICogYnBwcCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRvd25zYW1wbGVkRGF0YVtpXSA9IGJpbkZ1bmN0aW9uKGJpbik7XG4gICAgICB9XG4gICAgICBkYXRhLl9iaW5GdW5jdGlvbiA9IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbjtcbiAgICB9KTtcbiAgICBzZWxmLmRhdGEgPSBkYXRhO1xuICAgIHNlbGYuc3RyZXRjaEhlaWdodCA9IHRydWU7XG4gICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgICByZXR1cm4gdHJ1ZTsgLy8gc3VjY2VzcyFcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24ocHJlY2FsYykge1xuICAgIHZhciB2U2NhbGUgPSAodGhpcy5kcmF3UmFuZ2VbMV0gLSB0aGlzLmRyYXdSYW5nZVswXSkgLyBwcmVjYWxjLmhlaWdodCxcbiAgICAgIGRyYXdTcGVjID0ge1xuICAgICAgICBiYXJzOiBbXSxcbiAgICAgICAgdlNjYWxlOiB2U2NhbGUsXG4gICAgICAgIHlMaW5lOiB0aGlzLmlzT24odGhpcy5vcHRzLnlMaW5lT25PZmYpID8gTWF0aC5yb3VuZCgodGhpcy5vcHRzLnlMaW5lTWFyayAtIHRoaXMuZHJhd1JhbmdlWzBdKSAvIHZTY2FsZSkgOiBudWxsLCBcbiAgICAgICAgemVyb0xpbmU6IC10aGlzLmRyYXdSYW5nZVswXSAvIHZTY2FsZVxuICAgICAgfTtcbiAgICByZXR1cm4gZHJhd1NwZWM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRyYXdTcGVjID0gc2VsZi50eXBlKCkuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXSxcbiAgICAgIGRvd25zYW1wbGVkRGF0YTtcbiAgICBpZiAoc2VsZi5kYXRhLl9iaW5GdW5jdGlvbiA9PSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb24gJiYgKGRvd25zYW1wbGVkRGF0YSA9IHNlbGYuZGF0YVticHBwXSkpIHtcbiAgICAgIC8vIFdlJ3ZlIGFscmVhZHkgcHJlLW9wdGltaXplZCBmb3IgdGhpcyBicHBwXG4gICAgICBkcmF3U3BlYy5iYXJzID0gXy5tYXAoXy5yYW5nZSgoc3RhcnQgLSAxKSAvIGJwcHAsIChlbmQgLSAxKSAvIGJwcHApLCBmdW5jdGlvbih4RnJvbU9yaWdpbiwgeCkge1xuICAgICAgICByZXR1cm4gKChkb3duc2FtcGxlZERhdGFbeEZyb21PcmlnaW5dIHx8IDApIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdlIGhhdmUgdG8gZG8gdGhlIGJpbm5pbmcgb24gdGhlIGZseVxuICAgICAgdmFyIGogPSBzZWxmLmRhdGEuYWxsLmJzZWFyY2goe3N0YXJ0OiBzdGFydH0pLFxuICAgICAgICBjdXJyID0gc2VsZi5kYXRhLmFsbC5nZXQoaiksIG5leHQsIGJpbjtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJlY2FsYy53aWR0aDsgaSsrKSB7XG4gICAgICAgIGJpbiA9IGN1cnIgJiYgKGN1cnIuZW5kID49IGkgKiBicHBwICsgc3RhcnQpID8gW2N1cnIudmFsXSA6IFtdO1xuICAgICAgICB3aGlsZSAoKG5leHQgPSBzZWxmLmRhdGEuYWxsLmdldChqICsgMSkpICYmIG5leHQuc3RhcnQgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIG5leHQuZW5kID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkcmF3U3BlYy5iYXJzLnB1c2goKGJpbkZ1bmN0aW9uKGJpbikgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgZHJhd0JhcnM6IGZ1bmN0aW9uKGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpIHtcbiAgICB2YXIgemVyb0xpbmUgPSBkcmF3U3BlYy56ZXJvTGluZSwgLy8gcGl4ZWwgcG9zaXRpb24gb2YgdGhlIGRhdGEgdmFsdWUgMFxuICAgICAgY29sb3IgPSBcInJnYihcIit0aGlzLm9wdHMuY29sb3IrXCIpXCIsXG4gICAgICBhbHRDb2xvciA9IFwicmdiKFwiKyh0aGlzLm9wdHMuYWx0Q29sb3IgfHwgdGhpcy5hbHRDb2xvcikrXCIpXCIsXG4gICAgICBwb2ludEdyYXBoID0gdGhpcy5vcHRzLmdyYXBoVHlwZT09PSdwb2ludHMnO1xuICAgIFxuICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvcjtcbiAgICBfLmVhY2goZHJhd1NwZWMuYmFycywgZnVuY3Rpb24oZCwgeCkge1xuICAgICAgaWYgKGQgPT09IG51bGwpIHsgcmV0dXJuOyB9XG4gICAgICBlbHNlIGlmIChkID4gemVyb0xpbmUpIHsgXG4gICAgICAgIGlmIChwb2ludEdyYXBoKSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSBkLCAxLCAxKTsgfVxuICAgICAgICBlbHNlIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIGQsIDEsIHplcm9MaW5lID4gMCA/IChkIC0gemVyb0xpbmUpIDogZCk7IH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBhbHRDb2xvcjtcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIHplcm9MaW5lIC0gZCAtIDEsIDEsIDEpOyB9IFxuICAgICAgICBlbHNlIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIHplcm9MaW5lLCAxLCB6ZXJvTGluZSAtIGQpOyB9XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoZHJhd1NwZWMueUxpbmUgIT09IG51bGwpIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigwLDAsMClcIjtcbiAgICAgIGN0eC5maWxsUmVjdCgwLCBoZWlnaHQgLSBkcmF3U3BlYy55TGluZSwgd2lkdGgsIDEpO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgICR2aWV3TGltaXRzID0gJGRpYWxvZy5maW5kKCcudmlldy1saW1pdHMnKSxcbiAgICAgICRtYXhIZWlnaHRQaXhlbHMgPSAkZGlhbG9nLmZpbmQoJy5tYXgtaGVpZ2h0LXBpeGVscycpLFxuICAgICAgYWx0Q29sb3JPbiA9IHRoaXMudmFsaWRhdGVDb2xvcihvLmFsdENvbG9yKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuYXR0cignY2hlY2tlZCcsIGFsdENvbG9yT24pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKGFsdENvbG9yT24gPyBvLmFsdENvbG9yIDonMTI4LDEyOCwxMjgnKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5hdHRyKCdjaGVja2VkJywgIXRoaXMuaXNPbihvLmF1dG9TY2FsZSkpLmNoYW5nZSgpO1xuICAgICR2aWV3TGltaXRzLnNsaWRlcihcIm9wdGlvblwiLCBcIm1pblwiLCB0aGlzLnJhbmdlWzBdKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtYXhcIiwgdGhpcy5yYW5nZVsxXSk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWluXScpLnZhbCh0aGlzLmRyYXdSYW5nZVswXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWF4XScpLnZhbCh0aGlzLmRyYXdSYW5nZVsxXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmF0dHIoJ2NoZWNrZWQnLCB0aGlzLmlzT24oby55TGluZU9uT2ZmKSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKG8ueUxpbmVNYXJrKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoby5ncmFwaFR5cGUpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9d2luZG93aW5nRnVuY3Rpb25dJykudmFsKG8ud2luZG93aW5nRnVuY3Rpb24pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuYXR0cignY2hlY2tlZCcsIG8ubWF4SGVpZ2h0UGl4ZWxzLmxlbmd0aCA+PSAzKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01pbl0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMl0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWF4XScpLnZhbChvLm1heEhlaWdodFBpeGVsc1swXSkuY2hhbmdlKCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgYWx0Q29sb3JPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIG1heEhlaWdodFBpeGVsc09uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIG1heEhlaWdodFBpeGVsc01heCA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWF4XScpLnZhbCgpO1xuICAgIG8uYWx0Q29sb3IgPSBhbHRDb2xvck9uID8gJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvcl0nKS52YWwoKSA6ICcnO1xuICAgIG8uYXV0b1NjYWxlID0gISRkaWFsb2cuZmluZCgnW25hbWU9YXV0b1NjYWxlXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8udmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwoKSArICc6JyArICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwoKTtcbiAgICBvLnlMaW5lT25PZmYgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lT25PZmZdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby55TGluZU1hcmsgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lTWFya10nKS52YWwoKTtcbiAgICBvLmdyYXBoVHlwZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9Z3JhcGhUeXBlXScpLnZhbCgpO1xuICAgIG8ud2luZG93aW5nRnVuY3Rpb24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbCgpO1xuICAgIG8ubWF4SGVpZ2h0UGl4ZWxzID0gbWF4SGVpZ2h0UGl4ZWxzT24gPyBcbiAgICAgIFttYXhIZWlnaHRQaXhlbHNNYXgsIG1heEhlaWdodFBpeGVsc01heCwgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKCldLmpvaW4oJzonKSA6ICcnO1xuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaWdnbGVGb3JtYXQ7IiwiLy8gVW5kZXJzY29yZS5qcyAxLjIuM1xuLy8gKGMpIDIwMDktMjAxMSBKZXJlbXkgQXNoa2VuYXMsIERvY3VtZW50Q2xvdWQgSW5jLlxuLy8gVW5kZXJzY29yZSBpcyBmcmVlbHkgZGlzdHJpYnV0YWJsZSB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG4vLyBQb3J0aW9ucyBvZiBVbmRlcnNjb3JlIGFyZSBpbnNwaXJlZCBvciBib3Jyb3dlZCBmcm9tIFByb3RvdHlwZSxcbi8vIE9saXZlciBTdGVlbGUncyBGdW5jdGlvbmFsLCBhbmQgSm9obiBSZXNpZydzIE1pY3JvLVRlbXBsYXRpbmcuXG4vLyBGb3IgYWxsIGRldGFpbHMgYW5kIGRvY3VtZW50YXRpb246XG4vLyBodHRwOi8vZG9jdW1lbnRjbG91ZC5naXRodWIuY29tL3VuZGVyc2NvcmVcbihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoYSxjLGQpe2lmKGE9PT1jKXJldHVybiBhIT09MHx8MS9hPT0xL2M7aWYoYT09bnVsbHx8Yz09bnVsbClyZXR1cm4gYT09PWM7aWYoYS5fY2hhaW4pYT1hLl93cmFwcGVkO2lmKGMuX2NoYWluKWM9Yy5fd3JhcHBlZDtpZihhLmlzRXF1YWwmJmIuaXNGdW5jdGlvbihhLmlzRXF1YWwpKXJldHVybiBhLmlzRXF1YWwoYyk7aWYoYy5pc0VxdWFsJiZiLmlzRnVuY3Rpb24oYy5pc0VxdWFsKSlyZXR1cm4gYy5pc0VxdWFsKGEpO3ZhciBlPWwuY2FsbChhKTtpZihlIT1sLmNhbGwoYykpcmV0dXJuIGZhbHNlO3N3aXRjaChlKXtjYXNlIFwiW29iamVjdCBTdHJpbmddXCI6cmV0dXJuIGE9PVN0cmluZyhjKTtjYXNlIFwiW29iamVjdCBOdW1iZXJdXCI6cmV0dXJuIGEhPSthP2MhPStjOmE9PTA/MS9hPT0xL2M6YT09K2M7Y2FzZSBcIltvYmplY3QgRGF0ZV1cIjpjYXNlIFwiW29iamVjdCBCb29sZWFuXVwiOnJldHVybithPT0rYztjYXNlIFwiW29iamVjdCBSZWdFeHBdXCI6cmV0dXJuIGEuc291cmNlPT1cbmMuc291cmNlJiZhLmdsb2JhbD09Yy5nbG9iYWwmJmEubXVsdGlsaW5lPT1jLm11bHRpbGluZSYmYS5pZ25vcmVDYXNlPT1jLmlnbm9yZUNhc2V9aWYodHlwZW9mIGEhPVwib2JqZWN0XCJ8fHR5cGVvZiBjIT1cIm9iamVjdFwiKXJldHVybiBmYWxzZTtmb3IodmFyIGY9ZC5sZW5ndGg7Zi0tOylpZihkW2ZdPT1hKXJldHVybiB0cnVlO2QucHVzaChhKTt2YXIgZj0wLGc9dHJ1ZTtpZihlPT1cIltvYmplY3QgQXJyYXldXCIpe2lmKGY9YS5sZW5ndGgsZz1mPT1jLmxlbmd0aClmb3IoO2YtLTspaWYoIShnPWYgaW4gYT09ZiBpbiBjJiZyKGFbZl0sY1tmXSxkKSkpYnJlYWt9ZWxzZXtpZihcImNvbnN0cnVjdG9yXCJpbiBhIT1cImNvbnN0cnVjdG9yXCJpbiBjfHxhLmNvbnN0cnVjdG9yIT1jLmNvbnN0cnVjdG9yKXJldHVybiBmYWxzZTtmb3IodmFyIGggaW4gYSlpZihtLmNhbGwoYSxoKSYmKGYrKywhKGc9bS5jYWxsKGMsaCkmJnIoYVtoXSxjW2hdLGQpKSkpYnJlYWs7aWYoZyl7Zm9yKGggaW4gYylpZihtLmNhbGwoYyxcbmgpJiYhZi0tKWJyZWFrO2c9IWZ9fWQucG9wKCk7cmV0dXJuIGd9dmFyIHM9dGhpcyxGPXMuXyxvPXt9LGs9QXJyYXkucHJvdG90eXBlLHA9T2JqZWN0LnByb3RvdHlwZSxpPWsuc2xpY2UsRz1rLmNvbmNhdCxIPWsudW5zaGlmdCxsPXAudG9TdHJpbmcsbT1wLmhhc093blByb3BlcnR5LHY9ay5mb3JFYWNoLHc9ay5tYXAseD1rLnJlZHVjZSx5PWsucmVkdWNlUmlnaHQsej1rLmZpbHRlcixBPWsuZXZlcnksQj1rLnNvbWUscT1rLmluZGV4T2YsQz1rLmxhc3RJbmRleE9mLHA9QXJyYXkuaXNBcnJheSxJPU9iamVjdC5rZXlzLHQ9RnVuY3Rpb24ucHJvdG90eXBlLmJpbmQsYj1mdW5jdGlvbihhKXtyZXR1cm4gbmV3IG4oYSl9O2lmKHR5cGVvZiBleHBvcnRzIT09XCJ1bmRlZmluZWRcIil7aWYodHlwZW9mIG1vZHVsZSE9PVwidW5kZWZpbmVkXCImJm1vZHVsZS5leHBvcnRzKWV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9YjtleHBvcnRzLl89Yn1lbHNlIHR5cGVvZiBkZWZpbmU9PT1cImZ1bmN0aW9uXCImJlxuZGVmaW5lLmFtZD9kZWZpbmUoXCJ1bmRlcnNjb3JlXCIsZnVuY3Rpb24oKXtyZXR1cm4gYn0pOnMuXz1iO2IuVkVSU0lPTj1cIjEuMi4zXCI7dmFyIGo9Yi5lYWNoPWIuZm9yRWFjaD1mdW5jdGlvbihhLGMsYil7aWYoYSE9bnVsbClpZih2JiZhLmZvckVhY2g9PT12KWEuZm9yRWFjaChjLGIpO2Vsc2UgaWYoYS5sZW5ndGg9PT0rYS5sZW5ndGgpZm9yKHZhciBlPTAsZj1hLmxlbmd0aDtlPGY7ZSsrKXtpZihlIGluIGEmJmMuY2FsbChiLGFbZV0sZSxhKT09PW8pYnJlYWt9ZWxzZSBmb3IoZSBpbiBhKWlmKG0uY2FsbChhLGUpJiZjLmNhbGwoYixhW2VdLGUsYSk9PT1vKWJyZWFrfTtiLm1hcD1mdW5jdGlvbihhLGMsYil7dmFyIGU9W107aWYoYT09bnVsbClyZXR1cm4gZTtpZih3JiZhLm1hcD09PXcpcmV0dXJuIGEubWFwKGMsYik7aihhLGZ1bmN0aW9uKGEsZyxoKXtlW2UubGVuZ3RoXT1jLmNhbGwoYixhLGcsaCl9KTtyZXR1cm4gZX07Yi5yZWR1Y2U9Yi5mb2xkbD1iLmluamVjdD1mdW5jdGlvbihhLFxuYyxkLGUpe3ZhciBmPWFyZ3VtZW50cy5sZW5ndGg+MjthPT1udWxsJiYoYT1bXSk7aWYoeCYmYS5yZWR1Y2U9PT14KXJldHVybiBlJiYoYz1iLmJpbmQoYyxlKSksZj9hLnJlZHVjZShjLGQpOmEucmVkdWNlKGMpO2ooYSxmdW5jdGlvbihhLGIsaSl7Zj9kPWMuY2FsbChlLGQsYSxiLGkpOihkPWEsZj10cnVlKX0pO2lmKCFmKXRocm93IG5ldyBUeXBlRXJyb3IoXCJSZWR1Y2Ugb2YgZW1wdHkgYXJyYXkgd2l0aCBubyBpbml0aWFsIHZhbHVlXCIpO3JldHVybiBkfTtiLnJlZHVjZVJpZ2h0PWIuZm9sZHI9ZnVuY3Rpb24oYSxjLGQsZSl7dmFyIGY9YXJndW1lbnRzLmxlbmd0aD4yO2E9PW51bGwmJihhPVtdKTtpZih5JiZhLnJlZHVjZVJpZ2h0PT09eSlyZXR1cm4gZSYmKGM9Yi5iaW5kKGMsZSkpLGY/YS5yZWR1Y2VSaWdodChjLGQpOmEucmVkdWNlUmlnaHQoYyk7dmFyIGc9Yi50b0FycmF5KGEpLnJldmVyc2UoKTtlJiYhZiYmKGM9Yi5iaW5kKGMsZSkpO3JldHVybiBmP2IucmVkdWNlKGcsXG5jLGQsZSk6Yi5yZWR1Y2UoZyxjKX07Yi5maW5kPWIuZGV0ZWN0PWZ1bmN0aW9uKGEsYyxiKXt2YXIgZTtEKGEsZnVuY3Rpb24oYSxnLGgpe2lmKGMuY2FsbChiLGEsZyxoKSlyZXR1cm4gZT1hLHRydWV9KTtyZXR1cm4gZX07Yi5maWx0ZXI9Yi5zZWxlY3Q9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlPVtdO2lmKGE9PW51bGwpcmV0dXJuIGU7aWYoeiYmYS5maWx0ZXI9PT16KXJldHVybiBhLmZpbHRlcihjLGIpO2ooYSxmdW5jdGlvbihhLGcsaCl7Yy5jYWxsKGIsYSxnLGgpJiYoZVtlLmxlbmd0aF09YSl9KTtyZXR1cm4gZX07Yi5yZWplY3Q9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlPVtdO2lmKGE9PW51bGwpcmV0dXJuIGU7aihhLGZ1bmN0aW9uKGEsZyxoKXtjLmNhbGwoYixhLGcsaCl8fChlW2UubGVuZ3RoXT1hKX0pO3JldHVybiBlfTtiLmV2ZXJ5PWIuYWxsPWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT10cnVlO2lmKGE9PW51bGwpcmV0dXJuIGU7aWYoQSYmYS5ldmVyeT09PUEpcmV0dXJuIGEuZXZlcnkoYyxcbmIpO2ooYSxmdW5jdGlvbihhLGcsaCl7aWYoIShlPWUmJmMuY2FsbChiLGEsZyxoKSkpcmV0dXJuIG99KTtyZXR1cm4gZX07dmFyIEQ9Yi5zb21lPWIuYW55PWZ1bmN0aW9uKGEsYyxkKXtjfHwoYz1iLmlkZW50aXR5KTt2YXIgZT1mYWxzZTtpZihhPT1udWxsKXJldHVybiBlO2lmKEImJmEuc29tZT09PUIpcmV0dXJuIGEuc29tZShjLGQpO2ooYSxmdW5jdGlvbihhLGIsaCl7aWYoZXx8KGU9Yy5jYWxsKGQsYSxiLGgpKSlyZXR1cm4gb30pO3JldHVybiEhZX07Yi5pbmNsdWRlPWIuY29udGFpbnM9ZnVuY3Rpb24oYSxjKXt2YXIgYj1mYWxzZTtpZihhPT1udWxsKXJldHVybiBiO3JldHVybiBxJiZhLmluZGV4T2Y9PT1xP2EuaW5kZXhPZihjKSE9LTE6Yj1EKGEsZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT1jfSl9O2IuaW52b2tlPWZ1bmN0aW9uKGEsYyl7dmFyIGQ9aS5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gYi5tYXAoYSxmdW5jdGlvbihhKXtyZXR1cm4oYy5jYWxsP2N8fGE6YVtjXSkuYXBwbHkoYSxcbmQpfSl9O2IucGx1Y2s9ZnVuY3Rpb24oYSxjKXtyZXR1cm4gYi5tYXAoYSxmdW5jdGlvbihhKXtyZXR1cm4gYVtjXX0pfTtiLm1heD1mdW5jdGlvbihhLGMsZCl7aWYoIWMmJmIuaXNBcnJheShhKSlyZXR1cm4gTWF0aC5tYXguYXBwbHkoTWF0aCxhKTtpZighYyYmYi5pc0VtcHR5KGEpKXJldHVybi1JbmZpbml0eTt2YXIgZT17Y29tcHV0ZWQ6LUluZmluaXR5fTtqKGEsZnVuY3Rpb24oYSxiLGgpe2I9Yz9jLmNhbGwoZCxhLGIsaCk6YTtiPj1lLmNvbXB1dGVkJiYoZT17dmFsdWU6YSxjb21wdXRlZDpifSl9KTtyZXR1cm4gZS52YWx1ZX07Yi5taW49ZnVuY3Rpb24oYSxjLGQpe2lmKCFjJiZiLmlzQXJyYXkoYSkpcmV0dXJuIE1hdGgubWluLmFwcGx5KE1hdGgsYSk7aWYoIWMmJmIuaXNFbXB0eShhKSlyZXR1cm4gSW5maW5pdHk7dmFyIGU9e2NvbXB1dGVkOkluZmluaXR5fTtqKGEsZnVuY3Rpb24oYSxiLGgpe2I9Yz9jLmNhbGwoZCxhLGIsaCk6YTtiPGUuY29tcHV0ZWQmJihlPXt2YWx1ZTphLFxuY29tcHV0ZWQ6Yn0pfSk7cmV0dXJuIGUudmFsdWV9O2Iuc2h1ZmZsZT1mdW5jdGlvbihhKXt2YXIgYz1bXSxiO2ooYSxmdW5jdGlvbihhLGYpe2Y9PTA/Y1swXT1hOihiPU1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSooZisxKSksY1tmXT1jW2JdLGNbYl09YSl9KTtyZXR1cm4gY307Yi5zb3J0Qnk9ZnVuY3Rpb24oYSxjLGQpe3JldHVybiBiLnBsdWNrKGIubWFwKGEsZnVuY3Rpb24oYSxiLGcpe3JldHVybnt2YWx1ZTphLGNyaXRlcmlhOmMuY2FsbChkLGEsYixnKX19KS5zb3J0KGZ1bmN0aW9uKGEsYyl7dmFyIGI9YS5jcml0ZXJpYSxkPWMuY3JpdGVyaWE7cmV0dXJuIGI8ZD8tMTpiPmQ/MTowfSksXCJ2YWx1ZVwiKX07Yi5ncm91cEJ5PWZ1bmN0aW9uKGEsYyl7dmFyIGQ9e30sZT1iLmlzRnVuY3Rpb24oYyk/YzpmdW5jdGlvbihhKXtyZXR1cm4gYVtjXX07aihhLGZ1bmN0aW9uKGEsYil7dmFyIGM9ZShhLGIpOyhkW2NdfHwoZFtjXT1bXSkpLnB1c2goYSl9KTtyZXR1cm4gZH07Yi5zb3J0ZWRJbmRleD1cbmZ1bmN0aW9uKGEsYyxkKXtkfHwoZD1iLmlkZW50aXR5KTtmb3IodmFyIGU9MCxmPWEubGVuZ3RoO2U8Zjspe3ZhciBnPWUrZj4+MTtkKGFbZ10pPGQoYyk/ZT1nKzE6Zj1nfXJldHVybiBlfTtiLnRvQXJyYXk9ZnVuY3Rpb24oYSl7cmV0dXJuIWE/W106YS50b0FycmF5P2EudG9BcnJheSgpOmIuaXNBcnJheShhKT9pLmNhbGwoYSk6Yi5pc0FyZ3VtZW50cyhhKT9pLmNhbGwoYSk6Yi52YWx1ZXMoYSl9O2Iuc2l6ZT1mdW5jdGlvbihhKXtyZXR1cm4gYi50b0FycmF5KGEpLmxlbmd0aH07Yi5maXJzdD1iLmhlYWQ9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBiIT1udWxsJiYhZD9pLmNhbGwoYSwwLGIpOmFbMF19O2IuaW5pdGlhbD1mdW5jdGlvbihhLGIsZCl7cmV0dXJuIGkuY2FsbChhLDAsYS5sZW5ndGgtKGI9PW51bGx8fGQ/MTpiKSl9O2IubGFzdD1mdW5jdGlvbihhLGIsZCl7cmV0dXJuIGIhPW51bGwmJiFkP2kuY2FsbChhLE1hdGgubWF4KGEubGVuZ3RoLWIsMCkpOmFbYS5sZW5ndGgtXG4xXX07Yi5yZXN0PWIudGFpbD1mdW5jdGlvbihhLGIsZCl7cmV0dXJuIGkuY2FsbChhLGI9PW51bGx8fGQ/MTpiKX07Yi5jb21wYWN0PWZ1bmN0aW9uKGEpe3JldHVybiBiLmZpbHRlcihhLGZ1bmN0aW9uKGEpe3JldHVybiEhYX0pfTtiLmZsYXR0ZW49ZnVuY3Rpb24oYSxjKXtyZXR1cm4gYi5yZWR1Y2UoYSxmdW5jdGlvbihhLGUpe2lmKGIuaXNBcnJheShlKSlyZXR1cm4gYS5jb25jYXQoYz9lOmIuZmxhdHRlbihlKSk7YVthLmxlbmd0aF09ZTtyZXR1cm4gYX0sW10pfTtiLndpdGhvdXQ9ZnVuY3Rpb24oYSl7cmV0dXJuIGIuZGlmZmVyZW5jZShhLGkuY2FsbChhcmd1bWVudHMsMSkpfTtiLnVuaXE9Yi51bmlxdWU9ZnVuY3Rpb24oYSxjLGQpe3ZhciBkPWQ/Yi5tYXAoYSxkKTphLGU9W107Yi5yZWR1Y2UoZCxmdW5jdGlvbihkLGcsaCl7aWYoMD09aHx8KGM9PT10cnVlP2IubGFzdChkKSE9ZzohYi5pbmNsdWRlKGQsZykpKWRbZC5sZW5ndGhdPWcsZVtlLmxlbmd0aF09YVtoXTtyZXR1cm4gZH0sXG5bXSk7cmV0dXJuIGV9O2IudW5pb249ZnVuY3Rpb24oKXtyZXR1cm4gYi51bmlxKGIuZmxhdHRlbihhcmd1bWVudHMsdHJ1ZSkpfTtiLmludGVyc2VjdGlvbj1iLmludGVyc2VjdD1mdW5jdGlvbihhKXt2YXIgYz1pLmNhbGwoYXJndW1lbnRzLDEpO3JldHVybiBiLmZpbHRlcihiLnVuaXEoYSksZnVuY3Rpb24oYSl7cmV0dXJuIGIuZXZlcnkoYyxmdW5jdGlvbihjKXtyZXR1cm4gYi5pbmRleE9mKGMsYSk+PTB9KX0pfTtiLmRpZmZlcmVuY2U9ZnVuY3Rpb24oYSl7dmFyIGM9Yi5mbGF0dGVuKGkuY2FsbChhcmd1bWVudHMsMSkpO3JldHVybiBiLmZpbHRlcihhLGZ1bmN0aW9uKGEpe3JldHVybiFiLmluY2x1ZGUoYyxhKX0pfTtiLnppcD1mdW5jdGlvbigpe2Zvcih2YXIgYT1pLmNhbGwoYXJndW1lbnRzKSxjPWIubWF4KGIucGx1Y2soYSxcImxlbmd0aFwiKSksZD1BcnJheShjKSxlPTA7ZTxjO2UrKylkW2VdPWIucGx1Y2soYSxcIlwiK2UpO3JldHVybiBkfTtiLmluZGV4T2Y9ZnVuY3Rpb24oYSxcbmMsZCl7aWYoYT09bnVsbClyZXR1cm4tMTt2YXIgZTtpZihkKXJldHVybiBkPWIuc29ydGVkSW5kZXgoYSxjKSxhW2RdPT09Yz9kOi0xO2lmKHEmJmEuaW5kZXhPZj09PXEpcmV0dXJuIGEuaW5kZXhPZihjKTtmb3IoZD0wLGU9YS5sZW5ndGg7ZDxlO2QrKylpZihkIGluIGEmJmFbZF09PT1jKXJldHVybiBkO3JldHVybi0xfTtiLmxhc3RJbmRleE9mPWZ1bmN0aW9uKGEsYil7aWYoYT09bnVsbClyZXR1cm4tMTtpZihDJiZhLmxhc3RJbmRleE9mPT09QylyZXR1cm4gYS5sYXN0SW5kZXhPZihiKTtmb3IodmFyIGQ9YS5sZW5ndGg7ZC0tOylpZihkIGluIGEmJmFbZF09PT1iKXJldHVybiBkO3JldHVybi0xfTtiLnJhbmdlPWZ1bmN0aW9uKGEsYixkKXthcmd1bWVudHMubGVuZ3RoPD0xJiYoYj1hfHwwLGE9MCk7Zm9yKHZhciBkPWFyZ3VtZW50c1syXXx8MSxlPU1hdGgubWF4KE1hdGguY2VpbCgoYi1hKS9kKSwwKSxmPTAsZz1BcnJheShlKTtmPGU7KWdbZisrXT1hLGErPWQ7cmV0dXJuIGd9O1xudmFyIEU9ZnVuY3Rpb24oKXt9O2IuYmluZD1mdW5jdGlvbihhLGMpe3ZhciBkLGU7aWYoYS5iaW5kPT09dCYmdClyZXR1cm4gdC5hcHBseShhLGkuY2FsbChhcmd1bWVudHMsMSkpO2lmKCFiLmlzRnVuY3Rpb24oYSkpdGhyb3cgbmV3IFR5cGVFcnJvcjtlPWkuY2FsbChhcmd1bWVudHMsMik7cmV0dXJuIGQ9ZnVuY3Rpb24oKXtpZighKHRoaXMgaW5zdGFuY2VvZiBkKSlyZXR1cm4gYS5hcHBseShjLGUuY29uY2F0KGkuY2FsbChhcmd1bWVudHMpKSk7RS5wcm90b3R5cGU9YS5wcm90b3R5cGU7dmFyIGI9bmV3IEUsZz1hLmFwcGx5KGIsZS5jb25jYXQoaS5jYWxsKGFyZ3VtZW50cykpKTtyZXR1cm4gT2JqZWN0KGcpPT09Zz9nOmJ9fTtiLmJpbmRBbGw9ZnVuY3Rpb24oYSl7dmFyIGM9aS5jYWxsKGFyZ3VtZW50cywxKTtjLmxlbmd0aD09MCYmKGM9Yi5mdW5jdGlvbnMoYSkpO2ooYyxmdW5jdGlvbihjKXthW2NdPWIuYmluZChhW2NdLGEpfSk7cmV0dXJuIGF9O2IubWVtb2l6ZT1mdW5jdGlvbihhLFxuYyl7dmFyIGQ9e307Y3x8KGM9Yi5pZGVudGl0eSk7cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGI9Yy5hcHBseSh0aGlzLGFyZ3VtZW50cyk7cmV0dXJuIG0uY2FsbChkLGIpP2RbYl06ZFtiXT1hLmFwcGx5KHRoaXMsYXJndW1lbnRzKX19O2IuZGVsYXk9ZnVuY3Rpb24oYSxiKXt2YXIgZD1pLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7cmV0dXJuIGEuYXBwbHkoYSxkKX0sYil9O2IuZGVmZXI9ZnVuY3Rpb24oYSl7cmV0dXJuIGIuZGVsYXkuYXBwbHkoYixbYSwxXS5jb25jYXQoaS5jYWxsKGFyZ3VtZW50cywxKSkpfTtiLnRocm90dGxlPWZ1bmN0aW9uKGEsYyl7dmFyIGQsZSxmLGcsaCxpPWIuZGVib3VuY2UoZnVuY3Rpb24oKXtoPWc9ZmFsc2V9LGMpO3JldHVybiBmdW5jdGlvbigpe2Q9dGhpcztlPWFyZ3VtZW50czt2YXIgYjtmfHwoZj1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7Zj1udWxsO2gmJmEuYXBwbHkoZCxlKTtpKCl9LGMpKTtnP2g9dHJ1ZTpcbmEuYXBwbHkoZCxlKTtpKCk7Zz10cnVlfX07Yi5kZWJvdW5jZT1mdW5jdGlvbihhLGIpe3ZhciBkO3JldHVybiBmdW5jdGlvbigpe3ZhciBlPXRoaXMsZj1hcmd1bWVudHM7Y2xlYXJUaW1lb3V0KGQpO2Q9c2V0VGltZW91dChmdW5jdGlvbigpe2Q9bnVsbDthLmFwcGx5KGUsZil9LGIpfX07Yi5vbmNlPWZ1bmN0aW9uKGEpe3ZhciBiPWZhbHNlLGQ7cmV0dXJuIGZ1bmN0aW9uKCl7aWYoYilyZXR1cm4gZDtiPXRydWU7cmV0dXJuIGQ9YS5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fTtiLndyYXA9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgZD1HLmFwcGx5KFthXSxhcmd1bWVudHMpO3JldHVybiBiLmFwcGx5KHRoaXMsZCl9fTtiLmNvbXBvc2U9ZnVuY3Rpb24oKXt2YXIgYT1hcmd1bWVudHM7cmV0dXJuIGZ1bmN0aW9uKCl7Zm9yKHZhciBiPWFyZ3VtZW50cyxkPWEubGVuZ3RoLTE7ZD49MDtkLS0pYj1bYVtkXS5hcHBseSh0aGlzLGIpXTtyZXR1cm4gYlswXX19O2IuYWZ0ZXI9XG5mdW5jdGlvbihhLGIpe3JldHVybiBhPD0wP2IoKTpmdW5jdGlvbigpe2lmKC0tYTwxKXJldHVybiBiLmFwcGx5KHRoaXMsYXJndW1lbnRzKX19O2Iua2V5cz1JfHxmdW5jdGlvbihhKXtpZihhIT09T2JqZWN0KGEpKXRocm93IG5ldyBUeXBlRXJyb3IoXCJJbnZhbGlkIG9iamVjdFwiKTt2YXIgYj1bXSxkO2ZvcihkIGluIGEpbS5jYWxsKGEsZCkmJihiW2IubGVuZ3RoXT1kKTtyZXR1cm4gYn07Yi52YWx1ZXM9ZnVuY3Rpb24oYSl7cmV0dXJuIGIubWFwKGEsYi5pZGVudGl0eSl9O2IuZnVuY3Rpb25zPWIubWV0aG9kcz1mdW5jdGlvbihhKXt2YXIgYz1bXSxkO2ZvcihkIGluIGEpYi5pc0Z1bmN0aW9uKGFbZF0pJiZjLnB1c2goZCk7cmV0dXJuIGMuc29ydCgpfTtiLmV4dGVuZD1mdW5jdGlvbihhKXtqKGkuY2FsbChhcmd1bWVudHMsMSksZnVuY3Rpb24oYil7Zm9yKHZhciBkIGluIGIpYltkXSE9PXZvaWQgMCYmKGFbZF09YltkXSl9KTtyZXR1cm4gYX07Yi5kZWZhdWx0cz1mdW5jdGlvbihhKXtqKGkuY2FsbChhcmd1bWVudHMsXG4xKSxmdW5jdGlvbihiKXtmb3IodmFyIGQgaW4gYilhW2RdPT1udWxsJiYoYVtkXT1iW2RdKX0pO3JldHVybiBhfTtiLmNsb25lPWZ1bmN0aW9uKGEpe3JldHVybiFiLmlzT2JqZWN0KGEpP2E6Yi5pc0FycmF5KGEpP2Euc2xpY2UoKTpiLmV4dGVuZCh7fSxhKX07Yi50YXA9ZnVuY3Rpb24oYSxiKXtiKGEpO3JldHVybiBhfTtiLmlzRXF1YWw9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gcihhLGIsW10pfTtiLmlzRW1wdHk9ZnVuY3Rpb24oYSl7aWYoYi5pc0FycmF5KGEpfHxiLmlzU3RyaW5nKGEpKXJldHVybiBhLmxlbmd0aD09PTA7Zm9yKHZhciBjIGluIGEpaWYobS5jYWxsKGEsYykpcmV0dXJuIGZhbHNlO3JldHVybiB0cnVlfTtiLmlzRWxlbWVudD1mdW5jdGlvbihhKXtyZXR1cm4hIShhJiZhLm5vZGVUeXBlPT0xKX07Yi5pc0FycmF5PXB8fGZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBBcnJheV1cIn07Yi5pc09iamVjdD1mdW5jdGlvbihhKXtyZXR1cm4gYT09PVxuT2JqZWN0KGEpfTtiLmlzQXJndW1lbnRzPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBBcmd1bWVudHNdXCJ9O2lmKCFiLmlzQXJndW1lbnRzKGFyZ3VtZW50cykpYi5pc0FyZ3VtZW50cz1mdW5jdGlvbihhKXtyZXR1cm4hKCFhfHwhbS5jYWxsKGEsXCJjYWxsZWVcIikpfTtiLmlzRnVuY3Rpb249ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IEZ1bmN0aW9uXVwifTtiLmlzU3RyaW5nPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBTdHJpbmddXCJ9O2IuaXNOdW1iZXI9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XCJbb2JqZWN0IE51bWJlcl1cIn07Yi5pc05hTj1mdW5jdGlvbihhKXtyZXR1cm4gYSE9PWF9O2IuaXNCb29sZWFuPWZ1bmN0aW9uKGEpe3JldHVybiBhPT09dHJ1ZXx8YT09PWZhbHNlfHxsLmNhbGwoYSk9PVwiW29iamVjdCBCb29sZWFuXVwifTtiLmlzRGF0ZT1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cblwiW29iamVjdCBEYXRlXVwifTtiLmlzUmVnRXhwPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBSZWdFeHBdXCJ9O2IuaXNOdWxsPWZ1bmN0aW9uKGEpe3JldHVybiBhPT09bnVsbH07Yi5pc1VuZGVmaW5lZD1mdW5jdGlvbihhKXtyZXR1cm4gYT09PXZvaWQgMH07Yi5ub0NvbmZsaWN0PWZ1bmN0aW9uKCl7cy5fPUY7cmV0dXJuIHRoaXN9O2IuaWRlbnRpdHk9ZnVuY3Rpb24oYSl7cmV0dXJuIGF9O2IudGltZXM9ZnVuY3Rpb24oYSxiLGQpe2Zvcih2YXIgZT0wO2U8YTtlKyspYi5jYWxsKGQsZSl9O2IuZXNjYXBlPWZ1bmN0aW9uKGEpe3JldHVybihcIlwiK2EpLnJlcGxhY2UoLyYvZyxcIiZhbXA7XCIpLnJlcGxhY2UoLzwvZyxcIiZsdDtcIikucmVwbGFjZSgvPi9nLFwiJmd0O1wiKS5yZXBsYWNlKC9cIi9nLFwiJnF1b3Q7XCIpLnJlcGxhY2UoLycvZyxcIiYjeDI3O1wiKS5yZXBsYWNlKC9cXC8vZyxcIiYjeDJGO1wiKX07Yi5taXhpbj1mdW5jdGlvbihhKXtqKGIuZnVuY3Rpb25zKGEpLGZ1bmN0aW9uKGMpe0ooYyxcbmJbY109YVtjXSl9KX07dmFyIEs9MDtiLnVuaXF1ZUlkPWZ1bmN0aW9uKGEpe3ZhciBiPUsrKztyZXR1cm4gYT9hK2I6Yn07Yi50ZW1wbGF0ZVNldHRpbmdzPXtldmFsdWF0ZTovPCUoW1xcc1xcU10rPyklPi9nLGludGVycG9sYXRlOi88JT0oW1xcc1xcU10rPyklPi9nLGVzY2FwZTovPCUtKFtcXHNcXFNdKz8pJT4vZ307Yi50ZW1wbGF0ZT1mdW5jdGlvbihhLGMpe3ZhciBkPWIudGVtcGxhdGVTZXR0aW5ncyxkPVwidmFyIF9fcD1bXSxwcmludD1mdW5jdGlvbigpe19fcC5wdXNoLmFwcGx5KF9fcCxhcmd1bWVudHMpO307d2l0aChvYmp8fHt9KXtfX3AucHVzaCgnXCIrYS5yZXBsYWNlKC9cXFxcL2csXCJcXFxcXFxcXFwiKS5yZXBsYWNlKC8nL2csXCJcXFxcJ1wiKS5yZXBsYWNlKGQuZXNjYXBlLGZ1bmN0aW9uKGEsYil7cmV0dXJuXCInLF8uZXNjYXBlKFwiK2IucmVwbGFjZSgvXFxcXCcvZyxcIidcIikrXCIpLCdcIn0pLnJlcGxhY2UoZC5pbnRlcnBvbGF0ZSxmdW5jdGlvbihhLGIpe3JldHVyblwiJyxcIitiLnJlcGxhY2UoL1xcXFwnL2csXG5cIidcIikrXCIsJ1wifSkucmVwbGFjZShkLmV2YWx1YXRlfHxudWxsLGZ1bmN0aW9uKGEsYil7cmV0dXJuXCInKTtcIitiLnJlcGxhY2UoL1xcXFwnL2csXCInXCIpLnJlcGxhY2UoL1tcXHJcXG5cXHRdL2csXCIgXCIpK1wiO19fcC5wdXNoKCdcIn0pLnJlcGxhY2UoL1xcci9nLFwiXFxcXHJcIikucmVwbGFjZSgvXFxuL2csXCJcXFxcblwiKS5yZXBsYWNlKC9cXHQvZyxcIlxcXFx0XCIpK1wiJyk7fXJldHVybiBfX3Auam9pbignJyk7XCIsZT1uZXcgRnVuY3Rpb24oXCJvYmpcIixcIl9cIixkKTtyZXR1cm4gYz9lKGMsYik6ZnVuY3Rpb24oYSl7cmV0dXJuIGUuY2FsbCh0aGlzLGEsYil9fTt2YXIgbj1mdW5jdGlvbihhKXt0aGlzLl93cmFwcGVkPWF9O2IucHJvdG90eXBlPW4ucHJvdG90eXBlO3ZhciB1PWZ1bmN0aW9uKGEsYyl7cmV0dXJuIGM/YihhKS5jaGFpbigpOmF9LEo9ZnVuY3Rpb24oYSxjKXtuLnByb3RvdHlwZVthXT1mdW5jdGlvbigpe3ZhciBhPWkuY2FsbChhcmd1bWVudHMpO0guY2FsbChhLHRoaXMuX3dyYXBwZWQpO3JldHVybiB1KGMuYXBwbHkoYixcbmEpLHRoaXMuX2NoYWluKX19O2IubWl4aW4oYik7aihcInBvcCxwdXNoLHJldmVyc2Usc2hpZnQsc29ydCxzcGxpY2UsdW5zaGlmdFwiLnNwbGl0KFwiLFwiKSxmdW5jdGlvbihhKXt2YXIgYj1rW2FdO24ucHJvdG90eXBlW2FdPWZ1bmN0aW9uKCl7Yi5hcHBseSh0aGlzLl93cmFwcGVkLGFyZ3VtZW50cyk7cmV0dXJuIHUodGhpcy5fd3JhcHBlZCx0aGlzLl9jaGFpbil9fSk7aihbXCJjb25jYXRcIixcImpvaW5cIixcInNsaWNlXCJdLGZ1bmN0aW9uKGEpe3ZhciBiPWtbYV07bi5wcm90b3R5cGVbYV09ZnVuY3Rpb24oKXtyZXR1cm4gdShiLmFwcGx5KHRoaXMuX3dyYXBwZWQsYXJndW1lbnRzKSx0aGlzLl9jaGFpbil9fSk7bi5wcm90b3R5cGUuY2hhaW49ZnVuY3Rpb24oKXt0aGlzLl9jaGFpbj10cnVlO3JldHVybiB0aGlzfTtuLnByb3RvdHlwZS52YWx1ZT1mdW5jdGlvbigpe3JldHVybiB0aGlzLl93cmFwcGVkfX0pLmNhbGwodGhpcyk7Il19
