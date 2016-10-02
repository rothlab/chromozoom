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
},{"../underscore.min.js":26,"./genome-formats/chromsizes.js":6,"./genome-formats/fasta.js":7,"./genome-formats/genbank.js":8,"./genome-formats/utils/utils.js":9}],2:[function(require,module,exports){
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
},{"../underscore.min.js":26,"./CustomGenomes.js":3,"./jquery.nodom.min.js":10}],3:[function(require,module,exports){
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
},{"../underscore.min.js":26,"./CustomGenome":1,"./CustomTracks.js":5}],4:[function(require,module,exports){
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
  bigwig: require('./track-types/bigwig.js'),
  biggenepred: require('./track-types/biggenepred.js')
};

// ==========================================================================
// = bedDetail format: https://genome.ucsc.edu/FAQ/FAQformat.html#format1.7 =
// ==========================================================================  

CustomTrack.types.beddetail = _.clone(CustomTrack.types.bed);
CustomTrack.types.beddetail.defaults = _.extend({}, CustomTrack.types.beddetail.defaults, {detail: true});

// These functions branch to different methods depending on the .type() of the track
_.each(['init', 'parse', 'finishSetup', 'render', 'renderSequence', 'prerender'], function(fn) {
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

CustomTrack.prototype.finishSetupAsync = function() {
  global.CustomTracks.async(this, 'finishSetup', arguments, [this.id]);
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
},{"../underscore.min.js":26,"./track-types/bam.js":11,"./track-types/bed.js":12,"./track-types/bedgraph.js":13,"./track-types/bigbed.js":14,"./track-types/biggenepred.js":15,"./track-types/bigwig.js":16,"./track-types/featuretable.js":17,"./track-types/utils/utils.js":23,"./track-types/vcftabix.js":24,"./track-types/wiggle_0.js":25}],5:[function(require,module,exports){
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
},{"../underscore.min.js":26,"./CustomTrack.js":4,"./track-types/utils/utils.js":23}],6:[function(require,module,exports){
(function (global){
// ====================================================================
// = chrom.sizes format: http://www.broadinstitute.org/igv/chromSizes =
// ====================================================================
// Note: we are extending the general use of this to include data loaded from the genome.txt and annots.xml
// files of an IGB quickload directory,

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  optsAsTrackLine = utils.optsAsTrackLine
  trackHeightForType = utils.trackHeightForType;

var ChromSizesFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
    o.species = m.species || 'Custom Genome';
    o.assemblyDate = m.assemblyDate || '';
    
    if (m.tracks) { self.format().createTracks(m.tracks); }
    o.searchableTracks = m.moreTracks || (m.tracks && m.tracks.length > 15);
    
    if (m.cytoBandIdeo) { self.format().createChrBands(m.cytoBandIdeo); }
  },
  
  createTracks: function(tracks) {
    var self = this,
      o = self.opts,
      categories = {};
      
    _.each(tracks, function(t) {
      var trackOpts, 
        visible = true,
        cat = t.grp || "Feature Tracks";
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
        h: trackHeightForType(t.type),
        m: ['pack'],
        customData: t.lines
      });
      if (visible) { o.tracks.push({n: t.name}); }
      o.trackDesc[t.name] = {
        cat: cat,
        sm: t.shortLabel || t.name,
        lg: t.description || t.name
      };
      categories[cat] = true;
    });
    
    if (_.keys(categories).length > 1) { o.groupTracksByCategory = true; }
  },
  
  createChrBands: function(cytoBandIdeo) {
    var o = this.opts;
    o.chrBands = _.compact(_.map(cytoBandIdeo.split("\n"), function(l) { 
      var fields = l.split("\t");
      if (fields.length != 5) { return false; }
      fields[1] = parseInt10(fields[1]);
      fields[2] = parseInt10(fields[2]);
      return fields;
    }));
    if (o.chrBands.length > 0) { 
      o.ideogramsAbove = true;
      o.availTracks[0].h = 50;
    }
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
    
    if (o.chrBands && o.chrBands.length > 0) {
      o.chrBands = _.filter(o.chrBands, function(v) { return !_.isUndefined(o.chrLengths[v[0]]); });
    }
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

// Take a guess at a reasonable initial height for a given track type
module.exports.trackHeightForType = function(type) {
  type = type.toLowerCase().split(/\s+/)[0];
  if (type == 'wiggle_0' || type == 'bigwig' || type == 'bedgraph') { return 30; }
  if (type == 'bam') { return 100; }
  return 15;
}

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
},{"../../track-types/utils/utils.js":23}],10:[function(require,module,exports){
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
},{"./utils/PairedIntervalTree.js":20,"./utils/RemoteTrack.js":21,"./utils/utils.js":23}],12:[function(require,module,exports){
// =================================================================
// = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
// =================================================================
//
// bedDetail is a trivial extension of BED that is defined separately,
// although a BED file with >12 columns is assumed to be bedDetail track regardless of type.

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  convertUrlTemplateFormat = utils.convertUrlTemplateFormat,
  urlForFeature = utils.urlForFeature;
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
    bedPlusFields: null
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
    if (/%s/.test(self.opts.url)) { self.opts.url = convertUrlTemplateFormat(self.opts.url); }
    else if (self.opts.url && !(/\$\$/).test(self.opts.url)) { self.opts.url += '$$'; }
    if (!validColorByStrand) { self.opts.colorByStrand = ''; self.opts.altColor = null; }
    else { self.opts.altColor = altColors[1]; }
  },

  parseLine: function(line, lineno) {
    var cols = BED_STANDARD_FIELDS,
      numStandardCols = this.numStandardColumns,
      bedPlusFields = this.opts.bedPlusFields || BED_DETAIL_FIELDS,
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
  
  // Fills out a URL template for a feature according to the standards for the `url` parameter of a UCSC trackDb
  // https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html
  calcUrl: function(url, feature) {
    var autoId = (/\t/).test(feature.id),
      toReplace = {
        '$$': autoId || _.isUndefined(feature.id) ? feature.name : feature.id,
        '$T': this.opts.name,
        '$S': feature.chrom,
        '${': feature.chromStart,
        '$}': feature.chromEnd,
        '$D': this.browserOpts.genome.replace(/^ucsc:|:.*/ig, '')
      };
    _.each(toReplace, function(replacement, placeholder) {
      url = url.replace(placeholder, replacement);
    });
    return url;
  },
  
  addArea: function(areas, data, i, lineHeight, urlTemplate) {
    var tipTipData = {},
      tipTipDataCallback = this.type().tipTipData,   // this permits inheriting track formats to override these
      customNameFunc = this.type().nameFunc,         // " "
      nameFunc = _.isFunction(customNameFunc) ? customNameFunc : utils.defaultNameFunc,
      autoId = (/\t/).test(data.d.id);               // Only automatically generated id's could contain a tab character
    if (!areas) { return; }
    if (_.isFunction(tipTipDataCallback)) {
      tipTipData = tipTipDataCallback.call(this, data);
    } else {
      if (!_.isUndefined(data.d.description)) { tipTipData.description = data.d.description; }
      if (!_.isUndefined(data.d.score) && data.d.score > 0) { tipTipData.score = data.d.score; }
      _.extend(tipTipData, {
        position: data.d.chrom + ':' + data.d.chromStart, 
        size: data.d.chromEnd - data.d.chromStart
      });
      if (this.opts.bedPlusFields) { _.extend(tipTipData, _.omit(data.d.extra, function(v) { return v === ''; })); }
      // Display the ID column (from bedDetail) unless it was automatically generated
      if (!_.isUndefined(data.d.id) && !autoId) { tipTipData.id = data.d.id; }
    }
    areas.push([
      data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, y1, x2, y2
      nameFunc(data.d),                                                                 // name
      this.type('bed').calcUrl.call(this, urlTemplate, data.d),                         // href
      data.pInt.oPrev,                                                                  // continuation from previous tile?
      this.type('bed').calcFeatureColor.call(this, data) || null,
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
  
  calcFeatureColor: function(itvl) {
    var self = this,
      o = self.opts,
      color = o.color;
    if (o.altColor && itvl.d.strand == '-') { color = o.altColor; }
    if (o.itemRgb && itvl.d.itemRgb && this.validateColor(itvl.d.itemRgb)) { color = itvl.d.itemRgb; }
    if (o.useScore) { color = self.type('bed').calcGradient(color, itvl.d.score); }
    return color;
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
      o = self.opts,
      color = o.color,
      y = i * lineHeight,
      halfHeight = Math.round(0.5 * (lineHeight - 1)),
      quarterHeight = Math.ceil(0.25 * (lineHeight - 1)),
      lineGap = lineHeight > 6 ? 2 : 1,
      thickOverlap = null,
      prevBInt = null;
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    color = self.type('bed').calcFeatureColor.call(self, data);
    if (o.itemRgb || o.altColor || o.useScore) { ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")"; }
    
    if (data.thickInt) {
      // The coding region is drawn as a thicker line within the gene
      if (data.blockInts) {
        // If there are exons and introns, draw the introns with a 1px line
        prevBInt = null;
        ctx.fillRect(data.pInt.x, y + halfHeight, data.pInt.w, 1);
        ctx.strokeStyle = color;
        _.each(data.blockInts, function(bInt) {
          if (bInt.w > 0 && bInt.x + bInt.w <= width && bInt.x >= 0) {
            ctx.fillRect(bInt.x, y + halfHeight - quarterHeight + 1, Math.max(bInt.w, 1), quarterHeight * 2 - 1);
          }
          thickOverlap = data.thickInt.w > 0 && utils.pixIntervalOverlap(bInt, data.thickInt);
          if (thickOverlap) {
            ctx.fillRect(thickOverlap.x, y + 1, Math.max(thickOverlap.w, 1), lineHeight - lineGap);
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
      ctx.fillRect(data.pInt.x, y + 1, Math.max(data.pInt.w, 1), lineHeight - lineGap);
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
},{"./utils/IntervalTree.js":18,"./utils/LineMask.js":19,"./utils/utils.js":23}],13:[function(require,module,exports){
// =========================================================================
// = bedGraph format: http://genome.ucsc.edu/goldenPath/help/bedgraph.html =
// =========================================================================

var utils = require('./utils/utils.js'),
  wiggle_0 = require('./wiggle_0.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.bedgraph
// Because bedgraph is functionally equivalent to wiggle_0, we inherit from it and 
// only override the .parse() function
var BedGraphFormat = _.extend({}, wiggle_0, {
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
  }
  
});

module.exports = BedGraphFormat;
},{"./utils/utils.js":23,"./wiggle_0.js":25}],14:[function(require,module,exports){
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
    
    return true;
  },
  
  // Before the RemoteTrack can start caching data, we need to use general info on the bigBed track to setup its binning scheme.
  // We defer this in a .finishSetup() method because it's potentially expensive HTTP GET that is only necessary if the track
  // is actually going to be displayed in the browser.
  finishSetup: function() {
    var self = this,
      ajaxUrl = self.ajaxDir() + 'bigbed.php',
      remote = self.data.remote;
    
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
    if (density != 'dense' && self.opts.maxFetchWindow > 0 && (end - start) > self.opts.maxFetchWindow) {
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
},{"./utils/IntervalTree.js":18,"./utils/RemoteTrack.js":21,"./utils/utils.js":23}],15:[function(require,module,exports){
// =====================================================================
// = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
// =====================================================================

var bigbed = require('./bigbed.js')
  utils = require('./utils/utils.js'),
  strip = utils.strip;

// Intended to be loaded into CustomTrack.types.biggenepred
var BigGenePredFormat = _.extend({}, bigbed, {
  
  tipTipData: function(itvl) {
    var tipTipData = {};
    if (!_.isUndefined(itvl.d.extra.geneName2)) { tipTipData.description = itvl.d.extra.geneName2; }
    _.extend(tipTipData, {
      id: itvl.d.name,
      position: itvl.d.chrom + ':' + itvl.d.chromStart, 
      size: itvl.d.chromEnd - itvl.d.chromStart
    });
    if (!_.isUndefined(itvl.d.score) && itvl.d.score > 0) { tipTipData.score = itvl.d.score; }
    return tipTipData;
  },

  nameFunc: function(d) {
    return strip(d.extra.name2 || d.extra.geneName || d.name || d.id || '');
  }
  
});

module.exports = BigGenePredFormat;
},{"./bigbed.js":14,"./utils/utils.js":23}],16:[function(require,module,exports){


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
  
  applyOpts: function() { 
    this.type('wiggle_0').applyOpts.apply(this, arguments);
    // this.scales needs to be synched back to the DOM side so the $.ui.genotrack can update it
    this.syncProps(['opts', 'drawRange', 'scales']); // FIXME: Move to wiggle_0?
  },

  parse: function(lines) {
    var self = this;
    self.stretchHeight = true;
    self.range = self.isOn(self.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
    return true;
  },
  
  // The only gain of getting info on the bigWig file is that we can grab the range of the data and set this.scales.
  // But it's expensive to do this unless the track is going to be displayed, so this is deferred until .finishSetup().
  finishSetup: function() {
    var self = this;
    
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {info: 1, url: self.opts.bigDataUrl},
      async: false,  // This is alright since parsing normally happens in a Web Worker
      success: function(data) {
        var rows = data.split("\n");
        _.each(rows, function(r) {
          var keyval = r.split(': ');
          if (keyval[0]=='min') { self.range[0] = Math.min(parseFloat(keyval[1]), self.range[0]); }
          if (keyval[0]=='max') { self.range[1] = Math.max(parseFloat(keyval[1]), self.range[1]); }
        });
      }
    });
    self.type().applyOpts.apply(self);
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
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width}, function(drawSpec) {
      self.type('wiggle_0').drawBars.call(self, ctx, drawSpec, canvas.height, width);
      _.isFunction(callback) && callback();
    });
  },

  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },

  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
};

module.exports = BigWigFormat;
},{}],17:[function(require,module,exports){
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
},{"./utils/IntervalTree.js":18,"./utils/utils.js":23}],18:[function(require,module,exports){
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
},{"./SortedList.js":22}],19:[function(require,module,exports){
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

},{"./utils.js":23}],20:[function(require,module,exports){
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
},{"../../../underscore.min.js":26,"./IntervalTree.js":18,"./utils.js":23}],21:[function(require,module,exports){
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
},{"../../../underscore.min.js":26}],22:[function(require,module,exports){
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
},{}],23:[function(require,module,exports){
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
      w: (itvlEnd - itvlStart) / bppp,
      t: 0,          // calculated width of text
      oPrev: false,  // overflows into previous tile?
      oNext: false   // overflows into next tile?
    };
    // small positive intervals get forcibly rounded up to 1 (so they are drawn), everything else to the nearest whole pixel
    pInt.w = pInt.w > 0 && pInt.w < 1 ? 1 : Math.round(pInt.w);
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

// Converts a URL template with %s, %s, %d etc. specifiers, which are used for `directUrl` in UCSC trackDb's
// https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html
// into one that is compatible with the `url` parameter on the same page, which uses $$, $T, $S, etc.
module.exports.convertUrlTemplateFormat = function(url) {
  var toReplace = {"$$$$": '%s', "$S": '%s', "${": '%d', "$}": '%d', "$T": "%s", "$D": "%s"}
  _.each(toReplace, function(placeholder, replacement) {
    url = url.replace(placeholder, replacement);
  });
  return url;
}
},{"../../../underscore.min.js":26}],24:[function(require,module,exports){
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


},{"./utils/utils.js":23}],25:[function(require,module,exports){
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
    var vScale = (this.drawRange[1] - this.drawRange[0]),
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
    var zeroLine = drawSpec.zeroLine * height, // pixel position of the data value 0
      color = "rgb("+this.opts.color+")",
      altColor = "rgb("+(this.opts.altColor || this.altColor)+")",
      pointGraph = this.opts.graphType==='points';
    
    ctx.fillStyle = color;
    _.each(drawSpec.bars, function(d, x) {
      var y = d * height;
      if (d === null) { return; }
      else if (y > zeroLine) { 
        if (pointGraph) { ctx.fillRect(x, height - y, 1, 1); }
        else { ctx.fillRect(x, height - y, 1, zeroLine > 0 ? (y - zeroLine) : y); }
      } else {
        ctx.fillStyle = altColor;
        if (pointGraph) { ctx.fillRect(x, zeroLine - y - 1, 1, 1); } 
        else { ctx.fillRect(x, height - zeroLine, 1, zeroLine - y); }
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
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width}, function(drawSpec) {
      self.type().drawBars.call(self, ctx, drawSpec, canvas.height, width);
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

},{"./utils/SortedList.js":22,"./utils/utils.js":23}],26:[function(require,module,exports){
//     Underscore.js 1.8.3
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.
(function(){function n(n){function t(t,r,e,u,i,o){for(;i>=0&&o>i;i+=n){var a=u?u[i]:i;e=r(e,t[a],a,t)}return e}return function(r,e,u,i){e=b(e,i,4);var o=!k(r)&&m.keys(r),a=(o||r).length,c=n>0?0:a-1;return arguments.length<3&&(u=r[o?o[c]:c],c+=n),t(r,e,u,o,c,a)}}function t(n){return function(t,r,e){r=x(r,e);for(var u=O(t),i=n>0?0:u-1;i>=0&&u>i;i+=n)if(r(t[i],i,t))return i;return-1}}function r(n,t,r){return function(e,u,i){var o=0,a=O(e);if("number"==typeof i)n>0?o=i>=0?i:Math.max(i+a,o):a=i>=0?Math.min(i+1,a):i+a+1;else if(r&&i&&a)return i=r(e,u),e[i]===u?i:-1;if(u!==u)return i=t(l.call(e,o,a),m.isNaN),i>=0?i+o:-1;for(i=n>0?o:a-1;i>=0&&a>i;i+=n)if(e[i]===u)return i;return-1}}function e(n,t){var r=I.length,e=n.constructor,u=m.isFunction(e)&&e.prototype||a,i="constructor";for(m.has(n,i)&&!m.contains(t,i)&&t.push(i);r--;)i=I[r],i in n&&n[i]!==u[i]&&!m.contains(t,i)&&t.push(i)}var u=this,i=u._,o=Array.prototype,a=Object.prototype,c=Function.prototype,f=o.push,l=o.slice,s=a.toString,p=a.hasOwnProperty,h=Array.isArray,v=Object.keys,g=c.bind,y=Object.create,d=function(){},m=function(n){return n instanceof m?n:this instanceof m?void(this._wrapped=n):new m(n)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=m),exports._=m):u._=m,m.VERSION="1.8.3";var b=function(n,t,r){if(t===void 0)return n;switch(null==r?3:r){case 1:return function(r){return n.call(t,r)};case 2:return function(r,e){return n.call(t,r,e)};case 3:return function(r,e,u){return n.call(t,r,e,u)};case 4:return function(r,e,u,i){return n.call(t,r,e,u,i)}}return function(){return n.apply(t,arguments)}},x=function(n,t,r){return null==n?m.identity:m.isFunction(n)?b(n,t,r):m.isObject(n)?m.matcher(n):m.property(n)};m.iteratee=function(n,t){return x(n,t,1/0)};var _=function(n,t){return function(r){var e=arguments.length;if(2>e||null==r)return r;for(var u=1;e>u;u++)for(var i=arguments[u],o=n(i),a=o.length,c=0;a>c;c++){var f=o[c];t&&r[f]!==void 0||(r[f]=i[f])}return r}},j=function(n){if(!m.isObject(n))return{};if(y)return y(n);d.prototype=n;var t=new d;return d.prototype=null,t},w=function(n){return function(t){return null==t?void 0:t[n]}},A=Math.pow(2,53)-1,O=w("length"),k=function(n){var t=O(n);return"number"==typeof t&&t>=0&&A>=t};m.each=m.forEach=function(n,t,r){t=b(t,r);var e,u;if(k(n))for(e=0,u=n.length;u>e;e++)t(n[e],e,n);else{var i=m.keys(n);for(e=0,u=i.length;u>e;e++)t(n[i[e]],i[e],n)}return n},m.map=m.collect=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=Array(u),o=0;u>o;o++){var a=e?e[o]:o;i[o]=t(n[a],a,n)}return i},m.reduce=m.foldl=m.inject=n(1),m.reduceRight=m.foldr=n(-1),m.find=m.detect=function(n,t,r){var e;return e=k(n)?m.findIndex(n,t,r):m.findKey(n,t,r),e!==void 0&&e!==-1?n[e]:void 0},m.filter=m.select=function(n,t,r){var e=[];return t=x(t,r),m.each(n,function(n,r,u){t(n,r,u)&&e.push(n)}),e},m.reject=function(n,t,r){return m.filter(n,m.negate(x(t)),r)},m.every=m.all=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(!t(n[o],o,n))return!1}return!0},m.some=m.any=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(t(n[o],o,n))return!0}return!1},m.contains=m.includes=m.include=function(n,t,r,e){return k(n)||(n=m.values(n)),("number"!=typeof r||e)&&(r=0),m.indexOf(n,t,r)>=0},m.invoke=function(n,t){var r=l.call(arguments,2),e=m.isFunction(t);return m.map(n,function(n){var u=e?t:n[t];return null==u?u:u.apply(n,r)})},m.pluck=function(n,t){return m.map(n,m.property(t))},m.where=function(n,t){return m.filter(n,m.matcher(t))},m.findWhere=function(n,t){return m.find(n,m.matcher(t))},m.max=function(n,t,r){var e,u,i=-1/0,o=-1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],e>i&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(u>o||u===-1/0&&i===-1/0)&&(i=n,o=u)});return i},m.min=function(n,t,r){var e,u,i=1/0,o=1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],i>e&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(o>u||1/0===u&&1/0===i)&&(i=n,o=u)});return i},m.shuffle=function(n){for(var t,r=k(n)?n:m.values(n),e=r.length,u=Array(e),i=0;e>i;i++)t=m.random(0,i),t!==i&&(u[i]=u[t]),u[t]=r[i];return u},m.sample=function(n,t,r){return null==t||r?(k(n)||(n=m.values(n)),n[m.random(n.length-1)]):m.shuffle(n).slice(0,Math.max(0,t))},m.sortBy=function(n,t,r){return t=x(t,r),m.pluck(m.map(n,function(n,r,e){return{value:n,index:r,criteria:t(n,r,e)}}).sort(function(n,t){var r=n.criteria,e=t.criteria;if(r!==e){if(r>e||r===void 0)return 1;if(e>r||e===void 0)return-1}return n.index-t.index}),"value")};var F=function(n){return function(t,r,e){var u={};return r=x(r,e),m.each(t,function(e,i){var o=r(e,i,t);n(u,e,o)}),u}};m.groupBy=F(function(n,t,r){m.has(n,r)?n[r].push(t):n[r]=[t]}),m.indexBy=F(function(n,t,r){n[r]=t}),m.countBy=F(function(n,t,r){m.has(n,r)?n[r]++:n[r]=1}),m.toArray=function(n){return n?m.isArray(n)?l.call(n):k(n)?m.map(n,m.identity):m.values(n):[]},m.size=function(n){return null==n?0:k(n)?n.length:m.keys(n).length},m.partition=function(n,t,r){t=x(t,r);var e=[],u=[];return m.each(n,function(n,r,i){(t(n,r,i)?e:u).push(n)}),[e,u]},m.first=m.head=m.take=function(n,t,r){return null==n?void 0:null==t||r?n[0]:m.initial(n,n.length-t)},m.initial=function(n,t,r){return l.call(n,0,Math.max(0,n.length-(null==t||r?1:t)))},m.last=function(n,t,r){return null==n?void 0:null==t||r?n[n.length-1]:m.rest(n,Math.max(0,n.length-t))},m.rest=m.tail=m.drop=function(n,t,r){return l.call(n,null==t||r?1:t)},m.compact=function(n){return m.filter(n,m.identity)};var S=function(n,t,r,e){for(var u=[],i=0,o=e||0,a=O(n);a>o;o++){var c=n[o];if(k(c)&&(m.isArray(c)||m.isArguments(c))){t||(c=S(c,t,r));var f=0,l=c.length;for(u.length+=l;l>f;)u[i++]=c[f++]}else r||(u[i++]=c)}return u};m.flatten=function(n,t){return S(n,t,!1)},m.without=function(n){return m.difference(n,l.call(arguments,1))},m.uniq=m.unique=function(n,t,r,e){m.isBoolean(t)||(e=r,r=t,t=!1),null!=r&&(r=x(r,e));for(var u=[],i=[],o=0,a=O(n);a>o;o++){var c=n[o],f=r?r(c,o,n):c;t?(o&&i===f||u.push(c),i=f):r?m.contains(i,f)||(i.push(f),u.push(c)):m.contains(u,c)||u.push(c)}return u},m.union=function(){return m.uniq(S(arguments,!0,!0))},m.intersection=function(n){for(var t=[],r=arguments.length,e=0,u=O(n);u>e;e++){var i=n[e];if(!m.contains(t,i)){for(var o=1;r>o&&m.contains(arguments[o],i);o++);o===r&&t.push(i)}}return t},m.difference=function(n){var t=S(arguments,!0,!0,1);return m.filter(n,function(n){return!m.contains(t,n)})},m.zip=function(){return m.unzip(arguments)},m.unzip=function(n){for(var t=n&&m.max(n,O).length||0,r=Array(t),e=0;t>e;e++)r[e]=m.pluck(n,e);return r},m.object=function(n,t){for(var r={},e=0,u=O(n);u>e;e++)t?r[n[e]]=t[e]:r[n[e][0]]=n[e][1];return r},m.findIndex=t(1),m.findLastIndex=t(-1),m.sortedIndex=function(n,t,r,e){r=x(r,e,1);for(var u=r(t),i=0,o=O(n);o>i;){var a=Math.floor((i+o)/2);r(n[a])<u?i=a+1:o=a}return i},m.indexOf=r(1,m.findIndex,m.sortedIndex),m.lastIndexOf=r(-1,m.findLastIndex),m.range=function(n,t,r){null==t&&(t=n||0,n=0),r=r||1;for(var e=Math.max(Math.ceil((t-n)/r),0),u=Array(e),i=0;e>i;i++,n+=r)u[i]=n;return u};var E=function(n,t,r,e,u){if(!(e instanceof t))return n.apply(r,u);var i=j(n.prototype),o=n.apply(i,u);return m.isObject(o)?o:i};m.bind=function(n,t){if(g&&n.bind===g)return g.apply(n,l.call(arguments,1));if(!m.isFunction(n))throw new TypeError("Bind must be called on a function");var r=l.call(arguments,2),e=function(){return E(n,e,t,this,r.concat(l.call(arguments)))};return e},m.partial=function(n){var t=l.call(arguments,1),r=function(){for(var e=0,u=t.length,i=Array(u),o=0;u>o;o++)i[o]=t[o]===m?arguments[e++]:t[o];for(;e<arguments.length;)i.push(arguments[e++]);return E(n,r,this,this,i)};return r},m.bindAll=function(n){var t,r,e=arguments.length;if(1>=e)throw new Error("bindAll must be passed function names");for(t=1;e>t;t++)r=arguments[t],n[r]=m.bind(n[r],n);return n},m.memoize=function(n,t){var r=function(e){var u=r.cache,i=""+(t?t.apply(this,arguments):e);return m.has(u,i)||(u[i]=n.apply(this,arguments)),u[i]};return r.cache={},r},m.delay=function(n,t){var r=l.call(arguments,2);return setTimeout(function(){return n.apply(null,r)},t)},m.defer=m.partial(m.delay,m,1),m.throttle=function(n,t,r){var e,u,i,o=null,a=0;r||(r={});var c=function(){a=r.leading===!1?0:m.now(),o=null,i=n.apply(e,u),o||(e=u=null)};return function(){var f=m.now();a||r.leading!==!1||(a=f);var l=t-(f-a);return e=this,u=arguments,0>=l||l>t?(o&&(clearTimeout(o),o=null),a=f,i=n.apply(e,u),o||(e=u=null)):o||r.trailing===!1||(o=setTimeout(c,l)),i}},m.debounce=function(n,t,r){var e,u,i,o,a,c=function(){var f=m.now()-o;t>f&&f>=0?e=setTimeout(c,t-f):(e=null,r||(a=n.apply(i,u),e||(i=u=null)))};return function(){i=this,u=arguments,o=m.now();var f=r&&!e;return e||(e=setTimeout(c,t)),f&&(a=n.apply(i,u),i=u=null),a}},m.wrap=function(n,t){return m.partial(t,n)},m.negate=function(n){return function(){return!n.apply(this,arguments)}},m.compose=function(){var n=arguments,t=n.length-1;return function(){for(var r=t,e=n[t].apply(this,arguments);r--;)e=n[r].call(this,e);return e}},m.after=function(n,t){return function(){return--n<1?t.apply(this,arguments):void 0}},m.before=function(n,t){var r;return function(){return--n>0&&(r=t.apply(this,arguments)),1>=n&&(t=null),r}},m.once=m.partial(m.before,2);var M=!{toString:null}.propertyIsEnumerable("toString"),I=["valueOf","isPrototypeOf","toString","propertyIsEnumerable","hasOwnProperty","toLocaleString"];m.keys=function(n){if(!m.isObject(n))return[];if(v)return v(n);var t=[];for(var r in n)m.has(n,r)&&t.push(r);return M&&e(n,t),t},m.allKeys=function(n){if(!m.isObject(n))return[];var t=[];for(var r in n)t.push(r);return M&&e(n,t),t},m.values=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=n[t[u]];return e},m.mapObject=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=u.length,o={},a=0;i>a;a++)e=u[a],o[e]=t(n[e],e,n);return o},m.pairs=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=[t[u],n[t[u]]];return e},m.invert=function(n){for(var t={},r=m.keys(n),e=0,u=r.length;u>e;e++)t[n[r[e]]]=r[e];return t},m.functions=m.methods=function(n){var t=[];for(var r in n)m.isFunction(n[r])&&t.push(r);return t.sort()},m.extend=_(m.allKeys),m.extendOwn=m.assign=_(m.keys),m.findKey=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=0,o=u.length;o>i;i++)if(e=u[i],t(n[e],e,n))return e},m.pick=function(n,t,r){var e,u,i={},o=n;if(null==o)return i;m.isFunction(t)?(u=m.allKeys(o),e=b(t,r)):(u=S(arguments,!1,!1,1),e=function(n,t,r){return t in r},o=Object(o));for(var a=0,c=u.length;c>a;a++){var f=u[a],l=o[f];e(l,f,o)&&(i[f]=l)}return i},m.omit=function(n,t,r){if(m.isFunction(t))t=m.negate(t);else{var e=m.map(S(arguments,!1,!1,1),String);t=function(n,t){return!m.contains(e,t)}}return m.pick(n,t,r)},m.defaults=_(m.allKeys,!0),m.create=function(n,t){var r=j(n);return t&&m.extendOwn(r,t),r},m.clone=function(n){return m.isObject(n)?m.isArray(n)?n.slice():m.extend({},n):n},m.tap=function(n,t){return t(n),n},m.isMatch=function(n,t){var r=m.keys(t),e=r.length;if(null==n)return!e;for(var u=Object(n),i=0;e>i;i++){var o=r[i];if(t[o]!==u[o]||!(o in u))return!1}return!0};var N=function(n,t,r,e){if(n===t)return 0!==n||1/n===1/t;if(null==n||null==t)return n===t;n instanceof m&&(n=n._wrapped),t instanceof m&&(t=t._wrapped);var u=s.call(n);if(u!==s.call(t))return!1;switch(u){case"[object RegExp]":case"[object String]":return""+n==""+t;case"[object Number]":return+n!==+n?+t!==+t:0===+n?1/+n===1/t:+n===+t;case"[object Date]":case"[object Boolean]":return+n===+t}var i="[object Array]"===u;if(!i){if("object"!=typeof n||"object"!=typeof t)return!1;var o=n.constructor,a=t.constructor;if(o!==a&&!(m.isFunction(o)&&o instanceof o&&m.isFunction(a)&&a instanceof a)&&"constructor"in n&&"constructor"in t)return!1}r=r||[],e=e||[];for(var c=r.length;c--;)if(r[c]===n)return e[c]===t;if(r.push(n),e.push(t),i){if(c=n.length,c!==t.length)return!1;for(;c--;)if(!N(n[c],t[c],r,e))return!1}else{var f,l=m.keys(n);if(c=l.length,m.keys(t).length!==c)return!1;for(;c--;)if(f=l[c],!m.has(t,f)||!N(n[f],t[f],r,e))return!1}return r.pop(),e.pop(),!0};m.isEqual=function(n,t){return N(n,t)},m.isEmpty=function(n){return null==n?!0:k(n)&&(m.isArray(n)||m.isString(n)||m.isArguments(n))?0===n.length:0===m.keys(n).length},m.isElement=function(n){return!(!n||1!==n.nodeType)},m.isArray=h||function(n){return"[object Array]"===s.call(n)},m.isObject=function(n){var t=typeof n;return"function"===t||"object"===t&&!!n},m.each(["Arguments","Function","String","Number","Date","RegExp","Error"],function(n){m["is"+n]=function(t){return s.call(t)==="[object "+n+"]"}}),m.isArguments(arguments)||(m.isArguments=function(n){return m.has(n,"callee")}),"function"!=typeof/./&&"object"!=typeof Int8Array&&(m.isFunction=function(n){return"function"==typeof n||!1}),m.isFinite=function(n){return isFinite(n)&&!isNaN(parseFloat(n))},m.isNaN=function(n){return m.isNumber(n)&&n!==+n},m.isBoolean=function(n){return n===!0||n===!1||"[object Boolean]"===s.call(n)},m.isNull=function(n){return null===n},m.isUndefined=function(n){return n===void 0},m.has=function(n,t){return null!=n&&p.call(n,t)},m.noConflict=function(){return u._=i,this},m.identity=function(n){return n},m.constant=function(n){return function(){return n}},m.noop=function(){},m.property=w,m.propertyOf=function(n){return null==n?function(){}:function(t){return n[t]}},m.matcher=m.matches=function(n){return n=m.extendOwn({},n),function(t){return m.isMatch(t,n)}},m.times=function(n,t,r){var e=Array(Math.max(0,n));t=b(t,r,1);for(var u=0;n>u;u++)e[u]=t(u);return e},m.random=function(n,t){return null==t&&(t=n,n=0),n+Math.floor(Math.random()*(t-n+1))},m.now=Date.now||function(){return(new Date).getTime()};var B={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},T=m.invert(B),R=function(n){var t=function(t){return n[t]},r="(?:"+m.keys(n).join("|")+")",e=RegExp(r),u=RegExp(r,"g");return function(n){return n=null==n?"":""+n,e.test(n)?n.replace(u,t):n}};m.escape=R(B),m.unescape=R(T),m.result=function(n,t,r){var e=null==n?void 0:n[t];return e===void 0&&(e=r),m.isFunction(e)?e.call(n):e};var q=0;m.uniqueId=function(n){var t=++q+"";return n?n+t:t},m.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var K=/(.)^/,z={"'":"'","\\":"\\","\r":"r","\n":"n","\u2028":"u2028","\u2029":"u2029"},D=/\\|'|\r|\n|\u2028|\u2029/g,L=function(n){return"\\"+z[n]};m.template=function(n,t,r){!t&&r&&(t=r),t=m.defaults({},t,m.templateSettings);var e=RegExp([(t.escape||K).source,(t.interpolate||K).source,(t.evaluate||K).source].join("|")+"|$","g"),u=0,i="__p+='";n.replace(e,function(t,r,e,o,a){return i+=n.slice(u,a).replace(D,L),u=a+t.length,r?i+="'+\n((__t=("+r+"))==null?'':_.escape(__t))+\n'":e?i+="'+\n((__t=("+e+"))==null?'':__t)+\n'":o&&(i+="';\n"+o+"\n__p+='"),t}),i+="';\n",t.variable||(i="with(obj||{}){\n"+i+"}\n"),i="var __t,__p='',__j=Array.prototype.join,"+"print=function(){__p+=__j.call(arguments,'');};\n"+i+"return __p;\n";try{var o=new Function(t.variable||"obj","_",i)}catch(a){throw a.source=i,a}var c=function(n){return o.call(this,n,m)},f=t.variable||"obj";return c.source="function("+f+"){\n"+i+"}",c},m.chain=function(n){var t=m(n);return t._chain=!0,t};var P=function(n,t){return n._chain?m(t).chain():t};m.mixin=function(n){m.each(m.functions(n),function(t){var r=m[t]=n[t];m.prototype[t]=function(){var n=[this._wrapped];return f.apply(n,arguments),P(this,r.apply(m,n))}})},m.mixin(m),m.each(["pop","push","reverse","shift","sort","splice","unshift"],function(n){var t=o[n];m.prototype[n]=function(){var r=this._wrapped;return t.apply(r,arguments),"shift"!==n&&"splice"!==n||0!==r.length||delete r[0],P(this,r)}}),m.each(["concat","join","slice"],function(n){var t=o[n];m.prototype[n]=function(){return P(this,t.apply(this._wrapped,arguments))}}),m.prototype.value=function(){return this._wrapped},m.prototype.valueOf=m.prototype.toJSON=m.prototype.value,m.prototype.toString=function(){return""+this._wrapped},"function"==typeof define&&define.amd&&define("underscore",[],function(){return m})}).call(this);
},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tR2Vub21lLmpzIiwianMvY3VzdG9tL0N1c3RvbUdlbm9tZVdvcmtlci5qcyIsImpzL2N1c3RvbS9DdXN0b21HZW5vbWVzLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrLmpzIiwianMvY3VzdG9tL0N1c3RvbVRyYWNrcy5qcyIsImpzL2N1c3RvbS9nZW5vbWUtZm9ybWF0cy9jaHJvbXNpemVzLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2Zhc3RhLmpzIiwianMvY3VzdG9tL2dlbm9tZS1mb3JtYXRzL2dlbmJhbmsuanMiLCJqcy9jdXN0b20vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vanF1ZXJ5Lm5vZG9tLm1pbi5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iYW0uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmVkLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWdnZW5lcHJlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWd3aWcuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL0ludGVydmFsVHJlZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9MaW5lTWFzay5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUmVtb3RlVHJhY2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvU29ydGVkTGlzdC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy91dGlscy5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy92Y2Z0YWJpeC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy93aWdnbGVfMC5qcyIsImpzL3VuZGVyc2NvcmUubWluLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2xHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakVBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMXdCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4WkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDalJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbUdlbm9tZSByZXByZXNlbnRzIGEgZ2Vub21lIHNwZWNpZmljYXRpb24gdGhhdCBjYW4gcHJvZHVjZSBvcHRpb25zIGZvciAkLnVpLmdlbm9icm93c2VyID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvdXRpbHMvdXRpbHMuanMnKSxcbiAgZGVlcENsb25lID0gdXRpbHMuZGVlcENsb25lLFxuICBsb2cxMCA9IHV0aWxzLmxvZzEwLFxuICByb3VuZFRvUGxhY2VzID0gdXRpbHMucm91bmRUb1BsYWNlcztcblxuZnVuY3Rpb24gQ3VzdG9tR2Vub21lKGdpdmVuRm9ybWF0LCBtZXRhZGF0YSkgeyAgICBcbiAgLy8gZ2l2ZW5Gb3JtYXQgPSBmYWxzZSAtLT4gdGhpcyBpcyBhbiBlbXB0eSBDdXN0b21HZW5vbWUgdGhhdCB3aWxsIGJlIGh5ZHJhdGVkIHdpdGggdmFsdWVzIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdFxuICBpZiAoZ2l2ZW5Gb3JtYXQgPT09IGZhbHNlKSB7IHJldHVybjsgfSBcbiAgXG4gIHRoaXMuX3BhcnNlZCA9IGZhbHNlO1xuICB0aGlzLl9mb3JtYXQgPSAoZ2l2ZW5Gb3JtYXQgJiYgZ2l2ZW5Gb3JtYXQudG9Mb3dlckNhc2UoKSkgfHwgXCJjaHJvbXNpemVzXCI7XG4gIHZhciBmb3JtYXQgPSB0aGlzLmZvcm1hdCgpO1xuICBpZiAoZm9ybWF0ID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGdlbm9tZSBmb3JtYXQgJ1wiK2Zvcm1hdCtcIicgZW5jb3VudGVyZWRcIik7IH1cbiAgXG4gIC8vIHRoaXMub3B0cyBob2xkcyBldmVyeXRoaW5nIHRoYXQgJC51aS5nZW5vYnJvd3NlciB3aWxsIG5lZWQgdG8gY29uc3RydWN0IGEgdmlldyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBiZWxvdylcbiAgLy8gaXQgRE9FUyBOT1QgcmVsYXRlIHRvIFwib3B0aW9uc1wiIGZvciBwYXJzaW5nLCBvciBob3cgdGhlIGdlbm9tZSBpcyBiZWluZyBpbnRlcnByZXRlZCwgb3IgYW55dGhpbmcgbGlrZSB0aGF0XG4gIHRoaXMub3B0cyA9IF8uZXh0ZW5kKHt9LCBkZWVwQ2xvbmUodGhpcy5jb25zdHJ1Y3Rvci5kZWZhdWx0cyksIGRlZXBDbG9uZShmb3JtYXQuZGVmYXVsdHMgfHwge30pKTtcbiAgXG4gIC8vIHRoaXMubWV0YWRhdGEgaG9sZHMgaW5mb3JtYXRpb24gZXh0ZXJuYWwgdG8gdGhlIHBhcnNlZCB0ZXh0IHBhc3NlZCBpbiBmcm9tIHRoZSBicm93c2VyIChlLmcuIGZpbGVuYW1lLCBzb3VyY2UpXG4gIHRoaXMubWV0YWRhdGEgPSBtZXRhZGF0YTtcbiAgXG4gIC8vIHRoaXMuZGF0YSBob2xkcyBhbnl0aGluZyBhZGRpdGlvbmFsbHkgcGFyc2VkIGZyb20gdGhlIGdlbm9tZSBmaWxlIChtZXRhZGF0YSwgcmVmZXJlbmNlcywgZXRjLilcbiAgLy8gdHlwaWNhbGx5IHRoaXMgaXMgYXJyYW5nZWQgcGVyIGNvbnRpZywgaW4gdGhlIGFycmFuZ2VtZW50IG9mIHRoaXMuZGF0YS5jb250aWdzW2ldLiAuLi5cbiAgdGhpcy5kYXRhID0ge1xuICAgIHNlcXVlbmNlOiBcIlwiIC8vIHRoZSBmdWxsIGNvbmNhdGVuYXRlZCBzZXF1ZW5jZSBmb3IgYWxsIGNvbnRpZ3MgaW4gdGhpcyBnZW5vbWUsIGlmIGF2YWlsYWJsZVxuICB9O1xuICBcbiAgLy8gY2FuIHdlIGNhbGwgLmdldFNlcXVlbmNlIG9uIHRoaXMgQ3VzdG9tR2Vub21lP1xuICB0aGlzLmNhbkdldFNlcXVlbmNlID0gZmFsc2U7XG4gIFxuICBpZihmb3JtYXQuaW5pdCkgeyBmb3JtYXQuaW5pdC5jYWxsKHRoaXMpOyB9XG59XG5cbkN1c3RvbUdlbm9tZS5kZWZhdWx0cyA9IHtcbiAgLy8gVGhlIGZvbGxvd2luZyBrZXlzIHNob3VsZCBiZSBvdmVycmlkZGVuIHdoaWxlIHBhcnNpbmcgdGhlIGdlbm9tZSBmaWxlXG4gIGdlbm9tZTogJ19ibGFuaycsXG4gIHNwZWNpZXM6ICdCbGFuayBHZW5vbWUnLFxuICBhc3NlbWJseURhdGU6ICcnLFxuICB0aWxlRGlyOiBudWxsLFxuICBvdmVyem9vbUJwcHBzOiBbXSxcbiAgbnRzQmVsb3c6IFsxLCAwLjFdLFxuICBhdmFpbFRyYWNrczogW1xuICAgIHtcbiAgICAgIGZoOiB7fSwgICAgICAgIC8vIFwiZml4ZWQgaGVpZ2h0c1wiIGFib3ZlIHdoaWNoIGEgZGVuc2l0eSBpcyBmb3JjZWQgdG8gZGlzcGxheSBhYm92ZSBhIGNlcnRhaW4gdHJhY2sgaGVpZ2h0XG4gICAgICAgICAgICAgICAgICAgICAvLyAgICBmb3JtYXR0ZWQgbGlrZSB7XCIxLjAwZSswNVwiOntcImRlbnNlXCI6MTV9fVxuICAgICAgbjogXCJydWxlclwiLCAgICAvLyBzaG9ydCB1bmlxdWUgbmFtZSBmb3IgdGhlIHRyYWNrXG4gICAgICBzOiBbXCJkZW5zZVwiXSwgIC8vIHBvc3NpYmxlIGRlbnNpdGllcyBmb3IgdGlsZXMsIGUuZy4gW1wiZGVuc2VcIiwgXCJzcXVpc2hcIiwgXCJwYWNrXCJdXG4gICAgICBoOiAyNSAgICAgICAgICAvLyBzdGFydGluZyBoZWlnaHQgaW4gcHhcbiAgICB9XG4gIF0sXG4gIGdlbm9tZVNpemU6IDAsXG4gIGNockxlbmd0aHM6IHt9LFxuICBjaHJPcmRlcjogW10sXG4gIGNockJhbmRzOiBudWxsLFxuICB0aWxlV2lkdGg6IDEwMDAsXG4gIHN1YmRpckZvckJwcHBzVW5kZXI6IDMzMCxcbiAgaWRlb2dyYW1zQWJvdmU6IDAsXG4gIG1heE50UmVxdWVzdDogMjAwMDAsXG4gIHRyYWNrczogW3tuOiBcInJ1bGVyXCJ9XSxcbiAgdHJhY2tEZXNjOiB7XG4gICAgcnVsZXI6IHtcbiAgICAgIGNhdDogXCJNYXBwaW5nIGFuZCBTZXF1ZW5jaW5nXCIsXG4gICAgICBzbTogXCJCYXNlIFBvc2l0aW9uXCJcbiAgICB9XG4gIH0sXG4gIGdyb3VwVHJhY2tzQnlDYXRlZ29yeTogZmFsc2UsXG4gIC8vIFRoZXNlIGxhc3QgdGhyZWUgd2lsbCBiZSBvdmVycmlkZGVuIHVzaW5nIGtub3dsZWRnZSBvZiB0aGUgd2luZG93J3Mgd2lkdGhcbiAgYnBwcHM6IFtdLFxuICBicHBwTnVtYmVyc0JlbG93OiBbXSxcbiAgaW5pdFpvb206IG51bGxcbn07XG5cbkN1c3RvbUdlbm9tZS5mb3JtYXRzID0ge1xuICBjaHJvbXNpemVzOiByZXF1aXJlKCcuL2dlbm9tZS1mb3JtYXRzL2Nocm9tc2l6ZXMuanMnKSxcbiAgZmFzdGE6IHJlcXVpcmUoJy4vZ2Vub21lLWZvcm1hdHMvZmFzdGEuanMnKSxcbiAgZ2VuYmFuazogcmVxdWlyZSgnLi9nZW5vbWUtZm9ybWF0cy9nZW5iYW5rLmpzJyksXG4gIGVtYmw6IG51bGwgLy8gVE9ETy4gQmFzaWNhbGx5IGdlbmJhbmsgd2l0aCBleHRyYSBjb2x1bW5zLlxufVxuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLnBhcnNlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9ybWF0KCkucGFyc2UuYXBwbHkodGhpcywgXy50b0FycmF5KGFyZ3VtZW50cykpO1xuICB0aGlzLnNldEdlbm9tZVN0cmluZygpO1xuICB0aGlzLl9wYXJzZWQgPSB0cnVlO1xufTtcblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5mb3JtYXQgPSBmdW5jdGlvbihmb3JtYXQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc1VuZGVmaW5lZChmb3JtYXQpKSB7IGZvcm1hdCA9IHNlbGYuX2Zvcm1hdDsgfVxuICB2YXIgRm9ybWF0V3JhcHBlciA9IGZ1bmN0aW9uKCkgeyBfLmV4dGVuZCh0aGlzLCBzZWxmLmNvbnN0cnVjdG9yLmZvcm1hdHNbZm9ybWF0XSk7IHJldHVybiB0aGlzOyB9O1xuICBGb3JtYXRXcmFwcGVyLnByb3RvdHlwZSA9IHNlbGY7XG4gIHJldHVybiBuZXcgRm9ybWF0V3JhcHBlcigpO1xufTtcblxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5zZXRHZW5vbWVTdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNlbGYgPSB0aGlzLFxuICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgZXhjZXB0aW9ucyA9IFsnZmlsZScsICdpZ2InLCAnYWNjJywgJ3VybCcsICd1Y3NjJ10sXG4gICAgZXhjZXB0aW9uID0gXy5maW5kKGV4Y2VwdGlvbnMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuICFfLmlzVW5kZWZpbmVkKHNlbGYubWV0YWRhdGFbdl0pOyB9KSxcbiAgICBwaWVjZXMgPSBbXTtcbiAgaWYgKGV4Y2VwdGlvbikgeyBvLmdlbm9tZSA9IGV4Y2VwdGlvbiArIFwiOlwiICsgc2VsZi5tZXRhZGF0YVtleGNlcHRpb25dOyB9XG4gIGVsc2Uge1xuICAgIHBpZWNlcyA9IFsnY3VzdG9tJyArIChzZWxmLm1ldGFkYXRhLm5hbWUgPyAnOicgKyBzZWxmLm1ldGFkYXRhLm5hbWUgOiAnJyldO1xuICAgIF8uZWFjaChvLmNock9yZGVyLCBmdW5jdGlvbihjaHIpIHtcbiAgICAgIHBpZWNlcy5wdXNoKGNociArICc6JyArIG8uY2hyTGVuZ3Roc1tjaHJdKTtcbiAgICB9KTtcbiAgICBvLmdlbm9tZSA9IHBpZWNlcy5qb2luKCd8Jyk7XG4gIH1cbn07XG5cbi8vIFNvbWUgb2YgdGhlIG9wdGlvbnMgZm9yICQudWkuZ2Vub2Jyb3dzZXIgKGFsbCByL3Qgem9vbSBsZXZlbHMpIG11c3QgYmUgc2V0IGJhc2VkIG9uIHRoZSB3aWR0aCBvZiB0aGUgd2luZG93XG4vLyAgIFRoZXkgYXJlIC5icHBwcywgLmJwcHBOdW1iZXJzQmVsb3csIGFuZCAuaW5pdFpvb21cbi8vICAgVGhleSBkbyBub3QgYWZmZWN0IGFueSBvZiB0aGUgb3RoZXIgb3B0aW9ucyBzZXQgZHVyaW5nIHBhcnNpbmcuXG4vL1xuLy8gd2luZG93T3B0cyBNVVNUIGluY2x1ZGUgYSBwcm9wZXJ0eSwgLndpZHRoLCB0aGF0IGlzIHRoZSB3aW5kb3cuaW5uZXJXaWR0aFxuQ3VzdG9tR2Vub21lLnByb3RvdHlwZS5zZXRCcHBwcyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgd2luZG93T3B0cyA9IHdpbmRvd09wdHMgfHwge307XG4gIFxuICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICB3aW5kb3dXaWR0aCA9ICh3aW5kb3dPcHRzLndpZHRoICogMC42KSB8fCAxMDAwLFxuICAgIGJwcHAgPSBNYXRoLnJvdW5kKG8uZ2Vub21lU2l6ZSAvIHdpbmRvd1dpZHRoKSxcbiAgICBsb3dlc3RCcHBwID0gd2luZG93T3B0cy5sb3dlc3RCcHBwIHx8IDAuMSxcbiAgICBsb25nZXN0Q29udGlnID0gXy5tYXgoby5jaHJMZW5ndGhzKSxcbiAgICBtYXhCcHBwcyA9IDEwMCxcbiAgICBicHBwcyA9IFtdLCBpID0gMCwgbG9nO1xuICBcbiAgLy8gY29tcGFyYWJsZSB0byBwYXJ0IG9mIFVDU0NDbGllbnQjbWFrZV9jb25maWcgaW4gbGliL3Vjc2Nfc3RpdGNoLnJiXG4gIHdoaWxlIChicHBwID49IGxvd2VzdEJwcHAgJiYgaSA8IG1heEJwcHBzKSB7XG4gICAgYnBwcHMucHVzaChicHBwKTtcbiAgICBsb2cgPSByb3VuZFRvUGxhY2VzKGxvZzEwKGJwcHApLCA0KTtcbiAgICBicHBwID0gKE1hdGguY2VpbChsb2cpIC0gbG9nIDwgMC40ODEpID8gMy4zICogTWF0aC5wb3coMTAsIE1hdGguY2VpbChsb2cpIC0gMSkgOiBNYXRoLnBvdygxMCwgTWF0aC5mbG9vcihsb2cpKTtcbiAgICBpKys7XG4gIH1cbiAgby5icHBwcyA9IGJwcHBzO1xuICBvLmJwcHBOdW1iZXJzQmVsb3cgPSBbYnBwcHNbMF0sIF8uZmluZChicHBwcywgZnVuY3Rpb24oeCkgeyByZXR1cm4geCA8IGxvbmdlc3RDb250aWcgLyA1MDA7IH0pXTtcbiAgby5pbml0Wm9vbSA9IGJwcHBzWzBdO1xuICBcbiAgLy8gaWYgY3VzdG9tIGdlbm9tZXMgaGF2ZSBpZGVvZ3JhbXMsIHdlIGRyYXcgdGhlbSBhdCBhbGwgem9vbSBsZXZlbHNcbiAgby5pZGVvZ3JhbXNBYm92ZSA9IG8uaWRlb2dyYW1zQWJvdmUgPyBicHBwc1swXSA6IDA7XG59O1xuXG4vLyBDb25zdHJ1Y3QgYSBjb21wbGV0ZSBjb25maWd1cmF0aW9uIGZvciAkLnVpLmdlbm9icm93c2VyIGJhc2VkIG9uIHRoZSBpbmZvcm1hdGlvbiBwYXJzZWQgZnJvbSB0aGUgZ2Vub21lIGZpbGVcbi8vIHdoaWNoIHNob3VsZCBiZSBtb3N0bHkgaW4gdGhpcy5vcHRzLCBleGNlcHRpbmcgdGhvc2UgcmVsYXRlZCB0byB6b29tIGxldmVscywgd2hpY2ggY2FuIGJlIHNldCBub3cuXG4vLyAoc2VlIEN1c3RvbUdlbm9tZS5kZWZhdWx0cyBhYm92ZSBmb3Igd2hhdCBhIGJhc2UgY29uZmlndXJhdGlvbiBsb29rcyBsaWtlKVxuLy9cbi8vIHdpbmRvd09wdHMgTVVTVCBpbmNsdWRlIGluY2x1ZGUgdGhlIHByb3BlcnR5IC53aWR0aCB3aGljaCBpcyB0aGUgd2luZG93LmlubmVyV2lkdGhcbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUub3B0aW9ucyA9IGZ1bmN0aW9uKHdpbmRvd09wdHMpIHtcbiAgaWYgKCF0aGlzLl9wYXJzZWQpIHsgdGhyb3cgXCJDYW5ub3QgZ2VuZXJhdGUgb3B0aW9ucyBiZWZvcmUgcGFyc2luZyB0aGUgZ2Vub21lIGZpbGVcIjsgfVxuICB0aGlzLnNldEJwcHBzKHdpbmRvd09wdHMpO1xuICB0aGlzLm9wdHMuY3VzdG9tID0gdGhpczsgICAvLyBzYW1lIGNvbnZlbnRpb24gYXMgY3VzdG9tIHRyYWNrcyBpbiBzZWxmLmF2YWlsVHJhY2tzIGluIGNocm9tb3pvb20uanNcbiAgcmV0dXJuIHRoaXMub3B0cztcbn07XG5cbi8vIEZldGNoIHRoZSBzZXF1ZW5jZSwgaWYgYXZhaWxhYmxlLCBiZXR3ZWVuIGxlZnQgYW5kIHJpZ2h0LCBhbmQgb3B0aW9uYWxseSBwYXNzIGl0IHRvIHRoZSBjYWxsYmFjay5cbkN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2UgPSBmdW5jdGlvbihsZWZ0LCByaWdodCwgY2FsbGJhY2spIHtcbiAgdmFyIHNlcSA9IHRoaXMuZGF0YS5zZXF1ZW5jZS5zdWJzdHJpbmcobGVmdCAtIDEsIHJpZ2h0IC0gMSk7XG4gIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soc2VxKSA6IHNlcTsgXG59O1xuXG5DdXN0b21HZW5vbWUucHJvdG90eXBlLmdldFNlcXVlbmNlQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMuYXN5bmModGhpcywgJ2dldFNlcXVlbmNlJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxucmV0dXJuIEN1c3RvbUdlbm9tZTtcblxufTsiLCJ2YXIgZ2xvYmFsID0gc2VsZjsgIC8vIGdyYWIgZ2xvYmFsIHNjb2xlIGZvciBXZWIgV29ya2Vyc1xucmVxdWlyZSgnLi9qcXVlcnkubm9kb20ubWluLmpzJykoZ2xvYmFsKTtcbmdsb2JhbC5fID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lcy5qcycpKGdsb2JhbCk7XG5cbmlmICghZ2xvYmFsLmNvbnNvbGUgfHwgIWdsb2JhbC5jb25zb2xlLmxvZykge1xuICBnbG9iYWwuY29uc29sZSA9IGdsb2JhbC5jb25zb2xlIHx8IHt9O1xuICBnbG9iYWwuY29uc29sZS5sb2cgPSBmdW5jdGlvbigpIHtcbiAgICBnbG9iYWwucG9zdE1lc3NhZ2Uoe2xvZzogSlNPTi5zdHJpbmdpZnkoXy50b0FycmF5KGFyZ3VtZW50cykpfSk7XG4gIH07XG59XG5cbnZhciBDdXN0b21HZW5vbWVXb3JrZXIgPSB7XG4gIF9nZW5vbWVzOiBbXSxcbiAgX3Rocm93RXJyb3JzOiBmYWxzZSxcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIG1ldGFkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lID0gQ3VzdG9tR2Vub21lcy5wYXJzZSh0ZXh0LCBtZXRhZGF0YSksXG4gICAgICBzZXJpYWxpemFibGU7XG4gICAgXG4gICAgLy8gd2Ugd2FudCB0byBrZWVwIHRoZSBnZW5vbWUgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgIC8vIGlzIHNlbnQgYmFjayBvdmVyIHRoZSBmZW5jZSwgc2luY2UgaXQgaXMgZXhwZW5zaXZlL2ltcG9zc2libGUgdG8gc2VyaWFsaXplXG4gICAgZ2Vub21lLmlkID0gc2VsZi5fZ2Vub21lcy5wdXNoKGdlbm9tZSkgLSAxO1xuICAgIFxuICAgIHNlcmlhbGl6YWJsZSA9IF8uZXh0ZW5kKHt9LCBnZW5vbWUpO1xuICAgIGRlbGV0ZSBzZXJpYWxpemFibGUuZGF0YTtcbiAgICByZXR1cm4gc2VyaWFsaXphYmxlO1xuICB9LFxuICBvcHRpb25zOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgZ2Vub21lID0gdGhpcy5fZ2Vub21lc1tpZF07XG4gICAgcmV0dXJuIGdlbm9tZS5vcHRpb25zLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgZ2V0U2VxdWVuY2U6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICBnZW5vbWUgPSB0aGlzLl9nZW5vbWVzW2lkXTtcbiAgICByZXR1cm4gZ2Vub21lLmdldFNlcXVlbmNlLmFwcGx5KGdlbm9tZSwgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgdGhyb3dFcnJvcnM6IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgIHRoaXMuX3Rocm93RXJyb3JzID0gdG9nZ2xlO1xuICB9XG59O1xuXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGRhdGEgPSBlLmRhdGEsXG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbihyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIHJldDogSlNPTi5zdHJpbmdpZnkociB8fCBudWxsKX0pOyB9LFxuICAgIHJldDtcblxuICBpZiAoQ3VzdG9tR2Vub21lV29ya2VyLl90aHJvd0Vycm9ycykge1xuICAgIHJldCA9IEN1c3RvbUdlbm9tZVdvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21HZW5vbWVXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTtcbiAgfSBlbHNlIHtcbiAgICB0cnkgeyByZXQgPSBDdXN0b21HZW5vbWVXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tR2Vub21lV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3MpIHsgcmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpOyB9XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIGdlbm9tZSBvYmplY3RcbiAgdmFyIEN1c3RvbUdlbm9tZSA9IHJlcXVpcmUoJy4vQ3VzdG9tR2Vub21lJykoZ2xvYmFsKTtcbiAgXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21HZW5vbWVzLCB0aGUgbW9kdWxlIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQgPVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIEN1c3RvbUdlbm9tZSBvYmplY3RzIHRoYXQgY2FuIGRlbGVnYXRlIHRoZVxuICAvLyB3b3JrIG9mIHBhcnNpbmcgdG8gYSBXZWIgV29ya2VyIHRocmVhZC5cbiAgXG4gIHZhciBDdXN0b21HZW5vbWVzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbih0ZXh0LCBtZXRhZGF0YSkge1xuICAgICAgbWV0YWRhdGEgPSBtZXRhZGF0YSB8fCB7fTtcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7IG1ldGFkYXRhLmZvcm1hdCA9IHRoaXMuZ3Vlc3NGb3JtYXQodGV4dCk7IH1cbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKG1ldGFkYXRhLmZvcm1hdCwgbWV0YWRhdGEpO1xuICAgICAgZ2Vub21lLnBhcnNlKHRleHQpO1xuICAgICAgcmV0dXJuIGdlbm9tZTtcbiAgICB9LFxuICAgIFxuICAgIGJsYW5rOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBnZW5vbWUgPSBuZXcgQ3VzdG9tR2Vub21lKFwiY2hyb21zaXplc1wiLCB7c3BlY2llczogXCJCbGFuayBHZW5vbWVcIn0pO1xuICAgICAgZ2Vub21lLnBhcnNlKFwiYmxhbmtcXHQ1MDAwMFwiKTtcbiAgICAgIHJldHVybiBnZW5vbWU7XG4gICAgfSxcbiAgICBcbiAgICBndWVzc0Zvcm1hdDogZnVuY3Rpb24odGV4dCkge1xuICAgICAgaWYgKHRleHQuc3Vic3RyaW5nKDAsIDUpID09ICdMT0NVUycpIHsgcmV0dXJuIFwiZ2VuYmFua1wiOyB9XG4gICAgICBpZiAoL15bQS1aXXsyfSB7M30vLnRlc3QodGV4dCkpIHsgcmV0dXJuIFwiZW1ibFwiOyB9XG4gICAgICBpZiAoL15bPjtdLy50ZXN0KHRleHQpKSB7IHJldHVybiBcImZhc3RhXCI7IH1cbiAgICAgIC8vIGRlZmF1bHQgaXMgZmFzdGFcbiAgICAgIHJldHVybiBcImZhc3RhXCI7XG4gICAgfSxcbiAgICBcbiAgICBlcnJvcjogZnVuY3Rpb24oZSkge1xuICAgICAgLy8gQ2FuIGJlIG92ZXJyaWRkZW4gYnkgYSBwYXJlbnQgbGlicmFyeSB0byBoYW5kbGUgZXJyb3JzIG1vcmUgZ3JhY2VmdWxseS5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbUdlbm9tZVdvcmtlci5qcycsXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICB3b3JrZXI6IGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyLFxuICAgIFxuICAgIGFzeW5jOiBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jLFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbihnZW5vbWUpIHtcbiAgICAgICAgLy8gVGhpcyBoYXMgYmVlbiBzZXJpYWxpemVkLCBzbyBpdCBtdXN0IGJlIGh5ZHJhdGVkIGludG8gYSByZWFsIEN1c3RvbUdlbm9tZSBvYmplY3QuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLmdldFNlcXVlbmNlKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21HZW5vbWUoZmFsc2UpLCBnZW5vbWUsIHtcbiAgICAgICAgICBnZXRTZXF1ZW5jZTogZnVuY3Rpb24oKSB7IEN1c3RvbUdlbm9tZS5wcm90b3R5cGUuZ2V0U2VxdWVuY2VBc3luYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuICBcbiAgZ2xvYmFsLkN1c3RvbUdlbm9tZXMgPSBDdXN0b21HZW5vbWVzO1xuICBcbn0pOyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEN1c3RvbVRyYWNrLCBhbiBvYmplY3QgcmVwcmVzZW50aW5nIGEgY3VzdG9tIHRyYWNrIGFzIHVuZGVyc3Rvb2QgYnkgVUNTQy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBUaGlzIGNsYXNzICpkb2VzKiBkZXBlbmQgb24gZ2xvYmFsIG9iamVjdHMgYW5kIHRoZXJlZm9yZSBtdXN0IGJlIHJlcXVpcmVkIGFzIGEgXG4vLyBmdW5jdGlvbiB0aGF0IGlzIGV4ZWN1dGVkIG9uIHRoZSBnbG9iYWwgb2JqZWN0LlxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCkge1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKSxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcDtcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbmZ1bmN0aW9uIEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKSB7XG4gIGlmICghb3B0cykgeyByZXR1cm47IH0gLy8gVGhpcyBpcyBhbiBlbXB0eSBjdXN0b21UcmFjayB0aGF0IHdpbGwgYmUgaHlkcmF0ZWQgd2l0aCB2YWx1ZXMgZnJvbSBhIHNlcmlhbGl6ZWQgb2JqZWN0XG4gIHZhciB0eXBlV2l0aEFyZ3MgPSAob3B0cy50eXBlICYmIHN0cmlwKG9wdHMudHlwZS50b0xvd2VyQ2FzZSgpKS5zcGxpdCgvXFxzKy8pKSB8fCBbXCJiZWRcIl07XG4gIG9wdHMudHlwZSA9IHRoaXMuX3R5cGUgPSB0eXBlV2l0aEFyZ3NbMF07XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmICh0eXBlID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIHRyYWNrIHR5cGUgJ1wiK29wdHMudHlwZStcIicgZW5jb3VudGVyZWQgb24gbGluZSBcIiArIG9wdHMubGluZU51bSk7IH1cbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMsIHR5cGUuZGVmYXVsdHMgfHwge30sIG9wdHMpO1xuICBfLmV4dGVuZCh0aGlzLCB7XG4gICAgYnJvd3Nlck9wdHM6IGJyb3dzZXJPcHRzLFxuICAgIHR5cGVBcmdzOiB0eXBlV2l0aEFyZ3Muc2xpY2UoMSksXG4gICAgc3RyZXRjaEhlaWdodDogZmFsc2UsXG4gICAgaGVpZ2h0czoge30sXG4gICAgc2l6ZXM6IFsnZGVuc2UnXSxcbiAgICBtYXBTaXplczogW10sXG4gICAgYXJlYXM6IHt9LFxuICAgIHNjYWxlczoge30sXG4gICAgbm9BcmVhTGFiZWxzOiBmYWxzZSxcbiAgICBleHBlY3RzU2VxdWVuY2U6IGZhbHNlLFxuICAgIG9uU3luY1Byb3BzOiBudWxsXG4gIH0pO1xuICB0aGlzLmluaXQoKTtcbn1cblxuQ3VzdG9tVHJhY2suZGVmYXVsdHMgPSB7XG4gIG5hbWU6ICdVc2VyIFRyYWNrJyxcbiAgZGVzY3JpcHRpb246ICdVc2VyIFN1cHBsaWVkIFRyYWNrJyxcbiAgY29sb3I6ICcwLDAsMCdcbn07XG5cbkN1c3RvbVRyYWNrLnR5cGVzID0ge1xuICBiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkLmpzJyksXG4gIGZlYXR1cmV0YWJsZTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9mZWF0dXJldGFibGUuanMnKSxcbiAgYmVkZ3JhcGg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmVkZ3JhcGguanMnKSxcbiAgd2lnZ2xlXzA6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMnKSxcbiAgdmNmdGFiaXg6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvdmNmdGFiaXguanMnKSxcbiAgYmlnYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ2JlZC5qcycpLFxuICBiYW06IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmFtLmpzJyksXG4gIGJpZ3dpZzogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWd3aWcuanMnKSxcbiAgYmlnZ2VuZXByZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnZ2VuZXByZWQuanMnKVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkRGV0YWlsIGZvcm1hdDogaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEuNyA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAgXG5cbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbCA9IF8uY2xvbmUoQ3VzdG9tVHJhY2sudHlwZXMuYmVkKTtcbkN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cyA9IF8uZXh0ZW5kKHt9LCBDdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMsIHtkZXRhaWw6IHRydWV9KTtcblxuLy8gVGhlc2UgZnVuY3Rpb25zIGJyYW5jaCB0byBkaWZmZXJlbnQgbWV0aG9kcyBkZXBlbmRpbmcgb24gdGhlIC50eXBlKCkgb2YgdGhlIHRyYWNrXG5fLmVhY2goWydpbml0JywgJ3BhcnNlJywgJ2ZpbmlzaFNldHVwJywgJ3JlbmRlcicsICdyZW5kZXJTZXF1ZW5jZScsICdwcmVyZW5kZXInXSwgZnVuY3Rpb24oZm4pIHtcbiAgQ3VzdG9tVHJhY2sucHJvdG90eXBlW2ZuXSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICB0eXBlID0gdGhpcy50eXBlKCk7XG4gICAgaWYgKCF0eXBlW2ZuXSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICByZXR1cm4gdHlwZVtmbl0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pO1xuXG4vLyBMb2FkcyBDdXN0b21UcmFjayBvcHRpb25zIGludG8gdGhlIHRyYWNrIG9wdGlvbnMgZGlhbG9nIFVJIHdoZW4gaXQgaXMgb3BlbmVkXG5DdXN0b21UcmFjay5wcm90b3R5cGUubG9hZE9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybScpLmhpZGUoKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW9wdHMtZm9ybS4nK3RoaXMuX3R5cGUpLnNob3coKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLW5hbWUnKS50ZXh0KG8ubmFtZSk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1kZXNjJykudGV4dChvLmRlc2NyaXB0aW9uKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWZvcm1hdCcpLnRleHQodGhpcy5fdHlwZSk7XG4gICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKG8uY29sb3IpLmNoYW5nZSgpO1xuICBpZiAodHlwZS5sb2FkT3B0cykgeyB0eXBlLmxvYWRPcHRzLmNhbGwodGhpcywgJGRpYWxvZyk7IH1cbiAgJGRpYWxvZy5maW5kKCcuZW5hYmxlcicpLmNoYW5nZSgpO1xufTtcblxuLy8gU2F2ZXMgb3B0aW9ucyBjaGFuZ2VkIGluIHRoZSB0cmFjayBvcHRpb25zIGRpYWxvZyBVSSBiYWNrIHRvIHRoZSBDdXN0b21UcmFjayBvYmplY3RcbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zYXZlT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICBvLmNvbG9yID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoKTtcbiAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5jb2xvcikpIHsgby5jb2xvciA9ICcwLDAsMCc7IH1cbiAgaWYgKHR5cGUuc2F2ZU9wdHMpIHsgdHlwZS5zYXZlT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gIHRoaXMuYXBwbHlPcHRzKCk7XG4gIGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkgJiYgdGhpcy5hcHBseU9wdHNBc3luYygpOyAvLyBBcHBseSB0aGUgY2hhbmdlcyB0byB0aGUgd29ya2VyIHRvbyFcbn07XG5cbi8vIFNvbWV0aW1lcyBuZXdseSBzZXQgb3B0aW9ucyAocHJvdmlkZWQgYXMgdGhlIGZpcnN0IGFyZykgbmVlZCB0byBiZSB0cmFuc2Zvcm1lZCBiZWZvcmUgdXNlIG9yIGhhdmUgc2lkZSBlZmZlY3RzLlxuLy8gVGhpcyBmdW5jdGlvbiBpcyBydW4gZm9yIG5ld2x5IHNldCBvcHRpb25zIGluIGJvdGggdGhlIERPTSBhbmQgV2ViIFdvcmtlciBzY29wZXMgKHNlZSBhcHBseU9wdHNBc3luYyBiZWxvdykuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzID0gZnVuY3Rpb24ob3B0cykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAob3B0cykgeyB0aGlzLm9wdHMgPSBvcHRzOyB9XG4gIGlmICh0eXBlLmFwcGx5T3B0cykgeyB0eXBlLmFwcGx5T3B0cy5jYWxsKHRoaXMpOyB9XG59O1xuXG4vLyBDb3BpZXMgdGhlIHByb3BlcnRpZXMgb2YgdGhlIEN1c3RvbVRyYWNrIChsaXN0ZWQgaW4gcHJvcHMpIGZyb20gdGhlIFdlYiBXb3JrZXIgc2lkZSB0byB0aGUgRE9NIHNpZGUuXG4vLyBUaGlzIGlzIHVzZWZ1bCBpZiB0aGUgV2ViIFdvcmtlciBjb21wdXRlcyBzb21ldGhpbmcgKGxpa2UgZHJhdyBib3VuZGFyaWVzKSB0aGF0IGJvdGggc2lkZXMgbmVlZCB0byBiZSBhd2FyZSBvZi5cbi8vIElmIGEgY2FsbGJhY2sgaXMgc2F2ZWQgaW4gdGhpcy5vblN5bmNQcm9wcywgdGhpcyB3aWxsIHJ1biB0aGUgY2FsbGJhY2sgYWZ0ZXJ3YXJkLlxuLy8gSWYgV2ViIFdvcmtlcnMgYXJlIGRpc2FibGVkLCB0aGlzIGlzIGVmZmVjdGl2ZWx5IGEgbm8tb3AsIGFsdGhvdWdoIHRoZSBjYWxsYmFjayBzdGlsbCBmaXJlcy5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zeW5jUHJvcHMgPSBmdW5jdGlvbihwcm9wcywgcmVjZWl2aW5nKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHJlY2VpdmluZyA9PT0gdHJ1ZSkge1xuICAgIGlmICghXy5pc09iamVjdChwcm9wcykgfHwgXy5pc0FycmF5KHByb3BzKSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICBfLmV4dGVuZChzZWxmLCBwcm9wcyk7XG4gICAgaWYgKF8uaXNGdW5jdGlvbihzZWxmLm9uU3luY1Byb3BzKSAmJiBnbG9iYWwuSFRNTERvY3VtZW50KSB7IHNlbGYub25TeW5jUHJvcHMocHJvcHMpOyB9XG4gICAgcmV0dXJuIHNlbGY7XG4gIH0gZWxzZSB7ICAgIFxuICAgIGlmIChfLmlzQXJyYXkocHJvcHMpKSB7IHByb3BzID1fLm9iamVjdChwcm9wcywgXy5tYXAocHJvcHMsIGZ1bmN0aW9uKHApIHsgcmV0dXJuIHNlbGZbcF07IH0pKTsgfVxuICAgIC8vIFdoaWNoIHNpZGUgb2YgdGhlIGZlbmNlIGFyZSB3ZSBvbj8gIEhUTUxEb2N1bWVudCBpbXBsaWVzIHdlJ3JlICpub3QqIGluIHRoZSBXZWIgV29ya2VyIHNjb3BlLlxuICAgIGlmIChnbG9iYWwuSFRNTERvY3VtZW50KSB7XG4gICAgICBpZiAoIWdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkpIHsgcmV0dXJuIHNlbGYuc3luY1Byb3BzKHByb3BzLCB0cnVlKTsgfVxuICAgIH0gZWxzZSBpZiAoZ2xvYmFsLkN1c3RvbVRyYWNrV29ya2VyKSB7XG4gICAgICBnbG9iYWwuQ3VzdG9tVHJhY2tXb3JrZXIuc3luY1Byb3BzQXN5bmMoc2VsZiwgcHJvcHMpO1xuICAgIH1cbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmVyYXNlID0gZnVuY3Rpb24oY2FudmFzKSB7XG4gIHZhciBzZWxmID0gdGhpcyxcbiAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgaWYgKGN0eCkgeyBjdHguY2xlYXJSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7IH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHR5cGUpKSB7IHR5cGUgPSB0aGlzLl90eXBlOyB9XG4gIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLnR5cGVzW3R5cGVdIHx8IG51bGw7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUud2FybiA9IGZ1bmN0aW9uKHdhcm5pbmcpIHtcbiAgaWYgKHRoaXMub3B0cy5zdHJpY3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3Iod2FybmluZyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCF0aGlzLndhcm5pbmdzKSB7IHRoaXMud2FybmluZ3MgPSBbXTsgfVxuICAgIHRoaXMud2FybmluZ3MucHVzaCh3YXJuaW5nKTtcbiAgfVxufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmlzT24gPSBmdW5jdGlvbih2YWwpIHtcbiAgcmV0dXJuIC9eKG9ufHllc3x0cnVlfHR8eXwxKSQvaS50ZXN0KHZhbC50b1N0cmluZygpKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJMaXN0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fY2hyTGlzdCkge1xuICAgIHRoaXMuX2Nockxpc3QgPSBfLnNvcnRCeShfLm1hcCh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcywgZnVuY3Rpb24ocG9zLCBjaHIpIHsgcmV0dXJuIFtwb3MsIGNocl07IH0pLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KTtcbiAgfVxuICByZXR1cm4gdGhpcy5fY2hyTGlzdDtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockF0ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHZhciBjaHJMaXN0ID0gdGhpcy5jaHJMaXN0KCksXG4gICAgY2hySW5kZXggPSBfLnNvcnRlZEluZGV4KGNockxpc3QsIFtwb3NdLCBmdW5jdGlvbih2KSB7IHJldHVybiB2WzBdOyB9KSxcbiAgICBjaHIgPSBjaHJJbmRleCA+IDAgPyBjaHJMaXN0W2NockluZGV4IC0gMV1bMV0gOiBudWxsO1xuICByZXR1cm4ge2k6IGNockluZGV4IC0gMSwgYzogY2hyLCBwOiBwb3MgLSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJdfTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJSYW5nZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGNockxlbmd0aHMgPSB0aGlzLmJyb3dzZXJPcHRzLmNockxlbmd0aHMsXG4gICAgc3RhcnRDaHIgPSB0aGlzLmNockF0KHN0YXJ0KSxcbiAgICBlbmRDaHIgPSB0aGlzLmNockF0KGVuZCksXG4gICAgcmFuZ2U7XG4gIGlmIChzdGFydENoci5jICYmIHN0YXJ0Q2hyLmkgPT09IGVuZENoci5pKSB7IHJldHVybiBbc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBlbmRDaHIucF07IH1cbiAgZWxzZSB7XG4gICAgcmFuZ2UgPSBfLm1hcCh0aGlzLmNockxpc3QoKS5zbGljZShzdGFydENoci5pICsgMSwgZW5kQ2hyLmkpLCBmdW5jdGlvbih2KSB7XG4gICAgICByZXR1cm4gdlsxXSArICc6MS0nICsgY2hyTGVuZ3Roc1t2WzFdXTtcbiAgICB9KTtcbiAgICBzdGFydENoci5jICYmIHJhbmdlLnVuc2hpZnQoc3RhcnRDaHIuYyArICc6JyArIHN0YXJ0Q2hyLnAgKyAnLScgKyBjaHJMZW5ndGhzW3N0YXJ0Q2hyLmNdKTtcbiAgICBlbmRDaHIuYyAmJiByYW5nZS5wdXNoKGVuZENoci5jICsgJzoxLScgKyBlbmRDaHIucCk7XG4gICAgcmV0dXJuIHJhbmdlO1xuICB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5wcmVyZW5kZXJBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdwcmVyZW5kZXInLCBhcmd1bWVudHMsIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAnYXBwbHlPcHRzJywgW3RoaXMub3B0cywgZnVuY3Rpb24oKXt9XSwgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5maW5pc2hTZXR1cEFzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ2ZpbmlzaFNldHVwJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFqYXhEaXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gV2ViIFdvcmtlcnMgZmV0Y2ggVVJMcyByZWxhdGl2ZSB0byB0aGUgSlMgZmlsZSBpdHNlbGYuXG4gIHJldHVybiAoZ2xvYmFsLkhUTUxEb2N1bWVudCA/ICcnIDogJy4uLycpICsgdGhpcy5icm93c2VyT3B0cy5hamF4RGlyO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnJnYlRvSHNsID0gZnVuY3Rpb24ociwgZywgYikge1xuICByIC89IDI1NSwgZyAvPSAyNTUsIGIgLz0gMjU1O1xuICB2YXIgbWF4ID0gTWF0aC5tYXgociwgZywgYiksIG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICB2YXIgaCwgcywgbCA9IChtYXggKyBtaW4pIC8gMjtcblxuICBpZiAobWF4ID09IG1pbikge1xuICAgIGggPSBzID0gMDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIHZhciBkID0gbWF4IC0gbWluO1xuICAgIHMgPSBsID4gMC41ID8gZCAvICgyIC0gbWF4IC0gbWluKSA6IGQgLyAobWF4ICsgbWluKTtcbiAgICBzd2l0Y2gobWF4KXtcbiAgICAgIGNhc2UgcjogaCA9IChnIC0gYikgLyBkICsgKGcgPCBiID8gNiA6IDApOyBicmVhaztcbiAgICAgIGNhc2UgZzogaCA9IChiIC0gcikgLyBkICsgMjsgYnJlYWs7XG4gICAgICBjYXNlIGI6IGggPSAociAtIGcpIC8gZCArIDQ7IGJyZWFrO1xuICAgIH1cbiAgICBoIC89IDY7XG4gIH1cblxuICByZXR1cm4gW2gsIHMsIGxdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuaHNsVG9SZ2IgPSBmdW5jdGlvbihoLCBzLCBsKSB7XG4gIHZhciByLCBnLCBiO1xuXG4gIGlmIChzID09IDApIHtcbiAgICByID0gZyA9IGIgPSBsOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgZnVuY3Rpb24gaHVlMnJnYihwLCBxLCB0KSB7XG4gICAgICBpZih0IDwgMCkgdCArPSAxO1xuICAgICAgaWYodCA+IDEpIHQgLT0gMTtcbiAgICAgIGlmKHQgPCAxLzYpIHJldHVybiBwICsgKHEgLSBwKSAqIDYgKiB0O1xuICAgICAgaWYodCA8IDEvMikgcmV0dXJuIHE7XG4gICAgICBpZih0IDwgMi8zKSByZXR1cm4gcCArIChxIC0gcCkgKiAoMi8zIC0gdCkgKiA2O1xuICAgICAgcmV0dXJuIHA7XG4gICAgfVxuXG4gICAgdmFyIHEgPSBsIDwgMC41ID8gbCAqICgxICsgcykgOiBsICsgcyAtIGwgKiBzO1xuICAgIHZhciBwID0gMiAqIGwgLSBxO1xuICAgIHIgPSBodWUycmdiKHAsIHEsIGggKyAxLzMpO1xuICAgIGcgPSBodWUycmdiKHAsIHEsIGgpO1xuICAgIGIgPSBodWUycmdiKHAsIHEsIGggLSAxLzMpO1xuICB9XG5cbiAgcmV0dXJuIFtyICogMjU1LCBnICogMjU1LCBiICogMjU1XTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnZhbGlkYXRlQ29sb3IgPSBmdW5jdGlvbihjb2xvcikge1xuICB2YXIgbSA9IGNvbG9yLm1hdGNoKC8oXFxkKyksKFxcZCspLChcXGQrKS8pO1xuICBpZiAoIW0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gIG0uc2hpZnQoKTtcbiAgcmV0dXJuIF8uYWxsKF8ubWFwKG0sIHBhcnNlSW50MTApLCBmdW5jdGlvbih2KSB7IHJldHVybiB2ID49MCAmJiB2IDw9IDI1NTsgfSk7XG59XG5cbnJldHVybiBDdXN0b21UcmFjaztcblxufTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBcbiAgLy8gU29tZSB1dGlsaXR5IGZ1bmN0aW9ucy5cbiAgdmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIHRyYWNrIG9iamVjdFxuICB2YXIgQ3VzdG9tVHJhY2sgPSByZXF1aXJlKCcuL0N1c3RvbVRyYWNrLmpzJykoZ2xvYmFsKTtcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21UcmFja3MsIHRoZSBtb2R1bGUgdGhhdCBpcyBleHBvcnRlZCB0byB0aGUgZ2xvYmFsIGVudmlyb25tZW50LiA9XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBCcm9hZGx5IHNwZWFraW5nIHRoaXMgaXMgYSBmYWN0b3J5IGZvciBwYXJzaW5nIGRhdGEgaW50byBDdXN0b21UcmFjayBvYmplY3RzLFxuICAvLyBhbmQgaXQgY2FuIGRlbGVnYXRlIHRoaXMgd29yayB0byBhIHdvcmtlciB0aHJlYWQuXG5cbiAgdmFyIEN1c3RvbVRyYWNrcyA9IHtcbiAgICBfdHJhY2tzOiB7fSxcbiAgICBcbiAgICBwYXJzZTogZnVuY3Rpb24oY2h1bmtzLCBicm93c2VyT3B0cykge1xuICAgICAgdmFyIGN1c3RvbVRyYWNrcyA9IFtdLFxuICAgICAgICBkYXRhID0gW10sXG4gICAgICAgIHRyYWNrLCBvcHRzLCBtO1xuICAgICAgXG4gICAgICBpZiAodHlwZW9mIGNodW5rcyA9PSBcInN0cmluZ1wiKSB7IGNodW5rcyA9IFtjaHVua3NdOyB9XG4gICAgICBcbiAgICAgIGZ1bmN0aW9uIHB1c2hUcmFjaygpIHtcbiAgICAgICAgaWYgKHRyYWNrLnBhcnNlKGRhdGEpKSB7IGN1c3RvbVRyYWNrcy5wdXNoKHRyYWNrKTsgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjdXN0b21UcmFja3MuYnJvd3NlciA9IHt9O1xuICAgICAgXy5lYWNoKGNodW5rcywgZnVuY3Rpb24odGV4dCkge1xuICAgICAgICBfLmVhY2godGV4dC5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICAgICAgaWYgKC9eIy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gY29tbWVudCBsaW5lXG4gICAgICAgICAgfSBlbHNlIGlmICgvXmJyb3dzZXJcXHMrLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBicm93c2VyIGxpbmVzXG4gICAgICAgICAgICBtID0gbGluZS5tYXRjaCgvXmJyb3dzZXJcXHMrKFxcdyspXFxzKyhcXFMqKS8pO1xuICAgICAgICAgICAgaWYgKCFtKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSBicm93c2VyIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyW21bMV1dID0gbVsyXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9edHJhY2tcXHMrL2kudGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICAgICAgICBvcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgKC9edHJhY2tcXHMrL2kpKTtcbiAgICAgICAgICAgIGlmICghb3B0cykgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgdHJhY2sgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgb3B0cy5saW5lTnVtID0gbGluZW5vICsgMTtcbiAgICAgICAgICAgIHRyYWNrID0gbmV3IEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKTtcbiAgICAgICAgICAgIGRhdGEgPSBbXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9cXFMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICghdHJhY2spIHsgdGhyb3cgbmV3IEVycm9yKFwiRm91bmQgZGF0YSBvbiBsaW5lIFwiKyhsaW5lbm8rMSkrXCIgYnV0IG5vIHByZWNlZGluZyB0cmFjayBkZWZpbml0aW9uXCIpOyB9XG4gICAgICAgICAgICBkYXRhLnB1c2gobGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICByZXR1cm4gY3VzdG9tVHJhY2tzO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmU6IHBhcnNlRGVjbGFyYXRpb25MaW5lLFxuICAgIFxuICAgIGVycm9yOiBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBDYW4gYmUgb3ZlcnJpZGRlbiBieSBhIHBhcmVudCBsaWJyYXJ5IHRvIGhhbmRsZSBlcnJvcnMgbW9yZSBncmFjZWZ1bGx5LlxuICAgICAgLy8gTm90ZTogdGhpcyBpcyBvdmVycmlkZGVuIGJ5IHVpLmdlbm9icm93c2VyIGR1cmluZyBVSSBzZXR1cC5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbVRyYWNrV29ya2VyLmpzJyxcbiAgICAvLyBOT1RFOiBUbyB0ZW1wb3JhcmlseSBkaXNhYmxlIFdlYiBXb3JrZXIgdXNhZ2UsIHNldCB0aGlzIHRvIHRydWUuXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICBcbiAgICB3b3JrZXI6IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgY2FsbGJhY2tzID0gW107XG4gICAgICBpZiAoIXNlbGYuX3dvcmtlciAmJiBnbG9iYWwuV29ya2VyKSB7IFxuICAgICAgICBzZWxmLl93b3JrZXIgPSBuZXcgZ2xvYmFsLldvcmtlcihzZWxmLl93b3JrZXJTY3JpcHQpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBmdW5jdGlvbihlKSB7IHNlbGYuZXJyb3IoZSk7IH0sIGZhbHNlKTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgaWYgKGUuZGF0YS5sb2cpIHsgY29uc29sZS5sb2coSlNPTi5wYXJzZShlLmRhdGEubG9nKSk7IHJldHVybjsgfVxuICAgICAgICAgIGlmIChlLmRhdGEuZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChlLmRhdGEuaWQpIHsgZGVsZXRlIGNhbGxiYWNrc1tlLmRhdGEuaWRdOyB9XG4gICAgICAgICAgICBzZWxmLmVycm9yKEpTT04ucGFyc2UoZS5kYXRhLmVycm9yKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChlLmRhdGEuc3luY1Byb3BzKSB7XG4gICAgICAgICAgICBzZWxmLl90cmFja3NbZS5kYXRhLmlkXS5zeW5jUHJvcHMoZS5kYXRhLnN5bmNQcm9wcywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGNhbGxiYWNrc1tlLmRhdGEuaWRdKEpTT04ucGFyc2UoZS5kYXRhLnJldCkpO1xuICAgICAgICAgIGRlbGV0ZSBjYWxsYmFja3NbZS5kYXRhLmlkXTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5jYWxsID0gZnVuY3Rpb24ob3AsIGFyZ3MsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgdmFyIGlkID0gY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC0gMTtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogb3AsIGlkOiBpZCwgYXJnczogYXJnc30pO1xuICAgICAgICB9O1xuICAgICAgICAvLyBUbyBoYXZlIHRoZSB3b3JrZXIgdGhyb3cgZXJyb3JzIGluc3RlYWQgb2YgcGFzc2luZyB0aGVtIG5pY2VseSBiYWNrLCBjYWxsIHRoaXMgd2l0aCB0b2dnbGU9dHJ1ZVxuICAgICAgICBzZWxmLl93b3JrZXIudGhyb3dFcnJvcnMgPSBmdW5jdGlvbih0b2dnbGUpIHtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogJ3Rocm93RXJyb3JzJywgYXJnczogW3RvZ2dsZV19KTtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZWxmLl9kaXNhYmxlV29ya2VycyA/IG51bGwgOiBzZWxmLl93b3JrZXI7XG4gICAgfSxcbiAgICBcbiAgICBhc3luYzogZnVuY3Rpb24oc2VsZiwgZm4sIGFyZ3MsIGFzeW5jRXh0cmFBcmdzLCB3cmFwcGVyKSB7XG4gICAgICBhcmdzID0gXy50b0FycmF5KGFyZ3MpO1xuICAgICAgd3JhcHBlciA9IHdyYXBwZXIgfHwgXy5pZGVudGl0eTtcbiAgICAgIHZhciBhcmdzRXhjZXB0TGFzdE9uZSA9IF8uaW5pdGlhbChhcmdzKSxcbiAgICAgICAgY2FsbGJhY2sgPSBfLmxhc3QoYXJncyksXG4gICAgICAgIHcgPSB0aGlzLndvcmtlcigpO1xuICAgICAgLy8gRmFsbGJhY2sgaWYgd2ViIHdvcmtlcnMgYXJlIG5vdCBzdXBwb3J0ZWQuXG4gICAgICAvLyBUaGlzIGNvdWxkIGFsc28gYmUgdHdlYWtlZCB0byBub3QgdXNlIHdlYiB3b3JrZXJzIHdoZW4gdGhlcmUgd291bGQgYmUgbm8gcGVyZm9ybWFuY2UgZ2FpbjtcbiAgICAgIC8vICAgYWN0aXZhdGluZyB0aGlzIGJyYW5jaCBkaXNhYmxlcyB3ZWIgd29ya2VycyBlbnRpcmVseSBhbmQgZXZlcnl0aGluZyBoYXBwZW5zIHN5bmNocm9ub3VzbHkuXG4gICAgICBpZiAoIXcpIHsgcmV0dXJuIGNhbGxiYWNrKHNlbGZbZm5dLmFwcGx5KHNlbGYsIGFyZ3NFeGNlcHRMYXN0T25lKSk7IH1cbiAgICAgIEFycmF5LnByb3RvdHlwZS51bnNoaWZ0LmFwcGx5KGFyZ3NFeGNlcHRMYXN0T25lLCBhc3luY0V4dHJhQXJncyk7XG4gICAgICB3LmNhbGwoZm4sIGFyZ3NFeGNlcHRMYXN0T25lLCBmdW5jdGlvbihyZXQpIHsgY2FsbGJhY2sod3JhcHBlcihyZXQpKTsgfSk7XG4gICAgfSxcbiAgICBcbiAgICBwYXJzZUFzeW5jOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgIHNlbGYuYXN5bmMoc2VsZiwgJ3BhcnNlJywgYXJndW1lbnRzLCBbXSwgZnVuY3Rpb24odHJhY2tzKSB7XG4gICAgICAgIC8vIFRoZXNlIGhhdmUgYmVlbiBzZXJpYWxpemVkLCBzbyB0aGV5IG11c3QgYmUgaHlkcmF0ZWQgaW50byByZWFsIEN1c3RvbVRyYWNrIG9iamVjdHMuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLnByZXJlbmRlcigpIHdpdGggYW4gYXN5bmNocm9ub3VzIHZlcnNpb24uXG4gICAgICAgIHJldHVybiBfLm1hcCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICBzZWxmLl90cmFja3NbdC5pZF0gPSBfLmV4dGVuZChuZXcgQ3VzdG9tVHJhY2soKSwgdCwge1xuICAgICAgICAgICAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHsgQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gc2VsZi5fdHJhY2tzW3QuaWRdO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBnbG9iYWwuQ3VzdG9tVHJhY2tzID0gQ3VzdG9tVHJhY2tzO1xuXG59KTsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBjaHJvbS5zaXplcyBmb3JtYXQ6IGh0dHA6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9jaHJvbVNpemVzID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBOb3RlOiB3ZSBhcmUgZXh0ZW5kaW5nIHRoZSBnZW5lcmFsIHVzZSBvZiB0aGlzIHRvIGluY2x1ZGUgZGF0YSBsb2FkZWQgZnJvbSB0aGUgZ2Vub21lLnR4dCBhbmQgYW5ub3RzLnhtbFxuLy8gZmlsZXMgb2YgYW4gSUdCIHF1aWNrbG9hZCBkaXJlY3RvcnksXG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIG9wdHNBc1RyYWNrTGluZSA9IHV0aWxzLm9wdHNBc1RyYWNrTGluZVxuICB0cmFja0hlaWdodEZvclR5cGUgPSB1dGlscy50cmFja0hlaWdodEZvclR5cGU7XG5cbnZhciBDaHJvbVNpemVzRm9ybWF0ID0ge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtID0gc2VsZi5tZXRhZGF0YSxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgby5zcGVjaWVzID0gbS5zcGVjaWVzIHx8ICdDdXN0b20gR2Vub21lJztcbiAgICBvLmFzc2VtYmx5RGF0ZSA9IG0uYXNzZW1ibHlEYXRlIHx8ICcnO1xuICAgIFxuICAgIGlmIChtLnRyYWNrcykgeyBzZWxmLmZvcm1hdCgpLmNyZWF0ZVRyYWNrcyhtLnRyYWNrcyk7IH1cbiAgICBvLnNlYXJjaGFibGVUcmFja3MgPSBtLm1vcmVUcmFja3MgfHwgKG0udHJhY2tzICYmIG0udHJhY2tzLmxlbmd0aCA+IDE1KTtcbiAgICBcbiAgICBpZiAobS5jeXRvQmFuZElkZW8pIHsgc2VsZi5mb3JtYXQoKS5jcmVhdGVDaHJCYW5kcyhtLmN5dG9CYW5kSWRlbyk7IH1cbiAgfSxcbiAgXG4gIGNyZWF0ZVRyYWNrczogZnVuY3Rpb24odHJhY2tzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNhdGVnb3JpZXMgPSB7fTtcbiAgICAgIFxuICAgIF8uZWFjaCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgIHZhciB0cmFja09wdHMsIFxuICAgICAgICB2aXNpYmxlID0gdHJ1ZSxcbiAgICAgICAgY2F0ID0gdC5ncnAgfHwgXCJGZWF0dXJlIFRyYWNrc1wiO1xuICAgICAgdC5saW5lcyA9IHQubGluZXMgfHwgW107XG4gICAgICB0cmFja09wdHMgPSAvXnRyYWNrXFxzKy9pLnRlc3QodC5saW5lc1swXSkgPyBnbG9iYWwuQ3VzdG9tVHJhY2tzLnBhcnNlRGVjbGFyYXRpb25MaW5lKHQubGluZXMuc2hpZnQoKSkgOiB7fTtcbiAgICAgIF8uZXh0ZW5kKHRyYWNrT3B0cywgdC5vcHRzLCB7bmFtZTogdC5uYW1lLCB0eXBlOiB0LnR5cGV9KTtcbiAgICAgIGlmICh0cmFja09wdHMudmlzaWJpbGl0eSkge1xuICAgICAgICBpZiAodHJhY2tPcHRzLnZpc2liaWxpdHkgPT0gJ2hpZGUnKSB7IHZpc2libGUgPSBmYWxzZTsgfVxuICAgICAgICBkZWxldGUgdHJhY2tPcHRzLnZpc2liaWxpdHk7XG4gICAgICB9XG4gICAgICB0LmxpbmVzLnVuc2hpZnQoJ3RyYWNrICcgKyBvcHRzQXNUcmFja0xpbmUodHJhY2tPcHRzKSArICdcXG4nKTtcbiAgICAgIG8uYXZhaWxUcmFja3MucHVzaCh7XG4gICAgICAgIGZoOiB7fSxcbiAgICAgICAgbjogdC5uYW1lLFxuICAgICAgICBzOiBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ10sXG4gICAgICAgIGg6IHRyYWNrSGVpZ2h0Rm9yVHlwZSh0LnR5cGUpLFxuICAgICAgICBtOiBbJ3BhY2snXSxcbiAgICAgICAgY3VzdG9tRGF0YTogdC5saW5lc1xuICAgICAgfSk7XG4gICAgICBpZiAodmlzaWJsZSkgeyBvLnRyYWNrcy5wdXNoKHtuOiB0Lm5hbWV9KTsgfVxuICAgICAgby50cmFja0Rlc2NbdC5uYW1lXSA9IHtcbiAgICAgICAgY2F0OiBjYXQsXG4gICAgICAgIHNtOiB0LnNob3J0TGFiZWwgfHwgdC5uYW1lLFxuICAgICAgICBsZzogdC5kZXNjcmlwdGlvbiB8fCB0Lm5hbWVcbiAgICAgIH07XG4gICAgICBjYXRlZ29yaWVzW2NhdF0gPSB0cnVlO1xuICAgIH0pO1xuICAgIFxuICAgIGlmIChfLmtleXMoY2F0ZWdvcmllcykubGVuZ3RoID4gMSkgeyBvLmdyb3VwVHJhY2tzQnlDYXRlZ29yeSA9IHRydWU7IH1cbiAgfSxcbiAgXG4gIGNyZWF0ZUNockJhbmRzOiBmdW5jdGlvbihjeXRvQmFuZElkZW8pIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICBvLmNockJhbmRzID0gXy5jb21wYWN0KF8ubWFwKGN5dG9CYW5kSWRlby5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obCkgeyBcbiAgICAgIHZhciBmaWVsZHMgPSBsLnNwbGl0KFwiXFx0XCIpO1xuICAgICAgaWYgKGZpZWxkcy5sZW5ndGggIT0gNSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgIGZpZWxkc1sxXSA9IHBhcnNlSW50MTAoZmllbGRzWzFdKTtcbiAgICAgIGZpZWxkc1syXSA9IHBhcnNlSW50MTAoZmllbGRzWzJdKTtcbiAgICAgIHJldHVybiBmaWVsZHM7XG4gICAgfSkpO1xuICAgIGlmIChvLmNockJhbmRzLmxlbmd0aCA+IDApIHsgXG4gICAgICBvLmlkZW9ncmFtc0Fib3ZlID0gdHJ1ZTtcbiAgICAgIG8uYXZhaWxUcmFja3NbMF0uaCA9IDUwO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbih0ZXh0KSB7XG4gICAgdmFyIGxpbmVzID0gdGV4dC5zcGxpdChcIlxcblwiKSxcbiAgICAgIG8gPSB0aGlzLm9wdHM7XG4gICAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBpKSB7XG4gICAgICB2YXIgY2hyc2l6ZSA9IHN0cmlwKGxpbmUpLnNwbGl0KC9cXHMrLywgMiksXG4gICAgICAgIGNociA9IGNocnNpemVbMF0sXG4gICAgICAgIHNpemUgPSBwYXJzZUludDEwKGNocnNpemVbMV0pO1xuICAgICAgaWYgKF8uaXNOYU4oc2l6ZSkpIHsgcmV0dXJuOyB9XG4gICAgICBvLmNock9yZGVyLnB1c2goY2hyKTtcbiAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gc2l6ZTtcbiAgICAgIG8uZ2Vub21lU2l6ZSArPSBzaXplO1xuICAgIH0pO1xuICAgIFxuICAgIGlmIChvLmNockJhbmRzICYmIG8uY2hyQmFuZHMubGVuZ3RoID4gMCkge1xuICAgICAgby5jaHJCYW5kcyA9IF8uZmlsdGVyKG8uY2hyQmFuZHMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuICFfLmlzVW5kZWZpbmVkKG8uY2hyTGVuZ3Roc1t2WzBdXSk7IH0pO1xuICAgIH1cbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBDaHJvbVNpemVzRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEZBU1RBIGZvcm1hdDogaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9GQVNUQV9mb3JtYXQgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBlbnN1cmVVbmlxdWUgPSB1dGlscy5lbnN1cmVVbmlxdWU7XG5cbnZhciBGYXN0YUZvcm1hdCA9IHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbSA9IHNlbGYubWV0YWRhdGEsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgICAgXG4gICAgc2VsZi5kYXRhID0ge307XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCkge1xuICAgIHZhciBsaW5lcyA9IHRleHQuc3BsaXQoXCJcXG5cIiksXG4gICAgICBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjaHIgPSBudWxsLFxuICAgICAgdW5uYW1lZENvdW50ZXIgPSAxLFxuICAgICAgY2hyc2VxID0gW107XG4gICAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBbXTtcbiAgICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGkpIHtcbiAgICAgIHZhciBjaHJMaW5lID0gbGluZS5tYXRjaCgvXls+O10oLispLyksXG4gICAgICAgIGNsZWFuZWRMaW5lID0gbGluZS5yZXBsYWNlKC9cXHMrL2csICcnKTtcbiAgICAgIGlmIChjaHJMaW5lKSB7XG4gICAgICAgIGNociA9IGNockxpbmVbMV0ucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpO1xuICAgICAgICBpZiAoIWNoci5sZW5ndGgpIHsgY2hyID0gXCJ1bm5hbWVkQ2hyXCI7IH1cbiAgICAgICAgY2hyID0gZW5zdXJlVW5pcXVlKGNociwgby5jaHJMZW5ndGhzKTtcbiAgICAgICAgby5jaHJPcmRlci5wdXNoKGNocik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLmRhdGEuc2VxdWVuY2UucHVzaChjbGVhbmVkTGluZSk7XG4gICAgICAgIG8uY2hyTGVuZ3Roc1tjaHJdID0gKG8uY2hyTGVuZ3Roc1tjaHJdIHx8IDApICsgY2xlYW5lZExpbmUubGVuZ3RoO1xuICAgICAgICBvLmdlbm9tZVNpemUgKz0gY2xlYW5lZExpbmUubGVuZ3RoO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YS5zZXF1ZW5jZSA9IHNlbGYuZGF0YS5zZXF1ZW5jZS5qb2luKCcnKTtcbiAgICBzZWxmLmNhbkdldFNlcXVlbmNlID0gdHJ1ZTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBGYXN0YUZvcm1hdDsiLCJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gR2VuQmFuayBmb3JtYXQ6IGh0dHA6Ly93d3cubmNiaS5ubG0ubmloLmdvdi9TaXRlbWFwL3NhbXBsZXJlY29yZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgdG9wVGFnc0FzQXJyYXkgPSB1dGlscy50b3BUYWdzQXNBcnJheSxcbiAgc3ViVGFnc0FzQXJyYXkgPSB1dGlscy5zdWJUYWdzQXNBcnJheSxcbiAgZmV0Y2hGaWVsZCA9IHV0aWxzLmZldGNoRmllbGQsXG4gIGdldFRhZyA9IHV0aWxzLmdldFRhZyxcbiAgZW5zdXJlVW5pcXVlID0gdXRpbHMuZW5zdXJlVW5pcXVlO1xuXG52YXIgR2VuQmFua0Zvcm1hdCA9IHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgLy8gTm90ZSB0aGF0IHdlIGNhbGwgR2VuQmFuayBmaWVsZCBuYW1lcyBsaWtlIFwiTE9DVVNcIiwgXCJERUZJTklUSU9OXCIsIGV0Yy4gdGFncyBpbnN0ZWFkIG9mIGtleXMuXG4gICAgLy8gV2UgZG8gdGhpcyBiZWNhdXNlOiAxKSBjZXJ0YWluIGZpZWxkIG5hbWVzIGNhbiBiZSByZXBlYXRlZCAoZS5nLiBSRUZFUkVOQ0UpIHdoaWNoIGlzIG1vcmUgXG4gICAgLy8gZXZvY2F0aXZlIG9mIFwidGFnc1wiIGFzIG9wcG9zZWQgdG8gdGhlIGJlaGF2aW9yIG9mIGtleXMgaW4gYSBoYXNoLiAgQWxzbywgMikgdGhpcyBpcyB0aGVcbiAgICAvLyBub21lbmNsYXR1cmUgcGlja2VkIGJ5IEJpb1J1YnkuXG4gICAgXG4gICAgdGhpcy50YWdTaXplID0gMTI7IC8vIGhvdyB3aWRlIHRoZSBjb2x1bW4gZm9yIHRhZ3MgaXMgaW4gYSBHZW5CYW5rIGZpbGVcbiAgICB0aGlzLmZlYXR1cmVUYWdTaXplID0gMjE7IC8vIGhvdyB3aWRlIHRoZSBjb2x1bW4gZm9yIHRhZ3MgaXMgaW4gdGhlIGZlYXR1cmUgdGFibGUgc2VjdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VlIHNlY3Rpb24gNC4xIG9mIGh0dHA6Ly93d3cuaW5zZGMub3JnL2ZpbGVzL2ZlYXR1cmVfdGFibGUuaHRtbFxuICAgIFxuICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgIGNvbnRpZ3M6IFtdLFxuICAgICAgdHJhY2tMaW5lczoge1xuICAgICAgICBzb3VyY2U6IFtdLFxuICAgICAgICBnZW5lczogW10sXG4gICAgICAgIG90aGVyOiBbXVxuICAgICAgfVxuICAgIH07XG4gIH0sXG4gIFxuICBwYXJzZUxvY3VzOiBmdW5jdGlvbihjb250aWcpIHtcbiAgICB2YXIgbG9jdXNMaW5lID0gY29udGlnLm9yaWcubG9jdXM7XG4gICAgaWYgKGxvY3VzTGluZSkge1xuICAgICAgaWYgKGxvY3VzTGluZS5sZW5ndGggPiA3NSkgeyAvLyBhZnRlciBSZWwgMTI2LjBcbiAgICAgICAgY29udGlnLmVudHJ5SWQgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygxMiwgMjgpKTtcbiAgICAgICAgY29udGlnLmxlbmd0aCAgID0gcGFyc2VJbnQxMChsb2N1c0xpbmUuc3Vic3RyaW5nKDI5LCA0MCkpO1xuICAgICAgICBjb250aWcuc3RyYW5kICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQ0LCA0NykpO1xuICAgICAgICBjb250aWcubmF0eXBlICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQ3LCA1MykpO1xuICAgICAgICBjb250aWcuY2lyY3VsYXIgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDU1LCA2MykpO1xuICAgICAgICBjb250aWcuZGl2aXNpb24gPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDYzLCA2NykpO1xuICAgICAgICBjb250aWcuZGF0ZSAgICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDY4LCA3OSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29udGlnLmVudHJ5SWQgID0gc3RyaXAobG9jdXNMaW5lLnN1YnN0cmluZygxMiwgMjIpKTtcbiAgICAgICAgY29udGlnLmxlbmd0aCAgID0gcGFyc2VJbnQxMChsb2N1c0xpbmUuc3Vic3RyaW5nKDIyLCAzMCkpO1xuICAgICAgICBjb250aWcuc3RyYW5kICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDMzLCAzNikpO1xuICAgICAgICBjb250aWcubmF0eXBlICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDM2LCA0MCkpO1xuICAgICAgICBjb250aWcuY2lyY3VsYXIgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDQyLCA1MikpO1xuICAgICAgICBjb250aWcuZGl2aXNpb24gPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDUyLCA1NSkpO1xuICAgICAgICBjb250aWcuZGF0ZSAgICAgPSBzdHJpcChsb2N1c0xpbmUuc3Vic3RyaW5nKDYyLCA3MykpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlSGVhZGVyRmllbGRzOiBmdW5jdGlvbihjb250aWcpIHtcbiAgICB2YXIgdGFnU2l6ZSA9IHRoaXMudGFnU2l6ZSxcbiAgICAgIGhlYWRlckZpZWxkc1RvUGFyc2UgPSB7XG4gICAgICAgIHNpbXBsZTogWydkZWZpbml0aW9uJywgJ2FjY2Vzc2lvbicsICd2ZXJzaW9uJ10sXG4gICAgICAgIGRlZXA6IFsnc291cmNlJ10gLy8gY291bGQgYWRkIHJlZmVyZW5jZXMsIGJ1dCB3ZSBkb24ndCBjYXJlIGFib3V0IHRob3NlIGhlcmVcbiAgICAgIH07XG4gICAgXG4gICAgLy8gUGFyc2Ugc2ltcGxlIGZpZWxkcyAodGFnIC0tPiBjb250ZW50KVxuICAgIF8uZWFjaChoZWFkZXJGaWVsZHNUb1BhcnNlLnNpbXBsZSwgZnVuY3Rpb24odGFnKSB7XG4gICAgICBpZiAoIWNvbnRpZy5vcmlnW3RhZ10pIHsgY29udGlnW3RhZ10gPSBudWxsOyByZXR1cm47IH1cbiAgICAgIGNvbnRpZ1t0YWddID0gZmV0Y2hGaWVsZChjb250aWcub3JpZ1t0YWddLCB0YWdTaXplKTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBQYXJzZSB0YWdzIHRoYXQgY2FuIHJlcGVhdCBhbmQgaGF2ZSBzdWJ0YWdzXG4gICAgXy5lYWNoKGhlYWRlckZpZWxkc1RvUGFyc2UuZGVlcCwgZnVuY3Rpb24odGFnKSB7XG4gICAgICB2YXIgZGF0YSA9IFtdLFxuICAgICAgICBpdGVtcztcbiAgICAgIGlmICghY29udGlnLm9yaWdbdGFnXSkgeyBjb250aWdbdGFnXSA9IG51bGw7IHJldHVybjsgfVxuICAgICAgXG4gICAgICBpdGVtcyA9IGNvbnRpZy5vcmlnW3RhZ10ucmVwbGFjZSgvXFxuKFtBLVphLXpcXC9cXCpdKS9nLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbiAgICAgIF8uZWFjaChpdGVtcywgZnVuY3Rpb24oaXRlbSkge1xuICAgICAgICB2YXIgc3ViVGFncyA9IHN1YlRhZ3NBc0FycmF5KGl0ZW0sIHRhZ1NpemUpLFxuICAgICAgICAgIGl0ZW1OYW1lID0gZmV0Y2hGaWVsZChzdWJUYWdzLnNoaWZ0KCksIHRhZ1NpemUpLCBcbiAgICAgICAgICBpdGVtRGF0YSA9IHtfbmFtZTogaXRlbU5hbWV9O1xuICAgICAgICBfLmVhY2goc3ViVGFncywgZnVuY3Rpb24oc3ViVGFnRmllbGQpIHtcbiAgICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKHN1YlRhZ0ZpZWxkLCB0YWdTaXplKTtcbiAgICAgICAgICBpdGVtRGF0YVt0YWddID0gZmV0Y2hGaWVsZChzdWJUYWdGaWVsZCwgdGFnU2l6ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLnB1c2goaXRlbURhdGEpO1xuICAgICAgfSk7XG4gICAgICBjb250aWdbdGFnXSA9IGRhdGE7XG4gICAgICBcbiAgICB9KTtcbiAgfSxcbiAgXG4gIHBhcnNlRmVhdHVyZVRhYmxlOiBmdW5jdGlvbihjaHIsIGNvbnRpZ0RhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB0YWdTaXplID0gc2VsZi50YWdTaXplLFxuICAgICAgZmVhdHVyZVRhZ1NpemUgPSBzZWxmLmZlYXR1cmVUYWdTaXplLFxuICAgICAgdGFnc1RvU2tpcCA9IFtcImZlYXR1cmVzXCJdLFxuICAgICAgdGFnc1JlbGF0ZWRUb0dlbmVzID0gW1wiY2RzXCIsIFwiZ2VuZVwiLCBcIm1ybmFcIiwgXCJleG9uXCIsIFwiaW50cm9uXCJdLFxuICAgICAgY29udGlnTGluZSA9IFwiQUNDRVNTSU9OICAgXCIgKyBjaHIgKyBcIlxcblwiO1xuICAgIGlmIChjb250aWdEYXRhLm9yaWcuZmVhdHVyZXMpIHtcbiAgICAgIHZhciBzdWJUYWdzID0gc3ViVGFnc0FzQXJyYXkoY29udGlnRGF0YS5vcmlnLmZlYXR1cmVzLCB0YWdTaXplKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLnNvdXJjZS5wdXNoKGNvbnRpZ0xpbmUpO1xuICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXMuZ2VuZXMucHVzaChjb250aWdMaW5lKTtcbiAgICAgIHNlbGYuZGF0YS50cmFja0xpbmVzLm90aGVyLnB1c2goY29udGlnTGluZSk7XG4gICAgICBfLmVhY2goc3ViVGFncywgZnVuY3Rpb24oc3ViVGFnRmllbGQpIHtcbiAgICAgICAgdmFyIHRhZyA9IGdldFRhZyhzdWJUYWdGaWVsZCwgZmVhdHVyZVRhZ1NpemUpO1xuICAgICAgICBpZiAodGFnc1RvU2tpcC5pbmRleE9mKHRhZykgIT09IC0xKSB7IHJldHVybjsgfVxuICAgICAgICBlbHNlIGlmICh0YWcgPT09IFwic291cmNlXCIpIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMuc291cmNlLnB1c2goc3ViVGFnRmllbGQpOyB9XG4gICAgICAgIGVsc2UgaWYgKHRhZ3NSZWxhdGVkVG9HZW5lcy5pbmRleE9mKHRhZykgIT09IC0xKSB7IHNlbGYuZGF0YS50cmFja0xpbmVzLmdlbmVzLnB1c2goc3ViVGFnRmllbGQpOyAgfVxuICAgICAgICBlbHNlIHsgc2VsZi5kYXRhLnRyYWNrTGluZXMub3RoZXIucHVzaChzdWJUYWdGaWVsZCk7IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlU2VxdWVuY2U6IGZ1bmN0aW9uKGNvbnRpZ0RhdGEpIHtcbiAgICBpZiAoY29udGlnRGF0YS5vcmlnLm9yaWdpbikge1xuICAgICAgcmV0dXJuIGNvbnRpZ0RhdGEub3JpZy5vcmlnaW4ucmVwbGFjZSgvXm9yaWdpbi4qfFxcblsgMC05XXsxMH18IC9pZywgJycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gQXJyYXkoY29udGlnRGF0YS5sZW5ndGgpLmpvaW4oJ24nKTtcbiAgICB9XG4gIH0sXG4gIFxuICBjcmVhdGVUcmFja3NGcm9tRmVhdHVyZXM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBjYXRlZ29yeVR1cGxlcyA9IFtcbiAgICAgICAgW1wic291cmNlXCIsIFwiU291cmNlc1wiLCBcIlJlZ2lvbnMgYW5ub3RhdGVkIGJ5IHNvdXJjZSBvcmdhbmlzbSBvciBzcGVjaW1lblwiXSwgXG4gICAgICAgIFtcImdlbmVzXCIsIFwiR2VuZSBhbm5vdGF0aW9uc1wiLCBcIkNEUyBhbmQgZ2VuZSBmZWF0dXJlc1wiXSwgXG4gICAgICAgIFtcIm90aGVyXCIsIFwiT3RoZXIgYW5ub3RhdGlvbnNcIiwgXCJ0Uk5BcyBhbmQgb3RoZXIgZmVhdHVyZXNcIl1cbiAgICAgIF07XG4gICAgXG4gICAgLy8gRm9yIHRoZSBjYXRlZ29yaWVzIG9mIGZlYXR1cmVzLCBjcmVhdGUgYXBwcm9wcmlhdGUgZW50cmllcyBpbiBvLmF2YWlsVHJhY2tzLCBvLnRyYWNrcywgYW5kIG8udHJhY2tEZXNjXG4gICAgLy8gTGVhdmUgdGhlIGFjdHVhbCBkYXRhIGFzIGFycmF5cyBvZiBsaW5lcyB0aGF0IGFyZSBhdHRhY2hlZCBhcyAuY3VzdG9tRGF0YSB0byBvLmF2YWlsVHJhY2tzXG4gICAgLy8gVGhleSB3aWxsIGJlIHBhcnNlZCBsYXRlciB2aWEgQ3VzdG9tVHJhY2tzLnBhcnNlLlxuICAgIF8uZWFjaChjYXRlZ29yeVR1cGxlcywgZnVuY3Rpb24oY2F0ZWdvcnlUdXBsZSkge1xuICAgICAgdmFyIGNhdGVnb3J5ID0gY2F0ZWdvcnlUdXBsZVswXSxcbiAgICAgICAgbGFiZWwgPSBjYXRlZ29yeVR1cGxlWzFdLFxuICAgICAgICBsb25nTGFiZWwgPSBjYXRlZ29yeVR1cGxlWzJdLFxuICAgICAgICB0cmFja0xpbmVzID0gW107XG4gICAgICBpZiAoc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc2VsZi5kYXRhLnRyYWNrTGluZXNbY2F0ZWdvcnldLnVuc2hpZnQoJ3RyYWNrIHR5cGU9XCJmZWF0dXJlVGFibGVcIiBuYW1lPVwiJyArIGxhYmVsICsgXG4gICAgICAgICAgJ1wiIGNvbGxhcHNlQnlHZW5lPVwiJyArIChjYXRlZ29yeT09XCJnZW5lc1wiID8gJ29uJyA6ICdvZmYnKSArICdcIlxcbicpO1xuICAgICAgfVxuICAgICAgby5hdmFpbFRyYWNrcy5wdXNoKHtcbiAgICAgICAgZmg6IHt9LFxuICAgICAgICBuOiBjYXRlZ29yeSxcbiAgICAgICAgczogWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddLFxuICAgICAgICBoOiAxNSxcbiAgICAgICAgbTogWydwYWNrJ10sXG4gICAgICAgIGN1c3RvbURhdGE6IHNlbGYuZGF0YS50cmFja0xpbmVzW2NhdGVnb3J5XVxuICAgICAgfSk7XG4gICAgICBvLnRyYWNrcy5wdXNoKHtuOiBjYXRlZ29yeX0pO1xuICAgICAgby50cmFja0Rlc2NbY2F0ZWdvcnldID0ge1xuICAgICAgICBjYXQ6IFwiRmVhdHVyZSBUcmFja3NcIixcbiAgICAgICAgc206IGxhYmVsLFxuICAgICAgICBsZzogbG9uZ0xhYmVsXG4gICAgICB9O1xuICAgIH0pO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgY29udGlnRGVsaW1pdGVyID0gXCJcXG4vL1xcblwiLFxuICAgICAgY29udGlncyA9IHRleHQuc3BsaXQoY29udGlnRGVsaW1pdGVyKSxcbiAgICAgIGZpcnN0Q29udGlnID0gbnVsbDtcbiAgICBcbiAgICBzZWxmLmRhdGEuc2VxdWVuY2UgPSBbXTtcbiAgICAgIFxuICAgIF8uZWFjaChjb250aWdzLCBmdW5jdGlvbihjb250aWcpIHtcbiAgICAgIGlmICghc3RyaXAoY29udGlnKS5sZW5ndGgpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgIHZhciBjb250aWdEYXRhID0ge29yaWc6IHt9fSxcbiAgICAgICAgY2hyLCBzaXplLCBjb250aWdTZXF1ZW5jZTtcbiAgICAgIFxuICAgICAgLy8gU3BsaXRzIG9uIGFueSBsaW5lcyB3aXRoIGEgY2hhcmFjdGVyIGluIHRoZSBmaXJzdCBjb2x1bW5cbiAgICAgIF8uZWFjaCh0b3BUYWdzQXNBcnJheShjb250aWcpLCBmdW5jdGlvbihmaWVsZCkge1xuICAgICAgICB2YXIgdGFnID0gZ2V0VGFnKGZpZWxkLCBzZWxmLnRhZ1NpemUpO1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZChjb250aWdEYXRhLm9yaWdbdGFnXSkpIHsgY29udGlnRGF0YS5vcmlnW3RhZ10gPSBmaWVsZDsgfVxuICAgICAgICBlbHNlIHsgY29udGlnRGF0YS5vcmlnW3RhZ10gKz0gZmllbGQ7IH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBzZWxmLmRhdGEuY29udGlncy5wdXNoKGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUxvY3VzKGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUhlYWRlckZpZWxkcyhjb250aWdEYXRhKTtcbiAgICAgIGNvbnRpZ1NlcXVlbmNlID0gc2VsZi5mb3JtYXQoKS5wYXJzZVNlcXVlbmNlKGNvbnRpZ0RhdGEpO1xuICAgICAgXG4gICAgICBjaHIgPSBjb250aWdEYXRhLmFjY2Vzc2lvbiAmJiBjb250aWdEYXRhLmFjY2Vzc2lvbiAhPSAndW5rbm93bicgPyBjb250aWdEYXRhLmFjY2Vzc2lvbiA6IGNvbnRpZ0RhdGEuZW50cnlJZDtcbiAgICAgIGNociA9IGVuc3VyZVVuaXF1ZShjaHIsIG8uY2hyTGVuZ3Rocyk7XG4gICAgICBcbiAgICAgIGlmIChjb250aWdEYXRhLmxlbmd0aCkge1xuICAgICAgICBzaXplID0gY29udGlnRGF0YS5sZW5ndGg7XG4gICAgICAgIGlmIChzaXplICE9IGNvbnRpZ1NlcXVlbmNlLmxlbmd0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNlcXVlbmNlIGRhdGEgZm9yIGNvbnRpZyBcIitjaHIrXCIgZG9lcyBub3QgbWF0Y2ggbGVuZ3RoIFwiK3NpemUrXCJicCBmcm9tIGhlYWRlclwiKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2l6ZSA9IGNvbnRpZ1NlcXVlbmNlLmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgby5jaHJPcmRlci5wdXNoKGNocik7XG4gICAgICBvLmNockxlbmd0aHNbY2hyXSA9IHNpemU7XG4gICAgICBvLmdlbm9tZVNpemUgKz0gc2l6ZTtcbiAgICAgIFxuICAgICAgc2VsZi5mb3JtYXQoKS5wYXJzZUZlYXR1cmVUYWJsZShjaHIsIGNvbnRpZ0RhdGEpO1xuICAgICAgc2VsZi5kYXRhLnNlcXVlbmNlLnB1c2goY29udGlnU2VxdWVuY2UpO1xuICAgICAgXG4gICAgICBmaXJzdENvbnRpZyA9IGZpcnN0Q29udGlnIHx8IGNvbnRpZ0RhdGE7XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhLnNlcXVlbmNlID0gc2VsZi5kYXRhLnNlcXVlbmNlLmpvaW4oJycpO1xuICAgIHNlbGYuY2FuR2V0U2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYuZm9ybWF0KCkuY3JlYXRlVHJhY2tzRnJvbUZlYXR1cmVzKCk7XG4gICAgXG4gICAgby5zcGVjaWVzID0gZmlyc3RDb250aWcuc291cmNlID8gZmlyc3RDb250aWcuc291cmNlWzBdLm9yZ2FuaXNtLnNwbGl0KFwiXFxuXCIpWzBdIDogJ0N1c3RvbSBHZW5vbWUnO1xuICAgIGlmIChmaXJzdENvbnRpZy5kYXRlKSB7IG8uYXNzZW1ibHlEYXRlID0gZmlyc3RDb250aWcuZGF0ZTsgfVxuICB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBHZW5CYW5rRm9ybWF0OyIsInZhciB0cmFja1V0aWxzID0gcmVxdWlyZSgnLi4vLi4vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMnKTtcblxubW9kdWxlLmV4cG9ydHMucGFyc2VJbnQxMCA9IHRyYWNrVXRpbHMucGFyc2VJbnQxMDtcblxubW9kdWxlLmV4cG9ydHMuZGVlcENsb25lID0gZnVuY3Rpb24ob2JqKSB7IHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iaikpOyB9XG5cbm1vZHVsZS5leHBvcnRzLmxvZzEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBNYXRoLmxvZyh2YWwpIC8gTWF0aC5MTjEwOyB9XG5cbnZhciBzdHJpcCA9IG1vZHVsZS5leHBvcnRzLnN0cmlwID0gdHJhY2tVdGlscy5zdHJpcDtcblxubW9kdWxlLmV4cG9ydHMucm91bmRUb1BsYWNlcyA9IGZ1bmN0aW9uKG51bSwgZGVjKSB7IHJldHVybiBNYXRoLnJvdW5kKG51bSAqIE1hdGgucG93KDEwLCBkZWMpKSAvIE1hdGgucG93KDEwLCBkZWMpOyB9XG5cbi8vIFRha2UgYSBndWVzcyBhdCBhIHJlYXNvbmFibGUgaW5pdGlhbCBoZWlnaHQgZm9yIGEgZ2l2ZW4gdHJhY2sgdHlwZVxubW9kdWxlLmV4cG9ydHMudHJhY2tIZWlnaHRGb3JUeXBlID0gZnVuY3Rpb24odHlwZSkge1xuICB0eXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpLnNwbGl0KC9cXHMrLylbMF07XG4gIGlmICh0eXBlID09ICd3aWdnbGVfMCcgfHwgdHlwZSA9PSAnYmlnd2lnJyB8fCB0eXBlID09ICdiZWRncmFwaCcpIHsgcmV0dXJuIDMwOyB9XG4gIGlmICh0eXBlID09ICdiYW0nKSB7IHJldHVybiAxMDA7IH1cbiAgcmV0dXJuIDE1O1xufVxuXG4vKioqKlxuICogVGhlc2UgZnVuY3Rpb25zIGFyZSBjb21tb24gc3Vicm91dGluZXMgZm9yIHBhcnNpbmcgR2VuQmFuayBhbmQgb3RoZXIgZm9ybWF0cyBiYXNlZCBvbiBjb2x1bW4gcG9zaXRpb25zXG4gKioqKi9cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBpbiB0aGUgZmlyc3QgY29sdW1uXG4vLyAoYSBcInRvcCB0YWdcIikgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMudG9wVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCkge1xuICByZXR1cm4gZmllbGQucmVwbGFjZSgvXFxuKFtBLVphLXpcXC9cXCpdKS9nLCBcIlxcblxcMDAxJDFcIikuc3BsaXQoXCJcXDAwMVwiKTtcbn1cblxuLy8gU3BsaXRzIGEgbXVsdGlsaW5lIHN0cmluZyBiZWZvcmUgdGhlIGxpbmVzIHRoYXQgY29udGFpbiBhIGNoYXJhY3RlciBub3QgaW4gdGhlIGZpcnN0IGNvbHVtblxuLy8gYnV0IHdpdGhpbiB0aGUgbmV4dCB0YWdTaXplIGNvbHVtbnMsIHdoaWNoIGlzIGEgXCJzdWIgdGFnXCIgaW4gYSBHZW5CYW5rLXN0eWxlIHRleHQgZmlsZVxubW9kdWxlLmV4cG9ydHMuc3ViVGFnc0FzQXJyYXkgPSBmdW5jdGlvbihmaWVsZCwgdGFnU2l6ZSkge1xuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAyKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgdmFyIHJlID0gbmV3IFJlZ0V4cChcIlxcXFxuKFxcXFxzezEsXCIgKyAodGFnU2l6ZSAtIDEpICsgXCJ9XFxcXFMpXCIsIFwiZ1wiKTtcbiAgcmV0dXJuIGZpZWxkLnJlcGxhY2UocmUsIFwiXFxuXFwwMDEkMVwiKS5zcGxpdChcIlxcMDAxXCIpO1xufVxuXG4vLyBSZXR1cm5zIGEgbmV3IHN0cmluZyB3aXRoIHRoZSBmaXJzdCB0YWdTaXplIGNvbHVtbnMgZnJvbSBmaWVsZCByZW1vdmVkXG5tb2R1bGUuZXhwb3J0cy5mZXRjaEZpZWxkID0gZnVuY3Rpb24oZmllbGQsIHRhZ1NpemUpIHtcbiAgaWYgKCFpc0Zpbml0ZSh0YWdTaXplKSB8fCB0YWdTaXplIDwgMSkgeyB0aHJvdyBcImludmFsaWQgdGFnU2l6ZVwiOyB9XG4gIHZhciByZSA9IG5ldyBSZWdFeHAoXCIoXnxcXFxcbikuezAsXCIgKyB0YWdTaXplICsgXCJ9XCIsIFwiZ1wiKTtcbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnJlcGxhY2UocmUsIFwiJDFcIikpO1xufVxuXG4vLyBHZXRzIGEgdGFnIGZyb20gYSBmaWVsZCBieSB0cmltbWluZyBpdCBvdXQgb2YgdGhlIGZpcnN0IHRhZ1NpemUgY2hhcmFjdGVycyBvZiB0aGUgZmllbGRcbm1vZHVsZS5leHBvcnRzLmdldFRhZyA9IGZ1bmN0aW9uKGZpZWxkLCB0YWdTaXplKSB7IFxuICBpZiAoIWlzRmluaXRlKHRhZ1NpemUpIHx8IHRhZ1NpemUgPCAxKSB7IHRocm93IFwiaW52YWxpZCB0YWdTaXplXCI7IH1cbiAgcmV0dXJuIHN0cmlwKGZpZWxkLnN1YnN0cmluZygwLCB0YWdTaXplKS50b0xvd2VyQ2FzZSgpKTtcbn1cblxuLyoqKipcbiAqIEVuZCBHZW5CYW5rIGFuZCBjb2x1bW4tYmFzZWQgZm9ybWF0IGhlbHBlcnNcbiAqKioqL1xuXG4vLyBHaXZlbiBhIGhhc2ggYW5kIGEgcHJlc3VtcHRpdmUgbmV3IGtleSwgYXBwZW5kcyBhIGNvdW50ZXIgdG8gdGhlIGtleSB1bnRpbCBpdCBpcyBhY3R1YWxseSBhbiB1bnVzZWQga2V5XG5tb2R1bGUuZXhwb3J0cy5lbnN1cmVVbmlxdWUgPSBmdW5jdGlvbihrZXksIGhhc2gpIHtcbiAgdmFyIGkgPSAxLCBrZXlDaGVjayA9IGtleTtcbiAgd2hpbGUgKHR5cGVvZiBoYXNoW2tleUNoZWNrXSAhPSAndW5kZWZpbmVkJykgeyBrZXlDaGVjayA9IGtleSArICdfJyArIGkrKzsgfVxuICByZXR1cm4ga2V5Q2hlY2s7XG59XG5cbi8vIEdpdmVuIGEgaGFzaCB3aXRoIG9wdGlvbiBuYW1lcyBhbmQgdmFsdWVzLCBmb3JtYXRzIGl0IGluIEJFRCB0cmFjayBsaW5lIGZvcm1hdCAoc2ltaWxhciB0byBIVE1MIGVsZW1lbnQgYXR0cmlidXRlcylcbm1vZHVsZS5leHBvcnRzLm9wdHNBc1RyYWNrTGluZSA9IGZ1bmN0aW9uKG9wdGhhc2gpIHtcbiAgcmV0dXJuIF8ubWFwKG9wdGhhc2gsIGZ1bmN0aW9uKHYsIGspIHsgcmV0dXJuIGsgKyAnPVwiJyArIHYudG9TdHJpbmcoKS5yZXBsYWNlKC9cIi9nLCAnJykgKyAnXCInOyB9KS5qb2luKCcgJyk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpe2dsb2JhbC53aW5kb3c9Z2xvYmFsLndpbmRvd3x8Z2xvYmFsO2dsb2JhbC53aW5kb3cuZG9jdW1lbnQ9Z2xvYmFsLndpbmRvdy5kb2N1bWVudHx8e307KGZ1bmN0aW9uKGEsYil7ZnVuY3Rpb24gTigpe3RyeXtyZXR1cm4gbmV3IGEuQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxIVFRQXCIpfWNhdGNoKGIpe319ZnVuY3Rpb24gTSgpe3RyeXtyZXR1cm4gbmV3IGEuWE1MSHR0cFJlcXVlc3R9Y2F0Y2goYil7fX1mdW5jdGlvbiBJKGEsYyl7aWYoYS5kYXRhRmlsdGVyKXtjPWEuZGF0YUZpbHRlcihjLGEuZGF0YVR5cGUpfXZhciBkPWEuZGF0YVR5cGVzLGU9e30sZyxoLGk9ZC5sZW5ndGgsaixrPWRbMF0sbCxtLG4sbyxwO2ZvcihnPTE7ZzxpO2crKyl7aWYoZz09PTEpe2ZvcihoIGluIGEuY29udmVydGVycyl7aWYodHlwZW9mIGg9PT1cInN0cmluZ1wiKXtlW2gudG9Mb3dlckNhc2UoKV09YS5jb252ZXJ0ZXJzW2hdfX19bD1rO2s9ZFtnXTtpZihrPT09XCIqXCIpe2s9bH1lbHNlIGlmKGwhPT1cIipcIiYmbCE9PWspe209bCtcIiBcIitrO249ZVttXXx8ZVtcIiogXCIra107aWYoIW4pe3A9Yjtmb3IobyBpbiBlKXtqPW8uc3BsaXQoXCIgXCIpO2lmKGpbMF09PT1sfHxqWzBdPT09XCIqXCIpe3A9ZVtqWzFdK1wiIFwiK2tdO2lmKHApe289ZVtvXTtpZihvPT09dHJ1ZSl7bj1wfWVsc2UgaWYocD09PXRydWUpe249b31icmVha319fX1pZighKG58fHApKXtmLmVycm9yKFwiTm8gY29udmVyc2lvbiBmcm9tIFwiK20ucmVwbGFjZShcIiBcIixcIiB0byBcIikpfWlmKG4hPT10cnVlKXtjPW4/bihjKTpwKG8oYykpfX19cmV0dXJuIGN9ZnVuY3Rpb24gSChhLGMsZCl7dmFyIGU9YS5jb250ZW50cyxmPWEuZGF0YVR5cGVzLGc9YS5yZXNwb25zZUZpZWxkcyxoLGksaixrO2ZvcihpIGluIGcpe2lmKGkgaW4gZCl7Y1tnW2ldXT1kW2ldfX13aGlsZShmWzBdPT09XCIqXCIpe2Yuc2hpZnQoKTtpZihoPT09Yil7aD1hLm1pbWVUeXBlfHxjLmdldFJlc3BvbnNlSGVhZGVyKFwiY29udGVudC10eXBlXCIpfX1pZihoKXtmb3IoaSBpbiBlKXtpZihlW2ldJiZlW2ldLnRlc3QoaCkpe2YudW5zaGlmdChpKTticmVha319fWlmKGZbMF1pbiBkKXtqPWZbMF19ZWxzZXtmb3IoaSBpbiBkKXtpZighZlswXXx8YS5jb252ZXJ0ZXJzW2krXCIgXCIrZlswXV0pe2o9aTticmVha31pZighayl7az1pfX1qPWp8fGt9aWYoail7aWYoaiE9PWZbMF0pe2YudW5zaGlmdChqKX1yZXR1cm4gZFtqXX19ZnVuY3Rpb24gRyhhLGIsYyxkKXtpZihmLmlzQXJyYXkoYikpe2YuZWFjaChiLGZ1bmN0aW9uKGIsZSl7aWYoY3x8ai50ZXN0KGEpKXtkKGEsZSl9ZWxzZXtHKGErXCJbXCIrKHR5cGVvZiBlPT09XCJvYmplY3RcInx8Zi5pc0FycmF5KGUpP2I6XCJcIikrXCJdXCIsZSxjLGQpfX0pfWVsc2UgaWYoIWMmJmIhPW51bGwmJnR5cGVvZiBiPT09XCJvYmplY3RcIil7Zm9yKHZhciBlIGluIGIpe0coYStcIltcIitlK1wiXVwiLGJbZV0sYyxkKX19ZWxzZXtkKGEsYil9fWZ1bmN0aW9uIEYoYSxjKXt2YXIgZCxlLGc9Zi5hamF4U2V0dGluZ3MuZmxhdE9wdGlvbnN8fHt9O2ZvcihkIGluIGMpe2lmKGNbZF0hPT1iKXsoZ1tkXT9hOmV8fChlPXt9KSlbZF09Y1tkXX19aWYoZSl7Zi5leHRlbmQodHJ1ZSxhLGUpfX1mdW5jdGlvbiBFKGEsYyxkLGUsZixnKXtmPWZ8fGMuZGF0YVR5cGVzWzBdO2c9Z3x8e307Z1tmXT10cnVlO3ZhciBoPWFbZl0saT0wLGo9aD9oLmxlbmd0aDowLGs9YT09PXksbDtmb3IoO2k8aiYmKGt8fCFsKTtpKyspe2w9aFtpXShjLGQsZSk7aWYodHlwZW9mIGw9PT1cInN0cmluZ1wiKXtpZigha3x8Z1tsXSl7bD1ifWVsc2V7Yy5kYXRhVHlwZXMudW5zaGlmdChsKTtsPUUoYSxjLGQsZSxsLGcpfX19aWYoKGt8fCFsKSYmIWdbXCIqXCJdKXtsPUUoYSxjLGQsZSxcIipcIixnKX1yZXR1cm4gbH1mdW5jdGlvbiBEKGEpe3JldHVybiBmdW5jdGlvbihiLGMpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcIil7Yz1iO2I9XCIqXCJ9aWYoZi5pc0Z1bmN0aW9uKGMpKXt2YXIgZD1iLnRvTG93ZXJDYXNlKCkuc3BsaXQodSksZT0wLGc9ZC5sZW5ndGgsaCxpLGo7Zm9yKDtlPGc7ZSsrKXtoPWRbZV07aj0vXlxcKy8udGVzdChoKTtpZihqKXtoPWguc3Vic3RyKDEpfHxcIipcIn1pPWFbaF09YVtoXXx8W107aVtqP1widW5zaGlmdFwiOlwicHVzaFwiXShjKX19fX12YXIgYz1hLmRvY3VtZW50LGQ9YS5uYXZpZ2F0b3IsZT1hLmxvY2F0aW9uO3ZhciBmPWZ1bmN0aW9uKCl7ZnVuY3Rpb24gSigpe2lmKGUuaXNSZWFkeSl7cmV0dXJufXRyeXtjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbChcImxlZnRcIil9Y2F0Y2goYSl7c2V0VGltZW91dChKLDEpO3JldHVybn1lLnJlYWR5KCl9dmFyIGU9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gbmV3IGUuZm4uaW5pdChhLGIsaCl9LGY9YS5qUXVlcnksZz1hLiQsaCxpPS9eKD86W148XSooPFtcXHdcXFddKz4pW14+XSokfCMoW1xcd1xcLV0qKSQpLyxqPS9cXFMvLGs9L15cXHMrLyxsPS9cXHMrJC8sbT0vXFxkLyxuPS9ePChcXHcrKVxccypcXC8/Pig/OjxcXC9cXDE+KT8kLyxvPS9eW1xcXSw6e31cXHNdKiQvLHA9L1xcXFwoPzpbXCJcXFxcXFwvYmZucnRdfHVbMC05YS1mQS1GXXs0fSkvZyxxPS9cIlteXCJcXFxcXFxuXFxyXSpcInx0cnVlfGZhbHNlfG51bGx8LT9cXGQrKD86XFwuXFxkKik/KD86W2VFXVsrXFwtXT9cXGQrKT8vZyxyPS8oPzpefDp8LCkoPzpcXHMqXFxbKSsvZyxzPS8od2Via2l0KVsgXFwvXShbXFx3Ll0rKS8sdD0vKG9wZXJhKSg/Oi4qdmVyc2lvbik/WyBcXC9dKFtcXHcuXSspLyx1PS8obXNpZSkgKFtcXHcuXSspLyx2PS8obW96aWxsYSkoPzouKj8gcnY6KFtcXHcuXSspKT8vLHc9Ly0oW2Etel0pL2lnLHg9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi50b1VwcGVyQ2FzZSgpfSx5PWQudXNlckFnZW50LHosQSxCLEM9T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyxEPU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksRT1BcnJheS5wcm90b3R5cGUucHVzaCxGPUFycmF5LnByb3RvdHlwZS5zbGljZSxHPVN0cmluZy5wcm90b3R5cGUudHJpbSxIPUFycmF5LnByb3RvdHlwZS5pbmRleE9mLEk9e307ZS5mbj1lLnByb3RvdHlwZT17Y29uc3RydWN0b3I6ZSxpbml0OmZ1bmN0aW9uKGEsZCxmKXt2YXIgZyxoLGosaztpZighYSl7cmV0dXJuIHRoaXN9aWYoYS5ub2RlVHlwZSl7dGhpcy5jb250ZXh0PXRoaXNbMF09YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKGE9PT1cImJvZHlcIiYmIWQmJmMuYm9keSl7dGhpcy5jb250ZXh0PWM7dGhpc1swXT1jLmJvZHk7dGhpcy5zZWxlY3Rvcj1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYodHlwZW9mIGE9PT1cInN0cmluZ1wiKXtpZihhLmNoYXJBdCgwKT09PVwiPFwiJiZhLmNoYXJBdChhLmxlbmd0aC0xKT09PVwiPlwiJiZhLmxlbmd0aD49Myl7Zz1bbnVsbCxhLG51bGxdfWVsc2V7Zz1pLmV4ZWMoYSl9aWYoZyYmKGdbMV18fCFkKSl7aWYoZ1sxXSl7ZD1kIGluc3RhbmNlb2YgZT9kWzBdOmQ7az1kP2Qub3duZXJEb2N1bWVudHx8ZDpjO2o9bi5leGVjKGEpO2lmKGope2lmKGUuaXNQbGFpbk9iamVjdChkKSl7YT1bYy5jcmVhdGVFbGVtZW50KGpbMV0pXTtlLmZuLmF0dHIuY2FsbChhLGQsdHJ1ZSl9ZWxzZXthPVtrLmNyZWF0ZUVsZW1lbnQoalsxXSldfX1lbHNle2o9ZS5idWlsZEZyYWdtZW50KFtnWzFdXSxba10pO2E9KGouY2FjaGVhYmxlP2UuY2xvbmUoai5mcmFnbWVudCk6ai5mcmFnbWVudCkuY2hpbGROb2Rlc31yZXR1cm4gZS5tZXJnZSh0aGlzLGEpfWVsc2V7aD1jLmdldEVsZW1lbnRCeUlkKGdbMl0pO2lmKGgmJmgucGFyZW50Tm9kZSl7aWYoaC5pZCE9PWdbMl0pe3JldHVybiBmLmZpbmQoYSl9dGhpcy5sZW5ndGg9MTt0aGlzWzBdPWh9dGhpcy5jb250ZXh0PWM7dGhpcy5zZWxlY3Rvcj1hO3JldHVybiB0aGlzfX1lbHNlIGlmKCFkfHxkLmpxdWVyeSl7cmV0dXJuKGR8fGYpLmZpbmQoYSl9ZWxzZXtyZXR1cm4gdGhpcy5jb25zdHJ1Y3RvcihkKS5maW5kKGEpfX1lbHNlIGlmKGUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGYucmVhZHkoYSl9aWYoYS5zZWxlY3RvciE9PWIpe3RoaXMuc2VsZWN0b3I9YS5zZWxlY3Rvcjt0aGlzLmNvbnRleHQ9YS5jb250ZXh0fXJldHVybiBlLm1ha2VBcnJheShhLHRoaXMpfSxzZWxlY3RvcjpcIlwiLGpxdWVyeTpcIjEuNi4zcHJlXCIsbGVuZ3RoOjAsc2l6ZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLmxlbmd0aH0sdG9BcnJheTpmdW5jdGlvbigpe3JldHVybiBGLmNhbGwodGhpcywwKX0sZ2V0OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP3RoaXMudG9BcnJheSgpOmE8MD90aGlzW3RoaXMubGVuZ3RoK2FdOnRoaXNbYV19LHB1c2hTdGFjazpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9dGhpcy5jb25zdHJ1Y3RvcigpO2lmKGUuaXNBcnJheShhKSl7RS5hcHBseShkLGEpfWVsc2V7ZS5tZXJnZShkLGEpfWQucHJldk9iamVjdD10aGlzO2QuY29udGV4dD10aGlzLmNvbnRleHQ7aWYoYj09PVwiZmluZFwiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrKHRoaXMuc2VsZWN0b3I/XCIgXCI6XCJcIikrY31lbHNlIGlmKGIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcitcIi5cIitiK1wiKFwiK2MrXCIpXCJ9cmV0dXJuIGR9LGVhY2g6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gZS5lYWNoKHRoaXMsYSxiKX0scmVhZHk6ZnVuY3Rpb24oYSl7ZS5iaW5kUmVhZHkoKTtBLmRvbmUoYSk7cmV0dXJuIHRoaXN9LGVxOmZ1bmN0aW9uKGEpe3JldHVybiBhPT09LTE/dGhpcy5zbGljZShhKTp0aGlzLnNsaWNlKGEsK2ErMSl9LGZpcnN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoMCl9LGxhc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgtMSl9LHNsaWNlOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKEYuYXBwbHkodGhpcyxhcmd1bWVudHMpLFwic2xpY2VcIixGLmNhbGwoYXJndW1lbnRzKS5qb2luKFwiLFwiKSl9LG1hcDpmdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soZS5tYXAodGhpcyxmdW5jdGlvbihiLGMpe3JldHVybiBhLmNhbGwoYixjLGIpfSkpfSxlbmQ6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wcmV2T2JqZWN0fHx0aGlzLmNvbnN0cnVjdG9yKG51bGwpfSxwdXNoOkUsc29ydDpbXS5zb3J0LHNwbGljZTpbXS5zcGxpY2V9O2UuZm4uaW5pdC5wcm90b3R5cGU9ZS5mbjtlLmV4dGVuZD1lLmZuLmV4dGVuZD1mdW5jdGlvbigpe3ZhciBhLGMsZCxmLGcsaCxpPWFyZ3VtZW50c1swXXx8e30saj0xLGs9YXJndW1lbnRzLmxlbmd0aCxsPWZhbHNlO2lmKHR5cGVvZiBpPT09XCJib29sZWFuXCIpe2w9aTtpPWFyZ3VtZW50c1sxXXx8e307aj0yfWlmKHR5cGVvZiBpIT09XCJvYmplY3RcIiYmIWUuaXNGdW5jdGlvbihpKSl7aT17fX1pZihrPT09ail7aT10aGlzOy0tan1mb3IoO2o8aztqKyspe2lmKChhPWFyZ3VtZW50c1tqXSkhPW51bGwpe2ZvcihjIGluIGEpe2Q9aVtjXTtmPWFbY107aWYoaT09PWYpe2NvbnRpbnVlfWlmKGwmJmYmJihlLmlzUGxhaW5PYmplY3QoZil8fChnPWUuaXNBcnJheShmKSkpKXtpZihnKXtnPWZhbHNlO2g9ZCYmZS5pc0FycmF5KGQpP2Q6W119ZWxzZXtoPWQmJmUuaXNQbGFpbk9iamVjdChkKT9kOnt9fWlbY109ZS5leHRlbmQobCxoLGYpfWVsc2UgaWYoZiE9PWIpe2lbY109Zn19fX1yZXR1cm4gaX07ZS5leHRlbmQoe25vQ29uZmxpY3Q6ZnVuY3Rpb24oYil7aWYoYS4kPT09ZSl7YS4kPWd9aWYoYiYmYS5qUXVlcnk9PT1lKXthLmpRdWVyeT1mfXJldHVybiBlfSxpc1JlYWR5OmZhbHNlLHJlYWR5V2FpdDoxLGhvbGRSZWFkeTpmdW5jdGlvbihhKXtpZihhKXtlLnJlYWR5V2FpdCsrfWVsc2V7ZS5yZWFkeSh0cnVlKX19LHJlYWR5OmZ1bmN0aW9uKGEpe2lmKGE9PT10cnVlJiYhLS1lLnJlYWR5V2FpdHx8YSE9PXRydWUmJiFlLmlzUmVhZHkpe2lmKCFjLmJvZHkpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9ZS5pc1JlYWR5PXRydWU7aWYoYSE9PXRydWUmJi0tZS5yZWFkeVdhaXQ+MCl7cmV0dXJufUEucmVzb2x2ZVdpdGgoYyxbZV0pO2lmKGUuZm4udHJpZ2dlcil7ZShjKS50cmlnZ2VyKFwicmVhZHlcIikudW5iaW5kKFwicmVhZHlcIil9fX0sYmluZFJlYWR5OmZ1bmN0aW9uKCl7aWYoQSl7cmV0dXJufUE9ZS5fRGVmZXJyZWQoKTtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9aWYoYy5hZGRFdmVudExpc3RlbmVyKXtjLmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7YS5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLGUucmVhZHksZmFsc2UpfWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Yy5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2EuYXR0YWNoRXZlbnQoXCJvbmxvYWRcIixlLnJlYWR5KTt2YXIgYj1mYWxzZTt0cnl7Yj1hLmZyYW1lRWxlbWVudD09bnVsbH1jYXRjaChkKXt9aWYoYy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwmJmIpe0ooKX19fSxpc0Z1bmN0aW9uOmZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImZ1bmN0aW9uXCJ9LGlzQXJyYXk6QXJyYXkuaXNBcnJheXx8ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiYXJyYXlcIn0saXNXaW5kb3c6ZnVuY3Rpb24oYSl7cmV0dXJuIGEmJnR5cGVvZiBhPT09XCJvYmplY3RcIiYmXCJzZXRJbnRlcnZhbFwiaW4gYX0saXNOYU46ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGx8fCFtLnRlc3QoYSl8fGlzTmFOKGEpfSx0eXBlOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1N0cmluZyhhKTpJW0MuY2FsbChhKV18fFwib2JqZWN0XCJ9LGlzUGxhaW5PYmplY3Q6ZnVuY3Rpb24oYSl7aWYoIWF8fGUudHlwZShhKSE9PVwib2JqZWN0XCJ8fGEubm9kZVR5cGV8fGUuaXNXaW5kb3coYSkpe3JldHVybiBmYWxzZX1pZihhLmNvbnN0cnVjdG9yJiYhRC5jYWxsKGEsXCJjb25zdHJ1Y3RvclwiKSYmIUQuY2FsbChhLmNvbnN0cnVjdG9yLnByb3RvdHlwZSxcImlzUHJvdG90eXBlT2ZcIikpe3JldHVybiBmYWxzZX12YXIgYztmb3IoYyBpbiBhKXt9cmV0dXJuIGM9PT1ifHxELmNhbGwoYSxjKX0saXNFbXB0eU9iamVjdDpmdW5jdGlvbihhKXtmb3IodmFyIGIgaW4gYSl7cmV0dXJuIGZhbHNlfXJldHVybiB0cnVlfSxlcnJvcjpmdW5jdGlvbihhKXt0aHJvdyBhfSxwYXJzZUpTT046ZnVuY3Rpb24oYil7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wifHwhYil7cmV0dXJuIG51bGx9Yj1lLnRyaW0oYik7aWYoYS5KU09OJiZhLkpTT04ucGFyc2Upe3JldHVybiBhLkpTT04ucGFyc2UoYil9aWYoby50ZXN0KGIucmVwbGFjZShwLFwiQFwiKS5yZXBsYWNlKHEsXCJdXCIpLnJlcGxhY2UocixcIlwiKSkpe3JldHVybihuZXcgRnVuY3Rpb24oXCJyZXR1cm4gXCIrYikpKCl9ZS5lcnJvcihcIkludmFsaWQgSlNPTjogXCIrYil9LHBhcnNlWE1MOmZ1bmN0aW9uKGMpe3ZhciBkLGY7dHJ5e2lmKGEuRE9NUGFyc2VyKXtmPW5ldyBET01QYXJzZXI7ZD1mLnBhcnNlRnJvbVN0cmluZyhjLFwidGV4dC94bWxcIil9ZWxzZXtkPW5ldyBBY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTERPTVwiKTtkLmFzeW5jPVwiZmFsc2VcIjtkLmxvYWRYTUwoYyl9fWNhdGNoKGcpe2Q9Yn1pZighZHx8IWQuZG9jdW1lbnRFbGVtZW50fHxkLmdldEVsZW1lbnRzQnlUYWdOYW1lKFwicGFyc2VyZXJyb3JcIikubGVuZ3RoKXtlLmVycm9yKFwiSW52YWxpZCBYTUw6IFwiK2MpfXJldHVybiBkfSxub29wOmZ1bmN0aW9uKCl7fSxnbG9iYWxFdmFsOmZ1bmN0aW9uKGIpe2lmKGImJmoudGVzdChiKSl7KGEuZXhlY1NjcmlwdHx8ZnVuY3Rpb24oYil7YVtcImV2YWxcIl0uY2FsbChhLGIpfSkoYil9fSxjYW1lbENhc2U6ZnVuY3Rpb24oYSl7cmV0dXJuIGEucmVwbGFjZSh3LHgpfSxub2RlTmFtZTpmdW5jdGlvbihhLGIpe3JldHVybiBhLm5vZGVOYW1lJiZhLm5vZGVOYW1lLnRvVXBwZXJDYXNlKCk9PT1iLnRvVXBwZXJDYXNlKCl9LGVhY2g6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGc9MCxoPWEubGVuZ3RoLGk9aD09PWJ8fGUuaXNGdW5jdGlvbihhKTtpZihkKXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmFwcGx5KGFbZl0sZCk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5hcHBseShhW2crK10sZCk9PT1mYWxzZSl7YnJlYWt9fX19ZWxzZXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmNhbGwoYVtmXSxmLGFbZl0pPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuY2FsbChhW2ddLGcsYVtnKytdKT09PWZhbHNlKXticmVha319fX1yZXR1cm4gYX0sdHJpbTpHP2Z1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6Ry5jYWxsKGEpfTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOmEudG9TdHJpbmcoKS5yZXBsYWNlKGssXCJcIikucmVwbGFjZShsLFwiXCIpfSxtYWtlQXJyYXk6ZnVuY3Rpb24oYSxiKXt2YXIgYz1ifHxbXTtpZihhIT1udWxsKXt2YXIgZD1lLnR5cGUoYSk7aWYoYS5sZW5ndGg9PW51bGx8fGQ9PT1cInN0cmluZ1wifHxkPT09XCJmdW5jdGlvblwifHxkPT09XCJyZWdleHBcInx8ZS5pc1dpbmRvdyhhKSl7RS5jYWxsKGMsYSl9ZWxzZXtlLm1lcmdlKGMsYSl9fXJldHVybiBjfSxpbkFycmF5OmZ1bmN0aW9uKGEsYil7aWYoSCl7cmV0dXJuIEguY2FsbChiLGEpfWZvcih2YXIgYz0wLGQ9Yi5sZW5ndGg7YzxkO2MrKyl7aWYoYltjXT09PWEpe3JldHVybiBjfX1yZXR1cm4tMX0sbWVyZ2U6ZnVuY3Rpb24oYSxjKXt2YXIgZD1hLmxlbmd0aCxlPTA7aWYodHlwZW9mIGMubGVuZ3RoPT09XCJudW1iZXJcIil7Zm9yKHZhciBmPWMubGVuZ3RoO2U8ZjtlKyspe2FbZCsrXT1jW2VdfX1lbHNle3doaWxlKGNbZV0hPT1iKXthW2QrK109Y1tlKytdfX1hLmxlbmd0aD1kO3JldHVybiBhfSxncmVwOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD1bXSxlO2M9ISFjO2Zvcih2YXIgZj0wLGc9YS5sZW5ndGg7ZjxnO2YrKyl7ZT0hIWIoYVtmXSxmKTtpZihjIT09ZSl7ZC5wdXNoKGFbZl0pfX1yZXR1cm4gZH0sbWFwOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnLGg9W10saT0wLGo9YS5sZW5ndGgsaz1hIGluc3RhbmNlb2YgZXx8aiE9PWImJnR5cGVvZiBqPT09XCJudW1iZXJcIiYmKGo+MCYmYVswXSYmYVtqLTFdfHxqPT09MHx8ZS5pc0FycmF5KGEpKTtpZihrKXtmb3IoO2k8ajtpKyspe2Y9YyhhW2ldLGksZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fWVsc2V7Zm9yKGcgaW4gYSl7Zj1jKGFbZ10sZyxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19cmV0dXJuIGguY29uY2F0LmFwcGx5KFtdLGgpfSxndWlkOjEscHJveHk6ZnVuY3Rpb24oYSxjKXtpZih0eXBlb2YgYz09PVwic3RyaW5nXCIpe3ZhciBkPWFbY107Yz1hO2E9ZH1pZighZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gYn12YXIgZj1GLmNhbGwoYXJndW1lbnRzLDIpLGc9ZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShjLGYuY29uY2F0KEYuY2FsbChhcmd1bWVudHMpKSl9O2cuZ3VpZD1hLmd1aWQ9YS5ndWlkfHxnLmd1aWR8fGUuZ3VpZCsrO3JldHVybiBnfSxhY2Nlc3M6ZnVuY3Rpb24oYSxjLGQsZixnLGgpe3ZhciBpPWEubGVuZ3RoO2lmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Zm9yKHZhciBqIGluIGMpe2UuYWNjZXNzKGEsaixjW2pdLGYsZyxkKX1yZXR1cm4gYX1pZihkIT09Yil7Zj0haCYmZiYmZS5pc0Z1bmN0aW9uKGQpO2Zvcih2YXIgaz0wO2s8aTtrKyspe2coYVtrXSxjLGY/ZC5jYWxsKGFba10sayxnKGFba10sYykpOmQsaCl9cmV0dXJuIGF9cmV0dXJuIGk/ZyhhWzBdLGMpOmJ9LG5vdzpmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfSx1YU1hdGNoOmZ1bmN0aW9uKGEpe2E9YS50b0xvd2VyQ2FzZSgpO3ZhciBiPXMuZXhlYyhhKXx8dC5leGVjKGEpfHx1LmV4ZWMoYSl8fGEuaW5kZXhPZihcImNvbXBhdGlibGVcIik8MCYmdi5leGVjKGEpfHxbXTtyZXR1cm57YnJvd3NlcjpiWzFdfHxcIlwiLHZlcnNpb246YlsyXXx8XCIwXCJ9fSxzdWI6ZnVuY3Rpb24oKXtmdW5jdGlvbiBhKGIsYyl7cmV0dXJuIG5ldyBhLmZuLmluaXQoYixjKX1lLmV4dGVuZCh0cnVlLGEsdGhpcyk7YS5zdXBlcmNsYXNzPXRoaXM7YS5mbj1hLnByb3RvdHlwZT10aGlzKCk7YS5mbi5jb25zdHJ1Y3Rvcj1hO2Euc3ViPXRoaXMuc3ViO2EuZm4uaW5pdD1mdW5jdGlvbiBkKGMsZCl7aWYoZCYmZCBpbnN0YW5jZW9mIGUmJiEoZCBpbnN0YW5jZW9mIGEpKXtkPWEoZCl9cmV0dXJuIGUuZm4uaW5pdC5jYWxsKHRoaXMsYyxkLGIpfTthLmZuLmluaXQucHJvdG90eXBlPWEuZm47dmFyIGI9YShjKTtyZXR1cm4gYX0sYnJvd3Nlcjp7fX0pO2UuZWFjaChcIkJvb2xlYW4gTnVtYmVyIFN0cmluZyBGdW5jdGlvbiBBcnJheSBEYXRlIFJlZ0V4cCBPYmplY3RcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtJW1wiW29iamVjdCBcIitiK1wiXVwiXT1iLnRvTG93ZXJDYXNlKCl9KTt6PWUudWFNYXRjaCh5KTtpZih6LmJyb3dzZXIpe2UuYnJvd3Nlclt6LmJyb3dzZXJdPXRydWU7ZS5icm93c2VyLnZlcnNpb249ei52ZXJzaW9ufWlmKGUuYnJvd3Nlci53ZWJraXQpe2UuYnJvd3Nlci5zYWZhcmk9dHJ1ZX1pZihqLnRlc3QoXCLCoFwiKSl7az0vXltcXHNcXHhBMF0rLztsPS9bXFxzXFx4QTBdKyQvfWg9ZShjKTtpZihjLmFkZEV2ZW50TGlzdGVuZXIpe0I9ZnVuY3Rpb24oKXtjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7ZS5yZWFkeSgpfX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe0I9ZnVuY3Rpb24oKXtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe2MuZGV0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTtlLnJlYWR5KCl9fX1yZXR1cm4gZX0oKTt2YXIgZz1cImRvbmUgZmFpbCBpc1Jlc29sdmVkIGlzUmVqZWN0ZWQgcHJvbWlzZSB0aGVuIGFsd2F5cyBwaXBlXCIuc3BsaXQoXCIgXCIpLGg9W10uc2xpY2U7Zi5leHRlbmQoe19EZWZlcnJlZDpmdW5jdGlvbigpe3ZhciBhPVtdLGIsYyxkLGU9e2RvbmU6ZnVuY3Rpb24oKXtpZighZCl7dmFyIGM9YXJndW1lbnRzLGcsaCxpLGosaztpZihiKXtrPWI7Yj0wfWZvcihnPTAsaD1jLmxlbmd0aDtnPGg7ZysrKXtpPWNbZ107aj1mLnR5cGUoaSk7aWYoaj09PVwiYXJyYXlcIil7ZS5kb25lLmFwcGx5KGUsaSl9ZWxzZSBpZihqPT09XCJmdW5jdGlvblwiKXthLnB1c2goaSl9fWlmKGspe2UucmVzb2x2ZVdpdGgoa1swXSxrWzFdKX19cmV0dXJuIHRoaXN9LHJlc29sdmVXaXRoOmZ1bmN0aW9uKGUsZil7aWYoIWQmJiFiJiYhYyl7Zj1mfHxbXTtjPTE7dHJ5e3doaWxlKGFbMF0pe2Euc2hpZnQoKS5hcHBseShlLGYpfX1maW5hbGx5e2I9W2UsZl07Yz0wfX1yZXR1cm4gdGhpc30scmVzb2x2ZTpmdW5jdGlvbigpe2UucmVzb2x2ZVdpdGgodGhpcyxhcmd1bWVudHMpO3JldHVybiB0aGlzfSxpc1Jlc29sdmVkOmZ1bmN0aW9uKCl7cmV0dXJuISEoY3x8Yil9LGNhbmNlbDpmdW5jdGlvbigpe2Q9MTthPVtdO3JldHVybiB0aGlzfX07cmV0dXJuIGV9LERlZmVycmVkOmZ1bmN0aW9uKGEpe3ZhciBiPWYuX0RlZmVycmVkKCksYz1mLl9EZWZlcnJlZCgpLGQ7Zi5leHRlbmQoYix7dGhlbjpmdW5jdGlvbihhLGMpe2IuZG9uZShhKS5mYWlsKGMpO3JldHVybiB0aGlzfSxhbHdheXM6ZnVuY3Rpb24oKXtyZXR1cm4gYi5kb25lLmFwcGx5KGIsYXJndW1lbnRzKS5mYWlsLmFwcGx5KHRoaXMsYXJndW1lbnRzKX0sZmFpbDpjLmRvbmUscmVqZWN0V2l0aDpjLnJlc29sdmVXaXRoLHJlamVjdDpjLnJlc29sdmUsaXNSZWplY3RlZDpjLmlzUmVzb2x2ZWQscGlwZTpmdW5jdGlvbihhLGMpe3JldHVybiBmLkRlZmVycmVkKGZ1bmN0aW9uKGQpe2YuZWFjaCh7ZG9uZTpbYSxcInJlc29sdmVcIl0sZmFpbDpbYyxcInJlamVjdFwiXX0sZnVuY3Rpb24oYSxjKXt2YXIgZT1jWzBdLGc9Y1sxXSxoO2lmKGYuaXNGdW5jdGlvbihlKSl7YlthXShmdW5jdGlvbigpe2g9ZS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7aWYoaCYmZi5pc0Z1bmN0aW9uKGgucHJvbWlzZSkpe2gucHJvbWlzZSgpLnRoZW4oZC5yZXNvbHZlLGQucmVqZWN0KX1lbHNle2RbZytcIldpdGhcIl0odGhpcz09PWI/ZDp0aGlzLFtoXSl9fSl9ZWxzZXtiW2FdKGRbZ10pfX0pfSkucHJvbWlzZSgpfSxwcm9taXNlOmZ1bmN0aW9uKGEpe2lmKGE9PW51bGwpe2lmKGQpe3JldHVybiBkfWQ9YT17fX12YXIgYz1nLmxlbmd0aDt3aGlsZShjLS0pe2FbZ1tjXV09YltnW2NdXX1yZXR1cm4gYX19KTtiLmRvbmUoYy5jYW5jZWwpLmZhaWwoYi5jYW5jZWwpO2RlbGV0ZSBiLmNhbmNlbDtpZihhKXthLmNhbGwoYixiKX1yZXR1cm4gYn0sd2hlbjpmdW5jdGlvbihhKXtmdW5jdGlvbiBpKGEpe3JldHVybiBmdW5jdGlvbihjKXtiW2FdPWFyZ3VtZW50cy5sZW5ndGg+MT9oLmNhbGwoYXJndW1lbnRzLDApOmM7aWYoIS0tZSl7Zy5yZXNvbHZlV2l0aChnLGguY2FsbChiLDApKX19fXZhciBiPWFyZ3VtZW50cyxjPTAsZD1iLmxlbmd0aCxlPWQsZz1kPD0xJiZhJiZmLmlzRnVuY3Rpb24oYS5wcm9taXNlKT9hOmYuRGVmZXJyZWQoKTtpZihkPjEpe2Zvcig7YzxkO2MrKyl7aWYoYltjXSYmZi5pc0Z1bmN0aW9uKGJbY10ucHJvbWlzZSkpe2JbY10ucHJvbWlzZSgpLnRoZW4oaShjKSxnLnJlamVjdCl9ZWxzZXstLWV9fWlmKCFlKXtnLnJlc29sdmVXaXRoKGcsYil9fWVsc2UgaWYoZyE9PWEpe2cucmVzb2x2ZVdpdGgoZyxkP1thXTpbXSl9cmV0dXJuIGcucHJvbWlzZSgpfX0pO2Yuc3VwcG9ydD1mLnN1cHBvcnR8fHt9O3ZhciBpPS8lMjAvZyxqPS9cXFtcXF0kLyxrPS9cXHI/XFxuL2csbD0vIy4qJC8sbT0vXiguKj8pOlsgXFx0XSooW15cXHJcXG5dKilcXHI/JC9tZyxuPS9eKD86Y29sb3J8ZGF0ZXxkYXRldGltZXxlbWFpbHxoaWRkZW58bW9udGh8bnVtYmVyfHBhc3N3b3JkfHJhbmdlfHNlYXJjaHx0ZWx8dGV4dHx0aW1lfHVybHx3ZWVrKSQvaSxvPS9eKD86YWJvdXR8YXBwfGFwcFxcLXN0b3JhZ2V8LitcXC1leHRlbnNpb258ZmlsZXxyZXN8d2lkZ2V0KTokLyxwPS9eKD86R0VUfEhFQUQpJC8scT0vXlxcL1xcLy8scj0vXFw/LyxzPS88c2NyaXB0XFxiW148XSooPzooPyE8XFwvc2NyaXB0Pik8W148XSopKjxcXC9zY3JpcHQ+L2dpLHQ9L14oPzpzZWxlY3R8dGV4dGFyZWEpL2ksdT0vXFxzKy8sdj0vKFs/Jl0pXz1bXiZdKi8sdz0vXihbXFx3XFwrXFwuXFwtXSs6KSg/OlxcL1xcLyhbXlxcLz8jOl0qKSg/OjooXFxkKykpPyk/Lyx4PWYuZm4ubG9hZCx5PXt9LHo9e30sQSxCO3RyeXtBPWUuaHJlZn1jYXRjaChDKXtBPWMuY3JlYXRlRWxlbWVudChcImFcIik7QS5ocmVmPVwiXCI7QT1BLmhyZWZ9Qj13LmV4ZWMoQS50b0xvd2VyQ2FzZSgpKXx8W107Zi5mbi5leHRlbmQoe2xvYWQ6ZnVuY3Rpb24oYSxjLGQpe2lmKHR5cGVvZiBhIT09XCJzdHJpbmdcIiYmeCl7cmV0dXJuIHguYXBwbHkodGhpcyxhcmd1bWVudHMpfWVsc2UgaWYoIXRoaXMubGVuZ3RoKXtyZXR1cm4gdGhpc312YXIgZT1hLmluZGV4T2YoXCIgXCIpO2lmKGU+PTApe3ZhciBnPWEuc2xpY2UoZSxhLmxlbmd0aCk7YT1hLnNsaWNlKDAsZSl9dmFyIGg9XCJHRVRcIjtpZihjKXtpZihmLmlzRnVuY3Rpb24oYykpe2Q9YztjPWJ9ZWxzZSBpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2M9Zi5wYXJhbShjLGYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsKTtoPVwiUE9TVFwifX12YXIgaT10aGlzO2YuYWpheCh7dXJsOmEsdHlwZTpoLGRhdGFUeXBlOlwiaHRtbFwiLGRhdGE6Yyxjb21wbGV0ZTpmdW5jdGlvbihhLGIsYyl7Yz1hLnJlc3BvbnNlVGV4dDtpZihhLmlzUmVzb2x2ZWQoKSl7YS5kb25lKGZ1bmN0aW9uKGEpe2M9YX0pO2kuaHRtbChnP2YoXCI8ZGl2PlwiKS5hcHBlbmQoYy5yZXBsYWNlKHMsXCJcIikpLmZpbmQoZyk6Yyl9aWYoZCl7aS5lYWNoKGQsW2MsYixhXSl9fX0pO3JldHVybiB0aGlzfSxzZXJpYWxpemU6ZnVuY3Rpb24oKXtyZXR1cm4gZi5wYXJhbSh0aGlzLnNlcmlhbGl6ZUFycmF5KCkpfSxzZXJpYWxpemVBcnJheTpmdW5jdGlvbigpe3JldHVybiB0aGlzLm1hcChmdW5jdGlvbigpe3JldHVybiB0aGlzLmVsZW1lbnRzP2YubWFrZUFycmF5KHRoaXMuZWxlbWVudHMpOnRoaXN9KS5maWx0ZXIoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5uYW1lJiYhdGhpcy5kaXNhYmxlZCYmKHRoaXMuY2hlY2tlZHx8dC50ZXN0KHRoaXMubm9kZU5hbWUpfHxuLnRlc3QodGhpcy50eXBlKSl9KS5tYXAoZnVuY3Rpb24oYSxiKXt2YXIgYz1mKHRoaXMpLnZhbCgpO3JldHVybiBjPT1udWxsP251bGw6Zi5pc0FycmF5KGMpP2YubWFwKGMsZnVuY3Rpb24oYSxjKXtyZXR1cm57bmFtZTpiLm5hbWUsdmFsdWU6YS5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSk6e25hbWU6Yi5uYW1lLHZhbHVlOmMucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pLmdldCgpfX0pO2YuZWFjaChcImFqYXhTdGFydCBhamF4U3RvcCBhamF4Q29tcGxldGUgYWpheEVycm9yIGFqYXhTdWNjZXNzIGFqYXhTZW5kXCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7Zi5mbltiXT1mdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5iaW5kKGIsYSl9fSk7Zi5lYWNoKFtcImdldFwiLFwicG9zdFwiXSxmdW5jdGlvbihhLGMpe2ZbY109ZnVuY3Rpb24oYSxkLGUsZyl7aWYoZi5pc0Z1bmN0aW9uKGQpKXtnPWd8fGU7ZT1kO2Q9Yn1yZXR1cm4gZi5hamF4KHt0eXBlOmMsdXJsOmEsZGF0YTpkLHN1Y2Nlc3M6ZSxkYXRhVHlwZTpnfSl9fSk7Zi5leHRlbmQoe2dldFNjcmlwdDpmdW5jdGlvbihhLGMpe3JldHVybiBmLmdldChhLGIsYyxcInNjcmlwdFwiKX0sZ2V0SlNPTjpmdW5jdGlvbihhLGIsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwianNvblwiKX0sYWpheFNldHVwOmZ1bmN0aW9uKGEsYil7aWYoYil7RihhLGYuYWpheFNldHRpbmdzKX1lbHNle2I9YTthPWYuYWpheFNldHRpbmdzfUYoYSxiKTtyZXR1cm4gYX0sYWpheFNldHRpbmdzOnt1cmw6QSxpc0xvY2FsOm8udGVzdChCWzFdKSxnbG9iYWw6dHJ1ZSx0eXBlOlwiR0VUXCIsY29udGVudFR5cGU6XCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixwcm9jZXNzRGF0YTp0cnVlLGFzeW5jOnRydWUsYWNjZXB0czp7eG1sOlwiYXBwbGljYXRpb24veG1sLCB0ZXh0L3htbFwiLGh0bWw6XCJ0ZXh0L2h0bWxcIix0ZXh0OlwidGV4dC9wbGFpblwiLGpzb246XCJhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L2phdmFzY3JpcHRcIixcIipcIjpcIiovKlwifSxjb250ZW50czp7eG1sOi94bWwvLGh0bWw6L2h0bWwvLGpzb246L2pzb24vfSxyZXNwb25zZUZpZWxkczp7eG1sOlwicmVzcG9uc2VYTUxcIix0ZXh0OlwicmVzcG9uc2VUZXh0XCJ9LGNvbnZlcnRlcnM6e1wiKiB0ZXh0XCI6YS5TdHJpbmcsXCJ0ZXh0IGh0bWxcIjp0cnVlLFwidGV4dCBqc29uXCI6Zi5wYXJzZUpTT04sXCJ0ZXh0IHhtbFwiOmYucGFyc2VYTUx9LGZsYXRPcHRpb25zOntjb250ZXh0OnRydWUsdXJsOnRydWV9fSxhamF4UHJlZmlsdGVyOkQoeSksYWpheFRyYW5zcG9ydDpEKHopLGFqYXg6ZnVuY3Rpb24oYSxjKXtmdW5jdGlvbiBLKGEsYyxsLG0pe2lmKEQ9PT0yKXtyZXR1cm59RD0yO2lmKEEpe2NsZWFyVGltZW91dChBKX14PWI7cz1tfHxcIlwiO0oucmVhZHlTdGF0ZT1hPjA/NDowO3ZhciBuLG8scCxxPWMscj1sP0goZCxKLGwpOmIsdCx1O2lmKGE+PTIwMCYmYTwzMDB8fGE9PT0zMDQpe2lmKGQuaWZNb2RpZmllZCl7aWYodD1KLmdldFJlc3BvbnNlSGVhZGVyKFwiTGFzdC1Nb2RpZmllZFwiKSl7Zi5sYXN0TW9kaWZpZWRba109dH1pZih1PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJFdGFnXCIpKXtmLmV0YWdba109dX19aWYoYT09PTMwNCl7cT1cIm5vdG1vZGlmaWVkXCI7bj10cnVlfWVsc2V7dHJ5e289SShkLHIpO3E9XCJzdWNjZXNzXCI7bj10cnVlfWNhdGNoKHYpe3E9XCJwYXJzZXJlcnJvclwiO3A9dn19fWVsc2V7cD1xO2lmKCFxfHxhKXtxPVwiZXJyb3JcIjtpZihhPDApe2E9MH19fUouc3RhdHVzPWE7Si5zdGF0dXNUZXh0PVwiXCIrKGN8fHEpO2lmKG4pe2gucmVzb2x2ZVdpdGgoZSxbbyxxLEpdKX1lbHNle2gucmVqZWN0V2l0aChlLFtKLHEscF0pfUouc3RhdHVzQ29kZShqKTtqPWI7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFwiKyhuP1wiU3VjY2Vzc1wiOlwiRXJyb3JcIiksW0osZCxuP286cF0pfWkucmVzb2x2ZVdpdGgoZSxbSixxXSk7aWYoRil7Zy50cmlnZ2VyKFwiYWpheENvbXBsZXRlXCIsW0osZF0pO2lmKCEtLWYuYWN0aXZlKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RvcFwiKX19fWlmKHR5cGVvZiBhPT09XCJvYmplY3RcIil7Yz1hO2E9Yn1jPWN8fHt9O3ZhciBkPWYuYWpheFNldHVwKHt9LGMpLGU9ZC5jb250ZXh0fHxkLGc9ZSE9PWQmJihlLm5vZGVUeXBlfHxlIGluc3RhbmNlb2YgZik/ZihlKTpmLmV2ZW50LGg9Zi5EZWZlcnJlZCgpLGk9Zi5fRGVmZXJyZWQoKSxqPWQuc3RhdHVzQ29kZXx8e30sayxuPXt9LG89e30scyx0LHgsQSxDLEQ9MCxGLEcsSj17cmVhZHlTdGF0ZTowLHNldFJlcXVlc3RIZWFkZXI6ZnVuY3Rpb24oYSxiKXtpZighRCl7dmFyIGM9YS50b0xvd2VyQ2FzZSgpO2E9b1tjXT1vW2NdfHxhO25bYV09Yn1yZXR1cm4gdGhpc30sZ2V0QWxsUmVzcG9uc2VIZWFkZXJzOmZ1bmN0aW9uKCl7cmV0dXJuIEQ9PT0yP3M6bnVsbH0sZ2V0UmVzcG9uc2VIZWFkZXI6ZnVuY3Rpb24oYSl7dmFyIGM7aWYoRD09PTIpe2lmKCF0KXt0PXt9O3doaWxlKGM9bS5leGVjKHMpKXt0W2NbMV0udG9Mb3dlckNhc2UoKV09Y1syXX19Yz10W2EudG9Mb3dlckNhc2UoKV19cmV0dXJuIGM9PT1iP251bGw6Y30sb3ZlcnJpZGVNaW1lVHlwZTpmdW5jdGlvbihhKXtpZighRCl7ZC5taW1lVHlwZT1hfXJldHVybiB0aGlzfSxhYm9ydDpmdW5jdGlvbihhKXthPWF8fFwiYWJvcnRcIjtpZih4KXt4LmFib3J0KGEpfUsoMCxhKTtyZXR1cm4gdGhpc319O2gucHJvbWlzZShKKTtKLnN1Y2Nlc3M9Si5kb25lO0ouZXJyb3I9Si5mYWlsO0ouY29tcGxldGU9aS5kb25lO0ouc3RhdHVzQ29kZT1mdW5jdGlvbihhKXtpZihhKXt2YXIgYjtpZihEPDIpe2ZvcihiIGluIGEpe2pbYl09W2pbYl0sYVtiXV19fWVsc2V7Yj1hW0ouc3RhdHVzXTtKLnRoZW4oYixiKX19cmV0dXJuIHRoaXN9O2QudXJsPSgoYXx8ZC51cmwpK1wiXCIpLnJlcGxhY2UobCxcIlwiKS5yZXBsYWNlKHEsQlsxXStcIi8vXCIpO2QuZGF0YVR5cGVzPWYudHJpbShkLmRhdGFUeXBlfHxcIipcIikudG9Mb3dlckNhc2UoKS5zcGxpdCh1KTtpZihkLmNyb3NzRG9tYWluPT1udWxsKXtDPXcuZXhlYyhkLnVybC50b0xvd2VyQ2FzZSgpKTtkLmNyb3NzRG9tYWluPSEhKEMmJihDWzFdIT1CWzFdfHxDWzJdIT1CWzJdfHwoQ1szXXx8KENbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkhPShCWzNdfHwoQlsxXT09PVwiaHR0cDpcIj84MDo0NDMpKSkpfWlmKGQuZGF0YSYmZC5wcm9jZXNzRGF0YSYmdHlwZW9mIGQuZGF0YSE9PVwic3RyaW5nXCIpe2QuZGF0YT1mLnBhcmFtKGQuZGF0YSxkLnRyYWRpdGlvbmFsKX1FKHksZCxjLEopO2lmKEQ9PT0yKXtyZXR1cm4gZmFsc2V9Rj1kLmdsb2JhbDtkLnR5cGU9ZC50eXBlLnRvVXBwZXJDYXNlKCk7ZC5oYXNDb250ZW50PSFwLnRlc3QoZC50eXBlKTtpZihGJiZmLmFjdGl2ZSsrPT09MCl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0YXJ0XCIpfWlmKCFkLmhhc0NvbnRlbnQpe2lmKGQuZGF0YSl7ZC51cmwrPShyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStkLmRhdGE7ZGVsZXRlIGQuZGF0YX1rPWQudXJsO2lmKGQuY2FjaGU9PT1mYWxzZSl7dmFyIEw9Zi5ub3coKSxNPWQudXJsLnJlcGxhY2UodixcIiQxXz1cIitMKTtkLnVybD1NKyhNPT09ZC51cmw/KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK1wiXz1cIitMOlwiXCIpfX1pZihkLmRhdGEmJmQuaGFzQ29udGVudCYmZC5jb250ZW50VHlwZSE9PWZhbHNlfHxjLmNvbnRlbnRUeXBlKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJDb250ZW50LVR5cGVcIixkLmNvbnRlbnRUeXBlKX1pZihkLmlmTW9kaWZpZWQpe2s9a3x8ZC51cmw7aWYoZi5sYXN0TW9kaWZpZWRba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU1vZGlmaWVkLVNpbmNlXCIsZi5sYXN0TW9kaWZpZWRba10pfWlmKGYuZXRhZ1trXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTm9uZS1NYXRjaFwiLGYuZXRhZ1trXSl9fUouc2V0UmVxdWVzdEhlYWRlcihcIkFjY2VwdFwiLGQuZGF0YVR5cGVzWzBdJiZkLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dP2QuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0rKGQuZGF0YVR5cGVzWzBdIT09XCIqXCI/XCIsICovKjsgcT0wLjAxXCI6XCJcIik6ZC5hY2NlcHRzW1wiKlwiXSk7Zm9yKEcgaW4gZC5oZWFkZXJzKXtKLnNldFJlcXVlc3RIZWFkZXIoRyxkLmhlYWRlcnNbR10pfWlmKGQuYmVmb3JlU2VuZCYmKGQuYmVmb3JlU2VuZC5jYWxsKGUsSixkKT09PWZhbHNlfHxEPT09Mikpe0ouYWJvcnQoKTtyZXR1cm4gZmFsc2V9Zm9yKEcgaW57c3VjY2VzczoxLGVycm9yOjEsY29tcGxldGU6MX0pe0pbR10oZFtHXSl9eD1FKHosZCxjLEopO2lmKCF4KXtLKC0xLFwiTm8gVHJhbnNwb3J0XCIpfWVsc2V7Si5yZWFkeVN0YXRlPTE7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFNlbmRcIixbSixkXSl9aWYoZC5hc3luYyYmZC50aW1lb3V0PjApe0E9c2V0VGltZW91dChmdW5jdGlvbigpe0ouYWJvcnQoXCJ0aW1lb3V0XCIpfSxkLnRpbWVvdXQpfXRyeXtEPTE7eC5zZW5kKG4sSyl9Y2F0Y2goTil7aWYoRDwyKXtLKC0xLE4pfWVsc2V7Zi5lcnJvcihOKX19fXJldHVybiBKfSxwYXJhbTpmdW5jdGlvbihhLGMpe3ZhciBkPVtdLGU9ZnVuY3Rpb24oYSxiKXtiPWYuaXNGdW5jdGlvbihiKT9iKCk6YjtkW2QubGVuZ3RoXT1lbmNvZGVVUklDb21wb25lbnQoYSkrXCI9XCIrZW5jb2RlVVJJQ29tcG9uZW50KGIpfTtpZihjPT09Yil7Yz1mLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbH1pZihmLmlzQXJyYXkoYSl8fGEuanF1ZXJ5JiYhZi5pc1BsYWluT2JqZWN0KGEpKXtmLmVhY2goYSxmdW5jdGlvbigpe2UodGhpcy5uYW1lLHRoaXMudmFsdWUpfSl9ZWxzZXtmb3IodmFyIGcgaW4gYSl7RyhnLGFbZ10sYyxlKX19cmV0dXJuIGQuam9pbihcIiZcIikucmVwbGFjZShpLFwiK1wiKX19KTtmLmV4dGVuZCh7YWN0aXZlOjAsbGFzdE1vZGlmaWVkOnt9LGV0YWc6e319KTt2YXIgSj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtmb3IodmFyIGEgaW4gTCl7TFthXSgwLDEpfX06ZmFsc2UsSz0wLEw7Zi5hamF4U2V0dGluZ3MueGhyPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe3JldHVybiF0aGlzLmlzTG9jYWwmJk0oKXx8TigpfTpNOyhmdW5jdGlvbihhKXtmLmV4dGVuZChmLnN1cHBvcnQse2FqYXg6ISFhLGNvcnM6ISFhJiZcIndpdGhDcmVkZW50aWFsc1wiaW4gYX0pfSkoZi5hamF4U2V0dGluZ3MueGhyKCkpO2lmKGYuc3VwcG9ydC5hamF4KXtmLmFqYXhUcmFuc3BvcnQoZnVuY3Rpb24oYyl7aWYoIWMuY3Jvc3NEb21haW58fGYuc3VwcG9ydC5jb3JzKXt2YXIgZDtyZXR1cm57c2VuZDpmdW5jdGlvbihlLGcpe3ZhciBoPWMueGhyKCksaSxqO2lmKGMudXNlcm5hbWUpe2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyxjLnVzZXJuYW1lLGMucGFzc3dvcmQpfWVsc2V7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jKX1pZihjLnhockZpZWxkcyl7Zm9yKGogaW4gYy54aHJGaWVsZHMpe2hbal09Yy54aHJGaWVsZHNbal19fWlmKGMubWltZVR5cGUmJmgub3ZlcnJpZGVNaW1lVHlwZSl7aC5vdmVycmlkZU1pbWVUeXBlKGMubWltZVR5cGUpfWlmKCFjLmNyb3NzRG9tYWluJiYhZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl0pe2VbXCJYLVJlcXVlc3RlZC1XaXRoXCJdPVwiWE1MSHR0cFJlcXVlc3RcIn10cnl7Zm9yKGogaW4gZSl7aC5zZXRSZXF1ZXN0SGVhZGVyKGosZVtqXSl9fWNhdGNoKGspe31oLnNlbmQoYy5oYXNDb250ZW50JiZjLmRhdGF8fG51bGwpO2Q9ZnVuY3Rpb24oYSxlKXt2YXIgaixrLGwsbSxuO3RyeXtpZihkJiYoZXx8aC5yZWFkeVN0YXRlPT09NCkpe2Q9YjtpZihpKXtoLm9ucmVhZHlzdGF0ZWNoYW5nZT1mLm5vb3A7aWYoSil7ZGVsZXRlIExbaV19fWlmKGUpe2lmKGgucmVhZHlTdGF0ZSE9PTQpe2guYWJvcnQoKX19ZWxzZXtqPWguc3RhdHVzO2w9aC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKTttPXt9O249aC5yZXNwb25zZVhNTDtpZihuJiZuLmRvY3VtZW50RWxlbWVudCl7bS54bWw9bn1tLnRleHQ9aC5yZXNwb25zZVRleHQ7dHJ5e2s9aC5zdGF0dXNUZXh0fWNhdGNoKG8pe2s9XCJcIn1pZighaiYmYy5pc0xvY2FsJiYhYy5jcm9zc0RvbWFpbil7aj1tLnRleHQ/MjAwOjQwNH1lbHNlIGlmKGo9PT0xMjIzKXtqPTIwNH19fX1jYXRjaChwKXtpZighZSl7ZygtMSxwKX19aWYobSl7ZyhqLGssbSxsKX19O2lmKCFjLmFzeW5jfHxoLnJlYWR5U3RhdGU9PT00KXtkKCl9ZWxzZXtpPSsrSztpZihKKXtpZighTCl7TD17fTtmKGEpLnVubG9hZChKKX1MW2ldPWR9aC5vbnJlYWR5c3RhdGVjaGFuZ2U9ZH19LGFib3J0OmZ1bmN0aW9uKCl7aWYoZCl7ZCgwLDEpfX19fX0pfWYuYWpheFNldHRpbmdzLmdsb2JhbD1mYWxzZTthLmpRdWVyeT1hLiQ9Zn0pKGdsb2JhbCl9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQkFNIGZvcm1hdDogaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIGRlZXBDbG9uZSA9IHV0aWxzLmRlZXBDbG9uZTtcbnZhciBQYWlyZWRJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL1BhaXJlZEludGVydmFsVHJlZS5qcycpLlBhaXJlZEludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxudmFyIEJhbUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjaHJvbW9zb21lczogJycsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3I6ICcxODgsMTg4LDE4OCcsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHZpZXdMaW1pdHM6ICcnLCAgLy8gYW5hbG9nb3VzIHRvIHZpZXdMaW1pdHMgaW4gd2lnZ2xlXzAsIGFwcGxpY2FibGUgaGVyZSB0byB0aGUgY292ZXJhZ2Ugc3VidHJhY2tcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogMjAwMCwgcGFjazogMjAwMH0sXG4gICAgY292SGVpZ2h0OiB7ZGVuc2U6IDI0LCBzcXVpc2g6IDM4LCBwYWNrOiAzOH0sXG4gICAgLy8gSWYgYSBudWNsZW90aWRlIGRpZmZlcnMgZnJvbSB0aGUgcmVmZXJlbmNlIHNlcXVlbmNlIGluIGdyZWF0ZXIgdGhhbiAyMCUgb2YgcXVhbGl0eSB3ZWlnaHRlZCByZWFkcywgXG4gICAgLy8gSUdWIGNvbG9ycyB0aGUgYmFyIGluIHByb3BvcnRpb24gdG8gdGhlIHJlYWQgY291bnQgb2YgZWFjaCBiYXNlOyB0aGUgZm9sbG93aW5nIGNoYW5nZXMgdGhhdCB0aHJlc2hvbGQgZm9yIGNocm9tb3pvb21cbiAgICBhbGxlbGVGcmVxVGhyZXNob2xkOiAwLjIsXG4gICAgLy8gRGF0YSBmb3IgaG93IG1hbnkgbnRzIHNob3VsZCBiZSBmZXRjaGVkIGluIG9uZSBnbz9cbiAgICBvcHRpbWFsRmV0Y2hXaW5kb3c6IDAsXG4gICAgLy8gQWJvdmUgd2hhdCB0aWxlIHdpZHRoIChpbiBudHMpIGRvIHdlIGF2b2lkIGZldGNoaW5nIGRhdGEgYWx0b2dldGhlcj9cbiAgICBtYXhGZXRjaFdpbmRvdzogMCxcbiAgICAvLyBUaGUgZm9sbG93aW5nIGNhbiBiZSBcImVuc2VtYmxfdWNzY1wiIG9yIFwidWNzY19lbnNlbWJsXCIgdG8gYXR0ZW1wdCBhdXRvLWNyb3NzbWFwcGluZyBvZiByZWZlcmVuY2UgY29udGlnIG5hbWVzXG4gICAgLy8gYmV0d2VlbiB0aGUgdHdvIHNjaGVtZXMsIHdoaWNoIElHViBkb2VzLCBidXQgaXMgYSBwZXJlbm5pYWwgaXNzdWU6IGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEwMDYyL1xuICAgIC8vIEkgaG9wZSBub3QgdG8gbmVlZCBhbGwgdGhlIG1hcHBpbmdzIGluIGhlcmUgaHR0cHM6Ly9naXRodWIuY29tL2Rwcnlhbjc5L0Nocm9tb3NvbWVNYXBwaW5ncyBidXQgaXQgbWF5IGJlIG5lY2Vzc2FyeVxuICAgIGNvbnZlcnRDaHJTY2hlbWU6IFwiYXV0b1wiLFxuICAgIC8vIERyYXcgcGFpcmVkIGVuZHMgd2l0aGluIGEgcmFuZ2Ugb2YgZXhwZWN0ZWQgaW5zZXJ0IHNpemVzIGFzIGEgY29udGludW91cyBmZWF0dXJlP1xuICAgIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjcGFpcmVkIGZvciBob3cgdGhpcyB3b3Jrc1xuICAgIHZpZXdBc1BhaXJzOiBmYWxzZSxcbiAgICBleHBlY3RlZEluc2VydFNpemVQZXJjZW50aWxlczogWzAuMDA1LCAwLjk5NV1cbiAgfSxcbiAgXG4gIC8vIFRoZSBGTEFHIGNvbHVtbiBmb3IgQkFNL1NBTSBpcyBhIGNvbWJpbmF0aW9uIG9mIGJpdHdpc2UgZmxhZ3NcbiAgZmxhZ3M6IHtcbiAgICBpc1JlYWRQYWlyZWQ6IDB4MSxcbiAgICBpc1JlYWRQcm9wZXJseUFsaWduZWQ6IDB4MixcbiAgICBpc1JlYWRVbm1hcHBlZDogMHg0LFxuICAgIGlzTWF0ZVVubWFwcGVkOiAweDgsXG4gICAgcmVhZFN0cmFuZFJldmVyc2U6IDB4MTAsXG4gICAgbWF0ZVN0cmFuZFJldmVyc2U6IDB4MjAsXG4gICAgaXNSZWFkRmlyc3RPZlBhaXI6IDB4NDAsXG4gICAgaXNSZWFkTGFzdE9mUGFpcjogMHg4MCxcbiAgICBpc1NlY29uZGFyeUFsaWdubWVudDogMHgxMDAsXG4gICAgaXNSZWFkRmFpbGluZ1ZlbmRvclFDOiAweDIwMCxcbiAgICBpc0R1cGxpY2F0ZVJlYWQ6IDB4NDAwLFxuICAgIGlzU3VwcGxlbWVudGFyeUFsaWdubWVudDogMHg4MDBcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYnJvd3NlckNocnMgPSBfLmtleXModGhpcy5icm93c2VyT3B0cyk7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBCQU0gdHJhY2sgYXQgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5icm93c2VyQ2hyU2NoZW1lID0gdGhpcy50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzLmNoclBvcykpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIG8udmlld0FzUGFpcnMgPSB0aGlzLmlzT24oby52aWV3QXNQYWlycyk7XG4gICAgaWYgKCFfLmlzQXJyYXkoby52aWV3TGltaXRzKSkge1xuICAgICAgby52aWV3TGltaXRzID0gXy5tYXAoby52aWV3TGltaXRzLnNwbGl0KCc6JyksIHBhcnNlRmxvYXQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIFRPRE86IElmIHRoZSBwYWlyaW5nIGludGVydmFsIGNoYW5nZWQsIHdlIHNob3VsZCB0b3NzIHRoZSBlbnRpcmUgY2FjaGUgYW5kIHJlc2V0IHRoZSBSZW1vdGVUcmFjayBiaW5zLFxuICAvLyAgICAgICAgICphbmQqIGJsb3cgdXAgdGhlIGFyZWFJbmRleC5cbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gdGhpcy5vcHRzO1xuICAgIC8vIFdoZW4gd2UgY2hhbmdlIG9wdHMudmlld0FzUGFpcnMsIHdlICpuZWVkKiB0byB0aHJvdyBvdXQgdGhpcy5kYXRhLnBpbGV1cC5cbiAgICBpZiAoby52aWV3QXNQYWlycyAhPSB0aGlzLnByZXZPcHRzLnZpZXdBc1BhaXJzICYmIHRoaXMuZGF0YSAmJiB0aGlzLmRhdGEucGlsZXVwKSB7IFxuICAgICAgdGhpcy5kYXRhLnBpbGV1cCA9IHt9O1xuICAgIH1cbiAgICB0aGlzLmRyYXdSYW5nZSA9IG8uYXV0b1NjYWxlIHx8IG8udmlld0xpbWl0cy5sZW5ndGggPCAyID8gdGhpcy5jb3ZlcmFnZVJhbmdlIDogby52aWV3TGltaXRzO1xuICAgIHRoaXMuc2NhbGVzID0gXy5tYXBPYmplY3Qoe2RlbnNlOiAwLCBzcXVpc2g6IDAsIHBhY2s6IDB9LCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICByZXR1cm4gW3tsaW1pdHM6IHNlbGYuZHJhd1JhbmdlLCBzcGVjaWFsVGlja3M6IFtNYXRoLnJvdW5kKHNlbGYuZHJhd1JhbmdlWzFdIC8gMildLCB0b3A6IDAsIGhlaWdodDogby5jb3ZIZWlnaHRba10gfHwgMjR9XTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBFbnN1cmVzIHRoYXQgb3B0aW9ucyBhbmQgZGVyaXZlZCBwcm9wZXJ0aWVzIHNldCBieSB0aGUgYWJvdmUgYXJlIGVxdWFsIGFjcm9zcyBXZWIgV29ya2VyIGFuZCBET00gY29udGV4dHNcbiAgICB0aGlzLnN5bmNQcm9wcyhbJ29wdHMnLCAnZHJhd1JhbmdlJywgJ2NvdmVyYWdlUmFuZ2UnLCAnc2NhbGVzJ10pO1xuICAgIFxuICAgIHRoaXMucHJldk9wdHMgPSBkZWVwQ2xvbmUodGhpcy5vcHRzKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSwgXG4gICAgICAgICAge3N0YXJ0S2V5OiAndGVtcGxhdGVTdGFydCcsIGVuZEtleTogJ3RlbXBsYXRlRW5kJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbicsIHBhaXJpbmdLZXk6ICdxbmFtZSd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiYW0ucGhwJyxcbiAgICAgIGluZm9DaHJSYW5nZSA9IHNlbGYuY2hyUmFuZ2UoTWF0aC5yb3VuZChzZWxmLmJyb3dzZXJPcHRzLnBvcyksIE1hdGgucm91bmQoc2VsZi5icm93c2VyT3B0cy5wb3MgKyAxMDAwMCkpLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lID09IFwiYXV0b1wiID8gc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA6IG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL15jaHIvLCAnJyk7IH0pOyBicmVhaztcbiAgICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eKFxcZFxcZD98WCk6LywgJ2NociQxOicpOyB9KTsgYnJlYWs7XG4gICAgICB9XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBQYXJzZSB0aGUgU0FNIGZvcm1hdCBpbnRvIGludGVydmFscyB0aGF0IGNhbiBiZSBpbnNlcnRlZCBpbnRvIHRoZSBJbnRlcnZhbFRyZWUgY2FjaGVcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7IH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlLCBwaWxldXA6IHt9LCBpbmZvOiB7fX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAyNCwgc3RhcnQ6IDI0fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBzZWxmLm5vQXJlYUxhYmVscyA9IHRydWU7XG4gICAgc2VsZi5leHBlY3RzU2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3MgPSB7fTtcbiAgICBzZWxmLmNvdmVyYWdlUmFuZ2UgPSBbMCwgMF07XG4gICAgc2VsZi5wcmV2T3B0cyA9IGRlZXBDbG9uZShvKTsgIC8vIHVzZWQgdG8gZGV0ZWN0IHdoaWNoIGRyYXdpbmcgb3B0aW9ucyBoYXZlIGJlZW4gY2hhbmdlZCBieSB0aGUgdXNlclxuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJhbSAoZS5nLiBgc2FtdG9vbHMgaWR4c3RhdHNgKSwgdXNlIG1hcHBlZCByZWFkcyBwZXIgcmVmZXJlbmNlIHNlcXVlbmNlXG4gICAgLy8gdG8gZXN0aW1hdGUgbWF4RmV0Y2hXaW5kb3cgYW5kIG9wdGltYWxGZXRjaFdpbmRvdywgYW5kIHNldHVwIGJpbm5pbmcgb24gdGhlIFJlbW90ZVRyYWNrLlxuICAgIC8vIFdlIGFsc28gZmV0Y2ggYSBidW5jaCBvZiByZWFkcyBmcm9tIGFyb3VuZCBpbmZvQ2hyUmFuZ2UgKGJ5IGRlZmF1bHQsIHdoZXJlIHRoZSBicm93c2VyIGlzIHdoZW5cbiAgICAvLyBpdCBmaXJzdCBsb2FkcyB0aGlzIHRyYWNrKSB0byBlc3RpbWF0ZSBtZWFuSXRlbUxlbmd0aCwgbWF0ZSBwYWlyaW5nLCBhbmQgdGhlIGluc2VydCBzaXplIGRpc3RyaWJ1dGlvbi5cbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YToge2luZm86IDEsIHJhbmdlOiBpbmZvQ2hyUmFuZ2UsIHVybDogby5iaWdEYXRhVXJsfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIG1hcHBlZFJlYWRzID0gMCxcbiAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKG8uZHJhd0xpbWl0KSksXG4gICAgICAgICAgYmFtQ2hycyA9IFtdLFxuICAgICAgICAgIGluZm9QYXJ0cyA9IGRhdGEuc3BsaXQoXCJcXG5cXG5cIiksXG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMgPSBbXSxcbiAgICAgICAgICBwY3RpbGVzID0gby5leHBlY3RlZEluc2VydFNpemVQZXJjZW50aWxlcyxcbiAgICAgICAgICBsb3dlckJvdW5kID0gMTAsIFxuICAgICAgICAgIHVwcGVyQm91bmQgPSA1MDAwLCBcbiAgICAgICAgICBzYW1wbGVJbnRlcnZhbHMsIG1lYW5JdGVtTGVuZ3RoLCBoYXNBTWF0ZVBhaXIsIGNoclNjaGVtZSwgbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW5mb1BhcnRzWzBdID09ICcnKSB7IHRocm93IG5ldyBFcnJvcihcInNhbXRvb2xzIGZhaWxlZCB0byByZXRyaWV2ZSBkYXRhIGZvciB0aGlzIEJBTSB0cmFjay5cIik7IH1cbiAgICAgICAgXy5lYWNoKGluZm9QYXJ0c1swXS5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgICAgICAgcmVhZHNNYXBwZWRUb0NvbnRpZyA9IHBhcnNlSW50KGZpZWxkc1syXSwgMTApO1xuICAgICAgICAgIGlmIChmaWVsZHMubGVuZ3RoID09IDEgJiYgZmllbGRzWzBdID09ICcnKSB7IHJldHVybjsgfSAvLyBibGFuayBsaW5lXG4gICAgICAgICAgYmFtQ2hycy5wdXNoKGZpZWxkc1swXSk7XG4gICAgICAgICAgaWYgKF8uaXNOYU4ocmVhZHNNYXBwZWRUb0NvbnRpZykpIHsgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBvdXRwdXQgZm9yIHNhbXRvb2xzIGlkeHN0YXRzIG9uIHRoaXMgQkFNIHRyYWNrLlwiKTsgfVxuICAgICAgICAgIG1hcHBlZFJlYWRzICs9IHJlYWRzTWFwcGVkVG9Db250aWc7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8uY2hyU2NoZW1lID0gY2hyU2NoZW1lID0gc2VsZi50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKGJhbUNocnMpO1xuICAgICAgICBpZiAoY2hyU2NoZW1lICYmIHNlbGYuYnJvd3NlckNoclNjaGVtZSkge1xuICAgICAgICAgIHNlbGYuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgPSBjaHJTY2hlbWUgIT0gc2VsZi5icm93c2VyQ2hyU2NoZW1lID8gY2hyU2NoZW1lICsgJ18nICsgc2VsZi5icm93c2VyQ2hyU2NoZW1lIDogbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgc2FtcGxlSW50ZXJ2YWxzID0gXy5jb21wYWN0KF8ubWFwKGluZm9QYXJ0c1sxXS5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIHJldHVybiBzZWxmLnR5cGUoJ2JhbScpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGxpbmUpO1xuICAgICAgICB9KSk7XG4gICAgICAgIGlmIChzYW1wbGVJbnRlcnZhbHMubGVuZ3RoKSB7XG4gICAgICAgICAgbWVhbkl0ZW1MZW5ndGggPSBfLnJlZHVjZShzYW1wbGVJbnRlcnZhbHMsIGZ1bmN0aW9uKG1lbW8sIG5leHQpIHsgcmV0dXJuIG1lbW8gKyAobmV4dC5lbmQgLSBuZXh0LnN0YXJ0KTsgfSwgMCk7XG4gICAgICAgICAgbWVhbkl0ZW1MZW5ndGggPSBNYXRoLnJvdW5kKG1lYW5JdGVtTGVuZ3RoIC8gc2FtcGxlSW50ZXJ2YWxzLmxlbmd0aCk7XG4gICAgICAgICAgaGFzQU1hdGVQYWlyID0gXy5zb21lKHNhbXBsZUludGVydmFscywgZnVuY3Rpb24oaXR2bCkgeyBcbiAgICAgICAgICAgIHJldHVybiBpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyIHx8IGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcjtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBlc3RpbWF0ZWRJbnNlcnRTaXplcyA9IF8uY29tcGFjdChfLm1hcChzYW1wbGVJbnRlcnZhbHMsIGZ1bmN0aW9uKGl0dmwpIHsgXG4gICAgICAgICAgICByZXR1cm4gaXR2bC50bGVuID8gTWF0aC5hYnMoaXR2bC50bGVuKSA6IDA7IFxuICAgICAgICAgIH0pKTtcbiAgICAgICAgICBlc3RpbWF0ZWRJbnNlcnRTaXplcy5zb3J0KGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEgLSBiOyB9KTsgIC8vIE5PVEU6IEphdmFTY3JpcHQgZG9lcyBzdHJpbmcgc29ydGluZyBieSBkZWZhdWx0IC1fLVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBzZWxmLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCA9IG1lYW5JdGVtc1BlckJwID0gbWFwcGVkUmVhZHMgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemU7XG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoID0gbWVhbkl0ZW1MZW5ndGggPSBfLmlzVW5kZWZpbmVkKG1lYW5JdGVtTGVuZ3RoKSA/IDEwMCA6IG1lYW5JdGVtTGVuZ3RoO1xuICAgICAgICBpZiAoIW8ub3B0aW1hbEZldGNoV2luZG93IHx8ICFvLm1heEZldGNoV2luZG93KSB7XG4gICAgICAgICAgby5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnAgLyAoTWF0aC5tYXgobWVhbkl0ZW1MZW5ndGgsIDEwMCkgLyAxMDApICogMC41KTtcbiAgICAgICAgICBvLm1heEZldGNoV2luZG93ID0gby5vcHRpbWFsRmV0Y2hXaW5kb3cgKiAyO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc2VsZi5jb3ZlcmFnZVJhbmdlWzFdKSB7IHNlbGYuY292ZXJhZ2VSYW5nZVsxXSA9IE1hdGguY2VpbChtZWFuSXRlbXNQZXJCcCAqIG1lYW5JdGVtTGVuZ3RoICogMik7IH1cbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5hcHBseU9wdHMuY2FsbChzZWxmKTtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIHRoZXJlIGlzIHBhaXJpbmcsIHdlIG5lZWQgdG8gdGVsbCB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIHdoYXQgcmFuZ2Ugb2YgaW5zZXJ0IHNpemVzIHNob3VsZCB0cmlnZ2VyIHBhaXJpbmcuXG4gICAgICAgIGlmIChoYXNBTWF0ZVBhaXIpIHtcbiAgICAgICAgICBpZiAoZXN0aW1hdGVkSW5zZXJ0U2l6ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsb3dlckJvdW5kID0gZXN0aW1hdGVkSW5zZXJ0U2l6ZXNbTWF0aC5mbG9vcihlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGggKiBwY3RpbGVzWzBdKV07XG4gICAgICAgICAgICB1cHBlckJvdW5kID0gZXN0aW1hdGVkSW5zZXJ0U2l6ZXNbTWF0aC5mbG9vcihlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGggKiBwY3RpbGVzWzFdKV07XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlbGYuZGF0YS5jYWNoZS5zZXRQYWlyaW5nSW50ZXJ2YWwobG93ZXJCb3VuZCwgdXBwZXJCb3VuZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gSWYgd2UgZG9uJ3Qgc2VlIGFueSBwYWlyZWQgcmVhZHMgaW4gdGhpcyBCQU0sIGRlYWN0aXZhdGUgdGhlIHBhaXJpbmcgZnVuY3Rpb25hbGl0eSBvZiB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIFxuICAgICAgICAgIHNlbGYuZGF0YS5jYWNoZS5kaXNhYmxlUGFpcmluZygpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBvLm9wdGltYWxGZXRjaFdpbmRvdywgby5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuZmxhZ3NbLi4uXSB0byBhIGh1bWFuIGludGVycHJldGFibGUgdmVyc2lvbiBvZiBmZWF0dXJlLmZsYWcgKGV4cGFuZGluZyB0aGUgYml0d2lzZSBmbGFncylcbiAgcGFyc2VGbGFnczogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7XG4gICAgZmVhdHVyZS5mbGFncyA9IHt9O1xuICAgIF8uZWFjaCh0aGlzLnR5cGUoJ2JhbScpLmZsYWdzLCBmdW5jdGlvbihiaXQsIGZsYWcpIHtcbiAgICAgIGZlYXR1cmUuZmxhZ3NbZmxhZ10gPSAhIShmZWF0dXJlLmZsYWcgJiBiaXQpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmJsb2NrcyBhbmQgZmVhdHVyZS5lbmQgYmFzZWQgb24gZmVhdHVyZS5jaWdhclxuICAvLyBTZWUgc2VjdGlvbiAxLjQgb2YgaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiBmb3IgYW4gZXhwbGFuYXRpb24gb2YgQ0lHQVIgXG4gIHBhcnNlQ2lnYXI6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykgeyAgICAgICAgXG4gICAgdmFyIGNpZ2FyID0gZmVhdHVyZS5jaWdhcixcbiAgICAgIHNlcSA9ICghZmVhdHVyZS5zZXEgfHwgZmVhdHVyZS5zZXEgPT0gJyonKSA/IFwiXCIgOiBmZWF0dXJlLnNlcSxcbiAgICAgIHJlZkxlbiA9IDAsXG4gICAgICBzZXFQb3MgPSAwLFxuICAgICAgb3BlcmF0aW9ucywgbGVuZ3RocztcbiAgICBcbiAgICBmZWF0dXJlLmJsb2NrcyA9IFtdO1xuICAgIGZlYXR1cmUuaW5zZXJ0aW9ucyA9IFtdO1xuICAgIFxuICAgIG9wcyA9IGNpZ2FyLnNwbGl0KC9cXGQrLykuc2xpY2UoMSk7XG4gICAgbGVuZ3RocyA9IGNpZ2FyLnNwbGl0KC9bQS1aPV0vKS5zbGljZSgwLCAtMSk7XG4gICAgaWYgKG9wcy5sZW5ndGggIT0gbGVuZ3Rocy5sZW5ndGgpIHsgdGhpcy53YXJuKFwiSW52YWxpZCBDSUdBUiAnXCIgKyBjaWdhciArIFwiJyBmb3IgXCIgKyBmZWF0dXJlLmRlc2MpOyByZXR1cm47IH1cbiAgICBsZW5ndGhzID0gXy5tYXAobGVuZ3RocywgcGFyc2VJbnQxMCk7XG4gICAgXG4gICAgXy5lYWNoKG9wcywgZnVuY3Rpb24ob3AsIGkpIHtcbiAgICAgIHZhciBsZW4gPSBsZW5ndGhzW2ldLFxuICAgICAgICBibG9jaywgaW5zZXJ0aW9uO1xuICAgICAgaWYgKC9eW01YPV0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBBbGlnbm1lbnQgbWF0Y2gsIHNlcXVlbmNlIG1hdGNoLCBzZXF1ZW5jZSBtaXNtYXRjaFxuICAgICAgICBibG9jayA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGJsb2NrLmVuZCA9IGJsb2NrLnN0YXJ0ICsgbGVuO1xuICAgICAgICBibG9jay50eXBlID0gb3A7XG4gICAgICAgIGJsb2NrLnNlcSA9IHNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmICgvXltORF0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBTa2lwcGVkIHJlZmVyZW5jZSByZWdpb24sIGRlbGV0aW9uIGZyb20gcmVmZXJlbmNlXG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdJJykge1xuICAgICAgICAvLyBJbnNlcnRpb25cbiAgICAgICAgaW5zZXJ0aW9uID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuLCBlbmQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW59O1xuICAgICAgICBpbnNlcnRpb24uc2VxID0gc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5pbnNlcnRpb25zLnB1c2goaW5zZXJ0aW9uKTtcbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ1MnKSB7XG4gICAgICAgIC8vIFNvZnQgY2xpcHBpbmc7IHNpbXBseSBza2lwIHRoZXNlIGJhc2VzIGluIFNFUSwgcG9zaXRpb24gb24gcmVmZXJlbmNlIGlzIHVuY2hhbmdlZC5cbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH1cbiAgICAgIC8vIFRoZSBvdGhlciB0d28gQ0lHQVIgb3BzLCBIIGFuZCBQLCBhcmUgbm90IHJlbGV2YW50IHRvIGRyYXdpbmcgYWxpZ25tZW50cy5cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmVuZCA9IGZlYXR1cmUuc3RhcnQgKyByZWZMZW47XG4gIH0sXG4gIFxuICBwYXJzZUxpbmU6IGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29scyA9IFsncW5hbWUnLCAnZmxhZycsICdybmFtZScsICdwb3MnLCAnbWFwcScsICdjaWdhcicsICdybmV4dCcsICdwbmV4dCcsICd0bGVuJywgJ3NlcScsICdxdWFsJ10sXG4gICAgICBmZWF0dXJlID0ge30sXG4gICAgICBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgYXZhaWxGbGFncyA9IHRoaXMudHlwZSgnYmFtJykuZmxhZ3MsXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgXy5lYWNoKF8uZmlyc3QoZmllbGRzLCBjb2xzLmxlbmd0aCksIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgIC8vIE5vdGUgdGhhdCBjaHJNIGlzIE5PVCBlcXVpdmFsZW50IHRvIE1UIGh0dHBzOi8vd3d3LmJpb3N0YXJzLm9yZy9wLzEyMDA0Mi8jMTIwMDU4XG4gICAgc3dpdGNoIChvLmNvbnZlcnRDaHJTY2hlbWUgPT0gXCJhdXRvXCIgPyB0aGlzLmRhdGEuaW5mby5jb252ZXJ0Q2hyU2NoZW1lIDogby5jb252ZXJ0Q2hyU2NoZW1lKSB7XG4gICAgICBjYXNlICd1Y3NjX2Vuc2VtYmwnOiBmZWF0dXJlLnJuYW1lID0gZmVhdHVyZS5ybmFtZS5yZXBsYWNlKC9eY2hyLywgJycpOyBicmVhaztcbiAgICAgIGNhc2UgJ2Vuc2VtYmxfdWNzYyc6IGZlYXR1cmUucm5hbWUgPSAoL14oXFxkXFxkP3xYKSQvLnRlc3QoZmVhdHVyZS5ybmFtZSkgPyAnY2hyJyA6ICcnKSArIGZlYXR1cmUucm5hbWU7IGJyZWFrO1xuICAgIH1cbiAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnFuYW1lO1xuICAgIGZlYXR1cmUuZmxhZyA9IHBhcnNlSW50MTAoZmVhdHVyZS5mbGFnKTtcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tmZWF0dXJlLnJuYW1lXTtcbiAgICBsaW5lbm8gPSBsaW5lbm8gfHwgMDtcbiAgICBcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIFJOQU1FICdcIitmZWF0dXJlLnJuYW1lK1wiJyBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIGlmIChmZWF0dXJlLnBvcyA9PT0gJzAnIHx8ICFmZWF0dXJlLmNpZ2FyIHx8IGZlYXR1cmUuY2lnYXIgPT0gJyonIHx8IGZlYXR1cmUuZmxhZyAmIGF2YWlsRmxhZ3MuaXNSZWFkVW5tYXBwZWQpIHtcbiAgICAgIC8vIFVubWFwcGVkIHJlYWQuIFNpbmNlIHdlIGNhbid0IGRyYXcgdGhlc2UgYXQgYWxsLCB3ZSBkb24ndCBib3RoZXIgcGFyc2luZyB0aGVtIGZ1cnRoZXIuXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5wb3MpOyAgICAgICAgLy8gUE9TIGlzIDEtYmFzZWQsIGhlbmNlIG5vIGluY3JlbWVudCBhcyBmb3IgcGFyc2luZyBCRURcbiAgICAgIGZlYXR1cmUuZGVzYyA9IGZlYXR1cmUucW5hbWUgKyAnIGF0ICcgKyBmZWF0dXJlLnJuYW1lICsgJzonICsgZmVhdHVyZS5wb3M7XG4gICAgICBmZWF0dXJlLnRsZW4gPSBwYXJzZUludDEwKGZlYXR1cmUudGxlbik7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlRmxhZ3MuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pO1xuICAgICAgZmVhdHVyZS5zdHJhbmQgPSBmZWF0dXJlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gJy0nIDogJysnO1xuICAgICAgdGhpcy50eXBlKCdiYW0nKS5wYXJzZUNpZ2FyLmNhbGwodGhpcywgZmVhdHVyZSwgbGluZW5vKTsgLy8gVGhpcyBhbHNvIHNldHMgLmVuZCBhcHByb3ByaWF0ZWx5XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgdG8gY29tZSB1cCB3aXRoIHNvbWV0aGluZyB0aGF0IGlzIGEgdW5pcXVlIGxhYmVsIGZvciBldmVyeSBsaW5lIHRvIGRlZHVwZSByb3dzLlxuICAgIC8vIFRoZSBmb2xsb3dpbmcgaXMgdGVjaG5pY2FsbHkgbm90IGd1YXJhbnRlZWQgYnkgYSB2YWxpZCBCQU0gKGV2ZW4gYXQgR0FUSyBzdGFuZGFyZHMpLCBidXQgaXQncyB0aGUgYmVzdCBJIGdvdC5cbiAgICBmZWF0dXJlLmlkID0gW2ZlYXR1cmUucW5hbWUsIGZlYXR1cmUuZmxhZywgZmVhdHVyZS5ybmFtZSwgZmVhdHVyZS5wb3MsIGZlYXR1cmUuY2lnYXJdLmpvaW4oXCJcXHRcIik7XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICBwaWxldXA6IGZ1bmN0aW9uKGludGVydmFscywgc3RhcnQsIGVuZCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgcG9zaXRpb25zVG9DYWxjdWxhdGUgPSB7fSxcbiAgICAgIG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID0gMCxcbiAgICAgIGk7XG4gICAgXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgLy8gTm8gbmVlZCB0byBwaWxldXAgYWdhaW4gb24gYWxyZWFkeS1waWxlZC11cCBudWNsZW90aWRlIHBvc2l0aW9uc1xuICAgICAgaWYgKCFwaWxldXBbaV0pIHsgcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0gPSB0cnVlOyBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSsrOyB9XG4gICAgfVxuICAgIGlmIChudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9PT0gMCkgeyByZXR1cm47IH0gLy8gQWxsIHBvc2l0aW9ucyBhbHJlYWR5IHBpbGVkIHVwIVxuICAgIFxuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmIChpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTsgfVxuICAgICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tzKSB7XG4gICAgICAgIF8uZWFjaChibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgICAgdmFyIG50LCBpO1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIGVuZCk7IGkrKykge1xuICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSkgeyBjb250aW51ZTsgfVxuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBwaWxldXBbaV0gPSBwaWxldXBbaV0gfHwge0E6IDAsIEM6IDAsIEc6IDAsIFQ6IDAsIE46IDAsIGNvdjogMH07XG4gICAgICAgICAgICBwaWxldXBbaV1bKC9bQUNUR10vKS50ZXN0KG50KSA/IG50IDogJ04nXSArPSAxO1xuICAgICAgICAgICAgcGlsZXVwW2ldLmNvdiArPSAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGNvdmVyYWdlOiBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHApIHtcbiAgICAvLyBDb21wYXJlIHdpdGggYmlubmluZyBvbiB0aGUgZmx5IGluIC50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlciguLi4pXG4gICAgdmFyIGogPSBzdGFydCxcbiAgICAgIGN1cnIgPSB0aGlzLmRhdGEucGlsZXVwW2pdLFxuICAgICAgYmFycyA9IFtdLFxuICAgICAgbmV4dCwgYmluLCBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB3aWR0aDsgaSsrKSB7XG4gICAgICBiaW4gPSBjdXJyICYmIChqICsgMSA+PSBpICogYnBwcCArIHN0YXJ0KSA/IFtjdXJyLmNvdl0gOiBbXTtcbiAgICAgIG5leHQgPSB0aGlzLmRhdGEucGlsZXVwW2ogKyAxXTtcbiAgICAgIHdoaWxlIChqICsgMSA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgaiArIDIgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgaWYgKG5leHQpIHsgYmluLnB1c2gobmV4dC5jb3YpOyB9XG4gICAgICAgICsrajtcbiAgICAgICAgY3VyciA9IG5leHQ7XG4gICAgICAgIG5leHQgPSB0aGlzLmRhdGEucGlsZXVwW2ogKyAxXTtcbiAgICAgIH1cbiAgICAgIGJhcnMucHVzaCh1dGlscy53aWdCaW5GdW5jdGlvbnMubWF4aW11bShiaW4pKTtcbiAgICB9XG4gICAgcmV0dXJuIGJhcnM7XG4gIH0sXG4gIFxuICBhbGxlbGVzOiBmdW5jdGlvbihzdGFydCwgc2VxdWVuY2UsIGJwcHApIHtcbiAgICB2YXIgcGlsZXVwID0gdGhpcy5kYXRhLnBpbGV1cCxcbiAgICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQgPSB0aGlzLm9wdHMuYWxsZWxlRnJlcVRocmVzaG9sZCxcbiAgICAgIGFsbGVsZVNwbGl0cyA9IFtdLFxuICAgICAgc3BsaXQsIHJlZk50LCBpLCBwaWxlO1xuICAgICAgXG4gICAgZm9yIChpID0gMDsgaSA8IHNlcXVlbmNlLmxlbmd0aDsgaSsrKSB7XG4gICAgICByZWZOdCA9IHNlcXVlbmNlW2ldLnRvVXBwZXJDYXNlKCk7XG4gICAgICBwaWxlID0gcGlsZXVwW3N0YXJ0ICsgaV07XG4gICAgICBpZiAocGlsZSAmJiBwaWxlLmNvdiAmJiBwaWxlW3JlZk50XSAvIChwaWxlLmNvdiAtIHBpbGUuTikgPCAoMSAtIGFsbGVsZUZyZXFUaHJlc2hvbGQpKSB7XG4gICAgICAgIHNwbGl0ID0ge1xuICAgICAgICAgIHg6IGkgLyBicHBwLFxuICAgICAgICAgIHNwbGl0czogW11cbiAgICAgICAgfTtcbiAgICAgICAgXy5lYWNoKFsnQScsICdDJywgJ0cnLCAnVCddLCBmdW5jdGlvbihudCkge1xuICAgICAgICAgIGlmIChwaWxlW250XSA+IDApIHsgc3BsaXQuc3BsaXRzLnB1c2goe250OiBudCwgaDogcGlsZVtudF19KTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgYWxsZWxlU3BsaXRzLnB1c2goc3BsaXQpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYWxsZWxlU3BsaXRzO1xuICB9LFxuICBcbiAgbWlzbWF0Y2hlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwLCBpbnRlcnZhbHMsIHdpZHRoLCBsaW5lTnVtLCB2aWV3QXNQYWlycykge1xuICAgIHZhciBtaXNtYXRjaGVzID0gW10sXG4gICAgICB2aWV3QXNQYWlycyA9IHRoaXMub3B0cy52aWV3QXNQYWlycztcbiAgICBzZXF1ZW5jZSA9IHNlcXVlbmNlLnRvVXBwZXJDYXNlKCk7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKHZpZXdBc1BhaXJzICYmIGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IFxuICAgICAgICBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTtcbiAgICAgIH1cbiAgICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2Nrcykge1xuICAgICAgICBfLmVhY2goYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICAgIHZhciBsaW5lID0gbGluZU51bShpbnRlcnZhbC5kYXRhKSxcbiAgICAgICAgICAgIG50LCBpLCB4O1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIHN0YXJ0ICsgd2lkdGggKiBicHBwKTsgaSsrKSB7XG4gICAgICAgICAgICB4ID0gKGkgLSBzdGFydCkgLyBicHBwO1xuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAobnQgJiYgbnQgIT0gc2VxdWVuY2VbaSAtIHN0YXJ0XSAmJiBsaW5lKSB7IG1pc21hdGNoZXMucHVzaCh7eDogeCwgbnQ6IG50LCBsaW5lOiBsaW5lfSk7IH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIG1pc21hdGNoZXM7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIHNlcXVlbmNlID0gcHJlY2FsYy5zZXF1ZW5jZSxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICB2aWV3QXNQYWlycyA9IHNlbGYub3B0cy52aWV3QXNQYWlycyxcbiAgICAgIHN0YXJ0S2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVTdGFydCcgOiAnc3RhcnQnLFxuICAgICAgZW5kS2V5ID0gdmlld0FzUGFpcnMgPyAndGVtcGxhdGVFbmQnIDogJ2VuZCcsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eSArICdfJyArICh2aWV3QXNQYWlycyA/ICdwJyA6ICd1Jyk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiB3ZSBjYW4gcmVhc29uYWJseSBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggYW4gaW5zYW5lIGFtb3VudCBvZiByb3dzIFxuICAgIC8vICg+NTAwIGFsaWdubWVudHMpLCBhcyB0aGlzIHdpbGwgb25seSBob2xkIHVwIG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmV0Y2ggZnJvbSB0aGUgUmVtb3RlVHJhY2sgYW5kIGNhbGwgdGhlIGFib3ZlIHdoZW4gdGhlIGRhdGEgaXMgYXZhaWxhYmxlLlxuICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIHZpZXdBc1BhaXJzLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgdmFyIGRyYXdTcGVjID0ge3NlcXVlbmNlOiAhIXNlcXVlbmNlLCB3aWR0aDogd2lkdGh9LFxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbE1hdGVkID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIDQsIGZhbHNlLCBzdGFydEtleSwgZW5kS2V5KSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgNCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW50ZXJ2YWxzLnRvb01hbnkpIHsgcmV0dXJuIGNhbGxiYWNrKGludGVydmFscyk7IH1cblxuICAgICAgICBpZiAoIXNlcXVlbmNlKSB7XG4gICAgICAgICAgLy8gRmlyc3QgZHJhd2luZyBwYXNzLCB3aXRoIGZlYXR1cmVzIHRoYXQgZG9uJ3QgZGVwZW5kIG9uIHNlcXVlbmNlLlxuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykucGlsZXVwLmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCBzdGFydCwgZW5kKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWxNYXRlZCwgbGluZU51bSk7XG4gICAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obGluZXMpIHtcbiAgICAgICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgICAgICAgICAgaW50ZXJ2YWwuaW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5pbnNlcnRpb25zLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICBpZiAoIXZpZXdBc1BhaXJzKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICBpZiAoaW50ZXJ2YWwuZC5kcmF3QXNNYXRlcyAmJiBpbnRlcnZhbC5kLm1hdGUpIHtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW50cyA9IF8ubWFwKFtpbnRlcnZhbC5kLCBpbnRlcnZhbC5kLm1hdGVdLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBfLm1hcChpbnRlcnZhbC5kLm1hdGUuaW5zZXJ0aW9uUHRzLCBjYWxjUGl4SW50ZXJ2YWwpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKGludGVydmFsLmQubWF0ZUV4cGVjdGVkKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBbY2FsY1BpeEludGVydmFsKGludGVydmFsKV07XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUJsb2NrSW50cyA9IFtdO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnNlcnRpb25QdHMgPSBbXTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZHJhd1NwZWMuY292ZXJhZ2UgPSBzZWxmLnR5cGUoJ2JhbScpLmNvdmVyYWdlLmNhbGwoc2VsZiwgc3RhcnQsIHdpZHRoLCBicHBwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2UsIGxpa2UgbWlzbWF0Y2hlcyAocG90ZW50aWFsIFNOUHMpLlxuICAgICAgICAgIGRyYXdTcGVjLmJwcHAgPSBicHBwOyAgXG4gICAgICAgICAgLy8gRmluZCBhbGxlbGUgc3BsaXRzIHdpdGhpbiB0aGUgY292ZXJhZ2UgZ3JhcGguXG4gICAgICAgICAgZHJhd1NwZWMuYWxsZWxlcyA9IHNlbGYudHlwZSgnYmFtJykuYWxsZWxlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCk7XG4gICAgICAgICAgLy8gRmluZCBtaXNtYXRjaGVzIHdpdGhpbiBlYWNoIGFsaWduZWQgYmxvY2suXG4gICAgICAgICAgZHJhd1NwZWMubWlzbWF0Y2hlcyA9IHNlbGYudHlwZSgnYmFtJykubWlzbWF0Y2hlcy5jYWxsKHNlbGYsIHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb250ZW50ID0ge30sXG4gICAgICBmaXJzdE1hdGUgPSBkYXRhLmQsXG4gICAgICBzZWNvbmRNYXRlID0gZGF0YS5kLm1hdGUsXG4gICAgICBtYXRlSGVhZGVycyA9IFtcInRoaXMgYWxpZ25tZW50XCIsIFwibWF0ZSBwYWlyIGFsaWdubWVudFwiXSxcbiAgICAgIGxlZnRNYXRlLCByaWdodE1hdGUsIHBhaXJPcmllbnRhdGlvbjtcbiAgICBmdW5jdGlvbiB5ZXNObyhib29sKSB7IHJldHVybiBib29sID8gXCJ5ZXNcIiA6IFwibm9cIjsgfVxuICAgIGZ1bmN0aW9uIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBzZWcsIHByZWZpeCkge1xuICAgICAgdmFyIGNpZ2FyQWJicmV2ID0gc2VnLmNpZ2FyICYmIHNlZy5jaWdhci5sZW5ndGggPiAyNSA/IHNlZy5jaWdhci5zdWJzdHIoMCwgMjQpICsgJy4uLicgOiBzZWcuY2lnYXI7XG4gICAgICBwcmVmaXggPSBwcmVmaXggfHwgXCJcIjtcbiAgICAgIFxuICAgICAgXy5lYWNoKHtcbiAgICAgICAgXCJwb3NpdGlvblwiOiBzZWcucm5hbWUgKyAnOicgKyBzZWcucG9zLFxuICAgICAgICBcImNpZ2FyXCI6IGNpZ2FyQWJicmV2LFxuICAgICAgICBcInJlYWQgc3RyYW5kXCI6IHNlZy5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/ICcoLSknIDogJygrKScsXG4gICAgICAgIFwibWFwcGVkXCI6IHllc05vKCFzZWcuZmxhZ3MuaXNSZWFkVW5tYXBwZWQpLFxuICAgICAgICBcIm1hcCBxdWFsaXR5XCI6IHNlZy5tYXBxLFxuICAgICAgICBcInNlY29uZGFyeVwiOiB5ZXNObyhzZWcuZmxhZ3MuaXNTZWNvbmRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcInN1cHBsZW1lbnRhcnlcIjogeWVzTm8oc2VnLmZsYWdzLmlzU3VwcGxlbWVudGFyeUFsaWdubWVudCksXG4gICAgICAgIFwiZHVwbGljYXRlXCI6IHllc05vKHNlZy5mbGFncy5pc0R1cGxpY2F0ZVJlYWQpLFxuICAgICAgICBcImZhaWxlZCBRQ1wiOiB5ZXNObyhzZWcuZmxhZ3MuaXNSZWFkRmFpbGluZ1ZlbmRvclFDKVxuICAgICAgfSwgZnVuY3Rpb24odiwgaykgeyBjb250ZW50W3ByZWZpeCArIGtdID0gdjsgfSk7XG4gICAgfVxuICAgIFxuICAgIGlmIChkYXRhLmQubWF0ZSAmJiBkYXRhLmQubWF0ZS5mbGFncykge1xuICAgICAgbGVmdE1hdGUgPSBkYXRhLmQuc3RhcnQgPCBkYXRhLmQubWF0ZS5zdGFydCA/IGRhdGEuZCA6IGRhdGEuZC5tYXRlO1xuICAgICAgcmlnaHRNYXRlID0gZGF0YS5kLnN0YXJ0IDwgZGF0YS5kLm1hdGUuc3RhcnQgPyBkYXRhLmQubWF0ZSA6IGRhdGEuZDtcbiAgICAgIHBhaXJPcmllbnRhdGlvbiA9IChsZWZ0TWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/IFwiUlwiIDogXCJGXCIpICsgKGxlZnRNYXRlLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyID8gXCIxXCIgOiBcIjJcIik7XG4gICAgICBwYWlyT3JpZW50YXRpb24gKz0gKHJpZ2h0TWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSA/IFwiUlwiIDogXCJGXCIpICsgKHJpZ2h0TWF0ZS5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyID8gXCIyXCIgOiBcIjFcIik7XG4gICAgfVxuICAgIFxuICAgIGlmIChvLnZpZXdBc1BhaXJzICYmIGRhdGEuZC5kcmF3QXNNYXRlcyAmJiBkYXRhLmQubWF0ZSkge1xuICAgICAgZmlyc3RNYXRlID0gbGVmdE1hdGU7XG4gICAgICBzZWNvbmRNYXRlID0gcmlnaHRNYXRlO1xuICAgICAgbWF0ZUhlYWRlcnMgPSBbXCJsZWZ0IGFsaWdubWVudFwiLCBcInJpZ2h0IGFsaWdubWVudFwiXTtcbiAgICB9XG4gICAgaWYgKHNlY29uZE1hdGUpIHtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuaW5zZXJ0U2l6ZSkpIHsgY29udGVudFtcImluc2VydCBzaXplXCJdID0gZGF0YS5kLmluc2VydFNpemU7IH1cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChwYWlyT3JpZW50YXRpb24pKSB7IGNvbnRlbnRbXCJwYWlyIG9yaWVudGF0aW9uXCJdID0gcGFpck9yaWVudGF0aW9uOyB9XG4gICAgICBjb250ZW50W21hdGVIZWFkZXJzWzBdXSA9IFwiLS0tXCI7XG4gICAgICBhZGRBbGlnbmVkU2VnbWVudEluZm8oY29udGVudCwgZmlyc3RNYXRlKTtcbiAgICAgIGNvbnRlbnRbbWF0ZUhlYWRlcnNbMV1dID0gXCItLS1cIjtcbiAgICAgIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBzZWNvbmRNYXRlLCBcIiBcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBkYXRhLmQpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSxcbiAgXG4gIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjY292ZXJhZ2UgZm9yIGFuIGlkZWEgb2Ygd2hhdCB3ZSdyZSBpbWl0YXRpbmdcbiAgZHJhd0NvdmVyYWdlOiBmdW5jdGlvbihjdHgsIGNvdmVyYWdlLCBoZWlnaHQpIHtcbiAgICB2YXIgdlNjYWxlID0gdGhpcy5kcmF3UmFuZ2VbMV07XG4gICAgXy5lYWNoKGNvdmVyYWdlLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIHZhciBoID0gZCAqIGhlaWdodCAvIHZTY2FsZTtcbiAgICAgIGN0eC5maWxsUmVjdCh4LCBNYXRoLm1heChoZWlnaHQgLSBoLCAwKSwgMSwgTWF0aC5taW4oaCwgaGVpZ2h0KSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3U3RyYW5kSW5kaWNhdG9yOiBmdW5jdGlvbihjdHgsIHgsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIHhTY2FsZSwgYmlnU3R5bGUpIHtcbiAgICB2YXIgcHJldkZpbGxTdHlsZSA9IGN0eC5maWxsU3R5bGU7XG4gICAgaWYgKGJpZ1N0eWxlKSB7XG4gICAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgICBjdHgubW92ZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSk7XG4gICAgICBjdHgubGluZVRvKHggKyAoMyAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0LzIpO1xuICAgICAgY3R4LmxpbmVUbyh4IC0gKDIgKiB4U2NhbGUpLCBibG9ja1kgKyBibG9ja0hlaWdodCk7XG4gICAgICBjdHguY2xvc2VQYXRoKCk7XG4gICAgICBjdHguZmlsbCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYigxNDAsMTQwLDE0MCknO1xuICAgICAgY3R4LmZpbGxSZWN0KHggKyAoeFNjYWxlID4gMCA/IC0yIDogMSksIGJsb2NrWSwgMSwgYmxvY2tIZWlnaHQpO1xuICAgICAgY3R4LmZpbGxSZWN0KHggKyAoeFNjYWxlID4gMCA/IC0xIDogMCksIGJsb2NrWSArIDEsIDEsIGJsb2NrSGVpZ2h0IC0gMik7XG4gICAgICBjdHguZmlsbFN0eWxlID0gcHJldkZpbGxTdHlsZTtcbiAgICB9XG4gIH0sXG4gIFxuICBkcmF3QWxpZ25tZW50OiBmdW5jdGlvbihjdHgsIHdpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZHJhd01hdGVzID0gZGF0YS5tYXRlSW50cyxcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDAsXG4gICAgICBibG9ja1kgPSBpICogbGluZUhlaWdodCArIGxpbmVHYXAvMixcbiAgICAgIGJsb2NrSGVpZ2h0ID0gbGluZUhlaWdodCAtIGxpbmVHYXAsXG4gICAgICBkZWxldGlvbkxpbmVXaWR0aCA9IDIsXG4gICAgICBpbnNlcnRpb25DYXJldExpbmVXaWR0aCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDEsXG4gICAgICBoYWxmSGVpZ2h0ID0gTWF0aC5yb3VuZCgwLjUgKiBsaW5lSGVpZ2h0KSAtIGRlbGV0aW9uTGluZVdpZHRoICogMC41LFxuICAgICAgYmxvY2tTZXRzID0gW3tibG9ja0ludHM6IGRhdGEuYmxvY2tJbnRzLCBzdHJhbmQ6IGRhdGEuZC5zdHJhbmR9XTtcbiAgICBcbiAgICAvLyBGb3IgbWF0ZSBwYWlycywgdGhlIGZ1bGwgcGl4ZWwgaW50ZXJ2YWwgcmVwcmVzZW50cyB0aGUgbGluZSBsaW5raW5nIHRoZSBtYXRlc1xuICAgIGlmIChkcmF3TWF0ZXMpIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgaGFsZkhlaWdodCwgZGF0YS5wSW50LncsIGRlbGV0aW9uTGluZVdpZHRoKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRHJhdyB0aGUgbGluZXMgdGhhdCBzaG93IHRoZSBmdWxsIGFsaWdubWVudCBmb3IgZWFjaCBzZWdtZW50LCBpbmNsdWRpbmcgZGVsZXRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9ICdyZ2IoMCwwLDApJztcbiAgICBfLmVhY2goZHJhd01hdGVzIHx8IFtkYXRhLnBJbnRdLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICBpZiAocEludC53IDw9IDApIHsgcmV0dXJuOyB9XG4gICAgICAvLyBOb3RlIHRoYXQgdGhlIFwiLSAxXCIgYmVsb3cgZml4ZXMgcm91bmRpbmcgaXNzdWVzIGJ1dCBnYW1ibGVzIG9uIHRoZXJlIG5ldmVyIGJlaW5nIGEgZGVsZXRpb24gYXQgdGhlIHJpZ2h0IGVkZ2VcbiAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgaGFsZkhlaWdodCwgcEludC53IC0gMSwgZGVsZXRpb25MaW5lV2lkdGgpO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIEZpcnN0LCBkZXRlcm1pbmUgYW5kIHNldCB0aGUgY29sb3Igd2Ugd2lsbCBiZSB1c2luZ1xuICAgIC8vIE5vdGUgdGhhdCB0aGUgZGVmYXVsdCBjb2xvciB3YXMgYWxyZWFkeSBzZXQgaW4gZHJhd1NwZWNcbiAgICBpZiAoc2VsZi5vcHRzLmFsdENvbG9yICYmIGRhdGEuZC5zdHJhbmQgPT0gJy0nKSB7IGNvbG9yID0gc2VsZi5vcHRzLmFsdENvbG9yOyB9XG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICBcbiAgICAvLyBEcmF3IHRoZSBbbWlzXW1hdGNoIChNL1gvPSkgYmxvY2tzXG4gICAgaWYgKGRyYXdNYXRlcyAmJiBkYXRhLmQubWF0ZSkgeyBibG9ja1NldHMucHVzaCh7YmxvY2tJbnRzOiBkYXRhLm1hdGVCbG9ja0ludHMsIHN0cmFuZDogZGF0YS5kLm1hdGUuc3RyYW5kfSk7IH1cbiAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja1NldCkge1xuICAgICAgdmFyIHN0cmFuZCA9IGJsb2NrU2V0LnN0cmFuZDtcbiAgICAgIF8uZWFjaChibG9ja1NldC5ibG9ja0ludHMsIGZ1bmN0aW9uKGJJbnQsIGJsb2NrTnVtKSB7XG4gICAgICBcbiAgICAgICAgLy8gU2tpcCBkcmF3aW5nIGJsb2NrcyB0aGF0IGFyZW4ndCBpbnNpZGUgdGhlIGNhbnZhc1xuICAgICAgICBpZiAoYkludC54ICsgYkludC53IDwgMCB8fCBiSW50LnggPiB3aWR0aCkgeyByZXR1cm47IH1cbiAgICAgIFxuICAgICAgICBpZiAoYmxvY2tOdW0gPT0gMCAmJiBibG9ja1NldC5zdHJhbmQgPT0gJy0nICYmICFiSW50Lm9QcmV2KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCArIDIsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAtMSwgbGluZUhlaWdodCA+IDYpO1xuICAgICAgICB9IGVsc2UgaWYgKGJsb2NrTnVtID09IGJsb2NrU2V0LmJsb2NrSW50cy5sZW5ndGggLSAxICYmIGJsb2NrU2V0LnN0cmFuZCA9PSAnKycgJiYgIWJJbnQub05leHQpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCBibG9ja1ksIGJJbnQudyAtIDIsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTdHJhbmRJbmRpY2F0b3IuY2FsbChzZWxmLCBjdHgsIGJJbnQueCArIGJJbnQudywgYmxvY2tZLCBibG9ja0hlaWdodCwgMSwgbGluZUhlaWdodCA+IDYpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53LCBibG9ja0hlaWdodCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIERyYXcgaW5zZXJ0aW9uc1xuICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYigxMTQsNDEsMjE4KVwiO1xuICAgIF8uZWFjaChkcmF3TWF0ZXMgPyBbZGF0YS5pbnNlcnRpb25QdHMsIGRhdGEubWF0ZUluc2VydGlvblB0c10gOiBbZGF0YS5pbnNlcnRpb25QdHNdLCBmdW5jdGlvbihpbnNlcnRpb25QdHMpIHtcbiAgICAgIF8uZWFjaChpbnNlcnRpb25QdHMsIGZ1bmN0aW9uKGluc2VydCkge1xuICAgICAgICBpZiAoaW5zZXJ0LnggKyBpbnNlcnQudyA8IDAgfHwgaW5zZXJ0LnggPiB3aWR0aCkgeyByZXR1cm47IH1cbiAgICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMSwgaSAqIGxpbmVIZWlnaHQsIDIsIGxpbmVIZWlnaHQpO1xuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAyLCBpICogbGluZUhlaWdodCwgNCwgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgpO1xuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAyLCAoaSArIDEpICogbGluZUhlaWdodCAtIGluc2VydGlvbkNhcmV0TGluZVdpZHRoLCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdBbGxlbGVzOiBmdW5jdGlvbihjdHgsIGFsbGVsZXMsIGhlaWdodCwgYmFyV2lkdGgpIHtcbiAgICAvLyBTYW1lIGNvbG9ycyBhcyAkLnVpLmdlbm90cmFjay5fbnRTZXF1ZW5jZUxvYWQoLi4uKSBidXQgY291bGQgYmUgY29uZmlndXJhYmxlP1xuICAgIHZhciBjb2xvcnMgPSB7QTogJzI1NSwwLDAnLCBUOiAnMjU1LDAsMjU1JywgQzogJzAsMCwyNTUnLCBHOiAnMCwxODAsMCd9LFxuICAgICAgdlNjYWxlID0gdGhpcy5kcmF3UmFuZ2VbMV0sXG4gICAgICB5UG9zO1xuICAgIF8uZWFjaChhbGxlbGVzLCBmdW5jdGlvbihhbGxlbGVzRm9yUG9zaXRpb24pIHtcbiAgICAgIHlQb3MgPSBoZWlnaHQ7XG4gICAgICBfLmVhY2goYWxsZWxlc0ZvclBvc2l0aW9uLnNwbGl0cywgZnVuY3Rpb24oc3BsaXQpIHtcbiAgICAgICAgdmFyIGggPSBzcGxpdC5oICogaGVpZ2h0IC8gdlNjYWxlO1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1tzcGxpdC5udF0rJyknO1xuICAgICAgICBjdHguZmlsbFJlY3QoYWxsZWxlc0ZvclBvc2l0aW9uLngsIHlQb3MgLT0gaCwgTWF0aC5tYXgoYmFyV2lkdGgsIDEpLCBoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd01pc21hdGNoOiBmdW5jdGlvbihjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCBwcGJwKSB7XG4gICAgLy8gcHBicCA9PSBwaXhlbHMgcGVyIGJhc2UgcGFpciAoaW52ZXJzZSBvZiBicHBwKVxuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIHlQb3M7XG4gICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbbWlzbWF0Y2gubnRdKycpJztcbiAgICBjdHguZmlsbFJlY3QobWlzbWF0Y2gueCwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0KSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwIC8gMiwgTWF0aC5tYXgocHBicCwgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAvLyBEbyB3ZSBoYXZlIHJvb20gdG8gcHJpbnQgYSB3aG9sZSBsZXR0ZXI/XG4gICAgaWYgKHBwYnAgPiA3ICYmIGxpbmVIZWlnaHQgPiAxMCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMjU1LDI1NSwyNTUpJztcbiAgICAgIGN0eC5maWxsVGV4dChtaXNtYXRjaC5udCwgbWlzbWF0Y2gueCArIHBwYnAgKiAwLjUsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCArIDEpICogbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTQgOiA0LFxuICAgICAgY292SGVpZ2h0ID0gc2VsZi5vcHRzLmNvdkhlaWdodFtkZW5zaXR5XSB8fCAzOCxcbiAgICAgIGNvdk1hcmdpbiA9IDcsXG4gICAgICBsaW5lT2Zmc2V0ID0gKChjb3ZIZWlnaHQgKyBjb3ZNYXJnaW4pIC8gbGluZUhlaWdodCksIFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgICAgICAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBcbiAgICBpZiAoIWRyYXdTcGVjLnNlcXVlbmNlKSB7XG4gICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICBcbiAgICAgIC8vIElmIG5lY2Vzc2FyeSwgaW5kaWNhdGUgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgIGlmIChkcmF3U3BlYy50b29NYW55IHx8IChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE9ubHkgc3RvcmUgYXJlYXMgZm9yIHRoZSBcInBhY2tcIiBkZW5zaXR5LlxuICAgICAgLy8gV2UgaGF2ZSB0byBlbXB0eSB0aGlzIGZvciBldmVyeSByZW5kZXIsIGJlY2F1c2UgYXJlYXMgY2FuIGNoYW5nZSBpZiBCQU0gZGlzcGxheSBvcHRpb25zIGNoYW5nZS5cbiAgICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICAgIC8vIFNldCB0aGUgZXhwZWN0ZWQgaGVpZ2h0IGZvciB0aGUgY2FudmFzICh0aGlzIGFsc28gZXJhc2VzIGl0KS5cbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBjb3ZIZWlnaHQgKyAoKGRlbnNpdHkgPT0gJ2RlbnNlJykgPyAwIDogY292TWFyZ2luICsgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQpO1xuICAgICAgXG4gICAgICAvLyBGaXJzdCBkcmF3IHRoZSBjb3ZlcmFnZSBncmFwaFxuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDE1OSwxNTksMTU5KVwiO1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3Q292ZXJhZ2UuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmNvdmVyYWdlLCBjb3ZIZWlnaHQpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgLy8gTm93LCBkcmF3IGFsaWdubWVudHMgYmVsb3cgaXRcbiAgICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScpIHtcbiAgICAgICAgLy8gQm9yZGVyIGJldHdlZW4gY292ZXJhZ2VcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDEwOSwxMDksMTA5KVwiO1xuICAgICAgICBjdHguZmlsbFJlY3QoMCwgY292SGVpZ2h0ICsgMSwgZHJhd1NwZWMud2lkdGgsIDEpOyBcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgICBcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICAgIGkgKz0gbGluZU9mZnNldDsgLy8gaGFja2lzaCBtZXRob2QgZm9yIGxlYXZpbmcgc3BhY2UgYXQgdGhlIHRvcCBmb3IgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsaWdubWVudC5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQsIGRyYXdTcGVjLnZpZXdBc1BhaXJzKTtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2U6XG4gICAgICAvLyAoMSkgYWxsZWxlIHNwbGl0cyBvdmVyIGNvdmVyYWdlXG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGxlbGVzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5hbGxlbGVzLCBjb3ZIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIC8vICgyKSBtaXNtYXRjaGVzIG92ZXIgdGhlIGFsaWdubWVudHNcbiAgICAgIGN0eC5mb250ID0gXCIxMnB4ICdNZW5sbycsJ0JpdHN0cmVhbSBWZXJhIFNhbnMgTW9ubycsJ0NvbnNvbGFzJywnTHVjaWRhIENvbnNvbGUnLG1vbm9zcGFjZVwiO1xuICAgICAgY3R4LnRleHRBbGlnbiA9ICdjZW50ZXInO1xuICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdiYXNlbGluZSc7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubWlzbWF0Y2hlcywgZnVuY3Rpb24obWlzbWF0Y2gpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3TWlzbWF0Y2guY2FsbChzZWxmLCBjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgdmFyIGNhbGxiYWNrS2V5ID0gc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5O1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgXG4gICAgICAvLyBIYXZlIHdlIGJlZW4gd2FpdGluZyB0byBkcmF3IHNlcXVlbmNlIGRhdGEgdG9vPyBJZiBzbywgZG8gdGhhdCBub3csIHRvby5cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0pKSB7XG4gICAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKCk7XG4gICAgICAgIGRlbGV0ZSBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgcmVuZGVyU2VxdWVuY2U6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgc2VxdWVuY2UsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIFxuICAgIC8vIElmIHdlIHdlcmVuJ3QgYWJsZSB0byBmZXRjaCBzZXF1ZW5jZSBmb3Igc29tZSByZWFzb24sIHRoZXJlIGlzIG5vIHJlYXNvbiB0byBwcm9jZWVkLlxuICAgIGlmICghc2VxdWVuY2UpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCkge1xuICAgICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGgsIHNlcXVlbmNlOiBzZXF1ZW5jZX0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoZSBjYW52YXMgd2FzIGFscmVhZHkgcmVuZGVyZWQgKGJ5IGxhY2sgb2YgdGhlIGNsYXNzICd1bnJlbmRlcmVkJykuXG4gICAgLy8gSWYgeWVzLCBnbyBhaGVhZCBhbmQgZXhlY3V0ZSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7IGlmIG5vdCwgc2F2ZSBpdCBmb3IgbGF0ZXIuXG4gICAgaWYgKCgnICcgKyBjYW52YXMuY2xhc3NOYW1lICsgJyAnKS5pbmRleE9mKCcgdW5yZW5kZXJlZCAnKSA+IC0xKSB7XG4gICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW3N0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eV0gPSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrO1xuICAgIH0gZWxzZSB7XG4gICAgICByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7XG4gICAgfVxuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmF0dHIoJ2NoZWNrZWQnLCAhIW8udmlld0FzUGFpcnMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoby5jb252ZXJ0Q2hyU2NoZW1lKS5jaGFuZ2UoKTtcbiAgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgIG8udmlld0FzUGFpcnMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8uY29udmVydENoclNjaGVtZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29udmVydENoclNjaGVtZV0nKS52YWwoKTtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICAgIFxuICAgIC8vIElmIG8udmlld0FzUGFpcnMgd2FzIGNoYW5nZWQsIHdlICpuZWVkKiB0byBibG93IGF3YXkgdGhlIGdlbm9icm93c2VyJ3MgYXJlYUluZGV4IFxuICAgIC8vIGFuZCBvdXIgbG9jYWxseSBjYWNoZWQgYXJlYXMsIGFzIGFsbCB0aGUgYXJlYXMgd2lsbCBjaGFuZ2UuXG4gICAgaWYgKG8udmlld0FzUGFpcnMgIT0gdGhpcy5wcmV2T3B0cy52aWV3QXNQYWlycykge1xuICAgICAgdGhpcy5hcmVhcyA9IHt9O1xuICAgICAgZGVsZXRlICRkaWFsb2cuZGF0YSgnZ2Vub2Jyb3dzZXInKS5nZW5vYnJvd3NlcignYXJlYUluZGV4JylbJGRpYWxvZy5kYXRhKCd0cmFjaycpLm5dO1xuICAgIH1cbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmFtRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJFRCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBiZWREZXRhaWwgaXMgYSB0cml2aWFsIGV4dGVuc2lvbiBvZiBCRUQgdGhhdCBpcyBkZWZpbmVkIHNlcGFyYXRlbHksXG4vLyBhbHRob3VnaCBhIEJFRCBmaWxlIHdpdGggPjEyIGNvbHVtbnMgaXMgYXNzdW1lZCB0byBiZSBiZWREZXRhaWwgdHJhY2sgcmVnYXJkbGVzcyBvZiB0eXBlLlxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIGNvbnZlcnRVcmxUZW1wbGF0ZUZvcm1hdCA9IHV0aWxzLmNvbnZlcnRVcmxUZW1wbGF0ZUZvcm1hdCxcbiAgdXJsRm9yRmVhdHVyZSA9IHV0aWxzLnVybEZvckZlYXR1cmU7XG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgTGluZU1hc2sgPSByZXF1aXJlKCcuL3V0aWxzL0xpbmVNYXNrLmpzJykuTGluZU1hc2s7XG5cbnZhciBCRURfU1RBTkRBUkRfRklFTERTID0gWydjaHJvbScsICdjaHJvbVN0YXJ0JywgJ2Nocm9tRW5kJywgJ25hbWUnLCAnc2NvcmUnLCAnc3RyYW5kJywgJ3RoaWNrU3RhcnQnLCAndGhpY2tFbmQnLCAnaXRlbVJnYicsXG4gICAgJ2Jsb2NrQ291bnQnLCAnYmxvY2tTaXplcycsICdibG9ja1N0YXJ0cyddO1xudmFyIEJFRF9ERVRBSUxfRklFTERTID0gWydpZCcsICdkZXNjcmlwdGlvbiddO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRcbnZhciBCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfSxcbiAgICBiZWRQbHVzRmllbGRzOiBudWxsXG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGFsdENvbG9ycyA9IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLyksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSBhbHRDb2xvcnMubGVuZ3RoID4gMSAmJiBfLmFsbChhbHRDb2xvcnMsIHNlbGYudmFsaWRhdGVDb2xvcik7XG4gICAgc2VsZi5udW1TdGFuZGFyZENvbHVtbnMgPSBCRURfU1RBTkRBUkRfRklFTERTLmxlbmd0aDtcbiAgICBzZWxmLm9wdHMudXNlU2NvcmUgPSBzZWxmLmlzT24oc2VsZi5vcHRzLnVzZVNjb3JlKTtcbiAgICBzZWxmLm9wdHMuaXRlbVJnYiA9IHNlbGYuaXNPbihzZWxmLm9wdHMuaXRlbVJnYik7XG4gICAgaWYgKHNlbGYudHlwZUFyZ3MubGVuZ3RoID4gMCAmJiAvXlxcZCskLy50ZXN0KHNlbGYudHlwZUFyZ3NbMF0pKSB7XG4gICAgICBzZWxmLm51bVN0YW5kYXJkQ29sdW1ucyA9IHBhcnNlSW50MTAoc2VsZi50eXBlQXJnc1swXSk7XG4gICAgfVxuICAgIGlmIChzZWxmLm9wdHMuYmVkUGx1c0ZpZWxkcyAmJiAhXy5pc0FycmF5KHNlbGYub3B0cy5iZWRQbHVzRmllbGRzKSkge1xuICAgICAgc2VsZi5vcHRzLmJlZFBsdXNGaWVsZHMgPSBzZWxmLm9wdHMuYmVkUGx1c0ZpZWxkcy5zcGxpdCgnLCcpO1xuICAgIH1cbiAgICBpZiAoLyVzLy50ZXN0KHNlbGYub3B0cy51cmwpKSB7IHNlbGYub3B0cy51cmwgPSBjb252ZXJ0VXJsVGVtcGxhdGVGb3JtYXQoc2VsZi5vcHRzLnVybCk7IH1cbiAgICBlbHNlIGlmIChzZWxmLm9wdHMudXJsICYmICEoL1xcJFxcJC8pLnRlc3Qoc2VsZi5vcHRzLnVybCkpIHsgc2VsZi5vcHRzLnVybCArPSAnJCQnOyB9XG4gICAgaWYgKCF2YWxpZENvbG9yQnlTdHJhbmQpIHsgc2VsZi5vcHRzLmNvbG9yQnlTdHJhbmQgPSAnJzsgc2VsZi5vcHRzLmFsdENvbG9yID0gbnVsbDsgfVxuICAgIGVsc2UgeyBzZWxmLm9wdHMuYWx0Q29sb3IgPSBhbHRDb2xvcnNbMV07IH1cbiAgfSxcblxuICBwYXJzZUxpbmU6IGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgIHZhciBjb2xzID0gQkVEX1NUQU5EQVJEX0ZJRUxEUyxcbiAgICAgIG51bVN0YW5kYXJkQ29scyA9IHRoaXMubnVtU3RhbmRhcmRDb2x1bW5zLFxuICAgICAgYmVkUGx1c0ZpZWxkcyA9IHRoaXMub3B0cy5iZWRQbHVzRmllbGRzIHx8IEJFRF9ERVRBSUxfRklFTERTLFxuICAgICAgZmVhdHVyZSA9IHtleHRyYToge319LFxuICAgICAgZmllbGRzID0gL1xcdC8udGVzdChsaW5lKSA/IGxpbmUuc3BsaXQoXCJcXHRcIikgOiBsaW5lLnNwbGl0KC9cXHMrLyksXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgaWYgKHRoaXMub3B0cy5kZXRhaWwpIHtcbiAgICAgIG51bVN0YW5kYXJkQ29scyA9IE1hdGgubWluKGZpZWxkcy5sZW5ndGggLSAyLCAxMik7XG4gICAgICBiZWRQbHVzRmllbGRzID0gQkVEX0RFVEFJTF9GSUVMRFM7XG4gICAgfVxuICAgIF8uZWFjaChmaWVsZHMsIGZ1bmN0aW9uKHYsIGkpIHtcbiAgICAgIHZhciBiZWRQbHVzRmllbGQgPSBpIC0gbnVtU3RhbmRhcmRDb2xzO1xuICAgICAgaWYgKG51bVN0YW5kYXJkQ29scyAmJiBpIDwgbnVtU3RhbmRhcmRDb2xzKSB7IGZlYXR1cmVbY29sc1tpXV0gPSB2OyB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgaWYgKGJlZFBsdXNGaWVsZHMgJiYgaSAtIG51bVN0YW5kYXJkQ29scyA8IGJlZFBsdXNGaWVsZHMubGVuZ3RoKSB7IGJlZFBsdXNGaWVsZCA9IGJlZFBsdXNGaWVsZHNbaSAtIG51bVN0YW5kYXJkQ29sc107IH1cbiAgICAgICAgaWYgKF8uY29udGFpbnMoQkVEX0RFVEFJTF9GSUVMRFMsIGJlZFBsdXNGaWVsZCkpIHsgZmVhdHVyZVtiZWRQbHVzRmllbGRdID0gdjsgfVxuICAgICAgICBlbHNlIHsgZmVhdHVyZS5leHRyYVtiZWRQbHVzRmllbGRdID0gdjsgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUuY2hyb21dO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHsgXG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgJ1wiK2ZlYXR1cmUuY2hyb20rXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbVN0YXJ0KSArIDE7XG4gICAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbUVuZCkgKyAxO1xuICAgICAgaWYgKGZlYXR1cmUuZW5kID09PSBmZWF0dXJlLnN0YXJ0KSB7IGZlYXR1cmUuZW5kICs9IDAuMTsgZmVhdHVyZS56ZXJvV2lkdGggPSB0cnVlOyB9XG4gICAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgICAvLyBmYW5jaWVyIEJFRCBmZWF0dXJlcyB0byBleHByZXNzIGNvZGluZyByZWdpb25zIGFuZCBleG9ucy9pbnRyb25zXG4gICAgICBpZiAoL15cXGQrJC8udGVzdChmZWF0dXJlLnRoaWNrU3RhcnQpICYmIC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja0VuZCkpIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnRoaWNrU3RhcnQpICsgMTtcbiAgICAgICAgZmVhdHVyZS50aGlja0VuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja0VuZCkgKyAxO1xuICAgICAgICBpZiAoL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTaXplcykgJiYgL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTdGFydHMpKSB7XG4gICAgICAgICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICAgICAgICBibG9ja1NpemVzID0gZmVhdHVyZS5ibG9ja1NpemVzLnNwbGl0KC8sLyk7XG4gICAgICAgICAgXy5lYWNoKGZlYXR1cmUuYmxvY2tTdGFydHMuc3BsaXQoLywvKSwgZnVuY3Rpb24oc3RhcnQsIGkpIHtcbiAgICAgICAgICAgIGlmIChzdGFydCA9PT0gJycpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyBwYXJzZUludDEwKHN0YXJ0KX07XG4gICAgICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIHBhcnNlSW50MTAoYmxvY2tTaXplc1tpXSk7XG4gICAgICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSk7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSwgbGluZW5vKTtcbiAgICAgIGlmIChmZWF0dXJlKSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgc3RhY2tlZExheW91dDogZnVuY3Rpb24oaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKSB7XG4gICAgLy8gQSBsaW5lTnVtIGZ1bmN0aW9uIGNhbiBiZSBwcm92aWRlZCB3aGljaCBjYW4gc2V0L3JldHJpZXZlIHRoZSBsaW5lIG9mIGFscmVhZHkgcmVuZGVyZWQgZGF0YXBvaW50c1xuICAgIC8vIHNvIGFzIHRvIG5vdCBicmVhayBhIHJhbmdlZCBmZWF0dXJlIHRoYXQgZXh0ZW5kcyBvdmVyIG11bHRpcGxlIHRpbGVzLlxuICAgIGxpbmVOdW0gPSBfLmlzRnVuY3Rpb24obGluZU51bSkgPyBsaW5lTnVtIDogZnVuY3Rpb24oKSB7IHJldHVybjsgfTtcbiAgICB2YXIgbGluZXMgPSBbXSxcbiAgICAgIG1heEV4aXN0aW5nTGluZSA9IF8ubWF4KF8ubWFwKGludGVydmFscywgZnVuY3Rpb24odikgeyByZXR1cm4gbGluZU51bSh2LmRhdGEpIHx8IDA7IH0pKSArIDEsXG4gICAgICBzb3J0ZWRJbnRlcnZhbHMgPSBfLnNvcnRCeShpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgdmFyIGxuID0gbGluZU51bSh2LmRhdGEpOyByZXR1cm4gXy5pc1VuZGVmaW5lZChsbikgPyAxIDogLWxuOyB9KTtcbiAgICBcbiAgICB3aGlsZSAobWF4RXhpc3RpbmdMaW5lLS0+MCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgXy5lYWNoKHNvcnRlZEludGVydmFscywgZnVuY3Rpb24odikge1xuICAgICAgdmFyIGQgPSB2LmRhdGEsXG4gICAgICAgIGxuID0gbGluZU51bShkKSxcbiAgICAgICAgcEludCA9IGNhbGNQaXhJbnRlcnZhbChkKSxcbiAgICAgICAgdGhpY2tJbnQgPSBkLnRoaWNrU3RhcnQgIT09IG51bGwgJiYgY2FsY1BpeEludGVydmFsKHtzdGFydDogZC50aGlja1N0YXJ0LCBlbmQ6IGQudGhpY2tFbmR9KSxcbiAgICAgICAgYmxvY2tJbnRzID0gZC5ibG9ja3MgIT09IG51bGwgJiYgIF8ubWFwKGQuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpLFxuICAgICAgICBpID0gMCxcbiAgICAgICAgbCA9IGxpbmVzLmxlbmd0aDtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChsbikpIHtcbiAgICAgICAgaWYgKGxpbmVzW2xuXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyBjb25zb2xlLmxvZyhcIlVucmVzb2x2YWJsZSBMaW5lTWFzayBjb25mbGljdCFcIik7IH1cbiAgICAgICAgbGluZXNbbG5dLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hpbGUgKGkgPCBsICYmIGxpbmVzW2ldLmNvbmZsaWN0KHBJbnQudHgsIHBJbnQudHcpKSB7ICsraTsgfVxuICAgICAgICBpZiAoaSA9PSBsKSB7IGxpbmVzLnB1c2gobmV3IExpbmVNYXNrKHdpZHRoLCA1KSk7IH1cbiAgICAgICAgbGluZU51bShkLCBpKTtcbiAgICAgICAgbGluZXNbaV0uYWRkKHBJbnQudHgsIHBJbnQudHcsIHtwSW50OiBwSW50LCB0aGlja0ludDogdGhpY2tJbnQsIGJsb2NrSW50czogYmxvY2tJbnRzLCBkOiBkfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBfLnBsdWNrKGwuaXRlbXMsICdkYXRhJyk7IH0pO1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgaW50ZXJ2YWxzID0gdGhpcy5kYXRhLnNlYXJjaChzdGFydCwgZW5kKSxcbiAgICAgIGRyYXdTcGVjID0gW10sXG4gICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldCkge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldCkpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgdmFyIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwodi5kYXRhKTtcbiAgICAgICAgcEludC52ID0gdi5kYXRhLnNjb3JlO1xuICAgICAgICBkcmF3U3BlYy5wdXNoKHBJbnQpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRyYXdTcGVjID0ge2xheW91dDogdGhpcy50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwodGhpcywgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKX07XG4gICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgLy8gRmlsbHMgb3V0IGEgVVJMIHRlbXBsYXRlIGZvciBhIGZlYXR1cmUgYWNjb3JkaW5nIHRvIHRoZSBzdGFuZGFyZHMgZm9yIHRoZSBgdXJsYCBwYXJhbWV0ZXIgb2YgYSBVQ1NDIHRyYWNrRGJcbiAgLy8gaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3RyYWNrRGIvdHJhY2tEYkh1Yi5odG1sXG4gIGNhbGNVcmw6IGZ1bmN0aW9uKHVybCwgZmVhdHVyZSkge1xuICAgIHZhciBhdXRvSWQgPSAoL1xcdC8pLnRlc3QoZmVhdHVyZS5pZCksXG4gICAgICB0b1JlcGxhY2UgPSB7XG4gICAgICAgICckJCc6IGF1dG9JZCB8fCBfLmlzVW5kZWZpbmVkKGZlYXR1cmUuaWQpID8gZmVhdHVyZS5uYW1lIDogZmVhdHVyZS5pZCxcbiAgICAgICAgJyRUJzogdGhpcy5vcHRzLm5hbWUsXG4gICAgICAgICckUyc6IGZlYXR1cmUuY2hyb20sXG4gICAgICAgICckeyc6IGZlYXR1cmUuY2hyb21TdGFydCxcbiAgICAgICAgJyR9JzogZmVhdHVyZS5jaHJvbUVuZCxcbiAgICAgICAgJyREJzogdGhpcy5icm93c2VyT3B0cy5nZW5vbWUucmVwbGFjZSgvXnVjc2M6fDouKi9pZywgJycpXG4gICAgICB9O1xuICAgIF8uZWFjaCh0b1JlcGxhY2UsIGZ1bmN0aW9uKHJlcGxhY2VtZW50LCBwbGFjZWhvbGRlcikge1xuICAgICAgdXJsID0gdXJsLnJlcGxhY2UocGxhY2Vob2xkZXIsIHJlcGxhY2VtZW50KTtcbiAgICB9KTtcbiAgICByZXR1cm4gdXJsO1xuICB9LFxuICBcbiAgYWRkQXJlYTogZnVuY3Rpb24oYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKSB7XG4gICAgdmFyIHRpcFRpcERhdGEgPSB7fSxcbiAgICAgIHRpcFRpcERhdGFDYWxsYmFjayA9IHRoaXMudHlwZSgpLnRpcFRpcERhdGEsICAgLy8gdGhpcyBwZXJtaXRzIGluaGVyaXRpbmcgdHJhY2sgZm9ybWF0cyB0byBvdmVycmlkZSB0aGVzZVxuICAgICAgY3VzdG9tTmFtZUZ1bmMgPSB0aGlzLnR5cGUoKS5uYW1lRnVuYywgICAgICAgICAvLyBcIiBcIlxuICAgICAgbmFtZUZ1bmMgPSBfLmlzRnVuY3Rpb24oY3VzdG9tTmFtZUZ1bmMpID8gY3VzdG9tTmFtZUZ1bmMgOiB1dGlscy5kZWZhdWx0TmFtZUZ1bmMsXG4gICAgICBhdXRvSWQgPSAoL1xcdC8pLnRlc3QoZGF0YS5kLmlkKTsgICAgICAgICAgICAgICAvLyBPbmx5IGF1dG9tYXRpY2FsbHkgZ2VuZXJhdGVkIGlkJ3MgY291bGQgY29udGFpbiBhIHRhYiBjaGFyYWN0ZXJcbiAgICBpZiAoIWFyZWFzKSB7IHJldHVybjsgfVxuICAgIGlmIChfLmlzRnVuY3Rpb24odGlwVGlwRGF0YUNhbGxiYWNrKSkge1xuICAgICAgdGlwVGlwRGF0YSA9IHRpcFRpcERhdGFDYWxsYmFjay5jYWxsKHRoaXMsIGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmRlc2NyaXB0aW9uKSkgeyB0aXBUaXBEYXRhLmRlc2NyaXB0aW9uID0gZGF0YS5kLmRlc2NyaXB0aW9uOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLnNjb3JlKSAmJiBkYXRhLmQuc2NvcmUgPiAwKSB7IHRpcFRpcERhdGEuc2NvcmUgPSBkYXRhLmQuc2NvcmU7IH1cbiAgICAgIF8uZXh0ZW5kKHRpcFRpcERhdGEsIHtcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH0pO1xuICAgICAgaWYgKHRoaXMub3B0cy5iZWRQbHVzRmllbGRzKSB7IF8uZXh0ZW5kKHRpcFRpcERhdGEsIF8ub21pdChkYXRhLmQuZXh0cmEsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHYgPT09ICcnOyB9KSk7IH1cbiAgICAgIC8vIERpc3BsYXkgdGhlIElEIGNvbHVtbiAoZnJvbSBiZWREZXRhaWwpIHVubGVzcyBpdCB3YXMgYXV0b21hdGljYWxseSBnZW5lcmF0ZWRcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuaWQpICYmICFhdXRvSWQpIHsgdGlwVGlwRGF0YS5pZCA9IGRhdGEuZC5pZDsgfVxuICAgIH1cbiAgICBhcmVhcy5wdXNoKFtcbiAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvLyB4MSwgeTEsIHgyLCB5MlxuICAgICAgbmFtZUZ1bmMoZGF0YS5kKSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5hbWVcbiAgICAgIHRoaXMudHlwZSgnYmVkJykuY2FsY1VybC5jYWxsKHRoaXMsIHVybFRlbXBsYXRlLCBkYXRhLmQpLCAgICAgICAgICAgICAgICAgICAgICAgICAvLyBocmVmXG4gICAgICBkYXRhLnBJbnQub1ByZXYsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgIHRoaXMudHlwZSgnYmVkJykuY2FsY0ZlYXR1cmVDb2xvci5jYWxsKHRoaXMsIGRhdGEpIHx8IG51bGwsXG4gICAgICBudWxsLFxuICAgICAgdGlwVGlwRGF0YVxuICAgIF0pO1xuICB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhbiBhbHBoYSB2YWx1ZSBiZXR3ZWVuIDAuMiBhbmQgMS4wXG4gIGNhbGNBbHBoYTogZnVuY3Rpb24odmFsdWUpIHsgcmV0dXJuIE1hdGgubWF4KHZhbHVlLCAxNjYpLzEwMDA7IH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGEgY29sb3Igc2NhbGVkIGJldHdlZW4gI2NjY2NjYyBhbmQgbWF4IENvbG9yXG4gIGNhbGNHcmFkaWVudDogZnVuY3Rpb24obWF4Q29sb3IsIHZhbHVlKSB7XG4gICAgdmFyIG1pbkNvbG9yID0gWzIzMCwyMzAsMjMwXSxcbiAgICAgIHZhbHVlQ29sb3IgPSBbXTtcbiAgICBpZiAoIV8uaXNBcnJheShtYXhDb2xvcikpIHsgbWF4Q29sb3IgPSBfLm1hcChtYXhDb2xvci5zcGxpdCgnLCcpLCBwYXJzZUludDEwKTsgfVxuICAgIF8uZWFjaChtaW5Db2xvciwgZnVuY3Rpb24odiwgaSkgeyB2YWx1ZUNvbG9yW2ldID0gKHYgLSBtYXhDb2xvcltpXSkgKiAoKDEwMDAgLSB2YWx1ZSkgLyAxMDAwLjApICsgbWF4Q29sb3JbaV07IH0pO1xuICAgIHJldHVybiBfLm1hcCh2YWx1ZUNvbG9yLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gIH0sXG4gIFxuICBjYWxjRmVhdHVyZUNvbG9yOiBmdW5jdGlvbihpdHZsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNvbG9yID0gby5jb2xvcjtcbiAgICBpZiAoby5hbHRDb2xvciAmJiBpdHZsLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IG8uYWx0Q29sb3I7IH1cbiAgICBpZiAoby5pdGVtUmdiICYmIGl0dmwuZC5pdGVtUmdiICYmIHRoaXMudmFsaWRhdGVDb2xvcihpdHZsLmQuaXRlbVJnYikpIHsgY29sb3IgPSBpdHZsLmQuaXRlbVJnYjsgfVxuICAgIGlmIChvLnVzZVNjb3JlKSB7IGNvbG9yID0gc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIGl0dmwuZC5zY29yZSk7IH1cbiAgICByZXR1cm4gY29sb3I7XG4gIH0sXG4gIFxuICBkcmF3QXJyb3dzOiBmdW5jdGlvbihjdHgsIGNhbnZhc1dpZHRoLCBsaW5lWSwgaGFsZkhlaWdodCwgc3RhcnRYLCBlbmRYLCBkaXJlY3Rpb24pIHtcbiAgICB2YXIgYXJyb3dIZWlnaHQgPSBNYXRoLm1pbihoYWxmSGVpZ2h0LCAzKSxcbiAgICAgIFgxLCBYMjtcbiAgICBzdGFydFggPSBNYXRoLm1heChzdGFydFgsIDApO1xuICAgIGVuZFggPSBNYXRoLm1pbihlbmRYLCBjYW52YXNXaWR0aCk7XG4gICAgaWYgKGVuZFggLSBzdGFydFggPCA1KSB7IHJldHVybjsgfSAvLyBjYW4ndCBkcmF3IGFycm93cyBpbiB0aGF0IG5hcnJvdyBvZiBhIHNwYWNlXG4gICAgaWYgKGRpcmVjdGlvbiAhPT0gJysnICYmIGRpcmVjdGlvbiAhPT0gJy0nKSB7IHJldHVybjsgfSAvLyBpbnZhbGlkIGRpcmVjdGlvblxuICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAvLyBBbGwgdGhlIDAuNSdzIGhlcmUgYXJlIGR1ZSB0byA8Y2FudmFzPidzIHNvbWV3aGF0IHNpbGx5IGNvb3JkaW5hdGUgc3lzdGVtIFxuICAgIC8vIGh0dHA6Ly9kaXZlaW50b2h0bWw1LmluZm8vY2FudmFzLmh0bWwjcGl4ZWwtbWFkbmVzc1xuICAgIFgxID0gZGlyZWN0aW9uID09ICcrJyA/IDAuNSA6IGFycm93SGVpZ2h0ICsgMC41O1xuICAgIFgyID0gZGlyZWN0aW9uID09ICcrJyA/IGFycm93SGVpZ2h0ICsgMC41IDogMC41O1xuICAgIGZvciAodmFyIGkgPSBNYXRoLmZsb29yKHN0YXJ0WCkgKyAyOyBpIDwgZW5kWCAtIGFycm93SGVpZ2h0OyBpICs9IDcpIHtcbiAgICAgIGN0eC5tb3ZlVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgLSBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMiwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgKyBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgfVxuICAgIGN0eC5zdHJva2UoKTtcbiAgfSxcbiAgXG4gIGRyYXdGZWF0dXJlOiBmdW5jdGlvbihjdHgsIHdpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIGNvbG9yID0gby5jb2xvcixcbiAgICAgIHkgPSBpICogbGluZUhlaWdodCxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgcXVhcnRlckhlaWdodCA9IE1hdGguY2VpbCgwLjI1ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIHRoaWNrT3ZlcmxhcCA9IG51bGwsXG4gICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGNvbG9yID0gc2VsZi50eXBlKCdiZWQnKS5jYWxjRmVhdHVyZUNvbG9yLmNhbGwoc2VsZiwgZGF0YSk7XG4gICAgaWYgKG8uaXRlbVJnYiB8fCBvLmFsdENvbG9yIHx8IG8udXNlU2NvcmUpIHsgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjsgfVxuICAgIFxuICAgIGlmIChkYXRhLnRoaWNrSW50KSB7XG4gICAgICAvLyBUaGUgY29kaW5nIHJlZ2lvbiBpcyBkcmF3biBhcyBhIHRoaWNrZXIgbGluZSB3aXRoaW4gdGhlIGdlbmVcbiAgICAgIGlmIChkYXRhLmJsb2NrSW50cykge1xuICAgICAgICAvLyBJZiB0aGVyZSBhcmUgZXhvbnMgYW5kIGludHJvbnMsIGRyYXcgdGhlIGludHJvbnMgd2l0aCBhIDFweCBsaW5lXG4gICAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCwgZGF0YS5wSW50LncsIDEpO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBjb2xvcjtcbiAgICAgICAgXy5lYWNoKGRhdGEuYmxvY2tJbnRzLCBmdW5jdGlvbihiSW50KSB7XG4gICAgICAgICAgaWYgKGJJbnQudyA+IDAgJiYgYkludC54ICsgYkludC53IDw9IHdpZHRoICYmIGJJbnQueCA+PSAwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBNYXRoLm1heChiSW50LncsIDEpLCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlja092ZXJsYXAgPSBkYXRhLnRoaWNrSW50LncgPiAwICYmIHV0aWxzLnBpeEludGVydmFsT3ZlcmxhcChiSW50LCBkYXRhLnRoaWNrSW50KTtcbiAgICAgICAgICBpZiAodGhpY2tPdmVybGFwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QodGhpY2tPdmVybGFwLngsIHkgKyAxLCBNYXRoLm1heCh0aGlja092ZXJsYXAudywgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGludHJvbnMsIGFycm93cyBhcmUgZHJhd24gb24gdGhlIGludHJvbnMsIG5vdCB0aGUgZXhvbnMuLi5cbiAgICAgICAgICBpZiAoZGF0YS5kLnN0cmFuZCAmJiBwcmV2QkludCkge1xuICAgICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIHByZXZCSW50LnggKyBwcmV2QkludC53LCBiSW50LngsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwcmV2QkludCA9IGJJbnQ7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyAuLi51bmxlc3MgdGhlcmUgd2VyZSBubyBpbnRyb25zLiBUaGVuIGl0IGlzIGRyYXduIG9uIHRoZSBjb2RpbmcgcmVnaW9uLlxuICAgICAgICBpZiAoZGF0YS5ibG9ja0ludHMubGVuZ3RoID09IDEpIHtcbiAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gV2UgaGF2ZSBhIGNvZGluZyByZWdpb24gYnV0IG5vIGludHJvbnMvZXhvbnNcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEudGhpY2tJbnQueCwgeSArIDEsIGRhdGEudGhpY2tJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE5vdGhpbmcgZmFuY3kuICBJdCdzIGEgYm94LlxuICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCB5ICsgMSwgTWF0aC5tYXgoZGF0YS5wSW50LncsIDEpLCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS5wSW50LngsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHNlbGYub3B0cy51cmwgPyBzZWxmLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNSA6IDYsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBcbiAgICBpZiAodXJsVGVtcGxhdGUubWF0Y2goLyVzLykpIHsgdXJsVGVtcGxhdGUucmVwbGFjZSgvJXMvLCAnJCQnKTsgfVxuICAgIGVsc2UgaWYgKCF1cmxUZW1wbGF0ZS5tYXRjaCgvXFwkXFwkLykpIHsgdXJsVGVtcGxhdGUgKz0gJyQkJzsgfVxuICAgIFxuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIC8vIFRPRE86IEkgZGlzYWJsZWQgcmVnZW5lcmF0aW5nIGFyZWFzIGhlcmUsIHdoaWNoIGFzc3VtZXMgdGhhdCBsaW5lTnVtIHJlbWFpbnMgc3RhYmxlIGFjcm9zcyByZS1yZW5kZXJzLiBTaG91bGQgY2hlY2sgb24gdGhpcy5cbiAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycgJiYgIXNlbGYuYXJlYXNbY2FudmFzLmlkXSkgeyBhcmVhcyA9IHNlbGYuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgXG4gICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgY2FudmFzLmhlaWdodCA9IDE1O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgIGlmIChzZWxmLm9wdHMudXNlU2NvcmUpIHsgY3R4LmZpbGxTdHlsZSA9IFwicmdiYShcIitzZWxmLnR5cGUoJ2JlZCcpLmNhbGNHcmFkaWVudChjb2xvciwgcEludC52KStcIilcIjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QocEludC54LCAxLCBwSW50LncsIDEzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sYXlvdXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkgfHwgZHJhd1NwZWMudG9vTWFueSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIC8vIFRoaXMgYXBwbGllcyBzdHlsaW5nIHRoYXQgaW5kaWNhdGVzIHRoZXJlIHdhcyB0b28gbXVjaCBkYXRhIHRvIGxvYWQvZHJhdyBhbmQgdGhhdCB0aGUgdXNlciBuZWVkcyB0byB6b29tIHRvIHNlZSBtb3JlXG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodDtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdGZWF0dXJlLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCk7ICAgICAgICAgICAgICBcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmFkZEFyZWEuY2FsbChzZWxmLCBhcmVhcywgZGF0YSwgaSwgbGluZUhlaWdodCwgdXJsVGVtcGxhdGUpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCkuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gL1xcZCssXFxkKyxcXGQrXFxzK1xcZCssXFxkKyxcXGQrLy50ZXN0KG8uY29sb3JCeVN0cmFuZCksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gY29sb3JCeVN0cmFuZE9uID8gby5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLylbMV0gOiAnMCwwLDAnO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZE9uXScpLmF0dHIoJ2NoZWNrZWQnLCAhIWNvbG9yQnlTdHJhbmRPbik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbChjb2xvckJ5U3RyYW5kKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmF0dHIoJ2NoZWNrZWQnLCB0aGlzLmlzT24oby51c2VTY29yZSkpOyAgICBcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoby51cmwpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbG9yQnlTdHJhbmRPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZE9uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgY29sb3JCeVN0cmFuZCA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZF0nKS52YWwoKSxcbiAgICAgIHZhbGlkQ29sb3JCeVN0cmFuZCA9IHRoaXMudmFsaWRhdGVDb2xvcihjb2xvckJ5U3RyYW5kKTtcbiAgICBvLmNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gJiYgdmFsaWRDb2xvckJ5U3RyYW5kID8gby5jb2xvciArICcgJyArIGNvbG9yQnlTdHJhbmQgOiAnJztcbiAgICBvLnVzZVNjb3JlID0gJGRpYWxvZy5maW5kKCdbbmFtZT11c2VTY29yZV0nKS5pcygnOmNoZWNrZWQnKSA/IDEgOiAwO1xuICAgIG8udXJsID0gJGRpYWxvZy5maW5kKCdbbmFtZT11cmxdJykudmFsKCk7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJlZEZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJlZEdyYXBoIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmVkZ3JhcGguaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgd2lnZ2xlXzAgPSByZXF1aXJlKCcuL3dpZ2dsZV8wLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRncmFwaFxuLy8gQmVjYXVzZSBiZWRncmFwaCBpcyBmdW5jdGlvbmFsbHkgZXF1aXZhbGVudCB0byB3aWdnbGVfMCwgd2UgaW5oZXJpdCBmcm9tIGl0IGFuZCBcbi8vIG9ubHkgb3ZlcnJpZGUgdGhlIC5wYXJzZSgpIGZ1bmN0aW9uXG52YXIgQmVkR3JhcGhGb3JtYXQgPSBfLmV4dGVuZCh7fSwgd2lnZ2xlXzAsIHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICdkYXRhVmFsdWUnXSxcbiAgICAgICAgZGF0dW0gPSB7fSxcbiAgICAgICAgY2hyUG9zLCBzdGFydCwgZW5kLCB2YWw7XG4gICAgICBfLmVhY2gobGluZS5zcGxpdCgvXFxzKy8pLCBmdW5jdGlvbih2LCBpKSB7IGRhdHVtW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tkYXR1bS5jaHJvbV07XG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgfVxuICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGRhdHVtLmNocm9tU3RhcnQpO1xuICAgICAgZW5kID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbUVuZCk7XG4gICAgICB2YWwgPSBwYXJzZUZsb2F0KGRhdHVtLmRhdGFWYWx1ZSk7XG4gICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgZW5kLCB2YWw6IHZhbH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9XG4gIFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkR3JhcGhGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ0JlZCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ0JlZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmlnYmVkXG52YXIgQmlnQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnQmVkIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBhamF4VXJsID0gc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsXG4gICAgICByZW1vdGU7XG4gICAgXG4gICAgcmVtb3RlID0gbmV3IFJlbW90ZVRyYWNrKGNhY2hlLCBmdW5jdGlvbihzdGFydCwgZW5kLCBzdG9yZUludGVydmFscykge1xuICAgICAgcmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgZGVuc2l0eTogJ3BhY2snfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgXG4gICAgICAgICAgICB2YXIgaXR2bCA9IHNlbGYudHlwZSgnYmVkJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7XG4gICAgICAgICAgICAvLyBVc2UgQmlvUGVybCdzIEJpbzo6REI6QmlnQmVkIHN0cmF0ZWd5IGZvciBkZWR1cGxpY2F0aW5nIHJlLWZldGNoZWQgaW50ZXJ2YWxzOlxuICAgICAgICAgICAgLy8gXCJCZWNhdXNlIEJFRCBmaWxlcyBkb24ndCBhY3R1YWxseSB1c2UgSURzLCB0aGUgSUQgaXMgY29uc3RydWN0ZWQgZnJvbSB0aGUgZmVhdHVyZSdzIG5hbWUgKGlmIGFueSksIGNocm9tb3NvbWUgY29vcmRpbmF0ZXMsIHN0cmFuZCBhbmQgYmxvY2sgY291bnQuXCJcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGl0dmwuaWQpKSB7XG4gICAgICAgICAgICAgIGl0dmwuaWQgPSBbaXR2bC5uYW1lLCBpdHZsLmNocm9tLCBpdHZsLmNocm9tU3RhcnQsIGl0dmwuY2hyb21FbmQsIGl0dmwuc3RyYW5kLCBpdHZsLmJsb2NrQ291bnRdLmpvaW4oXCJcXHRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaXR2bDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIEJlZm9yZSB0aGUgUmVtb3RlVHJhY2sgY2FuIHN0YXJ0IGNhY2hpbmcgZGF0YSwgd2UgbmVlZCB0byB1c2UgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiaWdCZWQgdHJhY2sgdG8gc2V0dXAgaXRzIGJpbm5pbmcgc2NoZW1lLlxuICAvLyBXZSBkZWZlciB0aGlzIGluIGEgLmZpbmlzaFNldHVwKCkgbWV0aG9kIGJlY2F1c2UgaXQncyBwb3RlbnRpYWxseSBleHBlbnNpdmUgSFRUUCBHRVQgdGhhdCBpcyBvbmx5IG5lY2Vzc2FyeSBpZiB0aGUgdHJhY2tcbiAgLy8gaXMgYWN0dWFsbHkgZ29pbmcgdG8gYmUgZGlzcGxheWVkIGluIHRoZSBicm93c2VyLlxuICBmaW5pc2hTZXR1cDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLFxuICAgICAgcmVtb3RlID0gc2VsZi5kYXRhLnJlbW90ZTtcbiAgICBcbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICBkYXRhOiB7IHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwgfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgLy8gU2V0IG1heEZldGNoV2luZG93IHRvIGF2b2lkIG92ZXJmZXRjaGluZyBkYXRhLlxuICAgICAgICBpZiAoIXNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgICAgIHZhciBtZWFuSXRlbXNQZXJCcCA9IGRhdGEuaXRlbUNvdW50IC8gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhzZWxmLm9wdHMuZHJhd0xpbWl0KSk7XG4gICAgICAgICAgc2VsZi5vcHRzLm1heEZldGNoV2luZG93ID0gbWF4SXRlbXNUb0RyYXcgLyBtZWFuSXRlbXNQZXJCcDtcbiAgICAgICAgICBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93ID0gTWF0aC5mbG9vcihzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgLyAzKTtcbiAgICAgICAgfVxuICAgICAgICByZW1vdGUuc2V0dXBCaW5zKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSwgc2VsZi5vcHRzLm9wdGltYWxGZXRjaFdpbmRvdywgc2VsZi5vcHRzLm1heEZldGNoV2luZG93KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICByYW5nZSA9IHRoaXMuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXRUbykge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldFRvKSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldFRvKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBmdW5jdGlvbiBwYXJzZURlbnNlRGF0YShkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSwgXG4gICAgICAgIGxpbmVzO1xuICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCB4KSB7IFxuICAgICAgICBpZiAobGluZSAhPSAnbi9hJyAmJiBsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5wdXNoKHt4OiB4LCB3OiAxLCB2OiBwYXJzZUZsb2F0KGxpbmUpICogMTAwMH0pOyB9IFxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICAgIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiBkZW5zaXR5IGlzIG5vdCAnZGVuc2UnIGFuZCB3ZSBjYW4gcmVhc29uYWJseVxuICAgIC8vIGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbWFueSByb3dzICg+NTAwIGZlYXR1cmVzKSwgYXMgdGhpcyB3aWxsIG9ubHkgZGVsYXkgb3RoZXIgcmVxdWVzdHMuXG4gICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJyAmJiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgPiAwICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLCB7XG4gICAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCBkZW5zaXR5OiBkZW5zaXR5fSxcbiAgICAgICAgICBzdWNjZXNzOiBwYXJzZURlbnNlRGF0YVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgICB2YXIgY2FsY1BpeEludGVydmFsLCBkcmF3U3BlYyA9IHt9O1xuICAgICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5ID09ICdwYWNrJyk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKTtcbiAgICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnQmVkRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdCZWQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdCZWQuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIGJpZ2JlZCA9IHJlcXVpcmUoJy4vYmlnYmVkLmpzJylcbiAgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHN0cmlwID0gdXRpbHMuc3RyaXA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJpZ2dlbmVwcmVkXG52YXIgQmlnR2VuZVByZWRGb3JtYXQgPSBfLmV4dGVuZCh7fSwgYmlnYmVkLCB7XG4gIFxuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihpdHZsKSB7XG4gICAgdmFyIHRpcFRpcERhdGEgPSB7fTtcbiAgICBpZiAoIV8uaXNVbmRlZmluZWQoaXR2bC5kLmV4dHJhLmdlbmVOYW1lMikpIHsgdGlwVGlwRGF0YS5kZXNjcmlwdGlvbiA9IGl0dmwuZC5leHRyYS5nZW5lTmFtZTI7IH1cbiAgICBfLmV4dGVuZCh0aXBUaXBEYXRhLCB7XG4gICAgICBpZDogaXR2bC5kLm5hbWUsXG4gICAgICBwb3NpdGlvbjogaXR2bC5kLmNocm9tICsgJzonICsgaXR2bC5kLmNocm9tU3RhcnQsIFxuICAgICAgc2l6ZTogaXR2bC5kLmNocm9tRW5kIC0gaXR2bC5kLmNocm9tU3RhcnRcbiAgICB9KTtcbiAgICBpZiAoIV8uaXNVbmRlZmluZWQoaXR2bC5kLnNjb3JlKSAmJiBpdHZsLmQuc2NvcmUgPiAwKSB7IHRpcFRpcERhdGEuc2NvcmUgPSBpdHZsLmQuc2NvcmU7IH1cbiAgICByZXR1cm4gdGlwVGlwRGF0YTtcbiAgfSxcblxuICBuYW1lRnVuYzogZnVuY3Rpb24oZCkge1xuICAgIHJldHVybiBzdHJpcChkLmV4dHJhLm5hbWUyIHx8IGQuZXh0cmEuZ2VuZU5hbWUgfHwgZC5uYW1lIHx8IGQuaWQgfHwgJycpO1xuICB9XG4gIFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnR2VuZVByZWRGb3JtYXQ7IiwiXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdXaWcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdXaWcuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEJpZ1dpZ0Zvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJzEyOCwxMjgsMTI4JyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIGJpZ1dpZyB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogeydtaW5pbXVtJzoxLCAnbWF4aW11bSc6MSwgJ21lYW4nOjEsICdtaW4nOjEsICdtYXgnOjEsICdzdGQnOjEsICdjb3ZlcmFnZSc6MX0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyBcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgLy8gdGhpcy5zY2FsZXMgbmVlZHMgdG8gYmUgc3luY2hlZCBiYWNrIHRvIHRoZSBET00gc2lkZSBzbyB0aGUgJC51aS5nZW5vdHJhY2sgY2FuIHVwZGF0ZSBpdFxuICAgIHRoaXMuc3luY1Byb3BzKFsnb3B0cycsICdkcmF3UmFuZ2UnLCAnc2NhbGVzJ10pOyAvLyBGSVhNRTogTW92ZSB0byB3aWdnbGVfMD9cbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHNlbGYub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIFRoZSBvbmx5IGdhaW4gb2YgZ2V0dGluZyBpbmZvIG9uIHRoZSBiaWdXaWcgZmlsZSBpcyB0aGF0IHdlIGNhbiBncmFiIHRoZSByYW5nZSBvZiB0aGUgZGF0YSBhbmQgc2V0IHRoaXMuc2NhbGVzLlxuICAvLyBCdXQgaXQncyBleHBlbnNpdmUgdG8gZG8gdGhpcyB1bmxlc3MgdGhlIHRyYWNrIGlzIGdvaW5nIHRvIGJlIGRpc3BsYXllZCwgc28gdGhpcyBpcyBkZWZlcnJlZCB1bnRpbCAuZmluaXNoU2V0dXAoKS5cbiAgZmluaXNoU2V0dXA6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgIGFzeW5jOiBmYWxzZSwgIC8vIFRoaXMgaXMgYWxyaWdodCBzaW5jZSBwYXJzaW5nIG5vcm1hbGx5IGhhcHBlbnMgaW4gYSBXZWIgV29ya2VyXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciByb3dzID0gZGF0YS5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgXy5lYWNoKHJvd3MsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICB2YXIga2V5dmFsID0gci5zcGxpdCgnOiAnKTtcbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWluJykgeyBzZWxmLnJhbmdlWzBdID0gTWF0aC5taW4ocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzBdKTsgfVxuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtYXgnKSB7IHNlbGYucmFuZ2VbMV0gPSBNYXRoLm1heChwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMV0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYudHlwZSgpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgY2hyUmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIGlmIChsaW5lID09ICduL2EnKSB7IGRyYXdTcGVjLmJhcnMucHVzaChudWxsKTsgfVxuICAgICAgICBlbHNlIGlmIChsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5iYXJzLnB1c2goKHBhcnNlRmxvYXQobGluZSkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpOyB9XG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge3JhbmdlOiBjaHJSYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCB3aW5GdW5jOiBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb259LFxuICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgIH0pO1xuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBjYW52YXMuaGVpZ2h0LCB3aWR0aCk7XG4gICAgICBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG5cbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnV2lnRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gZmVhdHVyZVRhYmxlIGZvcm1hdDogaHR0cDovL3d3dy5pbnNkYy5vcmcvZmlsZXMvZmVhdHVyZV90YWJsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBzdHJpcCA9IHV0aWxzLnN0cmlwLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5mZWF0dXJldGFibGVcbnZhciBGZWF0dXJlVGFibGVGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY29sbGFwc2VCeUdlbmU6ICdvZmYnLFxuICAgIGtleUNvbHVtbldpZHRoOiAyMSxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfVxuICB9LFxuICBcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICAgIHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSA9IHRoaXMuaXNPbih0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUpO1xuICAgIHRoaXMuZmVhdHVyZVR5cGVDb3VudHMgPSB7fTtcbiAgfSxcbiAgXG4gIC8vIHBhcnNlcyBvbmUgZmVhdHVyZSBrZXkgKyBsb2NhdGlvbi9xdWFsaWZpZXJzIHJvdyBmcm9tIHRoZSBmZWF0dXJlIHRhYmxlXG4gIHBhcnNlRW50cnk6IGZ1bmN0aW9uKGNocm9tLCBsaW5lcywgc3RhcnRMaW5lTm8pIHtcbiAgICB2YXIgZmVhdHVyZSA9IHtcbiAgICAgICAgY2hyb206IGNocm9tLFxuICAgICAgICBzY29yZTogJz8nLFxuICAgICAgICBibG9ja3M6IG51bGwsXG4gICAgICAgIHF1YWxpZmllcnM6IHt9XG4gICAgICB9LFxuICAgICAga2V5Q29sdW1uV2lkdGggPSB0aGlzLm9wdHMua2V5Q29sdW1uV2lkdGgsXG4gICAgICBxdWFsaWZpZXIgPSBudWxsLFxuICAgICAgZnVsbExvY2F0aW9uID0gW10sXG4gICAgICBjb2xsYXBzZUtleVF1YWxpZmllcnMgPSBbJ2xvY3VzX3RhZycsICdnZW5lJywgJ2RiX3hyZWYnXSxcbiAgICAgIHF1YWxpZmllcnNUaGF0QXJlTmFtZXMgPSBbJ2dlbmUnLCAnbG9jdXNfdGFnJywgJ2RiX3hyZWYnXSxcbiAgICAgIFJOQVR5cGVzID0gWydycm5hJywgJ3RybmEnXSxcbiAgICAgIGFsc29UcnlGb3JSTkFUeXBlcyA9IFsncHJvZHVjdCddLFxuICAgICAgbG9jYXRpb25Qb3NpdGlvbnMsIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tjaHJvbV07XG4gICAgc3RhcnRMaW5lTm8gPSBzdGFydExpbmVObyB8fCAwO1xuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIFxuICAgIC8vIGZpbGwgb3V0IGZlYXR1cmUncyBrZXlzIHdpdGggaW5mbyBmcm9tIHRoZXNlIGxpbmVzXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBrZXkgPSBsaW5lLnN1YnN0cigwLCBrZXlDb2x1bW5XaWR0aCksXG4gICAgICAgIHJlc3RPZkxpbmUgPSBsaW5lLnN1YnN0cihrZXlDb2x1bW5XaWR0aCksXG4gICAgICAgIHF1YWxpZmllck1hdGNoID0gcmVzdE9mTGluZS5tYXRjaCgvXlxcLyhcXHcrKSg9PykoLiopLyk7XG4gICAgICBpZiAoa2V5Lm1hdGNoKC9cXHcvKSkge1xuICAgICAgICBmZWF0dXJlLnR5cGUgPSBzdHJpcChrZXkpO1xuICAgICAgICBxdWFsaWZpZXIgPSBudWxsO1xuICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChxdWFsaWZpZXJNYXRjaCkge1xuICAgICAgICAgIHF1YWxpZmllciA9IHF1YWxpZmllck1hdGNoWzFdO1xuICAgICAgICAgIGlmICghZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0pIHsgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0gPSBbXTsgfVxuICAgICAgICAgIGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdLnB1c2goW3F1YWxpZmllck1hdGNoWzJdID8gcXVhbGlmaWVyTWF0Y2hbM10gOiB0cnVlXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHF1YWxpZmllciAhPT0gbnVsbCkgeyBcbiAgICAgICAgICAgIF8ubGFzdChmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZnVsbExvY2F0aW9uLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgZmVhdHVyZS5mdWxsTG9jYXRpb24gPSBmdWxsTG9jYXRpb24gPSBmdWxsTG9jYXRpb24uam9pbignJyk7XG4gICAgbG9jYXRpb25Qb3NpdGlvbnMgPSBfLm1hcChfLmZpbHRlcihmdWxsTG9jYXRpb24uc3BsaXQoL1xcRCsvKSwgXy5pZGVudGl0eSksIHBhcnNlSW50MTApO1xuICAgIGZlYXR1cmUuY2hyb21TdGFydCA9ICBfLm1pbihsb2NhdGlvblBvc2l0aW9ucyk7XG4gICAgZmVhdHVyZS5jaHJvbUVuZCA9IF8ubWF4KGxvY2F0aW9uUG9zaXRpb25zKSArIDE7IC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hyb21FbmQgY29sdW1ucyBpbiBCRUQgZm9ybWF0IGFyZSAqbm90Ki5cbiAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgZmVhdHVyZS5jaHJvbVN0YXJ0O1xuICAgIGZlYXR1cmUuZW5kID0gY2hyUG9zICsgZmVhdHVyZS5jaHJvbUVuZDsgXG4gICAgZmVhdHVyZS5zdHJhbmQgPSAvY29tcGxlbWVudC8udGVzdChmdWxsTG9jYXRpb24pID8gXCItXCIgOiBcIitcIjtcbiAgICBcbiAgICAvLyBVbnRpbCB3ZSBtZXJnZSBieSBnZW5lIG5hbWUsIHdlIGRvbid0IGNhcmUgYWJvdXQgdGhlc2VcbiAgICBmZWF0dXJlLnRoaWNrU3RhcnQgPSBmZWF0dXJlLnRoaWNrRW5kID0gbnVsbDtcbiAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgXG4gICAgLy8gUGFyc2UgdGhlIHF1YWxpZmllcnMgcHJvcGVybHlcbiAgICBfLmVhY2goZmVhdHVyZS5xdWFsaWZpZXJzLCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICBfLmVhY2godiwgZnVuY3Rpb24oZW50cnlMaW5lcywgaSkge1xuICAgICAgICB2W2ldID0gc3RyaXAoZW50cnlMaW5lcy5qb2luKCcgJykpO1xuICAgICAgICBpZiAoL15cIltcXHNcXFNdKlwiJC8udGVzdCh2W2ldKSkge1xuICAgICAgICAgIC8vIERlcXVvdGUgZnJlZSB0ZXh0XG4gICAgICAgICAgdltpXSA9IHZbaV0ucmVwbGFjZSgvXlwifFwiJC9nLCAnJykucmVwbGFjZSgvXCJcIi9nLCAnXCInKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvL2lmICh2Lmxlbmd0aCA9PSAxKSB7IGZlYXR1cmUucXVhbGlmaWVyc1trXSA9IHZbMF07IH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBGaW5kIHNvbWV0aGluZyB0aGF0IGNhbiBzZXJ2ZSBhcyBhIG5hbWVcbiAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnR5cGU7XG4gICAgaWYgKF8uY29udGFpbnMoUk5BVHlwZXMsIGZlYXR1cmUudHlwZS50b0xvd2VyQ2FzZSgpKSkgeyBcbiAgICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHF1YWxpZmllcnNUaGF0QXJlTmFtZXMsIGFsc29UcnlGb3JSTkFUeXBlcyk7IFxuICAgIH1cbiAgICBfLmZpbmQocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgZnVuY3Rpb24oaykge1xuICAgICAgaWYgKGZlYXR1cmUucXVhbGlmaWVyc1trXSAmJiBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pIHsgcmV0dXJuIChmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pOyB9XG4gICAgfSk7XG4gICAgLy8gSW4gdGhlIHdvcnN0IGNhc2UsIGFkZCBhIGNvdW50ZXIgdG8gZGlzYW1iaWd1YXRlIGZlYXR1cmVzIG5hbWVkIG9ubHkgYnkgdHlwZVxuICAgIGlmIChmZWF0dXJlLm5hbWUgPT0gZmVhdHVyZS50eXBlKSB7XG4gICAgICBpZiAoIXRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSkgeyB0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0gPSAxOyB9XG4gICAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLm5hbWUgKyAnXycgKyB0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0rKztcbiAgICB9XG4gICAgXG4gICAgLy8gRmluZCBhIGtleSB0aGF0IGlzIGFwcHJvcHJpYXRlIGZvciBjb2xsYXBzaW5nXG4gICAgaWYgKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgXy5maW5kKGNvbGxhcHNlS2V5UXVhbGlmaWVycywgZnVuY3Rpb24oaykge1xuICAgICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyBcbiAgICAgICAgICByZXR1cm4gKGZlYXR1cmUuX2NvbGxhcHNlS2V5ID0gZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuICBcbiAgLy8gY29sbGFwc2VzIG11bHRpcGxlIGZlYXR1cmVzIHRoYXQgYXJlIGFib3V0IHRoZSBzYW1lIGdlbmUgaW50byBvbmUgZHJhd2FibGUgZmVhdHVyZVxuICBjb2xsYXBzZUZlYXR1cmVzOiBmdW5jdGlvbihmZWF0dXJlcykge1xuICAgIHZhciBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvcyxcbiAgICAgIHByZWZlcnJlZFR5cGVUb01lcmdlSW50byA9IFsnbXJuYScsICdnZW5lJywgJ2NkcyddLFxuICAgICAgcHJlZmVycmVkVHlwZUZvckV4b25zID0gWydleG9uJywgJ2NkcyddLFxuICAgICAgbWVyZ2VJbnRvID0gZmVhdHVyZXNbMF0sXG4gICAgICBibG9ja3MgPSBbXSxcbiAgICAgIGZvdW5kVHlwZSwgY2RzLCBleG9ucztcbiAgICBmb3VuZFR5cGUgPSBfLmZpbmQocHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICB2YXIgZm91bmQgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IHR5cGU7IH0pO1xuICAgICAgaWYgKGZvdW5kKSB7IG1lcmdlSW50byA9IGZvdW5kOyByZXR1cm4gdHJ1ZTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIExvb2sgZm9yIGV4b25zIChldWthcnlvdGljKSBvciBhIENEUyAocHJva2FyeW90aWMpXG4gICAgXy5maW5kKHByZWZlcnJlZFR5cGVGb3JFeG9ucywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgZXhvbnMgPSBfLnNlbGVjdChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZXhvbnMubGVuZ3RoKSB7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgY2RzID0gXy5maW5kKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSBcImNkc1wiOyB9KTtcbiAgICBcbiAgICBfLmVhY2goZXhvbnMsIGZ1bmN0aW9uKGV4b25GZWF0dXJlKSB7XG4gICAgICBleG9uRmVhdHVyZS5mdWxsTG9jYXRpb24ucmVwbGFjZSgvKFxcZCspXFwuXFwuWz48XT8oXFxkKykvZywgZnVuY3Rpb24oZnVsbE1hdGNoLCBzdGFydCwgZW5kKSB7XG4gICAgICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgICAgICBzdGFydDogY2hyUG9zW2V4b25GZWF0dXJlLmNocm9tXSArIE1hdGgubWluKHN0YXJ0LCBlbmQpLCBcbiAgICAgICAgICAvLyBGZWF0dXJlIHRhYmxlIHJhbmdlcyBhcmUgKmluY2x1c2l2ZSogb2YgdGhlIGVuZCBiYXNlLlxuICAgICAgICAgIGVuZDogY2hyUG9zW2V4b25GZWF0dXJlLmNocm9tXSArICBNYXRoLm1heChzdGFydCwgZW5kKSArIDFcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBDb252ZXJ0IGV4b25zIGFuZCBDRFMgaW50byBibG9ja3MsIHRoaWNrU3RhcnQgYW5kIHRoaWNrRW5kIChpbiBCRUQgdGVybWlub2xvZ3kpXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGgpIHsgXG4gICAgICBtZXJnZUludG8uYmxvY2tzID0gXy5zb3J0QnkoYmxvY2tzLCBmdW5jdGlvbihiKSB7IHJldHVybiBiLnN0YXJ0OyB9KTtcbiAgICAgIG1lcmdlSW50by50aGlja1N0YXJ0ID0gY2RzID8gY2RzLnN0YXJ0IDogZmVhdHVyZS5zdGFydDtcbiAgICAgIG1lcmdlSW50by50aGlja0VuZCA9IGNkcyA/IGNkcy5lbmQgOiBmZWF0dXJlLmVuZDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmluYWxseSwgbWVyZ2UgYWxsIHRoZSBxdWFsaWZpZXJzXG4gICAgXy5lYWNoKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7XG4gICAgICBpZiAoZmVhdCA9PT0gbWVyZ2VJbnRvKSB7IHJldHVybjsgfVxuICAgICAgXy5lYWNoKGZlYXQucXVhbGlmaWVycywgZnVuY3Rpb24odmFsdWVzLCBrKSB7XG4gICAgICAgIGlmICghbWVyZ2VJbnRvLnF1YWxpZmllcnNba10pIHsgbWVyZ2VJbnRvLnF1YWxpZmllcnNba10gPSBbXTsgfVxuICAgICAgICBfLmVhY2godmFsdWVzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgICAgaWYgKCFfLmNvbnRhaW5zKG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLCB2KSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXS5wdXNoKHYpOyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIG1lcmdlSW50bztcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGRhdGEgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KSxcbiAgICAgIG51bUxpbmVzID0gbGluZXMubGVuZ3RoLFxuICAgICAgY2hyb20gPSBudWxsLFxuICAgICAgbGFzdEVudHJ5U3RhcnQgPSBudWxsLFxuICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5ID0ge30sXG4gICAgICBmZWF0dXJlO1xuICAgIFxuICAgIGZ1bmN0aW9uIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKSB7XG4gICAgICBpZiAobGFzdEVudHJ5U3RhcnQgIT09IG51bGwpIHtcbiAgICAgICAgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlRW50cnkuY2FsbChzZWxmLCBjaHJvbSwgbGluZXMuc2xpY2UobGFzdEVudHJ5U3RhcnQsIGxpbmVubyksIGxhc3RFbnRyeVN0YXJ0KTtcbiAgICAgICAgaWYgKGZlYXR1cmUpIHsgXG4gICAgICAgICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgICAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gPSBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldIHx8IFtdO1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XS5wdXNoKGZlYXR1cmUpO1xuICAgICAgICAgIH0gZWxzZSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gQ2h1bmsgdGhlIGxpbmVzIGludG8gZW50cmllcyBhbmQgcGFyc2UgZWFjaCBvZiB0aGVtXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIGlmIChsaW5lLnN1YnN0cigwLCAxMikgPT0gXCJBQ0NFU1NJT04gICBcIikge1xuICAgICAgICBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubyk7XG4gICAgICAgIGNocm9tID0gbGluZS5zdWJzdHIoMTIpO1xuICAgICAgICBsYXN0RW50cnlTdGFydCA9IG51bGw7XG4gICAgICB9IGVsc2UgaWYgKGNocm9tICE9PSBudWxsICYmIGxpbmUuc3Vic3RyKDUsIDEpLm1hdGNoKC9cXHcvKSkge1xuICAgICAgICBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubyk7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbGluZW5vO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHBhcnNlIHRoZSBsYXN0IGVudHJ5XG4gICAgaWYgKGNocm9tICE9PSBudWxsKSB7IGNvbGxlY3RMYXN0RW50cnkobGluZXMubGVuZ3RoKTsgfVxuICAgIFxuICAgIGlmIChvLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmVhY2goZmVhdHVyZXNCeUNvbGxhcHNlS2V5LCBmdW5jdGlvbihmZWF0dXJlcywgZ2VuZSkge1xuICAgICAgICBkYXRhLmFkZChzZWxmLnR5cGUoKS5jb2xsYXBzZUZlYXR1cmVzLmNhbGwoc2VsZiwgZmVhdHVyZXMpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICBzZWxmLmRhdGEgPSBkYXRhO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICAvLyBzcGVjaWFsIGZvcm1hdHRlciBmb3IgY29udGVudCBpbiB0b29sdGlwcyBmb3IgZmVhdHVyZXNcbiAgdGlwVGlwRGF0YTogZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBxdWFsaWZpZXJzVG9BYmJyZXZpYXRlID0ge3RyYW5zbGF0aW9uOiAxfSxcbiAgICAgIGNvbnRlbnQgPSB7XG4gICAgICAgIHR5cGU6IGRhdGEuZC50eXBlLFxuICAgICAgICBwb3NpdGlvbjogZGF0YS5kLmNocm9tICsgJzonICsgZGF0YS5kLmNocm9tU3RhcnQsIFxuICAgICAgICBzaXplOiBkYXRhLmQuY2hyb21FbmQgLSBkYXRhLmQuY2hyb21TdGFydFxuICAgICAgfTtcbiAgICBpZiAoZGF0YS5kLnF1YWxpZmllcnMubm90ZSAmJiBkYXRhLmQucXVhbGlmaWVycy5ub3RlWzBdKSB7ICB9XG4gICAgXy5lYWNoKGRhdGEuZC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2LCBrKSB7XG4gICAgICBpZiAoayA9PSAnbm90ZScpIHsgY29udGVudC5kZXNjcmlwdGlvbiA9IHYuam9pbignOyAnKTsgcmV0dXJuOyB9XG4gICAgICBjb250ZW50W2tdID0gdi5qb2luKCc7ICcpO1xuICAgICAgaWYgKHF1YWxpZmllcnNUb0FiYnJldmlhdGVba10gJiYgY29udGVudFtrXS5sZW5ndGggPiAyNSkgeyBjb250ZW50W2tdID0gY29udGVudFtrXS5zdWJzdHIoMCwgMjUpICsgJy4uLic7IH1cbiAgICB9KTtcbiAgICByZXR1cm4gY29udGVudDtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZlYXR1cmVUYWJsZUZvcm1hdDsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4gIFxudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0OyAgXG5cbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9pbnRlcnZhbC10cmVlXG4gKiBJbnRlcnZhbFRyZWVcbiAqXG4gKiBAcGFyYW0gKG9iamVjdCkgZGF0YTpcbiAqIEBwYXJhbSAobnVtYmVyKSBjZW50ZXI6XG4gKiBAcGFyYW0gKG9iamVjdCkgb3B0aW9uczpcbiAqICAgY2VudGVyOlxuICpcbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsVHJlZShjZW50ZXIsIG9wdGlvbnMpIHtcbiAgb3B0aW9ucyB8fCAob3B0aW9ucyA9IHt9KTtcblxuICB0aGlzLnN0YXJ0S2V5ICAgICA9IG9wdGlvbnMuc3RhcnRLZXkgfHwgMDsgLy8gc3RhcnQga2V5XG4gIHRoaXMuZW5kS2V5ICAgICAgID0gb3B0aW9ucy5lbmRLZXkgICB8fCAxOyAvLyBlbmQga2V5XG4gIHRoaXMuaW50ZXJ2YWxIYXNoID0ge307ICAgICAgICAgICAgICAgICAgICAvLyBpZCA9PiBpbnRlcnZhbCBvYmplY3RcbiAgdGhpcy5wb2ludFRyZWUgPSBuZXcgU29ydGVkTGlzdCh7ICAgICAgICAgIC8vIGItdHJlZSBvZiBzdGFydCwgZW5kIHBvaW50cyBcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGFbMF0tIGJbMF07XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLl9hdXRvSW5jcmVtZW50ID0gMDtcblxuICAvLyBpbmRleCBvZiB0aGUgcm9vdCBub2RlXG4gIGlmICghY2VudGVyIHx8IHR5cGVvZiBjZW50ZXIgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgY2VudGVyIGluZGV4IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7XG4gIH1cblxuICB0aGlzLnJvb3QgPSBuZXcgTm9kZShjZW50ZXIsIHRoaXMpO1xufVxuXG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2VcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgaWYgKHRoaXMuY29udGFpbnMoaWQpKSB7XG4gICAgdGhyb3cgbmV3IER1cGxpY2F0ZUVycm9yKCdpZCAnICsgaWQgKyAnIGlzIGFscmVhZHkgcmVnaXN0ZXJlZC4nKTtcbiAgfVxuXG4gIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICB3aGlsZSAodGhpcy5pbnRlcnZhbEhhc2hbdGhpcy5fYXV0b0luY3JlbWVudF0pIHtcbiAgICAgIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgICB9XG4gICAgaWQgPSB0aGlzLl9hdXRvSW5jcmVtZW50O1xuICB9XG5cbiAgdmFyIGl0dmwgPSBuZXcgSW50ZXJ2YWwoZGF0YSwgaWQsIHRoaXMuc3RhcnRLZXksIHRoaXMuZW5kS2V5KTtcbiAgdGhpcy5wb2ludFRyZWUuaW5zZXJ0KFtpdHZsLnN0YXJ0LCBpZF0pO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuZW5kLCAgIGlkXSk7XG4gIHRoaXMuaW50ZXJ2YWxIYXNoW2lkXSA9IGl0dmw7XG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgXG4gIF9pbnNlcnQuY2FsbCh0aGlzLCB0aGlzLnJvb3QsIGl0dmwpO1xufTtcblxuXG4vKipcbiAqIGNoZWNrIGlmIHJhbmdlIGlzIGFscmVhZHkgcHJlc2VudCwgYmFzZWQgb24gaXRzIGlkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmNvbnRhaW5zID0gZnVuY3Rpb24oaWQpIHtcbiAgcmV0dXJuICEhdGhpcy5nZXQoaWQpO1xufVxuXG5cbi8qKlxuICogcmV0cmlldmUgYW4gaW50ZXJ2YWwgYnkgaXRzIGlkOyByZXR1cm5zIG51bGwgaWYgaXQgZG9lcyBub3QgZXhpc3RcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaWQpIHtcbiAgcmV0dXJuIHRoaXMuaW50ZXJ2YWxIYXNoW2lkXSB8fCBudWxsO1xufVxuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHRyeSB7XG4gICAgdGhpcy5hZGQoZGF0YSwgaWQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBEdXBsaWNhdGVFcnJvcikgeyByZXR1cm47IH1cbiAgICB0aHJvdyBlO1xuICB9XG59XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKGludGVnZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyKSB7XG4gIHZhciByZXQgPSBbXTtcbiAgaWYgKHR5cGVvZiB2YWwxICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnOiBpbnZhbGlkIGlucHV0Jyk7XG4gIH1cblxuICBpZiAodmFsMiA9PSB1bmRlZmluZWQpIHtcbiAgICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIHZhbDEsIHJldCk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIHZhbDIgPT0gJ251bWJlcicpIHtcbiAgICBfcmFuZ2VTZWFyY2guY2FsbCh0aGlzLCB2YWwxLCB2YWwyLCByZXQpO1xuICB9XG4gIGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcih2YWwxICsgJywnICsgdmFsMiArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuXG4vKipcbiAqIHJlbW92ZTogXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gdGhlIHNoaWZ0LXJpZ2h0LWFuZC1maWxsIG9wZXJhdG9yLCBleHRlbmRlZCBiZXlvbmQgdGhlIHJhbmdlIG9mIGFuIGludDMyXG5mdW5jdGlvbiBfYml0U2hpZnRSaWdodChudW0pIHtcbiAgaWYgKG51bSA+IDIxNDc0ODM2NDcgfHwgbnVtIDwgLTIxNDc0ODM2NDgpIHsgcmV0dXJuIE1hdGguZmxvb3IobnVtIC8gMik7IH1cbiAgcmV0dXJuIG51bSA+Pj4gMTtcbn1cblxuLyoqXG4gKiBfaW5zZXJ0XG4gKiovXG5mdW5jdGlvbiBfaW5zZXJ0KG5vZGUsIGl0dmwpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoaXR2bC5lbmQgPCBub2RlLmlkeCkge1xuICAgICAgaWYgKCFub2RlLmxlZnQpIHtcbiAgICAgICAgbm9kZS5sZWZ0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAobm9kZS5pZHggPCBpdHZsLnN0YXJ0KSB7XG4gICAgICBpZiAoIW5vZGUucmlnaHQpIHtcbiAgICAgICAgbm9kZS5yaWdodCA9IG5ldyBOb2RlKF9iaXRTaGlmdFJpZ2h0KGl0dmwuc3RhcnQgKyBpdHZsLmVuZCksIHRoaXMpO1xuICAgICAgfVxuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBub2RlLmluc2VydChpdHZsKTtcbiAgICB9XG4gIH1cbn1cblxuXG4vKipcbiAqIF9wb2ludFNlYXJjaFxuICogQHBhcmFtIChOb2RlKSBub2RlXG4gKiBAcGFyYW0gKGludGVnZXIpIGlkeCBcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3BvaW50U2VhcmNoKG5vZGUsIGlkeCwgYXJyKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKCFub2RlKSBicmVhaztcbiAgICBpZiAoaWR4IDwgbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5ldmVyeShmdW5jdGlvbihpdHZsKSB7XG4gICAgICAgIHZhciBib29sID0gKGl0dmwuc3RhcnQgPD0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUubGVmdDtcbiAgICB9IGVsc2UgaWYgKGlkeCA+IG5vZGUuaWR4KSB7XG4gICAgICBub2RlLmVuZHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5lbmQgPj0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5tYXAoZnVuY3Rpb24oaXR2bCkgeyBhcnIucHVzaChpdHZsLnJlc3VsdCgpKSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5cblxuLyoqXG4gKiBfcmFuZ2VTZWFyY2hcbiAqIEBwYXJhbSAoaW50ZWdlcikgc3RhcnRcbiAqIEBwYXJhbSAoaW50ZWdlcikgZW5kXG4gKiBAcGFyYW0gKEFycmF5KSBhcnJcbiAqKi9cbmZ1bmN0aW9uIF9yYW5nZVNlYXJjaChzdGFydCwgZW5kLCBhcnIpIHtcbiAgaWYgKGVuZCAtIHN0YXJ0IDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBzdGFydC4gc3RhcnQ6ICcgKyBzdGFydCArICcsIGVuZDogJyArIGVuZCk7XG4gIH1cbiAgdmFyIHJlc3VsdEhhc2ggPSB7fTtcblxuICB2YXIgd2hvbGVXcmFwcyA9IFtdO1xuICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIF9iaXRTaGlmdFJpZ2h0KHN0YXJ0ICsgZW5kKSwgd2hvbGVXcmFwcywgdHJ1ZSk7XG5cbiAgd2hvbGVXcmFwcy5mb3JFYWNoKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgIHJlc3VsdEhhc2hbcmVzdWx0LmlkXSA9IHRydWU7XG4gIH0pO1xuXG5cbiAgdmFyIGlkeDEgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtzdGFydCwgbnVsbF0pO1xuICB3aGlsZSAoaWR4MSA+PSAwICYmIHRoaXMucG9pbnRUcmVlLmFycltpZHgxXVswXSA9PSBzdGFydCkge1xuICAgIGlkeDEtLTtcbiAgfVxuXG4gIHZhciBpZHgyID0gdGhpcy5wb2ludFRyZWUuYnNlYXJjaChbZW5kLCAgIG51bGxdKTtcbiAgdmFyIGxlbiA9IHRoaXMucG9pbnRUcmVlLmFyci5sZW5ndGggLSAxO1xuICB3aGlsZSAoaWR4MiA9PSAtMSB8fCAoaWR4MiA8PSBsZW4gJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDJdWzBdIDw9IGVuZCkpIHtcbiAgICBpZHgyKys7XG4gIH1cblxuICB0aGlzLnBvaW50VHJlZS5hcnIuc2xpY2UoaWR4MSArIDEsIGlkeDIpLmZvckVhY2goZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgaWQgPSBwb2ludFsxXTtcbiAgICByZXN1bHRIYXNoW2lkXSA9IHRydWU7XG4gIH0sIHRoaXMpO1xuXG4gIE9iamVjdC5rZXlzKHJlc3VsdEhhc2gpLmZvckVhY2goZnVuY3Rpb24oaWQpIHtcbiAgICB2YXIgaXR2bCA9IHRoaXMuaW50ZXJ2YWxIYXNoW2lkXTtcbiAgICBhcnIucHVzaChpdHZsLnJlc3VsdChzdGFydCwgZW5kKSk7XG4gIH0sIHRoaXMpO1xuXG59XG5cblxuXG4vKipcbiAqIHN1YmNsYXNzZXNcbiAqIFxuICoqL1xuXG5cbi8qKlxuICogTm9kZSA6IHByb3RvdHlwZSBvZiBlYWNoIG5vZGUgaW4gYSBpbnRlcnZhbCB0cmVlXG4gKiBcbiAqKi9cbmZ1bmN0aW9uIE5vZGUoaWR4KSB7XG4gIHRoaXMuaWR4ID0gaWR4O1xuICB0aGlzLnN0YXJ0cyA9IG5ldyBTb3J0ZWRMaXN0KHtcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbmRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5lbmQgLSBiLmVuZDtcbiAgICAgIHJldHVybiAoYyA8IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBpbnNlcnQgYW4gSW50ZXJ2YWwgb2JqZWN0IHRvIHRoaXMgbm9kZVxuICoqL1xuTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgdGhpcy5zdGFydHMuaW5zZXJ0KGludGVydmFsKTtcbiAgdGhpcy5lbmRzLmluc2VydChpbnRlcnZhbCk7XG59O1xuXG5cblxuLyoqXG4gKiBJbnRlcnZhbCA6IHByb3RvdHlwZSBvZiBpbnRlcnZhbCBpbmZvXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbChkYXRhLCBpZCwgcywgZSkge1xuICB0aGlzLmlkICAgICA9IGlkO1xuICB0aGlzLnN0YXJ0ICA9IGRhdGFbc107XG4gIHRoaXMuZW5kICAgID0gZGF0YVtlXTtcbiAgdGhpcy5kYXRhICAgPSBkYXRhO1xuXG4gIGlmICh0eXBlb2YgdGhpcy5zdGFydCAhPSAnbnVtYmVyJyB8fCB0eXBlb2YgdGhpcy5lbmQgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0LCBlbmQgbXVzdCBiZSBudW1iZXIuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxuXG4gIGlmICggdGhpcy5zdGFydCA+PSB0aGlzLmVuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQgbXVzdCBiZSBzbWFsbGVyIHRoYW4gZW5kLiBzdGFydDogJyArIHRoaXMuc3RhcnQgKyAnLCBlbmQ6ICcgKyB0aGlzLmVuZCk7XG4gIH1cbn1cblxuLyoqXG4gKiBnZXQgcmVzdWx0IG9iamVjdFxuICoqL1xuSW50ZXJ2YWwucHJvdG90eXBlLnJlc3VsdCA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9IHtcbiAgICBpZCAgIDogdGhpcy5pZCxcbiAgICBkYXRhIDogdGhpcy5kYXRhXG4gIH07XG4gIGlmICh0eXBlb2Ygc3RhcnQgPT0gJ251bWJlcicgJiYgdHlwZW9mIGVuZCA9PSAnbnVtYmVyJykge1xuICAgIC8qKlxuICAgICAqIGNhbGMgb3ZlcmxhcHBpbmcgcmF0ZVxuICAgICAqKi9cbiAgICB2YXIgbGVmdCAgPSBNYXRoLm1heCh0aGlzLnN0YXJ0LCBzdGFydCk7XG4gICAgdmFyIHJpZ2h0ID0gTWF0aC5taW4odGhpcy5lbmQsICAgZW5kKTtcbiAgICB2YXIgbGFwTG4gPSByaWdodCAtIGxlZnQ7XG4gICAgcmV0LnJhdGUxID0gbGFwTG4gLyAoZW5kIC0gc3RhcnQpO1xuICAgIHJldC5yYXRlMiA9IGxhcExuIC8gKHRoaXMuZW5kIC0gdGhpcy5zdGFydCk7XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIER1cGxpY2F0ZUVycm9yKG1lc3NhZ2UpIHtcbiAgICB0aGlzLm5hbWUgPSAnRHVwbGljYXRlRXJyb3InO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy5zdGFjayA9IChuZXcgRXJyb3IoKSkuc3RhY2s7XG59XG5EdXBsaWNhdGVFcnJvci5wcm90b3R5cGUgPSBuZXcgRXJyb3I7XG5cbmV4cG9ydHMuSW50ZXJ2YWxUcmVlID0gSW50ZXJ2YWxUcmVlO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IExpbmVNYXNrOiBBICh2ZXJ5IGNoZWFwKSBhbHRlcm5hdGl2ZSB0byBJbnRlcnZhbFRyZWU6IGEgc21hbGwsIDFEIHBpeGVsIGJ1ZmZlciBvZiBvYmplY3RzLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIFxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2s7XG5cbmZ1bmN0aW9uIExpbmVNYXNrKHdpZHRoLCBmdWRnZSkge1xuICB0aGlzLmZ1ZGdlID0gZnVkZ2UgPSAoZnVkZ2UgfHwgMSk7XG4gIHRoaXMuaXRlbXMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSBNYXRoLmNlaWwod2lkdGggLyBmdWRnZSk7XG4gIHRoaXMubWFzayA9IGdsb2JhbC5VaW50OEFycmF5ID8gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpIDogbmV3IEFycmF5KHRoaXMubGVuZ3RoKTtcbn1cblxuTGluZU1hc2sucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHgsIHcsIGRhdGEpIHtcbiAgdmFyIHVwVG8gPSBNYXRoLmNlaWwoKHggKyB3KSAvIHRoaXMuZnVkZ2UpO1xuICB0aGlzLml0ZW1zLnB1c2goe3g6IHgsIHc6IHcsIGRhdGE6IGRhdGF9KTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgdGhpcy5tYXNrW2ldID0gMTsgfVxufTtcblxuTGluZU1hc2sucHJvdG90eXBlLmNvbmZsaWN0ID0gZnVuY3Rpb24oeCwgdykge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIGZvciAodmFyIGkgPSBNYXRoLm1heChmbG9vckhhY2soeCAvIHRoaXMuZnVkZ2UpLCAwKTsgaSA8IE1hdGgubWluKHVwVG8sIHRoaXMubGVuZ3RoKTsgaSsrKSB7IGlmICh0aGlzLm1hc2tbaV0pIHJldHVybiB0cnVlOyB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmV4cG9ydHMuTGluZU1hc2sgPSBMaW5lTWFzaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7ICBcbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnZhciBwYXJzZUludDEwID0gcmVxdWlyZSgnLi91dGlscy5qcycpLnBhcnNlSW50MTA7XG5cbnZhciBQQUlSSU5HX0NBTk5PVF9NQVRFID0gMCxcbiAgUEFJUklOR19NQVRFX09OTFkgPSAxLFxuICBQQUlSSU5HX0RSQVdfQVNfTUFURVMgPSAyO1xuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIFdyYXBzIHR3byBvZiBTaGluIFN1enVraSdzIEludGVydmFsVHJlZXMgdG8gc3RvcmUgaW50ZXJ2YWxzIHRoYXQgKm1heSpcbiAqIGJlIHBhaXJlZC5cbiAqXG4gKiBAc2VlIEludGVydmFsVHJlZSgpXG4gKiovXG5mdW5jdGlvbiBQYWlyZWRJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMsIHBhaXJlZE9wdGlvbnMpIHtcbiAgdmFyIGRlZmF1bHRPcHRpb25zID0ge3N0YXJ0S2V5OiAwLCBlbmRLZXk6IDF9O1xuICBcbiAgdGhpcy51bnBhaXJlZCA9IG5ldyBJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnVucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHt9LCBkZWZhdWx0T3B0aW9ucywgdW5wYWlyZWRPcHRpb25zKTtcbiAgXG4gIHRoaXMucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnBhaXJlZE9wdGlvbnMgPSBfLmV4dGVuZCh7cGFpcmluZ0tleTogJ3FuYW1lJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbid9LCBkZWZhdWx0T3B0aW9ucywgcGFpcmVkT3B0aW9ucyk7XG4gIGlmICh0aGlzLnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydEtleSBmb3IgdW5wYWlyZWRPcHRpb25zIGFuZCBwYWlyZWRPcHRpb25zIG11c3QgYmUgZGlmZmVyZW50IGluIGEgUGFpcmVkSW50ZXJ2YWxUcmVlJyk7XG4gIH1cbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kS2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSBmYWxzZTtcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSB0aGlzLnBhaXJpbmdNYXhEaXN0YW5jZSA9IG51bGw7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogRGlzYWJsZXMgcGFpcmluZy4gRWZmZWN0aXZlbHkgbWFrZXMgdGhpcyBlcXVpdmFsZW50LCBleHRlcm5hbGx5LCB0byBhbiBJbnRlcnZhbFRyZWUuXG4gKiBUaGlzIGlzIHVzZWZ1bCBpZiB3ZSBkaXNjb3ZlciB0aGF0IHRoaXMgZGF0YSBzb3VyY2UgZG9lc24ndCBjb250YWluIHBhaXJlZCByZWFkcy5cbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuZGlzYWJsZVBhaXJpbmcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSB0cnVlO1xuICB0aGlzLnBhaXJlZCA9IHRoaXMudW5wYWlyZWQ7XG59O1xuXG5cbi8qKlxuICogU2V0IGFuIGludGVydmFsIHdpdGhpbiB3aGljaCBwYWlyZWQgbWF0ZXMgd2lsbCBiZSBzYXZlZCBhcyBhIGNvbnRpbnVvdXMgZmVhdHVyZSBpbiAucGFpcmVkXG4gKlxuICogQHBhcmFtIChudW1iZXIpIG1pbjogTWluaW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqIEBwYXJhbSAobnVtYmVyKSBtYXg6IE1heGltdW0gZGlzdGFuY2UsIGluIGJwXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNldFBhaXJpbmdJbnRlcnZhbCA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gIGlmICh0eXBlb2YgbWluICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtaW4gYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heCAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWF4IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHRoaXMucGFpcmluZ01pbkRpc3RhbmNlICE9PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYmUgY2FsbGVkIG9uY2UuIFlvdSBjYW5cXCd0IGNoYW5nZSB0aGUgcGFpcmluZyBpbnRlcnZhbC4nKTsgfVxuICBcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSBtaW47XG4gIHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbWF4O1xufTtcblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICB2YXIgbWF0ZWQgPSBmYWxzZSxcbiAgICBpbmNyZW1lbnQgPSAwLFxuICAgIHVucGFpcmVkU3RhcnQgPSB0aGlzLnVucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICB1bnBhaXJlZEVuZCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSxcbiAgICBwYWlyZWRTdGFydCA9IHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICBwYWlyZWRFbmQgPSB0aGlzLnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZExlbmd0aCA9IGRhdGFbdGhpcy5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgcGFpcmluZ1N0YXRlID0gUEFJUklOR19DQU5OT1RfTUFURSxcbiAgICBuZXdJZCwgcG90ZW50aWFsTWF0ZTtcbiAgXG4gIC8vIC51bnBhaXJlZCBjb250YWlucyBldmVyeSBhbGlnbm1lbnQgYXMgYSBzZXBhcmF0ZSBpbnRlcnZhbC5cbiAgLy8gSWYgaXQgYWxyZWFkeSBjb250YWlucyB0aGlzIGlkLCB3ZSd2ZSBzZWVuIHRoaXMgcmVhZCBiZWZvcmUgYW5kIHNob3VsZCBkaXNyZWdhcmQuXG4gIGlmICh0aGlzLnVucGFpcmVkLmNvbnRhaW5zKGlkKSkgeyByZXR1cm47IH1cbiAgdGhpcy51bnBhaXJlZC5hZGQoZGF0YSwgaWQpO1xuICBcbiAgLy8gLnBhaXJlZCBjb250YWlucyBhbGlnbm1lbnRzIHRoYXQgbWF5IGJlIG1hdGVkIGludG8gb25lIGludGVydmFsIGlmIHRoZXkgYXJlIHdpdGhpbiB0aGUgcGFpcmluZyByYW5nZVxuICBpZiAoIXRoaXMucGFpcmluZ0Rpc2FibGVkICYmIF9lbGlnaWJsZUZvclBhaXJpbmcodGhpcywgZGF0YSkpIHtcbiAgICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPT09IG51bGwpIHsgXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhbiBvbmx5IGFkZCBwYWlyZWQgZGF0YSBhZnRlciB0aGUgcGFpcmluZyBpbnRlcnZhbCBoYXMgYmVlbiBzZXQhJyk7XG4gICAgfVxuICAgIFxuICAgIC8vIGluc3RlYWQgb2Ygc3RvcmluZyB0aGVtIHdpdGggdGhlIGdpdmVuIGlkLCB0aGUgcGFpcmluZ0tleSAoZm9yIEJBTSwgUU5BTUUpIGlzIHVzZWQgYXMgdGhlIGlkLlxuICAgIC8vIEFzIGludGVydmFscyBhcmUgYWRkZWQsIHdlIGNoZWNrIGlmIGEgcmVhZCB3aXRoIHRoZSBzYW1lIHBhaXJpbmdLZXkgYWxyZWFkeSBleGlzdHMgaW4gdGhlIC5wYWlyZWQgSW50ZXJ2YWxUcmVlLlxuICAgIG5ld0lkID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmluZ0tleV07XG4gICAgcG90ZW50aWFsTWF0ZSA9IHRoaXMucGFpcmVkLmdldChuZXdJZCk7XG4gICAgXG4gICAgaWYgKHBvdGVudGlhbE1hdGUgIT09IG51bGwpIHtcbiAgICAgIHBvdGVudGlhbE1hdGUgPSBwb3RlbnRpYWxNYXRlLmRhdGE7XG4gICAgICBwYWlyaW5nU3RhdGUgPSBfcGFpcmluZ1N0YXRlKHRoaXMsIGRhdGEsIHBvdGVudGlhbE1hdGUpO1xuICAgICAgLy8gQXJlIHRoZSByZWFkcyBzdWl0YWJsZSBmb3IgbWF0aW5nP1xuICAgICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTIHx8IHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19NQVRFX09OTFkpIHtcbiAgICAgICAgLy8gSWYgeWVzOiBtYXRlIHRoZSByZWFkc1xuICAgICAgICBwb3RlbnRpYWxNYXRlLm1hdGUgPSBkYXRhO1xuICAgICAgICAvLyBJbiB0aGUgb3RoZXIgZGlyZWN0aW9uLCBoYXMgdG8gYmUgYSBzZWxlY3RpdmUgc2hhbGxvdyBjb3B5IHRvIGF2b2lkIGNpcmN1bGFyIHJlZmVyZW5jZXMuXG4gICAgICAgIGRhdGEubWF0ZSA9IF8uZXh0ZW5kKHt9LCBfLm9taXQocG90ZW50aWFsTWF0ZSwgZnVuY3Rpb24odiwgaykgeyByZXR1cm4gXy5pc09iamVjdCh2KX0pKTtcbiAgICAgICAgZGF0YS5tYXRlLmZsYWdzID0gXy5jbG9uZShwb3RlbnRpYWxNYXRlLmZsYWdzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gQXJlIHRoZSBtYXRlZCByZWFkcyB3aXRoaW4gZHJhd2FibGUgcmFuZ2U/IElmIHNvLCBzaW1wbHkgZmxhZyB0aGF0IHRoZXkgc2hvdWxkIGJlIGRyYXduIHRvZ2V0aGVyLCBhbmQgdGhleSB3aWxsLlxuICAgIC8vIEFsdGVybmF0aXZlbHksIGlmIHRoZSBwb3RlbnRpYWxNYXRlIGV4cGVjdGVkIGEgbWF0ZSwgd2Ugc2hvdWxkIG1hdGUgdGhlbSBhbnl3YXkuXG4gICAgLy8gVGhlIG9ubHkgcmVhc29uIHdlIHdvdWxkbid0IGdldCAuZHJhd0FzTWF0ZXMgaXMgaWYgdGhlIG1hdGUgd2FzIG9uIHRoZSB0aHJlc2hvbGQgb2YgdGhlIGluc2VydCBzaXplIHJhbmdlLlxuICAgIGlmIChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUyB8fCAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX01BVEVfT05MWSAmJiBwb3RlbnRpYWxNYXRlLm1hdGVFeHBlY3RlZCkpIHtcbiAgICAgIGRhdGEuZHJhd0FzTWF0ZXMgPSBwb3RlbnRpYWxNYXRlLmRyYXdBc01hdGVzID0gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT3RoZXJ3aXNlLCBuZWVkIHRvIGluc2VydCB0aGlzIHJlYWQgaW50byB0aGlzLnBhaXJlZCBhcyBhIHNlcGFyYXRlIHJlYWQuXG4gICAgICAvLyBFbnN1cmUgdGhlIGlkIGlzIHVuaXF1ZSBmaXJzdC5cbiAgICAgIHdoaWxlICh0aGlzLnBhaXJlZC5jb250YWlucyhuZXdJZCkpIHtcbiAgICAgICAgbmV3SWQgPSBuZXdJZC5yZXBsYWNlKC9cXHQuKi8sICcnKSArIFwiXFx0XCIgKyAoKytpbmNyZW1lbnQpO1xuICAgICAgfVxuICAgICAgXG4gICAgICBkYXRhLm1hdGVFeHBlY3RlZCA9IF9wYWlyaW5nU3RhdGUodGhpcywgZGF0YSkgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUztcbiAgICAgIC8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIHBlcmhhcHMgYSBiaXQgdG9vIHNwZWNpZmljIHRvIGhvdyBUTEVOIGZvciBCQU0gZmlsZXMgd29ya3M7IGNvdWxkIGdlbmVyYWxpemUgbGF0ZXJcbiAgICAgIC8vIFdoZW4gaW5zZXJ0aW5nIGludG8gLnBhaXJlZCwgdGhlIGludGVydmFsJ3MgLnN0YXJ0IGFuZCAuZW5kIHNob3VsZG4ndCBiZSBiYXNlZCBvbiBQT1MgYW5kIHRoZSBDSUdBUiBzdHJpbmc7XG4gICAgICAvLyB3ZSBtdXN0IGFkanVzdCB0aGVtIGZvciBUTEVOLCBpZiBpdCBpcyBub256ZXJvLCBkZXBlbmRpbmcgb24gaXRzIHNpZ24sIGFuZCBzZXQgbmV3IGJvdW5kcyBmb3IgdGhlIGludGVydmFsLlxuICAgICAgaWYgKGRhdGEubWF0ZUV4cGVjdGVkICYmIHBhaXJlZExlbmd0aCA+IDApIHtcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdO1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdICsgcGFpcmVkTGVuZ3RoO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLm1hdGVFeHBlY3RlZCAmJiBwYWlyZWRMZW5ndGggPCAwKSB7XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRFbmRdO1xuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRFbmRdICsgcGFpcmVkTGVuZ3RoO1xuICAgICAgfSBlbHNlIHsgLy8gIWRhdGEubWF0ZUV4cGVjdGVkIHx8IHBhaXJlZExlbmd0aCA9PSAwXG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZFN0YXJ0XTtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZEVuZF07XG4gICAgICB9XG4gICAgICBcbiAgICAgIHRoaXMucGFpcmVkLmFkZChkYXRhLCBuZXdJZCk7XG4gICAgfVxuICB9XG5cbn07XG5cblxuLyoqXG4gKiBhbGlhcyAuYWRkKCkgdG8gLmFkZElmTmV3KClcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkID0gUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldztcblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAobnVtYmVyKSB2YWw6XG4gKiBAcmV0dXJuIChhcnJheSlcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24odmFsMSwgdmFsMiwgcGFpcmVkKSB7XG4gIGlmIChwYWlyZWQgJiYgIXRoaXMucGFpcmluZ0Rpc2FibGVkKSB7XG4gICAgcmV0dXJuIHRoaXMucGFpcmVkLnNlYXJjaCh2YWwxLCB2YWwyKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gdGhpcy51bnBhaXJlZC5zZWFyY2godmFsMSwgdmFsMik7XG4gIH1cbn07XG5cblxuLyoqXG4gKiByZW1vdmU6IHVuaW1wbGVtZW50ZWQgZm9yIG5vd1xuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihpbnRlcnZhbF9pZCkge1xuICB0aHJvdyBcIi5yZW1vdmUoKSBpcyBjdXJyZW50bHkgdW5pbXBsZW1lbnRlZFwiO1xufTtcblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDaGVjayBpZiBhbiBpdHZsIGlzIGVsaWdpYmxlIGZvciBwYWlyaW5nLiBcbi8vIEZvciBub3csIHRoaXMgbWVhbnMgdGhhdCBpZiBhbnkgRkxBRydzIDB4MTAwIG9yIGhpZ2hlciBhcmUgc2V0LCB3ZSB0b3RhbGx5IGRpc2NhcmQgdGhpcyBhbGlnbm1lbnQgYW5kIGludGVydmFsLlxuLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgZW50YW5nbGVkIHdpdGggYmFtLmpzIGludGVybmFsczsgcGVyaGFwcyBhbGxvdyB0aGlzIHRvIGJlIGdlbmVyYWxpemVkLCBvdmVycmlkZGVuLFxuLy8gICAgICAgIG9yIHNldCBhbG9uZ3NpZGUgLnNldFBhaXJpbmdJbnRlcnZhbCgpXG4vL1xuLy8gQHJldHVybiAoYm9vbGVhbilcbmZ1bmN0aW9uIF9lbGlnaWJsZUZvclBhaXJpbmcocGFpcmVkSXR2bFRyZWUsIGl0dmwpIHtcbiAgdmFyIGZsYWdzID0gaXR2bC5mbGFncztcbiAgaWYgKGZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50IHx8IGZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQyB8fCBmbGFncy5pc0R1cGxpY2F0ZVJlYWQgfHwgZmxhZ3MuaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50KSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBDaGVjayBpZiBhbiBpdHZsIGFuZCBpdHMgcG90ZW50aWFsTWF0ZSBhcmUgd2l0aGluIHRoZSByaWdodCBkaXN0YW5jZSwgYW5kIG9yaWVudGF0aW9uLCB0byBiZSBtYXRlZC5cbi8vIElmIHBvdGVudGlhbE1hdGUgaXNuJ3QgZ2l2ZW4sIHRha2VzIGEgYmVzdCBndWVzcyBpZiBhIG1hdGUgaXMgZXhwZWN0ZWQsIGdpdmVuIHRoZSBpbmZvcm1hdGlvbiBpbiBpdHZsIGFsb25lLlxuLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgZW50YW5nbGVkIHdpdGggYmFtLmpzIGludGVybmFsczsgcGVyaGFwcyBhbGxvdyB0aGlzIHRvIGJlIGdlbmVyYWxpemVkLCBvdmVycmlkZGVuLFxuLy8gICAgICAgIG9yIHNldCBhbG9uZ3NpZGUgLnNldFBhaXJpbmdJbnRlcnZhbCgpXG4vLyBcbi8vIEByZXR1cm4gKG51bWJlcilcbmZ1bmN0aW9uIF9wYWlyaW5nU3RhdGUocGFpcmVkSXR2bFRyZWUsIGl0dmwsIHBvdGVudGlhbE1hdGUpIHtcbiAgdmFyIHRsZW4gPSBpdHZsW3BhaXJlZEl0dmxUcmVlLnBhaXJlZE9wdGlvbnMucGFpcmVkTGVuZ3RoS2V5XSxcbiAgICBpdHZsTGVuZ3RoID0gaXR2bC5lbmQgLSBpdHZsLnN0YXJ0LFxuICAgIGl0dmxJc0xhdGVyLCBpbmZlcnJlZEluc2VydFNpemU7XG5cbiAgaWYgKF8uaXNVbmRlZmluZWQocG90ZW50aWFsTWF0ZSkpIHtcbiAgICAvLyBDcmVhdGUgdGhlIG1vc3QgcmVjZXB0aXZlIGh5cG90aGV0aWNhbCBtYXRlLCBnaXZlbiB0aGUgaW5mb3JtYXRpb24gaW4gaXR2bC5cbiAgICBwb3RlbnRpYWxNYXRlID0ge1xuICAgICAgX21vY2tlZDogdHJ1ZSxcbiAgICAgIGZsYWdzOiB7XG4gICAgICAgIGlzUmVhZFBhaXJlZDogdHJ1ZSxcbiAgICAgICAgaXNSZWFkUHJvcGVybHlBbGlnbmVkOiB0cnVlLFxuICAgICAgICBpc1JlYWRGaXJzdE9mUGFpcjogaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyLFxuICAgICAgICBpc1JlYWRMYXN0T2ZQYWlyOiBpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIEZpcnN0IGNoZWNrIGEgd2hvbGUgaG9zdCBvZiBGTEFHJ3MuIFRvIG1ha2UgYSBsb25nIHN0b3J5IHNob3J0LCB3ZSBleHBlY3QgcGFpcmVkIGVuZHMgdG8gYmUgZWl0aGVyXG4gIC8vIDk5LTE0NyBvciAxNjMtODMsIGRlcGVuZGluZyBvbiB3aGV0aGVyIHRoZSByaWdodG1vc3Qgb3IgbGVmdG1vc3Qgc2VnbWVudCBpcyBwcmltYXJ5LlxuICBpZiAoIWl0dmwuZmxhZ3MuaXNSZWFkUGFpcmVkIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFBhaXJlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoIWl0dmwuZmxhZ3MuaXNSZWFkUHJvcGVybHlBbGlnbmVkIHx8ICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFByb3Blcmx5QWxpZ25lZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRVbm1hcHBlZCB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZFVubWFwcGVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzTWF0ZVVubWFwcGVkIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MuaXNNYXRlVW5tYXBwZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIgJiYgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcikgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyICYmICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgXG4gIGlmIChwb3RlbnRpYWxNYXRlLl9tb2NrZWQpIHtcbiAgICBfLmV4dGVuZChwb3RlbnRpYWxNYXRlLCB7XG4gICAgICBybmFtZTogaXR2bC5ybmV4dCA9PSAnPScgPyBpdHZsLnJuYW1lIDogaXR2bC5ybmV4dCxcbiAgICAgIHBvczogaXR2bC5wbmV4dCxcbiAgICAgIHN0YXJ0OiBpdHZsLnJuZXh0ID09ICc9JyA/IHBhcnNlSW50MTAoaXR2bC5wbmV4dCkgKyAoaXR2bC5zdGFydCAtIHBhcnNlSW50MTAoaXR2bC5wb3MpKSA6IDAsXG4gICAgICBlbmQ6IHRsZW4gPiAwID8gaXR2bC5zdGFydCArIHRsZW4gOiAodGxlbiA8IDAgPyBpdHZsLmVuZCArIHRsZW4gKyBpdHZsTGVuZ3RoIDogMCksXG4gICAgICBybmV4dDogaXR2bC5ybmV4dCA9PSAnPScgPyAnPScgOiBpdHZsLnJuYW1lLFxuICAgICAgcG5leHQ6IGl0dmwucG9zXG4gICAgfSk7XG4gIH1cbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGFsaWdubWVudHMgYXJlIG9uIHRoZSBzYW1lIHJlZmVyZW5jZSBzZXF1ZW5jZVxuICBpZiAoaXR2bC5ybmV4dCAhPSAnPScgfHwgcG90ZW50aWFsTWF0ZS5ybmV4dCAhPSAnPScpIHsgXG4gICAgLy8gYW5kIGlmIG5vdCwgZG8gdGhlIGNvb3JkaW5hdGVzIG1hdGNoIGF0IGFsbD9cbiAgICBpZiAoaXR2bC5ybmV4dCAhPSBwb3RlbnRpYWxNYXRlLnJuYW1lIHx8IGl0dmwucm5leHQgIT0gcG90ZW50aWFsTWF0ZS5ybmFtZSkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIGlmIChpdHZsLnBuZXh0ICE9IHBvdGVudGlhbE1hdGUucG9zIHx8IGl0dmwucG9zICE9IHBvdGVudGlhbE1hdGUucG5leHQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7XG4gIH1cbiAgXG4gIGlmIChwb3RlbnRpYWxNYXRlLl9tb2NrZWQpIHtcbiAgICBfLmV4dGVuZChwb3RlbnRpYWxNYXRlLmZsYWdzLCB7XG4gICAgICByZWFkU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSxcbiAgICAgIG1hdGVTdHJhbmRSZXZlcnNlOiBpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlXG4gICAgfSk7XG4gIH0gXG4gIFxuICBpdHZsSXNMYXRlciA9IGl0dmwuc3RhcnQgPiBwb3RlbnRpYWxNYXRlLnN0YXJ0O1xuICBpbmZlcnJlZEluc2VydFNpemUgPSBNYXRoLmFicyh0bGVuKTtcbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGFsaWdubWVudHMgYXJlIC0tPiA8LS1cbiAgaWYgKGl0dmxJc0xhdGVyKSB7XG4gICAgaWYgKCFpdHZsLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8IGl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gICAgaWYgKHBvdGVudGlhbE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgIWl0dmwuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gICAgaWYgKCFwb3RlbnRpYWxNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MubWF0ZVN0cmFuZFJldmVyc2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIH1cbiAgXG4gIC8vIENoZWNrIHRoYXQgdGhlIGluZmVycmVkSW5zZXJ0U2l6ZSBpcyB3aXRoaW4gdGhlIGFjY2VwdGFibGUgcmFuZ2UuXG4gIGl0dmwuaW5zZXJ0U2l6ZSA9IHBvdGVudGlhbE1hdGUuaW5zZXJ0U2l6ZSA9IGluZmVycmVkSW5zZXJ0U2l6ZTtcbiAgaWYgKGluZmVycmVkSW5zZXJ0U2l6ZSA+IHRoaXMucGFpcmluZ01heERpc3RhbmNlIHx8IGluZmVycmVkSW5zZXJ0U2l6ZSA8IHRoaXMucGFpcmluZ01pbkRpc3RhbmNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICBcbiAgcmV0dXJuIFBBSVJJTkdfRFJBV19BU19NQVRFUztcbn1cblxuZXhwb3J0cy5QYWlyZWRJbnRlcnZhbFRyZWUgPSBQYWlyZWRJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLyoqXG4gICogUmVtb3RlVHJhY2tcbiAgKlxuICAqIEEgaGVscGVyIGNsYXNzIGJ1aWx0IGZvciBjYWNoaW5nIGRhdGEgZmV0Y2hlZCBmcm9tIGEgcmVtb3RlIHRyYWNrIChkYXRhIGFsaWduZWQgdG8gYSBnZW5vbWUpLlxuICAqIFRoZSBnZW5vbWUgaXMgZGl2aWRlZCBpbnRvIGJpbnMgb2Ygb3B0aW1hbEZldGNoV2luZG93IG50cywgZm9yIGVhY2ggb2Ygd2hpY2ggZGF0YSB3aWxsIG9ubHkgYmUgZmV0Y2hlZCBvbmNlLlxuICAqIFRvIHNldHVwIHRoZSBiaW5zLCBjYWxsIC5zZXR1cEJpbnMoLi4uKSBhZnRlciBpbml0aWFsaXppbmcgdGhlIGNsYXNzLlxuICAqXG4gICogVGhlcmUgaXMgb25lIG1haW4gcHVibGljIG1ldGhvZCBmb3IgdGhpcyBjbGFzczogLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgY2FsbGJhY2spXG4gICogKEZvciBjb25zaXN0ZW5jeSB3aXRoIEN1c3RvbVRyYWNrcy5qcywgYWxsIGBzdGFydGAgYW5kIGBlbmRgIHBvc2l0aW9ucyBhcmUgMS1iYXNlZCwgb3JpZW50ZWQgdG9cbiAgKiB0aGUgc3RhcnQgb2YgdGhlIGdlbm9tZSwgYW5kIGludGVydmFscyBhcmUgcmlnaHQtb3Blbi4pXG4gICpcbiAgKiBUaGlzIG1ldGhvZCB3aWxsIHJlcXVlc3QgYW5kIGNhY2hlIGRhdGEgZm9yIHRoZSBnaXZlbiBpbnRlcnZhbCB0aGF0IGlzIG5vdCBhbHJlYWR5IGNhY2hlZCwgYW5kIGNhbGwgXG4gICogY2FsbGJhY2soaW50ZXJ2YWxzKSBhcyBzb29uIGFzIGRhdGEgZm9yIGFsbCBpbnRlcnZhbHMgaXMgYXZhaWxhYmxlLiAoSWYgdGhlIGRhdGEgaXMgYWxyZWFkeSBhdmFpbGFibGUsIFxuICAqIGl0IHdpbGwgY2FsbCB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkuKVxuICAqKi9cblxudmFyIEJJTl9MT0FESU5HID0gMSxcbiAgQklOX0xPQURFRCA9IDI7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrIGNvbnN0cnVjdG9yLlxuICAqXG4gICogTm90ZSB5b3Ugc3RpbGwgbXVzdCBjYWxsIGAuc2V0dXBCaW5zKC4uLilgIGJlZm9yZSB0aGUgUmVtb3RlVHJhY2sgaXMgcmVhZHkgdG8gZmV0Y2ggZGF0YS5cbiAgKlxuICAqIEBwYXJhbSAoSW50ZXJ2YWxUcmVlKSBjYWNoZTogQW4gY2FjaGUgc3RvcmUgdGhhdCB3aWxsIHJlY2VpdmUgaW50ZXJ2YWxzIGZldGNoZWQgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU2hvdWxkIGJlIGFuIEludGVydmFsVHJlZSBvciBlcXVpdmFsZW50LCB0aGF0IGltcGxlbWVudHMgYC5hZGRJZk5ldyguLi4pYCBhbmQgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgLnNlYXJjaChzdGFydCwgZW5kKWAgbWV0aG9kcy4gSWYgaXQgaXMgYW4gKmV4dGVuc2lvbiogb2YgYW4gSW50ZXJ2YWxUcmVlLCBub3RlIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGBleHRyYUFyZ3NgIHBhcmFtIHBlcm1pdHRlZCBmb3IgYC5mZXRjaEFzeW5jKClgLCB3aGljaCBhcmUgcGFzc2VkIGFsb25nIGFzIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0cmEgYXJndW1lbnRzIHRvIGAuc2VhcmNoKClgLlxuICAqIEBwYXJhbSAoZnVuY3Rpb24pIGZldGNoZXI6IEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCB0byBmZXRjaCBkYXRhIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIGZ1bmN0aW9uIHNob3VsZCB0YWtlIHRocmVlIGFyZ3VtZW50cywgYHN0YXJ0YCwgYGVuZGAsIGFuZCBgc3RvcmVJbnRlcnZhbHNgLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0b3JlSW50ZXJ2YWxzYCBpcyBhIGNhbGxiYWNrIHRoYXQgYGZldGNoZXJgIE1VU1QgY2FsbCBvbiB0aGUgYXJyYXkgb2YgaW50ZXJ2YWxzXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgb25jZSB0aGV5IGhhdmUgYmVlbiBmZXRjaGVkIGZyb20gdGhlIHJlbW90ZSBkYXRhIHNvdXJjZSBhbmQgcGFyc2VkLlxuICAqIEBzZWUgX2ZldGNoQmluIGZvciBob3cgYGZldGNoZXJgIGlzIHV0aWxpemVkLlxuICAqKi9cbmZ1bmN0aW9uIFJlbW90ZVRyYWNrKGNhY2hlLCBmZXRjaGVyKSB7XG4gIGlmICh0eXBlb2YgY2FjaGUgIT0gJ29iamVjdCcgfHwgKCFjYWNoZS5hZGRJZk5ldyAmJiAoIV8ua2V5cyhjYWNoZSkubGVuZ3RoIHx8IGNhY2hlW18ua2V5cyhjYWNoZSlbMF1dLmFkZElmTmV3KSkpIHsgXG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGFuIEludGVydmFsVHJlZSBjYWNoZSwgb3IgYW4gb2JqZWN0L2FycmF5IGNvbnRhaW5pbmcgSW50ZXJ2YWxUcmVlcywgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgXG4gIH1cbiAgaWYgKHR5cGVvZiBmZXRjaGVyICE9ICdmdW5jdGlvbicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGEgZmV0Y2hlciBmdW5jdGlvbiBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIFxuICB0aGlzLmNhY2hlID0gY2FjaGU7XG4gIHRoaXMuZmV0Y2hlciA9IGZldGNoZXI7XG4gIFxuICB0aGlzLmNhbGxiYWNrcyA9IFtdO1xuICB0aGlzLmFmdGVyQmluU2V0dXAgPSBbXTtcbiAgdGhpcy5iaW5zTG9hZGVkID0gbnVsbDtcbn1cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG4vLyBTZXR1cCB0aGUgYmlubmluZyBzY2hlbWUgZm9yIHRoaXMgUmVtb3RlVHJhY2suIFRoaXMgY2FuIG9jY3VyIGFueXRpbWUgYWZ0ZXIgaW5pdGlhbGl6YXRpb24sIGFuZCBpbiBmYWN0LFxuLy8gY2FuIG9jY3VyIGFmdGVyIGNhbGxzIHRvIGAuZmV0Y2hBc3luYygpYCBoYXZlIGJlZW4gbWFkZSwgaW4gd2hpY2ggY2FzZSB0aGV5IHdpbGwgYmUgd2FpdGluZyBvbiB0aGlzIG1ldGhvZFxuLy8gdG8gYmUgY2FsbGVkIHRvIHByb2NlZWQuIEJ1dCBpdCBNVVNUIGJlIGNhbGxlZCBiZWZvcmUgZGF0YSB3aWxsIGJlIHJlY2VpdmVkIGJ5IGNhbGxiYWNrcyBwYXNzZWQgdG8gXG4vLyBgLmZldGNoQXN5bmMoKWAuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuc2V0dXBCaW5zID0gZnVuY3Rpb24oZ2Vub21lU2l6ZSwgb3B0aW1hbEZldGNoV2luZG93LCBtYXhGZXRjaFdpbmRvdykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChzZWxmLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IHJ1biBzZXR1cEJpbnMgbW9yZSB0aGFuIG9uY2UuJyk7IH1cbiAgaWYgKHR5cGVvZiBnZW5vbWVTaXplICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSB0aGUgZ2Vub21lU2l6ZSBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2Ygb3B0aW1hbEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBvcHRpbWFsRmV0Y2hXaW5kb3cgYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXhGZXRjaFdpbmRvdyBhcyB0aGUgM3JkIGFyZ3VtZW50LicpOyB9XG4gIFxuICBzZWxmLmdlbm9tZVNpemUgPSBnZW5vbWVTaXplO1xuICBzZWxmLm9wdGltYWxGZXRjaFdpbmRvdyA9IG9wdGltYWxGZXRjaFdpbmRvdztcbiAgc2VsZi5tYXhGZXRjaFdpbmRvdyA9IG1heEZldGNoV2luZG93O1xuICBcbiAgc2VsZi5udW1CaW5zID0gTWF0aC5jZWlsKGdlbm9tZVNpemUgLyBvcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICBzZWxmLmJpbnNMb2FkZWQgPSB7fTtcbiAgXG4gIC8vIEZpcmUgb2ZmIHJhbmdlcyBzYXZlZCB0byBhZnRlckJpblNldHVwXG4gIF8uZWFjaCh0aGlzLmFmdGVyQmluU2V0dXAsIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgc2VsZi5mZXRjaEFzeW5jKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQsIHJhbmdlLmV4dHJhQXJncyk7XG4gIH0pO1xuICBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMoc2VsZik7XG59XG5cblxuLy8gRmV0Y2hlcyBkYXRhIChpZiBuZWNlc3NhcnkpIGZvciB1bmZldGNoZWQgYmlucyBvdmVybGFwcGluZyB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBUaGVuLCBydW4gYGNhbGxiYWNrYCBvbiBhbGwgc3RvcmVkIHN1YmludGVydmFscyB0aGF0IG92ZXJsYXAgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gYGV4dHJhQXJnc2AgaXMgYW4gKm9wdGlvbmFsKiBwYXJhbWV0ZXIgdGhhdCBjYW4gY29udGFpbiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZSBgLnNlYXJjaCgpYCBmdW5jdGlvbiBvZiB0aGUgY2FjaGUuXG4vL1xuLy8gQHBhcmFtIChudW1iZXIpIHN0YXJ0OiAgICAgICAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZSB0byBzdGFydCBmZXRjaGluZyBmcm9tXG4vLyBAcGFyYW0gKG51bWJlcikgZW5kOiAgICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIChyaWdodC1vcGVuKSB0byBzdGFydCBmZXRjaGluZyAqdW50aWwqXG4vLyBAcGFyYW0gKEFycmF5KSBbZXh0cmFBcmdzXTogIG9wdGlvbmFsLCBwYXNzZWQgYWxvbmcgdG8gdGhlIGAuc2VhcmNoKClgIGNhbGxzIG9uIHRoZSAuY2FjaGUgYXMgYXJndW1lbnRzIDMgYW5kIHVwOyBcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyaGFwcyB1c2VmdWwgaWYgdGhlIC5jYWNoZSBoYXMgb3ZlcnJpZGRlbiB0aGlzIG1ldGhvZFxuLy8gQHBhcmFtIChmdW5jdGlvbikgY2FsbGJhY2s6ICBBIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgb25jZSBkYXRhIGlzIHJlYWR5IGZvciB0aGlzIGludGVydmFsLiBXaWxsIGJlIHBhc3NlZFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGwgaW50ZXJ2YWwgZmVhdHVyZXMgdGhhdCBoYXZlIGJlZW4gZmV0Y2hlZCBmb3IgdGhpcyBpbnRlcnZhbCwgb3Ige3Rvb01hbnk6IHRydWV9XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIG1vcmUgZGF0YSB3YXMgcmVxdWVzdGVkIHRoYW4gY291bGQgYmUgcmVhc29uYWJseSBmZXRjaGVkLlxuUmVtb3RlVHJhY2sucHJvdG90eXBlLmZldGNoQXN5bmMgPSBmdW5jdGlvbihzdGFydCwgZW5kLCBleHRyYUFyZ3MsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKF8uaXNGdW5jdGlvbihleHRyYUFyZ3MpICYmIF8uaXNVbmRlZmluZWQoY2FsbGJhY2spKSB7IGNhbGxiYWNrID0gZXh0cmFBcmdzOyBleHRyYUFyZ3MgPSB1bmRlZmluZWQ7IH1cbiAgaWYgKCFzZWxmLmJpbnNMb2FkZWQpIHtcbiAgICAvLyBJZiBiaW5zICphcmVuJ3QqIHNldHVwIHlldDpcbiAgICAvLyBTYXZlIHRoZSBjYWxsYmFjayBvbnRvIHRoZSBxdWV1ZVxuICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IFxuICAgICAgc2VsZi5jYWxsYmFja3MucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3MsIGNhbGxiYWNrOiBjYWxsYmFja30pOyBcbiAgICB9XG4gICAgXG4gICAgLy8gU2F2ZSB0aGlzIGZldGNoIGZvciB3aGVuIHRoZSBiaW5zIGFyZSBsb2FkZWRcbiAgICBzZWxmLmFmdGVyQmluU2V0dXAucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3N9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBiaW5zICphcmUqIHNldHVwLCBmaXJzdCBjYWxjdWxhdGUgd2hpY2ggYmlucyBjb3JyZXNwb25kIHRvIHRoaXMgaW50ZXJ2YWwsIFxuICAgIC8vIGFuZCB3aGF0IHN0YXRlIHRob3NlIGJpbnMgYXJlIGluXG4gICAgdmFyIGJpbnMgPSBfYmluT3ZlcmxhcChzZWxmLCBzdGFydCwgZW5kKSxcbiAgICAgIGxvYWRlZEJpbnMgPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiBzZWxmLmJpbnNMb2FkZWRbaV0gPT09IEJJTl9MT0FERUQ7IH0pLFxuICAgICAgYmluc1RvRmV0Y2ggPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiAhc2VsZi5iaW5zTG9hZGVkW2ldOyB9KTtcbiAgICBcbiAgICBpZiAobG9hZGVkQmlucy5sZW5ndGggPT0gYmlucy5sZW5ndGgpIHtcbiAgICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgbG9hZGVkIGRhdGEgZm9yIGFsbCB0aGUgYmlucyBpbiBxdWVzdGlvbiwgc2hvcnQtY2lyY3VpdCBhbmQgcnVuIHRoZSBjYWxsYmFjayBub3dcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoZXh0cmFBcmdzKSA/IFtdIDogZXh0cmFBcmdzO1xuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soc2VsZi5jYWNoZS5zZWFyY2guYXBwbHkoc2VsZi5jYWNoZSwgW3N0YXJ0LCBlbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgfSBlbHNlIGlmIChlbmQgLSBzdGFydCA+IHNlbGYubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIC8vIGVsc2UsIGlmIHRoaXMgaW50ZXJ2YWwgaXMgdG9vIGJpZyAoPiBtYXhGZXRjaFdpbmRvdyksIGZpcmUgdGhlIGNhbGxiYWNrIHJpZ2h0IGF3YXkgd2l0aCB7dG9vTWFueTogdHJ1ZX1cbiAgICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIGVsc2UsIHB1c2ggdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyB0aGVuIHJ1biBmZXRjaGVzIGZvciB0aGUgdW5mZXRjaGVkIGJpbnMsIHdoaWNoIHNob3VsZCBjYWxsIF9maXJlQ2FsbGJhY2tzIGFmdGVyIHRoZXkgY29tcGxldGUsXG4gICAgLy8gd2hpY2ggd2lsbCBhdXRvbWF0aWNhbGx5IGZpcmUgY2FsbGJhY2tzIGZyb20gdGhlIGFib3ZlIHF1ZXVlIGFzIHRoZXkgYWNxdWlyZSBhbGwgbmVlZGVkIGRhdGEuXG4gICAgXy5lYWNoKGJpbnNUb0ZldGNoLCBmdW5jdGlvbihiaW5JbmRleCkge1xuICAgICAgX2ZldGNoQmluKHNlbGYsIGJpbkluZGV4LCBmdW5jdGlvbigpIHsgX2ZpcmVDYWxsYmFja3Moc2VsZik7IH0pO1xuICAgIH0pO1xuICB9XG59XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2FsY3VsYXRlcyB3aGljaCBiaW5zIG92ZXJsYXAgd2l0aCBhbiBpbnRlcnZhbCBnaXZlbiBieSBgc3RhcnRgIGFuZCBgZW5kYC5cbi8vIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuZnVuY3Rpb24gX2Jpbk92ZXJsYXAocmVtb3RlVHJrLCBzdGFydCwgZW5kKSB7XG4gIGlmICghcmVtb3RlVHJrLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IGNhbGN1bGF0ZSBiaW4gb3ZlcmxhcCBiZWZvcmUgc2V0dXBCaW5zIGlzIGNhbGxlZC4nKTsgfVxuICAvLyBJbnRlcm5hbGx5LCBmb3IgYXNzaWduaW5nIGNvb3JkaW5hdGVzIHRvIGJpbnMsIHdlIHVzZSAwLWJhc2VkIGNvb3JkaW5hdGVzIGZvciBlYXNpZXIgY2FsY3VsYXRpb25zLlxuICB2YXIgc3RhcnRCaW4gPSBNYXRoLmZsb29yKChzdGFydCAtIDEpIC8gcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyksXG4gICAgZW5kQmluID0gTWF0aC5mbG9vcigoZW5kIC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KTtcbiAgcmV0dXJuIF8ucmFuZ2Uoc3RhcnRCaW4sIGVuZEJpbiArIDEpO1xufVxuXG4vLyBSdW5zIHRoZSBmZXRjaGVyIGZ1bmN0aW9uIG9uIGEgZ2l2ZW4gYmluLlxuLy8gVGhlIGZldGNoZXIgZnVuY3Rpb24gaXMgb2JsaWdhdGVkIHRvIHJ1biBhIGNhbGxiYWNrIGZ1bmN0aW9uIGBzdG9yZUludGVydmFsc2AsIFxuLy8gICAgcGFzc2VkIGFzIGl0cyB0aGlyZCBhcmd1bWVudCwgb24gYSBzZXQgb2YgaW50ZXJ2YWxzIHRoYXQgd2lsbCBiZSBpbnNlcnRlZCBpbnRvIHRoZSBcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBJbnRlcnZhbFRyZWUuXG4vLyBUaGUgYHN0b3JlSW50ZXJ2YWxzYCBmdW5jdGlvbiBtYXkgYWNjZXB0IGEgc2Vjb25kIGFyZ3VtZW50IGNhbGxlZCBgY2FjaGVJbmRleGAsIGluIGNhc2Vcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBpcyBhY3R1YWxseSBhIGNvbnRhaW5lciBmb3IgbXVsdGlwbGUgSW50ZXJ2YWxUcmVlcywgaW5kaWNhdGluZyB3aGljaCBcbi8vICAgIG9uZSB0byBzdG9yZSBpdCBpbi5cbi8vIFdlIHRoZW4gY2FsbCB0aGUgYGNhbGxiYWNrYCBnaXZlbiBoZXJlIGFmdGVyIHRoYXQgaXMgY29tcGxldGUuXG5mdW5jdGlvbiBfZmV0Y2hCaW4ocmVtb3RlVHJrLCBiaW5JbmRleCwgY2FsbGJhY2spIHtcbiAgdmFyIHN0YXJ0ID0gYmluSW5kZXggKiByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93ICsgMSxcbiAgICBlbmQgPSAoYmluSW5kZXggKyAxKSAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxO1xuICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BRElORztcbiAgcmVtb3RlVHJrLmZldGNoZXIoc3RhcnQsIGVuZCwgZnVuY3Rpb24gc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKSB7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIGlmICghaW50ZXJ2YWwpIHsgcmV0dXJuOyB9XG4gICAgICByZW1vdGVUcmsuY2FjaGUuYWRkSWZOZXcoaW50ZXJ2YWwsIGludGVydmFsLmlkKTtcbiAgICB9KTtcbiAgICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BREVEO1xuICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgfSk7XG59XG5cbi8vIFJ1bnMgdGhyb3VnaCBhbGwgc2F2ZWQgY2FsbGJhY2tzIGFuZCBmaXJlcyBhbnkgY2FsbGJhY2tzIHdoZXJlIGFsbCB0aGUgcmVxdWlyZWQgZGF0YSBpcyByZWFkeVxuLy8gQ2FsbGJhY2tzIHRoYXQgYXJlIGZpcmVkIGFyZSByZW1vdmVkIGZyb20gdGhlIHF1ZXVlLlxuZnVuY3Rpb24gX2ZpcmVDYWxsYmFja3MocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2ssXG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGFmdGVyTG9hZC5leHRyYUFyZ3MpID8gW10gOiBhZnRlckxvYWQuZXh0cmFBcmdzLFxuICAgICAgYmlucywgc3RpbGxMb2FkaW5nQmlucztcbiAgICAgICAgXG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIGJpbnMgPSBfYmluT3ZlcmxhcChyZW1vdGVUcmssIGFmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZCk7XG4gICAgc3RpbGxMb2FkaW5nQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHJlbW90ZVRyay5iaW5zTG9hZGVkW2ldICE9PSBCSU5fTE9BREVEOyB9KS5sZW5ndGggPiAwO1xuICAgIGlmICghc3RpbGxMb2FkaW5nQmlucykge1xuICAgICAgY2FsbGJhY2socmVtb3RlVHJrLmNhY2hlLnNlYXJjaC5hcHBseShyZW1vdGVUcmsuY2FjaGUsIFthZnRlckxvYWQuc3RhcnQsIGFmdGVyTG9hZC5lbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3MgZm9yIHdoaWNoIHdlIHdvbid0IGxvYWQgZGF0YSBzaW5jZSB0aGUgYW1vdW50XG4vLyByZXF1ZXN0ZWQgaXMgdG9vIGxhcmdlLiBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2s7XG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuXG5leHBvcnRzLlJlbW90ZVRyYWNrID0gUmVtb3RlVHJhY2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvU29ydGVkTGlzdFxuICpcbiAqIFNvcnRlZExpc3QgOiBjb25zdHJ1Y3RvclxuICogXG4gKiBAcGFyYW0gYXJyIDogQXJyYXkgb3IgbnVsbCA6IGFuIGFycmF5IHRvIHNldFxuICpcbiAqIEBwYXJhbSBvcHRpb25zIDogb2JqZWN0ICBvciBudWxsXG4gKiAgICAgICAgIChmdW5jdGlvbikgZmlsdGVyICA6IGZpbHRlciBmdW5jdGlvbiBjYWxsZWQgYmVmb3JlIGluc2VydGluZyBkYXRhLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIHJlY2VpdmVzIGEgdmFsdWUgYW5kIHJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdmFsaWQuXG4gKlxuICogICAgICAgICAoZnVuY3Rpb24pIGNvbXBhcmUgOiBmdW5jdGlvbiB0byBjb21wYXJlIHR3byB2YWx1ZXMsIFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGljaCBpcyB1c2VkIGZvciBzb3J0aW5nIG9yZGVyLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgc2FtZSBzaWduYXR1cmUgYXMgQXJyYXkucHJvdG90eXBlLnNvcnQoZm4pLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAqICAgICAgICAgKHN0cmluZykgICBjb21wYXJlIDogaWYgeW91J2QgbGlrZSB0byBzZXQgYSBjb21tb24gY29tcGFyaXNvbiBmdW5jdGlvbixcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeW91IGNhbiBzcGVjaWZ5IGl0IGJ5IHN0cmluZzpcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJudW1iZXJcIiA6IGNvbXBhcmVzIG51bWJlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcInN0cmluZ1wiIDogY29tcGFyZXMgc3RyaW5nXG4gKi9cbmZ1bmN0aW9uIFNvcnRlZExpc3QoKSB7XG4gIHZhciBhcnIgICAgID0gbnVsbCxcbiAgICAgIG9wdGlvbnMgPSB7fSxcbiAgICAgIGFyZ3MgICAgPSBhcmd1bWVudHM7XG5cbiAgW1wiMFwiLFwiMVwiXS5mb3JFYWNoKGZ1bmN0aW9uKG4pIHtcbiAgICB2YXIgdmFsID0gYXJnc1tuXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG4gICAgICBhcnIgPSB2YWw7XG4gICAgfVxuICAgIGVsc2UgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09IFwib2JqZWN0XCIpIHtcbiAgICAgIG9wdGlvbnMgPSB2YWw7XG4gICAgfVxuICB9KTtcbiAgdGhpcy5hcnIgPSBbXTtcblxuICBbXCJmaWx0ZXJcIiwgXCJjb21wYXJlXCJdLmZvckVhY2goZnVuY3Rpb24oaykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9uc1trXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRoaXNba10gPSBvcHRpb25zW2tdO1xuICAgIH1cbiAgICBlbHNlIGlmIChvcHRpb25zW2tdICYmIFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV0pIHtcbiAgICAgIHRoaXNba10gPSBTb3J0ZWRMaXN0W2tdW29wdGlvbnNba11dO1xuICAgIH1cbiAgfSwgdGhpcyk7XG4gIGlmIChhcnIpIHRoaXMubWFzc0luc2VydChhcnIpO1xufTtcblxuLy8gQmluYXJ5IHNlYXJjaCBmb3IgdGhlIGluZGV4IG9mIHRoZSBpdGVtIGVxdWFsIHRvIGB2YWxgLCBvciBpZiBubyBzdWNoIGl0ZW0gZXhpc3RzLCB0aGUgbmV4dCBsb3dlciBpdGVtXG4vLyBUaGlzIGNhbiBiZSAtMSBpZiBgdmFsYCBpcyBsb3dlciB0aGFuIHRoZSBsb3dlc3QgaXRlbSBpbiB0aGUgU29ydGVkTGlzdFxuU29ydGVkTGlzdC5wcm90b3R5cGUuYnNlYXJjaCA9IGZ1bmN0aW9uKHZhbCkge1xuICB2YXIgbXBvcyxcbiAgICAgIHNwb3MgPSAwLFxuICAgICAgZXBvcyA9IHRoaXMuYXJyLmxlbmd0aDtcbiAgd2hpbGUgKGVwb3MgLSBzcG9zID4gMSkge1xuICAgIG1wb3MgPSBNYXRoLmZsb29yKChzcG9zICsgZXBvcykvMik7XG4gICAgbXZhbCA9IHRoaXMuYXJyW21wb3NdO1xuICAgIHN3aXRjaCAodGhpcy5jb21wYXJlKHZhbCwgbXZhbCkpIHtcbiAgICBjYXNlIDEgIDpcbiAgICBkZWZhdWx0IDpcbiAgICAgIHNwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAtMSA6XG4gICAgICBlcG9zID0gbXBvcztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMCAgOlxuICAgICAgcmV0dXJuIG1wb3M7XG4gICAgfVxuICB9XG4gIHJldHVybiAodGhpcy5hcnJbMF0gPT0gbnVsbCB8fCBzcG9zID09IDAgJiYgdGhpcy5hcnJbMF0gIT0gbnVsbCAmJiB0aGlzLmNvbXBhcmUodGhpcy5hcnJbMF0sIHZhbCkgPT0gMSkgPyAtMSA6IHNwb3M7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyW3Bvc107XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHJldHVybiB0aGlzLmFyci5zbGljZSgpO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlLmFwcGx5KHRoaXMuYXJyLCBhcmd1bWVudHMpO1xufVxuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyci5sZW5ndGg7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5oZWFkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyclswXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRhaWwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICh0aGlzLmFyci5sZW5ndGggPT0gMCkgPyBudWxsIDogdGhpcy5hcnJbdGhpcy5hcnIubGVuZ3RoIC0xXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLm1hc3NJbnNlcnQgPSBmdW5jdGlvbihpdGVtcykge1xuICAvLyBUaGlzIGxvb3AgYXZvaWRzIGNhbGwgc3RhY2sgb3ZlcmZsb3cgYmVjYXVzZSBvZiB0b28gbWFueSBhcmd1bWVudHNcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gNDA5Nikge1xuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHRoaXMuYXJyLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChpdGVtcywgaSwgaSArIDQwOTYpKTtcbiAgfVxuICB0aGlzLmFyci5zb3J0KHRoaXMuY29tcGFyZSk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEwMCkge1xuICAgIC8vIC5ic2VhcmNoICsgLnNwbGljZSBpcyB0b28gZXhwZW5zaXZlIHRvIHJlcGVhdCBmb3Igc28gbWFueSBlbGVtZW50cy5cbiAgICAvLyBMZXQncyBqdXN0IGFwcGVuZCB0aGVtIGFsbCB0byB0aGlzLmFyciBhbmQgcmVzb3J0LlxuICAgIHRoaXMubWFzc0luc2VydChhcmd1bWVudHMpO1xuICB9IGVsc2Uge1xuICAgIEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbih2YWwpIHtcbiAgICAgIHZhciBwb3MgPSB0aGlzLmJzZWFyY2godmFsKTtcbiAgICAgIGlmICh0aGlzLmZpbHRlcih2YWwsIHBvcykpIHtcbiAgICAgICAgdGhpcy5hcnIuc3BsaWNlKHBvcysxLCAwLCB2YWwpO1xuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICB9XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5maWx0ZXIgPSBmdW5jdGlvbih2YWwsIHBvcykge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmFkZCA9IFNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydDtcblxuU29ydGVkTGlzdC5wcm90b3R5cGVbXCJkZWxldGVcIl0gPSBmdW5jdGlvbihwb3MpIHtcbiAgdGhpcy5hcnIuc3BsaWNlKHBvcywgMSk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBTb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc1JlbW92ZSA9IGZ1bmN0aW9uKHN0YXJ0UG9zLCBjb3VudCkge1xuICB0aGlzLmFyci5zcGxpY2Uoc3RhcnRQb3MsIGNvdW50KTtcbn07XG5cbi8qKlxuICogZGVmYXVsdCBjb21wYXJlIGZ1bmN0aW9ucyBcbiAqKi9cblNvcnRlZExpc3QuY29tcGFyZSA9IHtcbiAgXCJudW1iZXJcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBjID0gYSAtIGI7XG4gICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICB9LFxuXG4gIFwic3RyaW5nXCI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gKGEgPiBiKSA/IDEgOiAoYSA9PSBiKSAgPyAwIDogLTE7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmNvbXBhcmUgPSBTb3J0ZWRMaXN0LmNvbXBhcmVbXCJudW1iZXJcIl07XG5cbmV4cG9ydHMuU29ydGVkTGlzdCA9IFNvcnRlZExpc3Q7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCJ2YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbi8vIEZhc3RlciB0aGFuIE1hdGguZmxvb3IgKGh0dHA6Ly93ZWJkb29kLmNvbS8/cD0yMTkpXG5tb2R1bGUuZXhwb3J0cy5mbG9vckhhY2sgPSBmdW5jdGlvbihudW0pIHsgcmV0dXJuIChudW0gPDwgMCkgLSAobnVtIDwgMCA/IDEgOiAwKTsgfVxuXG4vLyBPdGhlciB0aW55IGZ1bmN0aW9ucyB0aGF0IHdlIG5lZWQgZm9yIG9kZHMgYW5kIGVuZHMuLi5cbnZhciBzdHJpcCA9IG1vZHVsZS5leHBvcnRzLnN0cmlwID0gZnVuY3Rpb24oc3RyKSB7IHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpOyB9XG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBwYXJzZUludCh2YWwsIDEwKTsgfVxubW9kdWxlLmV4cG9ydHMuZGVlcENsb25lID0gZnVuY3Rpb24ob2JqKSB7IHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iaikpOyB9XG5cbi8vIFRoZSBkZWZhdWx0IHdheSBieSB3aGljaCB3ZSBkZXJpdmUgYSBuYW1lIHRvIGJlIHByaW50ZWQgbmV4dCB0byBhIHJhbmdlIGZlYXR1cmVcbnZhciBkZWZhdWx0TmFtZUZ1bmMgPSBtb2R1bGUuZXhwb3J0cy5kZWZhdWx0TmFtZUZ1bmMgPSBmdW5jdGlvbihkKSB7IHJldHVybiBzdHJpcChkLm5hbWUgfHwgZC5pZCB8fCAnJyk7IH1cblxuLy8gUGFyc2UgYSB0cmFjayBkZWNsYXJhdGlvbiBsaW5lLCB3aGljaCBpcyBpbiB0aGUgZm9ybWF0IG9mOlxuLy8gdHJhY2sgbmFtZT1cImJsYWhcIiBvcHRuYW1lMT1cInZhbHVlMVwiIG9wdG5hbWUyPVwidmFsdWUyXCIgLi4uXG4vLyBpbnRvIGEgaGFzaCBvZiBvcHRpb25zXG5tb2R1bGUuZXhwb3J0cy5wYXJzZURlY2xhcmF0aW9uTGluZSA9IGZ1bmN0aW9uKGxpbmUsIHN0YXJ0KSB7XG4gIHZhciBvcHRzID0ge30sIG9wdG5hbWUgPSAnJywgdmFsdWUgPSAnJywgc3RhdGUgPSAnb3B0bmFtZSc7XG4gIGZ1bmN0aW9uIHB1c2hWYWx1ZShxdW90aW5nKSB7XG4gICAgc3RhdGUgPSAnb3B0bmFtZSc7XG4gICAgb3B0c1tvcHRuYW1lLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKV0gPSB2YWx1ZTtcbiAgICBvcHRuYW1lID0gdmFsdWUgPSAnJztcbiAgfVxuICBmb3IgKGkgPSBsaW5lLm1hdGNoKHN0YXJ0KVswXS5sZW5ndGg7IGkgPCBsaW5lLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IGxpbmVbaV07XG4gICAgaWYgKHN0YXRlID09ICdvcHRuYW1lJykge1xuICAgICAgaWYgKGMgPT0gJz0nKSB7IHN0YXRlID0gJ3N0YXJ0dmFsdWUnOyB9XG4gICAgICBlbHNlIHsgb3B0bmFtZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAnc3RhcnR2YWx1ZScpIHtcbiAgICAgIGlmICgvJ3xcIi8udGVzdChjKSkgeyBzdGF0ZSA9IGM7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyBzdGF0ZSA9ICd2YWx1ZSc7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICd2YWx1ZScpIHtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7IHB1c2hWYWx1ZSgpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoLyd8XCIvLnRlc3Qoc3RhdGUpKSB7XG4gICAgICBpZiAoYyA9PSBzdGF0ZSkgeyBwdXNoVmFsdWUoc3RhdGUpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH1cbiAgfVxuICBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykgeyBwdXNoVmFsdWUoKTsgfVxuICBpZiAoc3RhdGUgIT0gJ29wdG5hbWUnKSB7IHJldHVybiBmYWxzZTsgfVxuICByZXR1cm4gb3B0cztcbn1cblxuLy8gQ29uc3RydWN0cyBhIG1hcHBpbmcgZnVuY3Rpb24gdGhhdCBjb252ZXJ0cyBicCBpbnRlcnZhbHMgaW50byBwaXhlbCBpbnRlcnZhbHMsIHdpdGggb3B0aW9uYWwgY2FsY3VsYXRpb25zIGZvciB0ZXh0IHRvb1xubW9kdWxlLmV4cG9ydHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yID0gZnVuY3Rpb24oc3RhcnQsIHdpZHRoLCBicHBwLCB3aXRoVGV4dCwgbmFtZUZ1bmMsIHN0YXJ0a2V5LCBlbmRrZXkpIHtcbiAgaWYgKCFfLmlzRnVuY3Rpb24obmFtZUZ1bmMpKSB7IG5hbWVGdW5jID0gZGVmYXVsdE5hbWVGdW5jOyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKHN0YXJ0a2V5KSkgeyBzdGFydGtleSA9ICdzdGFydCc7IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoZW5ka2V5KSkgeyBlbmRrZXkgPSAnZW5kJzsgfVxuICByZXR1cm4gZnVuY3Rpb24oZCkge1xuICAgIHZhciBpdHZsU3RhcnQgPSBfLmlzVW5kZWZpbmVkKGRbc3RhcnRrZXldKSA/IGQuc3RhcnQgOiBkW3N0YXJ0a2V5XSxcbiAgICAgIGl0dmxFbmQgPSBfLmlzVW5kZWZpbmVkKGRbZW5ka2V5XSkgPyBkLmVuZCA6IGRbZW5ka2V5XTtcbiAgICB2YXIgcEludCA9IHtcbiAgICAgIHg6IE1hdGgucm91bmQoKGl0dmxTdGFydCAtIHN0YXJ0KSAvIGJwcHApLFxuICAgICAgdzogKGl0dmxFbmQgLSBpdHZsU3RhcnQpIC8gYnBwcCxcbiAgICAgIHQ6IDAsICAgICAgICAgIC8vIGNhbGN1bGF0ZWQgd2lkdGggb2YgdGV4dFxuICAgICAgb1ByZXY6IGZhbHNlLCAgLy8gb3ZlcmZsb3dzIGludG8gcHJldmlvdXMgdGlsZT9cbiAgICAgIG9OZXh0OiBmYWxzZSAgIC8vIG92ZXJmbG93cyBpbnRvIG5leHQgdGlsZT9cbiAgICB9O1xuICAgIC8vIHNtYWxsIHBvc2l0aXZlIGludGVydmFscyBnZXQgZm9yY2libHkgcm91bmRlZCB1cCB0byAxIChzbyB0aGV5IGFyZSBkcmF3biksIGV2ZXJ5dGhpbmcgZWxzZSB0byB0aGUgbmVhcmVzdCB3aG9sZSBwaXhlbFxuICAgIHBJbnQudyA9IHBJbnQudyA+IDAgJiYgcEludC53IDwgMSA/IDEgOiBNYXRoLnJvdW5kKHBJbnQudyk7XG4gICAgcEludC50eCA9IHBJbnQueDtcbiAgICBwSW50LnR3ID0gcEludC53O1xuICAgIGlmIChwSW50LnggPCAwKSB7IHBJbnQudyArPSBwSW50Lng7IHBJbnQueCA9IDA7IHBJbnQub1ByZXYgPSB0cnVlOyB9XG4gICAgZWxzZSBpZiAod2l0aFRleHQpIHtcbiAgICAgIHBJbnQudCA9IF8uaXNOdW1iZXIod2l0aFRleHQpID8gd2l0aFRleHQgOiBNYXRoLm1pbihuYW1lRnVuYyhkKS5sZW5ndGggKiAxMCArIDIsIHBJbnQueCk7XG4gICAgICBwSW50LnR4IC09IHBJbnQudDtcbiAgICAgIHBJbnQudHcgKz0gcEludC50OyAgXG4gICAgfVxuICAgIGlmIChwSW50LnggKyBwSW50LncgPiB3aWR0aCkgeyBwSW50LncgPSB3aWR0aCAtIHBJbnQueDsgcEludC5vTmV4dCA9IHRydWU7IH1cbiAgICByZXR1cm4gcEludDtcbiAgfTtcbn07XG5cbi8vIEZvciB0d28gZ2l2ZW4gb2JqZWN0cyBvZiB0aGUgZm9ybSB7eDogMSwgdzogMn0gKHBpeGVsIGludGVydmFscyksIGRlc2NyaWJlIHRoZSBvdmVybGFwLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZXJlIGlzIG5vIG92ZXJsYXAuXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbE92ZXJsYXAgPSBmdW5jdGlvbihwSW50MSwgcEludDIpIHtcbiAgdmFyIG92ZXJsYXAgPSB7fSxcbiAgICB0bXA7XG4gIGlmIChwSW50MS54ID4gcEludDIueCkgeyB0bXAgPSBwSW50MjsgcEludDIgPSBwSW50MTsgcEludDEgPSB0bXA7IH0gICAgICAgLy8gc3dhcCBzbyB0aGF0IHBJbnQxIGlzIGFsd2F5cyBsb3dlclxuICBpZiAoIXBJbnQxLncgfHwgIXBJbnQyLncgfHwgcEludDEueCArIHBJbnQxLncgPCBwSW50Mi54KSB7IHJldHVybiBudWxsOyB9IC8vIGRldGVjdCBuby1vdmVybGFwIGNvbmRpdGlvbnNcbiAgb3ZlcmxhcC54ID0gcEludDIueDtcbiAgb3ZlcmxhcC53ID0gTWF0aC5taW4ocEludDEudyAtIHBJbnQyLnggKyBwSW50MS54LCBwSW50Mi53KTtcbiAgcmV0dXJuIG92ZXJsYXA7XG59O1xuXG4vLyBDb21tb24gZnVuY3Rpb25zIGZvciBzdW1tYXJpemluZyBkYXRhIGluIGJpbnMgd2hpbGUgcGxvdHRpbmcgd2lnZ2xlIHRyYWNrc1xubW9kdWxlLmV4cG9ydHMud2lnQmluRnVuY3Rpb25zID0ge1xuICBtaW5pbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1pbi5hcHBseShNYXRoLCBiaW4pIDogMDsgfSxcbiAgbWVhbjogZnVuY3Rpb24oYmluKSB7IHJldHVybiBfLnJlZHVjZShiaW4sIGZ1bmN0aW9uKGEsYikgeyByZXR1cm4gYSArIGI7IH0sIDApIC8gYmluLmxlbmd0aDsgfSxcbiAgbWF4aW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5tYXguYXBwbHkoTWF0aCwgYmluKSA6IDA7IH1cbn07XG5cbi8vIENvbnZlcnRzIGEgVVJMIHRlbXBsYXRlIHdpdGggJXMsICVzLCAlZCBldGMuIHNwZWNpZmllcnMsIHdoaWNoIGFyZSB1c2VkIGZvciBgZGlyZWN0VXJsYCBpbiBVQ1NDIHRyYWNrRGInc1xuLy8gaHR0cHM6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3RyYWNrRGIvdHJhY2tEYkh1Yi5odG1sXG4vLyBpbnRvIG9uZSB0aGF0IGlzIGNvbXBhdGlibGUgd2l0aCB0aGUgYHVybGAgcGFyYW1ldGVyIG9uIHRoZSBzYW1lIHBhZ2UsIHdoaWNoIHVzZXMgJCQsICRULCAkUywgZXRjLlxubW9kdWxlLmV4cG9ydHMuY29udmVydFVybFRlbXBsYXRlRm9ybWF0ID0gZnVuY3Rpb24odXJsKSB7XG4gIHZhciB0b1JlcGxhY2UgPSB7XCIkJCQkXCI6ICclcycsIFwiJFNcIjogJyVzJywgXCIke1wiOiAnJWQnLCBcIiR9XCI6ICclZCcsIFwiJFRcIjogXCIlc1wiLCBcIiREXCI6IFwiJXNcIn1cbiAgXy5lYWNoKHRvUmVwbGFjZSwgZnVuY3Rpb24ocGxhY2Vob2xkZXIsIHJlcGxhY2VtZW50KSB7XG4gICAgdXJsID0gdXJsLnJlcGxhY2UocGxhY2Vob2xkZXIsIHJlcGxhY2VtZW50KTtcbiAgfSk7XG4gIHJldHVybiB1cmw7XG59IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gdmNmVGFiaXggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC92Y2YuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy52Y2Z0YWJpeFxudmFyIFZjZlRhYml4Rm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiA1MDAsIHBhY2s6IDEwMH0sXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDEwMDAwMCxcbiAgICBjaHJvbW9zb21lczogJydcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIHZjZlRhYml4IHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgLy8gVE9ETzogU2V0IG1heEZldGNoV2luZG93IHVzaW5nIHNvbWUgaGV1cmlzdGljIGJhc2VkIG9uIGhvdyBtYW55IGl0ZW1zIGFyZSBpbiB0aGUgdGFiaXggaW5kZXhcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICByYW5nZSA9IHRoaXMuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZVRvSW50ZXJ2YWwobGluZSkge1xuICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoJ1xcdCcpLCBkYXRhID0ge30sIGluZm8gPSB7fTtcbiAgICAgIGlmIChmaWVsZHNbN10pIHtcbiAgICAgICAgXy5lYWNoKGZpZWxkc1s3XS5zcGxpdCgnOycpLCBmdW5jdGlvbihsKSB7IGwgPSBsLnNwbGl0KCc9Jyk7IGlmIChsLmxlbmd0aCA+IDEpIHsgaW5mb1tsWzBdXSA9IGxbMV07IH0gfSk7XG4gICAgICB9XG4gICAgICBkYXRhLnN0YXJ0ID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZmllbGRzWzBdXSArIHBhcnNlSW50MTAoZmllbGRzWzFdKTtcbiAgICAgIGRhdGEuaWQgPSBmaWVsZHNbMl09PScuJyA/ICd2Y2YtJyArIE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMDAwMCkgOiBmaWVsZHNbMl07XG4gICAgICBkYXRhLmVuZCA9IGRhdGEuc3RhcnQgKyAxO1xuICAgICAgZGF0YS5yZWYgPSBmaWVsZHNbM107XG4gICAgICBkYXRhLmFsdCA9IGZpZWxkc1s0XTtcbiAgICAgIGRhdGEucXVhbCA9IHBhcnNlRmxvYXQoZmllbGRzWzVdKTtcbiAgICAgIGRhdGEuaW5mbyA9IGluZm87XG4gICAgICByZXR1cm4ge2RhdGE6IGRhdGF9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBuYW1lRnVuYyhmaWVsZHMpIHtcbiAgICAgIHZhciByZWYgPSBmaWVsZHMucmVmIHx8ICcnLFxuICAgICAgICBhbHQgPSBmaWVsZHMuYWx0IHx8ICcnO1xuICAgICAgcmV0dXJuIChyZWYubGVuZ3RoID4gYWx0Lmxlbmd0aCA/IHJlZiA6IGFsdCkgfHwgJyc7XG4gICAgfVxuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLFxuICAgICAgICBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+IDg7IH0pLFxuICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snLCBuYW1lRnVuYyk7XG4gICAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIGRyYXdTcGVjLnB1c2goY2FsY1BpeEludGVydmFsKGxpbmVUb0ludGVydmFsKGxpbmUpLmRhdGEpKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dChfLm1hcChsaW5lcywgbGluZVRvSW50ZXJ2YWwpLCB3aWR0aCwgY2FsY1BpeEludGVydmFsKX07XG4gICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgd2UgY2FuIHJlYXNvbmFibHkgZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtdWNoIGRhdGEsIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIC8vIFRPRE86IGNhY2hlIHJlc3VsdHMgc28gd2UgYXJlbid0IHJlZmV0Y2hpbmcgdGhlIHNhbWUgcmVnaW9ucyBvdmVyIGFuZCBvdmVyIGFnYWluLlxuICAgIGlmICgoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAkLmFqYXgodGhpcy5hamF4RGlyKCkgKyAndGFiaXgucGhwJywge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gdGhpcy5vcHRzLnVybCA/IHRoaXMub3B0cy51cmwgOiAnamF2YXNjcmlwdDp2b2lkKFwiJyt0aGlzLm9wdHMubmFtZSsnOiQkXCIpJyxcbiAgICAgIGxpbmVIZWlnaHQgPSBkZW5zaXR5ID09ICdwYWNrJyA/IDI3IDogNixcbiAgICAgIGNvbG9ycyA9IHthOicyNTUsMCwwJywgdDonMjU1LDAsMjU1JywgYzonMCwwLDI1NScsIGc6JzAsMjU1LDAnfSxcbiAgICAgIGRyYXdMaW1pdCA9IHRoaXMub3B0cy5kcmF3TGltaXQgJiYgdGhpcy5vcHRzLmRyYXdMaW1pdFtkZW5zaXR5XSxcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBpZiAoZGVuc2l0eSA9PSAncGFjaycpIHsgYXJlYXMgPSB0aGlzLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYigwLDAsMClcIjtcbiAgICB0aGlzLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBpZiAoKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgfSBlbHNlIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDE1O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QocEludC54LCAxLCBwSW50LncsIDEzKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGwsIGkpIHtcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgdmFyIGFsdENvbG9yLCByZWZDb2xvcjtcbiAgICAgICAgICAgIGlmIChhcmVhcykge1xuICAgICAgICAgICAgICByZWZDb2xvciA9IGNvbG9yc1tkYXRhLmQucmVmLnRvTG93ZXJDYXNlKCldIHx8ICcyNTUsMCwwJztcbiAgICAgICAgICAgICAgYWx0Q29sb3IgPSBjb2xvcnNbZGF0YS5kLmFsdC50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIiArIGFsdENvbG9yICsgXCIpXCI7IFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3R4LmZpbGxSZWN0KGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gMSk7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgYXJlYXMucHVzaChbXG4gICAgICAgICAgICAgICAgZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LnggKyBkYXRhLnBJbnQudywgKGkgKyAxKSAqIGxpbmVIZWlnaHQsIC8veDEsIHgyLCB5MSwgeTJcbiAgICAgICAgICAgICAgICBkYXRhLmQucmVmICsgJyA+ICcgKyBkYXRhLmQuYWx0LCAvLyB0aXRsZVxuICAgICAgICAgICAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgZGF0YS5kLmlkKSwgLy8gaHJlZlxuICAgICAgICAgICAgICAgIGRhdGEucEludC5vUHJldiwgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgICAgICAgICAgICBhbHRDb2xvciwgLy8gbGFiZWwgY29sb3JcbiAgICAgICAgICAgICAgICAnPHNwYW4gc3R5bGU9XCJjb2xvcjogcmdiKCcgKyByZWZDb2xvciArICcpXCI+JyArIGRhdGEuZC5yZWYgKyAnPC9zcGFuPjxici8+JyArIGRhdGEuZC5hbHQsIC8vIGxhYmVsXG4gICAgICAgICAgICAgICAgZGF0YS5kLmluZm9cbiAgICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZjZlRhYml4Rm9ybWF0O1xuXG4iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gV0lHIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvd2lnZ2xlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTAsXG4gIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vdXRpbHMvU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLndpZ2dsZV8wXG52YXIgV2lnZ2xlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgX2JpbkZ1bmN0aW9ucyA9IHRoaXMudHlwZSgpLl9iaW5GdW5jdGlvbnM7XG4gICAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcikpIHsgby5hbHRDb2xvciA9ICcnOyB9XG4gICAgby52aWV3TGltaXRzID0gXy5tYXAoby52aWV3TGltaXRzLnNwbGl0KCc6JyksIHBhcnNlRmxvYXQpO1xuICAgIG8ubWF4SGVpZ2h0UGl4ZWxzID0gXy5tYXAoby5tYXhIZWlnaHRQaXhlbHMuc3BsaXQoJzonKSwgcGFyc2VJbnQxMCk7XG4gICAgby55TGluZU9uT2ZmID0gdGhpcy5pc09uKG8ueUxpbmVPbk9mZik7XG4gICAgby55TGluZU1hcmsgPSBwYXJzZUZsb2F0KG8ueUxpbmVNYXJrKTtcbiAgICBvLmF1dG9TY2FsZSA9IHRoaXMuaXNPbihvLmF1dG9TY2FsZSk7XG4gICAgby53aW5kb3dpbmdGdW5jdGlvbiA9IG8ud2luZG93aW5nRnVuY3Rpb24udG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoX2JpbkZ1bmN0aW9ucyAmJiAhX2JpbkZ1bmN0aW9uc1tvLndpbmRvd2luZ0Z1bmN0aW9uXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCB3aW5kb3dpbmdGdW5jdGlvbiBgXCIgKyBvLndpbmRvd2luZ0Z1bmN0aW9uICsgXCJgIGF0IGxpbmUgXCIgKyBvLmxpbmVOdW0pOyBcbiAgICB9XG4gICAgaWYgKF8uaXNOYU4oby55TGluZU1hcmspKSB7IG8ueUxpbmVNYXJrID0gMC4wOyB9XG4gIH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgc2VsZi5kcmF3UmFuZ2UgPSBvLmF1dG9TY2FsZSB8fCBvLnZpZXdMaW1pdHMubGVuZ3RoIDwgMiA/IHNlbGYucmFuZ2UgOiBvLnZpZXdMaW1pdHM7XG4gICAgXy5lYWNoKHttYXg6IDAsIG1pbjogMiwgc3RhcnQ6IDF9LCBmdW5jdGlvbih2LCBrKSB7IHNlbGYuaGVpZ2h0c1trXSA9IG8ubWF4SGVpZ2h0UGl4ZWxzW3ZdOyB9KTtcbiAgICBzZWxmLnNjYWxlcyA9IHtcbiAgICAgIF9hbGw6IFt7bGltaXRzOiBzZWxmLmRyYXdSYW5nZSwgdG9wOiAwLCBib3R0b206IDB9XVxuICAgIH07XG4gICAgaWYgKG8ueUxpbmVPbk9mZikgeyBzZWxmLnNjYWxlcy5fYWxsWzBdLnlMaW5lID0gby55TGluZU1hcms7IH1cbiAgICBcbiAgICBpZiAoIW8uYWx0Q29sb3IpIHtcbiAgICAgIHZhciBoc2wgPSB0aGlzLnJnYlRvSHNsLmFwcGx5KHRoaXMsIG8uY29sb3Iuc3BsaXQoLyxcXHMqL2cpKTtcbiAgICAgIGhzbFswXSA9IGhzbFswXSArIDAuMDIgJSAxO1xuICAgICAgaHNsWzFdID0gaHNsWzFdICogMC43O1xuICAgICAgaHNsWzJdID0gMSAtICgxIC0gaHNsWzJdKSAqIDAuNztcbiAgICAgIHNlbGYuYWx0Q29sb3IgPSBfLm1hcCh0aGlzLmhzbFRvUmdiLmFwcGx5KHRoaXMsIGhzbCksIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIHZhbCwgc3RhcnQ7XG4gICAgICBcbiAgICAgIG0gPSBsaW5lLm1hdGNoKC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgaWYgKG0pIHtcbiAgICAgICAgbW9kZSA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbW9kZU9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgICAgbW9kZU9wdHMuc3RhcnQgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0YXJ0KTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGFydCkgfHwgIW1vZGVPcHRzLnN0YXJ0KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0YXJ0IHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3RlcCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RlcCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RlcCkgfHwgIW1vZGVPcHRzLnN0ZXApKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RlcCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnNwYW4gPSBwYXJzZUludDEwKG1vZGVPcHRzLnNwYW4pIHx8IDE7XG4gICAgICAgIGNoclBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW21vZGVPcHRzLmNocm9tXTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIW1vZGUpIHsgXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV2lnZ2xlIGZvcm1hdCBhdCBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgaGFzIG5vIHByZWNlZGluZyBtb2RlIGRlY2xhcmF0aW9uXCIpOyBcbiAgICAgICAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICAvLyBpbnZhbGlkIGNocm9tb3NvbWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnKSB7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmUpO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0LCBlbmQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICAgIG1vZGVPcHRzLnN0YXJ0ICs9IG1vZGVPcHRzLnN0ZXA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmUgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgICAgICBpZiAobGluZS5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlhYmxlU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlcyB0d28gdmFsdWVzIHBlciBsaW5lXCIpOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChsaW5lWzBdKTtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZVsxXSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBzZWxmLnR5cGUoKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgZmluaXNoUGFyc2U6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXTtcbiAgICBpZiAoZGF0YS5hbGwubGVuZ3RoID4gMCkge1xuICAgICAgc2VsZi5yYW5nZVswXSA9IF8ubWluKGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgICAgc2VsZi5yYW5nZVsxXSA9IF8ubWF4KGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgIH1cbiAgICBkYXRhLmFsbCA9IG5ldyBTb3J0ZWRMaXN0KGRhdGEuYWxsLCB7XG4gICAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhID09PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICAgIGlmIChiID09PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09PSAwKSAgPyAwIDogLTE7XG4gICAgICB9XG4gICAgfSk7XG4gIFxuICAgIC8vIFByZS1vcHRpbWl6ZSBkYXRhIGZvciBoaWdoIGJwcHBzIGJ5IGRvd25zYW1wbGluZ1xuICAgIF8uZWFjaChzZWxmLmJyb3dzZXJPcHRzLmJwcHBzLCBmdW5jdGlvbihicHBwKSB7XG4gICAgICBpZiAoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCA+IDEwMDAwMDApIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgcGl4TGVuID0gTWF0aC5jZWlsKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHApLFxuICAgICAgICBkb3duc2FtcGxlZERhdGEgPSAoZGF0YVticHBwXSA9IChnbG9iYWwuRmxvYXQzMkFycmF5ID8gbmV3IEZsb2F0MzJBcnJheShwaXhMZW4pIDogbmV3IEFycmF5KHBpeExlbikpKSxcbiAgICAgICAgaiA9IDAsXG4gICAgICAgIGN1cnIgPSBkYXRhLmFsbC5nZXQoMCksXG4gICAgICAgIGJpbiwgbmV4dDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGl4TGVuOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5zdGFydCA8PSBpICogYnBwcCAmJiBjdXJyLmVuZCA+IGkgKiBicHBwKSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICYmIG5leHQuZW5kID4gaSAqIGJwcHApIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkb3duc2FtcGxlZERhdGFbaV0gPSBiaW5GdW5jdGlvbihiaW4pO1xuICAgICAgfVxuICAgICAgZGF0YS5fYmluRnVuY3Rpb24gPSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb247XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7IC8vIHN1Y2Nlc3MhXG4gIH0sXG4gIFxuICBpbml0RHJhd1NwZWM6IGZ1bmN0aW9uKHByZWNhbGMpIHtcbiAgICB2YXIgdlNjYWxlID0gKHRoaXMuZHJhd1JhbmdlWzFdIC0gdGhpcy5kcmF3UmFuZ2VbMF0pLFxuICAgICAgZHJhd1NwZWMgPSB7XG4gICAgICAgIGJhcnM6IFtdLFxuICAgICAgICB2U2NhbGU6IHZTY2FsZSxcbiAgICAgICAgeUxpbmU6IHRoaXMuaXNPbih0aGlzLm9wdHMueUxpbmVPbk9mZikgPyBNYXRoLnJvdW5kKCh0aGlzLm9wdHMueUxpbmVNYXJrIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gdlNjYWxlKSA6IG51bGwsIFxuICAgICAgICB6ZXJvTGluZTogLXRoaXMuZHJhd1JhbmdlWzBdIC8gdlNjYWxlXG4gICAgICB9O1xuICAgIHJldHVybiBkcmF3U3BlYztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyBwcmVjYWxjLndpZHRoLFxuICAgICAgZHJhd1NwZWMgPSBzZWxmLnR5cGUoKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dLFxuICAgICAgZG93bnNhbXBsZWREYXRhO1xuICAgIGlmIChzZWxmLmRhdGEuX2JpbkZ1bmN0aW9uID09IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbiAmJiAoZG93bnNhbXBsZWREYXRhID0gc2VsZi5kYXRhW2JwcHBdKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBwcmUtb3B0aW1pemVkIGZvciB0aGlzIGJwcHBcbiAgICAgIGRyYXdTcGVjLmJhcnMgPSBfLm1hcChfLnJhbmdlKChzdGFydCAtIDEpIC8gYnBwcCwgKGVuZCAtIDEpIC8gYnBwcCksIGZ1bmN0aW9uKHhGcm9tT3JpZ2luLCB4KSB7XG4gICAgICAgIHJldHVybiAoKGRvd25zYW1wbGVkRGF0YVt4RnJvbU9yaWdpbl0gfHwgMCkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGU7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2UgaGF2ZSB0byBkbyB0aGUgYmlubmluZyBvbiB0aGUgZmx5XG4gICAgICB2YXIgaiA9IHNlbGYuZGF0YS5hbGwuYnNlYXJjaCh7c3RhcnQ6IHN0YXJ0fSksXG4gICAgICAgIGN1cnIgPSBzZWxmLmRhdGEuYWxsLmdldChqKSwgbmV4dCwgYmluO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjYWxjLndpZHRoOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IHNlbGYuZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgbmV4dC5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRyYXdTcGVjLmJhcnMucHVzaCgoYmluRnVuY3Rpb24oYmluKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soZHJhd1NwZWMpIDogZHJhd1NwZWM7XG4gIH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCkge1xuICAgIHZhciB6ZXJvTGluZSA9IGRyYXdTcGVjLnplcm9MaW5lICogaGVpZ2h0LCAvLyBwaXhlbCBwb3NpdGlvbiBvZiB0aGUgZGF0YSB2YWx1ZSAwXG4gICAgICBjb2xvciA9IFwicmdiKFwiK3RoaXMub3B0cy5jb2xvcitcIilcIixcbiAgICAgIGFsdENvbG9yID0gXCJyZ2IoXCIrKHRoaXMub3B0cy5hbHRDb2xvciB8fCB0aGlzLmFsdENvbG9yKStcIilcIixcbiAgICAgIHBvaW50R3JhcGggPSB0aGlzLm9wdHMuZ3JhcGhUeXBlPT09J3BvaW50cyc7XG4gICAgXG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgIF8uZWFjaChkcmF3U3BlYy5iYXJzLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICB2YXIgeSA9IGQgKiBoZWlnaHQ7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGVsc2UgaWYgKHkgPiB6ZXJvTGluZSkgeyBcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIHksIDEsIDEpOyB9XG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0geSwgMSwgemVyb0xpbmUgPiAwID8gKHkgLSB6ZXJvTGluZSkgOiB5KTsgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGFsdENvbG9yO1xuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgemVyb0xpbmUgLSB5IC0gMSwgMSwgMSk7IH0gXG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gemVyb0xpbmUsIDEsIHplcm9MaW5lIC0geSk7IH1cbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChkcmF3U3BlYy55TGluZSAhPT0gbnVsbCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIGhlaWdodCAtIGRyYXdTcGVjLnlMaW5lLCB3aWR0aCwgMSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGNhbnZhcy5oZWlnaHQsIHdpZHRoKTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICAkdmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnLnZpZXctbGltaXRzJyksXG4gICAgICAkbWF4SGVpZ2h0UGl4ZWxzID0gJGRpYWxvZy5maW5kKCcubWF4LWhlaWdodC1waXhlbHMnKSxcbiAgICAgIGFsdENvbG9yT24gPSB0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmF0dHIoJ2NoZWNrZWQnLCBhbHRDb2xvck9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbChhbHRDb2xvck9uID8gby5hbHRDb2xvciA6JzEyOCwxMjgsMTI4JykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuYXR0cignY2hlY2tlZCcsICF0aGlzLmlzT24oby5hdXRvU2NhbGUpKS5jaGFuZ2UoKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtaW5cIiwgdGhpcy5yYW5nZVswXSk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWF4XCIsIHRoaXMucmFuZ2VbMV0pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMF0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMV0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8ueUxpbmVPbk9mZikpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbChvLnlMaW5lTWFyaykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKG8uZ3JhcGhUeXBlKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbChvLndpbmRvd2luZ0Z1bmN0aW9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmF0dHIoJ2NoZWNrZWQnLCBvLm1heEhlaWdodFBpeGVscy5sZW5ndGggPj0gMyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzJdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMF0pLmNoYW5nZSgpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGFsdENvbG9yT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNNYXggPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoKTtcbiAgICBvLmFsdENvbG9yID0gYWx0Q29sb3JPbiA/ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKCkgOiAnJztcbiAgICBvLmF1dG9TY2FsZSA9ICEkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKCkgKyAnOicgKyAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKCk7XG4gICAgby55TGluZU9uT2ZmID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8ueUxpbmVNYXJrID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKCk7XG4gICAgby5ncmFwaFR5cGUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoKTtcbiAgICBvLndpbmRvd2luZ0Z1bmN0aW9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoKTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IG1heEhlaWdodFBpeGVsc09uID8gXG4gICAgICBbbWF4SGVpZ2h0UGl4ZWxzTWF4LCBtYXhIZWlnaHRQaXhlbHNNYXgsICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbCgpXS5qb2luKCc6JykgOiAnJztcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gV2lnZ2xlRm9ybWF0OyIsIi8vICAgICBVbmRlcnNjb3JlLmpzIDEuOC4zXG4vLyAgICAgaHR0cDovL3VuZGVyc2NvcmVqcy5vcmdcbi8vICAgICAoYykgMjAwOS0yMDE1IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4vLyAgICAgVW5kZXJzY29yZSBtYXkgYmUgZnJlZWx5IGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbihmdW5jdGlvbigpe2Z1bmN0aW9uIG4obil7ZnVuY3Rpb24gdCh0LHIsZSx1LGksbyl7Zm9yKDtpPj0wJiZvPmk7aSs9bil7dmFyIGE9dT91W2ldOmk7ZT1yKGUsdFthXSxhLHQpfXJldHVybiBlfXJldHVybiBmdW5jdGlvbihyLGUsdSxpKXtlPWIoZSxpLDQpO3ZhciBvPSFrKHIpJiZtLmtleXMociksYT0ob3x8cikubGVuZ3RoLGM9bj4wPzA6YS0xO3JldHVybiBhcmd1bWVudHMubGVuZ3RoPDMmJih1PXJbbz9vW2NdOmNdLGMrPW4pLHQocixlLHUsbyxjLGEpfX1mdW5jdGlvbiB0KG4pe3JldHVybiBmdW5jdGlvbih0LHIsZSl7cj14KHIsZSk7Zm9yKHZhciB1PU8odCksaT1uPjA/MDp1LTE7aT49MCYmdT5pO2krPW4paWYocih0W2ldLGksdCkpcmV0dXJuIGk7cmV0dXJuLTF9fWZ1bmN0aW9uIHIobix0LHIpe3JldHVybiBmdW5jdGlvbihlLHUsaSl7dmFyIG89MCxhPU8oZSk7aWYoXCJudW1iZXJcIj09dHlwZW9mIGkpbj4wP289aT49MD9pOk1hdGgubWF4KGkrYSxvKTphPWk+PTA/TWF0aC5taW4oaSsxLGEpOmkrYSsxO2Vsc2UgaWYociYmaSYmYSlyZXR1cm4gaT1yKGUsdSksZVtpXT09PXU/aTotMTtpZih1IT09dSlyZXR1cm4gaT10KGwuY2FsbChlLG8sYSksbS5pc05hTiksaT49MD9pK286LTE7Zm9yKGk9bj4wP286YS0xO2k+PTAmJmE+aTtpKz1uKWlmKGVbaV09PT11KXJldHVybiBpO3JldHVybi0xfX1mdW5jdGlvbiBlKG4sdCl7dmFyIHI9SS5sZW5ndGgsZT1uLmNvbnN0cnVjdG9yLHU9bS5pc0Z1bmN0aW9uKGUpJiZlLnByb3RvdHlwZXx8YSxpPVwiY29uc3RydWN0b3JcIjtmb3IobS5oYXMobixpKSYmIW0uY29udGFpbnModCxpKSYmdC5wdXNoKGkpO3ItLTspaT1JW3JdLGkgaW4gbiYmbltpXSE9PXVbaV0mJiFtLmNvbnRhaW5zKHQsaSkmJnQucHVzaChpKX12YXIgdT10aGlzLGk9dS5fLG89QXJyYXkucHJvdG90eXBlLGE9T2JqZWN0LnByb3RvdHlwZSxjPUZ1bmN0aW9uLnByb3RvdHlwZSxmPW8ucHVzaCxsPW8uc2xpY2Uscz1hLnRvU3RyaW5nLHA9YS5oYXNPd25Qcm9wZXJ0eSxoPUFycmF5LmlzQXJyYXksdj1PYmplY3Qua2V5cyxnPWMuYmluZCx5PU9iamVjdC5jcmVhdGUsZD1mdW5jdGlvbigpe30sbT1mdW5jdGlvbihuKXtyZXR1cm4gbiBpbnN0YW5jZW9mIG0/bjp0aGlzIGluc3RhbmNlb2YgbT92b2lkKHRoaXMuX3dyYXBwZWQ9bik6bmV3IG0obil9O1widW5kZWZpbmVkXCIhPXR5cGVvZiBleHBvcnRzPyhcInVuZGVmaW5lZFwiIT10eXBlb2YgbW9kdWxlJiZtb2R1bGUuZXhwb3J0cyYmKGV4cG9ydHM9bW9kdWxlLmV4cG9ydHM9bSksZXhwb3J0cy5fPW0pOnUuXz1tLG0uVkVSU0lPTj1cIjEuOC4zXCI7dmFyIGI9ZnVuY3Rpb24obix0LHIpe2lmKHQ9PT12b2lkIDApcmV0dXJuIG47c3dpdGNoKG51bGw9PXI/MzpyKXtjYXNlIDE6cmV0dXJuIGZ1bmN0aW9uKHIpe3JldHVybiBuLmNhbGwodCxyKX07Y2FzZSAyOnJldHVybiBmdW5jdGlvbihyLGUpe3JldHVybiBuLmNhbGwodCxyLGUpfTtjYXNlIDM6cmV0dXJuIGZ1bmN0aW9uKHIsZSx1KXtyZXR1cm4gbi5jYWxsKHQscixlLHUpfTtjYXNlIDQ6cmV0dXJuIGZ1bmN0aW9uKHIsZSx1LGkpe3JldHVybiBuLmNhbGwodCxyLGUsdSxpKX19cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIG4uYXBwbHkodCxhcmd1bWVudHMpfX0seD1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PW4/bS5pZGVudGl0eTptLmlzRnVuY3Rpb24obik/YihuLHQscik6bS5pc09iamVjdChuKT9tLm1hdGNoZXIobik6bS5wcm9wZXJ0eShuKX07bS5pdGVyYXRlZT1mdW5jdGlvbihuLHQpe3JldHVybiB4KG4sdCwxLzApfTt2YXIgXz1mdW5jdGlvbihuLHQpe3JldHVybiBmdW5jdGlvbihyKXt2YXIgZT1hcmd1bWVudHMubGVuZ3RoO2lmKDI+ZXx8bnVsbD09cilyZXR1cm4gcjtmb3IodmFyIHU9MTtlPnU7dSsrKWZvcih2YXIgaT1hcmd1bWVudHNbdV0sbz1uKGkpLGE9by5sZW5ndGgsYz0wO2E+YztjKyspe3ZhciBmPW9bY107dCYmcltmXSE9PXZvaWQgMHx8KHJbZl09aVtmXSl9cmV0dXJuIHJ9fSxqPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybnt9O2lmKHkpcmV0dXJuIHkobik7ZC5wcm90b3R5cGU9bjt2YXIgdD1uZXcgZDtyZXR1cm4gZC5wcm90b3R5cGU9bnVsbCx0fSx3PWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbih0KXtyZXR1cm4gbnVsbD09dD92b2lkIDA6dFtuXX19LEE9TWF0aC5wb3coMiw1MyktMSxPPXcoXCJsZW5ndGhcIiksaz1mdW5jdGlvbihuKXt2YXIgdD1PKG4pO3JldHVyblwibnVtYmVyXCI9PXR5cGVvZiB0JiZ0Pj0wJiZBPj10fTttLmVhY2g9bS5mb3JFYWNoPWZ1bmN0aW9uKG4sdCxyKXt0PWIodCxyKTt2YXIgZSx1O2lmKGsobikpZm9yKGU9MCx1PW4ubGVuZ3RoO3U+ZTtlKyspdChuW2VdLGUsbik7ZWxzZXt2YXIgaT1tLmtleXMobik7Zm9yKGU9MCx1PWkubGVuZ3RoO3U+ZTtlKyspdChuW2lbZV1dLGlbZV0sbil9cmV0dXJuIG59LG0ubWFwPW0uY29sbGVjdD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9QXJyYXkodSksbz0wO3U+bztvKyspe3ZhciBhPWU/ZVtvXTpvO2lbb109dChuW2FdLGEsbil9cmV0dXJuIGl9LG0ucmVkdWNlPW0uZm9sZGw9bS5pbmplY3Q9bigxKSxtLnJlZHVjZVJpZ2h0PW0uZm9sZHI9bigtMSksbS5maW5kPW0uZGV0ZWN0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZTtyZXR1cm4gZT1rKG4pP20uZmluZEluZGV4KG4sdCxyKTptLmZpbmRLZXkobix0LHIpLGUhPT12b2lkIDAmJmUhPT0tMT9uW2VdOnZvaWQgMH0sbS5maWx0ZXI9bS5zZWxlY3Q9ZnVuY3Rpb24obix0LHIpe3ZhciBlPVtdO3JldHVybiB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsdSl7dChuLHIsdSkmJmUucHVzaChuKX0pLGV9LG0ucmVqZWN0PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbS5maWx0ZXIobixtLm5lZ2F0ZSh4KHQpKSxyKX0sbS5ldmVyeT1tLmFsbD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9MDt1Pmk7aSsrKXt2YXIgbz1lP2VbaV06aTtpZighdChuW29dLG8sbikpcmV0dXJuITF9cmV0dXJuITB9LG0uc29tZT1tLmFueT1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlPSFrKG4pJiZtLmtleXMobiksdT0oZXx8bikubGVuZ3RoLGk9MDt1Pmk7aSsrKXt2YXIgbz1lP2VbaV06aTtpZih0KG5bb10sbyxuKSlyZXR1cm4hMH1yZXR1cm4hMX0sbS5jb250YWlucz1tLmluY2x1ZGVzPW0uaW5jbHVkZT1mdW5jdGlvbihuLHQscixlKXtyZXR1cm4gayhuKXx8KG49bS52YWx1ZXMobikpLChcIm51bWJlclwiIT10eXBlb2Ygcnx8ZSkmJihyPTApLG0uaW5kZXhPZihuLHQscik+PTB9LG0uaW52b2tlPWZ1bmN0aW9uKG4sdCl7dmFyIHI9bC5jYWxsKGFyZ3VtZW50cywyKSxlPW0uaXNGdW5jdGlvbih0KTtyZXR1cm4gbS5tYXAobixmdW5jdGlvbihuKXt2YXIgdT1lP3Q6blt0XTtyZXR1cm4gbnVsbD09dT91OnUuYXBwbHkobixyKX0pfSxtLnBsdWNrPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0ubWFwKG4sbS5wcm9wZXJ0eSh0KSl9LG0ud2hlcmU9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5maWx0ZXIobixtLm1hdGNoZXIodCkpfSxtLmZpbmRXaGVyZT1mdW5jdGlvbihuLHQpe3JldHVybiBtLmZpbmQobixtLm1hdGNoZXIodCkpfSxtLm1heD1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPS0xLzAsbz0tMS8wO2lmKG51bGw9PXQmJm51bGwhPW4pe249ayhuKT9uOm0udmFsdWVzKG4pO2Zvcih2YXIgYT0wLGM9bi5sZW5ndGg7Yz5hO2ErKyllPW5bYV0sZT5pJiYoaT1lKX1lbHNlIHQ9eCh0LHIpLG0uZWFjaChuLGZ1bmN0aW9uKG4scixlKXt1PXQobixyLGUpLCh1Pm98fHU9PT0tMS8wJiZpPT09LTEvMCkmJihpPW4sbz11KX0pO3JldHVybiBpfSxtLm1pbj1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPTEvMCxvPTEvMDtpZihudWxsPT10JiZudWxsIT1uKXtuPWsobik/bjptLnZhbHVlcyhuKTtmb3IodmFyIGE9MCxjPW4ubGVuZ3RoO2M+YTthKyspZT1uW2FdLGk+ZSYmKGk9ZSl9ZWxzZSB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsZSl7dT10KG4scixlKSwobz51fHwxLzA9PT11JiYxLzA9PT1pKSYmKGk9bixvPXUpfSk7cmV0dXJuIGl9LG0uc2h1ZmZsZT1mdW5jdGlvbihuKXtmb3IodmFyIHQscj1rKG4pP246bS52YWx1ZXMobiksZT1yLmxlbmd0aCx1PUFycmF5KGUpLGk9MDtlPmk7aSsrKXQ9bS5yYW5kb20oMCxpKSx0IT09aSYmKHVbaV09dVt0XSksdVt0XT1yW2ldO3JldHVybiB1fSxtLnNhbXBsZT1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PXR8fHI/KGsobil8fChuPW0udmFsdWVzKG4pKSxuW20ucmFuZG9tKG4ubGVuZ3RoLTEpXSk6bS5zaHVmZmxlKG4pLnNsaWNlKDAsTWF0aC5tYXgoMCx0KSl9LG0uc29ydEJ5PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gdD14KHQsciksbS5wbHVjayhtLm1hcChuLGZ1bmN0aW9uKG4scixlKXtyZXR1cm57dmFsdWU6bixpbmRleDpyLGNyaXRlcmlhOnQobixyLGUpfX0pLnNvcnQoZnVuY3Rpb24obix0KXt2YXIgcj1uLmNyaXRlcmlhLGU9dC5jcml0ZXJpYTtpZihyIT09ZSl7aWYocj5lfHxyPT09dm9pZCAwKXJldHVybiAxO2lmKGU+cnx8ZT09PXZvaWQgMClyZXR1cm4tMX1yZXR1cm4gbi5pbmRleC10LmluZGV4fSksXCJ2YWx1ZVwiKX07dmFyIEY9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKHQscixlKXt2YXIgdT17fTtyZXR1cm4gcj14KHIsZSksbS5lYWNoKHQsZnVuY3Rpb24oZSxpKXt2YXIgbz1yKGUsaSx0KTtuKHUsZSxvKX0pLHV9fTttLmdyb3VwQnk9RihmdW5jdGlvbihuLHQscil7bS5oYXMobixyKT9uW3JdLnB1c2godCk6bltyXT1bdF19KSxtLmluZGV4Qnk9RihmdW5jdGlvbihuLHQscil7bltyXT10fSksbS5jb3VudEJ5PUYoZnVuY3Rpb24obix0LHIpe20uaGFzKG4scik/bltyXSsrOm5bcl09MX0pLG0udG9BcnJheT1mdW5jdGlvbihuKXtyZXR1cm4gbj9tLmlzQXJyYXkobik/bC5jYWxsKG4pOmsobik/bS5tYXAobixtLmlkZW50aXR5KTptLnZhbHVlcyhuKTpbXX0sbS5zaXplPWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT1uPzA6ayhuKT9uLmxlbmd0aDptLmtleXMobikubGVuZ3RofSxtLnBhcnRpdGlvbj1mdW5jdGlvbihuLHQscil7dD14KHQscik7dmFyIGU9W10sdT1bXTtyZXR1cm4gbS5lYWNoKG4sZnVuY3Rpb24obixyLGkpeyh0KG4scixpKT9lOnUpLnB1c2gobil9KSxbZSx1XX0sbS5maXJzdD1tLmhlYWQ9bS50YWtlPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09bj92b2lkIDA6bnVsbD09dHx8cj9uWzBdOm0uaW5pdGlhbChuLG4ubGVuZ3RoLXQpfSxtLmluaXRpYWw9ZnVuY3Rpb24obix0LHIpe3JldHVybiBsLmNhbGwobiwwLE1hdGgubWF4KDAsbi5sZW5ndGgtKG51bGw9PXR8fHI/MTp0KSkpfSxtLmxhc3Q9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT1uP3ZvaWQgMDpudWxsPT10fHxyP25bbi5sZW5ndGgtMV06bS5yZXN0KG4sTWF0aC5tYXgoMCxuLmxlbmd0aC10KSl9LG0ucmVzdD1tLnRhaWw9bS5kcm9wPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbC5jYWxsKG4sbnVsbD09dHx8cj8xOnQpfSxtLmNvbXBhY3Q9ZnVuY3Rpb24obil7cmV0dXJuIG0uZmlsdGVyKG4sbS5pZGVudGl0eSl9O3ZhciBTPWZ1bmN0aW9uKG4sdCxyLGUpe2Zvcih2YXIgdT1bXSxpPTAsbz1lfHwwLGE9TyhuKTthPm87bysrKXt2YXIgYz1uW29dO2lmKGsoYykmJihtLmlzQXJyYXkoYyl8fG0uaXNBcmd1bWVudHMoYykpKXt0fHwoYz1TKGMsdCxyKSk7dmFyIGY9MCxsPWMubGVuZ3RoO2Zvcih1Lmxlbmd0aCs9bDtsPmY7KXVbaSsrXT1jW2YrK119ZWxzZSByfHwodVtpKytdPWMpfXJldHVybiB1fTttLmZsYXR0ZW49ZnVuY3Rpb24obix0KXtyZXR1cm4gUyhuLHQsITEpfSxtLndpdGhvdXQ9ZnVuY3Rpb24obil7cmV0dXJuIG0uZGlmZmVyZW5jZShuLGwuY2FsbChhcmd1bWVudHMsMSkpfSxtLnVuaXE9bS51bmlxdWU9ZnVuY3Rpb24obix0LHIsZSl7bS5pc0Jvb2xlYW4odCl8fChlPXIscj10LHQ9ITEpLG51bGwhPXImJihyPXgocixlKSk7Zm9yKHZhciB1PVtdLGk9W10sbz0wLGE9TyhuKTthPm87bysrKXt2YXIgYz1uW29dLGY9cj9yKGMsbyxuKTpjO3Q/KG8mJmk9PT1mfHx1LnB1c2goYyksaT1mKTpyP20uY29udGFpbnMoaSxmKXx8KGkucHVzaChmKSx1LnB1c2goYykpOm0uY29udGFpbnModSxjKXx8dS5wdXNoKGMpfXJldHVybiB1fSxtLnVuaW9uPWZ1bmN0aW9uKCl7cmV0dXJuIG0udW5pcShTKGFyZ3VtZW50cywhMCwhMCkpfSxtLmludGVyc2VjdGlvbj1mdW5jdGlvbihuKXtmb3IodmFyIHQ9W10scj1hcmd1bWVudHMubGVuZ3RoLGU9MCx1PU8obik7dT5lO2UrKyl7dmFyIGk9bltlXTtpZighbS5jb250YWlucyh0LGkpKXtmb3IodmFyIG89MTtyPm8mJm0uY29udGFpbnMoYXJndW1lbnRzW29dLGkpO28rKyk7bz09PXImJnQucHVzaChpKX19cmV0dXJuIHR9LG0uZGlmZmVyZW5jZT1mdW5jdGlvbihuKXt2YXIgdD1TKGFyZ3VtZW50cywhMCwhMCwxKTtyZXR1cm4gbS5maWx0ZXIobixmdW5jdGlvbihuKXtyZXR1cm4hbS5jb250YWlucyh0LG4pfSl9LG0uemlwPWZ1bmN0aW9uKCl7cmV0dXJuIG0udW56aXAoYXJndW1lbnRzKX0sbS51bnppcD1mdW5jdGlvbihuKXtmb3IodmFyIHQ9biYmbS5tYXgobixPKS5sZW5ndGh8fDAscj1BcnJheSh0KSxlPTA7dD5lO2UrKylyW2VdPW0ucGx1Y2sobixlKTtyZXR1cm4gcn0sbS5vYmplY3Q9ZnVuY3Rpb24obix0KXtmb3IodmFyIHI9e30sZT0wLHU9TyhuKTt1PmU7ZSsrKXQ/cltuW2VdXT10W2VdOnJbbltlXVswXV09bltlXVsxXTtyZXR1cm4gcn0sbS5maW5kSW5kZXg9dCgxKSxtLmZpbmRMYXN0SW5kZXg9dCgtMSksbS5zb3J0ZWRJbmRleD1mdW5jdGlvbihuLHQscixlKXtyPXgocixlLDEpO2Zvcih2YXIgdT1yKHQpLGk9MCxvPU8obik7bz5pOyl7dmFyIGE9TWF0aC5mbG9vcigoaStvKS8yKTtyKG5bYV0pPHU/aT1hKzE6bz1hfXJldHVybiBpfSxtLmluZGV4T2Y9cigxLG0uZmluZEluZGV4LG0uc29ydGVkSW5kZXgpLG0ubGFzdEluZGV4T2Y9cigtMSxtLmZpbmRMYXN0SW5kZXgpLG0ucmFuZ2U9ZnVuY3Rpb24obix0LHIpe251bGw9PXQmJih0PW58fDAsbj0wKSxyPXJ8fDE7Zm9yKHZhciBlPU1hdGgubWF4KE1hdGguY2VpbCgodC1uKS9yKSwwKSx1PUFycmF5KGUpLGk9MDtlPmk7aSsrLG4rPXIpdVtpXT1uO3JldHVybiB1fTt2YXIgRT1mdW5jdGlvbihuLHQscixlLHUpe2lmKCEoZSBpbnN0YW5jZW9mIHQpKXJldHVybiBuLmFwcGx5KHIsdSk7dmFyIGk9aihuLnByb3RvdHlwZSksbz1uLmFwcGx5KGksdSk7cmV0dXJuIG0uaXNPYmplY3Qobyk/bzppfTttLmJpbmQ9ZnVuY3Rpb24obix0KXtpZihnJiZuLmJpbmQ9PT1nKXJldHVybiBnLmFwcGx5KG4sbC5jYWxsKGFyZ3VtZW50cywxKSk7aWYoIW0uaXNGdW5jdGlvbihuKSl0aHJvdyBuZXcgVHlwZUVycm9yKFwiQmluZCBtdXN0IGJlIGNhbGxlZCBvbiBhIGZ1bmN0aW9uXCIpO3ZhciByPWwuY2FsbChhcmd1bWVudHMsMiksZT1mdW5jdGlvbigpe3JldHVybiBFKG4sZSx0LHRoaXMsci5jb25jYXQobC5jYWxsKGFyZ3VtZW50cykpKX07cmV0dXJuIGV9LG0ucGFydGlhbD1mdW5jdGlvbihuKXt2YXIgdD1sLmNhbGwoYXJndW1lbnRzLDEpLHI9ZnVuY3Rpb24oKXtmb3IodmFyIGU9MCx1PXQubGVuZ3RoLGk9QXJyYXkodSksbz0wO3U+bztvKyspaVtvXT10W29dPT09bT9hcmd1bWVudHNbZSsrXTp0W29dO2Zvcig7ZTxhcmd1bWVudHMubGVuZ3RoOylpLnB1c2goYXJndW1lbnRzW2UrK10pO3JldHVybiBFKG4scix0aGlzLHRoaXMsaSl9O3JldHVybiByfSxtLmJpbmRBbGw9ZnVuY3Rpb24obil7dmFyIHQscixlPWFyZ3VtZW50cy5sZW5ndGg7aWYoMT49ZSl0aHJvdyBuZXcgRXJyb3IoXCJiaW5kQWxsIG11c3QgYmUgcGFzc2VkIGZ1bmN0aW9uIG5hbWVzXCIpO2Zvcih0PTE7ZT50O3QrKylyPWFyZ3VtZW50c1t0XSxuW3JdPW0uYmluZChuW3JdLG4pO3JldHVybiBufSxtLm1lbW9pemU9ZnVuY3Rpb24obix0KXt2YXIgcj1mdW5jdGlvbihlKXt2YXIgdT1yLmNhY2hlLGk9XCJcIisodD90LmFwcGx5KHRoaXMsYXJndW1lbnRzKTplKTtyZXR1cm4gbS5oYXModSxpKXx8KHVbaV09bi5hcHBseSh0aGlzLGFyZ3VtZW50cykpLHVbaV19O3JldHVybiByLmNhY2hlPXt9LHJ9LG0uZGVsYXk9ZnVuY3Rpb24obix0KXt2YXIgcj1sLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7cmV0dXJuIG4uYXBwbHkobnVsbCxyKX0sdCl9LG0uZGVmZXI9bS5wYXJ0aWFsKG0uZGVsYXksbSwxKSxtLnRocm90dGxlPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGksbz1udWxsLGE9MDtyfHwocj17fSk7dmFyIGM9ZnVuY3Rpb24oKXthPXIubGVhZGluZz09PSExPzA6bS5ub3coKSxvPW51bGwsaT1uLmFwcGx5KGUsdSksb3x8KGU9dT1udWxsKX07cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGY9bS5ub3coKTthfHxyLmxlYWRpbmchPT0hMXx8KGE9Zik7dmFyIGw9dC0oZi1hKTtyZXR1cm4gZT10aGlzLHU9YXJndW1lbnRzLDA+PWx8fGw+dD8obyYmKGNsZWFyVGltZW91dChvKSxvPW51bGwpLGE9ZixpPW4uYXBwbHkoZSx1KSxvfHwoZT11PW51bGwpKTpvfHxyLnRyYWlsaW5nPT09ITF8fChvPXNldFRpbWVvdXQoYyxsKSksaX19LG0uZGVib3VuY2U9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaSxvLGEsYz1mdW5jdGlvbigpe3ZhciBmPW0ubm93KCktbzt0PmYmJmY+PTA/ZT1zZXRUaW1lb3V0KGMsdC1mKTooZT1udWxsLHJ8fChhPW4uYXBwbHkoaSx1KSxlfHwoaT11PW51bGwpKSl9O3JldHVybiBmdW5jdGlvbigpe2k9dGhpcyx1PWFyZ3VtZW50cyxvPW0ubm93KCk7dmFyIGY9ciYmIWU7cmV0dXJuIGV8fChlPXNldFRpbWVvdXQoYyx0KSksZiYmKGE9bi5hcHBseShpLHUpLGk9dT1udWxsKSxhfX0sbS53cmFwPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0ucGFydGlhbCh0LG4pfSxtLm5lZ2F0ZT1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4hbi5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fSxtLmNvbXBvc2U9ZnVuY3Rpb24oKXt2YXIgbj1hcmd1bWVudHMsdD1uLmxlbmd0aC0xO3JldHVybiBmdW5jdGlvbigpe2Zvcih2YXIgcj10LGU9blt0XS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7ci0tOyllPW5bcl0uY2FsbCh0aGlzLGUpO3JldHVybiBlfX0sbS5hZnRlcj1mdW5jdGlvbihuLHQpe3JldHVybiBmdW5jdGlvbigpe3JldHVybi0tbjwxP3QuYXBwbHkodGhpcyxhcmd1bWVudHMpOnZvaWQgMH19LG0uYmVmb3JlPWZ1bmN0aW9uKG4sdCl7dmFyIHI7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuLS1uPjAmJihyPXQuYXBwbHkodGhpcyxhcmd1bWVudHMpKSwxPj1uJiYodD1udWxsKSxyfX0sbS5vbmNlPW0ucGFydGlhbChtLmJlZm9yZSwyKTt2YXIgTT0he3RvU3RyaW5nOm51bGx9LnByb3BlcnR5SXNFbnVtZXJhYmxlKFwidG9TdHJpbmdcIiksST1bXCJ2YWx1ZU9mXCIsXCJpc1Byb3RvdHlwZU9mXCIsXCJ0b1N0cmluZ1wiLFwicHJvcGVydHlJc0VudW1lcmFibGVcIixcImhhc093blByb3BlcnR5XCIsXCJ0b0xvY2FsZVN0cmluZ1wiXTttLmtleXM9ZnVuY3Rpb24obil7aWYoIW0uaXNPYmplY3QobikpcmV0dXJuW107aWYodilyZXR1cm4gdihuKTt2YXIgdD1bXTtmb3IodmFyIHIgaW4gbiltLmhhcyhuLHIpJiZ0LnB1c2gocik7cmV0dXJuIE0mJmUobix0KSx0fSxtLmFsbEtleXM9ZnVuY3Rpb24obil7aWYoIW0uaXNPYmplY3QobikpcmV0dXJuW107dmFyIHQ9W107Zm9yKHZhciByIGluIG4pdC5wdXNoKHIpO3JldHVybiBNJiZlKG4sdCksdH0sbS52YWx1ZXM9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW0ua2V5cyhuKSxyPXQubGVuZ3RoLGU9QXJyYXkociksdT0wO3I+dTt1KyspZVt1XT1uW3RbdV1dO3JldHVybiBlfSxtLm1hcE9iamVjdD1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlLHU9bS5rZXlzKG4pLGk9dS5sZW5ndGgsbz17fSxhPTA7aT5hO2ErKyllPXVbYV0sb1tlXT10KG5bZV0sZSxuKTtyZXR1cm4gb30sbS5wYWlycz1mdW5jdGlvbihuKXtmb3IodmFyIHQ9bS5rZXlzKG4pLHI9dC5sZW5ndGgsZT1BcnJheShyKSx1PTA7cj51O3UrKyllW3VdPVt0W3VdLG5bdFt1XV1dO3JldHVybiBlfSxtLmludmVydD1mdW5jdGlvbihuKXtmb3IodmFyIHQ9e30scj1tLmtleXMobiksZT0wLHU9ci5sZW5ndGg7dT5lO2UrKyl0W25bcltlXV1dPXJbZV07cmV0dXJuIHR9LG0uZnVuY3Rpb25zPW0ubWV0aG9kcz1mdW5jdGlvbihuKXt2YXIgdD1bXTtmb3IodmFyIHIgaW4gbiltLmlzRnVuY3Rpb24obltyXSkmJnQucHVzaChyKTtyZXR1cm4gdC5zb3J0KCl9LG0uZXh0ZW5kPV8obS5hbGxLZXlzKSxtLmV4dGVuZE93bj1tLmFzc2lnbj1fKG0ua2V5cyksbS5maW5kS2V5PWZ1bmN0aW9uKG4sdCxyKXt0PXgodCxyKTtmb3IodmFyIGUsdT1tLmtleXMobiksaT0wLG89dS5sZW5ndGg7bz5pO2krKylpZihlPXVbaV0sdChuW2VdLGUsbikpcmV0dXJuIGV9LG0ucGljaz1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpPXt9LG89bjtpZihudWxsPT1vKXJldHVybiBpO20uaXNGdW5jdGlvbih0KT8odT1tLmFsbEtleXMobyksZT1iKHQscikpOih1PVMoYXJndW1lbnRzLCExLCExLDEpLGU9ZnVuY3Rpb24obix0LHIpe3JldHVybiB0IGluIHJ9LG89T2JqZWN0KG8pKTtmb3IodmFyIGE9MCxjPXUubGVuZ3RoO2M+YTthKyspe3ZhciBmPXVbYV0sbD1vW2ZdO2UobCxmLG8pJiYoaVtmXT1sKX1yZXR1cm4gaX0sbS5vbWl0PWZ1bmN0aW9uKG4sdCxyKXtpZihtLmlzRnVuY3Rpb24odCkpdD1tLm5lZ2F0ZSh0KTtlbHNle3ZhciBlPW0ubWFwKFMoYXJndW1lbnRzLCExLCExLDEpLFN0cmluZyk7dD1mdW5jdGlvbihuLHQpe3JldHVybiFtLmNvbnRhaW5zKGUsdCl9fXJldHVybiBtLnBpY2sobix0LHIpfSxtLmRlZmF1bHRzPV8obS5hbGxLZXlzLCEwKSxtLmNyZWF0ZT1mdW5jdGlvbihuLHQpe3ZhciByPWoobik7cmV0dXJuIHQmJm0uZXh0ZW5kT3duKHIsdCkscn0sbS5jbG9uZT1mdW5jdGlvbihuKXtyZXR1cm4gbS5pc09iamVjdChuKT9tLmlzQXJyYXkobik/bi5zbGljZSgpOm0uZXh0ZW5kKHt9LG4pOm59LG0udGFwPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIHQobiksbn0sbS5pc01hdGNoPWZ1bmN0aW9uKG4sdCl7dmFyIHI9bS5rZXlzKHQpLGU9ci5sZW5ndGg7aWYobnVsbD09bilyZXR1cm4hZTtmb3IodmFyIHU9T2JqZWN0KG4pLGk9MDtlPmk7aSsrKXt2YXIgbz1yW2ldO2lmKHRbb10hPT11W29dfHwhKG8gaW4gdSkpcmV0dXJuITF9cmV0dXJuITB9O3ZhciBOPWZ1bmN0aW9uKG4sdCxyLGUpe2lmKG49PT10KXJldHVybiAwIT09bnx8MS9uPT09MS90O2lmKG51bGw9PW58fG51bGw9PXQpcmV0dXJuIG49PT10O24gaW5zdGFuY2VvZiBtJiYobj1uLl93cmFwcGVkKSx0IGluc3RhbmNlb2YgbSYmKHQ9dC5fd3JhcHBlZCk7dmFyIHU9cy5jYWxsKG4pO2lmKHUhPT1zLmNhbGwodCkpcmV0dXJuITE7c3dpdGNoKHUpe2Nhc2VcIltvYmplY3QgUmVnRXhwXVwiOmNhc2VcIltvYmplY3QgU3RyaW5nXVwiOnJldHVyblwiXCIrbj09XCJcIit0O2Nhc2VcIltvYmplY3QgTnVtYmVyXVwiOnJldHVybituIT09K24/K3QhPT0rdDowPT09K24/MS8rbj09PTEvdDorbj09PSt0O2Nhc2VcIltvYmplY3QgRGF0ZV1cIjpjYXNlXCJbb2JqZWN0IEJvb2xlYW5dXCI6cmV0dXJuK249PT0rdH12YXIgaT1cIltvYmplY3QgQXJyYXldXCI9PT11O2lmKCFpKXtpZihcIm9iamVjdFwiIT10eXBlb2Ygbnx8XCJvYmplY3RcIiE9dHlwZW9mIHQpcmV0dXJuITE7dmFyIG89bi5jb25zdHJ1Y3RvcixhPXQuY29uc3RydWN0b3I7aWYobyE9PWEmJiEobS5pc0Z1bmN0aW9uKG8pJiZvIGluc3RhbmNlb2YgbyYmbS5pc0Z1bmN0aW9uKGEpJiZhIGluc3RhbmNlb2YgYSkmJlwiY29uc3RydWN0b3JcImluIG4mJlwiY29uc3RydWN0b3JcImluIHQpcmV0dXJuITF9cj1yfHxbXSxlPWV8fFtdO2Zvcih2YXIgYz1yLmxlbmd0aDtjLS07KWlmKHJbY109PT1uKXJldHVybiBlW2NdPT09dDtpZihyLnB1c2gobiksZS5wdXNoKHQpLGkpe2lmKGM9bi5sZW5ndGgsYyE9PXQubGVuZ3RoKXJldHVybiExO2Zvcig7Yy0tOylpZighTihuW2NdLHRbY10scixlKSlyZXR1cm4hMX1lbHNle3ZhciBmLGw9bS5rZXlzKG4pO2lmKGM9bC5sZW5ndGgsbS5rZXlzKHQpLmxlbmd0aCE9PWMpcmV0dXJuITE7Zm9yKDtjLS07KWlmKGY9bFtjXSwhbS5oYXModCxmKXx8IU4obltmXSx0W2ZdLHIsZSkpcmV0dXJuITF9cmV0dXJuIHIucG9wKCksZS5wb3AoKSwhMH07bS5pc0VxdWFsPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIE4obix0KX0sbS5pc0VtcHR5PWZ1bmN0aW9uKG4pe3JldHVybiBudWxsPT1uPyEwOmsobikmJihtLmlzQXJyYXkobil8fG0uaXNTdHJpbmcobil8fG0uaXNBcmd1bWVudHMobikpPzA9PT1uLmxlbmd0aDowPT09bS5rZXlzKG4pLmxlbmd0aH0sbS5pc0VsZW1lbnQ9ZnVuY3Rpb24obil7cmV0dXJuISghbnx8MSE9PW4ubm9kZVR5cGUpfSxtLmlzQXJyYXk9aHx8ZnVuY3Rpb24obil7cmV0dXJuXCJbb2JqZWN0IEFycmF5XVwiPT09cy5jYWxsKG4pfSxtLmlzT2JqZWN0PWZ1bmN0aW9uKG4pe3ZhciB0PXR5cGVvZiBuO3JldHVyblwiZnVuY3Rpb25cIj09PXR8fFwib2JqZWN0XCI9PT10JiYhIW59LG0uZWFjaChbXCJBcmd1bWVudHNcIixcIkZ1bmN0aW9uXCIsXCJTdHJpbmdcIixcIk51bWJlclwiLFwiRGF0ZVwiLFwiUmVnRXhwXCIsXCJFcnJvclwiXSxmdW5jdGlvbihuKXttW1wiaXNcIituXT1mdW5jdGlvbih0KXtyZXR1cm4gcy5jYWxsKHQpPT09XCJbb2JqZWN0IFwiK24rXCJdXCJ9fSksbS5pc0FyZ3VtZW50cyhhcmd1bWVudHMpfHwobS5pc0FyZ3VtZW50cz1mdW5jdGlvbihuKXtyZXR1cm4gbS5oYXMobixcImNhbGxlZVwiKX0pLFwiZnVuY3Rpb25cIiE9dHlwZW9mLy4vJiZcIm9iamVjdFwiIT10eXBlb2YgSW50OEFycmF5JiYobS5pc0Z1bmN0aW9uPWZ1bmN0aW9uKG4pe3JldHVyblwiZnVuY3Rpb25cIj09dHlwZW9mIG58fCExfSksbS5pc0Zpbml0ZT1mdW5jdGlvbihuKXtyZXR1cm4gaXNGaW5pdGUobikmJiFpc05hTihwYXJzZUZsb2F0KG4pKX0sbS5pc05hTj1mdW5jdGlvbihuKXtyZXR1cm4gbS5pc051bWJlcihuKSYmbiE9PStufSxtLmlzQm9vbGVhbj1mdW5jdGlvbihuKXtyZXR1cm4gbj09PSEwfHxuPT09ITF8fFwiW29iamVjdCBCb29sZWFuXVwiPT09cy5jYWxsKG4pfSxtLmlzTnVsbD1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09PW59LG0uaXNVbmRlZmluZWQ9ZnVuY3Rpb24obil7cmV0dXJuIG49PT12b2lkIDB9LG0uaGFzPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG51bGwhPW4mJnAuY2FsbChuLHQpfSxtLm5vQ29uZmxpY3Q9ZnVuY3Rpb24oKXtyZXR1cm4gdS5fPWksdGhpc30sbS5pZGVudGl0eT1mdW5jdGlvbihuKXtyZXR1cm4gbn0sbS5jb25zdGFudD1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4gbn19LG0ubm9vcD1mdW5jdGlvbigpe30sbS5wcm9wZXJ0eT13LG0ucHJvcGVydHlPZj1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj9mdW5jdGlvbigpe306ZnVuY3Rpb24odCl7cmV0dXJuIG5bdF19fSxtLm1hdGNoZXI9bS5tYXRjaGVzPWZ1bmN0aW9uKG4pe3JldHVybiBuPW0uZXh0ZW5kT3duKHt9LG4pLGZ1bmN0aW9uKHQpe3JldHVybiBtLmlzTWF0Y2godCxuKX19LG0udGltZXM9ZnVuY3Rpb24obix0LHIpe3ZhciBlPUFycmF5KE1hdGgubWF4KDAsbikpO3Q9Yih0LHIsMSk7Zm9yKHZhciB1PTA7bj51O3UrKyllW3VdPXQodSk7cmV0dXJuIGV9LG0ucmFuZG9tPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG51bGw9PXQmJih0PW4sbj0wKSxuK01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSoodC1uKzEpKX0sbS5ub3c9RGF0ZS5ub3d8fGZ1bmN0aW9uKCl7cmV0dXJuKG5ldyBEYXRlKS5nZXRUaW1lKCl9O3ZhciBCPXtcIiZcIjpcIiZhbXA7XCIsXCI8XCI6XCImbHQ7XCIsXCI+XCI6XCImZ3Q7XCIsJ1wiJzpcIiZxdW90O1wiLFwiJ1wiOlwiJiN4Mjc7XCIsXCJgXCI6XCImI3g2MDtcIn0sVD1tLmludmVydChCKSxSPWZ1bmN0aW9uKG4pe3ZhciB0PWZ1bmN0aW9uKHQpe3JldHVybiBuW3RdfSxyPVwiKD86XCIrbS5rZXlzKG4pLmpvaW4oXCJ8XCIpK1wiKVwiLGU9UmVnRXhwKHIpLHU9UmVnRXhwKHIsXCJnXCIpO3JldHVybiBmdW5jdGlvbihuKXtyZXR1cm4gbj1udWxsPT1uP1wiXCI6XCJcIituLGUudGVzdChuKT9uLnJlcGxhY2UodSx0KTpufX07bS5lc2NhcGU9UihCKSxtLnVuZXNjYXBlPVIoVCksbS5yZXN1bHQ9ZnVuY3Rpb24obix0LHIpe3ZhciBlPW51bGw9PW4/dm9pZCAwOm5bdF07cmV0dXJuIGU9PT12b2lkIDAmJihlPXIpLG0uaXNGdW5jdGlvbihlKT9lLmNhbGwobik6ZX07dmFyIHE9MDttLnVuaXF1ZUlkPWZ1bmN0aW9uKG4pe3ZhciB0PSsrcStcIlwiO3JldHVybiBuP24rdDp0fSxtLnRlbXBsYXRlU2V0dGluZ3M9e2V2YWx1YXRlOi88JShbXFxzXFxTXSs/KSU+L2csaW50ZXJwb2xhdGU6LzwlPShbXFxzXFxTXSs/KSU+L2csZXNjYXBlOi88JS0oW1xcc1xcU10rPyklPi9nfTt2YXIgSz0vKC4pXi8sej17XCInXCI6XCInXCIsXCJcXFxcXCI6XCJcXFxcXCIsXCJcXHJcIjpcInJcIixcIlxcblwiOlwiblwiLFwiXFx1MjAyOFwiOlwidTIwMjhcIixcIlxcdTIwMjlcIjpcInUyMDI5XCJ9LEQ9L1xcXFx8J3xcXHJ8XFxufFxcdTIwMjh8XFx1MjAyOS9nLEw9ZnVuY3Rpb24obil7cmV0dXJuXCJcXFxcXCIreltuXX07bS50ZW1wbGF0ZT1mdW5jdGlvbihuLHQscil7IXQmJnImJih0PXIpLHQ9bS5kZWZhdWx0cyh7fSx0LG0udGVtcGxhdGVTZXR0aW5ncyk7dmFyIGU9UmVnRXhwKFsodC5lc2NhcGV8fEspLnNvdXJjZSwodC5pbnRlcnBvbGF0ZXx8Sykuc291cmNlLCh0LmV2YWx1YXRlfHxLKS5zb3VyY2VdLmpvaW4oXCJ8XCIpK1wifCRcIixcImdcIiksdT0wLGk9XCJfX3ArPSdcIjtuLnJlcGxhY2UoZSxmdW5jdGlvbih0LHIsZSxvLGEpe3JldHVybiBpKz1uLnNsaWNlKHUsYSkucmVwbGFjZShELEwpLHU9YSt0Lmxlbmd0aCxyP2krPVwiJytcXG4oKF9fdD0oXCIrcitcIikpPT1udWxsPycnOl8uZXNjYXBlKF9fdCkpK1xcbidcIjplP2krPVwiJytcXG4oKF9fdD0oXCIrZStcIikpPT1udWxsPycnOl9fdCkrXFxuJ1wiOm8mJihpKz1cIic7XFxuXCIrbytcIlxcbl9fcCs9J1wiKSx0fSksaSs9XCInO1xcblwiLHQudmFyaWFibGV8fChpPVwid2l0aChvYmp8fHt9KXtcXG5cIitpK1wifVxcblwiKSxpPVwidmFyIF9fdCxfX3A9JycsX19qPUFycmF5LnByb3RvdHlwZS5qb2luLFwiK1wicHJpbnQ9ZnVuY3Rpb24oKXtfX3ArPV9fai5jYWxsKGFyZ3VtZW50cywnJyk7fTtcXG5cIitpK1wicmV0dXJuIF9fcDtcXG5cIjt0cnl7dmFyIG89bmV3IEZ1bmN0aW9uKHQudmFyaWFibGV8fFwib2JqXCIsXCJfXCIsaSl9Y2F0Y2goYSl7dGhyb3cgYS5zb3VyY2U9aSxhfXZhciBjPWZ1bmN0aW9uKG4pe3JldHVybiBvLmNhbGwodGhpcyxuLG0pfSxmPXQudmFyaWFibGV8fFwib2JqXCI7cmV0dXJuIGMuc291cmNlPVwiZnVuY3Rpb24oXCIrZitcIil7XFxuXCIraStcIn1cIixjfSxtLmNoYWluPWZ1bmN0aW9uKG4pe3ZhciB0PW0obik7cmV0dXJuIHQuX2NoYWluPSEwLHR9O3ZhciBQPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG4uX2NoYWluP20odCkuY2hhaW4oKTp0fTttLm1peGluPWZ1bmN0aW9uKG4pe20uZWFjaChtLmZ1bmN0aW9ucyhuKSxmdW5jdGlvbih0KXt2YXIgcj1tW3RdPW5bdF07bS5wcm90b3R5cGVbdF09ZnVuY3Rpb24oKXt2YXIgbj1bdGhpcy5fd3JhcHBlZF07cmV0dXJuIGYuYXBwbHkobixhcmd1bWVudHMpLFAodGhpcyxyLmFwcGx5KG0sbikpfX0pfSxtLm1peGluKG0pLG0uZWFjaChbXCJwb3BcIixcInB1c2hcIixcInJldmVyc2VcIixcInNoaWZ0XCIsXCJzb3J0XCIsXCJzcGxpY2VcIixcInVuc2hpZnRcIl0sZnVuY3Rpb24obil7dmFyIHQ9b1tuXTttLnByb3RvdHlwZVtuXT1mdW5jdGlvbigpe3ZhciByPXRoaXMuX3dyYXBwZWQ7cmV0dXJuIHQuYXBwbHkocixhcmd1bWVudHMpLFwic2hpZnRcIiE9PW4mJlwic3BsaWNlXCIhPT1ufHwwIT09ci5sZW5ndGh8fGRlbGV0ZSByWzBdLFAodGhpcyxyKX19KSxtLmVhY2goW1wiY29uY2F0XCIsXCJqb2luXCIsXCJzbGljZVwiXSxmdW5jdGlvbihuKXt2YXIgdD1vW25dO20ucHJvdG90eXBlW25dPWZ1bmN0aW9uKCl7cmV0dXJuIFAodGhpcyx0LmFwcGx5KHRoaXMuX3dyYXBwZWQsYXJndW1lbnRzKSl9fSksbS5wcm90b3R5cGUudmFsdWU9ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5fd3JhcHBlZH0sbS5wcm90b3R5cGUudmFsdWVPZj1tLnByb3RvdHlwZS50b0pTT049bS5wcm90b3R5cGUudmFsdWUsbS5wcm90b3R5cGUudG9TdHJpbmc9ZnVuY3Rpb24oKXtyZXR1cm5cIlwiK3RoaXMuX3dyYXBwZWR9LFwiZnVuY3Rpb25cIj09dHlwZW9mIGRlZmluZSYmZGVmaW5lLmFtZCYmZGVmaW5lKFwidW5kZXJzY29yZVwiLFtdLGZ1bmN0aW9uKCl7cmV0dXJuIG19KX0pLmNhbGwodGhpcyk7Il19
