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
  
  // TODO: We must note that when we change opts.viewAsPairs, we *need* to throw out this.data.pileup
  //         and blow up the areaIndex
  // TODO: If the pairing interval changed, we should toss the entire cache and reset the RemoteTrack bins,
  //         and blow up the areaIndex.
  applyOpts: function() {

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
  
  mismatches: function(start, sequence, bppp, intervals, width, lineNum) {
    var mismatches = [];
    sequence = sequence.toUpperCase();
    _.each(intervals, function(interval) {
      var blockSets = [interval.data.blocks];
      if (interval.data.drawAsMates && interval.data.mate) { blockSets.push(interval.data.mate.blocks); }
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
          calcPixIntervalMated = new utils.pixIntervalCalculator(start, width, bppp, false, false, startKey, endKey),
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, false);
        
        if (intervals.tooMany) { return callback(intervals); }

        if (!sequence) {
          // First drawing pass, with features that don't depend on sequence.
          self.type('bam').pileup.call(self, intervals, start, end);
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixIntervalMated, lineNum);
          _.each(drawSpec.layout, function(lines) {
            _.each(lines, function(interval) {
              interval.insertionPts = _.map(interval.d.insertions, calcPixInterval);
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
        "read strand": data.d.flags.readStrand ? '(-)' : '(+)',
        "mapped": yesNo(data.d.flags.isReadMapped),
        "map quality": data.d.mapq,
        "secondary": yesNo(data.d.flags.isSecondaryAlignment),
        "supplementary": yesNo(data.d.flags.isSupplementaryAlignment),
        "duplicate": yesNo(data.d.flags.isDuplicateRead),
        "failed QC": yesNo(data.d.flags.isReadFailingVendorQC)
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
  
  loadOpts: function($dialog) {
    var o = this.opts;
    $dialog.find('[name=viewAsPairs]').attr('checked', !!o.viewAsPairs);
  },
  
  saveOpts: function($dialog) {
    var o = this.opts;
    o.viewAsPairs = $dialog.find('[name=viewAsPairs]').is(':checked');
  }
  
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
var _ = require('../../../underscore.min.js');

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
  if (itvl.isSecondaryAlignment || itvl.isReadFailingVendorQC || itvl.isDuplicateRead || itvl.isSupplementaryAlignment) {
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
    
  potentialMate._mocked && _.extend(potentialMate, {
    rname: itvl.rnext == '=' ? itvl.rname : itvl.rnext,
    pos: itvl.pnext,
    start: itvl.pnext,
    end: tlen > 0 ? itvl.start + tlen : (tlen < 0 ? itvl.end + tlen + itvlLength : itvl.pnext + itvlLength),
    rnext: itvl.rnext == '=' ? '=' : itvl.rname,
    pnext: itvl.pos
  });
  
  // Check that the alignments are on the same reference sequence
  if (itvl.rnext != '=' || potentialMate.rnext != '=') { 
    // and if not, do the coordinates match at all?
    if (itvl.rnext != potentialMate.rname || itvl.rnext != potentialMate.rname) { return PAIRING_CANNOT_MATE; }
    if (itvl.pnext != potentialMate.pos || itvl.pos != potentialMate.pnext) { return PAIRING_CANNOT_MATE; }
    return PAIRING_MATE_ONLY;
  }
  
  potentialMate._mocked && _.extend(potentialMate.flags, {
    readStrandReverse: itvl.flags.mateStrandReverse,
    mateStrandReverse: itvl.flags.readStrandReverse
  });
  
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
},{"../../../underscore.min.js":19,"./IntervalTree.js":11}],14:[function(require,module,exports){
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
},{"../../../underscore.min.js":19}],17:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2suanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tXb3JrZXIuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tzLmpzIiwianMvY3VzdG9tL2pxdWVyeS5ub2RvbS5taW4uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmFtLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iZWRncmFwaC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWdiZWQuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmlnd2lnLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2ZlYXR1cmV0YWJsZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9JbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvTGluZU1hc2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1JlbW90ZVRyYWNrLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1NvcnRlZExpc3QuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdmNmdGFiaXguanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMiLCJqcy91bmRlcnNjb3JlLm1pbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3SEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25wQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDN1VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDOUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3pJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzNRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQ3VzdG9tVHJhY2ssIGFuIG9iamVjdCByZXByZXNlbnRpbmcgYSBjdXN0b20gdHJhY2sgYXMgdW5kZXJzdG9vZCBieSBVQ1NDLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIFRoaXMgY2xhc3MgKmRvZXMqIGRlcGVuZCBvbiBnbG9iYWwgb2JqZWN0cyBhbmQgdGhlcmVmb3JlIG11c3QgYmUgcmVxdWlyZWQgYXMgYSBcbi8vIGZ1bmN0aW9uIHRoYXQgaXMgZXhlY3V0ZWQgb24gdGhlIGdsb2JhbCBvYmplY3QuXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKSB7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuZnVuY3Rpb24gQ3VzdG9tVHJhY2sob3B0cywgYnJvd3Nlck9wdHMpIHtcbiAgaWYgKCFvcHRzKSB7IHJldHVybjsgfSAvLyBUaGlzIGlzIGFuIGVtcHR5IGN1c3RvbVRyYWNrIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgdGhpcy5fdHlwZSA9IChvcHRzLnR5cGUgJiYgb3B0cy50eXBlLnRvTG93ZXJDYXNlKCkpIHx8IFwiYmVkXCI7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmICh0eXBlID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIHRyYWNrIHR5cGUgJ1wiK29wdHMudHlwZStcIicgZW5jb3VudGVyZWQgb24gbGluZSBcIiArIG9wdHMubGluZU51bSk7IH1cbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMsIHR5cGUuZGVmYXVsdHMgfHwge30sIG9wdHMpO1xuICBfLmV4dGVuZCh0aGlzLCB7XG4gICAgYnJvd3Nlck9wdHM6IGJyb3dzZXJPcHRzLFxuICAgIHN0cmV0Y2hIZWlnaHQ6IGZhbHNlLFxuICAgIGhlaWdodHM6IHt9LFxuICAgIHNpemVzOiBbJ2RlbnNlJ10sXG4gICAgbWFwU2l6ZXM6IFtdLFxuICAgIGFyZWFzOiB7fSxcbiAgICBub0FyZWFMYWJlbHM6IGZhbHNlLFxuICAgIGV4cGVjdHNTZXF1ZW5jZTogZmFsc2VcbiAgfSk7XG4gIHRoaXMuaW5pdCgpO1xufVxuXG5DdXN0b21UcmFjay5kZWZhdWx0cyA9IHtcbiAgbmFtZTogJ1VzZXIgVHJhY2snLFxuICBkZXNjcmlwdGlvbjogJ1VzZXIgU3VwcGxpZWQgVHJhY2snLFxuICBjb2xvcjogJzAsMCwwJ1xufTtcblxuQ3VzdG9tVHJhY2sudHlwZXMgPSB7XG4gIGJlZDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iZWQuanMnKSxcbiAgZmVhdHVyZXRhYmxlOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2ZlYXR1cmV0YWJsZS5qcycpLFxuICBiZWRncmFwaDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iZWRncmFwaC5qcycpLFxuICB3aWdnbGVfMDogcmVxdWlyZSgnLi90cmFjay10eXBlcy93aWdnbGVfMC5qcycpLFxuICB2Y2Z0YWJpeDogcmVxdWlyZSgnLi90cmFjay10eXBlcy92Y2Z0YWJpeC5qcycpLFxuICBiaWdiZWQ6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnYmVkLmpzJyksXG4gIGJhbTogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iYW0uanMnKSxcbiAgYmlnd2lnOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JpZ3dpZy5qcycpXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiZWREZXRhaWwgZm9ybWF0OiBodHRwczovL2dlbm9tZS51Y3NjLmVkdS9GQVEvRkFRZm9ybWF0Lmh0bWwjZm9ybWF0MS43ID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICBcblxuQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsID0gXy5jbG9uZShDdXN0b21UcmFjay50eXBlcy5iZWQpO1xuQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsLmRlZmF1bHRzID0gXy5leHRlbmQoe30sIEN1c3RvbVRyYWNrLnR5cGVzLmJlZGRldGFpbC5kZWZhdWx0cywge2RldGFpbDogdHJ1ZX0pO1xuXG4vLyBUaGVzZSBmdW5jdGlvbnMgYnJhbmNoIHRvIGRpZmZlcmVudCBtZXRob2RzIGRlcGVuZGluZyBvbiB0aGUgLnR5cGUoKSBvZiB0aGUgdHJhY2tcbl8uZWFjaChbJ2luaXQnLCAncGFyc2UnLCAncmVuZGVyJywgJ3JlbmRlclNlcXVlbmNlJywgJ3ByZXJlbmRlciddLCBmdW5jdGlvbihmbikge1xuICBDdXN0b21UcmFjay5wcm90b3R5cGVbZm5dID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBfLnRvQXJyYXkoYXJndW1lbnRzKSxcbiAgICAgIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgICBpZiAoIXR5cGVbZm5dKSB7IHJldHVybiBmYWxzZTsgfVxuICAgIHJldHVybiB0eXBlW2ZuXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxufSk7XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5sb2FkT3B0cyA9IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKSxcbiAgICBvID0gdGhpcy5vcHRzO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tb3B0cy1mb3JtJykuaGlkZSgpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tb3B0cy1mb3JtLicrdGhpcy5fdHlwZSkuc2hvdygpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tbmFtZScpLnRleHQoby5uYW1lKTtcbiAgJGRpYWxvZy5maW5kKCcuY3VzdG9tLWRlc2MnKS50ZXh0KG8uZGVzY3JpcHRpb24pO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tZm9ybWF0JykudGV4dCh0aGlzLl90eXBlKTtcbiAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvcl0nKS52YWwoby5jb2xvcikuY2hhbmdlKCk7XG4gIGlmICh0eXBlLmxvYWRPcHRzKSB7IHR5cGUubG9hZE9wdHMuY2FsbCh0aGlzLCAkZGlhbG9nKTsgfVxuICAkZGlhbG9nLmZpbmQoJy5lbmFibGVyJykuY2hhbmdlKCk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuc2F2ZU9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgby5jb2xvciA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKCk7XG4gIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uY29sb3IpKSB7IG8uY29sb3IgPSAnMCwwLDAnOyB9XG4gIGlmICh0eXBlLnNhdmVPcHRzKSB7IHR5cGUuc2F2ZU9wdHMuY2FsbCh0aGlzLCAkZGlhbG9nKTsgfVxuICB0aGlzLmFwcGx5T3B0cygpO1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLndvcmtlcigpICYmIHRoaXMuYXBwbHlPcHRzQXN5bmMoKTsgLy8gQXBwbHkgdGhlIGNoYW5nZXMgdG8gdGhlIHdvcmtlciB0b28hXG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYXBwbHlPcHRzID0gZnVuY3Rpb24ob3B0cykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpO1xuICBpZiAob3B0cykgeyB0aGlzLm9wdHMgPSBvcHRzOyB9XG4gIGlmICh0eXBlLmFwcGx5T3B0cykgeyB0eXBlLmFwcGx5T3B0cy5jYWxsKHRoaXMpOyB9XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuZXJhc2UgPSBmdW5jdGlvbihjYW52YXMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzLFxuICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICBpZiAoY3R4KSB7IGN0eC5jbGVhclJlY3QoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0KTsgfVxufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUudHlwZSA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKF8uaXNVbmRlZmluZWQodHlwZSkpIHsgdHlwZSA9IHRoaXMuX3R5cGU7IH1cbiAgcmV0dXJuIHRoaXMuY29uc3RydWN0b3IudHlwZXNbdHlwZV0gfHwgbnVsbDtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS53YXJuID0gZnVuY3Rpb24od2FybmluZykge1xuICBpZiAodGhpcy5vcHRzLnN0cmljdCkge1xuICAgIHRocm93IG5ldyBFcnJvcih3YXJuaW5nKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIXRoaXMud2FybmluZ3MpIHsgdGhpcy53YXJuaW5ncyA9IFtdOyB9XG4gICAgdGhpcy53YXJuaW5ncy5wdXNoKHdhcm5pbmcpO1xuICB9XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuaXNPbiA9IGZ1bmN0aW9uKHZhbCkge1xuICByZXR1cm4gL14ob258eWVzfHRydWV8dHx5fDEpJC9pLnRlc3QodmFsLnRvU3RyaW5nKCkpO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNockxpc3QgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLl9jaHJMaXN0KSB7XG4gICAgdGhpcy5fY2hyTGlzdCA9IF8uc29ydEJ5KF8ubWFwKHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLCBmdW5jdGlvbihwb3MsIGNocikgeyByZXR1cm4gW3BvcywgY2hyXTsgfSksIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHZbMF07IH0pO1xuICB9XG4gIHJldHVybiB0aGlzLl9jaHJMaXN0O1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyQXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgdmFyIGNockxpc3QgPSB0aGlzLmNockxpc3QoKSxcbiAgICBjaHJJbmRleCA9IF8uc29ydGVkSW5kZXgoY2hyTGlzdCwgW3Bvc10sIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHZbMF07IH0pLFxuICAgIGNociA9IGNockluZGV4ID4gMCA/IGNockxpc3RbY2hySW5kZXggLSAxXVsxXSA6IG51bGw7XG4gIHJldHVybiB7aTogY2hySW5kZXggLSAxLCBjOiBjaHIsIHA6IHBvcyAtIHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocl19O1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmNoclJhbmdlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgY2hyTGVuZ3RocyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyTGVuZ3RocyxcbiAgICBzdGFydENociA9IHRoaXMuY2hyQXQoc3RhcnQpLFxuICAgIGVuZENociA9IHRoaXMuY2hyQXQoZW5kKSxcbiAgICByYW5nZTtcbiAgaWYgKHN0YXJ0Q2hyLmMgJiYgc3RhcnRDaHIuaSA9PT0gZW5kQ2hyLmkpIHsgcmV0dXJuIFtzdGFydENoci5jICsgJzonICsgc3RhcnRDaHIucCArICctJyArIGVuZENoci5wXTsgfVxuICBlbHNlIHtcbiAgICByYW5nZSA9IF8ubWFwKHRoaXMuY2hyTGlzdCgpLnNsaWNlKHN0YXJ0Q2hyLmkgKyAxLCBlbmRDaHIuaSksIGZ1bmN0aW9uKHYpIHtcbiAgICAgIHJldHVybiB2WzFdICsgJzoxLScgKyBjaHJMZW5ndGhzW3ZbMV1dO1xuICAgIH0pO1xuICAgIHN0YXJ0Q2hyLmMgJiYgcmFuZ2UudW5zaGlmdChzdGFydENoci5jICsgJzonICsgc3RhcnRDaHIucCArICctJyArIGNockxlbmd0aHNbc3RhcnRDaHIuY10pO1xuICAgIGVuZENoci5jICYmIHJhbmdlLnB1c2goZW5kQ2hyLmMgKyAnOjEtJyArIGVuZENoci5wKTtcbiAgICByZXR1cm4gcmFuZ2U7XG4gIH1cbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ3ByZXJlbmRlcicsIGFyZ3VtZW50cywgW3RoaXMuaWRdKTtcbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5hcHBseU9wdHNBc3luYyA9IGZ1bmN0aW9uKCkge1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLmFzeW5jKHRoaXMsICdhcHBseU9wdHMnLCBbdGhpcy5vcHRzLCBmdW5jdGlvbigpe31dLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFqYXhEaXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gV2ViIFdvcmtlcnMgZmV0Y2ggVVJMcyByZWxhdGl2ZSB0byB0aGUgSlMgZmlsZSBpdHNlbGYuXG4gIHJldHVybiAoZ2xvYmFsLkhUTUxEb2N1bWVudCA/ICcnIDogJy4uLycpICsgdGhpcy5icm93c2VyT3B0cy5hamF4RGlyO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnJnYlRvSHNsID0gZnVuY3Rpb24ociwgZywgYikge1xuICByIC89IDI1NSwgZyAvPSAyNTUsIGIgLz0gMjU1O1xuICB2YXIgbWF4ID0gTWF0aC5tYXgociwgZywgYiksIG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICB2YXIgaCwgcywgbCA9IChtYXggKyBtaW4pIC8gMjtcblxuICBpZiAobWF4ID09IG1pbikge1xuICAgIGggPSBzID0gMDsgLy8gYWNocm9tYXRpY1xuICB9IGVsc2Uge1xuICAgIHZhciBkID0gbWF4IC0gbWluO1xuICAgIHMgPSBsID4gMC41ID8gZCAvICgyIC0gbWF4IC0gbWluKSA6IGQgLyAobWF4ICsgbWluKTtcbiAgICBzd2l0Y2gobWF4KXtcbiAgICAgIGNhc2UgcjogaCA9IChnIC0gYikgLyBkICsgKGcgPCBiID8gNiA6IDApOyBicmVhaztcbiAgICAgIGNhc2UgZzogaCA9IChiIC0gcikgLyBkICsgMjsgYnJlYWs7XG4gICAgICBjYXNlIGI6IGggPSAociAtIGcpIC8gZCArIDQ7IGJyZWFrO1xuICAgIH1cbiAgICBoIC89IDY7XG4gIH1cblxuICByZXR1cm4gW2gsIHMsIGxdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuaHNsVG9SZ2IgPSBmdW5jdGlvbihoLCBzLCBsKSB7XG4gIHZhciByLCBnLCBiO1xuXG4gIGlmIChzID09IDApIHtcbiAgICByID0gZyA9IGIgPSBsOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgZnVuY3Rpb24gaHVlMnJnYihwLCBxLCB0KSB7XG4gICAgICBpZih0IDwgMCkgdCArPSAxO1xuICAgICAgaWYodCA+IDEpIHQgLT0gMTtcbiAgICAgIGlmKHQgPCAxLzYpIHJldHVybiBwICsgKHEgLSBwKSAqIDYgKiB0O1xuICAgICAgaWYodCA8IDEvMikgcmV0dXJuIHE7XG4gICAgICBpZih0IDwgMi8zKSByZXR1cm4gcCArIChxIC0gcCkgKiAoMi8zIC0gdCkgKiA2O1xuICAgICAgcmV0dXJuIHA7XG4gICAgfVxuXG4gICAgdmFyIHEgPSBsIDwgMC41ID8gbCAqICgxICsgcykgOiBsICsgcyAtIGwgKiBzO1xuICAgIHZhciBwID0gMiAqIGwgLSBxO1xuICAgIHIgPSBodWUycmdiKHAsIHEsIGggKyAxLzMpO1xuICAgIGcgPSBodWUycmdiKHAsIHEsIGgpO1xuICAgIGIgPSBodWUycmdiKHAsIHEsIGggLSAxLzMpO1xuICB9XG5cbiAgcmV0dXJuIFtyICogMjU1LCBnICogMjU1LCBiICogMjU1XTtcbn1cblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLnZhbGlkYXRlQ29sb3IgPSBmdW5jdGlvbihjb2xvcikge1xuICB2YXIgbSA9IGNvbG9yLm1hdGNoKC8oXFxkKyksKFxcZCspLChcXGQrKS8pO1xuICBpZiAoIW0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gIG0uc2hpZnQoKTtcbiAgcmV0dXJuIF8uYWxsKF8ubWFwKG0sIHBhcnNlSW50MTApLCBmdW5jdGlvbih2KSB7IHJldHVybiB2ID49MCAmJiB2IDw9IDI1NTsgfSk7XG59XG5cbnJldHVybiBDdXN0b21UcmFjaztcblxufTsiLCJ2YXIgZ2xvYmFsID0gc2VsZjsgIC8vIGdyYWIgZ2xvYmFsIHNjb2xlIGZvciBXZWIgV29ya2Vyc1xucmVxdWlyZSgnLi9qcXVlcnkubm9kb20ubWluLmpzJykoZ2xvYmFsKTtcbmdsb2JhbC5fID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcbnJlcXVpcmUoJy4vQ3VzdG9tVHJhY2tzLmpzJykoZ2xvYmFsKTtcblxuaWYgKCFnbG9iYWwuY29uc29sZSB8fCAhZ2xvYmFsLmNvbnNvbGUubG9nKSB7XG4gIGdsb2JhbC5jb25zb2xlID0gZ2xvYmFsLmNvbnNvbGUgfHwge307XG4gIGdsb2JhbC5jb25zb2xlLmxvZyA9IGZ1bmN0aW9uKCkge1xuICAgIGdsb2JhbC5wb3N0TWVzc2FnZSh7bG9nOiBKU09OLnN0cmluZ2lmeShfLnRvQXJyYXkoYXJndW1lbnRzKSl9KTtcbiAgfTtcbn1cblxudmFyIEN1c3RvbVRyYWNrV29ya2VyID0ge1xuICBfdHJhY2tzOiBbXSxcbiAgX3Rocm93RXJyb3JzOiBmYWxzZSxcbiAgcGFyc2U6IGZ1bmN0aW9uKHRleHQsIGJyb3dzZXJPcHRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgdHJhY2tzID0gQ3VzdG9tVHJhY2tzLnBhcnNlKHRleHQsIGJyb3dzZXJPcHRzKTtcbiAgICByZXR1cm4gXy5tYXAodHJhY2tzLCBmdW5jdGlvbih0KSB7XG4gICAgICAvLyB3ZSB3YW50IHRvIGtlZXAgdGhlIHRyYWNrIG9iamVjdCBpbiBvdXIgcHJpdmF0ZSBzdG9yZSwgYW5kIGRlbGV0ZSB0aGUgZGF0YSBmcm9tIHRoZSBjb3B5IHRoYXRcbiAgICAgIC8vIGlzIHNlbnQgYmFjayBvdmVyIHRoZSBmZW5jZSwgc2luY2UgaXQgaXMgZXhwZW5zaXZlL2ltcG9zc2libGUgdG8gc2VyaWFsaXplXG4gICAgICB0LmlkID0gc2VsZi5fdHJhY2tzLnB1c2godCkgLSAxO1xuICAgICAgdmFyIHNlcmlhbGl6YWJsZSA9IF8uZXh0ZW5kKHt9LCB0KTtcbiAgICAgIGRlbGV0ZSBzZXJpYWxpemFibGUuZGF0YTtcbiAgICAgIHJldHVybiBzZXJpYWxpemFibGU7XG4gICAgfSk7XG4gIH0sXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBfLnRvQXJyYXkoYXJndW1lbnRzKSxcbiAgICAgIGlkID0gXy5maXJzdChhcmdzKSxcbiAgICAgIHRyYWNrID0gdGhpcy5fdHJhY2tzW2lkXTtcbiAgICB0cmFjay5wcmVyZW5kZXIuYXBwbHkodHJhY2ssIF8ucmVzdChhcmdzKSk7XG4gIH0sXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7XG4gICAgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgdHJhY2sgPSB0aGlzLl90cmFja3NbaWRdO1xuICAgIHRyYWNrLmFwcGx5T3B0cy5hcHBseSh0cmFjaywgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgdGhyb3dFcnJvcnM6IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgIHRoaXMuX3Rocm93RXJyb3JzID0gdG9nZ2xlO1xuICB9XG59O1xuXG5nbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGRhdGEgPSBlLmRhdGEsXG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbihyKSB7IGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IGRhdGEuaWQsIHJldDogSlNPTi5zdHJpbmdpZnkociB8fCBudWxsKX0pOyB9LFxuICAgIHJldDtcblxuICBpZiAoQ3VzdG9tVHJhY2tXb3JrZXIuX3Rocm93RXJyb3JzIHx8IHRydWUpIHtcbiAgICByZXQgPSBDdXN0b21UcmFja1dvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21UcmFja1dvcmtlciwgZGF0YS5hcmdzLmNvbmNhdChjYWxsYmFjaykpO1xuICB9IGVsc2Uge1xuICAgIHRyeSB7IHJldCA9IEN1c3RvbVRyYWNrV29ya2VyW2RhdGEub3BdLmFwcGx5KEN1c3RvbVRyYWNrV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBcbiAgLy8gU29tZSB1dGlsaXR5IGZ1bmN0aW9ucy5cbiAgdmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIHRyYWNrIG9iamVjdFxuICB2YXIgQ3VzdG9tVHJhY2sgPSByZXF1aXJlKCcuL0N1c3RvbVRyYWNrLmpzJykoZ2xvYmFsKTtcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21UcmFja3MsIHRoZSBtb2R1bGUgdGhhdCBpcyBleHBvcnRlZCB0byB0aGUgZ2xvYmFsIGVudmlyb25tZW50LiA9XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBCcm9hZGx5IHNwZWFraW5nIHRoaXMgaXMgYSBmYWN0b3J5IGZvciBwYXJzaW5nIGRhdGEgaW50byBDdXN0b21UcmFjayBvYmplY3RzLFxuICAvLyBhbmQgaXQgY2FuIGRlbGVnYXRlIHRoaXMgd29yayB0byBhIHdvcmtlciB0aHJlYWQuXG5cbiAgdmFyIEN1c3RvbVRyYWNrcyA9IHtcbiAgICBwYXJzZTogZnVuY3Rpb24oY2h1bmtzLCBicm93c2VyT3B0cykge1xuICAgICAgdmFyIGN1c3RvbVRyYWNrcyA9IFtdLFxuICAgICAgICBkYXRhID0gW10sXG4gICAgICAgIHRyYWNrLCBvcHRzLCBtO1xuICAgICAgXG4gICAgICBpZiAodHlwZW9mIGNodW5rcyA9PSBcInN0cmluZ1wiKSB7IGNodW5rcyA9IFtjaHVua3NdOyB9XG4gICAgICBcbiAgICAgIGZ1bmN0aW9uIHB1c2hUcmFjaygpIHtcbiAgICAgICAgaWYgKHRyYWNrLnBhcnNlKGRhdGEpKSB7IGN1c3RvbVRyYWNrcy5wdXNoKHRyYWNrKTsgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjdXN0b21UcmFja3MuYnJvd3NlciA9IHt9O1xuICAgICAgXy5lYWNoKGNodW5rcywgZnVuY3Rpb24odGV4dCkge1xuICAgICAgICBfLmVhY2godGV4dC5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICAgICAgaWYgKC9eIy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gY29tbWVudCBsaW5lXG4gICAgICAgICAgfSBlbHNlIGlmICgvXmJyb3dzZXJcXHMrLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBicm93c2VyIGxpbmVzXG4gICAgICAgICAgICBtID0gbGluZS5tYXRjaCgvXmJyb3dzZXJcXHMrKFxcdyspXFxzKyhcXFMqKS8pO1xuICAgICAgICAgICAgaWYgKCFtKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSBicm93c2VyIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyW21bMV1dID0gbVsyXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9edHJhY2tcXHMrL2kudGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICAgICAgICBvcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgKC9edHJhY2tcXHMrL2kpKTtcbiAgICAgICAgICAgIGlmICghb3B0cykgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgdHJhY2sgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgb3B0cy5saW5lTnVtID0gbGluZW5vICsgMTtcbiAgICAgICAgICAgIHRyYWNrID0gbmV3IEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKTtcbiAgICAgICAgICAgIGRhdGEgPSBbXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9cXFMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICghdHJhY2spIHsgdGhyb3cgbmV3IEVycm9yKFwiRm91bmQgZGF0YSBvbiBsaW5lIFwiKyhsaW5lbm8rMSkrXCIgYnV0IG5vIHByZWNlZGluZyB0cmFjayBkZWZpbml0aW9uXCIpOyB9XG4gICAgICAgICAgICBkYXRhLnB1c2gobGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICByZXR1cm4gY3VzdG9tVHJhY2tzO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmU6IHBhcnNlRGVjbGFyYXRpb25MaW5lLFxuICAgIFxuICAgIGVycm9yOiBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBDYW4gYmUgb3ZlcnJpZGRlbiBieSBhIHBhcmVudCBsaWJyYXJ5IHRvIGhhbmRsZSBlcnJvcnMgbW9yZSBncmFjZWZ1bGx5LlxuICAgICAgY29uc29sZS5sb2coZSk7XG4gICAgfSxcbiAgICBcbiAgICBfd29ya2VyU2NyaXB0OiAnYnVpbGQvQ3VzdG9tVHJhY2tXb3JrZXIuanMnLFxuICAgIC8vIE5PVEU6IFRvIHRlbXBvcmFyaWx5IGRpc2FibGUgV2ViIFdvcmtlciB1c2FnZSwgc2V0IHRoaXMgdG8gdHJ1ZS5cbiAgICBfZGlzYWJsZVdvcmtlcnM6IGZhbHNlLFxuICAgIFxuICAgIHdvcmtlcjogZnVuY3Rpb24oKSB7IFxuICAgICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgICBjYWxsYmFja3MgPSBbXTtcbiAgICAgIGlmICghc2VsZi5fd29ya2VyICYmIGdsb2JhbC5Xb3JrZXIpIHsgXG4gICAgICAgIHNlbGYuX3dvcmtlciA9IG5ldyBnbG9iYWwuV29ya2VyKHNlbGYuX3dvcmtlclNjcmlwdCk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGUpIHsgc2VsZi5lcnJvcihlKTsgfSwgZmFsc2UpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICBpZiAoZS5kYXRhLmxvZykgeyBjb25zb2xlLmxvZyhKU09OLnBhcnNlKGUuZGF0YS5sb2cpKTsgcmV0dXJuOyB9XG4gICAgICAgICAgaWYgKGUuZGF0YS5lcnJvcikge1xuICAgICAgICAgICAgaWYgKGUuZGF0YS5pZCkgeyBjYWxsYmFja3NbZS5kYXRhLmlkXSA9IG51bGw7IH1cbiAgICAgICAgICAgIHNlbGYuZXJyb3IoSlNPTi5wYXJzZShlLmRhdGEuZXJyb3IpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0oSlNPTi5wYXJzZShlLmRhdGEucmV0KSk7XG4gICAgICAgICAgY2FsbGJhY2tzW2UuZGF0YS5pZF0gPSBudWxsO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmNhbGwgPSBmdW5jdGlvbihvcCwgYXJncywgY2FsbGJhY2spIHtcbiAgICAgICAgICB2YXIgaWQgPSBjYWxsYmFja3MucHVzaChjYWxsYmFjaykgLSAxO1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiBvcCwgaWQ6IGlkLCBhcmdzOiBhcmdzfSk7XG4gICAgICAgIH07XG4gICAgICAgIC8vIFRvIGhhdmUgdGhlIHdvcmtlciB0aHJvdyBlcnJvcnMgaW5zdGVhZCBvZiBwYXNzaW5nIHRoZW0gbmljZWx5IGJhY2ssIGNhbGwgdGhpcyB3aXRoIHRvZ2dsZT10cnVlXG4gICAgICAgIHNlbGYuX3dvcmtlci50aHJvd0Vycm9ycyA9IGZ1bmN0aW9uKHRvZ2dsZSkge1xuICAgICAgICAgIHRoaXMucG9zdE1lc3NhZ2Uoe29wOiAndGhyb3dFcnJvcnMnLCBhcmdzOiBbdG9nZ2xlXX0pO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNlbGYuX2Rpc2FibGVXb3JrZXJzID8gbnVsbCA6IHNlbGYuX3dvcmtlcjtcbiAgICB9LFxuICAgIFxuICAgIGFzeW5jOiBmdW5jdGlvbihzZWxmLCBmbiwgYXJncywgYXN5bmNFeHRyYUFyZ3MsIHdyYXBwZXIpIHtcbiAgICAgIGFyZ3MgPSBfLnRvQXJyYXkoYXJncyk7XG4gICAgICB3cmFwcGVyID0gd3JhcHBlciB8fCBfLmlkZW50aXR5O1xuICAgICAgdmFyIGFyZ3NFeGNlcHRMYXN0T25lID0gXy5pbml0aWFsKGFyZ3MpLFxuICAgICAgICBjYWxsYmFjayA9IF8ubGFzdChhcmdzKSxcbiAgICAgICAgdyA9IHRoaXMud29ya2VyKCk7XG4gICAgICAvLyBGYWxsYmFjayBpZiB3ZWIgd29ya2VycyBhcmUgbm90IHN1cHBvcnRlZC5cbiAgICAgIC8vIFRoaXMgY291bGQgYWxzbyBiZSB0d2Vha2VkIHRvIG5vdCB1c2Ugd2ViIHdvcmtlcnMgd2hlbiB0aGVyZSB3b3VsZCBiZSBubyBwZXJmb3JtYW5jZSBnYWluO1xuICAgICAgLy8gICBhY3RpdmF0aW5nIHRoaXMgYnJhbmNoIGRpc2FibGVzIHdlYiB3b3JrZXJzIGVudGlyZWx5IGFuZCBldmVyeXRoaW5nIGhhcHBlbnMgc3luY2hyb25vdXNseS5cbiAgICAgIGlmICghdykgeyByZXR1cm4gY2FsbGJhY2soc2VsZltmbl0uYXBwbHkoc2VsZiwgYXJnc0V4Y2VwdExhc3RPbmUpKTsgfVxuICAgICAgQXJyYXkucHJvdG90eXBlLnVuc2hpZnQuYXBwbHkoYXJnc0V4Y2VwdExhc3RPbmUsIGFzeW5jRXh0cmFBcmdzKTtcbiAgICAgIHcuY2FsbChmbiwgYXJnc0V4Y2VwdExhc3RPbmUsIGZ1bmN0aW9uKHJldCkgeyBjYWxsYmFjayh3cmFwcGVyKHJldCkpOyB9KTtcbiAgICB9LFxuICAgIFxuICAgIHBhcnNlQXN5bmM6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5hc3luYyh0aGlzLCAncGFyc2UnLCBhcmd1bWVudHMsIFtdLCBmdW5jdGlvbih0cmFja3MpIHtcbiAgICAgICAgLy8gVGhlc2UgaGF2ZSBiZWVuIHNlcmlhbGl6ZWQsIHNvIHRoZXkgbXVzdCBiZSBoeWRyYXRlZCBpbnRvIHJlYWwgQ3VzdG9tVHJhY2sgb2JqZWN0cy5cbiAgICAgICAgLy8gV2UgcmVwbGFjZSAucHJlcmVuZGVyKCkgd2l0aCBhbiBhc3luY2hyb25vdXMgdmVyc2lvbi5cbiAgICAgICAgcmV0dXJuIF8ubWFwKHRyYWNrcywgZnVuY3Rpb24odCkge1xuICAgICAgICAgIHJldHVybiBfLmV4dGVuZChuZXcgQ3VzdG9tVHJhY2soKSwgdCwge1xuICAgICAgICAgICAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHsgQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcyA9IEN1c3RvbVRyYWNrcztcblxufSk7IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihnbG9iYWwpe2dsb2JhbC53aW5kb3c9Z2xvYmFsLndpbmRvd3x8Z2xvYmFsO2dsb2JhbC53aW5kb3cuZG9jdW1lbnQ9Z2xvYmFsLndpbmRvdy5kb2N1bWVudHx8e307KGZ1bmN0aW9uKGEsYil7ZnVuY3Rpb24gTigpe3RyeXtyZXR1cm4gbmV3IGEuQWN0aXZlWE9iamVjdChcIk1pY3Jvc29mdC5YTUxIVFRQXCIpfWNhdGNoKGIpe319ZnVuY3Rpb24gTSgpe3RyeXtyZXR1cm4gbmV3IGEuWE1MSHR0cFJlcXVlc3R9Y2F0Y2goYil7fX1mdW5jdGlvbiBJKGEsYyl7aWYoYS5kYXRhRmlsdGVyKXtjPWEuZGF0YUZpbHRlcihjLGEuZGF0YVR5cGUpfXZhciBkPWEuZGF0YVR5cGVzLGU9e30sZyxoLGk9ZC5sZW5ndGgsaixrPWRbMF0sbCxtLG4sbyxwO2ZvcihnPTE7ZzxpO2crKyl7aWYoZz09PTEpe2ZvcihoIGluIGEuY29udmVydGVycyl7aWYodHlwZW9mIGg9PT1cInN0cmluZ1wiKXtlW2gudG9Mb3dlckNhc2UoKV09YS5jb252ZXJ0ZXJzW2hdfX19bD1rO2s9ZFtnXTtpZihrPT09XCIqXCIpe2s9bH1lbHNlIGlmKGwhPT1cIipcIiYmbCE9PWspe209bCtcIiBcIitrO249ZVttXXx8ZVtcIiogXCIra107aWYoIW4pe3A9Yjtmb3IobyBpbiBlKXtqPW8uc3BsaXQoXCIgXCIpO2lmKGpbMF09PT1sfHxqWzBdPT09XCIqXCIpe3A9ZVtqWzFdK1wiIFwiK2tdO2lmKHApe289ZVtvXTtpZihvPT09dHJ1ZSl7bj1wfWVsc2UgaWYocD09PXRydWUpe249b31icmVha319fX1pZighKG58fHApKXtmLmVycm9yKFwiTm8gY29udmVyc2lvbiBmcm9tIFwiK20ucmVwbGFjZShcIiBcIixcIiB0byBcIikpfWlmKG4hPT10cnVlKXtjPW4/bihjKTpwKG8oYykpfX19cmV0dXJuIGN9ZnVuY3Rpb24gSChhLGMsZCl7dmFyIGU9YS5jb250ZW50cyxmPWEuZGF0YVR5cGVzLGc9YS5yZXNwb25zZUZpZWxkcyxoLGksaixrO2ZvcihpIGluIGcpe2lmKGkgaW4gZCl7Y1tnW2ldXT1kW2ldfX13aGlsZShmWzBdPT09XCIqXCIpe2Yuc2hpZnQoKTtpZihoPT09Yil7aD1hLm1pbWVUeXBlfHxjLmdldFJlc3BvbnNlSGVhZGVyKFwiY29udGVudC10eXBlXCIpfX1pZihoKXtmb3IoaSBpbiBlKXtpZihlW2ldJiZlW2ldLnRlc3QoaCkpe2YudW5zaGlmdChpKTticmVha319fWlmKGZbMF1pbiBkKXtqPWZbMF19ZWxzZXtmb3IoaSBpbiBkKXtpZighZlswXXx8YS5jb252ZXJ0ZXJzW2krXCIgXCIrZlswXV0pe2o9aTticmVha31pZighayl7az1pfX1qPWp8fGt9aWYoail7aWYoaiE9PWZbMF0pe2YudW5zaGlmdChqKX1yZXR1cm4gZFtqXX19ZnVuY3Rpb24gRyhhLGIsYyxkKXtpZihmLmlzQXJyYXkoYikpe2YuZWFjaChiLGZ1bmN0aW9uKGIsZSl7aWYoY3x8ai50ZXN0KGEpKXtkKGEsZSl9ZWxzZXtHKGErXCJbXCIrKHR5cGVvZiBlPT09XCJvYmplY3RcInx8Zi5pc0FycmF5KGUpP2I6XCJcIikrXCJdXCIsZSxjLGQpfX0pfWVsc2UgaWYoIWMmJmIhPW51bGwmJnR5cGVvZiBiPT09XCJvYmplY3RcIil7Zm9yKHZhciBlIGluIGIpe0coYStcIltcIitlK1wiXVwiLGJbZV0sYyxkKX19ZWxzZXtkKGEsYil9fWZ1bmN0aW9uIEYoYSxjKXt2YXIgZCxlLGc9Zi5hamF4U2V0dGluZ3MuZmxhdE9wdGlvbnN8fHt9O2ZvcihkIGluIGMpe2lmKGNbZF0hPT1iKXsoZ1tkXT9hOmV8fChlPXt9KSlbZF09Y1tkXX19aWYoZSl7Zi5leHRlbmQodHJ1ZSxhLGUpfX1mdW5jdGlvbiBFKGEsYyxkLGUsZixnKXtmPWZ8fGMuZGF0YVR5cGVzWzBdO2c9Z3x8e307Z1tmXT10cnVlO3ZhciBoPWFbZl0saT0wLGo9aD9oLmxlbmd0aDowLGs9YT09PXksbDtmb3IoO2k8aiYmKGt8fCFsKTtpKyspe2w9aFtpXShjLGQsZSk7aWYodHlwZW9mIGw9PT1cInN0cmluZ1wiKXtpZigha3x8Z1tsXSl7bD1ifWVsc2V7Yy5kYXRhVHlwZXMudW5zaGlmdChsKTtsPUUoYSxjLGQsZSxsLGcpfX19aWYoKGt8fCFsKSYmIWdbXCIqXCJdKXtsPUUoYSxjLGQsZSxcIipcIixnKX1yZXR1cm4gbH1mdW5jdGlvbiBEKGEpe3JldHVybiBmdW5jdGlvbihiLGMpe2lmKHR5cGVvZiBiIT09XCJzdHJpbmdcIil7Yz1iO2I9XCIqXCJ9aWYoZi5pc0Z1bmN0aW9uKGMpKXt2YXIgZD1iLnRvTG93ZXJDYXNlKCkuc3BsaXQodSksZT0wLGc9ZC5sZW5ndGgsaCxpLGo7Zm9yKDtlPGc7ZSsrKXtoPWRbZV07aj0vXlxcKy8udGVzdChoKTtpZihqKXtoPWguc3Vic3RyKDEpfHxcIipcIn1pPWFbaF09YVtoXXx8W107aVtqP1widW5zaGlmdFwiOlwicHVzaFwiXShjKX19fX12YXIgYz1hLmRvY3VtZW50LGQ9YS5uYXZpZ2F0b3IsZT1hLmxvY2F0aW9uO3ZhciBmPWZ1bmN0aW9uKCl7ZnVuY3Rpb24gSigpe2lmKGUuaXNSZWFkeSl7cmV0dXJufXRyeXtjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbChcImxlZnRcIil9Y2F0Y2goYSl7c2V0VGltZW91dChKLDEpO3JldHVybn1lLnJlYWR5KCl9dmFyIGU9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gbmV3IGUuZm4uaW5pdChhLGIsaCl9LGY9YS5qUXVlcnksZz1hLiQsaCxpPS9eKD86W148XSooPFtcXHdcXFddKz4pW14+XSokfCMoW1xcd1xcLV0qKSQpLyxqPS9cXFMvLGs9L15cXHMrLyxsPS9cXHMrJC8sbT0vXFxkLyxuPS9ePChcXHcrKVxccypcXC8/Pig/OjxcXC9cXDE+KT8kLyxvPS9eW1xcXSw6e31cXHNdKiQvLHA9L1xcXFwoPzpbXCJcXFxcXFwvYmZucnRdfHVbMC05YS1mQS1GXXs0fSkvZyxxPS9cIlteXCJcXFxcXFxuXFxyXSpcInx0cnVlfGZhbHNlfG51bGx8LT9cXGQrKD86XFwuXFxkKik/KD86W2VFXVsrXFwtXT9cXGQrKT8vZyxyPS8oPzpefDp8LCkoPzpcXHMqXFxbKSsvZyxzPS8od2Via2l0KVsgXFwvXShbXFx3Ll0rKS8sdD0vKG9wZXJhKSg/Oi4qdmVyc2lvbik/WyBcXC9dKFtcXHcuXSspLyx1PS8obXNpZSkgKFtcXHcuXSspLyx2PS8obW96aWxsYSkoPzouKj8gcnY6KFtcXHcuXSspKT8vLHc9Ly0oW2Etel0pL2lnLHg9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYi50b1VwcGVyQ2FzZSgpfSx5PWQudXNlckFnZW50LHosQSxCLEM9T2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyxEPU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksRT1BcnJheS5wcm90b3R5cGUucHVzaCxGPUFycmF5LnByb3RvdHlwZS5zbGljZSxHPVN0cmluZy5wcm90b3R5cGUudHJpbSxIPUFycmF5LnByb3RvdHlwZS5pbmRleE9mLEk9e307ZS5mbj1lLnByb3RvdHlwZT17Y29uc3RydWN0b3I6ZSxpbml0OmZ1bmN0aW9uKGEsZCxmKXt2YXIgZyxoLGosaztpZighYSl7cmV0dXJuIHRoaXN9aWYoYS5ub2RlVHlwZSl7dGhpcy5jb250ZXh0PXRoaXNbMF09YTt0aGlzLmxlbmd0aD0xO3JldHVybiB0aGlzfWlmKGE9PT1cImJvZHlcIiYmIWQmJmMuYm9keSl7dGhpcy5jb250ZXh0PWM7dGhpc1swXT1jLmJvZHk7dGhpcy5zZWxlY3Rvcj1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYodHlwZW9mIGE9PT1cInN0cmluZ1wiKXtpZihhLmNoYXJBdCgwKT09PVwiPFwiJiZhLmNoYXJBdChhLmxlbmd0aC0xKT09PVwiPlwiJiZhLmxlbmd0aD49Myl7Zz1bbnVsbCxhLG51bGxdfWVsc2V7Zz1pLmV4ZWMoYSl9aWYoZyYmKGdbMV18fCFkKSl7aWYoZ1sxXSl7ZD1kIGluc3RhbmNlb2YgZT9kWzBdOmQ7az1kP2Qub3duZXJEb2N1bWVudHx8ZDpjO2o9bi5leGVjKGEpO2lmKGope2lmKGUuaXNQbGFpbk9iamVjdChkKSl7YT1bYy5jcmVhdGVFbGVtZW50KGpbMV0pXTtlLmZuLmF0dHIuY2FsbChhLGQsdHJ1ZSl9ZWxzZXthPVtrLmNyZWF0ZUVsZW1lbnQoalsxXSldfX1lbHNle2o9ZS5idWlsZEZyYWdtZW50KFtnWzFdXSxba10pO2E9KGouY2FjaGVhYmxlP2UuY2xvbmUoai5mcmFnbWVudCk6ai5mcmFnbWVudCkuY2hpbGROb2Rlc31yZXR1cm4gZS5tZXJnZSh0aGlzLGEpfWVsc2V7aD1jLmdldEVsZW1lbnRCeUlkKGdbMl0pO2lmKGgmJmgucGFyZW50Tm9kZSl7aWYoaC5pZCE9PWdbMl0pe3JldHVybiBmLmZpbmQoYSl9dGhpcy5sZW5ndGg9MTt0aGlzWzBdPWh9dGhpcy5jb250ZXh0PWM7dGhpcy5zZWxlY3Rvcj1hO3JldHVybiB0aGlzfX1lbHNlIGlmKCFkfHxkLmpxdWVyeSl7cmV0dXJuKGR8fGYpLmZpbmQoYSl9ZWxzZXtyZXR1cm4gdGhpcy5jb25zdHJ1Y3RvcihkKS5maW5kKGEpfX1lbHNlIGlmKGUuaXNGdW5jdGlvbihhKSl7cmV0dXJuIGYucmVhZHkoYSl9aWYoYS5zZWxlY3RvciE9PWIpe3RoaXMuc2VsZWN0b3I9YS5zZWxlY3Rvcjt0aGlzLmNvbnRleHQ9YS5jb250ZXh0fXJldHVybiBlLm1ha2VBcnJheShhLHRoaXMpfSxzZWxlY3RvcjpcIlwiLGpxdWVyeTpcIjEuNi4zcHJlXCIsbGVuZ3RoOjAsc2l6ZTpmdW5jdGlvbigpe3JldHVybiB0aGlzLmxlbmd0aH0sdG9BcnJheTpmdW5jdGlvbigpe3JldHVybiBGLmNhbGwodGhpcywwKX0sZ2V0OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP3RoaXMudG9BcnJheSgpOmE8MD90aGlzW3RoaXMubGVuZ3RoK2FdOnRoaXNbYV19LHB1c2hTdGFjazpmdW5jdGlvbihhLGIsYyl7dmFyIGQ9dGhpcy5jb25zdHJ1Y3RvcigpO2lmKGUuaXNBcnJheShhKSl7RS5hcHBseShkLGEpfWVsc2V7ZS5tZXJnZShkLGEpfWQucHJldk9iamVjdD10aGlzO2QuY29udGV4dD10aGlzLmNvbnRleHQ7aWYoYj09PVwiZmluZFwiKXtkLnNlbGVjdG9yPXRoaXMuc2VsZWN0b3IrKHRoaXMuc2VsZWN0b3I/XCIgXCI6XCJcIikrY31lbHNlIGlmKGIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcitcIi5cIitiK1wiKFwiK2MrXCIpXCJ9cmV0dXJuIGR9LGVhY2g6ZnVuY3Rpb24oYSxiKXtyZXR1cm4gZS5lYWNoKHRoaXMsYSxiKX0scmVhZHk6ZnVuY3Rpb24oYSl7ZS5iaW5kUmVhZHkoKTtBLmRvbmUoYSk7cmV0dXJuIHRoaXN9LGVxOmZ1bmN0aW9uKGEpe3JldHVybiBhPT09LTE/dGhpcy5zbGljZShhKTp0aGlzLnNsaWNlKGEsK2ErMSl9LGZpcnN0OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZXEoMCl9LGxhc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgtMSl9LHNsaWNlOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMucHVzaFN0YWNrKEYuYXBwbHkodGhpcyxhcmd1bWVudHMpLFwic2xpY2VcIixGLmNhbGwoYXJndW1lbnRzKS5qb2luKFwiLFwiKSl9LG1hcDpmdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soZS5tYXAodGhpcyxmdW5jdGlvbihiLGMpe3JldHVybiBhLmNhbGwoYixjLGIpfSkpfSxlbmQ6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wcmV2T2JqZWN0fHx0aGlzLmNvbnN0cnVjdG9yKG51bGwpfSxwdXNoOkUsc29ydDpbXS5zb3J0LHNwbGljZTpbXS5zcGxpY2V9O2UuZm4uaW5pdC5wcm90b3R5cGU9ZS5mbjtlLmV4dGVuZD1lLmZuLmV4dGVuZD1mdW5jdGlvbigpe3ZhciBhLGMsZCxmLGcsaCxpPWFyZ3VtZW50c1swXXx8e30saj0xLGs9YXJndW1lbnRzLmxlbmd0aCxsPWZhbHNlO2lmKHR5cGVvZiBpPT09XCJib29sZWFuXCIpe2w9aTtpPWFyZ3VtZW50c1sxXXx8e307aj0yfWlmKHR5cGVvZiBpIT09XCJvYmplY3RcIiYmIWUuaXNGdW5jdGlvbihpKSl7aT17fX1pZihrPT09ail7aT10aGlzOy0tan1mb3IoO2o8aztqKyspe2lmKChhPWFyZ3VtZW50c1tqXSkhPW51bGwpe2ZvcihjIGluIGEpe2Q9aVtjXTtmPWFbY107aWYoaT09PWYpe2NvbnRpbnVlfWlmKGwmJmYmJihlLmlzUGxhaW5PYmplY3QoZil8fChnPWUuaXNBcnJheShmKSkpKXtpZihnKXtnPWZhbHNlO2g9ZCYmZS5pc0FycmF5KGQpP2Q6W119ZWxzZXtoPWQmJmUuaXNQbGFpbk9iamVjdChkKT9kOnt9fWlbY109ZS5leHRlbmQobCxoLGYpfWVsc2UgaWYoZiE9PWIpe2lbY109Zn19fX1yZXR1cm4gaX07ZS5leHRlbmQoe25vQ29uZmxpY3Q6ZnVuY3Rpb24oYil7aWYoYS4kPT09ZSl7YS4kPWd9aWYoYiYmYS5qUXVlcnk9PT1lKXthLmpRdWVyeT1mfXJldHVybiBlfSxpc1JlYWR5OmZhbHNlLHJlYWR5V2FpdDoxLGhvbGRSZWFkeTpmdW5jdGlvbihhKXtpZihhKXtlLnJlYWR5V2FpdCsrfWVsc2V7ZS5yZWFkeSh0cnVlKX19LHJlYWR5OmZ1bmN0aW9uKGEpe2lmKGE9PT10cnVlJiYhLS1lLnJlYWR5V2FpdHx8YSE9PXRydWUmJiFlLmlzUmVhZHkpe2lmKCFjLmJvZHkpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9ZS5pc1JlYWR5PXRydWU7aWYoYSE9PXRydWUmJi0tZS5yZWFkeVdhaXQ+MCl7cmV0dXJufUEucmVzb2x2ZVdpdGgoYyxbZV0pO2lmKGUuZm4udHJpZ2dlcil7ZShjKS50cmlnZ2VyKFwicmVhZHlcIikudW5iaW5kKFwicmVhZHlcIil9fX0sYmluZFJlYWR5OmZ1bmN0aW9uKCl7aWYoQSl7cmV0dXJufUE9ZS5fRGVmZXJyZWQoKTtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe3JldHVybiBzZXRUaW1lb3V0KGUucmVhZHksMSl9aWYoYy5hZGRFdmVudExpc3RlbmVyKXtjLmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7YS5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLGUucmVhZHksZmFsc2UpfWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Yy5hdHRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2EuYXR0YWNoRXZlbnQoXCJvbmxvYWRcIixlLnJlYWR5KTt2YXIgYj1mYWxzZTt0cnl7Yj1hLmZyYW1lRWxlbWVudD09bnVsbH1jYXRjaChkKXt9aWYoYy5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwmJmIpe0ooKX19fSxpc0Z1bmN0aW9uOmZ1bmN0aW9uKGEpe3JldHVybiBlLnR5cGUoYSk9PT1cImZ1bmN0aW9uXCJ9LGlzQXJyYXk6QXJyYXkuaXNBcnJheXx8ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiYXJyYXlcIn0saXNXaW5kb3c6ZnVuY3Rpb24oYSl7cmV0dXJuIGEmJnR5cGVvZiBhPT09XCJvYmplY3RcIiYmXCJzZXRJbnRlcnZhbFwiaW4gYX0saXNOYU46ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGx8fCFtLnRlc3QoYSl8fGlzTmFOKGEpfSx0eXBlOmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1N0cmluZyhhKTpJW0MuY2FsbChhKV18fFwib2JqZWN0XCJ9LGlzUGxhaW5PYmplY3Q6ZnVuY3Rpb24oYSl7aWYoIWF8fGUudHlwZShhKSE9PVwib2JqZWN0XCJ8fGEubm9kZVR5cGV8fGUuaXNXaW5kb3coYSkpe3JldHVybiBmYWxzZX1pZihhLmNvbnN0cnVjdG9yJiYhRC5jYWxsKGEsXCJjb25zdHJ1Y3RvclwiKSYmIUQuY2FsbChhLmNvbnN0cnVjdG9yLnByb3RvdHlwZSxcImlzUHJvdG90eXBlT2ZcIikpe3JldHVybiBmYWxzZX12YXIgYztmb3IoYyBpbiBhKXt9cmV0dXJuIGM9PT1ifHxELmNhbGwoYSxjKX0saXNFbXB0eU9iamVjdDpmdW5jdGlvbihhKXtmb3IodmFyIGIgaW4gYSl7cmV0dXJuIGZhbHNlfXJldHVybiB0cnVlfSxlcnJvcjpmdW5jdGlvbihhKXt0aHJvdyBhfSxwYXJzZUpTT046ZnVuY3Rpb24oYil7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wifHwhYil7cmV0dXJuIG51bGx9Yj1lLnRyaW0oYik7aWYoYS5KU09OJiZhLkpTT04ucGFyc2Upe3JldHVybiBhLkpTT04ucGFyc2UoYil9aWYoby50ZXN0KGIucmVwbGFjZShwLFwiQFwiKS5yZXBsYWNlKHEsXCJdXCIpLnJlcGxhY2UocixcIlwiKSkpe3JldHVybihuZXcgRnVuY3Rpb24oXCJyZXR1cm4gXCIrYikpKCl9ZS5lcnJvcihcIkludmFsaWQgSlNPTjogXCIrYil9LHBhcnNlWE1MOmZ1bmN0aW9uKGMpe3ZhciBkLGY7dHJ5e2lmKGEuRE9NUGFyc2VyKXtmPW5ldyBET01QYXJzZXI7ZD1mLnBhcnNlRnJvbVN0cmluZyhjLFwidGV4dC94bWxcIil9ZWxzZXtkPW5ldyBBY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTERPTVwiKTtkLmFzeW5jPVwiZmFsc2VcIjtkLmxvYWRYTUwoYyl9fWNhdGNoKGcpe2Q9Yn1pZighZHx8IWQuZG9jdW1lbnRFbGVtZW50fHxkLmdldEVsZW1lbnRzQnlUYWdOYW1lKFwicGFyc2VyZXJyb3JcIikubGVuZ3RoKXtlLmVycm9yKFwiSW52YWxpZCBYTUw6IFwiK2MpfXJldHVybiBkfSxub29wOmZ1bmN0aW9uKCl7fSxnbG9iYWxFdmFsOmZ1bmN0aW9uKGIpe2lmKGImJmoudGVzdChiKSl7KGEuZXhlY1NjcmlwdHx8ZnVuY3Rpb24oYil7YVtcImV2YWxcIl0uY2FsbChhLGIpfSkoYil9fSxjYW1lbENhc2U6ZnVuY3Rpb24oYSl7cmV0dXJuIGEucmVwbGFjZSh3LHgpfSxub2RlTmFtZTpmdW5jdGlvbihhLGIpe3JldHVybiBhLm5vZGVOYW1lJiZhLm5vZGVOYW1lLnRvVXBwZXJDYXNlKCk9PT1iLnRvVXBwZXJDYXNlKCl9LGVhY2g6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGc9MCxoPWEubGVuZ3RoLGk9aD09PWJ8fGUuaXNGdW5jdGlvbihhKTtpZihkKXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmFwcGx5KGFbZl0sZCk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5hcHBseShhW2crK10sZCk9PT1mYWxzZSl7YnJlYWt9fX19ZWxzZXtpZihpKXtmb3IoZiBpbiBhKXtpZihjLmNhbGwoYVtmXSxmLGFbZl0pPT09ZmFsc2Upe2JyZWFrfX19ZWxzZXtmb3IoO2c8aDspe2lmKGMuY2FsbChhW2ddLGcsYVtnKytdKT09PWZhbHNlKXticmVha319fX1yZXR1cm4gYX0sdHJpbTpHP2Z1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6Ry5jYWxsKGEpfTpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbD9cIlwiOmEudG9TdHJpbmcoKS5yZXBsYWNlKGssXCJcIikucmVwbGFjZShsLFwiXCIpfSxtYWtlQXJyYXk6ZnVuY3Rpb24oYSxiKXt2YXIgYz1ifHxbXTtpZihhIT1udWxsKXt2YXIgZD1lLnR5cGUoYSk7aWYoYS5sZW5ndGg9PW51bGx8fGQ9PT1cInN0cmluZ1wifHxkPT09XCJmdW5jdGlvblwifHxkPT09XCJyZWdleHBcInx8ZS5pc1dpbmRvdyhhKSl7RS5jYWxsKGMsYSl9ZWxzZXtlLm1lcmdlKGMsYSl9fXJldHVybiBjfSxpbkFycmF5OmZ1bmN0aW9uKGEsYil7aWYoSCl7cmV0dXJuIEguY2FsbChiLGEpfWZvcih2YXIgYz0wLGQ9Yi5sZW5ndGg7YzxkO2MrKyl7aWYoYltjXT09PWEpe3JldHVybiBjfX1yZXR1cm4tMX0sbWVyZ2U6ZnVuY3Rpb24oYSxjKXt2YXIgZD1hLmxlbmd0aCxlPTA7aWYodHlwZW9mIGMubGVuZ3RoPT09XCJudW1iZXJcIil7Zm9yKHZhciBmPWMubGVuZ3RoO2U8ZjtlKyspe2FbZCsrXT1jW2VdfX1lbHNle3doaWxlKGNbZV0hPT1iKXthW2QrK109Y1tlKytdfX1hLmxlbmd0aD1kO3JldHVybiBhfSxncmVwOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD1bXSxlO2M9ISFjO2Zvcih2YXIgZj0wLGc9YS5sZW5ndGg7ZjxnO2YrKyl7ZT0hIWIoYVtmXSxmKTtpZihjIT09ZSl7ZC5wdXNoKGFbZl0pfX1yZXR1cm4gZH0sbWFwOmZ1bmN0aW9uKGEsYyxkKXt2YXIgZixnLGg9W10saT0wLGo9YS5sZW5ndGgsaz1hIGluc3RhbmNlb2YgZXx8aiE9PWImJnR5cGVvZiBqPT09XCJudW1iZXJcIiYmKGo+MCYmYVswXSYmYVtqLTFdfHxqPT09MHx8ZS5pc0FycmF5KGEpKTtpZihrKXtmb3IoO2k8ajtpKyspe2Y9YyhhW2ldLGksZCk7aWYoZiE9bnVsbCl7aFtoLmxlbmd0aF09Zn19fWVsc2V7Zm9yKGcgaW4gYSl7Zj1jKGFbZ10sZyxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19cmV0dXJuIGguY29uY2F0LmFwcGx5KFtdLGgpfSxndWlkOjEscHJveHk6ZnVuY3Rpb24oYSxjKXtpZih0eXBlb2YgYz09PVwic3RyaW5nXCIpe3ZhciBkPWFbY107Yz1hO2E9ZH1pZighZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gYn12YXIgZj1GLmNhbGwoYXJndW1lbnRzLDIpLGc9ZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShjLGYuY29uY2F0KEYuY2FsbChhcmd1bWVudHMpKSl9O2cuZ3VpZD1hLmd1aWQ9YS5ndWlkfHxnLmd1aWR8fGUuZ3VpZCsrO3JldHVybiBnfSxhY2Nlc3M6ZnVuY3Rpb24oYSxjLGQsZixnLGgpe3ZhciBpPWEubGVuZ3RoO2lmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Zm9yKHZhciBqIGluIGMpe2UuYWNjZXNzKGEsaixjW2pdLGYsZyxkKX1yZXR1cm4gYX1pZihkIT09Yil7Zj0haCYmZiYmZS5pc0Z1bmN0aW9uKGQpO2Zvcih2YXIgaz0wO2s8aTtrKyspe2coYVtrXSxjLGY/ZC5jYWxsKGFba10sayxnKGFba10sYykpOmQsaCl9cmV0dXJuIGF9cmV0dXJuIGk/ZyhhWzBdLGMpOmJ9LG5vdzpmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfSx1YU1hdGNoOmZ1bmN0aW9uKGEpe2E9YS50b0xvd2VyQ2FzZSgpO3ZhciBiPXMuZXhlYyhhKXx8dC5leGVjKGEpfHx1LmV4ZWMoYSl8fGEuaW5kZXhPZihcImNvbXBhdGlibGVcIik8MCYmdi5leGVjKGEpfHxbXTtyZXR1cm57YnJvd3NlcjpiWzFdfHxcIlwiLHZlcnNpb246YlsyXXx8XCIwXCJ9fSxzdWI6ZnVuY3Rpb24oKXtmdW5jdGlvbiBhKGIsYyl7cmV0dXJuIG5ldyBhLmZuLmluaXQoYixjKX1lLmV4dGVuZCh0cnVlLGEsdGhpcyk7YS5zdXBlcmNsYXNzPXRoaXM7YS5mbj1hLnByb3RvdHlwZT10aGlzKCk7YS5mbi5jb25zdHJ1Y3Rvcj1hO2Euc3ViPXRoaXMuc3ViO2EuZm4uaW5pdD1mdW5jdGlvbiBkKGMsZCl7aWYoZCYmZCBpbnN0YW5jZW9mIGUmJiEoZCBpbnN0YW5jZW9mIGEpKXtkPWEoZCl9cmV0dXJuIGUuZm4uaW5pdC5jYWxsKHRoaXMsYyxkLGIpfTthLmZuLmluaXQucHJvdG90eXBlPWEuZm47dmFyIGI9YShjKTtyZXR1cm4gYX0sYnJvd3Nlcjp7fX0pO2UuZWFjaChcIkJvb2xlYW4gTnVtYmVyIFN0cmluZyBGdW5jdGlvbiBBcnJheSBEYXRlIFJlZ0V4cCBPYmplY3RcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtJW1wiW29iamVjdCBcIitiK1wiXVwiXT1iLnRvTG93ZXJDYXNlKCl9KTt6PWUudWFNYXRjaCh5KTtpZih6LmJyb3dzZXIpe2UuYnJvd3Nlclt6LmJyb3dzZXJdPXRydWU7ZS5icm93c2VyLnZlcnNpb249ei52ZXJzaW9ufWlmKGUuYnJvd3Nlci53ZWJraXQpe2UuYnJvd3Nlci5zYWZhcmk9dHJ1ZX1pZihqLnRlc3QoXCLCoFwiKSl7az0vXltcXHNcXHhBMF0rLztsPS9bXFxzXFx4QTBdKyQvfWg9ZShjKTtpZihjLmFkZEV2ZW50TGlzdGVuZXIpe0I9ZnVuY3Rpb24oKXtjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsQixmYWxzZSk7ZS5yZWFkeSgpfX1lbHNlIGlmKGMuYXR0YWNoRXZlbnQpe0I9ZnVuY3Rpb24oKXtpZihjLnJlYWR5U3RhdGU9PT1cImNvbXBsZXRlXCIpe2MuZGV0YWNoRXZlbnQoXCJvbnJlYWR5c3RhdGVjaGFuZ2VcIixCKTtlLnJlYWR5KCl9fX1yZXR1cm4gZX0oKTt2YXIgZz1cImRvbmUgZmFpbCBpc1Jlc29sdmVkIGlzUmVqZWN0ZWQgcHJvbWlzZSB0aGVuIGFsd2F5cyBwaXBlXCIuc3BsaXQoXCIgXCIpLGg9W10uc2xpY2U7Zi5leHRlbmQoe19EZWZlcnJlZDpmdW5jdGlvbigpe3ZhciBhPVtdLGIsYyxkLGU9e2RvbmU6ZnVuY3Rpb24oKXtpZighZCl7dmFyIGM9YXJndW1lbnRzLGcsaCxpLGosaztpZihiKXtrPWI7Yj0wfWZvcihnPTAsaD1jLmxlbmd0aDtnPGg7ZysrKXtpPWNbZ107aj1mLnR5cGUoaSk7aWYoaj09PVwiYXJyYXlcIil7ZS5kb25lLmFwcGx5KGUsaSl9ZWxzZSBpZihqPT09XCJmdW5jdGlvblwiKXthLnB1c2goaSl9fWlmKGspe2UucmVzb2x2ZVdpdGgoa1swXSxrWzFdKX19cmV0dXJuIHRoaXN9LHJlc29sdmVXaXRoOmZ1bmN0aW9uKGUsZil7aWYoIWQmJiFiJiYhYyl7Zj1mfHxbXTtjPTE7dHJ5e3doaWxlKGFbMF0pe2Euc2hpZnQoKS5hcHBseShlLGYpfX1maW5hbGx5e2I9W2UsZl07Yz0wfX1yZXR1cm4gdGhpc30scmVzb2x2ZTpmdW5jdGlvbigpe2UucmVzb2x2ZVdpdGgodGhpcyxhcmd1bWVudHMpO3JldHVybiB0aGlzfSxpc1Jlc29sdmVkOmZ1bmN0aW9uKCl7cmV0dXJuISEoY3x8Yil9LGNhbmNlbDpmdW5jdGlvbigpe2Q9MTthPVtdO3JldHVybiB0aGlzfX07cmV0dXJuIGV9LERlZmVycmVkOmZ1bmN0aW9uKGEpe3ZhciBiPWYuX0RlZmVycmVkKCksYz1mLl9EZWZlcnJlZCgpLGQ7Zi5leHRlbmQoYix7dGhlbjpmdW5jdGlvbihhLGMpe2IuZG9uZShhKS5mYWlsKGMpO3JldHVybiB0aGlzfSxhbHdheXM6ZnVuY3Rpb24oKXtyZXR1cm4gYi5kb25lLmFwcGx5KGIsYXJndW1lbnRzKS5mYWlsLmFwcGx5KHRoaXMsYXJndW1lbnRzKX0sZmFpbDpjLmRvbmUscmVqZWN0V2l0aDpjLnJlc29sdmVXaXRoLHJlamVjdDpjLnJlc29sdmUsaXNSZWplY3RlZDpjLmlzUmVzb2x2ZWQscGlwZTpmdW5jdGlvbihhLGMpe3JldHVybiBmLkRlZmVycmVkKGZ1bmN0aW9uKGQpe2YuZWFjaCh7ZG9uZTpbYSxcInJlc29sdmVcIl0sZmFpbDpbYyxcInJlamVjdFwiXX0sZnVuY3Rpb24oYSxjKXt2YXIgZT1jWzBdLGc9Y1sxXSxoO2lmKGYuaXNGdW5jdGlvbihlKSl7YlthXShmdW5jdGlvbigpe2g9ZS5hcHBseSh0aGlzLGFyZ3VtZW50cyk7aWYoaCYmZi5pc0Z1bmN0aW9uKGgucHJvbWlzZSkpe2gucHJvbWlzZSgpLnRoZW4oZC5yZXNvbHZlLGQucmVqZWN0KX1lbHNle2RbZytcIldpdGhcIl0odGhpcz09PWI/ZDp0aGlzLFtoXSl9fSl9ZWxzZXtiW2FdKGRbZ10pfX0pfSkucHJvbWlzZSgpfSxwcm9taXNlOmZ1bmN0aW9uKGEpe2lmKGE9PW51bGwpe2lmKGQpe3JldHVybiBkfWQ9YT17fX12YXIgYz1nLmxlbmd0aDt3aGlsZShjLS0pe2FbZ1tjXV09YltnW2NdXX1yZXR1cm4gYX19KTtiLmRvbmUoYy5jYW5jZWwpLmZhaWwoYi5jYW5jZWwpO2RlbGV0ZSBiLmNhbmNlbDtpZihhKXthLmNhbGwoYixiKX1yZXR1cm4gYn0sd2hlbjpmdW5jdGlvbihhKXtmdW5jdGlvbiBpKGEpe3JldHVybiBmdW5jdGlvbihjKXtiW2FdPWFyZ3VtZW50cy5sZW5ndGg+MT9oLmNhbGwoYXJndW1lbnRzLDApOmM7aWYoIS0tZSl7Zy5yZXNvbHZlV2l0aChnLGguY2FsbChiLDApKX19fXZhciBiPWFyZ3VtZW50cyxjPTAsZD1iLmxlbmd0aCxlPWQsZz1kPD0xJiZhJiZmLmlzRnVuY3Rpb24oYS5wcm9taXNlKT9hOmYuRGVmZXJyZWQoKTtpZihkPjEpe2Zvcig7YzxkO2MrKyl7aWYoYltjXSYmZi5pc0Z1bmN0aW9uKGJbY10ucHJvbWlzZSkpe2JbY10ucHJvbWlzZSgpLnRoZW4oaShjKSxnLnJlamVjdCl9ZWxzZXstLWV9fWlmKCFlKXtnLnJlc29sdmVXaXRoKGcsYil9fWVsc2UgaWYoZyE9PWEpe2cucmVzb2x2ZVdpdGgoZyxkP1thXTpbXSl9cmV0dXJuIGcucHJvbWlzZSgpfX0pO2Yuc3VwcG9ydD1mLnN1cHBvcnR8fHt9O3ZhciBpPS8lMjAvZyxqPS9cXFtcXF0kLyxrPS9cXHI/XFxuL2csbD0vIy4qJC8sbT0vXiguKj8pOlsgXFx0XSooW15cXHJcXG5dKilcXHI/JC9tZyxuPS9eKD86Y29sb3J8ZGF0ZXxkYXRldGltZXxlbWFpbHxoaWRkZW58bW9udGh8bnVtYmVyfHBhc3N3b3JkfHJhbmdlfHNlYXJjaHx0ZWx8dGV4dHx0aW1lfHVybHx3ZWVrKSQvaSxvPS9eKD86YWJvdXR8YXBwfGFwcFxcLXN0b3JhZ2V8LitcXC1leHRlbnNpb258ZmlsZXxyZXN8d2lkZ2V0KTokLyxwPS9eKD86R0VUfEhFQUQpJC8scT0vXlxcL1xcLy8scj0vXFw/LyxzPS88c2NyaXB0XFxiW148XSooPzooPyE8XFwvc2NyaXB0Pik8W148XSopKjxcXC9zY3JpcHQ+L2dpLHQ9L14oPzpzZWxlY3R8dGV4dGFyZWEpL2ksdT0vXFxzKy8sdj0vKFs/Jl0pXz1bXiZdKi8sdz0vXihbXFx3XFwrXFwuXFwtXSs6KSg/OlxcL1xcLyhbXlxcLz8jOl0qKSg/OjooXFxkKykpPyk/Lyx4PWYuZm4ubG9hZCx5PXt9LHo9e30sQSxCO3RyeXtBPWUuaHJlZn1jYXRjaChDKXtBPWMuY3JlYXRlRWxlbWVudChcImFcIik7QS5ocmVmPVwiXCI7QT1BLmhyZWZ9Qj13LmV4ZWMoQS50b0xvd2VyQ2FzZSgpKXx8W107Zi5mbi5leHRlbmQoe2xvYWQ6ZnVuY3Rpb24oYSxjLGQpe2lmKHR5cGVvZiBhIT09XCJzdHJpbmdcIiYmeCl7cmV0dXJuIHguYXBwbHkodGhpcyxhcmd1bWVudHMpfWVsc2UgaWYoIXRoaXMubGVuZ3RoKXtyZXR1cm4gdGhpc312YXIgZT1hLmluZGV4T2YoXCIgXCIpO2lmKGU+PTApe3ZhciBnPWEuc2xpY2UoZSxhLmxlbmd0aCk7YT1hLnNsaWNlKDAsZSl9dmFyIGg9XCJHRVRcIjtpZihjKXtpZihmLmlzRnVuY3Rpb24oYykpe2Q9YztjPWJ9ZWxzZSBpZih0eXBlb2YgYz09PVwib2JqZWN0XCIpe2M9Zi5wYXJhbShjLGYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsKTtoPVwiUE9TVFwifX12YXIgaT10aGlzO2YuYWpheCh7dXJsOmEsdHlwZTpoLGRhdGFUeXBlOlwiaHRtbFwiLGRhdGE6Yyxjb21wbGV0ZTpmdW5jdGlvbihhLGIsYyl7Yz1hLnJlc3BvbnNlVGV4dDtpZihhLmlzUmVzb2x2ZWQoKSl7YS5kb25lKGZ1bmN0aW9uKGEpe2M9YX0pO2kuaHRtbChnP2YoXCI8ZGl2PlwiKS5hcHBlbmQoYy5yZXBsYWNlKHMsXCJcIikpLmZpbmQoZyk6Yyl9aWYoZCl7aS5lYWNoKGQsW2MsYixhXSl9fX0pO3JldHVybiB0aGlzfSxzZXJpYWxpemU6ZnVuY3Rpb24oKXtyZXR1cm4gZi5wYXJhbSh0aGlzLnNlcmlhbGl6ZUFycmF5KCkpfSxzZXJpYWxpemVBcnJheTpmdW5jdGlvbigpe3JldHVybiB0aGlzLm1hcChmdW5jdGlvbigpe3JldHVybiB0aGlzLmVsZW1lbnRzP2YubWFrZUFycmF5KHRoaXMuZWxlbWVudHMpOnRoaXN9KS5maWx0ZXIoZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5uYW1lJiYhdGhpcy5kaXNhYmxlZCYmKHRoaXMuY2hlY2tlZHx8dC50ZXN0KHRoaXMubm9kZU5hbWUpfHxuLnRlc3QodGhpcy50eXBlKSl9KS5tYXAoZnVuY3Rpb24oYSxiKXt2YXIgYz1mKHRoaXMpLnZhbCgpO3JldHVybiBjPT1udWxsP251bGw6Zi5pc0FycmF5KGMpP2YubWFwKGMsZnVuY3Rpb24oYSxjKXtyZXR1cm57bmFtZTpiLm5hbWUsdmFsdWU6YS5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSk6e25hbWU6Yi5uYW1lLHZhbHVlOmMucmVwbGFjZShrLFwiXFxyXFxuXCIpfX0pLmdldCgpfX0pO2YuZWFjaChcImFqYXhTdGFydCBhamF4U3RvcCBhamF4Q29tcGxldGUgYWpheEVycm9yIGFqYXhTdWNjZXNzIGFqYXhTZW5kXCIuc3BsaXQoXCIgXCIpLGZ1bmN0aW9uKGEsYil7Zi5mbltiXT1mdW5jdGlvbihhKXtyZXR1cm4gdGhpcy5iaW5kKGIsYSl9fSk7Zi5lYWNoKFtcImdldFwiLFwicG9zdFwiXSxmdW5jdGlvbihhLGMpe2ZbY109ZnVuY3Rpb24oYSxkLGUsZyl7aWYoZi5pc0Z1bmN0aW9uKGQpKXtnPWd8fGU7ZT1kO2Q9Yn1yZXR1cm4gZi5hamF4KHt0eXBlOmMsdXJsOmEsZGF0YTpkLHN1Y2Nlc3M6ZSxkYXRhVHlwZTpnfSl9fSk7Zi5leHRlbmQoe2dldFNjcmlwdDpmdW5jdGlvbihhLGMpe3JldHVybiBmLmdldChhLGIsYyxcInNjcmlwdFwiKX0sZ2V0SlNPTjpmdW5jdGlvbihhLGIsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwianNvblwiKX0sYWpheFNldHVwOmZ1bmN0aW9uKGEsYil7aWYoYil7RihhLGYuYWpheFNldHRpbmdzKX1lbHNle2I9YTthPWYuYWpheFNldHRpbmdzfUYoYSxiKTtyZXR1cm4gYX0sYWpheFNldHRpbmdzOnt1cmw6QSxpc0xvY2FsOm8udGVzdChCWzFdKSxnbG9iYWw6dHJ1ZSx0eXBlOlwiR0VUXCIsY29udGVudFR5cGU6XCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixwcm9jZXNzRGF0YTp0cnVlLGFzeW5jOnRydWUsYWNjZXB0czp7eG1sOlwiYXBwbGljYXRpb24veG1sLCB0ZXh0L3htbFwiLGh0bWw6XCJ0ZXh0L2h0bWxcIix0ZXh0OlwidGV4dC9wbGFpblwiLGpzb246XCJhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L2phdmFzY3JpcHRcIixcIipcIjpcIiovKlwifSxjb250ZW50czp7eG1sOi94bWwvLGh0bWw6L2h0bWwvLGpzb246L2pzb24vfSxyZXNwb25zZUZpZWxkczp7eG1sOlwicmVzcG9uc2VYTUxcIix0ZXh0OlwicmVzcG9uc2VUZXh0XCJ9LGNvbnZlcnRlcnM6e1wiKiB0ZXh0XCI6YS5TdHJpbmcsXCJ0ZXh0IGh0bWxcIjp0cnVlLFwidGV4dCBqc29uXCI6Zi5wYXJzZUpTT04sXCJ0ZXh0IHhtbFwiOmYucGFyc2VYTUx9LGZsYXRPcHRpb25zOntjb250ZXh0OnRydWUsdXJsOnRydWV9fSxhamF4UHJlZmlsdGVyOkQoeSksYWpheFRyYW5zcG9ydDpEKHopLGFqYXg6ZnVuY3Rpb24oYSxjKXtmdW5jdGlvbiBLKGEsYyxsLG0pe2lmKEQ9PT0yKXtyZXR1cm59RD0yO2lmKEEpe2NsZWFyVGltZW91dChBKX14PWI7cz1tfHxcIlwiO0oucmVhZHlTdGF0ZT1hPjA/NDowO3ZhciBuLG8scCxxPWMscj1sP0goZCxKLGwpOmIsdCx1O2lmKGE+PTIwMCYmYTwzMDB8fGE9PT0zMDQpe2lmKGQuaWZNb2RpZmllZCl7aWYodD1KLmdldFJlc3BvbnNlSGVhZGVyKFwiTGFzdC1Nb2RpZmllZFwiKSl7Zi5sYXN0TW9kaWZpZWRba109dH1pZih1PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJFdGFnXCIpKXtmLmV0YWdba109dX19aWYoYT09PTMwNCl7cT1cIm5vdG1vZGlmaWVkXCI7bj10cnVlfWVsc2V7dHJ5e289SShkLHIpO3E9XCJzdWNjZXNzXCI7bj10cnVlfWNhdGNoKHYpe3E9XCJwYXJzZXJlcnJvclwiO3A9dn19fWVsc2V7cD1xO2lmKCFxfHxhKXtxPVwiZXJyb3JcIjtpZihhPDApe2E9MH19fUouc3RhdHVzPWE7Si5zdGF0dXNUZXh0PVwiXCIrKGN8fHEpO2lmKG4pe2gucmVzb2x2ZVdpdGgoZSxbbyxxLEpdKX1lbHNle2gucmVqZWN0V2l0aChlLFtKLHEscF0pfUouc3RhdHVzQ29kZShqKTtqPWI7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFwiKyhuP1wiU3VjY2Vzc1wiOlwiRXJyb3JcIiksW0osZCxuP286cF0pfWkucmVzb2x2ZVdpdGgoZSxbSixxXSk7aWYoRil7Zy50cmlnZ2VyKFwiYWpheENvbXBsZXRlXCIsW0osZF0pO2lmKCEtLWYuYWN0aXZlKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RvcFwiKX19fWlmKHR5cGVvZiBhPT09XCJvYmplY3RcIil7Yz1hO2E9Yn1jPWN8fHt9O3ZhciBkPWYuYWpheFNldHVwKHt9LGMpLGU9ZC5jb250ZXh0fHxkLGc9ZSE9PWQmJihlLm5vZGVUeXBlfHxlIGluc3RhbmNlb2YgZik/ZihlKTpmLmV2ZW50LGg9Zi5EZWZlcnJlZCgpLGk9Zi5fRGVmZXJyZWQoKSxqPWQuc3RhdHVzQ29kZXx8e30sayxuPXt9LG89e30scyx0LHgsQSxDLEQ9MCxGLEcsSj17cmVhZHlTdGF0ZTowLHNldFJlcXVlc3RIZWFkZXI6ZnVuY3Rpb24oYSxiKXtpZighRCl7dmFyIGM9YS50b0xvd2VyQ2FzZSgpO2E9b1tjXT1vW2NdfHxhO25bYV09Yn1yZXR1cm4gdGhpc30sZ2V0QWxsUmVzcG9uc2VIZWFkZXJzOmZ1bmN0aW9uKCl7cmV0dXJuIEQ9PT0yP3M6bnVsbH0sZ2V0UmVzcG9uc2VIZWFkZXI6ZnVuY3Rpb24oYSl7dmFyIGM7aWYoRD09PTIpe2lmKCF0KXt0PXt9O3doaWxlKGM9bS5leGVjKHMpKXt0W2NbMV0udG9Mb3dlckNhc2UoKV09Y1syXX19Yz10W2EudG9Mb3dlckNhc2UoKV19cmV0dXJuIGM9PT1iP251bGw6Y30sb3ZlcnJpZGVNaW1lVHlwZTpmdW5jdGlvbihhKXtpZighRCl7ZC5taW1lVHlwZT1hfXJldHVybiB0aGlzfSxhYm9ydDpmdW5jdGlvbihhKXthPWF8fFwiYWJvcnRcIjtpZih4KXt4LmFib3J0KGEpfUsoMCxhKTtyZXR1cm4gdGhpc319O2gucHJvbWlzZShKKTtKLnN1Y2Nlc3M9Si5kb25lO0ouZXJyb3I9Si5mYWlsO0ouY29tcGxldGU9aS5kb25lO0ouc3RhdHVzQ29kZT1mdW5jdGlvbihhKXtpZihhKXt2YXIgYjtpZihEPDIpe2ZvcihiIGluIGEpe2pbYl09W2pbYl0sYVtiXV19fWVsc2V7Yj1hW0ouc3RhdHVzXTtKLnRoZW4oYixiKX19cmV0dXJuIHRoaXN9O2QudXJsPSgoYXx8ZC51cmwpK1wiXCIpLnJlcGxhY2UobCxcIlwiKS5yZXBsYWNlKHEsQlsxXStcIi8vXCIpO2QuZGF0YVR5cGVzPWYudHJpbShkLmRhdGFUeXBlfHxcIipcIikudG9Mb3dlckNhc2UoKS5zcGxpdCh1KTtpZihkLmNyb3NzRG9tYWluPT1udWxsKXtDPXcuZXhlYyhkLnVybC50b0xvd2VyQ2FzZSgpKTtkLmNyb3NzRG9tYWluPSEhKEMmJihDWzFdIT1CWzFdfHxDWzJdIT1CWzJdfHwoQ1szXXx8KENbMV09PT1cImh0dHA6XCI/ODA6NDQzKSkhPShCWzNdfHwoQlsxXT09PVwiaHR0cDpcIj84MDo0NDMpKSkpfWlmKGQuZGF0YSYmZC5wcm9jZXNzRGF0YSYmdHlwZW9mIGQuZGF0YSE9PVwic3RyaW5nXCIpe2QuZGF0YT1mLnBhcmFtKGQuZGF0YSxkLnRyYWRpdGlvbmFsKX1FKHksZCxjLEopO2lmKEQ9PT0yKXtyZXR1cm4gZmFsc2V9Rj1kLmdsb2JhbDtkLnR5cGU9ZC50eXBlLnRvVXBwZXJDYXNlKCk7ZC5oYXNDb250ZW50PSFwLnRlc3QoZC50eXBlKTtpZihGJiZmLmFjdGl2ZSsrPT09MCl7Zi5ldmVudC50cmlnZ2VyKFwiYWpheFN0YXJ0XCIpfWlmKCFkLmhhc0NvbnRlbnQpe2lmKGQuZGF0YSl7ZC51cmwrPShyLnRlc3QoZC51cmwpP1wiJlwiOlwiP1wiKStkLmRhdGE7ZGVsZXRlIGQuZGF0YX1rPWQudXJsO2lmKGQuY2FjaGU9PT1mYWxzZSl7dmFyIEw9Zi5ub3coKSxNPWQudXJsLnJlcGxhY2UodixcIiQxXz1cIitMKTtkLnVybD1NKyhNPT09ZC51cmw/KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK1wiXz1cIitMOlwiXCIpfX1pZihkLmRhdGEmJmQuaGFzQ29udGVudCYmZC5jb250ZW50VHlwZSE9PWZhbHNlfHxjLmNvbnRlbnRUeXBlKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJDb250ZW50LVR5cGVcIixkLmNvbnRlbnRUeXBlKX1pZihkLmlmTW9kaWZpZWQpe2s9a3x8ZC51cmw7aWYoZi5sYXN0TW9kaWZpZWRba10pe0ouc2V0UmVxdWVzdEhlYWRlcihcIklmLU1vZGlmaWVkLVNpbmNlXCIsZi5sYXN0TW9kaWZpZWRba10pfWlmKGYuZXRhZ1trXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTm9uZS1NYXRjaFwiLGYuZXRhZ1trXSl9fUouc2V0UmVxdWVzdEhlYWRlcihcIkFjY2VwdFwiLGQuZGF0YVR5cGVzWzBdJiZkLmFjY2VwdHNbZC5kYXRhVHlwZXNbMF1dP2QuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0rKGQuZGF0YVR5cGVzWzBdIT09XCIqXCI/XCIsICovKjsgcT0wLjAxXCI6XCJcIik6ZC5hY2NlcHRzW1wiKlwiXSk7Zm9yKEcgaW4gZC5oZWFkZXJzKXtKLnNldFJlcXVlc3RIZWFkZXIoRyxkLmhlYWRlcnNbR10pfWlmKGQuYmVmb3JlU2VuZCYmKGQuYmVmb3JlU2VuZC5jYWxsKGUsSixkKT09PWZhbHNlfHxEPT09Mikpe0ouYWJvcnQoKTtyZXR1cm4gZmFsc2V9Zm9yKEcgaW57c3VjY2VzczoxLGVycm9yOjEsY29tcGxldGU6MX0pe0pbR10oZFtHXSl9eD1FKHosZCxjLEopO2lmKCF4KXtLKC0xLFwiTm8gVHJhbnNwb3J0XCIpfWVsc2V7Si5yZWFkeVN0YXRlPTE7aWYoRil7Zy50cmlnZ2VyKFwiYWpheFNlbmRcIixbSixkXSl9aWYoZC5hc3luYyYmZC50aW1lb3V0PjApe0E9c2V0VGltZW91dChmdW5jdGlvbigpe0ouYWJvcnQoXCJ0aW1lb3V0XCIpfSxkLnRpbWVvdXQpfXRyeXtEPTE7eC5zZW5kKG4sSyl9Y2F0Y2goTil7aWYoRDwyKXtLKC0xLE4pfWVsc2V7Zi5lcnJvcihOKX19fXJldHVybiBKfSxwYXJhbTpmdW5jdGlvbihhLGMpe3ZhciBkPVtdLGU9ZnVuY3Rpb24oYSxiKXtiPWYuaXNGdW5jdGlvbihiKT9iKCk6YjtkW2QubGVuZ3RoXT1lbmNvZGVVUklDb21wb25lbnQoYSkrXCI9XCIrZW5jb2RlVVJJQ29tcG9uZW50KGIpfTtpZihjPT09Yil7Yz1mLmFqYXhTZXR0aW5ncy50cmFkaXRpb25hbH1pZihmLmlzQXJyYXkoYSl8fGEuanF1ZXJ5JiYhZi5pc1BsYWluT2JqZWN0KGEpKXtmLmVhY2goYSxmdW5jdGlvbigpe2UodGhpcy5uYW1lLHRoaXMudmFsdWUpfSl9ZWxzZXtmb3IodmFyIGcgaW4gYSl7RyhnLGFbZ10sYyxlKX19cmV0dXJuIGQuam9pbihcIiZcIikucmVwbGFjZShpLFwiK1wiKX19KTtmLmV4dGVuZCh7YWN0aXZlOjAsbGFzdE1vZGlmaWVkOnt9LGV0YWc6e319KTt2YXIgSj1hLkFjdGl2ZVhPYmplY3Q/ZnVuY3Rpb24oKXtmb3IodmFyIGEgaW4gTCl7TFthXSgwLDEpfX06ZmFsc2UsSz0wLEw7Zi5hamF4U2V0dGluZ3MueGhyPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe3JldHVybiF0aGlzLmlzTG9jYWwmJk0oKXx8TigpfTpNOyhmdW5jdGlvbihhKXtmLmV4dGVuZChmLnN1cHBvcnQse2FqYXg6ISFhLGNvcnM6ISFhJiZcIndpdGhDcmVkZW50aWFsc1wiaW4gYX0pfSkoZi5hamF4U2V0dGluZ3MueGhyKCkpO2lmKGYuc3VwcG9ydC5hamF4KXtmLmFqYXhUcmFuc3BvcnQoZnVuY3Rpb24oYyl7aWYoIWMuY3Jvc3NEb21haW58fGYuc3VwcG9ydC5jb3JzKXt2YXIgZDtyZXR1cm57c2VuZDpmdW5jdGlvbihlLGcpe3ZhciBoPWMueGhyKCksaSxqO2lmKGMudXNlcm5hbWUpe2gub3BlbihjLnR5cGUsYy51cmwsYy5hc3luYyxjLnVzZXJuYW1lLGMucGFzc3dvcmQpfWVsc2V7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jKX1pZihjLnhockZpZWxkcyl7Zm9yKGogaW4gYy54aHJGaWVsZHMpe2hbal09Yy54aHJGaWVsZHNbal19fWlmKGMubWltZVR5cGUmJmgub3ZlcnJpZGVNaW1lVHlwZSl7aC5vdmVycmlkZU1pbWVUeXBlKGMubWltZVR5cGUpfWlmKCFjLmNyb3NzRG9tYWluJiYhZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl0pe2VbXCJYLVJlcXVlc3RlZC1XaXRoXCJdPVwiWE1MSHR0cFJlcXVlc3RcIn10cnl7Zm9yKGogaW4gZSl7aC5zZXRSZXF1ZXN0SGVhZGVyKGosZVtqXSl9fWNhdGNoKGspe31oLnNlbmQoYy5oYXNDb250ZW50JiZjLmRhdGF8fG51bGwpO2Q9ZnVuY3Rpb24oYSxlKXt2YXIgaixrLGwsbSxuO3RyeXtpZihkJiYoZXx8aC5yZWFkeVN0YXRlPT09NCkpe2Q9YjtpZihpKXtoLm9ucmVhZHlzdGF0ZWNoYW5nZT1mLm5vb3A7aWYoSil7ZGVsZXRlIExbaV19fWlmKGUpe2lmKGgucmVhZHlTdGF0ZSE9PTQpe2guYWJvcnQoKX19ZWxzZXtqPWguc3RhdHVzO2w9aC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKTttPXt9O249aC5yZXNwb25zZVhNTDtpZihuJiZuLmRvY3VtZW50RWxlbWVudCl7bS54bWw9bn1tLnRleHQ9aC5yZXNwb25zZVRleHQ7dHJ5e2s9aC5zdGF0dXNUZXh0fWNhdGNoKG8pe2s9XCJcIn1pZighaiYmYy5pc0xvY2FsJiYhYy5jcm9zc0RvbWFpbil7aj1tLnRleHQ/MjAwOjQwNH1lbHNlIGlmKGo9PT0xMjIzKXtqPTIwNH19fX1jYXRjaChwKXtpZighZSl7ZygtMSxwKX19aWYobSl7ZyhqLGssbSxsKX19O2lmKCFjLmFzeW5jfHxoLnJlYWR5U3RhdGU9PT00KXtkKCl9ZWxzZXtpPSsrSztpZihKKXtpZighTCl7TD17fTtmKGEpLnVubG9hZChKKX1MW2ldPWR9aC5vbnJlYWR5c3RhdGVjaGFuZ2U9ZH19LGFib3J0OmZ1bmN0aW9uKCl7aWYoZCl7ZCgwLDEpfX19fX0pfWYuYWpheFNldHRpbmdzLmdsb2JhbD1mYWxzZTthLmpRdWVyeT1hLiQ9Zn0pKGdsb2JhbCl9IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQkFNIGZvcm1hdDogaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG52YXIgUGFpcmVkSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9QYWlyZWRJbnRlcnZhbFRyZWUuanMnKS5QYWlyZWRJbnRlcnZhbFRyZWU7XG52YXIgUmVtb3RlVHJhY2sgPSByZXF1aXJlKCcuL3V0aWxzL1JlbW90ZVRyYWNrLmpzJykuUmVtb3RlVHJhY2s7XG5cbnZhciBCYW1Gb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY2hyb21vc29tZXM6ICcnLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yOiAnMTg4LDE4OCwxODgnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogMjAwMCwgcGFjazogMjAwMH0sXG4gICAgLy8gSWYgYSBudWNsZW90aWRlIGRpZmZlcnMgZnJvbSB0aGUgcmVmZXJlbmNlIHNlcXVlbmNlIGluIGdyZWF0ZXIgdGhhbiAyMCUgb2YgcXVhbGl0eSB3ZWlnaHRlZCByZWFkcywgXG4gICAgLy8gSUdWIGNvbG9ycyB0aGUgYmFyIGluIHByb3BvcnRpb24gdG8gdGhlIHJlYWQgY291bnQgb2YgZWFjaCBiYXNlOyB0aGUgZm9sbG93aW5nIGNoYW5nZXMgdGhhdCB0aHJlc2hvbGQgZm9yIGNocm9tb3pvb21cbiAgICBhbGxlbGVGcmVxVGhyZXNob2xkOiAwLjIsXG4gICAgb3B0aW1hbEZldGNoV2luZG93OiAwLFxuICAgIG1heEZldGNoV2luZG93OiAwLFxuICAgIC8vIFRoZSBmb2xsb3dpbmcgY2FuIGJlIFwiZW5zZW1ibF91Y3NjXCIgb3IgXCJ1Y3NjX2Vuc2VtYmxcIiB0byBhdHRlbXB0IGF1dG8tY3Jvc3NtYXBwaW5nIG9mIHJlZmVyZW5jZSBjb250aWcgbmFtZXNcbiAgICAvLyBiZXR3ZWVuIHRoZSB0d28gc2NoZW1lcywgd2hpY2ggSUdWIGRvZXMsIGJ1dCBpcyBhIHBlcmVubmlhbCBpc3N1ZTogaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTAwNjIvXG4gICAgLy8gSSBob3BlIG5vdCB0byBuZWVkIGFsbCB0aGUgbWFwcGluZ3MgaW4gaGVyZSBodHRwczovL2dpdGh1Yi5jb20vZHByeWFuNzkvQ2hyb21vc29tZU1hcHBpbmdzIGJ1dCBpdCBtYXkgYmUgbmVjZXNzYXJ5XG4gICAgY29udmVydENoclNjaGVtZTogbnVsbCxcbiAgICAvLyBEcmF3IHBhaXJlZCBlbmRzIHdpdGhpbiBhIHJhbmdlIG9mIGV4cGVjdGVkIGluc2VydCBzaXplcyBhcyBhIGNvbnRpbnVvdXMgZmVhdHVyZT9cbiAgICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI3BhaXJlZCBmb3IgaG93IHRoaXMgd29ya3NcbiAgICB2aWV3QXNQYWlyczogZmFsc2VcbiAgfSxcbiAgXG4gIC8vIFRoZSBGTEFHIGNvbHVtbiBmb3IgQkFNL1NBTSBpcyBhIGNvbWJpbmF0aW9uIG9mIGJpdHdpc2UgZmxhZ3NcbiAgZmxhZ3M6IHtcbiAgICBpc1JlYWRQYWlyZWQ6IDB4MSxcbiAgICBpc1JlYWRQcm9wZXJseUFsaWduZWQ6IDB4MixcbiAgICBpc1JlYWRVbm1hcHBlZDogMHg0LFxuICAgIGlzTWF0ZVVubWFwcGVkOiAweDgsXG4gICAgcmVhZFN0cmFuZFJldmVyc2U6IDB4MTAsXG4gICAgbWF0ZVN0cmFuZFJldmVyc2U6IDB4MjAsXG4gICAgaXNSZWFkRmlyc3RPZlBhaXI6IDB4NDAsXG4gICAgaXNSZWFkTGFzdE9mUGFpcjogMHg4MCxcbiAgICBpc1NlY29uZGFyeUFsaWdubWVudDogMHgxMDAsXG4gICAgaXNSZWFkRmFpbGluZ1ZlbmRvclFDOiAweDIwMCxcbiAgICBpc0R1cGxpY2F0ZVJlYWQ6IDB4NDAwLFxuICAgIGlzU3VwcGxlbWVudGFyeUFsaWdubWVudDogMHg4MDBcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYnJvd3NlckNocnMgPSBfLmtleXModGhpcy5icm93c2VyT3B0cyk7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBCQU0gdHJhY2sgYXQgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMuYnJvd3NlckNoclNjaGVtZSA9IHRoaXMudHlwZShcImJhbVwiKS5ndWVzc0NoclNjaGVtZShfLmtleXModGhpcy5icm93c2VyT3B0cy5jaHJQb3MpKTtcbiAgfSxcbiAgXG4gIC8vIFRPRE86IFdlIG11c3Qgbm90ZSB0aGF0IHdoZW4gd2UgY2hhbmdlIG9wdHMudmlld0FzUGFpcnMsIHdlICpuZWVkKiB0byB0aHJvdyBvdXQgdGhpcy5kYXRhLnBpbGV1cFxuICAvLyAgICAgICAgIGFuZCBibG93IHVwIHRoZSBhcmVhSW5kZXhcbiAgLy8gVE9ETzogSWYgdGhlIHBhaXJpbmcgaW50ZXJ2YWwgY2hhbmdlZCwgd2Ugc2hvdWxkIHRvc3MgdGhlIGVudGlyZSBjYWNoZSBhbmQgcmVzZXQgdGhlIFJlbW90ZVRyYWNrIGJpbnMsXG4gIC8vICAgICAgICAgYW5kIGJsb3cgdXAgdGhlIGFyZWFJbmRleC5cbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcblxuICB9LFxuICBcbiAgZ3Vlc3NDaHJTY2hlbWU6IGZ1bmN0aW9uKGNocnMpIHtcbiAgICBsaW1pdCA9IE1hdGgubWluKGNocnMubGVuZ3RoICogMC44LCAyMCk7XG4gICAgaWYgKF8uZmlsdGVyKGNocnMsIGZ1bmN0aW9uKGNocikgeyByZXR1cm4gKC9eY2hyLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ3Vjc2MnOyB9XG4gICAgaWYgKF8uZmlsdGVyKGNocnMsIGZ1bmN0aW9uKGNocikgeyByZXR1cm4gKC9eXFxkXFxkPyQvKS50ZXN0KGNocik7IH0pLmxlbmd0aCA+IGxpbWl0KSB7IHJldHVybiAnZW5zZW1ibCc7IH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgY2FjaGUgPSBuZXcgUGFpcmVkSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9LCBcbiAgICAgICAgICB7c3RhcnRLZXk6ICd0ZW1wbGF0ZVN0YXJ0JywgZW5kS2V5OiAndGVtcGxhdGVFbmQnLCBwYWlyZWRMZW5ndGhLZXk6ICd0bGVuJywgcGFpcmluZ0tleTogJ3FuYW1lJ30pLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JhbS5waHAnLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lKSB7XG4gICAgICAgIGNhc2UgJ2Vuc2VtYmxfdWNzYyc6IHJhbmdlID0gXy5tYXAocmFuZ2UsIGZ1bmN0aW9uKHIpIHsgcmV0dXJuIHIucmVwbGFjZSgvXmNoci8sICcnKTsgfSk7IGJyZWFrO1xuICAgICAgICBjYXNlICd1Y3NjX2Vuc2VtYmwnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL14oXFxkXFxkP3xYKTovLCAnY2hyJDE6Jyk7IH0pOyBicmVhaztcbiAgICAgIH1cbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgdmFyIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID49IDI7IH0pO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFBhcnNlIHRoZSBTQU0gZm9ybWF0IGludG8gaW50ZXJ2YWxzIHRoYXQgY2FuIGJlIGluc2VydGVkIGludG8gdGhlIEludGVydmFsVHJlZSBjYWNoZVxuICAgICAgICAgIHZhciBpbnRlcnZhbHMgPSBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyByZXR1cm4gc2VsZi50eXBlKCdiYW0nKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsKTsgfSk7XG4gICAgICAgICAgc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgc2VsZi5kYXRhID0ge2NhY2hlOiBjYWNoZSwgcmVtb3RlOiByZW1vdGUsIHBpbGV1cDoge30sIGluZm86IHt9fTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDI0LCBzdGFydDogMjR9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHNlbGYubm9BcmVhTGFiZWxzID0gdHJ1ZTtcbiAgICBzZWxmLmV4cGVjdHNTZXF1ZW5jZSA9IHRydWU7XG4gICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrcyA9IHt9O1xuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJhbSAoZS5nLiBgc2FtdG9vbHMgaWR4c3RhdHNgLCB1c2UgbWFwcGVkIHJlYWRzIHBlciByZWZlcmVuY2Ugc2VxdWVuY2VcbiAgICAvLyB0byBlc3RpbWF0ZSBtYXhGZXRjaFdpbmRvdyBhbmQgb3B0aW1hbEZldGNoV2luZG93LCBhbmQgc2V0dXAgYmlubmluZyBvbiB0aGUgUmVtb3RlVHJhY2suXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHt1cmw6IG8uYmlnRGF0YVVybH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciBtYXBwZWRSZWFkcyA9IDAsXG4gICAgICAgICAgbWF4SXRlbXNUb0RyYXcgPSBfLm1heChfLnZhbHVlcyhvLmRyYXdMaW1pdCkpLFxuICAgICAgICAgIGJhbUNocnMgPSBbXSxcbiAgICAgICAgICBjaHJTY2hlbWUsIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBfLmVhY2goZGF0YS5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSkge1xuICAgICAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KFwiXFx0XCIpLFxuICAgICAgICAgICAgcmVhZHNNYXBwZWRUb0NvbnRpZyA9IHBhcnNlSW50KGZpZWxkc1syXSwgMTApO1xuICAgICAgICAgIGlmIChmaWVsZHMubGVuZ3RoID09IDEgJiYgZmllbGRzWzBdID09ICcnKSB7IHJldHVybjsgfSAvLyBibGFuayBsaW5lXG4gICAgICAgICAgYmFtQ2hycy5wdXNoKGZpZWxkc1swXSk7XG4gICAgICAgICAgaWYgKF8uaXNOYU4ocmVhZHNNYXBwZWRUb0NvbnRpZykpIHsgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBvdXRwdXQgZm9yIHNhbXRvb2xzIGlkeHN0YXRzIG9uIHRoaXMgQkFNIHRyYWNrLlwiKTsgfVxuICAgICAgICAgIG1hcHBlZFJlYWRzICs9IHJlYWRzTWFwcGVkVG9Db250aWc7XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgc2VsZi5kYXRhLmluZm8uY2hyU2NoZW1lID0gY2hyU2NoZW1lID0gc2VsZi50eXBlKFwiYmFtXCIpLmd1ZXNzQ2hyU2NoZW1lKGJhbUNocnMpO1xuICAgICAgICBpZiAoby5jb252ZXJ0Q2hyU2NoZW1lICE9PSBmYWxzZSAmJiBjaHJTY2hlbWUgJiYgc2VsZi5icm93c2VyQ2hyU2NoZW1lICkge1xuICAgICAgICAgIG8uY29udmVydENoclNjaGVtZSA9IGNoclNjaGVtZSAhPSBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgPyBjaHJTY2hlbWUgKyAnXycgKyBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgOiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwID0gbWVhbkl0ZW1zUGVyQnAgPSBtYXBwZWRSZWFkcyAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZTtcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggPSAxMDA7IC8vIFRPRE86IHRoaXMgaXMgYSB0b3RhbCBndWVzcyBub3csIHNob3VsZCBncmFiIHRoaXMgZnJvbSBzb21lIHNhbXBsZWQgcmVhZHMuXG4gICAgICAgIG8ubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICBvLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioby5tYXhGZXRjaFdpbmRvdyAvIDIpO1xuICAgICAgICBcbiAgICAgICAgLy8gVE9ETzogV2Ugc2hvdWxkIGRlYWN0aXZhdGUgdGhlIHBhaXJpbmcgZnVuY3Rpb25hbGl0eSBvZiB0aGUgUGFpcmVkSW50ZXJ2YWxUcmVlIFxuICAgICAgICAvLyAgICAgICBpZiB3ZSBkb24ndCBzZWUgYW55IHBhaXJlZCByZWFkcyBpbiB0aGlzIEJBTS5cbiAgICAgICAgLy8gICAgICAgSWYgdGhlcmUgaXMgcGFpcmluZywgd2UgbmVlZCB0byB0ZWxsIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgd2hhdCByYW5nZSBvZiBpbnNlcnQgc2l6ZXNcbiAgICAgICAgLy8gICAgICAgc2hvdWxkIHRyaWdnZXIgcGFpcmluZy5cbiAgICAgICAgc2VsZi5kYXRhLmNhY2hlLnNldFBhaXJpbmdJbnRlcnZhbCgxMCwgNTAwMCk7XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBvLm9wdGltYWxGZXRjaFdpbmRvdywgby5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuZmxhZ3NbLi4uXSB0byBhIGh1bWFuIGludGVycHJldGFibGUgdmVyc2lvbiBvZiBmZWF0dXJlLmZsYWcgKGV4cGFuZGluZyB0aGUgYml0d2lzZSBmbGFncylcbiAgcGFyc2VGbGFnczogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7XG4gICAgZmVhdHVyZS5mbGFncyA9IHt9O1xuICAgIF8uZWFjaCh0aGlzLnR5cGUoJ2JhbScpLmZsYWdzLCBmdW5jdGlvbihiaXQsIGZsYWcpIHtcbiAgICAgIGZlYXR1cmUuZmxhZ3NbZmxhZ10gPSAhIShmZWF0dXJlLmZsYWcgJiBiaXQpO1xuICAgIH0pO1xuICB9LFxuICBcbiAgLy8gU2V0cyBmZWF0dXJlLmJsb2NrcyBhbmQgZmVhdHVyZS5lbmQgYmFzZWQgb24gZmVhdHVyZS5jaWdhclxuICAvLyBTZWUgc2VjdGlvbiAxLjQgb2YgaHR0cHM6Ly9zYW10b29scy5naXRodWIuaW8vaHRzLXNwZWNzL1NBTXYxLnBkZiBmb3IgYW4gZXhwbGFuYXRpb24gb2YgQ0lHQVIgXG4gIHBhcnNlQ2lnYXI6IGZ1bmN0aW9uKGZlYXR1cmUsIGxpbmVubykgeyAgICAgICAgXG4gICAgdmFyIGNpZ2FyID0gZmVhdHVyZS5jaWdhcixcbiAgICAgIHJlZkxlbiA9IDAsXG4gICAgICBzZXFQb3MgPSAwLFxuICAgICAgb3BlcmF0aW9ucywgbGVuZ3RocztcbiAgICBcbiAgICBmZWF0dXJlLmJsb2NrcyA9IFtdO1xuICAgIGZlYXR1cmUuaW5zZXJ0aW9ucyA9IFtdO1xuICAgIFxuICAgIG9wcyA9IGNpZ2FyLnNwbGl0KC9cXGQrLykuc2xpY2UoMSk7XG4gICAgbGVuZ3RocyA9IGNpZ2FyLnNwbGl0KC9bQS1aPV0vKS5zbGljZSgwLCAtMSk7XG4gICAgaWYgKG9wcy5sZW5ndGggIT0gbGVuZ3Rocy5sZW5ndGgpIHsgdGhpcy53YXJuKFwiSW52YWxpZCBDSUdBUiAnXCIgKyBjaWdhciArIFwiJyBmb3IgXCIgKyBmZWF0dXJlLmRlc2MpOyByZXR1cm47IH1cbiAgICBsZW5ndGhzID0gXy5tYXAobGVuZ3RocywgcGFyc2VJbnQxMCk7XG4gICAgXG4gICAgXy5lYWNoKG9wcywgZnVuY3Rpb24ob3AsIGkpIHtcbiAgICAgIHZhciBsZW4gPSBsZW5ndGhzW2ldLFxuICAgICAgICBibG9jaywgaW5zZXJ0aW9uO1xuICAgICAgaWYgKC9eW01YPV0kLy50ZXN0KG9wKSkge1xuICAgICAgICAvLyBBbGlnbm1lbnQgbWF0Y2gsIHNlcXVlbmNlIG1hdGNoLCBzZXF1ZW5jZSBtaXNtYXRjaFxuICAgICAgICBibG9jayA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGJsb2NrLmVuZCA9IGJsb2NrLnN0YXJ0ICsgbGVuO1xuICAgICAgICBibG9jay50eXBlID0gb3A7XG4gICAgICAgIGJsb2NrLnNlcSA9IGZlYXR1cmUuc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKC9eW05EXSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIFNraXBwZWQgcmVmZXJlbmNlIHJlZ2lvbiwgZGVsZXRpb24gZnJvbSByZWZlcmVuY2VcbiAgICAgICAgcmVmTGVuICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ0knKSB7XG4gICAgICAgIC8vIEluc2VydGlvblxuICAgICAgICBpbnNlcnRpb24gPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW4sIGVuZDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGluc2VydGlvbi5zZXEgPSBmZWF0dXJlLnNlcS5zbGljZShzZXFQb3MsIHNlcVBvcyArIGxlbik7XG4gICAgICAgIGZlYXR1cmUuaW5zZXJ0aW9ucy5wdXNoKGluc2VydGlvbik7XG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKG9wID09ICdTJykge1xuICAgICAgICAvLyBTb2Z0IGNsaXBwaW5nOyBzaW1wbHkgc2tpcCB0aGVzZSBiYXNlcyBpbiBTRVEsIHBvc2l0aW9uIG9uIHJlZmVyZW5jZSBpcyB1bmNoYW5nZWQuXG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9XG4gICAgICAvLyBUaGUgb3RoZXIgdHdvIENJR0FSIG9wcywgSCBhbmQgUCwgYXJlIG5vdCByZWxldmFudCB0byBkcmF3aW5nIGFsaWdubWVudHMuXG4gICAgfSk7XG4gICAgXG4gICAgZmVhdHVyZS5lbmQgPSBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVuO1xuICB9LFxuICBcbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbHMgPSBbJ3FuYW1lJywgJ2ZsYWcnLCAncm5hbWUnLCAncG9zJywgJ21hcHEnLCAnY2lnYXInLCAncm5leHQnLCAncG5leHQnLCAndGxlbicsICdzZXEnLCAncXVhbCddLFxuICAgICAgZmVhdHVyZSA9IHt9LFxuICAgICAgZmllbGRzID0gbGluZS5zcGxpdChcIlxcdFwiKSxcbiAgICAgIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBfLmVhY2goXy5maXJzdChmaWVsZHMsIGNvbHMubGVuZ3RoKSwgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgLy8gQ29udmVydCBhdXRvbWF0aWNhbGx5IGJldHdlZW4gRW5zZW1ibCBzdHlsZSAxLCAyLCAzLCBYIDwtLT4gVUNTQyBzdHlsZSBjaHIxLCBjaHIyLCBjaHIzLCBjaHJYIGFzIGNvbmZpZ3VyZWQvYXV0b2RldGVjdGVkXG4gICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogZmVhdHVyZS5ybmFtZSA9IGZlYXR1cmUucm5hbWUucmVwbGFjZSgvXmNoci8sICcnKTsgYnJlYWs7XG4gICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiBmZWF0dXJlLnJuYW1lID0gKC9eKFxcZFxcZD98WCkkLy50ZXN0KGZlYXR1cmUucm5hbWUpID8gJ2NocicgOiAnJykgKyBmZWF0dXJlLnJuYW1lOyBicmVhaztcbiAgICB9XG4gICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5xbmFtZTtcbiAgICBmZWF0dXJlLmZsYWcgPSBwYXJzZUludDEwKGZlYXR1cmUuZmxhZyk7XG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbZmVhdHVyZS5ybmFtZV07XG4gICAgbGluZW5vID0gbGluZW5vIHx8IDA7XG4gICAgXG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkgeyBcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgUk5BTUUgJ1wiK2ZlYXR1cmUucm5hbWUrXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGZlYXR1cmUucG9zID09PSAnMCcgfHwgIWZlYXR1cmUuY2lnYXIgfHwgZmVhdHVyZS5jaWdhciA9PSAnKicpIHtcbiAgICAgIC8vIFVubWFwcGVkIHJlYWQuIFNpbmNlIHdlIGNhbid0IGRyYXcgdGhlc2UgYXQgYWxsLCB3ZSBkb24ndCBib3RoZXIgcGFyc2luZyB0aGVtIGZ1cnRoZXIuXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgZmVhdHVyZS5zY29yZSA9IF8uaXNVbmRlZmluZWQoZmVhdHVyZS5zY29yZSkgPyAnPycgOiBmZWF0dXJlLnNjb3JlO1xuICAgICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS5wb3MpOyAgICAgICAgLy8gUE9TIGlzIDEtYmFzZWQsIGhlbmNlIG5vIGluY3JlbWVudCBhcyBmb3IgcGFyc2luZyBCRURcbiAgICAgIGZlYXR1cmUuZGVzYyA9IGZlYXR1cmUucW5hbWUgKyAnIGF0ICcgKyBmZWF0dXJlLnJuYW1lICsgJzonICsgZmVhdHVyZS5wb3M7XG4gICAgICBmZWF0dXJlLnRsZW4gPSBwYXJzZUludDEwKGZlYXR1cmUudGxlbik7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlRmxhZ3MuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pO1xuICAgICAgZmVhdHVyZS5zdHJhbmQgPSBmZWF0dXJlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gJy0nIDogJysnO1xuICAgICAgdGhpcy50eXBlKCdiYW0nKS5wYXJzZUNpZ2FyLmNhbGwodGhpcywgZmVhdHVyZSwgbGluZW5vKTsgLy8gVGhpcyBhbHNvIHNldHMgLmVuZCBhcHByb3ByaWF0ZWx5XG4gICAgfVxuICAgIC8vIFdlIGhhdmUgdG8gY29tZSB1cCB3aXRoIHNvbWV0aGluZyB0aGF0IGlzIGEgdW5pcXVlIGxhYmVsIGZvciBldmVyeSBsaW5lIHRvIGRlZHVwZSByb3dzLlxuICAgIC8vIFRoZSBmb2xsb3dpbmcgaXMgdGVjaG5pY2FsbHkgbm90IGd1YXJhbnRlZWQgYnkgYSB2YWxpZCBCQU0gKGV2ZW4gYXQgR0FUSyBzdGFuZGFyZHMpLCBidXQgaXQncyB0aGUgYmVzdCBJIGdvdC5cbiAgICBmZWF0dXJlLmlkID0gW2ZlYXR1cmUucW5hbWUsIGZlYXR1cmUuZmxhZywgZmVhdHVyZS5ybmFtZSwgZmVhdHVyZS5wb3MsIGZlYXR1cmUuY2lnYXJdLmpvaW4oXCJcXHRcIik7XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICBwaWxldXA6IGZ1bmN0aW9uKGludGVydmFscywgc3RhcnQsIGVuZCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgcG9zaXRpb25zVG9DYWxjdWxhdGUgPSB7fSxcbiAgICAgIG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID0gMCxcbiAgICAgIGk7XG4gICAgXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgLy8gTm8gbmVlZCB0byBwaWxldXAgYWdhaW4gb24gYWxyZWFkeS1waWxlZC11cCBudWNsZW90aWRlIHBvc2l0aW9uc1xuICAgICAgaWYgKCFwaWxldXBbaV0pIHsgcG9zaXRpb25zVG9DYWxjdWxhdGVbaV0gPSB0cnVlOyBudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSsrOyB9XG4gICAgfVxuICAgIGlmIChudW1Qb3NpdGlvbnNUb0NhbGN1bGF0ZSA9PT0gMCkgeyByZXR1cm47IH0gLy8gQWxsIHBvc2l0aW9ucyBhbHJlYWR5IHBpbGVkIHVwIVxuICAgIFxuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmIChpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTsgfVxuICAgICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tzKSB7XG4gICAgICAgIF8uZWFjaChibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgICAgdmFyIG50LCBpO1xuICAgICAgICAgIGZvciAoaSA9IE1hdGgubWF4KGJsb2NrLnN0YXJ0LCBzdGFydCk7IGkgPCBNYXRoLm1pbihibG9jay5lbmQsIGVuZCk7IGkrKykge1xuICAgICAgICAgICAgaWYgKCFwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSkgeyBjb250aW51ZTsgfVxuICAgICAgICAgICAgbnQgPSAoYmxvY2suc2VxW2kgLSBibG9jay5zdGFydF0gfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgICAgICBwaWxldXBbaV0gPSBwaWxldXBbaV0gfHwge0E6IDAsIEM6IDAsIEc6IDAsIFQ6IDAsIE46IDAsIGNvdjogMH07XG4gICAgICAgICAgICBpZiAoL1tBQ1RHTl0vLnRlc3QobnQpKSB7IHBpbGV1cFtpXVtudF0gKz0gMTsgfVxuICAgICAgICAgICAgcGlsZXVwW2ldLmNvdiArPSAxO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGNvdmVyYWdlOiBmdW5jdGlvbihzdGFydCwgd2lkdGgsIGJwcHApIHtcbiAgICAvLyBDb21wYXJlIHdpdGggYmlubmluZyBvbiB0aGUgZmx5IGluIC50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlciguLi4pXG4gICAgdmFyIGogPSBzdGFydCxcbiAgICAgIHZTY2FsZSA9IHRoaXMuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwICogdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggKiAyLFxuICAgICAgY3VyciA9IHRoaXMuZGF0YS5waWxldXBbal0sXG4gICAgICBiYXJzID0gW10sXG4gICAgICBuZXh0LCBiaW4sIGk7XG4gICAgZm9yIChpID0gMDsgaSA8IHdpZHRoOyBpKyspIHtcbiAgICAgIGJpbiA9IGN1cnIgJiYgKGogKyAxID49IGkgKiBicHBwICsgc3RhcnQpID8gW2N1cnIuY292XSA6IFtdO1xuICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgd2hpbGUgKGogKyAxIDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBqICsgMiA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICBpZiAobmV4dCkgeyBiaW4ucHVzaChuZXh0LmNvdik7IH1cbiAgICAgICAgKytqO1xuICAgICAgICBjdXJyID0gbmV4dDtcbiAgICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgfVxuICAgICAgYmFycy5wdXNoKHV0aWxzLndpZ0JpbkZ1bmN0aW9ucy5tYXhpbXVtKGJpbikgLyB2U2NhbGUpO1xuICAgIH1cbiAgICByZXR1cm4gYmFycztcbiAgfSxcbiAgXG4gIGFsbGVsZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgdlNjYWxlID0gdGhpcy5kYXRhLmluZm8ubWVhbkl0ZW1zUGVyQnAgKiB0aGlzLmRhdGEuaW5mby5tZWFuSXRlbUxlbmd0aCAqIDIsXG4gICAgICBhbGxlbGVGcmVxVGhyZXNob2xkID0gdGhpcy5vcHRzLmFsbGVsZUZyZXFUaHJlc2hvbGQsXG4gICAgICBhbGxlbGVTcGxpdHMgPSBbXSxcbiAgICAgIHNwbGl0LCByZWZOdCwgaSwgcGlsZXVwQXRQb3M7XG4gICAgICBcbiAgICBmb3IgKGkgPSAwOyBpIDwgc2VxdWVuY2UubGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlZk50ID0gc2VxdWVuY2VbaV0udG9VcHBlckNhc2UoKTtcbiAgICAgIHBpbGV1cEF0UG9zID0gcGlsZXVwW3N0YXJ0ICsgaV07XG4gICAgICBpZiAocGlsZXVwQXRQb3MgJiYgcGlsZXVwQXRQb3MuY292ICYmIHBpbGV1cEF0UG9zW3JlZk50XSAvIHBpbGV1cEF0UG9zLmNvdiA8ICgxIC0gYWxsZWxlRnJlcVRocmVzaG9sZCkpIHtcbiAgICAgICAgc3BsaXQgPSB7XG4gICAgICAgICAgeDogaSAvIGJwcHAsXG4gICAgICAgICAgc3BsaXRzOiBbXVxuICAgICAgICB9O1xuICAgICAgICBfLmVhY2goWydBJywgJ0MnLCAnRycsICdUJ10sIGZ1bmN0aW9uKG50KSB7XG4gICAgICAgICAgaWYgKHBpbGV1cEF0UG9zW250XSA+IDApIHsgc3BsaXQuc3BsaXRzLnB1c2goe250OiBudCwgaDogcGlsZXVwQXRQb3NbbnRdIC8gdlNjYWxlfSk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGFsbGVsZVNwbGl0cy5wdXNoKHNwbGl0KTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGFsbGVsZVNwbGl0cztcbiAgfSxcbiAgXG4gIG1pc21hdGNoZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCwgaW50ZXJ2YWxzLCB3aWR0aCwgbGluZU51bSkge1xuICAgIHZhciBtaXNtYXRjaGVzID0gW107XG4gICAgc2VxdWVuY2UgPSBzZXF1ZW5jZS50b1VwcGVyQ2FzZSgpO1xuICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICB2YXIgYmxvY2tTZXRzID0gW2ludGVydmFsLmRhdGEuYmxvY2tzXTtcbiAgICAgIGlmIChpbnRlcnZhbC5kYXRhLmRyYXdBc01hdGVzICYmIGludGVydmFsLmRhdGEubWF0ZSkgeyBibG9ja1NldHMucHVzaChpbnRlcnZhbC5kYXRhLm1hdGUuYmxvY2tzKTsgfVxuICAgICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tzKSB7XG4gICAgICAgIF8uZWFjaChibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgICAgdmFyIGxpbmUgPSBsaW5lTnVtKGludGVydmFsLmRhdGEpLFxuICAgICAgICAgICAgbnQsIGksIHg7XG4gICAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgc3RhcnQgKyB3aWR0aCAqIGJwcHApOyBpKyspIHtcbiAgICAgICAgICAgIHggPSAoaSAtIHN0YXJ0KSAvIGJwcHA7XG4gICAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgIGlmIChudCAmJiBudCAhPSBzZXF1ZW5jZVtpIC0gc3RhcnRdICYmIGxpbmUpIHsgbWlzbWF0Y2hlcy5wdXNoKHt4OiB4LCBudDogbnQsIGxpbmU6IGxpbmV9KTsgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gbWlzbWF0Y2hlcztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgc2VxdWVuY2UgPSBwcmVjYWxjLnNlcXVlbmNlLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIHZpZXdBc1BhaXJzID0gc2VsZi5vcHRzLnZpZXdBc1BhaXJzLFxuICAgICAgc3RhcnRLZXkgPSB2aWV3QXNQYWlycyA/ICd0ZW1wbGF0ZVN0YXJ0JyA6ICdzdGFydCcsXG4gICAgICBlbmRLZXkgPSB2aWV3QXNQYWlycyA/ICd0ZW1wbGF0ZUVuZCcgOiAnZW5kJyxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGg7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXRUbykge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5ICsgJ18nICsgKHZpZXdBc1BhaXJzID8gJ3AnIDogJ3UnKTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCBhbiBpbnNhbmUgYW1vdW50IG9mIHJvd3MgXG4gICAgLy8gKD41MDAgYWxpZ25tZW50cyksIGFzIHRoaXMgd2lsbCBvbmx5IGhvbGQgdXAgb3RoZXIgcmVxdWVzdHMuXG4gICAgaWYgKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAmJiAoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGZXRjaCBmcm9tIHRoZSBSZW1vdGVUcmFjayBhbmQgY2FsbCB0aGUgYWJvdmUgd2hlbiB0aGUgZGF0YSBpcyBhdmFpbGFibGUuXG4gICAgICBzZWxmLmRhdGEucmVtb3RlLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgdmlld0FzUGFpcnMsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICB2YXIgZHJhd1NwZWMgPSB7c2VxdWVuY2U6ICEhc2VxdWVuY2UsIHdpZHRoOiB3aWR0aH0sXG4gICAgICAgICAgY2FsY1BpeEludGVydmFsTWF0ZWQgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZmFsc2UsIGZhbHNlLCBzdGFydEtleSwgZW5kS2V5KSxcbiAgICAgICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZmFsc2UpO1xuICAgICAgICBcbiAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG5cbiAgICAgICAgaWYgKCFzZXF1ZW5jZSkge1xuICAgICAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLnBpbGV1cC5jYWxsKHNlbGYsIGludGVydmFscywgc3RhcnQsIGVuZCk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsTWF0ZWQsIGxpbmVOdW0pO1xuICAgICAgICAgIF8uZWFjaChkcmF3U3BlYy5sYXlvdXQsIGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGludGVydmFsKSB7XG4gICAgICAgICAgICAgIGludGVydmFsLmluc2VydGlvblB0cyA9IF8ubWFwKGludGVydmFsLmQuaW5zZXJ0aW9ucywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgaWYgKGludGVydmFsLmQuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZC5tYXRlKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUludHMgPSBfLm1hcChbaW50ZXJ2YWwuZCwgaW50ZXJ2YWwuZC5tYXRlXSwgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlQmxvY2tJbnRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmJsb2NrcywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gXy5tYXAoaW50ZXJ2YWwuZC5tYXRlLmluc2VydGlvblB0cywgY2FsY1BpeEludGVydmFsKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChpbnRlcnZhbC5kLm1hdGVFeHBlY3RlZCkge1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnRzID0gW2NhbGNQaXhJbnRlcnZhbChpbnRlcnZhbCldO1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVCbG9ja0ludHMgPSBbXTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW5zZXJ0aW9uUHRzID0gW107XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGRyYXdTcGVjLmNvdmVyYWdlID0gc2VsZi50eXBlKCdiYW0nKS5jb3ZlcmFnZS5jYWxsKHNlbGYsIHN0YXJ0LCB3aWR0aCwgYnBwcCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2Vjb25kIGRyYXdpbmcgcGFzcywgdG8gZHJhdyB0aGluZ3MgdGhhdCBhcmUgZGVwZW5kZW50IG9uIHNlcXVlbmNlLCBsaWtlIG1pc21hdGNoZXMgKHBvdGVudGlhbCBTTlBzKS5cbiAgICAgICAgICBkcmF3U3BlYy5icHBwID0gYnBwcDsgIFxuICAgICAgICAgIC8vIEZpbmQgYWxsZWxlIHNwbGl0cyB3aXRoaW4gdGhlIGNvdmVyYWdlIGdyYXBoLlxuICAgICAgICAgIGRyYXdTcGVjLmFsbGVsZXMgPSBzZWxmLnR5cGUoJ2JhbScpLmFsbGVsZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHApO1xuICAgICAgICAgIC8vIEZpbmQgbWlzbWF0Y2hlcyB3aXRoaW4gZWFjaCBhbGlnbmVkIGJsb2NrLlxuICAgICAgICAgIGRyYXdTcGVjLm1pc21hdGNoZXMgPSBzZWxmLnR5cGUoJ2JhbScpLm1pc21hdGNoZXMuY2FsbChzZWxmLCBzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIFxuICAvLyBzcGVjaWFsIGZvcm1hdHRlciBmb3IgY29udGVudCBpbiB0b29sdGlwcyBmb3IgZmVhdHVyZXNcbiAgdGlwVGlwRGF0YTogZnVuY3Rpb24oZGF0YSkge1xuICAgIGZ1bmN0aW9uIHllc05vKGJvb2wpIHsgcmV0dXJuIGJvb2wgPyBcInllc1wiIDogXCJub1wiOyB9XG4gICAgdmFyIGNvbnRlbnQgPSB7XG4gICAgICAgIFwicG9zaXRpb25cIjogZGF0YS5kLnJuYW1lICsgJzonICsgZGF0YS5kLnBvcyxcbiAgICAgICAgXCJjaWdhclwiOiBkYXRhLmQuY2lnYXIsXG4gICAgICAgIFwicmVhZCBzdHJhbmRcIjogZGF0YS5kLmZsYWdzLnJlYWRTdHJhbmQgPyAnKC0pJyA6ICcoKyknLFxuICAgICAgICBcIm1hcHBlZFwiOiB5ZXNObyhkYXRhLmQuZmxhZ3MuaXNSZWFkTWFwcGVkKSxcbiAgICAgICAgXCJtYXAgcXVhbGl0eVwiOiBkYXRhLmQubWFwcSxcbiAgICAgICAgXCJzZWNvbmRhcnlcIjogeWVzTm8oZGF0YS5kLmZsYWdzLmlzU2Vjb25kYXJ5QWxpZ25tZW50KSxcbiAgICAgICAgXCJzdXBwbGVtZW50YXJ5XCI6IHllc05vKGRhdGEuZC5mbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpLFxuICAgICAgICBcImR1cGxpY2F0ZVwiOiB5ZXNObyhkYXRhLmQuZmxhZ3MuaXNEdXBsaWNhdGVSZWFkKSxcbiAgICAgICAgXCJmYWlsZWQgUUNcIjogeWVzTm8oZGF0YS5kLmZsYWdzLmlzUmVhZEZhaWxpbmdWZW5kb3JRQylcbiAgICAgIH07XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICAvLyBTZWUgaHR0cHM6Ly93d3cuYnJvYWRpbnN0aXR1dGUub3JnL2lndi9BbGlnbm1lbnREYXRhI2NvdmVyYWdlIGZvciBhbiBpZGVhIG9mIHdoYXQgd2UncmUgaW1pdGF0aW5nXG4gIGRyYXdDb3ZlcmFnZTogZnVuY3Rpb24oY3R4LCBjb3ZlcmFnZSwgaGVpZ2h0KSB7XG4gICAgXy5lYWNoKGNvdmVyYWdlLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGN0eC5maWxsUmVjdCh4LCBNYXRoLm1heChoZWlnaHQgLSAoZCAqIGhlaWdodCksIDApLCAxLCBNYXRoLm1pbihkICogaGVpZ2h0LCBoZWlnaHQpKTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdTdHJhbmRJbmRpY2F0b3I6IGZ1bmN0aW9uKGN0eCwgeCwgYmxvY2tZLCBibG9ja0hlaWdodCwgeFNjYWxlLCBiaWdTdHlsZSkge1xuICAgIHZhciBwcmV2RmlsbFN0eWxlID0gY3R4LmZpbGxTdHlsZTtcbiAgICBpZiAoYmlnU3R5bGUpIHtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZKTtcbiAgICAgIGN0eC5saW5lVG8oeCArICgzICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQvMik7XG4gICAgICBjdHgubGluZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5jbG9zZVBhdGgoKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDE0MCwxNDAsMTQwKSc7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTIgOiAxKSwgYmxvY2tZLCAxLCBibG9ja0hlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTEgOiAwKSwgYmxvY2tZICsgMSwgMSwgYmxvY2tIZWlnaHQgLSAyKTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBwcmV2RmlsbFN0eWxlO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdBbGlnbm1lbnQ6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBkcmF3TWF0ZXMgPSBkYXRhLm1hdGVJbnRzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIGJsb2NrWSA9IGkgKiBsaW5lSGVpZ2h0ICsgbGluZUdhcC8yLFxuICAgICAgYmxvY2tIZWlnaHQgPSBsaW5lSGVpZ2h0IC0gbGluZUdhcCxcbiAgICAgIGRlbGV0aW9uTGluZVdpZHRoID0gMixcbiAgICAgIGluc2VydGlvbkNhcmV0TGluZVdpZHRoID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIGxpbmVIZWlnaHQpIC0gZGVsZXRpb25MaW5lV2lkdGggKiAwLjUsXG4gICAgICBibG9ja1NldHMgPSBbe2Jsb2NrSW50czogZGF0YS5ibG9ja0ludHMsIHN0cmFuZDogZGF0YS5kLnN0cmFuZH1dO1xuICAgIFxuICAgIC8vIEZvciBtYXRlIHBhaXJzLCB0aGUgZnVsbCBwaXhlbCBpbnRlcnZhbCByZXByZXNlbnRzIHRoZSBsaW5lIGxpbmtpbmcgdGhlIG1hdGVzXG4gICAgaWYgKGRyYXdNYXRlcykge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgZGVsZXRpb25MaW5lV2lkdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEcmF3IHRoZSBsaW5lcyB0aGF0IHNob3cgdGhlIGZ1bGwgYWxpZ25tZW50IGZvciBlYWNoIHNlZ21lbnQsIGluY2x1ZGluZyBkZWxldGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gJ3JnYigwLDAsMCknO1xuICAgIF8uZWFjaChkcmF3TWF0ZXMgfHwgW2RhdGEucEludF0sIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgIGlmIChwSW50LncgPD0gMCkgeyByZXR1cm47IH1cbiAgICAgIC8vIE5vdGUgdGhhdCB0aGUgXCItIDFcIiBiZWxvdyBmaXhlcyByb3VuZGluZyBpc3N1ZXMgYnV0IGdhbWJsZXMgb24gdGhlcmUgbmV2ZXIgYmVpbmcgYSBkZWxldGlvbiBhdCB0aGUgcmlnaHQgZWRnZVxuICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBwSW50LncgLSAxLCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgIFxuICAgIC8vIERyYXcgdGhlIFttaXNdbWF0Y2ggKE0vWC89KSBibG9ja3NcbiAgICBpZiAoZHJhd01hdGVzICYmIGRhdGEuZC5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKHtibG9ja0ludHM6IGRhdGEubWF0ZUJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQubWF0ZS5zdHJhbmR9KTsgfVxuICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2NrU2V0KSB7XG4gICAgICB2YXIgc3RyYW5kID0gYmxvY2tTZXQuc3RyYW5kO1xuICAgICAgXy5lYWNoKGJsb2NrU2V0LmJsb2NrSW50cywgZnVuY3Rpb24oYkludCwgYmxvY2tOdW0pIHtcbiAgICAgIFxuICAgICAgICAvLyBTa2lwIGRyYXdpbmcgYmxvY2tzIHRoYXQgYXJlbid0IGluc2lkZSB0aGUgY2FudmFzXG4gICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPCAwIHx8IGJJbnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgXG4gICAgICAgIGlmIChibG9ja051bSA9PSAwICYmIGJsb2NrU2V0LnN0cmFuZCA9PSAnLScgJiYgIWJJbnQub1ByZXYpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54ICsgMiwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LngsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIC0xLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSBpZiAoYmxvY2tOdW0gPT0gYmxvY2tTZXQuYmxvY2tJbnRzLmxlbmd0aCAtIDEgJiYgYmxvY2tTZXQuc3RyYW5kID09ICcrJyAmJiAhYkludC5vTmV4dCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54ICsgYkludC53LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAxLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRHJhdyBpbnNlcnRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKDExNCw0MSwyMTgpXCI7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyA/IFtkYXRhLmluc2VydGlvblB0cywgZGF0YS5tYXRlSW5zZXJ0aW9uUHRzXSA6IFtkYXRhLmluc2VydGlvblB0c10sIGZ1bmN0aW9uKGluc2VydGlvblB0cykge1xuICAgICAgXy5lYWNoKGluc2VydGlvblB0cywgZnVuY3Rpb24oaW5zZXJ0KSB7XG4gICAgICAgIGlmIChpbnNlcnQueCArIGluc2VydC53IDwgMCB8fCBpbnNlcnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAxLCBpICogbGluZUhlaWdodCwgMiwgbGluZUhlaWdodCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIGkgKiBsaW5lSGVpZ2h0LCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIChpICsgMSkgKiBsaW5lSGVpZ2h0IC0gaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd0FsbGVsZXM6IGZ1bmN0aW9uKGN0eCwgYWxsZWxlcywgaGVpZ2h0LCBiYXJXaWR0aCkge1xuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICB5UG9zO1xuICAgIF8uZWFjaChhbGxlbGVzLCBmdW5jdGlvbihhbGxlbGVzRm9yUG9zaXRpb24pIHtcbiAgICAgIHlQb3MgPSBoZWlnaHQ7XG4gICAgICBfLmVhY2goYWxsZWxlc0ZvclBvc2l0aW9uLnNwbGl0cywgZnVuY3Rpb24oc3BsaXQpIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbc3BsaXQubnRdKycpJztcbiAgICAgICAgY3R4LmZpbGxSZWN0KGFsbGVsZXNGb3JQb3NpdGlvbi54LCB5UG9zIC09IChzcGxpdC5oICogaGVpZ2h0KSwgTWF0aC5tYXgoYmFyV2lkdGgsIDEpLCBzcGxpdC5oICogaGVpZ2h0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd01pc21hdGNoOiBmdW5jdGlvbihjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCBwcGJwKSB7XG4gICAgLy8gcHBicCA9PSBwaXhlbHMgcGVyIGJhc2UgcGFpciAoaW52ZXJzZSBvZiBicHBwKVxuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIHlQb3M7XG4gICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoJytjb2xvcnNbbWlzbWF0Y2gubnRdKycpJztcbiAgICBjdHguZmlsbFJlY3QobWlzbWF0Y2gueCwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0KSAqIGxpbmVIZWlnaHQgKyBsaW5lR2FwIC8gMiwgTWF0aC5tYXgocHBicCwgMSksIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAvLyBEbyB3ZSBoYXZlIHJvb20gdG8gcHJpbnQgYSB3aG9sZSBsZXR0ZXI/XG4gICAgaWYgKHBwYnAgPiA3ICYmIGxpbmVIZWlnaHQgPiAxMCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICdyZ2IoMjU1LDI1NSwyNTUpJztcbiAgICAgIGN0eC5maWxsVGV4dChtaXNtYXRjaC5udCwgbWlzbWF0Y2gueCArIHBwYnAgKiAwLjUsIChtaXNtYXRjaC5saW5lICsgbGluZU9mZnNldCArIDEpICogbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTQgOiA0LFxuICAgICAgY292SGVpZ2h0ID0gZGVuc2l0eSA9PSAnZGVuc2UnID8gMjQgOiAzOCxcbiAgICAgIGNvdk1hcmdpbiA9IDcsXG4gICAgICBsaW5lT2Zmc2V0ID0gKChjb3ZIZWlnaHQgKyBjb3ZNYXJnaW4pIC8gbGluZUhlaWdodCksIFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgICAgICAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBcbiAgICBpZiAoIWRyYXdTcGVjLnNlcXVlbmNlKSB7XG4gICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICBcbiAgICAgIC8vIElmIG5lY2Vzc2FyeSwgaW5kaWNhdGUgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgIGlmIChkcmF3U3BlYy50b29NYW55IHx8IChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCA+IGRyYXdMaW1pdCkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIE9ubHkgc3RvcmUgYXJlYXMgZm9yIHRoZSBcInBhY2tcIiBkZW5zaXR5LlxuICAgICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgICAgLy8gU2V0IHRoZSBleHBlY3RlZCBoZWlnaHQgZm9yIHRoZSBjYW52YXMgKHRoaXMgYWxzbyBlcmFzZXMgaXQpLlxuICAgICAgY2FudmFzLmhlaWdodCA9IGNvdkhlaWdodCArICgoZGVuc2l0eSA9PSAnZGVuc2UnKSA/IDAgOiBjb3ZNYXJnaW4gKyBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodCk7XG4gICAgICBcbiAgICAgIC8vIEZpcnN0IGRyYXcgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTU5LDE1OSwxNTkpXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdDb3ZlcmFnZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMuY292ZXJhZ2UsIGNvdkhlaWdodCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAvLyBOb3csIGRyYXcgYWxpZ25tZW50cyBiZWxvdyBpdFxuICAgICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJykge1xuICAgICAgICAvLyBCb3JkZXIgYmV0d2VlbiBjb3ZlcmFnZVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTA5LDEwOSwxMDkpXCI7XG4gICAgICAgIGN0eC5maWxsUmVjdCgwLCBjb3ZIZWlnaHQgKyAxLCBkcmF3U3BlYy53aWR0aCwgMSk7IFxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgaSArPSBsaW5lT2Zmc2V0OyAvLyBoYWNraXNoIG1ldGhvZCBmb3IgbGVhdmluZyBzcGFjZSBhdCB0aGUgdG9wIGZvciB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3QWxpZ25tZW50LmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCk7ICAgICAgICAgICAgICBcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZWNvbmQgZHJhd2luZyBwYXNzLCB0byBkcmF3IHRoaW5ncyB0aGF0IGFyZSBkZXBlbmRlbnQgb24gc2VxdWVuY2U6XG4gICAgICAvLyAoMSkgYWxsZWxlIHNwbGl0cyBvdmVyIGNvdmVyYWdlXG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdBbGxlbGVzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy5hbGxlbGVzLCBjb3ZIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIC8vICgyKSBtaXNtYXRjaGVzIG92ZXIgdGhlIGFsaWdubWVudHNcbiAgICAgIGN0eC5mb250ID0gXCIxMnB4ICdNZW5sbycsJ0JpdHN0cmVhbSBWZXJhIFNhbnMgTW9ubycsJ0NvbnNvbGFzJywnTHVjaWRhIENvbnNvbGUnLG1vbm9zcGFjZVwiO1xuICAgICAgY3R4LnRleHRBbGlnbiA9ICdjZW50ZXInO1xuICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdiYXNlbGluZSc7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubWlzbWF0Y2hlcywgZnVuY3Rpb24obWlzbWF0Y2gpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3TWlzbWF0Y2guY2FsbChzZWxmLCBjdHgsIG1pc21hdGNoLCBsaW5lT2Zmc2V0LCBsaW5lSGVpZ2h0LCAxIC8gZHJhd1NwZWMuYnBwcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgdmFyIGNhbGxiYWNrS2V5ID0gc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5O1xuICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgXG4gICAgICAvLyBIYXZlIHdlIGJlZW4gd2FpdGluZyB0byBkcmF3IHNlcXVlbmNlIGRhdGEgdG9vPyBJZiBzbywgZG8gdGhhdCBub3csIHRvby5cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0pKSB7XG4gICAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldKCk7XG4gICAgICAgIGRlbGV0ZSBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuICBcbiAgcmVuZGVyU2VxdWVuY2U6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgc2VxdWVuY2UsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIFxuICAgIC8vIElmIHdlIHdlcmVuJ3QgYWJsZSB0byBmZXRjaCBzZXF1ZW5jZSBmb3Igc29tZSByZWFzb24sIHRoZXJlIGlzIG5vIHJlYXNvbiB0byBwcm9jZWVkLlxuICAgIGlmICghc2VxdWVuY2UpIHsgcmV0dXJuIGZhbHNlOyB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCkge1xuICAgICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGgsIHNlcXVlbmNlOiBzZXF1ZW5jZX0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENoZWNrIGlmIHRoZSBjYW52YXMgd2FzIGFscmVhZHkgcmVuZGVyZWQgKGJ5IGxhY2sgb2YgdGhlIGNsYXNzICd1bnJlbmRlcmVkJykuXG4gICAgLy8gSWYgeWVzLCBnbyBhaGVhZCBhbmQgZXhlY3V0ZSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7IGlmIG5vdCwgc2F2ZSBpdCBmb3IgbGF0ZXIuXG4gICAgaWYgKCgnICcgKyBjYW52YXMuY2xhc3NOYW1lICsgJyAnKS5pbmRleE9mKCcgdW5yZW5kZXJlZCAnKSA+IC0xKSB7XG4gICAgICBzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW3N0YXJ0ICsgJy0nICsgZW5kICsgJy0nICsgZGVuc2l0eV0gPSByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrO1xuICAgIH0gZWxzZSB7XG4gICAgICByZW5kZXJTZXF1ZW5jZUNhbGxiYWNrKCk7XG4gICAgfVxuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdBc1BhaXJzXScpLmF0dHIoJ2NoZWNrZWQnLCAhIW8udmlld0FzUGFpcnMpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cztcbiAgICBvLnZpZXdBc1BhaXJzID0gJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3QXNQYWlyc10nKS5pcygnOmNoZWNrZWQnKTtcbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmFtRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IEJFRCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvRkFRL0ZBUWZvcm1hdC5odG1sI2Zvcm1hdDEgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBiZWREZXRhaWwgaXMgYSB0cml2aWFsIGV4dGVuc2lvbiBvZiBCRUQgdGhhdCBpcyBkZWZpbmVkIHNlcGFyYXRlbHksXG4vLyBhbHRob3VnaCBhIEJFRCBmaWxlIHdpdGggPjEyIGNvbHVtbnMgaXMgYXNzdW1lZCB0byBiZSBiZWREZXRhaWwgdHJhY2sgcmVnYXJkbGVzcyBvZiB0eXBlLlxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgTGluZU1hc2sgPSByZXF1aXJlKCcuL3V0aWxzL0xpbmVNYXNrLmpzJykuTGluZU1hc2s7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmJlZFxudmFyIEJlZEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGFsdENvbG9ycyA9IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kLnNwbGl0KC9cXHMrLyksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSBhbHRDb2xvcnMubGVuZ3RoID4gMSAmJiBfLmFsbChhbHRDb2xvcnMsIHNlbGYudmFsaWRhdGVDb2xvcik7XG4gICAgc2VsZi5vcHRzLnVzZVNjb3JlID0gc2VsZi5pc09uKHNlbGYub3B0cy51c2VTY29yZSk7XG4gICAgc2VsZi5vcHRzLml0ZW1SZ2IgPSBzZWxmLmlzT24oc2VsZi5vcHRzLml0ZW1SZ2IpO1xuICAgIGlmICghdmFsaWRDb2xvckJ5U3RyYW5kKSB7IHNlbGYub3B0cy5jb2xvckJ5U3RyYW5kID0gJyc7IHNlbGYub3B0cy5hbHRDb2xvciA9IG51bGw7IH1cbiAgICBlbHNlIHsgc2VsZi5vcHRzLmFsdENvbG9yID0gYWx0Q29sb3JzWzFdOyB9XG4gIH0sXG5cbiAgcGFyc2VMaW5lOiBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICduYW1lJywgJ3Njb3JlJywgJ3N0cmFuZCcsICd0aGlja1N0YXJ0JywgJ3RoaWNrRW5kJywgJ2l0ZW1SZ2InLFxuICAgICAgJ2Jsb2NrQ291bnQnLCAnYmxvY2tTaXplcycsICdibG9ja1N0YXJ0cycsICdpZCcsICdkZXNjcmlwdGlvbiddLFxuICAgICAgZmVhdHVyZSA9IHt9LFxuICAgICAgZmllbGRzID0gL1xcdC8udGVzdChsaW5lKSA/IGxpbmUuc3BsaXQoXCJcXHRcIikgOiBsaW5lLnNwbGl0KC9cXHMrLyksXG4gICAgICBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgaWYgKHRoaXMub3B0cy5kZXRhaWwpIHtcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDJdID0gJ2lkJztcbiAgICAgIGNvbHNbZmllbGRzLmxlbmd0aCAtIDFdID0gJ2Rlc2NyaXB0aW9uJztcbiAgICB9XG4gICAgXy5lYWNoKGZpZWxkcywgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbZmVhdHVyZS5jaHJvbV07XG4gICAgbGluZW5vID0gbGluZW5vIHx8IDA7XG4gICAgXG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkgeyBcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgY2hyb21vc29tZSAnXCIrZmVhdHVyZS5jaHJvbStcIicgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tU3RhcnQpICsgMTtcbiAgICAgIGZlYXR1cmUuZW5kID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLmNocm9tRW5kKSArIDE7XG4gICAgICBmZWF0dXJlLmJsb2NrcyA9IG51bGw7XG4gICAgICAvLyBmYW5jaWVyIEJFRCBmZWF0dXJlcyB0byBleHByZXNzIGNvZGluZyByZWdpb25zIGFuZCBleG9ucy9pbnRyb25zXG4gICAgICBpZiAoL15cXGQrJC8udGVzdChmZWF0dXJlLnRoaWNrU3RhcnQpICYmIC9eXFxkKyQvLnRlc3QoZmVhdHVyZS50aGlja0VuZCkpIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnRoaWNrU3RhcnQpICsgMTtcbiAgICAgICAgZmVhdHVyZS50aGlja0VuZCA9IGNoclBvcyArIHBhcnNlSW50MTAoZmVhdHVyZS50aGlja0VuZCkgKyAxO1xuICAgICAgICBpZiAoL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTaXplcykgJiYgL15cXGQrKCxcXGQqKSokLy50ZXN0KGZlYXR1cmUuYmxvY2tTdGFydHMpKSB7XG4gICAgICAgICAgZmVhdHVyZS5ibG9ja3MgPSBbXTtcbiAgICAgICAgICBibG9ja1NpemVzID0gZmVhdHVyZS5ibG9ja1NpemVzLnNwbGl0KC8sLyk7XG4gICAgICAgICAgXy5lYWNoKGZlYXR1cmUuYmxvY2tTdGFydHMuc3BsaXQoLywvKSwgZnVuY3Rpb24oc3RhcnQsIGkpIHtcbiAgICAgICAgICAgIGlmIChzdGFydCA9PT0gJycpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgYmxvY2sgPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyBwYXJzZUludDEwKHN0YXJ0KX07XG4gICAgICAgICAgICBibG9jay5lbmQgPSBibG9jay5zdGFydCArIHBhcnNlSW50MTAoYmxvY2tTaXplc1tpXSk7XG4gICAgICAgICAgICBmZWF0dXJlLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmZWF0dXJlO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSk7XG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSwgbGluZW5vKTtcbiAgICAgIGlmIChmZWF0dXJlKSB7IGRhdGEuYWRkKGZlYXR1cmUpOyB9XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgc3RhY2tlZExheW91dDogZnVuY3Rpb24oaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKSB7XG4gICAgLy8gQSBsaW5lTnVtIGZ1bmN0aW9uIGNhbiBiZSBwcm92aWRlZCB3aGljaCBjYW4gc2V0L3JldHJpZXZlIHRoZSBsaW5lIG9mIGFscmVhZHkgcmVuZGVyZWQgZGF0YXBvaW50c1xuICAgIC8vIHNvIGFzIHRvIG5vdCBicmVhayBhIHJhbmdlZCBmZWF0dXJlIHRoYXQgZXh0ZW5kcyBvdmVyIG11bHRpcGxlIHRpbGVzLlxuICAgIGxpbmVOdW0gPSBfLmlzRnVuY3Rpb24obGluZU51bSkgPyBsaW5lTnVtIDogZnVuY3Rpb24oKSB7IHJldHVybjsgfTtcbiAgICB2YXIgbGluZXMgPSBbXSxcbiAgICAgIG1heEV4aXN0aW5nTGluZSA9IF8ubWF4KF8ubWFwKGludGVydmFscywgZnVuY3Rpb24odikgeyByZXR1cm4gbGluZU51bSh2LmRhdGEpIHx8IDA7IH0pKSArIDEsXG4gICAgICBzb3J0ZWRJbnRlcnZhbHMgPSBfLnNvcnRCeShpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHsgdmFyIGxuID0gbGluZU51bSh2LmRhdGEpOyByZXR1cm4gXy5pc1VuZGVmaW5lZChsbikgPyAxIDogLWxuOyB9KTtcbiAgICBcbiAgICB3aGlsZSAobWF4RXhpc3RpbmdMaW5lLS0+MCkgeyBsaW5lcy5wdXNoKG5ldyBMaW5lTWFzayh3aWR0aCwgNSkpOyB9XG4gICAgXy5lYWNoKHNvcnRlZEludGVydmFscywgZnVuY3Rpb24odikge1xuICAgICAgdmFyIGQgPSB2LmRhdGEsXG4gICAgICAgIGxuID0gbGluZU51bShkKSxcbiAgICAgICAgcEludCA9IGNhbGNQaXhJbnRlcnZhbChkKSxcbiAgICAgICAgdGhpY2tJbnQgPSBkLnRoaWNrU3RhcnQgIT09IG51bGwgJiYgY2FsY1BpeEludGVydmFsKHtzdGFydDogZC50aGlja1N0YXJ0LCBlbmQ6IGQudGhpY2tFbmR9KSxcbiAgICAgICAgYmxvY2tJbnRzID0gZC5ibG9ja3MgIT09IG51bGwgJiYgIF8ubWFwKGQuYmxvY2tzLCBjYWxjUGl4SW50ZXJ2YWwpLFxuICAgICAgICBpID0gMCxcbiAgICAgICAgbCA9IGxpbmVzLmxlbmd0aDtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChsbikpIHtcbiAgICAgICAgaWYgKGxpbmVzW2xuXS5jb25mbGljdChwSW50LnR4LCBwSW50LnR3KSkgeyAvKnRocm93IFwiVW5yZXNvbHZhYmxlIExpbmVNYXNrIGNvbmZsaWN0IVwiOyovIH1cbiAgICAgICAgbGluZXNbbG5dLmFkZChwSW50LnR4LCBwSW50LnR3LCB7cEludDogcEludCwgdGhpY2tJbnQ6IHRoaWNrSW50LCBibG9ja0ludHM6IGJsb2NrSW50cywgZDogZH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hpbGUgKGkgPCBsICYmIGxpbmVzW2ldLmNvbmZsaWN0KHBJbnQudHgsIHBJbnQudHcpKSB7ICsraTsgfVxuICAgICAgICBpZiAoaSA9PSBsKSB7IGxpbmVzLnB1c2gobmV3IExpbmVNYXNrKHdpZHRoLCA1KSk7IH1cbiAgICAgICAgbGluZU51bShkLCBpKTtcbiAgICAgICAgbGluZXNbaV0uYWRkKHBJbnQudHgsIHBJbnQudHcsIHtwSW50OiBwSW50LCB0aGlja0ludDogdGhpY2tJbnQsIGJsb2NrSW50czogYmxvY2tJbnRzLCBkOiBkfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IHJldHVybiBfLnBsdWNrKGwuaXRlbXMsICdkYXRhJyk7IH0pO1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgaW50ZXJ2YWxzID0gdGhpcy5kYXRhLnNlYXJjaChzdGFydCwgZW5kKSxcbiAgICAgIGRyYXdTcGVjID0gW10sXG4gICAgICBjYWxjUGl4SW50ZXJ2YWwgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgZGVuc2l0eT09J3BhY2snKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldCkge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5O1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHNldCkpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIF8uZWFjaChpbnRlcnZhbHMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgdmFyIHBJbnQgPSBjYWxjUGl4SW50ZXJ2YWwodi5kYXRhKTtcbiAgICAgICAgcEludC52ID0gdi5kYXRhLnNjb3JlO1xuICAgICAgICBkcmF3U3BlYy5wdXNoKHBJbnQpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRyYXdTcGVjID0ge2xheW91dDogdGhpcy50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwodGhpcywgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKX07XG4gICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSA/IGNhbGxiYWNrKGRyYXdTcGVjKSA6IGRyYXdTcGVjO1xuICB9LFxuICBcbiAgYWRkQXJlYTogZnVuY3Rpb24oYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKSB7XG4gICAgdmFyIHRpcFRpcERhdGEgPSB7fSxcbiAgICAgIHRpcFRpcERhdGFDYWxsYmFjayA9IHRoaXMudHlwZSgpLnRpcFRpcERhdGE7XG4gICAgaWYgKCFhcmVhcykgeyByZXR1cm47IH1cbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHRpcFRpcERhdGFDYWxsYmFjaykpIHtcbiAgICAgIHRpcFRpcERhdGEgPSB0aXBUaXBEYXRhQ2FsbGJhY2soZGF0YSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuZGVzY3JpcHRpb24pKSB7IHRpcFRpcERhdGEuZGVzY3JpcHRpb24gPSBkYXRhLmQuZGVzY3JpcHRpb247IH1cbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkYXRhLmQuc2NvcmUpKSB7IHRpcFRpcERhdGEuc2NvcmUgPSBkYXRhLmQuc2NvcmU7IH1cbiAgICAgIF8uZXh0ZW5kKHRpcFRpcERhdGEsIHtcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH0pO1xuICAgICAgLy8gRGlzcGxheSB0aGUgSUQgY29sdW1uIChmcm9tIGJlZERldGFpbCksIHVubGVzcyBpdCBjb250YWlucyBhIHRhYiBjaGFyYWN0ZXIsIHdoaWNoIG1lYW5zIGl0IHdhcyBhdXRvZ2VuZXJhdGVkXG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSAmJiAhKC9cXHQvKS50ZXN0KGRhdGEuZC5pZCkpIHsgdGlwVGlwRGF0YS5pZCA9IGRhdGEuZC5pZDsgfVxuICAgIH1cbiAgICBhcmVhcy5wdXNoKFtcbiAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvLyB4MSwgeDIsIHkxLCB5MlxuICAgICAgZGF0YS5kLm5hbWUgfHwgZGF0YS5kLmlkIHx8ICcnLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5hbWVcbiAgICAgIHVybFRlbXBsYXRlLnJlcGxhY2UoJyQkJywgXy5pc1VuZGVmaW5lZChkYXRhLmQuaWQpID8gZGF0YS5kLm5hbWUgOiBkYXRhLmQuaWQpLCAgICAvLyBocmVmXG4gICAgICBkYXRhLnBJbnQub1ByZXYsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY29udGludWF0aW9uIGZyb20gcHJldmlvdXMgdGlsZT9cbiAgICAgIG51bGwsXG4gICAgICBudWxsLFxuICAgICAgdGlwVGlwRGF0YVxuICAgIF0pO1xuICB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhbiBhbHBoYSB2YWx1ZSBiZXR3ZWVuIDAuMiBhbmQgMS4wXG4gIGNhbGNBbHBoYTogZnVuY3Rpb24odmFsdWUpIHsgcmV0dXJuIE1hdGgubWF4KHZhbHVlLCAxNjYpLzEwMDA7IH0sXG4gIFxuICAvLyBTY2FsZXMgYSBzY29yZSBmcm9tIDAtMTAwMCBpbnRvIGEgY29sb3Igc2NhbGVkIGJldHdlZW4gI2NjY2NjYyBhbmQgbWF4IENvbG9yXG4gIGNhbGNHcmFkaWVudDogZnVuY3Rpb24obWF4Q29sb3IsIHZhbHVlKSB7XG4gICAgdmFyIG1pbkNvbG9yID0gWzIzMCwyMzAsMjMwXSxcbiAgICAgIHZhbHVlQ29sb3IgPSBbXTtcbiAgICBpZiAoIV8uaXNBcnJheShtYXhDb2xvcikpIHsgbWF4Q29sb3IgPSBfLm1hcChtYXhDb2xvci5zcGxpdCgnLCcpLCBwYXJzZUludDEwKTsgfVxuICAgIF8uZWFjaChtaW5Db2xvciwgZnVuY3Rpb24odiwgaSkgeyB2YWx1ZUNvbG9yW2ldID0gKHYgLSBtYXhDb2xvcltpXSkgKiAoKDEwMDAgLSB2YWx1ZSkgLyAxMDAwLjApICsgbWF4Q29sb3JbaV07IH0pO1xuICAgIHJldHVybiBfLm1hcCh2YWx1ZUNvbG9yLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gIH0sXG4gIFxuICBkcmF3QXJyb3dzOiBmdW5jdGlvbihjdHgsIGNhbnZhc1dpZHRoLCBsaW5lWSwgaGFsZkhlaWdodCwgc3RhcnRYLCBlbmRYLCBkaXJlY3Rpb24pIHtcbiAgICB2YXIgYXJyb3dIZWlnaHQgPSBNYXRoLm1pbihoYWxmSGVpZ2h0LCAzKSxcbiAgICAgIFgxLCBYMjtcbiAgICBzdGFydFggPSBNYXRoLm1heChzdGFydFgsIDApO1xuICAgIGVuZFggPSBNYXRoLm1pbihlbmRYLCBjYW52YXNXaWR0aCk7XG4gICAgaWYgKGVuZFggLSBzdGFydFggPCA1KSB7IHJldHVybjsgfSAvLyBjYW4ndCBkcmF3IGFycm93cyBpbiB0aGF0IG5hcnJvdyBvZiBhIHNwYWNlXG4gICAgaWYgKGRpcmVjdGlvbiAhPT0gJysnICYmIGRpcmVjdGlvbiAhPT0gJy0nKSB7IHJldHVybjsgfSAvLyBpbnZhbGlkIGRpcmVjdGlvblxuICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAvLyBBbGwgdGhlIDAuNSdzIGhlcmUgYXJlIGR1ZSB0byA8Y2FudmFzPidzIHNvbWV3aGF0IHNpbGx5IGNvb3JkaW5hdGUgc3lzdGVtIFxuICAgIC8vIGh0dHA6Ly9kaXZlaW50b2h0bWw1LmluZm8vY2FudmFzLmh0bWwjcGl4ZWwtbWFkbmVzc1xuICAgIFgxID0gZGlyZWN0aW9uID09ICcrJyA/IDAuNSA6IGFycm93SGVpZ2h0ICsgMC41O1xuICAgIFgyID0gZGlyZWN0aW9uID09ICcrJyA/IGFycm93SGVpZ2h0ICsgMC41IDogMC41O1xuICAgIGZvciAodmFyIGkgPSBNYXRoLmZsb29yKHN0YXJ0WCkgKyAyOyBpIDwgZW5kWCAtIGFycm93SGVpZ2h0OyBpICs9IDcpIHtcbiAgICAgIGN0eC5tb3ZlVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgLSBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMiwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgMC41KTtcbiAgICAgIGN0eC5saW5lVG8oaSArIFgxLCBsaW5lWSArIGhhbGZIZWlnaHQgKyBhcnJvd0hlaWdodCArIDAuNSk7XG4gICAgfVxuICAgIGN0eC5zdHJva2UoKTtcbiAgfSxcbiAgXG4gIGRyYXdGZWF0dXJlOiBmdW5jdGlvbihjdHgsIHdpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICB5ID0gaSAqIGxpbmVIZWlnaHQsXG4gICAgICBoYWxmSGVpZ2h0ID0gTWF0aC5yb3VuZCgwLjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIHF1YXJ0ZXJIZWlnaHQgPSBNYXRoLmNlaWwoMC4yNSAqIChsaW5lSGVpZ2h0IC0gMSkpLFxuICAgICAgbGluZUdhcCA9IGxpbmVIZWlnaHQgPiA2ID8gMiA6IDEsXG4gICAgICB0aGlja092ZXJsYXAgPSBudWxsLFxuICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgIFxuICAgIC8vIEZpcnN0LCBkZXRlcm1pbmUgYW5kIHNldCB0aGUgY29sb3Igd2Ugd2lsbCBiZSB1c2luZ1xuICAgIC8vIE5vdGUgdGhhdCB0aGUgZGVmYXVsdCBjb2xvciB3YXMgYWxyZWFkeSBzZXQgaW4gZHJhd1NwZWNcbiAgICBpZiAoc2VsZi5vcHRzLmFsdENvbG9yICYmIGRhdGEuZC5zdHJhbmQgPT0gJy0nKSB7IGNvbG9yID0gc2VsZi5vcHRzLmFsdENvbG9yOyB9XG4gICAgXG4gICAgaWYgKHNlbGYub3B0cy5pdGVtUmdiICYmIGRhdGEuZC5pdGVtUmdiICYmIHRoaXMudmFsaWRhdGVDb2xvcihkYXRhLmQuaXRlbVJnYikpIHsgY29sb3IgPSBkYXRhLmQuaXRlbVJnYjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMudXNlU2NvcmUpIHsgY29sb3IgPSBzZWxmLnR5cGUoJ2JlZCcpLmNhbGNHcmFkaWVudChjb2xvciwgZGF0YS5kLnNjb3JlKTsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiB8fCBzZWxmLm9wdHMuYWx0Q29sb3IgfHwgc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7IH1cbiAgICBcbiAgICBpZiAoZGF0YS50aGlja0ludCkge1xuICAgICAgLy8gVGhlIGNvZGluZyByZWdpb24gaXMgZHJhd24gYXMgYSB0aGlja2VyIGxpbmUgd2l0aGluIHRoZSBnZW5lXG4gICAgICBpZiAoZGF0YS5ibG9ja0ludHMpIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGV4b25zIGFuZCBpbnRyb25zLCBkcmF3IHRoZSBpbnRyb25zIHdpdGggYSAxcHggbGluZVxuICAgICAgICBwcmV2QkludCA9IG51bGw7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQsIGRhdGEucEludC53LCAxKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gICAgICAgIF8uZWFjaChkYXRhLmJsb2NrSW50cywgZnVuY3Rpb24oYkludCkge1xuICAgICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPD0gd2lkdGggJiYgYkludC54ID49IDApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGJJbnQudywgcXVhcnRlckhlaWdodCAqIDIgLSAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpY2tPdmVybGFwID0gdXRpbHMucGl4SW50ZXJ2YWxPdmVybGFwKGJJbnQsIGRhdGEudGhpY2tJbnQpO1xuICAgICAgICAgIGlmICh0aGlja092ZXJsYXApIHtcbiAgICAgICAgICAgIGN0eC5maWxsUmVjdCh0aGlja092ZXJsYXAueCwgeSArIDEsIHRoaWNrT3ZlcmxhcC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBpbnRyb25zLCBhcnJvd3MgYXJlIGRyYXduIG9uIHRoZSBpbnRyb25zLCBub3QgdGhlIGV4b25zLi4uXG4gICAgICAgICAgaWYgKGRhdGEuZC5zdHJhbmQgJiYgcHJldkJJbnQpIHtcbiAgICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBwcmV2QkludC54ICsgcHJldkJJbnQudywgYkludC54LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJldkJJbnQgPSBiSW50O1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gLi4udW5sZXNzIHRoZXJlIHdlcmUgbm8gaW50cm9ucy4gVGhlbiBpdCBpcyBkcmF3biBvbiB0aGUgY29kaW5nIHJlZ2lvbi5cbiAgICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0Fycm93cyhjdHgsIHdpZHRoLCB5LCBoYWxmSGVpZ2h0LCBkYXRhLnRoaWNrSW50LngsIGRhdGEudGhpY2tJbnQueCArIGRhdGEudGhpY2tJbnQudywgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFdlIGhhdmUgYSBjb2RpbmcgcmVnaW9uIGJ1dCBubyBpbnRyb25zL2V4b25zXG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIGhhbGZIZWlnaHQgLSBxdWFydGVySGVpZ2h0ICsgMSwgZGF0YS5wSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnRoaWNrSW50LngsIHkgKyAxLCBkYXRhLnRoaWNrSW50LncsIGxpbmVIZWlnaHQgLSBsaW5lR2FwKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb3RoaW5nIGZhbmN5LiAgSXQncyBhIGJveC5cbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgeSArIDEsIGRhdGEucEludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcIndoaXRlXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS5wSW50LngsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbihjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHNlbGYub3B0cy51cmwgPyBzZWxmLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNSA6IDYsXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICBcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICAvLyBUT0RPOiBJIGRpc2FibGVkIHJlZ2VuZXJhdGluZyBhcmVhcyBoZXJlLCB3aGljaCBhc3N1bWVzIHRoYXQgbGluZU51bSByZW1haW5zIHN0YWJsZSBhY3Jvc3MgcmUtcmVuZGVycy4gU2hvdWxkIGNoZWNrIG9uIHRoaXMuXG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgIFxuICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBcInJnYihcIitjb2xvcitcIilcIjtcbiAgICAgIF8uZWFjaChkcmF3U3BlYywgZnVuY3Rpb24ocEludCkge1xuICAgICAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGN0eC5maWxsU3R5bGUgPSBcInJnYmEoXCIrc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIHBJbnQudikrXCIpXCI7IH1cbiAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGF5b3V0ICYmIGRyYXdTcGVjLmxheW91dC5sZW5ndGggPiBkcmF3TGltaXQpIHx8IGRyYXdTcGVjLnRvb01hbnkpIHsgXG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAwO1xuICAgICAgICAvLyBUaGlzIGFwcGxpZXMgc3R5bGluZyB0aGF0IGluZGljYXRlcyB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgICBjYW52YXMuY2xhc3NOYW1lID0gY2FudmFzLmNsYXNzTmFtZSArICcgdG9vLW1hbnknO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gZHJhd1NwZWMubGF5b3V0Lmxlbmd0aCAqIGxpbmVIZWlnaHQ7XG4gICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3RmVhdHVyZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMud2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpOyAgICAgICAgICAgICAgXG4gICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG5cbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbG9yQnlTdHJhbmRPbiA9IC9cXGQrLFxcZCssXFxkK1xccytcXGQrLFxcZCssXFxkKy8udGVzdChvLmNvbG9yQnlTdHJhbmQpLFxuICAgICAgY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiA/IG8uY29sb3JCeVN0cmFuZC5zcGxpdCgvXFxzKy8pWzFdIDogJzAsMCwwJztcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5hdHRyKCdjaGVja2VkJywgISFjb2xvckJ5U3RyYW5kT24pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JCeVN0cmFuZF0nKS52YWwoY29sb3JCeVN0cmFuZCkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11c2VTY29yZV0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8udXNlU2NvcmUpKTsgICAgXG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT11cmxdJykudmFsKG8udXJsKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRPbl0nKS5pcygnOmNoZWNrZWQnKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKCksXG4gICAgICB2YWxpZENvbG9yQnlTdHJhbmQgPSB0aGlzLnZhbGlkYXRlQ29sb3IoY29sb3JCeVN0cmFuZCk7XG4gICAgby5jb2xvckJ5U3RyYW5kID0gY29sb3JCeVN0cmFuZE9uICYmIHZhbGlkQ29sb3JCeVN0cmFuZCA/IG8uY29sb3IgKyAnICcgKyBjb2xvckJ5U3RyYW5kIDogJyc7XG4gICAgby51c2VTY29yZSA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuaXMoJzpjaGVja2VkJykgPyAxIDogMDtcbiAgICBvLnVybCA9ICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbCgpO1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiZWRHcmFwaCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JlZGdyYXBoLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iZWRncmFwaFxudmFyIEJlZEdyYXBoRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGFsdENvbG9yOiAnJyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0LmNhbGwodGhpcyk7IH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB1dGlscy53aWdCaW5GdW5jdGlvbnMsXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTsgfSxcbiAgXG4gIGFwcGx5T3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBnZW5vbWVTaXplID0gdGhpcy5icm93c2VyT3B0cy5nZW5vbWVTaXplLFxuICAgICAgZGF0YSA9IHthbGw6IFtdfSxcbiAgICAgIG1vZGUsIG1vZGVPcHRzLCBjaHJQb3MsIG07XG4gICAgc2VsZi5yYW5nZSA9IHNlbGYuaXNPbih0aGlzLm9wdHMuYWx3YXlzWmVybykgPyBbMCwgMF0gOiBbSW5maW5pdHksIC1JbmZpbml0eV07XG4gIFxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIgY29scyA9IFsnY2hyb20nLCAnY2hyb21TdGFydCcsICdjaHJvbUVuZCcsICdkYXRhVmFsdWUnXSxcbiAgICAgICAgZGF0dW0gPSB7fSxcbiAgICAgICAgY2hyUG9zLCBzdGFydCwgZW5kLCB2YWw7XG4gICAgICBfLmVhY2gobGluZS5zcGxpdCgvXFxzKy8pLCBmdW5jdGlvbih2LCBpKSB7IGRhdHVtW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tkYXR1bS5jaHJvbV07XG4gICAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgfVxuICAgICAgc3RhcnQgPSBwYXJzZUludDEwKGRhdHVtLmNocm9tU3RhcnQpO1xuICAgICAgZW5kID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbUVuZCk7XG4gICAgICB2YWwgPSBwYXJzZUZsb2F0KGRhdHVtLmRhdGFWYWx1ZSk7XG4gICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgZW5kLCB2YWw6IHZhbH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCZWRHcmFwaEZvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnQmVkIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnQmVkLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrO1xudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy5iaWdiZWRcbnZhciBCaWdCZWRGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgY2hyb21vc29tZXM6ICcnLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAwXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdCZWQgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgfSxcbiAgXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBjYWNoZSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgYWpheFVybCA9IHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgICQuYWpheChhamF4VXJsLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIGRlbnNpdHk6ICdwYWNrJ30sXG4gICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICB2YXIgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPj0gMjsgfSk7XG4gICAgICAgICAgdmFyIGludGVydmFscyA9IF8ubWFwKGxpbmVzLCBmdW5jdGlvbihsKSB7IFxuICAgICAgICAgICAgdmFyIGl0dmwgPSBzZWxmLnR5cGUoJ2JlZCcpLnBhcnNlTGluZS5jYWxsKHNlbGYsIGwpOyBcbiAgICAgICAgICAgIC8vIFVzZSBCaW9QZXJsJ3MgQmlvOjpEQjpCaWdCZWQgc3RyYXRlZ3kgZm9yIGRlZHVwbGljYXRpbmcgcmUtZmV0Y2hlZCBpbnRlcnZhbHM6XG4gICAgICAgICAgICAvLyBcIkJlY2F1c2UgQkVEIGZpbGVzIGRvbid0IGFjdHVhbGx5IHVzZSBJRHMsIHRoZSBJRCBpcyBjb25zdHJ1Y3RlZCBmcm9tIHRoZSBmZWF0dXJlJ3MgbmFtZSAoaWYgYW55KSwgY2hyb21vc29tZSBjb29yZGluYXRlcywgc3RyYW5kIGFuZCBibG9jayBjb3VudC5cIlxuICAgICAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoaXR2bC5pZCkpIHtcbiAgICAgICAgICAgICAgaXR2bC5pZCA9IFtpdHZsLm5hbWUsIGl0dmwuY2hyb20sIGl0dmwuY2hyb21TdGFydCwgaXR2bC5jaHJvbUVuZCwgaXR2bC5zdHJhbmQsIGl0dmwuYmxvY2tDb3VudF0uam9pbihcIlxcdFwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpdHZsO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlfTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJpZ0JlZCBhbmQgc2V0dXAgdGhlIGJpbm5pbmcgc2NoZW1lIGZvciB0aGUgUmVtb3RlVHJhY2tcbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YTogeyB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsIH0sXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIC8vIFNldCBtYXhGZXRjaFdpbmRvdyB0byBhdm9pZCBvdmVyZmV0Y2hpbmcgZGF0YS5cbiAgICAgICAgaWYgKCFzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgICAgICB2YXIgbWVhbkl0ZW1zUGVyQnAgPSBkYXRhLml0ZW1Db3VudCAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgICAgICAgIG1heEl0ZW1zVG9EcmF3ID0gXy5tYXgoXy52YWx1ZXMoc2VsZi5vcHRzLmRyYXdMaW1pdCkpO1xuICAgICAgICAgIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyA9IG1heEl0ZW1zVG9EcmF3IC8gbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgICAgc2VsZi5vcHRzLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3Ioc2VsZi5vcHRzLm1heEZldGNoV2luZG93IC8gMyk7XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3csIHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0VG8pIHtcbiAgICAgIHZhciBrZXkgPSBicHBwICsgJ18nICsgZGVuc2l0eTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gcGFyc2VEZW5zZURhdGEoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gW10sIFxuICAgICAgICBsaW5lcztcbiAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgeCkgeyBcbiAgICAgICAgaWYgKGxpbmUgIT0gJ24vYScgJiYgbGluZS5sZW5ndGgpIHsgZHJhd1NwZWMucHVzaCh7eDogeCwgdzogMSwgdjogcGFyc2VGbG9hdChsaW5lKSAqIDEwMDB9KTsgfSBcbiAgICAgIH0pO1xuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEb24ndCBldmVuIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGRhdGEgaWYgZGVuc2l0eSBpcyBub3QgJ2RlbnNlJyBhbmQgd2UgY2FuIHJlYXNvbmFibHlcbiAgICAvLyBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggdG9vIG1hbnkgcm93cyAoPjUwMCBmZWF0dXJlcyksIGFzIHRoaXMgd2lsbCBvbmx5IGRlbGF5IG90aGVyIHJlcXVlc3RzLlxuICAgIGlmIChkZW5zaXR5ICE9ICdkZW5zZScgJiYgKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnYmVkLnBocCcsIHtcbiAgICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCB3aWR0aDogd2lkdGgsIGRlbnNpdHk6IGRlbnNpdHl9LFxuICAgICAgICAgIHN1Y2Nlc3M6IHBhcnNlRGVuc2VEYXRhXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5kYXRhLnJlbW90ZS5mZXRjaEFzeW5jKHN0YXJ0LCBlbmQsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICAgIHZhciBjYWxjUGl4SW50ZXJ2YWwsIGRyYXdTcGVjID0ge307XG4gICAgICAgICAgaWYgKGludGVydmFscy50b29NYW55KSB7IHJldHVybiBjYWxsYmFjayhpbnRlcnZhbHMpOyB9XG4gICAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHkgPT0gJ3BhY2snKTtcbiAgICAgICAgICBkcmF3U3BlYy5sYXlvdXQgPSBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pO1xuICAgICAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd1NwZWMuY2FsbChzZWxmLCBjYW52YXMsIGRyYXdTcGVjLCBkZW5zaXR5KTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdCZWRGb3JtYXQ7IiwiXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBiaWdXaWcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iaWdXaWcuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIEJpZ1dpZ0Zvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJzEyOCwxMjgsMTI4JyxcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGF1dG9TY2FsZTogJ29uJyxcbiAgICBhbHdheXNaZXJvOiAnb2ZmJyxcbiAgICBncmlkRGVmYXVsdDogJ29mZicsXG4gICAgbWF4SGVpZ2h0UGl4ZWxzOiAnMTI4OjEyODoxNScsXG4gICAgZ3JhcGhUeXBlOiAnYmFyJyxcbiAgICB2aWV3TGltaXRzOiAnJyxcbiAgICB5TGluZU1hcms6IDAuMCxcbiAgICB5TGluZU9uT2ZmOiAnb2ZmJyxcbiAgICB3aW5kb3dpbmdGdW5jdGlvbjogJ21heGltdW0nLFxuICAgIHNtb290aGluZ1dpbmRvdzogJ29mZidcbiAgfSxcblxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIGJpZ1dpZyB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICAgIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5pbml0T3B0cy5jYWxsKHRoaXMpO1xuICB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogeydtaW5pbXVtJzoxLCAnbWF4aW11bSc6MSwgJ21lYW4nOjEsICdtaW4nOjEsICdtYXgnOjEsICdzdGQnOjEsICdjb3ZlcmFnZSc6MX0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24oc2VsZi5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge2luZm86IDEsIHVybDogdGhpcy5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgYXN5bmM6IGZhbHNlLCAgLy8gVGhpcyBpcyBjb29sIHNpbmNlIHBhcnNpbmcgbm9ybWFsbHkgaGFwcGVucyBpbiBhIFdlYiBXb3JrZXJcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIHJvd3MgPSBkYXRhLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICBfLmVhY2gocm93cywgZnVuY3Rpb24ocikge1xuICAgICAgICAgIHZhciBrZXl2YWwgPSByLnNwbGl0KCc6ICcpO1xuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtaW4nKSB7IHNlbGYucmFuZ2VbMF0gPSBNYXRoLm1pbihwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMF0pOyB9XG4gICAgICAgICAgaWYgKGtleXZhbFswXT09J21heCcpIHsgc2VsZi5yYW5nZVsxXSA9IE1hdGgubWF4KHBhcnNlRmxvYXQoa2V5dmFsWzFdKSwgc2VsZi5yYW5nZVsxXSk7IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseShzZWxmKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgY2hyUmFuZ2UgPSBzZWxmLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICBcbiAgICBmdW5jdGlvbiBzdWNjZXNzKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgICAgbGluZXMgPSBkYXRhLnNwbGl0KC9cXHMrL2cpO1xuICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIGlmIChsaW5lID09ICduL2EnKSB7IGRyYXdTcGVjLmJhcnMucHVzaChudWxsKTsgfVxuICAgICAgICBlbHNlIGlmIChsaW5lLmxlbmd0aCkgeyBkcmF3U3BlYy5iYXJzLnB1c2goKHBhcnNlRmxvYXQobGluZSkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGUpOyB9XG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgICQuYWpheChzZWxmLmFqYXhEaXIoKSArICdiaWd3aWcucGhwJywge1xuICAgICAgZGF0YToge3JhbmdlOiBjaHJSYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCB3aW5GdW5jOiBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb259LFxuICAgICAgc3VjY2Vzczogc3VjY2Vzc1xuICAgIH0pO1xuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5kcmF3QmFycy5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMsIGhlaWdodCwgd2lkdGgpO1xuICAgICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5sb2FkT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5zYXZlT3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpZ1dpZ0Zvcm1hdDsiLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGZlYXR1cmVUYWJsZSBmb3JtYXQ6IGh0dHA6Ly93d3cuaW5zZGMub3JnL2ZpbGVzL2ZlYXR1cmVfdGFibGUuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgc3RyaXAgPSB1dGlscy5zdHJpcCxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuZmVhdHVyZXRhYmxlXG52YXIgRmVhdHVyZVRhYmxlRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNvbGxhcHNlQnlHZW5lOiAnb2ZmJyxcbiAgICBrZXlDb2x1bW5XaWR0aDogMjEsXG4gICAgaXRlbVJnYjogJ29mZicsXG4gICAgY29sb3JCeVN0cmFuZDogJycsXG4gICAgdXNlU2NvcmU6IDAsXG4gICAgZ3JvdXA6ICd1c2VyJyxcbiAgICBwcmlvcml0eTogJ3VzZXInLFxuICAgIG9mZnNldDogMCxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogbnVsbCwgcGFjazogbnVsbH1cbiAgfSxcbiAgXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgnYmVkJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgICB0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUgPSB0aGlzLmlzT24odGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKTtcbiAgICB0aGlzLmZlYXR1cmVUeXBlQ291bnRzID0ge307XG4gIH0sXG4gIFxuICAvLyBwYXJzZXMgb25lIGZlYXR1cmUga2V5ICsgbG9jYXRpb24vcXVhbGlmaWVycyByb3cgZnJvbSB0aGUgZmVhdHVyZSB0YWJsZVxuICBwYXJzZUVudHJ5OiBmdW5jdGlvbihjaHJvbSwgbGluZXMsIHN0YXJ0TGluZU5vKSB7XG4gICAgdmFyIGZlYXR1cmUgPSB7XG4gICAgICAgIGNocm9tOiBjaHJvbSxcbiAgICAgICAgc2NvcmU6ICc/JyxcbiAgICAgICAgYmxvY2tzOiBudWxsLFxuICAgICAgICBxdWFsaWZpZXJzOiB7fVxuICAgICAgfSxcbiAgICAgIGtleUNvbHVtbldpZHRoID0gdGhpcy5vcHRzLmtleUNvbHVtbldpZHRoLFxuICAgICAgcXVhbGlmaWVyID0gbnVsbCxcbiAgICAgIGZ1bGxMb2NhdGlvbiA9IFtdLFxuICAgICAgY29sbGFwc2VLZXlRdWFsaWZpZXJzID0gWydsb2N1c190YWcnLCAnZ2VuZScsICdkYl94cmVmJ10sXG4gICAgICBxdWFsaWZpZXJzVGhhdEFyZU5hbWVzID0gWydnZW5lJywgJ2xvY3VzX3RhZycsICdkYl94cmVmJ10sXG4gICAgICBSTkFUeXBlcyA9IFsncnJuYScsICd0cm5hJ10sXG4gICAgICBhbHNvVHJ5Rm9yUk5BVHlwZXMgPSBbJ3Byb2R1Y3QnXSxcbiAgICAgIGxvY2F0aW9uUG9zaXRpb25zLCBjaHJQb3MsIGJsb2NrU2l6ZXM7XG4gICAgXG4gICAgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyb21dO1xuICAgIHN0YXJ0TGluZU5vID0gc3RhcnRMaW5lTm8gfHwgMDtcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICB0aGlzLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgdGhpcy5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaWxsIG91dCBmZWF0dXJlJ3Mga2V5cyB3aXRoIGluZm8gZnJvbSB0aGVzZSBsaW5lc1xuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICB2YXIga2V5ID0gbGluZS5zdWJzdHIoMCwga2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICByZXN0T2ZMaW5lID0gbGluZS5zdWJzdHIoa2V5Q29sdW1uV2lkdGgpLFxuICAgICAgICBxdWFsaWZpZXJNYXRjaCA9IHJlc3RPZkxpbmUubWF0Y2goL15cXC8oXFx3KykoPT8pKC4qKS8pO1xuICAgICAgaWYgKGtleS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgZmVhdHVyZS50eXBlID0gc3RyaXAoa2V5KTtcbiAgICAgICAgcXVhbGlmaWVyID0gbnVsbDtcbiAgICAgICAgZnVsbExvY2F0aW9uLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocXVhbGlmaWVyTWF0Y2gpIHtcbiAgICAgICAgICBxdWFsaWZpZXIgPSBxdWFsaWZpZXJNYXRjaFsxXTtcbiAgICAgICAgICBpZiAoIWZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKSB7IGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdID0gW107IH1cbiAgICAgICAgICBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXS5wdXNoKFtxdWFsaWZpZXJNYXRjaFsyXSA/IHF1YWxpZmllck1hdGNoWzNdIDogdHJ1ZV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChxdWFsaWZpZXIgIT09IG51bGwpIHsgXG4gICAgICAgICAgICBfLmxhc3QoZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0pLnB1c2gocmVzdE9mTGluZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uID0gZnVsbExvY2F0aW9uLmpvaW4oJycpO1xuICAgIGxvY2F0aW9uUG9zaXRpb25zID0gXy5tYXAoXy5maWx0ZXIoZnVsbExvY2F0aW9uLnNwbGl0KC9cXEQrLyksIF8uaWRlbnRpdHkpLCBwYXJzZUludDEwKTtcbiAgICBmZWF0dXJlLmNocm9tU3RhcnQgPSAgXy5taW4obG9jYXRpb25Qb3NpdGlvbnMpO1xuICAgIGZlYXR1cmUuY2hyb21FbmQgPSBfLm1heChsb2NhdGlvblBvc2l0aW9ucykgKyAxOyAvLyBGZWF0dXJlIHRhYmxlIHJhbmdlcyBhcmUgKmluY2x1c2l2ZSogb2YgdGhlIGVuZCBiYXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNocm9tRW5kIGNvbHVtbnMgaW4gQkVEIGZvcm1hdCBhcmUgKm5vdCouXG4gICAgZmVhdHVyZS5zdGFydCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21TdGFydDtcbiAgICBmZWF0dXJlLmVuZCA9IGNoclBvcyArIGZlYXR1cmUuY2hyb21FbmQ7IFxuICAgIGZlYXR1cmUuc3RyYW5kID0gL2NvbXBsZW1lbnQvLnRlc3QoZnVsbExvY2F0aW9uKSA/IFwiLVwiIDogXCIrXCI7XG4gICAgXG4gICAgLy8gVW50aWwgd2UgbWVyZ2UgYnkgZ2VuZSBuYW1lLCB3ZSBkb24ndCBjYXJlIGFib3V0IHRoZXNlXG4gICAgZmVhdHVyZS50aGlja1N0YXJ0ID0gZmVhdHVyZS50aGlja0VuZCA9IG51bGw7XG4gICAgZmVhdHVyZS5ibG9ja3MgPSBudWxsO1xuICAgIFxuICAgIC8vIFBhcnNlIHRoZSBxdWFsaWZpZXJzIHByb3Blcmx5XG4gICAgXy5lYWNoKGZlYXR1cmUucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgXy5lYWNoKHYsIGZ1bmN0aW9uKGVudHJ5TGluZXMsIGkpIHtcbiAgICAgICAgdltpXSA9IHN0cmlwKGVudHJ5TGluZXMuam9pbignICcpKTtcbiAgICAgICAgaWYgKC9eXCJbXFxzXFxTXSpcIiQvLnRlc3QodltpXSkpIHtcbiAgICAgICAgICAvLyBEZXF1b3RlIGZyZWUgdGV4dFxuICAgICAgICAgIHZbaV0gPSB2W2ldLnJlcGxhY2UoL15cInxcIiQvZywgJycpLnJlcGxhY2UoL1wiXCIvZywgJ1wiJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy9pZiAodi5sZW5ndGggPT0gMSkgeyBmZWF0dXJlLnF1YWxpZmllcnNba10gPSB2WzBdOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmluZCBzb21ldGhpbmcgdGhhdCBjYW4gc2VydmUgYXMgYSBuYW1lXG4gICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS50eXBlO1xuICAgIGlmIChfLmNvbnRhaW5zKFJOQVR5cGVzLCBmZWF0dXJlLnR5cGUudG9Mb3dlckNhc2UoKSkpIHsgXG4gICAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseShxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBhbHNvVHJ5Rm9yUk5BVHlwZXMpOyBcbiAgICB9XG4gICAgXy5maW5kKHF1YWxpZmllcnNUaGF0QXJlTmFtZXMsIGZ1bmN0aW9uKGspIHtcbiAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IHJldHVybiAoZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKTsgfVxuICAgIH0pO1xuICAgIC8vIEluIHRoZSB3b3JzdCBjYXNlLCBhZGQgYSBjb3VudGVyIHRvIGRpc2FtYmlndWF0ZSBmZWF0dXJlcyBuYW1lZCBvbmx5IGJ5IHR5cGVcbiAgICBpZiAoZmVhdHVyZS5uYW1lID09IGZlYXR1cmUudHlwZSkge1xuICAgICAgaWYgKCF0aGlzLmZlYXR1cmVUeXBlQ291bnRzW2ZlYXR1cmUudHlwZV0pIHsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdID0gMTsgfVxuICAgICAgZmVhdHVyZS5uYW1lID0gZmVhdHVyZS5uYW1lICsgJ18nICsgdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKys7XG4gICAgfVxuICAgIFxuICAgIC8vIEZpbmQgYSBrZXkgdGhhdCBpcyBhcHByb3ByaWF0ZSBmb3IgY29sbGFwc2luZ1xuICAgIGlmICh0aGlzLm9wdHMuY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZmluZChjb2xsYXBzZUtleVF1YWxpZmllcnMsIGZ1bmN0aW9uKGspIHtcbiAgICAgICAgaWYgKGZlYXR1cmUucXVhbGlmaWVyc1trXSAmJiBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pIHsgXG4gICAgICAgICAgcmV0dXJuIChmZWF0dXJlLl9jb2xsYXBzZUtleSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIC8vIGNvbGxhcHNlcyBtdWx0aXBsZSBmZWF0dXJlcyB0aGF0IGFyZSBhYm91dCB0aGUgc2FtZSBnZW5lIGludG8gb25lIGRyYXdhYmxlIGZlYXR1cmVcbiAgY29sbGFwc2VGZWF0dXJlczogZnVuY3Rpb24oZmVhdHVyZXMpIHtcbiAgICB2YXIgY2hyUG9zID0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3MsXG4gICAgICBwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8gPSBbJ21ybmEnLCAnZ2VuZScsICdjZHMnXSxcbiAgICAgIHByZWZlcnJlZFR5cGVGb3JFeG9ucyA9IFsnZXhvbicsICdjZHMnXSxcbiAgICAgIG1lcmdlSW50byA9IGZlYXR1cmVzWzBdLFxuICAgICAgYmxvY2tzID0gW10sXG4gICAgICBmb3VuZFR5cGUsIGNkcywgZXhvbnM7XG4gICAgZm91bmRUeXBlID0gXy5maW5kKHByZWZlcnJlZFR5cGVUb01lcmdlSW50bywgZnVuY3Rpb24odHlwZSkge1xuICAgICAgdmFyIGZvdW5kID0gXy5maW5kKGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChmb3VuZCkgeyBtZXJnZUludG8gPSBmb3VuZDsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBcbiAgICAvLyBMb29rIGZvciBleG9ucyAoZXVrYXJ5b3RpYykgb3IgYSBDRFMgKHByb2thcnlvdGljKVxuICAgIF8uZmluZChwcmVmZXJyZWRUeXBlRm9yRXhvbnMsIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIGV4b25zID0gXy5zZWxlY3QoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IHR5cGU7IH0pO1xuICAgICAgaWYgKGV4b25zLmxlbmd0aCkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgIH0pO1xuICAgIGNkcyA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gXCJjZHNcIjsgfSk7XG4gICAgXG4gICAgXy5lYWNoKGV4b25zLCBmdW5jdGlvbihleG9uRmVhdHVyZSkge1xuICAgICAgZXhvbkZlYXR1cmUuZnVsbExvY2F0aW9uLnJlcGxhY2UoLyhcXGQrKVxcLlxcLls+PF0/KFxcZCspL2csIGZ1bmN0aW9uKGZ1bGxNYXRjaCwgc3RhcnQsIGVuZCkge1xuICAgICAgICBibG9ja3MucHVzaCh7XG4gICAgICAgICAgc3RhcnQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyBNYXRoLm1pbihzdGFydCwgZW5kKSwgXG4gICAgICAgICAgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZS5cbiAgICAgICAgICBlbmQ6IGNoclBvc1tleG9uRmVhdHVyZS5jaHJvbV0gKyAgTWF0aC5tYXgoc3RhcnQsIGVuZCkgKyAxXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ29udmVydCBleG9ucyBhbmQgQ0RTIGludG8gYmxvY2tzLCB0aGlja1N0YXJ0IGFuZCB0aGlja0VuZCAoaW4gQkVEIHRlcm1pbm9sb2d5KVxuICAgIGlmIChibG9ja3MubGVuZ3RoKSB7IFxuICAgICAgbWVyZ2VJbnRvLmJsb2NrcyA9IF8uc29ydEJ5KGJsb2NrcywgZnVuY3Rpb24oYikgeyByZXR1cm4gYi5zdGFydDsgfSk7XG4gICAgICBtZXJnZUludG8udGhpY2tTdGFydCA9IGNkcyA/IGNkcy5zdGFydCA6IGZlYXR1cmUuc3RhcnQ7XG4gICAgICBtZXJnZUludG8udGhpY2tFbmQgPSBjZHMgPyBjZHMuZW5kIDogZmVhdHVyZS5lbmQ7XG4gICAgfVxuICAgIFxuICAgIC8vIGZpbmFsbHksIG1lcmdlIGFsbCB0aGUgcXVhbGlmaWVyc1xuICAgIF8uZWFjaChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkge1xuICAgICAgaWYgKGZlYXQgPT09IG1lcmdlSW50bykgeyByZXR1cm47IH1cbiAgICAgIF8uZWFjaChmZWF0LnF1YWxpZmllcnMsIGZ1bmN0aW9uKHZhbHVlcywgaykge1xuICAgICAgICBpZiAoIW1lcmdlSW50by5xdWFsaWZpZXJzW2tdKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdID0gW107IH1cbiAgICAgICAgXy5lYWNoKHZhbHVlcywgZnVuY3Rpb24odikge1xuICAgICAgICAgIGlmICghXy5jb250YWlucyhtZXJnZUludG8ucXVhbGlmaWVyc1trXSwgdikpIHsgbWVyZ2VJbnRvLnF1YWxpZmllcnNba10ucHVzaCh2KTsgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBtZXJnZUludG87XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbyA9IHNlbGYub3B0cyxcbiAgICAgIG1pZGRsZWlzaFBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIDIsXG4gICAgICBkYXRhID0gbmV3IEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSksXG4gICAgICBudW1MaW5lcyA9IGxpbmVzLmxlbmd0aCxcbiAgICAgIGNocm9tID0gbnVsbCxcbiAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbCxcbiAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleSA9IHt9LFxuICAgICAgZmVhdHVyZTtcbiAgICBcbiAgICBmdW5jdGlvbiBjb2xsZWN0TGFzdEVudHJ5KGxpbmVubykge1xuICAgICAgaWYgKGxhc3RFbnRyeVN0YXJ0ICE9PSBudWxsKSB7XG4gICAgICAgIGZlYXR1cmUgPSBzZWxmLnR5cGUoKS5wYXJzZUVudHJ5LmNhbGwoc2VsZiwgY2hyb20sIGxpbmVzLnNsaWNlKGxhc3RFbnRyeVN0YXJ0LCBsaW5lbm8pLCBsYXN0RW50cnlTdGFydCk7XG4gICAgICAgIGlmIChmZWF0dXJlKSB7IFxuICAgICAgICAgIGlmIChvLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldID0gZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSB8fCBbXTtcbiAgICAgICAgICAgIGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0ucHVzaChmZWF0dXJlKTtcbiAgICAgICAgICB9IGVsc2UgeyBkYXRhLmFkZChmZWF0dXJlKTsgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIENodW5rIHRoZSBsaW5lcyBpbnRvIGVudHJpZXMgYW5kIHBhcnNlIGVhY2ggb2YgdGhlbVxuICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICBpZiAobGluZS5zdWJzdHIoMCwgMTIpID09IFwiQUNDRVNTSU9OICAgXCIpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBjaHJvbSA9IGxpbmUuc3Vic3RyKDEyKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmIChjaHJvbSAhPT0gbnVsbCAmJiBsaW5lLnN1YnN0cig1LCAxKS5tYXRjaCgvXFx3LykpIHtcbiAgICAgICAgY29sbGVjdExhc3RFbnRyeShsaW5lbm8pO1xuICAgICAgICBsYXN0RW50cnlTdGFydCA9IGxpbmVubztcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBwYXJzZSB0aGUgbGFzdCBlbnRyeVxuICAgIGlmIChjaHJvbSAhPT0gbnVsbCkgeyBjb2xsZWN0TGFzdEVudHJ5KGxpbmVzLmxlbmd0aCk7IH1cbiAgICBcbiAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgXy5lYWNoKGZlYXR1cmVzQnlDb2xsYXBzZUtleSwgZnVuY3Rpb24oZmVhdHVyZXMsIGdlbmUpIHtcbiAgICAgICAgZGF0YS5hZGQoc2VsZi50eXBlKCkuY29sbGFwc2VGZWF0dXJlcy5jYWxsKHNlbGYsIGZlYXR1cmVzKSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuICBcbiAgLy8gc3BlY2lhbCBmb3JtYXR0ZXIgZm9yIGNvbnRlbnQgaW4gdG9vbHRpcHMgZm9yIGZlYXR1cmVzXG4gIHRpcFRpcERhdGE6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgcXVhbGlmaWVyc1RvQWJicmV2aWF0ZSA9IHt0cmFuc2xhdGlvbjogMX0sXG4gICAgICBjb250ZW50ID0ge1xuICAgICAgICB0eXBlOiBkYXRhLmQudHlwZSxcbiAgICAgICAgcG9zaXRpb246IGRhdGEuZC5jaHJvbSArICc6JyArIGRhdGEuZC5jaHJvbVN0YXJ0LCBcbiAgICAgICAgc2l6ZTogZGF0YS5kLmNocm9tRW5kIC0gZGF0YS5kLmNocm9tU3RhcnRcbiAgICAgIH07XG4gICAgaWYgKGRhdGEuZC5xdWFsaWZpZXJzLm5vdGUgJiYgZGF0YS5kLnF1YWxpZmllcnMubm90ZVswXSkgeyAgfVxuICAgIF8uZWFjaChkYXRhLmQucXVhbGlmaWVycywgZnVuY3Rpb24odiwgaykge1xuICAgICAgaWYgKGsgPT0gJ25vdGUnKSB7IGNvbnRlbnQuZGVzY3JpcHRpb24gPSB2LmpvaW4oJzsgJyk7IHJldHVybjsgfVxuICAgICAgY29udGVudFtrXSA9IHYuam9pbignOyAnKTtcbiAgICAgIGlmIChxdWFsaWZpZXJzVG9BYmJyZXZpYXRlW2tdICYmIGNvbnRlbnRba10ubGVuZ3RoID4gMjUpIHsgY29udGVudFtrXSA9IGNvbnRlbnRba10uc3Vic3RyKDAsIDI1KSArICcuLi4nOyB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0sXG4gIFxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykucHJlcmVuZGVyLmNhbGwodGhpcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCdiZWQnKS5kcmF3U3BlYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCdiZWQnKS5yZW5kZXIuY2FsbCh0aGlzLCBjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBGZWF0dXJlVGFibGVGb3JtYXQ7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBTb3J0ZWRMaXN0ID0gcmVxdWlyZSgnLi9Tb3J0ZWRMaXN0LmpzJykuU29ydGVkTGlzdDsgIFxuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvaW50ZXJ2YWwtdHJlZVxuICogSW50ZXJ2YWxUcmVlXG4gKlxuICogQHBhcmFtIChvYmplY3QpIGRhdGE6XG4gKiBAcGFyYW0gKG51bWJlcikgY2VudGVyOlxuICogQHBhcmFtIChvYmplY3QpIG9wdGlvbnM6XG4gKiAgIGNlbnRlcjpcbiAqXG4gKiovXG5mdW5jdGlvbiBJbnRlcnZhbFRyZWUoY2VudGVyLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgfHwgKG9wdGlvbnMgPSB7fSk7XG5cbiAgdGhpcy5zdGFydEtleSAgICAgPSBvcHRpb25zLnN0YXJ0S2V5IHx8IDA7IC8vIHN0YXJ0IGtleVxuICB0aGlzLmVuZEtleSAgICAgICA9IG9wdGlvbnMuZW5kS2V5ICAgfHwgMTsgLy8gZW5kIGtleVxuICB0aGlzLmludGVydmFsSGFzaCA9IHt9OyAgICAgICAgICAgICAgICAgICAgLy8gaWQgPT4gaW50ZXJ2YWwgb2JqZWN0XG4gIHRoaXMucG9pbnRUcmVlID0gbmV3IFNvcnRlZExpc3QoeyAgICAgICAgICAvLyBiLXRyZWUgb2Ygc3RhcnQsIGVuZCBwb2ludHMgXG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhWzBdLSBiWzBdO1xuICAgICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5fYXV0b0luY3JlbWVudCA9IDA7XG5cbiAgLy8gaW5kZXggb2YgdGhlIHJvb3Qgbm9kZVxuICBpZiAoIWNlbnRlciB8fCB0eXBlb2YgY2VudGVyICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGNlbnRlciBpbmRleCBhcyB0aGUgMm5kIGFyZ3VtZW50LicpO1xuICB9XG5cbiAgdGhpcy5yb290ID0gbmV3IE5vZGUoY2VudGVyLCB0aGlzKTtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIGlmICh0aGlzLmNvbnRhaW5zKGlkKSkge1xuICAgIHRocm93IG5ldyBEdXBsaWNhdGVFcnJvcignaWQgJyArIGlkICsgJyBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuJyk7XG4gIH1cblxuICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgd2hpbGUgKHRoaXMuaW50ZXJ2YWxIYXNoW3RoaXMuX2F1dG9JbmNyZW1lbnRdKSB7XG4gICAgICB0aGlzLl9hdXRvSW5jcmVtZW50Kys7XG4gICAgfVxuICAgIGlkID0gdGhpcy5fYXV0b0luY3JlbWVudDtcbiAgfVxuXG4gIHZhciBpdHZsID0gbmV3IEludGVydmFsKGRhdGEsIGlkLCB0aGlzLnN0YXJ0S2V5LCB0aGlzLmVuZEtleSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5zdGFydCwgaWRdKTtcbiAgdGhpcy5wb2ludFRyZWUuaW5zZXJ0KFtpdHZsLmVuZCwgICBpZF0pO1xuICB0aGlzLmludGVydmFsSGFzaFtpZF0gPSBpdHZsO1xuICB0aGlzLl9hdXRvSW5jcmVtZW50Kys7XG4gIFxuICBfaW5zZXJ0LmNhbGwodGhpcywgdGhpcy5yb290LCBpdHZsKTtcbn07XG5cblxuLyoqXG4gKiBjaGVjayBpZiByYW5nZSBpcyBhbHJlYWR5IHByZXNlbnQsIGJhc2VkIG9uIGl0cyBpZFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5jb250YWlucyA9IGZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiAhIXRoaXMuZ2V0KGlkKTtcbn1cblxuXG4vKipcbiAqIHJldHJpZXZlIGFuIGludGVydmFsIGJ5IGl0cyBpZDsgcmV0dXJucyBudWxsIGlmIGl0IGRvZXMgbm90IGV4aXN0XG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiB0aGlzLmludGVydmFsSGFzaFtpZF0gfHwgbnVsbDtcbn1cblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICB0cnkge1xuICAgIHRoaXMuYWRkKGRhdGEsIGlkKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlIGluc3RhbmNlb2YgRHVwbGljYXRlRXJyb3IpIHsgcmV0dXJuOyB9XG4gICAgdGhyb3cgZTtcbiAgfVxufVxuXG5cbi8qKlxuICogc2VhcmNoXG4gKlxuICogQHBhcmFtIChpbnRlZ2VyKSB2YWw6XG4gKiBAcmV0dXJuIChhcnJheSlcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24odmFsMSwgdmFsMikge1xuICB2YXIgcmV0ID0gW107XG4gIGlmICh0eXBlb2YgdmFsMSAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcih2YWwxICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG5cbiAgaWYgKHZhbDIgPT0gdW5kZWZpbmVkKSB7XG4gICAgX3BvaW50U2VhcmNoLmNhbGwodGhpcywgdGhpcy5yb290LCB2YWwxLCByZXQpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiB2YWwyID09ICdudW1iZXInKSB7XG4gICAgX3JhbmdlU2VhcmNoLmNhbGwodGhpcywgdmFsMSwgdmFsMiwgcmV0KTtcbiAgfVxuICBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICcsJyArIHZhbDIgKyAnOiBpbnZhbGlkIGlucHV0Jyk7XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cblxuLyoqXG4gKiByZW1vdmU6IFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihpbnRlcnZhbF9pZCkge1xuICB0aHJvdyBcIi5yZW1vdmUoKSBpcyBjdXJyZW50bHkgdW5pbXBsZW1lbnRlZFwiO1xufTtcblxuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIHRoZSBzaGlmdC1yaWdodC1hbmQtZmlsbCBvcGVyYXRvciwgZXh0ZW5kZWQgYmV5b25kIHRoZSByYW5nZSBvZiBhbiBpbnQzMlxuZnVuY3Rpb24gX2JpdFNoaWZ0UmlnaHQobnVtKSB7XG4gIGlmIChudW0gPiAyMTQ3NDgzNjQ3IHx8IG51bSA8IC0yMTQ3NDgzNjQ4KSB7IHJldHVybiBNYXRoLmZsb29yKG51bSAvIDIpOyB9XG4gIHJldHVybiBudW0gPj4+IDE7XG59XG5cbi8qKlxuICogX2luc2VydFxuICoqL1xuZnVuY3Rpb24gX2luc2VydChub2RlLCBpdHZsKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKGl0dmwuZW5kIDwgbm9kZS5pZHgpIHtcbiAgICAgIGlmICghbm9kZS5sZWZ0KSB7XG4gICAgICAgIG5vZGUubGVmdCA9IG5ldyBOb2RlKF9iaXRTaGlmdFJpZ2h0KGl0dmwuc3RhcnQgKyBpdHZsLmVuZCksIHRoaXMpO1xuICAgICAgfVxuICAgICAgbm9kZSA9IG5vZGUubGVmdDtcbiAgICB9IGVsc2UgaWYgKG5vZGUuaWR4IDwgaXR2bC5zdGFydCkge1xuICAgICAgaWYgKCFub2RlLnJpZ2h0KSB7XG4gICAgICAgIG5vZGUucmlnaHQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLnJpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbm9kZS5pbnNlcnQoaXR2bCk7XG4gICAgfVxuICB9XG59XG5cblxuLyoqXG4gKiBfcG9pbnRTZWFyY2hcbiAqIEBwYXJhbSAoTm9kZSkgbm9kZVxuICogQHBhcmFtIChpbnRlZ2VyKSBpZHggXG4gKiBAcGFyYW0gKEFycmF5KSBhcnJcbiAqKi9cbmZ1bmN0aW9uIF9wb2ludFNlYXJjaChub2RlLCBpZHgsIGFycikge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmICghbm9kZSkgYnJlYWs7XG4gICAgaWYgKGlkeCA8IG5vZGUuaWR4KSB7XG4gICAgICBub2RlLnN0YXJ0cy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLnN0YXJ0IDw9IGlkeCk7XG4gICAgICAgIGlmIChib29sKSBhcnIucHVzaChpdHZsLnJlc3VsdCgpKTtcbiAgICAgICAgcmV0dXJuIGJvb2w7XG4gICAgICB9KTtcbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChpZHggPiBub2RlLmlkeCkge1xuICAgICAgbm9kZS5lbmRzLmFyci5ldmVyeShmdW5jdGlvbihpdHZsKSB7XG4gICAgICAgIHZhciBib29sID0gKGl0dmwuZW5kID49IGlkeCk7XG4gICAgICAgIGlmIChib29sKSBhcnIucHVzaChpdHZsLnJlc3VsdCgpKTtcbiAgICAgICAgcmV0dXJuIGJvb2w7XG4gICAgICB9KTtcbiAgICAgIG5vZGUgPSBub2RlLnJpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlLnN0YXJ0cy5hcnIubWFwKGZ1bmN0aW9uKGl0dmwpIHsgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSkgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbn1cblxuXG5cbi8qKlxuICogX3JhbmdlU2VhcmNoXG4gKiBAcGFyYW0gKGludGVnZXIpIHN0YXJ0XG4gKiBAcGFyYW0gKGludGVnZXIpIGVuZFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcmFuZ2VTZWFyY2goc3RhcnQsIGVuZCwgYXJyKSB7XG4gIGlmIChlbmQgLSBzdGFydCA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdlbmQgbXVzdCBiZSBncmVhdGVyIHRoYW4gc3RhcnQuIHN0YXJ0OiAnICsgc3RhcnQgKyAnLCBlbmQ6ICcgKyBlbmQpO1xuICB9XG4gIHZhciByZXN1bHRIYXNoID0ge307XG5cbiAgdmFyIHdob2xlV3JhcHMgPSBbXTtcbiAgX3BvaW50U2VhcmNoLmNhbGwodGhpcywgdGhpcy5yb290LCBfYml0U2hpZnRSaWdodChzdGFydCArIGVuZCksIHdob2xlV3JhcHMsIHRydWUpO1xuXG4gIHdob2xlV3JhcHMuZm9yRWFjaChmdW5jdGlvbihyZXN1bHQpIHtcbiAgICByZXN1bHRIYXNoW3Jlc3VsdC5pZF0gPSB0cnVlO1xuICB9KTtcblxuXG4gIHZhciBpZHgxID0gdGhpcy5wb2ludFRyZWUuYnNlYXJjaChbc3RhcnQsIG51bGxdKTtcbiAgd2hpbGUgKGlkeDEgPj0gMCAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4MV1bMF0gPT0gc3RhcnQpIHtcbiAgICBpZHgxLS07XG4gIH1cblxuICB2YXIgaWR4MiA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW2VuZCwgICBudWxsXSk7XG4gIHZhciBsZW4gPSB0aGlzLnBvaW50VHJlZS5hcnIubGVuZ3RoIC0gMTtcbiAgd2hpbGUgKGlkeDIgPT0gLTEgfHwgKGlkeDIgPD0gbGVuICYmIHRoaXMucG9pbnRUcmVlLmFycltpZHgyXVswXSA8PSBlbmQpKSB7XG4gICAgaWR4MisrO1xuICB9XG5cbiAgdGhpcy5wb2ludFRyZWUuYXJyLnNsaWNlKGlkeDEgKyAxLCBpZHgyKS5mb3JFYWNoKGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgdmFyIGlkID0gcG9pbnRbMV07XG4gICAgcmVzdWx0SGFzaFtpZF0gPSB0cnVlO1xuICB9LCB0aGlzKTtcblxuICBPYmplY3Qua2V5cyhyZXN1bHRIYXNoKS5mb3JFYWNoKGZ1bmN0aW9uKGlkKSB7XG4gICAgdmFyIGl0dmwgPSB0aGlzLmludGVydmFsSGFzaFtpZF07XG4gICAgYXJyLnB1c2goaXR2bC5yZXN1bHQoc3RhcnQsIGVuZCkpO1xuICB9LCB0aGlzKTtcblxufVxuXG5cblxuLyoqXG4gKiBzdWJjbGFzc2VzXG4gKiBcbiAqKi9cblxuXG4vKipcbiAqIE5vZGUgOiBwcm90b3R5cGUgb2YgZWFjaCBub2RlIGluIGEgaW50ZXJ2YWwgdHJlZVxuICogXG4gKiovXG5mdW5jdGlvbiBOb2RlKGlkeCkge1xuICB0aGlzLmlkeCA9IGlkeDtcbiAgdGhpcy5zdGFydHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLnN0YXJ0IC0gYi5zdGFydDtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuZW5kcyA9IG5ldyBTb3J0ZWRMaXN0KHtcbiAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICBpZiAoYSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICBpZiAoYiA9PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICB2YXIgYyA9IGEuZW5kIC0gYi5lbmQ7XG4gICAgICByZXR1cm4gKGMgPCAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogaW5zZXJ0IGFuIEludGVydmFsIG9iamVjdCB0byB0aGlzIG5vZGVcbiAqKi9cbk5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGludGVydmFsKSB7XG4gIHRoaXMuc3RhcnRzLmluc2VydChpbnRlcnZhbCk7XG4gIHRoaXMuZW5kcy5pbnNlcnQoaW50ZXJ2YWwpO1xufTtcblxuXG5cbi8qKlxuICogSW50ZXJ2YWwgOiBwcm90b3R5cGUgb2YgaW50ZXJ2YWwgaW5mb1xuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWwoZGF0YSwgaWQsIHMsIGUpIHtcbiAgdGhpcy5pZCAgICAgPSBpZDtcbiAgdGhpcy5zdGFydCAgPSBkYXRhW3NdO1xuICB0aGlzLmVuZCAgICA9IGRhdGFbZV07XG4gIHRoaXMuZGF0YSAgID0gZGF0YTtcblxuICBpZiAodHlwZW9mIHRoaXMuc3RhcnQgIT0gJ251bWJlcicgfHwgdHlwZW9mIHRoaXMuZW5kICE9ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCwgZW5kIG11c3QgYmUgbnVtYmVyLiBzdGFydDogJyArIHRoaXMuc3RhcnQgKyAnLCBlbmQ6ICcgKyB0aGlzLmVuZCk7XG4gIH1cblxuICBpZiAoIHRoaXMuc3RhcnQgPj0gdGhpcy5lbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0IG11c3QgYmUgc21hbGxlciB0aGFuIGVuZC4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG59XG5cbi8qKlxuICogZ2V0IHJlc3VsdCBvYmplY3RcbiAqKi9cbkludGVydmFsLnByb3RvdHlwZS5yZXN1bHQgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSB7XG4gICAgaWQgICA6IHRoaXMuaWQsXG4gICAgZGF0YSA6IHRoaXMuZGF0YVxuICB9O1xuICBpZiAodHlwZW9mIHN0YXJ0ID09ICdudW1iZXInICYmIHR5cGVvZiBlbmQgPT0gJ251bWJlcicpIHtcbiAgICAvKipcbiAgICAgKiBjYWxjIG92ZXJsYXBwaW5nIHJhdGVcbiAgICAgKiovXG4gICAgdmFyIGxlZnQgID0gTWF0aC5tYXgodGhpcy5zdGFydCwgc3RhcnQpO1xuICAgIHZhciByaWdodCA9IE1hdGgubWluKHRoaXMuZW5kLCAgIGVuZCk7XG4gICAgdmFyIGxhcExuID0gcmlnaHQgLSBsZWZ0O1xuICAgIHJldC5yYXRlMSA9IGxhcExuIC8gKGVuZCAtIHN0YXJ0KTtcbiAgICByZXQucmF0ZTIgPSBsYXBMbiAvICh0aGlzLmVuZCAtIHRoaXMuc3RhcnQpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5mdW5jdGlvbiBEdXBsaWNhdGVFcnJvcihtZXNzYWdlKSB7XG4gICAgdGhpcy5uYW1lID0gJ0R1cGxpY2F0ZUVycm9yJztcbiAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgIHRoaXMuc3RhY2sgPSAobmV3IEVycm9yKCkpLnN0YWNrO1xufVxuRHVwbGljYXRlRXJyb3IucHJvdG90eXBlID0gbmV3IEVycm9yO1xuXG5leHBvcnRzLkludGVydmFsVHJlZSA9IEludGVydmFsVHJlZTtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBMaW5lTWFzazogQSAodmVyeSBjaGVhcCkgYWx0ZXJuYXRpdmUgdG8gSW50ZXJ2YWxUcmVlOiBhIHNtYWxsLCAxRCBwaXhlbCBidWZmZXIgb2Ygb2JqZWN0cy4gPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrO1xuXG5mdW5jdGlvbiBMaW5lTWFzayh3aWR0aCwgZnVkZ2UpIHtcbiAgdGhpcy5mdWRnZSA9IGZ1ZGdlID0gKGZ1ZGdlIHx8IDEpO1xuICB0aGlzLml0ZW1zID0gW107XG4gIHRoaXMubGVuZ3RoID0gTWF0aC5jZWlsKHdpZHRoIC8gZnVkZ2UpO1xuICB0aGlzLm1hc2sgPSBnbG9iYWwuVWludDhBcnJheSA/IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKSA6IG5ldyBBcnJheSh0aGlzLmxlbmd0aCk7XG59XG5cbkxpbmVNYXNrLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbih4LCB3LCBkYXRhKSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgdGhpcy5pdGVtcy5wdXNoKHt4OiB4LCB3OiB3LCBkYXRhOiBkYXRhfSk7XG4gIGZvciAodmFyIGkgPSBNYXRoLm1heChmbG9vckhhY2soeCAvIHRoaXMuZnVkZ2UpLCAwKTsgaSA8IE1hdGgubWluKHVwVG8sIHRoaXMubGVuZ3RoKTsgaSsrKSB7IHRoaXMubWFza1tpXSA9IDE7IH1cbn07XG5cbkxpbmVNYXNrLnByb3RvdHlwZS5jb25mbGljdCA9IGZ1bmN0aW9uKHgsIHcpIHtcbiAgdmFyIHVwVG8gPSBNYXRoLmNlaWwoKHggKyB3KSAvIHRoaXMuZnVkZ2UpO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyBpZiAodGhpcy5tYXNrW2ldKSByZXR1cm4gdHJ1ZTsgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5leHBvcnRzLkxpbmVNYXNrID0gTGluZU1hc2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4gIFxudmFyIEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vSW50ZXJ2YWxUcmVlLmpzJykuSW50ZXJ2YWxUcmVlOyAgXG52YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbnZhciBQQUlSSU5HX0NBTk5PVF9NQVRFID0gMCxcbiAgUEFJUklOR19NQVRFX09OTFkgPSAxLFxuICBQQUlSSU5HX0RSQVdfQVNfTUFURVMgPSAyO1xuXG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIFdyYXBzIHR3byBvZiBTaGluIFN1enVraSdzIEludGVydmFsVHJlZXMgdG8gc3RvcmUgaW50ZXJ2YWxzIHRoYXQgKm1heSpcbiAqIGJlIHBhaXJlZC5cbiAqXG4gKiBAc2VlIEludGVydmFsVHJlZSgpXG4gKiovXG5mdW5jdGlvbiBQYWlyZWRJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMsIHBhaXJlZE9wdGlvbnMpIHtcbiAgdmFyIGRlZmF1bHRPcHRpb25zID0ge3N0YXJ0S2V5OiAwLCBlbmRLZXk6IDF9O1xuICBcbiAgdGhpcy51bnBhaXJlZCA9IG5ldyBJbnRlcnZhbFRyZWUoY2VudGVyLCB1bnBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnVucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHt9LCBkZWZhdWx0T3B0aW9ucywgdW5wYWlyZWRPcHRpb25zKTtcbiAgXG4gIHRoaXMucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHBhaXJlZE9wdGlvbnMpO1xuICB0aGlzLnBhaXJlZE9wdGlvbnMgPSBfLmV4dGVuZCh7cGFpcmluZ0tleTogJ3FuYW1lJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbid9LCBkZWZhdWx0T3B0aW9ucywgcGFpcmVkT3B0aW9ucyk7XG4gIGlmICh0aGlzLnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydEtleSBmb3IgdW5wYWlyZWRPcHRpb25zIGFuZCBwYWlyZWRPcHRpb25zIG11c3QgYmUgZGlmZmVyZW50IGluIGEgUGFpcmVkSW50ZXJ2YWxUcmVlJyk7XG4gIH1cbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXkgPT09IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kS2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSBmYWxzZTtcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSB0aGlzLnBhaXJpbmdNYXhEaXN0YW5jZSA9IG51bGw7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogRGlzYWJsZXMgcGFpcmluZy4gRWZmZWN0aXZlbHkgbWFrZXMgdGhpcyBlcXVpdmFsZW50LCBleHRlcm5hbGx5LCB0byBhbiBJbnRlcnZhbFRyZWUuXG4gKiBUaGlzIGlzIHVzZWZ1bCBpZiB3ZSBkaXNjb3ZlciB0aGF0IHRoaXMgZGF0YSBzb3VyY2UgZG9lc24ndCBjb250YWluIHBhaXJlZCByZWFkcy5cbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuZGlzYWJsZVBhaXJpbmcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5wYWlyaW5nRGlzYWJsZWQgPSB0cnVlO1xuICB0aGlzLnBhaXJlZCA9IHRoaXMudW5wYWlyZWQ7XG59O1xuXG5cbi8qKlxuICogU2V0IGFuIGludGVydmFsIHdpdGhpbiB3aGljaCBwYWlyZWQgbWF0ZXMgd2lsbCBiZSBzYXZlZCBhcyBhIGNvbnRpbnVvdXMgZmVhdHVyZSBpbiAucGFpcmVkXG4gKlxuICogQHBhcmFtIChudW1iZXIpIG1pbjogTWluaW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqIEBwYXJhbSAobnVtYmVyKSBtYXg6IE1heGltdW0gZGlzdGFuY2UsIGluIGJwXG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnNldFBhaXJpbmdJbnRlcnZhbCA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gIGlmICh0eXBlb2YgbWluICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtaW4gYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heCAhPSAnbnVtYmVyJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgbWF4IGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHRoaXMucGFpcmluZ01pbkRpc3RhbmNlICE9PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYmUgY2FsbGVkIG9uY2UuIFlvdSBjYW5cXCd0IGNoYW5nZSB0aGUgcGFpcmluZyBpbnRlcnZhbC4nKTsgfVxuICBcbiAgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPSBtaW47XG4gIHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbWF4O1xufTtcblxuXG4vKipcbiAqIGFkZCBuZXcgcmFuZ2Ugb25seSBpZiBpdCBpcyBuZXcsIGJhc2VkIG9uIHdoZXRoZXIgdGhlIGlkIHdhcyBhbHJlYWR5IHJlZ2lzdGVyZWRcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuYWRkSWZOZXcgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICB2YXIgbWF0ZWQgPSBmYWxzZSxcbiAgICBpbmNyZW1lbnQgPSAwLFxuICAgIHVucGFpcmVkU3RhcnQgPSB0aGlzLnVucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICB1bnBhaXJlZEVuZCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLmVuZEtleSxcbiAgICBwYWlyZWRTdGFydCA9IHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSxcbiAgICBwYWlyZWRFbmQgPSB0aGlzLnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZExlbmd0aCA9IGRhdGFbdGhpcy5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgcGFpcmluZ1N0YXRlID0gUEFJUklOR19DQU5OT1RfTUFURSxcbiAgICBuZXdJZCwgcG90ZW50aWFsTWF0ZTtcbiAgXG4gIC8vIC51bnBhaXJlZCBjb250YWlucyBldmVyeSBhbGlnbm1lbnQgYXMgYSBzZXBhcmF0ZSBpbnRlcnZhbC5cbiAgLy8gSWYgaXQgYWxyZWFkeSBjb250YWlucyB0aGlzIGlkLCB3ZSd2ZSBzZWVuIHRoaXMgcmVhZCBiZWZvcmUgYW5kIHNob3VsZCBkaXNyZWdhcmQuXG4gIGlmICh0aGlzLnVucGFpcmVkLmNvbnRhaW5zKGlkKSkgeyByZXR1cm47IH1cbiAgdGhpcy51bnBhaXJlZC5hZGQoZGF0YSwgaWQpO1xuICBcbiAgLy8gLnBhaXJlZCBjb250YWlucyBhbGlnbm1lbnRzIHRoYXQgbWF5IGJlIG1hdGVkIGludG8gb25lIGludGVydmFsIGlmIHRoZXkgYXJlIHdpdGhpbiB0aGUgcGFpcmluZyByYW5nZVxuICBpZiAoIXRoaXMucGFpcmluZ0Rpc2FibGVkICYmIF9lbGlnaWJsZUZvclBhaXJpbmcodGhpcywgZGF0YSkpIHtcbiAgICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgPT09IG51bGwpIHsgXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhbiBvbmx5IGFkZCBwYWlyZWQgZGF0YSBhZnRlciB0aGUgcGFpcmluZyBpbnRlcnZhbCBoYXMgYmVlbiBzZXQhJyk7XG4gICAgfVxuICAgIFxuICAgIC8vIGluc3RlYWQgb2Ygc3RvcmluZyB0aGVtIHdpdGggdGhlIGdpdmVuIGlkLCB0aGUgcGFpcmluZ0tleSAoZm9yIEJBTSwgUU5BTUUpIGlzIHVzZWQgYXMgdGhlIGlkLlxuICAgIC8vIEFzIGludGVydmFscyBhcmUgYWRkZWQsIHdlIGNoZWNrIGlmIGEgcmVhZCB3aXRoIHRoZSBzYW1lIHBhaXJpbmdLZXkgYWxyZWFkeSBleGlzdHMgaW4gdGhlIC5wYWlyZWQgSW50ZXJ2YWxUcmVlLlxuICAgIG5ld0lkID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmluZ0tleV07XG4gICAgcG90ZW50aWFsTWF0ZSA9IHRoaXMucGFpcmVkLmdldChuZXdJZCk7XG4gICAgXG4gICAgaWYgKHBvdGVudGlhbE1hdGUgIT09IG51bGwpIHtcbiAgICAgIHBvdGVudGlhbE1hdGUgPSBwb3RlbnRpYWxNYXRlLmRhdGE7XG4gICAgICBwYWlyaW5nU3RhdGUgPSBfcGFpcmluZ1N0YXRlKHRoaXMsIGRhdGEsIHBvdGVudGlhbE1hdGUpO1xuICAgICAgLy8gQXJlIHRoZSByZWFkcyBzdWl0YWJsZSBmb3IgbWF0aW5nP1xuICAgICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTIHx8IHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19NQVRFX09OTFkpIHtcbiAgICAgICAgLy8gSWYgeWVzOiBtYXRlIHRoZSByZWFkc1xuICAgICAgICBwb3RlbnRpYWxNYXRlLm1hdGUgPSBkYXRhO1xuICAgICAgICAvLyBIYXMgdG8gYmUgYnkgaWQsIHRvIGF2b2lkIGNpcmN1bGFyIHJlZmVyZW5jZXMgKHByZXZlbnRzIHNlcmlhbGl6YXRpb24pLiBUaGlzIGlzIHRoZSBpZCB1c2VkIGJ5IHRoaXMudW5wYWlyZWQuXG4gICAgICAgIGRhdGEubWF0ZSA9IHBvdGVudGlhbE1hdGUuaWQ7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIEFyZSB0aGUgbWF0ZWQgcmVhZHMgd2l0aGluIGRyYXdhYmxlIHJhbmdlPyBJZiBzbywgc2ltcGx5IGZsYWcgdGhhdCB0aGV5IHNob3VsZCBiZSBkcmF3biB0b2dldGhlciwgYW5kIHRoZXkgd2lsbFxuICAgIGlmIChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfRFJBV19BU19NQVRFUykge1xuICAgICAgZGF0YS5kcmF3QXNNYXRlcyA9IHBvdGVudGlhbE1hdGUuZHJhd0FzTWF0ZXMgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPdGhlcndpc2UsIG5lZWQgdG8gaW5zZXJ0IHRoaXMgcmVhZCBpbnRvIHRoaXMucGFpcmVkIGFzIGEgc2VwYXJhdGUgcmVhZC5cbiAgICAgIC8vIEVuc3VyZSB0aGUgaWQgaXMgdW5pcXVlIGZpcnN0LlxuICAgICAgd2hpbGUgKHRoaXMucGFpcmVkLmNvbnRhaW5zKG5ld0lkKSkge1xuICAgICAgICBuZXdJZCA9IG5ld0lkLnJlcGxhY2UoL1xcdC4qLywgJycpICsgXCJcXHRcIiArICgrK2luY3JlbWVudCk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGRhdGEubWF0ZUV4cGVjdGVkID0gX3BhaXJpbmdTdGF0ZSh0aGlzLCBkYXRhKSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTO1xuICAgICAgLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgcGVyaGFwcyBhIGJpdCB0b28gc3BlY2lmaWMgdG8gaG93IFRMRU4gZm9yIEJBTSBmaWxlcyB3b3JrczsgY291bGQgZ2VuZXJhbGl6ZSBsYXRlclxuICAgICAgLy8gV2hlbiBpbnNlcnRpbmcgaW50byAucGFpcmVkLCB0aGUgaW50ZXJ2YWwncyAuc3RhcnQgYW5kIC5lbmQgc2hvdWxkbid0IGJlIGJhc2VkIG9uIFBPUyBhbmQgdGhlIENJR0FSIHN0cmluZztcbiAgICAgIC8vIHdlIG11c3QgYWRqdXN0IHRoZW0gZm9yIFRMRU4sIGlmIGl0IGlzIG5vbnplcm8sIGRlcGVuZGluZyBvbiBpdHMgc2lnbiwgYW5kIHNldCBuZXcgYm91bmRzIGZvciB0aGUgaW50ZXJ2YWwuXG4gICAgICBpZiAoZGF0YS5tYXRlRXhwZWN0ZWQgJiYgcGFpcmVkTGVuZ3RoID4gMCkge1xuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRTdGFydF07XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRTdGFydF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEubWF0ZUV4cGVjdGVkICYmIHBhaXJlZExlbmd0aCA8IDApIHtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZEVuZF07XG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZEVuZF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgeyAvLyAhZGF0YS5tYXRlRXhwZWN0ZWQgfHwgcGFpcmVkTGVuZ3RoID09IDBcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdO1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkRW5kXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdGhpcy5wYWlyZWQuYWRkKGRhdGEsIG5ld0lkKTtcbiAgICB9XG4gIH1cblxufTtcblxuXG4vKipcbiAqIGFsaWFzIC5hZGQoKSB0byAuYWRkSWZOZXcoKVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBQYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3O1xuXG5cbi8qKlxuICogc2VhcmNoXG4gKlxuICogQHBhcmFtIChudW1iZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyLCBwYWlyZWQpIHtcbiAgaWYgKHBhaXJlZCAmJiAhdGhpcy5wYWlyaW5nRGlzYWJsZWQpIHtcbiAgICByZXR1cm4gdGhpcy5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB0aGlzLnVucGFpcmVkLnNlYXJjaCh2YWwxLCB2YWwyKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIHJlbW92ZTogdW5pbXBsZW1lbnRlZCBmb3Igbm93XG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIENoZWNrIGlmIGFuIGl0dmwgaXMgZWxpZ2libGUgZm9yIHBhaXJpbmcuIFxuLy8gRm9yIG5vdywgdGhpcyBtZWFucyB0aGF0IGlmIGFueSBGTEFHJ3MgMHgxMDAgb3IgaGlnaGVyIGFyZSBzZXQsIHdlIHRvdGFsbHkgZGlzY2FyZCB0aGlzIGFsaWdubWVudCBhbmQgaW50ZXJ2YWwuXG4vLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBlbnRhbmdsZWQgd2l0aCBiYW0uanMgaW50ZXJuYWxzOyBwZXJoYXBzIGFsbG93IHRoaXMgdG8gYmUgZ2VuZXJhbGl6ZWQsIG92ZXJyaWRkZW4sXG4vLyAgICAgICAgb3Igc2V0IGFsb25nc2lkZSAuc2V0UGFpcmluZ0ludGVydmFsKClcbi8vXG4vLyBAcmV0dXJuIChib29sZWFuKVxuZnVuY3Rpb24gX2VsaWdpYmxlRm9yUGFpcmluZyhwYWlyZWRJdHZsVHJlZSwgaXR2bCkge1xuICBpZiAoaXR2bC5pc1NlY29uZGFyeUFsaWdubWVudCB8fCBpdHZsLmlzUmVhZEZhaWxpbmdWZW5kb3JRQyB8fCBpdHZsLmlzRHVwbGljYXRlUmVhZCB8fCBpdHZsLmlzU3VwcGxlbWVudGFyeUFsaWdubWVudCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gQ2hlY2sgaWYgYW4gaXR2bCBhbmQgaXRzIHBvdGVudGlhbE1hdGUgYXJlIHdpdGhpbiB0aGUgcmlnaHQgZGlzdGFuY2UsIGFuZCBvcmllbnRhdGlvbiwgdG8gYmUgbWF0ZWQuXG4vLyBJZiBwb3RlbnRpYWxNYXRlIGlzbid0IGdpdmVuLCB0YWtlcyBhIGJlc3QgZ3Vlc3MgaWYgYSBtYXRlIGlzIGV4cGVjdGVkLCBnaXZlbiB0aGUgaW5mb3JtYXRpb24gaW4gaXR2bCBhbG9uZS5cbi8vIEZJWE1FOiBUaGUgZm9sbG93aW5nIGlzIGVudGFuZ2xlZCB3aXRoIGJhbS5qcyBpbnRlcm5hbHM7IHBlcmhhcHMgYWxsb3cgdGhpcyB0byBiZSBnZW5lcmFsaXplZCwgb3ZlcnJpZGRlbixcbi8vICAgICAgICBvciBzZXQgYWxvbmdzaWRlIC5zZXRQYWlyaW5nSW50ZXJ2YWwoKVxuLy8gXG4vLyBAcmV0dXJuIChudW1iZXIpXG5mdW5jdGlvbiBfcGFpcmluZ1N0YXRlKHBhaXJlZEl0dmxUcmVlLCBpdHZsLCBwb3RlbnRpYWxNYXRlKSB7XG4gIHZhciB0bGVuID0gaXR2bFtwYWlyZWRJdHZsVHJlZS5wYWlyZWRPcHRpb25zLnBhaXJlZExlbmd0aEtleV0sXG4gICAgaXR2bExlbmd0aCA9IGl0dmwuZW5kIC0gaXR2bC5zdGFydCxcbiAgICBpdHZsSXNMYXRlciwgaW5mZXJyZWRJbnNlcnRTaXplO1xuXG4gIGlmIChfLmlzVW5kZWZpbmVkKHBvdGVudGlhbE1hdGUpKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBtb3N0IHJlY2VwdGl2ZSBoeXBvdGhldGljYWwgbWF0ZSwgZ2l2ZW4gdGhlIGluZm9ybWF0aW9uIGluIGl0dmwuXG4gICAgcG90ZW50aWFsTWF0ZSA9IHtcbiAgICAgIF9tb2NrZWQ6IHRydWUsXG4gICAgICBmbGFnczoge1xuICAgICAgICBpc1JlYWRQYWlyZWQ6IHRydWUsXG4gICAgICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogdHJ1ZSxcbiAgICAgICAgaXNSZWFkRmlyc3RPZlBhaXI6IGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpcixcbiAgICAgICAgaXNSZWFkTGFzdE9mUGFpcjogaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpclxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBGaXJzdCBjaGVjayBhIHdob2xlIGhvc3Qgb2YgRkxBRydzLiBUbyBtYWtlIGEgbG9uZyBzdG9yeSBzaG9ydCwgd2UgZXhwZWN0IHBhaXJlZCBlbmRzIHRvIGJlIGVpdGhlclxuICAvLyA5OS0xNDcgb3IgMTYzLTgzLCBkZXBlbmRpbmcgb24gd2hldGhlciB0aGUgcmlnaHRtb3N0IG9yIGxlZnRtb3N0IHNlZ21lbnQgaXMgcHJpbWFyeS5cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFBhaXJlZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQYWlyZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKCFpdHZsLmZsYWdzLmlzUmVhZFByb3Blcmx5QWxpZ25lZCB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRQcm9wZXJseUFsaWduZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkVW5tYXBwZWQgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRVbm1hcHBlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc01hdGVVbm1hcHBlZCB8fCBwb3RlbnRpYWxNYXRlLmZsYWdzLmlzTWF0ZVVubWFwcGVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZEZpcnN0T2ZQYWlyICYmICFwb3RlbnRpYWxNYXRlLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNSZWFkTGFzdE9mUGFpciAmJiAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRGaXJzdE9mUGFpcikgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIFxuICBwb3RlbnRpYWxNYXRlLl9tb2NrZWQgJiYgXy5leHRlbmQocG90ZW50aWFsTWF0ZSwge1xuICAgIHJuYW1lOiBpdHZsLnJuZXh0ID09ICc9JyA/IGl0dmwucm5hbWUgOiBpdHZsLnJuZXh0LFxuICAgIHBvczogaXR2bC5wbmV4dCxcbiAgICBzdGFydDogaXR2bC5wbmV4dCxcbiAgICBlbmQ6IHRsZW4gPiAwID8gaXR2bC5zdGFydCArIHRsZW4gOiAodGxlbiA8IDAgPyBpdHZsLmVuZCArIHRsZW4gKyBpdHZsTGVuZ3RoIDogaXR2bC5wbmV4dCArIGl0dmxMZW5ndGgpLFxuICAgIHJuZXh0OiBpdHZsLnJuZXh0ID09ICc9JyA/ICc9JyA6IGl0dmwucm5hbWUsXG4gICAgcG5leHQ6IGl0dmwucG9zXG4gIH0pO1xuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgb24gdGhlIHNhbWUgcmVmZXJlbmNlIHNlcXVlbmNlXG4gIGlmIChpdHZsLnJuZXh0ICE9ICc9JyB8fCBwb3RlbnRpYWxNYXRlLnJuZXh0ICE9ICc9JykgeyBcbiAgICAvLyBhbmQgaWYgbm90LCBkbyB0aGUgY29vcmRpbmF0ZXMgbWF0Y2ggYXQgYWxsP1xuICAgIGlmIChpdHZsLnJuZXh0ICE9IHBvdGVudGlhbE1hdGUucm5hbWUgfHwgaXR2bC5ybmV4dCAhPSBwb3RlbnRpYWxNYXRlLnJuYW1lKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgaWYgKGl0dmwucG5leHQgIT0gcG90ZW50aWFsTWF0ZS5wb3MgfHwgaXR2bC5wb3MgIT0gcG90ZW50aWFsTWF0ZS5wbmV4dCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIHJldHVybiBQQUlSSU5HX01BVEVfT05MWTtcbiAgfVxuICBcbiAgcG90ZW50aWFsTWF0ZS5fbW9ja2VkICYmIF8uZXh0ZW5kKHBvdGVudGlhbE1hdGUuZmxhZ3MsIHtcbiAgICByZWFkU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSxcbiAgICBtYXRlU3RyYW5kUmV2ZXJzZTogaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZVxuICB9KTtcbiAgXG4gIGl0dmxJc0xhdGVyID0gaXR2bC5zdGFydCA+IHBvdGVudGlhbE1hdGUuc3RhcnQ7XG4gIGluZmVycmVkSW5zZXJ0U2l6ZSA9IGl0dmxJc0xhdGVyID8gaXR2bC5zdGFydCAtIHBvdGVudGlhbE1hdGUuZW5kIDogcG90ZW50aWFsTWF0ZS5zdGFydCAtIGl0dmwuZW5kO1xuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgLS0+IDwtLVxuICBpZiAoaXR2bElzTGF0ZXIpIHtcbiAgICBpZiAoIWl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAocG90ZW50aWFsTWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAoIXBvdGVudGlhbE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfVxuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgaW5mZXJyZWRJbnNlcnRTaXplIGlzIHdpdGhpbiB0aGUgYWNjZXB0YWJsZSByYW5nZS5cbiAgaWYgKGluZmVycmVkSW5zZXJ0U2l6ZSA+IHRoaXMucGFpcmluZ01heERpc3RhbmNlIHx8IGluZmVycmVkSW5zZXJ0U2l6ZSA8IHRoaXMucGFpcmluZ01pbkRpc3RhbmNlKSB7IHJldHVybiBQQUlSSU5HX01BVEVfT05MWTsgfVxuICBcbiAgcmV0dXJuIFBBSVJJTkdfRFJBV19BU19NQVRFUztcbn1cblxuZXhwb3J0cy5QYWlyZWRJbnRlcnZhbFRyZWUgPSBQYWlyZWRJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLyoqXG4gICogUmVtb3RlVHJhY2tcbiAgKlxuICAqIEEgaGVscGVyIGNsYXNzIGJ1aWx0IGZvciBjYWNoaW5nIGRhdGEgZmV0Y2hlZCBmcm9tIGEgcmVtb3RlIHRyYWNrIChkYXRhIGFsaWduZWQgdG8gYSBnZW5vbWUpLlxuICAqIFRoZSBnZW5vbWUgaXMgZGl2aWRlZCBpbnRvIGJpbnMgb2Ygb3B0aW1hbEZldGNoV2luZG93IG50cywgZm9yIGVhY2ggb2Ygd2hpY2ggZGF0YSB3aWxsIG9ubHkgYmUgZmV0Y2hlZCBvbmNlLlxuICAqIFRvIHNldHVwIHRoZSBiaW5zLCBjYWxsIC5zZXR1cEJpbnMoLi4uKSBhZnRlciBpbml0aWFsaXppbmcgdGhlIGNsYXNzLlxuICAqXG4gICogVGhlcmUgaXMgb25lIG1haW4gcHVibGljIG1ldGhvZCBmb3IgdGhpcyBjbGFzczogLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgY2FsbGJhY2spXG4gICogKEZvciBjb25zaXN0ZW5jeSB3aXRoIEN1c3RvbVRyYWNrcy5qcywgYWxsIGBzdGFydGAgYW5kIGBlbmRgIHBvc2l0aW9ucyBhcmUgMS1iYXNlZCwgb3JpZW50ZWQgdG9cbiAgKiB0aGUgc3RhcnQgb2YgdGhlIGdlbm9tZSwgYW5kIGludGVydmFscyBhcmUgcmlnaHQtb3Blbi4pXG4gICpcbiAgKiBUaGlzIG1ldGhvZCB3aWxsIHJlcXVlc3QgYW5kIGNhY2hlIGRhdGEgZm9yIHRoZSBnaXZlbiBpbnRlcnZhbCB0aGF0IGlzIG5vdCBhbHJlYWR5IGNhY2hlZCwgYW5kIGNhbGwgXG4gICogY2FsbGJhY2soaW50ZXJ2YWxzKSBhcyBzb29uIGFzIGRhdGEgZm9yIGFsbCBpbnRlcnZhbHMgaXMgYXZhaWxhYmxlLiAoSWYgdGhlIGRhdGEgaXMgYWxyZWFkeSBhdmFpbGFibGUsIFxuICAqIGl0IHdpbGwgY2FsbCB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkuKVxuICAqKi9cblxudmFyIEJJTl9MT0FESU5HID0gMSxcbiAgQklOX0xPQURFRCA9IDI7XG5cbi8qKlxuICAqIFJlbW90ZVRyYWNrIGNvbnN0cnVjdG9yLlxuICAqXG4gICogTm90ZSB5b3Ugc3RpbGwgbXVzdCBjYWxsIGAuc2V0dXBCaW5zKC4uLilgIGJlZm9yZSB0aGUgUmVtb3RlVHJhY2sgaXMgcmVhZHkgdG8gZmV0Y2ggZGF0YS5cbiAgKlxuICAqIEBwYXJhbSAoSW50ZXJ2YWxUcmVlKSBjYWNoZTogQW4gY2FjaGUgc3RvcmUgdGhhdCB3aWxsIHJlY2VpdmUgaW50ZXJ2YWxzIGZldGNoZWQgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU2hvdWxkIGJlIGFuIEludGVydmFsVHJlZSBvciBlcXVpdmFsZW50LCB0aGF0IGltcGxlbWVudHMgYC5hZGRJZk5ldyguLi4pYCBhbmQgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgLnNlYXJjaChzdGFydCwgZW5kKWAgbWV0aG9kcy4gSWYgaXQgaXMgYW4gKmV4dGVuc2lvbiogb2YgYW4gSW50ZXJ2YWxUcmVlLCBub3RlIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGBleHRyYUFyZ3NgIHBhcmFtIHBlcm1pdHRlZCBmb3IgYC5mZXRjaEFzeW5jKClgLCB3aGljaCBhcmUgcGFzc2VkIGFsb25nIGFzIFxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0cmEgYXJndW1lbnRzIHRvIGAuc2VhcmNoKClgLlxuICAqIEBwYXJhbSAoZnVuY3Rpb24pIGZldGNoZXI6IEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCB0byBmZXRjaCBkYXRhIGZvciBlYWNoIGJpbi5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIGZ1bmN0aW9uIHNob3VsZCB0YWtlIHRocmVlIGFyZ3VtZW50cywgYHN0YXJ0YCwgYGVuZGAsIGFuZCBgc3RvcmVJbnRlcnZhbHNgLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0b3JlSW50ZXJ2YWxzYCBpcyBhIGNhbGxiYWNrIHRoYXQgYGZldGNoZXJgIE1VU1QgY2FsbCBvbiB0aGUgYXJyYXkgb2YgaW50ZXJ2YWxzXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgb25jZSB0aGV5IGhhdmUgYmVlbiBmZXRjaGVkIGZyb20gdGhlIHJlbW90ZSBkYXRhIHNvdXJjZSBhbmQgcGFyc2VkLlxuICAqIEBzZWUgX2ZldGNoQmluIGZvciBob3cgYGZldGNoZXJgIGlzIHV0aWxpemVkLlxuICAqKi9cbmZ1bmN0aW9uIFJlbW90ZVRyYWNrKGNhY2hlLCBmZXRjaGVyKSB7XG4gIGlmICh0eXBlb2YgY2FjaGUgIT0gJ29iamVjdCcgfHwgKCFjYWNoZS5hZGRJZk5ldyAmJiAoIV8ua2V5cyhjYWNoZSkubGVuZ3RoIHx8IGNhY2hlW18ua2V5cyhjYWNoZSlbMF1dLmFkZElmTmV3KSkpIHsgXG4gICAgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGFuIEludGVydmFsVHJlZSBjYWNoZSwgb3IgYW4gb2JqZWN0L2FycmF5IGNvbnRhaW5pbmcgSW50ZXJ2YWxUcmVlcywgYXMgdGhlIDFzdCBhcmd1bWVudC4nKTsgXG4gIH1cbiAgaWYgKHR5cGVvZiBmZXRjaGVyICE9ICdmdW5jdGlvbicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IGEgZmV0Y2hlciBmdW5jdGlvbiBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIFxuICB0aGlzLmNhY2hlID0gY2FjaGU7XG4gIHRoaXMuZmV0Y2hlciA9IGZldGNoZXI7XG4gIFxuICB0aGlzLmNhbGxiYWNrcyA9IFtdO1xuICB0aGlzLmFmdGVyQmluU2V0dXAgPSBbXTtcbiAgdGhpcy5iaW5zTG9hZGVkID0gbnVsbDtcbn1cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG4vLyBTZXR1cCB0aGUgYmlubmluZyBzY2hlbWUgZm9yIHRoaXMgUmVtb3RlVHJhY2suIFRoaXMgY2FuIG9jY3VyIGFueXRpbWUgYWZ0ZXIgaW5pdGlhbGl6YXRpb24sIGFuZCBpbiBmYWN0LFxuLy8gY2FuIG9jY3VyIGFmdGVyIGNhbGxzIHRvIGAuZmV0Y2hBc3luYygpYCBoYXZlIGJlZW4gbWFkZSwgaW4gd2hpY2ggY2FzZSB0aGV5IHdpbGwgYmUgd2FpdGluZyBvbiB0aGlzIG1ldGhvZFxuLy8gdG8gYmUgY2FsbGVkIHRvIHByb2NlZWQuIEJ1dCBpdCBNVVNUIGJlIGNhbGxlZCBiZWZvcmUgZGF0YSB3aWxsIGJlIHJlY2VpdmVkIGJ5IGNhbGxiYWNrcyBwYXNzZWQgdG8gXG4vLyBgLmZldGNoQXN5bmMoKWAuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuc2V0dXBCaW5zID0gZnVuY3Rpb24oZ2Vub21lU2l6ZSwgb3B0aW1hbEZldGNoV2luZG93LCBtYXhGZXRjaFdpbmRvdykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChzZWxmLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IHJ1biBzZXR1cEJpbnMgbW9yZSB0aGFuIG9uY2UuJyk7IH1cbiAgaWYgKHR5cGVvZiBnZW5vbWVTaXplICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSB0aGUgZ2Vub21lU2l6ZSBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2Ygb3B0aW1hbEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBvcHRpbWFsRmV0Y2hXaW5kb3cgYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodHlwZW9mIG1heEZldGNoV2luZG93ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXhGZXRjaFdpbmRvdyBhcyB0aGUgM3JkIGFyZ3VtZW50LicpOyB9XG4gIFxuICBzZWxmLmdlbm9tZVNpemUgPSBnZW5vbWVTaXplO1xuICBzZWxmLm9wdGltYWxGZXRjaFdpbmRvdyA9IG9wdGltYWxGZXRjaFdpbmRvdztcbiAgc2VsZi5tYXhGZXRjaFdpbmRvdyA9IG1heEZldGNoV2luZG93O1xuICBcbiAgc2VsZi5udW1CaW5zID0gTWF0aC5jZWlsKGdlbm9tZVNpemUgLyBvcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICBzZWxmLmJpbnNMb2FkZWQgPSB7fTtcbiAgXG4gIC8vIEZpcmUgb2ZmIHJhbmdlcyBzYXZlZCB0byBhZnRlckJpblNldHVwXG4gIF8uZWFjaCh0aGlzLmFmdGVyQmluU2V0dXAsIGZ1bmN0aW9uKHJhbmdlKSB7XG4gICAgc2VsZi5mZXRjaEFzeW5jKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQsIHJhbmdlLmV4dHJhQXJncyk7XG4gIH0pO1xuICBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMoc2VsZik7XG59XG5cblxuLy8gRmV0Y2hlcyBkYXRhIChpZiBuZWNlc3NhcnkpIGZvciB1bmZldGNoZWQgYmlucyBvdmVybGFwcGluZyB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBUaGVuLCBydW4gYGNhbGxiYWNrYCBvbiBhbGwgc3RvcmVkIHN1YmludGVydmFscyB0aGF0IG92ZXJsYXAgd2l0aCB0aGUgaW50ZXJ2YWwgZnJvbSBgc3RhcnRgIHRvIGBlbmRgLlxuLy8gYGV4dHJhQXJnc2AgaXMgYW4gKm9wdGlvbmFsKiBwYXJhbWV0ZXIgdGhhdCBjYW4gY29udGFpbiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZSBgLnNlYXJjaCgpYCBmdW5jdGlvbiBvZiB0aGUgY2FjaGUuXG4vL1xuLy8gQHBhcmFtIChudW1iZXIpIHN0YXJ0OiAgICAgICAxLWJhc2VkIGdlbm9taWMgY29vcmRpbmF0ZSB0byBzdGFydCBmZXRjaGluZyBmcm9tXG4vLyBAcGFyYW0gKG51bWJlcikgZW5kOiAgICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIChyaWdodC1vcGVuKSB0byBzdGFydCBmZXRjaGluZyAqdW50aWwqXG4vLyBAcGFyYW0gKEFycmF5KSBbZXh0cmFBcmdzXTogIG9wdGlvbmFsLCBwYXNzZWQgYWxvbmcgdG8gdGhlIGAuc2VhcmNoKClgIGNhbGxzIG9uIHRoZSAuY2FjaGUgYXMgYXJndW1lbnRzIDMgYW5kIHVwOyBcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGVyaGFwcyB1c2VmdWwgaWYgdGhlIC5jYWNoZSBoYXMgb3ZlcnJpZGRlbiB0aGlzIG1ldGhvZFxuLy8gQHBhcmFtIChmdW5jdGlvbikgY2FsbGJhY2s6ICBBIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgb25jZSBkYXRhIGlzIHJlYWR5IGZvciB0aGlzIGludGVydmFsLiBXaWxsIGJlIHBhc3NlZFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGwgaW50ZXJ2YWwgZmVhdHVyZXMgdGhhdCBoYXZlIGJlZW4gZmV0Y2hlZCBmb3IgdGhpcyBpbnRlcnZhbCwgb3Ige3Rvb01hbnk6IHRydWV9XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIG1vcmUgZGF0YSB3YXMgcmVxdWVzdGVkIHRoYW4gY291bGQgYmUgcmVhc29uYWJseSBmZXRjaGVkLlxuUmVtb3RlVHJhY2sucHJvdG90eXBlLmZldGNoQXN5bmMgPSBmdW5jdGlvbihzdGFydCwgZW5kLCBleHRyYUFyZ3MsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKF8uaXNGdW5jdGlvbihleHRyYUFyZ3MpICYmIF8uaXNVbmRlZmluZWQoY2FsbGJhY2spKSB7IGNhbGxiYWNrID0gZXh0cmFBcmdzOyBleHRyYUFyZ3MgPSB1bmRlZmluZWQ7IH1cbiAgaWYgKCFzZWxmLmJpbnNMb2FkZWQpIHtcbiAgICAvLyBJZiBiaW5zICphcmVuJ3QqIHNldHVwIHlldDpcbiAgICAvLyBTYXZlIHRoZSBjYWxsYmFjayBvbnRvIHRoZSBxdWV1ZVxuICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IFxuICAgICAgc2VsZi5jYWxsYmFja3MucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3MsIGNhbGxiYWNrOiBjYWxsYmFja30pOyBcbiAgICB9XG4gICAgXG4gICAgLy8gU2F2ZSB0aGlzIGZldGNoIGZvciB3aGVuIHRoZSBiaW5zIGFyZSBsb2FkZWRcbiAgICBzZWxmLmFmdGVyQmluU2V0dXAucHVzaCh7c3RhcnQ6IHN0YXJ0LCBlbmQ6IGVuZCwgZXh0cmFBcmdzOiBleHRyYUFyZ3N9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBiaW5zICphcmUqIHNldHVwLCBmaXJzdCBjYWxjdWxhdGUgd2hpY2ggYmlucyBjb3JyZXNwb25kIHRvIHRoaXMgaW50ZXJ2YWwsIFxuICAgIC8vIGFuZCB3aGF0IHN0YXRlIHRob3NlIGJpbnMgYXJlIGluXG4gICAgdmFyIGJpbnMgPSBfYmluT3ZlcmxhcChzZWxmLCBzdGFydCwgZW5kKSxcbiAgICAgIGxvYWRlZEJpbnMgPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiBzZWxmLmJpbnNMb2FkZWRbaV0gPT09IEJJTl9MT0FERUQ7IH0pLFxuICAgICAgYmluc1RvRmV0Y2ggPSBfLmZpbHRlcihiaW5zLCBmdW5jdGlvbihpKSB7IHJldHVybiAhc2VsZi5iaW5zTG9hZGVkW2ldOyB9KTtcbiAgICBcbiAgICBpZiAobG9hZGVkQmlucy5sZW5ndGggPT0gYmlucy5sZW5ndGgpIHtcbiAgICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgbG9hZGVkIGRhdGEgZm9yIGFsbCB0aGUgYmlucyBpbiBxdWVzdGlvbiwgc2hvcnQtY2lyY3VpdCBhbmQgcnVuIHRoZSBjYWxsYmFjayBub3dcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoZXh0cmFBcmdzKSA/IFtdIDogZXh0cmFBcmdzO1xuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soc2VsZi5jYWNoZS5zZWFyY2guYXBwbHkoc2VsZi5jYWNoZSwgW3N0YXJ0LCBlbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgfSBlbHNlIGlmIChlbmQgLSBzdGFydCA+IHNlbGYubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIC8vIGVsc2UsIGlmIHRoaXMgaW50ZXJ2YWwgaXMgdG9vIGJpZyAoPiBtYXhGZXRjaFdpbmRvdyksIGZpcmUgdGhlIGNhbGxiYWNrIHJpZ2h0IGF3YXkgd2l0aCB7dG9vTWFueTogdHJ1ZX1cbiAgICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spICYmIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIGVsc2UsIHB1c2ggdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyB0aGVuIHJ1biBmZXRjaGVzIGZvciB0aGUgdW5mZXRjaGVkIGJpbnMsIHdoaWNoIHNob3VsZCBjYWxsIF9maXJlQ2FsbGJhY2tzIGFmdGVyIHRoZXkgY29tcGxldGUsXG4gICAgLy8gd2hpY2ggd2lsbCBhdXRvbWF0aWNhbGx5IGZpcmUgY2FsbGJhY2tzIGZyb20gdGhlIGFib3ZlIHF1ZXVlIGFzIHRoZXkgYWNxdWlyZSBhbGwgbmVlZGVkIGRhdGEuXG4gICAgXy5lYWNoKGJpbnNUb0ZldGNoLCBmdW5jdGlvbihiaW5JbmRleCkge1xuICAgICAgX2ZldGNoQmluKHNlbGYsIGJpbkluZGV4LCBmdW5jdGlvbigpIHsgX2ZpcmVDYWxsYmFja3Moc2VsZik7IH0pO1xuICAgIH0pO1xuICB9XG59XG5cblxuLyoqXG4gKiBwcml2YXRlIG1ldGhvZHNcbiAqKi9cblxuLy8gQ2FsY3VsYXRlcyB3aGljaCBiaW5zIG92ZXJsYXAgd2l0aCBhbiBpbnRlcnZhbCBnaXZlbiBieSBgc3RhcnRgIGFuZCBgZW5kYC5cbi8vIGBzdGFydGAgYW5kIGBlbmRgIGFyZSAxLWJhc2VkIGNvb3JkaW5hdGVzIGZvcm1pbmcgYSByaWdodC1vcGVuIGludGVydmFsLlxuZnVuY3Rpb24gX2Jpbk92ZXJsYXAocmVtb3RlVHJrLCBzdGFydCwgZW5kKSB7XG4gIGlmICghcmVtb3RlVHJrLmJpbnNMb2FkZWQpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgY2Fubm90IGNhbGN1bGF0ZSBiaW4gb3ZlcmxhcCBiZWZvcmUgc2V0dXBCaW5zIGlzIGNhbGxlZC4nKTsgfVxuICAvLyBJbnRlcm5hbGx5LCBmb3IgYXNzaWduaW5nIGNvb3JkaW5hdGVzIHRvIGJpbnMsIHdlIHVzZSAwLWJhc2VkIGNvb3JkaW5hdGVzIGZvciBlYXNpZXIgY2FsY3VsYXRpb25zLlxuICB2YXIgc3RhcnRCaW4gPSBNYXRoLmZsb29yKChzdGFydCAtIDEpIC8gcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyksXG4gICAgZW5kQmluID0gTWF0aC5mbG9vcigoZW5kIC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KTtcbiAgcmV0dXJuIF8ucmFuZ2Uoc3RhcnRCaW4sIGVuZEJpbiArIDEpO1xufVxuXG4vLyBSdW5zIHRoZSBmZXRjaGVyIGZ1bmN0aW9uIG9uIGEgZ2l2ZW4gYmluLlxuLy8gVGhlIGZldGNoZXIgZnVuY3Rpb24gaXMgb2JsaWdhdGVkIHRvIHJ1biBhIGNhbGxiYWNrIGZ1bmN0aW9uIGBzdG9yZUludGVydmFsc2AsIFxuLy8gICAgcGFzc2VkIGFzIGl0cyB0aGlyZCBhcmd1bWVudCwgb24gYSBzZXQgb2YgaW50ZXJ2YWxzIHRoYXQgd2lsbCBiZSBpbnNlcnRlZCBpbnRvIHRoZSBcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBJbnRlcnZhbFRyZWUuXG4vLyBUaGUgYHN0b3JlSW50ZXJ2YWxzYCBmdW5jdGlvbiBtYXkgYWNjZXB0IGEgc2Vjb25kIGFyZ3VtZW50IGNhbGxlZCBgY2FjaGVJbmRleGAsIGluIGNhc2Vcbi8vICAgIHJlbW90ZVRyay5jYWNoZSBpcyBhY3R1YWxseSBhIGNvbnRhaW5lciBmb3IgbXVsdGlwbGUgSW50ZXJ2YWxUcmVlcywgaW5kaWNhdGluZyB3aGljaCBcbi8vICAgIG9uZSB0byBzdG9yZSBpdCBpbi5cbi8vIFdlIHRoZW4gY2FsbCB0aGUgYGNhbGxiYWNrYCBnaXZlbiBoZXJlIGFmdGVyIHRoYXQgaXMgY29tcGxldGUuXG5mdW5jdGlvbiBfZmV0Y2hCaW4ocmVtb3RlVHJrLCBiaW5JbmRleCwgY2FsbGJhY2spIHtcbiAgdmFyIHN0YXJ0ID0gYmluSW5kZXggKiByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93ICsgMSxcbiAgICBlbmQgPSAoYmluSW5kZXggKyAxKSAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxO1xuICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BRElORztcbiAgcmVtb3RlVHJrLmZldGNoZXIoc3RhcnQsIGVuZCwgZnVuY3Rpb24gc3RvcmVJbnRlcnZhbHMoaW50ZXJ2YWxzKSB7XG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIGlmICghaW50ZXJ2YWwpIHsgcmV0dXJuOyB9XG4gICAgICByZW1vdGVUcmsuY2FjaGUuYWRkSWZOZXcoaW50ZXJ2YWwsIGludGVydmFsLmlkKTtcbiAgICB9KTtcbiAgICByZW1vdGVUcmsuYmluc0xvYWRlZFtiaW5JbmRleF0gPSBCSU5fTE9BREVEO1xuICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgfSk7XG59XG5cbi8vIFJ1bnMgdGhyb3VnaCBhbGwgc2F2ZWQgY2FsbGJhY2tzIGFuZCBmaXJlcyBhbnkgY2FsbGJhY2tzIHdoZXJlIGFsbCB0aGUgcmVxdWlyZWQgZGF0YSBpcyByZWFkeVxuLy8gQ2FsbGJhY2tzIHRoYXQgYXJlIGZpcmVkIGFyZSByZW1vdmVkIGZyb20gdGhlIHF1ZXVlLlxuZnVuY3Rpb24gX2ZpcmVDYWxsYmFja3MocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2ssXG4gICAgICBleHRyYUFyZ3MgPSBfLmlzVW5kZWZpbmVkKGFmdGVyTG9hZC5leHRyYUFyZ3MpID8gW10gOiBhZnRlckxvYWQuZXh0cmFBcmdzLFxuICAgICAgYmlucywgc3RpbGxMb2FkaW5nQmlucztcbiAgICAgICAgXG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIGJpbnMgPSBfYmluT3ZlcmxhcChyZW1vdGVUcmssIGFmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZCk7XG4gICAgc3RpbGxMb2FkaW5nQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHJlbW90ZVRyay5iaW5zTG9hZGVkW2ldICE9PSBCSU5fTE9BREVEOyB9KS5sZW5ndGggPiAwO1xuICAgIGlmICghc3RpbGxMb2FkaW5nQmlucykge1xuICAgICAgY2FsbGJhY2socmVtb3RlVHJrLmNhY2hlLnNlYXJjaC5hcHBseShyZW1vdGVUcmsuY2FjaGUsIFthZnRlckxvYWQuc3RhcnQsIGFmdGVyTG9hZC5lbmRdLmNvbmNhdChleHRyYUFyZ3MpKSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3MgZm9yIHdoaWNoIHdlIHdvbid0IGxvYWQgZGF0YSBzaW5jZSB0aGUgYW1vdW50XG4vLyByZXF1ZXN0ZWQgaXMgdG9vIGxhcmdlLiBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfY2xlYXJDYWxsYmFja3NGb3JUb29CaWdJbnRlcnZhbHMocmVtb3RlVHJrKSB7XG4gIHJlbW90ZVRyay5jYWxsYmFja3MgPSBfLmZpbHRlcihyZW1vdGVUcmsuY2FsbGJhY2tzLCBmdW5jdGlvbihhZnRlckxvYWQpIHtcbiAgICB2YXIgY2FsbGJhY2sgPSBhZnRlckxvYWQuY2FsbGJhY2s7XG4gICAgaWYgKGFmdGVyTG9hZC5lbmQgLSBhZnRlckxvYWQuc3RhcnQgPiByZW1vdGVUcmsubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbn1cblxuXG5leHBvcnRzLlJlbW90ZVRyYWNrID0gUmVtb3RlVHJhY2s7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG4vLyBUT0RPOiBiYWNrcG9ydCB0aGlzIGNvZGUgZm9yIEphdmFTY3JpcHQgMS41PyB1c2luZyB1bmRlcnNjb3JlLmpzXG4vKipcbiAqIEJ5IFNoaW4gU3V6dWtpLCBNSVQgbGljZW5zZVxuICogaHR0cHM6Ly9naXRodWIuY29tL3NoaW5vdXQvU29ydGVkTGlzdFxuICpcbiAqIFNvcnRlZExpc3QgOiBjb25zdHJ1Y3RvclxuICogXG4gKiBAcGFyYW0gYXJyIDogQXJyYXkgb3IgbnVsbCA6IGFuIGFycmF5IHRvIHNldFxuICpcbiAqIEBwYXJhbSBvcHRpb25zIDogb2JqZWN0ICBvciBudWxsXG4gKiAgICAgICAgIChmdW5jdGlvbikgZmlsdGVyICA6IGZpbHRlciBmdW5jdGlvbiBjYWxsZWQgYmVmb3JlIGluc2VydGluZyBkYXRhLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIHJlY2VpdmVzIGEgdmFsdWUgYW5kIHJldHVybnMgdHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdmFsaWQuXG4gKlxuICogICAgICAgICAoZnVuY3Rpb24pIGNvbXBhcmUgOiBmdW5jdGlvbiB0byBjb21wYXJlIHR3byB2YWx1ZXMsIFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGljaCBpcyB1c2VkIGZvciBzb3J0aW5nIG9yZGVyLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgc2FtZSBzaWduYXR1cmUgYXMgQXJyYXkucHJvdG90eXBlLnNvcnQoZm4pLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAqICAgICAgICAgKHN0cmluZykgICBjb21wYXJlIDogaWYgeW91J2QgbGlrZSB0byBzZXQgYSBjb21tb24gY29tcGFyaXNvbiBmdW5jdGlvbixcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeW91IGNhbiBzcGVjaWZ5IGl0IGJ5IHN0cmluZzpcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJudW1iZXJcIiA6IGNvbXBhcmVzIG51bWJlclxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcInN0cmluZ1wiIDogY29tcGFyZXMgc3RyaW5nXG4gKi9cbmZ1bmN0aW9uIFNvcnRlZExpc3QoKSB7XG4gIHZhciBhcnIgICAgID0gbnVsbCxcbiAgICAgIG9wdGlvbnMgPSB7fSxcbiAgICAgIGFyZ3MgICAgPSBhcmd1bWVudHM7XG5cbiAgW1wiMFwiLFwiMVwiXS5mb3JFYWNoKGZ1bmN0aW9uKG4pIHtcbiAgICB2YXIgdmFsID0gYXJnc1tuXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG4gICAgICBhcnIgPSB2YWw7XG4gICAgfVxuICAgIGVsc2UgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09IFwib2JqZWN0XCIpIHtcbiAgICAgIG9wdGlvbnMgPSB2YWw7XG4gICAgfVxuICB9KTtcbiAgdGhpcy5hcnIgPSBbXTtcblxuICBbXCJmaWx0ZXJcIiwgXCJjb21wYXJlXCJdLmZvckVhY2goZnVuY3Rpb24oaykge1xuICAgIGlmICh0eXBlb2Ygb3B0aW9uc1trXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRoaXNba10gPSBvcHRpb25zW2tdO1xuICAgIH1cbiAgICBlbHNlIGlmIChvcHRpb25zW2tdICYmIFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV0pIHtcbiAgICAgIHRoaXNba10gPSBTb3J0ZWRMaXN0W2tdW29wdGlvbnNba11dO1xuICAgIH1cbiAgfSwgdGhpcyk7XG4gIGlmIChhcnIpIHRoaXMubWFzc0luc2VydChhcnIpO1xufTtcblxuLy8gQmluYXJ5IHNlYXJjaCBmb3IgdGhlIGluZGV4IG9mIHRoZSBpdGVtIGVxdWFsIHRvIGB2YWxgLCBvciBpZiBubyBzdWNoIGl0ZW0gZXhpc3RzLCB0aGUgbmV4dCBsb3dlciBpdGVtXG4vLyBUaGlzIGNhbiBiZSAtMSBpZiBgdmFsYCBpcyBsb3dlciB0aGFuIHRoZSBsb3dlc3QgaXRlbSBpbiB0aGUgU29ydGVkTGlzdFxuU29ydGVkTGlzdC5wcm90b3R5cGUuYnNlYXJjaCA9IGZ1bmN0aW9uKHZhbCkge1xuICB2YXIgbXBvcyxcbiAgICAgIHNwb3MgPSAwLFxuICAgICAgZXBvcyA9IHRoaXMuYXJyLmxlbmd0aDtcbiAgd2hpbGUgKGVwb3MgLSBzcG9zID4gMSkge1xuICAgIG1wb3MgPSBNYXRoLmZsb29yKChzcG9zICsgZXBvcykvMik7XG4gICAgbXZhbCA9IHRoaXMuYXJyW21wb3NdO1xuICAgIHN3aXRjaCAodGhpcy5jb21wYXJlKHZhbCwgbXZhbCkpIHtcbiAgICBjYXNlIDEgIDpcbiAgICBkZWZhdWx0IDpcbiAgICAgIHNwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAtMSA6XG4gICAgICBlcG9zID0gbXBvcztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMCAgOlxuICAgICAgcmV0dXJuIG1wb3M7XG4gICAgfVxuICB9XG4gIHJldHVybiAodGhpcy5hcnJbMF0gPT0gbnVsbCB8fCBzcG9zID09IDAgJiYgdGhpcy5hcnJbMF0gIT0gbnVsbCAmJiB0aGlzLmNvbXBhcmUodGhpcy5hcnJbMF0sIHZhbCkgPT0gMSkgPyAtMSA6IHNwb3M7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyW3Bvc107XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24ocG9zKSB7XG4gIHJldHVybiB0aGlzLmFyci5zbGljZSgpO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlLmFwcGx5KHRoaXMuYXJyLCBhcmd1bWVudHMpO1xufVxuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zaXplID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyci5sZW5ndGg7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5oZWFkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmFyclswXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRhaWwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICh0aGlzLmFyci5sZW5ndGggPT0gMCkgPyBudWxsIDogdGhpcy5hcnJbdGhpcy5hcnIubGVuZ3RoIC0xXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLm1hc3NJbnNlcnQgPSBmdW5jdGlvbihpdGVtcykge1xuICAvLyBUaGlzIGxvb3AgYXZvaWRzIGNhbGwgc3RhY2sgb3ZlcmZsb3cgYmVjYXVzZSBvZiB0b28gbWFueSBhcmd1bWVudHNcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gNDA5Nikge1xuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHRoaXMuYXJyLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChpdGVtcywgaSwgaSArIDQwOTYpKTtcbiAgfVxuICB0aGlzLmFyci5zb3J0KHRoaXMuY29tcGFyZSk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEwMCkge1xuICAgIC8vIC5ic2VhcmNoICsgLnNwbGljZSBpcyB0b28gZXhwZW5zaXZlIHRvIHJlcGVhdCBmb3Igc28gbWFueSBlbGVtZW50cy5cbiAgICAvLyBMZXQncyBqdXN0IGFwcGVuZCB0aGVtIGFsbCB0byB0aGlzLmFyciBhbmQgcmVzb3J0LlxuICAgIHRoaXMubWFzc0luc2VydChhcmd1bWVudHMpO1xuICB9IGVsc2Uge1xuICAgIEFycmF5LnByb3RvdHlwZS5mb3JFYWNoLmNhbGwoYXJndW1lbnRzLCBmdW5jdGlvbih2YWwpIHtcbiAgICAgIHZhciBwb3MgPSB0aGlzLmJzZWFyY2godmFsKTtcbiAgICAgIGlmICh0aGlzLmZpbHRlcih2YWwsIHBvcykpIHtcbiAgICAgICAgdGhpcy5hcnIuc3BsaWNlKHBvcysxLCAwLCB2YWwpO1xuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICB9XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5maWx0ZXIgPSBmdW5jdGlvbih2YWwsIHBvcykge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmFkZCA9IFNvcnRlZExpc3QucHJvdG90eXBlLmluc2VydDtcblxuU29ydGVkTGlzdC5wcm90b3R5cGVbXCJkZWxldGVcIl0gPSBmdW5jdGlvbihwb3MpIHtcbiAgdGhpcy5hcnIuc3BsaWNlKHBvcywgMSk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5yZW1vdmUgPSBTb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc1JlbW92ZSA9IGZ1bmN0aW9uKHN0YXJ0UG9zLCBjb3VudCkge1xuICB0aGlzLmFyci5zcGxpY2Uoc3RhcnRQb3MsIGNvdW50KTtcbn07XG5cbi8qKlxuICogZGVmYXVsdCBjb21wYXJlIGZ1bmN0aW9ucyBcbiAqKi9cblNvcnRlZExpc3QuY29tcGFyZSA9IHtcbiAgXCJudW1iZXJcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBjID0gYSAtIGI7XG4gICAgcmV0dXJuIChjID4gMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICB9LFxuXG4gIFwic3RyaW5nXCI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gKGEgPiBiKSA/IDEgOiAoYSA9PSBiKSAgPyAwIDogLTE7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmNvbXBhcmUgPSBTb3J0ZWRMaXN0LmNvbXBhcmVbXCJudW1iZXJcIl07XG5cbmV4cG9ydHMuU29ydGVkTGlzdCA9IFNvcnRlZExpc3Q7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCJ2YXIgXyA9IHJlcXVpcmUoJy4uLy4uLy4uL3VuZGVyc2NvcmUubWluLmpzJyk7XG5cbi8vIFBhcnNlIGEgdHJhY2sgZGVjbGFyYXRpb24gbGluZSwgd2hpY2ggaXMgaW4gdGhlIGZvcm1hdCBvZjpcbi8vIHRyYWNrIG5hbWU9XCJibGFoXCIgb3B0bmFtZTE9XCJ2YWx1ZTFcIiBvcHRuYW1lMj1cInZhbHVlMlwiIC4uLlxuLy8gaW50byBhIGhhc2ggb2Ygb3B0aW9uc1xubW9kdWxlLmV4cG9ydHMucGFyc2VEZWNsYXJhdGlvbkxpbmUgPSBmdW5jdGlvbihsaW5lLCBzdGFydCkge1xuICB2YXIgb3B0cyA9IHt9LCBvcHRuYW1lID0gJycsIHZhbHVlID0gJycsIHN0YXRlID0gJ29wdG5hbWUnO1xuICBmdW5jdGlvbiBwdXNoVmFsdWUocXVvdGluZykge1xuICAgIHN0YXRlID0gJ29wdG5hbWUnO1xuICAgIG9wdHNbb3B0bmFtZS5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyldID0gdmFsdWU7XG4gICAgb3B0bmFtZSA9IHZhbHVlID0gJyc7XG4gIH1cbiAgZm9yIChpID0gbGluZS5tYXRjaChzdGFydClbMF0ubGVuZ3RoOyBpIDwgbGluZS5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBsaW5lW2ldO1xuICAgIGlmIChzdGF0ZSA9PSAnb3B0bmFtZScpIHtcbiAgICAgIGlmIChjID09ICc9JykgeyBzdGF0ZSA9ICdzdGFydHZhbHVlJzsgfVxuICAgICAgZWxzZSB7IG9wdG5hbWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gJ3N0YXJ0dmFsdWUnKSB7XG4gICAgICBpZiAoLyd8XCIvLnRlc3QoYykpIHsgc3RhdGUgPSBjOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgc3RhdGUgPSAndmFsdWUnOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAndmFsdWUnKSB7XG4gICAgICBpZiAoL1xccy8udGVzdChjKSkgeyBwdXNoVmFsdWUoKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9IGVsc2UgaWYgKC8nfFwiLy50ZXN0KHN0YXRlKSkge1xuICAgICAgaWYgKGMgPT0gc3RhdGUpIHsgcHVzaFZhbHVlKHN0YXRlKTsgfVxuICAgICAgZWxzZSB7IHZhbHVlICs9IGM7IH1cbiAgICB9XG4gIH1cbiAgaWYgKHN0YXRlID09ICd2YWx1ZScpIHsgcHVzaFZhbHVlKCk7IH1cbiAgaWYgKHN0YXRlICE9ICdvcHRuYW1lJykgeyByZXR1cm4gZmFsc2U7IH1cbiAgcmV0dXJuIG9wdHM7XG59XG5cbi8vIENvbnN0cnVjdHMgYSBtYXBwaW5nIGZ1bmN0aW9uIHRoYXQgY29udmVydHMgYnAgaW50ZXJ2YWxzIGludG8gcGl4ZWwgaW50ZXJ2YWxzLCB3aXRoIG9wdGlvbmFsIGNhbGN1bGF0aW9ucyBmb3IgdGV4dCB0b29cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsQ2FsY3VsYXRvciA9IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCwgd2l0aFRleHQsIG5hbWVGdW5jLCBzdGFydGtleSwgZW5ka2V5KSB7XG4gIGlmICghXy5pc0Z1bmN0aW9uKG5hbWVGdW5jKSkgeyBuYW1lRnVuYyA9IGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQubmFtZSB8fCAnJzsgfTsgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChzdGFydGtleSkpIHsgc3RhcnRrZXkgPSAnc3RhcnQnOyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKGVuZGtleSkpIHsgZW5ka2V5ID0gJ2VuZCc7IH1cbiAgcmV0dXJuIGZ1bmN0aW9uKGQpIHtcbiAgICB2YXIgaXR2bFN0YXJ0ID0gXy5pc1VuZGVmaW5lZChkW3N0YXJ0a2V5XSkgPyBkLnN0YXJ0IDogZFtzdGFydGtleV0sXG4gICAgICBpdHZsRW5kID0gXy5pc1VuZGVmaW5lZChkW2VuZGtleV0pID8gZC5lbmQgOiBkW2VuZGtleV07XG4gICAgdmFyIHBJbnQgPSB7XG4gICAgICB4OiBNYXRoLnJvdW5kKChpdHZsU3RhcnQgLSBzdGFydCkgLyBicHBwKSxcbiAgICAgIHc6IE1hdGgucm91bmQoKGl0dmxFbmQgLSBpdHZsU3RhcnQpIC8gYnBwcCkgKyAxLFxuICAgICAgdDogMCwgICAgICAgICAgLy8gY2FsY3VsYXRlZCB3aWR0aCBvZiB0ZXh0XG4gICAgICBvUHJldjogZmFsc2UsICAvLyBvdmVyZmxvd3MgaW50byBwcmV2aW91cyB0aWxlP1xuICAgICAgb05leHQ6IGZhbHNlICAgLy8gb3ZlcmZsb3dzIGludG8gbmV4dCB0aWxlP1xuICAgIH07XG4gICAgcEludC50eCA9IHBJbnQueDtcbiAgICBwSW50LnR3ID0gcEludC53O1xuICAgIGlmIChwSW50LnggPCAwKSB7IHBJbnQudyArPSBwSW50Lng7IHBJbnQueCA9IDA7IHBJbnQub1ByZXYgPSB0cnVlOyB9XG4gICAgZWxzZSBpZiAod2l0aFRleHQpIHsgXG4gICAgICBwSW50LnQgPSBNYXRoLm1pbihuYW1lRnVuYyhkKS5sZW5ndGggKiAxMCArIDIsIHBJbnQueCk7XG4gICAgICBwSW50LnR4IC09IHBJbnQudDtcbiAgICAgIHBJbnQudHcgKz0gcEludC50OyAgXG4gICAgfVxuICAgIGlmIChwSW50LnggKyBwSW50LncgPiB3aWR0aCkgeyBwSW50LncgPSB3aWR0aCAtIHBJbnQueDsgcEludC5vTmV4dCA9IHRydWU7IH1cbiAgICByZXR1cm4gcEludDtcbiAgfTtcbn07XG5cbi8vIEZvciB0d28gZ2l2ZW4gb2JqZWN0cyBvZiB0aGUgZm9ybSB7eDogMSwgdzogMn0gKHBpeGVsIGludGVydmFscyksIGRlc2NyaWJlIHRoZSBvdmVybGFwLlxuLy8gUmV0dXJucyBudWxsIGlmIHRoZXJlIGlzIG5vIG92ZXJsYXAuXG5tb2R1bGUuZXhwb3J0cy5waXhJbnRlcnZhbE92ZXJsYXAgPSBmdW5jdGlvbihwSW50MSwgcEludDIpIHtcbiAgdmFyIG92ZXJsYXAgPSB7fSxcbiAgICB0bXA7XG4gIGlmIChwSW50MS54ID4gcEludDIueCkgeyB0bXAgPSBwSW50MjsgcEludDIgPSBwSW50MTsgcEludDEgPSB0bXA7IH0gICAgICAgLy8gc3dhcCBzbyB0aGF0IHBJbnQxIGlzIGFsd2F5cyBsb3dlclxuICBpZiAoIXBJbnQxLncgfHwgIXBJbnQyLncgfHwgcEludDEueCArIHBJbnQxLncgPCBwSW50Mi54KSB7IHJldHVybiBudWxsOyB9IC8vIGRldGVjdCBuby1vdmVybGFwIGNvbmRpdGlvbnNcbiAgb3ZlcmxhcC54ID0gcEludDIueDtcbiAgb3ZlcmxhcC53ID0gTWF0aC5taW4ocEludDEudyAtIHBJbnQyLnggKyBwSW50MS54LCBwSW50Mi53KTtcbiAgcmV0dXJuIG92ZXJsYXA7XG59O1xuXG4vLyBDb21tb24gZnVuY3Rpb25zIGZvciBzdW1tYXJpemluZyBkYXRhIGluIGJpbnMgd2hpbGUgcGxvdHRpbmcgd2lnZ2xlIHRyYWNrc1xubW9kdWxlLmV4cG9ydHMud2lnQmluRnVuY3Rpb25zID0ge1xuICBtaW5pbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1pbi5hcHBseShNYXRoLCBiaW4pIDogMDsgfSxcbiAgbWVhbjogZnVuY3Rpb24oYmluKSB7IHJldHVybiBfLnJlZHVjZShiaW4sIGZ1bmN0aW9uKGEsYikgeyByZXR1cm4gYSArIGI7IH0sIDApIC8gYmluLmxlbmd0aDsgfSxcbiAgbWF4aW11bTogZnVuY3Rpb24oYmluKSB7IHJldHVybiBiaW4ubGVuZ3RoID8gTWF0aC5tYXguYXBwbHkoTWF0aCwgYmluKSA6IDA7IH1cbn07XG5cbi8vIEZhc3RlciB0aGFuIE1hdGguZmxvb3IgKGh0dHA6Ly93ZWJkb29kLmNvbS8/cD0yMTkpXG5tb2R1bGUuZXhwb3J0cy5mbG9vckhhY2sgPSBmdW5jdGlvbihudW0pIHsgcmV0dXJuIChudW0gPDwgMCkgLSAobnVtIDwgMCA/IDEgOiAwKTsgfVxuXG4vLyBPdGhlciB0aW55IGZ1bmN0aW9ucyB0aGF0IHdlIG5lZWQgZm9yIG9kZHMgYW5kIGVuZHMuLi5cbm1vZHVsZS5leHBvcnRzLnN0cmlwID0gZnVuY3Rpb24oc3RyKSB7IHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpOyB9XG5tb2R1bGUuZXhwb3J0cy5wYXJzZUludDEwID0gZnVuY3Rpb24odmFsKSB7IHJldHVybiBwYXJzZUludCh2YWwsIDEwKTsgfSIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IHZjZlRhYml4IGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvdmNmLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMudmNmdGFiaXhcbnZhciBWY2ZUYWJpeEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBwcmlvcml0eTogMTAwLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogNTAwLCBwYWNrOiAxMDB9LFxuICAgIG1heEZldGNoV2luZG93OiAxMDAwMDAsXG4gICAgY2hyb21vc29tZXM6ICcnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciB2Y2ZUYWJpeCB0cmFjayBhdCBcIiArIEpTT04uc3RyaW5naWZ5KHRoaXMub3B0cykgKyAodGhpcy5vcHRzLmxpbmVOdW0gKyAxKSk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmhlaWdodHMgPSB7bWF4OiBudWxsLCBtaW46IDE1LCBzdGFydDogMTV9O1xuICAgIHNlbGYuc2l6ZXMgPSBbJ2RlbnNlJywgJ3NxdWlzaCcsICdwYWNrJ107XG4gICAgc2VsZi5tYXBTaXplcyA9IFsncGFjayddO1xuICAgIC8vIFRPRE86IFNldCBtYXhGZXRjaFdpbmRvdyB1c2luZyBzb21lIGhldXJpc3RpYyBiYXNlZCBvbiBob3cgbWFueSBpdGVtcyBhcmUgaW4gdGhlIHRhYml4IGluZGV4XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGRhdGEgPSBzZWxmLmRhdGEsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHdpZHRoLFxuICAgICAgcmFuZ2UgPSB0aGlzLmNoclJhbmdlKHN0YXJ0LCBlbmQpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVUb0ludGVydmFsKGxpbmUpIHtcbiAgICAgIHZhciBmaWVsZHMgPSBsaW5lLnNwbGl0KCdcXHQnKSwgZGF0YSA9IHt9LCBpbmZvID0ge307XG4gICAgICBpZiAoZmllbGRzWzddKSB7XG4gICAgICAgIF8uZWFjaChmaWVsZHNbN10uc3BsaXQoJzsnKSwgZnVuY3Rpb24obCkgeyBsID0gbC5zcGxpdCgnPScpOyBpZiAobC5sZW5ndGggPiAxKSB7IGluZm9bbFswXV0gPSBsWzFdOyB9IH0pO1xuICAgICAgfVxuICAgICAgZGF0YS5zdGFydCA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW2ZpZWxkc1swXV0gKyBwYXJzZUludDEwKGZpZWxkc1sxXSk7XG4gICAgICBkYXRhLmlkID0gZmllbGRzWzJdPT0nLicgPyAndmNmLScgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAxMDAwMDAwMDApIDogZmllbGRzWzJdO1xuICAgICAgZGF0YS5lbmQgPSBkYXRhLnN0YXJ0ICsgMTtcbiAgICAgIGRhdGEucmVmID0gZmllbGRzWzNdO1xuICAgICAgZGF0YS5hbHQgPSBmaWVsZHNbNF07XG4gICAgICBkYXRhLnF1YWwgPSBwYXJzZUZsb2F0KGZpZWxkc1s1XSk7XG4gICAgICBkYXRhLmluZm8gPSBpbmZvO1xuICAgICAgcmV0dXJuIHtkYXRhOiBkYXRhfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbmFtZUZ1bmMoZmllbGRzKSB7XG4gICAgICB2YXIgcmVmID0gZmllbGRzLnJlZiB8fCAnJyxcbiAgICAgICAgYWx0ID0gZmllbGRzLmFsdCB8fCAnJztcbiAgICAgIHJldHVybiAocmVmLmxlbmd0aCA+IGFsdC5sZW5ndGggPyByZWYgOiBhbHQpIHx8ICcnO1xuICAgIH1cbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBbXSxcbiAgICAgICAgbGluZXMgPSBfLmZpbHRlcihkYXRhLnNwbGl0KCdcXG4nKSwgZnVuY3Rpb24obCkgeyB2YXIgbSA9IGwubWF0Y2goL1xcdC9nKTsgcmV0dXJuIG0gJiYgbS5sZW5ndGggPiA4OyB9KSxcbiAgICAgICAgY2FsY1BpeEludGVydmFsID0gbmV3IHV0aWxzLnBpeEludGVydmFsQ2FsY3VsYXRvcihzdGFydCwgd2lkdGgsIGJwcHAsIGRlbnNpdHk9PSdwYWNrJywgbmFtZUZ1bmMpO1xuICAgICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICBkcmF3U3BlYy5wdXNoKGNhbGNQaXhJbnRlcnZhbChsaW5lVG9JbnRlcnZhbChsaW5lKS5kYXRhKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZHJhd1NwZWMgPSB7bGF5b3V0OiBzZWxmLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQoXy5tYXAobGluZXMsIGxpbmVUb0ludGVydmFsKSwgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbCl9O1xuICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgIH1cbiAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCB0b28gbXVjaCBkYXRhLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICAvLyBUT0RPOiBjYWNoZSByZXN1bHRzIHNvIHdlIGFyZW4ndCByZWZldGNoaW5nIHRoZSBzYW1lIHJlZ2lvbnMgb3ZlciBhbmQgb3ZlciBhZ2Fpbi5cbiAgICBpZiAoKGVuZCAtIHN0YXJ0KSA+IHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgJC5hamF4KHRoaXMuYWpheERpcigpICsgJ3RhYml4LnBocCcsIHtcbiAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiB0aGlzLm9wdHMuYmlnRGF0YVVybH0sXG4gICAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyksXG4gICAgICB1cmxUZW1wbGF0ZSA9IHRoaXMub3B0cy51cmwgPyB0aGlzLm9wdHMudXJsIDogJ2phdmFzY3JpcHQ6dm9pZChcIicrdGhpcy5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAyNyA6IDYsXG4gICAgICBjb2xvcnMgPSB7YTonMjU1LDAsMCcsIHQ6JzI1NSwwLDI1NScsIGM6JzAsMCwyNTUnLCBnOicwLDI1NSwwJ30sXG4gICAgICBkcmF3TGltaXQgPSB0aGlzLm9wdHMuZHJhd0xpbWl0ICYmIHRoaXMub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snKSB7IGFyZWFzID0gdGhpcy5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgdGhpcy5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiBjYW52YXMud2lkdGh9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgaWYgKChkcmF3TGltaXQgJiYgZHJhd1NwZWMubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgIH0gZWxzZSBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSAxNTtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLCBmdW5jdGlvbihwSW50KSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgMSwgcEludC53LCAxMyk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgXy5lYWNoKGwsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBhbHRDb2xvciwgcmVmQ29sb3I7XG4gICAgICAgICAgICBpZiAoYXJlYXMpIHtcbiAgICAgICAgICAgICAgcmVmQ29sb3IgPSBjb2xvcnNbZGF0YS5kLnJlZi50b0xvd2VyQ2FzZSgpXSB8fCAnMjU1LDAsMCc7XG4gICAgICAgICAgICAgIGFsdENvbG9yID0gY29sb3JzW2RhdGEuZC5hbHQudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIgKyBhbHRDb2xvciArIFwiKVwiOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIDEpO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIGFyZWFzLnB1c2goW1xuICAgICAgICAgICAgICAgIGRhdGEucEludC54LCBpICogbGluZUhlaWdodCArIDEsIGRhdGEucEludC54ICsgZGF0YS5wSW50LncsIChpICsgMSkgKiBsaW5lSGVpZ2h0LCAvL3gxLCB4MiwgeTEsIHkyXG4gICAgICAgICAgICAgICAgZGF0YS5kLnJlZiArICcgPiAnICsgZGF0YS5kLmFsdCwgLy8gdGl0bGVcbiAgICAgICAgICAgICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIGRhdGEuZC5pZCksIC8vIGhyZWZcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQub1ByZXYsIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICAgICAgICAgICAgYWx0Q29sb3IsIC8vIGxhYmVsIGNvbG9yXG4gICAgICAgICAgICAgICAgJzxzcGFuIHN0eWxlPVwiY29sb3I6IHJnYignICsgcmVmQ29sb3IgKyAnKVwiPicgKyBkYXRhLmQucmVmICsgJzwvc3Bhbj48YnIvPicgKyBkYXRhLmQuYWx0LCAvLyBsYWJlbFxuICAgICAgICAgICAgICAgIGRhdGEuZC5pbmZvXG4gICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBWY2ZUYWJpeEZvcm1hdDtcblxuIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IFdJRyBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3dpZ2dsZS5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHBhcnNlSW50MTAgPSB1dGlscy5wYXJzZUludDEwLFxuICBwYXJzZURlY2xhcmF0aW9uTGluZSA9IHV0aWxzLnBhcnNlRGVjbGFyYXRpb25MaW5lO1xudmFyIFNvcnRlZExpc3QgPSByZXF1aXJlKCcuL3V0aWxzL1NvcnRlZExpc3QuanMnKS5Tb3J0ZWRMaXN0O1xuXG4vLyBJbnRlbmRlZCB0byBiZSBsb2FkZWQgaW50byBDdXN0b21UcmFjay50eXBlcy53aWdnbGVfMFxudmFyIFdpZ2dsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHV0aWxzLndpZ0JpbkZ1bmN0aW9ucyxcbiAgXG4gIGluaXRPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIF9iaW5GdW5jdGlvbnMgPSB0aGlzLnR5cGUoKS5fYmluRnVuY3Rpb25zO1xuICAgIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpKSB7IG8uYWx0Q29sb3IgPSAnJzsgfVxuICAgIG8udmlld0xpbWl0cyA9IF8ubWFwKG8udmlld0xpbWl0cy5zcGxpdCgnOicpLCBwYXJzZUZsb2F0KTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IF8ubWFwKG8ubWF4SGVpZ2h0UGl4ZWxzLnNwbGl0KCc6JyksIHBhcnNlSW50MTApO1xuICAgIG8ueUxpbmVPbk9mZiA9IHRoaXMuaXNPbihvLnlMaW5lT25PZmYpO1xuICAgIG8ueUxpbmVNYXJrID0gcGFyc2VGbG9hdChvLnlMaW5lTWFyayk7XG4gICAgby5hdXRvU2NhbGUgPSB0aGlzLmlzT24oby5hdXRvU2NhbGUpO1xuICAgIGlmIChfYmluRnVuY3Rpb25zICYmICFfYmluRnVuY3Rpb25zW28ud2luZG93aW5nRnVuY3Rpb25dKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHdpbmRvd2luZ0Z1bmN0aW9uIGF0IGxpbmUgXCIgKyBvLmxpbmVOdW0pOyBcbiAgICB9XG4gICAgaWYgKF8uaXNOYU4oby55TGluZU1hcmspKSB7IG8ueUxpbmVNYXJrID0gMC4wOyB9XG4gIH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHM7XG4gICAgc2VsZi5kcmF3UmFuZ2UgPSBvLmF1dG9TY2FsZSB8fCBvLnZpZXdMaW1pdHMubGVuZ3RoIDwgMiA/IHNlbGYucmFuZ2UgOiBvLnZpZXdMaW1pdHM7XG4gICAgXy5lYWNoKHttYXg6IDAsIG1pbjogMiwgc3RhcnQ6IDF9LCBmdW5jdGlvbih2LCBrKSB7IHNlbGYuaGVpZ2h0c1trXSA9IG8ubWF4SGVpZ2h0UGl4ZWxzW3ZdOyB9KTtcbiAgICBpZiAoIW8uYWx0Q29sb3IpIHtcbiAgICAgIHZhciBoc2wgPSB0aGlzLnJnYlRvSHNsLmFwcGx5KHRoaXMsIG8uY29sb3Iuc3BsaXQoLyxcXHMqL2cpKTtcbiAgICAgIGhzbFswXSA9IGhzbFswXSArIDAuMDIgJSAxO1xuICAgICAgaHNsWzFdID0gaHNsWzFdICogMC43O1xuICAgICAgaHNsWzJdID0gMSAtICgxIC0gaHNsWzJdKSAqIDAuNztcbiAgICAgIHNlbGYuYWx0Q29sb3IgPSBfLm1hcCh0aGlzLmhzbFRvUmdiLmFwcGx5KHRoaXMsIGhzbCksIHBhcnNlSW50MTApLmpvaW4oJywnKTtcbiAgICB9XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIHZhbCwgc3RhcnQ7XG4gICAgICBcbiAgICAgIG0gPSBsaW5lLm1hdGNoKC9eKHZhcmlhYmxlfGZpeGVkKVN0ZXBcXHMrL2kpO1xuICAgICAgaWYgKG0pIHtcbiAgICAgICAgbW9kZSA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgbW9kZU9wdHMgPSBwYXJzZURlY2xhcmF0aW9uTGluZShsaW5lLCAvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgICAgbW9kZU9wdHMuc3RhcnQgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0YXJ0KTtcbiAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJyAmJiAoXy5pc05hTihtb2RlT3B0cy5zdGFydCkgfHwgIW1vZGVPcHRzLnN0YXJ0KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0YXJ0IHBhcmFtZXRlclwiKTsgXG4gICAgICAgIH1cbiAgICAgICAgbW9kZU9wdHMuc3RlcCA9IHBhcnNlSW50MTAobW9kZU9wdHMuc3RlcCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RlcCkgfHwgIW1vZGVPcHRzLnN0ZXApKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZml4ZWRTdGVwIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIHJlcXVpcmUgbm9uLXplcm8gc3RlcCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnNwYW4gPSBwYXJzZUludDEwKG1vZGVPcHRzLnNwYW4pIHx8IDE7XG4gICAgICAgIGNoclBvcyA9IHNlbGYuYnJvd3Nlck9wdHMuY2hyUG9zW21vZGVPcHRzLmNocm9tXTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICAgIHNlbGYud2FybihcIkludmFsaWQgY2hyb21vc29tZSBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIW1vZGUpIHsgXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV2lnZ2xlIGZvcm1hdCBhdCBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgaGFzIG5vIHByZWNlZGluZyBtb2RlIGRlY2xhcmF0aW9uXCIpOyBcbiAgICAgICAgfSBlbHNlIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICAvLyBpbnZhbGlkIGNocm9tb3NvbWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnKSB7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmUpO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0LCBlbmQ6IGNoclBvcyArIG1vZGVPcHRzLnN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICAgIG1vZGVPcHRzLnN0YXJ0ICs9IG1vZGVPcHRzLnN0ZXA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmUgPSBsaW5lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgICAgICBpZiAobGluZS5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlhYmxlU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlcyB0d28gdmFsdWVzIHBlciBsaW5lXCIpOyBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChsaW5lWzBdKTtcbiAgICAgICAgICAgIHZhbCA9IHBhcnNlRmxvYXQobGluZVsxXSk7XG4gICAgICAgICAgICBkYXRhLmFsbC5wdXNoKHtzdGFydDogY2hyUG9zICsgc3RhcnQsIGVuZDogY2hyUG9zICsgc3RhcnQgKyBtb2RlT3B0cy5zcGFuLCB2YWw6IHZhbH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBzZWxmLnR5cGUoKS5maW5pc2hQYXJzZS5jYWxsKHNlbGYsIGRhdGEpO1xuICB9LFxuICBcbiAgZmluaXNoUGFyc2U6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBiaW5GdW5jdGlvbiA9IHNlbGYudHlwZSgpLl9iaW5GdW5jdGlvbnNbc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uXTtcbiAgICBpZiAoZGF0YS5hbGwubGVuZ3RoID4gMCkge1xuICAgICAgc2VsZi5yYW5nZVswXSA9IF8ubWluKGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgICAgc2VsZi5yYW5nZVsxXSA9IF8ubWF4KGRhdGEuYWxsLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnZhbDsgfSkudmFsO1xuICAgIH1cbiAgICBkYXRhLmFsbCA9IG5ldyBTb3J0ZWRMaXN0KGRhdGEuYWxsLCB7XG4gICAgICBjb21wYXJlOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhID09PSBudWxsKSByZXR1cm4gLTE7XG4gICAgICAgIGlmIChiID09PSBudWxsKSByZXR1cm4gIDE7XG4gICAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09PSAwKSAgPyAwIDogLTE7XG4gICAgICB9XG4gICAgfSk7XG4gIFxuICAgIC8vIFByZS1vcHRpbWl6ZSBkYXRhIGZvciBoaWdoIGJwcHBzIGJ5IGRvd25zYW1wbGluZ1xuICAgIF8uZWFjaChzZWxmLmJyb3dzZXJPcHRzLmJwcHBzLCBmdW5jdGlvbihicHBwKSB7XG4gICAgICBpZiAoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gYnBwcCA+IDEwMDAwMDApIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgcGl4TGVuID0gTWF0aC5jZWlsKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHApLFxuICAgICAgICBkb3duc2FtcGxlZERhdGEgPSAoZGF0YVticHBwXSA9IChnbG9iYWwuRmxvYXQzMkFycmF5ID8gbmV3IEZsb2F0MzJBcnJheShwaXhMZW4pIDogbmV3IEFycmF5KHBpeExlbikpKSxcbiAgICAgICAgaiA9IDAsXG4gICAgICAgIGN1cnIgPSBkYXRhLmFsbC5nZXQoMCksXG4gICAgICAgIGJpbiwgbmV4dDtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGl4TGVuOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5zdGFydCA8PSBpICogYnBwcCAmJiBjdXJyLmVuZCA+IGkgKiBicHBwKSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICYmIG5leHQuZW5kID4gaSAqIGJwcHApIHsgXG4gICAgICAgICAgYmluLnB1c2gobmV4dC52YWwpOyArK2o7IGN1cnIgPSBuZXh0OyBcbiAgICAgICAgfVxuICAgICAgICBkb3duc2FtcGxlZERhdGFbaV0gPSBiaW5GdW5jdGlvbihiaW4pO1xuICAgICAgfVxuICAgICAgZGF0YS5fYmluRnVuY3Rpb24gPSBzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb247XG4gICAgfSk7XG4gICAgc2VsZi5kYXRhID0gZGF0YTtcbiAgICBzZWxmLnN0cmV0Y2hIZWlnaHQgPSB0cnVlO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7IC8vIHN1Y2Nlc3MhXG4gIH0sXG4gIFxuICBpbml0RHJhd1NwZWM6IGZ1bmN0aW9uKHByZWNhbGMpIHtcbiAgICB2YXIgdlNjYWxlID0gKHRoaXMuZHJhd1JhbmdlWzFdIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gcHJlY2FsYy5oZWlnaHQsXG4gICAgICBkcmF3U3BlYyA9IHtcbiAgICAgICAgYmFyczogW10sXG4gICAgICAgIHZTY2FsZTogdlNjYWxlLFxuICAgICAgICB5TGluZTogdGhpcy5pc09uKHRoaXMub3B0cy55TGluZU9uT2ZmKSA/IE1hdGgucm91bmQoKHRoaXMub3B0cy55TGluZU1hcmsgLSB0aGlzLmRyYXdSYW5nZVswXSkgLyB2U2NhbGUpIDogbnVsbCwgXG4gICAgICAgIHplcm9MaW5lOiAtdGhpcy5kcmF3UmFuZ2VbMF0gLyB2U2NhbGVcbiAgICAgIH07XG4gICAgcmV0dXJuIGRyYXdTcGVjO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBicHBwID0gKGVuZCAtIHN0YXJ0KSAvIHByZWNhbGMud2lkdGgsXG4gICAgICBkcmF3U3BlYyA9IHNlbGYudHlwZSgpLmluaXREcmF3U3BlYy5jYWxsKHNlbGYsIHByZWNhbGMpLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl0sXG4gICAgICBkb3duc2FtcGxlZERhdGE7XG4gICAgaWYgKHNlbGYuZGF0YS5fYmluRnVuY3Rpb24gPT0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uICYmIChkb3duc2FtcGxlZERhdGEgPSBzZWxmLmRhdGFbYnBwcF0pKSB7XG4gICAgICAvLyBXZSd2ZSBhbHJlYWR5IHByZS1vcHRpbWl6ZWQgZm9yIHRoaXMgYnBwcFxuICAgICAgZHJhd1NwZWMuYmFycyA9IF8ubWFwKF8ucmFuZ2UoKHN0YXJ0IC0gMSkgLyBicHBwLCAoZW5kIC0gMSkgLyBicHBwKSwgZnVuY3Rpb24oeEZyb21PcmlnaW4sIHgpIHtcbiAgICAgICAgcmV0dXJuICgoZG93bnNhbXBsZWREYXRhW3hGcm9tT3JpZ2luXSB8fCAwKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBoYXZlIHRvIGRvIHRoZSBiaW5uaW5nIG9uIHRoZSBmbHlcbiAgICAgIHZhciBqID0gc2VsZi5kYXRhLmFsbC5ic2VhcmNoKHtzdGFydDogc3RhcnR9KSxcbiAgICAgICAgY3VyciA9IHNlbGYuZGF0YS5hbGwuZ2V0KGopLCBuZXh0LCBiaW47XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByZWNhbGMud2lkdGg7IGkrKykge1xuICAgICAgICBiaW4gPSBjdXJyICYmIChjdXJyLmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSA/IFtjdXJyLnZhbF0gOiBbXTtcbiAgICAgICAgd2hpbGUgKChuZXh0ID0gc2VsZi5kYXRhLmFsbC5nZXQoaiArIDEpKSAmJiBuZXh0LnN0YXJ0IDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBuZXh0LmVuZCA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZHJhd1NwZWMuYmFycy5wdXNoKChiaW5GdW5jdGlvbihiaW4pIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgPyBjYWxsYmFjayhkcmF3U3BlYykgOiBkcmF3U3BlYztcbiAgfSxcbiAgXG4gIGRyYXdCYXJzOiBmdW5jdGlvbihjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKSB7XG4gICAgdmFyIHplcm9MaW5lID0gZHJhd1NwZWMuemVyb0xpbmUsIC8vIHBpeGVsIHBvc2l0aW9uIG9mIHRoZSBkYXRhIHZhbHVlIDBcbiAgICAgIGNvbG9yID0gXCJyZ2IoXCIrdGhpcy5vcHRzLmNvbG9yK1wiKVwiLFxuICAgICAgYWx0Q29sb3IgPSBcInJnYihcIisodGhpcy5vcHRzLmFsdENvbG9yIHx8IHRoaXMuYWx0Q29sb3IpK1wiKVwiLFxuICAgICAgcG9pbnRHcmFwaCA9IHRoaXMub3B0cy5ncmFwaFR5cGU9PT0ncG9pbnRzJztcbiAgICBcbiAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgXy5lYWNoKGRyYXdTcGVjLmJhcnMsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgZWxzZSBpZiAoZCA+IHplcm9MaW5lKSB7IFxuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgMSk7IH1cbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSBkLCAxLCB6ZXJvTGluZSA+IDAgPyAoZCAtIHplcm9MaW5lKSA6IGQpOyB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gYWx0Q29sb3I7XG4gICAgICAgIGlmIChwb2ludEdyYXBoKSB7IGN0eC5maWxsUmVjdCh4LCB6ZXJvTGluZSAtIGQgLSAxLCAxLCAxKTsgfSBcbiAgICAgICAgZWxzZSB7IGN0eC5maWxsUmVjdCh4LCBoZWlnaHQgLSB6ZXJvTGluZSwgMSwgemVyb0xpbmUgLSBkKTsgfVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY29sb3I7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGRyYXdTcGVjLnlMaW5lICE9PSBudWxsKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMCwwLDApXCI7XG4gICAgICBjdHguZmlsbFJlY3QoMCwgaGVpZ2h0IC0gZHJhd1NwZWMueUxpbmUsIHdpZHRoLCAxKTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgaGVpZ2h0ID0gY2FudmFzLmhlaWdodCxcbiAgICAgIHdpZHRoID0gY2FudmFzLndpZHRoLFxuICAgICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgc2VsZi5wcmVyZW5kZXIoc3RhcnQsIGVuZCwgZGVuc2l0eSwge3dpZHRoOiB3aWR0aCwgaGVpZ2h0OiBoZWlnaHR9LCBmdW5jdGlvbihkcmF3U3BlYykge1xuICAgICAgc2VsZi50eXBlKCkuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIGlmIChfLmlzRnVuY3Rpb24oY2FsbGJhY2spKSB7IGNhbGxiYWNrKCk7IH1cbiAgICB9KTtcbiAgfSxcbiAgXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICAkdmlld0xpbWl0cyA9ICRkaWFsb2cuZmluZCgnLnZpZXctbGltaXRzJyksXG4gICAgICAkbWF4SGVpZ2h0UGl4ZWxzID0gJGRpYWxvZy5maW5kKCcubWF4LWhlaWdodC1waXhlbHMnKSxcbiAgICAgIGFsdENvbG9yT24gPSB0aGlzLnZhbGlkYXRlQ29sb3Ioby5hbHRDb2xvcik7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmF0dHIoJ2NoZWNrZWQnLCBhbHRDb2xvck9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbChhbHRDb2xvck9uID8gby5hbHRDb2xvciA6JzEyOCwxMjgsMTI4JykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuYXR0cignY2hlY2tlZCcsICF0aGlzLmlzT24oby5hdXRvU2NhbGUpKS5jaGFuZ2UoKTtcbiAgICAkdmlld0xpbWl0cy5zbGlkZXIoXCJvcHRpb25cIiwgXCJtaW5cIiwgdGhpcy5yYW5nZVswXSk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWF4XCIsIHRoaXMucmFuZ2VbMV0pO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01pbl0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMF0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0xpbWl0c01heF0nKS52YWwodGhpcy5kcmF3UmFuZ2VbMV0pLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5hdHRyKCdjaGVja2VkJywgdGhpcy5pc09uKG8ueUxpbmVPbk9mZikpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbChvLnlMaW5lTWFyaykuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKG8uZ3JhcGhUeXBlKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXdpbmRvd2luZ0Z1bmN0aW9uXScpLnZhbChvLndpbmRvd2luZ0Z1bmN0aW9uKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmF0dHIoJ2NoZWNrZWQnLCBvLm1heEhlaWdodFBpeGVscy5sZW5ndGggPj0gMyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNaW5dJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzJdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoby5tYXhIZWlnaHRQaXhlbHNbMF0pLmNoYW5nZSgpO1xuICB9LFxuICBcbiAgc2F2ZU9wdHM6IGZ1bmN0aW9uKCRkaWFsb2cpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGFsdENvbG9yT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNPbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBtYXhIZWlnaHRQaXhlbHNNYXggPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01heF0nKS52YWwoKTtcbiAgICBvLmFsdENvbG9yID0gYWx0Q29sb3JPbiA/ICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JdJykudmFsKCkgOiAnJztcbiAgICBvLmF1dG9TY2FsZSA9ICEkZGlhbG9nLmZpbmQoJ1tuYW1lPWF1dG9TY2FsZV0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKCkgKyAnOicgKyAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKCk7XG4gICAgby55TGluZU9uT2ZmID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU9uT2ZmXScpLmlzKCc6Y2hlY2tlZCcpO1xuICAgIG8ueUxpbmVNYXJrID0gJGRpYWxvZy5maW5kKCdbbmFtZT15TGluZU1hcmtdJykudmFsKCk7XG4gICAgby5ncmFwaFR5cGUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPWdyYXBoVHlwZV0nKS52YWwoKTtcbiAgICBvLndpbmRvd2luZ0Z1bmN0aW9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoKTtcbiAgICBvLm1heEhlaWdodFBpeGVscyA9IG1heEhlaWdodFBpeGVsc09uID8gXG4gICAgICBbbWF4SGVpZ2h0UGl4ZWxzTWF4LCBtYXhIZWlnaHRQaXhlbHNNYXgsICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbCgpXS5qb2luKCc6JykgOiAnJztcbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gV2lnZ2xlRm9ybWF0OyIsIi8vIFVuZGVyc2NvcmUuanMgMS4yLjNcbi8vIChjKSAyMDA5LTIwMTEgSmVyZW15IEFzaGtlbmFzLCBEb2N1bWVudENsb3VkIEluYy5cbi8vIFVuZGVyc2NvcmUgaXMgZnJlZWx5IGRpc3RyaWJ1dGFibGUgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuLy8gUG9ydGlvbnMgb2YgVW5kZXJzY29yZSBhcmUgaW5zcGlyZWQgb3IgYm9ycm93ZWQgZnJvbSBQcm90b3R5cGUsXG4vLyBPbGl2ZXIgU3RlZWxlJ3MgRnVuY3Rpb25hbCwgYW5kIEpvaG4gUmVzaWcncyBNaWNyby1UZW1wbGF0aW5nLlxuLy8gRm9yIGFsbCBkZXRhaWxzIGFuZCBkb2N1bWVudGF0aW9uOlxuLy8gaHR0cDovL2RvY3VtZW50Y2xvdWQuZ2l0aHViLmNvbS91bmRlcnNjb3JlXG4oZnVuY3Rpb24oKXtmdW5jdGlvbiByKGEsYyxkKXtpZihhPT09YylyZXR1cm4gYSE9PTB8fDEvYT09MS9jO2lmKGE9PW51bGx8fGM9PW51bGwpcmV0dXJuIGE9PT1jO2lmKGEuX2NoYWluKWE9YS5fd3JhcHBlZDtpZihjLl9jaGFpbiljPWMuX3dyYXBwZWQ7aWYoYS5pc0VxdWFsJiZiLmlzRnVuY3Rpb24oYS5pc0VxdWFsKSlyZXR1cm4gYS5pc0VxdWFsKGMpO2lmKGMuaXNFcXVhbCYmYi5pc0Z1bmN0aW9uKGMuaXNFcXVhbCkpcmV0dXJuIGMuaXNFcXVhbChhKTt2YXIgZT1sLmNhbGwoYSk7aWYoZSE9bC5jYWxsKGMpKXJldHVybiBmYWxzZTtzd2l0Y2goZSl7Y2FzZSBcIltvYmplY3QgU3RyaW5nXVwiOnJldHVybiBhPT1TdHJpbmcoYyk7Y2FzZSBcIltvYmplY3QgTnVtYmVyXVwiOnJldHVybiBhIT0rYT9jIT0rYzphPT0wPzEvYT09MS9jOmE9PStjO2Nhc2UgXCJbb2JqZWN0IERhdGVdXCI6Y2FzZSBcIltvYmplY3QgQm9vbGVhbl1cIjpyZXR1cm4rYT09K2M7Y2FzZSBcIltvYmplY3QgUmVnRXhwXVwiOnJldHVybiBhLnNvdXJjZT09XG5jLnNvdXJjZSYmYS5nbG9iYWw9PWMuZ2xvYmFsJiZhLm11bHRpbGluZT09Yy5tdWx0aWxpbmUmJmEuaWdub3JlQ2FzZT09Yy5pZ25vcmVDYXNlfWlmKHR5cGVvZiBhIT1cIm9iamVjdFwifHx0eXBlb2YgYyE9XCJvYmplY3RcIilyZXR1cm4gZmFsc2U7Zm9yKHZhciBmPWQubGVuZ3RoO2YtLTspaWYoZFtmXT09YSlyZXR1cm4gdHJ1ZTtkLnB1c2goYSk7dmFyIGY9MCxnPXRydWU7aWYoZT09XCJbb2JqZWN0IEFycmF5XVwiKXtpZihmPWEubGVuZ3RoLGc9Zj09Yy5sZW5ndGgpZm9yKDtmLS07KWlmKCEoZz1mIGluIGE9PWYgaW4gYyYmcihhW2ZdLGNbZl0sZCkpKWJyZWFrfWVsc2V7aWYoXCJjb25zdHJ1Y3RvclwiaW4gYSE9XCJjb25zdHJ1Y3RvclwiaW4gY3x8YS5jb25zdHJ1Y3RvciE9Yy5jb25zdHJ1Y3RvcilyZXR1cm4gZmFsc2U7Zm9yKHZhciBoIGluIGEpaWYobS5jYWxsKGEsaCkmJihmKyssIShnPW0uY2FsbChjLGgpJiZyKGFbaF0sY1toXSxkKSkpKWJyZWFrO2lmKGcpe2ZvcihoIGluIGMpaWYobS5jYWxsKGMsXG5oKSYmIWYtLSlicmVhaztnPSFmfX1kLnBvcCgpO3JldHVybiBnfXZhciBzPXRoaXMsRj1zLl8sbz17fSxrPUFycmF5LnByb3RvdHlwZSxwPU9iamVjdC5wcm90b3R5cGUsaT1rLnNsaWNlLEc9ay5jb25jYXQsSD1rLnVuc2hpZnQsbD1wLnRvU3RyaW5nLG09cC5oYXNPd25Qcm9wZXJ0eSx2PWsuZm9yRWFjaCx3PWsubWFwLHg9ay5yZWR1Y2UseT1rLnJlZHVjZVJpZ2h0LHo9ay5maWx0ZXIsQT1rLmV2ZXJ5LEI9ay5zb21lLHE9ay5pbmRleE9mLEM9ay5sYXN0SW5kZXhPZixwPUFycmF5LmlzQXJyYXksST1PYmplY3Qua2V5cyx0PUZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLGI9ZnVuY3Rpb24oYSl7cmV0dXJuIG5ldyBuKGEpfTtpZih0eXBlb2YgZXhwb3J0cyE9PVwidW5kZWZpbmVkXCIpe2lmKHR5cGVvZiBtb2R1bGUhPT1cInVuZGVmaW5lZFwiJiZtb2R1bGUuZXhwb3J0cylleHBvcnRzPW1vZHVsZS5leHBvcnRzPWI7ZXhwb3J0cy5fPWJ9ZWxzZSB0eXBlb2YgZGVmaW5lPT09XCJmdW5jdGlvblwiJiZcbmRlZmluZS5hbWQ/ZGVmaW5lKFwidW5kZXJzY29yZVwiLGZ1bmN0aW9uKCl7cmV0dXJuIGJ9KTpzLl89YjtiLlZFUlNJT049XCIxLjIuM1wiO3ZhciBqPWIuZWFjaD1iLmZvckVhY2g9ZnVuY3Rpb24oYSxjLGIpe2lmKGEhPW51bGwpaWYodiYmYS5mb3JFYWNoPT09dilhLmZvckVhY2goYyxiKTtlbHNlIGlmKGEubGVuZ3RoPT09K2EubGVuZ3RoKWZvcih2YXIgZT0wLGY9YS5sZW5ndGg7ZTxmO2UrKyl7aWYoZSBpbiBhJiZjLmNhbGwoYixhW2VdLGUsYSk9PT1vKWJyZWFrfWVsc2UgZm9yKGUgaW4gYSlpZihtLmNhbGwoYSxlKSYmYy5jYWxsKGIsYVtlXSxlLGEpPT09bylicmVha307Yi5tYXA9ZnVuY3Rpb24oYSxjLGIpe3ZhciBlPVtdO2lmKGE9PW51bGwpcmV0dXJuIGU7aWYodyYmYS5tYXA9PT13KXJldHVybiBhLm1hcChjLGIpO2ooYSxmdW5jdGlvbihhLGcsaCl7ZVtlLmxlbmd0aF09Yy5jYWxsKGIsYSxnLGgpfSk7cmV0dXJuIGV9O2IucmVkdWNlPWIuZm9sZGw9Yi5pbmplY3Q9ZnVuY3Rpb24oYSxcbmMsZCxlKXt2YXIgZj1hcmd1bWVudHMubGVuZ3RoPjI7YT09bnVsbCYmKGE9W10pO2lmKHgmJmEucmVkdWNlPT09eClyZXR1cm4gZSYmKGM9Yi5iaW5kKGMsZSkpLGY/YS5yZWR1Y2UoYyxkKTphLnJlZHVjZShjKTtqKGEsZnVuY3Rpb24oYSxiLGkpe2Y/ZD1jLmNhbGwoZSxkLGEsYixpKTooZD1hLGY9dHJ1ZSl9KTtpZighZil0aHJvdyBuZXcgVHlwZUVycm9yKFwiUmVkdWNlIG9mIGVtcHR5IGFycmF5IHdpdGggbm8gaW5pdGlhbCB2YWx1ZVwiKTtyZXR1cm4gZH07Yi5yZWR1Y2VSaWdodD1iLmZvbGRyPWZ1bmN0aW9uKGEsYyxkLGUpe3ZhciBmPWFyZ3VtZW50cy5sZW5ndGg+MjthPT1udWxsJiYoYT1bXSk7aWYoeSYmYS5yZWR1Y2VSaWdodD09PXkpcmV0dXJuIGUmJihjPWIuYmluZChjLGUpKSxmP2EucmVkdWNlUmlnaHQoYyxkKTphLnJlZHVjZVJpZ2h0KGMpO3ZhciBnPWIudG9BcnJheShhKS5yZXZlcnNlKCk7ZSYmIWYmJihjPWIuYmluZChjLGUpKTtyZXR1cm4gZj9iLnJlZHVjZShnLFxuYyxkLGUpOmIucmVkdWNlKGcsYyl9O2IuZmluZD1iLmRldGVjdD1mdW5jdGlvbihhLGMsYil7dmFyIGU7RChhLGZ1bmN0aW9uKGEsZyxoKXtpZihjLmNhbGwoYixhLGcsaCkpcmV0dXJuIGU9YSx0cnVlfSk7cmV0dXJuIGV9O2IuZmlsdGVyPWIuc2VsZWN0PWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT1bXTtpZihhPT1udWxsKXJldHVybiBlO2lmKHomJmEuZmlsdGVyPT09eilyZXR1cm4gYS5maWx0ZXIoYyxiKTtqKGEsZnVuY3Rpb24oYSxnLGgpe2MuY2FsbChiLGEsZyxoKSYmKGVbZS5sZW5ndGhdPWEpfSk7cmV0dXJuIGV9O2IucmVqZWN0PWZ1bmN0aW9uKGEsYyxiKXt2YXIgZT1bXTtpZihhPT1udWxsKXJldHVybiBlO2ooYSxmdW5jdGlvbihhLGcsaCl7Yy5jYWxsKGIsYSxnLGgpfHwoZVtlLmxlbmd0aF09YSl9KTtyZXR1cm4gZX07Yi5ldmVyeT1iLmFsbD1mdW5jdGlvbihhLGMsYil7dmFyIGU9dHJ1ZTtpZihhPT1udWxsKXJldHVybiBlO2lmKEEmJmEuZXZlcnk9PT1BKXJldHVybiBhLmV2ZXJ5KGMsXG5iKTtqKGEsZnVuY3Rpb24oYSxnLGgpe2lmKCEoZT1lJiZjLmNhbGwoYixhLGcsaCkpKXJldHVybiBvfSk7cmV0dXJuIGV9O3ZhciBEPWIuc29tZT1iLmFueT1mdW5jdGlvbihhLGMsZCl7Y3x8KGM9Yi5pZGVudGl0eSk7dmFyIGU9ZmFsc2U7aWYoYT09bnVsbClyZXR1cm4gZTtpZihCJiZhLnNvbWU9PT1CKXJldHVybiBhLnNvbWUoYyxkKTtqKGEsZnVuY3Rpb24oYSxiLGgpe2lmKGV8fChlPWMuY2FsbChkLGEsYixoKSkpcmV0dXJuIG99KTtyZXR1cm4hIWV9O2IuaW5jbHVkZT1iLmNvbnRhaW5zPWZ1bmN0aW9uKGEsYyl7dmFyIGI9ZmFsc2U7aWYoYT09bnVsbClyZXR1cm4gYjtyZXR1cm4gcSYmYS5pbmRleE9mPT09cT9hLmluZGV4T2YoYykhPS0xOmI9RChhLGZ1bmN0aW9uKGEpe3JldHVybiBhPT09Y30pfTtiLmludm9rZT1mdW5jdGlvbihhLGMpe3ZhciBkPWkuY2FsbChhcmd1bWVudHMsMik7cmV0dXJuIGIubWFwKGEsZnVuY3Rpb24oYSl7cmV0dXJuKGMuY2FsbD9jfHxhOmFbY10pLmFwcGx5KGEsXG5kKX0pfTtiLnBsdWNrPWZ1bmN0aW9uKGEsYyl7cmV0dXJuIGIubWFwKGEsZnVuY3Rpb24oYSl7cmV0dXJuIGFbY119KX07Yi5tYXg9ZnVuY3Rpb24oYSxjLGQpe2lmKCFjJiZiLmlzQXJyYXkoYSkpcmV0dXJuIE1hdGgubWF4LmFwcGx5KE1hdGgsYSk7aWYoIWMmJmIuaXNFbXB0eShhKSlyZXR1cm4tSW5maW5pdHk7dmFyIGU9e2NvbXB1dGVkOi1JbmZpbml0eX07aihhLGZ1bmN0aW9uKGEsYixoKXtiPWM/Yy5jYWxsKGQsYSxiLGgpOmE7Yj49ZS5jb21wdXRlZCYmKGU9e3ZhbHVlOmEsY29tcHV0ZWQ6Yn0pfSk7cmV0dXJuIGUudmFsdWV9O2IubWluPWZ1bmN0aW9uKGEsYyxkKXtpZighYyYmYi5pc0FycmF5KGEpKXJldHVybiBNYXRoLm1pbi5hcHBseShNYXRoLGEpO2lmKCFjJiZiLmlzRW1wdHkoYSkpcmV0dXJuIEluZmluaXR5O3ZhciBlPXtjb21wdXRlZDpJbmZpbml0eX07aihhLGZ1bmN0aW9uKGEsYixoKXtiPWM/Yy5jYWxsKGQsYSxiLGgpOmE7YjxlLmNvbXB1dGVkJiYoZT17dmFsdWU6YSxcbmNvbXB1dGVkOmJ9KX0pO3JldHVybiBlLnZhbHVlfTtiLnNodWZmbGU9ZnVuY3Rpb24oYSl7dmFyIGM9W10sYjtqKGEsZnVuY3Rpb24oYSxmKXtmPT0wP2NbMF09YTooYj1NYXRoLmZsb29yKE1hdGgucmFuZG9tKCkqKGYrMSkpLGNbZl09Y1tiXSxjW2JdPWEpfSk7cmV0dXJuIGN9O2Iuc29ydEJ5PWZ1bmN0aW9uKGEsYyxkKXtyZXR1cm4gYi5wbHVjayhiLm1hcChhLGZ1bmN0aW9uKGEsYixnKXtyZXR1cm57dmFsdWU6YSxjcml0ZXJpYTpjLmNhbGwoZCxhLGIsZyl9fSkuc29ydChmdW5jdGlvbihhLGMpe3ZhciBiPWEuY3JpdGVyaWEsZD1jLmNyaXRlcmlhO3JldHVybiBiPGQ/LTE6Yj5kPzE6MH0pLFwidmFsdWVcIil9O2IuZ3JvdXBCeT1mdW5jdGlvbihhLGMpe3ZhciBkPXt9LGU9Yi5pc0Z1bmN0aW9uKGMpP2M6ZnVuY3Rpb24oYSl7cmV0dXJuIGFbY119O2ooYSxmdW5jdGlvbihhLGIpe3ZhciBjPWUoYSxiKTsoZFtjXXx8KGRbY109W10pKS5wdXNoKGEpfSk7cmV0dXJuIGR9O2Iuc29ydGVkSW5kZXg9XG5mdW5jdGlvbihhLGMsZCl7ZHx8KGQ9Yi5pZGVudGl0eSk7Zm9yKHZhciBlPTAsZj1hLmxlbmd0aDtlPGY7KXt2YXIgZz1lK2Y+PjE7ZChhW2ddKTxkKGMpP2U9ZysxOmY9Z31yZXR1cm4gZX07Yi50b0FycmF5PWZ1bmN0aW9uKGEpe3JldHVybiFhP1tdOmEudG9BcnJheT9hLnRvQXJyYXkoKTpiLmlzQXJyYXkoYSk/aS5jYWxsKGEpOmIuaXNBcmd1bWVudHMoYSk/aS5jYWxsKGEpOmIudmFsdWVzKGEpfTtiLnNpemU9ZnVuY3Rpb24oYSl7cmV0dXJuIGIudG9BcnJheShhKS5sZW5ndGh9O2IuZmlyc3Q9Yi5oZWFkPWZ1bmN0aW9uKGEsYixkKXtyZXR1cm4gYiE9bnVsbCYmIWQ/aS5jYWxsKGEsMCxiKTphWzBdfTtiLmluaXRpYWw9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBpLmNhbGwoYSwwLGEubGVuZ3RoLShiPT1udWxsfHxkPzE6YikpfTtiLmxhc3Q9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBiIT1udWxsJiYhZD9pLmNhbGwoYSxNYXRoLm1heChhLmxlbmd0aC1iLDApKTphW2EubGVuZ3RoLVxuMV19O2IucmVzdD1iLnRhaWw9ZnVuY3Rpb24oYSxiLGQpe3JldHVybiBpLmNhbGwoYSxiPT1udWxsfHxkPzE6Yil9O2IuY29tcGFjdD1mdW5jdGlvbihhKXtyZXR1cm4gYi5maWx0ZXIoYSxmdW5jdGlvbihhKXtyZXR1cm4hIWF9KX07Yi5mbGF0dGVuPWZ1bmN0aW9uKGEsYyl7cmV0dXJuIGIucmVkdWNlKGEsZnVuY3Rpb24oYSxlKXtpZihiLmlzQXJyYXkoZSkpcmV0dXJuIGEuY29uY2F0KGM/ZTpiLmZsYXR0ZW4oZSkpO2FbYS5sZW5ndGhdPWU7cmV0dXJuIGF9LFtdKX07Yi53aXRob3V0PWZ1bmN0aW9uKGEpe3JldHVybiBiLmRpZmZlcmVuY2UoYSxpLmNhbGwoYXJndW1lbnRzLDEpKX07Yi51bmlxPWIudW5pcXVlPWZ1bmN0aW9uKGEsYyxkKXt2YXIgZD1kP2IubWFwKGEsZCk6YSxlPVtdO2IucmVkdWNlKGQsZnVuY3Rpb24oZCxnLGgpe2lmKDA9PWh8fChjPT09dHJ1ZT9iLmxhc3QoZCkhPWc6IWIuaW5jbHVkZShkLGcpKSlkW2QubGVuZ3RoXT1nLGVbZS5sZW5ndGhdPWFbaF07cmV0dXJuIGR9LFxuW10pO3JldHVybiBlfTtiLnVuaW9uPWZ1bmN0aW9uKCl7cmV0dXJuIGIudW5pcShiLmZsYXR0ZW4oYXJndW1lbnRzLHRydWUpKX07Yi5pbnRlcnNlY3Rpb249Yi5pbnRlcnNlY3Q9ZnVuY3Rpb24oYSl7dmFyIGM9aS5jYWxsKGFyZ3VtZW50cywxKTtyZXR1cm4gYi5maWx0ZXIoYi51bmlxKGEpLGZ1bmN0aW9uKGEpe3JldHVybiBiLmV2ZXJ5KGMsZnVuY3Rpb24oYyl7cmV0dXJuIGIuaW5kZXhPZihjLGEpPj0wfSl9KX07Yi5kaWZmZXJlbmNlPWZ1bmN0aW9uKGEpe3ZhciBjPWIuZmxhdHRlbihpLmNhbGwoYXJndW1lbnRzLDEpKTtyZXR1cm4gYi5maWx0ZXIoYSxmdW5jdGlvbihhKXtyZXR1cm4hYi5pbmNsdWRlKGMsYSl9KX07Yi56aXA9ZnVuY3Rpb24oKXtmb3IodmFyIGE9aS5jYWxsKGFyZ3VtZW50cyksYz1iLm1heChiLnBsdWNrKGEsXCJsZW5ndGhcIikpLGQ9QXJyYXkoYyksZT0wO2U8YztlKyspZFtlXT1iLnBsdWNrKGEsXCJcIitlKTtyZXR1cm4gZH07Yi5pbmRleE9mPWZ1bmN0aW9uKGEsXG5jLGQpe2lmKGE9PW51bGwpcmV0dXJuLTE7dmFyIGU7aWYoZClyZXR1cm4gZD1iLnNvcnRlZEluZGV4KGEsYyksYVtkXT09PWM/ZDotMTtpZihxJiZhLmluZGV4T2Y9PT1xKXJldHVybiBhLmluZGV4T2YoYyk7Zm9yKGQ9MCxlPWEubGVuZ3RoO2Q8ZTtkKyspaWYoZCBpbiBhJiZhW2RdPT09YylyZXR1cm4gZDtyZXR1cm4tMX07Yi5sYXN0SW5kZXhPZj1mdW5jdGlvbihhLGIpe2lmKGE9PW51bGwpcmV0dXJuLTE7aWYoQyYmYS5sYXN0SW5kZXhPZj09PUMpcmV0dXJuIGEubGFzdEluZGV4T2YoYik7Zm9yKHZhciBkPWEubGVuZ3RoO2QtLTspaWYoZCBpbiBhJiZhW2RdPT09YilyZXR1cm4gZDtyZXR1cm4tMX07Yi5yYW5nZT1mdW5jdGlvbihhLGIsZCl7YXJndW1lbnRzLmxlbmd0aDw9MSYmKGI9YXx8MCxhPTApO2Zvcih2YXIgZD1hcmd1bWVudHNbMl18fDEsZT1NYXRoLm1heChNYXRoLmNlaWwoKGItYSkvZCksMCksZj0wLGc9QXJyYXkoZSk7ZjxlOylnW2YrK109YSxhKz1kO3JldHVybiBnfTtcbnZhciBFPWZ1bmN0aW9uKCl7fTtiLmJpbmQ9ZnVuY3Rpb24oYSxjKXt2YXIgZCxlO2lmKGEuYmluZD09PXQmJnQpcmV0dXJuIHQuYXBwbHkoYSxpLmNhbGwoYXJndW1lbnRzLDEpKTtpZighYi5pc0Z1bmN0aW9uKGEpKXRocm93IG5ldyBUeXBlRXJyb3I7ZT1pLmNhbGwoYXJndW1lbnRzLDIpO3JldHVybiBkPWZ1bmN0aW9uKCl7aWYoISh0aGlzIGluc3RhbmNlb2YgZCkpcmV0dXJuIGEuYXBwbHkoYyxlLmNvbmNhdChpLmNhbGwoYXJndW1lbnRzKSkpO0UucHJvdG90eXBlPWEucHJvdG90eXBlO3ZhciBiPW5ldyBFLGc9YS5hcHBseShiLGUuY29uY2F0KGkuY2FsbChhcmd1bWVudHMpKSk7cmV0dXJuIE9iamVjdChnKT09PWc/ZzpifX07Yi5iaW5kQWxsPWZ1bmN0aW9uKGEpe3ZhciBjPWkuY2FsbChhcmd1bWVudHMsMSk7Yy5sZW5ndGg9PTAmJihjPWIuZnVuY3Rpb25zKGEpKTtqKGMsZnVuY3Rpb24oYyl7YVtjXT1iLmJpbmQoYVtjXSxhKX0pO3JldHVybiBhfTtiLm1lbW9pemU9ZnVuY3Rpb24oYSxcbmMpe3ZhciBkPXt9O2N8fChjPWIuaWRlbnRpdHkpO3JldHVybiBmdW5jdGlvbigpe3ZhciBiPWMuYXBwbHkodGhpcyxhcmd1bWVudHMpO3JldHVybiBtLmNhbGwoZCxiKT9kW2JdOmRbYl09YS5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fTtiLmRlbGF5PWZ1bmN0aW9uKGEsYil7dmFyIGQ9aS5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gc2V0VGltZW91dChmdW5jdGlvbigpe3JldHVybiBhLmFwcGx5KGEsZCl9LGIpfTtiLmRlZmVyPWZ1bmN0aW9uKGEpe3JldHVybiBiLmRlbGF5LmFwcGx5KGIsW2EsMV0uY29uY2F0KGkuY2FsbChhcmd1bWVudHMsMSkpKX07Yi50aHJvdHRsZT1mdW5jdGlvbihhLGMpe3ZhciBkLGUsZixnLGgsaT1iLmRlYm91bmNlKGZ1bmN0aW9uKCl7aD1nPWZhbHNlfSxjKTtyZXR1cm4gZnVuY3Rpb24oKXtkPXRoaXM7ZT1hcmd1bWVudHM7dmFyIGI7Znx8KGY9c2V0VGltZW91dChmdW5jdGlvbigpe2Y9bnVsbDtoJiZhLmFwcGx5KGQsZSk7aSgpfSxjKSk7Zz9oPXRydWU6XG5hLmFwcGx5KGQsZSk7aSgpO2c9dHJ1ZX19O2IuZGVib3VuY2U9ZnVuY3Rpb24oYSxiKXt2YXIgZDtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgZT10aGlzLGY9YXJndW1lbnRzO2NsZWFyVGltZW91dChkKTtkPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtkPW51bGw7YS5hcHBseShlLGYpfSxiKX19O2Iub25jZT1mdW5jdGlvbihhKXt2YXIgYj1mYWxzZSxkO3JldHVybiBmdW5jdGlvbigpe2lmKGIpcmV0dXJuIGQ7Yj10cnVlO3JldHVybiBkPWEuYXBwbHkodGhpcyxhcmd1bWVudHMpfX07Yi53cmFwPWZ1bmN0aW9uKGEsYil7cmV0dXJuIGZ1bmN0aW9uKCl7dmFyIGQ9Ry5hcHBseShbYV0sYXJndW1lbnRzKTtyZXR1cm4gYi5hcHBseSh0aGlzLGQpfX07Yi5jb21wb3NlPWZ1bmN0aW9uKCl7dmFyIGE9YXJndW1lbnRzO3JldHVybiBmdW5jdGlvbigpe2Zvcih2YXIgYj1hcmd1bWVudHMsZD1hLmxlbmd0aC0xO2Q+PTA7ZC0tKWI9W2FbZF0uYXBwbHkodGhpcyxiKV07cmV0dXJuIGJbMF19fTtiLmFmdGVyPVxuZnVuY3Rpb24oYSxiKXtyZXR1cm4gYTw9MD9iKCk6ZnVuY3Rpb24oKXtpZigtLWE8MSlyZXR1cm4gYi5hcHBseSh0aGlzLGFyZ3VtZW50cyl9fTtiLmtleXM9SXx8ZnVuY3Rpb24oYSl7aWYoYSE9PU9iamVjdChhKSl0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBvYmplY3RcIik7dmFyIGI9W10sZDtmb3IoZCBpbiBhKW0uY2FsbChhLGQpJiYoYltiLmxlbmd0aF09ZCk7cmV0dXJuIGJ9O2IudmFsdWVzPWZ1bmN0aW9uKGEpe3JldHVybiBiLm1hcChhLGIuaWRlbnRpdHkpfTtiLmZ1bmN0aW9ucz1iLm1ldGhvZHM9ZnVuY3Rpb24oYSl7dmFyIGM9W10sZDtmb3IoZCBpbiBhKWIuaXNGdW5jdGlvbihhW2RdKSYmYy5wdXNoKGQpO3JldHVybiBjLnNvcnQoKX07Yi5leHRlbmQ9ZnVuY3Rpb24oYSl7aihpLmNhbGwoYXJndW1lbnRzLDEpLGZ1bmN0aW9uKGIpe2Zvcih2YXIgZCBpbiBiKWJbZF0hPT12b2lkIDAmJihhW2RdPWJbZF0pfSk7cmV0dXJuIGF9O2IuZGVmYXVsdHM9ZnVuY3Rpb24oYSl7aihpLmNhbGwoYXJndW1lbnRzLFxuMSksZnVuY3Rpb24oYil7Zm9yKHZhciBkIGluIGIpYVtkXT09bnVsbCYmKGFbZF09YltkXSl9KTtyZXR1cm4gYX07Yi5jbG9uZT1mdW5jdGlvbihhKXtyZXR1cm4hYi5pc09iamVjdChhKT9hOmIuaXNBcnJheShhKT9hLnNsaWNlKCk6Yi5leHRlbmQoe30sYSl9O2IudGFwPWZ1bmN0aW9uKGEsYil7YihhKTtyZXR1cm4gYX07Yi5pc0VxdWFsPWZ1bmN0aW9uKGEsYil7cmV0dXJuIHIoYSxiLFtdKX07Yi5pc0VtcHR5PWZ1bmN0aW9uKGEpe2lmKGIuaXNBcnJheShhKXx8Yi5pc1N0cmluZyhhKSlyZXR1cm4gYS5sZW5ndGg9PT0wO2Zvcih2YXIgYyBpbiBhKWlmKG0uY2FsbChhLGMpKXJldHVybiBmYWxzZTtyZXR1cm4gdHJ1ZX07Yi5pc0VsZW1lbnQ9ZnVuY3Rpb24oYSl7cmV0dXJuISEoYSYmYS5ub2RlVHlwZT09MSl9O2IuaXNBcnJheT1wfHxmdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgQXJyYXldXCJ9O2IuaXNPYmplY3Q9ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT1cbk9iamVjdChhKX07Yi5pc0FyZ3VtZW50cz1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgQXJndW1lbnRzXVwifTtpZighYi5pc0FyZ3VtZW50cyhhcmd1bWVudHMpKWIuaXNBcmd1bWVudHM9ZnVuY3Rpb24oYSl7cmV0dXJuISghYXx8IW0uY2FsbChhLFwiY2FsbGVlXCIpKX07Yi5pc0Z1bmN0aW9uPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBGdW5jdGlvbl1cIn07Yi5pc1N0cmluZz1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgU3RyaW5nXVwifTtiLmlzTnVtYmVyPWZ1bmN0aW9uKGEpe3JldHVybiBsLmNhbGwoYSk9PVwiW29iamVjdCBOdW1iZXJdXCJ9O2IuaXNOYU49ZnVuY3Rpb24oYSl7cmV0dXJuIGEhPT1hfTtiLmlzQm9vbGVhbj1mdW5jdGlvbihhKXtyZXR1cm4gYT09PXRydWV8fGE9PT1mYWxzZXx8bC5jYWxsKGEpPT1cIltvYmplY3QgQm9vbGVhbl1cIn07Yi5pc0RhdGU9ZnVuY3Rpb24oYSl7cmV0dXJuIGwuY2FsbChhKT09XG5cIltvYmplY3QgRGF0ZV1cIn07Yi5pc1JlZ0V4cD1mdW5jdGlvbihhKXtyZXR1cm4gbC5jYWxsKGEpPT1cIltvYmplY3QgUmVnRXhwXVwifTtiLmlzTnVsbD1mdW5jdGlvbihhKXtyZXR1cm4gYT09PW51bGx9O2IuaXNVbmRlZmluZWQ9ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT12b2lkIDB9O2Iubm9Db25mbGljdD1mdW5jdGlvbigpe3MuXz1GO3JldHVybiB0aGlzfTtiLmlkZW50aXR5PWZ1bmN0aW9uKGEpe3JldHVybiBhfTtiLnRpbWVzPWZ1bmN0aW9uKGEsYixkKXtmb3IodmFyIGU9MDtlPGE7ZSsrKWIuY2FsbChkLGUpfTtiLmVzY2FwZT1mdW5jdGlvbihhKXtyZXR1cm4oXCJcIithKS5yZXBsYWNlKC8mL2csXCImYW1wO1wiKS5yZXBsYWNlKC88L2csXCImbHQ7XCIpLnJlcGxhY2UoLz4vZyxcIiZndDtcIikucmVwbGFjZSgvXCIvZyxcIiZxdW90O1wiKS5yZXBsYWNlKC8nL2csXCImI3gyNztcIikucmVwbGFjZSgvXFwvL2csXCImI3gyRjtcIil9O2IubWl4aW49ZnVuY3Rpb24oYSl7aihiLmZ1bmN0aW9ucyhhKSxmdW5jdGlvbihjKXtKKGMsXG5iW2NdPWFbY10pfSl9O3ZhciBLPTA7Yi51bmlxdWVJZD1mdW5jdGlvbihhKXt2YXIgYj1LKys7cmV0dXJuIGE/YStiOmJ9O2IudGVtcGxhdGVTZXR0aW5ncz17ZXZhbHVhdGU6LzwlKFtcXHNcXFNdKz8pJT4vZyxpbnRlcnBvbGF0ZTovPCU9KFtcXHNcXFNdKz8pJT4vZyxlc2NhcGU6LzwlLShbXFxzXFxTXSs/KSU+L2d9O2IudGVtcGxhdGU9ZnVuY3Rpb24oYSxjKXt2YXIgZD1iLnRlbXBsYXRlU2V0dGluZ3MsZD1cInZhciBfX3A9W10scHJpbnQ9ZnVuY3Rpb24oKXtfX3AucHVzaC5hcHBseShfX3AsYXJndW1lbnRzKTt9O3dpdGgob2JqfHx7fSl7X19wLnB1c2goJ1wiK2EucmVwbGFjZSgvXFxcXC9nLFwiXFxcXFxcXFxcIikucmVwbGFjZSgvJy9nLFwiXFxcXCdcIikucmVwbGFjZShkLmVzY2FwZSxmdW5jdGlvbihhLGIpe3JldHVyblwiJyxfLmVzY2FwZShcIitiLnJlcGxhY2UoL1xcXFwnL2csXCInXCIpK1wiKSwnXCJ9KS5yZXBsYWNlKGQuaW50ZXJwb2xhdGUsZnVuY3Rpb24oYSxiKXtyZXR1cm5cIicsXCIrYi5yZXBsYWNlKC9cXFxcJy9nLFxuXCInXCIpK1wiLCdcIn0pLnJlcGxhY2UoZC5ldmFsdWF0ZXx8bnVsbCxmdW5jdGlvbihhLGIpe3JldHVyblwiJyk7XCIrYi5yZXBsYWNlKC9cXFxcJy9nLFwiJ1wiKS5yZXBsYWNlKC9bXFxyXFxuXFx0XS9nLFwiIFwiKStcIjtfX3AucHVzaCgnXCJ9KS5yZXBsYWNlKC9cXHIvZyxcIlxcXFxyXCIpLnJlcGxhY2UoL1xcbi9nLFwiXFxcXG5cIikucmVwbGFjZSgvXFx0L2csXCJcXFxcdFwiKStcIicpO31yZXR1cm4gX19wLmpvaW4oJycpO1wiLGU9bmV3IEZ1bmN0aW9uKFwib2JqXCIsXCJfXCIsZCk7cmV0dXJuIGM/ZShjLGIpOmZ1bmN0aW9uKGEpe3JldHVybiBlLmNhbGwodGhpcyxhLGIpfX07dmFyIG49ZnVuY3Rpb24oYSl7dGhpcy5fd3JhcHBlZD1hfTtiLnByb3RvdHlwZT1uLnByb3RvdHlwZTt2YXIgdT1mdW5jdGlvbihhLGMpe3JldHVybiBjP2IoYSkuY2hhaW4oKTphfSxKPWZ1bmN0aW9uKGEsYyl7bi5wcm90b3R5cGVbYV09ZnVuY3Rpb24oKXt2YXIgYT1pLmNhbGwoYXJndW1lbnRzKTtILmNhbGwoYSx0aGlzLl93cmFwcGVkKTtyZXR1cm4gdShjLmFwcGx5KGIsXG5hKSx0aGlzLl9jaGFpbil9fTtiLm1peGluKGIpO2ooXCJwb3AscHVzaCxyZXZlcnNlLHNoaWZ0LHNvcnQsc3BsaWNlLHVuc2hpZnRcIi5zcGxpdChcIixcIiksZnVuY3Rpb24oYSl7dmFyIGI9a1thXTtuLnByb3RvdHlwZVthXT1mdW5jdGlvbigpe2IuYXBwbHkodGhpcy5fd3JhcHBlZCxhcmd1bWVudHMpO3JldHVybiB1KHRoaXMuX3dyYXBwZWQsdGhpcy5fY2hhaW4pfX0pO2ooW1wiY29uY2F0XCIsXCJqb2luXCIsXCJzbGljZVwiXSxmdW5jdGlvbihhKXt2YXIgYj1rW2FdO24ucHJvdG90eXBlW2FdPWZ1bmN0aW9uKCl7cmV0dXJuIHUoYi5hcHBseSh0aGlzLl93cmFwcGVkLGFyZ3VtZW50cyksdGhpcy5fY2hhaW4pfX0pO24ucHJvdG90eXBlLmNoYWluPWZ1bmN0aW9uKCl7dGhpcy5fY2hhaW49dHJ1ZTtyZXR1cm4gdGhpc307bi5wcm90b3R5cGUudmFsdWU9ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5fd3JhcHBlZH19KS5jYWxsKHRoaXMpOyJdfQ==
