// =============================================================================
// = CustomTrack, an object representing a custom track as understood by UCSC. =
// =============================================================================
//
// This class *does* depend on global objects and therefore must be required as a 
// function that is executed on the global object.

module.exports = function(global) {

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