(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
},{"../underscore.min.js":19,"./track-types/bam.js":5,"./track-types/bed.js":6,"./track-types/bedgraph.js":7,"./track-types/bigbed.js":8,"./track-types/bigwig.js":9,"./track-types/featuretable.js":10,"./track-types/utils/utils.js":16,"./track-types/vcftabix.js":17,"./track-types/wiggle_0.js":18}],2:[function(require,module,exports){
var global = self;  // grab global scole for Web Workers
require('./jquery.nodom.min.js')(global);
global._ = require('../underscore.min.js');
require('./CustomTracks.js')(global);

if (!global.console || !global.console.log) {
  global.console = global.console || {};
  global.console.log = function() {
    global.postMessage({log: JSON.stringify(_.toArray(arguments))});
  };
}

var CustomTrackWorker = {
  _tracks: [],
  _throwErrors: false,
  parse: function(text, browserOpts) {
    var self = this,
      tracks = CustomTracks.parse(text, browserOpts);
    return _.map(tracks, function(t) {
      // we want to keep the track object in our private store, and delete the data from the copy that
      // is sent back over the fence, since it is expensive/impossible to serialize
      t.id = self._tracks.push(t) - 1;
      var serializable = _.extend({}, t);
      delete serializable.data;
      return serializable;
    });
  },
  prerender: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.prerender.apply(track, _.rest(args));
  },
  applyOpts: function() {
    args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.applyOpts.apply(track, _.rest(args));
  },
  throwErrors: function(toggle) {
    this._throwErrors = toggle;
  }
};

global.addEventListener('message', function(e) {
  var data = e.data,
    callback = function(r) { global.postMessage({id: data.id, ret: JSON.stringify(r || null)}); },
    ret;

  if (CustomTrackWorker._throwErrors || true) {
    ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback));
  } else {
    try { ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback)); } 
    catch (err) { global.postMessage({id: data.id, error: JSON.stringify({message: err.message})}); }
  }
  
  if (!_.isUndefined(ret)) { callback(ret); }
});
},{"../underscore.min.js":19,"./CustomTracks.js":3,"./jquery.nodom.min.js":4}],3:[function(require,module,exports){
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
},{"../underscore.min.js":19,"./CustomTrack.js":1,"./track-types/utils/utils.js":16}],4:[function(require,module,exports){
module.exports = function(global){global.window=global.window||global;global.window.document=global.window.document||{};(function(a,b){function N(){try{return new a.ActiveXObject("Microsoft.XMLHTTP")}catch(b){}}function M(){try{return new a.XMLHttpRequest}catch(b){}}function I(a,c){if(a.dataFilter){c=a.dataFilter(c,a.dataType)}var d=a.dataTypes,e={},g,h,i=d.length,j,k=d[0],l,m,n,o,p;for(g=1;g<i;g++){if(g===1){for(h in a.converters){if(typeof h==="string"){e[h.toLowerCase()]=a.converters[h]}}}l=k;k=d[g];if(k==="*"){k=l}else if(l!=="*"&&l!==k){m=l+" "+k;n=e[m]||e["* "+k];if(!n){p=b;for(o in e){j=o.split(" ");if(j[0]===l||j[0]==="*"){p=e[j[1]+" "+k];if(p){o=e[o];if(o===true){n=p}else if(p===true){n=o}break}}}}if(!(n||p)){f.error("No conversion from "+m.replace(" "," to "))}if(n!==true){c=n?n(c):p(o(c))}}}return c}function H(a,c,d){var e=a.contents,f=a.dataTypes,g=a.responseFields,h,i,j,k;for(i in g){if(i in d){c[g[i]]=d[i]}}while(f[0]==="*"){f.shift();if(h===b){h=a.mimeType||c.getResponseHeader("content-type")}}if(h){for(i in e){if(e[i]&&e[i].test(h)){f.unshift(i);break}}}if(f[0]in d){j=f[0]}else{for(i in d){if(!f[0]||a.converters[i+" "+f[0]]){j=i;break}if(!k){k=i}}j=j||k}if(j){if(j!==f[0]){f.unshift(j)}return d[j]}}function G(a,b,c,d){if(f.isArray(b)){f.each(b,function(b,e){if(c||j.test(a)){d(a,e)}else{G(a+"["+(typeof e==="object"||f.isArray(e)?b:"")+"]",e,c,d)}})}else if(!c&&b!=null&&typeof b==="object"){for(var e in b){G(a+"["+e+"]",b[e],c,d)}}else{d(a,b)}}function F(a,c){var d,e,g=f.ajaxSettings.flatOptions||{};for(d in c){if(c[d]!==b){(g[d]?a:e||(e={}))[d]=c[d]}}if(e){f.extend(true,a,e)}}function E(a,c,d,e,f,g){f=f||c.dataTypes[0];g=g||{};g[f]=true;var h=a[f],i=0,j=h?h.length:0,k=a===y,l;for(;i<j&&(k||!l);i++){l=h[i](c,d,e);if(typeof l==="string"){if(!k||g[l]){l=b}else{c.dataTypes.unshift(l);l=E(a,c,d,e,l,g)}}}if((k||!l)&&!g["*"]){l=E(a,c,d,e,"*",g)}return l}function D(a){return function(b,c){if(typeof b!=="string"){c=b;b="*"}if(f.isFunction(c)){var d=b.toLowerCase().split(u),e=0,g=d.length,h,i,j;for(;e<g;e++){h=d[e];j=/^\+/.test(h);if(j){h=h.substr(1)||"*"}i=a[h]=a[h]||[];i[j?"unshift":"push"](c)}}}}var c=a.document,d=a.navigator,e=a.location;var f=function(){function J(){if(e.isReady){return}try{c.documentElement.doScroll("left")}catch(a){setTimeout(J,1);return}e.ready()}var e=function(a,b){return new e.fn.init(a,b,h)},f=a.jQuery,g=a.$,h,i=/^(?:[^<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,j=/\S/,k=/^\s+/,l=/\s+$/,m=/\d/,n=/^<(\w+)\s*\/?>(?:<\/\1>)?$/,o=/^[\],:{}\s]*$/,p=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,q=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,r=/(?:^|:|,)(?:\s*\[)+/g,s=/(webkit)[ \/]([\w.]+)/,t=/(opera)(?:.*version)?[ \/]([\w.]+)/,u=/(msie) ([\w.]+)/,v=/(mozilla)(?:.*? rv:([\w.]+))?/,w=/-([a-z])/ig,x=function(a,b){return b.toUpperCase()},y=d.userAgent,z,A,B,C=Object.prototype.toString,D=Object.prototype.hasOwnProperty,E=Array.prototype.push,F=Array.prototype.slice,G=String.prototype.trim,H=Array.prototype.indexOf,I={};e.fn=e.prototype={constructor:e,init:function(a,d,f){var g,h,j,k;if(!a){return this}if(a.nodeType){this.context=this[0]=a;this.length=1;return this}if(a==="body"&&!d&&c.body){this.context=c;this[0]=c.body;this.selector=a;this.length=1;return this}if(typeof a==="string"){if(a.charAt(0)==="<"&&a.charAt(a.length-1)===">"&&a.length>=3){g=[null,a,null]}else{g=i.exec(a)}if(g&&(g[1]||!d)){if(g[1]){d=d instanceof e?d[0]:d;k=d?d.ownerDocument||d:c;j=n.exec(a);if(j){if(e.isPlainObject(d)){a=[c.createElement(j[1])];e.fn.attr.call(a,d,true)}else{a=[k.createElement(j[1])]}}else{j=e.buildFragment([g[1]],[k]);a=(j.cacheable?e.clone(j.fragment):j.fragment).childNodes}return e.merge(this,a)}else{h=c.getElementById(g[2]);if(h&&h.parentNode){if(h.id!==g[2]){return f.find(a)}this.length=1;this[0]=h}this.context=c;this.selector=a;return this}}else if(!d||d.jquery){return(d||f).find(a)}else{return this.constructor(d).find(a)}}else if(e.isFunction(a)){return f.ready(a)}if(a.selector!==b){this.selector=a.selector;this.context=a.context}return e.makeArray(a,this)},selector:"",jquery:"1.6.3pre",length:0,size:function(){return this.length},toArray:function(){return F.call(this,0)},get:function(a){return a==null?this.toArray():a<0?this[this.length+a]:this[a]},pushStack:function(a,b,c){var d=this.constructor();if(e.isArray(a)){E.apply(d,a)}else{e.merge(d,a)}d.prevObject=this;d.context=this.context;if(b==="find"){d.selector=this.selector+(this.selector?" ":"")+c}else if(b){d.selector=this.selector+"."+b+"("+c+")"}return d},each:function(a,b){return e.each(this,a,b)},ready:function(a){e.bindReady();A.done(a);return this},eq:function(a){return a===-1?this.slice(a):this.slice(a,+a+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack(F.apply(this,arguments),"slice",F.call(arguments).join(","))},map:function(a){return this.pushStack(e.map(this,function(b,c){return a.call(b,c,b)}))},end:function(){return this.prevObject||this.constructor(null)},push:E,sort:[].sort,splice:[].splice};e.fn.init.prototype=e.fn;e.extend=e.fn.extend=function(){var a,c,d,f,g,h,i=arguments[0]||{},j=1,k=arguments.length,l=false;if(typeof i==="boolean"){l=i;i=arguments[1]||{};j=2}if(typeof i!=="object"&&!e.isFunction(i)){i={}}if(k===j){i=this;--j}for(;j<k;j++){if((a=arguments[j])!=null){for(c in a){d=i[c];f=a[c];if(i===f){continue}if(l&&f&&(e.isPlainObject(f)||(g=e.isArray(f)))){if(g){g=false;h=d&&e.isArray(d)?d:[]}else{h=d&&e.isPlainObject(d)?d:{}}i[c]=e.extend(l,h,f)}else if(f!==b){i[c]=f}}}}return i};e.extend({noConflict:function(b){if(a.$===e){a.$=g}if(b&&a.jQuery===e){a.jQuery=f}return e},isReady:false,readyWait:1,holdReady:function(a){if(a){e.readyWait++}else{e.ready(true)}},ready:function(a){if(a===true&&!--e.readyWait||a!==true&&!e.isReady){if(!c.body){return setTimeout(e.ready,1)}e.isReady=true;if(a!==true&&--e.readyWait>0){return}A.resolveWith(c,[e]);if(e.fn.trigger){e(c).trigger("ready").unbind("ready")}}},bindReady:function(){if(A){return}A=e._Deferred();if(c.readyState==="complete"){return setTimeout(e.ready,1)}if(c.addEventListener){c.addEventListener("DOMContentLoaded",B,false);a.addEventListener("load",e.ready,false)}else if(c.attachEvent){c.attachEvent("onreadystatechange",B);a.attachEvent("onload",e.ready);var b=false;try{b=a.frameElement==null}catch(d){}if(c.documentElement.doScroll&&b){J()}}},isFunction:function(a){return e.type(a)==="function"},isArray:Array.isArray||function(a){return e.type(a)==="array"},isWindow:function(a){return a&&typeof a==="object"&&"setInterval"in a},isNaN:function(a){return a==null||!m.test(a)||isNaN(a)},type:function(a){return a==null?String(a):I[C.call(a)]||"object"},isPlainObject:function(a){if(!a||e.type(a)!=="object"||a.nodeType||e.isWindow(a)){return false}if(a.constructor&&!D.call(a,"constructor")&&!D.call(a.constructor.prototype,"isPrototypeOf")){return false}var c;for(c in a){}return c===b||D.call(a,c)},isEmptyObject:function(a){for(var b in a){return false}return true},error:function(a){throw a},parseJSON:function(b){if(typeof b!=="string"||!b){return null}b=e.trim(b);if(a.JSON&&a.JSON.parse){return a.JSON.parse(b)}if(o.test(b.replace(p,"@").replace(q,"]").replace(r,""))){return(new Function("return "+b))()}e.error("Invalid JSON: "+b)},parseXML:function(c){var d,f;try{if(a.DOMParser){f=new DOMParser;d=f.parseFromString(c,"text/xml")}else{d=new ActiveXObject("Microsoft.XMLDOM");d.async="false";d.loadXML(c)}}catch(g){d=b}if(!d||!d.documentElement||d.getElementsByTagName("parsererror").length){e.error("Invalid XML: "+c)}return d},noop:function(){},globalEval:function(b){if(b&&j.test(b)){(a.execScript||function(b){a["eval"].call(a,b)})(b)}},camelCase:function(a){return a.replace(w,x)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toUpperCase()===b.toUpperCase()},each:function(a,c,d){var f,g=0,h=a.length,i=h===b||e.isFunction(a);if(d){if(i){for(f in a){if(c.apply(a[f],d)===false){break}}}else{for(;g<h;){if(c.apply(a[g++],d)===false){break}}}}else{if(i){for(f in a){if(c.call(a[f],f,a[f])===false){break}}}else{for(;g<h;){if(c.call(a[g],g,a[g++])===false){break}}}}return a},trim:G?function(a){return a==null?"":G.call(a)}:function(a){return a==null?"":a.toString().replace(k,"").replace(l,"")},makeArray:function(a,b){var c=b||[];if(a!=null){var d=e.type(a);if(a.length==null||d==="string"||d==="function"||d==="regexp"||e.isWindow(a)){E.call(c,a)}else{e.merge(c,a)}}return c},inArray:function(a,b){if(H){return H.call(b,a)}for(var c=0,d=b.length;c<d;c++){if(b[c]===a){return c}}return-1},merge:function(a,c){var d=a.length,e=0;if(typeof c.length==="number"){for(var f=c.length;e<f;e++){a[d++]=c[e]}}else{while(c[e]!==b){a[d++]=c[e++]}}a.length=d;return a},grep:function(a,b,c){var d=[],e;c=!!c;for(var f=0,g=a.length;f<g;f++){e=!!b(a[f],f);if(c!==e){d.push(a[f])}}return d},map:function(a,c,d){var f,g,h=[],i=0,j=a.length,k=a instanceof e||j!==b&&typeof j==="number"&&(j>0&&a[0]&&a[j-1]||j===0||e.isArray(a));if(k){for(;i<j;i++){f=c(a[i],i,d);if(f!=null){h[h.length]=f}}}else{for(g in a){f=c(a[g],g,d);if(f!=null){h[h.length]=f}}}return h.concat.apply([],h)},guid:1,proxy:function(a,c){if(typeof c==="string"){var d=a[c];c=a;a=d}if(!e.isFunction(a)){return b}var f=F.call(arguments,2),g=function(){return a.apply(c,f.concat(F.call(arguments)))};g.guid=a.guid=a.guid||g.guid||e.guid++;return g},access:function(a,c,d,f,g,h){var i=a.length;if(typeof c==="object"){for(var j in c){e.access(a,j,c[j],f,g,d)}return a}if(d!==b){f=!h&&f&&e.isFunction(d);for(var k=0;k<i;k++){g(a[k],c,f?d.call(a[k],k,g(a[k],c)):d,h)}return a}return i?g(a[0],c):b},now:function(){return(new Date).getTime()},uaMatch:function(a){a=a.toLowerCase();var b=s.exec(a)||t.exec(a)||u.exec(a)||a.indexOf("compatible")<0&&v.exec(a)||[];return{browser:b[1]||"",version:b[2]||"0"}},sub:function(){function a(b,c){return new a.fn.init(b,c)}e.extend(true,a,this);a.superclass=this;a.fn=a.prototype=this();a.fn.constructor=a;a.sub=this.sub;a.fn.init=function d(c,d){if(d&&d instanceof e&&!(d instanceof a)){d=a(d)}return e.fn.init.call(this,c,d,b)};a.fn.init.prototype=a.fn;var b=a(c);return a},browser:{}});e.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(a,b){I["[object "+b+"]"]=b.toLowerCase()});z=e.uaMatch(y);if(z.browser){e.browser[z.browser]=true;e.browser.version=z.version}if(e.browser.webkit){e.browser.safari=true}if(j.test(" ")){k=/^[\s\xA0]+/;l=/[\s\xA0]+$/}h=e(c);if(c.addEventListener){B=function(){c.removeEventListener("DOMContentLoaded",B,false);e.ready()}}else if(c.attachEvent){B=function(){if(c.readyState==="complete"){c.detachEvent("onreadystatechange",B);e.ready()}}}return e}();var g="done fail isResolved isRejected promise then always pipe".split(" "),h=[].slice;f.extend({_Deferred:function(){var a=[],b,c,d,e={done:function(){if(!d){var c=arguments,g,h,i,j,k;if(b){k=b;b=0}for(g=0,h=c.length;g<h;g++){i=c[g];j=f.type(i);if(j==="array"){e.done.apply(e,i)}else if(j==="function"){a.push(i)}}if(k){e.resolveWith(k[0],k[1])}}return this},resolveWith:function(e,f){if(!d&&!b&&!c){f=f||[];c=1;try{while(a[0]){a.shift().apply(e,f)}}finally{b=[e,f];c=0}}return this},resolve:function(){e.resolveWith(this,arguments);return this},isResolved:function(){return!!(c||b)},cancel:function(){d=1;a=[];return this}};return e},Deferred:function(a){var b=f._Deferred(),c=f._Deferred(),d;f.extend(b,{then:function(a,c){b.done(a).fail(c);return this},always:function(){return b.done.apply(b,arguments).fail.apply(this,arguments)},fail:c.done,rejectWith:c.resolveWith,reject:c.resolve,isRejected:c.isResolved,pipe:function(a,c){return f.Deferred(function(d){f.each({done:[a,"resolve"],fail:[c,"reject"]},function(a,c){var e=c[0],g=c[1],h;if(f.isFunction(e)){b[a](function(){h=e.apply(this,arguments);if(h&&f.isFunction(h.promise)){h.promise().then(d.resolve,d.reject)}else{d[g+"With"](this===b?d:this,[h])}})}else{b[a](d[g])}})}).promise()},promise:function(a){if(a==null){if(d){return d}d=a={}}var c=g.length;while(c--){a[g[c]]=b[g[c]]}return a}});b.done(c.cancel).fail(b.cancel);delete b.cancel;if(a){a.call(b,b)}return b},when:function(a){function i(a){return function(c){b[a]=arguments.length>1?h.call(arguments,0):c;if(!--e){g.resolveWith(g,h.call(b,0))}}}var b=arguments,c=0,d=b.length,e=d,g=d<=1&&a&&f.isFunction(a.promise)?a:f.Deferred();if(d>1){for(;c<d;c++){if(b[c]&&f.isFunction(b[c].promise)){b[c].promise().then(i(c),g.reject)}else{--e}}if(!e){g.resolveWith(g,b)}}else if(g!==a){g.resolveWith(g,d?[a]:[])}return g.promise()}});f.support=f.support||{};var i=/%20/g,j=/\[\]$/,k=/\r?\n/g,l=/#.*$/,m=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,n=/^(?:color|date|datetime|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,o=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,p=/^(?:GET|HEAD)$/,q=/^\/\//,r=/\?/,s=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,t=/^(?:select|textarea)/i,u=/\s+/,v=/([?&])_=[^&]*/,w=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/,x=f.fn.load,y={},z={},A,B;try{A=e.href}catch(C){A=c.createElement("a");A.href="";A=A.href}B=w.exec(A.toLowerCase())||[];f.fn.extend({load:function(a,c,d){if(typeof a!=="string"&&x){return x.apply(this,arguments)}else if(!this.length){return this}var e=a.indexOf(" ");if(e>=0){var g=a.slice(e,a.length);a=a.slice(0,e)}var h="GET";if(c){if(f.isFunction(c)){d=c;c=b}else if(typeof c==="object"){c=f.param(c,f.ajaxSettings.traditional);h="POST"}}var i=this;f.ajax({url:a,type:h,dataType:"html",data:c,complete:function(a,b,c){c=a.responseText;if(a.isResolved()){a.done(function(a){c=a});i.html(g?f("<div>").append(c.replace(s,"")).find(g):c)}if(d){i.each(d,[c,b,a])}}});return this},serialize:function(){return f.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?f.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||t.test(this.nodeName)||n.test(this.type))}).map(function(a,b){var c=f(this).val();return c==null?null:f.isArray(c)?f.map(c,function(a,c){return{name:b.name,value:a.replace(k,"\r\n")}}):{name:b.name,value:c.replace(k,"\r\n")}}).get()}});f.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(a,b){f.fn[b]=function(a){return this.bind(b,a)}});f.each(["get","post"],function(a,c){f[c]=function(a,d,e,g){if(f.isFunction(d)){g=g||e;e=d;d=b}return f.ajax({type:c,url:a,data:d,success:e,dataType:g})}});f.extend({getScript:function(a,c){return f.get(a,b,c,"script")},getJSON:function(a,b,c){return f.get(a,b,c,"json")},ajaxSetup:function(a,b){if(b){F(a,f.ajaxSettings)}else{b=a;a=f.ajaxSettings}F(a,b);return a},ajaxSettings:{url:A,isLocal:o.test(B[1]),global:true,type:"GET",contentType:"application/x-www-form-urlencoded",processData:true,async:true,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":"*/*"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":a.String,"text html":true,"text json":f.parseJSON,"text xml":f.parseXML},flatOptions:{context:true,url:true}},ajaxPrefilter:D(y),ajaxTransport:D(z),ajax:function(a,c){function K(a,c,l,m){if(D===2){return}D=2;if(A){clearTimeout(A)}x=b;s=m||"";J.readyState=a>0?4:0;var n,o,p,q=c,r=l?H(d,J,l):b,t,u;if(a>=200&&a<300||a===304){if(d.ifModified){if(t=J.getResponseHeader("Last-Modified")){f.lastModified[k]=t}if(u=J.getResponseHeader("Etag")){f.etag[k]=u}}if(a===304){q="notmodified";n=true}else{try{o=I(d,r);q="success";n=true}catch(v){q="parsererror";p=v}}}else{p=q;if(!q||a){q="error";if(a<0){a=0}}}J.status=a;J.statusText=""+(c||q);if(n){h.resolveWith(e,[o,q,J])}else{h.rejectWith(e,[J,q,p])}J.statusCode(j);j=b;if(F){g.trigger("ajax"+(n?"Success":"Error"),[J,d,n?o:p])}i.resolveWith(e,[J,q]);if(F){g.trigger("ajaxComplete",[J,d]);if(!--f.active){f.event.trigger("ajaxStop")}}}if(typeof a==="object"){c=a;a=b}c=c||{};var d=f.ajaxSetup({},c),e=d.context||d,g=e!==d&&(e.nodeType||e instanceof f)?f(e):f.event,h=f.Deferred(),i=f._Deferred(),j=d.statusCode||{},k,n={},o={},s,t,x,A,C,D=0,F,G,J={readyState:0,setRequestHeader:function(a,b){if(!D){var c=a.toLowerCase();a=o[c]=o[c]||a;n[a]=b}return this},getAllResponseHeaders:function(){return D===2?s:null},getResponseHeader:function(a){var c;if(D===2){if(!t){t={};while(c=m.exec(s)){t[c[1].toLowerCase()]=c[2]}}c=t[a.toLowerCase()]}return c===b?null:c},overrideMimeType:function(a){if(!D){d.mimeType=a}return this},abort:function(a){a=a||"abort";if(x){x.abort(a)}K(0,a);return this}};h.promise(J);J.success=J.done;J.error=J.fail;J.complete=i.done;J.statusCode=function(a){if(a){var b;if(D<2){for(b in a){j[b]=[j[b],a[b]]}}else{b=a[J.status];J.then(b,b)}}return this};d.url=((a||d.url)+"").replace(l,"").replace(q,B[1]+"//");d.dataTypes=f.trim(d.dataType||"*").toLowerCase().split(u);if(d.crossDomain==null){C=w.exec(d.url.toLowerCase());d.crossDomain=!!(C&&(C[1]!=B[1]||C[2]!=B[2]||(C[3]||(C[1]==="http:"?80:443))!=(B[3]||(B[1]==="http:"?80:443))))}if(d.data&&d.processData&&typeof d.data!=="string"){d.data=f.param(d.data,d.traditional)}E(y,d,c,J);if(D===2){return false}F=d.global;d.type=d.type.toUpperCase();d.hasContent=!p.test(d.type);if(F&&f.active++===0){f.event.trigger("ajaxStart")}if(!d.hasContent){if(d.data){d.url+=(r.test(d.url)?"&":"?")+d.data;delete d.data}k=d.url;if(d.cache===false){var L=f.now(),M=d.url.replace(v,"$1_="+L);d.url=M+(M===d.url?(r.test(d.url)?"&":"?")+"_="+L:"")}}if(d.data&&d.hasContent&&d.contentType!==false||c.contentType){J.setRequestHeader("Content-Type",d.contentType)}if(d.ifModified){k=k||d.url;if(f.lastModified[k]){J.setRequestHeader("If-Modified-Since",f.lastModified[k])}if(f.etag[k]){J.setRequestHeader("If-None-Match",f.etag[k])}}J.setRequestHeader("Accept",d.dataTypes[0]&&d.accepts[d.dataTypes[0]]?d.accepts[d.dataTypes[0]]+(d.dataTypes[0]!=="*"?", */*; q=0.01":""):d.accepts["*"]);for(G in d.headers){J.setRequestHeader(G,d.headers[G])}if(d.beforeSend&&(d.beforeSend.call(e,J,d)===false||D===2)){J.abort();return false}for(G in{success:1,error:1,complete:1}){J[G](d[G])}x=E(z,d,c,J);if(!x){K(-1,"No Transport")}else{J.readyState=1;if(F){g.trigger("ajaxSend",[J,d])}if(d.async&&d.timeout>0){A=setTimeout(function(){J.abort("timeout")},d.timeout)}try{D=1;x.send(n,K)}catch(N){if(D<2){K(-1,N)}else{f.error(N)}}}return J},param:function(a,c){var d=[],e=function(a,b){b=f.isFunction(b)?b():b;d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(c===b){c=f.ajaxSettings.traditional}if(f.isArray(a)||a.jquery&&!f.isPlainObject(a)){f.each(a,function(){e(this.name,this.value)})}else{for(var g in a){G(g,a[g],c,e)}}return d.join("&").replace(i,"+")}});f.extend({active:0,lastModified:{},etag:{}});var J=a.ActiveXObject?function(){for(var a in L){L[a](0,1)}}:false,K=0,L;f.ajaxSettings.xhr=a.ActiveXObject?function(){return!this.isLocal&&M()||N()}:M;(function(a){f.extend(f.support,{ajax:!!a,cors:!!a&&"withCredentials"in a})})(f.ajaxSettings.xhr());if(f.support.ajax){f.ajaxTransport(function(c){if(!c.crossDomain||f.support.cors){var d;return{send:function(e,g){var h=c.xhr(),i,j;if(c.username){h.open(c.type,c.url,c.async,c.username,c.password)}else{h.open(c.type,c.url,c.async)}if(c.xhrFields){for(j in c.xhrFields){h[j]=c.xhrFields[j]}}if(c.mimeType&&h.overrideMimeType){h.overrideMimeType(c.mimeType)}if(!c.crossDomain&&!e["X-Requested-With"]){e["X-Requested-With"]="XMLHttpRequest"}try{for(j in e){h.setRequestHeader(j,e[j])}}catch(k){}h.send(c.hasContent&&c.data||null);d=function(a,e){var j,k,l,m,n;try{if(d&&(e||h.readyState===4)){d=b;if(i){h.onreadystatechange=f.noop;if(J){delete L[i]}}if(e){if(h.readyState!==4){h.abort()}}else{j=h.status;l=h.getAllResponseHeaders();m={};n=h.responseXML;if(n&&n.documentElement){m.xml=n}m.text=h.responseText;try{k=h.statusText}catch(o){k=""}if(!j&&c.isLocal&&!c.crossDomain){j=m.text?200:404}else if(j===1223){j=204}}}}catch(p){if(!e){g(-1,p)}}if(m){g(j,k,m,l)}};if(!c.async||h.readyState===4){d()}else{i=++K;if(J){if(!L){L={};f(a).unload(J)}L[i]=d}h.onreadystatechange=d}},abort:function(){if(d){d(0,1)}}}}})}f.ajaxSettings.global=false;a.jQuery=a.$=f})(global)}
},{}],5:[function(require,module,exports){
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
},{"./utils/PairedIntervalTree.js":13,"./utils/RemoteTrack.js":14,"./utils/utils.js":16}],6:[function(require,module,exports){
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
},{"./utils/IntervalTree.js":11,"./utils/LineMask.js":12,"./utils/utils.js":16}],7:[function(require,module,exports){
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
},{"./utils/utils.js":16}],8:[function(require,module,exports){
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
},{"./utils/IntervalTree.js":11,"./utils/RemoteTrack.js":14,"./utils/utils.js":16}],9:[function(require,module,exports){


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
},{}],10:[function(require,module,exports){
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
},{"./utils/IntervalTree.js":11,"./utils/utils.js":16}],11:[function(require,module,exports){
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
},{"./SortedList.js":15}],12:[function(require,module,exports){
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

},{"./utils.js":16}],13:[function(require,module,exports){
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
},{"./IntervalTree.js":11}],14:[function(require,module,exports){
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
},{"../../../underscore.min.js":19}],15:[function(require,module,exports){
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
},{}],16:[function(require,module,exports){
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
},{}],17:[function(require,module,exports){
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


},{"./utils/utils.js":16}],18:[function(require,module,exports){
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

},{"./utils/SortedList.js":15,"./utils/utils.js":16}],19:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2suanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tXb3JrZXIuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tzLmpzIiwianMvY3VzdG9tL2pxdWVyeS5ub2RvbS5taW4uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmFtLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iZWRncmFwaC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWdiZWQuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmlnd2lnLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2ZlYXR1cmV0YWJsZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9JbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvTGluZU1hc2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1JlbW90ZVRyYWNrLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1NvcnRlZExpc3QuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdmNmdGFiaXguanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMiLCJqcy91bmRlcnNjb3JlLm1pbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3SEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2hVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDM1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBDdXN0b21UcmFjaywgYW4gb2JqZWN0IHJlcHJlc2VudGluZyBhIGN1c3RvbSB0cmFjayBhcyB1bmRlcnN0b29kIGJ5IFVDU0MuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gVGhpcyBjbGFzcyAqZG9lcyogZGVwZW5kIG9uIGdsb2JhbCBvYmplY3RzIGFuZCB0aGVyZWZvcmUgbXVzdCBiZSByZXF1aXJlZCBhcyBhIFxuLy8gZnVuY3Rpb24gdGhhdCBpcyBleGVjdXRlZCBvbiB0aGUgZ2xvYmFsIG9iamVjdC5cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpIHtcblxudmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG5mdW5jdGlvbiBDdXN0b21UcmFjayhvcHRzLCBicm93c2VyT3B0cykge1xuICBpZiAoIW9wdHMpIHsgcmV0dXJuOyB9IC8vIFRoaXMgaXMgYW4gZW1wdHkgY3VzdG9tVHJhY2sgdGhhdCB3aWxsIGJlIGh5ZHJhdGVkIHdpdGggdmFsdWVzIGZyb20gYSBzZXJpYWxpemVkIG9iamVjdFxuICB0aGlzLl90eXBlID0gKG9wdHMudHlwZSAmJiBvcHRzLnR5cGUudG9Mb3dlckNhc2UoKSkgfHwgXCJiZWRcIjtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgaWYgKHR5cGUgPT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgdHJhY2sgdHlwZSAnXCIrb3B0cy50eXBlK1wiJyBlbmNvdW50ZXJlZCBvbiBsaW5lIFwiICsgb3B0cy5saW5lTnVtKTsgfVxuICB0aGlzLm9wdHMgPSBfLmV4dGVuZCh7fSwgdGhpcy5jb25zdHJ1Y3Rvci5kZWZhdWx0cywgdHlwZS5kZWZhdWx0cyB8fCB7fSwgb3B0cyk7XG4gIF8uZXh0ZW5kKHRoaXMsIHtcbiAgICBicm93c2VyT3B0czogYnJvd3Nlck9wdHMsXG4gICAgc3RyZXRjaEhlaWdodDogZmFsc2UsXG4gICAgaGVpZ2h0czoge30sXG4gICAgc2l6ZXM6IFsnZGVuc2UnXSxcbiAgICBtYXBTaXplczogW10sXG4gICAgYXJlYXM6IHt9LFxuICAgIG5vQXJlYUxhYmVsczogZmFsc2UsXG4gICAgZXhwZWN0c1NlcXVlbmNlOiBmYWxzZVxuICB9KTtcbiAgdGhpcy5pbml0KCk7XG59XG5cbkN1c3RvbVRyYWNrLmRlZmF1bHRzID0ge1xuICBuYW1lOiAnVXNlciBUcmFjaycsXG4gIGRlc2NyaXB0aW9uOiAnVXNlciBTdXBwbGllZCBUcmFjaycsXG4gIGNvbG9yOiAnMCwwLDAnXG59O1xuXG5DdXN0b21UcmFjay50eXBlcyA9IHtcbiAgYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZC5qcycpLFxuICBmZWF0dXJldGFibGU6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzJyksXG4gIGJlZGdyYXBoOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzJyksXG4gIHdpZ2dsZV8wOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3dpZ2dsZV8wLmpzJyksXG4gIHZjZnRhYml4OiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3ZjZnRhYml4LmpzJyksXG4gIGJpZ2JlZDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWdiZWQuanMnKSxcbiAgYmFtOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JhbS5qcycpLFxuICBiaWd3aWc6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnd2lnLmpzJylcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJlZERldGFpbCBmb3JtYXQ6IGh0dHBzOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxLjcgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gIFxuXG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwgPSBfLmNsb25lKEN1c3RvbVRyYWNrLnR5cGVzLmJlZCk7XG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMgPSBfLmV4dGVuZCh7fSwgQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsLmRlZmF1bHRzLCB7ZGV0YWlsOiB0cnVlfSk7XG5cbi8vIFRoZXNlIGZ1bmN0aW9ucyBicmFuY2ggdG8gZGlmZmVyZW50IG1ldGhvZHMgZGVwZW5kaW5nIG9uIHRoZSAudHlwZSgpIG9mIHRoZSB0cmFja1xuXy5lYWNoKFsnaW5pdCcsICdwYXJzZScsICdyZW5kZXInLCAncmVuZGVyU2VxdWVuY2UnLCAncHJlcmVuZGVyJ10sIGZ1bmN0aW9uKGZuKSB7XG4gIEN1c3RvbVRyYWNrLnByb3RvdHlwZVtmbl0gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgdHlwZSA9IHRoaXMudHlwZSgpO1xuICAgIGlmICghdHlwZVtmbl0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgcmV0dXJuIHR5cGVbZm5dLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG59KTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmxvYWRPcHRzID0gZnVuY3Rpb24oJGRpYWxvZykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpLFxuICAgIG8gPSB0aGlzLm9wdHM7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0nKS5oaWRlKCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0uJyt0aGlzLl90eXBlKS5zaG93KCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1uYW1lJykudGV4dChvLm5hbWUpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tZGVzYycpLnRleHQoby5kZXNjcmlwdGlvbik7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1mb3JtYXQnKS50ZXh0KHRoaXMuX3R5cGUpO1xuICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yXScpLnZhbChvLmNvbG9yKS5jaGFuZ2UoKTtcbiAgaWYgKHR5cGUubG9hZE9wdHMpIHsgdHlwZS5sb2FkT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gICRkaWFsb2cuZmluZCgnLmVuYWJsZXInKS5jaGFuZ2UoKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5zYXZlT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICBvLmNvbG9yID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoKTtcbiAgaWYgKCF0aGlzLnZhbGlkYXRlQ29sb3Ioby5jb2xvcikpIHsgby5jb2xvciA9ICcwLDAsMCc7IH1cbiAgaWYgKHR5cGUuc2F2ZU9wdHMpIHsgdHlwZS5zYXZlT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gIHRoaXMuYXBwbHlPcHRzKCk7XG4gIGdsb2JhbC5DdXN0b21UcmFja3Mud29ya2VyKCkgJiYgdGhpcy5hcHBseU9wdHNBc3luYygpOyAvLyBBcHBseSB0aGUgY2hhbmdlcyB0byB0aGUgd29ya2VyIHRvbyFcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hcHBseU9wdHMgPSBmdW5jdGlvbihvcHRzKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmIChvcHRzKSB7IHRoaXMub3B0cyA9IG9wdHM7IH1cbiAgaWYgKHR5cGUuYXBwbHlPcHRzKSB7IHR5cGUuYXBwbHlPcHRzLmNhbGwodGhpcyk7IH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5lcmFzZSA9IGZ1bmN0aW9uKGNhbnZhcykge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gIGlmIChjdHgpIHsgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpOyB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAoXy5pc1VuZGVmaW5lZCh0eXBlKSkgeyB0eXBlID0gdGhpcy5fdHlwZTsgfVxuICByZXR1cm4gdGhpcy5jb25zdHJ1Y3Rvci50eXBlc1t0eXBlXSB8fCBudWxsO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLndhcm4gPSBmdW5jdGlvbih3YXJuaW5nKSB7XG4gIGlmICh0aGlzLm9wdHMuc3RyaWN0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHdhcm5pbmcpO1xuICB9IGVsc2Uge1xuICAgIGlmICghdGhpcy53YXJuaW5ncykgeyB0aGlzLndhcm5pbmdzID0gW107IH1cbiAgICB0aGlzLndhcm5pbmdzLnB1c2god2FybmluZyk7XG4gIH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5pc09uID0gZnVuY3Rpb24odmFsKSB7XG4gIHJldHVybiAvXihvbnx5ZXN8dHJ1ZXx0fHl8MSkkL2kudGVzdCh2YWwudG9TdHJpbmcoKSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyTGlzdCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuX2Nockxpc3QpIHtcbiAgICB0aGlzLl9jaHJMaXN0ID0gXy5zb3J0QnkoXy5tYXAodGhpcy5icm93c2VyT3B0cy5jaHJQb3MsIGZ1bmN0aW9uKHBvcywgY2hyKSB7IHJldHVybiBbcG9zLCBjaHJdOyB9KSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2Nockxpc3Q7XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJBdCA9IGZ1bmN0aW9uKHBvcykge1xuICB2YXIgY2hyTGlzdCA9IHRoaXMuY2hyTGlzdCgpLFxuICAgIGNockluZGV4ID0gXy5zb3J0ZWRJbmRleChjaHJMaXN0LCBbcG9zXSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSksXG4gICAgY2hyID0gY2hySW5kZXggPiAwID8gY2hyTGlzdFtjaHJJbmRleCAtIDFdWzFdIDogbnVsbDtcbiAgcmV0dXJuIHtpOiBjaHJJbmRleCAtIDEsIGM6IGNociwgcDogcG9zIC0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyXX07XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyUmFuZ2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHZhciBjaHJMZW5ndGhzID0gdGhpcy5icm93c2VyT3B0cy5jaHJMZW5ndGhzLFxuICAgIHN0YXJ0Q2hyID0gdGhpcy5jaHJBdChzdGFydCksXG4gICAgZW5kQ2hyID0gdGhpcy5jaHJBdChlbmQpLFxuICAgIHJhbmdlO1xuICBpZiAoc3RhcnRDaHIuYyAmJiBzdGFydENoci5pID09PSBlbmRDaHIuaSkgeyByZXR1cm4gW3N0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgZW5kQ2hyLnBdOyB9XG4gIGVsc2Uge1xuICAgIHJhbmdlID0gXy5tYXAodGhpcy5jaHJMaXN0KCkuc2xpY2Uoc3RhcnRDaHIuaSArIDEsIGVuZENoci5pKSwgZnVuY3Rpb24odikge1xuICAgICAgcmV0dXJuIHZbMV0gKyAnOjEtJyArIGNockxlbmd0aHNbdlsxXV07XG4gICAgfSk7XG4gICAgc3RhcnRDaHIuYyAmJiByYW5nZS51bnNoaWZ0KHN0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgY2hyTGVuZ3Roc1tzdGFydENoci5jXSk7XG4gICAgZW5kQ2hyLmMgJiYgcmFuZ2UucHVzaChlbmRDaHIuYyArICc6MS0nICsgZW5kQ2hyLnApO1xuICAgIHJldHVybiByYW5nZTtcbiAgfVxufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucHJlcmVuZGVyQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAncHJlcmVuZGVyJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0c0FzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ2FwcGx5T3B0cycsIFt0aGlzLm9wdHMsIGZ1bmN0aW9uKCl7fV0sIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYWpheERpciA9IGZ1bmN0aW9uKCkge1xuICAvLyBXZWIgV29ya2VycyBmZXRjaCBVUkxzIHJlbGF0aXZlIHRvIHRoZSBKUyBmaWxlIGl0c2VsZi5cbiAgcmV0dXJuIChnbG9iYWwuSFRNTERvY3VtZW50ID8gJycgOiAnLi4vJykgKyB0aGlzLmJyb3dzZXJPcHRzLmFqYXhEaXI7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucmdiVG9Ic2wgPSBmdW5jdGlvbihyLCBnLCBiKSB7XG4gIHIgLz0gMjU1LCBnIC89IDI1NSwgYiAvPSAyNTU7XG4gIHZhciBtYXggPSBNYXRoLm1heChyLCBnLCBiKSwgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIHZhciBoLCBzLCBsID0gKG1heCArIG1pbikgLyAyO1xuXG4gIGlmIChtYXggPT0gbWluKSB7XG4gICAgaCA9IHMgPSAwOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgdmFyIGQgPSBtYXggLSBtaW47XG4gICAgcyA9IGwgPiAwLjUgPyBkIC8gKDIgLSBtYXggLSBtaW4pIDogZCAvIChtYXggKyBtaW4pO1xuICAgIHN3aXRjaChtYXgpe1xuICAgICAgY2FzZSByOiBoID0gKGcgLSBiKSAvIGQgKyAoZyA8IGIgPyA2IDogMCk7IGJyZWFrO1xuICAgICAgY2FzZSBnOiBoID0gKGIgLSByKSAvIGQgKyAyOyBicmVhaztcbiAgICAgIGNhc2UgYjogaCA9IChyIC0gZykgLyBkICsgNDsgYnJlYWs7XG4gICAgfVxuICAgIGggLz0gNjtcbiAgfVxuXG4gIHJldHVybiBbaCwgcywgbF07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5oc2xUb1JnYiA9IGZ1bmN0aW9uKGgsIHMsIGwpIHtcbiAgdmFyIHIsIGcsIGI7XG5cbiAgaWYgKHMgPT0gMCkge1xuICAgIHIgPSBnID0gYiA9IGw7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICBmdW5jdGlvbiBodWUycmdiKHAsIHEsIHQpIHtcbiAgICAgIGlmKHQgPCAwKSB0ICs9IDE7XG4gICAgICBpZih0ID4gMSkgdCAtPSAxO1xuICAgICAgaWYodCA8IDEvNikgcmV0dXJuIHAgKyAocSAtIHApICogNiAqIHQ7XG4gICAgICBpZih0IDwgMS8yKSByZXR1cm4gcTtcbiAgICAgIGlmKHQgPCAyLzMpIHJldHVybiBwICsgKHEgLSBwKSAqICgyLzMgLSB0KSAqIDY7XG4gICAgICByZXR1cm4gcDtcbiAgICB9XG5cbiAgICB2YXIgcSA9IGwgPCAwLjUgPyBsICogKDEgKyBzKSA6IGwgKyBzIC0gbCAqIHM7XG4gICAgdmFyIHAgPSAyICogbCAtIHE7XG4gICAgciA9IGh1ZTJyZ2IocCwgcSwgaCArIDEvMyk7XG4gICAgZyA9IGh1ZTJyZ2IocCwgcSwgaCk7XG4gICAgYiA9IGh1ZTJyZ2IocCwgcSwgaCAtIDEvMyk7XG4gIH1cblxuICByZXR1cm4gW3IgKiAyNTUsIGcgKiAyNTUsIGIgKiAyNTVdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUudmFsaWRhdGVDb2xvciA9IGZ1bmN0aW9uKGNvbG9yKSB7XG4gIHZhciBtID0gY29sb3IubWF0Y2goLyhcXGQrKSwoXFxkKyksKFxcZCspLyk7XG4gIGlmICghbSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgbS5zaGlmdCgpO1xuICByZXR1cm4gXy5hbGwoXy5tYXAobSwgcGFyc2VJbnQxMCksIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHYgPj0wICYmIHYgPD0gMjU1OyB9KTtcbn1cblxucmV0dXJuIEN1c3RvbVRyYWNrO1xuXG59OyIsInZhciBnbG9iYWwgPSBzZWxmOyAgLy8gZ3JhYiBnbG9iYWwgc2NvbGUgZm9yIFdlYiBXb3JrZXJzXG5yZXF1aXJlKCcuL2pxdWVyeS5ub2RvbS5taW4uanMnKShnbG9iYWwpO1xuZ2xvYmFsLl8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xucmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpO1xuXG5pZiAoIWdsb2JhbC5jb25zb2xlIHx8ICFnbG9iYWwuY29uc29sZS5sb2cpIHtcbiAgZ2xvYmFsLmNvbnNvbGUgPSBnbG9iYWwuY29uc29sZSB8fCB7fTtcbiAgZ2xvYmFsLmNvbnNvbGUubG9nID0gZnVuY3Rpb24oKSB7XG4gICAgZ2xvYmFsLnBvc3RNZXNzYWdlKHtsb2c6IEpTT04uc3RyaW5naWZ5KF8udG9BcnJheShhcmd1bWVudHMpKX0pO1xuICB9O1xufVxuXG52YXIgQ3VzdG9tVHJhY2tXb3JrZXIgPSB7XG4gIF90cmFja3M6IFtdLFxuICBfdGhyb3dFcnJvcnM6IGZhbHNlLFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCwgYnJvd3Nlck9wdHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB0cmFja3MgPSBDdXN0b21UcmFja3MucGFyc2UodGV4dCwgYnJvd3Nlck9wdHMpO1xuICAgIHJldHVybiBfLm1hcCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgIC8vIHdlIHdhbnQgdG8ga2VlcCB0aGUgdHJhY2sgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgICAgLy8gaXMgc2VudCBiYWNrIG92ZXIgdGhlIGZlbmNlLCBzaW5jZSBpdCBpcyBleHBlbnNpdmUvaW1wb3NzaWJsZSB0byBzZXJpYWxpemVcbiAgICAgIHQuaWQgPSBzZWxmLl90cmFja3MucHVzaCh0KSAtIDE7XG4gICAgICB2YXIgc2VyaWFsaXphYmxlID0gXy5leHRlbmQoe30sIHQpO1xuICAgICAgZGVsZXRlIHNlcmlhbGl6YWJsZS5kYXRhO1xuICAgICAgcmV0dXJuIHNlcmlhbGl6YWJsZTtcbiAgICB9KTtcbiAgfSxcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgdHJhY2sgPSB0aGlzLl90cmFja3NbaWRdO1xuICAgIHRyYWNrLnByZXJlbmRlci5hcHBseSh0cmFjaywgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICBhcmdzID0gXy50b0FycmF5KGFyZ3VtZW50cyksXG4gICAgICBpZCA9IF8uZmlyc3QoYXJncyksXG4gICAgICB0cmFjayA9IHRoaXMuX3RyYWNrc1tpZF07XG4gICAgdHJhY2suYXBwbHlPcHRzLmFwcGx5KHRyYWNrLCBfLnJlc3QoYXJncykpO1xuICB9LFxuICB0aHJvd0Vycm9yczogZnVuY3Rpb24odG9nZ2xlKSB7XG4gICAgdGhpcy5fdGhyb3dFcnJvcnMgPSB0b2dnbGU7XG4gIH1cbn07XG5cbmdsb2JhbC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICB2YXIgZGF0YSA9IGUuZGF0YSxcbiAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKHIpIHsgZ2xvYmFsLnBvc3RNZXNzYWdlKHtpZDogZGF0YS5pZCwgcmV0OiBKU09OLnN0cmluZ2lmeShyIHx8IG51bGwpfSk7IH0sXG4gICAgcmV0O1xuXG4gIGlmIChDdXN0b21UcmFja1dvcmtlci5fdGhyb3dFcnJvcnMgfHwgdHJ1ZSkge1xuICAgIHJldCA9IEN1c3RvbVRyYWNrV29ya2VyW2RhdGEub3BdLmFwcGx5KEN1c3RvbVRyYWNrV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7XG4gIH0gZWxzZSB7XG4gICAgdHJ5IHsgcmV0ID0gQ3VzdG9tVHJhY2tXb3JrZXJbZGF0YS5vcF0uYXBwbHkoQ3VzdG9tVHJhY2tXb3JrZXIsIGRhdGEuYXJncy5jb25jYXQoY2FsbGJhY2spKTsgfSBcbiAgICBjYXRjaCAoZXJyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIGVycm9yOiBKU09OLnN0cmluZ2lmeSh7bWVzc2FnZTogZXJyLm1lc3NhZ2V9KX0pOyB9XG4gIH1cbiAgXG4gIGlmICghXy5pc1VuZGVmaW5lZChyZXQpKSB7IGNhbGxiYWNrKHJldCk7IH1cbn0pOyIsIm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uKGdsb2JhbCl7XG4gIFxuICB2YXIgXyA9IHJlcXVpcmUoJy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG4gIFxuICAvLyBTb21lIHV0aWxpdHkgZnVuY3Rpb25zLlxuICB2YXIgdXRpbHMgPSByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3V0aWxzL3V0aWxzLmpzJyksXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmUgPSB1dGlscy5wYXJzZURlY2xhcmF0aW9uTGluZTtcbiAgXG4gIC8vIFRoZSBjbGFzcyB0aGF0IHJlcHJlc2VudHMgYSBzaW5ndWxhciBjdXN0b20gdHJhY2sgb2JqZWN0XG4gIHZhciBDdXN0b21UcmFjayA9IHJlcXVpcmUoJy4vQ3VzdG9tVHJhY2suanMnKShnbG9iYWwpO1xuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyA9IEN1c3RvbVRyYWNrcywgdGhlIG1vZHVsZSB0aGF0IGlzIGV4cG9ydGVkIHRvIHRoZSBnbG9iYWwgZW52aXJvbm1lbnQuID1cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIEJyb2FkbHkgc3BlYWtpbmcgdGhpcyBpcyBhIGZhY3RvcnkgZm9yIHBhcnNpbmcgZGF0YSBpbnRvIEN1c3RvbVRyYWNrIG9iamVjdHMsXG4gIC8vIGFuZCBpdCBjYW4gZGVsZWdhdGUgdGhpcyB3b3JrIHRvIGEgd29ya2VyIHRocmVhZC5cblxuICB2YXIgQ3VzdG9tVHJhY2tzID0ge1xuICAgIHBhcnNlOiBmdW5jdGlvbihjaHVua3MsIGJyb3dzZXJPcHRzKSB7XG4gICAgICB2YXIgY3VzdG9tVHJhY2tzID0gW10sXG4gICAgICAgIGRhdGEgPSBbXSxcbiAgICAgICAgdHJhY2ssIG9wdHMsIG07XG4gICAgICBcbiAgICAgIGlmICh0eXBlb2YgY2h1bmtzID09IFwic3RyaW5nXCIpIHsgY2h1bmtzID0gW2NodW5rc107IH1cbiAgICAgIFxuICAgICAgZnVuY3Rpb24gcHVzaFRyYWNrKCkge1xuICAgICAgICBpZiAodHJhY2sucGFyc2UoZGF0YSkpIHsgY3VzdG9tVHJhY2tzLnB1c2godHJhY2spOyB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyID0ge307XG4gICAgICBfLmVhY2goY2h1bmtzLCBmdW5jdGlvbih0ZXh0KSB7XG4gICAgICAgIF8uZWFjaCh0ZXh0LnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgICAgICBpZiAoL14jLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBjb21tZW50IGxpbmVcbiAgICAgICAgICB9IGVsc2UgaWYgKC9eYnJvd3NlclxccysvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIC8vIGJyb3dzZXIgbGluZXNcbiAgICAgICAgICAgIG0gPSBsaW5lLm1hdGNoKC9eYnJvd3NlclxccysoXFx3KylcXHMrKFxcUyopLyk7XG4gICAgICAgICAgICBpZiAoIW0pIHsgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IHBhcnNlIGJyb3dzZXIgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgY3VzdG9tVHJhY2tzLmJyb3dzZXJbbVsxXV0gPSBtWzJdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoL150cmFja1xccysvaS50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICBpZiAodHJhY2spIHsgcHVzaFRyYWNrKCk7IH1cbiAgICAgICAgICAgIG9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAoL150cmFja1xccysvaSkpO1xuICAgICAgICAgICAgaWYgKCFvcHRzKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSB0cmFjayBsaW5lIGZvdW5kIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSkpOyB9XG4gICAgICAgICAgICBvcHRzLmxpbmVOdW0gPSBsaW5lbm8gKyAxO1xuICAgICAgICAgICAgdHJhY2sgPSBuZXcgQ3VzdG9tVHJhY2sob3B0cywgYnJvd3Nlck9wdHMpO1xuICAgICAgICAgICAgZGF0YSA9IFtdO1xuICAgICAgICAgIH0gZWxzZSBpZiAoL1xcUy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKCF0cmFjaykgeyB0aHJvdyBuZXcgRXJyb3IoXCJGb3VuZCBkYXRhIG9uIGxpbmUgXCIrKGxpbmVubysxKStcIiBidXQgbm8gcHJlY2VkaW5nIHRyYWNrIGRlZmluaXRpb25cIik7IH1cbiAgICAgICAgICAgIGRhdGEucHVzaChsaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBpZiAodHJhY2spIHsgcHVzaFRyYWNrKCk7IH1cbiAgICAgIHJldHVybiBjdXN0b21UcmFja3M7XG4gICAgfSxcbiAgICBcbiAgICBwYXJzZURlY2xhcmF0aW9uTGluZTogcGFyc2VEZWNsYXJhdGlvbkxpbmUsXG4gICAgXG4gICAgZXJyb3I6IGZ1bmN0aW9uKGUpIHtcbiAgICAgIC8vIENhbiBiZSBvdmVycmlkZGVuIGJ5IGEgcGFyZW50IGxpYnJhcnkgdG8gaGFuZGxlIGVycm9ycyBtb3JlIGdyYWNlZnVsbHkuXG4gICAgICBjb25zb2xlLmxvZyhlKTtcbiAgICB9LFxuICAgIFxuICAgIF93b3JrZXJTY3JpcHQ6ICdidWlsZC9DdXN0b21UcmFja1dvcmtlci5qcycsXG4gICAgLy8gTk9URTogVG8gdGVtcG9yYXJpbHkgZGlzYWJsZSBXZWIgV29ya2VyIHVzYWdlLCBzZXQgdGhpcyB0byB0cnVlLlxuICAgIF9kaXNhYmxlV29ya2VyczogZmFsc2UsXG4gICAgXG4gICAgd29ya2VyOiBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICAgIGNhbGxiYWNrcyA9IFtdO1xuICAgICAgaWYgKCFzZWxmLl93b3JrZXIgJiYgZ2xvYmFsLldvcmtlcikgeyBcbiAgICAgICAgc2VsZi5fd29ya2VyID0gbmV3IGdsb2JhbC5Xb3JrZXIoc2VsZi5fd29ya2VyU2NyaXB0KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgZnVuY3Rpb24oZSkgeyBzZWxmLmVycm9yKGUpOyB9LCBmYWxzZSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICAgICAgICAgIGlmIChlLmRhdGEubG9nKSB7IGNvbnNvbGUubG9nKEpTT04ucGFyc2UoZS5kYXRhLmxvZykpOyByZXR1cm47IH1cbiAgICAgICAgICBpZiAoZS5kYXRhLmVycm9yKSB7XG4gICAgICAgICAgICBpZiAoZS5kYXRhLmlkKSB7IGNhbGxiYWNrc1tlLmRhdGEuaWRdID0gbnVsbDsgfVxuICAgICAgICAgICAgc2VsZi5lcnJvcihKU09OLnBhcnNlKGUuZGF0YS5lcnJvcikpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYWxsYmFja3NbZS5kYXRhLmlkXShKU09OLnBhcnNlKGUuZGF0YS5yZXQpKTtcbiAgICAgICAgICBjYWxsYmFja3NbZS5kYXRhLmlkXSA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgICBzZWxmLl93b3JrZXIuY2FsbCA9IGZ1bmN0aW9uKG9wLCBhcmdzLCBjYWxsYmFjaykge1xuICAgICAgICAgIHZhciBpZCA9IGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKSAtIDE7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6IG9wLCBpZDogaWQsIGFyZ3M6IGFyZ3N9KTtcbiAgICAgICAgfTtcbiAgICAgICAgLy8gVG8gaGF2ZSB0aGUgd29ya2VyIHRocm93IGVycm9ycyBpbnN0ZWFkIG9mIHBhc3NpbmcgdGhlbSBuaWNlbHkgYmFjaywgY2FsbCB0aGlzIHdpdGggdG9nZ2xlPXRydWVcbiAgICAgICAgc2VsZi5fd29ya2VyLnRocm93RXJyb3JzID0gZnVuY3Rpb24odG9nZ2xlKSB7XG4gICAgICAgICAgdGhpcy5wb3N0TWVzc2FnZSh7b3A6ICd0aHJvd0Vycm9ycycsIGFyZ3M6IFt0b2dnbGVdfSk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VsZi5fZGlzYWJsZVdvcmtlcnMgPyBudWxsIDogc2VsZi5fd29ya2VyO1xuICAgIH0sXG4gICAgXG4gICAgYXN5bmM6IGZ1bmN0aW9uKHNlbGYsIGZuLCBhcmdzLCBhc3luY0V4dHJhQXJncywgd3JhcHBlcikge1xuICAgICAgYXJncyA9IF8udG9BcnJheShhcmdzKTtcbiAgICAgIHdyYXBwZXIgPSB3cmFwcGVyIHx8IF8uaWRlbnRpdHk7XG4gICAgICB2YXIgYXJnc0V4Y2VwdExhc3RPbmUgPSBfLmluaXRpYWwoYXJncyksXG4gICAgICAgIGNhbGxiYWNrID0gXy5sYXN0KGFyZ3MpLFxuICAgICAgICB3ID0gdGhpcy53b3JrZXIoKTtcbiAgICAgIC8vIEZhbGxiYWNrIGlmIHdlYiB3b3JrZXJzIGFyZSBub3Qgc3VwcG9ydGVkLlxuICAgICAgLy8gVGhpcyBjb3VsZCBhbHNvIGJlIHR3ZWFrZWQgdG8gbm90IHVzZSB3ZWIgd29ya2VycyB3aGVuIHRoZXJlIHdvdWxkIGJlIG5vIHBlcmZvcm1hbmNlIGdhaW47XG4gICAgICAvLyAgIGFjdGl2YXRpbmcgdGhpcyBicmFuY2ggZGlzYWJsZXMgd2ViIHdvcmtlcnMgZW50aXJlbHkgYW5kIGV2ZXJ5dGhpbmcgaGFwcGVucyBzeW5jaHJvbm91c2x5LlxuICAgICAgaWYgKCF3KSB7IHJldHVybiBjYWxsYmFjayhzZWxmW2ZuXS5hcHBseShzZWxmLCBhcmdzRXhjZXB0TGFzdE9uZSkpOyB9XG4gICAgICBBcnJheS5wcm90b3R5cGUudW5zaGlmdC5hcHBseShhcmdzRXhjZXB0TGFzdE9uZSwgYXN5bmNFeHRyYUFyZ3MpO1xuICAgICAgdy5jYWxsKGZuLCBhcmdzRXhjZXB0TGFzdE9uZSwgZnVuY3Rpb24ocmV0KSB7IGNhbGxiYWNrKHdyYXBwZXIocmV0KSk7IH0pO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VBc3luYzogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmFzeW5jKHRoaXMsICdwYXJzZScsIGFyZ3VtZW50cywgW10sIGZ1bmN0aW9uKHRyYWNrcykge1xuICAgICAgICAvLyBUaGVzZSBoYXZlIGJlZW4gc2VyaWFsaXplZCwgc28gdGhleSBtdXN0IGJlIGh5ZHJhdGVkIGludG8gcmVhbCBDdXN0b21UcmFjayBvYmplY3RzLlxuICAgICAgICAvLyBXZSByZXBsYWNlIC5wcmVyZW5kZXIoKSB3aXRoIGFuIGFzeW5jaHJvbm91cyB2ZXJzaW9uLlxuICAgICAgICByZXR1cm4gXy5tYXAodHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgcmV0dXJuIF8uZXh0ZW5kKG5ldyBDdXN0b21UcmFjaygpLCB0LCB7XG4gICAgICAgICAgICBwcmVyZW5kZXI6IGZ1bmN0aW9uKCkgeyBDdXN0b21UcmFjay5wcm90b3R5cGUucHJlcmVuZGVyQXN5bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBnbG9iYWwuQ3VzdG9tVHJhY2tzID0gQ3VzdG9tVHJhY2tzO1xuXG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCl7Z2xvYmFsLndpbmRvdz1nbG9iYWwud2luZG93fHxnbG9iYWw7Z2xvYmFsLndpbmRvdy5kb2N1bWVudD1nbG9iYWwud2luZG93LmRvY3VtZW50fHx7fTsoZnVuY3Rpb24oYSxiKXtmdW5jdGlvbiBOKCl7dHJ5e3JldHVybiBuZXcgYS5BY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTEhUVFBcIil9Y2F0Y2goYil7fX1mdW5jdGlvbiBNKCl7dHJ5e3JldHVybiBuZXcgYS5YTUxIdHRwUmVxdWVzdH1jYXRjaChiKXt9fWZ1bmN0aW9uIEkoYSxjKXtpZihhLmRhdGFGaWx0ZXIpe2M9YS5kYXRhRmlsdGVyKGMsYS5kYXRhVHlwZSl9dmFyIGQ9YS5kYXRhVHlwZXMsZT17fSxnLGgsaT1kLmxlbmd0aCxqLGs9ZFswXSxsLG0sbixvLHA7Zm9yKGc9MTtnPGk7ZysrKXtpZihnPT09MSl7Zm9yKGggaW4gYS5jb252ZXJ0ZXJzKXtpZih0eXBlb2YgaD09PVwic3RyaW5nXCIpe2VbaC50b0xvd2VyQ2FzZSgpXT1hLmNvbnZlcnRlcnNbaF19fX1sPWs7az1kW2ddO2lmKGs9PT1cIipcIil7az1sfWVsc2UgaWYobCE9PVwiKlwiJiZsIT09ayl7bT1sK1wiIFwiK2s7bj1lW21dfHxlW1wiKiBcIitrXTtpZighbil7cD1iO2ZvcihvIGluIGUpe2o9by5zcGxpdChcIiBcIik7aWYoalswXT09PWx8fGpbMF09PT1cIipcIil7cD1lW2pbMV0rXCIgXCIra107aWYocCl7bz1lW29dO2lmKG89PT10cnVlKXtuPXB9ZWxzZSBpZihwPT09dHJ1ZSl7bj1vfWJyZWFrfX19fWlmKCEobnx8cCkpe2YuZXJyb3IoXCJObyBjb252ZXJzaW9uIGZyb20gXCIrbS5yZXBsYWNlKFwiIFwiLFwiIHRvIFwiKSl9aWYobiE9PXRydWUpe2M9bj9uKGMpOnAobyhjKSl9fX1yZXR1cm4gY31mdW5jdGlvbiBIKGEsYyxkKXt2YXIgZT1hLmNvbnRlbnRzLGY9YS5kYXRhVHlwZXMsZz1hLnJlc3BvbnNlRmllbGRzLGgsaSxqLGs7Zm9yKGkgaW4gZyl7aWYoaSBpbiBkKXtjW2dbaV1dPWRbaV19fXdoaWxlKGZbMF09PT1cIipcIil7Zi5zaGlmdCgpO2lmKGg9PT1iKXtoPWEubWltZVR5cGV8fGMuZ2V0UmVzcG9uc2VIZWFkZXIoXCJjb250ZW50LXR5cGVcIil9fWlmKGgpe2ZvcihpIGluIGUpe2lmKGVbaV0mJmVbaV0udGVzdChoKSl7Zi51bnNoaWZ0KGkpO2JyZWFrfX19aWYoZlswXWluIGQpe2o9ZlswXX1lbHNle2ZvcihpIGluIGQpe2lmKCFmWzBdfHxhLmNvbnZlcnRlcnNbaStcIiBcIitmWzBdXSl7aj1pO2JyZWFrfWlmKCFrKXtrPWl9fWo9anx8a31pZihqKXtpZihqIT09ZlswXSl7Zi51bnNoaWZ0KGopfXJldHVybiBkW2pdfX1mdW5jdGlvbiBHKGEsYixjLGQpe2lmKGYuaXNBcnJheShiKSl7Zi5lYWNoKGIsZnVuY3Rpb24oYixlKXtpZihjfHxqLnRlc3QoYSkpe2QoYSxlKX1lbHNle0coYStcIltcIisodHlwZW9mIGU9PT1cIm9iamVjdFwifHxmLmlzQXJyYXkoZSk/YjpcIlwiKStcIl1cIixlLGMsZCl9fSl9ZWxzZSBpZighYyYmYiE9bnVsbCYmdHlwZW9mIGI9PT1cIm9iamVjdFwiKXtmb3IodmFyIGUgaW4gYil7RyhhK1wiW1wiK2UrXCJdXCIsYltlXSxjLGQpfX1lbHNle2QoYSxiKX19ZnVuY3Rpb24gRihhLGMpe3ZhciBkLGUsZz1mLmFqYXhTZXR0aW5ncy5mbGF0T3B0aW9uc3x8e307Zm9yKGQgaW4gYyl7aWYoY1tkXSE9PWIpeyhnW2RdP2E6ZXx8KGU9e30pKVtkXT1jW2RdfX1pZihlKXtmLmV4dGVuZCh0cnVlLGEsZSl9fWZ1bmN0aW9uIEUoYSxjLGQsZSxmLGcpe2Y9Znx8Yy5kYXRhVHlwZXNbMF07Zz1nfHx7fTtnW2ZdPXRydWU7dmFyIGg9YVtmXSxpPTAsaj1oP2gubGVuZ3RoOjAsaz1hPT09eSxsO2Zvcig7aTxqJiYoa3x8IWwpO2krKyl7bD1oW2ldKGMsZCxlKTtpZih0eXBlb2YgbD09PVwic3RyaW5nXCIpe2lmKCFrfHxnW2xdKXtsPWJ9ZWxzZXtjLmRhdGFUeXBlcy51bnNoaWZ0KGwpO2w9RShhLGMsZCxlLGwsZyl9fX1pZigoa3x8IWwpJiYhZ1tcIipcIl0pe2w9RShhLGMsZCxlLFwiKlwiLGcpfXJldHVybiBsfWZ1bmN0aW9uIEQoYSl7cmV0dXJuIGZ1bmN0aW9uKGIsYyl7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wiKXtjPWI7Yj1cIipcIn1pZihmLmlzRnVuY3Rpb24oYykpe3ZhciBkPWIudG9Mb3dlckNhc2UoKS5zcGxpdCh1KSxlPTAsZz1kLmxlbmd0aCxoLGksajtmb3IoO2U8ZztlKyspe2g9ZFtlXTtqPS9eXFwrLy50ZXN0KGgpO2lmKGope2g9aC5zdWJzdHIoMSl8fFwiKlwifWk9YVtoXT1hW2hdfHxbXTtpW2o/XCJ1bnNoaWZ0XCI6XCJwdXNoXCJdKGMpfX19fXZhciBjPWEuZG9jdW1lbnQsZD1hLm5hdmlnYXRvcixlPWEubG9jYXRpb247dmFyIGY9ZnVuY3Rpb24oKXtmdW5jdGlvbiBKKCl7aWYoZS5pc1JlYWR5KXtyZXR1cm59dHJ5e2MuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsKFwibGVmdFwiKX1jYXRjaChhKXtzZXRUaW1lb3V0KEosMSk7cmV0dXJufWUucmVhZHkoKX12YXIgZT1mdW5jdGlvbihhLGIpe3JldHVybiBuZXcgZS5mbi5pbml0KGEsYixoKX0sZj1hLmpRdWVyeSxnPWEuJCxoLGk9L14oPzpbXjxdKig8W1xcd1xcV10rPilbXj5dKiR8IyhbXFx3XFwtXSopJCkvLGo9L1xcUy8saz0vXlxccysvLGw9L1xccyskLyxtPS9cXGQvLG49L148KFxcdyspXFxzKlxcLz8+KD86PFxcL1xcMT4pPyQvLG89L15bXFxdLDp7fVxcc10qJC8scD0vXFxcXCg/OltcIlxcXFxcXC9iZm5ydF18dVswLTlhLWZBLUZdezR9KS9nLHE9L1wiW15cIlxcXFxcXG5cXHJdKlwifHRydWV8ZmFsc2V8bnVsbHwtP1xcZCsoPzpcXC5cXGQqKT8oPzpbZUVdWytcXC1dP1xcZCspPy9nLHI9Lyg/Ol58OnwsKSg/OlxccypcXFspKy9nLHM9Lyh3ZWJraXQpWyBcXC9dKFtcXHcuXSspLyx0PS8ob3BlcmEpKD86Lip2ZXJzaW9uKT9bIFxcL10oW1xcdy5dKykvLHU9Lyhtc2llKSAoW1xcdy5dKykvLHY9Lyhtb3ppbGxhKSg/Oi4qPyBydjooW1xcdy5dKykpPy8sdz0vLShbYS16XSkvaWcseD1mdW5jdGlvbihhLGIpe3JldHVybiBiLnRvVXBwZXJDYXNlKCl9LHk9ZC51c2VyQWdlbnQseixBLEIsQz1PYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLEQ9T2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSxFPUFycmF5LnByb3RvdHlwZS5wdXNoLEY9QXJyYXkucHJvdG90eXBlLnNsaWNlLEc9U3RyaW5nLnByb3RvdHlwZS50cmltLEg9QXJyYXkucHJvdG90eXBlLmluZGV4T2YsST17fTtlLmZuPWUucHJvdG90eXBlPXtjb25zdHJ1Y3RvcjplLGluaXQ6ZnVuY3Rpb24oYSxkLGYpe3ZhciBnLGgsaixrO2lmKCFhKXtyZXR1cm4gdGhpc31pZihhLm5vZGVUeXBlKXt0aGlzLmNvbnRleHQ9dGhpc1swXT1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYoYT09PVwiYm9keVwiJiYhZCYmYy5ib2R5KXt0aGlzLmNvbnRleHQ9Yzt0aGlzWzBdPWMuYm9keTt0aGlzLnNlbGVjdG9yPWE7dGhpcy5sZW5ndGg9MTtyZXR1cm4gdGhpc31pZih0eXBlb2YgYT09PVwic3RyaW5nXCIpe2lmKGEuY2hhckF0KDApPT09XCI8XCImJmEuY2hhckF0KGEubGVuZ3RoLTEpPT09XCI+XCImJmEubGVuZ3RoPj0zKXtnPVtudWxsLGEsbnVsbF19ZWxzZXtnPWkuZXhlYyhhKX1pZihnJiYoZ1sxXXx8IWQpKXtpZihnWzFdKXtkPWQgaW5zdGFuY2VvZiBlP2RbMF06ZDtrPWQ/ZC5vd25lckRvY3VtZW50fHxkOmM7aj1uLmV4ZWMoYSk7aWYoail7aWYoZS5pc1BsYWluT2JqZWN0KGQpKXthPVtjLmNyZWF0ZUVsZW1lbnQoalsxXSldO2UuZm4uYXR0ci5jYWxsKGEsZCx0cnVlKX1lbHNle2E9W2suY3JlYXRlRWxlbWVudChqWzFdKV19fWVsc2V7aj1lLmJ1aWxkRnJhZ21lbnQoW2dbMV1dLFtrXSk7YT0oai5jYWNoZWFibGU/ZS5jbG9uZShqLmZyYWdtZW50KTpqLmZyYWdtZW50KS5jaGlsZE5vZGVzfXJldHVybiBlLm1lcmdlKHRoaXMsYSl9ZWxzZXtoPWMuZ2V0RWxlbWVudEJ5SWQoZ1syXSk7aWYoaCYmaC5wYXJlbnROb2RlKXtpZihoLmlkIT09Z1syXSl7cmV0dXJuIGYuZmluZChhKX10aGlzLmxlbmd0aD0xO3RoaXNbMF09aH10aGlzLmNvbnRleHQ9Yzt0aGlzLnNlbGVjdG9yPWE7cmV0dXJuIHRoaXN9fWVsc2UgaWYoIWR8fGQuanF1ZXJ5KXtyZXR1cm4oZHx8ZikuZmluZChhKX1lbHNle3JldHVybiB0aGlzLmNvbnN0cnVjdG9yKGQpLmZpbmQoYSl9fWVsc2UgaWYoZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gZi5yZWFkeShhKX1pZihhLnNlbGVjdG9yIT09Yil7dGhpcy5zZWxlY3Rvcj1hLnNlbGVjdG9yO3RoaXMuY29udGV4dD1hLmNvbnRleHR9cmV0dXJuIGUubWFrZUFycmF5KGEsdGhpcyl9LHNlbGVjdG9yOlwiXCIsanF1ZXJ5OlwiMS42LjNwcmVcIixsZW5ndGg6MCxzaXplOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubGVuZ3RofSx0b0FycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIEYuY2FsbCh0aGlzLDApfSxnZXQ6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/dGhpcy50b0FycmF5KCk6YTwwP3RoaXNbdGhpcy5sZW5ndGgrYV06dGhpc1thXX0scHVzaFN0YWNrOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD10aGlzLmNvbnN0cnVjdG9yKCk7aWYoZS5pc0FycmF5KGEpKXtFLmFwcGx5KGQsYSl9ZWxzZXtlLm1lcmdlKGQsYSl9ZC5wcmV2T2JqZWN0PXRoaXM7ZC5jb250ZXh0PXRoaXMuY29udGV4dDtpZihiPT09XCJmaW5kXCIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcisodGhpcy5zZWxlY3Rvcj9cIiBcIjpcIlwiKStjfWVsc2UgaWYoYil7ZC5zZWxlY3Rvcj10aGlzLnNlbGVjdG9yK1wiLlwiK2IrXCIoXCIrYytcIilcIn1yZXR1cm4gZH0sZWFjaDpmdW5jdGlvbihhLGIpe3JldHVybiBlLmVhY2godGhpcyxhLGIpfSxyZWFkeTpmdW5jdGlvbihhKXtlLmJpbmRSZWFkeSgpO0EuZG9uZShhKTtyZXR1cm4gdGhpc30sZXE6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT0tMT90aGlzLnNsaWNlKGEpOnRoaXMuc2xpY2UoYSwrYSsxKX0sZmlyc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgwKX0sbGFzdDpmdW5jdGlvbigpe3JldHVybiB0aGlzLmVxKC0xKX0sc2xpY2U6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soRi5hcHBseSh0aGlzLGFyZ3VtZW50cyksXCJzbGljZVwiLEYuY2FsbChhcmd1bWVudHMpLmpvaW4oXCIsXCIpKX0sbWFwOmZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLnB1c2hTdGFjayhlLm1hcCh0aGlzLGZ1bmN0aW9uKGIsYyl7cmV0dXJuIGEuY2FsbChiLGMsYil9KSl9LGVuZDpmdW5jdGlvbigpe3JldHVybiB0aGlzLnByZXZPYmplY3R8fHRoaXMuY29uc3RydWN0b3IobnVsbCl9LHB1c2g6RSxzb3J0OltdLnNvcnQsc3BsaWNlOltdLnNwbGljZX07ZS5mbi5pbml0LnByb3RvdHlwZT1lLmZuO2UuZXh0ZW5kPWUuZm4uZXh0ZW5kPWZ1bmN0aW9uKCl7dmFyIGEsYyxkLGYsZyxoLGk9YXJndW1lbnRzWzBdfHx7fSxqPTEsaz1hcmd1bWVudHMubGVuZ3RoLGw9ZmFsc2U7aWYodHlwZW9mIGk9PT1cImJvb2xlYW5cIil7bD1pO2k9YXJndW1lbnRzWzFdfHx7fTtqPTJ9aWYodHlwZW9mIGkhPT1cIm9iamVjdFwiJiYhZS5pc0Z1bmN0aW9uKGkpKXtpPXt9fWlmKGs9PT1qKXtpPXRoaXM7LS1qfWZvcig7ajxrO2orKyl7aWYoKGE9YXJndW1lbnRzW2pdKSE9bnVsbCl7Zm9yKGMgaW4gYSl7ZD1pW2NdO2Y9YVtjXTtpZihpPT09Zil7Y29udGludWV9aWYobCYmZiYmKGUuaXNQbGFpbk9iamVjdChmKXx8KGc9ZS5pc0FycmF5KGYpKSkpe2lmKGcpe2c9ZmFsc2U7aD1kJiZlLmlzQXJyYXkoZCk/ZDpbXX1lbHNle2g9ZCYmZS5pc1BsYWluT2JqZWN0KGQpP2Q6e319aVtjXT1lLmV4dGVuZChsLGgsZil9ZWxzZSBpZihmIT09Yil7aVtjXT1mfX19fXJldHVybiBpfTtlLmV4dGVuZCh7bm9Db25mbGljdDpmdW5jdGlvbihiKXtpZihhLiQ9PT1lKXthLiQ9Z31pZihiJiZhLmpRdWVyeT09PWUpe2EualF1ZXJ5PWZ9cmV0dXJuIGV9LGlzUmVhZHk6ZmFsc2UscmVhZHlXYWl0OjEsaG9sZFJlYWR5OmZ1bmN0aW9uKGEpe2lmKGEpe2UucmVhZHlXYWl0Kyt9ZWxzZXtlLnJlYWR5KHRydWUpfX0scmVhZHk6ZnVuY3Rpb24oYSl7aWYoYT09PXRydWUmJiEtLWUucmVhZHlXYWl0fHxhIT09dHJ1ZSYmIWUuaXNSZWFkeSl7aWYoIWMuYm9keSl7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1lLmlzUmVhZHk9dHJ1ZTtpZihhIT09dHJ1ZSYmLS1lLnJlYWR5V2FpdD4wKXtyZXR1cm59QS5yZXNvbHZlV2l0aChjLFtlXSk7aWYoZS5mbi50cmlnZ2VyKXtlKGMpLnRyaWdnZXIoXCJyZWFkeVwiKS51bmJpbmQoXCJyZWFkeVwiKX19fSxiaW5kUmVhZHk6ZnVuY3Rpb24oKXtpZihBKXtyZXR1cm59QT1lLl9EZWZlcnJlZCgpO2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1pZihjLmFkZEV2ZW50TGlzdGVuZXIpe2MuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTthLmFkZEV2ZW50TGlzdGVuZXIoXCJsb2FkXCIsZS5yZWFkeSxmYWxzZSl9ZWxzZSBpZihjLmF0dGFjaEV2ZW50KXtjLmF0dGFjaEV2ZW50KFwib25yZWFkeXN0YXRlY2hhbmdlXCIsQik7YS5hdHRhY2hFdmVudChcIm9ubG9hZFwiLGUucmVhZHkpO3ZhciBiPWZhbHNlO3RyeXtiPWEuZnJhbWVFbGVtZW50PT1udWxsfWNhdGNoKGQpe31pZihjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbCYmYil7SigpfX19LGlzRnVuY3Rpb246ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiZnVuY3Rpb25cIn0saXNBcnJheTpBcnJheS5pc0FycmF5fHxmdW5jdGlvbihhKXtyZXR1cm4gZS50eXBlKGEpPT09XCJhcnJheVwifSxpc1dpbmRvdzpmdW5jdGlvbihhKXtyZXR1cm4gYSYmdHlwZW9mIGE9PT1cIm9iamVjdFwiJiZcInNldEludGVydmFsXCJpbiBhfSxpc05hTjpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbHx8IW0udGVzdChhKXx8aXNOYU4oYSl9LHR5cGU6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/U3RyaW5nKGEpOklbQy5jYWxsKGEpXXx8XCJvYmplY3RcIn0saXNQbGFpbk9iamVjdDpmdW5jdGlvbihhKXtpZighYXx8ZS50eXBlKGEpIT09XCJvYmplY3RcInx8YS5ub2RlVHlwZXx8ZS5pc1dpbmRvdyhhKSl7cmV0dXJuIGZhbHNlfWlmKGEuY29uc3RydWN0b3ImJiFELmNhbGwoYSxcImNvbnN0cnVjdG9yXCIpJiYhRC5jYWxsKGEuY29uc3RydWN0b3IucHJvdG90eXBlLFwiaXNQcm90b3R5cGVPZlwiKSl7cmV0dXJuIGZhbHNlfXZhciBjO2ZvcihjIGluIGEpe31yZXR1cm4gYz09PWJ8fEQuY2FsbChhLGMpfSxpc0VtcHR5T2JqZWN0OmZ1bmN0aW9uKGEpe2Zvcih2YXIgYiBpbiBhKXtyZXR1cm4gZmFsc2V9cmV0dXJuIHRydWV9LGVycm9yOmZ1bmN0aW9uKGEpe3Rocm93IGF9LHBhcnNlSlNPTjpmdW5jdGlvbihiKXtpZih0eXBlb2YgYiE9PVwic3RyaW5nXCJ8fCFiKXtyZXR1cm4gbnVsbH1iPWUudHJpbShiKTtpZihhLkpTT04mJmEuSlNPTi5wYXJzZSl7cmV0dXJuIGEuSlNPTi5wYXJzZShiKX1pZihvLnRlc3QoYi5yZXBsYWNlKHAsXCJAXCIpLnJlcGxhY2UocSxcIl1cIikucmVwbGFjZShyLFwiXCIpKSl7cmV0dXJuKG5ldyBGdW5jdGlvbihcInJldHVybiBcIitiKSkoKX1lLmVycm9yKFwiSW52YWxpZCBKU09OOiBcIitiKX0scGFyc2VYTUw6ZnVuY3Rpb24oYyl7dmFyIGQsZjt0cnl7aWYoYS5ET01QYXJzZXIpe2Y9bmV3IERPTVBhcnNlcjtkPWYucGFyc2VGcm9tU3RyaW5nKGMsXCJ0ZXh0L3htbFwiKX1lbHNle2Q9bmV3IEFjdGl2ZVhPYmplY3QoXCJNaWNyb3NvZnQuWE1MRE9NXCIpO2QuYXN5bmM9XCJmYWxzZVwiO2QubG9hZFhNTChjKX19Y2F0Y2goZyl7ZD1ifWlmKCFkfHwhZC5kb2N1bWVudEVsZW1lbnR8fGQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoXCJwYXJzZXJlcnJvclwiKS5sZW5ndGgpe2UuZXJyb3IoXCJJbnZhbGlkIFhNTDogXCIrYyl9cmV0dXJuIGR9LG5vb3A6ZnVuY3Rpb24oKXt9LGdsb2JhbEV2YWw6ZnVuY3Rpb24oYil7aWYoYiYmai50ZXN0KGIpKXsoYS5leGVjU2NyaXB0fHxmdW5jdGlvbihiKXthW1wiZXZhbFwiXS5jYWxsKGEsYil9KShiKX19LGNhbWVsQ2FzZTpmdW5jdGlvbihhKXtyZXR1cm4gYS5yZXBsYWNlKHcseCl9LG5vZGVOYW1lOmZ1bmN0aW9uKGEsYil7cmV0dXJuIGEubm9kZU5hbWUmJmEubm9kZU5hbWUudG9VcHBlckNhc2UoKT09PWIudG9VcHBlckNhc2UoKX0sZWFjaDpmdW5jdGlvbihhLGMsZCl7dmFyIGYsZz0wLGg9YS5sZW5ndGgsaT1oPT09Ynx8ZS5pc0Z1bmN0aW9uKGEpO2lmKGQpe2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuYXBwbHkoYVtmXSxkKT09PWZhbHNlKXticmVha319fWVsc2V7Zm9yKDtnPGg7KXtpZihjLmFwcGx5KGFbZysrXSxkKT09PWZhbHNlKXticmVha319fX1lbHNle2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuY2FsbChhW2ZdLGYsYVtmXSk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5jYWxsKGFbZ10sZyxhW2crK10pPT09ZmFsc2Upe2JyZWFrfX19fXJldHVybiBhfSx0cmltOkc/ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/XCJcIjpHLmNhbGwoYSl9OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6YS50b1N0cmluZygpLnJlcGxhY2UoayxcIlwiKS5yZXBsYWNlKGwsXCJcIil9LG1ha2VBcnJheTpmdW5jdGlvbihhLGIpe3ZhciBjPWJ8fFtdO2lmKGEhPW51bGwpe3ZhciBkPWUudHlwZShhKTtpZihhLmxlbmd0aD09bnVsbHx8ZD09PVwic3RyaW5nXCJ8fGQ9PT1cImZ1bmN0aW9uXCJ8fGQ9PT1cInJlZ2V4cFwifHxlLmlzV2luZG93KGEpKXtFLmNhbGwoYyxhKX1lbHNle2UubWVyZ2UoYyxhKX19cmV0dXJuIGN9LGluQXJyYXk6ZnVuY3Rpb24oYSxiKXtpZihIKXtyZXR1cm4gSC5jYWxsKGIsYSl9Zm9yKHZhciBjPTAsZD1iLmxlbmd0aDtjPGQ7YysrKXtpZihiW2NdPT09YSl7cmV0dXJuIGN9fXJldHVybi0xfSxtZXJnZTpmdW5jdGlvbihhLGMpe3ZhciBkPWEubGVuZ3RoLGU9MDtpZih0eXBlb2YgYy5sZW5ndGg9PT1cIm51bWJlclwiKXtmb3IodmFyIGY9Yy5sZW5ndGg7ZTxmO2UrKyl7YVtkKytdPWNbZV19fWVsc2V7d2hpbGUoY1tlXSE9PWIpe2FbZCsrXT1jW2UrK119fWEubGVuZ3RoPWQ7cmV0dXJuIGF9LGdyZXA6ZnVuY3Rpb24oYSxiLGMpe3ZhciBkPVtdLGU7Yz0hIWM7Zm9yKHZhciBmPTAsZz1hLmxlbmd0aDtmPGc7ZisrKXtlPSEhYihhW2ZdLGYpO2lmKGMhPT1lKXtkLnB1c2goYVtmXSl9fXJldHVybiBkfSxtYXA6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGcsaD1bXSxpPTAsaj1hLmxlbmd0aCxrPWEgaW5zdGFuY2VvZiBlfHxqIT09YiYmdHlwZW9mIGo9PT1cIm51bWJlclwiJiYoaj4wJiZhWzBdJiZhW2otMV18fGo9PT0wfHxlLmlzQXJyYXkoYSkpO2lmKGspe2Zvcig7aTxqO2krKyl7Zj1jKGFbaV0saSxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19ZWxzZXtmb3IoZyBpbiBhKXtmPWMoYVtnXSxnLGQpO2lmKGYhPW51bGwpe2hbaC5sZW5ndGhdPWZ9fX1yZXR1cm4gaC5jb25jYXQuYXBwbHkoW10saCl9LGd1aWQ6MSxwcm94eTpmdW5jdGlvbihhLGMpe2lmKHR5cGVvZiBjPT09XCJzdHJpbmdcIil7dmFyIGQ9YVtjXTtjPWE7YT1kfWlmKCFlLmlzRnVuY3Rpb24oYSkpe3JldHVybiBifXZhciBmPUYuY2FsbChhcmd1bWVudHMsMiksZz1mdW5jdGlvbigpe3JldHVybiBhLmFwcGx5KGMsZi5jb25jYXQoRi5jYWxsKGFyZ3VtZW50cykpKX07Zy5ndWlkPWEuZ3VpZD1hLmd1aWR8fGcuZ3VpZHx8ZS5ndWlkKys7cmV0dXJuIGd9LGFjY2VzczpmdW5jdGlvbihhLGMsZCxmLGcsaCl7dmFyIGk9YS5sZW5ndGg7aWYodHlwZW9mIGM9PT1cIm9iamVjdFwiKXtmb3IodmFyIGogaW4gYyl7ZS5hY2Nlc3MoYSxqLGNbal0sZixnLGQpfXJldHVybiBhfWlmKGQhPT1iKXtmPSFoJiZmJiZlLmlzRnVuY3Rpb24oZCk7Zm9yKHZhciBrPTA7azxpO2srKyl7ZyhhW2tdLGMsZj9kLmNhbGwoYVtrXSxrLGcoYVtrXSxjKSk6ZCxoKX1yZXR1cm4gYX1yZXR1cm4gaT9nKGFbMF0sYyk6Yn0sbm93OmZ1bmN0aW9uKCl7cmV0dXJuKG5ldyBEYXRlKS5nZXRUaW1lKCl9LHVhTWF0Y2g6ZnVuY3Rpb24oYSl7YT1hLnRvTG93ZXJDYXNlKCk7dmFyIGI9cy5leGVjKGEpfHx0LmV4ZWMoYSl8fHUuZXhlYyhhKXx8YS5pbmRleE9mKFwiY29tcGF0aWJsZVwiKTwwJiZ2LmV4ZWMoYSl8fFtdO3JldHVybnticm93c2VyOmJbMV18fFwiXCIsdmVyc2lvbjpiWzJdfHxcIjBcIn19LHN1YjpmdW5jdGlvbigpe2Z1bmN0aW9uIGEoYixjKXtyZXR1cm4gbmV3IGEuZm4uaW5pdChiLGMpfWUuZXh0ZW5kKHRydWUsYSx0aGlzKTthLnN1cGVyY2xhc3M9dGhpczthLmZuPWEucHJvdG90eXBlPXRoaXMoKTthLmZuLmNvbnN0cnVjdG9yPWE7YS5zdWI9dGhpcy5zdWI7YS5mbi5pbml0PWZ1bmN0aW9uIGQoYyxkKXtpZihkJiZkIGluc3RhbmNlb2YgZSYmIShkIGluc3RhbmNlb2YgYSkpe2Q9YShkKX1yZXR1cm4gZS5mbi5pbml0LmNhbGwodGhpcyxjLGQsYil9O2EuZm4uaW5pdC5wcm90b3R5cGU9YS5mbjt2YXIgYj1hKGMpO3JldHVybiBhfSxicm93c2VyOnt9fSk7ZS5lYWNoKFwiQm9vbGVhbiBOdW1iZXIgU3RyaW5nIEZ1bmN0aW9uIEFycmF5IERhdGUgUmVnRXhwIE9iamVjdFwiLnNwbGl0KFwiIFwiKSxmdW5jdGlvbihhLGIpe0lbXCJbb2JqZWN0IFwiK2IrXCJdXCJdPWIudG9Mb3dlckNhc2UoKX0pO3o9ZS51YU1hdGNoKHkpO2lmKHouYnJvd3Nlcil7ZS5icm93c2VyW3ouYnJvd3Nlcl09dHJ1ZTtlLmJyb3dzZXIudmVyc2lvbj16LnZlcnNpb259aWYoZS5icm93c2VyLndlYmtpdCl7ZS5icm93c2VyLnNhZmFyaT10cnVlfWlmKGoudGVzdChcIsKgXCIpKXtrPS9eW1xcc1xceEEwXSsvO2w9L1tcXHNcXHhBMF0rJC99aD1lKGMpO2lmKGMuYWRkRXZlbnRMaXN0ZW5lcil7Qj1mdW5jdGlvbigpe2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTtlLnJlYWR5KCl9fWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Qj1mdW5jdGlvbigpe2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7Yy5kZXRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2UucmVhZHkoKX19fXJldHVybiBlfSgpO3ZhciBnPVwiZG9uZSBmYWlsIGlzUmVzb2x2ZWQgaXNSZWplY3RlZCBwcm9taXNlIHRoZW4gYWx3YXlzIHBpcGVcIi5zcGxpdChcIiBcIiksaD1bXS5zbGljZTtmLmV4dGVuZCh7X0RlZmVycmVkOmZ1bmN0aW9uKCl7dmFyIGE9W10sYixjLGQsZT17ZG9uZTpmdW5jdGlvbigpe2lmKCFkKXt2YXIgYz1hcmd1bWVudHMsZyxoLGksaixrO2lmKGIpe2s9YjtiPTB9Zm9yKGc9MCxoPWMubGVuZ3RoO2c8aDtnKyspe2k9Y1tnXTtqPWYudHlwZShpKTtpZihqPT09XCJhcnJheVwiKXtlLmRvbmUuYXBwbHkoZSxpKX1lbHNlIGlmKGo9PT1cImZ1bmN0aW9uXCIpe2EucHVzaChpKX19aWYoayl7ZS5yZXNvbHZlV2l0aChrWzBdLGtbMV0pfX1yZXR1cm4gdGhpc30scmVzb2x2ZVdpdGg6ZnVuY3Rpb24oZSxmKXtpZighZCYmIWImJiFjKXtmPWZ8fFtdO2M9MTt0cnl7d2hpbGUoYVswXSl7YS5zaGlmdCgpLmFwcGx5KGUsZil9fWZpbmFsbHl7Yj1bZSxmXTtjPTB9fXJldHVybiB0aGlzfSxyZXNvbHZlOmZ1bmN0aW9uKCl7ZS5yZXNvbHZlV2l0aCh0aGlzLGFyZ3VtZW50cyk7cmV0dXJuIHRoaXN9LGlzUmVzb2x2ZWQ6ZnVuY3Rpb24oKXtyZXR1cm4hIShjfHxiKX0sY2FuY2VsOmZ1bmN0aW9uKCl7ZD0xO2E9W107cmV0dXJuIHRoaXN9fTtyZXR1cm4gZX0sRGVmZXJyZWQ6ZnVuY3Rpb24oYSl7dmFyIGI9Zi5fRGVmZXJyZWQoKSxjPWYuX0RlZmVycmVkKCksZDtmLmV4dGVuZChiLHt0aGVuOmZ1bmN0aW9uKGEsYyl7Yi5kb25lKGEpLmZhaWwoYyk7cmV0dXJuIHRoaXN9LGFsd2F5czpmdW5jdGlvbigpe3JldHVybiBiLmRvbmUuYXBwbHkoYixhcmd1bWVudHMpLmZhaWwuYXBwbHkodGhpcyxhcmd1bWVudHMpfSxmYWlsOmMuZG9uZSxyZWplY3RXaXRoOmMucmVzb2x2ZVdpdGgscmVqZWN0OmMucmVzb2x2ZSxpc1JlamVjdGVkOmMuaXNSZXNvbHZlZCxwaXBlOmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuRGVmZXJyZWQoZnVuY3Rpb24oZCl7Zi5lYWNoKHtkb25lOlthLFwicmVzb2x2ZVwiXSxmYWlsOltjLFwicmVqZWN0XCJdfSxmdW5jdGlvbihhLGMpe3ZhciBlPWNbMF0sZz1jWzFdLGg7aWYoZi5pc0Z1bmN0aW9uKGUpKXtiW2FdKGZ1bmN0aW9uKCl7aD1lLmFwcGx5KHRoaXMsYXJndW1lbnRzKTtpZihoJiZmLmlzRnVuY3Rpb24oaC5wcm9taXNlKSl7aC5wcm9taXNlKCkudGhlbihkLnJlc29sdmUsZC5yZWplY3QpfWVsc2V7ZFtnK1wiV2l0aFwiXSh0aGlzPT09Yj9kOnRoaXMsW2hdKX19KX1lbHNle2JbYV0oZFtnXSl9fSl9KS5wcm9taXNlKCl9LHByb21pc2U6ZnVuY3Rpb24oYSl7aWYoYT09bnVsbCl7aWYoZCl7cmV0dXJuIGR9ZD1hPXt9fXZhciBjPWcubGVuZ3RoO3doaWxlKGMtLSl7YVtnW2NdXT1iW2dbY11dfXJldHVybiBhfX0pO2IuZG9uZShjLmNhbmNlbCkuZmFpbChiLmNhbmNlbCk7ZGVsZXRlIGIuY2FuY2VsO2lmKGEpe2EuY2FsbChiLGIpfXJldHVybiBifSx3aGVuOmZ1bmN0aW9uKGEpe2Z1bmN0aW9uIGkoYSl7cmV0dXJuIGZ1bmN0aW9uKGMpe2JbYV09YXJndW1lbnRzLmxlbmd0aD4xP2guY2FsbChhcmd1bWVudHMsMCk6YztpZighLS1lKXtnLnJlc29sdmVXaXRoKGcsaC5jYWxsKGIsMCkpfX19dmFyIGI9YXJndW1lbnRzLGM9MCxkPWIubGVuZ3RoLGU9ZCxnPWQ8PTEmJmEmJmYuaXNGdW5jdGlvbihhLnByb21pc2UpP2E6Zi5EZWZlcnJlZCgpO2lmKGQ+MSl7Zm9yKDtjPGQ7YysrKXtpZihiW2NdJiZmLmlzRnVuY3Rpb24oYltjXS5wcm9taXNlKSl7YltjXS5wcm9taXNlKCkudGhlbihpKGMpLGcucmVqZWN0KX1lbHNley0tZX19aWYoIWUpe2cucmVzb2x2ZVdpdGgoZyxiKX19ZWxzZSBpZihnIT09YSl7Zy5yZXNvbHZlV2l0aChnLGQ/W2FdOltdKX1yZXR1cm4gZy5wcm9taXNlKCl9fSk7Zi5zdXBwb3J0PWYuc3VwcG9ydHx8e307dmFyIGk9LyUyMC9nLGo9L1xcW1xcXSQvLGs9L1xccj9cXG4vZyxsPS8jLiokLyxtPS9eKC4qPyk6WyBcXHRdKihbXlxcclxcbl0qKVxccj8kL21nLG49L14oPzpjb2xvcnxkYXRlfGRhdGV0aW1lfGVtYWlsfGhpZGRlbnxtb250aHxudW1iZXJ8cGFzc3dvcmR8cmFuZ2V8c2VhcmNofHRlbHx0ZXh0fHRpbWV8dXJsfHdlZWspJC9pLG89L14oPzphYm91dHxhcHB8YXBwXFwtc3RvcmFnZXwuK1xcLWV4dGVuc2lvbnxmaWxlfHJlc3x3aWRnZXQpOiQvLHA9L14oPzpHRVR8SEVBRCkkLyxxPS9eXFwvXFwvLyxyPS9cXD8vLHM9LzxzY3JpcHRcXGJbXjxdKig/Oig/ITxcXC9zY3JpcHQ+KTxbXjxdKikqPFxcL3NjcmlwdD4vZ2ksdD0vXig/OnNlbGVjdHx0ZXh0YXJlYSkvaSx1PS9cXHMrLyx2PS8oWz8mXSlfPVteJl0qLyx3PS9eKFtcXHdcXCtcXC5cXC1dKzopKD86XFwvXFwvKFteXFwvPyM6XSopKD86OihcXGQrKSk/KT8vLHg9Zi5mbi5sb2FkLHk9e30sej17fSxBLEI7dHJ5e0E9ZS5ocmVmfWNhdGNoKEMpe0E9Yy5jcmVhdGVFbGVtZW50KFwiYVwiKTtBLmhyZWY9XCJcIjtBPUEuaHJlZn1CPXcuZXhlYyhBLnRvTG93ZXJDYXNlKCkpfHxbXTtmLmZuLmV4dGVuZCh7bG9hZDpmdW5jdGlvbihhLGMsZCl7aWYodHlwZW9mIGEhPT1cInN0cmluZ1wiJiZ4KXtyZXR1cm4geC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9ZWxzZSBpZighdGhpcy5sZW5ndGgpe3JldHVybiB0aGlzfXZhciBlPWEuaW5kZXhPZihcIiBcIik7aWYoZT49MCl7dmFyIGc9YS5zbGljZShlLGEubGVuZ3RoKTthPWEuc2xpY2UoMCxlKX12YXIgaD1cIkdFVFwiO2lmKGMpe2lmKGYuaXNGdW5jdGlvbihjKSl7ZD1jO2M9Yn1lbHNlIGlmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Yz1mLnBhcmFtKGMsZi5hamF4U2V0dGluZ3MudHJhZGl0aW9uYWwpO2g9XCJQT1NUXCJ9fXZhciBpPXRoaXM7Zi5hamF4KHt1cmw6YSx0eXBlOmgsZGF0YVR5cGU6XCJodG1sXCIsZGF0YTpjLGNvbXBsZXRlOmZ1bmN0aW9uKGEsYixjKXtjPWEucmVzcG9uc2VUZXh0O2lmKGEuaXNSZXNvbHZlZCgpKXthLmRvbmUoZnVuY3Rpb24oYSl7Yz1hfSk7aS5odG1sKGc/ZihcIjxkaXY+XCIpLmFwcGVuZChjLnJlcGxhY2UocyxcIlwiKSkuZmluZChnKTpjKX1pZihkKXtpLmVhY2goZCxbYyxiLGFdKX19fSk7cmV0dXJuIHRoaXN9LHNlcmlhbGl6ZTpmdW5jdGlvbigpe3JldHVybiBmLnBhcmFtKHRoaXMuc2VyaWFsaXplQXJyYXkoKSl9LHNlcmlhbGl6ZUFycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubWFwKGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZWxlbWVudHM/Zi5tYWtlQXJyYXkodGhpcy5lbGVtZW50cyk6dGhpc30pLmZpbHRlcihmdW5jdGlvbigpe3JldHVybiB0aGlzLm5hbWUmJiF0aGlzLmRpc2FibGVkJiYodGhpcy5jaGVja2VkfHx0LnRlc3QodGhpcy5ub2RlTmFtZSl8fG4udGVzdCh0aGlzLnR5cGUpKX0pLm1hcChmdW5jdGlvbihhLGIpe3ZhciBjPWYodGhpcykudmFsKCk7cmV0dXJuIGM9PW51bGw/bnVsbDpmLmlzQXJyYXkoYyk/Zi5tYXAoYyxmdW5jdGlvbihhLGMpe3JldHVybntuYW1lOmIubmFtZSx2YWx1ZTphLnJlcGxhY2UoayxcIlxcclxcblwiKX19KTp7bmFtZTpiLm5hbWUsdmFsdWU6Yy5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSkuZ2V0KCl9fSk7Zi5lYWNoKFwiYWpheFN0YXJ0IGFqYXhTdG9wIGFqYXhDb21wbGV0ZSBhamF4RXJyb3IgYWpheFN1Y2Nlc3MgYWpheFNlbmRcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtmLmZuW2JdPWZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLmJpbmQoYixhKX19KTtmLmVhY2goW1wiZ2V0XCIsXCJwb3N0XCJdLGZ1bmN0aW9uKGEsYyl7ZltjXT1mdW5jdGlvbihhLGQsZSxnKXtpZihmLmlzRnVuY3Rpb24oZCkpe2c9Z3x8ZTtlPWQ7ZD1ifXJldHVybiBmLmFqYXgoe3R5cGU6Yyx1cmw6YSxkYXRhOmQsc3VjY2VzczplLGRhdGFUeXBlOmd9KX19KTtmLmV4dGVuZCh7Z2V0U2NyaXB0OmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwic2NyaXB0XCIpfSxnZXRKU09OOmZ1bmN0aW9uKGEsYixjKXtyZXR1cm4gZi5nZXQoYSxiLGMsXCJqc29uXCIpfSxhamF4U2V0dXA6ZnVuY3Rpb24oYSxiKXtpZihiKXtGKGEsZi5hamF4U2V0dGluZ3MpfWVsc2V7Yj1hO2E9Zi5hamF4U2V0dGluZ3N9RihhLGIpO3JldHVybiBhfSxhamF4U2V0dGluZ3M6e3VybDpBLGlzTG9jYWw6by50ZXN0KEJbMV0pLGdsb2JhbDp0cnVlLHR5cGU6XCJHRVRcIixjb250ZW50VHlwZTpcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLHByb2Nlc3NEYXRhOnRydWUsYXN5bmM6dHJ1ZSxhY2NlcHRzOnt4bWw6XCJhcHBsaWNhdGlvbi94bWwsIHRleHQveG1sXCIsaHRtbDpcInRleHQvaHRtbFwiLHRleHQ6XCJ0ZXh0L3BsYWluXCIsanNvbjpcImFwcGxpY2F0aW9uL2pzb24sIHRleHQvamF2YXNjcmlwdFwiLFwiKlwiOlwiKi8qXCJ9LGNvbnRlbnRzOnt4bWw6L3htbC8saHRtbDovaHRtbC8sanNvbjovanNvbi99LHJlc3BvbnNlRmllbGRzOnt4bWw6XCJyZXNwb25zZVhNTFwiLHRleHQ6XCJyZXNwb25zZVRleHRcIn0sY29udmVydGVyczp7XCIqIHRleHRcIjphLlN0cmluZyxcInRleHQgaHRtbFwiOnRydWUsXCJ0ZXh0IGpzb25cIjpmLnBhcnNlSlNPTixcInRleHQgeG1sXCI6Zi5wYXJzZVhNTH0sZmxhdE9wdGlvbnM6e2NvbnRleHQ6dHJ1ZSx1cmw6dHJ1ZX19LGFqYXhQcmVmaWx0ZXI6RCh5KSxhamF4VHJhbnNwb3J0OkQoeiksYWpheDpmdW5jdGlvbihhLGMpe2Z1bmN0aW9uIEsoYSxjLGwsbSl7aWYoRD09PTIpe3JldHVybn1EPTI7aWYoQSl7Y2xlYXJUaW1lb3V0KEEpfXg9YjtzPW18fFwiXCI7Si5yZWFkeVN0YXRlPWE+MD80OjA7dmFyIG4sbyxwLHE9YyxyPWw/SChkLEosbCk6Yix0LHU7aWYoYT49MjAwJiZhPDMwMHx8YT09PTMwNCl7aWYoZC5pZk1vZGlmaWVkKXtpZih0PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJMYXN0LU1vZGlmaWVkXCIpKXtmLmxhc3RNb2RpZmllZFtrXT10fWlmKHU9Si5nZXRSZXNwb25zZUhlYWRlcihcIkV0YWdcIikpe2YuZXRhZ1trXT11fX1pZihhPT09MzA0KXtxPVwibm90bW9kaWZpZWRcIjtuPXRydWV9ZWxzZXt0cnl7bz1JKGQscik7cT1cInN1Y2Nlc3NcIjtuPXRydWV9Y2F0Y2godil7cT1cInBhcnNlcmVycm9yXCI7cD12fX19ZWxzZXtwPXE7aWYoIXF8fGEpe3E9XCJlcnJvclwiO2lmKGE8MCl7YT0wfX19Si5zdGF0dXM9YTtKLnN0YXR1c1RleHQ9XCJcIisoY3x8cSk7aWYobil7aC5yZXNvbHZlV2l0aChlLFtvLHEsSl0pfWVsc2V7aC5yZWplY3RXaXRoKGUsW0oscSxwXSl9Si5zdGF0dXNDb2RlKGopO2o9YjtpZihGKXtnLnRyaWdnZXIoXCJhamF4XCIrKG4/XCJTdWNjZXNzXCI6XCJFcnJvclwiKSxbSixkLG4/bzpwXSl9aS5yZXNvbHZlV2l0aChlLFtKLHFdKTtpZihGKXtnLnRyaWdnZXIoXCJhamF4Q29tcGxldGVcIixbSixkXSk7aWYoIS0tZi5hY3RpdmUpe2YuZXZlbnQudHJpZ2dlcihcImFqYXhTdG9wXCIpfX19aWYodHlwZW9mIGE9PT1cIm9iamVjdFwiKXtjPWE7YT1ifWM9Y3x8e307dmFyIGQ9Zi5hamF4U2V0dXAoe30sYyksZT1kLmNvbnRleHR8fGQsZz1lIT09ZCYmKGUubm9kZVR5cGV8fGUgaW5zdGFuY2VvZiBmKT9mKGUpOmYuZXZlbnQsaD1mLkRlZmVycmVkKCksaT1mLl9EZWZlcnJlZCgpLGo9ZC5zdGF0dXNDb2RlfHx7fSxrLG49e30sbz17fSxzLHQseCxBLEMsRD0wLEYsRyxKPXtyZWFkeVN0YXRlOjAsc2V0UmVxdWVzdEhlYWRlcjpmdW5jdGlvbihhLGIpe2lmKCFEKXt2YXIgYz1hLnRvTG93ZXJDYXNlKCk7YT1vW2NdPW9bY118fGE7blthXT1ifXJldHVybiB0aGlzfSxnZXRBbGxSZXNwb25zZUhlYWRlcnM6ZnVuY3Rpb24oKXtyZXR1cm4gRD09PTI/czpudWxsfSxnZXRSZXNwb25zZUhlYWRlcjpmdW5jdGlvbihhKXt2YXIgYztpZihEPT09Mil7aWYoIXQpe3Q9e307d2hpbGUoYz1tLmV4ZWMocykpe3RbY1sxXS50b0xvd2VyQ2FzZSgpXT1jWzJdfX1jPXRbYS50b0xvd2VyQ2FzZSgpXX1yZXR1cm4gYz09PWI/bnVsbDpjfSxvdmVycmlkZU1pbWVUeXBlOmZ1bmN0aW9uKGEpe2lmKCFEKXtkLm1pbWVUeXBlPWF9cmV0dXJuIHRoaXN9LGFib3J0OmZ1bmN0aW9uKGEpe2E9YXx8XCJhYm9ydFwiO2lmKHgpe3guYWJvcnQoYSl9SygwLGEpO3JldHVybiB0aGlzfX07aC5wcm9taXNlKEopO0ouc3VjY2Vzcz1KLmRvbmU7Si5lcnJvcj1KLmZhaWw7Si5jb21wbGV0ZT1pLmRvbmU7Si5zdGF0dXNDb2RlPWZ1bmN0aW9uKGEpe2lmKGEpe3ZhciBiO2lmKEQ8Mil7Zm9yKGIgaW4gYSl7altiXT1baltiXSxhW2JdXX19ZWxzZXtiPWFbSi5zdGF0dXNdO0oudGhlbihiLGIpfX1yZXR1cm4gdGhpc307ZC51cmw9KChhfHxkLnVybCkrXCJcIikucmVwbGFjZShsLFwiXCIpLnJlcGxhY2UocSxCWzFdK1wiLy9cIik7ZC5kYXRhVHlwZXM9Zi50cmltKGQuZGF0YVR5cGV8fFwiKlwiKS50b0xvd2VyQ2FzZSgpLnNwbGl0KHUpO2lmKGQuY3Jvc3NEb21haW49PW51bGwpe0M9dy5leGVjKGQudXJsLnRvTG93ZXJDYXNlKCkpO2QuY3Jvc3NEb21haW49ISEoQyYmKENbMV0hPUJbMV18fENbMl0hPUJbMl18fChDWzNdfHwoQ1sxXT09PVwiaHR0cDpcIj84MDo0NDMpKSE9KEJbM118fChCWzFdPT09XCJodHRwOlwiPzgwOjQ0MykpKSl9aWYoZC5kYXRhJiZkLnByb2Nlc3NEYXRhJiZ0eXBlb2YgZC5kYXRhIT09XCJzdHJpbmdcIil7ZC5kYXRhPWYucGFyYW0oZC5kYXRhLGQudHJhZGl0aW9uYWwpfUUoeSxkLGMsSik7aWYoRD09PTIpe3JldHVybiBmYWxzZX1GPWQuZ2xvYmFsO2QudHlwZT1kLnR5cGUudG9VcHBlckNhc2UoKTtkLmhhc0NvbnRlbnQ9IXAudGVzdChkLnR5cGUpO2lmKEYmJmYuYWN0aXZlKys9PT0wKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RhcnRcIil9aWYoIWQuaGFzQ29udGVudCl7aWYoZC5kYXRhKXtkLnVybCs9KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK2QuZGF0YTtkZWxldGUgZC5kYXRhfWs9ZC51cmw7aWYoZC5jYWNoZT09PWZhbHNlKXt2YXIgTD1mLm5vdygpLE09ZC51cmwucmVwbGFjZSh2LFwiJDFfPVwiK0wpO2QudXJsPU0rKE09PT1kLnVybD8oci50ZXN0KGQudXJsKT9cIiZcIjpcIj9cIikrXCJfPVwiK0w6XCJcIil9fWlmKGQuZGF0YSYmZC5oYXNDb250ZW50JiZkLmNvbnRlbnRUeXBlIT09ZmFsc2V8fGMuY29udGVudFR5cGUpe0ouc2V0UmVxdWVzdEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLGQuY29udGVudFR5cGUpfWlmKGQuaWZNb2RpZmllZCl7az1rfHxkLnVybDtpZihmLmxhc3RNb2RpZmllZFtrXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTW9kaWZpZWQtU2luY2VcIixmLmxhc3RNb2RpZmllZFtrXSl9aWYoZi5ldGFnW2tdKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJJZi1Ob25lLU1hdGNoXCIsZi5ldGFnW2tdKX19Si5zZXRSZXF1ZXN0SGVhZGVyKFwiQWNjZXB0XCIsZC5kYXRhVHlwZXNbMF0mJmQuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0/ZC5hY2NlcHRzW2QuZGF0YVR5cGVzWzBdXSsoZC5kYXRhVHlwZXNbMF0hPT1cIipcIj9cIiwgKi8qOyBxPTAuMDFcIjpcIlwiKTpkLmFjY2VwdHNbXCIqXCJdKTtmb3IoRyBpbiBkLmhlYWRlcnMpe0ouc2V0UmVxdWVzdEhlYWRlcihHLGQuaGVhZGVyc1tHXSl9aWYoZC5iZWZvcmVTZW5kJiYoZC5iZWZvcmVTZW5kLmNhbGwoZSxKLGQpPT09ZmFsc2V8fEQ9PT0yKSl7Si5hYm9ydCgpO3JldHVybiBmYWxzZX1mb3IoRyBpbntzdWNjZXNzOjEsZXJyb3I6MSxjb21wbGV0ZToxfSl7SltHXShkW0ddKX14PUUoeixkLGMsSik7aWYoIXgpe0soLTEsXCJObyBUcmFuc3BvcnRcIil9ZWxzZXtKLnJlYWR5U3RhdGU9MTtpZihGKXtnLnRyaWdnZXIoXCJhamF4U2VuZFwiLFtKLGRdKX1pZihkLmFzeW5jJiZkLnRpbWVvdXQ+MCl7QT1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7Si5hYm9ydChcInRpbWVvdXRcIil9LGQudGltZW91dCl9dHJ5e0Q9MTt4LnNlbmQobixLKX1jYXRjaChOKXtpZihEPDIpe0soLTEsTil9ZWxzZXtmLmVycm9yKE4pfX19cmV0dXJuIEp9LHBhcmFtOmZ1bmN0aW9uKGEsYyl7dmFyIGQ9W10sZT1mdW5jdGlvbihhLGIpe2I9Zi5pc0Z1bmN0aW9uKGIpP2IoKTpiO2RbZC5sZW5ndGhdPWVuY29kZVVSSUNvbXBvbmVudChhKStcIj1cIitlbmNvZGVVUklDb21wb25lbnQoYil9O2lmKGM9PT1iKXtjPWYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsfWlmKGYuaXNBcnJheShhKXx8YS5qcXVlcnkmJiFmLmlzUGxhaW5PYmplY3QoYSkpe2YuZWFjaChhLGZ1bmN0aW9uKCl7ZSh0aGlzLm5hbWUsdGhpcy52YWx1ZSl9KX1lbHNle2Zvcih2YXIgZyBpbiBhKXtHKGcsYVtnXSxjLGUpfX1yZXR1cm4gZC5qb2luKFwiJlwiKS5yZXBsYWNlKGksXCIrXCIpfX0pO2YuZXh0ZW5kKHthY3RpdmU6MCxsYXN0TW9kaWZpZWQ6e30sZXRhZzp7fX0pO3ZhciBKPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe2Zvcih2YXIgYSBpbiBMKXtMW2FdKDAsMSl9fTpmYWxzZSxLPTAsTDtmLmFqYXhTZXR0aW5ncy54aHI9YS5BY3RpdmVYT2JqZWN0P2Z1bmN0aW9uKCl7cmV0dXJuIXRoaXMuaXNMb2NhbCYmTSgpfHxOKCl9Ok07KGZ1bmN0aW9uKGEpe2YuZXh0ZW5kKGYuc3VwcG9ydCx7YWpheDohIWEsY29yczohIWEmJlwid2l0aENyZWRlbnRpYWxzXCJpbiBhfSl9KShmLmFqYXhTZXR0aW5ncy54aHIoKSk7aWYoZi5zdXBwb3J0LmFqYXgpe2YuYWpheFRyYW5zcG9ydChmdW5jdGlvbihjKXtpZighYy5jcm9zc0RvbWFpbnx8Zi5zdXBwb3J0LmNvcnMpe3ZhciBkO3JldHVybntzZW5kOmZ1bmN0aW9uKGUsZyl7dmFyIGg9Yy54aHIoKSxpLGo7aWYoYy51c2VybmFtZSl7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jLGMudXNlcm5hbWUsYy5wYXNzd29yZCl9ZWxzZXtoLm9wZW4oYy50eXBlLGMudXJsLGMuYXN5bmMpfWlmKGMueGhyRmllbGRzKXtmb3IoaiBpbiBjLnhockZpZWxkcyl7aFtqXT1jLnhockZpZWxkc1tqXX19aWYoYy5taW1lVHlwZSYmaC5vdmVycmlkZU1pbWVUeXBlKXtoLm92ZXJyaWRlTWltZVR5cGUoYy5taW1lVHlwZSl9aWYoIWMuY3Jvc3NEb21haW4mJiFlW1wiWC1SZXF1ZXN0ZWQtV2l0aFwiXSl7ZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl09XCJYTUxIdHRwUmVxdWVzdFwifXRyeXtmb3IoaiBpbiBlKXtoLnNldFJlcXVlc3RIZWFkZXIoaixlW2pdKX19Y2F0Y2goayl7fWguc2VuZChjLmhhc0NvbnRlbnQmJmMuZGF0YXx8bnVsbCk7ZD1mdW5jdGlvbihhLGUpe3ZhciBqLGssbCxtLG47dHJ5e2lmKGQmJihlfHxoLnJlYWR5U3RhdGU9PT00KSl7ZD1iO2lmKGkpe2gub25yZWFkeXN0YXRlY2hhbmdlPWYubm9vcDtpZihKKXtkZWxldGUgTFtpXX19aWYoZSl7aWYoaC5yZWFkeVN0YXRlIT09NCl7aC5hYm9ydCgpfX1lbHNle2o9aC5zdGF0dXM7bD1oLmdldEFsbFJlc3BvbnNlSGVhZGVycygpO209e307bj1oLnJlc3BvbnNlWE1MO2lmKG4mJm4uZG9jdW1lbnRFbGVtZW50KXttLnhtbD1ufW0udGV4dD1oLnJlc3BvbnNlVGV4dDt0cnl7az1oLnN0YXR1c1RleHR9Y2F0Y2gobyl7az1cIlwifWlmKCFqJiZjLmlzTG9jYWwmJiFjLmNyb3NzRG9tYWluKXtqPW0udGV4dD8yMDA6NDA0fWVsc2UgaWYoaj09PTEyMjMpe2o9MjA0fX19fWNhdGNoKHApe2lmKCFlKXtnKC0xLHApfX1pZihtKXtnKGosayxtLGwpfX07aWYoIWMuYXN5bmN8fGgucmVhZHlTdGF0ZT09PTQpe2QoKX1lbHNle2k9KytLO2lmKEope2lmKCFMKXtMPXt9O2YoYSkudW5sb2FkKEopfUxbaV09ZH1oLm9ucmVhZHlzdGF0ZWNoYW5nZT1kfX0sYWJvcnQ6ZnVuY3Rpb24oKXtpZihkKXtkKDAsMSl9fX19fSl9Zi5hamF4U2V0dGluZ3MuZ2xvYmFsPWZhbHNlO2EualF1ZXJ5PWEuJD1mfSkoZ2xvYmFsKX0iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCQU0gZm9ybWF0OiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcbnZhciBQYWlyZWRJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL1BhaXJlZEludGVydmFsVHJlZS5qcycpLlBhaXJlZEludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxudmFyIEJhbUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjaHJvbW9zb21lczogJycsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3I6ICcxODgsMTg4LDE4OCcsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiAyMDAwLCBwYWNrOiAyMDAwfSxcbiAgICAvLyBJZiBhIG51Y2xlb3RpZGUgZGlmZmVycyBmcm9tIHRoZSByZWZlcmVuY2Ugc2VxdWVuY2UgaW4gZ3JlYXRlciB0aGFuIDIwJSBvZiBxdWFsaXR5IHdlaWdodGVkIHJlYWRzLCBcbiAgICAvLyBJR1YgY29sb3JzIHRoZSBiYXIgaW4gcHJvcG9ydGlvbiB0byB0aGUgcmVhZCBjb3VudCBvZiBlYWNoIGJhc2U7IHRoZSBmb2xsb3dpbmcgY2hhbmdlcyB0aGF0IHRocmVzaG9sZCBmb3IgY2hyb21vem9vbVxuICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQ6IDAuMixcbiAgICBvcHRpbWFsRmV0Y2hXaW5kb3c6IDAsXG4gICAgbWF4RmV0Y2hXaW5kb3c6IDAsXG4gICAgLy8gVGhlIGZvbGxvd2luZyBjYW4gYmUgXCJlbnNlbWJsX3Vjc2NcIiBvciBcInVjc2NfZW5zZW1ibFwiIHRvIGF0dGVtcHQgYXV0by1jcm9zc21hcHBpbmcgb2YgcmVmZXJlbmNlIGNvbnRpZyBuYW1lc1xuICAgIC8vIGJldHdlZW4gdGhlIHR3byBzY2hlbWVzLCB3aGljaCBJR1YgZG9lcywgYnV0IGlzIGEgcGVyZW5uaWFsIGlzc3VlOiBodHRwczovL3d3dy5iaW9zdGFycy5vcmcvcC8xMDA2Mi9cbiAgICAvLyBJIGhvcGUgbm90IHRvIG5lZWQgYWxsIHRoZSBtYXBwaW5ncyBpbiBoZXJlIGh0dHBzOi8vZ2l0aHViLmNvbS9kcHJ5YW43OS9DaHJvbW9zb21lTWFwcGluZ3MgYnV0IGl0IG1heSBiZSBuZWNlc3NhcnlcbiAgICBjb252ZXJ0Q2hyU2NoZW1lOiBudWxsLFxuICAgIC8vIERyYXcgcGFpcmVkIGVuZHMgd2l0aGluIGEgcmFuZ2Ugb2YgZXhwZWN0ZWQgaW5zZXJ0IHNpemVzIGFzIGEgY29udGludW91cyBmZWF0dXJlP1xuICAgIC8vIFNlZSBodHRwczovL3d3dy5icm9hZGluc3RpdHV0ZS5vcmcvaWd2L0FsaWdubWVudERhdGEjcGFpcmVkIGZvciBob3cgdGhpcyB3b3Jrc1xuICAgIHZpZXdBc1BhaXJzOiBmYWxzZVxuICB9LFxuICBcbiAgLy8gVGhlIEZMQUcgY29sdW1uIGZvciBCQU0vU0FNIGlzIGEgY29tYmluYXRpb24gb2YgYml0d2lzZSBmbGFnc1xuICBmbGFnczoge1xuICAgIGlzUmVhZFBhaXJlZDogMHgxLFxuICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogMHgyLFxuICAgIGlzUmVhZFVubWFwcGVkOiAweDQsXG4gICAgaXNNYXRlVW5tYXBwZWQ6IDB4OCxcbiAgICByZWFkU3RyYW5kUmV2ZXJzZTogMHgxMCxcbiAgICBtYXRlU3RyYW5kUmV2ZXJzZTogMHgyMCxcbiAgICBpc1JlYWRGaXJzdE9mUGFpcjogMHg0MCxcbiAgICBpc1JlYWRMYXN0T2ZQYWlyOiAweDgwLFxuICAgIGlzVGhpc0FsaWdubWVudFByaW1hcnk6IDB4MTAwLFxuICAgIGlzUmVhZEZhaWxpbmdWZW5kb3JRQzogMHgyMDAsXG4gICAgaXNEdXBsaWNhdGVSZWFkOiAweDQwMCxcbiAgICBpc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQ6IDB4ODAwXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGJyb3dzZXJDaHJzID0gXy5rZXlzKHRoaXMuYnJvd3Nlck9wdHMpO1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgQkFNIHRyYWNrIGF0IFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLmJyb3dzZXJDaHJTY2hlbWUgPSB0aGlzLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoXy5rZXlzKHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zKSk7XG4gIH0sXG4gIFxuICBndWVzc0NoclNjaGVtZTogZnVuY3Rpb24oY2hycykge1xuICAgIGxpbWl0ID0gTWF0aC5taW4oY2hycy5sZW5ndGggKiAwLjgsIDIwKTtcbiAgICBpZiAoXy5maWx0ZXIoY2hycywgZnVuY3Rpb24oY2hyKSB7IHJldHVybiAoL15jaHIvKS50ZXN0KGNocik7IH0pLmxlbmd0aCA+IGxpbWl0KSB7IHJldHVybiAndWNzYyc7IH1cbiAgICBpZiAoXy5maWx0ZXIoY2hycywgZnVuY3Rpb24oY2hyKSB7IHJldHVybiAoL15cXGRcXGQ/JC8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICdlbnNlbWJsJzsgfVxuICAgIHJldHVybiBudWxsO1xuICB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBjYWNoZSA9IG5ldyBQYWlyZWRJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JhbS5waHAnLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lKSB7XG4gICAgICAgIGNhc2UgJ2Vuc2VtYmxfdWNzYyc6IHJhbmdlID0gXy5tYXAocmFuZ2UsIGZ1bmN0aW9uKHIpIHsgcmV0dXJuIHIucmVwbGFjZSgvXmNoci8sICcnKTsgfSk7IGJyZWFrO1xuICAgICAgICBjYXNlICd1Y3NjX2Vuc2VtYmwnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL14oXFxkXFxkP3xYKTovLCAnY2hyJDE6Jyk7IH0pOyBicmVhaztcbiAgICAgIH1cbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgdmFyIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID49IDI7IH0pO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFBhcnNlIHRoZSBTQU0gZm9ybWF0IGludG8gaW50ZXJ2YWxzIHRoYXQgY2FuIGJlIGluc2VydGVkIGludG8gdGhlIEludGVydmFsVHJlZSBjYWNoZVxuICAgICAgICAgIHZhciBpbnRlcnZhbHMgPSBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gc2VsZi50eXBlKCdiYW0nKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsKTsgfSk7XG4gICAgICAgICAgc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhID0ge2NhY2hlOiBjYWNoZSwgcmVtb3RlOiByZW1vdGUsIHBpbGV1cDoge30sIGluZm86IHt9fTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDI0LCBzdGFydDogMjR9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHNlbGYubm9BcmVhTGFiZWxzID0gdHJ1ZTtcbiAgICBzZWxmLmV4cGVjdHNTZXF1ZW5jZSA9IHRydWU7XG4gICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrcyA9IHt9O1xuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJhbSAoZS5nLiBgc2FtdG9vbHMgaWR4c3RhdHNgLCB1c2UgbWFwcGVkIHJlYWRzIHBlciByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgICAvLyB0byBlc3RpbWF0ZSBtYXhGZXRjaFdpbmRvdyBhbmQgb3B0aW1hbEZldGNoV2luZG93LCBhbmQgc2V0dXAgYmlubmluZyBvbiB0aGUgUmVtb3RlVHJhY2suXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHt1cmw6IG8uYmlnRGF0YVVybH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciBtYXBwZWRSZWFkcyA9IDAsXG4gICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhvLmRyYXdMaW1pdCkpLFxuICAgICAgICAgIGJhbUNocnMgPSBbXSxcbiAgICAgICAgICBjaHJTY2hlbWUsIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBfLmVhY2goZGF0YS5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgICAgICAgcmVhZHNNYXBwZWRUb0NvbnRpZyA9IHBhcnNlSW50KGZpZWxkc1syXSwgMTApO1xuICAgICAgICAgIGlmIChmaWVsZHMubGVuZ3RoID09IDEgJiYgZmllbGRzWzBdID09ICcnKSB7IHJldHVybjsgfSAvLyBibGFuayBsaW5lXG4gICAgICAgICAgYmFtQ2hycy5wdXNoKGZpZWxkc1swXSk7XG4gICAgICAgICAgaWYgKF8uaXNOYU4ocmVhZHNNYXBwZWRUb0NvbnRpZykpIHsgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBvdXRwdXQgZm9yIHNhbXRvb2xzIGlkeHN0YXRzIG9uIHRoaXMgQkFNIHRyYWNrLlwiKTsgfVxuICAgICAgICAgIG1hcHBlZFJlYWRzICs9IHJlYWRzTWFwcGVkVG9Db250aWc7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8uY2hyU2NoZW1lID0gY2hyU2NoZW1lID0gc2VsZi50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKGJhbUNocnMpO1xuICAgICAgICBpZiAoby5jb252ZXJ0Q2hyU2NoZW1lICE9PSBmYWxzZSAmJiBjaHJTY2hlbWUgJiYgc2VsZi5icm93c2VyQ2hyU2NoZW1lICkge1xuICAgICAgICAgIG8uY29udmVydENoclNjaGVtZSA9IGNoclNjaGVtZSAhPSBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgPyBjaHJTY2hlbWUgKyAnXycgKyBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgOiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwID0gbWVhbkl0ZW1zUGVyQnAgPSBtYXBwZWRSZWFkcyAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZTtcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggPSAxMDA7IC8vIFRPRE86IHRoaXMgaXMgYSB0b3RhbCBndWVzcyBub3csIHNob3VsZCBncmFiIHRoaXMgZnJvbSBzb21lIHNhbXBsZWQgcmVhZHMuXG4gICAgICAgIG8ubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBvLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioby5tYXhGZXRjaFdpbmRvdyAvIDIpO1xuICAgICAgICBcbiAgICAgICAgLy8gVE9ETzogV2UgY2FuIGRlYWN0aXZhdGUgdGhlIHBhaXJpbmcgZnVuY3Rpb25hbGl0eSBvZiB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIFxuICAgICAgICAvLyAgICAgICBpZiB3ZSBkb24ndCBzZWUgYW55IHBhaXJlZCByZWFkcyBpbiB0aGlzIEJBTS5cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIG8ub3B0aW1hbEZldGNoV2luZG93LCBvLm1heEZldGNoV2luZG93KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5mbGFnc1suLi5dIHRvIGEgaHVtYW4gaW50ZXJwcmV0YWJsZSB2ZXJzaW9uIG9mIGZlYXR1cmUuZmxhZyAoZXhwYW5kaW5nIHRoZSBiaXR3aXNlIGZsYWdzKVxuICBwYXJzZUZsYWdzOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHtcbiAgICBmZWF0dXJlLmZsYWdzID0ge307XG4gICAgXy5lYWNoKHRoaXMudHlwZSgnYmFtJykuZmxhZ3MsIGZ1bmN0aW9uKGJpdCwgZmxhZykge1xuICAgICAgZmVhdHVyZS5mbGFnc1tmbGFnXSA9ICEhKGZlYXR1cmUuZmxhZyAmIGJpdCk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuYmxvY2tzIGFuZCBmZWF0dXJlLmVuZCBiYXNlZCBvbiBmZWF0dXJlLmNpZ2FyXG4gIC8vIFNlZSBzZWN0aW9uIDEuNCBvZiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmIGZvciBhbiBleHBsYW5hdGlvbiBvZiBDSUdBUiBcbiAgcGFyc2VDaWdhcjogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7ICAgICAgICBcbiAgICB2YXIgY2lnYXIgPSBmZWF0dXJlLmNpZ2FyLFxuICAgICAgcmVmTGVuID0gMCxcbiAgICAgIHNlcVBvcyA9IDAsXG4gICAgICBvcGVyYXRpb25zLCBsZW5ndGhzO1xuICAgIFxuICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgZmVhdHVyZS5pbnNlcnRpb25zID0gW107XG4gICAgXG4gICAgb3BzID0gY2lnYXIuc3BsaXQoL1xcZCsvKS5zbGljZSgxKTtcbiAgICBsZW5ndGhzID0gY2lnYXIuc3BsaXQoL1tBLVo9XS8pLnNsaWNlKDAsIC0xKTtcbiAgICBpZiAob3BzLmxlbmd0aCAhPSBsZW5ndGhzLmxlbmd0aCkgeyB0aGlzLndhcm4oXCJJbnZhbGlkIENJR0FSICdcIiArIGNpZ2FyICsgXCInIGZvciBcIiArIGZlYXR1cmUuZGVzYyk7IHJldHVybjsgfVxuICAgIGxlbmd0aHMgPSBfLm1hcChsZW5ndGhzLCBwYXJzZUludDEwKTtcbiAgICBcbiAgICBfLmVhY2gob3BzLCBmdW5jdGlvbihvcCwgaSkge1xuICAgICAgdmFyIGxlbiA9IGxlbmd0aHNbaV0sXG4gICAgICAgIGJsb2NrLCBpbnNlcnRpb247XG4gICAgICBpZiAoL15bTVg9XSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIEFsaWdubWVudCBtYXRjaCwgc2VxdWVuY2UgbWF0Y2gsIHNlcXVlbmNlIG1pc21hdGNoXG4gICAgICAgIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVufTtcbiAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBsZW47XG4gICAgICAgIGJsb2NrLnR5cGUgPSBvcDtcbiAgICAgICAgYmxvY2suc2VxID0gZmVhdHVyZS5zZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgcmVmTGVuICs9IGxlbjtcbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAoL15bTkRdJC8udGVzdChvcCkpIHtcbiAgICAgICAgLy8gU2tpcHBlZCByZWZlcmVuY2UgcmVnaW9uLCBkZWxldGlvbiBmcm9tIHJlZmVyZW5jZVxuICAgICAgICByZWZMZW4gKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnSScpIHtcbiAgICAgICAgLy8gSW5zZXJ0aW9uXG4gICAgICAgIGluc2VydGlvbiA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHJlZkxlbiwgZW5kOiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVufTtcbiAgICAgICAgaW5zZXJ0aW9uLnNlcSA9IGZlYXR1cmUuc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5pbnNlcnRpb25zLnB1c2goaW5zZXJ0aW9uKTtcbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ1MnKSB7XG4gICAgICAgIC8vIFNvZnQgY2xpcHBpbmc7IHNpbXBseSBza2lwIHRoZXNlIGJhc2VzIGluIFNFUSwgcG9zaXRpb24gb24gcmVmZXJlbmNlIGlzIHVuY2hhbmdlZC5cbiAgICAgICAgc2VxUG9zICs9IGxlbjtcbiAgICAgIH1cbiAgICAgIC8vIFRoZSBvdGhlciB0d28gQ0lHQVIgb3BzLCBIIGFuZCBQLCBhcmUgbm90IHJlbGV2YW50IHRvIGRyYXdpbmcgYWxpZ25tZW50cy5cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmVuZCA9IGZlYXR1cmUuc3RhcnQgKyByZWZMZW47XG4gIH0sXG4gIFxuICBwYXJzZUxpbmU6IGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29scyA9IFsncW5hbWUnLCAnZmxhZycsICdybmFtZScsICdwb3MnLCAnbWFwcScsICdjaWdhcicsICdybmV4dCcsICdwbmV4dCcsICd0bGVuJywgJ3NlcScsICdxdWFsJ10sXG4gICAgICBmZWF0dXJlID0ge30sXG4gICAgICBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIF8uZWFjaChfLmZpcnN0KGZpZWxkcywgY29scy5sZW5ndGgpLCBmdW5jdGlvbih2LCBpKSB7IGZlYXR1cmVbY29sc1tpXV0gPSB2OyB9KTtcbiAgICAvLyBDb252ZXJ0IGF1dG9tYXRpY2FsbHkgYmV0d2VlbiBFbnNlbWJsIHN0eWxlIDEsIDIsIDMsIFggPC0tPiBVQ1NDIHN0eWxlIGNocjEsIGNocjIsIGNocjMsIGNoclggYXMgY29uZmlndXJlZC9hdXRvZGV0ZWN0ZWRcbiAgICAvLyBOb3RlIHRoYXQgY2hyTSBpcyBOT1QgZXF1aXZhbGVudCB0byBNVCBodHRwczovL3d3dy5iaW9zdGFycy5vcmcvcC8xMjAwNDIvIzEyMDA1OFxuICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lKSB7XG4gICAgICBjYXNlICd1Y3NjX2Vuc2VtYmwnOiBmZWF0dXJlLnJuYW1lID0gZmVhdHVyZS5ybmFtZS5yZXBsYWNlKC9eY2hyLywgJycpOyBicmVhaztcbiAgICAgIGNhc2UgJ2Vuc2VtYmxfdWNzYyc6IGZlYXR1cmUucm5hbWUgPSAoL14oXFxkXFxkP3xYKSQvLnRlc3QoZmVhdHVyZS5ybmFtZSkgPyAnY2hyJyA6ICcnKSArIGZlYXR1cmUucm5hbWU7IGJyZWFrO1xuICAgIH1cbiAgICBmZWF0dXJlLm5hbWUgPSBmZWF0dXJlLnFuYW1lO1xuICAgIGZlYXR1cmUuZmxhZyA9IHBhcnNlSW50MTAoZmVhdHVyZS5mbGFnKTtcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tmZWF0dXJlLnJuYW1lXTtcbiAgICBsaW5lbm8gPSBsaW5lbm8gfHwgMDtcbiAgICBcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7IFxuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBSTkFNRSAnXCIrZmVhdHVyZS5ybmFtZStcIicgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSBpZiAoZmVhdHVyZS5wb3MgPT09ICcwJyB8fCAhZmVhdHVyZS5jaWdhciB8fCBmZWF0dXJlLmNpZ2FyID09ICcqJykge1xuICAgICAgLy8gVW5tYXBwZWQgcmVhZC4gU2luY2Ugd2UgY2FuJ3QgZHJhdyB0aGVzZSBhdCBhbGwsIHdlIGRvbid0IGJvdGhlciBwYXJzaW5nIHRoZW0gZnVydGhlci5cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnBvcyk7ICAvLyBQT1MgaXMgMS1iYXNlZCwgaGVuY2Ugbm8gaW5jcmVtZW50IGFzIGZvciBwYXJzaW5nIEJFRFxuICAgICAgZmVhdHVyZS5kZXNjID0gZmVhdHVyZS5xbmFtZSArICcgYXQgJyArIGZlYXR1cmUucm5hbWUgKyAnOicgKyBmZWF0dXJlLnBvcztcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VGbGFncy5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7XG4gICAgICBmZWF0dXJlLnN0cmFuZCA9IGZlYXR1cmUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnLScgOiAnKyc7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlQ2lnYXIuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pO1xuICAgIH1cbiAgICAvLyBXZSBoYXZlIHRvIGNvbWUgdXAgd2l0aCBzb21ldGhpbmcgdGhhdCBpcyBhIHVuaXF1ZSBsYWJlbCBmb3IgZXZlcnkgbGluZSB0byBkZWR1cGUgcm93cy5cbiAgICAvLyBUaGUgZm9sbG93aW5nIGlzIHRlY2huaWNhbGx5IG5vdCBndWFyYW50ZWVkIGJ5IGEgdmFsaWQgQkFNIChldmVuIGF0IEdBVEsgc3RhbmRhcmRzKSwgYnV0IGl0J3MgdGhlIGJlc3QgSSBnb3QuXG4gICAgZmVhdHVyZS5pZCA9IFtmZWF0dXJlLnFuYW1lLCBmZWF0dXJlLmZsYWcsIGZlYXR1cmUucm5hbWUsIGZlYXR1cmUucG9zLCBmZWF0dXJlLmNpZ2FyXS5qb2luKFwiXFx0XCIpO1xuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuICBcbiAgcGlsZXVwOiBmdW5jdGlvbihpbnRlcnZhbHMsIHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgcGlsZXVwID0gdGhpcy5kYXRhLnBpbGV1cCxcbiAgICAgIHBvc2l0aW9uc1RvQ2FsY3VsYXRlID0ge30sXG4gICAgICBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9IDAsXG4gICAgICBpO1xuICAgIFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIC8vIE5vIG5lZWQgdG8gcGlsZXVwIGFnYWluIG9uIGFscmVhZHktcGlsZWQtdXAgbnVjbGVvdGlkZSBwb3NpdGlvbnNcbiAgICAgIGlmICghcGlsZXVwW2ldKSB7IHBvc2l0aW9uc1RvQ2FsY3VsYXRlW2ldID0gdHJ1ZTsgbnVtUG9zaXRpb25zVG9DYWxjdWxhdGUrKzsgfVxuICAgIH1cbiAgICBpZiAobnVtUG9zaXRpb25zVG9DYWxjdWxhdGUgPT09IDApIHsgcmV0dXJuOyB9IC8vIEFsbCBwb3NpdGlvbnMgYWxyZWFkeSBwaWxlZCB1cCFcbiAgICBcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgXy5lYWNoKGludGVydmFsLmRhdGEuYmxvY2tzLCBmdW5jdGlvbihibG9jaykge1xuICAgICAgICB2YXIgbnQsIGk7XG4gICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIGVuZCk7IGkrKykge1xuICAgICAgICAgIGlmICghcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0pIHsgY29udGludWU7IH1cbiAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICBwaWxldXBbaV0gPSBwaWxldXBbaV0gfHwge0E6IDAsIEM6IDAsIEc6IDAsIFQ6IDAsIE46IDAsIGNvdjogMH07XG4gICAgICAgICAgaWYgKC9bQUNUR05dLy50ZXN0KG50KSkgeyBwaWxldXBbaV1bbnRdICs9IDE7IH1cbiAgICAgICAgICBwaWxldXBbaV0uY292ICs9IDE7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgY292ZXJhZ2U6IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCkge1xuICAgIC8vIENvbXBhcmUgd2l0aCBiaW5uaW5nIG9uIHRoZSBmbHkgaW4gLnR5cGUoJ3dpZ2dsZV8wJykucHJlcmVuZGVyKC4uLilcbiAgICB2YXIgaiA9IHN0YXJ0LFxuICAgICAgdlNjYWxlID0gdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgKiB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCAqIDIsXG4gICAgICBjdXJyID0gdGhpcy5kYXRhLnBpbGV1cFtqXSxcbiAgICAgIGJhcnMgPSBbXSxcbiAgICAgIG5leHQsIGJpbiwgaTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgd2lkdGg7IGkrKykge1xuICAgICAgYmluID0gY3VyciAmJiAoaiArIDEgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci5jb3ZdIDogW107XG4gICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB3aGlsZSAoaiArIDEgPCAoaSArIDEpICogYnBwcCArIHN0YXJ0ICYmIGogKyAyID49IGkgKiBicHBwICsgc3RhcnQpIHsgXG4gICAgICAgIGlmIChuZXh0KSB7IGJpbi5wdXNoKG5leHQuY292KTsgfVxuICAgICAgICArK2o7XG4gICAgICAgIGN1cnIgPSBuZXh0O1xuICAgICAgICBuZXh0ID0gdGhpcy5kYXRhLnBpbGV1cFtqICsgMV07XG4gICAgICB9XG4gICAgICBiYXJzLnB1c2godXRpbHMud2lnQmluRnVuY3Rpb25zLm1heGltdW0oYmluKSAvIHZTY2FsZSk7XG4gICAgfVxuICAgIHJldHVybiBiYXJzO1xuICB9LFxuICBcbiAgYWxsZWxlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICB2U2NhbGUgPSB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbXNQZXJCcCAqIHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtTGVuZ3RoICogMixcbiAgICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQgPSB0aGlzLm9wdHMuYWxsZWxlRnJlcVRocmVzaG9sZCxcbiAgICAgIGFsbGVsZVNwbGl0cyA9IFtdLFxuICAgICAgc3BsaXQsIHJlZk50LCBpLCBwaWxldXBBdFBvcztcbiAgICAgIFxuICAgIGZvciAoaSA9IDA7IGkgPCBzZXF1ZW5jZS5sZW5ndGg7IGkrKykge1xuICAgICAgcmVmTnQgPSBzZXF1ZW5jZVtpXS50b1VwcGVyQ2FzZSgpO1xuICAgICAgcGlsZXVwQXRQb3MgPSBwaWxldXBbc3RhcnQgKyBpXTtcbiAgICAgIGlmIChwaWxldXBBdFBvcyAmJiBwaWxldXBBdFBvcy5jb3YgJiYgcGlsZXVwQXRQb3NbcmVmTnRdIC8gcGlsZXVwQXRQb3MuY292IDwgKDEgLSBhbGxlbGVGcmVxVGhyZXNob2xkKSkge1xuICAgICAgICBzcGxpdCA9IHtcbiAgICAgICAgICB4OiBpIC8gYnBwcCxcbiAgICAgICAgICBzcGxpdHM6IFtdXG4gICAgICAgIH07XG4gICAgICAgIF8uZWFjaChbJ0EnLCAnQycsICdHJywgJ1QnXSwgZnVuY3Rpb24obnQpIHtcbiAgICAgICAgICBpZiAocGlsZXVwQXRQb3NbbnRdID4gMCkgeyBzcGxpdC5zcGxpdHMucHVzaCh7bnQ6IG50LCBoOiBwaWxldXBBdFBvc1tudF0gLyB2U2NhbGV9KTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgYWxsZWxlU3BsaXRzLnB1c2goc3BsaXQpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYWxsZWxlU3BsaXRzO1xuICB9LFxuICBcbiAgbWlzbWF0Y2hlczogZnVuY3Rpb24oc3RhcnQsIHNlcXVlbmNlLCBicHBwLCBpbnRlcnZhbHMsIHdpZHRoLCBsaW5lTnVtKSB7XG4gICAgdmFyIG1pc21hdGNoZXMgPSBbXTtcbiAgICBzZXF1ZW5jZSA9IHNlcXVlbmNlLnRvVXBwZXJDYXNlKCk7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIF8uZWFjaChpbnRlcnZhbC5kYXRhLmJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgdmFyIGxpbmUgPSBsaW5lTnVtKGludGVydmFsLmRhdGEpLFxuICAgICAgICAgIG50LCBpLCB4O1xuICAgICAgICBmb3IgKGkgPSBNYXRoLm1heChibG9jay5zdGFydCwgc3RhcnQpOyBpIDwgTWF0aC5taW4oYmxvY2suZW5kLCBzdGFydCArIHdpZHRoICogYnBwcCk7IGkrKykge1xuICAgICAgICAgIHggPSAoaSAtIHN0YXJ0KSAvIGJwcHA7XG4gICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKG50ICYmIG50ICE9IHNlcXVlbmNlW2kgLSBzdGFydF0gJiYgbGluZSkgeyBtaXNtYXRjaGVzLnB1c2goe3g6IHgsIG50OiBudCwgbGluZTogbGluZX0pOyB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBtaXNtYXRjaGVzO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBzZXF1ZW5jZSA9IHByZWNhbGMuc2VxdWVuY2UsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgdmlld0FzUGFpcnMgPSBzZWxmLm9wdHMudmlld0FzUGFpcnMsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCBhbiBpbnNhbmUgYW1vdW50IG9mIHJvd3MgXG4gICAgLy8gKD41MDAgYWxpZ25tZW50cyksIGFzIHRoaXMgd2lsbCBvbmx5IGhvbGQgdXAgb3RoZXIgcmVxdWVzdHMuXG4gICAgaWYgKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAmJiAoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGZXRjaCBmcm9tIHRoZSBSZW1vdGVUcmFjayBhbmQgY2FsbCB0aGUgYWJvdmUgd2hlbiB0aGUgZGF0YSBpcyBhdmFpbGFibGUuXG4gICAgICBzZWxmLmRhdGEucmVtb3RlLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgdmlld0FzUGFpcnMsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICB2YXIgZHJhd1NwZWMgPSB7c2VxdWVuY2U6ICEhc2VxdWVuY2UsIHdpZHRoOiB3aWR0aH0sIFxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBmYWxzZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW50ZXJ2YWxzLnRvb01hbnkpIHsgcmV0dXJuIGNhbGxiYWNrKGludGVydmFscyk7IH1cblxuICAgICAgICBpZiAoIXNlcXVlbmNlKSB7XG4gICAgICAgICAgLy8gRmlyc3QgZHJhd2luZyBwYXNzLCB3aXRoIGZlYXR1cmVzIHRoYXQgZG9uJ3QgZGVwZW5kIG9uIHNlcXVlbmNlLlxuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykucGlsZXVwLmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCBzdGFydCwgZW5kKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pO1xuICAgICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICAgICAgICAgIGludGVydmFsLmluc2VydGlvblB0cyA9IF8ubWFwKGludGVydmFsLmQuaW5zZXJ0aW9ucywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGRyYXdTcGVjLmNvdmVyYWdlID0gc2VsZi50eXBlKCdiYW0nKS5jb3ZlcmFnZS5jYWxsKHNlbGYsIHN0YXJ0LCB3aWR0aCwgYnBwcCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2Vjb25kIGRyYXdpbmcgcGFzcywgdG8gZHJhdyB0aGluZ3MgdGhhdCBhcmUgZGVwZW5kZW50IG9uIHNlcXVlbmNlLCBsaWtlIG1pc21hdGNoZXMgKHBvdGVudGlhbCBTTlBzKS5cbiAgICAgICAgICBkcmF3U3BlYy5icHBwID0gYnBwcDsgIFxuICAgICAgICAgIC8vIEZpbmQgYWxsZWxlIHNwbGl0cyB3aXRoaW4gdGhlIGNvdmVyYWdlIGdyYXBoLlxuICAgICAgICAgIGRyYXdTcGVjLmFsbGVsZXMgPSBzZWxmLnR5cGUoJ2JhbScpLmFsbGVsZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHApO1xuICAgICAgICAgIC8vIEZpbmQgbWlzbWF0Y2hlcyB3aXRoaW4gZWFjaCBhbGlnbmVkIGJsb2NrLlxuICAgICAgICAgIGRyYXdTcGVjLm1pc21hdGNoZXMgPSBzZWxmLnR5cGUoJ2JhbScpLm1pc21hdGNoZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0pOyAgICAgICAgICAgICAgXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIGNvbnRlbnQgPSB7XG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQucm5hbWUgKyAnOicgKyBkYXRhLmQucG9zLCBcbiAgICAgICAgXCJyZWFkIHN0cmFuZFwiOiBkYXRhLmQuZmxhZ3MucmVhZFN0cmFuZCA/ICcoLSknIDogJygrKScsXG4gICAgICAgIFwibWFwIHF1YWxpdHlcIjogZGF0YS5kLm1hcHFcbiAgICAgIH07XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI2NvdmVyYWdlIGZvciBhbiBpZGVhIG9mIHdoYXQgd2UncmUgaW1pdGF0aW5nXG4gIGRyYXdDb3ZlcmFnZTogZnVuY3Rpb24oY3R4LCBjb3ZlcmFnZSwgaGVpZ2h0KSB7XG4gICAgXy5lYWNoKGNvdmVyYWdlLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGN0eC5maWxsUmVjdCh4LCBNYXRoLm1heChoZWlnaHQgLSAoZCAqIGhlaWdodCksIDApLCAxLCBNYXRoLm1pbihkICogaGVpZ2h0LCBoZWlnaHQpKTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdTdHJhbmRJbmRpY2F0b3I6IGZ1bmN0aW9uKGN0eCwgeCwgYmxvY2tZLCBibG9ja0hlaWdodCwgeFNjYWxlLCBiaWdTdHlsZSkge1xuICAgIHZhciBwcmV2RmlsbFN0eWxlID0gY3R4LmZpbGxTdHlsZTtcbiAgICBpZiAoYmlnU3R5bGUpIHtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZKTtcbiAgICAgIGN0eC5saW5lVG8oeCArICgzICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQvMik7XG4gICAgICBjdHgubGluZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5jbG9zZVBhdGgoKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDE0MCwxNDAsMTQwKSc7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTIgOiAxKSwgYmxvY2tZLCAxLCBibG9ja0hlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTEgOiAwKSwgYmxvY2tZICsgMSwgMSwgYmxvY2tIZWlnaHQgLSAyKTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBwcmV2RmlsbFN0eWxlO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdBbGlnbm1lbnQ6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgZGVsZXRpb25MaW5lV2lkdGggPSAyLFxuICAgICAgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGggPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogbGluZUhlaWdodCkgLSBkZWxldGlvbkxpbmVXaWR0aCAqIDAuNTtcbiAgICBcbiAgICAvLyBEcmF3IHRoZSBsaW5lIHRoYXQgc2hvd3MgdGhlIGZ1bGwgYWxpZ25tZW50LCBpbmNsdWRpbmcgZGVsZXRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9ICdyZ2IoMCwwLDApJztcbiAgICAvLyBOb3RlIHRoYXQgdGhlIFwiLSAxXCIgYmVsb3cgZml4ZXMgcm91bmRpbmcgaXNzdWVzIGJ1dCBnYW1ibGVzIG9uIHRoZXJlIG5ldmVyIGJlaW5nIGEgZGVsZXRpb24gYXQgdGhlIHJpZ2h0IGVkZ2VcbiAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgaGFsZkhlaWdodCwgZGF0YS5wSW50LncgLSAxLCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgIFxuICAgIC8vIERyYXcgdGhlIFttaXNdbWF0Y2ggKE0vWC89KSBibG9ja3NcbiAgICBfLmVhY2goZGF0YS5ibG9ja0ludHMsIGZ1bmN0aW9uKGJJbnQsIGJsb2NrTnVtKSB7XG4gICAgICB2YXIgYmxvY2tZID0gaSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwLzIsXG4gICAgICAgIGJsb2NrSGVpZ2h0ID0gbGluZUhlaWdodCAtIGxpbmVHYXA7XG4gICAgICBcbiAgICAgIC8vIFNraXAgZHJhd2luZyBibG9ja3MgdGhhdCBhcmVuJ3QgaW5zaWRlIHRoZSBjYW52YXNcbiAgICAgIGlmIChiSW50LnggKyBiSW50LncgPCAwIHx8IGJJbnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgXG4gICAgICBpZiAoYmxvY2tOdW0gPT0gMCAmJiBkYXRhLmQuc3RyYW5kID09ICctJyAmJiAhYkludC5vUHJldikge1xuICAgICAgICBjdHguZmlsbFJlY3QoYkludC54ICsgMiwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAtMSwgbGluZUhlaWdodCA+IDYpO1xuICAgICAgfSBlbHNlIGlmIChibG9ja051bSA9PSBkYXRhLmJsb2NrSW50cy5sZW5ndGggLSAxICYmIGRhdGEuZC5zdHJhbmQgPT0gJysnICYmICFiSW50Lm9OZXh0KSB7XG4gICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTdHJhbmRJbmRpY2F0b3IuY2FsbChzZWxmLCBjdHgsIGJJbnQueCArIGJJbnQudywgYmxvY2tZLCBibG9ja0hlaWdodCwgMSwgbGluZUhlaWdodCA+IDYpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncsIGJsb2NrSGVpZ2h0KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBEcmF3IGluc2VydGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoMTE0LDQxLDIxOClcIjtcbiAgICBfLmVhY2goZGF0YS5pbnNlcnRpb25QdHMsIGZ1bmN0aW9uKGluc2VydCkge1xuICAgICAgaWYgKGluc2VydC54ICsgaW5zZXJ0LncgPCAwIHx8IGluc2VydC54ID4gd2lkdGgpIHsgcmV0dXJuOyB9XG4gICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAxLCBpICogbGluZUhlaWdodCwgMiwgbGluZUhlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAyLCBpICogbGluZUhlaWdodCwgNCwgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgpO1xuICAgICAgY3R4LmZpbGxSZWN0KGluc2VydC54IC0gMiwgKGkgKyAxKSAqIGxpbmVIZWlnaHQgLSBpbnNlcnRpb25DYXJldExpbmVXaWR0aCwgNCwgaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd0FsbGVsZXM6IGZ1bmN0aW9uKGN0eCwgYWxsZWxlcywgaGVpZ2h0LCBiYXJXaWR0aCkge1xuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICB5UG9zO1xuICAgIF8uZWFjaChhbGxlbGVzLCBmdW5jdGlvbihhbGxlbGVzRm9yUG9zaXRpb24pIHtcbiAgICAgIHlQb3MgPSBoZWlnaHQ7XG4gICAgICBfLmVhY2goYWxsZWxlc0ZvclBvc2l0aW9uLnNwbGl0cywgZnVuY3Rpb24oc3BsaXQpIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbc3BsaXQubnRdKycpJztcbiAgICAgICAgY3R4LmZpbGxSZWN0KGFsbGVsZXNGb3JQb3NpdGlvbi54LCB5UG9zIC09IChzcGxpdC5oICogaGVpZ2h0KSwgTWF0aC5tYXgoYmFyV2lkdGgsIDEpLCBzcGxpdC5oICogaGVpZ2h0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd01pc21hdGNoOiBmdW5jdGlvbihjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCBwcGJwKSB7XG4gICAgLy8gcHBicCA9PSBwaXhlbHMgcGVyIGJhc2UgcGFpciAoaW52ZXJzZSBvZiBicHBwKVxuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIHlQb3M7XG4gICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbbWlzbWF0Y2gubnRdKycpJztcbiAgICBjdHguZmlsbFJlY3QobWlzbWF0Y2gueCwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0KSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwIC8gMiwgTWF0aC5tYXgocHBicCwgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAvLyBEbyB3ZSBoYXZlIHJvb20gdG8gcHJpbnQgYSB3aG9sZSBsZXR0ZXI/XG4gICAgaWYgKHBwYnAgPiA3ICYmIGxpbmVIZWlnaHQgPiAxMCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMjU1LDI1NSwyNTUpJztcbiAgICAgIGN0eC5maWxsVGV4dChtaXNtYXRjaC5udCwgbWlzbWF0Y2gueCArIHBwYnAgKiAwLjUsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCArIDEpICogbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTQgOiA0LFxuICAgICAgY292SGVpZ2h0ID0gZGVuc2l0eSA9PSAnZGVuc2UnID8gMjQgOiAzOCxcbiAgICAgIGNvdk1hcmdpbiA9IDcsXG4gICAgICBsaW5lT2Zmc2V0ID0gKChjb3ZIZWlnaHQgKyBjb3ZNYXJnaW4pIC8gbGluZUhlaWdodCksIFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgICAgICAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBcbiAgICBpZiAoIWRyYXdTcGVjLnNlcXVlbmNlKSB7XG4gICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICBcbiAgICAgIC8vIElmIG5lY2Vzc2FyeSwgaW5kaWNhdGUgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgIGlmIChkcmF3U3BlYy50b29NYW55IHx8IChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE9ubHkgc3RvcmUgYXJlYXMgZm9yIHRoZSBcInBhY2tcIiBkZW5zaXR5LlxuICAgICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgICAgLy8gU2V0IHRoZSBleHBlY3RlZCBoZWlnaHQgZm9yIHRoZSBjYW52YXMgKHRoaXMgYWxzbyBlcmFzZXMgaXQpLlxuICAgICAgY2FudmFzLmhlaWdodCA9IGNvdkhlaWdodCArICgoZGVuc2l0eSA9PSAnZGVuc2UnKSA/IDAgOiBjb3ZNYXJnaW4gKyBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodCk7XG4gICAgICBcbiAgICAgIC8vIEZpcnN0IGRyYXcgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTU5LDE1OSwxNTkpXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdDb3ZlcmFnZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMuY292ZXJhZ2UsIGNvdkhlaWdodCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAvLyBOb3csIGRyYXcgYWxpZ25tZW50cyBiZWxvdyBpdFxuICAgICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJykge1xuICAgICAgICAvLyBCb3JkZXIgYmV0d2VlbiBjb3ZlcmFnZVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTA5LDEwOSwxMDkpXCI7XG4gICAgICAgIGN0eC5maWxsUmVjdCgwLCBjb3ZIZWlnaHQgKyAxLCBkcmF3U3BlYy53aWR0aCwgMSk7IFxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgaSArPSBsaW5lT2Zmc2V0OyAvLyBoYWNraXNoIG1ldGhvZCBmb3IgbGVhdmluZyBzcGFjZSBhdCB0aGUgdG9wIGZvciB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgLy8gVE9ETzogaW1wbGVtZW50IHNwZWNpYWwgZHJhd2luZyBvZiBhbGlnbm1lbnQgZmVhdHVyZXMsIGZvciBCQU1zLlxuICAgICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3QWxpZ25tZW50LmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCk7ICAgICAgICAgICAgICBcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2U6XG4gICAgICAvLyAoMSkgYWxsZWxlIHNwbGl0cyBvdmVyIGNvdmVyYWdlXG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGxlbGVzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5hbGxlbGVzLCBjb3ZIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIC8vICgyKSBtaXNtYXRjaGVzIG92ZXIgdGhlIGFsaWdubWVudHNcbiAgICAgIGN0eC5mb250ID0gXCIxMnB4ICdNZW5sbycsJ0JpdHN0cmVhbSBWZXJhIFNhbnMgTW9ubycsJ0NvbnNvbGFzJywnTHVjaWRhIENvbnNvbGUnLG1vbm9zcGFjZVwiO1xuICAgICAgY3R4LnRleHRBbGlnbiA9ICdjZW50ZXInO1xuICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdiYXNlbGluZSc7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubWlzbWF0Y2hlcywgZnVuY3Rpb24obWlzbWF0Y2gpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3TWlzbWF0Y2guY2FsbChzZWxmLCBjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgdmFyIGNhbGxiYWNrS2V5ID0gc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5O1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgXG4gICAgICAvLyBIYXZlIHdlIGJlZW4gd2FpdGluZyB0byBkcmF3IHNlcXVlbmNlIGRhdGEgdG9vPyBJZiBzbywgZG8gdGhhdCBub3csIHRvby5cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0pKSB7XG4gICAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKCk7XG4gICAgICAgIGRlbGV0ZSBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgcmVuZGVyU2VxdWVuY2U6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgc2VxdWVuY2UsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIFxuICAgIC8vIElmIHdlIHdlcmVuJ3QgYWJsZSB0byBmZXRjaCBzZXF1ZW5jZSBmb3Igc29tZSByZWFzb24sIHRoZXJlIGlzIG5vIHJlYXNvbiB0byBwcm9jZWVkLlxuICAgIGlmICghc2VxdWVuY2UpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCkge1xuICAgICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGgsIHNlcXVlbmNlOiBzZXF1ZW5jZX0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoZSBjYW52YXMgd2FzIGFscmVhZHkgcmVuZGVyZWQgKGJ5IGxhY2sgb2YgdGhlIGNsYXNzICd1bnJlbmRlcmVkJykuXG4gICAgLy8gSWYgeWVzLCBnbyBhaGVhZCBhbmQgZXhlY3V0ZSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7IGlmIG5vdCwgc2F2ZSBpdCBmb3IgbGF0ZXIuXG4gICAgaWYgKCgnICcgKyBjYW52YXMuY2xhc3NOYW1lICsgJyAnKS5pbmRleE9mKCcgdW5yZW5kZXJlZCAnKSA+IC0xKSB7XG4gICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW3N0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eV0gPSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrO1xuICAgIH0gZWxzZSB7XG4gICAgICByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7XG4gICAgfVxuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJhbUZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCRUQgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8gYmVkRGV0YWlsIGlzIGEgdHJpdmlhbCBleHRlbnNpb24gb2YgQkVEIHRoYXQgaXMgZGVmaW5lZCBzZXBhcmF0ZWx5LFxuLy8gYWx0aG91Z2ggYSBCRUQgZmlsZSB3aXRoID4xMiBjb2x1bW5zIGlzIGFzc3VtZWQgdG8gYmUgYmVkRGV0YWlsIHRyYWNrIHJlZ2FyZGxlc3Mgb2YgdHlwZS5cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2ssXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIExpbmVNYXNrID0gcmVxdWlyZSgnLi91dGlscy9MaW5lTWFzay5qcycpLkxpbmVNYXNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRcbnZhciBCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICBkZXRhaWw6IGZhbHNlLFxuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiBudWxsLCBwYWNrOiBudWxsfVxuICB9LFxuICBcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBhbHRDb2xvcnMgPSBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gYWx0Q29sb3JzLmxlbmd0aCA+IDEgJiYgXy5hbGwoYWx0Q29sb3JzLCBzZWxmLnZhbGlkYXRlQ29sb3IpO1xuICAgIHNlbGYub3B0cy51c2VTY29yZSA9IHNlbGYuaXNPbihzZWxmLm9wdHMudXNlU2NvcmUpO1xuICAgIHNlbGYub3B0cy5pdGVtUmdiID0gc2VsZi5pc09uKHNlbGYub3B0cy5pdGVtUmdiKTtcbiAgICBpZiAoIXZhbGlkQ29sb3JCeVN0cmFuZCkgeyBzZWxmLm9wdHMuY29sb3JCeVN0cmFuZCA9ICcnOyBzZWxmLm9wdHMuYWx0Q29sb3IgPSBudWxsOyB9XG4gICAgZWxzZSB7IHNlbGYub3B0cy5hbHRDb2xvciA9IGFsdENvbG9yc1sxXTsgfVxuICB9LFxuXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnbmFtZScsICdzY29yZScsICdzdHJhbmQnLCAndGhpY2tTdGFydCcsICd0aGlja0VuZCcsICdpdGVtUmdiJyxcbiAgICAgICdibG9ja0NvdW50JywgJ2Jsb2NrU2l6ZXMnLCAnYmxvY2tTdGFydHMnLCAnaWQnLCAnZGVzY3JpcHRpb24nXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IC9cXHQvLnRlc3QobGluZSkgPyBsaW5lLnNwbGl0KFwiXFx0XCIpIDogbGluZS5zcGxpdCgvXFxzKy8pLFxuICAgICAgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGlmICh0aGlzLm9wdHMuZGV0YWlsKSB7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAyXSA9ICdpZCc7XG4gICAgICBjb2xzW2ZpZWxkcy5sZW5ndGggLSAxXSA9ICdkZXNjcmlwdGlvbic7XG4gICAgfVxuICAgIF8uZWFjaChmaWVsZHMsIGZ1bmN0aW9uKHYsIGkpIHsgZmVhdHVyZVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUuY2hyb21dO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHsgXG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgJ1wiK2ZlYXR1cmUuY2hyb20rXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbVN0YXJ0KSArIDE7XG4gICAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5jaHJvbUVuZCkgKyAxO1xuICAgICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgICAgLy8gZmFuY2llciBCRUQgZmVhdHVyZXMgdG8gZXhwcmVzcyBjb2RpbmcgcmVnaW9ucyBhbmQgZXhvbnMvaW50cm9uc1xuICAgICAgaWYgKC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja1N0YXJ0KSAmJiAvXlxcZCskLy50ZXN0KGZlYXR1cmUudGhpY2tFbmQpKSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja1N0YXJ0KSArIDE7XG4gICAgICAgIGZlYXR1cmUudGhpY2tFbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUudGhpY2tFbmQpICsgMTtcbiAgICAgICAgaWYgKC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU2l6ZXMpICYmIC9eXFxkKygsXFxkKikqJC8udGVzdChmZWF0dXJlLmJsb2NrU3RhcnRzKSkge1xuICAgICAgICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgICAgICAgYmxvY2tTaXplcyA9IGZlYXR1cmUuYmxvY2tTaXplcy5zcGxpdCgvLC8pO1xuICAgICAgICAgIF8uZWFjaChmZWF0dXJlLmJsb2NrU3RhcnRzLnNwbGl0KC8sLyksIGZ1bmN0aW9uKHN0YXJ0LCBpKSB7XG4gICAgICAgICAgICBpZiAoc3RhcnQgPT09ICcnKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcGFyc2VJbnQxMChzdGFydCl9O1xuICAgICAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBwYXJzZUludDEwKGJsb2NrU2l6ZXNbaV0pO1xuICAgICAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pO1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgZmVhdHVyZSA9IHNlbGYudHlwZSgpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGxpbmUsIGxpbmVubyk7XG4gICAgICBpZiAoZmVhdHVyZSkgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIHN0YWNrZWRMYXlvdXQ6IGZ1bmN0aW9uKGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSkge1xuICAgIC8vIEEgbGluZU51bSBmdW5jdGlvbiBjYW4gYmUgcHJvdmlkZWQgd2hpY2ggY2FuIHNldC9yZXRyaWV2ZSB0aGUgbGluZSBvZiBhbHJlYWR5IHJlbmRlcmVkIGRhdGFwb2ludHNcbiAgICAvLyBzbyBhcyB0byBub3QgYnJlYWsgYSByYW5nZWQgZmVhdHVyZSB0aGF0IGV4dGVuZHMgb3ZlciBtdWx0aXBsZSB0aWxlcy5cbiAgICBsaW5lTnVtID0gXy5pc0Z1bmN0aW9uKGxpbmVOdW0pID8gbGluZU51bSA6IGZ1bmN0aW9uKCkgeyByZXR1cm47IH07XG4gICAgdmFyIGxpbmVzID0gW10sXG4gICAgICBtYXhFeGlzdGluZ0xpbmUgPSBfLm1heChfLm1hcChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIGxpbmVOdW0odi5kYXRhKSB8fCAwOyB9KSkgKyAxLFxuICAgICAgc29ydGVkSW50ZXJ2YWxzID0gXy5zb3J0QnkoaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7IHZhciBsbiA9IGxpbmVOdW0odi5kYXRhKTsgcmV0dXJuIF8uaXNVbmRlZmluZWQobG4pID8gMSA6IC1sbjsgfSk7XG4gICAgXG4gICAgd2hpbGUgKG1heEV4aXN0aW5nTGluZS0tPjApIHsgbGluZXMucHVzaChuZXcgTGluZU1hc2sod2lkdGgsIDUpKTsgfVxuICAgIF8uZWFjaChzb3J0ZWRJbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHZhciBkID0gdi5kYXRhLFxuICAgICAgICBsbiA9IGxpbmVOdW0oZCksXG4gICAgICAgIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwoZCksXG4gICAgICAgIHRoaWNrSW50ID0gZC50aGlja1N0YXJ0ICE9PSBudWxsICYmIGNhbGNQaXhJbnRlcnZhbCh7c3RhcnQ6IGQudGhpY2tTdGFydCwgZW5kOiBkLnRoaWNrRW5kfSksXG4gICAgICAgIGJsb2NrSW50cyA9IGQuYmxvY2tzICE9PSBudWxsICYmICBfLm1hcChkLmJsb2NrcywgY2FsY1BpeEludGVydmFsKSxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGwgPSBsaW5lcy5sZW5ndGg7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQobG4pKSB7XG4gICAgICAgIGlmIChsaW5lc1tsbl0uY29uZmxpY3QocEludC50eCwgcEludC50dykpIHsgLyp0aHJvdyBcIlVucmVzb2x2YWJsZSBMaW5lTWFzayBjb25mbGljdCFcIjsqLyB9XG4gICAgICAgIGxpbmVzW2xuXS5hZGQocEludC50eCwgcEludC50dywge3BJbnQ6IHBJbnQsIHRoaWNrSW50OiB0aGlja0ludCwgYmxvY2tJbnRzOiBibG9ja0ludHMsIGQ6IGR9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoaWxlIChpIDwgbCAmJiBsaW5lc1tpXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyArK2k7IH1cbiAgICAgICAgaWYgKGkgPT0gbCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgICAgIGxpbmVOdW0oZCwgaSk7XG4gICAgICAgIGxpbmVzW2ldLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gXy5wbHVjayhsLml0ZW1zLCAnZGF0YScpOyB9KTtcbiAgfSxcbiAgXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIGludGVydmFscyA9IHRoaXMuZGF0YS5zZWFyY2goc3RhcnQsIGVuZCksXG4gICAgICBkcmF3U3BlYyA9IFtdLFxuICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJyk7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXQpIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXQpKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkLmxpbmUgJiYgZC5saW5lW2tleV07IFxuICAgIH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7XG4gICAgICAgIHZhciBwSW50ID0gY2FsY1BpeEludGVydmFsKHYuZGF0YSk7XG4gICAgICAgIHBJbnQudiA9IHYuZGF0YS5zY29yZTtcbiAgICAgICAgZHJhd1NwZWMucHVzaChwSW50KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBkcmF3U3BlYyA9IHtsYXlvdXQ6IHRoaXMudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHRoaXMsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCwgbGluZU51bSl9O1xuICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGFkZEFyZWE6IGZ1bmN0aW9uKGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSkge1xuICAgIHZhciB0aXBUaXBEYXRhID0ge30sXG4gICAgICB0aXBUaXBEYXRhQ2FsbGJhY2sgPSB0aGlzLnR5cGUoKS50aXBUaXBEYXRhO1xuICAgIGlmICghYXJlYXMpIHsgcmV0dXJuOyB9XG4gICAgaWYgKF8uaXNGdW5jdGlvbih0aXBUaXBEYXRhQ2FsbGJhY2spKSB7XG4gICAgICB0aXBUaXBEYXRhID0gdGlwVGlwRGF0YUNhbGxiYWNrKGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmRlc2NyaXB0aW9uKSkgeyB0aXBUaXBEYXRhLmRlc2NyaXB0aW9uID0gZGF0YS5kLmRlc2NyaXB0aW9uOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLnNjb3JlKSkgeyB0aXBUaXBEYXRhLnNjb3JlID0gZGF0YS5kLnNjb3JlOyB9XG4gICAgICBfLmV4dGVuZCh0aXBUaXBEYXRhLCB7XG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9KTtcbiAgICAgIC8vIERpc3BsYXkgdGhlIElEIGNvbHVtbiAoZnJvbSBiZWREZXRhaWwpLCB1bmxlc3MgaXQgY29udGFpbnMgYSB0YWIgY2hhcmFjdGVyLCB3aGljaCBtZWFucyBpdCB3YXMgYXV0b2dlbmVyYXRlZFxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5pZCkgJiYgISgvXFx0LykudGVzdChkYXRhLmQuaWQpKSB7IHRpcFRpcERhdGEuaWQgPSBkYXRhLmQuaWQ7IH1cbiAgICB9XG4gICAgYXJlYXMucHVzaChbXG4gICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy8geDEsIHgyLCB5MSwgeTJcbiAgICAgIGRhdGEuZC5uYW1lIHx8IGRhdGEuZC5pZCB8fCAnJywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBuYW1lXG4gICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIF8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSA/IGRhdGEuZC5uYW1lIDogZGF0YS5kLmlkKSwgICAgLy8gaHJlZlxuICAgICAgZGF0YS5wSW50Lm9QcmV2LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICBudWxsLFxuICAgICAgbnVsbCxcbiAgICAgIHRpcFRpcERhdGFcbiAgICBdKTtcbiAgfSxcbiAgXG4gIC8vIFNjYWxlcyBhIHNjb3JlIGZyb20gMC0xMDAwIGludG8gYW4gYWxwaGEgdmFsdWUgYmV0d2VlbiAwLjIgYW5kIDEuMFxuICBjYWxjQWxwaGE6IGZ1bmN0aW9uKHZhbHVlKSB7IHJldHVybiBNYXRoLm1heCh2YWx1ZSwgMTY2KS8xMDAwOyB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhIGNvbG9yIHNjYWxlZCBiZXR3ZWVuICNjY2NjY2MgYW5kIG1heCBDb2xvclxuICBjYWxjR3JhZGllbnQ6IGZ1bmN0aW9uKG1heENvbG9yLCB2YWx1ZSkge1xuICAgIHZhciBtaW5Db2xvciA9IFsyMzAsMjMwLDIzMF0sXG4gICAgICB2YWx1ZUNvbG9yID0gW107XG4gICAgaWYgKCFfLmlzQXJyYXkobWF4Q29sb3IpKSB7IG1heENvbG9yID0gXy5tYXAobWF4Q29sb3Iuc3BsaXQoJywnKSwgcGFyc2VJbnQxMCk7IH1cbiAgICBfLmVhY2gobWluQ29sb3IsIGZ1bmN0aW9uKHYsIGkpIHsgdmFsdWVDb2xvcltpXSA9ICh2IC0gbWF4Q29sb3JbaV0pICogKCgxMDAwIC0gdmFsdWUpIC8gMTAwMC4wKSArIG1heENvbG9yW2ldOyB9KTtcbiAgICByZXR1cm4gXy5tYXAodmFsdWVDb2xvciwgcGFyc2VJbnQxMCkuam9pbignLCcpO1xuICB9LFxuICBcbiAgZHJhd0Fycm93czogZnVuY3Rpb24oY3R4LCBjYW52YXNXaWR0aCwgbGluZVksIGhhbGZIZWlnaHQsIHN0YXJ0WCwgZW5kWCwgZGlyZWN0aW9uKSB7XG4gICAgdmFyIGFycm93SGVpZ2h0ID0gTWF0aC5taW4oaGFsZkhlaWdodCwgMyksXG4gICAgICBYMSwgWDI7XG4gICAgc3RhcnRYID0gTWF0aC5tYXgoc3RhcnRYLCAwKTtcbiAgICBlbmRYID0gTWF0aC5taW4oZW5kWCwgY2FudmFzV2lkdGgpO1xuICAgIGlmIChlbmRYIC0gc3RhcnRYIDwgNSkgeyByZXR1cm47IH0gLy8gY2FuJ3QgZHJhdyBhcnJvd3MgaW4gdGhhdCBuYXJyb3cgb2YgYSBzcGFjZVxuICAgIGlmIChkaXJlY3Rpb24gIT09ICcrJyAmJiBkaXJlY3Rpb24gIT09ICctJykgeyByZXR1cm47IH0gLy8gaW52YWxpZCBkaXJlY3Rpb25cbiAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgLy8gQWxsIHRoZSAwLjUncyBoZXJlIGFyZSBkdWUgdG8gPGNhbnZhcz4ncyBzb21ld2hhdCBzaWxseSBjb29yZGluYXRlIHN5c3RlbSBcbiAgICAvLyBodHRwOi8vZGl2ZWludG9odG1sNS5pbmZvL2NhbnZhcy5odG1sI3BpeGVsLW1hZG5lc3NcbiAgICBYMSA9IGRpcmVjdGlvbiA9PSAnKycgPyAwLjUgOiBhcnJvd0hlaWdodCArIDAuNTtcbiAgICBYMiA9IGRpcmVjdGlvbiA9PSAnKycgPyBhcnJvd0hlaWdodCArIDAuNSA6IDAuNTtcbiAgICBmb3IgKHZhciBpID0gTWF0aC5mbG9vcihzdGFydFgpICsgMjsgaSA8IGVuZFggLSBhcnJvd0hlaWdodDsgaSArPSA3KSB7XG4gICAgICBjdHgubW92ZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0IC0gYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgICAgY3R4LmxpbmVUbyhpICsgWDIsIGxpbmVZICsgaGFsZkhlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgIH1cbiAgICBjdHguc3Ryb2tlKCk7XG4gIH0sXG4gIFxuICBkcmF3RmVhdHVyZTogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgeSA9IGkgKiBsaW5lSGVpZ2h0LFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBxdWFydGVySGVpZ2h0ID0gTWF0aC5jZWlsKDAuMjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgdGhpY2tPdmVybGFwID0gbnVsbCxcbiAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiAmJiBkYXRhLmQuaXRlbVJnYiAmJiB0aGlzLnZhbGlkYXRlQ29sb3IoZGF0YS5kLml0ZW1SZ2IpKSB7IGNvbG9yID0gZGF0YS5kLml0ZW1SZ2I7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGNvbG9yID0gc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIGRhdGEuZC5zY29yZSk7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLml0ZW1SZ2IgfHwgc2VsZi5vcHRzLmFsdENvbG9yIHx8IHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiOyB9XG4gICAgXG4gICAgaWYgKGRhdGEudGhpY2tJbnQpIHtcbiAgICAgIC8vIFRoZSBjb2RpbmcgcmVnaW9uIGlzIGRyYXduIGFzIGEgdGhpY2tlciBsaW5lIHdpdGhpbiB0aGUgZ2VuZVxuICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzKSB7XG4gICAgICAgIC8vIElmIHRoZXJlIGFyZSBleG9ucyBhbmQgaW50cm9ucywgZHJhdyB0aGUgaW50cm9ucyB3aXRoIGEgMXB4IGxpbmVcbiAgICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgMSk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICAgICAgICBfLmVhY2goZGF0YS5ibG9ja0ludHMsIGZ1bmN0aW9uKGJJbnQpIHtcbiAgICAgICAgICBpZiAoYkludC54ICsgYkludC53IDw9IHdpZHRoICYmIGJJbnQueCA+PSAwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBiSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaWNrT3ZlcmxhcCA9IHV0aWxzLnBpeEludGVydmFsT3ZlcmxhcChiSW50LCBkYXRhLnRoaWNrSW50KTtcbiAgICAgICAgICBpZiAodGhpY2tPdmVybGFwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QodGhpY2tPdmVybGFwLngsIHkgKyAxLCB0aGlja092ZXJsYXAudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgaW50cm9ucywgYXJyb3dzIGFyZSBkcmF3biBvbiB0aGUgaW50cm9ucywgbm90IHRoZSBleG9ucy4uLlxuICAgICAgICAgIGlmIChkYXRhLmQuc3RyYW5kICYmIHByZXZCSW50KSB7XG4gICAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgcHJldkJJbnQueCArIHByZXZCSW50LncsIGJJbnQueCwgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHByZXZCSW50ID0gYkludDtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIC4uLnVubGVzcyB0aGVyZSB3ZXJlIG5vIGludHJvbnMuIFRoZW4gaXQgaXMgZHJhd24gb24gdGhlIGNvZGluZyByZWdpb24uXG4gICAgICAgIGlmIChkYXRhLmJsb2NrSW50cy5sZW5ndGggPT0gMSkge1xuICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBXZSBoYXZlIGEgY29kaW5nIHJlZ2lvbiBidXQgbm8gaW50cm9ucy9leG9uc1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGRhdGEucEludC53LCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS50aGlja0ludC54LCB5ICsgMSwgZGF0YS50aGlja0ludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm90aGluZyBmYW5jeS4gIEl0J3MgYSBib3guXG4gICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEucEludC54LCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICB9XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSBzZWxmLm9wdHMudXJsID8gc2VsZi5vcHRzLnVybCA6ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTUgOiA2LFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgXG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgLy8gVE9ETzogSSBkaXNhYmxlZCByZWdlbmVyYXRpbmcgYXJlYXMgaGVyZSwgd2hpY2ggYXNzdW1lcyB0aGF0IGxpbmVOdW0gcmVtYWlucyBzdGFibGUgYWNyb3NzIHJlLXJlbmRlcnMuIFNob3VsZCBjaGVjayBvbiB0aGlzLlxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gXCJyZ2JhKFwiK3NlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBwSW50LnYpK1wiKVwiOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxheW91dCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0ZlYXR1cmUuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KTsgICAgICAgICAgICAgIFxuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAvXFxkKyxcXGQrLFxcZCtcXHMrXFxkKyxcXGQrLFxcZCsvLnRlc3Qoby5jb2xvckJ5U3RyYW5kKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gPyBvLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKVsxXSA6ICcwLDAsMCc7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuYXR0cignY2hlY2tlZCcsICEhY29sb3JCeVN0cmFuZE9uKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKGNvbG9yQnlTdHJhbmQpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnVzZVNjb3JlKSk7ICAgIFxuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbChvLnVybCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbCgpLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gdGhpcy52YWxpZGF0ZUNvbG9yKGNvbG9yQnlTdHJhbmQpO1xuICAgIG8uY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiAmJiB2YWxpZENvbG9yQnlTdHJhbmQgPyBvLmNvbG9yICsgJyAnICsgY29sb3JCeVN0cmFuZCA6ICcnO1xuICAgIG8udXNlU2NvcmUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmlzKCc6Y2hlY2tlZCcpID8gMSA6IDA7XG4gICAgby51cmwgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoKTtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkR3JhcGggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iZWRncmFwaC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkZ3JhcGhcbnZhciBCZWRHcmFwaEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdC5jYWxsKHRoaXMpOyB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7IH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnZGF0YVZhbHVlJ10sXG4gICAgICAgIGRhdHVtID0ge30sXG4gICAgICAgIGNoclBvcywgc3RhcnQsIGVuZCwgdmFsO1xuICAgICAgXy5lYWNoKGxpbmUuc3BsaXQoL1xccysvKSwgZnVuY3Rpb24odiwgaSkgeyBkYXR1bVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZGF0dW0uY2hyb21dO1xuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbVN0YXJ0KTtcbiAgICAgIGVuZCA9IHBhcnNlSW50MTAoZGF0dW0uY2hyb21FbmQpO1xuICAgICAgdmFsID0gcGFyc2VGbG9hdChkYXR1bS5kYXRhVmFsdWUpO1xuICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIGVuZCwgdmFsOiB2YWx9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkR3JhcGhGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ0JlZCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ0JlZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmlnYmVkXG52YXIgQmlnQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnQmVkIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgY2FjaGUgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiaWdiZWQucGhwJyxcbiAgICAgIHJlbW90ZTtcbiAgICBcbiAgICByZW1vdGUgPSBuZXcgUmVtb3RlVHJhY2soY2FjaGUsIGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIHN0b3JlSW50ZXJ2YWxzKSB7XG4gICAgICByYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCBkZW5zaXR5OiAncGFjayd9LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgdmFyIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID49IDI7IH0pO1xuICAgICAgICAgIHZhciBpbnRlcnZhbHMgPSBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyBcbiAgICAgICAgICAgIHZhciBpdHZsID0gc2VsZi50eXBlKCdiZWQnKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsKTsgXG4gICAgICAgICAgICAvLyBVc2UgQmlvUGVybCdzIEJpbzo6REI6QmlnQmVkIHN0cmF0ZWd5IGZvciBkZWR1cGxpY2F0aW5nIHJlLWZldGNoZWQgaW50ZXJ2YWxzOlxuICAgICAgICAgICAgLy8gXCJCZWNhdXNlIEJFRCBmaWxlcyBkb24ndCBhY3R1YWxseSB1c2UgSURzLCB0aGUgSUQgaXMgY29uc3RydWN0ZWQgZnJvbSB0aGUgZmVhdHVyZSdzIG5hbWUgKGlmIGFueSksIGNocm9tb3NvbWUgY29vcmRpbmF0ZXMsIHN0cmFuZCBhbmQgYmxvY2sgY291bnQuXCJcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGl0dmwuaWQpKSB7XG4gICAgICAgICAgICAgIGl0dmwuaWQgPSBbaXR2bC5uYW1lLCBpdHZsLmNocm9tLCBpdHZsLmNocm9tU3RhcnQsIGl0dmwuY2hyb21FbmQsIGl0dmwuc3RyYW5kLCBpdHZsLmJsb2NrQ291bnRdLmpvaW4oXCJcXHRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaXR2bDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBcbiAgICAvLyBHZXQgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiaWdCZWQgYW5kIHNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhlIFJlbW90ZVRyYWNrXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHsgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCB9LFxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAvLyBTZXQgbWF4RmV0Y2hXaW5kb3cgdG8gYXZvaWQgb3ZlcmZldGNoaW5nIGRhdGEuXG4gICAgICAgIGlmICghc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICAgICAgdmFyIG1lYW5JdGVtc1BlckJwID0gZGF0YS5pdGVtQ291bnQgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKHNlbGYub3B0cy5kcmF3TGltaXQpKTtcbiAgICAgICAgICBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICAgIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAvIDMpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93LCBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGZ1bmN0aW9uIHBhcnNlRGVuc2VEYXRhKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLCBcbiAgICAgICAgbGluZXM7XG4gICAgICBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccysvZyk7XG4gICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIHgpIHsgXG4gICAgICAgIGlmIChsaW5lICE9ICduL2EnICYmIGxpbmUubGVuZ3RoKSB7IGRyYXdTcGVjLnB1c2goe3g6IHgsIHc6IDEsIHY6IHBhcnNlRmxvYXQobGluZSkgKiAxMDAwfSk7IH0gXG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIGRlbnNpdHkgaXMgbm90ICdkZW5zZScgYW5kIHdlIGNhbiByZWFzb25hYmx5XG4gICAgLy8gZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtYW55IHJvd3MgKD41MDAgZmVhdHVyZXMpLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLCB7XG4gICAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCBkZW5zaXR5OiBkZW5zaXR5fSxcbiAgICAgICAgICBzdWNjZXNzOiBwYXJzZURlbnNlRGF0YVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgICB2YXIgY2FsY1BpeEludGVydmFsLCBkcmF3U3BlYyA9IHt9O1xuICAgICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5ID09ICdwYWNrJyk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKTtcbiAgICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnQmVkRm9ybWF0OyIsIlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnV2lnIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnV2lnLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBCaWdXaWdGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcxMjgsMTI4LDEyOCcsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdXaWcgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHsnbWluaW11bSc6MSwgJ21heGltdW0nOjEsICdtZWFuJzoxLCAnbWluJzoxLCAnbWF4JzoxLCAnc3RkJzoxLCAnY292ZXJhZ2UnOjF9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHNlbGYub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgIGFzeW5jOiBmYWxzZSwgIC8vIFRoaXMgaXMgY29vbCBzaW5jZSBwYXJzaW5nIG5vcm1hbGx5IGhhcHBlbnMgaW4gYSBXZWIgV29ya2VyXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciByb3dzID0gZGF0YS5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgXy5lYWNoKHJvd3MsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICB2YXIga2V5dmFsID0gci5zcGxpdCgnOiAnKTtcbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWluJykgeyBzZWxmLnJhbmdlWzBdID0gTWF0aC5taW4ocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzBdKTsgfVxuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtYXgnKSB7IHNlbGYucmFuZ2VbMV0gPSBNYXRoLm1heChwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMV0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGNoclJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZSA9PSAnbi9hJykgeyBkcmF3U3BlYy5iYXJzLnB1c2gobnVsbCk7IH1cbiAgICAgICAgZWxzZSBpZiAobGluZS5sZW5ndGgpIHsgZHJhd1NwZWMuYmFycy5wdXNoKChwYXJzZUZsb2F0KGxpbmUpIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTsgfVxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtyYW5nZTogY2hyUmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIHdpZHRoOiB3aWR0aCwgd2luRnVuYzogc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9ufSxcbiAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICB9KTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdXaWdGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBmZWF0dXJlVGFibGUgZm9ybWF0OiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmZlYXR1cmV0YWJsZVxudmFyIEZlYXR1cmVUYWJsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjb2xsYXBzZUJ5R2VuZTogJ29mZicsXG4gICAga2V5Q29sdW1uV2lkdGg6IDIxLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lID0gdGhpcy5pc09uKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSk7XG4gICAgdGhpcy5mZWF0dXJlVHlwZUNvdW50cyA9IHt9O1xuICB9LFxuICBcbiAgLy8gcGFyc2VzIG9uZSBmZWF0dXJlIGtleSArIGxvY2F0aW9uL3F1YWxpZmllcnMgcm93IGZyb20gdGhlIGZlYXR1cmUgdGFibGVcbiAgcGFyc2VFbnRyeTogZnVuY3Rpb24oY2hyb20sIGxpbmVzLCBzdGFydExpbmVObykge1xuICAgIHZhciBmZWF0dXJlID0ge1xuICAgICAgICBjaHJvbTogY2hyb20sXG4gICAgICAgIHNjb3JlOiAnPycsXG4gICAgICAgIGJsb2NrczogbnVsbCxcbiAgICAgICAgcXVhbGlmaWVyczoge31cbiAgICAgIH0sXG4gICAgICBrZXlDb2x1bW5XaWR0aCA9IHRoaXMub3B0cy5rZXlDb2x1bW5XaWR0aCxcbiAgICAgIHF1YWxpZmllciA9IG51bGwsXG4gICAgICBmdWxsTG9jYXRpb24gPSBbXSxcbiAgICAgIGNvbGxhcHNlS2V5UXVhbGlmaWVycyA9IFsnbG9jdXNfdGFnJywgJ2dlbmUnLCAnZGJfeHJlZiddLFxuICAgICAgcXVhbGlmaWVyc1RoYXRBcmVOYW1lcyA9IFsnZ2VuZScsICdsb2N1c190YWcnLCAnZGJfeHJlZiddLFxuICAgICAgUk5BVHlwZXMgPSBbJ3JybmEnLCAndHJuYSddLFxuICAgICAgYWxzb1RyeUZvclJOQVR5cGVzID0gWydwcm9kdWN0J10sXG4gICAgICBsb2NhdGlvblBvc2l0aW9ucywgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocm9tXTtcbiAgICBzdGFydExpbmVObyA9IHN0YXJ0TGluZU5vIHx8IDA7XG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmlsbCBvdXQgZmVhdHVyZSdzIGtleXMgd2l0aCBpbmZvIGZyb20gdGhlc2UgbGluZXNcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGtleSA9IGxpbmUuc3Vic3RyKDAsIGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcmVzdE9mTGluZSA9IGxpbmUuc3Vic3RyKGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcXVhbGlmaWVyTWF0Y2ggPSByZXN0T2ZMaW5lLm1hdGNoKC9eXFwvKFxcdyspKD0/KSguKikvKTtcbiAgICAgIGlmIChrZXkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGZlYXR1cmUudHlwZSA9IHN0cmlwKGtleSk7XG4gICAgICAgIHF1YWxpZmllciA9IG51bGw7XG4gICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHF1YWxpZmllck1hdGNoKSB7XG4gICAgICAgICAgcXVhbGlmaWVyID0gcXVhbGlmaWVyTWF0Y2hbMV07XG4gICAgICAgICAgaWYgKCFmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkgeyBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSA9IFtdOyB9XG4gICAgICAgICAgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0ucHVzaChbcXVhbGlmaWVyTWF0Y2hbMl0gPyBxdWFsaWZpZXJNYXRjaFszXSA6IHRydWVdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAocXVhbGlmaWVyICE9PSBudWxsKSB7IFxuICAgICAgICAgICAgXy5sYXN0KGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKS5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbi5qb2luKCcnKTtcbiAgICBsb2NhdGlvblBvc2l0aW9ucyA9IF8ubWFwKF8uZmlsdGVyKGZ1bGxMb2NhdGlvbi5zcGxpdCgvXFxEKy8pLCBfLmlkZW50aXR5KSwgcGFyc2VJbnQxMCk7XG4gICAgZmVhdHVyZS5jaHJvbVN0YXJ0ID0gIF8ubWluKGxvY2F0aW9uUG9zaXRpb25zKTtcbiAgICBmZWF0dXJlLmNocm9tRW5kID0gXy5tYXgobG9jYXRpb25Qb3NpdGlvbnMpICsgMTsgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaHJvbUVuZCBjb2x1bW5zIGluIEJFRCBmb3JtYXQgYXJlICpub3QqLlxuICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tU3RhcnQ7XG4gICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tRW5kOyBcbiAgICBmZWF0dXJlLnN0cmFuZCA9IC9jb21wbGVtZW50Ly50ZXN0KGZ1bGxMb2NhdGlvbikgPyBcIi1cIiA6IFwiK1wiO1xuICAgIFxuICAgIC8vIFVudGlsIHdlIG1lcmdlIGJ5IGdlbmUgbmFtZSwgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aGVzZVxuICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgIGZlYXR1cmUuYmxvY2tzID0gbnVsbDtcbiAgICBcbiAgICAvLyBQYXJzZSB0aGUgcXVhbGlmaWVycyBwcm9wZXJseVxuICAgIF8uZWFjaChmZWF0dXJlLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIF8uZWFjaCh2LCBmdW5jdGlvbihlbnRyeUxpbmVzLCBpKSB7XG4gICAgICAgIHZbaV0gPSBzdHJpcChlbnRyeUxpbmVzLmpvaW4oJyAnKSk7XG4gICAgICAgIGlmICgvXlwiW1xcc1xcU10qXCIkLy50ZXN0KHZbaV0pKSB7XG4gICAgICAgICAgLy8gRGVxdW90ZSBmcmVlIHRleHRcbiAgICAgICAgICB2W2ldID0gdltpXS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKS5yZXBsYWNlKC9cIlwiL2csICdcIicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vaWYgKHYubGVuZ3RoID09IDEpIHsgZmVhdHVyZS5xdWFsaWZpZXJzW2tdID0gdlswXTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZpbmQgc29tZXRoaW5nIHRoYXQgY2FuIHNlcnZlIGFzIGEgbmFtZVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUudHlwZTtcbiAgICBpZiAoXy5jb250YWlucyhSTkFUeXBlcywgZmVhdHVyZS50eXBlLnRvTG93ZXJDYXNlKCkpKSB7IFxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgYWxzb1RyeUZvclJOQVR5cGVzKTsgXG4gICAgfVxuICAgIF8uZmluZChxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBmdW5jdGlvbihrKSB7XG4gICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyByZXR1cm4gKGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7IH1cbiAgICB9KTtcbiAgICAvLyBJbiB0aGUgd29yc3QgY2FzZSwgYWRkIGEgY291bnRlciB0byBkaXNhbWJpZ3VhdGUgZmVhdHVyZXMgbmFtZWQgb25seSBieSB0eXBlXG4gICAgaWYgKGZlYXR1cmUubmFtZSA9PSBmZWF0dXJlLnR5cGUpIHtcbiAgICAgIGlmICghdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKSB7IHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSA9IDE7IH1cbiAgICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUubmFtZSArICdfJyArIHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSsrO1xuICAgIH1cbiAgICBcbiAgICAvLyBGaW5kIGEga2V5IHRoYXQgaXMgYXBwcm9wcmlhdGUgZm9yIGNvbGxhcHNpbmdcbiAgICBpZiAodGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmZpbmQoY29sbGFwc2VLZXlRdWFsaWZpZXJzLCBmdW5jdGlvbihrKSB7XG4gICAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IFxuICAgICAgICAgIHJldHVybiAoZmVhdHVyZS5fY29sbGFwc2VLZXkgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICAvLyBjb2xsYXBzZXMgbXVsdGlwbGUgZmVhdHVyZXMgdGhhdCBhcmUgYWJvdXQgdGhlIHNhbWUgZ2VuZSBpbnRvIG9uZSBkcmF3YWJsZSBmZWF0dXJlXG4gIGNvbGxhcHNlRmVhdHVyZXM6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XG4gICAgdmFyIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLFxuICAgICAgcHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvID0gWydtcm5hJywgJ2dlbmUnLCAnY2RzJ10sXG4gICAgICBwcmVmZXJyZWRUeXBlRm9yRXhvbnMgPSBbJ2V4b24nLCAnY2RzJ10sXG4gICAgICBtZXJnZUludG8gPSBmZWF0dXJlc1swXSxcbiAgICAgIGJsb2NrcyA9IFtdLFxuICAgICAgZm91bmRUeXBlLCBjZHMsIGV4b25zO1xuICAgIGZvdW5kVHlwZSA9IF8uZmluZChwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8sIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBmb3VuZCA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZm91bmQpIHsgbWVyZ2VJbnRvID0gZm91bmQ7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gTG9vayBmb3IgZXhvbnMgKGV1a2FyeW90aWMpIG9yIGEgQ0RTIChwcm9rYXJ5b3RpYylcbiAgICBfLmZpbmQocHJlZmVycmVkVHlwZUZvckV4b25zLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICBleG9ucyA9IF8uc2VsZWN0KGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChleG9ucy5sZW5ndGgpIHsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBjZHMgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IFwiY2RzXCI7IH0pO1xuICAgIFxuICAgIF8uZWFjaChleG9ucywgZnVuY3Rpb24oZXhvbkZlYXR1cmUpIHtcbiAgICAgIGV4b25GZWF0dXJlLmZ1bGxMb2NhdGlvbi5yZXBsYWNlKC8oXFxkKylcXC5cXC5bPjxdPyhcXGQrKS9nLCBmdW5jdGlvbihmdWxsTWF0Y2gsIHN0YXJ0LCBlbmQpIHtcbiAgICAgICAgYmxvY2tzLnB1c2goe1xuICAgICAgICAgIHN0YXJ0OiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgTWF0aC5taW4oc3RhcnQsIGVuZCksIFxuICAgICAgICAgIC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2UuXG4gICAgICAgICAgZW5kOiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgIE1hdGgubWF4KHN0YXJ0LCBlbmQpICsgMVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIENvbnZlcnQgZXhvbnMgYW5kIENEUyBpbnRvIGJsb2NrcywgdGhpY2tTdGFydCBhbmQgdGhpY2tFbmQgKGluIEJFRCB0ZXJtaW5vbG9neSlcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCkgeyBcbiAgICAgIG1lcmdlSW50by5ibG9ja3MgPSBfLnNvcnRCeShibG9ja3MsIGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGIuc3RhcnQ7IH0pO1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrU3RhcnQgPSBjZHMgPyBjZHMuc3RhcnQgOiBmZWF0dXJlLnN0YXJ0O1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrRW5kID0gY2RzID8gY2RzLmVuZCA6IGZlYXR1cmUuZW5kO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaW5hbGx5LCBtZXJnZSBhbGwgdGhlIHF1YWxpZmllcnNcbiAgICBfLmVhY2goZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHtcbiAgICAgIGlmIChmZWF0ID09PSBtZXJnZUludG8pIHsgcmV0dXJuOyB9XG4gICAgICBfLmVhY2goZmVhdC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2YWx1ZXMsIGspIHtcbiAgICAgICAgaWYgKCFtZXJnZUludG8ucXVhbGlmaWVyc1trXSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXSA9IFtdOyB9XG4gICAgICAgIF8uZWFjaCh2YWx1ZXMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICBpZiAoIV8uY29udGFpbnMobWVyZ2VJbnRvLnF1YWxpZmllcnNba10sIHYpKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLnB1c2godik7IH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VJbnRvO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgbnVtTGluZXMgPSBsaW5lcy5sZW5ndGgsXG4gICAgICBjaHJvbSA9IG51bGwsXG4gICAgICBsYXN0RW50cnlTdGFydCA9IG51bGwsXG4gICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXkgPSB7fSxcbiAgICAgIGZlYXR1cmU7XG4gICAgXG4gICAgZnVuY3Rpb24gY29sbGVjdExhc3RFbnRyeShsaW5lbm8pIHtcbiAgICAgIGlmIChsYXN0RW50cnlTdGFydCAhPT0gbnVsbCkge1xuICAgICAgICBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VFbnRyeS5jYWxsKHNlbGYsIGNocm9tLCBsaW5lcy5zbGljZShsYXN0RW50cnlTdGFydCwgbGluZW5vKSwgbGFzdEVudHJ5U3RhcnQpO1xuICAgICAgICBpZiAoZmVhdHVyZSkgeyBcbiAgICAgICAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSA9IGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gfHwgW107XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldLnB1c2goZmVhdHVyZSk7XG4gICAgICAgICAgfSBlbHNlIHsgZGF0YS5hZGQoZmVhdHVyZSk7IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBDaHVuayB0aGUgbGluZXMgaW50byBlbnRyaWVzIGFuZCBwYXJzZSBlYWNoIG9mIHRoZW1cbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgaWYgKGxpbmUuc3Vic3RyKDAsIDEyKSA9PSBcIkFDQ0VTU0lPTiAgIFwiKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgY2hyb20gPSBsaW5lLnN1YnN0cigxMik7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbDtcbiAgICAgIH0gZWxzZSBpZiAoY2hyb20gIT09IG51bGwgJiYgbGluZS5zdWJzdHIoNSwgMSkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBsaW5lbm87XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gcGFyc2UgdGhlIGxhc3QgZW50cnlcbiAgICBpZiAoY2hyb20gIT09IG51bGwpIHsgY29sbGVjdExhc3RFbnRyeShsaW5lcy5sZW5ndGgpOyB9XG4gICAgXG4gICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZWFjaChmZWF0dXJlc0J5Q29sbGFwc2VLZXksIGZ1bmN0aW9uKGZlYXR1cmVzLCBnZW5lKSB7XG4gICAgICAgIGRhdGEuYWRkKHNlbGYudHlwZSgpLmNvbGxhcHNlRmVhdHVyZXMuY2FsbChzZWxmLCBmZWF0dXJlcykpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHF1YWxpZmllcnNUb0FiYnJldmlhdGUgPSB7dHJhbnNsYXRpb246IDF9LFxuICAgICAgY29udGVudCA9IHtcbiAgICAgICAgdHlwZTogZGF0YS5kLnR5cGUsXG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9O1xuICAgIGlmIChkYXRhLmQucXVhbGlmaWVycy5ub3RlICYmIGRhdGEuZC5xdWFsaWZpZXJzLm5vdGVbMF0pIHsgIH1cbiAgICBfLmVhY2goZGF0YS5kLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIGlmIChrID09ICdub3RlJykgeyBjb250ZW50LmRlc2NyaXB0aW9uID0gdi5qb2luKCc7ICcpOyByZXR1cm47IH1cbiAgICAgIGNvbnRlbnRba10gPSB2LmpvaW4oJzsgJyk7XG4gICAgICBpZiAocXVhbGlmaWVyc1RvQWJicmV2aWF0ZVtrXSAmJiBjb250ZW50W2tdLmxlbmd0aCA+IDI1KSB7IGNvbnRlbnRba10gPSBjb250ZW50W2tdLnN1YnN0cigwLCAyNSkgKyAnLi4uJzsgfVxuICAgIH0pO1xuICAgIHJldHVybiBjb250ZW50O1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuZHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMudHlwZSgnYmVkJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmVhdHVyZVRhYmxlRm9ybWF0OyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7ICBcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBCeSBTaGluIFN1enVraSwgTUlUIGxpY2Vuc2VcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGlub3V0L2ludGVydmFsLXRyZWVcbiAqIEludGVydmFsVHJlZVxuICpcbiAqIEBwYXJhbSAob2JqZWN0KSBkYXRhOlxuICogQHBhcmFtIChudW1iZXIpIGNlbnRlcjpcbiAqIEBwYXJhbSAob2JqZWN0KSBvcHRpb25zOlxuICogICBjZW50ZXI6XG4gKlxuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucykge1xuICBvcHRpb25zIHx8IChvcHRpb25zID0ge30pO1xuXG4gIHRoaXMuc3RhcnRLZXkgICAgID0gb3B0aW9ucy5zdGFydEtleSB8fCAwOyAvLyBzdGFydCBrZXlcbiAgdGhpcy5lbmRLZXkgICAgICAgPSBvcHRpb25zLmVuZEtleSAgIHx8IDE7IC8vIGVuZCBrZXlcbiAgdGhpcy5pbnRlcnZhbEhhc2ggPSB7fTsgICAgICAgICAgICAgICAgICAgIC8vIGlkID0+IGludGVydmFsIG9iamVjdFxuICB0aGlzLnBvaW50VHJlZSA9IG5ldyBTb3J0ZWRMaXN0KHsgICAgICAgICAgLy8gYi10cmVlIG9mIHN0YXJ0LCBlbmQgcG9pbnRzIFxuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYVswXS0gYlswXTtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQgPSAwO1xuXG4gIC8vIGluZGV4IG9mIHRoZSByb290IG5vZGVcbiAgaWYgKCFjZW50ZXIgfHwgdHlwZW9mIGNlbnRlciAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBjZW50ZXIgaW5kZXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IG5ldyBOb2RlKGNlbnRlciwgdGhpcyk7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICBpZiAodGhpcy5pbnRlcnZhbEhhc2hbaWRdKSB7XG4gICAgdGhyb3cgbmV3IER1cGxpY2F0ZUVycm9yKCdpZCAnICsgaWQgKyAnIGlzIGFscmVhZHkgcmVnaXN0ZXJlZC4nKTtcbiAgfVxuXG4gIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICB3aGlsZSAodGhpcy5pbnRlcnZhbEhhc2hbdGhpcy5fYXV0b0luY3JlbWVudF0pIHtcbiAgICAgIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgICB9XG4gICAgaWQgPSB0aGlzLl9hdXRvSW5jcmVtZW50O1xuICB9XG5cbiAgdmFyIGl0dmwgPSBuZXcgSW50ZXJ2YWwoZGF0YSwgaWQsIHRoaXMuc3RhcnRLZXksIHRoaXMuZW5kS2V5KTtcbiAgdGhpcy5wb2ludFRyZWUuaW5zZXJ0KFtpdHZsLnN0YXJ0LCBpZF0pO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuZW5kLCAgIGlkXSk7XG4gIHRoaXMuaW50ZXJ2YWxIYXNoW2lkXSA9IGl0dmw7XG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQrKztcbiAgLy90cnkge1xuICAgIF9pbnNlcnQuY2FsbCh0aGlzLCB0aGlzLnJvb3QsIGl0dmwpO1xuICAvL30gY2F0Y2ggKGUpIHtcbiAgLy8gIGlmIChlIGluc3RhbmNlb2YgUmFuZ2VFcnJvcikgeyBjb25zb2xlLmxvZyAoZGF0YSk7IH1cbiAgLy99XG59O1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHRyeSB7XG4gICAgdGhpcy5hZGQoZGF0YSwgaWQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBEdXBsaWNhdGVFcnJvcikgeyByZXR1cm47IH1cbiAgICB0aHJvdyBlO1xuICB9XG59XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKGludGVnZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyKSB7XG4gIHZhciByZXQgPSBbXTtcbiAgaWYgKHR5cGVvZiB2YWwxICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnOiBpbnZhbGlkIGlucHV0Jyk7XG4gIH1cblxuICBpZiAodmFsMiA9PSB1bmRlZmluZWQpIHtcbiAgICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIHZhbDEsIHJldCk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIHZhbDIgPT0gJ251bWJlcicpIHtcbiAgICBfcmFuZ2VTZWFyY2guY2FsbCh0aGlzLCB2YWwxLCB2YWwyLCByZXQpO1xuICB9XG4gIGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcih2YWwxICsgJywnICsgdmFsMiArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuXG4vKipcbiAqIHJlbW92ZTogXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gdGhlIHNoaWZ0LXJpZ2h0LWFuZC1maWxsIG9wZXJhdG9yLCBleHRlbmRlZCBiZXlvbmQgdGhlIHJhbmdlIG9mIGFuIGludDMyXG5mdW5jdGlvbiBfYml0U2hpZnRSaWdodChudW0pIHtcbiAgaWYgKG51bSA+IDIxNDc0ODM2NDcgfHwgbnVtIDwgLTIxNDc0ODM2NDgpIHsgcmV0dXJuIE1hdGguZmxvb3IobnVtIC8gMik7IH1cbiAgcmV0dXJuIG51bSA+Pj4gMTtcbn1cblxuLyoqXG4gKiBfaW5zZXJ0XG4gKiovXG5mdW5jdGlvbiBfaW5zZXJ0KG5vZGUsIGl0dmwpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoaXR2bC5lbmQgPCBub2RlLmlkeCkge1xuICAgICAgaWYgKCFub2RlLmxlZnQpIHtcbiAgICAgICAgbm9kZS5sZWZ0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAobm9kZS5pZHggPCBpdHZsLnN0YXJ0KSB7XG4gICAgICBpZiAoIW5vZGUucmlnaHQpIHtcbiAgICAgICAgbm9kZS5yaWdodCA9IG5ldyBOb2RlKF9iaXRTaGlmdFJpZ2h0KGl0dmwuc3RhcnQgKyBpdHZsLmVuZCksIHRoaXMpO1xuICAgICAgfVxuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBub2RlLmluc2VydChpdHZsKTtcbiAgICB9XG4gIH1cbn1cblxuXG4vKipcbiAqIF9wb2ludFNlYXJjaFxuICogQHBhcmFtIChOb2RlKSBub2RlXG4gKiBAcGFyYW0gKGludGVnZXIpIGlkeCBcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3BvaW50U2VhcmNoKG5vZGUsIGlkeCwgYXJyKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKCFub2RlKSBicmVhaztcbiAgICBpZiAoaWR4IDwgbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5ldmVyeShmdW5jdGlvbihpdHZsKSB7XG4gICAgICAgIHZhciBib29sID0gKGl0dmwuc3RhcnQgPD0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUubGVmdDtcbiAgICB9IGVsc2UgaWYgKGlkeCA+IG5vZGUuaWR4KSB7XG4gICAgICBub2RlLmVuZHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5lbmQgPj0gaWR4KTtcbiAgICAgICAgaWYgKGJvb2wpIGFyci5wdXNoKGl0dmwucmVzdWx0KCkpO1xuICAgICAgICByZXR1cm4gYm9vbDtcbiAgICAgIH0pO1xuICAgICAgbm9kZSA9IG5vZGUucmlnaHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUuc3RhcnRzLmFyci5tYXAoZnVuY3Rpb24oaXR2bCkgeyBhcnIucHVzaChpdHZsLnJlc3VsdCgpKSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufVxuXG5cblxuLyoqXG4gKiBfcmFuZ2VTZWFyY2hcbiAqIEBwYXJhbSAoaW50ZWdlcikgc3RhcnRcbiAqIEBwYXJhbSAoaW50ZWdlcikgZW5kXG4gKiBAcGFyYW0gKEFycmF5KSBhcnJcbiAqKi9cbmZ1bmN0aW9uIF9yYW5nZVNlYXJjaChzdGFydCwgZW5kLCBhcnIpIHtcbiAgaWYgKGVuZCAtIHN0YXJ0IDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBzdGFydC4gc3RhcnQ6ICcgKyBzdGFydCArICcsIGVuZDogJyArIGVuZCk7XG4gIH1cbiAgdmFyIHJlc3VsdEhhc2ggPSB7fTtcblxuICB2YXIgd2hvbGVXcmFwcyA9IFtdO1xuICBfcG9pbnRTZWFyY2guY2FsbCh0aGlzLCB0aGlzLnJvb3QsIF9iaXRTaGlmdFJpZ2h0KHN0YXJ0ICsgZW5kKSwgd2hvbGVXcmFwcywgdHJ1ZSk7XG5cbiAgd2hvbGVXcmFwcy5mb3JFYWNoKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgIHJlc3VsdEhhc2hbcmVzdWx0LmlkXSA9IHRydWU7XG4gIH0pO1xuXG5cbiAgdmFyIGlkeDEgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtzdGFydCwgbnVsbF0pO1xuICB3aGlsZSAoaWR4MSA+PSAwICYmIHRoaXMucG9pbnRUcmVlLmFycltpZHgxXVswXSA9PSBzdGFydCkge1xuICAgIGlkeDEtLTtcbiAgfVxuXG4gIHZhciBpZHgyID0gdGhpcy5wb2ludFRyZWUuYnNlYXJjaChbZW5kLCAgIG51bGxdKTtcbiAgdmFyIGxlbiA9IHRoaXMucG9pbnRUcmVlLmFyci5sZW5ndGggLSAxO1xuICB3aGlsZSAoaWR4MiA9PSAtMSB8fCAoaWR4MiA8PSBsZW4gJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDJdWzBdIDw9IGVuZCkpIHtcbiAgICBpZHgyKys7XG4gIH1cblxuICB0aGlzLnBvaW50VHJlZS5hcnIuc2xpY2UoaWR4MSArIDEsIGlkeDIpLmZvckVhY2goZnVuY3Rpb24ocG9pbnQpIHtcbiAgICB2YXIgaWQgPSBwb2ludFsxXTtcbiAgICByZXN1bHRIYXNoW2lkXSA9IHRydWU7XG4gIH0sIHRoaXMpO1xuXG4gIE9iamVjdC5rZXlzKHJlc3VsdEhhc2gpLmZvckVhY2goZnVuY3Rpb24oaWQpIHtcbiAgICB2YXIgaXR2bCA9IHRoaXMuaW50ZXJ2YWxIYXNoW2lkXTtcbiAgICBhcnIucHVzaChpdHZsLnJlc3VsdChzdGFydCwgZW5kKSk7XG4gIH0sIHRoaXMpO1xuXG59XG5cblxuXG4vKipcbiAqIHN1YmNsYXNzZXNcbiAqIFxuICoqL1xuXG5cbi8qKlxuICogTm9kZSA6IHByb3RvdHlwZSBvZiBlYWNoIG5vZGUgaW4gYSBpbnRlcnZhbCB0cmVlXG4gKiBcbiAqKi9cbmZ1bmN0aW9uIE5vZGUoaWR4KSB7XG4gIHRoaXMuaWR4ID0gaWR4O1xuICB0aGlzLnN0YXJ0cyA9IG5ldyBTb3J0ZWRMaXN0KHtcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbmRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5lbmQgLSBiLmVuZDtcbiAgICAgIHJldHVybiAoYyA8IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBpbnNlcnQgYW4gSW50ZXJ2YWwgb2JqZWN0IHRvIHRoaXMgbm9kZVxuICoqL1xuTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgdGhpcy5zdGFydHMuaW5zZXJ0KGludGVydmFsKTtcbiAgdGhpcy5lbmRzLmluc2VydChpbnRlcnZhbCk7XG59O1xuXG5cblxuLyoqXG4gKiBJbnRlcnZhbCA6IHByb3RvdHlwZSBvZiBpbnRlcnZhbCBpbmZvXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbChkYXRhLCBpZCwgcywgZSkge1xuICB0aGlzLmlkICAgICA9IGlkO1xuICB0aGlzLnN0YXJ0ICA9IGRhdGFbc107XG4gIHRoaXMuZW5kICAgID0gZGF0YVtlXTtcbiAgdGhpcy5kYXRhICAgPSBkYXRhO1xuXG4gIGlmICh0eXBlb2YgdGhpcy5zdGFydCAhPSAnbnVtYmVyJyB8fCB0eXBlb2YgdGhpcy5lbmQgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0LCBlbmQgbXVzdCBiZSBudW1iZXIuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxuXG4gIGlmICggdGhpcy5zdGFydCA+PSB0aGlzLmVuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQgbXVzdCBiZSBzbWFsbGVyIHRoYW4gZW5kLiBzdGFydDogJyArIHRoaXMuc3RhcnQgKyAnLCBlbmQ6ICcgKyB0aGlzLmVuZCk7XG4gIH1cbn1cblxuLyoqXG4gKiBnZXQgcmVzdWx0IG9iamVjdFxuICoqL1xuSW50ZXJ2YWwucHJvdG90eXBlLnJlc3VsdCA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9IHtcbiAgICBpZCAgIDogdGhpcy5pZCxcbiAgICBkYXRhIDogdGhpcy5kYXRhXG4gIH07XG4gIGlmICh0eXBlb2Ygc3RhcnQgPT0gJ251bWJlcicgJiYgdHlwZW9mIGVuZCA9PSAnbnVtYmVyJykge1xuICAgIC8qKlxuICAgICAqIGNhbGMgb3ZlcmxhcHBpbmcgcmF0ZVxuICAgICAqKi9cbiAgICB2YXIgbGVmdCAgPSBNYXRoLm1heCh0aGlzLnN0YXJ0LCBzdGFydCk7XG4gICAgdmFyIHJpZ2h0ID0gTWF0aC5taW4odGhpcy5lbmQsICAgZW5kKTtcbiAgICB2YXIgbGFwTG4gPSByaWdodCAtIGxlZnQ7XG4gICAgcmV0LnJhdGUxID0gbGFwTG4gLyAoZW5kIC0gc3RhcnQpO1xuICAgIHJldC5yYXRlMiA9IGxhcExuIC8gKHRoaXMuZW5kIC0gdGhpcy5zdGFydCk7XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIER1cGxpY2F0ZUVycm9yKG1lc3NhZ2UpIHtcbiAgICB0aGlzLm5hbWUgPSAnRHVwbGljYXRlRXJyb3InO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy5zdGFjayA9IChuZXcgRXJyb3IoKSkuc3RhY2s7XG59XG5EdXBsaWNhdGVFcnJvci5wcm90b3R5cGUgPSBuZXcgRXJyb3I7XG5cbmV4cG9ydHMuSW50ZXJ2YWxUcmVlID0gSW50ZXJ2YWxUcmVlO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IExpbmVNYXNrOiBBICh2ZXJ5IGNoZWFwKSBhbHRlcm5hdGl2ZSB0byBJbnRlcnZhbFRyZWU6IGEgc21hbGwsIDFEIHBpeGVsIGJ1ZmZlciBvZiBvYmplY3RzLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIFxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy5qcycpLFxuICBmbG9vckhhY2sgPSB1dGlscy5mbG9vckhhY2s7XG5cbmZ1bmN0aW9uIExpbmVNYXNrKHdpZHRoLCBmdWRnZSkge1xuICB0aGlzLmZ1ZGdlID0gZnVkZ2UgPSAoZnVkZ2UgfHwgMSk7XG4gIHRoaXMuaXRlbXMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSBNYXRoLmNlaWwod2lkdGggLyBmdWRnZSk7XG4gIHRoaXMubWFzayA9IGdsb2JhbC5VaW50OEFycmF5ID8gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpIDogbmV3IEFycmF5KHRoaXMubGVuZ3RoKTtcbn1cblxuTGluZU1hc2sucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHgsIHcsIGRhdGEpIHtcbiAgdmFyIHVwVG8gPSBNYXRoLmNlaWwoKHggKyB3KSAvIHRoaXMuZnVkZ2UpO1xuICB0aGlzLml0ZW1zLnB1c2goe3g6IHgsIHc6IHcsIGRhdGE6IGRhdGF9KTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgdGhpcy5tYXNrW2ldID0gMTsgfVxufTtcblxuTGluZU1hc2sucHJvdG90eXBlLmNvbmZsaWN0ID0gZnVuY3Rpb24oeCwgdykge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIGZvciAodmFyIGkgPSBNYXRoLm1heChmbG9vckhhY2soeCAvIHRoaXMuZnVkZ2UpLCAwKTsgaSA8IE1hdGgubWluKHVwVG8sIHRoaXMubGVuZ3RoKTsgaSsrKSB7IGlmICh0aGlzLm1hc2tbaV0pIHJldHVybiB0cnVlOyB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbmV4cG9ydHMuTGluZU1hc2sgPSBMaW5lTWFzaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7ICBcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBXcmFwcyB0d28gb2YgU2hpbiBTdXp1a2kncyBJbnRlcnZhbFRyZWVzIHRvIHN0b3JlIGludGVydmFscyB0aGF0ICptYXkqXG4gKiBiZSBwYWlyZWQuXG4gKlxuICogQHNlZSBJbnRlcnZhbFRyZWUoKVxuICoqL1xuZnVuY3Rpb24gUGFpcmVkSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucykge1xuICB0aGlzLnVucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIG9wdGlvbnMpO1xuICB0aGlzLnBhaXJlZCA9IG5ldyBJbnRlcnZhbFRyZWUoY2VudGVyLCBvcHRpb25zKTtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIC8vIFRPRE86IGFkZCB0byBlYWNoIG9mIHRoaXMucGFpcmVkIGFuZCB0aGlzLnVucGFpcmVkLlxufTtcblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICAvLyBUT0RPOiBhZGQgdG8gZWFjaCBvZiB0aGlzLnBhaXJlZCBhbmQgdGhpcy51bnBhaXJlZC5cbiAgdGhpcy51bnBhaXJlZC5hZGRJZk5ldyhkYXRhLCBpZCk7XG59XG5cblxuLyoqXG4gKiBzZWFyY2hcbiAqXG4gKiBAcGFyYW0gKGludGVnZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyLCBwYWlyZWQpIHtcbiAgY29uc29sZS5sb2cocGFpcmVkKTtcbiAgcmV0dXJuIHRoaXMudW5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xufTtcblxuXG4vKipcbiAqIHJlbW92ZTogdW5pbXBsZW1lbnRlZCBmb3Igbm93XG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cbmV4cG9ydHMuUGFpcmVkSW50ZXJ2YWxUcmVlID0gUGFpcmVkSW50ZXJ2YWxUcmVlO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuXG52YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrXG4gICpcbiAgKiBBIGhlbHBlciBjbGFzcyBidWlsdCBmb3IgY2FjaGluZyBkYXRhIGZldGNoZWQgZnJvbSBhIHJlbW90ZSB0cmFjayAoZGF0YSBhbGlnbmVkIHRvIGEgZ2Vub21lKS5cbiAgKiBUaGUgZ2Vub21lIGlzIGRpdmlkZWQgaW50byBiaW5zIG9mIG9wdGltYWxGZXRjaFdpbmRvdyBudHMsIGZvciBlYWNoIG9mIHdoaWNoIGRhdGEgd2lsbCBvbmx5IGJlIGZldGNoZWQgb25jZS5cbiAgKiBUbyBzZXR1cCB0aGUgYmlucywgY2FsbCAuc2V0dXBCaW5zKC4uLikgYWZ0ZXIgaW5pdGlhbGl6aW5nIHRoZSBjbGFzcy5cbiAgKlxuICAqIFRoZXJlIGlzIG9uZSBtYWluIHB1YmxpYyBtZXRob2QgZm9yIHRoaXMgY2xhc3M6IC5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIGNhbGxiYWNrKVxuICAqIChGb3IgY29uc2lzdGVuY3kgd2l0aCBDdXN0b21UcmFja3MuanMsIGFsbCBgc3RhcnRgIGFuZCBgZW5kYCBwb3NpdGlvbnMgYXJlIDEtYmFzZWQsIG9yaWVudGVkIHRvXG4gICogdGhlIHN0YXJ0IG9mIHRoZSBnZW5vbWUsIGFuZCBpbnRlcnZhbHMgYXJlIHJpZ2h0LW9wZW4uKVxuICAqXG4gICogVGhpcyBtZXRob2Qgd2lsbCByZXF1ZXN0IGFuZCBjYWNoZSBkYXRhIGZvciB0aGUgZ2l2ZW4gaW50ZXJ2YWwgdGhhdCBpcyBub3QgYWxyZWFkeSBjYWNoZWQsIGFuZCBjYWxsIFxuICAqIGNhbGxiYWNrKGludGVydmFscykgYXMgc29vbiBhcyBkYXRhIGZvciBhbGwgaW50ZXJ2YWxzIGlzIGF2YWlsYWJsZS4gKElmIHRoZSBkYXRhIGlzIGFscmVhZHkgYXZhaWxhYmxlLCBcbiAgKiBpdCB3aWxsIGNhbGwgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5LilcbiAgKiovXG5cbnZhciBCSU5fTE9BRElORyA9IDEsXG4gIEJJTl9MT0FERUQgPSAyO1xuXG4vKipcbiAgKiBSZW1vdGVUcmFjayBjb25zdHJ1Y3Rvci5cbiAgKlxuICAqIE5vdGUgeW91IHN0aWxsIG11c3QgY2FsbCBgLnNldHVwQmlucyguLi4pYCBiZWZvcmUgdGhlIFJlbW90ZVRyYWNrIGlzIHJlYWR5IHRvIGZldGNoIGRhdGEuXG4gICpcbiAgKiBAcGFyYW0gKEludGVydmFsVHJlZSkgY2FjaGU6IEFuIGNhY2hlIHN0b3JlIHRoYXQgd2lsbCByZWNlaXZlIGludGVydmFscyBmZXRjaGVkIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNob3VsZCBiZSBhbiBJbnRlcnZhbFRyZWUgb3IgZXF1aXZhbGVudCwgdGhhdCBpbXBsZW1lbnRzIGAuYWRkSWZOZXcoLi4uKWAgYW5kIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYC5zZWFyY2goc3RhcnQsIGVuZClgIG1ldGhvZHMuIElmIGl0IGlzIGFuICpleHRlbnNpb24qIG9mIGFuIEludGVydmFsVHJlZSwgbm90ZSBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBgZXh0cmFBcmdzYCBwYXJhbSBwZXJtaXR0ZWQgZm9yIGAuZmV0Y2hBc3luYygpYCwgd2hpY2ggYXJlIHBhc3NlZCBhbG9uZyBhcyBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4dHJhIGFyZ3VtZW50cyB0byBgLnNlYXJjaCgpYC5cbiAgKiBAcGFyYW0gKGZ1bmN0aW9uKSBmZXRjaGVyOiBBIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgdG8gZmV0Y2ggZGF0YSBmb3IgZWFjaCBiaW4uXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgVGhpcyBmdW5jdGlvbiBzaG91bGQgdGFrZSB0aHJlZSBhcmd1bWVudHMsIGBzdGFydGAsIGBlbmRgLCBhbmQgYHN0b3JlSW50ZXJ2YWxzYC5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgc3RhcnRgIGFuZCBgZW5kYCBhcmUgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdG9yZUludGVydmFsc2AgaXMgYSBjYWxsYmFjayB0aGF0IGBmZXRjaGVyYCBNVVNUIGNhbGwgb24gdGhlIGFycmF5IG9mIGludGVydmFsc1xuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uY2UgdGhleSBoYXZlIGJlZW4gZmV0Y2hlZCBmcm9tIHRoZSByZW1vdGUgZGF0YSBzb3VyY2UgYW5kIHBhcnNlZC5cbiAgKiBAc2VlIF9mZXRjaEJpbiBmb3IgaG93IGBmZXRjaGVyYCBpcyB1dGlsaXplZC5cbiAgKiovXG5mdW5jdGlvbiBSZW1vdGVUcmFjayhjYWNoZSwgZmV0Y2hlcikge1xuICBpZiAodHlwZW9mIGNhY2hlICE9ICdvYmplY3QnIHx8ICghY2FjaGUuYWRkSWZOZXcgJiYgKCFfLmtleXMoY2FjaGUpLmxlbmd0aCB8fCBjYWNoZVtfLmtleXMoY2FjaGUpWzBdXS5hZGRJZk5ldykpKSB7IFxuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBhbiBJbnRlcnZhbFRyZWUgY2FjaGUsIG9yIGFuIG9iamVjdC9hcnJheSBjb250YWluaW5nIEludGVydmFsVHJlZXMsIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IFxuICB9XG4gIGlmICh0eXBlb2YgZmV0Y2hlciAhPSAnZnVuY3Rpb24nKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBhIGZldGNoZXIgZnVuY3Rpb24gYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBcbiAgdGhpcy5jYWNoZSA9IGNhY2hlO1xuICB0aGlzLmZldGNoZXIgPSBmZXRjaGVyO1xuICBcbiAgdGhpcy5jYWxsYmFja3MgPSBbXTtcbiAgdGhpcy5hZnRlckJpblNldHVwID0gW107XG4gIHRoaXMuYmluc0xvYWRlZCA9IG51bGw7XG59XG5cbi8qKlxuICogcHVibGljIG1ldGhvZHNcbiAqKi9cblxuLy8gU2V0dXAgdGhlIGJpbm5pbmcgc2NoZW1lIGZvciB0aGlzIFJlbW90ZVRyYWNrLiBUaGlzIGNhbiBvY2N1ciBhbnl0aW1lIGFmdGVyIGluaXRpYWxpemF0aW9uLCBhbmQgaW4gZmFjdCxcbi8vIGNhbiBvY2N1ciBhZnRlciBjYWxscyB0byBgLmZldGNoQXN5bmMoKWAgaGF2ZSBiZWVuIG1hZGUsIGluIHdoaWNoIGNhc2UgdGhleSB3aWxsIGJlIHdhaXRpbmcgb24gdGhpcyBtZXRob2Rcbi8vIHRvIGJlIGNhbGxlZCB0byBwcm9jZWVkLiBCdXQgaXQgTVVTVCBiZSBjYWxsZWQgYmVmb3JlIGRhdGEgd2lsbCBiZSByZWNlaXZlZCBieSBjYWxsYmFja3MgcGFzc2VkIHRvIFxuLy8gYC5mZXRjaEFzeW5jKClgLlxuUmVtb3RlVHJhY2sucHJvdG90eXBlLnNldHVwQmlucyA9IGZ1bmN0aW9uKGdlbm9tZVNpemUsIG9wdGltYWxGZXRjaFdpbmRvdywgbWF4RmV0Y2hXaW5kb3cpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoc2VsZi5iaW5zTG9hZGVkKSB7IHRocm93IG5ldyBFcnJvcigneW91IGNhbm5vdCBydW4gc2V0dXBCaW5zIG1vcmUgdGhhbiBvbmNlLicpOyB9XG4gIGlmICh0eXBlb2YgZ2Vub21lU2l6ZSAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgdGhlIGdlbm9tZVNpemUgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG9wdGltYWxGZXRjaFdpbmRvdyAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgb3B0aW1hbEZldGNoV2luZG93IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBtYXhGZXRjaFdpbmRvdyAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWF4RmV0Y2hXaW5kb3cgYXMgdGhlIDNyZCBhcmd1bWVudC4nKTsgfVxuICBcbiAgc2VsZi5nZW5vbWVTaXplID0gZ2Vub21lU2l6ZTtcbiAgc2VsZi5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBvcHRpbWFsRmV0Y2hXaW5kb3c7XG4gIHNlbGYubWF4RmV0Y2hXaW5kb3cgPSBtYXhGZXRjaFdpbmRvdztcbiAgXG4gIHNlbGYubnVtQmlucyA9IE1hdGguY2VpbChnZW5vbWVTaXplIC8gb3B0aW1hbEZldGNoV2luZG93KTtcbiAgc2VsZi5iaW5zTG9hZGVkID0ge307XG4gIFxuICAvLyBGaXJlIG9mZiByYW5nZXMgc2F2ZWQgdG8gYWZ0ZXJCaW5TZXR1cFxuICBfLmVhY2godGhpcy5hZnRlckJpblNldHVwLCBmdW5jdGlvbihyYW5nZSkge1xuICAgIHNlbGYuZmV0Y2hBc3luYyhyYW5nZS5zdGFydCwgcmFuZ2UuZW5kLCByYW5nZS5leHRyYUFyZ3MpO1xuICB9KTtcbiAgX2NsZWFyQ2FsbGJhY2tzRm9yVG9vQmlnSW50ZXJ2YWxzKHNlbGYpO1xufVxuXG5cbi8vIEZldGNoZXMgZGF0YSAoaWYgbmVjZXNzYXJ5KSBmb3IgdW5mZXRjaGVkIGJpbnMgb3ZlcmxhcHBpbmcgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gVGhlbiwgcnVuIGBjYWxsYmFja2Agb24gYWxsIHN0b3JlZCBzdWJpbnRlcnZhbHMgdGhhdCBvdmVybGFwIHdpdGggdGhlIGludGVydmFsIGZyb20gYHN0YXJ0YCB0byBgZW5kYC5cbi8vIGBleHRyYUFyZ2AgaXMgYW4gKm9wdGlvbmFsKiBwYXJhbWV0ZXIgdGhhdCBpcyBwYXNzZWQgYWxvbmcgdG8gdGhlIGAuc2VhcmNoKClgIGZ1bmN0aW9uIG9mIHRoZSBjYWNoZS5cbi8vXG4vLyBAcGFyYW0gKG51bWJlcikgc3RhcnQ6ICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIHRvIHN0YXJ0IGZldGNoaW5nIGZyb21cbi8vIEBwYXJhbSAobnVtYmVyKSBlbmQ6ICAgICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgKHJpZ2h0LW9wZW4pIHRvIHN0YXJ0IGZldGNoaW5nICp1bnRpbCpcbi8vIEBwYXJhbSAoQXJyYXkpIFtleHRyYUFyZ3NdOiAgb3B0aW9uYWwsIHBhc3NlZCBhbG9uZyB0byB0aGUgYC5zZWFyY2goKWAgY2FsbHMgb24gdGhlIC5jYWNoZSBhcyBhcmd1bWVudHMgMyBhbmQgdXA7IFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJoYXBzIHVzZWZ1bCBpZiB0aGUgLmNhY2hlIGhhcyBvdmVycmlkZGVuIHRoaXMgbWV0aG9kXG4vLyBAcGFyYW0gKGZ1bmN0aW9uKSBjYWxsYmFjazogIEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCBvbmNlIGRhdGEgaXMgcmVhZHkgZm9yIHRoaXMgaW50ZXJ2YWwuIFdpbGwgYmUgcGFzc2VkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbCBpbnRlcnZhbCBmZWF0dXJlcyB0aGF0IGhhdmUgYmVlbiBmZXRjaGVkIGZvciB0aGlzIGludGVydmFsLCBvciB7dG9vTWFueTogdHJ1ZX1cbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgbW9yZSBkYXRhIHdhcyByZXF1ZXN0ZWQgdGhhbiBjb3VsZCBiZSByZWFzb25hYmx5IGZldGNoZWQuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuZmV0Y2hBc3luYyA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGV4dHJhQXJncywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc0Z1bmN0aW9uKGV4dHJhQXJncykgJiYgXy5pc1VuZGVmaW5lZChjYWxsYmFjaykpIHsgY2FsbGJhY2sgPSBleHRyYUFyZ3M7IGV4dHJhQXJncyA9IHVuZGVmaW5lZDsgfVxuICBpZiAoIXNlbGYuYmluc0xvYWRlZCkge1xuICAgIC8vIElmIGJpbnMgKmFyZW4ndCogc2V0dXAgeWV0OlxuICAgIC8vIFNhdmUgdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyBTYXZlIHRoaXMgZmV0Y2ggZm9yIHdoZW4gdGhlIGJpbnMgYXJlIGxvYWRlZFxuICAgIHNlbGYuYWZ0ZXJCaW5TZXR1cC5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJnc30pO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGJpbnMgKmFyZSogc2V0dXAsIGZpcnN0IGNhbGN1bGF0ZSB3aGljaCBiaW5zIGNvcnJlc3BvbmQgdG8gdGhpcyBpbnRlcnZhbCwgXG4gICAgLy8gYW5kIHdoYXQgc3RhdGUgdGhvc2UgYmlucyBhcmUgaW5cbiAgICB2YXIgYmlucyA9IF9iaW5PdmVybGFwKHNlbGYsIHN0YXJ0LCBlbmQpLFxuICAgICAgbG9hZGVkQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHNlbGYuYmluc0xvYWRlZFtpXSA9PT0gQklOX0xPQURFRDsgfSksXG4gICAgICBiaW5zVG9GZXRjaCA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuICFzZWxmLmJpbnNMb2FkZWRbaV07IH0pO1xuICAgIFxuICAgIGlmIChsb2FkZWRCaW5zLmxlbmd0aCA9PSBiaW5zLmxlbmd0aCkge1xuICAgICAgLy8gSWYgd2UndmUgYWxyZWFkeSBsb2FkZWQgZGF0YSBmb3IgYWxsIHRoZSBiaW5zIGluIHF1ZXN0aW9uLCBzaG9ydC1jaXJjdWl0IGFuZCBydW4gdGhlIGNhbGxiYWNrIG5vd1xuICAgICAgZXh0cmFBcmdzID0gXy5pc1VuZGVmaW5lZChleHRyYUFyZ3MpID8gW10gOiBleHRyYUFyZ3M7XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayhzZWxmLmNhY2hlLnNlYXJjaC5hcHBseShzZWxmLmNhY2hlLCBbc3RhcnQsIGVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICB9IGVsc2UgaWYgKGVuZCAtIHN0YXJ0ID4gc2VsZi5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgLy8gZWxzZSwgaWYgdGhpcyBpbnRlcnZhbCBpcyB0b28gYmlnICg+IG1heEZldGNoV2luZG93KSwgZmlyZSB0aGUgY2FsbGJhY2sgcmlnaHQgYXdheSB3aXRoIHt0b29NYW55OiB0cnVlfVxuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gZWxzZSwgcHVzaCB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnOiBleHRyYUFyZywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyB0aGVuIHJ1biBmZXRjaGVzIGZvciB0aGUgdW5mZXRjaGVkIGJpbnMsIHdoaWNoIHNob3VsZCBjYWxsIF9maXJlQ2FsbGJhY2tzIGFmdGVyIHRoZXkgY29tcGxldGUsXG4gICAgLy8gd2hpY2ggd2lsbCBhdXRvbWF0aWNhbGx5IGZpcmUgY2FsbGJhY2tzIGZyb20gdGhlIGFib3ZlIHF1ZXVlIGFzIHRoZXkgYWNxdWlyZSBhbGwgbmVlZGVkIGRhdGEuXG4gICAgXy5lYWNoKGJpbnNUb0ZldGNoLCBmdW5jdGlvbihiaW5JbmRleCkge1xuICAgICAgX2ZldGNoQmluKHNlbGYsIGJpbkluZGV4LCBmdW5jdGlvbigpIHsgX2ZpcmVDYWxsYmFja3Moc2VsZik7IH0pO1xuICAgIH0pO1xuICB9XG59XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2FsY3VsYXRlcyB3aGljaCBiaW5zIG92ZXJsYXAgd2l0aCBhbiBpbnRlcnZhbCBnaXZlbiBieSBgc3RhcnRgIGFuZCBgZW5kYC5cbi8vIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuZnVuY3Rpb24gX2Jpbk92ZXJsYXAocmVtb3RlVHJrLCBzdGFydCwgZW5kKSB7XG4gIGlmICghcmVtb3RlVHJrLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IGNhbGN1bGF0ZSBiaW4gb3ZlcmxhcCBiZWZvcmUgc2V0dXBCaW5zIGlzIGNhbGxlZC4nKTsgfVxuICAvLyBJbnRlcm5hbGx5LCBmb3IgYXNzaWduaW5nIGNvb3JkaW5hdGVzIHRvIGJpbnMsIHdlIHVzZSAwLWJhc2VkIGNvb3JkaW5hdGVzIGZvciBlYXNpZXIgY2FsY3VsYXRpb25zLlxuICB2YXIgc3RhcnRCaW4gPSBNYXRoLmZsb29yKChzdGFydCAtIDEpIC8gcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyksXG4gICAgZW5kQmluID0gTWF0aC5mbG9vcigoZW5kIC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KTtcbiAgcmV0dXJuIF8ucmFuZ2Uoc3RhcnRCaW4sIGVuZEJpbiArIDEpO1xufVxuXG4vLyBSdW5zIHRoZSBmZXRjaGVyIGZ1bmN0aW9uIG9uIGEgZ2l2ZW4gYmluLlxuLy8gVGhlIGZldGNoZXIgZnVuY3Rpb24gaXMgb2JsaWdhdGVkIHRvIHJ1biBhIGNhbGxiYWNrIGZ1bmN0aW9uIGBzdG9yZUludGVydmFsc2AsIFxuLy8gICAgcGFzc2VkIGFzIGl0cyB0aGlyZCBhcmd1bWVudCwgb24gYSBzZXQgb2YgaW50ZXJ2YWxzIHRoYXQgd2lsbCBiZSBpbnNlcnRlZCBpbnRvIHRoZSBcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBJbnRlcnZhbFRyZWUuXG4vLyBUaGUgYHN0b3JlSW50ZXJ2YWxzYCBmdW5jdGlvbiBtYXkgYWNjZXB0IGEgc2Vjb25kIGFyZ3VtZW50IGNhbGxlZCBgY2FjaGVJbmRleGAsIGluIGNhc2Vcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBpcyBhY3R1YWxseSBhIGNvbnRhaW5lciBmb3IgbXVsdGlwbGUgSW50ZXJ2YWxUcmVlcywgaW5kaWNhdGluZyB3aGljaCBcbi8vICAgIG9uZSB0byBzdG9yZSBpdCBpbi5cbi8vIFdlIHRoZW4gY2FsbCB0aGUgYGNhbGxiYWNrYCBnaXZlbiBoZXJlIGFmdGVyIHRoYXQgaXMgY29tcGxldGUuXG5mdW5jdGlvbiBfZmV0Y2hCaW4ocmVtb3RlVHJrLCBiaW5JbmRleCwgY2FsbGJhY2spIHtcbiAgdmFyIHN0YXJ0ID0gYmluSW5kZXggKiByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93ICsgMSxcbiAgICBlbmQgPSAoYmluSW5kZXggKyAxKSAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxO1xuICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BRElORztcbiAgcmVtb3RlVHJrLmZldGNoZXIoc3RhcnQsIGVuZCwgZnVuY3Rpb24gc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKSB7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIGlmICghaW50ZXJ2YWwpIHsgcmV0dXJuOyB9XG4gICAgICByZW1vdGVUcmsuY2FjaGUuYWRkSWZOZXcoaW50ZXJ2YWwsIGludGVydmFsLmlkKTtcbiAgICB9KTtcbiAgICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BREVEO1xuICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgfSk7XG59XG5cbi8vIFJ1bnMgdGhyb3VnaCBhbGwgc2F2ZWQgY2FsbGJhY2tzIGFuZCBmaXJlcyBhbnkgY2FsbGJhY2tzIHdoZXJlIGFsbCB0aGUgcmVxdWlyZWQgZGF0YSBpcyByZWFkeVxuLy8gQ2FsbGJhY2tzIHRoYXQgYXJlIGZpcmVkIGFyZSByZW1vdmVkIGZyb20gdGhlIHF1ZXVlLlxuZnVuY3Rpb24gX2ZpcmVDYWxsYmFja3MocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2ssXG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGFmdGVyTG9hZC5leHRyYUFyZ3MpID8gW10gOiBhZnRlckxvYWQuZXh0cmFBcmdzLFxuICAgICAgYmlucywgc3RpbGxMb2FkaW5nQmlucztcbiAgICAgICAgXG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIGJpbnMgPSBfYmluT3ZlcmxhcChyZW1vdGVUcmssIGFmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZCk7XG4gICAgc3RpbGxMb2FkaW5nQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHJlbW90ZVRyay5iaW5zTG9hZGVkW2ldICE9PSBCSU5fTE9BREVEOyB9KS5sZW5ndGggPiAwO1xuICAgIGlmICghc3RpbGxMb2FkaW5nQmlucykge1xuICAgICAgY2FsbGJhY2socmVtb3RlVHJrLmNhY2hlLnNlYXJjaC5hcHBseShyZW1vdGVUcmsuY2FjaGUsIFthZnRlckxvYWQuc3RhcnQsIGFmdGVyTG9hZC5lbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3MgZm9yIHdoaWNoIHdlIHdvbid0IGxvYWQgZGF0YSBzaW5jZSB0aGUgYW1vdW50XG4vLyByZXF1ZXN0ZWQgaXMgdG9vIGxhcmdlLiBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2s7XG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuXG5leHBvcnRzLlJlbW90ZVRyYWNrID0gUmVtb3RlVHJhY2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvU29ydGVkTGlzdFxuICpcbiAqIFNvcnRlZExpc3QgOiBjb25zdHJ1Y3RvclxuICogXG4gKiBAcGFyYW0gYXJyIDogQXJyYXkgb3IgbnVsbCA6IGFuIGFycmF5IHRvIHNldFxuICpcbiAqIEBwYXJhbSBvcHRpb25zIDogb2JqZWN0ICBvciBudWxsXG4gKiAgICAgICAgIChmdW5jdGlvbikgZmlsdGVyICA6IGZpbHRlciBmdW5jdGlvbiBjYWxsZWQgYmVmb3JlIGluc2VydGluZyBkYXRhLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIHJlY2VpdmVzIGEgdmFsdWUgYW5kIHJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdmFsaWQuXG4gKlxuICogICAgICAgICAoZnVuY3Rpb24pIGNvbXBhcmUgOiBmdW5jdGlvbiB0byBjb21wYXJlIHR3byB2YWx1ZXMsIFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGljaCBpcyB1c2VkIGZvciBzb3J0aW5nIG9yZGVyLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgc2FtZSBzaWduYXR1cmUgYXMgQXJyYXkucHJvdG90eXBlLnNvcnQoZm4pLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAqICAgICAgICAgKHN0cmluZykgICBjb21wYXJlIDogaWYgeW91J2QgbGlrZSB0byBzZXQgYSBjb21tb24gY29tcGFyaXNvbiBmdW5jdGlvbixcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeW91IGNhbiBzcGVjaWZ5IGl0IGJ5IHN0cmluZzpcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJudW1iZXJcIiA6IGNvbXBhcmVzIG51bWJlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcInN0cmluZ1wiIDogY29tcGFyZXMgc3RyaW5nXG4gKi9cbmZ1bmN0aW9uIFNvcnRlZExpc3QoKSB7XG4gIHZhciBhcnIgICAgID0gbnVsbCxcbiAgICAgIG9wdGlvbnMgPSB7fSxcbiAgICAgIGFyZ3MgICAgPSBhcmd1bWVudHM7XG5cbiAgW1wiMFwiLFwiMVwiXS5mb3JFYWNoKGZ1bmN0aW9uKG4pIHtcbiAgICB2YXIgdmFsID0gYXJnc1tuXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG4gICAgICBhcnIgPSB2YWw7XG4gICAgfVxuICAgIGVsc2UgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09IFwib2JqZWN0XCIpIHtcbiAgICAgIG9wdGlvbnMgPSB2YWw7XG4gICAgfVxuICB9KTtcbiAgdGhpcy5hcnIgPSBbXTtcblxuICBbXCJmaWx0ZXJcIiwgXCJjb21wYXJlXCJdLmZvckVhY2goZnVuY3Rpb24oaykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9uc1trXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRoaXNba10gPSBvcHRpb25zW2tdO1xuICAgIH1cbiAgICBlbHNlIGlmIChvcHRpb25zW2tdICYmIFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV0pIHtcbiAgICAgIHRoaXNba10gPSBTb3J0ZWRMaXN0W2tdW29wdGlvbnNba11dO1xuICAgIH1cbiAgfSwgdGhpcyk7XG4gIGlmIChhcnIpIHRoaXMubWFzc0luc2VydChhcnIpO1xufTtcblxuLy8gQmluYXJ5IHNlYXJjaCBmb3IgdGhlIGluZGV4IG9mIHRoZSBpdGVtIGVxdWFsIHRvIGB2YWxgLCBvciBpZiBubyBzdWNoIGl0ZW0gZXhpc3RzLCB0aGUgbmV4dCBsb3dlciBpdGVtXG4vLyBUaGlzIGNhbiBiZSAtMSBpZiBgdmFsYCBpcyBsb3dlciB0aGFuIHRoZSBsb3dlc3QgaXRlbSBpbiB0aGUgU29ydGVkTGlzdFxuU29ydGVkTGlzdC5wcm90b3R5cGUuYnNlYXJjaCA9IGZ1bmN0aW9uKHZhbCkge1xuICB2YXIgbXBvcyxcbiAgICAgIHNwb3MgPSAwLFxuICAgICAgZXBvcyA9IHRoaXMuYXJyLmxlbmd0aDtcbiAgd2hpbGUgKGVwb3MgLSBzcG9zID4gMSkge1xuICAgIG1wb3MgPSBNYXRoLmZsb29yKChzcG9zICsgZXBvcykvMik7XG4gICAgbXZhbCA9IHRoaXMuYXJyW21wb3NdO1xuICAgIHN3aXRjaCAodGhpcy5jb21wYXJlKHZhbCwgbXZhbCkpIHtcbiAgICBjYXNlIDEgIDpcbiAgICBkZWZhdWx0IDpcbiAgICAgIHNwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAtMSA6XG4gICAgICBlcG9zID0gbXBvcztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMCAgOlxuICAgICAgcmV0dXJuIG1wb3M7XG4gICAgfVxuICB9XG4gIHJldHVybiAodGhpcy5hcnJbMF0gPT0gbnVsbCB8fCBzcG9zID09IDAgJiYgdGhpcy5hcnJbMF0gIT0gbnVsbCAmJiB0aGlzLmNvbXBhcmUodGhpcy5hcnJbMF0sIHZhbCkgPT0gMSkgPyAtMSA6IHNwb3M7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyW3Bvc107XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHJldHVybiB0aGlzLmFyci5zbGljZSgpO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlLmFwcGx5KHRoaXMuYXJyLCBhcmd1bWVudHMpO1xufVxuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyci5sZW5ndGg7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5oZWFkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyclswXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRhaWwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICh0aGlzLmFyci5sZW5ndGggPT0gMCkgPyBudWxsIDogdGhpcy5hcnJbdGhpcy5hcnIubGVuZ3RoIC0xXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLm1hc3NJbnNlcnQgPSBmdW5jdGlvbihpdGVtcykge1xuICAvLyBUaGlzIGxvb3AgYXZvaWRzIGNhbGwgc3RhY2sgb3ZlcmZsb3cgYmVjYXVzZSBvZiB0b28gbWFueSBhcmd1bWVudHNcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gNDA5Nikge1xuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHRoaXMuYXJyLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChpdGVtcywgaSwgaSArIDQwOTYpKTtcbiAgfVxuICB0aGlzLmFyci5zb3J0KHRoaXMuY29tcGFyZSk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEwMCkge1xuICAgIC8vIC5ic2VhcmNoICsgLnNwbGljZSBpcyB0b28gZXhwZW5zaXZlIHRvIHJlcGVhdCBmb3Igc28gbWFueSBlbGVtZW50cy5cbiAgICAvLyBMZXQncyBqdXN0IGFwcGVuZCB0aGVtIGFsbCB0byB0aGlzLmFyciBhbmQgcmVzb3J0LlxuICAgIHRoaXMubWFzc0luc2VydChhcmd1bWVudHMpO1xuICB9IGVsc2Uge1xuICAgIEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbih2YWwpIHtcbiAgICAgIHZhciBwb3MgPSB0aGlzLmJzZWFyY2godmFsKTtcbiAgICAgIGlmICh0aGlzLmZpbHRlcih2YWwsIHBvcykpIHtcbiAgICAgICAgdGhpcy5hcnIuc3BsaWNlKHBvcysxLCAwLCB2YWwpO1xuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICB9XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5maWx0ZXIgPSBmdW5jdGlvbih2YWwsIHBvcykge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmFkZCA9IFNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydDtcblxuU29ydGVkTGlzdC5wcm90b3R5cGVbXCJkZWxldGVcIl0gPSBmdW5jdGlvbihwb3MpIHtcbiAgdGhpcy5hcnIuc3BsaWNlKHBvcywgMSk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBTb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc1JlbW92ZSA9IGZ1bmN0aW9uKHN0YXJ0UG9zLCBjb3VudCkge1xuICB0aGlzLmFyci5zcGxpY2Uoc3RhcnRQb3MsIGNvdW50KTtcbn07XG5cbi8qKlxuICogZGVmYXVsdCBjb21wYXJlIGZ1bmN0aW9ucyBcbiAqKi9cblNvcnRlZExpc3QuY29tcGFyZSA9IHtcbiAgXCJudW1iZXJcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBjID0gYSAtIGI7XG4gICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICB9LFxuXG4gIFwic3RyaW5nXCI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gKGEgPiBiKSA/IDEgOiAoYSA9PSBiKSAgPyAwIDogLTE7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmNvbXBhcmUgPSBTb3J0ZWRMaXN0LmNvbXBhcmVbXCJudW1iZXJcIl07XG5cbmV4cG9ydHMuU29ydGVkTGlzdCA9IFNvcnRlZExpc3Q7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIvLyBQYXJzZSBhIHRyYWNrIGRlY2xhcmF0aW9uIGxpbmUsIHdoaWNoIGlzIGluIHRoZSBmb3JtYXQgb2Y6XG4vLyB0cmFjayBuYW1lPVwiYmxhaFwiIG9wdG5hbWUxPVwidmFsdWUxXCIgb3B0bmFtZTI9XCJ2YWx1ZTJcIiAuLi5cbi8vIGludG8gYSBoYXNoIG9mIG9wdGlvbnNcbm1vZHVsZS5leHBvcnRzLnBhcnNlRGVjbGFyYXRpb25MaW5lID0gZnVuY3Rpb24obGluZSwgc3RhcnQpIHtcbiAgdmFyIG9wdHMgPSB7fSwgb3B0bmFtZSA9ICcnLCB2YWx1ZSA9ICcnLCBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgZnVuY3Rpb24gcHVzaFZhbHVlKHF1b3RpbmcpIHtcbiAgICBzdGF0ZSA9ICdvcHRuYW1lJztcbiAgICBvcHRzW29wdG5hbWUucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXSA9IHZhbHVlO1xuICAgIG9wdG5hbWUgPSB2YWx1ZSA9ICcnO1xuICB9XG4gIGZvciAoaSA9IGxpbmUubWF0Y2goc3RhcnQpWzBdLmxlbmd0aDsgaSA8IGxpbmUubGVuZ3RoOyBpKyspIHtcbiAgICBjID0gbGluZVtpXTtcbiAgICBpZiAoc3RhdGUgPT0gJ29wdG5hbWUnKSB7XG4gICAgICBpZiAoYyA9PSAnPScpIHsgc3RhdGUgPSAnc3RhcnR2YWx1ZSc7IH1cbiAgICAgIGVsc2UgeyBvcHRuYW1lICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICdzdGFydHZhbHVlJykge1xuICAgICAgaWYgKC8nfFwiLy50ZXN0KGMpKSB7IHN0YXRlID0gYzsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IHN0YXRlID0gJ3ZhbHVlJzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykge1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykpIHsgcHVzaFZhbHVlKCk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmICgvJ3xcIi8udGVzdChzdGF0ZSkpIHtcbiAgICAgIGlmIChjID09IHN0YXRlKSB7IHB1c2hWYWx1ZShzdGF0ZSk7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyB9XG4gICAgfVxuICB9XG4gIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7IHB1c2hWYWx1ZSgpOyB9XG4gIGlmIChzdGF0ZSAhPSAnb3B0bmFtZScpIHsgcmV0dXJuIGZhbHNlOyB9XG4gIHJldHVybiBvcHRzO1xufVxuXG4vLyBDb25zdHJ1Y3RzIGEgbWFwcGluZyBmdW5jdGlvbiB0aGF0IGNvbnZlcnRzIGJwIGludGVydmFscyBpbnRvIHBpeGVsIGludGVydmFscywgd2l0aCBvcHRpb25hbCBjYWxjdWxhdGlvbnMgZm9yIHRleHQgdG9vXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbENhbGN1bGF0b3IgPSBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHAsIHdpdGhUZXh0LCBuYW1lRnVuYywgc3RhcnRrZXksIGVuZGtleSkge1xuICBpZiAoIV8uaXNGdW5jdGlvbihuYW1lRnVuYykpIHsgbmFtZUZ1bmMgPSBmdW5jdGlvbihkKSB7IHJldHVybiBkLm5hbWUgfHwgJyc7IH07IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoc3RhcnRrZXkpKSB7IHN0YXJ0a2V5ID0gJ3N0YXJ0JzsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChlbmRrZXkpKSB7IGVuZGtleSA9ICdlbmQnOyB9XG4gIHJldHVybiBmdW5jdGlvbihkKSB7XG4gICAgdmFyIHBJbnQgPSB7XG4gICAgICB4OiBNYXRoLnJvdW5kKChkW3N0YXJ0a2V5XSAtIHN0YXJ0KSAvIGJwcHApLFxuICAgICAgdzogTWF0aC5yb3VuZCgoZFtlbmRrZXldIC0gZFtzdGFydGtleV0pIC8gYnBwcCkgKyAxLFxuICAgICAgdDogMCwgICAgICAgICAgLy8gY2FsY3VsYXRlZCB3aWR0aCBvZiB0ZXh0XG4gICAgICBvUHJldjogZmFsc2UsICAvLyBvdmVyZmxvd3MgaW50byBwcmV2aW91cyB0aWxlP1xuICAgICAgb05leHQ6IGZhbHNlICAgLy8gb3ZlcmZsb3dzIGludG8gbmV4dCB0aWxlP1xuICAgIH07XG4gICAgcEludC50eCA9IHBJbnQueDtcbiAgICBwSW50LnR3ID0gcEludC53O1xuICAgIGlmIChwSW50LnggPCAwKSB7IHBJbnQudyArPSBwSW50Lng7IHBJbnQueCA9IDA7IHBJbnQub1ByZXYgPSB0cnVlOyB9XG4gICAgZWxzZSBpZiAod2l0aFRleHQpIHsgXG4gICAgICBwSW50LnQgPSBNYXRoLm1pbihuYW1lRnVuYyhkKS5sZW5ndGggKiAxMCArIDIsIHBJbnQueCk7XG4gICAgICBwSW50LnR4IC09IHBJbnQudDtcbiAgICAgIHBJbnQudHcgKz0gcEludC50OyAgXG4gICAgfVxuICAgIGlmIChwSW50LnggKyBwSW50LncgPiB3aWR0aCkgeyBwSW50LncgPSB3aWR0aCAtIHBJbnQueDsgcEludC5vTmV4dCA9IHRydWU7IH1cbiAgICByZXR1cm4gcEludDtcbiAgfTtcbn07XG5cbi8vIEZvciB0d28gZ2l2ZW4gb2JqZWN0cyBvZiB0aGUgZm9ybSB7eDogMSwgdzogMn0gKHBpeGVsIGludGVydmFscyksIGRlc2NyaWJlIHRoZSBvdmVybGFwLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZXJlIGlzIG5vIG92ZXJsYXAuXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbE92ZXJsYXAgPSBmdW5jdGlvbihwSW50MSwgcEludDIpIHtcbiAgdmFyIG92ZXJsYXAgPSB7fSxcbiAgICB0bXA7XG4gIGlmIChwSW50MS54ID4gcEludDIueCkgeyB0bXAgPSBwSW50MjsgcEludDIgPSBwSW50MTsgcEludDEgPSB0bXA7IH0gICAgICAgLy8gc3dhcCBzbyB0aGF0IHBJbnQxIGlzIGFsd2F5cyBsb3dlclxuICBpZiAoIXBJbnQxLncgfHwgIXBJbnQyLncgfHwgcEludDEueCArIHBJbnQxLncgPCBwSW50Mi54KSB7IHJldHVybiBudWxsOyB9IC8vIGRldGVjdCBuby1vdmVybGFwIGNvbmRpdGlvbnNcbiAgb3ZlcmxhcC54ID0gcEludDIueDtcbiAgb3ZlcmxhcC53ID0gTWF0aC5taW4ocEludDEudyAtIHBJbnQyLnggKyBwSW50MS54LCBwSW50Mi53KTtcbiAgcmV0dXJuIG92ZXJsYXA7XG59O1xuXG4vLyBDb21tb24gZnVuY3Rpb25zIGZvciBzdW1tYXJpemluZyBkYXRhIGluIGJpbnMgd2hpbGUgcGxvdHRpbmcgd2lnZ2xlIHRyYWNrc1xubW9kdWxlLmV4cG9ydHMud2lnQmluRnVuY3Rpb25zID0ge1xuICBtaW5pbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1pbi5hcHBseShNYXRoLCBiaW4pIDogMDsgfSxcbiAgbWVhbjogZnVuY3Rpb24oYmluKSB7IHJldHVybiBfLnJlZHVjZShiaW4sIGZ1bmN0aW9uKGEsYikgeyByZXR1cm4gYSArIGI7IH0sIDApIC8gYmluLmxlbmd0aDsgfSxcbiAgbWF4aW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5tYXguYXBwbHkoTWF0aCwgYmluKSA6IDA7IH1cbn07XG5cbi8vIEZhc3RlciB0aGFuIE1hdGguZmxvb3IgKGh0dHA6Ly93ZWJkb29kLmNvbS8/cD0yMTkpXG5tb2R1bGUuZXhwb3J0cy5mbG9vckhhY2sgPSBmdW5jdGlvbihudW0pIHsgcmV0dXJuIChudW0gPDwgMCkgLSAobnVtIDwgMCA/IDEgOiAwKTsgfVxuXG4vLyBPdGhlciB0aW55IGZ1bmN0aW9ucyB0aGF0IHdlIG5lZWQgZm9yIG9kZHMgYW5kIGVuZHMuLi5cbm1vZHVsZS5leHBvcnRzLnN0cmlwID0gZnVuY3Rpb24oc3RyKSB7IHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpOyB9XG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBwYXJzZUludCh2YWwsIDEwKTsgfSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IHZjZlRhYml4IGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvdmNmLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMudmNmdGFiaXhcbnZhciBWY2ZUYWJpeEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAxMDAwMDAsXG4gICAgY2hyb21vc29tZXM6ICcnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciB2Y2ZUYWJpeCB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIC8vIFRPRE86IFNldCBtYXhGZXRjaFdpbmRvdyB1c2luZyBzb21lIGhldXJpc3RpYyBiYXNlZCBvbiBob3cgbWFueSBpdGVtcyBhcmUgaW4gdGhlIHRhYml4IGluZGV4XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVUb0ludGVydmFsKGxpbmUpIHtcbiAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KCdcXHQnKSwgZGF0YSA9IHt9LCBpbmZvID0ge307XG4gICAgICBpZiAoZmllbGRzWzddKSB7XG4gICAgICAgIF8uZWFjaChmaWVsZHNbN10uc3BsaXQoJzsnKSwgZnVuY3Rpb24obCkgeyBsID0gbC5zcGxpdCgnPScpOyBpZiAobC5sZW5ndGggPiAxKSB7IGluZm9bbFswXV0gPSBsWzFdOyB9IH0pO1xuICAgICAgfVxuICAgICAgZGF0YS5zdGFydCA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW2ZpZWxkc1swXV0gKyBwYXJzZUludDEwKGZpZWxkc1sxXSk7XG4gICAgICBkYXRhLmlkID0gZmllbGRzWzJdPT0nLicgPyAndmNmLScgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDAwMDAwMDApIDogZmllbGRzWzJdO1xuICAgICAgZGF0YS5lbmQgPSBkYXRhLnN0YXJ0ICsgMTtcbiAgICAgIGRhdGEucmVmID0gZmllbGRzWzNdO1xuICAgICAgZGF0YS5hbHQgPSBmaWVsZHNbNF07XG4gICAgICBkYXRhLnF1YWwgPSBwYXJzZUZsb2F0KGZpZWxkc1s1XSk7XG4gICAgICBkYXRhLmluZm8gPSBpbmZvO1xuICAgICAgcmV0dXJuIHtkYXRhOiBkYXRhfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbmFtZUZ1bmMoZmllbGRzKSB7XG4gICAgICB2YXIgcmVmID0gZmllbGRzLnJlZiB8fCAnJyxcbiAgICAgICAgYWx0ID0gZmllbGRzLmFsdCB8fCAnJztcbiAgICAgIHJldHVybiAocmVmLmxlbmd0aCA+IGFsdC5sZW5ndGggPyByZWYgOiBhbHQpIHx8ICcnO1xuICAgIH1cbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSxcbiAgICAgICAgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPiA4OyB9KSxcbiAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJywgbmFtZUZ1bmMpO1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICBkcmF3U3BlYy5wdXNoKGNhbGNQaXhJbnRlcnZhbChsaW5lVG9JbnRlcnZhbChsaW5lKS5kYXRhKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZHJhd1NwZWMgPSB7bGF5b3V0OiBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQoXy5tYXAobGluZXMsIGxpbmVUb0ludGVydmFsKSwgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCl9O1xuICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbXVjaCBkYXRhLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICAvLyBUT0RPOiBjYWNoZSByZXN1bHRzIHNvIHdlIGFyZW4ndCByZWZldGNoaW5nIHRoZSBzYW1lIHJlZ2lvbnMgb3ZlciBhbmQgb3ZlciBhZ2Fpbi5cbiAgICBpZiAoKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgJC5hamF4KHRoaXMuYWpheERpcigpICsgJ3RhYml4LnBocCcsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiB0aGlzLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHRoaXMub3B0cy51cmwgPyB0aGlzLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrdGhpcy5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAyNyA6IDYsXG4gICAgICBjb2xvcnMgPSB7YTonMjU1LDAsMCcsIHQ6JzI1NSwwLDI1NScsIGM6JzAsMCwyNTUnLCBnOicwLDI1NSwwJ30sXG4gICAgICBkcmF3TGltaXQgPSB0aGlzLm9wdHMuZHJhd0xpbWl0ICYmIHRoaXMub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snKSB7IGFyZWFzID0gdGhpcy5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgdGhpcy5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgIH0gZWxzZSBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBhbHRDb2xvciwgcmVmQ29sb3I7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgcmVmQ29sb3IgPSBjb2xvcnNbZGF0YS5kLnJlZi50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGFsdENvbG9yID0gY29sb3JzW2RhdGEuZC5hbHQudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIgKyBhbHRDb2xvciArIFwiKVwiOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIDEpO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIGFyZWFzLnB1c2goW1xuICAgICAgICAgICAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvL3gxLCB4MiwgeTEsIHkyXG4gICAgICAgICAgICAgICAgZGF0YS5kLnJlZiArICcgPiAnICsgZGF0YS5kLmFsdCwgLy8gdGl0bGVcbiAgICAgICAgICAgICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIGRhdGEuZC5pZCksIC8vIGhyZWZcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQub1ByZXYsIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICAgICAgICAgICAgYWx0Q29sb3IsIC8vIGxhYmVsIGNvbG9yXG4gICAgICAgICAgICAgICAgJzxzcGFuIHN0eWxlPVwiY29sb3I6IHJnYignICsgcmVmQ29sb3IgKyAnKVwiPicgKyBkYXRhLmQucmVmICsgJzwvc3Bhbj48YnIvPicgKyBkYXRhLmQuYWx0LCAvLyBsYWJlbFxuICAgICAgICAgICAgICAgIGRhdGEuZC5pbmZvXG4gICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBWY2ZUYWJpeEZvcm1hdDtcblxuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IFdJRyBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3dpZ2dsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL3V0aWxzL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0O1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy53aWdnbGVfMFxudmFyIFdpZ2dsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHV0aWxzLndpZ0JpbkZ1bmN0aW9ucyxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIF9iaW5GdW5jdGlvbnMgPSB0aGlzLnR5cGUoKS5fYmluRnVuY3Rpb25zO1xuICAgIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpKSB7IG8uYWx0Q29sb3IgPSAnJzsgfVxuICAgIG8udmlld0xpbWl0cyA9IF8ubWFwKG8udmlld0xpbWl0cy5zcGxpdCgnOicpLCBwYXJzZUZsb2F0KTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IF8ubWFwKG8ubWF4SGVpZ2h0UGl4ZWxzLnNwbGl0KCc6JyksIHBhcnNlSW50MTApO1xuICAgIG8ueUxpbmVPbk9mZiA9IHRoaXMuaXNPbihvLnlMaW5lT25PZmYpO1xuICAgIG8ueUxpbmVNYXJrID0gcGFyc2VGbG9hdChvLnlMaW5lTWFyayk7XG4gICAgby5hdXRvU2NhbGUgPSB0aGlzLmlzT24oby5hdXRvU2NhbGUpO1xuICAgIGlmIChfYmluRnVuY3Rpb25zICYmICFfYmluRnVuY3Rpb25zW28ud2luZG93aW5nRnVuY3Rpb25dKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHdpbmRvd2luZ0Z1bmN0aW9uIGF0IGxpbmUgXCIgKyBvLmxpbmVOdW0pOyBcbiAgICB9XG4gICAgaWYgKF8uaXNOYU4oby55TGluZU1hcmspKSB7IG8ueUxpbmVNYXJrID0gMC4wOyB9XG4gIH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgc2VsZi5kcmF3UmFuZ2UgPSBvLmF1dG9TY2FsZSB8fCBvLnZpZXdMaW1pdHMubGVuZ3RoIDwgMiA/IHNlbGYucmFuZ2UgOiBvLnZpZXdMaW1pdHM7XG4gICAgXy5lYWNoKHttYXg6IDAsIG1pbjogMiwgc3RhcnQ6IDF9LCBmdW5jdGlvbih2LCBrKSB7IHNlbGYuaGVpZ2h0c1trXSA9IG8ubWF4SGVpZ2h0UGl4ZWxzW3ZdOyB9KTtcbiAgICBpZiAoIW8uYWx0Q29sb3IpIHtcbiAgICAgIHZhciBoc2wgPSB0aGlzLnJnYlRvSHNsLmFwcGx5KHRoaXMsIG8uY29sb3Iuc3BsaXQoLyxcXHMqL2cpKTtcbiAgICAgIGhzbFswXSA9IGhzbFswXSArIDAuMDIgJSAxO1xuICAgICAgaHNsWzFdID0gaHNsWzFdICogMC43O1xuICAgICAgaHNsWzJdID0gMSAtICgxIC0gaHNsWzJdKSAqIDAuNztcbiAgICAgIHNlbGYuYWx0Q29sb3IgPSBfLm1hcCh0aGlzLmhzbFRvUmdiLmFwcGx5KHRoaXMsIGhzbCksIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIHZhbCwgc3RhcnQ7XG4gICAgICBcbiAgICAgIG0gPSBsaW5lLm1hdGNoKC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgaWYgKG0pIHtcbiAgICAgICAgbW9kZSA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbW9kZU9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgICAgbW9kZU9wdHMuc3RhcnQgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0YXJ0KTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGFydCkgfHwgIW1vZGVPcHRzLnN0YXJ0KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0YXJ0IHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3RlcCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RlcCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RlcCkgfHwgIW1vZGVPcHRzLnN0ZXApKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RlcCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnNwYW4gPSBwYXJzZUludDEwKG1vZGVPcHRzLnNwYW4pIHx8IDE7XG4gICAgICAgIGNoclBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW21vZGVPcHRzLmNocm9tXTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIW1vZGUpIHsgXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV2lnZ2xlIGZvcm1hdCBhdCBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgaGFzIG5vIHByZWNlZGluZyBtb2RlIGRlY2xhcmF0aW9uXCIpOyBcbiAgICAgICAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICAvLyBpbnZhbGlkIGNocm9tb3NvbWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnKSB7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmUpO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0LCBlbmQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICAgIG1vZGVPcHRzLnN0YXJ0ICs9IG1vZGVPcHRzLnN0ZXA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmUgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgICAgICBpZiAobGluZS5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlhYmxlU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlcyB0d28gdmFsdWVzIHBlciBsaW5lXCIpOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChsaW5lWzBdKTtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZVsxXSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBzZWxmLnR5cGUoKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgZmluaXNoUGFyc2U6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXTtcbiAgICBpZiAoZGF0YS5hbGwubGVuZ3RoID4gMCkge1xuICAgICAgc2VsZi5yYW5nZVswXSA9IF8ubWluKGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgICAgc2VsZi5yYW5nZVsxXSA9IF8ubWF4KGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgIH1cbiAgICBkYXRhLmFsbCA9IG5ldyBTb3J0ZWRMaXN0KGRhdGEuYWxsLCB7XG4gICAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhID09PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICAgIGlmIChiID09PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09PSAwKSAgPyAwIDogLTE7XG4gICAgICB9XG4gICAgfSk7XG4gIFxuICAgIC8vIFByZS1vcHRpbWl6ZSBkYXRhIGZvciBoaWdoIGJwcHBzIGJ5IGRvd25zYW1wbGluZ1xuICAgIF8uZWFjaChzZWxmLmJyb3dzZXJPcHRzLmJwcHBzLCBmdW5jdGlvbihicHBwKSB7XG4gICAgICBpZiAoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCA+IDEwMDAwMDApIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgcGl4TGVuID0gTWF0aC5jZWlsKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHApLFxuICAgICAgICBkb3duc2FtcGxlZERhdGEgPSAoZGF0YVticHBwXSA9IChnbG9iYWwuRmxvYXQzMkFycmF5ID8gbmV3IEZsb2F0MzJBcnJheShwaXhMZW4pIDogbmV3IEFycmF5KHBpeExlbikpKSxcbiAgICAgICAgaiA9IDAsXG4gICAgICAgIGN1cnIgPSBkYXRhLmFsbC5nZXQoMCksXG4gICAgICAgIGJpbiwgbmV4dDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGl4TGVuOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5zdGFydCA8PSBpICogYnBwcCAmJiBjdXJyLmVuZCA+IGkgKiBicHBwKSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICYmIG5leHQuZW5kID4gaSAqIGJwcHApIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkb3duc2FtcGxlZERhdGFbaV0gPSBiaW5GdW5jdGlvbihiaW4pO1xuICAgICAgfVxuICAgICAgZGF0YS5fYmluRnVuY3Rpb24gPSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb247XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7IC8vIHN1Y2Nlc3MhXG4gIH0sXG4gIFxuICBpbml0RHJhd1NwZWM6IGZ1bmN0aW9uKHByZWNhbGMpIHtcbiAgICB2YXIgdlNjYWxlID0gKHRoaXMuZHJhd1JhbmdlWzFdIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gcHJlY2FsYy5oZWlnaHQsXG4gICAgICBkcmF3U3BlYyA9IHtcbiAgICAgICAgYmFyczogW10sXG4gICAgICAgIHZTY2FsZTogdlNjYWxlLFxuICAgICAgICB5TGluZTogdGhpcy5pc09uKHRoaXMub3B0cy55TGluZU9uT2ZmKSA/IE1hdGgucm91bmQoKHRoaXMub3B0cy55TGluZU1hcmsgLSB0aGlzLmRyYXdSYW5nZVswXSkgLyB2U2NhbGUpIDogbnVsbCwgXG4gICAgICAgIHplcm9MaW5lOiAtdGhpcy5kcmF3UmFuZ2VbMF0gLyB2U2NhbGVcbiAgICAgIH07XG4gICAgcmV0dXJuIGRyYXdTcGVjO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHByZWNhbGMud2lkdGgsXG4gICAgICBkcmF3U3BlYyA9IHNlbGYudHlwZSgpLmluaXREcmF3U3BlYy5jYWxsKHNlbGYsIHByZWNhbGMpLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl0sXG4gICAgICBkb3duc2FtcGxlZERhdGE7XG4gICAgaWYgKHNlbGYuZGF0YS5fYmluRnVuY3Rpb24gPT0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uICYmIChkb3duc2FtcGxlZERhdGEgPSBzZWxmLmRhdGFbYnBwcF0pKSB7XG4gICAgICAvLyBXZSd2ZSBhbHJlYWR5IHByZS1vcHRpbWl6ZWQgZm9yIHRoaXMgYnBwcFxuICAgICAgZHJhd1NwZWMuYmFycyA9IF8ubWFwKF8ucmFuZ2UoKHN0YXJ0IC0gMSkgLyBicHBwLCAoZW5kIC0gMSkgLyBicHBwKSwgZnVuY3Rpb24oeEZyb21PcmlnaW4sIHgpIHtcbiAgICAgICAgcmV0dXJuICgoZG93bnNhbXBsZWREYXRhW3hGcm9tT3JpZ2luXSB8fCAwKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBoYXZlIHRvIGRvIHRoZSBiaW5uaW5nIG9uIHRoZSBmbHlcbiAgICAgIHZhciBqID0gc2VsZi5kYXRhLmFsbC5ic2VhcmNoKHtzdGFydDogc3RhcnR9KSxcbiAgICAgICAgY3VyciA9IHNlbGYuZGF0YS5hbGwuZ2V0KGopLCBuZXh0LCBiaW47XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByZWNhbGMud2lkdGg7IGkrKykge1xuICAgICAgICBiaW4gPSBjdXJyICYmIChjdXJyLmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gc2VsZi5kYXRhLmFsbC5nZXQoaiArIDEpKSAmJiBuZXh0LnN0YXJ0IDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBuZXh0LmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZHJhd1NwZWMuYmFycy5wdXNoKChiaW5GdW5jdGlvbihiaW4pIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbihjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKSB7XG4gICAgdmFyIHplcm9MaW5lID0gZHJhd1NwZWMuemVyb0xpbmUsIC8vIHBpeGVsIHBvc2l0aW9uIG9mIHRoZSBkYXRhIHZhbHVlIDBcbiAgICAgIGNvbG9yID0gXCJyZ2IoXCIrdGhpcy5vcHRzLmNvbG9yK1wiKVwiLFxuICAgICAgYWx0Q29sb3IgPSBcInJnYihcIisodGhpcy5vcHRzLmFsdENvbG9yIHx8IHRoaXMuYWx0Q29sb3IpK1wiKVwiLFxuICAgICAgcG9pbnRHcmFwaCA9IHRoaXMub3B0cy5ncmFwaFR5cGU9PT0ncG9pbnRzJztcbiAgICBcbiAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgXy5lYWNoKGRyYXdTcGVjLmJhcnMsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgZWxzZSBpZiAoZCA+IHplcm9MaW5lKSB7IFxuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgMSk7IH1cbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSBkLCAxLCB6ZXJvTGluZSA+IDAgPyAoZCAtIHplcm9MaW5lKSA6IGQpOyB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gYWx0Q29sb3I7XG4gICAgICAgIGlmIChwb2ludEdyYXBoKSB7IGN0eC5maWxsUmVjdCh4LCB6ZXJvTGluZSAtIGQgLSAxLCAxLCAxKTsgfSBcbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSB6ZXJvTGluZSwgMSwgemVyb0xpbmUgLSBkKTsgfVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGRyYXdTcGVjLnlMaW5lICE9PSBudWxsKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgICBjdHguZmlsbFJlY3QoMCwgaGVpZ2h0IC0gZHJhd1NwZWMueUxpbmUsIHdpZHRoLCAxKTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgaGVpZ2h0ID0gY2FudmFzLmhlaWdodCxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aCwgaGVpZ2h0OiBoZWlnaHR9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCkuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICAkdmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnLnZpZXctbGltaXRzJyksXG4gICAgICAkbWF4SGVpZ2h0UGl4ZWxzID0gJGRpYWxvZy5maW5kKCcubWF4LWhlaWdodC1waXhlbHMnKSxcbiAgICAgIGFsdENvbG9yT24gPSB0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmF0dHIoJ2NoZWNrZWQnLCBhbHRDb2xvck9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbChhbHRDb2xvck9uID8gby5hbHRDb2xvciA6JzEyOCwxMjgsMTI4JykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuYXR0cignY2hlY2tlZCcsICF0aGlzLmlzT24oby5hdXRvU2NhbGUpKS5jaGFuZ2UoKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtaW5cIiwgdGhpcy5yYW5nZVswXSk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWF4XCIsIHRoaXMucmFuZ2VbMV0pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMF0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMV0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8ueUxpbmVPbk9mZikpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbChvLnlMaW5lTWFyaykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKG8uZ3JhcGhUeXBlKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbChvLndpbmRvd2luZ0Z1bmN0aW9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmF0dHIoJ2NoZWNrZWQnLCBvLm1heEhlaWdodFBpeGVscy5sZW5ndGggPj0gMyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzJdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMF0pLmNoYW5nZSgpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGFsdENvbG9yT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNNYXggPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoKTtcbiAgICBvLmFsdENvbG9yID0gYWx0Q29sb3JPbiA/ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKCkgOiAnJztcbiAgICBvLmF1dG9TY2FsZSA9ICEkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKCkgKyAnOicgKyAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKCk7XG4gICAgby55TGluZU9uT2ZmID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8ueUxpbmVNYXJrID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKCk7XG4gICAgby5ncmFwaFR5cGUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoKTtcbiAgICBvLndpbmRvd2luZ0Z1bmN0aW9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoKTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IG1heEhlaWdodFBpeGVsc09uID8gXG4gICAgICBbbWF4SGVpZ2h0UGl4ZWxzTWF4LCBtYXhIZWlnaHRQaXhlbHNNYXgsICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbCgpXS5qb2luKCc6JykgOiAnJztcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gV2lnZ2xlRm9ybWF0OyIsIi8vIFVuZGVyc2NvcmUuanMgMS4yLjNcbi8vIChjKSAyMDA5LTIwMTEgSmVyZW15IEFzaGtlbmFzLCBEb2N1bWVudENsb3VkIEluYy5cbi8vIFVuZGVyc2NvcmUgaXMgZnJlZWx5IGRpc3RyaWJ1dGFibGUgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuLy8gUG9ydGlvbnMgb2YgVW5kZXJzY29yZSBhcmUgaW5zcGlyZWQgb3IgYm9ycm93ZWQgZnJvbSBQcm90b3R5cGUsXG4vLyBPbGl2ZXIgU3RlZWxlJ3MgRnVuY3Rpb25hbCwgYW5kIEpvaG4gUmVzaWcncyBNaWNyby1UZW1wbGF0aW5nLlxuLy8gRm9yIGFsbCBkZXRhaWxzIGFuZCBkb2N1bWVudGF0aW9uOlxuLy8gaHR0cDovL2RvY3VtZW50Y2xvdWQuZ2l0aHViLmNvbS91bmRlcnNjb3JlXG4oZnVuY3Rpb24oKXtmdW5jdGlvbiByKGEsYyxkKXtpZihhPT09YylyZXR1cm4gYSE9PTB8fDEvYT09MS9jO2lmKGE9PW51bGx8fGM9PW51bGwpcmV0dXJuIGE9PT1jO2lmKGEuX2NoYWluKWE9YS5fd3JhcHBlZDtpZihjLl9jaGFpbiljPWMuX3dyYXBwZWQ7aWYoYS5pc0VxdWFsJiZiLmlzRnVuY3Rpb24oYS5pc0VxdWFsKSlyZXR1cm4gYS5pc0VxdWFsKGMpO2lmKGMuaXNFcXVhbCYmYi5pc0Z1bmN0aW9uKGMuaXNFcXVhbCkpcmV0dXJuIGMuaXNFcXVhbChhKTt2YXIgZT1sLmNhbGwoYSk7aWYoZSE9bC5jYWxsKGMpKXJldHVybiBmYWxzZTtzd2l0Y2goZSl7Y2FzZSBcIltvYmplY3QgU3RyaW5nXVwiOnJldHVybiBhPT1TdHJpbmcoYyk7Y2FzZSBcIltvYmplY3QgTnVtYmVyXVwiOnJldHVybiBhIT0rYT9jIT0rYzphPT0wPzEvYT09MS9jOmE9PStjO2Nhc2UgXCJbb2JqZWN0IERhdGVdXCI6Y2FzZSBcIltvYmplY3QgQm9vbGVhbl1cIjpyZXR1cm4rYT09K2M7Y2FzZSBcIltvYmplY3QgUmVnRXhwXVwiOnJldHVybiBhLnNvdXJjZT09XG5jLnNvdXJjZSYmYS5nbG9iYWw9PWMuZ2xvYmFsJiZhLm11bHRpbGluZT09Yy5tdWx0aWxpbmUmJmEuaWdub3JlQ2FzZT09Yy5pZ25vcmVDYXNlfWlmKHR5cGVvZiBhIT1cIm9iamVjdFwifHx0eXBlb2YgYyE9XCJvYmplY3RcIilyZXR1cm4gZmFsc2U7Zm9yKHZhciBmPWQubGVuZ3RoO2YtLTspaWYoZFtmXT09YSlyZXR1cm4gdHJ1ZTtkLnB1c2goYSk7dmFyIGY9MCxnPXRydWU7aWYoZT09XCJbb2JqZWN0IEFycmF5XVwiKXtpZihmPWEubGVuZ3RoLGc9Zj09Yy5sZW5ndGgpZm9yKDtmLS07KWlmKCEoZz1mIGluIGE9PWYgaW4gYyYmcihhW2ZdLGNbZl0sZCkpKWJyZWFrfWVsc2V7aWYoXCJjb25zdHJ1Y3RvclwiaW4gYSE9XCJjb25zdHJ1Y3RvclwiaW4gY3x8YS5jb25zdHJ1Y3RvciE9Yy5jb25zdHJ1Y3RvcilyZXR1cm4gZmFsc2U7Zm9yKHZhciBoIGluIGEpaWYobS5jYWxsKGEsaCkmJihmKyssIShnPW0uY2FsbChjLGgpJiZyKGFbaF0sY1toXSxkKSkpKWJyZWFrO2lmKGcpe2ZvcihoIGluIGMpaWYobS5jYWxsKGMsXG5oKSYmIWYtLSlicmVhaztnPSFmfX1kLnBvcCgpO3JldHVybiBnfXZhciBzPXRoaXMsRj1zLl8sbz17fSxrPUFycmF5LnByb3RvdHlwZSxwPU9iamVjdC5wcm90b3R5cGUsaT1rLnNsaWNlLEc9ay5jb25jYXQsSD1rLnVuc2hpZnQsbD1wLnRvU3RyaW5nLG09cC5oYXNPd25Qcm9wZXJ0eSx2PWsuZm9yRWFjaCx3PWsubWFwLHg9ay5yZWR1Y2UseT1rLnJlZHVjZVJpZ2h0LHo9ay5maWx0ZXIsQT1rLmV2ZXJ5LEI9ay5zb21lLHE9ay5pbmRleE9mLEM9ay5sYXN0SW5kZXhPZixwPUFycmF5LmlzQXJyYXksST1PYmplY3Qua2V5cyx0PUZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLGI9ZnVuY3Rpb24oYSl7cmV0dXJuIG5ldyBuKGEpfTtpZih0eXBlb2YgZXhwb3J0cyE9PVwidW5kZWZpbmVkXCIpe2lmKHR5cGVvZiBtb2R1bGUhPT1cInVuZGVmaW5lZFwiJiZtb2R1bGUuZXhwb3J0cylleHBvcnRzPW1vZHVsZS5leHBvcnRzPWI7ZXhwb3J0cy5fPWJ9ZWxzZSB0eXBlb2YgZGVmaW5lPT09XCJmdW5jdGlvblwiJiZcbmRlZmluZS5hbWQ/ZGVmaW5lKFwidW5kZXJzY29yZVwiLGZ1bmN0aW9uKCl7cmV0dXJuIGJ9KTpzLl89YjtiLlZFUlNJT049XCIxLjIuM1wiO3ZhciBqPWIuZWFjaD1iLmZvckVhY2g9ZnVuY3Rpb24oYSxjLGIpe2lmKGEhPW51bGwpaWYodiYmYS5mb3JFYWNoPT09dilhLmZvckVhY2goYyxiKTtlbHNlIGlmKGEubGVuZ3RoPT09K2EubGVuZ3RoKWZvcih2YXIgZT0wLGY9YS5sZW5ndGg7ZTxmO2UrKyl7aWYoZSBpbiBhJiZjLmNhbGwoYixhW2VdLGUsYSk9PT1vKWJyZWFrfWVsc2UgZm9yKGUgaW4gYSlpZihtLmNhbGwoYSxlKSYmYy5jYWxsKGIsYVtlXSxlLGEpPT09bylicmVha307Yi5tYXA9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlPVtdO2lmKGE9PW51bGwpcmV0dXJuIGU7aWYodyYmYS5tYXA9PT13KXJldHVybiBhLm1hcChjLGIpO2ooYSxmdW5jdGlvbihhLGcsaCl7ZVtlLmxlbmd0aF09Yy5jYWxsKGIsYSxnLGgpfSk7cmV0dXJuIGV9O2IucmVkdWNlPWIuZm9sZGw9Yi5pbmplY3Q9ZnVuY3Rpb24oYSxcbmMsZCxlKXt2YXIgZj1hcmd1bWVudHMubGVuZ3RoPjI7YT09bnVsbCYmKGE9W10pO2lmKHgmJmEucmVkdWNlPT09eClyZXR1cm4gZSYmKGM9Yi5iaW5kKGMsZSkpLGY/YS5yZWR1Y2UoYyxkKTphLnJlZHVjZShjKTtqKGEsZnVuY3Rpb24oYSxiLGkpe2Y/ZD1jLmNhbGwoZSxkLGEsYixpKTooZD1hLGY9dHJ1ZSl9KTtpZighZil0aHJvdyBuZXcgVHlwZUVycm9yKFwiUmVkdWNlIG9mIGVtcHR5IGFycmF5IHdpdGggbm8gaW5pdGlhbCB2YWx1ZVwiKTtyZXR1cm4gZH07Yi5yZWR1Y2VSaWdodD1iLmZvbGRyPWZ1bmN0aW9uKGEsYyxkLGUpe3ZhciBmPWFyZ3VtZW50cy5sZW5ndGg+MjthPT1udWxsJiYoYT1bXSk7aWYoeSYmYS5yZWR1Y2VSaWdodD09PXkpcmV0dXJuIGUmJihjPWIuYmluZChjLGUpKSxmP2EucmVkdWNlUmlnaHQoYyxkKTphLnJlZHVjZVJpZ2h0KGMpO3ZhciBnPWIudG9BcnJheShhKS5yZXZlcnNlKCk7ZSYmIWYmJihjPWIuYmluZChjLGUpKTtyZXR1cm4gZj9iLnJlZHVjZShnLFxuYyxkLGUpOmIucmVkdWNlKGcsYyl9O2IuZmluZD1iLmRldGVjdD1mdW5jdGlvbihhLGMsYil7dmFyIGU7RChhLGZ1bmN0aW9uKGEsZyxoKXtpZihjLmNhbGwoYixhLGcsaCkpcmV0dXJuIGU9YSx0cnVlfSk7cmV0dXJuIGV9O2IuZmlsdGVyPWIuc2VsZWN0PWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT1bXTtpZihhPT1udWxsKXJldHVybiBlO2lmKHomJmEuZmlsdGVyPT09eilyZXR1cm4gYS5maWx0ZXIoYyxiKTtqKGEsZnVuY3Rpb24oYSxnLGgpe2MuY2FsbChiLGEsZyxoKSYmKGVbZS5sZW5ndGhdPWEpfSk7cmV0dXJuIGV9O2IucmVqZWN0PWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT1bXTtpZihhPT1udWxsKXJldHVybiBlO2ooYSxmdW5jdGlvbihhLGcsaCl7Yy5jYWxsKGIsYSxnLGgpfHwoZVtlLmxlbmd0aF09YSl9KTtyZXR1cm4gZX07Yi5ldmVyeT1iLmFsbD1mdW5jdGlvbihhLGMsYil7dmFyIGU9dHJ1ZTtpZihhPT1udWxsKXJldHVybiBlO2lmKEEmJmEuZXZlcnk9PT1BKXJldHVybiBhLmV2ZXJ5KGMsXG5iKTtqKGEsZnVuY3Rpb24oYSxnLGgpe2lmKCEoZT1lJiZjLmNhbGwoYixhLGcsaCkpKXJldHVybiBvfSk7cmV0dXJuIGV9O3ZhciBEPWIuc29tZT1iLmFueT1mdW5jdGlvbihhLGMsZCl7Y3x8KGM9Yi5pZGVudGl0eSk7dmFyIGU9ZmFsc2U7aWYoYT09bnVsbClyZXR1cm4gZTtpZihCJiZhLnNvbWU9PT1CKXJldHVybiBhLnNvbWUoYyxkKTtqKGEsZnVuY3Rpb24oYSxiLGgpe2lmKGV8fChlPWMuY2FsbChkLGEsYixoKSkpcmV0dXJuIG99KTtyZXR1cm4hIWV9O2IuaW5jbHVkZT1iLmNvbnRhaW5zPWZ1bmN0aW9uKGEsYyl7dmFyIGI9ZmFsc2U7aWYoYT09bnVsbClyZXR1cm4gYjtyZXR1cm4gcSYmYS5pbmRleE9mPT09cT9hLmluZGV4T2YoYykhPS0xOmI9RChhLGZ1bmN0aW9uKGEpe3JldHVybiBhPT09Y30pfTtiLmludm9rZT1mdW5jdGlvbihhLGMpe3ZhciBkPWkuY2FsbChhcmd1bWVudHMsMik7cmV0dXJuIGIubWFwKGEsZnVuY3Rpb24oYSl7cmV0dXJuKGMuY2FsbD9jfHxhOmFbY10pLmFwcGx5KGEsXG5kKX0pfTtiLnBsdWNrPWZ1bmN0aW9uKGEsYyl7cmV0dXJuIGIubWFwKGEsZnVuY3Rpb24oYSl7cmV0dXJuIGFbY119KX07Yi5tYXg9ZnVuY3Rpb24oYSxjLGQpe2lmKCFjJiZiLmlzQXJyYXkoYSkpcmV0dXJuIE1hdGgubWF4LmFwcGx5KE1hdGgsYSk7aWYoIWMmJmIuaXNFbXB0eShhKSlyZXR1cm4tSW5maW5pdHk7dmFyIGU9e2NvbXB1dGVkOi1JbmZpbml0eX07aihhLGZ1bmN0aW9uKGEsYixoKXtiPWM/Yy5jYWxsKGQsYSxiLGgpOmE7Yj49ZS5jb21wdXRlZCYmKGU9e3ZhbHVlOmEsY29tcHV0ZWQ6Yn0pfSk7cmV0dXJuIGUudmFsdWV9O2IubWluPWZ1bmN0aW9uKGEsYyxkKXtpZighYyYmYi5pc0FycmF5KGEpKXJldHVybiBNYXRoLm1pbi5hcHBseShNYXRoLGEpO2lmKCFjJiZiLmlzRW1wdHkoYSkpcmV0dXJuIEluZmluaXR5O3ZhciBlPXtjb21wdXRlZDpJbmZpbml0eX07aihhLGZ1bmN0aW9uKGEsYixoKXtiPWM/Yy5jYWxsKGQsYSxiLGgpOmE7YjxlLmNvbXB1dGVkJiYoZT17dmFsdWU6YSxcbmNvbXB1dGVkOmJ9KX0pO3JldHVybiBlLnZhbHVlfTtiLnNodWZmbGU9ZnVuY3Rpb24oYSl7dmFyIGM9W10sYjtqKGEsZnVuY3Rpb24oYSxmKXtmPT0wP2NbMF09YTooYj1NYXRoLmZsb29yKE1hdGgucmFuZG9tKCkqKGYrMSkpLGNbZl09Y1tiXSxjW2JdPWEpfSk7cmV0dXJuIGN9O2Iuc29ydEJ5PWZ1bmN0aW9uKGEsYyxkKXtyZXR1cm4gYi5wbHVjayhiLm1hcChhLGZ1bmN0aW9uKGEsYixnKXtyZXR1cm57dmFsdWU6YSxjcml0ZXJpYTpjLmNhbGwoZCxhLGIsZyl9fSkuc29ydChmdW5jdGlvbihhLGMpe3ZhciBiPWEuY3JpdGVyaWEsZD1jLmNyaXRlcmlhO3JldHVybiBiPGQ/LTE6Yj5kPzE6MH0pLFwidmFsdWVcIil9O2IuZ3JvdXBCeT1mdW5jdGlvbihhLGMpe3ZhciBkPXt9LGU9Yi5pc0Z1bmN0aW9uKGMpP2M6ZnVuY3Rpb24oYSl7cmV0dXJuIGFbY119O2ooYSxmdW5jdGlvbihhLGIpe3ZhciBjPWUoYSxiKTsoZFtjXXx8KGRbY109W10pKS5wdXNoKGEpfSk7cmV0dXJuIGR9O2Iuc29ydGVkSW5kZXg9XG5mdW5jdGlvbihhLGMsZCl7ZHx8KGQ9Yi5pZGVudGl0eSk7Zm9yKHZhciBlPTAsZj1hLmxlbmd0aDtlPGY7KXt2YXIgZz1lK2Y+PjE7ZChhW2ddKTxkKGMpP2U9ZysxOmY9Z31yZXR1cm4gZX07Yi50b0FycmF5PWZ1bmN0aW9uKGEpe3JldHVybiFhP1tdOmEudG9BcnJheT9hLnRvQXJyYXkoKTpiLmlzQXJyYXkoYSk/aS5jYWxsKGEpOmIuaXNBcmd1bWVudHMoYSk/aS5jYWxsKGEpOmIudmFsdWVzKGEpfTtiLnNpemU9ZnVuY3Rpb24oYSl7cmV0dXJuIGIudG9BcnJheShhKS5sZW5ndGh9O2IuZmlyc3Q9Yi5oZWFkPWZ1bmN0aW9uKGEsYixkKXtyZXR1cm4gYiE9bnVsbCYmIWQ/aS5jYWxsKGEsMCxiKTphWzBdfTtiLmluaXRpYWw9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBpLmNhbGwoYSwwLGEubGVuZ3RoLShiPT1udWxsfHxkPzE6YikpfTtiLmxhc3Q9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBiIT1udWxsJiYhZD9pLmNhbGwoYSxNYXRoLm1heChhLmxlbmd0aC1iLDApKTphW2EubGVuZ3RoLVxuMV19O2IucmVzdD1iLnRhaWw9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBpLmNhbGwoYSxiPT1udWxsfHxkPzE6Yil9O2IuY29tcGFjdD1mdW5jdGlvbihhKXtyZXR1cm4gYi5maWx0ZXIoYSxmdW5jdGlvbihhKXtyZXR1cm4hIWF9KX07Yi5mbGF0dGVuPWZ1bmN0aW9uKGEsYyl7cmV0dXJuIGIucmVkdWNlKGEsZnVuY3Rpb24oYSxlKXtpZihiLmlzQXJyYXkoZSkpcmV0dXJuIGEuY29uY2F0KGM/ZTpiLmZsYXR0ZW4oZSkpO2FbYS5sZW5ndGhdPWU7cmV0dXJuIGF9LFtdKX07Yi53aXRob3V0PWZ1bmN0aW9uKGEpe3JldHVybiBiLmRpZmZlcmVuY2UoYSxpLmNhbGwoYXJndW1lbnRzLDEpKX07Yi51bmlxPWIudW5pcXVlPWZ1bmN0aW9uKGEsYyxkKXt2YXIgZD1kP2IubWFwKGEsZCk6YSxlPVtdO2IucmVkdWNlKGQsZnVuY3Rpb24oZCxnLGgpe2lmKDA9PWh8fChjPT09dHJ1ZT9iLmxhc3QoZCkhPWc6IWIuaW5jbHVkZShkLGcpKSlkW2QubGVuZ3RoXT1nLGVbZS5sZW5ndGhdPWFbaF07cmV0dXJuIGR9LFxuW10pO3JldHVybiBlfTtiLnVuaW9uPWZ1bmN0aW9uKCl7cmV0dXJuIGIudW5pcShiLmZsYXR0ZW4oYXJndW1lbnRzLHRydWUpKX07Yi5pbnRlcnNlY3Rpb249Yi5pbnRlcnNlY3Q9ZnVuY3Rpb24oYSl7dmFyIGM9aS5jYWxsKGFyZ3VtZW50cywxKTtyZXR1cm4gYi5maWx0ZXIoYi51bmlxKGEpLGZ1bmN0aW9uKGEpe3JldHVybiBiLmV2ZXJ5KGMsZnVuY3Rpb24oYyl7cmV0dXJuIGIuaW5kZXhPZihjLGEpPj0wfSl9KX07Yi5kaWZmZXJlbmNlPWZ1bmN0aW9uKGEpe3ZhciBjPWIuZmxhdHRlbihpLmNhbGwoYXJndW1lbnRzLDEpKTtyZXR1cm4gYi5maWx0ZXIoYSxmdW5jdGlvbihhKXtyZXR1cm4hYi5pbmNsdWRlKGMsYSl9KX07Yi56aXA9ZnVuY3Rpb24oKXtmb3IodmFyIGE9aS5jYWxsKGFyZ3VtZW50cyksYz1iLm1heChiLnBsdWNrKGEsXCJsZW5ndGhcIikpLGQ9QXJyYXkoYyksZT0wO2U8YztlKyspZFtlXT1iLnBsdWNrKGEsXCJcIitlKTtyZXR1cm4gZH07Yi5pbmRleE9mPWZ1bmN0aW9uKGEsXG5jLGQpe2lmKGE9PW51bGwpcmV0dXJuLTE7dmFyIGU7aWYoZClyZXR1cm4gZD1iLnNvcnRlZEluZGV4KGEsYyksYVtkXT09PWM/ZDotMTtpZihxJiZhLmluZGV4T2Y9PT1xKXJldHVybiBhLmluZGV4T2YoYyk7Zm9yKGQ9MCxlPWEubGVuZ3RoO2Q8ZTtkKyspaWYoZCBpbiBhJiZhW2RdPT09YylyZXR1cm4gZDtyZXR1cm4tMX07Yi5sYXN0SW5kZXhPZj1mdW5jdGlvbihhLGIpe2lmKGE9PW51bGwpcmV0dXJuLTE7aWYoQyYmYS5sYXN0SW5kZXhPZj09PUMpcmV0dXJuIGEubGFzdEluZGV4T2YoYik7Zm9yKHZhciBkPWEubGVuZ3RoO2QtLTspaWYoZCBpbiBhJiZhW2RdPT09YilyZXR1cm4gZDtyZXR1cm4tMX07Yi5yYW5nZT1mdW5jdGlvbihhLGIsZCl7YXJndW1lbnRzLmxlbmd0aDw9MSYmKGI9YXx8MCxhPTApO2Zvcih2YXIgZD1hcmd1bWVudHNbMl18fDEsZT1NYXRoLm1heChNYXRoLmNlaWwoKGItYSkvZCksMCksZj0wLGc9QXJyYXkoZSk7ZjxlOylnW2YrK109YSxhKz1kO3JldHVybiBnfTtcbnZhciBFPWZ1bmN0aW9uKCl7fTtiLmJpbmQ9ZnVuY3Rpb24oYSxjKXt2YXIgZCxlO2lmKGEuYmluZD09PXQmJnQpcmV0dXJuIHQuYXBwbHkoYSxpLmNhbGwoYXJndW1lbnRzLDEpKTtpZighYi5pc0Z1bmN0aW9uKGEpKXRocm93IG5ldyBUeXBlRXJyb3I7ZT1pLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBkPWZ1bmN0aW9uKCl7aWYoISh0aGlzIGluc3RhbmNlb2YgZCkpcmV0dXJuIGEuYXBwbHkoYyxlLmNvbmNhdChpLmNhbGwoYXJndW1lbnRzKSkpO0UucHJvdG90eXBlPWEucHJvdG90eXBlO3ZhciBiPW5ldyBFLGc9YS5hcHBseShiLGUuY29uY2F0KGkuY2FsbChhcmd1bWVudHMpKSk7cmV0dXJuIE9iamVjdChnKT09PWc/ZzpifX07Yi5iaW5kQWxsPWZ1bmN0aW9uKGEpe3ZhciBjPWkuY2FsbChhcmd1bWVudHMsMSk7Yy5sZW5ndGg9PTAmJihjPWIuZnVuY3Rpb25zKGEpKTtqKGMsZnVuY3Rpb24oYyl7YVtjXT1iLmJpbmQoYVtjXSxhKX0pO3JldHVybiBhfTtiLm1lbW9pemU9ZnVuY3Rpb24oYSxcbmMpe3ZhciBkPXt9O2N8fChjPWIuaWRlbnRpdHkpO3JldHVybiBmdW5jdGlvbigpe3ZhciBiPWMuYXBwbHkodGhpcyxhcmd1bWVudHMpO3JldHVybiBtLmNhbGwoZCxiKT9kW2JdOmRbYl09YS5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fTtiLmRlbGF5PWZ1bmN0aW9uKGEsYil7dmFyIGQ9aS5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gc2V0VGltZW91dChmdW5jdGlvbigpe3JldHVybiBhLmFwcGx5KGEsZCl9LGIpfTtiLmRlZmVyPWZ1bmN0aW9uKGEpe3JldHVybiBiLmRlbGF5LmFwcGx5KGIsW2EsMV0uY29uY2F0KGkuY2FsbChhcmd1bWVudHMsMSkpKX07Yi50aHJvdHRsZT1mdW5jdGlvbihhLGMpe3ZhciBkLGUsZixnLGgsaT1iLmRlYm91bmNlKGZ1bmN0aW9uKCl7aD1nPWZhbHNlfSxjKTtyZXR1cm4gZnVuY3Rpb24oKXtkPXRoaXM7ZT1hcmd1bWVudHM7dmFyIGI7Znx8KGY9c2V0VGltZW91dChmdW5jdGlvbigpe2Y9bnVsbDtoJiZhLmFwcGx5KGQsZSk7aSgpfSxjKSk7Zz9oPXRydWU6XG5hLmFwcGx5KGQsZSk7aSgpO2c9dHJ1ZX19O2IuZGVib3VuY2U9ZnVuY3Rpb24oYSxiKXt2YXIgZDtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgZT10aGlzLGY9YXJndW1lbnRzO2NsZWFyVGltZW91dChkKTtkPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtkPW51bGw7YS5hcHBseShlLGYpfSxiKX19O2Iub25jZT1mdW5jdGlvbihhKXt2YXIgYj1mYWxzZSxkO3JldHVybiBmdW5jdGlvbigpe2lmKGIpcmV0dXJuIGQ7Yj10cnVlO3JldHVybiBkPWEuYXBwbHkodGhpcyxhcmd1bWVudHMpfX07Yi53cmFwPWZ1bmN0aW9uKGEsYil7cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGQ9Ry5hcHBseShbYV0sYXJndW1lbnRzKTtyZXR1cm4gYi5hcHBseSh0aGlzLGQpfX07Yi5jb21wb3NlPWZ1bmN0aW9uKCl7dmFyIGE9YXJndW1lbnRzO3JldHVybiBmdW5jdGlvbigpe2Zvcih2YXIgYj1hcmd1bWVudHMsZD1hLmxlbmd0aC0xO2Q+PTA7ZC0tKWI9W2FbZF0uYXBwbHkodGhpcyxiKV07cmV0dXJuIGJbMF19fTtiLmFmdGVyPVxuZnVuY3Rpb24oYSxiKXtyZXR1cm4gYTw9MD9iKCk6ZnVuY3Rpb24oKXtpZigtLWE8MSlyZXR1cm4gYi5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fTtiLmtleXM9SXx8ZnVuY3Rpb24oYSl7aWYoYSE9PU9iamVjdChhKSl0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBvYmplY3RcIik7dmFyIGI9W10sZDtmb3IoZCBpbiBhKW0uY2FsbChhLGQpJiYoYltiLmxlbmd0aF09ZCk7cmV0dXJuIGJ9O2IudmFsdWVzPWZ1bmN0aW9uKGEpe3JldHVybiBiLm1hcChhLGIuaWRlbnRpdHkpfTtiLmZ1bmN0aW9ucz1iLm1ldGhvZHM9ZnVuY3Rpb24oYSl7dmFyIGM9W10sZDtmb3IoZCBpbiBhKWIuaXNGdW5jdGlvbihhW2RdKSYmYy5wdXNoKGQpO3JldHVybiBjLnNvcnQoKX07Yi5leHRlbmQ9ZnVuY3Rpb24oYSl7aihpLmNhbGwoYXJndW1lbnRzLDEpLGZ1bmN0aW9uKGIpe2Zvcih2YXIgZCBpbiBiKWJbZF0hPT12b2lkIDAmJihhW2RdPWJbZF0pfSk7cmV0dXJuIGF9O2IuZGVmYXVsdHM9ZnVuY3Rpb24oYSl7aihpLmNhbGwoYXJndW1lbnRzLFxuMSksZnVuY3Rpb24oYil7Zm9yKHZhciBkIGluIGIpYVtkXT09bnVsbCYmKGFbZF09YltkXSl9KTtyZXR1cm4gYX07Yi5jbG9uZT1mdW5jdGlvbihhKXtyZXR1cm4hYi5pc09iamVjdChhKT9hOmIuaXNBcnJheShhKT9hLnNsaWNlKCk6Yi5leHRlbmQoe30sYSl9O2IudGFwPWZ1bmN0aW9uKGEsYil7YihhKTtyZXR1cm4gYX07Yi5pc0VxdWFsPWZ1bmN0aW9uKGEsYil7cmV0dXJuIHIoYSxiLFtdKX07Yi5pc0VtcHR5PWZ1bmN0aW9uKGEpe2lmKGIuaXNBcnJheShhKXx8Yi5pc1N0cmluZyhhKSlyZXR1cm4gYS5sZW5ndGg9PT0wO2Zvcih2YXIgYyBpbiBhKWlmKG0uY2FsbChhLGMpKXJldHVybiBmYWxzZTtyZXR1cm4gdHJ1ZX07Yi5pc0VsZW1lbnQ9ZnVuY3Rpb24oYSl7cmV0dXJuISEoYSYmYS5ub2RlVHlwZT09MSl9O2IuaXNBcnJheT1wfHxmdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgQXJyYXldXCJ9O2IuaXNPYmplY3Q9ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT1cbk9iamVjdChhKX07Yi5pc0FyZ3VtZW50cz1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgQXJndW1lbnRzXVwifTtpZighYi5pc0FyZ3VtZW50cyhhcmd1bWVudHMpKWIuaXNBcmd1bWVudHM9ZnVuY3Rpb24oYSl7cmV0dXJuISghYXx8IW0uY2FsbChhLFwiY2FsbGVlXCIpKX07Yi5pc0Z1bmN0aW9uPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBGdW5jdGlvbl1cIn07Yi5pc1N0cmluZz1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgU3RyaW5nXVwifTtiLmlzTnVtYmVyPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBOdW1iZXJdXCJ9O2IuaXNOYU49ZnVuY3Rpb24oYSl7cmV0dXJuIGEhPT1hfTtiLmlzQm9vbGVhbj1mdW5jdGlvbihhKXtyZXR1cm4gYT09PXRydWV8fGE9PT1mYWxzZXx8bC5jYWxsKGEpPT1cIltvYmplY3QgQm9vbGVhbl1cIn07Yi5pc0RhdGU9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XG5cIltvYmplY3QgRGF0ZV1cIn07Yi5pc1JlZ0V4cD1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgUmVnRXhwXVwifTtiLmlzTnVsbD1mdW5jdGlvbihhKXtyZXR1cm4gYT09PW51bGx9O2IuaXNVbmRlZmluZWQ9ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT12b2lkIDB9O2Iubm9Db25mbGljdD1mdW5jdGlvbigpe3MuXz1GO3JldHVybiB0aGlzfTtiLmlkZW50aXR5PWZ1bmN0aW9uKGEpe3JldHVybiBhfTtiLnRpbWVzPWZ1bmN0aW9uKGEsYixkKXtmb3IodmFyIGU9MDtlPGE7ZSsrKWIuY2FsbChkLGUpfTtiLmVzY2FwZT1mdW5jdGlvbihhKXtyZXR1cm4oXCJcIithKS5yZXBsYWNlKC8mL2csXCImYW1wO1wiKS5yZXBsYWNlKC88L2csXCImbHQ7XCIpLnJlcGxhY2UoLz4vZyxcIiZndDtcIikucmVwbGFjZSgvXCIvZyxcIiZxdW90O1wiKS5yZXBsYWNlKC8nL2csXCImI3gyNztcIikucmVwbGFjZSgvXFwvL2csXCImI3gyRjtcIil9O2IubWl4aW49ZnVuY3Rpb24oYSl7aihiLmZ1bmN0aW9ucyhhKSxmdW5jdGlvbihjKXtKKGMsXG5iW2NdPWFbY10pfSl9O3ZhciBLPTA7Yi51bmlxdWVJZD1mdW5jdGlvbihhKXt2YXIgYj1LKys7cmV0dXJuIGE/YStiOmJ9O2IudGVtcGxhdGVTZXR0aW5ncz17ZXZhbHVhdGU6LzwlKFtcXHNcXFNdKz8pJT4vZyxpbnRlcnBvbGF0ZTovPCU9KFtcXHNcXFNdKz8pJT4vZyxlc2NhcGU6LzwlLShbXFxzXFxTXSs/KSU+L2d9O2IudGVtcGxhdGU9ZnVuY3Rpb24oYSxjKXt2YXIgZD1iLnRlbXBsYXRlU2V0dGluZ3MsZD1cInZhciBfX3A9W10scHJpbnQ9ZnVuY3Rpb24oKXtfX3AucHVzaC5hcHBseShfX3AsYXJndW1lbnRzKTt9O3dpdGgob2JqfHx7fSl7X19wLnB1c2goJ1wiK2EucmVwbGFjZSgvXFxcXC9nLFwiXFxcXFxcXFxcIikucmVwbGFjZSgvJy9nLFwiXFxcXCdcIikucmVwbGFjZShkLmVzY2FwZSxmdW5jdGlvbihhLGIpe3JldHVyblwiJyxfLmVzY2FwZShcIitiLnJlcGxhY2UoL1xcXFwnL2csXCInXCIpK1wiKSwnXCJ9KS5yZXBsYWNlKGQuaW50ZXJwb2xhdGUsZnVuY3Rpb24oYSxiKXtyZXR1cm5cIicsXCIrYi5yZXBsYWNlKC9cXFxcJy9nLFxuXCInXCIpK1wiLCdcIn0pLnJlcGxhY2UoZC5ldmFsdWF0ZXx8bnVsbCxmdW5jdGlvbihhLGIpe3JldHVyblwiJyk7XCIrYi5yZXBsYWNlKC9cXFxcJy9nLFwiJ1wiKS5yZXBsYWNlKC9bXFxyXFxuXFx0XS9nLFwiIFwiKStcIjtfX3AucHVzaCgnXCJ9KS5yZXBsYWNlKC9cXHIvZyxcIlxcXFxyXCIpLnJlcGxhY2UoL1xcbi9nLFwiXFxcXG5cIikucmVwbGFjZSgvXFx0L2csXCJcXFxcdFwiKStcIicpO31yZXR1cm4gX19wLmpvaW4oJycpO1wiLGU9bmV3IEZ1bmN0aW9uKFwib2JqXCIsXCJfXCIsZCk7cmV0dXJuIGM/ZShjLGIpOmZ1bmN0aW9uKGEpe3JldHVybiBlLmNhbGwodGhpcyxhLGIpfX07dmFyIG49ZnVuY3Rpb24oYSl7dGhpcy5fd3JhcHBlZD1hfTtiLnByb3RvdHlwZT1uLnByb3RvdHlwZTt2YXIgdT1mdW5jdGlvbihhLGMpe3JldHVybiBjP2IoYSkuY2hhaW4oKTphfSxKPWZ1bmN0aW9uKGEsYyl7bi5wcm90b3R5cGVbYV09ZnVuY3Rpb24oKXt2YXIgYT1pLmNhbGwoYXJndW1lbnRzKTtILmNhbGwoYSx0aGlzLl93cmFwcGVkKTtyZXR1cm4gdShjLmFwcGx5KGIsXG5hKSx0aGlzLl9jaGFpbil9fTtiLm1peGluKGIpO2ooXCJwb3AscHVzaCxyZXZlcnNlLHNoaWZ0LHNvcnQsc3BsaWNlLHVuc2hpZnRcIi5zcGxpdChcIixcIiksZnVuY3Rpb24oYSl7dmFyIGI9a1thXTtuLnByb3RvdHlwZVthXT1mdW5jdGlvbigpe2IuYXBwbHkodGhpcy5fd3JhcHBlZCxhcmd1bWVudHMpO3JldHVybiB1KHRoaXMuX3dyYXBwZWQsdGhpcy5fY2hhaW4pfX0pO2ooW1wiY29uY2F0XCIsXCJqb2luXCIsXCJzbGljZVwiXSxmdW5jdGlvbihhKXt2YXIgYj1rW2FdO24ucHJvdG90eXBlW2FdPWZ1bmN0aW9uKCl7cmV0dXJuIHUoYi5hcHBseSh0aGlzLl93cmFwcGVkLGFyZ3VtZW50cyksdGhpcy5fY2hhaW4pfX0pO24ucHJvdG90eXBlLmNoYWluPWZ1bmN0aW9uKCl7dGhpcy5fY2hhaW49dHJ1ZTtyZXR1cm4gdGhpc307bi5wcm90b3R5cGUudmFsdWU9ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5fd3JhcHBlZH19KS5jYWxsKHRoaXMpOyJdfQ==
