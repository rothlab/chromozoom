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
  strip = utils.strip;
  parseInt10 = utils.parseInt10;

function CustomTrack(opts, browserOpts) {
  if (!opts) { return; } // This is an empty customTrack that will be hydrated with values from a serialized object
  var typeWithArgs = (opts.type && strip(opts.type.toLowerCase()).split(/\s+/)) || ["bed"];
  opts.type = this._type = typeWithArgs[0];
  var type = this.type();
  if (type === null) { throw new Error("Unsupported track type '"+opts.type+"' encountered on line " + opts.lineNum); }
  this.opts = _.extend({}, this.constructor.defaults, type.defaults || {}, opts);
  _.extend(this, {
    browserOpts: browserOpts,
    typeArgs: typeWithArgs.slice(1),
    stretchHeight: false,
    heights: {},
    sizes: ['dense'],
    mapSizes: [],
    areas: {},
    scales: {},
    noAreaLabels: false,
    expectsSequence: false,
    onSyncProps: null
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

// Loads CustomTrack options into the track options dialog UI when it is opened
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

// Saves options changed in the track options dialog UI back to the CustomTrack object
CustomTrack.prototype.saveOpts = function($dialog) {
  var type = this.type(),
    o = this.opts;
  o.color = $dialog.find('[name=color]').val();
  if (!this.validateColor(o.color)) { o.color = '0,0,0'; }
  if (type.saveOpts) { type.saveOpts.call(this, $dialog); }
  this.applyOpts();
  global.CustomTracks.worker() && this.applyOptsAsync(); // Apply the changes to the worker too!
};

// Sometimes newly set options (provided as the first arg) need to be transformed before use or have side effects.
// This function is run for newly set options in both the DOM and Web Worker scopes (see applyOptsAsync below).
CustomTrack.prototype.applyOpts = function(opts) {
  var type = this.type();
  if (opts) { this.opts = opts; }
  if (type.applyOpts) { type.applyOpts.call(this); }
};

// Copies the properties of the CustomTrack (listed in props) from the Web Worker side to the DOM side.
// This is useful if the Web Worker computes something (like draw boundaries) that both sides need to be aware of.
// If a callback is saved in this.onSyncProps, this will run the callback afterward.
// If Web Workers are disabled, this is effectively a no-op, although the callback still fires.
CustomTrack.prototype.syncProps = function(props, receiving) {
  var self = this;
  if (receiving === true) {
    if (!_.isObject(props) || _.isArray(props)) { return false; }
    _.extend(self, props);
    if (_.isFunction(self.onSyncProps) && global.HTMLDocument) { self.onSyncProps(props); }
    return self;
  } else {    
    if (_.isArray(props)) { props =_.object(props, _.map(props, function(p) { return self[p]; })); }
    // Which side of the fence are we on?  HTMLDocument implies we're *not* in the Web Worker scope.
    if (global.HTMLDocument) {
      if (!global.CustomTracks.worker()) { return self.syncProps(props, true); }
    } else if (global.CustomTrackWorker) {
      global.CustomTrackWorker.syncPropsAsync(self, props);
    }
  }
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
    _tracks: {},
    
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
            if (e.data.id) { delete callbacks[e.data.id]; }
            self.error(JSON.parse(e.data.error));
            return;
          }
          if (e.data.syncProps) {
            self._tracks[e.data.id].syncProps(e.data.syncProps, true);
            return;
          }
          callbacks[e.data.id](JSON.parse(e.data.ret));
          delete callbacks[e.data.id];
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
      var self = this;
      self.async(self, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          self._tracks[t.id] = _.extend(new CustomTrack(), t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
          return self._tracks[t.id];
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
      var trackOpts, visible = true;
      t.lines = t.lines || [];
      trackOpts = /^track\s+/i.test(t.lines[0]) ? global.CustomTracks.parseDeclarationLine(t.lines.shift()) : {};
      _.extend(trackOpts, t.opts, {name: t.name, type: t.type});
      if (trackOpts.visibility) {
        if (trackOpts.visibility == 'hide') { visible = false; }
        delete trackOpts.visibility;
      }
      t.lines.unshift('track ' + optsAsTrackLine(trackOpts) + '\n');
      o.availTracks.push({
        fh: {},
        n: t.name,
        s: ['dense', 'squish', 'pack'],
        h: 15,
        m: ['pack'],
        customData: t.lines
      });
      if (visible) { o.tracks.push({n: t.name}); }
      o.trackDesc[t.name] = {
        cat: "Feature Tracks",
        sm: t.shortLabel || t.name,
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
    viewLimits: '',  // analogous to viewLimits in wiggle_0, applicable here to the coverage subtrack
    url: '',
    htmlUrl: '',
    drawLimit: {squish: 2000, pack: 2000},
    covHeight: {dense: 24, squish: 38, pack: 38},
    // If a nucleotide differs from the reference sequence in greater than 20% of quality weighted reads, 
    // IGV colors the bar in proportion to the read count of each base; the following changes that threshold for chromozoom
    alleleFreqThreshold: 0.2,
    // Data for how many nts should be fetched in one go?
    optimalFetchWindow: 0,
    // Above what tile width (in nts) do we avoid fetching data altogether?
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
    this.type().initOpts.call(this);
    this.browserChrScheme = this.type("bam").guessChrScheme(_.keys(this.browserOpts.chrPos));
  },
  
  initOpts: function() {
    var o = this.opts;
    o.viewAsPairs = this.isOn(o.viewAsPairs);
    if (!_.isArray(o.viewLimits)) {
      o.viewLimits = _.map(o.viewLimits.split(':'), parseFloat);
    }
  },
  
  // TODO: If the pairing interval changed, we should toss the entire cache and reset the RemoteTrack bins,
  //         *and* blow up the areaIndex.
  applyOpts: function() {
    var self = this,
      o = this.opts;
    // When we change opts.viewAsPairs, we *need* to throw out this.data.pileup.
    if (o.viewAsPairs != this.prevOpts.viewAsPairs && this.data && this.data.pileup) { 
      this.data.pileup = {};
    }
    this.drawRange = o.autoScale || o.viewLimits.length < 2 ? this.coverageRange : o.viewLimits;
    this.scales = _.mapObject({dense: 0, squish: 0, pack: 0}, function(v, k) {
      return [{limits: self.drawRange, specialTicks: [Math.round(self.drawRange[1] / 2)], top: 0, height: o.covHeight[k] || 24}];
    });
    // TODO: Setup this.scales here
    
    // Ensures that options and derived properties set by the above are equal across Web Worker and DOM contexts
    this.syncProps(['opts', 'drawRange', 'coverageRange', 'scales']);
    
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
    self.coverageRange = [0, 0];
    self.prevOpts = deepClone(o);  // used to detect which drawing options have been changed by the user
    
    // Get general info on the bam (e.g. `samtools idxstats`), use mapped reads per reference sequence
    // to estimate maxFetchWindow and optimalFetchWindow, and setup binning on the RemoteTrack.
    // We also fetch a bunch of reads from around infoChrRange (by default, where the browser is when
    // it first loads this track) to estimate meanItemLength, mate pairing, and the insert size distribution.
    $.ajax(ajaxUrl, {
      data: {info: 1, range: infoChrRange, url: o.bigDataUrl},
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
        
        if (infoParts[0] == '') { throw new Error("samtools failed to retrieve data for this BAM track."); }
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
        if (!o.optimalFetchWindow || !o.maxFetchWindow) {
          o.optimalFetchWindow = Math.floor(maxItemsToDraw / meanItemsPerBp / (Math.max(meanItemLength, 100) / 100) * 0.5);
          o.maxFetchWindow = o.optimalFetchWindow * 2;
        }
        if (!self.coverageRange[1]) { self.coverageRange[1] = Math.ceil(meanItemsPerBp * meanItemLength * 2); }
        self.type('bam').applyOpts.call(self);
        
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
      bars.push(utils.wigBinFunctions.maximum(bin));
    }
    return bars;
  },
  
  alleles: function(start, sequence, bppp) {
    var pileup = this.data.pileup,
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
          if (pile[nt] > 0) { split.splits.push({nt: nt, h: pile[nt]}); }
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
    var vScale = this.drawRange[1];
    _.each(coverage, function(d, x) {
      if (d === null) { return; }
      var h = d * height / vScale;
      ctx.fillRect(x, Math.max(height - h, 0), 1, Math.min(h, height));
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
      vScale = this.drawRange[1],
      yPos;
    _.each(alleles, function(allelesForPosition) {
      yPos = height;
      _.each(allelesForPosition.splits, function(split) {
        var h = split.h * height / vScale;
        ctx.fillStyle = 'rgb('+colors[split.nt]+')';
        ctx.fillRect(allelesForPosition.x, yPos -= h, Math.max(barWidth, 1), h);
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
      covHeight = self.opts.covHeight[density] || 38,
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
    this.type().initOpts.call(this);
    
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
  parseInt10 = utils.parseInt10,
  strip = utils.strip;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var LineMask = require('./utils/LineMask.js').LineMask;

var BED_STANDARD_FIELDS = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'itemRgb',
    'blockCount', 'blockSizes', 'blockStarts'];
var BED_DETAIL_FIELDS = ['id', 'description'];

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
    drawLimit: {squish: null, pack: null},
    bedPlusFields: BED_DETAIL_FIELDS
  },
  
  init: function() {
    this.type().initOpts.call(this);
  },
  
  initOpts: function() {
    var self = this,
      altColors = self.opts.colorByStrand.split(/\s+/),
      validColorByStrand = altColors.length > 1 && _.all(altColors, self.validateColor);
    self.numStandardColumns = BED_STANDARD_FIELDS.length;
    self.opts.useScore = self.isOn(self.opts.useScore);
    self.opts.itemRgb = self.isOn(self.opts.itemRgb);
    if (self.typeArgs.length > 0 && /^\d+$/.test(self.typeArgs[0])) {
      self.numStandardColumns = parseInt10(self.typeArgs[0]);
    }
    if (self.opts.bedPlusFields && !_.isArray(self.opts.bedPlusFields)) {
      self.opts.bedPlusFields = self.opts.bedPlusFields.split(',');
    }
    if (/%s/.test(self.opts.url)) { self.opts.url = self.opts.url.replace(/%s/, '$$$$'); }
    else if (self.opts.url && !(/\$\$/).test(self.opts.url)) { self.opts.url += '$$'; }
    console.log(self.opts.url);
    if (!validColorByStrand) { self.opts.colorByStrand = ''; self.opts.altColor = null; }
    else { self.opts.altColor = altColors[1]; }
  },

  parseLine: function(line, lineno) {
    var cols = BED_STANDARD_FIELDS,
      numStandardCols = this.numStandardColumns,
      bedPlusFields = this.opts.bedPlusFields,
      feature = {extra: {}},
      fields = /\t/.test(line) ? line.split("\t") : line.split(/\s+/),
      chrPos, blockSizes;
    
    if (this.opts.detail) {
      numStandardCols = Math.min(fields.length - 2, 12);
      bedPlusFields = BED_DETAIL_FIELDS;
    }
    _.each(fields, function(v, i) {
      var bedPlusField = i - numStandardCols;
      if (numStandardCols && i < numStandardCols) { feature[cols[i]] = v; }
      else {
        if (bedPlusFields && i - numStandardCols < bedPlusFields.length) { bedPlusField = bedPlusFields[i - numStandardCols]; }
        if (_.contains(BED_DETAIL_FIELDS, bedPlusField)) { feature[bedPlusField] = v; }
        else { feature.extra[bedPlusField] = v; }
      }
    });
    chrPos = this.browserOpts.chrPos[feature.chrom];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) { 
      this.warn("Invalid chromosome '"+feature.chrom+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.chromStart) + 1;
      feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
      if (feature.end === feature.start) { feature.end += 0.1; feature.zeroWidth = true; }
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
      tipTipDataCallback = this.type().tipTipData,
      nameFunc = this.type().nameFunc || utils.defaultNameFunc,
      autoId = (/\t/).test(data.d.id); // Only automatically generated id's could contain a tab character
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
      // Display the ID column (from bedDetail) unless it was automatically generated
      if (!_.isUndefined(data.d.id) && !autoId) { tipTipData.id = data.d.id; }
    }
    areas.push([
      data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, y1, x2, y2
      nameFunc(data.d),                                                                 // name
      urlTemplate.replace('$$', autoId || _.isUndefined(data.d.id) ? data.d.name : data.d.id), // href
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
    
    if (urlTemplate.match(/%s/)) { urlTemplate.replace(/%s/, '$$'); }
    else if (!urlTemplate.match(/\$\$/)) { urlTemplate += '$$'; }
    
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
    this.type('bed').initOpts.call(this);
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

// Faster than Math.floor (http://webdood.com/?p=219)
module.exports.floorHack = function(num) { return (num << 0) - (num < 0 ? 1 : 0); }

// Other tiny functions that we need for odds and ends...
var strip = module.exports.strip = function(str) { return str.replace(/^\s+|\s+$/g, ''); }
module.exports.parseInt10 = function(val) { return parseInt(val, 10); }
module.exports.deepClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }

// The default way by which we derive a name to be printed next to a range feature
var defaultNameFunc = module.exports.defaultNameFunc = function(d) { return strip(d.name || d.id || ''); }

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
  if (!_.isFunction(nameFunc)) { nameFunc = defaultNameFunc; }
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
    o.windowingFunction = o.windowingFunction.toLowerCase();
    if (_binFunctions && !_binFunctions[o.windowingFunction]) {
      throw new Error("invalid windowingFunction `" + o.windowingFunction + "` at line " + o.lineNum); 
    }
    if (_.isNaN(o.yLineMark)) { o.yLineMark = 0.0; }
  },
  
  applyOpts: function() {
    var self = this,
      o = self.opts;
    self.drawRange = o.autoScale || o.viewLimits.length < 2 ? self.range : o.viewLimits;
    _.each({max: 0, min: 2, start: 1}, function(v, k) { self.heights[k] = o.maxHeightPixels[v]; });
    self.scales = {
      _all: [{limits: self.drawRange, top: 0, bottom: 0}]
    };
    if (o.yLineOnOff) { self.scales._all[0].yLine = o.yLineMark; }
    
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3RJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN2RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzd0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2pSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBDdXN0b21HZW5vbWUgcmVwcmVzZW50cyBhIGdlbm9tZSBzcGVjaWZpY2F0aW9uIHRoYXQgY2FuIHByb2R1Y2Ugb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpIHtcblxudmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL3V0aWxzL3V0aWxzLmpzJyksXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZSxcbiAgbG9nMTAgPSB1dGlscy5sb2cxMCxcbiAgcm91bmRUb1BsYWNlcyA9IHV0aWxzLnJvdW5kVG9QbGFjZXM7XG5cbmZ1bmN0aW9uIEN1c3RvbUdlbm9tZShnaXZlbkZvcm1hdCwgbWV0YWRhdGEpIHsgICAgXG4gIC8vIGdpdmVuRm9ybWF0ID0gZmFsc2UgLS0+IHRoaXMgaXMgYW4gZW1wdHkgQ3VzdG9tR2Vub21lIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgaWYgKGdpdmVuRm9ybWF0ID09PSBmYWxzZSkgeyByZXR1cm47IH0gXG4gIFxuICB0aGlzLl9wYXJzZWQgPSBmYWxzZTtcbiAgdGhpcy5fZm9ybWF0ID0gKGdpdmVuRm9ybWF0ICYmIGdpdmVuRm9ybWF0LnRvTG93ZXJDYXNlKCkpIHx8IFwiY2hyb21zaXplc1wiO1xuICB2YXIgZm9ybWF0ID0gdGhpcy5mb3JtYXQoKTtcbiAgaWYgKGZvcm1hdCA9PT0gbnVsbCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBnZW5vbWUgZm9ybWF0ICdcIitmb3JtYXQrXCInIGVuY291bnRlcmVkXCIpOyB9XG4gIFxuICAvLyB0aGlzLm9wdHMgaG9sZHMgZXZlcnl0aGluZyB0aGF0ICQudWkuZ2Vub2Jyb3dzZXIgd2lsbCBuZWVkIHRvIGNvbnN0cnVjdCBhIHZpZXcgKHNlZSBDdXN0b21HZW5vbWUuZGVmYXVsdHMgYmVsb3cpXG4gIC8vIGl0IERPRVMgTk9UIHJlbGF0ZSB0byBcIm9wdGlvbnNcIiBmb3IgcGFyc2luZywgb3IgaG93IHRoZSBnZW5vbWUgaXMgYmVpbmcgaW50ZXJwcmV0ZWQsIG9yIGFueXRoaW5nIGxpa2UgdGhhdFxuICB0aGlzLm9wdHMgPSBfLmV4dGVuZCh7fSwgZGVlcENsb25lKHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMpLCBkZWVwQ2xvbmUoZm9ybWF0LmRlZmF1bHRzIHx8IHt9KSk7XG4gIFxuICAvLyB0aGlzLm1ldGFkYXRhIGhvbGRzIGluZm9ybWF0aW9uIGV4dGVybmFsIHRvIHRoZSBwYXJzZWQgdGV4dCBwYXNzZWQgaW4gZnJvbSB0aGUgYnJvd3NlciAoZS5nLiBmaWxlbmFtZSwgc291cmNlKVxuICB0aGlzLm1ldGFkYXRhID0gbWV0YWRhdGE7XG4gIFxuICAvLyB0aGlzLmRhdGEgaG9sZHMgYW55dGhpbmcgYWRkaXRpb25hbGx5IHBhcnNlZCBmcm9tIHRoZSBnZW5vbWUgZmlsZSAobWV0YWRhdGEsIHJlZmVyZW5jZXMsIGV0Yy4pXG4gIC8vIHR5cGljYWxseSB0aGlzIGlzIGFycmFuZ2VkIHBlciBjb250aWcsIGluIHRoZSBhcnJhbmdlbWVudCBvZiB0aGlzLmRhdGEuY29udGlnc1tpXS4gLi4uXG4gIHRoaXMuZGF0YSA9IHtcbiAgICBzZXF1ZW5jZTogXCJcIiAvLyB0aGUgZnVsbCBjb25jYXRlbmF0ZWQgc2VxdWVuY2UgZm9yIGFsbCBjb250aWdzIGluIHRoaXMgZ2Vub21lLCBpZiBhdmFpbGFibGVcbiAgfTtcbiAgXG4gIC8vIGNhbiB3ZSBjYWxsIC5nZXRTZXF1ZW5jZSBvbiB0aGlzIEN1c3RvbUdlbm9tZT9cbiAgdGhpcy5jYW5HZXRTZXF1ZW5jZSA9IGZhbHNlO1xuICBcbiAgaWYoZm9ybWF0LmluaXQpIHsgZm9ybWF0LmluaXQuY2FsbCh0aGlzKTsgfVxufVxuXG5DdXN0b21HZW5vbWUuZGVmYXVsdHMgPSB7XG4gIC8vIFRoZSBmb2xsb3dpbmcga2V5cyBzaG91bGQgYmUgb3ZlcnJpZGRlbiB3aGlsZSBwYXJzaW5nIHRoZSBnZW5vbWUgZmlsZVxuICBnZW5vbWU6ICdfYmxhbmsnLFxuICBzcGVjaWVzOiAnQmxhbmsgR2Vub21lJyxcbiAgYXNzZW1ibHlEYXRlOiAnJyxcbiAgdGlsZURpcjogbnVsbCxcbiAgb3Zlcnpvb21CcHBwczogW10sXG4gIG50c0JlbG93OiBbMSwgMC4xXSxcbiAgYXZhaWxUcmFja3M6IFtcbiAgICB7XG4gICAgICBmaDoge30sICAgICAgICAvLyBcImZpeGVkIGhlaWdodHNcIiBhYm92ZSB3aGljaCBhIGRlbnNpdHkgaXMgZm9yY2VkIHRvIGRpc3BsYXkgYWJvdmUgYSBjZXJ0YWluIHRyYWNrIGhlaWdodFxuICAgICAgICAgICAgICAgICAgICAgLy8gICAgZm9ybWF0dGVkIGxpa2Uge1wiMS4wMGUrMDVcIjp7XCJkZW5zZVwiOjE1fX1cbiAgICAgIG46IFwicnVsZXJcIiwgICAgLy8gc2hvcnQgdW5pcXVlIG5hbWUgZm9yIHRoZSB0cmFja1xuICAgICAgczogW1wiZGVuc2VcIl0sICAvLyBwb3NzaWJsZSBkZW5zaXRpZXMgZm9yIHRpbGVzLCBlLmcuIFtcImRlbnNlXCIsIFwic3F1aXNoXCIsIFwicGFja1wiXVxuICAgICAgaDogMjUgICAgICAgICAgLy8gc3RhcnRpbmcgaGVpZ2h0IGluIHB4XG4gICAgfVxuICBdLFxuICBnZW5vbWVTaXplOiAwLFxuICBjaHJMZW5ndGhzOiB7fSxcbiAgY2hyT3JkZXI6IFtdLFxuICBjaHJCYW5kczogbnVsbCxcbiAgdGlsZVdpZHRoOiAxMDAwLFxuICBzdWJkaXJGb3JCcHBwc1VuZGVyOiAzMzAsXG4gIGlkZW9ncmFtc0Fib3ZlOiAxMDAwLFxuICBtYXhOdFJlcXVlc3Q6IDIwMDAwLFxuICB0cmFja3M6IFt7bjogXCJydWxlclwifV0sXG4gIHRyYWNrRGVzYzoge1xuICAgIHJ1bGVyOiB7XG4gICAgICBjYXQ6IFwiTWFwcGluZyBhbmQgU2VxdWVuY2luZyBUcmFja3NcIixcbiAgICAgIHNtOiBcIkJhc2UgUG9zaXRpb25cIlxuICAgIH1cbiAgfSxcbiAgLy8gVGhlc2UgbGFzdCB0aHJlZSB3aWxsIGJlIG92ZXJyaWRkZW4gdXNpbmcga25vd2xlZGdlIG9mIHRoZSB3aW5kb3cncyB3aWR0aFxuICBicHBwczogW10sXG4gIGJwcHBOdW1iZXJzQmVsb3c6IFtdLFxuICBpbml0Wm9vbTogbnVsbFxufTtcblxuQ3VzdG9tR2Vub21lLmZvcm1hdHMgPSB7XG4gIGNocm9tc2l6ZXM6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvY2hyb21zaXplcy5qcycpLFxuICBmYXN0YTogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9mYXN0YS5qcycpLFxuICBnZW5iYW5rOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMnKSxcbiAgZW1ibDogbnVsbCAvLyBUT0RPLiBCYXNpY2FsbHkgZ2VuYmFuayB3aXRoIGV4dHJhIGNvbHVtbnMuXG59XG5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JtYXQoKS5wYXJzZS5hcHBseSh0aGlzLCBfLnRvQXJyYXkoYXJndW1lbnRzKSk7XG4gIHRoaXMuc2V0R2Vub21lU3RyaW5nKCk7XG4gIHRoaXMuX3BhcnNlZCA9IHRydWU7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmZvcm1hdCA9IGZ1bmN0aW9uKGZvcm1hdCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChfLmlzVW5kZWZpbmVkKGZvcm1hdCkpIHsgZm9ybWF0ID0gc2VsZi5fZm9ybWF0OyB9XG4gIHZhciBGb3JtYXRXcmFwcGVyID0gZnVuY3Rpb24oKSB7IF8uZXh0ZW5kKHRoaXMsIHNlbGYuY29uc3RydWN0b3IuZm9ybWF0c1tmb3JtYXRdKTsgcmV0dXJuIHRoaXM7IH07XG4gIEZvcm1hdFdyYXBwZXIucHJvdG90eXBlID0gc2VsZjtcbiAgcmV0dXJuIG5ldyBGb3JtYXRXcmFwcGVyKCk7XG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEdlbm9tZVN0cmluZyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgbyA9IHNlbGYub3B0cyxcbiAgICBleGNlcHRpb25zID0gWydmaWxlJywgJ2lnYicsICdhY2MnLCAndXJsJywgJ3Vjc2MnXSxcbiAgICBleGNlcHRpb24gPSBfLmZpbmQoZXhjZXB0aW9ucywgZnVuY3Rpb24odikgeyByZXR1cm4gIV8uaXNVbmRlZmluZWQoc2VsZi5tZXRhZGF0YVt2XSk7IH0pLFxuICAgIHBpZWNlcyA9IFtdO1xuICBpZiAoZXhjZXB0aW9uKSB7IG8uZ2Vub21lID0gZXhjZXB0aW9uICsgXCI6XCIgKyBzZWxmLm1ldGFkYXRhW2V4Y2VwdGlvbl07IH1cbiAgZWxzZSB7XG4gICAgcGllY2VzID0gWydjdXN0b20nICsgKHNlbGYubWV0YWRhdGEubmFtZSA/ICc6JyArIHNlbGYubWV0YWRhdGEubmFtZSA6ICcnKV07XG4gICAgXy5lYWNoKG8uY2hyT3JkZXIsIGZ1bmN0aW9uKGNocikge1xuICAgICAgcGllY2VzLnB1c2goY2hyICsgJzonICsgby5jaHJMZW5ndGhzW2Nocl0pO1xuICAgIH0pO1xuICAgIG8uZ2Vub21lID0gcGllY2VzLmpvaW4oJ3wnKTtcbiAgfVxufTtcblxuLy8gU29tZSBvZiB0aGUgb3B0aW9ucyBmb3IgJC51aS5nZW5vYnJvd3NlciAoYWxsIHIvdCB6b29tIGxldmVscykgbXVzdCBiZSBzZXQgYmFzZWQgb24gdGhlIHdpZHRoIG9mIHRoZSB3aW5kb3dcbi8vICAgVGhleSBhcmUgLmJwcHBzLCAuYnBwcE51bWJlcnNCZWxvdywgYW5kIC5pbml0Wm9vbVxuLy8gICBUaGV5IGRvIG5vdCBhZmZlY3QgYW55IG9mIHRoZSBvdGhlciBvcHRpb25zIHNldCBkdXJpbmcgcGFyc2luZy5cbi8vXG4vLyB3aW5kb3dPcHRzIE1VU1QgaW5jbHVkZSBhIHByb3BlcnR5LCAud2lkdGgsIHRoYXQgaXMgdGhlIHdpbmRvdy5pbm5lcldpZHRoXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnNldEJwcHBzID0gZnVuY3Rpb24od2luZG93T3B0cykge1xuICB3aW5kb3dPcHRzID0gd2luZG93T3B0cyB8fCB7fTtcbiAgXG4gIHZhciBvID0gdGhpcy5vcHRzLFxuICAgIHdpbmRvd1dpZHRoID0gKHdpbmRvd09wdHMud2lkdGggKiAwLjYpIHx8IDEwMDAsXG4gICAgYnBwcCA9IE1hdGgucm91bmQoby5nZW5vbWVTaXplIC8gd2luZG93V2lkdGgpLFxuICAgIGxvd2VzdEJwcHAgPSB3aW5kb3dPcHRzLmxvd2VzdEJwcHAgfHwgMC4xLFxuICAgIG1heEJwcHBzID0gMTAwLFxuICAgIGJwcHBzID0gW10sIGkgPSAwLCBsb2c7XG4gIFxuICAvLyBjb21wYXJhYmxlIHRvIHBhcnQgb2YgVUNTQ0NsaWVudCNtYWtlX2NvbmZpZyBpbiBsaWIvdWNzY19zdGl0Y2gucmJcbiAgd2hpbGUgKGJwcHAgPj0gbG93ZXN0QnBwcCAmJiBpIDwgbWF4QnBwcHMpIHtcbiAgICBicHBwcy5wdXNoKGJwcHApO1xuICAgIGxvZyA9IHJvdW5kVG9QbGFjZXMobG9nMTAoYnBwcCksIDQpO1xuICAgIGJwcHAgPSAoTWF0aC5jZWlsKGxvZykgLSBsb2cgPCAwLjQ4MSkgPyAzLjMgKiBNYXRoLnBvdygxMCwgTWF0aC5jZWlsKGxvZykgLSAxKSA6IE1hdGgucG93KDEwLCBNYXRoLmZsb29yKGxvZykpO1xuICAgIGkrKztcbiAgfVxuICBvLmJwcHBzID0gYnBwcHM7XG4gIG8uYnBwcE51bWJlcnNCZWxvdyA9IGJwcHBzLnNsaWNlKDAsIDIpO1xuICBvLmluaXRab29tID0gYnBwcHNbMF07XG59O1xuXG4vLyBDb25zdHJ1Y3QgYSBjb21wbGV0ZSBjb25maWd1cmF0aW9uIGZvciAkLnVpLmdlbm9icm93c2VyIGJhc2VkIG9uIHRoZSBpbmZvcm1hdGlvbiBwYXJzZWQgZnJvbSB0aGUgZ2Vub21lIGZpbGVcbi8vIHdoaWNoIHNob3VsZCBiZSBtb3N0bHkgaW4gdGhpcy5vcHRzLCBleGNlcHRpbmcgdGhvc2UgcmVsYXRlZCB0byB6b29tIGxldmVscywgd2hpY2ggY2FuIGJlIHNldCBub3cuXG4vLyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBhYm92ZSBmb3Igd2hhdCBhIGJhc2UgY29uZmlndXJhdGlvbiBsb29rcyBsaWtlKVxuLy9cbi8vIHdpbmRvd09wdHMgTVVTVCBpbmNsdWRlIGluY2x1ZGUgdGhlIHByb3BlcnR5IC53aWR0aCB3aGljaCBpcyB0aGUgd2luZG93LmlubmVyV2lkdGhcbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUub3B0aW9ucyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgaWYgKCF0aGlzLl9wYXJzZWQpIHsgdGhyb3cgXCJDYW5ub3QgZ2VuZXJhdGUgb3B0aW9ucyBiZWZvcmUgcGFyc2luZyB0aGUgZ2Vub21lIGZpbGVcIjsgfVxuICB0aGlzLnNldEJwcHBzKHdpbmRvd09wdHMpO1xuICB0aGlzLm9wdHMuY3VzdG9tID0gdGhpczsgICAvLyBzYW1lIGNvbnZlbnRpb24gYXMgY3VzdG9tIHRyYWNrcyBpbiBzZWxmLmF2YWlsVHJhY2tzIGluIGNocm9tb3pvb20uanNcbiAgcmV0dXJuIHRoaXMub3B0cztcbn07XG5cbi8vIEZldGNoIHRoZSBzZXF1ZW5jZSwgaWYgYXZhaWxhYmxlLCBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0LCBhbmQgb3B0aW9uYWxseSBwYXNzIGl0IHRvIHRoZSBjYWxsYmFjay5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2UgPSBmdW5jdGlvbihsZWZ0LCByaWdodCwgY2FsbGJhY2spIHtcbiAgdmFyIHNlcSA9IHRoaXMuZGF0YS5zZXF1ZW5jZS5zdWJzdHJpbmcobGVmdCAtIDEsIHJpZ2h0IC0gMSk7XG4gIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soc2VxKSA6IHNlcTsgXG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMuYXN5bmModGhpcywgJ2dldFNlcXVlbmNlJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxucmV0dXJuIEN1c3RvbUdlbm9tZTtcblxufTsiLCJ2YXIgZ2xvYmFsID0gc2VsZjsgIC8vIGdyYWIgZ2xvYmFsIHNjb2xlIGZvciBXZWIgV29ya2Vyc1xucmVxdWlyZSgnLi9qcXVlcnkubm9kb20ubWluLmpzJykoZ2xvYmFsKTtcbmdsb2JhbC5fID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lcy5qcycpKGdsb2JhbCk7XG5cbmlmICghZ2xvYmFsLmNvbnNvbGUgfHwgIWdsb2JhbC5jb25zb2xlLmxvZykge1xuICBnbG9iYWwuY29uc29sZSA9IGdsb2JhbC5jb25zb2xlIHx8IHt9O1xuICBnbG9iYWwuY29uc29sZS5sb2cgPSBmdW5jdGlvbigpIHtcbiAgICBnbG9iYWwucG9zdE1lc3NhZ2Uoe2xvZzogSlNPTi5zdHJpbmdpZnkoXy50b0FycmF5KGFyZ3VtZW50cykpfSk7XG4gIH07XG59XG5cbnZhciBDdXN0b21HZW5vbWVXb3JrZXIgPSB7XG4gIF9nZW5vbWVzOiBbXSxcbiAgX3Rocm93RXJyb3JzOiBmYWxzZSxcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIG1ldGFkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lID0gQ3VzdG9tR2Vub21lcy5wYXJzZSh0ZXh0LCBtZXRhZGF0YSksXG4gICAgICBzZXJpYWxpemFibGU7XG4gICAgXG4gICAgLy8gd2Ugd2FudCB0byBrZWVwIHRoZSBnZW5vbWUgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgIC8vIGlzIHNlbnQgYmFjayBvdmVyIHRoZSBmZW5jZSwgc2luY2UgaXQgaXMgZXhwZW5zaXZlL2ltcG9zc2libGUgdG8gc2VyaWFsaXplXG4gICAgZ2Vub21lLmlkID0gc2VsZi5fZ2Vub21lcy5wdXNoKGdlbm9tZSkgLSAxO1xuICAgIFxuICAgIHNlcmlhbGl6YWJsZSA9IF8uZXh0ZW5kKHt9LCBnZW5vbWUpO1xuICAgIGRlbGV0ZSBzZXJpYWxpemFibGUuZGF0YTtcbiAgICByZXR1cm4gc2VyaWFsaXphYmxlO1xuICB9LFxuICBvcHRpb25zOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgZ2Vub21lID0gdGhpcy5fZ2Vub21lc1tpZF07XG4gICAgcmV0dXJuIGdlbm9tZS5vcHRpb25zLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgZ2V0U2VxdWVuY2U6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICBnZW5vbWUgPSB0aGlzLl9nZW5vbWVzW2lkXTtcbiAgICByZXR1cm4gZ2Vub21lLmdldFNlcXVlbmNlLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgdGhyb3dFcnJvcnM6IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgIHRoaXMuX3Rocm93RXJyb3JzID0gdG9nZ2xlO1xuICB9XG59O1xuXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGRhdGEgPSBlLmRhdGEsXG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbihyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIHJldDogSlNPTi5zdHJpbmdpZnkociB8fCBudWxsKX0pOyB9LFxuICAgIHJldDtcblxuICBpZiAoQ3VzdG9tR2Vub21lV29ya2VyLl90aHJvd0Vycm9ycykge1xuICAgIHJldCA9IEN1c3RvbUdlbm9tZVdvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21HZW5vbWVXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTtcbiAgfSBlbHNlIHtcbiAgICB0cnkgeyByZXQgPSBDdXN0b21HZW5vbWVXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tR2Vub21lV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3MpIHsgcmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpOyB9XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIGdlbm9tZSBvYmplY3RcbiAgdmFyIEN1c3RvbUdlbm9tZSA9IHJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lJykoZ2xvYmFsKTtcbiAgXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21HZW5vbWVzLCB0aGUgbW9kdWxlIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQgPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIEN1c3RvbUdlbm9tZSBvYmplY3RzIHRoYXQgY2FuIGRlbGVnYXRlIHRoZVxuICAvLyB3b3JrIG9mIHBhcnNpbmcgdG8gYSBXZWIgV29ya2VyIHRocmVhZC5cbiAgXG4gIHZhciBDdXN0b21HZW5vbWVzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbih0ZXh0LCBtZXRhZGF0YSkge1xuICAgICAgbWV0YWRhdGEgPSBtZXRhZGF0YSB8fCB7fTtcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7IG1ldGFkYXRhLmZvcm1hdCA9IHRoaXMuZ3Vlc3NGb3JtYXQodGV4dCk7IH1cbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKG1ldGFkYXRhLmZvcm1hdCwgbWV0YWRhdGEpO1xuICAgICAgZ2Vub21lLnBhcnNlKHRleHQpO1xuICAgICAgcmV0dXJuIGdlbm9tZTtcbiAgICB9LFxuICAgIFxuICAgIGJsYW5rOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKFwiY2hyb21zaXplc1wiLCB7c3BlY2llczogXCJCbGFuayBHZW5vbWVcIn0pO1xuICAgICAgZ2Vub21lLnBhcnNlKFwiYmxhbmtcXHQ1MDAwMFwiKTtcbiAgICAgIHJldHVybiBnZW5vbWU7XG4gICAgfSxcbiAgICBcbiAgICBndWVzc0Zvcm1hdDogZnVuY3Rpb24odGV4dCkge1xuICAgICAgaWYgKHRleHQuc3Vic3RyaW5nKDAsIDUpID09ICdMT0NVUycpIHsgcmV0dXJuIFwiZ2VuYmFua1wiOyB9XG4gICAgICBpZiAoL15bQS1aXXsyfSB7M30vLnRlc3QodGV4dCkpIHsgcmV0dXJuIFwiZW1ibFwiOyB9XG4gICAgICBpZiAoL15bPjtdLy50ZXN0KHRleHQpKSB7IHJldHVybiBcImZhc3RhXCI7IH1cbiAgICAgIC8vIGRlZmF1bHQgaXMgZmFzdGFcbiAgICAgIHJldHVybiBcImZhc3RhXCI7XG4gICAgfSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbUdlbm9tZVdvcmtlci5qcycsXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICB3b3JrZXI6IGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyLFxuICAgIFxuICAgIGFzeW5jOiBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jLFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbihnZW5vbWUpIHtcbiAgICAgICAgLy8gVGhpcyBoYXMgYmVlbiBzZXJpYWxpemVkLCBzbyBpdCBtdXN0IGJlIGh5ZHJhdGVkIGludG8gYSByZWFsIEN1c3RvbUdlbm9tZSBvYmplY3QuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLmdldFNlcXVlbmNlKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21HZW5vbWUoZmFsc2UpLCBnZW5vbWUsIHtcbiAgICAgICAgICBnZXRTZXF1ZW5jZTogZnVuY3Rpb24oKSB7IEN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2VBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuICBcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMgPSBDdXN0b21HZW5vbWVzO1xuICBcbn0pOyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbVRyYWNrLCBhbiBvYmplY3QgcmVwcmVzZW50aW5nIGEgY3VzdG9tIHRyYWNrIGFzIHVuZGVyc3Rvb2QgYnkgVUNTQy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBUaGlzIGNsYXNzICpkb2VzKiBkZXBlbmQgb24gZ2xvYmFsIG9iamVjdHMgYW5kIHRoZXJlZm9yZSBtdXN0IGJlIHJlcXVpcmVkIGFzIGEgXG4vLyBmdW5jdGlvbiB0aGF0IGlzIGV4ZWN1dGVkIG9uIHRoZSBnbG9iYWwgb2JqZWN0LlxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcDtcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbmZ1bmN0aW9uIEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKSB7XG4gIGlmICghb3B0cykgeyByZXR1cm47IH0gLy8gVGhpcyBpcyBhbiBlbXB0eSBjdXN0b21UcmFjayB0aGF0IHdpbGwgYmUgaHlkcmF0ZWQgd2l0aCB2YWx1ZXMgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0XG4gIHZhciB0eXBlV2l0aEFyZ3MgPSAob3B0cy50eXBlICYmIHN0cmlwKG9wdHMudHlwZS50b0xvd2VyQ2FzZSgpKS5zcGxpdCgvXFxzKy8pKSB8fCBbXCJiZWRcIl07XG4gIG9wdHMudHlwZSA9IHRoaXMuX3R5cGUgPSB0eXBlV2l0aEFyZ3NbMF07XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmICh0eXBlID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIHRyYWNrIHR5cGUgJ1wiK29wdHMudHlwZStcIicgZW5jb3VudGVyZWQgb24gbGluZSBcIiArIG9wdHMubGluZU51bSk7IH1cbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMsIHR5cGUuZGVmYXVsdHMgfHwge30sIG9wdHMpO1xuICBfLmV4dGVuZCh0aGlzLCB7XG4gICAgYnJvd3Nlck9wdHM6IGJyb3dzZXJPcHRzLFxuICAgIHR5cGVBcmdzOiB0eXBlV2l0aEFyZ3Muc2xpY2UoMSksXG4gICAgc3RyZXRjaEhlaWdodDogZmFsc2UsXG4gICAgaGVpZ2h0czoge30sXG4gICAgc2l6ZXM6IFsnZGVuc2UnXSxcbiAgICBtYXBTaXplczogW10sXG4gICAgYXJlYXM6IHt9LFxuICAgIHNjYWxlczoge30sXG4gICAgbm9BcmVhTGFiZWxzOiBmYWxzZSxcbiAgICBleHBlY3RzU2VxdWVuY2U6IGZhbHNlLFxuICAgIG9uU3luY1Byb3BzOiBudWxsXG4gIH0pO1xuICB0aGlzLmluaXQoKTtcbn1cblxuQ3VzdG9tVHJhY2suZGVmYXVsdHMgPSB7XG4gIG5hbWU6ICdVc2VyIFRyYWNrJyxcbiAgZGVzY3JpcHRpb246ICdVc2VyIFN1cHBsaWVkIFRyYWNrJyxcbiAgY29sb3I6ICcwLDAsMCdcbn07XG5cbkN1c3RvbVRyYWNrLnR5cGVzID0ge1xuICBiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkLmpzJyksXG4gIGZlYXR1cmV0YWJsZTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9mZWF0dXJldGFibGUuanMnKSxcbiAgYmVkZ3JhcGg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkZ3JhcGguanMnKSxcbiAgd2lnZ2xlXzA6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMnKSxcbiAgdmNmdGFiaXg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdmNmdGFiaXguanMnKSxcbiAgYmlnYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcycpLFxuICBiYW06IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmFtLmpzJyksXG4gIGJpZ3dpZzogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWd3aWcuanMnKVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkRGV0YWlsIGZvcm1hdDogaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEuNyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAgXG5cbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbCA9IF8uY2xvbmUoQ3VzdG9tVHJhY2sudHlwZXMuYmVkKTtcbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cyA9IF8uZXh0ZW5kKHt9LCBDdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMsIHtkZXRhaWw6IHRydWV9KTtcblxuLy8gVGhlc2UgZnVuY3Rpb25zIGJyYW5jaCB0byBkaWZmZXJlbnQgbWV0aG9kcyBkZXBlbmRpbmcgb24gdGhlIC50eXBlKCkgb2YgdGhlIHRyYWNrXG5fLmVhY2goWydpbml0JywgJ3BhcnNlJywgJ3JlbmRlcicsICdyZW5kZXJTZXF1ZW5jZScsICdwcmVyZW5kZXInXSwgZnVuY3Rpb24oZm4pIHtcbiAgQ3VzdG9tVHJhY2sucHJvdG90eXBlW2ZuXSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICB0eXBlID0gdGhpcy50eXBlKCk7XG4gICAgaWYgKCF0eXBlW2ZuXSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICByZXR1cm4gdHlwZVtmbl0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pO1xuXG4vLyBMb2FkcyBDdXN0b21UcmFjayBvcHRpb25zIGludG8gdGhlIHRyYWNrIG9wdGlvbnMgZGlhbG9nIFVJIHdoZW4gaXQgaXMgb3BlbmVkXG5DdXN0b21UcmFjay5wcm90b3R5cGUubG9hZE9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybScpLmhpZGUoKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybS4nK3RoaXMuX3R5cGUpLnNob3coKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW5hbWUnKS50ZXh0KG8ubmFtZSk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1kZXNjJykudGV4dChvLmRlc2NyaXB0aW9uKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWZvcm1hdCcpLnRleHQodGhpcy5fdHlwZSk7XG4gICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKG8uY29sb3IpLmNoYW5nZSgpO1xuICBpZiAodHlwZS5sb2FkT3B0cykgeyB0eXBlLmxvYWRPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgJGRpYWxvZy5maW5kKCcuZW5hYmxlcicpLmNoYW5nZSgpO1xufTtcblxuLy8gU2F2ZXMgb3B0aW9ucyBjaGFuZ2VkIGluIHRoZSB0cmFjayBvcHRpb25zIGRpYWxvZyBVSSBiYWNrIHRvIHRoZSBDdXN0b21UcmFjayBvYmplY3RcbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zYXZlT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICBvLmNvbG9yID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoKTtcbiAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5jb2xvcikpIHsgby5jb2xvciA9ICcwLDAsMCc7IH1cbiAgaWYgKHR5cGUuc2F2ZU9wdHMpIHsgdHlwZS5zYXZlT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gIHRoaXMuYXBwbHlPcHRzKCk7XG4gIGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkgJiYgdGhpcy5hcHBseU9wdHNBc3luYygpOyAvLyBBcHBseSB0aGUgY2hhbmdlcyB0byB0aGUgd29ya2VyIHRvbyFcbn07XG5cbi8vIFNvbWV0aW1lcyBuZXdseSBzZXQgb3B0aW9ucyAocHJvdmlkZWQgYXMgdGhlIGZpcnN0IGFyZykgbmVlZCB0byBiZSB0cmFuc2Zvcm1lZCBiZWZvcmUgdXNlIG9yIGhhdmUgc2lkZSBlZmZlY3RzLlxuLy8gVGhpcyBmdW5jdGlvbiBpcyBydW4gZm9yIG5ld2x5IHNldCBvcHRpb25zIGluIGJvdGggdGhlIERPTSBhbmQgV2ViIFdvcmtlciBzY29wZXMgKHNlZSBhcHBseU9wdHNBc3luYyBiZWxvdykuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzID0gZnVuY3Rpb24ob3B0cykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAob3B0cykgeyB0aGlzLm9wdHMgPSBvcHRzOyB9XG4gIGlmICh0eXBlLmFwcGx5T3B0cykgeyB0eXBlLmFwcGx5T3B0cy5jYWxsKHRoaXMpOyB9XG59O1xuXG4vLyBDb3BpZXMgdGhlIHByb3BlcnRpZXMgb2YgdGhlIEN1c3RvbVRyYWNrIChsaXN0ZWQgaW4gcHJvcHMpIGZyb20gdGhlIFdlYiBXb3JrZXIgc2lkZSB0byB0aGUgRE9NIHNpZGUuXG4vLyBUaGlzIGlzIHVzZWZ1bCBpZiB0aGUgV2ViIFdvcmtlciBjb21wdXRlcyBzb21ldGhpbmcgKGxpa2UgZHJhdyBib3VuZGFyaWVzKSB0aGF0IGJvdGggc2lkZXMgbmVlZCB0byBiZSBhd2FyZSBvZi5cbi8vIElmIGEgY2FsbGJhY2sgaXMgc2F2ZWQgaW4gdGhpcy5vblN5bmNQcm9wcywgdGhpcyB3aWxsIHJ1biB0aGUgY2FsbGJhY2sgYWZ0ZXJ3YXJkLlxuLy8gSWYgV2ViIFdvcmtlcnMgYXJlIGRpc2FibGVkLCB0aGlzIGlzIGVmZmVjdGl2ZWx5IGEgbm8tb3AsIGFsdGhvdWdoIHRoZSBjYWxsYmFjayBzdGlsbCBmaXJlcy5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zeW5jUHJvcHMgPSBmdW5jdGlvbihwcm9wcywgcmVjZWl2aW5nKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHJlY2VpdmluZyA9PT0gdHJ1ZSkge1xuICAgIGlmICghXy5pc09iamVjdChwcm9wcykgfHwgXy5pc0FycmF5KHByb3BzKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICBfLmV4dGVuZChzZWxmLCBwcm9wcyk7XG4gICAgaWYgKF8uaXNGdW5jdGlvbihzZWxmLm9uU3luY1Byb3BzKSAmJiBnbG9iYWwuSFRNTERvY3VtZW50KSB7IHNlbGYub25TeW5jUHJvcHMocHJvcHMpOyB9XG4gICAgcmV0dXJuIHNlbGY7XG4gIH0gZWxzZSB7ICAgIFxuICAgIGlmIChfLmlzQXJyYXkocHJvcHMpKSB7IHByb3BzID1fLm9iamVjdChwcm9wcywgXy5tYXAocHJvcHMsIGZ1bmN0aW9uKHApIHsgcmV0dXJuIHNlbGZbcF07IH0pKTsgfVxuICAgIC8vIFdoaWNoIHNpZGUgb2YgdGhlIGZlbmNlIGFyZSB3ZSBvbj8gIEhUTUxEb2N1bWVudCBpbXBsaWVzIHdlJ3JlICpub3QqIGluIHRoZSBXZWIgV29ya2VyIHNjb3BlLlxuICAgIGlmIChnbG9iYWwuSFRNTERvY3VtZW50KSB7XG4gICAgICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkpIHsgcmV0dXJuIHNlbGYuc3luY1Byb3BzKHByb3BzLCB0cnVlKTsgfVxuICAgIH0gZWxzZSBpZiAoZ2xvYmFsLkN1c3RvbVRyYWNrV29ya2VyKSB7XG4gICAgICBnbG9iYWwuQ3VzdG9tVHJhY2tXb3JrZXIuc3luY1Byb3BzQXN5bmMoc2VsZiwgcHJvcHMpO1xuICAgIH1cbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmVyYXNlID0gZnVuY3Rpb24oY2FudmFzKSB7XG4gIHZhciBzZWxmID0gdGhpcyxcbiAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgaWYgKGN0eCkgeyBjdHguY2xlYXJSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7IH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHR5cGUpKSB7IHR5cGUgPSB0aGlzLl90eXBlOyB9XG4gIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLnR5cGVzW3R5cGVdIHx8IG51bGw7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUud2FybiA9IGZ1bmN0aW9uKHdhcm5pbmcpIHtcbiAgaWYgKHRoaXMub3B0cy5zdHJpY3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3Iod2FybmluZyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCF0aGlzLndhcm5pbmdzKSB7IHRoaXMud2FybmluZ3MgPSBbXTsgfVxuICAgIHRoaXMud2FybmluZ3MucHVzaCh3YXJuaW5nKTtcbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmlzT24gPSBmdW5jdGlvbih2YWwpIHtcbiAgcmV0dXJuIC9eKG9ufHllc3x0cnVlfHR8eXwxKSQvaS50ZXN0KHZhbC50b1N0cmluZygpKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJMaXN0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fY2hyTGlzdCkge1xuICAgIHRoaXMuX2Nockxpc3QgPSBfLnNvcnRCeShfLm1hcCh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcywgZnVuY3Rpb24ocG9zLCBjaHIpIHsgcmV0dXJuIFtwb3MsIGNocl07IH0pLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KTtcbiAgfVxuICByZXR1cm4gdGhpcy5fY2hyTGlzdDtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockF0ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHZhciBjaHJMaXN0ID0gdGhpcy5jaHJMaXN0KCksXG4gICAgY2hySW5kZXggPSBfLnNvcnRlZEluZGV4KGNockxpc3QsIFtwb3NdLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KSxcbiAgICBjaHIgPSBjaHJJbmRleCA+IDAgPyBjaHJMaXN0W2NockluZGV4IC0gMV1bMV0gOiBudWxsO1xuICByZXR1cm4ge2k6IGNockluZGV4IC0gMSwgYzogY2hyLCBwOiBwb3MgLSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJdfTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJSYW5nZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGNockxlbmd0aHMgPSB0aGlzLmJyb3dzZXJPcHRzLmNockxlbmd0aHMsXG4gICAgc3RhcnRDaHIgPSB0aGlzLmNockF0KHN0YXJ0KSxcbiAgICBlbmRDaHIgPSB0aGlzLmNockF0KGVuZCksXG4gICAgcmFuZ2U7XG4gIGlmIChzdGFydENoci5jICYmIHN0YXJ0Q2hyLmkgPT09IGVuZENoci5pKSB7IHJldHVybiBbc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBlbmRDaHIucF07IH1cbiAgZWxzZSB7XG4gICAgcmFuZ2UgPSBfLm1hcCh0aGlzLmNockxpc3QoKS5zbGljZShzdGFydENoci5pICsgMSwgZW5kQ2hyLmkpLCBmdW5jdGlvbih2KSB7XG4gICAgICByZXR1cm4gdlsxXSArICc6MS0nICsgY2hyTGVuZ3Roc1t2WzFdXTtcbiAgICB9KTtcbiAgICBzdGFydENoci5jICYmIHJhbmdlLnVuc2hpZnQoc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBjaHJMZW5ndGhzW3N0YXJ0Q2hyLmNdKTtcbiAgICBlbmRDaHIuYyAmJiByYW5nZS5wdXNoKGVuZENoci5jICsgJzoxLScgKyBlbmRDaHIucCk7XG4gICAgcmV0dXJuIHJhbmdlO1xuICB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdwcmVyZW5kZXInLCBhcmd1bWVudHMsIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAnYXBwbHlPcHRzJywgW3RoaXMub3B0cywgZnVuY3Rpb24oKXt9XSwgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hamF4RGlyID0gZnVuY3Rpb24oKSB7XG4gIC8vIFdlYiBXb3JrZXJzIGZldGNoIFVSTHMgcmVsYXRpdmUgdG8gdGhlIEpTIGZpbGUgaXRzZWxmLlxuICByZXR1cm4gKGdsb2JhbC5IVE1MRG9jdW1lbnQgPyAnJyA6ICcuLi8nKSArIHRoaXMuYnJvd3Nlck9wdHMuYWpheERpcjtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5yZ2JUb0hzbCA9IGZ1bmN0aW9uKHIsIGcsIGIpIHtcbiAgciAvPSAyNTUsIGcgLz0gMjU1LCBiIC89IDI1NTtcbiAgdmFyIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpLCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgdmFyIGgsIHMsIGwgPSAobWF4ICsgbWluKSAvIDI7XG5cbiAgaWYgKG1heCA9PSBtaW4pIHtcbiAgICBoID0gcyA9IDA7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICB2YXIgZCA9IG1heCAtIG1pbjtcbiAgICBzID0gbCA+IDAuNSA/IGQgLyAoMiAtIG1heCAtIG1pbikgOiBkIC8gKG1heCArIG1pbik7XG4gICAgc3dpdGNoKG1heCl7XG4gICAgICBjYXNlIHI6IGggPSAoZyAtIGIpIC8gZCArIChnIDwgYiA/IDYgOiAwKTsgYnJlYWs7XG4gICAgICBjYXNlIGc6IGggPSAoYiAtIHIpIC8gZCArIDI7IGJyZWFrO1xuICAgICAgY2FzZSBiOiBoID0gKHIgLSBnKSAvIGQgKyA0OyBicmVhaztcbiAgICB9XG4gICAgaCAvPSA2O1xuICB9XG5cbiAgcmV0dXJuIFtoLCBzLCBsXTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmhzbFRvUmdiID0gZnVuY3Rpb24oaCwgcywgbCkge1xuICB2YXIgciwgZywgYjtcblxuICBpZiAocyA9PSAwKSB7XG4gICAgciA9IGcgPSBiID0gbDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIGZ1bmN0aW9uIGh1ZTJyZ2IocCwgcSwgdCkge1xuICAgICAgaWYodCA8IDApIHQgKz0gMTtcbiAgICAgIGlmKHQgPiAxKSB0IC09IDE7XG4gICAgICBpZih0IDwgMS82KSByZXR1cm4gcCArIChxIC0gcCkgKiA2ICogdDtcbiAgICAgIGlmKHQgPCAxLzIpIHJldHVybiBxO1xuICAgICAgaWYodCA8IDIvMykgcmV0dXJuIHAgKyAocSAtIHApICogKDIvMyAtIHQpICogNjtcbiAgICAgIHJldHVybiBwO1xuICAgIH1cblxuICAgIHZhciBxID0gbCA8IDAuNSA/IGwgKiAoMSArIHMpIDogbCArIHMgLSBsICogcztcbiAgICB2YXIgcCA9IDIgKiBsIC0gcTtcbiAgICByID0gaHVlMnJnYihwLCBxLCBoICsgMS8zKTtcbiAgICBnID0gaHVlMnJnYihwLCBxLCBoKTtcbiAgICBiID0gaHVlMnJnYihwLCBxLCBoIC0gMS8zKTtcbiAgfVxuXG4gIHJldHVybiBbciAqIDI1NSwgZyAqIDI1NSwgYiAqIDI1NV07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS52YWxpZGF0ZUNvbG9yID0gZnVuY3Rpb24oY29sb3IpIHtcbiAgdmFyIG0gPSBjb2xvci5tYXRjaCgvKFxcZCspLChcXGQrKSwoXFxkKykvKTtcbiAgaWYgKCFtKSB7IHJldHVybiBmYWxzZTsgfVxuICBtLnNoaWZ0KCk7XG4gIHJldHVybiBfLmFsbChfLm1hcChtLCBwYXJzZUludDEwKSwgZnVuY3Rpb24odikgeyByZXR1cm4gdiA+PTAgJiYgdiA8PSAyNTU7IH0pO1xufVxuXG5yZXR1cm4gQ3VzdG9tVHJhY2s7XG5cbn07IiwibW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24oZ2xvYmFsKXtcbiAgXG4gIHZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbiAgXG4gIC8vIFNvbWUgdXRpbGl0eSBmdW5jdGlvbnMuXG4gIHZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xuICBcbiAgLy8gVGhlIGNsYXNzIHRoYXQgcmVwcmVzZW50cyBhIHNpbmd1bGFyIGN1c3RvbSB0cmFjayBvYmplY3RcbiAgdmFyIEN1c3RvbVRyYWNrID0gcmVxdWlyZSgnLi9DdXN0b21UcmFjay5qcycpKGdsb2JhbCk7XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vID0gQ3VzdG9tVHJhY2tzLCB0aGUgbW9kdWxlIHRoYXQgaXMgZXhwb3J0ZWQgdG8gdGhlIGdsb2JhbCBlbnZpcm9ubWVudC4gPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8gQnJvYWRseSBzcGVha2luZyB0aGlzIGlzIGEgZmFjdG9yeSBmb3IgcGFyc2luZyBkYXRhIGludG8gQ3VzdG9tVHJhY2sgb2JqZWN0cyxcbiAgLy8gYW5kIGl0IGNhbiBkZWxlZ2F0ZSB0aGlzIHdvcmsgdG8gYSB3b3JrZXIgdGhyZWFkLlxuXG4gIHZhciBDdXN0b21UcmFja3MgPSB7XG4gICAgX3RyYWNrczoge30sXG4gICAgXG4gICAgcGFyc2U6IGZ1bmN0aW9uKGNodW5rcywgYnJvd3Nlck9wdHMpIHtcbiAgICAgIHZhciBjdXN0b21UcmFja3MgPSBbXSxcbiAgICAgICAgZGF0YSA9IFtdLFxuICAgICAgICB0cmFjaywgb3B0cywgbTtcbiAgICAgIFxuICAgICAgaWYgKHR5cGVvZiBjaHVua3MgPT0gXCJzdHJpbmdcIikgeyBjaHVua3MgPSBbY2h1bmtzXTsgfVxuICAgICAgXG4gICAgICBmdW5jdGlvbiBwdXNoVHJhY2soKSB7XG4gICAgICAgIGlmICh0cmFjay5wYXJzZShkYXRhKSkgeyBjdXN0b21UcmFja3MucHVzaCh0cmFjayk7IH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgY3VzdG9tVHJhY2tzLmJyb3dzZXIgPSB7fTtcbiAgICAgIF8uZWFjaChjaHVua3MsIGZ1bmN0aW9uKHRleHQpIHtcbiAgICAgICAgXy5lYWNoKHRleHQuc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgICAgIGlmICgvXiMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIC8vIGNvbW1lbnQgbGluZVxuICAgICAgICAgIH0gZWxzZSBpZiAoL15icm93c2VyXFxzKy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gYnJvd3NlciBsaW5lc1xuICAgICAgICAgICAgbSA9IGxpbmUubWF0Y2goL15icm93c2VyXFxzKyhcXHcrKVxccysoXFxTKikvKTtcbiAgICAgICAgICAgIGlmICghbSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgYnJvd3NlciBsaW5lIGZvdW5kIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSkpOyB9XG4gICAgICAgICAgICBjdXN0b21UcmFja3MuYnJvd3NlclttWzFdXSA9IG1bMl07XG4gICAgICAgICAgfSBlbHNlIGlmICgvXnRyYWNrXFxzKy9pLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgICAgICAgb3B0cyA9IHBhcnNlRGVjbGFyYXRpb25MaW5lKGxpbmUsICgvXnRyYWNrXFxzKy9pKSk7XG4gICAgICAgICAgICBpZiAoIW9wdHMpIHsgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IHBhcnNlIHRyYWNrIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIG9wdHMubGluZU51bSA9IGxpbmVubyArIDE7XG4gICAgICAgICAgICB0cmFjayA9IG5ldyBDdXN0b21UcmFjayhvcHRzLCBicm93c2VyT3B0cyk7XG4gICAgICAgICAgICBkYXRhID0gW107XG4gICAgICAgICAgfSBlbHNlIGlmICgvXFxTLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICBpZiAoIXRyYWNrKSB7IHRocm93IG5ldyBFcnJvcihcIkZvdW5kIGRhdGEgb24gbGluZSBcIisobGluZW5vKzEpK1wiIGJ1dCBubyBwcmVjZWRpbmcgdHJhY2sgZGVmaW5pdGlvblwiKTsgfVxuICAgICAgICAgICAgZGF0YS5wdXNoKGxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGlmICh0cmFjaykgeyBwdXNoVHJhY2soKTsgfVxuICAgICAgcmV0dXJuIGN1c3RvbVRyYWNrcztcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lOiBwYXJzZURlY2xhcmF0aW9uTGluZSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIC8vIE5vdGU6IHRoaXMgaXMgb3ZlcnJpZGRlbiBieSB1aS5nZW5vYnJvd3NlciBkdXJpbmcgVUkgc2V0dXAuXG4gICAgICBjb25zb2xlLmxvZyhlKTtcbiAgICB9LFxuICAgIFxuICAgIF93b3JrZXJTY3JpcHQ6ICdidWlsZC9DdXN0b21UcmFja1dvcmtlci5qcycsXG4gICAgLy8gTk9URTogVG8gdGVtcG9yYXJpbHkgZGlzYWJsZSBXZWIgV29ya2VyIHVzYWdlLCBzZXQgdGhpcyB0byB0cnVlLlxuICAgIF9kaXNhYmxlV29ya2VyczogZmFsc2UsXG4gICAgXG4gICAgd29ya2VyOiBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGNhbGxiYWNrcyA9IFtdO1xuICAgICAgaWYgKCFzZWxmLl93b3JrZXIgJiYgZ2xvYmFsLldvcmtlcikgeyBcbiAgICAgICAgc2VsZi5fd29ya2VyID0gbmV3IGdsb2JhbC5Xb3JrZXIoc2VsZi5fd29ya2VyU2NyaXB0KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgZnVuY3Rpb24oZSkgeyBzZWxmLmVycm9yKGUpOyB9LCBmYWxzZSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICAgICAgICAgIGlmIChlLmRhdGEubG9nKSB7IGNvbnNvbGUubG9nKEpTT04ucGFyc2UoZS5kYXRhLmxvZykpOyByZXR1cm47IH1cbiAgICAgICAgICBpZiAoZS5kYXRhLmVycm9yKSB7XG4gICAgICAgICAgICBpZiAoZS5kYXRhLmlkKSB7IGRlbGV0ZSBjYWxsYmFja3NbZS5kYXRhLmlkXTsgfVxuICAgICAgICAgICAgc2VsZi5lcnJvcihKU09OLnBhcnNlKGUuZGF0YS5lcnJvcikpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZS5kYXRhLnN5bmNQcm9wcykge1xuICAgICAgICAgICAgc2VsZi5fdHJhY2tzW2UuZGF0YS5pZF0uc3luY1Byb3BzKGUuZGF0YS5zeW5jUHJvcHMsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYWxsYmFja3NbZS5kYXRhLmlkXShKU09OLnBhcnNlKGUuZGF0YS5yZXQpKTtcbiAgICAgICAgICBkZWxldGUgY2FsbGJhY2tzW2UuZGF0YS5pZF07XG4gICAgICAgIH0pO1xuICAgICAgICBzZWxmLl93b3JrZXIuY2FsbCA9IGZ1bmN0aW9uKG9wLCBhcmdzLCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciBpZCA9IGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAtIDE7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6IG9wLCBpZDogaWQsIGFyZ3M6IGFyZ3N9KTtcbiAgICAgICAgfTtcbiAgICAgICAgLy8gVG8gaGF2ZSB0aGUgd29ya2VyIHRocm93IGVycm9ycyBpbnN0ZWFkIG9mIHBhc3NpbmcgdGhlbSBuaWNlbHkgYmFjaywgY2FsbCB0aGlzIHdpdGggdG9nZ2xlPXRydWVcbiAgICAgICAgc2VsZi5fd29ya2VyLnRocm93RXJyb3JzID0gZnVuY3Rpb24odG9nZ2xlKSB7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6ICd0aHJvd0Vycm9ycycsIGFyZ3M6IFt0b2dnbGVdfSk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VsZi5fZGlzYWJsZVdvcmtlcnMgPyBudWxsIDogc2VsZi5fd29ya2VyO1xuICAgIH0sXG4gICAgXG4gICAgYXN5bmM6IGZ1bmN0aW9uKHNlbGYsIGZuLCBhcmdzLCBhc3luY0V4dHJhQXJncywgd3JhcHBlcikge1xuICAgICAgYXJncyA9IF8udG9BcnJheShhcmdzKTtcbiAgICAgIHdyYXBwZXIgPSB3cmFwcGVyIHx8IF8uaWRlbnRpdHk7XG4gICAgICB2YXIgYXJnc0V4Y2VwdExhc3RPbmUgPSBfLmluaXRpYWwoYXJncyksXG4gICAgICAgIGNhbGxiYWNrID0gXy5sYXN0KGFyZ3MpLFxuICAgICAgICB3ID0gdGhpcy53b3JrZXIoKTtcbiAgICAgIC8vIEZhbGxiYWNrIGlmIHdlYiB3b3JrZXJzIGFyZSBub3Qgc3VwcG9ydGVkLlxuICAgICAgLy8gVGhpcyBjb3VsZCBhbHNvIGJlIHR3ZWFrZWQgdG8gbm90IHVzZSB3ZWIgd29ya2VycyB3aGVuIHRoZXJlIHdvdWxkIGJlIG5vIHBlcmZvcm1hbmNlIGdhaW47XG4gICAgICAvLyAgIGFjdGl2YXRpbmcgdGhpcyBicmFuY2ggZGlzYWJsZXMgd2ViIHdvcmtlcnMgZW50aXJlbHkgYW5kIGV2ZXJ5dGhpbmcgaGFwcGVucyBzeW5jaHJvbm91c2x5LlxuICAgICAgaWYgKCF3KSB7IHJldHVybiBjYWxsYmFjayhzZWxmW2ZuXS5hcHBseShzZWxmLCBhcmdzRXhjZXB0TGFzdE9uZSkpOyB9XG4gICAgICBBcnJheS5wcm90b3R5cGUudW5zaGlmdC5hcHBseShhcmdzRXhjZXB0TGFzdE9uZSwgYXN5bmNFeHRyYUFyZ3MpO1xuICAgICAgdy5jYWxsKGZuLCBhcmdzRXhjZXB0TGFzdE9uZSwgZnVuY3Rpb24ocmV0KSB7IGNhbGxiYWNrKHdyYXBwZXIocmV0KSk7IH0pO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VBc3luYzogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICBzZWxmLmFzeW5jKHNlbGYsICdwYXJzZScsIGFyZ3VtZW50cywgW10sIGZ1bmN0aW9uKHRyYWNrcykge1xuICAgICAgICAvLyBUaGVzZSBoYXZlIGJlZW4gc2VyaWFsaXplZCwgc28gdGhleSBtdXN0IGJlIGh5ZHJhdGVkIGludG8gcmVhbCBDdXN0b21UcmFjayBvYmplY3RzLlxuICAgICAgICAvLyBXZSByZXBsYWNlIC5wcmVyZW5kZXIoKSB3aXRoIGFuIGFzeW5jaHJvbm91cyB2ZXJzaW9uLlxuICAgICAgICByZXR1cm4gXy5tYXAodHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgc2VsZi5fdHJhY2tzW3QuaWRdID0gXy5leHRlbmQobmV3IEN1c3RvbVRyYWNrKCksIHQsIHtcbiAgICAgICAgICAgIHByZXJlbmRlcjogZnVuY3Rpb24oKSB7IEN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIHNlbGYuX3RyYWNrc1t0LmlkXTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcyA9IEN1c3RvbVRyYWNrcztcblxufSk7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gY2hyb20uc2l6ZXMgZm9ybWF0OiBodHRwOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvY2hyb21TaXplcyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90ZTogd2UgYXJlIGV4dGVuZGluZyB0aGUgZ2VuZXJhbCB1c2Ugb2YgdGhpcyB0byBpbmNsdWRlIGRhdGEgbG9hZGVkIGZyb20gdGhlIGdlbm9tZS50eHQgYW5kIGFubm90cy54bWxcbi8vIGZpbGVzIG9mIGFuIElHQiBxdWlja2xvYWQgZGlyZWN0b3J5LFxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICBvcHRzQXNUcmFja0xpbmUgPSB1dGlscy5vcHRzQXNUcmFja0xpbmU7XG5cbnZhciBDaHJvbVNpemVzRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgby5zcGVjaWVzID0gbS5zcGVjaWVzIHx8ICdDdXN0b20gR2Vub21lJztcbiAgICBvLmFzc2VtYmx5RGF0ZSA9IG0uYXNzZW1ibHlEYXRlIHx8ICcnO1xuICAgIFxuICAgIC8vIFRPRE86IGlmIG1ldGFkYXRhIGFsc28gY29udGFpbnMgY3VzdG9tIHRyYWNrIGRhdGEsIGUuZy4gZnJvbSBhbm5vdHMueG1sXG4gICAgLy8gbXVzdCBjb252ZXJ0IHRoZW0gaW50byBpdGVtcyBmb3Igby5hdmFpbFRyYWNrcywgby50cmFja3MsIGFuZCBvLnRyYWNrRGVzY1xuICAgIC8vIFRoZSBvLmF2YWlsVHJhY2tzIGl0ZW1zIHNob3VsZCBjb250YWluIHtjdXN0b21EYXRhOiB0cmFja2xpbmVzfSB0byBiZSBwYXJzZWRcbiAgICBpZiAobS50cmFja3MpIHsgc2VsZi5mb3JtYXQoKS5jcmVhdGVUcmFja3MobS50cmFja3MpOyB9XG4gIH0sXG4gIFxuICBjcmVhdGVUcmFja3M6IGZ1bmN0aW9uKHRyYWNrcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgICBcbiAgICBfLmVhY2godHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICB2YXIgdHJhY2tPcHRzLCB2aXNpYmxlID0gdHJ1ZTtcbiAgICAgIHQubGluZXMgPSB0LmxpbmVzIHx8IFtdO1xuICAgICAgdHJhY2tPcHRzID0gL150cmFja1xccysvaS50ZXN0KHQubGluZXNbMF0pID8gZ2xvYmFsLkN1c3RvbVRyYWNrcy5wYXJzZURlY2xhcmF0aW9uTGluZSh0LmxpbmVzLnNoaWZ0KCkpIDoge307XG4gICAgICBfLmV4dGVuZCh0cmFja09wdHMsIHQub3B0cywge25hbWU6IHQubmFtZSwgdHlwZTogdC50eXBlfSk7XG4gICAgICBpZiAodHJhY2tPcHRzLnZpc2liaWxpdHkpIHtcbiAgICAgICAgaWYgKHRyYWNrT3B0cy52aXNpYmlsaXR5ID09ICdoaWRlJykgeyB2aXNpYmxlID0gZmFsc2U7IH1cbiAgICAgICAgZGVsZXRlIHRyYWNrT3B0cy52aXNpYmlsaXR5O1xuICAgICAgfVxuICAgICAgdC5saW5lcy51bnNoaWZ0KCd0cmFjayAnICsgb3B0c0FzVHJhY2tMaW5lKHRyYWNrT3B0cykgKyAnXFxuJyk7XG4gICAgICBvLmF2YWlsVHJhY2tzLnB1c2goe1xuICAgICAgICBmaDoge30sXG4gICAgICAgIG46IHQubmFtZSxcbiAgICAgICAgczogWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddLFxuICAgICAgICBoOiAxNSxcbiAgICAgICAgbTogWydwYWNrJ10sXG4gICAgICAgIGN1c3RvbURhdGE6IHQubGluZXNcbiAgICAgIH0pO1xuICAgICAgaWYgKHZpc2libGUpIHsgby50cmFja3MucHVzaCh7bjogdC5uYW1lfSk7IH1cbiAgICAgIG8udHJhY2tEZXNjW3QubmFtZV0gPSB7XG4gICAgICAgIGNhdDogXCJGZWF0dXJlIFRyYWNrc1wiLFxuICAgICAgICBzbTogdC5zaG9ydExhYmVsIHx8IHQubmFtZSxcbiAgICAgICAgbGc6IHQuZGVzY3JpcHRpb24gfHwgdC5uYW1lXG4gICAgICB9O1xuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgbGluZXMgPSB0ZXh0LnNwbGl0KFwiXFxuXCIpLFxuICAgICAgbyA9IHRoaXMub3B0cztcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGkpIHtcbiAgICAgIHZhciBjaHJzaXplID0gc3RyaXAobGluZSkuc3BsaXQoL1xccysvLCAyKSxcbiAgICAgICAgY2hyID0gY2hyc2l6ZVswXSxcbiAgICAgICAgc2l6ZSA9IHBhcnNlSW50MTAoY2hyc2l6ZVsxXSk7XG4gICAgICBpZiAoXy5pc05hTihzaXplKSkgeyByZXR1cm47IH1cbiAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSBzaXplO1xuICAgICAgby5nZW5vbWVTaXplICs9IHNpemU7XG4gICAgfSk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hyb21TaXplc0Zvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBGQVNUQSBmb3JtYXQ6IGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvRkFTVEFfZm9ybWF0ID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZW5zdXJlVW5pcXVlID0gdXRpbHMuZW5zdXJlVW5pcXVlO1xuXG52YXIgRmFzdGFGb3JtYXQgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG0gPSBzZWxmLm1ldGFkYXRhLFxuICAgICAgbyA9IHNlbGYub3B0cztcbiAgICAgIFxuICAgIHNlbGYuZGF0YSA9IHt9O1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgbGluZXMgPSB0ZXh0LnNwbGl0KFwiXFxuXCIpLFxuICAgICAgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY2hyID0gbnVsbCxcbiAgICAgIHVubmFtZWRDb3VudGVyID0gMSxcbiAgICAgIGNocnNlcSA9IFtdO1xuICAgICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gW107XG4gICAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBpKSB7XG4gICAgICB2YXIgY2hyTGluZSA9IGxpbmUubWF0Y2goL15bPjtdKC4rKS8pLFxuICAgICAgICBjbGVhbmVkTGluZSA9IGxpbmUucmVwbGFjZSgvXFxzKy9nLCAnJyk7XG4gICAgICBpZiAoY2hyTGluZSkge1xuICAgICAgICBjaHIgPSBjaHJMaW5lWzFdLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKTtcbiAgICAgICAgaWYgKCFjaHIubGVuZ3RoKSB7IGNociA9IFwidW5uYW1lZENoclwiOyB9XG4gICAgICAgIGNociA9IGVuc3VyZVVuaXF1ZShjaHIsIG8uY2hyTGVuZ3Rocyk7XG4gICAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5kYXRhLnNlcXVlbmNlLnB1c2goY2xlYW5lZExpbmUpO1xuICAgICAgICBvLmNockxlbmd0aHNbY2hyXSA9IChvLmNockxlbmd0aHNbY2hyXSB8fCAwKSArIGNsZWFuZWRMaW5lLmxlbmd0aDtcbiAgICAgICAgby5nZW5vbWVTaXplICs9IGNsZWFuZWRMaW5lLmxlbmd0aDtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBzZWxmLmRhdGEuc2VxdWVuY2Uuam9pbignJyk7XG4gICAgc2VsZi5jYW5HZXRTZXF1ZW5jZSA9IHRydWU7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmFzdGFGb3JtYXQ7IiwiXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEdlbkJhbmsgZm9ybWF0OiBodHRwOi8vd3d3Lm5jYmkubmxtLm5paC5nb3YvU2l0ZW1hcC9zYW1wbGVyZWNvcmQuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIHRvcFRhZ3NBc0FycmF5ID0gdXRpbHMudG9wVGFnc0FzQXJyYXksXG4gIHN1YlRhZ3NBc0FycmF5ID0gdXRpbHMuc3ViVGFnc0FzQXJyYXksXG4gIGZldGNoRmllbGQgPSB1dGlscy5mZXRjaEZpZWxkLFxuICBnZXRUYWcgPSB1dGlscy5nZXRUYWcsXG4gIGVuc3VyZVVuaXF1ZSA9IHV0aWxzLmVuc3VyZVVuaXF1ZTtcblxudmFyIEdlbkJhbmtGb3JtYXQgPSB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE5vdGUgdGhhdCB3ZSBjYWxsIEdlbkJhbmsgZmllbGQgbmFtZXMgbGlrZSBcIkxPQ1VTXCIsIFwiREVGSU5JVElPTlwiLCBldGMuIHRhZ3MgaW5zdGVhZCBvZiBrZXlzLlxuICAgIC8vIFdlIGRvIHRoaXMgYmVjYXVzZTogMSkgY2VydGFpbiBmaWVsZCBuYW1lcyBjYW4gYmUgcmVwZWF0ZWQgKGUuZy4gUkVGRVJFTkNFKSB3aGljaCBpcyBtb3JlIFxuICAgIC8vIGV2b2NhdGl2ZSBvZiBcInRhZ3NcIiBhcyBvcHBvc2VkIHRvIHRoZSBiZWhhdmlvciBvZiBrZXlzIGluIGEgaGFzaC4gIEFsc28sIDIpIHRoaXMgaXMgdGhlXG4gICAgLy8gbm9tZW5jbGF0dXJlIHBpY2tlZCBieSBCaW9SdWJ5LlxuICAgIFxuICAgIHRoaXMudGFnU2l6ZSA9IDEyOyAvLyBob3cgd2lkZSB0aGUgY29sdW1uIGZvciB0YWdzIGlzIGluIGEgR2VuQmFuayBmaWxlXG4gICAgdGhpcy5mZWF0dXJlVGFnU2l6ZSA9IDIxOyAvLyBob3cgd2lkZSB0aGUgY29sdW1uIGZvciB0YWdzIGlzIGluIHRoZSBmZWF0dXJlIHRhYmxlIHNlY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNlZSBzZWN0aW9uIDQuMSBvZiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWxcbiAgICBcbiAgICB0aGlzLmRhdGEgPSB7XG4gICAgICBjb250aWdzOiBbXSxcbiAgICAgIHRyYWNrTGluZXM6IHtcbiAgICAgICAgc291cmNlOiBbXSxcbiAgICAgICAgZ2VuZXM6IFtdLFxuICAgICAgICBvdGhlcjogW11cbiAgICAgIH1cbiAgICB9O1xuICB9LFxuICBcbiAgcGFyc2VMb2N1czogZnVuY3Rpb24oY29udGlnKSB7XG4gICAgdmFyIGxvY3VzTGluZSA9IGNvbnRpZy5vcmlnLmxvY3VzO1xuICAgIGlmIChsb2N1c0xpbmUpIHtcbiAgICAgIGlmIChsb2N1c0xpbmUubGVuZ3RoID4gNzUpIHsgLy8gYWZ0ZXIgUmVsIDEyNi4wXG4gICAgICAgIGNvbnRpZy5lbnRyeUlkICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMTIsIDI4KSk7XG4gICAgICAgIGNvbnRpZy5sZW5ndGggICA9IHBhcnNlSW50MTAobG9jdXNMaW5lLnN1YnN0cmluZygyOSwgNDApKTtcbiAgICAgICAgY29udGlnLnN0cmFuZCAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0NCwgNDcpKTtcbiAgICAgICAgY29udGlnLm5hdHlwZSAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0NywgNTMpKTtcbiAgICAgICAgY29udGlnLmNpcmN1bGFyID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg1NSwgNjMpKTtcbiAgICAgICAgY29udGlnLmRpdmlzaW9uID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2MywgNjcpKTtcbiAgICAgICAgY29udGlnLmRhdGUgICAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2OCwgNzkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpZy5lbnRyeUlkICA9IHN0cmlwKGxvY3VzTGluZS5zdWJzdHJpbmcoMTIsIDIyKSk7XG4gICAgICAgIGNvbnRpZy5sZW5ndGggICA9IHBhcnNlSW50MTAobG9jdXNMaW5lLnN1YnN0cmluZygyMiwgMzApKTtcbiAgICAgICAgY29udGlnLnN0cmFuZCAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygzMywgMzYpKTtcbiAgICAgICAgY29udGlnLm5hdHlwZSAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygzNiwgNDApKTtcbiAgICAgICAgY29udGlnLmNpcmN1bGFyID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg0MiwgNTIpKTtcbiAgICAgICAgY29udGlnLmRpdmlzaW9uID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg1MiwgNTUpKTtcbiAgICAgICAgY29udGlnLmRhdGUgICAgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZyg2MiwgNzMpKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZUhlYWRlckZpZWxkczogZnVuY3Rpb24oY29udGlnKSB7XG4gICAgdmFyIHRhZ1NpemUgPSB0aGlzLnRhZ1NpemUsXG4gICAgICBoZWFkZXJGaWVsZHNUb1BhcnNlID0ge1xuICAgICAgICBzaW1wbGU6IFsnZGVmaW5pdGlvbicsICdhY2Nlc3Npb24nLCAndmVyc2lvbiddLFxuICAgICAgICBkZWVwOiBbJ3NvdXJjZSddIC8vIGNvdWxkIGFkZCByZWZlcmVuY2VzLCBidXQgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aG9zZSBoZXJlXG4gICAgICB9O1xuICAgIFxuICAgIC8vIFBhcnNlIHNpbXBsZSBmaWVsZHMgKHRhZyAtLT4gY29udGVudClcbiAgICBfLmVhY2goaGVhZGVyRmllbGRzVG9QYXJzZS5zaW1wbGUsIGZ1bmN0aW9uKHRhZykge1xuICAgICAgaWYgKCFjb250aWcub3JpZ1t0YWddKSB7IGNvbnRpZ1t0YWddID0gbnVsbDsgcmV0dXJuOyB9XG4gICAgICBjb250aWdbdGFnXSA9IGZldGNoRmllbGQoY29udGlnLm9yaWdbdGFnXSwgdGFnU2l6ZSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gUGFyc2UgdGFncyB0aGF0IGNhbiByZXBlYXQgYW5kIGhhdmUgc3VidGFnc1xuICAgIF8uZWFjaChoZWFkZXJGaWVsZHNUb1BhcnNlLmRlZXAsIGZ1bmN0aW9uKHRhZykge1xuICAgICAgdmFyIGRhdGEgPSBbXSxcbiAgICAgICAgaXRlbXM7XG4gICAgICBpZiAoIWNvbnRpZy5vcmlnW3RhZ10pIHsgY29udGlnW3RhZ10gPSBudWxsOyByZXR1cm47IH1cbiAgICAgIFxuICAgICAgaXRlbXMgPSBjb250aWcub3JpZ1t0YWddLnJlcGxhY2UoL1xcbihbQS1aYS16XFwvXFwqXSkvZywgXCJcXG5cXDAwMSQxXCIpLnNwbGl0KFwiXFwwMDFcIik7XG4gICAgICBfLmVhY2goaXRlbXMsIGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YlRhZ3MgPSBzdWJUYWdzQXNBcnJheShpdGVtLCB0YWdTaXplKSxcbiAgICAgICAgICBpdGVtTmFtZSA9IGZldGNoRmllbGQoc3ViVGFncy5zaGlmdCgpLCB0YWdTaXplKSwgXG4gICAgICAgICAgaXRlbURhdGEgPSB7X25hbWU6IGl0ZW1OYW1lfTtcbiAgICAgICAgXy5lYWNoKHN1YlRhZ3MsIGZ1bmN0aW9uKHN1YlRhZ0ZpZWxkKSB7XG4gICAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhzdWJUYWdGaWVsZCwgdGFnU2l6ZSk7XG4gICAgICAgICAgaXRlbURhdGFbdGFnXSA9IGZldGNoRmllbGQoc3ViVGFnRmllbGQsIHRhZ1NpemUpO1xuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5wdXNoKGl0ZW1EYXRhKTtcbiAgICAgIH0pO1xuICAgICAgY29udGlnW3RhZ10gPSBkYXRhO1xuICAgICAgXG4gICAgfSk7XG4gIH0sXG4gIFxuICBwYXJzZUZlYXR1cmVUYWJsZTogZnVuY3Rpb24oY2hyLCBjb250aWdEYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgdGFnU2l6ZSA9IHNlbGYudGFnU2l6ZSxcbiAgICAgIGZlYXR1cmVUYWdTaXplID0gc2VsZi5mZWF0dXJlVGFnU2l6ZSxcbiAgICAgIHRhZ3NUb1NraXAgPSBbXCJmZWF0dXJlc1wiXSxcbiAgICAgIHRhZ3NSZWxhdGVkVG9HZW5lcyA9IFtcImNkc1wiLCBcImdlbmVcIiwgXCJtcm5hXCIsIFwiZXhvblwiLCBcImludHJvblwiXSxcbiAgICAgIGNvbnRpZ0xpbmUgPSBcIkFDQ0VTU0lPTiAgIFwiICsgY2hyICsgXCJcXG5cIjtcbiAgICBpZiAoY29udGlnRGF0YS5vcmlnLmZlYXR1cmVzKSB7XG4gICAgICB2YXIgc3ViVGFncyA9IHN1YlRhZ3NBc0FycmF5KGNvbnRpZ0RhdGEub3JpZy5mZWF0dXJlcywgdGFnU2l6ZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5zb3VyY2UucHVzaChjb250aWdMaW5lKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLmdlbmVzLnB1c2goY29udGlnTGluZSk7XG4gICAgICBzZWxmLmRhdGEudHJhY2tMaW5lcy5vdGhlci5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgXy5lYWNoKHN1YlRhZ3MsIGZ1bmN0aW9uKHN1YlRhZ0ZpZWxkKSB7XG4gICAgICAgIHZhciB0YWcgPSBnZXRUYWcoc3ViVGFnRmllbGQsIGZlYXR1cmVUYWdTaXplKTtcbiAgICAgICAgaWYgKHRhZ3NUb1NraXAuaW5kZXhPZih0YWcpICE9PSAtMSkgeyByZXR1cm47IH1cbiAgICAgICAgZWxzZSBpZiAodGFnID09PSBcInNvdXJjZVwiKSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLnNvdXJjZS5wdXNoKHN1YlRhZ0ZpZWxkKTsgfVxuICAgICAgICBlbHNlIGlmICh0YWdzUmVsYXRlZFRvR2VuZXMuaW5kZXhPZih0YWcpICE9PSAtMSkgeyBzZWxmLmRhdGEudHJhY2tMaW5lcy5nZW5lcy5wdXNoKHN1YlRhZ0ZpZWxkKTsgIH1cbiAgICAgICAgZWxzZSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLm90aGVyLnB1c2goc3ViVGFnRmllbGQpOyB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZVNlcXVlbmNlOiBmdW5jdGlvbihjb250aWdEYXRhKSB7XG4gICAgaWYgKGNvbnRpZ0RhdGEub3JpZy5vcmlnaW4pIHtcbiAgICAgIHJldHVybiBjb250aWdEYXRhLm9yaWcub3JpZ2luLnJlcGxhY2UoL15vcmlnaW4uKnxcXG5bIDAtOV17MTB9fCAvaWcsICcnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIEFycmF5KGNvbnRpZ0RhdGEubGVuZ3RoKS5qb2luKCduJyk7XG4gICAgfVxuICB9LFxuICBcbiAgY3JlYXRlVHJhY2tzRnJvbUZlYXR1cmVzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY2F0ZWdvcnlUdXBsZXMgPSBbXG4gICAgICAgIFtcInNvdXJjZVwiLCBcIlNvdXJjZXNcIiwgXCJSZWdpb25zIGFubm90YXRlZCBieSBzb3VyY2Ugb3JnYW5pc20gb3Igc3BlY2ltZW5cIl0sIFxuICAgICAgICBbXCJnZW5lc1wiLCBcIkdlbmUgYW5ub3RhdGlvbnNcIiwgXCJDRFMgYW5kIGdlbmUgZmVhdHVyZXNcIl0sIFxuICAgICAgICBbXCJvdGhlclwiLCBcIk90aGVyIGFubm90YXRpb25zXCIsIFwidFJOQXMgYW5kIG90aGVyIGZlYXR1cmVzXCJdXG4gICAgICBdO1xuICAgIFxuICAgIC8vIEZvciB0aGUgY2F0ZWdvcmllcyBvZiBmZWF0dXJlcywgY3JlYXRlIGFwcHJvcHJpYXRlIGVudHJpZXMgaW4gby5hdmFpbFRyYWNrcywgby50cmFja3MsIGFuZCBvLnRyYWNrRGVzY1xuICAgIC8vIExlYXZlIHRoZSBhY3R1YWwgZGF0YSBhcyBhcnJheXMgb2YgbGluZXMgdGhhdCBhcmUgYXR0YWNoZWQgYXMgLmN1c3RvbURhdGEgdG8gby5hdmFpbFRyYWNrc1xuICAgIC8vIFRoZXkgd2lsbCBiZSBwYXJzZWQgbGF0ZXIgdmlhIEN1c3RvbVRyYWNrcy5wYXJzZS5cbiAgICBfLmVhY2goY2F0ZWdvcnlUdXBsZXMsIGZ1bmN0aW9uKGNhdGVnb3J5VHVwbGUpIHtcbiAgICAgIHZhciBjYXRlZ29yeSA9IGNhdGVnb3J5VHVwbGVbMF0sXG4gICAgICAgIGxhYmVsID0gY2F0ZWdvcnlUdXBsZVsxXSxcbiAgICAgICAgbG9uZ0xhYmVsID0gY2F0ZWdvcnlUdXBsZVsyXSxcbiAgICAgICAgdHJhY2tMaW5lcyA9IFtdO1xuICAgICAgaWYgKHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XS51bnNoaWZ0KCd0cmFjayB0eXBlPVwiZmVhdHVyZVRhYmxlXCIgbmFtZT1cIicgKyBsYWJlbCArIFxuICAgICAgICAgICdcIiBjb2xsYXBzZUJ5R2VuZT1cIicgKyAoY2F0ZWdvcnk9PVwiZ2VuZXNcIiA/ICdvbicgOiAnb2ZmJykgKyAnXCJcXG4nKTtcbiAgICAgIH1cbiAgICAgIG8uYXZhaWxUcmFja3MucHVzaCh7XG4gICAgICAgIGZoOiB7fSxcbiAgICAgICAgbjogY2F0ZWdvcnksXG4gICAgICAgIHM6IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXSxcbiAgICAgICAgaDogMTUsXG4gICAgICAgIG06IFsncGFjayddLFxuICAgICAgICBjdXN0b21EYXRhOiBzZWxmLmRhdGEudHJhY2tMaW5lc1tjYXRlZ29yeV1cbiAgICAgIH0pO1xuICAgICAgby50cmFja3MucHVzaCh7bjogY2F0ZWdvcnl9KTtcbiAgICAgIG8udHJhY2tEZXNjW2NhdGVnb3J5XSA9IHtcbiAgICAgICAgY2F0OiBcIkZlYXR1cmUgVHJhY2tzXCIsXG4gICAgICAgIHNtOiBsYWJlbCxcbiAgICAgICAgbGc6IGxvbmdMYWJlbFxuICAgICAgfTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNvbnRpZ0RlbGltaXRlciA9IFwiXFxuLy9cXG5cIixcbiAgICAgIGNvbnRpZ3MgPSB0ZXh0LnNwbGl0KGNvbnRpZ0RlbGltaXRlciksXG4gICAgICBmaXJzdENvbnRpZyA9IG51bGw7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gW107XG4gICAgICBcbiAgICBfLmVhY2goY29udGlncywgZnVuY3Rpb24oY29udGlnKSB7XG4gICAgICBpZiAoIXN0cmlwKGNvbnRpZykubGVuZ3RoKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICB2YXIgY29udGlnRGF0YSA9IHtvcmlnOiB7fX0sXG4gICAgICAgIGNociwgc2l6ZSwgY29udGlnU2VxdWVuY2U7XG4gICAgICBcbiAgICAgIC8vIFNwbGl0cyBvbiBhbnkgbGluZXMgd2l0aCBhIGNoYXJhY3RlciBpbiB0aGUgZmlyc3QgY29sdW1uXG4gICAgICBfLmVhY2godG9wVGFnc0FzQXJyYXkoY29udGlnKSwgZnVuY3Rpb24oZmllbGQpIHtcbiAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhmaWVsZCwgc2VsZi50YWdTaXplKTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY29udGlnRGF0YS5vcmlnW3RhZ10pKSB7IGNvbnRpZ0RhdGEub3JpZ1t0YWddID0gZmllbGQ7IH1cbiAgICAgICAgZWxzZSB7IGNvbnRpZ0RhdGEub3JpZ1t0YWddICs9IGZpZWxkOyB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgc2VsZi5kYXRhLmNvbnRpZ3MucHVzaChjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VMb2N1cyhjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VIZWFkZXJGaWVsZHMoY29udGlnRGF0YSk7XG4gICAgICBjb250aWdTZXF1ZW5jZSA9IHNlbGYuZm9ybWF0KCkucGFyc2VTZXF1ZW5jZShjb250aWdEYXRhKTtcbiAgICAgIFxuICAgICAgY2hyID0gY29udGlnRGF0YS5hY2Nlc3Npb24gJiYgY29udGlnRGF0YS5hY2Nlc3Npb24gIT0gJ3Vua25vd24nID8gY29udGlnRGF0YS5hY2Nlc3Npb24gOiBjb250aWdEYXRhLmVudHJ5SWQ7XG4gICAgICBjaHIgPSBlbnN1cmVVbmlxdWUoY2hyLCBvLmNockxlbmd0aHMpO1xuICAgICAgXG4gICAgICBpZiAoY29udGlnRGF0YS5sZW5ndGgpIHtcbiAgICAgICAgc2l6ZSA9IGNvbnRpZ0RhdGEubGVuZ3RoO1xuICAgICAgICBpZiAoc2l6ZSAhPSBjb250aWdTZXF1ZW5jZS5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTZXF1ZW5jZSBkYXRhIGZvciBjb250aWcgXCIrY2hyK1wiIGRvZXMgbm90IG1hdGNoIGxlbmd0aCBcIitzaXplK1wiYnAgZnJvbSBoZWFkZXJcIik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNpemUgPSBjb250aWdTZXF1ZW5jZS5sZW5ndGg7XG4gICAgICB9XG4gICAgICBcbiAgICAgIG8uY2hyT3JkZXIucHVzaChjaHIpO1xuICAgICAgby5jaHJMZW5ndGhzW2Nocl0gPSBzaXplO1xuICAgICAgby5nZW5vbWVTaXplICs9IHNpemU7XG4gICAgICBcbiAgICAgIHNlbGYuZm9ybWF0KCkucGFyc2VGZWF0dXJlVGFibGUoY2hyLCBjb250aWdEYXRhKTtcbiAgICAgIHNlbGYuZGF0YS5zZXF1ZW5jZS5wdXNoKGNvbnRpZ1NlcXVlbmNlKTtcbiAgICAgIFxuICAgICAgZmlyc3RDb250aWcgPSBmaXJzdENvbnRpZyB8fCBjb250aWdEYXRhO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IHNlbGYuZGF0YS5zZXF1ZW5jZS5qb2luKCcnKTtcbiAgICBzZWxmLmNhbkdldFNlcXVlbmNlID0gdHJ1ZTtcbiAgICBzZWxmLmZvcm1hdCgpLmNyZWF0ZVRyYWNrc0Zyb21GZWF0dXJlcygpO1xuICAgIFxuICAgIG8uc3BlY2llcyA9IGZpcnN0Q29udGlnLnNvdXJjZSA/IGZpcnN0Q29udGlnLnNvdXJjZVswXS5vcmdhbmlzbS5zcGxpdChcIlxcblwiKVswXSA6ICdDdXN0b20gR2Vub21lJztcbiAgICBpZiAoZmlyc3RDb250aWcuZGF0ZSkgeyBvLmFzc2VtYmx5RGF0ZSA9IGZpcnN0Q29udGlnLmRhdGU7IH1cbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gR2VuQmFua0Zvcm1hdDsiLCJ2YXIgdHJhY2tVdGlscyA9IHJlcXVpcmUoJy4uLy4uL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyk7XG5cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSB0cmFja1V0aWxzLnBhcnNlSW50MTA7XG5cbm1vZHVsZS5leHBvcnRzLmRlZXBDbG9uZSA9IGZ1bmN0aW9uKG9iaikgeyByZXR1cm4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvYmopKTsgfVxuXG5tb2R1bGUuZXhwb3J0cy5sb2cxMCA9IGZ1bmN0aW9uKHZhbCkgeyByZXR1cm4gTWF0aC5sb2codmFsKSAvIE1hdGguTE4xMDsgfVxuXG52YXIgc3RyaXAgPSBtb2R1bGUuZXhwb3J0cy5zdHJpcCA9IHRyYWNrVXRpbHMuc3RyaXA7XG5cbm1vZHVsZS5leHBvcnRzLnJvdW5kVG9QbGFjZXMgPSBmdW5jdGlvbihudW0sIGRlYykgeyByZXR1cm4gTWF0aC5yb3VuZChudW0gKiBNYXRoLnBvdygxMCwgZGVjKSkgLyBNYXRoLnBvdygxMCwgZGVjKTsgfVxuXG4vKioqKlxuICogVGhlc2UgZnVuY3Rpb25zIGFyZSBjb21tb24gc3Vicm91dGluZXMgZm9yIHBhcnNpbmcgR2VuQmFuayBhbmQgb3RoZXIgZm9ybWF0cyBiYXNlZCBvbiBjb2x1bW4gcG9zaXRpb25zXG4gKioqKi9cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBpbiB0aGUgZmlyc3QgY29sdW1uXG4vLyAoYSBcInRvcCB0YWdcIikgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMudG9wVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCkge1xuICByZXR1cm4gZmllbGQucmVwbGFjZSgvXFxuKFtBLVphLXpcXC9cXCpdKS9nLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbn1cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBub3QgaW4gdGhlIGZpcnN0IGNvbHVtblxuLy8gYnV0IHdpdGhpbiB0aGUgbmV4dCB0YWdTaXplIGNvbHVtbnMsIHdoaWNoIGlzIGEgXCJzdWIgdGFnXCIgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMuc3ViVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkge1xuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAyKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgdmFyIHJlID0gbmV3IFJlZ0V4cChcIlxcXFxuKFxcXFxzezEsXCIgKyAodGFnU2l6ZSAtIDEpICsgXCJ9XFxcXFMpXCIsIFwiZ1wiKTtcbiAgcmV0dXJuIGZpZWxkLnJlcGxhY2UocmUsIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xufVxuXG4vLyBSZXR1cm5zIGEgbmV3IHN0cmluZyB3aXRoIHRoZSBmaXJzdCB0YWdTaXplIGNvbHVtbnMgZnJvbSBmaWVsZCByZW1vdmVkXG5tb2R1bGUuZXhwb3J0cy5mZXRjaEZpZWxkID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHtcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMSkgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHZhciByZSA9IG5ldyBSZWdFeHAoXCIoXnxcXFxcbikuezAsXCIgKyB0YWdTaXplICsgXCJ9XCIsIFwiZ1wiKTtcbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnJlcGxhY2UocmUsIFwiJDFcIikpO1xufVxuXG4vLyBHZXRzIGEgdGFnIGZyb20gYSBmaWVsZCBieSB0cmltbWluZyBpdCBvdXQgb2YgdGhlIGZpcnN0IHRhZ1NpemUgY2hhcmFjdGVycyBvZiB0aGUgZmllbGRcbm1vZHVsZS5leHBvcnRzLmdldFRhZyA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7IFxuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAxKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnN1YnN0cmluZygwLCB0YWdTaXplKS50b0xvd2VyQ2FzZSgpKTtcbn1cblxuLyoqKipcbiAqIEVuZCBHZW5CYW5rIGFuZCBjb2x1bW4tYmFzZWQgZm9ybWF0IGhlbHBlcnNcbiAqKioqL1xuXG4vLyBHaXZlbiBhIGhhc2ggYW5kIGEgcHJlc3VtcHRpdmUgbmV3IGtleSwgYXBwZW5kcyBhIGNvdW50ZXIgdG8gdGhlIGtleSB1bnRpbCBpdCBpcyBhY3R1YWxseSBhbiB1bnVzZWQga2V5XG5tb2R1bGUuZXhwb3J0cy5lbnN1cmVVbmlxdWUgPSBmdW5jdGlvbihrZXksIGhhc2gpIHtcbiAgdmFyIGkgPSAxLCBrZXlDaGVjayA9IGtleTtcbiAgd2hpbGUgKHR5cGVvZiBoYXNoW2tleUNoZWNrXSAhPSAndW5kZWZpbmVkJykgeyBrZXlDaGVjayA9IGtleSArICdfJyArIGkrKzsgfVxuICByZXR1cm4ga2V5Q2hlY2s7XG59XG5cbi8vIEdpdmVuIGEgaGFzaCB3aXRoIG9wdGlvbiBuYW1lcyBhbmQgdmFsdWVzLCBmb3JtYXRzIGl0IGluIEJFRCB0cmFjayBsaW5lIGZvcm1hdCAoc2ltaWxhciB0byBIVE1MIGVsZW1lbnQgYXR0cmlidXRlcylcbm1vZHVsZS5leHBvcnRzLm9wdHNBc1RyYWNrTGluZSA9IGZ1bmN0aW9uKG9wdGhhc2gpIHtcbiAgcmV0dXJuIF8ubWFwKG9wdGhhc2gsIGZ1bmN0aW9uKHYsIGspIHsgcmV0dXJuIGsgKyAnPVwiJyArIHYudG9TdHJpbmcoKS5yZXBsYWNlKC9cIi9nLCAnJykgKyAnXCInOyB9KS5qb2luKCcgJyk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpe2dsb2JhbC53aW5kb3c9Z2xvYmFsLndpbmRvd3x8Z2xvYmFsO2dsb2JhbC53aW5kb3cuZG9jdW1lbnQ9Z2xvYmFsLndpbmRvdy5kb2N1bWVudHx8e307KGZ1bmN0aW9uKGEsYil7ZnVuY3Rpb24gTigpe3RyeXtyZXR1cm4gbmV3IGEuQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxIVFRQXCIpfWNhdGNoKGIpe319ZnVuY3Rpb24gTSgpe3RyeXtyZXR1cm4gbmV3IGEuWE1MSHR0cFJlcXVlc3R9Y2F0Y2goYil7fX1mdW5jdGlvbiBJKGEsYyl7aWYoYS5kYXRhRmlsdGVyKXtjPWEuZGF0YUZpbHRlcihjLGEuZGF0YVR5cGUpfXZhciBkPWEuZGF0YVR5cGVzLGU9e30sZyxoLGk9ZC5sZW5ndGgsaixrPWRbMF0sbCxtLG4sbyxwO2ZvcihnPTE7ZzxpO2crKyl7aWYoZz09PTEpe2ZvcihoIGluIGEuY29udmVydGVycyl7aWYodHlwZW9mIGg9PT1cInN0cmluZ1wiKXtlW2gudG9Mb3dlckNhc2UoKV09YS5jb252ZXJ0ZXJzW2hdfX19bD1rO2s9ZFtnXTtpZihrPT09XCIqXCIpe2s9bH1lbHNlIGlmKGwhPT1cIipcIiYmbCE9PWspe209bCtcIiBcIitrO249ZVttXXx8ZVtcIiogXCIra107aWYoIW4pe3A9Yjtmb3IobyBpbiBlKXtqPW8uc3BsaXQoXCIgXCIpO2lmKGpbMF09PT1sfHxqWzBdPT09XCIqXCIpe3A9ZVtqWzFdK1wiIFwiK2tdO2lmKHApe289ZVtvXTtpZihvPT09dHJ1ZSl7bj1wfWVsc2UgaWYocD09PXRydWUpe249b31icmVha319fX1pZighKG58fHApKXtmLmVycm9yKFwiTm8gY29udmVyc2lvbiBmcm9tIFwiK20ucmVwbGFjZShcIiBcIixcIiB0byBcIikpfWlmKG4hPT10cnVlKXtjPW4/bihjKTpwKG8oYykpfX19cmV0dXJuIGN9ZnVuY3Rpb24gSChhLGMsZCl7dmFyIGU9YS5jb250ZW50cyxmPWEuZGF0YVR5cGVzLGc9YS5yZXNwb25zZUZpZWxkcyxoLGksaixrO2ZvcihpIGluIGcpe2lmKGkgaW4gZCl7Y1tnW2ldXT1kW2ldfX13aGlsZShmWzBdPT09XCIqXCIpe2Yuc2hpZnQoKTtpZihoPT09Yil7aD1hLm1pbWVUeXBlfHxjLmdldFJlc3BvbnNlSGVhZGVyKFwiY29udGVudC10eXBlXCIpfX1pZihoKXtmb3IoaSBpbiBlKXtpZihlW2ldJiZlW2ldLnRlc3QoaCkpe2YudW5zaGlmdChpKTticmVha319fWlmKGZbMF1pbiBkKXtqPWZbMF19ZWxzZXtmb3IoaSBpbiBkKXtpZighZlswXXx8YS5jb252ZXJ0ZXJzW2krXCIgXCIrZlswXV0pe2o9aTticmVha31pZighayl7az1pfX1qPWp8fGt9aWYoail7aWYoaiE9PWZbMF0pe2YudW5zaGlmdChqKX1yZXR1cm4gZFtqXX19ZnVuY3Rpb24gRyhhLGIsYyxkKXtpZihmLmlzQXJyYXkoYikpe2YuZWFjaChiLGZ1bmN0aW9uKGIsZSl7aWYoY3x8ai50ZXN0KGEpKXtkKGEsZSl9ZWxzZXtHKGErXCJbXCIrKHR5cGVvZiBlPT09XCJvYmplY3RcInx8Zi5pc0FycmF5KGUpP2I6XCJcIikrXCJdXCIsZSxjLGQpfX0pfWVsc2UgaWYoIWMmJmIhPW51bGwmJnR5cGVvZiBiPT09XCJvYmplY3RcIil7Zm9yKHZhciBlIGluIGIpe0coYStcIltcIitlK1wiXVwiLGJbZV0sYyxkKX19ZWxzZXtkKGEsYil9fWZ1bmN0aW9uIEYoYSxjKXt2YXIgZCxlLGc9Zi5hamF4U2V0dGluZ3MuZmxhdE9wdGlvbnN8fHt9O2ZvcihkIGluIGMpe2lmKGNbZF0hPT1iKXsoZ1tkXT9hOmV8fChlPXt9KSlbZF09Y1tkXX19aWYoZSl7Zi5leHRlbmQodHJ1ZSxhLGUpfX1mdW5jdGlvbiBFKGEsYyxkLGUsZixnKXtmPWZ8fGMuZGF0YVR5cGVzWzBdO2c9Z3x8e307Z1tmXT10cnVlO3ZhciBoPWFbZl0saT0wLGo9aD9oLmxlbmd0aDowLGs9YT09PXksbDtmb3IoO2k8aiYmKGt8fCFsKTtpKyspe2w9aFtpXShjLGQsZSk7aWYodHlwZW9mIGw9PT1cInN0cmluZ1wiKXtpZigha3x8Z1tsXSl7bD1ifWVsc2V7Yy5kYXRhVHlwZXMudW5zaGlmdChsKTtsPUUoYSxjLGQsZSxsLGcpfX19aWYoKGt8fCFsKSYmIWdbXCIqXCJdKXtsPUUoYSxjLGQsZSxcIipcIixnKX1yZXR1cm4gbH1mdW5jdGlvbiBEKGEpe3JldHVybiBmdW5jdGlvbihiLGMpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcIil7Yz1iO2I9XCIqXCJ9aWYoZi5pc0Z1bmN0aW9uKGMpKXt2YXIgZD1iLnRvTG93ZXJDYXNlKCkuc3BsaXQodSksZT0wLGc9ZC5sZW5ndGgsaCxpLGo7Zm9yKDtlPGc7ZSsrKXtoPWRbZV07aj0vXlxcKy8udGVzdChoKTtpZihqKXtoPWguc3Vic3RyKDEpfHxcIipcIn1pPWFbaF09YVtoXXx8W107aVtqP1widW5zaGlmdFwiOlwicHVzaFwiXShjKX19fX12YXIgYz1hLmRvY3VtZW50LGQ9YS5uYXZpZ2F0b3IsZT1hLmxvY2F0aW9uO3ZhciBmPWZ1bmN0aW9uKCl7ZnVuY3Rpb24gSigpe2lmKGUuaXNSZWFkeSl7cmV0dXJufXRyeXtjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbChcImxlZnRcIil9Y2F0Y2goYSl7c2V0VGltZW91dChKLDEpO3JldHVybn1lLnJlYWR5KCl9dmFyIGU9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gbmV3IGUuZm4uaW5pdChhLGIsaCl9LGY9YS5qUXVlcnksZz1hLiQsaCxpPS9eKD86W148XSooPFtcXHdcXFddKz4pW14+XSokfCMoW1xcd1xcLV0qKSQpLyxqPS9cXFMvLGs9L15cXHMrLyxsPS9cXHMrJC8sbT0vXFxkLyxuPS9ePChcXHcrKVxccypcXC8/Pig/OjxcXC9cXDE+KT8kLyxvPS9eW1xcXSw6e31cXHNdKiQvLHA9L1xcXFwoPzpbXCJcXFxcXFwvYmZucnRdfHVbMC05YS1mQS1GXXs0fSkvZyxxPS9cIlteXCJcXFxcXFxuXFxyXSpcInx0cnVlfGZhbHNlfG51bGx8LT9cXGQrKD86XFwuXFxkKik/KD86W2VFXVsrXFwtXT9cXGQrKT8vZyxyPS8oPzpefDp8LCkoPzpcXHMqXFxbKSsvZyxzPS8od2Via2l0KVsgXFwvXShbXFx3Ll0rKS8sdD0vKG9wZXJhKSg/Oi4qdmVyc2lvbik/WyBcXC9dKFtcXHcuXSspLyx1PS8obXNpZSkgKFtcXHcuXSspLyx2PS8obW96aWxsYSkoPzouKj8gcnY6KFtcXHcuXSspKT8vLHc9Ly0oW2Etel0pL2lnLHg9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi50b1VwcGVyQ2FzZSgpfSx5PWQudXNlckFnZW50LHosQSxCLEM9T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyxEPU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksRT1BcnJheS5wcm90b3R5cGUucHVzaCxGPUFycmF5LnByb3RvdHlwZS5zbGljZSxHPVN0cmluZy5wcm90b3R5cGUudHJpbSxIPUFycmF5LnByb3RvdHlwZS5pbmRleE9mLEk9e307ZS5mbj1lLnByb3RvdHlwZT17Y29uc3RydWN0b3I6ZSxpbml0OmZ1bmN0aW9uKGEsZCxmKXt2YXIgZyxoLGosaztpZighYSl7cmV0dXJuIHRoaXN9aWYoYS5ub2RlVHlwZSl7dGhpcy5jb250ZXh0PXRoaXNbMF09YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKGE9PT1cImJvZHlcIiYmIWQmJmMuYm9keSl7dGhpcy5jb250ZXh0PWM7dGhpc1swXT1jLmJvZHk7dGhpcy5zZWxlY3Rvcj1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYodHlwZW9mIGE9PT1cInN0cmluZ1wiKXtpZihhLmNoYXJBdCgwKT09PVwiPFwiJiZhLmNoYXJBdChhLmxlbmd0aC0xKT09PVwiPlwiJiZhLmxlbmd0aD49Myl7Zz1bbnVsbCxhLG51bGxdfWVsc2V7Zz1pLmV4ZWMoYSl9aWYoZyYmKGdbMV18fCFkKSl7aWYoZ1sxXSl7ZD1kIGluc3RhbmNlb2YgZT9kWzBdOmQ7az1kP2Qub3duZXJEb2N1bWVudHx8ZDpjO2o9bi5leGVjKGEpO2lmKGope2lmKGUuaXNQbGFpbk9iamVjdChkKSl7YT1bYy5jcmVhdGVFbGVtZW50KGpbMV0pXTtlLmZuLmF0dHIuY2FsbChhLGQsdHJ1ZSl9ZWxzZXthPVtrLmNyZWF0ZUVsZW1lbnQoalsxXSldfX1lbHNle2o9ZS5idWlsZEZyYWdtZW50KFtnWzFdXSxba10pO2E9KGouY2FjaGVhYmxlP2UuY2xvbmUoai5mcmFnbWVudCk6ai5mcmFnbWVudCkuY2hpbGROb2Rlc31yZXR1cm4gZS5tZXJnZSh0aGlzLGEpfWVsc2V7aD1jLmdldEVsZW1lbnRCeUlkKGdbMl0pO2lmKGgmJmgucGFyZW50Tm9kZSl7aWYoaC5pZCE9PWdbMl0pe3JldHVybiBmLmZpbmQoYSl9dGhpcy5sZW5ndGg9MTt0aGlzWzBdPWh9dGhpcy5jb250ZXh0PWM7dGhpcy5zZWxlY3Rvcj1hO3JldHVybiB0aGlzfX1lbHNlIGlmKCFkfHxkLmpxdWVyeSl7cmV0dXJuKGR8fGYpLmZpbmQoYSl9ZWxzZXtyZXR1cm4gdGhpcy5jb25zdHJ1Y3RvcihkKS5maW5kKGEpfX1lbHNlIGlmKGUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGYucmVhZHkoYSl9aWYoYS5zZWxlY3RvciE9PWIpe3RoaXMuc2VsZWN0b3I9YS5zZWxlY3Rvcjt0aGlzLmNvbnRleHQ9YS5jb250ZXh0fXJldHVybiBlLm1ha2VBcnJheShhLHRoaXMpfSxzZWxlY3RvcjpcIlwiLGpxdWVyeTpcIjEuNi4zcHJlXCIsbGVuZ3RoOjAsc2l6ZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLmxlbmd0aH0sdG9BcnJheTpmdW5jdGlvbigpe3JldHVybiBGLmNhbGwodGhpcywwKX0sZ2V0OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP3RoaXMudG9BcnJheSgpOmE8MD90aGlzW3RoaXMubGVuZ3RoK2FdOnRoaXNbYV19LHB1c2hTdGFjazpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9dGhpcy5jb25zdHJ1Y3RvcigpO2lmKGUuaXNBcnJheShhKSl7RS5hcHBseShkLGEpfWVsc2V7ZS5tZXJnZShkLGEpfWQucHJldk9iamVjdD10aGlzO2QuY29udGV4dD10aGlzLmNvbnRleHQ7aWYoYj09PVwiZmluZFwiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrKHRoaXMuc2VsZWN0b3I/XCIgXCI6XCJcIikrY31lbHNlIGlmKGIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcitcIi5cIitiK1wiKFwiK2MrXCIpXCJ9cmV0dXJuIGR9LGVhY2g6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gZS5lYWNoKHRoaXMsYSxiKX0scmVhZHk6ZnVuY3Rpb24oYSl7ZS5iaW5kUmVhZHkoKTtBLmRvbmUoYSk7cmV0dXJuIHRoaXN9LGVxOmZ1bmN0aW9uKGEpe3JldHVybiBhPT09LTE/dGhpcy5zbGljZShhKTp0aGlzLnNsaWNlKGEsK2ErMSl9LGZpcnN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoMCl9LGxhc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgtMSl9LHNsaWNlOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKEYuYXBwbHkodGhpcyxhcmd1bWVudHMpLFwic2xpY2VcIixGLmNhbGwoYXJndW1lbnRzKS5qb2luKFwiLFwiKSl9LG1hcDpmdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soZS5tYXAodGhpcyxmdW5jdGlvbihiLGMpe3JldHVybiBhLmNhbGwoYixjLGIpfSkpfSxlbmQ6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wcmV2T2JqZWN0fHx0aGlzLmNvbnN0cnVjdG9yKG51bGwpfSxwdXNoOkUsc29ydDpbXS5zb3J0LHNwbGljZTpbXS5zcGxpY2V9O2UuZm4uaW5pdC5wcm90b3R5cGU9ZS5mbjtlLmV4dGVuZD1lLmZuLmV4dGVuZD1mdW5jdGlvbigpe3ZhciBhLGMsZCxmLGcsaCxpPWFyZ3VtZW50c1swXXx8e30saj0xLGs9YXJndW1lbnRzLmxlbmd0aCxsPWZhbHNlO2lmKHR5cGVvZiBpPT09XCJib29sZWFuXCIpe2w9aTtpPWFyZ3VtZW50c1sxXXx8e307aj0yfWlmKHR5cGVvZiBpIT09XCJvYmplY3RcIiYmIWUuaXNGdW5jdGlvbihpKSl7aT17fX1pZihrPT09ail7aT10aGlzOy0tan1mb3IoO2o8aztqKyspe2lmKChhPWFyZ3VtZW50c1tqXSkhPW51bGwpe2ZvcihjIGluIGEpe2Q9aVtjXTtmPWFbY107aWYoaT09PWYpe2NvbnRpbnVlfWlmKGwmJmYmJihlLmlzUGxhaW5PYmplY3QoZil8fChnPWUuaXNBcnJheShmKSkpKXtpZihnKXtnPWZhbHNlO2g9ZCYmZS5pc0FycmF5KGQpP2Q6W119ZWxzZXtoPWQmJmUuaXNQbGFpbk9iamVjdChkKT9kOnt9fWlbY109ZS5leHRlbmQobCxoLGYpfWVsc2UgaWYoZiE9PWIpe2lbY109Zn19fX1yZXR1cm4gaX07ZS5leHRlbmQoe25vQ29uZmxpY3Q6ZnVuY3Rpb24oYil7aWYoYS4kPT09ZSl7YS4kPWd9aWYoYiYmYS5qUXVlcnk9PT1lKXthLmpRdWVyeT1mfXJldHVybiBlfSxpc1JlYWR5OmZhbHNlLHJlYWR5V2FpdDoxLGhvbGRSZWFkeTpmdW5jdGlvbihhKXtpZihhKXtlLnJlYWR5V2FpdCsrfWVsc2V7ZS5yZWFkeSh0cnVlKX19LHJlYWR5OmZ1bmN0aW9uKGEpe2lmKGE9PT10cnVlJiYhLS1lLnJlYWR5V2FpdHx8YSE9PXRydWUmJiFlLmlzUmVhZHkpe2lmKCFjLmJvZHkpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9ZS5pc1JlYWR5PXRydWU7aWYoYSE9PXRydWUmJi0tZS5yZWFkeVdhaXQ+MCl7cmV0dXJufUEucmVzb2x2ZVdpdGgoYyxbZV0pO2lmKGUuZm4udHJpZ2dlcil7ZShjKS50cmlnZ2VyKFwicmVhZHlcIikudW5iaW5kKFwicmVhZHlcIil9fX0sYmluZFJlYWR5OmZ1bmN0aW9uKCl7aWYoQSl7cmV0dXJufUE9ZS5fRGVmZXJyZWQoKTtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9aWYoYy5hZGRFdmVudExpc3RlbmVyKXtjLmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7YS5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLGUucmVhZHksZmFsc2UpfWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Yy5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2EuYXR0YWNoRXZlbnQoXCJvbmxvYWRcIixlLnJlYWR5KTt2YXIgYj1mYWxzZTt0cnl7Yj1hLmZyYW1lRWxlbWVudD09bnVsbH1jYXRjaChkKXt9aWYoYy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwmJmIpe0ooKX19fSxpc0Z1bmN0aW9uOmZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImZ1bmN0aW9uXCJ9LGlzQXJyYXk6QXJyYXkuaXNBcnJheXx8ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiYXJyYXlcIn0saXNXaW5kb3c6ZnVuY3Rpb24oYSl7cmV0dXJuIGEmJnR5cGVvZiBhPT09XCJvYmplY3RcIiYmXCJzZXRJbnRlcnZhbFwiaW4gYX0saXNOYU46ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGx8fCFtLnRlc3QoYSl8fGlzTmFOKGEpfSx0eXBlOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1N0cmluZyhhKTpJW0MuY2FsbChhKV18fFwib2JqZWN0XCJ9LGlzUGxhaW5PYmplY3Q6ZnVuY3Rpb24oYSl7aWYoIWF8fGUudHlwZShhKSE9PVwib2JqZWN0XCJ8fGEubm9kZVR5cGV8fGUuaXNXaW5kb3coYSkpe3JldHVybiBmYWxzZX1pZihhLmNvbnN0cnVjdG9yJiYhRC5jYWxsKGEsXCJjb25zdHJ1Y3RvclwiKSYmIUQuY2FsbChhLmNvbnN0cnVjdG9yLnByb3RvdHlwZSxcImlzUHJvdG90eXBlT2ZcIikpe3JldHVybiBmYWxzZX12YXIgYztmb3IoYyBpbiBhKXt9cmV0dXJuIGM9PT1ifHxELmNhbGwoYSxjKX0saXNFbXB0eU9iamVjdDpmdW5jdGlvbihhKXtmb3IodmFyIGIgaW4gYSl7cmV0dXJuIGZhbHNlfXJldHVybiB0cnVlfSxlcnJvcjpmdW5jdGlvbihhKXt0aHJvdyBhfSxwYXJzZUpTT046ZnVuY3Rpb24oYil7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wifHwhYil7cmV0dXJuIG51bGx9Yj1lLnRyaW0oYik7aWYoYS5KU09OJiZhLkpTT04ucGFyc2Upe3JldHVybiBhLkpTT04ucGFyc2UoYil9aWYoby50ZXN0KGIucmVwbGFjZShwLFwiQFwiKS5yZXBsYWNlKHEsXCJdXCIpLnJlcGxhY2UocixcIlwiKSkpe3JldHVybihuZXcgRnVuY3Rpb24oXCJyZXR1cm4gXCIrYikpKCl9ZS5lcnJvcihcIkludmFsaWQgSlNPTjogXCIrYil9LHBhcnNlWE1MOmZ1bmN0aW9uKGMpe3ZhciBkLGY7dHJ5e2lmKGEuRE9NUGFyc2VyKXtmPW5ldyBET01QYXJzZXI7ZD1mLnBhcnNlRnJvbVN0cmluZyhjLFwidGV4dC94bWxcIil9ZWxzZXtkPW5ldyBBY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTERPTVwiKTtkLmFzeW5jPVwiZmFsc2VcIjtkLmxvYWRYTUwoYyl9fWNhdGNoKGcpe2Q9Yn1pZighZHx8IWQuZG9jdW1lbnRFbGVtZW50fHxkLmdldEVsZW1lbnRzQnlUYWdOYW1lKFwicGFyc2VyZXJyb3JcIikubGVuZ3RoKXtlLmVycm9yKFwiSW52YWxpZCBYTUw6IFwiK2MpfXJldHVybiBkfSxub29wOmZ1bmN0aW9uKCl7fSxnbG9iYWxFdmFsOmZ1bmN0aW9uKGIpe2lmKGImJmoudGVzdChiKSl7KGEuZXhlY1NjcmlwdHx8ZnVuY3Rpb24oYil7YVtcImV2YWxcIl0uY2FsbChhLGIpfSkoYil9fSxjYW1lbENhc2U6ZnVuY3Rpb24oYSl7cmV0dXJuIGEucmVwbGFjZSh3LHgpfSxub2RlTmFtZTpmdW5jdGlvbihhLGIpe3JldHVybiBhLm5vZGVOYW1lJiZhLm5vZGVOYW1lLnRvVXBwZXJDYXNlKCk9PT1iLnRvVXBwZXJDYXNlKCl9LGVhY2g6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGc9MCxoPWEubGVuZ3RoLGk9aD09PWJ8fGUuaXNGdW5jdGlvbihhKTtpZihkKXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmFwcGx5KGFbZl0sZCk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5hcHBseShhW2crK10sZCk9PT1mYWxzZSl7YnJlYWt9fX19ZWxzZXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmNhbGwoYVtmXSxmLGFbZl0pPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuY2FsbChhW2ddLGcsYVtnKytdKT09PWZhbHNlKXticmVha319fX1yZXR1cm4gYX0sdHJpbTpHP2Z1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6Ry5jYWxsKGEpfTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOmEudG9TdHJpbmcoKS5yZXBsYWNlKGssXCJcIikucmVwbGFjZShsLFwiXCIpfSxtYWtlQXJyYXk6ZnVuY3Rpb24oYSxiKXt2YXIgYz1ifHxbXTtpZihhIT1udWxsKXt2YXIgZD1lLnR5cGUoYSk7aWYoYS5sZW5ndGg9PW51bGx8fGQ9PT1cInN0cmluZ1wifHxkPT09XCJmdW5jdGlvblwifHxkPT09XCJyZWdleHBcInx8ZS5pc1dpbmRvdyhhKSl7RS5jYWxsKGMsYSl9ZWxzZXtlLm1lcmdlKGMsYSl9fXJldHVybiBjfSxpbkFycmF5OmZ1bmN0aW9uKGEsYil7aWYoSCl7cmV0dXJuIEguY2FsbChiLGEpfWZvcih2YXIgYz0wLGQ9Yi5sZW5ndGg7YzxkO2MrKyl7aWYoYltjXT09PWEpe3JldHVybiBjfX1yZXR1cm4tMX0sbWVyZ2U6ZnVuY3Rpb24oYSxjKXt2YXIgZD1hLmxlbmd0aCxlPTA7aWYodHlwZW9mIGMubGVuZ3RoPT09XCJudW1iZXJcIil7Zm9yKHZhciBmPWMubGVuZ3RoO2U8ZjtlKyspe2FbZCsrXT1jW2VdfX1lbHNle3doaWxlKGNbZV0hPT1iKXthW2QrK109Y1tlKytdfX1hLmxlbmd0aD1kO3JldHVybiBhfSxncmVwOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD1bXSxlO2M9ISFjO2Zvcih2YXIgZj0wLGc9YS5sZW5ndGg7ZjxnO2YrKyl7ZT0hIWIoYVtmXSxmKTtpZihjIT09ZSl7ZC5wdXNoKGFbZl0pfX1yZXR1cm4gZH0sbWFwOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnLGg9W10saT0wLGo9YS5sZW5ndGgsaz1hIGluc3RhbmNlb2YgZXx8aiE9PWImJnR5cGVvZiBqPT09XCJudW1iZXJcIiYmKGo+MCYmYVswXSYmYVtqLTFdfHxqPT09MHx8ZS5pc0FycmF5KGEpKTtpZihrKXtmb3IoO2k8ajtpKyspe2Y9YyhhW2ldLGksZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fWVsc2V7Zm9yKGcgaW4gYSl7Zj1jKGFbZ10sZyxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19cmV0dXJuIGguY29uY2F0LmFwcGx5KFtdLGgpfSxndWlkOjEscHJveHk6ZnVuY3Rpb24oYSxjKXtpZih0eXBlb2YgYz09PVwic3RyaW5nXCIpe3ZhciBkPWFbY107Yz1hO2E9ZH1pZighZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gYn12YXIgZj1GLmNhbGwoYXJndW1lbnRzLDIpLGc9ZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShjLGYuY29uY2F0KEYuY2FsbChhcmd1bWVudHMpKSl9O2cuZ3VpZD1hLmd1aWQ9YS5ndWlkfHxnLmd1aWR8fGUuZ3VpZCsrO3JldHVybiBnfSxhY2Nlc3M6ZnVuY3Rpb24oYSxjLGQsZixnLGgpe3ZhciBpPWEubGVuZ3RoO2lmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Zm9yKHZhciBqIGluIGMpe2UuYWNjZXNzKGEsaixjW2pdLGYsZyxkKX1yZXR1cm4gYX1pZihkIT09Yil7Zj0haCYmZiYmZS5pc0Z1bmN0aW9uKGQpO2Zvcih2YXIgaz0wO2s8aTtrKyspe2coYVtrXSxjLGY/ZC5jYWxsKGFba10sayxnKGFba10sYykpOmQsaCl9cmV0dXJuIGF9cmV0dXJuIGk/ZyhhWzBdLGMpOmJ9LG5vdzpmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfSx1YU1hdGNoOmZ1bmN0aW9uKGEpe2E9YS50b0xvd2VyQ2FzZSgpO3ZhciBiPXMuZXhlYyhhKXx8dC5leGVjKGEpfHx1LmV4ZWMoYSl8fGEuaW5kZXhPZihcImNvbXBhdGlibGVcIik8MCYmdi5leGVjKGEpfHxbXTtyZXR1cm57YnJvd3NlcjpiWzFdfHxcIlwiLHZlcnNpb246YlsyXXx8XCIwXCJ9fSxzdWI6ZnVuY3Rpb24oKXtmdW5jdGlvbiBhKGIsYyl7cmV0dXJuIG5ldyBhLmZuLmluaXQoYixjKX1lLmV4dGVuZCh0cnVlLGEsdGhpcyk7YS5zdXBlcmNsYXNzPXRoaXM7YS5mbj1hLnByb3RvdHlwZT10aGlzKCk7YS5mbi5jb25zdHJ1Y3Rvcj1hO2Euc3ViPXRoaXMuc3ViO2EuZm4uaW5pdD1mdW5jdGlvbiBkKGMsZCl7aWYoZCYmZCBpbnN0YW5jZW9mIGUmJiEoZCBpbnN0YW5jZW9mIGEpKXtkPWEoZCl9cmV0dXJuIGUuZm4uaW5pdC5jYWxsKHRoaXMsYyxkLGIpfTthLmZuLmluaXQucHJvdG90eXBlPWEuZm47dmFyIGI9YShjKTtyZXR1cm4gYX0sYnJvd3Nlcjp7fX0pO2UuZWFjaChcIkJvb2xlYW4gTnVtYmVyIFN0cmluZyBGdW5jdGlvbiBBcnJheSBEYXRlIFJlZ0V4cCBPYmplY3RcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtJW1wiW29iamVjdCBcIitiK1wiXVwiXT1iLnRvTG93ZXJDYXNlKCl9KTt6PWUudWFNYXRjaCh5KTtpZih6LmJyb3dzZXIpe2UuYnJvd3Nlclt6LmJyb3dzZXJdPXRydWU7ZS5icm93c2VyLnZlcnNpb249ei52ZXJzaW9ufWlmKGUuYnJvd3Nlci53ZWJraXQpe2UuYnJvd3Nlci5zYWZhcmk9dHJ1ZX1pZihqLnRlc3QoXCLCoFwiKSl7az0vXltcXHNcXHhBMF0rLztsPS9bXFxzXFx4QTBdKyQvfWg9ZShjKTtpZihjLmFkZEV2ZW50TGlzdGVuZXIpe0I9ZnVuY3Rpb24oKXtjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7ZS5yZWFkeSgpfX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe0I9ZnVuY3Rpb24oKXtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe2MuZGV0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTtlLnJlYWR5KCl9fX1yZXR1cm4gZX0oKTt2YXIgZz1cImRvbmUgZmFpbCBpc1Jlc29sdmVkIGlzUmVqZWN0ZWQgcHJvbWlzZSB0aGVuIGFsd2F5cyBwaXBlXCIuc3BsaXQoXCIgXCIpLGg9W10uc2xpY2U7Zi5leHRlbmQoe19EZWZlcnJlZDpmdW5jdGlvbigpe3ZhciBhPVtdLGIsYyxkLGU9e2RvbmU6ZnVuY3Rpb24oKXtpZighZCl7dmFyIGM9YXJndW1lbnRzLGcsaCxpLGosaztpZihiKXtrPWI7Yj0wfWZvcihnPTAsaD1jLmxlbmd0aDtnPGg7ZysrKXtpPWNbZ107aj1mLnR5cGUoaSk7aWYoaj09PVwiYXJyYXlcIil7ZS5kb25lLmFwcGx5KGUsaSl9ZWxzZSBpZihqPT09XCJmdW5jdGlvblwiKXthLnB1c2goaSl9fWlmKGspe2UucmVzb2x2ZVdpdGgoa1swXSxrWzFdKX19cmV0dXJuIHRoaXN9LHJlc29sdmVXaXRoOmZ1bmN0aW9uKGUsZil7aWYoIWQmJiFiJiYhYyl7Zj1mfHxbXTtjPTE7dHJ5e3doaWxlKGFbMF0pe2Euc2hpZnQoKS5hcHBseShlLGYpfX1maW5hbGx5e2I9W2UsZl07Yz0wfX1yZXR1cm4gdGhpc30scmVzb2x2ZTpmdW5jdGlvbigpe2UucmVzb2x2ZVdpdGgodGhpcyxhcmd1bWVudHMpO3JldHVybiB0aGlzfSxpc1Jlc29sdmVkOmZ1bmN0aW9uKCl7cmV0dXJuISEoY3x8Yil9LGNhbmNlbDpmdW5jdGlvbigpe2Q9MTthPVtdO3JldHVybiB0aGlzfX07cmV0dXJuIGV9LERlZmVycmVkOmZ1bmN0aW9uKGEpe3ZhciBiPWYuX0RlZmVycmVkKCksYz1mLl9EZWZlcnJlZCgpLGQ7Zi5leHRlbmQoYix7dGhlbjpmdW5jdGlvbihhLGMpe2IuZG9uZShhKS5mYWlsKGMpO3JldHVybiB0aGlzfSxhbHdheXM6ZnVuY3Rpb24oKXtyZXR1cm4gYi5kb25lLmFwcGx5KGIsYXJndW1lbnRzKS5mYWlsLmFwcGx5KHRoaXMsYXJndW1lbnRzKX0sZmFpbDpjLmRvbmUscmVqZWN0V2l0aDpjLnJlc29sdmVXaXRoLHJlamVjdDpjLnJlc29sdmUsaXNSZWplY3RlZDpjLmlzUmVzb2x2ZWQscGlwZTpmdW5jdGlvbihhLGMpe3JldHVybiBmLkRlZmVycmVkKGZ1bmN0aW9uKGQpe2YuZWFjaCh7ZG9uZTpbYSxcInJlc29sdmVcIl0sZmFpbDpbYyxcInJlamVjdFwiXX0sZnVuY3Rpb24oYSxjKXt2YXIgZT1jWzBdLGc9Y1sxXSxoO2lmKGYuaXNGdW5jdGlvbihlKSl7YlthXShmdW5jdGlvbigpe2g9ZS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7aWYoaCYmZi5pc0Z1bmN0aW9uKGgucHJvbWlzZSkpe2gucHJvbWlzZSgpLnRoZW4oZC5yZXNvbHZlLGQucmVqZWN0KX1lbHNle2RbZytcIldpdGhcIl0odGhpcz09PWI/ZDp0aGlzLFtoXSl9fSl9ZWxzZXtiW2FdKGRbZ10pfX0pfSkucHJvbWlzZSgpfSxwcm9taXNlOmZ1bmN0aW9uKGEpe2lmKGE9PW51bGwpe2lmKGQpe3JldHVybiBkfWQ9YT17fX12YXIgYz1nLmxlbmd0aDt3aGlsZShjLS0pe2FbZ1tjXV09YltnW2NdXX1yZXR1cm4gYX19KTtiLmRvbmUoYy5jYW5jZWwpLmZhaWwoYi5jYW5jZWwpO2RlbGV0ZSBiLmNhbmNlbDtpZihhKXthLmNhbGwoYixiKX1yZXR1cm4gYn0sd2hlbjpmdW5jdGlvbihhKXtmdW5jdGlvbiBpKGEpe3JldHVybiBmdW5jdGlvbihjKXtiW2FdPWFyZ3VtZW50cy5sZW5ndGg+MT9oLmNhbGwoYXJndW1lbnRzLDApOmM7aWYoIS0tZSl7Zy5yZXNvbHZlV2l0aChnLGguY2FsbChiLDApKX19fXZhciBiPWFyZ3VtZW50cyxjPTAsZD1iLmxlbmd0aCxlPWQsZz1kPD0xJiZhJiZmLmlzRnVuY3Rpb24oYS5wcm9taXNlKT9hOmYuRGVmZXJyZWQoKTtpZihkPjEpe2Zvcig7YzxkO2MrKyl7aWYoYltjXSYmZi5pc0Z1bmN0aW9uKGJbY10ucHJvbWlzZSkpe2JbY10ucHJvbWlzZSgpLnRoZW4oaShjKSxnLnJlamVjdCl9ZWxzZXstLWV9fWlmKCFlKXtnLnJlc29sdmVXaXRoKGcsYil9fWVsc2UgaWYoZyE9PWEpe2cucmVzb2x2ZVdpdGgoZyxkP1thXTpbXSl9cmV0dXJuIGcucHJvbWlzZSgpfX0pO2Yuc3VwcG9ydD1mLnN1cHBvcnR8fHt9O3ZhciBpPS8lMjAvZyxqPS9cXFtcXF0kLyxrPS9cXHI/XFxuL2csbD0vIy4qJC8sbT0vXiguKj8pOlsgXFx0XSooW15cXHJcXG5dKilcXHI/JC9tZyxuPS9eKD86Y29sb3J8ZGF0ZXxkYXRldGltZXxlbWFpbHxoaWRkZW58bW9udGh8bnVtYmVyfHBhc3N3b3JkfHJhbmdlfHNlYXJjaHx0ZWx8dGV4dHx0aW1lfHVybHx3ZWVrKSQvaSxvPS9eKD86YWJvdXR8YXBwfGFwcFxcLXN0b3JhZ2V8LitcXC1leHRlbnNpb258ZmlsZXxyZXN8d2lkZ2V0KTokLyxwPS9eKD86R0VUfEhFQUQpJC8scT0vXlxcL1xcLy8scj0vXFw/LyxzPS88c2NyaXB0XFxiW148XSooPzooPyE8XFwvc2NyaXB0Pik8W148XSopKjxcXC9zY3JpcHQ+L2dpLHQ9L14oPzpzZWxlY3R8dGV4dGFyZWEpL2ksdT0vXFxzKy8sdj0vKFs/Jl0pXz1bXiZdKi8sdz0vXihbXFx3XFwrXFwuXFwtXSs6KSg/OlxcL1xcLyhbXlxcLz8jOl0qKSg/OjooXFxkKykpPyk/Lyx4PWYuZm4ubG9hZCx5PXt9LHo9e30sQSxCO3RyeXtBPWUuaHJlZn1jYXRjaChDKXtBPWMuY3JlYXRlRWxlbWVudChcImFcIik7QS5ocmVmPVwiXCI7QT1BLmhyZWZ9Qj13LmV4ZWMoQS50b0xvd2VyQ2FzZSgpKXx8W107Zi5mbi5leHRlbmQoe2xvYWQ6ZnVuY3Rpb24oYSxjLGQpe2lmKHR5cGVvZiBhIT09XCJzdHJpbmdcIiYmeCl7cmV0dXJuIHguYXBwbHkodGhpcyxhcmd1bWVudHMpfWVsc2UgaWYoIXRoaXMubGVuZ3RoKXtyZXR1cm4gdGhpc312YXIgZT1hLmluZGV4T2YoXCIgXCIpO2lmKGU+PTApe3ZhciBnPWEuc2xpY2UoZSxhLmxlbmd0aCk7YT1hLnNsaWNlKDAsZSl9dmFyIGg9XCJHRVRcIjtpZihjKXtpZihmLmlzRnVuY3Rpb24oYykpe2Q9YztjPWJ9ZWxzZSBpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2M9Zi5wYXJhbShjLGYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsKTtoPVwiUE9TVFwifX12YXIgaT10aGlzO2YuYWpheCh7dXJsOmEsdHlwZTpoLGRhdGFUeXBlOlwiaHRtbFwiLGRhdGE6Yyxjb21wbGV0ZTpmdW5jdGlvbihhLGIsYyl7Yz1hLnJlc3BvbnNlVGV4dDtpZihhLmlzUmVzb2x2ZWQoKSl7YS5kb25lKGZ1bmN0aW9uKGEpe2M9YX0pO2kuaHRtbChnP2YoXCI8ZGl2PlwiKS5hcHBlbmQoYy5yZXBsYWNlKHMsXCJcIikpLmZpbmQoZyk6Yyl9aWYoZCl7aS5lYWNoKGQsW2MsYixhXSl9fX0pO3JldHVybiB0aGlzfSxzZXJpYWxpemU6ZnVuY3Rpb24oKXtyZXR1cm4gZi5wYXJhbSh0aGlzLnNlcmlhbGl6ZUFycmF5KCkpfSxzZXJpYWxpemVBcnJheTpmdW5jdGlvbigpe3JldHVybiB0aGlzLm1hcChmdW5jdGlvbigpe3JldHVybiB0aGlzLmVsZW1lbnRzP2YubWFrZUFycmF5KHRoaXMuZWxlbWVudHMpOnRoaXN9KS5maWx0ZXIoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5uYW1lJiYhdGhpcy5kaXNhYmxlZCYmKHRoaXMuY2hlY2tlZHx8dC50ZXN0KHRoaXMubm9kZU5hbWUpfHxuLnRlc3QodGhpcy50eXBlKSl9KS5tYXAoZnVuY3Rpb24oYSxiKXt2YXIgYz1mKHRoaXMpLnZhbCgpO3JldHVybiBjPT1udWxsP251bGw6Zi5pc0FycmF5KGMpP2YubWFwKGMsZnVuY3Rpb24oYSxjKXtyZXR1cm57bmFtZTpiLm5hbWUsdmFsdWU6YS5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSk6e25hbWU6Yi5uYW1lLHZhbHVlOmMucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pLmdldCgpfX0pO2YuZWFjaChcImFqYXhTdGFydCBhamF4U3RvcCBhamF4Q29tcGxldGUgYWpheEVycm9yIGFqYXhTdWNjZXNzIGFqYXhTZW5kXCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7Zi5mbltiXT1mdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5iaW5kKGIsYSl9fSk7Zi5lYWNoKFtcImdldFwiLFwicG9zdFwiXSxmdW5jdGlvbihhLGMpe2ZbY109ZnVuY3Rpb24oYSxkLGUsZyl7aWYoZi5pc0Z1bmN0aW9uKGQpKXtnPWd8fGU7ZT1kO2Q9Yn1yZXR1cm4gZi5hamF4KHt0eXBlOmMsdXJsOmEsZGF0YTpkLHN1Y2Nlc3M6ZSxkYXRhVHlwZTpnfSl9fSk7Zi5leHRlbmQoe2dldFNjcmlwdDpmdW5jdGlvbihhLGMpe3JldHVybiBmLmdldChhLGIsYyxcInNjcmlwdFwiKX0sZ2V0SlNPTjpmdW5jdGlvbihhLGIsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwianNvblwiKX0sYWpheFNldHVwOmZ1bmN0aW9uKGEsYil7aWYoYil7RihhLGYuYWpheFNldHRpbmdzKX1lbHNle2I9YTthPWYuYWpheFNldHRpbmdzfUYoYSxiKTtyZXR1cm4gYX0sYWpheFNldHRpbmdzOnt1cmw6QSxpc0xvY2FsOm8udGVzdChCWzFdKSxnbG9iYWw6dHJ1ZSx0eXBlOlwiR0VUXCIsY29udGVudFR5cGU6XCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixwcm9jZXNzRGF0YTp0cnVlLGFzeW5jOnRydWUsYWNjZXB0czp7eG1sOlwiYXBwbGljYXRpb24veG1sLCB0ZXh0L3htbFwiLGh0bWw6XCJ0ZXh0L2h0bWxcIix0ZXh0OlwidGV4dC9wbGFpblwiLGpzb246XCJhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L2phdmFzY3JpcHRcIixcIipcIjpcIiovKlwifSxjb250ZW50czp7eG1sOi94bWwvLGh0bWw6L2h0bWwvLGpzb246L2pzb24vfSxyZXNwb25zZUZpZWxkczp7eG1sOlwicmVzcG9uc2VYTUxcIix0ZXh0OlwicmVzcG9uc2VUZXh0XCJ9LGNvbnZlcnRlcnM6e1wiKiB0ZXh0XCI6YS5TdHJpbmcsXCJ0ZXh0IGh0bWxcIjp0cnVlLFwidGV4dCBqc29uXCI6Zi5wYXJzZUpTT04sXCJ0ZXh0IHhtbFwiOmYucGFyc2VYTUx9LGZsYXRPcHRpb25zOntjb250ZXh0OnRydWUsdXJsOnRydWV9fSxhamF4UHJlZmlsdGVyOkQoeSksYWpheFRyYW5zcG9ydDpEKHopLGFqYXg6ZnVuY3Rpb24oYSxjKXtmdW5jdGlvbiBLKGEsYyxsLG0pe2lmKEQ9PT0yKXtyZXR1cm59RD0yO2lmKEEpe2NsZWFyVGltZW91dChBKX14PWI7cz1tfHxcIlwiO0oucmVhZHlTdGF0ZT1hPjA/NDowO3ZhciBuLG8scCxxPWMscj1sP0goZCxKLGwpOmIsdCx1O2lmKGE+PTIwMCYmYTwzMDB8fGE9PT0zMDQpe2lmKGQuaWZNb2RpZmllZCl7aWYodD1KLmdldFJlc3BvbnNlSGVhZGVyKFwiTGFzdC1Nb2RpZmllZFwiKSl7Zi5sYXN0TW9kaWZpZWRba109dH1pZih1PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJFdGFnXCIpKXtmLmV0YWdba109dX19aWYoYT09PTMwNCl7cT1cIm5vdG1vZGlmaWVkXCI7bj10cnVlfWVsc2V7dHJ5e289SShkLHIpO3E9XCJzdWNjZXNzXCI7bj10cnVlfWNhdGNoKHYpe3E9XCJwYXJzZXJlcnJvclwiO3A9dn19fWVsc2V7cD1xO2lmKCFxfHxhKXtxPVwiZXJyb3JcIjtpZihhPDApe2E9MH19fUouc3RhdHVzPWE7Si5zdGF0dXNUZXh0PVwiXCIrKGN8fHEpO2lmKG4pe2gucmVzb2x2ZVdpdGgoZSxbbyxxLEpdKX1lbHNle2gucmVqZWN0V2l0aChlLFtKLHEscF0pfUouc3RhdHVzQ29kZShqKTtqPWI7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFwiKyhuP1wiU3VjY2Vzc1wiOlwiRXJyb3JcIiksW0osZCxuP286cF0pfWkucmVzb2x2ZVdpdGgoZSxbSixxXSk7aWYoRil7Zy50cmlnZ2VyKFwiYWpheENvbXBsZXRlXCIsW0osZF0pO2lmKCEtLWYuYWN0aXZlKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RvcFwiKX19fWlmKHR5cGVvZiBhPT09XCJvYmplY3RcIil7Yz1hO2E9Yn1jPWN8fHt9O3ZhciBkPWYuYWpheFNldHVwKHt9LGMpLGU9ZC5jb250ZXh0fHxkLGc9ZSE9PWQmJihlLm5vZGVUeXBlfHxlIGluc3RhbmNlb2YgZik/ZihlKTpmLmV2ZW50LGg9Zi5EZWZlcnJlZCgpLGk9Zi5fRGVmZXJyZWQoKSxqPWQuc3RhdHVzQ29kZXx8e30sayxuPXt9LG89e30scyx0LHgsQSxDLEQ9MCxGLEcsSj17cmVhZHlTdGF0ZTowLHNldFJlcXVlc3RIZWFkZXI6ZnVuY3Rpb24oYSxiKXtpZighRCl7dmFyIGM9YS50b0xvd2VyQ2FzZSgpO2E9b1tjXT1vW2NdfHxhO25bYV09Yn1yZXR1cm4gdGhpc30sZ2V0QWxsUmVzcG9uc2VIZWFkZXJzOmZ1bmN0aW9uKCl7cmV0dXJuIEQ9PT0yP3M6bnVsbH0sZ2V0UmVzcG9uc2VIZWFkZXI6ZnVuY3Rpb24oYSl7dmFyIGM7aWYoRD09PTIpe2lmKCF0KXt0PXt9O3doaWxlKGM9bS5leGVjKHMpKXt0W2NbMV0udG9Mb3dlckNhc2UoKV09Y1syXX19Yz10W2EudG9Mb3dlckNhc2UoKV19cmV0dXJuIGM9PT1iP251bGw6Y30sb3ZlcnJpZGVNaW1lVHlwZTpmdW5jdGlvbihhKXtpZighRCl7ZC5taW1lVHlwZT1hfXJldHVybiB0aGlzfSxhYm9ydDpmdW5jdGlvbihhKXthPWF8fFwiYWJvcnRcIjtpZih4KXt4LmFib3J0KGEpfUsoMCxhKTtyZXR1cm4gdGhpc319O2gucHJvbWlzZShKKTtKLnN1Y2Nlc3M9Si5kb25lO0ouZXJyb3I9Si5mYWlsO0ouY29tcGxldGU9aS5kb25lO0ouc3RhdHVzQ29kZT1mdW5jdGlvbihhKXtpZihhKXt2YXIgYjtpZihEPDIpe2ZvcihiIGluIGEpe2pbYl09W2pbYl0sYVtiXV19fWVsc2V7Yj1hW0ouc3RhdHVzXTtKLnRoZW4oYixiKX19cmV0dXJuIHRoaXN9O2QudXJsPSgoYXx8ZC51cmwpK1wiXCIpLnJlcGxhY2UobCxcIlwiKS5yZXBsYWNlKHEsQlsxXStcIi8vXCIpO2QuZGF0YVR5cGVzPWYudHJpbShkLmRhdGFUeXBlfHxcIipcIikudG9Mb3dlckNhc2UoKS5zcGxpdCh1KTtpZihkLmNyb3NzRG9tYWluPT1udWxsKXtDPXcuZXhlYyhkLnVybC50b0xvd2VyQ2FzZSgpKTtkLmNyb3NzRG9tYWluPSEhKEMmJihDWzFdIT1CWzFdfHxDWzJdIT1CWzJdfHwoQ1szXXx8KENbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkhPShCWzNdfHwoQlsxXT09PVwiaHR0cDpcIj84MDo0NDMpKSkpfWlmKGQuZGF0YSYmZC5wcm9jZXNzRGF0YSYmdHlwZW9mIGQuZGF0YSE9PVwic3RyaW5nXCIpe2QuZGF0YT1mLnBhcmFtKGQuZGF0YSxkLnRyYWRpdGlvbmFsKX1FKHksZCxjLEopO2lmKEQ9PT0yKXtyZXR1cm4gZmFsc2V9Rj1kLmdsb2JhbDtkLnR5cGU9ZC50eXBlLnRvVXBwZXJDYXNlKCk7ZC5oYXNDb250ZW50PSFwLnRlc3QoZC50eXBlKTtpZihGJiZmLmFjdGl2ZSsrPT09MCl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0YXJ0XCIpfWlmKCFkLmhhc0NvbnRlbnQpe2lmKGQuZGF0YSl7ZC51cmwrPShyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStkLmRhdGE7ZGVsZXRlIGQuZGF0YX1rPWQudXJsO2lmKGQuY2FjaGU9PT1mYWxzZSl7dmFyIEw9Zi5ub3coKSxNPWQudXJsLnJlcGxhY2UodixcIiQxXz1cIitMKTtkLnVybD1NKyhNPT09ZC51cmw/KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK1wiXz1cIitMOlwiXCIpfX1pZihkLmRhdGEmJmQuaGFzQ29udGVudCYmZC5jb250ZW50VHlwZSE9PWZhbHNlfHxjLmNvbnRlbnRUeXBlKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJDb250ZW50LVR5cGVcIixkLmNvbnRlbnRUeXBlKX1pZihkLmlmTW9kaWZpZWQpe2s9a3x8ZC51cmw7aWYoZi5sYXN0TW9kaWZpZWRba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU1vZGlmaWVkLVNpbmNlXCIsZi5sYXN0TW9kaWZpZWRba10pfWlmKGYuZXRhZ1trXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTm9uZS1NYXRjaFwiLGYuZXRhZ1trXSl9fUouc2V0UmVxdWVzdEhlYWRlcihcIkFjY2VwdFwiLGQuZGF0YVR5cGVzWzBdJiZkLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dP2QuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0rKGQuZGF0YVR5cGVzWzBdIT09XCIqXCI/XCIsICovKjsgcT0wLjAxXCI6XCJcIik6ZC5hY2NlcHRzW1wiKlwiXSk7Zm9yKEcgaW4gZC5oZWFkZXJzKXtKLnNldFJlcXVlc3RIZWFkZXIoRyxkLmhlYWRlcnNbR10pfWlmKGQuYmVmb3JlU2VuZCYmKGQuYmVmb3JlU2VuZC5jYWxsKGUsSixkKT09PWZhbHNlfHxEPT09Mikpe0ouYWJvcnQoKTtyZXR1cm4gZmFsc2V9Zm9yKEcgaW57c3VjY2VzczoxLGVycm9yOjEsY29tcGxldGU6MX0pe0pbR10oZFtHXSl9eD1FKHosZCxjLEopO2lmKCF4KXtLKC0xLFwiTm8gVHJhbnNwb3J0XCIpfWVsc2V7Si5yZWFkeVN0YXRlPTE7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFNlbmRcIixbSixkXSl9aWYoZC5hc3luYyYmZC50aW1lb3V0PjApe0E9c2V0VGltZW91dChmdW5jdGlvbigpe0ouYWJvcnQoXCJ0aW1lb3V0XCIpfSxkLnRpbWVvdXQpfXRyeXtEPTE7eC5zZW5kKG4sSyl9Y2F0Y2goTil7aWYoRDwyKXtLKC0xLE4pfWVsc2V7Zi5lcnJvcihOKX19fXJldHVybiBKfSxwYXJhbTpmdW5jdGlvbihhLGMpe3ZhciBkPVtdLGU9ZnVuY3Rpb24oYSxiKXtiPWYuaXNGdW5jdGlvbihiKT9iKCk6YjtkW2QubGVuZ3RoXT1lbmNvZGVVUklDb21wb25lbnQoYSkrXCI9XCIrZW5jb2RlVVJJQ29tcG9uZW50KGIpfTtpZihjPT09Yil7Yz1mLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbH1pZihmLmlzQXJyYXkoYSl8fGEuanF1ZXJ5JiYhZi5pc1BsYWluT2JqZWN0KGEpKXtmLmVhY2goYSxmdW5jdGlvbigpe2UodGhpcy5uYW1lLHRoaXMudmFsdWUpfSl9ZWxzZXtmb3IodmFyIGcgaW4gYSl7RyhnLGFbZ10sYyxlKX19cmV0dXJuIGQuam9pbihcIiZcIikucmVwbGFjZShpLFwiK1wiKX19KTtmLmV4dGVuZCh7YWN0aXZlOjAsbGFzdE1vZGlmaWVkOnt9LGV0YWc6e319KTt2YXIgSj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtmb3IodmFyIGEgaW4gTCl7TFthXSgwLDEpfX06ZmFsc2UsSz0wLEw7Zi5hamF4U2V0dGluZ3MueGhyPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe3JldHVybiF0aGlzLmlzTG9jYWwmJk0oKXx8TigpfTpNOyhmdW5jdGlvbihhKXtmLmV4dGVuZChmLnN1cHBvcnQse2FqYXg6ISFhLGNvcnM6ISFhJiZcIndpdGhDcmVkZW50aWFsc1wiaW4gYX0pfSkoZi5hamF4U2V0dGluZ3MueGhyKCkpO2lmKGYuc3VwcG9ydC5hamF4KXtmLmFqYXhUcmFuc3BvcnQoZnVuY3Rpb24oYyl7aWYoIWMuY3Jvc3NEb21haW58fGYuc3VwcG9ydC5jb3JzKXt2YXIgZDtyZXR1cm57c2VuZDpmdW5jdGlvbihlLGcpe3ZhciBoPWMueGhyKCksaSxqO2lmKGMudXNlcm5hbWUpe2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyxjLnVzZXJuYW1lLGMucGFzc3dvcmQpfWVsc2V7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jKX1pZihjLnhockZpZWxkcyl7Zm9yKGogaW4gYy54aHJGaWVsZHMpe2hbal09Yy54aHJGaWVsZHNbal19fWlmKGMubWltZVR5cGUmJmgub3ZlcnJpZGVNaW1lVHlwZSl7aC5vdmVycmlkZU1pbWVUeXBlKGMubWltZVR5cGUpfWlmKCFjLmNyb3NzRG9tYWluJiYhZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl0pe2VbXCJYLVJlcXVlc3RlZC1XaXRoXCJdPVwiWE1MSHR0cFJlcXVlc3RcIn10cnl7Zm9yKGogaW4gZSl7aC5zZXRSZXF1ZXN0SGVhZGVyKGosZVtqXSl9fWNhdGNoKGspe31oLnNlbmQoYy5oYXNDb250ZW50JiZjLmRhdGF8fG51bGwpO2Q9ZnVuY3Rpb24oYSxlKXt2YXIgaixrLGwsbSxuO3RyeXtpZihkJiYoZXx8aC5yZWFkeVN0YXRlPT09NCkpe2Q9YjtpZihpKXtoLm9ucmVhZHlzdGF0ZWNoYW5nZT1mLm5vb3A7aWYoSil7ZGVsZXRlIExbaV19fWlmKGUpe2lmKGgucmVhZHlTdGF0ZSE9PTQpe2guYWJvcnQoKX19ZWxzZXtqPWguc3RhdHVzO2w9aC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKTttPXt9O249aC5yZXNwb25zZVhNTDtpZihuJiZuLmRvY3VtZW50RWxlbWVudCl7bS54bWw9bn1tLnRleHQ9aC5yZXNwb25zZVRleHQ7dHJ5e2s9aC5zdGF0dXNUZXh0fWNhdGNoKG8pe2s9XCJcIn1pZighaiYmYy5pc0xvY2FsJiYhYy5jcm9zc0RvbWFpbil7aj1tLnRleHQ/MjAwOjQwNH1lbHNlIGlmKGo9PT0xMjIzKXtqPTIwNH19fX1jYXRjaChwKXtpZighZSl7ZygtMSxwKX19aWYobSl7ZyhqLGssbSxsKX19O2lmKCFjLmFzeW5jfHxoLnJlYWR5U3RhdGU9PT00KXtkKCl9ZWxzZXtpPSsrSztpZihKKXtpZighTCl7TD17fTtmKGEpLnVubG9hZChKKX1MW2ldPWR9aC5vbnJlYWR5c3RhdGVjaGFuZ2U9ZH19LGFib3J0OmZ1bmN0aW9uKCl7aWYoZCl7ZCgwLDEpfX19fX0pfWYuYWpheFNldHRpbmdzLmdsb2JhbD1mYWxzZTthLmpRdWVyeT1hLiQ9Zn0pKGdsb2JhbCl9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQkFNIGZvcm1hdDogaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZTtcbnZhciBQYWlyZWRJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL1BhaXJlZEludGVydmFsVHJlZS5qcycpLlBhaXJlZEludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxudmFyIEJhbUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjaHJvbW9zb21lczogJycsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3I6ICcxODgsMTg4LDE4OCcsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHZpZXdMaW1pdHM6ICcnLCAgLy8gYW5hbG9nb3VzIHRvIHZpZXdMaW1pdHMgaW4gd2lnZ2xlXzAsIGFwcGxpY2FibGUgaGVyZSB0byB0aGUgY292ZXJhZ2Ugc3VidHJhY2tcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogMjAwMCwgcGFjazogMjAwMH0sXG4gICAgY292SGVpZ2h0OiB7ZGVuc2U6IDI0LCBzcXVpc2g6IDM4LCBwYWNrOiAzOH0sXG4gICAgLy8gSWYgYSBudWNsZW90aWRlIGRpZmZlcnMgZnJvbSB0aGUgcmVmZXJlbmNlIHNlcXVlbmNlIGluIGdyZWF0ZXIgdGhhbiAyMCUgb2YgcXVhbGl0eSB3ZWlnaHRlZCByZWFkcywgXG4gICAgLy8gSUdWIGNvbG9ycyB0aGUgYmFyIGluIHByb3BvcnRpb24gdG8gdGhlIHJlYWQgY291bnQgb2YgZWFjaCBiYXNlOyB0aGUgZm9sbG93aW5nIGNoYW5nZXMgdGhhdCB0aHJlc2hvbGQgZm9yIGNocm9tb3pvb21cbiAgICBhbGxlbGVGcmVxVGhyZXNob2xkOiAwLjIsXG4gICAgLy8gRGF0YSBmb3IgaG93IG1hbnkgbnRzIHNob3VsZCBiZSBmZXRjaGVkIGluIG9uZSBnbz9cbiAgICBvcHRpbWFsRmV0Y2hXaW5kb3c6IDAsXG4gICAgLy8gQWJvdmUgd2hhdCB0aWxlIHdpZHRoIChpbiBudHMpIGRvIHdlIGF2b2lkIGZldGNoaW5nIGRhdGEgYWx0b2dldGhlcj9cbiAgICBtYXhGZXRjaFdpbmRvdzogMCxcbiAgICAvLyBUaGUgZm9sbG93aW5nIGNhbiBiZSBcImVuc2VtYmxfdWNzY1wiIG9yIFwidWNzY19lbnNlbWJsXCIgdG8gYXR0ZW1wdCBhdXRvLWNyb3NzbWFwcGluZyBvZiByZWZlcmVuY2UgY29udGlnIG5hbWVzXG4gICAgLy8gYmV0d2VlbiB0aGUgdHdvIHNjaGVtZXMsIHdoaWNoIElHViBkb2VzLCBidXQgaXMgYSBwZXJlbm5pYWwgaXNzdWU6IGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEwMDYyL1xuICAgIC8vIEkgaG9wZSBub3QgdG8gbmVlZCBhbGwgdGhlIG1hcHBpbmdzIGluIGhlcmUgaHR0cHM6Ly9naXRodWIuY29tL2Rwcnlhbjc5L0Nocm9tb3NvbWVNYXBwaW5ncyBidXQgaXQgbWF5IGJlIG5lY2Vzc2FyeVxuICAgIGNvbnZlcnRDaHJTY2hlbWU6IFwiYXV0b1wiLFxuICAgIC8vIERyYXcgcGFpcmVkIGVuZHMgd2l0aGluIGEgcmFuZ2Ugb2YgZXhwZWN0ZWQgaW5zZXJ0IHNpemVzIGFzIGEgY29udGludW91cyBmZWF0dXJlP1xuICAgIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjcGFpcmVkIGZvciBob3cgdGhpcyB3b3Jrc1xuICAgIHZpZXdBc1BhaXJzOiBmYWxzZSxcbiAgICBleHBlY3RlZEluc2VydFNpemVQZXJjZW50aWxlczogWzAuMDA1LCAwLjk5NV1cbiAgfSxcbiAgXG4gIC8vIFRoZSBGTEFHIGNvbHVtbiBmb3IgQkFNL1NBTSBpcyBhIGNvbWJpbmF0aW9uIG9mIGJpdHdpc2UgZmxhZ3NcbiAgZmxhZ3M6IHtcbiAgICBpc1JlYWRQYWlyZWQ6IDB4MSxcbiAgICBpc1JlYWRQcm9wZXJseUFsaWduZWQ6IDB4MixcbiAgICBpc1JlYWRVbm1hcHBlZDogMHg0LFxuICAgIGlzTWF0ZVVubWFwcGVkOiAweDgsXG4gICAgcmVhZFN0cmFuZFJldmVyc2U6IDB4MTAsXG4gICAgbWF0ZVN0cmFuZFJldmVyc2U6IDB4MjAsXG4gICAgaXNSZWFkRmlyc3RPZlBhaXI6IDB4NDAsXG4gICAgaXNSZWFkTGFzdE9mUGFpcjogMHg4MCxcbiAgICBpc1NlY29uZGFyeUFsaWdubWVudDogMHgxMDAsXG4gICAgaXNSZWFkRmFpbGluZ1ZlbmRvclFDOiAweDIwMCxcbiAgICBpc0R1cGxpY2F0ZVJlYWQ6IDB4NDAwLFxuICAgIGlzU3VwcGxlbWVudGFyeUFsaWdubWVudDogMHg4MDBcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYnJvd3NlckNocnMgPSBfLmtleXModGhpcy5icm93c2VyT3B0cyk7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBCQU0gdHJhY2sgYXQgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5icm93c2VyQ2hyU2NoZW1lID0gdGhpcy50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcykpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIG8udmlld0FzUGFpcnMgPSB0aGlzLmlzT24oby52aWV3QXNQYWlycyk7XG4gICAgaWYgKCFfLmlzQXJyYXkoby52aWV3TGltaXRzKSkge1xuICAgICAgby52aWV3TGltaXRzID0gXy5tYXAoby52aWV3TGltaXRzLnNwbGl0KCc6JyksIHBhcnNlRmxvYXQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIFRPRE86IElmIHRoZSBwYWlyaW5nIGludGVydmFsIGNoYW5nZWQsIHdlIHNob3VsZCB0b3NzIHRoZSBlbnRpcmUgY2FjaGUgYW5kIHJlc2V0IHRoZSBSZW1vdGVUcmFjayBiaW5zLFxuICAvLyAgICAgICAgICphbmQqIGJsb3cgdXAgdGhlIGFyZWFJbmRleC5cbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gdGhpcy5vcHRzO1xuICAgIC8vIFdoZW4gd2UgY2hhbmdlIG9wdHMudmlld0FzUGFpcnMsIHdlICpuZWVkKiB0byB0aHJvdyBvdXQgdGhpcy5kYXRhLnBpbGV1cC5cbiAgICBpZiAoby52aWV3QXNQYWlycyAhPSB0aGlzLnByZXZPcHRzLnZpZXdBc1BhaXJzICYmIHRoaXMuZGF0YSAmJiB0aGlzLmRhdGEucGlsZXVwKSB7IFxuICAgICAgdGhpcy5kYXRhLnBpbGV1cCA9IHt9O1xuICAgIH1cbiAgICB0aGlzLmRyYXdSYW5nZSA9IG8uYXV0b1NjYWxlIHx8IG8udmlld0xpbWl0cy5sZW5ndGggPCAyID8gdGhpcy5jb3ZlcmFnZVJhbmdlIDogby52aWV3TGltaXRzO1xuICAgIHRoaXMuc2NhbGVzID0gXy5tYXBPYmplY3Qoe2RlbnNlOiAwLCBzcXVpc2g6IDAsIHBhY2s6IDB9LCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICByZXR1cm4gW3tsaW1pdHM6IHNlbGYuZHJhd1JhbmdlLCBzcGVjaWFsVGlja3M6IFtNYXRoLnJvdW5kKHNlbGYuZHJhd1JhbmdlWzFdIC8gMildLCB0b3A6IDAsIGhlaWdodDogby5jb3ZIZWlnaHRba10gfHwgMjR9XTtcbiAgICB9KTtcbiAgICAvLyBUT0RPOiBTZXR1cCB0aGlzLnNjYWxlcyBoZXJlXG4gICAgXG4gICAgLy8gRW5zdXJlcyB0aGF0IG9wdGlvbnMgYW5kIGRlcml2ZWQgcHJvcGVydGllcyBzZXQgYnkgdGhlIGFib3ZlIGFyZSBlcXVhbCBhY3Jvc3MgV2ViIFdvcmtlciBhbmQgRE9NIGNvbnRleHRzXG4gICAgdGhpcy5zeW5jUHJvcHMoWydvcHRzJywgJ2RyYXdSYW5nZScsICdjb3ZlcmFnZVJhbmdlJywgJ3NjYWxlcyddKTtcbiAgICBcbiAgICB0aGlzLnByZXZPcHRzID0gZGVlcENsb25lKHRoaXMub3B0cyk7XG4gIH0sXG4gIFxuICBndWVzc0NoclNjaGVtZTogZnVuY3Rpb24oY2hycykge1xuICAgIGxpbWl0ID0gTWF0aC5taW4oY2hycy5sZW5ndGggKiAwLjgsIDIwKTtcbiAgICBpZiAoXy5maWx0ZXIoY2hycywgZnVuY3Rpb24oY2hyKSB7IHJldHVybiAoL15jaHIvKS50ZXN0KGNocik7IH0pLmxlbmd0aCA+IGxpbWl0KSB7IHJldHVybiAndWNzYyc7IH1cbiAgICBpZiAoXy5maWx0ZXIoY2hycywgZnVuY3Rpb24oY2hyKSB7IHJldHVybiAoL15cXGRcXGQ/JC8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICdlbnNlbWJsJzsgfVxuICAgIHJldHVybiBudWxsO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBjYWNoZSA9IG5ldyBQYWlyZWRJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30sIFxuICAgICAgICAgIHtzdGFydEtleTogJ3RlbXBsYXRlU3RhcnQnLCBlbmRLZXk6ICd0ZW1wbGF0ZUVuZCcsIHBhaXJlZExlbmd0aEtleTogJ3RsZW4nLCBwYWlyaW5nS2V5OiAncW5hbWUnfSksXG4gICAgICBhamF4VXJsID0gc2VsZi5hamF4RGlyKCkgKyAnYmFtLnBocCcsXG4gICAgICBpbmZvQ2hyUmFuZ2UgPSBzZWxmLmNoclJhbmdlKE1hdGgucm91bmQoc2VsZi5icm93c2VyT3B0cy5wb3MpLCBNYXRoLnJvdW5kKHNlbGYuYnJvd3Nlck9wdHMucG9zICsgMTAwMDApKSxcbiAgICAgIHJlbW90ZTtcbiAgICBcbiAgICByZW1vdGUgPSBuZXcgUmVtb3RlVHJhY2soY2FjaGUsIGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIHN0b3JlSW50ZXJ2YWxzKSB7XG4gICAgICByYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgICAvLyBDb252ZXJ0IGF1dG9tYXRpY2FsbHkgYmV0d2VlbiBFbnNlbWJsIHN0eWxlIDEsIDIsIDMsIFggPC0tPiBVQ1NDIHN0eWxlIGNocjEsIGNocjIsIGNocjMsIGNoclggYXMgY29uZmlndXJlZC9hdXRvZGV0ZWN0ZWRcbiAgICAgIC8vIE5vdGUgdGhhdCBjaHJNIGlzIE5PVCBlcXVpdmFsZW50IHRvIE1UIGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEyMDA0Mi8jMTIwMDU4XG4gICAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSA9PSBcImF1dG9cIiA/IHNlbGYuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgOiBvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eY2hyLywgJycpOyB9KTsgYnJlYWs7XG4gICAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IHJhbmdlID0gXy5tYXAocmFuZ2UsIGZ1bmN0aW9uKHIpIHsgcmV0dXJuIHIucmVwbGFjZSgvXihcXGRcXGQ/fFgpOi8sICdjaHIkMTonKTsgfSk7IGJyZWFrO1xuICAgICAgfVxuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUGFyc2UgdGhlIFNBTSBmb3JtYXQgaW50byBpbnRlcnZhbHMgdGhhdCBjYW4gYmUgaW5zZXJ0ZWQgaW50byB0aGUgSW50ZXJ2YWxUcmVlIGNhY2hlXG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBzZWxmLnR5cGUoJ2JhbScpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZSwgcGlsZXVwOiB7fSwgaW5mbzoge319O1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMjQsIHN0YXJ0OiAyNH07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgc2VsZi5ub0FyZWFMYWJlbHMgPSB0cnVlO1xuICAgIHNlbGYuZXhwZWN0c1NlcXVlbmNlID0gdHJ1ZTtcbiAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzID0ge307XG4gICAgc2VsZi5jb3ZlcmFnZVJhbmdlID0gWzAsIDBdO1xuICAgIHNlbGYucHJldk9wdHMgPSBkZWVwQ2xvbmUobyk7ICAvLyB1c2VkIHRvIGRldGVjdCB3aGljaCBkcmF3aW5nIG9wdGlvbnMgaGF2ZSBiZWVuIGNoYW5nZWQgYnkgdGhlIHVzZXJcbiAgICBcbiAgICAvLyBHZXQgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiYW0gKGUuZy4gYHNhbXRvb2xzIGlkeHN0YXRzYCksIHVzZSBtYXBwZWQgcmVhZHMgcGVyIHJlZmVyZW5jZSBzZXF1ZW5jZVxuICAgIC8vIHRvIGVzdGltYXRlIG1heEZldGNoV2luZG93IGFuZCBvcHRpbWFsRmV0Y2hXaW5kb3csIGFuZCBzZXR1cCBiaW5uaW5nIG9uIHRoZSBSZW1vdGVUcmFjay5cbiAgICAvLyBXZSBhbHNvIGZldGNoIGEgYnVuY2ggb2YgcmVhZHMgZnJvbSBhcm91bmQgaW5mb0NoclJhbmdlIChieSBkZWZhdWx0LCB3aGVyZSB0aGUgYnJvd3NlciBpcyB3aGVuXG4gICAgLy8gaXQgZmlyc3QgbG9hZHMgdGhpcyB0cmFjaykgdG8gZXN0aW1hdGUgbWVhbkl0ZW1MZW5ndGgsIG1hdGUgcGFpcmluZywgYW5kIHRoZSBpbnNlcnQgc2l6ZSBkaXN0cmlidXRpb24uXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCByYW5nZTogaW5mb0NoclJhbmdlLCB1cmw6IG8uYmlnRGF0YVVybH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciBtYXBwZWRSZWFkcyA9IDAsXG4gICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhvLmRyYXdMaW1pdCkpLFxuICAgICAgICAgIGJhbUNocnMgPSBbXSxcbiAgICAgICAgICBpbmZvUGFydHMgPSBkYXRhLnNwbGl0KFwiXFxuXFxuXCIpLFxuICAgICAgICAgIGVzdGltYXRlZEluc2VydFNpemVzID0gW10sXG4gICAgICAgICAgcGN0aWxlcyA9IG8uZXhwZWN0ZWRJbnNlcnRTaXplUGVyY2VudGlsZXMsXG4gICAgICAgICAgbG93ZXJCb3VuZCA9IDEwLCBcbiAgICAgICAgICB1cHBlckJvdW5kID0gNTAwMCwgXG4gICAgICAgICAgc2FtcGxlSW50ZXJ2YWxzLCBtZWFuSXRlbUxlbmd0aCwgaGFzQU1hdGVQYWlyLCBjaHJTY2hlbWUsIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBcbiAgICAgICAgaWYgKGluZm9QYXJ0c1swXSA9PSAnJykgeyB0aHJvdyBuZXcgRXJyb3IoXCJzYW10b29scyBmYWlsZWQgdG8gcmV0cmlldmUgZGF0YSBmb3IgdGhpcyBCQU0gdHJhY2suXCIpOyB9XG4gICAgICAgIF8uZWFjaChpbmZvUGFydHNbMF0uc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICB2YXIgZmllbGRzID0gbGluZS5zcGxpdChcIlxcdFwiKSxcbiAgICAgICAgICAgIHJlYWRzTWFwcGVkVG9Db250aWcgPSBwYXJzZUludChmaWVsZHNbMl0sIDEwKTtcbiAgICAgICAgICBpZiAoZmllbGRzLmxlbmd0aCA9PSAxICYmIGZpZWxkc1swXSA9PSAnJykgeyByZXR1cm47IH0gLy8gYmxhbmsgbGluZVxuICAgICAgICAgIGJhbUNocnMucHVzaChmaWVsZHNbMF0pO1xuICAgICAgICAgIGlmIChfLmlzTmFOKHJlYWRzTWFwcGVkVG9Db250aWcpKSB7IHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgb3V0cHV0IGZvciBzYW10b29scyBpZHhzdGF0cyBvbiB0aGlzIEJBTSB0cmFjay5cIik7IH1cbiAgICAgICAgICBtYXBwZWRSZWFkcyArPSByZWFkc01hcHBlZFRvQ29udGlnO1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLmNoclNjaGVtZSA9IGNoclNjaGVtZSA9IHNlbGYudHlwZShcImJhbVwiKS5ndWVzc0NoclNjaGVtZShiYW1DaHJzKTtcbiAgICAgICAgaWYgKGNoclNjaGVtZSAmJiBzZWxmLmJyb3dzZXJDaHJTY2hlbWUpIHtcbiAgICAgICAgICBzZWxmLmRhdGEuaW5mby5jb252ZXJ0Q2hyU2NoZW1lID0gY2hyU2NoZW1lICE9IHNlbGYuYnJvd3NlckNoclNjaGVtZSA/IGNoclNjaGVtZSArICdfJyArIHNlbGYuYnJvd3NlckNoclNjaGVtZSA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHNhbXBsZUludGVydmFscyA9IF8uY29tcGFjdChfLm1hcChpbmZvUGFydHNbMV0uc3BsaXQoXCJcXG5cIiksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICByZXR1cm4gc2VsZi50eXBlKCdiYW0nKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsaW5lKTtcbiAgICAgICAgfSkpO1xuICAgICAgICBpZiAoc2FtcGxlSW50ZXJ2YWxzLmxlbmd0aCkge1xuICAgICAgICAgIG1lYW5JdGVtTGVuZ3RoID0gXy5yZWR1Y2Uoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihtZW1vLCBuZXh0KSB7IHJldHVybiBtZW1vICsgKG5leHQuZW5kIC0gbmV4dC5zdGFydCk7IH0sIDApO1xuICAgICAgICAgIG1lYW5JdGVtTGVuZ3RoID0gTWF0aC5yb3VuZChtZWFuSXRlbUxlbmd0aCAvIHNhbXBsZUludGVydmFscy5sZW5ndGgpO1xuICAgICAgICAgIGhhc0FNYXRlUGFpciA9IF8uc29tZShzYW1wbGVJbnRlcnZhbHMsIGZ1bmN0aW9uKGl0dmwpIHsgXG4gICAgICAgICAgICByZXR1cm4gaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciB8fCBpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXI7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMgPSBfLmNvbXBhY3QoXy5tYXAoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihpdHZsKSB7IFxuICAgICAgICAgICAgcmV0dXJuIGl0dmwudGxlbiA/IE1hdGguYWJzKGl0dmwudGxlbikgOiAwOyBcbiAgICAgICAgICB9KSk7XG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMuc29ydChmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhIC0gYjsgfSk7ICAvLyBOT1RFOiBKYXZhU2NyaXB0IGRvZXMgc3RyaW5nIHNvcnRpbmcgYnkgZGVmYXVsdCAtXy1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgPSBtZWFuSXRlbXNQZXJCcCA9IG1hcHBlZFJlYWRzIC8gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplO1xuICAgICAgICBzZWxmLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCA9IG1lYW5JdGVtTGVuZ3RoID0gXy5pc1VuZGVmaW5lZChtZWFuSXRlbUxlbmd0aCkgPyAxMDAgOiBtZWFuSXRlbUxlbmd0aDtcbiAgICAgICAgaWYgKCFvLm9wdGltYWxGZXRjaFdpbmRvdyB8fCAhby5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgICAgIG8ub3B0aW1hbEZldGNoV2luZG93ID0gTWF0aC5mbG9vcihtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwIC8gKE1hdGgubWF4KG1lYW5JdGVtTGVuZ3RoLCAxMDApIC8gMTAwKSAqIDAuNSk7XG4gICAgICAgICAgby5tYXhGZXRjaFdpbmRvdyA9IG8ub3B0aW1hbEZldGNoV2luZG93ICogMjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXNlbGYuY292ZXJhZ2VSYW5nZVsxXSkgeyBzZWxmLmNvdmVyYWdlUmFuZ2VbMV0gPSBNYXRoLmNlaWwobWVhbkl0ZW1zUGVyQnAgKiBtZWFuSXRlbUxlbmd0aCAqIDIpOyB9XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuYXBwbHlPcHRzLmNhbGwoc2VsZik7XG4gICAgICAgIFxuICAgICAgICAvLyBJZiB0aGVyZSBpcyBwYWlyaW5nLCB3ZSBuZWVkIHRvIHRlbGwgdGhlIFBhaXJlZEludGVydmFsVHJlZSB3aGF0IHJhbmdlIG9mIGluc2VydCBzaXplcyBzaG91bGQgdHJpZ2dlciBwYWlyaW5nLlxuICAgICAgICBpZiAoaGFzQU1hdGVQYWlyKSB7XG4gICAgICAgICAgaWYgKGVzdGltYXRlZEluc2VydFNpemVzLmxlbmd0aCkge1xuICAgICAgICAgICAgbG93ZXJCb3VuZCA9IGVzdGltYXRlZEluc2VydFNpemVzW01hdGguZmxvb3IoZXN0aW1hdGVkSW5zZXJ0U2l6ZXMubGVuZ3RoICogcGN0aWxlc1swXSldO1xuICAgICAgICAgICAgdXBwZXJCb3VuZCA9IGVzdGltYXRlZEluc2VydFNpemVzW01hdGguZmxvb3IoZXN0aW1hdGVkSW5zZXJ0U2l6ZXMubGVuZ3RoICogcGN0aWxlc1sxXSldO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZWxmLmRhdGEuY2FjaGUuc2V0UGFpcmluZ0ludGVydmFsKGxvd2VyQm91bmQsIHVwcGVyQm91bmQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIElmIHdlIGRvbid0IHNlZSBhbnkgcGFpcmVkIHJlYWRzIGluIHRoaXMgQkFNLCBkZWFjdGl2YXRlIHRoZSBwYWlyaW5nIGZ1bmN0aW9uYWxpdHkgb2YgdGhlIFBhaXJlZEludGVydmFsVHJlZSBcbiAgICAgICAgICBzZWxmLmRhdGEuY2FjaGUuZGlzYWJsZVBhaXJpbmcoKTtcbiAgICAgICAgfVxuICAgICAgICByZW1vdGUuc2V0dXBCaW5zKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSwgby5vcHRpbWFsRmV0Y2hXaW5kb3csIG8ubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmZsYWdzWy4uLl0gdG8gYSBodW1hbiBpbnRlcnByZXRhYmxlIHZlcnNpb24gb2YgZmVhdHVyZS5mbGFnIChleHBhbmRpbmcgdGhlIGJpdHdpc2UgZmxhZ3MpXG4gIHBhcnNlRmxhZ3M6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykge1xuICAgIGZlYXR1cmUuZmxhZ3MgPSB7fTtcbiAgICBfLmVhY2godGhpcy50eXBlKCdiYW0nKS5mbGFncywgZnVuY3Rpb24oYml0LCBmbGFnKSB7XG4gICAgICBmZWF0dXJlLmZsYWdzW2ZsYWddID0gISEoZmVhdHVyZS5mbGFnICYgYml0KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5ibG9ja3MgYW5kIGZlYXR1cmUuZW5kIGJhc2VkIG9uIGZlYXR1cmUuY2lnYXJcbiAgLy8gU2VlIHNlY3Rpb24gMS40IG9mIGh0dHBzOi8vc2FtdG9vbHMuZ2l0aHViLmlvL2h0cy1zcGVjcy9TQU12MS5wZGYgZm9yIGFuIGV4cGxhbmF0aW9uIG9mIENJR0FSIFxuICBwYXJzZUNpZ2FyOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHsgICAgICAgIFxuICAgIHZhciBjaWdhciA9IGZlYXR1cmUuY2lnYXIsXG4gICAgICBzZXEgPSAoIWZlYXR1cmUuc2VxIHx8IGZlYXR1cmUuc2VxID09ICcqJykgPyBcIlwiIDogZmVhdHVyZS5zZXEsXG4gICAgICByZWZMZW4gPSAwLFxuICAgICAgc2VxUG9zID0gMCxcbiAgICAgIG9wZXJhdGlvbnMsIGxlbmd0aHM7XG4gICAgXG4gICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICBmZWF0dXJlLmluc2VydGlvbnMgPSBbXTtcbiAgICBcbiAgICBvcHMgPSBjaWdhci5zcGxpdCgvXFxkKy8pLnNsaWNlKDEpO1xuICAgIGxlbmd0aHMgPSBjaWdhci5zcGxpdCgvW0EtWj1dLykuc2xpY2UoMCwgLTEpO1xuICAgIGlmIChvcHMubGVuZ3RoICE9IGxlbmd0aHMubGVuZ3RoKSB7IHRoaXMud2FybihcIkludmFsaWQgQ0lHQVIgJ1wiICsgY2lnYXIgKyBcIicgZm9yIFwiICsgZmVhdHVyZS5kZXNjKTsgcmV0dXJuOyB9XG4gICAgbGVuZ3RocyA9IF8ubWFwKGxlbmd0aHMsIHBhcnNlSW50MTApO1xuICAgIFxuICAgIF8uZWFjaChvcHMsIGZ1bmN0aW9uKG9wLCBpKSB7XG4gICAgICB2YXIgbGVuID0gbGVuZ3Roc1tpXSxcbiAgICAgICAgYmxvY2ssIGluc2VydGlvbjtcbiAgICAgIGlmICgvXltNWD1dJC8udGVzdChvcCkpIHtcbiAgICAgICAgLy8gQWxpZ25tZW50IG1hdGNoLCBzZXF1ZW5jZSBtYXRjaCwgc2VxdWVuY2UgbWlzbWF0Y2hcbiAgICAgICAgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIGxlbjtcbiAgICAgICAgYmxvY2sudHlwZSA9IG9wO1xuICAgICAgICBibG9jay5zZXEgPSBzZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgcmVmTGVuICs9IGxlbjtcbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAoL15bTkRdJC8udGVzdChvcCkpIHtcbiAgICAgICAgLy8gU2tpcHBlZCByZWZlcmVuY2UgcmVnaW9uLCBkZWxldGlvbiBmcm9tIHJlZmVyZW5jZVxuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnSScpIHtcbiAgICAgICAgLy8gSW5zZXJ0aW9uXG4gICAgICAgIGluc2VydGlvbiA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHJlZkxlbiwgZW5kOiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVufTtcbiAgICAgICAgaW5zZXJ0aW9uLnNlcSA9IHNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuaW5zZXJ0aW9ucy5wdXNoKGluc2VydGlvbik7XG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdTJykge1xuICAgICAgICAvLyBTb2Z0IGNsaXBwaW5nOyBzaW1wbHkgc2tpcCB0aGVzZSBiYXNlcyBpbiBTRVEsIHBvc2l0aW9uIG9uIHJlZmVyZW5jZSBpcyB1bmNoYW5nZWQuXG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9XG4gICAgICAvLyBUaGUgb3RoZXIgdHdvIENJR0FSIG9wcywgSCBhbmQgUCwgYXJlIG5vdCByZWxldmFudCB0byBkcmF3aW5nIGFsaWdubWVudHMuXG4gICAgfSk7XG4gICAgXG4gICAgZmVhdHVyZS5lbmQgPSBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuO1xuICB9LFxuICBcbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbHMgPSBbJ3FuYW1lJywgJ2ZsYWcnLCAncm5hbWUnLCAncG9zJywgJ21hcHEnLCAnY2lnYXInLCAncm5leHQnLCAncG5leHQnLCAndGxlbicsICdzZXEnLCAncXVhbCddLFxuICAgICAgZmVhdHVyZSA9IHt9LFxuICAgICAgZmllbGRzID0gbGluZS5zcGxpdChcIlxcdFwiKSxcbiAgICAgIGF2YWlsRmxhZ3MgPSB0aGlzLnR5cGUoJ2JhbScpLmZsYWdzLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIF8uZWFjaChfLmZpcnN0KGZpZWxkcywgY29scy5sZW5ndGgpLCBmdW5jdGlvbih2LCBpKSB7IGZlYXR1cmVbY29sc1tpXV0gPSB2OyB9KTtcbiAgICAvLyBDb252ZXJ0IGF1dG9tYXRpY2FsbHkgYmV0d2VlbiBFbnNlbWJsIHN0eWxlIDEsIDIsIDMsIFggPC0tPiBVQ1NDIHN0eWxlIGNocjEsIGNocjIsIGNocjMsIGNoclggYXMgY29uZmlndXJlZC9hdXRvZGV0ZWN0ZWRcbiAgICAvLyBOb3RlIHRoYXQgY2hyTSBpcyBOT1QgZXF1aXZhbGVudCB0byBNVCBodHRwczovL3d3dy5iaW9zdGFycy5vcmcvcC8xMjAwNDIvIzEyMDA1OFxuICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lID09IFwiYXV0b1wiID8gdGhpcy5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA6IG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogZmVhdHVyZS5ybmFtZSA9IGZlYXR1cmUucm5hbWUucmVwbGFjZSgvXmNoci8sICcnKTsgYnJlYWs7XG4gICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiBmZWF0dXJlLnJuYW1lID0gKC9eKFxcZFxcZD98WCkkLy50ZXN0KGZlYXR1cmUucm5hbWUpID8gJ2NocicgOiAnJykgKyBmZWF0dXJlLnJuYW1lOyBicmVhaztcbiAgICB9XG4gICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5xbmFtZTtcbiAgICBmZWF0dXJlLmZsYWcgPSBwYXJzZUludDEwKGZlYXR1cmUuZmxhZyk7XG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbZmVhdHVyZS5ybmFtZV07XG4gICAgbGluZW5vID0gbGluZW5vIHx8IDA7XG4gICAgXG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBSTkFNRSAnXCIrZmVhdHVyZS5ybmFtZStcIicgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSBpZiAoZmVhdHVyZS5wb3MgPT09ICcwJyB8fCAhZmVhdHVyZS5jaWdhciB8fCBmZWF0dXJlLmNpZ2FyID09ICcqJyB8fCBmZWF0dXJlLmZsYWcgJiBhdmFpbEZsYWdzLmlzUmVhZFVubWFwcGVkKSB7XG4gICAgICAvLyBVbm1hcHBlZCByZWFkLiBTaW5jZSB3ZSBjYW4ndCBkcmF3IHRoZXNlIGF0IGFsbCwgd2UgZG9uJ3QgYm90aGVyIHBhcnNpbmcgdGhlbSBmdXJ0aGVyLlxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZlYXR1cmUuc2NvcmUgPSBfLmlzVW5kZWZpbmVkKGZlYXR1cmUuc2NvcmUpID8gJz8nIDogZmVhdHVyZS5zY29yZTtcbiAgICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUucG9zKTsgICAgICAgIC8vIFBPUyBpcyAxLWJhc2VkLCBoZW5jZSBubyBpbmNyZW1lbnQgYXMgZm9yIHBhcnNpbmcgQkVEXG4gICAgICBmZWF0dXJlLmRlc2MgPSBmZWF0dXJlLnFuYW1lICsgJyBhdCAnICsgZmVhdHVyZS5ybmFtZSArICc6JyArIGZlYXR1cmUucG9zO1xuICAgICAgZmVhdHVyZS50bGVuID0gcGFyc2VJbnQxMChmZWF0dXJlLnRsZW4pO1xuICAgICAgdGhpcy50eXBlKCdiYW0nKS5wYXJzZUZsYWdzLmNhbGwodGhpcywgZmVhdHVyZSwgbGluZW5vKTtcbiAgICAgIGZlYXR1cmUuc3RyYW5kID0gZmVhdHVyZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/ICctJyA6ICcrJztcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VDaWdhci5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7IC8vIFRoaXMgYWxzbyBzZXRzIC5lbmQgYXBwcm9wcmlhdGVseVxuICAgIH1cbiAgICAvLyBXZSBoYXZlIHRvIGNvbWUgdXAgd2l0aCBzb21ldGhpbmcgdGhhdCBpcyBhIHVuaXF1ZSBsYWJlbCBmb3IgZXZlcnkgbGluZSB0byBkZWR1cGUgcm93cy5cbiAgICAvLyBUaGUgZm9sbG93aW5nIGlzIHRlY2huaWNhbGx5IG5vdCBndWFyYW50ZWVkIGJ5IGEgdmFsaWQgQkFNIChldmVuIGF0IEdBVEsgc3RhbmRhcmRzKSwgYnV0IGl0J3MgdGhlIGJlc3QgSSBnb3QuXG4gICAgZmVhdHVyZS5pZCA9IFtmZWF0dXJlLnFuYW1lLCBmZWF0dXJlLmZsYWcsIGZlYXR1cmUucm5hbWUsIGZlYXR1cmUucG9zLCBmZWF0dXJlLmNpZ2FyXS5qb2luKFwiXFx0XCIpO1xuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuICBcbiAgcGlsZXVwOiBmdW5jdGlvbihpbnRlcnZhbHMsIHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgcGlsZXVwID0gdGhpcy5kYXRhLnBpbGV1cCxcbiAgICAgIHBvc2l0aW9uc1RvQ2FsY3VsYXRlID0ge30sXG4gICAgICBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9IDAsXG4gICAgICBpO1xuICAgIFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIC8vIE5vIG5lZWQgdG8gcGlsZXVwIGFnYWluIG9uIGFscmVhZHktcGlsZWQtdXAgbnVjbGVvdGlkZSBwb3NpdGlvbnNcbiAgICAgIGlmICghcGlsZXVwW2ldKSB7IHBvc2l0aW9uc1RvQ2FsY3VsYXRlW2ldID0gdHJ1ZTsgbnVtUG9zaXRpb25zVG9DYWxjdWxhdGUrKzsgfVxuICAgIH1cbiAgICBpZiAobnVtUG9zaXRpb25zVG9DYWxjdWxhdGUgPT09IDApIHsgcmV0dXJuOyB9IC8vIEFsbCBwb3NpdGlvbnMgYWxyZWFkeSBwaWxlZCB1cCFcbiAgICBcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgdmFyIGJsb2NrU2V0cyA9IFtpbnRlcnZhbC5kYXRhLmJsb2Nrc107XG4gICAgICBpZiAoaW50ZXJ2YWwuZGF0YS5kcmF3QXNNYXRlcyAmJiBpbnRlcnZhbC5kYXRhLm1hdGUpIHsgYmxvY2tTZXRzLnB1c2goaW50ZXJ2YWwuZGF0YS5tYXRlLmJsb2Nrcyk7IH1cbiAgICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2Nrcykge1xuICAgICAgICBfLmVhY2goYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICAgIHZhciBudCwgaTtcbiAgICAgICAgICBmb3IgKGkgPSBNYXRoLm1heChibG9jay5zdGFydCwgc3RhcnQpOyBpIDwgTWF0aC5taW4oYmxvY2suZW5kLCBlbmQpOyBpKyspIHtcbiAgICAgICAgICAgIGlmICghcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0pIHsgY29udGludWU7IH1cbiAgICAgICAgICAgIG50ID0gKGJsb2NrLnNlcVtpIC0gYmxvY2suc3RhcnRdIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgcGlsZXVwW2ldID0gcGlsZXVwW2ldIHx8IHtBOiAwLCBDOiAwLCBHOiAwLCBUOiAwLCBOOiAwLCBjb3Y6IDB9O1xuICAgICAgICAgICAgcGlsZXVwW2ldWygvW0FDVEddLykudGVzdChudCkgPyBudCA6ICdOJ10gKz0gMTtcbiAgICAgICAgICAgIHBpbGV1cFtpXS5jb3YgKz0gMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBjb3ZlcmFnZTogZnVuY3Rpb24oc3RhcnQsIHdpZHRoLCBicHBwKSB7XG4gICAgLy8gQ29tcGFyZSB3aXRoIGJpbm5pbmcgb24gdGhlIGZseSBpbiAudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIoLi4uKVxuICAgIHZhciBqID0gc3RhcnQsXG4gICAgICBjdXJyID0gdGhpcy5kYXRhLnBpbGV1cFtqXSxcbiAgICAgIGJhcnMgPSBbXSxcbiAgICAgIG5leHQsIGJpbiwgaTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgICAgYmluID0gY3VyciAmJiAoaiArIDEgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci5jb3ZdIDogW107XG4gICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB3aGlsZSAoaiArIDEgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIGogKyAyID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgIGlmIChuZXh0KSB7IGJpbi5wdXNoKG5leHQuY292KTsgfVxuICAgICAgICArK2o7XG4gICAgICAgIGN1cnIgPSBuZXh0O1xuICAgICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB9XG4gICAgICBiYXJzLnB1c2godXRpbHMud2lnQmluRnVuY3Rpb25zLm1heGltdW0oYmluKSk7XG4gICAgfVxuICAgIHJldHVybiBiYXJzO1xuICB9LFxuICBcbiAgYWxsZWxlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICBhbGxlbGVGcmVxVGhyZXNob2xkID0gdGhpcy5vcHRzLmFsbGVsZUZyZXFUaHJlc2hvbGQsXG4gICAgICBhbGxlbGVTcGxpdHMgPSBbXSxcbiAgICAgIHNwbGl0LCByZWZOdCwgaSwgcGlsZTtcbiAgICAgIFxuICAgIGZvciAoaSA9IDA7IGkgPCBzZXF1ZW5jZS5sZW5ndGg7IGkrKykge1xuICAgICAgcmVmTnQgPSBzZXF1ZW5jZVtpXS50b1VwcGVyQ2FzZSgpO1xuICAgICAgcGlsZSA9IHBpbGV1cFtzdGFydCArIGldO1xuICAgICAgaWYgKHBpbGUgJiYgcGlsZS5jb3YgJiYgcGlsZVtyZWZOdF0gLyAocGlsZS5jb3YgLSBwaWxlLk4pIDwgKDEgLSBhbGxlbGVGcmVxVGhyZXNob2xkKSkge1xuICAgICAgICBzcGxpdCA9IHtcbiAgICAgICAgICB4OiBpIC8gYnBwcCxcbiAgICAgICAgICBzcGxpdHM6IFtdXG4gICAgICAgIH07XG4gICAgICAgIF8uZWFjaChbJ0EnLCAnQycsICdHJywgJ1QnXSwgZnVuY3Rpb24obnQpIHtcbiAgICAgICAgICBpZiAocGlsZVtudF0gPiAwKSB7IHNwbGl0LnNwbGl0cy5wdXNoKHtudDogbnQsIGg6IHBpbGVbbnRdfSk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGFsbGVsZVNwbGl0cy5wdXNoKHNwbGl0KTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGFsbGVsZVNwbGl0cztcbiAgfSxcbiAgXG4gIG1pc21hdGNoZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSwgdmlld0FzUGFpcnMpIHtcbiAgICB2YXIgbWlzbWF0Y2hlcyA9IFtdLFxuICAgICAgdmlld0FzUGFpcnMgPSB0aGlzLm9wdHMudmlld0FzUGFpcnM7XG4gICAgc2VxdWVuY2UgPSBzZXF1ZW5jZS50b1VwcGVyQ2FzZSgpO1xuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmICh2aWV3QXNQYWlycyAmJiBpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBcbiAgICAgICAgYmxvY2tTZXRzLnB1c2goaW50ZXJ2YWwuZGF0YS5tYXRlLmJsb2Nrcyk7XG4gICAgICB9XG4gICAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja3MpIHtcbiAgICAgICAgXy5lYWNoKGJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgICB2YXIgbGluZSA9IGxpbmVOdW0oaW50ZXJ2YWwuZGF0YSksXG4gICAgICAgICAgICBudCwgaSwgeDtcbiAgICAgICAgICBmb3IgKGkgPSBNYXRoLm1heChibG9jay5zdGFydCwgc3RhcnQpOyBpIDwgTWF0aC5taW4oYmxvY2suZW5kLCBzdGFydCArIHdpZHRoICogYnBwcCk7IGkrKykge1xuICAgICAgICAgICAgeCA9IChpIC0gc3RhcnQpIC8gYnBwcDtcbiAgICAgICAgICAgIG50ID0gKGJsb2NrLnNlcVtpIC0gYmxvY2suc3RhcnRdIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICAgICAgaWYgKG50ICYmIG50ICE9IHNlcXVlbmNlW2kgLSBzdGFydF0gJiYgbGluZSkgeyBtaXNtYXRjaGVzLnB1c2goe3g6IHgsIG50OiBudCwgbGluZTogbGluZX0pOyB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBtaXNtYXRjaGVzO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBzZXF1ZW5jZSA9IHByZWNhbGMuc2VxdWVuY2UsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgdmlld0FzUGFpcnMgPSBzZWxmLm9wdHMudmlld0FzUGFpcnMsXG4gICAgICBzdGFydEtleSA9IHZpZXdBc1BhaXJzID8gJ3RlbXBsYXRlU3RhcnQnIDogJ3N0YXJ0JyxcbiAgICAgIGVuZEtleSA9IHZpZXdBc1BhaXJzID8gJ3RlbXBsYXRlRW5kJyA6ICdlbmQnLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aDtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHkgKyAnXycgKyAodmlld0FzUGFpcnMgPyAncCcgOiAndScpO1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldFRvKSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldFRvKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIGFuIGluc2FuZSBhbW91bnQgb2Ygcm93cyBcbiAgICAvLyAoPjUwMCBhbGlnbm1lbnRzKSwgYXMgdGhpcyB3aWxsIG9ubHkgaG9sZCB1cCBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoc2VsZi5vcHRzLm1heEZldGNoV2luZG93ICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZldGNoIGZyb20gdGhlIFJlbW90ZVRyYWNrIGFuZCBjYWxsIHRoZSBhYm92ZSB3aGVuIHRoZSBkYXRhIGlzIGF2YWlsYWJsZS5cbiAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCB2aWV3QXNQYWlycywgZnVuY3Rpb24oaW50ZXJ2YWxzKSB7XG4gICAgICAgIHZhciBkcmF3U3BlYyA9IHtzZXF1ZW5jZTogISFzZXF1ZW5jZSwgd2lkdGg6IHdpZHRofSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWxNYXRlZCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCA0LCBmYWxzZSwgc3RhcnRLZXksIGVuZEtleSksXG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIDQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG5cbiAgICAgICAgaWYgKCFzZXF1ZW5jZSkge1xuICAgICAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLnBpbGV1cC5jYWxsKHNlbGYsIGludGVydmFscywgc3RhcnQsIGVuZCk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsTWF0ZWQsIGxpbmVOdW0pO1xuICAgICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICAgICAgICAgIGludGVydmFsLmluc2VydGlvblB0cyA9IF8ubWFwKGludGVydmFsLmQuaW5zZXJ0aW9ucywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgaWYgKCF2aWV3QXNQYWlycykgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgaWYgKGludGVydmFsLmQuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZC5tYXRlKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBfLm1hcChbaW50ZXJ2YWwuZCwgaW50ZXJ2YWwuZC5tYXRlXSwgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlQmxvY2tJbnRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmJsb2NrcywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmluc2VydGlvblB0cywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChpbnRlcnZhbC5kLm1hdGVFeHBlY3RlZCkge1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnRzID0gW2NhbGNQaXhJbnRlcnZhbChpbnRlcnZhbCldO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBbXTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gW107XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGRyYXdTcGVjLmNvdmVyYWdlID0gc2VsZi50eXBlKCdiYW0nKS5jb3ZlcmFnZS5jYWxsKHNlbGYsIHN0YXJ0LCB3aWR0aCwgYnBwcCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2Vjb25kIGRyYXdpbmcgcGFzcywgdG8gZHJhdyB0aGluZ3MgdGhhdCBhcmUgZGVwZW5kZW50IG9uIHNlcXVlbmNlLCBsaWtlIG1pc21hdGNoZXMgKHBvdGVudGlhbCBTTlBzKS5cbiAgICAgICAgICBkcmF3U3BlYy5icHBwID0gYnBwcDsgIFxuICAgICAgICAgIC8vIEZpbmQgYWxsZWxlIHNwbGl0cyB3aXRoaW4gdGhlIGNvdmVyYWdlIGdyYXBoLlxuICAgICAgICAgIGRyYXdTcGVjLmFsbGVsZXMgPSBzZWxmLnR5cGUoJ2JhbScpLmFsbGVsZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHApO1xuICAgICAgICAgIC8vIEZpbmQgbWlzbWF0Y2hlcyB3aXRoaW4gZWFjaCBhbGlnbmVkIGJsb2NrLlxuICAgICAgICAgIGRyYXdTcGVjLm1pc21hdGNoZXMgPSBzZWxmLnR5cGUoJ2JhbScpLm1pc21hdGNoZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIFxuICAvLyBzcGVjaWFsIGZvcm1hdHRlciBmb3IgY29udGVudCBpbiB0b29sdGlwcyBmb3IgZmVhdHVyZXNcbiAgdGlwVGlwRGF0YTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29udGVudCA9IHt9LFxuICAgICAgZmlyc3RNYXRlID0gZGF0YS5kLFxuICAgICAgc2Vjb25kTWF0ZSA9IGRhdGEuZC5tYXRlLFxuICAgICAgbWF0ZUhlYWRlcnMgPSBbXCJ0aGlzIGFsaWdubWVudFwiLCBcIm1hdGUgcGFpciBhbGlnbm1lbnRcIl0sXG4gICAgICBsZWZ0TWF0ZSwgcmlnaHRNYXRlLCBwYWlyT3JpZW50YXRpb247XG4gICAgZnVuY3Rpb24geWVzTm8oYm9vbCkgeyByZXR1cm4gYm9vbCA/IFwieWVzXCIgOiBcIm5vXCI7IH1cbiAgICBmdW5jdGlvbiBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgc2VnLCBwcmVmaXgpIHtcbiAgICAgIHZhciBjaWdhckFiYnJldiA9IHNlZy5jaWdhciAmJiBzZWcuY2lnYXIubGVuZ3RoID4gMjUgPyBzZWcuY2lnYXIuc3Vic3RyKDAsIDI0KSArICcuLi4nIDogc2VnLmNpZ2FyO1xuICAgICAgcHJlZml4ID0gcHJlZml4IHx8IFwiXCI7XG4gICAgICBcbiAgICAgIF8uZWFjaCh7XG4gICAgICAgIFwicG9zaXRpb25cIjogc2VnLnJuYW1lICsgJzonICsgc2VnLnBvcyxcbiAgICAgICAgXCJjaWdhclwiOiBjaWdhckFiYnJldixcbiAgICAgICAgXCJyZWFkIHN0cmFuZFwiOiBzZWcuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnKC0pJyA6ICcoKyknLFxuICAgICAgICBcIm1hcHBlZFwiOiB5ZXNObyghc2VnLmZsYWdzLmlzUmVhZFVubWFwcGVkKSxcbiAgICAgICAgXCJtYXAgcXVhbGl0eVwiOiBzZWcubWFwcSxcbiAgICAgICAgXCJzZWNvbmRhcnlcIjogeWVzTm8oc2VnLmZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50KSxcbiAgICAgICAgXCJzdXBwbGVtZW50YXJ5XCI6IHllc05vKHNlZy5mbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcImR1cGxpY2F0ZVwiOiB5ZXNObyhzZWcuZmxhZ3MuaXNEdXBsaWNhdGVSZWFkKSxcbiAgICAgICAgXCJmYWlsZWQgUUNcIjogeWVzTm8oc2VnLmZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQylcbiAgICAgIH0sIGZ1bmN0aW9uKHYsIGspIHsgY29udGVudFtwcmVmaXggKyBrXSA9IHY7IH0pO1xuICAgIH1cbiAgICBcbiAgICBpZiAoZGF0YS5kLm1hdGUgJiYgZGF0YS5kLm1hdGUuZmxhZ3MpIHtcbiAgICAgIGxlZnRNYXRlID0gZGF0YS5kLnN0YXJ0IDwgZGF0YS5kLm1hdGUuc3RhcnQgPyBkYXRhLmQgOiBkYXRhLmQubWF0ZTtcbiAgICAgIHJpZ2h0TWF0ZSA9IGRhdGEuZC5zdGFydCA8IGRhdGEuZC5tYXRlLnN0YXJ0ID8gZGF0YS5kLm1hdGUgOiBkYXRhLmQ7XG4gICAgICBwYWlyT3JpZW50YXRpb24gPSAobGVmdE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyBcIlJcIiA6IFwiRlwiKSArIChsZWZ0TWF0ZS5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciA/IFwiMVwiIDogXCIyXCIpO1xuICAgICAgcGFpck9yaWVudGF0aW9uICs9IChyaWdodE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyBcIlJcIiA6IFwiRlwiKSArIChyaWdodE1hdGUuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpciA/IFwiMlwiIDogXCIxXCIpO1xuICAgIH1cbiAgICBcbiAgICBpZiAoby52aWV3QXNQYWlycyAmJiBkYXRhLmQuZHJhd0FzTWF0ZXMgJiYgZGF0YS5kLm1hdGUpIHtcbiAgICAgIGZpcnN0TWF0ZSA9IGxlZnRNYXRlO1xuICAgICAgc2Vjb25kTWF0ZSA9IHJpZ2h0TWF0ZTtcbiAgICAgIG1hdGVIZWFkZXJzID0gW1wibGVmdCBhbGlnbm1lbnRcIiwgXCJyaWdodCBhbGlnbm1lbnRcIl07XG4gICAgfVxuICAgIGlmIChzZWNvbmRNYXRlKSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmluc2VydFNpemUpKSB7IGNvbnRlbnRbXCJpbnNlcnQgc2l6ZVwiXSA9IGRhdGEuZC5pbnNlcnRTaXplOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQocGFpck9yaWVudGF0aW9uKSkgeyBjb250ZW50W1wicGFpciBvcmllbnRhdGlvblwiXSA9IHBhaXJPcmllbnRhdGlvbjsgfVxuICAgICAgY29udGVudFttYXRlSGVhZGVyc1swXV0gPSBcIi0tLVwiO1xuICAgICAgYWRkQWxpZ25lZFNlZ21lbnRJbmZvKGNvbnRlbnQsIGZpcnN0TWF0ZSk7XG4gICAgICBjb250ZW50W21hdGVIZWFkZXJzWzFdXSA9IFwiLS0tXCI7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgc2Vjb25kTWF0ZSwgXCIgXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgZGF0YS5kKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI2NvdmVyYWdlIGZvciBhbiBpZGVhIG9mIHdoYXQgd2UncmUgaW1pdGF0aW5nXG4gIGRyYXdDb3ZlcmFnZTogZnVuY3Rpb24oY3R4LCBjb3ZlcmFnZSwgaGVpZ2h0KSB7XG4gICAgdmFyIHZTY2FsZSA9IHRoaXMuZHJhd1JhbmdlWzFdO1xuICAgIF8uZWFjaChjb3ZlcmFnZSwgZnVuY3Rpb24oZCwgeCkge1xuICAgICAgaWYgKGQgPT09IG51bGwpIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgaCA9IGQgKiBoZWlnaHQgLyB2U2NhbGU7XG4gICAgICBjdHguZmlsbFJlY3QoeCwgTWF0aC5tYXgoaGVpZ2h0IC0gaCwgMCksIDEsIE1hdGgubWluKGgsIGhlaWdodCkpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd1N0cmFuZEluZGljYXRvcjogZnVuY3Rpb24oY3R4LCB4LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCB4U2NhbGUsIGJpZ1N0eWxlKSB7XG4gICAgdmFyIHByZXZGaWxsU3R5bGUgPSBjdHguZmlsbFN0eWxlO1xuICAgIGlmIChiaWdTdHlsZSkge1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4Lm1vdmVUbyh4IC0gKDIgKiB4U2NhbGUpLCBibG9ja1kpO1xuICAgICAgY3R4LmxpbmVUbyh4ICsgKDMgKiB4U2NhbGUpLCBibG9ja1kgKyBibG9ja0hlaWdodC8yKTtcbiAgICAgIGN0eC5saW5lVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQpO1xuICAgICAgY3R4LmNsb3NlUGF0aCgpO1xuICAgICAgY3R4LmZpbGwoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMTQwLDE0MCwxNDApJztcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMiA6IDEpLCBibG9ja1ksIDEsIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5maWxsUmVjdCh4ICsgKHhTY2FsZSA+IDAgPyAtMSA6IDApLCBibG9ja1kgKyAxLCAxLCBibG9ja0hlaWdodCAtIDIpO1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IHByZXZGaWxsU3R5bGU7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd0FsaWdubWVudDogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGRyYXdNYXRlcyA9IGRhdGEubWF0ZUludHMsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgYmxvY2tZID0gaSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwLzIsXG4gICAgICBibG9ja0hlaWdodCA9IGxpbmVIZWlnaHQgLSBsaW5lR2FwLFxuICAgICAgZGVsZXRpb25MaW5lV2lkdGggPSAyLFxuICAgICAgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGggPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogbGluZUhlaWdodCkgLSBkZWxldGlvbkxpbmVXaWR0aCAqIDAuNSxcbiAgICAgIGJsb2NrU2V0cyA9IFt7YmxvY2tJbnRzOiBkYXRhLmJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQuc3RyYW5kfV07XG4gICAgXG4gICAgLy8gRm9yIG1hdGUgcGFpcnMsIHRoZSBmdWxsIHBpeGVsIGludGVydmFsIHJlcHJlc2VudHMgdGhlIGxpbmUgbGlua2luZyB0aGUgbWF0ZXNcbiAgICBpZiAoZHJhd01hdGVzKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIGhhbGZIZWlnaHQsIGRhdGEucEludC53LCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfVxuICAgIFxuICAgIC8vIERyYXcgdGhlIGxpbmVzIHRoYXQgc2hvdyB0aGUgZnVsbCBhbGlnbm1lbnQgZm9yIGVhY2ggc2VnbWVudCwgaW5jbHVkaW5nIGRlbGV0aW9uc1xuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSAncmdiKDAsMCwwKSc7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyB8fCBbZGF0YS5wSW50XSwgZnVuY3Rpb24ocEludCkge1xuICAgICAgaWYgKHBJbnQudyA8PSAwKSB7IHJldHVybjsgfVxuICAgICAgLy8gTm90ZSB0aGF0IHRoZSBcIi0gMVwiIGJlbG93IGZpeGVzIHJvdW5kaW5nIGlzc3VlcyBidXQgZ2FtYmxlcyBvbiB0aGVyZSBuZXZlciBiZWluZyBhIGRlbGV0aW9uIGF0IHRoZSByaWdodCBlZGdlXG4gICAgICBjdHguZmlsbFJlY3QocEludC54LCBpICogbGluZUhlaWdodCArIGhhbGZIZWlnaHQsIHBJbnQudyAtIDEsIGRlbGV0aW9uTGluZVdpZHRoKTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgXG4gICAgLy8gRHJhdyB0aGUgW21pc11tYXRjaCAoTS9YLz0pIGJsb2Nrc1xuICAgIGlmIChkcmF3TWF0ZXMgJiYgZGF0YS5kLm1hdGUpIHsgYmxvY2tTZXRzLnB1c2goe2Jsb2NrSW50czogZGF0YS5tYXRlQmxvY2tJbnRzLCBzdHJhbmQ6IGRhdGEuZC5tYXRlLnN0cmFuZH0pOyB9XG4gICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tTZXQpIHtcbiAgICAgIHZhciBzdHJhbmQgPSBibG9ja1NldC5zdHJhbmQ7XG4gICAgICBfLmVhY2goYmxvY2tTZXQuYmxvY2tJbnRzLCBmdW5jdGlvbihiSW50LCBibG9ja051bSkge1xuICAgICAgXG4gICAgICAgIC8vIFNraXAgZHJhd2luZyBibG9ja3MgdGhhdCBhcmVuJ3QgaW5zaWRlIHRoZSBjYW52YXNcbiAgICAgICAgaWYgKGJJbnQueCArIGJJbnQudyA8IDAgfHwgYkludC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICBcbiAgICAgICAgaWYgKGJsb2NrTnVtID09IDAgJiYgYmxvY2tTZXQuc3RyYW5kID09ICctJyAmJiAhYkludC5vUHJldikge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LnggKyAyLCBibG9ja1ksIGJJbnQudyAtIDIsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTdHJhbmRJbmRpY2F0b3IuY2FsbChzZWxmLCBjdHgsIGJJbnQueCwgYmxvY2tZLCBibG9ja0hlaWdodCwgLTEsIGxpbmVIZWlnaHQgPiA2KTtcbiAgICAgICAgfSBlbHNlIGlmIChibG9ja051bSA9PSBibG9ja1NldC5ibG9ja0ludHMubGVuZ3RoIC0gMSAmJiBibG9ja1NldC5zdHJhbmQgPT0gJysnICYmICFiSW50Lm9OZXh0KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LnggKyBiSW50LncsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIDEsIGxpbmVIZWlnaHQgPiA2KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCBibG9ja1ksIGJJbnQudywgYmxvY2tIZWlnaHQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBEcmF3IGluc2VydGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoMTE0LDQxLDIxOClcIjtcbiAgICBfLmVhY2goZHJhd01hdGVzID8gW2RhdGEuaW5zZXJ0aW9uUHRzLCBkYXRhLm1hdGVJbnNlcnRpb25QdHNdIDogW2RhdGEuaW5zZXJ0aW9uUHRzXSwgZnVuY3Rpb24oaW5zZXJ0aW9uUHRzKSB7XG4gICAgICBfLmVhY2goaW5zZXJ0aW9uUHRzLCBmdW5jdGlvbihpbnNlcnQpIHtcbiAgICAgICAgaWYgKGluc2VydC54ICsgaW5zZXJ0LncgPCAwIHx8IGluc2VydC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDEsIGkgKiBsaW5lSGVpZ2h0LCAyLCBsaW5lSGVpZ2h0KTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMiwgaSAqIGxpbmVIZWlnaHQsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMiwgKGkgKyAxKSAqIGxpbmVIZWlnaHQgLSBpbnNlcnRpb25DYXJldExpbmVXaWR0aCwgNCwgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3QWxsZWxlczogZnVuY3Rpb24oY3R4LCBhbGxlbGVzLCBoZWlnaHQsIGJhcldpZHRoKSB7XG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIHZTY2FsZSA9IHRoaXMuZHJhd1JhbmdlWzFdLFxuICAgICAgeVBvcztcbiAgICBfLmVhY2goYWxsZWxlcywgZnVuY3Rpb24oYWxsZWxlc0ZvclBvc2l0aW9uKSB7XG4gICAgICB5UG9zID0gaGVpZ2h0O1xuICAgICAgXy5lYWNoKGFsbGVsZXNGb3JQb3NpdGlvbi5zcGxpdHMsIGZ1bmN0aW9uKHNwbGl0KSB7XG4gICAgICAgIHZhciBoID0gc3BsaXQuaCAqIGhlaWdodCAvIHZTY2FsZTtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbc3BsaXQubnRdKycpJztcbiAgICAgICAgY3R4LmZpbGxSZWN0KGFsbGVsZXNGb3JQb3NpdGlvbi54LCB5UG9zIC09IGgsIE1hdGgubWF4KGJhcldpZHRoLCAxKSwgaCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdNaXNtYXRjaDogZnVuY3Rpb24oY3R4LCBtaXNtYXRjaCwgbGluZU9mZnNldCwgbGluZUhlaWdodCwgcHBicCkge1xuICAgIC8vIHBwYnAgPT0gcGl4ZWxzIHBlciBiYXNlIHBhaXIgKGludmVyc2Ugb2YgYnBwcClcbiAgICAvLyBTYW1lIGNvbG9ycyBhcyAkLnVpLmdlbm90cmFjay5fbnRTZXF1ZW5jZUxvYWQoLi4uKSBidXQgY291bGQgYmUgY29uZmlndXJhYmxlP1xuICAgIHZhciBjb2xvcnMgPSB7QTogJzI1NSwwLDAnLCBUOiAnMjU1LDAsMjU1JywgQzogJzAsMCwyNTUnLCBHOiAnMCwxODAsMCd9LFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDAsXG4gICAgICB5UG9zO1xuICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKCcrY29sb3JzW21pc21hdGNoLm50XSsnKSc7XG4gICAgY3R4LmZpbGxSZWN0KG1pc21hdGNoLngsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCkgKiBsaW5lSGVpZ2h0ICsgbGluZUdhcCAvIDIsIE1hdGgubWF4KHBwYnAsIDEpLCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgLy8gRG8gd2UgaGF2ZSByb29tIHRvIHByaW50IGEgd2hvbGUgbGV0dGVyP1xuICAgIGlmIChwcGJwID4gNyAmJiBsaW5lSGVpZ2h0ID4gMTApIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDI1NSwyNTUsMjU1KSc7XG4gICAgICBjdHguZmlsbFRleHQobWlzbWF0Y2gubnQsIG1pc21hdGNoLnggKyBwcGJwICogMC41LCAobWlzbWF0Y2gubGluZSArIGxpbmVPZmZzZXQgKyAxKSAqIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICB9XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSAnamF2YXNjcmlwdDp2b2lkKFwiJytzZWxmLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGRyYXdMaW1pdCA9IHNlbGYub3B0cy5kcmF3TGltaXQgJiYgc2VsZi5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDE0IDogNCxcbiAgICAgIGNvdkhlaWdodCA9IHNlbGYub3B0cy5jb3ZIZWlnaHRbZGVuc2l0eV0gfHwgMzgsXG4gICAgICBjb3ZNYXJnaW4gPSA3LFxuICAgICAgbGluZU9mZnNldCA9ICgoY292SGVpZ2h0ICsgY292TWFyZ2luKSAvIGxpbmVIZWlnaHQpLCBcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgYXJlYXMgPSBudWxsO1xuICAgICAgICAgICAgXG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgXG4gICAgaWYgKCFkcmF3U3BlYy5zZXF1ZW5jZSkge1xuICAgICAgLy8gRmlyc3QgZHJhd2luZyBwYXNzLCB3aXRoIGZlYXR1cmVzIHRoYXQgZG9uJ3QgZGVwZW5kIG9uIHNlcXVlbmNlLlxuICAgICAgXG4gICAgICAvLyBJZiBuZWNlc3NhcnksIGluZGljYXRlIHRoZXJlIHdhcyB0b28gbXVjaCBkYXRhIHRvIGxvYWQvZHJhdyBhbmQgdGhhdCB0aGUgdXNlciBuZWVkcyB0byB6b29tIHRvIHNlZSBtb3JlXG4gICAgICBpZiAoZHJhd1NwZWMudG9vTWFueSB8fCAoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxheW91dC5sZW5ndGggPiBkcmF3TGltaXQpKSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBPbmx5IHN0b3JlIGFyZWFzIGZvciB0aGUgXCJwYWNrXCIgZGVuc2l0eS5cbiAgICAgIC8vIFdlIGhhdmUgdG8gZW1wdHkgdGhpcyBmb3IgZXZlcnkgcmVuZGVyLCBiZWNhdXNlIGFyZWFzIGNhbiBjaGFuZ2UgaWYgQkFNIGRpc3BsYXkgb3B0aW9ucyBjaGFuZ2UuXG4gICAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycgJiYgIXNlbGYuYXJlYXNbY2FudmFzLmlkXSkgeyBhcmVhcyA9IHNlbGYuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgICAvLyBTZXQgdGhlIGV4cGVjdGVkIGhlaWdodCBmb3IgdGhlIGNhbnZhcyAodGhpcyBhbHNvIGVyYXNlcyBpdCkuXG4gICAgICBjYW52YXMuaGVpZ2h0ID0gY292SGVpZ2h0ICsgKChkZW5zaXR5ID09ICdkZW5zZScpID8gMCA6IGNvdk1hcmdpbiArIGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0KTtcbiAgICAgIFxuICAgICAgLy8gRmlyc3QgZHJhdyB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigxNTksMTU5LDE1OSlcIjtcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0NvdmVyYWdlLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5jb3ZlcmFnZSwgY292SGVpZ2h0KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgIC8vIE5vdywgZHJhdyBhbGlnbm1lbnRzIGJlbG93IGl0XG4gICAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnKSB7XG4gICAgICAgIC8vIEJvcmRlciBiZXR3ZWVuIGNvdmVyYWdlXG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigxMDksMTA5LDEwOSlcIjtcbiAgICAgICAgY3R4LmZpbGxSZWN0KDAsIGNvdkhlaWdodCArIDEsIGRyYXdTcGVjLndpZHRoLCAxKTsgXG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgICAgXG4gICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgICBpICs9IGxpbmVPZmZzZXQ7IC8vIGhhY2tpc2ggbWV0aG9kIGZvciBsZWF2aW5nIHNwYWNlIGF0IHRoZSB0b3AgZm9yIHRoZSBjb3ZlcmFnZSBncmFwaFxuICAgICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGlnbm1lbnQuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCBkcmF3U3BlYy52aWV3QXNQYWlycyk7XG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmFkZEFyZWEuY2FsbChzZWxmLCBhcmVhcywgZGF0YSwgaSwgbGluZUhlaWdodCwgdXJsVGVtcGxhdGUpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2Vjb25kIGRyYXdpbmcgcGFzcywgdG8gZHJhdyB0aGluZ3MgdGhhdCBhcmUgZGVwZW5kZW50IG9uIHNlcXVlbmNlOlxuICAgICAgLy8gKDEpIGFsbGVsZSBzcGxpdHMgb3ZlciBjb3ZlcmFnZVxuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3QWxsZWxlcy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMuYWxsZWxlcywgY292SGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICAvLyAoMikgbWlzbWF0Y2hlcyBvdmVyIHRoZSBhbGlnbm1lbnRzXG4gICAgICBjdHguZm9udCA9IFwiMTJweCAnTWVubG8nLCdCaXRzdHJlYW0gVmVyYSBTYW5zIE1vbm8nLCdDb25zb2xhcycsJ0x1Y2lkYSBDb25zb2xlJyxtb25vc3BhY2VcIjtcbiAgICAgIGN0eC50ZXh0QWxpZ24gPSAnY2VudGVyJztcbiAgICAgIGN0eC50ZXh0QmFzZWxpbmUgPSAnYmFzZWxpbmUnO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLm1pc21hdGNoZXMsIGZ1bmN0aW9uKG1pc21hdGNoKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd01pc21hdGNoLmNhbGwoc2VsZiwgY3R4LCBtaXNtYXRjaCwgbGluZU9mZnNldCwgbGluZUhlaWdodCwgMSAvIGRyYXdTcGVjLmJwcHApO1xuICAgICAgfSk7XG4gICAgfVxuXG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHZhciBjYWxsYmFja0tleSA9IHN0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eTtcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIFxuICAgICAgLy8gSGF2ZSB3ZSBiZWVuIHdhaXRpbmcgdG8gZHJhdyBzZXF1ZW5jZSBkYXRhIHRvbz8gSWYgc28sIGRvIHRoYXQgbm93LCB0b28uXG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKSkge1xuICAgICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XSgpO1xuICAgICAgICBkZWxldGUgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV07XG4gICAgICB9XG4gICAgICBcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIHJlbmRlclNlcXVlbmNlOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHNlcXVlbmNlLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBcbiAgICAvLyBJZiB3ZSB3ZXJlbid0IGFibGUgdG8gZmV0Y2ggc2VxdWVuY2UgZm9yIHNvbWUgcmVhc29uLCB0aGVyZSBpcyBubyByZWFzb24gdG8gcHJvY2VlZC5cbiAgICBpZiAoIXNlcXVlbmNlKSB7IHJldHVybiBmYWxzZTsgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyU2VxdWVuY2VDYWxsYmFjaygpIHtcbiAgICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRoLCBzZXF1ZW5jZTogc2VxdWVuY2V9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICAvLyBDaGVjayBpZiB0aGUgY2FudmFzIHdhcyBhbHJlYWR5IHJlbmRlcmVkIChieSBsYWNrIG9mIHRoZSBjbGFzcyAndW5yZW5kZXJlZCcpLlxuICAgIC8vIElmIHllcywgZ28gYWhlYWQgYW5kIGV4ZWN1dGUgcmVuZGVyU2VxdWVuY2VDYWxsYmFjaygpOyBpZiBub3QsIHNhdmUgaXQgZm9yIGxhdGVyLlxuICAgIGlmICgoJyAnICsgY2FudmFzLmNsYXNzTmFtZSArICcgJykuaW5kZXhPZignIHVucmVuZGVyZWQgJykgPiAtMSkge1xuICAgICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tzdGFydCArICctJyArIGVuZCArICctJyArIGRlbnNpdHldID0gcmVuZGVyU2VxdWVuY2VDYWxsYmFjaztcbiAgICB9IGVsc2Uge1xuICAgICAgcmVuZGVyU2VxdWVuY2VDYWxsYmFjaygpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHM7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3QXNQYWlyc10nKS5hdHRyKCdjaGVja2VkJywgISFvLnZpZXdBc1BhaXJzKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbnZlcnRDaHJTY2hlbWVdJykudmFsKG8uY29udmVydENoclNjaGVtZSkuY2hhbmdlKCk7XG4gIH0sXG5cbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICBvLnZpZXdBc1BhaXJzID0gJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3QXNQYWlyc10nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLmNvbnZlcnRDaHJTY2hlbWUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbnZlcnRDaHJTY2hlbWVdJykudmFsKCk7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgICBcbiAgICAvLyBJZiBvLnZpZXdBc1BhaXJzIHdhcyBjaGFuZ2VkLCB3ZSAqbmVlZCogdG8gYmxvdyBhd2F5IHRoZSBnZW5vYnJvd3NlcidzIGFyZWFJbmRleCBcbiAgICAvLyBhbmQgb3VyIGxvY2FsbHkgY2FjaGVkIGFyZWFzLCBhcyBhbGwgdGhlIGFyZWFzIHdpbGwgY2hhbmdlLlxuICAgIGlmIChvLnZpZXdBc1BhaXJzICE9IHRoaXMucHJldk9wdHMudmlld0FzUGFpcnMpIHtcbiAgICAgIHRoaXMuYXJlYXMgPSB7fTtcbiAgICAgIGRlbGV0ZSAkZGlhbG9nLmRhdGEoJ2dlbm9icm93c2VyJykuZ2Vub2Jyb3dzZXIoJ2FyZWFJbmRleCcpWyRkaWFsb2cuZGF0YSgndHJhY2snKS5uXTtcbiAgICB9XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJhbUZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCRUQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gYmVkRGV0YWlsIGlzIGEgdHJpdmlhbCBleHRlbnNpb24gb2YgQkVEIHRoYXQgaXMgZGVmaW5lZCBzZXBhcmF0ZWx5LFxuLy8gYWx0aG91Z2ggYSBCRUQgZmlsZSB3aXRoID4xMiBjb2x1bW5zIGlzIGFzc3VtZWQgdG8gYmUgYmVkRGV0YWlsIHRyYWNrIHJlZ2FyZGxlc3Mgb2YgdHlwZS5cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIExpbmVNYXNrID0gcmVxdWlyZSgnLi91dGlscy9MaW5lTWFzay5qcycpLkxpbmVNYXNrO1xuXG52YXIgQkVEX1NUQU5EQVJEX0ZJRUxEUyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICduYW1lJywgJ3Njb3JlJywgJ3N0cmFuZCcsICd0aGlja1N0YXJ0JywgJ3RoaWNrRW5kJywgJ2l0ZW1SZ2InLFxuICAgICdibG9ja0NvdW50JywgJ2Jsb2NrU2l6ZXMnLCAnYmxvY2tTdGFydHMnXTtcbnZhciBCRURfREVUQUlMX0ZJRUxEUyA9IFsnaWQnLCAnZGVzY3JpcHRpb24nXTtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkXG52YXIgQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogbnVsbCwgcGFjazogbnVsbH0sXG4gICAgYmVkUGx1c0ZpZWxkczogQkVEX0RFVEFJTF9GSUVMRFNcbiAgfSxcbiAgXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH0sXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYWx0Q29sb3JzID0gc2VsZi5vcHRzLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKSxcbiAgICAgIHZhbGlkQ29sb3JCeVN0cmFuZCA9IGFsdENvbG9ycy5sZW5ndGggPiAxICYmIF8uYWxsKGFsdENvbG9ycywgc2VsZi52YWxpZGF0ZUNvbG9yKTtcbiAgICBzZWxmLm51bVN0YW5kYXJkQ29sdW1ucyA9IEJFRF9TVEFOREFSRF9GSUVMRFMubGVuZ3RoO1xuICAgIHNlbGYub3B0cy51c2VTY29yZSA9IHNlbGYuaXNPbihzZWxmLm9wdHMudXNlU2NvcmUpO1xuICAgIHNlbGYub3B0cy5pdGVtUmdiID0gc2VsZi5pc09uKHNlbGYub3B0cy5pdGVtUmdiKTtcbiAgICBpZiAoc2VsZi50eXBlQXJncy5sZW5ndGggPiAwICYmIC9eXFxkKyQvLnRlc3Qoc2VsZi50eXBlQXJnc1swXSkpIHtcbiAgICAgIHNlbGYubnVtU3RhbmRhcmRDb2x1bW5zID0gcGFyc2VJbnQxMChzZWxmLnR5cGVBcmdzWzBdKTtcbiAgICB9XG4gICAgaWYgKHNlbGYub3B0cy5iZWRQbHVzRmllbGRzICYmICFfLmlzQXJyYXkoc2VsZi5vcHRzLmJlZFBsdXNGaWVsZHMpKSB7XG4gICAgICBzZWxmLm9wdHMuYmVkUGx1c0ZpZWxkcyA9IHNlbGYub3B0cy5iZWRQbHVzRmllbGRzLnNwbGl0KCcsJyk7XG4gICAgfVxuICAgIGlmICgvJXMvLnRlc3Qoc2VsZi5vcHRzLnVybCkpIHsgc2VsZi5vcHRzLnVybCA9IHNlbGYub3B0cy51cmwucmVwbGFjZSgvJXMvLCAnJCQkJCcpOyB9XG4gICAgZWxzZSBpZiAoc2VsZi5vcHRzLnVybCAmJiAhKC9cXCRcXCQvKS50ZXN0KHNlbGYub3B0cy51cmwpKSB7IHNlbGYub3B0cy51cmwgKz0gJyQkJzsgfVxuICAgIGNvbnNvbGUubG9nKHNlbGYub3B0cy51cmwpO1xuICAgIGlmICghdmFsaWRDb2xvckJ5U3RyYW5kKSB7IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kID0gJyc7IHNlbGYub3B0cy5hbHRDb2xvciA9IG51bGw7IH1cbiAgICBlbHNlIHsgc2VsZi5vcHRzLmFsdENvbG9yID0gYWx0Q29sb3JzWzFdOyB9XG4gIH0sXG5cbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgY29scyA9IEJFRF9TVEFOREFSRF9GSUVMRFMsXG4gICAgICBudW1TdGFuZGFyZENvbHMgPSB0aGlzLm51bVN0YW5kYXJkQ29sdW1ucyxcbiAgICAgIGJlZFBsdXNGaWVsZHMgPSB0aGlzLm9wdHMuYmVkUGx1c0ZpZWxkcyxcbiAgICAgIGZlYXR1cmUgPSB7ZXh0cmE6IHt9fSxcbiAgICAgIGZpZWxkcyA9IC9cXHQvLnRlc3QobGluZSkgPyBsaW5lLnNwbGl0KFwiXFx0XCIpIDogbGluZS5zcGxpdCgvXFxzKy8pLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGlmICh0aGlzLm9wdHMuZGV0YWlsKSB7XG4gICAgICBudW1TdGFuZGFyZENvbHMgPSBNYXRoLm1pbihmaWVsZHMubGVuZ3RoIC0gMiwgMTIpO1xuICAgICAgYmVkUGx1c0ZpZWxkcyA9IEJFRF9ERVRBSUxfRklFTERTO1xuICAgIH1cbiAgICBfLmVhY2goZmllbGRzLCBmdW5jdGlvbih2LCBpKSB7XG4gICAgICB2YXIgYmVkUGx1c0ZpZWxkID0gaSAtIG51bVN0YW5kYXJkQ29scztcbiAgICAgIGlmIChudW1TdGFuZGFyZENvbHMgJiYgaSA8IG51bVN0YW5kYXJkQ29scykgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGlmIChiZWRQbHVzRmllbGRzICYmIGkgLSBudW1TdGFuZGFyZENvbHMgPCBiZWRQbHVzRmllbGRzLmxlbmd0aCkgeyBiZWRQbHVzRmllbGQgPSBiZWRQbHVzRmllbGRzW2kgLSBudW1TdGFuZGFyZENvbHNdOyB9XG4gICAgICAgIGlmIChfLmNvbnRhaW5zKEJFRF9ERVRBSUxfRklFTERTLCBiZWRQbHVzRmllbGQpKSB7IGZlYXR1cmVbYmVkUGx1c0ZpZWxkXSA9IHY7IH1cbiAgICAgICAgZWxzZSB7IGZlYXR1cmUuZXh0cmFbYmVkUGx1c0ZpZWxkXSA9IHY7IH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tmZWF0dXJlLmNocm9tXTtcbiAgICBsaW5lbm8gPSBsaW5lbm8gfHwgMDtcbiAgICBcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7IFxuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lICdcIitmZWF0dXJlLmNocm9tK1wiJyBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZlYXR1cmUuc2NvcmUgPSBfLmlzVW5kZWZpbmVkKGZlYXR1cmUuc2NvcmUpID8gJz8nIDogZmVhdHVyZS5zY29yZTtcbiAgICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUuY2hyb21TdGFydCkgKyAxO1xuICAgICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUuY2hyb21FbmQpICsgMTtcbiAgICAgIGlmIChmZWF0dXJlLmVuZCA9PT0gZmVhdHVyZS5zdGFydCkgeyBmZWF0dXJlLmVuZCArPSAwLjE7IGZlYXR1cmUuemVyb1dpZHRoID0gdHJ1ZTsgfVxuICAgICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgICAgLy8gZmFuY2llciBCRUQgZmVhdHVyZXMgdG8gZXhwcmVzcyBjb2RpbmcgcmVnaW9ucyBhbmQgZXhvbnMvaW50cm9uc1xuICAgICAgaWYgKC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja1N0YXJ0KSAmJiAvXlxcZCskLy50ZXN0KGZlYXR1cmUudGhpY2tFbmQpKSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja1N0YXJ0KSArIDE7XG4gICAgICAgIGZlYXR1cmUudGhpY2tFbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUudGhpY2tFbmQpICsgMTtcbiAgICAgICAgaWYgKC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU2l6ZXMpICYmIC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU3RhcnRzKSkge1xuICAgICAgICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgICAgICAgYmxvY2tTaXplcyA9IGZlYXR1cmUuYmxvY2tTaXplcy5zcGxpdCgvLC8pO1xuICAgICAgICAgIF8uZWFjaChmZWF0dXJlLmJsb2NrU3RhcnRzLnNwbGl0KC8sLyksIGZ1bmN0aW9uKHN0YXJ0LCBpKSB7XG4gICAgICAgICAgICBpZiAoc3RhcnQgPT09ICcnKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcGFyc2VJbnQxMChzdGFydCl9O1xuICAgICAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBwYXJzZUludDEwKGJsb2NrU2l6ZXNbaV0pO1xuICAgICAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pO1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGxpbmUsIGxpbmVubyk7XG4gICAgICBpZiAoZmVhdHVyZSkgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIHN0YWNrZWRMYXlvdXQ6IGZ1bmN0aW9uKGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSkge1xuICAgIC8vIEEgbGluZU51bSBmdW5jdGlvbiBjYW4gYmUgcHJvdmlkZWQgd2hpY2ggY2FuIHNldC9yZXRyaWV2ZSB0aGUgbGluZSBvZiBhbHJlYWR5IHJlbmRlcmVkIGRhdGFwb2ludHNcbiAgICAvLyBzbyBhcyB0byBub3QgYnJlYWsgYSByYW5nZWQgZmVhdHVyZSB0aGF0IGV4dGVuZHMgb3ZlciBtdWx0aXBsZSB0aWxlcy5cbiAgICBsaW5lTnVtID0gXy5pc0Z1bmN0aW9uKGxpbmVOdW0pID8gbGluZU51bSA6IGZ1bmN0aW9uKCkgeyByZXR1cm47IH07XG4gICAgdmFyIGxpbmVzID0gW10sXG4gICAgICBtYXhFeGlzdGluZ0xpbmUgPSBfLm1heChfLm1hcChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIGxpbmVOdW0odi5kYXRhKSB8fCAwOyB9KSkgKyAxLFxuICAgICAgc29ydGVkSW50ZXJ2YWxzID0gXy5zb3J0QnkoaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7IHZhciBsbiA9IGxpbmVOdW0odi5kYXRhKTsgcmV0dXJuIF8uaXNVbmRlZmluZWQobG4pID8gMSA6IC1sbjsgfSk7XG4gICAgXG4gICAgd2hpbGUgKG1heEV4aXN0aW5nTGluZS0tPjApIHsgbGluZXMucHVzaChuZXcgTGluZU1hc2sod2lkdGgsIDUpKTsgfVxuICAgIF8uZWFjaChzb3J0ZWRJbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHZhciBkID0gdi5kYXRhLFxuICAgICAgICBsbiA9IGxpbmVOdW0oZCksXG4gICAgICAgIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwoZCksXG4gICAgICAgIHRoaWNrSW50ID0gZC50aGlja1N0YXJ0ICE9PSBudWxsICYmIGNhbGNQaXhJbnRlcnZhbCh7c3RhcnQ6IGQudGhpY2tTdGFydCwgZW5kOiBkLnRoaWNrRW5kfSksXG4gICAgICAgIGJsb2NrSW50cyA9IGQuYmxvY2tzICE9PSBudWxsICYmICBfLm1hcChkLmJsb2NrcywgY2FsY1BpeEludGVydmFsKSxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGwgPSBsaW5lcy5sZW5ndGg7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQobG4pKSB7XG4gICAgICAgIGlmIChsaW5lc1tsbl0uY29uZmxpY3QocEludC50eCwgcEludC50dykpIHsgY29uc29sZS5sb2coXCJVbnJlc29sdmFibGUgTGluZU1hc2sgY29uZmxpY3QhXCIpOyB9XG4gICAgICAgIGxpbmVzW2xuXS5hZGQocEludC50eCwgcEludC50dywge3BJbnQ6IHBJbnQsIHRoaWNrSW50OiB0aGlja0ludCwgYmxvY2tJbnRzOiBibG9ja0ludHMsIGQ6IGR9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoaWxlIChpIDwgbCAmJiBsaW5lc1tpXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyArK2k7IH1cbiAgICAgICAgaWYgKGkgPT0gbCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgICAgIGxpbmVOdW0oZCwgaSk7XG4gICAgICAgIGxpbmVzW2ldLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gXy5wbHVjayhsLml0ZW1zLCAnZGF0YScpOyB9KTtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIGludGVydmFscyA9IHRoaXMuZGF0YS5zZWFyY2goc3RhcnQsIGVuZCksXG4gICAgICBkcmF3U3BlYyA9IFtdLFxuICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJyk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXQpIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXQpKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgIHZhciBwSW50ID0gY2FsY1BpeEludGVydmFsKHYuZGF0YSk7XG4gICAgICAgIHBJbnQudiA9IHYuZGF0YS5zY29yZTtcbiAgICAgICAgZHJhd1NwZWMucHVzaChwSW50KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHRoaXMudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHRoaXMsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSl9O1xuICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGFkZEFyZWE6IGZ1bmN0aW9uKGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSkge1xuICAgIHZhciB0aXBUaXBEYXRhID0ge30sXG4gICAgICB0aXBUaXBEYXRhQ2FsbGJhY2sgPSB0aGlzLnR5cGUoKS50aXBUaXBEYXRhLFxuICAgICAgbmFtZUZ1bmMgPSB0aGlzLnR5cGUoKS5uYW1lRnVuYyB8fCB1dGlscy5kZWZhdWx0TmFtZUZ1bmMsXG4gICAgICBhdXRvSWQgPSAoL1xcdC8pLnRlc3QoZGF0YS5kLmlkKTsgLy8gT25seSBhdXRvbWF0aWNhbGx5IGdlbmVyYXRlZCBpZCdzIGNvdWxkIGNvbnRhaW4gYSB0YWIgY2hhcmFjdGVyXG4gICAgaWYgKCFhcmVhcykgeyByZXR1cm47IH1cbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHRpcFRpcERhdGFDYWxsYmFjaykpIHtcbiAgICAgIHRpcFRpcERhdGEgPSB0aXBUaXBEYXRhQ2FsbGJhY2suY2FsbCh0aGlzLCBkYXRhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5kZXNjcmlwdGlvbikpIHsgdGlwVGlwRGF0YS5kZXNjcmlwdGlvbiA9IGRhdGEuZC5kZXNjcmlwdGlvbjsgfVxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5zY29yZSkpIHsgdGlwVGlwRGF0YS5zY29yZSA9IGRhdGEuZC5zY29yZTsgfVxuICAgICAgXy5leHRlbmQodGlwVGlwRGF0YSwge1xuICAgICAgICBwb3NpdGlvbjogZGF0YS5kLmNocm9tICsgJzonICsgZGF0YS5kLmNocm9tU3RhcnQsIFxuICAgICAgICBzaXplOiBkYXRhLmQuY2hyb21FbmQgLSBkYXRhLmQuY2hyb21TdGFydFxuICAgICAgfSk7XG4gICAgICAvLyBEaXNwbGF5IHRoZSBJRCBjb2x1bW4gKGZyb20gYmVkRGV0YWlsKSB1bmxlc3MgaXQgd2FzIGF1dG9tYXRpY2FsbHkgZ2VuZXJhdGVkXG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSAmJiAhYXV0b0lkKSB7IHRpcFRpcERhdGEuaWQgPSBkYXRhLmQuaWQ7IH1cbiAgICB9XG4gICAgYXJlYXMucHVzaChbXG4gICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy8geDEsIHkxLCB4MiwgeTJcbiAgICAgIG5hbWVGdW5jKGRhdGEuZCksICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBuYW1lXG4gICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIGF1dG9JZCB8fCBfLmlzVW5kZWZpbmVkKGRhdGEuZC5pZCkgPyBkYXRhLmQubmFtZSA6IGRhdGEuZC5pZCksIC8vIGhyZWZcbiAgICAgIGRhdGEucEludC5vUHJldiwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjb250aW51YXRpb24gZnJvbSBwcmV2aW91cyB0aWxlP1xuICAgICAgbnVsbCxcbiAgICAgIG51bGwsXG4gICAgICB0aXBUaXBEYXRhXG4gICAgXSk7XG4gIH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGFuIGFscGhhIHZhbHVlIGJldHdlZW4gMC4yIGFuZCAxLjBcbiAgY2FsY0FscGhhOiBmdW5jdGlvbih2YWx1ZSkgeyByZXR1cm4gTWF0aC5tYXgodmFsdWUsIDE2NikvMTAwMDsgfSxcbiAgXG4gIC8vIFNjYWxlcyBhIHNjb3JlIGZyb20gMC0xMDAwIGludG8gYSBjb2xvciBzY2FsZWQgYmV0d2VlbiAjY2NjY2NjIGFuZCBtYXggQ29sb3JcbiAgY2FsY0dyYWRpZW50OiBmdW5jdGlvbihtYXhDb2xvciwgdmFsdWUpIHtcbiAgICB2YXIgbWluQ29sb3IgPSBbMjMwLDIzMCwyMzBdLFxuICAgICAgdmFsdWVDb2xvciA9IFtdO1xuICAgIGlmICghXy5pc0FycmF5KG1heENvbG9yKSkgeyBtYXhDb2xvciA9IF8ubWFwKG1heENvbG9yLnNwbGl0KCcsJyksIHBhcnNlSW50MTApOyB9XG4gICAgXy5lYWNoKG1pbkNvbG9yLCBmdW5jdGlvbih2LCBpKSB7IHZhbHVlQ29sb3JbaV0gPSAodiAtIG1heENvbG9yW2ldKSAqICgoMTAwMCAtIHZhbHVlKSAvIDEwMDAuMCkgKyBtYXhDb2xvcltpXTsgfSk7XG4gICAgcmV0dXJuIF8ubWFwKHZhbHVlQ29sb3IsIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgfSxcbiAgXG4gIGRyYXdBcnJvd3M6IGZ1bmN0aW9uKGN0eCwgY2FudmFzV2lkdGgsIGxpbmVZLCBoYWxmSGVpZ2h0LCBzdGFydFgsIGVuZFgsIGRpcmVjdGlvbikge1xuICAgIHZhciBhcnJvd0hlaWdodCA9IE1hdGgubWluKGhhbGZIZWlnaHQsIDMpLFxuICAgICAgWDEsIFgyO1xuICAgIHN0YXJ0WCA9IE1hdGgubWF4KHN0YXJ0WCwgMCk7XG4gICAgZW5kWCA9IE1hdGgubWluKGVuZFgsIGNhbnZhc1dpZHRoKTtcbiAgICBpZiAoZW5kWCAtIHN0YXJ0WCA8IDUpIHsgcmV0dXJuOyB9IC8vIGNhbid0IGRyYXcgYXJyb3dzIGluIHRoYXQgbmFycm93IG9mIGEgc3BhY2VcbiAgICBpZiAoZGlyZWN0aW9uICE9PSAnKycgJiYgZGlyZWN0aW9uICE9PSAnLScpIHsgcmV0dXJuOyB9IC8vIGludmFsaWQgZGlyZWN0aW9uXG4gICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgIC8vIEFsbCB0aGUgMC41J3MgaGVyZSBhcmUgZHVlIHRvIDxjYW52YXM+J3Mgc29tZXdoYXQgc2lsbHkgY29vcmRpbmF0ZSBzeXN0ZW0gXG4gICAgLy8gaHR0cDovL2RpdmVpbnRvaHRtbDUuaW5mby9jYW52YXMuaHRtbCNwaXhlbC1tYWRuZXNzXG4gICAgWDEgPSBkaXJlY3Rpb24gPT0gJysnID8gMC41IDogYXJyb3dIZWlnaHQgKyAwLjU7XG4gICAgWDIgPSBkaXJlY3Rpb24gPT0gJysnID8gYXJyb3dIZWlnaHQgKyAwLjUgOiAwLjU7XG4gICAgZm9yICh2YXIgaSA9IE1hdGguZmxvb3Ioc3RhcnRYKSArIDI7IGkgPCBlbmRYIC0gYXJyb3dIZWlnaHQ7IGkgKz0gNykge1xuICAgICAgY3R4Lm1vdmVUbyhpICsgWDEsIGxpbmVZICsgaGFsZkhlaWdodCAtIGFycm93SGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgyLCBsaW5lWSArIGhhbGZIZWlnaHQgKyAwLjUpO1xuICAgICAgY3R4LmxpbmVUbyhpICsgWDEsIGxpbmVZICsgaGFsZkhlaWdodCArIGFycm93SGVpZ2h0ICsgMC41KTtcbiAgICB9XG4gICAgY3R4LnN0cm9rZSgpO1xuICB9LFxuICBcbiAgZHJhd0ZlYXR1cmU6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIHkgPSBpICogbGluZUhlaWdodCxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgcXVhcnRlckhlaWdodCA9IE1hdGguY2VpbCgwLjI1ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIHRoaWNrT3ZlcmxhcCA9IG51bGwsXG4gICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLml0ZW1SZ2IgJiYgZGF0YS5kLml0ZW1SZ2IgJiYgdGhpcy52YWxpZGF0ZUNvbG9yKGRhdGEuZC5pdGVtUmdiKSkgeyBjb2xvciA9IGRhdGEuZC5pdGVtUmdiOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjb2xvciA9IHNlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBkYXRhLmQuc2NvcmUpOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy5pdGVtUmdiIHx8IHNlbGYub3B0cy5hbHRDb2xvciB8fCBzZWxmLm9wdHMudXNlU2NvcmUpIHsgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjsgfVxuICAgIFxuICAgIGlmIChkYXRhLnRoaWNrSW50KSB7XG4gICAgICAvLyBUaGUgY29kaW5nIHJlZ2lvbiBpcyBkcmF3biBhcyBhIHRoaWNrZXIgbGluZSB3aXRoaW4gdGhlIGdlbmVcbiAgICAgIGlmIChkYXRhLmJsb2NrSW50cykge1xuICAgICAgICAvLyBJZiB0aGVyZSBhcmUgZXhvbnMgYW5kIGludHJvbnMsIGRyYXcgdGhlIGludHJvbnMgd2l0aCBhIDFweCBsaW5lXG4gICAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCwgZGF0YS5wSW50LncsIDEpO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBjb2xvcjtcbiAgICAgICAgXy5lYWNoKGRhdGEuYmxvY2tJbnRzLCBmdW5jdGlvbihiSW50KSB7XG4gICAgICAgICAgaWYgKGJJbnQueCArIGJJbnQudyA8PSB3aWR0aCAmJiBiSW50LnggPj0gMCkge1xuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgeSArIGhhbGZIZWlnaHQgLSBxdWFydGVySGVpZ2h0ICsgMSwgYkludC53LCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlja092ZXJsYXAgPSB1dGlscy5waXhJbnRlcnZhbE92ZXJsYXAoYkludCwgZGF0YS50aGlja0ludCk7XG4gICAgICAgICAgaWYgKHRoaWNrT3ZlcmxhcCkge1xuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KHRoaWNrT3ZlcmxhcC54LCB5ICsgMSwgdGhpY2tPdmVybGFwLncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGludHJvbnMsIGFycm93cyBhcmUgZHJhd24gb24gdGhlIGludHJvbnMsIG5vdCB0aGUgZXhvbnMuLi5cbiAgICAgICAgICBpZiAoZGF0YS5kLnN0cmFuZCAmJiBwcmV2QkludCkge1xuICAgICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIHByZXZCSW50LnggKyBwcmV2QkludC53LCBiSW50LngsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwcmV2QkludCA9IGJJbnQ7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyAuLi51bmxlc3MgdGhlcmUgd2VyZSBubyBpbnRyb25zLiBUaGVuIGl0IGlzIGRyYXduIG9uIHRoZSBjb2RpbmcgcmVnaW9uLlxuICAgICAgICBpZiAoZGF0YS5ibG9ja0ludHMubGVuZ3RoID09IDEpIHtcbiAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gV2UgaGF2ZSBhIGNvZGluZyByZWdpb24gYnV0IG5vIGludHJvbnMvZXhvbnNcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEudGhpY2tJbnQueCwgeSArIDEsIGRhdGEudGhpY2tJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE5vdGhpbmcgZmFuY3kuICBJdCdzIGEgYm94LlxuICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgMSwgZGF0YS5wSW50LncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQueCwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gc2VsZi5vcHRzLnVybCA/IHNlbGYub3B0cy51cmwgOiAnamF2YXNjcmlwdDp2b2lkKFwiJytzZWxmLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGRyYXdMaW1pdCA9IHNlbGYub3B0cy5kcmF3TGltaXQgJiYgc2VsZi5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDE1IDogNixcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgYXJlYXMgPSBudWxsO1xuICAgIFxuICAgIGlmICh1cmxUZW1wbGF0ZS5tYXRjaCgvJXMvKSkgeyB1cmxUZW1wbGF0ZS5yZXBsYWNlKC8lcy8sICckJCcpOyB9XG4gICAgZWxzZSBpZiAoIXVybFRlbXBsYXRlLm1hdGNoKC9cXCRcXCQvKSkgeyB1cmxUZW1wbGF0ZSArPSAnJCQnOyB9XG4gICAgXG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgLy8gVE9ETzogSSBkaXNhYmxlZCByZWdlbmVyYXRpbmcgYXJlYXMgaGVyZSwgd2hpY2ggYXNzdW1lcyB0aGF0IGxpbmVOdW0gcmVtYWlucyBzdGFibGUgYWNyb3NzIHJlLXJlbmRlcnMuIFNob3VsZCBjaGVjayBvbiB0aGlzLlxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gXCJyZ2JhKFwiK3NlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBwSW50LnYpK1wiKVwiOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxheW91dCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0ZlYXR1cmUuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KTsgICAgICAgICAgICAgIFxuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAvXFxkKyxcXGQrLFxcZCtcXHMrXFxkKyxcXGQrLFxcZCsvLnRlc3Qoby5jb2xvckJ5U3RyYW5kKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gPyBvLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKVsxXSA6ICcwLDAsMCc7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuYXR0cignY2hlY2tlZCcsICEhY29sb3JCeVN0cmFuZE9uKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKGNvbG9yQnlTdHJhbmQpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnVzZVNjb3JlKSk7ICAgIFxuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbChvLnVybCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbCgpLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gdGhpcy52YWxpZGF0ZUNvbG9yKGNvbG9yQnlTdHJhbmQpO1xuICAgIG8uY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiAmJiB2YWxpZENvbG9yQnlTdHJhbmQgPyBvLmNvbG9yICsgJyAnICsgY29sb3JCeVN0cmFuZCA6ICcnO1xuICAgIG8udXNlU2NvcmUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmlzKCc6Y2hlY2tlZCcpID8gMSA6IDA7XG4gICAgby51cmwgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoKTtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkR3JhcGggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iZWRncmFwaC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkZ3JhcGhcbnZhciBCZWRHcmFwaEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdC5jYWxsKHRoaXMpOyB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7IH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnZGF0YVZhbHVlJ10sXG4gICAgICAgIGRhdHVtID0ge30sXG4gICAgICAgIGNoclBvcywgc3RhcnQsIGVuZCwgdmFsO1xuICAgICAgXy5lYWNoKGxpbmUuc3BsaXQoL1xccysvKSwgZnVuY3Rpb24odiwgaSkgeyBkYXR1bVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZGF0dW0uY2hyb21dO1xuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbVN0YXJ0KTtcbiAgICAgIGVuZCA9IHBhcnNlSW50MTAoZGF0dW0uY2hyb21FbmQpO1xuICAgICAgdmFsID0gcGFyc2VGbG9hdChkYXR1bS5kYXRhVmFsdWUpO1xuICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIGVuZCwgdmFsOiB2YWx9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkR3JhcGhGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ0JlZCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ0JlZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmlnYmVkXG52YXIgQmlnQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnQmVkIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBhamF4VXJsID0gc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsXG4gICAgICByZW1vdGU7XG4gICAgXG4gICAgcmVtb3RlID0gbmV3IFJlbW90ZVRyYWNrKGNhY2hlLCBmdW5jdGlvbihzdGFydCwgZW5kLCBzdG9yZUludGVydmFscykge1xuICAgICAgcmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgZGVuc2l0eTogJ3BhY2snfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgXG4gICAgICAgICAgICB2YXIgaXR2bCA9IHNlbGYudHlwZSgnYmVkJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7XG4gICAgICAgICAgICAvLyBVc2UgQmlvUGVybCdzIEJpbzo6REI6QmlnQmVkIHN0cmF0ZWd5IGZvciBkZWR1cGxpY2F0aW5nIHJlLWZldGNoZWQgaW50ZXJ2YWxzOlxuICAgICAgICAgICAgLy8gXCJCZWNhdXNlIEJFRCBmaWxlcyBkb24ndCBhY3R1YWxseSB1c2UgSURzLCB0aGUgSUQgaXMgY29uc3RydWN0ZWQgZnJvbSB0aGUgZmVhdHVyZSdzIG5hbWUgKGlmIGFueSksIGNocm9tb3NvbWUgY29vcmRpbmF0ZXMsIHN0cmFuZCBhbmQgYmxvY2sgY291bnQuXCJcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGl0dmwuaWQpKSB7XG4gICAgICAgICAgICAgIGl0dmwuaWQgPSBbaXR2bC5uYW1lLCBpdHZsLmNocm9tLCBpdHZsLmNocm9tU3RhcnQsIGl0dmwuY2hyb21FbmQsIGl0dmwuc3RyYW5kLCBpdHZsLmJsb2NrQ291bnRdLmpvaW4oXCJcXHRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaXR2bDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBcbiAgICAvLyBHZXQgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiaWdCZWQgYW5kIHNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhlIFJlbW90ZVRyYWNrXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHsgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCB9LFxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAvLyBTZXQgbWF4RmV0Y2hXaW5kb3cgdG8gYXZvaWQgb3ZlcmZldGNoaW5nIGRhdGEuXG4gICAgICAgIGlmICghc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICAgICAgdmFyIG1lYW5JdGVtc1BlckJwID0gZGF0YS5pdGVtQ291bnQgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKHNlbGYub3B0cy5kcmF3TGltaXQpKTtcbiAgICAgICAgICBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICAgIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAvIDMpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93LCBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGZ1bmN0aW9uIHBhcnNlRGVuc2VEYXRhKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLCBcbiAgICAgICAgbGluZXM7XG4gICAgICBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccysvZyk7XG4gICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIHgpIHsgXG4gICAgICAgIGlmIChsaW5lICE9ICduL2EnICYmIGxpbmUubGVuZ3RoKSB7IGRyYXdTcGVjLnB1c2goe3g6IHgsIHc6IDEsIHY6IHBhcnNlRmxvYXQobGluZSkgKiAxMDAwfSk7IH0gXG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIGRlbnNpdHkgaXMgbm90ICdkZW5zZScgYW5kIHdlIGNhbiByZWFzb25hYmx5XG4gICAgLy8gZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtYW55IHJvd3MgKD41MDAgZmVhdHVyZXMpLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLCB7XG4gICAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCBkZW5zaXR5OiBkZW5zaXR5fSxcbiAgICAgICAgICBzdWNjZXNzOiBwYXJzZURlbnNlRGF0YVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgICB2YXIgY2FsY1BpeEludGVydmFsLCBkcmF3U3BlYyA9IHt9O1xuICAgICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5ID09ICdwYWNrJyk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKTtcbiAgICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnQmVkRm9ybWF0OyIsIlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnV2lnIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnV2lnLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBCaWdXaWdGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcxMjgsMTI4LDEyOCcsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdXaWcgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHsnbWluaW11bSc6MSwgJ21heGltdW0nOjEsICdtZWFuJzoxLCAnbWluJzoxLCAnbWF4JzoxLCAnc3RkJzoxLCAnY292ZXJhZ2UnOjF9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHNlbGYub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgIGFzeW5jOiBmYWxzZSwgIC8vIFRoaXMgaXMgY29vbCBzaW5jZSBwYXJzaW5nIG5vcm1hbGx5IGhhcHBlbnMgaW4gYSBXZWIgV29ya2VyXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciByb3dzID0gZGF0YS5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgXy5lYWNoKHJvd3MsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICB2YXIga2V5dmFsID0gci5zcGxpdCgnOiAnKTtcbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWluJykgeyBzZWxmLnJhbmdlWzBdID0gTWF0aC5taW4ocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzBdKTsgfVxuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtYXgnKSB7IHNlbGYucmFuZ2VbMV0gPSBNYXRoLm1heChwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMV0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGNoclJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZSA9PSAnbi9hJykgeyBkcmF3U3BlYy5iYXJzLnB1c2gobnVsbCk7IH1cbiAgICAgICAgZWxzZSBpZiAobGluZS5sZW5ndGgpIHsgZHJhd1NwZWMuYmFycy5wdXNoKChwYXJzZUZsb2F0KGxpbmUpIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTsgfVxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtyYW5nZTogY2hyUmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIHdpZHRoOiB3aWR0aCwgd2luRnVuYzogc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9ufSxcbiAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICB9KTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdXaWdGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBmZWF0dXJlVGFibGUgZm9ybWF0OiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmZlYXR1cmV0YWJsZVxudmFyIEZlYXR1cmVUYWJsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjb2xsYXBzZUJ5R2VuZTogJ29mZicsXG4gICAga2V5Q29sdW1uV2lkdGg6IDIxLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lID0gdGhpcy5pc09uKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSk7XG4gICAgdGhpcy5mZWF0dXJlVHlwZUNvdW50cyA9IHt9O1xuICB9LFxuICBcbiAgLy8gcGFyc2VzIG9uZSBmZWF0dXJlIGtleSArIGxvY2F0aW9uL3F1YWxpZmllcnMgcm93IGZyb20gdGhlIGZlYXR1cmUgdGFibGVcbiAgcGFyc2VFbnRyeTogZnVuY3Rpb24oY2hyb20sIGxpbmVzLCBzdGFydExpbmVObykge1xuICAgIHZhciBmZWF0dXJlID0ge1xuICAgICAgICBjaHJvbTogY2hyb20sXG4gICAgICAgIHNjb3JlOiAnPycsXG4gICAgICAgIGJsb2NrczogbnVsbCxcbiAgICAgICAgcXVhbGlmaWVyczoge31cbiAgICAgIH0sXG4gICAgICBrZXlDb2x1bW5XaWR0aCA9IHRoaXMub3B0cy5rZXlDb2x1bW5XaWR0aCxcbiAgICAgIHF1YWxpZmllciA9IG51bGwsXG4gICAgICBmdWxsTG9jYXRpb24gPSBbXSxcbiAgICAgIGNvbGxhcHNlS2V5UXVhbGlmaWVycyA9IFsnbG9jdXNfdGFnJywgJ2dlbmUnLCAnZGJfeHJlZiddLFxuICAgICAgcXVhbGlmaWVyc1RoYXRBcmVOYW1lcyA9IFsnZ2VuZScsICdsb2N1c190YWcnLCAnZGJfeHJlZiddLFxuICAgICAgUk5BVHlwZXMgPSBbJ3JybmEnLCAndHJuYSddLFxuICAgICAgYWxzb1RyeUZvclJOQVR5cGVzID0gWydwcm9kdWN0J10sXG4gICAgICBsb2NhdGlvblBvc2l0aW9ucywgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocm9tXTtcbiAgICBzdGFydExpbmVObyA9IHN0YXJ0TGluZU5vIHx8IDA7XG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmlsbCBvdXQgZmVhdHVyZSdzIGtleXMgd2l0aCBpbmZvIGZyb20gdGhlc2UgbGluZXNcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGtleSA9IGxpbmUuc3Vic3RyKDAsIGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcmVzdE9mTGluZSA9IGxpbmUuc3Vic3RyKGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcXVhbGlmaWVyTWF0Y2ggPSByZXN0T2ZMaW5lLm1hdGNoKC9eXFwvKFxcdyspKD0/KSguKikvKTtcbiAgICAgIGlmIChrZXkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGZlYXR1cmUudHlwZSA9IHN0cmlwKGtleSk7XG4gICAgICAgIHF1YWxpZmllciA9IG51bGw7XG4gICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHF1YWxpZmllck1hdGNoKSB7XG4gICAgICAgICAgcXVhbGlmaWVyID0gcXVhbGlmaWVyTWF0Y2hbMV07XG4gICAgICAgICAgaWYgKCFmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkgeyBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSA9IFtdOyB9XG4gICAgICAgICAgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0ucHVzaChbcXVhbGlmaWVyTWF0Y2hbMl0gPyBxdWFsaWZpZXJNYXRjaFszXSA6IHRydWVdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAocXVhbGlmaWVyICE9PSBudWxsKSB7IFxuICAgICAgICAgICAgXy5sYXN0KGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKS5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbi5qb2luKCcnKTtcbiAgICBsb2NhdGlvblBvc2l0aW9ucyA9IF8ubWFwKF8uZmlsdGVyKGZ1bGxMb2NhdGlvbi5zcGxpdCgvXFxEKy8pLCBfLmlkZW50aXR5KSwgcGFyc2VJbnQxMCk7XG4gICAgZmVhdHVyZS5jaHJvbVN0YXJ0ID0gIF8ubWluKGxvY2F0aW9uUG9zaXRpb25zKTtcbiAgICBmZWF0dXJlLmNocm9tRW5kID0gXy5tYXgobG9jYXRpb25Qb3NpdGlvbnMpICsgMTsgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaHJvbUVuZCBjb2x1bW5zIGluIEJFRCBmb3JtYXQgYXJlICpub3QqLlxuICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tU3RhcnQ7XG4gICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tRW5kOyBcbiAgICBmZWF0dXJlLnN0cmFuZCA9IC9jb21wbGVtZW50Ly50ZXN0KGZ1bGxMb2NhdGlvbikgPyBcIi1cIiA6IFwiK1wiO1xuICAgIFxuICAgIC8vIFVudGlsIHdlIG1lcmdlIGJ5IGdlbmUgbmFtZSwgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aGVzZVxuICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgIGZlYXR1cmUuYmxvY2tzID0gbnVsbDtcbiAgICBcbiAgICAvLyBQYXJzZSB0aGUgcXVhbGlmaWVycyBwcm9wZXJseVxuICAgIF8uZWFjaChmZWF0dXJlLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIF8uZWFjaCh2LCBmdW5jdGlvbihlbnRyeUxpbmVzLCBpKSB7XG4gICAgICAgIHZbaV0gPSBzdHJpcChlbnRyeUxpbmVzLmpvaW4oJyAnKSk7XG4gICAgICAgIGlmICgvXlwiW1xcc1xcU10qXCIkLy50ZXN0KHZbaV0pKSB7XG4gICAgICAgICAgLy8gRGVxdW90ZSBmcmVlIHRleHRcbiAgICAgICAgICB2W2ldID0gdltpXS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKS5yZXBsYWNlKC9cIlwiL2csICdcIicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vaWYgKHYubGVuZ3RoID09IDEpIHsgZmVhdHVyZS5xdWFsaWZpZXJzW2tdID0gdlswXTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZpbmQgc29tZXRoaW5nIHRoYXQgY2FuIHNlcnZlIGFzIGEgbmFtZVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUudHlwZTtcbiAgICBpZiAoXy5jb250YWlucyhSTkFUeXBlcywgZmVhdHVyZS50eXBlLnRvTG93ZXJDYXNlKCkpKSB7IFxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgYWxzb1RyeUZvclJOQVR5cGVzKTsgXG4gICAgfVxuICAgIF8uZmluZChxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBmdW5jdGlvbihrKSB7XG4gICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyByZXR1cm4gKGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7IH1cbiAgICB9KTtcbiAgICAvLyBJbiB0aGUgd29yc3QgY2FzZSwgYWRkIGEgY291bnRlciB0byBkaXNhbWJpZ3VhdGUgZmVhdHVyZXMgbmFtZWQgb25seSBieSB0eXBlXG4gICAgaWYgKGZlYXR1cmUubmFtZSA9PSBmZWF0dXJlLnR5cGUpIHtcbiAgICAgIGlmICghdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKSB7IHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSA9IDE7IH1cbiAgICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUubmFtZSArICdfJyArIHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSsrO1xuICAgIH1cbiAgICBcbiAgICAvLyBGaW5kIGEga2V5IHRoYXQgaXMgYXBwcm9wcmlhdGUgZm9yIGNvbGxhcHNpbmdcbiAgICBpZiAodGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmZpbmQoY29sbGFwc2VLZXlRdWFsaWZpZXJzLCBmdW5jdGlvbihrKSB7XG4gICAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IFxuICAgICAgICAgIHJldHVybiAoZmVhdHVyZS5fY29sbGFwc2VLZXkgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICAvLyBjb2xsYXBzZXMgbXVsdGlwbGUgZmVhdHVyZXMgdGhhdCBhcmUgYWJvdXQgdGhlIHNhbWUgZ2VuZSBpbnRvIG9uZSBkcmF3YWJsZSBmZWF0dXJlXG4gIGNvbGxhcHNlRmVhdHVyZXM6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XG4gICAgdmFyIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLFxuICAgICAgcHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvID0gWydtcm5hJywgJ2dlbmUnLCAnY2RzJ10sXG4gICAgICBwcmVmZXJyZWRUeXBlRm9yRXhvbnMgPSBbJ2V4b24nLCAnY2RzJ10sXG4gICAgICBtZXJnZUludG8gPSBmZWF0dXJlc1swXSxcbiAgICAgIGJsb2NrcyA9IFtdLFxuICAgICAgZm91bmRUeXBlLCBjZHMsIGV4b25zO1xuICAgIGZvdW5kVHlwZSA9IF8uZmluZChwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8sIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBmb3VuZCA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZm91bmQpIHsgbWVyZ2VJbnRvID0gZm91bmQ7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gTG9vayBmb3IgZXhvbnMgKGV1a2FyeW90aWMpIG9yIGEgQ0RTIChwcm9rYXJ5b3RpYylcbiAgICBfLmZpbmQocHJlZmVycmVkVHlwZUZvckV4b25zLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICBleG9ucyA9IF8uc2VsZWN0KGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChleG9ucy5sZW5ndGgpIHsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBjZHMgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IFwiY2RzXCI7IH0pO1xuICAgIFxuICAgIF8uZWFjaChleG9ucywgZnVuY3Rpb24oZXhvbkZlYXR1cmUpIHtcbiAgICAgIGV4b25GZWF0dXJlLmZ1bGxMb2NhdGlvbi5yZXBsYWNlKC8oXFxkKylcXC5cXC5bPjxdPyhcXGQrKS9nLCBmdW5jdGlvbihmdWxsTWF0Y2gsIHN0YXJ0LCBlbmQpIHtcbiAgICAgICAgYmxvY2tzLnB1c2goe1xuICAgICAgICAgIHN0YXJ0OiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgTWF0aC5taW4oc3RhcnQsIGVuZCksIFxuICAgICAgICAgIC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2UuXG4gICAgICAgICAgZW5kOiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgIE1hdGgubWF4KHN0YXJ0LCBlbmQpICsgMVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIENvbnZlcnQgZXhvbnMgYW5kIENEUyBpbnRvIGJsb2NrcywgdGhpY2tTdGFydCBhbmQgdGhpY2tFbmQgKGluIEJFRCB0ZXJtaW5vbG9neSlcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCkgeyBcbiAgICAgIG1lcmdlSW50by5ibG9ja3MgPSBfLnNvcnRCeShibG9ja3MsIGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGIuc3RhcnQ7IH0pO1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrU3RhcnQgPSBjZHMgPyBjZHMuc3RhcnQgOiBmZWF0dXJlLnN0YXJ0O1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrRW5kID0gY2RzID8gY2RzLmVuZCA6IGZlYXR1cmUuZW5kO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaW5hbGx5LCBtZXJnZSBhbGwgdGhlIHF1YWxpZmllcnNcbiAgICBfLmVhY2goZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHtcbiAgICAgIGlmIChmZWF0ID09PSBtZXJnZUludG8pIHsgcmV0dXJuOyB9XG4gICAgICBfLmVhY2goZmVhdC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2YWx1ZXMsIGspIHtcbiAgICAgICAgaWYgKCFtZXJnZUludG8ucXVhbGlmaWVyc1trXSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXSA9IFtdOyB9XG4gICAgICAgIF8uZWFjaCh2YWx1ZXMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICBpZiAoIV8uY29udGFpbnMobWVyZ2VJbnRvLnF1YWxpZmllcnNba10sIHYpKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLnB1c2godik7IH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VJbnRvO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgbnVtTGluZXMgPSBsaW5lcy5sZW5ndGgsXG4gICAgICBjaHJvbSA9IG51bGwsXG4gICAgICBsYXN0RW50cnlTdGFydCA9IG51bGwsXG4gICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXkgPSB7fSxcbiAgICAgIGZlYXR1cmU7XG4gICAgXG4gICAgZnVuY3Rpb24gY29sbGVjdExhc3RFbnRyeShsaW5lbm8pIHtcbiAgICAgIGlmIChsYXN0RW50cnlTdGFydCAhPT0gbnVsbCkge1xuICAgICAgICBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VFbnRyeS5jYWxsKHNlbGYsIGNocm9tLCBsaW5lcy5zbGljZShsYXN0RW50cnlTdGFydCwgbGluZW5vKSwgbGFzdEVudHJ5U3RhcnQpO1xuICAgICAgICBpZiAoZmVhdHVyZSkgeyBcbiAgICAgICAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSA9IGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gfHwgW107XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldLnB1c2goZmVhdHVyZSk7XG4gICAgICAgICAgfSBlbHNlIHsgZGF0YS5hZGQoZmVhdHVyZSk7IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBDaHVuayB0aGUgbGluZXMgaW50byBlbnRyaWVzIGFuZCBwYXJzZSBlYWNoIG9mIHRoZW1cbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgaWYgKGxpbmUuc3Vic3RyKDAsIDEyKSA9PSBcIkFDQ0VTU0lPTiAgIFwiKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgY2hyb20gPSBsaW5lLnN1YnN0cigxMik7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbDtcbiAgICAgIH0gZWxzZSBpZiAoY2hyb20gIT09IG51bGwgJiYgbGluZS5zdWJzdHIoNSwgMSkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBsaW5lbm87XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gcGFyc2UgdGhlIGxhc3QgZW50cnlcbiAgICBpZiAoY2hyb20gIT09IG51bGwpIHsgY29sbGVjdExhc3RFbnRyeShsaW5lcy5sZW5ndGgpOyB9XG4gICAgXG4gICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZWFjaChmZWF0dXJlc0J5Q29sbGFwc2VLZXksIGZ1bmN0aW9uKGZlYXR1cmVzLCBnZW5lKSB7XG4gICAgICAgIGRhdGEuYWRkKHNlbGYudHlwZSgpLmNvbGxhcHNlRmVhdHVyZXMuY2FsbChzZWxmLCBmZWF0dXJlcykpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHF1YWxpZmllcnNUb0FiYnJldmlhdGUgPSB7dHJhbnNsYXRpb246IDF9LFxuICAgICAgY29udGVudCA9IHtcbiAgICAgICAgdHlwZTogZGF0YS5kLnR5cGUsXG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9O1xuICAgIGlmIChkYXRhLmQucXVhbGlmaWVycy5ub3RlICYmIGRhdGEuZC5xdWFsaWZpZXJzLm5vdGVbMF0pIHsgIH1cbiAgICBfLmVhY2goZGF0YS5kLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIGlmIChrID09ICdub3RlJykgeyBjb250ZW50LmRlc2NyaXB0aW9uID0gdi5qb2luKCc7ICcpOyByZXR1cm47IH1cbiAgICAgIGNvbnRlbnRba10gPSB2LmpvaW4oJzsgJyk7XG4gICAgICBpZiAocXVhbGlmaWVyc1RvQWJicmV2aWF0ZVtrXSAmJiBjb250ZW50W2tdLmxlbmd0aCA+IDI1KSB7IGNvbnRlbnRba10gPSBjb250ZW50W2tdLnN1YnN0cigwLCAyNSkgKyAnLi4uJzsgfVxuICAgIH0pO1xuICAgIHJldHVybiBjb250ZW50O1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuZHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMudHlwZSgnYmVkJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmVhdHVyZVRhYmxlRm9ybWF0OyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7ICBcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBCeSBTaGluIFN1enVraSwgTUlUIGxpY2Vuc2VcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGlub3V0L2ludGVydmFsLXRyZWVcbiAqIEludGVydmFsVHJlZVxuICpcbiAqIEBwYXJhbSAob2JqZWN0KSBkYXRhOlxuICogQHBhcmFtIChudW1iZXIpIGNlbnRlcjpcbiAqIEBwYXJhbSAob2JqZWN0KSBvcHRpb25zOlxuICogICBjZW50ZXI6XG4gKlxuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucykge1xuICBvcHRpb25zIHx8IChvcHRpb25zID0ge30pO1xuXG4gIHRoaXMuc3RhcnRLZXkgICAgID0gb3B0aW9ucy5zdGFydEtleSB8fCAwOyAvLyBzdGFydCBrZXlcbiAgdGhpcy5lbmRLZXkgICAgICAgPSBvcHRpb25zLmVuZEtleSAgIHx8IDE7IC8vIGVuZCBrZXlcbiAgdGhpcy5pbnRlcnZhbEhhc2ggPSB7fTsgICAgICAgICAgICAgICAgICAgIC8vIGlkID0+IGludGVydmFsIG9iamVjdFxuICB0aGlzLnBvaW50VHJlZSA9IG5ldyBTb3J0ZWRMaXN0KHsgICAgICAgICAgLy8gYi10cmVlIG9mIHN0YXJ0LCBlbmQgcG9pbnRzIFxuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYVswXS0gYlswXTtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQgPSAwO1xuXG4gIC8vIGluZGV4IG9mIHRoZSByb290IG5vZGVcbiAgaWYgKCFjZW50ZXIgfHwgdHlwZW9mIGNlbnRlciAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBjZW50ZXIgaW5kZXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IG5ldyBOb2RlKGNlbnRlciwgdGhpcyk7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICBpZiAodGhpcy5jb250YWlucyhpZCkpIHtcbiAgICB0aHJvdyBuZXcgRHVwbGljYXRlRXJyb3IoJ2lkICcgKyBpZCArICcgaXMgYWxyZWFkeSByZWdpc3RlcmVkLicpO1xuICB9XG5cbiAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgIHdoaWxlICh0aGlzLmludGVydmFsSGFzaFt0aGlzLl9hdXRvSW5jcmVtZW50XSkge1xuICAgICAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICAgIH1cbiAgICBpZCA9IHRoaXMuX2F1dG9JbmNyZW1lbnQ7XG4gIH1cblxuICB2YXIgaXR2bCA9IG5ldyBJbnRlcnZhbChkYXRhLCBpZCwgdGhpcy5zdGFydEtleSwgdGhpcy5lbmRLZXkpO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuc3RhcnQsIGlkXSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5lbmQsICAgaWRdKTtcbiAgdGhpcy5pbnRlcnZhbEhhc2hbaWRdID0gaXR2bDtcbiAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICBcbiAgX2luc2VydC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgaXR2bCk7XG59O1xuXG5cbi8qKlxuICogY2hlY2sgaWYgcmFuZ2UgaXMgYWxyZWFkeSBwcmVzZW50LCBiYXNlZCBvbiBpdHMgaWRcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuY29udGFpbnMgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gISF0aGlzLmdldChpZCk7XG59XG5cblxuLyoqXG4gKiByZXRyaWV2ZSBhbiBpbnRlcnZhbCBieSBpdHMgaWQ7IHJldHVybnMgbnVsbCBpZiBpdCBkb2VzIG5vdCBleGlzdFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gdGhpcy5pbnRlcnZhbEhhc2hbaWRdIHx8IG51bGw7XG59XG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlIG9ubHkgaWYgaXQgaXMgbmV3LCBiYXNlZCBvbiB3aGV0aGVyIHRoZSBpZCB3YXMgYWxyZWFkeSByZWdpc3RlcmVkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3ID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgdHJ5IHtcbiAgICB0aGlzLmFkZChkYXRhLCBpZCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIER1cGxpY2F0ZUVycm9yKSB7IHJldHVybjsgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAoaW50ZWdlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIpIHtcbiAgdmFyIHJldCA9IFtdO1xuICBpZiAodHlwZW9mIHZhbDEgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuXG4gIGlmICh2YWwyID09IHVuZGVmaW5lZCkge1xuICAgIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgdmFsMSwgcmV0KTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2YgdmFsMiA9PSAnbnVtYmVyJykge1xuICAgIF9yYW5nZVNlYXJjaC5jYWxsKHRoaXMsIHZhbDEsIHZhbDIsIHJldCk7XG4gIH1cbiAgZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnLCcgKyB2YWwyICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiBcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyB0aGUgc2hpZnQtcmlnaHQtYW5kLWZpbGwgb3BlcmF0b3IsIGV4dGVuZGVkIGJleW9uZCB0aGUgcmFuZ2Ugb2YgYW4gaW50MzJcbmZ1bmN0aW9uIF9iaXRTaGlmdFJpZ2h0KG51bSkge1xuICBpZiAobnVtID4gMjE0NzQ4MzY0NyB8fCBudW0gPCAtMjE0NzQ4MzY0OCkgeyByZXR1cm4gTWF0aC5mbG9vcihudW0gLyAyKTsgfVxuICByZXR1cm4gbnVtID4+PiAxO1xufVxuXG4vKipcbiAqIF9pbnNlcnRcbiAqKi9cbmZ1bmN0aW9uIF9pbnNlcnQobm9kZSwgaXR2bCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChpdHZsLmVuZCA8IG5vZGUuaWR4KSB7XG4gICAgICBpZiAoIW5vZGUubGVmdCkge1xuICAgICAgICBub2RlLmxlZnQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChub2RlLmlkeCA8IGl0dmwuc3RhcnQpIHtcbiAgICAgIGlmICghbm9kZS5yaWdodCkge1xuICAgICAgICBub2RlLnJpZ2h0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG5vZGUuaW5zZXJ0KGl0dmwpO1xuICAgIH1cbiAgfVxufVxuXG5cbi8qKlxuICogX3BvaW50U2VhcmNoXG4gKiBAcGFyYW0gKE5vZGUpIG5vZGVcbiAqIEBwYXJhbSAoaW50ZWdlcikgaWR4IFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcG9pbnRTZWFyY2gobm9kZSwgaWR4LCBhcnIpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoIW5vZGUpIGJyZWFrO1xuICAgIGlmIChpZHggPCBub2RlLmlkeCkge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5zdGFydCA8PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAoaWR4ID4gbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuZW5kcy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLmVuZCA+PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLm1hcChmdW5jdGlvbihpdHZsKSB7IGFyci5wdXNoKGl0dmwucmVzdWx0KCkpIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cblxuXG4vKipcbiAqIF9yYW5nZVNlYXJjaFxuICogQHBhcmFtIChpbnRlZ2VyKSBzdGFydFxuICogQHBhcmFtIChpbnRlZ2VyKSBlbmRcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3JhbmdlU2VhcmNoKHN0YXJ0LCBlbmQsIGFycikge1xuICBpZiAoZW5kIC0gc3RhcnQgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kIG11c3QgYmUgZ3JlYXRlciB0aGFuIHN0YXJ0LiBzdGFydDogJyArIHN0YXJ0ICsgJywgZW5kOiAnICsgZW5kKTtcbiAgfVxuICB2YXIgcmVzdWx0SGFzaCA9IHt9O1xuXG4gIHZhciB3aG9sZVdyYXBzID0gW107XG4gIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgX2JpdFNoaWZ0UmlnaHQoc3RhcnQgKyBlbmQpLCB3aG9sZVdyYXBzLCB0cnVlKTtcblxuICB3aG9sZVdyYXBzLmZvckVhY2goZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgcmVzdWx0SGFzaFtyZXN1bHQuaWRdID0gdHJ1ZTtcbiAgfSk7XG5cblxuICB2YXIgaWR4MSA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW3N0YXJ0LCBudWxsXSk7XG4gIHdoaWxlIChpZHgxID49IDAgJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDFdWzBdID09IHN0YXJ0KSB7XG4gICAgaWR4MS0tO1xuICB9XG5cbiAgdmFyIGlkeDIgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtlbmQsICAgbnVsbF0pO1xuICB2YXIgbGVuID0gdGhpcy5wb2ludFRyZWUuYXJyLmxlbmd0aCAtIDE7XG4gIHdoaWxlIChpZHgyID09IC0xIHx8IChpZHgyIDw9IGxlbiAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4Ml1bMF0gPD0gZW5kKSkge1xuICAgIGlkeDIrKztcbiAgfVxuXG4gIHRoaXMucG9pbnRUcmVlLmFyci5zbGljZShpZHgxICsgMSwgaWR4MikuZm9yRWFjaChmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBpZCA9IHBvaW50WzFdO1xuICAgIHJlc3VsdEhhc2hbaWRdID0gdHJ1ZTtcbiAgfSwgdGhpcyk7XG5cbiAgT2JqZWN0LmtleXMocmVzdWx0SGFzaCkuZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgIHZhciBpdHZsID0gdGhpcy5pbnRlcnZhbEhhc2hbaWRdO1xuICAgIGFyci5wdXNoKGl0dmwucmVzdWx0KHN0YXJ0LCBlbmQpKTtcbiAgfSwgdGhpcyk7XG5cbn1cblxuXG5cbi8qKlxuICogc3ViY2xhc3Nlc1xuICogXG4gKiovXG5cblxuLyoqXG4gKiBOb2RlIDogcHJvdG90eXBlIG9mIGVhY2ggbm9kZSBpbiBhIGludGVydmFsIHRyZWVcbiAqIFxuICoqL1xuZnVuY3Rpb24gTm9kZShpZHgpIHtcbiAgdGhpcy5pZHggPSBpZHg7XG4gIHRoaXMuc3RhcnRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVuZHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLmVuZCAtIGIuZW5kO1xuICAgICAgcmV0dXJuIChjIDwgMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIGluc2VydCBhbiBJbnRlcnZhbCBvYmplY3QgdG8gdGhpcyBub2RlXG4gKiovXG5Ob2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihpbnRlcnZhbCkge1xuICB0aGlzLnN0YXJ0cy5pbnNlcnQoaW50ZXJ2YWwpO1xuICB0aGlzLmVuZHMuaW5zZXJ0KGludGVydmFsKTtcbn07XG5cblxuXG4vKipcbiAqIEludGVydmFsIDogcHJvdG90eXBlIG9mIGludGVydmFsIGluZm9cbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsKGRhdGEsIGlkLCBzLCBlKSB7XG4gIHRoaXMuaWQgICAgID0gaWQ7XG4gIHRoaXMuc3RhcnQgID0gZGF0YVtzXTtcbiAgdGhpcy5lbmQgICAgPSBkYXRhW2VdO1xuICB0aGlzLmRhdGEgICA9IGRhdGE7XG5cbiAgaWYgKHR5cGVvZiB0aGlzLnN0YXJ0ICE9ICdudW1iZXInIHx8IHR5cGVvZiB0aGlzLmVuZCAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQsIGVuZCBtdXN0IGJlIG51bWJlci4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG5cbiAgaWYgKCB0aGlzLnN0YXJ0ID49IHRoaXMuZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCBtdXN0IGJlIHNtYWxsZXIgdGhhbiBlbmQuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxufVxuXG4vKipcbiAqIGdldCByZXN1bHQgb2JqZWN0XG4gKiovXG5JbnRlcnZhbC5wcm90b3R5cGUucmVzdWx0ID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0ge1xuICAgIGlkICAgOiB0aGlzLmlkLFxuICAgIGRhdGEgOiB0aGlzLmRhdGFcbiAgfTtcbiAgaWYgKHR5cGVvZiBzdGFydCA9PSAnbnVtYmVyJyAmJiB0eXBlb2YgZW5kID09ICdudW1iZXInKSB7XG4gICAgLyoqXG4gICAgICogY2FsYyBvdmVybGFwcGluZyByYXRlXG4gICAgICoqL1xuICAgIHZhciBsZWZ0ICA9IE1hdGgubWF4KHRoaXMuc3RhcnQsIHN0YXJ0KTtcbiAgICB2YXIgcmlnaHQgPSBNYXRoLm1pbih0aGlzLmVuZCwgICBlbmQpO1xuICAgIHZhciBsYXBMbiA9IHJpZ2h0IC0gbGVmdDtcbiAgICByZXQucmF0ZTEgPSBsYXBMbiAvIChlbmQgLSBzdGFydCk7XG4gICAgcmV0LnJhdGUyID0gbGFwTG4gLyAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0KTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gRHVwbGljYXRlRXJyb3IobWVzc2FnZSkge1xuICAgIHRoaXMubmFtZSA9ICdEdXBsaWNhdGVFcnJvcic7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLnN0YWNrID0gKG5ldyBFcnJvcigpKS5zdGFjaztcbn1cbkR1cGxpY2F0ZUVycm9yLnByb3RvdHlwZSA9IG5ldyBFcnJvcjtcblxuZXhwb3J0cy5JbnRlcnZhbFRyZWUgPSBJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gTGluZU1hc2s6IEEgKHZlcnkgY2hlYXApIGFsdGVybmF0aXZlIHRvIEludGVydmFsVHJlZTogYSBzbWFsbCwgMUQgcGl4ZWwgYnVmZmVyIG9mIG9iamVjdHMuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcblxuZnVuY3Rpb24gTGluZU1hc2sod2lkdGgsIGZ1ZGdlKSB7XG4gIHRoaXMuZnVkZ2UgPSBmdWRnZSA9IChmdWRnZSB8fCAxKTtcbiAgdGhpcy5pdGVtcyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IE1hdGguY2VpbCh3aWR0aCAvIGZ1ZGdlKTtcbiAgdGhpcy5tYXNrID0gZ2xvYmFsLlVpbnQ4QXJyYXkgPyBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aCkgOiBuZXcgQXJyYXkodGhpcy5sZW5ndGgpO1xufVxuXG5MaW5lTWFzay5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oeCwgdywgZGF0YSkge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIHRoaXMuaXRlbXMucHVzaCh7eDogeCwgdzogdywgZGF0YTogZGF0YX0pO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyB0aGlzLm1hc2tbaV0gPSAxOyB9XG59O1xuXG5MaW5lTWFzay5wcm90b3R5cGUuY29uZmxpY3QgPSBmdW5jdGlvbih4LCB3KSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgaWYgKHRoaXMubWFza1tpXSkgcmV0dXJuIHRydWU7IH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuZXhwb3J0cy5MaW5lTWFzayA9IExpbmVNYXNrO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTsgIFxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xudmFyIHBhcnNlSW50MTAgPSByZXF1aXJlKCcuL3V0aWxzLmpzJykucGFyc2VJbnQxMDtcblxudmFyIFBBSVJJTkdfQ0FOTk9UX01BVEUgPSAwLFxuICBQQUlSSU5HX01BVEVfT05MWSA9IDEsXG4gIFBBSVJJTkdfRFJBV19BU19NQVRFUyA9IDI7XG5cbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogV3JhcHMgdHdvIG9mIFNoaW4gU3V6dWtpJ3MgSW50ZXJ2YWxUcmVlcyB0byBzdG9yZSBpbnRlcnZhbHMgdGhhdCAqbWF5KlxuICogYmUgcGFpcmVkLlxuICpcbiAqIEBzZWUgSW50ZXJ2YWxUcmVlKClcbiAqKi9cbmZ1bmN0aW9uIFBhaXJlZEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucywgcGFpcmVkT3B0aW9ucykge1xuICB2YXIgZGVmYXVsdE9wdGlvbnMgPSB7c3RhcnRLZXk6IDAsIGVuZEtleTogMX07XG4gIFxuICB0aGlzLnVucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMudW5wYWlyZWRPcHRpb25zID0gXy5leHRlbmQoe30sIGRlZmF1bHRPcHRpb25zLCB1bnBhaXJlZE9wdGlvbnMpO1xuICBcbiAgdGhpcy5wYWlyZWQgPSBuZXcgSW50ZXJ2YWxUcmVlKGNlbnRlciwgcGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHtwYWlyaW5nS2V5OiAncW5hbWUnLCBwYWlyZWRMZW5ndGhLZXk6ICd0bGVuJ30sIGRlZmF1bHRPcHRpb25zLCBwYWlyZWRPcHRpb25zKTtcbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0S2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBpZiAodGhpcy5wYWlyZWRPcHRpb25zLmVuZEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdlbmRLZXkgZm9yIHVucGFpcmVkT3B0aW9ucyBhbmQgcGFpcmVkT3B0aW9ucyBtdXN0IGJlIGRpZmZlcmVudCBpbiBhIFBhaXJlZEludGVydmFsVHJlZScpO1xuICB9XG4gIFxuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IGZhbHNlO1xuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbnVsbDtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBEaXNhYmxlcyBwYWlyaW5nLiBFZmZlY3RpdmVseSBtYWtlcyB0aGlzIGVxdWl2YWxlbnQsIGV4dGVybmFsbHksIHRvIGFuIEludGVydmFsVHJlZS5cbiAqIFRoaXMgaXMgdXNlZnVsIGlmIHdlIGRpc2NvdmVyIHRoYXQgdGhpcyBkYXRhIHNvdXJjZSBkb2Vzbid0IGNvbnRhaW4gcGFpcmVkIHJlYWRzLlxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5kaXNhYmxlUGFpcmluZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IHRydWU7XG4gIHRoaXMucGFpcmVkID0gdGhpcy51bnBhaXJlZDtcbn07XG5cblxuLyoqXG4gKiBTZXQgYW4gaW50ZXJ2YWwgd2l0aGluIHdoaWNoIHBhaXJlZCBtYXRlcyB3aWxsIGJlIHNhdmVkIGFzIGEgY29udGludW91cyBmZWF0dXJlIGluIC5wYWlyZWRcbiAqXG4gKiBAcGFyYW0gKG51bWJlcikgbWluOiBNaW5pbXVtIGRpc3RhbmNlLCBpbiBicFxuICogQHBhcmFtIChudW1iZXIpIG1heDogTWF4aW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuc2V0UGFpcmluZ0ludGVydmFsID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgaWYgKHR5cGVvZiBtaW4gIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1pbiBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgIT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBiZSBjYWxsZWQgb25jZS4gWW91IGNhblxcJ3QgY2hhbmdlIHRoZSBwYWlyaW5nIGludGVydmFsLicpOyB9XG4gIFxuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IG1pbjtcbiAgdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgPSBtYXg7XG59O1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHZhciBtYXRlZCA9IGZhbHNlLFxuICAgIGluY3JlbWVudCA9IDAsXG4gICAgdW5wYWlyZWRTdGFydCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHVucGFpcmVkRW5kID0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZFN0YXJ0ID0gdGhpcy5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHBhaXJlZEVuZCA9IHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXksXG4gICAgcGFpcmVkTGVuZ3RoID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmVkTGVuZ3RoS2V5XSxcbiAgICBwYWlyaW5nU3RhdGUgPSBQQUlSSU5HX0NBTk5PVF9NQVRFLFxuICAgIG5ld0lkLCBwb3RlbnRpYWxNYXRlO1xuICBcbiAgLy8gLnVucGFpcmVkIGNvbnRhaW5zIGV2ZXJ5IGFsaWdubWVudCBhcyBhIHNlcGFyYXRlIGludGVydmFsLlxuICAvLyBJZiBpdCBhbHJlYWR5IGNvbnRhaW5zIHRoaXMgaWQsIHdlJ3ZlIHNlZW4gdGhpcyByZWFkIGJlZm9yZSBhbmQgc2hvdWxkIGRpc3JlZ2FyZC5cbiAgaWYgKHRoaXMudW5wYWlyZWQuY29udGFpbnMoaWQpKSB7IHJldHVybjsgfVxuICB0aGlzLnVucGFpcmVkLmFkZChkYXRhLCBpZCk7XG4gIFxuICAvLyAucGFpcmVkIGNvbnRhaW5zIGFsaWdubWVudHMgdGhhdCBtYXkgYmUgbWF0ZWQgaW50byBvbmUgaW50ZXJ2YWwgaWYgdGhleSBhcmUgd2l0aGluIHRoZSBwYWlyaW5nIHJhbmdlXG4gIGlmICghdGhpcy5wYWlyaW5nRGlzYWJsZWQgJiYgX2VsaWdpYmxlRm9yUGFpcmluZyh0aGlzLCBkYXRhKSkge1xuICAgIGlmICh0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9PT0gbnVsbCkgeyBcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYWRkIHBhaXJlZCBkYXRhIGFmdGVyIHRoZSBwYWlyaW5nIGludGVydmFsIGhhcyBiZWVuIHNldCEnKTtcbiAgICB9XG4gICAgXG4gICAgLy8gaW5zdGVhZCBvZiBzdG9yaW5nIHRoZW0gd2l0aCB0aGUgZ2l2ZW4gaWQsIHRoZSBwYWlyaW5nS2V5IChmb3IgQkFNLCBRTkFNRSkgaXMgdXNlZCBhcyB0aGUgaWQuXG4gICAgLy8gQXMgaW50ZXJ2YWxzIGFyZSBhZGRlZCwgd2UgY2hlY2sgaWYgYSByZWFkIHdpdGggdGhlIHNhbWUgcGFpcmluZ0tleSBhbHJlYWR5IGV4aXN0cyBpbiB0aGUgLnBhaXJlZCBJbnRlcnZhbFRyZWUuXG4gICAgbmV3SWQgPSBkYXRhW3RoaXMucGFpcmVkT3B0aW9ucy5wYWlyaW5nS2V5XTtcbiAgICBwb3RlbnRpYWxNYXRlID0gdGhpcy5wYWlyZWQuZ2V0KG5ld0lkKTtcbiAgICBcbiAgICBpZiAocG90ZW50aWFsTWF0ZSAhPT0gbnVsbCkge1xuICAgICAgcG90ZW50aWFsTWF0ZSA9IHBvdGVudGlhbE1hdGUuZGF0YTtcbiAgICAgIHBhaXJpbmdTdGF0ZSA9IF9wYWlyaW5nU3RhdGUodGhpcywgZGF0YSwgcG90ZW50aWFsTWF0ZSk7XG4gICAgICAvLyBBcmUgdGhlIHJlYWRzIHN1aXRhYmxlIGZvciBtYXRpbmc/XG4gICAgICBpZiAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVMgfHwgcGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX01BVEVfT05MWSkge1xuICAgICAgICAvLyBJZiB5ZXM6IG1hdGUgdGhlIHJlYWRzXG4gICAgICAgIHBvdGVudGlhbE1hdGUubWF0ZSA9IGRhdGE7XG4gICAgICAgIC8vIEluIHRoZSBvdGhlciBkaXJlY3Rpb24sIGhhcyB0byBiZSBhIHNlbGVjdGl2ZSBzaGFsbG93IGNvcHkgdG8gYXZvaWQgY2lyY3VsYXIgcmVmZXJlbmNlcy5cbiAgICAgICAgZGF0YS5tYXRlID0gXy5leHRlbmQoe30sIF8ub21pdChwb3RlbnRpYWxNYXRlLCBmdW5jdGlvbih2LCBrKSB7IHJldHVybiBfLmlzT2JqZWN0KHYpfSkpO1xuICAgICAgICBkYXRhLm1hdGUuZmxhZ3MgPSBfLmNsb25lKHBvdGVudGlhbE1hdGUuZmxhZ3MpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBBcmUgdGhlIG1hdGVkIHJlYWRzIHdpdGhpbiBkcmF3YWJsZSByYW5nZT8gSWYgc28sIHNpbXBseSBmbGFnIHRoYXQgdGhleSBzaG91bGQgYmUgZHJhd24gdG9nZXRoZXIsIGFuZCB0aGV5IHdpbGwuXG4gICAgLy8gQWx0ZXJuYXRpdmVseSwgaWYgdGhlIHBvdGVudGlhbE1hdGUgZXhwZWN0ZWQgYSBtYXRlLCB3ZSBzaG91bGQgbWF0ZSB0aGVtIGFueXdheS5cbiAgICAvLyBUaGUgb25seSByZWFzb24gd2Ugd291bGRuJ3QgZ2V0IC5kcmF3QXNNYXRlcyBpcyBpZiB0aGUgbWF0ZSB3YXMgb24gdGhlIHRocmVzaG9sZCBvZiB0aGUgaW5zZXJ0IHNpemUgcmFuZ2UuXG4gICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTIHx8IChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfTUFURV9PTkxZICYmIHBvdGVudGlhbE1hdGUubWF0ZUV4cGVjdGVkKSkge1xuICAgICAgZGF0YS5kcmF3QXNNYXRlcyA9IHBvdGVudGlhbE1hdGUuZHJhd0FzTWF0ZXMgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPdGhlcndpc2UsIG5lZWQgdG8gaW5zZXJ0IHRoaXMgcmVhZCBpbnRvIHRoaXMucGFpcmVkIGFzIGEgc2VwYXJhdGUgcmVhZC5cbiAgICAgIC8vIEVuc3VyZSB0aGUgaWQgaXMgdW5pcXVlIGZpcnN0LlxuICAgICAgd2hpbGUgKHRoaXMucGFpcmVkLmNvbnRhaW5zKG5ld0lkKSkge1xuICAgICAgICBuZXdJZCA9IG5ld0lkLnJlcGxhY2UoL1xcdC4qLywgJycpICsgXCJcXHRcIiArICgrK2luY3JlbWVudCk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGRhdGEubWF0ZUV4cGVjdGVkID0gX3BhaXJpbmdTdGF0ZSh0aGlzLCBkYXRhKSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTO1xuICAgICAgLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgcGVyaGFwcyBhIGJpdCB0b28gc3BlY2lmaWMgdG8gaG93IFRMRU4gZm9yIEJBTSBmaWxlcyB3b3JrczsgY291bGQgZ2VuZXJhbGl6ZSBsYXRlclxuICAgICAgLy8gV2hlbiBpbnNlcnRpbmcgaW50byAucGFpcmVkLCB0aGUgaW50ZXJ2YWwncyAuc3RhcnQgYW5kIC5lbmQgc2hvdWxkbid0IGJlIGJhc2VkIG9uIFBPUyBhbmQgdGhlIENJR0FSIHN0cmluZztcbiAgICAgIC8vIHdlIG11c3QgYWRqdXN0IHRoZW0gZm9yIFRMRU4sIGlmIGl0IGlzIG5vbnplcm8sIGRlcGVuZGluZyBvbiBpdHMgc2lnbiwgYW5kIHNldCBuZXcgYm91bmRzIGZvciB0aGUgaW50ZXJ2YWwuXG4gICAgICBpZiAoZGF0YS5tYXRlRXhwZWN0ZWQgJiYgcGFpcmVkTGVuZ3RoID4gMCkge1xuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRTdGFydF07XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRTdGFydF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEubWF0ZUV4cGVjdGVkICYmIHBhaXJlZExlbmd0aCA8IDApIHtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZEVuZF07XG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZEVuZF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgeyAvLyAhZGF0YS5tYXRlRXhwZWN0ZWQgfHwgcGFpcmVkTGVuZ3RoID09IDBcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdO1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkRW5kXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdGhpcy5wYWlyZWQuYWRkKGRhdGEsIG5ld0lkKTtcbiAgICB9XG4gIH1cblxufTtcblxuXG4vKipcbiAqIGFsaWFzIC5hZGQoKSB0byAuYWRkSWZOZXcoKVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBQYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3O1xuXG5cbi8qKlxuICogc2VhcmNoXG4gKlxuICogQHBhcmFtIChudW1iZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyLCBwYWlyZWQpIHtcbiAgaWYgKHBhaXJlZCAmJiAhdGhpcy5wYWlyaW5nRGlzYWJsZWQpIHtcbiAgICByZXR1cm4gdGhpcy5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB0aGlzLnVucGFpcmVkLnNlYXJjaCh2YWwxLCB2YWwyKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIHJlbW92ZTogdW5pbXBsZW1lbnRlZCBmb3Igbm93XG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIENoZWNrIGlmIGFuIGl0dmwgaXMgZWxpZ2libGUgZm9yIHBhaXJpbmcuIFxuLy8gRm9yIG5vdywgdGhpcyBtZWFucyB0aGF0IGlmIGFueSBGTEFHJ3MgMHgxMDAgb3IgaGlnaGVyIGFyZSBzZXQsIHdlIHRvdGFsbHkgZGlzY2FyZCB0aGlzIGFsaWdubWVudCBhbmQgaW50ZXJ2YWwuXG4vLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBlbnRhbmdsZWQgd2l0aCBiYW0uanMgaW50ZXJuYWxzOyBwZXJoYXBzIGFsbG93IHRoaXMgdG8gYmUgZ2VuZXJhbGl6ZWQsIG92ZXJyaWRkZW4sXG4vLyAgICAgICAgb3Igc2V0IGFsb25nc2lkZSAuc2V0UGFpcmluZ0ludGVydmFsKClcbi8vXG4vLyBAcmV0dXJuIChib29sZWFuKVxuZnVuY3Rpb24gX2VsaWdpYmxlRm9yUGFpcmluZyhwYWlyZWRJdHZsVHJlZSwgaXR2bCkge1xuICB2YXIgZmxhZ3MgPSBpdHZsLmZsYWdzO1xuICBpZiAoZmxhZ3MuaXNTZWNvbmRhcnlBbGlnbm1lbnQgfHwgZmxhZ3MuaXNSZWFkRmFpbGluZ1ZlbmRvclFDIHx8IGZsYWdzLmlzRHVwbGljYXRlUmVhZCB8fCBmbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIENoZWNrIGlmIGFuIGl0dmwgYW5kIGl0cyBwb3RlbnRpYWxNYXRlIGFyZSB3aXRoaW4gdGhlIHJpZ2h0IGRpc3RhbmNlLCBhbmQgb3JpZW50YXRpb24sIHRvIGJlIG1hdGVkLlxuLy8gSWYgcG90ZW50aWFsTWF0ZSBpc24ndCBnaXZlbiwgdGFrZXMgYSBiZXN0IGd1ZXNzIGlmIGEgbWF0ZSBpcyBleHBlY3RlZCwgZ2l2ZW4gdGhlIGluZm9ybWF0aW9uIGluIGl0dmwgYWxvbmUuXG4vLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBlbnRhbmdsZWQgd2l0aCBiYW0uanMgaW50ZXJuYWxzOyBwZXJoYXBzIGFsbG93IHRoaXMgdG8gYmUgZ2VuZXJhbGl6ZWQsIG92ZXJyaWRkZW4sXG4vLyAgICAgICAgb3Igc2V0IGFsb25nc2lkZSAuc2V0UGFpcmluZ0ludGVydmFsKClcbi8vIFxuLy8gQHJldHVybiAobnVtYmVyKVxuZnVuY3Rpb24gX3BhaXJpbmdTdGF0ZShwYWlyZWRJdHZsVHJlZSwgaXR2bCwgcG90ZW50aWFsTWF0ZSkge1xuICB2YXIgdGxlbiA9IGl0dmxbcGFpcmVkSXR2bFRyZWUucGFpcmVkT3B0aW9ucy5wYWlyZWRMZW5ndGhLZXldLFxuICAgIGl0dmxMZW5ndGggPSBpdHZsLmVuZCAtIGl0dmwuc3RhcnQsXG4gICAgaXR2bElzTGF0ZXIsIGluZmVycmVkSW5zZXJ0U2l6ZTtcblxuICBpZiAoXy5pc1VuZGVmaW5lZChwb3RlbnRpYWxNYXRlKSkge1xuICAgIC8vIENyZWF0ZSB0aGUgbW9zdCByZWNlcHRpdmUgaHlwb3RoZXRpY2FsIG1hdGUsIGdpdmVuIHRoZSBpbmZvcm1hdGlvbiBpbiBpdHZsLlxuICAgIHBvdGVudGlhbE1hdGUgPSB7XG4gICAgICBfbW9ja2VkOiB0cnVlLFxuICAgICAgZmxhZ3M6IHtcbiAgICAgICAgaXNSZWFkUGFpcmVkOiB0cnVlLFxuICAgICAgICBpc1JlYWRQcm9wZXJseUFsaWduZWQ6IHRydWUsXG4gICAgICAgIGlzUmVhZEZpcnN0T2ZQYWlyOiBpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIsXG4gICAgICAgIGlzUmVhZExhc3RPZlBhaXI6IGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXJcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gRmlyc3QgY2hlY2sgYSB3aG9sZSBob3N0IG9mIEZMQUcncy4gVG8gbWFrZSBhIGxvbmcgc3Rvcnkgc2hvcnQsIHdlIGV4cGVjdCBwYWlyZWQgZW5kcyB0byBiZSBlaXRoZXJcbiAgLy8gOTktMTQ3IG9yIDE2My04MywgZGVwZW5kaW5nIG9uIHdoZXRoZXIgdGhlIHJpZ2h0bW9zdCBvciBsZWZ0bW9zdCBzZWdtZW50IGlzIHByaW1hcnkuXG4gIGlmICghaXR2bC5mbGFncy5pc1JlYWRQYWlyZWQgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkUGFpcmVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmICghaXR2bC5mbGFncy5pc1JlYWRQcm9wZXJseUFsaWduZWQgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkUHJvcGVybHlBbGlnbmVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZFVubWFwcGVkIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkVW5tYXBwZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNNYXRlVW5tYXBwZWQgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5pc01hdGVVbm1hcHBlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciAmJiAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIgJiYgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICBcbiAgaWYgKHBvdGVudGlhbE1hdGUuX21vY2tlZCkge1xuICAgIF8uZXh0ZW5kKHBvdGVudGlhbE1hdGUsIHtcbiAgICAgIHJuYW1lOiBpdHZsLnJuZXh0ID09ICc9JyA/IGl0dmwucm5hbWUgOiBpdHZsLnJuZXh0LFxuICAgICAgcG9zOiBpdHZsLnBuZXh0LFxuICAgICAgc3RhcnQ6IGl0dmwucm5leHQgPT0gJz0nID8gcGFyc2VJbnQxMChpdHZsLnBuZXh0KSArIChpdHZsLnN0YXJ0IC0gcGFyc2VJbnQxMChpdHZsLnBvcykpIDogMCxcbiAgICAgIGVuZDogdGxlbiA+IDAgPyBpdHZsLnN0YXJ0ICsgdGxlbiA6ICh0bGVuIDwgMCA/IGl0dmwuZW5kICsgdGxlbiArIGl0dmxMZW5ndGggOiAwKSxcbiAgICAgIHJuZXh0OiBpdHZsLnJuZXh0ID09ICc9JyA/ICc9JyA6IGl0dmwucm5hbWUsXG4gICAgICBwbmV4dDogaXR2bC5wb3NcbiAgICB9KTtcbiAgfVxuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgb24gdGhlIHNhbWUgcmVmZXJlbmNlIHNlcXVlbmNlXG4gIGlmIChpdHZsLnJuZXh0ICE9ICc9JyB8fCBwb3RlbnRpYWxNYXRlLnJuZXh0ICE9ICc9JykgeyBcbiAgICAvLyBhbmQgaWYgbm90LCBkbyB0aGUgY29vcmRpbmF0ZXMgbWF0Y2ggYXQgYWxsP1xuICAgIGlmIChpdHZsLnJuZXh0ICE9IHBvdGVudGlhbE1hdGUucm5hbWUgfHwgaXR2bC5ybmV4dCAhPSBwb3RlbnRpYWxNYXRlLnJuYW1lKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgaWYgKGl0dmwucG5leHQgIT0gcG90ZW50aWFsTWF0ZS5wb3MgfHwgaXR2bC5wb3MgIT0gcG90ZW50aWFsTWF0ZS5wbmV4dCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIHJldHVybiBQQUlSSU5HX01BVEVfT05MWTtcbiAgfVxuICBcbiAgaWYgKHBvdGVudGlhbE1hdGUuX21vY2tlZCkge1xuICAgIF8uZXh0ZW5kKHBvdGVudGlhbE1hdGUuZmxhZ3MsIHtcbiAgICAgIHJlYWRTdHJhbmRSZXZlcnNlOiBpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlLFxuICAgICAgbWF0ZVN0cmFuZFJldmVyc2U6IGl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2VcbiAgICB9KTtcbiAgfSBcbiAgXG4gIGl0dmxJc0xhdGVyID0gaXR2bC5zdGFydCA+IHBvdGVudGlhbE1hdGUuc3RhcnQ7XG4gIGluZmVycmVkSW5zZXJ0U2l6ZSA9IE1hdGguYWJzKHRsZW4pO1xuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgLS0+IDwtLVxuICBpZiAoaXR2bElzTGF0ZXIpIHtcbiAgICBpZiAoIWl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAocG90ZW50aWFsTWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAoIXBvdGVudGlhbE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfVxuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgaW5mZXJyZWRJbnNlcnRTaXplIGlzIHdpdGhpbiB0aGUgYWNjZXB0YWJsZSByYW5nZS5cbiAgaXR2bC5pbnNlcnRTaXplID0gcG90ZW50aWFsTWF0ZS5pbnNlcnRTaXplID0gaW5mZXJyZWRJbnNlcnRTaXplO1xuICBpZiAoaW5mZXJyZWRJbnNlcnRTaXplID4gdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgfHwgaW5mZXJyZWRJbnNlcnRTaXplIDwgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIFxuICByZXR1cm4gUEFJUklOR19EUkFXX0FTX01BVEVTO1xufVxuXG5leHBvcnRzLlBhaXJlZEludGVydmFsVHJlZSA9IFBhaXJlZEludGVydmFsVHJlZTtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcblxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG4vKipcbiAgKiBSZW1vdGVUcmFja1xuICAqXG4gICogQSBoZWxwZXIgY2xhc3MgYnVpbHQgZm9yIGNhY2hpbmcgZGF0YSBmZXRjaGVkIGZyb20gYSByZW1vdGUgdHJhY2sgKGRhdGEgYWxpZ25lZCB0byBhIGdlbm9tZSkuXG4gICogVGhlIGdlbm9tZSBpcyBkaXZpZGVkIGludG8gYmlucyBvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgbnRzLCBmb3IgZWFjaCBvZiB3aGljaCBkYXRhIHdpbGwgb25seSBiZSBmZXRjaGVkIG9uY2UuXG4gICogVG8gc2V0dXAgdGhlIGJpbnMsIGNhbGwgLnNldHVwQmlucyguLi4pIGFmdGVyIGluaXRpYWxpemluZyB0aGUgY2xhc3MuXG4gICpcbiAgKiBUaGVyZSBpcyBvbmUgbWFpbiBwdWJsaWMgbWV0aG9kIGZvciB0aGlzIGNsYXNzOiAuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBjYWxsYmFjaylcbiAgKiAoRm9yIGNvbnNpc3RlbmN5IHdpdGggQ3VzdG9tVHJhY2tzLmpzLCBhbGwgYHN0YXJ0YCBhbmQgYGVuZGAgcG9zaXRpb25zIGFyZSAxLWJhc2VkLCBvcmllbnRlZCB0b1xuICAqIHRoZSBzdGFydCBvZiB0aGUgZ2Vub21lLCBhbmQgaW50ZXJ2YWxzIGFyZSByaWdodC1vcGVuLilcbiAgKlxuICAqIFRoaXMgbWV0aG9kIHdpbGwgcmVxdWVzdCBhbmQgY2FjaGUgZGF0YSBmb3IgdGhlIGdpdmVuIGludGVydmFsIHRoYXQgaXMgbm90IGFscmVhZHkgY2FjaGVkLCBhbmQgY2FsbCBcbiAgKiBjYWxsYmFjayhpbnRlcnZhbHMpIGFzIHNvb24gYXMgZGF0YSBmb3IgYWxsIGludGVydmFscyBpcyBhdmFpbGFibGUuIChJZiB0aGUgZGF0YSBpcyBhbHJlYWR5IGF2YWlsYWJsZSwgXG4gICogaXQgd2lsbCBjYWxsIHRoZSBjYWxsYmFjayBpbW1lZGlhdGVseS4pXG4gICoqL1xuXG52YXIgQklOX0xPQURJTkcgPSAxLFxuICBCSU5fTE9BREVEID0gMjtcblxuLyoqXG4gICogUmVtb3RlVHJhY2sgY29uc3RydWN0b3IuXG4gICpcbiAgKiBOb3RlIHlvdSBzdGlsbCBtdXN0IGNhbGwgYC5zZXR1cEJpbnMoLi4uKWAgYmVmb3JlIHRoZSBSZW1vdGVUcmFjayBpcyByZWFkeSB0byBmZXRjaCBkYXRhLlxuICAqXG4gICogQHBhcmFtIChJbnRlcnZhbFRyZWUpIGNhY2hlOiBBbiBjYWNoZSBzdG9yZSB0aGF0IHdpbGwgcmVjZWl2ZSBpbnRlcnZhbHMgZmV0Y2hlZCBmb3IgZWFjaCBiaW4uXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBTaG91bGQgYmUgYW4gSW50ZXJ2YWxUcmVlIG9yIGVxdWl2YWxlbnQsIHRoYXQgaW1wbGVtZW50cyBgLmFkZElmTmV3KC4uLilgIGFuZCBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAuc2VhcmNoKHN0YXJ0LCBlbmQpYCBtZXRob2RzLiBJZiBpdCBpcyBhbiAqZXh0ZW5zaW9uKiBvZiBhbiBJbnRlcnZhbFRyZWUsIG5vdGUgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgYGV4dHJhQXJnc2AgcGFyYW0gcGVybWl0dGVkIGZvciBgLmZldGNoQXN5bmMoKWAsIHdoaWNoIGFyZSBwYXNzZWQgYWxvbmcgYXMgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHRyYSBhcmd1bWVudHMgdG8gYC5zZWFyY2goKWAuXG4gICogQHBhcmFtIChmdW5jdGlvbikgZmV0Y2hlcjogQSBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgY2FsbGVkIHRvIGZldGNoIGRhdGEgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgZnVuY3Rpb24gc2hvdWxkIHRha2UgdGhyZWUgYXJndW1lbnRzLCBgc3RhcnRgLCBgZW5kYCwgYW5kIGBzdG9yZUludGVydmFsc2AuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlcyBmb3JtaW5nIGEgcmlnaHQtb3BlbiBpbnRlcnZhbC5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgc3RvcmVJbnRlcnZhbHNgIGlzIGEgY2FsbGJhY2sgdGhhdCBgZmV0Y2hlcmAgTVVTVCBjYWxsIG9uIHRoZSBhcnJheSBvZiBpbnRlcnZhbHNcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbmNlIHRoZXkgaGF2ZSBiZWVuIGZldGNoZWQgZnJvbSB0aGUgcmVtb3RlIGRhdGEgc291cmNlIGFuZCBwYXJzZWQuXG4gICogQHNlZSBfZmV0Y2hCaW4gZm9yIGhvdyBgZmV0Y2hlcmAgaXMgdXRpbGl6ZWQuXG4gICoqL1xuZnVuY3Rpb24gUmVtb3RlVHJhY2soY2FjaGUsIGZldGNoZXIpIHtcbiAgaWYgKHR5cGVvZiBjYWNoZSAhPSAnb2JqZWN0JyB8fCAoIWNhY2hlLmFkZElmTmV3ICYmICghXy5rZXlzKGNhY2hlKS5sZW5ndGggfHwgY2FjaGVbXy5rZXlzKGNhY2hlKVswXV0uYWRkSWZOZXcpKSkgeyBcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYW4gSW50ZXJ2YWxUcmVlIGNhY2hlLCBvciBhbiBvYmplY3QvYXJyYXkgY29udGFpbmluZyBJbnRlcnZhbFRyZWVzLCBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyBcbiAgfVxuICBpZiAodHlwZW9mIGZldGNoZXIgIT0gJ2Z1bmN0aW9uJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYSBmZXRjaGVyIGZ1bmN0aW9uIGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHRoaXMuY2FjaGUgPSBjYWNoZTtcbiAgdGhpcy5mZXRjaGVyID0gZmV0Y2hlcjtcbiAgXG4gIHRoaXMuY2FsbGJhY2tzID0gW107XG4gIHRoaXMuYWZ0ZXJCaW5TZXR1cCA9IFtdO1xuICB0aGlzLmJpbnNMb2FkZWQgPSBudWxsO1xufVxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cbi8vIFNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhpcyBSZW1vdGVUcmFjay4gVGhpcyBjYW4gb2NjdXIgYW55dGltZSBhZnRlciBpbml0aWFsaXphdGlvbiwgYW5kIGluIGZhY3QsXG4vLyBjYW4gb2NjdXIgYWZ0ZXIgY2FsbHMgdG8gYC5mZXRjaEFzeW5jKClgIGhhdmUgYmVlbiBtYWRlLCBpbiB3aGljaCBjYXNlIHRoZXkgd2lsbCBiZSB3YWl0aW5nIG9uIHRoaXMgbWV0aG9kXG4vLyB0byBiZSBjYWxsZWQgdG8gcHJvY2VlZC4gQnV0IGl0IE1VU1QgYmUgY2FsbGVkIGJlZm9yZSBkYXRhIHdpbGwgYmUgcmVjZWl2ZWQgYnkgY2FsbGJhY2tzIHBhc3NlZCB0byBcbi8vIGAuZmV0Y2hBc3luYygpYC5cblJlbW90ZVRyYWNrLnByb3RvdHlwZS5zZXR1cEJpbnMgPSBmdW5jdGlvbihnZW5vbWVTaXplLCBvcHRpbWFsRmV0Y2hXaW5kb3csIG1heEZldGNoV2luZG93KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHNlbGYuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgcnVuIHNldHVwQmlucyBtb3JlIHRoYW4gb25jZS4nKTsgfVxuICBpZiAodHlwZW9mIGdlbm9tZVNpemUgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IHRoZSBnZW5vbWVTaXplIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG9wdGltYWxGZXRjaFdpbmRvdyBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4RmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1heEZldGNoV2luZG93IGFzIHRoZSAzcmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHNlbGYuZ2Vub21lU2l6ZSA9IGdlbm9tZVNpemU7XG4gIHNlbGYub3B0aW1hbEZldGNoV2luZG93ID0gb3B0aW1hbEZldGNoV2luZG93O1xuICBzZWxmLm1heEZldGNoV2luZG93ID0gbWF4RmV0Y2hXaW5kb3c7XG4gIFxuICBzZWxmLm51bUJpbnMgPSBNYXRoLmNlaWwoZ2Vub21lU2l6ZSAvIG9wdGltYWxGZXRjaFdpbmRvdyk7XG4gIHNlbGYuYmluc0xvYWRlZCA9IHt9O1xuICBcbiAgLy8gRmlyZSBvZmYgcmFuZ2VzIHNhdmVkIHRvIGFmdGVyQmluU2V0dXBcbiAgXy5lYWNoKHRoaXMuYWZ0ZXJCaW5TZXR1cCwgZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICBzZWxmLmZldGNoQXN5bmMocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCwgcmFuZ2UuZXh0cmFBcmdzKTtcbiAgfSk7XG4gIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhzZWxmKTtcbn1cblxuXG4vLyBGZXRjaGVzIGRhdGEgKGlmIG5lY2Vzc2FyeSkgZm9yIHVuZmV0Y2hlZCBiaW5zIG92ZXJsYXBwaW5nIHdpdGggdGhlIGludGVydmFsIGZyb20gYHN0YXJ0YCB0byBgZW5kYC5cbi8vIFRoZW4sIHJ1biBgY2FsbGJhY2tgIG9uIGFsbCBzdG9yZWQgc3ViaW50ZXJ2YWxzIHRoYXQgb3ZlcmxhcCB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBgZXh0cmFBcmdzYCBpcyBhbiAqb3B0aW9uYWwqIHBhcmFtZXRlciB0aGF0IGNhbiBjb250YWluIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIGAuc2VhcmNoKClgIGZ1bmN0aW9uIG9mIHRoZSBjYWNoZS5cbi8vXG4vLyBAcGFyYW0gKG51bWJlcikgc3RhcnQ6ICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIHRvIHN0YXJ0IGZldGNoaW5nIGZyb21cbi8vIEBwYXJhbSAobnVtYmVyKSBlbmQ6ICAgICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgKHJpZ2h0LW9wZW4pIHRvIHN0YXJ0IGZldGNoaW5nICp1bnRpbCpcbi8vIEBwYXJhbSAoQXJyYXkpIFtleHRyYUFyZ3NdOiAgb3B0aW9uYWwsIHBhc3NlZCBhbG9uZyB0byB0aGUgYC5zZWFyY2goKWAgY2FsbHMgb24gdGhlIC5jYWNoZSBhcyBhcmd1bWVudHMgMyBhbmQgdXA7IFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJoYXBzIHVzZWZ1bCBpZiB0aGUgLmNhY2hlIGhhcyBvdmVycmlkZGVuIHRoaXMgbWV0aG9kXG4vLyBAcGFyYW0gKGZ1bmN0aW9uKSBjYWxsYmFjazogIEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCBvbmNlIGRhdGEgaXMgcmVhZHkgZm9yIHRoaXMgaW50ZXJ2YWwuIFdpbGwgYmUgcGFzc2VkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbCBpbnRlcnZhbCBmZWF0dXJlcyB0aGF0IGhhdmUgYmVlbiBmZXRjaGVkIGZvciB0aGlzIGludGVydmFsLCBvciB7dG9vTWFueTogdHJ1ZX1cbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgbW9yZSBkYXRhIHdhcyByZXF1ZXN0ZWQgdGhhbiBjb3VsZCBiZSByZWFzb25hYmx5IGZldGNoZWQuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuZmV0Y2hBc3luYyA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGV4dHJhQXJncywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc0Z1bmN0aW9uKGV4dHJhQXJncykgJiYgXy5pc1VuZGVmaW5lZChjYWxsYmFjaykpIHsgY2FsbGJhY2sgPSBleHRyYUFyZ3M7IGV4dHJhQXJncyA9IHVuZGVmaW5lZDsgfVxuICBpZiAoIXNlbGYuYmluc0xvYWRlZCkge1xuICAgIC8vIElmIGJpbnMgKmFyZW4ndCogc2V0dXAgeWV0OlxuICAgIC8vIFNhdmUgdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyBTYXZlIHRoaXMgZmV0Y2ggZm9yIHdoZW4gdGhlIGJpbnMgYXJlIGxvYWRlZFxuICAgIHNlbGYuYWZ0ZXJCaW5TZXR1cC5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJnc30pO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGJpbnMgKmFyZSogc2V0dXAsIGZpcnN0IGNhbGN1bGF0ZSB3aGljaCBiaW5zIGNvcnJlc3BvbmQgdG8gdGhpcyBpbnRlcnZhbCwgXG4gICAgLy8gYW5kIHdoYXQgc3RhdGUgdGhvc2UgYmlucyBhcmUgaW5cbiAgICB2YXIgYmlucyA9IF9iaW5PdmVybGFwKHNlbGYsIHN0YXJ0LCBlbmQpLFxuICAgICAgbG9hZGVkQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHNlbGYuYmluc0xvYWRlZFtpXSA9PT0gQklOX0xPQURFRDsgfSksXG4gICAgICBiaW5zVG9GZXRjaCA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuICFzZWxmLmJpbnNMb2FkZWRbaV07IH0pO1xuICAgIFxuICAgIGlmIChsb2FkZWRCaW5zLmxlbmd0aCA9PSBiaW5zLmxlbmd0aCkge1xuICAgICAgLy8gSWYgd2UndmUgYWxyZWFkeSBsb2FkZWQgZGF0YSBmb3IgYWxsIHRoZSBiaW5zIGluIHF1ZXN0aW9uLCBzaG9ydC1jaXJjdWl0IGFuZCBydW4gdGhlIGNhbGxiYWNrIG5vd1xuICAgICAgZXh0cmFBcmdzID0gXy5pc1VuZGVmaW5lZChleHRyYUFyZ3MpID8gW10gOiBleHRyYUFyZ3M7XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayhzZWxmLmNhY2hlLnNlYXJjaC5hcHBseShzZWxmLmNhY2hlLCBbc3RhcnQsIGVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICB9IGVsc2UgaWYgKGVuZCAtIHN0YXJ0ID4gc2VsZi5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgLy8gZWxzZSwgaWYgdGhpcyBpbnRlcnZhbCBpcyB0b28gYmlnICg+IG1heEZldGNoV2luZG93KSwgZmlyZSB0aGUgY2FsbGJhY2sgcmlnaHQgYXdheSB3aXRoIHt0b29NYW55OiB0cnVlfVxuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gZWxzZSwgcHVzaCB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIHRoZW4gcnVuIGZldGNoZXMgZm9yIHRoZSB1bmZldGNoZWQgYmlucywgd2hpY2ggc2hvdWxkIGNhbGwgX2ZpcmVDYWxsYmFja3MgYWZ0ZXIgdGhleSBjb21wbGV0ZSxcbiAgICAvLyB3aGljaCB3aWxsIGF1dG9tYXRpY2FsbHkgZmlyZSBjYWxsYmFja3MgZnJvbSB0aGUgYWJvdmUgcXVldWUgYXMgdGhleSBhY3F1aXJlIGFsbCBuZWVkZWQgZGF0YS5cbiAgICBfLmVhY2goYmluc1RvRmV0Y2gsIGZ1bmN0aW9uKGJpbkluZGV4KSB7XG4gICAgICBfZmV0Y2hCaW4oc2VsZiwgYmluSW5kZXgsIGZ1bmN0aW9uKCkgeyBfZmlyZUNhbGxiYWNrcyhzZWxmKTsgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDYWxjdWxhdGVzIHdoaWNoIGJpbnMgb3ZlcmxhcCB3aXRoIGFuIGludGVydmFsIGdpdmVuIGJ5IGBzdGFydGAgYW5kIGBlbmRgLlxuLy8gYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG5mdW5jdGlvbiBfYmluT3ZlcmxhcChyZW1vdGVUcmssIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFyZW1vdGVUcmsuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgY2FsY3VsYXRlIGJpbiBvdmVybGFwIGJlZm9yZSBzZXR1cEJpbnMgaXMgY2FsbGVkLicpOyB9XG4gIC8vIEludGVybmFsbHksIGZvciBhc3NpZ25pbmcgY29vcmRpbmF0ZXMgdG8gYmlucywgd2UgdXNlIDAtYmFzZWQgY29vcmRpbmF0ZXMgZm9yIGVhc2llciBjYWxjdWxhdGlvbnMuXG4gIHZhciBzdGFydEJpbiA9IE1hdGguZmxvb3IoKHN0YXJ0IC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KSxcbiAgICBlbmRCaW4gPSBNYXRoLmZsb29yKChlbmQgLSAxKSAvIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICByZXR1cm4gXy5yYW5nZShzdGFydEJpbiwgZW5kQmluICsgMSk7XG59XG5cbi8vIFJ1bnMgdGhlIGZldGNoZXIgZnVuY3Rpb24gb24gYSBnaXZlbiBiaW4uXG4vLyBUaGUgZmV0Y2hlciBmdW5jdGlvbiBpcyBvYmxpZ2F0ZWQgdG8gcnVuIGEgY2FsbGJhY2sgZnVuY3Rpb24gYHN0b3JlSW50ZXJ2YWxzYCwgXG4vLyAgICBwYXNzZWQgYXMgaXRzIHRoaXJkIGFyZ3VtZW50LCBvbiBhIHNldCBvZiBpbnRlcnZhbHMgdGhhdCB3aWxsIGJlIGluc2VydGVkIGludG8gdGhlIFxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIEludGVydmFsVHJlZS5cbi8vIFRoZSBgc3RvcmVJbnRlcnZhbHNgIGZ1bmN0aW9uIG1heSBhY2NlcHQgYSBzZWNvbmQgYXJndW1lbnQgY2FsbGVkIGBjYWNoZUluZGV4YCwgaW4gY2FzZVxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIGlzIGFjdHVhbGx5IGEgY29udGFpbmVyIGZvciBtdWx0aXBsZSBJbnRlcnZhbFRyZWVzLCBpbmRpY2F0aW5nIHdoaWNoIFxuLy8gICAgb25lIHRvIHN0b3JlIGl0IGluLlxuLy8gV2UgdGhlbiBjYWxsIHRoZSBgY2FsbGJhY2tgIGdpdmVuIGhlcmUgYWZ0ZXIgdGhhdCBpcyBjb21wbGV0ZS5cbmZ1bmN0aW9uIF9mZXRjaEJpbihyZW1vdGVUcmssIGJpbkluZGV4LCBjYWxsYmFjaykge1xuICB2YXIgc3RhcnQgPSBiaW5JbmRleCAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxLFxuICAgIGVuZCA9IChiaW5JbmRleCArIDEpICogcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyArIDE7XG4gIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FESU5HO1xuICByZW1vdGVUcmsuZmV0Y2hlcihzdGFydCwgZW5kLCBmdW5jdGlvbiBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpIHtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgaWYgKCFpbnRlcnZhbCkgeyByZXR1cm47IH1cbiAgICAgIHJlbW90ZVRyay5jYWNoZS5hZGRJZk5ldyhpbnRlcnZhbCwgaW50ZXJ2YWwuaWQpO1xuICAgIH0pO1xuICAgIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FERUQ7XG4gICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3Mgd2hlcmUgYWxsIHRoZSByZXF1aXJlZCBkYXRhIGlzIHJlYWR5XG4vLyBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfZmlyZUNhbGxiYWNrcyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjayxcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoYWZ0ZXJMb2FkLmV4dHJhQXJncykgPyBbXSA6IGFmdGVyTG9hZC5leHRyYUFyZ3MsXG4gICAgICBiaW5zLCBzdGlsbExvYWRpbmdCaW5zO1xuICAgICAgICBcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgXG4gICAgYmlucyA9IF9iaW5PdmVybGFwKHJlbW90ZVRyaywgYWZ0ZXJMb2FkLnN0YXJ0LCBhZnRlckxvYWQuZW5kKTtcbiAgICBzdGlsbExvYWRpbmdCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gcmVtb3RlVHJrLmJpbnNMb2FkZWRbaV0gIT09IEJJTl9MT0FERUQ7IH0pLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFzdGlsbExvYWRpbmdCaW5zKSB7XG4gICAgICBjYWxsYmFjayhyZW1vdGVUcmsuY2FjaGUuc2VhcmNoLmFwcGx5KHJlbW90ZVRyay5jYWNoZSwgW2FmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG4vLyBSdW5zIHRocm91Z2ggYWxsIHNhdmVkIGNhbGxiYWNrcyBhbmQgZmlyZXMgYW55IGNhbGxiYWNrcyBmb3Igd2hpY2ggd2Ugd29uJ3QgbG9hZCBkYXRhIHNpbmNlIHRoZSBhbW91bnRcbi8vIHJlcXVlc3RlZCBpcyB0b28gbGFyZ2UuIENhbGxiYWNrcyB0aGF0IGFyZSBmaXJlZCBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBxdWV1ZS5cbmZ1bmN0aW9uIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjaztcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5cbmV4cG9ydHMuUmVtb3RlVHJhY2sgPSBSZW1vdGVUcmFjaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9Tb3J0ZWRMaXN0XG4gKlxuICogU29ydGVkTGlzdCA6IGNvbnN0cnVjdG9yXG4gKiBcbiAqIEBwYXJhbSBhcnIgOiBBcnJheSBvciBudWxsIDogYW4gYXJyYXkgdG8gc2V0XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgOiBvYmplY3QgIG9yIG51bGxcbiAqICAgICAgICAgKGZ1bmN0aW9uKSBmaWx0ZXIgIDogZmlsdGVyIGZ1bmN0aW9uIGNhbGxlZCBiZWZvcmUgaW5zZXJ0aW5nIGRhdGEuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgcmVjZWl2ZXMgYSB2YWx1ZSBhbmQgcmV0dXJucyB0cnVlIGlmIHRoZSB2YWx1ZSBpcyB2YWxpZC5cbiAqXG4gKiAgICAgICAgIChmdW5jdGlvbikgY29tcGFyZSA6IGZ1bmN0aW9uIHRvIGNvbXBhcmUgdHdvIHZhbHVlcywgXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdoaWNoIGlzIHVzZWQgZm9yIHNvcnRpbmcgb3JkZXIuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBzYW1lIHNpZ25hdHVyZSBhcyBBcnJheS5wcm90b3R5cGUuc29ydChmbikuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICogICAgICAgICAoc3RyaW5nKSAgIGNvbXBhcmUgOiBpZiB5b3UnZCBsaWtlIHRvIHNldCBhIGNvbW1vbiBjb21wYXJpc29uIGZ1bmN0aW9uLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5b3UgY2FuIHNwZWNpZnkgaXQgYnkgc3RyaW5nOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIm51bWJlclwiIDogY29tcGFyZXMgbnVtYmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwic3RyaW5nXCIgOiBjb21wYXJlcyBzdHJpbmdcbiAqL1xuZnVuY3Rpb24gU29ydGVkTGlzdCgpIHtcbiAgdmFyIGFyciAgICAgPSBudWxsLFxuICAgICAgb3B0aW9ucyA9IHt9LFxuICAgICAgYXJncyAgICA9IGFyZ3VtZW50cztcblxuICBbXCIwXCIsXCIxXCJdLmZvckVhY2goZnVuY3Rpb24obikge1xuICAgIHZhciB2YWwgPSBhcmdzW25dO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgIGFyciA9IHZhbDtcbiAgICB9XG4gICAgZWxzZSBpZiAodmFsICYmIHR5cGVvZiB2YWwgPT0gXCJvYmplY3RcIikge1xuICAgICAgb3B0aW9ucyA9IHZhbDtcbiAgICB9XG4gIH0pO1xuICB0aGlzLmFyciA9IFtdO1xuXG4gIFtcImZpbHRlclwiLCBcImNvbXBhcmVcIl0uZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zW2tdID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpc1trXSA9IG9wdGlvbnNba107XG4gICAgfVxuICAgIGVsc2UgaWYgKG9wdGlvbnNba10gJiYgU29ydGVkTGlzdFtrXVtvcHRpb25zW2tdXSkge1xuICAgICAgdGhpc1trXSA9IFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV07XG4gICAgfVxuICB9LCB0aGlzKTtcbiAgaWYgKGFycikgdGhpcy5tYXNzSW5zZXJ0KGFycik7XG59O1xuXG4vLyBCaW5hcnkgc2VhcmNoIGZvciB0aGUgaW5kZXggb2YgdGhlIGl0ZW0gZXF1YWwgdG8gYHZhbGAsIG9yIGlmIG5vIHN1Y2ggaXRlbSBleGlzdHMsIHRoZSBuZXh0IGxvd2VyIGl0ZW1cbi8vIFRoaXMgY2FuIGJlIC0xIGlmIGB2YWxgIGlzIGxvd2VyIHRoYW4gdGhlIGxvd2VzdCBpdGVtIGluIHRoZSBTb3J0ZWRMaXN0XG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5ic2VhcmNoID0gZnVuY3Rpb24odmFsKSB7XG4gIHZhciBtcG9zLFxuICAgICAgc3BvcyA9IDAsXG4gICAgICBlcG9zID0gdGhpcy5hcnIubGVuZ3RoO1xuICB3aGlsZSAoZXBvcyAtIHNwb3MgPiAxKSB7XG4gICAgbXBvcyA9IE1hdGguZmxvb3IoKHNwb3MgKyBlcG9zKS8yKTtcbiAgICBtdmFsID0gdGhpcy5hcnJbbXBvc107XG4gICAgc3dpdGNoICh0aGlzLmNvbXBhcmUodmFsLCBtdmFsKSkge1xuICAgIGNhc2UgMSAgOlxuICAgIGRlZmF1bHQgOlxuICAgICAgc3BvcyA9IG1wb3M7XG4gICAgICBicmVhaztcbiAgICBjYXNlIC0xIDpcbiAgICAgIGVwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAwICA6XG4gICAgICByZXR1cm4gbXBvcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh0aGlzLmFyclswXSA9PSBudWxsIHx8IHNwb3MgPT0gMCAmJiB0aGlzLmFyclswXSAhPSBudWxsICYmIHRoaXMuY29tcGFyZSh0aGlzLmFyclswXSwgdmFsKSA9PSAxKSA/IC0xIDogc3Bvcztcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gdGhpcy5hcnJbcG9zXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlKCk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnIuc2xpY2UuYXBwbHkodGhpcy5hcnIsIGFyZ3VtZW50cyk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLmxlbmd0aDtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmhlYWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyWzBdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gKHRoaXMuYXJyLmxlbmd0aCA9PSAwKSA/IG51bGwgOiB0aGlzLmFyclt0aGlzLmFyci5sZW5ndGggLTFdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc0luc2VydCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIC8vIFRoaXMgbG9vcCBhdm9pZHMgY2FsbCBzdGFjayBvdmVyZmxvdyBiZWNhdXNlIG9mIHRvbyBtYW55IGFyZ3VtZW50c1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSA0MDk2KSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkodGhpcy5hcnIsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGl0ZW1zLCBpLCBpICsgNDA5NikpO1xuICB9XG4gIHRoaXMuYXJyLnNvcnQodGhpcy5jb21wYXJlKTtcbn1cblxuU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oKSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMTAwKSB7XG4gICAgLy8gLmJzZWFyY2ggKyAuc3BsaWNlIGlzIHRvbyBleHBlbnNpdmUgdG8gcmVwZWF0IGZvciBzbyBtYW55IGVsZW1lbnRzLlxuICAgIC8vIExldCdzIGp1c3QgYXBwZW5kIHRoZW0gYWxsIHRvIHRoaXMuYXJyIGFuZCByZXNvcnQuXG4gICAgdGhpcy5tYXNzSW5zZXJ0KGFyZ3VtZW50cyk7XG4gIH0gZWxzZSB7XG4gICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uKHZhbCkge1xuICAgICAgdmFyIHBvcyA9IHRoaXMuYnNlYXJjaCh2YWwpO1xuICAgICAgaWYgKHRoaXMuZmlsdGVyKHZhbCwgcG9zKSkge1xuICAgICAgICB0aGlzLmFyci5zcGxpY2UocG9zKzEsIDAsIHZhbCk7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmZpbHRlciA9IGZ1bmN0aW9uKHZhbCwgcG9zKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuYWRkID0gU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXSA9IGZ1bmN0aW9uKHBvcykge1xuICB0aGlzLmFyci5zcGxpY2UocG9zLCAxKTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IFNvcnRlZExpc3QucHJvdG90eXBlW1wiZGVsZXRlXCJdO1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5tYXNzUmVtb3ZlID0gZnVuY3Rpb24oc3RhcnRQb3MsIGNvdW50KSB7XG4gIHRoaXMuYXJyLnNwbGljZShzdGFydFBvcywgY291bnQpO1xufTtcblxuLyoqXG4gKiBkZWZhdWx0IGNvbXBhcmUgZnVuY3Rpb25zIFxuICoqL1xuU29ydGVkTGlzdC5jb21wYXJlID0ge1xuICBcIm51bWJlclwiOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIGMgPSBhIC0gYjtcbiAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gIH0sXG5cbiAgXCJzdHJpbmdcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiAoYSA+IGIpID8gMSA6IChhID09IGIpICA/IDAgOiAtMTtcbiAgfVxufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuY29tcGFyZSA9IFNvcnRlZExpc3QuY29tcGFyZVtcIm51bWJlclwiXTtcblxuZXhwb3J0cy5Tb3J0ZWRMaXN0ID0gU29ydGVkTGlzdDtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsInZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLy8gRmFzdGVyIHRoYW4gTWF0aC5mbG9vciAoaHR0cDovL3dlYmRvb2QuY29tLz9wPTIxOSlcbm1vZHVsZS5leHBvcnRzLmZsb29ySGFjayA9IGZ1bmN0aW9uKG51bSkgeyByZXR1cm4gKG51bSA8PCAwKSAtIChudW0gPCAwID8gMSA6IDApOyB9XG5cbi8vIE90aGVyIHRpbnkgZnVuY3Rpb25zIHRoYXQgd2UgbmVlZCBmb3Igb2RkcyBhbmQgZW5kcy4uLlxudmFyIHN0cmlwID0gbW9kdWxlLmV4cG9ydHMuc3RyaXAgPSBmdW5jdGlvbihzdHIpIHsgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7IH1cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIHBhcnNlSW50KHZhbCwgMTApOyB9XG5tb2R1bGUuZXhwb3J0cy5kZWVwQ2xvbmUgPSBmdW5jdGlvbihvYmopIHsgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob2JqKSk7IH1cblxuLy8gVGhlIGRlZmF1bHQgd2F5IGJ5IHdoaWNoIHdlIGRlcml2ZSBhIG5hbWUgdG8gYmUgcHJpbnRlZCBuZXh0IHRvIGEgcmFuZ2UgZmVhdHVyZVxudmFyIGRlZmF1bHROYW1lRnVuYyA9IG1vZHVsZS5leHBvcnRzLmRlZmF1bHROYW1lRnVuYyA9IGZ1bmN0aW9uKGQpIHsgcmV0dXJuIHN0cmlwKGQubmFtZSB8fCBkLmlkIHx8ICcnKTsgfVxuXG4vLyBQYXJzZSBhIHRyYWNrIGRlY2xhcmF0aW9uIGxpbmUsIHdoaWNoIGlzIGluIHRoZSBmb3JtYXQgb2Y6XG4vLyB0cmFjayBuYW1lPVwiYmxhaFwiIG9wdG5hbWUxPVwidmFsdWUxXCIgb3B0bmFtZTI9XCJ2YWx1ZTJcIiAuLi5cbi8vIGludG8gYSBoYXNoIG9mIG9wdGlvbnNcbm1vZHVsZS5leHBvcnRzLnBhcnNlRGVjbGFyYXRpb25MaW5lID0gZnVuY3Rpb24obGluZSwgc3RhcnQpIHtcbiAgdmFyIG9wdHMgPSB7fSwgb3B0bmFtZSA9ICcnLCB2YWx1ZSA9ICcnLCBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgZnVuY3Rpb24gcHVzaFZhbHVlKHF1b3RpbmcpIHtcbiAgICBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgICBvcHRzW29wdG5hbWUucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXSA9IHZhbHVlO1xuICAgIG9wdG5hbWUgPSB2YWx1ZSA9ICcnO1xuICB9XG4gIGZvciAoaSA9IGxpbmUubWF0Y2goc3RhcnQpWzBdLmxlbmd0aDsgaSA8IGxpbmUubGVuZ3RoOyBpKyspIHtcbiAgICBjID0gbGluZVtpXTtcbiAgICBpZiAoc3RhdGUgPT0gJ29wdG5hbWUnKSB7XG4gICAgICBpZiAoYyA9PSAnPScpIHsgc3RhdGUgPSAnc3RhcnR2YWx1ZSc7IH1cbiAgICAgIGVsc2UgeyBvcHRuYW1lICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICdzdGFydHZhbHVlJykge1xuICAgICAgaWYgKC8nfFwiLy50ZXN0KGMpKSB7IHN0YXRlID0gYzsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IHN0YXRlID0gJ3ZhbHVlJzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykge1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykpIHsgcHVzaFZhbHVlKCk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmICgvJ3xcIi8udGVzdChzdGF0ZSkpIHtcbiAgICAgIGlmIChjID09IHN0YXRlKSB7IHB1c2hWYWx1ZShzdGF0ZSk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfVxuICB9XG4gIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7IHB1c2hWYWx1ZSgpOyB9XG4gIGlmIChzdGF0ZSAhPSAnb3B0bmFtZScpIHsgcmV0dXJuIGZhbHNlOyB9XG4gIHJldHVybiBvcHRzO1xufVxuXG4vLyBDb25zdHJ1Y3RzIGEgbWFwcGluZyBmdW5jdGlvbiB0aGF0IGNvbnZlcnRzIGJwIGludGVydmFscyBpbnRvIHBpeGVsIGludGVydmFscywgd2l0aCBvcHRpb25hbCBjYWxjdWxhdGlvbnMgZm9yIHRleHQgdG9vXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbENhbGN1bGF0b3IgPSBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHAsIHdpdGhUZXh0LCBuYW1lRnVuYywgc3RhcnRrZXksIGVuZGtleSkge1xuICBpZiAoIV8uaXNGdW5jdGlvbihuYW1lRnVuYykpIHsgbmFtZUZ1bmMgPSBkZWZhdWx0TmFtZUZ1bmM7IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoc3RhcnRrZXkpKSB7IHN0YXJ0a2V5ID0gJ3N0YXJ0JzsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChlbmRrZXkpKSB7IGVuZGtleSA9ICdlbmQnOyB9XG4gIHJldHVybiBmdW5jdGlvbihkKSB7XG4gICAgdmFyIGl0dmxTdGFydCA9IF8uaXNVbmRlZmluZWQoZFtzdGFydGtleV0pID8gZC5zdGFydCA6IGRbc3RhcnRrZXldLFxuICAgICAgaXR2bEVuZCA9IF8uaXNVbmRlZmluZWQoZFtlbmRrZXldKSA/IGQuZW5kIDogZFtlbmRrZXldO1xuICAgIHZhciBwSW50ID0ge1xuICAgICAgeDogTWF0aC5yb3VuZCgoaXR2bFN0YXJ0IC0gc3RhcnQpIC8gYnBwcCksXG4gICAgICB3OiBNYXRoLnJvdW5kKChpdHZsRW5kIC0gaXR2bFN0YXJ0KSAvIGJwcHApICsgMSxcbiAgICAgIHQ6IDAsICAgICAgICAgIC8vIGNhbGN1bGF0ZWQgd2lkdGggb2YgdGV4dFxuICAgICAgb1ByZXY6IGZhbHNlLCAgLy8gb3ZlcmZsb3dzIGludG8gcHJldmlvdXMgdGlsZT9cbiAgICAgIG9OZXh0OiBmYWxzZSAgIC8vIG92ZXJmbG93cyBpbnRvIG5leHQgdGlsZT9cbiAgICB9O1xuICAgIHBJbnQudHggPSBwSW50Lng7XG4gICAgcEludC50dyA9IHBJbnQudztcbiAgICBpZiAocEludC54IDwgMCkgeyBwSW50LncgKz0gcEludC54OyBwSW50LnggPSAwOyBwSW50Lm9QcmV2ID0gdHJ1ZTsgfVxuICAgIGVsc2UgaWYgKHdpdGhUZXh0KSB7XG4gICAgICBwSW50LnQgPSBfLmlzTnVtYmVyKHdpdGhUZXh0KSA/IHdpdGhUZXh0IDogTWF0aC5taW4obmFtZUZ1bmMoZCkubGVuZ3RoICogMTAgKyAyLCBwSW50LngpO1xuICAgICAgcEludC50eCAtPSBwSW50LnQ7XG4gICAgICBwSW50LnR3ICs9IHBJbnQudDsgIFxuICAgIH1cbiAgICBpZiAocEludC54ICsgcEludC53ID4gd2lkdGgpIHsgcEludC53ID0gd2lkdGggLSBwSW50Lng7IHBJbnQub05leHQgPSB0cnVlOyB9XG4gICAgcmV0dXJuIHBJbnQ7XG4gIH07XG59O1xuXG4vLyBGb3IgdHdvIGdpdmVuIG9iamVjdHMgb2YgdGhlIGZvcm0ge3g6IDEsIHc6IDJ9IChwaXhlbCBpbnRlcnZhbHMpLCBkZXNjcmliZSB0aGUgb3ZlcmxhcC5cbi8vIFJldHVybnMgbnVsbCBpZiB0aGVyZSBpcyBubyBvdmVybGFwLlxubW9kdWxlLmV4cG9ydHMucGl4SW50ZXJ2YWxPdmVybGFwID0gZnVuY3Rpb24ocEludDEsIHBJbnQyKSB7XG4gIHZhciBvdmVybGFwID0ge30sXG4gICAgdG1wO1xuICBpZiAocEludDEueCA+IHBJbnQyLngpIHsgdG1wID0gcEludDI7IHBJbnQyID0gcEludDE7IHBJbnQxID0gdG1wOyB9ICAgICAgIC8vIHN3YXAgc28gdGhhdCBwSW50MSBpcyBhbHdheXMgbG93ZXJcbiAgaWYgKCFwSW50MS53IHx8ICFwSW50Mi53IHx8IHBJbnQxLnggKyBwSW50MS53IDwgcEludDIueCkgeyByZXR1cm4gbnVsbDsgfSAvLyBkZXRlY3Qgbm8tb3ZlcmxhcCBjb25kaXRpb25zXG4gIG92ZXJsYXAueCA9IHBJbnQyLng7XG4gIG92ZXJsYXAudyA9IE1hdGgubWluKHBJbnQxLncgLSBwSW50Mi54ICsgcEludDEueCwgcEludDIudyk7XG4gIHJldHVybiBvdmVybGFwO1xufTtcblxuLy8gQ29tbW9uIGZ1bmN0aW9ucyBmb3Igc3VtbWFyaXppbmcgZGF0YSBpbiBiaW5zIHdoaWxlIHBsb3R0aW5nIHdpZ2dsZSB0cmFja3Ncbm1vZHVsZS5leHBvcnRzLndpZ0JpbkZ1bmN0aW9ucyA9IHtcbiAgbWluaW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5taW4uYXBwbHkoTWF0aCwgYmluKSA6IDA7IH0sXG4gIG1lYW46IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gXy5yZWR1Y2UoYmluLCBmdW5jdGlvbihhLGIpIHsgcmV0dXJuIGEgKyBiOyB9LCAwKSAvIGJpbi5sZW5ndGg7IH0sXG4gIG1heGltdW06IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gYmluLmxlbmd0aCA/IE1hdGgubWF4LmFwcGx5KE1hdGgsIGJpbikgOiAwOyB9XG59OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IHZjZlRhYml4IGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvdmNmLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMudmNmdGFiaXhcbnZhciBWY2ZUYWJpeEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAxMDAwMDAsXG4gICAgY2hyb21vc29tZXM6ICcnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciB2Y2ZUYWJpeCB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIC8vIFRPRE86IFNldCBtYXhGZXRjaFdpbmRvdyB1c2luZyBzb21lIGhldXJpc3RpYyBiYXNlZCBvbiBob3cgbWFueSBpdGVtcyBhcmUgaW4gdGhlIHRhYml4IGluZGV4XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVUb0ludGVydmFsKGxpbmUpIHtcbiAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KCdcXHQnKSwgZGF0YSA9IHt9LCBpbmZvID0ge307XG4gICAgICBpZiAoZmllbGRzWzddKSB7XG4gICAgICAgIF8uZWFjaChmaWVsZHNbN10uc3BsaXQoJzsnKSwgZnVuY3Rpb24obCkgeyBsID0gbC5zcGxpdCgnPScpOyBpZiAobC5sZW5ndGggPiAxKSB7IGluZm9bbFswXV0gPSBsWzFdOyB9IH0pO1xuICAgICAgfVxuICAgICAgZGF0YS5zdGFydCA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW2ZpZWxkc1swXV0gKyBwYXJzZUludDEwKGZpZWxkc1sxXSk7XG4gICAgICBkYXRhLmlkID0gZmllbGRzWzJdPT0nLicgPyAndmNmLScgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDAwMDAwMDApIDogZmllbGRzWzJdO1xuICAgICAgZGF0YS5lbmQgPSBkYXRhLnN0YXJ0ICsgMTtcbiAgICAgIGRhdGEucmVmID0gZmllbGRzWzNdO1xuICAgICAgZGF0YS5hbHQgPSBmaWVsZHNbNF07XG4gICAgICBkYXRhLnF1YWwgPSBwYXJzZUZsb2F0KGZpZWxkc1s1XSk7XG4gICAgICBkYXRhLmluZm8gPSBpbmZvO1xuICAgICAgcmV0dXJuIHtkYXRhOiBkYXRhfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbmFtZUZ1bmMoZmllbGRzKSB7XG4gICAgICB2YXIgcmVmID0gZmllbGRzLnJlZiB8fCAnJyxcbiAgICAgICAgYWx0ID0gZmllbGRzLmFsdCB8fCAnJztcbiAgICAgIHJldHVybiAocmVmLmxlbmd0aCA+IGFsdC5sZW5ndGggPyByZWYgOiBhbHQpIHx8ICcnO1xuICAgIH1cbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSxcbiAgICAgICAgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPiA4OyB9KSxcbiAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJywgbmFtZUZ1bmMpO1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICBkcmF3U3BlYy5wdXNoKGNhbGNQaXhJbnRlcnZhbChsaW5lVG9JbnRlcnZhbChsaW5lKS5kYXRhKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZHJhd1NwZWMgPSB7bGF5b3V0OiBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQoXy5tYXAobGluZXMsIGxpbmVUb0ludGVydmFsKSwgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCl9O1xuICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbXVjaCBkYXRhLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICAvLyBUT0RPOiBjYWNoZSByZXN1bHRzIHNvIHdlIGFyZW4ndCByZWZldGNoaW5nIHRoZSBzYW1lIHJlZ2lvbnMgb3ZlciBhbmQgb3ZlciBhZ2Fpbi5cbiAgICBpZiAoKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgJC5hamF4KHRoaXMuYWpheERpcigpICsgJ3RhYml4LnBocCcsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiB0aGlzLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHRoaXMub3B0cy51cmwgPyB0aGlzLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrdGhpcy5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAyNyA6IDYsXG4gICAgICBjb2xvcnMgPSB7YTonMjU1LDAsMCcsIHQ6JzI1NSwwLDI1NScsIGM6JzAsMCwyNTUnLCBnOicwLDI1NSwwJ30sXG4gICAgICBkcmF3TGltaXQgPSB0aGlzLm9wdHMuZHJhd0xpbWl0ICYmIHRoaXMub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snKSB7IGFyZWFzID0gdGhpcy5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgdGhpcy5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgIH0gZWxzZSBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBhbHRDb2xvciwgcmVmQ29sb3I7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgcmVmQ29sb3IgPSBjb2xvcnNbZGF0YS5kLnJlZi50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGFsdENvbG9yID0gY29sb3JzW2RhdGEuZC5hbHQudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIgKyBhbHRDb2xvciArIFwiKVwiOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIDEpO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIGFyZWFzLnB1c2goW1xuICAgICAgICAgICAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvL3gxLCB4MiwgeTEsIHkyXG4gICAgICAgICAgICAgICAgZGF0YS5kLnJlZiArICcgPiAnICsgZGF0YS5kLmFsdCwgLy8gdGl0bGVcbiAgICAgICAgICAgICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIGRhdGEuZC5pZCksIC8vIGhyZWZcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQub1ByZXYsIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICAgICAgICAgICAgYWx0Q29sb3IsIC8vIGxhYmVsIGNvbG9yXG4gICAgICAgICAgICAgICAgJzxzcGFuIHN0eWxlPVwiY29sb3I6IHJnYignICsgcmVmQ29sb3IgKyAnKVwiPicgKyBkYXRhLmQucmVmICsgJzwvc3Bhbj48YnIvPicgKyBkYXRhLmQuYWx0LCAvLyBsYWJlbFxuICAgICAgICAgICAgICAgIGRhdGEuZC5pbmZvXG4gICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBWY2ZUYWJpeEZvcm1hdDtcblxuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IFdJRyBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3dpZ2dsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL3V0aWxzL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0O1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy53aWdnbGVfMFxudmFyIFdpZ2dsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHV0aWxzLndpZ0JpbkZ1bmN0aW9ucyxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIF9iaW5GdW5jdGlvbnMgPSB0aGlzLnR5cGUoKS5fYmluRnVuY3Rpb25zO1xuICAgIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpKSB7IG8uYWx0Q29sb3IgPSAnJzsgfVxuICAgIG8udmlld0xpbWl0cyA9IF8ubWFwKG8udmlld0xpbWl0cy5zcGxpdCgnOicpLCBwYXJzZUZsb2F0KTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IF8ubWFwKG8ubWF4SGVpZ2h0UGl4ZWxzLnNwbGl0KCc6JyksIHBhcnNlSW50MTApO1xuICAgIG8ueUxpbmVPbk9mZiA9IHRoaXMuaXNPbihvLnlMaW5lT25PZmYpO1xuICAgIG8ueUxpbmVNYXJrID0gcGFyc2VGbG9hdChvLnlMaW5lTWFyayk7XG4gICAgby5hdXRvU2NhbGUgPSB0aGlzLmlzT24oby5hdXRvU2NhbGUpO1xuICAgIG8ud2luZG93aW5nRnVuY3Rpb24gPSBvLndpbmRvd2luZ0Z1bmN0aW9uLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKF9iaW5GdW5jdGlvbnMgJiYgIV9iaW5GdW5jdGlvbnNbby53aW5kb3dpbmdGdW5jdGlvbl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImludmFsaWQgd2luZG93aW5nRnVuY3Rpb24gYFwiICsgby53aW5kb3dpbmdGdW5jdGlvbiArIFwiYCBhdCBsaW5lIFwiICsgby5saW5lTnVtKTsgXG4gICAgfVxuICAgIGlmIChfLmlzTmFOKG8ueUxpbmVNYXJrKSkgeyBvLnlMaW5lTWFyayA9IDAuMDsgfVxuICB9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgIHNlbGYuZHJhd1JhbmdlID0gby5hdXRvU2NhbGUgfHwgby52aWV3TGltaXRzLmxlbmd0aCA8IDIgPyBzZWxmLnJhbmdlIDogby52aWV3TGltaXRzO1xuICAgIF8uZWFjaCh7bWF4OiAwLCBtaW46IDIsIHN0YXJ0OiAxfSwgZnVuY3Rpb24odiwgaykgeyBzZWxmLmhlaWdodHNba10gPSBvLm1heEhlaWdodFBpeGVsc1t2XTsgfSk7XG4gICAgc2VsZi5zY2FsZXMgPSB7XG4gICAgICBfYWxsOiBbe2xpbWl0czogc2VsZi5kcmF3UmFuZ2UsIHRvcDogMCwgYm90dG9tOiAwfV1cbiAgICB9O1xuICAgIGlmIChvLnlMaW5lT25PZmYpIHsgc2VsZi5zY2FsZXMuX2FsbFswXS55TGluZSA9IG8ueUxpbmVNYXJrOyB9XG4gICAgXG4gICAgaWYgKCFvLmFsdENvbG9yKSB7XG4gICAgICB2YXIgaHNsID0gdGhpcy5yZ2JUb0hzbC5hcHBseSh0aGlzLCBvLmNvbG9yLnNwbGl0KC8sXFxzKi9nKSk7XG4gICAgICBoc2xbMF0gPSBoc2xbMF0gKyAwLjAyICUgMTtcbiAgICAgIGhzbFsxXSA9IGhzbFsxXSAqIDAuNztcbiAgICAgIGhzbFsyXSA9IDEgLSAoMSAtIGhzbFsyXSkgKiAwLjc7XG4gICAgICBzZWxmLmFsdENvbG9yID0gXy5tYXAodGhpcy5oc2xUb1JnYi5hcHBseSh0aGlzLCBoc2wpLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGdlbm9tZVNpemUgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICBkYXRhID0ge2FsbDogW119LFxuICAgICAgbW9kZSwgbW9kZU9wdHMsIGNoclBvcywgbTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHRoaXMub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciB2YWwsIHN0YXJ0O1xuICAgICAgXG4gICAgICBtID0gbGluZS5tYXRjaCgvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIG1vZGUgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIG1vZGVPcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgL14odmFyaWFibGV8Zml4ZWQpU3RlcFxccysvaSk7XG4gICAgICAgIG1vZGVPcHRzLnN0YXJ0ID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zdGFydCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RhcnQpIHx8ICFtb2RlT3B0cy5zdGFydCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmaXhlZFN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZSBub24temVybyBzdGFydCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnN0ZXAgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0ZXApO1xuICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnICYmIChfLmlzTmFOKG1vZGVPcHRzLnN0ZXApIHx8ICFtb2RlT3B0cy5zdGVwKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0ZXAgcGFyYW1ldGVyXCIpOyBcbiAgICAgICAgfVxuICAgICAgICBtb2RlT3B0cy5zcGFuID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zcGFuKSB8fCAxO1xuICAgICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1ttb2RlT3B0cy5jaHJvbV07XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFtb2RlKSB7IFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIldpZ2dsZSBmb3JtYXQgYXQgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIGhhcyBubyBwcmVjZWRpbmcgbW9kZSBkZWNsYXJhdGlvblwiKTsgXG4gICAgICAgIH0gZWxzZSBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgICAgLy8gaW52YWxpZCBjaHJvbW9zb21lXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJykge1xuICAgICAgICAgICAgdmFsID0gcGFyc2VGbG9hdChsaW5lKTtcbiAgICAgICAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCwgZW5kOiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCArIG1vZGVPcHRzLnNwYW4sIHZhbDogdmFsfSk7XG4gICAgICAgICAgICBtb2RlT3B0cy5zdGFydCArPSBtb2RlT3B0cy5zdGVwO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsaW5lID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICAgICAgaWYgKGxpbmUubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZVN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZXMgdHdvIHZhbHVlcyBwZXIgbGluZVwiKTsgXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGFydCA9IHBhcnNlSW50MTAobGluZVswXSk7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmVbMV0pO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIHN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gc2VsZi50eXBlKCkuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGZpbmlzaFBhcnNlOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl07XG4gICAgaWYgKGRhdGEuYWxsLmxlbmd0aCA+IDApIHtcbiAgICAgIHNlbGYucmFuZ2VbMF0gPSBfLm1pbihkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICAgIHNlbGYucmFuZ2VbMV0gPSBfLm1heChkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICB9XG4gICAgZGF0YS5hbGwgPSBuZXcgU29ydGVkTGlzdChkYXRhLmFsbCwge1xuICAgICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICBpZiAoYSA9PT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgICBpZiAoYiA9PT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PT0gMCkgID8gMCA6IC0xO1xuICAgICAgfVxuICAgIH0pO1xuICBcbiAgICAvLyBQcmUtb3B0aW1pemUgZGF0YSBmb3IgaGlnaCBicHBwcyBieSBkb3duc2FtcGxpbmdcbiAgICBfLmVhY2goc2VsZi5icm93c2VyT3B0cy5icHBwcywgZnVuY3Rpb24oYnBwcCkge1xuICAgICAgaWYgKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHAgPiAxMDAwMDAwKSB7IHJldHVybjsgfVxuICAgICAgdmFyIHBpeExlbiA9IE1hdGguY2VpbChzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyBicHBwKSxcbiAgICAgICAgZG93bnNhbXBsZWREYXRhID0gKGRhdGFbYnBwcF0gPSAoZ2xvYmFsLkZsb2F0MzJBcnJheSA/IG5ldyBGbG9hdDMyQXJyYXkocGl4TGVuKSA6IG5ldyBBcnJheShwaXhMZW4pKSksXG4gICAgICAgIGogPSAwLFxuICAgICAgICBjdXJyID0gZGF0YS5hbGwuZ2V0KDApLFxuICAgICAgICBiaW4sIG5leHQ7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBpeExlbjsgaSsrKSB7XG4gICAgICAgIGJpbiA9IGN1cnIgJiYgKGN1cnIuc3RhcnQgPD0gaSAqIGJwcHAgJiYgY3Vyci5lbmQgPiBpICogYnBwcCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IGRhdGEuYWxsLmdldChqICsgMSkpICYmIG5leHQuc3RhcnQgPCAoaSArIDEpICogYnBwcCAmJiBuZXh0LmVuZCA+IGkgKiBicHBwKSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZG93bnNhbXBsZWREYXRhW2ldID0gYmluRnVuY3Rpb24oYmluKTtcbiAgICAgIH1cbiAgICAgIGRhdGEuX2JpbkZ1bmN0aW9uID0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uO1xuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHNlbGYpO1xuICAgIHJldHVybiB0cnVlOyAvLyBzdWNjZXNzIVxuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbihwcmVjYWxjKSB7XG4gICAgdmFyIHZTY2FsZSA9ICh0aGlzLmRyYXdSYW5nZVsxXSAtIHRoaXMuZHJhd1JhbmdlWzBdKSAvIHByZWNhbGMuaGVpZ2h0LFxuICAgICAgZHJhd1NwZWMgPSB7XG4gICAgICAgIGJhcnM6IFtdLFxuICAgICAgICB2U2NhbGU6IHZTY2FsZSxcbiAgICAgICAgeUxpbmU6IHRoaXMuaXNPbih0aGlzLm9wdHMueUxpbmVPbk9mZikgPyBNYXRoLnJvdW5kKCh0aGlzLm9wdHMueUxpbmVNYXJrIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gdlNjYWxlKSA6IG51bGwsIFxuICAgICAgICB6ZXJvTGluZTogLXRoaXMuZHJhd1JhbmdlWzBdIC8gdlNjYWxlXG4gICAgICB9O1xuICAgIHJldHVybiBkcmF3U3BlYztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyBwcmVjYWxjLndpZHRoLFxuICAgICAgZHJhd1NwZWMgPSBzZWxmLnR5cGUoKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dLFxuICAgICAgZG93bnNhbXBsZWREYXRhO1xuICAgIGlmIChzZWxmLmRhdGEuX2JpbkZ1bmN0aW9uID09IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbiAmJiAoZG93bnNhbXBsZWREYXRhID0gc2VsZi5kYXRhW2JwcHBdKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBwcmUtb3B0aW1pemVkIGZvciB0aGlzIGJwcHBcbiAgICAgIGRyYXdTcGVjLmJhcnMgPSBfLm1hcChfLnJhbmdlKChzdGFydCAtIDEpIC8gYnBwcCwgKGVuZCAtIDEpIC8gYnBwcCksIGZ1bmN0aW9uKHhGcm9tT3JpZ2luLCB4KSB7XG4gICAgICAgIHJldHVybiAoKGRvd25zYW1wbGVkRGF0YVt4RnJvbU9yaWdpbl0gfHwgMCkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGU7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2UgaGF2ZSB0byBkbyB0aGUgYmlubmluZyBvbiB0aGUgZmx5XG4gICAgICB2YXIgaiA9IHNlbGYuZGF0YS5hbGwuYnNlYXJjaCh7c3RhcnQ6IHN0YXJ0fSksXG4gICAgICAgIGN1cnIgPSBzZWxmLmRhdGEuYWxsLmdldChqKSwgbmV4dCwgYmluO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjYWxjLndpZHRoOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IHNlbGYuZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgbmV4dC5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRyYXdTcGVjLmJhcnMucHVzaCgoYmluRnVuY3Rpb24oYmluKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soZHJhd1NwZWMpIDogZHJhd1NwZWM7XG4gIH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCkge1xuICAgIHZhciB6ZXJvTGluZSA9IGRyYXdTcGVjLnplcm9MaW5lLCAvLyBwaXhlbCBwb3NpdGlvbiBvZiB0aGUgZGF0YSB2YWx1ZSAwXG4gICAgICBjb2xvciA9IFwicmdiKFwiK3RoaXMub3B0cy5jb2xvcitcIilcIixcbiAgICAgIGFsdENvbG9yID0gXCJyZ2IoXCIrKHRoaXMub3B0cy5hbHRDb2xvciB8fCB0aGlzLmFsdENvbG9yKStcIilcIixcbiAgICAgIHBvaW50R3JhcGggPSB0aGlzLm9wdHMuZ3JhcGhUeXBlPT09J3BvaW50cyc7XG4gICAgXG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgIF8uZWFjaChkcmF3U3BlYy5iYXJzLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGVsc2UgaWYgKGQgPiB6ZXJvTGluZSkgeyBcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIGQsIDEsIDEpOyB9XG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgemVyb0xpbmUgPiAwID8gKGQgLSB6ZXJvTGluZSkgOiBkKTsgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGFsdENvbG9yO1xuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgemVyb0xpbmUgLSBkIC0gMSwgMSwgMSk7IH0gXG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gemVyb0xpbmUsIDEsIHplcm9MaW5lIC0gZCk7IH1cbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChkcmF3U3BlYy55TGluZSAhPT0gbnVsbCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIGhlaWdodCAtIGRyYXdTcGVjLnlMaW5lLCB3aWR0aCwgMSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdCYXJzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgJHZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJy52aWV3LWxpbWl0cycpLFxuICAgICAgJG1heEhlaWdodFBpeGVscyA9ICRkaWFsb2cuZmluZCgnLm1heC1oZWlnaHQtcGl4ZWxzJyksXG4gICAgICBhbHRDb2xvck9uID0gdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JPbl0nKS5hdHRyKCdjaGVja2VkJywgYWx0Q29sb3JPbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvcl0nKS52YWwoYWx0Q29sb3JPbiA/IG8uYWx0Q29sb3IgOicxMjgsMTI4LDEyOCcpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YXV0b1NjYWxlXScpLmF0dHIoJ2NoZWNrZWQnLCAhdGhpcy5pc09uKG8uYXV0b1NjYWxlKSkuY2hhbmdlKCk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWluXCIsIHRoaXMucmFuZ2VbMF0pO1xuICAgICR2aWV3TGltaXRzLnNsaWRlcihcIm9wdGlvblwiLCBcIm1heFwiLCB0aGlzLnJhbmdlWzFdKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKHRoaXMuZHJhd1JhbmdlWzBdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKHRoaXMuZHJhd1JhbmdlWzFdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lT25PZmZdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnlMaW5lT25PZmYpKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lTWFya10nKS52YWwoby55TGluZU1hcmspLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Z3JhcGhUeXBlXScpLnZhbChvLmdyYXBoVHlwZSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoby53aW5kb3dpbmdGdW5jdGlvbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNPbl0nKS5hdHRyKCdjaGVja2VkJywgby5tYXhIZWlnaHRQaXhlbHMubGVuZ3RoID49IDMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbChvLm1heEhlaWdodFBpeGVsc1syXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzBdKS5jaGFuZ2UoKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBhbHRDb2xvck9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzTWF4ID0gJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKCk7XG4gICAgby5hbHRDb2xvciA9IGFsdENvbG9yT24gPyAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbCgpIDogJyc7XG4gICAgby5hdXRvU2NhbGUgPSAhJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby52aWV3TGltaXRzID0gJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWluXScpLnZhbCgpICsgJzonICsgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWF4XScpLnZhbCgpO1xuICAgIG8ueUxpbmVPbk9mZiA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnlMaW5lTWFyayA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbCgpO1xuICAgIG8uZ3JhcGhUeXBlID0gJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKCk7XG4gICAgby53aW5kb3dpbmdGdW5jdGlvbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9d2luZG93aW5nRnVuY3Rpb25dJykudmFsKCk7XG4gICAgby5tYXhIZWlnaHRQaXhlbHMgPSBtYXhIZWlnaHRQaXhlbHNPbiA/IFxuICAgICAgW21heEhlaWdodFBpeGVsc01heCwgbWF4SGVpZ2h0UGl4ZWxzTWF4LCAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01pbl0nKS52YWwoKV0uam9pbignOicpIDogJyc7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdpZ2dsZUZvcm1hdDsiLCIvLyAgICAgVW5kZXJzY29yZS5qcyAxLjguM1xuLy8gICAgIGh0dHA6Ly91bmRlcnNjb3JlanMub3JnXG4vLyAgICAgKGMpIDIwMDktMjAxNSBKZXJlbXkgQXNoa2VuYXMsIERvY3VtZW50Q2xvdWQgYW5kIEludmVzdGlnYXRpdmUgUmVwb3J0ZXJzICYgRWRpdG9yc1xuLy8gICAgIFVuZGVyc2NvcmUgbWF5IGJlIGZyZWVseSBkaXN0cmlidXRlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG4oZnVuY3Rpb24oKXtmdW5jdGlvbiBuKG4pe2Z1bmN0aW9uIHQodCxyLGUsdSxpLG8pe2Zvcig7aT49MCYmbz5pO2krPW4pe3ZhciBhPXU/dVtpXTppO2U9cihlLHRbYV0sYSx0KX1yZXR1cm4gZX1yZXR1cm4gZnVuY3Rpb24ocixlLHUsaSl7ZT1iKGUsaSw0KTt2YXIgbz0hayhyKSYmbS5rZXlzKHIpLGE9KG98fHIpLmxlbmd0aCxjPW4+MD8wOmEtMTtyZXR1cm4gYXJndW1lbnRzLmxlbmd0aDwzJiYodT1yW28/b1tjXTpjXSxjKz1uKSx0KHIsZSx1LG8sYyxhKX19ZnVuY3Rpb24gdChuKXtyZXR1cm4gZnVuY3Rpb24odCxyLGUpe3I9eChyLGUpO2Zvcih2YXIgdT1PKHQpLGk9bj4wPzA6dS0xO2k+PTAmJnU+aTtpKz1uKWlmKHIodFtpXSxpLHQpKXJldHVybiBpO3JldHVybi0xfX1mdW5jdGlvbiByKG4sdCxyKXtyZXR1cm4gZnVuY3Rpb24oZSx1LGkpe3ZhciBvPTAsYT1PKGUpO2lmKFwibnVtYmVyXCI9PXR5cGVvZiBpKW4+MD9vPWk+PTA/aTpNYXRoLm1heChpK2Esbyk6YT1pPj0wP01hdGgubWluKGkrMSxhKTppK2ErMTtlbHNlIGlmKHImJmkmJmEpcmV0dXJuIGk9cihlLHUpLGVbaV09PT11P2k6LTE7aWYodSE9PXUpcmV0dXJuIGk9dChsLmNhbGwoZSxvLGEpLG0uaXNOYU4pLGk+PTA/aStvOi0xO2ZvcihpPW4+MD9vOmEtMTtpPj0wJiZhPmk7aSs9bilpZihlW2ldPT09dSlyZXR1cm4gaTtyZXR1cm4tMX19ZnVuY3Rpb24gZShuLHQpe3ZhciByPUkubGVuZ3RoLGU9bi5jb25zdHJ1Y3Rvcix1PW0uaXNGdW5jdGlvbihlKSYmZS5wcm90b3R5cGV8fGEsaT1cImNvbnN0cnVjdG9yXCI7Zm9yKG0uaGFzKG4saSkmJiFtLmNvbnRhaW5zKHQsaSkmJnQucHVzaChpKTtyLS07KWk9SVtyXSxpIGluIG4mJm5baV0hPT11W2ldJiYhbS5jb250YWlucyh0LGkpJiZ0LnB1c2goaSl9dmFyIHU9dGhpcyxpPXUuXyxvPUFycmF5LnByb3RvdHlwZSxhPU9iamVjdC5wcm90b3R5cGUsYz1GdW5jdGlvbi5wcm90b3R5cGUsZj1vLnB1c2gsbD1vLnNsaWNlLHM9YS50b1N0cmluZyxwPWEuaGFzT3duUHJvcGVydHksaD1BcnJheS5pc0FycmF5LHY9T2JqZWN0LmtleXMsZz1jLmJpbmQseT1PYmplY3QuY3JlYXRlLGQ9ZnVuY3Rpb24oKXt9LG09ZnVuY3Rpb24obil7cmV0dXJuIG4gaW5zdGFuY2VvZiBtP246dGhpcyBpbnN0YW5jZW9mIG0/dm9pZCh0aGlzLl93cmFwcGVkPW4pOm5ldyBtKG4pfTtcInVuZGVmaW5lZFwiIT10eXBlb2YgZXhwb3J0cz8oXCJ1bmRlZmluZWRcIiE9dHlwZW9mIG1vZHVsZSYmbW9kdWxlLmV4cG9ydHMmJihleHBvcnRzPW1vZHVsZS5leHBvcnRzPW0pLGV4cG9ydHMuXz1tKTp1Ll89bSxtLlZFUlNJT049XCIxLjguM1wiO3ZhciBiPWZ1bmN0aW9uKG4sdCxyKXtpZih0PT09dm9pZCAwKXJldHVybiBuO3N3aXRjaChudWxsPT1yPzM6cil7Y2FzZSAxOnJldHVybiBmdW5jdGlvbihyKXtyZXR1cm4gbi5jYWxsKHQscil9O2Nhc2UgMjpyZXR1cm4gZnVuY3Rpb24ocixlKXtyZXR1cm4gbi5jYWxsKHQscixlKX07Y2FzZSAzOnJldHVybiBmdW5jdGlvbihyLGUsdSl7cmV0dXJuIG4uY2FsbCh0LHIsZSx1KX07Y2FzZSA0OnJldHVybiBmdW5jdGlvbihyLGUsdSxpKXtyZXR1cm4gbi5jYWxsKHQscixlLHUsaSl9fXJldHVybiBmdW5jdGlvbigpe3JldHVybiBuLmFwcGx5KHQsYXJndW1lbnRzKX19LHg9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT1uP20uaWRlbnRpdHk6bS5pc0Z1bmN0aW9uKG4pP2Iobix0LHIpOm0uaXNPYmplY3Qobik/bS5tYXRjaGVyKG4pOm0ucHJvcGVydHkobil9O20uaXRlcmF0ZWU9ZnVuY3Rpb24obix0KXtyZXR1cm4geChuLHQsMS8wKX07dmFyIF89ZnVuY3Rpb24obix0KXtyZXR1cm4gZnVuY3Rpb24ocil7dmFyIGU9YXJndW1lbnRzLmxlbmd0aDtpZigyPmV8fG51bGw9PXIpcmV0dXJuIHI7Zm9yKHZhciB1PTE7ZT51O3UrKylmb3IodmFyIGk9YXJndW1lbnRzW3VdLG89bihpKSxhPW8ubGVuZ3RoLGM9MDthPmM7YysrKXt2YXIgZj1vW2NdO3QmJnJbZl0hPT12b2lkIDB8fChyW2ZdPWlbZl0pfXJldHVybiByfX0saj1mdW5jdGlvbihuKXtpZighbS5pc09iamVjdChuKSlyZXR1cm57fTtpZih5KXJldHVybiB5KG4pO2QucHJvdG90eXBlPW47dmFyIHQ9bmV3IGQ7cmV0dXJuIGQucHJvdG90eXBlPW51bGwsdH0sdz1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24odCl7cmV0dXJuIG51bGw9PXQ/dm9pZCAwOnRbbl19fSxBPU1hdGgucG93KDIsNTMpLTEsTz13KFwibGVuZ3RoXCIpLGs9ZnVuY3Rpb24obil7dmFyIHQ9TyhuKTtyZXR1cm5cIm51bWJlclwiPT10eXBlb2YgdCYmdD49MCYmQT49dH07bS5lYWNoPW0uZm9yRWFjaD1mdW5jdGlvbihuLHQscil7dD1iKHQscik7dmFyIGUsdTtpZihrKG4pKWZvcihlPTAsdT1uLmxlbmd0aDt1PmU7ZSsrKXQobltlXSxlLG4pO2Vsc2V7dmFyIGk9bS5rZXlzKG4pO2ZvcihlPTAsdT1pLmxlbmd0aDt1PmU7ZSsrKXQobltpW2VdXSxpW2VdLG4pfXJldHVybiBufSxtLm1hcD1tLmNvbGxlY3Q9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPUFycmF5KHUpLG89MDt1Pm87bysrKXt2YXIgYT1lP2Vbb106bztpW29dPXQoblthXSxhLG4pfXJldHVybiBpfSxtLnJlZHVjZT1tLmZvbGRsPW0uaW5qZWN0PW4oMSksbS5yZWR1Y2VSaWdodD1tLmZvbGRyPW4oLTEpLG0uZmluZD1tLmRldGVjdD1mdW5jdGlvbihuLHQscil7dmFyIGU7cmV0dXJuIGU9ayhuKT9tLmZpbmRJbmRleChuLHQscik6bS5maW5kS2V5KG4sdCxyKSxlIT09dm9pZCAwJiZlIT09LTE/bltlXTp2b2lkIDB9LG0uZmlsdGVyPW0uc2VsZWN0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1bXTtyZXR1cm4gdD14KHQsciksbS5lYWNoKG4sZnVuY3Rpb24obixyLHUpe3QobixyLHUpJiZlLnB1c2gobil9KSxlfSxtLnJlamVjdD1mdW5jdGlvbihuLHQscil7cmV0dXJuIG0uZmlsdGVyKG4sbS5uZWdhdGUoeCh0KSkscil9LG0uZXZlcnk9bS5hbGw9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPTA7dT5pO2krKyl7dmFyIG89ZT9lW2ldOmk7aWYoIXQobltvXSxvLG4pKXJldHVybiExfXJldHVybiEwfSxtLnNvbWU9bS5hbnk9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPTA7dT5pO2krKyl7dmFyIG89ZT9lW2ldOmk7aWYodChuW29dLG8sbikpcmV0dXJuITB9cmV0dXJuITF9LG0uY29udGFpbnM9bS5pbmNsdWRlcz1tLmluY2x1ZGU9ZnVuY3Rpb24obix0LHIsZSl7cmV0dXJuIGsobil8fChuPW0udmFsdWVzKG4pKSwoXCJudW1iZXJcIiE9dHlwZW9mIHJ8fGUpJiYocj0wKSxtLmluZGV4T2Yobix0LHIpPj0wfSxtLmludm9rZT1mdW5jdGlvbihuLHQpe3ZhciByPWwuY2FsbChhcmd1bWVudHMsMiksZT1tLmlzRnVuY3Rpb24odCk7cmV0dXJuIG0ubWFwKG4sZnVuY3Rpb24obil7dmFyIHU9ZT90Om5bdF07cmV0dXJuIG51bGw9PXU/dTp1LmFwcGx5KG4scil9KX0sbS5wbHVjaz1mdW5jdGlvbihuLHQpe3JldHVybiBtLm1hcChuLG0ucHJvcGVydHkodCkpfSxtLndoZXJlPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0uZmlsdGVyKG4sbS5tYXRjaGVyKHQpKX0sbS5maW5kV2hlcmU9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5maW5kKG4sbS5tYXRjaGVyKHQpKX0sbS5tYXg9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT0tMS8wLG89LTEvMDtpZihudWxsPT10JiZudWxsIT1uKXtuPWsobik/bjptLnZhbHVlcyhuKTtmb3IodmFyIGE9MCxjPW4ubGVuZ3RoO2M+YTthKyspZT1uW2FdLGU+aSYmKGk9ZSl9ZWxzZSB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsZSl7dT10KG4scixlKSwodT5vfHx1PT09LTEvMCYmaT09PS0xLzApJiYoaT1uLG89dSl9KTtyZXR1cm4gaX0sbS5taW49ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT0xLzAsbz0xLzA7aWYobnVsbD09dCYmbnVsbCE9bil7bj1rKG4pP246bS52YWx1ZXMobik7Zm9yKHZhciBhPTAsYz1uLmxlbmd0aDtjPmE7YSsrKWU9blthXSxpPmUmJihpPWUpfWVsc2UgdD14KHQsciksbS5lYWNoKG4sZnVuY3Rpb24obixyLGUpe3U9dChuLHIsZSksKG8+dXx8MS8wPT09dSYmMS8wPT09aSkmJihpPW4sbz11KX0pO3JldHVybiBpfSxtLnNodWZmbGU9ZnVuY3Rpb24obil7Zm9yKHZhciB0LHI9ayhuKT9uOm0udmFsdWVzKG4pLGU9ci5sZW5ndGgsdT1BcnJheShlKSxpPTA7ZT5pO2krKyl0PW0ucmFuZG9tKDAsaSksdCE9PWkmJih1W2ldPXVbdF0pLHVbdF09cltpXTtyZXR1cm4gdX0sbS5zYW1wbGU9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT10fHxyPyhrKG4pfHwobj1tLnZhbHVlcyhuKSksblttLnJhbmRvbShuLmxlbmd0aC0xKV0pOm0uc2h1ZmZsZShuKS5zbGljZSgwLE1hdGgubWF4KDAsdCkpfSxtLnNvcnRCeT1mdW5jdGlvbihuLHQscil7cmV0dXJuIHQ9eCh0LHIpLG0ucGx1Y2sobS5tYXAobixmdW5jdGlvbihuLHIsZSl7cmV0dXJue3ZhbHVlOm4saW5kZXg6cixjcml0ZXJpYTp0KG4scixlKX19KS5zb3J0KGZ1bmN0aW9uKG4sdCl7dmFyIHI9bi5jcml0ZXJpYSxlPXQuY3JpdGVyaWE7aWYociE9PWUpe2lmKHI+ZXx8cj09PXZvaWQgMClyZXR1cm4gMTtpZihlPnJ8fGU9PT12b2lkIDApcmV0dXJuLTF9cmV0dXJuIG4uaW5kZXgtdC5pbmRleH0pLFwidmFsdWVcIil9O3ZhciBGPWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbih0LHIsZSl7dmFyIHU9e307cmV0dXJuIHI9eChyLGUpLG0uZWFjaCh0LGZ1bmN0aW9uKGUsaSl7dmFyIG89cihlLGksdCk7bih1LGUsbyl9KSx1fX07bS5ncm91cEJ5PUYoZnVuY3Rpb24obix0LHIpe20uaGFzKG4scik/bltyXS5wdXNoKHQpOm5bcl09W3RdfSksbS5pbmRleEJ5PUYoZnVuY3Rpb24obix0LHIpe25bcl09dH0pLG0uY291bnRCeT1GKGZ1bmN0aW9uKG4sdCxyKXttLmhhcyhuLHIpP25bcl0rKzpuW3JdPTF9KSxtLnRvQXJyYXk9ZnVuY3Rpb24obil7cmV0dXJuIG4/bS5pc0FycmF5KG4pP2wuY2FsbChuKTprKG4pP20ubWFwKG4sbS5pZGVudGl0eSk6bS52YWx1ZXMobik6W119LG0uc2l6ZT1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj8wOmsobik/bi5sZW5ndGg6bS5rZXlzKG4pLmxlbmd0aH0sbS5wYXJ0aXRpb249ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO3ZhciBlPVtdLHU9W107cmV0dXJuIG0uZWFjaChuLGZ1bmN0aW9uKG4scixpKXsodChuLHIsaSk/ZTp1KS5wdXNoKG4pfSksW2UsdV19LG0uZmlyc3Q9bS5oZWFkPW0udGFrZT1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PW4/dm9pZCAwOm51bGw9PXR8fHI/blswXTptLmluaXRpYWwobixuLmxlbmd0aC10KX0sbS5pbml0aWFsPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbC5jYWxsKG4sMCxNYXRoLm1heCgwLG4ubGVuZ3RoLShudWxsPT10fHxyPzE6dCkpKX0sbS5sYXN0PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09bj92b2lkIDA6bnVsbD09dHx8cj9uW24ubGVuZ3RoLTFdOm0ucmVzdChuLE1hdGgubWF4KDAsbi5sZW5ndGgtdCkpfSxtLnJlc3Q9bS50YWlsPW0uZHJvcD1mdW5jdGlvbihuLHQscil7cmV0dXJuIGwuY2FsbChuLG51bGw9PXR8fHI/MTp0KX0sbS5jb21wYWN0PWZ1bmN0aW9uKG4pe3JldHVybiBtLmZpbHRlcihuLG0uaWRlbnRpdHkpfTt2YXIgUz1mdW5jdGlvbihuLHQscixlKXtmb3IodmFyIHU9W10saT0wLG89ZXx8MCxhPU8obik7YT5vO28rKyl7dmFyIGM9bltvXTtpZihrKGMpJiYobS5pc0FycmF5KGMpfHxtLmlzQXJndW1lbnRzKGMpKSl7dHx8KGM9UyhjLHQscikpO3ZhciBmPTAsbD1jLmxlbmd0aDtmb3IodS5sZW5ndGgrPWw7bD5mOyl1W2krK109Y1tmKytdfWVsc2Ugcnx8KHVbaSsrXT1jKX1yZXR1cm4gdX07bS5mbGF0dGVuPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIFMobix0LCExKX0sbS53aXRob3V0PWZ1bmN0aW9uKG4pe3JldHVybiBtLmRpZmZlcmVuY2UobixsLmNhbGwoYXJndW1lbnRzLDEpKX0sbS51bmlxPW0udW5pcXVlPWZ1bmN0aW9uKG4sdCxyLGUpe20uaXNCb29sZWFuKHQpfHwoZT1yLHI9dCx0PSExKSxudWxsIT1yJiYocj14KHIsZSkpO2Zvcih2YXIgdT1bXSxpPVtdLG89MCxhPU8obik7YT5vO28rKyl7dmFyIGM9bltvXSxmPXI/cihjLG8sbik6Yzt0PyhvJiZpPT09Znx8dS5wdXNoKGMpLGk9Zik6cj9tLmNvbnRhaW5zKGksZil8fChpLnB1c2goZiksdS5wdXNoKGMpKTptLmNvbnRhaW5zKHUsYyl8fHUucHVzaChjKX1yZXR1cm4gdX0sbS51bmlvbj1mdW5jdGlvbigpe3JldHVybiBtLnVuaXEoUyhhcmd1bWVudHMsITAsITApKX0sbS5pbnRlcnNlY3Rpb249ZnVuY3Rpb24obil7Zm9yKHZhciB0PVtdLHI9YXJndW1lbnRzLmxlbmd0aCxlPTAsdT1PKG4pO3U+ZTtlKyspe3ZhciBpPW5bZV07aWYoIW0uY29udGFpbnModCxpKSl7Zm9yKHZhciBvPTE7cj5vJiZtLmNvbnRhaW5zKGFyZ3VtZW50c1tvXSxpKTtvKyspO289PT1yJiZ0LnB1c2goaSl9fXJldHVybiB0fSxtLmRpZmZlcmVuY2U9ZnVuY3Rpb24obil7dmFyIHQ9Uyhhcmd1bWVudHMsITAsITAsMSk7cmV0dXJuIG0uZmlsdGVyKG4sZnVuY3Rpb24obil7cmV0dXJuIW0uY29udGFpbnModCxuKX0pfSxtLnppcD1mdW5jdGlvbigpe3JldHVybiBtLnVuemlwKGFyZ3VtZW50cyl9LG0udW56aXA9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW4mJm0ubWF4KG4sTykubGVuZ3RofHwwLHI9QXJyYXkodCksZT0wO3Q+ZTtlKyspcltlXT1tLnBsdWNrKG4sZSk7cmV0dXJuIHJ9LG0ub2JqZWN0PWZ1bmN0aW9uKG4sdCl7Zm9yKHZhciByPXt9LGU9MCx1PU8obik7dT5lO2UrKyl0P3JbbltlXV09dFtlXTpyW25bZV1bMF1dPW5bZV1bMV07cmV0dXJuIHJ9LG0uZmluZEluZGV4PXQoMSksbS5maW5kTGFzdEluZGV4PXQoLTEpLG0uc29ydGVkSW5kZXg9ZnVuY3Rpb24obix0LHIsZSl7cj14KHIsZSwxKTtmb3IodmFyIHU9cih0KSxpPTAsbz1PKG4pO28+aTspe3ZhciBhPU1hdGguZmxvb3IoKGkrbykvMik7cihuW2FdKTx1P2k9YSsxOm89YX1yZXR1cm4gaX0sbS5pbmRleE9mPXIoMSxtLmZpbmRJbmRleCxtLnNvcnRlZEluZGV4KSxtLmxhc3RJbmRleE9mPXIoLTEsbS5maW5kTGFzdEluZGV4KSxtLnJhbmdlPWZ1bmN0aW9uKG4sdCxyKXtudWxsPT10JiYodD1ufHwwLG49MCkscj1yfHwxO2Zvcih2YXIgZT1NYXRoLm1heChNYXRoLmNlaWwoKHQtbikvciksMCksdT1BcnJheShlKSxpPTA7ZT5pO2krKyxuKz1yKXVbaV09bjtyZXR1cm4gdX07dmFyIEU9ZnVuY3Rpb24obix0LHIsZSx1KXtpZighKGUgaW5zdGFuY2VvZiB0KSlyZXR1cm4gbi5hcHBseShyLHUpO3ZhciBpPWoobi5wcm90b3R5cGUpLG89bi5hcHBseShpLHUpO3JldHVybiBtLmlzT2JqZWN0KG8pP286aX07bS5iaW5kPWZ1bmN0aW9uKG4sdCl7aWYoZyYmbi5iaW5kPT09ZylyZXR1cm4gZy5hcHBseShuLGwuY2FsbChhcmd1bWVudHMsMSkpO2lmKCFtLmlzRnVuY3Rpb24obikpdGhyb3cgbmV3IFR5cGVFcnJvcihcIkJpbmQgbXVzdCBiZSBjYWxsZWQgb24gYSBmdW5jdGlvblwiKTt2YXIgcj1sLmNhbGwoYXJndW1lbnRzLDIpLGU9ZnVuY3Rpb24oKXtyZXR1cm4gRShuLGUsdCx0aGlzLHIuY29uY2F0KGwuY2FsbChhcmd1bWVudHMpKSl9O3JldHVybiBlfSxtLnBhcnRpYWw9ZnVuY3Rpb24obil7dmFyIHQ9bC5jYWxsKGFyZ3VtZW50cywxKSxyPWZ1bmN0aW9uKCl7Zm9yKHZhciBlPTAsdT10Lmxlbmd0aCxpPUFycmF5KHUpLG89MDt1Pm87bysrKWlbb109dFtvXT09PW0/YXJndW1lbnRzW2UrK106dFtvXTtmb3IoO2U8YXJndW1lbnRzLmxlbmd0aDspaS5wdXNoKGFyZ3VtZW50c1tlKytdKTtyZXR1cm4gRShuLHIsdGhpcyx0aGlzLGkpfTtyZXR1cm4gcn0sbS5iaW5kQWxsPWZ1bmN0aW9uKG4pe3ZhciB0LHIsZT1hcmd1bWVudHMubGVuZ3RoO2lmKDE+PWUpdGhyb3cgbmV3IEVycm9yKFwiYmluZEFsbCBtdXN0IGJlIHBhc3NlZCBmdW5jdGlvbiBuYW1lc1wiKTtmb3IodD0xO2U+dDt0Kyspcj1hcmd1bWVudHNbdF0sbltyXT1tLmJpbmQobltyXSxuKTtyZXR1cm4gbn0sbS5tZW1vaXplPWZ1bmN0aW9uKG4sdCl7dmFyIHI9ZnVuY3Rpb24oZSl7dmFyIHU9ci5jYWNoZSxpPVwiXCIrKHQ/dC5hcHBseSh0aGlzLGFyZ3VtZW50cyk6ZSk7cmV0dXJuIG0uaGFzKHUsaSl8fCh1W2ldPW4uYXBwbHkodGhpcyxhcmd1bWVudHMpKSx1W2ldfTtyZXR1cm4gci5jYWNoZT17fSxyfSxtLmRlbGF5PWZ1bmN0aW9uKG4sdCl7dmFyIHI9bC5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gc2V0VGltZW91dChmdW5jdGlvbigpe3JldHVybiBuLmFwcGx5KG51bGwscil9LHQpfSxtLmRlZmVyPW0ucGFydGlhbChtLmRlbGF5LG0sMSksbS50aHJvdHRsZT1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpLG89bnVsbCxhPTA7cnx8KHI9e30pO3ZhciBjPWZ1bmN0aW9uKCl7YT1yLmxlYWRpbmc9PT0hMT8wOm0ubm93KCksbz1udWxsLGk9bi5hcHBseShlLHUpLG98fChlPXU9bnVsbCl9O3JldHVybiBmdW5jdGlvbigpe3ZhciBmPW0ubm93KCk7YXx8ci5sZWFkaW5nIT09ITF8fChhPWYpO3ZhciBsPXQtKGYtYSk7cmV0dXJuIGU9dGhpcyx1PWFyZ3VtZW50cywwPj1sfHxsPnQ/KG8mJihjbGVhclRpbWVvdXQobyksbz1udWxsKSxhPWYsaT1uLmFwcGx5KGUsdSksb3x8KGU9dT1udWxsKSk6b3x8ci50cmFpbGluZz09PSExfHwobz1zZXRUaW1lb3V0KGMsbCkpLGl9fSxtLmRlYm91bmNlPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGksbyxhLGM9ZnVuY3Rpb24oKXt2YXIgZj1tLm5vdygpLW87dD5mJiZmPj0wP2U9c2V0VGltZW91dChjLHQtZik6KGU9bnVsbCxyfHwoYT1uLmFwcGx5KGksdSksZXx8KGk9dT1udWxsKSkpfTtyZXR1cm4gZnVuY3Rpb24oKXtpPXRoaXMsdT1hcmd1bWVudHMsbz1tLm5vdygpO3ZhciBmPXImJiFlO3JldHVybiBlfHwoZT1zZXRUaW1lb3V0KGMsdCkpLGYmJihhPW4uYXBwbHkoaSx1KSxpPXU9bnVsbCksYX19LG0ud3JhcD1mdW5jdGlvbihuLHQpe3JldHVybiBtLnBhcnRpYWwodCxuKX0sbS5uZWdhdGU9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIW4uYXBwbHkodGhpcyxhcmd1bWVudHMpfX0sbS5jb21wb3NlPWZ1bmN0aW9uKCl7dmFyIG49YXJndW1lbnRzLHQ9bi5sZW5ndGgtMTtyZXR1cm4gZnVuY3Rpb24oKXtmb3IodmFyIHI9dCxlPW5bdF0uYXBwbHkodGhpcyxhcmd1bWVudHMpO3ItLTspZT1uW3JdLmNhbGwodGhpcyxlKTtyZXR1cm4gZX19LG0uYWZ0ZXI9ZnVuY3Rpb24obix0KXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4tLW48MT90LmFwcGx5KHRoaXMsYXJndW1lbnRzKTp2b2lkIDB9fSxtLmJlZm9yZT1mdW5jdGlvbihuLHQpe3ZhciByO3JldHVybiBmdW5jdGlvbigpe3JldHVybi0tbj4wJiYocj10LmFwcGx5KHRoaXMsYXJndW1lbnRzKSksMT49biYmKHQ9bnVsbCkscn19LG0ub25jZT1tLnBhcnRpYWwobS5iZWZvcmUsMik7dmFyIE09IXt0b1N0cmluZzpudWxsfS5wcm9wZXJ0eUlzRW51bWVyYWJsZShcInRvU3RyaW5nXCIpLEk9W1widmFsdWVPZlwiLFwiaXNQcm90b3R5cGVPZlwiLFwidG9TdHJpbmdcIixcInByb3BlcnR5SXNFbnVtZXJhYmxlXCIsXCJoYXNPd25Qcm9wZXJ0eVwiLFwidG9Mb2NhbGVTdHJpbmdcIl07bS5rZXlzPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybltdO2lmKHYpcmV0dXJuIHYobik7dmFyIHQ9W107Zm9yKHZhciByIGluIG4pbS5oYXMobixyKSYmdC5wdXNoKHIpO3JldHVybiBNJiZlKG4sdCksdH0sbS5hbGxLZXlzPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybltdO3ZhciB0PVtdO2Zvcih2YXIgciBpbiBuKXQucHVzaChyKTtyZXR1cm4gTSYmZShuLHQpLHR9LG0udmFsdWVzPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD1tLmtleXMobikscj10Lmxlbmd0aCxlPUFycmF5KHIpLHU9MDtyPnU7dSsrKWVbdV09blt0W3VdXTtyZXR1cm4gZX0sbS5tYXBPYmplY3Q9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZSx1PW0ua2V5cyhuKSxpPXUubGVuZ3RoLG89e30sYT0wO2k+YTthKyspZT11W2FdLG9bZV09dChuW2VdLGUsbik7cmV0dXJuIG99LG0ucGFpcnM9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW0ua2V5cyhuKSxyPXQubGVuZ3RoLGU9QXJyYXkociksdT0wO3I+dTt1KyspZVt1XT1bdFt1XSxuW3RbdV1dXTtyZXR1cm4gZX0sbS5pbnZlcnQ9ZnVuY3Rpb24obil7Zm9yKHZhciB0PXt9LHI9bS5rZXlzKG4pLGU9MCx1PXIubGVuZ3RoO3U+ZTtlKyspdFtuW3JbZV1dXT1yW2VdO3JldHVybiB0fSxtLmZ1bmN0aW9ucz1tLm1ldGhvZHM9ZnVuY3Rpb24obil7dmFyIHQ9W107Zm9yKHZhciByIGluIG4pbS5pc0Z1bmN0aW9uKG5bcl0pJiZ0LnB1c2gocik7cmV0dXJuIHQuc29ydCgpfSxtLmV4dGVuZD1fKG0uYWxsS2V5cyksbS5leHRlbmRPd249bS5hc3NpZ249XyhtLmtleXMpLG0uZmluZEtleT1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlLHU9bS5rZXlzKG4pLGk9MCxvPXUubGVuZ3RoO28+aTtpKyspaWYoZT11W2ldLHQobltlXSxlLG4pKXJldHVybiBlfSxtLnBpY2s9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT17fSxvPW47aWYobnVsbD09bylyZXR1cm4gaTttLmlzRnVuY3Rpb24odCk/KHU9bS5hbGxLZXlzKG8pLGU9Yih0LHIpKToodT1TKGFyZ3VtZW50cywhMSwhMSwxKSxlPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gdCBpbiByfSxvPU9iamVjdChvKSk7Zm9yKHZhciBhPTAsYz11Lmxlbmd0aDtjPmE7YSsrKXt2YXIgZj11W2FdLGw9b1tmXTtlKGwsZixvKSYmKGlbZl09bCl9cmV0dXJuIGl9LG0ub21pdD1mdW5jdGlvbihuLHQscil7aWYobS5pc0Z1bmN0aW9uKHQpKXQ9bS5uZWdhdGUodCk7ZWxzZXt2YXIgZT1tLm1hcChTKGFyZ3VtZW50cywhMSwhMSwxKSxTdHJpbmcpO3Q9ZnVuY3Rpb24obix0KXtyZXR1cm4hbS5jb250YWlucyhlLHQpfX1yZXR1cm4gbS5waWNrKG4sdCxyKX0sbS5kZWZhdWx0cz1fKG0uYWxsS2V5cywhMCksbS5jcmVhdGU9ZnVuY3Rpb24obix0KXt2YXIgcj1qKG4pO3JldHVybiB0JiZtLmV4dGVuZE93bihyLHQpLHJ9LG0uY2xvbmU9ZnVuY3Rpb24obil7cmV0dXJuIG0uaXNPYmplY3Qobik/bS5pc0FycmF5KG4pP24uc2xpY2UoKTptLmV4dGVuZCh7fSxuKTpufSxtLnRhcD1mdW5jdGlvbihuLHQpe3JldHVybiB0KG4pLG59LG0uaXNNYXRjaD1mdW5jdGlvbihuLHQpe3ZhciByPW0ua2V5cyh0KSxlPXIubGVuZ3RoO2lmKG51bGw9PW4pcmV0dXJuIWU7Zm9yKHZhciB1PU9iamVjdChuKSxpPTA7ZT5pO2krKyl7dmFyIG89cltpXTtpZih0W29dIT09dVtvXXx8IShvIGluIHUpKXJldHVybiExfXJldHVybiEwfTt2YXIgTj1mdW5jdGlvbihuLHQscixlKXtpZihuPT09dClyZXR1cm4gMCE9PW58fDEvbj09PTEvdDtpZihudWxsPT1ufHxudWxsPT10KXJldHVybiBuPT09dDtuIGluc3RhbmNlb2YgbSYmKG49bi5fd3JhcHBlZCksdCBpbnN0YW5jZW9mIG0mJih0PXQuX3dyYXBwZWQpO3ZhciB1PXMuY2FsbChuKTtpZih1IT09cy5jYWxsKHQpKXJldHVybiExO3N3aXRjaCh1KXtjYXNlXCJbb2JqZWN0IFJlZ0V4cF1cIjpjYXNlXCJbb2JqZWN0IFN0cmluZ11cIjpyZXR1cm5cIlwiK249PVwiXCIrdDtjYXNlXCJbb2JqZWN0IE51bWJlcl1cIjpyZXR1cm4rbiE9PStuPyt0IT09K3Q6MD09PStuPzEvK249PT0xL3Q6K249PT0rdDtjYXNlXCJbb2JqZWN0IERhdGVdXCI6Y2FzZVwiW29iamVjdCBCb29sZWFuXVwiOnJldHVybituPT09K3R9dmFyIGk9XCJbb2JqZWN0IEFycmF5XVwiPT09dTtpZighaSl7aWYoXCJvYmplY3RcIiE9dHlwZW9mIG58fFwib2JqZWN0XCIhPXR5cGVvZiB0KXJldHVybiExO3ZhciBvPW4uY29uc3RydWN0b3IsYT10LmNvbnN0cnVjdG9yO2lmKG8hPT1hJiYhKG0uaXNGdW5jdGlvbihvKSYmbyBpbnN0YW5jZW9mIG8mJm0uaXNGdW5jdGlvbihhKSYmYSBpbnN0YW5jZW9mIGEpJiZcImNvbnN0cnVjdG9yXCJpbiBuJiZcImNvbnN0cnVjdG9yXCJpbiB0KXJldHVybiExfXI9cnx8W10sZT1lfHxbXTtmb3IodmFyIGM9ci5sZW5ndGg7Yy0tOylpZihyW2NdPT09bilyZXR1cm4gZVtjXT09PXQ7aWYoci5wdXNoKG4pLGUucHVzaCh0KSxpKXtpZihjPW4ubGVuZ3RoLGMhPT10Lmxlbmd0aClyZXR1cm4hMTtmb3IoO2MtLTspaWYoIU4obltjXSx0W2NdLHIsZSkpcmV0dXJuITF9ZWxzZXt2YXIgZixsPW0ua2V5cyhuKTtpZihjPWwubGVuZ3RoLG0ua2V5cyh0KS5sZW5ndGghPT1jKXJldHVybiExO2Zvcig7Yy0tOylpZihmPWxbY10sIW0uaGFzKHQsZil8fCFOKG5bZl0sdFtmXSxyLGUpKXJldHVybiExfXJldHVybiByLnBvcCgpLGUucG9wKCksITB9O20uaXNFcXVhbD1mdW5jdGlvbihuLHQpe3JldHVybiBOKG4sdCl9LG0uaXNFbXB0eT1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj8hMDprKG4pJiYobS5pc0FycmF5KG4pfHxtLmlzU3RyaW5nKG4pfHxtLmlzQXJndW1lbnRzKG4pKT8wPT09bi5sZW5ndGg6MD09PW0ua2V5cyhuKS5sZW5ndGh9LG0uaXNFbGVtZW50PWZ1bmN0aW9uKG4pe3JldHVybiEoIW58fDEhPT1uLm5vZGVUeXBlKX0sbS5pc0FycmF5PWh8fGZ1bmN0aW9uKG4pe3JldHVyblwiW29iamVjdCBBcnJheV1cIj09PXMuY2FsbChuKX0sbS5pc09iamVjdD1mdW5jdGlvbihuKXt2YXIgdD10eXBlb2YgbjtyZXR1cm5cImZ1bmN0aW9uXCI9PT10fHxcIm9iamVjdFwiPT09dCYmISFufSxtLmVhY2goW1wiQXJndW1lbnRzXCIsXCJGdW5jdGlvblwiLFwiU3RyaW5nXCIsXCJOdW1iZXJcIixcIkRhdGVcIixcIlJlZ0V4cFwiLFwiRXJyb3JcIl0sZnVuY3Rpb24obil7bVtcImlzXCIrbl09ZnVuY3Rpb24odCl7cmV0dXJuIHMuY2FsbCh0KT09PVwiW29iamVjdCBcIituK1wiXVwifX0pLG0uaXNBcmd1bWVudHMoYXJndW1lbnRzKXx8KG0uaXNBcmd1bWVudHM9ZnVuY3Rpb24obil7cmV0dXJuIG0uaGFzKG4sXCJjYWxsZWVcIil9KSxcImZ1bmN0aW9uXCIhPXR5cGVvZi8uLyYmXCJvYmplY3RcIiE9dHlwZW9mIEludDhBcnJheSYmKG0uaXNGdW5jdGlvbj1mdW5jdGlvbihuKXtyZXR1cm5cImZ1bmN0aW9uXCI9PXR5cGVvZiBufHwhMX0pLG0uaXNGaW5pdGU9ZnVuY3Rpb24obil7cmV0dXJuIGlzRmluaXRlKG4pJiYhaXNOYU4ocGFyc2VGbG9hdChuKSl9LG0uaXNOYU49ZnVuY3Rpb24obil7cmV0dXJuIG0uaXNOdW1iZXIobikmJm4hPT0rbn0sbS5pc0Jvb2xlYW49ZnVuY3Rpb24obil7cmV0dXJuIG49PT0hMHx8bj09PSExfHxcIltvYmplY3QgQm9vbGVhbl1cIj09PXMuY2FsbChuKX0sbS5pc051bGw9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PT1ufSxtLmlzVW5kZWZpbmVkPWZ1bmN0aW9uKG4pe3JldHVybiBuPT09dm9pZCAwfSxtLmhhcz1mdW5jdGlvbihuLHQpe3JldHVybiBudWxsIT1uJiZwLmNhbGwobix0KX0sbS5ub0NvbmZsaWN0PWZ1bmN0aW9uKCl7cmV0dXJuIHUuXz1pLHRoaXN9LG0uaWRlbnRpdHk9ZnVuY3Rpb24obil7cmV0dXJuIG59LG0uY29uc3RhbnQ9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIG59fSxtLm5vb3A9ZnVuY3Rpb24oKXt9LG0ucHJvcGVydHk9dyxtLnByb3BlcnR5T2Y9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PW4/ZnVuY3Rpb24oKXt9OmZ1bmN0aW9uKHQpe3JldHVybiBuW3RdfX0sbS5tYXRjaGVyPW0ubWF0Y2hlcz1mdW5jdGlvbihuKXtyZXR1cm4gbj1tLmV4dGVuZE93bih7fSxuKSxmdW5jdGlvbih0KXtyZXR1cm4gbS5pc01hdGNoKHQsbil9fSxtLnRpbWVzPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1BcnJheShNYXRoLm1heCgwLG4pKTt0PWIodCxyLDEpO2Zvcih2YXIgdT0wO24+dTt1KyspZVt1XT10KHUpO3JldHVybiBlfSxtLnJhbmRvbT1mdW5jdGlvbihuLHQpe3JldHVybiBudWxsPT10JiYodD1uLG49MCksbitNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkqKHQtbisxKSl9LG0ubm93PURhdGUubm93fHxmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfTt2YXIgQj17XCImXCI6XCImYW1wO1wiLFwiPFwiOlwiJmx0O1wiLFwiPlwiOlwiJmd0O1wiLCdcIic6XCImcXVvdDtcIixcIidcIjpcIiYjeDI3O1wiLFwiYFwiOlwiJiN4NjA7XCJ9LFQ9bS5pbnZlcnQoQiksUj1mdW5jdGlvbihuKXt2YXIgdD1mdW5jdGlvbih0KXtyZXR1cm4gblt0XX0scj1cIig/OlwiK20ua2V5cyhuKS5qb2luKFwifFwiKStcIilcIixlPVJlZ0V4cChyKSx1PVJlZ0V4cChyLFwiZ1wiKTtyZXR1cm4gZnVuY3Rpb24obil7cmV0dXJuIG49bnVsbD09bj9cIlwiOlwiXCIrbixlLnRlc3Qobik/bi5yZXBsYWNlKHUsdCk6bn19O20uZXNjYXBlPVIoQiksbS51bmVzY2FwZT1SKFQpLG0ucmVzdWx0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1udWxsPT1uP3ZvaWQgMDpuW3RdO3JldHVybiBlPT09dm9pZCAwJiYoZT1yKSxtLmlzRnVuY3Rpb24oZSk/ZS5jYWxsKG4pOmV9O3ZhciBxPTA7bS51bmlxdWVJZD1mdW5jdGlvbihuKXt2YXIgdD0rK3ErXCJcIjtyZXR1cm4gbj9uK3Q6dH0sbS50ZW1wbGF0ZVNldHRpbmdzPXtldmFsdWF0ZTovPCUoW1xcc1xcU10rPyklPi9nLGludGVycG9sYXRlOi88JT0oW1xcc1xcU10rPyklPi9nLGVzY2FwZTovPCUtKFtcXHNcXFNdKz8pJT4vZ307dmFyIEs9LyguKV4vLHo9e1wiJ1wiOlwiJ1wiLFwiXFxcXFwiOlwiXFxcXFwiLFwiXFxyXCI6XCJyXCIsXCJcXG5cIjpcIm5cIixcIlxcdTIwMjhcIjpcInUyMDI4XCIsXCJcXHUyMDI5XCI6XCJ1MjAyOVwifSxEPS9cXFxcfCd8XFxyfFxcbnxcXHUyMDI4fFxcdTIwMjkvZyxMPWZ1bmN0aW9uKG4pe3JldHVyblwiXFxcXFwiK3pbbl19O20udGVtcGxhdGU9ZnVuY3Rpb24obix0LHIpeyF0JiZyJiYodD1yKSx0PW0uZGVmYXVsdHMoe30sdCxtLnRlbXBsYXRlU2V0dGluZ3MpO3ZhciBlPVJlZ0V4cChbKHQuZXNjYXBlfHxLKS5zb3VyY2UsKHQuaW50ZXJwb2xhdGV8fEspLnNvdXJjZSwodC5ldmFsdWF0ZXx8Sykuc291cmNlXS5qb2luKFwifFwiKStcInwkXCIsXCJnXCIpLHU9MCxpPVwiX19wKz0nXCI7bi5yZXBsYWNlKGUsZnVuY3Rpb24odCxyLGUsbyxhKXtyZXR1cm4gaSs9bi5zbGljZSh1LGEpLnJlcGxhY2UoRCxMKSx1PWErdC5sZW5ndGgscj9pKz1cIicrXFxuKChfX3Q9KFwiK3IrXCIpKT09bnVsbD8nJzpfLmVzY2FwZShfX3QpKStcXG4nXCI6ZT9pKz1cIicrXFxuKChfX3Q9KFwiK2UrXCIpKT09bnVsbD8nJzpfX3QpK1xcbidcIjpvJiYoaSs9XCInO1xcblwiK28rXCJcXG5fX3ArPSdcIiksdH0pLGkrPVwiJztcXG5cIix0LnZhcmlhYmxlfHwoaT1cIndpdGgob2JqfHx7fSl7XFxuXCIraStcIn1cXG5cIiksaT1cInZhciBfX3QsX19wPScnLF9faj1BcnJheS5wcm90b3R5cGUuam9pbixcIitcInByaW50PWZ1bmN0aW9uKCl7X19wKz1fX2ouY2FsbChhcmd1bWVudHMsJycpO307XFxuXCIraStcInJldHVybiBfX3A7XFxuXCI7dHJ5e3ZhciBvPW5ldyBGdW5jdGlvbih0LnZhcmlhYmxlfHxcIm9ialwiLFwiX1wiLGkpfWNhdGNoKGEpe3Rocm93IGEuc291cmNlPWksYX12YXIgYz1mdW5jdGlvbihuKXtyZXR1cm4gby5jYWxsKHRoaXMsbixtKX0sZj10LnZhcmlhYmxlfHxcIm9ialwiO3JldHVybiBjLnNvdXJjZT1cImZ1bmN0aW9uKFwiK2YrXCIpe1xcblwiK2krXCJ9XCIsY30sbS5jaGFpbj1mdW5jdGlvbihuKXt2YXIgdD1tKG4pO3JldHVybiB0Ll9jaGFpbj0hMCx0fTt2YXIgUD1mdW5jdGlvbihuLHQpe3JldHVybiBuLl9jaGFpbj9tKHQpLmNoYWluKCk6dH07bS5taXhpbj1mdW5jdGlvbihuKXttLmVhY2gobS5mdW5jdGlvbnMobiksZnVuY3Rpb24odCl7dmFyIHI9bVt0XT1uW3RdO20ucHJvdG90eXBlW3RdPWZ1bmN0aW9uKCl7dmFyIG49W3RoaXMuX3dyYXBwZWRdO3JldHVybiBmLmFwcGx5KG4sYXJndW1lbnRzKSxQKHRoaXMsci5hcHBseShtLG4pKX19KX0sbS5taXhpbihtKSxtLmVhY2goW1wicG9wXCIsXCJwdXNoXCIsXCJyZXZlcnNlXCIsXCJzaGlmdFwiLFwic29ydFwiLFwic3BsaWNlXCIsXCJ1bnNoaWZ0XCJdLGZ1bmN0aW9uKG4pe3ZhciB0PW9bbl07bS5wcm90b3R5cGVbbl09ZnVuY3Rpb24oKXt2YXIgcj10aGlzLl93cmFwcGVkO3JldHVybiB0LmFwcGx5KHIsYXJndW1lbnRzKSxcInNoaWZ0XCIhPT1uJiZcInNwbGljZVwiIT09bnx8MCE9PXIubGVuZ3RofHxkZWxldGUgclswXSxQKHRoaXMscil9fSksbS5lYWNoKFtcImNvbmNhdFwiLFwiam9pblwiLFwic2xpY2VcIl0sZnVuY3Rpb24obil7dmFyIHQ9b1tuXTttLnByb3RvdHlwZVtuXT1mdW5jdGlvbigpe3JldHVybiBQKHRoaXMsdC5hcHBseSh0aGlzLl93cmFwcGVkLGFyZ3VtZW50cykpfX0pLG0ucHJvdG90eXBlLnZhbHVlPWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuX3dyYXBwZWR9LG0ucHJvdG90eXBlLnZhbHVlT2Y9bS5wcm90b3R5cGUudG9KU09OPW0ucHJvdG90eXBlLnZhbHVlLG0ucHJvdG90eXBlLnRvU3RyaW5nPWZ1bmN0aW9uKCl7cmV0dXJuXCJcIit0aGlzLl93cmFwcGVkfSxcImZ1bmN0aW9uXCI9PXR5cGVvZiBkZWZpbmUmJmRlZmluZS5hbWQmJmRlZmluZShcInVuZGVyc2NvcmVcIixbXSxmdW5jdGlvbigpe3JldHVybiBtfSl9KS5jYWxsKHRoaXMpOyJdfQ==
