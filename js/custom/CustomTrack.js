// =============================================================================
// = CustomTrack, an object representing a custom track as understood by UCSC. =
// =============================================================================
//
// This class *does* depend on global objects and therefore must be required as a 
// function that is executed on the global object.

module.exports = function(global) {

var _ = require('../underscore.min.js');

if (!_.sum) { _.sum = function(list){ return _.reduce(list, function(memo, num){ return memo + num; }, 0); }; }

var utils = require('./track-types/utils/utils.js'),
  strip = utils.strip;
  parseInt10 = utils.parseInt10;

function CustomTrack(opts, browserOpts) {
  if (!opts) { return; } // This is an empty customTrack that will be hydrated with values from a serialized object
  var typeWithArgs = (opts.type && strip(opts.type.toLowerCase()).split(/\s+/)) || ["bed"];
  opts.type = this._type = typeWithArgs[0];
  this._boundTypes = {};
  
  var type = this.type();
  if (type === null) { throw new Error("Unsupported track type '"+opts.type+"' encountered on line " + opts.lineNum); }
  
  this.opts = _.extend({}, this.constructor.defaults, type.defaults || {}, opts);
  this.opts.priority = parseInt10(this.opts.priority);
  _.extend(this, {
    browserOpts: browserOpts,
    typeArgs: typeWithArgs.slice(1),
    stretchHeight: false,
    heights: {min: 15},
    sizes: ['dense'],
    mapSizes: [],
    areas: {},
    scales: {},
    noAreaLabels: false,
    expectsSequence: false,
    isSearchable: false,
    finishSetupCalled: false,
    onSyncProps: null
  });
  this.init();
}

CustomTrack.defaults = {
  name: 'User Track',
  description: '',
  color: '0,0,0',
  priority: 1,
  font: "11px SystemWebFont,Roboto,'Segoe UI','Lucida Grande',Helvetica,Arial,sans-serif"
  //FIXME: using system fonts ('-apple-system', BlinkMacSystemFont) for MacOS crashes in OffscreenCanvas on Chrome?
  //font: "11px '-apple-system',BlinkMacSystemFont,'Segoe UI','Lucida Grande',Helvetica,Arial,sans-serif"
};

CustomTrack.OFFSCREEN_CANVAS_METHODS = ['render', 'renderSequence', 'renderAreaLabels'];
CustomTrack.WORKER_METHODS = ['prerender', 'search', 'applyOpts', 'finishSetup']
CustomTrack.WORKER_METHODS = CustomTrack.WORKER_METHODS.concat(CustomTrack.OFFSCREEN_CANVAS_METHODS);
CustomTrack.BRANCH_BY_TYPE_METHODS = ['init', 'parse', 'prerender', 'search'];
CustomTrack.BRANCH_BY_TYPE_METHODS = CustomTrack.BRANCH_BY_TYPE_METHODS.concat(CustomTrack.OFFSCREEN_CANVAS_METHODS);

CustomTrack.types = {
  ruler: require('./track-types/ruler.js'),
  bed: require('./track-types/bed.js'),
  featuretable: require('./track-types/featuretable.js'),
  bedgraph: require('./track-types/bedgraph.js'),
  wiggle_0: require('./track-types/wiggle_0.js'),
  vcftabix: require('./track-types/vcftabix.js'),
  bedgz: require('./track-types/bedgz.js'),
  bigbed: require('./track-types/bigbed.js'),
  bam: require('./track-types/bam.js'),
  bigwig: require('./track-types/bigwig.js'),
  biggenepred: require('./track-types/biggenepred.js'),
  bigpsl: require('./track-types/bigpsl.js'),
  bigchain: require('./track-types/bigchain.js')
};

// ==========================================================================
// = bedDetail format: https://genome.ucsc.edu/FAQ/FAQformat.html#format1.7 =
// ==========================================================================  

CustomTrack.types.beddetail = _.clone(CustomTrack.types.bed);
CustomTrack.types.beddetail.defaults = _.extend({}, CustomTrack.types.beddetail.defaults, {detail: true});

// Returns a shallow clone of the suite of functions for this track's `type`, if none is given
// If a specific type is given, that suite is returned instead
// All functions therein are returned pre-bound to execute with `this` as the CustomTrack instance
// This allows track types to act like mixins, and they can call each other's functions seamlessly
// Track types can call `this.type()` to allow subclasses to selectively override their method calls
CustomTrack.prototype.type = function(type) {
  var self = this;
  if (_.isUndefined(type)) { type = self._type; }
  if (!self._boundTypes[type]) {
    self._boundTypes[type] = _.mapObject(self.constructor.types[type], function(val) { 
      return _.isFunction(val) ? _.bind(val, self) : val; 
    });
  }
  return self._boundTypes[type] || null;
};

// These functions branch into methods defined via the .type() of the track
_.each(CustomTrack.BRANCH_BY_TYPE_METHODS, function(fn) {
  CustomTrack.prototype[fn] = function() {
    var args = _.toArray(arguments),
      boundType = this.type();
    if (!boundType[fn]) { return false; }
    return boundType[fn].apply(this, args);
  }
});

// finishSetup does likewise, but we also add a guard so that it can only be called ONCE, ever, on a track
CustomTrack.prototype.finishSetup = function() {
  var args = _.toArray(arguments),
    boundType = this.type();
  if (!boundType.finishSetup || this.finishSetupCalled) { return false; }
  this.finishSetupCalled = true;
  return boundType.finishSetup.apply(this, args);
}

// Loads CustomTrack options into the track options dialog UI when it is opened
CustomTrack.prototype.loadOpts = function($dialog, genomeSuppliedTrack) {
  var boundType = this.type(),
    o = this.opts,
    description = o.description || ((genomeSuppliedTrack ? 'Genome Annotation ' : 'User Supplied') + ' Track');
  $dialog.find('.custom-opts-form').hide();
  $dialog.find('.custom-opts-form.'+this._type).show();
  $dialog.find('.custom-name').text(o.name);
  $dialog.find('.custom-desc').text(description);
  $dialog.find('.custom-format').text(this._type);
  $dialog.find('[name=color]').val(o.color).change();
  if (boundType.loadOpts) { boundType.loadOpts($dialog); }
  $dialog.find('.enabler').change();
};

// Saves options changed in the track options dialog UI back to the CustomTrack object
CustomTrack.prototype.saveOpts = function($dialog) {
  var boundType = this.type(),
    o = this.opts;
  o.color = $dialog.find('[name=color]').val();
  if (!this.validateColor(o.color)) { o.color = '0,0,0'; }
  if (boundType.saveOpts) { boundType.saveOpts($dialog); }
  this.applyOpts();
  global.CustomTracks.worker() && this.applyOptsAsync(); // Apply the changes to the worker too!
};

// Sometimes newly set options (provided as the first arg) need to be transformed before use or have side effects.
// This function is run for newly set options in both the DOM and Web Worker scopes (see applyOptsAsync below).
CustomTrack.prototype.applyOpts = function(opts) {
  var boundType = this.type();
  if (opts) { this.opts = opts; }
  if (boundType.applyOpts) { boundType.applyOpts(); }
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

CustomTrack.prototype.erase = function(canvas, callback) {
  var self = this,
    ctx = canvas.getContext && canvas.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
  if (_.isFunction(callback)) { callback({canvas: canvas}); }
}

CustomTrack.prototype.warn = function(warning) {
  if (this.opts.strict) {
    throw new Error(warning);
  } else {
    if (!this.warnings) { this.warnings = []; }
    this.warnings.push(warning);
  }
};

CustomTrack.prototype.isOn = function(val) {
  return /^(on|yes|true|t|y|1)$/i.test(_.isUndefined(val) ? '' : val.toString());
};

CustomTrack.prototype.chrList = function() {
  if (!this._chrList) {
    var unsortedChrList = _.map(this.browserOpts.chrPos, function(pos, chr) { return [pos, chr]; });
    this._chrList = _.sortBy(unsortedChrList, function(v) { return v[0]; });
  }
  return this._chrList;
}

// Converts 1-based genomic coordinate position into a contig name + 1-based position.
// IMPORTANT: providing ANYTHING besides 1-based genomic coordinates will produce incorrect results!
CustomTrack.prototype.chrAt = function(pos) {
  var chrList = this.chrList(),
    chrIndex = _.sortedIndex(chrList, [pos], function(v) { return v[0]; }),
    chr = chrIndex > 0 ? chrList[chrIndex - 1][1] : null;
  return {i: chrIndex - 1, c: chr, p: pos - this.browserOpts.chrPos[chr]};
};

// Converts a RIGHT-OPEN interval specified in 1-based genomic coordinates into an array of chr:start-end ranges.
// These are the default interval coordinates for CustomTracks, given to .render(canvas, start, end, ...) calls.
// IMPORTANT: By default, the output is in ONE-based coordinates with right CLOSED intervals.
//    - These coordinates are what samtools and related programs expect.
// To get ZERO-based and right-OPEN intervals instead, set the last argument to true.
//    - These coordinates are what bigBed and bigWig tools expect.
CustomTrack.prototype.chrRange = function(start, end, outputZeroBasedRightOpen) {
  if (start >= end - 1) { throw "Invalid interval provided to chrRange (expecting 1-based, right-OPEN)"; }
  var chrLengths = this.browserOpts.chrLengths,
    startChr = this.chrAt(start),
    endChr = this.chrAt(end - 1), // because we expect RIGHT-OPEN intervals.
    adjStart = outputZeroBasedRightOpen ? 1 : 0,
    range;
  if (startChr.c && startChr.i === endChr.i) { 
    return [startChr.c + ':' + (startChr.p - adjStart) + '-' + endChr.p]; 
  } else {
    range = _.map(this.chrList().slice(startChr.i + 1, endChr.i), function(v) {
      return v[1] + ':' + (1 - adjStart) + '-' + chrLengths[v[1]];
    });
    startChr.c && range.unshift(startChr.c + ':' + (startChr.p - adjStart) + '-' + chrLengths[startChr.c]);
    endChr.c && range.push(endChr.c + ':' + (1 - adjStart) + '-' + endChr.p);
    return range;
  }
}

// ===============================================================================
// = Setup asynchronous versions of above functions that forward to a Web Worker =
// ===============================================================================

_.each(CustomTrack.WORKER_METHODS, function(fn) {
  var fnAsync = fn + 'Async',
    asyncMethod;
    
  // These functions require special handling because a <canvas> may need to be converted to OffscreenCanvas
  if (_.contains(CustomTrack.OFFSCREEN_CANVAS_METHODS, fn)) {
    asyncMethod = function() {
      var self = this,
        args = _.toArray(arguments),
        canvas = _.first(args),
        transferables = [],
        renderKey = canvas.rendering,
        offscreen;

      // Converts the first argument, a <canvas>, into a wrapped OffscreenCanvas that the web worker can draw onto.
      // If .transferControlToOffscreen() fails, we've already transferred control before, and the web worker can find 
      //    the right OffscreenCanvas using the `canvas.id`.
      try { offscreen = canvas.transferControlToOffscreen(); transferables.push(offscreen); }
      catch (DOMException) { offscreen = true; }
      // offscreen = true;
      args[0] = {
        offscreen: offscreen,
        id: canvas.id,
        // width: canvas.width,
        // height: canvas.height,
        rendering: canvas.rendering,
        _ratio: canvas.calculateRatio()
      };
    
      // We also do some work in a callback wrapper to restore properties of the <canvas> that were changed by the worker.
      // We update the `className` of our <canvas> to reflect anything the worker changed.
      // We set shadow props `this._height` and `this._width` on the <canvas> to track the dimensions of the new 
      //     OffscreenCanvas -- see how this affects `.unscaledHeight()` et al. in `jquery.retina-canvas.js`
      // We also add areas that were generated by the worker to the CustomTrack on this side of the fence.
      global.CustomTracks.async(self, fn, args, [self.id], function wrapper(renderResult) {
        canvas.flags = renderResult.canvas.flags;
        canvas.lastRendered = renderResult.canvas.lastRendered;
        canvas._height = renderResult.canvas.height;
        canvas._width = renderResult.canvas.width;
        if (renderResult.areas) { self.areas[canvas.id] = renderResult.areas; }
        return {canvas: canvas, areas: renderResult.areas};
      }, transferables);  // The OffscreenCanvas is supplied in `transferables` to transfer ownership to the web worker.
    }
  } else if (fn == 'applyOpts') {
    asyncMethod = function() { global.CustomTracks.async(this, fn, [this.opts, function(){}], [this.id]); }
  } else {
    asyncMethod = function() { global.CustomTracks.async(this, fn, arguments, [this.id]); }
  }

  CustomTrack.prototype[fnAsync] = asyncMethod;
});


CustomTrack.prototype.ajaxDir = function() {
  // Web Workers fetch URLs relative to the JS file itself.
  return (global.HTMLDocument ? '' : '../') + this.browserOpts.ajaxDir;
};

// ======================================
// = Utility functions related to color =
// ======================================

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

CustomTrack.prototype.contrastColor = function(color) {
  var m = color.match(/(\d+),(\d+),(\d+)/);
  if (!m) { return 'white'; }
  m.shift();
  return _.sum(_.map(m, parseInt10)) / 3.0 > 127 ? 'black' : 'white';
}

return CustomTrack;

};