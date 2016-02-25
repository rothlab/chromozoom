// ================================================================
// = The following are short jQuery extensions used by chromozoom =
// ================================================================

module.exports = function($) {
  
var utils = require('./utils.js')($),
  floorHack = utils.floorHack;

// Make a unique ID for an arbitary element, using the given prefix string
$.uniqId = function(prefix, alsoDisallow) {
  var rand = function() { return floorHack(Math.random()*1000000); };
  var num = rand();
  while ((alsoDisallow && alsoDisallow[num]) || $('#'+prefix+'-'+num).length) { num = rand(); }
  return prefix+'-'+num;
};

// Make a new element (faster than $("<elem/>"))
$.mk = function(NS, elem) { 
  return (elem && document.createElementNS) ? $(document.createElementNS(NS, elem)) 
    : $(document.createElement(elem = NS)); 
}

// jQuery Hotkeys Plugin, copyright 2010, John Resig
// Dual licensed under the MIT or GPL Version 2 licenses
// https://github.com/jeresig/jquery.hotkeys
$.hotkeys = {
  version: "0.8",

  specialKeys: {
    8: "backspace", 9: "tab", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
    20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
    37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 
    96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
    104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/", 
    112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8", 
    120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 191: "/", 224: "meta"
  },

  shiftNums: {
    "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", 
    "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", ";": ": ", "'": "\"", ",": "<", 
    ".": ">",  "/": "?",  "\\": "|"
  }
};

function keyHandler( handleObj ) {
  // Only care when a possible input has been specified
  if ( typeof handleObj.data !== "string" ) {
    return;
  }

  var origHandler = handleObj.handler,
    keys = handleObj.data.toLowerCase().split(" ");

  handleObj.handler = function( event ) {
    // Don't fire in text-accepting inputs that we didn't directly bind to
    if ( this !== event.target && (/textarea|select/i.test( event.target.nodeName ) ||
      event.target.type === "text" || event.target.type == "search" || event.target.type === "url") ) {
      return;
    }

    // Keypress represents characters, not special keys
    var special = event.type !== "keypress" && $.hotkeys.specialKeys[ event.which ],
      character = String.fromCharCode( event.which ).toLowerCase(),
      key, modif = "", possible = {};

    // check combinations (alt|ctrl|shift+anything)
    if ( event.altKey && special !== "alt" ) {
      modif += "alt+";
    }

    if ( event.ctrlKey && special !== "ctrl" ) {
      modif += "ctrl+";
    }

    // TODO: Need to make sure this works consistently across platforms
    if ( event.metaKey && !event.ctrlKey && special !== "meta" ) {
      modif += "meta+";
    }

    if ( event.shiftKey && special !== "shift" ) {
      modif += "shift+";
    }

    if ( special ) {
      possible[ modif + special ] = true;

    } else {
      possible[ modif + character ] = true;
      possible[ modif + $.hotkeys.shiftNums[ character ] ] = true;

      // "$" can be triggered as "Shift+4" or "Shift+$" or just "$"
      if ( modif === "shift+" ) {
        possible[ $.hotkeys.shiftNums[ character ] ] = true;
      }
    }

    for ( var i = 0, l = keys.length; i < l; i++ ) {
      if ( possible[ keys[i] ] ) {
        return origHandler.apply( this, arguments );
      }
    }
  };
}

$.each([ "keydown", "keyup", "keypress" ], function() {
  $.event.special[ this ] = { add: keyHandler };
});

// jQuery sortElements by James Padolsey, dual licensed MIT/GPL
// Found at https://github.com/padolsey/jQuery-Plugins/tree/master/sortElements/
$.fn.sortElements = (function(){
  var sort = [].sort;
  return function(comparator, getSortable) {
    getSortable = getSortable || function(){return this;};
    var placements = this.map(function(){
      var sortElement = getSortable.call(this),
        parentNode = sortElement.parentNode,
        // Since the element itself will change position, we have
        // to have some way of storing its original position in
        // the DOM. The easiest way is to have a 'flag' node:
        nextSibling = parentNode.insertBefore(
          document.createTextNode(''),
          sortElement.nextSibling
        );
      return function() {
        if (parentNode === this) {
          throw "You can't sort elements if any one is a descendant of another.";
        }
        // Insert before flag:
        parentNode.insertBefore(this, nextSibling);
        // Remove flag:
        parentNode.removeChild(nextSibling);
      };
    });

    return sort.call(this, comparator).each(function(i){
      placements[i].call(getSortable.call(this));
    });
  };
})();

// jQuery Cookie Plugin, found at https://github.com/carhartl/jquery-cookie
// Copyright 2011, Klaus Hartl
// Dual licensed under the MIT or GPL Version 2 licenses.
(function($) {
  $.cookie = function(key, value, options) {
    // key and at least value given, set cookie...
    if (arguments.length > 1 && (!/Object/.test(Object.prototype.toString.call(value)) || value === null || value === undefined)) {
      options = $.extend({}, options);

      if (value === null || value === undefined) {
        options.expires = -1;
      }

      if (typeof options.expires === 'number') {
        var days = options.expires, t = options.expires = new Date();
        t.setDate(t.getDate() + days);
      }

      value = String(value);

      return (document.cookie = [
        encodeURIComponent(key), '=', options.raw ? value : encodeURIComponent(value),
        // use expires attribute, max-age is not supported by IE
        options.expires ? '; expires=' + options.expires.toUTCString() : '',
        options.path    ? '; path=' + options.path : '',
        options.domain  ? '; domain=' + options.domain : '',
        options.secure  ? '; secure' : ''
      ].join(''));
    }

    // key and possibly options given, get cookie...
    options = value || {};
    var decode = options.raw ? function(s) { return s; } : decodeURIComponent;

    var pairs = document.cookie.split('; ');
    for (var i = 0, pair; pair = pairs[i] && pairs[i].split('='); i++) {
      // IE saves cookies with empty string as "c; ", e.g. without "=" as opposed to EOMB, thus pair[1] may be undefined
      if (decode(pair[0]) === key) return decode(pair[1] || '');
    }
    return null;
  };
})($);

// http://stackoverflow.com/questions/901115/get-query-string-values-in-javascript
$.urlParams = function() {
  var p = {},
    e,
    a = /\+/g,  // Regex for replacing addition symbol with a space
    r = /([^&=]+)=?([^&]*)/g,
    d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
    q = window.location.search.substring(1);

  while (e = r.exec(q)) { 
    var k = d(e[1]), v = d(e[2]); 
    p[k] = p[k] ? (_.isArray(p[k]) ? p[k].push(v) : [p[k], v]) : v; 
  }
  return p;
};

};