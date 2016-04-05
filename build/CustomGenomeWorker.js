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
    if (o.viewAsPairs != this.prevOpts.viewAsPairs && this.data && this.data.pileup) { 
      this.data.pileup = {};
    }
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
    
    // Get general info on the bam (e.g. `samtools idxstats`), use mapped reads per reference sequence
    // to estimate maxFetchWindow and optimalFetchWindow, and setup binning on the RemoteTrack.
    // We also fetch a bunch of reads from around infoChrRange (by default, where the browser is when
    // it first loads this track) to estimate meanItemLength, mate pairing, and the insert size distribution.
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzlIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6REE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM3VCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzNRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBDdXN0b21HZW5vbWUgcmVwcmVzZW50cyBhIGdlbm9tZSBzcGVjaWZpY2F0aW9uIHRoYXQgY2FuIHByb2R1Y2Ugb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpIHtcblxudmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL3V0aWxzL3V0aWxzLmpzJyksXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZSxcbiAgbG9nMTAgPSB1dGlscy5sb2cxMCxcbiAgcm91bmRUb1BsYWNlcyA9IHV0aWxzLnJvdW5kVG9QbGFjZXM7XG5cbmZ1bmN0aW9uIEN1c3RvbUdlbm9tZShnaXZlbkZvcm1hdCwgbWV0YWRhdGEpIHsgICAgXG4gIC8vIGdpdmVuRm9ybWF0ID0gZmFsc2UgLS0+IHRoaXMgaXMgYW4gZW1wdHkgQ3VzdG9tR2Vub21lIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgaWYgKGdpdmVuRm9ybWF0ID09PSBmYWxzZSkgeyByZXR1cm47IH0gXG4gIFxuICB0aGlzLl9wYXJzZWQgPSBmYWxzZTtcbiAgdGhpcy5fZm9ybWF0ID0gKGdpdmVuRm9ybWF0ICYmIGdpdmVuRm9ybWF0LnRvTG93ZXJDYXNlKCkpIHx8IFwiY2hyb21zaXplc1wiO1xuICB2YXIgZm9ybWF0ID0gdGhpcy5mb3JtYXQoKTtcbiAgaWYgKGZvcm1hdCA9PT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBnZW5vbWUgZm9ybWF0ICdcIitmb3JtYXQrXCInIGVuY291bnRlcmVkXCIpOyB9XG4gIFxuICAvLyB0aGlzLm9wdHMgaG9sZHMgZXZlcnl0aGluZyB0aGF0ICQudWkuZ2Vub2Jyb3dzZXIgd2lsbCBuZWVkIHRvIGNvbnN0cnVjdCBhIHZpZXcgKHNlZSBDdXN0b21HZW5vbWUuZGVmYXVsdHMgYmVsb3cpXG4gIC8vIGl0IERPRVMgTk9UIHJlbGF0ZSB0byBcIm9wdGlvbnNcIiBmb3IgcGFyc2luZywgb3IgaG93IHRoZSBnZW5vbWUgaXMgYmVpbmcgaW50ZXJwcmV0ZWQsIG9yIGFueXRoaW5nIGxpa2UgdGhhdFxuICB0aGlzLm9wdHMgPSBfLmV4dGVuZCh7fSwgZGVlcENsb25lKHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMpLCBkZWVwQ2xvbmUoZm9ybWF0LmRlZmF1bHRzIHx8IHt9KSk7XG4gIFxuICAvLyB0aGlzLm1ldGFkYXRhIGhvbGRzIGluZm9ybWF0aW9uIGV4dGVybmFsIHRvIHRoZSBwYXJzZWQgdGV4dCBwYXNzZWQgaW4gZnJvbSB0aGUgYnJvd3NlciAoZS5nLiBmaWxlbmFtZSwgc291cmNlKVxuICB0aGlzLm1ldGFkYXRhID0gbWV0YWRhdGE7XG4gIFxuICAvLyB0aGlzLmRhdGEgaG9sZHMgYW55dGhpbmcgYWRkaXRpb25hbGx5IHBhcnNlZCBmcm9tIHRoZSBnZW5vbWUgZmlsZSAobWV0YWRhdGEsIHJlZmVyZW5jZXMsIGV0Yy4pXG4gIC8vIHR5cGljYWxseSB0aGlzIGlzIGFycmFuZ2VkIHBlciBjb250aWcsIGluIHRoZSBhcnJhbmdlbWVudCBvZiB0aGlzLmRhdGEuY29udGlnc1tpXS4gLi4uXG4gIHRoaXMuZGF0YSA9IHtcbiAgICBzZXF1ZW5jZTogXCJcIiAvLyB0aGUgZnVsbCBjb25jYXRlbmF0ZWQgc2VxdWVuY2UgZm9yIGFsbCBjb250aWdzIGluIHRoaXMgZ2Vub21lLCBpZiBhdmFpbGFibGVcbiAgfTtcbiAgXG4gIC8vIGNhbiB3ZSBjYWxsIC5nZXRTZXF1ZW5jZSBvbiB0aGlzIEN1c3RvbUdlbm9tZT9cbiAgdGhpcy5jYW5HZXRTZXF1ZW5jZSA9IGZhbHNlO1xuICBcbiAgaWYoZm9ybWF0LmluaXQpIHsgZm9ybWF0LmluaXQuY2FsbCh0aGlzKTsgfVxufVxuXG5DdXN0b21HZW5vbWUuZGVmYXVsdHMgPSB7XG4gIC8vIFRoZSBmb2xsb3dpbmcga2V5cyBzaG91bGQgYmUgb3ZlcnJpZGRlbiB3aGlsZSBwYXJzaW5nIHRoZSBnZW5vbWUgZmlsZVxuICBnZW5vbWU6ICdfYmxhbmsnLFxuICBzcGVjaWVzOiAnQmxhbmsgR2Vub21lJyxcbiAgYXNzZW1ibHlEYXRlOiAnJyxcbiAgdGlsZURpcjogbnVsbCxcbiAgb3Zlcnpvb21CcHBwczogW10sXG4gIG50c0JlbG93OiBbMSwgMC4xXSxcbiAgYXZhaWxUcmFja3M6IFtcbiAgICB7XG4gICAgICBmaDoge30sICAgICAgICAvLyBcImZpeGVkIGhlaWdodHNcIiBhYm92ZSB3aGljaCBhIGRlbnNpdHkgaXMgZm9yY2VkIHRvIGRpc3BsYXkgYWJvdmUgYSBjZXJ0YWluIHRyYWNrIGhlaWdodFxuICAgICAgICAgICAgICAgICAgICAgLy8gICAgZm9ybWF0dGVkIGxpa2Uge1wiMS4wMGUrMDVcIjp7XCJkZW5zZVwiOjE1fX1cbiAgICAgIG46IFwicnVsZXJcIiwgICAgLy8gc2hvcnQgdW5pcXVlIG5hbWUgZm9yIHRoZSB0cmFja1xuICAgICAgczogW1wiZGVuc2VcIl0sICAvLyBwb3NzaWJsZSBkZW5zaXRpZXMgZm9yIHRpbGVzLCBlLmcuIFtcImRlbnNlXCIsIFwic3F1aXNoXCIsIFwicGFja1wiXVxuICAgICAgaDogMjUgICAgICAgICAgLy8gc3RhcnRpbmcgaGVpZ2h0IGluIHB4XG4gICAgfVxuICBdLFxuICBnZW5vbWVTaXplOiAwLFxuICBjaHJMZW5ndGhzOiB7fSxcbiAgY2hyT3JkZXI6IFtdLFxuICBjaHJCYW5kczogbnVsbCxcbiAgdGlsZVdpZHRoOiAxMDAwLFxuICBzdWJkaXJGb3JCcHBwc1VuZGVyOiAzMzAsXG4gIGlkZW9ncmFtc0Fib3ZlOiAxMDAwLFxuICBtYXhOdFJlcXVlc3Q6IDIwMDAwLFxuICB0cmFja3M6IFt7bjogXCJydWxlclwifV0sXG4gIHRyYWNrRGVzYzoge1xuICAgIHJ1bGVyOiB7XG4gICAgICBjYXQ6IFwiTWFwcGluZyBhbmQgU2VxdWVuY2luZyBUcmFja3NcIixcbiAgICAgIHNtOiBcIkJhc2UgUG9zaXRpb25cIlxuICAgIH1cbiAgfSxcbiAgLy8gVGhlc2UgbGFzdCB0aHJlZSB3aWxsIGJlIG92ZXJyaWRkZW4gdXNpbmcga25vd2xlZGdlIG9mIHRoZSB3aW5kb3cncyB3aWR0aFxuICBicHBwczogW10sXG4gIGJwcHBOdW1iZXJzQmVsb3c6IFtdLFxuICBpbml0Wm9vbTogbnVsbFxufTtcblxuQ3VzdG9tR2Vub21lLmZvcm1hdHMgPSB7XG4gIGNocm9tc2l6ZXM6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvY2hyb21zaXplcy5qcycpLFxuICBmYXN0YTogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9mYXN0YS5qcycpLFxuICBnZW5iYW5rOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMnKSxcbiAgZW1ibDogbnVsbCAvLyBUT0RPLiBCYXNpY2FsbHkgZ2VuYmFuayB3aXRoIGV4dHJhIGNvbHVtbnMuXG59XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JtYXQoKS5wYXJzZS5hcHBseSh0aGlzLCBfLnRvQXJyYXkoYXJndW1lbnRzKSk7XG4gIHRoaXMuc2V0R2Vub21lU3RyaW5nKCk7XG4gIHRoaXMuX3BhcnNlZCA9IHRydWU7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmZvcm1hdCA9IGZ1bmN0aW9uKGZvcm1hdCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChfLmlzVW5kZWZpbmVkKGZvcm1hdCkpIHsgZm9ybWF0ID0gc2VsZi5fZm9ybWF0OyB9XG4gIHZhciBGb3JtYXRXcmFwcGVyID0gZnVuY3Rpb24oKSB7IF8uZXh0ZW5kKHRoaXMsIHNlbGYuY29uc3RydWN0b3IuZm9ybWF0c1tmb3JtYXRdKTsgcmV0dXJuIHRoaXM7IH07XG4gIEZvcm1hdFdyYXBwZXIucHJvdG90eXBlID0gc2VsZjtcbiAgcmV0dXJuIG5ldyBGb3JtYXRXcmFwcGVyKCk7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEdlbm9tZVN0cmluZyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgbyA9IHNlbGYub3B0cyxcbiAgICBleGNlcHRpb25zID0gWydmaWxlJywgJ2lnYicsICdhY2MnLCAndXJsJywgJ3Vjc2MnXSxcbiAgICBleGNlcHRpb24gPSBfLmZpbmQoZXhjZXB0aW9ucywgZnVuY3Rpb24odikgeyByZXR1cm4gIV8uaXNVbmRlZmluZWQoc2VsZi5tZXRhZGF0YVt2XSk7IH0pLFxuICAgIHBpZWNlcyA9IFtdO1xuICBpZiAoZXhjZXB0aW9uKSB7IG8uZ2Vub21lID0gZXhjZXB0aW9uICsgXCI6XCIgKyBzZWxmLm1ldGFkYXRhW2V4Y2VwdGlvbl07IH1cbiAgZWxzZSB7XG4gICAgcGllY2VzID0gWydjdXN0b20nICsgKHNlbGYubWV0YWRhdGEubmFtZSA/ICc6JyArIHNlbGYubWV0YWRhdGEubmFtZSA6ICcnKV07XG4gICAgXy5lYWNoKG8uY2hyT3JkZXIsIGZ1bmN0aW9uKGNocikge1xuICAgICAgcGllY2VzLnB1c2goY2hyICsgJzonICsgby5jaHJMZW5ndGhzW2Nocl0pO1xuICAgIH0pO1xuICAgIG8uZ2Vub21lID0gcGllY2VzLmpvaW4oJ3wnKTtcbiAgfVxufTtcblxuLy8gU29tZSBvZiB0aGUgb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciAoYWxsIHIvdCB6b29tIGxldmVscykgbXVzdCBiZSBzZXQgYmFzZWQgb24gdGhlIHdpZHRoIG9mIHRoZSB3aW5kb3dcbi8vICAgVGhleSBhcmUgLmJwcHBzLCAuYnBwcE51bWJlcnNCZWxvdywgYW5kIC5pbml0Wm9vbVxuLy8gICBUaGV5IGRvIG5vdCBhZmZlY3QgYW55IG9mIHRoZSBvdGhlciBvcHRpb25zIHNldCBkdXJpbmcgcGFyc2luZy5cbi8vXG4vLyB3aW5kb3dPcHRzIE1VU1QgaW5jbHVkZSBhIHByb3BlcnR5LCAud2lkdGgsIHRoYXQgaXMgdGhlIHdpbmRvdy5pbm5lcldpZHRoXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEJwcHBzID0gZnVuY3Rpb24od2luZG93T3B0cykge1xuICB3aW5kb3dPcHRzID0gd2luZG93T3B0cyB8fCB7fTtcbiAgXG4gIHZhciBvID0gdGhpcy5vcHRzLFxuICAgIHdpbmRvd1dpZHRoID0gKHdpbmRvd09wdHMud2lkdGggKiAwLjYpIHx8IDEwMDAsXG4gICAgYnBwcCA9IE1hdGgucm91bmQoby5nZW5vbWVTaXplIC8gd2luZG93V2lkdGgpLFxuICAgIGxvd2VzdEJwcHAgPSB3aW5kb3dPcHRzLmxvd2VzdEJwcHAgfHwgMC4xLFxuICAgIG1heEJwcHBzID0gMTAwLFxuICAgIGJwcHBzID0gW10sIGkgPSAwLCBsb2c7XG4gIFxuICAvLyBjb21wYXJhYmxlIHRvIHBhcnQgb2YgVUNTQ0NsaWVudCNtYWtlX2NvbmZpZyBpbiBsaWIvdWNzY19zdGl0Y2gucmJcbiAgd2hpbGUgKGJwcHAgPj0gbG93ZXN0QnBwcCAmJiBpIDwgbWF4QnBwcHMpIHtcbiAgICBicHBwcy5wdXNoKGJwcHApO1xuICAgIGxvZyA9IHJvdW5kVG9QbGFjZXMobG9nMTAoYnBwcCksIDQpO1xuICAgIGJwcHAgPSAoTWF0aC5jZWlsKGxvZykgLSBsb2cgPCAwLjQ4MSkgPyAzLjMgKiBNYXRoLnBvdygxMCwgTWF0aC5jZWlsKGxvZykgLSAxKSA6IE1hdGgucG93KDEwLCBNYXRoLmZsb29yKGxvZykpO1xuICAgIGkrKztcbiAgfVxuICBvLmJwcHBzID0gYnBwcHM7XG4gIG8uYnBwcE51bWJlcnNCZWxvdyA9IGJwcHBzLnNsaWNlKDAsIDIpO1xuICBvLmluaXRab29tID0gYnBwcHNbMF07XG59O1xuXG4vLyBDb25zdHJ1Y3QgYSBjb21wbGV0ZSBjb25maWd1cmF0aW9uIGZvciAkLnVpLmdlbm9icm93c2VyIGJhc2VkIG9uIHRoZSBpbmZvcm1hdGlvbiBwYXJzZWQgZnJvbSB0aGUgZ2Vub21lIGZpbGVcbi8vIHdoaWNoIHNob3VsZCBiZSBtb3N0bHkgaW4gdGhpcy5vcHRzLCBleGNlcHRpbmcgdGhvc2UgcmVsYXRlZCB0byB6b29tIGxldmVscywgd2hpY2ggY2FuIGJlIHNldCBub3cuXG4vLyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBhYm92ZSBmb3Igd2hhdCBhIGJhc2UgY29uZmlndXJhdGlvbiBsb29rcyBsaWtlKVxuLy9cbi8vIHdpbmRvd09wdHMgTVVTVCBpbmNsdWRlIGluY2x1ZGUgdGhlIHByb3BlcnR5IC53aWR0aCB3aGljaCBpcyB0aGUgd2luZG93LmlubmVyV2lkdGhcbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUub3B0aW9ucyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgaWYgKCF0aGlzLl9wYXJzZWQpIHsgdGhyb3cgXCJDYW5ub3QgZ2VuZXJhdGUgb3B0aW9ucyBiZWZvcmUgcGFyc2luZyB0aGUgZ2Vub21lIGZpbGVcIjsgfVxuICB0aGlzLnNldEJwcHBzKHdpbmRvd09wdHMpO1xuICB0aGlzLm9wdHMuY3VzdG9tID0gdGhpczsgICAvLyBzYW1lIGNvbnZlbnRpb24gYXMgY3VzdG9tIHRyYWNrcyBpbiBzZWxmLmF2YWlsVHJhY2tzIGluIGNocm9tb3pvb20uanNcbiAgcmV0dXJuIHRoaXMub3B0cztcbn07XG5cbi8vIEZldGNoIHRoZSBzZXF1ZW5jZSwgaWYgYXZhaWxhYmxlLCBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0LCBhbmQgb3B0aW9uYWxseSBwYXNzIGl0IHRvIHRoZSBjYWxsYmFjay5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2UgPSBmdW5jdGlvbihsZWZ0LCByaWdodCwgY2FsbGJhY2spIHtcbiAgdmFyIHNlcSA9IHRoaXMuZGF0YS5zZXF1ZW5jZS5zdWJzdHJpbmcobGVmdCAtIDEsIHJpZ2h0IC0gMSk7XG4gIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soc2VxKSA6IHNlcTsgXG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMuYXN5bmModGhpcywgJ2dldFNlcXVlbmNlJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxucmV0dXJuIEN1c3RvbUdlbm9tZTtcblxufTsiLCJ2YXIgZ2xvYmFsID0gc2VsZjsgIC8vIGdyYWIgZ2xvYmFsIHNjb2xlIGZvciBXZWIgV29ya2Vyc1xucmVxdWlyZSgnLi9qcXVlcnkubm9kb20ubWluLmpzJykoZ2xvYmFsKTtcbmdsb2JhbC5fID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lcy5qcycpKGdsb2JhbCk7XG5cbmlmICghZ2xvYmFsLmNvbnNvbGUgfHwgIWdsb2JhbC5jb25zb2xlLmxvZykge1xuICBnbG9iYWwuY29uc29sZSA9IGdsb2JhbC5jb25zb2xlIHx8IHt9O1xuICBnbG9iYWwuY29uc29sZS5sb2cgPSBmdW5jdGlvbigpIHtcbiAgICBnbG9iYWwucG9zdE1lc3NhZ2Uoe2xvZzogSlNPTi5zdHJpbmdpZnkoXy50b0FycmF5KGFyZ3VtZW50cykpfSk7XG4gIH07XG59XG5cbnZhciBDdXN0b21HZW5vbWVXb3JrZXIgPSB7XG4gIF9nZW5vbWVzOiBbXSxcbiAgX3Rocm93RXJyb3JzOiBmYWxzZSxcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIG1ldGFkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lID0gQ3VzdG9tR2Vub21lcy5wYXJzZSh0ZXh0LCBtZXRhZGF0YSksXG4gICAgICBzZXJpYWxpemFibGU7XG4gICAgXG4gICAgLy8gd2Ugd2FudCB0byBrZWVwIHRoZSBnZW5vbWUgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgIC8vIGlzIHNlbnQgYmFjayBvdmVyIHRoZSBmZW5jZSwgc2luY2UgaXQgaXMgZXhwZW5zaXZlL2ltcG9zc2libGUgdG8gc2VyaWFsaXplXG4gICAgZ2Vub21lLmlkID0gc2VsZi5fZ2Vub21lcy5wdXNoKGdlbm9tZSkgLSAxO1xuICAgIFxuICAgIHNlcmlhbGl6YWJsZSA9IF8uZXh0ZW5kKHt9LCBnZW5vbWUpO1xuICAgIGRlbGV0ZSBzZXJpYWxpemFibGUuZGF0YTtcbiAgICByZXR1cm4gc2VyaWFsaXphYmxlO1xuICB9LFxuICBvcHRpb25zOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgZ2Vub21lID0gdGhpcy5fZ2Vub21lc1tpZF07XG4gICAgcmV0dXJuIGdlbm9tZS5vcHRpb25zLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgZ2V0U2VxdWVuY2U6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICBnZW5vbWUgPSB0aGlzLl9nZW5vbWVzW2lkXTtcbiAgICByZXR1cm4gZ2Vub21lLmdldFNlcXVlbmNlLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgdGhyb3dFcnJvcnM6IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgIHRoaXMuX3Rocm93RXJyb3JzID0gdG9nZ2xlO1xuICB9XG59O1xuXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGRhdGEgPSBlLmRhdGEsXG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbihyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIHJldDogSlNPTi5zdHJpbmdpZnkociB8fCBudWxsKX0pOyB9LFxuICAgIHJldDtcblxuICBpZiAoQ3VzdG9tR2Vub21lV29ya2VyLl90aHJvd0Vycm9ycykge1xuICAgIHJldCA9IEN1c3RvbUdlbm9tZVdvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21HZW5vbWVXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTtcbiAgfSBlbHNlIHtcbiAgICB0cnkgeyByZXQgPSBDdXN0b21HZW5vbWVXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tR2Vub21lV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3MpIHsgcmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpOyB9XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIGdlbm9tZSBvYmplY3RcbiAgdmFyIEN1c3RvbUdlbm9tZSA9IHJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lJykoZ2xvYmFsKTtcbiAgXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21HZW5vbWVzLCB0aGUgbW9kdWxlIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQgPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIEN1c3RvbUdlbm9tZSBvYmplY3RzIHRoYXQgY2FuIGRlbGVnYXRlIHRoZVxuICAvLyB3b3JrIG9mIHBhcnNpbmcgdG8gYSBXZWIgV29ya2VyIHRocmVhZC5cbiAgXG4gIHZhciBDdXN0b21HZW5vbWVzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbih0ZXh0LCBtZXRhZGF0YSkge1xuICAgICAgbWV0YWRhdGEgPSBtZXRhZGF0YSB8fCB7fTtcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7IG1ldGFkYXRhLmZvcm1hdCA9IHRoaXMuZ3Vlc3NGb3JtYXQodGV4dCk7IH1cbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKG1ldGFkYXRhLmZvcm1hdCwgbWV0YWRhdGEpO1xuICAgICAgZ2Vub21lLnBhcnNlKHRleHQpO1xuICAgICAgcmV0dXJuIGdlbm9tZTtcbiAgICB9LFxuICAgIFxuICAgIGJsYW5rOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKFwiY2hyb21zaXplc1wiLCB7c3BlY2llczogXCJCbGFuayBHZW5vbWVcIn0pO1xuICAgICAgZ2Vub21lLnBhcnNlKFwiYmxhbmtcXHQ1MDAwMFwiKTtcbiAgICAgIHJldHVybiBnZW5vbWU7XG4gICAgfSxcbiAgICBcbiAgICBndWVzc0Zvcm1hdDogZnVuY3Rpb24odGV4dCkge1xuICAgICAgaWYgKHRleHQuc3Vic3RyaW5nKDAsIDUpID09ICdMT0NVUycpIHsgcmV0dXJuIFwiZ2VuYmFua1wiOyB9XG4gICAgICBpZiAoL15bQS1aXXsyfSB7M30vLnRlc3QodGV4dCkpIHsgcmV0dXJuIFwiZW1ibFwiOyB9XG4gICAgICBpZiAoL15bPjtdLy50ZXN0KHRleHQpKSB7IHJldHVybiBcImZhc3RhXCI7IH1cbiAgICAgIC8vIGRlZmF1bHQgaXMgZmFzdGFcbiAgICAgIHJldHVybiBcImZhc3RhXCI7XG4gICAgfSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbUdlbm9tZVdvcmtlci5qcycsXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICB3b3JrZXI6IGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyLFxuICAgIFxuICAgIGFzeW5jOiBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jLFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbihnZW5vbWUpIHtcbiAgICAgICAgLy8gVGhpcyBoYXMgYmVlbiBzZXJpYWxpemVkLCBzbyBpdCBtdXN0IGJlIGh5ZHJhdGVkIGludG8gYSByZWFsIEN1c3RvbUdlbm9tZSBvYmplY3QuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLmdldFNlcXVlbmNlKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21HZW5vbWUoZmFsc2UpLCBnZW5vbWUsIHtcbiAgICAgICAgICBnZXRTZXF1ZW5jZTogZnVuY3Rpb24oKSB7IEN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2VBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuICBcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMgPSBDdXN0b21HZW5vbWVzO1xuICBcbn0pOyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbVRyYWNrLCBhbiBvYmplY3QgcmVwcmVzZW50aW5nIGEgY3VzdG9tIHRyYWNrIGFzIHVuZGVyc3Rvb2QgYnkgVUNTQy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBUaGlzIGNsYXNzICpkb2VzKiBkZXBlbmQgb24gZ2xvYmFsIG9iamVjdHMgYW5kIHRoZXJlZm9yZSBtdXN0IGJlIHJlcXVpcmVkIGFzIGEgXG4vLyBmdW5jdGlvbiB0aGF0IGlzIGV4ZWN1dGVkIG9uIHRoZSBnbG9iYWwgb2JqZWN0LlxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbmZ1bmN0aW9uIEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKSB7XG4gIGlmICghb3B0cykgeyByZXR1cm47IH0gLy8gVGhpcyBpcyBhbiBlbXB0eSBjdXN0b21UcmFjayB0aGF0IHdpbGwgYmUgaHlkcmF0ZWQgd2l0aCB2YWx1ZXMgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0XG4gIHRoaXMuX3R5cGUgPSAob3B0cy50eXBlICYmIG9wdHMudHlwZS50b0xvd2VyQ2FzZSgpKSB8fCBcImJlZFwiO1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAodHlwZSA9PT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCB0cmFjayB0eXBlICdcIitvcHRzLnR5cGUrXCInIGVuY291bnRlcmVkIG9uIGxpbmUgXCIgKyBvcHRzLmxpbmVOdW0pOyB9XG4gIHRoaXMub3B0cyA9IF8uZXh0ZW5kKHt9LCB0aGlzLmNvbnN0cnVjdG9yLmRlZmF1bHRzLCB0eXBlLmRlZmF1bHRzIHx8IHt9LCBvcHRzKTtcbiAgXy5leHRlbmQodGhpcywge1xuICAgIGJyb3dzZXJPcHRzOiBicm93c2VyT3B0cyxcbiAgICBzdHJldGNoSGVpZ2h0OiBmYWxzZSxcbiAgICBoZWlnaHRzOiB7fSxcbiAgICBzaXplczogWydkZW5zZSddLFxuICAgIG1hcFNpemVzOiBbXSxcbiAgICBhcmVhczoge30sXG4gICAgbm9BcmVhTGFiZWxzOiBmYWxzZSxcbiAgICBleHBlY3RzU2VxdWVuY2U6IGZhbHNlXG4gIH0pO1xuICB0aGlzLmluaXQoKTtcbn1cblxuQ3VzdG9tVHJhY2suZGVmYXVsdHMgPSB7XG4gIG5hbWU6ICdVc2VyIFRyYWNrJyxcbiAgZGVzY3JpcHRpb246ICdVc2VyIFN1cHBsaWVkIFRyYWNrJyxcbiAgY29sb3I6ICcwLDAsMCdcbn07XG5cbkN1c3RvbVRyYWNrLnR5cGVzID0ge1xuICBiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkLmpzJyksXG4gIGZlYXR1cmV0YWJsZTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9mZWF0dXJldGFibGUuanMnKSxcbiAgYmVkZ3JhcGg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkZ3JhcGguanMnKSxcbiAgd2lnZ2xlXzA6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMnKSxcbiAgdmNmdGFiaXg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdmNmdGFiaXguanMnKSxcbiAgYmlnYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcycpLFxuICBiYW06IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmFtLmpzJyksXG4gIGJpZ3dpZzogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWd3aWcuanMnKVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkRGV0YWlsIGZvcm1hdDogaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEuNyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAgXG5cbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbCA9IF8uY2xvbmUoQ3VzdG9tVHJhY2sudHlwZXMuYmVkKTtcbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cyA9IF8uZXh0ZW5kKHt9LCBDdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMsIHtkZXRhaWw6IHRydWV9KTtcblxuLy8gVGhlc2UgZnVuY3Rpb25zIGJyYW5jaCB0byBkaWZmZXJlbnQgbWV0aG9kcyBkZXBlbmRpbmcgb24gdGhlIC50eXBlKCkgb2YgdGhlIHRyYWNrXG5fLmVhY2goWydpbml0JywgJ3BhcnNlJywgJ3JlbmRlcicsICdyZW5kZXJTZXF1ZW5jZScsICdwcmVyZW5kZXInXSwgZnVuY3Rpb24oZm4pIHtcbiAgQ3VzdG9tVHJhY2sucHJvdG90eXBlW2ZuXSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICB0eXBlID0gdGhpcy50eXBlKCk7XG4gICAgaWYgKCF0eXBlW2ZuXSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICByZXR1cm4gdHlwZVtmbl0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pO1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUubG9hZE9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybScpLmhpZGUoKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybS4nK3RoaXMuX3R5cGUpLnNob3coKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW5hbWUnKS50ZXh0KG8ubmFtZSk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1kZXNjJykudGV4dChvLmRlc2NyaXB0aW9uKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWZvcm1hdCcpLnRleHQodGhpcy5fdHlwZSk7XG4gICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKG8uY29sb3IpLmNoYW5nZSgpO1xuICBpZiAodHlwZS5sb2FkT3B0cykgeyB0eXBlLmxvYWRPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgJGRpYWxvZy5maW5kKCcuZW5hYmxlcicpLmNoYW5nZSgpO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnNhdmVPcHRzID0gZnVuY3Rpb24oJGRpYWxvZykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpLFxuICAgIG8gPSB0aGlzLm9wdHM7XG4gIG8uY29sb3IgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yXScpLnZhbCgpO1xuICBpZiAoIXRoaXMudmFsaWRhdGVDb2xvcihvLmNvbG9yKSkgeyBvLmNvbG9yID0gJzAsMCwwJzsgfVxuICBpZiAodHlwZS5zYXZlT3B0cykgeyB0eXBlLnNhdmVPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgdGhpcy5hcHBseU9wdHMoKTtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy53b3JrZXIoKSAmJiB0aGlzLmFwcGx5T3B0c0FzeW5jKCk7IC8vIEFwcGx5IHRoZSBjaGFuZ2VzIHRvIHRoZSB3b3JrZXIgdG9vIVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0cyA9IGZ1bmN0aW9uKG9wdHMpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgaWYgKG9wdHMpIHsgdGhpcy5vcHRzID0gb3B0czsgfVxuICBpZiAodHlwZS5hcHBseU9wdHMpIHsgdHlwZS5hcHBseU9wdHMuY2FsbCh0aGlzKTsgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmVyYXNlID0gZnVuY3Rpb24oY2FudmFzKSB7XG4gIHZhciBzZWxmID0gdGhpcyxcbiAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgaWYgKGN0eCkgeyBjdHguY2xlYXJSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7IH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHR5cGUpKSB7IHR5cGUgPSB0aGlzLl90eXBlOyB9XG4gIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLnR5cGVzW3R5cGVdIHx8IG51bGw7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUud2FybiA9IGZ1bmN0aW9uKHdhcm5pbmcpIHtcbiAgaWYgKHRoaXMub3B0cy5zdHJpY3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3Iod2FybmluZyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCF0aGlzLndhcm5pbmdzKSB7IHRoaXMud2FybmluZ3MgPSBbXTsgfVxuICAgIHRoaXMud2FybmluZ3MucHVzaCh3YXJuaW5nKTtcbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmlzT24gPSBmdW5jdGlvbih2YWwpIHtcbiAgcmV0dXJuIC9eKG9ufHllc3x0cnVlfHR8eXwxKSQvaS50ZXN0KHZhbC50b1N0cmluZygpKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJMaXN0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fY2hyTGlzdCkge1xuICAgIHRoaXMuX2Nockxpc3QgPSBfLnNvcnRCeShfLm1hcCh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcywgZnVuY3Rpb24ocG9zLCBjaHIpIHsgcmV0dXJuIFtwb3MsIGNocl07IH0pLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KTtcbiAgfVxuICByZXR1cm4gdGhpcy5fY2hyTGlzdDtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockF0ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHZhciBjaHJMaXN0ID0gdGhpcy5jaHJMaXN0KCksXG4gICAgY2hySW5kZXggPSBfLnNvcnRlZEluZGV4KGNockxpc3QsIFtwb3NdLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KSxcbiAgICBjaHIgPSBjaHJJbmRleCA+IDAgPyBjaHJMaXN0W2NockluZGV4IC0gMV1bMV0gOiBudWxsO1xuICByZXR1cm4ge2k6IGNockluZGV4IC0gMSwgYzogY2hyLCBwOiBwb3MgLSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJdfTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJSYW5nZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGNockxlbmd0aHMgPSB0aGlzLmJyb3dzZXJPcHRzLmNockxlbmd0aHMsXG4gICAgc3RhcnRDaHIgPSB0aGlzLmNockF0KHN0YXJ0KSxcbiAgICBlbmRDaHIgPSB0aGlzLmNockF0KGVuZCksXG4gICAgcmFuZ2U7XG4gIGlmIChzdGFydENoci5jICYmIHN0YXJ0Q2hyLmkgPT09IGVuZENoci5pKSB7IHJldHVybiBbc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBlbmRDaHIucF07IH1cbiAgZWxzZSB7XG4gICAgcmFuZ2UgPSBfLm1hcCh0aGlzLmNockxpc3QoKS5zbGljZShzdGFydENoci5pICsgMSwgZW5kQ2hyLmkpLCBmdW5jdGlvbih2KSB7XG4gICAgICByZXR1cm4gdlsxXSArICc6MS0nICsgY2hyTGVuZ3Roc1t2WzFdXTtcbiAgICB9KTtcbiAgICBzdGFydENoci5jICYmIHJhbmdlLnVuc2hpZnQoc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBjaHJMZW5ndGhzW3N0YXJ0Q2hyLmNdKTtcbiAgICBlbmRDaHIuYyAmJiByYW5nZS5wdXNoKGVuZENoci5jICsgJzoxLScgKyBlbmRDaHIucCk7XG4gICAgcmV0dXJuIHJhbmdlO1xuICB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdwcmVyZW5kZXInLCBhcmd1bWVudHMsIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAnYXBwbHlPcHRzJywgW3RoaXMub3B0cywgZnVuY3Rpb24oKXt9XSwgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hamF4RGlyID0gZnVuY3Rpb24oKSB7XG4gIC8vIFdlYiBXb3JrZXJzIGZldGNoIFVSTHMgcmVsYXRpdmUgdG8gdGhlIEpTIGZpbGUgaXRzZWxmLlxuICByZXR1cm4gKGdsb2JhbC5IVE1MRG9jdW1lbnQgPyAnJyA6ICcuLi8nKSArIHRoaXMuYnJvd3Nlck9wdHMuYWpheERpcjtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5yZ2JUb0hzbCA9IGZ1bmN0aW9uKHIsIGcsIGIpIHtcbiAgciAvPSAyNTUsIGcgLz0gMjU1LCBiIC89IDI1NTtcbiAgdmFyIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpLCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgdmFyIGgsIHMsIGwgPSAobWF4ICsgbWluKSAvIDI7XG5cbiAgaWYgKG1heCA9PSBtaW4pIHtcbiAgICBoID0gcyA9IDA7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICB2YXIgZCA9IG1heCAtIG1pbjtcbiAgICBzID0gbCA+IDAuNSA/IGQgLyAoMiAtIG1heCAtIG1pbikgOiBkIC8gKG1heCArIG1pbik7XG4gICAgc3dpdGNoKG1heCl7XG4gICAgICBjYXNlIHI6IGggPSAoZyAtIGIpIC8gZCArIChnIDwgYiA/IDYgOiAwKTsgYnJlYWs7XG4gICAgICBjYXNlIGc6IGggPSAoYiAtIHIpIC8gZCArIDI7IGJyZWFrO1xuICAgICAgY2FzZSBiOiBoID0gKHIgLSBnKSAvIGQgKyA0OyBicmVhaztcbiAgICB9XG4gICAgaCAvPSA2O1xuICB9XG5cbiAgcmV0dXJuIFtoLCBzLCBsXTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmhzbFRvUmdiID0gZnVuY3Rpb24oaCwgcywgbCkge1xuICB2YXIgciwgZywgYjtcblxuICBpZiAocyA9PSAwKSB7XG4gICAgciA9IGcgPSBiID0gbDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIGZ1bmN0aW9uIGh1ZTJyZ2IocCwgcSwgdCkge1xuICAgICAgaWYodCA8IDApIHQgKz0gMTtcbiAgICAgIGlmKHQgPiAxKSB0IC09IDE7XG4gICAgICBpZih0IDwgMS82KSByZXR1cm4gcCArIChxIC0gcCkgKiA2ICogdDtcbiAgICAgIGlmKHQgPCAxLzIpIHJldHVybiBxO1xuICAgICAgaWYodCA8IDIvMykgcmV0dXJuIHAgKyAocSAtIHApICogKDIvMyAtIHQpICogNjtcbiAgICAgIHJldHVybiBwO1xuICAgIH1cblxuICAgIHZhciBxID0gbCA8IDAuNSA/IGwgKiAoMSArIHMpIDogbCArIHMgLSBsICogcztcbiAgICB2YXIgcCA9IDIgKiBsIC0gcTtcbiAgICByID0gaHVlMnJnYihwLCBxLCBoICsgMS8zKTtcbiAgICBnID0gaHVlMnJnYihwLCBxLCBoKTtcbiAgICBiID0gaHVlMnJnYihwLCBxLCBoIC0gMS8zKTtcbiAgfVxuXG4gIHJldHVybiBbciAqIDI1NSwgZyAqIDI1NSwgYiAqIDI1NV07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS52YWxpZGF0ZUNvbG9yID0gZnVuY3Rpb24oY29sb3IpIHtcbiAgdmFyIG0gPSBjb2xvci5tYXRjaCgvKFxcZCspLChcXGQrKSwoXFxkKykvKTtcbiAgaWYgKCFtKSB7IHJldHVybiBmYWxzZTsgfVxuICBtLnNoaWZ0KCk7XG4gIHJldHVybiBfLmFsbChfLm1hcChtLCBwYXJzZUludDEwKSwgZnVuY3Rpb24odikgeyByZXR1cm4gdiA+PTAgJiYgdiA8PSAyNTU7IH0pO1xufVxuXG5yZXR1cm4gQ3VzdG9tVHJhY2s7XG5cbn07IiwibW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24oZ2xvYmFsKXtcbiAgXG4gIHZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbiAgXG4gIC8vIFNvbWUgdXRpbGl0eSBmdW5jdGlvbnMuXG4gIHZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xuICBcbiAgLy8gVGhlIGNsYXNzIHRoYXQgcmVwcmVzZW50cyBhIHNpbmd1bGFyIGN1c3RvbSB0cmFjayBvYmplY3RcbiAgdmFyIEN1c3RvbVRyYWNrID0gcmVxdWlyZSgnLi9DdXN0b21UcmFjay5qcycpKGdsb2JhbCk7XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vID0gQ3VzdG9tVHJhY2tzLCB0aGUgbW9kdWxlIHRoYXQgaXMgZXhwb3J0ZWQgdG8gdGhlIGdsb2JhbCBlbnZpcm9ubWVudC4gPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8gQnJvYWRseSBzcGVha2luZyB0aGlzIGlzIGEgZmFjdG9yeSBmb3IgcGFyc2luZyBkYXRhIGludG8gQ3VzdG9tVHJhY2sgb2JqZWN0cyxcbiAgLy8gYW5kIGl0IGNhbiBkZWxlZ2F0ZSB0aGlzIHdvcmsgdG8gYSB3b3JrZXIgdGhyZWFkLlxuXG4gIHZhciBDdXN0b21UcmFja3MgPSB7XG4gICAgcGFyc2U6IGZ1bmN0aW9uKGNodW5rcywgYnJvd3Nlck9wdHMpIHtcbiAgICAgIHZhciBjdXN0b21UcmFja3MgPSBbXSxcbiAgICAgICAgZGF0YSA9IFtdLFxuICAgICAgICB0cmFjaywgb3B0cywgbTtcbiAgICAgIFxuICAgICAgaWYgKHR5cGVvZiBjaHVua3MgPT0gXCJzdHJpbmdcIikgeyBjaHVua3MgPSBbY2h1bmtzXTsgfVxuICAgICAgXG4gICAgICBmdW5jdGlvbiBwdXNoVHJhY2soKSB7XG4gICAgICAgIGlmICh0cmFjay5wYXJzZShkYXRhKSkgeyBjdXN0b21UcmFja3MucHVzaCh0cmFjayk7IH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgY3VzdG9tVHJhY2tzLmJyb3dzZXIgPSB7fTtcbiAgICAgIF8uZWFjaChjaHVua3MsIGZ1bmN0aW9uKHRleHQpIHtcbiAgICAgICAgXy5lYWNoKHRleHQuc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgICAgIGlmICgvXiMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIC8vIGNvbW1lbnQgbGluZVxuICAgICAgICAgIH0gZWxzZSBpZiAoL15icm93c2VyXFxzKy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gYnJvd3NlciBsaW5lc1xuICAgICAgICAgICAgbSA9IGxpbmUubWF0Y2goL15icm93c2VyXFxzKyhcXHcrKVxccysoXFxTKikvKTtcbiAgICAgICAgICAgIGlmICghbSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgYnJvd3NlciBsaW5lIGZvdW5kIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSkpOyB9XG4gICAgICAgICAgICBjdXN0b21UcmFja3MuYnJvd3NlclttWzFdXSA9IG1bMl07XG4gICAgICAgICAgfSBlbHNlIGlmICgvXnRyYWNrXFxzKy9pLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgICAgICAgb3B0cyA9IHBhcnNlRGVjbGFyYXRpb25MaW5lKGxpbmUsICgvXnRyYWNrXFxzKy9pKSk7XG4gICAgICAgICAgICBpZiAoIW9wdHMpIHsgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IHBhcnNlIHRyYWNrIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIG9wdHMubGluZU51bSA9IGxpbmVubyArIDE7XG4gICAgICAgICAgICB0cmFjayA9IG5ldyBDdXN0b21UcmFjayhvcHRzLCBicm93c2VyT3B0cyk7XG4gICAgICAgICAgICBkYXRhID0gW107XG4gICAgICAgICAgfSBlbHNlIGlmICgvXFxTLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICBpZiAoIXRyYWNrKSB7IHRocm93IG5ldyBFcnJvcihcIkZvdW5kIGRhdGEgb24gbGluZSBcIisobGluZW5vKzEpK1wiIGJ1dCBubyBwcmVjZWRpbmcgdHJhY2sgZGVmaW5pdGlvblwiKTsgfVxuICAgICAgICAgICAgZGF0YS5wdXNoKGxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgcmV0dXJuIGN1c3RvbVRyYWNrcztcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lOiBwYXJzZURlY2xhcmF0aW9uTGluZSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIC8vIE5vdGU6IHRoaXMgaXMgb3ZlcnJpZGRlbiBieSB1aS5nZW5vYnJvd3NlciBkdXJpbmcgVUkgc2V0dXAuXG4gICAgICBjb25zb2xlLmxvZyhlKTtcbiAgICB9LFxuICAgIFxuICAgIF93b3JrZXJTY3JpcHQ6ICdidWlsZC9DdXN0b21UcmFja1dvcmtlci5qcycsXG4gICAgLy8gTk9URTogVG8gdGVtcG9yYXJpbHkgZGlzYWJsZSBXZWIgV29ya2VyIHVzYWdlLCBzZXQgdGhpcyB0byB0cnVlLlxuICAgIF9kaXNhYmxlV29ya2VyczogZmFsc2UsXG4gICAgXG4gICAgd29ya2VyOiBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGNhbGxiYWNrcyA9IFtdO1xuICAgICAgaWYgKCFzZWxmLl93b3JrZXIgJiYgZ2xvYmFsLldvcmtlcikgeyBcbiAgICAgICAgc2VsZi5fd29ya2VyID0gbmV3IGdsb2JhbC5Xb3JrZXIoc2VsZi5fd29ya2VyU2NyaXB0KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgZnVuY3Rpb24oZSkgeyBzZWxmLmVycm9yKGUpOyB9LCBmYWxzZSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICAgICAgICAgIGlmIChlLmRhdGEubG9nKSB7IGNvbnNvbGUubG9nKEpTT04ucGFyc2UoZS5kYXRhLmxvZykpOyByZXR1cm47IH1cbiAgICAgICAgICBpZiAoZS5kYXRhLmVycm9yKSB7XG4gICAgICAgICAgICBpZiAoZS5kYXRhLmlkKSB7IGNhbGxiYWNrc1tlLmRhdGEuaWRdID0gbnVsbDsgfVxuICAgICAgICAgICAgc2VsZi5lcnJvcihKU09OLnBhcnNlKGUuZGF0YS5lcnJvcikpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYWxsYmFja3NbZS5kYXRhLmlkXShKU09OLnBhcnNlKGUuZGF0YS5yZXQpKTtcbiAgICAgICAgICBjYWxsYmFja3NbZS5kYXRhLmlkXSA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgICBzZWxmLl93b3JrZXIuY2FsbCA9IGZ1bmN0aW9uKG9wLCBhcmdzLCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciBpZCA9IGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAtIDE7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6IG9wLCBpZDogaWQsIGFyZ3M6IGFyZ3N9KTtcbiAgICAgICAgfTtcbiAgICAgICAgLy8gVG8gaGF2ZSB0aGUgd29ya2VyIHRocm93IGVycm9ycyBpbnN0ZWFkIG9mIHBhc3NpbmcgdGhlbSBuaWNlbHkgYmFjaywgY2FsbCB0aGlzIHdpdGggdG9nZ2xlPXRydWVcbiAgICAgICAgc2VsZi5fd29ya2VyLnRocm93RXJyb3JzID0gZnVuY3Rpb24odG9nZ2xlKSB7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6ICd0aHJvd0Vycm9ycycsIGFyZ3M6IFt0b2dnbGVdfSk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VsZi5fZGlzYWJsZVdvcmtlcnMgPyBudWxsIDogc2VsZi5fd29ya2VyO1xuICAgIH0sXG4gICAgXG4gICAgYXN5bmM6IGZ1bmN0aW9uKHNlbGYsIGZuLCBhcmdzLCBhc3luY0V4dHJhQXJncywgd3JhcHBlcikge1xuICAgICAgYXJncyA9IF8udG9BcnJheShhcmdzKTtcbiAgICAgIHdyYXBwZXIgPSB3cmFwcGVyIHx8IF8uaWRlbnRpdHk7XG4gICAgICB2YXIgYXJnc0V4Y2VwdExhc3RPbmUgPSBfLmluaXRpYWwoYXJncyksXG4gICAgICAgIGNhbGxiYWNrID0gXy5sYXN0KGFyZ3MpLFxuICAgICAgICB3ID0gdGhpcy53b3JrZXIoKTtcbiAgICAgIC8vIEZhbGxiYWNrIGlmIHdlYiB3b3JrZXJzIGFyZSBub3Qgc3VwcG9ydGVkLlxuICAgICAgLy8gVGhpcyBjb3VsZCBhbHNvIGJlIHR3ZWFrZWQgdG8gbm90IHVzZSB3ZWIgd29ya2VycyB3aGVuIHRoZXJlIHdvdWxkIGJlIG5vIHBlcmZvcm1hbmNlIGdhaW47XG4gICAgICAvLyAgIGFjdGl2YXRpbmcgdGhpcyBicmFuY2ggZGlzYWJsZXMgd2ViIHdvcmtlcnMgZW50aXJlbHkgYW5kIGV2ZXJ5dGhpbmcgaGFwcGVucyBzeW5jaHJvbm91c2x5LlxuICAgICAgaWYgKCF3KSB7IHJldHVybiBjYWxsYmFjayhzZWxmW2ZuXS5hcHBseShzZWxmLCBhcmdzRXhjZXB0TGFzdE9uZSkpOyB9XG4gICAgICBBcnJheS5wcm90b3R5cGUudW5zaGlmdC5hcHBseShhcmdzRXhjZXB0TGFzdE9uZSwgYXN5bmNFeHRyYUFyZ3MpO1xuICAgICAgdy5jYWxsKGZuLCBhcmdzRXhjZXB0TGFzdE9uZSwgZnVuY3Rpb24ocmV0KSB7IGNhbGxiYWNrKHdyYXBwZXIocmV0KSk7IH0pO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VBc3luYzogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmFzeW5jKHRoaXMsICdwYXJzZScsIGFyZ3VtZW50cywgW10sIGZ1bmN0aW9uKHRyYWNrcykge1xuICAgICAgICAvLyBUaGVzZSBoYXZlIGJlZW4gc2VyaWFsaXplZCwgc28gdGhleSBtdXN0IGJlIGh5ZHJhdGVkIGludG8gcmVhbCBDdXN0b21UcmFjayBvYmplY3RzLlxuICAgICAgICAvLyBXZSByZXBsYWNlIC5wcmVyZW5kZXIoKSB3aXRoIGFuIGFzeW5jaHJvbm91cyB2ZXJzaW9uLlxuICAgICAgICByZXR1cm4gXy5tYXAodHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21UcmFjaygpLCB0LCB7XG4gICAgICAgICAgICBwcmVyZW5kZXI6IGZ1bmN0aW9uKCkgeyBDdXN0b21UcmFjay5wcm90b3R5cGUucHJlcmVuZGVyQXN5bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBnbG9iYWwuQ3VzdG9tVHJhY2tzID0gQ3VzdG9tVHJhY2tzO1xuXG59KTsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBjaHJvbS5zaXplcyBmb3JtYXQ6IGh0dHA6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9jaHJvbVNpemVzID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBOb3RlOiB3ZSBhcmUgZXh0ZW5kaW5nIHRoZSBnZW5lcmFsIHVzZSBvZiB0aGlzIHRvIGluY2x1ZGUgZGF0YSBsb2FkZWQgZnJvbSB0aGUgZ2Vub21lLnR4dCBhbmQgYW5ub3RzLnhtbFxuLy8gZmlsZXMgb2YgYW4gSUdCIHF1aWNrbG9hZCBkaXJlY3RvcnksXG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIG9wdHNBc1RyYWNrTGluZSA9IHV0aWxzLm9wdHNBc1RyYWNrTGluZTtcblxudmFyIENocm9tU2l6ZXNGb3JtYXQgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG0gPSBzZWxmLm1ldGFkYXRhLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICBvLnNwZWNpZXMgPSBtLnNwZWNpZXMgfHwgJ0N1c3RvbSBHZW5vbWUnO1xuICAgIG8uYXNzZW1ibHlEYXRlID0gbS5hc3NlbWJseURhdGUgfHwgJyc7XG4gICAgXG4gICAgLy8gVE9ETzogaWYgbWV0YWRhdGEgYWxzbyBjb250YWlucyBjdXN0b20gdHJhY2sgZGF0YSwgZS5nLiBmcm9tIGFubm90cy54bWxcbiAgICAvLyBtdXN0IGNvbnZlcnQgdGhlbSBpbnRvIGl0ZW1zIGZvciBvLmF2YWlsVHJhY2tzLCBvLnRyYWNrcywgYW5kIG8udHJhY2tEZXNjXG4gICAgLy8gVGhlIG8uYXZhaWxUcmFja3MgaXRlbXMgc2hvdWxkIGNvbnRhaW4ge2N1c3RvbURhdGE6IHRyYWNrbGluZXN9IHRvIGJlIHBhcnNlZFxuICAgIGlmIChtLnRyYWNrcykgeyBzZWxmLmZvcm1hdCgpLmNyZWF0ZVRyYWNrcyhtLnRyYWNrcyk7IH1cbiAgfSxcbiAgXG4gIGNyZWF0ZVRyYWNrczogZnVuY3Rpb24odHJhY2tzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICAgIFxuICAgIF8uZWFjaCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgIHZhciB0cmFja09wdHM7XG4gICAgICB0LmxpbmVzID0gdC5saW5lcyB8fCBbXTtcbiAgICAgIHRyYWNrT3B0cyA9IC9edHJhY2tcXHMrL2kudGVzdCh0LmxpbmVzWzBdKSA/IGdsb2JhbC5DdXN0b21UcmFja3MucGFyc2VEZWNsYXJhdGlvbkxpbmUodC5saW5lcy5zaGlmdCgpKSA6IHt9O1xuICAgICAgdC5saW5lcy51bnNoaWZ0KCd0cmFjayAnICsgb3B0c0FzVHJhY2tMaW5lKF8uZXh0ZW5kKHRyYWNrT3B0cywgdC5vcHRzLCB7bmFtZTogdC5uYW1lLCB0eXBlOiB0LnR5cGV9KSkgKyAnXFxuJyk7XG4gICAgICBvLmF2YWlsVHJhY2tzLnB1c2goe1xuICAgICAgICBmaDoge30sXG4gICAgICAgIG46IHQubmFtZSxcbiAgICAgICAgczogWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddLFxuICAgICAgICBoOiAxNSxcbiAgICAgICAgbTogWydwYWNrJ10sXG4gICAgICAgIGN1c3RvbURhdGE6IHQubGluZXNcbiAgICAgIH0pO1xuICAgICAgby50cmFja3MucHVzaCh7bjogdC5uYW1lfSk7XG4gICAgICBvLnRyYWNrRGVzY1t0Lm5hbWVdID0ge1xuICAgICAgICBjYXQ6IFwiRmVhdHVyZSBUcmFja3NcIixcbiAgICAgICAgc206IHQubmFtZSxcbiAgICAgICAgbGc6IHQuZGVzY3JpcHRpb24gfHwgdC5uYW1lXG4gICAgICB9O1xuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgbGluZXMgPSB0ZXh0LnNwbGl0KFwiXFxuXCIpLFxuICAgICAgbyA9IHRoaXMub3B0cztcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGkpIHtcbiAgICAgIHZhciBjaHJzaXplID0gc3RyaXAobGluZSkuc3BsaXQoL1xccysvLCAyKSxcbiAgICAgICAgY2hyID0gY2hyc2l6ZVswXSxcbiAgICAgICAgc2l6ZSA9IHBhcnNlSW50MTAoY2hyc2l6ZVsxXSk7XG4gICAgICBpZiAoXy5pc05hTihzaXplKSkgeyByZXR1cm47IH1cbiAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSBzaXplO1xuICAgICAgby5nZW5vbWVTaXplICs9IHNpemU7XG4gICAgfSk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hyb21TaXplc0Zvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBGQVNUQSBmb3JtYXQ6IGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvRkFTVEFfZm9ybWF0ID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZW5zdXJlVW5pcXVlID0gdXRpbHMuZW5zdXJlVW5pcXVlO1xuXG52YXIgRmFzdGFGb3JtYXQgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG0gPSBzZWxmLm1ldGFkYXRhLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICAgIFxuICAgIHNlbGYuZGF0YSA9IHt9O1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgbGluZXMgPSB0ZXh0LnNwbGl0KFwiXFxuXCIpLFxuICAgICAgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY2hyID0gbnVsbCxcbiAgICAgIHVubmFtZWRDb3VudGVyID0gMSxcbiAgICAgIGNocnNlcSA9IFtdO1xuICAgICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gW107XG4gICAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBpKSB7XG4gICAgICB2YXIgY2hyTGluZSA9IGxpbmUubWF0Y2goL15bPjtdKC4rKS8pLFxuICAgICAgICBjbGVhbmVkTGluZSA9IGxpbmUucmVwbGFjZSgvXFxzKy9nLCAnJyk7XG4gICAgICBpZiAoY2hyTGluZSkge1xuICAgICAgICBjaHIgPSBjaHJMaW5lWzFdLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKTtcbiAgICAgICAgaWYgKCFjaHIubGVuZ3RoKSB7IGNociA9IFwidW5uYW1lZENoclwiOyB9XG4gICAgICAgIGNociA9IGVuc3VyZVVuaXF1ZShjaHIsIG8uY2hyTGVuZ3Rocyk7XG4gICAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5kYXRhLnNlcXVlbmNlLnB1c2goY2xlYW5lZExpbmUpO1xuICAgICAgICBvLmNockxlbmd0aHNbY2hyXSA9IChvLmNockxlbmd0aHNbY2hyXSB8fCAwKSArIGNsZWFuZWRMaW5lLmxlbmd0aDtcbiAgICAgICAgby5nZW5vbWVTaXplICs9IGNsZWFuZWRMaW5lLmxlbmd0aDtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBzZWxmLmRhdGEuc2VxdWVuY2Uuam9pbignJyk7XG4gICAgc2VsZi5jYW5HZXRTZXF1ZW5jZSA9IHRydWU7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmFzdGFGb3JtYXQ7IiwiXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEdlbkJhbmsgZm9ybWF0OiBodHRwOi8vd3d3Lm5jYmkubmxtLm5paC5nb3YvU2l0ZW1hcC9zYW1wbGVyZWNvcmQuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIHRvcFRhZ3NBc0FycmF5ID0gdXRpbHMudG9wVGFnc0FzQXJyYXksXG4gIHN1YlRhZ3NBc0FycmF5ID0gdXRpbHMuc3ViVGFnc0FzQXJyYXksXG4gIGZldGNoRmllbGQgPSB1dGlscy5mZXRjaEZpZWxkLFxuICBnZXRUYWcgPSB1dGlscy5nZXRUYWcsXG4gIGVuc3VyZVVuaXF1ZSA9IHV0aWxzLmVuc3VyZVVuaXF1ZTtcblxudmFyIEdlbkJhbmtGb3JtYXQgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE5vdGUgdGhhdCB3ZSBjYWxsIEdlbkJhbmsgZmllbGQgbmFtZXMgbGlrZSBcIkxPQ1VTXCIsIFwiREVGSU5JVElPTlwiLCBldGMuIHRhZ3MgaW5zdGVhZCBvZiBrZXlzLlxuICAgIC8vIFdlIGRvIHRoaXMgYmVjYXVzZTogMSkgY2VydGFpbiBmaWVsZCBuYW1lcyBjYW4gYmUgcmVwZWF0ZWQgKGUuZy4gUkVGRVJFTkNFKSB3aGljaCBpcyBtb3JlIFxuICAgIC8vIGV2b2NhdGl2ZSBvZiBcInRhZ3NcIiBhcyBvcHBvc2VkIHRvIHRoZSBiZWhhdmlvciBvZiBrZXlzIGluIGEgaGFzaC4gIEFsc28sIDIpIHRoaXMgaXMgdGhlXG4gICAgLy8gbm9tZW5jbGF0dXJlIHBpY2tlZCBieSBCaW9SdWJ5LlxuICAgIFxuICAgIHRoaXMudGFnU2l6ZSA9IDEyOyAvLyBob3cgd2lkZSB0aGUgY29sdW1uIGZvciB0YWdzIGlzIGluIGEgR2VuQmFuayBmaWxlXG4gICAgdGhpcy5mZWF0dXJlVGFnU2l6ZSA9IDIxOyAvLyBob3cgd2lkZSB0aGUgY29sdW1uIGZvciB0YWdzIGlzIGluIHRoZSBmZWF0dXJlIHRhYmxlIHNlY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlZSBzZWN0aW9uIDQuMSBvZiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWxcbiAgICBcbiAgICB0aGlzLmRhdGEgPSB7XG4gICAgICBjb250aWdzOiBbXSxcbiAgICAgIHRyYWNrTGluZXM6IHtcbiAgICAgICAgc291cmNlOiBbXSxcbiAgICAgICAgZ2VuZXM6IFtdLFxuICAgICAgICBvdGhlcjogW11cbiAgICAgIH1cbiAgICB9O1xuICB9LFxuICBcbiAgcGFyc2VMb2N1czogZnVuY3Rpb24oY29udGlnKSB7XG4gICAgdmFyIGxvY3VzTGluZSA9IGNvbnRpZy5vcmlnLmxvY3VzO1xuICAgIGlmIChsb2N1c0xpbmUpIHtcbiAgICAgIGlmIChsb2N1c0xpbmUubGVuZ3RoID4gNzUpIHsgLy8gYWZ0ZXIgUmVsIDEyNi4wXG4gICAgICAgIGNvbnRpZy5lbnRyeUlkICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMTIsIDI4KSk7XG4gICAgICAgIGNvbnRpZy5sZW5ndGggICA9IHBhcnNlSW50MTAobG9jdXNMaW5lLnN1YnN0cmluZygyOSwgNDApKTtcbiAgICAgICAgY29udGlnLnN0cmFuZCAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0NCwgNDcpKTtcbiAgICAgICAgY29udGlnLm5hdHlwZSAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0NywgNTMpKTtcbiAgICAgICAgY29udGlnLmNpcmN1bGFyID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg1NSwgNjMpKTtcbiAgICAgICAgY29udGlnLmRpdmlzaW9uID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2MywgNjcpKTtcbiAgICAgICAgY29udGlnLmRhdGUgICAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2OCwgNzkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpZy5lbnRyeUlkICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMTIsIDIyKSk7XG4gICAgICAgIGNvbnRpZy5sZW5ndGggICA9IHBhcnNlSW50MTAobG9jdXNMaW5lLnN1YnN0cmluZygyMiwgMzApKTtcbiAgICAgICAgY29udGlnLnN0cmFuZCAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygzMywgMzYpKTtcbiAgICAgICAgY29udGlnLm5hdHlwZSAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygzNiwgNDApKTtcbiAgICAgICAgY29udGlnLmNpcmN1bGFyID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0MiwgNTIpKTtcbiAgICAgICAgY29udGlnLmRpdmlzaW9uID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg1MiwgNTUpKTtcbiAgICAgICAgY29udGlnLmRhdGUgICAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2MiwgNzMpKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZUhlYWRlckZpZWxkczogZnVuY3Rpb24oY29udGlnKSB7XG4gICAgdmFyIHRhZ1NpemUgPSB0aGlzLnRhZ1NpemUsXG4gICAgICBoZWFkZXJGaWVsZHNUb1BhcnNlID0ge1xuICAgICAgICBzaW1wbGU6IFsnZGVmaW5pdGlvbicsICdhY2Nlc3Npb24nLCAndmVyc2lvbiddLFxuICAgICAgICBkZWVwOiBbJ3NvdXJjZSddIC8vIGNvdWxkIGFkZCByZWZlcmVuY2VzLCBidXQgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aG9zZSBoZXJlXG4gICAgICB9O1xuICAgIFxuICAgIC8vIFBhcnNlIHNpbXBsZSBmaWVsZHMgKHRhZyAtLT4gY29udGVudClcbiAgICBfLmVhY2goaGVhZGVyRmllbGRzVG9QYXJzZS5zaW1wbGUsIGZ1bmN0aW9uKHRhZykge1xuICAgICAgaWYgKCFjb250aWcub3JpZ1t0YWddKSB7IGNvbnRpZ1t0YWddID0gbnVsbDsgcmV0dXJuOyB9XG4gICAgICBjb250aWdbdGFnXSA9IGZldGNoRmllbGQoY29udGlnLm9yaWdbdGFnXSwgdGFnU2l6ZSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gUGFyc2UgdGFncyB0aGF0IGNhbiByZXBlYXQgYW5kIGhhdmUgc3VidGFnc1xuICAgIF8uZWFjaChoZWFkZXJGaWVsZHNUb1BhcnNlLmRlZXAsIGZ1bmN0aW9uKHRhZykge1xuICAgICAgdmFyIGRhdGEgPSBbXSxcbiAgICAgICAgaXRlbXM7XG4gICAgICBpZiAoIWNvbnRpZy5vcmlnW3RhZ10pIHsgY29udGlnW3RhZ10gPSBudWxsOyByZXR1cm47IH1cbiAgICAgIFxuICAgICAgaXRlbXMgPSBjb250aWcub3JpZ1t0YWddLnJlcGxhY2UoL1xcbihbQS1aYS16XFwvXFwqXSkvZywgXCJcXG5cXDAwMSQxXCIpLnNwbGl0KFwiXFwwMDFcIik7XG4gICAgICBfLmVhY2goaXRlbXMsIGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YlRhZ3MgPSBzdWJUYWdzQXNBcnJheShpdGVtLCB0YWdTaXplKSxcbiAgICAgICAgICBpdGVtTmFtZSA9IGZldGNoRmllbGQoc3ViVGFncy5zaGlmdCgpLCB0YWdTaXplKSwgXG4gICAgICAgICAgaXRlbURhdGEgPSB7X25hbWU6IGl0ZW1OYW1lfTtcbiAgICAgICAgXy5lYWNoKHN1YlRhZ3MsIGZ1bmN0aW9uKHN1YlRhZ0ZpZWxkKSB7XG4gICAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhzdWJUYWdGaWVsZCwgdGFnU2l6ZSk7XG4gICAgICAgICAgaXRlbURhdGFbdGFnXSA9IGZldGNoRmllbGQoc3ViVGFnRmllbGQsIHRhZ1NpemUpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5wdXNoKGl0ZW1EYXRhKTtcbiAgICAgIH0pO1xuICAgICAgY29udGlnW3RhZ10gPSBkYXRhO1xuICAgICAgXG4gICAgfSk7XG4gIH0sXG4gIFxuICBwYXJzZUZlYXR1cmVUYWJsZTogZnVuY3Rpb24oY2hyLCBjb250aWdEYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgdGFnU2l6ZSA9IHNlbGYudGFnU2l6ZSxcbiAgICAgIGZlYXR1cmVUYWdTaXplID0gc2VsZi5mZWF0dXJlVGFnU2l6ZSxcbiAgICAgIHRhZ3NUb1NraXAgPSBbXCJmZWF0dXJlc1wiXSxcbiAgICAgIHRhZ3NSZWxhdGVkVG9HZW5lcyA9IFtcImNkc1wiLCBcImdlbmVcIiwgXCJtcm5hXCIsIFwiZXhvblwiLCBcImludHJvblwiXSxcbiAgICAgIGNvbnRpZ0xpbmUgPSBcIkFDQ0VTU0lPTiAgIFwiICsgY2hyICsgXCJcXG5cIjtcbiAgICBpZiAoY29udGlnRGF0YS5vcmlnLmZlYXR1cmVzKSB7XG4gICAgICB2YXIgc3ViVGFncyA9IHN1YlRhZ3NBc0FycmF5KGNvbnRpZ0RhdGEub3JpZy5mZWF0dXJlcywgdGFnU2l6ZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5zb3VyY2UucHVzaChjb250aWdMaW5lKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLmdlbmVzLnB1c2goY29udGlnTGluZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5vdGhlci5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgXy5lYWNoKHN1YlRhZ3MsIGZ1bmN0aW9uKHN1YlRhZ0ZpZWxkKSB7XG4gICAgICAgIHZhciB0YWcgPSBnZXRUYWcoc3ViVGFnRmllbGQsIGZlYXR1cmVUYWdTaXplKTtcbiAgICAgICAgaWYgKHRhZ3NUb1NraXAuaW5kZXhPZih0YWcpICE9PSAtMSkgeyByZXR1cm47IH1cbiAgICAgICAgZWxzZSBpZiAodGFnID09PSBcInNvdXJjZVwiKSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLnNvdXJjZS5wdXNoKHN1YlRhZ0ZpZWxkKTsgfVxuICAgICAgICBlbHNlIGlmICh0YWdzUmVsYXRlZFRvR2VuZXMuaW5kZXhPZih0YWcpICE9PSAtMSkgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5nZW5lcy5wdXNoKHN1YlRhZ0ZpZWxkKTsgIH1cbiAgICAgICAgZWxzZSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLm90aGVyLnB1c2goc3ViVGFnRmllbGQpOyB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZVNlcXVlbmNlOiBmdW5jdGlvbihjb250aWdEYXRhKSB7XG4gICAgaWYgKGNvbnRpZ0RhdGEub3JpZy5vcmlnaW4pIHtcbiAgICAgIHJldHVybiBjb250aWdEYXRhLm9yaWcub3JpZ2luLnJlcGxhY2UoL15vcmlnaW4uKnxcXG5bIDAtOV17MTB9fCAvaWcsICcnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIEFycmF5KGNvbnRpZ0RhdGEubGVuZ3RoKS5qb2luKCduJyk7XG4gICAgfVxuICB9LFxuICBcbiAgY3JlYXRlVHJhY2tzRnJvbUZlYXR1cmVzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY2F0ZWdvcnlUdXBsZXMgPSBbXG4gICAgICAgIFtcInNvdXJjZVwiLCBcIlNvdXJjZXNcIiwgXCJSZWdpb25zIGFubm90YXRlZCBieSBzb3VyY2Ugb3JnYW5pc20gb3Igc3BlY2ltZW5cIl0sIFxuICAgICAgICBbXCJnZW5lc1wiLCBcIkdlbmUgYW5ub3RhdGlvbnNcIiwgXCJDRFMgYW5kIGdlbmUgZmVhdHVyZXNcIl0sIFxuICAgICAgICBbXCJvdGhlclwiLCBcIk90aGVyIGFubm90YXRpb25zXCIsIFwidFJOQXMgYW5kIG90aGVyIGZlYXR1cmVzXCJdXG4gICAgICBdO1xuICAgIFxuICAgIC8vIEZvciB0aGUgY2F0ZWdvcmllcyBvZiBmZWF0dXJlcywgY3JlYXRlIGFwcHJvcHJpYXRlIGVudHJpZXMgaW4gby5hdmFpbFRyYWNrcywgby50cmFja3MsIGFuZCBvLnRyYWNrRGVzY1xuICAgIC8vIExlYXZlIHRoZSBhY3R1YWwgZGF0YSBhcyBhcnJheXMgb2YgbGluZXMgdGhhdCBhcmUgYXR0YWNoZWQgYXMgLmN1c3RvbURhdGEgdG8gby5hdmFpbFRyYWNrc1xuICAgIC8vIFRoZXkgd2lsbCBiZSBwYXJzZWQgbGF0ZXIgdmlhIEN1c3RvbVRyYWNrcy5wYXJzZS5cbiAgICBfLmVhY2goY2F0ZWdvcnlUdXBsZXMsIGZ1bmN0aW9uKGNhdGVnb3J5VHVwbGUpIHtcbiAgICAgIHZhciBjYXRlZ29yeSA9IGNhdGVnb3J5VHVwbGVbMF0sXG4gICAgICAgIGxhYmVsID0gY2F0ZWdvcnlUdXBsZVsxXSxcbiAgICAgICAgbG9uZ0xhYmVsID0gY2F0ZWdvcnlUdXBsZVsyXSxcbiAgICAgICAgdHJhY2tMaW5lcyA9IFtdO1xuICAgICAgaWYgKHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XS51bnNoaWZ0KCd0cmFjayB0eXBlPVwiZmVhdHVyZVRhYmxlXCIgbmFtZT1cIicgKyBsYWJlbCArIFxuICAgICAgICAgICdcIiBjb2xsYXBzZUJ5R2VuZT1cIicgKyAoY2F0ZWdvcnk9PVwiZ2VuZXNcIiA/ICdvbicgOiAnb2ZmJykgKyAnXCJcXG4nKTtcbiAgICAgIH1cbiAgICAgIG8uYXZhaWxUcmFja3MucHVzaCh7XG4gICAgICAgIGZoOiB7fSxcbiAgICAgICAgbjogY2F0ZWdvcnksXG4gICAgICAgIHM6IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXSxcbiAgICAgICAgaDogMTUsXG4gICAgICAgIG06IFsncGFjayddLFxuICAgICAgICBjdXN0b21EYXRhOiBzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV1cbiAgICAgIH0pO1xuICAgICAgby50cmFja3MucHVzaCh7bjogY2F0ZWdvcnl9KTtcbiAgICAgIG8udHJhY2tEZXNjW2NhdGVnb3J5XSA9IHtcbiAgICAgICAgY2F0OiBcIkZlYXR1cmUgVHJhY2tzXCIsXG4gICAgICAgIHNtOiBsYWJlbCxcbiAgICAgICAgbGc6IGxvbmdMYWJlbFxuICAgICAgfTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNvbnRpZ0RlbGltaXRlciA9IFwiXFxuLy9cXG5cIixcbiAgICAgIGNvbnRpZ3MgPSB0ZXh0LnNwbGl0KGNvbnRpZ0RlbGltaXRlciksXG4gICAgICBmaXJzdENvbnRpZyA9IG51bGw7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gW107XG4gICAgICBcbiAgICBfLmVhY2goY29udGlncywgZnVuY3Rpb24oY29udGlnKSB7XG4gICAgICBpZiAoIXN0cmlwKGNvbnRpZykubGVuZ3RoKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICB2YXIgY29udGlnRGF0YSA9IHtvcmlnOiB7fX0sXG4gICAgICAgIGNociwgc2l6ZSwgY29udGlnU2VxdWVuY2U7XG4gICAgICBcbiAgICAgIC8vIFNwbGl0cyBvbiBhbnkgbGluZXMgd2l0aCBhIGNoYXJhY3RlciBpbiB0aGUgZmlyc3QgY29sdW1uXG4gICAgICBfLmVhY2godG9wVGFnc0FzQXJyYXkoY29udGlnKSwgZnVuY3Rpb24oZmllbGQpIHtcbiAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhmaWVsZCwgc2VsZi50YWdTaXplKTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY29udGlnRGF0YS5vcmlnW3RhZ10pKSB7IGNvbnRpZ0RhdGEub3JpZ1t0YWddID0gZmllbGQ7IH1cbiAgICAgICAgZWxzZSB7IGNvbnRpZ0RhdGEub3JpZ1t0YWddICs9IGZpZWxkOyB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgc2VsZi5kYXRhLmNvbnRpZ3MucHVzaChjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VMb2N1cyhjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VIZWFkZXJGaWVsZHMoY29udGlnRGF0YSk7XG4gICAgICBjb250aWdTZXF1ZW5jZSA9IHNlbGYuZm9ybWF0KCkucGFyc2VTZXF1ZW5jZShjb250aWdEYXRhKTtcbiAgICAgIFxuICAgICAgY2hyID0gY29udGlnRGF0YS5hY2Nlc3Npb24gJiYgY29udGlnRGF0YS5hY2Nlc3Npb24gIT0gJ3Vua25vd24nID8gY29udGlnRGF0YS5hY2Nlc3Npb24gOiBjb250aWdEYXRhLmVudHJ5SWQ7XG4gICAgICBjaHIgPSBlbnN1cmVVbmlxdWUoY2hyLCBvLmNockxlbmd0aHMpO1xuICAgICAgXG4gICAgICBpZiAoY29udGlnRGF0YS5sZW5ndGgpIHtcbiAgICAgICAgc2l6ZSA9IGNvbnRpZ0RhdGEubGVuZ3RoO1xuICAgICAgICBpZiAoc2l6ZSAhPSBjb250aWdTZXF1ZW5jZS5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTZXF1ZW5jZSBkYXRhIGZvciBjb250aWcgXCIrY2hyK1wiIGRvZXMgbm90IG1hdGNoIGxlbmd0aCBcIitzaXplK1wiYnAgZnJvbSBoZWFkZXJcIik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNpemUgPSBjb250aWdTZXF1ZW5jZS5sZW5ndGg7XG4gICAgICB9XG4gICAgICBcbiAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSBzaXplO1xuICAgICAgby5nZW5vbWVTaXplICs9IHNpemU7XG4gICAgICBcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VGZWF0dXJlVGFibGUoY2hyLCBjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZGF0YS5zZXF1ZW5jZS5wdXNoKGNvbnRpZ1NlcXVlbmNlKTtcbiAgICAgIFxuICAgICAgZmlyc3RDb250aWcgPSBmaXJzdENvbnRpZyB8fCBjb250aWdEYXRhO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IHNlbGYuZGF0YS5zZXF1ZW5jZS5qb2luKCcnKTtcbiAgICBzZWxmLmNhbkdldFNlcXVlbmNlID0gdHJ1ZTtcbiAgICBzZWxmLmZvcm1hdCgpLmNyZWF0ZVRyYWNrc0Zyb21GZWF0dXJlcygpO1xuICAgIFxuICAgIG8uc3BlY2llcyA9IGZpcnN0Q29udGlnLnNvdXJjZSA/IGZpcnN0Q29udGlnLnNvdXJjZVswXS5vcmdhbmlzbS5zcGxpdChcIlxcblwiKVswXSA6ICdDdXN0b20gR2Vub21lJztcbiAgICBpZiAoZmlyc3RDb250aWcuZGF0ZSkgeyBvLmFzc2VtYmx5RGF0ZSA9IGZpcnN0Q29udGlnLmRhdGU7IH1cbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gR2VuQmFua0Zvcm1hdDsiLCJ2YXIgdHJhY2tVdGlscyA9IHJlcXVpcmUoJy4uLy4uL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyk7XG5cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSB0cmFja1V0aWxzLnBhcnNlSW50MTA7XG5cbm1vZHVsZS5leHBvcnRzLmRlZXBDbG9uZSA9IGZ1bmN0aW9uKG9iaikgeyByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvYmopKTsgfVxuXG5tb2R1bGUuZXhwb3J0cy5sb2cxMCA9IGZ1bmN0aW9uKHZhbCkgeyByZXR1cm4gTWF0aC5sb2codmFsKSAvIE1hdGguTE4xMDsgfVxuXG52YXIgc3RyaXAgPSBtb2R1bGUuZXhwb3J0cy5zdHJpcCA9IHRyYWNrVXRpbHMuc3RyaXA7XG5cbm1vZHVsZS5leHBvcnRzLnJvdW5kVG9QbGFjZXMgPSBmdW5jdGlvbihudW0sIGRlYykgeyByZXR1cm4gTWF0aC5yb3VuZChudW0gKiBNYXRoLnBvdygxMCwgZGVjKSkgLyBNYXRoLnBvdygxMCwgZGVjKTsgfVxuXG4vKioqKlxuICogVGhlc2UgZnVuY3Rpb25zIGFyZSBjb21tb24gc3Vicm91dGluZXMgZm9yIHBhcnNpbmcgR2VuQmFuayBhbmQgb3RoZXIgZm9ybWF0cyBiYXNlZCBvbiBjb2x1bW4gcG9zaXRpb25zXG4gKioqKi9cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBpbiB0aGUgZmlyc3QgY29sdW1uXG4vLyAoYSBcInRvcCB0YWdcIikgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMudG9wVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCkge1xuICByZXR1cm4gZmllbGQucmVwbGFjZSgvXFxuKFtBLVphLXpcXC9cXCpdKS9nLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbn1cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBub3QgaW4gdGhlIGZpcnN0IGNvbHVtblxuLy8gYnV0IHdpdGhpbiB0aGUgbmV4dCB0YWdTaXplIGNvbHVtbnMsIHdoaWNoIGlzIGEgXCJzdWIgdGFnXCIgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMuc3ViVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkge1xuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAyKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgdmFyIHJlID0gbmV3IFJlZ0V4cChcIlxcXFxuKFxcXFxzezEsXCIgKyAodGFnU2l6ZSAtIDEpICsgXCJ9XFxcXFMpXCIsIFwiZ1wiKTtcbiAgcmV0dXJuIGZpZWxkLnJlcGxhY2UocmUsIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xufVxuXG4vLyBSZXR1cm5zIGEgbmV3IHN0cmluZyB3aXRoIHRoZSBmaXJzdCB0YWdTaXplIGNvbHVtbnMgZnJvbSBmaWVsZCByZW1vdmVkXG5tb2R1bGUuZXhwb3J0cy5mZXRjaEZpZWxkID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHtcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMSkgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHZhciByZSA9IG5ldyBSZWdFeHAoXCIoXnxcXFxcbikuezAsXCIgKyB0YWdTaXplICsgXCJ9XCIsIFwiZ1wiKTtcbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnJlcGxhY2UocmUsIFwiJDFcIikpO1xufVxuXG4vLyBHZXRzIGEgdGFnIGZyb20gYSBmaWVsZCBieSB0cmltbWluZyBpdCBvdXQgb2YgdGhlIGZpcnN0IHRhZ1NpemUgY2hhcmFjdGVycyBvZiB0aGUgZmllbGRcbm1vZHVsZS5leHBvcnRzLmdldFRhZyA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7IFxuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAxKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnN1YnN0cmluZygwLCB0YWdTaXplKS50b0xvd2VyQ2FzZSgpKTtcbn1cblxuLyoqKipcbiAqIEVuZCBHZW5CYW5rIGFuZCBjb2x1bW4tYmFzZWQgZm9ybWF0IGhlbHBlcnNcbiAqKioqL1xuXG4vLyBHaXZlbiBhIGhhc2ggYW5kIGEgcHJlc3VtcHRpdmUgbmV3IGtleSwgYXBwZW5kcyBhIGNvdW50ZXIgdG8gdGhlIGtleSB1bnRpbCBpdCBpcyBhY3R1YWxseSBhbiB1bnVzZWQga2V5XG5tb2R1bGUuZXhwb3J0cy5lbnN1cmVVbmlxdWUgPSBmdW5jdGlvbihrZXksIGhhc2gpIHtcbiAgdmFyIGkgPSAxLCBrZXlDaGVjayA9IGtleTtcbiAgd2hpbGUgKHR5cGVvZiBoYXNoW2tleUNoZWNrXSAhPSAndW5kZWZpbmVkJykgeyBrZXlDaGVjayA9IGtleSArICdfJyArIGkrKzsgfVxuICByZXR1cm4ga2V5Q2hlY2s7XG59XG5cbi8vIEdpdmVuIGEgaGFzaCB3aXRoIG9wdGlvbiBuYW1lcyBhbmQgdmFsdWVzLCBmb3JtYXRzIGl0IGluIEJFRCB0cmFjayBsaW5lIGZvcm1hdCAoc2ltaWxhciB0byBIVE1MIGVsZW1lbnQgYXR0cmlidXRlcylcbm1vZHVsZS5leHBvcnRzLm9wdHNBc1RyYWNrTGluZSA9IGZ1bmN0aW9uKG9wdGhhc2gpIHtcbiAgcmV0dXJuIF8ubWFwKG9wdGhhc2gsIGZ1bmN0aW9uKHYsIGspIHsgcmV0dXJuIGsgKyAnPVwiJyArIHYudG9TdHJpbmcoKS5yZXBsYWNlKC9cIi9nLCAnJykgKyAnXCInOyB9KS5qb2luKCcgJyk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpe2dsb2JhbC53aW5kb3c9Z2xvYmFsLndpbmRvd3x8Z2xvYmFsO2dsb2JhbC53aW5kb3cuZG9jdW1lbnQ9Z2xvYmFsLndpbmRvdy5kb2N1bWVudHx8e307KGZ1bmN0aW9uKGEsYil7ZnVuY3Rpb24gTigpe3RyeXtyZXR1cm4gbmV3IGEuQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxIVFRQXCIpfWNhdGNoKGIpe319ZnVuY3Rpb24gTSgpe3RyeXtyZXR1cm4gbmV3IGEuWE1MSHR0cFJlcXVlc3R9Y2F0Y2goYil7fX1mdW5jdGlvbiBJKGEsYyl7aWYoYS5kYXRhRmlsdGVyKXtjPWEuZGF0YUZpbHRlcihjLGEuZGF0YVR5cGUpfXZhciBkPWEuZGF0YVR5cGVzLGU9e30sZyxoLGk9ZC5sZW5ndGgsaixrPWRbMF0sbCxtLG4sbyxwO2ZvcihnPTE7ZzxpO2crKyl7aWYoZz09PTEpe2ZvcihoIGluIGEuY29udmVydGVycyl7aWYodHlwZW9mIGg9PT1cInN0cmluZ1wiKXtlW2gudG9Mb3dlckNhc2UoKV09YS5jb252ZXJ0ZXJzW2hdfX19bD1rO2s9ZFtnXTtpZihrPT09XCIqXCIpe2s9bH1lbHNlIGlmKGwhPT1cIipcIiYmbCE9PWspe209bCtcIiBcIitrO249ZVttXXx8ZVtcIiogXCIra107aWYoIW4pe3A9Yjtmb3IobyBpbiBlKXtqPW8uc3BsaXQoXCIgXCIpO2lmKGpbMF09PT1sfHxqWzBdPT09XCIqXCIpe3A9ZVtqWzFdK1wiIFwiK2tdO2lmKHApe289ZVtvXTtpZihvPT09dHJ1ZSl7bj1wfWVsc2UgaWYocD09PXRydWUpe249b31icmVha319fX1pZighKG58fHApKXtmLmVycm9yKFwiTm8gY29udmVyc2lvbiBmcm9tIFwiK20ucmVwbGFjZShcIiBcIixcIiB0byBcIikpfWlmKG4hPT10cnVlKXtjPW4/bihjKTpwKG8oYykpfX19cmV0dXJuIGN9ZnVuY3Rpb24gSChhLGMsZCl7dmFyIGU9YS5jb250ZW50cyxmPWEuZGF0YVR5cGVzLGc9YS5yZXNwb25zZUZpZWxkcyxoLGksaixrO2ZvcihpIGluIGcpe2lmKGkgaW4gZCl7Y1tnW2ldXT1kW2ldfX13aGlsZShmWzBdPT09XCIqXCIpe2Yuc2hpZnQoKTtpZihoPT09Yil7aD1hLm1pbWVUeXBlfHxjLmdldFJlc3BvbnNlSGVhZGVyKFwiY29udGVudC10eXBlXCIpfX1pZihoKXtmb3IoaSBpbiBlKXtpZihlW2ldJiZlW2ldLnRlc3QoaCkpe2YudW5zaGlmdChpKTticmVha319fWlmKGZbMF1pbiBkKXtqPWZbMF19ZWxzZXtmb3IoaSBpbiBkKXtpZighZlswXXx8YS5jb252ZXJ0ZXJzW2krXCIgXCIrZlswXV0pe2o9aTticmVha31pZighayl7az1pfX1qPWp8fGt9aWYoail7aWYoaiE9PWZbMF0pe2YudW5zaGlmdChqKX1yZXR1cm4gZFtqXX19ZnVuY3Rpb24gRyhhLGIsYyxkKXtpZihmLmlzQXJyYXkoYikpe2YuZWFjaChiLGZ1bmN0aW9uKGIsZSl7aWYoY3x8ai50ZXN0KGEpKXtkKGEsZSl9ZWxzZXtHKGErXCJbXCIrKHR5cGVvZiBlPT09XCJvYmplY3RcInx8Zi5pc0FycmF5KGUpP2I6XCJcIikrXCJdXCIsZSxjLGQpfX0pfWVsc2UgaWYoIWMmJmIhPW51bGwmJnR5cGVvZiBiPT09XCJvYmplY3RcIil7Zm9yKHZhciBlIGluIGIpe0coYStcIltcIitlK1wiXVwiLGJbZV0sYyxkKX19ZWxzZXtkKGEsYil9fWZ1bmN0aW9uIEYoYSxjKXt2YXIgZCxlLGc9Zi5hamF4U2V0dGluZ3MuZmxhdE9wdGlvbnN8fHt9O2ZvcihkIGluIGMpe2lmKGNbZF0hPT1iKXsoZ1tkXT9hOmV8fChlPXt9KSlbZF09Y1tkXX19aWYoZSl7Zi5leHRlbmQodHJ1ZSxhLGUpfX1mdW5jdGlvbiBFKGEsYyxkLGUsZixnKXtmPWZ8fGMuZGF0YVR5cGVzWzBdO2c9Z3x8e307Z1tmXT10cnVlO3ZhciBoPWFbZl0saT0wLGo9aD9oLmxlbmd0aDowLGs9YT09PXksbDtmb3IoO2k8aiYmKGt8fCFsKTtpKyspe2w9aFtpXShjLGQsZSk7aWYodHlwZW9mIGw9PT1cInN0cmluZ1wiKXtpZigha3x8Z1tsXSl7bD1ifWVsc2V7Yy5kYXRhVHlwZXMudW5zaGlmdChsKTtsPUUoYSxjLGQsZSxsLGcpfX19aWYoKGt8fCFsKSYmIWdbXCIqXCJdKXtsPUUoYSxjLGQsZSxcIipcIixnKX1yZXR1cm4gbH1mdW5jdGlvbiBEKGEpe3JldHVybiBmdW5jdGlvbihiLGMpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcIil7Yz1iO2I9XCIqXCJ9aWYoZi5pc0Z1bmN0aW9uKGMpKXt2YXIgZD1iLnRvTG93ZXJDYXNlKCkuc3BsaXQodSksZT0wLGc9ZC5sZW5ndGgsaCxpLGo7Zm9yKDtlPGc7ZSsrKXtoPWRbZV07aj0vXlxcKy8udGVzdChoKTtpZihqKXtoPWguc3Vic3RyKDEpfHxcIipcIn1pPWFbaF09YVtoXXx8W107aVtqP1widW5zaGlmdFwiOlwicHVzaFwiXShjKX19fX12YXIgYz1hLmRvY3VtZW50LGQ9YS5uYXZpZ2F0b3IsZT1hLmxvY2F0aW9uO3ZhciBmPWZ1bmN0aW9uKCl7ZnVuY3Rpb24gSigpe2lmKGUuaXNSZWFkeSl7cmV0dXJufXRyeXtjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbChcImxlZnRcIil9Y2F0Y2goYSl7c2V0VGltZW91dChKLDEpO3JldHVybn1lLnJlYWR5KCl9dmFyIGU9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gbmV3IGUuZm4uaW5pdChhLGIsaCl9LGY9YS5qUXVlcnksZz1hLiQsaCxpPS9eKD86W148XSooPFtcXHdcXFddKz4pW14+XSokfCMoW1xcd1xcLV0qKSQpLyxqPS9cXFMvLGs9L15cXHMrLyxsPS9cXHMrJC8sbT0vXFxkLyxuPS9ePChcXHcrKVxccypcXC8/Pig/OjxcXC9cXDE+KT8kLyxvPS9eW1xcXSw6e31cXHNdKiQvLHA9L1xcXFwoPzpbXCJcXFxcXFwvYmZucnRdfHVbMC05YS1mQS1GXXs0fSkvZyxxPS9cIlteXCJcXFxcXFxuXFxyXSpcInx0cnVlfGZhbHNlfG51bGx8LT9cXGQrKD86XFwuXFxkKik/KD86W2VFXVsrXFwtXT9cXGQrKT8vZyxyPS8oPzpefDp8LCkoPzpcXHMqXFxbKSsvZyxzPS8od2Via2l0KVsgXFwvXShbXFx3Ll0rKS8sdD0vKG9wZXJhKSg/Oi4qdmVyc2lvbik/WyBcXC9dKFtcXHcuXSspLyx1PS8obXNpZSkgKFtcXHcuXSspLyx2PS8obW96aWxsYSkoPzouKj8gcnY6KFtcXHcuXSspKT8vLHc9Ly0oW2Etel0pL2lnLHg9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi50b1VwcGVyQ2FzZSgpfSx5PWQudXNlckFnZW50LHosQSxCLEM9T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyxEPU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksRT1BcnJheS5wcm90b3R5cGUucHVzaCxGPUFycmF5LnByb3RvdHlwZS5zbGljZSxHPVN0cmluZy5wcm90b3R5cGUudHJpbSxIPUFycmF5LnByb3RvdHlwZS5pbmRleE9mLEk9e307ZS5mbj1lLnByb3RvdHlwZT17Y29uc3RydWN0b3I6ZSxpbml0OmZ1bmN0aW9uKGEsZCxmKXt2YXIgZyxoLGosaztpZighYSl7cmV0dXJuIHRoaXN9aWYoYS5ub2RlVHlwZSl7dGhpcy5jb250ZXh0PXRoaXNbMF09YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKGE9PT1cImJvZHlcIiYmIWQmJmMuYm9keSl7dGhpcy5jb250ZXh0PWM7dGhpc1swXT1jLmJvZHk7dGhpcy5zZWxlY3Rvcj1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYodHlwZW9mIGE9PT1cInN0cmluZ1wiKXtpZihhLmNoYXJBdCgwKT09PVwiPFwiJiZhLmNoYXJBdChhLmxlbmd0aC0xKT09PVwiPlwiJiZhLmxlbmd0aD49Myl7Zz1bbnVsbCxhLG51bGxdfWVsc2V7Zz1pLmV4ZWMoYSl9aWYoZyYmKGdbMV18fCFkKSl7aWYoZ1sxXSl7ZD1kIGluc3RhbmNlb2YgZT9kWzBdOmQ7az1kP2Qub3duZXJEb2N1bWVudHx8ZDpjO2o9bi5leGVjKGEpO2lmKGope2lmKGUuaXNQbGFpbk9iamVjdChkKSl7YT1bYy5jcmVhdGVFbGVtZW50KGpbMV0pXTtlLmZuLmF0dHIuY2FsbChhLGQsdHJ1ZSl9ZWxzZXthPVtrLmNyZWF0ZUVsZW1lbnQoalsxXSldfX1lbHNle2o9ZS5idWlsZEZyYWdtZW50KFtnWzFdXSxba10pO2E9KGouY2FjaGVhYmxlP2UuY2xvbmUoai5mcmFnbWVudCk6ai5mcmFnbWVudCkuY2hpbGROb2Rlc31yZXR1cm4gZS5tZXJnZSh0aGlzLGEpfWVsc2V7aD1jLmdldEVsZW1lbnRCeUlkKGdbMl0pO2lmKGgmJmgucGFyZW50Tm9kZSl7aWYoaC5pZCE9PWdbMl0pe3JldHVybiBmLmZpbmQoYSl9dGhpcy5sZW5ndGg9MTt0aGlzWzBdPWh9dGhpcy5jb250ZXh0PWM7dGhpcy5zZWxlY3Rvcj1hO3JldHVybiB0aGlzfX1lbHNlIGlmKCFkfHxkLmpxdWVyeSl7cmV0dXJuKGR8fGYpLmZpbmQoYSl9ZWxzZXtyZXR1cm4gdGhpcy5jb25zdHJ1Y3RvcihkKS5maW5kKGEpfX1lbHNlIGlmKGUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGYucmVhZHkoYSl9aWYoYS5zZWxlY3RvciE9PWIpe3RoaXMuc2VsZWN0b3I9YS5zZWxlY3Rvcjt0aGlzLmNvbnRleHQ9YS5jb250ZXh0fXJldHVybiBlLm1ha2VBcnJheShhLHRoaXMpfSxzZWxlY3RvcjpcIlwiLGpxdWVyeTpcIjEuNi4zcHJlXCIsbGVuZ3RoOjAsc2l6ZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLmxlbmd0aH0sdG9BcnJheTpmdW5jdGlvbigpe3JldHVybiBGLmNhbGwodGhpcywwKX0sZ2V0OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP3RoaXMudG9BcnJheSgpOmE8MD90aGlzW3RoaXMubGVuZ3RoK2FdOnRoaXNbYV19LHB1c2hTdGFjazpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9dGhpcy5jb25zdHJ1Y3RvcigpO2lmKGUuaXNBcnJheShhKSl7RS5hcHBseShkLGEpfWVsc2V7ZS5tZXJnZShkLGEpfWQucHJldk9iamVjdD10aGlzO2QuY29udGV4dD10aGlzLmNvbnRleHQ7aWYoYj09PVwiZmluZFwiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrKHRoaXMuc2VsZWN0b3I/XCIgXCI6XCJcIikrY31lbHNlIGlmKGIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcitcIi5cIitiK1wiKFwiK2MrXCIpXCJ9cmV0dXJuIGR9LGVhY2g6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gZS5lYWNoKHRoaXMsYSxiKX0scmVhZHk6ZnVuY3Rpb24oYSl7ZS5iaW5kUmVhZHkoKTtBLmRvbmUoYSk7cmV0dXJuIHRoaXN9LGVxOmZ1bmN0aW9uKGEpe3JldHVybiBhPT09LTE/dGhpcy5zbGljZShhKTp0aGlzLnNsaWNlKGEsK2ErMSl9LGZpcnN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoMCl9LGxhc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgtMSl9LHNsaWNlOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKEYuYXBwbHkodGhpcyxhcmd1bWVudHMpLFwic2xpY2VcIixGLmNhbGwoYXJndW1lbnRzKS5qb2luKFwiLFwiKSl9LG1hcDpmdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soZS5tYXAodGhpcyxmdW5jdGlvbihiLGMpe3JldHVybiBhLmNhbGwoYixjLGIpfSkpfSxlbmQ6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wcmV2T2JqZWN0fHx0aGlzLmNvbnN0cnVjdG9yKG51bGwpfSxwdXNoOkUsc29ydDpbXS5zb3J0LHNwbGljZTpbXS5zcGxpY2V9O2UuZm4uaW5pdC5wcm90b3R5cGU9ZS5mbjtlLmV4dGVuZD1lLmZuLmV4dGVuZD1mdW5jdGlvbigpe3ZhciBhLGMsZCxmLGcsaCxpPWFyZ3VtZW50c1swXXx8e30saj0xLGs9YXJndW1lbnRzLmxlbmd0aCxsPWZhbHNlO2lmKHR5cGVvZiBpPT09XCJib29sZWFuXCIpe2w9aTtpPWFyZ3VtZW50c1sxXXx8e307aj0yfWlmKHR5cGVvZiBpIT09XCJvYmplY3RcIiYmIWUuaXNGdW5jdGlvbihpKSl7aT17fX1pZihrPT09ail7aT10aGlzOy0tan1mb3IoO2o8aztqKyspe2lmKChhPWFyZ3VtZW50c1tqXSkhPW51bGwpe2ZvcihjIGluIGEpe2Q9aVtjXTtmPWFbY107aWYoaT09PWYpe2NvbnRpbnVlfWlmKGwmJmYmJihlLmlzUGxhaW5PYmplY3QoZil8fChnPWUuaXNBcnJheShmKSkpKXtpZihnKXtnPWZhbHNlO2g9ZCYmZS5pc0FycmF5KGQpP2Q6W119ZWxzZXtoPWQmJmUuaXNQbGFpbk9iamVjdChkKT9kOnt9fWlbY109ZS5leHRlbmQobCxoLGYpfWVsc2UgaWYoZiE9PWIpe2lbY109Zn19fX1yZXR1cm4gaX07ZS5leHRlbmQoe25vQ29uZmxpY3Q6ZnVuY3Rpb24oYil7aWYoYS4kPT09ZSl7YS4kPWd9aWYoYiYmYS5qUXVlcnk9PT1lKXthLmpRdWVyeT1mfXJldHVybiBlfSxpc1JlYWR5OmZhbHNlLHJlYWR5V2FpdDoxLGhvbGRSZWFkeTpmdW5jdGlvbihhKXtpZihhKXtlLnJlYWR5V2FpdCsrfWVsc2V7ZS5yZWFkeSh0cnVlKX19LHJlYWR5OmZ1bmN0aW9uKGEpe2lmKGE9PT10cnVlJiYhLS1lLnJlYWR5V2FpdHx8YSE9PXRydWUmJiFlLmlzUmVhZHkpe2lmKCFjLmJvZHkpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9ZS5pc1JlYWR5PXRydWU7aWYoYSE9PXRydWUmJi0tZS5yZWFkeVdhaXQ+MCl7cmV0dXJufUEucmVzb2x2ZVdpdGgoYyxbZV0pO2lmKGUuZm4udHJpZ2dlcil7ZShjKS50cmlnZ2VyKFwicmVhZHlcIikudW5iaW5kKFwicmVhZHlcIil9fX0sYmluZFJlYWR5OmZ1bmN0aW9uKCl7aWYoQSl7cmV0dXJufUE9ZS5fRGVmZXJyZWQoKTtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9aWYoYy5hZGRFdmVudExpc3RlbmVyKXtjLmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7YS5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLGUucmVhZHksZmFsc2UpfWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Yy5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2EuYXR0YWNoRXZlbnQoXCJvbmxvYWRcIixlLnJlYWR5KTt2YXIgYj1mYWxzZTt0cnl7Yj1hLmZyYW1lRWxlbWVudD09bnVsbH1jYXRjaChkKXt9aWYoYy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwmJmIpe0ooKX19fSxpc0Z1bmN0aW9uOmZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImZ1bmN0aW9uXCJ9LGlzQXJyYXk6QXJyYXkuaXNBcnJheXx8ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiYXJyYXlcIn0saXNXaW5kb3c6ZnVuY3Rpb24oYSl7cmV0dXJuIGEmJnR5cGVvZiBhPT09XCJvYmplY3RcIiYmXCJzZXRJbnRlcnZhbFwiaW4gYX0saXNOYU46ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGx8fCFtLnRlc3QoYSl8fGlzTmFOKGEpfSx0eXBlOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1N0cmluZyhhKTpJW0MuY2FsbChhKV18fFwib2JqZWN0XCJ9LGlzUGxhaW5PYmplY3Q6ZnVuY3Rpb24oYSl7aWYoIWF8fGUudHlwZShhKSE9PVwib2JqZWN0XCJ8fGEubm9kZVR5cGV8fGUuaXNXaW5kb3coYSkpe3JldHVybiBmYWxzZX1pZihhLmNvbnN0cnVjdG9yJiYhRC5jYWxsKGEsXCJjb25zdHJ1Y3RvclwiKSYmIUQuY2FsbChhLmNvbnN0cnVjdG9yLnByb3RvdHlwZSxcImlzUHJvdG90eXBlT2ZcIikpe3JldHVybiBmYWxzZX12YXIgYztmb3IoYyBpbiBhKXt9cmV0dXJuIGM9PT1ifHxELmNhbGwoYSxjKX0saXNFbXB0eU9iamVjdDpmdW5jdGlvbihhKXtmb3IodmFyIGIgaW4gYSl7cmV0dXJuIGZhbHNlfXJldHVybiB0cnVlfSxlcnJvcjpmdW5jdGlvbihhKXt0aHJvdyBhfSxwYXJzZUpTT046ZnVuY3Rpb24oYil7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wifHwhYil7cmV0dXJuIG51bGx9Yj1lLnRyaW0oYik7aWYoYS5KU09OJiZhLkpTT04ucGFyc2Upe3JldHVybiBhLkpTT04ucGFyc2UoYil9aWYoby50ZXN0KGIucmVwbGFjZShwLFwiQFwiKS5yZXBsYWNlKHEsXCJdXCIpLnJlcGxhY2UocixcIlwiKSkpe3JldHVybihuZXcgRnVuY3Rpb24oXCJyZXR1cm4gXCIrYikpKCl9ZS5lcnJvcihcIkludmFsaWQgSlNPTjogXCIrYil9LHBhcnNlWE1MOmZ1bmN0aW9uKGMpe3ZhciBkLGY7dHJ5e2lmKGEuRE9NUGFyc2VyKXtmPW5ldyBET01QYXJzZXI7ZD1mLnBhcnNlRnJvbVN0cmluZyhjLFwidGV4dC94bWxcIil9ZWxzZXtkPW5ldyBBY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTERPTVwiKTtkLmFzeW5jPVwiZmFsc2VcIjtkLmxvYWRYTUwoYyl9fWNhdGNoKGcpe2Q9Yn1pZighZHx8IWQuZG9jdW1lbnRFbGVtZW50fHxkLmdldEVsZW1lbnRzQnlUYWdOYW1lKFwicGFyc2VyZXJyb3JcIikubGVuZ3RoKXtlLmVycm9yKFwiSW52YWxpZCBYTUw6IFwiK2MpfXJldHVybiBkfSxub29wOmZ1bmN0aW9uKCl7fSxnbG9iYWxFdmFsOmZ1bmN0aW9uKGIpe2lmKGImJmoudGVzdChiKSl7KGEuZXhlY1NjcmlwdHx8ZnVuY3Rpb24oYil7YVtcImV2YWxcIl0uY2FsbChhLGIpfSkoYil9fSxjYW1lbENhc2U6ZnVuY3Rpb24oYSl7cmV0dXJuIGEucmVwbGFjZSh3LHgpfSxub2RlTmFtZTpmdW5jdGlvbihhLGIpe3JldHVybiBhLm5vZGVOYW1lJiZhLm5vZGVOYW1lLnRvVXBwZXJDYXNlKCk9PT1iLnRvVXBwZXJDYXNlKCl9LGVhY2g6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGc9MCxoPWEubGVuZ3RoLGk9aD09PWJ8fGUuaXNGdW5jdGlvbihhKTtpZihkKXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmFwcGx5KGFbZl0sZCk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5hcHBseShhW2crK10sZCk9PT1mYWxzZSl7YnJlYWt9fX19ZWxzZXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmNhbGwoYVtmXSxmLGFbZl0pPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuY2FsbChhW2ddLGcsYVtnKytdKT09PWZhbHNlKXticmVha319fX1yZXR1cm4gYX0sdHJpbTpHP2Z1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6Ry5jYWxsKGEpfTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOmEudG9TdHJpbmcoKS5yZXBsYWNlKGssXCJcIikucmVwbGFjZShsLFwiXCIpfSxtYWtlQXJyYXk6ZnVuY3Rpb24oYSxiKXt2YXIgYz1ifHxbXTtpZihhIT1udWxsKXt2YXIgZD1lLnR5cGUoYSk7aWYoYS5sZW5ndGg9PW51bGx8fGQ9PT1cInN0cmluZ1wifHxkPT09XCJmdW5jdGlvblwifHxkPT09XCJyZWdleHBcInx8ZS5pc1dpbmRvdyhhKSl7RS5jYWxsKGMsYSl9ZWxzZXtlLm1lcmdlKGMsYSl9fXJldHVybiBjfSxpbkFycmF5OmZ1bmN0aW9uKGEsYil7aWYoSCl7cmV0dXJuIEguY2FsbChiLGEpfWZvcih2YXIgYz0wLGQ9Yi5sZW5ndGg7YzxkO2MrKyl7aWYoYltjXT09PWEpe3JldHVybiBjfX1yZXR1cm4tMX0sbWVyZ2U6ZnVuY3Rpb24oYSxjKXt2YXIgZD1hLmxlbmd0aCxlPTA7aWYodHlwZW9mIGMubGVuZ3RoPT09XCJudW1iZXJcIil7Zm9yKHZhciBmPWMubGVuZ3RoO2U8ZjtlKyspe2FbZCsrXT1jW2VdfX1lbHNle3doaWxlKGNbZV0hPT1iKXthW2QrK109Y1tlKytdfX1hLmxlbmd0aD1kO3JldHVybiBhfSxncmVwOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD1bXSxlO2M9ISFjO2Zvcih2YXIgZj0wLGc9YS5sZW5ndGg7ZjxnO2YrKyl7ZT0hIWIoYVtmXSxmKTtpZihjIT09ZSl7ZC5wdXNoKGFbZl0pfX1yZXR1cm4gZH0sbWFwOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnLGg9W10saT0wLGo9YS5sZW5ndGgsaz1hIGluc3RhbmNlb2YgZXx8aiE9PWImJnR5cGVvZiBqPT09XCJudW1iZXJcIiYmKGo+MCYmYVswXSYmYVtqLTFdfHxqPT09MHx8ZS5pc0FycmF5KGEpKTtpZihrKXtmb3IoO2k8ajtpKyspe2Y9YyhhW2ldLGksZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fWVsc2V7Zm9yKGcgaW4gYSl7Zj1jKGFbZ10sZyxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19cmV0dXJuIGguY29uY2F0LmFwcGx5KFtdLGgpfSxndWlkOjEscHJveHk6ZnVuY3Rpb24oYSxjKXtpZih0eXBlb2YgYz09PVwic3RyaW5nXCIpe3ZhciBkPWFbY107Yz1hO2E9ZH1pZighZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gYn12YXIgZj1GLmNhbGwoYXJndW1lbnRzLDIpLGc9ZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShjLGYuY29uY2F0KEYuY2FsbChhcmd1bWVudHMpKSl9O2cuZ3VpZD1hLmd1aWQ9YS5ndWlkfHxnLmd1aWR8fGUuZ3VpZCsrO3JldHVybiBnfSxhY2Nlc3M6ZnVuY3Rpb24oYSxjLGQsZixnLGgpe3ZhciBpPWEubGVuZ3RoO2lmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Zm9yKHZhciBqIGluIGMpe2UuYWNjZXNzKGEsaixjW2pdLGYsZyxkKX1yZXR1cm4gYX1pZihkIT09Yil7Zj0haCYmZiYmZS5pc0Z1bmN0aW9uKGQpO2Zvcih2YXIgaz0wO2s8aTtrKyspe2coYVtrXSxjLGY/ZC5jYWxsKGFba10sayxnKGFba10sYykpOmQsaCl9cmV0dXJuIGF9cmV0dXJuIGk/ZyhhWzBdLGMpOmJ9LG5vdzpmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfSx1YU1hdGNoOmZ1bmN0aW9uKGEpe2E9YS50b0xvd2VyQ2FzZSgpO3ZhciBiPXMuZXhlYyhhKXx8dC5leGVjKGEpfHx1LmV4ZWMoYSl8fGEuaW5kZXhPZihcImNvbXBhdGlibGVcIik8MCYmdi5leGVjKGEpfHxbXTtyZXR1cm57YnJvd3NlcjpiWzFdfHxcIlwiLHZlcnNpb246YlsyXXx8XCIwXCJ9fSxzdWI6ZnVuY3Rpb24oKXtmdW5jdGlvbiBhKGIsYyl7cmV0dXJuIG5ldyBhLmZuLmluaXQoYixjKX1lLmV4dGVuZCh0cnVlLGEsdGhpcyk7YS5zdXBlcmNsYXNzPXRoaXM7YS5mbj1hLnByb3RvdHlwZT10aGlzKCk7YS5mbi5jb25zdHJ1Y3Rvcj1hO2Euc3ViPXRoaXMuc3ViO2EuZm4uaW5pdD1mdW5jdGlvbiBkKGMsZCl7aWYoZCYmZCBpbnN0YW5jZW9mIGUmJiEoZCBpbnN0YW5jZW9mIGEpKXtkPWEoZCl9cmV0dXJuIGUuZm4uaW5pdC5jYWxsKHRoaXMsYyxkLGIpfTthLmZuLmluaXQucHJvdG90eXBlPWEuZm47dmFyIGI9YShjKTtyZXR1cm4gYX0sYnJvd3Nlcjp7fX0pO2UuZWFjaChcIkJvb2xlYW4gTnVtYmVyIFN0cmluZyBGdW5jdGlvbiBBcnJheSBEYXRlIFJlZ0V4cCBPYmplY3RcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtJW1wiW29iamVjdCBcIitiK1wiXVwiXT1iLnRvTG93ZXJDYXNlKCl9KTt6PWUudWFNYXRjaCh5KTtpZih6LmJyb3dzZXIpe2UuYnJvd3Nlclt6LmJyb3dzZXJdPXRydWU7ZS5icm93c2VyLnZlcnNpb249ei52ZXJzaW9ufWlmKGUuYnJvd3Nlci53ZWJraXQpe2UuYnJvd3Nlci5zYWZhcmk9dHJ1ZX1pZihqLnRlc3QoXCLCoFwiKSl7az0vXltcXHNcXHhBMF0rLztsPS9bXFxzXFx4QTBdKyQvfWg9ZShjKTtpZihjLmFkZEV2ZW50TGlzdGVuZXIpe0I9ZnVuY3Rpb24oKXtjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7ZS5yZWFkeSgpfX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe0I9ZnVuY3Rpb24oKXtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe2MuZGV0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTtlLnJlYWR5KCl9fX1yZXR1cm4gZX0oKTt2YXIgZz1cImRvbmUgZmFpbCBpc1Jlc29sdmVkIGlzUmVqZWN0ZWQgcHJvbWlzZSB0aGVuIGFsd2F5cyBwaXBlXCIuc3BsaXQoXCIgXCIpLGg9W10uc2xpY2U7Zi5leHRlbmQoe19EZWZlcnJlZDpmdW5jdGlvbigpe3ZhciBhPVtdLGIsYyxkLGU9e2RvbmU6ZnVuY3Rpb24oKXtpZighZCl7dmFyIGM9YXJndW1lbnRzLGcsaCxpLGosaztpZihiKXtrPWI7Yj0wfWZvcihnPTAsaD1jLmxlbmd0aDtnPGg7ZysrKXtpPWNbZ107aj1mLnR5cGUoaSk7aWYoaj09PVwiYXJyYXlcIil7ZS5kb25lLmFwcGx5KGUsaSl9ZWxzZSBpZihqPT09XCJmdW5jdGlvblwiKXthLnB1c2goaSl9fWlmKGspe2UucmVzb2x2ZVdpdGgoa1swXSxrWzFdKX19cmV0dXJuIHRoaXN9LHJlc29sdmVXaXRoOmZ1bmN0aW9uKGUsZil7aWYoIWQmJiFiJiYhYyl7Zj1mfHxbXTtjPTE7dHJ5e3doaWxlKGFbMF0pe2Euc2hpZnQoKS5hcHBseShlLGYpfX1maW5hbGx5e2I9W2UsZl07Yz0wfX1yZXR1cm4gdGhpc30scmVzb2x2ZTpmdW5jdGlvbigpe2UucmVzb2x2ZVdpdGgodGhpcyxhcmd1bWVudHMpO3JldHVybiB0aGlzfSxpc1Jlc29sdmVkOmZ1bmN0aW9uKCl7cmV0dXJuISEoY3x8Yil9LGNhbmNlbDpmdW5jdGlvbigpe2Q9MTthPVtdO3JldHVybiB0aGlzfX07cmV0dXJuIGV9LERlZmVycmVkOmZ1bmN0aW9uKGEpe3ZhciBiPWYuX0RlZmVycmVkKCksYz1mLl9EZWZlcnJlZCgpLGQ7Zi5leHRlbmQoYix7dGhlbjpmdW5jdGlvbihhLGMpe2IuZG9uZShhKS5mYWlsKGMpO3JldHVybiB0aGlzfSxhbHdheXM6ZnVuY3Rpb24oKXtyZXR1cm4gYi5kb25lLmFwcGx5KGIsYXJndW1lbnRzKS5mYWlsLmFwcGx5KHRoaXMsYXJndW1lbnRzKX0sZmFpbDpjLmRvbmUscmVqZWN0V2l0aDpjLnJlc29sdmVXaXRoLHJlamVjdDpjLnJlc29sdmUsaXNSZWplY3RlZDpjLmlzUmVzb2x2ZWQscGlwZTpmdW5jdGlvbihhLGMpe3JldHVybiBmLkRlZmVycmVkKGZ1bmN0aW9uKGQpe2YuZWFjaCh7ZG9uZTpbYSxcInJlc29sdmVcIl0sZmFpbDpbYyxcInJlamVjdFwiXX0sZnVuY3Rpb24oYSxjKXt2YXIgZT1jWzBdLGc9Y1sxXSxoO2lmKGYuaXNGdW5jdGlvbihlKSl7YlthXShmdW5jdGlvbigpe2g9ZS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7aWYoaCYmZi5pc0Z1bmN0aW9uKGgucHJvbWlzZSkpe2gucHJvbWlzZSgpLnRoZW4oZC5yZXNvbHZlLGQucmVqZWN0KX1lbHNle2RbZytcIldpdGhcIl0odGhpcz09PWI/ZDp0aGlzLFtoXSl9fSl9ZWxzZXtiW2FdKGRbZ10pfX0pfSkucHJvbWlzZSgpfSxwcm9taXNlOmZ1bmN0aW9uKGEpe2lmKGE9PW51bGwpe2lmKGQpe3JldHVybiBkfWQ9YT17fX12YXIgYz1nLmxlbmd0aDt3aGlsZShjLS0pe2FbZ1tjXV09YltnW2NdXX1yZXR1cm4gYX19KTtiLmRvbmUoYy5jYW5jZWwpLmZhaWwoYi5jYW5jZWwpO2RlbGV0ZSBiLmNhbmNlbDtpZihhKXthLmNhbGwoYixiKX1yZXR1cm4gYn0sd2hlbjpmdW5jdGlvbihhKXtmdW5jdGlvbiBpKGEpe3JldHVybiBmdW5jdGlvbihjKXtiW2FdPWFyZ3VtZW50cy5sZW5ndGg+MT9oLmNhbGwoYXJndW1lbnRzLDApOmM7aWYoIS0tZSl7Zy5yZXNvbHZlV2l0aChnLGguY2FsbChiLDApKX19fXZhciBiPWFyZ3VtZW50cyxjPTAsZD1iLmxlbmd0aCxlPWQsZz1kPD0xJiZhJiZmLmlzRnVuY3Rpb24oYS5wcm9taXNlKT9hOmYuRGVmZXJyZWQoKTtpZihkPjEpe2Zvcig7YzxkO2MrKyl7aWYoYltjXSYmZi5pc0Z1bmN0aW9uKGJbY10ucHJvbWlzZSkpe2JbY10ucHJvbWlzZSgpLnRoZW4oaShjKSxnLnJlamVjdCl9ZWxzZXstLWV9fWlmKCFlKXtnLnJlc29sdmVXaXRoKGcsYil9fWVsc2UgaWYoZyE9PWEpe2cucmVzb2x2ZVdpdGgoZyxkP1thXTpbXSl9cmV0dXJuIGcucHJvbWlzZSgpfX0pO2Yuc3VwcG9ydD1mLnN1cHBvcnR8fHt9O3ZhciBpPS8lMjAvZyxqPS9cXFtcXF0kLyxrPS9cXHI/XFxuL2csbD0vIy4qJC8sbT0vXiguKj8pOlsgXFx0XSooW15cXHJcXG5dKilcXHI/JC9tZyxuPS9eKD86Y29sb3J8ZGF0ZXxkYXRldGltZXxlbWFpbHxoaWRkZW58bW9udGh8bnVtYmVyfHBhc3N3b3JkfHJhbmdlfHNlYXJjaHx0ZWx8dGV4dHx0aW1lfHVybHx3ZWVrKSQvaSxvPS9eKD86YWJvdXR8YXBwfGFwcFxcLXN0b3JhZ2V8LitcXC1leHRlbnNpb258ZmlsZXxyZXN8d2lkZ2V0KTokLyxwPS9eKD86R0VUfEhFQUQpJC8scT0vXlxcL1xcLy8scj0vXFw/LyxzPS88c2NyaXB0XFxiW148XSooPzooPyE8XFwvc2NyaXB0Pik8W148XSopKjxcXC9zY3JpcHQ+L2dpLHQ9L14oPzpzZWxlY3R8dGV4dGFyZWEpL2ksdT0vXFxzKy8sdj0vKFs/Jl0pXz1bXiZdKi8sdz0vXihbXFx3XFwrXFwuXFwtXSs6KSg/OlxcL1xcLyhbXlxcLz8jOl0qKSg/OjooXFxkKykpPyk/Lyx4PWYuZm4ubG9hZCx5PXt9LHo9e30sQSxCO3RyeXtBPWUuaHJlZn1jYXRjaChDKXtBPWMuY3JlYXRlRWxlbWVudChcImFcIik7QS5ocmVmPVwiXCI7QT1BLmhyZWZ9Qj13LmV4ZWMoQS50b0xvd2VyQ2FzZSgpKXx8W107Zi5mbi5leHRlbmQoe2xvYWQ6ZnVuY3Rpb24oYSxjLGQpe2lmKHR5cGVvZiBhIT09XCJzdHJpbmdcIiYmeCl7cmV0dXJuIHguYXBwbHkodGhpcyxhcmd1bWVudHMpfWVsc2UgaWYoIXRoaXMubGVuZ3RoKXtyZXR1cm4gdGhpc312YXIgZT1hLmluZGV4T2YoXCIgXCIpO2lmKGU+PTApe3ZhciBnPWEuc2xpY2UoZSxhLmxlbmd0aCk7YT1hLnNsaWNlKDAsZSl9dmFyIGg9XCJHRVRcIjtpZihjKXtpZihmLmlzRnVuY3Rpb24oYykpe2Q9YztjPWJ9ZWxzZSBpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2M9Zi5wYXJhbShjLGYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsKTtoPVwiUE9TVFwifX12YXIgaT10aGlzO2YuYWpheCh7dXJsOmEsdHlwZTpoLGRhdGFUeXBlOlwiaHRtbFwiLGRhdGE6Yyxjb21wbGV0ZTpmdW5jdGlvbihhLGIsYyl7Yz1hLnJlc3BvbnNlVGV4dDtpZihhLmlzUmVzb2x2ZWQoKSl7YS5kb25lKGZ1bmN0aW9uKGEpe2M9YX0pO2kuaHRtbChnP2YoXCI8ZGl2PlwiKS5hcHBlbmQoYy5yZXBsYWNlKHMsXCJcIikpLmZpbmQoZyk6Yyl9aWYoZCl7aS5lYWNoKGQsW2MsYixhXSl9fX0pO3JldHVybiB0aGlzfSxzZXJpYWxpemU6ZnVuY3Rpb24oKXtyZXR1cm4gZi5wYXJhbSh0aGlzLnNlcmlhbGl6ZUFycmF5KCkpfSxzZXJpYWxpemVBcnJheTpmdW5jdGlvbigpe3JldHVybiB0aGlzLm1hcChmdW5jdGlvbigpe3JldHVybiB0aGlzLmVsZW1lbnRzP2YubWFrZUFycmF5KHRoaXMuZWxlbWVudHMpOnRoaXN9KS5maWx0ZXIoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5uYW1lJiYhdGhpcy5kaXNhYmxlZCYmKHRoaXMuY2hlY2tlZHx8dC50ZXN0KHRoaXMubm9kZU5hbWUpfHxuLnRlc3QodGhpcy50eXBlKSl9KS5tYXAoZnVuY3Rpb24oYSxiKXt2YXIgYz1mKHRoaXMpLnZhbCgpO3JldHVybiBjPT1udWxsP251bGw6Zi5pc0FycmF5KGMpP2YubWFwKGMsZnVuY3Rpb24oYSxjKXtyZXR1cm57bmFtZTpiLm5hbWUsdmFsdWU6YS5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSk6e25hbWU6Yi5uYW1lLHZhbHVlOmMucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pLmdldCgpfX0pO2YuZWFjaChcImFqYXhTdGFydCBhamF4U3RvcCBhamF4Q29tcGxldGUgYWpheEVycm9yIGFqYXhTdWNjZXNzIGFqYXhTZW5kXCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7Zi5mbltiXT1mdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5iaW5kKGIsYSl9fSk7Zi5lYWNoKFtcImdldFwiLFwicG9zdFwiXSxmdW5jdGlvbihhLGMpe2ZbY109ZnVuY3Rpb24oYSxkLGUsZyl7aWYoZi5pc0Z1bmN0aW9uKGQpKXtnPWd8fGU7ZT1kO2Q9Yn1yZXR1cm4gZi5hamF4KHt0eXBlOmMsdXJsOmEsZGF0YTpkLHN1Y2Nlc3M6ZSxkYXRhVHlwZTpnfSl9fSk7Zi5leHRlbmQoe2dldFNjcmlwdDpmdW5jdGlvbihhLGMpe3JldHVybiBmLmdldChhLGIsYyxcInNjcmlwdFwiKX0sZ2V0SlNPTjpmdW5jdGlvbihhLGIsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwianNvblwiKX0sYWpheFNldHVwOmZ1bmN0aW9uKGEsYil7aWYoYil7RihhLGYuYWpheFNldHRpbmdzKX1lbHNle2I9YTthPWYuYWpheFNldHRpbmdzfUYoYSxiKTtyZXR1cm4gYX0sYWpheFNldHRpbmdzOnt1cmw6QSxpc0xvY2FsOm8udGVzdChCWzFdKSxnbG9iYWw6dHJ1ZSx0eXBlOlwiR0VUXCIsY29udGVudFR5cGU6XCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixwcm9jZXNzRGF0YTp0cnVlLGFzeW5jOnRydWUsYWNjZXB0czp7eG1sOlwiYXBwbGljYXRpb24veG1sLCB0ZXh0L3htbFwiLGh0bWw6XCJ0ZXh0L2h0bWxcIix0ZXh0OlwidGV4dC9wbGFpblwiLGpzb246XCJhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L2phdmFzY3JpcHRcIixcIipcIjpcIiovKlwifSxjb250ZW50czp7eG1sOi94bWwvLGh0bWw6L2h0bWwvLGpzb246L2pzb24vfSxyZXNwb25zZUZpZWxkczp7eG1sOlwicmVzcG9uc2VYTUxcIix0ZXh0OlwicmVzcG9uc2VUZXh0XCJ9LGNvbnZlcnRlcnM6e1wiKiB0ZXh0XCI6YS5TdHJpbmcsXCJ0ZXh0IGh0bWxcIjp0cnVlLFwidGV4dCBqc29uXCI6Zi5wYXJzZUpTT04sXCJ0ZXh0IHhtbFwiOmYucGFyc2VYTUx9LGZsYXRPcHRpb25zOntjb250ZXh0OnRydWUsdXJsOnRydWV9fSxhamF4UHJlZmlsdGVyOkQoeSksYWpheFRyYW5zcG9ydDpEKHopLGFqYXg6ZnVuY3Rpb24oYSxjKXtmdW5jdGlvbiBLKGEsYyxsLG0pe2lmKEQ9PT0yKXtyZXR1cm59RD0yO2lmKEEpe2NsZWFyVGltZW91dChBKX14PWI7cz1tfHxcIlwiO0oucmVhZHlTdGF0ZT1hPjA/NDowO3ZhciBuLG8scCxxPWMscj1sP0goZCxKLGwpOmIsdCx1O2lmKGE+PTIwMCYmYTwzMDB8fGE9PT0zMDQpe2lmKGQuaWZNb2RpZmllZCl7aWYodD1KLmdldFJlc3BvbnNlSGVhZGVyKFwiTGFzdC1Nb2RpZmllZFwiKSl7Zi5sYXN0TW9kaWZpZWRba109dH1pZih1PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJFdGFnXCIpKXtmLmV0YWdba109dX19aWYoYT09PTMwNCl7cT1cIm5vdG1vZGlmaWVkXCI7bj10cnVlfWVsc2V7dHJ5e289SShkLHIpO3E9XCJzdWNjZXNzXCI7bj10cnVlfWNhdGNoKHYpe3E9XCJwYXJzZXJlcnJvclwiO3A9dn19fWVsc2V7cD1xO2lmKCFxfHxhKXtxPVwiZXJyb3JcIjtpZihhPDApe2E9MH19fUouc3RhdHVzPWE7Si5zdGF0dXNUZXh0PVwiXCIrKGN8fHEpO2lmKG4pe2gucmVzb2x2ZVdpdGgoZSxbbyxxLEpdKX1lbHNle2gucmVqZWN0V2l0aChlLFtKLHEscF0pfUouc3RhdHVzQ29kZShqKTtqPWI7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFwiKyhuP1wiU3VjY2Vzc1wiOlwiRXJyb3JcIiksW0osZCxuP286cF0pfWkucmVzb2x2ZVdpdGgoZSxbSixxXSk7aWYoRil7Zy50cmlnZ2VyKFwiYWpheENvbXBsZXRlXCIsW0osZF0pO2lmKCEtLWYuYWN0aXZlKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RvcFwiKX19fWlmKHR5cGVvZiBhPT09XCJvYmplY3RcIil7Yz1hO2E9Yn1jPWN8fHt9O3ZhciBkPWYuYWpheFNldHVwKHt9LGMpLGU9ZC5jb250ZXh0fHxkLGc9ZSE9PWQmJihlLm5vZGVUeXBlfHxlIGluc3RhbmNlb2YgZik/ZihlKTpmLmV2ZW50LGg9Zi5EZWZlcnJlZCgpLGk9Zi5fRGVmZXJyZWQoKSxqPWQuc3RhdHVzQ29kZXx8e30sayxuPXt9LG89e30scyx0LHgsQSxDLEQ9MCxGLEcsSj17cmVhZHlTdGF0ZTowLHNldFJlcXVlc3RIZWFkZXI6ZnVuY3Rpb24oYSxiKXtpZighRCl7dmFyIGM9YS50b0xvd2VyQ2FzZSgpO2E9b1tjXT1vW2NdfHxhO25bYV09Yn1yZXR1cm4gdGhpc30sZ2V0QWxsUmVzcG9uc2VIZWFkZXJzOmZ1bmN0aW9uKCl7cmV0dXJuIEQ9PT0yP3M6bnVsbH0sZ2V0UmVzcG9uc2VIZWFkZXI6ZnVuY3Rpb24oYSl7dmFyIGM7aWYoRD09PTIpe2lmKCF0KXt0PXt9O3doaWxlKGM9bS5leGVjKHMpKXt0W2NbMV0udG9Mb3dlckNhc2UoKV09Y1syXX19Yz10W2EudG9Mb3dlckNhc2UoKV19cmV0dXJuIGM9PT1iP251bGw6Y30sb3ZlcnJpZGVNaW1lVHlwZTpmdW5jdGlvbihhKXtpZighRCl7ZC5taW1lVHlwZT1hfXJldHVybiB0aGlzfSxhYm9ydDpmdW5jdGlvbihhKXthPWF8fFwiYWJvcnRcIjtpZih4KXt4LmFib3J0KGEpfUsoMCxhKTtyZXR1cm4gdGhpc319O2gucHJvbWlzZShKKTtKLnN1Y2Nlc3M9Si5kb25lO0ouZXJyb3I9Si5mYWlsO0ouY29tcGxldGU9aS5kb25lO0ouc3RhdHVzQ29kZT1mdW5jdGlvbihhKXtpZihhKXt2YXIgYjtpZihEPDIpe2ZvcihiIGluIGEpe2pbYl09W2pbYl0sYVtiXV19fWVsc2V7Yj1hW0ouc3RhdHVzXTtKLnRoZW4oYixiKX19cmV0dXJuIHRoaXN9O2QudXJsPSgoYXx8ZC51cmwpK1wiXCIpLnJlcGxhY2UobCxcIlwiKS5yZXBsYWNlKHEsQlsxXStcIi8vXCIpO2QuZGF0YVR5cGVzPWYudHJpbShkLmRhdGFUeXBlfHxcIipcIikudG9Mb3dlckNhc2UoKS5zcGxpdCh1KTtpZihkLmNyb3NzRG9tYWluPT1udWxsKXtDPXcuZXhlYyhkLnVybC50b0xvd2VyQ2FzZSgpKTtkLmNyb3NzRG9tYWluPSEhKEMmJihDWzFdIT1CWzFdfHxDWzJdIT1CWzJdfHwoQ1szXXx8KENbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkhPShCWzNdfHwoQlsxXT09PVwiaHR0cDpcIj84MDo0NDMpKSkpfWlmKGQuZGF0YSYmZC5wcm9jZXNzRGF0YSYmdHlwZW9mIGQuZGF0YSE9PVwic3RyaW5nXCIpe2QuZGF0YT1mLnBhcmFtKGQuZGF0YSxkLnRyYWRpdGlvbmFsKX1FKHksZCxjLEopO2lmKEQ9PT0yKXtyZXR1cm4gZmFsc2V9Rj1kLmdsb2JhbDtkLnR5cGU9ZC50eXBlLnRvVXBwZXJDYXNlKCk7ZC5oYXNDb250ZW50PSFwLnRlc3QoZC50eXBlKTtpZihGJiZmLmFjdGl2ZSsrPT09MCl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0YXJ0XCIpfWlmKCFkLmhhc0NvbnRlbnQpe2lmKGQuZGF0YSl7ZC51cmwrPShyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStkLmRhdGE7ZGVsZXRlIGQuZGF0YX1rPWQudXJsO2lmKGQuY2FjaGU9PT1mYWxzZSl7dmFyIEw9Zi5ub3coKSxNPWQudXJsLnJlcGxhY2UodixcIiQxXz1cIitMKTtkLnVybD1NKyhNPT09ZC51cmw/KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK1wiXz1cIitMOlwiXCIpfX1pZihkLmRhdGEmJmQuaGFzQ29udGVudCYmZC5jb250ZW50VHlwZSE9PWZhbHNlfHxjLmNvbnRlbnRUeXBlKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJDb250ZW50LVR5cGVcIixkLmNvbnRlbnRUeXBlKX1pZihkLmlmTW9kaWZpZWQpe2s9a3x8ZC51cmw7aWYoZi5sYXN0TW9kaWZpZWRba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU1vZGlmaWVkLVNpbmNlXCIsZi5sYXN0TW9kaWZpZWRba10pfWlmKGYuZXRhZ1trXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTm9uZS1NYXRjaFwiLGYuZXRhZ1trXSl9fUouc2V0UmVxdWVzdEhlYWRlcihcIkFjY2VwdFwiLGQuZGF0YVR5cGVzWzBdJiZkLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dP2QuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0rKGQuZGF0YVR5cGVzWzBdIT09XCIqXCI/XCIsICovKjsgcT0wLjAxXCI6XCJcIik6ZC5hY2NlcHRzW1wiKlwiXSk7Zm9yKEcgaW4gZC5oZWFkZXJzKXtKLnNldFJlcXVlc3RIZWFkZXIoRyxkLmhlYWRlcnNbR10pfWlmKGQuYmVmb3JlU2VuZCYmKGQuYmVmb3JlU2VuZC5jYWxsKGUsSixkKT09PWZhbHNlfHxEPT09Mikpe0ouYWJvcnQoKTtyZXR1cm4gZmFsc2V9Zm9yKEcgaW57c3VjY2VzczoxLGVycm9yOjEsY29tcGxldGU6MX0pe0pbR10oZFtHXSl9eD1FKHosZCxjLEopO2lmKCF4KXtLKC0xLFwiTm8gVHJhbnNwb3J0XCIpfWVsc2V7Si5yZWFkeVN0YXRlPTE7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFNlbmRcIixbSixkXSl9aWYoZC5hc3luYyYmZC50aW1lb3V0PjApe0E9c2V0VGltZW91dChmdW5jdGlvbigpe0ouYWJvcnQoXCJ0aW1lb3V0XCIpfSxkLnRpbWVvdXQpfXRyeXtEPTE7eC5zZW5kKG4sSyl9Y2F0Y2goTil7aWYoRDwyKXtLKC0xLE4pfWVsc2V7Zi5lcnJvcihOKX19fXJldHVybiBKfSxwYXJhbTpmdW5jdGlvbihhLGMpe3ZhciBkPVtdLGU9ZnVuY3Rpb24oYSxiKXtiPWYuaXNGdW5jdGlvbihiKT9iKCk6YjtkW2QubGVuZ3RoXT1lbmNvZGVVUklDb21wb25lbnQoYSkrXCI9XCIrZW5jb2RlVVJJQ29tcG9uZW50KGIpfTtpZihjPT09Yil7Yz1mLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbH1pZihmLmlzQXJyYXkoYSl8fGEuanF1ZXJ5JiYhZi5pc1BsYWluT2JqZWN0KGEpKXtmLmVhY2goYSxmdW5jdGlvbigpe2UodGhpcy5uYW1lLHRoaXMudmFsdWUpfSl9ZWxzZXtmb3IodmFyIGcgaW4gYSl7RyhnLGFbZ10sYyxlKX19cmV0dXJuIGQuam9pbihcIiZcIikucmVwbGFjZShpLFwiK1wiKX19KTtmLmV4dGVuZCh7YWN0aXZlOjAsbGFzdE1vZGlmaWVkOnt9LGV0YWc6e319KTt2YXIgSj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtmb3IodmFyIGEgaW4gTCl7TFthXSgwLDEpfX06ZmFsc2UsSz0wLEw7Zi5hamF4U2V0dGluZ3MueGhyPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe3JldHVybiF0aGlzLmlzTG9jYWwmJk0oKXx8TigpfTpNOyhmdW5jdGlvbihhKXtmLmV4dGVuZChmLnN1cHBvcnQse2FqYXg6ISFhLGNvcnM6ISFhJiZcIndpdGhDcmVkZW50aWFsc1wiaW4gYX0pfSkoZi5hamF4U2V0dGluZ3MueGhyKCkpO2lmKGYuc3VwcG9ydC5hamF4KXtmLmFqYXhUcmFuc3BvcnQoZnVuY3Rpb24oYyl7aWYoIWMuY3Jvc3NEb21haW58fGYuc3VwcG9ydC5jb3JzKXt2YXIgZDtyZXR1cm57c2VuZDpmdW5jdGlvbihlLGcpe3ZhciBoPWMueGhyKCksaSxqO2lmKGMudXNlcm5hbWUpe2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyxjLnVzZXJuYW1lLGMucGFzc3dvcmQpfWVsc2V7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jKX1pZihjLnhockZpZWxkcyl7Zm9yKGogaW4gYy54aHJGaWVsZHMpe2hbal09Yy54aHJGaWVsZHNbal19fWlmKGMubWltZVR5cGUmJmgub3ZlcnJpZGVNaW1lVHlwZSl7aC5vdmVycmlkZU1pbWVUeXBlKGMubWltZVR5cGUpfWlmKCFjLmNyb3NzRG9tYWluJiYhZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl0pe2VbXCJYLVJlcXVlc3RlZC1XaXRoXCJdPVwiWE1MSHR0cFJlcXVlc3RcIn10cnl7Zm9yKGogaW4gZSl7aC5zZXRSZXF1ZXN0SGVhZGVyKGosZVtqXSl9fWNhdGNoKGspe31oLnNlbmQoYy5oYXNDb250ZW50JiZjLmRhdGF8fG51bGwpO2Q9ZnVuY3Rpb24oYSxlKXt2YXIgaixrLGwsbSxuO3RyeXtpZihkJiYoZXx8aC5yZWFkeVN0YXRlPT09NCkpe2Q9YjtpZihpKXtoLm9ucmVhZHlzdGF0ZWNoYW5nZT1mLm5vb3A7aWYoSil7ZGVsZXRlIExbaV19fWlmKGUpe2lmKGgucmVhZHlTdGF0ZSE9PTQpe2guYWJvcnQoKX19ZWxzZXtqPWguc3RhdHVzO2w9aC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKTttPXt9O249aC5yZXNwb25zZVhNTDtpZihuJiZuLmRvY3VtZW50RWxlbWVudCl7bS54bWw9bn1tLnRleHQ9aC5yZXNwb25zZVRleHQ7dHJ5e2s9aC5zdGF0dXNUZXh0fWNhdGNoKG8pe2s9XCJcIn1pZighaiYmYy5pc0xvY2FsJiYhYy5jcm9zc0RvbWFpbil7aj1tLnRleHQ/MjAwOjQwNH1lbHNlIGlmKGo9PT0xMjIzKXtqPTIwNH19fX1jYXRjaChwKXtpZighZSl7ZygtMSxwKX19aWYobSl7ZyhqLGssbSxsKX19O2lmKCFjLmFzeW5jfHxoLnJlYWR5U3RhdGU9PT00KXtkKCl9ZWxzZXtpPSsrSztpZihKKXtpZighTCl7TD17fTtmKGEpLnVubG9hZChKKX1MW2ldPWR9aC5vbnJlYWR5c3RhdGVjaGFuZ2U9ZH19LGFib3J0OmZ1bmN0aW9uKCl7aWYoZCl7ZCgwLDEpfX19fX0pfWYuYWpheFNldHRpbmdzLmdsb2JhbD1mYWxzZTthLmpRdWVyeT1hLiQ9Zn0pKGdsb2JhbCl9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQkFNIGZvcm1hdDogaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZTtcbnZhciBQYWlyZWRJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL1BhaXJlZEludGVydmFsVHJlZS5qcycpLlBhaXJlZEludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxudmFyIEJhbUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjaHJvbW9zb21lczogJycsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3I6ICcxODgsMTg4LDE4OCcsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiAyMDAwLCBwYWNrOiAyMDAwfSxcbiAgICAvLyBJZiBhIG51Y2xlb3RpZGUgZGlmZmVycyBmcm9tIHRoZSByZWZlcmVuY2Ugc2VxdWVuY2UgaW4gZ3JlYXRlciB0aGFuIDIwJSBvZiBxdWFsaXR5IHdlaWdodGVkIHJlYWRzLCBcbiAgICAvLyBJR1YgY29sb3JzIHRoZSBiYXIgaW4gcHJvcG9ydGlvbiB0byB0aGUgcmVhZCBjb3VudCBvZiBlYWNoIGJhc2U7IHRoZSBmb2xsb3dpbmcgY2hhbmdlcyB0aGF0IHRocmVzaG9sZCBmb3IgY2hyb21vem9vbVxuICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQ6IDAuMixcbiAgICBvcHRpbWFsRmV0Y2hXaW5kb3c6IDAsXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDAsXG4gICAgLy8gVGhlIGZvbGxvd2luZyBjYW4gYmUgXCJlbnNlbWJsX3Vjc2NcIiBvciBcInVjc2NfZW5zZW1ibFwiIHRvIGF0dGVtcHQgYXV0by1jcm9zc21hcHBpbmcgb2YgcmVmZXJlbmNlIGNvbnRpZyBuYW1lc1xuICAgIC8vIGJldHdlZW4gdGhlIHR3byBzY2hlbWVzLCB3aGljaCBJR1YgZG9lcywgYnV0IGlzIGEgcGVyZW5uaWFsIGlzc3VlOiBodHRwczovL3d3dy5iaW9zdGFycy5vcmcvcC8xMDA2Mi9cbiAgICAvLyBJIGhvcGUgbm90IHRvIG5lZWQgYWxsIHRoZSBtYXBwaW5ncyBpbiBoZXJlIGh0dHBzOi8vZ2l0aHViLmNvbS9kcHJ5YW43OS9DaHJvbW9zb21lTWFwcGluZ3MgYnV0IGl0IG1heSBiZSBuZWNlc3NhcnlcbiAgICBjb252ZXJ0Q2hyU2NoZW1lOiBcImF1dG9cIixcbiAgICAvLyBEcmF3IHBhaXJlZCBlbmRzIHdpdGhpbiBhIHJhbmdlIG9mIGV4cGVjdGVkIGluc2VydCBzaXplcyBhcyBhIGNvbnRpbnVvdXMgZmVhdHVyZT9cbiAgICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI3BhaXJlZCBmb3IgaG93IHRoaXMgd29ya3NcbiAgICB2aWV3QXNQYWlyczogZmFsc2UsXG4gICAgZXhwZWN0ZWRJbnNlcnRTaXplUGVyY2VudGlsZXM6IFswLjAwNSwgMC45OTVdXG4gIH0sXG4gIFxuICAvLyBUaGUgRkxBRyBjb2x1bW4gZm9yIEJBTS9TQU0gaXMgYSBjb21iaW5hdGlvbiBvZiBiaXR3aXNlIGZsYWdzXG4gIGZsYWdzOiB7XG4gICAgaXNSZWFkUGFpcmVkOiAweDEsXG4gICAgaXNSZWFkUHJvcGVybHlBbGlnbmVkOiAweDIsXG4gICAgaXNSZWFkVW5tYXBwZWQ6IDB4NCxcbiAgICBpc01hdGVVbm1hcHBlZDogMHg4LFxuICAgIHJlYWRTdHJhbmRSZXZlcnNlOiAweDEwLFxuICAgIG1hdGVTdHJhbmRSZXZlcnNlOiAweDIwLFxuICAgIGlzUmVhZEZpcnN0T2ZQYWlyOiAweDQwLFxuICAgIGlzUmVhZExhc3RPZlBhaXI6IDB4ODAsXG4gICAgaXNTZWNvbmRhcnlBbGlnbm1lbnQ6IDB4MTAwLFxuICAgIGlzUmVhZEZhaWxpbmdWZW5kb3JRQzogMHgyMDAsXG4gICAgaXNEdXBsaWNhdGVSZWFkOiAweDQwMCxcbiAgICBpc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQ6IDB4ODAwXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGJyb3dzZXJDaHJzID0gXy5rZXlzKHRoaXMuYnJvd3Nlck9wdHMpO1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgQkFNIHRyYWNrIGF0IFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLmJyb3dzZXJDaHJTY2hlbWUgPSB0aGlzLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoXy5rZXlzKHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zKSk7XG4gIH0sXG4gIFxuICAvLyBUT0RPOiBJZiB0aGUgcGFpcmluZyBpbnRlcnZhbCBjaGFuZ2VkLCB3ZSBzaG91bGQgdG9zcyB0aGUgZW50aXJlIGNhY2hlIGFuZCByZXNldCB0aGUgUmVtb3RlVHJhY2sgYmlucyxcbiAgLy8gICAgICAgICAqYW5kKiBibG93IHVwIHRoZSBhcmVhSW5kZXguXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHM7XG4gICAgLy8gV2hlbiB3ZSBjaGFuZ2Ugb3B0cy52aWV3QXNQYWlycywgd2UgKm5lZWQqIHRvIHRocm93IG91dCB0aGlzLmRhdGEucGlsZXVwLlxuICAgIGlmIChvLnZpZXdBc1BhaXJzICE9IHRoaXMucHJldk9wdHMudmlld0FzUGFpcnMgJiYgdGhpcy5kYXRhICYmIHRoaXMuZGF0YS5waWxldXApIHsgXG4gICAgICB0aGlzLmRhdGEucGlsZXVwID0ge307XG4gICAgfVxuICAgIHRoaXMucHJldk9wdHMgPSBkZWVwQ2xvbmUodGhpcy5vcHRzKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSwgXG4gICAgICAgICAge3N0YXJ0S2V5OiAndGVtcGxhdGVTdGFydCcsIGVuZEtleTogJ3RlbXBsYXRlRW5kJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbicsIHBhaXJpbmdLZXk6ICdxbmFtZSd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiYW0ucGhwJyxcbiAgICAgIGluZm9DaHJSYW5nZSA9IHNlbGYuY2hyUmFuZ2UoTWF0aC5yb3VuZChzZWxmLmJyb3dzZXJPcHRzLnBvcyksIE1hdGgucm91bmQoc2VsZi5icm93c2VyT3B0cy5wb3MgKyAxMDAwMCkpLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lID09IFwiYXV0b1wiID8gc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA6IG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL15jaHIvLCAnJyk7IH0pOyBicmVhaztcbiAgICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eKFxcZFxcZD98WCk6LywgJ2NociQxOicpOyB9KTsgYnJlYWs7XG4gICAgICB9XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBQYXJzZSB0aGUgU0FNIGZvcm1hdCBpbnRvIGludGVydmFscyB0aGF0IGNhbiBiZSBpbnNlcnRlZCBpbnRvIHRoZSBJbnRlcnZhbFRyZWUgY2FjaGVcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7IH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlLCBwaWxldXA6IHt9LCBpbmZvOiB7fX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAyNCwgc3RhcnQ6IDI0fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBzZWxmLm5vQXJlYUxhYmVscyA9IHRydWU7XG4gICAgc2VsZi5leHBlY3RzU2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3MgPSB7fTtcbiAgICBzZWxmLnByZXZPcHRzID0gZGVlcENsb25lKG8pOyAgLy8gdXNlZCB0byBkZXRlY3Qgd2hpY2ggZHJhd2luZyBvcHRpb25zIGhhdmUgYmVlbiBjaGFuZ2VkIGJ5IHRoZSB1c2VyXG4gICAgXG4gICAgLy8gR2V0IGdlbmVyYWwgaW5mbyBvbiB0aGUgYmFtIChlLmcuIGBzYW10b29scyBpZHhzdGF0c2ApLCB1c2UgbWFwcGVkIHJlYWRzIHBlciByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgICAvLyB0byBlc3RpbWF0ZSBtYXhGZXRjaFdpbmRvdyBhbmQgb3B0aW1hbEZldGNoV2luZG93LCBhbmQgc2V0dXAgYmlubmluZyBvbiB0aGUgUmVtb3RlVHJhY2suXG4gICAgLy8gV2UgYWxzbyBmZXRjaCBhIGJ1bmNoIG9mIHJlYWRzIGZyb20gYXJvdW5kIGluZm9DaHJSYW5nZSAoYnkgZGVmYXVsdCwgd2hlcmUgdGhlIGJyb3dzZXIgaXMgd2hlblxuICAgIC8vIGl0IGZpcnN0IGxvYWRzIHRoaXMgdHJhY2spIHRvIGVzdGltYXRlIG1lYW5JdGVtTGVuZ3RoLCBtYXRlIHBhaXJpbmcsIGFuZCB0aGUgaW5zZXJ0IHNpemUgZGlzdHJpYnV0aW9uLlxuICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICBkYXRhOiB7cmFuZ2U6IGluZm9DaHJSYW5nZSwgdXJsOiBvLmJpZ0RhdGFVcmwsIGluZm86IDF9LFxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICB2YXIgbWFwcGVkUmVhZHMgPSAwLFxuICAgICAgICAgIG1heEl0ZW1zVG9EcmF3ID0gXy5tYXgoXy52YWx1ZXMoby5kcmF3TGltaXQpKSxcbiAgICAgICAgICBiYW1DaHJzID0gW10sXG4gICAgICAgICAgaW5mb1BhcnRzID0gZGF0YS5zcGxpdChcIlxcblxcblwiKSxcbiAgICAgICAgICBlc3RpbWF0ZWRJbnNlcnRTaXplcyA9IFtdLFxuICAgICAgICAgIHBjdGlsZXMgPSBvLmV4cGVjdGVkSW5zZXJ0U2l6ZVBlcmNlbnRpbGVzLFxuICAgICAgICAgIGxvd2VyQm91bmQgPSAxMCwgXG4gICAgICAgICAgdXBwZXJCb3VuZCA9IDUwMDAsIFxuICAgICAgICAgIHNhbXBsZUludGVydmFscywgbWVhbkl0ZW1MZW5ndGgsIGhhc0FNYXRlUGFpciwgY2hyU2NoZW1lLCBtZWFuSXRlbXNQZXJCcDtcbiAgICAgICAgXG4gICAgICAgIF8uZWFjaChpbmZvUGFydHNbMF0uc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICB2YXIgZmllbGRzID0gbGluZS5zcGxpdChcIlxcdFwiKSxcbiAgICAgICAgICAgIHJlYWRzTWFwcGVkVG9Db250aWcgPSBwYXJzZUludChmaWVsZHNbMl0sIDEwKTtcbiAgICAgICAgICBpZiAoZmllbGRzLmxlbmd0aCA9PSAxICYmIGZpZWxkc1swXSA9PSAnJykgeyByZXR1cm47IH0gLy8gYmxhbmsgbGluZVxuICAgICAgICAgIGJhbUNocnMucHVzaChmaWVsZHNbMF0pO1xuICAgICAgICAgIGlmIChfLmlzTmFOKHJlYWRzTWFwcGVkVG9Db250aWcpKSB7IHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgb3V0cHV0IGZvciBzYW10b29scyBpZHhzdGF0cyBvbiB0aGlzIEJBTSB0cmFjay5cIik7IH1cbiAgICAgICAgICBtYXBwZWRSZWFkcyArPSByZWFkc01hcHBlZFRvQ29udGlnO1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLmNoclNjaGVtZSA9IGNoclNjaGVtZSA9IHNlbGYudHlwZShcImJhbVwiKS5ndWVzc0NoclNjaGVtZShiYW1DaHJzKTtcbiAgICAgICAgaWYgKGNoclNjaGVtZSAmJiBzZWxmLmJyb3dzZXJDaHJTY2hlbWUpIHtcbiAgICAgICAgICBzZWxmLmRhdGEuaW5mby5jb252ZXJ0Q2hyU2NoZW1lID0gY2hyU2NoZW1lICE9IHNlbGYuYnJvd3NlckNoclNjaGVtZSA/IGNoclNjaGVtZSArICdfJyArIHNlbGYuYnJvd3NlckNoclNjaGVtZSA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHNhbXBsZUludGVydmFscyA9IF8uY29tcGFjdChfLm1hcChpbmZvUGFydHNbMV0uc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICByZXR1cm4gc2VsZi50eXBlKCdiYW0nKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsaW5lKTtcbiAgICAgICAgfSkpO1xuICAgICAgICBpZiAoc2FtcGxlSW50ZXJ2YWxzLmxlbmd0aCkge1xuICAgICAgICAgIG1lYW5JdGVtTGVuZ3RoID0gXy5yZWR1Y2Uoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihtZW1vLCBuZXh0KSB7IHJldHVybiBtZW1vICsgKG5leHQuZW5kIC0gbmV4dC5zdGFydCk7IH0sIDApO1xuICAgICAgICAgIG1lYW5JdGVtTGVuZ3RoID0gTWF0aC5yb3VuZChtZWFuSXRlbUxlbmd0aCAvIHNhbXBsZUludGVydmFscy5sZW5ndGgpO1xuICAgICAgICAgIGhhc0FNYXRlUGFpciA9IF8uc29tZShzYW1wbGVJbnRlcnZhbHMsIGZ1bmN0aW9uKGl0dmwpIHsgXG4gICAgICAgICAgICByZXR1cm4gaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciB8fCBpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXI7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMgPSBfLmNvbXBhY3QoXy5tYXAoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihpdHZsKSB7IFxuICAgICAgICAgICAgcmV0dXJuIGl0dmwudGxlbiA/IE1hdGguYWJzKGl0dmwudGxlbikgOiAwOyBcbiAgICAgICAgICB9KSk7XG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMuc29ydChmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhIC0gYjsgfSk7ICAvLyBOT1RFOiBKYXZhU2NyaXB0IGRvZXMgc3RyaW5nIHNvcnRpbmcgYnkgZGVmYXVsdCAtXy1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgPSBtZWFuSXRlbXNQZXJCcCA9IG1hcHBlZFJlYWRzIC8gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplO1xuICAgICAgICBzZWxmLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCA9IG1lYW5JdGVtTGVuZ3RoID0gXy5pc1VuZGVmaW5lZChtZWFuSXRlbUxlbmd0aCkgPyAxMDAgOiBtZWFuSXRlbUxlbmd0aDtcbiAgICAgICAgby5tYXhGZXRjaFdpbmRvdyA9IG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnAgLyAoTWF0aC5tYXgobWVhbkl0ZW1MZW5ndGgsIDEwMCkgLyAxMDApO1xuICAgICAgICBvLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioby5tYXhGZXRjaFdpbmRvdyAvIDIpO1xuICAgICAgICBcbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgcGFpcmluZywgd2UgbmVlZCB0byB0ZWxsIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgd2hhdCByYW5nZSBvZiBpbnNlcnQgc2l6ZXMgc2hvdWxkIHRyaWdnZXIgcGFpcmluZy5cbiAgICAgICAgaWYgKGhhc0FNYXRlUGFpcikge1xuICAgICAgICAgIGlmIChlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxvd2VyQm91bmQgPSBlc3RpbWF0ZWRJbnNlcnRTaXplc1tNYXRoLmZsb29yKGVzdGltYXRlZEluc2VydFNpemVzLmxlbmd0aCAqIHBjdGlsZXNbMF0pXTtcbiAgICAgICAgICAgIHVwcGVyQm91bmQgPSBlc3RpbWF0ZWRJbnNlcnRTaXplc1tNYXRoLmZsb29yKGVzdGltYXRlZEluc2VydFNpemVzLmxlbmd0aCAqIHBjdGlsZXNbMV0pXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VsZi5kYXRhLmNhY2hlLnNldFBhaXJpbmdJbnRlcnZhbChsb3dlckJvdW5kLCB1cHBlckJvdW5kKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBJZiB3ZSBkb24ndCBzZWUgYW55IHBhaXJlZCByZWFkcyBpbiB0aGlzIEJBTSwgZGVhY3RpdmF0ZSB0aGUgcGFpcmluZyBmdW5jdGlvbmFsaXR5IG9mIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgXG4gICAgICAgICAgc2VsZi5kYXRhLmNhY2hlLmRpc2FibGVQYWlyaW5nKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIG8ub3B0aW1hbEZldGNoV2luZG93LCBvLm1heEZldGNoV2luZG93KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5mbGFnc1suLi5dIHRvIGEgaHVtYW4gaW50ZXJwcmV0YWJsZSB2ZXJzaW9uIG9mIGZlYXR1cmUuZmxhZyAoZXhwYW5kaW5nIHRoZSBiaXR3aXNlIGZsYWdzKVxuICBwYXJzZUZsYWdzOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHtcbiAgICBmZWF0dXJlLmZsYWdzID0ge307XG4gICAgXy5lYWNoKHRoaXMudHlwZSgnYmFtJykuZmxhZ3MsIGZ1bmN0aW9uKGJpdCwgZmxhZykge1xuICAgICAgZmVhdHVyZS5mbGFnc1tmbGFnXSA9ICEhKGZlYXR1cmUuZmxhZyAmIGJpdCk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuYmxvY2tzIGFuZCBmZWF0dXJlLmVuZCBiYXNlZCBvbiBmZWF0dXJlLmNpZ2FyXG4gIC8vIFNlZSBzZWN0aW9uIDEuNCBvZiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmIGZvciBhbiBleHBsYW5hdGlvbiBvZiBDSUdBUiBcbiAgcGFyc2VDaWdhcjogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7ICAgICAgICBcbiAgICB2YXIgY2lnYXIgPSBmZWF0dXJlLmNpZ2FyLFxuICAgICAgc2VxID0gKCFmZWF0dXJlLnNlcSB8fCBmZWF0dXJlLnNlcSA9PSAnKicpID8gXCJcIiA6IGZlYXR1cmUuc2VxLFxuICAgICAgcmVmTGVuID0gMCxcbiAgICAgIHNlcVBvcyA9IDAsXG4gICAgICBvcGVyYXRpb25zLCBsZW5ndGhzO1xuICAgIFxuICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgZmVhdHVyZS5pbnNlcnRpb25zID0gW107XG4gICAgXG4gICAgb3BzID0gY2lnYXIuc3BsaXQoL1xcZCsvKS5zbGljZSgxKTtcbiAgICBsZW5ndGhzID0gY2lnYXIuc3BsaXQoL1tBLVo9XS8pLnNsaWNlKDAsIC0xKTtcbiAgICBpZiAob3BzLmxlbmd0aCAhPSBsZW5ndGhzLmxlbmd0aCkgeyB0aGlzLndhcm4oXCJJbnZhbGlkIENJR0FSICdcIiArIGNpZ2FyICsgXCInIGZvciBcIiArIGZlYXR1cmUuZGVzYyk7IHJldHVybjsgfVxuICAgIGxlbmd0aHMgPSBfLm1hcChsZW5ndGhzLCBwYXJzZUludDEwKTtcbiAgICBcbiAgICBfLmVhY2gob3BzLCBmdW5jdGlvbihvcCwgaSkge1xuICAgICAgdmFyIGxlbiA9IGxlbmd0aHNbaV0sXG4gICAgICAgIGJsb2NrLCBpbnNlcnRpb247XG4gICAgICBpZiAoL15bTVg9XSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIEFsaWdubWVudCBtYXRjaCwgc2VxdWVuY2UgbWF0Y2gsIHNlcXVlbmNlIG1pc21hdGNoXG4gICAgICAgIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVufTtcbiAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBsZW47XG4gICAgICAgIGJsb2NrLnR5cGUgPSBvcDtcbiAgICAgICAgYmxvY2suc2VxID0gc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKC9eW05EXSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIFNraXBwZWQgcmVmZXJlbmNlIHJlZ2lvbiwgZGVsZXRpb24gZnJvbSByZWZlcmVuY2VcbiAgICAgICAgcmVmTGVuICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ0knKSB7XG4gICAgICAgIC8vIEluc2VydGlvblxuICAgICAgICBpbnNlcnRpb24gPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW4sIGVuZDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGluc2VydGlvbi5zZXEgPSBzZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmluc2VydGlvbnMucHVzaChpbnNlcnRpb24pO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnUycpIHtcbiAgICAgICAgLy8gU29mdCBjbGlwcGluZzsgc2ltcGx5IHNraXAgdGhlc2UgYmFzZXMgaW4gU0VRLCBwb3NpdGlvbiBvbiByZWZlcmVuY2UgaXMgdW5jaGFuZ2VkLlxuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfVxuICAgICAgLy8gVGhlIG90aGVyIHR3byBDSUdBUiBvcHMsIEggYW5kIFAsIGFyZSBub3QgcmVsZXZhbnQgdG8gZHJhd2luZyBhbGlnbm1lbnRzLlxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZW5kID0gZmVhdHVyZS5zdGFydCArIHJlZkxlbjtcbiAgfSxcbiAgXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xzID0gWydxbmFtZScsICdmbGFnJywgJ3JuYW1lJywgJ3BvcycsICdtYXBxJywgJ2NpZ2FyJywgJ3JuZXh0JywgJ3BuZXh0JywgJ3RsZW4nLCAnc2VxJywgJ3F1YWwnXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICBhdmFpbEZsYWdzID0gdGhpcy50eXBlKCdiYW0nKS5mbGFncyxcbiAgICAgIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBfLmVhY2goXy5maXJzdChmaWVsZHMsIGNvbHMubGVuZ3RoKSwgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgLy8gQ29udmVydCBhdXRvbWF0aWNhbGx5IGJldHdlZW4gRW5zZW1ibCBzdHlsZSAxLCAyLCAzLCBYIDwtLT4gVUNTQyBzdHlsZSBjaHIxLCBjaHIyLCBjaHIzLCBjaHJYIGFzIGNvbmZpZ3VyZWQvYXV0b2RldGVjdGVkXG4gICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSA9PSBcImF1dG9cIiA/IHRoaXMuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgOiBvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IGZlYXR1cmUucm5hbWUgPSBmZWF0dXJlLnJuYW1lLnJlcGxhY2UoL15jaHIvLCAnJyk7IGJyZWFrO1xuICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogZmVhdHVyZS5ybmFtZSA9ICgvXihcXGRcXGQ/fFgpJC8udGVzdChmZWF0dXJlLnJuYW1lKSA/ICdjaHInIDogJycpICsgZmVhdHVyZS5ybmFtZTsgYnJlYWs7XG4gICAgfVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucW5hbWU7XG4gICAgZmVhdHVyZS5mbGFnID0gcGFyc2VJbnQxMChmZWF0dXJlLmZsYWcpO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUucm5hbWVdO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgUk5BTUUgJ1wiK2ZlYXR1cmUucm5hbWUrXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGZlYXR1cmUucG9zID09PSAnMCcgfHwgIWZlYXR1cmUuY2lnYXIgfHwgZmVhdHVyZS5jaWdhciA9PSAnKicgfHwgZmVhdHVyZS5mbGFnICYgYXZhaWxGbGFncy5pc1JlYWRVbm1hcHBlZCkge1xuICAgICAgLy8gVW5tYXBwZWQgcmVhZC4gU2luY2Ugd2UgY2FuJ3QgZHJhdyB0aGVzZSBhdCBhbGwsIHdlIGRvbid0IGJvdGhlciBwYXJzaW5nIHRoZW0gZnVydGhlci5cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnBvcyk7ICAgICAgICAvLyBQT1MgaXMgMS1iYXNlZCwgaGVuY2Ugbm8gaW5jcmVtZW50IGFzIGZvciBwYXJzaW5nIEJFRFxuICAgICAgZmVhdHVyZS5kZXNjID0gZmVhdHVyZS5xbmFtZSArICcgYXQgJyArIGZlYXR1cmUucm5hbWUgKyAnOicgKyBmZWF0dXJlLnBvcztcbiAgICAgIGZlYXR1cmUudGxlbiA9IHBhcnNlSW50MTAoZmVhdHVyZS50bGVuKTtcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VGbGFncy5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7XG4gICAgICBmZWF0dXJlLnN0cmFuZCA9IGZlYXR1cmUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnLScgOiAnKyc7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlQ2lnYXIuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pOyAvLyBUaGlzIGFsc28gc2V0cyAuZW5kIGFwcHJvcHJpYXRlbHlcbiAgICB9XG4gICAgLy8gV2UgaGF2ZSB0byBjb21lIHVwIHdpdGggc29tZXRoaW5nIHRoYXQgaXMgYSB1bmlxdWUgbGFiZWwgZm9yIGV2ZXJ5IGxpbmUgdG8gZGVkdXBlIHJvd3MuXG4gICAgLy8gVGhlIGZvbGxvd2luZyBpcyB0ZWNobmljYWxseSBub3QgZ3VhcmFudGVlZCBieSBhIHZhbGlkIEJBTSAoZXZlbiBhdCBHQVRLIHN0YW5kYXJkcyksIGJ1dCBpdCdzIHRoZSBiZXN0IEkgZ290LlxuICAgIGZlYXR1cmUuaWQgPSBbZmVhdHVyZS5xbmFtZSwgZmVhdHVyZS5mbGFnLCBmZWF0dXJlLnJuYW1lLCBmZWF0dXJlLnBvcywgZmVhdHVyZS5jaWdhcl0uam9pbihcIlxcdFwiKTtcbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIHBpbGV1cDogZnVuY3Rpb24oaW50ZXJ2YWxzLCBzdGFydCwgZW5kKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICBwb3NpdGlvbnNUb0NhbGN1bGF0ZSA9IHt9LFxuICAgICAgbnVtUG9zaXRpb25zVG9DYWxjdWxhdGUgPSAwLFxuICAgICAgaTtcbiAgICBcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICAvLyBObyBuZWVkIHRvIHBpbGV1cCBhZ2FpbiBvbiBhbHJlYWR5LXBpbGVkLXVwIG51Y2xlb3RpZGUgcG9zaXRpb25zXG4gICAgICBpZiAoIXBpbGV1cFtpXSkgeyBwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSA9IHRydWU7IG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlKys7IH1cbiAgICB9XG4gICAgaWYgKG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID09PSAwKSB7IHJldHVybjsgfSAvLyBBbGwgcG9zaXRpb25zIGFscmVhZHkgcGlsZWQgdXAhXG4gICAgXG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKGludGVydmFsLmRhdGEubWF0ZS5ibG9ja3MpOyB9XG4gICAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja3MpIHtcbiAgICAgICAgXy5lYWNoKGJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgICB2YXIgbnQsIGk7XG4gICAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgZW5kKTsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoIXBvc2l0aW9uc1RvQ2FsY3VsYXRlW2ldKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgIHBpbGV1cFtpXSA9IHBpbGV1cFtpXSB8fCB7QTogMCwgQzogMCwgRzogMCwgVDogMCwgTjogMCwgY292OiAwfTtcbiAgICAgICAgICAgIHBpbGV1cFtpXVsoL1tBQ1RHXS8pLnRlc3QobnQpID8gbnQgOiAnTiddICs9IDE7XG4gICAgICAgICAgICBwaWxldXBbaV0uY292ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgY292ZXJhZ2U6IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCkge1xuICAgIC8vIENvbXBhcmUgd2l0aCBiaW5uaW5nIG9uIHRoZSBmbHkgaW4gLnR5cGUoJ3dpZ2dsZV8wJykucHJlcmVuZGVyKC4uLilcbiAgICB2YXIgaiA9IHN0YXJ0LFxuICAgICAgdlNjYWxlID0gdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgKiB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCAqIDIsXG4gICAgICBjdXJyID0gdGhpcy5kYXRhLnBpbGV1cFtqXSxcbiAgICAgIGJhcnMgPSBbXSxcbiAgICAgIG5leHQsIGJpbiwgaTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgICAgYmluID0gY3VyciAmJiAoaiArIDEgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci5jb3ZdIDogW107XG4gICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB3aGlsZSAoaiArIDEgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIGogKyAyID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgIGlmIChuZXh0KSB7IGJpbi5wdXNoKG5leHQuY292KTsgfVxuICAgICAgICArK2o7XG4gICAgICAgIGN1cnIgPSBuZXh0O1xuICAgICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB9XG4gICAgICBiYXJzLnB1c2godXRpbHMud2lnQmluRnVuY3Rpb25zLm1heGltdW0oYmluKSAvIHZTY2FsZSk7XG4gICAgfVxuICAgIHJldHVybiBiYXJzO1xuICB9LFxuICBcbiAgYWxsZWxlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICB2U2NhbGUgPSB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCAqIHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoICogMixcbiAgICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQgPSB0aGlzLm9wdHMuYWxsZWxlRnJlcVRocmVzaG9sZCxcbiAgICAgIGFsbGVsZVNwbGl0cyA9IFtdLFxuICAgICAgc3BsaXQsIHJlZk50LCBpLCBwaWxlO1xuICAgICAgXG4gICAgZm9yIChpID0gMDsgaSA8IHNlcXVlbmNlLmxlbmd0aDsgaSsrKSB7XG4gICAgICByZWZOdCA9IHNlcXVlbmNlW2ldLnRvVXBwZXJDYXNlKCk7XG4gICAgICBwaWxlID0gcGlsZXVwW3N0YXJ0ICsgaV07XG4gICAgICBpZiAocGlsZSAmJiBwaWxlLmNvdiAmJiBwaWxlW3JlZk50XSAvIChwaWxlLmNvdiAtIHBpbGUuTikgPCAoMSAtIGFsbGVsZUZyZXFUaHJlc2hvbGQpKSB7XG4gICAgICAgIHNwbGl0ID0ge1xuICAgICAgICAgIHg6IGkgLyBicHBwLFxuICAgICAgICAgIHNwbGl0czogW11cbiAgICAgICAgfTtcbiAgICAgICAgXy5lYWNoKFsnQScsICdDJywgJ0cnLCAnVCddLCBmdW5jdGlvbihudCkge1xuICAgICAgICAgIGlmIChwaWxlW250XSA+IDApIHsgc3BsaXQuc3BsaXRzLnB1c2goe250OiBudCwgaDogcGlsZVtudF0gLyB2U2NhbGV9KTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgYWxsZWxlU3BsaXRzLnB1c2goc3BsaXQpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYWxsZWxlU3BsaXRzO1xuICB9LFxuICBcbiAgbWlzbWF0Y2hlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwLCBpbnRlcnZhbHMsIHdpZHRoLCBsaW5lTnVtLCB2aWV3QXNQYWlycykge1xuICAgIHZhciBtaXNtYXRjaGVzID0gW10sXG4gICAgICB2aWV3QXNQYWlycyA9IHRoaXMub3B0cy52aWV3QXNQYWlycztcbiAgICBzZXF1ZW5jZSA9IHNlcXVlbmNlLnRvVXBwZXJDYXNlKCk7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKHZpZXdBc1BhaXJzICYmIGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IFxuICAgICAgICBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTtcbiAgICAgIH1cbiAgICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2Nrcykge1xuICAgICAgICBfLmVhY2goYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICAgIHZhciBsaW5lID0gbGluZU51bShpbnRlcnZhbC5kYXRhKSxcbiAgICAgICAgICAgIG50LCBpLCB4O1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIHN0YXJ0ICsgd2lkdGggKiBicHBwKTsgaSsrKSB7XG4gICAgICAgICAgICB4ID0gKGkgLSBzdGFydCkgLyBicHBwO1xuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAobnQgJiYgbnQgIT0gc2VxdWVuY2VbaSAtIHN0YXJ0XSAmJiBsaW5lKSB7IG1pc21hdGNoZXMucHVzaCh7eDogeCwgbnQ6IG50LCBsaW5lOiBsaW5lfSk7IH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIG1pc21hdGNoZXM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIHNlcXVlbmNlID0gcHJlY2FsYy5zZXF1ZW5jZSxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICB2aWV3QXNQYWlycyA9IHNlbGYub3B0cy52aWV3QXNQYWlycyxcbiAgICAgIHN0YXJ0S2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVTdGFydCcgOiAnc3RhcnQnLFxuICAgICAgZW5kS2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVFbmQnIDogJ2VuZCcsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eSArICdfJyArICh2aWV3QXNQYWlycyA/ICdwJyA6ICd1Jyk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiB3ZSBjYW4gcmVhc29uYWJseSBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggYW4gaW5zYW5lIGFtb3VudCBvZiByb3dzIFxuICAgIC8vICg+NTAwIGFsaWdubWVudHMpLCBhcyB0aGlzIHdpbGwgb25seSBob2xkIHVwIG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmV0Y2ggZnJvbSB0aGUgUmVtb3RlVHJhY2sgYW5kIGNhbGwgdGhlIGFib3ZlIHdoZW4gdGhlIGRhdGEgaXMgYXZhaWxhYmxlLlxuICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIHZpZXdBc1BhaXJzLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgdmFyIGRyYXdTcGVjID0ge3NlcXVlbmNlOiAhIXNlcXVlbmNlLCB3aWR0aDogd2lkdGh9LFxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbE1hdGVkID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIDQsIGZhbHNlLCBzdGFydEtleSwgZW5kS2V5KSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgNCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW50ZXJ2YWxzLnRvb01hbnkpIHsgcmV0dXJuIGNhbGxiYWNrKGludGVydmFscyk7IH1cblxuICAgICAgICBpZiAoIXNlcXVlbmNlKSB7XG4gICAgICAgICAgLy8gRmlyc3QgZHJhd2luZyBwYXNzLCB3aXRoIGZlYXR1cmVzIHRoYXQgZG9uJ3QgZGVwZW5kIG9uIHNlcXVlbmNlLlxuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykucGlsZXVwLmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCBzdGFydCwgZW5kKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWxNYXRlZCwgbGluZU51bSk7XG4gICAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obGluZXMpIHtcbiAgICAgICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgICAgICAgICAgaW50ZXJ2YWwuaW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5pbnNlcnRpb25zLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICBpZiAoIXZpZXdBc1BhaXJzKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICBpZiAoaW50ZXJ2YWwuZC5kcmF3QXNNYXRlcyAmJiBpbnRlcnZhbC5kLm1hdGUpIHtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW50cyA9IF8ubWFwKFtpbnRlcnZhbC5kLCBpbnRlcnZhbC5kLm1hdGVdLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuaW5zZXJ0aW9uUHRzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGludGVydmFsLmQubWF0ZUV4cGVjdGVkKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBbY2FsY1BpeEludGVydmFsKGludGVydmFsKV07XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUJsb2NrSW50cyA9IFtdO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBbXTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZHJhd1NwZWMuY292ZXJhZ2UgPSBzZWxmLnR5cGUoJ2JhbScpLmNvdmVyYWdlLmNhbGwoc2VsZiwgc3RhcnQsIHdpZHRoLCBicHBwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2UsIGxpa2UgbWlzbWF0Y2hlcyAocG90ZW50aWFsIFNOUHMpLlxuICAgICAgICAgIGRyYXdTcGVjLmJwcHAgPSBicHBwOyAgXG4gICAgICAgICAgLy8gRmluZCBhbGxlbGUgc3BsaXRzIHdpdGhpbiB0aGUgY292ZXJhZ2UgZ3JhcGguXG4gICAgICAgICAgZHJhd1NwZWMuYWxsZWxlcyA9IHNlbGYudHlwZSgnYmFtJykuYWxsZWxlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCk7XG4gICAgICAgICAgLy8gRmluZCBtaXNtYXRjaGVzIHdpdGhpbiBlYWNoIGFsaWduZWQgYmxvY2suXG4gICAgICAgICAgZHJhd1NwZWMubWlzbWF0Y2hlcyA9IHNlbGYudHlwZSgnYmFtJykubWlzbWF0Y2hlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb250ZW50ID0ge30sXG4gICAgICBmaXJzdE1hdGUgPSBkYXRhLmQsXG4gICAgICBzZWNvbmRNYXRlID0gZGF0YS5kLm1hdGUsXG4gICAgICBtYXRlSGVhZGVycyA9IFtcInRoaXMgYWxpZ25tZW50XCIsIFwibWF0ZSBwYWlyIGFsaWdubWVudFwiXSxcbiAgICAgIGxlZnRNYXRlLCByaWdodE1hdGUsIHBhaXJPcmllbnRhdGlvbjtcbiAgICBmdW5jdGlvbiB5ZXNObyhib29sKSB7IHJldHVybiBib29sID8gXCJ5ZXNcIiA6IFwibm9cIjsgfVxuICAgIGZ1bmN0aW9uIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBzZWcsIHByZWZpeCkge1xuICAgICAgdmFyIGNpZ2FyQWJicmV2ID0gc2VnLmNpZ2FyICYmIHNlZy5jaWdhci5sZW5ndGggPiAyNSA/IHNlZy5jaWdhci5zdWJzdHIoMCwgMjQpICsgJy4uLicgOiBzZWcuY2lnYXI7XG4gICAgICBwcmVmaXggPSBwcmVmaXggfHwgXCJcIjtcbiAgICAgIFxuICAgICAgXy5lYWNoKHtcbiAgICAgICAgXCJwb3NpdGlvblwiOiBzZWcucm5hbWUgKyAnOicgKyBzZWcucG9zLFxuICAgICAgICBcImNpZ2FyXCI6IGNpZ2FyQWJicmV2LFxuICAgICAgICBcInJlYWQgc3RyYW5kXCI6IHNlZy5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/ICcoLSknIDogJygrKScsXG4gICAgICAgIFwibWFwcGVkXCI6IHllc05vKCFzZWcuZmxhZ3MuaXNSZWFkVW5tYXBwZWQpLFxuICAgICAgICBcIm1hcCBxdWFsaXR5XCI6IHNlZy5tYXBxLFxuICAgICAgICBcInNlY29uZGFyeVwiOiB5ZXNObyhzZWcuZmxhZ3MuaXNTZWNvbmRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcInN1cHBsZW1lbnRhcnlcIjogeWVzTm8oc2VnLmZsYWdzLmlzU3VwcGxlbWVudGFyeUFsaWdubWVudCksXG4gICAgICAgIFwiZHVwbGljYXRlXCI6IHllc05vKHNlZy5mbGFncy5pc0R1cGxpY2F0ZVJlYWQpLFxuICAgICAgICBcImZhaWxlZCBRQ1wiOiB5ZXNObyhzZWcuZmxhZ3MuaXNSZWFkRmFpbGluZ1ZlbmRvclFDKVxuICAgICAgfSwgZnVuY3Rpb24odiwgaykgeyBjb250ZW50W3ByZWZpeCArIGtdID0gdjsgfSk7XG4gICAgfVxuICAgIFxuICAgIGlmIChkYXRhLmQubWF0ZSAmJiBkYXRhLmQubWF0ZS5mbGFncykge1xuICAgICAgbGVmdE1hdGUgPSBkYXRhLmQuc3RhcnQgPCBkYXRhLmQubWF0ZS5zdGFydCA/IGRhdGEuZCA6IGRhdGEuZC5tYXRlO1xuICAgICAgcmlnaHRNYXRlID0gZGF0YS5kLnN0YXJ0IDwgZGF0YS5kLm1hdGUuc3RhcnQgPyBkYXRhLmQubWF0ZSA6IGRhdGEuZDtcbiAgICAgIHBhaXJPcmllbnRhdGlvbiA9IChsZWZ0TWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/IFwiUlwiIDogXCJGXCIpICsgKGxlZnRNYXRlLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyID8gXCIxXCIgOiBcIjJcIik7XG4gICAgICBwYWlyT3JpZW50YXRpb24gKz0gKHJpZ2h0TWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/IFwiUlwiIDogXCJGXCIpICsgKHJpZ2h0TWF0ZS5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyID8gXCIyXCIgOiBcIjFcIik7XG4gICAgfVxuICAgIFxuICAgIGlmIChvLnZpZXdBc1BhaXJzICYmIGRhdGEuZC5kcmF3QXNNYXRlcyAmJiBkYXRhLmQubWF0ZSkge1xuICAgICAgZmlyc3RNYXRlID0gbGVmdE1hdGU7XG4gICAgICBzZWNvbmRNYXRlID0gcmlnaHRNYXRlO1xuICAgICAgbWF0ZUhlYWRlcnMgPSBbXCJsZWZ0IGFsaWdubWVudFwiLCBcInJpZ2h0IGFsaWdubWVudFwiXTtcbiAgICB9XG4gICAgaWYgKHNlY29uZE1hdGUpIHtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuaW5zZXJ0U2l6ZSkpIHsgY29udGVudFtcImluc2VydCBzaXplXCJdID0gZGF0YS5kLmluc2VydFNpemU7IH1cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChwYWlyT3JpZW50YXRpb24pKSB7IGNvbnRlbnRbXCJwYWlyIG9yaWVudGF0aW9uXCJdID0gcGFpck9yaWVudGF0aW9uOyB9XG4gICAgICBjb250ZW50W21hdGVIZWFkZXJzWzBdXSA9IFwiLS0tXCI7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgZmlyc3RNYXRlKTtcbiAgICAgIGNvbnRlbnRbbWF0ZUhlYWRlcnNbMV1dID0gXCItLS1cIjtcbiAgICAgIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBzZWNvbmRNYXRlLCBcIiBcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBkYXRhLmQpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSxcbiAgXG4gIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjY292ZXJhZ2UgZm9yIGFuIGlkZWEgb2Ygd2hhdCB3ZSdyZSBpbWl0YXRpbmdcbiAgZHJhd0NvdmVyYWdlOiBmdW5jdGlvbihjdHgsIGNvdmVyYWdlLCBoZWlnaHQpIHtcbiAgICBfLmVhY2goY292ZXJhZ2UsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgY3R4LmZpbGxSZWN0KHgsIE1hdGgubWF4KGhlaWdodCAtIChkICogaGVpZ2h0KSwgMCksIDEsIE1hdGgubWluKGQgKiBoZWlnaHQsIGhlaWdodCkpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd1N0cmFuZEluZGljYXRvcjogZnVuY3Rpb24oY3R4LCB4LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCB4U2NhbGUsIGJpZ1N0eWxlKSB7XG4gICAgdmFyIHByZXZGaWxsU3R5bGUgPSBjdHguZmlsbFN0eWxlO1xuICAgIGlmIChiaWdTdHlsZSkge1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4Lm1vdmVUbyh4IC0gKDIgKiB4U2NhbGUpLCBibG9ja1kpO1xuICAgICAgY3R4LmxpbmVUbyh4ICsgKDMgKiB4U2NhbGUpLCBibG9ja1kgKyBibG9ja0hlaWdodC8yKTtcbiAgICAgIGN0eC5saW5lVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQpO1xuICAgICAgY3R4LmNsb3NlUGF0aCgpO1xuICAgICAgY3R4LmZpbGwoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMTQwLDE0MCwxNDApJztcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMiA6IDEpLCBibG9ja1ksIDEsIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMSA6IDApLCBibG9ja1kgKyAxLCAxLCBibG9ja0hlaWdodCAtIDIpO1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IHByZXZGaWxsU3R5bGU7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd0FsaWdubWVudDogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGRyYXdNYXRlcyA9IGRhdGEubWF0ZUludHMsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgYmxvY2tZID0gaSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwLzIsXG4gICAgICBibG9ja0hlaWdodCA9IGxpbmVIZWlnaHQgLSBsaW5lR2FwLFxuICAgICAgZGVsZXRpb25MaW5lV2lkdGggPSAyLFxuICAgICAgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGggPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogbGluZUhlaWdodCkgLSBkZWxldGlvbkxpbmVXaWR0aCAqIDAuNSxcbiAgICAgIGJsb2NrU2V0cyA9IFt7YmxvY2tJbnRzOiBkYXRhLmJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQuc3RyYW5kfV07XG4gICAgXG4gICAgLy8gRm9yIG1hdGUgcGFpcnMsIHRoZSBmdWxsIHBpeGVsIGludGVydmFsIHJlcHJlc2VudHMgdGhlIGxpbmUgbGlua2luZyB0aGUgbWF0ZXNcbiAgICBpZiAoZHJhd01hdGVzKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIGhhbGZIZWlnaHQsIGRhdGEucEludC53LCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfVxuICAgIFxuICAgIC8vIERyYXcgdGhlIGxpbmVzIHRoYXQgc2hvdyB0aGUgZnVsbCBhbGlnbm1lbnQgZm9yIGVhY2ggc2VnbWVudCwgaW5jbHVkaW5nIGRlbGV0aW9uc1xuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSAncmdiKDAsMCwwKSc7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyB8fCBbZGF0YS5wSW50XSwgZnVuY3Rpb24ocEludCkge1xuICAgICAgaWYgKHBJbnQudyA8PSAwKSB7IHJldHVybjsgfVxuICAgICAgLy8gTm90ZSB0aGF0IHRoZSBcIi0gMVwiIGJlbG93IGZpeGVzIHJvdW5kaW5nIGlzc3VlcyBidXQgZ2FtYmxlcyBvbiB0aGVyZSBuZXZlciBiZWluZyBhIGRlbGV0aW9uIGF0IHRoZSByaWdodCBlZGdlXG4gICAgICBjdHguZmlsbFJlY3QocEludC54LCBpICogbGluZUhlaWdodCArIGhhbGZIZWlnaHQsIHBJbnQudyAtIDEsIGRlbGV0aW9uTGluZVdpZHRoKTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgXG4gICAgLy8gRHJhdyB0aGUgW21pc11tYXRjaCAoTS9YLz0pIGJsb2Nrc1xuICAgIGlmIChkcmF3TWF0ZXMgJiYgZGF0YS5kLm1hdGUpIHsgYmxvY2tTZXRzLnB1c2goe2Jsb2NrSW50czogZGF0YS5tYXRlQmxvY2tJbnRzLCBzdHJhbmQ6IGRhdGEuZC5tYXRlLnN0cmFuZH0pOyB9XG4gICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tTZXQpIHtcbiAgICAgIHZhciBzdHJhbmQgPSBibG9ja1NldC5zdHJhbmQ7XG4gICAgICBfLmVhY2goYmxvY2tTZXQuYmxvY2tJbnRzLCBmdW5jdGlvbihiSW50LCBibG9ja051bSkge1xuICAgICAgXG4gICAgICAgIC8vIFNraXAgZHJhd2luZyBibG9ja3MgdGhhdCBhcmVuJ3QgaW5zaWRlIHRoZSBjYW52YXNcbiAgICAgICAgaWYgKGJJbnQueCArIGJJbnQudyA8IDAgfHwgYkludC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICBcbiAgICAgICAgaWYgKGJsb2NrTnVtID09IDAgJiYgYmxvY2tTZXQuc3RyYW5kID09ICctJyAmJiAhYkludC5vUHJldikge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LnggKyAyLCBibG9ja1ksIGJJbnQudyAtIDIsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTdHJhbmRJbmRpY2F0b3IuY2FsbChzZWxmLCBjdHgsIGJJbnQueCwgYmxvY2tZLCBibG9ja0hlaWdodCwgLTEsIGxpbmVIZWlnaHQgPiA2KTtcbiAgICAgICAgfSBlbHNlIGlmIChibG9ja051bSA9PSBibG9ja1NldC5ibG9ja0ludHMubGVuZ3RoIC0gMSAmJiBibG9ja1NldC5zdHJhbmQgPT0gJysnICYmICFiSW50Lm9OZXh0KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LnggKyBiSW50LncsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIDEsIGxpbmVIZWlnaHQgPiA2KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCBibG9ja1ksIGJJbnQudywgYmxvY2tIZWlnaHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBEcmF3IGluc2VydGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoMTE0LDQxLDIxOClcIjtcbiAgICBfLmVhY2goZHJhd01hdGVzID8gW2RhdGEuaW5zZXJ0aW9uUHRzLCBkYXRhLm1hdGVJbnNlcnRpb25QdHNdIDogW2RhdGEuaW5zZXJ0aW9uUHRzXSwgZnVuY3Rpb24oaW5zZXJ0aW9uUHRzKSB7XG4gICAgICBfLmVhY2goaW5zZXJ0aW9uUHRzLCBmdW5jdGlvbihpbnNlcnQpIHtcbiAgICAgICAgaWYgKGluc2VydC54ICsgaW5zZXJ0LncgPCAwIHx8IGluc2VydC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDEsIGkgKiBsaW5lSGVpZ2h0LCAyLCBsaW5lSGVpZ2h0KTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMiwgaSAqIGxpbmVIZWlnaHQsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMiwgKGkgKyAxKSAqIGxpbmVIZWlnaHQgLSBpbnNlcnRpb25DYXJldExpbmVXaWR0aCwgNCwgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3QWxsZWxlczogZnVuY3Rpb24oY3R4LCBhbGxlbGVzLCBoZWlnaHQsIGJhcldpZHRoKSB7XG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIHlQb3M7XG4gICAgXy5lYWNoKGFsbGVsZXMsIGZ1bmN0aW9uKGFsbGVsZXNGb3JQb3NpdGlvbikge1xuICAgICAgeVBvcyA9IGhlaWdodDtcbiAgICAgIF8uZWFjaChhbGxlbGVzRm9yUG9zaXRpb24uc3BsaXRzLCBmdW5jdGlvbihzcGxpdCkge1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1tzcGxpdC5udF0rJyknO1xuICAgICAgICBjdHguZmlsbFJlY3QoYWxsZWxlc0ZvclBvc2l0aW9uLngsIHlQb3MgLT0gKHNwbGl0LmggKiBoZWlnaHQpLCBNYXRoLm1heChiYXJXaWR0aCwgMSksIHNwbGl0LmggKiBoZWlnaHQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3TWlzbWF0Y2g6IGZ1bmN0aW9uKGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIHBwYnApIHtcbiAgICAvLyBwcGJwID09IHBpeGVscyBwZXIgYmFzZSBwYWlyIChpbnZlcnNlIG9mIGJwcHApXG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgeVBvcztcbiAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1ttaXNtYXRjaC5udF0rJyknO1xuICAgIGN0eC5maWxsUmVjdChtaXNtYXRjaC54LCAobWlzbWF0Y2gubGluZSArIGxpbmVPZmZzZXQpICogbGluZUhlaWdodCArIGxpbmVHYXAgLyAyLCBNYXRoLm1heChwcGJwLCAxKSwgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIC8vIERvIHdlIGhhdmUgcm9vbSB0byBwcmludCBhIHdob2xlIGxldHRlcj9cbiAgICBpZiAocHBicCA+IDcgJiYgbGluZUhlaWdodCA+IDEwKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYigyNTUsMjU1LDI1NSknO1xuICAgICAgY3R4LmZpbGxUZXh0KG1pc21hdGNoLm50LCBtaXNtYXRjaC54ICsgcHBicCAqIDAuNSwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0ICsgMSkgKiBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNCA6IDQsXG4gICAgICBjb3ZIZWlnaHQgPSBkZW5zaXR5ID09ICdkZW5zZScgPyAyNCA6IDM4LFxuICAgICAgY292TWFyZ2luID0gNyxcbiAgICAgIGxpbmVPZmZzZXQgPSAoKGNvdkhlaWdodCArIGNvdk1hcmdpbikgLyBsaW5lSGVpZ2h0KSwgXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICAgICAgICAgIFxuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIFxuICAgIGlmICghZHJhd1NwZWMuc2VxdWVuY2UpIHtcbiAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgIFxuICAgICAgLy8gSWYgbmVjZXNzYXJ5LCBpbmRpY2F0ZSB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgaWYgKGRyYXdTcGVjLnRvb01hbnkgfHwgKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gT25seSBzdG9yZSBhcmVhcyBmb3IgdGhlIFwicGFja1wiIGRlbnNpdHkuXG4gICAgICAvLyBXZSBoYXZlIHRvIGVtcHR5IHRoaXMgZm9yIGV2ZXJ5IHJlbmRlciwgYmVjYXVzZSBhcmVhcyBjYW4gY2hhbmdlIGlmIEJBTSBkaXNwbGF5IG9wdGlvbnMgY2hhbmdlLlxuICAgICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgICAgLy8gU2V0IHRoZSBleHBlY3RlZCBoZWlnaHQgZm9yIHRoZSBjYW52YXMgKHRoaXMgYWxzbyBlcmFzZXMgaXQpLlxuICAgICAgY2FudmFzLmhlaWdodCA9IGNvdkhlaWdodCArICgoZGVuc2l0eSA9PSAnZGVuc2UnKSA/IDAgOiBjb3ZNYXJnaW4gKyBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodCk7XG4gICAgICBcbiAgICAgIC8vIEZpcnN0IGRyYXcgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTU5LDE1OSwxNTkpXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdDb3ZlcmFnZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMuY292ZXJhZ2UsIGNvdkhlaWdodCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAvLyBOb3csIGRyYXcgYWxpZ25tZW50cyBiZWxvdyBpdFxuICAgICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJykge1xuICAgICAgICAvLyBCb3JkZXIgYmV0d2VlbiBjb3ZlcmFnZVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTA5LDEwOSwxMDkpXCI7XG4gICAgICAgIGN0eC5maWxsUmVjdCgwLCBjb3ZIZWlnaHQgKyAxLCBkcmF3U3BlYy53aWR0aCwgMSk7IFxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgaSArPSBsaW5lT2Zmc2V0OyAvLyBoYWNraXNoIG1ldGhvZCBmb3IgbGVhdmluZyBzcGFjZSBhdCB0aGUgdG9wIGZvciB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3QWxpZ25tZW50LmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCwgZHJhd1NwZWMudmlld0FzUGFpcnMpO1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlY29uZCBkcmF3aW5nIHBhc3MsIHRvIGRyYXcgdGhpbmdzIHRoYXQgYXJlIGRlcGVuZGVudCBvbiBzZXF1ZW5jZTpcbiAgICAgIC8vICgxKSBhbGxlbGUgc3BsaXRzIG92ZXIgY292ZXJhZ2VcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsbGVsZXMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmFsbGVsZXMsIGNvdkhlaWdodCwgMSAvIGRyYXdTcGVjLmJwcHApO1xuICAgICAgLy8gKDIpIG1pc21hdGNoZXMgb3ZlciB0aGUgYWxpZ25tZW50c1xuICAgICAgY3R4LmZvbnQgPSBcIjEycHggJ01lbmxvJywnQml0c3RyZWFtIFZlcmEgU2FucyBNb25vJywnQ29uc29sYXMnLCdMdWNpZGEgQ29uc29sZScsbW9ub3NwYWNlXCI7XG4gICAgICBjdHgudGV4dEFsaWduID0gJ2NlbnRlcic7XG4gICAgICBjdHgudGV4dEJhc2VsaW5lID0gJ2Jhc2VsaW5lJztcbiAgICAgIF8uZWFjaChkcmF3U3BlYy5taXNtYXRjaGVzLCBmdW5jdGlvbihtaXNtYXRjaCkge1xuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdNaXNtYXRjaC5jYWxsKHNlbGYsIGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICB2YXIgY2FsbGJhY2tLZXkgPSBzdGFydCArICctJyArIGVuZCArICctJyArIGRlbnNpdHk7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBcbiAgICAgIC8vIEhhdmUgd2UgYmVlbiB3YWl0aW5nIHRvIGRyYXcgc2VxdWVuY2UgZGF0YSB0b28/IElmIHNvLCBkbyB0aGF0IG5vdywgdG9vLlxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XSkpIHtcbiAgICAgICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0oKTtcbiAgICAgICAgZGVsZXRlIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldO1xuICAgICAgfVxuICAgICAgXG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICByZW5kZXJTZXF1ZW5jZTogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBzZXF1ZW5jZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgXG4gICAgLy8gSWYgd2Ugd2VyZW4ndCBhYmxlIHRvIGZldGNoIHNlcXVlbmNlIGZvciBzb21lIHJlYXNvbiwgdGhlcmUgaXMgbm8gcmVhc29uIHRvIHByb2NlZWQuXG4gICAgaWYgKCFzZXF1ZW5jZSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKSB7XG4gICAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aCwgc2VxdWVuY2U6IHNlcXVlbmNlfSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgdGhlIGNhbnZhcyB3YXMgYWxyZWFkeSByZW5kZXJlZCAoYnkgbGFjayBvZiB0aGUgY2xhc3MgJ3VucmVuZGVyZWQnKS5cbiAgICAvLyBJZiB5ZXMsIGdvIGFoZWFkIGFuZCBleGVjdXRlIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTsgaWYgbm90LCBzYXZlIGl0IGZvciBsYXRlci5cbiAgICBpZiAoKCcgJyArIGNhbnZhcy5jbGFzc05hbWUgKyAnICcpLmluZGV4T2YoJyB1bnJlbmRlcmVkICcpID4gLTEpIHtcbiAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3Nbc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5XSA9IHJlbmRlclNlcXVlbmNlQ2FsbGJhY2s7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTtcbiAgICB9XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0FzUGFpcnNdJykuYXR0cignY2hlY2tlZCcsICEhby52aWV3QXNQYWlycyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb252ZXJ0Q2hyU2NoZW1lXScpLnZhbChvLmNvbnZlcnRDaHJTY2hlbWUpLmNoYW5nZSgpO1xuICB9LFxuXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHM7XG4gICAgby52aWV3QXNQYWlycyA9ICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0FzUGFpcnNdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby5jb252ZXJ0Q2hyU2NoZW1lID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb252ZXJ0Q2hyU2NoZW1lXScpLnZhbCgpO1xuICAgIFxuICAgIC8vIElmIG8udmlld0FzUGFpcnMgd2FzIGNoYW5nZWQsIHdlICpuZWVkKiB0byBibG93IGF3YXkgdGhlIGdlbm9icm93c2VyJ3MgYXJlYUluZGV4IFxuICAgIC8vIGFuZCBvdXIgbG9jYWxseSBjYWNoZWQgYXJlYXMsIGFzIGFsbCB0aGUgYXJlYXMgd2lsbCBjaGFuZ2UuXG4gICAgaWYgKG8udmlld0FzUGFpcnMgIT0gdGhpcy5wcmV2T3B0cy52aWV3QXNQYWlycykge1xuICAgICAgdGhpcy5hcmVhcyA9IHt9O1xuICAgICAgZGVsZXRlICRkaWFsb2cuZGF0YSgnZ2Vub2Jyb3dzZXInKS5nZW5vYnJvd3NlcignYXJlYUluZGV4JylbJGRpYWxvZy5kYXRhKCd0cmFjaycpLm5dO1xuICAgIH1cbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmFtRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJFRCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBiZWREZXRhaWwgaXMgYSB0cml2aWFsIGV4dGVuc2lvbiBvZiBCRUQgdGhhdCBpcyBkZWZpbmVkIHNlcGFyYXRlbHksXG4vLyBhbHRob3VnaCBhIEJFRCBmaWxlIHdpdGggPjEyIGNvbHVtbnMgaXMgYXNzdW1lZCB0byBiZSBiZWREZXRhaWwgdHJhY2sgcmVnYXJkbGVzcyBvZiB0eXBlLlxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgTGluZU1hc2sgPSByZXF1aXJlKCcuL3V0aWxzL0xpbmVNYXNrLmpzJykuTGluZU1hc2s7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJlZFxudmFyIEJlZEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGFsdENvbG9ycyA9IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLyksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSBhbHRDb2xvcnMubGVuZ3RoID4gMSAmJiBfLmFsbChhbHRDb2xvcnMsIHNlbGYudmFsaWRhdGVDb2xvcik7XG4gICAgc2VsZi5vcHRzLnVzZVNjb3JlID0gc2VsZi5pc09uKHNlbGYub3B0cy51c2VTY29yZSk7XG4gICAgc2VsZi5vcHRzLml0ZW1SZ2IgPSBzZWxmLmlzT24oc2VsZi5vcHRzLml0ZW1SZ2IpO1xuICAgIGlmICghdmFsaWRDb2xvckJ5U3RyYW5kKSB7IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kID0gJyc7IHNlbGYub3B0cy5hbHRDb2xvciA9IG51bGw7IH1cbiAgICBlbHNlIHsgc2VsZi5vcHRzLmFsdENvbG9yID0gYWx0Q29sb3JzWzFdOyB9XG4gIH0sXG5cbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICduYW1lJywgJ3Njb3JlJywgJ3N0cmFuZCcsICd0aGlja1N0YXJ0JywgJ3RoaWNrRW5kJywgJ2l0ZW1SZ2InLFxuICAgICAgJ2Jsb2NrQ291bnQnLCAnYmxvY2tTaXplcycsICdibG9ja1N0YXJ0cycsICdpZCcsICdkZXNjcmlwdGlvbiddLFxuICAgICAgZmVhdHVyZSA9IHt9LFxuICAgICAgZmllbGRzID0gL1xcdC8udGVzdChsaW5lKSA/IGxpbmUuc3BsaXQoXCJcXHRcIikgOiBsaW5lLnNwbGl0KC9cXHMrLyksXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgaWYgKHRoaXMub3B0cy5kZXRhaWwpIHtcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDJdID0gJ2lkJztcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDFdID0gJ2Rlc2NyaXB0aW9uJztcbiAgICB9XG4gICAgXy5lYWNoKGZpZWxkcywgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbZmVhdHVyZS5jaHJvbV07XG4gICAgbGluZW5vID0gbGluZW5vIHx8IDA7XG4gICAgXG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkgeyBcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgY2hyb21vc29tZSAnXCIrZmVhdHVyZS5jaHJvbStcIicgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tU3RhcnQpICsgMTtcbiAgICAgIGZlYXR1cmUuZW5kID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tRW5kKSArIDE7XG4gICAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgICAvLyBmYW5jaWVyIEJFRCBmZWF0dXJlcyB0byBleHByZXNzIGNvZGluZyByZWdpb25zIGFuZCBleG9ucy9pbnRyb25zXG4gICAgICBpZiAoL15cXGQrJC8udGVzdChmZWF0dXJlLnRoaWNrU3RhcnQpICYmIC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja0VuZCkpIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnRoaWNrU3RhcnQpICsgMTtcbiAgICAgICAgZmVhdHVyZS50aGlja0VuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja0VuZCkgKyAxO1xuICAgICAgICBpZiAoL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTaXplcykgJiYgL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTdGFydHMpKSB7XG4gICAgICAgICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICAgICAgICBibG9ja1NpemVzID0gZmVhdHVyZS5ibG9ja1NpemVzLnNwbGl0KC8sLyk7XG4gICAgICAgICAgXy5lYWNoKGZlYXR1cmUuYmxvY2tTdGFydHMuc3BsaXQoLywvKSwgZnVuY3Rpb24oc3RhcnQsIGkpIHtcbiAgICAgICAgICAgIGlmIChzdGFydCA9PT0gJycpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyBwYXJzZUludDEwKHN0YXJ0KX07XG4gICAgICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIHBhcnNlSW50MTAoYmxvY2tTaXplc1tpXSk7XG4gICAgICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSk7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSwgbGluZW5vKTtcbiAgICAgIGlmIChmZWF0dXJlKSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgc3RhY2tlZExheW91dDogZnVuY3Rpb24oaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKSB7XG4gICAgLy8gQSBsaW5lTnVtIGZ1bmN0aW9uIGNhbiBiZSBwcm92aWRlZCB3aGljaCBjYW4gc2V0L3JldHJpZXZlIHRoZSBsaW5lIG9mIGFscmVhZHkgcmVuZGVyZWQgZGF0YXBvaW50c1xuICAgIC8vIHNvIGFzIHRvIG5vdCBicmVhayBhIHJhbmdlZCBmZWF0dXJlIHRoYXQgZXh0ZW5kcyBvdmVyIG11bHRpcGxlIHRpbGVzLlxuICAgIGxpbmVOdW0gPSBfLmlzRnVuY3Rpb24obGluZU51bSkgPyBsaW5lTnVtIDogZnVuY3Rpb24oKSB7IHJldHVybjsgfTtcbiAgICB2YXIgbGluZXMgPSBbXSxcbiAgICAgIG1heEV4aXN0aW5nTGluZSA9IF8ubWF4KF8ubWFwKGludGVydmFscywgZnVuY3Rpb24odikgeyByZXR1cm4gbGluZU51bSh2LmRhdGEpIHx8IDA7IH0pKSArIDEsXG4gICAgICBzb3J0ZWRJbnRlcnZhbHMgPSBfLnNvcnRCeShpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgdmFyIGxuID0gbGluZU51bSh2LmRhdGEpOyByZXR1cm4gXy5pc1VuZGVmaW5lZChsbikgPyAxIDogLWxuOyB9KTtcbiAgICBcbiAgICB3aGlsZSAobWF4RXhpc3RpbmdMaW5lLS0+MCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgXy5lYWNoKHNvcnRlZEludGVydmFscywgZnVuY3Rpb24odikge1xuICAgICAgdmFyIGQgPSB2LmRhdGEsXG4gICAgICAgIGxuID0gbGluZU51bShkKSxcbiAgICAgICAgcEludCA9IGNhbGNQaXhJbnRlcnZhbChkKSxcbiAgICAgICAgdGhpY2tJbnQgPSBkLnRoaWNrU3RhcnQgIT09IG51bGwgJiYgY2FsY1BpeEludGVydmFsKHtzdGFydDogZC50aGlja1N0YXJ0LCBlbmQ6IGQudGhpY2tFbmR9KSxcbiAgICAgICAgYmxvY2tJbnRzID0gZC5ibG9ja3MgIT09IG51bGwgJiYgIF8ubWFwKGQuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpLFxuICAgICAgICBpID0gMCxcbiAgICAgICAgbCA9IGxpbmVzLmxlbmd0aDtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChsbikpIHtcbiAgICAgICAgaWYgKGxpbmVzW2xuXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyBjb25zb2xlLmxvZyhcIlVucmVzb2x2YWJsZSBMaW5lTWFzayBjb25mbGljdCFcIik7IH1cbiAgICAgICAgbGluZXNbbG5dLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hpbGUgKGkgPCBsICYmIGxpbmVzW2ldLmNvbmZsaWN0KHBJbnQudHgsIHBJbnQudHcpKSB7ICsraTsgfVxuICAgICAgICBpZiAoaSA9PSBsKSB7IGxpbmVzLnB1c2gobmV3IExpbmVNYXNrKHdpZHRoLCA1KSk7IH1cbiAgICAgICAgbGluZU51bShkLCBpKTtcbiAgICAgICAgbGluZXNbaV0uYWRkKHBJbnQudHgsIHBJbnQudHcsIHtwSW50OiBwSW50LCB0aGlja0ludDogdGhpY2tJbnQsIGJsb2NrSW50czogYmxvY2tJbnRzLCBkOiBkfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBfLnBsdWNrKGwuaXRlbXMsICdkYXRhJyk7IH0pO1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgaW50ZXJ2YWxzID0gdGhpcy5kYXRhLnNlYXJjaChzdGFydCwgZW5kKSxcbiAgICAgIGRyYXdTcGVjID0gW10sXG4gICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldCkge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldCkpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgdmFyIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwodi5kYXRhKTtcbiAgICAgICAgcEludC52ID0gdi5kYXRhLnNjb3JlO1xuICAgICAgICBkcmF3U3BlYy5wdXNoKHBJbnQpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRyYXdTcGVjID0ge2xheW91dDogdGhpcy50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwodGhpcywgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKX07XG4gICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgYWRkQXJlYTogZnVuY3Rpb24oYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKSB7XG4gICAgdmFyIHRpcFRpcERhdGEgPSB7fSxcbiAgICAgIHRpcFRpcERhdGFDYWxsYmFjayA9IHRoaXMudHlwZSgpLnRpcFRpcERhdGE7XG4gICAgaWYgKCFhcmVhcykgeyByZXR1cm47IH1cbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHRpcFRpcERhdGFDYWxsYmFjaykpIHtcbiAgICAgIHRpcFRpcERhdGEgPSB0aXBUaXBEYXRhQ2FsbGJhY2suY2FsbCh0aGlzLCBkYXRhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5kZXNjcmlwdGlvbikpIHsgdGlwVGlwRGF0YS5kZXNjcmlwdGlvbiA9IGRhdGEuZC5kZXNjcmlwdGlvbjsgfVxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5zY29yZSkpIHsgdGlwVGlwRGF0YS5zY29yZSA9IGRhdGEuZC5zY29yZTsgfVxuICAgICAgXy5leHRlbmQodGlwVGlwRGF0YSwge1xuICAgICAgICBwb3NpdGlvbjogZGF0YS5kLmNocm9tICsgJzonICsgZGF0YS5kLmNocm9tU3RhcnQsIFxuICAgICAgICBzaXplOiBkYXRhLmQuY2hyb21FbmQgLSBkYXRhLmQuY2hyb21TdGFydFxuICAgICAgfSk7XG4gICAgICAvLyBEaXNwbGF5IHRoZSBJRCBjb2x1bW4gKGZyb20gYmVkRGV0YWlsKSwgdW5sZXNzIGl0IGNvbnRhaW5zIGEgdGFiIGNoYXJhY3Rlciwgd2hpY2ggbWVhbnMgaXQgd2FzIGF1dG9nZW5lcmF0ZWRcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuaWQpICYmICEoL1xcdC8pLnRlc3QoZGF0YS5kLmlkKSkgeyB0aXBUaXBEYXRhLmlkID0gZGF0YS5kLmlkOyB9XG4gICAgfVxuICAgIGFyZWFzLnB1c2goW1xuICAgICAgZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgKGkgKyAxKSAqIGxpbmVIZWlnaHQsIC8vIHgxLCB4MiwgeTEsIHkyXG4gICAgICBkYXRhLmQubmFtZSB8fCBkYXRhLmQuaWQgfHwgJycsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gbmFtZVxuICAgICAgdXJsVGVtcGxhdGUucmVwbGFjZSgnJCQnLCBfLmlzVW5kZWZpbmVkKGRhdGEuZC5pZCkgPyBkYXRhLmQubmFtZSA6IGRhdGEuZC5pZCksICAgIC8vIGhyZWZcbiAgICAgIGRhdGEucEludC5vUHJldiwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjb250aW51YXRpb24gZnJvbSBwcmV2aW91cyB0aWxlP1xuICAgICAgbnVsbCxcbiAgICAgIG51bGwsXG4gICAgICB0aXBUaXBEYXRhXG4gICAgXSk7XG4gIH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGFuIGFscGhhIHZhbHVlIGJldHdlZW4gMC4yIGFuZCAxLjBcbiAgY2FsY0FscGhhOiBmdW5jdGlvbih2YWx1ZSkgeyByZXR1cm4gTWF0aC5tYXgodmFsdWUsIDE2NikvMTAwMDsgfSxcbiAgXG4gIC8vIFNjYWxlcyBhIHNjb3JlIGZyb20gMC0xMDAwIGludG8gYSBjb2xvciBzY2FsZWQgYmV0d2VlbiAjY2NjY2NjIGFuZCBtYXggQ29sb3JcbiAgY2FsY0dyYWRpZW50OiBmdW5jdGlvbihtYXhDb2xvciwgdmFsdWUpIHtcbiAgICB2YXIgbWluQ29sb3IgPSBbMjMwLDIzMCwyMzBdLFxuICAgICAgdmFsdWVDb2xvciA9IFtdO1xuICAgIGlmICghXy5pc0FycmF5KG1heENvbG9yKSkgeyBtYXhDb2xvciA9IF8ubWFwKG1heENvbG9yLnNwbGl0KCcsJyksIHBhcnNlSW50MTApOyB9XG4gICAgXy5lYWNoKG1pbkNvbG9yLCBmdW5jdGlvbih2LCBpKSB7IHZhbHVlQ29sb3JbaV0gPSAodiAtIG1heENvbG9yW2ldKSAqICgoMTAwMCAtIHZhbHVlKSAvIDEwMDAuMCkgKyBtYXhDb2xvcltpXTsgfSk7XG4gICAgcmV0dXJuIF8ubWFwKHZhbHVlQ29sb3IsIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgfSxcbiAgXG4gIGRyYXdBcnJvd3M6IGZ1bmN0aW9uKGN0eCwgY2FudmFzV2lkdGgsIGxpbmVZLCBoYWxmSGVpZ2h0LCBzdGFydFgsIGVuZFgsIGRpcmVjdGlvbikge1xuICAgIHZhciBhcnJvd0hlaWdodCA9IE1hdGgubWluKGhhbGZIZWlnaHQsIDMpLFxuICAgICAgWDEsIFgyO1xuICAgIHN0YXJ0WCA9IE1hdGgubWF4KHN0YXJ0WCwgMCk7XG4gICAgZW5kWCA9IE1hdGgubWluKGVuZFgsIGNhbnZhc1dpZHRoKTtcbiAgICBpZiAoZW5kWCAtIHN0YXJ0WCA8IDUpIHsgcmV0dXJuOyB9IC8vIGNhbid0IGRyYXcgYXJyb3dzIGluIHRoYXQgbmFycm93IG9mIGEgc3BhY2VcbiAgICBpZiAoZGlyZWN0aW9uICE9PSAnKycgJiYgZGlyZWN0aW9uICE9PSAnLScpIHsgcmV0dXJuOyB9IC8vIGludmFsaWQgZGlyZWN0aW9uXG4gICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgIC8vIEFsbCB0aGUgMC41J3MgaGVyZSBhcmUgZHVlIHRvIDxjYW52YXM+J3Mgc29tZXdoYXQgc2lsbHkgY29vcmRpbmF0ZSBzeXN0ZW0gXG4gICAgLy8gaHR0cDovL2RpdmVpbnRvaHRtbDUuaW5mby9jYW52YXMuaHRtbCNwaXhlbC1tYWRuZXNzXG4gICAgWDEgPSBkaXJlY3Rpb24gPT0gJysnID8gMC41IDogYXJyb3dIZWlnaHQgKyAwLjU7XG4gICAgWDIgPSBkaXJlY3Rpb24gPT0gJysnID8gYXJyb3dIZWlnaHQgKyAwLjUgOiAwLjU7XG4gICAgZm9yICh2YXIgaSA9IE1hdGguZmxvb3Ioc3RhcnRYKSArIDI7IGkgPCBlbmRYIC0gYXJyb3dIZWlnaHQ7IGkgKz0gNykge1xuICAgICAgY3R4Lm1vdmVUbyhpICsgWDEsIGxpbmVZICsgaGFsZkhlaWdodCAtIGFycm93SGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgyLCBsaW5lWSArIGhhbGZIZWlnaHQgKyAwLjUpO1xuICAgICAgY3R4LmxpbmVUbyhpICsgWDEsIGxpbmVZICsgaGFsZkhlaWdodCArIGFycm93SGVpZ2h0ICsgMC41KTtcbiAgICB9XG4gICAgY3R4LnN0cm9rZSgpO1xuICB9LFxuICBcbiAgZHJhd0ZlYXR1cmU6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIHkgPSBpICogbGluZUhlaWdodCxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgcXVhcnRlckhlaWdodCA9IE1hdGguY2VpbCgwLjI1ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIHRoaWNrT3ZlcmxhcCA9IG51bGwsXG4gICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLml0ZW1SZ2IgJiYgZGF0YS5kLml0ZW1SZ2IgJiYgdGhpcy52YWxpZGF0ZUNvbG9yKGRhdGEuZC5pdGVtUmdiKSkgeyBjb2xvciA9IGRhdGEuZC5pdGVtUmdiOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjb2xvciA9IHNlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBkYXRhLmQuc2NvcmUpOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy5pdGVtUmdiIHx8IHNlbGYub3B0cy5hbHRDb2xvciB8fCBzZWxmLm9wdHMudXNlU2NvcmUpIHsgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjsgfVxuICAgIFxuICAgIGlmIChkYXRhLnRoaWNrSW50KSB7XG4gICAgICAvLyBUaGUgY29kaW5nIHJlZ2lvbiBpcyBkcmF3biBhcyBhIHRoaWNrZXIgbGluZSB3aXRoaW4gdGhlIGdlbmVcbiAgICAgIGlmIChkYXRhLmJsb2NrSW50cykge1xuICAgICAgICAvLyBJZiB0aGVyZSBhcmUgZXhvbnMgYW5kIGludHJvbnMsIGRyYXcgdGhlIGludHJvbnMgd2l0aCBhIDFweCBsaW5lXG4gICAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCwgZGF0YS5wSW50LncsIDEpO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBjb2xvcjtcbiAgICAgICAgXy5lYWNoKGRhdGEuYmxvY2tJbnRzLCBmdW5jdGlvbihiSW50KSB7XG4gICAgICAgICAgaWYgKGJJbnQueCArIGJJbnQudyA8PSB3aWR0aCAmJiBiSW50LnggPj0gMCkge1xuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgeSArIGhhbGZIZWlnaHQgLSBxdWFydGVySGVpZ2h0ICsgMSwgYkludC53LCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlja092ZXJsYXAgPSB1dGlscy5waXhJbnRlcnZhbE92ZXJsYXAoYkludCwgZGF0YS50aGlja0ludCk7XG4gICAgICAgICAgaWYgKHRoaWNrT3ZlcmxhcCkge1xuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KHRoaWNrT3ZlcmxhcC54LCB5ICsgMSwgdGhpY2tPdmVybGFwLncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGludHJvbnMsIGFycm93cyBhcmUgZHJhd24gb24gdGhlIGludHJvbnMsIG5vdCB0aGUgZXhvbnMuLi5cbiAgICAgICAgICBpZiAoZGF0YS5kLnN0cmFuZCAmJiBwcmV2QkludCkge1xuICAgICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIHByZXZCSW50LnggKyBwcmV2QkludC53LCBiSW50LngsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwcmV2QkludCA9IGJJbnQ7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyAuLi51bmxlc3MgdGhlcmUgd2VyZSBubyBpbnRyb25zLiBUaGVuIGl0IGlzIGRyYXduIG9uIHRoZSBjb2RpbmcgcmVnaW9uLlxuICAgICAgICBpZiAoZGF0YS5ibG9ja0ludHMubGVuZ3RoID09IDEpIHtcbiAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gV2UgaGF2ZSBhIGNvZGluZyByZWdpb24gYnV0IG5vIGludHJvbnMvZXhvbnNcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEudGhpY2tJbnQueCwgeSArIDEsIGRhdGEudGhpY2tJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE5vdGhpbmcgZmFuY3kuICBJdCdzIGEgYm94LlxuICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgMSwgZGF0YS5wSW50LncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQueCwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gc2VsZi5vcHRzLnVybCA/IHNlbGYub3B0cy51cmwgOiAnamF2YXNjcmlwdDp2b2lkKFwiJytzZWxmLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGRyYXdMaW1pdCA9IHNlbGYub3B0cy5kcmF3TGltaXQgJiYgc2VsZi5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDE1IDogNixcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgYXJlYXMgPSBudWxsO1xuICAgIFxuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIC8vIFRPRE86IEkgZGlzYWJsZWQgcmVnZW5lcmF0aW5nIGFyZWFzIGhlcmUsIHdoaWNoIGFzc3VtZXMgdGhhdCBsaW5lTnVtIHJlbWFpbnMgc3RhYmxlIGFjcm9zcyByZS1yZW5kZXJzLiBTaG91bGQgY2hlY2sgb24gdGhpcy5cbiAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycgJiYgIXNlbGYuYXJlYXNbY2FudmFzLmlkXSkgeyBhcmVhcyA9IHNlbGYuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgXG4gICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgY2FudmFzLmhlaWdodCA9IDE1O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgIGlmIChzZWxmLm9wdHMudXNlU2NvcmUpIHsgY3R4LmZpbGxTdHlsZSA9IFwicmdiYShcIitzZWxmLnR5cGUoJ2JlZCcpLmNhbGNHcmFkaWVudChjb2xvciwgcEludC52KStcIilcIjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QocEludC54LCAxLCBwSW50LncsIDEzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sYXlvdXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkgfHwgZHJhd1NwZWMudG9vTWFueSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIC8vIFRoaXMgYXBwbGllcyBzdHlsaW5nIHRoYXQgaW5kaWNhdGVzIHRoZXJlIHdhcyB0b28gbXVjaCBkYXRhIHRvIGxvYWQvZHJhdyBhbmQgdGhhdCB0aGUgdXNlciBuZWVkcyB0byB6b29tIHRvIHNlZSBtb3JlXG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodDtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdGZWF0dXJlLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCk7ICAgICAgICAgICAgICBcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmFkZEFyZWEuY2FsbChzZWxmLCBhcmVhcywgZGF0YSwgaSwgbGluZUhlaWdodCwgdXJsVGVtcGxhdGUpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCkuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gL1xcZCssXFxkKyxcXGQrXFxzK1xcZCssXFxkKyxcXGQrLy50ZXN0KG8uY29sb3JCeVN0cmFuZCksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gY29sb3JCeVN0cmFuZE9uID8gby5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLylbMV0gOiAnMCwwLDAnO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZE9uXScpLmF0dHIoJ2NoZWNrZWQnLCAhIWNvbG9yQnlTdHJhbmRPbik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbChjb2xvckJ5U3RyYW5kKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmF0dHIoJ2NoZWNrZWQnLCB0aGlzLmlzT24oby51c2VTY29yZSkpOyAgICBcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoby51cmwpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbG9yQnlTdHJhbmRPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZE9uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgY29sb3JCeVN0cmFuZCA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZF0nKS52YWwoKSxcbiAgICAgIHZhbGlkQ29sb3JCeVN0cmFuZCA9IHRoaXMudmFsaWRhdGVDb2xvcihjb2xvckJ5U3RyYW5kKTtcbiAgICBvLmNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gJiYgdmFsaWRDb2xvckJ5U3RyYW5kID8gby5jb2xvciArICcgJyArIGNvbG9yQnlTdHJhbmQgOiAnJztcbiAgICBvLnVzZVNjb3JlID0gJGRpYWxvZy5maW5kKCdbbmFtZT11c2VTY29yZV0nKS5pcygnOmNoZWNrZWQnKSA/IDEgOiAwO1xuICAgIG8udXJsID0gJGRpYWxvZy5maW5kKCdbbmFtZT11cmxdJykudmFsKCk7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJlZEZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJlZEdyYXBoIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmVkZ3JhcGguaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJlZGdyYXBoXG52YXIgQmVkR3JhcGhGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcnLFxuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgYXV0b1NjYWxlOiAnb24nLFxuICAgIGFsd2F5c1plcm86ICdvZmYnLFxuICAgIGdyaWREZWZhdWx0OiAnb2ZmJyxcbiAgICBtYXhIZWlnaHRQaXhlbHM6ICcxMjg6MTI4OjE1JyxcbiAgICBncmFwaFR5cGU6ICdiYXInLFxuICAgIHZpZXdMaW1pdHM6ICcnLFxuICAgIHlMaW5lTWFyazogMC4wLFxuICAgIHlMaW5lT25PZmY6ICdvZmYnLFxuICAgIHdpbmRvd2luZ0Z1bmN0aW9uOiAnbWF4aW11bScsXG4gICAgc21vb3RoaW5nV2luZG93OiAnb2ZmJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXQuY2FsbCh0aGlzKTsgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHV0aWxzLndpZ0JpbkZ1bmN0aW9ucyxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpOyB9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGdlbm9tZVNpemUgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICBkYXRhID0ge2FsbDogW119LFxuICAgICAgbW9kZSwgbW9kZU9wdHMsIGNoclBvcywgbTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHRoaXMub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBjb2xzID0gWydjaHJvbScsICdjaHJvbVN0YXJ0JywgJ2Nocm9tRW5kJywgJ2RhdGFWYWx1ZSddLFxuICAgICAgICBkYXR1bSA9IHt9LFxuICAgICAgICBjaHJQb3MsIHN0YXJ0LCBlbmQsIHZhbDtcbiAgICAgIF8uZWFjaChsaW5lLnNwbGl0KC9cXHMrLyksIGZ1bmN0aW9uKHYsIGkpIHsgZGF0dW1bY29sc1tpXV0gPSB2OyB9KTtcbiAgICAgIGNoclBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW2RhdHVtLmNocm9tXTtcbiAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgc2VsZi53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSk7XG4gICAgICB9XG4gICAgICBzdGFydCA9IHBhcnNlSW50MTAoZGF0dW0uY2hyb21TdGFydCk7XG4gICAgICBlbmQgPSBwYXJzZUludDEwKGRhdHVtLmNocm9tRW5kKTtcbiAgICAgIHZhbCA9IHBhcnNlRmxvYXQoZGF0dW0uZGF0YVZhbHVlKTtcbiAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBzdGFydCwgZW5kOiBjaHJQb3MgKyBlbmQsIHZhbDogdmFsfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gc2VsZi50eXBlKCd3aWdnbGVfMCcpLmZpbmlzaFBhcnNlLmNhbGwoc2VsZiwgZGF0YSk7XG4gIH0sXG4gIFxuICBpbml0RHJhd1NwZWM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXREcmF3U3BlYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgZHJhd0JhcnM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmRyYXdCYXJzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykucHJlcmVuZGVyLmNhbGwodGhpcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spO1xuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5yZW5kZXIuY2FsbCh0aGlzLCBjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJlZEdyYXBoRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdCZWQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdCZWQuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2s7XG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgUmVtb3RlVHJhY2sgPSByZXF1aXJlKCcuL3V0aWxzL1JlbW90ZVRyYWNrLmpzJykuUmVtb3RlVHJhY2s7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJpZ2JlZFxudmFyIEJpZ0JlZEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjaHJvbW9zb21lczogJycsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiA1MDAsIHBhY2s6IDEwMH0sXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDBcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIGJpZ0JlZCB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBhamF4VXJsID0gc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsXG4gICAgICByZW1vdGU7XG4gICAgXG4gICAgcmVtb3RlID0gbmV3IFJlbW90ZVRyYWNrKGNhY2hlLCBmdW5jdGlvbihzdGFydCwgZW5kLCBzdG9yZUludGVydmFscykge1xuICAgICAgcmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgZGVuc2l0eTogJ3BhY2snfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgXG4gICAgICAgICAgICB2YXIgaXR2bCA9IHNlbGYudHlwZSgnYmVkJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7IFxuICAgICAgICAgICAgLy8gVXNlIEJpb1BlcmwncyBCaW86OkRCOkJpZ0JlZCBzdHJhdGVneSBmb3IgZGVkdXBsaWNhdGluZyByZS1mZXRjaGVkIGludGVydmFsczpcbiAgICAgICAgICAgIC8vIFwiQmVjYXVzZSBCRUQgZmlsZXMgZG9uJ3QgYWN0dWFsbHkgdXNlIElEcywgdGhlIElEIGlzIGNvbnN0cnVjdGVkIGZyb20gdGhlIGZlYXR1cmUncyBuYW1lIChpZiBhbnkpLCBjaHJvbW9zb21lIGNvb3JkaW5hdGVzLCBzdHJhbmQgYW5kIGJsb2NrIGNvdW50LlwiXG4gICAgICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChpdHZsLmlkKSkge1xuICAgICAgICAgICAgICBpdHZsLmlkID0gW2l0dmwubmFtZSwgaXR2bC5jaHJvbSwgaXR2bC5jaHJvbVN0YXJ0LCBpdHZsLmNocm9tRW5kLCBpdHZsLnN0cmFuZCwgaXR2bC5ibG9ja0NvdW50XS5qb2luKFwiXFx0XCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGl0dmw7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhID0ge2NhY2hlOiBjYWNoZSwgcmVtb3RlOiByZW1vdGV9O1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgXG4gICAgLy8gR2V0IGdlbmVyYWwgaW5mbyBvbiB0aGUgYmlnQmVkIGFuZCBzZXR1cCB0aGUgYmlubmluZyBzY2hlbWUgZm9yIHRoZSBSZW1vdGVUcmFja1xuICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICBkYXRhOiB7IHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwgfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgLy8gU2V0IG1heEZldGNoV2luZG93IHRvIGF2b2lkIG92ZXJmZXRjaGluZyBkYXRhLlxuICAgICAgICBpZiAoIXNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgICAgIHZhciBtZWFuSXRlbXNQZXJCcCA9IGRhdGEuaXRlbUNvdW50IC8gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhzZWxmLm9wdHMuZHJhd0xpbWl0KSk7XG4gICAgICAgICAgc2VsZi5vcHRzLm1heEZldGNoV2luZG93ID0gbWF4SXRlbXNUb0RyYXcgLyBtZWFuSXRlbXNQZXJCcDtcbiAgICAgICAgICBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93ID0gTWF0aC5mbG9vcihzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgLyAzKTtcbiAgICAgICAgfVxuICAgICAgICByZW1vdGUuc2V0dXBCaW5zKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSwgc2VsZi5vcHRzLm9wdGltYWxGZXRjaFdpbmRvdywgc2VsZi5vcHRzLm1heEZldGNoV2luZG93KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICByYW5nZSA9IHRoaXMuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXRUbykge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldFRvKSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldFRvKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBmdW5jdGlvbiBwYXJzZURlbnNlRGF0YShkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSwgXG4gICAgICAgIGxpbmVzO1xuICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCB4KSB7IFxuICAgICAgICBpZiAobGluZSAhPSAnbi9hJyAmJiBsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5wdXNoKHt4OiB4LCB3OiAxLCB2OiBwYXJzZUZsb2F0KGxpbmUpICogMTAwMH0pOyB9IFxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICAgIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiBkZW5zaXR5IGlzIG5vdCAnZGVuc2UnIGFuZCB3ZSBjYW4gcmVhc29uYWJseVxuICAgIC8vIGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbWFueSByb3dzICg+NTAwIGZlYXR1cmVzKSwgYXMgdGhpcyB3aWxsIG9ubHkgZGVsYXkgb3RoZXIgcmVxdWVzdHMuXG4gICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJyAmJiAoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWdiZWQucGhwJywge1xuICAgICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIHdpZHRoOiB3aWR0aCwgZGVuc2l0eTogZGVuc2l0eX0sXG4gICAgICAgICAgc3VjY2VzczogcGFyc2VEZW5zZURhdGFcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLmRhdGEucmVtb3RlLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgZnVuY3Rpb24oaW50ZXJ2YWxzKSB7XG4gICAgICAgICAgdmFyIGNhbGNQaXhJbnRlcnZhbCwgZHJhd1NwZWMgPSB7fTtcbiAgICAgICAgICBpZiAoaW50ZXJ2YWxzLnRvb01hbnkpIHsgcmV0dXJuIGNhbGxiYWNrKGludGVydmFscyk7IH1cbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eSA9PSAncGFjaycpO1xuICAgICAgICAgIGRyYXdTcGVjLmxheW91dCA9IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHNlbGYsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSk7XG4gICAgICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICAgICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpZ0JlZEZvcm1hdDsiLCJcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ1dpZyBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ1dpZy5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgQmlnV2lnRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnMTI4LDEyOCwxMjgnLFxuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgYXV0b1NjYWxlOiAnb24nLFxuICAgIGFsd2F5c1plcm86ICdvZmYnLFxuICAgIGdyaWREZWZhdWx0OiAnb2ZmJyxcbiAgICBtYXhIZWlnaHRQaXhlbHM6ICcxMjg6MTI4OjE1JyxcbiAgICBncmFwaFR5cGU6ICdiYXInLFxuICAgIHZpZXdMaW1pdHM6ICcnLFxuICAgIHlMaW5lTWFyazogMC4wLFxuICAgIHlMaW5lT25PZmY6ICdvZmYnLFxuICAgIHdpbmRvd2luZ0Z1bmN0aW9uOiAnbWF4aW11bScsXG4gICAgc21vb3RoaW5nV2luZG93OiAnb2ZmJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnV2lnIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB7J21pbmltdW0nOjEsICdtYXhpbXVtJzoxLCAnbWVhbic6MSwgJ21pbic6MSwgJ21heCc6MSwgJ3N0ZCc6MSwgJ2NvdmVyYWdlJzoxfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuc3RyZXRjaEhlaWdodCA9IHRydWU7XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbihzZWxmLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ3dpZy5waHAnLCB7XG4gICAgICBkYXRhOiB7aW5mbzogMSwgdXJsOiB0aGlzLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICBhc3luYzogZmFsc2UsICAvLyBUaGlzIGlzIGNvb2wgc2luY2UgcGFyc2luZyBub3JtYWxseSBoYXBwZW5zIGluIGEgV2ViIFdvcmtlclxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICB2YXIgcm93cyA9IGRhdGEuc3BsaXQoXCJcXG5cIik7XG4gICAgICAgIF8uZWFjaChyb3dzLCBmdW5jdGlvbihyKSB7XG4gICAgICAgICAgdmFyIGtleXZhbCA9IHIuc3BsaXQoJzogJyk7XG4gICAgICAgICAgaWYgKGtleXZhbFswXT09J21pbicpIHsgc2VsZi5yYW5nZVswXSA9IE1hdGgubWluKHBhcnNlRmxvYXQoa2V5dmFsWzFdKSwgc2VsZi5yYW5nZVswXSk7IH1cbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWF4JykgeyBzZWxmLnJhbmdlWzFdID0gTWF0aC5tYXgocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzFdKTsgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHNlbGYpO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBjaHJSYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gIFxuICAgIGZ1bmN0aW9uIHN1Y2Nlc3MoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gc2VsZi50eXBlKCd3aWdnbGVfMCcpLmluaXREcmF3U3BlYy5jYWxsKHNlbGYsIHByZWNhbGMpLFxuICAgICAgICBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccysvZyk7XG4gICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgaWYgKGxpbmUgPT0gJ24vYScpIHsgZHJhd1NwZWMuYmFycy5wdXNoKG51bGwpOyB9XG4gICAgICAgIGVsc2UgaWYgKGxpbmUubGVuZ3RoKSB7IGRyYXdTcGVjLmJhcnMucHVzaCgocGFyc2VGbG9hdChsaW5lKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZSk7IH1cbiAgICAgIH0pO1xuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgXG4gICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ3dpZy5waHAnLCB7XG4gICAgICBkYXRhOiB7cmFuZ2U6IGNoclJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCB3aWR0aDogd2lkdGgsIHdpbkZ1bmM6IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbn0sXG4gICAgICBzdWNjZXNzOiBzdWNjZXNzXG4gICAgfSk7XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgaGVpZ2h0ID0gY2FudmFzLmhlaWdodCxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aCwgaGVpZ2h0OiBoZWlnaHR9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmRyYXdCYXJzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCk7XG4gICAgICBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG5cbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnV2lnRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gZmVhdHVyZVRhYmxlIGZvcm1hdDogaHR0cDovL3d3dy5pbnNkYy5vcmcvZmlsZXMvZmVhdHVyZV90YWJsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5mZWF0dXJldGFibGVcbnZhciBGZWF0dXJlVGFibGVGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY29sbGFwc2VCeUdlbmU6ICdvZmYnLFxuICAgIGtleUNvbHVtbldpZHRoOiAyMSxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfVxuICB9LFxuICBcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICAgIHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSA9IHRoaXMuaXNPbih0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUpO1xuICAgIHRoaXMuZmVhdHVyZVR5cGVDb3VudHMgPSB7fTtcbiAgfSxcbiAgXG4gIC8vIHBhcnNlcyBvbmUgZmVhdHVyZSBrZXkgKyBsb2NhdGlvbi9xdWFsaWZpZXJzIHJvdyBmcm9tIHRoZSBmZWF0dXJlIHRhYmxlXG4gIHBhcnNlRW50cnk6IGZ1bmN0aW9uKGNocm9tLCBsaW5lcywgc3RhcnRMaW5lTm8pIHtcbiAgICB2YXIgZmVhdHVyZSA9IHtcbiAgICAgICAgY2hyb206IGNocm9tLFxuICAgICAgICBzY29yZTogJz8nLFxuICAgICAgICBibG9ja3M6IG51bGwsXG4gICAgICAgIHF1YWxpZmllcnM6IHt9XG4gICAgICB9LFxuICAgICAga2V5Q29sdW1uV2lkdGggPSB0aGlzLm9wdHMua2V5Q29sdW1uV2lkdGgsXG4gICAgICBxdWFsaWZpZXIgPSBudWxsLFxuICAgICAgZnVsbExvY2F0aW9uID0gW10sXG4gICAgICBjb2xsYXBzZUtleVF1YWxpZmllcnMgPSBbJ2xvY3VzX3RhZycsICdnZW5lJywgJ2RiX3hyZWYnXSxcbiAgICAgIHF1YWxpZmllcnNUaGF0QXJlTmFtZXMgPSBbJ2dlbmUnLCAnbG9jdXNfdGFnJywgJ2RiX3hyZWYnXSxcbiAgICAgIFJOQVR5cGVzID0gWydycm5hJywgJ3RybmEnXSxcbiAgICAgIGFsc29UcnlGb3JSTkFUeXBlcyA9IFsncHJvZHVjdCddLFxuICAgICAgbG9jYXRpb25Qb3NpdGlvbnMsIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJvbV07XG4gICAgc3RhcnRMaW5lTm8gPSBzdGFydExpbmVObyB8fCAwO1xuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIFxuICAgIC8vIGZpbGwgb3V0IGZlYXR1cmUncyBrZXlzIHdpdGggaW5mbyBmcm9tIHRoZXNlIGxpbmVzXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBrZXkgPSBsaW5lLnN1YnN0cigwLCBrZXlDb2x1bW5XaWR0aCksXG4gICAgICAgIHJlc3RPZkxpbmUgPSBsaW5lLnN1YnN0cihrZXlDb2x1bW5XaWR0aCksXG4gICAgICAgIHF1YWxpZmllck1hdGNoID0gcmVzdE9mTGluZS5tYXRjaCgvXlxcLyhcXHcrKSg9PykoLiopLyk7XG4gICAgICBpZiAoa2V5Lm1hdGNoKC9cXHcvKSkge1xuICAgICAgICBmZWF0dXJlLnR5cGUgPSBzdHJpcChrZXkpO1xuICAgICAgICBxdWFsaWZpZXIgPSBudWxsO1xuICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChxdWFsaWZpZXJNYXRjaCkge1xuICAgICAgICAgIHF1YWxpZmllciA9IHF1YWxpZmllck1hdGNoWzFdO1xuICAgICAgICAgIGlmICghZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0pIHsgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0gPSBbXTsgfVxuICAgICAgICAgIGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdLnB1c2goW3F1YWxpZmllck1hdGNoWzJdID8gcXVhbGlmaWVyTWF0Y2hbM10gOiB0cnVlXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHF1YWxpZmllciAhPT0gbnVsbCkgeyBcbiAgICAgICAgICAgIF8ubGFzdChmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZnVsbExvY2F0aW9uLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgZmVhdHVyZS5mdWxsTG9jYXRpb24gPSBmdWxsTG9jYXRpb24gPSBmdWxsTG9jYXRpb24uam9pbignJyk7XG4gICAgbG9jYXRpb25Qb3NpdGlvbnMgPSBfLm1hcChfLmZpbHRlcihmdWxsTG9jYXRpb24uc3BsaXQoL1xcRCsvKSwgXy5pZGVudGl0eSksIHBhcnNlSW50MTApO1xuICAgIGZlYXR1cmUuY2hyb21TdGFydCA9ICBfLm1pbihsb2NhdGlvblBvc2l0aW9ucyk7XG4gICAgZmVhdHVyZS5jaHJvbUVuZCA9IF8ubWF4KGxvY2F0aW9uUG9zaXRpb25zKSArIDE7IC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hyb21FbmQgY29sdW1ucyBpbiBCRUQgZm9ybWF0IGFyZSAqbm90Ki5cbiAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgZmVhdHVyZS5jaHJvbVN0YXJ0O1xuICAgIGZlYXR1cmUuZW5kID0gY2hyUG9zICsgZmVhdHVyZS5jaHJvbUVuZDsgXG4gICAgZmVhdHVyZS5zdHJhbmQgPSAvY29tcGxlbWVudC8udGVzdChmdWxsTG9jYXRpb24pID8gXCItXCIgOiBcIitcIjtcbiAgICBcbiAgICAvLyBVbnRpbCB3ZSBtZXJnZSBieSBnZW5lIG5hbWUsIHdlIGRvbid0IGNhcmUgYWJvdXQgdGhlc2VcbiAgICBmZWF0dXJlLnRoaWNrU3RhcnQgPSBmZWF0dXJlLnRoaWNrRW5kID0gbnVsbDtcbiAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgXG4gICAgLy8gUGFyc2UgdGhlIHF1YWxpZmllcnMgcHJvcGVybHlcbiAgICBfLmVhY2goZmVhdHVyZS5xdWFsaWZpZXJzLCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICBfLmVhY2godiwgZnVuY3Rpb24oZW50cnlMaW5lcywgaSkge1xuICAgICAgICB2W2ldID0gc3RyaXAoZW50cnlMaW5lcy5qb2luKCcgJykpO1xuICAgICAgICBpZiAoL15cIltcXHNcXFNdKlwiJC8udGVzdCh2W2ldKSkge1xuICAgICAgICAgIC8vIERlcXVvdGUgZnJlZSB0ZXh0XG4gICAgICAgICAgdltpXSA9IHZbaV0ucmVwbGFjZSgvXlwifFwiJC9nLCAnJykucmVwbGFjZSgvXCJcIi9nLCAnXCInKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvL2lmICh2Lmxlbmd0aCA9PSAxKSB7IGZlYXR1cmUucXVhbGlmaWVyc1trXSA9IHZbMF07IH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBGaW5kIHNvbWV0aGluZyB0aGF0IGNhbiBzZXJ2ZSBhcyBhIG5hbWVcbiAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnR5cGU7XG4gICAgaWYgKF8uY29udGFpbnMoUk5BVHlwZXMsIGZlYXR1cmUudHlwZS50b0xvd2VyQ2FzZSgpKSkgeyBcbiAgICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHF1YWxpZmllcnNUaGF0QXJlTmFtZXMsIGFsc29UcnlGb3JSTkFUeXBlcyk7IFxuICAgIH1cbiAgICBfLmZpbmQocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgZnVuY3Rpb24oaykge1xuICAgICAgaWYgKGZlYXR1cmUucXVhbGlmaWVyc1trXSAmJiBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pIHsgcmV0dXJuIChmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pOyB9XG4gICAgfSk7XG4gICAgLy8gSW4gdGhlIHdvcnN0IGNhc2UsIGFkZCBhIGNvdW50ZXIgdG8gZGlzYW1iaWd1YXRlIGZlYXR1cmVzIG5hbWVkIG9ubHkgYnkgdHlwZVxuICAgIGlmIChmZWF0dXJlLm5hbWUgPT0gZmVhdHVyZS50eXBlKSB7XG4gICAgICBpZiAoIXRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSkgeyB0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0gPSAxOyB9XG4gICAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLm5hbWUgKyAnXycgKyB0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0rKztcbiAgICB9XG4gICAgXG4gICAgLy8gRmluZCBhIGtleSB0aGF0IGlzIGFwcHJvcHJpYXRlIGZvciBjb2xsYXBzaW5nXG4gICAgaWYgKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgXy5maW5kKGNvbGxhcHNlS2V5UXVhbGlmaWVycywgZnVuY3Rpb24oaykge1xuICAgICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyBcbiAgICAgICAgICByZXR1cm4gKGZlYXR1cmUuX2NvbGxhcHNlS2V5ID0gZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuICBcbiAgLy8gY29sbGFwc2VzIG11bHRpcGxlIGZlYXR1cmVzIHRoYXQgYXJlIGFib3V0IHRoZSBzYW1lIGdlbmUgaW50byBvbmUgZHJhd2FibGUgZmVhdHVyZVxuICBjb2xsYXBzZUZlYXR1cmVzOiBmdW5jdGlvbihmZWF0dXJlcykge1xuICAgIHZhciBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvcyxcbiAgICAgIHByZWZlcnJlZFR5cGVUb01lcmdlSW50byA9IFsnbXJuYScsICdnZW5lJywgJ2NkcyddLFxuICAgICAgcHJlZmVycmVkVHlwZUZvckV4b25zID0gWydleG9uJywgJ2NkcyddLFxuICAgICAgbWVyZ2VJbnRvID0gZmVhdHVyZXNbMF0sXG4gICAgICBibG9ja3MgPSBbXSxcbiAgICAgIGZvdW5kVHlwZSwgY2RzLCBleG9ucztcbiAgICBmb3VuZFR5cGUgPSBfLmZpbmQocHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICB2YXIgZm91bmQgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IHR5cGU7IH0pO1xuICAgICAgaWYgKGZvdW5kKSB7IG1lcmdlSW50byA9IGZvdW5kOyByZXR1cm4gdHJ1ZTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIExvb2sgZm9yIGV4b25zIChldWthcnlvdGljKSBvciBhIENEUyAocHJva2FyeW90aWMpXG4gICAgXy5maW5kKHByZWZlcnJlZFR5cGVGb3JFeG9ucywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgZXhvbnMgPSBfLnNlbGVjdChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZXhvbnMubGVuZ3RoKSB7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgY2RzID0gXy5maW5kKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSBcImNkc1wiOyB9KTtcbiAgICBcbiAgICBfLmVhY2goZXhvbnMsIGZ1bmN0aW9uKGV4b25GZWF0dXJlKSB7XG4gICAgICBleG9uRmVhdHVyZS5mdWxsTG9jYXRpb24ucmVwbGFjZSgvKFxcZCspXFwuXFwuWz48XT8oXFxkKykvZywgZnVuY3Rpb24oZnVsbE1hdGNoLCBzdGFydCwgZW5kKSB7XG4gICAgICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgICAgICBzdGFydDogY2hyUG9zW2V4b25GZWF0dXJlLmNocm9tXSArIE1hdGgubWluKHN0YXJ0LCBlbmQpLCBcbiAgICAgICAgICAvLyBGZWF0dXJlIHRhYmxlIHJhbmdlcyBhcmUgKmluY2x1c2l2ZSogb2YgdGhlIGVuZCBiYXNlLlxuICAgICAgICAgIGVuZDogY2hyUG9zW2V4b25GZWF0dXJlLmNocm9tXSArICBNYXRoLm1heChzdGFydCwgZW5kKSArIDFcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBDb252ZXJ0IGV4b25zIGFuZCBDRFMgaW50byBibG9ja3MsIHRoaWNrU3RhcnQgYW5kIHRoaWNrRW5kIChpbiBCRUQgdGVybWlub2xvZ3kpXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGgpIHsgXG4gICAgICBtZXJnZUludG8uYmxvY2tzID0gXy5zb3J0QnkoYmxvY2tzLCBmdW5jdGlvbihiKSB7IHJldHVybiBiLnN0YXJ0OyB9KTtcbiAgICAgIG1lcmdlSW50by50aGlja1N0YXJ0ID0gY2RzID8gY2RzLnN0YXJ0IDogZmVhdHVyZS5zdGFydDtcbiAgICAgIG1lcmdlSW50by50aGlja0VuZCA9IGNkcyA/IGNkcy5lbmQgOiBmZWF0dXJlLmVuZDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmluYWxseSwgbWVyZ2UgYWxsIHRoZSBxdWFsaWZpZXJzXG4gICAgXy5lYWNoKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7XG4gICAgICBpZiAoZmVhdCA9PT0gbWVyZ2VJbnRvKSB7IHJldHVybjsgfVxuICAgICAgXy5lYWNoKGZlYXQucXVhbGlmaWVycywgZnVuY3Rpb24odmFsdWVzLCBrKSB7XG4gICAgICAgIGlmICghbWVyZ2VJbnRvLnF1YWxpZmllcnNba10pIHsgbWVyZ2VJbnRvLnF1YWxpZmllcnNba10gPSBbXTsgfVxuICAgICAgICBfLmVhY2godmFsdWVzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgICAgaWYgKCFfLmNvbnRhaW5zKG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLCB2KSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXS5wdXNoKHYpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIG1lcmdlSW50bztcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGRhdGEgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KSxcbiAgICAgIG51bUxpbmVzID0gbGluZXMubGVuZ3RoLFxuICAgICAgY2hyb20gPSBudWxsLFxuICAgICAgbGFzdEVudHJ5U3RhcnQgPSBudWxsLFxuICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5ID0ge30sXG4gICAgICBmZWF0dXJlO1xuICAgIFxuICAgIGZ1bmN0aW9uIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKSB7XG4gICAgICBpZiAobGFzdEVudHJ5U3RhcnQgIT09IG51bGwpIHtcbiAgICAgICAgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlRW50cnkuY2FsbChzZWxmLCBjaHJvbSwgbGluZXMuc2xpY2UobGFzdEVudHJ5U3RhcnQsIGxpbmVubyksIGxhc3RFbnRyeVN0YXJ0KTtcbiAgICAgICAgaWYgKGZlYXR1cmUpIHsgXG4gICAgICAgICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgICAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gPSBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldIHx8IFtdO1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XS5wdXNoKGZlYXR1cmUpO1xuICAgICAgICAgIH0gZWxzZSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gQ2h1bmsgdGhlIGxpbmVzIGludG8gZW50cmllcyBhbmQgcGFyc2UgZWFjaCBvZiB0aGVtXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIGlmIChsaW5lLnN1YnN0cigwLCAxMikgPT0gXCJBQ0NFU1NJT04gICBcIikge1xuICAgICAgICBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubyk7XG4gICAgICAgIGNocm9tID0gbGluZS5zdWJzdHIoMTIpO1xuICAgICAgICBsYXN0RW50cnlTdGFydCA9IG51bGw7XG4gICAgICB9IGVsc2UgaWYgKGNocm9tICE9PSBudWxsICYmIGxpbmUuc3Vic3RyKDUsIDEpLm1hdGNoKC9cXHcvKSkge1xuICAgICAgICBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubyk7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbGluZW5vO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHBhcnNlIHRoZSBsYXN0IGVudHJ5XG4gICAgaWYgKGNocm9tICE9PSBudWxsKSB7IGNvbGxlY3RMYXN0RW50cnkobGluZXMubGVuZ3RoKTsgfVxuICAgIFxuICAgIGlmIChvLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmVhY2goZmVhdHVyZXNCeUNvbGxhcHNlS2V5LCBmdW5jdGlvbihmZWF0dXJlcywgZ2VuZSkge1xuICAgICAgICBkYXRhLmFkZChzZWxmLnR5cGUoKS5jb2xsYXBzZUZlYXR1cmVzLmNhbGwoc2VsZiwgZmVhdHVyZXMpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICBzZWxmLmRhdGEgPSBkYXRhO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICAvLyBzcGVjaWFsIGZvcm1hdHRlciBmb3IgY29udGVudCBpbiB0b29sdGlwcyBmb3IgZmVhdHVyZXNcbiAgdGlwVGlwRGF0YTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBxdWFsaWZpZXJzVG9BYmJyZXZpYXRlID0ge3RyYW5zbGF0aW9uOiAxfSxcbiAgICAgIGNvbnRlbnQgPSB7XG4gICAgICAgIHR5cGU6IGRhdGEuZC50eXBlLFxuICAgICAgICBwb3NpdGlvbjogZGF0YS5kLmNocm9tICsgJzonICsgZGF0YS5kLmNocm9tU3RhcnQsIFxuICAgICAgICBzaXplOiBkYXRhLmQuY2hyb21FbmQgLSBkYXRhLmQuY2hyb21TdGFydFxuICAgICAgfTtcbiAgICBpZiAoZGF0YS5kLnF1YWxpZmllcnMubm90ZSAmJiBkYXRhLmQucXVhbGlmaWVycy5ub3RlWzBdKSB7ICB9XG4gICAgXy5lYWNoKGRhdGEuZC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICBpZiAoayA9PSAnbm90ZScpIHsgY29udGVudC5kZXNjcmlwdGlvbiA9IHYuam9pbignOyAnKTsgcmV0dXJuOyB9XG4gICAgICBjb250ZW50W2tdID0gdi5qb2luKCc7ICcpO1xuICAgICAgaWYgKHF1YWxpZmllcnNUb0FiYnJldmlhdGVba10gJiYgY29udGVudFtrXS5sZW5ndGggPiAyNSkgeyBjb250ZW50W2tdID0gY29udGVudFtrXS5zdWJzdHIoMCwgMjUpICsgJy4uLic7IH1cbiAgICB9KTtcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZlYXR1cmVUYWJsZUZvcm1hdDsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4gIFxudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0OyAgXG5cbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9pbnRlcnZhbC10cmVlXG4gKiBJbnRlcnZhbFRyZWVcbiAqXG4gKiBAcGFyYW0gKG9iamVjdCkgZGF0YTpcbiAqIEBwYXJhbSAobnVtYmVyKSBjZW50ZXI6XG4gKiBAcGFyYW0gKG9iamVjdCkgb3B0aW9uczpcbiAqICAgY2VudGVyOlxuICpcbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsVHJlZShjZW50ZXIsIG9wdGlvbnMpIHtcbiAgb3B0aW9ucyB8fCAob3B0aW9ucyA9IHt9KTtcblxuICB0aGlzLnN0YXJ0S2V5ICAgICA9IG9wdGlvbnMuc3RhcnRLZXkgfHwgMDsgLy8gc3RhcnQga2V5XG4gIHRoaXMuZW5kS2V5ICAgICAgID0gb3B0aW9ucy5lbmRLZXkgICB8fCAxOyAvLyBlbmQga2V5XG4gIHRoaXMuaW50ZXJ2YWxIYXNoID0ge307ICAgICAgICAgICAgICAgICAgICAvLyBpZCA9PiBpbnRlcnZhbCBvYmplY3RcbiAgdGhpcy5wb2ludFRyZWUgPSBuZXcgU29ydGVkTGlzdCh7ICAgICAgICAgIC8vIGItdHJlZSBvZiBzdGFydCwgZW5kIHBvaW50cyBcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGFbMF0tIGJbMF07XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLl9hdXRvSW5jcmVtZW50ID0gMDtcblxuICAvLyBpbmRleCBvZiB0aGUgcm9vdCBub2RlXG4gIGlmICghY2VudGVyIHx8IHR5cGVvZiBjZW50ZXIgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgY2VudGVyIGluZGV4IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7XG4gIH1cblxuICB0aGlzLnJvb3QgPSBuZXcgTm9kZShjZW50ZXIsIHRoaXMpO1xufVxuXG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2VcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgaWYgKHRoaXMuY29udGFpbnMoaWQpKSB7XG4gICAgdGhyb3cgbmV3IER1cGxpY2F0ZUVycm9yKCdpZCAnICsgaWQgKyAnIGlzIGFscmVhZHkgcmVnaXN0ZXJlZC4nKTtcbiAgfVxuXG4gIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICB3aGlsZSAodGhpcy5pbnRlcnZhbEhhc2hbdGhpcy5fYXV0b0luY3JlbWVudF0pIHtcbiAgICAgIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgICB9XG4gICAgaWQgPSB0aGlzLl9hdXRvSW5jcmVtZW50O1xuICB9XG5cbiAgdmFyIGl0dmwgPSBuZXcgSW50ZXJ2YWwoZGF0YSwgaWQsIHRoaXMuc3RhcnRLZXksIHRoaXMuZW5kS2V5KTtcbiAgdGhpcy5wb2ludFRyZWUuaW5zZXJ0KFtpdHZsLnN0YXJ0LCBpZF0pO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuZW5kLCAgIGlkXSk7XG4gIHRoaXMuaW50ZXJ2YWxIYXNoW2lkXSA9IGl0dmw7XG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgXG4gIF9pbnNlcnQuY2FsbCh0aGlzLCB0aGlzLnJvb3QsIGl0dmwpO1xufTtcblxuXG4vKipcbiAqIGNoZWNrIGlmIHJhbmdlIGlzIGFscmVhZHkgcHJlc2VudCwgYmFzZWQgb24gaXRzIGlkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmNvbnRhaW5zID0gZnVuY3Rpb24oaWQpIHtcbiAgcmV0dXJuICEhdGhpcy5nZXQoaWQpO1xufVxuXG5cbi8qKlxuICogcmV0cmlldmUgYW4gaW50ZXJ2YWwgYnkgaXRzIGlkOyByZXR1cm5zIG51bGwgaWYgaXQgZG9lcyBub3QgZXhpc3RcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaWQpIHtcbiAgcmV0dXJuIHRoaXMuaW50ZXJ2YWxIYXNoW2lkXSB8fCBudWxsO1xufVxuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHRyeSB7XG4gICAgdGhpcy5hZGQoZGF0YSwgaWQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBEdXBsaWNhdGVFcnJvcikgeyByZXR1cm47IH1cbiAgICB0aHJvdyBlO1xuICB9XG59XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKGludGVnZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyKSB7XG4gIHZhciByZXQgPSBbXTtcbiAgaWYgKHR5cGVvZiB2YWwxICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnOiBpbnZhbGlkIGlucHV0Jyk7XG4gIH1cblxuICBpZiAodmFsMiA9PSB1bmRlZmluZWQpIHtcbiAgICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIHZhbDEsIHJldCk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIHZhbDIgPT0gJ251bWJlcicpIHtcbiAgICBfcmFuZ2VTZWFyY2guY2FsbCh0aGlzLCB2YWwxLCB2YWwyLCByZXQpO1xuICB9XG4gIGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcih2YWwxICsgJywnICsgdmFsMiArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuXG4vKipcbiAqIHJlbW92ZTogXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gdGhlIHNoaWZ0LXJpZ2h0LWFuZC1maWxsIG9wZXJhdG9yLCBleHRlbmRlZCBiZXlvbmQgdGhlIHJhbmdlIG9mIGFuIGludDMyXG5mdW5jdGlvbiBfYml0U2hpZnRSaWdodChudW0pIHtcbiAgaWYgKG51bSA+IDIxNDc0ODM2NDcgfHwgbnVtIDwgLTIxNDc0ODM2NDgpIHsgcmV0dXJuIE1hdGguZmxvb3IobnVtIC8gMik7IH1cbiAgcmV0dXJuIG51bSA+Pj4gMTtcbn1cblxuLyoqXG4gKiBfaW5zZXJ0XG4gKiovXG5mdW5jdGlvbiBfaW5zZXJ0KG5vZGUsIGl0dmwpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoaXR2bC5lbmQgPCBub2RlLmlkeCkge1xuICAgICAgaWYgKCFub2RlLmxlZnQpIHtcbiAgICAgICAgbm9kZS5sZWZ0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAobm9kZS5pZHggPCBpdHZsLnN0YXJ0KSB7XG4gICAgICBpZiAoIW5vZGUucmlnaHQpIHtcbiAgICAgICAgbm9kZS5yaWdodCA9IG5ldyBOb2RlKF9iaXRTaGlmdFJpZ2h0KGl0dmwuc3RhcnQgKyBpdHZsLmVuZCksIHRoaXMpO1xuICAgICAgfVxuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBub2RlLmluc2VydChpdHZsKTtcbiAgICB9XG4gIH1cbn1cblxuXG4vKipcbiAqIF9wb2ludFNlYXJjaFxuICogQHBhcmFtIChOb2RlKSBub2RlXG4gKiBAcGFyYW0gKGludGVnZXIpIGlkeCBcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3BvaW50U2VhcmNoKG5vZGUsIGlkeCwgYXJyKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKCFub2RlKSBicmVhaztcbiAgICBpZiAoaWR4IDwgbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5ldmVyeShmdW5jdGlvbihpdHZsKSB7XG4gICAgICAgIHZhciBib29sID0gKGl0dmwuc3RhcnQgPD0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUubGVmdDtcbiAgICB9IGVsc2UgaWYgKGlkeCA+IG5vZGUuaWR4KSB7XG4gICAgICBub2RlLmVuZHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5lbmQgPj0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5tYXAoZnVuY3Rpb24oaXR2bCkgeyBhcnIucHVzaChpdHZsLnJlc3VsdCgpKSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5cblxuLyoqXG4gKiBfcmFuZ2VTZWFyY2hcbiAqIEBwYXJhbSAoaW50ZWdlcikgc3RhcnRcbiAqIEBwYXJhbSAoaW50ZWdlcikgZW5kXG4gKiBAcGFyYW0gKEFycmF5KSBhcnJcbiAqKi9cbmZ1bmN0aW9uIF9yYW5nZVNlYXJjaChzdGFydCwgZW5kLCBhcnIpIHtcbiAgaWYgKGVuZCAtIHN0YXJ0IDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBzdGFydC4gc3RhcnQ6ICcgKyBzdGFydCArICcsIGVuZDogJyArIGVuZCk7XG4gIH1cbiAgdmFyIHJlc3VsdEhhc2ggPSB7fTtcblxuICB2YXIgd2hvbGVXcmFwcyA9IFtdO1xuICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIF9iaXRTaGlmdFJpZ2h0KHN0YXJ0ICsgZW5kKSwgd2hvbGVXcmFwcywgdHJ1ZSk7XG5cbiAgd2hvbGVXcmFwcy5mb3JFYWNoKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgIHJlc3VsdEhhc2hbcmVzdWx0LmlkXSA9IHRydWU7XG4gIH0pO1xuXG5cbiAgdmFyIGlkeDEgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtzdGFydCwgbnVsbF0pO1xuICB3aGlsZSAoaWR4MSA+PSAwICYmIHRoaXMucG9pbnRUcmVlLmFycltpZHgxXVswXSA9PSBzdGFydCkge1xuICAgIGlkeDEtLTtcbiAgfVxuXG4gIHZhciBpZHgyID0gdGhpcy5wb2ludFRyZWUuYnNlYXJjaChbZW5kLCAgIG51bGxdKTtcbiAgdmFyIGxlbiA9IHRoaXMucG9pbnRUcmVlLmFyci5sZW5ndGggLSAxO1xuICB3aGlsZSAoaWR4MiA9PSAtMSB8fCAoaWR4MiA8PSBsZW4gJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDJdWzBdIDw9IGVuZCkpIHtcbiAgICBpZHgyKys7XG4gIH1cblxuICB0aGlzLnBvaW50VHJlZS5hcnIuc2xpY2UoaWR4MSArIDEsIGlkeDIpLmZvckVhY2goZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgaWQgPSBwb2ludFsxXTtcbiAgICByZXN1bHRIYXNoW2lkXSA9IHRydWU7XG4gIH0sIHRoaXMpO1xuXG4gIE9iamVjdC5rZXlzKHJlc3VsdEhhc2gpLmZvckVhY2goZnVuY3Rpb24oaWQpIHtcbiAgICB2YXIgaXR2bCA9IHRoaXMuaW50ZXJ2YWxIYXNoW2lkXTtcbiAgICBhcnIucHVzaChpdHZsLnJlc3VsdChzdGFydCwgZW5kKSk7XG4gIH0sIHRoaXMpO1xuXG59XG5cblxuXG4vKipcbiAqIHN1YmNsYXNzZXNcbiAqIFxuICoqL1xuXG5cbi8qKlxuICogTm9kZSA6IHByb3RvdHlwZSBvZiBlYWNoIG5vZGUgaW4gYSBpbnRlcnZhbCB0cmVlXG4gKiBcbiAqKi9cbmZ1bmN0aW9uIE5vZGUoaWR4KSB7XG4gIHRoaXMuaWR4ID0gaWR4O1xuICB0aGlzLnN0YXJ0cyA9IG5ldyBTb3J0ZWRMaXN0KHtcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbmRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5lbmQgLSBiLmVuZDtcbiAgICAgIHJldHVybiAoYyA8IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBpbnNlcnQgYW4gSW50ZXJ2YWwgb2JqZWN0IHRvIHRoaXMgbm9kZVxuICoqL1xuTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgdGhpcy5zdGFydHMuaW5zZXJ0KGludGVydmFsKTtcbiAgdGhpcy5lbmRzLmluc2VydChpbnRlcnZhbCk7XG59O1xuXG5cblxuLyoqXG4gKiBJbnRlcnZhbCA6IHByb3RvdHlwZSBvZiBpbnRlcnZhbCBpbmZvXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbChkYXRhLCBpZCwgcywgZSkge1xuICB0aGlzLmlkICAgICA9IGlkO1xuICB0aGlzLnN0YXJ0ICA9IGRhdGFbc107XG4gIHRoaXMuZW5kICAgID0gZGF0YVtlXTtcbiAgdGhpcy5kYXRhICAgPSBkYXRhO1xuXG4gIGlmICh0eXBlb2YgdGhpcy5zdGFydCAhPSAnbnVtYmVyJyB8fCB0eXBlb2YgdGhpcy5lbmQgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0LCBlbmQgbXVzdCBiZSBudW1iZXIuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxuXG4gIGlmICggdGhpcy5zdGFydCA+PSB0aGlzLmVuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQgbXVzdCBiZSBzbWFsbGVyIHRoYW4gZW5kLiBzdGFydDogJyArIHRoaXMuc3RhcnQgKyAnLCBlbmQ6ICcgKyB0aGlzLmVuZCk7XG4gIH1cbn1cblxuLyoqXG4gKiBnZXQgcmVzdWx0IG9iamVjdFxuICoqL1xuSW50ZXJ2YWwucHJvdG90eXBlLnJlc3VsdCA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9IHtcbiAgICBpZCAgIDogdGhpcy5pZCxcbiAgICBkYXRhIDogdGhpcy5kYXRhXG4gIH07XG4gIGlmICh0eXBlb2Ygc3RhcnQgPT0gJ251bWJlcicgJiYgdHlwZW9mIGVuZCA9PSAnbnVtYmVyJykge1xuICAgIC8qKlxuICAgICAqIGNhbGMgb3ZlcmxhcHBpbmcgcmF0ZVxuICAgICAqKi9cbiAgICB2YXIgbGVmdCAgPSBNYXRoLm1heCh0aGlzLnN0YXJ0LCBzdGFydCk7XG4gICAgdmFyIHJpZ2h0ID0gTWF0aC5taW4odGhpcy5lbmQsICAgZW5kKTtcbiAgICB2YXIgbGFwTG4gPSByaWdodCAtIGxlZnQ7XG4gICAgcmV0LnJhdGUxID0gbGFwTG4gLyAoZW5kIC0gc3RhcnQpO1xuICAgIHJldC5yYXRlMiA9IGxhcExuIC8gKHRoaXMuZW5kIC0gdGhpcy5zdGFydCk7XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIER1cGxpY2F0ZUVycm9yKG1lc3NhZ2UpIHtcbiAgICB0aGlzLm5hbWUgPSAnRHVwbGljYXRlRXJyb3InO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy5zdGFjayA9IChuZXcgRXJyb3IoKSkuc3RhY2s7XG59XG5EdXBsaWNhdGVFcnJvci5wcm90b3R5cGUgPSBuZXcgRXJyb3I7XG5cbmV4cG9ydHMuSW50ZXJ2YWxUcmVlID0gSW50ZXJ2YWxUcmVlO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IExpbmVNYXNrOiBBICh2ZXJ5IGNoZWFwKSBhbHRlcm5hdGl2ZSB0byBJbnRlcnZhbFRyZWU6IGEgc21hbGwsIDFEIHBpeGVsIGJ1ZmZlciBvZiBvYmplY3RzLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIFxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2s7XG5cbmZ1bmN0aW9uIExpbmVNYXNrKHdpZHRoLCBmdWRnZSkge1xuICB0aGlzLmZ1ZGdlID0gZnVkZ2UgPSAoZnVkZ2UgfHwgMSk7XG4gIHRoaXMuaXRlbXMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSBNYXRoLmNlaWwod2lkdGggLyBmdWRnZSk7XG4gIHRoaXMubWFzayA9IGdsb2JhbC5VaW50OEFycmF5ID8gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpIDogbmV3IEFycmF5KHRoaXMubGVuZ3RoKTtcbn1cblxuTGluZU1hc2sucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHgsIHcsIGRhdGEpIHtcbiAgdmFyIHVwVG8gPSBNYXRoLmNlaWwoKHggKyB3KSAvIHRoaXMuZnVkZ2UpO1xuICB0aGlzLml0ZW1zLnB1c2goe3g6IHgsIHc6IHcsIGRhdGE6IGRhdGF9KTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgdGhpcy5tYXNrW2ldID0gMTsgfVxufTtcblxuTGluZU1hc2sucHJvdG90eXBlLmNvbmZsaWN0ID0gZnVuY3Rpb24oeCwgdykge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIGZvciAodmFyIGkgPSBNYXRoLm1heChmbG9vckhhY2soeCAvIHRoaXMuZnVkZ2UpLCAwKTsgaSA8IE1hdGgubWluKHVwVG8sIHRoaXMubGVuZ3RoKTsgaSsrKSB7IGlmICh0aGlzLm1hc2tbaV0pIHJldHVybiB0cnVlOyB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmV4cG9ydHMuTGluZU1hc2sgPSBMaW5lTWFzaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7ICBcbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnZhciBwYXJzZUludDEwID0gcmVxdWlyZSgnLi91dGlscy5qcycpLnBhcnNlSW50MTA7XG5cbnZhciBQQUlSSU5HX0NBTk5PVF9NQVRFID0gMCxcbiAgUEFJUklOR19NQVRFX09OTFkgPSAxLFxuICBQQUlSSU5HX0RSQVdfQVNfTUFURVMgPSAyO1xuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIFdyYXBzIHR3byBvZiBTaGluIFN1enVraSdzIEludGVydmFsVHJlZXMgdG8gc3RvcmUgaW50ZXJ2YWxzIHRoYXQgKm1heSpcbiAqIGJlIHBhaXJlZC5cbiAqXG4gKiBAc2VlIEludGVydmFsVHJlZSgpXG4gKiovXG5mdW5jdGlvbiBQYWlyZWRJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMsIHBhaXJlZE9wdGlvbnMpIHtcbiAgdmFyIGRlZmF1bHRPcHRpb25zID0ge3N0YXJ0S2V5OiAwLCBlbmRLZXk6IDF9O1xuICBcbiAgdGhpcy51bnBhaXJlZCA9IG5ldyBJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnVucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHt9LCBkZWZhdWx0T3B0aW9ucywgdW5wYWlyZWRPcHRpb25zKTtcbiAgXG4gIHRoaXMucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnBhaXJlZE9wdGlvbnMgPSBfLmV4dGVuZCh7cGFpcmluZ0tleTogJ3FuYW1lJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbid9LCBkZWZhdWx0T3B0aW9ucywgcGFpcmVkT3B0aW9ucyk7XG4gIGlmICh0aGlzLnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydEtleSBmb3IgdW5wYWlyZWRPcHRpb25zIGFuZCBwYWlyZWRPcHRpb25zIG11c3QgYmUgZGlmZmVyZW50IGluIGEgUGFpcmVkSW50ZXJ2YWxUcmVlJyk7XG4gIH1cbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kS2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSBmYWxzZTtcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSB0aGlzLnBhaXJpbmdNYXhEaXN0YW5jZSA9IG51bGw7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogRGlzYWJsZXMgcGFpcmluZy4gRWZmZWN0aXZlbHkgbWFrZXMgdGhpcyBlcXVpdmFsZW50LCBleHRlcm5hbGx5LCB0byBhbiBJbnRlcnZhbFRyZWUuXG4gKiBUaGlzIGlzIHVzZWZ1bCBpZiB3ZSBkaXNjb3ZlciB0aGF0IHRoaXMgZGF0YSBzb3VyY2UgZG9lc24ndCBjb250YWluIHBhaXJlZCByZWFkcy5cbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuZGlzYWJsZVBhaXJpbmcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSB0cnVlO1xuICB0aGlzLnBhaXJlZCA9IHRoaXMudW5wYWlyZWQ7XG59O1xuXG5cbi8qKlxuICogU2V0IGFuIGludGVydmFsIHdpdGhpbiB3aGljaCBwYWlyZWQgbWF0ZXMgd2lsbCBiZSBzYXZlZCBhcyBhIGNvbnRpbnVvdXMgZmVhdHVyZSBpbiAucGFpcmVkXG4gKlxuICogQHBhcmFtIChudW1iZXIpIG1pbjogTWluaW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqIEBwYXJhbSAobnVtYmVyKSBtYXg6IE1heGltdW0gZGlzdGFuY2UsIGluIGJwXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNldFBhaXJpbmdJbnRlcnZhbCA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gIGlmICh0eXBlb2YgbWluICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtaW4gYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heCAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWF4IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHRoaXMucGFpcmluZ01pbkRpc3RhbmNlICE9PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYmUgY2FsbGVkIG9uY2UuIFlvdSBjYW5cXCd0IGNoYW5nZSB0aGUgcGFpcmluZyBpbnRlcnZhbC4nKTsgfVxuICBcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSBtaW47XG4gIHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbWF4O1xufTtcblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICB2YXIgbWF0ZWQgPSBmYWxzZSxcbiAgICBpbmNyZW1lbnQgPSAwLFxuICAgIHVucGFpcmVkU3RhcnQgPSB0aGlzLnVucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICB1bnBhaXJlZEVuZCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSxcbiAgICBwYWlyZWRTdGFydCA9IHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICBwYWlyZWRFbmQgPSB0aGlzLnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZExlbmd0aCA9IGRhdGFbdGhpcy5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgcGFpcmluZ1N0YXRlID0gUEFJUklOR19DQU5OT1RfTUFURSxcbiAgICBuZXdJZCwgcG90ZW50aWFsTWF0ZTtcbiAgXG4gIC8vIC51bnBhaXJlZCBjb250YWlucyBldmVyeSBhbGlnbm1lbnQgYXMgYSBzZXBhcmF0ZSBpbnRlcnZhbC5cbiAgLy8gSWYgaXQgYWxyZWFkeSBjb250YWlucyB0aGlzIGlkLCB3ZSd2ZSBzZWVuIHRoaXMgcmVhZCBiZWZvcmUgYW5kIHNob3VsZCBkaXNyZWdhcmQuXG4gIGlmICh0aGlzLnVucGFpcmVkLmNvbnRhaW5zKGlkKSkgeyByZXR1cm47IH1cbiAgdGhpcy51bnBhaXJlZC5hZGQoZGF0YSwgaWQpO1xuICBcbiAgLy8gLnBhaXJlZCBjb250YWlucyBhbGlnbm1lbnRzIHRoYXQgbWF5IGJlIG1hdGVkIGludG8gb25lIGludGVydmFsIGlmIHRoZXkgYXJlIHdpdGhpbiB0aGUgcGFpcmluZyByYW5nZVxuICBpZiAoIXRoaXMucGFpcmluZ0Rpc2FibGVkICYmIF9lbGlnaWJsZUZvclBhaXJpbmcodGhpcywgZGF0YSkpIHtcbiAgICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPT09IG51bGwpIHsgXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhbiBvbmx5IGFkZCBwYWlyZWQgZGF0YSBhZnRlciB0aGUgcGFpcmluZyBpbnRlcnZhbCBoYXMgYmVlbiBzZXQhJyk7XG4gICAgfVxuICAgIFxuICAgIC8vIGluc3RlYWQgb2Ygc3RvcmluZyB0aGVtIHdpdGggdGhlIGdpdmVuIGlkLCB0aGUgcGFpcmluZ0tleSAoZm9yIEJBTSwgUU5BTUUpIGlzIHVzZWQgYXMgdGhlIGlkLlxuICAgIC8vIEFzIGludGVydmFscyBhcmUgYWRkZWQsIHdlIGNoZWNrIGlmIGEgcmVhZCB3aXRoIHRoZSBzYW1lIHBhaXJpbmdLZXkgYWxyZWFkeSBleGlzdHMgaW4gdGhlIC5wYWlyZWQgSW50ZXJ2YWxUcmVlLlxuICAgIG5ld0lkID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmluZ0tleV07XG4gICAgcG90ZW50aWFsTWF0ZSA9IHRoaXMucGFpcmVkLmdldChuZXdJZCk7XG4gICAgXG4gICAgaWYgKHBvdGVudGlhbE1hdGUgIT09IG51bGwpIHtcbiAgICAgIHBvdGVudGlhbE1hdGUgPSBwb3RlbnRpYWxNYXRlLmRhdGE7XG4gICAgICBwYWlyaW5nU3RhdGUgPSBfcGFpcmluZ1N0YXRlKHRoaXMsIGRhdGEsIHBvdGVudGlhbE1hdGUpO1xuICAgICAgLy8gQXJlIHRoZSByZWFkcyBzdWl0YWJsZSBmb3IgbWF0aW5nP1xuICAgICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTIHx8IHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19NQVRFX09OTFkpIHtcbiAgICAgICAgLy8gSWYgeWVzOiBtYXRlIHRoZSByZWFkc1xuICAgICAgICBwb3RlbnRpYWxNYXRlLm1hdGUgPSBkYXRhO1xuICAgICAgICAvLyBJbiB0aGUgb3RoZXIgZGlyZWN0aW9uLCBoYXMgdG8gYmUgYSBzZWxlY3RpdmUgc2hhbGxvdyBjb3B5IHRvIGF2b2lkIGNpcmN1bGFyIHJlZmVyZW5jZXMuXG4gICAgICAgIGRhdGEubWF0ZSA9IF8uZXh0ZW5kKHt9LCBfLm9taXQocG90ZW50aWFsTWF0ZSwgZnVuY3Rpb24odiwgaykgeyByZXR1cm4gXy5pc09iamVjdCh2KX0pKTtcbiAgICAgICAgZGF0YS5tYXRlLmZsYWdzID0gXy5jbG9uZShwb3RlbnRpYWxNYXRlLmZsYWdzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gQXJlIHRoZSBtYXRlZCByZWFkcyB3aXRoaW4gZHJhd2FibGUgcmFuZ2U/IElmIHNvLCBzaW1wbHkgZmxhZyB0aGF0IHRoZXkgc2hvdWxkIGJlIGRyYXduIHRvZ2V0aGVyLCBhbmQgdGhleSB3aWxsLlxuICAgIC8vIEFsdGVybmF0aXZlbHksIGlmIHRoZSBwb3RlbnRpYWxNYXRlIGV4cGVjdGVkIGEgbWF0ZSwgd2Ugc2hvdWxkIG1hdGUgdGhlbSBhbnl3YXkuXG4gICAgLy8gVGhlIG9ubHkgcmVhc29uIHdlIHdvdWxkbid0IGdldCAuZHJhd0FzTWF0ZXMgaXMgaWYgdGhlIG1hdGUgd2FzIG9uIHRoZSB0aHJlc2hvbGQgb2YgdGhlIGluc2VydCBzaXplIHJhbmdlLlxuICAgIGlmIChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUyB8fCAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX01BVEVfT05MWSAmJiBwb3RlbnRpYWxNYXRlLm1hdGVFeHBlY3RlZCkpIHtcbiAgICAgIGRhdGEuZHJhd0FzTWF0ZXMgPSBwb3RlbnRpYWxNYXRlLmRyYXdBc01hdGVzID0gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT3RoZXJ3aXNlLCBuZWVkIHRvIGluc2VydCB0aGlzIHJlYWQgaW50byB0aGlzLnBhaXJlZCBhcyBhIHNlcGFyYXRlIHJlYWQuXG4gICAgICAvLyBFbnN1cmUgdGhlIGlkIGlzIHVuaXF1ZSBmaXJzdC5cbiAgICAgIHdoaWxlICh0aGlzLnBhaXJlZC5jb250YWlucyhuZXdJZCkpIHtcbiAgICAgICAgbmV3SWQgPSBuZXdJZC5yZXBsYWNlKC9cXHQuKi8sICcnKSArIFwiXFx0XCIgKyAoKytpbmNyZW1lbnQpO1xuICAgICAgfVxuICAgICAgXG4gICAgICBkYXRhLm1hdGVFeHBlY3RlZCA9IF9wYWlyaW5nU3RhdGUodGhpcywgZGF0YSkgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUztcbiAgICAgIC8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIHBlcmhhcHMgYSBiaXQgdG9vIHNwZWNpZmljIHRvIGhvdyBUTEVOIGZvciBCQU0gZmlsZXMgd29ya3M7IGNvdWxkIGdlbmVyYWxpemUgbGF0ZXJcbiAgICAgIC8vIFdoZW4gaW5zZXJ0aW5nIGludG8gLnBhaXJlZCwgdGhlIGludGVydmFsJ3MgLnN0YXJ0IGFuZCAuZW5kIHNob3VsZG4ndCBiZSBiYXNlZCBvbiBQT1MgYW5kIHRoZSBDSUdBUiBzdHJpbmc7XG4gICAgICAvLyB3ZSBtdXN0IGFkanVzdCB0aGVtIGZvciBUTEVOLCBpZiBpdCBpcyBub256ZXJvLCBkZXBlbmRpbmcgb24gaXRzIHNpZ24sIGFuZCBzZXQgbmV3IGJvdW5kcyBmb3IgdGhlIGludGVydmFsLlxuICAgICAgaWYgKGRhdGEubWF0ZUV4cGVjdGVkICYmIHBhaXJlZExlbmd0aCA+IDApIHtcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdO1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdICsgcGFpcmVkTGVuZ3RoO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLm1hdGVFeHBlY3RlZCAmJiBwYWlyZWRMZW5ndGggPCAwKSB7XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRFbmRdO1xuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRFbmRdICsgcGFpcmVkTGVuZ3RoO1xuICAgICAgfSBlbHNlIHsgLy8gIWRhdGEubWF0ZUV4cGVjdGVkIHx8IHBhaXJlZExlbmd0aCA9PSAwXG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XTtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZEVuZF07XG4gICAgICB9XG4gICAgICBcbiAgICAgIHRoaXMucGFpcmVkLmFkZChkYXRhLCBuZXdJZCk7XG4gICAgfVxuICB9XG5cbn07XG5cblxuLyoqXG4gKiBhbGlhcyAuYWRkKCkgdG8gLmFkZElmTmV3KClcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkID0gUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldztcblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAobnVtYmVyKSB2YWw6XG4gKiBAcmV0dXJuIChhcnJheSlcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24odmFsMSwgdmFsMiwgcGFpcmVkKSB7XG4gIGlmIChwYWlyZWQgJiYgIXRoaXMucGFpcmluZ0Rpc2FibGVkKSB7XG4gICAgcmV0dXJuIHRoaXMucGFpcmVkLnNlYXJjaCh2YWwxLCB2YWwyKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gdGhpcy51bnBhaXJlZC5zZWFyY2godmFsMSwgdmFsMik7XG4gIH1cbn07XG5cblxuLyoqXG4gKiByZW1vdmU6IHVuaW1wbGVtZW50ZWQgZm9yIG5vd1xuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihpbnRlcnZhbF9pZCkge1xuICB0aHJvdyBcIi5yZW1vdmUoKSBpcyBjdXJyZW50bHkgdW5pbXBsZW1lbnRlZFwiO1xufTtcblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDaGVjayBpZiBhbiBpdHZsIGlzIGVsaWdpYmxlIGZvciBwYWlyaW5nLiBcbi8vIEZvciBub3csIHRoaXMgbWVhbnMgdGhhdCBpZiBhbnkgRkxBRydzIDB4MTAwIG9yIGhpZ2hlciBhcmUgc2V0LCB3ZSB0b3RhbGx5IGRpc2NhcmQgdGhpcyBhbGlnbm1lbnQgYW5kIGludGVydmFsLlxuLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgZW50YW5nbGVkIHdpdGggYmFtLmpzIGludGVybmFsczsgcGVyaGFwcyBhbGxvdyB0aGlzIHRvIGJlIGdlbmVyYWxpemVkLCBvdmVycmlkZGVuLFxuLy8gICAgICAgIG9yIHNldCBhbG9uZ3NpZGUgLnNldFBhaXJpbmdJbnRlcnZhbCgpXG4vL1xuLy8gQHJldHVybiAoYm9vbGVhbilcbmZ1bmN0aW9uIF9lbGlnaWJsZUZvclBhaXJpbmcocGFpcmVkSXR2bFRyZWUsIGl0dmwpIHtcbiAgdmFyIGZsYWdzID0gaXR2bC5mbGFncztcbiAgaWYgKGZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50IHx8IGZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQyB8fCBmbGFncy5pc0R1cGxpY2F0ZVJlYWQgfHwgZmxhZ3MuaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50KSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBDaGVjayBpZiBhbiBpdHZsIGFuZCBpdHMgcG90ZW50aWFsTWF0ZSBhcmUgd2l0aGluIHRoZSByaWdodCBkaXN0YW5jZSwgYW5kIG9yaWVudGF0aW9uLCB0byBiZSBtYXRlZC5cbi8vIElmIHBvdGVudGlhbE1hdGUgaXNuJ3QgZ2l2ZW4sIHRha2VzIGEgYmVzdCBndWVzcyBpZiBhIG1hdGUgaXMgZXhwZWN0ZWQsIGdpdmVuIHRoZSBpbmZvcm1hdGlvbiBpbiBpdHZsIGFsb25lLlxuLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgZW50YW5nbGVkIHdpdGggYmFtLmpzIGludGVybmFsczsgcGVyaGFwcyBhbGxvdyB0aGlzIHRvIGJlIGdlbmVyYWxpemVkLCBvdmVycmlkZGVuLFxuLy8gICAgICAgIG9yIHNldCBhbG9uZ3NpZGUgLnNldFBhaXJpbmdJbnRlcnZhbCgpXG4vLyBcbi8vIEByZXR1cm4gKG51bWJlcilcbmZ1bmN0aW9uIF9wYWlyaW5nU3RhdGUocGFpcmVkSXR2bFRyZWUsIGl0dmwsIHBvdGVudGlhbE1hdGUpIHtcbiAgdmFyIHRsZW4gPSBpdHZsW3BhaXJlZEl0dmxUcmVlLnBhaXJlZE9wdGlvbnMucGFpcmVkTGVuZ3RoS2V5XSxcbiAgICBpdHZsTGVuZ3RoID0gaXR2bC5lbmQgLSBpdHZsLnN0YXJ0LFxuICAgIGl0dmxJc0xhdGVyLCBpbmZlcnJlZEluc2VydFNpemU7XG5cbiAgaWYgKF8uaXNVbmRlZmluZWQocG90ZW50aWFsTWF0ZSkpIHtcbiAgICAvLyBDcmVhdGUgdGhlIG1vc3QgcmVjZXB0aXZlIGh5cG90aGV0aWNhbCBtYXRlLCBnaXZlbiB0aGUgaW5mb3JtYXRpb24gaW4gaXR2bC5cbiAgICBwb3RlbnRpYWxNYXRlID0ge1xuICAgICAgX21vY2tlZDogdHJ1ZSxcbiAgICAgIGZsYWdzOiB7XG4gICAgICAgIGlzUmVhZFBhaXJlZDogdHJ1ZSxcbiAgICAgICAgaXNSZWFkUHJvcGVybHlBbGlnbmVkOiB0cnVlLFxuICAgICAgICBpc1JlYWRGaXJzdE9mUGFpcjogaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyLFxuICAgICAgICBpc1JlYWRMYXN0T2ZQYWlyOiBpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIEZpcnN0IGNoZWNrIGEgd2hvbGUgaG9zdCBvZiBGTEFHJ3MuIFRvIG1ha2UgYSBsb25nIHN0b3J5IHNob3J0LCB3ZSBleHBlY3QgcGFpcmVkIGVuZHMgdG8gYmUgZWl0aGVyXG4gIC8vIDk5LTE0NyBvciAxNjMtODMsIGRlcGVuZGluZyBvbiB3aGV0aGVyIHRoZSByaWdodG1vc3Qgb3IgbGVmdG1vc3Qgc2VnbWVudCBpcyBwcmltYXJ5LlxuICBpZiAoIWl0dmwuZmxhZ3MuaXNSZWFkUGFpcmVkIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFBhaXJlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoIWl0dmwuZmxhZ3MuaXNSZWFkUHJvcGVybHlBbGlnbmVkIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFByb3Blcmx5QWxpZ25lZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRVbm1hcHBlZCB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFVubWFwcGVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzTWF0ZVVubWFwcGVkIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MuaXNNYXRlVW5tYXBwZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIgJiYgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcikgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyICYmICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgXG4gIGlmIChwb3RlbnRpYWxNYXRlLl9tb2NrZWQpIHtcbiAgICBfLmV4dGVuZChwb3RlbnRpYWxNYXRlLCB7XG4gICAgICBybmFtZTogaXR2bC5ybmV4dCA9PSAnPScgPyBpdHZsLnJuYW1lIDogaXR2bC5ybmV4dCxcbiAgICAgIHBvczogaXR2bC5wbmV4dCxcbiAgICAgIHN0YXJ0OiBpdHZsLnJuZXh0ID09ICc9JyA/IHBhcnNlSW50MTAoaXR2bC5wbmV4dCkgKyAoaXR2bC5zdGFydCAtIHBhcnNlSW50MTAoaXR2bC5wb3MpKSA6IDAsXG4gICAgICBlbmQ6IHRsZW4gPiAwID8gaXR2bC5zdGFydCArIHRsZW4gOiAodGxlbiA8IDAgPyBpdHZsLmVuZCArIHRsZW4gKyBpdHZsTGVuZ3RoIDogMCksXG4gICAgICBybmV4dDogaXR2bC5ybmV4dCA9PSAnPScgPyAnPScgOiBpdHZsLnJuYW1lLFxuICAgICAgcG5leHQ6IGl0dmwucG9zXG4gICAgfSk7XG4gIH1cbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGFsaWdubWVudHMgYXJlIG9uIHRoZSBzYW1lIHJlZmVyZW5jZSBzZXF1ZW5jZVxuICBpZiAoaXR2bC5ybmV4dCAhPSAnPScgfHwgcG90ZW50aWFsTWF0ZS5ybmV4dCAhPSAnPScpIHsgXG4gICAgLy8gYW5kIGlmIG5vdCwgZG8gdGhlIGNvb3JkaW5hdGVzIG1hdGNoIGF0IGFsbD9cbiAgICBpZiAoaXR2bC5ybmV4dCAhPSBwb3RlbnRpYWxNYXRlLnJuYW1lIHx8IGl0dmwucm5leHQgIT0gcG90ZW50aWFsTWF0ZS5ybmFtZSkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIGlmIChpdHZsLnBuZXh0ICE9IHBvdGVudGlhbE1hdGUucG9zIHx8IGl0dmwucG9zICE9IHBvdGVudGlhbE1hdGUucG5leHQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7XG4gIH1cbiAgXG4gIGlmIChwb3RlbnRpYWxNYXRlLl9tb2NrZWQpIHtcbiAgICBfLmV4dGVuZChwb3RlbnRpYWxNYXRlLmZsYWdzLCB7XG4gICAgICByZWFkU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSxcbiAgICAgIG1hdGVTdHJhbmRSZXZlcnNlOiBpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlXG4gICAgfSk7XG4gIH0gXG4gIFxuICBpdHZsSXNMYXRlciA9IGl0dmwuc3RhcnQgPiBwb3RlbnRpYWxNYXRlLnN0YXJ0O1xuICBpbmZlcnJlZEluc2VydFNpemUgPSBNYXRoLmFicyh0bGVuKTtcbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGFsaWdubWVudHMgYXJlIC0tPiA8LS1cbiAgaWYgKGl0dmxJc0xhdGVyKSB7XG4gICAgaWYgKCFpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8IGl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gICAgaWYgKHBvdGVudGlhbE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgIWl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gICAgaWYgKCFwb3RlbnRpYWxNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIH1cbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGluZmVycmVkSW5zZXJ0U2l6ZSBpcyB3aXRoaW4gdGhlIGFjY2VwdGFibGUgcmFuZ2UuXG4gIGl0dmwuaW5zZXJ0U2l6ZSA9IHBvdGVudGlhbE1hdGUuaW5zZXJ0U2l6ZSA9IGluZmVycmVkSW5zZXJ0U2l6ZTtcbiAgaWYgKGluZmVycmVkSW5zZXJ0U2l6ZSA+IHRoaXMucGFpcmluZ01heERpc3RhbmNlIHx8IGluZmVycmVkSW5zZXJ0U2l6ZSA8IHRoaXMucGFpcmluZ01pbkRpc3RhbmNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICBcbiAgcmV0dXJuIFBBSVJJTkdfRFJBV19BU19NQVRFUztcbn1cblxuZXhwb3J0cy5QYWlyZWRJbnRlcnZhbFRyZWUgPSBQYWlyZWRJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLyoqXG4gICogUmVtb3RlVHJhY2tcbiAgKlxuICAqIEEgaGVscGVyIGNsYXNzIGJ1aWx0IGZvciBjYWNoaW5nIGRhdGEgZmV0Y2hlZCBmcm9tIGEgcmVtb3RlIHRyYWNrIChkYXRhIGFsaWduZWQgdG8gYSBnZW5vbWUpLlxuICAqIFRoZSBnZW5vbWUgaXMgZGl2aWRlZCBpbnRvIGJpbnMgb2Ygb3B0aW1hbEZldGNoV2luZG93IG50cywgZm9yIGVhY2ggb2Ygd2hpY2ggZGF0YSB3aWxsIG9ubHkgYmUgZmV0Y2hlZCBvbmNlLlxuICAqIFRvIHNldHVwIHRoZSBiaW5zLCBjYWxsIC5zZXR1cEJpbnMoLi4uKSBhZnRlciBpbml0aWFsaXppbmcgdGhlIGNsYXNzLlxuICAqXG4gICogVGhlcmUgaXMgb25lIG1haW4gcHVibGljIG1ldGhvZCBmb3IgdGhpcyBjbGFzczogLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgY2FsbGJhY2spXG4gICogKEZvciBjb25zaXN0ZW5jeSB3aXRoIEN1c3RvbVRyYWNrcy5qcywgYWxsIGBzdGFydGAgYW5kIGBlbmRgIHBvc2l0aW9ucyBhcmUgMS1iYXNlZCwgb3JpZW50ZWQgdG9cbiAgKiB0aGUgc3RhcnQgb2YgdGhlIGdlbm9tZSwgYW5kIGludGVydmFscyBhcmUgcmlnaHQtb3Blbi4pXG4gICpcbiAgKiBUaGlzIG1ldGhvZCB3aWxsIHJlcXVlc3QgYW5kIGNhY2hlIGRhdGEgZm9yIHRoZSBnaXZlbiBpbnRlcnZhbCB0aGF0IGlzIG5vdCBhbHJlYWR5IGNhY2hlZCwgYW5kIGNhbGwgXG4gICogY2FsbGJhY2soaW50ZXJ2YWxzKSBhcyBzb29uIGFzIGRhdGEgZm9yIGFsbCBpbnRlcnZhbHMgaXMgYXZhaWxhYmxlLiAoSWYgdGhlIGRhdGEgaXMgYWxyZWFkeSBhdmFpbGFibGUsIFxuICAqIGl0IHdpbGwgY2FsbCB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkuKVxuICAqKi9cblxudmFyIEJJTl9MT0FESU5HID0gMSxcbiAgQklOX0xPQURFRCA9IDI7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrIGNvbnN0cnVjdG9yLlxuICAqXG4gICogTm90ZSB5b3Ugc3RpbGwgbXVzdCBjYWxsIGAuc2V0dXBCaW5zKC4uLilgIGJlZm9yZSB0aGUgUmVtb3RlVHJhY2sgaXMgcmVhZHkgdG8gZmV0Y2ggZGF0YS5cbiAgKlxuICAqIEBwYXJhbSAoSW50ZXJ2YWxUcmVlKSBjYWNoZTogQW4gY2FjaGUgc3RvcmUgdGhhdCB3aWxsIHJlY2VpdmUgaW50ZXJ2YWxzIGZldGNoZWQgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU2hvdWxkIGJlIGFuIEludGVydmFsVHJlZSBvciBlcXVpdmFsZW50LCB0aGF0IGltcGxlbWVudHMgYC5hZGRJZk5ldyguLi4pYCBhbmQgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgLnNlYXJjaChzdGFydCwgZW5kKWAgbWV0aG9kcy4gSWYgaXQgaXMgYW4gKmV4dGVuc2lvbiogb2YgYW4gSW50ZXJ2YWxUcmVlLCBub3RlIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGBleHRyYUFyZ3NgIHBhcmFtIHBlcm1pdHRlZCBmb3IgYC5mZXRjaEFzeW5jKClgLCB3aGljaCBhcmUgcGFzc2VkIGFsb25nIGFzIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0cmEgYXJndW1lbnRzIHRvIGAuc2VhcmNoKClgLlxuICAqIEBwYXJhbSAoZnVuY3Rpb24pIGZldGNoZXI6IEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCB0byBmZXRjaCBkYXRhIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIGZ1bmN0aW9uIHNob3VsZCB0YWtlIHRocmVlIGFyZ3VtZW50cywgYHN0YXJ0YCwgYGVuZGAsIGFuZCBgc3RvcmVJbnRlcnZhbHNgLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0b3JlSW50ZXJ2YWxzYCBpcyBhIGNhbGxiYWNrIHRoYXQgYGZldGNoZXJgIE1VU1QgY2FsbCBvbiB0aGUgYXJyYXkgb2YgaW50ZXJ2YWxzXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgb25jZSB0aGV5IGhhdmUgYmVlbiBmZXRjaGVkIGZyb20gdGhlIHJlbW90ZSBkYXRhIHNvdXJjZSBhbmQgcGFyc2VkLlxuICAqIEBzZWUgX2ZldGNoQmluIGZvciBob3cgYGZldGNoZXJgIGlzIHV0aWxpemVkLlxuICAqKi9cbmZ1bmN0aW9uIFJlbW90ZVRyYWNrKGNhY2hlLCBmZXRjaGVyKSB7XG4gIGlmICh0eXBlb2YgY2FjaGUgIT0gJ29iamVjdCcgfHwgKCFjYWNoZS5hZGRJZk5ldyAmJiAoIV8ua2V5cyhjYWNoZSkubGVuZ3RoIHx8IGNhY2hlW18ua2V5cyhjYWNoZSlbMF1dLmFkZElmTmV3KSkpIHsgXG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGFuIEludGVydmFsVHJlZSBjYWNoZSwgb3IgYW4gb2JqZWN0L2FycmF5IGNvbnRhaW5pbmcgSW50ZXJ2YWxUcmVlcywgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgXG4gIH1cbiAgaWYgKHR5cGVvZiBmZXRjaGVyICE9ICdmdW5jdGlvbicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGEgZmV0Y2hlciBmdW5jdGlvbiBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIFxuICB0aGlzLmNhY2hlID0gY2FjaGU7XG4gIHRoaXMuZmV0Y2hlciA9IGZldGNoZXI7XG4gIFxuICB0aGlzLmNhbGxiYWNrcyA9IFtdO1xuICB0aGlzLmFmdGVyQmluU2V0dXAgPSBbXTtcbiAgdGhpcy5iaW5zTG9hZGVkID0gbnVsbDtcbn1cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG4vLyBTZXR1cCB0aGUgYmlubmluZyBzY2hlbWUgZm9yIHRoaXMgUmVtb3RlVHJhY2suIFRoaXMgY2FuIG9jY3VyIGFueXRpbWUgYWZ0ZXIgaW5pdGlhbGl6YXRpb24sIGFuZCBpbiBmYWN0LFxuLy8gY2FuIG9jY3VyIGFmdGVyIGNhbGxzIHRvIGAuZmV0Y2hBc3luYygpYCBoYXZlIGJlZW4gbWFkZSwgaW4gd2hpY2ggY2FzZSB0aGV5IHdpbGwgYmUgd2FpdGluZyBvbiB0aGlzIG1ldGhvZFxuLy8gdG8gYmUgY2FsbGVkIHRvIHByb2NlZWQuIEJ1dCBpdCBNVVNUIGJlIGNhbGxlZCBiZWZvcmUgZGF0YSB3aWxsIGJlIHJlY2VpdmVkIGJ5IGNhbGxiYWNrcyBwYXNzZWQgdG8gXG4vLyBgLmZldGNoQXN5bmMoKWAuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuc2V0dXBCaW5zID0gZnVuY3Rpb24oZ2Vub21lU2l6ZSwgb3B0aW1hbEZldGNoV2luZG93LCBtYXhGZXRjaFdpbmRvdykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChzZWxmLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IHJ1biBzZXR1cEJpbnMgbW9yZSB0aGFuIG9uY2UuJyk7IH1cbiAgaWYgKHR5cGVvZiBnZW5vbWVTaXplICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSB0aGUgZ2Vub21lU2l6ZSBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2Ygb3B0aW1hbEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBvcHRpbWFsRmV0Y2hXaW5kb3cgYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXhGZXRjaFdpbmRvdyBhcyB0aGUgM3JkIGFyZ3VtZW50LicpOyB9XG4gIFxuICBzZWxmLmdlbm9tZVNpemUgPSBnZW5vbWVTaXplO1xuICBzZWxmLm9wdGltYWxGZXRjaFdpbmRvdyA9IG9wdGltYWxGZXRjaFdpbmRvdztcbiAgc2VsZi5tYXhGZXRjaFdpbmRvdyA9IG1heEZldGNoV2luZG93O1xuICBcbiAgc2VsZi5udW1CaW5zID0gTWF0aC5jZWlsKGdlbm9tZVNpemUgLyBvcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICBzZWxmLmJpbnNMb2FkZWQgPSB7fTtcbiAgXG4gIC8vIEZpcmUgb2ZmIHJhbmdlcyBzYXZlZCB0byBhZnRlckJpblNldHVwXG4gIF8uZWFjaCh0aGlzLmFmdGVyQmluU2V0dXAsIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgc2VsZi5mZXRjaEFzeW5jKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQsIHJhbmdlLmV4dHJhQXJncyk7XG4gIH0pO1xuICBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMoc2VsZik7XG59XG5cblxuLy8gRmV0Y2hlcyBkYXRhIChpZiBuZWNlc3NhcnkpIGZvciB1bmZldGNoZWQgYmlucyBvdmVybGFwcGluZyB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBUaGVuLCBydW4gYGNhbGxiYWNrYCBvbiBhbGwgc3RvcmVkIHN1YmludGVydmFscyB0aGF0IG92ZXJsYXAgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gYGV4dHJhQXJnc2AgaXMgYW4gKm9wdGlvbmFsKiBwYXJhbWV0ZXIgdGhhdCBjYW4gY29udGFpbiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZSBgLnNlYXJjaCgpYCBmdW5jdGlvbiBvZiB0aGUgY2FjaGUuXG4vL1xuLy8gQHBhcmFtIChudW1iZXIpIHN0YXJ0OiAgICAgICAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZSB0byBzdGFydCBmZXRjaGluZyBmcm9tXG4vLyBAcGFyYW0gKG51bWJlcikgZW5kOiAgICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIChyaWdodC1vcGVuKSB0byBzdGFydCBmZXRjaGluZyAqdW50aWwqXG4vLyBAcGFyYW0gKEFycmF5KSBbZXh0cmFBcmdzXTogIG9wdGlvbmFsLCBwYXNzZWQgYWxvbmcgdG8gdGhlIGAuc2VhcmNoKClgIGNhbGxzIG9uIHRoZSAuY2FjaGUgYXMgYXJndW1lbnRzIDMgYW5kIHVwOyBcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyaGFwcyB1c2VmdWwgaWYgdGhlIC5jYWNoZSBoYXMgb3ZlcnJpZGRlbiB0aGlzIG1ldGhvZFxuLy8gQHBhcmFtIChmdW5jdGlvbikgY2FsbGJhY2s6ICBBIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgb25jZSBkYXRhIGlzIHJlYWR5IGZvciB0aGlzIGludGVydmFsLiBXaWxsIGJlIHBhc3NlZFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGwgaW50ZXJ2YWwgZmVhdHVyZXMgdGhhdCBoYXZlIGJlZW4gZmV0Y2hlZCBmb3IgdGhpcyBpbnRlcnZhbCwgb3Ige3Rvb01hbnk6IHRydWV9XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIG1vcmUgZGF0YSB3YXMgcmVxdWVzdGVkIHRoYW4gY291bGQgYmUgcmVhc29uYWJseSBmZXRjaGVkLlxuUmVtb3RlVHJhY2sucHJvdG90eXBlLmZldGNoQXN5bmMgPSBmdW5jdGlvbihzdGFydCwgZW5kLCBleHRyYUFyZ3MsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKF8uaXNGdW5jdGlvbihleHRyYUFyZ3MpICYmIF8uaXNVbmRlZmluZWQoY2FsbGJhY2spKSB7IGNhbGxiYWNrID0gZXh0cmFBcmdzOyBleHRyYUFyZ3MgPSB1bmRlZmluZWQ7IH1cbiAgaWYgKCFzZWxmLmJpbnNMb2FkZWQpIHtcbiAgICAvLyBJZiBiaW5zICphcmVuJ3QqIHNldHVwIHlldDpcbiAgICAvLyBTYXZlIHRoZSBjYWxsYmFjayBvbnRvIHRoZSBxdWV1ZVxuICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IFxuICAgICAgc2VsZi5jYWxsYmFja3MucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3MsIGNhbGxiYWNrOiBjYWxsYmFja30pOyBcbiAgICB9XG4gICAgXG4gICAgLy8gU2F2ZSB0aGlzIGZldGNoIGZvciB3aGVuIHRoZSBiaW5zIGFyZSBsb2FkZWRcbiAgICBzZWxmLmFmdGVyQmluU2V0dXAucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3N9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBiaW5zICphcmUqIHNldHVwLCBmaXJzdCBjYWxjdWxhdGUgd2hpY2ggYmlucyBjb3JyZXNwb25kIHRvIHRoaXMgaW50ZXJ2YWwsIFxuICAgIC8vIGFuZCB3aGF0IHN0YXRlIHRob3NlIGJpbnMgYXJlIGluXG4gICAgdmFyIGJpbnMgPSBfYmluT3ZlcmxhcChzZWxmLCBzdGFydCwgZW5kKSxcbiAgICAgIGxvYWRlZEJpbnMgPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiBzZWxmLmJpbnNMb2FkZWRbaV0gPT09IEJJTl9MT0FERUQ7IH0pLFxuICAgICAgYmluc1RvRmV0Y2ggPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiAhc2VsZi5iaW5zTG9hZGVkW2ldOyB9KTtcbiAgICBcbiAgICBpZiAobG9hZGVkQmlucy5sZW5ndGggPT0gYmlucy5sZW5ndGgpIHtcbiAgICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgbG9hZGVkIGRhdGEgZm9yIGFsbCB0aGUgYmlucyBpbiBxdWVzdGlvbiwgc2hvcnQtY2lyY3VpdCBhbmQgcnVuIHRoZSBjYWxsYmFjayBub3dcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoZXh0cmFBcmdzKSA/IFtdIDogZXh0cmFBcmdzO1xuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soc2VsZi5jYWNoZS5zZWFyY2guYXBwbHkoc2VsZi5jYWNoZSwgW3N0YXJ0LCBlbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgfSBlbHNlIGlmIChlbmQgLSBzdGFydCA+IHNlbGYubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIC8vIGVsc2UsIGlmIHRoaXMgaW50ZXJ2YWwgaXMgdG9vIGJpZyAoPiBtYXhGZXRjaFdpbmRvdyksIGZpcmUgdGhlIGNhbGxiYWNrIHJpZ2h0IGF3YXkgd2l0aCB7dG9vTWFueTogdHJ1ZX1cbiAgICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIGVsc2UsIHB1c2ggdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyB0aGVuIHJ1biBmZXRjaGVzIGZvciB0aGUgdW5mZXRjaGVkIGJpbnMsIHdoaWNoIHNob3VsZCBjYWxsIF9maXJlQ2FsbGJhY2tzIGFmdGVyIHRoZXkgY29tcGxldGUsXG4gICAgLy8gd2hpY2ggd2lsbCBhdXRvbWF0aWNhbGx5IGZpcmUgY2FsbGJhY2tzIGZyb20gdGhlIGFib3ZlIHF1ZXVlIGFzIHRoZXkgYWNxdWlyZSBhbGwgbmVlZGVkIGRhdGEuXG4gICAgXy5lYWNoKGJpbnNUb0ZldGNoLCBmdW5jdGlvbihiaW5JbmRleCkge1xuICAgICAgX2ZldGNoQmluKHNlbGYsIGJpbkluZGV4LCBmdW5jdGlvbigpIHsgX2ZpcmVDYWxsYmFja3Moc2VsZik7IH0pO1xuICAgIH0pO1xuICB9XG59XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2FsY3VsYXRlcyB3aGljaCBiaW5zIG92ZXJsYXAgd2l0aCBhbiBpbnRlcnZhbCBnaXZlbiBieSBgc3RhcnRgIGFuZCBgZW5kYC5cbi8vIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuZnVuY3Rpb24gX2Jpbk92ZXJsYXAocmVtb3RlVHJrLCBzdGFydCwgZW5kKSB7XG4gIGlmICghcmVtb3RlVHJrLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IGNhbGN1bGF0ZSBiaW4gb3ZlcmxhcCBiZWZvcmUgc2V0dXBCaW5zIGlzIGNhbGxlZC4nKTsgfVxuICAvLyBJbnRlcm5hbGx5LCBmb3IgYXNzaWduaW5nIGNvb3JkaW5hdGVzIHRvIGJpbnMsIHdlIHVzZSAwLWJhc2VkIGNvb3JkaW5hdGVzIGZvciBlYXNpZXIgY2FsY3VsYXRpb25zLlxuICB2YXIgc3RhcnRCaW4gPSBNYXRoLmZsb29yKChzdGFydCAtIDEpIC8gcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyksXG4gICAgZW5kQmluID0gTWF0aC5mbG9vcigoZW5kIC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KTtcbiAgcmV0dXJuIF8ucmFuZ2Uoc3RhcnRCaW4sIGVuZEJpbiArIDEpO1xufVxuXG4vLyBSdW5zIHRoZSBmZXRjaGVyIGZ1bmN0aW9uIG9uIGEgZ2l2ZW4gYmluLlxuLy8gVGhlIGZldGNoZXIgZnVuY3Rpb24gaXMgb2JsaWdhdGVkIHRvIHJ1biBhIGNhbGxiYWNrIGZ1bmN0aW9uIGBzdG9yZUludGVydmFsc2AsIFxuLy8gICAgcGFzc2VkIGFzIGl0cyB0aGlyZCBhcmd1bWVudCwgb24gYSBzZXQgb2YgaW50ZXJ2YWxzIHRoYXQgd2lsbCBiZSBpbnNlcnRlZCBpbnRvIHRoZSBcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBJbnRlcnZhbFRyZWUuXG4vLyBUaGUgYHN0b3JlSW50ZXJ2YWxzYCBmdW5jdGlvbiBtYXkgYWNjZXB0IGEgc2Vjb25kIGFyZ3VtZW50IGNhbGxlZCBgY2FjaGVJbmRleGAsIGluIGNhc2Vcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBpcyBhY3R1YWxseSBhIGNvbnRhaW5lciBmb3IgbXVsdGlwbGUgSW50ZXJ2YWxUcmVlcywgaW5kaWNhdGluZyB3aGljaCBcbi8vICAgIG9uZSB0byBzdG9yZSBpdCBpbi5cbi8vIFdlIHRoZW4gY2FsbCB0aGUgYGNhbGxiYWNrYCBnaXZlbiBoZXJlIGFmdGVyIHRoYXQgaXMgY29tcGxldGUuXG5mdW5jdGlvbiBfZmV0Y2hCaW4ocmVtb3RlVHJrLCBiaW5JbmRleCwgY2FsbGJhY2spIHtcbiAgdmFyIHN0YXJ0ID0gYmluSW5kZXggKiByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93ICsgMSxcbiAgICBlbmQgPSAoYmluSW5kZXggKyAxKSAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxO1xuICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BRElORztcbiAgcmVtb3RlVHJrLmZldGNoZXIoc3RhcnQsIGVuZCwgZnVuY3Rpb24gc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKSB7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIGlmICghaW50ZXJ2YWwpIHsgcmV0dXJuOyB9XG4gICAgICByZW1vdGVUcmsuY2FjaGUuYWRkSWZOZXcoaW50ZXJ2YWwsIGludGVydmFsLmlkKTtcbiAgICB9KTtcbiAgICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BREVEO1xuICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgfSk7XG59XG5cbi8vIFJ1bnMgdGhyb3VnaCBhbGwgc2F2ZWQgY2FsbGJhY2tzIGFuZCBmaXJlcyBhbnkgY2FsbGJhY2tzIHdoZXJlIGFsbCB0aGUgcmVxdWlyZWQgZGF0YSBpcyByZWFkeVxuLy8gQ2FsbGJhY2tzIHRoYXQgYXJlIGZpcmVkIGFyZSByZW1vdmVkIGZyb20gdGhlIHF1ZXVlLlxuZnVuY3Rpb24gX2ZpcmVDYWxsYmFja3MocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2ssXG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGFmdGVyTG9hZC5leHRyYUFyZ3MpID8gW10gOiBhZnRlckxvYWQuZXh0cmFBcmdzLFxuICAgICAgYmlucywgc3RpbGxMb2FkaW5nQmlucztcbiAgICAgICAgXG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIGJpbnMgPSBfYmluT3ZlcmxhcChyZW1vdGVUcmssIGFmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZCk7XG4gICAgc3RpbGxMb2FkaW5nQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHJlbW90ZVRyay5iaW5zTG9hZGVkW2ldICE9PSBCSU5fTE9BREVEOyB9KS5sZW5ndGggPiAwO1xuICAgIGlmICghc3RpbGxMb2FkaW5nQmlucykge1xuICAgICAgY2FsbGJhY2socmVtb3RlVHJrLmNhY2hlLnNlYXJjaC5hcHBseShyZW1vdGVUcmsuY2FjaGUsIFthZnRlckxvYWQuc3RhcnQsIGFmdGVyTG9hZC5lbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3MgZm9yIHdoaWNoIHdlIHdvbid0IGxvYWQgZGF0YSBzaW5jZSB0aGUgYW1vdW50XG4vLyByZXF1ZXN0ZWQgaXMgdG9vIGxhcmdlLiBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2s7XG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuXG5leHBvcnRzLlJlbW90ZVRyYWNrID0gUmVtb3RlVHJhY2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvU29ydGVkTGlzdFxuICpcbiAqIFNvcnRlZExpc3QgOiBjb25zdHJ1Y3RvclxuICogXG4gKiBAcGFyYW0gYXJyIDogQXJyYXkgb3IgbnVsbCA6IGFuIGFycmF5IHRvIHNldFxuICpcbiAqIEBwYXJhbSBvcHRpb25zIDogb2JqZWN0ICBvciBudWxsXG4gKiAgICAgICAgIChmdW5jdGlvbikgZmlsdGVyICA6IGZpbHRlciBmdW5jdGlvbiBjYWxsZWQgYmVmb3JlIGluc2VydGluZyBkYXRhLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIHJlY2VpdmVzIGEgdmFsdWUgYW5kIHJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdmFsaWQuXG4gKlxuICogICAgICAgICAoZnVuY3Rpb24pIGNvbXBhcmUgOiBmdW5jdGlvbiB0byBjb21wYXJlIHR3byB2YWx1ZXMsIFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGljaCBpcyB1c2VkIGZvciBzb3J0aW5nIG9yZGVyLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgc2FtZSBzaWduYXR1cmUgYXMgQXJyYXkucHJvdG90eXBlLnNvcnQoZm4pLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAqICAgICAgICAgKHN0cmluZykgICBjb21wYXJlIDogaWYgeW91J2QgbGlrZSB0byBzZXQgYSBjb21tb24gY29tcGFyaXNvbiBmdW5jdGlvbixcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeW91IGNhbiBzcGVjaWZ5IGl0IGJ5IHN0cmluZzpcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJudW1iZXJcIiA6IGNvbXBhcmVzIG51bWJlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcInN0cmluZ1wiIDogY29tcGFyZXMgc3RyaW5nXG4gKi9cbmZ1bmN0aW9uIFNvcnRlZExpc3QoKSB7XG4gIHZhciBhcnIgICAgID0gbnVsbCxcbiAgICAgIG9wdGlvbnMgPSB7fSxcbiAgICAgIGFyZ3MgICAgPSBhcmd1bWVudHM7XG5cbiAgW1wiMFwiLFwiMVwiXS5mb3JFYWNoKGZ1bmN0aW9uKG4pIHtcbiAgICB2YXIgdmFsID0gYXJnc1tuXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG4gICAgICBhcnIgPSB2YWw7XG4gICAgfVxuICAgIGVsc2UgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09IFwib2JqZWN0XCIpIHtcbiAgICAgIG9wdGlvbnMgPSB2YWw7XG4gICAgfVxuICB9KTtcbiAgdGhpcy5hcnIgPSBbXTtcblxuICBbXCJmaWx0ZXJcIiwgXCJjb21wYXJlXCJdLmZvckVhY2goZnVuY3Rpb24oaykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9uc1trXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRoaXNba10gPSBvcHRpb25zW2tdO1xuICAgIH1cbiAgICBlbHNlIGlmIChvcHRpb25zW2tdICYmIFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV0pIHtcbiAgICAgIHRoaXNba10gPSBTb3J0ZWRMaXN0W2tdW29wdGlvbnNba11dO1xuICAgIH1cbiAgfSwgdGhpcyk7XG4gIGlmIChhcnIpIHRoaXMubWFzc0luc2VydChhcnIpO1xufTtcblxuLy8gQmluYXJ5IHNlYXJjaCBmb3IgdGhlIGluZGV4IG9mIHRoZSBpdGVtIGVxdWFsIHRvIGB2YWxgLCBvciBpZiBubyBzdWNoIGl0ZW0gZXhpc3RzLCB0aGUgbmV4dCBsb3dlciBpdGVtXG4vLyBUaGlzIGNhbiBiZSAtMSBpZiBgdmFsYCBpcyBsb3dlciB0aGFuIHRoZSBsb3dlc3QgaXRlbSBpbiB0aGUgU29ydGVkTGlzdFxuU29ydGVkTGlzdC5wcm90b3R5cGUuYnNlYXJjaCA9IGZ1bmN0aW9uKHZhbCkge1xuICB2YXIgbXBvcyxcbiAgICAgIHNwb3MgPSAwLFxuICAgICAgZXBvcyA9IHRoaXMuYXJyLmxlbmd0aDtcbiAgd2hpbGUgKGVwb3MgLSBzcG9zID4gMSkge1xuICAgIG1wb3MgPSBNYXRoLmZsb29yKChzcG9zICsgZXBvcykvMik7XG4gICAgbXZhbCA9IHRoaXMuYXJyW21wb3NdO1xuICAgIHN3aXRjaCAodGhpcy5jb21wYXJlKHZhbCwgbXZhbCkpIHtcbiAgICBjYXNlIDEgIDpcbiAgICBkZWZhdWx0IDpcbiAgICAgIHNwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAtMSA6XG4gICAgICBlcG9zID0gbXBvcztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMCAgOlxuICAgICAgcmV0dXJuIG1wb3M7XG4gICAgfVxuICB9XG4gIHJldHVybiAodGhpcy5hcnJbMF0gPT0gbnVsbCB8fCBzcG9zID09IDAgJiYgdGhpcy5hcnJbMF0gIT0gbnVsbCAmJiB0aGlzLmNvbXBhcmUodGhpcy5hcnJbMF0sIHZhbCkgPT0gMSkgPyAtMSA6IHNwb3M7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyW3Bvc107XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHJldHVybiB0aGlzLmFyci5zbGljZSgpO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlLmFwcGx5KHRoaXMuYXJyLCBhcmd1bWVudHMpO1xufVxuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyci5sZW5ndGg7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5oZWFkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyclswXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRhaWwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICh0aGlzLmFyci5sZW5ndGggPT0gMCkgPyBudWxsIDogdGhpcy5hcnJbdGhpcy5hcnIubGVuZ3RoIC0xXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLm1hc3NJbnNlcnQgPSBmdW5jdGlvbihpdGVtcykge1xuICAvLyBUaGlzIGxvb3AgYXZvaWRzIGNhbGwgc3RhY2sgb3ZlcmZsb3cgYmVjYXVzZSBvZiB0b28gbWFueSBhcmd1bWVudHNcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gNDA5Nikge1xuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHRoaXMuYXJyLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChpdGVtcywgaSwgaSArIDQwOTYpKTtcbiAgfVxuICB0aGlzLmFyci5zb3J0KHRoaXMuY29tcGFyZSk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEwMCkge1xuICAgIC8vIC5ic2VhcmNoICsgLnNwbGljZSBpcyB0b28gZXhwZW5zaXZlIHRvIHJlcGVhdCBmb3Igc28gbWFueSBlbGVtZW50cy5cbiAgICAvLyBMZXQncyBqdXN0IGFwcGVuZCB0aGVtIGFsbCB0byB0aGlzLmFyciBhbmQgcmVzb3J0LlxuICAgIHRoaXMubWFzc0luc2VydChhcmd1bWVudHMpO1xuICB9IGVsc2Uge1xuICAgIEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbih2YWwpIHtcbiAgICAgIHZhciBwb3MgPSB0aGlzLmJzZWFyY2godmFsKTtcbiAgICAgIGlmICh0aGlzLmZpbHRlcih2YWwsIHBvcykpIHtcbiAgICAgICAgdGhpcy5hcnIuc3BsaWNlKHBvcysxLCAwLCB2YWwpO1xuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICB9XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5maWx0ZXIgPSBmdW5jdGlvbih2YWwsIHBvcykge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmFkZCA9IFNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydDtcblxuU29ydGVkTGlzdC5wcm90b3R5cGVbXCJkZWxldGVcIl0gPSBmdW5jdGlvbihwb3MpIHtcbiAgdGhpcy5hcnIuc3BsaWNlKHBvcywgMSk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBTb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc1JlbW92ZSA9IGZ1bmN0aW9uKHN0YXJ0UG9zLCBjb3VudCkge1xuICB0aGlzLmFyci5zcGxpY2Uoc3RhcnRQb3MsIGNvdW50KTtcbn07XG5cbi8qKlxuICogZGVmYXVsdCBjb21wYXJlIGZ1bmN0aW9ucyBcbiAqKi9cblNvcnRlZExpc3QuY29tcGFyZSA9IHtcbiAgXCJudW1iZXJcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBjID0gYSAtIGI7XG4gICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICB9LFxuXG4gIFwic3RyaW5nXCI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gKGEgPiBiKSA/IDEgOiAoYSA9PSBiKSAgPyAwIDogLTE7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmNvbXBhcmUgPSBTb3J0ZWRMaXN0LmNvbXBhcmVbXCJudW1iZXJcIl07XG5cbmV4cG9ydHMuU29ydGVkTGlzdCA9IFNvcnRlZExpc3Q7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCJ2YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbi8vIFBhcnNlIGEgdHJhY2sgZGVjbGFyYXRpb24gbGluZSwgd2hpY2ggaXMgaW4gdGhlIGZvcm1hdCBvZjpcbi8vIHRyYWNrIG5hbWU9XCJibGFoXCIgb3B0bmFtZTE9XCJ2YWx1ZTFcIiBvcHRuYW1lMj1cInZhbHVlMlwiIC4uLlxuLy8gaW50byBhIGhhc2ggb2Ygb3B0aW9uc1xubW9kdWxlLmV4cG9ydHMucGFyc2VEZWNsYXJhdGlvbkxpbmUgPSBmdW5jdGlvbihsaW5lLCBzdGFydCkge1xuICB2YXIgb3B0cyA9IHt9LCBvcHRuYW1lID0gJycsIHZhbHVlID0gJycsIHN0YXRlID0gJ29wdG5hbWUnO1xuICBmdW5jdGlvbiBwdXNoVmFsdWUocXVvdGluZykge1xuICAgIHN0YXRlID0gJ29wdG5hbWUnO1xuICAgIG9wdHNbb3B0bmFtZS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyldID0gdmFsdWU7XG4gICAgb3B0bmFtZSA9IHZhbHVlID0gJyc7XG4gIH1cbiAgZm9yIChpID0gbGluZS5tYXRjaChzdGFydClbMF0ubGVuZ3RoOyBpIDwgbGluZS5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBsaW5lW2ldO1xuICAgIGlmIChzdGF0ZSA9PSAnb3B0bmFtZScpIHtcbiAgICAgIGlmIChjID09ICc9JykgeyBzdGF0ZSA9ICdzdGFydHZhbHVlJzsgfVxuICAgICAgZWxzZSB7IG9wdG5hbWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3N0YXJ0dmFsdWUnKSB7XG4gICAgICBpZiAoLyd8XCIvLnRlc3QoYykpIHsgc3RhdGUgPSBjOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgc3RhdGUgPSAndmFsdWUnOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7XG4gICAgICBpZiAoL1xccy8udGVzdChjKSkgeyBwdXNoVmFsdWUoKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKC8nfFwiLy50ZXN0KHN0YXRlKSkge1xuICAgICAgaWYgKGMgPT0gc3RhdGUpIHsgcHVzaFZhbHVlKHN0YXRlKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9XG4gIH1cbiAgaWYgKHN0YXRlID09ICd2YWx1ZScpIHsgcHVzaFZhbHVlKCk7IH1cbiAgaWYgKHN0YXRlICE9ICdvcHRuYW1lJykgeyByZXR1cm4gZmFsc2U7IH1cbiAgcmV0dXJuIG9wdHM7XG59XG5cbi8vIENvbnN0cnVjdHMgYSBtYXBwaW5nIGZ1bmN0aW9uIHRoYXQgY29udmVydHMgYnAgaW50ZXJ2YWxzIGludG8gcGl4ZWwgaW50ZXJ2YWxzLCB3aXRoIG9wdGlvbmFsIGNhbGN1bGF0aW9ucyBmb3IgdGV4dCB0b29cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCwgd2l0aFRleHQsIG5hbWVGdW5jLCBzdGFydGtleSwgZW5ka2V5KSB7XG4gIGlmICghXy5pc0Z1bmN0aW9uKG5hbWVGdW5jKSkgeyBuYW1lRnVuYyA9IGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQubmFtZSB8fCAnJzsgfTsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChzdGFydGtleSkpIHsgc3RhcnRrZXkgPSAnc3RhcnQnOyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKGVuZGtleSkpIHsgZW5ka2V5ID0gJ2VuZCc7IH1cbiAgcmV0dXJuIGZ1bmN0aW9uKGQpIHtcbiAgICB2YXIgaXR2bFN0YXJ0ID0gXy5pc1VuZGVmaW5lZChkW3N0YXJ0a2V5XSkgPyBkLnN0YXJ0IDogZFtzdGFydGtleV0sXG4gICAgICBpdHZsRW5kID0gXy5pc1VuZGVmaW5lZChkW2VuZGtleV0pID8gZC5lbmQgOiBkW2VuZGtleV07XG4gICAgdmFyIHBJbnQgPSB7XG4gICAgICB4OiBNYXRoLnJvdW5kKChpdHZsU3RhcnQgLSBzdGFydCkgLyBicHBwKSxcbiAgICAgIHc6IE1hdGgucm91bmQoKGl0dmxFbmQgLSBpdHZsU3RhcnQpIC8gYnBwcCkgKyAxLFxuICAgICAgdDogMCwgICAgICAgICAgLy8gY2FsY3VsYXRlZCB3aWR0aCBvZiB0ZXh0XG4gICAgICBvUHJldjogZmFsc2UsICAvLyBvdmVyZmxvd3MgaW50byBwcmV2aW91cyB0aWxlP1xuICAgICAgb05leHQ6IGZhbHNlICAgLy8gb3ZlcmZsb3dzIGludG8gbmV4dCB0aWxlP1xuICAgIH07XG4gICAgcEludC50eCA9IHBJbnQueDtcbiAgICBwSW50LnR3ID0gcEludC53O1xuICAgIGlmIChwSW50LnggPCAwKSB7IHBJbnQudyArPSBwSW50Lng7IHBJbnQueCA9IDA7IHBJbnQub1ByZXYgPSB0cnVlOyB9XG4gICAgZWxzZSBpZiAod2l0aFRleHQpIHtcbiAgICAgIHBJbnQudCA9IF8uaXNOdW1iZXIod2l0aFRleHQpID8gd2l0aFRleHQgOiBNYXRoLm1pbihuYW1lRnVuYyhkKS5sZW5ndGggKiAxMCArIDIsIHBJbnQueCk7XG4gICAgICBwSW50LnR4IC09IHBJbnQudDtcbiAgICAgIHBJbnQudHcgKz0gcEludC50OyAgXG4gICAgfVxuICAgIGlmIChwSW50LnggKyBwSW50LncgPiB3aWR0aCkgeyBwSW50LncgPSB3aWR0aCAtIHBJbnQueDsgcEludC5vTmV4dCA9IHRydWU7IH1cbiAgICByZXR1cm4gcEludDtcbiAgfTtcbn07XG5cbi8vIEZvciB0d28gZ2l2ZW4gb2JqZWN0cyBvZiB0aGUgZm9ybSB7eDogMSwgdzogMn0gKHBpeGVsIGludGVydmFscyksIGRlc2NyaWJlIHRoZSBvdmVybGFwLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZXJlIGlzIG5vIG92ZXJsYXAuXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbE92ZXJsYXAgPSBmdW5jdGlvbihwSW50MSwgcEludDIpIHtcbiAgdmFyIG92ZXJsYXAgPSB7fSxcbiAgICB0bXA7XG4gIGlmIChwSW50MS54ID4gcEludDIueCkgeyB0bXAgPSBwSW50MjsgcEludDIgPSBwSW50MTsgcEludDEgPSB0bXA7IH0gICAgICAgLy8gc3dhcCBzbyB0aGF0IHBJbnQxIGlzIGFsd2F5cyBsb3dlclxuICBpZiAoIXBJbnQxLncgfHwgIXBJbnQyLncgfHwgcEludDEueCArIHBJbnQxLncgPCBwSW50Mi54KSB7IHJldHVybiBudWxsOyB9IC8vIGRldGVjdCBuby1vdmVybGFwIGNvbmRpdGlvbnNcbiAgb3ZlcmxhcC54ID0gcEludDIueDtcbiAgb3ZlcmxhcC53ID0gTWF0aC5taW4ocEludDEudyAtIHBJbnQyLnggKyBwSW50MS54LCBwSW50Mi53KTtcbiAgcmV0dXJuIG92ZXJsYXA7XG59O1xuXG4vLyBDb21tb24gZnVuY3Rpb25zIGZvciBzdW1tYXJpemluZyBkYXRhIGluIGJpbnMgd2hpbGUgcGxvdHRpbmcgd2lnZ2xlIHRyYWNrc1xubW9kdWxlLmV4cG9ydHMud2lnQmluRnVuY3Rpb25zID0ge1xuICBtaW5pbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1pbi5hcHBseShNYXRoLCBiaW4pIDogMDsgfSxcbiAgbWVhbjogZnVuY3Rpb24oYmluKSB7IHJldHVybiBfLnJlZHVjZShiaW4sIGZ1bmN0aW9uKGEsYikgeyByZXR1cm4gYSArIGI7IH0sIDApIC8gYmluLmxlbmd0aDsgfSxcbiAgbWF4aW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5tYXguYXBwbHkoTWF0aCwgYmluKSA6IDA7IH1cbn07XG5cbi8vIEZhc3RlciB0aGFuIE1hdGguZmxvb3IgKGh0dHA6Ly93ZWJkb29kLmNvbS8/cD0yMTkpXG5tb2R1bGUuZXhwb3J0cy5mbG9vckhhY2sgPSBmdW5jdGlvbihudW0pIHsgcmV0dXJuIChudW0gPDwgMCkgLSAobnVtIDwgMCA/IDEgOiAwKTsgfVxuXG4vLyBPdGhlciB0aW55IGZ1bmN0aW9ucyB0aGF0IHdlIG5lZWQgZm9yIG9kZHMgYW5kIGVuZHMuLi5cbm1vZHVsZS5leHBvcnRzLnN0cmlwID0gZnVuY3Rpb24oc3RyKSB7IHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpOyB9XG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBwYXJzZUludCh2YWwsIDEwKTsgfVxubW9kdWxlLmV4cG9ydHMuZGVlcENsb25lID0gZnVuY3Rpb24ob2JqKSB7IHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iaikpOyB9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gdmNmVGFiaXggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC92Y2YuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy52Y2Z0YWJpeFxudmFyIFZjZlRhYml4Rm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiA1MDAsIHBhY2s6IDEwMH0sXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDEwMDAwMCxcbiAgICBjaHJvbW9zb21lczogJydcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIHZjZlRhYml4IHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgLy8gVE9ETzogU2V0IG1heEZldGNoV2luZG93IHVzaW5nIHNvbWUgaGV1cmlzdGljIGJhc2VkIG9uIGhvdyBtYW55IGl0ZW1zIGFyZSBpbiB0aGUgdGFiaXggaW5kZXhcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICByYW5nZSA9IHRoaXMuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZVRvSW50ZXJ2YWwobGluZSkge1xuICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoJ1xcdCcpLCBkYXRhID0ge30sIGluZm8gPSB7fTtcbiAgICAgIGlmIChmaWVsZHNbN10pIHtcbiAgICAgICAgXy5lYWNoKGZpZWxkc1s3XS5zcGxpdCgnOycpLCBmdW5jdGlvbihsKSB7IGwgPSBsLnNwbGl0KCc9Jyk7IGlmIChsLmxlbmd0aCA+IDEpIHsgaW5mb1tsWzBdXSA9IGxbMV07IH0gfSk7XG4gICAgICB9XG4gICAgICBkYXRhLnN0YXJ0ID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZmllbGRzWzBdXSArIHBhcnNlSW50MTAoZmllbGRzWzFdKTtcbiAgICAgIGRhdGEuaWQgPSBmaWVsZHNbMl09PScuJyA/ICd2Y2YtJyArIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMDAwMCkgOiBmaWVsZHNbMl07XG4gICAgICBkYXRhLmVuZCA9IGRhdGEuc3RhcnQgKyAxO1xuICAgICAgZGF0YS5yZWYgPSBmaWVsZHNbM107XG4gICAgICBkYXRhLmFsdCA9IGZpZWxkc1s0XTtcbiAgICAgIGRhdGEucXVhbCA9IHBhcnNlRmxvYXQoZmllbGRzWzVdKTtcbiAgICAgIGRhdGEuaW5mbyA9IGluZm87XG4gICAgICByZXR1cm4ge2RhdGE6IGRhdGF9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBuYW1lRnVuYyhmaWVsZHMpIHtcbiAgICAgIHZhciByZWYgPSBmaWVsZHMucmVmIHx8ICcnLFxuICAgICAgICBhbHQgPSBmaWVsZHMuYWx0IHx8ICcnO1xuICAgICAgcmV0dXJuIChyZWYubGVuZ3RoID4gYWx0Lmxlbmd0aCA/IHJlZiA6IGFsdCkgfHwgJyc7XG4gICAgfVxuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLFxuICAgICAgICBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+IDg7IH0pLFxuICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snLCBuYW1lRnVuYyk7XG4gICAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIGRyYXdTcGVjLnB1c2goY2FsY1BpeEludGVydmFsKGxpbmVUb0ludGVydmFsKGxpbmUpLmRhdGEpKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dChfLm1hcChsaW5lcywgbGluZVRvSW50ZXJ2YWwpLCB3aWR0aCwgY2FsY1BpeEludGVydmFsKX07XG4gICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtdWNoIGRhdGEsIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIC8vIFRPRE86IGNhY2hlIHJlc3VsdHMgc28gd2UgYXJlbid0IHJlZmV0Y2hpbmcgdGhlIHNhbWUgcmVnaW9ucyBvdmVyIGFuZCBvdmVyIGFnYWluLlxuICAgIGlmICgoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAkLmFqYXgodGhpcy5hamF4RGlyKCkgKyAndGFiaXgucGhwJywge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gdGhpcy5vcHRzLnVybCA/IHRoaXMub3B0cy51cmwgOiAnamF2YXNjcmlwdDp2b2lkKFwiJyt0aGlzLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDI3IDogNixcbiAgICAgIGNvbG9ycyA9IHthOicyNTUsMCwwJywgdDonMjU1LDAsMjU1JywgYzonMCwwLDI1NScsIGc6JzAsMjU1LDAnfSxcbiAgICAgIGRyYXdMaW1pdCA9IHRoaXMub3B0cy5kcmF3TGltaXQgJiYgdGhpcy5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycpIHsgYXJlYXMgPSB0aGlzLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigwLDAsMClcIjtcbiAgICB0aGlzLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBpZiAoKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgfSBlbHNlIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDE1O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QocEludC54LCAxLCBwSW50LncsIDEzKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgdmFyIGFsdENvbG9yLCByZWZDb2xvcjtcbiAgICAgICAgICAgIGlmIChhcmVhcykge1xuICAgICAgICAgICAgICByZWZDb2xvciA9IGNvbG9yc1tkYXRhLmQucmVmLnRvTG93ZXJDYXNlKCldIHx8ICcyNTUsMCwwJztcbiAgICAgICAgICAgICAgYWx0Q29sb3IgPSBjb2xvcnNbZGF0YS5kLmFsdC50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIiArIGFsdENvbG9yICsgXCIpXCI7IFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gMSk7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgYXJlYXMucHVzaChbXG4gICAgICAgICAgICAgICAgZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgKGkgKyAxKSAqIGxpbmVIZWlnaHQsIC8veDEsIHgyLCB5MSwgeTJcbiAgICAgICAgICAgICAgICBkYXRhLmQucmVmICsgJyA+ICcgKyBkYXRhLmQuYWx0LCAvLyB0aXRsZVxuICAgICAgICAgICAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgZGF0YS5kLmlkKSwgLy8gaHJlZlxuICAgICAgICAgICAgICAgIGRhdGEucEludC5vUHJldiwgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgICAgICAgICAgICBhbHRDb2xvciwgLy8gbGFiZWwgY29sb3JcbiAgICAgICAgICAgICAgICAnPHNwYW4gc3R5bGU9XCJjb2xvcjogcmdiKCcgKyByZWZDb2xvciArICcpXCI+JyArIGRhdGEuZC5yZWYgKyAnPC9zcGFuPjxici8+JyArIGRhdGEuZC5hbHQsIC8vIGxhYmVsXG4gICAgICAgICAgICAgICAgZGF0YS5kLmluZm9cbiAgICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZjZlRhYml4Rm9ybWF0O1xuXG4iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gV0lHIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvd2lnZ2xlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vdXRpbHMvU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLndpZ2dsZV8wXG52YXIgV2lnZ2xlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgX2JpbkZ1bmN0aW9ucyA9IHRoaXMudHlwZSgpLl9iaW5GdW5jdGlvbnM7XG4gICAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcikpIHsgby5hbHRDb2xvciA9ICcnOyB9XG4gICAgby52aWV3TGltaXRzID0gXy5tYXAoby52aWV3TGltaXRzLnNwbGl0KCc6JyksIHBhcnNlRmxvYXQpO1xuICAgIG8ubWF4SGVpZ2h0UGl4ZWxzID0gXy5tYXAoby5tYXhIZWlnaHRQaXhlbHMuc3BsaXQoJzonKSwgcGFyc2VJbnQxMCk7XG4gICAgby55TGluZU9uT2ZmID0gdGhpcy5pc09uKG8ueUxpbmVPbk9mZik7XG4gICAgby55TGluZU1hcmsgPSBwYXJzZUZsb2F0KG8ueUxpbmVNYXJrKTtcbiAgICBvLmF1dG9TY2FsZSA9IHRoaXMuaXNPbihvLmF1dG9TY2FsZSk7XG4gICAgaWYgKF9iaW5GdW5jdGlvbnMgJiYgIV9iaW5GdW5jdGlvbnNbby53aW5kb3dpbmdGdW5jdGlvbl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImludmFsaWQgd2luZG93aW5nRnVuY3Rpb24gYXQgbGluZSBcIiArIG8ubGluZU51bSk7IFxuICAgIH1cbiAgICBpZiAoXy5pc05hTihvLnlMaW5lTWFyaykpIHsgby55TGluZU1hcmsgPSAwLjA7IH1cbiAgfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICBzZWxmLmRyYXdSYW5nZSA9IG8uYXV0b1NjYWxlIHx8IG8udmlld0xpbWl0cy5sZW5ndGggPCAyID8gc2VsZi5yYW5nZSA6IG8udmlld0xpbWl0cztcbiAgICBfLmVhY2goe21heDogMCwgbWluOiAyLCBzdGFydDogMX0sIGZ1bmN0aW9uKHYsIGspIHsgc2VsZi5oZWlnaHRzW2tdID0gby5tYXhIZWlnaHRQaXhlbHNbdl07IH0pO1xuICAgIGlmICghby5hbHRDb2xvcikge1xuICAgICAgdmFyIGhzbCA9IHRoaXMucmdiVG9Ic2wuYXBwbHkodGhpcywgby5jb2xvci5zcGxpdCgvLFxccyovZykpO1xuICAgICAgaHNsWzBdID0gaHNsWzBdICsgMC4wMiAlIDE7XG4gICAgICBoc2xbMV0gPSBoc2xbMV0gKiAwLjc7XG4gICAgICBoc2xbMl0gPSAxIC0gKDEgLSBoc2xbMl0pICogMC43O1xuICAgICAgc2VsZi5hbHRDb2xvciA9IF8ubWFwKHRoaXMuaHNsVG9SZ2IuYXBwbHkodGhpcywgaHNsKSwgcGFyc2VJbnQxMCkuam9pbignLCcpO1xuICAgIH1cbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgdmFsLCBzdGFydDtcbiAgICAgIFxuICAgICAgbSA9IGxpbmUubWF0Y2goL14odmFyaWFibGV8Zml4ZWQpU3RlcFxccysvaSk7XG4gICAgICBpZiAobSkge1xuICAgICAgICBtb2RlID0gbVsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBtb2RlT3B0cyA9IHBhcnNlRGVjbGFyYXRpb25MaW5lKGxpbmUsIC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgICBtb2RlT3B0cy5zdGFydCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RhcnQpO1xuICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnICYmIChfLmlzTmFOKG1vZGVPcHRzLnN0YXJ0KSB8fCAhbW9kZU9wdHMuc3RhcnQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RhcnQgcGFyYW1ldGVyXCIpOyBcbiAgICAgICAgfVxuICAgICAgICBtb2RlT3B0cy5zdGVwID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zdGVwKTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGVwKSB8fCAhbW9kZU9wdHMuc3RlcCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmaXhlZFN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZSBub24temVybyBzdGVwIHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3BhbiA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3BhbikgfHwgMTtcbiAgICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbbW9kZU9wdHMuY2hyb21dO1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgICAgc2VsZi53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghbW9kZSkgeyBcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXaWdnbGUgZm9ybWF0IGF0IFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiBoYXMgbm8gcHJlY2VkaW5nIG1vZGUgZGVjbGFyYXRpb25cIik7IFxuICAgICAgICB9IGVsc2UgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIC8vIGludmFsaWQgY2hyb21vc29tZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcpIHtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgbW9kZU9wdHMuc3RhcnQsIGVuZDogY2hyUG9zICsgbW9kZU9wdHMuc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgICAgbW9kZU9wdHMuc3RhcnQgKz0gbW9kZU9wdHMuc3RlcDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGluZSA9IGxpbmUuc3BsaXQoL1xccysvKTtcbiAgICAgICAgICAgIGlmIChsaW5lLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidmFyaWFibGVTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmVzIHR3byB2YWx1ZXMgcGVyIGxpbmVcIik7IFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGxpbmVbMF0pO1xuICAgICAgICAgICAgdmFsID0gcGFyc2VGbG9hdChsaW5lWzFdKTtcbiAgICAgICAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBzdGFydCwgZW5kOiBjaHJQb3MgKyBzdGFydCArIG1vZGVPcHRzLnNwYW4sIHZhbDogdmFsfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHNlbGYudHlwZSgpLmZpbmlzaFBhcnNlLmNhbGwoc2VsZiwgZGF0YSk7XG4gIH0sXG4gIFxuICBmaW5pc2hQYXJzZTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dO1xuICAgIGlmIChkYXRhLmFsbC5sZW5ndGggPiAwKSB7XG4gICAgICBzZWxmLnJhbmdlWzBdID0gXy5taW4oZGF0YS5hbGwsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudmFsOyB9KS52YWw7XG4gICAgICBzZWxmLnJhbmdlWzFdID0gXy5tYXgoZGF0YS5hbGwsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudmFsOyB9KS52YWw7XG4gICAgfVxuICAgIGRhdGEuYWxsID0gbmV3IFNvcnRlZExpc3QoZGF0YS5hbGwsIHtcbiAgICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgaWYgKGEgPT09IG51bGwpIHJldHVybiAtMTtcbiAgICAgICAgaWYgKGIgPT09IG51bGwpIHJldHVybiAgMTtcbiAgICAgICAgdmFyIGMgPSBhLnN0YXJ0IC0gYi5zdGFydDtcbiAgICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT09IDApICA/IDAgOiAtMTtcbiAgICAgIH1cbiAgICB9KTtcbiAgXG4gICAgLy8gUHJlLW9wdGltaXplIGRhdGEgZm9yIGhpZ2ggYnBwcHMgYnkgZG93bnNhbXBsaW5nXG4gICAgXy5lYWNoKHNlbGYuYnJvd3Nlck9wdHMuYnBwcHMsIGZ1bmN0aW9uKGJwcHApIHtcbiAgICAgIGlmIChzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyBicHBwID4gMTAwMDAwMCkgeyByZXR1cm47IH1cbiAgICAgIHZhciBwaXhMZW4gPSBNYXRoLmNlaWwoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCksXG4gICAgICAgIGRvd25zYW1wbGVkRGF0YSA9IChkYXRhW2JwcHBdID0gKGdsb2JhbC5GbG9hdDMyQXJyYXkgPyBuZXcgRmxvYXQzMkFycmF5KHBpeExlbikgOiBuZXcgQXJyYXkocGl4TGVuKSkpLFxuICAgICAgICBqID0gMCxcbiAgICAgICAgY3VyciA9IGRhdGEuYWxsLmdldCgwKSxcbiAgICAgICAgYmluLCBuZXh0O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwaXhMZW47IGkrKykge1xuICAgICAgICBiaW4gPSBjdXJyICYmIChjdXJyLnN0YXJ0IDw9IGkgKiBicHBwICYmIGN1cnIuZW5kID4gaSAqIGJwcHApID8gW2N1cnIudmFsXSA6IFtdO1xuICAgICAgICB3aGlsZSAoKG5leHQgPSBkYXRhLmFsbC5nZXQoaiArIDEpKSAmJiBuZXh0LnN0YXJ0IDwgKGkgKyAxKSAqIGJwcHAgJiYgbmV4dC5lbmQgPiBpICogYnBwcCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRvd25zYW1wbGVkRGF0YVtpXSA9IGJpbkZ1bmN0aW9uKGJpbik7XG4gICAgICB9XG4gICAgICBkYXRhLl9iaW5GdW5jdGlvbiA9IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbjtcbiAgICB9KTtcbiAgICBzZWxmLmRhdGEgPSBkYXRhO1xuICAgIHNlbGYuc3RyZXRjaEhlaWdodCA9IHRydWU7XG4gICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgICByZXR1cm4gdHJ1ZTsgLy8gc3VjY2VzcyFcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24ocHJlY2FsYykge1xuICAgIHZhciB2U2NhbGUgPSAodGhpcy5kcmF3UmFuZ2VbMV0gLSB0aGlzLmRyYXdSYW5nZVswXSkgLyBwcmVjYWxjLmhlaWdodCxcbiAgICAgIGRyYXdTcGVjID0ge1xuICAgICAgICBiYXJzOiBbXSxcbiAgICAgICAgdlNjYWxlOiB2U2NhbGUsXG4gICAgICAgIHlMaW5lOiB0aGlzLmlzT24odGhpcy5vcHRzLnlMaW5lT25PZmYpID8gTWF0aC5yb3VuZCgodGhpcy5vcHRzLnlMaW5lTWFyayAtIHRoaXMuZHJhd1JhbmdlWzBdKSAvIHZTY2FsZSkgOiBudWxsLCBcbiAgICAgICAgemVyb0xpbmU6IC10aGlzLmRyYXdSYW5nZVswXSAvIHZTY2FsZVxuICAgICAgfTtcbiAgICByZXR1cm4gZHJhd1NwZWM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRyYXdTcGVjID0gc2VsZi50eXBlKCkuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXSxcbiAgICAgIGRvd25zYW1wbGVkRGF0YTtcbiAgICBpZiAoc2VsZi5kYXRhLl9iaW5GdW5jdGlvbiA9PSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb24gJiYgKGRvd25zYW1wbGVkRGF0YSA9IHNlbGYuZGF0YVticHBwXSkpIHtcbiAgICAgIC8vIFdlJ3ZlIGFscmVhZHkgcHJlLW9wdGltaXplZCBmb3IgdGhpcyBicHBwXG4gICAgICBkcmF3U3BlYy5iYXJzID0gXy5tYXAoXy5yYW5nZSgoc3RhcnQgLSAxKSAvIGJwcHAsIChlbmQgLSAxKSAvIGJwcHApLCBmdW5jdGlvbih4RnJvbU9yaWdpbiwgeCkge1xuICAgICAgICByZXR1cm4gKChkb3duc2FtcGxlZERhdGFbeEZyb21PcmlnaW5dIHx8IDApIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdlIGhhdmUgdG8gZG8gdGhlIGJpbm5pbmcgb24gdGhlIGZseVxuICAgICAgdmFyIGogPSBzZWxmLmRhdGEuYWxsLmJzZWFyY2goe3N0YXJ0OiBzdGFydH0pLFxuICAgICAgICBjdXJyID0gc2VsZi5kYXRhLmFsbC5nZXQoaiksIG5leHQsIGJpbjtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJlY2FsYy53aWR0aDsgaSsrKSB7XG4gICAgICAgIGJpbiA9IGN1cnIgJiYgKGN1cnIuZW5kID49IGkgKiBicHBwICsgc3RhcnQpID8gW2N1cnIudmFsXSA6IFtdO1xuICAgICAgICB3aGlsZSAoKG5leHQgPSBzZWxmLmRhdGEuYWxsLmdldChqICsgMSkpICYmIG5leHQuc3RhcnQgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIG5leHQuZW5kID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkcmF3U3BlYy5iYXJzLnB1c2goKGJpbkZ1bmN0aW9uKGJpbikgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgZHJhd0JhcnM6IGZ1bmN0aW9uKGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpIHtcbiAgICB2YXIgemVyb0xpbmUgPSBkcmF3U3BlYy56ZXJvTGluZSwgLy8gcGl4ZWwgcG9zaXRpb24gb2YgdGhlIGRhdGEgdmFsdWUgMFxuICAgICAgY29sb3IgPSBcInJnYihcIit0aGlzLm9wdHMuY29sb3IrXCIpXCIsXG4gICAgICBhbHRDb2xvciA9IFwicmdiKFwiKyh0aGlzLm9wdHMuYWx0Q29sb3IgfHwgdGhpcy5hbHRDb2xvcikrXCIpXCIsXG4gICAgICBwb2ludEdyYXBoID0gdGhpcy5vcHRzLmdyYXBoVHlwZT09PSdwb2ludHMnO1xuICAgIFxuICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvcjtcbiAgICBfLmVhY2goZHJhd1NwZWMuYmFycywgZnVuY3Rpb24oZCwgeCkge1xuICAgICAgaWYgKGQgPT09IG51bGwpIHsgcmV0dXJuOyB9XG4gICAgICBlbHNlIGlmIChkID4gemVyb0xpbmUpIHsgXG4gICAgICAgIGlmIChwb2ludEdyYXBoKSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSBkLCAxLCAxKTsgfVxuICAgICAgICBlbHNlIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIGQsIDEsIHplcm9MaW5lID4gMCA/IChkIC0gemVyb0xpbmUpIDogZCk7IH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBhbHRDb2xvcjtcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIHplcm9MaW5lIC0gZCAtIDEsIDEsIDEpOyB9IFxuICAgICAgICBlbHNlIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIHplcm9MaW5lLCAxLCB6ZXJvTGluZSAtIGQpOyB9XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoZHJhd1NwZWMueUxpbmUgIT09IG51bGwpIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigwLDAsMClcIjtcbiAgICAgIGN0eC5maWxsUmVjdCgwLCBoZWlnaHQgLSBkcmF3U3BlYy55TGluZSwgd2lkdGgsIDEpO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgICR2aWV3TGltaXRzID0gJGRpYWxvZy5maW5kKCcudmlldy1saW1pdHMnKSxcbiAgICAgICRtYXhIZWlnaHRQaXhlbHMgPSAkZGlhbG9nLmZpbmQoJy5tYXgtaGVpZ2h0LXBpeGVscycpLFxuICAgICAgYWx0Q29sb3JPbiA9IHRoaXMudmFsaWRhdGVDb2xvcihvLmFsdENvbG9yKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuYXR0cignY2hlY2tlZCcsIGFsdENvbG9yT24pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKGFsdENvbG9yT24gPyBvLmFsdENvbG9yIDonMTI4LDEyOCwxMjgnKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5hdHRyKCdjaGVja2VkJywgIXRoaXMuaXNPbihvLmF1dG9TY2FsZSkpLmNoYW5nZSgpO1xuICAgICR2aWV3TGltaXRzLnNsaWRlcihcIm9wdGlvblwiLCBcIm1pblwiLCB0aGlzLnJhbmdlWzBdKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtYXhcIiwgdGhpcy5yYW5nZVsxXSk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWluXScpLnZhbCh0aGlzLmRyYXdSYW5nZVswXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWF4XScpLnZhbCh0aGlzLmRyYXdSYW5nZVsxXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmF0dHIoJ2NoZWNrZWQnLCB0aGlzLmlzT24oby55TGluZU9uT2ZmKSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKG8ueUxpbmVNYXJrKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoby5ncmFwaFR5cGUpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9d2luZG93aW5nRnVuY3Rpb25dJykudmFsKG8ud2luZG93aW5nRnVuY3Rpb24pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuYXR0cignY2hlY2tlZCcsIG8ubWF4SGVpZ2h0UGl4ZWxzLmxlbmd0aCA+PSAzKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01pbl0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMl0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWF4XScpLnZhbChvLm1heEhlaWdodFBpeGVsc1swXSkuY2hhbmdlKCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgYWx0Q29sb3JPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIG1heEhlaWdodFBpeGVsc09uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIG1heEhlaWdodFBpeGVsc01heCA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWF4XScpLnZhbCgpO1xuICAgIG8uYWx0Q29sb3IgPSBhbHRDb2xvck9uID8gJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvcl0nKS52YWwoKSA6ICcnO1xuICAgIG8uYXV0b1NjYWxlID0gISRkaWFsb2cuZmluZCgnW25hbWU9YXV0b1NjYWxlXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8udmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwoKSArICc6JyArICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwoKTtcbiAgICBvLnlMaW5lT25PZmYgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lT25PZmZdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby55TGluZU1hcmsgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lTWFya10nKS52YWwoKTtcbiAgICBvLmdyYXBoVHlwZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9Z3JhcGhUeXBlXScpLnZhbCgpO1xuICAgIG8ud2luZG93aW5nRnVuY3Rpb24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbCgpO1xuICAgIG8ubWF4SGVpZ2h0UGl4ZWxzID0gbWF4SGVpZ2h0UGl4ZWxzT24gPyBcbiAgICAgIFttYXhIZWlnaHRQaXhlbHNNYXgsIG1heEhlaWdodFBpeGVsc01heCwgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKCldLmpvaW4oJzonKSA6ICcnO1xuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBXaWdnbGVGb3JtYXQ7IiwiLy8gICAgIFVuZGVyc2NvcmUuanMgMS44LjNcbi8vICAgICBodHRwOi8vdW5kZXJzY29yZWpzLm9yZ1xuLy8gICAgIChjKSAyMDA5LTIwMTUgSmVyZW15IEFzaGtlbmFzLCBEb2N1bWVudENsb3VkIGFuZCBJbnZlc3RpZ2F0aXZlIFJlcG9ydGVycyAmIEVkaXRvcnNcbi8vICAgICBVbmRlcnNjb3JlIG1heSBiZSBmcmVlbHkgZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gbihuKXtmdW5jdGlvbiB0KHQscixlLHUsaSxvKXtmb3IoO2k+PTAmJm8+aTtpKz1uKXt2YXIgYT11P3VbaV06aTtlPXIoZSx0W2FdLGEsdCl9cmV0dXJuIGV9cmV0dXJuIGZ1bmN0aW9uKHIsZSx1LGkpe2U9YihlLGksNCk7dmFyIG89IWsocikmJm0ua2V5cyhyKSxhPShvfHxyKS5sZW5ndGgsYz1uPjA/MDphLTE7cmV0dXJuIGFyZ3VtZW50cy5sZW5ndGg8MyYmKHU9cltvP29bY106Y10sYys9biksdChyLGUsdSxvLGMsYSl9fWZ1bmN0aW9uIHQobil7cmV0dXJuIGZ1bmN0aW9uKHQscixlKXtyPXgocixlKTtmb3IodmFyIHU9Tyh0KSxpPW4+MD8wOnUtMTtpPj0wJiZ1Pmk7aSs9bilpZihyKHRbaV0saSx0KSlyZXR1cm4gaTtyZXR1cm4tMX19ZnVuY3Rpb24gcihuLHQscil7cmV0dXJuIGZ1bmN0aW9uKGUsdSxpKXt2YXIgbz0wLGE9TyhlKTtpZihcIm51bWJlclwiPT10eXBlb2YgaSluPjA/bz1pPj0wP2k6TWF0aC5tYXgoaSthLG8pOmE9aT49MD9NYXRoLm1pbihpKzEsYSk6aSthKzE7ZWxzZSBpZihyJiZpJiZhKXJldHVybiBpPXIoZSx1KSxlW2ldPT09dT9pOi0xO2lmKHUhPT11KXJldHVybiBpPXQobC5jYWxsKGUsbyxhKSxtLmlzTmFOKSxpPj0wP2krbzotMTtmb3IoaT1uPjA/bzphLTE7aT49MCYmYT5pO2krPW4paWYoZVtpXT09PXUpcmV0dXJuIGk7cmV0dXJuLTF9fWZ1bmN0aW9uIGUobix0KXt2YXIgcj1JLmxlbmd0aCxlPW4uY29uc3RydWN0b3IsdT1tLmlzRnVuY3Rpb24oZSkmJmUucHJvdG90eXBlfHxhLGk9XCJjb25zdHJ1Y3RvclwiO2ZvcihtLmhhcyhuLGkpJiYhbS5jb250YWlucyh0LGkpJiZ0LnB1c2goaSk7ci0tOylpPUlbcl0saSBpbiBuJiZuW2ldIT09dVtpXSYmIW0uY29udGFpbnModCxpKSYmdC5wdXNoKGkpfXZhciB1PXRoaXMsaT11Ll8sbz1BcnJheS5wcm90b3R5cGUsYT1PYmplY3QucHJvdG90eXBlLGM9RnVuY3Rpb24ucHJvdG90eXBlLGY9by5wdXNoLGw9by5zbGljZSxzPWEudG9TdHJpbmcscD1hLmhhc093blByb3BlcnR5LGg9QXJyYXkuaXNBcnJheSx2PU9iamVjdC5rZXlzLGc9Yy5iaW5kLHk9T2JqZWN0LmNyZWF0ZSxkPWZ1bmN0aW9uKCl7fSxtPWZ1bmN0aW9uKG4pe3JldHVybiBuIGluc3RhbmNlb2YgbT9uOnRoaXMgaW5zdGFuY2VvZiBtP3ZvaWQodGhpcy5fd3JhcHBlZD1uKTpuZXcgbShuKX07XCJ1bmRlZmluZWRcIiE9dHlwZW9mIGV4cG9ydHM/KFwidW5kZWZpbmVkXCIhPXR5cGVvZiBtb2R1bGUmJm1vZHVsZS5leHBvcnRzJiYoZXhwb3J0cz1tb2R1bGUuZXhwb3J0cz1tKSxleHBvcnRzLl89bSk6dS5fPW0sbS5WRVJTSU9OPVwiMS44LjNcIjt2YXIgYj1mdW5jdGlvbihuLHQscil7aWYodD09PXZvaWQgMClyZXR1cm4gbjtzd2l0Y2gobnVsbD09cj8zOnIpe2Nhc2UgMTpyZXR1cm4gZnVuY3Rpb24ocil7cmV0dXJuIG4uY2FsbCh0LHIpfTtjYXNlIDI6cmV0dXJuIGZ1bmN0aW9uKHIsZSl7cmV0dXJuIG4uY2FsbCh0LHIsZSl9O2Nhc2UgMzpyZXR1cm4gZnVuY3Rpb24ocixlLHUpe3JldHVybiBuLmNhbGwodCxyLGUsdSl9O2Nhc2UgNDpyZXR1cm4gZnVuY3Rpb24ocixlLHUsaSl7cmV0dXJuIG4uY2FsbCh0LHIsZSx1LGkpfX1yZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4gbi5hcHBseSh0LGFyZ3VtZW50cyl9fSx4PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09bj9tLmlkZW50aXR5Om0uaXNGdW5jdGlvbihuKT9iKG4sdCxyKTptLmlzT2JqZWN0KG4pP20ubWF0Y2hlcihuKTptLnByb3BlcnR5KG4pfTttLml0ZXJhdGVlPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIHgobix0LDEvMCl9O3ZhciBfPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIGZ1bmN0aW9uKHIpe3ZhciBlPWFyZ3VtZW50cy5sZW5ndGg7aWYoMj5lfHxudWxsPT1yKXJldHVybiByO2Zvcih2YXIgdT0xO2U+dTt1KyspZm9yKHZhciBpPWFyZ3VtZW50c1t1XSxvPW4oaSksYT1vLmxlbmd0aCxjPTA7YT5jO2MrKyl7dmFyIGY9b1tjXTt0JiZyW2ZdIT09dm9pZCAwfHwocltmXT1pW2ZdKX1yZXR1cm4gcn19LGo9ZnVuY3Rpb24obil7aWYoIW0uaXNPYmplY3QobikpcmV0dXJue307aWYoeSlyZXR1cm4geShuKTtkLnByb3RvdHlwZT1uO3ZhciB0PW5ldyBkO3JldHVybiBkLnByb3RvdHlwZT1udWxsLHR9LHc9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKHQpe3JldHVybiBudWxsPT10P3ZvaWQgMDp0W25dfX0sQT1NYXRoLnBvdygyLDUzKS0xLE89dyhcImxlbmd0aFwiKSxrPWZ1bmN0aW9uKG4pe3ZhciB0PU8obik7cmV0dXJuXCJudW1iZXJcIj09dHlwZW9mIHQmJnQ+PTAmJkE+PXR9O20uZWFjaD1tLmZvckVhY2g9ZnVuY3Rpb24obix0LHIpe3Q9Yih0LHIpO3ZhciBlLHU7aWYoayhuKSlmb3IoZT0wLHU9bi5sZW5ndGg7dT5lO2UrKyl0KG5bZV0sZSxuKTtlbHNle3ZhciBpPW0ua2V5cyhuKTtmb3IoZT0wLHU9aS5sZW5ndGg7dT5lO2UrKyl0KG5baVtlXV0saVtlXSxuKX1yZXR1cm4gbn0sbS5tYXA9bS5jb2xsZWN0PWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGU9IWsobikmJm0ua2V5cyhuKSx1PShlfHxuKS5sZW5ndGgsaT1BcnJheSh1KSxvPTA7dT5vO28rKyl7dmFyIGE9ZT9lW29dOm87aVtvXT10KG5bYV0sYSxuKX1yZXR1cm4gaX0sbS5yZWR1Y2U9bS5mb2xkbD1tLmluamVjdD1uKDEpLG0ucmVkdWNlUmlnaHQ9bS5mb2xkcj1uKC0xKSxtLmZpbmQ9bS5kZXRlY3Q9ZnVuY3Rpb24obix0LHIpe3ZhciBlO3JldHVybiBlPWsobik/bS5maW5kSW5kZXgobix0LHIpOm0uZmluZEtleShuLHQsciksZSE9PXZvaWQgMCYmZSE9PS0xP25bZV06dm9pZCAwfSxtLmZpbHRlcj1tLnNlbGVjdD1mdW5jdGlvbihuLHQscil7dmFyIGU9W107cmV0dXJuIHQ9eCh0LHIpLG0uZWFjaChuLGZ1bmN0aW9uKG4scix1KXt0KG4scix1KSYmZS5wdXNoKG4pfSksZX0sbS5yZWplY3Q9ZnVuY3Rpb24obix0LHIpe3JldHVybiBtLmZpbHRlcihuLG0ubmVnYXRlKHgodCkpLHIpfSxtLmV2ZXJ5PW0uYWxsPWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGU9IWsobikmJm0ua2V5cyhuKSx1PShlfHxuKS5sZW5ndGgsaT0wO3U+aTtpKyspe3ZhciBvPWU/ZVtpXTppO2lmKCF0KG5bb10sbyxuKSlyZXR1cm4hMX1yZXR1cm4hMH0sbS5zb21lPW0uYW55PWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGU9IWsobikmJm0ua2V5cyhuKSx1PShlfHxuKS5sZW5ndGgsaT0wO3U+aTtpKyspe3ZhciBvPWU/ZVtpXTppO2lmKHQobltvXSxvLG4pKXJldHVybiEwfXJldHVybiExfSxtLmNvbnRhaW5zPW0uaW5jbHVkZXM9bS5pbmNsdWRlPWZ1bmN0aW9uKG4sdCxyLGUpe3JldHVybiBrKG4pfHwobj1tLnZhbHVlcyhuKSksKFwibnVtYmVyXCIhPXR5cGVvZiByfHxlKSYmKHI9MCksbS5pbmRleE9mKG4sdCxyKT49MH0sbS5pbnZva2U9ZnVuY3Rpb24obix0KXt2YXIgcj1sLmNhbGwoYXJndW1lbnRzLDIpLGU9bS5pc0Z1bmN0aW9uKHQpO3JldHVybiBtLm1hcChuLGZ1bmN0aW9uKG4pe3ZhciB1PWU/dDpuW3RdO3JldHVybiBudWxsPT11P3U6dS5hcHBseShuLHIpfSl9LG0ucGx1Y2s9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5tYXAobixtLnByb3BlcnR5KHQpKX0sbS53aGVyZT1mdW5jdGlvbihuLHQpe3JldHVybiBtLmZpbHRlcihuLG0ubWF0Y2hlcih0KSl9LG0uZmluZFdoZXJlPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0uZmluZChuLG0ubWF0Y2hlcih0KSl9LG0ubWF4PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGk9LTEvMCxvPS0xLzA7aWYobnVsbD09dCYmbnVsbCE9bil7bj1rKG4pP246bS52YWx1ZXMobik7Zm9yKHZhciBhPTAsYz1uLmxlbmd0aDtjPmE7YSsrKWU9blthXSxlPmkmJihpPWUpfWVsc2UgdD14KHQsciksbS5lYWNoKG4sZnVuY3Rpb24obixyLGUpe3U9dChuLHIsZSksKHU+b3x8dT09PS0xLzAmJmk9PT0tMS8wKSYmKGk9bixvPXUpfSk7cmV0dXJuIGl9LG0ubWluPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGk9MS8wLG89MS8wO2lmKG51bGw9PXQmJm51bGwhPW4pe249ayhuKT9uOm0udmFsdWVzKG4pO2Zvcih2YXIgYT0wLGM9bi5sZW5ndGg7Yz5hO2ErKyllPW5bYV0saT5lJiYoaT1lKX1lbHNlIHQ9eCh0LHIpLG0uZWFjaChuLGZ1bmN0aW9uKG4scixlKXt1PXQobixyLGUpLChvPnV8fDEvMD09PXUmJjEvMD09PWkpJiYoaT1uLG89dSl9KTtyZXR1cm4gaX0sbS5zaHVmZmxlPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdCxyPWsobik/bjptLnZhbHVlcyhuKSxlPXIubGVuZ3RoLHU9QXJyYXkoZSksaT0wO2U+aTtpKyspdD1tLnJhbmRvbSgwLGkpLHQhPT1pJiYodVtpXT11W3RdKSx1W3RdPXJbaV07cmV0dXJuIHV9LG0uc2FtcGxlPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09dHx8cj8oayhuKXx8KG49bS52YWx1ZXMobikpLG5bbS5yYW5kb20obi5sZW5ndGgtMSldKTptLnNodWZmbGUobikuc2xpY2UoMCxNYXRoLm1heCgwLHQpKX0sbS5zb3J0Qnk9ZnVuY3Rpb24obix0LHIpe3JldHVybiB0PXgodCxyKSxtLnBsdWNrKG0ubWFwKG4sZnVuY3Rpb24obixyLGUpe3JldHVybnt2YWx1ZTpuLGluZGV4OnIsY3JpdGVyaWE6dChuLHIsZSl9fSkuc29ydChmdW5jdGlvbihuLHQpe3ZhciByPW4uY3JpdGVyaWEsZT10LmNyaXRlcmlhO2lmKHIhPT1lKXtpZihyPmV8fHI9PT12b2lkIDApcmV0dXJuIDE7aWYoZT5yfHxlPT09dm9pZCAwKXJldHVybi0xfXJldHVybiBuLmluZGV4LXQuaW5kZXh9KSxcInZhbHVlXCIpfTt2YXIgRj1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24odCxyLGUpe3ZhciB1PXt9O3JldHVybiByPXgocixlKSxtLmVhY2godCxmdW5jdGlvbihlLGkpe3ZhciBvPXIoZSxpLHQpO24odSxlLG8pfSksdX19O20uZ3JvdXBCeT1GKGZ1bmN0aW9uKG4sdCxyKXttLmhhcyhuLHIpP25bcl0ucHVzaCh0KTpuW3JdPVt0XX0pLG0uaW5kZXhCeT1GKGZ1bmN0aW9uKG4sdCxyKXtuW3JdPXR9KSxtLmNvdW50Qnk9RihmdW5jdGlvbihuLHQscil7bS5oYXMobixyKT9uW3JdKys6bltyXT0xfSksbS50b0FycmF5PWZ1bmN0aW9uKG4pe3JldHVybiBuP20uaXNBcnJheShuKT9sLmNhbGwobik6ayhuKT9tLm1hcChuLG0uaWRlbnRpdHkpOm0udmFsdWVzKG4pOltdfSxtLnNpemU9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PW4/MDprKG4pP24ubGVuZ3RoOm0ua2V5cyhuKS5sZW5ndGh9LG0ucGFydGl0aW9uPWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTt2YXIgZT1bXSx1PVtdO3JldHVybiBtLmVhY2gobixmdW5jdGlvbihuLHIsaSl7KHQobixyLGkpP2U6dSkucHVzaChuKX0pLFtlLHVdfSxtLmZpcnN0PW0uaGVhZD1tLnRha2U9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT1uP3ZvaWQgMDpudWxsPT10fHxyP25bMF06bS5pbml0aWFsKG4sbi5sZW5ndGgtdCl9LG0uaW5pdGlhbD1mdW5jdGlvbihuLHQscil7cmV0dXJuIGwuY2FsbChuLDAsTWF0aC5tYXgoMCxuLmxlbmd0aC0obnVsbD09dHx8cj8xOnQpKSl9LG0ubGFzdD1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PW4/dm9pZCAwOm51bGw9PXR8fHI/bltuLmxlbmd0aC0xXTptLnJlc3QobixNYXRoLm1heCgwLG4ubGVuZ3RoLXQpKX0sbS5yZXN0PW0udGFpbD1tLmRyb3A9ZnVuY3Rpb24obix0LHIpe3JldHVybiBsLmNhbGwobixudWxsPT10fHxyPzE6dCl9LG0uY29tcGFjdD1mdW5jdGlvbihuKXtyZXR1cm4gbS5maWx0ZXIobixtLmlkZW50aXR5KX07dmFyIFM9ZnVuY3Rpb24obix0LHIsZSl7Zm9yKHZhciB1PVtdLGk9MCxvPWV8fDAsYT1PKG4pO2E+bztvKyspe3ZhciBjPW5bb107aWYoayhjKSYmKG0uaXNBcnJheShjKXx8bS5pc0FyZ3VtZW50cyhjKSkpe3R8fChjPVMoYyx0LHIpKTt2YXIgZj0wLGw9Yy5sZW5ndGg7Zm9yKHUubGVuZ3RoKz1sO2w+ZjspdVtpKytdPWNbZisrXX1lbHNlIHJ8fCh1W2krK109Yyl9cmV0dXJuIHV9O20uZmxhdHRlbj1mdW5jdGlvbihuLHQpe3JldHVybiBTKG4sdCwhMSl9LG0ud2l0aG91dD1mdW5jdGlvbihuKXtyZXR1cm4gbS5kaWZmZXJlbmNlKG4sbC5jYWxsKGFyZ3VtZW50cywxKSl9LG0udW5pcT1tLnVuaXF1ZT1mdW5jdGlvbihuLHQscixlKXttLmlzQm9vbGVhbih0KXx8KGU9cixyPXQsdD0hMSksbnVsbCE9ciYmKHI9eChyLGUpKTtmb3IodmFyIHU9W10saT1bXSxvPTAsYT1PKG4pO2E+bztvKyspe3ZhciBjPW5bb10sZj1yP3IoYyxvLG4pOmM7dD8obyYmaT09PWZ8fHUucHVzaChjKSxpPWYpOnI/bS5jb250YWlucyhpLGYpfHwoaS5wdXNoKGYpLHUucHVzaChjKSk6bS5jb250YWlucyh1LGMpfHx1LnB1c2goYyl9cmV0dXJuIHV9LG0udW5pb249ZnVuY3Rpb24oKXtyZXR1cm4gbS51bmlxKFMoYXJndW1lbnRzLCEwLCEwKSl9LG0uaW50ZXJzZWN0aW9uPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD1bXSxyPWFyZ3VtZW50cy5sZW5ndGgsZT0wLHU9TyhuKTt1PmU7ZSsrKXt2YXIgaT1uW2VdO2lmKCFtLmNvbnRhaW5zKHQsaSkpe2Zvcih2YXIgbz0xO3I+byYmbS5jb250YWlucyhhcmd1bWVudHNbb10saSk7bysrKTtvPT09ciYmdC5wdXNoKGkpfX1yZXR1cm4gdH0sbS5kaWZmZXJlbmNlPWZ1bmN0aW9uKG4pe3ZhciB0PVMoYXJndW1lbnRzLCEwLCEwLDEpO3JldHVybiBtLmZpbHRlcihuLGZ1bmN0aW9uKG4pe3JldHVybiFtLmNvbnRhaW5zKHQsbil9KX0sbS56aXA9ZnVuY3Rpb24oKXtyZXR1cm4gbS51bnppcChhcmd1bWVudHMpfSxtLnVuemlwPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD1uJiZtLm1heChuLE8pLmxlbmd0aHx8MCxyPUFycmF5KHQpLGU9MDt0PmU7ZSsrKXJbZV09bS5wbHVjayhuLGUpO3JldHVybiByfSxtLm9iamVjdD1mdW5jdGlvbihuLHQpe2Zvcih2YXIgcj17fSxlPTAsdT1PKG4pO3U+ZTtlKyspdD9yW25bZV1dPXRbZV06cltuW2VdWzBdXT1uW2VdWzFdO3JldHVybiByfSxtLmZpbmRJbmRleD10KDEpLG0uZmluZExhc3RJbmRleD10KC0xKSxtLnNvcnRlZEluZGV4PWZ1bmN0aW9uKG4sdCxyLGUpe3I9eChyLGUsMSk7Zm9yKHZhciB1PXIodCksaT0wLG89TyhuKTtvPmk7KXt2YXIgYT1NYXRoLmZsb29yKChpK28pLzIpO3IoblthXSk8dT9pPWErMTpvPWF9cmV0dXJuIGl9LG0uaW5kZXhPZj1yKDEsbS5maW5kSW5kZXgsbS5zb3J0ZWRJbmRleCksbS5sYXN0SW5kZXhPZj1yKC0xLG0uZmluZExhc3RJbmRleCksbS5yYW5nZT1mdW5jdGlvbihuLHQscil7bnVsbD09dCYmKHQ9bnx8MCxuPTApLHI9cnx8MTtmb3IodmFyIGU9TWF0aC5tYXgoTWF0aC5jZWlsKCh0LW4pL3IpLDApLHU9QXJyYXkoZSksaT0wO2U+aTtpKyssbis9cil1W2ldPW47cmV0dXJuIHV9O3ZhciBFPWZ1bmN0aW9uKG4sdCxyLGUsdSl7aWYoIShlIGluc3RhbmNlb2YgdCkpcmV0dXJuIG4uYXBwbHkocix1KTt2YXIgaT1qKG4ucHJvdG90eXBlKSxvPW4uYXBwbHkoaSx1KTtyZXR1cm4gbS5pc09iamVjdChvKT9vOml9O20uYmluZD1mdW5jdGlvbihuLHQpe2lmKGcmJm4uYmluZD09PWcpcmV0dXJuIGcuYXBwbHkobixsLmNhbGwoYXJndW1lbnRzLDEpKTtpZighbS5pc0Z1bmN0aW9uKG4pKXRocm93IG5ldyBUeXBlRXJyb3IoXCJCaW5kIG11c3QgYmUgY2FsbGVkIG9uIGEgZnVuY3Rpb25cIik7dmFyIHI9bC5jYWxsKGFyZ3VtZW50cywyKSxlPWZ1bmN0aW9uKCl7cmV0dXJuIEUobixlLHQsdGhpcyxyLmNvbmNhdChsLmNhbGwoYXJndW1lbnRzKSkpfTtyZXR1cm4gZX0sbS5wYXJ0aWFsPWZ1bmN0aW9uKG4pe3ZhciB0PWwuY2FsbChhcmd1bWVudHMsMSkscj1mdW5jdGlvbigpe2Zvcih2YXIgZT0wLHU9dC5sZW5ndGgsaT1BcnJheSh1KSxvPTA7dT5vO28rKylpW29dPXRbb109PT1tP2FyZ3VtZW50c1tlKytdOnRbb107Zm9yKDtlPGFyZ3VtZW50cy5sZW5ndGg7KWkucHVzaChhcmd1bWVudHNbZSsrXSk7cmV0dXJuIEUobixyLHRoaXMsdGhpcyxpKX07cmV0dXJuIHJ9LG0uYmluZEFsbD1mdW5jdGlvbihuKXt2YXIgdCxyLGU9YXJndW1lbnRzLmxlbmd0aDtpZigxPj1lKXRocm93IG5ldyBFcnJvcihcImJpbmRBbGwgbXVzdCBiZSBwYXNzZWQgZnVuY3Rpb24gbmFtZXNcIik7Zm9yKHQ9MTtlPnQ7dCsrKXI9YXJndW1lbnRzW3RdLG5bcl09bS5iaW5kKG5bcl0sbik7cmV0dXJuIG59LG0ubWVtb2l6ZT1mdW5jdGlvbihuLHQpe3ZhciByPWZ1bmN0aW9uKGUpe3ZhciB1PXIuY2FjaGUsaT1cIlwiKyh0P3QuYXBwbHkodGhpcyxhcmd1bWVudHMpOmUpO3JldHVybiBtLmhhcyh1LGkpfHwodVtpXT1uLmFwcGx5KHRoaXMsYXJndW1lbnRzKSksdVtpXX07cmV0dXJuIHIuY2FjaGU9e30scn0sbS5kZWxheT1mdW5jdGlvbihuLHQpe3ZhciByPWwuY2FsbChhcmd1bWVudHMsMik7cmV0dXJuIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtyZXR1cm4gbi5hcHBseShudWxsLHIpfSx0KX0sbS5kZWZlcj1tLnBhcnRpYWwobS5kZWxheSxtLDEpLG0udGhyb3R0bGU9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaSxvPW51bGwsYT0wO3J8fChyPXt9KTt2YXIgYz1mdW5jdGlvbigpe2E9ci5sZWFkaW5nPT09ITE/MDptLm5vdygpLG89bnVsbCxpPW4uYXBwbHkoZSx1KSxvfHwoZT11PW51bGwpfTtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgZj1tLm5vdygpO2F8fHIubGVhZGluZyE9PSExfHwoYT1mKTt2YXIgbD10LShmLWEpO3JldHVybiBlPXRoaXMsdT1hcmd1bWVudHMsMD49bHx8bD50PyhvJiYoY2xlYXJUaW1lb3V0KG8pLG89bnVsbCksYT1mLGk9bi5hcHBseShlLHUpLG98fChlPXU9bnVsbCkpOm98fHIudHJhaWxpbmc9PT0hMXx8KG89c2V0VGltZW91dChjLGwpKSxpfX0sbS5kZWJvdW5jZT1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpLG8sYSxjPWZ1bmN0aW9uKCl7dmFyIGY9bS5ub3coKS1vO3Q+ZiYmZj49MD9lPXNldFRpbWVvdXQoYyx0LWYpOihlPW51bGwscnx8KGE9bi5hcHBseShpLHUpLGV8fChpPXU9bnVsbCkpKX07cmV0dXJuIGZ1bmN0aW9uKCl7aT10aGlzLHU9YXJndW1lbnRzLG89bS5ub3coKTt2YXIgZj1yJiYhZTtyZXR1cm4gZXx8KGU9c2V0VGltZW91dChjLHQpKSxmJiYoYT1uLmFwcGx5KGksdSksaT11PW51bGwpLGF9fSxtLndyYXA9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5wYXJ0aWFsKHQsbil9LG0ubmVnYXRlPWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbigpe3JldHVybiFuLmFwcGx5KHRoaXMsYXJndW1lbnRzKX19LG0uY29tcG9zZT1mdW5jdGlvbigpe3ZhciBuPWFyZ3VtZW50cyx0PW4ubGVuZ3RoLTE7cmV0dXJuIGZ1bmN0aW9uKCl7Zm9yKHZhciByPXQsZT1uW3RdLmFwcGx5KHRoaXMsYXJndW1lbnRzKTtyLS07KWU9bltyXS5jYWxsKHRoaXMsZSk7cmV0dXJuIGV9fSxtLmFmdGVyPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuLS1uPDE/dC5hcHBseSh0aGlzLGFyZ3VtZW50cyk6dm9pZCAwfX0sbS5iZWZvcmU9ZnVuY3Rpb24obix0KXt2YXIgcjtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4tLW4+MCYmKHI9dC5hcHBseSh0aGlzLGFyZ3VtZW50cykpLDE+PW4mJih0PW51bGwpLHJ9fSxtLm9uY2U9bS5wYXJ0aWFsKG0uYmVmb3JlLDIpO3ZhciBNPSF7dG9TdHJpbmc6bnVsbH0ucHJvcGVydHlJc0VudW1lcmFibGUoXCJ0b1N0cmluZ1wiKSxJPVtcInZhbHVlT2ZcIixcImlzUHJvdG90eXBlT2ZcIixcInRvU3RyaW5nXCIsXCJwcm9wZXJ0eUlzRW51bWVyYWJsZVwiLFwiaGFzT3duUHJvcGVydHlcIixcInRvTG9jYWxlU3RyaW5nXCJdO20ua2V5cz1mdW5jdGlvbihuKXtpZighbS5pc09iamVjdChuKSlyZXR1cm5bXTtpZih2KXJldHVybiB2KG4pO3ZhciB0PVtdO2Zvcih2YXIgciBpbiBuKW0uaGFzKG4scikmJnQucHVzaChyKTtyZXR1cm4gTSYmZShuLHQpLHR9LG0uYWxsS2V5cz1mdW5jdGlvbihuKXtpZighbS5pc09iamVjdChuKSlyZXR1cm5bXTt2YXIgdD1bXTtmb3IodmFyIHIgaW4gbil0LnB1c2gocik7cmV0dXJuIE0mJmUobix0KSx0fSxtLnZhbHVlcz1mdW5jdGlvbihuKXtmb3IodmFyIHQ9bS5rZXlzKG4pLHI9dC5sZW5ndGgsZT1BcnJheShyKSx1PTA7cj51O3UrKyllW3VdPW5bdFt1XV07cmV0dXJuIGV9LG0ubWFwT2JqZWN0PWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGUsdT1tLmtleXMobiksaT11Lmxlbmd0aCxvPXt9LGE9MDtpPmE7YSsrKWU9dVthXSxvW2VdPXQobltlXSxlLG4pO3JldHVybiBvfSxtLnBhaXJzPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD1tLmtleXMobikscj10Lmxlbmd0aCxlPUFycmF5KHIpLHU9MDtyPnU7dSsrKWVbdV09W3RbdV0sblt0W3VdXV07cmV0dXJuIGV9LG0uaW52ZXJ0PWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD17fSxyPW0ua2V5cyhuKSxlPTAsdT1yLmxlbmd0aDt1PmU7ZSsrKXRbbltyW2VdXV09cltlXTtyZXR1cm4gdH0sbS5mdW5jdGlvbnM9bS5tZXRob2RzPWZ1bmN0aW9uKG4pe3ZhciB0PVtdO2Zvcih2YXIgciBpbiBuKW0uaXNGdW5jdGlvbihuW3JdKSYmdC5wdXNoKHIpO3JldHVybiB0LnNvcnQoKX0sbS5leHRlbmQ9XyhtLmFsbEtleXMpLG0uZXh0ZW5kT3duPW0uYXNzaWduPV8obS5rZXlzKSxtLmZpbmRLZXk9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZSx1PW0ua2V5cyhuKSxpPTAsbz11Lmxlbmd0aDtvPmk7aSsrKWlmKGU9dVtpXSx0KG5bZV0sZSxuKSlyZXR1cm4gZX0sbS5waWNrPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGk9e30sbz1uO2lmKG51bGw9PW8pcmV0dXJuIGk7bS5pc0Z1bmN0aW9uKHQpPyh1PW0uYWxsS2V5cyhvKSxlPWIodCxyKSk6KHU9Uyhhcmd1bWVudHMsITEsITEsMSksZT1mdW5jdGlvbihuLHQscil7cmV0dXJuIHQgaW4gcn0sbz1PYmplY3QobykpO2Zvcih2YXIgYT0wLGM9dS5sZW5ndGg7Yz5hO2ErKyl7dmFyIGY9dVthXSxsPW9bZl07ZShsLGYsbykmJihpW2ZdPWwpfXJldHVybiBpfSxtLm9taXQ9ZnVuY3Rpb24obix0LHIpe2lmKG0uaXNGdW5jdGlvbih0KSl0PW0ubmVnYXRlKHQpO2Vsc2V7dmFyIGU9bS5tYXAoUyhhcmd1bWVudHMsITEsITEsMSksU3RyaW5nKTt0PWZ1bmN0aW9uKG4sdCl7cmV0dXJuIW0uY29udGFpbnMoZSx0KX19cmV0dXJuIG0ucGljayhuLHQscil9LG0uZGVmYXVsdHM9XyhtLmFsbEtleXMsITApLG0uY3JlYXRlPWZ1bmN0aW9uKG4sdCl7dmFyIHI9aihuKTtyZXR1cm4gdCYmbS5leHRlbmRPd24ocix0KSxyfSxtLmNsb25lPWZ1bmN0aW9uKG4pe3JldHVybiBtLmlzT2JqZWN0KG4pP20uaXNBcnJheShuKT9uLnNsaWNlKCk6bS5leHRlbmQoe30sbik6bn0sbS50YXA9ZnVuY3Rpb24obix0KXtyZXR1cm4gdChuKSxufSxtLmlzTWF0Y2g9ZnVuY3Rpb24obix0KXt2YXIgcj1tLmtleXModCksZT1yLmxlbmd0aDtpZihudWxsPT1uKXJldHVybiFlO2Zvcih2YXIgdT1PYmplY3QobiksaT0wO2U+aTtpKyspe3ZhciBvPXJbaV07aWYodFtvXSE9PXVbb118fCEobyBpbiB1KSlyZXR1cm4hMX1yZXR1cm4hMH07dmFyIE49ZnVuY3Rpb24obix0LHIsZSl7aWYobj09PXQpcmV0dXJuIDAhPT1ufHwxL249PT0xL3Q7aWYobnVsbD09bnx8bnVsbD09dClyZXR1cm4gbj09PXQ7biBpbnN0YW5jZW9mIG0mJihuPW4uX3dyYXBwZWQpLHQgaW5zdGFuY2VvZiBtJiYodD10Ll93cmFwcGVkKTt2YXIgdT1zLmNhbGwobik7aWYodSE9PXMuY2FsbCh0KSlyZXR1cm4hMTtzd2l0Y2godSl7Y2FzZVwiW29iamVjdCBSZWdFeHBdXCI6Y2FzZVwiW29iamVjdCBTdHJpbmddXCI6cmV0dXJuXCJcIituPT1cIlwiK3Q7Y2FzZVwiW29iamVjdCBOdW1iZXJdXCI6cmV0dXJuK24hPT0rbj8rdCE9PSt0OjA9PT0rbj8xLytuPT09MS90OituPT09K3Q7Y2FzZVwiW29iamVjdCBEYXRlXVwiOmNhc2VcIltvYmplY3QgQm9vbGVhbl1cIjpyZXR1cm4rbj09PSt0fXZhciBpPVwiW29iamVjdCBBcnJheV1cIj09PXU7aWYoIWkpe2lmKFwib2JqZWN0XCIhPXR5cGVvZiBufHxcIm9iamVjdFwiIT10eXBlb2YgdClyZXR1cm4hMTt2YXIgbz1uLmNvbnN0cnVjdG9yLGE9dC5jb25zdHJ1Y3RvcjtpZihvIT09YSYmIShtLmlzRnVuY3Rpb24obykmJm8gaW5zdGFuY2VvZiBvJiZtLmlzRnVuY3Rpb24oYSkmJmEgaW5zdGFuY2VvZiBhKSYmXCJjb25zdHJ1Y3RvclwiaW4gbiYmXCJjb25zdHJ1Y3RvclwiaW4gdClyZXR1cm4hMX1yPXJ8fFtdLGU9ZXx8W107Zm9yKHZhciBjPXIubGVuZ3RoO2MtLTspaWYocltjXT09PW4pcmV0dXJuIGVbY109PT10O2lmKHIucHVzaChuKSxlLnB1c2godCksaSl7aWYoYz1uLmxlbmd0aCxjIT09dC5sZW5ndGgpcmV0dXJuITE7Zm9yKDtjLS07KWlmKCFOKG5bY10sdFtjXSxyLGUpKXJldHVybiExfWVsc2V7dmFyIGYsbD1tLmtleXMobik7aWYoYz1sLmxlbmd0aCxtLmtleXModCkubGVuZ3RoIT09YylyZXR1cm4hMTtmb3IoO2MtLTspaWYoZj1sW2NdLCFtLmhhcyh0LGYpfHwhTihuW2ZdLHRbZl0scixlKSlyZXR1cm4hMX1yZXR1cm4gci5wb3AoKSxlLnBvcCgpLCEwfTttLmlzRXF1YWw9ZnVuY3Rpb24obix0KXtyZXR1cm4gTihuLHQpfSxtLmlzRW1wdHk9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PW4/ITA6ayhuKSYmKG0uaXNBcnJheShuKXx8bS5pc1N0cmluZyhuKXx8bS5pc0FyZ3VtZW50cyhuKSk/MD09PW4ubGVuZ3RoOjA9PT1tLmtleXMobikubGVuZ3RofSxtLmlzRWxlbWVudD1mdW5jdGlvbihuKXtyZXR1cm4hKCFufHwxIT09bi5ub2RlVHlwZSl9LG0uaXNBcnJheT1ofHxmdW5jdGlvbihuKXtyZXR1cm5cIltvYmplY3QgQXJyYXldXCI9PT1zLmNhbGwobil9LG0uaXNPYmplY3Q9ZnVuY3Rpb24obil7dmFyIHQ9dHlwZW9mIG47cmV0dXJuXCJmdW5jdGlvblwiPT09dHx8XCJvYmplY3RcIj09PXQmJiEhbn0sbS5lYWNoKFtcIkFyZ3VtZW50c1wiLFwiRnVuY3Rpb25cIixcIlN0cmluZ1wiLFwiTnVtYmVyXCIsXCJEYXRlXCIsXCJSZWdFeHBcIixcIkVycm9yXCJdLGZ1bmN0aW9uKG4pe21bXCJpc1wiK25dPWZ1bmN0aW9uKHQpe3JldHVybiBzLmNhbGwodCk9PT1cIltvYmplY3QgXCIrbitcIl1cIn19KSxtLmlzQXJndW1lbnRzKGFyZ3VtZW50cyl8fChtLmlzQXJndW1lbnRzPWZ1bmN0aW9uKG4pe3JldHVybiBtLmhhcyhuLFwiY2FsbGVlXCIpfSksXCJmdW5jdGlvblwiIT10eXBlb2YvLi8mJlwib2JqZWN0XCIhPXR5cGVvZiBJbnQ4QXJyYXkmJihtLmlzRnVuY3Rpb249ZnVuY3Rpb24obil7cmV0dXJuXCJmdW5jdGlvblwiPT10eXBlb2Ygbnx8ITF9KSxtLmlzRmluaXRlPWZ1bmN0aW9uKG4pe3JldHVybiBpc0Zpbml0ZShuKSYmIWlzTmFOKHBhcnNlRmxvYXQobikpfSxtLmlzTmFOPWZ1bmN0aW9uKG4pe3JldHVybiBtLmlzTnVtYmVyKG4pJiZuIT09K259LG0uaXNCb29sZWFuPWZ1bmN0aW9uKG4pe3JldHVybiBuPT09ITB8fG49PT0hMXx8XCJbb2JqZWN0IEJvb2xlYW5dXCI9PT1zLmNhbGwobil9LG0uaXNOdWxsPWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT09bn0sbS5pc1VuZGVmaW5lZD1mdW5jdGlvbihuKXtyZXR1cm4gbj09PXZvaWQgMH0sbS5oYXM9ZnVuY3Rpb24obix0KXtyZXR1cm4gbnVsbCE9biYmcC5jYWxsKG4sdCl9LG0ubm9Db25mbGljdD1mdW5jdGlvbigpe3JldHVybiB1Ll89aSx0aGlzfSxtLmlkZW50aXR5PWZ1bmN0aW9uKG4pe3JldHVybiBufSxtLmNvbnN0YW50PWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbigpe3JldHVybiBufX0sbS5ub29wPWZ1bmN0aW9uKCl7fSxtLnByb3BlcnR5PXcsbS5wcm9wZXJ0eU9mPWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT1uP2Z1bmN0aW9uKCl7fTpmdW5jdGlvbih0KXtyZXR1cm4gblt0XX19LG0ubWF0Y2hlcj1tLm1hdGNoZXM9ZnVuY3Rpb24obil7cmV0dXJuIG49bS5leHRlbmRPd24oe30sbiksZnVuY3Rpb24odCl7cmV0dXJuIG0uaXNNYXRjaCh0LG4pfX0sbS50aW1lcz1mdW5jdGlvbihuLHQscil7dmFyIGU9QXJyYXkoTWF0aC5tYXgoMCxuKSk7dD1iKHQsciwxKTtmb3IodmFyIHU9MDtuPnU7dSsrKWVbdV09dCh1KTtyZXR1cm4gZX0sbS5yYW5kb209ZnVuY3Rpb24obix0KXtyZXR1cm4gbnVsbD09dCYmKHQ9bixuPTApLG4rTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpKih0LW4rMSkpfSxtLm5vdz1EYXRlLm5vd3x8ZnVuY3Rpb24oKXtyZXR1cm4obmV3IERhdGUpLmdldFRpbWUoKX07dmFyIEI9e1wiJlwiOlwiJmFtcDtcIixcIjxcIjpcIiZsdDtcIixcIj5cIjpcIiZndDtcIiwnXCInOlwiJnF1b3Q7XCIsXCInXCI6XCImI3gyNztcIixcImBcIjpcIiYjeDYwO1wifSxUPW0uaW52ZXJ0KEIpLFI9ZnVuY3Rpb24obil7dmFyIHQ9ZnVuY3Rpb24odCl7cmV0dXJuIG5bdF19LHI9XCIoPzpcIittLmtleXMobikuam9pbihcInxcIikrXCIpXCIsZT1SZWdFeHAociksdT1SZWdFeHAocixcImdcIik7cmV0dXJuIGZ1bmN0aW9uKG4pe3JldHVybiBuPW51bGw9PW4/XCJcIjpcIlwiK24sZS50ZXN0KG4pP24ucmVwbGFjZSh1LHQpOm59fTttLmVzY2FwZT1SKEIpLG0udW5lc2NhcGU9UihUKSxtLnJlc3VsdD1mdW5jdGlvbihuLHQscil7dmFyIGU9bnVsbD09bj92b2lkIDA6blt0XTtyZXR1cm4gZT09PXZvaWQgMCYmKGU9ciksbS5pc0Z1bmN0aW9uKGUpP2UuY2FsbChuKTplfTt2YXIgcT0wO20udW5pcXVlSWQ9ZnVuY3Rpb24obil7dmFyIHQ9KytxK1wiXCI7cmV0dXJuIG4/bit0OnR9LG0udGVtcGxhdGVTZXR0aW5ncz17ZXZhbHVhdGU6LzwlKFtcXHNcXFNdKz8pJT4vZyxpbnRlcnBvbGF0ZTovPCU9KFtcXHNcXFNdKz8pJT4vZyxlc2NhcGU6LzwlLShbXFxzXFxTXSs/KSU+L2d9O3ZhciBLPS8oLileLyx6PXtcIidcIjpcIidcIixcIlxcXFxcIjpcIlxcXFxcIixcIlxcclwiOlwiclwiLFwiXFxuXCI6XCJuXCIsXCJcXHUyMDI4XCI6XCJ1MjAyOFwiLFwiXFx1MjAyOVwiOlwidTIwMjlcIn0sRD0vXFxcXHwnfFxccnxcXG58XFx1MjAyOHxcXHUyMDI5L2csTD1mdW5jdGlvbihuKXtyZXR1cm5cIlxcXFxcIit6W25dfTttLnRlbXBsYXRlPWZ1bmN0aW9uKG4sdCxyKXshdCYmciYmKHQ9ciksdD1tLmRlZmF1bHRzKHt9LHQsbS50ZW1wbGF0ZVNldHRpbmdzKTt2YXIgZT1SZWdFeHAoWyh0LmVzY2FwZXx8Sykuc291cmNlLCh0LmludGVycG9sYXRlfHxLKS5zb3VyY2UsKHQuZXZhbHVhdGV8fEspLnNvdXJjZV0uam9pbihcInxcIikrXCJ8JFwiLFwiZ1wiKSx1PTAsaT1cIl9fcCs9J1wiO24ucmVwbGFjZShlLGZ1bmN0aW9uKHQscixlLG8sYSl7cmV0dXJuIGkrPW4uc2xpY2UodSxhKS5yZXBsYWNlKEQsTCksdT1hK3QubGVuZ3RoLHI/aSs9XCInK1xcbigoX190PShcIityK1wiKSk9PW51bGw/Jyc6Xy5lc2NhcGUoX190KSkrXFxuJ1wiOmU/aSs9XCInK1xcbigoX190PShcIitlK1wiKSk9PW51bGw/Jyc6X190KStcXG4nXCI6byYmKGkrPVwiJztcXG5cIitvK1wiXFxuX19wKz0nXCIpLHR9KSxpKz1cIic7XFxuXCIsdC52YXJpYWJsZXx8KGk9XCJ3aXRoKG9ianx8e30pe1xcblwiK2krXCJ9XFxuXCIpLGk9XCJ2YXIgX190LF9fcD0nJyxfX2o9QXJyYXkucHJvdG90eXBlLmpvaW4sXCIrXCJwcmludD1mdW5jdGlvbigpe19fcCs9X19qLmNhbGwoYXJndW1lbnRzLCcnKTt9O1xcblwiK2krXCJyZXR1cm4gX19wO1xcblwiO3RyeXt2YXIgbz1uZXcgRnVuY3Rpb24odC52YXJpYWJsZXx8XCJvYmpcIixcIl9cIixpKX1jYXRjaChhKXt0aHJvdyBhLnNvdXJjZT1pLGF9dmFyIGM9ZnVuY3Rpb24obil7cmV0dXJuIG8uY2FsbCh0aGlzLG4sbSl9LGY9dC52YXJpYWJsZXx8XCJvYmpcIjtyZXR1cm4gYy5zb3VyY2U9XCJmdW5jdGlvbihcIitmK1wiKXtcXG5cIitpK1wifVwiLGN9LG0uY2hhaW49ZnVuY3Rpb24obil7dmFyIHQ9bShuKTtyZXR1cm4gdC5fY2hhaW49ITAsdH07dmFyIFA9ZnVuY3Rpb24obix0KXtyZXR1cm4gbi5fY2hhaW4/bSh0KS5jaGFpbigpOnR9O20ubWl4aW49ZnVuY3Rpb24obil7bS5lYWNoKG0uZnVuY3Rpb25zKG4pLGZ1bmN0aW9uKHQpe3ZhciByPW1bdF09blt0XTttLnByb3RvdHlwZVt0XT1mdW5jdGlvbigpe3ZhciBuPVt0aGlzLl93cmFwcGVkXTtyZXR1cm4gZi5hcHBseShuLGFyZ3VtZW50cyksUCh0aGlzLHIuYXBwbHkobSxuKSl9fSl9LG0ubWl4aW4obSksbS5lYWNoKFtcInBvcFwiLFwicHVzaFwiLFwicmV2ZXJzZVwiLFwic2hpZnRcIixcInNvcnRcIixcInNwbGljZVwiLFwidW5zaGlmdFwiXSxmdW5jdGlvbihuKXt2YXIgdD1vW25dO20ucHJvdG90eXBlW25dPWZ1bmN0aW9uKCl7dmFyIHI9dGhpcy5fd3JhcHBlZDtyZXR1cm4gdC5hcHBseShyLGFyZ3VtZW50cyksXCJzaGlmdFwiIT09biYmXCJzcGxpY2VcIiE9PW58fDAhPT1yLmxlbmd0aHx8ZGVsZXRlIHJbMF0sUCh0aGlzLHIpfX0pLG0uZWFjaChbXCJjb25jYXRcIixcImpvaW5cIixcInNsaWNlXCJdLGZ1bmN0aW9uKG4pe3ZhciB0PW9bbl07bS5wcm90b3R5cGVbbl09ZnVuY3Rpb24oKXtyZXR1cm4gUCh0aGlzLHQuYXBwbHkodGhpcy5fd3JhcHBlZCxhcmd1bWVudHMpKX19KSxtLnByb3RvdHlwZS52YWx1ZT1mdW5jdGlvbigpe3JldHVybiB0aGlzLl93cmFwcGVkfSxtLnByb3RvdHlwZS52YWx1ZU9mPW0ucHJvdG90eXBlLnRvSlNPTj1tLnByb3RvdHlwZS52YWx1ZSxtLnByb3RvdHlwZS50b1N0cmluZz1mdW5jdGlvbigpe3JldHVyblwiXCIrdGhpcy5fd3JhcHBlZH0sXCJmdW5jdGlvblwiPT10eXBlb2YgZGVmaW5lJiZkZWZpbmUuYW1kJiZkZWZpbmUoXCJ1bmRlcnNjb3JlXCIsW10sZnVuY3Rpb24oKXtyZXR1cm4gbX0pfSkuY2FsbCh0aGlzKTsiXX0=
